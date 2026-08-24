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
const { getSubscriptionConfig } = require("../settings");

/**
 * Resolve where to reach a brand: the address on the brand, falling back to the
 * owning user's. Vendor brands often have one and not the other.
 *
 * The phone follows the same pattern, preferring an explicit `whatsappNumber`
 * over the login mobile — a business often runs WhatsApp on a different number
 * from the one used to sign in, and messaging the wrong one reaches nobody.
 */
const resolveRecipient = async (brandId, userId) => {
  const brand = brandId
    ? await Brand.findById(brandId)
        .select("email mobile whatsappNumber userId brandName")
        .lean()
    : null;

  const targetUserId = userId || brand?.userId;
  const user = targetUserId
    ? await User.findById(targetUserId)
        .select("email name mobile whatsappNumber")
        .lean()
    : null;

  return {
    userId: targetUserId || null,
    email: brand?.email || user?.email || null,
    phone:
      brand?.whatsappNumber ||
      user?.whatsappNumber ||
      brand?.mobile ||
      user?.mobile ||
      null,
    brandName: brand?.brandName || null,
  };
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
  // Set only by short-lived callers (scripts) that would exit before a
  // fire-and-forget send completes.
  awaitEmail = false,
  mail,
}) => {
  try {
    const recipient = await resolveRecipient(brandId, userId);

    const notification = await Notification.create({
      brandId: brandId || undefined,
      userId: recipient.userId || undefined,
      audience,
      type,
      severity,
      title,
      body,
      channels: [NOTIFICATION_CHANNELS.IN_APP],
      meta,
      dedupeKey,
    });

    // One config read for all three channels. Guarded, because a notification
    // must not be lost to a settings read failing — the row is already written,
    // and defaults are the right fallback for a delivery decision.
    let config = {};
    try {
      config = await getSubscriptionConfig();
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

    if (awaitEmail) {
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
    // than the long-lived server) pass `awaitEmail: true`.
    if (awaitEmail) await deliver;

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
