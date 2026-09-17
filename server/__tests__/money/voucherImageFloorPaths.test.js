/**
 * V-2 — the image floor on the three paths that actually enforce it (P13).
 *
 * ### 🔴 Why a real database
 *
 * The rule is the same in all three places; what differs is **what is being
 * counted**, and that only exists once there is a stored voucher:
 *
 *   create   — files in this request, before anything is uploaded
 *   edit     — what the merge LEAVES BEHIND, kept minus removed plus added
 *   submit   — the version's stored images, however many requests built it
 *
 * The middle one is the reason a unit test of the helper is not enough. A vendor
 * removing three of four images uploads nothing at all, so a check on "the files
 * that arrived" sees zero files and a perfectly valid request. Only the merged
 * result is the answer, and the merge runs against a stored version.
 *
 * `submitVoucherForReview` also runs inside a transaction against real
 * documents, which no mock reproduces.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
  writeSetting,
} = require("./setup/testDb");

/**
 * The gates in front of create and edit — plan, slot, storage — each have their
 * own tests. Standing them up here would put a subscription fixture and an S3
 * call in front of every assertion about a number.
 *
 * ⚠️ Mocked at the modules they live in, never with `jest.spyOn` on a barrel:
 * `helpers/brands/index.js` destructures at load, so a spy on the export is
 * never seen. That trap cost an afternoon in S-1.
 */
jest.mock("../../helpers/brands/resolveActorBrand", () => ({
  resolveActorBrand: jest.fn(),
}));
jest.mock("../../helpers/subscribeds/assertActiveSubscription", () => ({
  assertActiveSubscription: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../helpers/brands/entitlementSlots", () => ({
  ...jest.requireActual("../../helpers/brands/entitlementSlots"),
  reserveSlot: jest.fn().mockResolvedValue(undefined),
  releaseSlot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../helpers/vouchers/validateImagesFiles", () => ({
  ...jest.requireActual("../../helpers/vouchers/validateImagesFiles"),
  uploadVoucherImages: jest.fn(),
  rollbackVoucherImages: jest.fn().mockResolvedValue(undefined),
}));

/**
 * ⚠️ Outlet resolution is mocked for the same reason, and it matters more than
 * it looks: in `createVoucher` it runs **before** the image floor, so a fixture
 * with an unresolvable outlet fails on "One or more SubBrands are invalid"
 * and the image assertion never runs. A test that fails for the wrong reason is
 * worse than no test — it sends the next person after images when the fixture
 * was the problem.
 */
jest.mock("../../helpers/vouchers/validate", () => ({
  ...jest.requireActual("../../helpers/vouchers/validate"),
  validateVoucherSubBrands: jest.fn().mockResolvedValue([]),
}));

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const Brand = require("../../models/Brand");
const Setting = require("../../models/Setting");

const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");
const {
  submitVoucherForReview,
} = require("../../services/vouchers/submitVoucherForReview");
const {
  validateVoucherForApproval,
} = require("../../helpers/vouchers/validate");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const { createVoucher } = require("../../services/vouchers/createVoucher");
const { updateVoucher } = require("../../services/vouchers/updateVoucher");
const {
  resolveActorBrand,
} = require("../../helpers/brands/resolveActorBrand");
const {
  uploadVoucherImages,
} = require("../../helpers/vouchers/validateImagesFiles");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

/**
 * ⚠️ `VCH-00000001`, not a timestamp string. `voucherCode` is format-validated
 * on the schema, so an invented value fails on the wrong rule — and a test that
 * fails for the wrong reason is worse than no test, because the next person
 * spends the afternoon on images.
 */
const nextVoucherCode = () => `VCH-${String(++seq).padStart(8, "0")}`;

const image = (index) => ({
  media: { url: `https://example.test/v${index}.webp`, kind: "IMAGE" },
  sortOrder: index,
});

const offer = {
  title: "flat 10%",
  minBillAmount: 100,
  discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
  discountValue: 10,
  sortOrder: 1,
};

const daysFromNow = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/**
 * A DRAFT voucher with `imageCount` images, ready to submit.
 *
 * ⚠️ A real `Brand` and a real `VoucherSubBrand`, because
 * `validateVoucherBeforeSubmit` counts outlets too — a fixture without one fails
 * on the wrong rule and the test would pass for the wrong reason.
 */
const draftVoucher = async (imageCount) => {
  const userId = oid();
  const brand = await Brand.create({
    brandName: "floor fixture brand",
    uniqueId: `TDB${Date.now()}${seq}${Math.floor(Math.random() * 10000)}`,
    userId,
    // ⚠️ The real generator — `merchantId` has a checksum the schema validates,
    // so a made-up string fails on the wrong rule and the test passes or fails
    // for a reason that has nothing to do with images.
    merchantId: await generateBrandMerchantId(),
  });

  const voucherCode = nextVoucherCode();
  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "floor voucher",
    normalizedName: "floor voucher",
    voucherCode,
    status: VOUCHER_STATUSES.DRAFT,
    /**
     * ⚠️ A banner, because submit-for-review now requires one (V-2). Without it
     * these fixtures fail on the banner rule — which is a real rule, but not the
     * one these tests are about, and a test that fails for the wrong reason
     * sends the next person after images.
     */
    banner: {
      pending: {
        url: "https://example.test/banner.webp",
        kind: "IMAGE",
        mimeType: "image/webp",
      },
      status: "PENDING",
    },
  });

  const version = await VoucherVersion.create({
    voucherId: voucher._id,
    brandId: brand._id,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "floor voucher",
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.DRAFT,
    startAt: daysFromNow(2),
    endAt: daysFromNow(60),
    images: Array.from({ length: imageCount }, (_, i) => image(i + 1)),
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
    /**
     * Required by the schema, and both are format-checked.
     *
     * ⚠️ `storeId` through the real generator: its charset comes from
     * `STORE_ID_SECRET`, so there is no literal that is valid across
     * environments — a hard-coded `TS-ABCD-…` passes here and fails on someone
     * else's machine.
     */
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

/** The thrown error, or `null` when it went through. */
const attempt = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
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
    VoucherApprovalHistory,
    VoucherSubBrand,
    Brand,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  jest.clearAllMocks();
  uploadVoucherImages.mockResolvedValue([]);
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherApprovalHistory,
    VoucherSubBrand,
    Brand,
    Setting,
  );
});

/** An uploaded file as `express-fileupload` hands it over. */
const uploadFile = (index) => ({
  name: `photo-${index}.jpg`,
  mimetype: "image/jpeg",
  size: 1024 * 1024,
  tempFilePath: `/tmp/photo-${index}.jpg`,
});

describe("create — refused before a single byte is uploaded", () => {
  const create = async (fileCount, brand) =>
    attempt(() =>
      createVoucher(
        { userId: brand.userId, role: ROLES.VENDOR, brandId: brand._id },
        {
          brandId: String(brand._id),
          name: "new voucher",
          categoryId: String(oid()),
          subCategoryId: String(oid()),
          startAt: daysFromNow(2).toISOString(),
          endAt: daysFromNow(60).toISOString(),
          offers: [offer],
          subBrandIds: [String(oid())],
        },
        {
          images: Array.from({ length: fileCount }, (_, i) => uploadFile(i + 1)),
        },
      ),
    );

  test("two files is refused, with the same sentence as everywhere else", async () => {
    const { brand } = await draftVoucher(3);
    resolveActorBrand.mockResolvedValue(brand);

    expect(await create(2, brand)).toMatchObject({
      statusCode: 422,
      message: "A voucher needs at least 3 images — this one has 2. Add 1 more.",
    });
  });

  /**
   * 🔴 The reason the check sits where it does. A vendor three images short
   * should hear about it while the picker is still open — not after waiting out
   * five uploads that are then rolled back.
   */
  test("nothing is uploaded when the floor is missed", async () => {
    const { brand } = await draftVoucher(3);
    resolveActorBrand.mockResolvedValue(brand);

    await create(1, brand);

    expect(uploadVoucherImages).not.toHaveBeenCalled();
  });

  test("no files at all is the same refusal, not a different one", async () => {
    const { brand } = await draftVoucher(3);
    resolveActorBrand.mockResolvedValue(brand);

    expect((await create(0, brand)).message).toBe(
      "A voucher needs at least 3 images — this one has none. Add 3 more.",
    );
  });

  test("the floor follows the configured number", async () => {
    await writeSetting({ $set: { "vendor.voucher.minImages": 2 } });
    const { brand } = await draftVoucher(3);
    resolveActorBrand.mockResolvedValue(brand);

    // Two is now enough, so the request gets past the floor and on to upload.
    await create(2, brand);

    expect(uploadVoucherImages).toHaveBeenCalled();
  });
});

describe("edit — the floor is on what the edit leaves behind", () => {
  /**
   * 🔴 The case a check on "files that arrived" cannot see.
   *
   * A vendor removing images uploads **nothing**, so a request carrying zero
   * files is perfectly valid on its face. Only the merged result — kept minus
   * removed plus added — answers the question.
   */
  test("removing down to two of four is refused", async () => {
    const fixture = await draftVoucher(4);
    resolveActorBrand.mockResolvedValue(fixture.brand);

    const stored = await VoucherVersion.findById(fixture.version._id).lean();
    const removeImageIds = stored.images.slice(0, 2).map((i) => String(i._id));

    const error = await attempt(() =>
      updateVoucher(
        {
          userId: fixture.userId,
          role: ROLES.VENDOR,
          brandId: fixture.brand._id,
        },
        { voucherId: String(fixture.voucher._id), removeImageIds },
        undefined,
      ),
    );

    expect(error).toMatchObject({
      statusCode: 422,
      message: "A voucher needs at least 3 images — this one has 2. Add 1 more.",
    });
  });

  test("a refused edit removes nothing", async () => {
    const fixture = await draftVoucher(4);
    resolveActorBrand.mockResolvedValue(fixture.brand);

    const stored = await VoucherVersion.findById(fixture.version._id).lean();
    const removeImageIds = stored.images.slice(0, 3).map((i) => String(i._id));

    await attempt(() =>
      updateVoucher(
        {
          userId: fixture.userId,
          role: ROLES.VENDOR,
          brandId: fixture.brand._id,
        },
        { voucherId: String(fixture.voucher._id), removeImageIds },
        undefined,
      ),
    );

    const after = await VoucherVersion.findById(fixture.version._id).lean();
    expect(after.images).toHaveLength(4);
  });

  test("removing down to exactly the floor is allowed", async () => {
    const fixture = await draftVoucher(4);
    resolveActorBrand.mockResolvedValue(fixture.brand);

    const stored = await VoucherVersion.findById(fixture.version._id).lean();
    const removeImageIds = [String(stored.images[0]._id)];

    expect(
      await attempt(() =>
        updateVoucher(
          {
            userId: fixture.userId,
            role: ROLES.VENDOR,
            brandId: fixture.brand._id,
          },
          { voucherId: String(fixture.voucher._id), removeImageIds },
          {},
        ),
      ),
    ).toBeNull();
  });
});

describe("submit for review — the last gate before an admin sees it", () => {
  test("three images goes through", async () => {
    const { voucher, userId } = await draftVoucher(3);

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toBeNull();

    const stored = await Voucher.findById(voucher._id).lean();
    expect(stored.status).toBe(VOUCHER_STATUSES.UNDER_REVIEW);
  });

  /**
   * 🔴 The line this replaces read `if (imageCount === 0)` — blind to
   * `minImages` entirely, so a platform configured for three would have sent a
   * one-image voucher to an admin's queue.
   */
  test("two images is refused, and told exactly what to do", async () => {
    const { voucher, userId } = await draftVoucher(2);

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toMatchObject({
      statusCode: 422,
      message: "A voucher needs at least 3 images — this one has 2. Add 1 more.",
    });
  });

  test("a refused submit leaves the voucher in DRAFT", async () => {
    const { voucher, userId } = await draftVoucher(1);

    await attempt(() => submitVoucherForReview(userId, voucher._id));

    const stored = await Voucher.findById(voucher._id).lean();
    expect(stored.status).toBe(VOUCHER_STATUSES.DRAFT);
  });

  test("the floor follows the configured number", async () => {
    await writeSetting({ $set: { "vendor.voucher.minImages": 5 } });
    const { voucher, userId } = await draftVoucher(4);

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toMatchObject({
      message: "A voucher needs at least 5 images — this one has 4. Add 1 more.",
    });
  });

  test("lowering the floor lets the same voucher through", async () => {
    await writeSetting({ $set: { "vendor.voucher.minImages": 2 } });
    const { voucher, userId } = await draftVoucher(2);

    expect(
      await attempt(() => submitVoucherForReview(userId, voucher._id)),
    ).toBeNull();
  });
});

/**
 * 🔴 The exemption, and why it is not an oversight.
 *
 * An admin raising `minImages` between a vendor's submit and their own approval
 * would otherwise find the queue full of vouchers they cannot approve and the
 * vendor cannot fix — the voucher was already sent, so there is no request left
 * that would add images to it. That is a voucher retired from behind, which is
 * precisely the shape `minImages` was designed to avoid.
 */
describe("approval is held to the structural floor, not the configured one", () => {
  /**
   * ⚠️ The **version** has to be UNDER_REVIEW too, not only the voucher — the
   * approval path checks both, and a DRAFT version is refused before it ever
   * reaches the image count. Submitting for real is what puts it there.
   */
  const underReview = async (imageCount) => {
    const fixture = await draftVoucher(imageCount);
    await VoucherVersion.updateOne(
      { _id: fixture.version._id },
      { $set: { status: VOUCHER_STATUSES.UNDER_REVIEW } },
    );
    return fixture;
  };

  const approve = (version, config = { maxOffers: 10, maxImages: 5 }) =>
    attempt(() =>
      validateVoucherForApproval(
        { status: VOUCHER_STATUSES.UNDER_REVIEW },
        version,
        config,
        null,
      ),
    );

  test("a two-image voucher can still be approved when the floor is three", async () => {
    const { version } = await underReview(2);
    const stored = await VoucherVersion.findById(version._id).lean();

    expect(await approve(stored)).toBeNull();
  });

  test("a voucher raised past the floor after submit is still approvable", async () => {
    await writeSetting({ $set: { "vendor.voucher.minImages": 9 } });
    const { version } = await underReview(3);
    const stored = await VoucherVersion.findById(version._id).lean();

    expect(await approve(stored)).toBeNull();
  });

  /** Zero is corruption, not a policy change — that one still stops. */
  test("a voucher with no images at all is refused", async () => {
    const { version } = await underReview(3);
    await VoucherVersion.updateOne(
      { _id: version._id },
      { $set: { images: [] } },
    );
    const stored = await VoucherVersion.findById(version._id).lean();

    expect(await approve(stored)).toMatchObject({
      statusCode: 400,
      message: "At least one voucher image is required.",
    });
  });
});
