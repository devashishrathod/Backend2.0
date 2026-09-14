const PromotionalTicker = require("../../models/PromotionalTicker");
const {
  getActiveTickersForCustomer,
} = require("../../services/promotionalTickers/getActiveTickersForCustomer");

/**
 * 🔴 A public endpoint that answered with the whole document.
 *
 * `router.get("/customer/active", getActiveForCustomer)` — no middleware, no
 * token, nothing. And the service was a bare `find(...)`, so every caller got
 * `icon.storage`: the Cloudinary `publicId`, or the S3 `bucket` and `key`.
 * Along with `isDeleted`, `createdBy` and both timestamps.
 *
 * The banner endpoint beside it had whitelisted from the day it was written.
 * This is the same class of miss as the voucher detail leak: two endpoints, one
 * rule, one of them remembering it.
 */

/** A stored ticker, with everything the model really holds. */
const stored = (over = {}) => ({
  _id: "t1",
  title: "flat 30% off on cafes today",
  icon: {
    url: "https://cdn.example.com/tickers/coffee.png",
    storage: {
      provider: "S3",
      publicId: null,
      bucket: "trydood-nonprod-public",
      key: "dev/images/tickers/t1/coffee.png",
    },
  },
  redirect: { type: "CATEGORY", targetId: "cat1", url: null },
  displayOrder: 1,
  startDate: new Date("2026-08-01"),
  endDate: new Date("2026-08-31"),
  isActive: true,
  isDeleted: false,
  createdBy: "admin1",
  updatedBy: "admin2",
  createdAt: new Date("2026-07-28"),
  updatedAt: new Date("2026-07-28"),
  ...over,
});

/**
 * Stand in for `find().sort().select().lean()`.
 *
 * ⚠️ `select` is captured rather than honoured: the rows handed back are the
 * **full** documents on purpose, so the assertions below prove the mapper drops
 * what it should even when the query hands it everything. A mock that applied
 * the projection would make those tests pass on the projection alone.
 */
const findReturns = (rows) => {
  const calls = {};
  jest.spyOn(PromotionalTicker, "find").mockImplementation((filter) => {
    calls.filter = filter;
    return {
      sort(s) {
        calls.sort = s;
        return this;
      },
      select(s) {
        calls.select = s;
        return this;
      },
      lean: () => Promise.resolve(rows),
    };
  });
  return calls;
};

afterEach(() => jest.restoreAllMocks());

describe("🔴 nothing internal reaches a public screen", () => {
  test("storage never ships — not the bucket, key or publicId", async () => {
    findReturns([stored()]);
    const body = JSON.stringify(await getActiveTickersForCustomer());

    expect(body).not.toMatch(/storage/);
    expect(body).not.toMatch(/trydood-nonprod-public/);
    expect(body).not.toMatch(/dev\/images\/tickers/);
  });

  test("the admin's own bookkeeping does not ship either", async () => {
    findReturns([stored()]);
    const [row] = await getActiveTickersForCustomer();

    for (const field of [
      "isDeleted",
      "isActive",
      "createdBy",
      "updatedBy",
      "createdAt",
      "updatedAt",
      "startDate",
      "endDate",
    ]) {
      expect(row).not.toHaveProperty(field);
    }
  });

  test("the payload is exactly the five fields the strip renders", async () => {
    findReturns([stored()]);
    const [row] = await getActiveTickersForCustomer();

    expect(row).toEqual({
      _id: "t1",
      title: "flat 30% off on cafes today",
      icon: "https://cdn.example.com/tickers/coffee.png",
      redirect: { type: "CATEGORY", targetId: "cat1", url: null },
      displayOrder: 1,
    });
  });

  test("⚠️ a field added to the model tomorrow cannot leak by default", async () => {
    // A whitelist, not a blacklist — the whole point. Nothing names this, so
    // nothing carries it.
    findReturns([stored({ internalNote: "do not show anyone" })]);
    const body = JSON.stringify(await getActiveTickersForCustomer());

    expect(body).not.toMatch(/do not show anyone/);
  });
});

describe("the icon is flat, like the banner's url", () => {
  test("a ticker with an icon gives the URL as a string", async () => {
    findReturns([stored()]);
    const [row] = await getActiveTickersForCustomer();

    expect(typeof row.icon).toBe("string");
  });

  test("a ticker with no icon is null, not a crash", async () => {
    findReturns([stored({ icon: undefined })]);
    expect((await getActiveTickersForCustomer())[0].icon).toBeNull();
  });
});

describe("what the strip still needs", () => {
  test("a missing redirect reads as NONE rather than undefined", async () => {
    // A `type` the client cannot match against anything is what the banner
    // endpoint had to fix; this one starts there.
    findReturns([stored({ redirect: undefined })]);
    expect((await getActiveTickersForCustomer())[0].redirect).toEqual({
      type: "NONE",
      targetId: null,
      url: null,
    });
  });

  test("no tickers is an empty list", async () => {
    findReturns([]);
    expect(await getActiveTickersForCustomer()).toEqual([]);
  });

  test("only live tickers are asked for, in display order", async () => {
    const calls = findReturns([]);
    await getActiveTickersForCustomer();

    expect(calls.filter.isActive).toBe(true);
    expect(calls.filter.isDeleted).toBe(false);
    expect(calls.filter.$or).toHaveLength(2);
    expect(calls.sort).toEqual({ displayOrder: 1 });
  });

  test("⚠️ and storage is not even read out of Mongo", async () => {
    // Defence in depth. The mapper is the guard; this is why it has no work.
    const calls = findReturns([]);
    await getActiveTickersForCustomer();

    expect(calls.select).toBe("title icon.url redirect displayOrder");
    expect(calls.select).not.toMatch(/storage/);
  });
});
