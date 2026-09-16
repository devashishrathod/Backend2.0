const mongoose = require("mongoose");

/**
 * ⚠️ `jest.mock`, not `jest.spyOn`.
 *
 * `guards.js` destructures `getShowcaseConfig` from `helpers/settings` at load,
 * so it holds its own reference and a spy on the export would never be seen.
 * That trap cost an afternoon in S-1 and is the reason every settings-dependent
 * test in this repo is written this way.
 */
jest.mock("../../helpers/settings", () => ({
  getShowcaseConfig: jest.fn(),
}));
jest.mock("../../models/ShowcaseSection", () => ({
  countDocuments: jest.fn(),
}));

const { getShowcaseConfig } = require("../../helpers/settings");
const ShowcaseSection = require("../../models/ShowcaseSection");
const {
  countVisibleMedia,
  assertSectionKeepsItsFloor,
  assertBrandKeepsASection,
  assertBrandKeepsAVisibleSection,
} = require("../../helpers/showcases/guards");
const { ROLES } = require("../../constants");

/**
 * S-3 — the two floors, and who they are for.
 *
 * `minItemsPerSection` and `minSectionsPerBrand` were added in S-1 and read by
 * nothing. These guards are what reads them on the write side; the customer
 * filter that acts on the same number is S-4.
 *
 * ### The floors protect the vendor from themselves, never the content from the platform
 *
 * Every guard here is skipped for an admin. An admin removing media is
 * moderating — usually taking down something that should not be public — and a
 * floor that refused that would mean the platform cannot act because acting
 * would leave the section too small.
 */

const VENDOR = { userId: String(new mongoose.Types.ObjectId()), role: ROLES.VENDOR };
const ADMIN = { userId: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

/** A section document, with just enough of Mongoose's `DocumentArray` to work. */
const makeSection = (medias, overrides = {}) => {
  const rows = medias.map((media, index) => ({
    _id: `m${index + 1}`,
    isActive: true,
    isDeleted: false,
    ...media,
  }));
  rows.id = (id) => rows.find((row) => String(row._id) === String(id)) ?? null;

  return {
    _id: "s1",
    brandId: "b1",
    isVisible: true,
    isActive: true,
    medias: rows,
    ...overrides,
  };
};

const visible = (count) => Array.from({ length: count }, () => ({}));

/** The thrown error, or `null` when the write was allowed. */
const refusal = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  getShowcaseConfig.mockResolvedValue({ minItems: 3, minSections: 1 });
});

describe("countVisibleMedia", () => {
  test("counts what a customer would see", () => {
    const section = makeSection([
      {},
      { isActive: false },
      { isDeleted: true },
      {},
    ]);

    expect(countVisibleMedia(section.medias)).toBe(2);
  });

  test("an empty section is 0, and no argument is 0", () => {
    expect(countVisibleMedia([])).toBe(0);
    expect(countVisibleMedia()).toBe(0);
  });
});

describe("assertSectionKeepsItsFloor", () => {
  const remove = (section, mediaId, actor = VENDOR, statusCode = 400) =>
    refusal(() =>
      assertSectionKeepsItsFloor(section, { mediaId, actor, statusCode }),
    );

  test("dropping from the floor to below it is refused", async () => {
    const section = makeSection(visible(3));

    expect(await remove(section, "m1")).toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("at least 3 visible media"),
    });
  });

  test("the message says both ways out", async () => {
    const error = await remove(makeSection(visible(3)), "m1");

    expect(error.message).toMatch(/Add another one first/);
    expect(error.message).toMatch(/delete the whole section/);
  });

  test("staying at or above the floor is allowed", async () => {
    expect(await remove(makeSection(visible(4)), "m1")).toBeNull();
    expect(await remove(makeSection(visible(10)), "m1")).toBeNull();
  });

  /**
   * 🔴 The trap the plan's literal rule would have set.
   *
   * "Refuse when the count would fall below `minItems`" catches a section that
   * is **already** below it, where refusing protects nothing — the section is
   * invisible to customers either way. And the escape the message offers is shut
   * too: `minSectionsPerBrand` cannot go below 1, so a brand whose only section
   * holds two photos would have had no legal move anywhere in the domain.
   */
  test("a section already below the floor is free to shrink", async () => {
    expect(await remove(makeSection(visible(2)), "m1")).toBeNull();
    expect(await remove(makeSection(visible(1)), "m1")).toBeNull();
  });

  test("hidden and deleted media do not count toward the floor", async () => {
    // Four rows, three visible — removing one of those three crosses the floor.
    const section = makeSection([{}, {}, {}, { isActive: false }]);

    expect(await remove(section, "m1")).toMatchObject({ statusCode: 400 });
  });

  test("removing something already hidden changes nothing and is allowed", async () => {
    const section = makeSection([{}, {}, {}, { isActive: false }]);

    expect(await remove(section, "m4")).toBeNull();
  });

  test("a media that is not in the section is not this guard's problem", async () => {
    expect(await remove(makeSection(visible(3)), "nope")).toBeNull();
  });

  test("an admin is never refused", async () => {
    expect(await remove(makeSection(visible(3)), "m1", ADMIN)).toBeNull();
    // And the config is not even read for them.
    expect(getShowcaseConfig).not.toHaveBeenCalled();
  });

  test("the caller chooses the status code", async () => {
    const error = await remove(makeSection(visible(3)), "m1", VENDOR, 422);

    expect(error.statusCode).toBe(422);
  });

  test("the floor follows the configured number", async () => {
    getShowcaseConfig.mockResolvedValue({ minItems: 5, minSections: 1 });

    expect(await remove(makeSection(visible(5)), "m1")).toMatchObject({
      message: expect.stringContaining("at least 5 visible media"),
    });
    expect(await remove(makeSection(visible(6)), "m1")).toBeNull();
  });
});

describe("assertBrandKeepsASection", () => {
  const removeSection = (remaining, actor = VENDOR) => {
    ShowcaseSection.countDocuments.mockResolvedValue(remaining);
    return refusal(() => assertBrandKeepsASection("b1", { actor }));
  };

  test("deleting the last section is refused", async () => {
    expect(await removeSection(1)).toMatchObject({
      statusCode: 400,
      message: "A brand needs at least one showcase section. Create another one before deleting this.",
    });
  });

  test("deleting one of two is allowed", async () => {
    expect(await removeSection(2)).toBeNull();
  });

  test("a higher floor is named in the plural", async () => {
    getShowcaseConfig.mockResolvedValue({ minItems: 3, minSections: 2 });

    expect(await removeSection(2)).toMatchObject({
      message: expect.stringContaining("at least 2 showcase sections"),
    });
    expect(await removeSection(3)).toBeNull();
  });

  test("an admin is never refused", async () => {
    expect(await removeSection(1, ADMIN)).toBeNull();
    expect(ShowcaseSection.countDocuments).not.toHaveBeenCalled();
  });
});

describe("assertBrandKeepsAVisibleSection", () => {
  const hide = (payload, section = makeSection(visible(3)), actor = VENDOR) =>
    refusal(() => assertBrandKeepsAVisibleSection(section, { payload, actor }));

  test("hiding the last visible section is refused", async () => {
    ShowcaseSection.countDocuments.mockResolvedValue(0);

    expect(await hide({ isVisible: false })).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("last section customers can see"),
    });
  });

  test("isActive: false is the same event", async () => {
    ShowcaseSection.countDocuments.mockResolvedValue(0);

    expect(await hide({ isActive: false })).toMatchObject({ statusCode: 422 });
  });

  test("another visible section makes it allowed", async () => {
    ShowcaseSection.countDocuments.mockResolvedValue(1);

    expect(await hide({ isVisible: false })).toBeNull();
  });

  test("an update that hides nothing is not checked", async () => {
    expect(await hide({ title: "Renamed" })).toBeNull();
    expect(await hide({ isVisible: true })).toBeNull();
    expect(ShowcaseSection.countDocuments).not.toHaveBeenCalled();
  });

  /**
   * Turning off the second flag on a section that is already off changes nothing
   * a customer can see, so refusing it would be refusing a no-op.
   */
  test("a section that is already hidden can have its other flag turned off", async () => {
    const alreadyHidden = makeSection(visible(3), { isVisible: false });

    expect(await hide({ isActive: false }, alreadyHidden)).toBeNull();
    expect(ShowcaseSection.countDocuments).not.toHaveBeenCalled();
  });

  test("an admin is never refused", async () => {
    expect(await hide({ isVisible: false }, makeSection(visible(3)), ADMIN)).toBeNull();
    expect(ShowcaseSection.countDocuments).not.toHaveBeenCalled();
  });

  test("the brand's own sections are what is counted", async () => {
    ShowcaseSection.countDocuments.mockResolvedValue(1);

    await hide({ isVisible: false });

    expect(ShowcaseSection.countDocuments).toHaveBeenCalledWith({
      _id: { $ne: "s1" },
      brandId: "b1",
      isDeleted: false,
      isVisible: true,
      isActive: true,
    });
  });
});
