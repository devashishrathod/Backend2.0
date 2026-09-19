/**
 * The storage facade, and the four silent failures it exists to end.
 *
 * Every test here is about something that used to succeed while doing nothing:
 * a `case "S3"` that returned without deleting, a URL check that skipped any
 * host it did not recognise, and a rollback that deleted by URL.
 *
 * ⚠️ A fourth one used to live here — a thumbnail check that read an
 * auto-generated poster as one the vendor had uploaded. It is gone with the
 * function; see the note where those tests were.
 */

const mockConfig = {
  S3_PREFIX: "dev/",
  MEDIA_PROVIDER: "CLOUDINARY",
  AWS_REGION: "ap-south-1",
  S3_BUCKET_PUBLIC: "trydood-nonprod-public",
  S3_BUCKET_PRIVATE: "trydood-nonprod-private",
  CDN_BASE_URL: "https://cdn.test",
  isProduction: false,
};

jest.mock("../../configs/env", () => ({
  config: mockConfig,
  PROFILES: { DEVELOPMENT: "DEVELOPMENT", STAGING: "STAGING", PRODUCTION: "PRODUCTION" },
}));

jest.mock("../../helpers/cloudinary", () => ({
  uploadFile: jest.fn(),
  deleteFile: jest.fn(async () => true),
  destroyPublicId: jest.fn(async () => true),
  getOptimizedImageUrl: jest.fn((id) => `https://res.cloudinary.test/${id}`),
}));

/**
 * ⚠️ The provider now comes from `Setting.storage.provider`, not from the
 * environment — so this stands in for the settings read rather than for a config
 * value. `MEDIA_PROVIDER` only seeds a brand-new install.
 */
const mockStorageConfig = { provider: "CLOUDINARY" };
jest.mock("../../helpers/settings", () => ({
  getStorageConfig: async () => mockStorageConfig,
}));

const mockS3Send = jest.fn(async () => ({}));
jest.mock("../../configs/s3", () => ({
  getS3Client: () => ({ send: mockS3Send }),
  bucketName: (bucket) =>
    bucket === "PRIVATE" ? "trydood-nonprod-private" : "trydood-nonprod-public",
  resetS3Client: jest.fn(),
}));

const storage = require("../../services/storage");
const keys = require("../../services/storage/keys");
const cloudinary = require("../../helpers/cloudinary");
const {
  MEDIA_KIND,
  UPLOAD_PURPOSE,
  STORAGE_PROVIDER,
  STORAGE_BUCKET,
  kindFromMime,
} = require("../../constants/storage");

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.MEDIA_PROVIDER = "CLOUDINARY";
  mockStorageConfig.provider = "CLOUDINARY";
  mockConfig.S3_PREFIX = "dev/";
});

describe("kindFromMime", () => {
  test("a GIF is its own kind, not an image", () => {
    // The whole reason `gifs/` exists as a prefix: every other check in the
    // codebase asks `startsWith("image")`, which a GIF passes.
    expect(kindFromMime("image/gif")).toBe(MEDIA_KIND.GIF);
    expect(kindFromMime("image/png")).toBe(MEDIA_KIND.IMAGE);
  });

  test("video, audio and pdf each map to their own kind", () => {
    expect(kindFromMime("video/mp4")).toBe(MEDIA_KIND.VIDEO);
    expect(kindFromMime("audio/mpeg")).toBe(MEDIA_KIND.AUDIO);
    expect(kindFromMime("application/pdf")).toBe(MEDIA_KIND.DOCUMENT);
  });

  test("an unknown mime type is null, not a guess", () => {
    expect(kindFromMime("application/zip")).toBeNull();
    expect(kindFromMime(undefined)).toBeNull();
  });
});

describe("buildKey", () => {
  test("puts the type first and the entity inside it", () => {
    const key = keys.buildKey({
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "64b7f0c2e1a3d4f5a6b7c8d9",
      kind: MEDIA_KIND.IMAGE,
      mime: "image/webp",
    });
    expect(key).toMatch(
      /^dev\/images\/brands\/64b7f0c2e1a3d4f5a6b7c8d9\/[0-9a-f-]{36}\.webp$/,
    );
  });

  test("a GIF lands under gifs/, away from the resize Lambda", () => {
    const key = keys.buildKey({
      purpose: UPLOAD_PURPOSE.BANNER_MEDIA,
      entityId: "abc123",
      kind: MEDIA_KIND.GIF,
      mime: "image/gif",
    });
    expect(key.startsWith("dev/gifs/banners/abc123/")).toBe(true);
    expect(key.endsWith(".gif")).toBe(true);
  });

  test("every call produces a different key, so nothing is ever overwritten", () => {
    const args = {
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "brand1",
      kind: MEDIA_KIND.IMAGE,
      mime: "image/png",
    };
    expect(keys.buildKey(args)).not.toBe(keys.buildKey(args));
  });

  test("production writes to the bucket root", () => {
    mockConfig.S3_PREFIX = "";
    const key = keys.buildKey({
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "brand1",
      kind: MEDIA_KIND.IMAGE,
      mime: "image/png",
    });
    expect(key.startsWith("images/brands/brand1/")).toBe(true);
  });

  test("refuses a kind the purpose does not accept", () => {
    // A video reaching a logo field should stop here, not sit in
    // `videos/brands/` looking like somebody meant it.
    expect(() =>
      keys.buildKey({
        purpose: UPLOAD_PURPOSE.BRAND_LOGO,
        entityId: "brand1",
        kind: MEDIA_KIND.VIDEO,
        mime: "video/mp4",
      }),
    ).toThrow(/does not accept VIDEO/);
  });

  test("an id cannot climb out of its prefix", () => {
    const key = keys.buildKey({
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "../../../etc",
      kind: MEDIA_KIND.IMAGE,
      mime: "image/png",
    });
    expect(key).not.toContain("..");
    expect(key.startsWith("dev/images/brands/etc/")).toBe(true);
  });

  test("an extension cannot climb out either", () => {
    const key = keys.buildKey({
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "brand1",
      kind: MEDIA_KIND.IMAGE,
      mime: "image/unknown-thing",
      originalName: "payload.../../sh",
    });
    expect(key).not.toContain("..");
  });

  test("documents keep their number instead of a uuid", () => {
    // ⚠️ Takes the document **number**, not a bag of parts. The year and the
    // series are read out of the number itself — `services/uploads/index.js`
    // has only ever passed the string, and this test had been calling an older
    // signature that no caller uses, so it was failing on a function that works.
    expect(keys.buildDocumentKey("TD/VCH/26-27/000001")).toBe(
      "dev/documents/26-27/VCH/TD-VCH-26-27-000001.pdf",
    );
  });

  test("a number that is not a document number is refused, not guessed", () => {
    // The old object form lands here now — which is the point: a caller that
    // gets this wrong should hear about it rather than build a key from
    // `[object Object]`.
    expect(() => keys.buildDocumentKey({ documentNumber: "INV-2026" })).toThrow(
      /Not a document number/,
    );
    expect(() => keys.buildDocumentKey("")).toThrow(/Not a document number/);
  });

  test("a staging key sits outside the type tree", () => {
    // The type prefix is a claim about content, and at this point nothing has
    // read the bytes.
    const key = keys.buildStagingKey({ userId: "u1", mime: "image/png" });
    expect(key.startsWith("dev/staging/u1/")).toBe(true);
    expect(key).not.toContain("images/");
  });

  test("documents are the only PRIVATE purpose", () => {
    expect(keys.bucketFor(UPLOAD_PURPOSE.DOCUMENT)).toBe(
      STORAGE_BUCKET.PRIVATE,
    );
    expect(keys.bucketFor(UPLOAD_PURPOSE.BRAND_LOGO)).toBe(
      STORAGE_BUCKET.PUBLIC,
    );
  });
});

describe("deleteAsset — L-1, the provider switch that did nothing", () => {
  test("an S3 row actually reaches S3", async () => {
    await storage.deleteAsset({
      url: "https://cdn.test/dev/images/brands/b1/x.webp",
      storage: {
        provider: STORAGE_PROVIDER.AWS_S3,
        bucket: "trydood-nonprod-public",
        key: "dev/images/brands/b1/x.webp",
      },
    });
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const command = mockS3Send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: "trydood-nonprod-public",
      Key: "dev/images/brands/b1/x.webp",
    });
  });

  test("an unknown provider throws instead of warning and returning", async () => {
    await expect(
      storage.deleteAsset({
        url: "https://x.test/a.png",
        storage: { provider: "GCS", key: "a.png" },
      }),
    ).rejects.toThrow(/Unknown storage provider: GCS/);
  });

  test("a row with no storage at all is treated as Cloudinary", async () => {
    // Everything written before the `storage` field existed is on Cloudinary,
    // because there was no other provider then.
    await storage.deleteAsset({ url: "https://res.cloudinary.test/old.png" });
    expect(cloudinary.deleteFile).toHaveBeenCalledWith(
      "https://res.cloudinary.test/old.png",
      "image",
    );
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test("an empty media slot is not an error", async () => {
    await expect(storage.deleteAsset(null)).resolves.toBe(false);
    await expect(storage.deleteAsset({})).resolves.toBe(false);
  });

  test("🔴 a shared default image is never destroyed", async () => {
    // `Category.image` DEFAULTS to this URL, so every category that never got
    // its own picture carries the same one. Deleting it on a single category
    // delete would blank the tile on all of them.
    const { DEFAULT_IMAGES } = require("../../constants");

    await expect(
      storage.deleteAsset({ url: DEFAULT_IMAGES.CATEGORY }),
    ).resolves.toBe(false);
    await expect(
      storage.deleteAsset({ url: DEFAULT_IMAGES.SUBCATEGORY }),
    ).resolves.toBe(false);

    expect(cloudinary.deleteFile).not.toHaveBeenCalled();
    expect(cloudinary.destroyPublicId).not.toHaveBeenCalled();
  });

  test("…but an ordinary uploaded image still is", async () => {
    await storage.deleteAsset({ url: "https://res.cloudinary.test/Images/mine" });
    expect(cloudinary.deleteFile).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAsset — L-2, the URL check that skipped silently", () => {
  test("deletes by public id, never parsing the URL", async () => {
    await storage.deleteAsset({
      url: "https://some-other-host.test/whatever.png",
      storage: {
        provider: STORAGE_PROVIDER.CLOUDINARY,
        publicId: "Images/abc123",
      },
    });
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith(
      "Images/abc123",
      "image",
    );
    // The old path would have compared the host, found no match, and returned
    // false with a console.log.
    expect(cloudinary.deleteFile).not.toHaveBeenCalled();
  });

  test("a video is destroyed as a video, not as an image", async () => {
    // Cloudinary answers "not found" when the resource_type is wrong, and the
    // file stays.
    await storage.deleteAsset({
      storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "Videos/v1" },
      metadata: { mimeType: "video/mp4" },
    });
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith("Videos/v1", "video");
  });

  test("a GIF is destroyed as an image, which is what Cloudinary calls it", async () => {
    await storage.deleteAsset({
      storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "Images/g1" },
      type: "GIF",
    });
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith("Images/g1", "image");
  });
});

describe("deleteAssets — L-3, the rollback that left orphans", () => {
  test("one failure does not stop the others, and is counted", async () => {
    cloudinary.destroyPublicId
      .mockRejectedValueOnce(new Error("cloudinary is down"))
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const result = await storage.deleteAssets([
      { storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "a" } },
      { storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "b" } },
      { storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "c" } },
    ]);

    expect(cloudinary.destroyPublicId).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ deleted: 2, failed: 1 });
  });

  test("an empty list is not an error", async () => {
    await expect(storage.deleteAssets([])).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
    await expect(storage.deleteAssets()).resolves.toEqual({
      deleted: 0,
      failed: 0,
    });
  });
});

/**
 * 🔴 `isCustomThumbnail` ke test yahan se hate — function hi nahi raha.
 *
 * Wo ek sawaal ka jawab deta tha: "ye poster vendor ne upload kiya ya humne
 * derive kiya?" — kyunki derived poster ko delete karna video ka apna asset le
 * doobta tha. Us sawaal ka koi bharosemand jawab tha hi nahi: S3 par `publicId`
 * null hota hai, to URL comparison skip ho jaata aur **har** derived poster
 * custom padha jaata — yaani video ka poster badalne par wahi poster delete ho
 * jaata jo vendor abhi dekh raha tha.
 *
 * M-4 me poster derive hona band ho gaya (dono provider par), aur
 * `mediaSchema` use VIDEO par mandatory rakhta hai. Ab har stored poster ek
 * alag file hai jise sirf wahi media reference karta hai — to sawaal hi khatam.
 *
 * Poster ka naya behaviour `sectionCover.test.js` aur `bannerMedia.test.js` me
 * test hota hai.
 */

describe("S3 provider URLs", () => {
  const s3 = require("../../services/storage/providers/s3");

  test("a public object is served from the CDN", () => {
    expect(
      s3.url({
        storage: { bucket: "trydood-nonprod-public", key: "dev/images/a.webp" },
      }),
    ).toBe("https://cdn.test/dev/images/a.webp");
  });

  test("🔴 a private object has no public URL", () => {
    // Returning one would either 403 for the customer, or — far worse — work.
    expect(() =>
      s3.url({
        storage: {
          bucket: "trydood-nonprod-private",
          key: "dev/documents/2026/INV/1.pdf",
        },
      }),
    ).toThrow(/no public URL/);
  });

  test("falls back to the bucket endpoint when there is no CDN", () => {
    const previous = mockConfig.CDN_BASE_URL;
    mockConfig.CDN_BASE_URL = "";
    try {
      expect(
        s3.url({
          storage: { bucket: "trydood-nonprod-public", key: "dev/a.webp" },
        }),
      ).toBe(
        "https://trydood-nonprod-public.s3.ap-south-1.amazonaws.com/dev/a.webp",
      );
    } finally {
      mockConfig.CDN_BASE_URL = previous;
    }
  });
});

describe("provider selection", () => {
  test("new uploads follow Setting.storage.provider", async () => {
    // ⚠️ The admin panel decides this, not a redeploy. `MEDIA_PROVIDER` seeds a
    // brand-new install and is never read again — otherwise a deploy would
    // quietly override what somebody chose in the panel.
    expect(await storage.activeProvider()).toBe(STORAGE_PROVIDER.CLOUDINARY);
    mockStorageConfig.provider = STORAGE_PROVIDER.AWS_S3;
    expect(await storage.activeProvider()).toBe(STORAGE_PROVIDER.AWS_S3);
  });

  test("⚠️ the environment does not override the panel", async () => {
    mockConfig.MEDIA_PROVIDER = STORAGE_PROVIDER.AWS_S3;
    mockStorageConfig.provider = STORAGE_PROVIDER.CLOUDINARY;

    expect(await storage.activeProvider()).toBe(STORAGE_PROVIDER.CLOUDINARY);
  });

  test("🔴 deletes follow the row, not the setting", async () => {
    // Flipping the switch must not strand everything uploaded before it.
    mockStorageConfig.provider = STORAGE_PROVIDER.AWS_S3;
    await storage.deleteAsset({
      storage: { provider: STORAGE_PROVIDER.CLOUDINARY, publicId: "Images/old" },
    });
    expect(cloudinary.destroyPublicId).toHaveBeenCalledWith(
      "Images/old",
      "image",
    );
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

describe("🔴 a private object has no URL, and asking for one must not throw", () => {
  /**
   * `exports.url` refuses a private bucket on purpose — there is no lasting link
   * to one. But `upload` called it unconditionally, so **every document upload
   * would have thrown** the moment the provider became S3: invoices,
   * settlements, refunds and chargebacks all render into the private bucket.
   *
   * Nothing caught it because the provider was still Cloudinary and the document
   * tests mock the upload away.
   */
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const s3 = require("../../services/storage/providers/s3");

  let probe;

  beforeAll(() => {
    probe = path.join(os.tmpdir(), `storage-probe-${Date.now()}`);
    fs.writeFileSync(probe, "%PDF-1.7\n");
  });

  /**
   * ⚠️ Deliberately **not** deleted.
   *
   * `PutObjectCommand` is handed a read stream, and `fs.createReadStream` opens
   * the file on a later tick. The mocked `send` resolves without ever consuming
   * it, so the handle is still pending when a cleanup would run — removing the
   * file raced that open and crashed the worker with ENOENT, from both a
   * per-test `finally` and an `afterAll`.
   *
   * Nine bytes in the OS temp directory is the cheaper answer than teaching the
   * shared `send` mock to drain a stream nothing else cares about.
   */

  test("a document upload returns null rather than throwing", async () => {
    const result = await s3.upload({
      filePath: probe,
      purpose: UPLOAD_PURPOSE.DOCUMENT,
      entityId: "e1",
      kind: MEDIA_KIND.DOCUMENT,
      originalFile: { name: "x.pdf", mimetype: "application/pdf" },
      key: "dev/documents/26-27/VCH/TD-VCH-26-27-000001.pdf",
    });

    expect(result.url).toBeNull();
    // and it still says where the bytes are, which is what mints the real link
    expect(result.storage.key).toContain("dev/documents/");
    expect(result.storage.bucket).toBe("trydood-nonprod-private");
  });

  test("⚠️ a public upload still gets its URL", async () => {
    const result = await s3.upload({
      filePath: probe,
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "b1",
      kind: MEDIA_KIND.IMAGE,
      originalFile: { name: "a.webp", mimetype: "image/webp" },
    });

    expect(result.url).toContain("https://cdn.test/");
  });

  /**
   * 🔴 No provider returns a `thumbnail` any more (M-4).
   *
   * It was `getOptimizedImageUrl(publicId)` on Cloudinary — the delivery URL a
   * second time for a photo, and for a **video** an `/image/upload/` path for an
   * asset under `/video/upload/`, which 404s. S3 returned `null` for a video and
   * the URL again for a photo. A caller that trusted the field got a broken
   * poster on one provider and nothing on the other, and `thumbnail || url` then
   * made a section's cover the `.mp4` itself.
   *
   * A poster is uploaded alongside the video now and lives in
   * `mediaSchema.poster`, so there is no derived field left to trust.
   */
  test("no provider hands back a derived thumbnail", async () => {
    const fromS3 = await s3.upload({
      filePath: probe,
      purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      entityId: "b1",
      kind: MEDIA_KIND.IMAGE,
      originalFile: { name: "a.webp", mimetype: "image/webp" },
    });

    expect(fromS3).not.toHaveProperty("thumbnail");

    cloudinary.uploadFile.mockResolvedValueOnce({
      public_id: "Images/x",
      secure_url: "https://res.cloudinary.test/Images/x.mp4",
      format: "mp4",
      bytes: 10,
    });
    const fromCloudinary = await require("../../services/storage/providers/cloudinary").upload(
      {
        filePath: probe,
        purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
        entityId: "s1",
        kind: MEDIA_KIND.VIDEO,
        originalFile: { name: "v.mp4", mimetype: "video/mp4" },
      },
    );

    expect(fromCloudinary).not.toHaveProperty("thumbnail");
  });

  test("and `url()` itself still refuses a private object outright", () => {
    // The guard stays where it belongs — building a plain URL for a private
    // object would produce a link that 403s, or worse, one that works.
    expect(() =>
      s3.url({
        storage: { bucket: "trydood-nonprod-private", key: "dev/documents/x.pdf" },
      }),
    ).toThrow(/no public URL/);
  });
});

/**
 * 🔴 G5 — how long a document link lives is the admin's number.
 *
 * `Setting.storage.delivery.signedUrlTtlMinutes` had a schema entry, a
 * validator and a line in the admin doc, and **nothing read it**: `s3.js` used
 * its own five-minute constant whatever the panel said.
 *
 * ⚠️ Read in the facade rather than inside the provider, so the provider stays
 * what its own header calls it — a key, a bucket and the bytes. How long a link
 * should live is a platform decision, not an S3 one.
 */
describe("🔴 a document link expires when the admin says, not when s3.js says", () => {
  const s3 = require("../../services/storage/providers/s3");

  const asset = {
    url: null,
    storage: {
      provider: "AWS_S3",
      bucket: "trydood-nonprod-private",
      key: "documents/TD-VCH-26-27-000001.pdf",
    },
  };

  let signed;
  beforeEach(() => {
    signed = jest
      .spyOn(s3, "signedGetUrl")
      .mockResolvedValue("https://signed.test/x?X-Amz-Expires=600");
  });
  afterEach(() => signed.mockRestore());

  test("the configured TTL reaches the signer", async () => {
    mockStorageConfig.signedUrlTtlSeconds = 11 * 60;

    await storage.documentUrl(asset);

    expect(signed).toHaveBeenCalledWith(
      expect.objectContaining({ expiresIn: 11 * 60 }),
    );
  });

  test("⚠️ and changing it changes what is signed, with no deploy", async () => {
    mockStorageConfig.signedUrlTtlSeconds = 60;
    await storage.documentUrl(asset);
    expect(signed).toHaveBeenLastCalledWith(
      expect.objectContaining({ expiresIn: 60 }),
    );

    mockStorageConfig.signedUrlTtlSeconds = 30 * 60;
    await storage.documentUrl(asset);
    expect(signed).toHaveBeenLastCalledWith(
      expect.objectContaining({ expiresIn: 30 * 60 }),
    );
  });

  test("the object it signs is the one it was handed", async () => {
    mockStorageConfig.signedUrlTtlSeconds = 300;

    await storage.documentUrl(asset);

    expect(signed).toHaveBeenCalledWith(
      expect.objectContaining({ storage: asset.storage }),
    );
  });

  /**
   * ⚠️ Cloudinary has nothing short-lived to mint — its delivery URL is the only
   * one there is. So the TTL is not read at all there, and asking for it must
   * not become a reason to fail.
   */
  test("a Cloudinary document still answers with its permanent URL", async () => {
    const cloudinaryDoc = {
      url: "https://res.cloudinary.test/invoice",
      storage: { provider: "CLOUDINARY", publicId: "invoice", bucket: null, key: null },
    };

    await expect(storage.documentUrl(cloudinaryDoc)).resolves.toBeTruthy();
    expect(signed).not.toHaveBeenCalled();
  });
});
