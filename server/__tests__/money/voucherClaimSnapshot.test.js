/**
 * V-6c — the picture a claim keeps, and what keeps it alive.
 *
 * ### 🔴 Why a real database
 *
 * The thing that breaks here is an **inclusion projection**. `buildClaimPreview`
 * selects the voucher by naming its fields, and a `select()` that forgets
 * `banner` hands the snapshot builder `undefined` — which is not an error, it is
 * a silent fall back to `images[0]` on every claim ever made. There is no way to
 * see that against a mock, because a mock returns whatever it was told to.
 *
 * The second half is the one V-6 created: a claim has to still read correctly
 * after the voucher it points at is deleted.
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
const {
  buildVoucherSnapshot,
} = require("../../helpers/vouchers/buildVoucherSnapshot");
const { deleteVoucher } = require("../../services/vouchers/deleteVoucher");
const {
  buildClaimPreview,
} = require("../../helpers/vouchers/buildClaimPreview");
const SubBrand = require("../../models/SubBrand");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 70_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const media = (url, kind = "IMAGE") => ({ url, kind });

/** A voucher with three images and whatever banner the test needs. */
const seedVoucher = async ({ banner } = {}) => {
  const userId = oid();
  const brand = await Brand.create({
    brandName: "snapshot fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
    vouchersUsed: 1,
    vouchersLimit: 10,
  });
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "Pizza Friday",
    normalizedName: "pizza friday",
    voucherCode,
    status: VOUCHER_STATUSES.DRAFT,
    ...(banner ? { banner } : {}),
  });

  const version = await VoucherVersion.create({
    voucherId: voucher._id,
    brandId: brand._id,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "Pizza Friday",
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.DRAFT,
    startAt: daysFromNow(1),
    endAt: daysFromNow(90),
    // Deliberately out of order, so anything reading `images[0]` is caught.
    images: [
      { media: media("https://cdn.test/second.webp"), sortOrder: 2 },
      { media: media("https://cdn.test/first.webp"), sortOrder: 1 },
      { media: media("https://cdn.test/third.webp"), sortOrder: 3 },
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

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: version._id, currentVersion: 1 } },
  );

  return { voucher, version, brand, userId };
};

/**
 * The same voucher, but actually claimable: a PUBLISHED version inside its
 * window, a real outlet, and the mapping that ties them together.
 *
 * ⚠️ Needed because `buildClaimPreview` refuses anything else — and it is the
 * service whose projection this file is really about.
 */
const seedClaimable = async ({ banner } = {}) => {
  const { voucher, version, brand, userId } = await seedVoucher({ banner });

  await VoucherVersion.updateOne(
    { _id: version._id },
    {
      $set: {
        status: VOUCHER_STATUSES.PUBLISHED,
        startAt: daysFromNow(-1),
        endAt: daysFromNow(90),
      },
    },
  );

  const outlet = await SubBrand.create({
    userId,
    brandId: brand._id,
    uniqueId: `TDO${Date.now()}${Math.floor(Math.random() * 100000)}`,
    storeId: await generateSubBrandStoreId(),
    geo: { type: "Point", coordinates: [72.8777, 19.076] },
  });

  await VoucherSubBrand.create({
    createdBy: userId,
    updatedBy: userId,
    voucherId: voucher._id,
    voucherVersionId: version._id,
    brandId: brand._id,
    subBrandId: outlet._id,
    subBrandName: "outlet one",
    // ⚠️ The real generator — the charset comes from `STORE_ID_SECRET`, so a
    // literal that passes here fails on somebody else's machine.
    storeId: await generateSubBrandStoreId(),
    geo: { type: "Point", coordinates: [72.8777, 19.076] },
    isActive: true,
    isDeleted: false,
  });

  const fresh = await Voucher.findById(voucher._id);
  const freshVersion = await VoucherVersion.findById(version._id);
  return { voucher: fresh, version: freshVersion, brand, userId, outlet };
};

/**
 * A claim carrying a snapshot, the way `createVoucherClaimOrder` writes one.
 *
 * ⚠️ `REDEEMED`, not the default `PENDING`. A pending claim means a customer
 * is still at the checkout, and V-6 refuses to delete a voucher out from under
 * them — which is the guard working, not a fixture detail. The case these tests
 * are about is the finished one: bought, used, and then the vendor removes the
 * voucher months later.
 */
const seedClaim = async ({ voucher, version, brand }) =>
  VoucherClaim.create({
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    customerId: oid(),
    voucherId: voucher._id,
    voucherVersionId: version._id,
    brandId: brand._id,
    subBrandId: oid(),
    billAmount: 500,
    pricing: { billAmount: 500, totalPayable: 450 },
    voucherSnapshot: buildVoucherSnapshot(voucher, version),
  });

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
    VoucherSubBrand,
    SubBrand,
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
    VoucherSubBrand,
    SubBrand,
    Brand,
  );
});

describe("🔴 the banner reaches the snapshot at all", () => {
  /**
   * The projection test. `buildClaimPreview` names the voucher's fields, and a
   * `select()` without `banner` hands the builder `undefined` — every claim then
   * silently records the `images[0]` fallback, including the ones whose voucher
   * had a perfectly good approved banner.
   */
  it("carries the banner out of buildClaimPreview", async () => {
    const { voucher, outlet } = await seedClaimable({
      banner: {
        current: media("https://cdn.test/approved.webp"),
        status: null,
      },
    });

    const preview = await buildClaimPreview({
      voucherId: voucher._id,
      outletId: outlet._id,
      billAmount: 500,
    });

    /**
     * ⚠️ Through the real service, not a `select()` written here. A test that
     * spells out its own projection proves only that the test can spell — the
     * whole failure mode is the service forgetting the field, and a mutation
     * showed exactly that: dropping `banner` from its select left the earlier
     * version of this test passing.
     */
    // `_internal` is where the preview keeps the documents it loaded — the
    // same ones `createVoucherClaimOrder` builds the snapshot from.
    expect(preview._internal.voucher.banner?.current?.url).toBe(
      "https://cdn.test/approved.webp",
    );

    // And the snapshot built from it records the real banner, not the fallback.
    const snap = buildVoucherSnapshot(
      preview._internal.voucher,
      preview._internal.version,
    );
    expect(snap.bannerUrl).toBe("https://cdn.test/approved.webp");
  });

  it("falls back to the first image when the preview finds no banner", async () => {
    const { voucher, outlet } = await seedClaimable();

    const preview = await buildClaimPreview({
      voucherId: voucher._id,
      outletId: outlet._id,
      billAmount: 500,
    });
    const snap = buildVoucherSnapshot(
      preview._internal.voucher,
      preview._internal.version,
    );

    expect(snap.bannerUrl).toBe("https://cdn.test/first.webp");
  });

  it("freezes the approved banner, not the first image", async () => {
    const { voucher, version } = await seedVoucher({
      banner: {
        current: media("https://cdn.test/approved.webp"),
        status: null,
      },
    });

    const snap = buildVoucherSnapshot(voucher, version);

    expect(snap.bannerUrl).toBe("https://cdn.test/approved.webp");
    // And the product image is still kept beside it.
    expect(snap.imageUrl).toBe("https://cdn.test/first.webp");
  });

  /**
   * ⚠️ A pending banner is served to nobody (V-5), so the tile showed the first
   * image — and that is what the claim has to remember.
   */
  it("freezes what was on screen when the banner was still pending", async () => {
    const { voucher, version } = await seedVoucher({
      banner: {
        pending: media("https://cdn.test/unseen.webp"),
        status: VOUCHER_BANNER_STATUS.PENDING,
      },
    });

    const snap = buildVoucherSnapshot(voucher, version);

    expect(snap.bannerUrl).toBe("https://cdn.test/first.webp");
    expect(snap.bannerUrl).not.toBe("https://cdn.test/unseen.webp");
  });

  it("takes the first image by sortOrder from a real document", async () => {
    const { voucher, version } = await seedVoucher();

    const snap = buildVoucherSnapshot(voucher, version);

    // The array is stored 2, 1, 3 — anything reading position zero gets this
    // wrong.
    expect(snap.imageUrl).toBe("https://cdn.test/first.webp");
  });
});

describe("🔴 the claim outlives the voucher", () => {
  /**
   * The reason V-6 made this urgent. Once a voucher can be deleted, the claim
   * is the only thing left that remembers what was bought.
   */
  it("still reads the voucher's name and picture after the voucher is deleted", async () => {
    const { voucher, version, brand, userId } = await seedVoucher({
      banner: { current: media("https://cdn.test/approved.webp"), status: null },
    });
    const claim = await seedClaim({ voucher, version, brand });

    await deleteVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      voucher._id,
    );

    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.voucherSnapshot.name).toBe("Pizza Friday");
    expect(after.voucherSnapshot.bannerUrl).toBe("https://cdn.test/approved.webp");
    expect(after.voucherSnapshot.imageUrl).toBe("https://cdn.test/first.webp");
  });

  /**
   * ⚠️ `deleteVoucher` is a soft delete and removes **nothing** from storage.
   * That is what makes freezing a URL honest rather than a promise we cannot
   * keep — and it is worth pinning, because a future "also delete the files"
   * would break every claim ever made without touching this file.
   */
  it("leaves the files alone, so those URLs still point at something", async () => {
    const { voucher, version, brand, userId } = await seedVoucher();
    await seedClaim({ voucher, version, brand });

    await deleteVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      voucher._id,
    );

    const deletedVersion = await VoucherVersion.findById(version._id).lean();
    expect(deletedVersion.status).toBe(VOUCHER_STATUSES.DELETED);
    // The rows are retired; the media they name is untouched.
    expect(deletedVersion.images).toHaveLength(3);
    expect(deletedVersion.images.every((i) => i.media?.url)).toBe(true);
  });

  it("is unaffected by the voucher being renamed afterwards", async () => {
    const { voucher, version, brand } = await seedVoucher();
    const claim = await seedClaim({ voucher, version, brand });

    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { name: "Something Else Entirely" } },
    );

    const after = await VoucherClaim.findById(claim._id).lean();
    // A claim from September has to still read the way it read in September.
    expect(after.voucherSnapshot.name).toBe("Pizza Friday");
  });
});

describe("what an old claim looks like", () => {
  /**
   * ⚠️ Every claim written before V-6c has only the three original fields.
   * Nothing may throw on them — a client gets "no image", not a crash.
   */
  it("reads the new fields as undefined without throwing", async () => {
    const { voucher, version, brand } = await seedVoucher();
    const claim = await VoucherClaim.create({
      customerId: oid(),
      voucherId: voucher._id,
      voucherVersionId: version._id,
      brandId: brand._id,
      subBrandId: oid(),
      billAmount: 500,
      pricing: { billAmount: 500, totalPayable: 450 },
      // The old shape, exactly.
      voucherSnapshot: {
        name: "Pizza Friday",
        categoryId: oid(),
        subCategoryId: oid(),
      },
    });

    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.voucherSnapshot.name).toBe("Pizza Friday");
    expect(after.voucherSnapshot.bannerUrl ?? null).toBeNull();
    expect(after.voucherSnapshot.imageUrl ?? null).toBeNull();
  });
});
