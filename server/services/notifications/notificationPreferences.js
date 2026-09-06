const User = require("../../models/User");
const Customer = require("../../models/Customer");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_PREFERENCE_CHANNELS,
} = require("../../constants/notification");
const {
  describeChannelPreferences,
} = require("../../helpers/notifications/channelPreferences");
const {
  resolveAudienceChannels,
} = require("../../helpers/notifications/audienceChannels");
const { throwError } = require("../../utils");

/**
 * Reading and writing one person's notification channel toggles.
 *
 * Four operations, one shape: a person reads and writes their own, and an admin
 * reads and writes anybody's. Both go through the same resolver and the same
 * describe, so the panel and the app can never be shown a different answer for
 * the same user.
 *
 * ### ⚠️ What a write does not do
 *
 * It changes the **person's** preference, never the platform toggle. Those are
 * different things and only look similar: `Setting.<audience>.…` is an
 * operational kill switch for a whole audience, and it belongs to
 * `PUT /settings`. An admin turning one customer's WhatsApp on does not — and
 * must not — turn WhatsApp on for every customer.
 *
 * That is also why the response reports `effective` beside `preference`. WhatsApp
 * is off platform-wide today, so *"I switched it on and nothing happened"* is the
 * normal case rather than an edge one, and the API says which switch is holding
 * it rather than leaving the panel to guess.
 */

/** Which settings block governs a role's outbound channels. */
const AUDIENCE_BY_ROLE = Object.freeze({
  [ROLES.ADMIN]: NOTIFICATION_AUDIENCE.ADMIN,
  [ROLES.VENDOR]: NOTIFICATION_AUDIENCE.VENDOR,
  // An outlet manager reads the vendor feed and is governed by the vendor block,
  // the same way `notifyAudience` labels their rows.
  [ROLES.SUB_VENDOR]: NOTIFICATION_AUDIENCE.VENDOR,
  [ROLES.CUSTOMER]: NOTIFICATION_AUDIENCE.CUSTOMER,
});

/**
 * ⚠️ One resolver, shared with the delivery path.
 *
 * This used to branch to the three settings getters itself, which put a second
 * copy of the audience→settings mapping beside the one in `notify()`. Two copies
 * is how the panel comes to show a toggle as live while the delivery path treats
 * it as off — and the whole point of returning `effective` is that the two
 * cannot disagree.
 */
const platformChannelsFor = async (role) => {
  const audience = AUDIENCE_BY_ROLE[role] || NOTIFICATION_AUDIENCE.VENDOR;
  const { channels } = await resolveAudienceChannels(audience);
  return { audience, channels };
};

/**
 * Find the user an admin is asking about.
 *
 * ⚠️ Three ways in, because an admin screen rarely holds a `userId`. The customer
 * directory has a `customerId`, the brand list has a `brandId`, and only the user
 * table has the id this actually keys on. Forcing one of them would mean every
 * caller doing its own lookup, differently.
 */
const resolveTargetUser = async ({ userId, customerId, brandId }) => {
  if (userId) {
    const user = await User.findOne({ _id: userId, isDeleted: false });
    if (!user) throwError(404, "User not found");
    return user;
  }

  if (customerId) {
    const customer = await Customer.findOne({
      _id: customerId,
      isDeleted: false,
    })
      .select("userId")
      .lean();
    if (!customer) throwError(404, "Customer not found");
    if (!customer.userId) {
      throwError(422, "This customer has no user account to set preferences on");
    }
    const user = await User.findOne({
      _id: customer.userId,
      isDeleted: false,
    });
    if (!user) throwError(404, "The user behind this customer no longer exists");
    return user;
  }

  if (brandId) {
    const brand = await Brand.findOne({ _id: brandId, isDeleted: false })
      .select("userId")
      .lean();
    if (!brand) throwError(404, "Brand not found");
    if (!brand.userId) {
      throwError(422, "This brand has no owning user to set preferences on");
    }
    const user = await User.findOne({ _id: brand.userId, isDeleted: false });
    if (!user) throwError(404, "The user behind this brand no longer exists");
    /**
     * ⚠️ The brand's **owner**, not its outlet managers. A sub-vendor is a
     * separate `User` with their own toggles, and switching the owner's off must
     * not switch off the person who actually works the counter.
     */
    return user;
  }

  throwError(422, "One of userId, customerId or brandId is required");
};

/**
 * Who last changed these, as something a person can read.
 *
 * ⚠️ Name and role only — never the email, mobile or anything else off the admin's
 * account. This is shown on somebody **else's** profile card, and "which admin
 * touched this" needs a name, not a contact route into a colleague's inbox.
 *
 * Returns `null` when nobody else did it: absent `updatedBy` with a present
 * `updatedAt` means the person changed it themselves.
 */
const describeActor = async (updatedBy) => {
  if (!updatedBy) return null;

  const actor = await User.findById(updatedBy).select("name role").lean();
  if (!actor) {
    // A deleted admin still has to render as something; the id is the only
    // honest answer left, and hiding it would erase the fact it was not self-set.
    return { _id: updatedBy, name: null, role: null };
  }

  return { _id: actor._id, name: actor.name || null, role: actor.role || null };
};

/** The response every one of the four endpoints returns. */
const present = async (user) => {
  const [{ audience, channels }, updatedBy] = await Promise.all([
    platformChannelsFor(user.role),
    describeActor(user.notificationPreferences?.updatedBy),
  ]);

  return {
    userId: user._id,
    role: user.role,
    // Which settings block governs this person, so the panel can link to it.
    audience,
    channels: describeChannelPreferences({
      preferences: user.notificationPreferences,
      platformChannels: channels,
    }),
    updatedBy,
    updatedAt: user.notificationPreferences?.updatedAt || null,
  };
};

/**
 * Apply a partial change.
 *
 * ⚠️ Partial on purpose — a client sending only `{ whatsapp: false }` must not
 * reset the other two. A toggle row in a panel changes one switch at a time, and
 * a full-object write would let a stale screen silently revert a change made on
 * another device.
 */
const applyChange = async (user, payload, actorUserId) => {
  const next = user.notificationPreferences || {};
  let changed = false;

  for (const channel of Object.keys(NOTIFICATION_PREFERENCE_CHANNELS)) {
    if (payload[channel] === undefined) continue;
    if (next[channel] === payload[channel]) continue;
    next[channel] = payload[channel];
    changed = true;
  }

  if (!changed) return user;

  next.updatedAt = new Date();
  /**
   * Absent `updatedBy` with a present `updatedAt` means the person changed it
   * themselves — so a self-service write clears any earlier admin stamp rather
   * than leaving a name that no longer explains the current state.
   */
  next.updatedBy =
    actorUserId && String(actorUserId) !== String(user._id) ? actorUserId : null;

  user.notificationPreferences = next;
  await user.save();

  return user;
};

/** A person reads their own. */
exports.getMyNotificationPreferences = async ({ userId }) => {
  const user = await User.findOne({ _id: userId, isDeleted: false });
  if (!user) throwError(404, "User not found");
  return present(user);
};

/** A person changes their own. */
exports.updateMyNotificationPreferences = async ({ userId }, payload = {}) => {
  const user = await User.findOne({ _id: userId, isDeleted: false });
  if (!user) throwError(404, "User not found");

  await applyChange(user, payload, userId);
  return present(user);
};

/** An admin reads anybody's, by user, customer or brand. */
exports.getUserNotificationPreferences = async (query = {}) => {
  const user = await resolveTargetUser(query);
  return present(user);
};

/** An admin changes anybody's. */
exports.updateUserNotificationPreferences = async (actor, payload = {}) => {
  const { userId, customerId, brandId, ...channels } = payload;
  const user = await resolveTargetUser({ userId, customerId, brandId });

  await applyChange(user, channels, actor.userId);
  return present(user);
};
