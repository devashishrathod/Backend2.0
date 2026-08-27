/**
 * Shared Postman v2.1 builders for the three panel collections.
 *
 * Lives here rather than being copied into each generator so that a change to
 * the response envelope, the auth header, or the assertion style lands in all
 * three at once. The alternative — three near-identical 2,000-line scripts —
 * drifts the moment one of them is edited.
 *
 * Nothing in here knows about a specific endpoint. Enums and limits are read
 * from `constants/` by the callers, never hard-coded.
 */

// ---------------------------------------------------------------- primitives

const json = (obj) => JSON.stringify(obj, null, 2);

/** Safely embeds a JS string inside generated test-script source. */
const q = (s) => JSON.stringify(String(s));

const bearer = (varName) => ({
  type: "bearer",
  bearer: [{ key: "token", value: `{{${varName}}}`, type: "string" }],
});

const url = (segments, query) => {
  const enabled = (query || []).filter((p) => !p.disabled);
  return {
    raw:
      "{{base_url}}/" +
      segments.join("/") +
      (enabled.length
        ? "?" + enabled.map((p) => `${p.key}=${p.value}`).join("&")
        : ""),
    host: ["{{base_url}}"],
    path: segments,
    ...(query && query.length ? { query } : {}),
  };
};

const jsonBody = (obj) => ({
  mode: "raw",
  raw: json(obj),
  options: { raw: { language: "json" } },
});

const formBody = (fields) => ({
  mode: "formdata",
  formdata: fields.map((f) => ({
    key: f.key,
    ...(f.type === "file"
      ? { type: "file", src: [] }
      : { type: "text", value: f.value }),
    ...(f.description ? { description: f.description } : {}),
    ...(f.disabled ? { disabled: true } : {}),
  })),
});

const ok = (message, data) => ({ success: true, message, data });
const err = (message, details) => ({
  success: false,
  message,
  ...(details ? { details } : {}),
});

// ---------------------------------------------------------------- assertions
//
// Every helper returns an array of source lines. A request's `assert` array is
// flattened into one script, so they compose freely.

const A = {
  /** The only assertion every single request carries. */
  status: (code) => [
    `pm.test(${q(`HTTP ${code}`)}, function () {`,
    `  pm.response.to.have.status(${code});`,
    `});`,
    ``,
  ],

  /**
   * The success envelope from utils/response.js. Asserting its shape on every
   * 2xx is what catches a controller that quietly returns `res.json(...)`
   * instead — which has happened here before (`DELETE /users/delete`).
   */
  ok: (message) => [
    `pm.test("success envelope", function () {`,
    `  const b = pm.response.json();`,
    `  pm.expect(b.success, "success flag").to.eql(true);`,
    `  pm.expect(b.message, "message").to.be.a("string").and.not.empty;`,
    `  pm.expect(b, "data key").to.have.property("data");`,
    `});`,
    ``,
    ...(message
      ? [
          `pm.test(${q(`message is "${message}"`)}, function () {`,
          `  pm.expect(pm.response.json().message).to.eql(${q(message)});`,
          `});`,
          ``,
        ]
      : []),
  ],

  /** The failure envelope. `message` is matched as a substring. */
  err: (message) => [
    `pm.test("error envelope", function () {`,
    `  const b = pm.response.json();`,
    `  pm.expect(b.success, "success flag").to.eql(false);`,
    `  pm.expect(b.message, "message").to.be.a("string").and.not.empty;`,
    `});`,
    ``,
    ...(message
      ? [
          `pm.test(${q(`message mentions "${message}"`)}, function () {`,
          `  pm.expect(String(pm.response.json().message)).to.include(${q(message)});`,
          `});`,
          ``,
        ]
      : []),
  ],

  /**
   * The shared `pagination` utility's envelope.
   *
   * Note it throws 404 on an empty result rather than returning an empty page,
   * so a passing run of this assertion also proves the fixture had data.
   */
  paged: () => [
    `pm.test("pagination envelope", function () {`,
    `  const d = pm.response.json().data;`,
    `  pm.expect(d.total, "total").to.be.a("number");`,
    `  pm.expect(d.totalPages, "totalPages").to.be.a("number");`,
    `  pm.expect(d.page, "page").to.be.a("number");`,
    `  pm.expect(d.limit, "limit").to.be.a("number");`,
    `  pm.expect(d.data, "data").to.be.an("array");`,
    `});`,
    ``,
  ],

  /**
   * Field presence + type on `data` (or on each row of `data.data` when
   * `each` is true).
   *
   * `type` accepts a chai type, `"null-or-string"` for a nullable string, or
   * `"present"` when only the key matters. Nullable is its own case because
   * several customer fields are contractually `null` rather than absent —
   * `bannerType` for one — and a plain type check would fail on the null.
   */
  fields: (spec, { each = false, name } = {}) => {
    const checks = Object.entries(spec).map(([key, type]) => {
      if (type === "present") {
        return `    pm.expect(o, ${q(key)}).to.have.property(${q(key)});`;
      }
      if (String(type).startsWith("null-or-")) {
        const t = String(type).slice("null-or-".length);
        return (
          `    pm.expect(o, ${q(key)}).to.have.property(${q(key)});\n` +
          `    if (o[${q(key)}] !== null) pm.expect(o[${q(key)}], ${q(key)}).to.be.a(${q(t)});`
        );
      }
      return `    pm.expect(o[${q(key)}], ${q(key)}).to.be.a(${q(type)});`;
    });

    const title = name || (each ? "every row has the documented shape" : "response shape");

    return [
      `pm.test(${q(title)}, function () {`,
      `  const d = pm.response.json().data;`,
      each
        ? `  (d.data || []).forEach(function (o) {`
        : `  [d].forEach(function (o) {`,
      ...checks,
      `  });`,
      `});`,
      ``,
    ];
  },

  /** Free-form block, for anything the helpers above do not cover. */
  custom: (name, lines) => [
    `pm.test(${q(name)}, function () {`,
    ...lines.map((l) => "  " + l),
    `});`,
    ``,
  ],

  /**
   * Guards a field that must never reach a client.
   *
   * Cheap to assert and the failure mode is severe — a projection edit that
   * re-adds `password` or a brand's PAN would otherwise pass every other test
   * in the suite.
   */
  absent: (paths, { each = false } = {}) => [
    `pm.test("no sensitive fields leaked", function () {`,
    `  const d = pm.response.json().data;`,
    each
      ? `  (d.data || []).forEach(function (o) {`
      : `  [d].forEach(function (o) {`,
    ...paths.map(
      (p) => `    pm.expect(o, ${q(p)}).to.not.have.property(${q(p)});`,
    ),
    `  });`,
    `});`,
    ``,
  ],
};

/**
 * Writes values out of a response into the environment so the next request can
 * use them. Runs before the assertions and never fails the request — a capture
 * that finds nothing is a fixture gap, not a contract violation.
 */
const capture = (pairs) => {
  if (!pairs || !pairs.length) return [];
  return [
    `// ── capture into the environment ──`,
    `if (pm.response.code < 300) {`,
    `  const d = pm.response.json().data;`,
    ...pairs.map(
      ([envVar, path]) =>
        `  try { const v = ${path}; if (v) pm.environment.set(${q(envVar)}, String(v)); } catch (e) {}`,
    ),
    `}`,
    ``,
  ];
};

// ---------------------------------------------------------------- request

const example = ({ name, code, status, body, req }) => ({
  name,
  originalRequest: req,
  status,
  code,
  _postman_previewlanguage: "json",
  header: [{ key: "Content-Type", value: "application/json" }],
  cookie: [],
  body: json(body),
});

/**
 * One request.
 *
 * @param {object}   o
 * @param {string}   o.name
 * @param {string}   o.method
 * @param {string[]} o.segments      path segments after base_url
 * @param {Array}    [o.query]
 * @param {object}   [o.body]        raw JSON body
 * @param {Array}    [o.form]        multipart fields (mutually exclusive with body)
 * @param {Array}    [o.headers]     extra headers — used to send a deliberately
 *                                   bad Authorization value, which `token`
 *                                   cannot express
 * @param {string}   [o.token]       env var holding the bearer token
 * @param {string}   [o.gate]        rendered as an "Access" line in the description
 * @param {string}   [o.description] markdown
 * @param {Array}    [o.assert]      flattened into the test script
 * @param {Array}    [o.capture]     [[envVar, "d.path"], …]
 * @param {Array}    [o.examples]    saved examples (documentation only)
 */
const req = ({
  name,
  method,
  segments,
  query,
  body,
  form,
  headers = [],
  token,
  gate,
  description,
  assert = [],
  capture: caps = [],
  examples = [],
}) => {
  const request = {
    method,
    header: [
      ...(body ? [{ key: "Content-Type", value: "application/json" }] : []),
      ...headers,
    ],
    ...(body ? { body: jsonBody(body) } : {}),
    ...(form ? { body: formBody(form) } : {}),
    url: url(segments, query),
    ...(token ? { auth: bearer(token) } : { auth: { type: "noauth" } }),
    description: [gate ? `**Access:** ${gate}` : null, description || null]
      .filter(Boolean)
      .join("\n\n"),
  };

  const script = [...capture(caps), ...assert];

  return {
    name,
    request,
    response: examples.map((ex) => example({ ...ex, req: request })),
    ...(script.length
      ? {
          event: [
            {
              listen: "test",
              script: { type: "text/javascript", exec: script },
            },
          ],
        }
      : {}),
  };
};

const folder = (name, description, item) => ({ name, description, item });

/** Counts requests and examples across a nested folder tree. */
const countTree = (items) =>
  items.reduce(
    (acc, node) => {
      if (node.item) {
        const inner = countTree(node.item);
        return {
          folders: acc.folders + 1 + inner.folders,
          requests: acc.requests + inner.requests,
          examples: acc.examples + inner.examples,
          tests: acc.tests + inner.tests,
        };
      }
      const exec = node.event?.[0]?.script?.exec || [];
      return {
        folders: acc.folders,
        requests: acc.requests + 1,
        examples: acc.examples + (node.response?.length || 0),
        tests:
          acc.tests + exec.filter((l) => l.startsWith("pm.test(")).length,
      };
    },
    { folders: 0, requests: 0, examples: 0, tests: 0 },
  );

module.exports = {
  json,
  q,
  url,
  jsonBody,
  formBody,
  ok,
  err,
  A,
  capture,
  req,
  folder,
  countTree,
};
