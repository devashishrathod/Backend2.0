const { notify } = require("./notify");
/**
 * ### ⚠️ An admin notice goes through `notifyAdmins`, never `notify`
 *
 * `notify({ audience: ADMIN })` looks like it addresses the admin team. It does
 * not address anybody. `resolveRecipient` builds its destination from
 * `brandId` / `customerId` / `userId`, and an admin notice passes none of them —
 * so `recipient.email` is `null`, the email block returns early, and
 * `dispatchPush([null])` finds no devices. The row lands in the admin feed and
 * **nothing is delivered**: no email, no push.
 *
 * Four notices in this file were written that way, including
 * `SETTLEMENT_LEDGER_DRIFT`, which is CRITICAL and means the books and the bank
 * disagree about money that has physically moved. An admin who was not looking
 * at the panel never learned.
 *
 * `notifyAdmins` fans out to one row **per active admin**, each with a real
 * `userId`, so email and push have somewhere to go — and so each admin's own
 * `notificationPreferences` are consulted for their own copy.
 */
const { notifyAdmins } = require("./notifyAdmins");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  deepLink,
  vendorUrl,
  adminUrl,
  documentUrl,
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

/** Notice bodies quote money, so the arithmetic in them rounds like the ledger. */
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * ⚠️ One formatter, and it names the timezone — see `formatDateTime.js`.
 *
 * The two helpers this replaces called `toLocaleString` / `toLocaleDateString`
 * with no `timeZone`, so both formatted in the server's zone (UTC in
 * production). `onDate` is used for a payout **leg's** `initiatedAt`, which is
 * how an admin decides whether a NEFT is stale — off by five and a half hours
 * either way.
 *
 * A **period** stays date-only. It runs to the end of its last day, and
 * `31 Aug 2026 11:59 PM` invites a question about that last minute.
 */
const { formatDateTime, formatDateRange } = require("./formatDateTime");

const onDate = formatDateTime;

const forPeriod = (settlement) =>
  formatDateRange(settlement.periodStart, settlement.periodEnd);

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
  /**
   * The payout statement, with the commission tax invoice inside it.
   *
   * ⚠️ This email had no link to it. The token is minted and the statement
   * frozen the moment the settlement becomes `PAID` — which is exactly when this
   * message goes out — and the vendor was still sent only to a panel screen. The
   * one document that explains why ₹10,000 of sales paid out ₹8,820 was reachable
   * only by someone who already knew to go looking for it.
   *
   * Dropped rather than rendered dead when the statement could not be frozen or
   * `PUBLIC_API_URL` is unset.
   */
  const download = documentUrl(settlement.documentToken);

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
      commissionInvoiceNumber: settlement.commissionInvoiceNumber,
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
        /**
         * Only when commission was actually charged. The rate is zero today, so
         * a line naming an invoice number that does not exist would be worse
         * than no line.
         */
        ...(settlement.commissionInvoiceNumber
          ? [["Commission invoice", settlement.commissionInvoiceNumber]]
          : []),
      ],
      /**
       * The statement first, then the panel — the same order every other
       * document email uses, and for the same reason: the paper is what this
       * email is worth keeping for. Each is dropped independently when its base
       * is unconfigured.
       */
      actions: [
        ...(download ? [{ label: "Download Statement", url: download }] : []),
        {
          label: "View settlement",
          url: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
        },
      ],
    },
    // The WhatsApp template's URL button is approved against a fixed base with
    // only the last segment dynamic — so the token is passed, not a full URL.
    whatsappUrlParam: settlement.documentToken,
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
      ctaLabel: "View settlement",
      ctaUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
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
      ctaLabel: "View settlement",
      ctaUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
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
  return notifyAdmins({
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
      ctaLabel: "Open settlement",
      ctaUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
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
  return notifyAdmins({
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
      ctaLabel: "Open settlement",
      ctaUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
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

  return notifyAdmins({
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
      ctaLabel: "Open settlement",
      ctaUrl: adminUrl(ADMIN_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **vendor**: this cycle paid nothing, and here is why.
 *
 * ### ⚠️ The one `CARRIED_FORWARD` worth sending
 *
 * Two very different outcomes wear that status, and only one of them is news:
 *
 *  - **Below the minimum.** Routine, rolls into the next cycle, silent — sending
 *    it would train them to ignore the message that matters.
 *  - **Deductions outran the takings.** They traded, they expected money, none
 *    came, and until this existed *nothing said so*. From their side that is
 *    indistinguishable from a payout that quietly failed, and the first anybody
 *    heard was a support call — usually weeks later, usually about a chargeback
 *    whose deadline had already gone.
 *
 * So the caller sends this only for the second, and the body names the actual
 * cause rather than the status. "Carried forward" is our word for it; "a refund
 * and a chargeback came to more than this period's sales" is theirs.
 *
 * ⚠️ It says the balance **follows them into the next cycle**, because that is
 * true and because the alternative reading — that they now owe us a payment — is
 * the one people jump to. Nothing here asks them for money.
 */
exports.notifyVendorSettlementCarriedForward = async ({
  settlement,
  refundAdjustment = 0,
  chargebackAdjustment = 0,
}) => {
  const deductions = round2(refundAdjustment + chargebackAdjustment);
  const shortfall = round2(Math.abs(Number(settlement.netPayable) || 0));

  const parts = [];
  if (chargebackAdjustment > 0) {
    parts.push(`${money(chargebackAdjustment)} in chargebacks`);
  }
  if (refundAdjustment > 0) parts.push(`${money(refundAdjustment)} in refunds`);

  return notify({
    brandId: settlement.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    /**
     * WARNING, not INFO. Nothing is broken, but a payout they were expecting is
     * not coming and the reason usually predates this cycle — that is worth
     * surfacing above the fold rather than filing beside a receipt.
     */
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.SETTLEMENT_CARRIED_FORWARD,
    title: `No payout for ${forPeriod(settlement)}`,
    /**
     * ⚠️ Two different endings, because ₹0.00 and −₹450 are different news.
     *
     * A cycle that nets to **exactly** zero is settled: the sales covered the
     * deductions and nothing is left over. Telling that vendor "the remaining
     * ₹0.00 carries into your next settlement" is a sentence that means nothing
     * and reads like a system with a bug in it.
     */
    body:
      `${parts.length ? parts.join(" and ") : `${money(deductions)} in deductions`} ` +
      (shortfall > 0
        ? `came to more than this period's sales, so there is nothing to pay out. ` +
          `The remaining ${money(shortfall)} carries into your next settlement and ` +
          `comes off future sales — there is nothing to pay us and nothing you need to do.`
        : `came to exactly this period's sales, so there is nothing left to pay out. ` +
          `Nothing carries forward and there is nothing you need to do.`),
    meta: {
      settlementId: settlement._id,
      settlementNumber: settlement.settlementNumber,
      netPayable: settlement.netPayable,
      refundAdjustment,
      chargebackAdjustment,
    },
    deepLink: deepLink(PANEL_PATHS.settlement(settlement._id)),
    dedupeKey: `SETTLEMENT_CARRIED_FORWARD:${settlement._id}`,
    mail: {
      lines: [
        ["Settlement", settlement.settlementNumber || "-"],
        ["Period", forPeriod(settlement)],
        ["Sales this period", money(settlement.grossCollected)],
        ["Refunds deducted", money(refundAdjustment)],
        ["Chargebacks deducted", money(chargebackAdjustment)],
        ["Carried into next settlement", money(shortfall)],
      ],
      ctaLabel: "View statement",
      ctaUrl: vendorUrl(PANEL_PATHS.settlement(settlement._id)),
    },
  });
};

/**
 * To the **admin**: a brand's deductions that no cycle can reach.
 *
 * ⚠️ This is the alert for a failure whose whole signature is *nothing
 * happening*. A negative `netPayable` carries forward, and carrying forward
 * releases every claim it held — correct while the brand still trades, because
 * new sales net it off. The day they stop trading the same rows are claimed and
 * released every cycle, for ever: nothing errors, nothing is logged, and the
 * money sits on our books as a receivable from somebody who is not coming back.
 *
 * Keyed on the brand and the day, so a brand in this state produces one message
 * a day rather than one per sweep — and stops producing them the moment the debt
 * is collected or written off.
 */
exports.notifyAdminVendorDebtAged = async ({
  brandId,
  brandName,
  outstanding,
  ageDays,
  counts = {},
  writeOffDays,
}) => {
  const what = [
    counts.disputes ? `${counts.disputes} chargeback(s)` : null,
    counts.refunds ? `${counts.refunds} refund clawback(s)` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  /**
   * ### 🔴 `brandId` used to be passed here, and it sent this to the vendor
   *
   * `notify({ brandId, audience: ADMIN })` reads as *"an admin notice, about
   * this brand"*. It is not what the code did. `resolveRecipient(brandId)`
   * resolves the **brand's own email**, so the row landed in the admin feed
   * while the message was delivered to the outlet it is about — carrying an
   * internal figure and the sentence *"Collect it, or write it off."*
   *
   * A vendor reading that could reasonably conclude the debt had been forgiven.
   *
   * The brand is still identified: it is in `meta.brandId` and named in the
   * title. What is gone is the accidental addressing.
   */
  return notifyAdmins({
    severity: NOTIFICATION_SEVERITY.WARNING,
    type: NOTIFICATION_TYPES.VENDOR_DEBT_AGED,
    title: `${money(outstanding)} unrecovered from ${brandName || brandId}`,
    body:
      `${what || "Deductions"} totalling ${money(outstanding)} have gone unclaimed for ` +
      `${ageDays} days — past the ${writeOffDays}-day mark. Every cycle claims them, ` +
      `nets negative, carries forward and releases them again, so this will not ` +
      `resolve on its own unless the brand starts trading again. Collect it, or write it off.`,
    meta: { brandId, outstanding, ageDays, ...counts },
    deepLink: deepLink(ADMIN_PATHS.SETTLEMENTS),
    // One a day per brand — the state is static, so anything tighter is noise.
    dedupeKey: `VENDOR_DEBT_AGED:${brandId}:${new Date().toISOString().slice(0, 10)}`,
    mail: {
      lines: [
        ["Brand", brandName || String(brandId)],
        ["Outstanding", money(outstanding)],
        ["Oldest item", `${ageDays} days`],
        ["Chargebacks", String(counts.disputes || 0)],
        ["Refund clawbacks", String(counts.refunds || 0)],
      ],
      ctaLabel: "Open settlements",
      ctaUrl: adminUrl(ADMIN_PATHS.SETTLEMENTS),
    },
  });
};
