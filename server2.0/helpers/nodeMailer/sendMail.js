const nodemailer = require("nodemailer");

// Gmail takes ~5s per message. Nothing user-facing should wait that long, so
// callers fire and forget by default — see helpers/notifications/notify.js.
const SEND_TIMEOUT_MS = 25_000;

// One transporter, created lazily and reused. The existing OTP helpers build a
// fresh one per send, which reopens an SMTP connection every time.
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.NODEMAILER_EMAIL || !process.env.NODEMAILER_PASSWORD) {
    return null;
  }
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.NODEMAILER_EMAIL,
      pass: process.env.NODEMAILER_PASSWORD,
    },
    tls: { rejectUnauthorized: false },
    pool: true,
    // Without these nodemailer waits indefinitely on a blocked SMTP port, which
    // would hang whatever request is behind it.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Wrap plain content in the same visual shell the OTP mails use, so
 * notification email does not need a template per event.
 */
const wrap = ({ title, body, lines = [], ctaLabel, ctaUrl, footnote }) => `
  <div style="max-width:600px;margin:auto;padding:30px;font-family:Arial,sans-serif;background-color:#f9f9f9;border-radius:10px;border:1px solid #e0e0e0;">
    <h2 style="text-align:center;color:#0f766e;margin-top:0;">${escapeHtml(title)}</h2>
    <p style="font-size:15px;color:#333;line-height:1.6;">${escapeHtml(body)}</p>
    ${
      lines.length
        ? `<table style="width:100%;font-size:14px;color:#333;border-collapse:collapse;margin:20px 0;">${lines
            .map(
              ([label, value]) =>
                `<tr><td style="padding:6px 0;color:#666;">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:bold;">${escapeHtml(value)}</td></tr>`,
            )
            .join("")}</table>`
        : ""
    }
    ${
      ctaLabel && ctaUrl
        ? `<div style="text-align:center;margin:26px 0;"><a href="${escapeHtml(ctaUrl)}" style="background:#0f766e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-size:15px;">${escapeHtml(ctaLabel)}</a></div>`
        : ""
    }
    ${footnote ? `<p style="font-size:13px;color:#888;">${escapeHtml(footnote)}</p>` : ""}
    <hr style="margin:30px 0;border:none;border-top:1px solid #e0e0e0;">
    <p style="font-size:12px;color:#aaa;text-align:center;">© ${new Date().getFullYear()} Trydood. All rights reserved.</p>
  </div>`;

/**
 * Generic transactional mail sender.
 *
 * **Never throws.** Callers are business operations (activation, expiry sweep)
 * that must not be rolled back by an SMTP outage — the outcome is returned so it
 * can be recorded on the notification row instead.
 *
 * Returns `{ sent: false, skipped: true }` when SMTP is not configured, so a
 * local environment without mail credentials behaves predictably.
 *
 * @returns {Promise<{sent: boolean, skipped?: boolean, error?: string}>}
 */
exports.sendMail = async ({
  to,
  subject,
  title,
  body,
  lines,
  ctaLabel,
  ctaUrl,
  footnote,
}) => {
  if (!to) return { sent: false, skipped: true, error: "no recipient" };

  const mailer = getTransporter();
  if (!mailer) {
    return { sent: false, skipped: true, error: "SMTP not configured" };
  }

  try {
    // Hard ceiling on top of the transport timeouts, so a provider that accepts
    // the connection and then stalls still cannot pin a request open.
    await Promise.race([
      mailer.sendMail({
        from: process.env.NODEMAILER_EMAIL,
        to,
        subject: subject || title,
        html: wrap({ title, body, lines, ctaLabel, ctaUrl, footnote }),
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS}ms`)),
          SEND_TIMEOUT_MS,
        ),
      ),
    ]);
    return { sent: true };
  } catch (error) {
    console.error(`[sendMail] failed to ${to}:`, error?.message);
    return { sent: false, error: error?.message };
  }
};
