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

  const file = (mimetype) => ({ mimetype, tempFilePath: "/tmp/x" });

  let uploadSpy;
  beforeEach(() => {
    uploadSpy = jest
      .spyOn(storageFacade, "uploadFromPath")
      .mockImplementation(async ({ kind }) => ({
        url: `https://cdn.example.com/x.${kind === MEDIA_KIND.VIDEO ? "mp4" : "webp"}`,
        storage: storageRef,
        metadata: { mimeType: "image/webp", size: 10, width: 8, height: 6 },
      }));
  });
  afterEach(() => uploadSpy.mockRestore());

  const refusal = async (...args) => {
    try {
      await uploadSingleMedia(...args);
      return null;
    } catch (error) {
      return { status: error.statusCode ?? error.status, message: error.message };
    }
  };

  test("no file at all", async () => {
    expect(await refusal(undefined, "s1")).toMatchObject({
      status: 400,
      message: "Media file is required.",
    });
  });

  test("a PDF is not gallery media", async () => {
    expect(await refusal(file("application/pdf"), "s1")).toMatchObject({
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
    expect(await refusal(file("video/mp4"), "s1")).toMatchObject({
      status: 422,
      message: 'A video needs a poster image. Attach one as "thumbnail".',
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a poster that is itself a video is refused", async () => {
    expect(
      await refusal(file("video/mp4"), "s1", file("video/mp4")),
    ).toMatchObject({
      status: 422,
      message: expect.stringMatching(/poster has to be a still image/),
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a GIF poster is refused too — a poster is a still frame", async () => {
    expect(
      await refusal(file("video/mp4"), "s1", file("image/gif")),
    ).toMatchObject({ status: 422 });
  });

  /**
   * 🔴 A GIF is an `image/*` file, so every "is this an image" check passes it —
   * which is how one ends up under `images/` and gets its animation flattened.
   * The kind goes to the facade explicitly so it lands under `gifs/`.
   */
  test("a GIF routes as a GIF, not as an image", async () => {
    const media = await uploadSingleMedia(file("image/gif"), "s1");

    expect(media.kind).toBe(MEDIA_KIND.GIF);
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: MEDIA_KIND.GIF }),
    );
  });

  test("a video uploads its poster and stores it on the media", async () => {
    const media = await uploadSingleMedia(
      file("video/mp4"),
      "s1",
      file("image/webp"),
    );

    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(media.poster).toMatchObject({ url: expect.stringContaining("http") });
    // The video with its own kind, then the poster forced to IMAGE.
    expect(uploadSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: MEDIA_KIND.VIDEO }),
    );
    expect(uploadSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: MEDIA_KIND.IMAGE }),
    );
  });

  test("a photo needs no poster", async () => {
    const media = await uploadSingleMedia(file("image/webp"), "s1");

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
