/**
 * Document enums — the shared vocabulary of everything Trydood puts on paper.
 *
 * A receipt, a tax invoice, a payout statement, a refund receipt and a chargeback
 * advice are one system, not five. They share a numbering scheme, a renderer and
 * a public download link, and this is where the words they differ by live.
 *
 * Before this existed there were two renderers that never met — one for
 * subscriptions and claims, one for payout statements — each with its own money
 * formatter, its own date formatter and its own two-column row. A layout bug
 * fixed in one stayed broken in the other, and it did: the overlapping-rows bug
 * was fixed nowhere and shipped on every customer receipt.
 */

/**
 * Who the document is addressed to.
 *
 * Printed as a tag beside the name — `Devashish Rathod (Customer)`,
 * `Cafe Mocha (Vendor)` — so anybody holding the paper can tell at a glance
 * whether it belongs to the customer side or the vendor side of the business.
 * Support conversations start with exactly that question, and a brand named
 * after a person is otherwise indistinguishable from a customer.
 */
const DOCUMENT_PARTY = Object.freeze({
  CUSTOMER: "CUSTOMER",
  VENDOR: "VENDOR",
});

/** The word each party prints as. Not the enum value — this reaches a reader. */
const DOCUMENT_PARTY_LABEL = Object.freeze({
  [DOCUMENT_PARTY.CUSTOMER]: "Customer",
  [DOCUMENT_PARTY.VENDOR]: "Vendor",
});

/**
 * What happened, which is what the document is *about*.
 *
 * Deliberately named after the **event**, not the layout. There is one renderer
 * and it branches on nothing: a snapshot carries its own printed blocks. The kind
 * survives so a document can be found, filtered and titled — not so the renderer
 * can special-case it.
 */
const DOCUMENT_KIND = Object.freeze({
  /** A customer paid a bill at an outlet through a voucher. */
  VOUCHER_CLAIM: "VOUCHER_CLAIM",
  /** A vendor bought a subscription plan. */
  SUBSCRIPTION: "SUBSCRIPTION",
  /** An admin granted a plan — cash, UPI, or free. No gateway involved. */
  SUBSCRIPTION_GRANT: "SUBSCRIPTION_GRANT",
  /** A payout reached a vendor's bank, with the commission invoice inside it. */
  PAYOUT_STATEMENT: "PAYOUT_STATEMENT",
  /** Money went back to a customer. */
  REFUND: "REFUND",
  /** A dispute was lost and the sale is being recovered from the vendor. */
  CHARGEBACK: "CHARGEBACK",
});

/**
 * Numbering series. One `Counter` per series per financial year, so the sequence
 * is monotonic within a series — what GST expects of a document-of-record.
 *
 *   INVOICE:VCH:26-27  ->  TD/VCH/26-27/000001
 *
 * ⚠️ `COMMISSION` is separate from `PAYOUT_STATEMENT` on purpose. A payout
 * statement tells a vendor what reached their bank; the commission Trydood
 * charged them is a **taxable supply from us to them** and needs its own tax
 * invoice number. They print in one PDF — a vendor should not have to reconcile
 * two files — but they are two documents and are numbered as two.
 */
const DOCUMENT_SERIES = Object.freeze({
  [DOCUMENT_KIND.VOUCHER_CLAIM]: "VCH",
  [DOCUMENT_KIND.SUBSCRIPTION]: "SUB",
  [DOCUMENT_KIND.SUBSCRIPTION_GRANT]: "GRT",
  [DOCUMENT_KIND.PAYOUT_STATEMENT]: "STL",
  [DOCUMENT_KIND.REFUND]: "REF",
  [DOCUMENT_KIND.CHARGEBACK]: "DBN",
  COMMISSION: "CMN",
});

/**
 * What a document calls itself.
 *
 * ⚠️ "TAX INVOICE" on a document carrying no tax is wrong, and a refund is not
 * an invoice at all. The title is resolved once when the document is issued and
 * **frozen into the snapshot** — switching GST on later must not retitle a
 * document that has already been sent to somebody.
 */
const DOCUMENT_TITLE = Object.freeze({
  TAX_INVOICE: "TAX INVOICE",
  PAYMENT_RECEIPT: "PAYMENT RECEIPT",
  GRANT_ADVICE: "GRANT ADVICE",
  PAYOUT_STATEMENT: "PAYOUT STATEMENT",
  REFUND_RECEIPT: "REFUND RECEIPT",
  CREDIT_NOTE: "CREDIT NOTE",
  CHARGEBACK_ADVICE: "CHARGEBACK ADVICE",
  DEBIT_NOTE: "DEBIT NOTE",
});

/**
 * Kind + whether tax was actually charged -> the title.
 *
 * The second column is what the document becomes once GST is switched on. Under
 * GST a refund against a tax invoice is a **credit note** and a recovery from a
 * vendor is a **debit note**; with no tax on the original they are simply a
 * receipt and an advice. Customer GST is off today, so claims and refunds print
 * the untaxed titles — and the day it is switched on, new documents change and
 * issued ones do not.
 */
const DOCUMENT_TITLE_BY_KIND = Object.freeze({
  [DOCUMENT_KIND.VOUCHER_CLAIM]: {
    untaxed: DOCUMENT_TITLE.PAYMENT_RECEIPT,
    taxed: DOCUMENT_TITLE.TAX_INVOICE,
  },
  [DOCUMENT_KIND.SUBSCRIPTION]: {
    untaxed: DOCUMENT_TITLE.PAYMENT_RECEIPT,
    taxed: DOCUMENT_TITLE.TAX_INVOICE,
  },
  [DOCUMENT_KIND.SUBSCRIPTION_GRANT]: {
    untaxed: DOCUMENT_TITLE.GRANT_ADVICE,
    taxed: DOCUMENT_TITLE.TAX_INVOICE,
  },
  [DOCUMENT_KIND.PAYOUT_STATEMENT]: {
    // A payout statement is not a tax document either way. The commission tax
    // invoice printed inside it is, and it carries its own title and number.
    untaxed: DOCUMENT_TITLE.PAYOUT_STATEMENT,
    taxed: DOCUMENT_TITLE.PAYOUT_STATEMENT,
  },
  [DOCUMENT_KIND.REFUND]: {
    untaxed: DOCUMENT_TITLE.REFUND_RECEIPT,
    taxed: DOCUMENT_TITLE.CREDIT_NOTE,
  },
  [DOCUMENT_KIND.CHARGEBACK]: {
    untaxed: DOCUMENT_TITLE.CHARGEBACK_ADVICE,
    taxed: DOCUMENT_TITLE.DEBIT_NOTE,
  },
});

/**
 * The shape a series prefix must have.
 *
 * ⚠️ This replaces a membership check against a hardcoded list, which was a live
 * crash. `Setting.customer.invoice.seriesPrefix` lets an admin choose the claim
 * prefix and the validator accepted any letters — but `generateInvoiceNumber`
 * only accepted `SUB`, `VCH` or `STL`. Changing it to anything else meant every
 * voucher claim threw a 500 **after** the money was captured and the claim
 * recorded, and the resume job then failed on it forever.
 *
 * A number series has no business caring *which* letters it is, only that it is a
 * short, stable, uppercase token that reads well in `TD/XXX/26-27/000001`.
 */
const DOCUMENT_SERIES_PATTERN = /^[A-Z]{2,6}$/;
const DOCUMENT_SERIES_MIN = 2;
const DOCUMENT_SERIES_MAX = 6;

/**
 * Series an admin must not choose for the customer prefix.
 *
 * Not a correctness rule — two kinds sharing a counter still produce unique
 * numbers. It is a legibility rule: a voucher receipt numbered `TD/SUB/...`
 * lands in the middle of the subscription series and nobody reading the books
 * can tell the two apart. The runtime accepts any well-formed series; the
 * validator stops a person picking a confusing one.
 */
const RESERVED_DOCUMENT_SERIES = Object.freeze(
  Object.values(DOCUMENT_SERIES).filter(
    (series) => series !== DOCUMENT_SERIES[DOCUMENT_KIND.VOUCHER_CLAIM],
  ),
);

module.exports = {
  DOCUMENT_PARTY,
  DOCUMENT_PARTY_LABEL,
  DOCUMENT_KIND,
  DOCUMENT_SERIES,
  DOCUMENT_TITLE,
  DOCUMENT_TITLE_BY_KIND,
  DOCUMENT_SERIES_PATTERN,
  DOCUMENT_SERIES_MIN,
  DOCUMENT_SERIES_MAX,
  RESERVED_DOCUMENT_SERIES,
};
