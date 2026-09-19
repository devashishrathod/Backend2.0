/**
 * U-1 — presigned direct-to-S3 upload, end to end.
 *
 * ### 🔴 Why a real bucket, not a mock
 *
 * The whole point of this path is that **S3 enforces the policy**, not us. A
 * mock would enforce whatever the mock was told to, which is the one thing
 * these tests must not assume: that the size cap, the pinned content type and
 * the exact key are real constraints rather than fields in an object we built.
 *
 * So each test presigns for real, POSTs to the real bucket, and confirms — and
 * the refusals below are S3's own, read back off the wire.
 *
 * ⚠️ Everything lands under `staging/` and is either consumed or discarded, so
 * nothing is left behind. The bucket's lifecycle rule on that prefix is the
 * backstop for anything a crashed run misses.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  enablePresign,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const {
  createUploadIntent,
  confirmUpload,
} = require("../../services/storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

const oid = () => new mongoose.Types.ObjectId();
const actor = (userId = oid()) => ({ userId });

/** A 1x1 PNG — the smallest thing that is still a real image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A GIF header, so a file can lie about what it is. */
const GIF = Buffer.concat([
  Buffer.from("GIF89a", "ascii"),
  Buffer.alloc(40, 0),
]);

/**
 * POST the bytes exactly the way a browser would: every signed field first, the
 * file last. S3 ignores anything after the file part.
 */
const uploadTo = async ({ url, fields }, body, contentType, overrides = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) {
    form.append(key, value);
  }
  form.append("file", new Blob([body], { type: contentType }), "probe");
  return fetch(url, { method: "POST", body: form });
};

const presign = (who, overrides = {}) =>
  createUploadIntent(who, {
    purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    contentType: "image/png",
    sizeBytes: PNG.length,
    fileName: "probe.png",
    ...overrides,
  });

const failure = async (promise) => {
  try {
    await promise;
    throw new Error("expected this to throw, and it did not");
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
};

/**
 * ⚠️ 120s, not the config's 60.
 *
 * 🔴 This hook does three round trips to a shared M0 — connect, the settings
 * write, and `createIndexes()` — and `createIndexes` costs seconds even when
 * every index already exists, because the cost is *checking* them. Under a full
 * suite run it competes with everything else on the same tier and crossed 60s
 * the moment `enablePresign` was added: all three presign suites failed at
 * **70.7 seconds**, every test at once, on correct assertions.
 *
 * A hook timeout does not read as "the cluster was busy" — it reads as a broken
 * feature. CLAUDE.md records that exact false signal sending two earlier
 * debugging sessions the wrong way.
 */
beforeAll(async () => {
  await connectTestDb();
  // ⚠️ The presigned road is off by default (G5) — this suite uses it.
  await enablePresign();
  await Upload.createIndexes();
}, 120000);

afterAll(async () => {
  await clearCollections(Upload);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Upload);
});

describe("asking for permission to upload", () => {
  it("hands back a signed form and records the intent", async () => {
    const who = actor();

    const intent = await presign(who);

    expect(intent.uploadId).toBeTruthy();
    expect(intent.url).toMatch(/^https?:\/\//);
    expect(intent.fields.key).toBe(intent.stagingKey);
    expect(intent.expiresInSeconds).toBeGreaterThan(0);

    const row = await Upload.findById(intent.uploadId).lean();
    expect(String(row.userId)).toBe(String(who.userId));
    expect(row.purpose).toBe(UPLOAD_PURPOSE.CATEGORY_IMAGE);
    expect(row.consumedAt ?? null).toBeNull();
  });

  /**
   * ⚠️ Under `staging/`, outside the type tree. Nothing serves from there, and
   * the bucket's lifecycle rule sweeps whatever is never confirmed.
   */
  it("writes into staging, never straight into the type tree", async () => {
    const intent = await presign(actor());

    expect(intent.stagingKey).toMatch(/staging\//);
    expect(intent.stagingKey).not.toMatch(/^images\//);
  });

  it("refuses a type the surface does not accept", async () => {
    const { statusCode, message } = await failure(
      presign(actor(), { contentType: "video/mp4" }),
    );

    expect(statusCode).toBe(422);
    expect(message).toMatch(/does not accept/i);
  });

  it("refuses a file larger than the surface allows", async () => {
    const { statusCode, message } = await failure(
      presign(actor(), { sizeBytes: 500 * 1024 * 1024 }),
    );

    expect(statusCode).toBe(413);
    expect(message).toMatch(/limit here is/i);
  });

  it("refuses a purpose that does not exist", async () => {
    const { statusCode } = await failure(
      presign(actor(), { purpose: "NOT_A_PURPOSE" }),
    );

    expect(statusCode).toBe(422);
  });

  /**
   * 🔴 Refused **before** the bytes, not after them.
   *
   * `confirm` already catches a HEIC from its own bytes, and that is the check
   * that holds. But it runs once the client has uploaded the whole file — on a
   * phone, a 4 MB photo pushed over mobile data to be told no. A caller who
   * honestly declares `image/heic` can be told now.
   *
   * ⚠️ `kindFromMime` cannot do this: it answers `IMAGE` for `image/heic` and
   * `image/svg+xml` alike, because its job is to **name** a file so a surface
   * can refuse it, not to decide policy.
   */
  describe("🔴 types this platform refuses are refused before the upload", () => {
    it.each([
      ["image/heic", /JPEG or PNG/],
      ["image/heif", /JPEG or PNG/],
      ["image/avif", /JPEG, PNG or WebP/],
      ["image/svg+xml", /scripts/],
    ])("%s never gets a signature", async (contentType, reason) => {
      const { statusCode, message } = await failure(
        presign(actor(), { contentType }),
      );

      expect(statusCode).toBe(400);
      expect(message).toMatch(reason);
    });

    it("🔴 and no intent row is written for one", async () => {
      const who = actor();
      const before = await Upload.countDocuments({ userId: who.userId });

      await failure(presign(who, { contentType: "image/heic" }));

      // A row here would mean an upload the client could still confirm against.
      expect(await Upload.countDocuments({ userId: who.userId })).toBe(before);
    });

    it("⚠️ a real video is not caught by the same net", async () => {
      // HEIC and MP4 share a container; the refusal must not widen to video.
      const intent = await presign(actor(), {
        purpose: UPLOAD_PURPOSE.SHOWCASE_MEDIA,
        contentType: "video/mp4",
        fileName: "clip.mp4",
      });

      expect(intent.uploadId).toBeDefined();
    });
  });
});

describe("🔴 the policy is enforced by S3, not by us", () => {
  /**
   * The signature covers a **policy**, and this is what that buys: the caller
   * holds a valid signature and still cannot send more than the surface allows.
   * A presigned PUT would have had no such limit.
   *
   * ⚠️ The range is built from the **surface ceiling**, not from the size the
   * client declared — `["content-length-range", 1, maxBytes]`. The declared
   * `sizeBytes` only buys a readable 413 at presign time; it is this that stops
   * a caller who lied. So the smallest surface is used here (2 MB), and the
   * payload is a hair over it rather than eleven megabytes of nothing.
   */
  it("refuses bytes past the signed size range", async () => {
    const intent = await createUploadIntent(actor(), {
      purpose: UPLOAD_PURPOSE.TICKER_ICON,
      contentType: "image/png",
      // Declared small — and deliberately a lie about what follows.
      sizeBytes: PNG.length,
      fileName: "icon.png",
    });
    const overTheCap = Buffer.alloc(2 * 1024 * 1024 + 4096, 1);

    const res = await uploadTo(intent, overTheCap, "image/png");

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 120000);

  /**
   * ⚠️ `eq`, not `starts-with`. The client already said what it was sending and
   * that was checked against the surface, so it is pinned — a signature for a
   * PNG cannot carry an SVG.
   *
   * 🔴 What is pinned is the **form field**, not the file part's own header.
   * That field is what S3 stores as the object's `Content-Type` and what the CDN
   * later serves it as, so it is the one that matters. An earlier version of this
   * test only changed the `Blob`'s type and S3 accepted it — correctly, because
   * the signed field beside it still said `image/png`.
   *
   * The bytes are a separate question, and they are settled at confirm.
   */
  it("refuses a content type other than the one signed for", async () => {
    const intent = await presign(actor());

    const res = await uploadTo(intent, PNG, "image/png", {
      "Content-Type": "image/svg+xml",
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("confirming what was actually uploaded", () => {
  it("moves the object out of staging and returns where it lives", async () => {
    const who = actor();
    const intent = await presign(who);
    const uploaded = await uploadTo(intent, PNG, "image/png");
    expect(uploaded.ok).toBe(true);

    const result = await confirmUpload(who, intent.uploadId, {});

    expect(result.storage.provider).toBe("AWS_S3");
    expect(result.storage.key).toMatch(/images\//);
    // Out of staging — that prefix is for things nobody has vouched for yet.
    expect(result.storage.key).not.toMatch(/staging\//);
    expect(result.metadata.kind).toBe("IMAGE");
    expect(result.metadata.contentType).toBe("image/png");
  });

  it("reads the real dimensions off the bytes", async () => {
    const who = actor();
    const intent = await presign(who);
    await uploadTo(intent, PNG, "image/png");

    const result = await confirmUpload(who, intent.uploadId, {});

    // 1x1, which is what those bytes actually are.
    expect(result.metadata.width).toBe(1);
    expect(result.metadata.height).toBe(1);
    expect(result.metadata.sizeBytes).toBe(PNG.length);
  });

  it("puts the file under the entity when it is given one", async () => {
    const who = actor();
    const entityId = oid();
    const intent = await presign(who);
    await uploadTo(intent, PNG, "image/png");

    const result = await confirmUpload(who, intent.uploadId, { entityId });

    expect(result.storage.key).toContain(String(entityId));
  });

  /**
   * 🔴 The one check the caller does not get to write. Everything before this
   * read a `Content-Type` the client chose; this reads the object's own first
   * bytes.
   */
  it("catches a file that lied about what it is", async () => {
    const who = actor();
    // Presigned and uploaded as a PNG — but the bytes are a GIF.
    const intent = await presign(who, { sizeBytes: GIF.length });
    const uploaded = await uploadTo(intent, GIF, "image/png");
    expect(uploaded.ok).toBe(true);

    const result = await confirmUpload(who, intent.uploadId, {});

    // CATEGORY_IMAGE accepts GIF too, so this is not refused — but the stored
    // type and the prefix come from the bytes, not from the claim.
    expect(result.metadata.contentType).toBe("image/gif");
    expect(result.storage.key).toMatch(/gifs\//);
    expect(result.storage.key).not.toMatch(/images\//);
  });

  it("marks the intent consumed", async () => {
    const who = actor();
    const intent = await presign(who);
    await uploadTo(intent, PNG, "image/png");

    await confirmUpload(who, intent.uploadId, {});

    const row = await Upload.findById(intent.uploadId).lean();
    expect(row.consumedAt).toBeInstanceOf(Date);
    expect(row.storage.key).toBeTruthy();
  });
});

describe("🔴 what confirm refuses", () => {
  /**
   * The replay guard. Without it one uploaded object could be attached to two
   * different rows, and the second would hold a file it never paid for.
   */
  it("refuses a second confirm of the same upload", async () => {
    const who = actor();
    const intent = await presign(who);
    await uploadTo(intent, PNG, "image/png");
    await confirmUpload(who, intent.uploadId, {});

    const { statusCode, message } = await failure(
      confirmUpload(who, intent.uploadId, {}),
    );

    expect(statusCode).toBe(409);
    expect(message).toMatch(/already been used/i);
  });

  /**
   * ⚠️ Found by id **and** owner together. A signed permission is not
   * transferable, and an id in a request body is a claim rather than proof.
   */
  it("refuses somebody else's uploadId as if it did not exist", async () => {
    const mine = actor();
    const intent = await presign(mine);
    await uploadTo(intent, PNG, "image/png");

    const { statusCode } = await failure(
      confirmUpload(actor(), intent.uploadId, {}),
    );

    // 404, not 403 — a "not yours" answer about a real id confirms it is real.
    expect(statusCode).toBe(404);
  });

  it("refuses an upload that was never sent", async () => {
    const who = actor();
    const intent = await presign(who);

    const { statusCode, message } = await failure(
      confirmUpload(who, intent.uploadId, {}),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/never uploaded|expired/i);
  });

  it("refuses an uploadId that belongs to nothing", async () => {
    const { statusCode } = await failure(confirmUpload(actor(), oid(), {}));

    expect(statusCode).toBe(404);
  });

  /**
   * ⚠️ Checked against the **purpose**, not against what was declared. A caller
   * who presigned an avatar and uploaded a video is refused here even though
   * both steps looked individually fine.
   */
  it("refuses bytes the surface does not accept, and discards them", async () => {
    const who = actor();
    // USER_AVATAR takes images only.
    const intent = await createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.USER_AVATAR,
      contentType: "image/png",
      sizeBytes: 64,
      fileName: "avatar.png",
    });
    // Bytes that are not any supported image at all.
    const uploaded = await uploadTo(intent, Buffer.alloc(64, 7), "image/png");
    expect(uploaded.ok).toBe(true);

    const { statusCode } = await failure(confirmUpload(who, intent.uploadId, {}));

    expect(statusCode).toBe(400);
    // The intent is left unconsumed — nothing was attached to anything.
    const row = await Upload.findById(intent.uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();
  });
});

/**
 * 🔴 G5 — the switch that used to be a decoration.
 *
 * `Setting.storage.upload.presignEnabled` had a schema entry, a validator, a
 * line in the admin doc and **no reader at all**: the route was live whatever it
 * said. Three sibling fields were in the same state — `presignTtlMinutes`,
 * `intentTtlMinutes`, `signedUrlTtlMinutes` — each converted by
 * `getStorageConfig` into a value nothing consumed.
 *
 * ⚠️ Every test here writes the setting and then reads it back through the real
 * path, so what is proven is the wiring, not the mock.
 */
describe("🔴 presigning can be turned off, and turning it off is survivable", () => {
  const { writeSetting } = require("./setup/testDb");

  afterEach(async () => {
    // Back on for whatever runs next in this file.
    await enablePresign();
  });

  const intentFor = (who) =>
    createUploadIntent(who, {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      contentType: "image/png",
      sizeBytes: 64,
      fileName: "x.png",
    });

  it("refuses with 503 when the admin has it off", async () => {
    await writeSetting({ $set: { "storage.upload.presignEnabled": false } });

    const { statusCode, message } = await failure(intentFor(actor()));

    expect(statusCode).toBe(503);
    // ⚠️ The message has to name the other road. A client told only "off" has
    // nothing to do; multipart still works and is one field away.
    expect(message).toMatch(/multipart/);
    expect(message).toMatch(/Admin → Settings → Storage/);
  });

  /**
   * 🔴 The whole reason `confirm` does not read the flag.
   *
   * An admin turning presigning off while uploads are in flight must not strand
   * them: those bytes are in the bucket and already paid for. Refusing the
   * confirm would leave an object with no row and a vendor with no explanation.
   */
  it("🔴 but an upload already in flight still confirms", async () => {
    const who = actor();
    const intent = await intentFor(who);
    const uploaded = await uploadTo(intent, PNG, "image/png");
    expect(uploaded.ok).toBe(true);

    // The switch goes off *after* the bytes are up and *before* the confirm.
    await writeSetting({ $set: { "storage.upload.presignEnabled": false } });

    const confirmed = await confirmUpload(who, intent.uploadId, {});

    expect(confirmed.storage.key).toBeTruthy();
  });

  /**
   * 🔴 On, but pointing at the wrong provider.
   *
   * This road writes to S3 unconditionally. Left on while the platform is on
   * Cloudinary, the same surface stores some rows on S3 and some on Cloudinary
   * depending on which road the client took, and nothing anywhere says so.
   */
  it("🔴 refuses when the platform is not on S3", async () => {
    await writeSetting({ $set: { "storage.provider": "CLOUDINARY" } });

    const { statusCode, message } = await failure(intentFor(actor()));

    expect(statusCode).toBe(409);
    expect(message).toMatch(/CLOUDINARY/);
    // Both fixes are legitimate, and the reader cannot see which half they are in.
    expect(message).toMatch(/AWS_S3/);
    expect(message).toMatch(/turn presigned upload off/);
  });

  it("⚠️ and the window it reports is the admin's number, not a constant", async () => {
    await writeSetting({ $set: { "storage.upload.presignTtlMinutes": 7 } });

    const intent = await intentFor(actor());

    expect(intent.expiresInSeconds).toBe(7 * 60);
  });

  /**
   * 🔴 And the window it actually **signs** — which is a different line.
   *
   * `presignTtlSeconds` is used twice: once as `Expires` inside
   * `createPresignedPost`, which is what S3 enforces, and once as
   * `expiresInSeconds` in the response, which is what the client is told. The
   * test above only covered the second.
   *
   * ⚠️ Mutation found this: hardcoding `Expires: 15 * 60` back left the whole
   * suite green. The two can drift apart and nothing would notice until a vendor
   * is told they have seven minutes, starts uploading at minute eight against a
   * signature S3 considers fine — or, worse, the other way round: told fifteen,
   * refused at seven, with S3's own XML as the only explanation.
   *
   * The policy is base64 JSON carrying its own `expiration`, so this reads what
   * was signed rather than what was reported.
   */
  it("🔴 the window it SIGNS is that number too, not just the one it reports", async () => {
    await writeSetting({ $set: { "storage.upload.presignTtlMinutes": 7 } });

    const before = Date.now();
    const intent = await intentFor(actor());

    const policy = JSON.parse(
      Buffer.from(intent.fields.Policy, "base64").toString("utf8"),
    );
    const signedFor = new Date(policy.expiration).getTime() - before;

    // 7 minutes, with room for the round trip that created it.
    expect(signedFor).toBeGreaterThan(6.5 * 60 * 1000);
    expect(signedFor).toBeLessThan(7.5 * 60 * 1000);
    // ⚠️ And explicitly not the constant it used to be.
    expect(signedFor).toBeLessThan(15 * 60 * 1000);
  });

  it("⚠️ the intent row outlives that window", async () => {
    await writeSetting({
      $set: {
        "storage.upload.presignTtlMinutes": 5,
        "storage.upload.intentTtlMinutes": 90,
      },
    });

    const before = Date.now();
    const intent = await intentFor(actor());
    const row = await Upload.findById(intent.uploadId).lean();

    const livesFor = row.expiresAt.getTime() - before;
    // Comfortably past the 5-minute signature, near the 90 minutes asked for.
    expect(livesFor).toBeGreaterThan(80 * 60 * 1000);
  });
});
