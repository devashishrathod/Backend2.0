const {
  DOCUMENT_TITLE,
  DOCUMENT_TITLE_BY_KIND,
} = require("../../constants/document");

/**
 * What a document calls itself, decided once at issue time.
 *
 * ### Why this is resolved and frozen rather than derived at render time
 *
 * Customer GST is off today, so a claim is a **PAYMENT RECEIPT**. The day it is
 * switched on, a new claim becomes a **TAX INVOICE** — but a receipt already sent
 * to somebody must not silently retitle itself the next time they open the link.
 * A document of record states what was true when it was issued.
 *
 * The same rule is what makes a refund generic across that switch: with no tax on
 * the original it is a **REFUND RECEIPT**, and once there is, the same code path
 * produces a **CREDIT NOTE** — which is what GST requires for a refund against a
 * tax invoice. Nothing has to be rewritten when the switch is flipped; the
 * mapping already covers both sides.
 *
 * @param {object}  args
 * @param {string}  args.kind          DOCUMENT_KIND value
 * @param {boolean} [args.isTaxInvoice] whether tax was actually charged
 * @returns {string}
 */
exports.resolveDocumentTitle = ({ kind, isTaxInvoice = false } = {}) => {
  const titles = DOCUMENT_TITLE_BY_KIND[kind];

  // An unknown kind is a programming error, but a document is not the place to
  // throw — and "PAYMENT RECEIPT" is the one title that is never actively wrong.
  if (!titles) return DOCUMENT_TITLE.PAYMENT_RECEIPT;

  return isTaxInvoice ? titles.taxed : titles.untaxed;
};
