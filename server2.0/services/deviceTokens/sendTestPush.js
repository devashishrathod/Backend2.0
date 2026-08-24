const { dispatchPush, isFcmConfigured, probeFcmAuth } = require("../../helpers/push");
const { throwError } = require("../../utils");

/**
 * Push a throwaway message to the caller's own devices.
 *
 * Exists because "push isn't working" has half a dozen causes — no token
 * registered, credentials missing, the wrong Firebase project, a token the
 * provider has already retired — and guessing between them from the outside is
 * miserable. This reports which one it is.
 *
 * Only ever targets the caller's own devices, so it cannot be used to spam anyone.
 * No notification row is written: this is a delivery check, not a notification.
 */
exports.sendTestPush = async (actor, payload = {}) => {
  if (!actor?.userId) {
    throwError(401, "Authentication is required.");
  }

  if (!isFcmConfigured()) {
    throwError(
      422,
      "Push is not configured on this server. Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY.",
    );
  }

  // Separates "credentials are wrong" from "the token is dead", which otherwise
  // both look like a failed send.
  const auth = await probeFcmAuth();
  if (!auth.ok) {
    throwError(422, `Push credentials were rejected by the provider: ${auth.reason}`);
  }

  const result = await dispatchPush([actor.userId], {
    title: payload.title || "Test notification",
    body: payload.body || "If you can read this, push notifications are working.",
    data: { type: "TEST" },
  });

  if (result.devices === 0) {
    throwError(
      404,
      "You have no active devices registered. Call POST /deviceTokens/register from the app first.",
    );
  }

  return {
    ...result,
    // The interesting answer is not "did the request succeed" but "did a phone
    // light up", and those are different things.
    delivered: result.sent > 0,
  };
};
