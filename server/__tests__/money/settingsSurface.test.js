const Setting = require("../../models/Setting");
const { validateUpdateSetting } = require("../../validator/settings");
const {
  CUSTOMER_BLOCKS,
  NESTED_BLOCKS,
  APP_BLOCKS,
} = require("../../services/settings/updateSetting");

/**
 * ⚠️ A settings field with no way in fails **silently**.
 *
 * `stripUnknown` is on, so a key the validator does not name is removed before
 * the service ever sees it: the admin gets a `200`, the response carries the
 * **old** value, and nothing changed. There is no error anywhere to notice.
 *
 * This has now shipped three times — the whole `admin` block, the three refund
 * abuse limits, and five of the nine `customer.settlement.reserve` fields that
 * decide how much of a vendor's payout is held back. Each time the field was
 * added to the model and to the config getter, and `validator/settings.js` was
 * the one place nothing forced anybody to touch.
 *
 * ### Why the previous version of this test did not catch the third one
 *
 * It checked a hand-written list of ten blocks, one level deep, with
 * `VALIDATOR_SOURCE.includes(fieldName)`. Three separate holes, and the reserve
 * gap fell through all of them:
 *
 *  - **One level deep.** `customer.settlement.reserve` is itself a block, so the
 *    check saw the name `reserve` in the validator source and stopped. The nine
 *    fields inside it were never looked at.
 *  - **A hand-written list.** Ten blocks were named; ten others — every
 *    `vendor.*` block, `customer.search`, `admin.notification` and all five
 *    `app.*` blocks — were not in it at all, so half the surface had no guard.
 *  - **A substring search.** `includes("isEnabled")` passes because *some* block
 *    has an `isEnabled`, not because this one does.
 *
 * So this walks the schema to the **leaf**, derives the blocks from the schema
 * itself rather than a list somebody has to remember to extend, and compares
 * against the validator's real `describe()` output rather than its source text.
 * A field added at any depth, in any block, is covered the day it is declared.
 *
 * Still no database: it costs nothing and it fails at the moment a field is
 * added to a model, which is the only moment anybody is thinking about it.
 */

/**
 * Fields that are deliberately **not** writable through the request body.
 *
 * Named one at a time rather than pattern-matched: the point is that adding a
 * field to this list is a deliberate act with a reason, not something a new
 * field can drift into.
 */
const READ_ONLY = Object.freeze({
  _id: "assigned by MongoDB",
  createdAt: "written by mongoose timestamps",
  updatedAt: "written by mongoose timestamps",
  updatedBy:
    "taken from the JWT by updateSetting — accepting it from the body would let an admin attribute their change to somebody else",
});

/** Every leaf path on the model, `a.b.c` style. */
const modelLeaves = (schema, prefix = "", out = []) => {
  for (const [key, schemaType] of Object.entries(schema.paths)) {
    if (key === "__v") continue;
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (schemaType.schema) modelLeaves(schemaType.schema, dotted, out);
    else out.push(dotted);
  }
  return out;
};

/** Every leaf key the validator actually accepts. */
const joiLeaves = (description, prefix = "", out = []) => {
  for (const [key, child] of Object.entries(description.keys || {})) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (child.type === "object" && child.keys) joiLeaves(child, dotted, out);
    else out.push(dotted);
  }
  return out;
};

/** The sub-blocks of `schema`, i.e. the paths that are themselves blocks. */
const blocksIn = (schema) =>
  Object.entries(schema.paths)
    .filter(([, schemaType]) => Boolean(schemaType.schema))
    .map(([key]) => key);

const MODEL = modelLeaves(Setting.schema);
const VALIDATOR = joiLeaves(validateUpdateSetting.body.describe());

describe("every setting on the model has a way in", () => {
  it("no model field is missing from the validator", () => {
    const writable = MODEL.filter((path) => !READ_ONLY[path]);
    const missing = writable.filter((path) => !VALIDATOR.includes(path));

    expect(missing).toEqual([]);
  });

  /**
   * The mirror, and the reason it matters: a key the validator accepts but the
   * model has no home for is saved nowhere. The request still returns `200`.
   */
  it("no validator key is missing from the model", () => {
    const stray = VALIDATOR.filter((path) => !MODEL.includes(path));

    expect(stray).toEqual([]);
  });

  /**
   * A guard that covers nothing passes just as quietly as one that covers
   * everything. If the walk above ever starts returning an empty list — a
   * mongoose change, a bad refactor — every assertion here would go green while
   * checking nothing at all.
   */
  it("the walk actually reaches the whole document", () => {
    expect(MODEL.length).toBeGreaterThan(100);
    expect(VALIDATOR.length).toBeGreaterThan(100);
    // The deepest path in the document, and the one the old test could not see.
    expect(MODEL).toContain("customer.settlement.reserve.maxPercent");
    expect(VALIDATOR).toContain("customer.settlement.reserve.maxPercent");
  });
});

describe("updateSetting knows how to merge every block", () => {
  /**
   * `updateSetting` merges block by block, so a **new top-level block** — the
   * way `security` and then `admin` arrived — needs a branch of its own. Without
   * one the validator accepts the payload and the service quietly drops it,
   * which looks exactly like success.
   */
  const topLevelBlocks = blocksIn(Setting.schema);

  const UPDATE_SOURCE = require("fs").readFileSync(
    require("path").join(
      __dirname,
      "..",
      "..",
      "services",
      "settings",
      "updateSetting.js",
    ),
    "utf8",
  );

  it.each(topLevelBlocks)("merges the %s block", (block) => {
    expect(UPDATE_SOURCE).toContain(`payload.${block}`);
  });

  /**
   * `CUSTOMER_BLOCKS` is a hand-written list inside `updateSetting`, and its own
   * comment says why: a block in the schema and the validator but missing from
   * that list "would validate cleanly, return 200, and save nothing". Nothing
   * was comparing the list to the schema, so the comment was the only guard.
   */
  it("CUSTOMER_BLOCKS names every block under customer", () => {
    const schemaBlocks = Object.keys(Setting.schema.path("customer").schema.paths);

    expect([...CUSTOMER_BLOCKS].sort()).toEqual(schemaBlocks.sort());
  });

  /**
   * ⚠️ The `Object.assign` wipe.
   *
   * Assigning onto a mongoose sub-document **replaces** a nested path wholesale,
   * so `{settlement: {reserve: {percent: 15}}}` re-creates `reserve` from its
   * schema defaults and silently drops `holdDays` and the rest — measured on the
   * live schema, 45/3 reset to 30/2. `NESTED_BLOCKS` is what holds those back to
   * be merged separately, and a nested block missing from it loses its siblings
   * on every partial save.
   */
  it("NESTED_BLOCKS names every block under customer that contains a block", () => {
    const customerSchema = Setting.schema.path("customer").schema;

    const actual = {};
    for (const block of blocksIn(customerSchema)) {
      const inner = blocksIn(customerSchema.path(block).schema);
      if (inner.length) actual[block] = inner;
    }

    const declared = Object.fromEntries(
      Object.entries(NESTED_BLOCKS).map(([key, value]) => [key, [...value]]),
    );

    expect(declared).toEqual(actual);
  });

  /**
   * `app` does not go through `CUSTOMER_BLOCKS`; it has its own list, and the
   * same failure mode. `support` going missing from it is the example that
   * matters — every "contact support" sentence in the mobile app reads from that
   * block, and it would stop being saveable with nothing to show for it.
   */
  it("APP_BLOCKS names every block under app", () => {
    expect([...APP_BLOCKS].sort()).toEqual(
      blocksIn(Setting.schema.path("app").schema).sort(),
    );
  });

  /**
   * The scalars beside those blocks are assigned individually, so they drift the
   * same way. `forceUpdate` is the one that matters: it locks every user below
   * `minVersion` out of the app at once, and the way back is the very update it
   * is demanding.
   */
  it.each(
    Object.entries(Setting.schema.path("app").schema.paths)
      .filter(([, schemaType]) => !schemaType.schema)
      .map(([key]) => key),
  )("assigns the app.%s scalar", (key) => {
    expect(UPDATE_SOURCE).toContain(`payload.app.${key}`);
  });
});

/**
 * ⚠️ A setting that is stored, returned, and read by nothing.
 *
 * The mirror of the gap above, and just as quiet: `vendor.showcase.isActive` was
 * on the model and settable from the panel, so switching the showcase off saved
 * cleanly and came back in `GET /settings/get` — while `getShowcaseConfig` never
 * returned it and no caller ever asked. Vendors carried on creating sections and
 * uploading media as though nothing had happened.
 *
 * Read off the built Express router rather than the source text, so a route that
 * exists is checked whether or not anybody remembered it — the same reasoning
 * `postman/lib/routeInventory.js` is built on.
 */
describe("the showcase kill switch reaches every write", () => {
  const showcaseRouter = require("../../routes/showcase");
  const { requireShowcaseEnabled } = require("../../middlewares");

  const routes = showcaseRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter(
        (m) => layer.route.methods[m],
      ),
      gated: layer.route.stack.some(
        (handler) => handler.handle === requireShowcaseEnabled,
      ),
    }));

  const writes = routes.filter((r) => r.methods.some((m) => m !== "get"));
  const reads = routes.filter((r) => r.methods.every((m) => m === "get"));

  it("the router actually yielded routes to check", () => {
    expect(writes.length).toBeGreaterThan(0);
    expect(reads.length).toBeGreaterThan(0);
  });

  it("every showcase write is behind the switch", () => {
    const ungated = writes.filter((r) => !r.gated).map((r) => r.path);

    expect(ungated).toEqual([]);
  });

  /**
   * ⚠️ Deliberately open, and this asserts it stays that way.
   *
   * A vendor has to be able to see the gallery they are being stopped from
   * editing, and the customer-facing reads keep serving what a brand already
   * published — emptying a gallery people are browsing is a bigger change than
   * freezing edits, and not what this switch is for.
   */
  it("no showcase read is behind the switch", () => {
    const gated = reads.filter((r) => r.gated).map((r) => r.path);

    expect(gated).toEqual([]);
  });

  /**
   * The middleware is the only thing that reads it, and it reads it off
   * `getShowcaseConfig`. A getter that stops returning the field puts the switch
   * straight back to doing nothing, with the gate still in place on every route.
   */
  it("getShowcaseConfig still returns isActive", () => {
    const source = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        "helpers",
        "settings",
        "getShowcaseConfig.js",
      ),
      "utf8",
    );

    expect(source).toMatch(/isActive:\s*showcase\.isActive/);
  });
});
