/**
 * V-6 — delete, and the customers it refuses to strand.
 *
 * ### 🔴 Why a real database
 *
 * The live-claim guard is an aggregation over a second collection, and the
 * failure mode it is written against is a query that silently matches nothing:
 * `$match` does not cast, so a string id there finds no claims and the guard
 * waves everything through. Against a mock the guard would be told what to find.
 *
 * The slot release is the same shape — a write to `Brand` that has to be
 * observed rather than asserted about.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const { deleteVoucher } = require("../../services/vouchers/deleteVoucher");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 50_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const ownerActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});

const seedBrand = async (userId, vouchersUsed = 1) =>
  Brand.create({
    brandName: "delete fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
    vouchersUsed,
    vouchersLimit: 10,
  });

/** One voucher, two versions, on a brand whose counter says it holds one. */
const seedVoucher = async ({ status = VOUCHER_STATUSES.DRAFT } = {}) => {
  const userId = oid();
  const brand = await seedBrand(userId);
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "delete fixture",
    normalizedName: "delete fixture",
    voucherCode,
    status,
  });

  const common = {
    voucherId: voucher._id,
    brandId: brand._id,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "delete fixture",
    images: [
      {
        media: { url: "https://example.test/v.webp", kind: "IMAGE" },
        sortOrder: 1,
      },
    ],
    offers: [
      {
        title: "flat 10%",
        minBillAmount: 100,
        discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
        discountValue: 10,
        sortOrder: 1,
      },
    ],
    startAt: daysFromNow(-1),
    endAt: daysFromNow(90),
  };

  const v1 = await VoucherVersion.create({
    ...common,
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.ARCHIVED,
    isImmutable: true,
  });
  const v2 = await VoucherVersion.create({
    ...common,
    versionNumber: 2,
    versionCode: `${voucherCode}-V2`,
    status: VOUCHER_STATUSES.DRAFT,
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: v2._id, currentVersion: 2 } },
  );

  return { voucher, v1, v2, brand, userId };
};

/** A claim in whatever state the test needs, pointing at this voucher. */
const seedClaim = async ({ voucher, brand, status }) =>
  VoucherClaim.create({
    customerId: oid(),
    voucherId: voucher._id,
    voucherVersionId: oid(),
    brandId: brand._id,
    subBrandId: oid(),
    billAmount: 500,
    pricing: { billAmount: 500, payableAmount: 450 },
    status,
  });

const reloadVoucher = (id) => Voucher.findById(id).lean();
const reloadBrand = (id) => Brand.findById(id).lean();

const failure = async (promise) => {
  try {
    await promise;
    throw new Error("expected this to throw, and it did not");
  } catch (error) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      data: error.data,
    };
  }
};

beforeAll(async () => {
  await connectTestDb();
  await Voucher.createIndexes();
  await VoucherVersion.createIndexes();
});

afterAll(async () => {
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherClaim,
    VoucherApprovalHistory,
    Brand,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherClaim,
    VoucherApprovalHistory,
    Brand,
  );
});

describe("deleting a voucher nobody is holding", () => {
  it("writes isDeleted and status: DELETED together", async () => {
    const { voucher, brand, userId } = await seedVoucher();

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id, {
      reason: "Galti se bana diya tha",
    });

    const gone = await reloadVoucher(voucher._id);
    // 🔴 V-11: the operational flag and the display status are one decision.
    expect(gone.isDeleted).toBe(true);
    expect(gone.status).toBe(VOUCHER_STATUSES.DELETED);
    expect(gone.isActive).toBe(false);
  });

  it("records who, when and why", async () => {
    const { voucher, brand, userId } = await seedVoucher();

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id, {
      reason: "Galti se bana diya tha",
    });

    const gone = await reloadVoucher(voucher._id);
    expect(gone.deletedAt).toBeInstanceOf(Date);
    expect(String(gone.deletedBy)).toBe(String(userId));
    expect(gone.deleteReason).toBe("Galti se bana diya tha");
  });

  it("stores a blank reason as null rather than an empty string", async () => {
    const { voucher, brand, userId } = await seedVoucher();

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id, {
      reason: "   ",
    });

    // Two spellings of "no reason" means every reader has to check for both.
    expect((await reloadVoucher(voucher._id)).deleteReason).toBeNull();
  });

  /**
   * ⚠️ A version left behind would be a `PUBLISHED` version of a deleted
   * voucher, which the customer listing joins to through `voucherMappings` and
   * would keep serving.
   */
  it("takes every version down with it", async () => {
    const { voucher, v1, v2, brand, userId } = await seedVoucher();

    const result = await deleteVoucher(
      ownerActor(userId, brand._id),
      voucher._id,
    );

    for (const id of [v1._id, v2._id]) {
      const version = await VoucherVersion.findById(id).lean();
      expect(version.isDeleted).toBe(true);
      expect(version.status).toBe(VOUCHER_STATUSES.DELETED);
      expect(version.isActive).toBe(false);
    }
    expect(result.versionsDeleted).toBe(2);
  });

  it("gives the plan slot back", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(1);

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id);

    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(0);
  });

  it("records the delete in the approval history", async () => {
    const { voucher, brand, userId } = await seedVoucher();

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id, {
      reason: "Duplicate",
    });

    const entry = await VoucherApprovalHistory.findOne({
      voucherId: voucher._id,
      action: VOUCHER_APPROVAL_ACTION.DELETED,
    }).lean();

    expect(entry).toBeTruthy();
    expect(entry.reason).toBe("Duplicate");
    expect(entry.metadata.previousVoucherStatus).toBe(VOUCHER_STATUSES.DRAFT);
    expect(entry.metadata.newVoucherStatus).toBe(VOUCHER_STATUSES.DELETED);
    expect(entry.metadata.versionsDeleted).toBe(2);
  });

  it("refuses a second delete instead of releasing another slot", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await deleteVoucher(ownerActor(userId, brand._id), voucher._id);

    const { statusCode } = await failure(
      deleteVoucher(ownerActor(userId, brand._id), voucher._id),
    );

    // Sequentially, the load refuses it — `findOne` already filters on
    // `isDeleted: false`, so this never reaches the write.
    expect(statusCode).toBe(404);
    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(0);
  });

  /**
   * 🔴 The race the `isDeleted: false` **in the update filter** exists for, and
   * the one the sequential test above cannot reach.
   *
   * Two deletes arriving together both load the voucher and both see
   * `isDeleted: false` — the 404 never fires. Only the filter on the write
   * separates them. Without it both updates succeed, both write a history row,
   * and both call `releaseSlot`.
   *
   * ⚠️ Found by mutation: removing that filter left all 22 tests passing,
   * because every one of them deleted twice in sequence.
   */
  it("lets exactly one of two simultaneous deletes win", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    const actor = ownerActor(userId, brand._id);

    const outcomes = await Promise.allSettled([
      deleteVoucher(actor, voucher._id),
      deleteVoucher(actor, voucher._id),
    ]);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // 409 or 404 depending on which side of the load the loser lands — both are
    // a refusal. What must never happen is two successes.
    /**
     * 🔴 The loser is refused one of two ways, and both are correct.
     *
     * If it reaches the write, Mongo's transaction isolation stops it first with
     * a `WriteConflict` (code 112) — the `isDeleted: false` filter never gets a
     * chance to speak. If it loses earlier, the load's own filter 404s it.
     *
     * ⚠️ `WriteConflict` used to reach the caller as a **500** saying
     * *"yielding is disabled"*. `errorHandler` now maps it to a 409; that mapping
     * is pinned in `__tests__/unit/errorHandler.test.js`, because at this level
     * the service throws the raw Mongo error and never sees the middleware.
     */
    const why = lost[0].reason;
    const refusedCleanly = [404, 409].includes(why.statusCode);
    const refusedByMongo =
      why.code === 112 ||
      why.codeName === "WriteConflict" ||
      why.errorLabels?.includes("TransientTransactionError");

    expect(refusedCleanly || refusedByMongo).toBe(true);

    // One delete, one history row. Two would mean the write ran twice.
    const rows = await VoucherApprovalHistory.countDocuments({
      voucherId: voucher._id,
      action: VOUCHER_APPROVAL_ACTION.DELETED,
    });
    expect(rows).toBe(1);
  });
});

describe("🔴 a voucher customers are still holding", () => {
  it("refuses while a claim is PAID", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });

    const { statusCode, data } = await failure(
      deleteVoucher(ownerActor(userId, brand._id), voucher._id),
    );

    expect(statusCode).toBe(409);
    expect(data.liveClaims).toBe(1);
    expect(data.breakdown).toEqual({ [VOUCHER_CLAIM_STATUS.PAID]: 1 });
    expect((await reloadVoucher(voucher._id)).isDeleted).toBe(false);
  });

  it("refuses while a claim is PENDING", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PENDING });

    const { statusCode, data } = await failure(
      deleteVoucher(ownerActor(userId, brand._id), voucher._id),
    );

    expect(statusCode).toBe(409);
    expect(data.breakdown).toEqual({ [VOUCHER_CLAIM_STATUS.PENDING]: 1 });
  });

  it("counts both states and names them in the message", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PENDING });

    const { message, data } = await failure(
      deleteVoucher(ownerActor(userId, brand._id), voucher._id),
    );

    expect(data.liveClaims).toBe(3);
    expect(data.breakdown).toEqual({
      [VOUCHER_CLAIM_STATUS.PAID]: 2,
      [VOUCHER_CLAIM_STATUS.PENDING]: 1,
    });
    expect(message).toContain("2 already paid");
    expect(message).toContain("1 still checking out");
  });

  /**
   * Telling somebody "no" without telling them what does work is how a guard
   * becomes something people route around.
   */
  it("points at pause as the thing that does work", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });

    const { data } = await failure(
      deleteVoucher(ownerActor(userId, brand._id), voucher._id),
    );

    expect(data.suggestedAction).toMatch(/Pause it instead/);
  });

  /**
   * 🔴 The decision, not an oversight. Every other guard here exempts ADMIN,
   * because an admin overriding a vendor's rule is what being an admin is for.
   * The person this protects is neither of them.
   */
  it("refuses an ADMIN too", async () => {
    const { voucher, brand } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });

    const { statusCode } = await failure(
      deleteVoucher({ userId: oid(), role: ROLES.ADMIN }, voucher._id),
    );

    expect(statusCode).toBe(409);
    expect((await reloadVoucher(voucher._id)).isDeleted).toBe(false);
  });

  it("does not release the slot when it refuses", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status: VOUCHER_CLAIM_STATUS.PAID });

    await failure(deleteVoucher(ownerActor(userId, brand._id), voucher._id));

    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(1);
  });

  /**
   * ⚠️ The other half of the rule, and the one that decides whether the guard is
   * usable at all: a finished claim must not hold a voucher hostage for ever.
   */
  it.each([
    VOUCHER_CLAIM_STATUS.REDEEMED,
    VOUCHER_CLAIM_STATUS.FAILED,
    VOUCHER_CLAIM_STATUS.CANCELLED,
    VOUCHER_CLAIM_STATUS.EXPIRED,
    VOUCHER_CLAIM_STATUS.REFUNDED,
  ])("allows the delete when the only claim is %s", async (status) => {
    const { voucher, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, brand, status });

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id);

    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.DELETED,
    );
  });

  it("ignores a live claim on a different voucher", async () => {
    const { voucher, brand, userId } = await seedVoucher();
    const other = await seedVoucher();
    await seedClaim({
      voucher: other.voucher,
      brand: other.brand,
      status: VOUCHER_CLAIM_STATUS.PAID,
    });

    await deleteVoucher(ownerActor(userId, brand._id), voucher._id);

    expect((await reloadVoucher(voucher._id)).isDeleted).toBe(true);
  });
});

describe("whose voucher it is", () => {
  it("refuses a vendor from another brand", async () => {
    const { voucher } = await seedVoucher();
    const stranger = oid();
    const otherBrand = await seedBrand(stranger, 0);

    const { statusCode } = await failure(
      deleteVoucher(ownerActor(stranger, otherBrand._id), voucher._id),
    );

    expect(statusCode).toBe(403);
    expect((await reloadVoucher(voucher._id)).isDeleted).toBe(false);
  });

  it("lets an admin delete for any brand when nothing is held", async () => {
    const { voucher } = await seedVoucher();

    await deleteVoucher({ userId: oid(), role: ROLES.ADMIN }, voucher._id);

    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.DELETED,
    );
  });

  it("refuses an unauthenticated caller", async () => {
    const { voucher } = await seedVoucher();

    const { statusCode } = await failure(deleteVoucher({}, voucher._id));

    expect(statusCode).toBe(401);
  });
});
