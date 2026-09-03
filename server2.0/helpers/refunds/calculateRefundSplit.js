const { throwError } = require("../../utils");
const { PROMO_APPLIES_TO } = require("../../constants/promoCode");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Money compared to money. Two figures that differ by less than half a paisa are
// the same figure that took different routes through floating point.
const PAISA = 0.005;

/**
 * What a refund actually reverses, and out of whose pocket.
 *
 * ### Read from the claim, never from the transaction
 *
 * `Transaction.voucher` is a **denormalised copy** kept so a settlement can total
 * a brand's day without joining every claim. It carries `netBill`,
 * `platformPromoCost` and `commissionAmount` — but **not** `promoDiscount`,
 * `promoAppliesTo` or `taxOnTop`.
 *
 * Those three decide the split. A promo that came off the **convenience fee**
 * costs the vendor nothing and must not be clawed back from them; a promo off
 * the **net bill** must. Splitting from the transaction's copy cannot tell those
 * apart, and would quietly dock the vendor for a discount we gave out of our own
 * fee. So the source is `VoucherClaim.pricing` — the frozen 39-field snapshot.
 *
 * ### Who bears what (decided 30 Aug 2026)
 *
 * | Part | Full refund | Partial |
 * |---|---|---|
 * | net bill | clawed back from the vendor | pro-rata |
 * | convenience fee | back to the customer, **we** absorb it | **not** returned |
 * | GST on the fee | returned with the fee | not returned |
 * | promo — our share | reversed, we stop bearing it | pro-rata |
 * | promo — vendor share | reversed | pro-rata |
 * | Razorpay MDR | **we absorb it** | absorbed once, on the first refund |
 *
 * The fee comes back on a full refund because a customer who paid ₹810 and gets
 * ₹800 opens a support ticket, and being right about the ₹10 does not make that
 * cheaper. Razorpay does not return its fee when a payment is refunded, so the
 * MDR is a straight loss — recorded as one so it shows in the ledger rather than
 * quietly eroding margin.
 *
 * ### The balance identity
 *
 * ```
 * totalRefund = vendorPortion + convenienceFeeRefund + taxRefund
 * vendorPortion = vendorClawback + commissionReversal − platformPromoReversal
 * ```
 *
 * Both are asserted before returning. A split that does not balance is not a
 * rounding annoyance — it is money that would go out of the door without a
 * matching entry on the other side.
 *
 * @param {object}  options
 * @param {object}  options.pricing          `VoucherClaim.pricing`
 * @param {number}  options.paidAmount       what Razorpay actually captured
 * @param {number}  options.requestedAmount  what is being refunded now
 * @param {number} [options.alreadyRefunded] cumulative prior refunds
 * @param {number} [options.gatewayFee]      the MDR Razorpay kept
 */
exports.calculateRefundSplit = ({
  pricing,
  paidAmount,
  requestedAmount,
  alreadyRefunded = 0,
  gatewayFee = 0,
}) => {
  if (!pricing) throwError(422, "This claim has no pricing to refund against.");

  const paid = round2(paidAmount);
  const priorRefunds = round2(alreadyRefunded);

  if (!(paid > 0)) {
    throwError(422, "This payment has nothing to refund.");
  }

  const refundableCeiling = round2(paid - priorRefunds);
  if (refundableCeiling <= 0) {
    throwError(422, "This payment has already been fully refunded.");
  }

  const totalRefund = round2(requestedAmount);
  if (!(totalRefund > 0)) {
    throwError(422, "A refund has to be for more than zero.");
  }

  /**
   * Refused, not silently capped.
   *
   * Quietly trimming ₹8,100 down to ₹810 would let a fat-fingered extra zero
   * look like it was approved as typed, and the person who typed it would never
   * find out.
   */
  if (totalRefund > refundableCeiling + PAISA) {
    throwError(
      422,
      `Only ₹${refundableCeiling.toFixed(2)} of this payment can still be refunded.`,
    );
  }

  // ---------------- what the customer actually paid, by part ----------------
  const netBill = round2(pricing.netBill);
  const convenienceFee = round2(pricing.convenienceFee);
  const promoDiscount = round2(pricing.promoDiscount);
  const vendorPromoCost = round2(pricing.vendorPromoCost);
  const platformPromoCost = round2(pricing.platformPromoCost);
  const commissionAmount = round2(pricing.commissionAmount);
  const commissionTax = round2(pricing.commissionTax);
  /**
   * What actually came off the vendor at capture.
   *
   * ⚠️ Falls back to `commissionAmount` when the field is absent. A claim frozen
   * before `commissionDeduction` existed has no value for it, and treating that
   * as **zero** would credit the vendor nothing on a refund while the capture had
   * debited them the commission — the phantom balance this whole pair of fields
   * exists to prevent, just pointing the other way. `commissionAmount` is the
   * right guess: GST-inclusive is the default, and there the two are equal.
   */
  const commissionDeduction = round2(
    pricing.commissionDeduction ?? pricing.commissionAmount,
  );
  const taxOnTop = round2(pricing.taxOnTop);

  const promoHitTheFee =
    pricing.promoAppliesTo === PROMO_APPLIES_TO.CONVENIENCE_FEE;

  /**
   * The fee the customer actually parted with.
   *
   * A promo that discounted the fee means they never paid it, so there is
   * nothing there to give back — refunding the sticker fee would hand them money
   * they were never charged.
   */
  const feeActuallyPaid = round2(
    convenienceFee - (promoHitTheFee ? promoDiscount : 0),
  );

  // Everything that is not our fee. Every partial refund comes out of here.
  const vendorSidePaid = round2(paid - feeActuallyPaid - taxOnTop);

  /**
   * Does this refund finish the job?
   *
   * Measured on the **cumulative** position, not on this request alone. A ₹300
   * refund followed by a ₹510 one leaves nothing owing, so the second is the
   * full one and the fee comes back with it — the customer ends up whole either
   * way, and neither refund has to know what the other did.
   */
  const isFullRefund = round2(priorRefunds + totalRefund) >= round2(paid) - PAISA;

  const convenienceFeeRefund = isFullRefund ? feeActuallyPaid : 0;
  const taxRefund = isFullRefund ? taxOnTop : 0;
  const vendorPortion = round2(totalRefund - convenienceFeeRefund - taxRefund);

  if (vendorPortion < -PAISA) {
    // Only reachable if `paidAmount` and the frozen pricing disagree — which
    // means one of them is wrong, and guessing which would be worse than saying
    // so.
    throwError(
      422,
      "This claim's stored pricing does not match what was charged. Refund it manually.",
    );
  }

  // ---------------- scale the vendor side ----------------
  const ratio = vendorSidePaid > 0 ? vendorPortion / vendorSidePaid : 0;

  const netBillRefund = round2(netBill * ratio);
  const vendorPromoReversal = round2(vendorPromoCost * ratio);
  const commissionReversal = round2(commissionAmount * ratio);
  /**
   * The vendor's side of the commission, and the tax on it.
   *
   * `commissionReversal` is what **we** give up out of revenue — it is what the
   * customer-side balance below is built on. These two are what the **vendor**
   * gets back, and they are a different number whenever GST sits on top: the
   * vendor was deducted commission *plus* tax, so crediting them only the
   * commission leaves them permanently short by the tax on every refunded sale.
   */
  const commissionTaxReversal = round2(commissionTax * ratio);
  const commissionDeductionReversal = round2(commissionDeduction * ratio);
  /**
   * Only the share that came off the **net bill**.
   *
   * A promo taken off the convenience fee never touched the vendor's money, and
   * it is already reflected in `feeActuallyPaid`. Subtracting it here as well
   * would count the same discount twice and short the customer by its value.
   */
  const platformPromoReversal = round2(
    (promoHitTheFee ? 0 : platformPromoCost) * ratio,
  );

  let vendorClawback = round2(
    netBillRefund - vendorPromoReversal - commissionReversal,
  );

  /**
   * Rounding lands on the clawback.
   *
   * Four independently rounded figures will not always add back to the total. A
   * residue has to live somewhere, and the vendor's clawback is the right place:
   * it is the largest component, it is reconciled against the settlement it
   * lands in, and it is never the number shown to the customer.
   */
  const balance = round2(
    vendorPortion - (vendorClawback + commissionReversal - platformPromoReversal),
  );
  if (Math.abs(balance) > PAISA) {
    vendorClawback = round2(vendorClawback + balance);
  }

  /**
   * Razorpay keeps its fee whatever happens, so it is absorbed **once** — on the
   * first refund against this payment. Charging a share of it to each partial
   * would book the same loss two and three times over.
   */
  const gatewayFeeAbsorbed = priorRefunds > 0 ? 0 : round2(gatewayFee);

  const split = {
    totalRefund,
    netBillRefund,
    convenienceFeeRefund,
    taxRefund,
    vendorClawback,
    platformPromoReversal,
    vendorPromoReversal,
    commissionReversal,
    commissionTaxReversal,
    commissionDeductionReversal,
    gatewayFeeAbsorbed,
    isFullRefund,
  };

  assertBalances(split, vendorPortion);
  return split;
};

/**
 * The books balance, or nothing goes out.
 *
 * Asserted rather than trusted: this runs once per refund, and the alternative
 * to finding a broken split here is finding it in a settlement statement a month
 * later, after the money has moved.
 */
const assertBalances = (split, vendorPortion) => {
  const customerSide = round2(
    split.vendorClawback +
      split.commissionReversal -
      split.platformPromoReversal +
      split.convenienceFeeRefund +
      split.taxRefund,
  );

  if (Math.abs(customerSide - split.totalRefund) > PAISA) {
    throwError(
      500,
      `Refund split does not balance: parts total ₹${customerSide.toFixed(
        2,
      )} against a refund of ₹${split.totalRefund.toFixed(2)}.`,
    );
  }

  const vendorSide = round2(
    split.vendorClawback + split.commissionReversal - split.platformPromoReversal,
  );
  if (Math.abs(vendorSide - vendorPortion) > PAISA) {
    throwError(
      500,
      `Refund split does not balance on the vendor side: ₹${vendorSide.toFixed(
        2,
      )} against ₹${vendorPortion.toFixed(2)}.`,
    );
  }

  // A refund that pays the vendor, or takes money from the customer, is a sign
  // reversal — the exact bug that made `getPlatformTotals` report a profit on a
  // claim that lost money.
  for (const [key, value] of Object.entries(split)) {
    if (typeof value === "number" && value < -PAISA) {
      throwError(500, `Refund split produced a negative ${key}: ${value}.`);
    }
  }
};

exports.round2 = round2;
