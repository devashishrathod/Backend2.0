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
  enablePresign,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Upload = require("../../models/Upload");
const {
  createUploadIntent,
  acceptUpload,
  acceptUploads,
  confirmUpload,
  deleteAssets,
} = require("../../services/storage");
const { toMediaDocument } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { localFile, cleanup: cleanupFixtures } = require("../support/localFile");

afterAll(cleanupFixtures);

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

/**
 * The whole client sequence the panel docs prescribe: presign, send the bytes,
 * and call `POST /uploads/confirm` **before** handing the id to a surface.
 */
const clientConfirmedUpload = async (
  who,
  purpose = UPLOAD_PURPOSE.CATEGORY_IMAGE,
) => {
  const uploadId = await readyUpload(who, purpose);
  // ⚠️ No `entityId`: on a create the row this file belongs to does not exist
  // yet, which is exactly the position a client is in.
  const confirmed = await confirmUpload(who, uploadId, {});
  return { uploadId, confirmed };
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

/**
 * Run something that must be refused, and hand back the refusal.
 *
 * ⚠️ No `try`/`catch`. The obvious version puts the "it did not throw" error
 * **inside** the try, where its own catch swallows it — and the test then fails
 * on `expected 422, received undefined` instead of saying what actually
 * happened.
 */
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
 * ⚠️ These tests write to the **real** bucket, so they have to take it back out.
 *
 * Without this, every run leaves behind one object per upload — forever. Nothing
 * ever collects them: the `staging/` lifecycle rule only reaches uploads that
 * were never confirmed, and a confirmed object has moved out of that prefix by
 * definition. `scripts/auditOrphans.js` would eventually list them, as a growing
 * list of things a human has to decide about.
 *
 * Collected **before** each clear rather than as the tests go, so a test that
 * fails halfway still has its objects picked up.
 */
const littered = [];
const rememberObjects = async () => {
  const rows = await Upload.find({ "storage.key": { $exists: true } })
    .select("storage")
    .lean();
  rows.forEach((row) => littered.push(row.storage));
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
  await rememberObjects();
  await deleteAssets(littered.map((ref) => ({ storage: ref, url: null })));
  await clearCollections(Upload);
  await disconnectTestDb();
}, 120000);

beforeEach(async () => {
  await rememberObjects();
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
        file: localFile("png", { name: "x.png" }),
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
        file: localFile("png", { name: "x.png" }),
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // Still theirs to use once they decide which they meant.
    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt ?? null).toBeNull();
    expect(row.attachedAt ?? null).toBeNull();
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
    expect(row.attachedAt ?? null).toBeNull();

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

/**
 * 🔴 The sequence every panel doc prescribes — and which nothing here walked.
 *
 * `POST /uploads/confirm` is a live endpoint, and the vendor doc (#94/#95), the
 * customer doc and `endpoints_category.md` all say the same thing: confirm, then
 * send the `uploadId` to the surface. Every test in this file went presign → S3
 * → `acceptUpload`, so the documented road had **no coverage at all** — and it
 * did not work. `fromIntent` confirmed a second time, hit the replay guard, and
 * answered *"That upload has already been used."* about a file uploaded once.
 *
 * ⚠️ It was not a voucher bug. All eleven presigned surfaces go through this
 * facade, so avatars, logos, showcase media and category images were the same;
 * voucher create was only the one that wrapped the 409 into a 500.
 */
describe("🔴 the client may confirm before the surface ever sees the id", () => {
  it("takes an upload the client already confirmed", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    expect(accepted.storage.key).toBeTruthy();
    expect(accepted.metadata.mimeType).toBe("image/png");
    expect(accepted.metadata.size).toBe(PNG.length);
  });

  /**
   * The promise the facade makes is that a surface cannot tell which road a file
   * came down. A third road that answers a slightly different shape would be the
   * same class of defect the facade exists to prevent.
   */
  it("answers what the surface-confirmed road answers, field for field", async () => {
    const who = actor();
    const { uploadId: early } = await clientConfirmedUpload(who);
    const late = await readyUpload(who);

    const [fromEarly, fromLate] = [
      await acceptUpload(who, {
        uploadId: early,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
      await acceptUpload(who, {
        uploadId: late,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    ];

    // Everything but the object key, which is a uuid either way.
    expect(fromEarly.metadata).toEqual(fromLate.metadata);
    expect(fromEarly.purpose).toBe(fromLate.purpose);
    expect(fromEarly.storage.provider).toBe(fromLate.storage.provider);
    expect(fromEarly.storage.bucket).toBe(fromLate.storage.bucket);
    expect(toMediaDocument(fromEarly).kind).toBe(toMediaDocument(fromLate).kind);
  });

  /**
   * ⚠️ Nothing is copied twice. Confirm moved the object and deleted what it
   * copied from, so a second move is not merely wasteful — there is nothing left
   * in `staging/` to move.
   */
  it("keeps the key confirm already gave it", async () => {
    const who = actor();
    const { uploadId, confirmed } = await clientConfirmedUpload(who);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    expect(accepted.storage.key).toBe(confirmed.storage.key);
  });

  it("builds a public URL on this road too", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    expect(accepted.url).toContain(accepted.storage.key);
    expect(toMediaDocument(accepted).url).toMatch(/^https?:\/\//);
  });

  /**
   * 🔴 Every surface, not just the one that reported it.
   *
   * The failure was in the shared facade, so proving one purpose proves the
   * mechanism and nothing else. A vendor whose logo upload broke would not be
   * comforted that voucher images were tested.
   */
  it.each([
    UPLOAD_PURPOSE.BRAND_LOGO,
    UPLOAD_PURPOSE.BRAND_COVER,
    UPLOAD_PURPOSE.SUB_BRAND_LOGO,
    UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
    UPLOAD_PURPOSE.CATEGORY_IMAGE,
    UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
    UPLOAD_PURPOSE.USER_AVATAR,
    UPLOAD_PURPOSE.SHOWCASE_MEDIA,
    UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
    UPLOAD_PURPOSE.BANNER_MEDIA,
    UPLOAD_PURPOSE.BANNER_POSTER,
    UPLOAD_PURPOSE.VOUCHER_IMAGE,
    UPLOAD_PURPOSE.VOUCHER_BANNER,
    UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER,
    UPLOAD_PURPOSE.TICKER_ICON,
  ])("works for %s", async (purpose) => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who, purpose);

    const accepted = await acceptUpload(who, {
      uploadId,
      purpose,
      entityId: oid(),
    });

    expect(accepted.storage.key).toBeTruthy();
    expect(accepted.metadata.mimeType).toBe("image/png");
  });

  it("still refuses a stranger's confirmed upload as if it did not exist", async () => {
    const mine = actor();
    const { uploadId } = await clientConfirmedUpload(mine);

    const { statusCode } = await failure(
      acceptUpload(actor(), {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    // Confirming it early does not make it transferable.
    expect(statusCode).toBe(404);
  });

  /**
   * ⚠️ E2 survives the new road. The purpose check runs before the claim, so a
   * one-word mistake still costs nothing — the upload is refused and remains
   * spendable on the surface it was authorised for.
   */
  it("refuses a confirmed upload on the wrong surface without burning it", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(
      who,
      UPLOAD_PURPOSE.CATEGORY_IMAGE,
    );

    const { statusCode } = await failure(
      acceptUpload(who, { uploadId, purpose: UPLOAD_PURPOSE.BRAND_LOGO }),
    );
    expect(statusCode).toBe(422);

    const row = await Upload.findById(uploadId).lean();
    expect(row.attachedAt ?? null).toBeNull();

    // And the surface it was meant for still takes it.
    const accepted = await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });
    expect(accepted.storage.key).toBeTruthy();
  });
});

/**
 * 🔴 One upload, one row — whoever confirmed it.
 *
 * The guard that used to sit on `consumedAt` protected the right thing for the
 * wrong reason: what must never happen twice is a file being **attached** to a
 * row, not a file being identified. Now that the client may confirm first, the
 * two are separate moments and the guard has to be on the second one — or one
 * uploaded object could be handed to two rows, the second holding a file nobody
 * paid for.
 */
describe("🔴 one upload, one row", () => {
  it("refuses a client-confirmed upload the second time a surface asks", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: oid(),
    });

    const { statusCode, message } = await failure(
      acceptUpload(who, {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
    );

    expect(statusCode).toBe(409);
    expect(message).toMatch(/already been used/i);
  });

  it("refuses a surface-confirmed upload the second time too", async () => {
    const who = actor();
    const uploadId = await readyUpload(who);

    await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    const { statusCode } = await failure(
      acceptUpload(who, {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      }),
    );

    expect(statusCode).toBe(409);
  });

  /**
   * 🔴 The claim is a conditional update, not a read-then-write.
   *
   * Two saves landing together would both read `attachedAt: null` and both
   * proceed, which is precisely the case a guard exists for — and the one a
   * sequential test can never see.
   */
  it("lets exactly one of two saves racing for the same id have it", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    const results = await Promise.allSettled([
      acceptUpload(who, {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
      acceptUpload(who, {
        uploadId,
        purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
        entityId: oid(),
      }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.statusCode).toBe(409);
  });

  /**
   * ⚠️ Confirming is not attaching, and the row has to say so — otherwise the
   * whole fix collapses back into the bug it replaced.
   */
  it("does not attach an upload the client merely confirmed", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    const row = await Upload.findById(uploadId).lean();
    expect(row.consumedAt).toBeTruthy();
    expect(row.attachedAt ?? null).toBeNull();
  });

  it("marks it attached once a surface has taken it", async () => {
    const who = actor();
    const { uploadId } = await clientConfirmedUpload(who);

    await acceptUpload(who, {
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    });

    const row = await Upload.findById(uploadId).lean();
    expect(row.attachedAt).toBeTruthy();
  });
});
