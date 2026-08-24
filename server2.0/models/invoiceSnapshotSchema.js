const mongoose = require("mongoose");
const { pricingSchema } = require("./pricingSchema");

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
    pricing: { type: pricingSchema, default: () => ({}) },

    // ---------- how it was paid ----------
    paymentStatus: { type: String },
    paymentMethod: { type: String },
    isManual: { type: Boolean, default: false },
    placeOfSupply: { type: String },
  },
  { _id: false },
);

module.exports = { invoiceSnapshotSchema };
