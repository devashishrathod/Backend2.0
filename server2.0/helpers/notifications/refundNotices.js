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
  CUSTOMER_PATHS,
  PANEL_PATHS,
  ADMIN_PATHS,
} = require("./panelLinks");
const { REFUND_CUSTOMER_LABEL } = require("../../constants/refund");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");

/**
 * ⚠️ `currencySymbol`, not `symbol`.
 *
 * Reading the wrong key does not throw — it prints `undefined810.00` on every
 * amount in every refund notice, in the push, the mail and the SMS alike. The
 * claim notices next door already had this right; this one did not, and only a
 * test that looked at the rendered string found it.
 */
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

/**
 * Refund notices.
 *
 * ### What the customer is told, and what they are not
 *
 * Every customer-facing line uses `REFUND_CUSTOMER_LABEL`, never the internal
 * status. `VENDOR_TIMEOUT` in particular becomes *"under review by Trydood"* —
 * telling a customer the outlet ignored their request starts a fight the
 * platform then has to referee, and it is not something they can act on. The
 * vendor's written note never reaches them either: it is staff-to-staff, and
 * *"customer collected the order in full"* is not a sentence to render to the
 * customer it is about.
 *
 * ### Why there is no notice for every state
 *
 * `PROCESSING` and `ADMIN_APPROVED` are real transitions with nothing for anyone
 * to do about them. A notification nobody can act on trains people to ignore the
 * ones that matter, and the ones that matter here are *"your money is coming
 * back"* and *"it failed, we are on it"*.
 *
 * Every notice carries a `dedupeKey` keyed on the request, so a retried job or a
 * redelivered webhook sends one message rather than one per attempt.
 */

/** To the **vendor**: somebody wants their money back, and the clock is running. */
exports.notifyVendorRefundRequested = async ({ request, claim }) => {
  return notify({
    brandId: request.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.REFUND_REQUESTED,
    // Not INFO: there is a deadline, and missing it takes the decision away.
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `Refund requested for ${claim?.claimCode || request.claimCode}`,
    body:
      `A customer has asked for ${money(request.requestedAmount)} back on a claim at ` +
      `${claim?.outletSnapshot?.storeId || "your outlet"}. ` +
      `Please respond by ${onDate(request.vendorRespondBy)} — after that it goes to Trydood.`,
    meta: {
      refundRequestId: request._id,
      claimId: request.claimId,
      claimCode: request.claimCode,
      amount: request.requestedAmount,
      reason: request.reason,
      respondBy: request.vendorRespondBy,
    },
    deepLink: deepLink(PANEL_PATHS.DASHBOARD),
    dedupeKey: `REFUND_REQUESTED:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Outlet", claim?.outletSnapshot?.storeId || "-"],
        ["Amount requested", money(request.requestedAmount)],
        ["Customer's reason", request.reasonNote || request.reason],
        ["Respond by", onDate(request.vendorRespondBy)],
      ],
      buttonText: "Review Refund",
      buttonUrl: vendorUrl(PANEL_PATHS.DASHBOARD),
    },
  });
};

/** To the **vendor**: the window is closing. */
exports.notifyVendorRefundReminder = async ({ request }) => {
  return notify({
    brandId: request.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.REFUND_REMINDER,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `Refund still waiting — ${request.claimCode}`,
    body:
      `${money(request.requestedAmount)} is waiting on your decision. ` +
      `If nobody responds by ${onDate(request.vendorRespondBy)} it goes to Trydood to decide.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      respondBy: request.vendorRespondBy,
    },
    deepLink: deepLink(PANEL_PATHS.DASHBOARD),
    /**
     * Keyed on the reminder **number**, not just the request — two nudges are
     * meant to arrive, and a key without the count would silence the second.
     */
    dedupeKey: `REFUND_REMINDER:${request._id}:${request.remindersSent || 0}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.requestedAmount)],
        ["Respond by", onDate(request.vendorRespondBy)],
      ],
      buttonText: "Review Refund",
      buttonUrl: vendorUrl(PANEL_PATHS.DASHBOARD),
    },
  });
};

/** To the **customer**: their request is in. */
exports.notifyCustomerRefundRequested = async ({ request }) => {
  return notify({
    customerId: request.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.REFUND_REQUESTED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "We have your refund request",
    body:
      `We have asked the outlet about your ${money(request.requestedAmount)} refund on ` +
      `${request.claimCode}. We will let you know as soon as there is an answer.`,
    meta: {
      refundRequestId: request._id,
      claimId: request.claimId,
      claimCode: request.claimCode,
      amount: request.requestedAmount,
      /**
       * The **label**, never the raw status.
       *
       * `meta` is not rendered by us, but it is handed to the client — and an
       * app that switches on `VENDOR_TIMEOUT` will eventually put those words in
       * front of the customer. Keeping the internal vocabulary out of the
       * payload entirely is the only version of this promise that cannot leak.
       */
      statusLabel: REFUND_CUSTOMER_LABEL[request.status],
    },
    deepLink: deepLink(CUSTOMER_PATHS.transaction(request.transactionId)),
    dedupeKey: `REFUND_REQUESTED:CUSTOMER:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.requestedAmount)],
        ["Status", REFUND_CUSTOMER_LABEL[request.status]],
      ],
    },
  });
};

/** To the **customer**: approved, money on the way. */
exports.notifyCustomerRefundApproved = async ({ request }) => {
  const amount = request.approvedAmount ?? request.requestedAmount;
  const isLess = amount < request.requestedAmount - 0.005;

  return notify({
    customerId: request.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.REFUND_APPROVED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "Your refund is approved",
    body: isLess
      ? // Said plainly. A customer who asked for ₹810 and receives ₹400 without
        // being told will open a second request and a support ticket.
        `${money(amount)} of the ${money(request.requestedAmount)} you asked for has been ` +
        `approved on ${request.claimCode}. It should reach you in 5–7 working days.`
      : `${money(amount)} has been approved on ${request.claimCode}. ` +
        `It should reach you in 5–7 working days.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      requestedAmount: request.requestedAmount,
      approvedAmount: amount,
      isPartialApproval: isLess,
    },
    deepLink: deepLink(CUSTOMER_PATHS.transaction(request.transactionId)),
    dedupeKey: `REFUND_APPROVED:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount requested", money(request.requestedAmount)],
        ["Amount approved", money(amount)],
      ],
    },
  });
};

/**
 * To the **customer**: declined.
 *
 * ⚠️ The vendor's note does **not** go in. It is written for staff, and *"the
 * customer collected the order in full"* is an accusation when rendered to the
 * customer. They get the label and a way to reach a person — which is the only
 * ending that works for the customer who was genuinely wronged and the one who
 * was not.
 */
/**
 * To the **customer**: we need a bank account to send the refund to.
 *
 * ### Why the wording matters more here than anywhere else in this file
 *
 * This is the only refund notice that asks the customer to act, and it asks for
 * bank details — which is exactly what a scam message asks for. Someone whose
 * refund has already failed once, now being asked for their account number, has
 * every reason to be suspicious.
 *
 * So it names the claim they made, says plainly that the money is still theirs,
 * gives the reason their original method did not work, and sends them into the
 * app rather than to a link that collects anything. The one thing it never does
 * is ask them to reply with details.
 */
exports.notifyRefundBankDetailsRequested = async ({ request }) => {
  return notify({
    customerId: request.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.REFUND_BANK_DETAILS_REQUESTED,
    // Not a warning: nothing has gone wrong for them, and alarming someone about
    // their own money is how a real message gets mistaken for a fake one.
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "We need your bank account to send your refund",
    body:
      `Your refund on ${request.claimCode} could not be sent back to the way you paid — ` +
      `${request.adminNote || "the original card or UPI is no longer reachable"}. ` +
      `The money is still yours. Add your bank account in the app and we will transfer it. ` +
      `We will never ask you for your details over a call or a message.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      amount: request.approvedAmount ?? request.requestedAmount,
      statusLabel: REFUND_CUSTOMER_LABEL[request.status],
    },
    // Into the app, never to a form on a link.
    deepLink: deepLink(CUSTOMER_PATHS.REFUNDS),
    dedupeKey: `REFUND_BANK_DETAILS:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.approvedAmount ?? request.requestedAmount)],
        ["What to do", "Open the Trydood app and add your bank account"],
      ],
    },
  });
};

/**
 * To the **customer**: a nudge, days after the first ask.
 *
 * ⚠️ Days apart, not hours. Someone already told their refund failed, then
 * pinged repeatedly for their account number, reads it as a scam — and the money
 * they are owed becomes the thing they least want to engage with. This says the
 * money is still waiting, and nothing more.
 */
exports.notifyRefundBankDetailsReminder = async ({ request, stage }) => {
  return notify({
    customerId: request.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.REFUND_BANK_DETAILS_REQUESTED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "Your refund is still waiting for you",
    body:
      `We still have ${money(request.approvedAmount ?? request.requestedAmount)} to send back ` +
      `for ${request.claimCode}. Add your bank account in the Trydood app and it will be transferred. ` +
      `We will never ask you for your details over a call or a message.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      amount: request.approvedAmount ?? request.requestedAmount,
      reminder: stage,
    },
    deepLink: deepLink(CUSTOMER_PATHS.REFUNDS),
    // Keyed on the stage, so the second nudge is a new message and a retried
    // sweep is not.
    dedupeKey: `REFUND_BANK_DETAILS_REMINDER:${request._id}:${stage}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.approvedAmount ?? request.requestedAmount)],
        ["What to do", "Open the Trydood app and add your bank account"],
      ],
    },
  });
};

/**
 * To an **admin**: nobody answered, and a vendor is paying for the silence.
 *
 * ⚠️ The customer's money is not in question — it stays theirs and the request
 * stays open. What has gone wrong is on the other side: `settlementHold` has kept
 * this payment out of every settlement since the day it failed, and it will keep
 * doing so for ever unless somebody looks.
 *
 * The way out is `PATCH /transactions/admin/:transactionId/release-hold` with a
 * written reason. That does **not** cancel the refund — if the customer ever does
 * answer, `claimRefundAdjustments` recovers the clawback from a later cycle.
 */
exports.notifyAdminBankDetailsStale = async ({ request, daysWaiting }) => {
  return notify({
    // ⚠️ `notify({ audience: ADMIN })`, matching every other admin notice in this
    // file — `notifyAdmins` is not imported here, and reaching for it would have
    // thrown on the first real alert and nowhere before.
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    type: NOTIFICATION_TYPES.REFUND_BANK_DETAILS_STALE,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `No bank details after ${daysWaiting} days — ${request.claimCode}`,
    body:
      `${money(request.approvedAmount ?? request.requestedAmount)} has been waiting on this ` +
      `customer's account details since ${onDate(request.bankDetailsRequestedAt)}. ` +
      `The vendor's settlement hold has been frozen that whole time. The refund stays owed either way — ` +
      `releasing the hold only stops the vendor paying for the wait.`,
    meta: {
      refundRequestId: request._id,
      transactionId: request.transactionId,
      claimCode: request.claimCode,
      amount: request.approvedAmount ?? request.requestedAmount,
      bankDetailsRequestedAt: request.bankDetailsRequestedAt,
      daysWaiting,
    },
    deepLink: deepLink(ADMIN_PATHS.refund(request._id)),
    dedupeKey: `REFUND_BANK_DETAILS_STALE:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.approvedAmount ?? request.requestedAmount)],
        ["Asked on", onDate(request.bankDetailsRequestedAt)],
        ["Waiting", `${daysWaiting} days`],
      ],
      buttonText: "Open refund",
      buttonUrl: adminUrl(ADMIN_PATHS.refund(request._id)),
    },
  });
};

exports.notifyCustomerRefundRejected = async ({ request }) => {
  return notify({
    customerId: request.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.REFUND_REJECTED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "About your refund request",
    body:
      `Your refund request on ${request.claimCode} was not approved. ` +
      `If you think that is wrong, write to us and we will look at it ourselves.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      // The label, never the raw status — see above.
      statusLabel: REFUND_CUSTOMER_LABEL[request.status],
    },
    deepLink: deepLink(CUSTOMER_PATHS.SUPPORT),
    dedupeKey: `REFUND_REJECTED:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount requested", money(request.requestedAmount)],
        ["Status", REFUND_CUSTOMER_LABEL[request.status]],
      ],
    },
  });
};

/**
 * To the **admin**: a refund needs a decision that is no longer the vendor's.
 *
 * `WARNING` rather than `INFO`: a customer has now been waiting a full window
 * with nobody answering, and the only person who can move it is reading this.
 */
exports.notifyAdminRefundEscalated = async ({ request }) => {
  return notify({
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    type: NOTIFICATION_TYPES.REFUND_ESCALATED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `Refund escalated — ${request.claimCode}`,
    body:
      `The outlet did not respond within the window. ` +
      `${money(request.requestedAmount)} is waiting on a decision.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      brandId: request.brandId,
      amount: request.requestedAmount,
      respondBy: request.vendorRespondBy,
    },
    deepLink: deepLink(ADMIN_PATHS.refund(request._id)),
    dedupeKey: `REFUND_ESCALATED:${request._id}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.requestedAmount)],
        ["Vendor deadline", onDate(request.vendorRespondBy)],
      ],
      buttonText: "Open Refunds",
      buttonUrl: adminUrl(ADMIN_PATHS.refund(request._id)),
    },
  });
};

/**
 * To the **admin**: the money did not go back.
 *
 * `CRITICAL`. A failed refund is a customer who has been told their money is
 * coming and is not getting it, and nothing else in the system will fix it —
 * only a person retrying or switching to a bank transfer.
 */
exports.notifyAdminRefundFailed = async ({ request, reason }) => {
  return notify({
    audience: NOTIFICATION_AUDIENCE.ADMIN,
    type: NOTIFICATION_TYPES.REFUND_FAILED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: `Refund FAILED — ${request.claimCode}`,
    body:
      `${money(request.approvedAmount ?? request.requestedAmount)} did not reach the customer. ` +
      `${reason || "Razorpay did not say why."} Attempt ${request.attemptCount || 1}.`,
    meta: {
      refundRequestId: request._id,
      claimCode: request.claimCode,
      brandId: request.brandId,
      amount: request.approvedAmount ?? request.requestedAmount,
      reason,
      attemptCount: request.attemptCount,
    },
    deepLink: deepLink(ADMIN_PATHS.refund(request._id)),
    /**
     * Keyed on the **attempt**, not the request. Each failed retry is news —
     * a key without it would silence every failure after the first, which is
     * exactly the one that says the instrument cannot take the money back.
     */
    dedupeKey: `REFUND_FAILED:${request._id}:${request.attemptCount || 1}`,
    mail: {
      lines: [
        ["Claim code", request.claimCode || "-"],
        ["Amount", money(request.approvedAmount ?? request.requestedAmount)],
        ["Reason", reason || "-"],
        ["Attempt", String(request.attemptCount || 1)],
      ],
      buttonText: "Open Refunds",
      buttonUrl: adminUrl(ADMIN_PATHS.refund(request._id)),
    },
  });
};
