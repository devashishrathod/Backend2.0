/**
 * Customer-side platform constants.
 *
 * Everything here is a **fallback only**. The live values come from
 * `Setting.customer` via `helpers/settings/getCustomerConfig.js`, so an admin can
 * always override them without a deploy. Nothing should read these directly —
 * go through the helper.
 */

/**
 * Convenience fee slabs.
 *
 * Every `slabSize` rupees of the bill costs `feePerSlab`:
 *
 * |        Bill | Fee |
 * |------------:|----:|
 * |     1 –  500 |  5 |
 * |   501 – 1000 | 10 |
 * |  1001 – 1500 | 15 |
 * |  1501 – 2000 | 20 |
 *
 * `ceil(bill / slabSize) * feePerSlab`, and the pattern keeps going past 2000 —
 * `maxFee: null` means no ceiling.
 *
 * The fee is computed on the **original bill**, not on what is left after the
 * discount. Basing it on the discounted figure would make the fee move every
 * time a different offer applied, which reads as arbitrary to the customer and
 * would force a separate fee on every row of an offer comparison.
 */
const CONVENIENCE_FEE_DEFAULTS = Object.freeze({
  isEnabled: true,
  slabSize: 500,
  feePerSlab: 5,
  maxFee: null,
});

module.exports = {
  CONVENIENCE_FEE_DEFAULTS,
};
