const axios = require("axios");
const jwt = require("jsonwebtoken");
const { FCM, isFcmConfigured } = require("../../configs/fcm");

// Cached OAuth access token. Minting one costs a round trip, and a burst of
// pushes would otherwise mint one each.
let cached = { token: null, expiresAt: 0 };

/**
 * Exchange the service-account key for an OAuth access token.
 *
 * This is the whole reason `firebase-admin` is not needed: sign a short-lived
 * JWT with the service account's private key, trade it for an access token, and
 * cache it until shortly before it expires.
 */
const getAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.expiresAt - FCM.tokenRefreshMarginSeconds > now) {
    return cached.token;
  }

  const assertion = jwt.sign(
    {
      iss: FCM.clientEmail,
      scope: FCM.scope,
      aud: FCM.tokenUrl,
      iat: now,
      exp: now + FCM.tokenTtlSeconds,
    },
    FCM.privateKey,
    { algorithm: "RS256" },
  );

  const { data } = await axios.post(
    FCM.tokenUrl,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: FCM.requestTimeoutMs,
    },
  );

  cached = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || FCM.tokenTtlSeconds),
  };
  return cached.token;
};

/**
 * FCM error codes that mean the token is permanently gone — the app was
 * uninstalled, or the token was rotated. Those rows should be deactivated rather
 * than retried forever.
 *
 * Anything else (a 500, a quota error) is transient and the token is kept.
 */
const DEAD_TOKEN_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
]);

const classify = (error) => {
  const body = error?.response?.data?.error;
  const status = error?.response?.status;
  const fcmCode =
    body?.details?.find((d) => d.errorCode)?.errorCode || body?.status || null;

  return {
    // A 404 from the send endpoint also means the token is unknown.
    isDead: DEAD_TOKEN_CODES.has(fcmCode) || status === 404,
    code: fcmCode || (status ? `HTTP_${status}` : "UNKNOWN"),
    message: body?.message || error?.message || "unknown push error",
  };
};

/**
 * Send one notification to many device tokens.
 *
 * FCM HTTP v1 has no true multicast endpoint — each token is its own request —
 * so these go out concurrently in bounded batches. Results are returned
 * per-token so the caller can deactivate the ones the provider has rejected.
 *
 * **Never throws.** Push is a best-effort side channel; the in-app notification
 * row is the record, and a provider outage must not fail the operation that
 * triggered it.
 *
 * @param {string[]} tokens
 * @param {object}   message  { title, body, data, imageUrl }
 * @returns {Promise<{sent:number, failed:number, skipped?:boolean,
 *                    deadTokens:string[], results:object[]}>}
 */
exports.sendPush = async (tokens = [], message = {}) => {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (!unique.length) {
    return { sent: 0, failed: 0, deadTokens: [], results: [] };
  }
  if (!isFcmConfigured()) {
    // Same shape as a real result so callers need no special case, and the same
    // behaviour as sendMail with no SMTP: skip cleanly rather than fail.
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "FCM is not configured (FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY)",
      deadTokens: [],
      results: [],
    };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    console.error("[sendPush] could not obtain an FCM access token:", error?.message);
    return {
      sent: 0,
      failed: unique.length,
      reason: "FCM authentication failed: " + (error?.message || "unknown"),
      deadTokens: [],
      results: [],
    };
  }

  const url = FCM.sendUrl(FCM.projectId);
  // FCM requires every data value to be a string.
  const data = Object.fromEntries(
    Object.entries(message.data || {}).map(([k, v]) => [
      k,
      v === null || v === undefined ? "" : String(v),
    ]),
  );

  const sendOne = async (token) => {
    try {
      await axios.post(
        url,
        {
          message: {
            token,
            notification: {
              title: message.title,
              body: message.body,
              ...(message.imageUrl ? { image: message.imageUrl } : {}),
            },
            data,
            android: { priority: "high" },
            apns: {
              payload: { aps: { sound: "default", "content-available": 1 } },
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: FCM.requestTimeoutMs,
        },
      );
      return { token, sent: true };
    } catch (error) {
      const verdict = classify(error);
      return { token, sent: false, ...verdict };
    }
  };

  // Bounded concurrency: a broadcast to thousands of devices should not open
  // thousands of sockets at once.
  const CONCURRENCY = 25;
  const results = [];
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(unique.slice(i, i + CONCURRENCY).map(sendOne));
    results.push(...batch);
  }

  return {
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    deadTokens: results.filter((r) => r.isDead).map((r) => r.token),
    results,
  };
};

exports.isFcmConfigured = isFcmConfigured;
// Exposed so a health check can prove credentials work without sending anything.
exports.probeFcmAuth = async () => {
  if (!isFcmConfigured()) return { ok: false, reason: "not configured" };
  try {
    await getAccessToken();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message };
  }
};
