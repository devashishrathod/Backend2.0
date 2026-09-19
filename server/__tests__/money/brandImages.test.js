/**
 * A brand's logo and cover, an outlet's logo and cover, a category's image and
 * a section's pinned cover — the writes that never existed, and the storage
 * sibling that now records where each one landed.
 *
 * ### 🔴 Why this file exists
 *
 * `Brand.coverImage`, `SubBrand.logo` and `SubBrand.coverImage` were projected
 * by **eight** customer-facing read pipelines and written by nothing at all.
 * Every brand profile in the app asked for a cover and got `null`, for as long
 * as those fields have existed. `ShowcaseSection.coverImageMode: MANUAL` was
 * honoured by the sync helper and set by no endpoint, so a vendor could not
 * choose which picture represented a section.
 *
 * None of these four services had a single test before this file.
 *
 * ⚠️ The storage facade is mocked — nothing here should reach a provider. The
 * services are real, and so is the database: ownership, transactions and the
 * outlet counters are exactly the parts that a mock would hide.
 */

/**
 * ⚠️ `metadata` is part of the contract, not decoration.
 *
 * 🔴 This mock used to return `{ url, storage }` only, and it went stale the day
 * `toMediaDocument` landed (M-1): that helper derives `kind` from
 * `metadata.mimeType` and **throws** rather than guessing, so every service that
 * stores a media sibling failed here with "Cannot store media: no kind". The
 * real facade always fills `metadata` — both providers build it from
 * `originalFile` — so this was a mock that had stopped describing the thing it
 * stands in for, and nothing noticed because the money suite is not run per
 * phase.
 *
 * Deriving rather than defaulting is deliberate: a wrong `kind` decides the
 * object's prefix (`images/` vs `gifs/` vs `videos/`), which decides whether the
 * resize step flattens an animation, and nothing downstream would question it.
 */
jest.mock("../../services/storage", () => {
  let n = 0;
  return {
    uploadFromPath: jest.fn(async ({ originalFile } = {}) => {
      n += 1;
      return {
        url: `https://cdn.test/uploaded-${n}.webp`,
        storage: { provider: "AWS_S3", bucket: "b", key: `k-${n}` },
        metadata: {
          originalName: originalFile?.name ?? null,
          mimeType: originalFile?.mimetype ?? "image/webp",
          size: 1024,
          width: null,
          height: null,
          duration: 0,
        },
      };
    }),
    deleteAsset: jest.fn(async () => true),
    deleteAssets: jest.fn(async () => ({ deleted: 0, failed: 0 })),
    /**
     * ⚠️ The **real** facade (U-2), not a stub. Category now asks it for the
     * file instead of calling `uploadFromPath` itself, and a stub here would
     * quietly replace the one piece that decides which road a request took.
     * Its multipart road lands on the mock above, so nothing reaches S3.
     */
    ...jest.requireActual("../../services/storage/accept"),
    /**
     * ⚠️ The two halves the **presigned** road needs (U-5). The facade is real
     * here, so without these an `uploadId` would reach an undefined
     * `confirmUpload` — and the road this file now tests would be untestable in
     * it.
     */
    confirmUpload: jest.fn(async (actor, uploadId) => {
      n += 1;
      return {
        storage: { provider: "AWS_S3", bucket: "b", key: `confirmed-${n}` },
        metadata: {
          contentType: "image/png",
          kind: "IMAGE",
          sizeBytes: 1024,
          width: null,
          height: null,
        },
      };
    }),
    publicUrl: jest.fn(({ storage } = {}) => `https://cdn.test/${storage?.key}`),
  };
});

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const User = require("../../models/User");
const ShowcaseSection = require("../../models/ShowcaseSection");
const Category = require("../../models/Category");
const { ROLES, DEFAULT_IMAGES } = require("../../constants");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const { MEDIA_KIND, UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const { updateBrand } = require("../../services/brands");
const { updateSubBrand } = require("../../services/subBrands");
const { updateSection } = require("../../services/showcases");
const {
  createCategory,
  updateCategoryById,
  deleteCategoryById,
} = require("../../services/categories");
const {
  uploadFromPath,
  confirmUpload,
  deleteAsset,
} = require("../../services/storage");
const SubCategory = require("../../models/SubCategory");
const Upload = require("../../models/Upload");
const {
  updateSubCategoryById,
} = require("../../services/subCategories/updateSubCategoryById");
const { localFile, cleanup: cleanupFixtures } = require("../support/localFile");

afterAll(cleanupFixtures);

const { AUTO, MANUAL } = SHOWCASE_COVER_IMAGE_MODE;
const oid = () => new mongoose.Types.ObjectId();

/**
 * Categories are an admin surface, and the facade loads an upload intent by
 * id **and** owner — so it needs to know who is asking even on the multipart
 * road, where the answer happens not to be used.
 */
const admin = () => ({ userId: OWNER._id, role: ROLES.ADMIN });

/**
 * ⚠️ **Real** files now (G2). Both roads read the first kilobyte, so a fixture
 * has to be what it says it is — a made-up `tempFilePath` used to work only
 * because nothing on this road ever opened the file, which was the bug.
 */
const image = (name = "pic.png") => localFile("png", { name });

let OWNER;
let BRAND;

let seq = 0;

/**
 * ⚠️ A real `User` too, not just an id.
 *
 * `updateBrand` loads the brand's owner — it mirrors identity keys onto that
 * account — and answers 404 without one. A brand pointing at a user that does
 * not exist is not a state any real path produces.
 */
const seedOwner = () => {
  seq += 1;
  return User.create({
    uniqueId: `USR-IMG-${Date.now()}-${seq}`,
    name: "fixture vendor",
    email: `vendor${Date.now()}-${seq}@example.com`,
    mobile: `97000000${String(seq).padStart(2, "0")}`,
    role: ROLES.VENDOR,
    isActive: true,
  });
};

const seedBrand = async (ownerUserId) =>
  Brand.create({
    brandName: "fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

const vendorActor = (userId) => ({ userId, role: ROLES.VENDOR });
const adminActor = () => ({ userId: oid(), role: ROLES.ADMIN });

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

beforeEach(async () => {
  await clearCollections(
    Brand,
    SubBrand,
    User,
    ShowcaseSection,
    Category,
    SubCategory,
    Upload,
  );
  jest.clearAllMocks();
  OWNER = (await seedOwner())._id;
  BRAND = await seedBrand(OWNER);
});

describe("brand logo and cover", () => {
  test("both files land on their own fields", async () => {
    await updateBrand(
      BRAND._id,
      {},
      { logo: image("logo.png"), coverImage: image("cover.png") },
      vendorActor(OWNER),
    );

    const saved = await Brand.findById(BRAND._id);
    expect(saved.logo).toBeTruthy();
    expect(saved.coverImage).toBeTruthy();
    // 🔴 The whole point: two pictures, two fields, not one overwriting the other.
    expect(saved.coverImage).not.toBe(saved.logo);
    expect(uploadFromPath).toHaveBeenCalledTimes(2);
  });

  test("each goes up under its own purpose", async () => {
    await updateBrand(
      BRAND._id,
      {},
      { logo: image(), coverImage: image() },
      vendorActor(OWNER),
    );

    const purposes = uploadFromPath.mock.calls.map((c) => c[0].purpose);
    expect(purposes).toEqual(["BRAND_LOGO", "BRAND_COVER"]);
    // The key carries the brand id, so an object can be traced back to its row.
    for (const call of uploadFromPath.mock.calls) {
      expect(String(call[0].entityId)).toBe(String(BRAND._id));
    }
  });

  test("a cover alone does not disturb the logo", async () => {
    await updateBrand(BRAND._id, {}, { logo: image() }, vendorActor(OWNER));
    const afterLogo = (await Brand.findById(BRAND._id)).logo;

    jest.clearAllMocks();
    await updateBrand(BRAND._id, {}, { coverImage: image() }, vendorActor(OWNER));

    const saved = await Brand.findById(BRAND._id);
    expect(saved.logo).toBe(afterLogo);
    expect(saved.coverImage).toBeTruthy();
    expect(uploadFromPath).toHaveBeenCalledTimes(1);
  });

  test("replacing one deletes the picture it replaced, and only that", async () => {
    await updateBrand(
      BRAND._id,
      {},
      { logo: image(), coverImage: image() },
      vendorActor(OWNER),
    );
    const first = await Brand.findById(BRAND._id);

    jest.clearAllMocks();
    await updateBrand(BRAND._id, {}, { coverImage: image() }, vendorActor(OWNER));

    expect(deleteAsset).toHaveBeenCalledTimes(1);
    expect(deleteAsset).toHaveBeenCalledWith(
      expect.objectContaining({ url: first.coverImage }),
    );
    // The logo was not touched, so it must survive.
    expect((await Brand.findById(BRAND._id)).logo).toBe(first.logo);
  });

  test("the first upload deletes nothing — there was nothing there", async () => {
    await updateBrand(BRAND._id, {}, { logo: image() }, vendorActor(OWNER));
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  test("🔴 a non-image is refused before anything is uploaded", async () => {
    await expect(
      updateBrand(
        BRAND._id,
        {},
        { coverImage: { ...image(), mimetype: "application/pdf" } },
        vendorActor(OWNER),
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    // Refused before the session opens: a file this endpoint will never accept
    // should not cost a transaction, and the message must name the file.
    expect(uploadFromPath).not.toHaveBeenCalled();
  });

  test("a bare file still means the logo, as it always did", async () => {
    // The old signature passed the logo itself. An existing caller must not
    // change meaning under it.
    await updateBrand(BRAND._id, {}, image(), vendorActor(OWNER));

    const saved = await Brand.findById(BRAND._id);
    expect(saved.logo).toBeTruthy();
    expect(saved.coverImage).toBeFalsy();
  });
});

/**
 * Phase 3's actual claim: the server now knows where every picture lives, and
 * **nothing a client can see has changed**.
 */
describe("the storage sibling", () => {
  test("🔴 the response shape is unchanged — url stays a string", async () => {
    await updateBrand(
      BRAND._id,
      {},
      { logo: image(), coverImage: image() },
      vendorActor(OWNER),
    );

    const saved = await Brand.findById(BRAND._id);
    // The obvious shape would have been `logo: { url, storage }`, and that is a
    // breaking change for every client reading `brand.logo` as a string.
    expect(typeof saved.logo).toBe("string");
    expect(typeof saved.coverImage).toBe("string");
  });

  test("each picture's provider and key are stored beside it", async () => {
    await updateBrand(
      BRAND._id,
      {},
      { logo: image(), coverImage: image() },
      vendorActor(OWNER),
    );

    const saved = await Brand.findById(BRAND._id);
    expect(saved.logoMedia.storage.provider).toBe("AWS_S3");
    expect(saved.logoMedia.storage.key).toBeTruthy();
    expect(saved.coverImageMedia.storage.key).not.toBe(saved.logoMedia.storage.key);
  });

  test("🔴 a replace deletes by the OLD storage, not the new one", async () => {
    await updateBrand(BRAND._id, {}, { logo: image() }, vendorActor(OWNER));
    const first = await Brand.findById(BRAND._id);

    jest.clearAllMocks();
    await updateBrand(BRAND._id, {}, { logo: image() }, vendorActor(OWNER));

    // Capturing the pair after the overwrite would delete the file that was
    // just uploaded and leave the old one behind — the exact inverse.
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.url).toBe(first.logo);
    expect(asset.storage.key).toBe(first.logoMedia.storage.key);
  });

  test("⚠️ absent, not `{}`, on a row that never had a picture", async () => {
    // A Mongoose sub-document without `default: undefined` materialises as `{}`
    // on every document, and `{}` reads as `provider: undefined` — which the
    // facade refuses with "Unknown storage provider". Absent means "written
    // before this existed, fall back to the URL".
    const saved = await Brand.findById(BRAND._id);
    expect(saved.logoMedia).toBeUndefined();
    expect(saved.coverImageMedia).toBeUndefined();
  });

  test("a legacy row with a URL and no storage still deletes", async () => {
    await Brand.updateOne(
      { _id: BRAND._id },
      { $set: { logo: "https://res.cloudinary.com/x/image/upload/v1/old.png" } },
    );

    await updateBrand(BRAND._id, {}, { logo: image() }, vendorActor(OWNER));

    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.url).toContain("old.png");
    expect(asset.storage).toBeUndefined();
  });
});

describe("outlet logo and cover", () => {
  /**
   * ⚠️ `storeId` is required and validated against `TS-XXXX-XXXX-XXXX` over a
   * charset from `STORE_ID_SECRET`, so a hand-written string fails. Uses the
   * real generator, which stays correct if the format changes.
   */
  const seedOutlet = async () =>
    SubBrand.create({
      brandId: BRAND._id,
      userId: oid(),
      subBrandName: "fixture outlet",
      uniqueId: `TDO${Date.now()}${Math.floor(Math.random() * 100000)}`,
      storeId: await generateSubBrandStoreId(),
    });

  test("both files land on their own fields", async () => {
    const outlet = await seedOutlet();

    await updateSubBrand(
      vendorActor(OWNER),
      { subBrandId: outlet._id.toString() },
      { logo: image(), coverImage: image() },
    );

    const saved = await SubBrand.findById(outlet._id);
    expect(saved.logo).toBeTruthy();
    expect(saved.coverImage).toBeTruthy();
    expect(saved.coverImage).not.toBe(saved.logo);

    const purposes = uploadFromPath.mock.calls.map((c) => c[0].purpose);
    expect(purposes).toEqual(["SUB_BRAND_LOGO", "SUB_BRAND_COVER"]);

    // Each picture's provider and key land beside it, on their own field.
    expect(saved.logoMedia.storage.key).toBeTruthy();
    expect(saved.coverImageMedia.storage.key).toBeTruthy();
    expect(saved.coverImageMedia.storage.key).not.toBe(saved.logoMedia.storage.key);
  });

  test("replacing one deletes what it replaced", async () => {
    const outlet = await seedOutlet();
    await updateSubBrand(
      vendorActor(OWNER),
      { subBrandId: outlet._id.toString() },
      { logo: image() },
    );
    const first = await SubBrand.findById(outlet._id);

    jest.clearAllMocks();
    await updateSubBrand(
      vendorActor(OWNER),
      { subBrandId: outlet._id.toString() },
      { logo: image() },
    );

    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.url).toBe(first.logo);
    expect(asset.storage.key).toBe(first.logoMedia.storage.key);
  });

  test("🔴 a vendor cannot put a picture on another brand's outlet", async () => {
    const outlet = await seedOutlet();
    const intruder = (await seedOwner())._id;
    await seedBrand(intruder);

    await expect(
      updateSubBrand(
        vendorActor(intruder),
        { subBrandId: outlet._id.toString() },
        { logo: image() },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(uploadFromPath).not.toHaveBeenCalled();
  });

  test("an admin may, on anybody's outlet", async () => {
    const outlet = await seedOutlet();

    await updateSubBrand(
      adminActor(),
      { subBrandId: outlet._id.toString() },
      { coverImage: image() },
    );

    expect((await SubBrand.findById(outlet._id)).coverImage).toBeTruthy();
  });

  test("a non-image is refused before the outlet is even loaded", async () => {
    const outlet = await seedOutlet();

    await expect(
      updateSubBrand(
        vendorActor(OWNER),
        { subBrandId: outlet._id.toString() },
        { logo: { ...image(), mimetype: "video/mp4" } },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(uploadFromPath).not.toHaveBeenCalled();
  });
});

/**
 * Categories are where the shared-placeholder problem lives.
 *
 * `Category.image` **defaults** to one URL that every picture-less category
 * carries, so a delete that trusted the URL alone could blank the tile on all
 * of them at once. The sibling makes "ours" and "the shared default" two
 * different things rather than two similar strings.
 */
describe("category image", () => {
  const seedCategory = (overrides = {}) =>
    Category.create({ name: `cat-${Date.now()}-${Math.random()}`, ...overrides });

  /**
   * ⚠️ The multipart road on **create**, which had no test at all before U-2
   * moved this surface behind `acceptUpload`. Update's road is covered below;
   * create mints its own `_id` first so the key can carry it, and that is the
   * part a signature change is most likely to drop.
   */
  test("create still takes a multipart file", async () => {
    const category = await createCategory(
      admin(),
      { name: `cat-${Date.now()}-${Math.random()}` },
      image(),
    );

    expect(uploadFromPath).toHaveBeenCalledTimes(1);
    const [{ entityId, purpose }] = uploadFromPath.mock.calls[0];
    expect(String(entityId)).toBe(String(category._id));
    expect(purpose).toBe(UPLOAD_PURPOSE.CATEGORY_IMAGE);

    const saved = await Category.findById(category._id);
    expect(saved.imageMedia.storage.key).toBeTruthy();
  });

  /**
   * ⚠️ `assertImageFile` runs **before** the id is spent, on create as well as
   * on update. It is an exact mime allow-list, which the purpose's `kinds`
   * deliberately is not — `kindFromMime("image/svg+xml")` answers IMAGE, and an
   * SVG served from our own CDN is stored XSS.
   */
  test("create refuses a file that is not an image", async () => {
    await expect(
      createCategory(
        admin(),
        { name: `cat-${Date.now()}-${Math.random()}` },
        localFile("pdf", { name: "b.pdf" }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(uploadFromPath).not.toHaveBeenCalled();
    expect(await Category.countDocuments({ name: /^cat-/ })).toBe(0);
  });

  test("create without a picture never asks the provider", async () => {
    const category = await createCategory(admin(), {
      name: `cat-${Date.now()}-${Math.random()}`,
    });

    expect(uploadFromPath).not.toHaveBeenCalled();
    const saved = await Category.findById(category._id);
    expect(saved.image).toBe(DEFAULT_IMAGES.CATEGORY);
  });

  test("an upload writes the url and its storage", async () => {
    const category = await seedCategory();

    await updateCategoryById(admin(), category._id, null, image());

    const saved = await Category.findById(category._id);
    expect(typeof saved.image).toBe("string");
    expect(saved.imageMedia.storage.key).toBeTruthy();
  });

  test("🔴 replacing deletes by the stored sibling, not the URL alone", async () => {
    const category = await seedCategory();
    await updateCategoryById(admin(), category._id, null, image());
    const first = await Category.findById(category._id);

    jest.clearAllMocks();
    await updateCategoryById(admin(), category._id, null, image());

    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.url).toBe(first.image);
    expect(asset.storage.key).toBe(first.imageMedia.storage.key);
  });

  test("🔴 deleting a category passes the sibling too", async () => {
    const category = await seedCategory();
    await updateCategoryById(admin(), category._id, null, image());
    const saved = await Category.findById(category._id);

    jest.clearAllMocks();
    await deleteCategoryById(category._id);

    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.storage.key).toBe(saved.imageMedia.storage.key);
  });

  test("⚠️ a category that never had a picture carries the shared default and no storage", async () => {
    const category = await seedCategory();
    const saved = await Category.findById(category._id);

    // The URL is real — it is the placeholder every such category shares — but
    // there is no storage, because we did not put it there.
    expect(saved.image).toBeTruthy();
    expect(saved.imageMedia).toBeUndefined();
  });
});

describe("pinning a section cover", () => {
  const seedSection = (medias) =>
    ShowcaseSection.create({
      brandId: BRAND._id,
      title: "Our space",
      slug: `our-space-${Date.now()}`,
      medias,
    });

  /**
   * ⚠️ The file sits inside `media` now (M-4), and there is no `type` beside it
   * — `PHOTO` / `VIDEO` is derived from `media.kind` on the way out. A photo is
   * its own cover, so no poster is needed here; a video would need one, because
   * `mediaSchema` makes it mandatory.
   */
  const photo = (sortOrder, url) => ({
    media: { url, kind: MEDIA_KIND.IMAGE },
    sortOrder,
  });

  test("pinning sets the cover, the mode and the id", async () => {
    const section = await seedSection([
      photo(1, "https://cdn.test/first.webp"),
      photo(2, "https://cdn.test/second.webp"),
    ]);
    const second = section.medias[1];

    await updateSection(vendorActor(OWNER), {
      sectionId: section._id.toString(),
      coverMediaId: second._id.toString(),
    });

    const saved = await ShowcaseSection.findById(section._id);
    expect(saved.coverImage).toBe("https://cdn.test/second.webp");
    expect(saved.coverImageMode).toBe(MANUAL);
    expect(String(saved.coverMediaId)).toBe(String(second._id));
  });

  test("AUTO unpins and puts the cover back on the first media", async () => {
    const section = await seedSection([
      photo(1, "https://cdn.test/first.webp"),
      photo(2, "https://cdn.test/second.webp"),
    ]);
    await updateSection(vendorActor(OWNER), {
      sectionId: section._id.toString(),
      coverMediaId: section.medias[1]._id.toString(),
    });

    await updateSection(vendorActor(OWNER), {
      sectionId: section._id.toString(),
      coverImageMode: AUTO,
    });

    const saved = await ShowcaseSection.findById(section._id);
    expect(saved.coverImageMode).toBe(AUTO);
    expect(saved.coverMediaId).toBeUndefined();
    expect(saved.coverImage).toBe("https://cdn.test/first.webp");
  });

  test("🔴 a media from another section cannot become this one's cover", async () => {
    const mine = await seedSection([photo(1, "https://cdn.test/mine.webp")]);
    const theirs = await seedSection([photo(1, "https://cdn.test/theirs.webp")]);

    await expect(
      updateSection(vendorActor(OWNER), {
        sectionId: mine._id.toString(),
        coverMediaId: theirs.medias[0]._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("a hidden media is refused, with a reason the vendor can act on", async () => {
    const section = await seedSection([
      photo(1, "https://cdn.test/first.webp"),
      { ...photo(2, "https://cdn.test/hidden.webp"), isActive: false },
    ]);

    await expect(
      updateSection(vendorActor(OWNER), {
        sectionId: section._id.toString(),
        coverMediaId: section.medias[1]._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test("a deleted media is refused", async () => {
    const section = await seedSection([
      photo(1, "https://cdn.test/first.webp"),
      { ...photo(2, "https://cdn.test/gone.webp"), isDeleted: true },
    ]);

    await expect(
      updateSection(vendorActor(OWNER), {
        sectionId: section._id.toString(),
        coverMediaId: section.medias[1]._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("🔴 a vendor cannot pin a cover on another brand's section", async () => {
    const section = await seedSection([photo(1, "https://cdn.test/first.webp")]);
    const intruder = (await seedOwner())._id;
    await seedBrand(intruder);

    await expect(
      updateSection(vendorActor(intruder), {
        sectionId: section._id.toString(),
        coverMediaId: section.medias[0]._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

/**
 * U-5 — the presigned road, and the three things that only fail here.
 *
 * ⚠️ `describeIncoming` is the **real** one (the mock at the top of this file
 * re-exports `services/storage/accept`), so it reads the intent rows below from
 * the real collection. Only the upload itself is stubbed.
 */
describe("🔴 U-5 — brand slots on the presigned road", () => {
  const intent = async (userId, purpose) =>
    String(
      (
        await Upload.create({
          userId,
          purpose,
          stagingKey: `staging/${oid()}.png`,
          declaredContentType: "image/png",
          declaredSizeBytes: 1024,
          declaredFileName: "logo.png",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
      )._id,
    );

  /**
   * ⚠️ Each slot carries its **own** `uploadIdField`. Reading the wrong one — or
   * none — makes the presigned road silently do nothing: the request succeeds,
   * the brand keeps its old logo, and nobody is told.
   */
  test("a named logo reaches the facade as an id", async () => {
    const uploadId = await intent(OWNER, UPLOAD_PURPOSE.BRAND_LOGO);

    await updateBrand(BRAND._id, { logoUploadId: uploadId }, null, vendorActor(OWNER));

    // ⚠️ `confirmUpload` is the presigned road's own step — reaching it at all
    // proves the id was read, and its actor proves who it was read for.
    expect(confirmUpload).toHaveBeenCalledTimes(1);
    const [actor, calledId] = confirmUpload.mock.calls[0];
    expect(String(actor.userId)).toBe(String(OWNER));
    expect(String(calledId)).toBe(uploadId);

    const saved = await Brand.findById(BRAND._id);
    // ⚠️ `confirmed-` and not `k-`: the multipart stub uses `k-N`, so the prefix
    // is what says which road actually ran. The number is a shared counter.
    expect(saved.logoMedia.storage.key).toMatch(/^confirmed-/);
  });

  /**
   * 🔴 The brand is checked **before** the upload (E5).
   *
   * That check used to come free from the transaction's own read. With the
   * uploads moved ahead of the session, a bad id would otherwise 404 *after* the
   * vendor had paid for two uploads — the exact cost the "refuse before paying"
   * rule exists to avoid.
   */
  test("a brand that does not exist costs nothing", async () => {
    const uploadId = await intent(OWNER, UPLOAD_PURPOSE.BRAND_LOGO);

    await expect(
      updateBrand(oid(), { logoUploadId: uploadId }, null, vendorActor(OWNER)),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(confirmUpload).not.toHaveBeenCalled();
  });

  /**
   * 🔴 A transaction that fails **before** the assignment loop.
   *
   * ⚠️ This is the case the rollback source has to get right. The uploads now
   * happen before the session, so `replaced` — which is filled inside the loop —
   * is still empty here, while the object is already in the bucket. Rolling back
   * from `replaced` would leave it there, paid for and referenced by nothing.
   *
   * Deleting the owner is how the transaction is made to fail at that point:
   * `updateBrand` loads the brand's owner and refuses without one.
   */
  test("an upload is cleaned up when the transaction fails before it is used", async () => {
    const uploadId = await intent(OWNER, UPLOAD_PURPOSE.BRAND_LOGO);
    await User.deleteOne({ _id: OWNER });

    await expect(
      updateBrand(BRAND._id, { logoUploadId: uploadId }, null, vendorActor(OWNER)),
    ).rejects.toMatchObject({ statusCode: 404 });

    // The object went up, and then it went again.
    expect(confirmUpload).toHaveBeenCalledTimes(1);
    expect(deleteAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        storage: expect.objectContaining({
          key: expect.stringMatching(/^confirmed-/),
        }),
      }),
    );
  });
});

/**
 * 🔴 The third of the three surfaces that deleted before saving.
 *
 * `updateCategoryById` was fixed in U-2 and has its own real-bucket test;
 * `updateUserById` is covered in `unit/customerProfileImage`. This is the
 * sub-category, and the failure it guards against is the same one: a `save()`
 * that throws used to leave the bytes gone and the row still pointing at them.
 */
describe("🔴 U-5 — a sub-category keeps its picture when the save fails", () => {
  const seedSubCategory = async () => {
    const category = await Category.create({ name: `c-${Date.now()}-${Math.random()}` });
    return SubCategory.create({
      name: `s-${Date.now()}-${Math.random()}`,
      categoryId: category._id,
    });
  };

  test("nothing is deleted when the save throws", async () => {
    const subCategory = await seedSubCategory();
    await updateSubCategoryById(adminActor(), subCategory._id, null, image());
    const before = await SubCategory.findById(subCategory._id);

    jest.clearAllMocks();
    jest
      .spyOn(SubCategory.prototype, "save")
      .mockRejectedValueOnce(new Error("the write did not land"));

    await expect(
      updateSubCategoryById(adminActor(), subCategory._id, null, image()),
    ).rejects.toThrow(/did not land/);

    // 🔴 The row still points at the old picture, so the old picture has to stay.
    expect(deleteAsset).not.toHaveBeenCalled();
    const after = await SubCategory.findById(subCategory._id);
    expect(after.imageMedia.storage.key).toBe(before.imageMedia.storage.key);
  });

  test("and it is deleted once the save goes through", async () => {
    const subCategory = await seedSubCategory();
    await updateSubCategoryById(adminActor(), subCategory._id, null, image());
    const before = await SubCategory.findById(subCategory._id);

    jest.clearAllMocks();
    await updateSubCategoryById(adminActor(), subCategory._id, null, image());

    const [asset] = deleteAsset.mock.calls[0];
    expect(asset.storage.key).toBe(before.imageMedia.storage.key);
  });
});
