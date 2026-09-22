/**
 * 🔴 The guard that decides an upload belongs to exactly one row.
 *
 * ### Why this file exists beside `uploadAccept.test.js`
 *
 * That file walks the real bucket, deliberately: the presigned road's whole
 * claim is that **S3** enforces the policy, and a mock would simply agree with
 * whatever it was told. But it needs working S3 credentials to say anything at
 * all — and when they are missing, every assertion in it fails on `sent.ok`,
 * including the ones about logic that never touches storage.
 *
 * The branch this file covers is pure Mongo. A client that called
 * `POST /uploads/confirm` first leaves a row carrying `storage` and `verified`,
 * and `acceptUpload` then answers from the row without reading, copying or
 * deleting a single object. Seeding that row directly tests exactly that, on any
 * machine, with no bucket and no credentials.
 *
 * ### What it is protecting
 *
 * `consumedAt` used to mean both *"the bytes were identified and moved"* and
 * *"this upload is spent"*. Those are different moments, and conflating them
 * made the sequence every panel doc prescribes impossible: the client confirmed,
 * and the surface — which confirms again — was answered **409 "That upload has
 * already been used."** about a file uploaded once. All eleven presigned
 * surfaces had it; voucher create wrapped it into a 500, which is where it was
 * finally noticed.
 *
 * `attachedAt` is the guard now, and it has to hold the same line the old one
 * did: one uploaded object may never end up on two rows.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const { acceptUpload } = require("../../services/storage");
const { toMediaDocument } = require("../../helpers/media");
const {
  UPLOAD_PURPOSE,
  STORAGE_PROVIDER,
  MEDIA_KIND,
} = require("../../constants/storage");

const oid = () => new mongoose.Types.ObjectId();
const actor = (userId = oid()) => ({ userId });

const SIZE = 184320;

/**
 * A row in the state `POST /uploads/confirm` leaves behind: identified, moved,
 * and not yet attached to anything.
 *
 * ⚠️ No `entityId` in the key. On a create the row this file belongs to does not
 * exist yet, so a client confirming early cannot supply one — which is exactly
 * the shape this branch has to cope with.
 */
const clientConfirmedRow = async (
  who,
  purpose = UPLOAD_PURPOSE.CATEGORY_IMAGE,
  overrides = {},
) =>
  Upload.create({
    userId: who.userId,
    purpose,
    stagingKey: `staging/${who.userId}/${oid()}.png`,
    declaredContentType: "image/png",
    declaredSizeBytes: SIZE,
    declaredFileName: "picked-by-the-vendor.png",
    storage: {
      provider: STORAGE_PROVIDER.AWS_S3,
      publicId: null,
      bucket: "trydood-nonprod-public",
      key: `images/categories/${oid()}.png`,
    },
    verified: {
      contentType: "image/png",
      kind: MEDIA_KIND.IMAGE,
      sizeBytes: SIZE,
      width: 1200,
      height: 800,
    },
    consumedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });

/** Run something that must be refused, and hand back the refusal. */
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

beforeAll(async () => {
  await connectTestDb();
  await Upload.createIndexes();
}, 120000);

afterAll(async () => {
  await clearCollections(Upload);
  await disconnectTestDb();
}, 120000);

beforeEach(() => clearCollections(Upload));

describe("🔴 an upload the client confirmed first is still spendable", () => {
  it("answers from the row, with the facts confirm settled", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    const accepted = await acceptUpload(who, {
      uploadId: row._id,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    // Every field a surface reads, and none of them re-derived from a claim.
    expect(accepted.storage.key).toBe(row.storage.key);
    expect(accepted.metadata.mimeType).toBe("image/png");
    expect(accepted.metadata.size).toBe(SIZE);
    expect(accepted.metadata.width).toBe(1200);
    expect(accepted.metadata.height).toBe(800);
  });

  /**
   * ⚠️ The uploader's own file name survives this road. It is what showcase and
   * the other galleries use as a default title — returning null here would make
   * every item added through the presigned road arrive untitled while the
   * multipart road filled it in.
   */
  it("keeps the name the vendor's machine gave it", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    const accepted = await acceptUpload(who, {
      uploadId: row._id,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    expect(accepted.metadata.originalName).toBe("picked-by-the-vendor.png");
  });

  it("produces a media document a model would accept", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    const media = toMediaDocument(
      await acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    expect(media.kind).toBe("IMAGE");
    expect(media.mimeType).toBe("image/png");
    expect(media.sizeBytes).toBe(SIZE);
    expect(media.storage.provider).toBe(STORAGE_PROVIDER.AWS_S3);
    expect(media.url).toMatch(/^https?:\/\//);
  });

  /**
   * 🔴 Every presigned surface, because the failure was in the shared facade and
   * proving one purpose proves only the mechanism. A vendor whose logo upload
   * broke is not comforted that category images were covered.
   */
  it.each([
    UPLOAD_PURPOSE.BRAND_LOGO,
    UPLOAD_PURPOSE.BRAND_COVER,
    UPLOAD_PURPOSE.SUB_BRAND_LOGO,
    UPLOAD_PURPOSE.SUB_BRAND_COVER,
    UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
    UPLOAD_PURPOSE.CATEGORY_IMAGE,
    UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
    UPLOAD_PURPOSE.USER_AVATAR,
    UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
    UPLOAD_PURPOSE.BANNER_MEDIA,
    UPLOAD_PURPOSE.BANNER_POSTER,
    UPLOAD_PURPOSE.VOUCHER_IMAGE,
    UPLOAD_PURPOSE.VOUCHER_BANNER,
    UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER,
    UPLOAD_PURPOSE.TICKER_ICON,
  ])("works for %s", async (purpose) => {
    const who = actor();
    const row = await clientConfirmedRow(who, purpose);

    const accepted = await acceptUpload(who, {
      uploadId: row._id,
      purpose,
      entityId: oid(),
    });

    expect(accepted.storage.key).toBe(row.storage.key);
    expect(accepted.metadata.mimeType).toBe("image/png");
  });
});

describe("🔴 one upload, one row", () => {
  it("marks it attached once a surface has taken it", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    await acceptUpload(who, {
      uploadId: row._id,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    const after = await Upload.findById(row._id).lean();
    expect(after.attachedAt).toBeTruthy();
  });

  it("refuses the second row that asks for the same upload", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    await acceptUpload(who, {
      uploadId: row._id,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    const { statusCode, message } = await failure(
      acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
    );

    // The second row would have held a file nobody paid for.
    expect(statusCode).toBe(409);
    expect(message).toMatch(/already been used/i);
  });

  /**
   * 🔴 The claim is a conditional update, never a read-then-write.
   *
   * Two saves landing together both see `attachedAt: null`, and a check-then-set
   * would let both through — the one case a sequential test can never reach, and
   * the whole reason the guard is written as one atomic write.
   */
  it("lets exactly one of two saves racing for it win", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    const results = await Promise.allSettled([
      acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
      acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r) => r.status === "rejected");
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.statusCode).toBe(409);
  });

  /**
   * ⚠️ Confirming is not attaching, and the row has to keep saying so. If
   * `/uploads/confirm` ever set this field again, the bug it replaced would be
   * back with no other symptom.
   */
  it("does not treat a bare confirm as an attachment", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who);

    const seeded = await Upload.findById(row._id).lean();
    expect(seeded.consumedAt).toBeTruthy();
    expect(seeded.attachedAt ?? null).toBeNull();
  });
});

describe("🔴 what the new road still refuses", () => {
  /**
   * ⚠️ E2 survives. The purpose is checked before the claim, so a one-word
   * mistake costs nothing — the upload is refused and stays spendable on the
   * surface it was authorised for.
   */
  it("refuses the wrong surface without burning the upload", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who, UPLOAD_PURPOSE.CATEGORY_IMAGE);

    const { statusCode, message } = await failure(
      acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      }),
    );
    expect(statusCode).toBe(422);
    expect(message).toContain("CATEGORY_IMAGE");

    const after = await Upload.findById(row._id).lean();
    expect(after.attachedAt ?? null).toBeNull();

    // And the surface it was meant for still takes it.
    const accepted = await acceptUpload(who, {
      uploadId: row._id,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });
    expect(accepted.storage.key).toBe(row.storage.key);
  });

  it("refuses a stranger's confirmed upload as if it did not exist", async () => {
    const mine = actor();
    const row = await clientConfirmedRow(mine);

    const { statusCode } = await failure(
      acceptUpload(actor(), {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // 404, not 403 — confirming early does not make a permission transferable.
    expect(statusCode).toBe(404);
  });

  it("does not attach a stranger's upload on the way to refusing it", async () => {
    const mine = actor();
    const row = await clientConfirmedRow(mine);

    await failure(
      acceptUpload(actor(), {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    const after = await Upload.findById(row._id).lean();
    expect(after.attachedAt ?? null).toBeNull();
  });

  /**
   * 🔴 A row that claims to be confirmed but records no file was not written by
   * this build. Saying so is better than the alternative: `asUploadResult`'s
   * fallbacks would store a media row with a null mime type and a zero size, and
   * nothing downstream would complain.
   */
  it("refuses a row that says confirmed but recorded no file", async () => {
    const who = actor();
    const row = await clientConfirmedRow(who, UPLOAD_PURPOSE.CATEGORY_IMAGE, {
      storage: undefined,
      verified: undefined,
    });

    const { statusCode, message } = await failure(
      acceptUpload(who, {
        uploadId: row._id,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    expect(statusCode).toBe(500);
    expect(message).toMatch(/no file was recorded/i);
  });
});
