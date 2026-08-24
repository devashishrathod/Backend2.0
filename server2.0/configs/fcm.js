/**
 * Firebase Cloud Messaging credentials.
 *
 * Deliberately not using the `firebase-admin` SDK: it pulls in tens of megabytes
 * of dependencies for what amounts to one OAuth exchange and one HTTP POST, and
 * `axios` + `jsonwebtoken` are already here.
 *
 * Values come from a Firebase **service account** JSON
 * (Project settings -> Service accounts -> Generate new private key):
 *
 *   FCM_PROJECT_ID    = project_id
 *   FCM_CLIENT_EMAIL  = client_email
 *   FCM_PRIVATE_KEY   = private_key
 *
 * The private key is multi-line PEM. In a `.env` file it has to be written with
 * literal `\n` escapes and quoted, so those are turned back into real newlines
 * here — a key left with literal backslash-n fails signing with an unhelpful
 * error.
 */
const normalisePrivateKey = (key) =>
  key ? String(key).replace(/\\n/g, "\n").trim() : null;

const FCM = Object.freeze({
  projectId: process.env.FCM_PROJECT_ID || null,
  clientEmail: process.env.FCM_CLIENT_EMAIL || null,
  privateKey: normalisePrivateKey(process.env.FCM_PRIVATE_KEY),

  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: "https://www.googleapis.com/auth/firebase.messaging",
  sendUrl: (projectId) =>
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,

  // Access tokens last an hour; refresh a little early rather than racing the
  // expiry on a burst of sends.
  tokenTtlSeconds: 3600,
  tokenRefreshMarginSeconds: 300,
  requestTimeoutMs: 10000,
});

/** True only when every credential needed to actually send is present. */
const isFcmConfigured = () =>
  Boolean(FCM.projectId && FCM.clientEmail && FCM.privateKey);

module.exports = { FCM, isFcmConfigured };
