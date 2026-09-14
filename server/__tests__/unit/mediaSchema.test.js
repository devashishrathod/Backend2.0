const mongoose = require("mongoose");

const { mediaSchema } = require("../../models/mediaSchema");
const {
  toMediaResponse,
  toMediaListResponse,
} = require("../../helpers/media/toMediaResponse");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * One shape for every stored file, and one rule about what leaves the server.
 *
 * 🔴 Two public endpoints were found handing out storage internals — the voucher
 * detail (`images[].storage.bucket`, `.key`) and the ticker feed
 * (`icon.storage.publicId`). Both were written by people who knew the rule.
 * Both missed it, because the rule lived in whichever `$project` or `.map()`
 * happened to be nearest.
 */

/** A throwaway model, so the sub-schema's own validation really runs. */
const Holder = mongoose.model(
  `MediaHolder_${Date.now()}`,
  new mongoose.Schema({ media: { type: mediaSchema, default: undefined } }),
);

const validate = (media) => new Holder({ media }).validateSync();

const image = (over = {}) => ({
  url: "https://cdn.example.com/a.webp",
  kind: MEDIA_KIND.IMAGE,
  mimeType: "image/webp",
  sizeBytes: 12345,
  width: 800,
  height: 600,
  storage: {
    provider: STORAGE_PROVIDER.AWS_S3,
    bucket: "trydood-nonprod-public",
    key: "dev/images/brands/b1/a.webp",
  },
  ...over,
});

const video = (over = {}) => ({
  url: "https://cdn.example.com/v.mp4",
  kind: MEDIA_KIND.VIDEO,
  mimeType: "video/mp4",
  duration: 12,
  width: 1920,
  height: 1080,
  poster: {
    url: "https://cdn.example.com/v.jpg",
    storage: {
      provider: STORAGE_PROVIDER.AWS_S3,
      bucket: "trydood-nonprod-public",
      key: "dev/images/brands/b1/v.jpg",
    },
  },
  ...over,
});

describe("🔴 a video must carry its poster", () => {
  test("without one it does not validate", () => {
    // ⚠️ This started life as a `pre("validate")` hook calling
    // `this.invalidate()`. On a single nested sub-document that does not reach
    // the parent's error list — a VIDEO with no poster validated completely
    // clean. A conditional `required` does, and names the right path.
    const error = validate(video({ poster: undefined }));

    expect(error).toBeTruthy();
    expect(error.errors["media.poster"].message).toMatch(/needs a poster/);
  });

  test("a poster with no URL is not a poster", () => {
    const error = validate(video({ poster: { width: 10 } }));
    expect(error.errors["media.poster.url"]).toBeTruthy();
  });

  test("with one it is fine", () => {
    expect(validate(video())).toBeUndefined();
  });

  test("⚠️ and the rule is only about video", () => {
    // A photo is its own poster, and a document has none to have.
    expect(validate(image())).toBeUndefined();
    expect(
      validate({
        url: "https://cdn.example.com/i.pdf",
        kind: MEDIA_KIND.DOCUMENT,
      }),
    ).toBeUndefined();
  });

  test("a GIF needs no poster either — it is its own first frame", () => {
    expect(
      validate({ url: "https://cdn.example.com/a.gif", kind: MEDIA_KIND.GIF }),
    ).toBeUndefined();
  });
});

describe("the shape itself", () => {
  test("url and kind are the two things every file must have", () => {
    expect(validate({ kind: MEDIA_KIND.IMAGE })).toBeTruthy();
    expect(validate({ url: "https://x/a.png" })).toBeTruthy();
  });

  test("the provider enum comes from the constant, and says AWS_S3", () => {
    // Four models used to write `["CLOUDINARY", "S3"]` out by hand, so renaming
    // a provider would have left them validating a value nothing else used.
    const enumValues = mediaSchema.path("storage").schema.path("provider")
      .enumValues;

    expect(enumValues).toEqual(Object.values(STORAGE_PROVIDER));
    expect(enumValues).toContain("AWS_S3");
    expect(enumValues).not.toContain("S3");
  });

  test("⚠️ storage is absent by default, never an empty object", () => {
    // `{}` reads as `provider: undefined`, which the facade refuses outright.
    // Absent means "written before this existed"; `{}` means "written by
    // something broken".
    const held = new Holder({ media: { url: "https://x/a.png", kind: "IMAGE" } });
    expect(held.media.storage).toBeUndefined();
  });
});

describe("🔴 what reaches a client", () => {
  test("the default is a plain URL string", async () => {
    // `brand.logo` is a String today and every client reads it as one. Storing
    // a richer object must not move the wire, or the migration becomes a
    // rewrite of the panel and the app.
    expect(toMediaResponse(image())).toBe("https://cdn.example.com/a.webp");
  });

  test("storage never ships, in either shape", () => {
    for (const shape of [
      toMediaResponse(video()),
      toMediaResponse(video(), { withMeta: true }),
    ]) {
      const body = JSON.stringify(shape);
      expect(body).not.toMatch(/storage/);
      expect(body).not.toMatch(/trydood-nonprod-public/);
      expect(body).not.toMatch(/dev\/images/);
    }
  });

  test("⚠️ a video's poster is flattened to its URL", () => {
    // Passing the object through would carry `poster.storage` out with it —
    // the exact leak the helper exists to make impossible.
    const shape = toMediaResponse(video(), { withMeta: true });

    expect(shape.poster).toBe("https://cdn.example.com/v.jpg");
    expect(typeof shape.poster).toBe("string");
  });

  test("withMeta names its fields, so a new column cannot leak by default", () => {
    const shape = toMediaResponse(
      image({ secretInternalField: "do not show anyone" }),
      { withMeta: true },
    );

    expect(Object.keys(shape).sort()).toEqual(["height", "kind", "url", "width"]);
    expect(JSON.stringify(shape)).not.toMatch(/do not show anyone/);
  });

  test("duration only where it means something", () => {
    // Reporting `0` under a still image invites a client to render "0:00".
    expect(toMediaResponse(image(), { withMeta: true })).not.toHaveProperty(
      "duration",
    );
    expect(toMediaResponse(video(), { withMeta: true }).duration).toBe(12);
  });

  test("a poster key appears only on a video", () => {
    expect(toMediaResponse(image(), { withMeta: true })).not.toHaveProperty(
      "poster",
    );
  });
});

describe("rows written before any of this", () => {
  test("a bare URL string answers the same question the same way", () => {
    expect(toMediaResponse("https://old.example.com/x.jpg")).toBe(
      "https://old.example.com/x.jpg",
    );
    expect(
      toMediaResponse("https://old.example.com/x.jpg", { withMeta: true }),
    ).toEqual({ url: "https://old.example.com/x.jpg", kind: null });
  });

  test("nothing is null, not a crash", () => {
    expect(toMediaResponse(null)).toBeNull();
    expect(toMediaResponse(undefined)).toBeNull();
    expect(toMediaResponse({}, { withMeta: true })).toMatchObject({ url: null });
  });

  test("a list keeps its order and its nulls", () => {
    expect(toMediaListResponse([image(), null])).toEqual([
      "https://cdn.example.com/a.webp",
      null,
    ]);
    expect(toMediaListResponse()).toEqual([]);
  });
});
