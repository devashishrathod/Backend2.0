/**
 * Prove that every declared relationship in the schemas can actually be followed.
 *
 *   node scripts/verifySchemaRelationships.js          # full report
 *   node scripts/verifySchemaRelationships.js --json
 *
 * Exits **1** on anything that would break at runtime.
 *
 * ### Why this is a code check and not a data check
 *
 * The databases here are development data and production starts empty, so
 * counting orphaned rows says nothing about what production will do. What
 * carries forward is the **schema**: if a `ref` names a model that is not
 * registered, `populate()` throws `MissingSchemaError` on the first request that
 * needs it — and it throws in production exactly as readily as in dev, on a
 * fresh database, because the fault is in the code.
 *
 * Three faults are possible and this looks for all three:
 *
 *  1. **A ref to a model that does not exist.** `populate()` fails at runtime,
 *     and only on the code path that populates — so a rarely-used admin screen
 *     can carry this for months.
 *
 *  2. **A ref that names the wrong model.** The worst of the three, because
 *     nothing errors: `customerId` declared `ref: "User"` populates a User by a
 *     Customer's id, finds nothing, and the field comes back `null`. It reads as
 *     missing data, not as a wiring mistake.
 *
 *  3. **An ObjectId with no ref at all.** Sometimes correct — a polymorphic
 *     target, or an id that points at an embedded sub-document rather than a
 *     collection — so each one is listed with the reason it is allowed, and an
 *     unlisted one is reported.
 *
 * ⚠️ Naming is the evidence for (2). `brandId` should reference `Brand`,
 * `customerId` should reference `Customer`. Where a field deliberately breaks
 * that rule it is listed in `INTENTIONAL` below with why — so the exception is
 * written down once rather than argued about at every review.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const log = (...a) => {
  if (!AS_JSON) console.log(...a);
};

const MODELS_DIR = path.join(__dirname, "..", "models");

/**
 * ObjectId fields that carry no `ref`, and why that is correct.
 *
 * ⚠️ An entry here is a claim that the field does **not** point at a collection.
 * If one ever should, removing it from this list is what makes the check fail.
 */
const REFLESS_ALLOWED = {
  "Banner.redirect.targetId":
    "Polymorphic — a brand, voucher or category depending on redirect.type. No single ref can be right.",
  "PromotionalTicker.redirect.targetId":
    "Polymorphic, same as Banner.redirect.targetId.",
  "VoucherClaim.offerId":
    "An offer is an embedded sub-document of VoucherVersion, not its own collection.",
  "VoucherUsage.offerId":
    "Same embedded offer as VoucherClaim.offerId.",
  "LedgerEntry.payoutLegId":
    "A payout leg is embedded on Settlement, not a collection of its own.",
};

/**
 * Fields whose name and target deliberately disagree, and why.
 *
 * ⚠️ Each of these is a decision, not an oversight. Anything that disagrees and
 * is *not* here is reported.
 */
const INTENTIONAL = {
  // e.g. "Model.field": "reason"
};

/** `brandId` → `Brand`. The convention every model follows unless listed above. */
const expectedModelFor = (fieldName) => {
  const leaf = fieldName.split(".").pop();
  const m = leaf.match(/^(.*)Ids?$/);
  if (!m || !m[1]) return null;
  const base = m[1];
  return base.charAt(0).toUpperCase() + base.slice(1);
};

// ---------------------------------------------------------------- load

/**
 * ⚠️ Every model is required, not just the ones under test.
 *
 * `mongoose.models` only knows what has been loaded, so checking a ref against a
 * partially-loaded registry reports models as missing that are merely not
 * imported yet — the check would fail loudest on the healthiest schemas.
 */
const loaded = [];
const loadErrors = [];
for (const file of fs.readdirSync(MODELS_DIR).sort()) {
  if (!file.endsWith(".js") || file === "validObjectId.js") continue;
  try {
    const mod = require(path.join(MODELS_DIR, file));
    if (mod?.schema && mod?.modelName) loaded.push(mod);
  } catch (error) {
    loadErrors.push({ file, message: error.message });
  }
}

const registered = new Set(Object.keys(mongoose.models));

// ---------------------------------------------------------------- walk

const findings = [];
let checked = 0;

for (const model of loaded) {
  for (const [name, def] of Object.entries(model.schema.paths)) {
    if (name === "_id") continue;

    const isArray = Boolean(def.caster);
    const instance = isArray ? def.caster.instance : def.instance;
    if (instance !== "ObjectId") continue;

    checked += 1;
    const key = `${model.modelName}.${name}`;
    const ref = def.options?.ref || def.caster?.options?.ref;

    // ── 3. no ref at all ──────────────────────────────────────────────────
    if (!ref) {
      if (!REFLESS_ALLOWED[key]) {
        findings.push({
          kind: "NO_REF",
          key,
          detail:
            "ObjectId with no `ref`. populate() cannot follow it and nothing verifies what it points at. " +
            "If it genuinely does not name a collection, add it to REFLESS_ALLOWED with the reason.",
        });
      }
      continue;
    }

    // ── 1. ref names a model that is not registered ───────────────────────
    if (!registered.has(ref)) {
      findings.push({
        kind: "MISSING_MODEL",
        key,
        detail: `ref: "${ref}" — no such model is registered. populate() on this path throws MissingSchemaError at runtime.`,
      });
      continue;
    }

    // ── 2. ref disagrees with the field's own name ────────────────────────
    const expected = expectedModelFor(name);
    if (expected && expected !== ref && registered.has(expected) && !INTENTIONAL[key]) {
      findings.push({
        kind: "NAME_MISMATCH",
        key,
        detail: `named for ${expected} but ref: "${ref}". If that is deliberate, add it to INTENTIONAL with the reason — otherwise populate() returns null and it reads as missing data.`,
      });
    }
  }
}

// ---------------------------------------------------------------- report

if (AS_JSON) {
  console.log(JSON.stringify({ checked, loadErrors, findings }, null, 2));
  process.exitCode = findings.length || loadErrors.length ? 1 : 0;
  return;
}

log(`\nModels loaded: ${loaded.length}   ObjectId paths checked: ${checked}\n`);

if (loadErrors.length) {
  log("❌ models that would not load:\n");
  for (const e of loadErrors) log(`   ${e.file}: ${e.message}`);
  log("");
}

const byKind = {
  MISSING_MODEL: "ref points at a model that does not exist",
  NAME_MISMATCH: "ref disagrees with the field name",
  NO_REF: "ObjectId with no ref",
};

log("─────────────────────────────────────────────────────────────");
for (const [kind, label] of Object.entries(byKind)) {
  const n = findings.filter((f) => f.kind === kind).length;
  log(`  ${n ? "❌" : "✅"} ${label.padEnd(46)} ${n}`);
}
log(
  `  ℹ️  documented ref-less fields                    ${Object.keys(REFLESS_ALLOWED).length}`,
);
log("─────────────────────────────────────────────────────────────");

if (findings.length) {
  log("");
  for (const [kind, label] of Object.entries(byKind)) {
    const rows = findings.filter((f) => f.kind === kind);
    if (!rows.length) continue;
    log(`${label}:\n`);
    for (const f of rows) {
      log(`  ${f.key}`);
      log(`     ${f.detail}\n`);
    }
  }
} else {
  log("\n✅ every relationship in the schemas can be followed.\n");
}

process.exitCode = findings.length || loadErrors.length ? 1 : 0;
