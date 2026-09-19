const mongoose = require("mongoose");

const Setting = require("../../models/Setting");
const {
  validateVoucherImages,
} = require("../../helpers/vouchers/validateImagesFiles");
const {
  assertVoucherFloorRule,
} = require("../../helpers/settings/assertVoucherFloorRule");
const { validateUpdateSetting } = require("../../validator/settings");

/**
 * V-1 — a floor for voucher images, and the size ceiling that was never there.
 *
 * ### 🔴 P12 — voucher images had no size check at all
 *
 * `validateVoucherImages` checked the mime type and the count, and then let a
 * 200 MB JPEG through: uploaded, paid for, and served to every customer whose
 * listing carried that voucher. Every other media surface on the platform has
 * had a ceiling for months — this one was simply missed.
 *
 * ### The floor is read on the way in, never on the way out
 *
 * `minImages` is deliberately unlike `minItemsPerSection`. Raising the showcase
 * floor hides sections the moment it saves; raising this one must **not** retire
 * a published voucher, because a customer may already have claimed it. So it is
 * checked at create, at image edit, and at submit-for-review — which is V-2.
 * This phase puts the number in place and guards it.
 */

const IMAGE = "image/jpeg";
const MB = 1024 * 1024;

const file = (overrides = {}) => ({
  name: "card.jpg",
  mimetype: IMAGE,
  size: 2 * MB,
  ...overrides,
});

/** A config shaped the way `getVoucherConfig()` returns it. */
const config = (overrides = {}) => ({
  maxImages: 5,
  minImages: 3,
  maxBytes: { IMAGE: 10 * MB, GIF: 15 * MB, VIDEO: 50 * MB },
  maxSizeMB: { IMAGE: 10, GIF: 15, VIDEO: 50 },
  ...overrides,
});

/** The thrown error, or `null` when the files were accepted. */
const refusal = (files, cfg = config()) => {
  try {
    validateVoucherImages(files, cfg);
    return null;
  } catch (error) {
    return error;
  }
};

describe("voucher image size — the check that was missing", () => {
  test("a file inside the ceiling is accepted", () => {
    expect(refusal([file({ size: 9 * MB })])).toBeNull();
  });

  test("a file exactly at the ceiling is accepted", () => {
    expect(refusal([file({ size: 10 * MB })])).toBeNull();
  });

  /** 🔴 The one that used to go through. */
  test("an oversized file is refused, and told the limit", () => {
    expect(refusal([file({ size: 200 * MB })])).toMatchObject({
      statusCode: 400,
      message: "card.jpg exceeds maximum image size of 10 MB.",
    });
  });

  test("the limit follows the configured number", () => {
    const at2MB = config({
      maxBytes: { IMAGE: 2 * MB },
      maxSizeMB: { IMAGE: 2 },
    });

    expect(refusal([file({ size: 3 * MB })], at2MB)).toMatchObject({
      message: expect.stringContaining("maximum image size of 2 MB"),
    });
    expect(refusal([file({ size: 1 * MB })], at2MB)).toBeNull();
  });

  test("every file in the batch is checked, not just the first", () => {
    expect(
      refusal([
        file({ size: 1 * MB }),
        file({ size: 2 * MB }),
        file({ name: "huge.jpg", size: 99 * MB }),
      ]),
    ).toMatchObject({
      message: expect.stringContaining("huge.jpg"),
    });
  });

  /**
   * ⚠️ Silent when the config carries no limits, so a caller that has not been
   * updated keeps its old behaviour rather than refusing every upload. The count
   * and mime checks still run either way — which the next two tests pin.
   */
  test("a config with no size limits does not refuse anything", () => {
    expect(refusal([file({ size: 500 * MB })], { maxImages: 5 })).toBeNull();
  });

  test("a bare number is still accepted as the old signature", () => {
    expect(refusal([file(), file(), file()], 2)).toMatchObject({
      statusCode: 400,
      message: "Maximum 2 voucher images are allowed.",
    });
  });

  test("a file with no size is not refused for it", () => {
    expect(refusal([file({ size: undefined })])).toBeNull();
  });

  test("the count check still runs", () => {
    expect(refusal([file(), file(), file(), file(), file(), file()])).toMatchObject(
      { message: "Maximum 5 voucher images are allowed." },
    );
  });

  test("the mime allow-list still runs, and still refuses an SVG", () => {
    expect(
      refusal([file({ mimetype: "image/svg+xml", name: "x.svg" })]),
    ).toMatchObject({ statusCode: 422 });
  });
});

describe("minImages on the Setting model", () => {
  const voucher = (overrides) =>
    new Setting({ vendor: { voucher: overrides } });

  test("it defaults to 3", () => {
    expect(new Setting({}).vendor.voucher.minImages).toBe(3);
  });

  test("a floor at or under the ceiling validates", () => {
    const error = voucher({ minImages: 5, maxImages: 5 }).validateSync();

    expect(error?.errors?.["vendor.voucher.minImages"]).toBeUndefined();
  });

  /**
   * 🔴 `minImages: 6` beside `maxImages: 5` leaves every voucher at once too
   * empty to publish and too full to fix.
   *
   * ⚠️ Asserted through `validateSync()` on purpose. A `pre("validate")` hook
   * does not run on the sync path, so a document built that way would come back
   * perfectly clean — the trap this migration has walked into four times. A path
   * validator runs on both.
   */
  test("a floor above the ceiling is refused, on the sync path too", () => {
    const error = voucher({ minImages: 6, maxImages: 5 }).validateSync();

    expect(error?.errors?.["vendor.voucher.minImages"]?.message).toBe(
      "minImages cannot be more than maxImages.",
    );
  });

  test("zero is refused by the schema minimum", () => {
    expect(
      voucher({ minImages: 0 }).validateSync()?.errors?.[
        "vendor.voucher.minImages"
      ],
    ).toBeDefined();
  });
});

describe("assertVoucherFloorRule — the merged document", () => {
  /**
   * ⚠️ Why this exists beside the Joi rule: `updateSetting` merges a partial
   * payload, so the two numbers can arrive in **different requests**. An admin
   * raising the floor today and lowering the ceiling tomorrow sends one field
   * each time, and a validator looking at the payload has nothing to compare
   * against either time.
   */
  const check = (voucher) => {
    try {
      assertVoucherFloorRule({ vendor: { voucher } });
      return null;
    } catch (error) {
      return error;
    }
  };

  test("a legal pair passes", () => {
    expect(check({ minImages: 3, maxImages: 5 })).toBeNull();
    expect(check({ minImages: 5, maxImages: 5 })).toBeNull();
  });

  test("a floor above the ceiling is a 422 that names both numbers", () => {
    expect(check({ minImages: 6, maxImages: 5 })).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("minImages (6)"),
    });
    expect(check({ minImages: 6, maxImages: 5 }).message).toContain(
      "maxImages (5)",
    );
  });

  test("a document with only one of the two is left alone", () => {
    expect(check({ minImages: 6 })).toBeNull();
    expect(check({ maxImages: 5 })).toBeNull();
    expect(check({})).toBeNull();
  });

  test("no voucher block at all is not an error", () => {
    expect(() => assertVoucherFloorRule({})).not.toThrow();
    expect(() => assertVoucherFloorRule()).not.toThrow();
  });
});

describe("the Joi rule — a payload carrying both numbers", () => {
  // ⚠️ `.body`, because `validateUpdateSetting` is the `{ body, params }` shape
  // `validateSchema` wraps — not a Joi object itself.
  const validate = (voucher) =>
    validateUpdateSetting.body.validate(
      { vendor: { voucher } },
      { abortEarly: false, stripUnknown: true, convert: true },
    );

  test("a legal pair passes", () => {
    expect(validate({ minImages: 3, maxImages: 5 }).error).toBeUndefined();
  });

  test("a floor above the ceiling is refused before it reaches the model", () => {
    const { error } = validate({ minImages: 6, maxImages: 5 });

    expect(error).toBeDefined();
    expect(error.message).toContain("minImages (6)");
  });

  test("one number alone passes Joi — the merged check is what catches it", () => {
    expect(validate({ minImages: 6 }).error).toBeUndefined();
  });

  test("zero is refused", () => {
    expect(validate({ minImages: 0 }).error).toBeDefined();
  });
});

describe("nothing else moved", () => {
  test("the id of the voucher block is unchanged", () => {
    const setting = new Setting({});

    expect(setting.vendor.voucher.maxOffers).toBe(10);
    expect(setting.vendor.voucher.maxImages).toBe(5);
    expect(setting.vendor.voucher.maxDistanceKm).toBe(25);
    expect(mongoose.isValidObjectId(setting._id)).toBe(true);
  });
});
