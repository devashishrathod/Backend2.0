const { markSignedOut } = require("../../helpers/auth");
const { unregisterDeviceToken } = require("../deviceTokens");

/**
 * End a session.
 *
 * One endpoint for every role — a customer, a vendor, a sub-vendor and an admin
 * all sign out the same way, and it is deliberately reachable by a **suspended**
 * account: every other gate answers a deactivated user with a 401 so the client
 * signs them out, and refusing the sign-out itself is the one thing that would
 * leave them stuck.
 *
 * Until now this was a no-op that logged a line and returned 200. The user's
 * phone kept receiving that account's push notifications afterwards, and
 * `isLoggedIn` stayed true for ever.
 *
 * Two modes:
 *
 * - **This device** (default) — the flags come down and, if the client sends
 *   its push token, that one device stops receiving notifications. The JWT is
 *   not revoked; the client deletes it. Their tablet stays signed in, which is
 *   what "sign out" means on one device.
 *
 * - **`allDevices: true`** — additionally stamps `sessionInvalidatedAt`, which
 *   refuses every JWT issued before now including the one making this request,
 *   and retires every push device. This is the answer to a lost phone, and
 *   there was no way to do it before.
 */
exports.logout = async (actor, payload = {}) => {
  const { pushToken, allDevices = false } = payload;
  const userId = actor?.userId;

  /**
   * The one write that must not fail silently.
   *
   * Flags and the session stamp go together in a single update: a caller who
   * asked to be signed out everywhere and got the flags flipped but not the
   * stamp would be told it worked while every other device stayed live.
   */
  await markSignedOut(userId, { endSessions: allDevices });

  /**
   * Push is best-effort, and deliberately so.
   *
   * A device row that will not update must not leave somebody unable to sign
   * out — being stuck signed in is worse than one phone still buzzing, and the
   * user can retire it from `PUT /deviceTokens/unregister` or by signing in
   * again. The count is reported rather than assumed, so a client can tell the
   * difference between "no token sent" and "retired nothing".
   */
  let pushDeactivated = 0;
  let activeDevices = null;

  if (allDevices || pushToken) {
    try {
      const result = await unregisterDeviceToken(
        { userId },
        allDevices ? { allDevices: true } : { token: pushToken },
      );
      pushDeactivated = result.deactivated;
      activeDevices = result.activeDevices;
    } catch (error) {
      console.error("[auth] logout push cleanup failed:", error?.message);
    }
  }

  return {
    allDevices,
    // Only the everywhere path revokes tokens. On a normal logout the JWT stays
    // valid until it expires and the client is what throws it away.
    sessionsEnded: allDevices,
    pushDeactivated,
    activeDevices,
  };
};
