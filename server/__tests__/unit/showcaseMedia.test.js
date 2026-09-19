const mongoose = require("mongoose");

const ShowcaseSection = require("../../models/ShowcaseSection");
const {
  formatManagedMedia,
  customerMediaFields,
  countMediaOfType,
  clipEligibleMediaCondition,
} = require("../../helpers/showcases/projections");
const {
  prepareMediaDocuments,
  getExistingMediaCounts,
} = require("../../helpers/showcases/validateMedia");
const {
  SHOWCASE_MEDIA_TYPE,
  showcaseTypeOf,
} = require("../../constants/showcase");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * M-4 — the gallery item stops being its own private media shape.
 *
 * ### What is at risk
 *
 *   1. **The customer contract must not move.** `type`, `url` and `thumbnail`
 *      answered the same way before and after, or every app build breaks for a
 *      storage refactor it cannot see.
 *   2. **`type` must stay derivable.** There is no stored field any more, and a
 *      GIF has to keep reading as `PHOTO` (locked: S-7) while `media.kind`
 *      records that it is a GIF.
 *   3. **The `.mp4` cover bug must be dead.** `thumbnail || url` is what put
 *      video files where pictures belonged.
 */

const BRAND = new mongoose.Types.ObjectId();

const storageRef = {
  provider: STORAGE_PROVIDER.AWS_S3,
  bucket: "trydood-nonprod-public",
  key: "dev/images/showcase/s1/a.webp",
};

const photoMedia = (over = {}) => ({
  url: "https://cdn.example.com/a.webp",
  kind: MEDIA_KIND.IMAGE,
  mimeType: "image/webp",
  sizeBytes: 4096,
  originalName: "sunset.webp",
  storage: storageRef,
  ...over,
});

const videoMedia = (over = {}) => ({
  url: "https://cdn.example.com/v.mp4",
  kind: MEDIA_KIND.VIDEO,
  mimeType: "video/mp4",
  duration: 30,
  storage: storageRef,
  poster: {
    url: "https://cdn.example.com/v.jpg",
    storage: { ...storageRef, key: "dev/images/showcase/s1/v.jpg" },
  },
  ...over,
});

const item = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  media: photoMedia(),
  title: "Sunset",
  altText: "Sunset over the terrace",
  sortOrder: 1,
  isActive: true,
  isDeleted: false,
  isShowInVideoClips: false,
  ...over,
});

const section = (medias) =>
  new ShowcaseSection({
    brandId: BRAND,
    title: "Gallery",
    slug: "gallery",
    medias,
  });

const errorOn = (doc, path) => doc.validateSync()?.errors?.[path]?.message ?? null;

describe("showcaseTypeOf — two kinds read as one wire type", () => {
  test("a GIF is a PHOTO, and that is deliberate", () => {
    // S-7. A gallery renders a picture or a player; a GIF is a picture. The
    // finer answer stays on `media.kind`, which is what routes it to `gifs/`
    // and clear of the resize step that would flatten the animation.
    expect(showcaseTypeOf(MEDIA_KIND.GIF)).toBe(SHOWCASE_MEDIA_TYPE.PHOTO);
    expect(showcaseTypeOf(MEDIA_KIND.IMAGE)).toBe(SHOWCASE_MEDIA_TYPE.PHOTO);
    expect(showcaseTypeOf(MEDIA_KIND.VIDEO)).toBe(SHOWCASE_MEDIA_TYPE.VIDEO);
  });
});

describe("the model — a gallery item needs a file", () => {
  test("an item with media validates", () => {
    expect(section([item()]).validateSync()).toBeUndefined();
  });

  test("an item with no media is refused", () => {
    expect(errorOn(section([item({ media: undefined })]), "medias.0.media")).toBe(
      "A media file is required.",
    );
  });

  /**
   * ⚠️ Inherited from `mediaSchema`, not restated here — which is the whole
   * point of there being one schema. This is also what replaces the old
   * `thumbnail` + `thumbnailStorage` pair.
   */
  test("a video with no poster is refused", () => {
    const doc = section([item({ media: videoMedia({ poster: undefined }) })]);
    expect(errorOn(doc, "medias.0.media.poster")).toMatch(/needs a poster/);
  });

  /**
   * 🔴 The VIDEO-only rule, now asked of the file rather than a label beside it.
   *
   * A photo carrying `isShowInVideoClips: true` was a toggle in the vendor panel
   * that did nothing — the clips feed filters on the type before it ever looks
   * at the flag.
   *
   * ⚠️ `await doc.validate()`, not `validateSync()`. Mongoose runs `pre("validate")`
   * middleware only on the async path, so the sync call reports the flag
   * untouched and the rule looks broken when it is not. This is the same family
   * of trap as `this.invalidate()` inside a nested sub-document hook, which does
   * nothing at all — measured twice during this migration.
   */
  test("a photo cannot opt into the clips feed", async () => {
    const doc = section([item({ isShowInVideoClips: true })]);
    await doc.validate();
    expect(doc.medias[0].isShowInVideoClips).toBe(false);
  });

  test("a video keeps the flag it was given", async () => {
    const doc = section([
      item({ media: videoMedia(), isShowInVideoClips: true }),
    ]);
    await doc.validate();
    expect(doc.medias[0].isShowInVideoClips).toBe(true);
  });

  test("there is no stored type field to disagree with the file", () => {
    const doc = section([item()]);
    expect(doc.medias[0].toObject()).not.toHaveProperty("type");
    expect(doc.medias[0].toObject()).not.toHaveProperty("thumbnail");
    expect(doc.medias[0].toObject()).not.toHaveProperty("thumbnailStorage");
    expect(doc.medias[0].toObject()).not.toHaveProperty("metadata");
  });
});

describe("formatManagedMedia — the vendor's view", () => {
  test("one media object, and the type derived beside it", () => {
    const shape = formatManagedMedia(item());

    expect(shape.type).toBe(SHOWCASE_MEDIA_TYPE.PHOTO);
    expect(shape.media).toMatchObject({
      url: "https://cdn.example.com/a.webp",
      kind: MEDIA_KIND.IMAGE,
      mimeType: "image/webp",
      sizeBytes: 4096,
      originalName: "sunset.webp",
      provider: STORAGE_PROVIDER.AWS_S3,
    });
  });

  /**
   * 🔴 `storage` used to go out whole — `publicId` on Cloudinary, `bucket` and
   * `key` on S3 — because the managed view kept the raw subdocument "so the
   * panel can show file size and dimensions". It still shows those; what it no
   * longer gets is the address of the object.
   */
  test("the locator does not go to the panel", () => {
    const shape = formatManagedMedia(item({ media: videoMedia() }));

    expect(shape).not.toHaveProperty("storage");
    expect(shape).not.toHaveProperty("metadata");
    expect(shape.media).not.toHaveProperty("storage");
    expect(JSON.stringify(shape)).not.toMatch(
      /trydood-nonprod-public|dev\/images|publicId/,
    );
  });

  test("a video's poster reaches the panel as `thumbnail`", () => {
    const shape = formatManagedMedia(item({ media: videoMedia() }));

    expect(shape.media.thumbnail).toBe("https://cdn.example.com/v.jpg");
    expect(shape.media.duration).toBe(30);
  });

  test("the clips toggle is reported for a video and hidden on a photo", () => {
    expect(formatManagedMedia(item())).not.toHaveProperty("isShowInVideoClips");
    expect(
      formatManagedMedia(item({ media: videoMedia(), isShowInVideoClips: true })),
    ).toMatchObject({ isShowInVideoClips: true });
  });

  test("a GIF is reported as a PHOTO, and still says GIF underneath", () => {
    const shape = formatManagedMedia(
      item({ media: photoMedia({ kind: MEDIA_KIND.GIF }) }),
    );

    expect(shape.type).toBe(SHOWCASE_MEDIA_TYPE.PHOTO);
    expect(shape.media.kind).toBe(MEDIA_KIND.GIF);
  });
});

describe("customerMediaFields — the shape the app already reads", () => {
  /**
   * These assert the **expression**, not a query result — there is no database
   * here. What matters is which path each key is built from, because that is
   * exactly what M-4 moved.
   */
  test("type is a $cond on media.kind, never a stored field", () => {
    const fields = customerMediaFields({ withVideoMeta: false });

    expect(fields.type).toEqual({
      $cond: [
        { $eq: ["$$m.media.kind", MEDIA_KIND.VIDEO] },
        SHOWCASE_MEDIA_TYPE.VIDEO,
        SHOWCASE_MEDIA_TYPE.PHOTO,
      ],
    });
  });

  test("url comes from the media, and thumbnail from its poster on a video", () => {
    const fields = customerMediaFields({ withVideoMeta: false });

    expect(fields.url).toBe("$$m.media.url");
    expect(fields.thumbnail).toEqual({
      $cond: [
        { $eq: ["$$m.media.kind", MEDIA_KIND.VIDEO] },
        "$$m.media.poster.url",
        "$$m.media.url",
      ],
    });
  });

  test("the key set has not moved", () => {
    expect(Object.keys(customerMediaFields({ withVideoMeta: false })).sort()).toEqual(
      ["_id", "altText", "createdAt", "sortOrder", "thumbnail", "title", "type", "url"],
    );
  });

  test("storage is never named, so it cannot leak", () => {
    const json = JSON.stringify(customerMediaFields());
    expect(json).not.toMatch(/storage|publicId|bucket|\.key/);
  });

  test("duration and resolution come off the media, not a metadata bag", () => {
    const shape = customerMediaFields({ withVideoMeta: true });
    const videoBranch = shape.$cond[1];

    expect(videoBranch.duration).toEqual({ $ifNull: ["$$m.media.duration", 0] });
    expect(videoBranch.resolution).toEqual({
      width: "$$m.media.width",
      height: "$$m.media.height",
    });
  });
});

describe("counts and filters ask the file, not a label", () => {
  test("a photo count includes GIFs", () => {
    expect(countMediaOfType("$x", SHOWCASE_MEDIA_TYPE.PHOTO)).toEqual({
      $size: {
        $filter: {
          input: "$x",
          as: "m",
          cond: { $in: ["$$m.media.kind", [MEDIA_KIND.IMAGE, MEDIA_KIND.GIF]] },
        },
      },
    });
  });

  test("clip eligibility tests media.kind directly", () => {
    expect(clipEligibleMediaCondition("m").$and[0]).toEqual({
      $eq: ["$$m.media.kind", MEDIA_KIND.VIDEO],
    });
  });

  test("getExistingMediaCounts counts a GIF against the image ceiling", () => {
    const counts = getExistingMediaCounts([
      item(),
      item({ media: photoMedia({ kind: MEDIA_KIND.GIF }) }),
      item({ media: videoMedia() }),
      item({ media: videoMedia(), isDeleted: true }),
    ]);

    expect(counts).toEqual({ images: 2, videos: 1 });
  });
});

describe("uploadSingleMedia — what it refuses before paying for an upload", () => {
  const { uploadSingleMedia } = require("../../helpers/showcases/upload");
  const storageFacade = require("../../services/storage");
  const { UPLOAD_PURPOSE } = require("../../constants/storage");

  const who = { userId: "u1", role: "VENDOR" };

  /**
   * ⚠️ A `describeIncoming` result, not a raw file (U-3).
   *
   * The helper takes a description now — `{ name, mimetype, size }` plus exactly
   * one of `file` or `uploadId` — so every rule below reads the same fields
   * whichever road the item came down. `presigned()` is the same item arriving
   * as an id instead.
   */
  const item = (mimetype) => ({
    name: "clip",
    mimetype,
    size: 10,
    uploadId: null,
    file: { mimetype, tempFilePath: "/tmp/x" },
  });
  const presigned = (mimetype) => ({
    name: "clip",
    mimetype,
    size: 10,
    uploadId: "68f1a2b3c4d5e6f7a8b9e001",
    file: null,
  });

  let acceptSpy;
  beforeEach(() => {
    acceptSpy = jest
      .spyOn(storageFacade, "acceptUpload")
      .mockImplementation(async ({ file, purpose }) => ({
        url: `https://cdn.example.com/x-${purpose}.webp`,
        storage: storageRef,
        metadata: {
          mimeType: file?.mimetype ?? "image/webp",
          size: 10,
          width: 8,
          height: 6,
        },
      }));
  });
  afterEach(() => acceptSpy.mockRestore());

  const refusal = async (...args) => {
    try {
      await uploadSingleMedia(...args);
      return null;
    } catch (error) {
      return { status: error.statusCode ?? error.status, message: error.message };
    }
  };

  test("no file at all", async () => {
    expect(await refusal(who, undefined, "s1")).toMatchObject({
      status: 400,
      message: "Media file is required.",
    });
  });

  test("a PDF is not gallery media", async () => {
    expect(await refusal(who, item("application/pdf"), "s1")).toMatchObject({
      status: 400,
      message: "Unsupported media type.",
    });
  });

  /**
   * 🔴 Checked here rather than at `save()`.
   *
   * `mediaSchema` refuses it either way — but by then the video bytes are
   * uploaded and paid for, and the error names a schema path instead of the form
   * field the caller has to fix.
   */
  test("a video with no poster is refused before the upload", async () => {
    const answer = await refusal(who, item("video/mp4"), "s1");

    expect(answer.status).toBe(422);
    // Both roads named, because the caller may be on either one.
    expect(answer.message).toContain("thumbnail");
    expect(answer.message).toContain("thumbnailUploadIds");
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  test("the same is true of a presigned video", async () => {
    const answer = await refusal(who, presigned("video/mp4"), "s1");

    expect(answer.status).toBe(422);
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  test("a poster that is itself a video is refused", async () => {
    expect(
      await refusal(who, item("video/mp4"), "s1", item("video/mp4")),
    ).toMatchObject({
      status: 422,
      message: expect.stringMatching(/poster has to be a still image/),
    });
    expect(acceptSpy).not.toHaveBeenCalled();
  });

  test("a GIF poster is refused too — a poster is a still frame", async () => {
    expect(
      await refusal(who, item("video/mp4"), "s1", item("image/gif")),
    ).toMatchObject({ status: 422 });
  });

  /**
   * 🔴 A GIF is an `image/*` file, so every "is this an image" check passes it —
   * which is how one ends up under `images/` and gets its animation flattened.
   *
   * ⚠️ The kind is no longer handed to the provider by this helper; the facade
   * derives it from the mime. So what this pins is the **stored** kind, which is
   * what decides the prefix and what every reader downstream believes.
   */
  test("a GIF routes as a GIF, not as an image", async () => {
    const media = await uploadSingleMedia(who, item("image/gif"), "s1");

    expect(media.kind).toBe(MEDIA_KIND.GIF);
  });

  test("a video uploads its poster and stores it on the media", async () => {
    const media = await uploadSingleMedia(
      who,
      item("video/mp4"),
      "s1",
      item("image/webp"),
    );

    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(media.poster).toMatchObject({ url: expect.stringContaining("http") });

    /**
     * 🔴 The video under `SHOWCASE_MEDIA`, the poster under
     * `SHOWCASE_THUMBNAIL`. Same bucket and prefix, different allowance: a
     * poster is capped at 10 MB and refuses VIDEO outright. This path used to
     * send the poster as `SHOWCASE_MEDIA` and buy it a video's 50 MB.
     */
    expect(acceptSpy).toHaveBeenNthCalledWith(
      1,
      who,
      expect.objectContaining({ purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA }),
    );
    expect(acceptSpy).toHaveBeenNthCalledWith(
      2,
      who,
      expect.objectContaining({ purpose: UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL }),
    );
  });

  /**
   * ⚠️ The actor reaches the facade. It looks an upload intent up by id **and**
   * owner, so dropping it makes every presigned upload answer "not found" — and
   * nothing on the multipart road would notice, because that road never reads it.
   */
  test("a presigned item is handed to the facade as an id, with its actor", async () => {
    await uploadSingleMedia(who, presigned("image/webp"), "s1");

    expect(acceptSpy).toHaveBeenCalledWith(
      who,
      expect.objectContaining({
        uploadId: "68f1a2b3c4d5e6f7a8b9e001",
        file: null,
        entityId: "s1",
      }),
    );
  });

  test("a photo needs no poster", async () => {
    const media = await uploadSingleMedia(who, item("image/webp"), "s1");

    expect(media.kind).toBe(MEDIA_KIND.IMAGE);
    expect(media.poster).toBeUndefined();
  });
});

describe("prepareMediaDocuments", () => {
  test("the whole media value goes in as one field", () => {
    const [prepared] = prepareMediaDocuments([photoMedia()], 4);

    expect(prepared.media).toEqual(photoMedia());
    expect(prepared.sortOrder).toBe(4);
    expect(prepared).not.toHaveProperty("type");
    expect(prepared).not.toHaveProperty("url");
  });

  test("title and altText come from the uploaded file's own name", () => {
    const [prepared] = prepareMediaDocuments([photoMedia()], 1);

    expect(prepared.title).toBe("sunset");
    expect(prepared.altText).toBe("sunset");
  });

  test("a photo is stored with the clips flag off, whatever was asked for", () => {
    const [prepared] = prepareMediaDocuments([photoMedia()], 1, true);
    expect(prepared.isShowInVideoClips).toBe(false);
  });

  test("a video keeps the flag it was given", () => {
    expect(prepareMediaDocuments([videoMedia()], 1, true)[0].isShowInVideoClips).toBe(
      true,
    );
    expect(
      prepareMediaDocuments([videoMedia()], 1, false)[0].isShowInVideoClips,
    ).toBe(false);
  });
});

describe("🔴 the title a file gives itself has to fit the field", () => {
  const {
    getFileNameWithoutExtension,
  } = require("../../helpers/showcases/validateMedia");

  /**
   * ⚠️ `title` is capped at 100 characters and `altText` at 150 by the update
   * endpoint — but `prepareMediaDocuments` writes both directly, from the file's
   * own name. A long filename therefore produced a media the vendor could look
   * at and **not edit**: every save of it was refused for a value they never
   * typed and could not see the length of.
   *
   * Found by mutation. Removing the cap left every other test green, because
   * every fixture had a short name.
   */
  test("a very long filename is cut to the field's own limit", () => {
    const name = `${"a".repeat(300)}.jpg`;

    expect(getFileNameWithoutExtension(name)).toHaveLength(100);
  });

  test("an ordinary name is left exactly as it is", () => {
    expect(getFileNameWithoutExtension("a quiet corner.jpg")).toBe(
      "a quiet corner",
    );
  });

  /**
   * ⚠️ `path.parse` drops any directory part, so a name a client controls
   * cannot carry one into a stored field.
   */
  test("a path in the name keeps only the last segment", () => {
    expect(getFileNameWithoutExtension("../../etc/passwd.png")).toBe("passwd");
  });

  test("no name at all is an empty string, not a crash", () => {
    expect(getFileNameWithoutExtension(undefined)).toBe("");
  });
});

describe("🔴 the showcase validator refuses a malformed uploadId", () => {
  const {
    validateAddMedia,
    validateReplaceMedia,
    validateUpdateMedia,
  } = require("../../validator/showcase");

  const messages = (schema, body) =>
    schema.validate(body, { abortEarly: false }).error?.details.map(
      (detail) => detail.message,
    ) ?? [];

  /**
   * ⚠️ The first gate, and the only one that answers before anything is loaded —
   * so a malformed id never becomes a database lookup, and never becomes a `404`
   * that reads as if the upload had expired.
   */
  test("add-media refuses a bad id in either list", () => {
    expect(messages(validateAddMedia.body, { uploadIds: ["nope"] })).toContain(
      "Invalid uploadId.",
    );
    expect(
      messages(validateAddMedia.body, { thumbnailUploadIds: ["nope"] }),
    ).toContain("Invalid thumbnailUploadId.");
  });

  test("replace and update refuse one too", () => {
    expect(messages(validateReplaceMedia.body, { uploadId: "nope" })).toContain(
      "Invalid uploadId.",
    );
    expect(
      messages(validateUpdateMedia.body, { thumbnailUploadId: "nope" }),
    ).toContain("Invalid thumbnailUploadId.");
  });

  test("a real id is accepted, as a list or on its own", () => {
    const id = "68f1a2b3c4d5e6f7a8b9e001";

    expect(messages(validateAddMedia.body, { uploadIds: [id] })).toEqual([]);
    // ⚠️ `.single()` — a form sending one value does not send an array.
    expect(messages(validateAddMedia.body, { uploadIds: id })).toEqual([]);
    expect(messages(validateReplaceMedia.body, { uploadId: id })).toEqual([]);
  });
});
