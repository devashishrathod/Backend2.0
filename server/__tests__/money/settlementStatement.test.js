const fs = require("fs");
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const Transaction = require("../../models/Transaction");
const LedgerEntry = require("../../models/LedgerEntry");
const Counter = require("../../models/Counter");

const {
  buildSettlementDocumentSnapshot,
  transitionSettlement,
} = require("../../helpers/settlements");
const { renderDocumentPdf } = require("../../helpers/documents");
const { getDocumentByToken } = require("../../services/documents");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_MODE } = require("../../constants/payout");
const { DOCUMENT_SERIES } = require("../../constants/document");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

/**
 * What the page actually says.
 *
 * ⚠️ PDFKit does not write plain text — it writes hex-encoded glyph runs, so a
 * substring search on the raw file finds nothing even when the words are right
 * there. Concatenating the runs gives back the readable content, which is what
 * these assertions are about. Same helper as `voucherInvoice.test.js`.
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

const SETTLEMENT = {
  _id: oid(),
  settlementNumber: "TD/STL/26-27/000041",
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-01T23:59:59Z"),
  paidAt: new Date("2026-08-04T11:00:00Z"),
  cycleType: "DAILY",
  status: SETTLEMENT_STATUS.PAID,
  payoutProvider: "MANUAL_BANK",
  bankSnapshot: {
    accountHolderName: "Chai Point Pvt Ltd",
    maskedAccountNumber: "********9012",
    accountLast4Digits: "9012",
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
  },
  grossCollected: 1000,
  vendorPromoCost: 50,
  commissionAmount: 100,
  commissionTax: 18,
  commissionDeduction: 118,
  refundAdjustment: 30,
  chargebackAdjustment: 0,
  reserveHeld: 0,
  reserveReleased: 0,
  netPayable: 802,
  transactionCount: 2,
};

const BRAND = { brandName: "Chai Point", legalBusinessName: "Chai Point Pvt Ltd" };
const BILLING = {
  gstin: "29ABCDE1234F1Z5",
  address: "MG Road, Bengaluru",
  state: "Karnataka",
  stateCode: "29",
};
const SELLER = {
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress: "Chennai",
  companyState: "Tamil Nadu",
  companyStateCode: "33",
  hsnSacCode: "998599",
};

const ROWS = [
  {
    verifiedAt: new Date("2026-08-01T10:00:00Z"),
    invoiceId: "TD/VCH/26-27/000412",
    voucher: {
      claimCode: "TD-AAA111",
      billAmount: 600,
      netBill: 500,
      vendorPromoCost: 25,
      commissionDeduction: 59,
      vendorPayable: 416,
    },
  },
  {
    verifiedAt: new Date("2026-08-01T14:00:00Z"),
    invoiceId: "TD/VCH/26-27/000455",
    voucher: {
      claimCode: "TD-BBB222",
      billAmount: 600,
      netBill: 500,
      vendorPromoCost: 25,
      commissionDeduction: 59,
      vendorPayable: 416,
    },
  },
];

const LEGS = [
  {
    legNumber: 1,
    amount: 802,
    utr: "N123456789012345",
    mode: PAYOUT_MODE.NEFT,
    paidAt: new Date("2026-08-04T11:00:00Z"),
  },
];

const build = (overrides = {}) =>
  buildSettlementDocumentSnapshot({
    settlement: { ...SETTLEMENT, ...(overrides.settlement || {}) },
    brand: BRAND,
    billing: BILLING,
    seller: SELLER,
    rows: ROWS,
    legs: LEGS,
    commissionInvoiceNumber: "TD/CMN/26-27/000007",
    ...overrides,
  });

describe("what the statement says", () => {
  let text;

  beforeAll(async () => {
    // `compress: false` leaves the content stream readable.
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    text = pdfText(filePath);
  });

  it("names the settlement, the brand and the period", () => {
    expect(text).toContain("PAYOUT STATEMENT");
    expect(text).toContain("TD/STL/26-27/000041");
    expect(text).toContain("Chai Point");
    // The vendor tag, so a brand named after a person is not read as a customer.
    expect(text).toContain("(Vendor)");
  });

  /**
   * ⚠️ The masked number only. A statement is forwarded, screenshotted and pasted
   * into support chats — a full account number printed on it ends up in every one
   * of those places, for ever.
   *
   * ⚠️ Asserted on the **rendered** form rather than on "does not contain these
   * digits". An earlier version did the latter and failed on a correct statement:
   * the UTR `N123456789012345` happens to contain the account number as a
   * substring. A digit run is not a meaningful thing to search a document for.
   */
  it("shows a masked account, never a full one", () => {
    expect(text).toContain("********9012");
    expect(text).toContain("HDFC0001234");
    expect(SETTLEMENT.bankSnapshot).not.toHaveProperty("accountNumber");
  });

  /**
   * ⚠️ The whole reason this document exists.
   *
   * A vendor whose ₹1,000 of sales pays out ₹802 will ask why, and the answer has
   * to be **on the paper** — not in an email, not from support.
   */
  it("itemises every deduction, not just the total", () => {
    expect(text).toContain("Sales collected");
    expect(text).toContain("your share of promotions");
    expect(text).toContain("Trydood commission");
    expect(text).toContain("refunds from earlier periods");
    expect(text).toContain("Net paid to you");
  });

  /**
   * ⚠️ Three days after a vendor says the money never arrived, the UTR is the
   * only thing that can be looked up on a bank statement — so it goes on the
   * paper they already have.
   */
  it("prints the UTR of every transfer", () => {
    expect(text).toContain("N123456789012345");
    expect(text).toContain("NEFT");
  });

  it("lists the claims that made up the payout", () => {
    expect(text).toContain("TD-AAA111");
    expect(text).toContain("TD-BBB222");
  });

  /**
   * ⚠️ `platformPromoCost`, `gatewayFee` and `netReceived` sit on the same
   * sub-document as the vendor's own figures and none of them are theirs — they
   * are our margin and our cost.
   */
  it("keeps the platform's own margin off it", () => {
    expect(text).not.toMatch(/platform promo/i);
    expect(text).not.toMatch(/gateway fee/i);
    expect(text).not.toMatch(/net received/i);
  });

  /**
   * ⚠️ PDFKit's Helvetica is WinAnsi and encodes an unmappable character by
   * truncating its codepoint to the low byte, so `₹` (U+20B9) reached the page as
   * `¹`. This statement printed `¹1,000.00` on every amount for exactly that
   * reason — it passed the screen symbol straight into the PDF.
   */
  it("prints amounts with a WinAnsi-safe currency prefix", () => {
    expect(text).toContain("Rs. ");
    expect(text).not.toContain("¹");
  });
});

/**
 * One PDF, two documents.
 *
 * The statement tells the vendor what reached their bank. The commission Trydood
 * charged them is a **taxable supply from us to them** and is its own document
 * under GST — so it carries its own number, in its own series, with its own
 * GSTINs and its own total.
 */
describe("the commission tax invoice inside it", () => {
  it("prints as a second, separately numbered document", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("TAX INVOICE");
    expect(text).toContain("TD/CMN/26-27/000007");
    // Its own number, never the statement's.
    expect(text).toContain("TD/STL/26-27/000041");
    expect(text).toContain("Platform commission");
  });

  it("carries both GSTINs and the place of supply", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("33AAKCT3750H1ZB");
    expect(text).toContain("29ABCDE1234F1Z5");
    expect(text).toContain("Karnataka");
    expect(text).toContain("998599");
  });

  /**
   * Karnataka buyer, Tamil Nadu supplier — an inter-state supply, so a single
   * IGST line rather than a CGST/SGST pair.
   */
  it("splits the tax by place of supply", async () => {
    const { filePath } = await renderDocumentPdf(build(), { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("IGST @ 18.00%");
    expect(text).not.toContain("CGST");
  });

  it("splits into CGST and SGST within one state", async () => {
    const snapshot = build({
      billing: { ...BILLING, state: "Tamil Nadu", stateCode: "33" },
    });
    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);

    expect(text).toContain("CGST @ 9.00%");
    expect(text).toContain("SGST @ 9.00%");
    expect(text).not.toContain("IGST");
  });

  /**
   * ⚠️ The rate is zero today. Emitting an empty tax invoice would put a GST
   * document in a vendor's hands for a supply that did not happen — and burn a
   * number out of a GST-facing sequence for it.
   */
  it("is omitted entirely when no commission was charged", async () => {
    const snapshot = build({
      settlement: { commissionAmount: 0, commissionTax: 0, commissionDeduction: 0 },
      commissionInvoiceNumber: undefined,
    });

    expect(snapshot.supplement).toBeUndefined();

    const { filePath } = await renderDocumentPdf(snapshot, { compress: false });
    const text = pdfText(filePath);

    // The statement line still prints at zero, so the day commission is switched
    // on a vendor sees a number move rather than a row appear from nowhere.
    expect(text).toContain("Trydood commission");
    expect(text).not.toContain("TAX INVOICE");
  });
});

describe("the statement link", () => {
  const COLLECTIONS = [
    Settlement,
    SettlementHistory,
    PayoutLeg,
    Transaction,
    LedgerEntry,
    Counter,
  ];

  const admin = () => ({ _id: oid(), role: ROLES.ADMIN });

  const seedSettlement = async (status) =>
    Settlement.create({
      brandId: oid(),
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-01T23:59:59Z"),
      status,
      netPayable: 802,
      grossCollected: 1000,
      idempotencyKey: `STL:${oid()}:${Date.now()}${Math.random()}`,
      settlementNumber: `TD/STL/26-27/${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
    });

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

  /**
   * ⚠️ Minted inside `transitionSettlement`, not in `confirmPayout`, because
   * `PAID` is reached from two places — the normal final leg and the self-heal
   * for a confirmation that crashed after its leg was paid. Minting at one of
   * them leaves the other with no downloadable statement, and that gap surfaces
   * only as a vendor asking where their paperwork is.
   */
  it("is minted the moment the settlement is paid", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PROCESSING);
    expect(settlement.documentToken).toBeUndefined();

    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    expect(paid.documentToken).toEqual(expect.any(String));
    expect(paid.documentToken).toHaveLength(64);
  });

  /**
   * ⚠️ Frozen at PAID, not assembled at download.
   *
   * Everything a statement reads can still move before then: a rebuild releases
   * tainted rows, a bounced payout retries with a new leg, a later refund is
   * claimed against the brand. A vendor who opened the same link twice could
   * otherwise get two different documents with our name on them.
   */
  it("freezes the statement when the payout is confirmed", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PROCESSING);
    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    expect(paid.documentSnapshot).toBeTruthy();
    expect(paid.documentSnapshot.documentNumber).toBe(settlement.settlementNumber);
    expect(paid.documentSnapshot.total.amount).toBe(802);
  });

  /**
   * The rate is zero, so no commission invoice and no number burnt from the CMN
   * series for a supply that did not happen.
   */
  it("allots no commission number when no commission was charged", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PROCESSING);
    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    expect(paid.commissionInvoiceNumber).toBeUndefined();
    const burnt = await Counter.findOne({
      _id: new RegExp(`^INVOICE:${DOCUMENT_SERIES.COMMISSION}:`),
    });
    expect(burnt).toBeNull();
  });

  it("allots one, in its own series, when there is commission", async () => {
    const settlement = await Settlement.create({
      brandId: oid(),
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-01T23:59:59Z"),
      status: SETTLEMENT_STATUS.PROCESSING,
      netPayable: 802,
      grossCollected: 1000,
      commissionAmount: 100,
      commissionTax: 18,
      commissionDeduction: 118,
      idempotencyKey: `STL:${oid()}:${Date.now()}${Math.random()}`,
      settlementNumber: "TD/STL/26-27/000099",
    });

    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    expect(paid.commissionInvoiceNumber).toMatch(
      new RegExp(`^TD/${DOCUMENT_SERIES.COMMISSION}/\\d{2}-\\d{2}/\\d{6}$`),
    );
    // Two documents, two numbers, one piece of paper.
    expect(paid.commissionInvoiceNumber).not.toBe(paid.settlementNumber);
    expect(paid.documentSnapshot.supplement.documentNumber).toBe(
      paid.commissionInvoiceNumber,
    );
  });

  it("is not handed out before the payout is confirmed", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PENDING_APPROVAL);
    await Settlement.updateOne(
      { _id: settlement._id },
      { $set: { documentToken: "a".repeat(64) } },
    );

    /**
     * The snapshot is only written at PAID, so an unpaid settlement has nothing
     * to serve — and the resolver says so rather than assembling one from figures
     * that can still change.
     */
    await expect(getDocumentByToken("a".repeat(64))).rejects.toThrow(
      /not ready yet/i,
    );
  });

  /**
   * ⚠️ A missing token and a wrong one get the same answer. Telling the holder of
   * a bad token that it almost worked is how a guessing attempt learns it is
   * close.
   */
  it("answers a wrong token exactly as it answers no token", async () => {
    await expect(getDocumentByToken("b".repeat(64))).rejects.toThrow(
      /Document not found/i,
    );
    await expect(getDocumentByToken("")).rejects.toThrow(/Document not found/i);
  });

  it("hands back the cached file once one exists", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PROCESSING);
    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    await Settlement.updateOne(
      { _id: paid._id },
      { $set: { documentUrl: "https://cdn.example/statement.pdf" } },
    );

    const result = await getDocumentByToken(paid.documentToken);

    // No render, no upload — the URL already on the row.
    expect(result.url).toBe("https://cdn.example/statement.pdf");
    expect(result.documentNumber).toBe(settlement.settlementNumber);
  });
});
