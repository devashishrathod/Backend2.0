// Generates the Brand Verification Postman v2.1 collection + environments.
//
//   node postman/generate.js
//
// Enum values, reason limits and role names are pulled from the real constants
// so the collection cannot drift from the code. Re-run this after changing any
// verification enum, validator or route — do not hand-edit the JSON.
const fs = require("fs");
const path = require("path");

const {
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
  ROLES,
  SCREENS,
} = require("../constants");
const {
  BRAND_VERIFICATION_ACTION: ACT,
  BRAND_VERIFICATION_ADMIN_ACTION: ADMIN_ACT,
  BRAND_VERIFICATION_ACTOR: ACTOR,
  BRAND_VERIFICATION_SORT_BY: SORT_BY,
  BRAND_VERIFICATION_SORT_ORDER: SORT_ORDER,
  BRAND_VERIFICATION_LIMITS: LIMITS,
} = require("../constants/brandVerification");

const ST = SYSTEM_VERIFICATION_STATUS;
const BY = BRAND_SYSTEM_VERIFY_UPDATED_BY;
const list = (o) => Object.values(o).join(", ");

const OUT = __dirname;
const ENV_DIR = path.join(OUT, "environments");

// ---------------------------------------------------------------- helpers
const json = (obj) => JSON.stringify(obj, null, 2);

const bearer = (varName) => ({
  type: "bearer",
  bearer: [{ key: "token", value: `{{${varName}}}`, type: "string" }],
});

const url = (segments, query) => ({
  raw:
    "{{base_url}}/" +
    segments.join("/") +
    (query && query.length
      ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&")
      : ""),
  host: ["{{base_url}}"],
  path: segments,
  ...(query && query.length ? { query } : {}),
});

// A saved response example.
const example = ({ name, code, status, body, req }) => ({
  name,
  originalRequest: req,
  status,
  code,
  _postman_previewlanguage: "json",
  header: [{ key: "Content-Type", value: "application/json" }],
  cookie: [],
  body: json(body),
});

const err = (message, details) => ({
  success: false,
  message,
  ...(details ? { details } : {}),
});

const okEnvelope = (message, data) => ({ success: true, message, data });

// Reusable assertion script.
const baseTests = (extra = []) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("response time is acceptable", function () {',
      "    pm.expect(pm.response.responseTime).to.be.below(5000);",
      "});",
      "",
      'pm.test("body is JSON with a success flag", function () {',
      "    const body = pm.response.json();",
      '    pm.expect(body).to.have.property("success");',
      "});",
      "",
      ...extra,
    ],
  },
});

// ---------------------------------------------------------------- shared example payloads
const IDS = {
  brand: "68a1f4c2b1e2c3d4e5f60718",
  systemVerify: "68a1f4c2b1e2c3d4e5f60801",
  prevSystemVerify: "68a1f4c2b1e2c3d4e5f60800",
  history: "68a1f4c2b1e2c3d4e5f60901",
  admin: "68a1f4c2b1e2c3d4e5f60600",
  vendorUser: "68a1f4c2b1e2c3d4e5f60700",
};

const FLAGS_PASS = {
  panVerified: true,
  gstVerified: true,
  bankVerified: true,
  panMatchedWithGST: true,
  panMatchedWithBrand: true,
  gstMatchedWithBrand: true,
  bankMatched: true,
  businessEntityMatched: true,
  gstActive: true,
  duplicatePAN: false,
  duplicateGST: false,
  duplicateBank: false,
  duplicateWhatsapp: false,
  duplicateEmail: false,
};

const FLAGS_FAIL = {
  panVerified: true,
  gstVerified: false,
  bankVerified: false,
  panMatchedWithGST: false,
  panMatchedWithBrand: true,
  gstMatchedWithBrand: false,
  bankMatched: false,
  businessEntityMatched: true,
  gstActive: false,
  duplicatePAN: false,
  duplicateGST: false,
  duplicateBank: false,
  duplicateWhatsapp: false,
  duplicateEmail: false,
};

const EMPTY_DUPES = {
  panBrandIds: [],
  gstBrandIds: [],
  bankBrandIds: [],
  whatsappBrandIds: [],
  emailBrandIds: [],
};

const systemVerifyRecord = (over = {}) => ({
  _id: IDS.systemVerify,
  brandId: IDS.brand,
  attemptNumber: 1,
  score: 100,
  status: ST.APPROVED,
  flags: FLAGS_PASS,
  nameMatch: {
    panGstScore: 100,
    panBrandScore: 100,
    gstBrandScore: 100,
    averageScore: 100,
  },
  bankNameMatch: {
    bankPanScore: 100,
    bankGstScore: 100,
    bankBrandScore: 100,
    highestScore: 100,
  },
  entityMatch: {
    gstConstitution: "Proprietorship",
    brandEntityType: "PROPRIETORSHIP",
    matched: true,
  },
  duplicateDetails: EMPTY_DUPES,
  remarks: [],
  verifiedAt: "2026-08-23T10:15:30.000Z",
  verifiedBy: BY.SYSTEM,
  verifiedByAdminId: null,
  rejectedBy: null,
  rejectedByAdminId: null,
  rejectedAt: null,
  rejectionReason: null,
  reviewedByAdminId: null,
  reviewedAt: null,
  adminApprovedAt: null,
  revokedBy: null,
  revokedByAdminId: null,
  revokedAt: null,
  revokeReason: null,
  isReviewed: false,
  isAdminApproved: false,
  isRejected: false,
  isRevoked: false,
  isSuperseded: false,
  supersededAt: null,
  supersededById: null,
  isDeleted: false,
  createdAt: "2026-08-23T10:15:30.000Z",
  updatedAt: "2026-08-23T10:15:30.000Z",
  ...over,
});

const reviewResult = (over = {}) => ({
  brandId: IDS.brand,
  brandName: "test cafe",
  brandUniqueId: "DOOD-0001",
  merchantId: "MID-0001",
  systemVerifyId: IDS.systemVerify,
  historyId: IDS.history,
  action: ACT.APPROVED,
  attemptNumber: 1,
  score: 100,
  previousStatus: ST.APPROVED,
  status: ST.APPROVED,
  brandStatus: ST.APPROVED,
  isReviewed: true,
  isRejected: false,
  isRevoked: false,
  isAdminApproved: true,
  isApproved: true,
  verifiedBy: BY.SYSTEM,
  rejectionReason: null,
  revokeReason: null,
  reviewedBy: IDS.admin,
  reviewedAt: "2026-08-23T11:00:00.000Z",
  ...over,
});

const brandSummary = (over = {}) => ({
  _id: IDS.brand,
  brandName: "test cafe",
  legalBusinessName: "test cafe private limited",
  uniqueId: "DOOD-0001",
  merchantId: "MID-0001",
  logo: "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/logo.png",
  status: ST.UNDER_REVIEW,
  isApproved: false,
  isReviewed: false,
  isRejected: false,
  ...over,
});

// ---------------------------------------------------------------- common errors
const COMMON_401 = err("Access Denied! Missing authorization token");
const COMMON_403_ROLE = err(
  "Forbidden: You do not have permission to perform this action.",
);
const COMMON_401_EXPIRED = err(
  "Your session has expired. Please log in again.",
);

// =============================================================== 0. AUTH
const authFolder = {
  name: "00 — Auth (token capture)",
  description:
    "Run one of these first. The test script writes the JWT into the right environment variable, so no manual copy-paste. Login response puts the JWT at `data.token` (`services/auth/loginWithEmailAndPassword.js`).",
  item: [
    {
      name: "Login as Admin",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              'pm.test("login succeeded", function () {',
              "    pm.response.to.have.status(200);",
              "});",
              "",
              "const body = pm.response.json();",
              "if (body.success && body.data && body.data.token) {",
              '    pm.environment.set("admin_token", body.data.token);',
              "    if (body.data.user && body.data.user._id) {",
              '        pm.environment.set("admin_user_id", body.data.user._id);',
              "    }",
              '    console.log("admin_token captured");',
              "} else {",
              '    console.warn("No token in response — admin_token not set");',
              "}",
            ],
          },
        },
      ],
      request: {
        auth: { type: "noauth" },
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        body: {
          mode: "raw",
          raw: json({
            type: "EMAIL",
            email: "{{admin_email}}",
            password: "{{admin_password}}",
            role: ROLES.ADMIN,
          }),
          options: { raw: { language: "json" } },
        },
        url: url(["auth", "login"]),
        description: `Public. Email + password login. \`role\` accepts ${list(ROLES)} and defaults to ${ROLES.ADMIN} for EMAIL/MOBILE type. Captures **admin_token**.`,
      },
      response: [
        example({
          name: "200 — logged in",
          code: 200,
          status: "OK",
          body: okEnvelope("User logged in successfully", {
            user: {
              _id: IDS.admin,
              name: "Admin One",
              email: "admin@trydood.com",
              role: ROLES.ADMIN,
              isActive: true,
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          }),
        }),
      ],
    },
    {
      name: "Login as Vendor (mobile + password)",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              'pm.test("login succeeded", function () {',
              "    pm.response.to.have.status(200);",
              "});",
              "",
              "const body = pm.response.json();",
              "if (body.success && body.data && body.data.token) {",
              '    pm.environment.set("vendor_token", body.data.token);',
              "    if (body.data.user && body.data.user.brandId) {",
              '        pm.environment.set("brand_id", body.data.user.brandId);',
              "    }",
              '    console.log("vendor_token captured");',
              "} else {",
              '    console.warn("No token in response — vendor_token not set");',
              "}",
            ],
          },
        },
      ],
      request: {
        auth: { type: "noauth" },
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        body: {
          mode: "raw",
          raw: json({
            type: "MOBILE",
            mobile: "{{vendor_mobile}}",
            password: "{{vendor_password}}",
            role: ROLES.VENDOR,
          }),
          options: { raw: { language: "json" } },
        },
        url: url(["auth", "login"]),
        description:
          "Public. Captures **vendor_token** and, when present, **brand_id** from `data.user.brandId`.",
      },
      response: [
        example({
          name: "200 — logged in",
          code: 200,
          status: "OK",
          body: okEnvelope("User logged in successfully", {
            user: {
              _id: IDS.vendorUser,
              name: "Ramesh Kumar",
              mobile: "9876543210",
              role: ROLES.VENDOR,
              brandId: IDS.brand,
              currentScreen: SCREENS.UNDER_REVIEW,
              isActive: true,
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          }),
        }),
      ],
    },
    {
      name: "Vendor WhatsApp — Send OTP",
      request: {
        auth: { type: "noauth" },
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        body: {
          mode: "raw",
          raw: json({ whatsappNumber: "{{vendor_whatsapp}}" }),
          options: { raw: { language: "json" } },
        },
        url: url(["auth", "loginOrSignUp-with-whatsapp"]),
        description:
          "Public. The real vendor onboarding path. Sends a 6-digit OTP to the WhatsApp number.",
      },
      response: [],
    },
    {
      name: "Vendor WhatsApp — Verify OTP",
      event: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "const body = pm.response.json();",
              "if (body.success && body.data && body.data.token) {",
              '    pm.environment.set("vendor_token", body.data.token);',
              "    if (body.data.user && body.data.user.brandId) {",
              '        pm.environment.set("brand_id", body.data.user.brandId);',
              "    }",
              '    console.log("vendor_token captured");',
              "}",
            ],
          },
        },
      ],
      request: {
        auth: { type: "noauth" },
        method: "POST",
        header: [{ key: "Content-Type", value: "application/json" }],
        body: {
          mode: "raw",
          raw: json({
            whatsappNumber: "{{vendor_whatsapp}}",
            otp: "{{otp}}",
            role: ROLES.VENDOR,
          }),
          options: { raw: { language: "json" } },
        },
        url: url(["auth", "verify-otp-whatsapp"]),
        description: `Public. \`otp\` must be exactly 6 digits. \`role\` defaults to ${ROLES.CUSTOMER} — send ${ROLES.VENDOR} explicitly. Captures **vendor_token**.`,
      },
      response: [],
    },
  ],
};

// =============================================================== 1. VENDOR ONBOARDING
const systemVerifyRequest = {
  auth: bearer("vendor_token"),
  method: "GET",
  header: [],
  url: url(["brands", "onboarding", "system-verify"]),
  description: [
    `**Role:** ${ROLES.VENDOR} only (\`isVendor\`). **STEP 1** of approval.`,
    "",
    "Runs the automatic KYC pass: PAN / GST / Bank verification, name matching and duplicate detection. No body or query — the brand is resolved from the token.",
    "",
    `Scoring: ≥ 90 → \`${ST.APPROVED}\`, 75–89 → \`${ST.MANUAL_REVIEW}\`, < 75 → \`${ST.REJECTED}\`. A duplicate (PAN/GST/bank/WhatsApp/email) costs −20.`,
    "",
    `**Whatever the score, \`Brand.status\` becomes \`${ST.UNDER_REVIEW}\` and \`Brand.isApproved\` stays \`false\`.** Only an admin can approve.`,
    "",
    `**Re-run rule:** allowed only when the live attempt is \`${ST.REJECTED}\` or \`${ST.REVOKED}\`. An attempt waiting on the admin is locked (409).`,
    "",
    "Side effects: new SystemVerify (attemptNumber +1, previous one marked `isSuperseded`), Brand mirror reset, `user.currentScreen` → `" +
      SCREENS.PARTNERSHIP_DEED +
      "`, and a `" +
      ACT.SYSTEM_VERIFIED +
      "` / `" +
      ACT.RESUBMITTED +
      "` history row.",
  ].join("\n"),
};

const onboardingFolder = {
  name: "Brands / Onboarding (Vendor)",
  description:
    "Vendor-side steps. Source: `routes/brands.js` → `controllers/brands` → `services/systemVerify`.",
  item: [
    {
      name: "Run System Verify (KYC)",
      event: [
        baseTests([
          'pm.test("brand is parked for admin review", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(data).to.have.property("attemptNumber");',
          '    pm.expect(data).to.have.property("score");',
          "});",
          "",
          "const data = pm.response.json().data;",
          "if (data && data._id) {",
          '    pm.environment.set("system_verify_id", data._id);',
          "}",
          "if (data && data.brandId) {",
          '    pm.environment.set("brand_id", data.brandId);',
          "}",
        ]),
      ],
      request: systemVerifyRequest,
      response: [
        example({
          name: `200 — score 100, system ${ST.APPROVED}`,
          code: 200,
          status: "OK",
          req: systemVerifyRequest,
          body: okEnvelope(
            "Brand's vendor verified successfully.",
            systemVerifyRecord(),
          ),
        }),
        example({
          name: `200 — score 85, system ${ST.MANUAL_REVIEW}`,
          code: 200,
          status: "OK",
          req: systemVerifyRequest,
          body: okEnvelope(
            "Brand's vendor verified successfully.",
            systemVerifyRecord({
              score: 85,
              status: ST.MANUAL_REVIEW,
              verifiedAt: null,
              flags: { ...FLAGS_PASS, bankMatched: false },
              bankNameMatch: {
                bankPanScore: 62,
                bankGstScore: 58,
                bankBrandScore: 60,
                highestScore: 62,
              },
              remarks: ["Bank holder name mismatch (62%)"],
            }),
          ),
        }),
        example({
          name: `200 — score 55, system ${ST.REJECTED} (resubmission, attempt 2)`,
          code: 200,
          status: "OK",
          req: systemVerifyRequest,
          body: okEnvelope(
            "Brand's vendor verified successfully.",
            systemVerifyRecord({
              _id: "68a1f4c2b1e2c3d4e5f60802",
              attemptNumber: 2,
              score: 55,
              status: ST.REJECTED,
              flags: FLAGS_FAIL,
              nameMatch: {
                panGstScore: 0,
                panBrandScore: 100,
                gstBrandScore: 0,
                averageScore: 33.33,
              },
              bankNameMatch: {
                bankPanScore: 0,
                bankGstScore: 0,
                bankBrandScore: 0,
                highestScore: 0,
              },
              entityMatch: {
                gstConstitution: null,
                brandEntityType: "PROPRIETORSHIP",
                matched: true,
              },
              remarks: [
                "GST verification failed",
                "Bank verification failed",
                "Business name mismatch (33.33%)",
                "Bank holder name mismatch (0%)",
                "GST not active",
              ],
              verifiedAt: null,
              rejectedBy: BY.SYSTEM,
              rejectedAt: "2026-08-23T10:15:30.000Z",
              rejectionReason:
                "GST verification failed | Bank verification failed | Business name mismatch (33.33%) | Bank holder name mismatch (0%) | GST not active",
              isRejected: true,
            }),
          ),
        }),
        example({
          name: "400 — already approved",
          code: 400,
          status: "Bad Request",
          req: systemVerifyRequest,
          body: err(
            "Your brand is already approved. Verification cannot be run again.",
          ),
        }),
        example({
          name: "409 — still waiting on the admin",
          code: 409,
          status: "Conflict",
          req: systemVerifyRequest,
          body: err(
            "Your brand verification is already under review. Please wait for the admin's decision.",
          ),
        }),
        example({
          name: "409 — double submit (compare-and-swap lost)",
          code: 409,
          status: "Conflict",
          req: systemVerifyRequest,
          body: err(
            "Brand state changed while verifying. Please refresh and try again.",
          ),
        }),
        example({
          name: "400 — no brand linked to the user",
          code: 400,
          status: "Bad Request",
          req: systemVerifyRequest,
          body: err("Brand not found for user."),
        }),
        example({
          name: "403 — not a vendor",
          code: 403,
          status: "Forbidden",
          req: systemVerifyRequest,
          body: err("You are not authorized to verify a brand."),
        }),
        example({
          name: "403 — account deactivated",
          code: 403,
          status: "Forbidden",
          req: systemVerifyRequest,
          body: err(
            "Your account is inactive/deactivated! Please contact support.",
          ),
        }),
        example({
          name: "404 — brand deleted",
          code: 404,
          status: "Not Found",
          req: systemVerifyRequest,
          body: err("Brand not found."),
        }),
        example({
          name: "401 — no token",
          code: 401,
          status: "Unauthorized",
          req: systemVerifyRequest,
          body: COMMON_401,
        }),
      ],
    },
  ],
};

const ackRequest = {
  auth: bearer("vendor_token"),
  method: "PUT",
  header: [],
  url: url(["brands", "onboarding", "acknowledge-approval"]),
  description: [
    `**Role:** ${ROLES.VENDOR} only (\`isVendor\`). **STEP 3** of approval.`,
    "",
    "The vendor tapping *Go to Dashboard* on the congratulations screen. No body.",
    "",
    `Admin approval deliberately leaves \`user.currentScreen\` on \`${SCREENS.UNDER_REVIEW}\` so the panel can show the congratulations state. The trigger is \`brand.isApproved === true && brand.isApprovalAcknowledged === false\`. **This** call is what sets \`currentScreen\` to \`${SCREENS.DASHBOARD}\`, so a later login or refresh goes straight to the dashboard and the message never shows twice.`,
    "",
    "**Idempotent** — a double tap returns the same payload with no extra writes and no duplicate history row.",
  ].join("\n"),
};

onboardingFolder.item.push({
  name: "Acknowledge Approval",
  event: [
    baseTests([
      'pm.test("vendor is moved to the dashboard", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data.currentScreen).to.eql("' + SCREENS.DASHBOARD + '");',
      "    pm.expect(data.isApprovalAcknowledged).to.be.true;",
      "});",
    ]),
  ],
  request: ackRequest,
  response: [
    example({
      name: "200 — first acknowledgement",
      code: 200,
      status: "OK",
      req: ackRequest,
      body: okEnvelope("Welcome aboard! Redirecting you to your dashboard.", {
        brandId: IDS.brand,
        status: ST.APPROVED,
        isApproved: true,
        isApprovalAcknowledged: true,
        approvalAcknowledgedAt: "2026-08-23T11:30:00.000Z",
        currentScreen: SCREENS.DASHBOARD,
      }),
    }),
    example({
      name: "200 — repeat tap (idempotent, no writes)",
      code: 200,
      status: "OK",
      req: ackRequest,
      body: okEnvelope("Welcome aboard! Redirecting you to your dashboard.", {
        brandId: IDS.brand,
        status: ST.APPROVED,
        isApproved: true,
        isApprovalAcknowledged: true,
        approvalAcknowledgedAt: "2026-08-21T09:00:00.000Z",
        currentScreen: SCREENS.DASHBOARD,
      }),
    }),
    example({
      name: "400 — brand not approved yet",
      code: 400,
      status: "Bad Request",
      req: ackRequest,
      body: err(
        "Your brand is not approved yet. Please wait for the admin's decision.",
      ),
    }),
    example({
      name: "409 — approval revoked mid-call",
      code: 409,
      status: "Conflict",
      req: ackRequest,
      body: err(
        "Brand approval changed while acknowledging. Please refresh and try again.",
      ),
    }),
    example({
      name: "403 — not a vendor",
      code: 403,
      status: "Forbidden",
      req: ackRequest,
      body: err("You are not authorized to acknowledge brand approval."),
    }),
    example({
      name: "401 — session expired",
      code: 401,
      status: "Unauthorized",
      req: ackRequest,
      body: COMMON_401_EXPIRED,
    }),
  ],
});

// =============================================================== 2. ADMIN QUEUE
const QUEUE_QUERY = [
  { key: "page", value: "1", description: "Number ≥ 1. Default 1." },
  { key: "limit", value: "10", description: "Number 1-100. Default 10." },
  {
    key: "search",
    value: "",
    disabled: true,
    description:
      "Regex across brand.brandName, brand.legalBusinessName, brand.uniqueId, brand.merchantId and remarks.",
  },
  {
    key: "brandId",
    value: "{{brand_id}}",
    disabled: true,
    description: "ObjectId. Narrow to one brand.",
  },
  {
    key: "status",
    value: ST.MANUAL_REVIEW,
    description: `One of ${list(ST)}. Lowercase is accepted and upper-cased.`,
  },
  {
    key: "isReviewed",
    value: "false",
    description: 'Boolean or the strings "true"/"false".',
  },
  {
    key: "isRejected",
    value: "false",
    disabled: true,
    description: "Boolean or string.",
  },
  {
    key: "isRevoked",
    value: "false",
    disabled: true,
    description: "Boolean or string.",
  },
  {
    key: "isAdminApproved",
    value: "false",
    disabled: true,
    description: "Boolean or string.",
  },
  {
    key: "isSuperseded",
    value: "false",
    disabled: true,
    description:
      "Defaults to false — only live attempts. Send true to include retired attempts.",
  },
  {
    key: "attemptNumber",
    value: "1",
    disabled: true,
    description: "Number ≥ 1.",
  },
  {
    key: "reviewedByAdminId",
    value: "{{admin_user_id}}",
    disabled: true,
    description: "ObjectId of the admin who reviewed it.",
  },
  { key: "minScore", value: "75", disabled: true, description: "Number." },
  { key: "maxScore", value: "89", disabled: true, description: "Number." },
  {
    key: "fromDate",
    value: "2026-08-01",
    disabled: true,
    description: "ISO date.",
  },
  {
    key: "toDate",
    value: "2026-08-23",
    disabled: true,
    description:
      "ISO date. Cannot be earlier than fromDate. Inclusive to end-of-day.",
  },
  {
    key: "sortBy",
    value: SORT_BY.SCORE,
    description: `One of ${list(SORT_BY)}. Default ${SORT_BY.NEWEST}.`,
  },
  {
    key: "sortOrder",
    value: SORT_ORDER.DESC,
    description: `One of ${list(SORT_ORDER)}. Default ${SORT_ORDER.DESC}. Only affects sortBy=${SORT_BY.SCORE}.`,
  },
];

const queueRequest = {
  auth: bearer("admin_token"),
  method: "GET",
  header: [],
  url: url(["brands", "admin", "verifications"], QUEUE_QUERY),
  description: [
    `**Role:** ${ROLES.ADMIN} only (\`isAdmin\`).`,
    "",
    "The admin work-queue. Defaults to **live attempts only** (`isSuperseded=false`), so the list is exactly what is actionable.",
    "",
    "Each row carries the full SystemVerify record plus the joined `brand`, `vendor`, and whichever admins acted (`reviewedByAdmin`, `verifiedByAdmin`, `rejectedByAdmin`, `revokedByAdmin`), and three derived counters: `rejectionCount`, `revocationCount`, `submissionCount`.",
    "",
    "⚠️ **Empty result is `404`, not an empty array** — the shared `pagination` utility throws. Render an empty state, not an error toast.",
    "",
    "The `remarks` array is the point of this endpoint: it tells the admin what mismatched, so every document does not have to be opened by hand.",
  ].join("\n"),
};

const queueRow = systemVerifyRecord({
  attemptNumber: 2,
  score: 85,
  status: ST.MANUAL_REVIEW,
  verifiedAt: null,
  flags: { ...FLAGS_PASS, bankMatched: false },
  nameMatch: {
    panGstScore: 100,
    panBrandScore: 96,
    gstBrandScore: 96,
    averageScore: 97.33,
  },
  bankNameMatch: {
    bankPanScore: 62,
    bankGstScore: 58,
    bankBrandScore: 60,
    highestScore: 62,
  },
  remarks: ["Bank holder name mismatch (62%)"],
});

delete queueRow.supersededAt;
delete queueRow.supersededById;

const adminQueueItem = {
  name: "List Brand Verifications (queue)",
  event: [
    baseTests([
      'pm.test("queue returns a paginated envelope", function () {',
      "    pm.response.to.have.status(200);",
      "    const data = pm.response.json().data;",
      '    pm.expect(data).to.have.property("total");',
      '    pm.expect(data).to.have.property("totalPages");',
      '    pm.expect(data.data).to.be.an("array");',
      "});",
      "",
      "const rows = pm.response.json().data.data;",
      "if (rows && rows.length) {",
      '    pm.environment.set("brand_id", rows[0].brandId);',
      '    pm.environment.set("system_verify_id", rows[0]._id);',
      '    console.log("brand_id + system_verify_id captured from first row");',
      "}",
    ]),
  ],
  request: queueRequest,
  response: [
    example({
      name: "200 — one row",
      code: 200,
      status: "OK",
      req: queueRequest,
      body: okEnvelope("Brand verifications fetched successfully.", {
        total: 24,
        totalPages: 3,
        page: 1,
        limit: 10,
        data: [
          {
            ...queueRow,
            brand: {
              ...brandSummary(),
              email: "cafe@example.com",
              mobile: "9876543210",
              whatsappNumber: "9876543210",
              businessEntityType: "PROPRIETORSHIP",
              businessRegistrationStatus: "REGISTERED",
              verificationAttemptCount: 2,
            },
            vendor: {
              _id: IDS.vendorUser,
              name: "Ramesh Kumar",
              email: "ramesh@example.com",
              mobile: "9876543210",
              role: ROLES.VENDOR,
              currentScreen: SCREENS.UNDER_REVIEW,
            },
            reviewedByAdmin: null,
            verifiedByAdmin: null,
            rejectedByAdmin: null,
            revokedByAdmin: null,
            rejectionCount: 1,
            revocationCount: 0,
            submissionCount: 2,
          },
        ],
      }),
    }),
    example({
      name: "404 — nothing matched (empty state)",
      code: 404,
      status: "Not Found",
      req: queueRequest,
      body: err("No any brand verification found"),
    }),
    example({
      name: "422 — bad status enum",
      code: 422,
      status: "Unprocessable Entity",
      req: queueRequest,
      body: err("Validation failed", {
        status: `Status must be one of ${list(ST)}`,
      }),
    }),
    example({
      name: "422 — date range inverted",
      code: 422,
      status: "Unprocessable Entity",
      req: queueRequest,
      body: err("Validation failed", {
        toDate: "To date cannot be earlier than from date",
      }),
    }),
    example({
      name: "422 — limit too high",
      code: 422,
      status: "Unprocessable Entity",
      req: queueRequest,
      body: err("Validation failed", { limit: "Limit cannot exceed 100" }),
    }),
    example({
      name: "403 — not an admin",
      code: 403,
      status: "Forbidden",
      req: queueRequest,
      body: COMMON_403_ROLE,
    }),
  ],
};

// =============================================================== 3. REVIEW (5 cases)
const reviewUrl = () =>
  url(["brands", "admin", "verifications", ":brandId", "review"]);

const reviewVariable = [
  {
    key: "brandId",
    value: "{{brand_id}}",
    description: "ObjectId of the brand being actioned.",
  },
];

const reviewRequest = (bodyObj, description) => ({
  auth: bearer("admin_token"),
  method: "PUT",
  header: [{ key: "Content-Type", value: "application/json" }],
  body: {
    mode: "raw",
    raw: json(bodyObj),
    options: { raw: { language: "json" } },
  },
  url: { ...reviewUrl(), variable: reviewVariable },
  description,
});

const REVIEW_COMMON_ERRORS = (req) => [
  example({
    name: "404 — brand not found",
    code: 404,
    status: "Not Found",
    req,
    body: err("Brand not found."),
  }),
  example({
    name: "400 — system verification never ran",
    code: 400,
    status: "Bad Request",
    req,
    body: err("System verification has not been completed for this brand yet."),
  }),
  example({
    name: "404 — system verify record missing",
    code: 404,
    status: "Not Found",
    req,
    body: err("Brand's system verification record not found."),
  }),
  example({
    name: "409 — attempt superseded by a resubmission",
    code: 409,
    status: "Conflict",
    req,
    body: err(
      "This verification attempt was superseded by a newer submission. Please refresh and act on the latest one.",
    ),
  }),
  example({
    name: "409 — another admin changed it first",
    code: 409,
    status: "Conflict",
    req,
    body: err(
      "This brand verification was updated by someone else. Please refresh and try again.",
    ),
  }),
  example({
    name: "409 — brand moved while reviewing",
    code: 409,
    status: "Conflict",
    req,
    body: err(
      "Brand state changed while reviewing. Please refresh and try again.",
    ),
  }),
  example({
    name: "422 — invalid brandId (Joi, runs first)",
    code: 422,
    status: "Unprocessable Entity",
    req,
    body: err("Validation failed", { brandId: "Invalid Brand ID format" }),
  }),
  example({
    name: "400 — invalid brandId (service-level guard)",
    code: 400,
    status: "Bad Request",
    req,
    body: err("Invalid brand ID."),
  }),
  example({
    name: "400 — unknown action (service-level guard)",
    code: 400,
    status: "Bad Request",
    req,
    body: err(`Invalid review action. Allowed actions are ${list(ADMIN_ACT)}.`),
  }),
  example({
    name: "401 — admin identity missing from the request",
    code: 401,
    status: "Unauthorized",
    req,
    body: err("Admin authentication is required."),
  }),
  example({
    name: "422 — bad action",
    code: 422,
    status: "Unprocessable Entity",
    req,
    body: err("Validation failed", {
      action: `Review action must be one of ${list(ADMIN_ACT)}`,
    }),
  }),
  example({
    name: "403 — not an admin",
    code: 403,
    status: "Forbidden",
    req,
    body: COMMON_403_ROLE,
  }),
  example({
    name: "401 — no token",
    code: 401,
    status: "Unauthorized",
    req,
    body: COMMON_401,
  }),
];

const bodyFieldTable = [
  "| Field | Type | Required | Notes |",
  "|---|---|---|---|",
  `| \`action\` | enum | yes | ${list(ADMIN_ACT)} — lowercase accepted |`,
  `| \`rejectionReason\` | string 1-${LIMITS.MAX_REASON_LENGTH} | only on \`${ADMIN_ACT.REJECTED}\` | forbidden on every other action (422) |`,
  `| \`revokeReason\` | string 1-${LIMITS.MAX_REASON_LENGTH} | only on \`${ADMIN_ACT.REVOKED}\` | forbidden on every other action (422) |`,
  `| \`isReviewed\` | boolean | no | only with \`${ADMIN_ACT.REVIEWED}\`. Omit to flip, send to force |`,
  `| \`note\` | string ≤ ${LIMITS.MAX_NOTE_LENGTH} | no | any action. Lands in the history \`reason\` / \`metadata.note\` |`,
].join("\n");

// --- Case A: approve, system already approved
const caseAReq = reviewRequest(
  { action: ADMIN_ACT.APPROVED },
  [
    `**Role:** ${ROLES.ADMIN}. **Case A — confirm a system-approved brand.**`,
    "",
    `When the system had already scored the brand \`${ST.APPROVED}\`, approving is a *review*, not a re-verification: \`verifiedBy\` stays \`${BY.SYSTEM}\` and the original \`verifiedAt\` is kept. Only \`isAdminApproved\`, \`isReviewed\` and the brand mirror move.`,
    "",
    "`history.metadata.manualOverride` = `false`.",
    "",
    bodyFieldTable,
    "",
    `📌 This does **not** touch \`user.currentScreen\` — the vendor stays on \`${SCREENS.UNDER_REVIEW}\` to see the congratulations screen, and *Acknowledge Approval* is what moves them on.`,
  ].join("\n"),
);

// --- Case B: manual override
const caseBReq = reviewRequest(
  {
    action: ADMIN_ACT.APPROVED,
    note: "Bank passbook manually verified over call",
  },
  [
    `**Role:** ${ROLES.ADMIN}. **Case B — manual override.**`,
    "",
    `When the system said \`${ST.MANUAL_REVIEW}\`, \`${ST.REJECTED}\`, \`${ST.PENDING}\` or \`${ST.REVOKED}\`, approving is a manual decision: \`status\` → \`${ST.APPROVED}\`, \`verifiedBy\` → \`${BY.ADMIN}\`, and \`verifiedAt\` + \`verifiedByAdminId\` are stamped. Any earlier rejection/revocation is cleared.`,
    "",
    "`history.metadata.manualOverride` = `true`.",
    "",
    "If another admin had already toggled *reviewed*, **their** `reviewedByAdminId` / `reviewedAt` are preserved; `approvedByAdminId` is the caller.",
    "",
    bodyFieldTable,
  ].join("\n"),
);

// --- Case C: reject
const caseCReq = reviewRequest(
  {
    action: ADMIN_ACT.REJECTED,
    rejectionReason:
      "GST registration is cancelled. Please upload an active GST certificate.",
  },
  [
    `**Role:** ${ROLES.ADMIN}. **Case C — reject.**`,
    "",
    "`rejectionReason` is **mandatory**. `rejectedBy` / `rejectedAt` move to `" +
      BY.ADMIN +
      "` even when the system had already rejected it (that was not an admin decision).",
    "",
    "**One admin rejection per attempt.** Rejecting an already admin-rejected attempt returns `409` — the vendor has to resubmit first, which keeps the audit trail meaningful.",
    "",
    `📌 Failure cases do **not** change \`user.currentScreen\`. The vendor panel branches on \`brand.status\` + \`brand.rejectionReason\`.`,
    "",
    bodyFieldTable,
  ].join("\n"),
);

// --- Case D: reviewed toggle
const caseDReq = reviewRequest(
  { action: ADMIN_ACT.REVIEWED },
  [
    `**Role:** ${ROLES.ADMIN}. **Case D — "I have seen this" toggle.**`,
    "",
    "Never touches `status`. Omit `isReviewed` to flip the current value; each flip writes its own `" +
      ACT.REVIEWED +
      "` / `" +
      ACT.UNREVIEWED +
      "` history row.",
    "",
    "Blocked on an already-approved brand (`409`), because approval implies reviewed.",
    "",
    "Toggling *reviewed* before approving is **not** required — approving sets `isReviewed: true` on its own.",
    "",
    bodyFieldTable,
  ].join("\n"),
);

// --- Case D2: forced reviewed
const caseD2Req = reviewRequest(
  { action: ADMIN_ACT.REVIEWED, isReviewed: true },
  [
    `**Role:** ${ROLES.ADMIN}. **Case D2 — force the reviewed flag.**`,
    "",
    "Send an explicit boolean instead of toggling — useful for an idempotent panel checkbox. Sending the value it already holds returns `400` (`already marked as reviewed` / `already marked as not reviewed`).",
    "",
    bodyFieldTable,
  ].join("\n"),
);

// --- Case E: revoke
const caseEReq = reviewRequest(
  {
    action: ADMIN_ACT.REVOKED,
    revokeReason:
      "GST was cancelled by the department after approval. Brand suspended pending fresh documents.",
  },
  [
    `**Role:** ${ROLES.ADMIN}. **Case E — withdraw an approval already granted.**`,
    "",
    `\`revokeReason\` is **mandatory**. Only an approved brand can be revoked (\`409\` otherwise) — this is the correct action when someone reaches for *reject* on an approved brand.`,
    "",
    `\`status\` → \`${ST.REVOKED}\`, \`brand.isApproved\` → \`false\`, and \`isAdminApproved\` goes back to \`false\` so the attempt is **actionable again**. Two ways forward, both open:`,
    "",
    `1. Admin sends \`${ADMIN_ACT.APPROVED}\` again → re-approved via the manual-override path`,
    "2. Vendor re-runs *Run System Verify* → brand new attempt",
    "",
    "`isApprovalAcknowledged` is reset, so a later re-approval shows the congratulations screen again.",
    "",
    `Because \`isApproved\` drives \`isVerified\` in the customer voucher listing (\`helpers/vouchers/customerListing.js\`), a revoked brand immediately reads as unverified to customers.`,
    "",
    bodyFieldTable,
  ].join("\n"),
);

const reviewTests = (assertions) =>
  baseTests([
    ...assertions,
    "",
    "const data = pm.response.json().data;",
    "if (data && data.historyId) {",
    '    pm.environment.set("history_id", data.historyId);',
    "}",
  ]);

const adminReviewFolder = {
  name: "Brands / Admin — Verification",
  description: [
    "Admin-side decisions. All of these hit the **same route** —",
    "`PUT /brands/admin/verifications/:brandId/review` — and are split into one request",
    "per case so each carries its own body and examples.",
    "",
    "Every write runs inside a transaction with optimistic locking, so two admins acting",
    "at once gives the loser a `409` instead of a silent overwrite.",
  ].join("\n"),
  item: [
    adminQueueItem,
    {
      name: `Review — Approve (Case A: system already ${ST.APPROVED})`,
      event: [
        reviewTests([
          'pm.test("brand approved, system credit preserved", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(data.action).to.eql("' + ACT.APPROVED + '");',
          "    pm.expect(data.isApproved).to.be.true;",
          "    pm.expect(data.isAdminApproved).to.be.true;",
          "    pm.expect(data.isReviewed).to.be.true;",
          '    pm.expect(data.verifiedBy).to.eql("' + BY.SYSTEM + '");',
          "});",
        ]),
      ],
      request: caseAReq,
      response: [
        example({
          name: "200 — approved (verifiedBy stays SYSTEM)",
          code: 200,
          status: "OK",
          req: caseAReq,
          body: okEnvelope("Brand approved successfully.", reviewResult()),
        }),
        example({
          name: "409 — already approved",
          code: 409,
          status: "Conflict",
          req: caseAReq,
          body: err("This brand is already approved."),
        }),
        example({
          name: "422 — rejectionReason not allowed here",
          code: 422,
          status: "Unprocessable Entity",
          req: caseAReq,
          body: err("Validation failed", {
            rejectionReason:
              "Rejection reason is only allowed when rejecting a brand",
          }),
        }),
        example({
          name: "422 — revokeReason not allowed here",
          code: 422,
          status: "Unprocessable Entity",
          req: caseAReq,
          body: err("Validation failed", {
            revokeReason:
              "Revoke reason is only allowed when revoking an approval",
          }),
        }),
        example({
          name: "422 — isReviewed not allowed here",
          code: 422,
          status: "Unprocessable Entity",
          req: caseAReq,
          body: err("Validation failed", {
            isReviewed: "isReviewed is only allowed with the REVIEWED action",
          }),
        }),
        ...REVIEW_COMMON_ERRORS(caseAReq),
      ],
    },
    {
      name: "Review — Approve (Case B: manual override)",
      event: [
        reviewTests([
          'pm.test("manual approval credits the admin", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(data.action).to.eql("' + ACT.APPROVED + '");',
          "    pm.expect(data.isApproved).to.be.true;",
          '    pm.expect(data.verifiedBy).to.eql("' + BY.ADMIN + '");',
          '    pm.expect(data.status).to.eql("' + ST.APPROVED + '");',
          "});",
        ]),
      ],
      request: caseBReq,
      response: [
        example({
          name: `200 — approved from ${ST.MANUAL_REVIEW} (verifiedBy → ADMIN)`,
          code: 200,
          status: "OK",
          req: caseBReq,
          body: okEnvelope(
            "Brand approved successfully.",
            reviewResult({
              attemptNumber: 2,
              score: 85,
              previousStatus: ST.MANUAL_REVIEW,
              verifiedBy: BY.ADMIN,
            }),
          ),
        }),
        example({
          name: `200 — approved from ${ST.REVOKED} (re-approval)`,
          code: 200,
          status: "OK",
          req: caseBReq,
          body: okEnvelope(
            "Brand approved successfully.",
            reviewResult({
              previousStatus: ST.REVOKED,
              verifiedBy: BY.ADMIN,
            }),
          ),
        }),
        example({
          name: "400 — note too long",
          code: 400,
          status: "Bad Request",
          req: caseBReq,
          body: err(`Note cannot exceed ${LIMITS.MAX_NOTE_LENGTH} characters.`),
        }),
        ...REVIEW_COMMON_ERRORS(caseBReq),
      ],
    },
    {
      name: "Review — Reject (Case C)",
      event: [
        reviewTests([
          'pm.test("brand rejected with a reason", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(data.action).to.eql("' + ACT.REJECTED + '");',
          "    pm.expect(data.isApproved).to.be.false;",
          "    pm.expect(data.isRejected).to.be.true;",
          '    pm.expect(data.rejectionReason).to.be.a("string");',
          "});",
        ]),
      ],
      request: caseCReq,
      response: [
        example({
          name: "200 — rejected",
          code: 200,
          status: "OK",
          req: caseCReq,
          body: okEnvelope(
            "Brand rejected successfully.",
            reviewResult({
              action: ACT.REJECTED,
              score: 85,
              previousStatus: ST.MANUAL_REVIEW,
              status: ST.REJECTED,
              brandStatus: ST.REJECTED,
              isRejected: true,
              isAdminApproved: false,
              isApproved: false,
              verifiedBy: null,
              rejectionReason:
                "GST registration is cancelled. Please upload an active GST certificate.",
              reviewedAt: "2026-08-23T11:05:00.000Z",
            }),
          ),
        }),
        example({
          name: `200 — rejected after the system had also rejected (rejectedBy → ${BY.ADMIN})`,
          code: 200,
          status: "OK",
          req: caseCReq,
          body: okEnvelope(
            "Brand rejected successfully.",
            reviewResult({
              action: ACT.REJECTED,
              score: 55,
              previousStatus: ST.REJECTED,
              status: ST.REJECTED,
              brandStatus: ST.REJECTED,
              isRejected: true,
              isAdminApproved: false,
              isApproved: false,
              verifiedBy: null,
              rejectionReason:
                "PAN name mismatch confirmed with the applicant.",
            }),
          ),
        }),
        example({
          name: "409 — approved brand cannot be rejected",
          code: 409,
          status: "Conflict",
          req: caseCReq,
          body: err(
            "An approved brand cannot be rejected. Revoke the approval instead.",
          ),
        }),
        example({
          name: "409 — this attempt is already admin-rejected",
          code: 409,
          status: "Conflict",
          req: caseCReq,
          body: err(
            "This verification attempt is already rejected. The vendor must resubmit before it can be actioned again.",
          ),
        }),
        example({
          name: "422 — reason missing",
          code: 422,
          status: "Unprocessable Entity",
          req: caseCReq,
          body: err("Validation failed", {
            rejectionReason:
              "Rejection reason is required when rejecting a brand",
          }),
        }),
        example({
          name: "422 — reason too long",
          code: 422,
          status: "Unprocessable Entity",
          req: caseCReq,
          body: err("Validation failed", {
            rejectionReason: `Rejection reason cannot exceed ${LIMITS.MAX_REASON_LENGTH} characters`,
          }),
        }),
        example({
          name: "400 — reason missing (service-level guard)",
          code: 400,
          status: "Bad Request",
          req: caseCReq,
          body: err("Rejection reason is required when rejecting a brand."),
        }),
        ...REVIEW_COMMON_ERRORS(caseCReq),
      ],
    },
    {
      name: "Review — Toggle Reviewed (Case D)",
      event: [
        reviewTests([
          'pm.test("only the reviewed flag moved", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(["' +
            ACT.REVIEWED +
            '", "' +
            ACT.UNREVIEWED +
            '"]).to.include(data.action);',
          "    pm.expect(data.status).to.eql(data.previousStatus);",
          "    pm.expect(data.isApproved).to.be.false;",
          "});",
        ]),
      ],
      request: caseDReq,
      response: [
        example({
          name: "200 — flipped false → true",
          code: 200,
          status: "OK",
          req: caseDReq,
          body: okEnvelope(
            "Brand marked as reviewed.",
            reviewResult({
              action: ACT.REVIEWED,
              score: 85,
              previousStatus: ST.MANUAL_REVIEW,
              status: ST.MANUAL_REVIEW,
              brandStatus: ST.UNDER_REVIEW,
              isReviewed: true,
              isAdminApproved: false,
              isApproved: false,
              reviewedAt: "2026-08-23T11:10:00.000Z",
            }),
          ),
        }),
        example({
          name: "200 — flipped true → false (UNREVIEWED)",
          code: 200,
          status: "OK",
          req: caseDReq,
          body: okEnvelope(
            "Brand marked as not reviewed.",
            reviewResult({
              action: ACT.UNREVIEWED,
              score: 85,
              previousStatus: ST.MANUAL_REVIEW,
              status: ST.MANUAL_REVIEW,
              brandStatus: ST.UNDER_REVIEW,
              isReviewed: false,
              isAdminApproved: false,
              isApproved: false,
              reviewedAt: "2026-08-23T11:12:00.000Z",
            }),
          ),
        }),
        example({
          name: "409 — cannot un-review an approved brand",
          code: 409,
          status: "Conflict",
          req: caseDReq,
          body: err(
            "The reviewed flag cannot be changed for an already approved brand.",
          ),
        }),
        ...REVIEW_COMMON_ERRORS(caseDReq),
      ],
    },
    {
      name: "Review — Force Reviewed flag (Case D2)",
      event: [
        reviewTests([
          'pm.test("reviewed flag forced to the requested value", function () {',
          "    pm.response.to.have.status(200);",
          "    pm.expect(pm.response.json().data.isReviewed).to.be.true;",
          "});",
        ]),
      ],
      request: caseD2Req,
      response: [
        example({
          name: "200 — forced to true",
          code: 200,
          status: "OK",
          req: caseD2Req,
          body: okEnvelope(
            "Brand marked as reviewed.",
            reviewResult({
              action: ACT.REVIEWED,
              score: 85,
              previousStatus: ST.MANUAL_REVIEW,
              status: ST.MANUAL_REVIEW,
              brandStatus: ST.UNDER_REVIEW,
              isReviewed: true,
              isAdminApproved: false,
              isApproved: false,
            }),
          ),
        }),
        example({
          name: "400 — already in that state",
          code: 400,
          status: "Bad Request",
          req: caseD2Req,
          body: err("This brand's verification is already marked as reviewed."),
        }),
        example({
          name: "400 — already not reviewed",
          code: 400,
          status: "Bad Request",
          req: caseD2Req,
          body: err(
            "This brand's verification is already marked as not reviewed.",
          ),
        }),
        example({
          name: "422 — isReviewed must be boolean",
          code: 422,
          status: "Unprocessable Entity",
          req: caseD2Req,
          body: err("Validation failed", {
            isReviewed: "isReviewed must be a boolean",
          }),
        }),
        ...REVIEW_COMMON_ERRORS(caseD2Req),
      ],
    },
    {
      name: "Review — Revoke Approval (Case E)",
      event: [
        reviewTests([
          'pm.test("approval withdrawn and attempt reopened", function () {',
          "    pm.response.to.have.status(200);",
          "    const data = pm.response.json().data;",
          '    pm.expect(data.action).to.eql("' + ACT.REVOKED + '");',
          '    pm.expect(data.status).to.eql("' + ST.REVOKED + '");',
          "    pm.expect(data.isApproved).to.be.false;",
          "    pm.expect(data.isRevoked).to.be.true;",
          "    pm.expect(data.isAdminApproved).to.be.false;",
          '    pm.expect(data.revokeReason).to.be.a("string");',
          "});",
        ]),
      ],
      request: caseEReq,
      response: [
        example({
          name: "200 — approval revoked",
          code: 200,
          status: "OK",
          req: caseEReq,
          body: okEnvelope(
            "Brand approval revoked successfully.",
            reviewResult({
              action: ACT.REVOKED,
              previousStatus: ST.APPROVED,
              status: ST.REVOKED,
              brandStatus: ST.REVOKED,
              isRevoked: true,
              isAdminApproved: false,
              isApproved: false,
              verifiedBy: null,
              revokeReason:
                "GST was cancelled by the department after approval. Brand suspended pending fresh documents.",
              reviewedAt: "2026-08-23T12:00:00.000Z",
            }),
          ),
        }),
        example({
          name: "409 — brand was never approved",
          code: 409,
          status: "Conflict",
          req: caseEReq,
          body: err("Only an approved brand can have its approval revoked."),
        }),
        example({
          name: "422 — revoke reason missing",
          code: 422,
          status: "Unprocessable Entity",
          req: caseEReq,
          body: err("Validation failed", {
            revokeReason: "Revoke reason is required when revoking an approval",
          }),
        }),
        example({
          name: "422 — revoke reason too long",
          code: 422,
          status: "Unprocessable Entity",
          req: caseEReq,
          body: err("Validation failed", {
            revokeReason: `Revoke reason cannot exceed ${LIMITS.MAX_REASON_LENGTH} characters`,
          }),
        }),
        example({
          name: "400 — revoke reason missing (service-level guard)",
          code: 400,
          status: "Bad Request",
          req: caseEReq,
          body: err("Revoke reason is required when revoking an approval."),
        }),
        ...REVIEW_COMMON_ERRORS(caseEReq),
      ],
    },
  ],
};

// =============================================================== 4. HISTORY
const HISTORY_QUERY = (extra = {}) => [
  { key: "page", value: "1", description: "Number ≥ 1. Default 1." },
  { key: "limit", value: "20", description: "Number 1-100. Default 10." },
  {
    key: "brandId",
    value: extra.brandId || "{{brand_id}}",
    disabled: extra.brandIdDisabled === true,
    description:
      "ObjectId. IGNORED for vendors — the service force-scopes them to their own brand.",
  },
  {
    key: "systemVerifyId",
    value: "{{system_verify_id}}",
    disabled: true,
    description: "ObjectId. Narrow to a single attempt.",
  },
  {
    key: "performedBy",
    value: "{{admin_user_id}}",
    disabled: true,
    description: "ObjectId of the user who performed the action.",
  },
  {
    key: "action",
    value: ACT.REJECTED,
    disabled: true,
    description: `One of ${list(ACT)}.`,
  },
  {
    key: "performedByType",
    value: ACTOR.ADMIN,
    disabled: true,
    description: `One of ${list(ACTOR)}.`,
  },
  {
    key: "attemptNumber",
    value: "2",
    disabled: true,
    description: "Number ≥ 1.",
  },
  {
    key: "search",
    value: "DOOD-0001",
    disabled: true,
    description: "Regex across brandUniqueId, merchantId and reason.",
  },
  {
    key: "fromDate",
    value: "2026-08-01",
    disabled: true,
    description: "ISO date.",
  },
  {
    key: "toDate",
    value: "2026-08-23",
    disabled: true,
    description: "ISO date. Cannot be earlier than fromDate.",
  },
  {
    key: "sortOrder",
    value: SORT_ORDER.DESC,
    description: `One of ${list(SORT_ORDER)} on createdAt. Default ${SORT_ORDER.DESC}.`,
  },
];

const historyAdminReq = {
  auth: bearer("admin_token"),
  method: "GET",
  header: [],
  url: url(["brands", "verifications", "history"], HISTORY_QUERY()),
  description: [
    "**Role:** any authenticated user (`verifyJwtToken`). This request uses the **admin** token.",
    "",
    "Append-only audit trail — nothing here is ever mutated, so a brand rejected three times has three separate rows with their own dates, admins and reasons.",
    "",
    "Admin view returns everything: `score`, `metadata`, `merchantId`, `brandUniqueId` and the joined `performedByUser`.",
    "",
    "⚠️ Empty result is `404` (`No any brand verification history found`), not an empty array.",
  ].join("\n"),
};

const historyVendorReq = {
  auth: bearer("vendor_token"),
  method: "GET",
  header: [],
  url: url(
    ["brands", "verifications", "history"],
    HISTORY_QUERY({ brandIdDisabled: true }),
  ),
  description: [
    "**Role:** any authenticated user (`verifyJwtToken`). This request uses the **vendor** token.",
    "",
    "A vendor is force-scoped to its own brand — passing someone else's `brandId` is silently ignored, it cannot widen the scope.",
    "",
    "The projection is trimmed: **no** `score`, `metadata`, `merchantId`, `brandUniqueId` or `performedByUser`. Scoring internals and which admin acted stay admin-side. The vendor still sees every rejection, when it happened and why (`reason`).",
  ].join("\n"),
};

const historyRowAdmin = {
  _id: "68a1f4c2b1e2c3d4e5f60905",
  brandId: IDS.brand,
  systemVerifyId: IDS.systemVerify,
  action: ACT.REJECTED,
  performedByType: ACTOR.ADMIN,
  performedBy: IDS.admin,
  attemptNumber: 2,
  brandUniqueId: "DOOD-0001",
  merchantId: "MID-0001",
  score: 85,
  previousStatus: ST.MANUAL_REVIEW,
  newStatus: ST.REJECTED,
  reason:
    "GST registration is cancelled. Please upload an active GST certificate.",
  metadata: {
    requestedAction: ADMIN_ACT.REJECTED,
    previousBrandStatus: ST.UNDER_REVIEW,
    newBrandStatus: ST.REJECTED,
    previousFlags: {
      isReviewed: false,
      isRejected: false,
      isRevoked: false,
      isAdminApproved: false,
      isBrandApproved: false,
    },
    newFlags: {
      isReviewed: true,
      isRejected: true,
      isRevoked: false,
      isAdminApproved: false,
      isBrandApproved: false,
    },
    systemScore: 85,
    systemRemarks: ["Bank holder name mismatch (62%)"],
    note: null,
    manualOverride: false,
  },
  createdAt: "2026-08-23T11:05:00.000Z",
  updatedAt: "2026-08-23T11:05:00.000Z",
  brand: brandSummary({
    status: ST.REJECTED,
    isReviewed: true,
    isRejected: true,
  }),
  performedByUser: {
    _id: IDS.admin,
    name: "Admin One",
    email: "admin@trydood.com",
    mobile: "9999999999",
    role: ROLES.ADMIN,
  },
};

const historyRowSystem = {
  _id: "68a1f4c2b1e2c3d4e5f60899",
  brandId: IDS.brand,
  systemVerifyId: IDS.systemVerify,
  action: ACT.RESUBMITTED,
  performedByType: ACTOR.SYSTEM,
  performedBy: IDS.vendorUser,
  attemptNumber: 2,
  brandUniqueId: "DOOD-0001",
  merchantId: "MID-0001",
  score: 85,
  previousStatus: ST.REJECTED,
  newStatus: ST.MANUAL_REVIEW,
  reason: null,
  metadata: {
    triggeredByType: ACTOR.VENDOR,
    triggeredBy: IDS.vendorUser,
    isResubmission: true,
    previousSystemVerifyId: IDS.prevSystemVerify,
    systemStatus: ST.MANUAL_REVIEW,
    brandStatus: ST.UNDER_REVIEW,
    flags: { ...FLAGS_PASS, bankMatched: false },
    nameMatch: {
      panGstScore: 100,
      panBrandScore: 96,
      gstBrandScore: 96,
      averageScore: 97.33,
    },
    bankNameMatch: {
      bankPanScore: 62,
      bankGstScore: 58,
      bankBrandScore: 60,
      highestScore: 62,
    },
    entityMatch: {
      gstConstitution: "Proprietorship",
      brandEntityType: "PROPRIETORSHIP",
      matched: true,
    },
    duplicateDetails: EMPTY_DUPES,
    remarks: ["Bank holder name mismatch (62%)"],
  },
  createdAt: "2026-08-23T10:15:30.000Z",
  updatedAt: "2026-08-23T10:15:30.000Z",
  brand: brandSummary(),
  performedByUser: {
    _id: IDS.vendorUser,
    name: "Ramesh Kumar",
    email: "ramesh@example.com",
    mobile: "9876543210",
    role: ROLES.VENDOR,
  },
};

const historyRowAck = {
  _id: "68a1f4c2b1e2c3d4e5f60906",
  brandId: IDS.brand,
  systemVerifyId: IDS.systemVerify,
  action: ACT.APPROVAL_ACKNOWLEDGED,
  performedByType: ACTOR.VENDOR,
  performedBy: IDS.vendorUser,
  attemptNumber: 2,
  brandUniqueId: "DOOD-0001",
  merchantId: "MID-0001",
  score: null,
  previousStatus: ST.APPROVED,
  newStatus: ST.APPROVED,
  reason: null,
  metadata: {
    acknowledgedAt: "2026-08-23T11:30:00.000Z",
    previousScreen: SCREENS.UNDER_REVIEW,
    newScreen: SCREENS.DASHBOARD,
  },
  createdAt: "2026-08-23T11:30:00.000Z",
  updatedAt: "2026-08-23T11:30:00.000Z",
  brand: brandSummary({
    status: ST.APPROVED,
    isApproved: true,
    isReviewed: true,
  }),
  performedByUser: {
    _id: IDS.vendorUser,
    name: "Ramesh Kumar",
    email: "ramesh@example.com",
    mobile: "9876543210",
    role: ROLES.VENDOR,
  },
};

const historyRowVendorView = {
  _id: "68a1f4c2b1e2c3d4e5f60905",
  brandId: IDS.brand,
  action: ACT.REJECTED,
  performedByType: ACTOR.ADMIN,
  attemptNumber: 2,
  previousStatus: ST.MANUAL_REVIEW,
  newStatus: ST.REJECTED,
  reason:
    "GST registration is cancelled. Please upload an active GST certificate.",
  createdAt: "2026-08-23T11:05:00.000Z",
  brand: brandSummary({
    status: ST.REJECTED,
    isReviewed: true,
    isRejected: true,
  }),
};

const historyFolder = {
  name: "Brands / Verification History",
  description:
    "Shared audit trail. Same route for both roles — the service decides the scope and the projection from `req.role`.",
  item: [
    {
      name: "Get Verification History (Admin view)",
      event: [
        baseTests([
          'pm.test("full admin projection", function () {',
          "    pm.response.to.have.status(200);",
          "    const rows = pm.response.json().data.data;",
          '    pm.expect(rows).to.be.an("array");',
          "    if (rows.length) {",
          '        pm.expect(rows[0]).to.have.property("action");',
          '        pm.expect(rows[0]).to.have.property("metadata");',
          "    }",
          "});",
        ]),
      ],
      request: historyAdminReq,
      response: [
        example({
          name: "200 — full trail (admin)",
          code: 200,
          status: "OK",
          req: historyAdminReq,
          body: okEnvelope("Brand verification history fetched successfully.", {
            total: 6,
            totalPages: 1,
            page: 1,
            limit: 20,
            data: [historyRowAck, historyRowAdmin, historyRowSystem],
          }),
        }),
        example({
          name: "404 — no history yet (empty state)",
          code: 404,
          status: "Not Found",
          req: historyAdminReq,
          body: err("No any brand verification history found"),
        }),
        example({
          name: "422 — bad action enum",
          code: 422,
          status: "Unprocessable Entity",
          req: historyAdminReq,
          body: err("Validation failed", {
            action: `Action must be one of ${list(ACT)}`,
          }),
        }),
        example({
          name: "422 — bad performedByType",
          code: 422,
          status: "Unprocessable Entity",
          req: historyAdminReq,
          body: err("Validation failed", {
            performedByType: `Performed by type must be one of ${list(ACTOR)}`,
          }),
        }),
        example({
          name: "422 — invalid systemVerifyId",
          code: 422,
          status: "Unprocessable Entity",
          req: historyAdminReq,
          body: err("Validation failed", {
            systemVerifyId: "Invalid System Verify ID format",
          }),
        }),
        example({
          name: "401 — no token",
          code: 401,
          status: "Unauthorized",
          req: historyAdminReq,
          body: COMMON_401,
        }),
      ],
    },
    {
      name: "Get Verification History (Vendor view — own brand only)",
      event: [
        baseTests([
          'pm.test("vendor projection hides admin internals", function () {',
          "    pm.response.to.have.status(200);",
          "    const rows = pm.response.json().data.data;",
          "    if (rows.length) {",
          '        pm.expect(rows[0]).to.not.have.property("score");',
          '        pm.expect(rows[0]).to.not.have.property("metadata");',
          '        pm.expect(rows[0]).to.not.have.property("performedByUser");',
          '        pm.expect(rows[0]).to.have.property("reason");',
          "    }",
          "});",
        ]),
      ],
      request: historyVendorReq,
      response: [
        example({
          name: "200 — trimmed trail (vendor)",
          code: 200,
          status: "OK",
          req: historyVendorReq,
          body: okEnvelope("Brand verification history fetched successfully.", {
            total: 6,
            totalPages: 1,
            page: 1,
            limit: 20,
            data: [historyRowVendorView],
          }),
        }),
        example({
          name: "400 — vendor has no brand linked",
          code: 400,
          status: "Bad Request",
          req: historyVendorReq,
          body: err("Brand not found for user."),
        }),
        example({
          name: "404 — no history yet (empty state)",
          code: 404,
          status: "Not Found",
          req: historyVendorReq,
          body: err("No any brand verification history found"),
        }),
      ],
    },
  ],
};

// =============================================================== COLLECTION
const collection = {
  info: {
    _postman_id: "b7a1e4c2-9f31-4d8b-a6c5-brandverify001",
    name: "Trydood 2.0 — Brand Verification & Admin Approval",
    description: [
      "# Trydood 2.0 — Brand Verification & Admin Approval",
      "",
      "Brand KYC system verification + admin approve / reject / revoke / reviewed-toggle + audit trail.",
      "**5 feature endpoints** (plus an auth folder for token capture), generated from the `server2.0` codebase.",
      "",
      "Companion doc: `server2.0/docs/brand_verification_api_doc.md`",
      "Deferred items: `server2.0/docs/brand_verification_future_updates.md`",
      "",
      "## Flow",
      "",
      "```",
      "STEP 1 — SYSTEM   vendor  → GET  /brands/onboarding/system-verify",
      "STEP 2 — ADMIN    admin   → PUT  /brands/admin/verifications/:brandId/review",
      "STEP 3 — VENDOR   vendor  → PUT  /brands/onboarding/acknowledge-approval",
      "```",
      "",
      "The system never auto-approves: whatever it scores, `Brand.status` becomes",
      "`" +
        ST.UNDER_REVIEW +
        "` and `Brand.isApproved` stays `false` until an admin acts.",
      "",
      "## Getting started",
      "",
      "1. Import this collection and the environment for your target (`local` / `staging` / `production`).",
      "2. Run **00 — Auth → Login as Admin** and **Login as Vendor**. The test scripts write `admin_token`, `vendor_token`, `admin_user_id` and `brand_id` into the environment automatically.",
      "3. Run **List Brand Verifications (queue)** — it captures `brand_id` and `system_verify_id` from the first row, so the review requests are ready to fire.",
      "",
      "## Two sources of truth",
      "",
      "| Collection | Holds | Read by |",
      "|---|---|---|",
      "| `systemverifies` | Full KYC detail — score, flags, name-match %, duplicates, remarks | Admin panel |",
      "| `brands` | Mirror of the final decision only — status, isApproved, reasons | Vendor panel + customer app |",
      "| `brandverificationhistories` | Append-only audit trail, one row per event | Both panels |",
      "",
      "## Enums",
      "",
      "- `SYSTEM_VERIFICATION_STATUS`: " + list(ST),
      "- admin `action`: " + list(ADMIN_ACT),
      "- history `action`: " + list(ACT),
      "- `performedByType`: " + list(ACTOR),
      "- `verifiedBy` / `rejectedBy` / `revokedBy`: " + list(BY),
      "- `sortBy`: " + list(SORT_BY) + " · `sortOrder`: " + list(SORT_ORDER),
      "- reason/note max length: " + LIMITS.MAX_REASON_LENGTH + " chars",
      "",
      "## Gotcha — list endpoints return 404 when empty",
      "",
      "The shared `pagination` utility throws `404` instead of returning an empty array.",
      "Treat `404` on the queue and history endpoints as an empty state, not an error.",
    ].join("\n"),
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: bearer("admin_token"),
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
      description:
        "API root. Mounted at /trydood/v1 in index.js. Overridden per environment.",
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
      key: "brand_id",
      value: IDS.brand,
      type: "string",
      description: "Brand ObjectId under review.",
    },
    {
      key: "system_verify_id",
      value: IDS.systemVerify,
      type: "string",
      description: "Live SystemVerify attempt id.",
    },
    {
      key: "history_id",
      value: "",
      type: "string",
      description: "Last history row id returned by a review call.",
    },
    {
      key: "admin_user_id",
      value: IDS.admin,
      type: "string",
      description: "Admin user ObjectId.",
    },
  ],
  item: [authFolder, onboardingFolder, adminReviewFolder, historyFolder],
};

// =============================================================== ENVIRONMENTS
const envFile = (name, baseUrl, extra = {}) => ({
  id: `env-brandverify-${name}`,
  name: `Trydood 2.0 — Brand Verification (${name})`,
  values: [
    { key: "base_url", value: baseUrl, type: "default", enabled: true },
    { key: "admin_token", value: "", type: "secret", enabled: true },
    { key: "vendor_token", value: "", type: "secret", enabled: true },
    {
      key: "admin_email",
      value: extra.adminEmail || "admin@trydood.com",
      type: "default",
      enabled: true,
    },
    { key: "admin_password", value: "", type: "secret", enabled: true },
    {
      key: "vendor_mobile",
      value: extra.vendorMobile || "9876543210",
      type: "default",
      enabled: true,
    },
    { key: "vendor_password", value: "", type: "secret", enabled: true },
    {
      key: "vendor_whatsapp",
      value: extra.vendorWhatsapp || "9876543210",
      type: "default",
      enabled: true,
    },
    { key: "otp", value: "", type: "default", enabled: true },
    { key: "brand_id", value: "", type: "default", enabled: true },
    { key: "system_verify_id", value: "", type: "default", enabled: true },
    { key: "history_id", value: "", type: "default", enabled: true },
    { key: "admin_user_id", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

// =============================================================== WRITE
fs.mkdirSync(ENV_DIR, { recursive: true });

const files = [
  ["trydood-brand-verification.postman_collection.json", collection],
  [
    "environments/local.postman_environment.json",
    envFile("local", "http://localhost:8080/trydood/v1"),
  ],
  [
    "environments/staging.postman_environment.json",
    envFile("staging", "https://backend2-0-4v4i.onrender.com/trydood/v1"),
  ],
  [
    "environments/production.postman_environment.json",
    envFile("production", "https://api.trydood.com/trydood/v1"),
  ],
];

for (const [rel, obj] of files) {
  const target = path.join(OUT, rel);
  fs.writeFileSync(target, json(obj) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}
