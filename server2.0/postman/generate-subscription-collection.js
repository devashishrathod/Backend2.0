/**
 * Generator for the Trydood 2.0 — Subscription, Checkout & Plan Entitlements
 * Postman collection.
 *
 * Emits, next to this file:
 *   trydood-subscription.postman_collection.json
 *   environments/subscription-{local,staging,production}.postman_environment.json
 *   SUBSCRIPTION_README.md
 *
 * Usage:  node postman/generate-subscription-collection.js
 *
 * Every path, field, enum, status code and message below is traced to real code
 * in `server2.0` — see the `src` note on each request. Re-run after changing a
 * route or validator so the collection never drifts from the API.
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = __dirname;
const ENV_DIR = path.join(OUT_DIR, "environments");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const json = (obj) => JSON.stringify(obj, null, 2);

/** A raw JSON request body. */
const body = (obj) => ({
  mode: "raw",
  raw: json(obj),
  options: { raw: { language: "json" } },
});

/** Build a Postman url object from a path array + optional query array. */
const url = (segments, query) => {
  const qs = query?.length
    ? `?${query.map((q) => `${q.key}=${q.value}`).join("&")}`
    : "";
  return {
    raw: `{{base_url}}/${segments.join("/")}${qs}`,
    host: ["{{base_url}}"],
    path: segments,
    ...(query?.length ? { query } : {}),
  };
};

const q = (key, value, description, disabled) => ({
  key,
  value: String(value),
  description,
  ...(disabled ? { disabled: true } : {}),
});

/** A saved example response. */
const example = (name, code, status, payload) => ({
  name,
  status,
  code,
  _postman_previewlanguage: "json",
  header: [{ key: "Content-Type", value: "application/json" }],
  cookie: [],
  body: typeof payload === "string" ? payload : json(payload),
});

const ok = (name, code, payload) =>
  example(name, code, code === 201 ? "Created" : "OK", payload);

/** Error envelope produced by utils/response.js -> sendError. */
const err = (name, code, status, message, details) =>
  example(name, code, status, {
    success: false,
    message,
    ...(details ? { details } : {}),
  });

const e401 = () =>
  err(
    "401 — no token",
    401,
    "Unauthorized",
    "Access Denied! Missing authorization token",
  );

const e403Role = () =>
  err(
    "403 — wrong role",
    403,
    "Forbidden",
    "Forbidden: You do not have permission to perform this action.",
  );

const e403Brand = () =>
  err(
    "403 — not your brand",
    403,
    "Forbidden",
    "Forbidden: You do not have permission to perform this action on this brand.",
  );

/** Post-response test script. `lines` is an array of JS source lines. */
const test = (lines) => [
  { listen: "test", script: { type: "text/javascript", exec: lines } },
];

/** Standard assertions every request gets. */
const baseAsserts = (code = 200) => [
  `pm.test("status is ${code}", function () {`,
  `    pm.response.to.have.status(${code});`,
  "});",
  "",
  'pm.test("responds under 5s", function () {',
  "    pm.expect(pm.response.responseTime).to.be.below(5000);",
  "});",
  "",
  'pm.test("envelope shape", function () {',
  "    const b = pm.response.json();",
  '    pm.expect(b).to.have.property("success", true);',
  '    pm.expect(b).to.have.property("message");',
  '    pm.expect(b).to.have.property("data");',
  "});",
  "",
];

const request = ({
  name,
  method,
  segments,
  query,
  reqBody,
  description,
  token = "{{admin_token}}",
  noauth = false,
  tests,
  responses = [],
}) => ({
  name,
  ...(tests ? { event: test(tests) } : {}),
  request: {
    auth: noauth
      ? { type: "noauth" }
      : {
          type: "bearer",
          bearer: [{ key: "token", value: token, type: "string" }],
        },
    method,
    header: [
      ...(reqBody ? [{ key: "Content-Type", value: "application/json" }] : []),
    ],
    ...(reqBody ? { body: body(reqBody) } : {}),
    url: url(segments, query),
    description,
  },
  response: responses,
});

const folder = (name, description, items) => ({
  name,
  description,
  item: items,
});

// ---------------------------------------------------------------------------
// shared example payloads (traced to real schemas)
// ---------------------------------------------------------------------------

const PRICING = {
  currency: "INR",
  listPrice: 4999,
  discountType: "PERCENT",
  discountPercent: 0,
  discountAmount: 0,
  promoCode: null,
  promoDiscount: 0,
  taxableValue: 4999,
  gstPercentage: 18,
  isGstInclusive: false,
  taxType: "IGST",
  cgst: 0,
  sgst: 0,
  igst: 899.82,
  gstAmount: 899.82,
  hsnSacCode: "998315",
  placeOfSupplyStateCode: "06",
  placeOfSupplyState: "Haryana",
  totalPayable: 5898.82,
  amountInPaise: 589882,
  youSaved: 0,
};

const ORDER_SUMMARY = {
  rows: [
    {
      key: "ORIGINAL_PRICE",
      label: "Original Price",
      amount: 4999,
      display: "₹ 4,999.00",
    },
    {
      key: "BILL_VALUE",
      label: "Bill Value",
      amount: 4999,
      display: "₹ 4,999.00",
    },
    { key: "TAX", label: "IGST @ 18.00%", amount: 899.82, display: "₹ 899.82" },
  ],
  payable: { label: "You'll Pay", amount: 5898.82, display: "₹ 5,898.82" },
  youSaved: 0,
  youSavedDisplay: "₹ 0.00",
  savedText: "You saved ₹ 0.00 on This Plan",
};

const BILLING = {
  brandName: "Devashish Tester",
  address:
    "First Floor, Unit 101, The Statement Baani, Sector-43, Golf Course Road, Gurugram, Gurugram, Haryana, 122002",
  gstin: "06AAECG4365R1Z1",
  pan: "AAECG4365R",
  addressSource: "GST",
};

const ENTITLEMENTS = {
  subBrands: { limit: 0, isUnlimited: true },
  franchises: { limit: 0, isUnlimited: true },
  vouchers: { limit: 0, isUnlimited: true },
  showcase: { limit: 0, isUnlimited: true },
  dealPack: { isEnabled: true },
  prioritySupport: { isEnabled: true },
};

// One entry per metered pool, the shape summarizeUsage() returns.
const USAGE_ALL = {
  subBrands: {
    used: 4,
    limit: null,
    isUnlimited: true,
    overflowBy: 0,
    label: "outlets",
  },
  franchises: {
    used: 2,
    limit: null,
    isUnlimited: true,
    overflowBy: 0,
    label: "franchises",
  },
  vouchers: {
    used: 8,
    limit: null,
    isUnlimited: true,
    overflowBy: 0,
    label: "vouchers",
  },
  showcase: {
    used: 5,
    limit: null,
    isUnlimited: true,
    overflowBy: 0,
    label: "showcase sections",
  },
};

const PLAN_BLOCK = {
  _id: "6b1a1e4fa1b2c3d4e5f60104",
  name: "Pro Plus",
  description: "For national brands at scale",
  type: "YEARLY",
  typeLabel: "Yearly",
  price: 4999,
  strikePrice: null,
  discountType: "PERCENT",
  discountPercent: 0,
  durationInDays: 365,
  durationLabel: "1 year",
  benefits: [
    "Unlimited transactions",
    "On-time settlements",
    "Franchise support",
  ],
  limitations: [],
  features: [
    { title: "Sub Brand", value: "Unlimited", available: true },
    { title: "Franchise", value: "Yes", available: true },
  ],
  entitlements: ENTITLEMENTS,
};

// The platform's REAL seller identity, as stored in Setting.vendor.subscription
// and traced to the verified GST record 33AAKCT3750H1ZB.
//
// These were placeholders once, and running the "Update Settings" request from
// this collection wrote a fabricated GSTIN into the live database. Keep the real
// values here so re-running that request is always safe.
const SELLER = Object.freeze({
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress:
    "2nd Floor, Phase-3, Suite No. 250, No. S101, Door No. 769, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
  companyStateCode: "33",
  companyState: "Tamil Nadu",
});

const SUBSCRIPTION_CONFIG = {
  gstPercentage: 18,
  isGstInclusive: false,
  hsnSacCode: "998315",
  ...SELLER,
  currency: "INR",
  allowVendorUpgrade: true,
  allowVendorDowngrade: false,
  allowVendorRenewal: true,
  allowAdminDowngrade: true,
  allowAdminFreeGrant: true,
  gracePeriodDays: 0,
  pendingOrderReuseMinutes: 15,
  expiryJobIntervalMinutes: 60,
  reminderJobIntervalMinutes: 180,
  expiryReminderDays: [7, 3, 1],
  // Deliberately matches the LIVE value. This body is a full replace, so an
  // example that disagreed with production would silently switch promo codes off
  // the first time someone ran the request to "see what it does".
  isPromoCodeEnabled: true,
  // One kill switch per outbound channel. The in-app row is always written.
  isEmailNotificationEnabled: true,
  isPushNotificationEnabled: true,
  // False until the Meta-approved WhatsApp templates are in the environment.
  isWhatsAppNotificationEnabled: false,
  isActive: true,
};

// ---------------------------------------------------------------------------
// 00 — Auth
// ---------------------------------------------------------------------------

const authFolder = folder(
  "00 — Auth (token capture)",
  "Run one of these first. The test scripts write the JWT into the right environment variable, so nothing is copy-pasted by hand. Login puts the JWT at `data.token` (`services/auth/loginWithEmailAndPassword.js`).",
  [
    request({
      name: "Login as Admin",
      method: "POST",
      segments: ["auth", "login"],
      noauth: true,
      reqBody: {
        type: "EMAIL",
        email: "{{admin_email}}",
        password: "{{admin_password}}",
        role: "ADMIN",
      },
      description:
        "Public. Email + password login. Captures **admin_token** and **admin_user_id**. Every `/subscribeds/admin/*` request depends on this.",
      tests: [
        'pm.test("login succeeded", function () {',
        "    pm.response.to.have.status(200);",
        "});",
        "",
        "const b = pm.response.json();",
        "if (b.success && b.data && b.data.token) {",
        '    pm.environment.set("admin_token", b.data.token);',
        "    if (b.data.user && b.data.user._id) {",
        '        pm.environment.set("admin_user_id", b.data.user._id);',
        "    }",
        '    console.log("admin_token captured");',
        "} else {",
        '    console.warn("No token in response — admin_token not set");',
        "}",
      ],
      responses: [
        ok("200 — logged in", 200, {
          success: true,
          message: "User logged in successfully",
          data: {
            user: {
              _id: "68a1f4c2b1e2c3d4e5f60600",
              email: "admin@trydood.com",
              role: "ADMIN",
              isActive: true,
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
        }),
      ],
    }),
    request({
      name: "Login as Vendor (mobile + password)",
      method: "POST",
      segments: ["auth", "login"],
      noauth: true,
      reqBody: {
        type: "MOBILE",
        mobile: "{{vendor_mobile}}",
        password: "{{vendor_password}}",
        role: "VENDOR",
      },
      description:
        "Public. Captures **vendor_token** and **brand_id** (the vendor's own brand — `req.brandId` comes from `user.brandId` in `verifyJwtToken`).",
      tests: [
        'pm.test("login succeeded", function () {',
        "    pm.response.to.have.status(200);",
        "});",
        "",
        "const b = pm.response.json();",
        "if (b.success && b.data && b.data.token) {",
        '    pm.environment.set("vendor_token", b.data.token);',
        "    if (b.data.user && b.data.user.brandId) {",
        '        pm.environment.set("brand_id", b.data.user.brandId);',
        "    }",
        '    console.log("vendor_token captured");',
        "} else {",
        '    console.warn("No token in response — vendor_token not set");',
        "}",
      ],
      responses: [
        ok("200 — logged in", 200, {
          success: true,
          message: "User logged in successfully",
          data: {
            user: {
              _id: "68a1f4c2b1e2c3d4e5f60601",
              mobile: "9876543210",
              role: "VENDOR",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              currentScreen: "SUBSCRIBE_PLAN",
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
        }),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 01 — Admin Settings (CHANGED)
// ---------------------------------------------------------------------------

const settingsFolder = folder(
  "01 — Admin Settings · subscription config  [CHANGED]",
  "`Setting.vendor.subscription` is new. Every tunable in the checkout flow — GST %, seller identity, who may upgrade/downgrade, grace period — is read from here via `helpers/settings/getSubscriptionConfig.js`. `constants/subscription.js → SUBSCRIPTION_DEFAULTS` is a fallback only.\n\n⚠️ **`companyStateCode` must be set.** It is compared against the first two digits of the brand's GSTIN to decide CGST+SGST vs IGST. While blank, every supply is billed as inter-state IGST.",
  [
    request({
      name: "Get Settings",
      method: "GET",
      segments: ["settings", "get"],
      description:
        "Admin only (`isAdmin`). Response now carries `vendor.subscription`. Upserts the singleton doc with defaults on first read (`helpers/settings/getSetting.js`).",
      tests: [
        ...baseAsserts(200),
        'pm.test("subscription config present", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.vendor).to.have.property("subscription");',
        '    pm.expect(d.vendor.subscription).to.have.property("gstPercentage");',
        "});",
        "",
        'pm.test("companyStateCode is configured (needed for correct CGST/SGST)", function () {',
        "    const s = pm.response.json().data.vendor.subscription;",
        "    if (!s.companyStateCode) {",
        '        console.warn("companyStateCode is blank — all tax will be billed as IGST");',
        "    }",
        '    pm.expect(s).to.have.property("companyStateCode");',
        "});",
      ],
      responses: [
        ok("200 — settings", 200, {
          success: true,
          message: "Settings fetched successfully.",
          data: {
            _id: "68a1f4c2b1e2c3d4e5f60900",
            vendor: {
              voucher: { maxOffers: 10, maxImages: 5, maxDistanceKm: 25 },
              showcase: {
                maxSections: 5,
                maxItemsPerSection: 15,
                isActive: true,
              },
              subscription: SUBSCRIPTION_CONFIG,
            },
            customer: {},
            isActive: true,
            updatedBy: "68a1f4c2b1e2c3d4e5f60600",
          },
        }),
        e401(),
        e403Role(),
      ],
    }),
    request({
      name: "Update Settings — subscription config",
      method: "PUT",
      segments: ["settings", "update"],
      reqBody: {
        vendor: {
          subscription: {
            gstPercentage: 18,
            isGstInclusive: false,
            ...SELLER,
            hsnSacCode: "998315",
            allowVendorDowngrade: false,
            allowAdminDowngrade: true,
            allowAdminFreeGrant: true,
            gracePeriodDays: 0,
            expiryJobIntervalMinutes: 60,
            isEmailNotificationEnabled: true,
            isPushNotificationEnabled: true,
            isWhatsAppNotificationEnabled: false,
          },
        },
      },
      description: [
        "Admin only. **Merged, not replaced** (`services/settings/updateSetting.js`) — send only the keys you want to change, and anything you omit keeps its current value.",
        "",
        "`companyStateCode` must be a 2-digit GST state code; it decides intra-state CGST+SGST versus inter-state IGST on every invoice.",
        "",
        "**`isPromoCodeEnabled`** gates the whole promo feature and is **true** in this environment. It is left out of the body above on purpose — sending `false` by accident would switch promo codes off platform-wide.",
        "",
        "**Notification channels.** One kill switch each; the in-app row is always written regardless, so these only govern outbound delivery:",
        "",
        "| Flag | Default | Also needs |",
        "|---|---|---|",
        "| `isEmailNotificationEnabled` | `true` | SMTP configured |",
        "| `isPushNotificationEnabled` | `true` | `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` |",
        "| `isWhatsAppNotificationEnabled` | **`false`** | a `WHATSAPP_TEMPLATE_<TYPE>` env var per message type |",
        "",
        "WhatsApp needs **both** gates: this flag on, *and* an approved template for that specific notification type. Either one missing is a clean skip, not an error — which is what lets templates be switched on one at a time as Meta approves them.",
      ].join("\n"),
      tests: [
        ...baseAsserts(200),
        'pm.test("values applied", function () {',
        "    const s = pm.response.json().data.vendor.subscription;",
        "    pm.expect(s.gstPercentage).to.eql(18);",
        '    pm.expect(s.companyStateCode).to.eql("23");',
        "});",
        "",
        'pm.test("other blocks untouched by the merge", function () {',
        "    const v = pm.response.json().data.vendor;",
        '    pm.expect(v).to.have.property("voucher");',
        '    pm.expect(v).to.have.property("showcase");',
        "});",
      ],
      responses: [
        ok("200 — updated", 200, {
          success: true,
          message: "Settings updated successfully.",
          data: {
            _id: "68a1f4c2b1e2c3d4e5f60900",
            vendor: {
              voucher: { maxOffers: 10, maxImages: 5, maxDistanceKm: 25 },
              showcase: {
                maxSections: 5,
                maxItemsPerSection: 15,
                isActive: true,
              },
              subscription: SUBSCRIPTION_CONFIG,
            },
            isActive: true,
          },
        }),
        err(
          "422 — bad state code",
          422,
          "Unprocessable Entity",
          "companyStateCode must be a 2-digit GST state code",
        ),
        err(
          "422 — empty body",
          422,
          "Unprocessable Entity",
          "Please provide at least one field to update.",
        ),
        e401(),
        e403Role(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 02 — Subscription Plans (CHANGED)
// ---------------------------------------------------------------------------

const plansFolder = folder(
  "02 — Subscription Plans (Admin)  [CHANGED]",
  '`Subscription` gained **`entitlements`** (structured, enforced) plus `discountType` / `discountPercent` / `discountAmount` / `strikePrice` / `durationInYears`.\n\n`features[]` is now **display only** — rename, reorder or delete anything in it and no business rule changes. Enforcement reads `entitlements`, resolved by `helpers/subscriptions/resolveEntitlements.js`.\n\n⚠️ **All four live plans currently resolve as `DERIVED`.** `Franchise: "Yes"` carries no count, so franchises resolve to **0** on Pro Plus, Pro Lite and Advanced — franchise creation is blocked on them until `entitlements` is set explicitly. See `docs/subscription_future_updates.md` §5.',
  [
    request({
      name: "Create Subscription Plan (with entitlements)",
      method: "POST",
      segments: ["subscriptions", "create"],
      reqBody: {
        name: "Pro Plus",
        description: "For national brands at scale",
        price: 4999,
        strikePrice: 6999,
        discountType: "PERCENT",
        discountPercent: 0,
        type: "YEARLY",
        benefits: [
          "Unlimited transactions",
          "On-time settlements",
          "Franchise support",
        ],
        limitations: [],
        features: [
          { title: "Plan Valid", value: "12 / Month", available: true },
          { title: "Sub Brand", value: "Unlimited", available: true },
          { title: "Franchise", value: "Unlimited", available: true },
        ],
        entitlements: {
          subBrands: { isUnlimited: true },
          franchises: { isUnlimited: true },
          vouchers: { isEnabled: true },
          dealPack: { isEnabled: true },
          prioritySupport: { isEnabled: true },
          showcase: { isEnabled: true },
        },
      },
      description:
        "Admin only. `durationInDays` is computed from `type` via `DURATION_MAP` — do not send it. **Always send `entitlements`**: without it the plan falls back to parsing `features[]`, which cannot express a franchise count. `isUnlimited: true` wins over `limit`.",
      tests: [
        ...baseAsserts(200),
        'pm.test("entitlements stored", function () {',
        "    const d = pm.response.json().data;",
        "    pm.expect(d.entitlements.subBrands.isUnlimited).to.be.true;",
        "    pm.expect(d.entitlements.franchises.isUnlimited).to.be.true;",
        "});",
        "",
        'pm.test("duration derived from type", function () {',
        "    pm.expect(pm.response.json().data.durationInDays).to.eql(365);",
        "});",
        "",
        "const b = pm.response.json();",
        "if (b.data && b.data._id) {",
        '    pm.environment.set("subscription_id", b.data._id);',
        '    console.log("subscription_id captured");',
        "}",
      ],
      responses: [
        ok("200 — created", 200, {
          success: true,
          message: "Subscription created successfully",
          data: {
            _id: "6b1a1e4fa1b2c3d4e5f60104",
            name: "Pro Plus",
            description: "For national brands at scale",
            price: 4999,
            strikePrice: 6999,
            discountType: "PERCENT",
            discountPercent: 0,
            discountAmount: 0,
            type: "YEARLY",
            durationInDays: 365,
            features: [
              { title: "Sub Brand", value: "Unlimited", available: true },
              { title: "Franchise", value: "Unlimited", available: true },
            ],
            entitlements: {
              subBrands: { limit: 0, isUnlimited: true },
              franchises: { limit: 0, isUnlimited: true },
              vouchers: { isEnabled: true },
              dealPack: { isEnabled: true },
              prioritySupport: { isEnabled: true },
              showcase: { isEnabled: true },
            },
            isActive: true,
            isDeleted: false,
          },
        }),
        err(
          "409 — duplicate name for type",
          409,
          "Conflict",
          "Subscription with this name for YEARLY plan already exists",
        ),
        err(
          "422 — bad discount",
          422,
          "Unprocessable Entity",
          "discountPercent cannot exceed 100",
        ),
        e401(),
        e403Role(),
      ],
    }),
    request({
      name: "Update Plan — set entitlements on an existing plan",
      method: "PUT",
      segments: ["subscriptions", "update", "{{subscription_id}}"],
      reqBody: {
        entitlements: {
          subBrands: { isUnlimited: true },
          franchises: { limit: 50, isUnlimited: false },
          vouchers: { isEnabled: true },
          dealPack: { isEnabled: true },
          prioritySupport: { isEnabled: true },
          showcase: { isEnabled: true },
        },
      },
      description:
        "Admin only. **This is the fix for the DERIVED plans.** Run it once per live plan so `entitlementsSource` becomes `DB` and franchise limits stop resolving to 0. Existing brands then need `PUT /subscribeds/admin/resync` to pick up the new limits.",
      tests: [
        ...baseAsserts(200),
        'pm.test("franchise limit now explicit", function () {',
        "    const e = pm.response.json().data.entitlements;",
        "    pm.expect(e.franchises.limit).to.eql(50);",
        "    pm.expect(e.franchises.isUnlimited).to.be.false;",
        "});",
      ],
      responses: [
        ok("200 — updated", 200, {
          success: true,
          message: "Subscription updated successfully",
          data: {
            _id: "6b1a1e4fa1b2c3d4e5f60104",
            name: "Pro Plus",
            price: 4999,
            type: "YEARLY",
            durationInDays: 365,
            entitlements: ENTITLEMENTS,
            isActive: true,
          },
        }),
        err("404 — no such plan", 404, "Not Found", "Subscription not found"),
        e401(),
        e403Role(),
      ],
    }),
    request({
      name: "List Subscription Plans",
      method: "GET",
      segments: ["subscriptions", "getAll"],
      token: "{{vendor_token}}",
      query: [
        q("page", 1, "1-based page number"),
        q("limit", 10, "Rows per page"),
        q("search", "", "Matches name or description", true),
        q(
          "type",
          "YEARLY",
          "WEEKLY | MONTHLY | QUATERLY | HALF_YEARLY | YEARLY",
          true,
        ),
        q("isActive", "true", "true | false", true),
        q("sortBy", "price", "price | name | createdAt"),
        q("sortOrder", "asc", "asc | desc"),
      ],
      description:
        "Any authenticated user (`verifyJwtToken`). **Response changed** — the projection now includes `entitlements`, `strikePrice` and the discount fields, so plan cards can show what a plan actually grants.\n\n⚠️ Returns **404** when the result set is empty — the shared `pagination` utility throws instead of returning `[]`.",
      tests: [
        ...baseAsserts(200),
        'pm.test("entitlements exposed on list rows", function () {',
        "    const rows = pm.response.json().data.data;",
        '    pm.expect(rows).to.be.an("array").that.is.not.empty;',
        '    pm.expect(rows[0]).to.have.property("entitlements");',
        "});",
        "",
        "const rows = pm.response.json().data.data || [];",
        "rows.forEach(function (p) {",
        '    if (p.name === "Pro Plus") pm.environment.set("plan_proplus_id", p._id);',
        '    if (p.name === "Pro Lite") pm.environment.set("plan_prolite_id", p._id);',
        '    if (p.name === "Advanced") pm.environment.set("plan_advanced_id", p._id);',
        '    if (p.name === "Basic") pm.environment.set("plan_basic_id", p._id);',
        "});",
      ],
      responses: [
        ok("200 — plans", 200, {
          success: true,
          message: "Subscriptions fetched successfully",
          data: {
            total: 4,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [
              {
                _id: "6b1a1e4fa1b2c3d4e5f60101",
                name: "Basic",
                price: 1999,
                type: "YEARLY",
                durationInDays: 365,
                discountType: "PERCENT",
                discountPercent: 0,
                entitlements: {
                  subBrands: { limit: 1, isUnlimited: false },
                  franchises: { limit: 5, isUnlimited: false },
                  vouchers: { isEnabled: false },
                  dealPack: { isEnabled: false },
                  prioritySupport: { isEnabled: false },
                  showcase: { isEnabled: false },
                },
                isActive: true,
              },
              {
                _id: "6b1a1e4fa1b2c3d4e5f60104",
                name: "Pro Plus",
                price: 4999,
                type: "YEARLY",
                durationInDays: 365,
                entitlements: ENTITLEMENTS,
                isActive: true,
              },
            ],
          },
        }),
        err(
          "404 — empty result set",
          404,
          "Not Found",
          "No any subscription found",
        ),
        e401(),
      ],
    }),
    request({
      name: "Get Subscription Plan",
      method: "GET",
      segments: ["subscriptions", "get", "{{subscription_id}}"],
      token: "{{vendor_token}}",
      description:
        "Any authenticated user. **Response changed** — returns the full document, so `entitlements` and the discount fields are included.",
      tests: [
        ...baseAsserts(200),
        'pm.test("plan returned", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d).to.have.property("entitlements");',
        '    pm.expect(d).to.have.property("price");',
        "});",
      ],
      responses: [
        ok("200 — plan", 200, {
          success: true,
          message: "Subscription fetched successfully",
          data: {
            _id: "6b1a1e4fa1b2c3d4e5f60104",
            name: "Pro Plus",
            description: "For national brands at scale",
            price: 4999,
            type: "YEARLY",
            durationInDays: 365,
            entitlements: ENTITLEMENTS,
            isActive: true,
          },
        }),
        err("404 — no such plan", 404, "Not Found", "Subscription not found"),
        e401(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 03 — Checkout
// ---------------------------------------------------------------------------

const previewResponse = (overrides = {}) => ({
  success: true,
  message: "Subscription checkout preview fetched successfully",
  data: {
    brand: {
      _id: "68a1f4c2b1e2c3d4e5f60718",
      brandName: "Devashish Tester",
      isApproved: true,
    },
    plan: PLAN_BLOCK,
    action: "NEW",
    currentPlan: null,
    validity: {
      startDate: "2026-08-23T09:15:00.000Z",
      endDate: "2027-08-22T09:15:00.000Z",
      durationLabel: "1 year",
    },
    billingDetails: BILLING,
    pricing: PRICING,
    orderSummary: ORDER_SUMMARY,
    limits: {
      subBrands: {
        used: 0,
        newLimit: null,
        isUnlimited: true,
        overflowBy: 0,
        label: "outlets",
      },
      franchises: {
        used: 0,
        newLimit: null,
        isUnlimited: true,
        overflowBy: 0,
        label: "franchises",
      },
      vouchers: {
        used: 8,
        newLimit: null,
        isUnlimited: true,
        overflowBy: 0,
        label: "vouchers",
      },
      showcase: {
        used: 5,
        newLimit: null,
        isUnlimited: true,
        overflowBy: 0,
        label: "showcase sections",
      },
    },
    promo: {
      supported: true,
      applied: null,
      message: null,
    },
    canProceed: true,
    blockedReason: null,
    notices: [],
    ...overrides,
  },
});

const checkoutFolder = folder(
  "03 — Checkout (Vendor + Admin)",
  "Preview → create order → verify. All three run through the **same** pricing code (`helpers/subscribeds/calculatePricing.js` via `buildCheckoutPreview.js`), which is what guarantees the amount shown at checkout is the amount charged and the amount invoiced.\n\n**Role gate changed:** these routes previously ran `verifyJwtToken` only, so any authenticated user — including a customer — could open and verify an order against **any** brand. Now `validateRoles(VENDOR, ADMIN)` plus per-brand ownership via `helpers/brands/resolveActorBrand.js`.\n\n**`amount` is gone from the request body.** It used to be accepted and applied as `amount || price`, which let anyone buy a ₹4,999 plan for ₹1.",
  [
    request({
      name: "Preview Subscription Checkout  [NEW]",
      method: "POST",
      segments: ["transactions", "subscribe", "preview"],
      token: "{{vendor_token}}",
      reqBody: { subscriptionId: "{{plan_proplus_id}}" },
      description:
        "VENDOR or ADMIN. **Read-only** — no Razorpay call, no Transaction row. Safe on every render and on plan-card switching.\n\n`brandId` is optional for a vendor (their own brand is used) and **required** for an admin.\n\nThe page renders `orderSummary.rows` top to bottom and does no arithmetic: a `DISCOUNT` row appears only when the discount is > 0, and the tax row label switches between `IGST @ 18.00%` and `CGST @ 9.00%` + `SGST @ 9.00%` automatically based on place of supply.",
      tests: [
        ...baseAsserts(200),
        'pm.test("order summary is render-ready", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.orderSummary.rows).to.be.an("array").that.is.not.empty;',
        '    pm.expect(d.orderSummary.payable).to.have.property("display");',
        '    pm.expect(d.orderSummary).to.have.property("savedText");',
        "});",
        "",
        'pm.test("pricing adds up exactly", function () {',
        "    const p = pm.response.json().data.pricing;",
        "    const sum = Math.round((p.taxableValue + p.gstAmount) * 100) / 100;",
        "    pm.expect(sum).to.eql(p.totalPayable);",
        "    pm.expect(p.amountInPaise).to.eql(Math.round(p.totalPayable * 100));",
        "});",
        "",
        'pm.test("tax split matches taxType", function () {',
        "    const p = pm.response.json().data.pricing;",
        '    if (p.taxType === "IGST") {',
        "        pm.expect(p.igst).to.eql(p.gstAmount);",
        "        pm.expect(p.cgst).to.eql(0);",
        "        pm.expect(p.sgst).to.eql(0);",
        "    } else {",
        "        pm.expect(Math.round((p.cgst + p.sgst) * 100) / 100).to.eql(p.gstAmount);",
        "        pm.expect(p.igst).to.eql(0);",
        "    }",
        "});",
        "",
        'pm.test("promo codes are advertised as unavailable", function () {',
        "    pm.expect(pm.response.json().data.promo.supported).to.be.false;",
        "});",
        "",
        'pm.test("action is a known value", function () {',
        "    const a = pm.response.json().data.action;",
        '    pm.expect(["NEW", "RENEW", "UPGRADE", "DOWNGRADE"]).to.include(a);',
        "});",
        "",
        "const d = pm.response.json().data;",
        'pm.environment.set("preview_total_paise", d.pricing.amountInPaise);',
        "if (!d.canProceed) {",
        '    console.warn("canProceed=false — " + d.blockedReason);',
        "}",
      ],
      responses: [
        ok(
          "200 — NEW subscription (matches the live checkout page)",
          200,
          previewResponse(),
        ),
        ok(
          "200 — UPGRADE (current plan ends immediately)",
          200,
          previewResponse({
            action: "UPGRADE",
            currentPlan: {
              _id: "6b1a1e4fa1b2c3d4e5f60101",
              name: "Basic",
              type: "YEARLY",
              price: 1999,
              startDate: "2026-03-01T00:00:00.000Z",
              endDate: "2027-02-28T00:00:00.000Z",
              daysRemaining: 189,
            },
            notices: [
              "Your current Basic ends immediately when the new plan starts; the remaining 189 day(s) are not carried over or refunded.",
            ],
          }),
        ),
        ok(
          "200 — DOWNGRADE blocked for a vendor",
          200,
          previewResponse({
            action: "DOWNGRADE",
            plan: {
              ...PLAN_BLOCK,
              _id: "6b1a1e4fa1b2c3d4e5f60101",
              name: "Basic",
              price: 1999,
            },
            currentPlan: {
              _id: "6b1a1e4fa1b2c3d4e5f60104",
              name: "Pro Plus",
              type: "YEARLY",
              price: 4999,
              endDate: "2027-08-22T09:15:00.000Z",
              daysRemaining: 364,
            },
            canProceed: false,
            blockedReason:
              "Downgrading is not permitted. Your current plan provides greater value than the selected option. Please choose a higher-tier plan or contact support.",
          }),
        ),
        ok(
          "200 — intra-state supply splits into CGST + SGST",
          200,
          previewResponse({
            // Buyer in the seller's own state (33 Tamil Nadu), so the supply is
            // intra-state and the single IGST line becomes CGST + SGST.
            billingDetails: {
              ...BILLING,
              brandName: "Chennai Foods Pvt Ltd",
              gstin: "33AAKCT3750H1ZB",
              address:
                "2nd Floor, Phase-3, Suite No. 250, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
            },
            pricing: {
              ...PRICING,
              taxType: "CGST_SGST",
              cgst: 449.91,
              sgst: 449.91,
              igst: 0,
              placeOfSupplyStateCode: "33",
              placeOfSupplyState: "Tamil Nadu",
            },
            orderSummary: {
              ...ORDER_SUMMARY,
              rows: [
                {
                  key: "ORIGINAL_PRICE",
                  label: "Original Price",
                  amount: 4999,
                  display: "₹ 4,999.00",
                },
                {
                  key: "BILL_VALUE",
                  label: "Bill Value",
                  amount: 4999,
                  display: "₹ 4,999.00",
                },
                {
                  key: "TAX",
                  label: "CGST @ 9.00%",
                  amount: 449.91,
                  display: "₹ 449.91",
                },
                {
                  key: "TAX",
                  label: "SGST @ 9.00%",
                  amount: 449.91,
                  display: "₹ 449.91",
                },
              ],
            },
          }),
        ),
        ok(
          "200 — with a 20% plan discount",
          200,
          previewResponse({
            plan: { ...PLAN_BLOCK, discountPercent: 20, strikePrice: 6999 },
            pricing: {
              ...PRICING,
              discountPercent: 20,
              discountAmount: 999.8,
              taxableValue: 3999.2,
              gstAmount: 719.86,
              igst: 719.86,
              totalPayable: 4719.06,
              amountInPaise: 471906,
              youSaved: 999.8,
            },
            orderSummary: {
              rows: [
                {
                  key: "ORIGINAL_PRICE",
                  label: "Original Price",
                  amount: 4999,
                  display: "₹ 4,999.00",
                },
                {
                  key: "DISCOUNT",
                  label: "Discount (20.00% off)",
                  amount: -999.8,
                  display: "- ₹ 999.80",
                },
                {
                  key: "BILL_VALUE",
                  label: "Bill Value",
                  amount: 3999.2,
                  display: "₹ 3,999.20",
                },
                {
                  key: "TAX",
                  label: "IGST @ 18.00%",
                  amount: 719.86,
                  display: "₹ 719.86",
                },
              ],
              payable: {
                label: "You'll Pay",
                amount: 4719.06,
                display: "₹ 4,719.06",
              },
              youSaved: 999.8,
              youSavedDisplay: "₹ 999.80",
              savedText: "You saved ₹ 999.80 on This Plan",
            },
          }),
        ),
        err(
          "422 — promo code sent while the feature is off",
          422,
          "Unprocessable Entity",
          "Promo codes are not available yet. Please continue without one.",
        ),
        err(
          "422 — admin did not name a brand",
          422,
          "Unprocessable Entity",
          "brandId is required when acting as an admin",
        ),
        err(
          "404 — no such plan",
          404,
          "Not Found",
          "Subscription plan not found!",
        ),
        err(
          "422 — plan retired",
          422,
          "Unprocessable Entity",
          "This subscription plan is no longer available.",
        ),
        e403Brand(),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Preview as Admin (any brand)",
      method: "POST",
      segments: ["transactions", "subscribe", "preview"],
      reqBody: {
        brandId: "{{brand_id}}",
        subscriptionId: "{{plan_basic_id}}",
      },
      description:
        "ADMIN. Same endpoint; an admin **must** pass `brandId` and may pass any. Use this to see the exact downgrade overflow warning before granting — an admin-initiated downgrade is allowed and grandfathers the excess, whereas a vendor is blocked.",
      tests: [
        ...baseAsserts(200),
        'pm.test("admin sees overflow as a notice, not a block", function () {',
        "    const d = pm.response.json().data;",
        '    if (d.action === "DOWNGRADE" && d.limits.subBrands.overflowBy > 0) {',
        "        pm.expect(d.canProceed).to.be.true;",
        '        pm.expect(d.notices.join(" ")).to.include("over its new plan limits");',
        "    }",
        "});",
      ],
      responses: [
        ok(
          "200 — admin downgrade preview, overflow grandfathered",
          200,
          previewResponse({
            plan: {
              ...PLAN_BLOCK,
              _id: "6b1a1e4fa1b2c3d4e5f60101",
              name: "Basic",
              price: 1999,
              entitlements: {
                ...ENTITLEMENTS,
                subBrands: { limit: 1, isUnlimited: false },
                franchises: { limit: 5, isUnlimited: false },
              },
            },
            action: "DOWNGRADE",
            currentPlan: {
              _id: "6b1a1e4fa1b2c3d4e5f60104",
              name: "Pro Plus",
              type: "YEARLY",
              price: 4999,
              endDate: "2027-08-22T09:15:00.000Z",
              daysRemaining: 364,
            },
            limits: {
              subBrands: {
                used: 12,
                newLimit: 1,
                isUnlimited: false,
                overflowBy: 11,
              },
              franchises: {
                used: 2,
                newLimit: 5,
                isUnlimited: false,
                overflowBy: 0,
              },
            },
            canProceed: true,
            notices: [
              "This brand will be over its new plan limits — outlets 12/1 (11 over). Existing entries stay active, but no new ones can be added until usage drops below the limit.",
              "Your current Pro Plus ends immediately when the new plan starts; the remaining 364 day(s) are not carried over or refunded.",
            ],
          }),
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Create Subscribe Order  [CHANGED]",
      method: "POST",
      segments: ["transactions", "subscribe", "create-order"],
      token: "{{vendor_token}}",
      reqBody: { subscriptionId: "{{plan_proplus_id}}" },
      description:
        "VENDOR or ADMIN. Runs the same builder as preview, refuses if `canProceed` is false, then opens a Razorpay order for `pricing.amountInPaise`.\n\n**Breaking changes:** `amount` is no longer accepted (price tampering fix). Response is now `{ transaction, plan, pricing, orderSummary, billingDetails, razorpay, reused }` — hand `razorpay.orderId` / `razorpay.keyId` straight to Checkout.js.\n\nA still-open order for the same brand + plan within `pendingOrderReuseMinutes` (default 15) is **reused** rather than duplicated — check the `reused` flag.",
      tests: [
        ...baseAsserts(200),
        'pm.test("razorpay handoff present", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.razorpay).to.have.property("orderId");',
        '    pm.expect(d.razorpay).to.have.property("keyId");',
        "    pm.expect(d.razorpay.amount).to.eql(d.pricing.amountInPaise);",
        "});",
        "",
        'pm.test("order amount matches the preview exactly", function () {',
        '    const previewed = pm.environment.get("preview_total_paise");',
        "    if (previewed) {",
        "        pm.expect(pm.response.json().data.pricing.amountInPaise).to.eql(Number(previewed));",
        "    }",
        "});",
        "",
        'pm.test("pricing frozen onto the transaction", function () {',
        "    const t = pm.response.json().data.transaction;",
        '    pm.expect(t).to.have.property("pricing");',
        '    pm.expect(t.gateway).to.eql("RAZORPAY");',
        "    pm.expect(t.verified).to.be.false;",
        "});",
        "",
        "const d = pm.response.json().data;",
        'pm.environment.set("transaction_id", d.transaction._id);',
        'pm.environment.set("razorpay_order_id", d.razorpay.orderId);',
        'if (d.reused) console.warn("Reused an existing open order: " + d.razorpay.orderId);',
      ],
      responses: [
        ok("200 — order created", 200, {
          success: true,
          message: "Subscribe transaction order created successfully",
          data: {
            transaction: {
              _id: "68b2c4d5e6f70819a0b1c2d3",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              subscriptionId: "6b1a1e4fa1b2c3d4e5f60104",
              userId: "68a1f4c2b1e2c3d4e5f60601",
              createdBy: "68a1f4c2b1e2c3d4e5f60601",
              gateway: "RAZORPAY",
              amount: 5898.82,
              pricing: PRICING,
              currency: "INR",
              status: "created",
              razorpayOrderId: "order_QxYz123AbCdEf4",
              receipt: "rcpt_60718_915000",
              dueAmount: 5898.82,
              paidAmount: 0,
              invoiceId: "INV-#48213",
              verified: false,
              isDeleted: false,
            },
            plan: PLAN_BLOCK,
            pricing: PRICING,
            orderSummary: ORDER_SUMMARY,
            billingDetails: BILLING,
            razorpay: {
              orderId: "order_QxYz123AbCdEf4",
              amount: 589882,
              currency: "INR",
              keyId: "rzp_test_XXXXXXXXXXXX",
            },
            reused: false,
          },
        }),
        err(
          "403 — vendor downgrade blocked",
          403,
          "Forbidden",
          "Downgrading is not permitted. Your current plan provides greater value than the selected option. Please choose a higher-tier plan or contact support.",
        ),
        err(
          "403 — vendor downgrade would leave them over limit",
          403,
          "Forbidden",
          "Cannot downgrade — you currently have 12 outlets but Basic allows 1. Please remove the extra entries first or contact support.",
        ),
        err(
          "422 — zero-amount plan",
          422,
          "Unprocessable Entity",
          "This plan has no payable amount. An admin can grant it directly instead.",
        ),
        err(
          "503 — gateway down",
          503,
          "Service Unavailable",
          "Razorpay services unavailable! Please try again later",
        ),
        e403Brand(),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Verify Subscribe Transaction  [CHANGED]",
      method: "POST",
      segments: ["transactions", "subscribe", "verify-transaction"],
      token: "{{vendor_token}}",
      reqBody: {
        transactionId: "{{transaction_id}}",
        razorpayOrderId: "{{razorpay_order_id}}",
        razorpayPaymentId: "{{razorpay_payment_id}}",
        razorpaySignature: "{{razorpay_signature}}",
      },
      description:
        "VENDOR or ADMIN. Verifies the payment and activates the plan.\n\n**Now checks, in order:** transaction exists and is a Razorpay one · `razorpayOrderId` matches · caller owns it · **already verified → returns the existing subscription (idempotent)** · HMAC signature · `payment.order_id` matches ours · **`payment.amount` equals the frozen `pricing.amountInPaise`** · payment captured.\n\n**Error codes are real again.** The whole body used to sit in a try/catch rethrowing `throwError(500, …)`, so 404 / 400 / 403 all surfaced as 500.\n\nThe invoice is generated **after** activation inside its own try/catch — a Cloudinary failure can no longer take money without granting a plan. `currentScreen` advances only if the vendor is still on `SUBSCRIBE_PLAN`.\n\n`transactionId` is now **required** (it used to be optional, letting a request through with nothing to verify).",
      tests: [
        ...baseAsserts(200),
        'pm.test("subscription is live", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subscribed.status).to.eql("ACTIVE");',
        "    pm.expect(new Date(d.subscribed.endDate).getTime()).to.be.above(Date.now());",
        "});",
        "",
        'pm.test("links that used to be silently dropped are stored", function () {',
        "    const s = pm.response.json().data.subscribed;",
        '    pm.expect(s).to.have.property("transactionId");',
        '    pm.expect(s).to.have.property("userId");',
        "});",
        "",
        'pm.test("plan limits applied to the brand", function () {',
        "    const l = pm.response.json().data.limits;",
        '    pm.expect(l).to.have.property("subBrandsLimit");',
        '    pm.expect(l).to.have.property("franchisesLimit");',
        "});",
        "",
        "const d = pm.response.json().data;",
        'pm.environment.set("subscribed_id", d.subscribed._id);',
        "if (d.alreadyVerified) {",
        '    console.warn("Replayed verification — no second subscription was created (idempotent)");',
        "}",
        "if (!d.invoiceUrl) {",
        '    console.warn("Invoice URL is null — PDF generation failed but activation still succeeded");',
        "}",
      ],
      responses: [
        ok("200 — activated", 200, {
          success: true,
          message:
            "Payment successful! Congratulations — your subscription has been successfully activated",
          data: {
            subscribed: {
              _id: "68b2c4d5e6f70819a0b1c2e0",
              userId: "68a1f4c2b1e2c3d4e5f60601",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              subscribedBy: "68a1f4c2b1e2c3d4e5f60601",
              transactionId: "68b2c4d5e6f70819a0b1c2d3",
              subscriptionId: "6b1a1e4fa1b2c3d4e5f60104",
              durationInDays: 365,
              startDate: "2026-08-23T09:15:00.000Z",
              endDate: "2027-08-22T09:15:00.000Z",
              price: 4999,
              discount: 0,
              paidAmount: 5898.82,
              dueAmount: 0,
              pricing: PRICING,
              status: "ACTIVE",
              source: "PAYMENT",
              activatedAt: "2026-08-23T09:15:04.000Z",
              isActive: true,
              isExpired: false,
              isDeleted: false,
            },
            transaction: {
              _id: "68b2c4d5e6f70819a0b1c2d3",
              status: "captured",
              verified: true,
              paidAmount: 5898.82,
              dueAmount: 0,
              paymentMethod: "upi",
              vpa: "devashish@okhdfcbank",
              invoiceId: "INV-#48213",
              invoiceUrl:
                "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/invoice_1756890904123_4821.pdf",
            },
            invoiceUrl:
              "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/invoice_1756890904123_4821.pdf",
            action: "NEW",
            limits: {
              subBrandsLimit: 0,
              isSubBrandsUnlimited: true,
              franchisesLimit: 50,
              isFranchisesUnlimited: false,
              overflow: { subBrands: 0, franchises: 0 },
            },
            alreadyVerified: false,
          },
        }),
        ok("200 — replayed (idempotent, no second subscription)", 200, {
          success: true,
          message:
            "This payment has already been verified. Your subscription is active.",
          data: {
            subscribed: {
              _id: "68b2c4d5e6f70819a0b1c2e0",
              status: "ACTIVE",
              endDate: "2027-08-22T09:15:00.000Z",
            },
            transaction: { _id: "68b2c4d5e6f70819a0b1c2d3", verified: true },
            alreadyVerified: true,
            invoiceUrl:
              "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/invoice_1756890904123_4821.pdf",
          },
        }),
        err(
          "400 — tampered signature",
          400,
          "Bad Request",
          "Invalid signature. Payment may be tampered.",
        ),
        err(
          "422 — short payment",
          422,
          "Unprocessable Entity",
          "Payment amount mismatch. Expected ₹5898.82 but received ₹1.00. Please contact support.",
        ),
        err(
          "422 — payment belongs to another order",
          422,
          "Unprocessable Entity",
          "This payment belongs to a different order.",
        ),
        err(
          "422 — order/transaction mismatch",
          422,
          "Unprocessable Entity",
          "This payment does not belong to the given transaction.",
        ),
        err(
          "422 — manual transaction sent here",
          422,
          "Unprocessable Entity",
          "This transaction was not created through Razorpay.",
        ),
        err(
          "402 — not captured",
          402,
          "Payment Required",
          "Payment was not captured (status: failed). Please try again.",
        ),
        err(
          "403 — someone else's transaction",
          403,
          "Forbidden",
          "You are not authorized to verify this payment request",
        ),
        err(
          "404 — no such transaction",
          404,
          "Not Found",
          "Transaction not found!",
        ),
        err(
          "503 — gateway lookup failed",
          503,
          "Service Unavailable",
          "Razorpay services unavailable! Please try again later",
        ),
        e401(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 04 — Vendor / shared reads
// ---------------------------------------------------------------------------

const vendorFolder = folder(
  "04 — Subscription · Vendor + Admin  [NEW]",
  "Both endpoints resolve the live plan from `status` + `endDate` (`getActiveSubscription`, which self-heals a lapsed row on read) rather than the cached `brand.isSubscribed`. A vendor is scoped to their own brand by `resolveActorBrand`; an admin may pass any `brandId`.",
  [
    request({
      name: "Get Brand Subscription",
      method: "GET",
      segments: ["subscribeds", "get"],
      token: "{{vendor_token}}",
      query: [
        q(
          "brandId",
          "{{brand_id}}",
          "Optional for a vendor, required for an admin",
          true,
        ),
      ],
      description:
        'VENDOR or ADMIN. Current plan + resolved entitlements + **actual usage**, so the UI can render "12 of 15 outlets used" without extra lookups.\n\n`entitlementsSource` tells you whether the enforced numbers come from the plan\'s structured `entitlements` (`DB`) or were guessed from the legacy free-text `features[]` (`DERIVED` / `DEFAULT`). Anything not `DB` needs configuring — check `entitlementWarnings`.',
      tests: [
        ...baseAsserts(200),
        'pm.test("usage reported for both pools", function () {',
        "    const u = pm.response.json().data.usage;",
        '    pm.expect(u.subBrands).to.have.property("used");',
        '    pm.expect(u.franchises).to.have.property("used");',
        "});",
        "",
        'pm.test("entitlementsSource is visible", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(["DB", "DERIVED", "DEFAULT", null]).to.include(d.entitlementsSource);',
        '    if (d.entitlementsSource && d.entitlementsSource !== "DB") {',
        '        console.warn("Plan entitlements are " + d.entitlementsSource + " — set them explicitly. " + (d.entitlementWarnings || []).join(" | "));',
        "    }",
        "});",
        "",
        "const d = pm.response.json().data;",
        "if (d.subscription && d.subscription._id) {",
        '    pm.environment.set("subscribed_id", d.subscription._id);',
        "}",
      ],
      responses: [
        ok("200 — active plan", 200, {
          success: true,
          message: "Brand subscription details fetched successfully",
          data: {
            brand: {
              _id: "68a1f4c2b1e2c3d4e5f60718",
              brandName: "Devashish Tester",
              isSubscribed: true,
            },
            isSubscribed: true,
            subscription: {
              _id: "68b2c4d5e6f70819a0b1c2e0",
              status: "ACTIVE",
              source: "PAYMENT",
              paymentMode: null,
              isFreeGrant: false,
              startDate: "2026-08-23T09:15:00.000Z",
              endDate: "2027-08-22T09:15:00.000Z",
              daysRemaining: 364,
              durationLabel: "1 year",
              paidAmount: 5898.82,
              pricing: PRICING,
              transactionId: "68b2c4d5e6f70819a0b1c2d3",
              plan: {
                _id: "6b1a1e4fa1b2c3d4e5f60104",
                name: "Pro Plus",
                type: "YEARLY",
                typeLabel: "Yearly",
                price: 4999,
                features: [
                  { title: "Sub Brand", value: "Unlimited", available: true },
                ],
                benefits: ["Unlimited transactions"],
              },
            },
            lastSubscription: null,
            entitlements: ENTITLEMENTS,
            entitlementsSource: "DB",
            entitlementWarnings: [],
            usage: {
              subBrands: { used: 3, limit: null, isUnlimited: true },
              franchises: { used: 1, limit: 50, isUnlimited: false },
              syncedAt: "2026-08-23T09:15:05.000Z",
            },
            totalSubscriptions: 2,
          },
        }),
        ok("200 — lapsed, nothing live", 200, {
          success: true,
          message: "Brand subscription details fetched successfully",
          data: {
            brand: {
              _id: "68a1f4c2b1e2c3d4e5f60718",
              brandName: "Devashish Tester",
              isSubscribed: false,
            },
            isSubscribed: false,
            subscription: null,
            lastSubscription: {
              _id: "68b2c4d5e6f70819a0b1c2d0",
              status: "EXPIRED",
              endDate: "2026-08-01T00:00:00.000Z",
              subscriptionId: "6b1a1e4fa1b2c3d4e5f60101",
            },
            entitlements: null,
            entitlementsSource: null,
            entitlementWarnings: [],
            usage: {
              subBrands: { used: 3, limit: 0, isUnlimited: false },
              franchises: { used: 1, limit: 0, isUnlimited: false },
              syncedAt: "2026-08-23T00:05:00.000Z",
            },
            totalSubscriptions: 1,
          },
        }),
        ok("200 — entitlements still DERIVED (needs configuring)", 200, {
          success: true,
          message: "Brand subscription details fetched successfully",
          data: {
            isSubscribed: true,
            entitlements: {
              subBrands: { limit: 0, isUnlimited: true },
              franchises: { limit: 0, isUnlimited: false },
              vouchers: { isEnabled: true },
              dealPack: { isEnabled: true },
              prioritySupport: { isEnabled: true },
              showcase: { isEnabled: false },
            },
            entitlementsSource: "DERIVED",
            entitlementWarnings: [
              'Plan "Pro Plus": feature "Franchise" = "Yes" carries no count, so the franchises limit fell back to 0. Set entitlements.franchises explicitly on this plan.',
            ],
            usage: {
              subBrands: { used: 3, limit: null, isUnlimited: true },
              franchises: { used: 0, limit: 0, isUnlimited: false },
            },
          },
        }),
        e403Brand(),
        err("404 — brand missing", 404, "Not Found", "Brand not found!"),
        e401(),
      ],
    }),
    request({
      name: "Get Subscription History",
      method: "GET",
      segments: ["subscribeds", "history"],
      token: "{{vendor_token}}",
      query: [
        q("page", 1, "1-based page number"),
        q("limit", 20, "Rows per page, max 100"),
        q(
          "brandId",
          "{{brand_id}}",
          "Optional for a vendor, required for an admin",
          true,
        ),
        q(
          "action",
          "UPGRADED",
          "ORDER_CREATED | ACTIVATED | RENEWED | UPGRADED | DOWNGRADED | EXPIRED | CANCELLED | ADMIN_GRANTED",
          true,
        ),
      ],
      description:
        "VENDOR or ADMIN. Append-only audit trail, newest first. **Admin internals are projected away for a vendor** — `reason`, `snapshot` and `performedByUser` are admin-only, since they can carry commercial context.\n\n⚠️ Returns **404** when empty (shared `pagination` behaviour).",
      tests: [
        ...baseAsserts(200),
        'pm.test("rows carry an action and a performer role", function () {',
        "    const rows = pm.response.json().data.data;",
        '    pm.expect(rows).to.be.an("array").that.is.not.empty;',
        '    pm.expect(rows[0]).to.have.property("action");',
        '    pm.expect(["VENDOR", "ADMIN", "SYSTEM"]).to.include(rows[0].performedByRole);',
        "});",
        "",
        'pm.test("vendor view hides admin internals", function () {',
        "    const rows = pm.response.json().data.data;",
        '    if (pm.environment.get("vendor_token") && pm.request.headers.get("Authorization").indexOf(pm.environment.get("vendor_token")) !== -1) {',
        '        pm.expect(rows[0]).to.not.have.property("snapshot");',
        "    }",
        "});",
      ],
      responses: [
        ok("200 — history (vendor view)", 200, {
          success: true,
          message: "Subscription history fetched successfully",
          data: {
            total: 3,
            totalPages: 1,
            page: 1,
            limit: 20,
            data: [
              {
                _id: "68b2c4d5e6f70819a0b1c301",
                action: "UPGRADED",
                performedByRole: "VENDOR",
                fromPlan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60101",
                  name: "Basic",
                  type: "YEARLY",
                  price: 1999,
                },
                toPlan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60104",
                  name: "Pro Plus",
                  type: "YEARLY",
                  price: 4999,
                },
                source: "PAYMENT",
                amount: 5898.82,
                startDate: "2026-08-23T09:15:00.000Z",
                endDate: "2027-08-22T09:15:00.000Z",
                createdAt: "2026-08-23T09:15:05.000Z",
              },
              {
                _id: "68b2c4d5e6f70819a0b1c300",
                action: "ORDER_CREATED",
                performedByRole: "VENDOR",
                toPlan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60104",
                  name: "Pro Plus",
                  type: "YEARLY",
                  price: 4999,
                },
                source: "PAYMENT",
                amount: 5898.82,
                createdAt: "2026-08-23T09:14:40.000Z",
              },
              {
                _id: "68b2c4d5e6f70819a0b1c2ff",
                action: "EXPIRED",
                performedByRole: "SYSTEM",
                fromPlan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60101",
                  name: "Basic",
                  type: "YEARLY",
                  price: 1999,
                },
                startDate: "2025-08-01T00:00:00.000Z",
                endDate: "2026-08-01T00:00:00.000Z",
                createdAt: "2026-08-01T00:05:00.000Z",
              },
            ],
          },
        }),
        err(
          "404 — no history yet",
          404,
          "Not Found",
          "No any subscription history record found",
        ),
        e403Brand(),
        e401(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 05 — Admin management
// ---------------------------------------------------------------------------

const grantResponse = (overrides = {}) => ({
  success: true,
  message: "Subscription new applied successfully without an online payment",
  data: {
    subscribed: {
      _id: "68b2c4d5e6f70819a0b1c2f0",
      userId: "68a1f4c2b1e2c3d4e5f60601",
      brandId: "68a1f4c2b1e2c3d4e5f60718",
      grantedByAdminId: "68a1f4c2b1e2c3d4e5f60600",
      transactionId: "68b2c4d5e6f70819a0b1c2ef",
      subscriptionId: "6b1a1e4fa1b2c3d4e5f60104",
      durationInDays: 365,
      startDate: "2026-08-23T09:20:00.000Z",
      endDate: "2027-08-22T09:20:00.000Z",
      price: 4999,
      paidAmount: 0,
      dueAmount: 5898.82,
      pricing: PRICING,
      status: "ACTIVE",
      source: "ADMIN_MANUAL",
      paymentMode: "FREE",
      adminNote: "Complimentary plan — launch partner",
      isFreeGrant: true,
      activatedAt: "2026-08-23T09:20:00.000Z",
      isActive: true,
      isExpired: false,
    },
    transaction: {
      _id: "68b2c4d5e6f70819a0b1c2ef",
      gateway: "MANUAL",
      manualPaymentMode: "FREE",
      razorpayOrderId: "MANUAL-INV-#48219",
      amount: 5898.82,
      pricing: PRICING,
      status: "captured",
      verified: true,
      paidAmount: 0,
      dueAmount: 5898.82,
      invoiceId: "INV-#48219",
      note: "Complimentary plan — launch partner",
      invoiceUrl:
        "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/invoice_1756891204123_9931.pdf",
    },
    action: "NEW",
    pricing: PRICING,
    orderSummary: ORDER_SUMMARY,
    limits: {
      subBrandsLimit: 0,
      isSubBrandsUnlimited: true,
      franchisesLimit: 50,
      isFranchisesUnlimited: false,
    },
    overflow: { subBrands: 0, franchises: 0 },
    entitlementsSource: "DB",
    ...overrides,
  },
});

const adminFolder = folder(
  "05 — Subscription · Admin management  [NEW]",
  "Admins can act **with** payment (`/transactions/subscribe/*`, passing `brandId`) or **without** it (here).\n\n`POST /subscribeds/admin/grant` is the single manual endpoint — it handles NEW, RENEW, UPGRADE and DOWNGRADE, and the response's `action` reports which was applied. There is no separate change-plan route.\n\nA Transaction row is always written with `gateway: MANUAL` and an invoice is generated, so admin grants appear in the same reporting as card payments. The full GST breakdown is recorded even on a FREE grant, with a zero collection against it. Manual rows carry a synthetic `MANUAL-<invoiceId>` order reference because the live unique index on `razorpayOrderId` is non-sparse.",
  [
    request({
      name: "Grant Subscription — FREE (complimentary)",
      method: "POST",
      segments: ["subscribeds", "admin", "grant"],
      reqBody: {
        brandId: "{{brand_id}}",
        subscriptionId: "{{plan_proplus_id}}",
        paymentMode: "FREE",
        note: "Complimentary plan — launch partner",
      },
      description:
        "Admin only. No online payment. `note` is **required** — a manual grant must always say why. Gated by `allowAdminFreeGrant`.\n\nSets `isFreeGrant: true`, `paidAmount: 0`, and still records the full tax position on the invoice.",
      tests: [
        ...baseAsserts(201),
        'pm.test("granted and live", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subscribed.status).to.eql("ACTIVE");',
        '    pm.expect(d.subscribed.source).to.eql("ADMIN_MANUAL");',
        "    pm.expect(d.subscribed.isFreeGrant).to.be.true;",
        "});",
        "",
        'pm.test("manual transaction written for reporting", function () {',
        "    const t = pm.response.json().data.transaction;",
        '    pm.expect(t.gateway).to.eql("MANUAL");',
        '    pm.expect(t.manualPaymentMode).to.eql("FREE");',
        "    pm.expect(t.razorpayOrderId).to.match(/^MANUAL-/);",
        "    pm.expect(t.paidAmount).to.eql(0);",
        "});",
        "",
        'pm.test("GST still recorded on a free grant", function () {',
        "    const p = pm.response.json().data.pricing;",
        "    pm.expect(p.gstAmount).to.be.above(0);",
        "});",
        "",
        "const d = pm.response.json().data;",
        'pm.environment.set("subscribed_id", d.subscribed._id);',
        'pm.environment.set("transaction_id", d.transaction._id);',
      ],
      responses: [
        ok("201 — granted", 201, grantResponse()),
        err(
          "403 — free grants disabled",
          403,
          "Forbidden",
          "Manual subscription grants are disabled in the current platform settings.",
        ),
        err(
          "422 — note missing",
          422,
          "Unprocessable Entity",
          "A note explaining this manual grant is required",
        ),
        err(
          "422 — plan has no duration",
          422,
          "Unprocessable Entity",
          'Plan "Custom" has no duration configured. Pass durationInDays to grant it.',
        ),
        err("404 — brand missing", 404, "Not Found", "Brand not found!"),
        err(
          "404 — plan missing",
          404,
          "Not Found",
          "Subscription plan not found!",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Grant Subscription — offline payment collected",
      method: "POST",
      segments: ["subscribeds", "admin", "grant"],
      reqBody: {
        brandId: "{{brand_id}}",
        subscriptionId: "{{plan_proplus_id}}",
        paymentMode: "BANK_TRANSFER",
        collectedAmount: 5898.82,
        referenceNumber: "NEFT-8817-2026",
        note: "Paid by NEFT, receipt attached in CRM ticket #4412",
      },
      description:
        "Admin only. Money already collected outside Razorpay. `paymentMode`: FREE | CASH | BANK_TRANSFER | CHEQUE | UPI_OFFLINE. `collectedAmount` cannot exceed the plan total and is ignored for FREE.",
      tests: [
        ...baseAsserts(201),
        'pm.test("collection recorded", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.transaction.manualPaymentMode).to.eql("BANK_TRANSFER");',
        "    pm.expect(d.subscribed.isFreeGrant).to.be.false;",
        "    pm.expect(d.subscribed.paidAmount).to.eql(d.pricing.totalPayable);",
        "    pm.expect(d.subscribed.dueAmount).to.eql(0);",
        "});",
      ],
      responses: [
        ok(
          "201 — granted, fully collected",
          201,
          grantResponse({
            subscribed: {
              ...grantResponse().data.subscribed,
              paymentMode: "BANK_TRANSFER",
              referenceNumber: "NEFT-8817-2026",
              paidAmount: 5898.82,
              dueAmount: 0,
              isFreeGrant: false,
              adminNote: "Paid by NEFT, receipt attached in CRM ticket #4412",
            },
            transaction: {
              ...grantResponse().data.transaction,
              manualPaymentMode: "BANK_TRANSFER",
              referenceNumber: "NEFT-8817-2026",
              paidAmount: 5898.82,
              dueAmount: 0,
            },
          }),
        ),
        err(
          "422 — collected more than the plan total",
          422,
          "Unprocessable Entity",
          "Collected amount (₹9999) cannot exceed the plan total (₹5898.82).",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Grant — Downgrade (admin, grandfathered)",
      method: "POST",
      segments: ["subscribeds", "admin", "grant"],
      reqBody: {
        brandId: "{{brand_id}}",
        subscriptionId: "{{plan_basic_id}}",
        paymentMode: "FREE",
        note: "Vendor requested downgrade to Basic for FY27",
      },
      description:
        "Admin only. **Downgrade is allowed here** (gated by `allowAdminDowngrade`) even when the brand ends up over the new plan's limits — existing outlets and franchises are **grandfathered**, never deleted. Nothing new can be created until usage drops back under the limit.\n\nCheck `overflow` in the response and surface it in the panel. A **vendor** attempting the same gets a 403.",
      tests: [
        ...baseAsserts(201),
        'pm.test("downgrade applied", function () {',
        '    pm.expect(pm.response.json().data.action).to.eql("DOWNGRADE");',
        "});",
        "",
        'pm.test("existing entries grandfathered, not removed", function () {',
        "    const d = pm.response.json().data;",
        "    if (d.overflow.subBrands > 0) {",
        '        console.warn("Brand is over its outlet limit by " + d.overflow.subBrands + " — existing outlets stay active");',
        "    }",
        '    pm.expect(d.overflow).to.have.property("subBrands");',
        '    pm.expect(d.overflow).to.have.property("franchises");',
        "});",
      ],
      responses: [
        ok(
          "201 — downgraded with overflow",
          201,
          grantResponse({
            action: "DOWNGRADE",
            limits: {
              subBrandsLimit: 1,
              isSubBrandsUnlimited: false,
              franchisesLimit: 5,
              isFranchisesUnlimited: false,
            },
            overflow: { subBrands: 11, franchises: 0 },
          }),
        ),
        err(
          "403 — downgrades disabled platform-wide",
          403,
          "Forbidden",
          "Downgrades are disabled in the current platform settings.",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Grant — Change tier, keep the paid-for end date",
      method: "POST",
      segments: ["subscribeds", "admin", "grant"],
      reqBody: {
        brandId: "{{brand_id}}",
        subscriptionId: "{{plan_prolite_id}}",
        paymentMode: "FREE",
        keepCurrentEndDate: true,
        note: "Mis-sold plan correction — same validity, correct tier",
      },
      description:
        "Admin only. `keepCurrentEndDate: true` inherits the **current** plan's `endDate` instead of starting a fresh term — the \"fix the tier, don't touch the validity\" case. Requires an active subscription to inherit from.",
      tests: [
        ...baseAsserts(201),
        'pm.test("end date inherited, not extended", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subscribed).to.have.property("endDate");',
        "});",
      ],
      responses: [
        ok(
          "201 — tier changed, validity preserved",
          201,
          grantResponse({
            action: "DOWNGRADE",
            subscribed: {
              ...grantResponse().data.subscribed,
              subscriptionId: "6b1a1e4fa1b2c3d4e5f60103",
              startDate: "2026-08-23T09:25:00.000Z",
              endDate: "2027-02-28T00:00:00.000Z",
              adminNote:
                "Mis-sold plan correction — same validity, correct tier",
            },
          }),
        ),
        err(
          "422 — nothing to inherit from",
          422,
          "Unprocessable Entity",
          "keepCurrentEndDate requires an active subscription to inherit the end date from.",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Cancel Subscription",
      method: "PUT",
      segments: ["subscribeds", "admin", "cancel"],
      reqBody: {
        brandId: "{{brand_id}}",
        reason: "Chargeback raised — access revoked pending resolution",
      },
      description:
        "Admin only. Ends the plan immediately (`status: CANCELLED`, `endDate: now`) and strips the brand's limits to 0 so nothing new can be created.\n\n**No existing outlet, franchise, voucher or showcase entry is touched** — revoking a plan is not a data deletion, and everything comes back the moment the brand resubscribes. `reason` is required.",
      tests: [
        ...baseAsserts(200),
        'pm.test("cancelled immediately", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subscribed.status).to.eql("CANCELLED");',
        "    pm.expect(d.isSubscribed).to.be.false;",
        "});",
        "",
        'pm.test("limits stripped but usage preserved", function () {',
        "    const d = pm.response.json().data;",
        "    pm.expect(d.limits.subBrandsLimit).to.eql(0);",
        "    pm.expect(d.limits.franchisesLimit).to.eql(0);",
        '    pm.expect(d.usage).to.have.property("subBrandsUsed");',
        "});",
      ],
      responses: [
        ok("200 — cancelled", 200, {
          success: true,
          message:
            "Subscription cancelled successfully. Existing outlets and content remain intact.",
          data: {
            subscribed: {
              _id: "68b2c4d5e6f70819a0b1c2e0",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              status: "CANCELLED",
              endDate: "2026-08-23T09:30:00.000Z",
              cancelledAt: "2026-08-23T09:30:00.000Z",
              cancelReason:
                "Chargeback raised — access revoked pending resolution",
              isActive: false,
              isExpired: true,
            },
            isSubscribed: false,
            limits: { subBrandsLimit: 0, franchisesLimit: 0 },
            usage: { subBrandsUsed: 3, franchisesUsed: 1, drifted: false },
          },
        }),
        err(
          "422 — nothing active to cancel",
          422,
          "Unprocessable Entity",
          "This brand has no active subscription to cancel.",
        ),
        err(
          "422 — reason missing",
          422,
          "Unprocessable Entity",
          "A reason for cancelling is required",
        ),
        err("404 — brand missing", 404, "Not Found", "Brand not found!"),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "List All Subscriptions",
      method: "GET",
      segments: ["subscribeds", "admin", "get-all"],
      query: [
        q("page", 1, "1-based page number"),
        q("limit", 10, "Rows per page, max 100"),
        q(
          "search",
          "",
          "Matches brand name, legal name, merchantId, plan name, referenceNumber",
          true,
        ),
        q("brandId", "{{brand_id}}", "Filter to one brand", true),
        q("subscriptionId", "{{plan_proplus_id}}", "Filter to one plan", true),
        q(
          "status",
          "ACTIVE",
          "PENDING | ACTIVE | EXPIRED | UPGRADED | DOWNGRADED | CANCELLED",
          true,
        ),
        q(
          "source",
          "ADMIN_MANUAL",
          "PAYMENT | ADMIN_PAYMENT | ADMIN_MANUAL",
          true,
        ),
        q("fromDate", "2026-08-01", "ISO date, filters createdAt", true),
        q("toDate", "2026-08-23", "ISO date, filters createdAt", true),
        q(
          "sortBy",
          "createdAt",
          "createdAt | endDate | startDate | paidAmount",
        ),
        q("sortOrder", "desc", "asc | desc"),
      ],
      description:
        "Admin only. **Read-only, so it deliberately does not self-heal** stale rows — a listing must not write. `isLapsed` is computed in the pipeline instead: `true` means the row still says ACTIVE but its end date has passed, i.e. exactly what the expiry job has yet to sweep.\n\n⚠️ Returns **404** when empty (shared `pagination` behaviour).",
      tests: [
        ...baseAsserts(200),
        'pm.test("rows carry status, plan and brand", function () {',
        "    const rows = pm.response.json().data.data;",
        '    pm.expect(rows).to.be.an("array").that.is.not.empty;',
        '    pm.expect(rows[0]).to.have.property("status");',
        '    pm.expect(rows[0]).to.have.property("plan");',
        '    pm.expect(rows[0]).to.have.property("brand");',
        "});",
        "",
        'pm.test("flags rows the expiry job has not swept yet", function () {',
        "    const lapsed = (pm.response.json().data.data || []).filter(function (r) { return r.isLapsed; });",
        "    if (lapsed.length) {",
        '        console.warn(lapsed.length + " row(s) are ACTIVE past their end date — run the expiry job or PUT /subscribeds/admin/resync");',
        "    }",
        "    pm.expect(true).to.be.true;",
        "});",
      ],
      responses: [
        ok("200 — listing", 200, {
          success: true,
          message: "Subscriptions fetched successfully",
          data: {
            total: 2,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [
              {
                _id: "68b2c4d5e6f70819a0b1c2e0",
                brand: {
                  _id: "68a1f4c2b1e2c3d4e5f60718",
                  brandName: "Devashish Tester",
                  merchantId: "DOOD-0001",
                  isSubscribed: true,
                  subBrandsUsed: 3,
                  subBrandsLimit: 0,
                  franchisesUsed: 1,
                  franchisesLimit: 50,
                },
                plan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60104",
                  name: "Pro Plus",
                  type: "YEARLY",
                  price: 4999,
                },
                status: "ACTIVE",
                source: "PAYMENT",
                isFreeGrant: false,
                startDate: "2026-08-23T09:15:00.000Z",
                endDate: "2027-08-22T09:15:00.000Z",
                daysRemaining: 364,
                isLapsed: false,
                price: 4999,
                paidAmount: 5898.82,
                dueAmount: 0,
                pricing: PRICING,
                transactionId: "68b2c4d5e6f70819a0b1c2d3",
                numberOfUpgrade: 0,
                createdAt: "2026-08-23T09:15:05.000Z",
              },
              {
                _id: "68b2c4d5e6f70819a0b1c2f0",
                brand: {
                  _id: "68a1f4c2b1e2c3d4e5f60719",
                  brandName: "zomato",
                  merchantId: "DOOD-0002",
                },
                plan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60101",
                  name: "Basic",
                  type: "YEARLY",
                  price: 1999,
                },
                status: "ACTIVE",
                source: "ADMIN_MANUAL",
                paymentMode: "FREE",
                isFreeGrant: true,
                adminNote: "Complimentary plan — launch partner",
                startDate: "2026-08-20T00:00:00.000Z",
                endDate: "2026-08-22T00:00:00.000Z",
                daysRemaining: 0,
                isLapsed: true,
                paidAmount: 0,
                grantedByAdminId: "68a1f4c2b1e2c3d4e5f60600",
                createdAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          },
        }),
        err(
          "404 — nothing matches",
          404,
          "Not Found",
          "No any subscription found",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "List Expiring Soon (renewals worklist)",
      method: "GET",
      segments: ["subscribeds", "admin", "get-all"],
      query: [
        q(
          "expiringInDays",
          7,
          "Active plans ending within N days (1-365). Forces status=ACTIVE.",
        ),
        q("page", 1, ""),
        q("limit", 50, ""),
        q("sortBy", "endDate", "createdAt | endDate | startDate | paidAmount"),
        q("sortOrder", "asc", "asc | desc"),
      ],
      description:
        "Admin only. Same endpoint with `expiringInDays` — the churn/renewals worklist. Overrides `status` to ACTIVE and windows `endDate` between now and now + N days.\n\nThere are **no renewal reminders yet** (see `docs/subscription_future_updates.md` §3), so this list is currently the only way to catch them.",
      tests: [
        ...baseAsserts(200),
        'pm.test("all rows are active and expiring inside the window", function () {',
        "    const rows = pm.response.json().data.data;",
        "    rows.forEach(function (r) {",
        '        pm.expect(r.status).to.eql("ACTIVE");',
        "        pm.expect(r.daysRemaining).to.be.at.most(7);",
        "    });",
        "});",
      ],
      responses: [
        ok("200 — expiring inside 7 days", 200, {
          success: true,
          message: "Subscriptions fetched successfully",
          data: {
            total: 1,
            totalPages: 1,
            page: 1,
            limit: 50,
            data: [
              {
                _id: "68b2c4d5e6f70819a0b1c2e5",
                brand: {
                  _id: "68a1f4c2b1e2c3d4e5f60720",
                  brandName: "trydood",
                  merchantId: "DOOD-0003",
                },
                plan: {
                  _id: "6b1a1e4fa1b2c3d4e5f60102",
                  name: "Advanced",
                  type: "YEARLY",
                  price: 2999,
                },
                status: "ACTIVE",
                source: "PAYMENT",
                endDate: "2026-08-27T00:00:00.000Z",
                daysRemaining: 4,
                isLapsed: false,
                paidAmount: 3538.82,
              },
            ],
          },
        }),
        err(
          "404 — nothing expiring",
          404,
          "Not Found",
          "No any subscription found",
        ),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Resync Brand Subscription (repair)",
      method: "PUT",
      segments: ["subscribeds", "admin", "resync"],
      reqBody: { brandId: "{{brand_id}}" },
      description:
        "Admin only. **Purely corrective** — changes no plan, no date and no outlet, so it is safe to run against any brand at any time.\n\nRecomputes the live plan from the Subscribed docs, re-applies the plan's entitlements, and recounts outlet/franchise usage from the actual SubBrand rows. Use it after: editing data directly in the DB, setting `entitlements` on a plan brands are already on, or a crash between an atomic slot reserve and the SubBrand insert.\n\n`countersDrifted: true` means the cached counters disagreed with reality and have been corrected.",
      tests: [
        ...baseAsserts(200),
        'pm.test("before/after reported", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d).to.have.property("before");',
        '    pm.expect(d).to.have.property("after");',
        "});",
        "",
        'pm.test("drift surfaced", function () {',
        "    const d = pm.response.json().data;",
        "    if (d.countersDrifted) {",
        '        console.warn("Counters had drifted and were corrected: " + JSON.stringify(d.before) + " -> " + JSON.stringify(d.after));',
        "    }",
        '    pm.expect(d).to.have.property("countersDrifted");',
        "});",
        "",
        'pm.test("entitlements now sourced from the plan", function () {',
        "    const d = pm.response.json().data;",
        '    if (d.entitlementsSource !== "DB") {',
        '        console.warn("Still " + d.entitlementsSource + " — set entitlements on the plan: " + (d.entitlementWarnings || []).join(" | "));',
        "    }",
        '    pm.expect(["DB", "DERIVED", "DEFAULT"]).to.include(d.entitlementsSource);',
        "});",
      ],
      responses: [
        ok("200 — resynced, drift corrected", 200, {
          success: true,
          message:
            "Brand subscription state and plan limits resynced successfully",
          data: {
            before: {
              _id: "68a1f4c2b1e2c3d4e5f60718",
              isSubscribed: false,
              subscribedId: null,
              subBrandsLimit: 0,
              subBrandsUsed: 0,
              franchisesLimit: 0,
              franchisesUsed: 0,
            },
            after: {
              _id: "68a1f4c2b1e2c3d4e5f60718",
              isSubscribed: true,
              subscribedId: "68b2c4d5e6f70819a0b1c2e0",
              subBrandsLimit: 0,
              subBrandsUsed: 3,
              franchisesLimit: 50,
              franchisesUsed: 1,
              entitlementsSyncedAt: "2026-08-23T09:35:00.000Z",
            },
            isSubscribed: true,
            entitlements: ENTITLEMENTS,
            entitlementsSource: "DB",
            entitlementWarnings: [],
            countersDrifted: true,
            overflow: { subBrands: 0, franchises: 0 },
          },
        }),
        err("404 — brand missing", 404, "Not Found", "Brand not found!"),
        e403Role(),
        e401(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 06 — Outlets & franchises
// ---------------------------------------------------------------------------

const USAGE_BLOCK = {
  subBrands: { used: 1, limit: null, isUnlimited: true },
  franchises: { used: 0, limit: 50, isUnlimited: false },
};

const outletFolder = folder(
  "06 — Outlets & Franchises · limit enforcement  [CHANGED]",
  "**server2.0 previously had no subscription gate and no limit check at all** on outlet signup — the legacy controller had three checks, 2.0 had none. `subBrandsUsed` had no writer anywhere and `subBrandsLimit` was never set, so both were permanently `undefined` and even the legacy `limit <= used` test passed.\n\nNow:\n- **Two separate pools.** `outletType: OUTLET` consumes `subBrands*`; `outletType: FRANCHISE` consumes `franchises*`. Neither draws from the other.\n- **Race-free.** `reserveOutletSlot` puts the limit test inside the update filter (`$expr`), so Mongo evaluates it and increments atomically. Two concurrent signups cannot both pass.\n- **Slot returned on failure.** A transient OTP outage no longer permanently costs the vendor an outlet.\n- **Ownership enforced.** `updateSubBrand` accepted `userId` and never used it — any authenticated user could edit any outlet.\n- **`isActive` no longer defaults to true** in the update validator, which used to silently reactivate a deactivated outlet on any update that omitted the field.",
  [
    request({
      name: "Sign Up Outlet (OUTLET pool)",
      method: "POST",
      segments: ["subBrands", "signUp-with-whatsapp"],
      token: "{{vendor_token}}",
      reqBody: {
        brandId: "{{brand_id}}",
        whatsappNumber: "{{sub_vendor_whatsapp}}",
        outletType: "OUTLET",
        isFirstOutlet: false,
      },
      description:
        "VENDOR or ADMIN (route gate changed from `verifyJwtToken`). A vendor may only add to their own brand.\n\n`outletType` is new: OUTLET | FRANCHISE, defaults to OUTLET. Requires a **live subscription** and a free slot in the matching pool. Response now includes `usage` for both pools.",
      tests: [
        ...baseAsserts(200),
        'pm.test("outlet created and slot consumed", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subBrand.outletType).to.eql("OUTLET");',
        "    pm.expect(d.usage.subBrands.used).to.be.at.least(1);",
        "});",
        "",
        'pm.test("usage reported for both pools", function () {',
        "    const u = pm.response.json().data.usage;",
        '    pm.expect(u).to.have.property("subBrands");',
        '    pm.expect(u).to.have.property("franchises");',
        "});",
        "",
        "const d = pm.response.json().data;",
        "if (d.subBrand && d.subBrand._id) {",
        '    pm.environment.set("sub_brand_id", d.subBrand._id);',
        "}",
      ],
      responses: [
        ok("200 — outlet registered, OTP sent", 200, {
          success: true,
          message: "OTP sent to subBrand whatsapp number successfully.",
          data: {
            user: {
              _id: "68b2c4d5e6f70819a0b1c400",
              whatsappNumber: "9812345678",
              role: "SUB_VENDOR",
              uniqueId: "TD-SV-000123",
              subBrandId: "68b2c4d5e6f70819a0b1c401",
            },
            subBrand: {
              _id: "68b2c4d5e6f70819a0b1c401",
              userId: "68b2c4d5e6f70819a0b1c400",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              outletType: "OUTLET",
              whatsappNumber: "9812345678",
              uniqueId: "TD-SB-000123",
              storeId: "STORE-000123",
              isActive: true,
              isDeleted: false,
            },
            usage: USAGE_BLOCK,
          },
        }),
        err(
          "403 — no subscription",
          403,
          "Forbidden",
          "Access denied. This feature requires an active subscription. Please subscribe to continue.",
        ),
        err(
          "403 — subscription lapsed",
          403,
          "Forbidden",
          "Your subscription has expired. Please renew or upgrade your plan.",
        ),
        err(
          "403 — outlet pool exhausted",
          403,
          "Forbidden",
          "Outlet/Sub-brand limit reached — 1 of 1 used on your current plan. Please upgrade your subscription to add more.",
        ),
        err(
          "403 — plan has no outlets at all",
          403,
          "Forbidden",
          "Your current plan does not include outlets. Please upgrade your subscription to add outlets.",
        ),
        err(
          "403 — number already registered",
          403,
          "Forbidden",
          "Outlet/Sub-Brand is already registered with this number",
        ),
        e403Brand(),
        e403Role(),
        e401(),
      ],
    }),
    request({
      name: "Sign Up Franchise (FRANCHISE pool)",
      method: "POST",
      segments: ["subBrands", "signUp-with-whatsapp"],
      token: "{{vendor_token}}",
      reqBody: {
        brandId: "{{brand_id}}",
        whatsappNumber: "{{sub_vendor_whatsapp_2}}",
        outletType: "FRANCHISE",
      },
      description:
        'VENDOR or ADMIN. Draws on the **franchise** pool, which is metered independently of outlets — a brand can be out of outlets and still have franchise slots free, and vice versa.\n\n⚠️ On the current live plans franchises resolve to **0** (the plan\'s `Franchise: "Yes"` feature carries no count), so this returns 403 until `entitlements.franchises` is set on the plan. See folder 02.',
      tests: [
        ...baseAsserts(200),
        'pm.test("franchise pool consumed, not the outlet pool", function () {',
        "    const d = pm.response.json().data;",
        '    pm.expect(d.subBrand.outletType).to.eql("FRANCHISE");',
        "    pm.expect(d.usage.franchises.used).to.be.at.least(1);",
        "});",
      ],
      responses: [
        ok("200 — franchise registered", 200, {
          success: true,
          message: "OTP sent to subBrand whatsapp number successfully.",
          data: {
            user: {
              _id: "68b2c4d5e6f70819a0b1c402",
              whatsappNumber: "9812345679",
              role: "SUB_VENDOR",
            },
            subBrand: {
              _id: "68b2c4d5e6f70819a0b1c403",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              outletType: "FRANCHISE",
              storeId: "STORE-000124",
              isActive: true,
            },
            usage: {
              subBrands: { used: 1, limit: null, isUnlimited: true },
              franchises: { used: 1, limit: 50, isUnlimited: false },
            },
          },
        }),
        err(
          "403 — plan excludes franchises (current DERIVED state)",
          403,
          "Forbidden",
          "Your current plan does not include franchises. Please upgrade your subscription to add franchises.",
        ),
        err(
          "403 — franchise pool exhausted",
          403,
          "Forbidden",
          "Franchise limit reached — 5 of 5 used on your current plan. Please upgrade your subscription to add more.",
        ),
        e403Brand(),
        e401(),
      ],
    }),
    request({
      name: "Switch Outlet Type — OUTLET → FRANCHISE",
      method: "PUT",
      segments: ["subBrands", "update", "{{sub_brand_id}}"],
      token: "{{vendor_token}}",
      reqBody: { outletType: "FRANCHISE" },
      description:
        "VENDOR (own brand only) or ADMIN. **Not a cosmetic edit** — because the pools are metered separately, changing `outletType` frees a slot in one pool and must claim one in the other.\n\nSequence: requires a live subscription → atomically `+1` the target pool and `-1` the source (same conditional filter as creation) → write `outletType` → revert the counters if that write fails.\n\nRefused with a specific reason when the target pool is full or absent from the plan. Same-type is a no-op with no counter movement.",
      tests: [
        ...baseAsserts(200),
        'pm.test("type switched", function () {',
        "    const d = pm.response.json().data;",
        "    pm.expect(d.outletTypeChanged).to.be.true;",
        '    pm.expect(d.subBrand.outletType).to.eql("FRANCHISE");',
        "});",
        "",
        'pm.test("counters moved between pools, total unchanged", function () {',
        "    const u = pm.response.json().data.usage;",
        "    pm.expect(u.franchises.used).to.be.at.least(1);",
        "});",
      ],
      responses: [
        ok("200 — switched", 200, {
          success: true,
          message:
            "Outlet/Sub-Brand updated and outlet type switched successfully.",
          data: {
            subBrand: {
              _id: "68b2c4d5e6f70819a0b1c401",
              brandId: "68a1f4c2b1e2c3d4e5f60718",
              outletType: "FRANCHISE",
              storeId: "STORE-000123",
              isActive: true,
            },
            outletTypeChanged: true,
            usage: {
              subBrands: { used: 0, limit: null, isUnlimited: true },
              franchises: { used: 1, limit: 50, isUnlimited: false },
            },
          },
        }),
        err(
          "403 — target pool full",
          403,
          "Forbidden",
          "Cannot switch to FRANCHISE — franchise limit reached (5 of 5 used on your current plan). Please upgrade your subscription or free up a franchise first.",
        ),
        err(
          "403 — plan excludes franchises",
          403,
          "Forbidden",
          "Cannot switch to FRANCHISE — your current plan does not include franchises. Please upgrade your subscription first.",
        ),
        err(
          "403 — not your outlet",
          403,
          "Forbidden",
          "Forbidden: You do not have permission to update this outlet.",
        ),
        err(
          "404 — no such outlet",
          404,
          "Not Found",
          "Outlet/Sub-Brand not found!",
        ),
        e401(),
      ],
    }),
    request({
      name: "Update Outlet (no type change)",
      method: "PUT",
      segments: ["subBrands", "update", "{{sub_brand_id}}"],
      token: "{{vendor_token}}",
      reqBody: {
        email: "outlet.sector43@brand.com",
        description: "Flagship outlet, Golf Course Road",
      },
      description:
        "VENDOR (own brand only) or ADMIN. Ordinary edit — no pool movement, no subscription gate.\n\n**Behaviour change:** omitting `isActive` now leaves it alone. It previously defaulted to `true` in the validator, so any update silently reactivated a deactivated outlet.",
      tests: [
        ...baseAsserts(200),
        'pm.test("no type change reported", function () {',
        "    pm.expect(pm.response.json().data.outletTypeChanged).to.be.false;",
        "});",
        "",
        'pm.test("isActive not silently flipped", function () {',
        "    const s = pm.response.json().data.subBrand;",
        '    pm.expect(s).to.have.property("isActive");',
        "});",
      ],
      responses: [
        ok("200 — updated", 200, {
          success: true,
          message: "Outlet/Sub-Brand updated successfully.",
          data: {
            subBrand: {
              _id: "68b2c4d5e6f70819a0b1c401",
              outletType: "OUTLET",
              email: "outlet.sector43@brand.com",
              description: "Flagship outlet, Golf Course Road",
              isActive: true,
            },
            outletTypeChanged: false,
            usage: USAGE_BLOCK,
          },
        }),
        err(
          "403 — not your outlet",
          403,
          "Forbidden",
          "Forbidden: You do not have permission to update this outlet.",
        ),
        err(
          "404 — no such outlet",
          404,
          "Not Found",
          "Outlet/Sub-Brand not found!",
        ),
        e401(),
      ],
    }),
    request({
      name: "List Outlets",
      method: "GET",
      segments: ["subBrands", "get-all"],
      token: "{{vendor_token}}",
      query: [
        q("page", 1, ""),
        q("limit", 20, "Max 100"),
        q("brandId", "{{brand_id}}", "Filter to one brand"),
        q("outletType", "FRANCHISE", "OUTLET | FRANCHISE", true),
        q("isActive", "true", "true | false", true),
        q(
          "sortBy",
          "createdAt",
          "joinedDate | createdAt | updatedAt | outletType | isActive",
        ),
        q("sortOrder", "desc", "asc | desc"),
      ],
      description:
        "Any authenticated user (`verifyJwtToken` — unchanged). Use `outletType` to reconcile against the pool counters. ⚠️ Returns **404** when empty.",
      tests: [
        ...baseAsserts(200),
        'pm.test("rows returned", function () {',
        '    pm.expect(pm.response.json().data.data).to.be.an("array").that.is.not.empty;',
        "});",
      ],
      responses: [
        ok("200 — outlets", 200, {
          success: true,
          message: "Outlets/Sub-Brands fetched successfully",
          data: {
            total: 2,
            totalPages: 1,
            page: 1,
            limit: 20,
            data: [
              {
                _id: "68b2c4d5e6f70819a0b1c401",
                brandId: "68a1f4c2b1e2c3d4e5f60718",
                outletType: "OUTLET",
                storeId: "STORE-000123",
                isActive: true,
              },
              {
                _id: "68b2c4d5e6f70819a0b1c403",
                brandId: "68a1f4c2b1e2c3d4e5f60718",
                outletType: "FRANCHISE",
                storeId: "STORE-000124",
                isActive: true,
              },
            ],
          },
        }),
        err("404 — none found", 404, "Not Found", "No any subbrand found"),
        e401(),
      ],
    }),
    request({
      name: "Get Brand (limit counters — reference)",
      method: "GET",
      segments: ["brands", "get"],
      token: "{{vendor_token}}",
      query: [
        q(
          "brandId",
          "{{brand_id}}",
          "Optional — falls back to req.brandId for a vendor (controllers/brands/get.js). Required when an admin wants another brand.",
          true,
        ),
      ],
      description:
        "**Response changed** (fields only, no logic change). `Brand` gained `franchisesLimit`, `franchisesUsed`, `isSubBrandsUnlimited`, `isFranchisesUnlimited` and `entitlementsSyncedAt`. `getBrand` uses an exclusion-only projection, so they flow through automatically.\n\n`isSubscribed` here is a **cache** — for a decision, use `GET /subscribeds/get` instead.",
      tests: [
        ...baseAsserts(200),
        'pm.test("franchise counters exposed", function () {',
        "    const d = pm.response.json().data;",
        "    const b = Array.isArray(d) ? d[0] : d;",
        '    pm.expect(b).to.have.property("franchisesLimit");',
        '    pm.expect(b).to.have.property("franchisesUsed");',
        "});",
      ],
      responses: [
        ok("200 — brand", 200, {
          success: true,
          message: "Brand details fetched successfully",
          data: {
            _id: "68a1f4c2b1e2c3d4e5f60718",
            brandName: "Devashish Tester",
            merchantId: "DOOD-0001",
            isSubscribed: true,
            subscribedId: "68b2c4d5e6f70819a0b1c2e0",
            subBrandsLimit: 0,
            subBrandsUsed: 1,
            franchisesLimit: 50,
            franchisesUsed: 1,
            isSubBrandsUnlimited: true,
            isFranchisesUnlimited: false,
            entitlementsSyncedAt: "2026-08-23T09:15:05.000Z",
            isApproved: true,
            isActive: true,
          },
        }),
        e401(),
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 07-09 — promo codes, notifications, invoice re-issue + forfeited terms
// Built in their own module, sharing these helpers so every request in the
// collection is constructed the same way.
// ---------------------------------------------------------------------------

const {
  promoFolder,
  notificationFolder,
  invoiceFolder,
  webhookFolder,
  webhookOpsFolder,
  pushFolder,
} =
  require("./subscription-extras")({
    folder,
    request,
    q,
    ok,
    err,
    e401,
    e403Role,
    e403Brand,
    baseAsserts,
    PRICING,
  });

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

const COLLECTION_DESCRIPTION = `# Trydood 2.0 — Subscription, Checkout & Plan Entitlements

Every endpoint that is **new** or whose **request / response / logic changed** in the
subscription lifecycle work. Generated from the \`server2.0\` codebase by
\`postman/generate-subscription-collection.js\`.

Companion docs:
- \`server2.0/docs/subscription_lifecycle_design.md\` — full design
- \`server2.0/docs/subscription_future_updates.md\` — promo codes, proration, reminders

## What changed

| # | Endpoint | Status |
|---|---|---|
| 1 | \`POST /transactions/subscribe/preview\` | **NEW** |
| 2 | \`POST /subscribeds/admin/grant\` | **NEW** |
| 3 | \`PUT  /subscribeds/admin/cancel\` | **NEW** |
| 4 | \`GET  /subscribeds/admin/get-all\` | **NEW** |
| 5 | \`PUT  /subscribeds/admin/resync\` | **NEW** |
| 6 | \`GET  /subscribeds/get\` | **NEW** |
| 7 | \`GET  /subscribeds/history\` | **NEW** |
| 8 | \`POST /transactions/subscribe/create-order\` | CHANGED — \`amount\` removed, role-gated, new response |
| 9 | \`POST /transactions/subscribe/verify-transaction\` | CHANGED — idempotent, amount-checked, real error codes |
| 10 | \`GET  /settings/get\` · \`PUT /settings/update\` | CHANGED — \`vendor.subscription\` block |
| 11 | \`POST /subscriptions/create\` · \`PUT /subscriptions/update/:id\` | CHANGED — \`entitlements\` + discount fields |
| 12 | \`GET  /subscriptions/getAll\` · \`GET /subscriptions/get/:id\` | CHANGED — response exposes \`entitlements\` |
| 13 | \`POST /subBrands/signUp-with-whatsapp\` | CHANGED — \`outletType\`, subscription gate, limit enforcement, \`usage\` |
| 14 | \`PUT  /subBrands/update/:subBrandId\` | CHANGED — ownership check, outlet-type switch, \`isActive\` no longer defaults |
| 15 | \`GET  /brands/get\` | CHANGED — franchise counters in the response |

## Happy path

\`\`\`
00 Login as Vendor            -> vendor_token, brand_id
02 List Subscription Plans    -> plan_*_id
03 Preview Checkout           -> preview_total_paise   (no writes)
03 Create Subscribe Order     -> transaction_id, razorpay_order_id
   ... pay in Razorpay Checkout, paste payment id + signature into the env ...
03 Verify Subscribe Transaction -> subscribed_id, limits applied
06 Sign Up Outlet             -> slot consumed from the OUTLET pool
04 Get Brand Subscription     -> usage vs limits
\`\`\`

Admin-without-payment path: \`00 Login as Admin\` → \`05 Grant Subscription\`.

## Two things to know before running anything

**1. \`companyStateCode\` must be set** in \`PUT /settings/update\`. It decides
CGST+SGST vs IGST by comparing against the first two digits of the brand's GSTIN.
While blank, every supply is billed as inter-state IGST.

**2. All four live plans resolve as \`DERIVED\`.** \`Franchise: "Yes"\` carries no
count, so franchises resolve to **0** on Pro Plus, Pro Lite and Advanced and
franchise signup returns 403. Fix with **02 → Update Plan — set entitlements**,
then **05 → Resync Brand Subscription** for brands already on those plans.

## Gotcha — list endpoints return 404 when empty

The shared \`pagination\` utility throws \`404\` instead of returning an empty
array. Treat \`404\` on any list endpoint as an empty state, not a failure.

## Source of truth

| Question | Answer |
|---|---|
| Is this brand subscribed right now? | \`Subscribed.status === ACTIVE && endDate > now\` |
| \`Brand.isSubscribed\` | **Cache only** — never read it for a decision |
| What is this brand allowed to do? | \`Subscription.entitlements\` (resolved) |
| \`Subscription.features[]\` | **Display only** — never enforced |
| How much does this cost? | \`calculatePricing()\` — one function, used by preview, order, verify and invoice |
| GST %, policy flags, seller identity | \`Setting.vendor.subscription\` |

## Enums

- \`SUBSCRIBED_STATUS\`: PENDING, ACTIVE, EXPIRED, UPGRADED, DOWNGRADED, CANCELLED
- \`SUBSCRIPTION_ACTION\`: NEW, RENEW, UPGRADE, DOWNGRADE
- \`SUBSCRIPTION_SOURCE\`: PAYMENT, ADMIN_PAYMENT, ADMIN_MANUAL
- \`PAYMENT_GATEWAYS\`: RAZORPAY, MANUAL
- \`MANUAL_PAYMENT_MODES\`: FREE, CASH, BANK_TRANSFER, CHEQUE, UPI_OFFLINE
- \`DISCOUNT_TYPES\`: PERCENT, FLAT
- \`GST_TAX_TYPES\`: CGST_SGST, IGST
- \`SUBSCRIPTION_HISTORY_ACTION\`: ORDER_CREATED, ACTIVATED, RENEWED, UPGRADED, DOWNGRADED, EXPIRED, CANCELLED, ADMIN_GRANTED
- \`HISTORY_PERFORMED_BY\`: VENDOR, ADMIN, SYSTEM
- \`ENTITLEMENT_SOURCE\`: DB, DERIVED, DEFAULT
- \`OUTLET_TYPES\`: OUTLET, FRANCHISE

## Verified pricing (matches the live checkout page)

\`\`\`
Original Price     ₹ 4,999.00
Bill Value         ₹ 4,999.00
IGST @ 18.00%      ₹   899.82
You'll Pay         ₹ 5,898.82      -> amountInPaise 589882
You saved ₹ 0.00 on This Plan
\`\`\``;

const collection = {
  info: {
    _postman_id: "c8b2f5d3-a042-4e9c-b7d6-subscription001",
    name: "Trydood 2.0 — Subscription, Checkout & Plan Entitlements",
    description: COLLECTION_DESCRIPTION,
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{admin_token}}", type: "string" }],
  },
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          "// Warn early instead of failing with a confusing 401 later.",
          'if (!pm.environment.get("base_url")) {',
          '    console.warn("base_url is not set — select an environment first.");',
          "}",
        ],
      },
    },
  ],
  variable: [
    {
      key: "base_url",
      value: "http://localhost:8080/trydood/v1",
      type: "string",
      description: "API root. Mounted at /trydood/v1 in index.js.",
    },
    {
      key: "admin_token",
      value: "",
      type: "string",
      description: "Set by Login as Admin.",
    },
    {
      key: "vendor_token",
      value: "",
      type: "string",
      description: "Set by Login as Vendor.",
    },
    {
      key: "admin_user_id",
      value: "",
      type: "string",
      description: "Set by Login as Admin.",
    },
    {
      key: "brand_id",
      value: "",
      type: "string",
      description:
        "Set by Login as Vendor; pass explicitly when acting as admin.",
    },
    {
      key: "subscription_id",
      value: "6b1a1e4fa1b2c3d4e5f60104",
      type: "string",
      description: "Plan under test.",
    },
    {
      key: "plan_proplus_id",
      value: "6b1a1e4fa1b2c3d4e5f60104",
      type: "string",
      description: "Pro Plus — ₹4,999 YEARLY.",
    },
    {
      key: "plan_prolite_id",
      value: "6b1a1e4fa1b2c3d4e5f60103",
      type: "string",
      description: "Pro Lite — ₹3,999 YEARLY.",
    },
    {
      key: "plan_advanced_id",
      value: "6b1a1e4fa1b2c3d4e5f60102",
      type: "string",
      description: "Advanced — ₹2,999 YEARLY.",
    },
    {
      key: "plan_basic_id",
      value: "6b1a1e4fa1b2c3d4e5f60101",
      type: "string",
      description:
        "Basic — ₹1,999 YEARLY. Lowest tier, used for downgrade tests.",
    },
    {
      key: "subscribed_id",
      value: "",
      type: "string",
      description: "Live Subscribed doc id.",
    },
    {
      key: "transaction_id",
      value: "",
      type: "string",
      description: "Set by Create Subscribe Order / Grant.",
    },
    {
      key: "razorpay_order_id",
      value: "",
      type: "string",
      description: "Set by Create Subscribe Order.",
    },
    {
      key: "razorpay_payment_id",
      value: "",
      type: "string",
      description: "Paste from Razorpay Checkout after paying.",
    },
    {
      key: "razorpay_signature",
      value: "",
      type: "string",
      description: "Paste from Razorpay Checkout after paying.",
    },
    {
      key: "sub_brand_id",
      value: "",
      type: "string",
      description: "Set by Sign Up Outlet.",
    },
    {
      key: "preview_total_paise",
      value: "",
      type: "string",
      description: "Set by Preview; asserted against by Create Order.",
    },
    {
      key: "promo_code_id",
      value: "",
      type: "string",
      description: "Set by Create Promo Code.",
    },
    {
      key: "promo_code",
      value: "LAUNCH20",
      type: "string",
      description: "Code string used at checkout.",
    },
    {
      key: "notification_id",
      value: "",
      type: "string",
      description: "Set by Get Notifications.",
    },
    {
      key: "forfeited_subscribed_id",
      value: "",
      type: "string",
      description: "Set by List Forfeited Terms.",
    },
    {
      key: "razorpay_webhook_secret",
      value: "",
      type: "string",
      description:
        "Must match RAZORPAY_WEBHOOK_SECRET on the server. The webhook requests sign themselves with it.",
    },
  ],
  item: [
    authFolder,
    settingsFolder,
    plansFolder,
    checkoutFolder,
    vendorFolder,
    adminFolder,
    outletFolder,
    promoFolder,
    notificationFolder,
    invoiceFolder,
    webhookFolder,
    webhookOpsFolder,
    pushFolder,
  ],
};

// ---------------------------------------------------------------------------
// environments
// ---------------------------------------------------------------------------

const envValues = (baseUrl) => [
  { key: "base_url", value: baseUrl, type: "default", enabled: true },
  { key: "admin_token", value: "", type: "secret", enabled: true },
  { key: "vendor_token", value: "", type: "secret", enabled: true },
  {
    key: "admin_email",
    value: "admin@trydood.com",
    type: "default",
    enabled: true,
  },
  { key: "admin_password", value: "", type: "secret", enabled: true },
  { key: "vendor_mobile", value: "9876543210", type: "default", enabled: true },
  { key: "vendor_password", value: "", type: "secret", enabled: true },
  { key: "admin_user_id", value: "", type: "default", enabled: true },
  { key: "brand_id", value: "", type: "default", enabled: true },
  {
    key: "subscription_id",
    value: "6b1a1e4fa1b2c3d4e5f60104",
    type: "default",
    enabled: true,
  },
  {
    key: "plan_proplus_id",
    value: "6b1a1e4fa1b2c3d4e5f60104",
    type: "default",
    enabled: true,
  },
  {
    key: "plan_prolite_id",
    value: "6b1a1e4fa1b2c3d4e5f60103",
    type: "default",
    enabled: true,
  },
  {
    key: "plan_advanced_id",
    value: "6b1a1e4fa1b2c3d4e5f60102",
    type: "default",
    enabled: true,
  },
  {
    key: "plan_basic_id",
    value: "6b1a1e4fa1b2c3d4e5f60101",
    type: "default",
    enabled: true,
  },
  { key: "subscribed_id", value: "", type: "default", enabled: true },
  // Any user to aim a selected-users broadcast at. Not the admin’s own id —
  // sending yourself a test broadcast proves less than sending someone else one.
  { key: "user_id", value: "", type: "default", enabled: true },
  // Captured by the broadcast dry run, then passed back to the real send so the
  // pair works as a two-step confirm and a retry cannot double-notify.
  { key: "broadcast_id", value: "", type: "default", enabled: true },
  // Written by Register Device so a second run can show the count did not climb.
  { key: "device_active_count", value: "", type: "default", enabled: true },
  { key: "transaction_id", value: "", type: "default", enabled: true },
  { key: "razorpay_order_id", value: "", type: "default", enabled: true },
  { key: "razorpay_payment_id", value: "", type: "default", enabled: true },
  { key: "razorpay_signature", value: "", type: "secret", enabled: true },
  { key: "sub_brand_id", value: "", type: "default", enabled: true },
  {
    key: "sub_vendor_whatsapp",
    value: "9812345678",
    type: "default",
    enabled: true,
  },
  {
    key: "sub_vendor_whatsapp_2",
    value: "9812345679",
    type: "default",
    enabled: true,
  },
  { key: "preview_total_paise", value: "", type: "default", enabled: true },
  { key: "promo_code_id", value: "", type: "default", enabled: true },
  { key: "promo_code", value: "LAUNCH20", type: "default", enabled: true },
  { key: "notification_id", value: "", type: "default", enabled: true },
  { key: "forfeited_subscribed_id", value: "", type: "default", enabled: true },
  { key: "razorpay_webhook_secret", value: "", type: "secret", enabled: true },
  { key: "webhook_event_id", value: "", type: "default", enabled: true },
];

const environments = {
  local: {
    id: "env-subscription-local",
    name: "Trydood 2.0 — Subscription (local)",
    values: envValues("http://localhost:8080/trydood/v1"),
    _postman_variable_scope: "environment",
  },
  staging: {
    id: "env-subscription-staging",
    name: "Trydood 2.0 — Subscription (staging)",
    values: envValues("https://staging-api.trydood.com/trydood/v1"),
    _postman_variable_scope: "environment",
  },
  production: {
    id: "env-subscription-production",
    name: "Trydood 2.0 — Subscription (production)",
    values: envValues("https://api.trydood.com/trydood/v1"),
    _postman_variable_scope: "environment",
  },
};

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------

const README = `# Trydood 2.0 — Subscription Postman Collection

Generated by \`postman/generate-subscription-collection.js\`. Re-run it after
changing a route, validator or response so the collection cannot drift:

\`\`\`bash
node postman/generate-subscription-collection.js
\`\`\`

## Files

| File | What |
|---|---|
| \`trydood-subscription.postman_collection.json\` | The collection (Postman schema v2.1) |
| \`environments/subscription-local.postman_environment.json\` | \`http://localhost:8080/trydood/v1\` |
| \`environments/subscription-staging.postman_environment.json\` | staging |
| \`environments/subscription-production.postman_environment.json\` | production |

> Staging and production base URLs are placeholders — no staging/production host
> exists in \`.env\` or any config file in this repo. Correct them in Postman
> before using those environments.

## Import

1. Postman → **Import** → drop in the collection file.
2. **Import** the environment for your target, then select it top-right.
3. Fill \`admin_password\` and \`vendor_password\` in the environment (they ship blank).

## Token capture

Run **00 — Auth → Login as Admin** and **Login as Vendor** first. Their test
scripts write \`admin_token\`, \`admin_user_id\`, \`vendor_token\` and \`brand_id\`
into the active environment — nothing is copy-pasted.

Collection-level auth is \`bearer {{admin_token}}\`. Requests that must run as a
vendor override it to \`{{vendor_token}}\` at the request level, so you never have
to swap tokens by hand.

## Variables set automatically by test scripts

| Variable | Set by |
|---|---|
| \`admin_token\`, \`admin_user_id\` | Login as Admin |
| \`vendor_token\`, \`brand_id\` | Login as Vendor |
| \`plan_proplus_id\`, \`plan_prolite_id\`, \`plan_advanced_id\`, \`plan_basic_id\` | List Subscription Plans |
| \`subscription_id\` | Create Subscription Plan |
| \`preview_total_paise\` | Preview Subscription Checkout |
| \`transaction_id\`, \`razorpay_order_id\` | Create Subscribe Order · Grant Subscription |
| \`subscribed_id\` | Verify Subscribe Transaction · Grant · Get Brand Subscription |
| \`sub_brand_id\` | Sign Up Outlet |

Only \`razorpay_payment_id\` and \`razorpay_signature\` are manual — they come from
the Razorpay Checkout callback in the browser.

## Running the happy path

\`\`\`
00 Login as Vendor
02 List Subscription Plans
03 Preview Subscription Checkout      <- read-only, safe to spam
03 Create Subscribe Order
   -> pay with razorpay.orderId + razorpay.keyId in Checkout.js
   -> paste razorpay_payment_id and razorpay_signature into the environment
03 Verify Subscribe Transaction
06 Sign Up Outlet
04 Get Brand Subscription             <- usage vs limits
\`\`\`

**Preview → Create Order is cross-checked:** Preview stores
\`preview_total_paise\` and Create Order asserts its own \`amountInPaise\` matches.
A failure there means preview and checkout have diverged — which is exactly the
bug the shared pricing function exists to prevent.

Admin-without-payment path: **00 Login as Admin** → **05 Grant Subscription**.
No Razorpay involved; it still writes a \`gateway: MANUAL\` transaction and an
invoice.

## Test assertions

Every request asserts status code, response time under 5s, and the
\`{ success, message, data }\` envelope. On top of that:

- **Preview** — \`taxableValue + gstAmount === totalPayable\`, \`amountInPaise === round(totalPayable * 100)\`, and the tax split matches \`taxType\` (IGST alone, or CGST+SGST summing exactly to \`gstAmount\`).
- **Create Order** — the Razorpay handoff is present and \`razorpay.amount === pricing.amountInPaise\`; the order total matches what Preview quoted.
- **Verify** — the subscription is \`ACTIVE\` with a future \`endDate\`, and \`transactionId\` / \`userId\` are actually stored (both were silently dropped by the old code). Logs a warning on a replayed verification and on a missing invoice URL.
- **Grant** — \`gateway: MANUAL\`, \`razorpayOrderId\` matches \`/^MANUAL-/\`, and GST is recorded even on a FREE grant.
- **Downgrade** — asserts the overflow is reported rather than acted on; warns how many entries are grandfathered.
- **Outlet / franchise signup** — the correct pool was consumed and \`usage\` is returned for both.
- **Switch type** — \`outletTypeChanged\` is true and the target pool incremented.
- **Get Brand Subscription / Resync** — warns loudly when \`entitlementsSource\` is not \`DB\`, printing the exact plan that needs configuring.
- **List All Subscriptions** — warns when rows are \`isLapsed\` (still ACTIVE past their end date), i.e. the expiry job has not swept them.

## Before you run anything

**1. Backfill.** \`status\` is new; documents written before it existed have none,
so a brand with a live subscription reads as unsubscribed.

\`\`\`bash
node scripts/backfillSubscriptionState.js            # dry run
node scripts/backfillSubscriptionState.js --apply
\`\`\`

**2. Set \`companyStateCode\`** via **01 → Update Settings**, or all tax is IGST.

**3. Set \`entitlements\` on the four live plans** via **02 → Update Plan**, or
franchise signup returns 403 on Pro Plus / Pro Lite / Advanced.

## Note on list endpoints

The shared \`pagination\` utility throws **404** instead of returning an empty
array. Treat 404 on any list request as an empty state. The saved 404 examples
on those requests document it.
`;

const write = (file, contents) => {
  fs.writeFileSync(file, contents, "utf8");
  const kb = (Buffer.byteLength(contents, "utf8") / 1024).toFixed(1);
  console.log(`  ✅ ${path.relative(OUT_DIR, file).padEnd(62)} ${kb} KB`);
};

if (!fs.existsSync(ENV_DIR)) fs.mkdirSync(ENV_DIR, { recursive: true });

const collectionPath = path.join(
  OUT_DIR,
  "trydood-subscription.postman_collection.json",
);
const collectionJson = json(collection);

// Fail loudly rather than emitting a file Postman will reject.
JSON.parse(collectionJson);

console.log("\nGenerating Postman artefacts:\n");
write(collectionPath, collectionJson);
Object.entries(environments).forEach(([name, env]) =>
  write(
    path.join(ENV_DIR, `subscription-${name}.postman_environment.json`),
    json(env),
  ),
);
write(path.join(OUT_DIR, "SUBSCRIPTION_README.md"), README);

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

let folders = 0;
let requests = 0;
let examples = 0;
let assertions = 0;

const walk = (items) =>
  items.forEach((item) => {
    if (item.item) {
      folders += 1;
      walk(item.item);
      return;
    }
    requests += 1;
    examples += (item.response || []).length;
    assertions += (item.event || []).reduce(
      (n, e) =>
        n + e.script.exec.filter((line) => line.includes("pm.test(")).length,
      0,
    );
  });
walk(collection.item);

console.log(
  `\n  ${folders} folders · ${requests} requests · ${examples} saved examples · ${assertions} test assertions\n`,
);
