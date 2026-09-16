const mongoose = require("mongoose");

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const { pickVoucherBanner } = require("../../helpers/vouchers/pickVoucherBanner");
const { pickOrphanImages } = require("../../helpers/vouchers/orphanImages");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * M-5 — the voucher's images and banner join the one media shape.
 *
 * ### What is at risk
 *
 *   1. **The customer contract must not move.** `images[]` answers
 *      `{_id, url, sortOrder}` and the banner answers `bannerType` /
 *      `bannerUrl`, exactly as before.
 *   2. **`bannerThumbnail` must arrive.** A video banner's poster is mandatory
 *      at upload now, and storing it without sending it makes the requirement
 *      pointless — this is the M-3a rule reaching the last surface that owed it.
 *   3. **Nothing may write the provider enum by hand again** (P11), and no row
 *      may carry three empty banner objects (P9).
 */

const OID = () => new mongoose.Types.ObjectId();

const storageRef = {
  provider: STORAGE_PROVIDER.AWS_S3,
  bucket: "trydood-nonprod-public",
  key: "dev/images/vouchers/v1/a.webp",
};

const imageMedia = (over = {}) => ({
  url: "https://cdn.example.com/a.webp",
  kind: MEDIA_KIND.IMAGE,
  mimeType: "image/webp",
  sizeBytes: 2048,
  storage: storageRef,
  ...over,
});

const videoMedia = (over = {}) => ({
  url: "https://cdn.example.com/v.mp4",
  kind: MEDIA_KIND.VIDEO,
  mimeType: "video/mp4",
  duration: 18,
  storage: storageRef,
  poster: {
    url: "https://cdn.example.com/v.jpg",
    storage: { ...storageRef, key: "dev/images/vouchers/v1/v.jpg" },
  },
  ...over,
});

const errorOn = (doc, path) => doc.validateSync()?.errors?.[path]?.message ?? null;

/**
 * ⚠️ A **fully valid** voucher apart from the banner.
 *
 * The banner tests assert on `validateSync()` as a whole, so anything else
 * missing here would show up as a banner failure that is not one —
 * `normalizedName` and the `VCH-\d{8}` code shape are both required.
 */
const voucher = (banner) =>
  new Voucher({
    createdBy: OID(),
    brandId: OID(),
    name: "Lunch deal",
    normalizedName: "lunch deal",
    voucherCode: "VCH-00000001",
    ...(banner ? { banner } : {}),
  });

describe("VoucherVersion.images — one media, one position", () => {
  const version = (images) =>
    new VoucherVersion({
      voucherId: OID(),
      brandId: OID(),
      createdBy: OID(),
      versionCode: "VCH-000001-V1",
      versionNumber: 1,
      name: "Lunch deal",
      categoryId: OID(),
      subCategoryId: OID(),
      images,
      offers: [
        {
          title: "20% off",
          discountType: "PERCENTAGE",
          discountValue: 20,
          sortOrder: 1,
        },
      ],
      startAt: new Date(),
      endAt: new Date(Date.now() + 86400000),
    });

  test("an image with its media and position validates", () => {
    const doc = version([{ media: imageMedia(), sortOrder: 1 }]);
    expect(doc.validateSync()?.errors?.["images.0.media"]).toBeUndefined();
  });

  test("an image with no media is refused", () => {
    expect(errorOn(version([{ sortOrder: 1 }]), "images.0.media")).toBe(
      "An image file is required.",
    );
  });

  /**
   * 🔴 `max: 5` is gone (P4).
   *
   * The real ceiling lives in `VOUCHER_OFFER_LIMITS.MAX_IMAGES` and is heading
   * for the Setting (V-1). A second, hard-coded copy on the position field could
   * only ever disagree with it — and the model's copy would win, refusing a
   * sixth image with a schema error naming no limit the vendor had been shown.
   */
  test("a position past five is not a schema error any more", () => {
    const doc = version([{ media: imageMedia(), sortOrder: 9 }]);
    expect(doc.validateSync()?.errors?.["images.0.sortOrder"]).toBeUndefined();
  });

  test("a position below one still is", () => {
    const doc = version([{ media: imageMedia(), sortOrder: 0 }]);
    expect(doc.validateSync()?.errors?.["images.0.sortOrder"]).toBeTruthy();
  });

  test("the image row holds nothing but the media and its position", () => {
    const doc = version([{ media: imageMedia(), sortOrder: 1 }]);
    const stored = doc.images[0].toObject();

    expect(Object.keys(stored).sort()).toEqual(["_id", "media", "sortOrder"]);
    // 🔴 P11: the provider enum was written out by hand here. It comes from
    // `mediaSchema` now, so there is one list rather than five.
    expect(stored.media.storage.provider).toBe(STORAGE_PROVIDER.AWS_S3);
  });
});

describe("Voucher.banner — no empty objects, and a real error code", () => {
  /**
   * 🔴 P9: `default: () => ({})` stamped `image: {}`, `video: {}` and `gif: {}`
   * onto **every** voucher, banner or no banner. With `mediaSchema` that is not
   * merely untidy — `{}` has no kind and no locator, so it is an invalid media
   * on a document nobody ever gave a banner to.
   */
  test("a voucher with no banner carries no empty media objects", () => {
    const doc = voucher();
    const stored = doc.toObject();

    expect(stored.banner?.image).toBeUndefined();
    expect(stored.banner?.video).toBeUndefined();
    expect(stored.banner?.gif).toBeUndefined();
    expect(doc.validateSync()?.errors?.banner).toBeUndefined();
  });

  test("a banner naming a type without the file is invalidated, not thrown", () => {
    /**
     * ⚠️ This is the bit worth proving. The old hook did `throw new Error(...)`
     * from inside `pre("validate")`, which escapes as a plain Error with no
     * status — so naming the wrong type came back as a **500**. `invalidate`
     * registers it on the path, which reaches the caller as a 422.
     *
     * It works here because `this` is the parent document. The same call inside
     * a nested sub-document's own hook does nothing at all — measured twice
     * (F-3, M-2).
     */
    const doc = voucher({ type: "VIDEO" });
    const error = doc.validateSync();

    expect(error).toBeTruthy();
    expect(error.errors["banner.video"].message).toBe(
      "A VIDEO banner needs a video file.",
    );
  });

  /**
   * 🔴 Both validation paths, and that is the whole point of the rewrite.
   *
   * Mongoose runs `pre("validate")` middleware **only on the async path**, so
   * the hook this replaced reported a perfectly clean document to
   * `validateSync()`. A `required` function runs on both — which matters,
   * because this is the only thing standing between a `type` and the file it
   * claims to have.
   */
  test("the rule holds on the async path too, not just the sync one", async () => {
    const doc = voucher({ type: "GIF" });

    expect(doc.validateSync().errors["banner.gif"]).toBeTruthy();
    await expect(doc.validate()).rejects.toThrow(/GIF banner needs a gif file/);
  });

  /**
   * ⚠️ The **whole document**, not just the one path.
   *
   * Asserting only `errors["banner.video"]` would pass a rule that demanded all
   * three files on every banner — the other two failures would sit in `errors`
   * unread. A VIDEO banner has a video and nothing else; that is the assertion.
   */
  test("a banner with its file validates, and asks for nothing else", () => {
    const doc = voucher({ type: "VIDEO", video: videoMedia() });

    expect(doc.validateSync()).toBeUndefined();
  });

  test("a video banner with no poster is refused by the media itself", () => {
    const doc = voucher({
      type: "VIDEO",
      video: videoMedia({ poster: undefined }),
    });
    expect(errorOn(doc, "banner.video.poster")).toMatch(/needs a poster/);
  });
});

describe("pickVoucherBanner — the customer's flat view", () => {
  test("no banner answers three nulls, never a missing key", () => {
    expect(pickVoucherBanner(null)).toEqual({
      bannerType: null,
      bannerUrl: null,
      bannerThumbnail: null,
    });
    expect(pickVoucherBanner({ type: null })).toEqual({
      bannerType: null,
      bannerUrl: null,
      bannerThumbnail: null,
    });
  });

  test("a type with no reachable URL counts as no banner", () => {
    // Reporting the type without a URL would have the client render a broken
    // tile rather than fall back.
    expect(pickVoucherBanner({ type: "IMAGE", image: {} }).bannerType).toBeNull();
  });

  /**
   * 🔴 The M-3a rule reaching its last surface.
   *
   * A video banner's poster is mandatory at upload, and until now it was stored
   * and never sent — so the app had a blank rectangle until the `.mp4` buffered.
   */
  test("a video banner's thumbnail is its poster, not the .mp4", () => {
    const shape = pickVoucherBanner({ type: "VIDEO", video: videoMedia() });

    expect(shape.bannerType).toBe("VIDEO");
    expect(shape.bannerUrl).toBe("https://cdn.example.com/v.mp4");
    expect(shape.bannerThumbnail).toBe("https://cdn.example.com/v.jpg");
  });

  test("a still banner is its own thumbnail", () => {
    const shape = pickVoucherBanner({ type: "IMAGE", image: imageMedia() });

    expect(shape.bannerThumbnail).toBe(shape.bannerUrl);
  });

  test("a GIF banner is its own thumbnail too", () => {
    const shape = pickVoucherBanner({
      type: "GIF",
      gif: imageMedia({ kind: MEDIA_KIND.GIF, url: "https://cdn.example.com/a.gif" }),
    });

    expect(shape.bannerType).toBe("GIF");
    expect(shape.bannerThumbnail).toBe("https://cdn.example.com/a.gif");
  });

  test("storage never reaches the customer", () => {
    const shape = pickVoucherBanner({ type: "VIDEO", video: videoMedia() });

    expect(JSON.stringify(shape)).not.toMatch(
      /trydood-nonprod-public|dev\/images|publicId|provider/,
    );
  });
});

describe("uploadVoucherBannerMedia — what it refuses before paying for an upload", () => {
  const {
    uploadVoucherBannerMedia,
  } = require("../../helpers/vouchers/voucherBannerMedia");
  const storageFacade = require("../../services/storage");

  const file = (mimetype) => ({ mimetype, tempFilePath: "/tmp/x" });

  let uploadSpy;
  beforeEach(() => {
    uploadSpy = jest
      .spyOn(storageFacade, "uploadFromPath")
      .mockImplementation(async ({ kind }) => ({
        url: `https://cdn.example.com/x.${kind === MEDIA_KIND.VIDEO ? "mp4" : "webp"}`,
        storage: storageRef,
        metadata: { mimeType: "image/webp", size: 10, width: 4, height: 3 },
      }));
  });
  afterEach(() => uploadSpy.mockRestore());

  const refusal = async (...args) => {
    try {
      await uploadVoucherBannerMedia(...args);
      return null;
    } catch (error) {
      return { status: error.statusCode ?? error.status, message: error.message };
    }
  };

  test("no file at all names the field", async () => {
    expect(await refusal("IMAGE", undefined, "v1")).toMatchObject({
      status: 422,
      message: "Please upload a image file for the voucher banner.",
    });
  });

  test("a mime the declared type does not allow is refused", async () => {
    expect(await refusal("IMAGE", file("video/mp4"), "v1")).toMatchObject({
      status: 422,
      message: expect.stringMatching(/Invalid file for voucher banner type IMAGE/),
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  /**
   * 🔴 Checked here rather than at `save()`.
   *
   * `mediaSchema` refuses it either way — but by then the video bytes are
   * uploaded and paid for, and the error names a schema path instead of the form
   * field the caller has to add.
   */
  test("a video banner with no poster is refused before the upload", async () => {
    expect(await refusal("VIDEO", file("video/mp4"), "v1")).toMatchObject({
      status: 422,
      message: 'A video banner needs a poster image. Attach one as "bannerThumbnail".',
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a poster that is itself a video is refused", async () => {
    expect(
      await refusal("VIDEO", file("video/mp4"), "v1", file("video/mp4")),
    ).toMatchObject({
      status: 422,
      message: expect.stringMatching(/poster has to be a still image/),
    });
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a GIF banner routes as a GIF and needs no poster", async () => {
    const media = await uploadVoucherBannerMedia("GIF", file("image/gif"), "v1");

    expect(media.kind).toBe(MEDIA_KIND.GIF);
    expect(media.poster).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: MEDIA_KIND.GIF }),
    );
  });

  test("a video banner uploads its poster and stores it on the media", async () => {
    const media = await uploadVoucherBannerMedia(
      "VIDEO",
      file("video/mp4"),
      "v1",
      file("image/webp"),
    );

    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(media.poster?.url).toContain("http");
    expect(uploadSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: MEDIA_KIND.IMAGE }),
    );
  });
});

describe("orphanImages — identity on either shape", () => {
  /**
   * ⚠️ This decides whether a file is **deleted**, so it has to read a
   * pre-migration row as well as a current one. Getting it wrong in one
   * direction strands a paid-for file; in the other it deletes a picture a live
   * voucher is still showing.
   */
  const find = jest.spyOn(VoucherVersion, "find");
  afterEach(() => find.mockReset());
  afterAll(() => find.mockRestore());

  const survivors = (versions) =>
    find.mockReturnValue({ lean: async () => versions });

  test("a removed image no surviving version points at is an orphan", async () => {
    survivors([{ images: [{ media: imageMedia({ storage: { ...storageRef, key: "other" } }) }] }]);

    const removed = [{ media: imageMedia() }];
    expect(await pickOrphanImages(removed, "v1")).toEqual(removed);
  });

  test("an image a surviving version still holds is kept", async () => {
    survivors([{ images: [{ media: imageMedia() }] }]);

    expect(await pickOrphanImages([{ media: imageMedia() }], "v1")).toEqual([]);
  });

  test("🔴 a pre-migration survivor still protects its file", async () => {
    // The old row kept `url` and `storage` directly on the image. If identity
    // only looked inside `media`, this survivor would look like it references
    // nothing — and a picture a live voucher is still showing would be deleted.
    survivors([{ images: [{ url: imageMedia().url, storage: storageRef }] }]);

    expect(await pickOrphanImages([{ media: imageMedia() }], "v1")).toEqual([]);
  });

  test("🔴 and a pre-migration row can itself be the orphan", async () => {
    survivors([]);

    const removed = [{ url: imageMedia().url, storage: storageRef }];
    expect(await pickOrphanImages(removed, "v1")).toEqual(removed);
  });

  test("an image with no identity at all is never a delete candidate", async () => {
    survivors([]);
    expect(await pickOrphanImages([{ media: {} }, {}], "v1")).toEqual([]);
  });
});
