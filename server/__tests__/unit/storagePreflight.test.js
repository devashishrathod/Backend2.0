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

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.CDN_BASE_URL = "https://cdn.test";
  mockBuckets = {
    PUBLIC: "trydood-nonprod-public",
    PRIVATE: "trydood-nonprod-private",
  };
  respondWith({});
});

describe("🔴 the probe is a real round trip", () => {
  test("it writes, reads and deletes — in both buckets", async () => {
    const result = await checkS3Ready();

    expect(result.ok).toBe(true);
    const commands = mockSend.mock.calls.map((c) => c[0].constructor.name);
    expect(commands).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "DeleteObjectCommand",
      "PutObjectCommand",
      "GetObjectCommand",
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

  test("the test object lands under staging/, where the lifecycle rule sweeps", async () => {
    await checkS3Ready();

    for (const call of mockSend.mock.calls) {
      expect(call[0].input.Key).toMatch(/^dev\/staging\/__preflight_/);
    }
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

describe("CloudFront is a warning, not a refusal", () => {
  test("without it the switch is still allowed", async () => {
    // S3 works without CloudFront — uploads, deletes and delivery all succeed.
    // What is missing is the resize step. Blocking here would stop the very
    // testing that has to happen before CloudFront is worth setting up.
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
