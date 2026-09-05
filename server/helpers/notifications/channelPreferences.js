const {
  NOTIFICATION_PREFERENCE_CHANNELS,
  NOTIFICATION_PREFERENCE_DEFAULTS,
  alwaysDelivers,
} = require("../../constants/notification");

/**
 * Whether a channel may be used for one recipient.
 *
 * Two switches govern every outbound send, and they are different kinds of
 * thing:
 *
 * | Switch | Whose | What it means |
 * |---|---|---|
 * | `Setting.<audience>.…isEmailNotificationEnabled` | the platform's | operational kill switch — SMTP is down, the Meta templates are not approved |
 * | `User.notificationPreferences.email` | the person's | "do not email me" |
 *
 * A send needs **both**. They are not interchangeable and neither is a fallback
 * for the other, which is why this is the only place that combines them.
 *
 * ⚠️ The in-app row is written before any of this is consulted. These decide
 * delivery, never the record.
 *
 * ---
 *
 * ### 🔴 Absent means ON, and this is the whole reason the file exists
 *
 * `notificationPreferences` has `default: true` on every channel — which applies
 * to **documents created after the field existed**. Every user already in the
 * database has no such field at all, and will not grow one until they change a
 * setting.
 *
 * So the read has to be:
 *
 * ```js
 * prefs?.email !== false     // ✅ absent, null and true all mean on
 * prefs?.email === true      // ❌ silences every existing user
 * Boolean(prefs?.email)      // ❌ the same, wearing a different hat
 * ```
 *
 * `CLAUDE.md` records this exact shape going the other way — a `Setting`
 * document written before `requiresAdminApproval` existed, where truthiness
 * would have auto-approved every payout on the platform. Here the failure is
 * quieter and therefore worse: notifications simply stop, the in-app feed keeps
 * working perfectly, and nobody reports a bug they cannot see.
 *
 * That is why no caller reads `user.notificationPreferences` directly, and why a
 * test asserts no file does.
 */

/**
 * A user's preferences, normalised — every channel present, every absent value
 * resolved to its default.
 *
 * Accepts the whole user, the sub-document, or nothing at all, because the
 * callers have different amounts of the user to hand: `notify` has a lean
 * projection, `resolveAudience` has a list of them, and an admin endpoint has
 * the document.
 *
 * @param {object|null} source  a User, a preferences sub-document, or null
 * @returns {{email: boolean, push: boolean, whatsapp: boolean}}
 */
const resolveChannelPreferences = (source) => {
  // A whole user, or the sub-document on its own.
  const prefs = source?.notificationPreferences ?? source ?? {};

  const resolved = {};
  for (const channel of Object.keys(NOTIFICATION_PREFERENCE_DEFAULTS)) {
    // ⚠️ `!== false`, never `=== true`. See the note above.
    resolved[channel] = prefs?.[channel] !== false;
  }

  return resolved;
};

/**
 * Is this channel allowed to carry this notification to this person?
 *
 * @param {object}  args
 * @param {string}  args.channel   a key of NOTIFICATION_PREFERENCE_CHANNELS
 * @param {object}  [args.preferences]     already normalised, or raw — both work
 * @param {boolean} [args.platformEnabled] the admin toggle for this audience
 * @param {string}  [args.type]    NOTIFICATION_TYPES — for the always-deliver list
 * @returns {{allowed: boolean, preference: boolean, effective: boolean,
 *            blockedBy: "PLATFORM"|"PREFERENCE"|null, forced: boolean}}
 */
const isChannelAllowed = ({
  channel,
  preferences,
  platformEnabled,
  type,
} = {}) => {
  const preference = resolveChannelPreferences(preferences)[channel] ?? true;

  /**
   * ⚠️ The platform switch is checked first and is never overridden.
   *
   * `platformEnabled` arrives from a settings read that is itself guarded — a
   * failed read leaves it `undefined`, and `!== false` treats that as on, which
   * matches how `notify` already behaves when settings cannot be loaded: the
   * row is written and delivery is attempted, rather than a settings outage
   * silently muting the platform.
   */
  if (platformEnabled === false) {
    return {
      allowed: false,
      preference,
      effective: false,
      blockedBy: "PLATFORM",
      forced: false,
    };
  }

  /**
   * A handful of notices outrank a personal preference — the ones where silence
   * costs the reader access or money. See `ALWAYS_DELIVER_TYPES`.
   */
  if (!preference && alwaysDelivers(type)) {
    return {
      allowed: true,
      preference: false,
      effective: true,
      blockedBy: null,
      forced: true,
    };
  }

  return {
    allowed: preference,
    preference,
    effective: preference,
    blockedBy: preference ? null : "PREFERENCE",
    forced: false,
  };
};

/**
 * The shape an API hands back, per channel: what the person chose, and whether
 * it currently has any effect.
 *
 * ⚠️ Both, not one. A toggle that reads `true` while the platform switch is off
 * is a lie the panel then repeats to an admin — and WhatsApp is off
 * platform-wide today, so this is the normal case rather than an edge one. The
 * preference is still stored, so it takes effect the day the platform switch
 * moves.
 *
 * ⚠️ `platformChannels` is the **normalised** `{ email, push, whatsapp }` from
 * `audienceChannels.resolveAudienceChannels`, not a raw settings block. It used
 * to take the raw block and translate the field names itself, which put a second
 * copy of that mapping here — and a second copy is how the panel and the
 * delivery path come to disagree about one account.
 *
 * @param {object} args
 * @param {object} [args.preferences]      the person's, raw or normalised
 * @param {object} [args.platformChannels] `{email, push, whatsapp}` booleans
 * @returns {{email: object, push: object, whatsapp: object}}
 */
const describeChannelPreferences = ({ preferences, platformChannels } = {}) => {
  const resolved = resolveChannelPreferences(preferences);

  /**
   * ⚠️ Missing `platformChannels` is a caller bug, and a silent one: every
   * channel would come back `effective: true, blockedBy: null`, which is the
   * panel being told a toggle is live when the platform may have it shut. That
   * is the same shape as the `{}` fallback this whole area was just fixed for,
   * so it is named rather than absorbed.
   */
  if (!platformChannels) {
    console.warn(
      "[notifications] describeChannelPreferences was called without platformChannels — " +
        "reporting every channel as effective. Pass resolveAudienceChannels(audience).channels.",
    );
  }

  const described = {};
  for (const channel of Object.keys(NOTIFICATION_PREFERENCE_CHANNELS)) {
    const verdict = isChannelAllowed({
      channel,
      preferences: resolved,
      platformEnabled: platformChannels?.[channel],
    });

    described[channel] = {
      // What the person chose.
      preference: verdict.preference,
      // Whether anything actually sends on it right now.
      effective: verdict.effective,
      // Named only when something is stopping it, so the panel can say why.
      blockedBy: verdict.blockedBy,
    };
  }

  return described;
};

module.exports = {
  resolveChannelPreferences,
  isChannelAllowed,
  describeChannelPreferences,
};
