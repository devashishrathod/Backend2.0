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
/**
 * ⚠️ A **real** `Brand`, not a loose ObjectId.
 *
 * `publishVoucher` now resolves ownership through `resolveActorBrand`, which
 * reads `Brand.userId` — so a voucher pointing at a brand that does not exist
 * cannot be published at all. That is the honest shape anyway: the fixture used
 * to describe a voucher belonging to nothing.
 */
const seedBrand = async (ownerUserId) =>
  Brand.create({
    brandName: "lifecycle fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

/** What the controller builds from `req` for the brand's own vendor. */
const ownerActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});

const voucherAwaitingPublish = async ({
  liveEndsInDays = 90,
  nextEndsInDays = 120,
} = {}) => {
  const userId = oid();
  const brand = await seedBrand(userId);
  const brandId = brand._id;
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

  return { voucher, live, next, userId, brandId, brand };
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
    const { live, next, userId, brandId } = await voucherAwaitingPublish();

    await publishVoucher(ownerActor(userId, brandId), next._id);

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
    const { live, next, userId, brandId } = await voucherAwaitingPublish();

    await publishVoucher(ownerActor(userId, brandId), next._id);

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
    const { live, next, userId, brandId } = await voucherAwaitingPublish();

    await publishVoucher(ownerActor(userId, brandId), next._id);

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
    const { next, userId, brandId } = await voucherAwaitingPublish();

    await publishVoucher(ownerActor(userId, brandId), next._id);

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
    const { live, next, userId, brandId } = await voucherAwaitingPublish({
      liveEndsInDays: 90,
    });
    await publishVoucher(ownerActor(userId, brandId), next._id);

    await expireVouchers();

    const wasLive = await reload(live._id);
    expect(wasLive.status).toBe(VOUCHER_STATUSES.ARCHIVED);
    expect(wasLive.expiredAt ?? null).toBeNull();
  });

  it("expires an archived version once its endAt has passed", async () => {
    const { live, next, userId, brandId } = await voucherAwaitingPublish();
    await publishVoucher(ownerActor(userId, brandId), next._id);

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

/**
 * ⚠️ Publishing is not a status change in isolation — it puts a version in front
 * of customers and **archives whichever version was live**. So a caller who may
 * not act for this brand could take down another brand's running voucher and put
 * a different one up, with the approval history recording their own name on a
 * brand they have nothing to do with.
 *
 * `publishVoucher` took a `userId` and spent it entirely on audit fields —
 * `updatedBy`, `publishedBy`, `performedBy`, `archivedBy`. `voucher.brandId` was
 * loaded, written twice, and never compared. The route gate only ever
 * established that the caller was *a* vendor.
 */
describe("who may publish a version", () => {
  it("refuses a vendor from another brand, and leaves the live version live", async () => {
    const { live, next, brandId } = await voucherAwaitingPublish();
    const intruderUserId = oid();
    const intruderBrand = await seedBrand(intruderUserId);

    await expect(
      publishVoucher(
        ownerActor(intruderUserId, intruderBrand._id),
        next._id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Nothing moved: the running voucher is still running, the new one still
    // approved — an archive that happened anyway would be the real damage.
    expect((await reload(live._id)).status).toBe(VOUCHER_STATUSES.PUBLISHED);
    expect((await reload(next._id)).status).toBe(VOUCHER_STATUSES.APPROVED);
    expect(String(brandId)).not.toBe(String(intruderBrand._id));
  });

  /**
   * Ownership is read off `Brand.userId`, not the token's cached `brandId`, so
   * an old token naming a brand it no longer belongs to cannot widen anything.
   */
  it("refuses a token that merely claims the brand", async () => {
    const { live, next, brandId } = await voucherAwaitingPublish();

    await expect(
      publishVoucher(ownerActor(oid(), brandId), next._id),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect((await reload(live._id)).status).toBe(VOUCHER_STATUSES.PUBLISHED);
  });

  it("lets an admin publish for any brand", async () => {
    const { live, next } = await voucherAwaitingPublish();
    const admin = { userId: oid(), role: ROLES.ADMIN };

    await publishVoucher(admin, next._id);

    expect((await reload(next._id)).status).toBe(VOUCHER_STATUSES.PUBLISHED);
    expect((await reload(live._id)).status).toBe(VOUCHER_STATUSES.ARCHIVED);
  });

  /**
   * ⚠️ Both shapes, and the second is the one that matters.
   *
   * An actor object with no `userId` is what a request carrying no usable token
   * looks like. Guarding on `!actor` alone lets it through to the ownership
   * check, which answers **403** — "you may not act for this brand" — when the
   * truth is 401, "we do not know who you are". The first sends a client to a
   * permissions screen; only the second sends it to log in again.
   */
  it.each([
    ["no actor at all", undefined],
    ["an actor carrying no userId", {}],
  ])("refuses %s with a 401", async (_label, actor) => {
    const { next } = await voucherAwaitingPublish();

    await expect(publishVoucher(actor, next._id)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
