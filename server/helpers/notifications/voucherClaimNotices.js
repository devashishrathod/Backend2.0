const { notify } = require("./notify");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_AUDIENCE,
} = require("../../constants/notification");
const {
  CUSTOMER_PATHS,
  PANEL_PATHS,
  deepLink,
  vendorUrl,
  customerUrl,
  documentUrl,
} = require("./panelLinks");
const {
  CUSTOMER_CURRENCY_DEFAULTS,
} = require("../../constants/customer");

const money = (amount) =>
  `${CUSTOMER_CURRENCY_DEFAULTS.currencySymbol}${Number(amount || 0).toLocaleString(
    "en-IN",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )}`;

/**
 * ⚠️ `formatDateTime`, and the time is the point.
 *
 * These are payment moments. A customer checking a receipt against a bank SMS,
 * or asking why a claim expired, is matching to the minute — and the old local
 * helper printed the **date only**, in the server's timezone. See
 * `formatDateTime.js`.
 */
const { formatDateTime } = require("./formatDateTime");

const onDate = (date) => formatDateTime(date || Date.now());

/**
 * Everything a voucher claim tells someone.
 *
 * Kept together for the same reason `subscriptionNotices.js` is: the wording of
 * a payment message is a product decision, and having it scattered through the
 * settle path means nobody can read what a customer actually receives without
 * reading the settle path.
 *
 * **Every function here is failure-tolerant** — `notify` never throws. A payment
 * that succeeded must not be rolled back because a message did not send.
 */

/**
 * The receipt. This is the one that carries the Download Invoice button.
 *
 * The button only renders when `PUBLIC_API_URL` is configured. Unset, the link
 * is omitted rather than rendered dead — and the boot log says so, so it is a
 * visible gap rather than a silent one.
 */
exports.notifyClaimPaid = async ({ claim, transaction }) => {
  const brandName = claim.brandSnapshot?.name || "the brand";
  const download = documentUrl(transaction.documentToken);

  return notify({
    customerId: claim.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.VOUCHER_PAYMENT_SUCCESS,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: `Payment successful at ${brandName}`,
    body:
      `You paid ${money(claim.pricing?.totalPayable)} at ${brandName} and saved ` +
      `${money(claim.pricing?.youSaved)}. Your claim code is ${claim.claimCode}.`,
    meta: {
      claimId: claim._id,
      claimCode: claim.claimCode,
      transactionId: transaction._id,
      invoiceId: transaction.invoiceId,
      amount: claim.pricing?.totalPayable,
      youSaved: claim.pricing?.youSaved,
    },
    // Opens the order in the app rather than a generic feed.
    deepLink: deepLink(CUSTOMER_PATHS.order(claim._id)),
    dedupeKey: `VOUCHER_PAID:${claim._id}`,
    mail: {
      lines: [
        ["Brand", brandName],
        ["Amount paid", money(claim.pricing?.totalPayable)],
        ["You saved", money(claim.pricing?.youSaved)],
        ["Invoice No", transaction.invoiceId || "-"],
        ["Date", onDate(claim.paidAt)],
        ["Claim code", claim.claimCode],
      ],
      /**
       * Two buttons, and the order is deliberate: the invoice is what this email
       * exists for, and the order screen is where everything else about the claim
       * lives — the code to show at the counter, the window it is valid in.
       *
       * Each is dropped independently when its base is unconfigured
       * (`PUBLIC_API_URL`, `CUSTOMER_APP_URL`), rather than the pair being
       * all-or-nothing.
       */
      actions: [
        ...(download ? [{ label: "Download Invoice", url: download }] : []),
        {
          label: "View your order",
          url: customerUrl(CUSTOMER_PATHS.order(claim._id)),
        },
      ],
    },
    // The WhatsApp template's URL button is approved against a fixed base with
    // only the last segment dynamic — so the token is passed, not a full URL.
    whatsappUrlParam: transaction.documentToken,
  });
};

/** The gateway refused, or the customer walked away and the sweep closed it. */
exports.notifyClaimFailed = async ({ claim, reason }) => {
  const brandName = claim.brandSnapshot?.name || "the brand";

  return notify({
    customerId: claim.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.VOUCHER_PAYMENT_FAILED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `Payment could not be completed`,
    body:
      `Your payment of ${money(claim.pricing?.totalPayable)} at ${brandName} did not go through` +
      `${reason ? ` — ${reason}` : ""}. Nothing has been charged.`,
    meta: { claimId: claim._id, claimCode: claim.claimCode, reason },
    // Back to the voucher, so they can try again rather than land on a dead end.
    deepLink: deepLink(CUSTOMER_PATHS.voucher(claim.voucherId)),
    dedupeKey: `VOUCHER_FAILED:${claim._id}`,
    mail: {
      lines: [
        ["Brand", brandName],
        ["Amount", money(claim.pricing?.totalPayable)],
        ["Reason", reason || "The payment was not completed"],
      ],
      // Back to the voucher, matching the deep link — so they can try again
      // rather than hunt for the offer a second time.
      ctaLabel: "Try again",
      ctaUrl: customerUrl(CUSTOMER_PATHS.voucher(claim.voucherId)),
    },
  });
};

/** Money went back. */
exports.notifyClaimRefunded = async ({
  claim,
  transaction,
  amount,
  reference,
  refundRequest,
}) => {
  const brandName = claim.brandSnapshot?.name || "the brand";

  /**
   * The refund document.
   *
   * ⚠️ A refund used to produce no paper at all — the customer got this message
   * and nothing they could keep, file, or show their bank. The document is issued
   * just before this notification is sent, so by the time the link is rendered it
   * exists. It is absent only when the issuing step failed, in which case the
   * button is dropped rather than rendered dead.
   */
  const download = documentUrl(refundRequest?.documentToken);

  return notify({
    customerId: claim.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.VOUCHER_REFUNDED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: `Refund issued for ${brandName}`,
    body:
      `${money(amount)} has been refunded for your claim ${claim.claimCode}. ` +
      `It usually reaches your account in 5–7 working days.`,
    meta: {
      claimId: claim._id,
      claimCode: claim.claimCode,
      transactionId: transaction?._id,
      amount,
      reference,
      refundRequestId: refundRequest?._id,
      documentNumber: refundRequest?.documentNumber,
    },
    deepLink: deepLink(CUSTOMER_PATHS.transaction(transaction?._id)),
    // One message per refund, not per retry of the job that sends it.
    dedupeKey: `VOUCHER_REFUNDED:${claim._id}:${reference || amount}`,
    mail: {
      lines: [
        ["Brand", brandName],
        ["Refund amount", money(amount)],
        ["Claim code", claim.claimCode],
        ...(refundRequest?.documentNumber
          ? [["Refund No", refundRequest.documentNumber]]
          : []),
        ...(reference ? [["Reference", reference]] : []),
      ],
      /**
       * The document first, then the screen — the same order the payment receipt
       * uses, and for the same reason: the paper is what this email is worth
       * keeping for. Each button is dropped independently when its base is
       * unconfigured, rather than the pair being all-or-nothing.
       */
      actions: [
        ...(download ? [{ label: "Download Refund Receipt", url: download }] : []),
        {
          label: "View refund",
          url: customerUrl(CUSTOMER_PATHS.transaction(transaction?._id)),
        },
      ],
    },
    // The WhatsApp template's URL button is approved against a fixed base with
    // only the last segment dynamic — so the token is passed, not a full URL.
    whatsappUrlParam: refundRequest?.documentToken,
  });
};

/**
 * To the **vendor**, not the customer.
 *
 * ⚠️ A brand taking fifty claims a day gets fifty of these. This is fine now and
 * will not be: at that volume it needs to become a per-outlet hourly digest.
 * Worth knowing before it becomes a complaint.
 */
exports.notifyVendorClaimReceived = async ({ claim }) => {
  return notify({
    brandId: claim.brandId,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.VOUCHER_CLAIM_RECEIVED,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: `New voucher claim at ${claim.outletSnapshot?.storeId || "your outlet"}`,
    body:
      `${claim.voucherSnapshot?.name || "A voucher"} was claimed for a bill of ` +
      `${money(claim.pricing?.billAmount)}. You will be paid ` +
      `${money(claim.pricing?.vendorPayable)} in your next settlement.`,
    meta: {
      claimId: claim._id,
      claimCode: claim.claimCode,
      outletId: claim.subBrandId,
      billAmount: claim.pricing?.billAmount,
      // The figure the vendor actually cares about, and the one a settlement
      // will later have to agree with.
      vendorPayable: claim.pricing?.vendorPayable,
    },
    deepLink: deepLink(PANEL_PATHS.DASHBOARD),
    dedupeKey: `VOUCHER_CLAIM_RECEIVED:${claim._id}`,
    mail: {
      lines: [
        ["Voucher", claim.voucherSnapshot?.name || "-"],
        ["Outlet", claim.outletSnapshot?.storeId || "-"],
        ["Bill amount", money(claim.pricing?.billAmount)],
        ["Your payable", money(claim.pricing?.vendorPayable)],
        ["Date", onDate(claim.paidAt)],
      ],
      ctaLabel: "Open Dashboard",
      ctaUrl: vendorUrl(PANEL_PATHS.DASHBOARD),
    },
  });
};

/** Phase 2: paid, never scanned, window closed. Inert until redemption splits. */
exports.notifyClaimExpired = async ({ claim }) => {
  const brandName = claim.brandSnapshot?.name || "the brand";

  return notify({
    customerId: claim.customerId,
    audience: NOTIFICATION_AUDIENCE.CUSTOMER,
    type: NOTIFICATION_TYPES.VOUCHER_CLAIM_EXPIRED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: `Your claim at ${brandName} has expired`,
    body:
      `Claim ${claim.claimCode} was not redeemed within its window. ` +
      `Contact support if you believe this is a mistake.`,
    meta: { claimId: claim._id, claimCode: claim.claimCode },
    deepLink: deepLink(CUSTOMER_PATHS.order(claim._id)),
    dedupeKey: `VOUCHER_EXPIRED:${claim._id}`,
    mail: {
      lines: [
        ["Brand", brandName],
        ["Claim code", claim.claimCode],
        ["Expired on", onDate(claim.expiresAt)],
      ],
      ctaLabel: "View your order",
      ctaUrl: customerUrl(CUSTOMER_PATHS.order(claim._id)),
    },
  });
};
