/**
 * Find blanket unique indexes on fields that are allowed to be missing.
 *
 * ### The failure this catches
 *
 * Mongo indexes an absent field as `null`, so a **plain** unique index on an
 * optional path permits exactly one document without a value and rejects the
 * second with a duplicate-key error naming a field nobody filled in. To every
 * layer above it that reads as a validation error on unrelated input.
 *
 * It has happened here twice. `invoiceId_1` rejected roughly every second
 * voucher claim, because a claim is created before its invoice exists — see
 * `reapShadowIndexes`, which still hunts for that one. And `referralCode_1`
 * meant only one `User` in the whole system could exist without a referral
 * code; every signup path happened to generate one, so it sat there unfired.
 *
 * The correct shape is a **partial** unique index filtered on
 * `{ field: { $type: "…" } }`, which indexes only the rows that carry a value.
 * `sparse: true` also works and is accepted here; partial is preferred because
 * it composes with the other conditions these indexes usually need.
 *
 * ### What it reports
 *
 *   node scripts/verifyNullableUniques.js
 *
 * A finding is a unique index whose keys include at least one schema path that
 * is neither `required` nor defaulted, where the index is neither partial nor
 * sparse. Exits non-zero so it can gate CI.
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");

const MODELS_DIR = path.join(__dirname, "..", "models");

/** Every file in `models/` that actually compiles a model. */
const loadModels = () =>
  fs
    .readdirSync(MODELS_DIR)
    .filter((file) => file.endsWith(".js"))
    .map((file) => require(path.join(MODELS_DIR, file)))
    .filter(
      (exported) =>
        typeof exported?.createIndexes === "function" && exported.modelName,
    )
    .sort((a, b) => a.modelName.localeCompare(b.modelName));

/**
 * Can this path be absent on an insert?
 *
 * `required` covers the declared case. A `default` covers the practical one — a
 * defaulted path is always written, so it is never indexed as null. A
 * conditionally required path (`required: () => …`) counts as optional, because
 * the condition can be false.
 */
const canBeMissing = (schema, pathName) => {
  const type = schema.path(pathName);
  if (!type) return true; // not a declared path at all — nothing guarantees it

  const options = type.options || {};
  if (options.required === true) return false;
  if (options.default !== undefined && options.default !== null) return false;
  // `_id` is always present.
  if (pathName === "_id") return false;
  return true;
};

const run = () => {
  const models = loadModels();
  const findings = [];
  let uniqueCount = 0;

  for (const model of models) {
    for (const [keys, options = {}] of model.schema.indexes()) {
      if (!options.unique) continue;
      uniqueCount += 1;

      const guarded =
        Boolean(options.partialFilterExpression) || options.sparse === true;
      if (guarded) continue;

      const nullable = Object.keys(keys).filter((key) =>
        canBeMissing(model.schema, key),
      );
      if (!nullable.length) continue;

      findings.push({
        model: model.modelName,
        name: options.name || Object.keys(keys).join("_"),
        keys: Object.keys(keys),
        nullable,
      });
    }
  }

  console.log(
    `\nModels loaded: ${models.length}   unique indexes checked: ${uniqueCount}\n`,
  );
  console.log("─".repeat(61));

  if (!findings.length) {
    console.log("  ✅ blanket unique on a nullable path              0");
    console.log("─".repeat(61));
    console.log(
      "\n✅ every unique index either covers required fields or is partial/sparse.\n",
    );
    return 0;
  }

  console.log(`  ❌ blanket unique on a nullable path              ${findings.length}`);
  console.log("─".repeat(61));
  for (const f of findings) {
    console.log(`\n  ${f.model} — "${f.name}"`);
    console.log(`     keys:     ${f.keys.join(", ")}`);
    console.log(`     nullable: ${f.nullable.join(", ")}`);
    console.log(
      `     → only one document may omit ${f.nullable.length > 1 ? "these" : "this"}; the second insert fails with E11000.`,
    );
  }
  console.log(
    "\nFix: make the index partial on { field: { $type: \"…\" } }, or mark the path required.\n",
  );
  return 1;
};

process.exit(run());
