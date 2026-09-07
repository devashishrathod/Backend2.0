const fs = require("fs");
const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const VoucherUsage = require("../../models/VoucherUsage");
const LedgerEntry = require("../../models/LedgerEntry");
const Counter = require("../../models/Counter");

const {
  buildVoucherInvoiceSnapshot,
  settleVoucherClaimPayment,
} = require("../../helpers/voucherClaims");
const { buildInvoiceSnapshot } = require("../../helpers/transactions");
const { renderDocumentPdf } = require("../../helpers/documents");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const {
  DOCUMENT_KIND,
  DOCUMENT_TITLE,
} = require("../../constants/document");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");

const oid = () => new mongoose.Types.ObjectId();

/**
 * Read the text back out of a rendered PDF.
 *
 * PDFKit writes glyphs as hex runs inside a kerning array —
 * `[<50> 120 <41> 100 <594d454e54...> 0] TJ` — so "PAYMENT RECEIPT" never
 * appears in the file as a plain substring, not even with compression off. An
 * earlier version of this suite asserted on the raw bytes and failed on invoices
 * that were rendering perfectly.
 *
 * Concatenating the hex runs gives back what the page actually says, which is
 * what these tests are about.
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

const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerTitle: "20% off above 500",
  offerDiscount: 200,
  netBill: 800,
  promoCode: "WELCOME50",
  promoDiscount: 50,
  vendorPromoCost: 15,
  platformPromoCost: 35,
  convenienceFee: 10,
  isGstEnabled: false,
  gstAmount: 0,
  taxType: null,
  taxOnTop: 0,
  sacCode: null,
  placeOfSupplyState: "Madhya Pradesh",
  totalPayable: 760,
  amountInPaise: 76000,
  youSaved: 250,
  vendorPayable: 785,
};

const TAXED = {
  ...PRICING,
  isGstEnabled: true,
  gstPercentage: 18,
  taxType: "IGST",
  igst: 1.8,
  gstAmount: 1.8,
  taxOnTop: 1.8,
  sacCode: "998599",
  totalPayable: 761.8,
};

const claimFixture = (pricing = PRICING) => ({
  _id: oid(),
  claimCode: "TD-ABC123",
  versionNumber: 3,
  pricing,
  voucherSnapshot: { name: "Luxury Stay Special" },
  brandSnapshot: { name: "postman cafe mocha" },
  outletSnapshot: { storeId: "MOCHA-VN-01", state: "Madhya Pradesh" },
  customerSnapshot: { name: "Devashish Rathod", whatsappNumber: "+919876543210" },
  createdAt: new Date("2026-08-30T09:00:00Z"),
  paidAt: new Date("2026-08-30T09:05:00Z"),
  redeemedAt: new Date("2026-08-30T10:00:00Z"),
});

const txnFixture = () => ({
  _id: oid(),
  invoiceId: "TD/VCH/26-27/000001",
  razorpayPaymentId: "pay_TEST123",
  status: "captured",
  paymentMethod: "upi",
});

const SELLER = {
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress: "Chennai",
  companyStateCode: "33",
  companyState: "Tamil Nadu",
};

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  LedgerEntry,
];

beforeAll(async () => {
  await connectTestDb();
  for (const model of COLLECTIONS) await model.createIndexes();
});

afterAll(async () => {
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
});

describe("a document with no tax does not call itself a tax invoice", () => {
  /**
   * Customer GST is off by default. Printing "TAX INVOICE" on a document
   * carrying zero tax is wrong — and would say we owe tax we did not collect.
   */
  it("is a receipt while GST is off", () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    expect(snapshot.isTaxInvoice).toBe(false);
    expect(snapshot.kind).toBe(DOCUMENT_KIND.VOUCHER_CLAIM);
    // No SAC on a document that states no tax.
    expect(snapshot.hsnSacCode).toBeUndefined();
  });

  it("becomes a tax invoice once GST is on", () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(TAXED),
      seller: SELLER,
    });

    expect(snapshot.isTaxInvoice).toBe(true);
    expect(snapshot.hsnSacCode).toBe("998599");
  });

  /**
   * The decision is frozen, not derived at render time.
   *
   * GST can be switched on between issuing a document and someone downloading
   * it. A document already sent to a customer must not retitle itself.
   */
  it("keeps the title it was issued with", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    // Config changes afterwards — the snapshot does not.
    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(DOCUMENT_TITLE.PAYMENT_RECEIPT);
    expect(pdf).not.toContain(DOCUMENT_TITLE.TAX_INVOICE);
  });

  /**
   * The footer used to read "GST is charged in addition to the plan price",
   * which on a claim is wrong twice over: there is no plan, and no GST was
   * charged.
   */
  it("does not promise tax it did not charge", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });
    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).not.toContain("plan price");
    expect(pdf).toContain("No tax has been charged");
    expect(pdf).toContain("collected on behalf of the brand");
  });

  it("says what the tax applies to once there is any", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(TAXED),
      seller: SELLER,
    });
    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    // Tax is on our fee, never on the restaurant's bill.
    expect(pdf).toContain("convenience fee only");
  });
});

/**
 * ⚠️ A grant is priced **as if it were sold**, so the GST position is on record
 * even when nobody paid. That is right for the books and wrong for the paper: a
 * free grant carried `gstAmount > 0` and printed itself as a TAX INVOICE for
 * ₹764.84 of tax against ₹0.00 collected.
 *
 * Under GST a tax invoice asserts that tax is due on a supply for consideration.
 * A giveaway is not one.
 */
describe("a grant nobody paid for is not a tax invoice", () => {
  const GRANT_PRICING = {
    listPrice: 4999,
    discountPercent: 10,
    discountAmount: 499.9,
    promoDiscount: 0,
    taxableValue: 4249.1,
    gstPercentage: 18,
    taxType: "IGST",
    igst: 764.84,
    gstAmount: 764.84,
    hsnSacCode: "998315",
    totalPayable: 5013.94,
  };

  const grant = ({ paidAmount, isManual = true }) =>
    buildInvoiceSnapshot({
      transaction: {
        _id: oid(),
        paidAmount,
        status: "captured",
        manualPaymentMode: paidAmount > 0 ? "CASH" : "FREE",
        createdAt: new Date("2026-09-01T05:00:00Z"),
        verifiedAt: new Date("2026-09-01T05:00:00Z"),
      },
      subscription: { name: "Pro Plus", type: "YEARLY", durationInYears: 1 },
      pricing: GRANT_PRICING,
      config: { companyName: "Trydood", companyGstin: "33AAKCT3750H1ZB" },
      billing: { brandName: "Cafe Mocha" },
      validity: {
        startDate: new Date("2026-09-01T05:00:00Z"),
        endDate: new Date("2027-08-31T18:29:00Z"),
      },
      isManual,
      documentNumber: "TD/GRT/26-27/000008",
    });

  it("calls a free grant an advice, and prints no tax block", async () => {
    const snapshot = grant({ paidAmount: 0 });

    expect(snapshot.title).toBe(DOCUMENT_TITLE.GRANT_ADVICE);
    expect(snapshot.isTaxInvoice).toBe(false);
    expect(snapshot.taxLines).toEqual([]);
    // An SAC on an untaxed advice states a treatment that was not applied.
    expect(snapshot.hsnSacCode).toBeUndefined();

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(DOCUMENT_TITLE.GRANT_ADVICE);
    expect(pdf).not.toContain(DOCUMENT_TITLE.TAX_INVOICE);
    expect(pdf).not.toContain("IGST");
    expect(pdf).not.toContain("998315");
    expect(pdf).toContain("No payment was collected");
  });

  /**
   * The row is about money, so it has to answer for money. A free grant is
   * stored `CAPTURED` — it is complete, there is nothing to wait for — which
   * made the document print "Paid" against a plan nobody paid for.
   */
  it("does not claim a free grant was paid", () => {
    const snapshot = grant({ paidAmount: 0 });
    const status = snapshot.meta.find((m) => m.label === "Payment Status");

    expect(status.value).toBe("No payment collected");
    expect(snapshot.meta[0].label).toBe("Reference No");
    expect(snapshot.total.label).toBe("Value of this grant");
    expect(snapshot.lineItems.at(-1).label).toBe("Plan value");
  });

  /**
   * Money changed hands, and the supply it was for is the priced one — so a
   * collected grant stays a tax invoice, whether the collection was full or
   * partial.
   */
  it("stays a tax invoice when anything was collected", () => {
    for (const paidAmount of [5013.94, 2000]) {
      const snapshot = grant({ paidAmount });
      expect(snapshot.title).toBe(DOCUMENT_TITLE.TAX_INVOICE);
      expect(snapshot.isTaxInvoice).toBe(true);
      expect(snapshot.taxLines).toHaveLength(1);
      expect(snapshot.total.label).toBe("Total Payable");
    }
  });

  /** A paid subscription is untouched by any of this. */
  it("leaves an ordinary paid subscription alone", () => {
    const snapshot = grant({ paidAmount: 5013.94, isManual: false });
    expect(snapshot.title).toBe(DOCUMENT_TITLE.TAX_INVOICE);
    expect(snapshot.hsnSacCode).toBe("998315");
    expect(snapshot.total.label).toBe("Total Payable");
  });
});

describe("the receipt names the customer who paid", () => {
  /**
   * ⚠️ Every customer receipt ever issued printed `Bill To: -`.
   *
   * The builder read `claim.customerSnapshot?.name`, and `customerSnapshot` was
   * not a field on `VoucherClaim` — the model had `offerSnapshot`,
   * `voucherSnapshot`, `brandSnapshot` and `outletSnapshot` and nothing else. So
   * the read was `undefined` on every claim, and the one line naming the person
   * who paid was a dash.
   */
  it("prints the name, tagged so it cannot be read as a vendor", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    expect(snapshot.billTo.name).toBe("Devashish Rathod (Customer)");

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);
    expect(pdf).toContain("Devashish Rathod (Customer)");
  });

  /**
   * `Customer.fullName` is not required — somebody can pay before they have ever
   * set a name. A document of record must still name a party.
   */
  it("falls back to the number rather than printing a dash", () => {
    const claim = claimFixture();
    claim.customerSnapshot = { whatsappNumber: "+919876543210" };

    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim,
      seller: SELLER,
    });

    expect(snapshot.billTo.name).toBe("+919876543210 (Customer)");
    expect(snapshot.billTo.name).not.toBe("-");
  });

  it("still names them when nothing at all is known", () => {
    const claim = claimFixture();
    delete claim.customerSnapshot;

    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim,
      seller: SELLER,
    });

    expect(snapshot.billTo.name).toBe("Customer");
  });

  /**
   * The three instants a customer actually asks about, kept as real dates so they
   * render in IST and read the same in two years on any server.
   */
  it("records when it was claimed, paid and redeemed", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    const labels = snapshot.timeline.map((entry) => entry.label);
    expect(labels).toEqual(["Claimed", "Paid", "Redeemed"]);
    for (const entry of snapshot.timeline) {
      expect(entry.at).toBeInstanceOf(Date);
    }

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);
    // 09:00 UTC === 14:30 IST, 10:00 UTC === 3:30 PM IST.
    expect(pdf).toContain("30 Aug 2026, 2:30 PM IST");
    expect(pdf).toContain("30 Aug 2026, 3:30 PM IST");
  });
});

describe("the invoice says who actually sold the meal", () => {
  /**
   * Trydood did not sell the food — the vendor did, and we collected for them.
   * An invoice that reads as though we sold it says we owe tax on ₹1,000 of
   * restaurant revenue.
   */
  it("names the brand on the collection line", () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    expect(snapshot.lineItems[0].label).toBe(
      "Bill collected on behalf of postman cafe mocha",
    );
    expect(snapshot.lineItems[0].amount).toBe(1000);
  });

  it("marks the convenience fee as our own supply", () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    const fee = snapshot.lineItems.find((i) => i.label.includes("Convenience"));
    // The only line any tax on this document relates to.
    expect(fee.label).toBe("Convenience fee (Trydood)");
    expect(fee.amount).toBe(10);
  });

  it("omits rows that would print as zero", () => {
    const noPromo = { ...PRICING, promoCode: null, promoDiscount: 0 };
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(noPromo),
      seller: SELLER,
    });

    expect(snapshot.lineItems.some((i) => i.label.includes("Promo"))).toBe(false);
    // Bill, offer discount, fee.
    expect(snapshot.lineItems).toHaveLength(3);
  });

  it("marks deductions so the renderer does not read the label", () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    const offer = snapshot.lineItems.find((i) => i.label.includes("Voucher discount"));
    expect(offer.isDeduction).toBe(true);
    expect(offer.amount).toBe(200);
  });
});

describe("one renderer, two very different documents", () => {
  it("prints the claim block, not a plan and a validity range", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain("Luxury Stay Special");
    expect(pdf).toContain("TD-ABC123");
    expect(pdf).toContain("MOCHA-VN-01");
    // Run through the subscription layout, a claim prints an empty plan name and
    // `Validity: - to -`. Neither belongs on it.
    expect(pdf).not.toContain("Validity:");
    expect(pdf).not.toContain("Original Price");
    // ...and no zero tax rows.
    expect(pdf).not.toContain("IGST");
    expect(pdf).not.toContain("CGST");
  });

  /**
   * The other half of the same renderer.
   *
   * Built through the real subscription builder rather than a hand-written
   * snapshot, so this fails if the two builders ever stop agreeing on the block
   * shape the single renderer reads.
   */
  it("renders a subscription through the same renderer", async () => {
    const snapshot = buildInvoiceSnapshot({
      transaction: {
        _id: oid(),
        status: "captured",
        paymentMethod: "card",
        createdAt: new Date("2026-01-01T05:00:00Z"),
        verifiedAt: new Date("2026-01-01T05:02:00Z"),
      },
      subscription: {
        name: "Pro Plus",
        type: "YEARLY",
        durationInYears: 1,
      },
      pricing: {
        listPrice: 4999,
        discountPercent: 0,
        discountAmount: 0,
        promoDiscount: 0,
        taxableValue: 4999,
        gstPercentage: 18,
        taxType: "IGST",
        igst: 899.82,
        gstAmount: 899.82,
        hsnSacCode: "998315",
        totalPayable: 5898.82,
      },
      config: { companyName: "Trydood" },
      billing: { brandName: "A Brand" },
      validity: {
        startDate: new Date("2026-01-01T05:02:00Z"),
        endDate: new Date("2026-12-31T18:29:00Z"),
      },
    });

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(DOCUMENT_TITLE.TAX_INVOICE);
    expect(pdf).toContain("Original Price");
    expect(pdf).toContain("Pro Plus");
    expect(pdf).toContain("IGST");
    expect(pdf).toContain("Total Payable");
    expect(pdf).toContain("998315");
    // The vendor tag, so a brand named after a person is not read as a customer.
    expect(pdf).toContain("A Brand (Vendor)");
    // Real dates, in IST, instead of the `Validity: - to -` the old layout gave
    // any snapshot that could not reach the Subscribed record.
    expect(pdf).toContain("Plan ends");
    expect(pdf).not.toContain("- to -");
  });

  it("prints tax rows on a claim once GST is on", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(TAXED),
      seller: SELLER,
    });

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(DOCUMENT_TITLE.TAX_INVOICE);
    expect(pdf).toContain("IGST");
    expect(pdf).toContain("998599");
  });
});

describe("the number is allotted at settle, the PDF is not", () => {
  const capturedPayment = () => ({
    id: `pay_TEST${Date.now()}`,
    captured: true,
    status: "captured",
    amount: 76000,
    fee: 1794,
    tax: 274,
    method: "upi",
  });

  const seed = async () => {
    const brandId = oid();
    const customerId = oid();
    const transaction = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId,
      brandId,
      amount: PRICING.totalPayable,
      verified: false,
      razorpayOrderId: `order_TEST${Date.now()}`,
      gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    });
    const claim = await VoucherClaim.create({
      customerId,
      voucherId: oid(),
      voucherVersionId: oid(),
      versionNumber: 3,
      brandId,
      subBrandId: oid(),
      billAmount: PRICING.billAmount,
      pricing: PRICING,
      transactionId: transaction._id,
      status: VOUCHER_CLAIM_STATUS.PENDING,
      claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      voucherSnapshot: { name: "Luxury Stay Special" },
      brandSnapshot: { name: "postman cafe mocha" },
      outletSnapshot: { storeId: "MOCHA-VN-01" },
    });
    return { transaction, claim };
  };

  it("freezes a snapshot and a number, but renders nothing", async () => {
    const { transaction } = await seed();
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const settled = await Transaction.findById(transaction._id);
    expect(settled.invoiceId).toMatch(/^TD\/VCH\/\d{2}-\d{2}\/\d{6}$/);
    expect(settled.invoiceSnapshot).toBeTruthy();
    expect(settled.invoiceSnapshot.kind).toBe(DOCUMENT_KIND.VOUCHER_CLAIM);
    // Rendering one per claim does not survive scale, and most are never opened.
    expect(settled.invoiceUrl).toBeFalsy();
    // The token the public link is addressed by.
    expect(settled.documentToken).toHaveLength(64);
    expect(settled.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);
  });

  /**
   * A resume must not burn a second number.
   *
   * An invoice series has to have no gaps, and allotting one on every resume
   * would leave holes wherever a settle was retried.
   */
  it("does not allot a second number on resume", async () => {
    const { transaction } = await seed();
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });
    const first = await Transaction.findById(transaction._id);

    await settleVoucherClaimPayment({
      transaction: first,
      payment: capturedPayment(),
      resume: true,
    });

    const after = await Transaction.findById(transaction._id);
    expect(after.invoiceId).toBe(first.invoiceId);
    expect(after.documentToken).toBe(first.documentToken);
  });

  it("numbers two claims in sequence with no gap", async () => {
    const a = await seed();
    await settleVoucherClaimPayment({
      transaction: a.transaction,
      payment: capturedPayment(),
    });
    const b = await seed();
    await settleVoucherClaimPayment({
      transaction: b.transaction,
      payment: capturedPayment(),
    });

    const [one, two] = await Promise.all([
      Transaction.findById(a.transaction._id),
      Transaction.findById(b.transaction._id),
    ]);
    const seq = (id) => Number(id.split("/").pop());
    expect(seq(two.invoiceId) - seq(one.invoiceId)).toBe(1);
  });

  it("gives each claim its own token", async () => {
    const a = await seed();
    const b = await seed();
    await settleVoucherClaimPayment({ transaction: a.transaction, payment: capturedPayment() });
    await settleVoucherClaimPayment({ transaction: b.transaction, payment: capturedPayment() });

    const [one, two] = await Promise.all([
      Transaction.findById(a.transaction._id),
      Transaction.findById(b.transaction._id),
    ]);
    expect(one.documentToken).not.toBe(two.documentToken);
  });
});
