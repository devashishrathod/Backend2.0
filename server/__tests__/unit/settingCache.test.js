const mongoose = require("mongoose");

const Setting = require("../../models/Setting");
const {
  getSetting,
  getSettingDocument,
  invalidateSettingCache,
} = require("../../helpers/settings/getSetting");

/**
 * 🔴 Every settings read used to be a write.
 *
 * `findOneAndUpdate(..., { upsert: true })` is a write however you read it, and
 * fifteen config helpers sit on this — voucher checkout, security, subscription,
 * notifications, the showcase. One customer opening a voucher screen wrote to
 * `Setting`. The plan puts the showcase config on three **public** endpoints,
 * which would have meant a write on every anonymous page view.
 */

/**
 * A stored document, deliberately missing a field the schema defaults.
 *
 * ⚠️ A real `ObjectId`, not the string `"settings"`.
 *
 * 🔴 That string is what hid a live crash for the whole of F-1. An `ObjectId`'s
 * only own property is a `Buffer`, `Object.freeze` on a typed array with
 * elements throws, and `deepFreeze` walked into everything — so `getSetting()`
 * threw for **every real document**, on every request that read a setting. The
 * fixture had no Buffer anywhere in it, so twenty tests passed over the top of
 * it. A stand-in that cannot fail the way the real thing fails is not a
 * stand-in.
 */
const storedRaw = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  vendor: { voucher: { maxOffers: 7 } },
  updatedAt: new Date("2026-09-16T00:00:00.000Z"),
  ...over,
});

/** `findOne()` returns a hydrated document, as Mongoose really would. */
const findOneReturns = (raw) =>
  jest
    .spyOn(Setting, "findOne")
    .mockImplementation(() =>
      Promise.resolve(raw === null ? null : Setting.hydrate(raw)),
    );

beforeEach(() => invalidateSettingCache());
afterEach(() => jest.restoreAllMocks());

describe("🔴 a read is a read", () => {
  test("nothing is upserted when the document is already there", async () => {
    findOneReturns(storedRaw());
    const upsert = jest.spyOn(Setting, "findOneAndUpdate");

    await getSetting();

    expect(upsert).not.toHaveBeenCalled();
  });

  test("the upsert survives only for creating the document", async () => {
    findOneReturns(null);
    const upsert = jest
      .spyOn(Setting, "findOneAndUpdate")
      .mockResolvedValue(Setting.hydrate(storedRaw()));

    await getSetting();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][2]).toMatchObject({ upsert: true });
  });
});

describe("the cache", () => {
  test("a second read inside the window does not touch Mongo", async () => {
    const findOne = findOneReturns(storedRaw());

    await getSetting();
    await getSetting();
    await getSetting();

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  test("⚠️ a burst on a cold cache makes one query, not one each", async () => {
    // Without the in-flight guard, N concurrent callers each miss and each
    // query — which is exactly when the load is highest.
    const findOne = findOneReturns(storedRaw());

    await Promise.all([getSetting(), getSetting(), getSetting(), getSetting()]);

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  test("invalidating sends the next read back to Mongo", async () => {
    const findOne = findOneReturns(storedRaw());

    await getSetting();
    invalidateSettingCache();
    await getSetting();

    expect(findOne).toHaveBeenCalledTimes(2);
  });

  test("the snapshot goes stale after the TTL", async () => {
    const findOne = findOneReturns(storedRaw());
    await getSetting();

    // 31s later — past the 30s window.
    const realNow = Date.now;
    jest.spyOn(Date, "now").mockImplementation(() => realNow() + 31_000);
    await getSetting();

    expect(findOne).toHaveBeenCalledTimes(2);
  });
});

describe("⚠️ what the snapshot is, and is not", () => {
  test("schema defaults are applied — this is why it is not `.lean()`", async () => {
    // A `Setting` written before a field existed stores nothing for it. Lean
    // skips hydration, and hydration is what fills the default in — so a lean
    // read would answer `undefined` where the schema says 5.
    findOneReturns(storedRaw());
    const setting = await getSetting();

    expect(setting.vendor.voucher.maxImages).toBe(5);
    expect(setting.vendor.showcase.maxItemsPerSection).toBe(15);
    // and what really is stored still wins
    expect(setting.vendor.voucher.maxOffers).toBe(7);
  });

  test("readers cannot alter what everyone else is reading", async () => {
    findOneReturns(storedRaw());
    const setting = await getSetting();

    expect(Object.isFrozen(setting)).toBe(true);
    expect(Object.isFrozen(setting.vendor.voucher)).toBe(true);
    expect(() => {
      "use strict";
      setting.vendor.voucher.maxImages = 999;
    }).toThrow();
  });

  /**
   * 🔴 The freeze must not walk into a Buffer.
   *
   * `Object.freeze` on a typed array that has elements throws outright, and an
   * `ObjectId`'s only own property **is** one. So a `deepFreeze` that recursed
   * into everything threw for every real document — every settings read, on
   * every request that took one — while twenty tests over a fixture with a
   * string `_id` reported green.
   *
   * The money suite is what found it, which is the argument for running it.
   */
  test("🔴 an ObjectId, a Date and a Buffer do not break the freeze", async () => {
    findOneReturns(
      storedRaw({ raw: Buffer.from("abc"), ids: [new mongoose.Types.ObjectId()] }),
    );

    const setting = await getSetting();

    expect(Object.isFrozen(setting)).toBe(true);
    // Walked past, not frozen — and nothing mutates a value object in place.
    expect(setting._id).toBeTruthy();
    expect(setting.updatedAt instanceof Date).toBe(true);
  });

  test("it is a plain object, not a live document", async () => {
    // A shared Mongoose document is the trap: `updateSetting` assigns onto what
    // it is given, so handing it the cache would show readers a half-built
    // update — and keep showing it if the save failed validation.
    findOneReturns(storedRaw());
    const setting = await getSetting();

    expect(typeof setting.save).toBe("undefined");
  });
});

describe("writers get their own document", () => {
  test("`getSettingDocument` is never cached", async () => {
    const findOne = findOneReturns(storedRaw());

    await getSettingDocument();
    await getSettingDocument();

    expect(findOne).toHaveBeenCalledTimes(2);
  });

  test("and it is a real, mutable document", async () => {
    findOneReturns(storedRaw());
    const document = await getSettingDocument();

    expect(typeof document.save).toBe("function");
    expect(Object.isFrozen(document)).toBe(false);
  });

  test("🔴 a writer's edits do not leak into the readers' snapshot", async () => {
    findOneReturns(storedRaw());

    const snapshot = await getSetting();
    const document = await getSettingDocument();
    document.vendor.voucher.maxOffers = 99;

    expect(snapshot.vendor.voucher.maxOffers).toBe(7);
  });
});

describe("🔴 the write path drops the snapshot", () => {
  /**
   * The cache is only correct if the writer clears it. Without this the admin
   * changes a limit, gets a 200, and up to thirty seconds of traffic keeps
   * being served the old number — on every instance, from a cache that has no
   * reason to expire early.
   *
   * `updateSetting` is loaded through `jest.isolateModules` with the settings
   * barrel mocked, so this asserts the **wiring** rather than the helper the
   * tests above already cover.
   */
  const runUpdate = async () => {
    const calls = [];
    const save = jest.fn(() => {
      calls.push("save");
      return Promise.resolve();
    });

    let updateSetting;
    jest.isolateModules(() => {
      jest.doMock("../../helpers/settings", () => ({
        ...jest.requireActual("../../helpers/settings"),
        getSettingDocument: () => Promise.resolve({ save }),
        invalidateSettingCache: () => calls.push("invalidate"),
      }));
      ({ updateSetting } = require("../../services/settings/updateSetting"));
    });

    await updateSetting("admin-1", {});
    return calls;
  };

  afterEach(() => jest.resetModules());

  test("the cache is invalidated on a save", async () => {
    expect(await runUpdate()).toContain("invalidate");
  });

  test("⚠️ and after the save, not before", async () => {
    // Before it, a reader arriving in the gap caches the **old** values for
    // another full TTL — worse than not clearing at all, because it is a fresh
    // thirty seconds of staleness rather than the tail of the old window.
    const calls = await runUpdate();
    expect(calls).toEqual(["save", "invalidate"]);
  });
});

describe("🔴 a provider switch is rehearsed before it is saved", () => {
  /**
   * `updateSetting` with the settings barrel and the preflight both mocked, so
   * this asserts the **gate** rather than the probe (which has its own file).
   */
  const runSwitch = async ({ from, to, ok = true, warnings = [] }) => {
    const calls = [];
    const setting = {
      storage: { provider: from },
      save: jest.fn(() => {
        calls.push("save");
        return Promise.resolve();
      }),
    };

    let updateSetting;
    jest.isolateModules(() => {
      jest.doMock("../../helpers/settings", () => ({
        ...jest.requireActual("../../helpers/settings"),
        getSettingDocument: () => Promise.resolve(setting),
        invalidateSettingCache: () => calls.push("invalidate"),
      }));
      jest.doMock("../../services/storage/preflight", () => ({
        PROVIDERS_NEEDING_PREFLIGHT: ["AWS_S3"],
        checkS3Ready: () => {
          calls.push("preflight");
          return Promise.resolve({ ok, reason: "credentials are wrong", warnings });
        },
      }));
      ({ updateSetting } = require("../../services/settings/updateSetting"));
    });

    const result = await updateSetting("admin-1", {
      storage: { provider: to },
    }).catch((error) => error);

    return { calls, result, setting };
  };

  afterEach(() => jest.resetModules());

  test("a failing probe refuses the save with a 422", async () => {
    const { calls, result, setting } = await runSwitch({
      from: "CLOUDINARY",
      to: "AWS_S3",
      ok: false,
    });

    expect(result.statusCode).toBe(422);
    expect(result.message).toMatch(/credentials are wrong/);
    expect(calls).toEqual(["preflight"]);
    expect(setting.save).not.toHaveBeenCalled();
  });

  test("a passing probe lets it through, and the probe runs first", async () => {
    const { calls } = await runSwitch({ from: "CLOUDINARY", to: "AWS_S3" });
    expect(calls).toEqual(["preflight", "save", "invalidate"]);
  });

  test("⚠️ re-saving the same provider does not pay for a round trip", async () => {
    // An unrelated settings edit should not cost an S3 probe, and should not be
    // able to fail because of one.
    const { calls } = await runSwitch({ from: "AWS_S3", to: "AWS_S3" });
    expect(calls).not.toContain("preflight");
  });

  test("switching back to Cloudinary needs no rehearsal", async () => {
    const { calls } = await runSwitch({ from: "AWS_S3", to: "CLOUDINARY" });
    expect(calls).not.toContain("preflight");
  });

  test("a warning rides back on the response rather than being logged away", async () => {
    const { result } = await runSwitch({
      from: "CLOUDINARY",
      to: "AWS_S3",
      warnings: ["CloudFront is not configured"],
    });

    expect(result.warnings).toEqual(["CloudFront is not configured"]);
  });

  test("the shape is the same whether or not there is a warning", async () => {
    // Two shapes would give every caller a branch to get wrong.
    const { result } = await runSwitch({ from: "CLOUDINARY", to: "AWS_S3" });
    expect(result).toHaveProperty("setting");
    expect(result.warnings).toEqual([]);
  });
});
