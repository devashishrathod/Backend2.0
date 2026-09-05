const { notifyAdmins } = require("./notifyAdmins");
const { notify } = require("./notify");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_AUDIENCE,
} = require("../../constants/notification");
const {
  deepLink,
  adminUrl,
  vendorUrl,
  ADMIN_PATHS,
  PANEL_PATHS,
} = require("./panelLinks");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");

/** ⚠️ `currencySymbol`, not `symbol` — see the note in `refundNotices.js`. */
const money = (amount) =>
  `${CUSTOMER_CURRENCY_DEFAULTS.currencySymbol}${Number(amount || 0).toLocaleString(
    "en-IN",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

/**
 * ⚠️ `formatDateTime` — and on this file it matters most.
 *
 * The helper it replaces had no `timeZone`, so a dispute's `respondBy` printed in
 * the server's zone (UTC in production): five and a half hours off, on a deadline
 * whose whole property is that **missing it loses the money automatically**. The
 * bank does not ask twice. See `formatDateTime.js`.
 */
const { formatDateTime } = require("./formatDateTime");

const onDate = formatDateTime;

/**
 * A dispute response deadline is close, or has passed.
 *
 * ### Why this is CRITICAL rather than a nudge
 *
 * Every other money alert here is about something that can be fixed later. This
 * one cannot: a dispute deadline that passes is an **automatic loss**. The bank
 * does not ask twice, Razorpay does not chase, and the money is simply gone —
 * with no error raised anywhere, because from the system's point of view nothing
 * happened at all.
 *
 * ### Why it names the amount and the payment
 *
 * The person who reads it has to decide, right then, whether to spend an hour
 * gathering evidence. That decision needs the number and the claim; an alert
 * that says only "a dispute needs attention" gets triaged to later, and later is
 * the failure mode.
 *
 * @param {object} args
 * @param {object} args.transaction  the disputed Transaction
 * @param {number} args.hoursLeft    negative once the deadline has passed
 * @param {boolean} args.isOverdue
 */
exports.notifyDisputeDeadline = async ({
  transaction,
  hoursLeft,
  isOverdue = false,
}) => {
  const amount = transaction?.disputeAmount || transaction?.amount;
  const reference =
    transaction?.voucher?.claimCode ||
    transaction?.razorpayPaymentId ||
    transaction?._id;

  const when = onDate(transaction?.disputeRespondBy);
  const remaining = Math.max(0, Math.round(hoursLeft));

  const title = isOverdue
    ? `Dispute deadline PASSED — ${reference}`
    : `Dispute response due in ${remaining}h — ${reference}`;

  const body = isOverdue
    ? `The response window for ${money(amount)} closed on ${when}. ` +
      `An unanswered dispute is lost by default — check with Razorpay whether anything can still be filed.`
    : `${money(amount)} is disputed and the response is due by ${when}. ` +
      `Missing it forfeits the money; nothing will chase this but us.`;

  return notifyAdmins({
    type: NOTIFICATION_TYPES.DISPUTE_DEADLINE,
    title,
    body,
    /**
     * The first warning is a WARNING; everything after it is CRITICAL.
     *
     * Sending CRITICAL three days out would train people to skim it, and the
     * one that matters is the last one.
     */
    severity: isOverdue
      ? NOTIFICATION_SEVERITY.CRITICAL
      : remaining <= 24
        ? NOTIFICATION_SEVERITY.CRITICAL
        : NOTIFICATION_SEVERITY.WARNING,
    meta: {
      transactionId: transaction?._id,
      disputeId: transaction?.disputeId,
      disputeStatus: transaction?.disputeStatus,
      disputeAmount: amount,
      disputeRespondBy: transaction?.disputeRespondBy,
      hoursLeft: Math.round(hoursLeft),
      isOverdue,
    },
    deepLink: deepLink(ADMIN_PATHS.dispute(transaction?._id)),
    /**
     * Keyed on the stage as well as the dispute, so the 72h warning and the 24h
     * one are two different messages — and a retried job still sends only one of
     * each.
     */
    dedupeKey: `DISPUTE_DEADLINE:${transaction?._id}:${
      isOverdue ? "OVERDUE" : remaining <= 24 ? "24H" : "72H"
    }`,
    mail: {
      lines: [
        ["Payment", transaction?.razorpayPaymentId || "-"],
        ["Claim", transaction?.voucher?.claimCode || "-"],
        ["Amount", money(amount)],
        ["Status", transaction?.disputeStatus || "-"],
        ["Respond by", when],
      ],
      ctaLabel: "Open dispute",
      ctaUrl: adminUrl(ADMIN_PATHS.dispute(transaction?._id)),
    },
  });
};

/**
 * To the **vendor**: a customer's bank has pulled back one of their sales.
 *
 * ### ⚠️ Why this has to exist
 *
 * Until now the vendor was told nothing at all. A dispute landed, the payment
 * quietly stopped appearing in any settlement, and weeks later a statement
 * carried *"Less: chargebacks recovered"* with no sale attached to it. From the
 * outlet's side that is money taken without explanation — however correct the
 * arithmetic was — and it is the fastest way to lose their trust.
 *
 * ### What it asks for, and what it does not
 *
 * It names the claim and the amount, says plainly that we are contesting it, and
 * invites anything only they have: the kitchen ticket, a camera timestamp, what
 * the staff remember.
 *
 * ⚠️ Invites, not demands. `buildEvidencePack` stands on our own records — on
 * this platform the voucher is paid for at the counter, so the payment itself
 * places the customer there. Filing never waits on the outlet, because a dispute
 * gets **one** response and the deadline is the bank's. Telling them their reply
 * is required would be untrue, and would make a silent outlet feel like the
 * reason a dispute was lost when it was not.
 *
 * @param {object} args
 * @param {object} args.dispute
 * @param {object} args.transaction
 * @param {string} [args.claimCode]
 */
exports.notifyVendorDisputeRaised = async ({
  dispute,
  transaction,
  claimCode,
}) => {
  const reference = claimCode || transaction?.invoiceId || dispute?.disputeId;
  const amount = dispute?.amount || transaction?.paidAmount || transaction?.amount;

  return notify({
    brandId: transaction?.brandId || dispute?.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.DISPUTE_RAISED_VENDOR,
    /**
     * A warning, not a critical. There is nothing they must drop everything for
     * — we contest it either way — and a CRITICAL that needs no action is how a
     * channel gets muted before the one that matters arrives.
     */
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `A customer's bank has disputed ${money(amount)} — ${reference}`,
    body:
      `The customer for ${reference} has raised a chargeback with their bank, so ` +
      `${money(amount)} has been pulled back from us. This payment is held out of ` +
      `your payouts until it is settled — it is not lost. ` +
      `We are contesting it with the payment and redemption records we hold. ` +
      `If you have anything from that visit — a bill or KOT number, a camera ` +
      `timestamp, what the staff remember — adding it helps.`,
    meta: {
      disputeId: dispute?.disputeId,
      transactionId: transaction?._id,
      claimCode,
      amount,
      respondBy: dispute?.respondBy,
    },
    deepLink: deepLink(PANEL_PATHS.dispute(dispute?._id)),
    dedupeKey: `DISPUTE_RAISED_VENDOR:${dispute?.disputeId}`,
    mail: {
      lines: [
        ["Claim", reference || "-"],
        ["Amount", money(amount)],
        ["Status", "Held while we contest it"],
        ["What helps", "Bill / KOT number, camera timestamp, staff account"],
      ],
      ctaLabel: "Open dispute",
      ctaUrl: vendorUrl(PANEL_PATHS.dispute(dispute?._id)),
    },
  });
};

/**
 * To the **vendor**: how it ended.
 *
 * ⚠️ Both endings need saying, and for different reasons.
 *
 * **Won** — the money is theirs again, but the settlement hold does **not** lift
 * by itself; an admin has to release it. Saying "we won" and then not paying for
 * another week is worse than saying nothing, so this says what actually happens
 * next.
 *
 * **Lost** — this is the message that stops the deduction appearing from
 * nowhere. It names the sale, the amount, and that it will come off a future
 * payout. Without it, `"Less: chargebacks recovered"` on a statement is a number
 * with no story.
 */
exports.notifyVendorDisputeResolved = async ({
  dispute,
  transaction,
  claimCode,
  won,
  recoverable = true,
}) => {
  const reference = claimCode || transaction?.invoiceId || dispute?.disputeId;
  const amount = dispute?.amount || transaction?.paidAmount;

  return notify({
    brandId: transaction?.brandId || dispute?.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.DISPUTE_RESOLVED_VENDOR,
    severity: won
      ? NOTIFICATION_SEVERITY.INFO
      : NOTIFICATION_SEVERITY.WARNING,
    title: won
      ? `Chargeback on ${reference} was decided in your favour`
      : `Chargeback on ${reference} was upheld — ${money(amount)}`,
    body: won
      ? `The bank ruled in our favour on ${reference}. The ${money(amount)} stays ` +
        `yours. The payment is being released back into your payouts — you will ` +
        `see it in an upcoming settlement.`
      : recoverable
        ? `The bank ruled for the customer on ${reference}, so ${money(amount)} has ` +
          `been taken back from us. Your share of that sale will be deducted from an ` +
          `upcoming payout, shown on the statement as "chargebacks recovered". ` +
          `Only your share is deducted — our fee and our part of any promotion are not.`
        : `The bank ruled for the customer on ${reference}. Because this sale had ` +
          `not been paid out to you yet, nothing will be deducted from your payouts — ` +
          `the payment simply will not be settled.`,
    meta: {
      disputeId: dispute?.disputeId,
      transactionId: transaction?._id,
      claimCode,
      amount,
      won,
      recoverable,
    },
    deepLink: deepLink(PANEL_PATHS.dispute(dispute?._id)),
    dedupeKey: `DISPUTE_RESOLVED_VENDOR:${dispute?.disputeId}:${won ? "WON" : "LOST"}`,
    mail: {
      lines: [
        ["Claim", reference || "-"],
        ["Amount", money(amount)],
        ["Outcome", won ? "Decided in your favour" : "Upheld for the customer"],
        [
          "What happens next",
          won
            ? "Released back into an upcoming payout"
            : recoverable
              ? "Your share is deducted from an upcoming payout"
              : "Nothing to deduct — it was never paid out",
        ],
      ],
      ctaLabel: "Open dispute",
      ctaUrl: vendorUrl(PANEL_PATHS.dispute(dispute?._id)),
    },
  });
};
