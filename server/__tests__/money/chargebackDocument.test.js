const fs = require("fs");
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Dispute = require("../../models/Dispute");
const Transaction = require("../../models/Transaction");
const Counter = require("../../models/Counter");

const {
  buildChargebackDocumentSnapshot,
  issueChargebackDocument,
} = require("../../helpers/disputes");
const { renderDocumentPdf } = require("../../helpers/documents");
const { getDocumentByToken } = require("../../services/documents");
const {
  DOCUMENT_KIND,
  DOCUMENT_TITLE,
  DOCUMENT_SERIES,
} = require("../../constants/document");
const { DISPUTE_STATUS } = require("../../constants/webhook");
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
};
const BRAND = { brandName: "Cafe Mocha", legalBusinessName: "Mocha Pvt Ltd" };
const BILLING = { gstin: "33ABCDE1234F1Z5", state: "Tamil Nadu", stateCode: "33" };

const disputeFixture = (overrides = {}) => ({
  _id: oid(),
  disputeId: "disp_QxTest0000001",
  status: DISPUTE_STATUS.LOST,
  amount: 2000,
  reason: "Customer does not recognise this transaction",
  reasonCode: "FRAUD_CARD_ABSENT",
  phase: "chargeback",
  openedAt: new Date("2026-09-02T05:00:00Z"),
  respondBy: new Date("2026-09-05T18:30:00Z"),
  resolvedAt: new Date("2026-09-06T10:00:00Z"),
  ...overrides,
});

const transactionFixture = (overrides = {}) => ({
  _id: oid(),
  invoiceId: "TD/VCH/26-27/000001",
  verifiedAt: new Date("2026-08-31T13:12:00Z"),
  paymentMethod: "card",
  invoiceSnapshot: {
    documentNumber: "TD/VCH/26-27/000001",
    isTaxInvoice: false,
    placeOfSupply: "Tamil Nadu (33)",
  },
  voucher: {
    claimCode: "TD-CHUJCD",
    billAmount: 2000,
    netBill: 1600,
    vendorPayable: 1580,
  },
  ...overrides,
});

describe("what a chargeback advice says", () => {
  const build = (overrides = {}) =>
    buildChargebackDocumentSnapshot({
      dispute: disputeFixture(overrides.dispute),
      transaction: transactionFixture(overrides.transaction),
      brand: BRAND,
      billing: BILLING,
      seller: SELLER,
      documentNumber: "TD/DBN/26-27/000007",
      ...overrides,
    });

  /**
   * ⚠️ A lost dispute produced no paper at all. The vendor's next payout simply
   * came out lower, with a "chargebacks recovered" line and nothing behind it.
   */
  it("names itself an advice while the original carried no tax", async () => {
    const snapshot = build();
    expect(snapshot.kind).toBe(DOCUMENT_KIND.CHARGEBACK);
    expect(snapshot.title).toBe(DOCUMENT_TITLE.CHARGEBACK_ADVICE);

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain(DOCUMENT_TITLE.CHARGEBACK_ADVICE);
  });

  /** Under GST a recovery against a tax invoice is a debit note. */
  it("becomes a debit note when the original carried tax", () => {
    const snapshot = build({
      transaction: transactionFixture({
        invoiceSnapshot: {
          documentNumber: "TD/VCH/26-27/000001",
          isTaxInvoice: true,
        },
      }),
    });
    expect(snapshot.title).toBe(DOCUMENT_TITLE.DEBIT_NOTE);
  });

  /**
   * ⚠️ Only the vendor's share is recoverable. The convenience fee and our
   * commission were never theirs, and telling them the whole bill is coming out
   * of their payout would be untrue.
   */
  it("recovers the vendor's share, not the customer's bill", async () => {
    const snapshot = build();
    expect(snapshot.total.amount).toBe(1580);

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain("Recoverable from your payouts");
    expect(text).toContain("1,580.00");
    expect(text).toContain("never yours");
  });

  it("names the sale, the dispute and the bank's reason", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("TD/DBN/26-27/000007");
    // The reference that lets a later deduction be traced back to a sale.
    expect(text).toContain("TD/VCH/26-27/000001");
    expect(text).toContain("TD-CHUJCD");
    expect(text).toContain("disp_QxTest0000001");
    expect(text).toContain("does not recognise");
  });

  it("names the vendor, tagged so it cannot be read as a customer", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain("Cafe Mocha (Vendor)");
  });

  /**
   * "When was the sale, when did the bank raise it, when did we lose" are three
   * different dates, and a vendor checking against their own records needs all
   * three.
   */
  it("records the sale, the dispute and the loss as real instants", () => {
    const snapshot = build();
    const labels = snapshot.timeline.map((entry) => entry.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Payment taken", "Dispute raised", "Lost"]),
    );
    for (const entry of snapshot.timeline) {
      expect(entry.at).toBeInstanceOf(Date);
    }
  });

  /** Nothing has been taken yet — the paper has to be clear about that. */
  it("says the money has not been taken yet", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);
    expect(text).toContain("has not been taken yet");
  });
});

describe("issuing the chargeback advice", () => {
  const COLLECTIONS = [Dispute, Transaction, Counter];

  const seed = async (status = DISPUTE_STATUS.LOST) => {
    const transaction = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: oid(),
      brandId: oid(),
      amount: 2000,
      invoiceId: `TD/VCH/26-27/${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
      razorpayOrderId: `order_CBDOC${Date.now()}${Math.random()}`,
      voucher: { claimCode: "TD-CHUJCD", billAmount: 2000, vendorPayable: 1580 },
    });

    const dispute = await Dispute.create({
      disputeId: `disp_${Date.now()}${Math.floor(Math.random() * 1000)}`,
      transactionId: transaction._id,
      brandId: transaction.brandId,
      status,
      amount: 2000,
      reason: "Customer does not recognise this transaction",
      resolvedAt: new Date(),
    });

    return { transaction, dispute };
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

  it("allots a number in the chargeback series, with a token", async () => {
    const { dispute, transaction } = await seed();

    const issued = await issueChargebackDocument({
      dispute: dispute.toObject(),
      transaction: transaction.toObject(),
    });

    expect(issued.documentNumber).toMatch(
      new RegExp(
        `^TD/${DOCUMENT_SERIES[DOCUMENT_KIND.CHARGEBACK]}/\\d{2}-\\d{2}/\\d{6}$`,
      ),
    );
    expect(issued.documentToken).toHaveLength(64);
    expect(issued.documentSnapshot.kind).toBe(DOCUMENT_KIND.CHARGEBACK);
    expect(issued.documentUrl).toBeFalsy();
  });

  /**
   * ⚠️ Razorpay redelivers dispute webhooks and sends them out of order. A second
   * `lost` must not burn another number out of a GST-facing sequence.
   */
  it("does not allot a second number on redelivery", async () => {
    const { dispute, transaction } = await seed();

    const first = await issueChargebackDocument({
      dispute: dispute.toObject(),
      transaction: transaction.toObject(),
    });
    const again = await issueChargebackDocument({
      dispute: first,
      transaction: transaction.toObject(),
    });

    expect(again).toBeNull();
    const stored = await Dispute.findById(dispute._id).lean();
    expect(stored.documentNumber).toBe(first.documentNumber);
  });

  /**
   * The loss is booked and the recovery is queued. A document that could not be
   * built must not fail a webhook — a failed webhook is one Razorpay stops
   * retrying.
   */
  it("returns null rather than throwing when it cannot issue", async () => {
    await expect(issueChargebackDocument({ dispute: null })).resolves.toBeNull();
    await expect(issueChargebackDocument({})).resolves.toBeNull();
  });

  it("is downloadable through the generic document route", async () => {
    const { dispute, transaction } = await seed();
    const issued = await issueChargebackDocument({
      dispute: dispute.toObject(),
      transaction: transaction.toObject(),
    });

    await Dispute.updateOne(
      { _id: dispute._id },
      { $set: { documentUrl: "https://cdn.example/advice.pdf" } },
    );

    const result = await getDocumentByToken(issued.documentToken);
    expect(result.url).toBe("https://cdn.example/advice.pdf");
    expect(result.kind).toBe(DOCUMENT_KIND.CHARGEBACK);
  });
});
