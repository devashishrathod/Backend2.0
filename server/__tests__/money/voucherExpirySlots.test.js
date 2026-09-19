/**
 * V-5 — the master voucher's own status, and the slot it holds.
 *
 * ### 🔴 Why a real database
 *
 * Everything under test here is a query that was silently matching nothing.
 * `expireVouchers` selected masters by `{ endAt: { $lte: now } }` against a
 * collection where **no document has an `endAt`** — a mock would have returned
 * whatever the mock was told to return, and the bug was precisely that the real
 * collection returned an empty set. The brand recount hangs off that same list,
 * so it too has to be observed against rows that exist.
 *
 * The survivor rule is the other half: "does this voucher still have anything in
 * play" is a question about sibling documents, which is not a thing a unit test
 * can pose.
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
const { publishVoucher } = require("../../services/vouchers/publishVoucher");
const { expireVouchers } = require("../../services/vouchers/expireVouchers");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 30_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const seedBrand = async (ownerUserId, vouchersUsed = 1) =>
  Brand.create({
    brandName: "expiry fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
    vouchersUsed,
    vouchersLimit: 10,
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
  name: "expiry fixture",
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

/**
 * One voucher, one version, in whatever state the test needs.
 *
 * `vouchersUsed: 1` on the brand is the honest starting point — the voucher
 * exists, so the counter says one. Whether it comes back down is the thing under
 * test.
 */
const seedVoucher = async ({
  masterStatus = VOUCHER_STATUSES.PUBLISHED,
  versionStatus = VOUCHER_STATUSES.PUBLISHED,
  endsInDays = 90,
} = {}) => {
  const userId = oid();
  const brand = await seedBrand(userId);
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "expiry fixture",
    normalizedName: "expiry fixture",
    voucherCode,
    status: masterStatus,
  });

  const version = await VoucherVersion.create({
    ...versionFields(voucher, brand._id, userId),
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: versionStatus,
    startAt: daysFromNow(-10),
    endAt: daysFromNow(endsInDays),
    isImmutable: true,
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: version._id, publishedVersionId: version._id } },
  );

  return { voucher, version, brand, userId };
};

const reloadVoucher = (id) => Voucher.findById(id).lean();
const reloadVersion = (id) => VoucherVersion.findById(id).lean();
const reloadBrand = (id) => Brand.findById(id).lean();

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

describe("publishing tells the master it is published", () => {
  /**
   * 🔴 Before V-5 the master stayed `APPROVED` for ever. On stage that was every
   * voucher: 11 masters `APPROVED`, none `PUBLISHED`.
   */
  it("sets the master to PUBLISHED, not APPROVED", async () => {
    const userId = oid();
    const brand = await seedBrand(userId);
    const voucherCode = nextVoucherCode();

    const voucher = await Voucher.create({
      createdBy: userId,
      brandId: brand._id,
      name: "publish fixture",
      normalizedName: "publish fixture",
      voucherCode,
      status: VOUCHER_STATUSES.APPROVED,
    });

    const version = await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 1,
      versionCode: `${voucherCode}-V1`,
      status: VOUCHER_STATUSES.APPROVED,
      startAt: daysFromNow(1),
      endAt: daysFromNow(90),
      isImmutable: false,
    });

    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { currentVersionId: version._id, currentVersion: 1 } },
    );

    const result = await publishVoucher(
      ownerActor(userId, brand._id),
      version._id,
    );

    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
    // The reported status has to agree with what was written, or a panel that
    // renders the response shows something the database does not hold.
    expect(result.voucherStatus).toBe(VOUCHER_STATUSES.PUBLISHED);
  });

  it("records the master's new status in the approval history", async () => {
    const userId = oid();
    const brand = await seedBrand(userId);
    const voucherCode = nextVoucherCode();

    const voucher = await Voucher.create({
      createdBy: userId,
      brandId: brand._id,
      name: "history fixture",
      normalizedName: "history fixture",
      voucherCode,
      status: VOUCHER_STATUSES.APPROVED,
    });

    const version = await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 1,
      versionCode: `${voucherCode}-V1`,
      status: VOUCHER_STATUSES.APPROVED,
      startAt: daysFromNow(1),
      endAt: daysFromNow(90),
      isImmutable: false,
    });

    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { currentVersionId: version._id, currentVersion: 1 } },
    );

    await publishVoucher(ownerActor(userId, brand._id), version._id);

    const entry = await VoucherApprovalHistory.findOne({
      voucherVersionId: version._id,
      action: "PUBLISHED",
    }).lean();

    expect(entry.metadata.newVoucherStatus).toBe(VOUCHER_STATUSES.PUBLISHED);
  });
});

describe("the expiry sweep reaches the master", () => {
  /**
   * 🔴 The load-bearing test. This whole path returned an empty set on every run
   * the job ever made, because the filter named a field the collection does not
   * have.
   */
  it("expires the master once its only version has run out", async () => {
    const { voucher, version } = await seedVoucher({ endsInDays: -1 });

    const result = await expireVouchers();

    expect((await reloadVersion(version._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect(result.mastersExpired).toBe(1);
  });

  it("marks the expired master inactive", async () => {
    const { voucher } = await seedVoucher({ endsInDays: -1 });

    await expireVouchers();

    expect((await reloadVoucher(voucher._id)).isActive).toBe(false);
  });

  it("leaves the master alone while its version is still running", async () => {
    const { voucher } = await seedVoucher({ endsInDays: 30 });

    const result = await expireVouchers();

    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
    expect(result.mastersExpired).toBe(0);
  });

  /**
   * ⚠️ The survivor rule. A vendor whose live version ran out while their next
   * one sits in review has not finished with this voucher — retiring the master
   * there would take it away from behind and hand back a slot they are using.
   */
  it("keeps the master when another version is still in play", async () => {
    const { voucher, version, brand, userId } = await seedVoucher({
      endsInDays: -1,
    });

    await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 2,
      versionCode: `${voucher.voucherCode}-V2`,
      status: VOUCHER_STATUSES.DRAFT,
      startAt: daysFromNow(5),
      endAt: daysFromNow(120),
      isImmutable: false,
    });

    await expireVouchers();

    // The dead version is still expired — only the master is spared.
    expect((await reloadVersion(version._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
  });

  /**
   * ⚠️ A **paused** sibling is in play too, and it is the easiest one to get
   * wrong: pausing is the vendor deliberately holding something back, so it
   * looks inactive from every angle except the one that matters. Drop it from
   * the in-play list and a voucher the vendor paused on purpose gets retired the
   * moment an older version's window closes.
   */
  it("keeps the master when the version still in play is paused", async () => {
    const { voucher, brand, userId } = await seedVoucher({
      versionStatus: VOUCHER_STATUSES.ARCHIVED,
      endsInDays: -1,
    });

    await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 2,
      versionCode: `${voucher.voucherCode}-V2`,
      status: VOUCHER_STATUSES.PAUSED,
      startAt: daysFromNow(-1),
      endAt: daysFromNow(120),
      isImmutable: true,
    });

    await expireVouchers();

    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.PUBLISHED,
    );
    // And the slot it holds stays held — a paused voucher is still the vendor's.
    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(1);
  });

  /**
   * 🔴 New in V-5, and the same trap `ARCHIVED` was added to close. Pausing a
   * voucher does not stop its clock, so a paused version has to be swept too —
   * otherwise it outlives its own `endAt` and holds the slot for ever.
   */
  it("expires a paused version whose validity has run out", async () => {
    const { voucher, version } = await seedVoucher({
      masterStatus: VOUCHER_STATUSES.PAUSED,
      versionStatus: VOUCHER_STATUSES.PAUSED,
      endsInDays: -1,
    });

    await expireVouchers();

    expect((await reloadVersion(version._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect((await reloadVoucher(voucher._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
  });

  it("leaves a paused version alone while its validity is still running", async () => {
    const { version } = await seedVoucher({
      masterStatus: VOUCHER_STATUSES.PAUSED,
      versionStatus: VOUCHER_STATUSES.PAUSED,
      endsInDays: 30,
    });

    await expireVouchers();

    expect((await reloadVersion(version._id)).status).toBe(
      VOUCHER_STATUSES.PAUSED,
    );
  });

  it("does not expire the same master twice", async () => {
    await seedVoucher({ endsInDays: -1 });

    const first = await expireVouchers();
    const second = await expireVouchers();

    expect(first.mastersExpired).toBe(1);
    // Second pass: nothing is due any more, so nothing is touched — a job that
    // runs hourly must be safe to run hourly.
    expect(second.mastersExpired).toBe(0);
    expect(second.modified).toBe(0);
  });
});

describe("expiring a voucher gives its slot back", () => {
  /**
   * 🔴 The consequence the broken filter had, and the reason it mattered. The
   * brand list was built from the master rows that never matched, so
   * `recountBrandUsage` was never reached at all — a vendor on a 10-voucher plan
   * stayed at 10 for ever, with no API call able to fix it.
   */
  it("recounts the brand so the used counter comes back down", async () => {
    const { brand } = await seedVoucher({ endsInDays: -1 });

    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(1);

    const result = await expireVouchers();

    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(0);
    expect(result.brandsRecounted).toBe(1);
  });

  it("does not release the slot while a version is still in play", async () => {
    const { voucher, brand, userId } = await seedVoucher({ endsInDays: -1 });

    await VoucherVersion.create({
      ...versionFields(voucher, brand._id, userId),
      versionNumber: 2,
      versionCode: `${voucher.voucherCode}-V2`,
      status: VOUCHER_STATUSES.UNDER_REVIEW,
      startAt: daysFromNow(5),
      endAt: daysFromNow(120),
      isImmutable: false,
    });

    await expireVouchers();

    // The master stayed in play, so the slot it holds stays held.
    expect((await reloadBrand(brand._id)).vouchersUsed).toBe(1);
  });

  it("one brand's bad recount does not abort the sweep for the rest", async () => {
    const good = await seedVoucher({ endsInDays: -1 });
    const orphan = await seedVoucher({ endsInDays: -1 });
    // A voucher whose brand row is gone — the recount for it will find nothing.
    await Brand.deleteOne({ _id: orphan.brand._id });

    const result = await expireVouchers();

    expect((await reloadVoucher(orphan.voucher._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect((await reloadVoucher(good.voucher._id)).status).toBe(
      VOUCHER_STATUSES.EXPIRED,
    );
    expect((await reloadBrand(good.brand._id)).vouchersUsed).toBe(0);
    expect(result.mastersExpired).toBe(2);
  });
});
