const { notify } = require("./notify");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  deepLink,
  vendorUrl,
  adminUrl,
  PANEL_PATHS,
  ADMIN_PATHS,
} = require("./panelLinks");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");

/** ⚠️ `currencySymbol`, not `symbol` — see the note in `refundNotices.js`. */
const money = (amount) =>
  `${CUSTOMER_CURRENCY_DEFAULTS.currencySymbol}${Number(amount || 0).toLocaleString(
    "en-IN",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

const onDate = (date) =>
  date
    ? new Date(date).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";

const forPeriod = (settlement) =>
  `${new Date(settlement.periodStart).toLocaleDateString("en-IN", {
    dateStyle: "medium",
  })} – ${new Date(settlement.periodEnd).toLocaleDateString("en-IN", {
    dateStyle: "medium",
  })}`;

/**
 * Settlement notices.
 *
 * ### What the vendor is told
 *
 * Three things, and only three: **the money went**, **it bounced**, and **it is
 * held while we check something**. Everything else in the state machine —
 * `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `CARRIED_FORWARD` — is either
 * invisible to them or not actionable, and a payout that is merely *scheduled*
 * is not news. Sending one anyway would train them to ignore the message that
 * says their money bounced.
 *
 * ### What the vendor is never told
 *
 * `needsRevalidation`, `taintedTransactionIds` and `failureNote` do not appear
 * in any line here, the same way they do not appear in the projection. *"Three
 * of your payments are being revalidated"* invites the question *"which?"*, and
 * the answer is usually a chargeback nobody has decided yet. `ON_HOLD` with a
 * date is the honest version.
 *
 * Every notice carries a `dedupeKey` keyed on the settlement, so a retried job
 * or a re-run sweep sends one message rather than one per attempt.
 */

/**
 * To the **vendor**: the money has left, and here is how to find it.
 *
 * The UTR is the point of this message. Without it, "we paid you" and "we did
 * not pay you" look identical from the vendor's side of a bank statement, and
 * every query becomes a phone call.
 */
exports.notifyVendorSettlementPaid = async ({ settlement, utr }) => {
  return notify({
    brandId: settlement.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.SETTLEMENT_PAID,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: `${money(settlement.netPayable)} sent to your bank`,
    body:
      `Your payout for ${forPeriod(settlement)} is on its way to the account ending ` +
      `${settlement.bankSnapshot?.accountLast4Digits || "on file"}. ` +
      (utr ? `Bank reference: ${utr}.` : ""),
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      amount: settlement.netPayable,
      utr,
    },
    deepLink: deepLink(PANEL_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_PAID:${settlement._id}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Period", forPeriod(settlement)],
        ["Amount", money(settlement.netPayable)],
        ["Bank reference (UTR)", utr || "-"],
      ],
      buttonText: "View settlement",
      buttonUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **vendor**: the transfer came back.
 *
 * ⚠️ `failureReason` — the category — and never `failureNote`, which is written
 * staff-to-staff. The vendor needs to know whether *they* have something to fix
 * (a closed account, a wrong IFSC) or whether we do, and the category says that
 * without quoting an internal note at them.
 */
exports.notifyVendorSettlementFailed = async ({ settlement, reason }) => {
  return notify({
    brandId: settlement.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    // They may have to fix a bank detail, and until they do nothing moves.
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.SETTLEMENT_FAILED,
    title: `Your payout of ${money(settlement.netPayable)} did not go through`,
    body:
      `The transfer for ${forPeriod(settlement)} was returned by the bank. ` +
      `We are on it — please check the account ending ` +
      `${settlement.bankSnapshot?.accountLast4Digits || "on file"} is still open.`,
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      amount: settlement.netPayable,
      reason: reason || settlement.failureReason,
    },
    deepLink: deepLink(PANEL_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_FAILED:${settlement._id}:${settlement.attemptCount || 0}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Amount", money(settlement.netPayable)],
        ["Reason", reason || settlement.failureReason || "Returned by the bank"],
      ],
      buttonText: "View settlement",
      buttonUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **vendor**: it is held while we check something.
 *
 * No detail, deliberately. What is actually being checked is a disputed payment
 * or a refund we have not resolved, and naming it turns a two-day delay into an
 * argument about a chargeback nobody has ruled on yet. Support can explain when
 * asked — which is a conversation with a person in it, not a push notification.
 */
exports.notifyVendorSettlementOnHold = async ({ settlement }) => {
  return notify({
    brandId: settlement.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.SETTLEMENT_ON_HOLD,
    title: "Your payout is on hold while we check it",
    body:
      `The payout for ${forPeriod(settlement)} is being reviewed before it goes out. ` +
      `Nothing is lost — it will either be released or carried into your next payout.`,
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      amount: settlement.netPayable,
    },
    deepLink: deepLink(PANEL_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_ON_HOLD:${settlement._id}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Period", forPeriod(settlement)],
        ["Amount", money(settlement.netPayable)],
      ],
      buttonText: "View settlement",
      buttonUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **admin**: a payout left and nobody confirmed it.
 *
 * `MANUAL_BANK` has no callback — a person reading their banking screen *is* the
 * confirmation. So a NEFT started at 4pm and forgotten leaves the settlement
 * `PROCESSING` for ever: the vendor reads "on its way to your bank" indefinitely,
 * the ledger has no `PAYOUT` row, and the next cycle's build skips these rows
 * because they are still claimed. Nothing errors. It simply stops.
 *
 * Which is exactly the failure this platform is worst at noticing, so it gets a
 * notification rather than a log line.
 */
exports.notifyAdminSettlementStuck = async ({ settlement, leg, hours }) => {
  return notify({
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.SETTLEMENT_STUCK,
    title: `Unconfirmed payout — ${settlement.settlementNumber || settlement._id}`,
    body:
      `Leg ${leg?.legNumber || 1} of ${money(leg?.amount ?? settlement.netPayable)} has been ` +
      `in flight for ${hours}h with no UTR recorded. Confirm it, or mark it failed.` +
      /**
       * ⚠️ An `APPROVED` settlement with a leg in flight is a different fault
       * from a `PROCESSING` one: `startPayout` created the leg and then died
       * before moving the status. Named, because the two need different checks —
       * here the NEFT was very likely never keyed in at all, and confirming it
       * would record money that never moved.
       */
      (settlement.status === SETTLEMENT_STATUS.APPROVED
        ? ` ⚠️ This settlement is still APPROVED, not PROCESSING — the payout was ` +
          `interrupted as it started, so check your banking screen before confirming: ` +
          `the transfer may never have been made.`
        : ""),
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      payoutLegId: leg?._id,
      amount: leg?.amount ?? settlement.netPayable,
      initiatedAt: leg?.initiatedAt,
    },
    deepLink: deepLink(ADMIN_PATHS.settlement(settlement._id)),
    /**
     * Keyed on the **leg**, not the settlement: a retry opens a new leg, and a
     * second leg going quiet is a second thing to look at, not a repeat of the
     * first.
     */
    dedupeKey: `SETTLEMENT_STUCK:${leg?._id || settlement._id}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Leg", String(leg?.legNumber ?? 1)],
        ["Amount", money(leg?.amount ?? settlement.netPayable)],
        ["Started", onDate(leg?.initiatedAt)],
      ],
      buttonText: "Open settlement",
      buttonUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **admin**: money owed for longer than we said it would take.
 *
 * The vendor has not complained yet, and that is the point — this fires from our
 * side so the first person to know is not the one waiting for the money.
 */
exports.notifyAdminSettlementLate = async ({ settlement, hours }) => {
  return notify({
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.SETTLEMENT_LATE,
    title: `Payout overdue — ${settlement.settlementNumber || settlement._id}`,
    body:
      `${money(settlement.netPayable)} has been sitting at ${settlement.status} for ${hours}h. ` +
      `The vendor has not been paid for ${forPeriod(settlement)}.`,
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      brandId: settlement.brandId,
      status: settlement.status,
      amount: settlement.netPayable,
    },
    deepLink: deepLink(ADMIN_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_LATE:${settlement._id}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Status", settlement.status],
        ["Amount", money(settlement.netPayable)],
        ["Period", forPeriod(settlement)],
      ],
      buttonText: "Open settlement",
      buttonUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **admin**: the books and the bank transfers disagree.
 *
 * `CRITICAL`, and the only notice here that is. Every other state in this file
 * is money in a place we understand; this one means a `PAYOUT` entry exists for
 * money no leg carried, or a leg carried money no entry booked — and one of the
 * two is wrong about a transfer that has physically happened.
 */
exports.notifyAdminSettlementLedgerDrift = async ({ settlement, legTotal, ledgerTotal }) => {
  const gap = Number((legTotal - ledgerTotal).toFixed(2));

  return notify({
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    type: NOTIFICATION_TYPES.SETTLEMENT_LEDGER_DRIFT,
    title: `Ledger drift on ${settlement.settlementNumber || settlement._id}`,
    body:
      `The payout legs add up to ${money(legTotal)} but the ledger books ${money(ledgerTotal)} — ` +
      `a gap of ${money(Math.abs(gap))}.`,
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      legTotal,
      ledgerTotal,
      gap,
    },
    deepLink: deepLink(ADMIN_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_LEDGER_DRIFT:${settlement._id}:${gap}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Legs paid", money(legTotal)],
        ["Ledger booked", money(ledgerTotal)],
        ["Gap", money(Math.abs(gap))],
      ],
      buttonText: "Open settlement",
      buttonUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
    },
  });
};
