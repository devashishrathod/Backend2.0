const fs = require("fs");
const path = require("path");

const Setting = require("../../models/Setting");

/**
 * The two settings reference files have to describe the settings that exist.
 *
 * ### 🔴 Why this test exists
 *
 * `docs/setting_default_response.json` and `docs/setting_fields_reference.json`
 * are what somebody reads to answer "what can I set, and what does it do"
 * without opening the model. They are maintained by hand, and they had drifted:
 * S-1 added two floors, a GIF ceiling and `image/gif` — updating the admin doc
 * and the Postman example but not these — and V-1 then added
 * `vendor.voucher.minImages` on top.
 *
 * Stale is worse than absent here. An admin reading the reference and finding no
 * `minItemsPerSection` concludes the floor does not exist, and the number that
 * decides whether a section reaches a customer goes unmanaged.
 *
 * `verifyApiCoverage.js` cannot catch this — it checks that every *route* is
 * documented, not that a field-by-field reference still matches the schema. So
 * the check lives here, where it runs on every commit.
 *
 * ⚠️ Scoped to `vendor.*` on purpose. That is the block this migration keeps
 * changing; widening it to the whole document would fail on `_id`, timestamps
 * and the several blocks whose defaults come from env config, which is a
 * different problem and not this one.
 */

const DOCS = path.join(__dirname, "..", "..", "docs");

const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(DOCS, name), "utf8"));

/** Every leaf of an object as `a.b.c` → a comparable string. */
const leaves = (value, prefix = "") =>
  Object.entries(value || {}).flatMap(([key, item]) => {
    const at = prefix ? `${prefix}.${key}` : key;
    const isPlain =
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      !item._bsontype &&
      !(item instanceof Date);
    if (isPlain) return leaves(item, at);
    return [[at, Array.isArray(item) ? JSON.stringify(item) : String(item)]];
  });

const modelVendorDefaults = () =>
  new Map(leaves(new Setting({}).toObject().vendor, "vendor"));

describe("setting_default_response.json matches the model", () => {
  const documented = () =>
    new Map(leaves(readJson("setting_default_response.json").data.vendor, "vendor"));

  test("every vendor setting the model defines is in the snapshot", () => {
    const missing = [...modelVendorDefaults().keys()].filter(
      (key) => !documented().has(key),
    );

    expect(missing).toEqual([]);
  });

  test("the snapshot describes nothing the model does not have", () => {
    const model = modelVendorDefaults();
    const extra = [...documented().keys()].filter((key) => !model.has(key));

    expect(extra).toEqual([]);
  });

  /**
   * The values too, not just the field names. A default that has moved — 3 to 5
   * on a floor, say — is exactly the kind of change an admin would act on, and
   * the snapshot claiming the old number is worse than it saying nothing.
   */
  test("every documented default is the default the model actually applies", () => {
    const model = modelVendorDefaults();
    const docs = documented();

    const wrong = [...model.entries()]
      .filter(([key, value]) => docs.has(key) && docs.get(key) !== value)
      .map(([key, value]) => `${key}: model ${value}, docs ${docs.get(key)}`);

    expect(wrong).toEqual([]);
  });
});

describe("setting_fields_reference.json covers the vendor block", () => {
  const reference = () => readJson("setting_fields_reference.json");

  test("every vendor setting has a field entry", () => {
    const { fields } = reference();

    const missing = [...modelVendorDefaults().keys()].filter(
      (key) => !(key in fields),
    );

    expect(missing).toEqual([]);
  });

  test("each entry says what the default is, and agrees with the model", () => {
    const { fields } = reference();
    const model = modelVendorDefaults();

    const wrong = [...model.entries()]
      .filter(([key]) => fields[key])
      .filter(([key, value]) => {
        const documented = fields[key].default;
        if (documented === undefined) return true;
        const asString = Array.isArray(documented)
          ? JSON.stringify(documented)
          : String(documented);
        return asString !== value;
      })
      .map((entry) => entry[0]);

    expect(wrong).toEqual([]);
  });

  test("each entry says something about what the field does", () => {
    const { fields } = reference();

    const undescribed = [...modelVendorDefaults().keys()].filter(
      (key) => !fields[key]?.description?.trim(),
    );

    expect(undescribed).toEqual([]);
  });

  /**
   * The rules that cannot be expressed as one field's constraint. Every one of
   * them is a `422` an admin can hit, so a reference that omits one describes a
   * panel that appears to accept a value it will refuse.
   */
  test("both floor rules are listed among the cross-field rules", () => {
    const names = reference().crossFieldRules.map((rule) => rule.name);

    expect(names).toContain("showcase floor rule");
    expect(names).toContain("voucher image floor rule");
  });

  test("every cross-field rule says what it is, what enforces it, and why", () => {
    const incomplete = reference()
      .crossFieldRules.filter(
        (rule) => !rule.rule || !rule.enforcedBy || !rule.why,
      )
      .map((rule) => rule.name);

    expect(incomplete).toEqual([]);
  });

  /**
   * ⚠️ `failsWith` is required only of the rules that actually **refuse** a save.
   *
   * Three entries here are not validations at all — "GSTIN vs state code" is
   * what the tax builder does with the pair, and "app.features hides screens, it
   * does not close endpoints" is a warning that a toggle is not a security
   * control. Demanding a status code from those would be demanding a fiction,
   * and the first version of this test did exactly that.
   *
   * The narrower question is the one worth asking: a rule enforced by an
   * `assert*Rule` helper refuses the save, so it has to say what the caller gets.
   */
  test("every rule enforced by an assert helper says how it fails", () => {
    const silent = reference()
      .crossFieldRules.filter((rule) => /assert\w+Rule\.js/.test(rule.enforcedBy))
      .filter((rule) => !rule.failsWith)
      .map((rule) => rule.name);

    expect(silent).toEqual([]);
  });
});
