const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { SUBSCRIPTION_ACTION } = require("../../constants/subscription");
const { notify } = require("./notify");
const { formatMoney } = require("../subscribeds/buildOrderSummary");

const asDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "-";

/**
 * WhatsApp template variables, per notification type.
 *
 * **This table is the contract with Meta.** A WhatsApp Business template is
 * approved with a fixed number of positional variables, so the order and the
 * count below are what each template must be written against. Get them wrong and
 * the message is either rejected or reads with the values in the wrong slots.
 *
 * | Env var (`WHATSAPP_TEMPLATE_…`)  | Vars | Order                            |
 * |----------------------------------|------|----------------------------------|
 * | `SUBSCRIPTION_ACTIVATED`         | 2    | plan, valid till                 |
 * | `SUBSCRIPTION_RENEWED`           | 2    | plan, valid till                 |
 * | `SUBSCRIPTION_UPGRADED`          | 2    | plan, valid till                 |
 * | `SUBSCRIPTION_DOWNGRADED`        | 2    | plan, valid till                 |
 * | `SUBSCRIPTION_GRANTED`           | 2    | plan, valid till                 |
 * | `SUBSCRIPTION_EXPIRING`          | 3    | plan, days left, end date        |
 * | `SUBSCRIPTION_EXPIRED`           | 2    | plan, end date                   |
 * | `SUBSCRIPTION_CANCELLED`         | 1    | plan                             |
 *
 * Example body for `SUBSCRIPTION_EXPIRING`:
 *
 *   "Your {{1}} plan ends in {{2}} day(s), on {{3}}. Renew to keep adding
 *    outlets, vouchers and showcase content."
 *
 * The brand name is deliberately *not* a variable. These read as addressed to the
 * vendor ("Your Advanced plan…"), which needs one fewer approved variable and one
 * fewer thing that can be missing.
 *
 * A type whose env var is unset simply does not send on WhatsApp — so templates
 * can be switched on one at a time as Meta approves them.
 */
const panelUrlPath = (path) => (process.env.VENDOR_PANEL_URL ? path : undefined);

const ACTION_COPY = Object.freeze({
  [SUBSCRIPTION_ACTION.NEW]: {
    type: NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED,
    title: "Your subscription is active",
    verb: "activated",
  },
  [SUBSCRIPTION_ACTION.RENEW]: {
    type: NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED,
    title: "Your subscription has been renewed",
    verb: "renewed",
  },
  [SUBSCRIPTION_ACTION.UPGRADE]: {
    type: NOTIFICATION_TYPES.SUBSCRIPTION_UPGRADED,
    title: "Your plan has been upgraded",
    verb: "upgraded",
  },
  [SUBSCRIPTION_ACTION.DOWNGRADE]: {
    type: NOTIFICATION_TYPES.SUBSCRIPTION_DOWNGRADED,
    title: "Your plan has been changed",
    verb: "changed",
  },
});

/**
 * Notify a vendor that their plan went live.
 *
 * Called after activation commits, never inside it — a failed notification must
 * not undo a paid subscription.
 */
exports.notifySubscriptionActivated = ({
  brand,
  subscription,
  subscribed,
  action,
  isAdminGrant = false,
  forfeitedDays = 0,
}) => {
  const copy = ACTION_COPY[action] || ACTION_COPY[SUBSCRIPTION_ACTION.NEW];
  const lines = [
    ["Plan", subscription.name],
    ["Valid till", asDate(subscribed.endDate)],
  ];
  if (subscribed.paidAmount > 0) {
    lines.push(["Amount paid", formatMoney(subscribed.paidAmount)]);
  }
  if (forfeitedDays > 0) {
    lines.push(["Days forfeited from previous plan", String(forfeitedDays)]);
  }

  return notify({
    brandId: brand._id,
    type: isAdminGrant
      ? NOTIFICATION_TYPES.SUBSCRIPTION_GRANTED
      : copy.type,
    severity: NOTIFICATION_SEVERITY.INFO,
    title: isAdminGrant
      ? `${subscription.name} plan added to your account`
      : copy.title,
    body: isAdminGrant
      ? `The Trydood team has added the ${subscription.name} plan to your account. It is valid until ${asDate(subscribed.endDate)}.`
      : `Your ${subscription.name} plan has been ${copy.verb} and is valid until ${asDate(subscribed.endDate)}.`,
    meta: {
      subscribedId: subscribed._id,
      subscriptionId: subscription._id,
      planName: subscription.name,
      endDate: subscribed.endDate,
      action,
      forfeitedDays,
    },
    mail: { lines },
    // 2 vars: plan, valid till. Same shape for activated / renewed / upgraded /
    // downgraded / granted, so one template body serves all five if desired.
    whatsapp: {
      params: [subscription.name, asDate(subscribed.endDate)],
      urlParam: panelUrlPath("subscription"),
    },
  });
};

/** Reminder that a plan is about to lapse. Idempotent per (plan, offset). */
exports.notifySubscriptionExpiring = ({
  brand,
  subscription,
  subscribed,
  daysRemaining,
  offset,
}) =>
  notify({
    brandId: brand?._id || subscribed.brandId,
    type: NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING,
    severity:
      daysRemaining <= 1
        ? NOTIFICATION_SEVERITY.CRITICAL
        : NOTIFICATION_SEVERITY.WARNING,
    title:
      daysRemaining <= 1
        ? "Your subscription expires today"
        : `Your subscription expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`,
    body: `Your ${subscription?.name || "current"} plan ends on ${asDate(subscribed.endDate)}. Renew before then to keep adding outlets, vouchers and showcase content.`,
    meta: {
      subscribedId: subscribed._id,
      planName: subscription?.name,
      endDate: subscribed.endDate,
      daysRemaining,
    },
    // One notification per plan per offset, so the job can run hourly.
    dedupeKey: `SUBSCRIPTION_EXPIRING:${subscribed._id}:${offset}`,
    mail: {
      lines: [
        ["Plan", subscription?.name || "-"],
        ["Ends on", asDate(subscribed.endDate)],
        ["Days left", String(daysRemaining)],
      ],
      footnote:
        "Once the plan ends, existing outlets and vouchers stay in place but nothing new can be created until you renew.",
    },
    // 3 vars: plan, days left, end date.
    whatsapp: {
      params: [
        subscription?.name,
        String(daysRemaining),
        asDate(subscribed.endDate),
      ],
      urlParam: panelUrlPath("subscription/plans"),
    },
  });

/** The plan has lapsed. Sent by the expiry sweep. */
exports.notifySubscriptionExpired = ({ subscribed, subscription }) =>
  notify({
    brandId: subscribed.brandId,
    type: NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: "Your subscription has expired",
    body: `Your ${subscription?.name || "subscription"} ended on ${asDate(subscribed.endDate)}. Your existing outlets, vouchers and showcase content are untouched, but you cannot add anything new until you renew.`,
    meta: {
      subscribedId: subscribed._id,
      planName: subscription?.name,
      endDate: subscribed.endDate,
    },
    dedupeKey: `SUBSCRIPTION_EXPIRED:${subscribed._id}`,
    mail: {
      ctaLabel: "Renew now",
      ctaUrl: process.env.VENDOR_PANEL_URL
        ? `${process.env.VENDOR_PANEL_URL}/subscription/plans`
        : undefined,
    },
    // 2 vars: plan, end date.
    whatsapp: {
      params: [subscription?.name, asDate(subscribed.endDate)],
      urlParam: panelUrlPath("subscription/plans"),
    },
  });

/** An admin revoked the plan before its end date. */
exports.notifySubscriptionCancelled = ({ subscribed, subscription, reason }) =>
  notify({
    brandId: subscribed.brandId,
    type: NOTIFICATION_TYPES.SUBSCRIPTION_CANCELLED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: "Your subscription has been cancelled",
    body: `Your ${subscription?.name || "subscription"} has been cancelled by the Trydood team. Your existing outlets and content remain intact, but nothing new can be created until you subscribe again.`,
    meta: {
      subscribedId: subscribed._id,
      planName: subscription?.name,
      // The internal reason is deliberately not put in the vendor-facing body.
      reason,
    },
    dedupeKey: `SUBSCRIPTION_CANCELLED:${subscribed._id}`,
    // 1 var: plan. The internal cancellation reason is not sent to the vendor.
    whatsapp: { params: [subscription?.name] },
  });
