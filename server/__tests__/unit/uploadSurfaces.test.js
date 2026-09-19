/**
 * U-5 — the surfaces that were left, on both roads.
 *
 * ### 🔴 What this file is for, and what it deliberately is not
 *
 * The facade's own round trip is proven against the **real bucket** four times
 * over — `uploadAccept`, `categoryUpload`, `showcaseUpload` and the voucher
 * suites. Repeating that for eight more surfaces would buy nothing and cost
 * minutes per run.
 *
 * What is genuinely new per surface is small and worth pinning exactly:
 *
 *   1. the validator takes the id, and refuses a malformed one — the first gate,
 *      and the only one that answers before anything is loaded
 *   2. the helper hands the facade an **actor** and the **right purpose** —
 *      getting either wrong fails nowhere on the multipart road, because that
 *      road never reads them
 *   3. a poster's purpose is narrower than the thing it belongs to
 */

const Joi = require("joi");

const {
  UPLOAD_PURPOSE,
  UPLOAD_PURPOSES,
  MEDIA_KIND,
} = require("../../constants/storage");
const { localFile, cleanup } = require("../support/localFile");

afterAll(cleanup);

const REAL = "68f1a2b3c4d5e6f7a8b9e001";

/** Messages for a body, whether the validator is a schema or a plain object. */
const messages = (schema, body) => {
  const compiled = Joi.isSchema(schema) ? schema : Joi.object(schema);
  return (
    compiled
      .validate(body, { abortEarly: false })
      .error?.details.map((detail) => detail.message) ?? []
  );
};

describe("🔴 every surface's validator takes an uploadId, and refuses a bad one", () => {
  const { validateCreateBanner, validateUpdateBanner } = require("../../validator/banners");
  const {
    validateCreateTicker,
    validateUpdateTicker,
  } = require("../../validator/promotionalTicker");
  const { validateUpdateBrand } = require("../../validator/brands");
  const { validateUpdateSubBrand } = require("../../validator/subBrands");
  const {
    validateCreateSubCategory,
    validateUpdateSubCategory,
  } = require("../../validator/subCategories");
  const { validateUpdateUser } = require("../../validator/users");
  const {
    validateAddBrandFeature,
    validateUpdateBrandFeature,
  } = require("../../validator/brandFeatures");

  /**
   * ⚠️ `[schema, field, message]`. Keeping them in one table is the point: a
   * surface added later with no id, or with an id and no message, shows up as a
   * missing row rather than as nothing at all.
   */
  const CASES = [
    ["banner create", validateCreateBanner.body, "mediaUploadId", "Invalid mediaUploadId."],
    ["banner create poster", validateCreateBanner.body, "posterUploadId", "Invalid posterUploadId."],
    ["banner update", validateUpdateBanner.body, "mediaUploadId", "Invalid mediaUploadId."],
    ["ticker create", validateCreateTicker.body, "iconUploadId", "Invalid iconUploadId."],
    ["ticker update", validateUpdateTicker.body, "iconUploadId", "Invalid iconUploadId."],
    ["brand logo", validateUpdateBrand.body, "logoUploadId", "Invalid logoUploadId."],
    ["brand cover", validateUpdateBrand.body, "coverImageUploadId", "Invalid coverImageUploadId."],
    ["outlet logo", validateUpdateSubBrand.body, "logoUploadId", "Invalid logoUploadId."],
    ["outlet cover", validateUpdateSubBrand.body, "coverImageUploadId", "Invalid coverImageUploadId."],
    ["avatar", validateUpdateUser, "uploadId", "Invalid uploadId."],
    ["feature add", validateAddBrandFeature.body, "iconUploadId", "Invalid iconUploadId."],
    ["feature update", validateUpdateBrandFeature.body, "iconUploadId", "Invalid iconUploadId."],
  ];

  test.each(CASES)("%s refuses a malformed id", (_label, schema, field, message) => {
    // `validateUpdateUser` is a function taking the body, not a schema.
    const run = (body) =>
      typeof schema === "function"
        ? schema(body).error?.details.map((d) => d.message) ?? []
        : messages(schema, body);

    expect(run({ [field]: "nope" })).toContain(message);
  });

  /**
   * ⚠️ "No complaint **about the id**", not "no complaints at all" — a create
   * schema has required fields of its own, and an id-only body is missing them.
   * Asserting an empty list would be asserting something else.
   */
  test.each(CASES)("%s accepts a real one", (_label, schema, field, message) => {
    const run = (body) =>
      typeof schema === "function"
        ? schema(body).error?.details.map((d) => d.message) ?? []
        : messages(schema, body);

    expect(run({ [field]: REAL })).not.toContain(message);
  });

  /**
   * ⚠️ The sub-category validators are plain functions, and their create schema
   * needs a name — so they get their own case rather than being bent into the
   * table above.
   */
  test("sub-category refuses a malformed id on both create and update", () => {
    const bad = { name: "Coffee shops", uploadId: "nope" };

    expect(
      validateCreateSubCategory(bad).error.details.map((d) => d.message),
    ).toEqual(["Invalid uploadId."]);
    expect(
      validateUpdateSubCategory({ uploadId: "nope" }).error.details.map(
        (d) => d.message,
      ),
    ).toEqual(["Invalid uploadId."]);
  });

  /**
   * 🔴 One message, not two.
   *
   * `Joi.string().hex().length(24)` reports **both** rules for a value like
   * `"nope"`, and the controller joins them — so the vendor read
   * *"Invalid uploadId., Invalid uploadId."*. The repo's own `objectId()` helper
   * answers once.
   */
  test("a bad id is one complaint, not a stutter", () => {
    expect(
      validateCreateSubCategory({ name: "Coffee shops", uploadId: "nope" })
        .error.details,
    ).toHaveLength(1);
  });
});

describe("🔴 a poster is always narrower than the thing it belongs to", () => {
  /**
   * ⚠️ Three surfaces carry a video and a still, and on the presigned road the
   * **purpose** is the only thing telling the two apart. Share one and the ids
   * become interchangeable — which makes the poster's tighter rule the one a
   * caller can skip, by sending them the other way round.
   *
   * Keeping all three in one table is the point: a fourth pair added later
   * without its own purpose shows up here as a missing row.
   */
  const PAIRS = [
    ["showcase", UPLOAD_PURPOSE.SHOWCASE_MEDIA, UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL],
    ["voucher banner", UPLOAD_PURPOSE.VOUCHER_BANNER, UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER],
    ["app banner", UPLOAD_PURPOSE.BANNER_MEDIA, UPLOAD_PURPOSE.BANNER_POSTER],
  ];

  test.each(PAIRS)("%s — same place, smaller allowance", (_label, wide, narrow) => {
    const big = UPLOAD_PURPOSES[wide];
    const small = UPLOAD_PURPOSES[narrow];

    // Same bucket and prefix, so no object moves because of this.
    expect(small.entity).toBe(big.entity);
    expect(small.bucket).toBe(big.bucket);

    expect(big.kinds).toContain(MEDIA_KIND.VIDEO);
    expect(small.kinds).not.toContain(MEDIA_KIND.VIDEO);
    expect(small.maxBytes).toBeLessThan(big.maxBytes);
  });

  /**
   * 🔴 G12 — and narrower than the surface's own rule allowed it to be.
   *
   * All three surfaces refuse a poster whose kind is not `IMAGE` — the sentence
   * is *"The poster has to be a still image"* in each of them. The purposes,
   * though, listed `[IMAGE, GIF]`.
   *
   * On the multipart road that difference was invisible: the surface refused the
   * GIF and nothing had been spent. On the presigned road it **costs the
   * vendor** — `presign` checks the **purpose**, so a GIF poster was handed a
   * signature, uploaded in full, and only then refused. The refusal has to
   * happen before the bytes move, and the purpose is the only thing presign can
   * read.
   */
  test.each(PAIRS)("🔴 %s — the poster takes stills only, GIF included", (_label, _wide, narrow) => {
    expect(UPLOAD_PURPOSES[narrow].kinds).toEqual([MEDIA_KIND.IMAGE]);
  });

  test("⚠️ and the thing it belongs to still takes a GIF", () => {
    // The narrowing is about posters, not about GIFs being unwelcome.
    for (const [, wide] of PAIRS) {
      expect(UPLOAD_PURPOSES[wide].kinds).toContain(MEDIA_KIND.GIF);
    }
  });
});

describe("🔴 the helpers hand the facade an actor and the right purpose", () => {
  const storage = require("../../services/storage");

  const who = { userId: "u1", role: "ADMIN" };
  const described = (mimetype = "image/png", uploadId = null) => ({
    name: "x.png",
    mimetype,
    size: 1024,
    uploadId,
    file: uploadId ? null : { mimetype, tempFilePath: "/tmp/x.png" },
  });

  let acceptSpy;
  beforeEach(() => {
    acceptSpy = jest.spyOn(storage, "acceptUpload").mockResolvedValue({
      url: "https://cdn.example.com/x.webp",
      storage: { provider: "AWS_S3", bucket: "b", key: "k" },
      metadata: { mimeType: "image/png", size: 1024 },
    });
  });
  afterEach(() => acceptSpy.mockRestore());

  /**
   * ⚠️ This is the failure that hides. An actor that never arrives breaks
   * **only** the presigned road — the multipart road does not read it — so a
   * suite full of multipart tests stays green while every real client is told
   * their upload was not found.
   */
  test("the ticker icon goes up as its own purpose, with the actor", async () => {
    const {
      uploadTickerIcon,
    } = require("../../helpers/promotionalTickers/media");

    await uploadTickerIcon(who, described(), "t1");

    expect(acceptSpy).toHaveBeenCalledWith(
      who,
      expect.objectContaining({
        purpose: UPLOAD_PURPOSE.TICKER_ICON,
        entityId: "t1",
      }),
    );
  });

  test("a presigned ticker icon is spent as an id, not as a file", async () => {
    const {
      uploadTickerIcon,
    } = require("../../helpers/promotionalTickers/media");

    await uploadTickerIcon(who, described("image/png", REAL), "t1");

    const [, options] = acceptSpy.mock.calls[0];
    expect(options.uploadId).toBe(REAL);
    expect(options.file).toBeNull();
  });
});

/**
 * 🔴 A surface that forgets the actor must say so, loudly.
 *
 * ⚠️ Without this the failure is quiet and wrong: `findOne({ _id, userId:
 * undefined })` matches nothing, and the caller is told `404 That upload was not
 * found` — so a vendor whose upload is perfectly fine is told it expired, every
 * time, because of a mistake in a service signature.
 */
describe("🔴 a missing actor is our bug, and is answered as one", () => {
  const { describeIncoming, acceptUpload } = require("../../services/storage");

  test("describeIncoming refuses an id with no actor", async () => {
    await expect(
      describeIncoming(null, {
        uploadId: REAL,
        purpose: UPLOAD_PURPOSE.TICKER_ICON,
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  test("acceptUpload refuses one too", async () => {
    await expect(
      acceptUpload(undefined, {
        uploadId: REAL,
        purpose: UPLOAD_PURPOSE.TICKER_ICON,
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  /**
   * ⚠️ And only on that road. A multipart file needs no actor, and refusing one
   * would break every surface that has not moved yet.
   */
  test("but a plain file needs no actor at all", async () => {
    const answer = await describeIncoming(null, {
      file: localFile("png", { name: "x.png" }),
      purpose: UPLOAD_PURPOSE.TICKER_ICON,
    });

    expect(answer.mimetype).toBe("image/png");
  });

  /**
   * 🔴 G2 — the header is a claim, and this road used to take it as fact.
   *
   * `express-fileupload` copies `Content-Type` straight off the multipart part;
   * nothing opened the file. So every mime check downstream — `assertImageFile`,
   * the banner and ticker lists, `validateVoucherImages` — was deciding on a
   * value the uploader typed.
   */
  test("🔴 a lying Content-Type does not survive the file being opened", async () => {
    const answer = await describeIncoming(null, {
      // An MP4 that says it is a PNG.
      file: localFile("mp4", { name: "clip.png", mimetype: "image/png" }),
      purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    });

    expect(answer.mimetype).toBe("video/mp4");
  });

  test("🔴 an SVG is refused by name, with the reason that matters", async () => {
    await expect(
      describeIncoming(null, {
        file: localFile("svg", { name: "logo.png", mimetype: "image/png" }),
        purpose: UPLOAD_PURPOSE.TICKER_ICON,
      }),
      // Not "must be an image" — it *is* an image, and that answer would send a
      // vendor round in circles. It can carry a script; that is the reason.
    ).rejects.toMatchObject({ statusCode: 400, message: /scripts/ });
  });

  test("a type no signature matches is refused in confirm's own words", async () => {
    await expect(
      describeIncoming(null, {
        file: localFile("unknown", { name: "x.png", mimetype: "image/png" }),
        purpose: UPLOAD_PURPOSE.TICKER_ICON,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "That file type is not supported.",
    });
  });
});

describe("🔴 G1/G2/G3 — both roads now answer the same file the same way", () => {
  const { acceptUpload } = require("../../services/storage/accept");

  const accept = (file, purpose) =>
    acceptUpload({ userId: "u1" }, { file, purpose });

  test("a video is refused by a purpose that takes stills", async () => {
    await expect(
      accept(
        localFile("mp4", { name: "avatar.png", mimetype: "image/png" }),
        UPLOAD_PURPOSE.USER_AVATAR,
      ),
      // Word for word what `confirm` says on the other road.
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "USER_AVATAR does not accept MP4/MOV files.",
    });
  });

  /**
   * ⚠️ G1 — the size half of this lives in `__tests__/money/uploadSizeLimits`,
   * not here. The cap is `min(static, Setting.storage.limits, surface override)`
   * and the middle term is a database read, which is exactly what this config
   * exists to stay out of. Asserting it against a mocked `Setting` would pin the
   * mock, and the mock is not the thing that was wrong.
   */
  test("⚠️ and it is metered by what the bytes are, not what was declared", async () => {
    // Declared a GIF (15 MB platform ceiling), actually a video.
    await expect(
      accept(
        localFile("mp4", { name: "clip.gif", mimetype: "image/gif" }),
        UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
