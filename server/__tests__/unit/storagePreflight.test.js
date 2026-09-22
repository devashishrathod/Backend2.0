/**
 * 🔴 A dropdown that redirects every upload on the platform.
 *
 * `Setting.storage.provider` is one field in the admin panel. Flipping it sends
 * avatars, banners, voucher images and generated invoices somewhere new. If the
 * credentials are wrong, nothing fails at save time — it fails at the next
 * upload, for every user at once, with a stack trace that says nothing about a
 * settings change made an hour ago.
 *
 * An env var at least needed someone with deploy access. A dropdown does not, so
 * the dropdown is rehearsed instead.
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

let mockBuckets = {};
const mockSend = jest.fn();
jest.mock("../../configs/s3", () => ({
  getS3Client: () => ({ send: mockSend }),
  bucketName: (bucket) => mockBuckets[bucket],
  resetS3Client: jest.fn(),
}));

const { checkS3Ready } = require("../../services/storage/preflight");

/** Command name → what the fake bucket does with it. */
const respondWith = (behaviour) => {
  mockSend.mockImplementation((command) => {
    const name = command.constructor.name;
    const outcome = behaviour[name];
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve(outcome ?? {});
  });
};

const awsError = (name, message) => Object.assign(new Error(message), { name });

/**
 * 🔴 The delivery probe, which is the half the SDK cannot answer.
 *
 * Everything above this line is signed. A bucket with Block Public Access on —
 * the AWS default — passes all of it and then answers `403` to every `<img>` on
 * the platform, which is precisely what `trydood-nonprod-public` did when it was
 * measured. So preflight also fetches the object back **with no credentials**,
 * and that is what `fetch` stands in for here.
 */
const mockFetch = jest.fn();
let fetchWas;
beforeAll(() => {
  fetchWas = global.fetch;
  global.fetch = mockFetch;
});
afterAll(() => {
  global.fetch = fetchWas;
});

/** What an anonymous reader gets back. */
const deliveryServes = () =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

const deliveryRefuses = (status = 403, statusText = "Forbidden") =>
  mockFetch.mockResolvedValue({ ok: false, status, statusText });

const deliveryUnreachable = (code = "ENOTFOUND") =>
  mockFetch.mockRejectedValue(
    Object.assign(new Error("fetch failed"), { cause: { code } }),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.CDN_BASE_URL = "https://cdn.test";
  mockBuckets = {
    PUBLIC: "trydood-nonprod-public",
    PRIVATE: "trydood-nonprod-private",
  };
  respondWith({});
  deliveryServes();
});

describe("🔴 the probe is a real round trip", () => {
  test("it writes, reads and deletes — in both buckets", async () => {
    const result = await checkS3Ready();

    expect(result.ok).toBe(true);
    const commands = mockSend.mock.calls.map((c) => c[0].constructor.name);
    expect(commands).toEqual([
      // The public bucket: write, read, delete.
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
      // The private bucket: the same three.
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
      // ⚠️ The delivery probe: write, then fetch it back **unsigned**, then
      // delete. There is no `GetObjectCommand` here on purpose — a signed read
      // is the question already answered above.
      "PutObjectCommand",
      "DeleteObjectCommand",
    ]);
  });

  test("⚠️ and it touches BOTH buckets, not just the public one", async () => {
    // Documents live in the private bucket. A switch that only proved the
    // public one would take invoices down and nothing else.
    await checkS3Ready();

    const buckets = new Set(mockSend.mock.calls.map((c) => c[0].input.Bucket));
    expect([...buckets].sort()).toEqual([
      "trydood-nonprod-private",
      "trydood-nonprod-public",
    ]);
  });

  test("the write probe lands under staging/, where the lifecycle rule sweeps", async () => {
    await checkS3Ready();

    // The first six calls are the two bucket round trips.
    for (const call of mockSend.mock.calls.slice(0, 6)) {
      /**
       * 🔴 `staging/` first, then the tier — the shape the deny and lifecycle
       * rules key on. It read `dev/staging/…` until a live probe showed that
       * prefix answering 200 on the CDN while `staging/` answered 403.
       */
      expect(call[0].input.Key).toMatch(/^staging\/dev\/__preflight_/);
    }
  });

  /**
   * 🔴 And the delivery probe deliberately does **not**.
   *
   * The distribution is meant to deny `staging/*` — that prefix holds objects
   * whose bytes nobody has looked at yet. Probing a staging key would therefore
   * fail on a **correctly** configured CloudFront, which is the worst possible
   * false alarm: it would train whoever sees it to ignore this check.
   */
  test("🔴 but the delivery probe writes where real media lives", async () => {
    await checkS3Ready();

    const key = mockSend.mock.calls[6][0].input.Key;
    expect(key).toMatch(/^dev\/images\/__preflight\//);
    expect(key).not.toMatch(/staging/);
  });

  test("⚠️ and it takes that object back out", async () => {
    await checkS3Ready();

    const [put, remove] = mockSend.mock.calls.slice(6).map((c) => c[0]);
    expect(remove.constructor.name).toBe("DeleteObjectCommand");
    expect(remove.input.Key).toBe(put.input.Key);
  });

  test("every probe uses its own key", async () => {
    await checkS3Ready();
    const first = mockSend.mock.calls[0][0].input.Key;

    jest.clearAllMocks();
    respondWith({});
    await checkS3Ready();

    expect(mockSend.mock.calls[0][0].input.Key).not.toBe(first);
  });
});

describe("🔴 what a failure has to say", () => {
  test("a bad key stops the switch", async () => {
    respondWith({
      PutObjectCommand: awsError("InvalidAccessKeyId", "The key is not valid"),
    });
    const result = await checkS3Ready();

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/InvalidAccessKeyId/);
  });

  test("the message names the bucket and the permissions to check", async () => {
    // The admin reading this cannot see a log, and "wrong key" versus "policy
    // missing" are two very different fixes.
    respondWith({ PutObjectCommand: awsError("AccessDenied", "nope") });
    const { reason } = await checkS3Ready();

    expect(reason).toMatch(/trydood-nonprod-public/);
    expect(reason).toMatch(/PutObject/);
    expect(reason).toMatch(/GetObject/);
    expect(reason).toMatch(/DeleteObject/);
  });

  test("a bucket that writes but cannot read still fails", async () => {
    respondWith({ GetObjectCommand: awsError("AccessDenied", "no read") });
    expect((await checkS3Ready()).ok).toBe(false);
  });

  test("⚠️ and a failed probe still cleans up after itself", async () => {
    // The probe is allowed to fail. It is not allowed to leave litter.
    respondWith({ GetObjectCommand: awsError("AccessDenied", "no read") });
    await checkS3Ready();

    const commands = mockSend.mock.calls.map((c) => c[0].constructor.name);
    expect(commands).toContain("DeleteObjectCommand");
  });

  test("an unconfigured bucket is named, not guessed at", async () => {
    mockBuckets.PRIVATE = undefined;
    const { ok, reason } = await checkS3Ready();

    expect(ok).toBe(false);
    expect(reason).toMatch(/S3_BUCKET_PRIVATE/);
  });
});

describe("CloudFront's absence is a warning; its being broken is not", () => {
  test("without it the switch is still allowed, if the bucket serves", async () => {
    // S3 works without CloudFront — uploads, deletes and delivery all succeed,
    // **provided public read is on**, which is what the fetch below stands for.
    // What is missing is the resize step. Blocking on that alone would stop the
    // very testing that has to happen before CloudFront is worth setting up.
    mockConfig.CDN_BASE_URL = "";
    const result = await checkS3Ready();

    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/CloudFront/);
  });

  test("with it there is nothing to warn about", async () => {
    expect((await checkS3Ready()).warnings).toEqual([]);
  });

  test("a warning is returned even when the probe fails", async () => {
    // Both things are true at once, and the admin needs to fix both.
    mockConfig.CDN_BASE_URL = "";
    respondWith({ PutObjectCommand: awsError("AccessDenied", "nope") });
    const result = await checkS3Ready();

    expect(result.ok).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/CloudFront/);
  });
});

/**
 * 🔴 G4 — the gap this check exists to close.
 *
 * The old version asked one question: *is `CDN_BASE_URL` empty?* So a value that
 * was **set and dead** produced no warning at all — the quietest possible form
 * of the worst outcome. Measured against the real project: `CDN_BASE_URL` was
 * `https://cdn.trydood.com`, that host did not resolve, the bucket answered 403
 * to an unsigned read, and preflight returned `ok: true` with zero warnings.
 */
describe("🔴 uploads working is not the same as anybody being able to read them", () => {
  test("a CDN host that does not resolve stops the switch", async () => {
    deliveryUnreachable("ENOTFOUND");
    const { ok, reason } = await checkS3Ready();

    expect(ok).toBe(false);
    expect(reason).toMatch(/ENOTFOUND/);
    expect(reason).toMatch(/cdn\.test/);
  });

  test("⚠️ and it says so as a refusal, not a warning", async () => {
    // A warning here would be read past. What it describes is every image on the
    // platform breaking the moment the dropdown is saved.
    deliveryUnreachable();
    const { ok, warnings } = await checkS3Ready();

    expect(ok).toBe(false);
    expect(warnings.join(" ")).not.toMatch(/did not serve/);
  });

  test("the message names both ways out", async () => {
    deliveryUnreachable();
    const { reason } = await checkS3Ready();

    // Fix the distribution, or stop using it. Whoever reads this cannot see
    // which half of the migration they are in.
    expect(reason).toMatch(/CloudFront distribution/);
    expect(reason).toMatch(/clear CDN_BASE_URL/);
    expect(reason).toMatch(/trydood-nonprod-public/);
  });

  test("🔴 a closed bucket with no CDN stops it too, and says why", async () => {
    mockConfig.CDN_BASE_URL = "";
    deliveryRefuses(403, "Forbidden");
    const { ok, reason } = await checkS3Ready();

    expect(ok).toBe(false);
    expect(reason).toMatch(/403/);
    expect(reason).toMatch(/public s3:GetObject/);
    // ⚠️ The sentence has to say *why* a signed probe passing proves nothing.
    expect(reason).toMatch(/no credentials/);
  });

  test("the URL fetched is the one the app will store", async () => {
    await checkS3Ready();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/cdn\.test\/dev\/images\/__preflight\//);
  });

  test("⚠️ and without a CDN it is the raw S3 URL, region and all", async () => {
    mockConfig.CDN_BASE_URL = "";
    await checkS3Ready();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(
      /^https:\/\/trydood-nonprod-public\.s3\.ap-south-1\.amazonaws\.com\//,
    );
  });

  /**
   * ⚠️ The private bucket is **not** probed this way. It is supposed to refuse
   * an anonymous reader — documents are served through a presigned GET minted
   * per request — so a 403 there is the system working.
   */
  test("only the public bucket is checked for delivery", async () => {
    await checkS3Ready();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).not.toMatch(/private/);
  });

  test("a fetch that hangs does not hang the switch", async () => {
    // `AbortSignal.timeout` gives up; the answer is still a refusal with a
    // reason, rather than an admin panel that never responds.
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "TimeoutError",
      }),
    );
    const { ok, reason } = await checkS3Ready();

    expect(ok).toBe(false);
    expect(reason).toMatch(/TimeoutError/);
  });
});
