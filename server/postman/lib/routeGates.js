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
const GATES = [
  "isVendorOrAdminEvenIfDeactivated",
  "verifyJwtTokenEvenIfDeactivated",
  "isVendorOrAdmin",
  "verifyJwtToken",
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

const build = () => {
  const dir = path.join(__dirname, "..", "..", "routes");
  const map = new Map();

  for (const file of fs.readdirSync(dir)) {
    if (file === "index.js" || !file.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const globalUse = new RegExp(`router\\.use\\(\\s*(${GATES.join("|")})`).exec(
      src,
    );
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const router = require(path.join(dir, file));
    const base = "/" + file.replace(/\.js$/, "");

    for (const layer of router.stack) {
      if (!layer.route) continue;
      const method = Object.keys(layer.route.methods)[0];
      const escaped = layer.route.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return map;
};

let cache = null;

/** The raw gate name, or null when no route matches. */
const gateNameFor = (method, segments) => {
  if (!cache) cache = build();
  return cache.get(normalize(method, segments)) || null;
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
