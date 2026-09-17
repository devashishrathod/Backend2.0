const mongoose = require("mongoose");

/**
 * ⚠️ `jest.mock`, not `jest.spyOn`.
 *
 * `voucherBannerMedia.js` destructures `getStorageConfig` from the settings
 * barrel at load, so it holds its own reference and a spy on the export is never
 * seen — the call goes to the real one, which reaches for Mongo and hangs the
 * test out to its timeout.
 *
 * That trap has now cost this migration five separate findings: `getSetting` in
 * S-1, `resolveActorBrand` in the voucher money tests, and this.
 */
jest.mock("../../helpers/settings", () => ({
  getStorageConfig: jest.fn(),
}));

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const { pickVoucherBanner } = require("../../helpers/vouchers/pickVoucherBanner");
const { pickOrphanImages } = require("../../helpers/vouchers/orphanImages");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");
const {
  VOUCHER_BANNER_STATUS,
} = require("../../constants/voucherBanner");

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

describe("Voucher.banner — two slots, no type, no empty objects", () => {
  /**
   * 🔴 The shape this replaces stamped **three empty objects onto every
   * voucher** (P9) — `image: {}`, `video: {}`, `gif: {}` — and each of those is
   * an invalid `mediaSchema` value with no `kind` and no locator.
   */
  test("a voucher with no banner stores no banner media at all", () => {
    const doc = voucher().toObject();

    expect(doc.banner?.current).toBeUndefined();
    expect(doc.banner?.pending).toBeUndefined();
    expect(doc.banner?.status ?? null).toBeNull();
  });

  test("there is no type field any more — the kind lives on the media", () => {
    expect(Voucher.schema.path("banner.type")).toBeUndefined();
    expect(Voucher.schema.path("banner.image")).toBeUndefined();
    expect(Voucher.schema.path("banner.video")).toBeUndefined();
    expect(Voucher.schema.path("banner.gif")).toBeUndefined();
    expect(Voucher.schema.path("banner.current")).toBeTruthy();
    expect(Voucher.schema.path("banner.pending")).toBeTruthy();
  });

  test("a pending banner validates, and carries its review state", () => {
    const doc = voucher({
      pending: imageMedia(),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.banner.status).toBe("PENDING");
    expect(doc.banner.rejectionReason).toBeNull();
  });

  test("an approved banner sits in current, and both slots can hold one", () => {
    const doc = voucher({
      current: imageMedia(),
      pending: videoMedia(),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.banner.current.kind).toBe(MEDIA_KIND.IMAGE);
    expect(doc.banner.pending.kind).toBe(MEDIA_KIND.VIDEO);
  });

  /**
   * ⚠️ The poster rule lives on `mediaSchema`, so it reaches the banner without
   * the banner restating it — and it runs on the **sync** path, which a
   * `pre("validate")` hook would not.
   */
  test("a video banner with no poster is refused by the media itself", () => {
    const doc = voucher({
      pending: videoMedia({ poster: undefined }),
      status: VOUCHER_BANNER_STATUS.PENDING,
    });

    expect(errorOn(doc, "banner.pending.poster")).toMatch(/needs a poster/i);
  });

  test("only the three review states are accepted", () => {
    const doc = voucher({ pending: imageMedia(), status: "MAYBE" });

    expect(errorOn(doc, "banner.status")).toBeTruthy();
  });
});

describe("pickVoucherBanner — the customer's flat view, and the fallback", () => {
  const images = [
    {
      media: imageMedia({ url: "https://cdn.example.com/first.webp" }),
      sortOrder: 1,
    },
    {
      media: imageMedia({ url: "https://cdn.example.com/second.webp" }),
      sortOrder: 2,
    },
  ];

  test("an approved banner is served, and reports itself as not a fallback", () => {
    const result = pickVoucherBanner({ current: imageMedia() }, images);

    expect(result).toEqual({
      bannerType: "IMAGE",
      bannerUrl: "https://cdn.example.com/a.webp",
      bannerThumbnail: "https://cdn.example.com/a.webp",
      bannerStatus: "APPROVED",
      bannerIsFallback: false,
    });
  });

  /**
   * 🔴 V-4a — the slot is never empty. A banner in review leaves `current`
   * absent, and the voucher stays published on its first image rather than
   * showing a blank tile until an admin gets to it.
   */
  test("a pending banner is not served — the first image stands in", () => {
    const result = pickVoucherBanner(
      { pending: imageMedia(), status: VOUCHER_BANNER_STATUS.PENDING },
      images,
    );

    expect(result.bannerUrl).toBe("https://cdn.example.com/first.webp");
    expect(result.bannerIsFallback).toBe(true);
    // ⚠️ The *pending* banner's status — the fallback has none of its own.
    expect(result.bannerStatus).toBe("PENDING");
  });

  test("a rejected banner falls back too, and says so", () => {
    const result = pickVoucherBanner(
      {
        pending: imageMedia(),
        status: VOUCHER_BANNER_STATUS.REJECTED,
        rejectionReason: "Text is unreadable at card size.",
      },
      images,
    );

    expect(result.bannerIsFallback).toBe(true);
    expect(result.bannerStatus).toBe("REJECTED");
  });

  test("the fallback is the first image by sortOrder, not by array order", () => {
    const shuffled = [images[1], images[0]];

    expect(pickVoucherBanner(null, shuffled).bannerUrl).toBe(
      "https://cdn.example.com/first.webp",
    );
  });

  test("no banner and no images answers every key, never a missing one", () => {
    const result = pickVoucherBanner(null, []);

    expect(result).toEqual({
      bannerType: null,
      bannerUrl: null,
      bannerThumbnail: null,
      bannerStatus: null,
      bannerIsFallback: false,
    });
  });

  test("a video banner's thumbnail is its poster, not the .mp4", () => {
    const result = pickVoucherBanner({ current: videoMedia() }, images);

    expect(result.bannerType).toBe("VIDEO");
    expect(result.bannerUrl).toBe("https://cdn.example.com/v.mp4");
    expect(result.bannerThumbnail).toBe("https://cdn.example.com/v.jpg");
  });

  test("a GIF banner is its own thumbnail, and reads as GIF", () => {
    const gif = imageMedia({
      kind: MEDIA_KIND.GIF,
      url: "https://cdn.example.com/a.gif",
    });
    const result = pickVoucherBanner({ current: gif }, images);

    expect(result.bannerType).toBe("GIF");
    expect(result.bannerThumbnail).toBe("https://cdn.example.com/a.gif");
  });

  /** `storage` is never any of the customer's business. */
  test("nothing about where the bytes live escapes", () => {
    const result = pickVoucherBanner({ current: imageMedia() }, images);

    expect(JSON.stringify(result)).not.toMatch(/bucket|key|publicId|storage/i);
  });
});

describe("uploadVoucherBannerMedia — what it refuses before paying for an upload", () => {
  const {
    uploadVoucherBannerMedia,
  } = require("../../helpers/vouchers/voucherBannerMedia");
  const storageFacade = require("../../services/storage");
  const settings = require("../../helpers/settings");

  const MB = 1024 * 1024;
  const file = (mimetype, over = {}) => ({
    mimetype,
    tempFilePath: "/tmp/x",
    name: "x",
    size: MB,
    ...over,
  });

  let uploadSpy;
  beforeEach(() => {
    uploadSpy = jest
      .spyOn(storageFacade, "uploadFromPath")
      .mockImplementation(async ({ kind }) => ({
        url: `https://cdn.example.com/x.${kind === MEDIA_KIND.VIDEO ? "mp4" : "webp"}`,
        storage: storageRef,
        metadata: { mimeType: "image/webp", size: 10, width: 4, height: 3 },
      }));
    settings.getStorageConfig.mockResolvedValue({
      allowedTypes: {
        [MEDIA_KIND.IMAGE]: ["image/jpeg", "image/webp", "image/png"],
        [MEDIA_KIND.GIF]: ["image/gif"],
        [MEDIA_KIND.VIDEO]: ["video/mp4", "video/webm"],
      },
      maxBytes: {
        [MEDIA_KIND.IMAGE]: 10 * MB,
        [MEDIA_KIND.GIF]: 15 * MB,
        [MEDIA_KIND.VIDEO]: 50 * MB,
      },
      maxSizeMB: {
        [MEDIA_KIND.IMAGE]: 10,
        [MEDIA_KIND.GIF]: 15,
        [MEDIA_KIND.VIDEO]: 50,
      },
    });
  });
  afterEach(() => uploadSpy.mockRestore());

  const refusal = async (...args) => {
    try {
      await uploadVoucherBannerMedia(...args);
      return null;
    } catch (error) {
      return {
        status: error.statusCode ?? error.status,
        message: error.message,
      };
    }
  };

  test("no file at all names the field the caller has to send", async () => {
    const result = await refusal(undefined, OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/"media"/);
  });

  /**
   * 🔴 There is no `type` parameter any more — the kind comes from the bytes. A
   * file that is none of the three things a banner may be is refused for what it
   * actually is, not for disagreeing with a label.
   */
  test("something that is not an image, GIF or video is refused", async () => {
    const result = await refusal(file("application/pdf"), OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/image, a GIF or a video/);
  });

  test("a mime outside the platform's list is refused", async () => {
    const result = await refusal(file("image/bmp"), OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/not a supported format/);
  });

  /**
   * 🔴 P12, on the one file most likely to be a video — the banner had **no
   * size check at all**. The mime was checked and a 300 MB `.mp4` went straight
   * through: uploaded, paid for, and served at the top of the voucher card.
   */
  test("an oversized banner is refused, and told the limit", async () => {
    const result = await refusal(
      file("video/mp4", { size: 300 * MB, name: "huge.mp4" }),
      OID(),
      file("image/webp"),
    );

    expect(result.status).toBe(422);
    expect(result.message).toBe("huge.mp4 exceeds the maximum size of 50 MB.");
  });

  test("nothing is uploaded when the size is refused", async () => {
    await refusal(
      file("video/mp4", { size: 300 * MB }),
      OID(),
      file("image/webp"),
    );

    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a video banner with no poster is refused before the upload", async () => {
    const result = await refusal(file("video/mp4"), OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/"poster"/);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a poster that is itself a video is refused", async () => {
    const result = await refusal(file("video/mp4"), OID(), file("video/mp4"));

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/still image/);
  });

  test("a GIF banner routes as a GIF and needs no poster", async () => {
    const media = await uploadVoucherBannerMedia(file("image/gif"), OID());

    expect(media.kind).toBe(MEDIA_KIND.GIF);
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: MEDIA_KIND.GIF }),
    );
  });

  test("a video banner uploads its poster and stores it on the media", async () => {
    const media = await uploadVoucherBannerMedia(
      file("video/mp4"),
      OID(),
      file("image/webp"),
    );

    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(media.poster?.url).toBeTruthy();
    expect(uploadSpy).toHaveBeenCalledTimes(2);
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
