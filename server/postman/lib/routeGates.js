/**
 * The real auth gate on every route, read from `routes/` at generation time.
 *
 * The collections used to carry a hand-written "Access:" line per request. That
 * is a fact about the code kept in prose, and it drifted the moment the code
 * moved: after one commit opened nineteen endpoints to guests, every one of
 * those lines was quietly lying, and so were the tests built around them.
 *
 * Deriving it removes the class of error rather than the instance.
 */
const fs = require("fs");
const path = require("path");

// Loading a route file pulls in its controllers and, through them, the SDK
// clients in `configs/` — Razorpay throws at import time without a key. Nothing
// here talks to those services; the env just has to exist for the require to
// succeed.
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

// Longest first — `isVendorOrAdminEvenIfDeactivated` must match before
// `isVendorOrAdmin`, which must match before `isVendor`.
//
// ⚠️ Every gate `middlewares/index.js` exports has to appear here. One that is
// missing does not error — the route silently falls through to `PUBLIC`, which
// is the most dangerous wrong answer this file can give. `isVendorOrSubVendor`
// and `isBrandSideOrAdmin` were both missing, so the four outlet-facing routes
// (refund approve/reject, dispute evidence ×2) documented themselves as open.
const GATES = [
  "isVendorOrAdminEvenIfDeactivated",
  "verifyJwtTokenEvenIfDeactivated",
  "validateRolesEvenIfDeactivated",
  "isVendorOrSubVendor",
  "isBrandSideOrAdmin",
  "isVendorOrAdmin",
  "verifyJwtToken",
  "validateRoles",
  "optionalAuth",
  "isSubVendor",
  "isCustomer",
  "isVendor",
  "isAdmin",
];

const LABEL = {
  isAdmin: "`isAdmin` — admin only",
  isVendor: "`isVendor` — vendor only",
  isCustomer: "`isCustomer` — customer only",
  isSubVendor: "`isSubVendor` — outlet only",
  isVendorOrSubVendor: "`isVendorOrSubVendor` — vendor or outlet manager",
  isBrandSideOrAdmin: "`isBrandSideOrAdmin` — vendor, outlet or admin",
  isVendorOrAdmin: "`isVendorOrAdmin` — vendor or admin",
  isVendorOrAdminEvenIfDeactivated:
    "`isVendorOrAdminEvenIfDeactivated` — vendor or admin, **suspended account bhi**",
  verifyJwtToken: "`verifyJwtToken` — koi bhi signed-in role",
  verifyJwtTokenEvenIfDeactivated:
    "`verifyJwtTokenEvenIfDeactivated` — signed in, **suspended account bhi**",
  optionalAuth:
    "`optionalAuth` — 🌐 **guest bhi**, token ho to personalised",
  PUBLIC: "🌐 **Public — token ki zarurat nahi** (guest browsing)",
};

/** `["brands", "customer", "get", "{{brand_id}}"]` → `/brands/customer/get/:x` */
const normalize = (method, segments) => {
  const parts = segments.map((s) =>
    /^\{\{.+\}\}$/.test(String(s)) ||
    /^:/.test(String(s)) ||
    /^[0-9a-f]{24}$/i.test(String(s))
      ? ":x"
      : String(s),
  );
  return `${method.toUpperCase()} /${parts.join("/")}`;
};

/**
 * Comments are stripped before the per-route regex runs.
 *
 * ⚠️ `routes/disputes.js` and `routes/transactions.js` put a JSDoc block
 * *between* `router.get(` and the path string, explaining why that one route
 * carries its own gate. The regex below cannot see past it, so the route fell
 * through to `PUBLIC` — the whole chargeback worklist documented itself as
 * needing no token, which is the exact opposite of what the comment said.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const build = () => {
  const dir = path.join(__dirname, "..", "..", "routes");
  const map = new Map();

  for (const file of fs.readdirSync(dir)) {
    if (file === "index.js" || !file.endsWith(".js")) continue;
    const src = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
    const globalUse = new RegExp(`router\\.use\\(\\s*(${GATES.join("|")})`).exec(
      src,
    );
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path.join(dir, file));

    /**
     * ⚠️ A route file may export `{ router, routePrefix }` rather than the
     * router itself, and two of them do — `voucherClaims.js` mounts at
     * `/voucher-claims` and `customerBankAccounts.js` at `/bank-accounts`.
     *
     * Reading `.stack` off that object threw `router.stack is not iterable`,
     * which took the whole generator down: `generate-customer-collection.js`
     * could not run at all from the day `routePrefix` was introduced. That is
     * why the claim, refund and search requests were only ever inserted by
     * scripts — nobody was ignoring the generator, it was dead.
     *
     * And the mount must come from `routePrefix`, not the filename. Deriving it
     * from the filename gave `/voucherClaims`, so every one of those routes
     * missed the map and silently reported no gate at all.
     */
    const mounts = [];
    const main = mod.router || mod;
    if (typeof main === "function" && Array.isArray(main.stack)) {
      mounts.push([mod.routePrefix || "/" + file.replace(/\.js$/, ""), main]);
    }
    for (const extra of mod.extraRoutes || []) {
      if (extra.path && typeof extra.router === "function") {
        mounts.push([extra.path, extra.router]);
      }
    }

    for (const [base, router] of mounts) {
      for (const layer of router.stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
          if (!layer.route.methods[method]) continue;
          const escaped = layer.route.path.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const hit = new RegExp(
            `router\\.${method}\\(\\s*"${escaped}"\\s*,\\s*(\\w+)`,
          ).exec(src);

          let gate = globalUse ? globalUse[1] : "PUBLIC";
          if (hit && GATES.includes(hit[1])) gate = hit[1];

          const key = normalize(
            method,
            (base + layer.route.path).split("/").filter(Boolean),
          );
          map.set(key, gate);
        }
      }
    }
  }
  return map;
};

let cache = null;

/**
 * The raw gate name, or null when no route matches.
 *
 * ⚠️ Falls back to treating trailing segments as parameters.
 *
 * `normalize` only turns `{{var}}`, `:x` and a 24-hex string into `:x`, so a
 * request that deliberately sends a **malformed** id — `payments/not-an-object-id`,
 * `code/TD-0OI1L5` — missed the map entirely and reported no gate at all. Every
 * such request then needed a hand-written `gate:` fallback, and one of those was
 * already wrong: the malformed-voucher-id request still claims `verifyJwtToken`
 * long after that route became `optionalAuth`. A hand-written gate is the exact
 * thing this file exists to abolish.
 *
 * Replacing the last segment with `:x`, then the last two, and so on, resolves
 * those to the same Express route a well-formed id would hit — which is the
 * honest answer, because the gate runs before the validator and does not depend
 * on whether the id parses.
 */
const gateNameFor = (method, segments) => {
  if (!cache) cache = build();

  const exact = cache.get(normalize(method, segments));
  if (exact) return exact;

  for (let tail = 1; tail <= segments.length; tail += 1) {
    const guess = segments.slice();
    for (let i = guess.length - tail; i < guess.length; i += 1) guess[i] = ":x";
    const hit = cache.get(normalize(method, guess));
    if (hit) return hit;
  }
  return null;
};

/** A rendered "Access:" label, or null when no route matches. */
const gateFor = (method, segments) => {
  const name = gateNameFor(method, segments);
  return name ? LABEL[name] || `\`${name}\`` : null;
};

/** Every route and its gate — used by the audit output. */
const allGates = () => {
  if (!cache) cache = build();
  return new Map(cache);
};

module.exports = { gateFor, gateNameFor, allGates, LABEL };
