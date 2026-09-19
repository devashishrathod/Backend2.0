/**
 * U-3 commit 1 — the admin's size limit applies to the presigned road too.
 *
 * ### 🔴 What was wrong
 *
 * `presign` built its S3 policy from a **static** constant, and `confirm` held
 * the real byte count and never compared it to anything. So
 * `Setting.storage.limits` (ST-3) and every surface override (ST-4) governed the
 * multipart road and nothing else: an admin lowering the platform video limit
 * from 50 MB to 20 changed the panel and left direct-to-S3 at 50.
 *
 * ### 🔴 Why a real bucket
 *
 * The 413 at presign is only the readable refusal. The thing that actually stops
 * a 50 MB upload is `content-length-range` inside a policy **S3** enforces — so
 * the only way to prove the admin's number reached it is to send oversize bytes
 * at the real bucket and read its answer off the wire. A mock would enforce
 * whatever it was handed, which is the one thing under test.
 *
 * ### ⚠️ The `Setting` document is mocked, and only that
 *
 * These tests need several different limit configurations. Writing them to the
 * shared `Trydood2_test` settings singleton would leak into every other money
 * suite that reads it — which is O-2's failure mode, deliberately reproduced.
 * Jest gives each test file its own module registry, so mocking `getSetting`
 * here changes nothing for any other file. S3, the `Upload` rows and every byte
 * are real.
 */

const mockSetting = { value: {} };
jest.mock("../../helpers/settings/getSetting", () => ({
  getSetting: jest.fn(async () => mockSetting.value),
  getSettingDocument: jest.fn(),
  invalidateSettingCache: jest.fn(),
}));

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const {
  createUploadIntent,
  confirmUpload,
  deleteAssets,
} = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

const MB = 1024 * 1024;
const oid = () => new mongoose.Types.ObjectId();
const actor = (userId = oid()) => ({ userId });

/** A 1x1 PNG — real magic bytes and a readable IHDR. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A PNG that weighs something.
 *
 * ⚠️ Padding after `IEND`, on purpose. `identify` and `readDimensions` read the
 * head of the object, so this is still a PNG of 1x1 to everything that inspects
 * it — while `head.ContentLength` is the number under test. Generating a real
 * megabyte-sized image would prove exactly the same thing, slower.
 */
const heavyPng = (bytes) => Buffer.concat([PNG, Buffer.alloc(bytes, 0)]);

/**
 * ⚠️ `provider` and `presignEnabled` are set on every one of these.
 *
 * The presigned road is off by default (G5) and refuses outright on a platform
 * that is not on S3, so a `Setting` naming only limits would answer `503` before
 * any of these tests reached the number they are about.
 */
const limitsAre = (storageLimits = {}, showcase = null) => {
  mockSetting.value = {
    storage: {
      provider: "AWS_S3",
      upload: { presignEnabled: true },
      limits: storageLimits,
    },
    ...(showcase ? { vendor: { showcase } } : {}),
  };
};

/** POST the bytes the way a browser would: signed fields first, file last. */
const uploadTo = async ({ url, fields }, body) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([body], { type: fields["Content-Type"] }), "probe");
  return fetch(url, { method: "POST", body: form });
};

const NOTHING_THREW = Symbol("nothing threw");
const failure = async (promise) => {
  const error = await promise.then(
    () => NOTHING_THREW,
    (thrown) => thrown,
  );
  if (error === NOTHING_THREW) {
    throw new Error("expected this to be refused, and it was not");
  }
  return { statusCode: error.statusCode, message: error.message };
};

/**
 * ⚠️ A confirmed object is a real object in the real bucket, so this run takes
 * its own back out. Only the refused ones are swept by the `staging/` lifecycle
 * rule — a confirmed one has moved out of that prefix by definition.
 */
const littered = [];
const rememberObjects = async () => {
  const rows = await Upload.find({ "storage.key": { $exists: true } })
    .select("storage")
    .lean();
  rows.forEach((row) => littered.push(row.storage));
};

beforeAll(async () => {
  await connectTestDb();
  await Upload.createIndexes();
}, 60000);

afterAll(async () => {
  await rememberObjects();
  await deleteAssets(littered.map((ref) => ({ storage: ref, url: null })));
  await clearCollections(Upload);
  await disconnectTestDb();
}, 120000);

beforeEach(async () => {
  mockSetting.value = {};
  await rememberObjects();
  await clearCollections(Upload);
});

describe("🔴 presign refuses against the admin's number", () => {
  it("names the platform limit, not the constant in the code", async () => {
    limitsAre({ maxImageSizeMB: 2 });

    const { statusCode, message } = await failure(
      createUploadIntent(actor(), {
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        contentType: "image/png",
        sizeBytes: 5 * MB,
        fileName: "big.png",
      }),
    );

    expect(statusCode).toBe(413);
    // The static ceiling here is 10 MB. Saying "10" would mean the setting was
    // read by nothing, which is exactly the state this closes.
    expect(message).toContain("2 MB");
  });

  /**
   * ⚠️ ST-4 — a surface may narrow the platform ceiling, and the presigned road
   * has to hear it. Showcase is the only surface with its own numbers today.
   */
  it("hears a surface that asks for less than the platform allows", async () => {
    limitsAre({ maxVideoSizeMB: 40 }, { maxVideoSizeMB: 5 });

    const { statusCode, message } = await failure(
      createUploadIntent(actor(), {
        purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
        contentType: "video/mp4",
        sizeBytes: 10 * MB,
        fileName: "clip.mp4",
      }),
    );

    expect(statusCode).toBe(413);
    expect(message).toContain("5 MB");
  });

  it("allows what the admin allows", async () => {
    limitsAre({ maxImageSizeMB: 8 });

    const intent = await createUploadIntent(actor(), {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: 5 * MB,
      fileName: "ok.png",
    });

    expect(intent.uploadId).toBeTruthy();
  });
});

describe("🔴 and S3 enforces that same number", () => {
  /**
   * The part that actually protects the bucket. The 413 above is a courtesy —
   * a client can simply not ask. `content-length-range` is written into the
   * signed policy, and this proves the number in it came from the setting.
   *
   * ⚠️ The declared size is deliberately tiny. It is a claim, and the policy is
   * built from the **limit**, never from the claim — so under-declaring must buy
   * nothing.
   */
  it("refuses bytes over the limit even when the client declared far less", async () => {
    limitsAre({ maxImageSizeMB: 1 });

    const intent = await createUploadIntent(actor(), {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: PNG.length,
      fileName: "small-claim.png",
    });

    const sent = await uploadTo(intent, heavyPng(2 * MB));

    expect(sent.ok).toBe(false);
    const body = await sent.text();
    expect(body).toContain("EntityTooLarge");
  });

  it("accepts bytes under it", async () => {
    limitsAre({ maxImageSizeMB: 4 });

    const intent = await createUploadIntent(actor(), {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: PNG.length,
      fileName: "fine.png",
    });

    const sent = await uploadTo(intent, heavyPng(1 * MB));

    expect(sent.ok).toBe(true);
  });
});

describe("🔴 confirm measures the object, against the limit as it stands now", () => {
  /**
   * 🔴 The window the policy cannot cover.
   *
   * A signature is written once and is valid for fifteen minutes. An admin who
   * lowers the limit inside that window does not change the signature already in
   * a client's hand — so without this check, every outstanding presign keeps the
   * old ceiling until it expires. On top of that, every signature issued before
   * this commit carries the static constant.
   */
  it("refuses a file the policy let through under an older, higher limit", async () => {
    limitsAre({ maxImageSizeMB: 8 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: 2 * MB,
      fileName: "was-allowed.png",
    });
    expect((await uploadTo(intent, heavyPng(2 * MB))).ok).toBe(true);

    // The admin tightens it while the upload is in flight.
    limitsAre({ maxImageSizeMB: 1 });

    const { statusCode, message } = await failure(
      confirmUpload(who, intent.uploadId),
    );

    expect(statusCode).toBe(413);
    expect(message).toContain("1 MB");
  });

  it("throws the rejected object away rather than leaving it in staging", async () => {
    limitsAre({ maxImageSizeMB: 8 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: 2 * MB,
      fileName: "discarded.png",
    });
    await uploadTo(intent, heavyPng(2 * MB));

    limitsAre({ maxImageSizeMB: 1 });
    await failure(confirmUpload(who, intent.uploadId));

    /**
     * ⚠️ Otherwise a caller could park oversize objects in `staging/` at will,
     * one failed confirm at a time — the lifecycle rule would collect them
     * eventually, but "eventually" is a whole billing period.
     *
     * A second confirm is the cheapest way to ask S3 whether the object is
     * still there: it re-heads the staging key and answers "never uploaded"
     * when it is gone.
     */
    const second = await failure(confirmUpload(who, intent.uploadId));
    expect(second.message).toMatch(/never uploaded|already expired/i);
  });

  /**
   * 🔴 Metered by what the bytes **are**, not by what was declared.
   *
   * A GIF has its own, larger ceiling everywhere in this codebase — so
   * announcing a PNG as a GIF would otherwise buy it the GIF allowance. The kind
   * is settled from the magic bytes a few lines earlier for exactly this reason.
   */
  it("meters the verified kind, not the declared one", async () => {
    limitsAre({ maxImageSizeMB: 1, maxGifSizeMB: 15 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      // Declared a GIF, so presign meters it against the 15 MB GIF ceiling.
      contentType: "image/gif",
      sizeBytes: 2 * MB,
      fileName: "claims-to-be.gif",
    });
    expect((await uploadTo(intent, heavyPng(2 * MB))).ok).toBe(true);

    const { statusCode, message } = await failure(
      confirmUpload(who, intent.uploadId),
    );

    // PNG bytes → IMAGE → 1 MB. Reading the declared GIF would have allowed it.
    expect(statusCode).toBe(413);
    expect(message).toContain("1 MB");
  });

  /**
   * 🔴 The real byte count, not the number the client typed.
   *
   * Here the declaration is honest enough to pass presign and the policy is wide
   * enough to accept the bytes — so the only thing that can refuse this is
   * `head.ContentLength`. Reading `declaredSizeBytes` instead would let a client
   * under-declare their way past every limit on this road.
   */
  it("measures the object, not what the client said it would be", async () => {
    limitsAre({ maxImageSizeMB: 4 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      // A claim of a few hundred bytes, for a 3 MB object.
      sizeBytes: PNG.length,
      fileName: "under-declared.png",
    });
    expect((await uploadTo(intent, heavyPng(3 * MB))).ok).toBe(true);

    limitsAre({ maxImageSizeMB: 2 });
    const { statusCode } = await failure(confirmUpload(who, intent.uploadId));

    expect(statusCode).toBe(413);
  });

  /**
   * ⚠️ The boundary. A file of exactly the limit is **within** it — an
   * off-by-one here refuses the one size the admin explicitly allowed, and the
   * vendor is told their 4 MB file is over a 4 MB limit.
   */
  it("allows a file of exactly the limit", async () => {
    limitsAre({ maxImageSizeMB: 1 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: MB,
      fileName: "exactly.png",
    });
    expect((await uploadTo(intent, heavyPng(MB - PNG.length))).ok).toBe(true);

    const confirmed = await confirmUpload(who, intent.uploadId);

    expect(confirmed.metadata.sizeBytes).toBe(MB);
  });

  it("lets a file within the limit through", async () => {
    limitsAre({ maxImageSizeMB: 4 });
    const who = actor();

    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: 1 * MB,
      fileName: "within.png",
    });
    await uploadTo(intent, heavyPng(1 * MB));

    const confirmed = await confirmUpload(who, intent.uploadId);

    expect(confirmed.storage.key).toBeTruthy();
    expect(confirmed.metadata.sizeBytes).toBeGreaterThan(MB);
  });
});

/**
 * 🔴 G1 — and the multipart road obeys the same number.
 *
 * ### What was wrong
 *
 * Nine surfaces had **no per-purpose size check at all** on this road. The only
 * thing that stopped anything was `MAX_UPLOAD_SIZE_MB` — 100 MB — which exists
 * so one request cannot fill the disk, not as anybody's limit. So the same file
 * was accepted through the panel and refused through presign, and which answer
 * a vendor got depended on a road they never chose.
 *
 * ### ⚠️ Every refusal below happens before a single byte leaves this machine
 *
 * `verifyLocalFile` runs ahead of `uploadFromPath`, so these cost no provider
 * call and litter nothing. That ordering is the point: refusing after the upload
 * would mean the vendor paid for a file we were always going to reject.
 */
describe("🔴 G1 — the multipart road obeys the same number", () => {
  const { acceptUpload } = require("../../services/storage");
  const { localFile, cleanup } = require("../support/localFile");

  afterAll(cleanup);

  // ⚠️ `entityId` is not optional on this road: the object key carries it
  // (`images/categories/<id>/<uuid>.png`), and `buildKey` refuses without one.
  const accept = (file, purpose) =>
    acceptUpload(actor(), { file, purpose, entityId: oid() });

  it("refuses against the admin's number, not the 100 MB transport limit", async () => {
    limitsAre({ maxImageSizeMB: 2 });

    const { statusCode, message } = await failure(
      accept(
        localFile("png", { name: "cover.png", sizeBytes: 3 * MB }),
        UPLOAD_PURPOSE.BRAND_COVER,
      ),
    );

    expect(statusCode).toBe(413);
    expect(message).toMatch(/The limit here is 2 MB/);
  });

  it("⚠️ and lowering the platform limit moves this road too", async () => {
    limitsAre({ maxImageSizeMB: 1 });

    const { statusCode } = await failure(
      accept(
        localFile("png", { name: "avatar.png", sizeBytes: 2 * MB }),
        UPLOAD_PURPOSE.USER_AVATAR,
      ),
    );

    expect(statusCode).toBe(413);
  });

  /**
   * 🔴 The static ceiling still wins when it is the smaller one — a ticker icon
   * is 2 MB in code, and no `Setting` may raise it.
   */
  it("🔴 a setting cannot raise a purpose above its ceiling in code", async () => {
    limitsAre({ maxImageSizeMB: 50 });

    const { statusCode, message } = await failure(
      accept(
        localFile("png", { name: "icon.png", sizeBytes: 3 * MB }),
        UPLOAD_PURPOSE.TICKER_ICON,
      ),
    );

    expect(statusCode).toBe(413);
    expect(message).toMatch(/The limit here is 2 MB/);
  });

  /**
   * 🔴 G2 — and it is weighed as what it **is**.
   *
   * A file announced as a GIF and actually a video used to be metered against
   * the GIF ceiling on this road, because the only thing consulted was the
   * header the uploader wrote.
   */
  it("🔴 meters by the verified kind, not the declared one", async () => {
    limitsAre({ maxImageSizeMB: 10, maxGifSizeMB: 15, maxVideoSizeMB: 1 });

    const { statusCode, message } = await failure(
      accept(
        localFile("mp4", {
          name: "clip.gif",
          mimetype: "image/gif",
          sizeBytes: 2 * MB,
        }),
        UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      ),
    );

    expect(statusCode).toBe(413);
    // 15 MB would be the GIF allowance it claimed; 1 MB is the video's.
    expect(message).toMatch(/The limit here is 1 MB/);
  });

  /**
   * ⚠️ This one really uploads, so it names the provider and takes its object
   * back out. Every test above refuses before `uploadFromPath` and leaves
   * nothing anywhere — only the accepting path can litter.
   */
  const uploadedHere = [];
  afterAll(async () => {
    await deleteAssets(uploadedHere);
  }, 60000);

  it("🔴 lets a file within the limit through, and records what it really is", async () => {
    limitsAre({ maxImageSizeMB: 4 });

    const uploaded = await accept(
      // Declared a JPEG, actually a PNG — and 45×75, so the dimensions below are
      // a real read rather than a zero that could also mean "never parsed".
      localFile("png", { name: "ok.jpg", mimetype: "image/jpeg" }),
      UPLOAD_PURPOSE.CATEGORY_IMAGE,
    );
    uploadedHere.push(uploaded);

    // 🔴 G2 — the stored type is what the bytes are, not what the client wrote.
    expect(uploaded.metadata.mimeType).toBe("image/png");
    // 🔴 G3 — dimensions used to be `null` on this road and real on the other.
    expect(uploaded.metadata).toMatchObject({ width: 45, height: 75 });
  });
});
