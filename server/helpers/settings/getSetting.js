const Setting = require("../../models/Setting");

/**
 * The platform's single settings document, read cheaply.
 *
 * ### 🔴 Every read used to be a write
 *
 * This was one `findOneAndUpdate(..., { upsert: true })`. That is a **write**,
 * and fifteen config helpers sit on top of it — voucher checkout, security,
 * subscription, notifications, the showcase. One customer opening a voucher
 * screen wrote to `Setting`. Putting the showcase config on the three public
 * read endpoints (see the plan's SC-4) would have meant a write on every
 * anonymous page view.
 *
 * The upsert survives, but only where it belongs: creating the document when
 * there genuinely is not one.
 *
 * ### ⚠️ Why the cache holds a plain object, and not a document
 *
 * `updateSetting` reads this, mutates it (`Object.assign(setting.vendor.voucher,
 * …)`) and saves. Handing every caller **one shared Mongoose document** would
 * mean a half-built update is visible to readers before it is saved — and still
 * visible after a validation failure, because the cache would hold the mutated
 * object rather than what is in Mongo.
 *
 * So writers take `getSettingDocument()`, which is never cached, and readers get
 * a frozen snapshot they cannot alter by accident.
 *
 * ### ⚠️ And why the snapshot is `toObject()`, never `.lean()`
 *
 * `lean()` skips hydration, and **hydration is what applies schema defaults**.
 * A `Setting` written before a field existed has nothing stored for it, so a
 * lean read returns `undefined` where the schema says `5` — measured, not
 * assumed:
 *
 *     hydrate(raw).toObject()  →  vendor.voucher.maxImages = 5
 *     raw (lean)               →  vendor.voucher.maxImages = undefined
 *
 * Several config helpers guard with `??`, but not all of them, and the ones that
 * do would quietly fall back to a constant instead of reading the admin's value.
 */

/**
 * How long a reader may be behind the admin panel.
 *
 * ⚠️ This is the real consistency boundary, and it is per process — two
 * instances on Render can disagree for up to this long after a settings change.
 * That is acceptable because these are commercial knobs (fee slabs, upload
 * ceilings, limits), not correctness-critical values: nothing reconciles money
 * against a number read thirty seconds ago. A value that ever *does* need to be
 * exact must not be read through this function.
 */
const TTL_MS = 30 * 1000;

let cached = null;
let cachedAt = 0;
/** One in-flight load, so a cold cache under load makes one query, not N. */
let loading = null;

/** Nothing downstream may edit the shared snapshot — including by mistake. */
const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

/**
 * The live document, for the one caller that writes.
 *
 * ⚠️ Deliberately **not** cached and deliberately **not** frozen. `updateSetting`
 * needs a real Mongoose document to `Object.assign` onto and `save()`; anything
 * it mutates must be its own.
 */
const getSettingDocument = async () => {
  const existing = await Setting.findOne();
  if (existing) return existing;

  /**
   * The only write left on this path. `upsert` rather than `create` so two
   * boots racing each other cannot both insert a settings document.
   */
  return Setting.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    // `returnDocument: "after"` rather than `new: true` — the latter is
    // deprecated in Mongoose 9 and logged a warning on every settings read,
    // which used to be every checkout.
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  );
};

/** A frozen snapshot of the settings. Read-only, and at most `TTL_MS` stale. */
const getSetting = async () => {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (loading) return loading;

  loading = (async () => {
    const document = await getSettingDocument();
    cached = deepFreeze(document.toObject());
    cachedAt = Date.now();
    return cached;
  })().finally(() => {
    loading = null;
  });

  return loading;
};

/**
 * Drop the snapshot so the next read goes to Mongo.
 *
 * Called by `updateSetting` **after** the save lands — before it, and a reader
 * arriving in between would cache the old values for another full TTL, which is
 * the one window where a stale read is genuinely surprising rather than merely
 * late.
 */
const invalidateSettingCache = () => {
  cached = null;
  cachedAt = 0;
};

module.exports = { getSetting, getSettingDocument, invalidateSettingCache };
