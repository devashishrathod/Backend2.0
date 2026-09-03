// Generates the "Security & API Changes" Postman v2.1 collection + environments.
//
//   node postman/generate-security-collection.js
//
// Scope: ONLY the endpoints whose behaviour, auth gate, request shape or response
// shape changed in the 2026-08-26 security round, plus the one endpoint that is
// genuinely new. Unchanged endpoints live in the other collections.
//
// Enums and limits are read from the real constants so this cannot drift from the
// code. Re-run after any change to those — do not hand-edit the JSON.
const fs = require("fs");
const path = require("path");

const { ROLES, LOGIN_TYPES, ADDRESS_TYPES } = require("../constants");
const { VOUCHER_DISCOUNT_TYPES, VOUCHER_SORT_BY } = require("../constants/voucher");
const { SHOWCASE_SECTION_TYPE } = require("../constants/showcase");
const { VOUCHER_BANNER_TYPE } = require("../constants/voucherBanner");
const { CONVENIENCE_FEE_DEFAULTS } = require("../constants/customer");

const OUT = __dirname;
const ENV_DIR = path.join(OUT, "environments");
const list = (o) => Object.values(o).join(", ");

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
      ? "?" + query.filter((q) => !q.disabled).map((q) => `${q.key}=${q.value}`).join("&")
      : ""),
  host: ["{{base_url}}"],
  path: segments,
  ...(query && query.length ? { query } : {}),
});

const jsonBody = (obj) => ({
  mode: "raw",
  raw: json(obj),
  options: { raw: { language: "json" } },
});

const ok = (message, data) => ({ success: true, message, data });
const err = (message, details) => ({
  success: false,
  message,
  ...(details ? { details } : {}),
});

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

/**
 * One request. `changed` renders as a banner at the top of the description so a
 * reader always knows *why* this endpoint is in this collection.
 */
const req = ({
  name,
  method,
  segments,
  query,
  body,
  token,
  changed,
  description,
  examples = [],
  script,
}) => {
  const request = {
    method,
    header: body ? [{ key: "Content-Type", value: "application/json" }] : [],
    ...(body ? { body: jsonBody(body) } : {}),
    url: url(segments, query),
    ...(token ? { auth: bearer(token) } : {}),
    description: [
      changed ? `### 🔄 Kya badla\n\n${changed}` : null,
      description || null,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),
  };

  return {
    name,
    request,
    response: examples.map((ex) => example({ ...ex, req: request })),
    ...(script
      ? {
          event: [
            {
              listen: "test",
              script: { type: "text/javascript", exec: script.split("\n") },
            },
          ],
        }
      : {}),
  };
};

/** Captures a token + a couple of ids into the environment. */
const captureAuth = (tokenVar, extra = []) =>
  [
    `const b = pm.response.json();`,
    `if (pm.response.code === 200 && b?.data?.token) {`,
    `  pm.environment.set("${tokenVar}", b.data.token);`,
    ...extra.map((e) => `  ${e}`),
    `  console.log("${tokenVar} saved");`,
    `}`,
  ].join("\n");

const folder = (name, description, item) => ({ name, description, item });

// ---------------------------------------------------------------- shared bits
const AUTH_ERRORS = `**Common auth errors** — har gated endpoint pe aa sakte hain:

| Status | Message |
|---|---|
| \`401\` | \`Access Denied! Missing authorization token\` |
| \`401\` | \`Your session has expired. Please log in again.\` |
| \`403\` | \`Forbidden: You do not have permission to perform this action.\` |
| \`403\` | \`Forbidden: You do not have permission to perform this action on this brand.\` |`;

// =============================================================== 00 AUTH
const authFolder = folder(
  "00 — Auth (token capture)",
  "Yahan se shuru karein. Har request apna token environment me likh deti hai, to " +
    "aage kahin copy-paste nahi karna padega.\n\n" +
    "⚠️ **WhatsApp OTP abhi verify nahi hota** (deliberate, deferred) — koi bhi 6-digit " +
    "chalega. Jab wo uncomment hoga to `Invalid OTP! Please try again.` aana shuru hoga.",
  [
    req({
      name: "Login as Admin (password)",
      method: "POST",
      segments: ["auth", "login"],
      body: {
        type: LOGIN_TYPES.EMAIL,
        email: "{{admin_email}}",
        password: "{{admin_password}}",
        role: ROLES.ADMIN,
      },
      changed:
        "`role` ab **sirf `ADMIN`** accept karta hai. Password sign-in customer/vendor " +
        "ke liye band kar diya gaya — wo WhatsApp OTP se aate hain.",
      description:
        "Admin ka JWT leta hai aur `admin_token` me save karta hai.\n\n" +
        "⚠️ Pehla admin API se nahi banta — `node scripts/seedAdmin.js` se banayein " +
        "(`/auth/register` ab `isAdmin` ke peeche hai).",
      script: captureAuth("admin_token", [
        'if (b.data.user?._id) pm.environment.set("admin_user_id", b.data.user._id);',
      ]),
      examples: [
        {
          name: "200 — logged in",
          code: 200,
          status: "OK",
          body: ok("Login successful", {
            user: { _id: "{{admin_user_id}}", role: ROLES.ADMIN, email: "admin@trydood.com" },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
          }),
        },
        {
          name: "422 — role=VENDOR ab reject hota hai",
          code: 422,
          status: "Unprocessable Entity",
          body: err(
            "Password sign-in is only available for admin accounts. Customers and vendors sign in with a WhatsApp OTP.",
          ),
        },
      ],
    }),

    req({
      name: "Vendor WhatsApp — Send OTP",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{vendor_whatsapp}}", role: ROLES.VENDOR },
      changed:
        "Do naye response fields aur ek naya guard:\n\n" +
        "- **`isFirst` ka matlab badla** — ab \"OTP verify nahi hua\" hai, \"User row " +
        "nayi hai\" nahi. Pehle OTP na aane pe retry karte hi `false` ho jaata tha.\n" +
        "- **`isProfileComplete`** naya field hai.\n" +
        "- **Naya `ADMIN` / `SUB_VENDOR` yahan ban nahi sakta** (`403`). Existing wale " +
        "login kar sakte hain.\n" +
        "- Response se **`password` hash strip** ho gaya.",
      description:
        "Naya number ho to `User` + `Brand` **ek transaction me** bante hain. Pehle " +
        "`Brand.create` fail hone pe vendor bina brand ke reh jaata tha aur kabhi " +
        "onboard nahi kar paata tha.\n\n" +
        "Purane toote accounts is call pe **khud repair** ho jaate hain.",
      script: [
        `const b = pm.response.json();`,
        `if (pm.response.code === 200) {`,
        `  pm.environment.set("is_first", String(b.data.isFirst));`,
        `  if (b.data.user?.brandId) pm.environment.set("brand_id", b.data.user.brandId);`,
        `  console.log("isFirst:", b.data.isFirst, "| isProfileComplete:", b.data.isProfileComplete);`,
        `}`,
      ].join("\n"),
      examples: [
        {
          name: "200 — naya vendor",
          code: 200,
          status: "OK",
          body: ok("OTP sent to your whatsapp number successfully.", {
            isFirst: true,
            isProfileComplete: false,
            user: {
              _id: "68f1a2b3c4d5e6f7a8b9c0d1",
              brandId: "{{brand_id}}",
              role: ROLES.VENDOR,
              whatsappNumber: "9812345678",
              uniqueId: "#TU12345",
              isMobileVerified: false,
              isActive: true,
            },
          }),
        },
        {
          name: "200 — OTP nahi aaya tha, retry (isFirst ab bhi true)",
          code: 200,
          status: "OK",
          body: ok("OTP sent to your whatsapp number successfully.", {
            isFirst: true,
            isProfileComplete: false,
            user: { _id: "68f1a2b3c4d5e6f7a8b9c0d1", role: ROLES.VENDOR, isMobileVerified: false },
          }),
        },
        {
          name: "403 — naya ADMIN banane ki koshish",
          code: 403,
          status: "Forbidden",
          body: err("This account type cannot be created here. Please contact support."),
        },
        {
          name: "403 — deactivated account",
          code: 403,
          status: "Forbidden",
          body: err("Your account is deactivated. Please contact support."),
        },
      ],
    }),

    req({
      name: "Vendor WhatsApp — Verify OTP",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: { whatsappNumber: "{{vendor_whatsapp}}", otp: "{{otp}}", role: ROLES.VENDOR },
      changed:
        "Response se **`password` hash strip** ho gaya, aur ab **deactivated account " +
        "check** bhi hota hai (pehle sirf step 1 pe tha).",
      description: "JWT deta hai aur `vendor_token` + `brand_id` save karta hai.",
      script: captureAuth("vendor_token", [
        'if (b.data.user?.brandId) pm.environment.set("brand_id", b.data.user.brandId);',
      ]),
      examples: [
        {
          name: "200 — verified",
          code: 200,
          status: "OK",
          body: ok("OTP verified successfully", {
            user: {
              _id: "68f1a2b3c4d5e6f7a8b9c0d1",
              brandId: "{{brand_id}}",
              role: ROLES.VENDOR,
              isMobileVerified: true,
              currentScreen: "BUSINESS_NAME",
            },
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
          }),
        },
        {
          name: "404 — is number+role ka user nahi",
          code: 404,
          status: "Not Found",
          body: err("Invalid Whatsapp number, user not found!"),
        },
      ],
    }),

    req({
      name: "Customer WhatsApp — Send OTP",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{customer_whatsapp}}", role: ROLES.CUSTOMER },
      changed: "Vendor jaisa hi — `isFirst` fix + naya `isProfileComplete`.",
      description: "Naya number ho to `User` + `Customer` ek transaction me bante hain.",
      examples: [
        {
          name: "200 — naya customer",
          code: 200,
          status: "OK",
          body: ok("OTP sent to your whatsapp number successfully.", {
            isFirst: true,
            isProfileComplete: false,
            user: {
              _id: "68f1a2b3c4d5e6f7a8b9c0d2",
              customerId: "68f1a2b3c4d5e6f7a8b9c0d3",
              role: ROLES.CUSTOMER,
              isMobileVerified: false,
            },
          }),
        },
      ],
    }),

    req({
      name: "Customer WhatsApp — Verify OTP",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: { whatsappNumber: "{{customer_whatsapp}}", otp: "{{otp}}", role: ROLES.CUSTOMER },
      changed: "Response se `password` hash strip.",
      description: "`customer_token` save karta hai.",
      script: captureAuth("customer_token"),
      examples: [
        {
          name: "200 — verified",
          code: 200,
          status: "OK",
          body: ok("OTP verified successfully", {
            user: { _id: "68f1a2b3c4d5e6f7a8b9c0d2", role: ROLES.CUSTOMER, isMobileVerified: true },
            token: "eyJ....",
          }),
        },
      ],
    }),
  ],
);

// =============================================================== 01 AUTH CHANGES
const authChangesFolder = folder(
  "01 — Auth (gates & password flow)",
  "Password sign-in ab **sirf admin** ke liye hai. Customer aur vendor WhatsApp OTP se " +
    "aate hain, to unpe password ek aur churane layak credential hota aur kuch nahi.",
  [
    req({
      name: "Register (ab isAdmin ke peeche)",
      method: "POST",
      segments: ["auth", "register"],
      token: "admin_token",
      body: {
        name: "New Admin",
        email: "newadmin@trydood.com",
        username: "new_admin",
        password: "Str0ngPass1",
        dob: "1990-01-15",
        mobile: "9800000000",
        whatsappNumber: "9800000000",
        role: ROLES.ADMIN,
      },
      changed:
        "**Pehle public tha aur `role` ka default `ADMIN` tha** — matlab koi bhi khud " +
        "ko super admin bana sakta tha.\n\n" +
        "Ab: `isAdmin` gate, aur `role` **required** hai (koi default nahi).",
      description:
        `\`role\` values: ${list(ROLES)}\n\n` +
        "⚠️ **Pehla admin API se nahi ban sakta** — bootstrap CLI se hota hai:\n\n" +
        "```bash\nnode scripts/seedAdmin.js \\\n" +
        "  --email admin@trydood.com --password 'Str0ngPass1' \\\n" +
        "  --name \"Admin User\" --username admin_user --mobile 9800000000 --apply\n```\n\n" +
        "`--apply` ke bina wo dry run hai.",
      examples: [
        {
          name: "201 — created",
          code: 201,
          status: "Created",
          body: ok("User registered successfully", {
            _id: "68f1a2b3c4d5e6f7a8b9c0f9",
            role: ROLES.ADMIN,
            email: "newadmin@trydood.com",
          }),
        },
        {
          name: "422 — role missing (pehle ADMIN default ho jaata tha)",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Role is required"),
        },
        {
          name: "403 — admin token ke bina",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action."),
        },
      ],
    }),

    req({
      name: "Set Password (ab isAdmin)",
      method: "POST",
      segments: ["auth", "set-password"],
      token: "admin_token",
      body: { currentPassword: "{{admin_password}}", newPassword: "N3wStr0ngPass" },
      changed: "Gate `verifyJwtToken` se **`isAdmin`** ho gaya.",
      description:
        "Pehli baar set kar rahe hain to `currentPassword` **mat bhejein** — " +
        "`GET /users/get` ka `passwordSetAt` batata hai ki password hai ya nahi.\n\n" +
        "Strength: 8–72 chars, kam se kam ek uppercase + ek lowercase + ek number.",
      examples: [
        {
          name: "200 — pehli baar",
          code: 200,
          status: "OK",
          body: ok("Password set successfully. You can now sign in with it.", {
            userId: "{{admin_user_id}}",
            wasFirstTime: true,
            passwordSetAt: "2026-08-26T12:00:00.000Z",
          }),
        },
        {
          name: "200 — change",
          code: 200,
          status: "OK",
          body: ok("Password changed successfully.", {
            userId: "{{admin_user_id}}",
            wasFirstTime: false,
            passwordSetAt: "2026-08-26T12:05:00.000Z",
          }),
        },
        {
          name: "403 — customer/vendor token se",
          code: 403,
          status: "Forbidden",
          body: err(
            "Password sign-in is not available for this account type. Please sign in with a WhatsApp OTP.",
          ),
        },
        {
          name: "401 — currentPassword galat",
          code: 401,
          status: "Unauthorized",
          body: err("Current password is incorrect."),
        },
        {
          name: "422 — wahi password dobara",
          code: 422,
          status: "Unprocessable Entity",
          body: err("The new password must be different from the current one."),
        },
      ],
    }),

    req({
      name: "Forgot Password (ADMIN only)",
      method: "POST",
      segments: ["auth", "forgot-password"],
      body: { type: LOGIN_TYPES.EMAIL, target: "{{admin_email}}", role: ROLES.ADMIN },
      changed: "`role` ab **sirf `ADMIN`**. Default bhi `ADMIN` ho gaya (pehle `CUSTOMER` tha).",
      description:
        "Response **hamesha same** hota hai, account ho ya na ho — warna ye endpoint " +
        "registered numbers/emails dhoondhne ka tareeka ban jaata.\n\n" +
        `\`type\`: ${LOGIN_TYPES.WHATSAPP}, ${LOGIN_TYPES.EMAIL}, ${LOGIN_TYPES.MOBILE}`,
      examples: [
        {
          name: "200 — hamesha yahi (enumeration-safe)",
          code: 200,
          status: "OK",
          body: ok(
            "If an account exists for this contact, a verification code has been sent.",
            {
              message:
                "If an account exists for this contact, a verification code has been sent.",
              type: LOGIN_TYPES.EMAIL,
            },
          ),
        },
        {
          name: "422 — role=CUSTOMER reject",
          code: 422,
          status: "Unprocessable Entity",
          body: err(
            "Password sign-in is only available for admin accounts. Customers and vendors sign in with a WhatsApp OTP.",
          ),
        },
      ],
    }),

    req({
      name: "Reset Password (ADMIN only)",
      method: "POST",
      segments: ["auth", "reset-password"],
      body: {
        type: LOGIN_TYPES.EMAIL,
        target: "{{admin_email}}",
        otp: "{{otp}}",
        role: ROLES.ADMIN,
        newPassword: "N3wStr0ngPass",
      },
      changed: "`role` ab **sirf `ADMIN`**.",
      description:
        "OTP `password-reset` purpose pe verify hota hai — login ka OTP yahan replay " +
        "nahi ho sakta. Success pe code consume ho jaata hai.\n\n" +
        "**Token issue nahi hota** — reset karne se session nahi milta, user naye " +
        "password se login kare.",
      examples: [
        {
          name: "200 — reset",
          code: 200,
          status: "OK",
          body: ok("Password updated. Please sign in with your new password.", {
            userId: "{{admin_user_id}}",
            passwordSetAt: "2026-08-26T12:10:00.000Z",
            message: "Password updated. Please sign in with your new password.",
          }),
        },
        { name: "401 — galat OTP", code: 401, status: "Unauthorized", body: err("Invalid OTP! Please try again.") },
        { name: "403 — attempts khatam", code: 403, status: "Forbidden", body: err("Max attempts exceeded! Please try again later.") },
      ],
    }),
  ],
);

// =============================================================== 02 USERS
const usersFolder = folder(
  "02 — Users (IDOR fixed)",
  "`?userId=` param dono endpoints se **hata diya gaya**. Wo token ko override kar deta " +
    "tha — matlab koi bhi valid token wala kisi ka bhi profile padh aur **badal** sakta tha.",
  [
    req({
      name: "Get my profile",
      method: "GET",
      segments: ["users", "get"],
      token: "customer_token",
      query: [
        {
          key: "userId",
          value: "68f1a2b3c4d5e6f7a8b9c0d1",
          disabled: true,
          description: "❌ Ab ignore hota hai — token hi user decide karta hai",
        },
      ],
      changed: "**`?userId` ab kaam nahi karta.** Hamesha token ka user hi milta hai.",
      description:
        "`password`, `otp`, `isDeleted` response se excluded hain.\n\n" +
        "`passwordSetAt` se pata chalta hai ki account pe password hai ya nahi.",
      examples: [
        {
          name: "200 — apna profile",
          code: 200,
          status: "OK",
          body: ok("User fetched successfully", {
            _id: "68f1a2b3c4d5e6f7a8b9c0d2",
            customerId: {
              _id: "68f1a2b3c4d5e6f7a8b9c0d3",
              fullName: "rahul sharma",
              locationId: { _id: "…", city: "indore", geo: { type: "Point", coordinates: [75.89, 22.75] } },
            },
            name: "rahul sharma",
            role: ROLES.CUSTOMER,
            whatsappNumber: "9876543210",
            uniqueId: "#TU12345",
            referralCode: "RAHUL7X2K",
            passwordSetAt: null,
            isMobileVerified: true,
            isActive: true,
          }),
        },
      ],
    }),

    req({
      name: "Update my profile",
      method: "PUT",
      segments: ["users", "update"],
      token: "customer_token",
      body: { fullName: "Rahul Sharma", email: "rahul@example.com", dob: "1998-04-12" },
      changed: "**`?userId` ab kaam nahi karta** — pehle isse kisi ka bhi profile edit ho sakta tha.",
      description:
        "Multipart bhi chalta hai — `image` field se profile picture.\n\n" +
        "Email badalne pe `isEmailVerified` reset ho jaata hai.",
      examples: [
        {
          name: "200 — updated",
          code: 200,
          status: "OK",
          body: ok("User profile updated successfully", {
            _id: "68f1a2b3c4d5e6f7a8b9c0d2",
            name: "rahul sharma",
            email: "rahul@example.com",
            isEmailVerified: false,
          }),
        },
        { name: "400 — email already used", code: 400, status: "Bad Request", body: err("Email already exists with another user") },
      ],
    }),
  ],
);

// =============================================================== 03 BRANDS
const brandsFolder = folder(
  "03 — Brands",
  "Naya customer endpoint, aur purana `/brands/get` customer ke liye band.",
  [
    req({
      name: "⭐ NEW — Customer brand profile",
      method: "GET",
      segments: ["brands", "customer", "get", "{{brand_id}}"],
      token: "customer_token",
      changed:
        "**Bilkul naya endpoint.** Pehle customer app `/brands/get?brandId=` use karti " +
        "thi, jo brand ka PAN, GSTIN, bank account aur subscription billing return " +
        "karta tha.\n\n" +
        "Ye sirf wahi banata hai jo profile screen render karti hai — to usme strip " +
        "karne layak sensitive field hai hi nahi.",
      description:
        "**Ek call me poori screen** — brand + features + visible showcase preview + " +
        "outlets. Backend chaar indexed queries **parallel** me chalata hai.\n\n" +
        "**Showcase preview hai, poora album nahi** — har section me pehle **6** media.\n" +
        "- `mediaCount` / `photoCount` / `videoCount` **poore** album ke counts hain\n" +
        "- `hasMoreMedia: true` → \"See all\" dikhayein\n" +
        "- `mediaPreviewLimit` cap batata hai — hardcode mat karein\n" +
        "- Poora album: `GET /showcase/get-brand-showcase/:brandId`\n\n" +
        "**Sirf `isVisible: true` albums aate hain.** Purana `/showcase/get-brand-showcase` " +
        "ye filter nahi karta, to wahan vendor ke chhupaye hue sections bhi aate hain.\n\n" +
        "**`isVerified` ab sahi hai** — `brand.isApproved` code me kahin set hi nahi hota " +
        "(hamesha `false`), to ye `SystemVerify.status` se derive hota hai.\n\n" +
        "Typical response **~4 KB**, max plan limits pe bhi ~20 KB.",
      examples: [
        {
          name: "200 — brand profile",
          code: 200,
          status: "OK",
          body: ok("Brand details fetched successfully", {
            _id: "{{brand_id}}",
            brandName: "cafe mocha",
            description: "artisanal coffee and continental bites",
            logo: "https://res.cloudinary.com/…/mocha-logo.jpg",
            coverImage: "https://res.cloudinary.com/…/mocha-cover.jpg",
            uniqueId: "#TB000078",
            followersCount: 1240,
            joinedDate: "2026-03-15T00:00:00.000Z",
            isVerified: true,
            category: { _id: "…", name: "food & beverages", image: "https://…/food.jpg" },
            subCategory: { _id: "…", name: "cafe", image: "https://…/cafe.jpg" },
            location: {
              _id: "…",
              addressLine1: "301, corporate tower",
              city: "indore",
              state: "madhya pradesh",
              country: "india",
              zipcode: "452001",
              formattedAddress: "301, corporate tower, indore, madhya pradesh, 452001, india",
              geo: { type: "Point", coordinates: [75.8577, 22.7196] },
            },
            workHours: {
              monday: { isOpen: true, start: "09:00", end: "23:00" },
              sunday: { isOpen: false, start: null, end: null },
            },
            features: [
              { _id: "…", title: "free wifi", description: "high speed internet", icon: "https://…/wifi.png" },
              { _id: "…", title: "pet friendly", description: "furry friends welcome", icon: "https://…/pet.png" },
            ],
            showcase: {
              totalSections: 2,
              mediaPreviewLimit: 6,
              sections: [
                {
                  _id: "68f1a2b3c4d5e6f7a8b9c5a1",
                  title: "ambience",
                  description: "our cozy interiors",
                  coverImage: "https://…/ambience-cover.jpg",
                  sectionType: SHOWCASE_SECTION_TYPE.CUSTOM,
                  sortOrder: 1,
                  mediaCount: 12,
                  photoCount: 9,
                  videoCount: 3,
                  hasMoreMedia: true,
                  medias: [
                    {
                      _id: "…",
                      type: "PHOTO",
                      url: "https://…/amb1.jpg",
                      thumbnail: null,
                      title: "seating area",
                      altText: "cafe seating with wooden tables",
                      sortOrder: 1,
                    },
                  ],
                },
              ],
            },
            outlets: [
              {
                _id: "68f1a2b3c4d5e6f7a8b9c4a1",
                storeId: "TS-87HD-48L3-PZYW",
                uniqueId: "#TS000201",
                description: "vijay nagar outlet",
                outletType: "OUTLET",
                location: { city: "indore", geo: { type: "Point", coordinates: [75.8951, 22.7548] } },
                workHours: { monday: { isOpen: true, start: "09:00", end: "23:00" } },
              },
            ],
          }),
        },
        { name: "400 — invalid brandId", code: 400, status: "Bad Request", body: err("Invalid brand ID") },
        { name: "404 — nahi mila / deleted / inactive", code: 404, status: "Not Found", body: err("Brand not found") },
        {
          name: "403 — customer token nahi hai",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action."),
        },
      ],
    }),

    req({
      name: "Get brand (vendor/admin)",
      method: "GET",
      segments: ["brands", "get"],
      token: "vendor_token",
      query: [{ key: "brandId", value: "{{brand_id}}", disabled: true, description: "Admin ke liye required; vendor ke liye optional" }],
      changed:
        "**Ab `isVendorOrAdmin`** — customer ke liye band. Wo PAN/GSTIN/bank/subscription " +
        "expose karta tha.\n\n" +
        "⚠️ **Response field names singular hain, arrays nahi** — `pan` (not `pans`), " +
        "`firstSubBrand` (not `subbrands`), `systemVerify`, `category`, `subCategory`. " +
        "`buildAggregateLookup` unwind karta hai. Pehle docs me galat likha tha.",
      description:
        "Vendor ke liye ye \"my brand\" hai — `brandId` skip karein.\n\n" +
        "⚠️ `brand.status` aur `brand.isApproved` **kabhi set nahi hote** — approval ka " +
        "actual status `systemVerify.status` me hai.",
      examples: [
        {
          name: "200 — vendor apna brand",
          code: 200,
          status: "OK",
          body: ok("Brand details fetched successfully", {
            _id: "{{brand_id}}",
            brandName: "cafe mocha",
            uniqueId: "#TB000078",
            merchantId: "TM-XXXX-XXXX-XXXX",
            isSubscribed: true,
            subBrandsLimit: 10,
            subBrandsUsed: 3,
            user: { _id: "…", role: ROLES.VENDOR, name: "rahul sharma" },
            pan: { pan: "AABCM1234K", isVerified: true },
            gst: { gstNumber: "23AABCM1234K1ZP", isVerified: true },
            bank: { accountNumber: "912010012345678", ifscCode: "UTIB0001234" },
            systemVerify: { score: 94, status: "APPROVED" },
            subscribed: { status: "ACTIVE", endDate: "2026-09-22T00:00:00.000Z" },
            category: { name: "food & beverages" },
            subCategory: { name: "cafe" },
            location: { formattedAddress: "…", geo: {} },
            workHours: { monday: { isOpen: true, start: "09:00", end: "23:00" } },
            firstSubBrand: { _id: "…", storeId: "TS-87HD-48L3-PZYW" },
          }),
        },
        {
          name: "403 — customer token se (ab band)",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action."),
        },
      ],
    }),

    req({
      name: "Update brand",
      method: "PUT",
      segments: ["brands", "update"],
      token: "vendor_token",
      body: { brandName: "Cafe Mocha", description: "Artisanal coffee and continental bites" },
      changed: "`verifyJwtToken` → **`isVendorOrAdmin`**. Pehle koi bhi kisi ka brand edit kar sakta tha.",
      description: "Logo ke liye multipart me `logo` field bhejein.",
      examples: [
        {
          name: "200 — updated",
          code: 200,
          status: "OK",
          body: ok("Brand details updated successfully", { _id: "{{brand_id}}", brandName: "cafe mocha" }),
        },
      ],
    }),

    req({
      name: "Verification history",
      method: "GET",
      segments: ["brands", "verifications", "history"],
      token: "vendor_token",
      query: [{ key: "limit", value: "10" }],
      changed:
        "`verifyJwtToken` → **`isVendorOrAdmin`**, aur service me bhi har role explicitly " +
        "handle hota hai.\n\n" +
        "Pehle service ka `else` branch admin **aur customer dono** ko pakadta tha — " +
        "customer koi bhi `brandId` bhej kar us brand ki poori KYC history padh sakta tha.",
      description: "Vendor ke liye `brandId` ignore hota hai — hamesha apna brand.",
      examples: [
        {
          name: "200 — timeline",
          code: 200,
          status: "OK",
          body: ok("Brand verification history fetched successfully.", {
            total: 2,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [
              { _id: "…", action: "APPROVED", performedByType: "ADMIN", attemptNumber: 2, score: 94 },
              { _id: "…", action: "REJECTED", performedByType: "ADMIN", attemptNumber: 1, score: 68, rejectionReason: "Bank account holder name does not match the PAN" },
            ],
          }),
        },
        { name: "403 — customer (ab band)", code: 403, status: "Forbidden", body: err("Forbidden: You do not have permission to perform this action.") },
      ],
    }),
  ],
);

// =============================================================== 04 SHOWCASE
const showcaseFolder = folder(
  "04 — Showcase (scoping + ownership)",
  "Poora module pehle bare `verifyJwtToken` pe tha, aur services `userId` lete the par " +
    "**use hi nahi karte the** — matlab koi bhi signed-in caller kisi bhi brand ka gallery " +
    "edit ya delete kar sakta tha, sirf id se.\n\n" +
    "Ab har request pe ownership resolve hoti hai: `sectionId` wale endpoints pe " +
    "`resolveSectionForActor`, `brandId` wale pe `resolveActorBrand`.",
  [
    req({
      name: "List sections — vendor (apna brand)",
      method: "GET",
      segments: ["showcase", "section", "get-all"],
      token: "vendor_token",
      query: [
        { key: "limit", value: "50" },
        { key: "brandId", value: "{{brand_id}}", disabled: true, description: "Vendor: sirf apna. Admin: narrowing filter" },
      ],
      changed:
        "**Brand scoping wapas aa gayi** — pehle filter commented out tha, to vendor ko " +
        "**platform ke saare brands ke sections** milte the.\n\n" +
        "`brandId` query ab support hoti hai (pehle validator use strip kar deta tha).",
      description:
        "- **Vendor** apne brand tak pinned — dusre ka `brandId` bheje to `403`\n" +
        "- **Admin global rehta hai** — `brandId` na do to sab brands, do to narrow\n\n" +
        "`{brandId, isActive}` index already tha, to ye pehle se **tez** bhi hai.",
      examples: [
        {
          name: "200 — vendor ke apne sections",
          code: 200,
          status: "OK",
          body: ok("Showcase sections fetched successfully.", {
            total: 2,
            totalPages: 1,
            page: 1,
            limit: 50,
            data: [
              { _id: "…", title: "ambience", sectionType: SHOWCASE_SECTION_TYPE.CUSTOM, sortOrder: 1, mediaCount: 12, photoCount: 9, videoCount: 3 },
            ],
          }),
        },
        {
          name: "403 — vendor ne dusre brand ka brandId bheja",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action on this brand."),
        },
        { name: "404 — koi section nahi (empty state)", code: 404, status: "Not Found", body: err("No any showcasesection found") },
      ],
    }),

    req({
      name: "List sections — admin (global)",
      method: "GET",
      segments: ["showcase", "section", "get-all"],
      token: "admin_token",
      query: [{ key: "limit", value: "50" }],
      changed: "Admin ke liye behaviour **wahi** — `brandId` na do to platform-wide.",
      description: "`brandId` add karke kisi ek brand pe narrow kar sakte hain.",
      examples: [
        {
          name: "200 — saare brands ke sections",
          code: 200,
          status: "OK",
          body: ok("Showcase sections fetched successfully.", { total: 47, totalPages: 1, page: 1, limit: 50, data: [] }),
        },
      ],
    }),

    req({
      name: "Create section",
      method: "POST",
      segments: ["showcase", "section", "add"],
      token: "vendor_token",
      body: { title: "ambience", description: "Our cozy interiors", sectionType: SHOWCASE_SECTION_TYPE.CUSTOM },
      changed:
        "`validateBrandVendor(userId)` → **`resolveActorBrand`**, to ab admin bhi kisi " +
        "brand ke liye bana sakta hai (`brandId` body me bhejkar). Route pe `isVendorOrAdmin`.",
      description:
        `\`sectionType\`: ${list(SHOWCASE_SECTION_TYPE)}\n\n` +
        "Vendor `brandId` skip kare — token se resolve hota hai. **Admin ko dena zaruri hai.**\n\n" +
        "⚠️ Ye subscription-gated hai aur plan ka `showcase` slot kharchta hai.",
      examples: [
        {
          name: "201 — created",
          code: 201,
          status: "Created",
          body: ok("Showcase section created successfully.", { _id: "…", title: "ambience", slug: "ambience", sortOrder: 1 }),
        },
        { name: "409 — same title", code: 409, status: "Conflict", body: err("Section title already exists.") },
        { name: "422 — admin ne brandId nahi diya", code: 422, status: "Unprocessable Entity", body: err("brandId is required when acting as an admin") },
        {
          name: "403 — plan me showcase nahi",
          code: 403,
          status: "Forbidden",
          body: err("Your current plan does not include showcase sections. Please upgrade your subscription to add showcase sections."),
        },
      ],
    }),

    req({
      name: "Update section (ownership check)",
      method: "PUT",
      segments: ["showcase", "section", "update", "{{section_id}}"],
      token: "vendor_token",
      body: { description: "Our cozy interiors and seating" },
      changed:
        "**Ownership ab verify hoti hai.** Pehle service `sectionId` leke seedha edit kar " +
        "deti thi — koi bhi vendor kisi ka bhi section badal sakta tha.",
      description:
        "Ownership `Brand.userId` se check hoti hai, token ke cached `brandId` se nahi — " +
        "to stale token se access nahi milta.",
      examples: [
        { name: "200 — updated", code: 200, status: "OK", body: ok("Section updated successfully.", { _id: "{{section_id}}", description: "our cozy interiors and seating" }) },
        {
          name: "403 — dusre vendor ka section",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action on this showcase."),
        },
        { name: "404 — section nahi mila", code: 404, status: "Not Found", body: err("Showcase section not found.") },
      ],
    }),

    req({
      name: "Reorder sections",
      method: "PUT",
      segments: ["showcase", "section", "{{brand_id}}", "reorder"],
      token: "vendor_token",
      body: { sections: [{ sectionId: "{{section_id}}", sortOrder: 1 }] },
      changed:
        "`brandId` ab **actor se resolve** hota hai — pehle jo path me aata tha wahi use " +
        "ho jaata tha, to vendor kisi aur ka showcase reorder kar sakta tha.",
      examples: [
        { name: "200 — reordered", code: 200, status: "OK", body: ok("Sections reordered successfully.", {}) },
        { name: "403 — dusre brand ka", code: 403, status: "Forbidden", body: err("Forbidden: You do not have permission to perform this action on this brand.") },
      ],
    }),

    req({
      name: "Customer — brand showcase (full)",
      method: "GET",
      segments: ["showcase", "get-brand-showcase", "{{brand_id}}"],
      token: "customer_token",
      changed: "Ab **`isCustomer`** gate (pehle koi bhi authenticated).",
      description:
        "Poora album — jab customer profile ke preview se \"See all\" dabaye.\n\n" +
        "⚠️ Ye endpoint **`isVisible` filter nahi karta** — vendor ke chhupaye hue " +
        "sections bhi aate hain. Naya `/brands/customer/get/:brandId` karta hai.",
      examples: [
        {
          name: "200 — sections + media",
          code: 200,
          status: "OK",
          body: ok("Showcase fetched successfully.", {
            brandId: "{{brand_id}}",
            sections: [{ _id: "…", title: "ambience", mediaCount: 12, photoCount: 9, videoCount: 3, medias: [] }],
          }),
        },
      ],
    }),
  ],
);

// =============================================================== 05 LOCATIONS
const locationsFolder = folder(
  "05 — Locations",
  "Poora module bare `verifyJwtToken` pe tha — `GET /getAll` platform ke **saare** " +
    "addresses de deta tha, customers ke ghar ke pate included.",
  [
    req({
      name: "Customer — upsert my address",
      method: "POST",
      segments: ["locations", "upsert"],
      token: "customer_token",
      body: {
        addressLine1: "12, Sunrise Apartments",
        addressLine2: "Vijay Nagar",
        landmark: "Near C21 Mall",
        city: "Indore",
        district: "Indore",
        state: "Madhya Pradesh",
        zipcode: "452010",
        country: "india",
        coordinates: [75.8937, 22.7533],
        addressType: ADDRESS_TYPES.HOME,
        isDefault: true,
      },
      changed:
        "- Gate ab **`isCustomer`**\n" +
        "- **`userId` body se hata diya** — pehle usse dusre customer ka address " +
        "overwrite ho jaata tha (role check *target* pe hota tha, caller pe nahi)\n" +
        "- `isBrandAddress` / `isSubBrandAddress` bhi hata diye — customer address " +
        "kabhi brand address nahi hota\n" +
        "- **`country` ab sach me optional hai** — pehle usko omit karne pe har zipcode " +
        "`Invalid Zip Code/Postal Code` de deta tha (validator default lagne se pehle chalta tha)",
      description:
        `\`addressType\`: ${list(ADDRESS_TYPES)}\n\n` +
        "⚠️ **`coordinates` ka order `[longitude, latitude]` hai** — GeoJSON standard, " +
        "maps APIs se ulta. Indore = `[75.8937, 22.7533]`.\n\n" +
        "Ek customer = ek location. Dobara call karne pe update hota hai.",
      examples: [
        {
          name: "201 — saved",
          code: 201,
          status: "Created",
          body: ok("Location upserted successfully", {
            _id: "68f1a2b3c4d5e6f7a8b9c4b1",
            city: "indore",
            state: "madhya pradesh",
            zipcode: "452010",
            formattedAddress: "12, sunrise apartments, vijay nagar, near c21 mall, indore, indore, madhya pradesh, 452010, india",
            geo: { type: "Point", coordinates: [75.8937, 22.7533] },
            addressType: ADDRESS_TYPES.HOME,
            isDefault: true,
          }),
        },
        { name: "422 — coordinates ulte", code: 422, status: "Unprocessable Entity", body: err("Invalid longitude/latitude.") },
        { name: "403 — vendor/admin token se", code: 403, status: "Forbidden", body: err("Forbidden: You do not have permission to perform this action.") },
      ],
    }),

    req({
      name: "Get location by id (ownership)",
      method: "GET",
      segments: ["locations", "get", "{{location_id}}"],
      token: "customer_token",
      changed:
        "**Per-role ownership check add hua.** Pehle koi bhi valid id se kisi ka bhi " +
        "address padh sakta tha — dusre customers ke ghar ke pate aur coordinates sab.",
      description:
        "- **Customer** sirf apni location\n" +
        "- **Vendor** apne brand ki aur apne outlets ki (`SubBrand` se verify hota hai, " +
        "token ke `brandId` se nahi)\n" +
        "- **Admin** sab",
      examples: [
        { name: "200 — apni location", code: 200, status: "OK", body: ok("Location fetched successfully", { _id: "{{location_id}}", city: "indore", geo: { type: "Point", coordinates: [75.8937, 22.7533] } }) },
        { name: "403 — kisi aur ki", code: 403, status: "Forbidden", body: err("Forbidden") },
        { name: "404 — nahi mili", code: 404, status: "Not Found", body: err("Location not found") },
      ],
    }),

    req({
      name: "List locations (vendor/admin)",
      method: "GET",
      segments: ["locations", "getAll"],
      token: "vendor_token",
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "isSubBrandAddress", value: "true", disabled: true },
      ],
      changed: "Gate ab **`isVendorOrAdmin`** (pehle koi bhi authenticated).",
      description:
        "⚠️ Ye endpoint khud scope nahi karta — jo `brandId` query me aata hai wahi filter " +
        "hota hai. **Vendor panel ko hamesha `brandId` bhejna chahiye**, warna platform ke " +
        "saare addresses aa jayenge.",
      examples: [
        { name: "200 — brand ke addresses", code: 200, status: "OK", body: ok("Locations fetched successfully", { total: 4, totalPages: 1, page: 1, limit: 10, data: [] }) },
        { name: "404 — empty state", code: 404, status: "Not Found", body: err("No any location found") },
      ],
    }),

    req({
      name: "Create location (brand/outlet)",
      method: "POST",
      segments: ["locations", "create"],
      token: "vendor_token",
      body: {
        subBrandId: "{{sub_brand_id}}",
        isSubBrandAddress: true,
        addressLine1: "Shop 4, Scheme 54",
        city: "Indore",
        state: "Madhya Pradesh",
        zipcode: "452010",
        coordinates: [75.8951, 22.7548],
        addressType: ADDRESS_TYPES.WORK,
      },
      changed: "Gate ab **`isVendorOrAdmin`**. Plus `country` optional wala zipcode fix.",
      description:
        "⚠️ Outlet ka geo customer voucher listing ke liye **critical** hai — bina " +
        "location wale outlets ke vouchers customer ko kabhi nahi dikhenge.",
      examples: [
        { name: "200 — created", code: 200, status: "OK", body: ok("Location created successfully", { _id: "…", isSubBrandAddress: true, geo: { type: "Point", coordinates: [75.8951, 22.7548] } }) },
        { name: "400 — dono flags true", code: 400, status: "Bad Request", body: err("Location cannot be both Brand address and SubBrand address") },
      ],
    }),
  ],
);

// =============================================================== 06 ROLE GATES
const gatesFolder = folder(
  "06 — Naye role gates",
  "Ye endpoints pehle bare `verifyJwtToken` pe the — customer ke token se app ke banners " +
    "ban jaate the, kisi bhi brand ke features edit ho jaate the, aur saare outlets/draft " +
    "vouchers padhe ja sakte the.\n\n" +
    "**143 me se 143 endpoints ab gated hain.**",
  [
    req({
      name: "Banners — create (isAdmin)",
      method: "POST",
      segments: ["banners", "create"],
      token: "admin_token",
      changed: "`verifyJwtToken` → **`isAdmin`**. Pehle customer bhi app ka home banner bana sakta tha.",
      description:
        "Multipart request — `type` ke hisaab se file field:\n" +
        "`IMAGE` → `image` · `VIDEO` → `video` · `GIF` → `gif`\n\n" +
        "Text fields: `title`, `description`, `type`, `redirect[type]`, `redirect[targetId]`, " +
        "`redirect[url]`, `startDate`, `endDate`, `isActive`",
      examples: [
        { name: "201 — created", code: 201, status: "Created", body: ok("Banner created successfully", { _id: "…", title: "monsoon mega sale", type: "IMAGE" }) },
        { name: "403 — customer/vendor se", code: 403, status: "Forbidden", body: err("Forbidden: You do not have permission to perform this action.") },
      ],
    }),

    req({
      name: "Banners — customer active (isCustomer)",
      method: "GET",
      segments: ["banners", "customer", "active"],
      token: "customer_token",
      changed: "Ab **`isCustomer`** gate.",
      description: "Ek hi banner aata hai (ya `null`) — 404 nahi.",
      examples: [
        { name: "200 — active banner", code: 200, status: "OK", body: ok("Active banner fetched successfully.", { _id: "…", title: "monsoon mega sale", type: "IMAGE", image: { url: "https://…/monsoon.jpg" }, redirect: { type: "CATEGORY", targetId: "…", url: null } }) },
        { name: "200 — koi nahi", code: 200, status: "OK", body: ok("No active banner found.", null) },
      ],
    }),

    req({
      name: "Tickers — customer active (isCustomer)",
      method: "GET",
      segments: ["promotionalTickers", "customer", "active"],
      token: "customer_token",
      changed: "Ab **`isCustomer`**. CRUD (5 endpoints) ab **`isAdmin`**.",
      description: "`displayOrder` ascending. Empty pe `[]` — 404 nahi.",
      examples: [
        { name: "200 — tickers", code: 200, status: "OK", body: ok("Active promotional tickers fetched successfully.", [{ _id: "…", title: "flat 30% off on cafes today", displayOrder: 1, icon: { url: "https://…/coffee.png" } }]) },
      ],
    }),

    req({
      name: "Brand features — add (isVendorOrAdmin)",
      method: "POST",
      segments: ["brandFeatures", "add"],
      token: "vendor_token",
      changed: "`verifyJwtToken` → **`isVendorOrAdmin`**. `brandId` body me aata hai, to pehle kuch bhi scope nahi karta tha.",
      description:
        "Multipart — `icon` file mandatory. Text: `brandId`, `title`, `description`, `isActive`.\n\n" +
        "Max **10 active** features per brand.\n\n" +
        "Reads (`get-all`, `get/:featureId`) `verifyJwtToken` pe hi hain — customer ko brand page pe chahiye.",
      examples: [
        { name: "200 — added", code: 200, status: "OK", body: ok("Brand feature added successfully", { _id: "…", title: "free wifi", icon: "https://…/wifi.png" }) },
        { name: "400 — 10 limit", code: 400, status: "Bad Request", body: err("A brand can have maximum 10 active features!") },
        { name: "403 — customer se", code: 403, status: "Forbidden", body: err("Forbidden: You do not have permission to perform this action.") },
      ],
    }),

    req({
      name: "Work hours — upsert (isVendorOrAdmin)",
      method: "POST",
      segments: ["workHours", "upsert"],
      token: "vendor_token",
      body: {
        subBrandId: "{{sub_brand_id}}",
        monday: { isOpen: true, start: "09:00", end: "23:00" },
        sunday: { isOpen: false },
      },
      changed: "`verifyJwtToken` → **`isVendorOrAdmin`**. Target body me aata hai, to koi bhi kisi ke outlet ke hours badal sakta tha.",
      description:
        "⚠️ **Response me din top-level keys hain** — koi `workingHours` wrapper nahi. " +
        "(Docs me pehle galat likha tha.)\n\n" +
        "`brandId` **ya** `subBrandId` — exactly ek. Time `HH:mm` 24-hour, aur `start < end`.\n\n" +
        "Partial update chalta hai — sirf jo din bhejein wahi badalte hain.",
      examples: [
        {
          name: "201 — upserted",
          code: 201,
          status: "Created",
          body: ok("WorkHours upserted successfully", {
            _id: "…",
            subBrandId: "{{sub_brand_id}}",
            brandId: null,
            monday: { isOpen: true, start: "09:00", end: "23:00" },
            sunday: { isOpen: false, start: null, end: null },
            isActive: true,
          }),
        },
        { name: "422 — dono ids", code: 422, status: "Unprocessable Entity", body: err("Provide either brandId or subBrandId, not both") },
        { name: "422 — start >= end", code: 422, status: "Unprocessable Entity", body: err("Start time must be earlier than end time") },
      ],
    }),

    req({
      name: "Outlets — list (isVendorOrAdmin)",
      method: "GET",
      segments: ["subBrands", "get-all"],
      token: "vendor_token",
      query: [{ key: "brandId", value: "{{brand_id}}" }, { key: "limit", value: "50" }],
      changed: "`verifyJwtToken` → **`isVendorOrAdmin`**. Pehle customer sabhi outlets ke number/email/storeId dekh sakta tha.",
      description: "⚠️ Ye khud scope nahi karta — **`brandId` bhejna zaruri hai**, warna platform ke saare outlets aayenge.",
      examples: [
        { name: "200 — outlets", code: 200, status: "OK", body: ok("Outlets/Sub-Brands fetched successfully", { total: 3, totalPages: 1, page: 1, limit: 50, data: [] }) },
        { name: "404 — empty state", code: 404, status: "Not Found", body: err("No any subbrand found") },
      ],
    }),

    req({
      name: "Voucher versions — list (isVendorOrAdmin)",
      method: "GET",
      segments: ["vouchers", "versions", "get-all"],
      token: "vendor_token",
      query: [{ key: "brandId", value: "{{brand_id}}" }, { key: "limit", value: "20" }],
      changed: "`verifyJwtToken` → **`isVendorOrAdmin`**. Pehle customer sabhi brands ke draft/unpublished vouchers dekh sakta tha.",
      examples: [
        { name: "200 — versions", code: 200, status: "OK", body: ok("Voucher versions fetched successfully", { total: 5, totalPages: 1, page: 1, limit: 20, data: [] }) },
      ],
    }),

    req({
      name: "Follows — toggle (isCustomer)",
      method: "POST",
      segments: ["follows", "toggle", "{{brand_id}}"],
      token: "customer_token",
      changed: "Route pe ab **`isCustomer`**. Service me check tha hi, par ab fail fast hota hai aur message clear milta hai.",
      description: "`brandAvoidances/toggle/:brandId` bhi bilkul same pattern pe hai.",
      examples: [
        { name: "200 — followed", code: 200, status: "OK", body: ok("Brand followed successfully.", { brandId: "{{brand_id}}", followed: true, followersCount: 1241 }) },
        { name: "200 — unfollowed", code: 200, status: "OK", body: ok("Brand unfollowed successfully.", { brandId: "{{brand_id}}", followed: false, followersCount: 1240 }) },
      ],
    }),
  ],
);

// =============================================================== 07 LEGAL
const legalFolder = folder(
  "07 — Legal (broken → fixed)",
  "**Dono create endpoints pehle har baar fail hote the** — `422 \"Path \\`type\\` is " +
    "required.\"` Model `type` mandatory maangta tha par wo validator me tha hi nahi, to " +
    "`stripUnknown` use hata deta tha aur service kabhi set nahi karti thi.\n\n" +
    "Update path me do aur bugs the.",
  [
    req({
      name: "Create Terms & Conditions",
      method: "POST",
      segments: ["terms-and-conditions", "create"],
      token: "admin_token",
      body: {
        title: "Vendor Terms Of Service",
        type: "VENDOR",
        description: "<h2>Terms</h2><p>By using the Trydood platform you agree to…</p>",
        isActive: true,
      },
      changed:
        "- **`type` ab validator me hai aur required** — pehle ye endpoint **kabhi kaam " +
        "hi nahi karta tha**\n" +
        "- **`description` cap 300 → 50000** (300 category description se copy-paste tha)\n" +
        "- **`description` ab lowercase nahi hota** — legal text ka case aur HTML preserve rehta hai",
      description:
        "`type` free-text audience marker hai (`\"VENDOR\"`, `\"CUSTOMER\"`) — client isi pe filter karta hai.\n\n" +
        "`title` lowercase ho jaata hai (duplicate check case-insensitive rakhne ke liye).",
      examples: [
        {
          name: "201 — created",
          code: 201,
          status: "Created",
          body: ok("Term and condition created", {
            _id: "…",
            title: "vendor terms of service",
            type: "VENDOR",
            description: "<h2>Terms</h2><p>By using the Trydood platform you agree to…</p>",
            isActive: true,
          }),
        },
        { name: "422 — type missing", code: 422, status: "Unprocessable Entity", body: err("Type is required") },
        { name: "400 — duplicate title", code: 400, status: "Bad Request", body: err("Term and condition already exist with this title") },
      ],
    }),

    req({
      name: "Update Terms & Conditions",
      method: "PUT",
      segments: ["terms-and-conditions", "update", "{{legal_id}}"],
      token: "admin_token",
      body: { isActive: false },
      changed:
        "Do bugs theek hue:\n\n" +
        "- **`isActive` toggle karta tha** — `isActive: true` bhejne pe already-active " +
        "document **band** ho jaata tha (`result.isActive = !result.isActive`)\n" +
        "- **Title change pe crash** — `result.findOne(...)` document pe call ho raha tha, " +
        "model pe nahi → `result.findOne is not a function`\n\n" +
        "Plus `type` ab updatable hai, aur `description` lowercase nahi hota.",
      description: "Kam se kam ek field bhejna zaruri hai.",
      examples: [
        { name: "200 — deactivated", code: 200, status: "OK", body: ok("Term and condition updated", { _id: "{{legal_id}}", isActive: false }) },
        { name: "200 — title change (pehle crash hota tha)", code: 200, status: "OK", body: ok("Term and condition updated", { _id: "{{legal_id}}", title: "vendor terms v2" }) },
        { name: "422 — khaali body", code: 422, status: "Unprocessable Entity", body: err("Please provide at least one field to update.") },
      ],
    }),

    req({
      name: "Create Privacy Policy",
      method: "POST",
      segments: ["privacy-and-policies", "create"],
      token: "admin_token",
      body: {
        title: "Privacy Policy",
        type: "CUSTOMER",
        description: "<h2>Privacy</h2><p>We collect the following information…</p>",
        isActive: true,
      },
      changed: "Terms jaisa hi — `type` required, cap 50000, description lowercase nahi hota.",
      examples: [
        { name: "201 — created", code: 201, status: "Created", body: ok("Privacy and policy created", { _id: "…", title: "privacy policy", type: "CUSTOMER" }) },
        { name: "422 — type missing", code: 422, status: "Unprocessable Entity", body: err("Type is required") },
      ],
    }),
  ],
);

// =============================================================== 08 VOUCHERS
const vouchersFolder = folder(
  "08 — Vouchers (FIXED discount)",
  `\`${VOUCHER_DISCOUNT_TYPES.FIXED}\` enum me tha aur validation pass karta tha, par ` +
    "calculation use handle hi nahi karta tha — aisa offer `discountAmount: 0` deta tha " +
    "aur eligible list se filter ho jaata tha. Customer ko *\"No eligible offer found for " +
    "this bill amount\"* dikhta tha, jaise uske bill ki galti ho.\n\n" +
    `Ab wo \`${VOUCHER_DISCOUNT_TYPES.FLAT}\` ka alias hai — dono ka matlab same hai.`,
  [
    req({
      name: "Customer — voucher discount preview",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: "customer_token",
      body: { voucherId: "{{voucher_id}}", outletId: "{{sub_brand_id}}", billAmount: 1000 },
      changed:
        `**\`${VOUCHER_DISCOUNT_TYPES.FIXED}\` offers ab calculate hote hain.** Pehle wo ` +
        "chup-chaap drop ho jaate the.",
      description:
        `\`discountType\`: ${list(VOUCHER_DISCOUNT_TYPES)}\n\n` +
        "**Calculation:**\n" +
        `- \`${VOUCHER_DISCOUNT_TYPES.PERCENTAGE}\` → \`bill × value / 100\`, phir \`maxDiscountAmount\` pe cap\n` +
        `- \`${VOUCHER_DISCOUNT_TYPES.FLAT}\` / \`${VOUCHER_DISCOUNT_TYPES.FIXED}\` → seedha \`discountValue\`\n` +
        "- Dono ke baad `min(discount, billAmount)`\n\n" +
        "`selectedOffer` = sabse zyada discount. Tie pe zyada `minBillAmount` wala jeeta.",
      examples: [
        {
          name: "200 — FIXED offer ab apply hota hai",
          code: 200,
          status: "OK",
          body: ok("Voucher preview calculated successfully.", {
            voucher: { id: "{{voucher_id}}", name: "flat 200 off" },
            version: { id: "…", versionNumber: 3 },
            outlet: { id: "{{sub_brand_id}}", storeId: "TS-87HD-48L3-PZYW" },
            billAmount: 1000,
            selectedOffer: {
              offerId: "…",
              title: "flat 200 off above 500",
              discountType: VOUCHER_DISCOUNT_TYPES.FIXED,
              discountValue: 200,
              minBillAmount: 500,
              maxDiscountAmount: null,
              discountAmount: 200,
              finalAmount: 800,
            },
            eligibleOffers: [],
          }),
        },
        { name: "400 — outlet linked nahi", code: 400, status: "Bad Request", body: err("Selected outlet is not linked with this voucher.") },
      ],
    }),
  ],
);

// =============================================================== 09 PRICING
//
// Slab table is derived from the real defaults, so it cannot drift from
// constants/customer.js. Note these are only fallbacks — the live numbers come
// from Setting.customer.convenienceFee.
const { slabSize, feePerSlab } = CONVENIENCE_FEE_DEFAULTS;
const feeFor = (bill) => Math.ceil(bill / slabSize) * feePerSlab;
const FEE_TABLE = [1, 2, 3, 4]
  .map((n) => {
    const from = (n - 1) * slabSize + 1;
    const to = n * slabSize;
    return `| ₹${from} – ₹${to} | ₹${feeFor(to)} |`;
  })
  .join("\n");

const pricingFolder = folder(
  "09 — Pricing (convenience fee + no-offer fallback)",
  "Do changes jo saath chalte hain — dono `previewCustomerVoucher` pe.\n\n" +
    "### 1. Convenience fee\n\n" +
    `Har **₹${slabSize}** (ya uska part) pe **₹${feePerSlab}**:\n\n` +
    "| Bill | Fee |\n|---|---:|\n" +
    FEE_TABLE +
    `\n| … har agle ₹${slabSize} pe | +₹${feePerSlab} |\n\n` +
    `Formula: \`ceil(bill / ${slabSize}) × ${feePerSlab}\`\n\n` +
    "Fee **original bill** pe lagti hai, discount ke baad wale amount pe nahi — warna " +
    "har offer ke saath fee badalti aur customer ko arbitrary lagti.\n\n" +
    "⚠️ Ye numbers **defaults** hain. Live values `Setting.customer.convenienceFee` se " +
    "aati hain — admin slab size, per-slab amount badal sakta hai ya fee band kar sakta hai. " +
    "**Client ko fee calculate nahi karni — `pricing.convenienceFee` use karein.**\n\n" +
    "### 2. Koi offer valid na ho to error nahi\n\n" +
    "Pehle bill kisi bhi offer ke `minBillAmount` se kam hone pe `400 \"No eligible offer " +
    "found for this bill amount.\"` aata tha — customer ko lagta tha uska bill galat hai. " +
    "Ab `200` + `offerApplied: false`, aur wo sirf apna bill pay karta hai: koi offer, " +
    "koi promo, **koi convenience fee nahi**.",
  [
    req({
      name: "Preview — offer applies (fee lagti hai)",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: "customer_token",
      body: { voucherId: "{{voucher_id}}", outletId: "{{sub_brand_id}}", billAmount: 1200 },
      changed:
        "Do naye fields:\n\n" +
        "- **`offerApplied`** — boolean. `false` pe client offer section chhupa de.\n" +
        "- **`pricing`** — checkout ki saari rows, already totalled. Client ko koi " +
        "arithmetic nahi karni.",
      description:
        "`pricing.payableAmount` = `billAmount − discountAmount + convenienceFee`. " +
        "**Yahi charge karna hai.**\n\n" +
        "`pricing.promoDiscount` abhi hamesha `0` hai — customer-side promo codes wire " +
        "nahi hue (`PromoCode` sirf vendor subscription checkout serve karta hai). Row " +
        "isliye rakhi hai ki jab aayein to response shape na badle.",
      examples: [
        {
          name: "200 — bill ₹1200, 30% off (cap ₹300)",
          code: 200,
          status: "OK",
          body: ok("Voucher preview calculated successfully.", {
            voucher: { id: "{{voucher_id}}", name: "flat 30% off on total bill" },
            version: { id: "…", versionNumber: 3 },
            outlet: { id: "{{sub_brand_id}}", storeId: "TS-87HD-48L3-PZYW" },
            billAmount: 1200,
            offerApplied: true,
            selectedOffer: {
              offerId: "…",
              title: "30% off above 500",
              discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
              discountValue: 30,
              minBillAmount: 500,
              maxDiscountAmount: 300,
              discountAmount: 300,
              finalAmount: 900,
            },
            eligibleOffers: ["… same shape, best-first"],
            pricing: {
              billAmount: 1200,
              discountAmount: 300,
              promoDiscount: 0,
              convenienceFee: feeFor(1200),
              payableAmount: 1200 - 300 + feeFor(1200),
              totalSavings: 300,
            },
          }),
        },
      ],
    }),

    req({
      name: "Preview — bill offer minimum se kam (ab 200, error nahi)",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: "customer_token",
      body: { voucherId: "{{voucher_id}}", outletId: "{{sub_brand_id}}", billAmount: 300 },
      changed:
        "**Ye pehle `400` deta tha.** Ab `200` + `offerApplied: false` — customer sirf " +
        "apna bill pay karega.",
      description:
        "Do case me aisa hota hai:\n\n" +
        "1. Bill har offer ke `minBillAmount` se kam hai\n" +
        "2. Voucher version me koi offer hai hi nahi\n\n" +
        "Dono ka jawab same hai — **fee bhi `0`**.\n\n" +
        "Client ka kaam: `offerApplied === false` pe offer section chhupa dein aur seedha " +
        "`pricing.payableAmount` dikhayein.",
      examples: [
        {
          name: "200 — koi offer nahi, plain bill",
          code: 200,
          status: "OK",
          body: ok("Voucher preview calculated successfully.", {
            voucher: { id: "{{voucher_id}}", name: "flat 30% off on total bill" },
            version: { id: "…", versionNumber: 3 },
            outlet: { id: "{{sub_brand_id}}", storeId: "TS-87HD-48L3-PZYW" },
            billAmount: 300,
            offerApplied: false,
            selectedOffer: null,
            eligibleOffers: [],
            pricing: {
              billAmount: 300,
              discountAmount: 0,
              promoDiscount: 0,
              convenienceFee: 0,
              payableAmount: 300,
              totalSavings: 0,
            },
          }),
        },
        {
          // Was pinned at 400 here and at 422 in the customer collection — the two
          // committed collections contradicted each other. Settled by reading the
          // code rather than by picking one: `validateCustomerVoucherPreview`
          // declares `billAmount` as `.positive()`, and `validateSchema` runs
          // BEFORE the controller. Joi answers first, and Joi answers 422.
          //
          // `calculateVoucherOffer`'s own `throwError(400, "Valid bill amount is
          // required.")` is therefore unreachable through the API. It stays as a
          // guard for direct callers, but no client will ever see it.
          name: "422 — bill ≤ 0 (Joi answers before the service)",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Bill amount must be greater than zero."),
        },
      ],
    }),
  ],
);

// =============================================================== 10 CURATION
const CURATION_NOTE =
  "**Ek hi endpoint add aur remove dono karta hai** — flag `false` bhejna hi remove hai " +
  "(jaise `subBrands/update` me `isActive`). Already pinned entry pe naya order bhejna " +
  "reorder hai.\n\n" +
  "Stamp (`…At` / `…By`) sirf **pehli** baar pin karne pe likha jaata hai — reorder karne " +
  "se ye nahi badalta, to record rehta hai ki pehle kisne chuna tha.";

const curationFolder = folder(
  "10 — Admin curation (suggestions + top brands)",
  "Admin do curated lists chalata hai: vouchers ki **Suggestions** aur brands ki " +
    "**Top Brands**. Dono ka pattern bilkul same hai.\n\n" +
    "### Storage\n\n" +
    "Join table nahi, **model pe flag** (`isSuggested` / `isTopBrand` + order + audit " +
    "stamps). Isse customer listing seedha us flag pe sort karti hai — har page pe ek " +
    "extra lookup ka kharcha nahi padta.\n\n" +
    "### Stale entries apne aap chhup jaati hain\n\n" +
    "Customer list already sirf `PUBLISHED` + valid-date vouchers aur `isActive` brands " +
    "dikhati hai. To pinned voucher expire ho jaaye ya brand deactivate ho jaaye, wo " +
    "customer ko dikhna band ho jaata hai — **admin ko manually hataana nahi padta**.\n\n" +
    "⚠️ Lekin **admin ke apne view me wo dikhte hain** — warna list se gayab ho jaate aur " +
    "flag DB me pinned hi reh jaata, jise unpin karna namumkin ho jaata.",
  [
    req({
      name: "Admin — voucher ko suggestions me daalo",
      method: "PUT",
      segments: ["vouchers", "admin", "suggestions", "{{voucher_id}}"],
      token: "admin_token",
      body: { isSuggested: true, suggestionOrder: 1 },
      changed: "Naya endpoint.",
      description:
        CURATION_NOTE +
        "\n\n**Body:**\n\n" +
        "| Field | Type | Required | Notes |\n|---|---|---|---|\n" +
        "| `isSuggested` | boolean | ✅ | `false` = remove |\n" +
        "| `suggestionOrder` | number | ❌ | Integer ≥ 0. Chhota pehle. Sirf pin karte waqt matlab rakhta hai |",
      examples: [
        {
          name: "200 — pin ho gaya",
          code: 200,
          status: "OK",
          body: ok("Voucher added to suggestions successfully.", {
            _id: "{{voucher_id}}",
            isSuggested: true,
            suggestionOrder: 1,
            suggestedAt: "2026-08-26T10:12:00.000Z",
            name: "flat 30% off on total bill",
            voucherCode: "VCH-10000001",
            status: "PUBLISHED",
          }),
        },
        {
          name: "404 — voucher nahi mila",
          code: 404,
          status: "Not Found",
          body: err("Voucher not found."),
        },
        {
          name: "403 — vendor token se",
          code: 403,
          status: "Forbidden",
          body: err("Forbidden: You do not have permission to perform this action."),
        },
      ],
    }),

    req({
      name: "Admin — voucher ko suggestions se hatao",
      method: "PUT",
      segments: ["vouchers", "admin", "suggestions", "{{voucher_id}}"],
      token: "admin_token",
      body: { isSuggested: false },
      changed: "Naya endpoint — upar wale ka hi doosra rukh.",
      description:
        "Remove karne pe `suggestionOrder` `0` ho jaata hai aur stamps **clear** ho jaate " +
        "hain — taaki agli baar pin karne pe fresh stamp bane, purana inherit na ho.",
      examples: [
        {
          name: "200 — hat gaya",
          code: 200,
          status: "OK",
          body: ok("Voucher removed from suggestions successfully.", {
            _id: "{{voucher_id}}",
            isSuggested: false,
            suggestionOrder: 0,
            suggestedAt: null,
            name: "flat 30% off on total bill",
            voucherCode: "VCH-10000001",
            status: "PUBLISHED",
          }),
        },
      ],
    }),

    req({
      name: "Admin — suggested vouchers list",
      method: "GET",
      segments: ["vouchers", "admin", "suggestions"],
      token: "admin_token",
      query: [{ key: "page", value: "1" }, { key: "limit", value: "10" }],
      changed: "Naya endpoint.",
      description:
        "**Ye customer wali list nahi hai.** Customer pipeline expire/unpublished vouchers " +
        "chhupa deti hai — jo app ke liye sahi hai, par admin screen pe wo pin gayab ho " +
        "jaata jise wo hataana chahta hai.\n\n" +
        "Isliye yahan **sab** pinned vouchers aate hain. Har row pe `status` batata hai " +
        "kaunsa abhi live hai.\n\n" +
        "`banner` object flatten hoke `bannerType` + `bannerUrl` ban jaata hai — wahi shape " +
        "jo customer list me hai.",
      examples: [
        {
          name: "200 — list",
          code: 200,
          status: "OK",
          body: ok("Suggested vouchers fetched successfully.", {
            total: 2,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [
              {
                _id: "{{voucher_id}}",
                name: "flat 30% off on total bill",
                voucherCode: "VCH-10000001",
                status: "PUBLISHED",
                isActive: true,
                suggestionOrder: 1,
                suggestedAt: "2026-08-26T10:12:00.000Z",
                bannerType: VOUCHER_BANNER_TYPE.IMAGE,
                bannerUrl: "https://res.cloudinary.com/…/banner.jpg",
                brand: { _id: "{{brand_id}}", brandName: "cafe mocha", uniqueId: "TDB000078" },
                suggestedByUser: { _id: "{{admin_user_id}}", name: "super admin" },
              },
              {
                _id: "…",
                name: "buy 1 get 1",
                voucherCode: "VCH-10000007",
                status: "EXPIRED",
                isActive: true,
                suggestionOrder: 2,
                suggestedAt: "2026-08-20T09:00:00.000Z",
                bannerType: null,
                bannerUrl: null,
                brand: { _id: "…", brandName: "pizza point", uniqueId: "TDB000091" },
                suggestedByUser: { _id: "{{admin_user_id}}", name: "super admin" },
              },
            ],
          }),
        },
        {
          name: "404 — koi pin nahi (empty state)",
          code: 404,
          status: "Not Found",
          body: err("No any voucher found"),
        },
      ],
    }),

    req({
      name: "Admin — brand ko top brands me daalo",
      method: "PUT",
      segments: ["brands", "admin", "top-brands", "{{brand_id}}"],
      token: "admin_token",
      body: { isTopBrand: true, topOrder: 1 },
      changed: "Naya endpoint.",
      description:
        CURATION_NOTE +
        "\n\n**Body:**\n\n" +
        "| Field | Type | Required | Notes |\n|---|---|---|---|\n" +
        "| `isTopBrand` | boolean | ✅ | `false` = remove |\n" +
        "| `topOrder` | number | ❌ | Integer ≥ 0. Chhota pehle |\n\n" +
        "Deactivated brand bhi pin ho sakta hai — wo customer tab me nahi dikhega, par " +
        "admin ke view me rahega.",
      examples: [
        {
          name: "200 — pin ho gaya",
          code: 200,
          status: "OK",
          body: ok("Brand added to top brands successfully.", {
            _id: "{{brand_id}}",
            isTopBrand: true,
            topOrder: 1,
            topAddedAt: "2026-08-26T10:14:00.000Z",
            brandName: "cafe mocha",
            uniqueId: "TDB000078",
            isActive: true,
          }),
        },
        { name: "404 — brand nahi mila", code: 404, status: "Not Found", body: err("Brand not found!") },
      ],
    }),

    req({
      name: "Admin — top brands list",
      method: "GET",
      segments: ["brands", "admin", "top-brands"],
      token: "admin_token",
      query: [{ key: "page", value: "1" }, { key: "limit", value: "10" }],
      changed: "Naya endpoint.",
      description:
        "Suggested-vouchers list ka mirror. Isme **deactivated brands bhi** aate hain " +
        "(`isActive: false`) — customer tab unhe chhupa deta hai, par admin ko unhe unpin " +
        "karne ke liye dikhna zaruri hai.",
      examples: [
        {
          name: "200 — list",
          code: 200,
          status: "OK",
          body: ok("Top brands fetched successfully.", {
            total: 1,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [
              {
                _id: "{{brand_id}}",
                brandName: "cafe mocha",
                uniqueId: "TDB000078",
                logo: "https://res.cloudinary.com/…/mocha-logo.jpg",
                followersCount: 1243,
                isActive: true,
                topOrder: 1,
                topAddedAt: "2026-08-26T10:14:00.000Z",
                category: { _id: "…", name: "food and beverages" },
                topAddedByUser: { _id: "{{admin_user_id}}", name: "super admin" },
              },
            ],
          }),
        },
      ],
    }),
  ],
);

// =============================================================== 11 CUSTOMER LISTS
const customerListsFolder = folder(
  "11 — Customer lists (tabs + banner fields)",
  "Curation ka customer-facing side, plus voucher banner fields.\n\n" +
    "### Tab aur \"view more\" ek hi endpoint se\n\n" +
    "| UI | Call |\n|---|---|\n" +
    "| Suggestions / Top Brands tab | `?suggestedOnly=true` / `?topOnly=true` |\n" +
    "| View more (poori list) | *param na bhejein* — pinned upar, phir baaki |\n\n" +
    "**Pagination apne aap sahi rehti hai.** Ye do lists jodkar nahi banti — ek hi sorted " +
    "result set hai jisme curated flag pehli sort key hai. Isliye pinned rows page 1 pe " +
    "upar aate hain aur page 2 pe **dobara nahi**. Client ko dedupe nahi karna padta.",
  [
    req({
      name: "Customer — vouchers (main feed, suggested upar)",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: "customer_token",
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "sortBy", value: VOUCHER_SORT_BY.DISTANCE },
        { key: "limit", value: "20" },
      ],
      changed:
        "Naye fields:\n\n" +
        `- **\`bannerType\`** — ${list(VOUCHER_BANNER_TYPE)}, ya \`null\`\n` +
        "- **`bannerUrl`** — banner ka URL, ya `null`\n" +
        "- **`isSuggested`** — admin ne pin kiya hai ya nahi\n" +
        "- **`isOutOfRange`** — top-level flag (rows ke andar nahi)\n\n" +
        "Naya param: **`suggestedOnly`**.",
      description:
        "`bannerType` aur `bannerUrl` hamesha **saath** chalte hain — banner ka type set " +
        "ho par media missing ho to **dono `null`** aate hain. Client ko `bannerUrl` ki " +
        "alag null-check nahi chahiye.\n\n" +
        "Key kabhi gayab nahi hoti — banner na ho to bhi `null` value ke saath aati hai.",
      examples: [
        {
          name: "200 — pinned voucher pehle",
          code: 200,
          status: "OK",
          body: ok("Vouchers fetched successfully.", {
            total: 34,
            totalPages: 2,
            page: 1,
            limit: 20,
            isOutOfRange: false,
            data: [
              {
                voucherId: "{{voucher_id}}",
                name: "flat 30% off on total bill",
                bannerType: VOUCHER_BANNER_TYPE.IMAGE,
                bannerUrl: "https://res.cloudinary.com/…/banner.jpg",
                isSuggested: true,
                brand: { id: "{{brand_id}}", brandName: "cafe mocha", isVerified: true },
                nearestOutlet: { distance: { meters: 420, kilometers: 0.42, display: "420 m" } },
                outletCount: 4,
                offerCount: 3,
                isContainsAd: false,
                isFavorite: false,
              },
              {
                voucherId: "…",
                name: "buy 1 get 1 on coffee",
                bannerType: null,
                bannerUrl: null,
                isSuggested: false,
                brand: { id: "…", brandName: "brew room", isVerified: false },
                nearestOutlet: { distance: { meters: 1800, kilometers: 1.8, display: "1.8 km" } },
                outletCount: 1,
                offerCount: 1,
                isContainsAd: false,
                isFavorite: false,
              },
            ],
          }),
        },
      ],
    }),

    req({
      name: "Customer — Suggestions tab",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: "customer_token",
      query: [
        { key: "suggestedOnly", value: "true" },
        { key: "limit", value: "10" },
      ],
      changed: "Naya param `suggestedOnly`, aur naya top-level `isOutOfRange` flag.",
      description:
        "### `isOutOfRange` kab `true` hota hai\n\n" +
        "Sirf **is tab pe**, aur sirf tab jab customer ke aas-paas **ek bhi** suggested " +
        "voucher na mile. Us case me backend distance limit hata deta hai aur door wale " +
        "suggested vouchers bhej deta hai.\n\n" +
        "Wajah: jis sheher me curated brands abhi pahunche hi nahi, wahan tab bilkul " +
        "khaali dikhta — jo customer ko **toota hua feature** lagta hai, geographic baat " +
        "nahi.\n\n" +
        "⚠️ `true` aane pe app ko honest hona chahiye — *\"aapke aas-paas nahi hain\"* jaisa " +
        "note dikhayein. In rows ka `nearestOutlet.distance` bahut bada hoga.\n\n" +
        "**Zaruri:** paas me ek bhi pin mil gaya to door wale **nahi** aayenge aur flag " +
        "`false` rahega. Main feed (bina `suggestedOnly`) me ye fallback **kabhi nahi** " +
        "chalta — wo hamesha geo-honest hai.",
      examples: [
        {
          name: "200 — sirf pinned",
          code: 200,
          status: "OK",
          body: ok("Vouchers fetched successfully.", {
            total: 3,
            totalPages: 1,
            page: 1,
            limit: 10,
            isOutOfRange: false,
            data: [{ voucherId: "{{voucher_id}}", name: "flat 30% off on total bill", isSuggested: true }],
          }),
        },
        {
          name: "200 — paas me kuch nahi tha, fallback laga",
          code: 200,
          status: "OK",
          body: ok("Vouchers fetched successfully.", {
            total: 1,
            totalPages: 1,
            page: 1,
            limit: 10,
            isOutOfRange: true,
            data: [
              {
                voucherId: "…",
                name: "grill combo",
                isSuggested: true,
                nearestOutlet: { distance: { meters: 1753000, kilometers: 1753, display: "1753.0 km" } },
              },
            ],
          }),
        },
        {
          name: "404 — kahin bhi koi pin nahi",
          code: 404,
          status: "Not Found",
          body: err("No any voucher found"),
        },
      ],
    }),

    req({
      name: "Customer — voucher detail (banner fields)",
      method: "GET",
      segments: ["vouchers", "customer", "get", "{{voucher_id}}"],
      token: "customer_token",
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
      ],
      changed: "`bannerType` + `bannerUrl` — list wali hi shape.",
      examples: [
        {
          name: "200 — video banner",
          code: 200,
          status: "OK",
          body: ok("Voucher fetched successfully.", {
            voucherId: "{{voucher_id}}",
            name: "flat 30% off on total bill",
            bannerType: VOUCHER_BANNER_TYPE.VIDEO,
            bannerUrl: "https://res.cloudinary.com/…/banner.mp4",
            version: { id: "…", versionNumber: 3, offers: ["… saare offers"] },
            selectedOutlet: null,
            outlets: ["… saare outlets, nearest first"],
            outletCount: 4,
          }),
        },
      ],
    }),

    req({
      name: "Customer — brand directory",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: "customer_token",
      query: [
        { key: "limit", value: "20" },
        { key: "sortBy", value: "TOP_FIRST" },
        { key: "latitude", value: "22.7533", disabled: true },
        { key: "longitude", value: "75.8937", disabled: true },
      ],
      changed: "Naya endpoint. Pehle koi brand-list endpoint tha hi nahi.",
      description:
        "**Query params:**\n\n" +
        "| Param | Default | Notes |\n|---|---|---|\n" +
        "| `page` / `limit` | `1` / `10` | `limit` max 50 |\n" +
        "| `search` | – | `brandName` pe case-insensitive |\n" +
        "| `categoryId` / `subCategoryId` | – | Filter |\n" +
        "| `topOnly` | `false` | `true` → sirf Top Brands tab |\n" +
        "| `sortBy` | `TOP_FIRST` | `TOP_FIRST` \\| `NEWEST` \\| `FOLLOWERS` \\| `NAME` \\| `DISTANCE` |\n" +
        "| `latitude` / `longitude` | – | **Dono saath**, warna `422` |\n\n" +
        "### Geo optional hai\n\n" +
        "Coordinates do to har row pe `distanceInMeters` aayega (brand ke **sabse paas ke " +
        "outlet** ki doori) aur `sortBy=DISTANCE` kaam karega. Na do to ye simple directory " +
        "hai — koi geo kaam hota hi nahi, aur `DISTANCE` chupchaap `NEWEST` ban jaata hai.\n\n" +
        "⚠️ **Main list me curation proximity se upar hai** — `sortBy=DISTANCE` pe bhi " +
        "pinned brands pehle aayenge. Purely nearest-first chahiye to pinned block ko UI " +
        "me alag treat karein.\n\n" +
        "Ye list **card** ke liye hai — features/showcase/outlets detail ke liye " +
        "`GET /brands/customer/get/:brandId`.",
      examples: [
        {
          name: "200 — top brand pehle",
          code: 200,
          status: "OK",
          body: ok("Brands fetched successfully", {
            total: 48,
            totalPages: 3,
            page: 1,
            limit: 20,
            data: [
              {
                _id: "{{brand_id}}",
                brandName: "cafe mocha",
                logo: "https://res.cloudinary.com/…/mocha-logo.jpg",
                coverImage: "https://res.cloudinary.com/…/mocha-cover.jpg",
                uniqueId: "TDB000078",
                followersCount: 1243,
                isTopBrand: true,
                isVerified: true,
                outletCount: 4,
                category: { _id: "…", name: "food and beverages" },
                subCategory: { _id: "…", name: "cafe" },
              },
            ],
          }),
        },
        {
          name: "422 — sirf latitude bheja",
          code: 422,
          status: "Unprocessable Entity",
          body: err("latitude and longitude must be provided together"),
        },
        { name: "404 — koi match nahi (empty state)", code: 404, status: "Not Found", body: err("No any brand found") },
      ],
    }),

    req({
      name: "Customer — Top Brands tab",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: "customer_token",
      query: [{ key: "topOnly", value: "true" }, { key: "limit", value: "10" }],
      changed: "Naya endpoint.",
      description:
        "Is tab me **curation hi ordering hai** — `topOrder` ke hisaab se. `sortBy=DISTANCE` " +
        "bhejne pe bhi wahi order rahega, kyunki yahan sab rows already curated hain.\n\n" +
        "⚠️ Deactivated pinned brands yahan **nahi** aate. Admin ke view (`10` folder) me " +
        "aate hain, taaki unhe unpin kiya ja sake.",
      examples: [
        {
          name: "200 — sirf pinned",
          code: 200,
          status: "OK",
          body: ok("Brands fetched successfully", {
            total: 6,
            totalPages: 1,
            page: 1,
            limit: 10,
            data: [{ _id: "{{brand_id}}", brandName: "cafe mocha", isTopBrand: true, isVerified: true, outletCount: 4 }],
          }),
        },
      ],
    }),
  ],
);

// =============================================================== COLLECTION
const collection = {
  info: {
    _postman_id: "7c3f9a1e-5b2d-4e88-9f21-trydood-secfix",
    name: "Trydood — Security & API Changes (2026-08-26)",
    description: [
      "# Security & API Changes",
      "",
      "Sirf wo endpoints jo **2026-08-26 ke round me badle**, plus 6 naye endpoints.",
      "Baaki endpoints doosri collections me hain.",
      "",
      "Har request ke description me ek **🔄 Kya badla** banner hai.",
      "",
      "---",
      "",
      "## Shuru kaise karein",
      "",
      "1. Environment import karein (`environments/security-*.postman_environment.json`) aur",
      "   top-right se select karein.",
      "2. `admin_password`, `vendor_whatsapp`, `customer_whatsapp` bharein — secrets git me nahi hain.",
      "3. **`00 — Auth`** folder chalayein. Har request apna token khud environment me likh deti hai.",
      "",
      "## Sabse bade changes",
      "",
      "| Kya | Kahan |",
      "|---|---|",
      "| Naya admin WhatsApp se ban nahi sakta | `00`, `01` |",
      "| `/auth/register` ab `isAdmin` + `role` required | `01` |",
      "| Password flow sirf ADMIN | `01` |",
      "| `isFirst` retry bug fix + naya `isProfileComplete` | `00` |",
      "| Signup ab atomic (transaction + self-heal) | `00` |",
      "| `?userId` IDOR band | `02` |",
      "| Naya customer brand endpoint | `03` |",
      "| Showcase brand scoping + ownership | `04` |",
      "| Locations scoping + ownership | `05` |",
      "| 149/149 routes gated | `06` |",
      "| Legal create/update fix | `07` |",
      "| `FIXED` discount fix | `08` |",
      "| Convenience fee + no-offer fallback | `09` |",
      "| Admin curation — suggestions & top brands | `10` |",
      "| Customer tabs + voucher banner fields | `11` |",
      "",
      "## Dhyan rakhne layak",
      "",
      "- **List endpoints empty pe `404` dete hain**, empty array nahi — shared `pagination`",
      "  utility throw karti hai. Isko empty state samajhein, error nahi.",
      "- **WhatsApp OTP abhi verify nahi hota** (deliberate, deferred) — koi bhi 6-digit chalega.",
      "- **`coordinates` `[longitude, latitude]`** order me hain — maps APIs se ulta.",
      "- **Pehla admin API se nahi banta** — `node scripts/seedAdmin.js … --apply`",
      "- **Convenience fee client-side calculate mat karein** — `pricing.convenienceFee` use",
      "  karein. Slabs `Setting.customer.convenienceFee` se aati hain, admin badal sakta hai.",
      "- **Curated tabs alag list nahi hain** — `suggestedOnly` / `topOnly` bas usi sorted set",
      "  ko narrow karte hain, isliye \"view more\" pe rows repeat nahi hote.",
      "",
      "## Regenerate",
      "",
      "```bash",
      "node postman/generate-security-collection.js",
      "```",
      "",
      "JSON hand-edit **mat** karein — enums `constants/` se aate hain, to hand-edit karne se",
      "collection API ke baare me jhooth bolna shuru kar deta hai.",
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    authFolder,
    authChangesFolder,
    usersFolder,
    brandsFolder,
    showcaseFolder,
    locationsFolder,
    gatesFolder,
    legalFolder,
    vouchersFolder,
    pricingFolder,
    curationFolder,
    customerListsFolder,
  ],
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          'if (!pm.environment.get("base_url")) {',
          '  console.warn("⚠️  base_url set nahi hai — environment select karein (top-right).");',
          "}",
        ],
      },
    },
  ],
};

// =============================================================== ENV
const envFile = (name, baseUrl) => ({
  id: `trydood-secfix-${name}`,
  name: `Trydood Security Changes — ${name}`,
  values: [
    { key: "base_url", value: baseUrl, type: "default", enabled: true },

    { key: "admin_email", value: "admin@trydood.com", type: "default", enabled: true },
    { key: "admin_password", value: "", type: "secret", enabled: true },
    { key: "admin_token", value: "", type: "secret", enabled: true },
    { key: "admin_user_id", value: "", type: "default", enabled: true },

    { key: "vendor_whatsapp", value: "9812345678", type: "default", enabled: true },
    { key: "vendor_token", value: "", type: "secret", enabled: true },

    { key: "customer_whatsapp", value: "9876543210", type: "default", enabled: true },
    { key: "customer_token", value: "", type: "secret", enabled: true },

    { key: "otp", value: "000000", type: "default", enabled: true },

    { key: "brand_id", value: "", type: "default", enabled: true },
    { key: "sub_brand_id", value: "", type: "default", enabled: true },
    { key: "section_id", value: "", type: "default", enabled: true },
    { key: "location_id", value: "", type: "default", enabled: true },
    { key: "voucher_id", value: "", type: "default", enabled: true },
    { key: "legal_id", value: "", type: "default", enabled: true },
    { key: "is_first", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

// =============================================================== WRITE
fs.mkdirSync(ENV_DIR, { recursive: true });

const files = [
  ["trydood-security-changes.postman_collection.json", collection],
  ["environments/security-local.postman_environment.json", envFile("local", "http://localhost:8080/trydood/v1")],
  ["environments/security-staging.postman_environment.json", envFile("staging", "https://backend2-0-4v4i.onrender.com/trydood/v1")],
  ["environments/security-production.postman_environment.json", envFile("production", "https://api.trydood.com/trydood/v1")],
];

for (const [rel, obj] of files) {
  const target = path.join(OUT, rel);
  fs.writeFileSync(target, json(obj) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

const count = collection.item.reduce((n, f) => n + f.item.length, 0);
const examples = collection.item.reduce(
  (n, f) => n + f.item.reduce((m, r) => m + (r.response?.length || 0), 0),
  0,
);
console.log(`\n${collection.item.length} folders · ${count} requests · ${examples} saved examples`);
