/**
 * V-5 — pause and resume, and the 409 that replaces a 500.
 *
 * ### 🔴 Why a real database
 *
 * The load-bearing test here is a **unique index firing**. `voucherId_1_status_1`
 * is partial on `{ status: "PUBLISHED", isDeleted: false }`, and the whole point
 * of the resume pre-check is to get in front of it with something a vendor can
 * act on. Against a mock there is no index, so the mutant that deletes the check
 * would pass and the test would be asserting nothing at all.
 *
 * The rest follows: pause frees the published slot, which is what lets a second
 * version go live while the first is down — a sequence that only exists because
 * the index allows exactly one.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  pauseVoucher,
  resumeVoucher,
} = require("../../services/vouchers/pauseResumeVoucher");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 40_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const seedBrand = async (ownerUserId) =>
  Brand.create({
    brandName: "pause fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

const ownerActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});

const versionFields = (voucher, brandId, userId) => ({
  voucherId: voucher._id,
  brandId,
  createdBy: userId,
  categoryId: oid(),
  subCategoryId: oid(),
  name: "pause fixture",
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
});

/** A voucher with one live version — the shape pause expects. */
const livingVoucher = async ({
  masterStatus = VOUCHER_STATUSES.PUBLISHED,
  endsInDays = 90,
} = {}) => {
  const userId = oid();
  const brand = await seedBrand(userId);
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "pause fixture",
    normalizedName: "pause fixture",
    voucherCode,
    status: masterStatus,
  });

  const live = await VoucherVersion.create({
    ...versionFields(voucher, brand._id, userId),
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.PUBLISHED,
    startAt: daysFromNow(-10),
    endAt: daysFromNow(endsInDays),
    isImmutable: true,
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: live._id, publishedVersionId: live._id } },
  );

  return { voucher, live, brand, userId, voucherCode };
};

const reloadVersion = (id) => VoucherVersion.findById(id).lean();
const reloadVoucher = (id) => Voucher.findById(id).lean();

/** What the service threw, as `{ statusCode, message }`. */
const failure = async (promise) => {
  try {
    await promise;
    throw new Error("expected this to throw, and it did not");
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
};

beforeAll(async () => {
  await connectTestDb();
  await Voucher.createIndexes();
  await VoucherVersion.createIndexes();
});

afterAll(async () => {
  await clearCollections(Voucher, VoucherVersion, VoucherApprovalHistory, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Voucher, VoucherVersion, VoucherApprovalHistory, Brand);
});

describe("pausing a live voucher", () => {
  it("takes the version out of circulation without changing anything else", async () => {
    const { voucher, live, brand, userId } = await livingVoucher();

    await pauseVoucher(ownerActor(userId, brand._id), live._id);

    const paused = await reloadVersion(live._id);
    expect(paused.status).toBe(VOUCHER_STATUSES.PAUSED);
    expect(paused.isActive).toBe(false);
    /**
     * ⚠️ The whole point of pausing rather than unpublishing: the version is
     * untouched and can come back exactly as it was.
     */
    expect(paused.endAt.getTime()).toBe(live.endAt.getTime());
    expect(paused.offers).toHaveLength(1);
    expect(paused.images).toHaveLength(1);
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
  });

  it("stores the vendor's reason and who paused it", async () => {
    const { live, brand, userId } = await livingVoucher();

    await pauseVoucher(ownerActor(userId, brand._id), live._id, {
      reason: "Stock khatam",
    });

    const paused = await reloadVersion(live._id);
    expect(paused.pauseReason).toBe("Stock khatam");
    expect(paused.pausedAt).toBeInstanceOf(Date);
    expect(String(paused.pausedBy)).toBe(String(userId));
  });

  it("does not require a reason", async () => {
    const { live, brand, userId } = await livingVoucher();

    const result = await pauseVoucher(ownerActor(userId, brand._id), live._id);

    expect(result.versionStatus).toBe(VOUCHER_STATUSES.PAUSED);
    expect((await reloadVersion(live._id)).pauseReason).toBeNull();
  });

  it("refuses a version that is not live", async () => {
    const { live, brand, userId } = await livingVoucher();
    await VoucherVersion.updateOne(
      { _id: live._id },
      { $set: { status: VOUCHER_STATUSES.APPROVED } },
    );

    const { statusCode, message } = await failure(
      pauseVoucher(ownerActor(userId, brand._id), live._id),
    );

    expect(statusCode).toBe(409);
    // The message names the status it found, so the vendor is not left guessing.
    expect(message).toContain("APPROVED");
  });

  it("records the pause in the approval history", async () => {
    const { voucher, live, brand, userId } = await livingVoucher();

    await pauseVoucher(ownerActor(userId, brand._id), live._id, {
      reason: "Renovation",
    });

    const entry = await VoucherApprovalHistory.findOne({
      voucherVersionId: live._id,
      action: VOUCHER_APPROVAL_ACTION.PAUSED,
    }).lean();

    expect(entry).toBeTruthy();
    expect(entry.reason).toBe("Renovation");
    expect(entry.metadata.previousVersionStatus).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
    expect(entry.metadata.newVersionStatus).toBe(VOUCHER_STATUSES.PAUSED);
    expect(String(entry.performedBy)).toBe(String(voucher.createdBy));
  });
});

describe("resuming a paused voucher", () => {
  it("puts it back exactly as it was", async () => {
    const { voucher, live, brand, userId } = await livingVoucher();
    await pauseVoucher(ownerActor(userId, brand._id), live._id, {
      reason: "Stock khatam",
    });

    await resumeVoucher(ownerActor(userId, brand._id), live._id);

    const back = await reloadVersion(live._id);
    expect(back.status).toBe(VOUCHER_STATUSES.PUBLISHED);
    expect(back.isActive).toBe(true);
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
  });

  /**
   * ⚠️ The stamps are cleared, unlike `archivedAt` and `expiredAt`. Those record
   * something that happened and stays happened; a pause is a state the version is
   * *in*, and it ends. Left behind, a report would call a live voucher paused and
   * show the vendor a reason beside a voucher that is back up.
   */
  it("clears the pause stamps on the way back", async () => {
    const { live, brand, userId } = await livingVoucher();
    await pauseVoucher(ownerActor(userId, brand._id), live._id, {
      reason: "Stock khatam",
    });

    await resumeVoucher(ownerActor(userId, brand._id), live._id);

    const back = await reloadVersion(live._id);
    expect(back.pausedAt).toBeNull();
    expect(back.pausedBy).toBeNull();
    expect(back.pauseReason).toBeNull();
  });

  it("refuses a version that is not paused", async () => {
    const { live, brand, userId } = await livingVoucher();

    const { statusCode, message } = await failure(
      resumeVoucher(ownerActor(userId, brand._id), live._id),
    );

    expect(statusCode).toBe(409);
    expect(message).toContain("PUBLISHED");
  });

  it("records the resume in the approval history", async () => {
    const { live, brand, userId } = await livingVoucher();
    await pauseVoucher(ownerActor(userId, brand._id), live._id);

    await resumeVoucher(ownerActor(userId, brand._id), live._id);

    const entry = await VoucherApprovalHistory.findOne({
      voucherVersionId: live._id,
      action: VOUCHER_APPROVAL_ACTION.RESUMED,
    }).lean();

    expect(entry).toBeTruthy();
    expect(entry.metadata.previousVersionStatus).toBe(VOUCHER_STATUSES.PAUSED);
    expect(entry.metadata.newVersionStatus).toBe(VOUCHER_STATUSES.PUBLISHED);
  });
});

describe("🔴 resuming when something else went live", () => {
  /**
   * The test this whole endpoint pair is shaped around.
   *
   * Pausing frees the published slot, so a vendor can publish v2 while v1 is
   * down — and then v1 has nowhere to come back to. Without the pre-check the
   * partial unique index refuses the write with
   * `E11000 … dup key: { voucherId, status: "PUBLISHED" }`, which `errorHandler`
   * has no branch for: a 500, naming an index the vendor has never heard of, for
   * something they did on purpose.
   */
  const withASecondLiveVersion = async () => {
    const { voucher, live, brand, userId, voucherCode } = await livingVoucher();
    await pauseVoucher(ownerActor(userId, brand._id), live._id);

    const second = await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 2,
      versionCode: `${voucherCode}-V2`,
      status: VOUCHER_STATUSES.PUBLISHED,
      startAt: daysFromNow(-1),
      endAt: daysFromNow(120),
      isImmutable: true,
    });

    return { voucher, live, second, brand, userId };
  };

  it("refuses with a 409, not a duplicate-key 500", async () => {
    const { live, brand, userId } = await withASecondLiveVersion();

    const { statusCode, message } = await failure(
      resumeVoucher(ownerActor(userId, brand._id), live._id),
    );

    expect(statusCode).toBe(409);
    // 🔴 What it must never be again.
    expect(statusCode).not.toBe(500);
    expect(message).not.toMatch(/E11000|dup key|voucherId_1_status_1/);
  });

  it("names the version that is live and what to do about it", async () => {
    const { live, brand, userId } = await withASecondLiveVersion();

    const { message } = await failure(
      resumeVoucher(ownerActor(userId, brand._id), live._id),
    );

    expect(message).toContain("Version 2");
    expect(message).toContain("Pause version 2 first");
  });

  it("leaves both versions exactly where they were", async () => {
    const { live, second, brand, userId } = await withASecondLiveVersion();

    await failure(resumeVoucher(ownerActor(userId, brand._id), live._id));

    expect((await reloadVersion(live._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
    expect((await reloadVersion(second._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
  });

  /**
   * ⚠️ A voucher whose validity ran out while it was paused cannot come back —
   * resuming would put an expired offer in front of customers, and the hourly
   * sweep would take it down again, so the vendor would watch it flicker rather
   * than be told why.
   */
  it("refuses to resume a version whose validity ran out", async () => {
    const { live, brand, userId } = await livingVoucher();
    await pauseVoucher(ownerActor(userId, brand._id), live._id);
    await VoucherVersion.updateOne(
      { _id: live._id },
      { $set: { endAt: daysFromNow(-1) } },
    );

    const { statusCode, message } = await failure(
      resumeVoucher(ownerActor(userId, brand._id), live._id),
    );

    expect(statusCode).toBe(409);
    expect(message).toContain("validity ran out");
    expect((await reloadVersion(live._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
  });
});

describe("whose voucher it is", () => {
  it("refuses a vendor from another brand, and leaves the voucher live", async () => {
    const { live } = await livingVoucher();
    const stranger = oid();
    const otherBrand = await seedBrand(stranger);

    const { statusCode } = await failure(
      pauseVoucher(ownerActor(stranger, otherBrand._id), live._id),
    );

    expect(statusCode).toBe(403);
    expect((await reloadVersion(live._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
  });

  it("lets an admin pause for any brand", async () => {
    const { live } = await livingVoucher();
    const adminId = oid();

    await pauseVoucher({ userId: adminId, role: ROLES.ADMIN }, live._id);

    expect((await reloadVersion(live._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
  });

  it("refuses an unauthenticated caller", async () => {
    const { live } = await livingVoucher();

    const { statusCode } = await failure(pauseVoucher({}, live._id));

    expect(statusCode).toBe(401);
  });
});

describe("the master follows only when it is describing this version", () => {
  /**
   * 🔴 `updateVoucher` sets the master back to DRAFT the moment a vendor forks a
   * new version, so a voucher can be live on v1 while its master reads DRAFT
   * because v2 is being written. Writing PAUSED over that would throw away the
   * one thing the master is tracking — the work in progress — to record
   * something the version already says.
   */
  it("leaves a DRAFT master alone, and still pauses the version", async () => {
    const { voucher, live, brand, userId } = await livingVoucher({
      masterStatus: VOUCHER_STATUSES.DRAFT,
    });

    const result = await pauseVoucher(ownerActor(userId, brand._id), live._id);

    expect((await reloadVersion(live._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.DRAFT,
    );
    // The response says what actually happened, rather than what was asked for.
    expect(result.voucherStatus).toBe(VOUCHER_STATUSES.DRAFT);
    expect(result.versionStatus).toBe(VOUCHER_STATUSES.PAUSED);
  });

  it("says out loud in the history that the master stayed behind", async () => {
    const { live, brand, userId } = await livingVoucher({
      masterStatus: VOUCHER_STATUSES.DRAFT,
    });

    await pauseVoucher(ownerActor(userId, brand._id), live._id);

    const entry = await VoucherApprovalHistory.findOne({
      voucherVersionId: live._id,
      action: VOUCHER_APPROVAL_ACTION.PAUSED,
    }).lean();

    // Otherwise the row reads like a half-applied write.
    expect(entry.metadata.masterFollowed).toBe(false);
    expect(entry.metadata.newVoucherStatus).toBe(VOUCHER_STATUSES.DRAFT);
  });
});
