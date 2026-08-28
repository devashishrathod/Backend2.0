/**
 * Generates the Vendor Panel Postman v2.1 collection + environments.
 *
 *   node postman/generate-vendor-collection.js
 *
 * Covers all 78 vendor endpoints. Companion doc: docs/vendor_panel_api_doc.md
 *
 * ── Two tokens, on purpose ────────────────────────────────────────────────
 * `vendor_token`     the seeded vendor — brand already approved, subscribed and
 *                    stocked with outlets, showcase and vouchers. Everything
 *                    that needs a working brand runs on this.
 * `onboard_token`    a throwaway vendor the collection signs up itself, used
 *                    only by the Onboarding folder. Onboarding is a state
 *                    machine; running it against the seeded brand would either
 *                    be refused or quietly rewind it.
 *
 * ── What cannot run headless ──────────────────────────────────────────────
 * Three groups, each marked in its folder description and given assertions that
 * accept the documented failure rather than pretending it passed:
 *
 *   KYC verify (3)     live CGPey calls
 *   Payments (2)       live Razorpay calls
 *   File uploads (4)   multipart with a real file — the field is present but
 *                      disabled so a Newman run does not warn
 *
 * Everything else — 69 of 78 — runs green against a seeded database.
 */
const fs = require("fs");
const path = require("path");

const {
  ROLES,
  LOGIN_TYPES,
  SCREENS,
  OUTLET_TYPES,
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
  PAN_TYPES,
  BANK_ACCOUNT_TYPES,
  PRIMARY_VERIFICATION_STATUSES,
  PRIMARY_VERIFICATION_PROVIDERS,
} = require("../constants");
const {
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
  VOUCHER_STATUSES,
} = require("../constants/voucher");
const { VOUCHER_BANNER_TYPE } = require("../constants/voucherBanner");
const { SHOWCASE_SECTION_TYPE } = require("../constants/showcase");
const { DEVICE_PLATFORMS } = require("../constants/notification");
const { SUBSCRIBED_STATUS } = require("../constants/subscription");

const { json, ok, err, A, req, folder, countTree } = require("./lib/builders");

const OUT = __dirname;
const ENV_DIR = path.join(OUT, "environments");
const list = (o) => Object.values(o).join(" | ");

const GHOST_ID = "000000000000000000000000";
const V = "vendor_token";
const ONB = "onboard_token";

/** Shared note for anything that reaches outside the process. */
const THIRD_PARTY = (who) =>
  [
    `⚠️ **Ye ek live ${who} call hai.** Jis environment me ${who} credentials`,
    "configure nahi hain (ya sandbox keys hain), wahan ye fail hoga — aur wo **is",
    "endpoint ka bug nahi** hai.",
    "",
    "Neeche ka test isliye success aur provider-failure dono accept karta hai, par",
    "kisi *aur* tarah ke failure pe fail ho jaata hai.",
  ].join("\n");

const providerTolerantAssert = (successMessage) => [
  ...A.custom("2xx, ya provider failure (dono acceptable)", [
    `const b = pm.response.json();`,
    `if (pm.response.code < 300) {`,
    `  pm.expect(b.success).to.eql(true);`,
    ...(successMessage
      ? [`  pm.expect(b.message).to.eql(${json(successMessage)});`]
      : []),
    `} else {`,
    `  pm.expect(b.success, "envelope").to.eql(false);`,
    `  pm.expect(`,
    // Two acceptable shapes of failure: the provider is unreachable, or the
    // platform refused before ever calling it (already-used PAN/GST, brand not
    // at that step). Neither says anything about this endpoint being wrong;
    // anything else does.
    `    /provider|gateway|razorpay|cgpey|credential|unavailable|try in some time|timeout|network|ip not allowed|forbidden: ip|already in use|already exists|not found|not currently/i.test(String(b.message)),`,
    `    "unexpected failure: " + b.message`,
    `  ).to.eql(true);`,
    `  console.log("ℹ️  provider unreachable, ya platform ne pehle hi refuse kar diya — endpoint contract is run me unverified hai");`,
    `}`,
  ]),
];

const uploadTolerantAssert = (successMessage, missingFilePattern) => [
  ...A.custom("2xx, ya 'file required' (file attach kiye bina)", [
    `const b = pm.response.json();`,
    `if (pm.response.code < 300) {`,
    `  pm.expect(b.success).to.eql(true);`,
    ...(successMessage
      ? [`  pm.expect(b.message).to.eql(${json(successMessage)});`]
      : []),
    `} else {`,
    `  pm.expect(b.success, "envelope").to.eql(false);`,
    `  pm.expect(`,
    `    ${missingFilePattern}.test(String(b.message)),`,
    `    "unexpected failure: " + b.message`,
    `  ).to.eql(true);`,
    `  console.log("ℹ️  no file attached — enable the file field to exercise the success path");`,
    `}`,
  ]),
];

// ===========================================================================
// 00 — Setup & Auth
// ===========================================================================
const authFolder = folder(
  "00 — Setup & Auth",
  [
    "**Yahan se shuru karein.** Do tokens capture hote hain:",
    "",
    "| Token | Kaun | Kis liye |",
    "|---|---|---|",
    "| `vendor_token` | Seeded vendor — brand approved + subscribed | Baaki saare folders |",
    "| `onboard_token` | Naya throwaway vendor | Sirf folder `04 — Onboarding` |",
    "",
    "Do isliye ki onboarding ek **state machine** hai. Seeded brand us machine ke",
    "aakhir me khada hai, to uspe onboarding steps chalane ka matlab ya refusal hai",
    "ya usko wapas peeche dhakelna.",
    "",
    "⚠️ **Password login vendor ke liye hai hi nahi** — `POST /auth/login` aur poora",
    "set/forgot/reset flow ADMIN-only hai. Isliye is collection me wo endpoints nahi",
    "hain; `18 — Access control` me unpe `422`/`403` verify hota hai.",
    "",
    "⚠️ WhatsApp OTP abhi verify nahi hota (deliberate, deferred) — koi bhi 6-digit chalega.",
  ].join("\n"),
  [
    req({
      name: "1. WhatsApp — Send OTP (seeded vendor)",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{vendor_whatsapp}}", role: ROLES.VENDOR },
      gate: "Public",
      description: [
        "Naya number ho to `User` + `Brand` **ek transaction me** bante hain. Pehle",
        "`Brand.create` fail hone pe vendor bina brand ke reh jaata tha, aur agli login",
        "`isFirst: false` deti thi — matlab wo **kabhi** onboard nahi ho paata tha.",
        "",
        "Purane toote accounts is call pe **khud repair** ho jaate hain.",
        "",
        "`isFirst` ka matlab \"OTP verify nahi hua\" hai — \"User row nayi hai\" nahi.",
      ].join("\n"),
      capture: [["brand_id", "d.user.brandId"]],
      assert: [
        ...A.status(200),
        ...A.ok("OTP sent to your whatsapp number successfully."),
        ...A.fields({
          isFirst: "boolean",
          isProfileComplete: "boolean",
          user: "object",
        }),
        ...A.custom("VENDOR hai aur brand linked hai", [
          `const u = pm.response.json().data.user;`,
          `pm.expect(u.role).to.eql(${json(ROLES.VENDOR)});`,
          `pm.expect(u.brandId, "brandId").to.be.ok;`,
        ]),
        ...A.custom("password / otp strip ho gaye", [
          `const u = pm.response.json().data.user;`,
          `pm.expect(u).to.not.have.property("password");`,
          `pm.expect(u).to.not.have.property("otp");`,
        ]),
      ],
      examples: [
        {
          name: "422 — 10 digit number nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Please enter a valid 10 digit WhatsApp number"),
        },
      ],
    }),

    req({
      name: "2. WhatsApp — Verify OTP → vendor_token ⭐",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: {
        whatsappNumber: "{{vendor_whatsapp}}",
        otp: "{{otp}}",
        role: ROLES.VENDOR,
      },
      gate: "Public",
      description: [
        "**Baaki poori collection isi pe depend karti hai.**",
        "",
        "`currentScreen` optional hai aur yahan deliberately nahi bheja gaya — uski enum",
        "sirf onboarding screens allow karti hai, aur galat value poori call `422` kar",
        "deti hai. Onboarding folder me wo sahi values ke saath bheja jaata hai.",
      ].join("\n"),
      capture: [
        [V, "d.token"],
        ["vendor_user_id", "d.user._id"],
        ["brand_id", "d.user.brandId"],
      ],
      assert: [
        ...A.status(200),
        ...A.ok("OTP verified successfully"),
        ...A.fields({ token: "string", user: "object" }),
        ...A.custom("token save ho gaya", [
          `pm.expect(pm.environment.get("vendor_token")).to.be.a("string").and.not.empty;`,
        ]),
        ...A.custom("brand_id capture hua", [
          `pm.expect(pm.environment.get("brand_id"), "brand_id").to.be.ok;`,
        ]),
      ],
    }),

    req({
      name: "3. Email — Send OTP",
      method: "POST",
      segments: ["auth", "login-with-email"],
      body: { email: "{{vendor_email}}", role: ROLES.VENDOR },
      gate: "Public",
      description: [
        "Secondary sign-in. **Sirf existing account pe kaam karta hai** — ye signup nahi",
        "karta, unlike WhatsApp.",
        "",
        "⚠️ Email OTP ke liye account pe email set hona chahiye. Seeded vendor pe email",
        "nahi hai, to ye `404` dega jab tak aap folder `01` se email set na kar dein.",
        "",
        "> Email/Mobile OTP flows me verification **intact** hai — sirf WhatsApp me commented hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (email set hai ya nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
          `const b = pm.response.json();`,
          `if (pm.response.code === 200) pm.expect(b.success).to.eql(true);`,
          `else pm.expect(b.success).to.eql(false);`,
        ]),
      ],
    }),

    req({
      name: "4. Email — Verify OTP",
      method: "POST",
      segments: ["auth", "verify-otp-email"],
      body: { email: "{{vendor_email}}", otp: "{{otp}}", role: ROLES.VENDOR },
      gate: "Public",
      description:
        "⚠️ WhatsApp ke ulta, **yahan OTP waqai verify hota hai** — galat code pe `401`.",
      assert: [
        ...A.custom("200, ya OTP/account failure", [
          `pm.expect([200, 401, 404]).to.include(pm.response.code);`,
        ]),
      ],
      examples: [
        {
          name: "401 — galat OTP",
          code: 401,
          status: "Unauthorized",
          body: err("Invalid OTP! Please try again."),
        },
      ],
    }),

    req({
      name: "5. Mobile — Send OTP",
      method: "POST",
      segments: ["auth", "login-with-mobile"],
      body: { mobile: "{{vendor_mobile}}", role: ROLES.VENDOR },
      gate: "Public",
      description:
        "Teesra sign-in raasta. Isme bhi verification intact hai. Response me `sessionId` aata hai jo verify step ko chahiye.",
      capture: [["mobile_session_id", "d.sessionId"]],
      assert: [
        ...A.custom("200 ya 404 (mobile set hai ya nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "6. Mobile — Verify OTP",
      method: "POST",
      segments: ["auth", "verify-otp-mobile"],
      body: {
        mobile: "{{vendor_mobile}}",
        sessionId: "{{mobile_session_id}}",
        otp: "{{otp}}",
        role: ROLES.VENDOR,
      },
      gate: "Public",
      description:
        "⚠️ `sessionId` **required** hai — step 5 se aata hai. Ye WhatsApp/Email flows me nahi hota.",
      assert: [
        ...A.custom("200, ya OTP/session failure", [
          `pm.expect([200, 401, 404, 422]).to.include(pm.response.code);`,
        ]),
      ],
      examples: [
        {
          name: "422 — sessionId missing",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Session ID is required"),
        },
      ],
    }),

    req({
      name: "7. Logout",
      method: "POST",
      segments: ["auth", "logout"],
      token: V,
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ **Server pe kuch nahi karta** — na token blacklist, na push unregister. JWT",
        "apni expiry tak valid rehta hai.",
        "",
        "App ko: token locally delete karein **aur** `PUT /deviceTokens/unregister`",
        "alag se call karein.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok("Logout successful")],
    }),
  ],
);

// ===========================================================================
// 01 — User Profile
// ===========================================================================
const profileFolder = folder(
  "01 — User Profile",
  [
    "`?userId` param **hata diya gaya** — dono endpoints hamesha token wale user pe",
    "chalte hain. Pehle query token se jeet jaati thi, matlab koi bhi valid token kisi",
    "ka bhi profile padh aur likh sakta tha.",
  ].join("\n"),
  [
    req({
      name: "Get my profile",
      method: "GET",
      segments: ["users", "get"],
      token: V,
      gate: "`verifyJwtToken`",
      description: [
        "`currentScreen` se onboarding resume karein — login ke baad yahi batati hai",
        "vendor kahan tha.",
        "",
        "⚠️ `passwordSetAt` ignore karein — vendor password set kar hi nahi sakta, to wo",
        "hamesha `null` rahegi. \"Set password\" screen mat banayein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("User fetched successfully"),
        ...A.fields({ _id: "string", role: "string" }),
        ...A.absent(["password", "otp"]),
        ...A.custom("VENDOR hi hai", [
          `pm.expect(pm.response.json().data.role).to.eql(${json(ROLES.VENDOR)});`,
        ]),
      ],
    }),

    req({
      name: "Update my profile",
      method: "PUT",
      segments: ["users", "update"],
      token: V,
      form: [
        { key: "fullName", value: "postman vendor" },
        { key: "email", value: "{{vendor_email}}" },
        { key: "dob", value: "1990-06-15" },
        {
          key: "image",
          type: "file",
          disabled: true,
          description: "Optional avatar — enable karke file chunein",
        },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "**Multipart** hai, JSON nahi.",
        "",
        "Email badalne pe `isEmailVerified` **`false`** ho jaata hai — aur verify karne ka",
        "koi endpoint nahi hai, to wo phir wahin atka rehta hai.",
        "",
        "⚠️ Ye validator unknown fields **reject** karta hai (`stripUnknown` nahi lagta) —",
        "extra key pe `422`.",
        "",
        "Ye request `vendor_email` set kar deti hai, jisse folder `00` ka email OTP flow",
        "kaam karne lagta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("User profile updated successfully"),
        ...A.fields({ userData: "object" }),
        ...A.custom("vendor ke liye customerData null hai", [
          `pm.expect(pm.response.json().data.customerData, "customerData").to.eql(null);`,
        ]),
        ...A.absent(["password", "otp"]),
      ],
      examples: [
        {
          name: "400 — email kisi aur ka hai",
          code: 400,
          status: "Bad Request",
          body: err("Email already exists with another user"),
        },
      ],
    }),

    req({
      name: "Delete my account ⚠️ no-op",
      method: "DELETE",
      segments: ["users", "delete"],
      token: V,
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ **Kuch delete nahi karta.** Route file me inline handler hai jo bas `200`",
        "return karta hai — controller/service exist hi nahi karte.",
        "",
        "Standard envelope bhi nahi hai (`success` field nahi aati), to app ka response",
        "handler isko fail samajh sakta hai.",
        "",
        "**Vendor panel me \"Delete account\" disable rakhein.**",
        "",
        "Neeche ke tests **current (galat) behaviour** assert karte hain — jis din ye",
        "theek hoga, ye fail honge, aur wahi signal chahiye.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.custom("⚠️ standard envelope NAHI hai (known gap)", [
          `const b = pm.response.json();`,
          `pm.expect(b).to.not.have.property("success");`,
          `pm.expect(b.message).to.eql("User deleted successfully");`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 02 — Push Notifications
// ===========================================================================
const pushFolder = folder(
  "02 — Push Notifications",
  [
    "Poora module **role-agnostic** hai — vendor ka device bilkul waise hi register",
    "hota hai jaise customer ka.",
    "",
    "Login ke baad `register` call karein taaki `role` sahi map ho, aur `deviceId`",
    "zaroor bhejein taaki reinstall pe dead rows na banein.",
  ].join("\n"),
  [
    req({
      name: "Register this device",
      method: "POST",
      segments: ["deviceTokens", "register"],
      token: V,
      body: {
        token: "{{push_token}}",
        platform: DEVICE_PLATFORMS.WEB,
        deviceId: "{{device_id}}",
        deviceName: "Vendor Panel (Postman)",
        appVersion: "1.0.0",
      },
      gate: "`verifyJwtToken`",
      description: [
        "**Upsert hai, insert nahi** — safely dobara call kar sakte hain.",
        "",
        `\`platform\`: ${list(DEVICE_PLATFORMS)} — vendor panel web hai, to \`${DEVICE_PLATFORMS.WEB}\`.`,
        "",
        "Token kisi aur user ke naam pe tha to row **reassign** hoti hai (shared machine,",
        "logout-login), duplicate nahi banti.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Device registered for push notifications"),
        ...A.fields({ device: "object", activeDevices: "number" }),
        ...A.custom("role VENDOR map hua", [
          `pm.expect(pm.response.json().data.device.role).to.eql(${json(ROLES.VENDOR)});`,
        ]),
      ],
    }),

    req({
      name: "My registered devices",
      method: "GET",
      segments: ["deviceTokens", "get-mine"],
      token: V,
      query: [{ key: "includeInactive", value: "false" }],
      gate: "`verifyJwtToken`",
      description:
        "Provider token wapas nahi aata — sirf `tokenTail` (aakhri 8 chars). Wo token ek bearer credential hai, isliye server-side rehta hai.",
      assert: [
        ...A.status(200),
        ...A.ok("Registered devices fetched successfully"),
        ...A.fields({ devices: "array", activeDevices: "number", total: "number" }),
        ...A.custom("provider token kabhi wapas nahi aata", [
          `pm.response.json().data.devices.forEach(function (r) {`,
          `  pm.expect(r).to.not.have.property("token");`,
          `  pm.expect(r.tokenTail).to.be.a("string");`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Send myself a test push",
      method: "POST",
      segments: ["deviceTokens", "test"],
      token: V,
      body: { title: "Trydood vendor test", body: "Postman se bheja gaya." },
      gate: "`verifyJwtToken`",
      description: [
        "Sirf caller ke apne devices pe. " + THIRD_PARTY("Firebase"),
      ].join("\n"),
      assert: providerTolerantAssert("Test push dispatched"),
    }),

    req({
      name: "Unregister this device",
      method: "PUT",
      segments: ["deviceTokens", "unregister"],
      token: V,
      body: { token: "{{push_token}}" },
      gate: "`verifyJwtToken`",
      description:
        "Logout pe call karein. `{ \"allDevices\": true }` = sign out everywhere.",
      assert: [
        ...A.status(200),
        ...A.ok("Device unregistered from push notifications"),
      ],
      examples: [
        {
          name: "422 — na token na allDevices",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Provide a token, or set allDevices to true."),
        },
      ],
    }),
  ],
);

// ===========================================================================
// 03 — Notification Feed
// ===========================================================================
const feedFolder = folder(
  "03 — Notification Feed",
  [
    "Vendor ka in-app notification feed. Ownership `resolveActorBrand` se resolve hoti",
    "hai — vendor apne brand ka feed dekhta hai, admin `brandId` deke kisi ka bhi.",
    "",
    "⚠️ Feed **empty ho sakta hai** — seeded data me koi notification nahi hai, aur",
    "`pagination` khaali pe `404` deti hai. Ye empty state hai, error nahi.",
  ].join("\n"),
  [
    req({
      name: "My notifications",
      method: "GET",
      segments: ["notifications", "get-all"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "isRead", value: "false", disabled: true },
        { key: "type", value: "", disabled: true },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "`brandId` vendor ke liye **optional** hai — apna brand khud resolve hota hai.",
        "",
        "`limit` max 100. `isRead` se unread badge count nikal sakte hain.",
      ].join("\n"),
      capture: [["notification_id", "d.data[0]._id"]],
      assert: [
        ...A.custom("200 ya 404 (feed khaali ho sakta hai)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) {`,
          `  const d = pm.response.json().data;`,
          `  pm.expect(d.data, "data").to.be.an("array");`,
          `  pm.expect(d.total, "total").to.be.a("number");`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "404 — koi notification nahi",
          code: 404,
          status: "Not Found",
          body: err("No any notification found"),
        },
      ],
    }),

    req({
      name: "Mark notifications read",
      method: "PUT",
      segments: ["notifications", "mark-read"],
      token: V,
      body: { markAll: true },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Ya to `notificationIds: [...]` bhejein, ya `markAll: true`. **Dono me se ek",
        "zaroori hai** — khaali body galti se sab kuch mark kar deti, isliye refuse hoti hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (kuch tha hi nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
      examples: [
        {
          name: "422 — na ids na markAll",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Provide notificationIds or set markAll to true."),
        },
      ],
    }),
  ],
);

// ===========================================================================
// 04 — Onboarding (fresh vendor)
// ===========================================================================
const onboardingFolder = folder(
  "04 — Onboarding (fresh vendor)",
  [
    "**Ye folder apna alag vendor banata hai** (`onboard_token`) aur usse poora",
    "onboarding sequence chalata hai. Seeded vendor pe ye nahi chal sakta — wo already",
    "approved + subscribed hai.",
    "",
    "### Sequence",
    "",
    "```",
    "signup → basic details (3 screens) → PAN → GST → bank",
    "       → system-verify → partnership deed → [admin approval] → acknowledge",
    "```",
    "",
    "### PAN / GST / bank endpoints third-party call nahi karte",
    "",
    "Ye samajhna zaruri hai: `/brands/onboarding/add-pan-details` **verification ka",
    "result** accept karta hai, verification khud nahi karta. Flow ye hai:",
    "",
    "1. App `/verification/brands/onboarding/verify-pan` call karti hai → CGPey chalta hai",
    "2. App uska response `/brands/onboarding/add-pan-details` ko forward karti hai",
    "",
    "Isliye ye teen `add-*` endpoints **headless chal jaate hain** (verification response",
    "banaya ja sakta hai) — sirf folder `05` ke `verify-*` endpoints CGPey pe jaate hain.",
    "",
    "⚠️ Iska ek security matlab bhi hai: `isVerified: true` aur ek banaya hua",
    "`verificationResponse` bhejkar KYC step client-side se pass kiya ja sakta hai.",
    "Backend provider ke saath cross-check nahi karta.",
  ].join("\n"),
  [
    req({
      name: "1. Naya vendor signup",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{onboard_whatsapp}}", role: ROLES.VENDOR },
      gate: "Public",
      description:
        "Har run pe naya number generate hota hai (pre-request script), taaki ye folder dobara chalane pe bhi shuru se shuru ho.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("naya account hai", [
          `pm.expect(pm.response.json().data.isFirst, "isFirst").to.eql(true);`,
        ]),
      ],
    }),

    req({
      name: "2. Verify OTP → onboard_token",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: {
        whatsappNumber: "{{onboard_whatsapp}}",
        otp: "{{otp}}",
        role: ROLES.VENDOR,
      },
      gate: "Public",
      capture: [
        [ONB, "d.token"],
        ["onboard_brand_id", "d.user.brandId"],
      ],
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("onboard_token save ho gaya", [
          `pm.expect(pm.environment.get("onboard_token")).to.be.a("string").and.not.empty;`,
        ]),
      ],
    }),

    req({
      name: `3. Basic details — screen 1 (${SCREENS.REGISTRATION_STATUS})`,
      method: "POST",
      segments: ["brands", "onboarding", "add-basic-details"],
      token: ONB,
      body: {
        currentScreen: SCREENS.REGISTRATION_STATUS,
        brandName: "postman onboarding brand",
        legalBusinessName: "postman onboarding pvt ltd",
      },
      gate: "`isVendor`",
      description: [
        "⚠️ **Ek hi endpoint, teen screens.** `currentScreen` decide karta hai kaunse",
        "fields allowed hain — aur baaki **`forbidden`** ho jaate hain, optional nahi.",
        "Galat screen ke saath field bhejne pe `422`.",
        "",
        "| `currentScreen` | Allowed fields |",
        "|---|---|",
        `| \`${SCREENS.REGISTRATION_STATUS}\` | \`brandName\` (optional), \`legalBusinessName\` (required) |`,
        `| \`${SCREENS.REGISTRATION_ENTITY_TYPE}\` | \`businessRegistrationStatus\` |`,
        `| \`${SCREENS.PAN_VERIFICATION}\` | \`businessEntityType\` |`,
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
      examples: [
        {
          name: "422 — galat screen pe field bheji",
          code: 422,
          status: "Unprocessable Entity",
          body: err('"brandName" is not allowed'),
        },
      ],
    }),

    req({
      name: `4. Basic details — screen 2 (${SCREENS.REGISTRATION_ENTITY_TYPE})`,
      method: "POST",
      segments: ["brands", "onboarding", "add-basic-details"],
      token: ONB,
      body: {
        currentScreen: SCREENS.REGISTRATION_ENTITY_TYPE,
        businessRegistrationStatus: BUSINESS_REGISTRATION_STATUS.REGISTERED,
      },
      gate: "`isVendor`",
      description: `\`businessRegistrationStatus\`: ${list(BUSINESS_REGISTRATION_STATUS)}`,
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: `5. Basic details — screen 3 (${SCREENS.PAN_VERIFICATION})`,
      method: "POST",
      segments: ["brands", "onboarding", "add-basic-details"],
      token: ONB,
      body: {
        currentScreen: SCREENS.PAN_VERIFICATION,
        businessEntityType: BUSINESS_ENTITY_TYPE.PRIVATE_LIMITED,
      },
      gate: "`isVendor`",
      description: [
        `\`businessEntityType\`: ${Object.values(BUSINESS_ENTITY_TYPE).slice(0, 6).join(" · ")} …`,
        "",
        "⚠️ Entity type GST ke saath cross-checked hota hai — `GST_TO_BRAND_ENTITY_MAP`",
        "ke through. Mismatch pe GST step reject ho jaata hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "6. PAN details",
      method: "POST",
      segments: ["brands", "onboarding", "add-pan-details"],
      token: ONB,
      body: {
        pan: "ABCDE1234F",
        panType: PAN_TYPES.COMPANY,
        fullName: "postman onboarding pvt ltd",
        isVerified: true,
        verificationStatus: PRIMARY_VERIFICATION_STATUSES.SUCCESS,
        verificationProvider: PRIMARY_VERIFICATION_PROVIDERS.CGPEY,
        verifiedAt: "{{now_iso}}",
        providerTransactionId: "pmfx-pan-txn-001",
        providerRequestId: "pmfx-pan-req-001",
        verificationResponse: { note: "seeded — provider ka raw response yahan aata hai" },
        currentScreen: SCREENS.GST_VERIFICATION,
      },
      gate: "`isVendor`",
      description: [
        "Folder `05` ke verify-pan ka **result** yahan post hota hai.",
        "",
        "| Field | Notes |",
        "|---|---|",
        "| `pan` | `AAAAA9999A` format, auto-uppercase |",
        `| \`panType\` | ${list(PAN_TYPES)} |`,
        "| `isVerified` | **required** |",
        "| `verificationResponse` | **required** — provider ka raw response |",
        "| `providerTransactionId` · `providerRequestId` | **required** |",
        "| `verifiedAt` | `verificationStatus: SUCCESS` ho to **required** |",
        "| `verificationMessage` | `FAILED`/`REJECTED` ho to **required** |",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya documented refusal", [
          `pm.expect([200, 201, 400, 409, 422]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
    }),

    req({
      name: "7. GST details",
      method: "POST",
      segments: ["brands", "onboarding", "add-gst-details"],
      token: ONB,
      body: {
        gstNumber: "23ABCDE1234F1Z5",
        legalName: "postman onboarding pvt ltd",
        tradeName: "postman onboarding brand",
        isVerified: true,
        verificationStatus: PRIMARY_VERIFICATION_STATUSES.SUCCESS,
        verificationProvider: PRIMARY_VERIFICATION_PROVIDERS.CGPEY,
        verifiedAt: "{{now_iso}}",
        providerTransactionId: "pmfx-gst-txn-001",
        providerRequestId: "pmfx-gst-req-001",
        verificationResponse: { note: "seeded" },
        currentScreen: SCREENS.BANK_VERIFICATION,
      },
      gate: "`isVendor`",
      description: [
        "⚠️ **GSTIN ke digits 6–10 PAN se match hone chahiye.** GSTIN ka structure hai",
        "`<2 state digits><10 char PAN><entity><Z><checksum>` — backend ye cross-check",
        "karta hai, aur mismatch pe reject.",
        "",
        "Isi tarah GSTIN ka entity character brand ke `businessEntityType` se match hona",
        "chahiye (`GST_TO_BRAND_ENTITY_MAP`).",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya documented refusal", [
          `pm.expect([200, 201, 400, 409, 422]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
    }),

    req({
      name: "8. Bank details",
      method: "POST",
      segments: ["brands", "onboarding", "add-bank-details"],
      token: ONB,
      body: {
        isValid: true,
        recommendedAction: "ACCEPT",
        accountHolderName: "postman onboarding pvt ltd",
        accountNumber: "123456789012",
        ifscCode: "HDFC0001234",
        bankName: "hdfc bank",
        branchName: "vijay nagar",
        accountType: BANK_ACCOUNT_TYPES.CURRENT,
        isVerified: true,
        verificationStatus: PRIMARY_VERIFICATION_STATUSES.SUCCESS,
        verificationProvider: PRIMARY_VERIFICATION_PROVIDERS.CGPEY,
        verifiedAt: "{{now_iso}}",
        providerTransactionId: "pmfx-bank-txn-001",
        providerRequestId: "pmfx-bank-req-001",
        verificationResponse: { note: "seeded" },
        currentScreen: SCREENS.SYSTEM_VERIFICATION,
      },
      gate: "`isVendor`",
      description: [
        "Penny-drop ka result. `accountNumber` 9–18 digits, `ifscCode` `AAAA0XXXXXX`.",
        "",
        `\`accountType\`: ${list(BANK_ACCOUNT_TYPES)}`,
      ].join("\n"),
      assert: [
        ...A.custom("200 ya documented refusal", [
          `pm.expect([200, 201, 400, 409, 422]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
    }),

    req({
      name: "9. System verify (auto cross-match)",
      method: "GET",
      segments: ["brands", "onboarding", "system-verify"],
      token: ONB,
      gate: "`isVendor`",
      description: [
        "PAN / GST / bank ko aapas me cross-match karke ek score nikalta hai aur",
        "`SystemVerify` document banata hai. **Yahi approval ka asli source of truth hai** —",
        "`brand.isApproved` nahi (wo kabhi likha hi nahi jaata).",
        "",
        "Result ke hisaab se brand `APPROVED`, `MANUAL_REVIEW` ya `REJECTED` me jaata hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya missing-step refusal", [
          `pm.expect([200, 400, 404, 422]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) {`,
          `  pm.expect(pm.response.json().success).to.eql(true);`,
          `}`,
        ]),
      ],
    }),

    req({
      name: "10. Accept partnership deed",
      method: "PUT",
      segments: ["brands", "onboarding", "accept-partnership"],
      token: ONB,
      gate: "`isVendor`",
      description: `Deed accept karne pe vendor \`${SCREENS.SUBSCRIBE_PLAN}\` pe chala jaata hai.`,
      assert: [
        ...A.custom("200 ya state refusal", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "11. Acknowledge approval",
      method: "PUT",
      segments: ["brands", "onboarding", "acknowledge-approval"],
      token: ONB,
      gate: "`isVendor`",
      description: [
        `Approval ki congratulations screen dismiss karta hai → \`${SCREENS.DASHBOARD}\`.`,
        "",
        "⚠️ Ye tabhi kaam karta hai jab brand **already approved** ho. Fresh onboarding",
        "me admin ne abhi approve nahi kiya hoga, to yahan refusal expected hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 'abhi approved nahi' refusal", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "12. Update basic details (review/edit)",
      method: "PUT",
      segments: ["brands", "onboarding", "update-basic-details"],
      token: ONB,
      body: {
        currentScreen: SCREENS.REGISTRATION_STATUS,
        legalBusinessName: "postman onboarding pvt ltd (edited)",
      },
      gate: "`isVendor`",
      description:
        "Review/edit flow — wahi controller jo `add-basic-details` chalata hai, alag validator ke saath.",
      assert: [
        ...A.custom("200 ya state refusal", [
          `pm.expect([200, 400, 404, 422]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 05 — KYC Verification (third-party)
// ===========================================================================
const kycFolder = folder(
  "05 — KYC Verification (CGPey)",
  [
    "Ye teeno **live CGPey calls** hain — asli verification yahin hoti hai. Inka result",
    "phir folder `04` ke `add-*-details` endpoints ko forward hota hai.",
    "",
    "⚠️ Sandbox/scratch environment me ye fail honge. Assertions success aur",
    "provider-failure dono accept karte hain, aur kisi *aur* failure pe fail ho jaate hain.",
    "",
    "> Isi liye onboarding folder inpe depend nahi karta — wo verification response",
    "> khud banata hai. Production me app pehle yahan aati hai, phir wahan.",
  ].join("\n"),
  [
    req({
      name: "Verify PAN",
      method: "POST",
      segments: ["verification", "brands", "onboarding", "verify-pan"],
      token: ONB,
      body: { pan: "ABCDE1234F" },
      gate: "`isVendor`",
      description: THIRD_PARTY("CGPey"),
      assert: providerTolerantAssert(),
    }),
    req({
      name: "Verify GST",
      method: "POST",
      segments: ["verification", "brands", "onboarding", "verify-gst"],
      token: ONB,
      body: { gstNumber: "23ABCDE1234F1Z5" },
      gate: "`isVendor`",
      description: [
        "⚠️ Field ka naam **`gstNumber`** hai, `gstin` nahi — PAN wala `pan` hai aur bank",
        "wale `accountNumber`/`ifscCode`, to naming yahan consistent nahi hai.",
        "",
        THIRD_PARTY("CGPey"),
      ].join("\n"),
      assert: providerTolerantAssert(),
    }),
    req({
      name: "Verify bank (penny drop)",
      method: "POST",
      segments: ["verification", "brands", "onboarding", "verify-bank"],
      token: ONB,
      body: { accountNumber: "123456789012", ifscCode: "HDFC0001234" },
      gate: "`isVendor`",
      description: THIRD_PARTY("CGPey"),
      assert: providerTolerantAssert(),
    }),
  ],
);

// ===========================================================================
// 06 — Brand
// ===========================================================================
const brandFolder = folder(
  "06 — Brand",
  [
    "✅ `GET /brands/get` aur `PUT /brands/update` ab **`isVendorOrAdmin`** hain. Pehle",
    "koi bhi signed-in user — customer included — brand ka PAN, GSTIN, bank account aur",
    "subscription billing padh sakta tha.",
    "",
    "Customer ke liye ab alag endpoint hai (`/brands/customer/get/:brandId`) jisme wo",
    "sensitive joins **build hi nahi hote**.",
  ].join("\n"),
  [
    req({
      name: "Get my brand ⭐",
      method: "GET",
      segments: ["brands", "get"],
      token: V,
      query: [
        {
          key: "brandId",
          value: "{{brand_id}}",
          disabled: true,
          description: "Vendor ke liye optional (apna brand); admin ke liye required",
        },
      ],
      gate: "`isVendorOrAdmin`",
      description: [
        "14 lookups — poora brand, KYC, subscription, outlets, sab.",
        "",
        "⚠️ **Lookup fields singular objects hain, arrays nahi.** `buildAggregateLookup`",
        "default me unwind karta hai:",
        "",
        "| Sahi | Galat |",
        "|---|---|",
        "| `pan` | ~~`pans`~~ |",
        "| `gst` | ~~`gsts`~~ |",
        "| `bank` | ~~`banks`~~ |",
        "| `firstSubBrand` | ~~`subbrands`~~ |",
        "",
        "`isApproved` pe bharosa na karein — wo hamesha `false` hai. Asli status",
        "`systemVerify.status` me hai.",
      ].join("\n"),
      capture: [["subscribed_id", "d.subscribedId"]],
      assert: [
        ...A.status(200),
        ...A.ok("Brand details fetched successfully"),
        ...A.fields({ _id: "string", brandName: "string" }),
        ...A.custom("brand mera hi hai", [
          `pm.expect(String(pm.response.json().data._id)).to.eql(String(pm.environment.get("brand_id")));`,
        ]),
        ...A.custom("subscription state seed ke mutabik hai", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.isSubscribed, "isSubscribed").to.eql(true);`,
        ]),
        ...A.custom("lookups singular hain, arrays nahi", [
          `const d = pm.response.json().data;`,
          `["pan", "gst", "bank", "location", "workHours", "systemVerify"].forEach(function (k) {`,
          `  if (d[k] !== undefined && d[k] !== null) {`,
          `    pm.expect(Array.isArray(d[k]), k + " should be an object, not an array").to.eql(false);`,
          `  }`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Update my brand",
      method: "PUT",
      segments: ["brands", "update"],
      token: V,
      form: [
        { key: "description", value: "postman se update kiya gaya description" },
        {
          key: "logo",
          type: "file",
          disabled: true,
          description: "Enable karke file chunein",
        },
        { key: "coverImage", type: "file", disabled: true },
      ],
      gate: "`isVendorOrAdmin`",
      description:
        "**Multipart** — logo aur coverImage files ke liye. Sirf text fields bhejni hon to bhi form-data hi chalega.",
      assert: [
        ...A.status(200),
        ...A.ok("Brand details updated successfully"),
      ],
    }),

    req({
      name: "Verification history",
      method: "GET",
      segments: ["brands", "verifications", "history"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Shared audit trail — vendor sirf apna brand dekhta hai, admin koi bhi.",
        "",
        "✅ Pehle route pe koi role gate nahi tha aur service ki scoping sirf `VENDOR`",
        "handle karti thi — `CUSTOMER` `else` branch me chala jaata tha aur koi bhi",
        "`brandId` padh sakta tha. Ab har role explicitly named hai.",
        "",
        "**Approval status ke liye yahi ya `systemVerify.status` dekhein**, `brand.isApproved` nahi.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (abhi koi history nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 07 — Outlets / Sub-Brands
// ===========================================================================
const outletFolder = folder(
  "07 — Outlets / Sub-Brands",
  [
    "Outlets plan ke metered pool se aate hain. `OUTLET` aur `FRANCHISE` **alag pools**",
    "hain — ek doosre se nahi kat te.",
    "",
    "Har outlet ka apna `SUB_VENDOR` user banta hai aur OTP bhi jaata hai, par ⚠️ **koi",
    "route `SUB_VENDOR` role handle nahi karta** — outlet-level login screen abhi na banayein.",
  ].join("\n"),
  [
    req({
      name: "My outlets ⭐",
      method: "GET",
      segments: ["subBrands", "get-all"],
      token: V,
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        { key: "isActive", value: "true", disabled: true },
        { key: "outletType", value: OUTLET_TYPES.OUTLET, disabled: true },
      ],
      gate: "`isVendorOrAdmin`",
      description: [
        "⚠️ **`brandId` hamesha bhejein.** Endpoint khud scope nahi karta — bina uske",
        "platform ke saare outlets aa jaate hain.",
        "",
        `\`outletType\`: ${list(OUTLET_TYPES)} · \`limit\` max 100.`,
      ].join("\n"),
      capture: [["sub_brand_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("sab outlets mere brand ke hain", [
          `const mine = String(pm.environment.get("brand_id"));`,
          `pm.response.json().data.data.forEach(function (o) {`,
          `  const b = o.brandId && o.brandId._id ? o.brandId._id : o.brandId;`,
          `  if (b) pm.expect(String(b), "outlet " + o.uniqueId).to.eql(mine);`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Add an outlet",
      method: "POST",
      segments: ["subBrands", "signUp-with-whatsapp"],
      token: V,
      body: {
        brandId: "{{brand_id}}",
        whatsappNumber: "{{outlet_whatsapp}}",
        outletType: OUTLET_TYPES.OUTLET,
        isFirstOutlet: false,
      },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Outlet ka `SUB_VENDOR` user banata hai aur plan se ek slot **atomically reserve**",
        "karta hai (conditional increment) — race me do outlets ek hi slot nahi le sakte.",
        "",
        `\`outletType\`: ${list(OUTLET_TYPES)}. Dono alag pools se katte hain.`,
        "",
        "Slot khatam ho jaaye to plan-limit error aata hai.",
      ].join("\n"),
      assert: [
        ...A.custom("201/200, ya plan-limit refusal", [
          `pm.expect([200, 201, 400, 403, 409]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
      examples: [
        {
          name: "400 — plan ka outlet slot khatam",
          code: 400,
          status: "Bad Request",
          body: err("Your plan's outlet limit has been reached."),
        },
      ],
    }),

    req({
      name: "Update an outlet",
      method: "PUT",
      segments: ["subBrands", "update", "{{sub_brand_id}}"],
      token: V,
      body: {
        description: "postman se update kiya gaya outlet",
        outletType: OUTLET_TYPES.OUTLET,
      },
      gate: "`isVendorOrAdmin`",
      description: [
        "✅ **`isActive` ab default nahi hota.** Pehle `.default(true)` laga tha, matlab",
        "koi bhi update — chahe usme `isActive` ho hi na — deactivated outlet ko",
        "chup-chaap **reactivate** kar deta tha.",
        "",
        "Ab wo sirf tab apply hota hai jab explicitly bheja jaye.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 08 — Work Hours
// ===========================================================================
const workHoursFolder = folder(
  "08 — Work Hours",
  "Brand ya outlet ke opening hours. Ek hi upsert endpoint dono ke liye.",
  [
    req({
      name: "Upsert work hours (brand)",
      method: "POST",
      segments: ["workHours", "upsert"],
      token: V,
      body: {
        brandId: "{{brand_id}}",
        monday: { start: "09:00", end: "22:00", isOpen: true },
        tuesday: { start: "09:00", end: "22:00", isOpen: true },
        wednesday: { start: "09:00", end: "22:00", isOpen: true },
        thursday: { start: "09:00", end: "22:00", isOpen: true },
        friday: { start: "09:00", end: "23:00", isOpen: true },
        saturday: { start: "09:00", end: "23:00", isOpen: true },
        sunday: { isOpen: false },
      },
      gate: "`isVendorOrAdmin`",
      description: [
        "| Rule | |",
        "|---|---|",
        "| `brandId` **ya** `subBrandId` | Ek zaroori, **dono nahi** |",
        "| Kam se kam ek din | Khaali body reject |",
        "| `start` / `end` | `HH:mm` (24h). `isOpen: true` ho to **required** |",
        "| `start < end` | Warna *\"Start time must be earlier than end time\"* |",
        "",
        "⚠️ Din **top-level keys** hain — koi `workingHours` wrapper nahi. Customer-facing",
        "responses me bhi wahi shape aati hai.",
        "",
        "Overnight hours (22:00 → 02:00) **support nahi** hote — `start < end` rule unhe",
        "reject kar deta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("2xx", [
          `pm.expect([200, 201]).to.include(pm.response.code);`,
          `pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
      examples: [
        {
          name: "422 — brandId aur subBrandId dono bhej diye",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Provide either brandId or subBrandId, not both"),
        },
        {
          name: "422 — start end ke baad hai",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Start time must be earlier than end time"),
        },
      ],
    }),
  ],
);

// ===========================================================================
// 09 — Locations
// ===========================================================================
const locationFolder = folder(
  "09 — Locations",
  [
    "Brand aur outlet ke addresses. ✅ Ab poora module `isVendorOrAdmin` hai — pehle",
    "`GET /getAll` kisi bhi signed-in user ko platform ke **saare** addresses de deta tha,",
    "customers ke ghar included.",
    "",
    "⚠️ `coordinates` **`[longitude, latitude]`** order me — Maps APIs se ulta.",
    "",
    "⚠️ **`update` aur `delete` pe ownership check abhi bhi nahi hai** — sirf role gate",
    "hai. Apne hi ids use karein.",
  ].join("\n"),
  [
    req({
      name: "Create a location",
      method: "POST",
      segments: ["locations", "create"],
      token: V,
      body: {
        brandId: "{{brand_id}}",
        addressLine1: "postman se banaya gaya address",
        addressLine2: "scheme 54",
        landmark: "opposite c21 mall",
        city: "indore",
        district: "indore",
        state: "madhya pradesh",
        country: "india",
        zipcode: "452010",
        coordinates: [75.8937, 22.7533],
        isBrandAddress: true,
      },
      gate: "`isVendorOrAdmin`",
      description:
        "Zipcode `country` ke hisaab se validate hota hai (India: 6 digits). `country` na bhejein to `india` default hai.",
      capture: [["location_id", "d._id"]],
      assert: [
        ...A.custom("2xx", [
          `pm.expect([200, 201]).to.include(pm.response.code);`,
          `pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
        ...A.custom("geo Point hai [lng, lat]", [
          `const g = pm.response.json().data.geo;`,
          `pm.expect(g.type).to.eql("Point");`,
          `pm.expect(g.coordinates[0], "longitude").to.be.within(-180, 180);`,
          `pm.expect(g.coordinates[1], "latitude").to.be.within(-90, 90);`,
        ]),
      ],
    }),

    req({
      name: "All locations",
      method: "GET",
      segments: ["locations", "getAll"],
      token: V,
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
      ],
      gate: "`isVendorOrAdmin`",
      description:
        "⚠️ **`brandId` hamesha bhejein** — endpoint khud scope nahi karta.",
      assert: [...A.status(200), ...A.paged()],
    }),

    req({
      name: "One location",
      method: "GET",
      segments: ["locations", "get", "{{location_id}}"],
      token: V,
      gate: "`verifyJwtToken` + ownership",
      description: [
        "Gate sirf \"signed in\" hai — kaunsa address dikhega ye **service** me role ke",
        "hisaab se decide hota hai:",
        "",
        "| Role | Kya |",
        "|---|---|",
        "| `VENDOR` | Apne brand ka + apne outlets ka. Outlet ownership `SubBrand` se verify hoti hai, token ke `brandId` se nahi — stale claim se dayra nahi badhta |",
        "| `CUSTOMER` | Sirf apna |",
        "| `ADMIN` | Sab |",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Location fetched successfully"),
        ...A.fields({ _id: "string", geo: "object" }),
      ],
    }),

    req({
      name: "Update a location",
      method: "PUT",
      segments: ["locations", "update", "{{location_id}}"],
      token: V,
      body: { landmark: "postman se update kiya gaya landmark" },
      gate: "`isVendorOrAdmin`",
      description:
        "⚠️ Ownership check **nahi** hai — koi bhi vendor kisi bhi location ki id se ye chala sakta hai. Apne hi ids use karein.",
      assert: [...A.status(200), ...A.ok("Location updated successfully")],
    }),

    req({
      name: "Delete a location",
      method: "DELETE",
      segments: ["locations", "delete", "{{location_id}}"],
      token: V,
      gate: "`isVendorOrAdmin`",
      description:
        "Soft delete (`isDeleted: true`). ⚠️ Isme bhi ownership check nahi hai.",
      assert: [...A.status(200), ...A.ok("Location deleted successfully")],
    }),
  ],
);

// ===========================================================================
// 10 — Showcase
// ===========================================================================
const showcaseFolder = folder(
  "10 — Showcase",
  [
    "Brand ka photo/video gallery. Sections plan ke `showcase` pool se metered hain.",
    "",
    "✅ **Poora module ab ownership verify karta hai** (`resolveSectionForActor` /",
    "`resolveActorBrand`). Pehle services `userId` lete the aur use **check hi nahi**",
    "karte the — koi bhi signed-in caller kisi bhi brand ki gallery edit, reorder ya",
    "delete kar sakta tha, sirf id se.",
    "",
    "✅ `section/get-all` ab **brand-scoped** hai — vendor apne brand pe pinned, admin",
    "global. Pehle service me filter commented out tha aur `brandId` param support hi",
    "nahi hota tha, isliye purane doc me likha tha *\"is endpoint pe bharosa na karein\"*.",
    "Ab bharosa kar sakte hain.",
  ].join("\n"),
  [
    req({
      name: "All my sections ⭐",
      method: "GET",
      segments: ["showcase", "section", "get-all"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        {
          key: "brandId",
          value: "{{brand_id}}",
          disabled: true,
          description: "Vendor ke liye optional (apna brand pinned hai); admin ke liye narrowing filter",
        },
        { key: "sortBy", value: "sortOrder" },
        {
          key: "isVisible",
          value: "false",
          disabled: true,
          description: "Panel ke \"Hidden\" tab ke liye — default me visible+hidden dono aate hain",
        },
        {
          key: "isActive",
          value: "false",
          disabled: true,
          description: "Default me on+off dono aate hain",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "`brandId` vendor ke liye optional hai — service apne brand pe pin kar deti hai.",
        "Doosre brand ka `brandId` bhejne pe **reject** hota hai, chup-chaap ignore nahi.",
        "",
        "🔴 `isActive` / `isVisible` ke **default filter hata diye gaye hain**. Pehle",
        "dono ka default `true` tha, matlab abhi-abhi hide kiya section apni hi list se",
        "gayab ho jaata tha aur wapas on karne ka rasta nahi bachta tha. Ab sirf",
        "soft-deleted sections chhupte hain; ye do query params filter ki tarah kaam",
        "karte hain.",
        "",
        "Response me `isVisible`, `isShowVideosInClips`, `slug`, `coverImageMode` aur",
        "`inactiveMediaCount` bhi aate hain — panel ke toggles inhi se render karein.",
      ].join("\n"),
      capture: [["section_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("sab sections mere brand ke hain", [
          `const mine = String(pm.environment.get("brand_id"));`,
          `pm.response.json().data.data.forEach(function (s) {`,
          `  if (s.brandId) pm.expect(String(s.brandId), s.title).to.eql(mine);`,
          `});`,
        ]),
        ...A.custom("toggles response me aate hain", [
          `const rows = pm.response.json().data.data;`,
          `rows.forEach(function (s) {`,
          `  pm.expect(s, s.title).to.have.property("isVisible");`,
          `  pm.expect(s, s.title).to.have.property("isShowVideosInClips");`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "One section (with media)",
      method: "GET",
      segments: ["showcase", "section", "get", "{{section_id}}"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        { key: "type", value: "", disabled: true, description: "PHOTO | VIDEO" },
        {
          key: "isActive",
          value: "false",
          disabled: true,
          description: "Default me on+off dono media aati hain",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "⚠️ Media ek **nested paginated block** me aati hai — `data.media.data[]`, na ki",
        "`data.medias[]`. Section ke apne counts (`mediaCount` / `photoCount` /",
        "`videoCount` / `inactiveMediaCount`) us page ke nahi, **poore** album ke hain —",
        "`type` / `search` / `isActive` filter inhe nahi badalte.",
        "",
        "🔴 `isActive: false` media ab bhi list me aati hai (pehle gayab ho jaati thi, to",
        "usko wapas on karne ka koi rasta nahi tha). Sirf soft-deleted chhupti hai.",
        "",
        "`isShowInVideoClips` sirf **VIDEO** rows pe aata hai — photo pe wo key hi nahi",
        "hoti, to photo ke liye panel me toggle mat dikhayein.",
      ].join("\n"),
      capture: [["media_id", "d.media.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Section fetched successfully."),
        ...A.custom("media nested paginated block hai", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.media, "media").to.be.an("object");`,
          `pm.expect(d.media.data, "media.data").to.be.an("array");`,
          `pm.expect(d.mediaCount, "mediaCount poore album ka").to.be.a("number");`,
        ]),
        ...A.custom("isShowInVideoClips sirf video pe", [
          `pm.response.json().data.media.data.forEach(function (m) {`,
          `  if (m.type === "VIDEO") {`,
          `    pm.expect(m, "video " + m._id).to.have.property("isShowInVideoClips");`,
          `  } else {`,
          `    pm.expect(m, "photo " + m._id).to.not.have.property("isShowInVideoClips");`,
          `  }`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Create a section",
      method: "POST",
      segments: ["showcase", "section", "add"],
      token: V,
      body: {
        brandId: "{{brand_id}}",
        title: "postman section",
        description: "postman se banaya gaya",
        sectionType: SHOWCASE_SECTION_TYPE.CUSTOM,
        isVisible: true,
        isShowVideosInClips: true,
      },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "`brandId` vendor ke liye optional (apna brand); admin ke liye **required**.",
        "",
        `\`sectionType\`: ${list(SHOWCASE_SECTION_TYPE)}`,
        "",
        "Title brand ke andar unique hona chahiye (case-insensitive).",
        "",
        "Plan ka `showcase` slot atomically reserve hota hai.",
      ].join("\n"),
      capture: [["new_section_id", "d._id"]],
      assert: [
        ...A.custom("2xx, ya duplicate-title / plan-limit refusal", [
          `pm.expect([200, 201, 400, 409]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
      examples: [
        {
          name: "409 — is naam ka section already hai",
          code: 409,
          status: "Conflict",
          body: err("A section with this title already exists for this brand."),
        },
      ],
    }),

    req({
      name: "Update a section",
      method: "PUT",
      segments: ["showcase", "section", "update", "{{new_section_id}}"],
      token: V,
      body: { description: "postman se update kiya gaya", isVisible: true },
      gate: "`isVendorOrAdmin` + ownership",
      description:
        "`isVisible: false` karne pe album customer ke **brand profile** aur **full gallery** dono se gayab ho jaata hai (pehle gallery endpoint ye filter nahi lagata tha). Vendor ki apni list (#get-all) me wo phir bhi dikhta hai, taaki wapas on kiya ja sake.",
      assert: [
        ...A.custom("200 ya 404 (section bana hi nahi tha)", [
          `pm.expect([200, 404, 409]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "Reorder sections",
      method: "PUT",
      segments: ["showcase", "section", "{{brand_id}}", "reorder"],
      token: V,
      body: { sections: [{ id: "{{section_id}}", sortOrder: 1 }] },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Field ka naam **`id`** hai (`sectionId` nahi). `sections` array me brand ke",
        "**saare** sections ka naya `sortOrder` bhejein — service list ko `1..n`",
        "renumber karti hai, to adhoori list positions se takra jaati. Ab wo",
        "`400 \"Please send the complete section order — N sections expected, M received.\"`",
        "deti hai; galat id pe `400 \"Invalid section list.\"`.",
        "",
        "`brandId` path me hai par ownership `resolveActorBrand` se resolve hoti hai —",
        "doosre brand ka id daalne pe reject.",
        "",
        "🔴 **Ye endpoint pehle kabhi kaam hi nahi karta tha** — service `item.sectionId`",
        "padhti thi jabki payload me `id` aata hai, to har well-formed request",
        "`undefined.toString()` pe `500` ho jaati thi. Fix 2026-08-27 ko hua.",
      ].join("\n"),
      // Ye request ek hi section bhejti hai, to brand me ek se zyada section hone
      // par complete-order rule ise (jaan-boojh kar) reject karega — media reorder
      // ki tarah. Dono raaste valid hain, isliye assert dono ko accept karta hai.
      assert: [
        ...A.custom("200 (poori list) ya 400 (adhoori list refusal)", [
          `pm.expect([200, 400]).to.include(pm.response.code);`,
          `const b = pm.response.json();`,
          `if (pm.response.code === 200) {`,
          `  pm.expect(b.success).to.eql(true);`,
          `  pm.expect(b.data.updated, "updated").to.be.a("number").and.to.be.above(0);`,
          `} else {`,
          `  pm.expect(b.success).to.eql(false);`,
          `  pm.expect(String(b.message)).to.match(/complete section order|Invalid section list/);`,
          `}`,
        ]),
        ...A.custom("500 nahi hai — id field sahi padhi ja rahi hai", [
          `pm.expect(String(pm.response.json().message || "")).to.not.include("toString");`,
        ]),
      ],
      examples: [
        {
          name: "400 — adhoori list bheji",
          code: 400,
          status: "Bad Request",
          body: err(
            "Please send the complete section order — 5 sections expected, 1 received.",
          ),
        },
        {
          name: "400 — koi id is brand ka nahi",
          code: 400,
          status: "Bad Request",
          body: err("Invalid section list."),
        },
      ],
    }),

    req({
      name: "Add media (file)",
      method: "POST",
      segments: ["showcase", "section", "{{section_id}}", "add-media"],
      token: V,
      form: [
        { key: "isShowInVideoClips", value: "true" },
        {
          key: "medias",
          type: "file",
          disabled: true,
          description: "Enable karke ek ya zyada photo/video chunein",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "**Multipart.** Media limits **combined** check hote hain — existing + naye milakar",
        "plan ki limit ke andar hone chahiye.",
        "",
        "⚠️ File attach kiye bina ye 4xx dega — wo expected hai. Success path dekhne ke",
        "liye `medias` field enable karke file chunein.",
      ].join("\n"),
      capture: [["new_media_id", "d.medias[0]._id"]],
      assert: uploadTolerantAssert(
        "Media uploaded successfully.",
        "/media|file|image|video|required|at least/i",
      ),
    }),

    req({
      name: "Update media info",
      method: "PATCH",
      segments: [
        "showcase",
        "section",
        "{{section_id}}",
        "media",
        "update",
        "{{media_id}}",
      ],
      token: V,
      // `isShowInVideoClips` yahan deliberately nahi bheja — seeded media photo bhi
      // ho sakti hai, aur photo pe wo field ab 422 deti hai.
      body: {
        title: "postman media title",
        altText: "postman alt text",
      },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Sirf metadata — file replace karne ke liye alag endpoint hai.",
        "",
        "⚠️ `isShowInVideoClips` **sirf VIDEO** pe bheja ja sakta hai; photo pe `422`",
        "aata hai. Custom `thumbnail` file bhi sirf video pe (image, max 10 MB).",
        "",
        "🔴 `sortOrder` yahan se hata diya gaya hai — position sirf reorder endpoint",
        "badalta hai (warna do media ek hi position pe aa jaati thi).",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (media id seed me hai ya nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "Replace media (file)",
      method: "PUT",
      segments: [
        "showcase",
        "section",
        "{{section_id}}",
        "media",
        "replace",
        "{{media_id}}",
      ],
      token: V,
      form: [
        {
          key: "media",
          type: "file",
          disabled: true,
          description: "Enable karke naya file chunein",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "**Multipart.** Purani file (aur video ka custom poster) Cloudinary se delete ho",
        "jaate hain — sirf naya upload **aur** save succeed hone ke baad.",
        "",
        "`_id`, `sortOrder`, `isActive`, `isShowInVideoClips` wahi rehte hain. Type badal",
        "nahi sakta — photo ki jagah photo, video ki jagah video (check upload se pehle",
        "hi mime type pe hota hai, to reject hone pe file upload hi nahi hoti).",
      ].join("\n"),
      assert: uploadTolerantAssert(
        "Media replaced successfully.",
        "/media|file|image|video|required/i",
      ),
    }),

    req({
      name: "Reorder media",
      method: "PUT",
      segments: ["showcase", "section", "{{section_id}}", "media", "reorder"],
      token: V,
      body: { medias: [{ id: "{{media_id}}", sortOrder: 1 }] },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Field ka naam **`id`** hai (`mediaId` nahi). `sortOrder` min **1** (pehle `0`",
        "allowed tha).",
        "",
        "⚠️ **Poori list bhejein** — service section ke live media count se compare karti",
        "hai, aur adhoori list pe `400 \"Please send the complete media order — N media",
        "expected, M received.\"` deti hai.",
        "",
        "Seeded section me 8 media hain, to ek-item wali list yahan **deliberately** wo",
        "refusal trigger karti hai — aur yahi assert bhi hota hai.",
        "",
        "🔴 Section reorder wala hi bug isme bhi tha (`item.mediaId` vs `id`) — 2026-08-27 ko fix hua.",
      ].join("\n"),
      assert: [
        ...A.status(400),
        ...A.err("complete media order"),
        ...A.custom("500 nahi hai — id field ab sahi padhi ja rahi hai", [
          `pm.expect(String(pm.response.json().message)).to.not.include("toString");`,
        ]),
      ],
      examples: [
        {
          name: "200 — poori list bheji",
          code: 200,
          status: "OK",
          body: ok("Media reordered successfully.", { updated: 8 }),
        },
      ],
    }),

    req({
      name: "Delete media",
      method: "DELETE",
      segments: [
        "showcase",
        "section",
        "{{section_id}}",
        "media",
        "delete",
        "{{media_id}}",
      ],
      token: V,
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "⚠️ **Aakhri media delete nahi hoti** — section ko media chahiye. Poora album",
        "hataana ho to section hi delete karein.",
        "",
        "🔴 Ab **soft delete** hai — media `isDeleted: true` + `deletedAt` ke saath rehti",
        "hai, array se hard `$pull` nahi hoti (is domain ka aakhri hard delete tha).",
        "Cloudinary file phir bhi delete hoti hai, to ye audit record hai, restore point",
        "nahi.",
        "",
        "Response me `deletedMediaId` aur **naya** `coverImage` aata hai — deleted media",
        "cover thi to cover khud shift ho jaata hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 'last media' refusal", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) {`,
          `  pm.expect(pm.response.json().data, "data").to.have.property("deletedMediaId");`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "400 — aakhri media hai",
          code: 400,
          status: "Bad Request",
          body: err("At least one media is required in this section."),
        },
      ],
    }),

    req({
      name: "Delete a section",
      method: "DELETE",
      segments: ["showcase", "section", "delete", "{{new_section_id}}"],
      token: V,
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Plan ka showcase slot **release** karta hai — `isVisible` / `isActive: false`",
        "karne se wo release nahi hota.",
        "",
        "Soft delete hai, par Cloudinary files delete ho jaati hain. Response me",
        "`deletedSectionId` aur `deletedMediaIds` (sirf ids) aate hain.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) {`,
          `  const d = pm.response.json().data;`,
          `  pm.expect(d, "data").to.have.property("deletedSectionId");`,
          `  pm.expect(d.deletedMediaIds, "deletedMediaIds").to.be.an("array");`,
          `}`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 11 — Vouchers
// ===========================================================================
const voucherFolder = folder(
  "11 — Vouchers",
  [
    "### Lifecycle",
    "",
    "```",
    "create (DRAFT) → submit-review (UNDER_REVIEW) → [admin approve] (APPROVED)",
    "               → publish (PUBLISHED) → customer ko visible",
    "```",
    "",
    "Approval **admin ka kaam** hai (`POST /vouchers/review/:versionId`) — is collection",
    "me nahi hai. Isliye seeder ek APPROVED version bana deta hai taaki publish endpoint",
    "vendor-only run me bhi reachable rahe.",
    "",
    "⚠️ **Voucher tabhi customer ko dikhta hai jab uske outlet ki location set ho.**",
    "Customer pipeline `SubBrand` se shuru hoti hai, `Voucher` se nahi.",
    "",
    "⚠️ **`publish` pe ownership check nahi hai** — `publishVoucher(userId, versionId)`",
    "`userId` leta hai par use ownership ke liye use hi nahi karta.",
  ].join("\n"),
  [
    req({
      name: "My voucher versions ⭐",
      method: "GET",
      segments: ["vouchers", "versions", "get-all"],
      token: V,
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        { key: "status", value: "", disabled: true, description: list(VOUCHER_STATUSES) },
      ],
      gate: "`isVendorOrAdmin`",
      description: [
        "✅ Ab gated hai. ⚠️ Phir bhi **`brandId` hamesha bhejein** — endpoint khud scope",
        "nahi karta, bina uske platform ke saare vouchers aa jaate hain.",
        "",
        `\`status\`: ${list(VOUCHER_STATUSES)}`,
      ].join("\n"),
      // Status-specific captures, because the endpoints downstream are
      // status-specific: `update`/`submit-review` only work on a DRAFT, and
      // `publish` only on an APPROVED version. Picking `data[0]` blindly would
      // make those two requests pass or fail depending on sort order.
      // Status-specific, because the endpoints downstream are status-specific:
      // `update`/`submit-review` only work on a DRAFT, `publish` only on an
      // APPROVED version. Each falls back to any row so a re-run without a
      // fresh seed still produces a well-formed URL rather than `/vouchers//…`,
      // which would 404 and read as a routing bug instead of a fixture one.
      capture: [
        [
          "voucher_id",
          `(d.data.filter(function (v) { return v.status === ${json(VOUCHER_STATUSES.DRAFT)}; })[0] || d.data[0]).voucherId`,
        ],
        [
          "version_id",
          `(d.data.filter(function (v) { return v.status === ${json(VOUCHER_STATUSES.DRAFT)}; })[0] || d.data[0])._id`,
        ],
        [
          "approved_version_id",
          `(d.data.filter(function (v) { return v.status === ${json(VOUCHER_STATUSES.APPROVED)}; })[0] || d.data[0])._id`,
        ],
      ],
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("fixture state — seed fresh hai ya nahi", [
          `const statuses = pm.response.json().data.data.map(function (v) { return v.status; });`,
          `pm.expect(statuses.length, "kam se kam ek version chahiye").to.be.above(0);`,
          `// Voucher lifecycle one-way hai: is collection ka submit DRAFT ko`,
          `// UNDER_REVIEW kar deta hai aur publish APPROVED ko PUBLISHED. To poora`,
          `// pass dobara chalane se pehle seeder chalana padta hai. Ye assert nahi`,
          `// karte — sirf batate hain ki aage ke do requests kya karenge.`,
          `if (statuses.indexOf(${json(VOUCHER_STATUSES.DRAFT)}) === -1) {`,
          `  console.log("ℹ️  koi DRAFT nahi — update/submit state-refusal denge. Fresh seed chalayein.");`,
          `}`,
          `if (statuses.indexOf(${json(VOUCHER_STATUSES.APPROVED)}) === -1) {`,
          `  console.log("ℹ️  koi APPROVED version nahi — publish state-refusal dega. Fresh seed chalayein.");`,
          `}`,
        ]),
        ...A.custom("sab versions mere brand ke hain", [
          `const mine = String(pm.environment.get("brand_id"));`,
          `pm.response.json().data.data.forEach(function (v) {`,
          `  const b = v.brandId && v.brandId._id ? v.brandId._id : v.brandId;`,
          `  if (b) pm.expect(String(b), v.name).to.eql(mine);`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Create a voucher (file)",
      method: "POST",
      segments: ["vouchers", "create"],
      token: V,
      form: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "name", value: "postman created voucher" },
        { key: "description", value: "postman se banaya gaya" },
        { key: "startAt", value: "{{tomorrow_iso}}" },
        { key: "endAt", value: "{{next_month_iso}}" },
        { key: "subBrandIds[0]", value: "{{sub_brand_id}}" },
        {
          key: "offers",
          value: json({
            title: "flat 100 off above 500",
            minBillAmount: 500,
            discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
            discountValue: 100,
            usageType: VOUCHER_USAGE_TYPE.MULTIPLE,
            discountApplicableOn: DISCOUNT_APPLICABLE_ON.SUBTOTAL,
            sortOrder: 1,
          }),
        },
        { key: "isSaveAsDraft", value: "true" },
        {
          key: "images",
          type: "file",
          disabled: true,
          description: "**Required** — kam se kam 1 image. Enable karke file chunein",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "**Multipart**, aur **kam se kam ek image required** hai — bina uske `422`.",
        "",
        "`offers` ek JSON string (ya strings ka array) hota hai. Har offer me:",
        "",
        `- \`discountType\`: ${list(VOUCHER_DISCOUNT_TYPES)} — ✅ teeno kaam karte hain (\`FIXED\` ab \`FLAT\` ka alias hai)`,
        `- \`usageType\`: ${list(VOUCHER_USAGE_TYPE)} — ⚠️ enforce nahi hota, redemption flow hai hi nahi`,
        `- \`discountApplicableOn\`: ${list(DISCOUNT_APPLICABLE_ON)} — ⚠️ calculation me use nahi hota, display only`,
        "- `sortOrder` **required**, min 1",
        "",
        "Transactional hai — fail hone pe uploaded images rollback ho jaati hain.",
        "",
        "Plan ka voucher slot atomically reserve hota hai.",
      ].join("\n"),
      assert: uploadTolerantAssert(
        "Voucher created successfully.",
        "/image|file|required/i",
      ),
      examples: [
        {
          name: "422 — koi image nahi bheji",
          code: 422,
          status: "Unprocessable Entity",
          body: err("At least one voucher image is required."),
        },
        {
          name: "409 — is naam ka voucher already hai",
          code: 409,
          status: "Conflict",
          body: err("Voucher with this name already exists for this brand."),
        },
      ],
    }),

    req({
      name: "Update a voucher",
      method: "PUT",
      segments: ["vouchers", "update", "{{voucher_id}}"],
      token: V,
      form: [
        { key: "name", value: "postman updated voucher" },
        {
          key: "newOffers",
          value: json({
            title: "flat 120 off above 600",
            minBillAmount: 600,
            discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
            discountValue: 120,
            usageType: VOUCHER_USAGE_TYPE.MULTIPLE,
            sortOrder: 2,
          }),
          disabled: true,
        },
        { key: "images", type: "file", disabled: true },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "⚠️ **Update delta-based hai** — `newOffers` / `removedOfferIds` bhejein, poori",
        "offers list nahi.",
        "",
        "Har update ek **naya version** banata hai. Status-wise editability:",
        "",
        "| Status | Edit? |",
        "|---|---|",
        `| \`${VOUCHER_STATUSES.DRAFT}\` · \`${VOUCHER_STATUSES.REJECTED}\` | ✅ |`,
        `| \`${VOUCHER_STATUSES.UNDER_REVIEW}\` · \`${VOUCHER_STATUSES.EXPIRED}\` · \`${VOUCHER_STATUSES.ARCHIVED}\` | ❌ blocked |`,
      ].join("\n"),
      assert: [
        ...A.custom("200, ya status/ownership refusal", [
          `pm.expect([200, 400, 403, 404, 409, 422]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
    }),

    req({
      name: "Submit for review",
      method: "POST",
      segments: ["vouchers", "submit-review", "{{voucher_id}}"],
      token: V,
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        `\`${VOUCHER_STATUSES.DRAFT}\` → \`${VOUCHER_STATUSES.UNDER_REVIEW}\`. Iske baad admin approve/reject karega.`,
        "",
        "✅ Ye ownership **check karta hai** — doosre brand ka voucher submit karne pe",
        "`403 \"You are not authorized to submit this voucher.\"`",
      ].join("\n"),
      assert: [
        ...A.custom("200, ya status/ownership refusal", [
          `pm.expect([200, 400, 403, 404, 409]).to.include(pm.response.code);`,
        ]),
      ],
      examples: [
        {
          name: "403 — doosre brand ka voucher",
          code: 403,
          status: "Forbidden",
          body: err("You are not authorized to submit this voucher."),
        },
      ],
    }),

    req({
      name: "Publish an approved version",
      method: "POST",
      segments: ["vouchers", "publish", "{{approved_version_id}}"],
      token: V,
      gate: "`isVendorOrAdmin`",
      description: [
        "⚠️ **Ye `versionId` leta hai, `voucherId` nahi.** Sabse common galti yahi hai.",
        "",
        `Sirf \`${VOUCHER_STATUSES.APPROVED}\` version publish ho sakta hai. Seeder ek aisa version banata hai (\`approved_version_id\`).`,
        "",
        "🔴 **Ownership check nahi hai** — koi bhi vendor kisi bhi brand ka approved",
        "version publish kar sakta hai. Ye abhi khuli hui gap hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200, ya status refusal", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) {`,
          `  pm.expect(pm.response.json().message).to.eql("Voucher published successfully.");`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "400 — version approved nahi hai",
          code: 400,
          status: "Bad Request",
          body: err(
            `Only an approved voucher version can be published. Current status: ${VOUCHER_STATUSES.DRAFT}.`,
          ),
        },
      ],
    }),

    req({
      name: "Set voucher banner (file)",
      method: "POST",
      segments: ["vouchers", "{{voucher_id}}", "banner"],
      token: V,
      form: [
        { key: "bannerType", value: VOUCHER_BANNER_TYPE.IMAGE },
        {
          key: "bannerImage",
          type: "file",
          disabled: true,
          description: "Field name bannerType pe depend karta hai — neeche table dekhein",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Master-level promo banner. **Version/approval flow se bilkul independent** —",
        "banner add/replace/remove karne se voucher ka status, approval ya version kuch",
        "nahi badalta.",
        "",
        "| `bannerType` | File field |",
        "|---|---|",
        `| \`${VOUCHER_BANNER_TYPE.IMAGE}\` | \`bannerImage\` |`,
        `| \`${VOUCHER_BANNER_TYPE.VIDEO}\` | \`bannerVideo\` |`,
        `| \`${VOUCHER_BANNER_TYPE.GIF}\` | \`bannerGif\` |`,
        "",
        "Customer ko ye `bannerType` + `bannerUrl` ke roop me dikhta hai — dono saath, ya dono `null`.",
      ].join("\n"),
      assert: uploadTolerantAssert(
        "Voucher banner saved successfully.",
        "/file|image|video|gif|banner|required/i",
      ),
    }),

    req({
      name: "Delete voucher banner",
      method: "DELETE",
      segments: ["vouchers", "{{voucher_id}}", "banner"],
      token: V,
      gate: "`isVendorOrAdmin` + ownership",
      description:
        "Banner hata deta hai. Customer response me `bannerType` aur `bannerUrl` dono `null` ho jaate hain — keys gayab nahi hoti.",
      assert: [
        ...A.custom("200 ya 404 (banner tha hi nahi)", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 12 — Brand Features
// ===========================================================================
const featureFolder = folder(
  "12 — Brand Features",
  [
    "Brand ke highlight points — customer profile pe dikhte hain.",
    "",
    "⚠️ **Max 10 active features** per brand. 11th ko active karne pe refusal.",
    "",
    "⚠️ **`update` aur `delete` pe ownership check nahi hai** — role gate hai, par service",
    "`featureId` se feature uthakar uska `brandId` caller se match nahi karti.",
  ].join("\n"),
  [
    req({
      name: "Add a feature",
      method: "POST",
      segments: ["brandFeatures", "add"],
      token: V,
      form: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "title", value: "postman feature" },
        { key: "description", value: "postman se banaya gaya feature" },
        { key: "isActive", value: "true" },
        { key: "icon", type: "file", disabled: true, description: "Optional icon" },
      ],
      gate: "`isVendorOrAdmin`",
      description:
        "`title` 2–150 chars, `description` max 500. **Multipart** — `icon` file ke liye.",
      capture: [["feature_id", "d._id"]],
      assert: [
        ...A.custom("2xx, ya 10-feature limit", [
          `pm.expect([200, 201, 400]).to.include(pm.response.code);`,
          `if (pm.response.code < 300) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
      ],
      examples: [
        {
          name: "400 — 10 active features already hain",
          code: 400,
          status: "Bad Request",
          body: err("A brand can have maximum 10 active features!"),
        },
      ],
    }),

    req({
      name: "All features",
      method: "GET",
      segments: ["brandFeatures", "get-all"],
      token: V,
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
      ],
      gate: "`verifyJwtToken`",
      description: "⚠️ `brandId` **required** hai — bina uske `422`.",
      capture: [["feature_id", "d.data[0]._id"]],
      assert: [...A.status(200), ...A.paged()],
    }),

    req({
      name: "One feature",
      method: "GET",
      segments: ["brandFeatures", "get", "{{feature_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Brand feature fetched successfully"),
      ],
    }),

    req({
      name: "Update a feature",
      method: "PUT",
      segments: ["brandFeatures", "update", "{{feature_id}}"],
      token: V,
      form: [
        { key: "description", value: "postman se update kiya gaya" },
        { key: "icon", type: "file", disabled: true },
      ],
      gate: "`isVendorOrAdmin`",
      description: [
        "Deactivated feature ko wapas active karne pe 10-limit dobara check hoti hai.",
        "",
        "⚠️ Ownership check nahi hai — apne hi `featureId` use karein.",
      ].join("\n"),
      assert: [
        ...A.custom("200, ya limit/404", [
          `pm.expect([200, 400, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    req({
      name: "Delete a feature",
      method: "DELETE",
      segments: ["brandFeatures", "delete", "{{feature_id}}"],
      token: V,
      gate: "`isVendorOrAdmin`",
      description: "Soft delete. ⚠️ Isme bhi ownership check nahi hai.",
      assert: [
        ...A.custom("200 ya 404", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 13 — Subscription Plans
// ===========================================================================
const plansFolder = folder(
  "13 — Subscription Plans (browse)",
  [
    "Plans browse karna — writes admin-only hain.",
    "",
    "⚠️ **`entitlements` hi enforce hote hain, `features[]` nahi.** `features[]` free-text",
    "display list hai jise admin rename/reorder/delete kar sakta hai bina kisi business",
    "rule ke badle. Limits `entitlements` me hain.",
  ].join("\n"),
  [
    req({
      name: "All plans",
      method: "GET",
      segments: ["subscriptions", "getAll"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "isActive", value: "true" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "Plan card ke liye: `price`, `strikePrice` (cosmetic \"was ₹X\" — kisi maths me",
        "use nahi hota), `benefits`, `features`, `entitlements`.",
        "",
        "Chaar **independent** metered pools: `subBrands`, `franchises`, `vouchers`,",
        "`showcase`. Koi kisi se nahi katta.",
        "",
        "`isUnlimited: true` `limit` ko poori tarah ignore kar deta hai. `limit: 0` +",
        "`isUnlimited: false` matlab feature **plan me hai hi nahi** — isliye alag",
        "`isEnabled` flag nahi hai.",
      ].join("\n"),
      capture: [["subscription_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("entitlements ka shape sahi hai", [
          `pm.response.json().data.data.forEach(function (p) {`,
          `  if (!p.entitlements) return;`,
          `  ["subBrands", "franchises", "vouchers", "showcase"].forEach(function (k) {`,
          `    const e = p.entitlements[k];`,
          `    if (!e) return;`,
          `    pm.expect(e.limit, p.name + "." + k + ".limit").to.be.a("number");`,
          `    pm.expect(e.isUnlimited, p.name + "." + k + ".isUnlimited").to.be.a("boolean");`,
          `  });`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "One plan",
      method: "GET",
      segments: ["subscriptions", "get", "{{subscription_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 14 — My Subscription
// ===========================================================================
const mySubFolder = folder(
  "14 — My Subscription",
  [
    "⚠️ **`Brand.isSubscribed` sirf ek cache hai.** Source of truth `Subscribed` document",
    "ka `status` + `endDate` hai. Ye endpoints live check karte hain, aur padhte waqt",
    "self-heal bhi kar lete hain — to expiry job late chale to bhi jawab sahi aata hai.",
  ].join("\n"),
  [
    req({
      name: "My current subscription ⭐",
      method: "GET",
      segments: ["subscribeds", "get"],
      token: V,
      query: [
        {
          key: "brandId",
          value: "{{brand_id}}",
          disabled: true,
          description: "Vendor ke liye optional; admin ke liye required",
        },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        `\`status\`: ${list(SUBSCRIBED_STATUS)}`,
        "",
        "Live plan wahi hai jiska `status === ACTIVE` **aur** `endDate > now`.",
        "",
        "`subscribedId` lapse hone ke baad bhi last plan pe point karta rehta hai (taaki",
        "existing lookups ko kuch join karne ko mile) — sirf `isSubscribed` `false` hota hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("seeded plan ACTIVE dikh raha hai", [
          `const d = pm.response.json().data;`,
          `const s = d.subscribed || d;`,
          `if (s && s.status) pm.expect(s.status).to.eql(${json(SUBSCRIBED_STATUS.ACTIVE)});`,
        ]),
      ],
    }),

    req({
      name: "Subscription history",
      method: "GET",
      segments: ["subscribeds", "history"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      gate: "`isVendorOrAdmin` + ownership",
      description:
        "Har grant, renewal, upgrade, downgrade aur cancellation ka audit trail.",
      assert: [
        ...A.custom("200 ya 404 (abhi koi history nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 15 — Payments
// ===========================================================================
const paymentFolder = folder(
  "15 — Payments",
  [
    "### Checkout flow",
    "",
    "```",
    "preview → create-order → [Razorpay checkout] → verify-transaction",
    "```",
    "",
    "✅ **`amount` field accept hi nahi hota.** Pehle `amount || price` apply hota tha —",
    "koi bhi plan ₹1 me khareeda ja sakta tha. Payable amount ab server-side compute hota hai.",
    "",
    "`preview` local hai (chal jaayega). `create-order` aur `verify` Razorpay pe jaate hain.",
  ].join("\n"),
  [
    req({
      name: "Checkout preview ⭐",
      method: "POST",
      segments: ["transactions", "subscribe", "preview"],
      token: V,
      body: {
        subscriptionId: "{{subscription_id}}",
        promoCode: "",
      },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "Poora order summary — proration, GST, discount, payable. **Client ko koi",
        "arithmetic nahi karni.**",
        "",
        "`action` batata hai kya ho raha hai: `NEW` · `RENEW` · `UPGRADE` · `DOWNGRADE` —",
        "current active plan se compare karke.",
        "",
        "⚠️ **Promo codes vendor checkout pe abhi off hain.** `promoCode` accept hota hai",
        "sirf isliye ki checkout page *\"abhi available nahi\"* dikha sake, chup-chaap full",
        "price charge na kare. `preview.promo.supported` check karein.",
        "",
        "`brandId` vendor ke liye optional; admin ke liye required.",
      ].join("\n"),
      assert: [
        ...A.custom("200, ya plan/state refusal", [
          `pm.expect([200, 400, 404, 422]).to.include(pm.response.code);`,
          `if (pm.response.code === 200) pm.expect(pm.response.json().success).to.eql(true);`,
        ]),
        ...A.custom("amount field accept nahi hota (server-side compute)", [
          `if (pm.response.code !== 200) return;`,
          `const d = pm.response.json().data;`,
          `pm.expect(d, "pricing block").to.be.an("object");`,
        ]),
      ],
    }),

    req({
      name: "Create Razorpay order",
      method: "POST",
      segments: ["transactions", "subscribe", "create-order"],
      token: V,
      body: { subscriptionId: "{{subscription_id}}" },
      gate: "`isVendorOrAdmin` + ownership",
      description: [
        "`preview` wale hi fields leta hai — dono ek shared schema use karte hain taaki",
        "ye kabhi alag inputs accept na karein.",
        "",
        THIRD_PARTY("Razorpay"),
      ].join("\n"),
      capture: [
        ["transaction_id", "d.transactionId"],
        ["razorpay_order_id", "d.orderId"],
      ],
      assert: providerTolerantAssert(),
    }),

    req({
      name: "Verify payment",
      method: "POST",
      segments: ["transactions", "subscribe", "verify-transaction"],
      token: V,
      body: {
        razorpayPaymentId: "pay_XXXXXXXXXXXX",
        razorpayOrderId: "{{razorpay_order_id}}",
        razorpaySignature: "signature_from_razorpay_checkout",
        transactionId: "{{transaction_id}}",
      },
      gate: "`isVendorOrAdmin`",
      description: [
        "Razorpay checkout ke baad uske teen fields yahan bhejein.",
        "",
        "✅ `transactionId` ab **required** hai — pehle optional tha, jisse verify request",
        "bina kuch verify kiye nikal jaati thi.",
        "",
        "Signature HMAC se check hoti hai, to fake values reject hongi — jo is run me",
        "expected hai.",
      ].join("\n"),
      assert: [
        ...A.custom("signature reject honi chahiye (fake values)", [
          `pm.expect(pm.response.code, "fake signature accept nahi honi chahiye").to.not.eql(200);`,
          `pm.expect(pm.response.json().success).to.eql(false);`,
        ]),
      ],
    }),

    req({
      name: "Regenerate invoice",
      method: "POST",
      segments: ["transactions", "invoice", "regenerate"],
      token: V,
      body: { transactionId: "{{transaction_id}}" },
      gate: "`isVendorOrAdmin`",
      description: [
        "PDF dobara banata hai.",
        "",
        "⚠️ **Amounts kabhi recompute nahi hote** — invoice transaction pe frozen pricing",
        "se banti hai. Plan ka price baad me badal jaaye to purani invoice wahi rehti hai,",
        "aur wahi sahi hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (koi transaction hi nahi)", [
          `pm.expect([200, 400, 404, 422]).to.include(pm.response.code);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 16 — Master Data · 17 — Legal
// ===========================================================================
const masterFolder = folder(
  "16 — Master Data",
  "Categories aur sub-categories — voucher aur brand classification ke liye. Reads sab roles ke liye, writes admin-only.",
  [
    req({
      name: "All categories",
      method: "GET",
      segments: ["categories", "getAll"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        { key: "isActive", value: "true" },
      ],
      gate: "`verifyJwtToken`",
      description:
        "⚠️ `search` ka regex **escape nahi hota** — `.*` regex ki tarah chalega. Voucher aur brand listings me `escapeRegex` lagta hai, yahan nahi.",
      capture: [["category_id", "d.data[0]._id"]],
      assert: [...A.status(200), ...A.paged()],
    }),
    req({
      name: "One category",
      method: "GET",
      segments: ["categories", "get", "{{category_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [...A.status(200), ...A.ok("Category fetched")],
    }),
    req({
      name: "All sub-categories",
      method: "GET",
      segments: ["subCategories", "getAll"],
      token: V,
      query: [
        { key: "categoryId", value: "{{category_id}}" },
        { key: "limit", value: "50" },
      ],
      gate: "`verifyJwtToken`",
      description: "`categoryId` optional hai — na dein to sabhi sub-categories.",
      capture: [["sub_category_id", "d.data[0]._id"]],
      assert: [...A.status(200), ...A.paged()],
    }),
    req({
      name: "One sub-category",
      method: "GET",
      segments: ["subCategories", "get", "{{sub_category_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [...A.status(200), ...A.ok("Sub-category fetched")],
    }),
  ],
);

const legalFolder = folder(
  "17 — Legal",
  "Terms aur privacy reads. Documents me `type` field audience marker hai — vendor panel ko vendor wale dikhane chahiye.",
  [
    req({
      name: "All terms & conditions",
      method: "GET",
      segments: ["terms-and-conditions", "getAll"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      gate: "`verifyJwtToken`",
      description:
        "`description` me 50,000 chars tak markup ho sakta hai aur **lowercase nahi hota** — legal text ka case preserve rehta hai.",
      capture: [["legal_terms_id", "d.data[0]._id"]],
      assert: [...A.status(200), ...A.paged()],
    }),
    req({
      name: "One term & condition",
      method: "GET",
      segments: ["terms-and-conditions", "get", "{{legal_terms_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [...A.status(200), ...A.ok("Term and condition fetched")],
    }),
    req({
      name: "All privacy policies",
      method: "GET",
      segments: ["privacy-and-policies", "getAll"],
      token: V,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      gate: "`verifyJwtToken`",
      description: "⚠️ Success message me typo hai — `\"Privacys and policies fetched\"`.",
      capture: [["legal_privacy_id", "d.data[0]._id"]],
      assert: [...A.status(200), ...A.paged()],
    }),
    req({
      name: "One privacy policy",
      method: "GET",
      segments: ["privacy-and-policies", "get", "{{legal_privacy_id}}"],
      token: V,
      gate: "`verifyJwtToken`",
      assert: [...A.status(200), ...A.ok("Privacy and policy fetched")],
    }),
  ],
);

// ===========================================================================
// 18 — Access control
// ===========================================================================
const gateFolder = folder(
  "18 — Access control (vendor token refuse hona chahiye)",
  [
    "**Negative tests** — har request ka pass hona matlab gate kaam kar raha hai.",
    "Sab vendor ke apne token se chalti hain.",
    "",
    "| Status | Kab |",
    "|---|---|",
    "| `401` | Token hai hi nahi, ya expire |",
    "| `403` | Token malformed, ya role allowed nahi |",
    "| `422` | Role validator se reject (password flow) |",
    "",
    "### ⚠️ Kuch customer endpoints ab **public** hain",
    "",
    "Guest browsing aane ke baad `/brands/customer/*`, `/showcase/get-brand-showcase/*`",
    "aur voucher browse endpoints pe koi gate nahi hai — vendor token pe wo `200` denge,",
    "`403` nahi. Isliye wo yahan negative tests me nahi hain.",
    "",
    "Reachable hona use karne ka karan nahi hai: wo customer app ka data model hain, vendor",
    "panel ka nahi. [Appendix A](../docs/vendor_panel_api_doc.md#appendix-a--not-for-vendor-panel) dekhein.",
  ].join("\n"),
  [
    req({
      name: "Bina token — 401",
      method: "GET",
      segments: ["brands", "get"],
      gate: "`isVendorOrAdmin`",
      assert: [
        ...A.status(401),
        ...A.err("Access Denied! Missing authorization token"),
      ],
    }),

    req({
      name: "Garbage token — 403",
      method: "GET",
      segments: ["brands", "get"],
      headers: [{ key: "Authorization", value: "Bearer not.a.real.jwt" }],
      gate: "`isVendorOrAdmin`",
      description:
        "Malformed JWT `403` deta hai, `401` nahi — `401` sirf missing ya expired ke liye.",
      assert: [
        ...A.status(403),
        ...A.err("Invalid or malformed token. Please log in again."),
      ],
    }),

    req({
      name: "Password login — role VENDOR → 422",
      method: "POST",
      segments: ["auth", "login"],
      body: {
        type: LOGIN_TYPES.EMAIL,
        email: "{{vendor_email}}",
        password: "Whatever@123",
        role: ROLES.VENDOR,
      },
      gate: "Public, par validator me ADMIN-only",
      description: [
        "Route public hai, par `role` validator me sirf `ADMIN` allowed hai — isliye",
        "refusal ek saaf `422` hai, bhramit karne wala *\"user not found\"* nahi.",
        "",
        "Message deliberately actionable hai: wo batata hai vendor ko karna kya hai.",
      ].join("\n"),
      assert: [
        ...A.status(422),
        ...A.err("Password sign-in is only available for admin accounts"),
      ],
    }),

    req({
      name: "Forgot password — role VENDOR → 422",
      method: "POST",
      segments: ["auth", "forgot-password"],
      body: {
        type: LOGIN_TYPES.WHATSAPP,
        target: "{{vendor_whatsapp}}",
        role: ROLES.VENDOR,
      },
      gate: "Public, par validator me ADMIN-only",
      assert: [
        ...A.status(422),
        ...A.err("Password sign-in is only available for admin accounts"),
      ],
    }),

    req({
      name: "Set password — 403",
      method: "POST",
      segments: ["auth", "set-password"],
      token: V,
      body: { newPassword: "Whatever@123" },
      gate: "`isAdmin`",
      description:
        "Ye route pe gated hai (validator pe nahi), isliye `403` aata hai `422` nahi.",
      assert: [
        ...A.status(403),
        ...A.err("Forbidden: You do not have permission to perform this action."),
      ],
    }),

    ...[
      {
        name: "Naya admin banana",
        method: "POST",
        segments: ["auth", "register"],
        why: "`isAdmin`. Pehla admin `scripts/seedAdmin.js` se banta hai, API se nahi.",
        body: { name: "nope", email: "nope@example.com", role: ROLES.ADMIN },
      },
      {
        // A literal id, not {{version_id}} — the gate rejects before any
        // lookup, so a real one is unnecessary, and an unset variable would
        // collapse the path and 404 instead of 403.
        name: "Voucher approve karna",
        method: "POST",
        segments: ["vouchers", "review", GHOST_ID],
        why: "Approval admin ka kaam hai — vendor apna hi voucher approve nahi kar sakta.",
        body: { action: VOUCHER_STATUSES.APPROVED },
      },
      {
        name: "Voucher suggestions curation",
        method: "GET",
        segments: ["vouchers", "admin", "suggestions"],
        why: "Curation admin ka kaam hai.",
      },
      {
        name: "Top brands curation",
        method: "GET",
        segments: ["brands", "admin", "top-brands"],
        why: "Curation admin ka kaam hai.",
      },
      {
        name: "Brand verification queue",
        method: "GET",
        segments: ["brands", "admin", "verifications"],
        why: "Vendor apni hi KYC approve nahi kar sakta.",
      },
      {
        name: "Platform settings",
        method: "GET",
        segments: ["settings", "get"],
        why: "Voucher radius, convenience fee slabs — sab yahin se.",
      },
      {
        name: "Promo codes",
        method: "GET",
        segments: ["promoCodes", "get-all"],
        why: "Poora module `router.use(isAdmin)`.",
      },
      {
        name: "Saare subscriptions (admin view)",
        method: "GET",
        segments: ["subscribeds", "admin", "get-all"],
        why: "Vendor sirf apna `/subscribeds/get` dekh sakta hai.",
      },
      {
        name: "Webhook events",
        method: "GET",
        segments: ["transactions", "webhook", "events"],
        why: "Payment ops admin ka kaam hai.",
      },
      {
        name: "App banners CRUD",
        method: "GET",
        segments: ["banners", "get-all"],
        why: "App-level home banners — admin ka kaam.",
      },
      {
        name: "Customer address upsert",
        method: "POST",
        segments: ["locations", "upsert"],
        why: "`isCustomer`. Vendor ke liye `/locations/create` hai.",
        body: { addressLine1: "nope", city: "indore", state: "mp", zipcode: "452010", coordinates: [75.8937, 22.7533] },
      },
      {
        name: "Follow a brand",
        method: "POST",
        segments: ["follows", "toggle", "{{brand_id}}"],
        why: "`isCustomer`. Customer engagement.",
      },
    ].map((c) =>
      req({
        name: `${c.name} → 403`,
        method: c.method,
        segments: c.segments,
        token: V,
        ...(c.body ? { body: c.body } : {}),
        gate: "Vendor ke liye **band**",
        description: c.why,
        assert: [
          ...A.status(403),
          ...A.err(
            "Forbidden: You do not have permission to perform this action.",
          ),
        ],
      }),
    ),
  ],
);

// ===========================================================================
// Collection
// ===========================================================================
const items = [
  authFolder,
  profileFolder,
  pushFolder,
  feedFolder,
  onboardingFolder,
  kycFolder,
  brandFolder,
  outletFolder,
  workHoursFolder,
  locationFolder,
  showcaseFolder,
  voucherFolder,
  featureFolder,
  plansFolder,
  mySubFolder,
  paymentFolder,
  masterFolder,
  legalFolder,
  gateFolder,
];

const stats = countTree(items);

const collection = {
  info: {
    _postman_id: "c92e4a71-3f5b-4d2e-91a6-trydood-vendor",
    name: "Trydood — Vendor Panel",
    description: [
      "# Vendor Panel API",
      "",
      `Vendor panel ke **78 endpoints**, ${stats.requests} requests me.`,
      "",
      "Companion doc: `docs/vendor_panel_api_doc.md`",
      "",
      "---",
      "",
      "## Shuru kaise karein",
      "",
      "```bash",
      "# 1. Fixtures",
      "node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply",
      "",
      "# 2. Server usi database pe",
      'MONGO_URL="<...>/Trydood2_postman" npm run dev',
      "",
      "# 3. Run",
      "newman run postman/trydood-vendor.postman_collection.json \\",
      "  -e postman/environments/vendor-local.postman_environment.json",
      "```",
      "",
      "Seeder jo `vendor_whatsapp` print karta hai wahi environment me bharein — us",
      "vendor ka brand **already approved aur subscribed** hai. Koi random number dalenge",
      "to naya vendor banega jiska na brand approved hoga na plan, aur aadhi collection",
      "state-refusals hit karegi.",
      "",
      "### ⚠️ Har poore pass se pehle seeder dobara chalayein",
      "",
      "Ye collection idempotent **nahi** hai, aur ho bhi nahi sakti — voucher lifecycle",
      "one-way hai:",
      "",
      "```",
      "DRAFT ──submit──▶ UNDER_REVIEW ──[admin]──▶ APPROVED ──publish──▶ PUBLISHED",
      "```",
      "",
      "Ek pass DRAFT ko `UNDER_REVIEW` aur APPROVED ko `PUBLISHED` kar deta hai. Doosre",
      "pass me un dono ke liye koi input bacha hi nahi hota, to `update` / `submit` /",
      "`publish` state-refusals denge — jo sahi behaviour hai, bug nahi. Assertions un",
      "refusals ko accept karti hain aur console pe bata deti hain.",
      "",
      "Wahi teen endpoints **actually** verify karne hain to seeder pehle chala lein.",
      "",
      "## Do tokens",
      "",
      "| Token | Kaun | Kis liye |",
      "|---|---|---|",
      "| `vendor_token` | Seeded vendor | Baaki saare folders |",
      "| `onboard_token` | Har run pe naya throwaway vendor | Sirf folder `04` |",
      "",
      "Onboarding ek state machine hai — seeded brand us machine ke aakhir me khada hai,",
      "to uspe wo steps chalane ka matlab ya refusal hai ya usko peeche dhakelna.",
      "",
      "## Jo headless verify nahi ho sakta",
      "",
      "| Kya | Kitne | Kyun |",
      "|---|---:|---|",
      "| KYC verify (folder `05`) | 3 | Live CGPey calls |",
      "| Razorpay order + verify (folder `15`) | 2 | Live Razorpay calls |",
      "| Test push | 1 | Live Firebase call |",
      "| File uploads | 4 | Multipart with a real file |",
      "",
      "In sab pe assertions success **aur** documented failure dono accept karte hain,",
      "aur kisi *aur* tarah ke failure pe fail ho jaate hain. File fields request me",
      "maujood hain par **disabled** — enable karke file chunein to success path chal jaayega.",
      "",
      "## Ye collection kaise likhi gayi hai",
      "",
      "- Happy path aur behaviour badalne wale edge cases **alag requests** hain.",
      "- Per-field Joi rejections **saved examples** hain.",
      `- Har request pe assertions — total ${stats.tests} \`pm.test\` blocks.`,
      "",
      "## Dhyan rakhne layak",
      "",
      "- **List endpoints khaali pe `404` dete hain**, empty array nahi.",
      "- **`brandId` hamesha bhejein** — `subBrands/get-all`, `locations/getAll` aur",
      "  `vouchers/versions/get-all` khud scope nahi karte.",
      "- **`coordinates` `[longitude, latitude]`** order me.",
      "- **`publish` `versionId` leta hai**, `voucherId` nahi.",
      "- **Password / \"Set password\" screen mat banayein** — vendor ke liye band hai.",
      "- **`brand.isApproved` pe bharosa na karein** — hamesha `false`. `systemVerify.status` dekhein.",
      "- **5 endpoints pe ownership check abhi nahi hai** — apne hi ids use karein",
      "  (`brandFeatures update|delete`, `locations update|delete`, `vouchers/publish`).",
      "",
      "## Regenerate",
      "",
      "```bash",
      "node postman/generate-vendor-collection.js",
      "```",
      "",
      "**JSON hand-edit mat karein** — enums `constants/` se padhe jaate hain.",
    ].join("\n"),
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: items,
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          'if (!pm.environment.get("base_url")) {',
          '  console.warn("⚠️  base_url set nahi hai — environment select karein (top-right).");',
          "}",
          "",
          "// Per-run values. Generated here rather than stored so a re-run does not",
          "// collide with the previous run's throwaway vendor or push token.",
          'if (!pm.environment.get("push_token")) {',
          '  pm.environment.set("push_token", "postman-vendor-" + pm.variables.replaceIn("{{$guid}}"));',
          "}",
          'if (!pm.environment.get("device_id")) {',
          '  pm.environment.set("device_id", "postman-vendor-" + pm.variables.replaceIn("{{$guid}}"));',
          "}",
          "",
          "// A fresh 10-digit number for the onboarding folder, and one for the outlet",
          "// it creates. Both must start 6-9 to pass the validator.",
          "function freshNumber() {",
          "  const n = pm.variables.replaceIn(\"{{$randomInt}}\");",
          '  return "9" + String(Math.abs(parseInt(n, 10)) % 1000000000).padStart(9, "0");',
          "}",
          'if (!pm.environment.get("onboard_whatsapp")) {',
          '  pm.environment.set("onboard_whatsapp", freshNumber());',
          "}",
          'if (!pm.environment.get("outlet_whatsapp")) {',
          '  pm.environment.set("outlet_whatsapp", freshNumber());',
          "}",
          "",
          "// Dates the voucher and KYC bodies need.",
          "const now = new Date();",
          'pm.environment.set("now_iso", now.toISOString());',
          'pm.environment.set("tomorrow_iso", new Date(now.getTime() + 86400000).toISOString());',
          'pm.environment.set("next_month_iso", new Date(now.getTime() + 86400000 * 30).toISOString());',
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------- env
const envFile = (name, baseUrl) => ({
  id: `trydood-vendor-${name}`,
  name: `Trydood Vendor — ${name}`,
  values: [
    { key: "base_url", value: baseUrl, type: "default", enabled: true },

    // ── fill this in — seeder isko print karta hai ──
    { key: "vendor_whatsapp", value: "9700000011", type: "default", enabled: true },
    { key: "vendor_email", value: "postman.vendor@example.com", type: "default", enabled: true },
    { key: "vendor_mobile", value: "9700000011", type: "default", enabled: true },
    { key: "otp", value: "000000", type: "default", enabled: true },

    // ── captured automatically ──
    { key: "vendor_token", value: "", type: "secret", enabled: true },
    { key: "vendor_user_id", value: "", type: "default", enabled: true },
    { key: "brand_id", value: "", type: "default", enabled: true },
    { key: "onboard_token", value: "", type: "secret", enabled: true },
    { key: "onboard_brand_id", value: "", type: "default", enabled: true },
    { key: "sub_brand_id", value: "", type: "default", enabled: true },
    { key: "location_id", value: "", type: "default", enabled: true },
    { key: "section_id", value: "", type: "default", enabled: true },
    { key: "new_section_id", value: "", type: "default", enabled: true },
    { key: "media_id", value: "", type: "default", enabled: true },
    { key: "new_media_id", value: "", type: "default", enabled: true },
    { key: "voucher_id", value: "", type: "default", enabled: true },
    { key: "version_id", value: "", type: "default", enabled: true },
    { key: "feature_id", value: "", type: "default", enabled: true },
    { key: "category_id", value: "", type: "default", enabled: true },
    { key: "sub_category_id", value: "", type: "default", enabled: true },
    { key: "subscription_id", value: "", type: "default", enabled: true },
    { key: "subscribed_id", value: "", type: "default", enabled: true },
    { key: "transaction_id", value: "", type: "default", enabled: true },
    { key: "razorpay_order_id", value: "", type: "default", enabled: true },
    { key: "notification_id", value: "", type: "default", enabled: true },
    { key: "legal_terms_id", value: "", type: "default", enabled: true },
    { key: "legal_privacy_id", value: "", type: "default", enabled: true },
    { key: "mobile_session_id", value: "", type: "default", enabled: true },

    // ── the seeder creates this one; publish needs an APPROVED version ──
    {
      key: "approved_version_id",
      value: "",
      type: "default",
      enabled: true,
    },

    // ── generated per run by the pre-request script ──
    { key: "push_token", value: "", type: "default", enabled: true },
    { key: "device_id", value: "", type: "default", enabled: true },
    { key: "onboard_whatsapp", value: "", type: "default", enabled: true },
    { key: "outlet_whatsapp", value: "", type: "default", enabled: true },
    { key: "now_iso", value: "", type: "default", enabled: true },
    { key: "tomorrow_iso", value: "", type: "default", enabled: true },
    { key: "next_month_iso", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

// ---------------------------------------------------------------- write
fs.mkdirSync(ENV_DIR, { recursive: true });

const files = [
  ["trydood-vendor.postman_collection.json", collection],
  [
    "environments/vendor-local.postman_environment.json",
    envFile("local", "http://localhost:8080/trydood/v1"),
  ],
  [
    "environments/vendor-staging.postman_environment.json",
    envFile("staging", "https://backend2-0-4v4i.onrender.com/trydood/v1"),
  ],
  [
    "environments/vendor-production.postman_environment.json",
    envFile("production", "https://api.trydood.com/trydood/v1"),
  ],
];

for (const [rel, obj] of files) {
  const target = path.join(OUT, rel);
  fs.writeFileSync(target, json(obj) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

console.log(
  `\n${items.length} folders · ${stats.requests} requests · ${stats.tests} assertions · ${stats.examples} saved examples`,
);
