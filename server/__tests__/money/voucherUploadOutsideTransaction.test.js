/**
 * V-3 (P3) — the uploads run with no transaction open.
 *
 * ### 🔴 What this was
 *
 * A voucher carries up to five images and a banner that may be a **video**, and
 * every one of those bytes went to S3 with a Mongo transaction already open. A
 * transaction holds its locks for its whole life and the server aborts it at
 * `transactionLifetimeLimitSeconds` — 60 by default. So a vendor on a slow
 * connection did not get a slow request: they got a create that ran for a
 * minute, uploaded everything, and then failed at commit with an error about a
 * transaction, having already paid for the storage.
 *
 * ### ⚠️ How this is proved, and why not the obvious way
 *
 * A timing test — "it finishes in under 60 seconds" — would pass on a fast
 * machine whether or not the bug is there, which makes it a test of the machine.
 *
 * The claim is about a **session's state at one moment**: while bytes are
 * moving, is a transaction open? So the test captures the session the service
 * itself opens (by spying on `mongoose.startSession`) and asks it that question
 * from inside the upload. Only a real session has an answer.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

/** Gates with their own tests; here they would only add fixtures. */
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
jest.mock("../../helpers/vouchers/validate", () => ({
  ...jest.requireActual("../../helpers/vouchers/validate"),
  validateVoucherCategory: jest.fn().mockResolvedValue(null),
  validateVoucherSubCategory: jest.fn().mockResolvedValue(null),
  validateVoucherSubBrands: jest.fn(),
}));
jest.mock("../../helpers/vouchers/validateImagesFiles", () => ({
  ...jest.requireActual("../../helpers/vouchers/validateImagesFiles"),
  uploadVoucherImages: jest.fn(),
  rollbackVoucherImages: jest.fn().mockResolvedValue(undefined),
}));

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const Brand = require("../../models/Brand");
const Setting = require("../../models/Setting");

const {
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_STATUSES,
} = require("../../constants/voucher");
const { ROLES } = require("../../constants");
// ⚠️ The constant, not the string "S3" — the enum value is AWS_S3.
const { STORAGE_PROVIDER } = require("../../constants/storage");
const { createVoucher } = require("../../services/vouchers/createVoucher");
const { updateVoucher } = require("../../services/vouchers/updateVoucher");
const {
  resolveActorBrand,
} = require("../../helpers/brands/resolveActorBrand");
const {
  validateVoucherSubBrands,
} = require("../../helpers/vouchers/validate");
const {
  uploadVoucherImages,
  rollbackVoucherImages,
} = require("../../helpers/vouchers/validateImagesFiles");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const nextVoucherCode = () => `VCH-${String(++seq).padStart(8, "0")}`;
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const offer = {
  title: "flat 10%",
  minBillAmount: 100,
  discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
  discountValue: 10,
  sortOrder: 1,
};

const uploadFile = (index) => ({
  name: `photo-${index}.jpg`,
  mimetype: "image/jpeg",
  size: 512 * 1024,
  tempFilePath: `/tmp/photo-${index}.jpg`,
});

const storedImage = (index) => ({
  media: { url: `https://example.test/v${index}.webp`, kind: "IMAGE" },
  sortOrder: index,
});

/**
 * Every session the code under test opens.
 *
 * ⚠️ The spy wraps the real `startSession` rather than replacing it — the
 * service needs a working session for the transaction it opens afterwards, and
 * a fake one would make the second half of each test meaningless.
 *
 * ⚠️ And it is `mongoose.startSession`, not a destructured copy: the services
 * call it as a property (`mongoose.startSession()`), so the spy is seen. A
 * service that had destructured it at load would hold its own reference and the
 * spy would do nothing — the same shape as the `getSetting` trap in S-1.
 */
const sessions = [];
/** What `inTransaction()` said on each session, each time an upload ran. */
const stateAtUpload = [];

let startSessionSpy;

beforeAll(async () => {
  await connectTestDb();
  await Voucher.createIndexes();
  await VoucherVersion.createIndexes();

  const real = mongoose.startSession.bind(mongoose);
  startSessionSpy = jest
    .spyOn(mongoose, "startSession")
    .mockImplementation(async (...args) => {
      const session = await real(...args);
      sessions.push(session);
      return session;
    });
});

afterAll(async () => {
  startSessionSpy.mockRestore();
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherSubBrand,
    Brand,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  jest.clearAllMocks();
  sessions.length = 0;
  stateAtUpload.length = 0;

  validateVoucherSubBrands.mockResolvedValue([]);
  uploadVoucherImages.mockImplementation(async (files = []) => {
    // 🔴 The assertion's raw material: the state of every open session at the
    // exact moment bytes would be moving.
    stateAtUpload.push(sessions.map((session) => session.inTransaction()));
    return files.map((_, index) => ({
      url: `https://example.test/u${index}.webp`,
      kind: "IMAGE",
    }));
  });

  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherSubBrand,
    Brand,
    Setting,
  );
});

const seedBrand = async () => {
  const userId = oid();
  const brand = await Brand.create({
    brandName: "upload fixture brand",
    uniqueId: `TDB${Date.now()}${++seq}${Math.floor(Math.random() * 10000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
    categoryId: oid(),
    subCategoryId: oid(),
  });
  resolveActorBrand.mockResolvedValue(brand);
  return { brand, userId };
};

const createPayload = (brand) => ({
  brandId: String(brand._id),
  name: `voucher ${++seq}`,
  startAt: daysFromNow(2).toISOString(),
  endAt: daysFromNow(60).toISOString(),
  offers: [offer],
  subBrandIds: [String(oid())],
});

/** The thrown error, or `null`. */
const attempt = async (run) => {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
};

describe("createVoucher", () => {
  test("no transaction is open while the images upload", async () => {
    const { brand, userId } = await seedBrand();

    const error = await attempt(() =>
      createVoucher(
        { userId, role: ROLES.VENDOR, brandId: brand._id },
        createPayload(brand),
        { images: [uploadFile(1), uploadFile(2), uploadFile(3)] },
      ),
    );

    expect(error).toBeNull();
    expect(stateAtUpload).toHaveLength(1);
    // 🔴 The whole phase, in one line.
    expect(stateAtUpload[0]).not.toContain(true);
  });

  test("the transaction does open — afterwards, for the writes", async () => {
    const { brand, userId } = await seedBrand();

    await createVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      createPayload(brand),
      { images: [uploadFile(1), uploadFile(2), uploadFile(3)] },
    );

    // A session was opened, and the voucher landed — so the writes were
    // transactional even though the upload was not.
    expect(sessions.length).toBeGreaterThan(0);
    expect(await Voucher.countDocuments({ brandId: brand._id })).toBe(1);
    expect(await VoucherVersion.countDocuments({ brandId: brand._id })).toBe(1);
  });

  /**
   * ⚠️ Most failures now happen before the transaction starts, so the catch has
   * to guard `abortTransaction()`. Without the guard, aborting a session that
   * never began one throws — and that error replaces the real one, so the vendor
   * is told about a transaction instead of their voucher.
   */
  test("a failure before the transaction still reports its own reason", async () => {
    const { brand, userId } = await seedBrand();

    const error = await attempt(() =>
      createVoucher(
        { userId, role: ROLES.VENDOR, brandId: brand._id },
        createPayload(brand),
        { images: [uploadFile(1)] },
      ),
    );

    expect(error).toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("at least 3 images"),
    });
    expect(error.message).not.toMatch(/transaction/i);
  });

  test("an upload failure is reported as itself, not as a transaction error", async () => {
    const { brand, userId } = await seedBrand();
    uploadVoucherImages.mockRejectedValueOnce(
      Object.assign(new Error("Failed to upload voucher images."), {
        statusCode: 500,
      }),
    );

    const error = await attempt(() =>
      createVoucher(
        { userId, role: ROLES.VENDOR, brandId: brand._id },
        createPayload(brand),
        { images: [uploadFile(1), uploadFile(2), uploadFile(3)] },
      ),
    );

    expect(error.message).toBe("Failed to upload voucher images.");
    // And nothing was written.
    expect(await Voucher.countDocuments({ brandId: brand._id })).toBe(0);
  });
});

describe("updateVoucher", () => {
  const seedVoucher = async (imageCount = 4) => {
    const { brand, userId } = await seedBrand();
    const voucherCode = nextVoucherCode();

    const voucher = await Voucher.create({
      createdBy: userId,
      brandId: brand._id,
      name: "edit me",
      normalizedName: `edit me ${seq}`,
      voucherCode,
    });

    const version = await VoucherVersion.create({
      voucherId: voucher._id,
      brandId: brand._id,
      createdBy: userId,
      categoryId: oid(),
      subCategoryId: oid(),
      name: "edit me",
      versionNumber: 1,
      versionCode: `${voucherCode}-V1`,
      startAt: daysFromNow(2),
      endAt: daysFromNow(60),
      images: Array.from({ length: imageCount }, (_, i) => storedImage(i + 1)),
      offers: [offer],
    });

    /**
     * ⚠️ A real outlet mapping. `mergeSubBrands` refuses an edit that would
     * leave the voucher with none, so a fixture without one fails on
     * "At least one SubBrand is required" — the wrong rule entirely, and the
     * next person goes looking at uploads.
     */
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

    return { brand, userId, voucher, version };
  };

  test("no transaction is open while the images upload", async () => {
    const { brand, userId, voucher } = await seedVoucher();

    const error = await attempt(() =>
      updateVoucher(
        { userId, role: ROLES.VENDOR, brandId: brand._id },
        { voucherId: String(voucher._id) },
        [uploadFile(1)],
      ),
    );

    expect(error).toBeNull();
    expect(stateAtUpload).toHaveLength(1);
    expect(stateAtUpload[0]).not.toContain(true);
  });

  test("an edit with no new images does not upload at all", async () => {
    const { brand, userId, voucher } = await seedVoucher();

    await updateVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      { voucherId: String(voucher._id), newTags: ["fresh"] },
      undefined,
    );

    expect(uploadVoucherImages).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 A-2 — the file a **published** voucher is still serving must survive an
 * edit to the draft that forked from it.
 *
 * Editing a published version forks a new draft, and the fork copies every kept
 * image across **as it is** — `storage` and all. Two version documents then
 * point at one object in S3:
 *
 *     v1 PUBLISHED   images[0].storage.key = …/vouchers/v1/abc.webp
 *     v2 DRAFT       images[0].storage.key = …/vouchers/v1/abc.webp   ← same file
 *
 * The fork knows this and never deletes. But the **next** edit to that draft is
 * an ordinary update, and an ordinary update deletes what the vendor removed —
 * destroying the file the live voucher is serving, from a request that reported
 * success, with nothing anywhere to say why. `pickOrphanImages` is the guard.
 *
 * ### ⚠️ Why this test lives here and not at the unit level
 *
 * It was left out of A-2 for a stated reason: nothing exercised `updateVoucher`
 * at the service level, so a mutant that bypassed the orphan check was never
 * caught — a guard with no test over the path that uses it. This phase is
 * already driving `updateVoucher` against real documents, so the setup it needed
 * now exists.
 */
describe("A-2 — a forked draft cannot delete the live version's file", () => {
  const sharedImage = {
    media: {
      url: "https://example.test/shared.webp",
      kind: "IMAGE",
      storage: { provider: STORAGE_PROVIDER.AWS_S3, bucket: "test", key: "vouchers/v1/shared.webp" },
    },
    sortOrder: 1,
  };

  const publishedWithFork = async () => {
    const { brand, userId } = await seedBrand();
    const voucherCode = nextVoucherCode();

    const voucher = await Voucher.create({
      createdBy: userId,
      brandId: brand._id,
      name: "forked voucher",
      normalizedName: `forked voucher ${seq}`,
      voucherCode,
    });

    const common = {
      voucherId: voucher._id,
      brandId: brand._id,
      createdBy: userId,
      categoryId: oid(),
      subCategoryId: oid(),
      name: "forked voucher",
      startAt: daysFromNow(2),
      endAt: daysFromNow(60),
      offers: [offer],
    };

    // v1 — live, and serving the shared file.
    const published = await VoucherVersion.create({
      ...common,
      versionNumber: 1,
      versionCode: `${voucherCode}-V1`,
      status: VOUCHER_STATUSES.PUBLISHED,
      isImmutable: true,
      images: [sharedImage, storedImage(2), storedImage(3), storedImage(4)],
    });

    // v2 — the fork, pointing at the very same object.
    const draft = await VoucherVersion.create({
      ...common,
      versionNumber: 2,
      versionCode: `${voucherCode}-V2`,
      status: VOUCHER_STATUSES.DRAFT,
      isImmutable: false,
      images: [sharedImage, storedImage(2), storedImage(3), storedImage(4)],
    });

    await VoucherSubBrand.create({
      createdBy: userId,
      updatedBy: userId,
      voucherId: voucher._id,
      voucherVersionId: draft._id,
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
      {
        $set: {
          currentVersionId: draft._id,
          currentVersion: 2,
          publishedVersionId: published._id,
        },
      },
    );

    return { brand, userId, voucher, published, draft };
  };

  test("removing the shared image from the draft deletes nothing", async () => {
    const { brand, userId, voucher, draft } = await publishedWithFork();

    const stored = await VoucherVersion.findById(draft._id).lean();
    const shared = stored.images.find(
      (image) => image.media?.storage?.key === sharedImage.media.storage.key,
    );

    await updateVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      {
        voucherId: String(voucher._id),
        removeImageIds: [String(shared._id)],
      },
      undefined,
    );

    // 🔴 The whole point: the live version still points at it, so the object
    // must not be destroyed.
    expect(rollbackVoucherImages).not.toHaveBeenCalled();
  });

  test("the draft really did lose the image — the guard is not a no-op", async () => {
    const { brand, userId, voucher, draft, published } = await publishedWithFork();

    const stored = await VoucherVersion.findById(draft._id).lean();
    const shared = stored.images.find(
      (image) => image.media?.storage?.key === sharedImage.media.storage.key,
    );

    await updateVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      {
        voucherId: String(voucher._id),
        removeImageIds: [String(shared._id)],
      },
      undefined,
    );

    const survivingPublished = await VoucherVersion.findById(published._id).lean();
    const keys = (image) => image.media?.storage?.key;

    // The published version keeps it…
    expect(survivingPublished.images.map(keys)).toContain(
      sharedImage.media.storage.key,
    );
    // …and the edit produced a version that does not.
    const after = await Voucher.findById(voucher._id).lean();
    const current = await VoucherVersion.findById(after.currentVersionId).lean();
    expect(current.images.map(keys)).not.toContain(
      sharedImage.media.storage.key,
    );
  });

  /**
   * The other half of the same guard: a file **no** surviving version points at
   * is still deleted. Without this, "never delete anything" would pass the test
   * above and quietly leak every removed image.
   */
  test("an image no version still points at is deleted", async () => {
    const { brand, userId, voucher, draft } = await publishedWithFork();

    // Give the draft an image of its own, which the published version never had.
    const ownKey = "vouchers/v2/only-mine.webp";
    await VoucherVersion.updateOne(
      { _id: draft._id },
      {
        $push: {
          images: {
            media: {
              url: "https://example.test/only-mine.webp",
              kind: "IMAGE",
              storage: { provider: STORAGE_PROVIDER.AWS_S3, bucket: "test", key: ownKey },
            },
            sortOrder: 5,
          },
        },
      },
    );

    const stored = await VoucherVersion.findById(draft._id).lean();
    const own = stored.images.find((image) => image.media?.storage?.key === ownKey);

    await updateVoucher(
      { userId, role: ROLES.VENDOR, brandId: brand._id },
      { voucherId: String(voucher._id), removeImageIds: [String(own._id)] },
      undefined,
    );

    expect(rollbackVoucherImages).toHaveBeenCalledTimes(1);
    const [deleted] = rollbackVoucherImages.mock.calls[0];
    expect(deleted.map((image) => image.media?.storage?.key)).toEqual([ownKey]);
  });
});
