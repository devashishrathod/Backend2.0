/**
 * Records real responses from a live run and writes them back into a collection
 * as Postman saved examples.
 *
 *   node postman/lib/capture-examples.js <collection.json> <environment.json> [--env-var k=v ...]
 *
 * ── Why capture instead of write them by hand ──────────────────────────────
 * Hand-written examples drift from the API the moment anything changes, and the
 * drift is invisible — a wrong example reads exactly like a right one. Two
 * shipped in earlier rounds (`nearestOutlet._id` that is really `subBrandId`, a
 * flat `medias[]` that is really a nested `media.data[]`) and both were only
 * caught by running the thing. Everything here comes off the wire, so an example
 * can only be wrong if the API itself is.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 * 1. Runs the collection with Newman, recording every request/response pair.
 * 2. Rewrites volatile values back into the `{{variables}}` they came from, so
 *    an example stays readable and does not rot when ids change.
 * 3. Redacts credentials — JWTs, push tokens.
 * 4. Attaches each response to its own request, and *also* collects every
 *    sibling request that exercises the same endpoint onto the primary one, so
 *    opening one API in Postman shows its whole behaviour: success, each
 *    validation failure, each business refusal.
 */
const fs = require("fs");
const path = require("path");
const newman = require("newman");

const [, , collectionPath, environmentPath, ...rest] = process.argv;
if (!collectionPath || !environmentPath) {
  console.error(
    "usage: capture-examples.js <collection.json> <environment.json> [--env-var k=v ...]",
  );
  process.exit(2);
}

const envVars = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--env-var" && rest[i + 1]) {
    const [key, ...v] = rest[++i].split("=");
    envVars.push({ key, value: v.join("=") });
  }
}

const collectionFile = path.resolve(collectionPath);
const collection = JSON.parse(fs.readFileSync(collectionFile, "utf8"));

// Fail before the run rather than after it, so a naming collision never shows
// up as examples quietly attached to the wrong request.
require("./assertUniqueNames")(collection.item);

// ---------------------------------------------------------------- helpers
const json = (o) => JSON.stringify(o, null, 2);

/**
 * The endpoint a request exercises, used to group siblings.
 *
 * Path segments that are ids — a `{{variable}}` or a bare ObjectId — collapse to
 * `:param`, so "voucher detail" and "voucher detail, unknown id" land on the
 * same key while genuinely different paths stay apart.
 */
const endpointKey = (method, urlPath) => {
  const segments = String(urlPath)
    .split("/")
    .filter(Boolean)
    .map((s) =>
      /^\{\{.+\}\}$/.test(s) || /^[0-9a-f]{24}$/i.test(s) ? ":param" : s,
    );
  return `${method.toUpperCase()} /${segments.join("/")}`;
};

/**
 * Volatile values → the variable they came from.
 *
 * Longest first so a value that contains another (a token containing a short id)
 * is replaced as a whole rather than corrupted from the inside out.
 */
const buildPlaceholders = (environment) => {
  const pairs = [];
  for (const v of environment) {
    if (!v || !v.value || typeof v.value !== "string") continue;
    if (v.value.length < 6) continue; // too short to substitute safely
    pairs.push([v.value, `{{${v.key}}}`]);
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
};

const SECRET_KEYS = /^(token|refreshToken|accessToken)$/i;

/**
 * Anything that would either leak a credential or churn on every run.
 *
 * Timestamps are pinned rather than dropped: their *shape* is part of the
 * contract a client codes against, their exact value is not.
 */
const sanitize = (value, placeholders, keyHint = "") => {
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v, placeholders, keyHint));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitize(v, placeholders, k);
    }
    return out;
  }
  if (typeof value !== "string") return value;

  if (SECRET_KEYS.test(keyHint) && value.length > 40) {
    return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<redacted>.<redacted>";
  }
  // ISO 8601 — keep the shape, pin the instant.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return "2026-08-27T10:00:00.000Z";
  }

  let out = value;
  for (const [raw, placeholder] of placeholders) {
    if (out.includes(raw)) out = out.split(raw).join(placeholder);
  }
  return out;
};

/**
 * The key that ties a Newman event back to an item in the file.
 *
 * Ids will not do — Newman mints them at load time and the file has none. The
 * folder path will not either: this Newman build does not expose a usable
 * `parent()` chain, so a request there knows only its own name. That leaves the
 * request name, which is unique per collection by construction; `assertUnique`
 * below fails loudly rather than silently mis-attaching if that ever stops
 * being true.
 */
const itemKey = (item) => item.name;

/**
 * A request name reduced to the case it covers.
 *
 * Strips the ordering prefix and the arrow that points at the expected status —
 * the status is already the first thing in the example's name, so repeating it
 * just makes the list harder to scan.
 */
const caseLabel = (requestName) =>
  String(requestName)
    .replace(/^\d+\.\s*/, "")
    .replace(/\s*→\s*\d{3}\s*$/, "")
    .replace(/\s*⭐\s*$/, "")
    .trim();

/** A short, honest label: the status plus what the API actually said. */
const exampleName = (code, body) => {
  const message =
    body && typeof body === "object" && typeof body.message === "string"
      ? body.message
      : "";
  const trimmed = message.length > 62 ? message.slice(0, 59) + "…" : message;
  return trimmed ? `${code} — ${trimmed}` : `${code}`;
};

// ---------------------------------------------------------------- run
const captured = [];

newman.run(
  {
    collection: collectionFile,
    environment: path.resolve(environmentPath),
    envVar: envVars,
    reporters: [],
    bail: false,
  },
  (err, summary) => {
    if (err) {
      console.error("newman failed:", err.message);
      process.exit(1);
    }

    const finalEnv = (summary.environment && summary.environment.values
      ? summary.environment.values.members || summary.environment.values
      : []
    ).map((v) => ({ key: v.key, value: v.value }));

    const placeholders = buildPlaceholders(finalEnv);

    // ── group by endpoint ──────────────────────────────────────────────
    const byRequest = new Map(); // request id -> [example]
    const byEndpoint = new Map(); // endpoint key -> [{name, example}]

    for (const rec of captured) {
      let parsed = null;
      try {
        parsed = JSON.parse(rec.bodyText);
      } catch {
        parsed = null;
      }

      /**
       * A non-JSON answer is still an answer.
       *
       * ⚠️ This used to `continue`, on the reasoning that every endpoint returns
       * the JSON envelope. One does not: `GET /transactions/invoice/:token`
       * answers **302** with a `Location`, and Express writes a short HTML body
       * with it. So that request was silently the only one in the collection
       * with no saved example — and silence is the whole problem, because the
       * summary line still said every request was covered.
       *
       * The body is capped: a redirect that was followed would otherwise drop a
       * whole PDF into the collection. Requests whose answer *is* the redirect
       * set `followRedirects: false`, so what lands here is the 302 itself.
       */
      const example =
        parsed === null
          ? {
              name: `${rec.code} — ${rec.status}`,
              originalRequest: rec.originalRequest,
              status: rec.status,
              code: rec.code,
              _postman_previewlanguage: "text",
              header: [
                ...(rec.location
                  ? [{ key: "Location", value: rec.location }]
                  : []),
              ],
              cookie: [],
              body: String(rec.bodyText || "").slice(0, 2000),
            }
          : null;

      if (example) {
        if (!byRequest.has(rec.itemId)) byRequest.set(rec.itemId, []);
        byRequest.get(rec.itemId).push(example);
        if (!byEndpoint.has(rec.endpoint)) byEndpoint.set(rec.endpoint, []);
        byEndpoint.get(rec.endpoint).push({ label: rec.itemName, example });
        continue;
      }

      const clean = sanitize(parsed, placeholders);
      const jsonExample = {
        name: exampleName(rec.code, clean),
        originalRequest: rec.originalRequest,
        status: rec.status,
        code: rec.code,
        _postman_previewlanguage: "json",
        header: [{ key: "Content-Type", value: "application/json" }],
        cookie: [],
        body: json(clean),
      };

      if (!byRequest.has(rec.itemId)) byRequest.set(rec.itemId, []);
      byRequest.get(rec.itemId).push(jsonExample);

      if (!byEndpoint.has(rec.endpoint)) byEndpoint.set(rec.endpoint, []);
      byEndpoint.get(rec.endpoint).push({ label: rec.itemName, example: jsonExample });
    }

    // ── write back ─────────────────────────────────────────────────────
    let touched = 0;
    let total = 0;
    const seenPrimary = new Set();

    const walk = (items) => {
      for (const item of items) {
        if (item.item) {
          walk(item.item);
          continue;
        }
        const own = byRequest.get(item.name) || [];
        if (!own.length) continue;

        const key = captured.find((c) => c.itemId === item.name)?.endpoint;

        let examples = own;

        // The first request to touch an endpoint becomes its reference: it
        // carries every sibling's response too, so one place shows the whole
        // contract. The siblings keep their own single example.
        if (key && !seenPrimary.has(key)) {
          seenPrimary.add(key);
          const siblings = byEndpoint.get(key) || [];
          // Named after the case rather than the message: on a consolidated
          // request the reader is scanning for "which situation is this",
          // and two different situations often share a message.
          const merged = siblings.map((s) => ({
            ...s.example,
            name: `${s.example.code} · ${caseLabel(s.label)}`,
          }));
          // Success first, then errors by status — the order a reader wants.
          merged.sort((a, b) => a.code - b.code);
          examples = merged;
        }

        item.response = examples;
        touched += 1;
        total += examples.length;
      }
    };

    walk(collection.item);

    fs.writeFileSync(collectionFile, json(collection) + "\n");

    const failures = summary.run.failures.length;
    console.log(
      `\ncaptured ${captured.length} responses · ` +
        `${touched} requests now carry examples · ${total} examples written`,
    );
    console.log(
      `run: ${summary.run.stats.requests.total} requests · ` +
        `${summary.run.stats.assertions.total} assertions · ${failures} failed`,
    );
    if (failures) {
      console.log("\n⚠️  assertions failed — examples still captured, but fix these:");
      summary.run.failures.slice(0, 10).forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.source?.name || "?"} — ${f.error?.message}`);
      });
    }
    process.exit(failures ? 1 : 0);
  },
).on("request", (err, args) => {
  if (err || !args.response) return;
  const item = args.item;
  const url = args.request.url;
  const urlPath = "/" + (url.path || []).join("/");

  captured.push({
    // Newman assigns ids at load time, so they match nothing in the file on
    // disk. The folder/request name path is what is actually stable across the
    // two representations.
    itemId: itemKey(item),
    itemName: item.name,
    endpoint: endpointKey(args.request.method, urlPath),
    code: args.response.code,
    status: args.response.status,
    bodyText: args.response.stream
      ? Buffer.from(args.response.stream).toString("utf8")
      : "",
    /**
     * Kept only for the redirect case, where it **is** the response: the
     * invoice and payout-statement links answer 302 and the target URL is the
     * entire payload. A body-only example of those documents nothing.
     */
    location:
      (args.response.headers &&
        typeof args.response.headers.get === "function" &&
        args.response.headers.get("Location")) ||
      null,
    // Postman renders the example against the request that produced it, so it
    // has to be a snapshot rather than a reference to the live one.
    originalRequest: {
      method: args.request.method,
      header: (args.request.headers?.members || [])
        .filter((h) => !/^authorization$/i.test(h.key) && !h.disabled)
        .map((h) => ({ key: h.key, value: h.value })),
      url: {
        raw: url.toString(),
        host: ["{{base_url}}"],
        path: url.path || [],
        ...(url.query && url.query.count && url.query.count()
          ? {
              query: url.query
                .all()
                .filter((q) => !q.disabled)
                .map((q) => ({ key: q.key, value: q.value })),
            }
          : {}),
      },
      ...(args.request.body && args.request.body.mode
        ? { body: args.request.body.toJSON() }
        : {}),
    },
  });
});
