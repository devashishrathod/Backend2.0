/**
 * What a Location belongs to.
 *
 * Replaces the pair of booleans `isBrandAddress` / `isSubBrandAddress`, which
 * could disagree with each other and with the ids on the same row — and did:
 * three rows carried a `brandId` while `isBrandAddress` was `false`, and no row
 * anywhere had it `true`. Two flags can describe four states for a thing that
 * only has three, and nothing stopped a row sitting in the fourth.
 *
 * One field also makes the "one live address per owner" rule expressible as a
 * partial unique index, which two booleans do not: a partial filter cannot say
 * "has a brandId and no subBrandId", but it can say `kind: "BRAND"`.
 *
 * ⚠️ `ADDRESS_TYPES` (HOME / WORK / OTHER) is a different question — what the
 * address *is to its owner*, not who owns it — and stays in `constants.js`
 * where its callers already read it.
 */
const LOCATION_KINDS = Object.freeze({
  BRAND: "BRAND",
  SUB_BRAND: "SUB_BRAND",
  CUSTOMER: "CUSTOMER",
});

module.exports = { LOCATION_KINDS };
