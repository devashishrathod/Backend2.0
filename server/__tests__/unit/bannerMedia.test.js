const mongoose = require("mongoose");

const Banner = require("../../models/Banner");
const PromotionalTicker = require("../../models/PromotionalTicker");
const { toAdminBannerShape } = require("../../helpers/banners/shape");
const { toAdminTickerShape } = require("../../helpers/promotionalTickers/shape");
const { toMediaResponse } = require("../../helpers/media/toMediaResponse");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");
const { BANNER_MEDIA_KINDS } = require("../../constants/banner");

/**
 * M-3 — one `media` where there used to be `type` plus three subdocuments.
 *
 * ### What is actually at risk here
 *
 * Two things, and they pull in opposite directions:
 *
 *   1. **The customer contract must not move.** `GET /banners/customer/active`
 *      answered `{_id, type, url, redirect}` before and has to answer exactly
 *      that after, or every app build in the wild breaks for a storage refactor
 *      they cannot see.
 *   2. **The admin contract must move**, because it was handing out
 *      `storage.publicId` / `bucket` / `key` — the same class of leak A-3 found
 *      on the public ticker feed, just behind a login.
 *
 * So the customer tests below assert *sameness* and the admin tests assert
 * *absence*.
 */

const ADMIN = new mongoose.Types.ObjectId();

const storageRef = {
  provider: STORAGE_PROVIDER.AWS_S3,
  bucket: "trydood-nonprod-public",
  key: "dev/images/banners/b1/a.webp",
};

const imageMedia = (over = {}) => ({
  url: "https://cdn.example.com/a.webp",
  kind: MEDIA_KIND.IMAGE,
  mimeType: "image/webp",
  sizeBytes: 84213,
  originalName: "sale.webp",
  storage: storageRef,
  ...over,
});

const videoMedia = (over = {}) => ({
  url: "https://cdn.example.com/v.mp4",
  kind: MEDIA_KIND.VIDEO,
  mimeType: "video/mp4",
  duration: 12,
  storage: storageRef,
  poster: {
    url: "https://cdn.example.com/v.jpg",
    storage: { ...storageRef, key: "dev/images/banners/b1/v.jpg" },
  },
  ...over,
});

const banner = (over = {}) =>
  new Banner({
    title: "Fixture banner",
    media: imageMedia(),
    createdBy: ADMIN,
    ...over,
  });

const ticker = (over = {}) =>
  new PromotionalTicker({
    title: "Fixture ticker",
    icon: imageMedia(),
    displayOrder: 1,
    createdBy: ADMIN,
    ...over,
  });

/** The error message on one path, or `null` when that path validated. */
const errorOn = (doc, path) => doc.validateSync()?.errors?.[path]?.message ?? null;

describe("Banner.media — one field, and it has to be locatable", () => {
  test("a banner with media validates", () => {
    expect(banner().validateSync()).toBeUndefined();
  });

  test("a banner with no media is refused", () => {
    expect(errorOn(banner({ media: undefined }), "media")).toBe(
      "A banner needs a media file.",
    );
  });

  /**
   * 🔴 The invariant the three-field shape could not express.
   *
   * `type: "VIDEO"` beside bytes sitting in `image` was a document mongoose was
   * perfectly happy with, and the renderer then showed a still under a play
   * button. There is one field now, so the kind cannot disagree with the file.
   */
  test("a banner cannot be a document or an audio clip", () => {
    const message = errorOn(
      banner({ media: imageMedia({ kind: MEDIA_KIND.DOCUMENT }) }),
      "media",
    );
    expect(message).toMatch(/cannot be a DOCUMENT/);
    expect(message).toMatch(/IMAGE, VIDEO, GIF/);
  });

  test("all three banner kinds are accepted", () => {
    for (const kind of BANNER_MEDIA_KINDS) {
      const media =
        kind === MEDIA_KIND.VIDEO ? videoMedia() : imageMedia({ kind });
      expect(banner({ media }).validateSync()).toBeUndefined();
    }
  });

  /**
   * ⚠️ Inherited from `mediaSchema`, not restated here — which is the point of
   * having one schema. A video banner with no poster opens on a blank frame.
   */
  test("a video banner with no poster is refused", () => {
    expect(
      errorOn(banner({ media: videoMedia({ poster: undefined }) }), "media.poster"),
    ).toBe("A video needs a poster image. Upload one alongside the video.");
  });
});

describe("PromotionalTicker.icon — still images only", () => {
  test("an image icon validates", () => {
    expect(ticker().validateSync()).toBeUndefined();
  });

  test("a ticker with no icon is refused", () => {
    expect(errorOn(ticker({ icon: undefined }), "icon")).toBe(
      "A ticker needs an icon.",
    );
  });

  /**
   * The strip scrolls inline text with a small icon beside it. There is no
   * player there and nothing paints a poster frame, so a video has nowhere to
   * render — and an animated GIF is a distraction nobody chose.
   */
  test("a video or a GIF icon is refused", () => {
    expect(errorOn(ticker({ icon: videoMedia() }), "icon")).toMatch(
      /still image, not a VIDEO/,
    );
    expect(
      errorOn(ticker({ icon: imageMedia({ kind: MEDIA_KIND.GIF }) }), "icon"),
    ).toMatch(/still image, not a GIF/);
  });
});

describe("toMediaResponse — the admin shape", () => {
  test("useful detail is there", () => {
    const shape = toMediaResponse(imageMedia(), { forAdmin: true });

    expect(shape).toMatchObject({
      url: "https://cdn.example.com/a.webp",
      kind: MEDIA_KIND.IMAGE,
      mimeType: "image/webp",
      sizeBytes: 84213,
      originalName: "sale.webp",
      provider: STORAGE_PROVIDER.AWS_S3,
    });
  });

  /**
   * 🔴 The line between "more detail" and "the address of the file".
   *
   * `provider` answers *where does this live*. `bucket` and `key` answer *how do
   * I fetch it myself* — which is what turns a leaked response into a readable
   * object. The panel needs the first during a migration and has never needed
   * the second.
   */
  test("the locator never is", () => {
    const shape = toMediaResponse(imageMedia(), { forAdmin: true });

    expect(shape).not.toHaveProperty("storage");
    expect(shape).not.toHaveProperty("bucket");
    expect(shape).not.toHaveProperty("key");
    expect(shape).not.toHaveProperty("publicId");
    expect(JSON.stringify(shape)).not.toMatch(/trydood-nonprod-public|dev\/images/);
  });

  test("a video's poster goes out as `thumbnail`, storage and all stripped", () => {
    const shape = toMediaResponse(videoMedia(), { forAdmin: true });

    expect(shape.thumbnail).toBe("https://cdn.example.com/v.jpg");
    expect(shape.duration).toBe(12);
    expect(JSON.stringify(shape)).not.toMatch(/bucket|key|publicId/);
  });

  test("the default is still a bare URL string", () => {
    expect(toMediaResponse(imageMedia())).toBe("https://cdn.example.com/a.webp");
  });

  test("provider is null when a legacy row has no storage", () => {
    expect(
      toMediaResponse({ url: "https://old.example.com/x.jpg" }, { forAdmin: true }),
    ).toMatchObject({ provider: null, kind: null });
  });
});

describe("toAdminBannerShape — a whitelist, not a document", () => {
  test("the panel gets what it manages", () => {
    const shape = toAdminBannerShape(banner({ description: "Monsoon sale" }));

    expect(Object.keys(shape).sort()).toEqual([
      "_id",
      "createdAt",
      "createdBy",
      "description",
      "endDate",
      "isActive",
      "media",
      "redirect",
      "startDate",
      "title",
      "updatedAt",
      "updatedBy",
    ]);
  });

  /**
   * ⚠️ `isDeleted` is deliberately absent. Every admin read already filters
   * `isDeleted: false`, so the field is always `false` in a response — a column
   * that can only ever say one thing, inviting a panel to build a filter on it
   * that does nothing.
   */
  test("no storage, and no bookkeeping the panel cannot act on", () => {
    const shape = toAdminBannerShape(banner());

    expect(shape).not.toHaveProperty("isDeleted");
    expect(JSON.stringify(shape)).not.toMatch(/bucket|publicId|"key"/);
  });

  /**
   * 🔴 There is no `type` key any more, on purpose. It was a second copy of
   * `media.kind` and the two could disagree.
   */
  test("the kind lives on the media, not beside it", () => {
    const shape = toAdminBannerShape(banner());

    expect(shape).not.toHaveProperty("type");
    expect(shape.media.kind).toBe(MEDIA_KIND.IMAGE);
  });

  test("null in, null out", () => {
    expect(toAdminBannerShape(null)).toBeNull();
  });
});

describe("the customer shape — the half that must NOT move", () => {
  const { toCustomerShape } = require("../../services/banners/getActiveBannersForCustomer");

  test("the keys the app already reads, plus thumbnail", () => {
    const shape = toCustomerShape({
      _id: ADMIN,
      title: "Secret internal title",
      media: imageMedia(),
      redirect: { type: "BRAND", targetId: ADMIN, url: null },
      isDeleted: false,
      createdBy: ADMIN,
    });

    expect(Object.keys(shape).sort()).toEqual([
      "_id",
      "redirect",
      "thumbnail",
      "type",
      "url",
    ]);
    expect(shape.type).toBe(MEDIA_KIND.IMAGE);
    expect(shape.url).toBe("https://cdn.example.com/a.webp");
    expect(shape.redirect).toEqual({
      type: "BRAND",
      targetId: ADMIN,
      url: null,
    });
  });

  test("a video answers VIDEO and the video's own url, not the poster's", () => {
    const shape = toCustomerShape({ _id: ADMIN, media: videoMedia() });

    expect(shape.type).toBe(MEDIA_KIND.VIDEO);
    expect(shape.url).toBe("https://cdn.example.com/v.mp4");
  });

  /**
   * 🔴 The whole reason a poster is mandatory.
   *
   * It was stored and then never sent for a while, which made the requirement
   * pointless: the app still showed a blank rectangle until the `.mp4` had
   * buffered a frame.
   */
  test("a video's thumbnail is its poster", () => {
    const shape = toCustomerShape({ _id: ADMIN, media: videoMedia() });

    expect(shape.thumbnail).toBe("https://cdn.example.com/v.jpg");
    expect(shape.thumbnail).not.toBe(shape.url);
  });

  /**
   * ⚠️ Never null for a banner that renders. A still is its own thumbnail, so
   * the client writes `<img src={thumbnail}>` once rather than branching on
   * `type` to find out which field holds a paintable image.
   */
  test("a still and a GIF are their own thumbnail", () => {
    for (const kind of [MEDIA_KIND.IMAGE, MEDIA_KIND.GIF]) {
      const shape = toCustomerShape({
        _id: ADMIN,
        media: imageMedia({ kind }),
      });
      expect(shape.thumbnail).toBe("https://cdn.example.com/a.webp");
      expect(shape.thumbnail).toBe(shape.url);
    }
  });

  test("a video with no poster answers null, not the .mp4", () => {
    // The upload path refuses this, but a row written another way must not
    // hand the app a video file to render as a still.
    const shape = toCustomerShape({
      _id: ADMIN,
      media: videoMedia({ poster: undefined }),
    });

    expect(shape.thumbnail).toBeNull();
  });

  test("no redirect answers NONE, never null", () => {
    expect(toCustomerShape({ _id: ADMIN, media: imageMedia() }).redirect).toEqual({
      type: "NONE",
      targetId: null,
      url: null,
    });
  });

  test("nothing from storage reaches the home screen", () => {
    const shape = toCustomerShape({
      _id: ADMIN,
      title: "Secret internal title",
      media: videoMedia(),
    });

    expect(JSON.stringify(shape)).not.toMatch(
      /bucket|publicId|"key"|Secret internal/,
    );
  });

  /**
   * ⚠️ A row written before the migration — `type` plus an `image` subdocument,
   * no `media`. There is no backfill by design (pre-launch data), so the honest
   * answer is nulls: visibly wrong rather than quietly wrong, and never a URL
   * pulled out of a field the schema no longer knows about.
   */
  test("a pre-migration row answers null, and still has every key", () => {
    const shape = toCustomerShape({
      _id: ADMIN,
      type: "image",
      image: { url: "https://res.cloudinary.com/x/image/upload/legacy.jpg" },
    });

    expect(shape.type).toBeNull();
    expect(shape.url).toBeNull();
    expect(shape.thumbnail).toBeNull();
    expect(Object.keys(shape).sort()).toEqual([
      "_id",
      "redirect",
      "thumbnail",
      "type",
      "url",
    ]);
  });
});

describe("uploadBannerMedia — what it refuses before paying for an upload", () => {
  const { uploadBannerMedia } = require("../../helpers/banners/media");
  const storage = require("../../services/storage");

  const file = (mimetype) => ({ mimetype, tempFilePath: "/tmp/x" });

  /**
   * ⚠️ The facade is stubbed, not reached.
   *
   * Every refusal below happens *before* any upload, which is the property being
   * tested — but one case is meant to get through, and without this it went all
   * the way to a real Cloudinary call and hung the suite.
   */
  let uploadSpy;
  beforeEach(() => {
    uploadSpy = jest.spyOn(storage, "uploadFromPath").mockResolvedValue({
      url: "https://cdn.example.com/x.gif",
      storage: storageRef,
      metadata: { mimeType: "image/gif", size: 1024 },
    });
  });
  afterEach(() => uploadSpy.mockRestore());

  /** The thrown status and message, or null when nothing was thrown. */
  const refusal = async (...args) => {
    try {
      await uploadBannerMedia(...args);
      return null;
    } catch (error) {
      return { status: error.statusCode ?? error.status, message: error.message };
    }
  };

  test("no file at all names the field to attach", async () => {
    expect(await refusal(undefined, ADMIN)).toMatchObject({
      status: 422,
      message: 'Please attach the banner file as "media".',
    });
  });

  test("a PDF is not a banner", async () => {
    expect(await refusal(file("application/pdf"), ADMIN)).toMatchObject({
      status: 422,
      message: expect.stringMatching(/image, a video or a GIF/),
    });
  });

  /**
   * 🔴 Checked here rather than at `save()`.
   *
   * `mediaSchema` would refuse it either way — but by then the video bytes are
   * uploaded and paid for, and the error names a schema path instead of the
   * form field the caller has to fix.
   */
  test("a video with no poster is refused before the upload", async () => {
    expect(await refusal(file("video/mp4"), ADMIN)).toMatchObject({
      status: 422,
      message: expect.stringMatching(/needs a poster image.*"poster"/s),
    });
  });

  test("a poster that is itself a video is refused", async () => {
    expect(
      await refusal(file("video/mp4"), ADMIN, file("video/mp4")),
    ).toMatchObject({
      status: 422,
      message: expect.stringMatching(/poster has to be a still image/),
    });
  });

  /**
   * 🔴 A GIF is an `image/*` file, so every "is this an image" check in the
   * codebase passes it — which is exactly how one ends up under `images/` and
   * gets its animation flattened by the resize step. The kind is passed to the
   * facade explicitly so it lands under `gifs/`, clear of the resizer.
   */
  test("an animated GIF is a banner, needs no poster, and routes as a GIF", async () => {
    const media = await uploadBannerMedia(file("image/gif"), ADMIN);

    expect(media.kind).toBe(MEDIA_KIND.GIF);
    expect(media.poster).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: MEDIA_KIND.GIF }),
    );
  });

  test("nothing is uploaded when the guard refuses", async () => {
    await refusal(file("application/pdf"), ADMIN);
    await refusal(file("video/mp4"), ADMIN);

    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe("toAdminTickerShape", () => {
  test("icon goes through the same whitelist", () => {
    const shape = toAdminTickerShape(ticker());

    expect(shape.icon).toMatchObject({
      url: "https://cdn.example.com/a.webp",
      kind: MEDIA_KIND.IMAGE,
      provider: STORAGE_PROVIDER.AWS_S3,
    });
    expect(JSON.stringify(shape)).not.toMatch(/bucket|publicId|"key"/);
  });

  test("isDeleted is not part of it either", () => {
    expect(toAdminTickerShape(ticker())).not.toHaveProperty("isDeleted");
  });
});
