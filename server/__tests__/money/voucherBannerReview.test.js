/**
 * V-4 — the banner's own review, and what it does to the voucher (nothing).
 *
 * ### 🔴 Why a real database
 *
 * Approval is a **document rewrite with a file delete hanging off it**:
 * `pending` moves to `current`, `pending` is cleared, and only after the save
 * lands is the superseded file taken off storage. Ordering that against a mock
 * would assert the order we wrote, not the order that survives a save failing.
 *
 * The state machine also rests on what is actually stored — "already reviewed"
 * and "nothing waiting" are both read off the document, and a stale queue row is
 * exactly the case a mock cannot produce.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

jest.mock("../../helpers/brands/resolveActorBrand", () => ({
  resolveActorBrand: jest.fn(),
}));
jest.mock("../../helpers/vouchers/voucherBannerMedia", () => ({
  ...jest.requireActual("../../helpers/vouchers/voucherBannerMedia"),
  deleteVoucherBannerMedia: jest.fn().mockResolvedValue(undefined),
}));

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const Brand = require("../../models/Brand");
const Setting = require("../../models/Setting");

const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");
const {
  reviewVoucherBanner,
} = require("../../services/vouchers/reviewVoucherBanner");
const {
  submitVoucherForReview,
} = require("../../services/vouchers/submitVoucherForReview");
const {
  deleteVoucherBannerMedia,
} = require("../../helpers/vouchers/voucherBannerMedia");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const { pickVoucherBanner } = require("../../helpers/vouchers/pickVoucherBanner");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const nextVoucherCode = () => `VCH-${String(++seq).padStart(8, "0")}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const ADMIN_ID = oid();

const media = (name) => ({
  url: `https://example.test/${name}.webp`,
  kind: "IMAGE",
  mimeType: "image/webp",
  storage: { provider: "AWS_S3", bucket: "test", key: `banners/${name}.webp` },
});

const image = (index) => ({
  media: { url: `https://example.test/img${index}.webp`, kind: "IMAGE" },
  sortOrder: index,
});

const offer = {
  title: "flat 10%",
  minBillAmount: 100,
  discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
  discountValue: 10,
  sortOrder: 1,
};

/** A DRAFT voucher, optionally carrying a banner in whichever state. */
const seedVoucher = async (banner) => {
  const userId = oid();
  const brand = await Brand.create({
    brandName: "banner fixture brand",
    uniqueId: `TDB${Date.now()}${++seq}${Math.floor(Math.random() * 10000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
  });

  const voucherCode = nextVoucherCode();
  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: `banner voucher ${seq}`,
    normalizedName: `banner voucher ${seq}`,
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
    name: "banner voucher",
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.DRAFT,
    startAt: daysFromNow(2),
    endAt: daysFromNow(60),
    images: [image(1), image(2), image(3)],
    offers: [offer],
  });

  await VoucherSubBrand.create({
    createdBy: userId,
    updatedBy: userId,
    voucherId: voucher._id,
    voucherVersionId: version._id,
    brandId: brand._id,
    subBrandId: oid(),
    subBrandName: "outlet one",
    storeId: await generateSubBrandStoreId(),
    geo: { type: "Point", coordinates: [72.8777, 19.076] },
    isActive: true,
    isDeleted: false,
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: version._id, currentVersion: 1 } },
  );

  return { voucher, version, userId, brand };
};

/** The thrown error, or `null`. */
const attempt = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
};

const reload = (id) => Voucher.findById(id).lean();

beforeAll(async () => {
  await connectTestDb();
  await Voucher.createIndexes();
  await VoucherVersion.createIndexes();
});

afterAll(async () => {
  await clearCollections(Voucher, VoucherVersion, VoucherSubBrand, Brand, Setting);
  await disconnectTestDb();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await clearCollections(Voucher, VoucherVersion, VoucherSubBrand, Brand, Setting);
});

describe("approving a banner", () => {
  const pendingBanner = {
    pending: media("new"),
    status: VOUCHER_BANNER_STATUS.PENDING,
  };

  test("pending becomes current, and nothing is left in review", async () => {
    const { voucher } = await seedVoucher(pendingBanner);

    await reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" });

    const stored = await reload(voucher._id);
    expect(stored.banner.current.storage.key).toBe("banners/new.webp");
    expect(stored.banner.pending).toBeUndefined();
    /**
     * ⚠️ `null`, not `"APPROVED"`. `status` describes what is **in review**, and
     * after an approval nothing is. Customers still see `APPROVED`, derived from
     * `current` existing.
     */
    expect(stored.banner.status).toBeNull();
    expect(String(stored.banner.reviewedBy)).toBe(String(ADMIN_ID));
    expect(stored.banner.reviewedAt).toBeTruthy();
  });

  /**
   * ⚠️ Both halves, and the second one is why this test exists.
   *
   * A mutation run found the first version of this asserting only the delete —
   * so a change that kept the **old** banner in `current` (and cleared the
   * pending one) passed: the file was still deleted, and nothing checked that
   * the voucher had actually moved to the new artwork. That is the worst
   * possible outcome of an approval, and it was invisible.
   */
  test("the replacement takes over, and only the old file is deleted", async () => {
    const { voucher } = await seedVoucher({
      current: media("old"),
      ...pendingBanner,
    });

    await reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" });

    const stored = await reload(voucher._id);
    expect(stored.banner.current.storage.key).toBe("banners/new.webp");
    expect(stored.banner.pending).toBeUndefined();

    expect(deleteVoucherBannerMedia).toHaveBeenCalledTimes(1);
    expect(deleteVoucherBannerMedia.mock.calls[0][0].storage.key).toBe(
      "banners/old.webp",
    );
  });

  test("the customer sees the replacement, not the one it replaced", async () => {
    const { voucher, version } = await seedVoucher({
      current: media("old"),
      ...pendingBanner,
    });

    await reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" });

    const stored = await reload(voucher._id);
    expect(pickVoucherBanner(stored.banner, version.images).bannerUrl).toBe(
      "https://example.test/new.webp",
    );
  });

  test("a first banner deletes nothing", async () => {
    const { voucher } = await seedVoucher(pendingBanner);

    await reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" });

    expect(deleteVoucherBannerMedia).not.toHaveBeenCalled();
  });

  test("the customer now sees the real banner, not the fallback", async () => {
    const { voucher, version } = await seedVoucher(pendingBanner);

    await reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" });

    const stored = await reload(voucher._id);
    const shown = pickVoucherBanner(stored.banner, version.images);

    expect(shown.bannerUrl).toBe("https://example.test/new.webp");
    expect(shown.bannerIsFallback).toBe(false);
    expect(shown.bannerStatus).toBe("APPROVED");
  });

  test("a reason is refused on an approval", async () => {
    const { voucher } = await seedVoucher(pendingBanner);

    // The service takes what the validator lets through; this is the service's
    // own half of the same rule.
    const error = await attempt(() =>
      reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "MAYBE" }),
    );

    expect(error).toMatchObject({ statusCode: 400 });
  });
});

describe("rejecting a banner", () => {
  const rejectIt = (voucherId, reason = "Text is unreadable at card size.") =>
    reviewVoucherBanner(ADMIN_ID, voucherId, {
      action: "REJECTED",
      rejectionReason: reason,
    });

  test("the file stays, with its reason beside it", async () => {
    const { voucher } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    await rejectIt(voucher._id);

    const stored = await reload(voucher._id);
    expect(stored.banner.pending.storage.key).toBe("banners/new.webp");
    expect(stored.banner.status).toBe("REJECTED");
    expect(stored.banner.rejectionReason).toBe(
      "Text is unreadable at card size.",
    );
    // 🔴 Nothing is deleted — the vendor is about to look at it.
    expect(deleteVoucherBannerMedia).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The point of the whole fallback. A rejected banner must not take a live
   * offer down with it.
   */
  test("the voucher's own status is untouched", async () => {
    const { voucher } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });
    await Voucher.updateOne(
      { _id: voucher._id },
      { $set: { status: VOUCHER_STATUSES.PUBLISHED } },
    );

    await rejectIt(voucher._id);

    expect((await reload(voucher._id)).status).toBe(VOUCHER_STATUSES.PUBLISHED);
  });

  test("an approved banner already live keeps serving customers", async () => {
    const { voucher, version } = await seedVoucher({
      current: media("live"),
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    await rejectIt(voucher._id);

    const stored = await reload(voucher._id);
    const shown = pickVoucherBanner(stored.banner, version.images);

    expect(shown.bannerUrl).toBe("https://example.test/live.webp");
    expect(shown.bannerIsFallback).toBe(false);
  });

  test("with no live banner, the customer falls back to the first image", async () => {
    const { voucher, version } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    await rejectIt(voucher._id);

    const stored = await reload(voucher._id);
    const shown = pickVoucherBanner(stored.banner, version.images);

    expect(shown.bannerUrl).toBe("https://example.test/img1.webp");
    expect(shown.bannerIsFallback).toBe(true);
    expect(shown.bannerStatus).toBe("REJECTED");
  });

  test("a rejection with no reason is refused", async () => {
    const { voucher } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    expect(
      await attempt(() =>
        reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "REJECTED" }),
      ),
    ).toMatchObject({
      statusCode: 400,
      message: "A reason is required when rejecting a banner.",
    });
  });
});

describe("a review that has nothing to review", () => {
  test("a voucher with no banner at all is a 409", async () => {
    const { voucher } = await seedVoucher();

    expect(
      await attempt(() =>
        reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" }),
      ),
    ).toMatchObject({
      statusCode: 409,
      message: "This voucher has no banner waiting for review.",
    });
  });

  /**
   * ⚠️ A stale queue row. An admin who clicks approve on something already
   * decided should be told the row is stale, not have it silently re-decided.
   */
  test("a banner already reviewed is a 409 that names its state", async () => {
    const { voucher } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.REJECTED,
      rejectionReason: "Too dark.",
    });

    expect(
      await attempt(() =>
        reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" }),
      ),
    ).toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("REJECTED"),
    });
  });

  test("a voucher whose banner is live has nothing pending", async () => {
    const { voucher } = await seedVoucher({ current: media("live") });

    expect(
      await attempt(() =>
        reviewVoucherBanner(ADMIN_ID, voucher._id, { action: "APPROVED" }),
      ),
    ).toMatchObject({ statusCode: 409 });
  });
});

/**
 * 🔴 V-2 — a banner is required to **submit**, and deliberately not to publish.
 *
 * Submit is the moment a vendor hands the voucher over, so it is where "you have
 * not given us a banner" is useful. Gating publish on it instead would hold a
 * finished, approved voucher hostage to a decision about its artwork — which is
 * exactly what the `images[0]` fallback exists to avoid.
 */
describe("submit-for-review needs a banner", () => {
  test("a voucher with no banner cannot be submitted", async () => {
    const { voucher, userId } = await seedVoucher();

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("needs a banner"),
    });
  });

  test("a pending banner is enough — it does not have to be approved yet", async () => {
    const { voucher, userId } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toBeNull();
  });

  test("an already-approved banner is enough too", async () => {
    const { voucher, userId } = await seedVoucher({ current: media("live") });

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toBeNull();
  });

  test("a rejected banner still counts — the file is there to fix", async () => {
    const { voucher, userId } = await seedVoucher({
      pending: media("new"),
      status: VOUCHER_BANNER_STATUS.REJECTED,
      rejectionReason: "Too dark.",
    });

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toBeNull();
  });
});
