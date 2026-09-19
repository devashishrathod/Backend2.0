const Setting = require("../../models/Setting");
const { invalidateSettingCache } = require("../../helpers/settings/getSetting");
const {
  getStorageConfig,
  effectiveLimitMB,
} = require("../../helpers/settings/getStorageConfig");
const {
  assertStorageLimitRule,
  STORAGE_LIMIT_RULES,
} = require("../../helpers/settings/assertStorageLimitRule");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * The platform's storage rules, and the one question they have to settle:
 * when a surface and the platform both name a limit, which of them wins.
 *
 * Answer: the smaller, always — and a surface asking for more is refused at the
 * write rather than silently losing at the read.
 */

const MB = 1024 * 1024;

const settingIs = (raw) =>
  jest
    .spyOn(Setting, "findOne")
    .mockImplementation(() => Promise.resolve(Setting.hydrate(raw)));

beforeEach(() => invalidateSettingCache());
afterEach(() => {
  jest.restoreAllMocks();
  invalidateSettingCache();
});

describe("the config a caller actually wants", () => {
  test("limits come back per kind, in bytes", async () => {
    settingIs({ _id: "s" });
    const config = await getStorageConfig();

    expect(config.maxBytes).toEqual({
      [MEDIA_KIND.IMAGE]: 10 * MB,
      [MEDIA_KIND.GIF]: 15 * MB,
      [MEDIA_KIND.VIDEO]: 50 * MB,
      [MEDIA_KIND.DOCUMENT]: 20 * MB,
      [MEDIA_KIND.AUDIO]: 20 * MB,
    });
  });

  test("⚠️ GIF has its own ceiling, higher than an image's", async () => {
    // An animated GIF is every frame at once. Holding it to the image limit
    // rejects files that are ordinary for their type.
    settingIs({ _id: "s" });
    const config = await getStorageConfig();

    expect(config.maxBytes[MEDIA_KIND.GIF]).toBeGreaterThan(
      config.maxBytes[MEDIA_KIND.IMAGE],
    );
  });

  test("GIF also has its own mime list, separate from images", async () => {
    // So a surface can say "images yes, GIFs no" without re-deciding here what
    // a GIF is.
    settingIs({ _id: "s" });
    const config = await getStorageConfig();

    expect(config.allowedTypes[MEDIA_KIND.GIF]).toEqual(["image/gif"]);
    expect(config.allowedTypes[MEDIA_KIND.IMAGE]).not.toContain("image/gif");
  });

  test("TTLs arrive in the unit their caller uses", async () => {
    settingIs({ _id: "s" });
    const config = await getStorageConfig();

    expect(config.presignTtlSeconds).toBe(15 * 60);
    expect(config.intentTtlMs).toBe(60 * 60 * 1000);
    expect(config.signedUrlTtlSeconds).toBe(5 * 60);
  });

  test("what the admin stored wins over the default", async () => {
    settingIs({
      _id: "s",
      storage: { limits: { maxVideoSizeMB: 200 }, upload: { presignTtlMinutes: 5 } },
    });
    const config = await getStorageConfig();

    expect(config.maxBytes[MEDIA_KIND.VIDEO]).toBe(200 * MB);
    expect(config.presignTtlSeconds).toBe(5 * 60);
    // untouched fields keep their defaults
    expect(config.maxBytes[MEDIA_KIND.IMAGE]).toBe(10 * MB);
  });

  test("`presignEnabled` reads back exactly what was stored", async () => {
    // ⚠️ This does **not** prove `??` over `||`: the default is `false`, so the
    // two agree on every input. It proves the switch is readable in both
    // positions, which is what a kill switch has to be. The `??` habit earns
    // its keep the day somebody flips that default to `true`.
    settingIs({ _id: "s", storage: { upload: { presignEnabled: false } } });
    expect((await getStorageConfig()).presignEnabled).toBe(false);

    invalidateSettingCache();
    jest.restoreAllMocks();
    settingIs({ _id: "s", storage: { upload: { presignEnabled: true } } });
    expect((await getStorageConfig()).presignEnabled).toBe(true);
  });

  test("provider defaults to Cloudinary until an admin says otherwise", async () => {
    settingIs({ _id: "s" });
    expect((await getStorageConfig()).provider).toBe(STORAGE_PROVIDER.CLOUDINARY);
  });
});

describe("global is a ceiling, a surface may only narrow it", () => {
  test.each([
    [10, 8, 8, "surface asks for less"],
    [10, 80, 10, "surface asks for more — the ceiling still wins"],
    [10, undefined, 10, "surface says nothing"],
    [undefined, 8, 8, "the platform says nothing"],
  ])("%i vs %s -> %i (%s)", (global, surface, expected) => {
    expect(effectiveLimitMB(global, surface)).toBe(expected);
  });
});

describe("🔴 and a surface above the ceiling is refused on save", () => {
  const withLimits = (globalMB, showcaseMB) => ({
    storage: { limits: { maxVideoSizeMB: globalMB } },
    vendor: { showcase: { maxVideoSizeMB: showcaseMB } },
  });

  test("the save is refused, with both numbers in the message", () => {
    // `effectiveLimitMB` would keep the platform safe either way. This keeps
    // the panel honest: without it the admin types 80, gets a 200, sees 80
    // rendered back, and every upload over 50 is still refused with nothing
    // anywhere saying why.
    expect(() => assertStorageLimitRule(withLimits(50, 80))).toThrow(/80 MB/);
    expect(() => assertStorageLimitRule(withLimits(50, 80))).toThrow(/50 MB/);
  });

  test("equal is fine, and so is less", () => {
    expect(() => assertStorageLimitRule(withLimits(50, 50))).not.toThrow();
    expect(() => assertStorageLimitRule(withLimits(50, 20))).not.toThrow();
  });

  test("⚠️ lowering the global below a stored surface is caught too", () => {
    // The two can arrive in separate requests, which is why the check runs on
    // the merged document rather than on the payload.
    expect(() => assertStorageLimitRule(withLimits(20, 50))).toThrow(/cannot be more than/);
  });

  test("a half-filled document does not throw", () => {
    expect(() => assertStorageLimitRule({})).not.toThrow();
    expect(() => assertStorageLimitRule({ storage: {} })).not.toThrow();
    expect(() => assertStorageLimitRule(withLimits(undefined, 80))).not.toThrow();
    expect(() => assertStorageLimitRule(withLimits(50, undefined))).not.toThrow();
  });

  /**
   * 🔴 Every showcase ceiling the **read path** narrows must also be guarded on
   * **save**, and the two lists drifted: `getShowcaseConfig` returns a GIF
   * ceiling and `validateMediaFiles` meters GIFs against it, while the rules
   * covered only images and videos.
   *
   * The read path taking the smaller one keeps the platform safe whatever is
   * stored. The rule keeps the panel honest. A ceiling with only the first is a
   * number an admin can type, see saved, and watch do nothing.
   */
  test("🔴 every showcase size ceiling has a save-time rule", () => {
    const guarded = new Set(
      STORAGE_LIMIT_RULES.filter((rule) => rule.surfacePath[1] === "showcase")
        .map((rule) => rule.surfacePath[2]),
    );

    expect([...guarded].sort()).toEqual([
      "maxGifSizeMB",
      "maxImageSizeMB",
      "maxVideoSizeMB",
    ]);
  });

  test("every rule points at a field the schema really has", () => {
    // A rule naming a path that does not exist reads as "always fine" and
    // guards nothing — the same silent-200 failure the other settings lists
    // are tested against.
    const setting = Setting.hydrate({ _id: "s" }).toObject();
    const read = (src, path) =>
      path.reduce((v, k) => (v == null ? v : v[k]), src);

    for (const rule of STORAGE_LIMIT_RULES) {
      expect(read(setting, rule.surfacePath)).toEqual(expect.any(Number));
      expect(setting.storage.limits[rule.globalKey]).toEqual(expect.any(Number));
    }
  });
});

/**
 * 🔴 G5 — the two upload windows, and the one that has to be longer.
 *
 * `presignTtlMinutes` is how long a client may **start** an upload;
 * `intentTtlMinutes` is how long the `Upload` row lives, and that row is what
 * `confirm` loads to find out whose upload this is. The row is removed by a TTL
 * index, which does not ask whether a signature is still valid.
 *
 * Both fields validate independently (1–60 and 1–1440), so neither validator can
 * see this: it is only wrong **in relation to the other**. Until G5 nothing read
 * either of them, so it could not go wrong — and the moment they became live it
 * could.
 */
describe("🔴 the upload record has to outlive the permission", () => {
  const ttls = (presignTtlMinutes, intentTtlMinutes) => ({
    storage: { upload: { presignTtlMinutes, intentTtlMinutes } },
  });

  test("an intent shorter than the signature is refused", () => {
    // A vendor on a slow connection finishes at minute eight, S3 takes every
    // byte because the signature is good for an hour, and confirm answers
    // "That upload was not found" — about a row a TTL index deleted.
    expect(() => assertStorageLimitRule(ttls(60, 5))).toThrow(
      /intentTtlMinutes \(5\) cannot be less than/,
    );
  });

  test("the message names both numbers and says why", () => {
    expect(() => assertStorageLimitRule(ttls(30, 10))).toThrow(/30/);
    expect(() => assertStorageLimitRule(ttls(30, 10))).toThrow(
      /outlive the permission/,
    );
  });

  test("equal is allowed, and longer is the normal case", () => {
    expect(() => assertStorageLimitRule(ttls(15, 15))).not.toThrow();
    expect(() => assertStorageLimitRule(ttls(15, 60))).not.toThrow();
  });

  test("⚠️ a partial setting is left alone rather than guessed at", () => {
    // `updateSetting` merges onto the stored document; a payload that names
    // neither field must not be compared against a default nobody chose.
    expect(() => assertStorageLimitRule(ttls(undefined, 5))).not.toThrow();
    expect(() => assertStorageLimitRule(ttls(60, undefined))).not.toThrow();
    expect(() => assertStorageLimitRule({})).not.toThrow();
  });
});
