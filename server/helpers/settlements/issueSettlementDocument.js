const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const PayoutLeg = require("../../models/PayoutLeg");
const Brand = require("../../models/Brand");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { DOCUMENT_SERIES } = require("../../constants/document");
const { getSubscriptionConfig } = require("../settings");
const { buildBillingDetails } = require("../subscribeds");
const { generateDocumentNumber, alertDocumentFailed } = require("../documents");
const { ADMIN_PATHS } = require("../notifications");
const {
  buildSettlementDocumentSnapshot,
} = require("./buildSettlementDocumentSnapshot");

/**
 * Freeze the vendor's payout statement.
 *
 * ### ⚠️ Called when a settlement becomes `PAID`, and only then
 *
 * Every earlier state can still move: `rebuild` releases tainted rows,
 * `CARRIED_FORWARD` hands them to the next cycle, a bounced payout retries with a
 * new leg. A statement frozen from any of those would state figures that later
 * changed — and the vendor would have it on file with our name on it.
 *
 * `PAID` is the first moment nothing behind it can move.
 *
 * ### The rows come from the settlement, never from a live query
 *
 * `settlementId` is stamped on each transaction at build time, so this reads
 * exactly the set the totals were computed over. A fresh "this brand, this
 * period" query could pick up a row that arrived afterwards and produce a
 * document whose lines do not add up to its own summary.
 *
 * ### Two numbers
 *
 * The statement carries the settlement's own `settlementNumber`. The commission
 * tax invoice printed inside it gets a **separate** number from the `CMN` series
 * — it is a taxable supply from us to the vendor and is its own document under
 * GST — and only when commission was actually charged, so a zero-rate month does
 * not burn a number from a GST-facing sequence.
 *
 * ### Never throws
 *
 * The money has already left our bank. A statement that could not be built is a
 * re-issue problem; it must not fail the transition, undo the payout, or make a
 * retry look unprocessed.
 *
 * @param {object} settlement  the settlement, already PAID
 * @returns {Promise<object|null>} the refreshed settlement, or null if nothing was issued
 */
exports.issueSettlementDocument = async (settlement) => {
  if (!settlement?._id) return null;
  // Already issued — a re-entry into PAID, or a self-heal path running again.
  if (settlement.documentSnapshot?.documentNumber) return null;

  /**
   * Only when commission was actually charged.
   *
   * The rate is zero today, so allotting one regardless would put a number from
   * a GST-facing series against an invoice for a supply that did not happen.
   *
   * Computed outside the `try` because the failure alert reports it: a statement
   * that also lost a commission invoice is a tax-record gap, not just missing
   * paperwork, and the two need telling apart. Reading it from inside the catch
   * would throw a ReferenceError inside the handler whose whole job is to let
   * nothing escape.
   */
  const hasCommission =
    Number(settlement.commissionAmount) > 0 ||
    Number(settlement.commissionTax) > 0;

  try {
    const [brand, rows, legs, seller] = await Promise.all([
      Brand.findById(settlement.brandId),

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

      getSubscriptionConfig(),
    ]);

    // The vendor's tax identity, for the commission invoice's Bill To.
    const billing = brand ? await buildBillingDetails(brand) : {};

    const commissionInvoiceNumber =
      settlement.commissionInvoiceNumber ||
      (hasCommission
        ? await generateDocumentNumber({
            series: DOCUMENT_SERIES.COMMISSION,
            at: settlement.periodEnd,
          })
        : undefined);

    const documentSnapshot = buildSettlementDocumentSnapshot({
      settlement,
      brand: brand || {},
      billing,
      seller,
      rows,
      legs,
      commissionInvoiceNumber,
    });

    // Conditional on the snapshot still being absent, so two racing writers
    // cannot both allot a commission number.
    return await Settlement.findOneAndUpdate(
      { _id: settlement._id, documentSnapshot: { $exists: false } },
      {
        $set: {
          documentSnapshot,
          ...(commissionInvoiceNumber ? { commissionInvoiceNumber } : {}),
        },
      },
      { returnDocument: "after" },
    ).lean();
  } catch (error) {
    /**
     * The payout is done and the vendor has their money, so this must not throw
     * — but a bare `console.error` meant nobody learned.
     *
     * ⚠️ Worse here than anywhere else this pattern appears. The statement can
     * carry the **commission invoice**, and commission is a taxable supply — so
     * a silent failure is not only a vendor without their payout paperwork, it
     * is a GST document that was never issued for a supply that happened. There
     * is no re-issue endpoint for a settlement statement.
     */
    await alertDocumentFailed({
      source: "issueSettlementDocument",
      title: "A payout statement could not be issued",
      body:
        `The settlement is PAID and the vendor has their money, but the statement ` +
        `could not be written. The vendor has no paperwork for the payout` +
        `${hasCommission ? ", and the commission invoice for a taxable supply was not issued either" : ""}.`,
      recordId: settlement._id,
      path: ADMIN_PATHS.settlement(settlement._id),
      lines: [
        ["Settlement", settlement.settlementNumber || String(settlement._id)],
        ["Net paid", String(settlement.netPayable ?? "-")],
        ["Commission charged", hasCommission ? "yes" : "no"],
      ],
      footnote:
        "The payout itself is complete and the ledger is correct — only the statement is missing. Re-issuing it is a manual step.",
      error,
    });
    return null;
  }
};
