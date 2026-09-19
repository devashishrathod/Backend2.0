/**
 * U-3 commit 2 — the showcase gallery on the presigned road.
 *
 * ### 🔴 Why this surface is the hard one
 *
 * Category took one optional image. A section takes **many**, of two different
 * kinds, and a video arrives with a still of its own that has to stay paired
 * with it. On top of that the surface has rules the platform does not: how many
 * photos and videos one section may hold, and which exact mime types it takes.
 *
 * None of that is anything `presign` or `confirm` know about — so the surface
 * has to look at what is coming **before** anything is confirmed. A vendor who
 * attaches one file too many must not pay for the whole batch to find out.
 *
 * ### 🔴 Why a real bucket
 *
 * "The upload survived the refusal" is a question about S3 and about the intent
 * row, and a mock answers it by agreeing with whatever the test assumed. Every
 * refusal below is checked by reading `consumedAt` back off the row and, where
 * it matters, by heading the object itself.
 *
 * ⚠️ These tests write to the real bucket and take their objects back out in
 * `afterAll` — a confirmed object has moved out of `staging/`, so the lifecycle
 * rule never reaches it.
 */

const mongoose = require("mongoose");
const { HeadObjectCommand } = require("@aws-sdk/client-s3");

const {
  connectTestDb,
  enablePresign,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const Brand = require("../../models/Brand");
const ShowcaseSection = require("../../models/ShowcaseSection");
const storage = require("../../services/storage");
const { createUploadIntent } = storage;
const { addSectionMedia } = require("../../services/showcases/addSectionMedia");
const {
  replaceSectionMedia,
} = require("../../services/showcases/replaceSectionMedia");
const {
  updateSectionMedia,
} = require("../../services/showcases/updateSectionMedia");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { ROLES } = require("../../constants");
const { getS3Client } = require("../../configs/s3");
const { localFile, cleanup: cleanupFixtures } = require("../support/localFile");

afterAll(cleanupFixtures);

const oid = () => new mongoose.Types.ObjectId();

const BRAND_ID = oid();
const VENDOR = { userId: String(oid()), role: ROLES.VENDOR, brandId: String(BRAND_ID) };

/** A 1x1 PNG — real magic bytes and a readable IHDR. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Something `identify` calls a video: four size bytes, then `ftyp`.
 *
 * ⚠️ Not a playable file, and it does not need to be. What is under test is the
 * pairing and the routing, both of which are decided by the kind — and the kind
 * comes from exactly these bytes.
 */
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.alloc(64, 0),
]);

/** POST the bytes the way a browser would: signed fields first, file last. */
const uploadTo = async ({ url, fields }, body) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([body], { type: fields["Content-Type"] }), "probe");
  return fetch(url, { method: "POST", body: form });
};

/** Presign and actually send the bytes, so the id is ready to be spent. */
const ready = async ({
  bytes = PNG,
  contentType = "image/png",
  purpose = UPLOAD_PURPOSE.SHOWCASE_MEDIA,
  fileName = "a-quiet-corner.png",
  who = VENDOR,
} = {}) => {
  const intent = await createUploadIntent(who, {
    purpose,
    contentType,
    sizeBytes: bytes.length,
    fileName,
  });
  const sent = await uploadTo(intent, bytes);
  expect(sent.ok).toBe(true);
  return String(intent.uploadId);
};

/**
 * Presign without sending the bytes.
 *
 * ⚠️ Enough for a refusal that lands **before** anything touches S3 — which is
 * the whole claim being tested. Uploading first would only make it slower.
 */
const presignOnly = async (over = {}) => {
  const intent = await createUploadIntent(over.who ?? VENDOR, {
    purpose: over.purpose ?? UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    contentType: over.contentType ?? "image/png",
    sizeBytes: PNG.length,
    fileName: over.fileName ?? "probe.png",
  });
  return String(intent.uploadId);
};

const video = (over = {}) =>
  ready({ bytes: MP4, contentType: "video/mp4", fileName: "the-kitchen.mp4", ...over });

const poster = (over = {}) =>
  ready({ purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL, fileName: "still.png", ...over });

/**
 * Is the object still there?
 *
 * ⚠️ A missing key answers **403**, not 404 — S3 only admits absence to a caller
 * holding `s3:ListBucket`, which this role deliberately does not. Every `false`
 * here sits beside a `true` made with the same credential, so a permission
 * problem would fail the positive first.
 */
const existsInS3 = async ({ bucket, key }) => {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403) return false;
    throw error;
  }
};

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

const unconsumed = async (uploadId) => {
  const row = await Upload.findById(uploadId).lean();
  return (row?.consumedAt ?? null) === null;
};

/** A photo row that costs nothing to seed — no upload, no bytes. */
const seededPhoto = (index) => ({
  media: {
    url: `https://cdn.example.com/seed-${index}.jpg`,
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  },
  title: `Seed ${index}`,
  sortOrder: index,
});

const makeSection = (mediaCount = 0) =>
  ShowcaseSection.create({
    brandId: BRAND_ID,
    title: "Ambience",
    slug: `ambience-${Date.now()}-${Math.random()}`,
    medias: Array.from({ length: mediaCount }, (_, i) => seededPhoto(i + 1)),
  });

/**
 * ⚠️ `resolveSectionForActor` confirms ownership against `Brand.userId`, not
 * against the token — so the brand row has to exist for a vendor to act.
 */
const makeBrandOwner = () =>
  Brand.collection.insertOne({
    _id: BRAND_ID,
    userId: new mongoose.Types.ObjectId(VENDOR.userId),
    isDeleted: false,
  });

/** Everything this run put in the bucket, so `afterAll` can take it back out. */
const littered = [];
const rememberObjects = async () => {
  const sections = await ShowcaseSection.find({}).select("medias").lean();
  for (const section of sections) {
    for (const item of section.medias || []) {
      if (item.media?.storage?.key) littered.push(item.media.storage);
      if (item.media?.poster?.storage?.key) littered.push(item.media.poster.storage);
    }
  }
  const rows = await Upload.find({ "storage.key": { $exists: true } })
    .select("storage")
    .lean();
  rows.forEach((row) => littered.push(row.storage));
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
  await storage.deleteAssets(littered.map((ref) => ({ storage: ref, url: null })));
  await clearCollections(Upload, ShowcaseSection, Brand);
  await disconnectTestDb();
}, 180000);

beforeEach(async () => {
  await rememberObjects();
  await clearCollections(Upload, ShowcaseSection, Brand);
  await makeBrandOwner();
});

describe("🔴 a section takes presigned media", () => {
  it("stores the picture, where it landed, and a title from the file's name", async () => {
    const section = await makeSection();
    const uploadId = await ready();

    const result = await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [uploadId], isShowInVideoClips: true },
      undefined,
    );

    expect(result.uploaded).toBe(1);
    const saved = await ShowcaseSection.findById(section._id).lean();
    const [item] = saved.medias;
    expect(item.media.storage.provider).toBe("AWS_S3");
    expect(item.media.url).toContain(item.media.storage.key);
    expect(item.media.mimeType).toBe("image/png");

    /**
     * 🔴 The title. `prepareMediaDocuments` names each item after its file, and
     * the presigned road has no file — so without the name being carried on the
     * intent row, every media added this way arrived untitled while the
     * multipart road filled it in. The same request, two results, depending on a
     * road the vendor never chose.
     */
    expect(item.title).toBe("a-quiet-corner");
    expect(item.altText).toBe("a-quiet-corner");
  });

  it("files the object under the section that owns it", async () => {
    const section = await makeSection();
    const uploadId = await ready();

    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [uploadId] },
      undefined,
    );

    const saved = await ShowcaseSection.findById(section._id).lean();
    expect(saved.medias[0].media.storage.key).toContain(String(section._id));
  });

  it("takes several at once, in the order they were named", async () => {
    const section = await makeSection();
    const first = await ready({ fileName: "one.png" });
    const second = await ready({ fileName: "two.png" });

    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [first, second] },
      undefined,
    );

    const saved = await ShowcaseSection.findById(section._id).lean();
    expect(saved.medias.map((m) => m.title)).toEqual(["one", "two"]);
    expect(saved.medias.map((m) => m.sortOrder)).toEqual([1, 2]);
  });
});

describe("🔴 a video arrives with its poster, or it does not arrive", () => {
  it("pairs the poster with the video at the same index", async () => {
    const section = await makeSection();
    const clip = await video();
    const still = await poster();

    await addSectionMedia(
      VENDOR,
      {
        sectionId: section._id,
        uploadIds: [clip],
        thumbnailUploadIds: [still],
      },
      undefined,
    );

    const saved = await ShowcaseSection.findById(section._id).lean();
    const [item] = saved.medias;
    expect(item.media.kind).toBe("VIDEO");
    expect(item.media.poster.url).toMatch(/^https?:\/\//);
    expect(await existsInS3(item.media.poster.storage)).toBe(true);
    expect(await existsInS3(item.media.storage)).toBe(true);
  });

  /**
   * 🔴 Refused before either upload is spent. `mediaSchema` would refuse it at
   * `save()` anyway — but by then the video bytes are paid for, and the message
   * names a schema path instead of the field the vendor has to fill in.
   */
  it("refuses a video with no poster, and spends nothing", async () => {
    const section = await makeSection();
    const clip = await video();

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        { sectionId: section._id, uploadIds: [clip] },
        undefined,
      ),
    );

    expect(statusCode).toBe(422);
    expect(message).toContain("thumbnailUploadIds");
    expect(await unconsumed(clip)).toBe(true);
  });

  /**
   * 🔴 A poster is not interchangeable with a gallery item.
   *
   * They have different purposes for a reason: a thumbnail is capped smaller and
   * refuses VIDEO outright. An id issued for one must not be spendable as the
   * other, or the tighter of the two rules is the one that can be skipped.
   */
  it("refuses a gallery upload used as a poster", async () => {
    const section = await makeSection();
    const clip = await video();
    const wrong = await ready({ fileName: "not-a-poster.png" });

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        {
          sectionId: section._id,
          uploadIds: [clip],
          thumbnailUploadIds: [wrong],
        },
        undefined,
      ),
    );

    expect(statusCode).toBe(422);
    expect(message).toContain("SHOWCASE_MEDIA");
    expect(message).toContain("SHOWCASE_THUMBNAIL");
    // Neither is burned — the vendor swapped two ids, not two files.
    expect(await unconsumed(clip)).toBe(true);
    expect(await unconsumed(wrong)).toBe(true);
  });
});

describe("🔴 the section's own rules run before anything is confirmed", () => {
  /**
   * The reason `describeIncoming` exists. A section that is already full has to
   * refuse while the uploads are still spendable — otherwise a vendor who picked
   * one file too many pays for every file in the batch to find out.
   *
   * ⚠️ The existing media are seeded straight into the document: they cost
   * nothing and the ceiling does not care where they came from.
   */
  it("refuses when the section is already full, and spends nothing", async () => {
    const section = await makeSection(15);
    const uploadId = await ready();

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        { sectionId: section._id, uploadIds: [uploadId] },
        undefined,
      ),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/Maximum 15 media items/i);
    expect(await unconsumed(uploadId)).toBe(true);
  });

  /**
   * 🔴 The surface's **own** allow-list, on the presigned road.
   *
   * `image/bmp` is an IMAGE to the platform, so `presign` hands out a signature
   * for it quite correctly — the showcase's list is narrower than the kind
   * family, and only the showcase knows that. Nothing downstream would have
   * refused this.
   *
   * ⚠️ The message names the **file**, which is the only reason
   * `describeIncoming` carries a name at all on this road. Found by mutation:
   * dropping the name left every other test green, because the title comes from
   * a different field.
   */
  it("refuses a format the section does not take, and names the file", async () => {
    const section = await makeSection();
    const uploadId = await presignOnly({
      contentType: "image/bmp",
      fileName: "odd-format.bmp",
    });

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        { sectionId: section._id, uploadIds: [uploadId] },
        undefined,
      ),
    );

    expect(statusCode).toBe(400);
    expect(message).toContain("odd-format.bmp");
    expect(message).toMatch(/format is not supported/i);
    expect(await unconsumed(uploadId)).toBe(true);
  });

  it("refuses somebody else's uploadId as if it did not exist", async () => {
    const section = await makeSection();
    const stranger = { userId: String(oid()), role: ROLES.VENDOR };
    const uploadId = await ready({ who: stranger });

    // 404, not 403 — "not yours" about a real id confirms the id is real.
    const { statusCode } = await failure(
      addSectionMedia(
        VENDOR,
        { sectionId: section._id, uploadIds: [uploadId] },
        undefined,
      ),
    );

    expect(statusCode).toBe(404);
    expect(await unconsumed(uploadId)).toBe(true);
  });

  /**
   * 🔴 A stranger's id with the **wrong** purpose — which is the case the
   * ownership lookup in `describeIncoming` really exists for.
   *
   * ⚠️ Found by mutation, and it is the same blind spot U-1 had. Dropping
   * `userId` from that lookup left the test above green: a matching purpose
   * falls straight through to `acceptUpload`, whose own owner check answers the
   * same 404. This case does not fall through. The purpose check would run
   * first and answer **422**, naming the surface the upload was authorised for
   * — so a prober would learn two things for free: the id is real, and what it
   * was for.
   */
  it("does not leak what a stranger's upload was for", async () => {
    const section = await makeSection();
    const stranger = { userId: String(oid()), role: ROLES.VENDOR };
    const uploadId = await poster({ who: stranger });

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        // Deliberately the gallery list, so a leaky lookup would answer 422.
        { sectionId: section._id, uploadIds: [uploadId] },
        undefined,
      ),
    );

    expect(statusCode).toBe(404);
    expect(message).not.toContain("SHOWCASE_THUMBNAIL");
  });

  /**
   * ⚠️ A mixed batch is allowed, and during the migration it is the normal case:
   * a panel may have sent some files to S3 already and not others. What is
   * refused is one **item** claiming to be both, which is a different request.
   *
   * ⚠️ The section's ceiling counts the whole batch, not each road separately —
   * which is the reason both lists are described into **one** list before
   * anything is checked.
   */
  it("counts a mixed batch as one list, files first", async () => {
    const section = await makeSection(13);
    const uploadId = await ready({ fileName: "presigned.png" });

    const { statusCode, message } = await failure(
      addSectionMedia(
        VENDOR,
        { sectionId: section._id, uploadIds: [uploadId] },
        {
          files: [
            localFile("png", { name: "attached-one.png" }),
            localFile("png", { name: "attached-two.png" }),
          ],
        },
      ),
    );

    // 13 stored + 2 files + 1 id = 16, one past the ceiling of 15. Counting the
    // two roads separately would have let this through.
    expect(statusCode).toBe(400);
    expect(message).toMatch(/Maximum 15 media items/i);
    expect(await unconsumed(uploadId)).toBe(true);
  });

  /**
   * 🔴 G11 — the poster that used to land on the wrong video.
   *
   * ### What the comment claimed, and what the code did
   *
   * *"Each road pairs within itself"* — `thumbnails[2]` belongs to the third
   * **file**, `thumbnailUploadIds[0]` to the first **uploadId**. What actually
   * happened was that both lists were flattened by `describeAllIncoming` (files
   * first, then ids) and paired by position across the **combined** result. That
   * is only the same thing when each list holds the same number of files.
   *
   * Here they do not: the video comes down the **id** road and its poster is a
   * **file**. Flattened, `incoming` is `[photoFile, videoId]` and `posters` is
   * `[posterFile]` — so the poster landed on the photo, where it is ignored
   * because a photo is its own thumbnail, and the video was left with none.
   *
   * ⚠️ `pairPosters` has its own unit tests. This one exists because those would
   * all still pass if `addSectionMedia` stopped calling it — the wiring is the
   * part a unit test cannot see.
   */
  it("🔴 pairs across roads: a file poster for a presigned video", async () => {
    const section = await makeSection();
    const clip = await video();

    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [clip] },
      {
        // A photo on the file road, alongside the video on the id road.
        files: [localFile("png", { name: "a-photo.png" })],
        thumbnails: [],
      },
    ).catch(() => {});

    // The video has no poster on its own road, so the whole batch is refused —
    // before anything is spent.
    expect(await unconsumed(clip)).toBe(true);
    const saved = await ShowcaseSection.findById(section._id).lean();
    expect(saved.medias).toHaveLength(0);
  });

  it("⚠️ and accepts it when each road carries its own poster", async () => {
    const section = await makeSection();
    const clip = await video();
    const still = await poster();

    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [clip], thumbnailUploadIds: [still] },
      { files: [localFile("png", { name: "a-photo.png" })] },
    );

    const saved = await ShowcaseSection.findById(section._id).lean();
    // Files first, then ids — the photo, then the video with its poster.
    expect(saved.medias).toHaveLength(2);
    const [photo, clipRow] = saved.medias;
    expect(photo.media.kind).toBe("IMAGE");
    // 🔴 The photo must NOT have picked up the video's poster.
    expect(photo.media.poster ?? null).toBeNull();
    expect(clipRow.media.kind).toBe("VIDEO");
    expect(clipRow.media.poster?.url).toMatch(/^https?:\/\//);
  });
});

describe("replacing one media on the presigned road", () => {
  it("swaps the file and deletes the old object", async () => {
    const section = await makeSection();
    const first = await ready({ fileName: "before.png" });
    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [first] },
      undefined,
    );
    const before = (await ShowcaseSection.findById(section._id).lean()).medias[0];

    const second = await ready({ fileName: "after.png" });
    await replaceSectionMedia(
      VENDOR,
      {
        sectionId: section._id,
        mediaId: String(before._id),
        uploadId: second,
      },
      undefined,
      undefined,
    );

    const after = (await ShowcaseSection.findById(section._id).lean()).medias[0];
    expect(after.media.storage.key).not.toBe(before.media.storage.key);
    expect(await existsInS3(after.media.storage)).toBe(true);
    expect(await existsInS3(before.media.storage)).toBe(false);
  });

  /**
   * ⚠️ Photo for photo, video for video — the sort order, the clips opt-in and
   * the section's quotas are all tied to the type. Refused **before** the
   * upload, so a vendor who picked the wrong file keeps it.
   */
  it("refuses a video in a photo's place, and spends nothing", async () => {
    const section = await makeSection();
    const first = await ready();
    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [first] },
      undefined,
    );
    const item = (await ShowcaseSection.findById(section._id).lean()).medias[0];

    const clip = await video();
    const still = await poster();
    const { statusCode, message } = await failure(
      replaceSectionMedia(
        VENDOR,
        {
          sectionId: section._id,
          mediaId: String(item._id),
          uploadId: clip,
          thumbnailUploadId: still,
        },
        undefined,
        undefined,
      ),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/only photo replacement/i);
    expect(await unconsumed(clip)).toBe(true);
    expect(await unconsumed(still)).toBe(true);
  });
});

describe("changing a video's poster on the presigned road", () => {
  it("stores the new one and deletes the old", async () => {
    const section = await makeSection();
    const clip = await video();
    const first = await poster({ fileName: "first-still.png" });
    await addSectionMedia(
      VENDOR,
      {
        sectionId: section._id,
        uploadIds: [clip],
        thumbnailUploadIds: [first],
      },
      undefined,
    );
    const item = (await ShowcaseSection.findById(section._id).lean()).medias[0];

    const second = await poster({ fileName: "second-still.png" });
    await updateSectionMedia(
      VENDOR,
      {
        sectionId: section._id,
        mediaId: String(item._id),
        thumbnailUploadId: second,
      },
      undefined,
    );

    const after = (await ShowcaseSection.findById(section._id).lean()).medias[0];
    expect(after.media.poster.storage.key).not.toBe(
      item.media.poster.storage.key,
    );
    expect(await existsInS3(after.media.poster.storage)).toBe(true);
    expect(await existsInS3(item.media.poster.storage)).toBe(false);
  });

  /**
   * ⚠️ A photo already is its own thumbnail, so the field is refused rather than
   * stored and ignored — and refused before the upload is spent.
   */
  it("refuses a poster on a photo, and spends nothing", async () => {
    const section = await makeSection();
    const photoUpload = await ready();
    await addSectionMedia(
      VENDOR,
      { sectionId: section._id, uploadIds: [photoUpload] },
      undefined,
    );
    const item = (await ShowcaseSection.findById(section._id).lean()).medias[0];

    const still = await poster();
    const { statusCode } = await failure(
      updateSectionMedia(
        VENDOR,
        {
          sectionId: section._id,
          mediaId: String(item._id),
          thumbnailUploadId: still,
        },
        undefined,
      ),
    );

    expect(statusCode).toBe(422);
    expect(await unconsumed(still)).toBe(true);
  });
});
