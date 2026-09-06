const mongoose = require("mongoose");
const { pricingSchema } = require("./pricingSchema");
const { voucherPricingSchema } = require("./voucherPricingSchema");
const { DOCUMENT_KIND } = require("../constants/document");

/**
 * Everything a document prints, frozen at the moment it is issued.
 *
 * ### The problem this solves
 *
 * A generator that reads anything live cannot reproduce an old document. The
 * plan gets renamed, the seller's GSTIN changes, the brand moves address, the fee
 * slab is edited — and re-issuing last year's invoice quietly prints this year's
 * facts. `planEnd` used to render as `-` on every re-issue for exactly that
 * reason: the validity dates lived only on the `Subscribed` record and the
 * generator could not reach them.
 *
 * With this, the renderer performs **no lookups at all**. It is handed a snapshot
 * and draws it.
 *
 * ### Why the printed blocks are generic
 *
 * The previous schema was shaped like a subscription invoice, with a voucher
 * claim bolted onto the side: `planName`, `planStart`, `planEnd`, `durationLabel`
 * next to `voucherBlock`, `brandBlock`, `voucherPricing`. The renderer then had
 * to branch on `kind` and print one shape or the other — which is why a claim run
 * through the subscription branch printed an empty plan name and `Validity: - to -`,
 * and why adding a refund or a payout meant a third branch and a fourth.
 *
 * So the *presentation* is data now: `meta`, `timeline`, `details`, `lineItems`,
 * `taxLines`, `total`, `table`, `notes`. A refund, a chargeback advice, a payout
 * statement and a claim receipt are the same eight blocks with different contents.
 * The renderer branches on nothing, and a seventh document type needs no renderer
 * change at all.
 *
 * It also puts the **wording** inside the frozen record, which matters more than
 * it looks. "Bill collected on behalf of Cafe Mocha" is a statement about who sold
 * the meal — Trydood did not, the vendor did, and we collected for them. An
 * invoice re-issued after that wording is edited must still read the way it read
 * when it was issued, or it becomes a different claim about who owes tax on
 * ₹1,000 of restaurant revenue.
 *
 * `pricing` / `voucherPricing` stay as typed blocks beside the printed ones. They
 * are not what gets drawn — they are the machine-readable record an API response
 * and a reconciliation read, and keeping them means a document is still
 * self-contained: one read, one source, nothing to join.
 */

const partySchema = new mongoose.Schema(
  {
    name: { type: String },
    legalName: { type: String },
    gstin: { type: String },
    pan: { type: String },
    address: { type: String },
    stateCode: { type: String },
    state: { type: String },
    email: { type: String },
    contact: { type: String },
  },
  { _id: false },
);

/** A `Label: value` line — the meta block, and the description block. */
const labelValueSchema = new mongoose.Schema(
  {
    label: { type: String },
    value: { type: String },
  },
  { _id: false },
);

/**
 * One dated event in the document's own history.
 *
 * ⚠️ Stored as real `Date`s and formatted at render time in IST, never as
 * pre-formatted strings. A document must be able to say *when* something
 * happened — claimed, paid, redeemed, refunded — and the instants have to stay
 * comparable and re-renderable. Freezing the words would have frozen a timezone
 * bug into every document ever issued.
 */
const timelineEntrySchema = new mongoose.Schema(
  {
    label: { type: String },
    at: { type: Date },
  },
  { _id: false },
);

/** A money row. `isDeduction` so the renderer never infers a sign from wording. */
const lineItemSchema = new mongoose.Schema(
  {
    label: { type: String },
    amount: { type: Number },
    isDeduction: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * A tabular block — the claims a payout statement paid for, the legs it went out
 * in. Column widths are frozen with the data because they are part of how the
 * document looked when it was issued.
 */
const tableSchema = new mongoose.Schema(
  {
    title: { type: String },
    emptyText: { type: String },
    columns: [
      {
        _id: false,
        label: { type: String },
        width: { type: Number },
        align: { type: String },
      },
    ],
    // An array of rows, each an array of already-formatted cells.
    rows: { type: [[String]], default: undefined },
  },
  { _id: false },
);

/**
 * The blocks that make up a document body.
 *
 * Shared between the document itself and its `supplement`, because a payout
 * statement carries a second, self-contained document inside it — the commission
 * tax invoice — and that one needs its own party block, its own numbers and its
 * own totals, not a flattened subset of the outer one.
 */
const printableFields = {
  /** `Invoice No`, `Payment Method`, `Transaction Ref` — the top-left block. */
  meta: { type: [labelValueSchema], default: undefined },
  /** When things actually happened. Rendered in IST. */
  timeline: { type: [timelineEntrySchema], default: undefined },
  /** What was bought, claimed, refunded — the description block. */
  details: { type: [labelValueSchema], default: undefined },
  /** The money rows, already worded. */
  lineItems: { type: [lineItemSchema], default: undefined },
  /** CGST/SGST or IGST, worded with the rate that was actually applied. */
  taxLines: { type: [lineItemSchema], default: undefined },
  /** The bold last row. `You Paid`, `Total Payable`, `Net paid to you`. */
  total: {
    type: new mongoose.Schema(
      { label: { type: String }, amount: { type: Number } },
      { _id: false },
    ),
    default: undefined,
  },
  /** Footer lines. Who collected for whom, what the tax applies to. */
  notes: { type: [String], default: undefined },
};

/**
 * A second document printed inside the first.
 *
 * Only the payout statement uses it, and only for the commission Trydood charged
 * the vendor. That commission is a **taxable supply from us to them** and needs a
 * tax invoice with its own number in its own series — but a vendor should not have
 * to reconcile two files for one payout, so it prints in the same PDF.
 *
 * Two documents, one piece of paper.
 */
const supplementSchema = new mongoose.Schema(
  {
    title: { type: String },
    subtitle: { type: String },
    documentNumber: { type: String },
    isTaxInvoice: { type: Boolean, default: true },
    seller: { type: partySchema, default: undefined },
    billTo: { type: partySchema, default: undefined },
    placeOfSupply: { type: String },
    hsnSacCode: { type: String },
    ...printableFields,
  },
  { _id: false },
);

const documentSnapshotSchema = new mongoose.Schema(
  {
    /**
     * Stamped so a future change to the layout can apply to new documents without
     * altering how an old one renders.
     */
    version: { type: Number, default: 2 },

    /** What happened. Used for filtering and titling, never for branching. */
    kind: {
      type: String,
      enum: Object.values(DOCUMENT_KIND),
      default: DOCUMENT_KIND.SUBSCRIPTION,
    },

    /**
     * What the document calls itself, resolved once and frozen.
     *
     * ⚠️ Stored rather than derived. Customer GST is off, so a claim prints
     * `PAYMENT RECEIPT`; the day it is switched on a *new* claim prints
     * `TAX INVOICE`, and one already sent to somebody must not retitle itself the
     * next time they open the link.
     */
    title: { type: String },
    /** The line under the title — who collected, on whose behalf, and why. */
    subtitle: { type: String },

    /**
     * Whether this document carries tax at all.
     *
     * Printing "TAX INVOICE" on a document with no tax on it is wrong, and so is
     * printing a GST breakup of zeroes. Frozen for the same reason `title` is.
     */
    isTaxInvoice: { type: Boolean, default: true },

    issuedAt: { type: Date },
    /**
     * `TD/VCH/26-27/000001`.
     *
     * Named `documentNumber` rather than `invoiceId` because a refund receipt and
     * a chargeback advice are not invoices. `Transaction` keeps its own
     * `invoiceId` field — the number is written to both, and this is the copy the
     * document itself is built from.
     */
    documentNumber: { type: String },

    // ---------- who ----------
    seller: { type: partySchema, default: () => ({}) },
    billTo: { type: partySchema, default: () => ({}) },
    placeOfSupply: { type: String },
    hsnSacCode: { type: String },

    // ---------- what it says ----------
    ...printableFields,
    table: { type: tableSchema, default: undefined },
    supplement: { type: supplementSchema, default: undefined },

    // ---------- machine-readable, not printed ----------
    /** `SUBSCRIPTION` pricing. Absent on a claim — see `voucherPricing`. */
    pricing: { type: pricingSchema, default: undefined },
    /**
     * `VOUCHER_CLAIM` pricing. Its own typed field rather than making `pricing`
     * Mixed: the two blocks share almost no field names, and a reader that had to
     * guess which shape it held would guess wrong.
     */
    voucherPricing: { type: voucherPricingSchema, default: undefined },

    paymentStatus: { type: String },
    paymentMethod: { type: String },
    isManual: { type: Boolean, default: false },
  },
  { _id: false },
);

module.exports = {
  documentSnapshotSchema,
  partySchema,
  labelValueSchema,
  timelineEntrySchema,
  lineItemSchema,
  tableSchema,
  supplementSchema,
};
