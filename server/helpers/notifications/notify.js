const Notification = require("../../models/Notification");
const Brand = require("../../models/Brand");
const User = require("../../models/User");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { sendMail } = require("../nodeMailer");
const { dispatchPush } = require("../push");
const { sendWhatsApp } = require("../whatsapp");
const { getSubscriptionConfig, getCustomerConfig } = require("../settings");
const Customer = require("../../models/Customer");
const { resolveCustomerId } = require("../customers");

/**
 * Resolve where to reach a brand: the address on the brand, falling back to the
 * owning user's. Vendor brands often have one and not the other.
 *
 * The phone follows the same pattern, preferring an explicit `whatsappNumber`
 * over the login mobile — a business often runs WhatsApp on a different number
 * from the one used to sign in, and messaging the wrong one reaches nobody.
 */
const resolveRecipient = async (brandId, userId, customerId) => {
  /**
   * A customer's own contacts come first.
   *
   * Falling through to the User record would reach the login identity, which is
   * often not where a customer wants a receipt — and on a shared login it is
   * not even the same person. The User is still the fallback, because a
   * customer who never filled in an email should still get one.
   */
  const resolvedCustomerId = resolveCustomerId(customerId);
  const customer = resolvedCustomerId
    ? await Customer.findById(resolvedCustomerId)
        .select("email mobile whatsappNumber name userId")
        .lean()
    : null;

  const brand = brandId
    ? await Brand.findById(brandId)
        .select("email mobile whatsappNumber userId brandName")
        .lean()
    : null;

  const targetUserId = userId || customer?.userId || brand?.userId;
  const user = targetUserId
    ? await User.findById(targetUserId)
        .select("email name mobile whatsappNumber")
        .lean()
    : null;

  return {
    userId: targetUserId || null,
    customerId: resolvedCustomerId || null,
    email: customer?.email || brand?.email || user?.email || null,
    phone:
      customer?.whatsappNumber ||
      customer?.mobile ||
      brand?.whatsappNumber ||
      user?.whatsappNumber ||
      brand?.mobile ||
      user?.mobile ||
      null,
    brandName: brand?.brandName || null,
    name: customer?.name || user?.name || brand?.brandName || null,
  };
};

/**
 * Which channel toggles govern this notification.
 *
 * ⚠️ They were read from `getSubscriptionConfig()` for every audience — the
 * **vendor** settings. So silencing vendor renewal reminders would also have
 * silenced every customer's payment receipt, and a customer-side toggle would
 * have had no effect at all.
 *
 * Shaped the same either way, so the three delivery blocks below do not have to
 * know which audience they are serving.
 */
const getNotificationConfig = async (audience) => {
  if (audience === NOTIFICATION_AUDIENCE.CUSTOMER) {
    const { notification } = await getCustomerConfig();
    return notification;
  }
  return getSubscriptionConfig();
};

/**
 * Record a notification and try to deliver it.
 *
 * Persist-first: the row is always written, then email is attempted and the
 * outcome recorded on that row. So the in-app bell is the source of truth and an
 * SMTP outage costs a delivery, not the record.
 *
 * **Never throws.** Every caller is a business operation — activation, an admin
 * grant, the expiry sweep — that must not be rolled back because a notification
 * failed.
 *
 * `dedupeKey` makes the write idempotent: the reminder job can run every few
 * hours and a duplicate key is swallowed as "already sent".
 *
 * @returns {Promise<{ created: boolean, notification?: object, reason?: string }>}
 */
exports.notify = async ({
  brandId,
  userId,
  /**
   * The customer this is for. Accepts an id or the populated document
   * `req.customerId` actually holds — normalised inside.
   */
  customerId,
  audience = NOTIFICATION_AUDIENCE.VENDOR,
  type,
  severity = NOTIFICATION_SEVERITY.INFO,
  title,
  body,
  meta,
  dedupeKey,
  email = true,
  // Push is on by default: a vendor or customer with a registered device should
  // hear about anything worth an in-app row.
  push = true,
  // WhatsApp needs `whatsapp.params` from the caller, because a Meta-approved
  // template's variables are positional and only the caller knows what belongs
  // in them. With no params it is skipped rather than sent half-filled.
  whatsapp,
  // Client route to open when the notification is tapped. Stored on the row and
  // sent in the push payload, so the in-app list and the push both land the
  // reader on the same screen instead of a generic feed.
  deepLink,
  // Wait for email, push and WhatsApp to finish instead of leaving them in
  // flight. Off by default because the server must not hold a request open for a
  // provider round trip — set it only in a short-lived caller (a script, a test)
  // that would exit before a fire-and-forget send completed.
  awaitDelivery = false,
  mail,
}) => {
  try {
    const recipient = await resolveRecipient(brandId, userId, customerId);

    const notification = await Notification.create({
      brandId: brandId || undefined,
      userId: recipient.userId || undefined,
      customerId: recipient.customerId || undefined,
      audience,
      type,
      severity,
      title,
      body,
      channels: [NOTIFICATION_CHANNELS.IN_APP],
      // Kept inside `meta` rather than as its own column: it is a client routing
      // hint, and `notifyAudience` already carries it there — one shape for both
      // paths means the app reads it from one place.
      meta: { ...(meta || {}), ...(deepLink ? { deepLink } : {}) },
      dedupeKey,
    });

    // One config read for all three channels. Guarded, because a notification
    // must not be lost to a settings read failing — the row is already written,
    // and defaults are the right fallback for a delivery decision.
    let config = {};
    try {
      config = await getNotificationConfig(audience);
    } catch (error) {
      console.error(
        `[notify] could not read notification settings for ${notification._id}:`,
        error?.message,
      );
    }

    // ---------------- push ----------------
    // Fire-and-forget for the same reason as email: this runs inside payment
    // verification and the webhook receiver, and a provider round trip has no
    // business on either. `dispatchPush` never throws.
    const pushing =
      push && recipient.userId && config.isPushNotificationEnabled !== false
        ? dispatchPush([recipient.userId], {
            title,
            body,
            data: {
              type,
              notificationId: String(notification._id),
              ...(deepLink ? { deepLink } : {}),
              ...(brandId ? { brandId: String(brandId) } : {}),
              ...(meta?.subscribedId ? { subscribedId: String(meta.subscribedId) } : {}),
            },
          })
            .then((result) => {
              if (result.sent > 0) {
                return Notification.updateOne(
                  { _id: notification._id },
                  { $addToSet: { channels: NOTIFICATION_CHANNELS.PUSH } },
                );
              }
              return null;
            })
            .catch((error) =>
              console.error(
                `[notify] push bookkeeping failed for ${notification._id}:`,
                error?.message,
              ),
            )
        : null;

    // ---------------- whatsapp ----------------
    // Three gates, all of which are normal states rather than faults: the admin
    // toggle, an approved template for this type, and params from the caller.
    // `sendWhatsApp` never throws and reports which gate stopped it.
    const messaging =
      whatsapp?.params?.length &&
      recipient.phone &&
      config.isWhatsAppNotificationEnabled === true
        ? sendWhatsApp({
            phone: recipient.phone,
            type,
            params: whatsapp.params,
            urlParam: whatsapp.urlParam,
          })
            .then((result) => {
              if (result.sent) {
                return Notification.updateOne(
                  { _id: notification._id },
                  {
                    $set: { whatsappSentAt: new Date() },
                    $addToSet: { channels: NOTIFICATION_CHANNELS.WHATSAPP },
                  },
                );
              }
              // A skip is expected while templates are still being approved and
              // is not worth a row update; a real failure is.
              if (!result.skipped) {
                return Notification.updateOne(
                  { _id: notification._id },
                  { $set: { whatsappError: result.error || "unknown" } },
                );
              }
              return null;
            })
            .catch((error) =>
              console.error(
                `[notify] whatsapp bookkeeping failed for ${notification._id}:`,
                error?.message,
              ),
            )
        : null;

    if (awaitDelivery) {
      if (pushing) await pushing;
      if (messaging) await messaging;
    }

    if (!email) return { created: true, notification };

    if (!config.isEmailNotificationEnabled || !recipient.email) {
      return { created: true, notification };
    }

    // Delivery result is written back onto the row whenever it lands.
    const deliver = sendMail({
      to: recipient.email,
      subject: mail?.subject || title,
      title: mail?.title || title,
      body: mail?.body || body,
      lines: mail?.lines,
      ctaLabel: mail?.ctaLabel,
      ctaUrl: mail?.ctaUrl,
      footnote: mail?.footnote,
    })
      .then((result) =>
        Notification.updateOne(
          { _id: notification._id },
          result.sent
            ? {
                $set: { emailSentAt: new Date() },
                $addToSet: { channels: NOTIFICATION_CHANNELS.EMAIL },
              }
            : { $set: { emailError: result.error || "unknown" } },
        ),
      )
      .catch((error) =>
        console.error(
          `[notify] email bookkeeping failed for ${notification._id}:`,
          error?.message,
        ),
      );

    // Not awaited by default. Gmail takes ~5s per message, and this runs inside
    // payment verification and the webhook receiver — 5s of SMTP on a payment
    // response is bad, and on a webhook it can exceed Razorpay's own timeout and
    // trigger a pointless retry. The row is already committed, so the caller has
    // everything it needs; only the delivery is in flight.
    //
    // Callers that must not exit before the mail lands (a one-shot script rather
    // than the long-lived server) pass `awaitDelivery: true`.
    if (awaitDelivery) await deliver;

    return { created: true, notification };
  } catch (error) {
    // Duplicate dedupeKey — this exact notification already exists.
    if (error?.code === 11000) {
      return { created: false, reason: "duplicate" };
    }
    console.error(
      `[notify] failed to record ${type} for brand ${brandId}:`,
      error?.message,
    );
    return { created: false, reason: error?.message };
  }
};

/**
 * Exported for the tests that check who a notification actually reaches.
 *
 * Not part of the public surface — callers use `notify`. But "which address does
 * a customer's receipt go to" is exactly the kind of thing that is silently
 * wrong for months, and testing it through the resolved row rather than through
 * a copy of the logic is the only way to catch it.
 */
exports.resolveRecipient = resolveRecipient;
exports.getNotificationConfig = getNotificationConfig;

