/**
 * Prove that every route this server serves is documented and exercised.
 *
 *   node scripts/verifyApiCoverage.js            # full report
 *   node scripts/verifyApiCoverage.js --missing  # only what is missing
 *   node scripts/verifyApiCoverage.js --json     # machine-readable
 *
 * Exits **1** when anything is uncovered, so it can gate a commit or a build.
 *
 * ### The gap this closes
 *
 * Coverage was being counted by hand, and hand-counting drifted every single
 * time: the vendor doc claimed 78 endpoints while its collection had 116
 * requests and its generator built 19 folders for a shipped file with 22. Three
 * numbers, three sources, none of them agreeing, and no way to notice — because
 * the only thing that ever compared them was somebody remembering to.
 *
 * So the routes are read from the **built Express routers** (see
 * `postman/lib/routeInventory.js`), never from a list, and everything else is
 * checked against them:
 *
 *   1. `docs/endpoints_category.md` — every route categorised
 *   2. the three role docs — every route written up where its gate says it belongs
 *   3. the three collections — every route requested, **with a saved example**
 *
 * ### ⚠️ What "the right doc" means
 *
 * A route's audience comes from the gate the code actually runs, not from where
 * somebody filed it. `isCustomer` belongs to the customer doc; `isVendorOrAdmin`
 * belongs to **both** the vendor and admin docs, because both roles really can
 * call it. Anything reachable without a role gate (`PUBLIC`, `optionalAuth`,
 * `verifyJwtToken`) needs to be documented **somewhere**, and the check says so
 * rather than demanding it in all three.
 */
const fs = require("fs");
const path = require("path");

const { listRoutes, routeKey, APP_ROUTES } = require("../postman/lib/routeInventory");

const args = process.argv.slice(2);
const ONLY_MISSING = args.includes("--missing");
const AS_JSON = args.includes("--json");

const ROOT = path.join(__dirname, "..");
const log = (...a) => {
  if (!AS_JSON) console.log(...a);
};

// ---------------------------------------------------------------- audiences

/**
 * Which surface a gate belongs to.
 *
 * ⚠️ Derived from the gate, never from the folder somebody filed it under. The
 * whole point of `endpoints_category.md` was that "intended" and "enforced"
 * disagree more often than is comfortable — so the enforced gate decides.
 */
const AUDIENCE = {
  isCustomer: { docs: ["customer"], collections: ["customer"] },
  isVendor: { docs: ["vendor"], collections: ["vendor"] },
  isVendorOrSubVendor: { docs: ["vendor"], collections: ["vendor"] },
  isAdmin: { docs: ["admin"], collections: ["admin"] },

  /**
   * ⚠️ Documented in **both**, requested in **one**.
   *
   * Both roles genuinely can call these 38 routes, so both docs have to say so
   * — an admin reading only the admin doc would conclude the endpoint is not
   * theirs. But two collections holding the same request means maintaining it
   * twice, and the day one is updated and the other is not, the collection that
   * was missed starts lying with no way to notice. This repo has already paid
   * that bill: `lib/accountFolders.js` exists because email verification was
   * about to be written out twice.
   *
   * The admin doc's section links to the vendor collection rather than copying
   * the request.
   */
  isVendorOrAdmin: { docs: ["vendor", "admin"], collections: ["vendor"] },
  isBrandSideOrAdmin: { docs: ["vendor", "admin"], collections: ["vendor"] },
};

/** Gates that any signed-in role passes, so "documented anywhere" is enough. */
const SHARED = new Set([
  "PUBLIC",
  "optionalAuth",
  "verifyJwtToken",
  "verifyJwtTokenEvenIfDeactivated",
]);

const audienceFor = (gate) => AUDIENCE[gate] || null;

// ---------------------------------------------------------------- sources

const SURFACES = {
  customer: {
    doc: "docs/customer_mobile_api_doc.md",
    collection: "postman/trydood-customer.postman_collection.json",
    env: "postman/environments/customer-local.postman_environment.json",
  },
  vendor: {
    doc: "docs/vendor_panel_api_doc.md",
    collection: "postman/trydood-vendor.postman_collection.json",
    env: "postman/environments/vendor-local.postman_environment.json",
  },
  admin: {
    doc: "docs/super_admin_panel_api_doc.md",
    collection: "postman/trydood-admin.postman_collection.json",
    env: "postman/environments/admin-local.postman_environment.json",
  },
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Does this document mention this route?
 *
 * ⚠️ Matched as a **pattern**, not a string. The same route is written three
 * ways across the docs — `:brandId`, `{{brand_id}}`, and a literal id in a
 * captured example — and a plain `includes()` reports every parameterised route
 * as undocumented. Each parameter segment therefore matches any single segment.
 */
const mentionRegex = (routePath) => {
  const body = routePath
    .split("/")
    .filter(Boolean)
    .map((s) =>
      s.startsWith(":")
        ? "(?::[A-Za-z_]+|\\{\\{[^}]+\\}\\}|[^/\\s`)\\]]+)"
        : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`/${body}(?![A-Za-z0-9_-])`);
};

/** Every method+path a collection actually requests, and whether it has an example. */
const collectionIndex = (rel) => {
  const col = JSON.parse(read(rel));
  const map = new Map();
  const walk = (items) =>
    items.forEach((node) => {
      if (node.item) return walk(node.item);
      const p = (node.request?.url?.path || []).join("/");
      const key = routeKey(node.request?.method || "GET", `/${p}`);
      const has = (node.response || []).length > 0;
      const prev = map.get(key);
      map.set(key, { requests: (prev?.requests || 0) + 1, example: prev?.example || has });
    });
  walk(col.item);
  return map;
};

// ---------------------------------------------------------------- run

const routes = [...listRoutes(), ...APP_ROUTES.map((r) => ({ ...r, gate: "PUBLIC" }))];

const categoryDoc = read("docs/endpoints_category.md");
const docs = {};
const collections = {};
for (const [name, s] of Object.entries(SURFACES)) {
  docs[name] = read(s.doc);
  collections[name] = collectionIndex(s.collection);
}

const findings = [];

for (const r of routes) {
  const key = routeKey(r.method, r.path);
  const re = mentionRegex(r.path);

  const inCategory = re.test(categoryDoc);

  const wanted = audienceFor(r.gate);
  const all = Object.keys(SURFACES);
  const docSurfaces = wanted ? wanted.docs : all;
  const colSurfaces = wanted ? wanted.collections : all;

  const docHits = docSurfaces.filter((s) => re.test(docs[s]));
  const colHits = colSurfaces.filter((s) => collections[s].has(key));
  const exampleHits = colSurfaces.filter((s) => collections[s].get(key)?.example);

  /**
   * A shared route only has to land **somewhere**; a role-gated one has to land
   * on every surface its rule names. Demanding `GET /app-config` in all three
   * collections would be three copies of one request to keep in step.
   */
  const docOk = wanted ? docHits.length === docSurfaces.length : docHits.length > 0;
  const colOk = wanted ? colHits.length === colSurfaces.length : colHits.length > 0;
  const exOk = wanted
    ? exampleHits.length === colSurfaces.length
    : exampleHits.length > 0;

  const problems = [];
  if (!inCategory) problems.push("not in endpoints_category.md");
  if (!docOk) {
    problems.push(
      `doc missing (${wanted ? docSurfaces.filter((s) => !docHits.includes(s)).join(", ") : "none of the three"})`,
    );
  }
  if (!colOk) {
    problems.push(
      `no request (${wanted ? colSurfaces.filter((s) => !colHits.includes(s)).join(", ") : "none of the three"})`,
    );
  } else if (!exOk) {
    problems.push("request has no saved example");
  }

  findings.push({ ...r, key, problems, docHits, colHits });
}

const broken = findings.filter((f) => f.problems.length);

if (AS_JSON) {
  console.log(JSON.stringify({ total: routes.length, broken }, null, 2));
  process.exitCode = broken.length ? 1 : 0;
  return;
}

log(`\nRoutes served: ${routes.length}  (${routes.length - APP_ROUTES.length} in routes/, ${APP_ROUTES.length} in index.js)\n`);

const counts = {
  category: findings.filter((f) => f.problems.some((p) => p.includes("category"))).length,
  doc: findings.filter((f) => f.problems.some((p) => p.startsWith("doc"))).length,
  request: findings.filter((f) => f.problems.some((p) => p.startsWith("no request"))).length,
  example: findings.filter((f) => f.problems.some((p) => p.includes("saved example"))).length,
};

log("─────────────────────────────────────────────────────────────");
log(`  ${counts.category ? "❌" : "✅"} endpoints_category.md    ${routes.length - counts.category}/${routes.length} categorised`);
log(`  ${counts.doc ? "❌" : "✅"} role docs                ${routes.length - counts.doc}/${routes.length} documented`);
log(`  ${counts.request ? "❌" : "✅"} collections              ${routes.length - counts.request}/${routes.length} have a request`);
log(`  ${counts.example ? "❌" : "✅"} saved examples           ${routes.length - counts.example}/${routes.length} have an example`);
log("─────────────────────────────────────────────────────────────");

if (broken.length) {
  log(`\n${broken.length} route(s) need attention:\n`);
  const byMount = {};
  for (const f of broken) (byMount[f.mount] ||= []).push(f);
  for (const [mount, rows] of Object.entries(byMount).sort()) {
    log(`  ${mount}  (${rows.length})`);
    for (const f of rows) {
      log(`     ${f.method.padEnd(6)} ${f.path.padEnd(52)} ${f.gate}`);
      for (const p of f.problems) log(`            → ${p}`);
    }
    log("");
  }
} else {
  log("\n✅ every route is categorised, documented, requested and exemplified.\n");
}

if (!ONLY_MISSING && !broken.length) {
  for (const [name, s] of Object.entries(SURFACES)) {
    const col = JSON.parse(read(s.collection));
    let n = 0;
    let ex = 0;
    const walk = (items) =>
      items.forEach((x) => {
        if (x.item) return walk(x.item);
        n += 1;
        ex += (x.response || []).length;
      });
    walk(col.item);
    log(`  ${name.padEnd(9)} ${String(n).padStart(4)} requests · ${ex} examples`);
  }
  log("");
}

process.exitCode = broken.length ? 1 : 0;
