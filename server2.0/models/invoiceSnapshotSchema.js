const mongoose = require("mongoose");
const { pricingSchema } = require("./pricingSchema");
const { voucherPricingSchema } = require("./voucherPricingSchema");
const { INVOICE_KIND } = require("../constants/transaction");

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

/**
 * Everything an invoice prints, frozen at the moment it is issued.
 *
 * The problem this solves: the generator used to read from two places — the
 * frozen `pricing` block, and live lookups for the plan name, the seller
 * identity and the buyer's address. Anything looked up live can change or
 * disappear, so re-issuing an invoice could produce a different document than
 * the original. `planEnd` printed as "-" on every re-issue for exactly that
 * reason: the validity dates were never stored anywhere the generator could see.
 *
 * With this, `generateAndUploadInvoice` reads **only** the snapshot and performs
 * no lookups at all. An invoice reproduces byte-for-byte today, tomorrow, or in
 * two years — after the plan is renamed, the seller's GSTIN changes, or the
 * brand moves address. Which is also what GST expects: an issued invoice is a
 * record of what was true then, not a live view.
 *
 * `pricing` is duplicated here on purpose. It already lives on the transaction,
 * but an invoice document-of-record should be self-contained: one read, one
 * source, nothing to reconcile.
 */
const invoiceSnapshotSchema = new mongoose.Schema(
  {
    // Stamped so a future change to the invoice layout can be applied to new
    // invoices without altering how an old one renders.
    version: { type: Number, default: 1 },

    /**
     * Which document this is, and the renderer's branch key.
     *
     * `SUBSCRIPTION` is what every existing invoice is, so it is the default and
     * nothing about those changes. `VOUCHER_CLAIM` gets its own layout: the
     * subscription one prints "Original Price", a plan name, a duration and a
     * validity range, none of which a voucher claim has — run through it, a claim
     * would print an empty plan name, `Validity: - to -`, and tax rows of zero.
     */
    kind: {
      type: String,
      enum: Object.values(INVOICE_KIND),
      default: INVOICE_KIND.SUBSCRIPTION,
    },

    /**
     * Whether this is a tax invoice at all.
     *
     * ⚠️ Printing "TAX INVOICE" on a document with no tax on it is wrong.
     * Customer GST is off by default, so a claim receipt says **PAYMENT
     * RECEIPT** and prints no tax block. The moment GST is switched on the same
     * claim becomes a TAX INVOICE — which is why this is stored rather than
     * derived at render time, when the config may have changed.
     */
    isTaxInvoice: { type: Boolean, default: true },
    issuedAt: { type: Date },
    invoiceId: { type: String },
    transactionRef: { type: String },

    // ---------- what was sold ----------
    planName: { type: String },
    planType: { type: String },
    durationLabel: { type: String },
    planStart: { type: Date },
    planEnd: { type: Date },
    hsnSacCode: { type: String },

    // ---------- who sold it / who bought it ----------
    seller: { type: partySchema, default: () => ({}) },
    billTo: { type: partySchema, default: () => ({}) },

    // ---------- how much ----------
    // `SUBSCRIPTION` only. Absent on a claim — see `voucherPricing`.
    pricing: { type: pricingSchema },
    // `VOUCHER_CLAIM` only. Kept as its own typed field rather than making
    // `pricing` Mixed: the two blocks share almost no field names, and a
    // renderer that had to guess which shape it held would guess wrong.
    voucherPricing: { type: voucherPricingSchema },

    /**
     * The printed lines, already worded.
     *
     * A claim invoice has to say *"Bill collected on behalf of <Brand>"* rather
     * than name a product, because Trydood did not sell the meal — the vendor
     * did, and we collected for them. Getting that wording out of the renderer
     * and into the snapshot means an invoice re-issued after the wording changes
     * still reads the way it did when it was issued.
     */
    lineItems: [
      {
        _id: false,
        label: { type: String },
        amount: { type: Number },
        // Set on the rows that are subtracted, so the renderer does not have to
        // infer a minus sign from the label.
        isDeduction: { type: Boolean, default: false },
      },
    ],

    /** What was claimed. `VOUCHER_CLAIM` only. */
    voucherBlock: {
      voucherName: { type: String },
      versionCode: { type: String },
      offerTitle: { type: String },
      claimCode: { type: String },
      outletStoreId: { type: String },
      redeemedAt: { type: Date },
    },

    /** Who the money was collected for. `VOUCHER_CLAIM` only. */
    brandBlock: {
      name: { type: String },
      outletAddress: { type: String },
    },

    // ---------- how it was paid ----------
    paymentStatus: { type: String },
    paymentMethod: { type: String },
    isManual: { type: Boolean, default: false },
    placeOfSupply: { type: String },
  },
  { _id: false },
);

module.exports = { invoiceSnapshotSchema };
