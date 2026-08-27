/**
 * The slab fee for a bill.
 *
 * Deliberately computed on the **original bill**, never on what is left after a
 * discount: a fee that moved every time a different offer applied would read as
 * arbitrary to the customer, and an offer-comparison list would need its own fee
 * on every row instead of one figure for the whole checkout.
 *
 * @param {number} billAmount
 * @param {{ isEnabled, slabSize, feePerSlab, maxFee }} config
 * @returns {number} rupees, rounded to 2 decimals
 */
exports.calculateConvenienceFee = (billAmount, config = {}) => {
  const { isEnabled = true, slabSize = 500, feePerSlab = 5, maxFee = null } =
    config;

  if (!isEnabled) return 0;

  const amount = Number(billAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const size = Number(slabSize);
  const perSlab = Number(feePerSlab);
  // A zero or negative slab would divide by nothing and produce Infinity —
  // treat a misconfigured slab as "no fee" rather than charging a wild number.
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(perSlab) || perSlab <= 0) return 0;

  let fee = Math.ceil(amount / size) * perSlab;

  if (maxFee !== null && maxFee !== undefined && Number.isFinite(Number(maxFee))) {
    fee = Math.min(fee, Number(maxFee));
  }

  return Number(fee.toFixed(2));
};
