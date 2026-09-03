const Transaction = require("../../models/Transaction");
const {
  TRANSACTION_INDEXES,
  LEGACY_TRANSACTION_INDEXES,
} = require("../../constants/transaction");

/**
 * Say at boot whether the money indexes are the ones this build expects.
 *
 * ### Why this exists
 *
 * `invoiceId_1` and `razorpayOrderId_1` are the pre-M1 shape: plain unique, not
 * partial. Mongo indexes a missing field as `null`, so a blanket unique index on
 * `invoiceId` rejects the **second** transaction that has no invoice yet — and
 * every voucher claim is created before its invoice exists.
 *
 * The migration drops them by name. What makes this worth a boot check is that
 * they **came back** on the development cluster after being dropped, twice.
 * Bisected against every candidate in this repo — a plain connect with
 * `autoIndex`, the app boot, the migration in both modes, and the test suite —
 * and none of them recreate it. The current schema does not declare them at all.
 *
 * That leaves a writer outside this working copy: most likely an older build of
 * this service still running somewhere and pointed at the same database, whose
 * schema still carries `unique: true` on those paths and whose `autoIndex`
 * rebuilds them on every restart. It could not be identified from here —
 * `currentOp` is not permitted on the M0 tier. Bisected to commit `59fd080`,
 * which declared `invoiceId: { type: String, unique: true }`; `3494bb8` replaced
 * it with the named partial index the schema carries today.
 *
 * ### ⚠️ This reports. `reapShadowIndexes` removes.
 *
 * This helper used to end with: *"nothing is changed automatically: dropping an
 * index at boot is exactly the kind of surprise that should never happen on its
 * own, and a build that is about to be replaced should not be fighting its
 * replacement over indexes."*
 *
 * The reasoning was sound and the outcome was not. With nothing removing what
 * the old build recreates, **the old build wins by default** — and what it wins
 * is a production database that rejects roughly every second voucher claim, with
 * a duplicate-key error naming a field the customer never touched. A warning
 * printed at boot to a console nobody reads is not a defence.
 *
 * So the removal moved to `helpers/transactions/reapShadowIndexes.js`, which
 * runs at boot **and hourly**, drops only an index already superseded by a
 * partial one on the same key, refuses to drop when that replacement is missing,
 * and alerts an admin every time — because a reap means the other writer
 * restarted inside that hour, and that timestamp is the one usable lead for
 * finding it.
 *
 * This stays as the reporting half: it names what is **missing**, which the
 * reaper deliberately never creates.
 *
 * Never throws. A reporting helper must not be able to stop the server.
 */
exports.assertMoneyIndexes = async () => {
  let names;
  try {
    names = (await Transaction.collection.indexes()).map((index) => index.name);
  } catch (error) {
    // A fresh database has no collection yet, which is fine and not worth a line.
    if (!/ns does not exist|NamespaceNotFound/i.test(error?.message || "")) {
      console.error("[idx] could not read transaction indexes:", error?.message);
    }
    return { ok: true, checked: false };
  }

  const missing = Object.values(TRANSACTION_INDEXES).filter(
    (name) => !names.includes(name),
  );
  const legacy = Object.values(LEGACY_TRANSACTION_INDEXES).filter((name) =>
    names.includes(name),
  );

  for (const name of missing) {
    console.warn(
      `⚠️  [idx] ${name} is MISSING — uniqueness is not being enforced. Run scripts/migrateCustomerClaimFoundation.js --apply`,
    );
  }

  for (const name of legacy) {
    console.warn(
      `⚠️  [idx] legacy ${name} is back — a blanket unique index that rejects the second row with no value. ` +
        `Nothing in this build creates it, so another process is writing to this database. ` +
        `reapShadowIndexes drops it at boot and hourly; run scripts/findIndexWriters.js to find what recreated it.`,
    );
  }

  if (!missing.length && !legacy.length) {
    console.log(`✅ [idx] money indexes correct · ${names.length} on transactions`);
  }

  return { ok: !missing.length && !legacy.length, missing, legacy, checked: true };
};
