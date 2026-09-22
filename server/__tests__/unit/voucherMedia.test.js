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
const {
  MEDIA_KIND,
  STORAGE_PROVIDER,
  UPLOAD_PURPOSE,
} = require("../../constants/storage");
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

/**
 * 🔴 The shape `pickVoucherBanner` is actually handed in production.
 *
 * ### Why the tests above could not catch this
 *
 * Every one of them feeds the **stored** shape — `{ media: {...}, sortOrder }`
 * — which is what `buildVoucherSnapshot` passes, and which the customer
 * pipelines never pass. Between `$unwind: "$version"` and the mapper sits
 * `NARROW_VERSION_IMAGES`, and for as long as that stage **flattened**
 * `media.url` up to `url`, `firstImage` looked for a key that had just been
 * removed. Result: `bannerUrl: null` on every voucher without an approved
 * banner, on the list and the detail, while the images beside it rendered fine.
 *
 * A helper tested only on a shape it is never given in production is a helper
 * with no test. So this block does not describe the narrowed shape — it
 * **derives it from the real pipeline**, and hands the result to the real
 * helper. Flatten that stage again and this fails.
 */
describe("pickVoucherBanner — against the shape the real pipeline emits", () => {
  const {
    buildCustomerVoucherPipeline,
    buildCustomerVoucherDetailPipeline,
  } = require("../../helpers/vouchers/customerListing");

  const AT = { latitude: 19.07, longitude: 72.87, maxDistance: 50000 };

  /** The stage under test, lifted out of the pipeline rather than restated. */
  const narrowStageOf = (pipeline) => {
    const stage = pipeline.find(
      (s) => s?.$addFields && "version.images" in s.$addFields,
    );
    if (!stage) throw new Error("no stage narrows version.images any more");
    return stage.$addFields["version.images"].$map.in;
  };

  /**
   * Apply a `$map`'s `in` spec to one document, in JS.
   *
   * ⚠️ It understands exactly what the stage uses today — nested objects and
   * `"$$i.<path>"` leaves — and **throws on anything else**. That refusal is
   * the point: the day the stage grows a `$cond`, this test stops rather than
   * quietly evaluating it wrong and reporting a pass.
   */
  const applySpec = (spec, source, at = "in") => {
    if (typeof spec === "string") {
      if (!spec.startsWith("$$i.")) {
        throw new Error(`${at}: unsupported expression ${spec}`);
      }
      return spec
        .slice("$$i.".length)
        .split(".")
        .reduce((value, key) => value?.[key], source);
    }
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      return Object.fromEntries(
        Object.entries(spec).map(([key, value]) => [
          key,
          applySpec(value, source, `${at}.${key}`),
        ]),
      );
    }
    throw new Error(`${at}: unsupported expression ${JSON.stringify(spec)}`);
  };

  const storedImages = [
    { _id: OID(), media: imageMedia({ url: "https://cdn.example.com/first.webp" }), sortOrder: 1 },
    { _id: OID(), media: imageMedia({ url: "https://cdn.example.com/second.webp" }), sortOrder: 2 },
  ];

  const narrow = (pipeline) => {
    const spec = narrowStageOf(pipeline);
    return storedImages.map((image) => applySpec(spec, image));
  };

  const listImages = () => narrow(buildCustomerVoucherPipeline({ ...AT, query: {} }));
  const detailImages = () =>
    narrow(buildCustomerVoucherDetailPipeline({ ...AT, voucherId: OID(), outletId: null }));

  test("both customer pipelines narrow images the same way", () => {
    expect(narrowStageOf(buildCustomerVoucherPipeline({ ...AT, query: {} }))).toEqual(
      narrowStageOf(
        buildCustomerVoucherDetailPipeline({ ...AT, voucherId: OID(), outletId: null }),
      ),
    );
  });

  /**
   * 🔴 The regression itself. `firstImage` reads `image.media.url`, so the
   * stage has to answer with a `media` — not with the URL lifted out of it.
   */
  test("the narrowed image still carries a `media`, not a flattened url", () => {
    const [first] = listImages();

    expect(first.media?.url).toBe("https://cdn.example.com/first.webp");
    expect(first.sortOrder).toBe(1);
  });

  test.each([
    ["list", listImages],
    ["detail", detailImages],
  ])("the V-4a fallback resolves on the %s pipeline's shape", (_name, images) => {
    const result = pickVoucherBanner(null, images());

    expect(result.bannerUrl).toBe("https://cdn.example.com/first.webp");
    expect(result.bannerThumbnail).toBe("https://cdn.example.com/first.webp");
    expect(result.bannerIsFallback).toBe(true);
  });

  test("a pending banner still falls back, and still reports PENDING", () => {
    const result = pickVoucherBanner(
      { pending: imageMedia(), status: VOUCHER_BANNER_STATUS.PENDING },
      listImages(),
    );

    expect(result.bannerUrl).toBe("https://cdn.example.com/first.webp");
    expect(result.bannerStatus).toBe(VOUCHER_BANNER_STATUS.PENDING);
    expect(result.bannerIsFallback).toBe(true);
  });

  /**
   * ⚠️ `kind` has to survive the stage too. Without it every fallback reports
   * `IMAGE`, so a GIF voucher tile would be described wrongly — a quieter bug
   * than the null, and one that would have outlived the fix for it.
   */
  test("the fallback's type comes from the file's own kind", () => {
    const spec = narrowStageOf(buildCustomerVoucherPipeline({ ...AT, query: {} }));
    const gif = applySpec(spec, {
      _id: OID(),
      media: imageMedia({ kind: MEDIA_KIND.GIF, url: "https://cdn.example.com/a.gif" }),
      sortOrder: 1,
    });

    expect(pickVoucherBanner(null, [gif]).bannerType).toBe("GIF");
  });

  /**
   * The stage is a whitelist and has to stay one: this route is public, and
   * naming `media` whole would put `publicId` / `bucket` / `key` back on the
   * wire — which is what the stage was written to prevent in the first place.
   */
  test("narrowing still strips every locator", () => {
    expect(JSON.stringify(listImages())).not.toMatch(
      /bucket|publicId|"key"|storage/i,
    );
  });
});

/**
 * U-4 — the gallery images, on either road.
 *
 * ⚠️ The money suite that covers the floor and the counts **mocks** this helper,
 * because it is testing the rules around it. So what happens *inside* it — the
 * actor reaching the facade, the id being spent instead of a file — has no cover
 * there at all. Mutation found exactly that gap.
 */
describe("uploadVoucherImages — what reaches the facade", () => {
  const {
    uploadVoucherImages,
  } = require("../../helpers/vouchers/validateImagesFiles");
  const storageFacade = require("../../services/storage");

  const who = { userId: "u1", role: "VENDOR" };
  const attached = (name) => ({
    name,
    mimetype: "image/jpeg",
    size: 1024,
    uploadId: null,
    file: { name, mimetype: "image/jpeg", tempFilePath: `/tmp/${name}` },
  });
  const named = (uploadId) => ({
    name: "presigned.jpg",
    mimetype: "image/jpeg",
    size: 1024,
    uploadId,
    file: null,
  });

  let acceptSpy;
  beforeEach(() => {
    acceptSpy = jest
      .spyOn(storageFacade, "acceptUpload")
      .mockImplementation(async () => ({
        url: "https://cdn.example.com/v.webp",
        storage: storageRef,
        metadata: { mimeType: "image/jpeg", size: 1024, width: 8, height: 6 },
      }));
  });
  afterEach(() => acceptSpy.mockRestore());

  /**
   * ⚠️ The actor reaches the facade. It looks an upload intent up by id **and**
   * owner, so dropping it makes every presigned upload answer "not found" — and
   * nothing on the multipart road would notice, because that road never reads it.
   */
  test("the actor goes with every image", async () => {
    await uploadVoucherImages(who, [attached("a.jpg"), attached("b.jpg")], "v1");

    expect(acceptSpy).toHaveBeenCalledTimes(2);
    expect(acceptSpy.mock.calls.every(([actor]) => actor === who)).toBe(true);
  });

  test("a named upload is spent as an id, not as a file", async () => {
    await uploadVoucherImages(who, [named("68f1a2b3c4d5e6f7a8b9e001")], "v1");

    expect(acceptSpy).toHaveBeenCalledWith(
      who,
      expect.objectContaining({
        uploadId: "68f1a2b3c4d5e6f7a8b9e001",
        file: null,
        purpose: UPLOAD_PURPOSE.VOUCHER_IMAGE,
        entityId: "v1",
      }),
    );
  });

  test("an attached file is spent as a file", async () => {
    await uploadVoucherImages(who, [attached("a.jpg")], "v1");

    const [, options] = acceptSpy.mock.calls[0];
    expect(options.uploadId).toBeNull();
    expect(options.file.name).toBe("a.jpg");
  });

  /**
   * ⚠️ One failure takes the whole batch with it — a voucher that quietly
   * stored three of five images would look like it worked, and the floor it
   * cleared on the way in would no longer hold.
   */
  test("a failure rolls back everything already uploaded", async () => {
    const deleteSpy = jest
      .spyOn(storageFacade, "deleteAssets")
      .mockResolvedValue({ deleted: 0, failed: 0 });
    acceptSpy
      .mockImplementationOnce(async () => ({
        url: "https://cdn.example.com/one.webp",
        storage: storageRef,
        metadata: { mimeType: "image/jpeg", size: 1024 },
      }))
      .mockImplementationOnce(async () => {
        throw new Error("the second one did not land");
      });

    await expect(
      uploadVoucherImages(who, [attached("a.jpg"), attached("b.jpg")], "v1"),
    ).rejects.toThrow();

    expect(deleteSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storage: storageRef })]),
    );
    deleteSpy.mockRestore();
  });

  /**
   * 🔴 A refusal the vendor can act on must not become a 500.
   *
   * Every failure here came back as `500 "Failed to upload voucher images."` —
   * a wrong id (404), the wrong surface (422), a file over the limit (413) and
   * an upload already used (409) were one indistinguishable sentence, and the
   * one that said what to fix went only to the server console. A vendor could
   * not tell their own mistake from our outage, and the panel had nothing to
   * branch on.
   *
   * ⚠️ This is how the presigned-upload bug reached production looking like a
   * server fault: the real answer was a 409 about an upload that had already
   * been confirmed, and nobody could see it.
   */
  test.each([
    [409, "That upload has already been used."],
    [404, "That upload was not found."],
    [413, "That file is 12 MB. The limit here is 10 MB."],
    [422, "VOUCHER_IMAGE does not accept MP4 files."],
  ])("a %s keeps its own status and its own words", async (statusCode, message) => {
    const deleteSpy = jest
      .spyOn(storageFacade, "deleteAssets")
      .mockResolvedValue({ deleted: 0, failed: 0 });
    acceptSpy.mockImplementationOnce(async () => {
      throw Object.assign(new Error(message), { statusCode });
    });

    const thrown = await uploadVoucherImages(who, [attached("a.jpg")], "v1").then(
      () => null,
      (error) => error,
    );

    expect(thrown.statusCode).toBe(statusCode);
    expect(thrown.message).toBe(message);
    deleteSpy.mockRestore();
  });

  /**
   * ⚠️ Rollback still runs first. Re-throwing before the delete would leave every
   * image uploaded ahead of the failure on storage, paid for and unreferenced —
   * the exact defect the rollback exists for.
   */
  test("a refusal still takes back what was already uploaded", async () => {
    const deleteSpy = jest
      .spyOn(storageFacade, "deleteAssets")
      .mockResolvedValue({ deleted: 0, failed: 0 });
    acceptSpy
      .mockImplementationOnce(async () => ({
        url: "https://cdn.example.com/one.webp",
        storage: storageRef,
        metadata: { mimeType: "image/jpeg", size: 1024 },
      }))
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error("That upload has already been used."), {
          statusCode: 409,
        });
      });

    const thrown = await uploadVoucherImages(
      who,
      [attached("a.jpg"), attached("b.jpg")],
      "v1",
    ).then(
      () => null,
      (error) => error,
    );

    expect(thrown.statusCode).toBe(409);
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ storage: storageRef })]),
    );
    deleteSpy.mockRestore();
  });

  /**
   * ⚠️ The other half: a fault with no status really is ours — a quota, a
   * credential, a network drop — and its message would mean nothing to a vendor.
   * That one keeps the generic sentence, and the original still reaches the log.
   */
  test("an error with no status is still reported as ours", async () => {
    const deleteSpy = jest
      .spyOn(storageFacade, "deleteAssets")
      .mockResolvedValue({ deleted: 0, failed: 0 });
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    acceptSpy.mockImplementationOnce(async () => {
      throw new Error("getaddrinfo ENOTFOUND s3.ap-south-1.amazonaws.com");
    });

    const thrown = await uploadVoucherImages(who, [attached("a.jpg")], "v1").then(
      () => null,
      (error) => error,
    );

    expect(thrown.statusCode).toBe(500);
    expect(thrown.message).toBe("Failed to upload voucher images.");
    // The real cause is not lost — it is just not the vendor's problem.
    expect(logged).toHaveBeenCalledWith(
      "Voucher image upload failed:",
      expect.stringContaining("ENOTFOUND"),
    );
    logged.mockRestore();
    deleteSpy.mockRestore();
  });
});

describe("uploadVoucherBannerMedia — what it refuses before paying for an upload", () => {
  const {
    uploadVoucherBannerMedia,
  } = require("../../helpers/vouchers/voucherBannerMedia");
  const storageFacade = require("../../services/storage");
  const settings = require("../../helpers/settings");

  const MB = 1024 * 1024;
  const who = { userId: "u1", role: "VENDOR" };

  /**
   * ⚠️ A `describeIncoming` result, not a raw file (U-4).
   *
   * The helper takes a description now — `{ name, mimetype, size }` plus exactly
   * one of `file` or `uploadId` — so every rule below reads the same fields
   * whichever road the banner came down. `presigned()` is the same banner
   * arriving as an id.
   */
  const file = (mimetype, over = {}) => ({
    mimetype,
    name: "x",
    size: MB,
    uploadId: null,
    file: { mimetype, tempFilePath: "/tmp/x", name: "x" },
    ...over,
  });
  const presigned = (mimetype, over = {}) => ({
    ...file(mimetype, over),
    uploadId: "68f1a2b3c4d5e6f7a8b9e001",
    file: null,
  });

  let uploadSpy;
  beforeEach(() => {
    uploadSpy = jest
      .spyOn(storageFacade, "acceptUpload")
      .mockImplementation(async ({ file: attached, purpose }) => ({
        url: `https://cdn.example.com/x-${purpose}.webp`,
        storage: storageRef,
        metadata: {
          mimeType: attached?.mimetype ?? "image/webp",
          size: 10,
          width: 4,
          height: 3,
        },
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
    const result = await refusal(who, undefined, OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/"media"/);
  });

  /**
   * 🔴 There is no `type` parameter any more — the kind comes from the bytes. A
   * file that is none of the three things a banner may be is refused for what it
   * actually is, not for disagreeing with a label.
   */
  test("something that is not an image, GIF or video is refused", async () => {
    const result = await refusal(who, file("application/pdf"), OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/image, a GIF or a video/);
  });

  test("a mime outside the platform's list is refused", async () => {
    const result = await refusal(who, file("image/bmp"), OID());

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
      who,
      file("video/mp4", { size: 300 * MB, name: "huge.mp4" }),
      OID(),
      file("image/webp"),
    );

    expect(result.status).toBe(422);
    expect(result.message).toBe("huge.mp4 exceeds the maximum size of 50 MB.");
  });

  test("nothing is uploaded when the size is refused", async () => {
    await refusal(
      who,
      file("video/mp4", { size: 300 * MB }),
      OID(),
      file("image/webp"),
    );

    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a video banner with no poster is refused before the upload", async () => {
    const result = await refusal(who, file("video/mp4"), OID());

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/"poster"/);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  test("a poster that is itself a video is refused", async () => {
    const result = await refusal(who, file("video/mp4"), OID(), file("video/mp4"));

    expect(result.status).toBe(422);
    expect(result.message).toMatch(/still image/);
  });

  /**
   * 🔴 A GIF is an `image/*` file, so every "is this an image" check passes it —
   * which is how one ends up under `images/` and gets its animation flattened.
   *
   * ⚠️ The kind is no longer handed to the provider by this helper; the facade
   * derives it from the mime. So what this pins is the **stored** kind, which is
   * what decides the prefix and what every reader downstream believes.
   */
  test("a GIF banner routes as a GIF and needs no poster", async () => {
    const media = await uploadVoucherBannerMedia(who, file("image/gif"), OID());

    expect(media.kind).toBe(MEDIA_KIND.GIF);
  });

  test("a video banner uploads its poster and stores it on the media", async () => {
    const media = await uploadVoucherBannerMedia(
      who,
      file("video/mp4"),
      OID(),
      file("image/webp"),
    );

    expect(media.kind).toBe(MEDIA_KIND.VIDEO);
    expect(media.poster?.url).toBeTruthy();

    /**
     * 🔴 The banner under `VOUCHER_BANNER`, the poster under
     * `VOUCHER_BANNER_POSTER`. Same bucket and prefix, different allowance: a
     * poster is capped at 10 MB and refuses VIDEO outright. This path used to
     * send the poster as `VOUCHER_BANNER` and buy it the banner's 50 MB — and on
     * the presigned road a shared purpose would make the two ids
     * interchangeable, which is the tighter rule becoming the skippable one.
     */
    expect(uploadSpy).toHaveBeenNthCalledWith(
      1,
      who,
      expect.objectContaining({ purpose: UPLOAD_PURPOSE.VOUCHER_BANNER }),
    );
    expect(uploadSpy).toHaveBeenNthCalledWith(
      2,
      who,
      expect.objectContaining({ purpose: UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER }),
    );
  });

  /**
   * ⚠️ The actor reaches the facade. It looks an upload intent up by id **and**
   * owner, so dropping it makes every presigned upload answer "not found" — and
   * nothing on the multipart road would notice, because that road never reads it.
   */
  test("a presigned banner is handed to the facade as an id, with its actor", async () => {
    await uploadVoucherBannerMedia(who, presigned("image/webp"), "v1");

    expect(uploadSpy).toHaveBeenCalledWith(
      who,
      expect.objectContaining({
        uploadId: "68f1a2b3c4d5e6f7a8b9e001",
        file: null,
        entityId: "v1",
      }),
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

describe("🔴 a banner's poster is a narrower thing than the banner", () => {
  const { UPLOAD_PURPOSES } = require("../../constants/storage");

  const banner = UPLOAD_PURPOSES[UPLOAD_PURPOSE.VOUCHER_BANNER];
  const poster = UPLOAD_PURPOSES[UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER];

  /**
   * ⚠️ These two land in the same bucket under the same `vouchers/<id>` prefix,
   * so nothing about where the object goes distinguishes them. What has to
   * differ is what they **accept** — and that is the whole reason the poster has
   * a purpose of its own rather than sharing the banner's.
   */
  test("same bucket, same prefix — the allowance is what differs", () => {
    expect(poster.entity).toBe(banner.entity);
    expect(poster.bucket).toBe(banner.bucket);
  });

  test("a poster is never a video", () => {
    expect(banner.kinds).toContain(MEDIA_KIND.VIDEO);
    expect(poster.kinds).not.toContain(MEDIA_KIND.VIDEO);
  });

  /**
   * 🔴 If these ever match, the poster has silently been given a video's
   * allowance — which is exactly what sharing `VOUCHER_BANNER` did.
   */
  test("and it is metered smaller than the banner it belongs to", () => {
    expect(poster.maxBytes).toBeLessThan(banner.maxBytes);
  });
});

describe("🔴 the voucher validator refuses a malformed uploadId", () => {
  const {
    validateCreateVoucher,
    validateUpdateVoucher,
    validateSetVoucherBanner,
  } = require("../../validator/vouchers");

  const REAL = "68f1a2b3c4d5e6f7a8b9e001";
  const messages = (schema, body) =>
    schema.validate(body, { abortEarly: false }).error?.details.map(
      (detail) => detail.message,
    ) ?? [];

  /**
   * ⚠️ The first gate, and the only one that answers before anything is loaded —
   * so a malformed id never becomes a database lookup, and never becomes a `404`
   * that reads as if the upload had expired.
   */
  test("create refuses a bad image id and a bad banner id", () => {
    expect(
      messages(validateCreateVoucher.body, { imageUploadIds: ["nope"] }),
    ).toContain("Image upload 1: Invalid uploadId.");
    expect(
      messages(validateCreateVoucher.body, { bannerUploadId: "nope" }),
    ).toContain("Invalid bannerUploadId.");
    expect(
      messages(validateCreateVoucher.body, { bannerPosterUploadId: "nope" }),
    ).toContain("Invalid bannerPosterUploadId.");
  });

  test("update and the banner endpoint refuse one too", () => {
    expect(
      messages(validateUpdateVoucher.body, { newImageUploadIds: ["nope"] }),
    ).toContain("Image upload 1: Invalid uploadId.");
    expect(
      messages(validateSetVoucherBanner.body, { bannerUploadId: "nope" }),
    ).toContain("Invalid bannerUploadId.");
  });

  /**
   * ⚠️ These endpoints are multipart, so a list arrives either as repeated form
   * fields or as one JSON string. Both have to work — `jsonTolerantArray` is
   * what makes that true, and it is easy to drop by accident.
   */
  test("a real id is accepted, as an array or as a JSON string", () => {
    expect(
      messages(validateUpdateVoucher.body, { newImageUploadIds: [REAL] }),
    ).toEqual([]);
    expect(
      messages(validateUpdateVoucher.body, {
        newImageUploadIds: JSON.stringify([REAL]),
      }),
    ).toEqual([]);
    expect(
      messages(validateSetVoucherBanner.body, { bannerUploadId: REAL }),
    ).toEqual([]);
  });
});
