const fs = require("fs");

const {
  renderDocumentPdf,
  resolveDocumentTitle,
} = require("../../helpers/documents");
const {
  DOCUMENT_KIND,
  DOCUMENT_TITLE,
  DOCUMENT_SERIES,
  RESERVED_DOCUMENT_SERIES,
} = require("../../constants/document");

/**
 * Read the text back out of a rendered PDF.
 *
 * PDFKit writes glyphs as hex runs inside a kerning array —
 * `[<50> 120 <41> 100 <594d454e54...> 0] TJ` — so "PAYMENT RECEIPT" never appears
 * in the file as a plain substring, not even with compression off. Concatenating
 * the hex runs gives back what the page actually says, which is what these tests
 * are about.
 */
const pdfText = (filePath) => {
  const raw = fs.readFileSync(filePath).toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    text += Buffer.from(match[1], "hex").toString("latin1");
  }
  fs.unlinkSync(filePath);
  return text;
};

const render = async (snapshot) => {
  const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
  return pdfText(filePath);
};

describe("resolveDocumentTitle()", () => {
  /**
   * The generic rule the whole design rests on: the document is named after what
   * happened, and the name changes on its own the day GST is switched on. Nothing
   * has to be rewritten for that switch.
   */
  it("names a claim a receipt while GST is off and an invoice once it is on", () => {
    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.VOUCHER_CLAIM,
        isTaxInvoice: false,
      }),
    ).toBe(DOCUMENT_TITLE.PAYMENT_RECEIPT);

    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.VOUCHER_CLAIM,
        isTaxInvoice: true,
      }),
    ).toBe(DOCUMENT_TITLE.TAX_INVOICE);
  });

  it("names a refund a receipt now and a credit note under GST", () => {
    expect(
      resolveDocumentTitle({ kind: DOCUMENT_KIND.REFUND, isTaxInvoice: false }),
    ).toBe(DOCUMENT_TITLE.REFUND_RECEIPT);
    expect(
      resolveDocumentTitle({ kind: DOCUMENT_KIND.REFUND, isTaxInvoice: true }),
    ).toBe(DOCUMENT_TITLE.CREDIT_NOTE);
  });

  it("names a chargeback an advice now and a debit note under GST", () => {
    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.CHARGEBACK,
        isTaxInvoice: false,
      }),
    ).toBe(DOCUMENT_TITLE.CHARGEBACK_ADVICE);
    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.CHARGEBACK,
        isTaxInvoice: true,
      }),
    ).toBe(DOCUMENT_TITLE.DEBIT_NOTE);
  });

  it("marks an admin grant as a grant, not a payment", () => {
    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.SUBSCRIPTION_GRANT,
        isTaxInvoice: false,
      }),
    ).toBe(DOCUMENT_TITLE.GRANT_ADVICE);
  });

  it("keeps a payout statement a statement either way", () => {
    // The tax document inside it is the supplement, and it titles itself.
    expect(
      resolveDocumentTitle({
        kind: DOCUMENT_KIND.PAYOUT_STATEMENT,
        isTaxInvoice: true,
      }),
    ).toBe(DOCUMENT_TITLE.PAYOUT_STATEMENT);
  });

  it("does not throw on an unknown kind", () => {
    expect(resolveDocumentTitle({ kind: "SOMETHING_NEW" })).toBe(
      DOCUMENT_TITLE.PAYMENT_RECEIPT,
    );
    expect(resolveDocumentTitle()).toBe(DOCUMENT_TITLE.PAYMENT_RECEIPT);
  });
});

describe("document series", () => {
  it("gives every kind its own series", () => {
    const series = Object.values(DOCUMENT_SERIES);
    expect(new Set(series).size).toBe(series.length);
  });

  /**
   * The commission Trydood charges a vendor is a taxable supply from us to them.
   * It prints inside the payout statement, but it is a separate document under
   * GST and must be numbered separately.
   */
  it("numbers the commission invoice separately from the payout statement", () => {
    expect(DOCUMENT_SERIES.COMMISSION).not.toBe(
      DOCUMENT_SERIES[DOCUMENT_KIND.PAYOUT_STATEMENT],
    );
  });

  it("reserves every series except the one an admin may change", () => {
    // The customer claim prefix is configurable; nothing else is.
    expect(RESERVED_DOCUMENT_SERIES).not.toContain(
      DOCUMENT_SERIES[DOCUMENT_KIND.VOUCHER_CLAIM],
    );
    expect(RESERVED_DOCUMENT_SERIES).toContain(
      DOCUMENT_SERIES[DOCUMENT_KIND.SUBSCRIPTION],
    );
    expect(RESERVED_DOCUMENT_SERIES).toContain(DOCUMENT_SERIES.COMMISSION);
  });
});

describe("renderDocumentPdf()", () => {
  /** A claim receipt, with the exact rows that came back overlapping. */
  const CLAIM = {
    kind: DOCUMENT_KIND.VOUCHER_CLAIM,
    title: DOCUMENT_TITLE.PAYMENT_RECEIPT,
    subtitle: "Payment collected by Trydood on behalf of Cafe Mocha",
    isTaxInvoice: false,
    documentNumber: "TD/VCH/26-27/000001",
    seller: {
      name: "TRYDOOD RETAIL PRIVATE LIMITED",
      address: "2nd Floor, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
      gstin: "33AAKCT3750H1ZB",
    },
    billTo: { name: "Devashish Rathod (Customer)", contact: "+919876543210" },
    placeOfSupply: "Tamil Nadu (33)",
    meta: [
      { label: "Receipt No", value: "TD/VCH/26-27/000001" },
      { label: "Payment Ref", value: "pay_TWUEvwVOB7iGNT" },
      { label: "Payment Method", value: "netbanking" },
    ],
    details: [
      { value: "Weekend Special - 30% Off" },
      { label: "Offer", value: "Weekend 20% Discount" },
      { label: "Claim Code", value: "TD-CHUJCD" },
    ],
    timeline: [
      { label: "Claimed", at: new Date("2026-08-31T13:11:00.000Z") },
      { label: "Paid", at: new Date("2026-08-31T13:12:00.000Z") },
      { label: "Redeemed", at: new Date("2026-08-31T13:12:00.000Z") },
    ],
    lineItems: [
      { label: "Bill collected on behalf of Cafe Mocha", amount: 2000 },
      {
        label: "Voucher discount (Weekend 20% Discount)",
        amount: 400,
        isDeduction: true,
      },
      { label: "Convenience fee (Trydood)", amount: 20 },
    ],
    total: { label: "You Paid", amount: 1620 },
    notes: [
      "No tax has been charged. The bill amount was collected on behalf of the brand.",
    ],
  };

  it("prints every line item without one swallowing another", async () => {
    const pdf = await render(CLAIM);

    expect(pdf).toContain("Bill collected on behalf of Cafe Mocha");
    expect(pdf).toContain("Voucher discount (Weekend 20% Discount)");
    expect(pdf).toContain("Convenience fee (Trydood)");
    expect(pdf).toContain("You Paid");
    // Every amount, including the two the overlap used to hide.
    expect(pdf).toContain("2,000.00");
    expect(pdf).toContain("400.00");
    expect(pdf).toContain("20.00");
    expect(pdf).toContain("1,620.00");
  });

  /** The bug in the screenshot: `Bill To: -` on every customer receipt. */
  it("names the party rather than printing a dash", async () => {
    const pdf = await render(CLAIM);
    expect(pdf).toContain("Devashish Rathod (Customer)");
    expect(pdf).not.toContain("Bill To\n-");
  });

  it("prints the real event times in IST", async () => {
    const pdf = await render(CLAIM);
    // 13:11 UTC === 18:41 IST on the same day.
    expect(pdf).toContain("31 Aug 2026, 6:41 PM IST");
    expect(pdf).toContain("Claimed");
    expect(pdf).toContain("Redeemed");
  });

  it("uses a WinAnsi-safe currency prefix, never a mangled rupee sign", async () => {
    const pdf = await render(CLAIM);
    expect(pdf).toContain("Rs. ");
    // U+20B9 truncated to its low byte is `¹` — what the payout statement printed.
    expect(pdf).not.toContain("¹");
  });

  /**
   * An untaxed document must not claim a tax treatment it did not apply, and must
   * not print a GST breakup of zeroes.
   */
  it("omits the SAC and the tax block on an untaxed receipt", async () => {
    const pdf = await render(CLAIM);
    expect(pdf).not.toContain("HSN/SAC");
    expect(pdf).not.toContain("CGST");
    expect(pdf).not.toContain("IGST");
  });

  it("prints no plan or validity block on a claim", async () => {
    // The old renderer put a claim through the subscription branch and produced
    // an empty plan name and `Validity: - to -`.
    const pdf = await render(CLAIM);
    expect(pdf).not.toContain("Validity");
    expect(pdf).not.toContain("Original Price");
  });

  it("prints the tax lines and SAC when there is tax", async () => {
    const pdf = await render({
      ...CLAIM,
      title: DOCUMENT_TITLE.TAX_INVOICE,
      isTaxInvoice: true,
      hsnSacCode: "998599",
      taxLines: [
        { label: "CGST @ 9.00%", amount: 1.8 },
        { label: "SGST @ 9.00%", amount: 1.8 },
      ],
    });

    expect(pdf).toContain("TAX INVOICE");
    expect(pdf).toContain("998599");
    expect(pdf).toContain("CGST @ 9.00%");
    expect(pdf).toContain("SGST @ 9.00%");
  });

  it("renders a subscription with its plan, discount and promo lines", async () => {
    const pdf = await render({
      kind: DOCUMENT_KIND.SUBSCRIPTION,
      title: DOCUMENT_TITLE.TAX_INVOICE,
      isTaxInvoice: true,
      documentNumber: "TD/SUB/26-27/000009",
      seller: { name: "TRYDOOD RETAIL PRIVATE LIMITED", gstin: "33AAKCT3750H1ZB" },
      billTo: {
        name: "Cafe Mocha (Vendor)",
        legalName: "Mocha Hospitality Pvt Ltd",
        gstin: "33ABCDE1234F1Z5",
      },
      hsnSacCode: "998315",
      meta: [{ label: "Invoice No", value: "TD/SUB/26-27/000009" }],
      details: [
        { label: "Plan", value: "Pro Plus (Yearly)" },
        { label: "Duration", value: "12 months" },
      ],
      timeline: [
        { label: "Ordered", at: new Date("2026-01-01T05:00:00.000Z") },
        { label: "Paid", at: new Date("2026-01-01T05:02:00.000Z") },
        { label: "Valid until", at: new Date("2026-12-31T18:29:00.000Z") },
      ],
      lineItems: [
        { label: "Original Price", amount: 4999 },
        { label: "Plan discount (10%)", amount: 499.9, isDeduction: true },
        { label: "Promo code (LAUNCH50)", amount: 250, isDeduction: true },
        { label: "Taxable Value", amount: 4249.1 },
      ],
      taxLines: [{ label: "IGST @ 18.00%", amount: 764.84 }],
      total: { label: "Total Payable", amount: 5013.94 },
    });

    expect(pdf).toContain("Cafe Mocha (Vendor)");
    expect(pdf).toContain("Mocha Hospitality Pvt Ltd");
    expect(pdf).toContain("Pro Plus (Yearly)");
    expect(pdf).toContain("Plan discount (10%)");
    expect(pdf).toContain("Promo code (LAUNCH50)");
    expect(pdf).toContain("IGST @ 18.00%");
    expect(pdf).toContain("5,013.94");
  });

  /**
   * One PDF, two documents. The payout statement tells the vendor what reached
   * their bank; the commission invoice inside it is a taxable supply from Trydood
   * to them and carries its own number and its own GST block.
   */
  it("prints the commission tax invoice inside the payout statement", async () => {
    const pdf = await render({
      kind: DOCUMENT_KIND.PAYOUT_STATEMENT,
      title: DOCUMENT_TITLE.PAYOUT_STATEMENT,
      isTaxInvoice: false,
      documentNumber: "TD/STL/26-27/000123",
      seller: { name: "TRYDOOD RETAIL PRIVATE LIMITED" },
      billTo: { name: "Cafe Mocha (Vendor)" },
      meta: [{ label: "Statement", value: "TD/STL/26-27/000123" }],
      lineItems: [
        { label: "Sales collected", amount: 10000 },
        { label: "Less: Trydood commission", amount: 1000, isDeduction: true },
      ],
      total: { label: "Net paid to you", amount: 9000 },
      table: {
        title: "Claims in this period (1)",
        columns: [
          { label: "Date", width: 80 },
          { label: "Claim", width: 140 },
          { label: "Your share", width: 100, align: "right" },
        ],
        rows: [["31/08/2026", "TD-CHUJCD", "Rs. 1,620.00"]],
      },
      supplement: {
        title: "TAX INVOICE (Trydood commission)",
        documentNumber: "TD/CMN/26-27/000045",
        isTaxInvoice: true,
        seller: { gstin: "33AAKCT3750H1ZB" },
        billTo: { gstin: "33ABCDE1234F1Z5" },
        placeOfSupply: "Tamil Nadu (33)",
        hsnSacCode: "998599",
        lineItems: [{ label: "Commission", amount: 1000 }],
        taxLines: [
          { label: "CGST @ 9.00%", amount: 90 },
          { label: "SGST @ 9.00%", amount: 90 },
        ],
        total: { label: "Total", amount: 1180 },
      },
    });

    // Both documents, both numbers, on one piece of paper.
    expect(pdf).toContain("PAYOUT STATEMENT");
    expect(pdf).toContain("TD/STL/26-27/000123");
    expect(pdf).toContain("TAX INVOICE (Trydood commission)");
    expect(pdf).toContain("TD/CMN/26-27/000045");
    expect(pdf).toContain("998599");
    expect(pdf).toContain("1,180.00");
    // And the claims table.
    expect(pdf).toContain("TD-CHUJCD");
  });

  it("renders a refund receipt that points back at what it reverses", async () => {
    const pdf = await render({
      kind: DOCUMENT_KIND.REFUND,
      title: DOCUMENT_TITLE.REFUND_RECEIPT,
      isTaxInvoice: false,
      documentNumber: "TD/REF/26-27/000001",
      seller: { name: "TRYDOOD RETAIL PRIVATE LIMITED" },
      billTo: { name: "+919876543210 (Customer)" },
      meta: [
        { label: "Refund No", value: "TD/REF/26-27/000001" },
        { label: "Against Receipt", value: "TD/VCH/26-27/000001" },
        { label: "UTR", value: "SBIN426900112233" },
      ],
      details: [{ label: "Reason", value: "Outlet closed on arrival" }],
      timeline: [
        { label: "Requested", at: new Date("2026-09-01T04:00:00.000Z") },
        { label: "Approved", at: new Date("2026-09-02T06:00:00.000Z") },
        { label: "Paid", at: new Date("2026-09-03T07:30:00.000Z") },
      ],
      lineItems: [
        { label: "Bill refunded", amount: 1600 },
        { label: "Convenience fee refunded", amount: 20 },
      ],
      total: { label: "Total Refunded", amount: 1620 },
    });

    expect(pdf).toContain("REFUND RECEIPT");
    expect(pdf).toContain("TD/REF/26-27/000001");
    // The original it reverses — a refund with no reference is unreconcilable.
    expect(pdf).toContain("TD/VCH/26-27/000001");
    expect(pdf).toContain("SBIN426900112233");
    expect(pdf).toContain("Total Refunded");
  });

  it("renders a document with only the blocks it was given", async () => {
    // No timeline, no table, no supplement, no tax — nothing empty should appear.
    const pdf = await render({
      kind: DOCUMENT_KIND.CHARGEBACK,
      title: DOCUMENT_TITLE.CHARGEBACK_ADVICE,
      isTaxInvoice: false,
      documentNumber: "TD/DBN/26-27/000007",
      seller: { name: "TRYDOOD RETAIL PRIVATE LIMITED" },
      billTo: { name: "Cafe Mocha (Vendor)" },
      lineItems: [{ label: "Amount recoverable", amount: 1620 }],
      total: { label: "Recoverable", amount: 1620 },
    });

    expect(pdf).toContain("CHARGEBACK ADVICE");
    expect(pdf).not.toContain("Timeline");
    expect(pdf).not.toContain("Description");
  });
});
