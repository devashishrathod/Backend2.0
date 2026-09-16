/**
 * S-2 (S-12, S-13, S-14) — positions the vendor can trust.
 *
 * ### 🔴 Why a real database
 *
 * Every one of these numbers is produced by a query, not by a branch:
 * `createSection` counts the brand's live sections, `deleteFullSection`
 * renumbers its siblings with a `bulkWrite`, and the media paths renumber
 * subdocuments and save them back. Mock those and the assertions become "we
 * called countDocuments" — which is the half that was never wrong. What has been
 * wrong is what the collection holds afterwards, and only Mongo can answer that.
 *
 * The section reorder also depends on `sort({ sortOrder: 1, createdAt: 1 })`
 * behaving like Mongo's sort, ties included.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const ShowcaseSection = require("../../models/ShowcaseSection");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  deleteSectionMedia,
} = require("../../services/showcases/deleteSectionMedia");
const {
  deleteFullSection,
} = require("../../services/showcases/deleteFullSection");
const {
  reorderSectionMedia,
} = require("../../services/showcases/reorderSectionMedia");
const { createSection } = require("../../services/showcases/createSection");
const {
  resolveActorBrand,
} = require("../../helpers/brands/resolveActorBrand");

/**
 * The storage delete and the entitlement release are the two things these paths
 * do that are not about order. Both are exercised elsewhere; here they would
 * only add an S3 call and a subscription fixture to every test.
 */
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

/**
 * `createSection` runs three gates before it decides a position — brand
 * ownership, an active plan, and a free slot in that plan's showcase pool. All
 * three are somebody else's tests; standing them up here would mean a
 * subscription, a plan and an entitlement fixture in front of every assertion
 * about a number.
 *
 * ⚠️ Mocked at the module they live in, not with `jest.spyOn` on the barrel.
 * `helpers/brands/index.js` destructures these at load, so it holds its own
 * reference and a spy on the export would never be seen — the same trap that
 * cost an afternoon on `getSetting` in S-1.
 */
jest.mock("../../helpers/brands/resolveActorBrand", () => ({
  resolveActorBrand: jest.fn(),
}));
jest.mock("../../helpers/subscribeds/assertActiveSubscription", () => ({
  assertActiveSubscription: jest.fn().mockResolvedValue(undefined),
}));

const ADMIN = {
  userId: String(new mongoose.Types.ObjectId()),
  role: ROLES.ADMIN,
};

const BRAND_ID = new mongoose.Types.ObjectId();

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

const makeSection = (medias, overrides = {}) =>
  ShowcaseSection.create({
    brandId: BRAND_ID,
    title: overrides.title || "Ambience",
    slug: overrides.slug || "ambience",
    medias,
    ...overrides,
  });

/** Live media as `Title@position`, in stored order. */
const liveOrder = async (sectionId) => {
  const stored = await ShowcaseSection.findById(sectionId).lean();
  return stored.medias
    .filter((item) => !item.isDeleted)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => `${item.title}@${item.sortOrder}`);
};

const sectionOrder = async () => {
  const sections = await ShowcaseSection.find({
    brandId: BRAND_ID,
    isDeleted: false,
  })
    .sort({ sortOrder: 1 })
    .lean();
  return sections.map((section) => `${section.title}@${section.sortOrder}`);
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(ShowcaseSection, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(ShowcaseSection, Brand);
  resolveActorBrand.mockResolvedValue({ _id: BRAND_ID });
});

describe("deleting a media closes the gap", () => {
  /**
   * 🔴 The `1, 3` the panel has been showing.
   *
   * A delete marked the row gone and left its position behind, and nothing ever
   * reclaimed it — the vendor's only route back to 1, 2 was a full drag-and-drop
   * reorder of the whole section.
   */
  test("the media after the deleted one move up", async () => {
    const section = await makeSection([photo(1), photo(2), photo(3)]);
    const middle = section.medias[1]._id;

    await deleteSectionMedia(ADMIN, {
      sectionId: section._id,
      mediaId: middle,
    });

    expect(await liveOrder(section._id)).toEqual(["Photo 1@1", "Photo 3@2"]);
  });

  test("the deleted row keeps its own number", async () => {
    const section = await makeSection([photo(1), photo(2), photo(3)]);

    await deleteSectionMedia(ADMIN, {
      sectionId: section._id,
      mediaId: section.medias[0]._id,
    });

    const stored = await ShowcaseSection.findById(section._id).lean();
    const removed = stored.medias.find((item) => item.isDeleted);

    // S-5: not zeroed. `sortOrder: 0` is the schema default, and a deleted row
    // at 0 sorts in front of everything that reads the array raw.
    expect(removed.sortOrder).toBe(1);
    expect(removed.title).toBe("Photo 1");
  });

  test("hidden media keep their place in the renumber", async () => {
    const section = await makeSection([
      photo(1),
      photo(2, { isActive: false }),
      photo(3),
      photo(4),
    ]);

    await deleteSectionMedia(ADMIN, {
      sectionId: section._id,
      mediaId: section.medias[0]._id,
    });

    // The hidden photo is still second — S-12 counts everything not deleted, so
    // switching it back on returns it to where the vendor left it.
    expect(await liveOrder(section._id)).toEqual([
      "Photo 2@1",
      "Photo 3@2",
      "Photo 4@3",
    ]);
  });

  test("several deletes in a row stay dense", async () => {
    const section = await makeSection([
      photo(1),
      photo(2),
      photo(3),
      photo(4),
      photo(5),
    ]);

    // By title, not by index — after the first renumber an index no longer means
    // what it meant when the fixture was written.
    for (const title of ["Photo 2", "Photo 4"]) {
      const current = await ShowcaseSection.findById(section._id);
      const target = current.medias.find((item) => item.title === title);
      await deleteSectionMedia(ADMIN, {
        sectionId: section._id,
        mediaId: target._id,
      });
    }

    expect(await liveOrder(section._id)).toEqual([
      "Photo 1@1",
      "Photo 3@2",
      "Photo 5@3",
    ]);
  });
});

describe("reordering covers every media the vendor can see", () => {
  /**
   * 🔴 S-14 — a hidden media used to keep its old number.
   *
   * The reorder renumbered only `isActive` media, so hiding #2 and reordering
   * the rest left the survivors at 1, 2, 3 with the hidden one *also* at 2.
   * Switch it back on and two media share a position, so which comes first is
   * whatever order Mongo returns.
   */
  test("a hidden media is part of the order, not left behind", async () => {
    const section = await makeSection([
      photo(1),
      photo(2, { isActive: false }),
      photo(3),
    ]);

    const [first, hidden, third] = section.medias;

    const result = await reorderSectionMedia(ADMIN, {
      sectionId: section._id,
      medias: [
        { id: third._id, sortOrder: 1 },
        { id: hidden._id, sortOrder: 2 },
        { id: first._id, sortOrder: 3 },
      ],
    });

    expect(result.updated).toBe(3);
    expect(await liveOrder(section._id)).toEqual([
      "Photo 3@1",
      "Photo 2@2",
      "Photo 1@3",
    ]);
  });

  /**
   * The completeness check counts what can be ordered. It used to count only
   * live media, so a section with a hidden photo told the vendor "2 media
   * expected" while the panel was showing them three.
   */
  test("the expected count includes hidden media", async () => {
    const section = await makeSection([
      photo(1),
      photo(2, { isActive: false }),
      photo(3),
    ]);

    await expect(
      reorderSectionMedia(ADMIN, {
        sectionId: section._id,
        medias: [
          { id: section.medias[0]._id, sortOrder: 1 },
          { id: section.medias[2]._id, sortOrder: 2 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("3 media expected"),
    });
  });

  test("a deleted media is not orderable and cannot be sent", async () => {
    const section = await makeSection([
      photo(1),
      photo(2, { isDeleted: true, isActive: false }),
      photo(3),
    ]);

    await expect(
      reorderSectionMedia(ADMIN, {
        sectionId: section._id,
        medias: [
          { id: section.medias[0]._id, sortOrder: 1 },
          { id: section.medias[1]._id, sortOrder: 2 },
          { id: section.medias[2]._id, sortOrder: 3 },
        ],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("2 media expected"),
    });
  });
});

describe("sections are dense across the brand", () => {
  /**
   * 🔴 The same drift one level up. Media inside a section were renumbered on
   * delete and sections never were, so a brand that removed its second album was
   * left listing `1, 3, 4` for good.
   */
  test("deleting a section renumbers its siblings", async () => {
    const first = await makeSection([photo(1)], {
      title: "First",
      slug: "first",
      sortOrder: 1,
    });
    const second = await makeSection([photo(1)], {
      title: "Second",
      slug: "second",
      sortOrder: 2,
    });
    await makeSection([photo(1)], {
      title: "Third",
      slug: "third",
      sortOrder: 3,
    });

    await deleteFullSection(ADMIN, { sectionId: second._id });

    expect(await sectionOrder()).toEqual(["First@1", "Third@2"]);

    // The deleted section is gone from the listing, not renumbered into it.
    const removed = await ShowcaseSection.findById(second._id).lean();
    expect(removed.isDeleted).toBe(true);
    expect(removed.sortOrder).toBe(2);
    expect(String(first._id)).not.toBe(String(second._id));
  });

  test("deleting the last section leaves the others untouched", async () => {
    await makeSection([photo(1)], { title: "A", slug: "a", sortOrder: 1 });
    await makeSection([photo(1)], { title: "B", slug: "b", sortOrder: 2 });
    const last = await makeSection([photo(1)], {
      title: "C",
      slug: "c",
      sortOrder: 3,
    });

    await deleteFullSection(ADMIN, { sectionId: last._id });

    expect(await sectionOrder()).toEqual(["A@1", "B@2"]);
  });

  test("a new section goes to the end", async () => {
    await makeSection([photo(1)], { title: "Kept", slug: "kept", sortOrder: 1 });

    const created = await createSection(ADMIN, { title: "Fresh" });

    expect(created.sortOrder).toBe(2);
    expect(await sectionOrder()).toEqual(["Kept@1", "Fresh@2"]);
  });

  /**
   * 🔴 The brands that already carry the drift — which is all of them.
   *
   * Sections were never renumbered on delete, so a brand that removed its second
   * album kept `1, 3`; `last.sortOrder + 1` then answered 4 and the list became
   * `1, 3, 4`, walking further from the count with every delete.
   *
   * A create heals it. Without that, `count + 1` on a brand holding `1, 5` would
   * answer 3 and slot the new section **in front of** the old one — a worse
   * answer than the drift it was replacing.
   *
   * ⚠️ This is the test that caught a mutant the rest of the file could not: with
   * the brand already dense, `count + 1` and `last + 1` agree on every input, so
   * nothing else here can tell them apart.
   */
  test("a create heals a brand whose numbers already drifted", async () => {
    await makeSection([photo(1)], {
      title: "Old one",
      slug: "old-one",
      sortOrder: 1,
    });
    await makeSection([photo(1)], {
      title: "Old five",
      slug: "old-five",
      sortOrder: 5,
    });

    const created = await createSection(ADMIN, { title: "Fresh" });

    // Last, not third-of-five — and the two survivors are pulled back to 1, 2.
    expect(created.sortOrder).toBe(3);
    expect(await sectionOrder()).toEqual([
      "Old one@1",
      "Old five@2",
      "Fresh@3",
    ]);
  });

  test("a deleted section is not counted and not renumbered", async () => {
    await makeSection([photo(1)], { title: "Kept", slug: "kept", sortOrder: 1 });
    const gone = await ShowcaseSection.create({
      brandId: BRAND_ID,
      title: "Long gone",
      slug: "long-gone",
      sortOrder: 8,
      isDeleted: true,
      medias: [],
    });

    const created = await createSection(ADMIN, { title: "Fresh" });

    expect(created.sortOrder).toBe(2);
    expect((await ShowcaseSection.findById(gone._id).lean()).sortOrder).toBe(8);
  });

  test("the first section of a brand is 1", async () => {
    const created = await createSection(ADMIN, { title: "Only one" });

    expect(created.sortOrder).toBe(1);
  });

  /**
   * S-13 — positions belong to the reorder endpoint. A `sortOrder` in the create
   * payload is ignored rather than honoured, so a client that still sends one
   * cannot put two sections on the same number.
   */
  test("a sortOrder in the payload is ignored", async () => {
    await makeSection([photo(1)], {
      title: "First",
      slug: "first",
      sortOrder: 1,
    });

    const created = await createSection(ADMIN, {
      title: "Queue jumper",
      sortOrder: 1,
    });

    expect(created.sortOrder).toBe(2);
    expect(await sectionOrder()).toEqual(["First@1", "Queue jumper@2"]);
  });

  test("create then delete then create stays dense", async () => {
    const a = await createSection(ADMIN, { title: "A" });
    await createSection(ADMIN, { title: "B" });
    await createSection(ADMIN, { title: "C" });

    await deleteFullSection(ADMIN, { sectionId: a.id ?? a._id });

    const fresh = await createSection(ADMIN, { title: "D" });

    expect(fresh.sortOrder).toBe(3);
    expect(await sectionOrder()).toEqual(["B@1", "C@2", "D@3"]);
  });

  test("another brand's sections are not renumbered", async () => {
    const otherBrand = new mongoose.Types.ObjectId();
    await ShowcaseSection.create({
      brandId: otherBrand,
      title: "Theirs",
      slug: "theirs",
      sortOrder: 7,
      medias: [photo(1)],
    });

    const mine = await makeSection([photo(1)], {
      title: "Mine",
      slug: "mine",
      sortOrder: 1,
    });
    await makeSection([photo(1)], {
      title: "Also mine",
      slug: "also-mine",
      sortOrder: 2,
    });

    await deleteFullSection(ADMIN, { sectionId: mine._id });

    const theirs = await ShowcaseSection.findOne({ brandId: otherBrand }).lean();
    expect(theirs.sortOrder).toBe(7);
    expect(await sectionOrder()).toEqual(["Also mine@1"]);
  });
});
