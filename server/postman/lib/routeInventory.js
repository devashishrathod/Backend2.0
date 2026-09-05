/**
 * Every route this server actually serves, read from `routes/` and `index.js`.
 *
 * ### Why this is a module and not a grep
 *
 * A grep over `router.get(` misses three things this codebase really does, and
 * each one has already caused a silent gap:
 *
 *  - a route file may export `{ router, routePrefix }`, so the mount is **not**
 *    the filename — `voucherClaims.js` serves `/voucher-claims`;
 *  - a file may export `extraRoutes`, mounting a second router somewhere else;
 *  - a JSDoc block between `router.get(` and the path hides the path from any
 *    naive pattern.
 *
 * So this walks the **built Express routers**, the same way `routeGates.js`
 * does, and reports what the server will genuinely answer. If a route exists,
 * it is in here; if it is in here, it exists.
 *
 * `scripts/verifyApiCoverage.js` is the consumer that matters: it takes this
 * list as the truth and asks whether every entry appears in the endpoint map,
 * in the right role doc, and in the right collection with a saved example.
 */
const fs = require("fs");
const path = require("path");

const { gateFor, gateNameFor } = require("./routeGates");

/** Routes `index.js` serves itself, outside the `/trydood/v1` mount. */
const APP_ROUTES = [
  {
    method: "GET",
    path: "/",
    mount: "index.js",
    file: "index.js",
    note: "Health check — plain text, deliberately not the JSON envelope.",
  },
  {
    method: "GET",
    path: "/my-ip",
    mount: "index.js",
    file: "index.js",
    note: "Outbound address, for the Atlas Network Access allow-list.",
  },
  {
    method: "GET",
    path: "/client-ip",
    mount: "index.js",
    file: "index.js",
    note: "The caller's address as this process sees it, through TRUST_PROXY.",
  },
];

const API_PREFIX = "/trydood/v1";

/**
 * Walk one route file's exported router(s).
 *
 * Mirrors `routeGates.build()` deliberately — if these two ever disagree about
 * what a mount is, the gate reported for a route belongs to a different route.
 */
const mountsFor = (dir, file) => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(path.join(dir, file));
  const mounts = [];

  const main = mod.router || mod;
  if (typeof main === "function" && Array.isArray(main.stack)) {
    mounts.push([mod.routePrefix || `/${file.replace(/\.js$/, "")}`, main]);
  }
  for (const extra of mod.extraRoutes || []) {
    if (extra.path && typeof extra.router === "function") {
      mounts.push([extra.path, extra.router]);
    }
  }
  return mounts;
};

/**
 * @returns {Array<{method, path, apiPath, mount, file, gate, gateLabel}>}
 *   `path` is mount-relative (`/get-all`), `apiPath` is what a client calls
 *   (`/trydood/v1/vouchers/get-all`).
 */
const listRoutes = () => {
  const dir = path.join(__dirname, "..", "..", "routes");
  const rows = [];

  for (const file of fs.readdirSync(dir).sort()) {
    if (file === "index.js" || !file.endsWith(".js")) continue;

    for (const [base, router] of mountsFor(dir, file)) {
      for (const layer of router.stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
          if (!layer.route.methods[method]) continue;

          const full = `${base}${layer.route.path}`.replace(/\/+$/, "") || base;
          const segments = full.split("/").filter(Boolean);

          rows.push({
            method: method.toUpperCase(),
            path: full,
            apiPath: `${API_PREFIX}${full}`,
            mount: base,
            file,
            gate: gateNameFor(method, segments) || "PUBLIC",
            gateLabel: gateFor(method, segments) || "—",
          });
        }
      }
    }
  }

  // Stable order so a diff of the report is readable.
  rows.sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path),
  );

  return rows;
};

/**
 * A comparison key that survives the three ways the same route gets written.
 *
 * `:brandId`, `{{brand_id}}` and a literal `6a9be2…` are the same route to
 * Express, and all three appear across the docs and the collections. Without
 * this, a coverage check reports every parameterised route as missing.
 */
const routeKey = (method, urlPath) => {
  const segments = String(urlPath)
    .replace(/^\/trydood\/v1/, "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith(":")) return ":x";
      if (/^\{\{.+\}\}$/.test(s)) return ":x";
      if (/^[0-9a-f]{24}$/i.test(s)) return ":x";
      return s;
    });
  return `${String(method).toUpperCase()} /${segments.join("/")}`;
};

module.exports = { listRoutes, routeKey, APP_ROUTES, API_PREFIX };
