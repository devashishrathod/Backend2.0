const { recordLedgerEntry } = require("./recordLedgerEntry");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");

/**
 * Book the money a payout leg actually moved.
 *
 * ### Why this is booked on the **leg**, not the settlement
 *
 * A settlement can pay in several legs: a large MANUAL_BANK transfer split
 * across two NEFTs, or a retry after a bounce. Each leg moves its own money at
 * its own moment, and each has its own UTR. Booking one `PAYOUT` per settlement
 * would either understate a split payout or refuse the second leg's entry
 * outright — and the money would still have left.
 *
 * `ledger_type_payoutleg_unique` makes each leg's entry idempotent on its own,
 * so a retried confirmation books nothing twice.
 *
 * ### What a payout does and does not include
 *
 * `PAYOUT` debits `VENDOR_PAYABLE` by the amount that actually left. It is
 * **not** the settlement's `netPayable` unless the leg carried all of it —
 * writing the settlement figure on a part-payment is how a ledger ends up
 * claiming money went out that is still sitting in our account.
 *
 * A reserve, when one is held, is a separate entry: the vendor is owed it, we
 * are simply not paying it yet. Debiting it as part of the payout would say we
 * had handed it over.
 *
 * @param {object} args
 * @param {object}  args.leg         the `PayoutLeg` that was just paid
 * @param {object}  args.settlement  the settlement it belongs to
 * @param {boolean} [args.isFinalLeg] this leg completed the settlement — the
 *   caller knows, because it is the one that totalled the legs
 */
exports.postPayoutEntries = async ({ leg, settlement, isFinalLeg = false }) => {
  if (!leg?._id || !(leg.amount > 0)) {
    return { posted: 0, duplicates: 0, entries: [] };
  }

  const common = {
    payoutLegId: leg._id,
    settlementId: settlement?._id,
    brandId: leg.brandId || settlement?.brandId,
    /**
     * Dated when the money left, not when the confirmation was typed in. An
     * admin entering Friday's UTR on Monday must not move the entry into the
     * following week's reporting.
     */
    occurredAt: leg.paidAt || leg.initiatedAt || new Date(),
    reason: `Settlement ${settlement?.settlementNumber || settlement?._id} leg ${leg.legNumber}`,
  };

  const label =
    settlement?.settlementNumber || settlement?._id || "settlement";

  const plan = [
    {
      entryType: LEDGER_ENTRY_TYPE.PAYOUT,
      // What this leg carried, never the settlement's total.
      amount: leg.amount,
      narration: `Payout for ${label} — leg ${leg.legNumber}${leg.utr ? `, UTR ${leg.utr}` : ""}`,
    },
    {
      /**
       * Only on the leg that completes the settlement, and only once.
       *
       * A reserve is money the vendor is owed and we are holding back. Booking
       * it per leg would hold it several times over.
       */
      entryType: LEDGER_ENTRY_TYPE.RESERVE_HOLD,
      amount: isFinalLeg ? settlement?.reserveHeld : 0,
      narration: `Reserve held from ${label}`,
    },
  ];

  const entries = [];
  let posted = 0;
  let duplicates = 0;

  for (const item of plan) {
    const result = await recordLedgerEntry({ ...common, ...item });
    if (result.skipped) continue;
    if (result.duplicate) duplicates += 1;
    else posted += 1;
    if (result.entry) entries.push(result.entry);
  }

  return { posted, duplicates, entries };
};

/**
 * Undo a payout that came back.
 *
 * ⚠️ Written **before** the settlement's rows are released, never after. A crash
 * between the two leaves an over-stated reversal — visible, and correctable.
 * The other order leaves rows released with no reversal booked, which reads as
 * money that was never paid and is free to be settled a second time.
 *
 * `isReversal` takes these rows out of the once-per-transaction index, which is
 * what makes them writable at all: a reversal is by definition a second row of
 * the same type against the same parent.
 */
exports.reversePayoutEntries = async ({ legs, settlement, reason }) => {
  const paidLegs = (legs || []).filter((leg) => leg.amount > 0);
  if (!paidLegs.length) return { posted: 0, duplicates: 0, entries: [] };

  const entries = [];
  let posted = 0;
  let duplicates = 0;

  for (const leg of paidLegs) {
    const result = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.PAYOUT_REVERSAL,
      amount: leg.amount,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      payoutLegId: leg._id,
      settlementId: settlement?._id,
      brandId: leg.brandId || settlement?.brandId,
      occurredAt: new Date(),
      reason,
      narration:
        `Payout reversed for ${settlement?.settlementNumber || settlement?._id} — ` +
        `leg ${leg.legNumber}${leg.utr ? `, UTR ${leg.utr}` : ""}`,
      /**
       * A second row of the same type against the same leg — the correction
       * mechanism would otherwise be blocked by the safety mechanism.
       */
      isReversal: true,
    });

    if (result.skipped) continue;
    if (result.duplicate) duplicates += 1;
    else posted += 1;
    if (result.entry) entries.push(result.entry);
  }

  return { posted, duplicates, entries };
};
