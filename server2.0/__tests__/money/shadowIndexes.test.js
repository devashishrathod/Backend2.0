/**
 * The blanket unique index that kept coming back.
 *
 * ### ⚠️ Why this file exists
 *
 * Commit `59fd080` declared `invoiceId: { type: String, unique: true }` on
 * `Transaction`. A path-level `unique: true` makes Mongoose create an index
 * named exactly `invoiceId_1` — **not sparse, not partial**. Mongo indexes a
 * missing field as `null`, so a blanket unique on a nullable path rejects the
 * *second* document that has no value yet. Every voucher claim is created before
 * its invoice exists, so in production that is **every second claim rejected**,
 * with a duplicate-key error naming a field the customer never touched.
 *
 * `3494bb8` replaced it with the named partial index the schema still declares.
 * It came back on the cluster anyway, twice, after being dropped — because an
 * older build of this same service is still running somewhere against the same
 * database, and Mongoose's `autoIndex` rebuilds that path on every restart.
 *
 * `assertMoneyIndexes` used to only warn, at boot, to a console nobody reads in
 * production — so the old build won by default. These tests pin the two
 * conditions that make dropping it automatically safe rather than reckless.
 *
 * ⚠️ Everything here runs against a throwaway collection, never a model's. The
 * point is the *rule*, and testing it on `transactions` would mean creating a
 * broken index on a collection other suites are using.
 */
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
} = require("./setup/testDb");

const {
  reapShadowIndexes,
  isBlanketUnique,
} = require("../../helpers/transactions/reapShadowIndexes");

const COLL = "__shadow_index_probe";

const coll = () => mongoose.connection.db.collection(COLL);

const indexNames = async () => (await coll().indexes()).map((i) => i.name);

/** The correct shape: unique only where the field is actually a string. */
const givenTheCorrectIndex = async (field = "invoiceId") =>
  coll().createIndex(
    { [field]: 1 },
    {
      name: `${field}_unique_partial`,
      unique: true,
      partialFilterExpression: { [field]: { $type: "string" } },
    },
  );

/** What an old build's `unique: true` produces. */
const givenTheShadow = async (field = "invoiceId") =>
  coll().createIndex({ [field]: 1 }, { name: `${field}_1`, unique: true });

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  try {
    await coll().drop();
  } catch {
    // Never created, or already gone. Neither is a failure.
  }
  await disconnectTestDb();
});

beforeEach(async () => {
  try {
    await coll().drop();
  } catch {
    // First run.
  }
  /**
   * ⚠️ The seed carries an `invoiceId`, and that is not incidental.
   *
   * With a blanket unique in place, exactly **one** row may have no value.
   * Seeding a row without one takes that slot, so the first insert inside a test
   * is already the second null — and the test fails on its own setup line while
   * demonstrating the very bug it was written to describe.
   */
  await coll().insertOne({ seeded: true, invoiceId: "SEED" });
});

describe("recognising the shape", () => {
  it("calls a unique index with nothing narrowing it blanket", () => {
    expect(isBlanketUnique({ name: "invoiceId_1", unique: true })).toBe(true);
  });

  it.each([
    ["not unique at all", { name: "invoiceId_1" }],
    ["narrowed by a partial filter", { name: "x", unique: true, partialFilterExpression: {} }],
    /**
     * ⚠️ Sparse counts as narrowed even though a sparse unique index still
     * indexes an explicit `null` — it is not the shape this reaps, and somebody
     * chose it deliberately.
     */
    ["narrowed by sparse", { name: "x", unique: true, sparse: true }],
    ["the id index", { name: "_id_", unique: true }],
  ])("does not call it blanket when it is %s", (_label, index) => {
    expect(isBlanketUnique(index)).toBe(false);
  });
});

describe("a shadow with its replacement in place", () => {
  beforeEach(async () => {
    await givenTheCorrectIndex();
    await givenTheShadow();
  });

  it("drops the blanket one and keeps the partial one", async () => {
    const result = await reapShadowIndexes();

    const names = await indexNames();
    expect(names).not.toContain("invoiceId_1");
    expect(names).toContain("invoiceId_unique_partial");

    const reaped = result.reaped.find((r) => r.collection === COLL);
    expect(reaped).toMatchObject({
      index: "invoiceId_1",
      replacedBy: "invoiceId_unique_partial",
    });
  });

  /**
   * ⚠️ The whole point, in one assertion.
   *
   * A blanket unique on a nullable path rejects the **second** row with no
   * value. Every voucher claim is created before its invoice exists, so this is
   * what "every second claim rejected" actually looks like.
   */
  it("makes a second row with no invoice possible again", async () => {
    await coll().insertOne({ note: "first, no invoiceId" });
    await expect(
      coll().insertOne({ note: "second, no invoiceId" }),
    ).rejects.toMatchObject({ code: 11000 });

    await reapShadowIndexes();

    await expect(
      coll().insertOne({ note: "second, after the reap" }),
    ).resolves.toBeTruthy();
  });

  /** And the uniqueness that was actually wanted still bites. */
  it("still refuses two rows with the same invoice", async () => {
    await reapShadowIndexes();

    await coll().insertOne({ invoiceId: "TD/VCH/26-27/000001" });
    await expect(
      coll().insertOne({ invoiceId: "TD/VCH/26-27/000001" }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("changes nothing on a dry run, and says what it would do", async () => {
    const result = await reapShadowIndexes({ dryRun: true });

    expect(await indexNames()).toContain("invoiceId_1");
    expect(result.reaped).toEqual([]);
    expect(
      result.blocked.find((b) => b.collection === COLL),
    ).toMatchObject({ index: "invoiceId_1", reason: "DRY_RUN" });
  });

  /**
   * ⚠️ Two instances booting together both find it and both try. The second gets
   * `IndexNotFound`, and treating that as an error would page somebody every
   * deploy for a race that resolved itself correctly.
   */
  it("is safe to run twice", async () => {
    await reapShadowIndexes();
    const second = await reapShadowIndexes();

    expect(second.reaped.filter((r) => r.collection === COLL)).toEqual([]);
    expect(second.blocked.filter((b) => b.collection === COLL)).toEqual([]);
  });
});

/**
 * ⚠️ The condition that makes this safe rather than reckless.
 *
 * Dropping the blanket index when no partial replacement exists would leave the
 * field with **no uniqueness at all** — worse than the problem it was fixing.
 * The reaper is not deciding what is correct; it is only removing what has
 * already been superseded.
 */
describe("a blanket unique with no replacement", () => {
  it("is left alone", async () => {
    await givenTheShadow("razorpayOrderId");

    const result = await reapShadowIndexes();

    expect(await indexNames()).toContain("razorpayOrderId_1");
    expect(result.reaped.filter((r) => r.collection === COLL)).toEqual([]);
  });

  it("is left alone even when another field in the same collection has one", async () => {
    await givenTheCorrectIndex("invoiceId");
    await givenTheShadow("razorpayOrderId");

    await reapShadowIndexes();

    expect(await indexNames()).toContain("razorpayOrderId_1");
  });
});

/**
 * ⚠️ Same key, same order. `{a: 1, b: 1}` and `{b: 1, a: 1}` are different
 * indexes to Mongo, and only the identical one is a shadow.
 */
describe("a partial index on a different key", () => {
  it("does not make an unrelated blanket index a shadow", async () => {
    await givenTheCorrectIndex("invoiceId");
    await coll().createIndex(
      { brandId: 1, invoiceId: 1 },
      { name: "brand_invoice_1", unique: true },
    );

    await reapShadowIndexes();

    expect(await indexNames()).toContain("brand_invoice_1");
  });
});

describe("a collection with nothing to guard", () => {
  it("is skipped without reading further", async () => {
    const result = await reapShadowIndexes();

    expect(result.checked).toBe(true);
    expect(result.reaped.filter((r) => r.collection === COLL)).toEqual([]);
  });

  /**
   * The count is what the boot line reports, and it is the honest measure of
   * how much this rule covers — far more than the two names
   * `LEGACY_TRANSACTION_INDEXES` lists.
   */
  it("counts every partial-unique index it is protecting", async () => {
    await givenTheCorrectIndex();

    const result = await reapShadowIndexes();

    expect(result.guarded).toBeGreaterThan(0);
  });
});
