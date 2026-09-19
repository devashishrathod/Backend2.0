/**
 * ⚠️ `jest.mock`, not `jest.spyOn`.
 *
 * `getShowcaseConfig` destructures `getSetting` at module load, so it holds its
 * own reference — replacing the export afterwards changes nothing it can see,
 * and the call goes to the real database. In a unit run there is no connection,
 * so the symptom is a five-second timeout rather than an error that names the
 * cause. This is the same CommonJS binding `verifyImports` exists to warn about.
 */
const mockSetting = { value: {} };
jest.mock("../../helpers/settings/getSetting", () => ({
  getSetting: jest.fn(async () => mockSetting.value),
  getSettingDocument: jest.fn(),
  invalidateSettingCache: jest.fn(),
}));

const Setting = require("../../models/Setting");
const {
  assertShowcaseFloorRule,
} = require("../../helpers/settings/assertShowcaseFloorRule");
const {
  validateMediaFiles,
} = require("../../helpers/showcases/validateMedia");
const { SHOWCASE_MEDIA_CONFIG } = require("../../constants/showcase");

/**
 * S-1 — the showcase gets a floor, and GIFs get a ceiling of their own.
 *
 * ### What is at risk
 *
 *   1. **The floor must not climb above the ceiling.** `minItemsPerSection: 6`
 *      with `maxItemsPerSection: 5` makes every section at once too small to
 *      show and too full to fix — and no request a vendor can make escapes it.
 *   2. **`maxGifSizeMB` must actually meter something.** A knob on the admin
 *      panel that changes nothing is this codebase's recurring bug, and adding
 *      `image/gif` to the allow-list without a GIF-sized cap would refuse
 *      ordinary GIFs while claiming to accept them.
 *   3. **The schema defaults and the constant fallbacks must agree**, or the
 *      platform behaves differently depending on how old its settings row is.
 */

const showcase = (over = {}) =>
  new Setting({ vendor: { showcase: over } }).vendor.showcase;

describe("the floor cannot climb above the ceiling", () => {
  test("a floor under the ceiling is fine", () => {
    const doc = new Setting({
      vendor: { showcase: { minItemsPerSection: 3, maxItemsPerSection: 15 } },
    });
    expect(
      doc.validateSync()?.errors?.["vendor.showcase.minItemsPerSection"],
    ).toBeUndefined();
  });

  test("equal is fine — a section of exactly the ceiling still shows", () => {
    const doc = new Setting({
      vendor: { showcase: { minItemsPerSection: 5, maxItemsPerSection: 5 } },
    });
    expect(doc.validateSync()?.errors?.["vendor.showcase.minItemsPerSection"]).toBeUndefined();
  });

  /**
   * ⚠️ `validateSync()`, deliberately.
   *
   * The rule is a path validator rather than a `pre("validate")` hook, because
   * Mongoose runs hooks only on the async path — a document like this would
   * report perfectly clean to the sync one. That trap has cost this migration
   * three separate findings.
   */
  test("🔴 a floor above the ceiling is refused, on the sync path too", () => {
    const doc = new Setting({
      vendor: { showcase: { minItemsPerSection: 6, maxItemsPerSection: 5 } },
    });

    expect(
      doc.validateSync().errors["vendor.showcase.minItemsPerSection"].message,
    ).toBe("minItemsPerSection cannot be more than maxItemsPerSection.");
  });

  test("and on the async path", async () => {
    const doc = new Setting({
      vendor: { showcase: { minItemsPerSection: 6, maxItemsPerSection: 5 } },
    });
    await expect(doc.validate()).rejects.toThrow(/cannot be more than/);
  });
});

describe("assertShowcaseFloorRule — the merged document", () => {
  /**
   * 🔴 The case the payload validator cannot see.
   *
   * `updateSetting` merges a partial payload, so the two numbers can arrive in
   * **different requests**: raise the floor to 6 today (legal, the ceiling is
   * 15), lower the ceiling to 5 tomorrow. Each request carries one field and a
   * validator looking at the payload has nothing to compare it against.
   */
  const merged = (minItemsPerSection, maxItemsPerSection) => ({
    vendor: { showcase: { minItemsPerSection, maxItemsPerSection } },
  });

  test("refuses a floor above the ceiling", () => {
    expect(() => assertShowcaseFloorRule(merged(6, 5))).toThrow(
      /cannot be more than/,
    );
  });

  test("the message names both numbers, so the admin can act on it", () => {
    try {
      assertShowcaseFloorRule(merged(9, 4));
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.message).toContain("(9)");
      expect(error.message).toContain("(4)");
      expect(error.statusCode).toBe(422);
    }
  });

  test("allows a floor at or under the ceiling", () => {
    expect(() => assertShowcaseFloorRule(merged(3, 15))).not.toThrow();
    expect(() => assertShowcaseFloorRule(merged(5, 5))).not.toThrow();
  });

  test("says nothing when either number is absent", () => {
    // A partial document is not a broken one — it is one the merge has not
    // finished with.
    expect(() => assertShowcaseFloorRule(merged(6, undefined))).not.toThrow();
    expect(() => assertShowcaseFloorRule(merged(undefined, 5))).not.toThrow();
    expect(() => assertShowcaseFloorRule({})).not.toThrow();
    expect(() => assertShowcaseFloorRule(null)).not.toThrow();
  });
});

describe("the new fields, and the defaults behind them", () => {
  test("a fresh settings document carries the floors", () => {
    const fresh = showcase();

    expect(fresh.minItemsPerSection).toBe(3);
    expect(fresh.minSectionsPerBrand).toBe(1);
  });

  test("a GIF's ceiling is larger than a photo's, and that is the point", () => {
    const fresh = showcase();

    expect(fresh.maxGifSizeMB).toBe(15);
    expect(fresh.maxGifSizeMB).toBeGreaterThan(fresh.maxImageSizeMB);
  });

  test("🔴 image/gif is accepted — it was not before", () => {
    expect(showcase().allowedImages).toContain("image/gif");
  });

  /**
   * ⚠️ Two sources that must agree.
   *
   * The schema's defaults apply to a document being created; the constants apply
   * to a document that somehow lacks the field. A disagreement is a platform
   * that behaves differently depending on how old its settings row is.
   */
  test("the schema defaults and the constant fallbacks say the same thing", () => {
    const fresh = showcase();

    expect(fresh.minItemsPerSection).toBe(SHOWCASE_MEDIA_CONFIG.minItems);
    expect(fresh.minSectionsPerBrand).toBe(SHOWCASE_MEDIA_CONFIG.minSections);
    expect(fresh.maxGifSizeMB).toBe(SHOWCASE_MEDIA_CONFIG.maxGifSizeMB);
    expect(fresh.maxImageSizeMB).toBe(SHOWCASE_MEDIA_CONFIG.maxImageSizeMB);
    expect([...fresh.allowedImages].sort()).toEqual(
      [...SHOWCASE_MEDIA_CONFIG.allowedImages].sort(),
    );
  });
});

describe("getShowcaseConfig — the only read path there is", () => {
  const {
    getShowcaseConfig,
  } = require("../../helpers/settings/getShowcaseConfig");

  const stored = (showcaseBlock) => {
    mockSetting.value = { vendor: { showcase: showcaseBlock } };
  };

  afterEach(() => {
    mockSetting.value = {};
  });

  /**
   * ⚠️ A field on the model that this does not return is a field nothing can
   * read — `vendor.showcase.isActive` spent months exactly like that, saving
   * cleanly from the panel and changing nothing.
   */
  test("the new floors and the GIF ceiling come back", async () => {
    stored({
      minItemsPerSection: 4,
      minSectionsPerBrand: 2,
      // Below the platform ceiling (15 MB by default), which is the only
      // direction a surface may move — see the narrowing test below.
      maxGifSizeMB: 8,
    });

    const config = await getShowcaseConfig();

    expect(config.minItems).toBe(4);
    expect(config.minSections).toBe(2);
    expect(config.maxGifSizeMB).toBe(8);
  });

  /**
   * 🔴 A surface may narrow the platform ceiling. It may not raise it.
   *
   * This read path used to hand back whatever `vendor.showcase` said, with no
   * `min` anywhere — `effectiveLimitMB`, written for exactly this, had no caller
   * at all. `assertStorageLimitRule` refuses such a save, so the two together
   * are meant to be belt and braces; only the belt was on.
   *
   * ⚠️ The state below is reachable without breaking that rule: a document
   * seeded directly, restored from an older shape, or written before the rule
   * existed. The read path has to be safe on its own.
   */
  test("a surface above the platform ceiling is cut back to it", async () => {
    mockSetting.value = {
      storage: { limits: { maxGifSizeMB: 12, maxVideoSizeMB: 30 } },
      vendor: { showcase: { maxGifSizeMB: 20, maxVideoSizeMB: 80 } },
    };

    const config = await getShowcaseConfig();

    expect(config.maxGifSizeMB).toBe(12);
    expect(config.maxVideoSizeMB).toBe(30);
  });

  test("a document without them falls back to the constants", async () => {
    stored({});

    const config = await getShowcaseConfig();

    expect(config.minItems).toBe(SHOWCASE_MEDIA_CONFIG.minItems);
    expect(config.minSections).toBe(SHOWCASE_MEDIA_CONFIG.minSections);
    expect(config.maxGifSizeMB).toBe(SHOWCASE_MEDIA_CONFIG.maxGifSizeMB);
  });

  test("the whole shape is named, so a new column cannot arrive by accident", async () => {
    stored({});

    expect(Object.keys(await getShowcaseConfig()).sort()).toEqual([
      "allowedImages",
      "allowedVideos",
      "isActive",
      "maxGifSizeMB",
      "maxImageSizeMB",
      "maxImages",
      "maxItems",
      "maxVideoSizeMB",
      "maxVideos",
      "minItems",
      "minSections",
    ]);
  });
});

describe("maxGifSizeMB actually meters something", () => {
  const config = {
    maxItems: 15,
    maxImages: 15,
    maxVideos: 5,
    maxImageSizeMB: 10,
    maxGifSizeMB: 15,
    maxVideoSizeMB: 50,
    allowedImages: ["image/png", "image/gif"],
    allowedVideos: ["video/mp4"],
  };

  const file = (mimetype, sizeMB) => ({
    name: `a.${mimetype.split("/")[1]}`,
    mimetype,
    size: sizeMB * 1024 * 1024,
  });

  /**
   * 🔴 The knob that would have done nothing.
   *
   * A GIF is an `image/*` type, so it lands in the image branch. Metered against
   * `maxImageSizeMB` a 12 MB GIF is refused — while `allowedImages` says GIFs
   * are supported. The platform would claim a format and reject it in practice.
   */
  test("a GIF between the two ceilings is accepted", () => {
    expect(() => validateMediaFiles([file("image/gif", 12)], config)).not.toThrow();
  });

  test("a photo of the same size is not", () => {
    expect(() => validateMediaFiles([file("image/png", 12)], config)).toThrow(
      /exceeds maximum image size of 10 MB/,
    );
  });

  test("a GIF past its own ceiling is refused, and told which one", () => {
    expect(() => validateMediaFiles([file("image/gif", 16)], config)).toThrow(
      /exceeds maximum GIF size of 15 MB/,
    );
  });

  test("a format outside the allow-list is still refused outright", () => {
    expect(() =>
      validateMediaFiles([file("image/svg+xml", 1)], {
        ...config,
        allowedImages: ["image/png"],
      }),
    ).toThrow(/format is not supported/);
  });
});
