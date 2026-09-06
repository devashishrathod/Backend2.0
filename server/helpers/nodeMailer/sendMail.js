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
 * One warning per distinct cause, not per message.
 *
 * A notice that goes out a thousand times a day would otherwise print a thousand
 * identical lines and bury everything else in the log.
 */
const warnedOnce = new Set();
const warnOnce = (key, message) => {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
};

/**
 * The email's buttons, from any shape a caller might reasonably use.
 *
 * ### ⚠️ Why this function exists
 *
 * `notify()` used to forward a **hand-listed** set of mail fields, and five
 * notice files spelled the button `buttonText` / `buttonUrl` while this renderer
 * read `ctaLabel` / `ctaUrl`. That name was simply not on the list, so it was
 * dropped in transit: the mail still sent, still had its heading, body, detail
 * table and footer, and **19 buttons never rendered** — "Download Invoice",
 * "View settlement", "Review Refund", "Open dispute". Nothing errored, because a
 * missing button is an empty string, and no test looked at rendered HTML.
 *
 * So every spelling is folded into one shape, in one place:
 *
 * | Caller passes | Meaning |
 * |---|---|
 * | `ctaLabel` + `ctaUrl` | one button — the canonical form, and the common case |
 * | `actions: [{ label, url }, …]` | two or more, rendered in order |
 * | `buttonText` + `buttonUrl` | the old name. Still renders, and warns |
 *
 * The old name is kept **working** deliberately. The point of this function is
 * that a key nobody remembers must never cost a button again; the warning is
 * what makes the drift loud instead of silent.
 *
 * @returns {Array<{label: string, url: string}>}
 */
const normaliseActions = ({
  actions,
  ctaLabel,
  ctaUrl,
  buttonText,
  buttonUrl,
} = {}) => {
  const candidates = [
    ...(Array.isArray(actions) ? actions : []),
    { label: ctaLabel, url: ctaUrl },
    { label: buttonText, url: buttonUrl, legacy: true },
  ];

  const resolved = [];

  for (const candidate of candidates) {
    const { label, url, legacy } = candidate || {};
    // Neither half given — this slot was simply not used.
    if (!label && !url) continue;

    if (legacy) {
      warnOnce(
        `legacy:${label}`,
        `[sendMail] "${label}" was passed as buttonText/buttonUrl — the field is ctaLabel/ctaUrl (or actions). It still renders; please rename it.`,
      );
    }

    /**
     * A label with no URL renders nothing, on purpose: `vendorUrl` / `adminUrl` /
     * `invoiceUrl` return `undefined` when their env var is unset, and a button
     * pointing at a hostless `/settlements` is worse than no button at all.
     *
     * ⚠️ It warns, though, because from the outside this is **indistinguishable
     * from the bug above** — somebody corrects the field name, still sees no
     * button, and concludes the fix did not work when the real cause is a
     * missing `VENDOR_PANEL_URL`.
     */
    if (!url) {
      warnOnce(
        `nourl:${label}`,
        `[sendMail] button "${label}" has no URL and was omitted — check VENDOR_PANEL_URL / ADMIN_PANEL_URL / PUBLIC_API_URL.`,
      );
      continue;
    }
    // A URL with no label is nothing a reader can click.
    if (!label) {
      warnOnce(
        `nolabel:${url}`,
        `[sendMail] a button URL was given with no label and was omitted: ${url}`,
      );
      continue;
    }

    resolved.push({ label: String(label), url: String(url) });
  }

  return resolved;
};

/**
 * The buttons themselves. First one is the action being suggested; anything after
 * it is an alternative, so it is outlined rather than filled.
 *
 * `display:inline-block` and a margin rather than flex or a grid — Outlook
 * ignores both, and these have to survive it.
 *
 * `data-cta` marks them for the tests. The rendered button is the only thing that
 * proves a CTA survived the trip from the notice, and matching on an inline style
 * string would break the moment somebody changes the padding.
 */
const actionButtons = (actions) =>
  actions.length
    ? `<div style="text-align:center;margin:26px 0 14px;">${actions
        .map(({ label, url }, index) =>
          index === 0
            ? `<a data-cta="primary" href="${escapeHtml(url)}" style="background:#0f766e;color:#fff;padding:12px 26px;border-radius:6px;text-decoration:none;font-size:15px;display:inline-block;margin:4px;">${escapeHtml(label)}</a>`
            : `<a data-cta="secondary" href="${escapeHtml(url)}" style="background:#ffffff;color:#0f766e;border:1px solid #0f766e;padding:11px 24px;border-radius:6px;text-decoration:none;font-size:15px;display:inline-block;margin:4px;">${escapeHtml(label)}</a>`,
        )
        .join("")}</div>`
    : "";

/**
 * The plain-text link under the buttons.
 *
 * ### Why every email carries this
 *
 * A styled `<a>` is not reliably a working button. Outlook renders it as text
 * with the link intact but the block gone; a text-only client shows the label and
 * discards the href entirely; a corporate gateway rewrites or strips it; and a
 * reader who is rightly suspicious of a button in an email about their **bank
 * account** wants to see where it goes before they touch it. In every one of
 * those cases the visible URL is the only way through.
 *
 * ⚠️ It is also the honest version of the thing this platform gets wrong twice
 * over: a notice whose destination is broken looks identical to one whose
 * destination is fine. A URL printed on the page can be read, checked, and
 * reported.
 *
 * One action gets a sentence; two or more get a labelled list, because
 * "copy this link" is ambiguous once there is more than one.
 */
const actionFallback = (actions) => {
  if (!actions.length) return "";

  const style =
    'style="color:#0f766e;text-decoration:underline;word-break:break-all;"';

  if (actions.length === 1) {
    const { url } = actions[0];
    return `<p style="font-size:12px;color:#888;line-height:1.6;text-align:center;margin:0 0 24px;">If the button above doesn't work, copy and paste this link into your browser:<br><a data-cta-fallback="1" href="${escapeHtml(url)}" ${style}>${escapeHtml(url)}</a></p>`;
  }

  return `<p style="font-size:12px;color:#888;line-height:1.6;text-align:center;margin:0 0 24px;">If the buttons above don't work, copy and paste these links into your browser:<br>${actions
    .map(
      ({ label, url }) =>
        `<span style="display:inline-block;margin:4px 0;">${escapeHtml(label)} — <a data-cta-fallback="1" href="${escapeHtml(url)}" ${style}>${escapeHtml(url)}</a></span>`,
    )
    .join("<br>")}</p>`;
};

/**
 * Wrap plain content in the same visual shell the OTP mails use, so
 * notification email does not need a template per event.
 *
 * ⚠️ Everything it does not name itself is handed to `normaliseActions` through
 * `...rest`. That is what keeps this generic: a caller can grow a second button
 * without a signature change here, in `sendMail`, or in `notify`.
 *
 * Exported for the tests — the button bug above lived precisely in the gap
 * between "the notice built the right object" and "the HTML contained a button",
 * and the only way to close it is to assert on the rendered string.
 */
const renderMailHtml = ({ title, body, lines = [], footnote, ...rest }) => {
  // Resolved once — the buttons and the fallback list have to agree, and calling
  // the normaliser twice would warn twice about the same missing URL.
  const actions = normaliseActions(rest);

  return `
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
    ${actionButtons(actions)}
    ${actionFallback(actions)}
    ${footnote ? `<p style="font-size:13px;color:#888;">${escapeHtml(footnote)}</p>` : ""}
    <hr style="margin:30px 0;border:none;border-top:1px solid #e0e0e0;">
    <p style="font-size:12px;color:#aaa;text-align:center;">© ${new Date().getFullYear()} Trydood. All rights reserved.</p>
  </div>`;
};

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
 * ### The signature names only what the transport needs
 *
 * `to` and `subject` are the envelope; everything else is content and goes to
 * `renderMailHtml` as `...content`. ⚠️ This is deliberate rather than tidy: the
 * old signature listed every content field, so a notice passing a field that was
 * not on the list had it silently dropped — which is exactly how 19 email buttons
 * went missing. Nothing here needs changing to add a button, a footnote or any
 * field the renderer learns later.
 *
 * @returns {Promise<{sent: boolean, skipped?: boolean, error?: string}>}
 */
exports.sendMail = async ({ to, subject, title, attachments, ...content }) => {
  if (!to) return { sent: false, skipped: true, error: "no recipient" };

  const mailer = getTransporter();
  if (!mailer) {
    return { sent: false, skipped: true, error: "SMTP not configured" };
  }

  try {
    // Hard ceiling on top of the transport timeouts, so a provider that accepts
    // the connection and then stalls still cannot pin a request open.
    const info = await Promise.race([
      mailer.sendMail({
        from: process.env.NODEMAILER_EMAIL,
        to,
        subject: subject || title,
        html: renderMailHtml({ title, ...content }),
        /**
         * Nodemailer's own attachment shape, passed straight through.
         *
         * Spread conditionally so the key is absent rather than `undefined` on
         * the ordinary case — every notification this system sends is a link to
         * a document, never the document itself, because a receipt mailed as an
         * attachment cannot be revoked and cannot be re-rendered after a
         * correction. The download link can do both.
         *
         * It exists for the verification script, which mails the rendered PDF
         * beside the real notification so a whole document can be reviewed
         * without a deploy.
         */
        ...(attachments?.length ? { attachments } : {}),
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS}ms`)),
          SEND_TIMEOUT_MS,
        ),
      ),
    ]);

    /**
     * ⚠️ Per-recipient, because "sent" is not one fact when `to` is a list.
     *
     * The transport reports which addresses it took and which it refused, and
     * this used to throw all of it away and return a bare `{ sent: true }`. A
     * partial refusal — one bad address out of several — then read as complete
     * success, and the only trace was a bounce arriving somewhere else later.
     *
     * `sendMail` throws only when **every** recipient is refused, so a mixed
     * result is silent by default. That is fine for a notification, which has one
     * recipient; it is not fine for anything addressing a list.
     */
    const rejected = (info?.rejected || []).map(String);

    return {
      sent: true,
      accepted: (info?.accepted || []).map(String),
      rejected,
      // Surfaced so a caller need not compare the two arrays to notice.
      ...(rejected.length ? { partial: true } : {}),
      response: info?.response,
    };
  } catch (error) {
    console.error(`[sendMail] failed to ${to}:`, error?.message);
    return { sent: false, error: error?.message };
  }
};

/**
 * Exported for the tests, not for callers — mail is sent through `sendMail`.
 *
 * `__tests__/money/mailRender.test.js` asserts on the rendered HTML, because the
 * button bug was invisible to every test that stopped at "the notice built the
 * right object".
 */
exports.renderMailHtml = renderMailHtml;
exports.normaliseActions = normaliseActions;
