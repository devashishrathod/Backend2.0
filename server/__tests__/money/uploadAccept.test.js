/**
 * U-1 — the door every surface knocks on.
 *
 * ### 🔴 Why a real bucket
 *
 * The facade's whole job is that both roads come out looking the same. Proving
 * that means walking one of them for real: presign, upload, confirm, translate —
 * and then checking the result against what the multipart road has always
 * produced, because `toMediaDocument` is what reads it and it reads `mimeType`
 * and `size`, not `contentType` and `sizeBytes`.
 *
 * The purpose check is the other half, and it is a question about a stored
 * intent row that a mock would simply be told the answer to.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const {
  createUploadIntent,
  acceptUpload,
  acceptUploads,
} = require("../../services/storage");
const { toMediaDocument } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

const oid = () => new mongoose.Types.ObjectId();
const actor = (userId = oid()) => ({ userId });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** POST the bytes the way a browser would: signed fields first, file last. */
const uploadTo = async ({ url, fields }, body) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([body], { type: "image/png" }), "probe");
  return fetch(url, { method: "POST", body: form });
};

/** Presign and actually send the bytes, so the id is ready to be accepted. */
const readyUpload = async (who, purpose = UPLOAD_PURPOSE.CATEGORY_IMAGE) => {
  const intent = await createUploadIntent(who, {
    purpose,
    contentType: "image/png",
    sizeBytes: PNG.length,
    fileName: "probe.png",
  });
  const sent = await uploadTo(intent, PNG);
  expect(sent.ok).toBe(true);
  return intent.uploadId;
};

const failure = async (promise) => {
  try {
    await promise;
    throw new Error("expected this to throw, and it did not");
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
};

beforeAll(async () => {
  await connectTestDb();
  await Upload.createIndexes();
});

afterAll(async () => {
  await clearCollections(Upload);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Upload);
});

describe("🔴 both roads come out the same shape", () => {
  /**
   * The reason this file exists. `confirmUpload` answers with `contentType` and
   * `sizeBytes`; `toMediaDocument` reads `mimeType` and `size`. Without the
   * translation a surface would store a media row with a null mime and a zero
   * size, and nothing would error.
   */
  it("gives toMediaDocument what it actually reads", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    expect(accepted.metadata.mimeType).toBe("image/png");
    expect(accepted.metadata.size).toBe(PNG.length);
    expect(accepted.metadata.width).toBe(1);
    expect(accepted.metadata.height).toBe(1);
  });

  it("produces a media document a model would accept", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    const media = toMediaDocument(
      await acceptUpload(who, {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // The shape every surface stores, reached from the presigned road.
    expect(media.kind).toBe("IMAGE");
    expect(media.mimeType).toBe("image/png");
    expect(media.sizeBytes).toBe(PNG.length);
    expect(media.storage.provider).toBe("AWS_S3");
    expect(media.url).toMatch(/^https?:\/\//);
  });

  it("carries a usable public URL", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    // `confirmUpload` returns no URL at all — the facade builds it.
    expect(accepted.url).toContain(accepted.storage.key);
  });
});

describe("🔴 E1 — one road at a time", () => {
  /**
   * Picking one silently means the caller believes they sent the other. A panel
   * that presigned a new logo and also attached the old file would see whichever
   * the code happened to prefer, with no way to tell which.
   */
  it("refuses a file and an uploadId together", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    const { statusCode, message } = await failure(
      acceptUpload(who, {
        file: { tempFilePath: "/tmp/x.png", mimetype: "image/png" },
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    expect(statusCode).toBe(422);
    expect(message).toMatch(/not both/i);
  });

  it("leaves the upload unconsumed when it refuses", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    await failure(
      acceptUpload(who, {
        file: { tempFilePath: "/tmp/x.png", mimetype: "image/png" },
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // Still theirs to use once they decide which they meant.
    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();
  });
});

describe("🔴 E2 — the upload belongs to one surface", () => {
  /**
   * A caller who presigned a category image and sent that id to the brand logo
   * endpoint is refused — and the refusal lands **before** confirm, so their
   * upload survives it.
   */
  it("refuses an upload authorised for a different purpose", async () => {
    const who = actor();
    const uploadId = await readyUpload(who, UPLOAD_PURPOSE.CATEGORY_IMAGE);

    const { statusCode, message } = await failure(
      acceptUpload(who, { uploadId, purpose: UPLOAD_PURPOSE.BRAND_LOGO }),
    );

    expect(statusCode).toBe(422);
    expect(message).toContain("CATEGORY_IMAGE");
    expect(message).toContain("BRAND_LOGO");
  });

  /**
   * ⚠️ The part that makes the refusal kind rather than expensive. Checking
   * after confirm would burn the upload: consumed, object already moved, and a
   * one-word mistake would cost the whole file again.
   */
  it("does not burn the upload on a mismatch", async () => {
    const who = actor();
    const uploadId = await readyUpload(who, UPLOAD_PURPOSE.CATEGORY_IMAGE);

    await failure(
      acceptUpload(who, { uploadId, purpose: UPLOAD_PURPOSE.BRAND_LOGO }),
    );

    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();

    // And it still works on the surface it was meant for.
    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });
    expect(accepted.storage.key).toBeTruthy();
  });

  it("refuses somebody else's uploadId as if it did not exist", async () => {
    const mine = actor();
    const uploadId = await readyUpload(mine);

    const { statusCode } = await failure(
      acceptUpload(actor(), {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // 404, not 403 — a "not yours" answer about a real id confirms it is real.
    expect(statusCode).toBe(404);
  });

  /**
   * 🔴 A stranger's id with the **wrong** purpose, which is the case the
   * ownership lookup really exists for.
   *
   * ⚠️ Found by mutation: dropping `userId` from this file's lookup left every
   * other test passing, because they all use a matching purpose and fall
   * through to `confirmUpload`, whose own owner check answers the same 404.
   * This one does not fall through — the purpose check would run first and
   * answer **422**, naming the surface the upload was authorised for. A prober
   * would learn two things: the id is real, and what it was for.
   */
  it("does not leak what a stranger's upload was for", async () => {
    const mine = actor();
    const uploadId = await readyUpload(mine, UPLOAD_PURPOSE.CATEGORY_IMAGE);

    const { statusCode, message } = await failure(
      acceptUpload(actor(), {
        uploadId,
        // Deliberately the wrong surface, so a leaky lookup would answer 422.
        purpose: UPLOAD_PURPOSE.BRAND_LOGO,
      }),
    );

    expect(statusCode).toBe(404);
    expect(message).not.toContain("CATEGORY_IMAGE");
  });
});

describe("when nothing arrives", () => {
  it("answers null for an optional file", async () => {
    const accepted = await acceptUpload(actor(), {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    // Most surfaces have an optional image; this is not an error.
    expect(accepted).toBeNull();
  });

  it("refuses when the surface says the file is required", async () => {
    const { statusCode, message } = await failure(
      acceptUpload(actor(), {
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        required: true,
        label: "A category image",
      }),
    );

    expect(statusCode).toBe(422);
    expect(message).toBe("A category image is required.");
  });

  it("refuses a purpose this platform does not have", async () => {
    const { statusCode } = await failure(
      acceptUpload(actor(), { uploadId: oid(), purpose: "NOT_A_PURPOSE" }),
    );

    // 500 — a surface naming a purpose that does not exist is our bug, not the
    // caller's, and saying 422 would send them looking at their own request.
    expect(statusCode).toBe(500);
  });
});

describe("a list of files", () => {
  it("accepts several presigned uploads", async () => {
    const who = actor();
    const first = await readyUpload(who);
    const second = await readyUpload(who);

    const accepted = await acceptUploads(who, {
      uploadIds: [first, second],
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    expect(accepted).toHaveLength(2);
    expect(accepted[0].storage.key).not.toBe(accepted[1].storage.key);
  });

  it("answers an empty list rather than null when nothing was sent", async () => {
    const accepted = await acceptUploads(actor(), {
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    // A caller that maps over the result should not have to null-check first.
    expect(accepted).toEqual([]);
  });

  it("takes a single id as well as an array", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    const accepted = await acceptUploads(who, {
      uploadIds: uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    expect(accepted).toHaveLength(1);
  });

  /**
   * ⚠️ One bad id refuses the whole call rather than quietly returning the rest.
   * A gallery that silently saved three of four images would look like it
   * worked.
   */
  it("refuses the whole list when one id is wrong", async () => {
    const who = actor();
    const good = await readyUpload(who);

    const { statusCode } = await failure(
      acceptUploads(who, {
        uploadIds: [good, oid()],
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    expect(statusCode).toBe(404);
  });
});
