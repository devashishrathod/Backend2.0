/**
 * Brand features — who may write them, and three things that answered wrongly.
 *
 * ### 🔴 Why this file exists
 *
 * `POST/PUT/DELETE /brandFeatures/*` were gated by `isVendorOrAdmin` and nothing
 * else. That gate establishes the caller is *a* vendor; it says nothing about
 * *which* brand. `brandId` arrived in the body on create, and update and delete
 * found the record by `featureId` alone — so any vendor could add features to
 * any brand, edit any brand's features, and delete them. Replacing or deleting
 * an icon destroys the stored asset, so the damage outlived the record.
 *
 * `middlewares/validateRoles.js` already says this in words: "Ownership within
 * the brand is still the service's job — `helpers/brands/resolveActorBrand.js`".
 * These three services were the ones not doing it.
 *
 * Two more failures in the same file, both silent in the way that matters:
 *
 *  - `throwError` was called on three lines of `updateBrandFeature.js` and
 *    imported on none, so each raised `ReferenceError: throwError is not
 *    defined`. A missing feature answered **500 instead of 404**, and the
 *    ten-active limit could not report itself — a vendor at the cap got an
 *    unexplained server error rather than being told the limit.
 *
 *  - `if (isActive)` is falsy for the boolean `false`, so turning a feature
 *    **off** was accepted, answered "updated successfully", and changed nothing.
 *    It appeared to work from the panel only because a multipart form sends the
 *    string `"false"`, which is truthy.
 *
 * ⚠️ Real database. Ownership is read back off the `Brand` document rather than
 * trusted from the token, and the ten-active rule is a `countDocuments` against
 * a filter — mocking either would assert the shape of a query instead of what
 * Mongo does with it.
 *
 * The storage provider **is** mocked. Nothing here should reach Cloudinary, and
 * the ownership checks all run before any upload, so the refusals would not hit
 * it either way.
 */

jest.mock("../../services/storage", () => ({
  /**
   * ⚠️ `metadata` is part of the contract, not decoration.
   *
   * 🔴 This returned `{ url, storage }` only, and went stale the day
   * `toMediaDocument` landed (M-1): it derives `kind` from `metadata.mimeType`
   * and **throws** rather than guessing, so every brand-feature write failed
   * here with "Cannot store media: no kind". The real facade always fills
   * `metadata` — both providers build it from `originalFile`.
   */
  uploadFromPath: jest.fn(async ({ originalFile } = {}) => ({
    url: "https://example.test/icons/uploaded.png",
    storage: { provider: "CLOUDINARY", publicId: "Images/uploaded" },
    metadata: {
      originalName: originalFile?.name ?? null,
      mimeType: originalFile?.mimetype ?? "image/png",
      size: 1024,
      width: null,
      height: null,
      duration: 0,
    },
  })),
  deleteAsset: jest.fn(async () => true),
  deleteAssets: jest.fn(async () => ({ deleted: 0, failed: 0 })),
}));

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Brand = require("../../models/Brand");
const BrandFeatures = require("../../models/BrandFeatures");
const { ROLES } = require("../../constants");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  addBrandFeature,
  updateBrandFeature,
  deleteBrandFeature,
} = require("../../services/brandFeatures");
const { uploadFromPath, deleteAsset } = require("../../services/storage");

const oid = () => new mongoose.Types.ObjectId();

/**
 * ⚠️ `Brand.merchantId` is validated against `TM-XXXX-XXXX-XXXX` over a charset
 * from `MERCHANT_ID_SECRET`, so a hand-written string fails validation. Uses the
 * real generator, which also stays correct if the format changes.
 */
const seedBrand = async (ownerUserId) =>
  Brand.create({
    brandName: "fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

const seedFeature = (brandId, overrides = {}) =>
  BrandFeatures.create({
    brandId,
    title: "Free parking",
    icon: "https://example.test/icons/existing.png",
    ...overrides,
  });

/** What the controller builds from `req`. */
const vendorActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});
const adminActor = () => ({ userId: oid(), role: ROLES.ADMIN });

/**
 * ⚠️ `mimetype` is load-bearing now, not decoration.
 *
 * `addBrandFeature` / `updateBrandFeature` run `assertImageFile` before they
 * upload anything, so a fixture without a content type is refused with a 422
 * — which is the correct answer to a file that does not say what it is. The
 * fixture was describing an upload that could not happen.
 */
const iconUpload = {
  tempFilePath: "/does/not/matter",
  name: "icon.png",
  mimetype: "image/png",
};

let OWNER;
let INTRUDER;
let BRAND;
let OTHER_BRAND;

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Brand, BrandFeatures);
  jest.clearAllMocks();

  OWNER = oid();
  INTRUDER = oid();
  BRAND = await seedBrand(OWNER);
  OTHER_BRAND = await seedBrand(INTRUDER);
});

describe("who may write a brand's features", () => {
  it("refuses a vendor naming someone else's brand on create", async () => {
    await expect(
      addBrandFeature(
        vendorActor(INTRUDER, OTHER_BRAND._id),
        { brandId: BRAND._id.toString(), title: "Injected" },
        iconUpload,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(await BrandFeatures.countDocuments({ brandId: BRAND._id })).toBe(0);
  });

  /**
   * The refusal must land before the upload, or a rejected call still costs a
   * stored object that nothing will ever reference or delete.
   */
  it("refuses before anything is uploaded", async () => {
    await expect(
      addBrandFeature(
        vendorActor(INTRUDER, OTHER_BRAND._id),
        { brandId: BRAND._id.toString(), title: "Injected" },
        iconUpload,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(uploadFromPath).not.toHaveBeenCalled();
  });

  it("lets the owner create on their own brand", async () => {
    const feature = await addBrandFeature(
      vendorActor(OWNER, BRAND._id),
      { brandId: BRAND._id.toString(), title: "Free parking" },
      iconUpload,
    );

    expect(String(feature.brandId)).toBe(String(BRAND._id));
    expect(feature.icon).toBe("https://example.test/icons/uploaded.png");
  });

  it("lets an admin create on any brand", async () => {
    const feature = await addBrandFeature(
      adminActor(),
      { brandId: BRAND._id.toString(), title: "Admin added" },
      iconUpload,
    );

    expect(String(feature.brandId)).toBe(String(BRAND._id));
  });

  it("refuses a vendor editing someone else's feature", async () => {
    const feature = await seedFeature(BRAND._id);

    await expect(
      updateBrandFeature(vendorActor(INTRUDER, OTHER_BRAND._id), {
        featureId: feature._id.toString(),
        title: "Defaced",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const unchanged = await BrandFeatures.findById(feature._id);
    expect(unchanged.title).toBe("Free parking");
  });

  /**
   * The expensive half: replacing an icon deletes the previous one, so a
   * refusal that arrived late would still have destroyed another brand's asset.
   */
  it("refuses an icon replacement on someone else's feature without touching storage", async () => {
    const feature = await seedFeature(BRAND._id);

    await expect(
      updateBrandFeature(
        vendorActor(INTRUDER, OTHER_BRAND._id),
        { featureId: feature._id.toString() },
        iconUpload,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(uploadFromPath).not.toHaveBeenCalled();
    expect(deleteAsset).not.toHaveBeenCalled();
    expect((await BrandFeatures.findById(feature._id)).icon).toBe(
      "https://example.test/icons/existing.png",
    );
  });

  it("refuses a vendor deleting someone else's feature, and keeps the icon", async () => {
    const feature = await seedFeature(BRAND._id);

    await expect(
      deleteBrandFeature(
        vendorActor(INTRUDER, OTHER_BRAND._id),
        feature._id.toString(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(deleteAsset).not.toHaveBeenCalled();
    expect((await BrandFeatures.findById(feature._id)).isDeleted).toBe(false);
  });

  it("lets the owner delete their own feature", async () => {
    const feature = await seedFeature(BRAND._id);

    await deleteBrandFeature(
      vendorActor(OWNER, BRAND._id),
      feature._id.toString(),
    );

    const removed = await BrandFeatures.findById(feature._id);
    expect(removed.isDeleted).toBe(true);
    expect(removed.isActive).toBe(false);
    expect(deleteAsset).toHaveBeenCalledWith({
      url: "https://example.test/icons/existing.png",
    });
  });
});

describe("errors that used to be a ReferenceError", () => {
  /**
   * `throwError` was not in scope, so this raised `ReferenceError` and the
   * handler turned it into a 500 with no `statusCode` at all.
   */
  it("answers 404 for a feature that does not exist", async () => {
    await expect(
      updateBrandFeature(vendorActor(OWNER, BRAND._id), {
        featureId: oid().toString(),
        title: "Nothing here",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Brand feature not found!",
    });
  });

  /**
   * The same missing import broke the one message a vendor at the cap needs:
   * they were told the server had failed, not that ten is the limit.
   */
  it("answers 400 with the limit when a brand already has ten active", async () => {
    for (let i = 0; i < 10; i++) {
      await seedFeature(BRAND._id, { title: `Active ${i}`, isActive: true });
    }
    const dormant = await seedFeature(BRAND._id, {
      title: "Eleventh",
      isActive: false,
    });

    await expect(
      updateBrandFeature(vendorActor(OWNER, BRAND._id), {
        featureId: dormant._id.toString(),
        isActive: true,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "A brand can have maximum 10 active features!",
    });
  });
});

describe("turning a feature off", () => {
  /**
   * ⚠️ `if (isActive)` is falsy for `false`, so this wrote nothing and still
   * answered "updated successfully". The vendor toggles the switch, sees the
   * success, and the feature is still on their public profile.
   */
  it("accepts the boolean false", async () => {
    const feature = await seedFeature(BRAND._id, { isActive: true });

    const updated = await updateBrandFeature(vendorActor(OWNER, BRAND._id), {
      featureId: feature._id.toString(),
      isActive: false,
    });

    expect(updated.isActive).toBe(false);
    expect((await BrandFeatures.findById(feature._id)).isActive).toBe(false);
  });

  /** A multipart form sends strings; both spellings must mean the same thing. */
  it('accepts the string "false"', async () => {
    const feature = await seedFeature(BRAND._id, { isActive: true });

    await updateBrandFeature(vendorActor(OWNER, BRAND._id), {
      featureId: feature._id.toString(),
      isActive: "false",
    });

    expect((await BrandFeatures.findById(feature._id)).isActive).toBe(false);
  });

  it("leaves the flag alone when it is not sent", async () => {
    const feature = await seedFeature(BRAND._id, { isActive: true });

    await updateBrandFeature(vendorActor(OWNER, BRAND._id), {
      featureId: feature._id.toString(),
      title: "Renamed",
    });

    const after = await BrandFeatures.findById(feature._id);
    expect(after.isActive).toBe(true);
    expect(after.title).toBe("Renamed");
  });
});
