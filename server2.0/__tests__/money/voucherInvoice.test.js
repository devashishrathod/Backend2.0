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
const { renderInvoicePdf } = require("../../helpers/transactions");
const {
  INVOICE_KIND,
  INVOICE_TITLE,
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
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
    expect(snapshot.kind).toBe(INVOICE_KIND.VOUCHER_CLAIM);
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
    const { filePath } = await renderInvoicePdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(INVOICE_TITLE.RECEIPT);
    expect(pdf).not.toContain(INVOICE_TITLE.TAX_INVOICE);
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
    const { filePath } = await renderInvoicePdf(snapshot, { compress: false });
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
    const { filePath } = await renderInvoicePdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    // Tax is on our fee, never on the restaurant's bill.
    expect(pdf).toContain("convenience fee only");
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

describe("the renderer branches, and the subscription layout is untouched", () => {
  it("prints the claim block, not a plan and a validity range", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(),
      seller: SELLER,
    });

    const { filePath } = await renderInvoicePdf(snapshot, { compress: false });
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

  it("still renders a subscription invoice exactly as before", async () => {
    // No `kind` at all — an invoice issued before this branch existed.
    const legacy = {
      invoiceId: "TD/SUB/26-27/000009",
      issuedAt: new Date(),
      planName: "Pro Plus",
      planType: "YEARLY",
      durationLabel: "12 months",
      planStart: new Date("2026-01-01"),
      planEnd: new Date("2026-12-31"),
      hsnSacCode: "998315",
      seller: { name: "Trydood" },
      billTo: { name: "A Brand" },
      pricing: {
        listPrice: 4999,
        discountAmount: 0,
        promoDiscount: 0,
        taxableValue: 4999,
        gstPercentage: 18,
        taxType: "IGST",
        igst: 899.82,
        totalPayable: 5898.82,
      },
    };

    const { filePath } = await renderInvoicePdf(legacy, { compress: false });
    const pdf = pdfText(filePath);

    // Everything the subscription layout has always printed.
    expect(pdf).toContain(INVOICE_TITLE.TAX_INVOICE);
    expect(pdf).toContain("Original Price");
    expect(pdf).toContain("Validity:");
    expect(pdf).toContain("Pro Plus");
    expect(pdf).toContain("IGST");
    expect(pdf).toContain("Total Payable");
  });

  it("prints tax rows on a claim once GST is on", async () => {
    const snapshot = buildVoucherInvoiceSnapshot({
      transaction: txnFixture(),
      claim: claimFixture(TAXED),
      seller: SELLER,
    });

    const { filePath } = await renderInvoicePdf(snapshot, { compress: false });
    const pdf = pdfText(filePath);

    expect(pdf).toContain(INVOICE_TITLE.TAX_INVOICE);
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
    expect(settled.invoiceSnapshot.kind).toBe(INVOICE_KIND.VOUCHER_CLAIM);
    // Rendering one per claim does not survive scale, and most are never opened.
    expect(settled.invoiceUrl).toBeFalsy();
    // The token the public link is addressed by.
    expect(settled.invoiceToken).toHaveLength(64);
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
    expect(after.invoiceToken).toBe(first.invoiceToken);
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
    expect(one.invoiceToken).not.toBe(two.invoiceToken);
  });
});
