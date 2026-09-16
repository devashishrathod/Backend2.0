/**
 * S-3 — the write guards, through the real services and a real `Setting`.
 *
 * ### 🔴 Why a real database
 *
 * Two of these guards are a `countDocuments` with a filter, and the filter is
 * the whole rule: `assertBrandKeepsAVisibleSection` asks whether any *other*
 * section of the *same brand* is switched on, and getting `_id: { $ne }` or
 * `brandId` wrong there is silent — the guard simply stops firing, or starts
 * firing on another brand's sections. A mock would assert the shape of the
 * filter object rather than what Mongo does with it.
 *
 * The floors also come from the `Setting` document through the settings cache,
 * which is the layer that carried a live crash of its own in F-1. Reading it for
 * real is the point.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
  writeSetting,
} = require("./setup/testDb");

const ShowcaseSection = require("../../models/ShowcaseSection");
const Setting = require("../../models/Setting");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  deleteSectionMedia,
} = require("../../services/showcases/deleteSectionMedia");
const {
  updateSectionMedia,
} = require("../../services/showcases/updateSectionMedia");
const {
  deleteFullSection,
} = require("../../services/showcases/deleteFullSection");
const { updateSection } = require("../../services/showcases/updateSection");

/** Storage and entitlements are exercised elsewhere; here they are noise. */
jest.mock("../../helpers/showcases/upload", () => ({
  ...jest.requireActual("../../helpers/showcases/upload"),
  deleteMedia: jest.fn().mockResolvedValue(undefined),
  deleteAllMedia: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../helpers/brands/entitlementSlots", () => ({
  ...jest.requireActual("../../helpers/brands/entitlementSlots"),
  reserveSlot: jest.fn().mockResolvedValue(undefined),
  releaseSlot: jest.fn().mockResolvedValue(undefined),
}));

const BRAND_ID = new mongoose.Types.ObjectId();
const VENDOR = {
  userId: String(new mongoose.Types.ObjectId()),
  role: ROLES.VENDOR,
};
const ADMIN = {
  userId: String(new mongoose.Types.ObjectId()),
  role: ROLES.ADMIN,
};

const photo = (index, overrides = {}) => ({
  media: {
    url: `https://cdn.example.com/photo-${index}.jpg`,
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  },
  title: `Photo ${index}`,
  sortOrder: index,
  ...overrides,
});

const makeSection = (mediaCount, overrides = {}) =>
  ShowcaseSection.create({
    brandId: BRAND_ID,
    title: overrides.title || "Ambience",
    slug: overrides.slug || "ambience",
    medias: Array.from({ length: mediaCount }, (_, i) => photo(i + 1)),
    ...overrides,
  });

/**
 * A vendor whose brand this is.
 *
 * `resolveSectionForActor` confirms ownership against `Brand.userId` rather than
 * the token, so a vendor test needs the brand row to exist — an admin does not,
 * which is why the exemption cases can skip this.
 */
const makeBrandOwner = () =>
  Brand.collection.insertOne({
    _id: BRAND_ID,
    userId: new mongoose.Types.ObjectId(VENDOR.userId),
    isDeleted: false,
  });

/** The thrown error, or `null` when the write went through. */
const refusal = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
};

const visibleCount = async (sectionId) => {
  const stored = await ShowcaseSection.findById(sectionId).lean();
  return stored.medias.filter((m) => m.isActive && !m.isDeleted).length;
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  await makeBrandOwner();
});

describe("a section cannot quietly drop off the customer's profile", () => {
  test("deleting the third of three media is refused", async () => {
    const section = await makeSection(3);

    const error = await refusal(() =>
      deleteSectionMedia(VENDOR, {
        sectionId: section._id,
        mediaId: section.medias[0]._id,
      }),
    );

    expect(error).toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("at least 3 visible media"),
    });
    // Refused means refused — nothing was written on the way out.
    expect(await visibleCount(section._id)).toBe(3);
  });

  test("with four, the delete goes through", async () => {
    const section = await makeSection(4);

    expect(
      await refusal(() =>
        deleteSectionMedia(VENDOR, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
        }),
      ),
    ).toBeNull();
    expect(await visibleCount(section._id)).toBe(3);
  });

  /**
   * 🔴 The deadlock the plan's literal rule would have created.
   *
   * "Refuse when the count would fall below `minItems`" also catches a section
   * that is already below it — where refusing protects nothing, because the
   * section is invisible to customers either way. And the way out the message
   * offers is shut: `minSectionsPerBrand` cannot go below 1, so this brand could
   * not delete the section either. Two photos, one section, no legal move
   * anywhere in the domain.
   */
  test("a section already below the floor is not trapped", async () => {
    const section = await makeSection(2);

    expect(
      await refusal(() =>
        deleteSectionMedia(VENDOR, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
        }),
      ),
    ).toBeNull();
    expect(await visibleCount(section._id)).toBe(1);
  });

  test("the last media is still refused, by the hard bottom", async () => {
    const section = await makeSection(1);

    expect(
      await refusal(() =>
        deleteSectionMedia(VENDOR, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
        }),
      ),
    ).toMatchObject({
      statusCode: 400,
      message: "At least one media is required in this section.",
    });
  });

  /**
   * Hiding is a delete as far as a customer is concerned. A rule that caught
   * only the delete would be one a vendor walks around without meaning to.
   */
  test("hiding a media meets the same floor, as a 422", async () => {
    const section = await makeSection(3);

    const error = await refusal(() =>
      updateSectionMedia(VENDOR, {
        sectionId: section._id,
        mediaId: section.medias[0]._id,
        isActive: false,
      }),
    );

    expect(error).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("at least 3 visible media"),
    });
    expect(await visibleCount(section._id)).toBe(3);
  });

  test("showing a media back is never blocked", async () => {
    const section = await makeSection(3);
    await ShowcaseSection.updateOne(
      { _id: section._id },
      { $set: { "medias.0.isActive": false } },
    );

    expect(
      await refusal(() =>
        updateSectionMedia(VENDOR, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
          isActive: true,
        }),
      ),
    ).toBeNull();
    expect(await visibleCount(section._id)).toBe(3);
  });

  test("an admin moderating is not held to the floor", async () => {
    const section = await makeSection(3);

    expect(
      await refusal(() =>
        deleteSectionMedia(ADMIN, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
        }),
      ),
    ).toBeNull();
    expect(await visibleCount(section._id)).toBe(2);
  });

  test("the floor is whatever the admin configured", async () => {
    await writeSetting({ $set: { "vendor.showcase.minItemsPerSection": 5 } });
    const section = await makeSection(5);

    expect(
      await refusal(() =>
        deleteSectionMedia(VENDOR, {
          sectionId: section._id,
          mediaId: section.medias[0]._id,
        }),
      ),
    ).toMatchObject({
      message: expect.stringContaining("at least 5 visible media"),
    });
  });
});

describe("a brand keeps a section", () => {
  test("deleting the only section is refused", async () => {
    const section = await makeSection(3);

    const error = await refusal(() =>
      deleteFullSection(VENDOR, { sectionId: section._id }),
    );

    expect(error).toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("at least one showcase section"),
    });

    // 🔴 The guard runs before the storage delete, so a refusal has not already
    // thrown the vendor's photographs away.
    const stored = await ShowcaseSection.findById(section._id).lean();
    expect(stored.isDeleted).toBe(false);
    expect(stored.medias.every((m) => !m.isDeleted)).toBe(true);
  });

  test("deleting one of two goes through", async () => {
    await makeSection(3, { title: "First", slug: "first", sortOrder: 1 });
    const second = await makeSection(3, {
      title: "Second",
      slug: "second",
      sortOrder: 2,
    });

    expect(
      await refusal(() => deleteFullSection(VENDOR, { sectionId: second._id })),
    ).toBeNull();
  });

  test("an already-deleted section does not count as the one kept", async () => {
    const live = await makeSection(3, {
      title: "Live",
      slug: "live",
      sortOrder: 1,
    });
    await makeSection(3, {
      title: "Gone",
      slug: "gone",
      sortOrder: 2,
      isDeleted: true,
    });

    expect(
      await refusal(() => deleteFullSection(VENDOR, { sectionId: live._id })),
    ).toMatchObject({ statusCode: 400 });
  });

  test("an admin can delete the last one", async () => {
    const section = await makeSection(3);

    expect(
      await refusal(() => deleteFullSection(ADMIN, { sectionId: section._id })),
    ).toBeNull();
  });
});

describe("a brand keeps a section customers can see", () => {
  test("hiding the last visible section is refused", async () => {
    const section = await makeSection(3);

    const error = await refusal(() =>
      updateSection(VENDOR, { sectionId: section._id, isVisible: false }),
    );

    expect(error).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("last section customers can see"),
    });
    expect((await ShowcaseSection.findById(section._id).lean()).isVisible).toBe(
      true,
    );
  });

  test("isActive: false is refused the same way", async () => {
    const section = await makeSection(3);

    expect(
      await refusal(() =>
        updateSection(VENDOR, { sectionId: section._id, isActive: false }),
      ),
    ).toMatchObject({ statusCode: 422 });
  });

  /**
   * ⚠️ Checked before anything is written, so a refused request leaves the title
   * alone rather than half-applying the parts that were legal.
   */
  test("a refused hide does not rename the section either", async () => {
    const section = await makeSection(3);

    await refusal(() =>
      updateSection(VENDOR, {
        sectionId: section._id,
        title: "Renamed",
        isVisible: false,
      }),
    );

    const stored = await ShowcaseSection.findById(section._id).lean();
    expect(stored.title).toBe("Ambience");
    expect(stored.isVisible).toBe(true);
  });

  test("another visible section makes it allowed", async () => {
    await makeSection(3, { title: "Other", slug: "other", sortOrder: 1 });
    const section = await makeSection(3, {
      title: "This one",
      slug: "this-one",
      sortOrder: 2,
    });

    expect(
      await refusal(() =>
        updateSection(VENDOR, { sectionId: section._id, isVisible: false }),
      ),
    ).toBeNull();
  });

  test("a second section that is itself hidden does not count", async () => {
    await makeSection(3, {
      title: "Hidden",
      slug: "hidden",
      sortOrder: 1,
      isVisible: false,
    });
    const section = await makeSection(3, {
      title: "This one",
      slug: "this-one",
      sortOrder: 2,
    });

    expect(
      await refusal(() =>
        updateSection(VENDOR, { sectionId: section._id, isVisible: false }),
      ),
    ).toMatchObject({ statusCode: 422 });
  });

  /**
   * 🔴 The filter that a mock cannot check. Another **brand's** visible section
   * must not satisfy this brand's floor.
   */
  test("another brand's section does not count", async () => {
    await ShowcaseSection.create({
      brandId: new mongoose.Types.ObjectId(),
      title: "Someone else's",
      slug: "someone-elses",
      medias: [photo(1)],
    });
    const section = await makeSection(3);

    expect(
      await refusal(() =>
        updateSection(VENDOR, { sectionId: section._id, isVisible: false }),
      ),
    ).toMatchObject({ statusCode: 422 });
  });

  test("renaming without touching the flags is never blocked", async () => {
    const section = await makeSection(3);

    expect(
      await refusal(() =>
        updateSection(VENDOR, { sectionId: section._id, title: "Renamed" }),
      ),
    ).toBeNull();
  });

  test("an admin can hide the last one", async () => {
    const section = await makeSection(3);

    expect(
      await refusal(() =>
        updateSection(ADMIN, { sectionId: section._id, isVisible: false }),
      ),
    ).toBeNull();
  });
});
