const { buildClaimPreview } = require("../../helpers/vouchers");

/**
 * Price a voucher against a bill, and say whether the customer may claim it.
 *
 * Thin on purpose. Everything — the gates, the offer choice, the promo code, the
 * arithmetic — lives in `buildClaimPreview`, because **order creation runs the
 * same builder**. Two implementations of "what does this cost" is how a customer
 * is shown one figure and charged another, and it is not a bug that shows up in
 * testing: it shows up in a chargeback.
 *
 * This function's whole job is to drop the builder's `_internal` block, which
 * carries the resolved documents that order creation needs and nothing a client
 * should see.
 *
 * The response is **additive** against the previous shape: every field the app
 * reads today is still there and still means the same thing. What is new is
 * `brand`, `orderSummary`, `promo`, `canClaim`, `blockedReason`, `requiresLogin`,
 * `notices`, and a far fuller `pricing`.
 *
 * @param {object} actor    the request — `customerId` is absent for a guest
 * @param {object} payload  validated body
 */
exports.previewCustomerVoucher = async (actor, payload) => {
  const { voucherId, outletId, billAmount, offerId, promoCode } = payload;

  const preview = await buildClaimPreview({
    voucherId,
    outletId,
    billAmount,
    offerId: offerId || null,
    // An empty string is "no code", not a code that fails to exist. Joi allows
    // it so a client can clear the field without omitting it.
    promoCode: promoCode || null,
    actor,
  });

  const { _internal, ...response } = preview;
  return response;
};
