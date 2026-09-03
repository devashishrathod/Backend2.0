const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const PayoutLeg = require("../../models/PayoutLeg");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { generateAndUploadStatement } = require("../../helpers/settlements");

/**
 * Everything the statement prints, gathered from the settlement's own rows.
 *
 * ⚠️ From the **claimed** transactions, never a live query. `settlementId` is
 * stamped on each row at build time, so this is the same set the totals were
 * computed over — a fresh "this brand, this period" query could pick up a row
 * that arrived afterwards and produce a document whose lines do not add up to
 * its own summary.
 */
const assemble = async (settlement) => {
  const [brand, rows, legs] = await Promise.all([
    Brand.findById(settlement.brandId).select("brandName legalBusinessName").lean(),

    Transaction.find({ settlementId: settlement._id, isDeleted: false })
      .select("invoiceId verifiedAt voucher")
      .sort({ verifiedAt: 1 })
      .lean(),

    PayoutLeg.find({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: settlement._id,
      status: PAYOUT_LEG_STATUS.PAID,
      isDeleted: false,
    })
      .sort({ legNumber: 1 })
      .lean(),
  ]);

  return {
    settlementNumber: settlement.settlementNumber || String(settlement._id),
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    cycleType: settlement.cycleType,
    brand: {
      name: brand?.brandName,
      legalName: brand?.legalBusinessName,
    },
    bank: settlement.bankSnapshot || {},
    totals: {
      grossCollected: settlement.grossCollected,
      vendorPromoCost: settlement.vendorPromoCost,
      commissionAmount: settlement.commissionAmount,
      commissionTax: settlement.commissionTax,
      refundAdjustment: settlement.refundAdjustment,
      chargebackAdjustment: settlement.chargebackAdjustment,
      reserveHeld: settlement.reserveHeld,
      reserveReleased: settlement.reserveReleased,
      netPayable: settlement.netPayable,
      transactionCount: settlement.transactionCount,
    },
    lines: rows.map((row) => ({
      date: row.verifiedAt,
      claimCode: row.invoiceId,
      billAmount: row.voucher?.billAmount,
      netBill: row.voucher?.netBill,
      vendorPromoCost: row.voucher?.vendorPromoCost,
      /**
       * ⚠️ The deduction, not the bare commission — with GST on top of the
       * commission the two differ, and the statement has to show what actually
       * came off. Falls back for a claim frozen before the field existed.
       */
      commissionDeduction:
        row.voucher?.commissionDeduction ?? row.voucher?.commissionAmount,
      vendorPayable: row.voucher?.vendorPayable,
    })),
    legs: legs.map((leg) => ({
      legNumber: leg.legNumber,
      amount: leg.amount,
      utr: leg.utr,
      mode: leg.mode,
      paidAt: leg.paidAt,
    })),
    generatedAt: new Date(),
  };
};

/**
 * Resolve a public statement link to a downloadable URL.
 *
 * ### Deliberately unauthenticated, exactly like the invoice link
 *
 * The link goes into a notification and an email, and a vendor opening it from
 * their phone has no session in that browser. Requiring a login there means the
 * Download button does not work, which is the one thing it has to do. A 32-byte
 * random token is the credential, and revoking one is a field update.
 *
 * ⚠️ A missing token and a wrong token get the **same** answer. Telling the
 * holder of a bad token that it almost worked is how a guessing attempt learns
 * it is close.
 *
 * ### Only a `PAID` settlement has a statement
 *
 * Every earlier state can still move: `rebuild` releases tainted rows,
 * `CARRIED_FORWARD` hands them to the next cycle, a bounced payout retries with
 * a new leg. A PDF cached from any of those would be a document stating figures
 * that later changed — and the vendor would have it on file, with our name on it.
 *
 * ### Rendered on first ask, not at payout
 *
 * Most statements are never opened. The **number** is allotted when the
 * settlement is built so the series has no gaps; the document is built the first
 * time somebody wants it, and cached on the settlement afterwards.
 */
exports.getStatementByToken = async (token) => {
  if (!token) throwError(404, "Statement not found.");

  const settlement = await Settlement.findOne({
    statementToken: token,
    isDeleted: false,
  });

  if (!settlement) throwError(404, "Statement not found.");

  if (settlement.status !== SETTLEMENT_STATUS.PAID) {
    throwError(
      409,
      "This statement is not final yet. It becomes available once the payout is confirmed.",
    );
  }

  if (settlement.statementUrl) {
    return {
      url: settlement.statementUrl,
      settlementNumber: settlement.settlementNumber,
    };
  }

  const statementUrl = await generateAndUploadStatement(await assemble(settlement));

  if (!statementUrl) {
    throwError(503, "Could not prepare the statement. Please try again.");
  }

  /**
   * Cached with the token still in the filter: a concurrent request that got
   * there first has already written a perfectly good URL, and overwriting it
   * would orphan the file it points at.
   */
  await Settlement.updateOne(
    { _id: settlement._id, statementUrl: { $in: [null, ""] } },
    { $set: { statementUrl } },
  );

  return { url: statementUrl, settlementNumber: settlement.settlementNumber };
};
