/**
 * V-1 — the voucher image floor and the size ceiling, through a real `Setting`.
 *
 * ### 🔴 Why a real database
 *
 * `getVoucherConfig` reads the singleton `Setting` through the settings cache —
 * the layer that carried a live crash of its own in F-1, where `deepFreeze`
 * threw on an ObjectId and every settings read failed. A mocked `getSetting`
 * would have passed that day.
 *
 * The floor's merged-document guard is the other half: it exists precisely
 * because `updateSetting` merges a **partial** payload onto what is stored, so
 * the only way to test it honestly is to save one number, then the other.
 */

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
  writeSetting,
} = require("./setup/testDb");

const mongoose = require("mongoose");
const Setting = require("../../models/Setting");
const { getVoucherConfig } = require("../../helpers/settings/getVoucherConfig");
const { updateSetting } = require("../../services/settings/updateSetting");

const ADMIN_ID = new mongoose.Types.ObjectId();
const MB = 1024 * 1024;

/**
 * The thrown error, or `null` when the update went through.
 *
 * ⚠️ `(userId, payload)` — the actor comes first. The service stamps
 * `updatedBy`, so the id is not incidental.
 */
const save = async (payload) => {
  try {
    await updateSetting(ADMIN_ID, payload);
    return null;
  } catch (error) {
    return error;
  }
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(Setting);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Setting);
});

describe("getVoucherConfig", () => {
  test("the defaults are what the schema says", async () => {
    const config = await getVoucherConfig();

    expect(config).toMatchObject({
      maxOffers: 10,
      maxImages: 5,
      minImages: 3,
      maxDistanceKm: 25,
    });
  });

  /**
   * 🔴 P12 — voucher images had no size check at all, and no field to hold one.
   * The ceiling comes from the **global** storage limits rather than a new
   * voucher-specific number: there is nothing about a voucher image that needs a
   * different limit from every other image, and two numbers answering one
   * question is only safe when it is written down which wins.
   */
  test("the size ceilings come through, from the global storage limits", async () => {
    const config = await getVoucherConfig();

    expect(config.maxSizeMB.IMAGE).toBe(10);
    expect(config.maxBytes.IMAGE).toBe(10 * MB);
    expect(config.allowedImageTypes).toContain("image/jpeg");
    // A GIF is its own kind platform-wide; a voucher card is a still.
    expect(config.allowedImageTypes).not.toContain("image/gif");
  });

  test("an admin's stored values win over the defaults", async () => {
    await writeSetting({
      $set: {
        "vendor.voucher.minImages": 2,
        "vendor.voucher.maxImages": 8,
      },
    });

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 2,
      maxImages: 8,
    });
  });

  test("a raised global storage limit reaches the voucher config", async () => {
    await writeSetting({ $set: { "storage.limits.maxImageSizeMB": 25 } });

    const config = await getVoucherConfig();

    expect(config.maxSizeMB.IMAGE).toBe(25);
    expect(config.maxBytes.IMAGE).toBe(25 * MB);
  });
});

describe("the floor cannot climb above the ceiling", () => {
  test("a legal pair saves", async () => {
    expect(
      await save({ vendor: { voucher: { minImages: 4, maxImages: 6 } } }),
    ).toBeNull();

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 4,
      maxImages: 6,
    });
  });

  /**
   * ⚠️ The boundary, and the reason it is here rather than only in the unit
   * tests: a mutant that turned `<=` into `<` survived the first mutation run
   * because every money case used two different numbers.
   *
   * "Exactly N images" is a perfectly ordinary thing for an admin to want — and
   * refusing it would leave the number unreachable from either direction.
   */
  test("a floor equal to the ceiling is legal", async () => {
    expect(
      await save({ vendor: { voucher: { minImages: 5, maxImages: 5 } } }),
    ).toBeNull();

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 5,
      maxImages: 5,
    });
  });

  test("the same pair arriving one field at a time is also legal", async () => {
    expect(await save({ vendor: { voucher: { maxImages: 5 } } })).toBeNull();
    expect(await save({ vendor: { voucher: { minImages: 5 } } })).toBeNull();

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 5,
      maxImages: 5,
    });
  });

  test("both numbers in one payload are caught by Joi", async () => {
    const error = await save({
      vendor: { voucher: { minImages: 9, maxImages: 5 } },
    });

    expect(error).toMatchObject({ statusCode: 422 });
    expect(error.message).toContain("minImages (9)");
  });

  /**
   * 🔴 The case the Joi rule cannot see, and the reason
   * `assertVoucherFloorRule` exists.
   *
   * Each request carries **one** field and each is legal on its own. Only the
   * merged document has both numbers true at once.
   */
  test("one number per request is caught on the merged document", async () => {
    // Legal today: the ceiling is still 10.
    expect(
      await save({ vendor: { voucher: { maxImages: 10, minImages: 8 } } }),
    ).toBeNull();

    // Legal-looking tomorrow: a single field, nothing in the payload to compare.
    const error = await save({ vendor: { voucher: { maxImages: 5 } } });

    expect(error).toMatchObject({ statusCode: 422 });
    expect(error.message).toContain("minImages (8)");
    expect(error.message).toContain("maxImages (5)");
  });

  test("the refused update changes nothing", async () => {
    await save({ vendor: { voucher: { maxImages: 10, minImages: 8 } } });
    await save({ vendor: { voucher: { maxImages: 5 } } });

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 8,
      maxImages: 10,
    });
  });

  test("lowering the floor first makes the same pair legal", async () => {
    await save({ vendor: { voucher: { maxImages: 10, minImages: 8 } } });

    expect(await save({ vendor: { voucher: { minImages: 4 } } })).toBeNull();
    expect(await save({ vendor: { voucher: { maxImages: 5 } } })).toBeNull();

    expect(await getVoucherConfig()).toMatchObject({
      minImages: 4,
      maxImages: 5,
    });
  });

  /**
   * ⚠️ The showcase floor is checked on the same save, and the two must not
   * interfere — a legal voucher change should not be refused because a section
   * setting was touched in the same request, or the other way round.
   */
  test("the showcase floor is still enforced alongside it", async () => {
    const error = await save({
      vendor: {
        voucher: { minImages: 3 },
        showcase: { minItemsPerSection: 20, maxItemsPerSection: 5 },
      },
    });

    expect(error).toMatchObject({ statusCode: 422 });
    expect(error.message).toContain("minItemsPerSection");
  });
});
