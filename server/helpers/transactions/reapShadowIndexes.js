const mongoose = require("mongoose");

/**
 * Remove a blanket unique index that has been shadowed by a partial one.
 *
 * ### ⚠️ The bug this exists to end
 *
 * Commit `59fd080` declared `invoiceId: { type: String, unique: true }` on
 * `Transaction`. A path-level `unique: true` makes Mongoose create an index
 * named exactly `invoiceId_1` — **not sparse, not partial**. Mongo indexes a
 * missing field as `null`, so a blanket unique on a nullable path rejects the
 * *second* document that has no value yet. Every voucher claim is created
 * before its invoice exists, so in production that is **every second claim
 * rejected**, with a duplicate-key error naming a field the customer never
 * touched.
 *
 * `3494bb8` replaced it with the named partial index this schema still
 * declares. Nothing in this build has created `invoiceId_1` since. It came back
 * on the cluster anyway, twice, after being dropped — because an **older build
 * of this same service** is still running somewhere against the same database,
 * and Mongoose's `autoIndex` rebuilds that path's index on every restart. Old
 * builds connected with no options at all, so they cannot be stopped with
 * `MONGO_AUTO_INDEX=false` either: that option did not exist when they shipped.
 *
 * ### Why this now drops, where `assertMoneyIndexes` only warned
 *
 * That helper's note used to say *"nothing is changed automatically: dropping an
 * index at boot is exactly the kind of surprise that should never happen on its
 * own, and a build that is about to be replaced should not be fighting its
 * replacement over indexes."*
 *
 * The reasoning was sound and the outcome was not: with nothing removing what
 * the old build creates, **the old build wins by default** — and what it wins is
 * a production database that rejects half the claims. A warning printed to a
 * console nobody reads at boot is not a defence.
 *
 * The two things that make dropping safe here are conditions, not confidence:
 *
 *  1. It only ever drops an index that is **shadowed** — a unique index with no
 *     partial filter and no sparse flag, sitting on exactly the same key as a
 *     partial unique index in the same collection. That shape is never correct:
 *     the partial one exists precisely to replace it.
 *  2. If the partial replacement is **absent**, nothing is dropped. Removing the
 *     blanket index then would leave the field with no uniqueness at all, which
 *     is worse than the problem.
 *
 * ### A rule, not a list
 *
 * `LEGACY_TRANSACTION_INDEXES` names two. This finds them by shape instead, so
 * the 28 partial-unique indexes across this database are all covered, and a
 * field added next year is covered the day its index is declared — without
 * anybody remembering to add it here.
 *
 * ### It is also the detector
 *
 * A reap means the shadow index was recreated **since the last sweep**, which
 * means the old writer restarted inside that window. That timestamp is the one
 * usable lead for finding it: correlate it with the deploy and restart history
 * of every service pointed at this cluster. See `scripts/findIndexWriters.js`.
 *
 * Never throws. An index sweep must not be able to stop the server.
 *
 * @param {object} [args]
 * @param {boolean} [args.dryRun] report what would be dropped, change nothing
 * @returns {Promise<{checked: boolean, guarded: number, reaped: Array, blocked: Array}>}
 */
exports.reapShadowIndexes = async ({ dryRun = false } = {}) => {
  const db = mongoose.connection?.db;
  if (!db) return { checked: false, guarded: 0, reaped: [], blocked: [] };

  let collections;
  try {
    collections = await db.listCollections().toArray();
  } catch (error) {
    console.error("[idx] could not list collections:", error?.message);
    return { checked: false, guarded: 0, reaped: [], blocked: [] };
  }

  const reaped = [];
  const blocked = [];
  let guarded = 0;

  for (const { name } of collections) {
    let indexes;
    try {
      indexes = await db.collection(name).indexes();
    } catch {
      // A collection can disappear between the listing and the read. Not a fault.
      continue;
    }

    const partials = indexes.filter((i) => i.unique && i.partialFilterExpression);
    if (!partials.length) continue;
    guarded += partials.length;

    for (const candidate of indexes) {
      if (!isBlanketUnique(candidate)) continue;

      const replacement = partials.find(
        (p) => p.name !== candidate.name && sameKey(p.key, candidate.key),
      );
      // Unshadowed: this is somebody's real index, not a leftover.
      if (!replacement) continue;

      const found = {
        collection: name,
        index: candidate.name,
        key: candidate.key,
        replacedBy: replacement.name,
      };

      if (dryRun) {
        blocked.push({ ...found, reason: "DRY_RUN" });
        continue;
      }

      try {
        await db.collection(name).dropIndex(candidate.name);
        reaped.push(found);
        console.warn(
          `⚠️  [idx] dropped shadow index ${name}.${candidate.name} ` +
            `${JSON.stringify(candidate.key)} — a blanket unique that rejects the ` +
            `second row with no value, replaced by ${replacement.name}. ` +
            `Nothing in this build creates it: another process wrote to this ` +
            `database. See scripts/findIndexWriters.js`,
        );
      } catch (error) {
        /**
         * ⚠️ Already gone is success, not failure.
         *
         * Two instances booting together both find it and both try. The second
         * gets `IndexNotFound`, and treating that as an error would page
         * somebody every deploy for a race that resolved itself correctly.
         */
        if (/IndexNotFound|index not found/i.test(error?.message || "")) continue;
        blocked.push({ ...found, reason: error?.message });
        console.error(
          `🔴 [idx] could not drop shadow index ${name}.${candidate.name}: ${error?.message}`,
        );
      }
    }
  }

  return { checked: true, guarded, reaped, blocked };
};

/**
 * A unique index with nothing narrowing it.
 *
 * ⚠️ `sparse` counts as narrowed even though a sparse unique index still indexes
 * an explicit `null` — it is not the shape this reaps, and somebody chose it
 * deliberately. `_id_` is excluded by name: it is unique by definition, has no
 * partial twin, and is not droppable anyway.
 */
const isBlanketUnique = (index) =>
  Boolean(index.unique) &&
  !index.partialFilterExpression &&
  !index.sparse &&
  index.name !== "_id_";

/**
 * Same key, same order.
 *
 * ⚠️ Compared as JSON rather than by field set, because `{a: 1, b: 1}` and
 * `{b: 1, a: 1}` are different indexes to Mongo and only the identical one is a
 * shadow.
 */
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

exports.isBlanketUnique = isBlanketUnique;
