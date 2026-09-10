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
const { publishVoucher } = require("../../services/vouchers/publishVoucher");
const { expireVouchers } = require("../../services/vouchers/expireVouchers");
const {
  VOUCHER_STATUSES,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");

/**
 * A version leaves circulation for one of two reasons, and they are not the same.
 *
 * ⚠️ Both used to be written as `EXPIRED`. Publishing v2 marked v1 expired even
 * when v1's own `endAt` was months away — so afterwards nothing could tell "the
 * vendor replaced it" apart from "its time ran out". That is not a cosmetic
 * distinction: the first is a vendor action with a date attached (`archivedAt`),
 * the second is the validity window closing (`expiredAt`), and any report of
 * "vouchers that expired this month" silently counted both.
 *
 * These tests pin the two apart. The last one is the load-bearing one: an
 * archived version whose `endAt` has **not** passed must stay archived. Under the
 * old behaviour it could never even reach that state.
 */

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

/** Codes are format-validated by the schema, so they cannot be arbitrary. */
let codeSeq = 10_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

/**
 * A voucher with one PUBLISHED version and one APPROVED version waiting to go
 * live — the exact shape `publishVoucher` supersedes.
 *
 * `endAt` on the live version is deliberately far in the future: that is what
 * makes "it was replaced" and "it expired" distinguishable at all.
 */
const voucherAwaitingPublish = async ({
  liveEndsInDays = 90,
  nextEndsInDays = 120,
} = {}) => {
  const brandId = oid();
  const userId = oid();
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId,
    name: "test voucher",
    normalizedName: "test voucher",
    voucherCode,
    status: VOUCHER_STATUSES.APPROVED,
  });

  const common = {
    voucherId: voucher._id,
    brandId,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "test voucher",
    // The schema refuses a version with neither, so both are the minimum a
    // publishable version can carry — nothing here depends on their contents.
    images: [{ url: "https://example.test/v.webp", sortOrder: 1 }],
    offers: [
      {
        title: "flat 10%",
        minBillAmount: 100,
        discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
        discountValue: 10,
        sortOrder: 1,
      },
    ],
  };

  const live = await VoucherVersion.create({
    ...common,
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.PUBLISHED,
    startAt: daysFromNow(-10),
    endAt: daysFromNow(liveEndsInDays),
    isImmutable: true,
  });

  const next = await VoucherVersion.create({
    ...common,
    versionNumber: 2,
    versionCode: `${voucherCode}-V2`,
    status: VOUCHER_STATUSES.APPROVED,
    // `publishVoucher` refuses a start date that is not in the future.
    startAt: daysFromNow(1),
    endAt: daysFromNow(nextEndsInDays),
    isImmutable: false,
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: next._id, currentVersion: 2 } },
  );

  return { voucher, live, next, userId, brandId };
};

const reload = (id) => VoucherVersion.findById(id).lean();

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

describe("publishing a new version archives the one it replaces", () => {
  it("marks the superseded version ARCHIVED, not EXPIRED", async () => {
    const { live, next, userId } = await voucherAwaitingPublish();

    await publishVoucher(userId, next._id);

    const wasLive = await reload(live._id);
    expect(wasLive.status).toBe(VOUCHER_STATUSES.ARCHIVED);
    /**
     * The whole point. Its validity runs another 90 days — calling that
     * "expired" is the thing this replaces.
     */
    expect(wasLive.status).not.toBe(VOUCHER_STATUSES.EXPIRED);
    expect(wasLive.endAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stamps archivedAt and leaves expiredAt unset", async () => {
    const { live, next, userId } = await voucherAwaitingPublish();

    await publishVoucher(userId, next._id);

    const wasLive = await reload(live._id);
    expect(wasLive.archivedAt).toBeInstanceOf(Date);
    /**
     * ⚠️ `expiredAt` absent, not null. A version that has not expired must not
     * carry an expiry date — a report reading this field would otherwise show a
     * date for something that never happened.
     */
    expect(wasLive.expiredAt ?? null).toBeNull();
    expect(wasLive.isActive).toBe(false);
  });

  it("records the supersede in history as ARCHIVED", async () => {
    const { live, next, userId } = await voucherAwaitingPublish();

    await publishVoucher(userId, next._id);

    const row = await VoucherApprovalHistory.findOne({
      voucherVersionId: live._id,
    }).lean();

    // The history row is what an admin reads to ask "why did this stop?".
    // Saying EXPIRED there was the same lie in a second place.
    expect(row.action).toBe(VOUCHER_APPROVAL_ACTION.ARCHIVED);
    expect(row.metadata.newVersionStatus).toBe(VOUCHER_STATUSES.ARCHIVED);
    expect(row.metadata.archivedAt).toBeInstanceOf(Date);
    expect(row.metadata.replacedByVersionId.toString()).toBe(
      next._id.toString(),
    );
  });

  it("leaves the newly published version untouched by any of it", async () => {
    const { next, userId } = await voucherAwaitingPublish();

    await publishVoucher(userId, next._id);

    const published = await reload(next._id);
    expect(published.status).toBe(VOUCHER_STATUSES.PUBLISHED);
    expect(published.archivedAt ?? null).toBeNull();
  });
});

describe("expireVouchers carries an archived version on to EXPIRED", () => {
  /**
   * 🔴 The load-bearing test.
   *
   * An archived version is not finished — it left circulation early while its
   * own validity kept running. The sweep must leave it alone until `endAt`
   * actually passes, or "archived" collapses back into "expired" and the two
   * states are indistinguishable again.
   */
  it("leaves an archived version alone while its endAt is in the future", async () => {
    const { live, next, userId } = await voucherAwaitingPublish({
      liveEndsInDays: 90,
    });
    await publishVoucher(userId, next._id);

    await expireVouchers();

    const wasLive = await reload(live._id);
    expect(wasLive.status).toBe(VOUCHER_STATUSES.ARCHIVED);
    expect(wasLive.expiredAt ?? null).toBeNull();
  });

  it("expires an archived version once its endAt has passed", async () => {
    const { live, next, userId } = await voucherAwaitingPublish();
    await publishVoucher(userId, next._id);

    // Wind its validity into the past — the only thing that has changed.
    await VoucherVersion.updateOne(
      { _id: live._id },
      { $set: { endAt: daysFromNow(-1) } },
    );

    await expireVouchers();

    const wasLive = await reload(live._id);
    expect(wasLive.status).toBe(VOUCHER_STATUSES.EXPIRED);
    expect(wasLive.expiredAt).toBeInstanceOf(Date);
    /**
     * ⚠️ `archivedAt` survives the transition. The two dates answer different
     * questions — when it was replaced, and when its validity ran out — and an
     * expiry must not erase the record of the supersede that came first.
     */
    expect(wasLive.archivedAt).toBeInstanceOf(Date);
  });

  it("still expires a published version whose endAt has passed", async () => {
    // The pre-existing behaviour, pinned so widening the filter to ARCHIVED
    // cannot quietly drop PUBLISHED out of the sweep.
    const { live } = await voucherAwaitingPublish();
    await VoucherVersion.updateOne(
      { _id: live._id },
      { $set: { endAt: daysFromNow(-1) } },
    );

    await expireVouchers();

    const wasLive = await reload(live._id);
    expect(wasLive.status).toBe(VOUCHER_STATUSES.EXPIRED);
  });
});
