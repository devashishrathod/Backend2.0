const {
  DOCUMENT_PARTY,
  DOCUMENT_PARTY_LABEL,
} = require("../../constants/document");

/**
 * Who a document is addressed to, as one printable line.
 *
 * ### The bug this replaces
 *
 * Every customer receipt printed `Bill To: -`. The snapshot builder read
 * `claim.customerSnapshot?.name`, and `customerSnapshot` was never a field on
 * `VoucherClaim` — the model has `offerSnapshot`, `voucherSnapshot`,
 * `brandSnapshot` and `outletSnapshot`, and nothing else. So the read was
 * `undefined` on every claim ever made, and the one line naming the person who
 * paid was a dash.
 *
 * ### Why a cascade rather than a required field
 *
 * `Customer.fullName` is not required — a customer can pay before they have ever
 * set a name. Making it required at checkout would block a paying customer to
 * improve a PDF, so the document falls back instead: name, then the number we
 * reach them on, then the bare word. A document of record must always name a
 * party; it must never say `-`.
 *
 * The vendor side follows the same shape for the same reason: `brandName` can be
 * absent early in onboarding, and `legalBusinessName` is what a tax document
 * should carry anyway.
 *
 * ### Why the tag is always printed
 *
 * `Devashish Rathod (Customer)` and `Cafe Mocha (Vendor)` are unambiguous;
 * `Devashish Rathod` alone is not — brands are named after people. Support, and
 * anyone reconciling a stack of documents, needs to know which side of the
 * business a document belongs to without opening the system.
 *
 * @param {object}   args
 * @param {string}   args.type     DOCUMENT_PARTY value
 * @param {string[]} args.names    identity candidates, best first; the first
 *                                 non-empty one is used
 * @returns {string}
 */
const resolvePartyName = ({ type, names = [] } = {}) => {
  const label = DOCUMENT_PARTY_LABEL[type];
  if (!label) {
    // A party with no type is a programming error, not a business case — but a
    // document is not the place to throw, so it degrades to the plainest thing
    // that is still true.
    return String(names.find((value) => String(value ?? "").trim()) ?? "").trim();
  }

  const identity = names
    .map((value) => String(value ?? "").trim())
    .find(Boolean);

  // `Customer (Customer)` reads as a bug. When nothing identifies them, the tag
  // *is* the identity.
  return identity ? `${identity} (${label})` : label;
};

/** The customer cascade: their name, else the number we reach them on. */
const resolveCustomerName = (customer = {}) =>
  resolvePartyName({
    type: DOCUMENT_PARTY.CUSTOMER,
    names: [customer.fullName, customer.whatsappNumber, customer.mobile],
  });

/** The vendor cascade: trading name, else the registered one, else the number. */
const resolveVendorName = (vendor = {}) =>
  resolvePartyName({
    type: DOCUMENT_PARTY.VENDOR,
    names: [vendor.brandName, vendor.legalBusinessName, vendor.whatsappNumber],
  });

module.exports = {
  resolvePartyName,
  resolveCustomerName,
  resolveVendorName,
};
