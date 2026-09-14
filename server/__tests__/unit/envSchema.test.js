const { schema, PROFILES } = require("../../configs/env/schema");

/**
 * The environment, proven before anything runs on it.
 *
 * ### Why this matters more than it looks
 *
 * A missing variable used to be invisible until the code path that wanted it
 * ran, which can be weeks — and the failure was rarely an error. `CLOUD_BASE_URL`
 * unset makes `url.startsWith(undefined)` false, so `deleteFile` logs "Skip
 * delete" and returns: **every media delete silently does nothing** while the
 * server answers 200 to everything.
 *
 * ⚠️ Replaces `configs/uploadLimit.js`, which validated one variable in its own
 * module. The schema does the same job strictly better — it rejects `"100MB"`
 * rather than reading it as `100`, and it carries a maximum — and it does it for
 * all eighty variables at the same moment rather than one of them.
 *
 * No database, no network: this is a schema and a handful of objects.
 */

/** The smallest environment that is actually valid. */
const VALID = Object.freeze({
  MONGO_URL: "mongodb+srv://user:pass@cluster.example/Trydood2",
  JWT_SECRET: "jwt-secret",
  OTP_HMAC_SECRET: "otp-secret",
  MERCHANT_ID_SECRET: "ABCDEFGH",
  STORE_ID_SECRET: "ABCDEFGH",
  CLOUD_BASE_URL: "https://res.cloudinary.test",
});

const check = (overrides = {}) =>
  schema.validate({ ...VALID, ...overrides }, { abortEarly: false, convert: true });

const errorFor = (result, key) =>
  result.error?.details.find((d) => d.path[0] === key) ?? null;

describe("the minimum viable environment", () => {
  it("accepts it", () => {
    expect(check().error).toBeUndefined();
  });

  it.each([
    "MONGO_URL",
    "JWT_SECRET",
    "OTP_HMAC_SECRET",
    "MERCHANT_ID_SECRET",
    "STORE_ID_SECRET",
    "CLOUD_BASE_URL",
  ])("refuses to start without %s", (key) => {
    const input = { ...VALID };
    delete input[key];
    expect(errorFor(schema.validate(input, { abortEarly: false }), key)).toBeTruthy();
  });

  /**
   * ⚠️ `CLOUD_BASE_URL` is required for a reason that is not obvious from its
   * name: `deleteFile` compares every URL against it, and an unset value makes
   * that comparison false for everything, so deletes are skipped with a
   * `console.log` and no error at all.
   */
  it("treats an empty secret as missing, not as a value", () => {
    expect(errorFor(check({ JWT_SECRET: "" }), "JWT_SECRET")).toBeTruthy();
  });

  /** Every problem at once — fixing one variable per deploy costs an afternoon. */
  it("reports every problem in one pass", () => {
    const result = schema.validate(
      { ...VALID, MONGO_URL: "not-a-uri", PORT: "abc", TRUST_PROXY: "-1" },
      { abortEarly: false, convert: true },
    );
    const keys = result.error.details.map((d) => d.path[0]);
    expect(keys).toEqual(expect.arrayContaining(["MONGO_URL", "PORT", "TRUST_PROXY"]));
  });
});

describe("CONFIG_PROFILE", () => {
  it("defaults to DEVELOPMENT", () => {
    expect(check().value.CONFIG_PROFILE).toBe(PROFILES.DEVELOPMENT);
  });

  /** Ours, so it shouts — the convention every enum in this repo follows. */
  it.each(["DEVELOPMENT", "STAGING", "PRODUCTION"])("accepts %s", (profile) => {
    expect(check({ CONFIG_PROFILE: profile }).value.CONFIG_PROFILE).toBe(profile);
  });

  it("upper-cases a lower-case spelling rather than refusing it", () => {
    expect(check({ CONFIG_PROFILE: "production" }).value.CONFIG_PROFILE).toBe(
      PROFILES.PRODUCTION,
    );
  });

  it("refuses an invented tier", () => {
    expect(errorFor(check({ CONFIG_PROFILE: "PROD" }), "CONFIG_PROFILE")).toBeTruthy();
  });
});

/**
 * ⚠️ Lower case, and that is not an oversight.
 *
 * `NODE_ENV` belongs to npm and Express, not to us: npm reads `production` to
 * skip devDependencies, and Express compares `app.get("env")` against
 * `"production"` to decide whether to hide error stack traces from clients.
 * `NODE_ENV=PRODUCTION` matches neither — a production server would leak stack
 * traces while looking correctly configured.
 */
describe("NODE_ENV", () => {
  it("stays lower case", () => {
    expect(check({ NODE_ENV: "PRODUCTION" }).value.NODE_ENV).toBe("production");
  });

  it("does not decide the tier", () => {
    const { value } = check({ NODE_ENV: "production" });
    expect(value.CONFIG_PROFILE).toBe(PROFILES.DEVELOPMENT);
  });
});

describe("MAX_UPLOAD_SIZE_MB", () => {
  it("defaults to 100", () => {
    expect(check().value.MAX_UPLOAD_SIZE_MB).toBe(100);
  });

  /**
   * ⚠️ The case that matters. `Number.parseInt("abc")` is `NaN`, and
   * `limits: { fileSize: NaN }` is not a small limit — it is **no limit**,
   * because every comparison against `NaN` is false. One typo would silently
   * undo the whole upload ceiling.
   */
  it.each([
    ["not a number", "abc"],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-5"],
    ["absurdly large", "2049"],
    ["a number with a unit", "100MB"],
  ])("refuses %s", (_label, value) => {
    expect(errorFor(check({ MAX_UPLOAD_SIZE_MB: value }), "MAX_UPLOAD_SIZE_MB")).toBeTruthy();
  });

  it("accepts a plain number as a number", () => {
    expect(check({ MAX_UPLOAD_SIZE_MB: "250" }).value.MAX_UPLOAD_SIZE_MB).toBe(250);
  });
});

describe("types are converted, not left as strings", () => {
  it("makes numbers numbers and booleans booleans", () => {
    const { value } = check({
      PORT: "3000",
      TRUST_PROXY: "0",
      ENABLE_JOBS: "false",
      ENABLE_NGROK: "true",
    });

    expect(value.PORT).toBe(3000);
    // ⚠️ `0` is a real answer here — a bare EC2 box with nothing in front of it.
    // Trusting a hop that is not there means believing an `X-Forwarded-For` the
    // caller wrote, which walks straight past the rate limiter.
    expect(value.TRUST_PROXY).toBe(0);
    expect(value.ENABLE_JOBS).toBe(false);
    expect(value.ENABLE_NGROK).toBe(true);
  });
});

/**
 * The process environment carries `PATH`, `HOME`, npm's own variables and
 * whatever the platform injects. Failing on those would mean this schema could
 * never run anywhere real.
 */
describe("unknown keys", () => {
  it("passes them through without complaint", () => {
    const result = check({ PATH: "/usr/bin", SOME_PLATFORM_THING: "x" });
    expect(result.error).toBeUndefined();
    expect(result.value.SOME_PLATFORM_THING).toBe("x");
  });
});
