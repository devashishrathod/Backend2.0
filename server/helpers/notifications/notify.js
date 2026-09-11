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
const Customer = require("../../models/Customer");
const { resolveCustomerId } = require("../customers");
const { isChannelAllowed } = require("./channelPreferences");
const { resolveAudienceChannels } = require("./audienceChannels");

/**
 * Where to reach this person, and whether we are allowed to.
 *
 * ### ⚠️ The contact comes off the **account**, not off the profile
 *
 * This used to read `customer?.email || brand?.email || user?.email` — the role
 * profile first, the account as a fallback — on the theory that a customer's own
 * address is a better place for a receipt than the login identity.
 *
 * That was true while the two could differ. They cannot any more:
 * `helpers/users/applyIdentityChange.js` is now the only thing that writes any of
 * the three keys and it writes both copies together, and
 * `scripts/syncRoleProfileIdentity.js` brought the old rows into line. So the
 * chain can only ever produce a different answer when something has **drifted** —
 * and that is exactly the case where it must not, because the verification flags
 * it is checked against live on the `User`. A chain that can hand back the
 * profile's address while the flag describes the account's is a guard that
 * silently checks the wrong thing.
 *
 * One document, one answer. The profile is still read for `brandName` and for the
 * customer's display name, which are genuinely its own.
 */
const resolveRecipient = async (brandId, userId, customerId) => {
  const resolvedCustomerId = resolveCustomerId(customerId);
  const customer = resolvedCustomerId
    ? await Customer.findById(resolvedCustomerId).select("name userId").lean()
    : null;

  const brand = brandId
    ? await Brand.findById(brandId).select("userId brandName").lean()
    : null;

  const targetUserId = userId || customer?.userId || brand?.userId;
  const user = targetUserId
    ? await User.findById(targetUserId)
        /**
         * ⚠️ `notificationPreferences` and the two verified flags ride along on a
         * read that already happens — the person's toggles **and** whether each
         * address has been confirmed cost no extra query on any path. That is
         * precisely why both live on `User` and are not mirrored onto the
         * profile: a second home would be a second thing to keep in step, and it
         * is the thing delivery is decided on.
         */
        .select(
          "email name mobile whatsappNumber notificationPreferences " +
            "isEmailVerified isWhatsappVerified",
        )
        .lean()
    : null;

  return {
    userId: targetUserId || null,
    customerId: resolvedCustomerId || null,
    /**
     * Raw, not normalised. `channelPreferences.js` owns what an absent value
     * means and is the only place allowed to decide it — handing a normalised
     * object around would let a second opinion form somewhere else.
     */
    notificationPreferences: user?.notificationPreferences || null,
    /**
     * Has each channel's key been confirmed by an OTP?
     *
     * ⚠️ `=== true`, not truthiness: absent has to read as **not verified**.
     * Every account that predates the flag has no value, and treating that as
     * confirmed would be the guard passing for exactly the rows it exists for.
     *
     * `push` is not here — a device token proves itself by existing.
     */
    verified: {
      email: user?.isEmailVerified === true,
      whatsapp: user?.isWhatsappVerified === true,
    },
    email: user?.email || null,
    /**
     * WhatsApp first, then the plain mobile — a business often runs WhatsApp on a
     * different number from the one it signs in with, and messaging the wrong one
     * reaches nobody.
     */
    phone: user?.whatsappNumber || user?.mobile || null,
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
 *
 * ⚠️ **Admin used to fall through to the vendor block**, because the branch was
 * *"customer? … otherwise vendor"*. So switching off vendor renewal reminders
 * also switched off `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and every other
 * alert whose job is to reach a person when money has gone wrong — and nothing
 * said so, because the in-app rows kept appearing exactly as before.
 *
 * That branch, and the `{}` fallback that used to sit under it, now live in
 * `audienceChannels.js` as a table — see that file for what `{}` cost.
 */

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

    /**
     * Which channels may carry this, to this person.
     *
     * Two switches, decided once and used by all three blocks below:
     *
     *  - the **platform** toggle for this audience — an operational kill switch
     *  - this person's **own** `notificationPreferences`
     *
     * A send needs both. `ALWAYS_DELIVER_TYPES` lets a handful of notices
     * outrank the personal one — never the platform one, because that is what is
     * set when SMTP is down or a Meta template does not exist.
     *
     * ⚠️ One config read for all three channels, and it **cannot fail into an
     * ambiguous state**: `resolveAudienceChannels` never throws and always
     * returns three real booleans, falling back to that audience's declared
     * defaults. That is what lets every gate below be the same expression
     * instead of three operators that disagreed about a missing flag.
     *
     * ⚠️ The row above is already written. None of this can stop the record;
     * it only decides what leaves the process.
     */
    const { channels: platform } = await resolveAudienceChannels(audience);
    const allow = (channel) =>
      isChannelAllowed({
        channel,
        preferences: recipient.notificationPreferences,
        platformEnabled: platform[channel],
        type,
        /**
         * ⚠️ The third switch, and it outranks `ALWAYS_DELIVER_TYPES`.
         *
         * An unconfirmed address is not a person saying "do not disturb me" — it
         * is us not knowing whose address it is. Delivering a refund notice there
         * puts a real customer's money detail in a stranger's inbox.
         *
         * Nobody becomes unreachable: the in-app row is already written above,
         * push is unaffected, and for every non-admin role WhatsApp is the login
         * identity and therefore always verified.
         */
        verified: recipient.verified,
      });

    // ---------------- push ----------------
    // Fire-and-forget for the same reason as email: this runs inside payment
    // verification and the webhook receiver, and a provider round trip has no
    // business on either. `dispatchPush` never throws.
    const pushing =
      push && recipient.userId && allow("push").allowed
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
      allow("whatsapp").allowed
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

    if (!allow("email").allowed || !recipient.email) {
      return { created: true, notification };
    }

    // Delivery result is written back onto the row whenever it lands.
    //
    // ⚠️ `mail` is spread, not re-listed field by field.
    //
    // It used to be re-listed — `lines`, `ctaLabel`, `ctaUrl`, `footnote` — and
    // that list is what dropped **19 email buttons**: five notice files passed
    // `buttonText` / `buttonUrl`, which was not on it, so the field never reached
    // `sendMail`. The mail sent, looked complete, recorded `EMAIL` on the row, and
    // simply had no button in it. Nothing errored and nothing logged, because a
    // key that is not destructured is not an error in JavaScript.
    //
    // Spreading removes the class of bug rather than that one instance: a field
    // the renderer learns later — a second button, a preheader, an attachment —
    // works from a notice helper with no change here.
    //
    // ⚠️ `to` comes **after** the spread, so a notice cannot redirect its own
    // mail by putting a `to` in `mail`. The three below follow it for the same
    // reason: they are the fallbacks, and the caller's `mail.title` is already
    // consulted inside them.
    const deliver = sendMail({
      ...(mail || {}),
      to: recipient.email,
      subject: mail?.subject || title,
      title: mail?.title || title,
      body: mail?.body || body,
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

