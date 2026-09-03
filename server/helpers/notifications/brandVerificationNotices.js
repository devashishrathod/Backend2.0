const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_AUDIENCE,
} = require("../../constants/notification");
const { notify } = require("./notify");
const { notifyAdmins } = require("./notifyAdmins");
const { resolveBrandIdentity } = require("../brands/resolveBrandIdentity");
const {
  PANEL_PATHS,
  ADMIN_PATHS,
  vendorUrl,
  adminUrl,
  deepLink,
  whatsappUrlParam,
} = require("./panelLinks");

/**
 * Notices for the brand onboarding and verification lifecycle.
 *
 * One function per event the vendor or the admin actually needs to hear about.
 * Deliberately **not** one per lifecycle event: the verification history records
 * nine, and only five are worth a message.
 *
 * | Event | Vendor | Admin | Why |
 * |---|---|---|---|
 * | documents submitted | ✅ | ✅ | vendor wants an acknowledgement; admin has to act |
 * | resubmitted after rejection | ✅ | ✅ | same, and it reads differently the second time |
 * | approved | ✅ | — | the admin did it; telling them is noise |
 * | rejected | ✅ + reason | — | ,, |
 * | approval revoked | ✅ + reason | — | ,, |
 * | reviewed / unreviewed toggle | ❌ | ❌ | internal. "An admin looked at you" is not news |
 * | approval acknowledged | ❌ | ❌ | the vendor's own click |
 * | onboarding step saved | ❌ | ❌ | they are in the app doing it |
 * | remediation edit | ❌ | ❌ | ,, |
 *
 * Every one of these goes through `notify()`, so all four channels come for
 * free and behave identically to the subscription notices: the in-app row is the
 * record, email and push are fire-and-forget, and WhatsApp only sends for a type
 * whose Meta-approved template is present in the environment.
 *
 * **None of these throw.** They run after the verification transaction has
 * committed — an admin's decision must never be undone because a message failed.
 *
 * ---
 *
 * ### WhatsApp template variables
 *
 * Positional and fixed-count, because that is what Meta approves. `{{1}}` is
 * always who we are addressing, resolved by `resolveBrandIdentity` so every
 * channel greets the vendor by the same name.
 *
 * | Env var (`WHATSAPP_TEMPLATE_…`) | Vars | Order |
 * |---|---|---|
 * | `BRAND_UNDER_REVIEW` | 2 | name, brand |
 * | `BRAND_RESUBMITTED` | 2 | name, brand |
 * | `BRAND_APPROVED` | 2 | name, brand |
 * | `BRAND_REJECTED` | 3 | name, brand, **reason** |
 * | `BRAND_APPROVAL_REVOKED` | 3 | name, brand, reason |
 *
 * Example body for `BRAND_APPROVED`:
 *
 * > Hey {{1}}, congratulations! 🎉 Your brand {{2}} is approved and you're
 * > officially a Trydood partner. Tap below to set up your first offer.
 */

/** Rows for the email's detail table. Only what the vendor can act on. */
const identityLines = (identity, extra = []) =>
  [
    ["Brand", identity.brandName || "-"],
    ...(identity.merchantId ? [["Merchant ID", identity.merchantId]] : []),
    ...extra,
  ].filter(Boolean);

/**
 * Documents submitted — the "we have your application" acknowledgement.
 *
 * `isResubmission` picks the wording and the type. Someone who was rejected once
 * and has just resubmitted should not receive the same first-time copy; it reads
 * as though their fix was ignored.
 */
exports.notifyBrandUnderReview = async ({
  brand,
  attemptNumber = 1,
  isResubmission = false,
  score,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);
  const type = isResubmission
    ? NOTIFICATION_TYPES.BRAND_RESUBMITTED
    : NOTIFICATION_TYPES.BRAND_UNDER_REVIEW;

  const title = isResubmission
    ? "We've got your updated details"
    : "Your application is under review";

  const body = isResubmission
    ? `Thanks ${identity.name} — we've received your updated details for ${identity.brandName} and they're back with our team for review. We'll let you know as soon as there's an outcome.`
    : `Thanks ${identity.name}! Your details for ${identity.brandName} have been submitted and our team is reviewing them now. We'll notify you the moment a decision is made.`;

  return notify({
    brandId: identity.brandId,
    type,
    severity: NOTIFICATION_SEVERITY.INFO,
    title,
    body,
    meta: {
      attemptNumber,
      isResubmission,
      score: score ?? null,
      brandName: identity.brandName,
    },
    // One notice per submission attempt, so a retried submit cannot double-send.
    dedupeKey: `${type}:${identity.brandId}:${attemptNumber}`,
    deepLink: deepLink(PANEL_PATHS.ONBOARDING_STATUS),
    mail: {
      lines: identityLines(identity, [
        ["Status", "Under review"],
        ...(attemptNumber > 1 ? [["Submission", `#${attemptNumber}`]] : []),
      ]),
      ctaLabel: "Track your application",
      ctaUrl: vendorUrl(PANEL_PATHS.ONBOARDING_STATUS),
      footnote:
        "Reviews are usually completed within 1–2 business days. You don't need to do anything right now.",
    },
    awaitDelivery,
    // 2 vars: name, brand.
    whatsapp: {
      params: [identity.name, identity.brandName],
      urlParam: whatsappUrlParam(PANEL_PATHS.ONBOARDING_STATUS),
    },
  });
};

/** Approved. The one message a vendor is actually waiting for. */
exports.notifyBrandApproved = async ({
  brand,
  attemptNumber = 1,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);

  return notify({
    brandId: identity.brandId,
    type: NOTIFICATION_TYPES.BRAND_APPROVED,
    // Good news. CRITICAL would put a red banner on a congratulations message.
    severity: NOTIFICATION_SEVERITY.INFO,
    title: "Congratulations — your brand is approved! 🎉",
    body: `Hey ${identity.name}, great news! ${identity.brandName} has been verified and approved. You're officially a Trydood partner — you can now publish vouchers, add outlets and build your showcase.`,
    meta: { attemptNumber, brandName: identity.brandName },
    // Re-approval after a revoke is a genuinely new event, so the attempt number
    // keeps this idempotent per approval rather than per brand forever.
    dedupeKey: `${NOTIFICATION_TYPES.BRAND_APPROVED}:${identity.brandId}:${attemptNumber}`,
    deepLink: deepLink(PANEL_PATHS.DASHBOARD),
    mail: {
      title: "Welcome aboard — you're a Trydood partner 🎉",
      lines: identityLines(identity, [["Status", "Approved"]]),
      ctaLabel: "Go to your dashboard",
      ctaUrl: vendorUrl(PANEL_PATHS.DASHBOARD),
      footnote:
        "Next step: choose a plan and publish your first voucher so customers can start finding you.",
    },
    awaitDelivery,
    // 2 vars: name, brand.
    whatsapp: {
      params: [identity.name, identity.brandName],
      urlParam: whatsappUrlParam(PANEL_PATHS.DASHBOARD),
    },
  });
};

/**
 * Rejected, with the admin's reason.
 *
 * The reason is the entire point: a rejection without one leaves the vendor with
 * nothing to fix, and support with a ticket. It is carried on the row, in the
 * email body, and as the third WhatsApp variable.
 */
exports.notifyBrandRejected = async ({
  brand,
  reason,
  attemptNumber = 1,
  canResubmit = true,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);
  const stated = reason || "Some of the details provided could not be verified.";

  return notify({
    brandId: identity.brandId,
    type: NOTIFICATION_TYPES.BRAND_REJECTED,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: "We couldn't verify your brand yet",
    body: `Hi ${identity.name}, we reviewed the details for ${identity.brandName} and couldn't approve them yet. Reason: ${stated}${canResubmit ? " You can update the details and submit again." : ""}`,
    meta: { reason: stated, attemptNumber, brandName: identity.brandName },
    dedupeKey: `${NOTIFICATION_TYPES.BRAND_REJECTED}:${identity.brandId}:${attemptNumber}`,
    deepLink: deepLink(PANEL_PATHS.ONBOARDING_FIX),
    mail: {
      lines: identityLines(identity, [
        ["Status", "Needs changes"],
        ["Reason", stated],
      ]),
      ctaLabel: canResubmit ? "Update and resubmit" : "Contact support",
      ctaUrl: vendorUrl(
        canResubmit ? PANEL_PATHS.ONBOARDING_FIX : PANEL_PATHS.SUPPORT,
      ),
      footnote:
        "Fix the point above and submit again — there's no limit on resubmissions, and nothing else you've entered is lost.",
    },
    awaitDelivery,
    // 3 vars: name, brand, reason.
    whatsapp: {
      params: [identity.name, identity.brandName, stated],
      urlParam: whatsappUrlParam(PANEL_PATHS.ONBOARDING_FIX),
    },
  });
};

/**
 * An approval withdrawn after it was granted.
 *
 * Kept separate from rejection because the vendor's situation is different: they
 * were live, customers may have seen them, and now they are not. CRITICAL, and
 * the copy says what it means rather than reusing the rejection wording.
 */
exports.notifyBrandApprovalRevoked = async ({
  brand,
  reason,
  attemptNumber = 1,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);
  const stated = reason || "Your brand approval has been withdrawn.";

  return notify({
    brandId: identity.brandId,
    type: NOTIFICATION_TYPES.BRAND_APPROVAL_REVOKED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: "Your brand approval has been withdrawn",
    body: `Hi ${identity.name}, the approval for ${identity.brandName} has been withdrawn by our team. Reason: ${stated} Please update your details and submit again, or contact support if you think this is a mistake.`,
    meta: { reason: stated, attemptNumber, brandName: identity.brandName },
    dedupeKey: `${NOTIFICATION_TYPES.BRAND_APPROVAL_REVOKED}:${identity.brandId}:${attemptNumber}`,
    deepLink: deepLink(PANEL_PATHS.ONBOARDING_FIX),
    mail: {
      lines: identityLines(identity, [
        ["Status", "Approval withdrawn"],
        ["Reason", stated],
      ]),
      ctaLabel: "Review your details",
      ctaUrl: vendorUrl(PANEL_PATHS.ONBOARDING_FIX),
      footnote:
        "Your outlets, vouchers and showcase content are not deleted — they stay in place while this is resolved.",
    },
    awaitDelivery,
    // 3 vars: name, brand, reason.
    whatsapp: {
      params: [identity.name, identity.brandName, stated],
      urlParam: whatsappUrlParam(PANEL_PATHS.ONBOARDING_FIX),
    },
  });
};

/**
 * Tell the admin team a brand is waiting on them.
 *
 * The **only** vendor-triggered event that reaches the admin feed, in its two
 * forms. Both mean somebody has to make a decision — which is the bar, because a
 * feed that also carries "a vendor saved their PAN" stops being read.
 *
 * Email is on: this is queue work, and an admin who is not in the panel still
 * needs to know. Push goes to whichever admins have registered a device.
 */
exports.notifyAdminsBrandAwaitingReview = async ({
  brand,
  attemptNumber = 1,
  isResubmission = false,
  score,
  systemStatus,
  awaitDelivery = false,
}) => {
  const identity = await resolveBrandIdentity(brand);
  const type = isResubmission
    ? NOTIFICATION_TYPES.BRAND_AWAITING_RE_REVIEW
    : NOTIFICATION_TYPES.BRAND_AWAITING_REVIEW;

  const label = isResubmission ? "resubmitted" : "submitted";

  return notifyAdmins({
    awaitDelivery,
    type,
    severity: NOTIFICATION_SEVERITY.WARNING,
    title: isResubmission
      ? `${identity.brandName} resubmitted for review`
      : `New brand awaiting review: ${identity.brandName}`,
    body: `${identity.brandName} has ${label} verification documents${
      attemptNumber > 1 ? ` (attempt #${attemptNumber})` : ""
    }${score !== undefined && score !== null ? ` with a system score of ${score}` : ""}. It is waiting on a review decision.`,
    meta: {
      brandId: identity.brandId,
      brandName: identity.brandName,
      legalName: identity.legalName,
      merchantId: identity.merchantId,
      brandUniqueId: identity.uniqueId,
      attemptNumber,
      isResubmission,
      score: score ?? null,
      systemStatus: systemStatus || null,
    },
    deepLink: deepLink(ADMIN_PATHS.brandVerification(identity.brandId)),
    // One alert per attempt. `notifyAdmins` suffixes this per admin, so each
    // admin still gets their own row.
    dedupeKey: `${type}:${identity.brandId}:${attemptNumber}`,
    mail: {
      lines: [
        ["Brand", identity.brandName || "-"],
        ...(identity.legalName ? [["Legal name", identity.legalName]] : []),
        ...(identity.merchantId ? [["Merchant ID", identity.merchantId]] : []),
        ["Attempt", `#${attemptNumber}`],
        ...(score !== undefined && score !== null
          ? [["System score", String(score)]]
          : []),
        ...(systemStatus ? [["System verdict", systemStatus]] : []),
      ],
      ctaLabel: "Open verification queue",
      ctaUrl: adminUrl(ADMIN_PATHS.brandVerification(identity.brandId)),
    },
  });
};

// Exposed so the admin audience label stays consistent if a caller needs it.
exports.BRAND_REVIEW_ADMIN_AUDIENCE = NOTIFICATION_AUDIENCE.ADMIN;
