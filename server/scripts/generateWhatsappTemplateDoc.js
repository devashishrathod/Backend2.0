/**
 * Builds the two WhatsApp template documents that leave this repo.
 *
 *   1. Trydood_WhatsApp_Templates       — the content brief, for whoever creates
 *                                         the templates in the provider's panel.
 *   2. Trydood_WhatsApp_Button_Paths    — every button, its URL, the backend
 *                                         constant behind it and the front-end
 *                                         route it needs. For the web/app team.
 *
 * Both come from the same `TEMPLATES` array below, so they can never disagree
 * about a button, a URL or a template name.
 *
 *   node scripts/generateWhatsappTemplateDoc.js
 *   node scripts/generateWhatsappTemplateDoc.js --docx
 *
 * `--docx` hands each .html to the locally installed Word to save as a real
 * .docx. The paths document is also written as .md, because that one is meant to
 * be edited — the front-end team fills in their real routes and the corrections
 * come back into this file.
 *
 * The technical companion — field paths, code changes, known gaps — is
 * docs/whatsapp_template_specification.md. Neither document here carries any of
 * that: their readers fill in a form or wire a route, and the rest is noise.
 */

const fs = require("fs");
const path = require("path");

const API = "https://api.trydood.com";
const VENDOR = "https://vendor.trydood.com";
const ADMIN = "https://admin.trydood.com";
const APP = "https://app.trydood.com";
const SITE = "https://trydood.com";
const DOCS = `${API}/trydood/v1/documents`;
const CONTACT = `${SITE}/contact`;

const SIGN_VENDOR = `For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀`;
const SIGN_GOOD = `For any assistance, contact us at helpdesk@trydood.com.
Trydood – Save More, Every Time 💚`;
const SIGN_SORRY = `For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚`;

const v = (n, name, type, sample, note) => ({ n, name, type, sample, note });

/**
 * A button, plus everything the front-end team needs to build its destination.
 *
 * `backend` names the constant that produces the path — the single place a route
 * rename has to happen. `NEW` means it does not exist yet and has to be added
 * before that button can work.
 */
const btn = (text, urlType, url, sample, wiring = {}) => ({
  action: "Visit Website",
  text,
  urlType,
  url,
  sample: sample || "—",
  owner: wiring.owner || "Vendor panel",
  backend: wiring.backend || "—",
  valueIs: wiring.valueIs || "—",
  route: wiring.route || "—",
  status: wiring.status || "Exists",
});

const doc = (label, sample) =>
  btn(label, "Dynamic", `${DOCS}/{{1}}`, sample, {
    owner: "Backend (public)",
    backend: "documentUrl(token)",
    valueIs: "documentToken (64-char hex)",
    route: "GET /trydood/v1/documents/:token — already live",
    status: "Exists",
  });

const contact = () =>
  btn("Contact Support", "Static", CONTACT, null, {
    owner: "Website",
    backend: "— (external, fixed URL)",
    valueIs: "—",
    route: "trydood.com/contact",
    status: "Confirm page exists",
  });

const TEMPLATES = [
  // ===================== VENDOR · SUBSCRIPTION =====================
  {
    id: 1,
    name: "vendor_subscription_activated",
    title: "Subscription Activated",
    role: "Vendor",
    group: "Subscription",
    when: "A vendor pays for a subscription for the first time.",
    body: `🎉 Subscription Activated Successfully!
Hello {{1}},
Your Trydood subscription has been successfully activated. ✅
📋 Plan: {{2}}
📅 Start Date: {{3}}
📅 Expiry Date: {{4}}
💰 Amount Paid: ₹{{5}}
Thank you for choosing Trydood! We're happy to have you with us. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Start Date", "Date", "29 Aug 2026"),
      v(4, "Expiry Date", "Date", "29 Aug 2027"),
      v(5, "Amount Paid", "Amount", "1999.00"),
    ],
    buttons: [
      doc("Download Invoice", "a3f9c1e8b2d47c05"),
      btn("View Subscription", "Static", `${VENDOR}/subscription`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION",
        route: "The vendor's own subscription page — NOT the plan list",
        status: "Confirm route",
      }),
    ],
  },
  {
    id: 2,
    name: "vendor_subscription_renewed",
    title: "Subscription Renewed",
    role: "Vendor",
    group: "Subscription",
    when: "A vendor renews the same plan.",
    body: `🎉 Subscription Renewed Successfully!
Hello {{1}},
Your Trydood subscription has been successfully renewed. ✅
📋 Plan: {{2}}
📅 Renewal Date: {{3}}
📅 New Expiry Date: {{4}}
💰 Amount Paid: ₹{{5}}
Thank you for continuing with Trydood! 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Renewal Date", "Date", "29 Aug 2026"),
      v(4, "New Expiry Date", "Date", "29 Aug 2027"),
      v(5, "Amount Paid", "Amount", "1999.00"),
    ],
    buttons: [
      doc("Download Invoice", "a3f9c1e8b2d47c05"),
      btn("View Subscription", "Static", `${VENDOR}/subscription`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION",
        route: "The vendor's own subscription page — NOT the plan list",
        status: "Confirm route",
      }),
    ],
  },
  {
    id: 3,
    name: "vendor_subscription_upgraded",
    title: "Subscription Upgraded",
    role: "Vendor",
    group: "Subscription",
    when: "A vendor moves to a costlier plan.",
    body: `🎉 Subscription Upgraded Successfully!
Hello {{1}},
Great news! Your Trydood subscription has been successfully upgraded. ✅
📋 Previous Plan: {{2}}
🚀 New Plan: {{3}}
📅 Upgrade Date: {{4}}
📅 Expiry Date: {{5}}
💰 Amount Paid: ₹{{6}}
You can now enjoy the benefits and features included in your new plan. 💚
Thank you for choosing Trydood!
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Previous Plan", "Text", "Pro Lite"),
      v(3, "New Plan", "Text", "Prime Plus"),
      v(4, "Upgrade Date", "Date", "29 Aug 2026"),
      v(5, "Expiry Date", "Date", "29 Aug 2027"),
      v(6, "Amount Paid", "Amount", "1999.00"),
    ],
    buttons: [
      doc("Download Invoice", "a3f9c1e8b2d47c05"),
      btn("View Subscription", "Static", `${VENDOR}/subscription`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION",
        route: "The vendor's own subscription page — NOT the plan list",
        status: "Confirm route",
      }),
    ],
  },
  {
    id: 4,
    name: "vendor_subscription_downgraded",
    title: "Subscription Downgraded",
    role: "Vendor",
    group: "Subscription",
    when: "A vendor moves to a cheaper plan.",
    body: `🔄 Subscription Downgraded Successfully
Hello {{1}},
Your Trydood subscription has been successfully downgraded. ✅
📋 Previous Plan: {{2}}
📉 New Plan: {{3}}
📅 Effective Date: {{4}}
📅 Expiry Date: {{5}}
Your subscription will now continue with the features and benefits available in your new plan.
Thank you for choosing Trydood. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Previous Plan", "Text", "Prime Plus"),
      v(3, "New Plan", "Text", "Pro Lite"),
      v(4, "Effective Date", "Date", "29 Aug 2026"),
      v(5, "Expiry Date", "Date", "29 Aug 2027"),
    ],
    buttons: [
      doc("Download Invoice", "a3f9c1e8b2d47c05"),
      btn("View Subscription", "Static", `${VENDOR}/subscription`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION",
        route: "The vendor's own subscription page — NOT the plan list",
        status: "Confirm route",
      }),
    ],
    note: "A downgrade is still a purchase — the vendor buys the cheaper plan, so a payment is taken and an invoice is issued exactly as on an upgrade. It gets the same two buttons.",
  },
  {
    id: 5,
    name: "vendor_subscription_granted",
    title: "Subscription Granted",
    role: "Vendor",
    group: "Subscription",
    when: "An admin gives a vendor a subscription — complimentary, or paid outside the app.",
    body: `🎉 Subscription Granted Successfully!
Hello {{1}},
Your Trydood subscription has been granted successfully. ✅
📋 Plan: {{2}}
📅 Start Date: {{3}}
📅 Expiry Date: {{4}}
🎁 Access Type: {{5}}
You can now enjoy the features and benefits included in your subscription. 💚
Thank you for choosing Trydood!
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Start Date", "Date", "29 Aug 2026"),
      v(4, "Expiry Date", "Date", "29 Aug 2027"),
      v(5, "Access Type", "Text", "Complimentary", "Either “Complimentary” or “Paid offline”"),
    ],
    buttons: [
      doc("Download Advice", "b7c2e91f4a83d610"),
      btn("View Subscription", "Static", `${VENDOR}/subscription`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION",
        route: "The vendor's own subscription page — NOT the plan list",
        status: "Confirm route",
      }),
    ],
    note: "The document here is a grant advice, not an invoice — no money was collected through the app.",
  },
  {
    id: 6,
    name: "vendor_subscription_expiring",
    title: "Subscription Expiring Soon",
    role: "Vendor",
    group: "Subscription",
    when: "A reminder sent in the days before a subscription expires.",
    body: `⏰ Subscription Expiring Soon!
Hello {{1}},
Your Trydood subscription is expiring soon. ⚠️
📋 Plan: {{2}}
📅 Expiry Date: {{3}}
⏳ Days Remaining: {{4}}
To continue enjoying your subscription benefits without interruption, please renew your plan before the expiry date.
💚 Thank you for being with Trydood!
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Expiry Date", "Date", "29 Aug 2027"),
      v(4, "Days Remaining", "Number", "7"),
    ],
    buttons: [
      btn("Renew Now", "Static", `${VENDOR}/subscription/plans`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION_PLANS",
        route: "The plan list — correct here, the vendor is choosing",
        status: "Exists",
      }),
    ],
  },
  {
    id: 7,
    name: "vendor_subscription_expired",
    title: "Subscription Expired",
    role: "Vendor",
    group: "Subscription",
    when: "The subscription has lapsed and the vendor's benefits are off.",
    body: `⚠️ Subscription Expired
Hello {{1}},
Your Trydood subscription has expired.
📋 Plan: {{2}}
📅 Expiry Date: {{3}}
🔒 Status: Expired
Your subscription benefits are no longer active. Renew your subscription to continue enjoying Trydood features and benefits. 🚀
Thank you for choosing Trydood. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Expiry Date", "Date", "29 Aug 2027"),
    ],
    buttons: [
      btn("Renew Now", "Static", `${VENDOR}/subscription/plans`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION_PLANS",
        route: "The plan list",
        status: "Exists",
      }),
    ],
  },
  {
    id: 8,
    name: "vendor_subscription_cancelled",
    title: "Subscription Cancelled",
    role: "Vendor",
    group: "Subscription",
    when: "A subscription is cancelled. Benefits continue until the access end date.",
    body: `❌ Subscription Cancelled
Hello {{1}},
Your Trydood subscription has been successfully cancelled.
📋 Plan: {{2}}
📅 Cancellation Date: {{3}}
📅 Access Until: {{4}}
🔒 Status: Cancelled
Your subscription benefits will remain available until the access end date mentioned above.
We're sorry to see you go. 💚 You can subscribe again anytime to continue enjoying Trydood benefits.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Plan Name", "Text", "Prime Plus"),
      v(3, "Cancellation Date", "Date", "07 Sep 2026"),
      v(4, "Access Until", "Date", "29 Aug 2027"),
    ],
    buttons: [
      btn("Subscribe Again", "Static", `${VENDOR}/subscription/plans`, null, {
        backend: "PANEL_PATHS.SUBSCRIPTION_PLANS",
        route: "The plan list",
        status: "Exists",
      }),
    ],
  },

  // ===================== VENDOR · BRAND VERIFICATION =====================
  {
    id: 9,
    name: "brand_under_review",
    title: "Brand Under Review",
    role: "Vendor",
    group: "Brand Verification",
    when: "A vendor submits their brand for verification.",
    body: `🔍 Your Brand Is Under Review
Hello {{1}},
We have received your brand details and our team has started verifying them. ✅
🆔 Merchant ID: {{2}}
📅 Submitted On: {{3}}
🔎 Status: Under Review
📄 What happens next: our team checks your GST, PAN and bank details.
⏳ Most reviews are completed within a few working days.
You do not need to do anything right now — we will message you the moment the review is complete. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Submitted On", "Date & Time", "07 Sep 2026 04:12 PM"),
    ],
    buttons: [
      btn("Track Application", "Static", `${VENDOR}/onboarding/status`, null, {
        backend: "PANEL_PATHS.ONBOARDING_STATUS",
        route: "onboarding/status",
        status: "Exists",
      }),
    ],
    note: "“Most reviews are completed within a few working days” is fixed text on purpose — it answers the vendor's first question without committing to a number we would have to resubmit to change.",
  },
  {
    id: 10,
    name: "brand_resubmitted",
    title: "Brand Details Resubmitted",
    role: "Vendor",
    group: "Brand Verification",
    when: "A vendor corrects and resubmits after a rejection.",
    body: `🔄 Updated Details Received
Hello {{1}},
Thank you — we have received your updated brand details and they are back with our verification team. ✅
🆔 Merchant ID: {{2}}
📅 Resubmitted On: {{3}}
🔁 Attempt: {{4}}
🔎 Status: Under Review
⏳ Most reviews are completed within a few working days.
Your earlier submission has been replaced by this one. There is nothing further to send.
We will message you as soon as the review is complete. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Resubmitted On", "Date & Time", "07 Sep 2026 06:40 PM"),
      v(4, "Attempt Number", "Number", "2"),
    ],
    buttons: [
      btn("Track Application", "Static", `${VENDOR}/onboarding/status`, null, {
        backend: "PANEL_PATHS.ONBOARDING_STATUS",
        route: "onboarding/status",
        status: "Exists",
      }),
    ],
  },
  {
    id: 11,
    name: "brand_approved",
    title: "Brand Approved",
    role: "Vendor",
    group: "Brand Verification",
    when: "An admin approves the brand. The vendor can now start selling.",
    body: `🎉 Your Brand Is Approved!
Hello {{1}},
Great news — your brand has been verified and approved on Trydood. ✅
🆔 Merchant ID: {{2}}
📅 Approved On: {{3}}
🔎 Status: Approved
You can now sign in and start selling:
🏪 Add your outlets — customers find you through these
🎟️ Publish your vouchers, and every new Trydood service as we launch it
💬 Quote your Merchant ID whenever you contact us
Welcome to Trydood. We're glad to have you. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Approved On", "Date & Time", "08 Sep 2026 11:20 AM"),
    ],
    buttons: [
      btn("Go to Dashboard", "Static", `${VENDOR}/dashboard`, null, {
        backend: "PANEL_PATHS.DASHBOARD",
        route: "dashboard",
        status: "Exists",
      }),
    ],
    note: "The services line is worded to survive new features. Dealpacks, memberships, delivery and anything else launched later are already covered by “every new Trydood service as we launch it”, so this template never has to be rebuilt to mention them.",
  },
  {
    id: 12,
    name: "brand_rejected",
    title: "Brand Verification Rejected",
    role: "Vendor",
    group: "Brand Verification",
    when: "Verification fails. The vendor can correct the details and resubmit.",
    body: `📋 Brand Verification Update
Hello {{1}},
We were not able to verify your brand with the details provided.
🆔 Merchant ID: {{2}}
📅 Reviewed On: {{3}}
🔎 Status: Not Approved
📝 Reason: {{4}}
This is not final. Please correct the details above and resubmit — your application stays open and nothing has been deleted.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Reviewed On", "Date & Time", "08 Sep 2026 11:20 AM"),
      v(
        4,
        "Reason",
        "Long Text",
        "The GST certificate is registered to a different legal name than the PAN.",
        "Written by an admin. Up to 180 characters.",
      ),
    ],
    buttons: [
      btn("Update and Resubmit", "Static", `${VENDOR}/onboarding/review`, null, {
        backend: "PANEL_PATHS.ONBOARDING_FIX",
        route: "onboarding/review",
        status: "Exists",
      }),
      contact(),
    ],
  },
  {
    id: 13,
    name: "brand_approval_revoked",
    title: "Brand Approval Withdrawn",
    role: "Vendor",
    group: "Brand Verification",
    when: "An already-approved brand has its approval withdrawn.",
    body: `⚠️ Brand Approval Withdrawn
Hello {{1}},
Your brand's approval on Trydood has been withdrawn.
🆔 Merchant ID: {{2}}
📅 Withdrawn On: {{3}}
🔎 Status: Approval Withdrawn
📝 Reason: {{4}}
Your vouchers are no longer available to customers while this is in place.
Nothing has been deleted. Please review the details above and resubmit, or contact us if you believe this is a mistake.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Withdrawn On", "Date & Time", "08 Sep 2026 11:20 AM"),
      v(
        4,
        "Reason",
        "Long Text",
        "The GST registration has been cancelled at the portal.",
        "Written by an admin. Up to 180 characters.",
      ),
    ],
    buttons: [
      btn("Review Details", "Static", `${VENDOR}/onboarding/review`, null, {
        backend: "PANEL_PATHS.ONBOARDING_FIX",
        route: "onboarding/review",
        status: "Exists",
      }),
      contact(),
    ],
  },

  // ===================== VENDOR · BRAND STATUS =====================
  {
    id: 14,
    name: "brand_deactivated",
    title: "Vendor Account Deactivated",
    role: "Vendor",
    group: "Brand Status",
    when: "An admin deactivates the vendor's account. They cannot sign in.",
    body: `🔒 Account Deactivated
Hello {{1}},
Your Trydood vendor account has been deactivated.
🆔 Merchant ID: {{2}}
📅 Deactivated On: {{3}}
🔎 Status: Deactivated
📝 Reason: {{4}}
👁️ Customer Visibility: {{5}}
What this means: you cannot sign in to the vendor panel while this is in place.
Your outlets, vouchers and settlement records are all safe and nothing has been deleted.
Please contact us and we will help you resolve it.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Deactivated On", "Date & Time", "08 Sep 2026 03:05 PM"),
      v(
        4,
        "Reason",
        "Long Text",
        "Please contact support for details.",
        "The admin's reason when one was written; otherwise the default shown here. Up to 180 characters.",
      ),
      v(
        5,
        "Customer Visibility",
        "Status",
        "Active — your vouchers and other services are still running and customers can still use them",
        "Exactly one of two sentences. Hidden: “Hidden — customers cannot see or use your services right now”. Visible: the sample shown here.",
      ),
    ],
    buttons: [contact()],
    note: "Variable 5 is a full sentence rather than one word, because the account switch and customer visibility are separate. A deactivated vendor's brand can still be selling to customers, and a template body cannot branch — so the difference has to live inside the variable.",
  },
  {
    id: 15,
    name: "brand_activated",
    title: "Vendor Account Reactivated",
    role: "Vendor",
    group: "Brand Status",
    when: "The account is switched back on.",
    body: `✅ Account Reactivated
Hello {{1}},
Good news — your Trydood vendor account is active again.
🆔 Merchant ID: {{2}}
📅 Reactivated On: {{3}}
🔎 Status: Active
Everything is exactly as you left it — your outlets, vouchers and settlement records are all intact.
🔐 Please note: you will need to sign in again, as your earlier sessions were closed.
Welcome back. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Reactivated On", "Date & Time", "09 Sep 2026 10:15 AM"),
    ],
    buttons: [
      btn("Sign In", "Static", `${VENDOR}/dashboard`, null, {
        backend: "PANEL_PATHS.DASHBOARD",
        route: "dashboard — the panel's own auth guard sends them to login first",
        status: "Exists",
      }),
    ],
    note: "The sign-in note must stay. Every session ends on reactivation, so a vendor who taps the button lands on a login screen — without the warning that reads as still broken.",
  },
  {
    id: 16,
    name: "brand_hidden_from_customers",
    title: "Brand Hidden From Customers",
    role: "Vendor",
    group: "Brand Status",
    when: "The brand is de-listed from the customer app. The vendor panel still works.",
    body: `👁️ Brand Hidden From Customers
Hello {{1}},
Your brand is temporarily not being shown to customers on Trydood.
🆔 Merchant ID: {{2}}
📅 Hidden On: {{3}}
🔎 Status: Hidden From Customers
📝 Reason: {{4}}
What this means: your brand page, directory listing and showcase are not visible to customers right now.
Your vendor panel still works normally and nothing has been deleted.
Please contact us and we will help you resolve it.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Hidden On", "Date & Time", "08 Sep 2026 03:05 PM"),
      v(
        4,
        "Reason",
        "Long Text",
        "Please contact support for details.",
        "The deactivation reason when the account is also off; otherwise the default shown here.",
      ),
    ],
    buttons: [contact()],
  },
  {
    id: 17,
    name: "brand_visible_to_customers",
    title: "Brand Visible To Customers Again",
    role: "Vendor",
    group: "Brand Status",
    when: "The brand is listed for customers again.",
    body: `🎉 Brand Visible to Customers Again!
Hello {{1}},
Good news — your brand is being shown to customers on Trydood again. ✅
🆔 Merchant ID: {{2}}
📅 Restored On: {{3}}
🔎 Status: Visible to Customers
Your brand page, directory listing and showcase are all live again, exactly as they were.
Nothing was deleted while it was hidden. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Merchant ID", "Reference", "TM-A3F9-K2M7-QX41"),
      v(3, "Restored On", "Date & Time", "09 Sep 2026 10:15 AM"),
    ],
    buttons: [
      btn("Open Dashboard", "Static", `${VENDOR}/dashboard`, null, {
        backend: "PANEL_PATHS.DASHBOARD",
        route: "dashboard",
        status: "Exists",
      }),
    ],
  },

  // ===================== VENDOR · VOUCHER CLAIM =====================
  {
    id: 18,
    name: "vendor_voucher_claim_received",
    title: "New Voucher Claim At Your Outlet",
    role: "Vendor",
    group: "Voucher Claim",
    when: "A customer pays at the vendor's outlet through Trydood.",
    body: `💰 New Voucher Claim at Your Outlet
Hello {{1}},
A customer has just paid at your outlet through Trydood. ✅
🎟️ Voucher: {{2}}
🎁 Offer Applied: {{3}}
🏷️ Promo Code: {{4}}
📍 Store ID: {{5}}
🏠 Address: {{6}}
🧾 Claim Code: {{7}}
📅 Paid On: {{8}}
💰 Bill Amount: ₹{{9}}
💚 You Will Receive: ₹{{10}}
🔎 Status: Payment Successful
This amount will be included in your next settlement.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Voucher Name", "Text", "Luxury Stay Special"),
      v(3, "Offer Applied", "Text", "20% off up to ₹200", "“No offer” when none applied"),
      v(4, "Promo Code", "Text", "MONSOON20", "“—” when none used"),
      v(5, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(6, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(7, "Claim Code", "Reference", "TD-CLM-9001"),
      v(8, "Paid On", "Date & Time", "07 Sep 2026 08:35 PM"),
      v(9, "Bill Amount", "Amount", "1000.00"),
      v(10, "Vendor Payable", "Amount", "700.00"),
    ],
    buttons: [
      btn("View Transaction", "Dynamic", `${VENDOR}/transactions/{{1}}`, "68b1d4f0c27a9e35", {
        backend: "PANEL_PATHS.transaction(id)",
        valueIs: "transactionId",
        route: "transactions/:transactionId — this claim's full detail, not the list",
        status: "NEW — constant does not exist",
      }),
    ],
    note: "This template uses all 10 permitted variables. Nothing can be added without removing something else — the store type shares variable 5 with the Store ID for exactly this reason.",
    atCap: true,
  },

  // ===================== VENDOR · PLAN LIMIT =====================
  {
    id: 19,
    name: "vendor_plan_limit_reached",
    title: "Plan Limit Reached",
    role: "Vendor",
    group: "Plan Limit",
    when: "A vendor hits the cap on outlets, franchises, vouchers or showcase items for their plan.",
    body: `🚦 Plan Limit Reached
Hello {{1}},
You have reached the {{2}} limit on your {{3}} plan.
📊 Used: {{4}} of {{5}}
🚀 On {{6}} you get: {{7}}
Upgrade your plan to keep adding without interruption.
Everything you have already created stays exactly as it is. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Limit Type", "Text", "vouchers", "One of: outlets, franchises, vouchers, showcase items"),
      v(3, "Current Plan", "Text", "Pro Lite"),
      v(4, "Used", "Number", "10"),
      v(5, "Current Limit", "Number", "10"),
      v(6, "Suggested Plan", "Text", "Prime Plus"),
      v(7, "New Limit", "Text", "50 vouchers"),
    ],
    buttons: [
      btn("Upgrade Plan", "Dynamic", `${VENDOR}/subscription/plans/{{1}}`, "64f1a2b7c9e04d38", {
        backend: "PANEL_PATHS.planCheckout(planId)",
        valueIs: "subscriptionId of the suggested plan",
        route: "subscription/plans/:planId — opens that plan ready to buy",
        status: "NEW — constant and route both missing",
      }),
    ],
  },

  // ===================== VENDOR · SETTLEMENT =====================
  {
    id: 20,
    name: "vendor_settlement_paid",
    title: "Payout Sent To Bank",
    role: "Vendor",
    group: "Settlement",
    when: "A vendor's payout has been transferred to their bank.",
    body: `💸 Payout Sent to Your Bank
Hello {{1}},
Your Trydood payout has been sent to your bank account. ✅
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Amount: ₹{{4}}
🏦 Account: {{5}}
🔖 Bank Reference (UTR): {{6}}
📅 Sent On: {{7}}
🔎 Status: Paid
Funds usually reflect within 24 hours depending on your bank.
Thank you for growing with Trydood. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Settlement Number", "Reference", "TD/STL/26-27/000123"),
      v(3, "Settlement Period", "Text", "1 Aug 2026 – 31 Aug 2026", "Uses a dash, never a comma"),
      v(4, "Amount", "Amount", "4523.75"),
      v(5, "Bank Account", "Text", "ending 7890"),
      v(6, "Bank Reference (UTR)", "Reference", "HDFCN52026090412345"),
      v(7, "Sent On", "Date & Time", "05 Sep 2026 02:40 PM"),
    ],
    buttons: [
      doc("Download Statement", "c4d8e0f2a6b19375"),
      btn("View Settlement", "Dynamic", `${VENDOR}/settlements/{{1}}`, "31ac7e05b2f8d649", {
        backend: "PANEL_PATHS.settlement(id)",
        valueIs: "settlementId",
        route: "settlements/:settlementId",
        status: "Exists",
      }),
    ],
    note: "The bank reference is the point of this message — without it, “we paid you” and “we did not pay you” look identical on a bank statement.",
  },
  {
    id: 21,
    name: "vendor_settlement_failed",
    title: "Payout Failed",
    role: "Vendor",
    group: "Settlement",
    when: "The bank returned the payout.",
    body: `⚠️ Payout Could Not Be Completed
Hello {{1}},
Your Trydood payout was returned by the bank.
🧾 Settlement No: {{2}}
💰 Amount: ₹{{3}}
🏦 Account: {{4}}
📝 Reason: {{5}}
📅 Attempted On: {{6}}
🔎 Status: Payout Failed
We are on it. Please check that the account above is still open and the details are correct.
Your money is safe and will be paid once this is resolved. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Settlement Number", "Reference", "TD/STL/26-27/000123"),
      v(3, "Amount", "Amount", "4523.75"),
      v(4, "Bank Account", "Text", "ending 7890"),
      v(5, "Reason", "Text", "Beneficiary account closed"),
      v(6, "Attempted On", "Date & Time", "05 Sep 2026 02:40 PM"),
    ],
    buttons: [
      btn("View Settlement", "Dynamic", `${VENDOR}/settlements/{{1}}`, "31ac7e05b2f8d649", {
        backend: "PANEL_PATHS.settlement(id)",
        valueIs: "settlementId",
        route: "settlements/:settlementId",
        status: "Exists",
      }),
      contact(),
    ],
  },
  {
    id: 22,
    name: "vendor_settlement_on_hold",
    title: "Payout On Hold",
    role: "Vendor",
    group: "Settlement",
    when: "A payout is being reviewed before it goes out.",
    body: `⏸️ Payout On Hold
Hello {{1}},
Your Trydood payout is being reviewed before it goes out.
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Amount: ₹{{4}}
📅 On Hold Since: {{5}}
🔎 Status: On Hold
Nothing is lost. It will either be released or carried into your next payout.
Our team will complete the review shortly. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Settlement Number", "Reference", "TD/STL/26-27/000123"),
      v(3, "Settlement Period", "Text", "1 Aug 2026 – 31 Aug 2026"),
      v(4, "Amount", "Amount", "4523.75"),
      v(5, "On Hold Since", "Date & Time", "05 Sep 2026 09:00 AM"),
    ],
    buttons: [
      btn("View Settlement", "Dynamic", `${VENDOR}/settlements/{{1}}`, "31ac7e05b2f8d649", {
        backend: "PANEL_PATHS.settlement(id)",
        valueIs: "settlementId",
        route: "settlements/:settlementId",
        status: "Exists",
      }),
    ],
    note: "There is deliberately no “what is being checked” variable, and no Contact Support button. It is usually a disputed payment, and inviting the conversation turns a two-day delay into an argument about something nobody has ruled on yet.",
  },
  {
    id: 23,
    name: "vendor_settlement_carried_forward",
    title: "No Payout This Cycle",
    role: "Vendor",
    group: "Settlement",
    when: "Deductions came to more than the period's sales, so there is nothing to pay out.",
    body: `📋 No Payout This Cycle
Hello {{1}},
There is no payout for this settlement period.
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Sales This Period: ₹{{4}}
↩️ Refunds Deducted: ₹{{5}}
⚖️ Chargebacks Deducted: ₹{{6}}
🔎 Status: Carried Forward
Your deductions came to more than this period's sales, so there is nothing to pay out.
The remaining balance carries into your next settlement and comes off future sales.
There is nothing to pay us and nothing you need to do. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Settlement Number", "Reference", "TD/STL/26-27/000123"),
      v(3, "Settlement Period", "Text", "1 Aug 2026 – 31 Aug 2026"),
      v(4, "Sales This Period", "Amount", "3200.00"),
      v(5, "Refunds Deducted", "Amount", "2450.00"),
      v(6, "Chargebacks Deducted", "Amount", "1200.00"),
    ],
    buttons: [
      btn("View Statement", "Dynamic", `${VENDOR}/settlements/{{1}}`, "31ac7e05b2f8d649", {
        backend: "PANEL_PATHS.settlement(id)",
        valueIs: "settlementId",
        route: "settlements/:settlementId",
        status: "Exists",
      }),
    ],
    note: "“There is nothing to pay us” must stay — the reading people jump to is that they now owe money.",
  },

  // ===================== VENDOR · REFUND =====================
  {
    id: 24,
    name: "vendor_refund_requested",
    title: "Refund Requested",
    role: "Vendor",
    group: "Refund",
    when: "A customer asks for a refund on a claim at the vendor's outlet.",
    body: `↩️ Refund Requested
Hello {{1}},
A customer has requested a refund on a claim at your outlet.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Amount Requested: ₹{{6}}
📝 Customer's Reason: {{7}}
📅 Requested On: {{8}}
⏳ Please Respond By: {{9}}
🔎 Status: Awaiting Your Response
If nobody responds by then, the decision passes to the Trydood team.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Voucher Name", "Text", "Luxury Stay Special"),
      v(3, "Claim Code", "Reference", "TD-CLM-9001"),
      v(4, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(5, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(6, "Amount Requested", "Amount", "810.00"),
      v(
        7,
        "Customer's Reason",
        "Long Text",
        "Outlet was closed when I reached.",
        "Written by the customer. Up to 150 characters.",
      ),
      v(8, "Requested On", "Date & Time", "08 Sep 2026 07:15 PM"),
      v(9, "Respond By", "Date & Time", "09 Sep 2026 09:30 PM"),
    ],
    buttons: [
      btn("Review Refund", "Dynamic", `${VENDOR}/refunds/{{1}}`, "66df1b8e0a94c273", {
        backend: "PANEL_PATHS.refund(id)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId — this request, opened ready to decide",
        status: "NEW — constant does not exist",
      }),
    ],
    note: "Both timestamps are shown together on purpose. A deadline with no start is just pressure; the pair lets the vendor see how long they actually have.",
  },
  {
    id: 25,
    name: "vendor_refund_reminder",
    title: "Refund Still Awaiting Response",
    role: "Vendor",
    group: "Refund",
    when: "A reminder while a refund request is still undecided.",
    body: `⏳ Refund Still Waiting on You
Hello {{1}},
A refund request at your outlet is still waiting for your decision.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
💰 Amount: ₹{{5}}
⏳ Respond By: {{6}}
⌛ Time Left: {{7}}
🔎 Status: Awaiting Your Response
If nobody responds by then, the decision passes to the Trydood team.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Voucher Name", "Text", "Luxury Stay Special"),
      v(3, "Claim Code", "Reference", "TD-CLM-9001"),
      v(4, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(5, "Amount", "Amount", "810.00"),
      v(6, "Respond By", "Date & Time", "09 Sep 2026 09:30 PM"),
      v(7, "Time Left", "Text", "4 hours"),
    ],
    buttons: [
      btn("Review Refund", "Dynamic", `${VENDOR}/refunds/{{1}}`, "66df1b8e0a94c273", {
        backend: "PANEL_PATHS.refund(id)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "NEW — constant does not exist",
      }),
    ],
  },
  {
    id: 26,
    name: "vendor_refund_completed",
    title: "Refund Completed",
    role: "Vendor",
    group: "Refund",
    when: "A refund has been paid to the customer and the vendor's share is being recovered.",
    body: `↩️ Refund Completed
Hello {{1}},
A refund on one of your sales has been completed.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Refunded to Customer: ₹{{6}}
📉 Deducted From Your Payout: ₹{{7}}
♻️ Commission Returned to You: ₹{{8}}
📅 Completed On: {{9}}
🔎 Status: Refund Completed
Only your share of the sale is deducted — the commission we charged on it is returned to you.
This will appear on your next settlement statement.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Voucher Name", "Text", "Luxury Stay Special"),
      v(3, "Claim Code", "Reference", "TD-CLM-9001"),
      v(4, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(5, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(6, "Refunded To Customer", "Amount", "810.00"),
      v(7, "Deducted From Payout", "Amount", "700.00"),
      v(8, "Commission Returned", "Amount", "110.00"),
      v(9, "Completed On", "Date & Time", "10 Sep 2026 01:05 PM"),
    ],
    buttons: [
      btn("View Refund", "Dynamic", `${VENDOR}/refunds/{{1}}`, "66df1b8e0a94c273", {
        backend: "PANEL_PATHS.refund(id)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "NEW — constant does not exist",
      }),
    ],
    note: "Variables 6, 7 and 8 must add up on screen — 810 = 700 + 110. That is the whole reason this template exists: it stops the “why 700 and not 810?” question.",
  },

  // ===================== VENDOR · DISPUTE =====================
  {
    id: 27,
    name: "vendor_dispute_raised",
    title: "Chargeback Raised",
    role: "Vendor",
    group: "Dispute",
    when: "A customer's bank pulls back a payment on one of the vendor's sales.",
    body: `⚖️ Chargeback Raised on Your Sale
Hello {{1}},
A customer's bank has pulled back a payment on one of your sales.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Amount: ₹{{6}}
📝 Reason: {{7}}
⏳ We Must Respond By: {{8}}
🔎 Status: Under Dispute
This payment is held out of your payouts until it is settled — it is not lost.
We are contesting it with the payment and redemption records we hold.
If you have anything from that visit — a bill or KOT number, a camera timestamp, what the staff remember — adding it helps.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Voucher Name", "Text", "Luxury Stay Special"),
      v(3, "Claim Code", "Reference", "TD-CLM-9001"),
      v(4, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(5, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(6, "Amount", "Amount", "810.00"),
      v(7, "Dispute Reason", "Text", "Product not received", "Up to 120 characters."),
      v(8, "Respond By", "Date & Time", "13 Sep 2026 11:59 PM"),
    ],
    buttons: [
      btn("Open Dispute", "Dynamic", `${VENDOR}/disputes/{{1}}`, "5b8e02a7c1f3d940", {
        backend: "PANEL_PATHS.dispute(id)",
        valueIs: "disputeId",
        route: "disputes/:disputeId — where the vendor adds their evidence",
        status: "Exists",
      }),
    ],
    note: "The wording invites evidence rather than demanding it. Filing never waits on the outlet, so telling them a reply is required would be untrue.",
  },
  {
    id: 28,
    name: "vendor_dispute_resolved_won",
    title: "Chargeback Decided In Vendor's Favour",
    role: "Vendor",
    group: "Dispute",
    when: "The bank rules in Trydood's favour. The held money is released.",
    body: `✅ Chargeback Decided in Your Favour
Hello {{1}},
Good news! The bank has ruled in our favour on a disputed sale.
🧾 Claim Code: {{2}}
📍 Store ID: {{3}}
💰 Amount: ₹{{4}}
📅 Resolved On: {{5}}
🔎 Status: Decided in Your Favour
The money stays yours. The payment is being released back into your payouts — you will see it in an upcoming settlement.
Thank you for your patience. 💚
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Claim Code", "Reference", "TD-CLM-9001"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Amount", "Amount", "810.00"),
      v(5, "Resolved On", "Date & Time", "07 Sep 2026 03:22 PM"),
    ],
    buttons: [
      btn("Open Dispute", "Dynamic", `${VENDOR}/disputes/{{1}}`, "5b8e02a7c1f3d940", {
        backend: "PANEL_PATHS.dispute(id)",
        valueIs: "disputeId",
        route: "disputes/:disputeId",
        status: "Exists",
      }),
    ],
    note: "It says “an upcoming settlement”, not a date. Releasing the hold is a separate manual step, and promising a day we then miss is worse than saying nothing.",
  },
  {
    id: 29,
    name: "vendor_dispute_resolved_lost",
    title: "Chargeback Upheld",
    role: "Vendor",
    group: "Dispute",
    when: "The bank rules for the customer. The vendor's share is recovered from a future payout.",
    body: `⚖️ Chargeback Upheld
Hello {{1}},
The bank has ruled for the customer on a disputed sale.
🧾 Claim Code: {{2}}
📍 Store ID: {{3}}
💰 Amount: ₹{{4}}
📄 Advice No: {{5}}
📅 Resolved On: {{6}}
🔎 Status: Upheld for the Customer
Your share of that sale will be deducted from an upcoming payout, shown on your statement as "chargebacks recovered".
Only your share is deducted — our fee and our part of any promotion are not.
${SIGN_VENDOR}`,
    vars: [
      v(1, "Brand Name", "Text", "Cafe Mocha"),
      v(2, "Claim Code", "Reference", "TD-CLM-9001"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Amount", "Amount", "810.00"),
      v(5, "Advice Number", "Reference", "TD/DBN/26-27/000004"),
      v(6, "Resolved On", "Date & Time", "07 Sep 2026 03:22 PM"),
    ],
    buttons: [
      doc("Download Advice", "e1f5a9c37b204d68"),
      btn("Open Dispute", "Dynamic", `${VENDOR}/disputes/{{1}}`, "5b8e02a7c1f3d940", {
        backend: "PANEL_PATHS.dispute(id)",
        valueIs: "disputeId",
        route: "disputes/:disputeId",
        status: "Exists",
      }),
    ],
    note: "This is the message that stops a deduction appearing from nowhere on a statement.",
  },

  // ===================== CUSTOMER =====================
  {
    id: 30,
    name: "customer_payment_success",
    title: "Payment Successful",
    role: "Customer",
    group: "Payment",
    when: "A customer's payment at an outlet goes through. This is their receipt.",
    body: `✅ Payment Successful
Hello {{1}},
Your payment went through. 🎉
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🏠 Address: {{4}}
🎟️ Voucher: {{5}}
🧾 Claim Code: {{6}}
📅 Paid On: {{7}}
💰 Bill Amount: ₹{{8}}
💚 You Saved: ₹{{9}}
💳 Amount Paid: ₹{{10}}
🔎 Status: Payment Successful
Show your claim code at the counter if asked.
Your receipt is available below — keep it for your records.
${SIGN_GOOD}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(5, "Voucher Name", "Text", "Luxury Stay Special"),
      v(6, "Claim Code", "Reference", "TD-CLM-9001"),
      v(7, "Paid On", "Date & Time", "07 Sep 2026 08:35 PM"),
      v(8, "Bill Amount", "Amount", "1000.00"),
      v(9, "You Saved", "Amount", "190.00"),
      v(10, "Amount Paid", "Amount", "810.00"),
    ],
    buttons: [
      doc("Download Receipt", "f2a7b4c81d3e5069"),
      btn("View Order", "Dynamic", `${APP}/orders/{{1}}`, "7c02e4b98a1d6350", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.order(claimId)",
        valueIs: "claimId",
        route: "orders/:claimId — this order, not the list",
        status: "Exists",
      }),
    ],
    note: "Uses all 10 permitted variables. Variables 8 minus 9 must equal 10 — the arithmetic is visible to the customer, so it has to hold.",
    atCap: true,
  },
  {
    id: 31,
    name: "customer_payment_failed",
    title: "Payment Failed",
    role: "Customer",
    group: "Payment",
    when: "A customer's payment does not go through.",
    body: `⚠️ Payment Could Not Be Completed
Hello {{1}},
Your payment did not go through.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🏠 Address: {{4}}
🎟️ Voucher: {{5}}
💰 Amount: ₹{{6}}
📅 Attempted On: {{7}}
🔎 Status: Payment Failed
🔒 Nothing has been charged to your account.
If money was deducted, your bank will return it automatically within 5–7 working days.
You can try again from the app.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Outlet Address", "Long Text", "Shop 4 Vijay Nagar Indore MP 452010"),
      v(5, "Voucher Name", "Text", "Luxury Stay Special"),
      v(6, "Amount", "Amount", "810.00"),
      v(7, "Attempted On", "Date & Time", "07 Sep 2026 08:35 PM"),
    ],
    buttons: [
      btn("Try Again", "Dynamic", `${APP}/vouchers/{{1}}`, "68b1d4f0c27a9e35", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.voucher(voucherId)",
        valueIs: "voucherId",
        route: "vouchers/:voucherId — reopens the same voucher ready to pay",
        status: "Exists",
      }),
    ],
    note: "“Nothing has been charged” is the whole message. No Contact Support button here — “Try Again” is the action, and offering support instead sends people down a slower path than the one that works.",
  },
  {
    id: 32,
    name: "customer_refund_requested",
    title: "Refund Request Received",
    role: "Customer",
    group: "Refund",
    when: "A customer raises a refund request and we acknowledge it.",
    body: `↩️ We Have Your Refund Request
Hello {{1}},
We have received your refund request and asked the outlet about it.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount: ₹{{6}}
📅 Requested On: {{7}}
🔎 Status: {{8}}
We will let you know as soon as there is an answer.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Amount", "Amount", "810.00"),
      v(7, "Requested On", "Date & Time", "08 Sep 2026 07:15 PM"),
      v(
        8,
        "Status",
        "Status",
        "Refund requested",
        "One of: Refund requested, Under review by Trydood, Awaiting outlet response",
      ),
    ],
    buttons: [
      btn("Track Refund", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
    ],
    note: "This is the one customer template where status is a variable — a refund genuinely passes through several states the customer should see.",
  },
  {
    id: 33,
    name: "customer_refund_approved",
    title: "Refund Approved",
    role: "Customer",
    group: "Refund",
    when: "A refund is approved. The money has not moved yet.",
    body: `✅ Your Refund Is Approved
Hello {{1}},
Good news — your refund has been approved.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Requested: ₹{{6}}
💚 Amount Approved: ₹{{7}}
🏦 Refund Method: {{8}}
📅 Approved On: {{9}}
🔎 Status: Approved
It should reach your account in 5–7 working days.
We will message you again once it has been sent.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Amount Requested", "Amount", "810.00"),
      v(7, "Amount Approved", "Amount", "400.00"),
      v(
        8,
        "Refund Method",
        "Text",
        "Back to your original payment method",
        "Either that, or “To your bank account”",
      ),
      v(9, "Approved On", "Date & Time", "09 Sep 2026 11:40 AM"),
    ],
    buttons: [
      btn("Track Refund", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
    ],
    note: "Both amounts are always shown. A customer who asked for 810 and quietly receives 400 opens a second request and a support ticket.",
  },
  {
    id: 34,
    name: "customer_refund_rejected",
    title: "Refund Not Approved",
    role: "Customer",
    group: "Refund",
    when: "A refund request is declined.",
    body: `📋 About Your Refund Request
Hello {{1}},
Your refund request was not approved.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Requested: ₹{{6}}
📅 Decided On: {{7}}
🔎 Status: Not Approved
📝 Reason: {{8}}
If you think that is wrong, write to us and we will look at it ourselves.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Amount Requested", "Amount", "810.00"),
      v(7, "Decided On", "Date & Time", "09 Sep 2026 11:40 AM"),
      v(
        8,
        "Reason",
        "Status",
        "The service was provided as described",
        "Chosen by the admin from a fixed list. One of: The service was provided as described / The request was made after the refund window closed / The outlet confirmed the order was collected / The claim was already refunded earlier / We could not verify the issue with the outlet",
      ),
    ],
    buttons: [
      btn("View Refund", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
      contact(),
    ],
    note: "Variable 8 comes from a fixed list the admin picks from — never from whatever the vendor or admin typed internally. A note written between staff, shown to the customer it is about, reads as an accusation.",
  },
  {
    id: 35,
    name: "customer_refund_completed",
    title: "Refund Sent",
    role: "Customer",
    group: "Refund",
    when: "The refund has actually left and is on its way to the customer's account.",
    body: `💚 Your Refund Has Been Sent
Hello {{1}},
Your refund has been processed and sent to your account. ✅
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Refunded: ₹{{6}}
📄 Refund No: {{7}}
🔖 Bank Reference: {{8}}
📅 Sent On: {{9}}
🔎 Status: Refund Completed
It should reflect in your account within 5–7 working days depending on your bank.
Quote the bank reference above if you need to check with them.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Amount Refunded", "Amount", "810.00"),
      v(7, "Refund Number", "Reference", "TD/REF/26-27/000012"),
      v(8, "Bank Reference", "Reference", "HDFCR52026090498765"),
      v(9, "Sent On", "Date & Time", "10 Sep 2026 01:05 PM"),
    ],
    buttons: [
      doc("Download Receipt", "a9c3e7f15b8d0264"),
      btn("View Refund", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
    ],
    note: "The bank reference is what a customer quotes to their own bank when the money has not appeared. This template is the only place they get it.",
  },
  {
    id: 36,
    name: "customer_refund_bank_details",
    title: "Bank Details Needed For Refund",
    role: "Customer",
    group: "Refund",
    when: "The refund could not go back the way the customer paid, so we need their bank account.",
    body: `🏦 We Need Your Bank Account to Send Your Refund
Hello {{1}},
Your refund could not be sent back the way you paid.
🏪 Brand: {{2}}
🎟️ Voucher: {{3}}
🧾 Claim Code: {{4}}
💰 Amount: ₹{{5}}
📝 Reason: {{6}}
📅 Requested On: {{7}}
🔎 Status: Waiting for Your Bank Details
💚 The money is still yours.
Please open the Trydood app and add your bank account, and we will transfer it.
🔒 We will never ask you for your bank details over a call, a message or a link.
Add them only inside the Trydood app.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Voucher Name", "Text", "Luxury Stay Special"),
      v(4, "Claim Code", "Reference", "TD-CLM-9001"),
      v(5, "Amount", "Amount", "810.00"),
      v(
        6,
        "Reason",
        "Text",
        "the original card is no longer reachable",
        "Up to 120 characters.",
      ),
      v(7, "Requested On", "Date & Time", "10 Sep 2026 09:00 AM"),
    ],
    buttons: [
      btn("Add Bank Account", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route:
          "refunds/:refundRequestId → the add-bank-account screen. App installed and signed in: straight there. Signed out: login, then there. Not installed: the store.",
        status: "Exists — app link behaviour to confirm",
      }),
      contact(),
    ],
    note: "TREAT THIS ONE CAREFULLY. It is the only customer message that asks them to act, and it asks for exactly what a scam message asks for. Four things must survive any edit: it names their claim, voucher and brand; it says the money is still theirs; it gives the reason; and it says we never ask over a call, message or link. There is no Store ID here on purpose — a raw code reads like machine-generated spam. The Contact Support button makes it safer, not riskier: a suspicious customer can check with us through our own website instead of replying to the message.",
  },
  {
    id: 37,
    name: "customer_voucher_refunded",
    title: "Refund Issued",
    role: "Customer",
    group: "Refund",
    when: "A refund issued outside the request flow — an admin refund, or a cancelled claim.",
    body: `↩️ Refund Issued
Hello {{1}},
A refund has been issued for your claim.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Refunded: ₹{{6}}
📄 Refund No: {{7}}
📅 Issued On: {{8}}
🔎 Status: Refund Issued
It usually reaches your account in 5–7 working days.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Amount Refunded", "Amount", "810.00"),
      v(7, "Refund Number", "Reference", "TD/REF/26-27/000012"),
      v(8, "Issued On", "Date & Time", "10 Sep 2026 01:05 PM"),
    ],
    buttons: [
      doc("Download Receipt", "d6b0f28ac41e7539"),
      btn("View Refund", "Dynamic", `${APP}/refunds/{{1}}`, "a9c3e7f15b8d0264", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
    ],
  },
  {
    id: 38,
    name: "customer_claim_expired",
    title: "Claim Expired",
    role: "Customer",
    group: "Payment",
    when: "A claim was not redeemed within its window.",
    body: `⌛ Your Claim Has Expired
Hello {{1}},
Your claim was not redeemed within its window.
🏪 Brand: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
📅 Expired On: {{6}}
🔎 Status: Expired
If you believe this is a mistake, please contact our support team and we will look into it.
${SIGN_SORRY}`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Store ID and Type", "Reference", "TS-A3F9-K2M7-QX41 · Franchise"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Claim Code", "Reference", "TD-CLM-9001"),
      v(6, "Expired On", "Date & Time", "09 Sep 2026 08:35 PM"),
    ],
    buttons: [
      btn("View Order", "Dynamic", `${APP}/orders/{{1}}`, "7c02e4b98a1d6350", {
        owner: "Customer app",
        backend: "CUSTOMER_PATHS.order(claimId)",
        valueIs: "claimId",
        route: "orders/:claimId",
        status: "Exists",
      }),
      contact(),
    ],
    hold: "Create this template last. The feature it belongs to is not live yet, so nothing sends it today.",
  },

  // ===================== ADMIN =====================
  {
    id: 39,
    name: "admin_refund_failed",
    title: "Refund Failed",
    role: "Admin",
    group: "Alerts",
    when: "A customer refund could not be completed and someone has to act.",
    body: `🔴 Refund Failed
A customer refund could not be completed and needs attention.
👤 Customer: {{1}}
🏪 Brand: {{2}}
🧾 Claim Code: {{3}}
🎟️ Voucher: {{4}}
💰 Amount: ₹{{5}}
🏦 Method: {{6}}
📝 Reason: {{7}}
🔁 Attempt: {{8}}
📅 Failed On: {{9}}
The customer has been told their money is coming. Only a retry or a bank transfer will fix this.
Trydood – Grow Your Business Faster 🚀`,
    vars: [
      v(1, "Customer Name", "Text", "Priya"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Claim Code", "Reference", "TD-CLM-9001"),
      v(4, "Voucher Name", "Text", "Luxury Stay Special"),
      v(5, "Amount", "Amount", "810.00"),
      v(6, "Refund Method", "Text", "Back to source"),
      v(7, "Reason", "Text", "instrument does not accept refunds", "Up to 120 characters."),
      v(8, "Attempt Number", "Number", "3"),
      v(9, "Failed On", "Date & Time", "10 Sep 2026 01:05 PM"),
    ],
    buttons: [
      btn("Open Refund", "Dynamic", `${ADMIN}/refunds/{{1}}`, "66df1b8e0a94c273", {
        owner: "Admin panel",
        backend: "ADMIN_PATHS.refund(requestId)",
        valueIs: "refundRequestId",
        route: "refunds/:refundRequestId",
        status: "Exists",
      }),
    ],
  },
  {
    id: 40,
    name: "admin_settlement_ledger_drift",
    title: "Ledger Drift On A Payout",
    role: "Admin",
    group: "Alerts",
    when: "The payout records and the ledger disagree about money that has already moved.",
    body: `🔴 Ledger Drift on a Payout
The payout legs and the ledger disagree about money that has physically moved.
🧾 Settlement: {{1}}
🏪 Brand: {{2}}
💸 Legs Paid: ₹{{3}}
📒 Ledger Booked: ₹{{4}}
⚠️ Gap: ₹{{5}}
📅 Detected On: {{6}}
One of the two is wrong about a transfer that has already happened.
Trydood – Grow Your Business Faster 🚀`,
    vars: [
      v(1, "Settlement Number", "Reference", "TD/STL/26-27/000123"),
      v(2, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(3, "Legs Paid", "Amount", "4523.75"),
      v(4, "Ledger Booked", "Amount", "4000.00"),
      v(5, "Gap", "Amount", "523.75"),
      v(6, "Detected On", "Date & Time", "10 Sep 2026 02:00 AM"),
    ],
    buttons: [
      btn("Open Settlement", "Dynamic", `${ADMIN}/settlements/{{1}}`, "31ac7e05b2f8d649", {
        owner: "Admin panel",
        backend: "ADMIN_PATHS.settlement(settlementId)",
        valueIs: "settlementId",
        route: "settlements/:settlementId",
        status: "Exists",
      }),
    ],
  },
  {
    id: 41,
    name: "admin_payment_disputed",
    title: "Chargeback Raised",
    role: "Admin",
    group: "Alerts",
    when: "A customer's bank pulls back a payment. There is a response deadline.",
    body: `🔴 Chargeback Raised
A customer's bank has pulled back a payment. There is a response deadline.
🏪 Brand: {{1}}
🧾 Claim Code: {{2}}
💰 Amount: ₹{{3}}
📝 Reason: {{4}}
⚖️ Phase: {{5}}
📅 Raised On: {{6}}
⏳ Respond By: {{7}}
🔢 Disputes on This Payment: {{8}}
Missing the deadline forfeits the money. Nothing will chase this but us.
Trydood – Grow Your Business Faster 🚀`,
    vars: [
      v(1, "Brand and Merchant ID", "Text", "Cafe Mocha (TM-A3F9-K2M7-QX41)"),
      v(2, "Claim Code", "Reference", "TD-CLM-9001"),
      v(3, "Amount", "Amount", "810.00"),
      v(4, "Dispute Reason", "Text", "product_not_received"),
      v(5, "Dispute Phase", "Text", "Chargeback", "Tells a first chargeback from an escalation"),
      v(6, "Raised On", "Date & Time", "10 Sep 2026 04:30 PM"),
      v(7, "Respond By", "Date & Time", "13 Sep 2026 11:59 PM"),
      v(8, "Dispute Count", "Number", "1"),
    ],
    buttons: [
      btn("Open Dispute", "Dynamic", `${ADMIN}/disputes/{{1}}`, "5b8e02a7c1f3d940", {
        owner: "Admin panel",
        backend: "ADMIN_PATHS.dispute(transactionId)",
        valueIs: "transactionId — the admin worklist is keyed on the payment",
        route: "disputes/:transactionId",
        status: "Exists",
      }),
    ],
  },
  {
    id: 42,
    name: "admin_dispute_deadline",
    title: "Dispute Deadline Approaching",
    role: "Admin",
    group: "Alerts",
    when: "A dispute response is due and the money is forfeited if the deadline passes.",
    body: `🔴 Dispute Deadline Approaching
A dispute response is due and the money is forfeited if it passes.
🧾 Claim Code: {{1}}
💳 Payment: {{2}}
💰 Amount: ₹{{3}}
🔎 Status: {{4}}
⏳ Respond By: {{5}}
⌛ Time Left: {{6}}
An unanswered dispute is lost by default. The bank does not ask twice.
Trydood – Grow Your Business Faster 🚀`,
    vars: [
      v(1, "Claim Code", "Reference", "TD-CLM-9001"),
      v(2, "Payment ID", "Reference", "pay_QxTest0000001"),
      v(3, "Amount", "Amount", "810.00"),
      v(4, "Dispute Status", "Status", "Under review"),
      v(5, "Respond By", "Date & Time", "13 Sep 2026 11:59 PM"),
      v(6, "Time Left", "Text", "19 hours"),
    ],
    buttons: [
      btn("Open Dispute", "Dynamic", `${ADMIN}/disputes/{{1}}`, "5b8e02a7c1f3d940", {
        owner: "Admin panel",
        backend: "ADMIN_PATHS.dispute(transactionId)",
        valueIs: "transactionId",
        route: "disputes/:transactionId",
        status: "Exists",
      }),
    ],
  },
];

// ---------------------------------------------------------------------------
// Checks worth failing the build over — a wrong brief costs a rebuilt template,
// and a template cannot be edited once Meta approves it.
// ---------------------------------------------------------------------------

const problems = [];
for (const t of TEMPLATES) {
  const used = new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
  const declared = new Set(t.vars.map((x) => x.n));
  const max = used.size ? Math.max(...used) : 0;

  if (max !== t.vars.length) {
    problems.push(
      `#${t.id} ${t.name}: body goes up to {{${max}}} but ${t.vars.length} variables are listed`,
    );
  }
  for (const n of used) {
    if (!declared.has(n)) problems.push(`#${t.id} ${t.name}: {{${n}}} used but not listed`);
  }
  for (const n of declared) {
    if (!used.has(n)) problems.push(`#${t.id} ${t.name}: variable ${n} listed but never used`);
  }
  if (max > 10) problems.push(`#${t.id} ${t.name}: ${max} variables — over the limit of 10`);
  if (!t.buttons.length) problems.push(`#${t.id} ${t.name}: no buttons`);

  for (const b of t.buttons) {
    if (b.text.length > 25) {
      problems.push(`#${t.id} ${t.name}: button "${b.text}" is ${b.text.length} chars (max 25)`);
    }
    // A dynamic button must carry its variable, and a static one must not.
    const hasVar = b.url.includes("{{1}}");
    if (b.urlType === "Dynamic" && !hasVar) {
      problems.push(`#${t.id} ${t.name}: "${b.text}" is Dynamic but its URL has no {{1}}`);
    }
    if (b.urlType === "Static" && hasVar) {
      problems.push(`#${t.id} ${t.name}: "${b.text}" is Static but its URL contains {{1}}`);
    }
    if (b.text === "Contact Support" && b.url !== CONTACT) {
      problems.push(`#${t.id} ${t.name}: Contact Support points at ${b.url}, not ${CONTACT}`);
    }
  }
}
if (problems.length) {
  console.error("Refusing to build — the documents would be wrong:\n");
  problems.forEach((p) => console.error("  " + p));
  process.exit(1);
}

const ROLE_ORDER = ["Vendor", "Customer", "Admin"];
const ROLE_BLURB = {
  Vendor:
    "Sent to the business — the brand owner or outlet operator. Every one greets them by their brand name.",
  Customer: "Sent to the person who paid. Plain language, no internal codes beyond what they need.",
  Admin: "Sent to the Trydood operations team. These are alerts, not customer-facing copy.",
};

/** Two buttons still need one provider setting confirmed; #19 and #38 wait on us. */
const WAIT_IDS = new Set(
  TEMPLATES.filter((t) => t.buttons.length > 1 || t.hold || t.id === 19).map((t) => t.id),
);
const READY = TEMPLATES.filter((t) => !WAIT_IDS.has(t.id));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const bodyHtml = (text) =>
  esc(text)
    .split("\n")
    .map((line) => (line.trim() === "" ? "<br/>" : `${line}<br/>`))
    .join("\n");

const now = new Date();
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const stamp = `${String(now.getDate()).padStart(2, "0")} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
const counts = ROLE_ORDER.map(
  (r) => `${r}: ${TEMPLATES.filter((t) => t.role === r).length}`,
).join(" · ");

const CSS = `
@page { size: A4; margin: 2cm 1.8cm; }
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.45; }
h1 { font-size: 26pt; color: #0b6b3a; margin: 0 0 4pt 0; }
h2 { font-size: 17pt; color: #0b6b3a; border-bottom: 2px solid #0b6b3a; padding-bottom: 3pt; margin: 24pt 0 10pt 0; }
h3 { font-size: 13pt; color: #14532d; margin: 20pt 0 6pt 0; }
h4 { font-size: 11pt; color: #1a1a1a; margin: 12pt 0 4pt 0; }
p { margin: 0 0 7pt 0; }
a { color: #0b6b3a; }
.sub { font-size: 12pt; color: #555; margin-bottom: 2pt; }
.meta { font-size: 9.5pt; color: #777; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt 0; }
th { background: #0b6b3a; color: #fff; font-size: 9.5pt; text-align: left; padding: 5pt 6pt; border: 0.5pt solid #0b6b3a; }
td { font-size: 9.5pt; padding: 5pt 6pt; border: 0.5pt solid #c8c8c8; vertical-align: top; }
tr.alt td { background: #f4f8f5; }
.num { width: 26pt; text-align: center; font-weight: bold; }
.msg { border: 1pt solid #b8d8c4; background: #f7fcf9; padding: 9pt 11pt; margin: 4pt 0 10pt 0;
       font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; line-height: 1.5; }
.tmpl { border-left: 3pt solid #0b6b3a; padding-left: 10pt; margin: 0 0 22pt 0; page-break-inside: avoid; }
.hdr { background: #eaf4ee; padding: 6pt 9pt; margin-bottom: 8pt; }
.tname { font-family: Consolas, "Courier New", monospace; font-size: 12pt; font-weight: bold; color: #0b6b3a; }
.facts { font-size: 9.5pt; color: #444; margin-top: 2pt; }
.note { border-left: 3pt solid #c99a06; background: #fffbea; padding: 7pt 10pt; margin: 4pt 0 10pt 0; font-size: 9.5pt; }
.hold { border-left: 3pt solid #b91c1c; background: #fef4f4; padding: 7pt 10pt; margin: 4pt 0 10pt 0; font-size: 9.5pt; }
.cap { display: inline-block; background: #b91c1c; color: #fff; font-size: 8pt; padding: 1pt 5pt; margin-left: 4pt; }
.new { display: inline-block; background: #b45309; color: #fff; font-size: 8pt; padding: 1pt 5pt; }
.ok { color: #0b6b3a; font-weight: bold; }
.brk { page-break-before: always; }
code { font-family: Consolas, "Courier New", monospace; background: #f0f0f0; padding: 0 2pt; }
.lead { font-size: 11pt; }
.back { font-size: 9pt; }
`;

const page = (title, inner) => `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>${CSS}</style>
</head>
<body>
${inner}
</body></html>
`;

// ===========================================================================
// DOCUMENT 1 — the content brief
// ===========================================================================

const TYPE_GLOSSARY = [
  ["Text", "A short word or phrase.", "Cafe Mocha"],
  ["Long Text", "A sentence. Some have a character limit — it is noted on the variable.", "Shop 4 Vijay Nagar Indore"],
  ["Number", "A plain whole number.", "7"],
  ["Amount", "Rupees with two decimals. The ₹ sign is already in the message text — never include it in the sample.", "1999.00"],
  ["Date", "Day, short month, year.", "29 Aug 2026"],
  ["Date & Time", "The same, plus a 12-hour time. Always Indian Standard Time.", "07 Sep 2026 08:35 PM"],
  ["Reference", "An ID or code that people quote to support.", "TD-CLM-9001"],
  ["Status", "One value from a fixed list. The list is given on the variable.", "Under review"],
];

const RULES = [
  ["Category", "<b>Utility</b> for every template. Not Marketing — these are transactional messages, and Marketing would be blocked for anyone who opted out of promotions."],
  ["Language", "<b>English (en)</b>. One language for now."],
  ["Variable limit", "<b>10 variables maximum</b> in the message body. Two templates use all ten (#18 and #30) — they are marked, and nothing can be added to them."],
  ["Button variables are numbered separately", "A button's URL variable is always <b>{{1}}</b>, even when the message body already has ten variables. Each button has its own numbering and its own sample box. This is the step people get wrong most often."],
  ["No commas in any sample value", "Commas are stripped in transit. Write <b>1999.00</b>, not 1,999.00. Addresses are written with spaces, not commas."],
  ["Button text", "<b>25 characters maximum.</b> Every label in this document is already within it."],
  ["Rupee sign", "Already written into the message text. A sample value of <b>₹1999.00</b> would render as ₹₹1999.00."],
  ["Do not reorder anything", "Variable numbers are positional. Moving a line without moving its number sends the wrong value into the wrong place, and nothing warns you."],
  ["Sample values are required", "Fill the sample for every variable and every dynamic button, using the values in this document."],
  ["The email address needs no link", "WhatsApp makes <code>helpdesk@trydood.com</code> tappable by itself in the message text. A template body is plain text and cannot carry a link, and Meta does not allow a <code>mailto:</code> button — so the Contact Support button is the clickable route."],
];

const FIELDS = [
  ["🏪 Brand", "The business, with its Merchant ID in brackets", "<code>Cafe Mocha (TM-A3F9-K2M7-QX41)</code>", "Customer, Admin"],
  ["🆔 Merchant ID", "The same ID on its own row", "<code>TM-A3F9-K2M7-QX41</code>", "Vendor (the brand name is already the greeting)"],
  ["📍 Store ID", "The outlet, with its type", "<code>TS-A3F9-K2M7-QX41 · Franchise</code>", "All three"],
  ["🏠 Address", "The outlet's address, spaces not commas", "<code>Shop 4 Vijay Nagar Indore MP 452010</code>", "All three"],
  ["🎟️ Voucher", "The voucher's name", "<code>Luxury Stay Special</code>", "All three"],
  ["🧾 Claim Code", "The claim reference", "<code>TD-CLM-9001</code>", "All three"],
  ["📅 &lt;Event&gt; On", "Date and time, always IST", "<code>07 Sep 2026 08:35 PM</code>", "All three"],
  ["🔎 Status", "Fixed text unless the value genuinely varies", "<code>Payment Successful</code>", "All three"],
];

let brief = `
<h1>Trydood WhatsApp Templates</h1>
<p class="sub">Content brief for template creation</p>
<p class="meta">${TEMPLATES.length} templates &nbsp;·&nbsp; ${counts} &nbsp;·&nbsp; Prepared ${stamp}</p>

<h2>What this document is</h2>
<p class="lead">Every WhatsApp message Trydood sends, written out exactly as it should be created in the
WhatsApp template panel. For each template you get the message text, a numbered list of its variables
with a sample value for each, and the buttons with their URLs.</p>
<p><b>Copy the message text exactly</b> — the wording, the emojis and the line breaks are all deliberate.
Where a line looks oddly specific, it is usually there to stop a support ticket, and the reason is noted
underneath.</p>
<p class="meta">In the full list below, click a template name to jump to it.</p>

<h2>Rules that apply to every template</h2>
<table>
<tr><th style="width:32%">Rule</th><th>What to do</th></tr>
${RULES.map((r, i) => `<tr class="${i % 2 ? "alt" : ""}"><td><b>${r[0]}</b></td><td>${r[1]}</td></tr>`).join("\n")}
</table>

<h2>The standard fields</h2>
<p>The same thing is written the same way everywhere. If a field below appears in a template, it looks
like this — whether the reader is a vendor, a customer or an admin.</p>
<table>
<tr><th style="width:16%">Field</th><th style="width:28%">What it holds</th><th style="width:32%">Looks like</th><th>Used by</th></tr>
${FIELDS.map((r, i) => `<tr class="${i % 2 ? "alt" : ""}"><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("\n")}
</table>

<h2>Read this before you start</h2>
<p>A template's wording, variables and button URLs are <b>frozen once Meta approves it</b>. It cannot be
edited afterwards — it has to be created again under a new name, while the old one keeps sending. So the
order below matters.</p>

<h3>Start with these ${READY.length}</h3>
<p>Every template except the ones listed next. Their content and URLs are final.</p>
<p class="meta">${READY.map((t) => `<a href="#t${t.id}">#${t.id}</a>`).join(" · ")}</p>

<h3>Do not create these ${WAIT_IDS.size} yet</h3>
<table>
<tr><th style="width:20%">Templates</th><th style="width:20%">What</th><th>Why to wait</th></tr>
<tr><td><code>${TEMPLATES.filter((t) => t.buttons.length > 1).map((t) => `#${t.id}`).join(", ")}</code></td>
    <td><b>Every template with two buttons</b></td>
    <td>Our messaging provider still has to confirm one setting before a two-button template can be sent. It is a single question to them, and it now blocks ${TEMPLATES.filter((t) => t.buttons.length > 1).length} templates — so it is worth chasing first.</td></tr>
<tr class="alt"><td><code>#19</code></td><td><b>Plan Limit Reached</b></td><td>Its button points at a vendor panel page that does not exist yet.</td></tr>
<tr><td><code>#38</code></td><td><b>Claim Expired</b></td><td>The feature it belongs to is not live, so nothing sends it. Create it last.</td></tr>
</table>

<h3>Create these, but they stay quiet for a while</h3>
<table>
<tr><th style="width:20%">Templates</th><th style="width:20%">What</th><th>Note</th></tr>
<tr><td><code>#39, #40, #41, #42</code></td><td><b>The 4 Admin alerts</b></td><td>Create them now — the content is final. They simply will not start sending until admin WhatsApp alerts are switched on at our end.</td></tr>
</table>

<h2>What the Type column means</h2>
<table>
<tr><th style="width:18%">Type</th><th>Meaning</th><th style="width:28%">Sample looks like</th></tr>
${TYPE_GLOSSARY.map((r, i) => `<tr class="${i % 2 ? "alt" : ""}"><td><b>${r[0]}</b></td><td>${esc(r[1])}</td><td><code>${esc(r[2])}</code></td></tr>`).join("\n")}
</table>

<h2 class="brk"><a name="list" id="list"></a>Full list</h2>
<p class="meta">Click a template name to jump to its details.</p>
<table>
<tr><th class="num">#</th><th>Template name</th><th style="width:14%">Role</th><th style="width:16%">Group</th><th style="width:9%">Vars</th><th style="width:9%">Buttons</th></tr>
${TEMPLATES.map(
  (t, i) =>
    `<tr class="${i % 2 ? "alt" : ""}"><td class="num">${t.id}</td><td><a href="#t${t.id}"><code>${t.name}</code></a></td><td>${t.role}</td><td>${t.group}</td><td>${t.vars.length}</td><td>${t.buttons.length}</td></tr>`,
).join("\n")}
</table>
`;

let section = 0;
for (const role of ROLE_ORDER) {
  section += 1;
  const inRole = TEMPLATES.filter((t) => t.role === role);
  const letter = String.fromCharCode(64 + section);
  brief += `\n<h2 class="brk">Section ${letter} — ${role} templates (${inRole.length})</h2>\n`;
  brief += `<p class="lead">${esc(ROLE_BLURB[role])}</p>\n`;

  const groups = [...new Set(inRole.map((t) => t.group))];
  let gi = 0;
  for (const group of groups) {
    gi += 1;
    const inGroup = inRole.filter((t) => t.group === group);
    brief += `\n<h3>${letter}.${gi} &nbsp; ${esc(group)} (${inGroup.length})</h3>\n`;

    for (const t of inGroup) {
      brief += `
<div class="tmpl">
  <a name="t${t.id}" id="t${t.id}"></a>
  <div class="hdr">
    <span class="tname">#${t.id} &nbsp; ${t.name}</span>${t.atCap ? '<span class="cap">USES ALL 10 VARIABLES</span>' : ""}
    <div class="facts"><b>${esc(t.title)}</b> &nbsp;|&nbsp; Category: Utility &nbsp;|&nbsp; Language: English (en)
    &nbsp;|&nbsp; Variables: ${t.vars.length} &nbsp;|&nbsp; Buttons: ${t.buttons.length}</div>
  </div>

  <p><b>When it is sent:</b> ${esc(t.when)}</p>

  <h4>Message body</h4>
  <div class="msg">${bodyHtml(t.body)}</div>

  <h4>Variables</h4>
  <table>
  <tr><th class="num">#</th><th style="width:22%">Variable name</th><th style="width:12%">Type</th><th style="width:26%">Sample value</th><th>Notes</th></tr>
  ${t.vars
    .map(
      (x, i) =>
        `<tr class="${i % 2 ? "alt" : ""}"><td class="num">{{${x.n}}}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.type)}</td><td><code>${esc(x.sample)}</code></td><td>${x.note ? esc(x.note) : ""}</td></tr>`,
    )
    .join("\n  ")}
  </table>

  <h4>Buttons</h4>
  <table>
  <tr><th class="num">#</th><th style="width:14%">Type of action</th><th style="width:18%">Button text</th><th style="width:10%">URL type</th><th>Website URL</th><th style="width:16%">Sample for {{1}}</th></tr>
  ${t.buttons
    .map(
      (b, i) =>
        `<tr class="${i % 2 ? "alt" : ""}"><td class="num">${i + 1}</td><td>${b.action}</td><td><b>${esc(b.text)}</b></td><td>${b.urlType}</td><td><code>${esc(b.url)}</code></td><td><code>${esc(b.sample)}</code></td></tr>`,
    )
    .join("\n  ")}
  </table>
${t.note ? `  <div class="note"><b>Why it is written this way:</b> ${esc(t.note)}</div>\n` : ""}${
        t.hold ? `  <div class="hold"><b>Hold this one:</b> ${esc(t.hold)}</div>\n` : ""
      }  <p class="back"><a href="#list">↑ Back to the full list</a></p>
</div>
`;
    }
  }
}

brief += `
<h2 class="brk">Checklist for each template</h2>
<table>
<tr><th style="width:26pt"></th><th>Before you save</th></tr>
${[
  "Category is set to <b>Utility</b> and language to <b>English</b>",
  "Message text copied exactly — wording, emojis and line breaks",
  "Every variable numbered in the same order as this document",
  "A sample value filled for every variable, taken from this document",
  "No commas anywhere in the sample values",
  "No ₹ sign in an amount sample — it is already in the message text",
  "Button text is 25 characters or fewer",
  "Each button's URL variable is <b>{{1}}</b>, numbered separately from the body",
  "A sample filled for every dynamic button URL",
]
  .map((r, i) => `<tr class="${i % 2 ? "alt" : ""}"><td style="text-align:center">☐</td><td>${r}</td></tr>`)
  .join("\n")}
</table>

<h2>Questions</h2>
<p>Anything unclear about a message's wording, a variable or a button — ask before creating the
template rather than after. A template cannot be edited once Meta approves it; it has to be created
again under a new name, and the old one keeps sending in the meantime.</p>
<p class="meta">Trydood &nbsp;·&nbsp; ${stamp} &nbsp;·&nbsp; ${TEMPLATES.length} templates</p>
`;

// ===========================================================================
// DOCUMENT 2 — every button, its URL, and the route behind it
// ===========================================================================

const buttonRows = [];
for (const t of TEMPLATES) {
  t.buttons.forEach((b, i) => {
    buttonRows.push({
      id: t.id,
      template: t.name,
      role: t.role,
      pos: i + 1,
      ...b,
    });
  });
}

const OWNERS = [...new Set(buttonRows.map((r) => r.owner))];
const newRoutes = buttonRows.filter((r) => r.status.startsWith("NEW"));
const confirmRoutes = buttonRows.filter((r) => r.status.startsWith("Confirm"));

const paths = `
<h1>Trydood WhatsApp Buttons — Routes</h1>
<p class="sub">Every button, where it sends the reader, and who owns that page</p>
<p class="meta">${buttonRows.length} buttons across ${TEMPLATES.length} templates &nbsp;·&nbsp; Prepared ${stamp}</p>

<h2>What this is for</h2>
<p class="lead">Each WhatsApp message carries one or two buttons. This lists every one of them: the URL
that is registered with Meta, the constant in the backend that builds it, what the dynamic part of the
URL contains, and the front-end route that has to exist for the tap to land somewhere.</p>
<p><b>The rule behind every destination:</b> a button opens <b>the exact record the message is about</b>,
never a list. A payment notification opens that payment; a refund notification opens that refund. The
only exceptions are the plan list — where the vendor is choosing, so a list is the point — and the
onboarding and dashboard screens, which are single pages.</p>

<h3>⚠️ A URL is frozen when Meta approves the template</h3>
<p>Everything below has to be right <b>before</b> a template is created, not after. If a route changes
later, the template has to be built again under a new name and the old one keeps sending in the
meantime. So a "NEW" or "Confirm" row in the last column is a blocker, not a to-do.</p>

<h2>What needs building or confirming</h2>
<h3>${newRoutes.length} routes do not exist yet</h3>
<table>
<tr><th class="num">#</th><th style="width:22%">Template</th><th style="width:16%">Button</th><th>Route needed</th></tr>
${newRoutes
  .map(
    (r, i) =>
      `<tr class="${i % 2 ? "alt" : ""}"><td class="num">${r.id}</td><td><code>${r.template}</code></td><td><b>${esc(r.text)}</b></td><td>${esc(r.route)}<br/><span class="meta">backend constant: <code>${esc(r.backend)}</code></span></td></tr>`,
  )
  .join("\n")}
</table>

<h3>${confirmRoutes.length} routes exist but need confirming</h3>
<table>
<tr><th class="num">#</th><th style="width:22%">Template</th><th style="width:16%">Button</th><th>What to confirm</th></tr>
${confirmRoutes
  .map(
    (r, i) =>
      `<tr class="${i % 2 ? "alt" : ""}"><td class="num">${r.id}</td><td><code>${r.template}</code></td><td><b>${esc(r.text)}</b></td><td>${esc(r.route)}</td></tr>`,
  )
  .join("\n")}
</table>

<h2>Sign-in behaviour</h2>
<table>
<tr><th style="width:20%">Surface</th><th>What happens when the reader is not signed in</th></tr>
<tr><td><b>Vendor panel</b><br/><code>${VENDOR}</code></td><td>The panel's own auth guard shows the login screen, then continues to the requested page. Nothing is appended to the URL — the route <i>is</i> the destination.</td></tr>
<tr class="alt"><td><b>Admin panel</b><br/><code>${ADMIN}</code></td><td>Same as the vendor panel.</td></tr>
<tr><td><b>Customer app</b><br/><code>${APP}</code></td><td>App installed and signed in: opens that screen. Signed out: login, then that screen. <b>Not installed:</b> the link opens in a browser, and whatever is served at that host decides — it should send the visitor to the store. That decision cannot be expressed in the link, so it belongs to the page at that host.</td></tr>
<tr class="alt"><td><b>Document download</b><br/><code>${API}</code></td><td>No sign-in. The token in the URL is the authorisation, which is why it is long and unguessable.</td></tr>
<tr><td><b>Website</b><br/><code>${SITE}</code></td><td>Public page, no sign-in.</td></tr>
</table>

<h2>Base URLs</h2>
<table>
<tr><th style="width:22%">Owner</th><th style="width:34%">Base</th><th>Buttons</th></tr>
${OWNERS.map(
  (o, i) =>
    `<tr class="${i % 2 ? "alt" : ""}"><td><b>${esc(o)}</b></td><td><code>${
      o === "Vendor panel" ? VENDOR : o === "Admin panel" ? ADMIN : o === "Customer app" ? APP : o === "Website" ? SITE : API
    }</code></td><td>${buttonRows.filter((r) => r.owner === o).length}</td></tr>`,
).join("\n")}
</table>

<h2 class="brk">Every button</h2>
<p class="meta">Grouped by who owns the destination. <b>Front-end route</b> is the column to correct — send it back and both documents are rebuilt from it.</p>
${OWNERS.map((o) => {
  const rows = buttonRows.filter((r) => r.owner === o);
  return `
<h3>${esc(o)} — ${rows.length} buttons</h3>
<table>
<tr><th class="num">#</th><th style="width:19%">Template</th><th style="width:13%">Button text</th><th style="width:8%">Type</th><th style="width:22%">Full URL</th><th style="width:14%">Dynamic part is</th><th>Front-end route</th></tr>
${rows
  .map(
    (r, i) =>
      `<tr class="${i % 2 ? "alt" : ""}"><td class="num">${r.id}</td><td><code>${r.template}</code></td><td><b>${esc(r.text)}</b></td><td>${r.urlType}</td><td><code>${esc(r.url)}</code></td><td>${esc(r.valueIs)}</td><td>${esc(r.route)}${
        r.status.startsWith("NEW") ? ' <span class="new">NEW</span>' : r.status.startsWith("Confirm") ? ' <span class="new">CONFIRM</span>' : ' <span class="ok">✓</span>'
      }<br/><span class="meta">${esc(r.backend)}</span></td></tr>`,
  )
  .join("\n")}
</table>`;
}).join("\n")}

<h2>Backend constants</h2>
<p>All of these live in one file — <code>server/helpers/notifications/panelLinks.js</code>. A route rename
is one edit there and every channel follows: the WhatsApp button, the email button, the in-app row and
the push payload.</p>
<table>
<tr><th style="width:34%">Constant</th><th style="width:16%">Status</th><th>Produces</th></tr>
${[...new Set(buttonRows.map((r) => r.backend))]
  .filter((b) => b !== "—")
  .map((b, i) => {
    const row = buttonRows.find((r) => r.backend === b);
    return `<tr class="${i % 2 ? "alt" : ""}"><td><code>${esc(b)}</code></td><td>${
      row.status.startsWith("NEW") ? '<span class="new">NEW</span>' : row.status.startsWith("Confirm") ? '<span class="new">CONFIRM</span>' : '<span class="ok">✓ exists</span>'
    }</td><td><code>${esc(row.url)}</code></td></tr>`;
  })
  .join("\n")}
</table>
<p class="meta">Trydood &nbsp;·&nbsp; ${stamp} &nbsp;·&nbsp; ${buttonRows.length} buttons</p>
`;

// ---- Markdown version of document 2, because that one is meant to be edited --
const md = `# Trydood WhatsApp Buttons — Routes

**${buttonRows.length} buttons across ${TEMPLATES.length} templates** · ${stamp}

> Edit the **Front-end route** column and send this file back. Both documents are
> rebuilt from it — the paths live in one place, `+
  "`server/scripts/generateWhatsappTemplateDoc.js`" +
  `.

## The rule behind every destination

A button opens **the exact record the message is about**, never a list. A payment
notification opens that payment; a refund notification opens that refund. The only
exceptions are the plan list — where the vendor is choosing, so a list is the
point — and the onboarding and dashboard screens, which are single pages.

⚠️ **A URL is frozen when Meta approves the template.** If a route changes later,
the template has to be built again under a new name and the old one keeps sending
in the meantime. A \`NEW\` or \`CONFIRM\` below is a blocker, not a to-do.

## Needs building — ${newRoutes.length}

| # | Template | Button | Route needed | Backend constant |
|---|---|---|---|---|
${newRoutes.map((r) => `| ${r.id} | \`${r.template}\` | ${r.text} | ${r.route} | \`${r.backend}\` |`).join("\n")}

## Needs confirming — ${confirmRoutes.length}

| # | Template | Button | What to confirm |
|---|---|---|---|
${confirmRoutes.map((r) => `| ${r.id} | \`${r.template}\` | ${r.text} | ${r.route} |`).join("\n")}

## Sign-in behaviour

| Surface | Not signed in |
|---|---|
| Vendor panel \`${VENDOR}\` | Panel auth guard shows login, then continues to the page. Nothing appended to the URL — the route *is* the destination. |
| Admin panel \`${ADMIN}\` | Same. |
| Customer app \`${APP}\` | Installed + signed in: that screen. Signed out: login, then that screen. **Not installed:** opens in a browser, and the page at that host sends the visitor to the store. That cannot be expressed in the link. |
| Documents \`${API}\` | No sign-in — the token in the URL is the authorisation. |
| Website \`${SITE}\` | Public. |

${OWNERS.map((o) => {
  const rows = buttonRows.filter((r) => r.owner === o);
  return `## ${o} — ${rows.length} buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.id} | \`${r.template}\` | ${r.text} | ${r.urlType} | \`${r.url}\` | ${r.valueIs} | ${r.route} | \`${r.backend}\` | ${r.status} |`,
  )
  .join("\n")}`;
}).join("\n\n")}

## Backend constants

All in \`server/helpers/notifications/panelLinks.js\`. A route rename is one edit
there and every channel follows — WhatsApp button, email button, in-app row, push.

| Constant | Status | Produces |
|---|---|---|
${[...new Set(buttonRows.map((r) => r.backend))]
  .filter((b) => b !== "—")
  .map((b) => {
    const row = buttonRows.find((r) => r.backend === b);
    return `| \`${b}\` | ${row.status} | \`${row.url}\` |`;
  })
  .join("\n")}
`;

// ---------------------------------------------------------------------------

/**
 * Exported so `checkTemplateDocsInSync.js` can compare this against the
 * specification document without re-parsing a rendered file. Everything below is
 * guarded on being the entry point, so requiring this never writes anything.
 */
module.exports = { TEMPLATES, WAIT_IDS, buttonRows };

if (require.main !== module) return;

const outDir = path.join(__dirname, "..", "docs");
const OUTPUTS = [
  { base: "Trydood_WhatsApp_Templates", title: "Trydood WhatsApp Templates", html: page("Trydood WhatsApp Templates", brief) },
  { base: "Trydood_WhatsApp_Button_Paths", title: "Trydood WhatsApp Buttons — Routes", html: page("Trydood WhatsApp Buttons — Routes", paths) },
];

for (const o of OUTPUTS) fs.writeFileSync(path.join(outDir, `${o.base}.html`), o.html, "utf8");
fs.writeFileSync(path.join(outDir, "Trydood_WhatsApp_Button_Paths.md"), md, "utf8");

console.log(`Templates : ${TEMPLATES.length} (${counts})`);
console.log(`Buttons   : ${buttonRows.length}  (${newRoutes.length} new routes, ${confirmRoutes.length} to confirm)`);
console.log(`Ready now : ${READY.length}   Waiting: ${WAIT_IDS.size}`);
console.log(`Checks    : passed`);
for (const o of OUTPUTS) console.log(`HTML      : ${path.join(outDir, `${o.base}.html`)}`);
console.log(`MD        : ${path.join(outDir, "Trydood_WhatsApp_Button_Paths.md")}`);

if (!process.argv.includes("--docx")) {
  console.log("");
  console.log("Add --docx to convert with the locally installed Word.");
  process.exit(0);
}

/**
 * Word does the conversion, because it is already on this machine and there is
 * no .docx writer in the dependency tree. `wdFormatDocumentDefault` is 16.
 *
 * Renaming the .html to .doc would also open in Word, but it shows a
 * "format doesn't match extension" warning to whoever receives it — the wrong
 * first impression for a document going to a team.
 */
const { execFileSync } = require("child_process");
const q = (s) => s.replace(/'/g, "''");

/**
 * Whoever is reading last night's copy has it open in Word, and Word holds an
 * exclusive lock. Checked up front, for all of them, so the run either replaces
 * every document or none — a half-updated pair is worse than a refusal, because
 * the two would then disagree about a button.
 */
const locked = OUTPUTS.map((o) => path.join(outDir, `${o.base}.docx`)).filter((p) => {
  if (!fs.existsSync(p)) return false;
  try {
    fs.closeSync(fs.openSync(p, "r+"));
    return false;
  } catch {
    return true;
  }
});
if (locked.length) {
  console.error("");
  console.error("These documents are open somewhere and cannot be replaced:");
  locked.forEach((p) => console.error(`  ${p}`));
  console.error("");
  console.error("Close them in Word and run this again. The .html and .md above are already updated.");
  process.exit(1);
}

for (const o of OUTPUTS) {
  const htmlPath = path.join(outDir, `${o.base}.html`);
  const docxPath = path.join(outDir, `${o.base}.docx`);
  const ps = `
$ErrorActionPreference = 'Stop'
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open('${q(htmlPath)}', [ref]$false, [ref]$false)
  $doc.SaveAs([ref]'${q(docxPath)}', [ref]16)
  Write-Output ('pages=' + $doc.ComputeStatistics(2))
  $doc.Close([ref]$false)
} finally {
  if ($word) { $word.Quit() }
}`;
  try {
    if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath);
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8",
    });
    const pages = (out.match(/pages=(\d+)/) || [])[1] || "?";
    const kb = (fs.statSync(docxPath).size / 1024).toFixed(1);
    console.log(`DOCX      : ${docxPath}  (${pages} pages, ${kb} KB)`);
  } catch (error) {
    console.error(`\nWord could not convert ${o.base}:`);
    console.error(error.stderr || error.message);
    console.error(`The HTML is still there and opens in Word: ${htmlPath}`);
    process.exit(1);
  }
}
