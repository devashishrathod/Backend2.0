/**
 * Sanity-checks a generated Postman collection before anyone imports it.
 *
 *   node postman/lib/validate-collection.js <collection.json> <environment.json>
 *
 * A generated collection fails in ways a human-written one does not: a typo in a
 * test script is not a syntax error in the *generator*, it is a runtime error
 * inside Postman that only surfaces mid-run. So this checks the things that are
 * cheap to check and expensive to discover:
 *
 *   1. Every test script parses as JavaScript.
 *   2. Every `{{variable}}` the collection references exists in the environment.
 *   3. Every request has at least one assertion.
 *   4. No request points at an obviously malformed URL.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [, , collectionPath, envPath] = process.argv;
if (!collectionPath) {
  console.error("usage: validate-collection.js <collection.json> [env.json]");
  process.exit(2);
}

const collection = JSON.parse(fs.readFileSync(collectionPath, "utf8"));
const env = envPath ? JSON.parse(fs.readFileSync(envPath, "utf8")) : null;

const problems = [];
let requests = 0;
let scripts = 0;
let assertions = 0;

/** Variables the environment declares, plus Postman's own dynamic ones. */
const known = new Set(
  (env?.values || []).map((v) => v.key).concat(["$guid", "$timestamp", "$randomInt"]),
);

const walk = (items, trail) => {
  for (const node of items) {
    const here = [...trail, node.name];
    if (node.item) {
      walk(node.item, here);
      continue;
    }

    requests += 1;
    const where = here.join(" › ");

    // ── 1. URL sanity ────────────────────────────────────────────────────
    const raw = node.request?.url?.raw || "";
    /**
     * ⚠️ Two roots, not one.
     *
     * `{{base_url}}` ends in `/trydood/v1` and covers 216 of the 219 routes.
     * The other three — `/`, `/my-ip`, `/client-ip` — are served by `index.js`
     * **outside** that mount, so they hang off `{{host_url}}`. Requiring
     * `base_url` here is what kept them out of every collection: they could not
     * be expressed without failing validation.
     */
    const ROOTS = ["{{base_url}}", "{{host_url}}"];
    const root = ROOTS.find((r) => raw.startsWith(`${r}/`) || raw === `${r}/`);
    if (!root) {
      problems.push(
        `${where}: url does not start with {{base_url}}/ or {{host_url}}/ — "${raw}"`,
      );
    }
    if (/\/\//.test(raw.replace(root || "{{base_url}}", ""))) {
      problems.push(`${where}: double slash in path — "${raw}"`);
    }

    // ── 2. Variable references ───────────────────────────────────────────
    if (env) {
      const blob = JSON.stringify({
        url: node.request?.url,
        body: node.request?.body,
        auth: node.request?.auth,
      });
      for (const m of blob.matchAll(/\{\{([^}]+)\}\}/g)) {
        const name = m[1].trim();
        if (!known.has(name)) {
          problems.push(`${where}: references {{${name}}}, not in the environment`);
        }
      }
    }

    // ── 3. Test scripts parse, and there is at least one ─────────────────
    const exec = node.event?.find((e) => e.listen === "test")?.script?.exec;
    if (!exec || !exec.length) {
      problems.push(`${where}: no test script`);
      continue;
    }

    scripts += 1;
    const source = exec.join("\n");
    const count = (source.match(/pm\.test\(/g) || []).length;
    assertions += count;
    if (count === 0) {
      problems.push(`${where}: test script has no pm.test block`);
    }

    try {
      // Parse only — never run. `new vm.Script` throws on a syntax error and
      // does not execute anything.
      new vm.Script(source, { filename: `${where}.js` });
    } catch (e) {
      problems.push(`${where}: test script syntax error — ${e.message}`);
    }

    // A capture that writes a variable nobody declared is a silent no-op.
    if (env) {
      for (const m of source.matchAll(/pm\.environment\.set\("([^"]+)"/g)) {
        if (!known.has(m[1])) {
          problems.push(`${where}: captures into {{${m[1]}}}, not in the environment`);
        }
      }
    }
  }
};

walk(collection.item, []);

console.log(`\n${path.basename(collectionPath)}`);
console.log(`  ${requests} requests · ${scripts} scripts · ${assertions} assertions`);

if (problems.length) {
  console.log(`\n❌ ${problems.length} problem(s):\n`);
  problems.forEach((p) => console.log("  • " + p));
  process.exit(1);
}

console.log("\n✅ clean\n");
