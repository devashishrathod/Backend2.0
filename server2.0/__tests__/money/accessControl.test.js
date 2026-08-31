const mongoose = require("mongoose");
const {
  assertTransactionAccess,
  assertClaimAccess,
  buildAccessScopeFilter,
} = require("../../helpers/transactions");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

/**
 * Access control is the one place where a passing test proves the least.
 *
 * A check that lets the right people in is easy; the tests that matter are the
 * ones that prove it keeps the wrong people out — and that it does not quietly
 * hand a vendor our margin or a customer's phone number along the way.
 */

const CUSTOMER = oid();
const BRAND = oid();
const OUTLET = oid();

const row = (overrides = {}) => ({
  _id: oid(),
  customerId: CUSTOMER,
  brandId: BRAND,
  subBrandId: OUTLET,
  ...overrides,
});

const customer = (id = CUSTOMER) => ({ role: ROLES.CUSTOMER, customerId: id });
const vendor = (brandId = BRAND) => ({ role: ROLES.VENDOR, brandId });
const subVendor = (brandId = BRAND, subBrandId = OUTLET) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ role: ROLES.ADMIN });

describe("who may open a payment", () => {
  it("lets the customer who paid", () => {
    const access = assertTransactionAccess(customer(), row());
    expect(access.scope).toBe("OWN");
  });

  it("lets the brand it was paid to", () => {
    const access = assertTransactionAccess(vendor(), row());
    expect(access.scope).toBe("BRAND");
  });

  it("lets an admin", () => {
    expect(assertTransactionAccess(admin(), row()).scope).toBe("ALL");
  });

  it("refuses another customer", () => {
    expect(() => assertTransactionAccess(customer(oid()), row())).toThrow(
      /not authorized/i,
    );
  });

  it("refuses another brand", () => {
    expect(() => assertTransactionAccess(vendor(oid()), row())).toThrow(
      /not authorized/i,
    );
  });

  it("refuses a signed-in caller with no relationship to the row", () => {
    expect(() => assertTransactionAccess({ role: ROLES.VENDOR }, row())).toThrow(
      /not authorized/i,
    );
  });

  it("refuses a guest", () => {
    expect(() => assertTransactionAccess({}, row())).toThrow(/not authorized/i);
  });

  /**
   * `req.customerId` is a populated Customer document, not an id.
   *
   * A comparison against `String(req.customerId)` is `"[object Object]"` and
   * never matches — which would lock every customer out of their own payment.
   */
  it("accepts the populated customer document the request actually carries", () => {
    const asDocument = { role: ROLES.CUSTOMER, customerId: { _id: CUSTOMER, name: "x" } };
    expect(assertTransactionAccess(asDocument, row()).scope).toBe("OWN");
  });
});

describe("a sub-vendor sees their own counter", () => {
  /**
   * ⚠️ `authenticate.js` set nothing at all for SUB_VENDOR. Every gate reading
   * `req.brandId` saw `undefined` and refused them — or matched nothing and
   * returned an empty list, which reads as "no claims today".
   */
  it("is let in through the parent brand", () => {
    const access = assertTransactionAccess(subVendor(), row());
    expect(access.scope).toBe("BRAND");
  });

  it("is refused a payment taken at a different outlet", () => {
    expect(() =>
      assertTransactionAccess(subVendor(BRAND, oid()), row()),
    ).toThrow(/not taken at your outlet/i);
  });

  it("is refused another brand's payment outright", () => {
    expect(() => assertTransactionAccess(subVendor(oid(), OUTLET), row())).toThrow(
      /not authorized/i,
    );
  });
});

describe("what a vendor must never be shown", () => {
  /**
   * Two different disclosures on one document: our MDR is commercial, the
   * customer's phone number is private. Deciding this here rather than at each
   * call site is what stops a listing leaking a field the detail endpoint
   * carefully hides.
   */
  it("hides the platform's costs from the brand", () => {
    const access = assertTransactionAccess(vendor(), row());
    expect(access.canSeePlatformCosts).toBe(false);
    expect(access.canSeeCustomerContact).toBe(false);
  });

  it("hides the platform's costs from the customer too", () => {
    // Their own money — but what Razorpay charged us is not part of what they
    // bought.
    const access = assertTransactionAccess(customer(), row());
    expect(access.canSeePlatformCosts).toBe(false);
    expect(access.canSeeCustomerContact).toBe(true);
  });

  it("shows an admin everything, because reconciliation needs it", () => {
    const access = assertTransactionAccess(admin(), row());
    expect(access.canSeePlatformCosts).toBe(true);
    expect(access.canSeeCustomerContact).toBe(true);
  });
});

describe("claims answer the same way", () => {
  it("lets the customer, the brand and an admin", () => {
    expect(assertClaimAccess(customer(), row()).scope).toBe("OWN");
    expect(assertClaimAccess(vendor(), row()).scope).toBe("BRAND");
    expect(assertClaimAccess(admin(), row()).scope).toBe("ALL");
  });

  it("refuses everyone else", () => {
    expect(() => assertClaimAccess(customer(oid()), row())).toThrow(/not authorized/i);
    expect(() => assertClaimAccess(vendor(oid()), row())).toThrow(/not authorized/i);
    expect(() => assertClaimAccess({}, row())).toThrow(/not authorized/i);
  });

  it("scopes a sub-vendor to their outlet", () => {
    expect(() => assertClaimAccess(subVendor(BRAND, oid()), row())).toThrow(
      /not made at your outlet/i,
    );
  });

  it("is a 404, not a 403, when there is nothing to check", () => {
    // "You may not see this" about a row that does not exist tells a probe that
    // it does.
    expect(() => assertClaimAccess(admin(), null)).toThrow(/not found/i);
  });
});

describe("a listing can never show more than a detail page would open", () => {
  /**
   * Derived from the same rules, and applied as a **filter** rather than a
   * post-filter: filtering after the query makes the pagination count wrong, and
   * a page of ten comes back with three rows.
   */
  it("scopes a customer to their own", () => {
    expect(buildAccessScopeFilter(customer())).toEqual({ customerId: CUSTOMER });
  });

  it("scopes a vendor to their brand", () => {
    expect(buildAccessScopeFilter(vendor())).toEqual({ brandId: BRAND });
  });

  it("scopes a sub-vendor to their outlet, not the whole brand", () => {
    expect(buildAccessScopeFilter(subVendor())).toEqual({
      brandId: BRAND,
      subBrandId: OUTLET,
    });
  });

  it("gives an admin everything", () => {
    expect(buildAccessScopeFilter(admin())).toEqual({});
  });

  /**
   * An empty filter for a non-admin would return **every** row on the platform.
   * Refusing is the only safe answer.
   */
  it("refuses rather than returning an unscoped filter", () => {
    expect(() => buildAccessScopeFilter({ role: ROLES.CUSTOMER })).toThrow(
      /log in/i,
    );
    expect(() => buildAccessScopeFilter({ role: ROLES.VENDOR })).toThrow(
      /no brand is linked/i,
    );
    expect(() => buildAccessScopeFilter({})).toThrow(/not authorized/i);
  });

  it("never returns an empty filter for anyone but an admin", () => {
    for (const actor of [customer(), vendor(), subVendor()]) {
      expect(Object.keys(buildAccessScopeFilter(actor)).length).toBeGreaterThan(0);
    }
  });
});
