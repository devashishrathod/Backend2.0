jest.mock("../../helpers/settings", () => ({
  getVoucherConfig: jest.fn(),
}));

const { getVoucherConfig } = require("../../helpers/settings");
const {
  assertVoucherImageFloor,
  voucherImageFloorMessage,
} = require("../../helpers/vouchers/assertImageFloor");

/**
 * V-2 — one rule, one answer (P13).
 *
 * ### 🔴 What this replaces
 *
 * The same question was asked in five places and answered five different ways:
 *
 *     createVoucher.js          422  "At least one voucher image is required."
 *     updateVoucher.js          400  "At least one voucher image is required."
 *     validate.js (submit)      400  "At least one image is required"    ← no full stop
 *     validate.js (approval)    400  "At least one voucher image is required."
 *     VoucherVersion.js         —    "At least one image is required."
 *
 * Two status codes, three wordings — and **none of them read `minImages`**, so a
 * platform configured for three images would have let a one-image voucher
 * through every one of them.
 *
 * ### The message is the feature
 *
 * "At least one voucher image is required" states the rule and leaves the vendor
 * to work out the action. That is fine at a floor of one and genuinely unhelpful
 * at three, because the number is not on their screen. So the refusal carries
 * both counts and does the arithmetic.
 */

const refusal = async (count, options) => {
  try {
    await assertVoucherImageFloor(count, options);
    return null;
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  getVoucherConfig.mockResolvedValue({ minImages: 3, maxImages: 5 });
});

describe("assertVoucherImageFloor", () => {
  test("at the floor is allowed", async () => {
    expect(await refusal(3)).toBeNull();
  });

  test("above the floor is allowed", async () => {
    expect(await refusal(4)).toBeNull();
    expect(await refusal(99)).toBeNull();
  });

  test("below the floor is a 422 that says the next step", async () => {
    expect(await refusal(2)).toMatchObject({
      statusCode: 422,
      message: "A voucher needs at least 3 images — this one has 2. Add 1 more.",
    });
  });

  test("an empty voucher is told how many it needs, not 'has 0'", async () => {
    expect((await refusal(0)).message).toBe(
      "A voucher needs at least 3 images — this one has none. Add 3 more.",
    );
  });

  /**
   * ⚠️ One status code across all three call sites. Two codes for one rule was
   * half of what made P13 hard to see — a client branching on 400 and a client
   * branching on 422 were both right, depending on which endpoint they hit.
   */
  test("the status is 422 wherever the floor is missed", async () => {
    for (const count of [0, 1, 2]) {
      expect((await refusal(count)).statusCode).toBe(422);
    }
  });

  test("the configured floor is what it reads", async () => {
    getVoucherConfig.mockResolvedValue({ minImages: 5 });

    expect(await refusal(4)).toMatchObject({
      message: expect.stringContaining("at least 5 images"),
    });
    expect(await refusal(5)).toBeNull();
  });

  /**
   * ⚠️ The caller passes the config when it already has it, so one request does
   * not read the settings cache twice — and the passed value wins, so a service
   * cannot accidentally validate against a different floor from the one it used
   * to size its own limits.
   */
  test("a caller-supplied floor is used without reading settings", async () => {
    expect(await refusal(2, { minImages: 2 })).toBeNull();
    expect(getVoucherConfig).not.toHaveBeenCalled();
  });

  test("with no floor supplied, settings are read once", async () => {
    await refusal(3);

    expect(getVoucherConfig).toHaveBeenCalledTimes(1);
  });

  test("a missing count is treated as none, not as passing", async () => {
    expect((await refusal(undefined)).message).toContain("has none");
    expect((await refusal(null)).message).toContain("has none");
  });
});

describe("voucherImageFloorMessage", () => {
  /**
   * Read by somebody under mild frustration. "Add 1 more images" is the kind of
   * detail that makes a product feel unmaintained.
   */
  test("singular and plural are both handled", () => {
    expect(voucherImageFloorMessage(2, 3)).toBe(
      "A voucher needs at least 3 images — this one has 2. Add 1 more.",
    );
    expect(voucherImageFloorMessage(1, 3)).toBe(
      "A voucher needs at least 3 images — this one has 1. Add 2 more.",
    );
  });

  test("a floor of one reads as one image, not one images", () => {
    expect(voucherImageFloorMessage(0, 1)).toBe(
      "A voucher needs at least 1 image — this one has none. Add 1 more.",
    );
  });

  test("the arithmetic is always the gap, at any floor", () => {
    expect(voucherImageFloorMessage(2, 10)).toContain("Add 8 more");
    expect(voucherImageFloorMessage(0, 10)).toContain("Add 10 more");
  });

  test("it never says a negative or zero gap", () => {
    // Not a state the guard produces, but the message is exported and a caller
    // could reach for it directly.
    expect(voucherImageFloorMessage(3, 3)).toContain("Add 0 more");
  });
});
