/**
 * Declare the claim/refund variables the customer collection uses, and give the
 * two that had no source at all a real one.
 *
 * `addClaimRequestsToPostman.js` and `addRefundRequestsToPostman.js` inserted 30
 * requests with three guards — byte-exact round-trip, captured-example count,
 * folder numbering — but **no guard for variables**. So those requests reference
 * twelve `{{names}}` the environment never declared, and because their examples
 * were never captured (that needs newman, which is not installed here) nobody
 * ran them and nobody found out. `lib/validate-collection.js` has been reporting
 * all 28 ever since.
 *
 * This fixes the ones that can be fixed without new fixtures:
 *
 *   4 captured at runtime, never declared — claim_transaction_id, claim_id,
 *     claim_code, refund_request_id. Each is set by an earlier request before
 *     first use, so the run works; declaring them removes the ambiguity and the
 *     validator noise.
 *
 *   outlet_id  -> deleted. `sub_brand_id` is the same SubBrand id, captured by
 *     the voucher feed and already used by the discount-preview request for the
 *     identical field. Two names for one id is exactly what drifts.
 *
 *   offer_id   -> captured from the voucher detail response, which already has
 *     `version.offers` in scope in one of its assertions.
 *
 *   promo_code -> a literal. `seedPostmanFixtures.js` now creates that code.
 *
 * Left alone, deliberately:
 *
 *   razorpay_order_id · razorpay_payment_id · razorpay_signature — these come
 *     out of a real Razorpay checkout in a browser. The collection cannot ever
 *     produce them; the README already lists that endpoint as one of the ten
 *     that cannot be verified headlessly.
 *
 *   other_customer_transaction_id · other_customer_claim_id — the two
 *     authorization tests. Filling these needs a second customer with a claim of
 *     their own in the seeder. ⚠️ Until then both assert 403 and get 422
 *     ("Invalid claimId.") from the ObjectId validator, so they fail. Do NOT
 *     "fix" that by widening the assertion to accept 422: the test would go
 *     green for ever while checking nothing, and it is checking whether one
 *     customer can open another's payment.
 *
 *   node scripts/fixPostmanClaimVariables.js           # what would change
 *   node scripts/fixPostmanClaimVariables.js --apply   # change it
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "postman");
const COLLECTION = "trydood-customer.postman_collection.json";
const ENVIRONMENT = path.join(
  "environments",
  "customer-local.postman_environment.json",
);

/** Must match the code `seedPostmanFixtures.js` creates. */
const SEEDED_PROMO_CODE = "PMFX10";

const NEW_VARS = [
  // Captured at runtime by an earlier request; declared so the environment
  // shows them before a run and the validator stops flagging them.
  { key: "claim_transaction_id", value: "" },
  { key: "claim_id", value: "" },
  { key: "claim_code", value: "" },
  { key: "refund_request_id", value: "" },
  // Newly captured from the voucher detail response.
  { key: "offer_id", value: "" },
  // A literal, because the seeder creates exactly this code.
  { key: "promo_code", value: SEEDED_PROMO_CODE },
];

const serialize = (obj) =>
  `${JSON.stringify(obj, null, 2).replace(/\n/g, "\r\n")}\r\n`;

const readChecked = (relative) => {
  const full = path.join(DIR, relative);
  const raw = fs.readFileSync(full, "utf8");
  const parsed = JSON.parse(raw);
  if (serialize(parsed) !== raw) {
    console.error(
      `[x] ${relative}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
    );
    return null;
  }
  return { full, raw, parsed };
};

const countExamples = (list) =>
  list.reduce(
    (sum, i) =>
      sum + (i.item ? countExamples(i.item) : (i.response || []).length),
    0,
  );

const findRequest = (items, name) => {
  for (const node of items) {
    if (node.item) {
      const hit = findRequest(node.item, name);
      if (hit) return hit;
    } else if (node.name === name) {
      return node;
    }
  }
  return null;
};

let changed = 0;
const notes = [];

// ── collection ─────────────────────────────────────────────────────────────
const collectionFile = readChecked(COLLECTION);
if (!collectionFile) {
  process.exitCode = 1;
} else {
  const collection = collectionFile.parsed;
  const beforeExamples = countExamples(collection.item);
  let touched = 0;

  // 1. The claim order body points at a variable nobody sets. `sub_brand_id` is
  //    the same SubBrand id, and the discount-preview request already sends it
  //    for the identical `outletId` field.
  const order = findRequest(collection.item, "Claim order kholo (promo ke saath) \u2b50");
  if (!order) {
    console.error(`[x] ${COLLECTION}: claim order request not found.`);
    process.exitCode = 1;
  } else if (order.request.body?.raw?.includes("{{outlet_id}}")) {
    order.request.body.raw = order.request.body.raw.replace(
      "{{outlet_id}}",
      "{{sub_brand_id}}",
    );
    touched += 1;
    notes.push("claim order: {{outlet_id}} -> {{sub_brand_id}}");
  }

  // 2. Capture the offer id where the response already carries it. The voucher
  //    detail request asserts over `version.offers` a few lines above, so the
  //    field is known to be there.
  const detail = findRequest(collection.item, "Voucher detail \u2b50");
  if (!detail) {
    console.error(`[x] ${COLLECTION}: voucher detail request not found.`);
    process.exitCode = 1;
  } else {
    const exec = detail.event.find((e) => e.listen === "test").script.exec;
    if (!exec.some((line) => line.includes('pm.environment.set("offer_id"'))) {
      exec.push(
        "",
        "// The claim order needs an offer that belongs to this voucher. Captured",
        "// here rather than in the feed, because the feed row only carries the",
        "// single best offer while the claim may be opened against any of them.",
        "if (pm.response.code < 300) {",
        "  try {",
        "    const offers = pm.response.json().data.version.offers || [];",
        '    if (offers.length) pm.environment.set("offer_id", String(offers[0]._id));',
        "  } catch (e) {}",
        "}",
      );
      touched += 1;
      notes.push("voucher detail: captures offer_id");
    }
  }

  const afterExamples = countExamples(collection.item);
  if (afterExamples !== beforeExamples) {
    console.error(
      `[x] ${COLLECTION}: captured examples changed ${beforeExamples} -> ${afterExamples}. Refusing to write.`,
    );
    process.exitCode = 1;
  } else if (!touched) {
    console.log(`[skip] ${COLLECTION}: already fixed.`);
  } else {
    console.log(
      `${APPLY ? "[ok]" : "[dry]"} ${COLLECTION}: ${touched} change(s), examples unchanged at ${afterExamples}`,
    );
    notes.forEach((n) => console.log(`        - ${n}`));
    if (APPLY) {
      fs.writeFileSync(collectionFile.full, serialize(collection), "utf8");
      changed += 1;
    }
  }
}

// ── environment ────────────────────────────────────────────────────────────
const envFile = readChecked(ENVIRONMENT);
if (!envFile) {
  process.exitCode = 1;
} else {
  const env = envFile.parsed;
  const missing = NEW_VARS.filter(
    (v) => !env.values.some((e) => e.key === v.key),
  );
  if (!missing.length) {
    console.log(`[skip] ${ENVIRONMENT}: variables already present.`);
  } else {
    env.values.push(
      ...missing.map((v) => ({ ...v, type: "default", enabled: true })),
    );
    console.log(
      `${APPLY ? "[ok]" : "[dry]"} ${ENVIRONMENT}: +${missing.length} variable(s) - ${missing
        .map((v) => v.key)
        .join(", ")}`,
    );
    if (APPLY) {
      fs.writeFileSync(envFile.full, serialize(env), "utf8");
      changed += 1;
    }
  }
}

console.log(
  APPLY
    ? changed + " file(s) updated. Validate with postman/lib/validate-collection.js"
    : "Dry run. Re-run with --apply to write.",
);
