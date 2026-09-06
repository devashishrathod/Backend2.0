const mongoose = require("mongoose");
const {
  brandField,
  customerField,
  transactionField,
  settlementField,
  userField,
} = require("./validObjectId");
const { DISPUTE_STATUS } = require("../constants/webhook");
const { documentSnapshotSchema } = require("./documentSnapshotSchema");

/**
 * One dispute the bank has raised against one payment.
 *
 * ### ⚠️ Why this is a collection and not ten fields on `Transaction`
 *
 * It was ten fields on `Transaction`, and the webhook `$set` them. That works
 * for exactly one dispute per payment, and Razorpay does not promise one:
 * a chargeback that escalates to **pre-arbitration** and then **arbitration**
 * arrives as separate disputes with separate ids, separate amounts and separate
 * response deadlines.
 *
 * The second one overwrote the first. Its `disputeRespondBy` vanished — and a
 * dispute deadline that passes is an automatic loss, with nothing to say it
 * happened. Its amount vanished too.
 *
 * The books were already half-ready for this: `ledger_type_dispute_unique` keys
 * on the dispute, so two lost disputes each booked their own `CHARGEBACK`. The
 * **recovery** did not — `Transaction.chargebackSettlementId` is one lock per
 * payment, so only one of the two was ever taken back from the vendor and the
 * platform silently ate the other. That is §2.5a's bug one level down.
 *
 * `Transaction` keeps a denormalised copy of the **latest** dispute for listing
 * and filtering. This collection is the record.
 */
const disputeSchema = new mongoose.Schema(
  {
    /**
     * Razorpay's id. The natural key — every webhook carries it, and it is what
     * makes redelivery safe.
     */
    disputeId: { type: String, required: true, trim: true },

    transactionId: { ...transactionField, required: true, index: true },
    brandId: { ...brandField, index: true },
    customerId: { ...customerField },

    status: {
      type: String,
      enum: Object.values(DISPUTE_STATUS),
      required: true,
    },
    /** What the bank is asking back. Not always the whole payment. */
    amount: { type: Number, default: 0 },
    reasonCode: { type: String, trim: true },
    reason: { type: String, trim: true },
    /** `chargeback`, `pre_arbitration`, `arbitration` — Razorpay's word. */
    phase: { type: String, trim: true },

    /**
     * The response deadline.
     *
     * ⚠️ Per dispute, which is the whole point. On `Transaction` there was one
     * field, so an escalation's deadline replaced the original's and the first
     * one simply stopped existing.
     */
    respondBy: { type: Date },

    openedAt: { type: Date },
    resolvedAt: { type: Date },

    /**
     * When the gateway raised the event this row was last written from.
     *
     * ⚠️ Razorpay redelivers dispute webhooks **and sends them out of order** —
     * `constants/ledger.js` says so where it explains why the ledger keys on the
     * dispute. A late `lost` arriving after a `won` would otherwise flip a
     * dispute we had already won into one we lost, and the recovery would then
     * take money off the vendor for a loss that never happened.
     *
     * So an update is applied only when its event is **not older** than the one
     * on file. Equal is allowed, because a redelivery of the same event should
     * still be idempotent rather than refused.
     */
    lastEventAt: { type: Date },

    /**
     * Deadline warnings sent, and the claim that stops two instances sending the
     * same one. Moved here from `Transaction` for the same reason as `respondBy`.
     */
    alertsSent: { type: Number, default: 0 },

    /**
     * Which settlement recovered this loss from the vendor.
     *
     * ⚠️ The claim lock, now **per dispute**. It was per transaction, so a
     * payment with two lost disputes recovered one and forgave the other —
     * silently, and the books still showed both losses.
     */
    recoverySettlementId: { ...settlementField },
    recoveredAt: { type: Date },

    /**
     * Given up on, by an admin, with a reason.
     *
     * ⚠️ This is what **stops the carry-forward loop**, and without it a write-off
     * achieves nothing while appearing to work.
     *
     * A brand whose deductions outrun their takings produces a settlement with a
     * negative `netPayable`, which goes `CARRIED_FORWARD` and releases every
     * claim it held. The next cycle re-claims exactly the same rows, reaches the
     * same negative, and carries forward again — for ever. That is correct while
     * the brand still trades, because new sales net it off. It is a trap when
     * they stop: the debt can never be reached, and nothing anywhere says so.
     *
     * Marked here, this dispute leaves the claim filter for good and the loop
     * ends.
     */
    writtenOffAt: { type: Date },
    writtenOffBy: { ...userField },
    writtenOffReason: { type: String, trim: true, maxlength: 500 },

    /**
     * What the outlet can add — the KOT reference, a camera timestamp, what the
     * staff remember.
     *
     * ⚠️ A **bonus, never a dependency**. `buildEvidencePack` stands on our own
     * records: on this platform a voucher is paid for at the counter, so the
     * payment itself places the customer there. Filing must never wait on the
     * vendor, because a dispute gets **one** response and the deadline belongs to
     * the bank.
     *
     * It matters most in the one case our data cannot answer — a customer saying
     * they were never there at all.
     */
    vendorEvidenceNote: { type: String, trim: true, maxlength: 2000 },
    vendorEvidenceAt: { type: Date },
    vendorEvidenceBy: { ...userField },
    /**
     * When the vendor was told. Stored so a silent outlet is visible as *silent*
     * rather than as *never asked* — two very different things when a dispute is
     * lost and somebody asks why.
     */
    vendorNotifiedAt: { type: Date },

    /**
     * ---------- the advice the vendor gets ----------
     *
     * ⚠️ A lost dispute produced **no paper at all**. The vendor's next payout
     * simply came out lower, with a "chargebacks recovered" line on the statement
     * and nothing behind it — no claim code, no date, no reason. The first they
     * knew of it was money missing.
     *
     * Issued the moment the dispute is `LOST`, not when the recovery lands, so
     * the vendor learns about the deduction before it happens rather than after.
     * The settlement statement then references this number, which is what lets
     * them trace a deduction back to the sale it came from.
     *
     * Under GST a recovery from a vendor against a tax invoice is a debit note;
     * with no tax on the original it is simply an advice. `resolveDocumentTitle`
     * picks from what was actually charged, so the same code covers both sides of
     * the GST switch.
     */
    documentNumber: { type: String, trim: true },
    /** Unguessable handle for the public link. The number never appears in a URL. */
    documentToken: { type: String, trim: true },
    /** Cached storage URL. Null until somebody first downloads it. */
    documentUrl: { type: String, trim: true },
    /** Everything the advice prints, frozen when it was issued. */
    documentSnapshot: { type: documentSnapshotSchema },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/**
 * ⚠️ Razorpay redelivers dispute webhooks **and sends them out of order** — a
 * late `lost` can arrive after a `won`. This is what makes the upsert safe: the
 * same dispute can only ever be one row, however many times it is delivered.
 */
disputeSchema.index(
  { disputeId: 1 },
  { name: "dispute_gateway_id_unique", unique: true },
);

/** The deadline sweep: open disputes, soonest first. */
disputeSchema.index(
  { status: 1, respondBy: 1 },
  { name: "dispute_status_respondby" },
);

/** The recovery claim: this brand's unrecovered losses. */
disputeSchema.index(
  { brandId: 1, status: 1, recoverySettlementId: 1 },
  { name: "dispute_brand_status_recovery" },
);

/**
 * The advice's number and its link, both unique among the rows that have one.
 *
 * Partial on `$type: "string"` because a dispute exists from the moment it is
 * opened and only gets a document if it is **lost** — in a non-sparse unique
 * index the absent field would be stored as `null` and the second open dispute
 * would collide.
 *
 * The number's index is also what makes issuing safe under Razorpay's
 * redelivery: a second `dispute.lost` for the same dispute loses on the index
 * rather than burning another number out of a GST-facing sequence.
 */
disputeSchema.index(
  { documentToken: 1 },
  {
    name: "dispute_documentToken_unique",
    unique: true,
    partialFilterExpression: { documentToken: { $type: "string" } },
  },
);

disputeSchema.index(
  { documentNumber: 1 },
  {
    name: "dispute_documentNumber_unique",
    unique: true,
    partialFilterExpression: { documentNumber: { $type: "string" } },
  },
);

module.exports = mongoose.model("Dispute", disputeSchema);
