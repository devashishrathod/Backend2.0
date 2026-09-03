const fs = require("fs");
const path = require("path");

const Setting = require("../../models/Setting");

const VALIDATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "validator", "settings.js"),
  "utf8",
);

const UPDATE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "services", "settings", "updateSetting.js"),
  "utf8",
);

const nested = (schema, ...segments) => {
  let current = schema;
  for (const segment of segments) {
    current = current.path(segment)?.schema;
    if (!current) return null;
  }
  return current;
};

const fieldsOf = (...segments) => {
  const schema = nested(Setting.schema, ...segments);
  if (!schema) return null;
  return Object.keys(schema.paths).filter((p) => !p.startsWith("_"));
};

const BLOCKS = [
  ["customer", "convenienceFee"],
  ["customer", "tax"],
  ["customer", "promoCode"],
  ["customer", "claim"],
  ["customer", "notification"],
  ["customer", "invoice"],
  ["customer", "settlement"],
  ["customer", "refund"],
  ["customer", "chargeback"],
  ["security", "otp"],
];

/**
 * ⚠️ A settings field with no way in fails **silently**.
 *
 * `stripUnknown` is on, so a key the validator does not name is removed before
 * the service ever sees it: the admin gets a `200`, the panel shows the value
 * they typed until the next refresh, and nothing changed. There is no error
 * anywhere to notice.
 *
 * Six fields were in exactly that state, and three of them —
 * `maxOpenRequests`, `maxRejectedPerWindow`, `requestWindowDays` — are written
 * up in `refund_flow.md` §2.3 as admin config, with a table of defaults. Every
 * part of that was true except the part that would have let anybody set them.
 *
 * This is a source-text check rather than a behavioural one on purpose: it costs
 * nothing, it needs no database, and it catches the gap at the moment a field is
 * added to a model — which is the only moment anybody is thinking about it.
 */
describe("every setting on the model has a way in", () => {
  it.each(BLOCKS)("%s.%s is fully covered by the validator", (...segments) => {
    const fields = fieldsOf(...segments);

    expect(fields).not.toBeNull();
    expect(fields.length).toBeGreaterThan(0);

    const missing = fields.filter((f) => !VALIDATOR_SOURCE.includes(f));
    expect(missing).toEqual([]);
  });

  /**
   * The other half of the same gap.
   *
   * `updateSetting` merges block by block, so a **new top-level block** — the
   * way `security` arrived — needs a branch of its own. Without one the
   * validator accepts the payload and the service quietly drops it, which looks
   * exactly like success.
   */
  it.each([...new Set(BLOCKS.map(([top]) => top))])(
    "updateSetting knows how to merge the %s block",
    (top) => {
      expect(UPDATE_SOURCE).toContain(`payload.${top}`);
    },
  );
});
