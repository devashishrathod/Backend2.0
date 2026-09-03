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

const { renderStatementPdf, transitionSettlement } = require("../../helpers/settlements");
const { getStatementByToken } = require("../../services/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS, PAYOUT_MODE } = require("../../constants/payout");
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

const STATEMENT = {
  settlementNumber: "TD/STL/26-27/000041",
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-01T23:59:59Z"),
  cycleType: "DAILY",
  brand: { name: "Chai Point", legalName: "Chai Point Pvt Ltd" },
  bank: {
    accountHolderName: "Chai Point Pvt Ltd",
    maskedAccountNumber: "********9012",
    accountLast4Digits: "9012",
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
  },
  totals: {
    grossCollected: 1000,
    vendorPromoCost: 50,
    commissionAmount: 100,
    commissionTax: 18,
    refundAdjustment: 30,
    chargebackAdjustment: 0,
    reserveHeld: 0,
    reserveReleased: 0,
    netPayable: 802,
    transactionCount: 2,
  },
  lines: [
    {
      date: new Date("2026-08-01T10:00:00Z"),
      claimCode: "TD/VCH/26-27/000412",
      billAmount: 600,
      netBill: 500,
      vendorPromoCost: 25,
      commissionDeduction: 59,
      vendorPayable: 416,
    },
    {
      date: new Date("2026-08-01T14:00:00Z"),
      claimCode: "TD/VCH/26-27/000455",
      billAmount: 600,
      netBill: 500,
      vendorPromoCost: 25,
      commissionDeduction: 59,
      vendorPayable: 416,
    },
  ],
  legs: [
    {
      legNumber: 1,
      amount: 802,
      utr: "N123456789012345",
      mode: PAYOUT_MODE.NEFT,
      paidAt: new Date("2026-08-04T11:00:00Z"),
    },
  ],
  generatedAt: new Date("2026-08-04T12:00:00Z"),
};

describe("what the statement says", () => {
  let text;

  beforeAll(async () => {
    // `compress: false` leaves the content stream readable.
    const { filePath } = await renderStatementPdf(STATEMENT, { compress: false });
    text = pdfText(filePath);
  });

  it("names the settlement, the brand and the period", () => {
    expect(text).toContain("PAYOUT STATEMENT");
    expect(text).toContain("TD/STL/26-27/000041");
    expect(text).toContain("Chai Point");
  });

  /**
   * ⚠️ The masked number only. A statement is forwarded, screenshotted and
   * pasted into support chats — a full account number printed on it ends up in
   * every one of those places, for ever.
   *
   * ⚠️ Asserted on the **rendered** form rather than on "does not contain these
   * digits". The first version of this test did the latter and failed on a
   * correct statement: the UTR `N123456789012345` happens to contain the account
   * number as a substring. A digit run is not a meaningful thing to search a
   * document for.
   */
  it("shows a masked account, never a full one", () => {
    expect(text).toContain("********9012");
    expect(text).toContain("HDFC0001234");

    // The statement never receives the real number — `bankSnapshot` is frozen
    // masked at payout — so the only way one could appear is a renderer reaching
    // past the snapshot into the account row.
    expect(STATEMENT.bank).not.toHaveProperty("accountNumber");
  });

  /**
   * ⚠️ The whole reason this document exists.
   *
   * A vendor whose ₹1,000 of sales pays out ₹802 will ask why, and the answer has
   * to be **on the paper** — not in an email, not from support. Every deduction
   * is named.
   */
  it("itemises every deduction, not just the total", () => {
    expect(text).toContain("Sales collected");
    expect(text).toContain("your share of promotions");
    expect(text).toContain("Trydood commission");
    expect(text).toContain("GST on commission");
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
    expect(text).toContain("TD/VCH/26-27/000412");
    expect(text).toContain("TD/VCH/26-27/000455");
  });

  /**
   * ⚠️ `platformPromoCost`, `gatewayFee` and `netReceived` sit on the same
   * sub-document as the vendor's own figures and none of them are theirs — they
   * are our margin and our cost. The API decides that once in
   * `buildSettlementReadPipeline`; the paper has to make the same decision
   * rather than printing whatever the row happens to carry.
   */
  it("keeps the platform's own margin off it", () => {
    expect(text).not.toMatch(/platform promo/i);
    expect(text).not.toMatch(/gateway fee/i);
    expect(text).not.toMatch(/net received/i);
  });

  it("still prints the commission line at a zero rate", async () => {
    const zeroRate = {
      ...STATEMENT,
      totals: { ...STATEMENT.totals, commissionAmount: 0, commissionTax: 0 },
    };
    const { filePath } = await renderStatementPdf(zeroRate, { compress: false });
    const zeroText = pdfText(filePath);

    /**
     * The rate is 0 today. Printing the row anyway means the day it is switched
     * on, a vendor comparing two months sees a number move rather than a line
     * appear from nowhere.
     */
    expect(zeroText).toContain("Trydood commission");
    // The tax line is the one that stays hidden while it is zero.
    expect(zeroText).not.toContain("GST on commission");
  });
});

describe("the statement link", () => {
  const COLLECTIONS = [
    Settlement,
    SettlementHistory,
    PayoutLeg,
    Transaction,
    LedgerEntry,
  ];

  const admin = () => ({ _id: oid(), role: ROLES.ADMIN });

  const seedSettlement = async (status) =>
    Settlement.create({
      brandId: oid(),
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-08-01T23:59:59Z"),
      status,
      netPayable: 802,
      idempotencyKey: `STL:${oid()}:${Date.now()}${Math.random()}`,
      settlementNumber: "TD/STL/26-27/000041",
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
    expect(settlement.statementToken).toBeUndefined();

    const { settlement: paid } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PAID,
      actor: admin(),
      reason: "paid",
    });

    expect(paid.statementToken).toEqual(expect.any(String));
    expect(paid.statementToken).toHaveLength(64);
  });

  it("is not handed out before the payout is confirmed", async () => {
    const settlement = await seedSettlement(SETTLEMENT_STATUS.PENDING_APPROVAL);
    await Settlement.updateOne(
      { _id: settlement._id },
      { $set: { statementToken: "a".repeat(64) } },
    );

    await expect(getStatementByToken("a".repeat(64))).rejects.toThrow(
      /not final yet/i,
    );
  });

  /**
   * ⚠️ A missing token and a wrong one get the same answer. Telling the holder
   * of a bad token that it almost worked is how a guessing attempt learns it is
   * close.
   */
  it("answers a wrong token exactly as it answers no token", async () => {
    await expect(getStatementByToken("b".repeat(64))).rejects.toThrow(
      /Statement not found/i,
    );
    await expect(getStatementByToken("")).rejects.toThrow(/Statement not found/i);
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
      { $set: { statementUrl: "https://cdn.example/statement.pdf" } },
    );

    const result = await getStatementByToken(paid.statementToken);

    // No render, no upload — the URL already on the row.
    expect(result.url).toBe("https://cdn.example/statement.pdf");
    expect(result.settlementNumber).toBe("TD/STL/26-27/000041");
  });
});
