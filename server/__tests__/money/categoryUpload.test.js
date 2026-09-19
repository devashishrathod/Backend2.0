/**
 * U-2 — the first surface to take the presigned road.
 *
 * ### 🔴 Why this file exists on top of `uploadAccept`
 *
 * `uploadAccept` proves the **facade**: both roads answer the same shape, and
 * the two refusals land where they should. It says nothing about whether a
 * surface actually asks it. Category is the pilot, and everything U-3, U-4 and
 * U-5 do to the other eighteen call sites is a copy of what happens here — so
 * the wiring is what is under test:
 *
 * - the actor reaches the facade, so an upload cannot be handed to somebody else
 * - `entityId` reaches the key, so the object is filed under its category
 * - confirm's `{ contentType, sizeBytes }` reaches the row as `{ mimeType,
 *   sizeBytes }`, rather than a media sibling with a null mime and a zero size
 * - and, the one that costs a customer something: **a refusal must not destroy
 *   the picture the category already had**
 *
 * ### 🔴 Why a real bucket
 *
 * The last point cannot be checked against a mock. "The old object survived a
 * refusal" is a question about S3, and a mock would answer it by agreeing with
 * whatever the test assumed. Every assertion about a deleted or surviving
 * object here is a real `HeadObject` against the real bucket.
 *
 * ⚠️ The multipart road for this surface is covered in `brandImages` (update)
 * and by `assertImageFile`'s own unit file, both against a mocked provider.
 * This file is the presigned road and the refusals.
 */

const mongoose = require("mongoose");
const { HeadObjectCommand } = require("@aws-sdk/client-s3");

const {
  connectTestDb,
  enablePresign,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Category = require("../../models/Category");
const Upload = require("../../models/Upload");
const storage = require("../../services/storage");
const { createUploadIntent } = storage;
const {
  createCategory,
  updateCategoryById,
} = require("../../services/categories");
const {
  validateCreateCategory,
  validateUpdateCategory,
} = require("../../validator/categories");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { DEFAULT_IMAGES, ROLES } = require("../../constants");
const { getS3Client } = require("../../configs/s3");
const { localFile, cleanup: cleanupFixtures } = require("../support/localFile");

afterAll(cleanupFixtures);

const oid = () => new mongoose.Types.ObjectId();
const admin = (userId = oid()) => ({ userId, role: ROLES.ADMIN });

/** A one-pixel PNG — real bytes, because confirm reads the magic number. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let seq = 0;
const categoryName = () => `u2-cat-${Date.now()}-${(seq += 1)}`;

/** POST the bytes the way a browser would: signed fields first, file last. */
const uploadTo = async ({ url, fields }, body) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([body], { type: "image/png" }), "probe");
  return fetch(url, { method: "POST", body: form });
};

/** Presign and actually send the bytes, so the id is ready to be accepted. */
const readyUpload = async (who, purpose = UPLOAD_PURPOSE.CATEGORY_IMAGE) => {
  const intent = await createUploadIntent(who, {
    purpose,
    contentType: "image/png",
    sizeBytes: PNG.length,
    fileName: "probe.png",
  });
  const sent = await uploadTo(intent, PNG);
  expect(sent.ok).toBe(true);
  return intent.uploadId;
};

/**
 * Is the object still there?
 *
 * ### ⚠️ A missing key answers **403**, not 404, and that is correct
 *
 * S3 only tells you an object is absent if you also hold `s3:ListBucket` on the
 * bucket. Our upload role deliberately does not — it can read and write the
 * keys it is given and cannot enumerate the bucket — so S3 masks "no such key"
 * as "access denied". Measured against `trydood-nonprod-public`: a key that was
 * never written answers `403 UnknownError`.
 *
 * 🔴 That makes 403 ambiguous on its own — "deleted" and "not allowed" arrive
 * as the same answer. What removes the ambiguity is that every assertion of
 * `false` in this file sits next to an assertion of `true` made with the same
 * credential against a sibling key written seconds earlier. A permission
 * problem would fail the positive first, so a passing pair can only mean the
 * object is gone.
 *
 * Anything else — a network fault, an expired credential, a 5xx — is re-thrown.
 * Swallowing it would turn every outage into a passing "the object was deleted".
 */
const existsInS3 = async ({ bucket, key }) => {
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return false;
    throw error;
  }
};

/**
 * Run something that must be refused, and hand back the refusal.
 *
 * ⚠️ No `try`/`catch`. The obvious version puts the "it did not throw" error
 * **inside** the try, where its own catch swallows it — and the test then fails
 * on `expected 422, received undefined` instead of saying what actually
 * happened.
 */
const NOTHING_THREW = Symbol("nothing threw");
const failure = async (promise) => {
  const error = await promise.then(
    () => NOTHING_THREW,
    (thrown) => thrown,
  );
  if (error === NOTHING_THREW) {
    throw new Error("expected this to be refused, and it was not");
  }
  return { statusCode: error.statusCode, message: error.message };
};

/** Create straight onto the presigned road. */
const createWithUpload = async (who, extra = {}) => {
  const uploadId = await readyUpload(who);
  return createCategory(who, { name: categoryName(), uploadId, ...extra }, null);
};

/**
 * ⚠️ These tests write to the **real** bucket, so they have to take it back out.
 *
 * Without this, every run leaves behind one object per upload — forever. Nothing
 * ever collects them: the `staging/` lifecycle rule only reaches uploads that
 * were never confirmed, and a confirmed object has moved out of that prefix by
 * definition. `scripts/auditOrphans.js` would eventually list them, as a growing
 * list of things a human has to decide about.
 *
 * Collected **before** each clear rather than as the tests go, so a test that
 * fails halfway still has its objects picked up.
 */
const littered = [];
const rememberObjects = async () => {
  const rows = await Category.find({ "imageMedia.storage.key": { $exists: true } })
    .select("imageMedia.storage")
    .lean();
  rows.forEach((row) => littered.push(row.imageMedia.storage));
};

/**
 * ⚠️ 120s, not the config's 60.
 *
 * 🔴 This hook does three round trips to a shared M0 — connect, the settings
 * write, and `createIndexes()` — and `createIndexes` costs seconds even when
 * every index already exists, because the cost is *checking* them. Under a full
 * suite run it competes with everything else on the same tier and crossed 60s
 * the moment `enablePresign` was added: all three presign suites failed at
 * **70.7 seconds**, every test at once, on correct assertions.
 *
 * A hook timeout does not read as "the cluster was busy" — it reads as a broken
 * feature. CLAUDE.md records that exact false signal sending two earlier
 * debugging sessions the wrong way.
 */
beforeAll(async () => {
  await connectTestDb();
  // ⚠️ The presigned road is off by default (G5) — this suite uses it.
  await enablePresign();
  await Upload.createIndexes();
}, 120000);

afterAll(async () => {
  await rememberObjects();
  // `deleteAssets` rather than a loop: one bad key must not strand the rest, and
  // it counts what it could not do instead of logging and moving on.
  await storage.deleteAssets(
    littered.map((ref) => ({ storage: ref, url: null })),
  );
  await clearCollections(Upload, Category);
  await disconnectTestDb();
}, 120000);

beforeEach(async () => {
  jest.restoreAllMocks();
  await rememberObjects();
  await clearCollections(Upload, Category);
});

describe("🔴 create takes the presigned road", () => {
  it("stores the picture and where it landed", async () => {
    const who = admin();
    const category = await createWithUpload(who);

    const saved = await Category.findById(category._id).lean();
    expect(saved.image).toMatch(/^https?:\/\//);
    expect(saved.imageMedia.storage.provider).toBe("AWS_S3");
    expect(saved.imageMedia.storage.key).toBeTruthy();
    expect(saved.image).toContain(saved.imageMedia.storage.key);
  });

  /**
   * 🔴 The quiet one. `confirmUpload` answers `{ contentType, sizeBytes }` and
   * `mediaSchema` stores `{ mimeType, sizeBytes }`, so a surface that skipped
   * the facade's translation would write a row with a **null mime and a zero
   * size** and nothing anywhere would error. The mime is also what
   * `resolveKind` reads when the picture is eventually deleted.
   */
  it("writes a media row with the real mime and size, not an empty one", async () => {
    const category = await createWithUpload(admin());

    const saved = await Category.findById(category._id).lean();
    expect(saved.imageMedia.mimeType).toBe("image/png");
    expect(saved.imageMedia.sizeBytes).toBe(PNG.length);
    expect(saved.imageMedia.kind).toBe("IMAGE");
  });

  /**
   * ⚠️ `entityId` is not decoration — it is the folder. Without it every
   * category's picture lands in one flat prefix, and "which objects belong to
   * this category" stops being answerable from the key.
   */
  it("files the object under the category it belongs to", async () => {
    const category = await createWithUpload(admin());

    const saved = await Category.findById(category._id).lean();
    expect(saved.imageMedia.storage.key).toContain(String(saved._id));
  });

  it("spends the upload, so the same id cannot be used twice", async () => {
    const who = admin();
    const uploadId = await readyUpload(who);

    await createCategory(who, { name: categoryName(), uploadId }, null);
    const { statusCode } = await failure(
      createCategory(who, { name: categoryName(), uploadId }, null),
    );

    // 409 — the id was real and theirs, it has simply already been spent.
    expect(statusCode).toBe(409);
    expect(await Category.countDocuments({})).toBe(1);
  });

  /**
   * The picture is optional, and a category without one carries the shared
   * placeholder rather than an empty string. It must not carry a media sibling:
   * a sibling would mean the row claims to own bytes it never uploaded.
   */
  it("leaves the shared placeholder when nothing is sent", async () => {
    const category = await createCategory(admin(), { name: categoryName() });

    const saved = await Category.findById(category._id).lean();
    expect(saved.image).toBe(DEFAULT_IMAGES.CATEGORY);
    // `toMediaDocument(null)` answers null, and the row keeps that rather than
    // the field being absent — either way there is no sibling claiming bytes.
    expect(saved.imageMedia ?? null).toBeNull();
  });
});

describe("🔴 update replaces on the presigned road", () => {
  it("swaps the picture and really deletes the old object", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = (await Category.findById(category._id).lean()).imageMedia;

    const uploadId = await readyUpload(who);
    await updateCategoryById(who, category._id, { uploadId }, null);

    const after = (await Category.findById(category._id).lean()).imageMedia;
    expect(after.storage.key).not.toBe(before.storage.key);
    // The replacement is filed under the same category as the one it replaced.
    expect(after.storage.key).toContain(String(category._id));

    // Not "deleteAsset was called" — the bucket itself.
    expect(await existsInS3(after.storage)).toBe(true);
    expect(await existsInS3(before.storage)).toBe(false);
  });

  /**
   * 🔴 A category that never had its own picture still carries a URL, because
   * the schema **defaults** it — and that one URL is carried by every such
   * category at once. Deleting it on a first upload would blank the tile on all
   * of them, from one ordinary request.
   */
  it("does not delete the shared placeholder on a first upload", async () => {
    const who = admin();
    const category = await Category.create({ name: categoryName() });
    const deleteAsset = jest.spyOn(storage, "deleteAsset");

    const uploadId = await readyUpload(who);
    await updateCategoryById(who, category._id, { uploadId }, null);

    // It is asked, and it refuses — which is the guarantee, not "never asked".
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    await expect(deleteAsset.mock.results[0].value).resolves.toBe(false);
  });

  /**
   * 🔴 The order this whole block is about, at the step that used to be missed.
   *
   * The delete used to sit before `save()`. A save that threw then left the
   * bytes gone and the row still pointing at them — the same broken tile the
   * "upload first" comment claimed to have fixed, one step later, and with
   * nothing left to re-point the row at.
   */
  it("does not delete the old picture when the save fails", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();
    const uploadId = await readyUpload(who);

    // Mocked after the upload, so the only save it can catch is the service's.
    jest
      .spyOn(Category.prototype, "save")
      .mockRejectedValueOnce(new Error("the write did not land"));

    await failure(updateCategoryById(who, category._id, { uploadId }, null));

    // The row still points at the old picture, so the bytes have to still exist.
    const saved = await Category.findById(category._id).lean();
    expect(saved.imageMedia.storage.key).toBe(before.imageMedia.storage.key);
    expect(await existsInS3(before.imageMedia.storage)).toBe(true);
  });

  /**
   * ⚠️ The other side of the same order. Once the row is saved the customer
   * already sees the right picture, so a failed cleanup is an orphaned object —
   * not a failed update. Answering 500 here would send the admin to retry a save
   * that has already happened.
   */
  it("still succeeds when deleting the old picture fails", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();
    const uploadId = await readyUpload(who);

    const reported = jest.spyOn(console, "error").mockImplementation(() => {});
    const deleteAsset = jest
      .spyOn(storage, "deleteAsset")
      .mockRejectedValueOnce(new Error("S3 said no"));

    const updated = await updateCategoryById(
      who,
      category._id,
      { uploadId },
      null,
    );

    expect(updated.imageMedia.storage.key).not.toBe(before.imageMedia.storage.key);
    const saved = await Category.findById(category._id).lean();
    expect(saved.imageMedia.storage.key).toBe(updated.imageMedia.storage.key);

    // 🔴 Swallowed is not the same as handled — the orphan has to be findable.
    expect(reported).toHaveBeenCalled();
    expect(String(reported.mock.calls[0][0])).toContain(
      before.imageMedia.storage.key,
    );

    // Do not litter the real bucket with the object this test orphaned.
    deleteAsset.mockRestore();
    await storage.deleteAsset(before.imageMedia);
  });

  it("renames without touching the picture", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = (await Category.findById(category._id).lean()).imageMedia;

    await updateCategoryById(who, category._id, { name: categoryName() }, null);

    const saved = await Category.findById(category._id).lean();
    expect(saved.imageMedia.storage.key).toBe(before.storage.key);
    expect(await existsInS3(before.storage)).toBe(true);
  });
});

/**
 * ### 🔴 The heart of U-2
 *
 * Upload first, delete second. The old order destroyed the category's picture
 * and *then* tried to get a new one — so a failed upload left a broken tile in
 * the customer's category list, from a request that answered 500 and looked
 * retryable.
 *
 * The presigned road makes that order matter **more**, not less, because
 * `acceptUpload` has two refusals of its own that the multipart road never had:
 * a mismatched purpose and somebody else's upload. Each one has to leave the
 * category exactly as it was.
 */
describe("🔴 a refusal must not cost the picture", () => {
  const intact = async (categoryId, before) => {
    const saved = await Category.findById(categoryId).lean();
    expect(saved.image).toBe(before.image);
    expect(saved.imageMedia.storage.key).toBe(before.imageMedia.storage.key);
    expect(await existsInS3(before.imageMedia.storage)).toBe(true);
  };

  it("E1 — a file and an uploadId together", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();

    const uploadId = await readyUpload(who);
    const { statusCode, message } = await failure(
      updateCategoryById(
        who,
        category._id,
        { uploadId },
        localFile("png", { name: "pic.png" }),
      ),
    );

    expect(statusCode).toBe(422);
    expect(message).toMatch(/not both/i);
    await intact(category._id, before);

    // And the upload they did send is still theirs to spend.
    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();
  });

  it("E2 — an upload authorised for another surface", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();

    const uploadId = await readyUpload(who, UPLOAD_PURPOSE.BRAND_LOGO);
    const { statusCode, message } = await failure(
      updateCategoryById(who, category._id, { uploadId }, null),
    );

    expect(statusCode).toBe(422);
    expect(message).toContain("BRAND_LOGO");
    await intact(category._id, before);

    // 🔴 The refusal is cheap: the upload was never consumed, so fixing a
    // one-word mistake does not cost them the whole file again.
    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();
  });

  it("somebody else's uploadId", async () => {
    const owner = admin();
    const category = await createWithUpload(owner);
    const before = await Category.findById(category._id).lean();

    const uploadId = await readyUpload(owner);
    const { statusCode, message } = await failure(
      updateCategoryById(admin(), category._id, { uploadId }, null),
    );

    // 404, not 403 — "not yours" about a real id confirms the id is real.
    expect(statusCode).toBe(404);
    expect(message).not.toContain("CATEGORY_IMAGE");
    await intact(category._id, before);
  });

  it("an uploadId that was never presigned", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();

    const { statusCode } = await failure(
      updateCategoryById(who, category._id, { uploadId: String(oid()) }, null),
    );

    expect(statusCode).toBe(404);
    await intact(category._id, before);
  });

  /**
   * ⚠️ The multipart road's own refusal, on the same surface. `assertImageFile`
   * is an exact mime allow-list, which the purpose's `kinds` deliberately is
   * not — `kindFromMime("image/svg+xml")` answers IMAGE, and an SVG served from
   * our own CDN is stored XSS.
   */
  it("a file that is not an image", async () => {
    const who = admin();
    const category = await createWithUpload(who);
    const before = await Category.findById(category._id).lean();

    const { statusCode, message } = await failure(
      updateCategoryById(
        who,
        category._id,
        null,
        localFile("pdf", { name: "brochure.pdf" }),
      ),
    );

    expect(statusCode).toBe(422);
    expect(message).toContain("Category image must be an image");
    await intact(category._id, before);
  });
});

/**
 * The validator is the first gate, and it is the only one that answers before
 * anything is loaded — so a malformed id never becomes a database query.
 */
describe("the validator refuses a malformed uploadId", () => {
  it.each([
    ["create", validateCreateCategory],
    ["update", validateUpdateCategory],
  ])("on %s", (_label, validate) => {
    const { error } = validate({ name: "Coffee shops", uploadId: "nope" });
    expect(error.details.map((d) => d.message)).toContain("Invalid uploadId.");
  });

  it.each([
    ["create", validateCreateCategory],
    ["update", validateUpdateCategory],
  ])("but accepts a real one on %s", (_label, validate) => {
    const { error } = validate({
      name: "Coffee shops",
      uploadId: String(oid()),
    });
    expect(error).toBeUndefined();
  });
});
