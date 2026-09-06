const fs = require("fs");
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const Counter = require("../../models/Counter");

const {
  buildRefundDocumentSnapshot,
  issueRefundDocument,
} = require("../../helpers/refunds");
const { renderDocumentPdf } = require("../../helpers/documents");
const { getDocumentByToken } = require("../../services/documents");
const {
  DOCUMENT_KIND,
  DOCUMENT_TITLE,
  DOCUMENT_SERIES,
} = require("../../constants/document");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { REFUND_METHODS } = require("../../constants/customer");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();

const pdfText = (filePath) => {
  const raw = fs.readFileSync(filePath).toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    text += Buffer.from(match[1], "hex").toString("latin1");
  }
  fs.unlinkSync(filePath);
  return text;
};

const SELLER = {
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress: "Chennai",
};

const claimFixture = () => ({
  _id: oid(),
  claimCode: "TD-ABC123",
  paidAt: new Date("2026-08-30T09:05:00Z"),
  voucherSnapshot: { name: "Luxury Stay Special" },
  brandSnapshot: { name: "cafe mocha" },
  outletSnapshot: { storeId: "MOCHA-VN-01" },
  customerSnapshot: {
    name: "Devashish Rathod",
    whatsappNumber: "+919876543210",
  },
  pricing: { isGstEnabled: false, gstAmount: 0 },
});

const transactionFixture = () => ({
  _id: oid(),
  invoiceId: "TD/VCH/26-27/000001",
  invoiceSnapshot: {
    documentNumber: "TD/VCH/26-27/000001",
    isTaxInvoice: false,
    placeOfSupply: "Tamil Nadu (33)",
  },
});

const requestFixture = (overrides = {}) => ({
  _id: oid(),
  claimCode: "TD-ABC123",
  reason: REFUND_REASON.OUTLET_CLOSED,
  method: REFUND_METHODS.SOURCE,
  status: REFUND_REQUEST_STATUS.COMPLETED,
  createdAt: new Date("2026-09-01T04:00:00Z"),
  adminDecisionAt: new Date("2026-09-02T06:00:00Z"),
  completedAt: new Date("2026-09-03T07:30:00Z"),
  utr: "SBIN426900112233",
  split: {
    totalRefund: 1620,
    netBillRefund: 1600,
    convenienceFeeRefund: 20,
    taxRefund: 0,
    isFullRefund: true,
  },
  ...overrides,
});

describe("what a refund document says", () => {
  const build = (overrides = {}) =>
    buildRefundDocumentSnapshot({
      refundRequest: requestFixture(overrides.refundRequest),
      claim: claimFixture(),
      transaction: transactionFixture(),
      seller: SELLER,
      documentNumber: "TD/REF/26-27/000001",
      ...overrides,
    });

  /**
   * ⚠️ A refund produced no paper at all. The customer got a notification saying
   * money was on its way and nothing they could keep, file or show their bank —
   * while the payment that created the claim had a full receipt.
   */
  it("names itself a refund receipt while there was no tax", async () => {
    const snapshot = build();
    expect(snapshot.kind).toBe(DOCUMENT_KIND.REFUND);
    expect(snapshot.title).toBe(DOCUMENT_TITLE.REFUND_RECEIPT);

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain(DOCUMENT_TITLE.REFUND_RECEIPT);
    expect(text).not.toContain(DOCUMENT_TITLE.CREDIT_NOTE);
  });

  /**
   * Under GST a refund against a tax invoice is a credit note. The same code
   * produces both — read off what the **original** actually charged, not off
   * today's config, so a refund of a pre-GST payment stays a receipt.
   */
  it("becomes a credit note when the original carried tax", () => {
    const snapshot = build({
      transaction: {
        ...transactionFixture(),
        invoiceSnapshot: {
          documentNumber: "TD/VCH/26-27/000001",
          isTaxInvoice: true,
          hsnSacCode: "998599",
        },
      },
    });

    expect(snapshot.title).toBe(DOCUMENT_TITLE.CREDIT_NOTE);
    expect(snapshot.isTaxInvoice).toBe(true);
    expect(snapshot.hsnSacCode).toBe("998599");
  });

  /**
   * ⚠️ A credit note with no reference to the document it reverses cannot be
   * reconciled by anybody — not the customer, not an accountant, not us.
   */
  it("names the original it reverses", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("TD/REF/26-27/000001");
    expect(text).toContain("TD/VCH/26-27/000001");
    expect(text).toContain("TD-ABC123");
  });

  /**
   * Three days after a customer says the money never arrived, the UTR is the only
   * thing their bank can look up.
   */
  it("prints the bank reference and the reason", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("SBIN426900112233");
    expect(text).toContain("The outlet was closed");
  });

  it("names the customer, tagged so it cannot be read as a vendor", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain("Devashish Rathod (Customer)");
  });

  /**
   * "Why is my refund ₹1,600 and not ₹1,620" is the whole reason this document
   * exists, so every part is named separately.
   */
  it("itemises what came back", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("Bill refunded");
    expect(text).toContain("Convenience fee refunded");
    expect(text).toContain("Total Refunded");
    expect(text).toContain("1,620.00");
  });

  /**
   * On a partial the convenience fee is not returned, and the paper has to say so
   * rather than leave the customer to work it out.
   */
  it("says plainly when a partial refund kept the fee", async () => {
    const snapshot = build({
      refundRequest: {
        split: {
          totalRefund: 800,
          netBillRefund: 800,
          convenienceFeeRefund: 0,
          isFullRefund: false,
        },
      },
    });
    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("partial refund");
    expect(text).not.toContain("Convenience fee refunded");
  });

  it("records when it was requested, approved and paid", () => {
    const snapshot = build();
    const labels = snapshot.timeline.map((entry) => entry.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Refund requested", "Approved", "Refunded"]),
    );
    for (const entry of snapshot.timeline) {
      expect(entry.at).toBeInstanceOf(Date);
    }
  });
});

describe("issuing the refund document", () => {
  const COLLECTIONS = [RefundRequest, Transaction, VoucherClaim, Counter];

  const seed = async (overrides = {}) => {
    const transaction = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: oid(),
      brandId: oid(),
      amount: 1620,
      invoiceId: `TD/VCH/26-27/${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      razorpayOrderId: `order_REFDOC${Date.now()}${Math.random()}`,
    });

    const claim = await VoucherClaim.create({
      customerId: transaction.customerId,
      voucherId: oid(),
      voucherVersionId: oid(),
      brandId: transaction.brandId,
      subBrandId: oid(),
      billAmount: 2000,
      pricing: {
        billAmount: 2000,
        netBill: 1600,
        convenienceFee: 20,
        totalPayable: 1620,
        isGstEnabled: false,
        gstAmount: 0,
      },
      transactionId: transaction._id,
      claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerSnapshot: { name: "Devashish Rathod" },
      brandSnapshot: { name: "cafe mocha" },
    });

    const request = await RefundRequest.create({
      claimId: claim._id,
      transactionId: transaction._id,
      customerId: transaction.customerId,
      brandId: transaction.brandId,
      claimCode: claim.claimCode,
      requestedAmount: 1620,
      reason: REFUND_REASON.OUTLET_CLOSED,
      method: REFUND_METHODS.SOURCE,
      status: REFUND_REQUEST_STATUS.COMPLETED,
      completedAt: new Date(),
      split: { totalRefund: 1620, netBillRefund: 1600, convenienceFeeRefund: 20 },
      ...overrides,
    });

    return { transaction, claim, request };
  };

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

  it("allots a number in the refund series, with a token", async () => {
    const { request, claim, transaction } = await seed();

    const issued = await issueRefundDocument({
      refundRequest: request.toObject(),
      claim: claim.toObject(),
      transaction: transaction.toObject(),
      utr: "SBIN426900112233",
    });

    expect(issued.documentNumber).toMatch(
      new RegExp(`^TD/${DOCUMENT_SERIES[DOCUMENT_KIND.REFUND]}/\\d{2}-\\d{2}/\\d{6}$`),
    );
    expect(issued.documentToken).toHaveLength(64);
    expect(issued.documentSnapshot.kind).toBe(DOCUMENT_KIND.REFUND);
    // Rendering one per refund does not survive scale; the PDF is built on the
    // first download.
    expect(issued.documentUrl).toBeFalsy();
  });

  /**
   * ⚠️ Razorpay redelivers `refund.processed`, and `applyRefundCompletion` also
   * runs a repair path. A second number would leave a hole in a document-of-record
   * series — the exact thing issuing-at-completion protects.
   */
  it("does not allot a second number on redelivery", async () => {
    const { request, claim, transaction } = await seed();

    const first = await issueRefundDocument({
      refundRequest: request.toObject(),
      claim: claim.toObject(),
      transaction: transaction.toObject(),
    });

    const again = await issueRefundDocument({
      refundRequest: first,
      claim: claim.toObject(),
      transaction: transaction.toObject(),
    });

    expect(again).toBeNull();

    const stored = await RefundRequest.findById(request._id).lean();
    expect(stored.documentNumber).toBe(first.documentNumber);
  });

  /**
   * The money has already reached the customer. A document that could not be
   * built is a re-issue problem — it must not fail the completion or make a
   * redelivered webhook look unprocessed.
   */
  it("returns null rather than throwing when it cannot issue", async () => {
    await expect(
      issueRefundDocument({ refundRequest: null }),
    ).resolves.toBeNull();
    await expect(issueRefundDocument({})).resolves.toBeNull();
  });

  it("is downloadable through the generic document route", async () => {
    const { request, claim, transaction } = await seed();
    const issued = await issueRefundDocument({
      refundRequest: request.toObject(),
      claim: claim.toObject(),
      transaction: transaction.toObject(),
    });

    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { documentUrl: "https://cdn.example/refund.pdf" } },
    );

    const result = await getDocumentByToken(issued.documentToken);
    expect(result.url).toBe("https://cdn.example/refund.pdf");
    expect(result.documentNumber).toBe(issued.documentNumber);
    expect(result.kind).toBe(DOCUMENT_KIND.REFUND);
  });
});
