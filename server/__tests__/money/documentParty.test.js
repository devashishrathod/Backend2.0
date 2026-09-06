const {
  resolvePartyName,
  resolveCustomerName,
  resolveVendorName,
} = require("../../helpers/documents");
const { DOCUMENT_PARTY } = require("../../constants/document");

/**
 * Who a document says it is addressed to.
 *
 * Every customer receipt ever issued printed `Bill To: -`, because the snapshot
 * builder read `claim.customerSnapshot?.name` and `customerSnapshot` was not a
 * field on the model. These tests pin both halves of the fix: that a party is
 * always named, and that the name says which side of the business it belongs to.
 */

describe("resolveCustomerName()", () => {
  it("uses the name when there is one", () => {
    expect(
      resolveCustomerName({
        fullName: "Devashish Rathod",
        whatsappNumber: "+919876543210",
      }),
    ).toBe("Devashish Rathod (Customer)");
  });

  it("falls back to the WhatsApp number when there is no name", () => {
    expect(
      resolveCustomerName({
        fullName: null,
        whatsappNumber: "+919876543210",
        mobile: "+919000000000",
      }),
    ).toBe("+919876543210 (Customer)");
  });

  it("falls back to the mobile when there is no WhatsApp number either", () => {
    expect(resolveCustomerName({ mobile: "+919000000000" })).toBe(
      "+919000000000 (Customer)",
    );
  });

  /**
   * The one case the old code produced, and the one a document of record must
   * never show. `-` names nobody; the tag at least says who the document is for.
   */
  it("never prints a dash when nothing identifies them", () => {
    expect(resolveCustomerName({})).toBe("Customer");
    expect(resolveCustomerName()).toBe("Customer");
    expect(resolveCustomerName({})).not.toBe("-");
  });

  it("does not print 'Customer (Customer)'", () => {
    expect(resolveCustomerName({ fullName: "   " })).toBe("Customer");
  });

  it("ignores whitespace-only candidates", () => {
    expect(
      resolveCustomerName({ fullName: "  ", whatsappNumber: "+919876543210" }),
    ).toBe("+919876543210 (Customer)");
  });
});

describe("resolveVendorName()", () => {
  it("prefers the trading name", () => {
    expect(
      resolveVendorName({
        brandName: "Cafe Mocha",
        legalBusinessName: "Mocha Hospitality Pvt Ltd",
      }),
    ).toBe("Cafe Mocha (Vendor)");
  });

  it("falls back to the registered name", () => {
    expect(
      resolveVendorName({
        brandName: null,
        legalBusinessName: "Mocha Hospitality Pvt Ltd",
      }),
    ).toBe("Mocha Hospitality Pvt Ltd (Vendor)");
  });

  it("falls back to the number before giving up", () => {
    expect(resolveVendorName({ whatsappNumber: "+919812345678" })).toBe(
      "+919812345678 (Vendor)",
    );
  });

  it("never prints a dash", () => {
    expect(resolveVendorName({})).toBe("Vendor");
  });
});

describe("the tag", () => {
  /**
   * A brand named after a person reads exactly like a customer on paper. The tag
   * is what makes a stack of printed documents sortable without opening the
   * system.
   */
  it("distinguishes a person from a brand with the same name", () => {
    const asCustomer = resolveCustomerName({ fullName: "Ramesh Kumar" });
    const asVendor = resolveVendorName({ brandName: "Ramesh Kumar" });

    expect(asCustomer).toBe("Ramesh Kumar (Customer)");
    expect(asVendor).toBe("Ramesh Kumar (Vendor)");
    expect(asCustomer).not.toBe(asVendor);
  });

  it("is driven by the party constant, not a literal", () => {
    expect(
      resolvePartyName({
        type: DOCUMENT_PARTY.CUSTOMER,
        names: ["Someone"],
      }),
    ).toBe("Someone (Customer)");
    expect(
      resolvePartyName({ type: DOCUMENT_PARTY.VENDOR, names: ["Someone"] }),
    ).toBe("Someone (Vendor)");
  });

  it("degrades to the bare name rather than throwing on an unknown party", () => {
    expect(resolvePartyName({ type: "NOBODY", names: ["Someone"] })).toBe(
      "Someone",
    );
    expect(resolvePartyName()).toBe("");
  });
});
