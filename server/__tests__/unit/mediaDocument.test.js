const mongoose = require("mongoose");

const { toMediaDocument, toDeletable } = require("../../helpers/media");
const { mediaSchema } = require("../../models/mediaSchema");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * What every upload site used to write, and what it writes now.
 *
 * 🔴 Eleven services each wrote their own two lines — `image: uploaded.url` and
 * `imageStorage: uploaded.storage`. That is how the platform came to know a URL
 * and a bucket and **nothing else** about the file it was serving: no size, no
 * dimensions, no mime type, no kind. Eleven places writing two fields each is
 * also eleven places to forget the third when one is added.
 */

/** A `storage.uploadFromPath` result, as both providers really return it. */
const uploaded = (over = {}) => ({
  url: "https://cdn.example.com/dev/images/brands/b1/x.webp",
  thumbnail: "https://cdn.example.com/dev/images/brands/b1/x.webp",
  storage: {
    provider: STORAGE_PROVIDER.AWS_S3,
    publicId: null,
    bucket: "trydood-nonprod-public",
    key: "dev/images/brands/b1/x.webp",
  },
  metadata: {
    originalName: "logo.webp",
    mimeType: "image/webp",
    format: "webp",
    size: 24680,
    width: 512,
    height: 512,
    duration: 0,
  },
  ...over,
});

/** A throwaway holder, so the real sub-schema validates what we build. */
const Holder = mongoose.model(
  `MediaDoc_${Date.now()}`,
  new mongoose.Schema({ media: { type: mediaSchema, default: undefined } }),
);

describe("what a model now stores about a file", () => {
  test("everything the provider knew, not just the URL and the bucket", () => {
    expect(toMediaDocument(uploaded())).toEqual({
      url: "https://cdn.example.com/dev/images/brands/b1/x.webp",
      storage: {
        provider: "AWS_S3",
        publicId: null,
        bucket: "trydood-nonprod-public",
        key: "dev/images/brands/b1/x.webp",
      },
      kind: MEDIA_KIND.IMAGE,
      mimeType: "image/webp",
      sizeBytes: 24680,
      width: 512,
      height: 512,
      duration: 0,
      originalName: "logo.webp",
    });
  });

  test("and what it builds actually validates", () => {
    const error = new Holder({ media: toMediaDocument(uploaded()) }).validateSync();
    expect(error).toBeUndefined();
  });

  test("🔴 a GIF is stored as a GIF, not as an image", () => {
    // Every surface used to answer this with `startsWith("image")`, which a GIF
    // passes — and that decides the object's prefix, which decides whether the
    // resize step flattens the animation.
    const media = toMediaDocument(
      uploaded({ metadata: { mimeType: "image/gif" } }),
    );
    expect(media.kind).toBe(MEDIA_KIND.GIF);
  });

  test("⚠️ an unresolvable mime type throws rather than guessing IMAGE", () => {
    // A wrong `kind` is worse than a failed upload: nothing downstream would
    // ever question it, and it silently picks the wrong prefix.
    expect(() =>
      toMediaDocument(uploaded({ metadata: { mimeType: "application/zip" } })),
    ).toThrow(/no kind for/);

    expect(() => toMediaDocument(uploaded({ metadata: {} }))).toThrow(
      /no mime type/,
    );
  });

  test("a caller that already knows the kind can say so", () => {
    const media = toMediaDocument(uploaded({ metadata: {} }), {
      kind: MEDIA_KIND.DOCUMENT,
    });
    expect(media.kind).toBe(MEDIA_KIND.DOCUMENT);
  });

  test("a missing metadata block does not become NaN or undefined", () => {
    const media = toMediaDocument(uploaded({ metadata: { mimeType: "image/png" } }));
    expect(media).toMatchObject({
      sizeBytes: 0,
      width: null,
      height: null,
      duration: 0,
      originalName: null,
    });
  });

  test("⚠️ no poster means no `poster` key, not a key holding undefined", () => {
    // Today these behave alike — Mongoose treats an undefined path as absent,
    // and Jest's `toEqual` ignores undefined keys, which is why a mutation that
    // dropped the guard survived until this test existed.
    //
    // The difference bites the day somebody spreads this onto an existing
    // document: `{ ...current, poster: undefined }` **erases** a poster that was
    // already there. An absent key cannot.
    expect(Object.keys(toMediaDocument(uploaded()))).not.toContain("poster");
  });

  test("nothing uploaded is null, not a half-built object", () => {
    expect(toMediaDocument(null)).toBeNull();
    expect(toMediaDocument({})).toBeNull();
  });

  test("a video carries its poster through", () => {
    const media = toMediaDocument(
      uploaded({ metadata: { mimeType: "video/mp4", duration: 12 } }),
      { poster: { url: "https://cdn.example.com/p.jpg" } },
    );
    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(new Holder({ media }).validateSync()).toBeUndefined();
  });
});

describe("deleting, before and after the migration", () => {
  test("a media field is already the shape the deleter wants", () => {
    // `deleteAsset` takes `{ url, storage }`, and a mediaSchema value **is**
    // that — so the new field passes straight through with no adapter.
    const media = toMediaDocument(uploaded());
    expect(toDeletable(media, "https://old/x.png")).toBe(media);
  });

  test("⚠️ a row written before the field still deletes by its URL", () => {
    // Otherwise the migration would strand every file uploaded before it.
    expect(toDeletable(undefined, "https://old/x.png")).toEqual({
      url: "https://old/x.png",
    });
    expect(toDeletable(null, "https://old/x.png")).toEqual({
      url: "https://old/x.png",
    });
  });

  test("nothing to delete is null, so callers can skip it", () => {
    expect(toDeletable(null, null)).toBeNull();
    expect(toDeletable(undefined, undefined)).toBeNull();
    expect(toDeletable({}, null)).toBeNull();
  });
});
