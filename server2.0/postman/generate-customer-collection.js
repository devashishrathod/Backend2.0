/**
 * Generates the Customer Mobile App Postman v2.1 collection + environments.
 *
 *   node postman/generate-customer-collection.js
 *
 * Covers all 35 customer-facing endpoints, verified against the code on
 * 2026-08-26. Companion doc: docs/customer_mobile_api_doc.md
 *
 * Shape (agreed with the team):
 *  - Happy paths and behaviour-changing edge cases are **separate requests**, so
 *    the whole folder is runnable in the Collection Runner / Newman and actually
 *    tests the API rather than describing it.
 *  - Per-field Joi rejections that only restate the validator are **saved
 *    examples** on the request they belong to.
 *  - Every request carries `pm.test` assertions — status, envelope, and the
 *    documented field shape.
 *
 * Enums, limits and defaults are read from `constants/` so the collection cannot
 * drift from the code. Re-run after touching those; never hand-edit the JSON.
 */
const fs = require("fs");
const path = require("path");

const { ROLES, LOGIN_TYPES, ADDRESS_TYPES } = require("../constants");
const { VOUCHER_SORT_BY, VOUCHER_DISCOUNT_TYPES } = require("../constants/voucher");
const { VOUCHER_BANNER_TYPE } = require("../constants/voucherBanner");
const { CONVENIENCE_FEE_DEFAULTS } = require("../constants/customer");
const { DEVICE_PLATFORMS } = require("../constants/notification");
const { FOLLOW_SORT_BY } = require("../constants/follow");
const { BRAND_AVOIDANCE_SORT_BY } = require("../constants/brandAvoidance");

const { json, ok, err, A, req, folder, countTree } = require("./lib/builders");

const OUT = __dirname;
const ENV_DIR = path.join(OUT, "environments");
const list = (o) => Object.values(o).join(" | ");

/** An ObjectId that is syntactically valid but will never exist. */
const GHOST_ID = "000000000000000000000000";

const CUST = "customer_token";

// Slab table derived from the real defaults so it cannot drift.
const { slabSize, feePerSlab } = CONVENIENCE_FEE_DEFAULTS;
const feeFor = (bill) => Math.ceil(bill / slabSize) * feePerSlab;

// ===========================================================================
// 00 — Setup & Auth
// ===========================================================================
const authFolder = folder(
  "00 — Setup & Auth",
  [
    "**Yahan se shuru karein.** Verify-OTP request token aur ids environment me",
    "khud likh deti hai, to aage kahin copy-paste nahi karna padta.",
    "",
    "Sirf `customer_whatsapp` bharna hai — baaki sab yahan se aage apne aap bharta jaata hai.",
    "",
    "⚠️ **WhatsApp OTP abhi verify nahi hota** (deliberate, deferred) — koi bhi 6-digit",
    "chalega. Jab wo uncomment hoga to galat OTP pe `Invalid OTP! Please try again.` aayega",
    "aur yahan ke expectations badalne padenge.",
  ].join("\n"),
  [
    req({
      name: "1. Send OTP — naya ya existing customer",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{customer_whatsapp}}", role: ROLES.CUSTOMER },
      gate: "Public",
      description: [
        "Naya number ho to `User` + `Customer` **ek transaction me** bante hain.",
        "",
        "| Field | Matlab |",
        "|---|---|",
        "| `isFirst` | **OTP verify nahi hua** — user document naya hai, ye nahi. Retry pe bhi `true` rehta hai |",
        "| `isProfileComplete` | Profile details bhare gaye ya nahi |",
        "",
        "`role` chhod dein to `CUSTOMER` default hai.",
      ].join("\n"),
      capture: [
        ["is_first", "d.isFirst"],
        ["customer_user_id", "d.user._id"],
      ],
      assert: [
        ...A.status(200),
        ...A.ok("OTP sent to your whatsapp number successfully."),
        ...A.fields({
          isFirst: "boolean",
          isProfileComplete: "boolean",
          user: "object",
        }),
        ...A.custom("user is a CUSTOMER", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.user.role).to.eql(${json(ROLES.CUSTOMER)});`,
        ]),
        ...A.custom("password hash strip ho gaya", [
          `const u = pm.response.json().data.user;`,
          `pm.expect(u).to.not.have.property("password");`,
          `pm.expect(u).to.not.have.property("otp");`,
        ]),
      ],
      examples: [
        {
          name: "200 — naya number",
          code: 200,
          status: "OK",
          body: ok("OTP sent to your whatsapp number successfully.", {
            isFirst: true,
            isProfileComplete: false,
            user: {
              _id: "{{customer_user_id}}",
              role: ROLES.CUSTOMER,
              whatsappNumber: "{{customer_whatsapp}}",
              customerId: "{{customer_id}}",
              isMobileVerified: false,
              isSignUpCompleted: false,
            },
          }),
        },
        {
          name: "422 — 10 digit number nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Please enter a valid 10 digit WhatsApp number"),
        },
        {
          name: "422 — whatsappNumber missing",
          code: 422,
          status: "Unprocessable Entity",
          body: err("WhatsApp number is required"),
        },
      ],
    }),

    req({
      name: "2. Send OTP dobara — isFirst abhi bhi true (regression)",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "{{customer_whatsapp}}", role: ROLES.CUSTOMER },
      gate: "Public",
      description: [
        "**Ye ek fix ka regression test hai.** Pehle `isFirst` User document ke *hone* pe",
        "based tha, verify hone pe nahi — to OTP na aane pe user dobara try karta aur",
        "`isFirst: false` mil jaata. App use returning user samajh leta aur onboarding",
        "screen skip kar deti.",
        "",
        "Ye request request #1 ke turant baad chalti hai, **verify se pehle** — to `isFirst`",
        "abhi bhi `true` hona chahiye.",
        "",
        "⚠️ Agar ye customer pehle se verified hai to `isFirst` `false` aayega aur ye test",
        "fail dikhega. Fresh number pe chalayein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("retry pe isFirst nahi badla", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.isFirst, "isFirst").to.eql(pm.environment.get("is_first") === "true");`,
        ]),
        ...A.custom("duplicate Customer document nahi bana", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.user.customerId, "customerId").to.be.ok;`,
        ]),
      ],
    }),

    req({
      name: "3. Verify OTP → token capture ⭐",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: {
        whatsappNumber: "{{customer_whatsapp}}",
        otp: "{{otp}}",
        role: ROLES.CUSTOMER,
      },
      gate: "Public",
      description: [
        "**Baaki poori collection isi request pe depend karti hai** — ye `customer_token`,",
        "`customer_user_id` aur `customer_id` environment me save karti hai.",
        "",
        "### ⚠️ `currentScreen` customer app se mat bhejein",
        "",
        "Validator ise **koi bhi string** maan leta hai (`Joi.string().optional()`), par",
        "`User.currentScreen` pe mongoose enum lagi hui hai — aur us enum me sirf **vendor",
        "onboarding** ke screens hain:",
        "",
        "`BUSINESS_NAME` · `REGISTRATION_STATUS` · `REGISTRATION_ENTITY_TYPE` ·",
        "`PAN_VERIFICATION` · `GST_VERIFICATION` · `BANK_VERIFICATION` ·",
        "`SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `SUBSCRIBE_PLAN` · `OUTLET_PAGE` ·",
        "`UNDER_REVIEW` · `DASHBOARD`",
        "",
        "Customer ke liye koi screen hai hi nahi. `\"HOME\"` bhejne pe poori login call",
        "`422` ho jaati hai — aur error bhi raw mongoose message hota hai:",
        "*``HOME` is not a valid enum value for path `currentScreen`.``*",
        "",
        "Matlab galat value login hi tod deti hai, chup-chaap ignore nahi hoti. Isliye",
        "customer app se ye field **bhejni hi nahi hai**.",
      ].join("\n"),
      capture: [
        [CUST, "d.token"],
        ["customer_user_id", "d.user._id"],
        ["customer_id", "d.user.customerId"],
      ],
      assert: [
        ...A.status(200),
        ...A.ok("OTP verified successfully"),
        ...A.fields({ token: "string", user: "object" }),
        ...A.custom("token environment me save ho gaya", [
          `pm.expect(pm.environment.get("customer_token"), "customer_token").to.be.a("string").and.not.empty;`,
        ]),
        ...A.custom("isMobileVerified ab true hai", [
          `pm.expect(pm.response.json().data.user.isMobileVerified).to.eql(true);`,
        ]),
        ...A.custom("password / otp response me nahi", [
          `const u = pm.response.json().data.user;`,
          `pm.expect(u).to.not.have.property("password");`,
          `pm.expect(u).to.not.have.property("otp");`,
        ]),
      ],
      examples: [
        {
          name: "422 — OTP 6 digit nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("OTP must be 6 digits"),
        },
        {
          name: "422 — currentScreen: \"HOME\" bhej diya",
          code: 422,
          status: "Unprocessable Entity",
          body: err("`HOME` is not a valid enum value for path `currentScreen`."),
        },
      ],
    }),

    req({
      name: "4. Send OTP as ADMIN → 403 (naya admin ban nahi sakta)",
      method: "POST",
      segments: ["auth", "loginOrSignUp-with-whatsapp"],
      body: { whatsappNumber: "9099900999", role: ROLES.ADMIN },
      gate: "Public",
      description: [
        "Self-signup sirf `CUSTOMER` aur `VENDOR` ke liye hai. Pehle",
        "`{ whatsappNumber, role: \"ADMIN\" }` bhejkar koi bhi super admin bana sakta tha.",
        "",
        "**Existing** admin isi endpoint se login kar sakta hai — block sirf *naya* account",
        "banne pe hai. Isliye yahan ek aisa number use karein jo kisi admin ka na ho.",
      ].join("\n"),
      assert: [...A.status(403), ...A.err()],
    }),

    req({
      name: "5. Verify OTP — unknown number → 404",
      method: "POST",
      segments: ["auth", "verify-otp-whatsapp"],
      body: {
        whatsappNumber: "6000000009",
        otp: "000000",
        role: ROLES.CUSTOMER,
      },
      gate: "Public",
      description:
        "Jis number ne kabhi signup nahi kiya usko verify karne pe `404`.",
      assert: [
        ...A.status(404),
        ...A.err("Invalid Whatsapp number, user not found!"),
      ],
    }),

    req({
      name: "6. Logout",
      method: "POST",
      segments: ["auth", "logout"],
      token: CUST,
      gate: "`verifyJwtToken` — koi bhi signed-in role",
      description: [
        "⚠️ **Ye server pe kuch nahi karta.** Koi token blacklist nahi hai, koi session",
        "invalidate nahi hoti — JWT apne expiry tak valid rehta hai. App ko token locally",
        "delete karna hai; ye call sirf ek acknowledgement hai.",
        "",
        "Isliye ise sabse aakhir me chalayein, warna baaki requests ke liye token to rahega",
        "par order confusing lagega.",
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
    "`userId` **query param nahi hai**. Pehle `?userId=` token se jeet jaata tha, matlab",
    "koi bhi valid token kisi ka bhi profile padh aur likh sakta tha — aur ObjectIds",
    "`createdBy`, `followerId` aur brand lookups se aaram se mil jaati hain.",
    "",
    "Ab dono endpoints hamesha token wale user pe kaam karte hain.",
  ].join("\n"),
  [
    req({
      name: "Get my profile",
      method: "GET",
      segments: ["users", "get"],
      token: CUST,
      gate: "`verifyJwtToken`",
      description: [
        "`customerId` populate hoke aata hai, aur uske andar `locationId` bhi.",
        "",
        "Password aur OTP service level pe project-out hote hain (`-password -otp -isDeleted`).",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("User fetched successfully"),
        ...A.fields({
          _id: "string",
          role: "string",
          whatsappNumber: "null-or-string",
        }),
        ...A.absent(["password", "otp"]),
        ...A.custom("token wale hi user ka data aaya", [
          `const d = pm.response.json().data;`,
          `pm.expect(String(d._id)).to.eql(String(pm.environment.get("customer_user_id")));`,
        ]),
      ],
    }),

    req({
      name: "Get my profile — bina token → 401",
      method: "GET",
      segments: ["users", "get"],
      gate: "`verifyJwtToken`",
      description: "Authorization header hi nahi — `401`, `403` nahi.",
      assert: [
        ...A.status(401),
        ...A.err("Access Denied! Missing authorization token"),
      ],
    }),

    req({
      name: "Update my profile",
      method: "PUT",
      segments: ["users", "update"],
      token: CUST,
      form: [
        { key: "fullName", value: "postman customer" },
        { key: "dob", value: "1998-04-12" },
        // Derived from the number so repeat runs against the same database do
        // not collide on the unique-email check. `.com` rather than `.test`
        // because Joi validates the TLD against a real list — a reserved-but-
        // unlisted TLD is rejected as an invalid address.
        { key: "email", value: "postman.{{customer_whatsapp}}@example.com" },
        { key: "appliedReferralCode", value: "", disabled: true },
        {
          key: "image",
          type: "file",
          disabled: true,
          description:
            "Optional profile photo — Cloudinary pe upload hoti hai. Enable karke file chunein; " +
            "disabled isliye rakha hai ki Newman run me 'missing file source' warning na aaye.",
        },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "**Multipart** request hai (`image` file ke liye), JSON nahi. Sirf text fields",
        "bhejni hon to bhi form-data hi chalega.",
        "",
        "| Field | Rule |",
        "|---|---|",
        "| `fullName` | 2–100 chars. DB me **lowercase** store hota hai |",
        "| `dob` | ISO date (`YYYY-MM-DD`) |",
        "| `email` | Valid email. Badalne pe `isEmailVerified` **`false`** ho jaata hai |",
        "| `appliedReferralCode` | Max 20 chars |",
        "| `image` | File. Purani image Cloudinary se delete ho jaati hai |",
        "",
        "⚠️ Ye validator **unknown fields reject karta hai** (`stripUnknown` nahi lagta) —",
        "extra key bhejne pe `422`.",
        "",
        "⚠️ Har successful call `isSignUpCompleted: true` set kar deti hai, chahe aapne",
        "kuch bhi bheja ho.",
        "",
        "Response me do blocks hain — `userData` aur `customerData`.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("User profile updated successfully"),
        ...A.fields({ userData: "object", customerData: "object" }),
        ...A.custom("customer mirror sync ho gaya", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.customerData.fullName, "customerData.fullName").to.eql(d.userData.name);`,
        ]),
        ...A.custom("isSignUpCompleted set ho gaya", [
          `pm.expect(pm.response.json().data.userData.isSignUpCompleted).to.eql(true);`,
        ]),
        ...A.custom("password / otp response me nahi", [
          `const u = pm.response.json().data.userData;`,
          `pm.expect(u).to.not.have.property("password");`,
          `pm.expect(u).to.not.have.property("otp");`,
        ]),
      ],
      examples: [
        {
          name: "400 — email kisi aur ka hai",
          code: 400,
          status: "Bad Request",
          body: err("Email already exists with another user"),
        },
        {
          name: "422 — dob ISO format me nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err(
            "Date of birth must be a valid date in ISO format (YYYY-MM-DD)",
          ),
        },
      ],
    }),

    req({
      name: "Update my profile — unknown field → 422",
      method: "PUT",
      segments: ["users", "update"],
      token: CUST,
      form: [{ key: "role", value: "ADMIN" }],
      gate: "`verifyJwtToken`",
      description: [
        "Ye endpoint shared `validateSchema` middleware use **nahi** karta — controller",
        "khud Joi chalata hai bina `stripUnknown` ke. To unknown key chup-chaap drop nahi",
        "hoti, `422` deti hai.",
        "",
        "Practically ye achha hai: `role` jaisi field escalate karne ki koshish yahan",
        "saaf reject hoti hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Delete my account ⚠️ no-op",
      method: "DELETE",
      segments: ["users", "delete"],
      token: CUST,
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ **Ye kuch delete nahi karta.** Route file me ek inline handler hai jo bas",
        "`200` return karta hai — na soft delete, na hard. Controller/service exist hi",
        "nahi karte.",
        "",
        "Do problems:",
        "1. **App store compliance risk** — Play Store / App Store account deletion",
        "   mandatory karte hain. Customer button dabayega, success dikhega, account zinda.",
        "2. **Response envelope alag hai** — `sendSuccess` nahi, raw `res.json` — to",
        "   `success` field hi nahi aati. App ka standard response handler isko fail",
        "   samajh sakta hai.",
        "",
        "Cascade plan likha hua hai (`docs/account_deletion_plan.md`) par implement tab",
        "hoga jab poora flow ready ho.",
        "",
        "**Neeche wale tests deliberately current (galat) behaviour assert karte hain** —",
        "jis din ye theek hoga, ye fail honge, aur wahi signal chahiye.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.custom("⚠️ standard envelope NAHI hai (known gap)", [
          `const b = pm.response.json();`,
          `pm.expect(b, "success key").to.not.have.property("success");`,
          `pm.expect(b.message).to.eql("User deleted successfully");`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 02 — Location
// ===========================================================================
const locationFolder = folder(
  "02 — Location",
  [
    "Customer ka **ek hi** saved address hota hai — `POST /upsert` create bhi karta hai",
    "aur replace bhi.",
    "",
    "⚠️ `coordinates` **`[longitude, latitude]`** order me hain (GeoJSON standard), jo",
    "Google Maps ke ulta hai. Indore = `[75.8937, 22.7533]`, `[22.7533, 75.8937]` nahi.",
    "",
    "Ye address voucher feed ka base hai — isliye `upsert` ab sirf token wale user pe",
    "chalta hai. Pehle body ka `userId` token se jeet jaata tha, to koi bhi customer",
    "kisi aur ka address overwrite karke uska poora feed badal sakta tha.",
  ].join("\n"),
  [
    req({
      name: "Upsert my address ⭐",
      method: "POST",
      segments: ["locations", "upsert"],
      token: CUST,
      body: {
        addressLine1: "flat 402, orchid residency",
        addressLine2: "scheme 54",
        landmark: "opposite c21 mall",
        city: "indore",
        district: "indore",
        state: "madhya pradesh",
        country: "india",
        zipcode: "452010",
        coordinates: [75.8937, 22.7533],
        addressType: ADDRESS_TYPES.HOME,
        isDefault: true,
      },
      gate: "`isCustomer`",
      description: [
        "| Field | Required | Notes |",
        "|---|---|---|",
        "| `addressLine1` · `city` · `state` · `zipcode` · `coordinates` | ✅ | |",
        "| `addressLine2` · `landmark` · `district` · `formattedAddress` | ❌ | |",
        "| `country` | ❌ | Default `india`. Zipcode validation isi pe depend karti hai |",
        "| `addressType` | ❌ | `" + list(ADDRESS_TYPES) + "` |",
        "| `isDefault` | ❌ | Default `false` |",
        "",
        "`formattedAddress` na bhejein to backend baaki fields se bana deta hai.",
        "",
        "⚠️ **`userId`, `brandId`, `isBrandAddress` yahan accept hi nahi hote.** Pehle ye",
        "schema `create` se borrow hota tha, to customer apne ghar ke address ko brand",
        "address mark kar sakta tha. Bhejenge to chup-chaap strip ho jayenge.",
        "",
        "City / district / state / country DB me **lowercase** store hote hain.",
      ].join("\n"),
      capture: [["location_id", "d._id"]],
      assert: [
        ...A.status(201),
        ...A.ok("Location upserted successfully"),
        ...A.fields({
          _id: "string",
          addressLine1: "string",
          city: "string",
          zipcode: "string",
          geo: "object",
        }),
        ...A.custom("geo GeoJSON Point hai, coordinates [lng, lat]", [
          `const g = pm.response.json().data.geo;`,
          `pm.expect(g.type).to.eql("Point");`,
          `pm.expect(g.coordinates).to.be.an("array").with.lengthOf(2);`,
          `pm.expect(g.coordinates[0], "longitude").to.be.within(-180, 180);`,
          `pm.expect(g.coordinates[1], "latitude").to.be.within(-90, 90);`,
        ]),
        ...A.custom("mera hi address hai", [
          `const d = pm.response.json().data;`,
          `pm.expect(String(d.userId)).to.eql(String(pm.environment.get("customer_user_id")));`,
        ]),
        ...A.custom("brand flags set nahi hue (stripped)", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.isBrandAddress, "isBrandAddress").to.not.eql(true);`,
          `pm.expect(d.isSubBrandAddress, "isSubBrandAddress").to.not.eql(true);`,
        ]),
      ],
      examples: [
        {
          name: "422 — coordinates array 2 ka nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Coordinates must be [longitude, latitude]."),
        },
        {
          name: "422 — addressLine1 missing",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Address Line 1 is required"),
        },
      ],
    }),

    req({
      name: "Upsert — coordinates ulte ([lat, lng]) → 422",
      method: "POST",
      segments: ["locations", "upsert"],
      token: CUST,
      body: {
        addressLine1: "flat 402",
        city: "indore",
        state: "madhya pradesh",
        zipcode: "452010",
        coordinates: [222.7533, 75.8937],
      },
      gate: "`isCustomer`",
      description: [
        "Sabse common integration bug — Maps se `[lat, lng]` seedha aage bhej dena.",
        "",
        "Range check isko tabhi pakadta hai jab pehla number 180 se bada ho. Indore ke",
        "case me (`22.75`, `75.89`) **dono valid ranges me** aate hain, to ulta bhejne pe",
        "validation pass ho jayegi aur customer ka address chup-chaap **Somalia ke paas**",
        "chala jayega — aur voucher feed khaali aayega.",
        "",
        "Yahan longitude ko deliberately 222 kiya hai taaki reject dikhe.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Upsert — galat zipcode → 422",
      method: "POST",
      segments: ["locations", "upsert"],
      token: CUST,
      body: {
        addressLine1: "flat 402",
        city: "indore",
        state: "madhya pradesh",
        zipcode: "12",
        country: "india",
        coordinates: [75.8937, 22.7533],
      },
      gate: "`isCustomer`",
      description: [
        "Zipcode `country` ke hisaab se validate hota hai — India ke liye 6 digits.",
        "",
        "Jis country ka pattern maloom nahi, uske liye validation **skip** ho jaati hai",
        "(reject nahi hoti).",
      ].join("\n"),
      assert: [...A.status(422), ...A.err("Invalid Zip Code/Postal Code")],
    }),

    req({
      name: "Get my address by id",
      method: "GET",
      segments: ["locations", "get", "{{location_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`, ownership service me",
      description: [
        "Gate sirf \"signed in\" hai — kaunsa address dikhega ye service me role ke hisaab",
        "se decide hota hai:",
        "",
        "| Role | Kya dikhta hai |",
        "|---|---|",
        "| `CUSTOMER` | **Sirf apna** (`location.userId === token userId`) |",
        "| `VENDOR` | Apne brand ka + apne outlets ka |",
        "| `ADMIN` | Sab |",
        "",
        "Pehle id hi kaafi thi — koi bhi signed-in user kisi bhi customer ka ghar ka",
        "address aur coordinates padh sakta tha.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Location fetched successfully"),
        ...A.fields({ _id: "string", geo: "object" }),
        ...A.custom("mera hi address hai", [
          `const d = pm.response.json().data;`,
          `pm.expect(String(d.userId)).to.eql(String(pm.environment.get("customer_user_id")));`,
        ]),
      ],
    }),

    req({
      name: "Get address — jo exist hi nahi karta → 404",
      method: "GET",
      segments: ["locations", "get", GHOST_ID],
      token: CUST,
      gate: "`verifyJwtToken`",
      description: [
        "Valid ObjectId format, par koi document nahi.",
        "",
        "**Kisi doosre customer ka** address maangne pe `403 Forbidden` aata hai — wo",
        "test yahan nahi hai kyunki uske liye doosre customer ki id chahiye. Ownership",
        "check `services/locations/getLocation.js` me hai.",
      ].join("\n"),
      assert: [...A.status(404), ...A.err("Location not found")],
    }),
  ],
);

// ===========================================================================
// 03 — Master Data
// ===========================================================================
const masterDataFolder = folder(
  "03 — Master Data",
  [
    "Categories aur sub-categories — filter chips aur onboarding ke liye.",
    "",
    "Reads har signed-in role ke liye khule hain (`verifyJwtToken`); writes admin-only.",
    "",
    "⚠️ Dono list endpoints khaali result pe **`404`** dete hain, empty array nahi —",
    "shared `pagination` utility throw karti hai. Isko empty state samajhein.",
  ].join("\n"),
  [
    req({
      name: "All categories",
      method: "GET",
      segments: ["categories", "getAll"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        { key: "isActive", value: "true" },
        { key: "search", value: "", disabled: true, description: "name ya description pe match" },
        { key: "sortBy", value: "createdAt", disabled: true },
        { key: "sortOrder", value: "desc", disabled: true },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "| Param | Default | Notes |",
        "|---|---|---|",
        "| `page` / `limit` | `1` / `10` | `limit` pe koi upper cap **nahi** hai |",
        "| `search` | – | `name` **ya** `description` pe regex |",
        "| `name` | – | Sirf `name` pe regex |",
        "| `isActive` | – | `\"true\"` / `\"false\"` |",
        "| `fromDate` / `toDate` | – | ISO date, `createdAt` pe |",
        "| `sortBy` / `sortOrder` | `createdAt` / `desc` | |",
        "",
        "⚠️ `search` ka regex **escape nahi hota** — `.*` jaisa input regex ki tarah",
        "chalega, error nahi dega. Voucher aur brand listings me `escapeRegex` lagta hai,",
        "yahan nahi.",
      ].join("\n"),
      capture: [["category_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Categories fetched"),
        ...A.paged(),
        ...A.fields(
          { _id: "string", name: "string", isActive: "boolean" },
          { each: true },
        ),
      ],
      examples: [
        {
          name: "404 — koi category nahi",
          code: 404,
          status: "Not Found",
          body: err("No any category found"),
        },
        {
          name: "422 — sortOrder asc/desc ke alawa",
          code: 422,
          status: "Unprocessable Entity",
          body: err('"sortOrder" must be one of [asc, desc]'),
        },
      ],
    }),

    req({
      name: "One category",
      method: "GET",
      segments: ["categories", "get", "{{category_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Category fetched"),
        ...A.fields({ _id: "string", name: "string" }),
      ],
    }),

    req({
      name: "All sub-categories",
      method: "GET",
      segments: ["subCategories", "getAll"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
        {
          key: "categoryId",
          value: "{{category_id}}",
          description: "Parent category pe filter — optional",
        },
      ],
      gate: "`verifyJwtToken`",
      description:
        "`categoryId` **optional** hai. Na dein to platform ki saari sub-categories aati hain.",
      capture: [["sub_category_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Sub-categories fetched"),
        ...A.paged(),
        ...A.fields({ _id: "string", name: "string" }, { each: true }),
      ],
      examples: [
        {
          name: "422 — categoryId ObjectId nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Invalid categoryId format"),
        },
      ],
    }),

    req({
      name: "One sub-category",
      method: "GET",
      segments: ["subCategories", "get", "{{sub_category_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Sub-category fetched"),
        ...A.fields({ _id: "string", name: "string" }),
      ],
    }),
  ],
);

// ===========================================================================
// 04 — Home Screen
// ===========================================================================
const homeFolder = folder(
  "04 — Home Screen",
  [
    "Banner aur promotional tickers — dono `isCustomer` gated hain.",
    "",
    "Dono me se koi bhi **`404` nahi deta** — kuch na ho to `200` + `null` / `[]`. Ye",
    "baaki list endpoints se alag hai, aur deliberately: home screen ek missing banner",
    "pe error nahi dikha sakti.",
  ].join("\n"),
  [
    req({
      name: "Active banner",
      method: "GET",
      segments: ["banners", "customer", "active"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "Ek hi banner aata hai, resolution do steps me:",
        "",
        "1. Aisa active banner jiski date window **abhi chal rahi** hai (latest `startDate` pehle)",
        "2. Warna aisa active banner jiski **koi date set hi nahi** (evergreen fallback, newest first)",
        "3. Warna `null`",
        "",
        "⚠️ **`data` `null` ho sakta hai** aur message bhi badal jaata hai —",
        "`\"No active banner found.\"`. App ko dono handle karne hain; `data.image` ko",
        "seedha access mat karein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.custom("success envelope (data null ho sakta hai)", [
          `const b = pm.response.json();`,
          `pm.expect(b.success).to.eql(true);`,
          `pm.expect(b).to.have.property("data");`,
        ]),
        ...A.custom("banner ho to shape sahi, warna null", [
          `const d = pm.response.json().data;`,
          `if (d === null) {`,
          `  pm.expect(pm.response.json().message).to.eql("No active banner found.");`,
          `} else {`,
          `  pm.expect(d._id, "_id").to.be.a("string");`,
          `  pm.expect(d.isActive, "isActive").to.eql(true);`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "200 — koi banner nahi",
          code: 200,
          status: "OK",
          body: ok("No active banner found.", null),
        },
      ],
    }),

    req({
      name: "Active promotional tickers",
      method: "GET",
      segments: ["promotionalTickers", "customer", "active"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "**Array** aata hai (banner ke ulta), `displayOrder` ascending.",
        "",
        "Wahi date rule: date window chal rahi ho, **ya** koi date set hi na ho.",
        "",
        "Kuch na ho to khaali array — `404` nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Active promotional tickers fetched successfully."),
        ...A.custom("data ek array hai", [
          `pm.expect(pm.response.json().data).to.be.an("array");`,
        ]),
        ...A.custom("displayOrder ascending hai", [
          `const rows = pm.response.json().data;`,
          `const orders = rows.map(function (r) { return r.displayOrder; });`,
          `const sorted = orders.slice().sort(function (a, b) { return a - b; });`,
          `pm.expect(orders).to.eql(sorted);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 05 — Vouchers
// ===========================================================================
const voucherFolder = folder(
  "05 — Vouchers",
  [
    "Customer ko sirf **`PUBLISHED`**, currently-valid (`startAt <= now < endAt`) vouchers",
    "dikhte hain, aur wo bhi ek max radius ke andar wale outlets ke.",
    "",
    "Max distance settings se aata hai (`Setting.vendor.voucher.maxDistanceKm`), fallback 25 km.",
    "",
    "### Location resolution",
    "",
    "1. `latitude` **aur** `longitude` dono query me hon → wahi (live GPS ke liye best)",
    "2. Warna customer ki **saved location**",
    "3. Dono nahi → `400`",
    "",
    "### Pipeline `SubBrand` se shuru hoti hai, `Voucher` se nahi",
    "",
    "Iska seedha matlab: **bina outlet ke ya bina geo ke outlets wale vouchers list me",
    "aayenge hi nahi** — chahe wo perfectly published hon. Voucher \"gayab\" hone ki sabse",
    "common wajah yahi hai.",
  ].join("\n"),
  [
    req({
      name: "Voucher feed — GPS coordinates ke saath ⭐",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "sortBy", value: VOUCHER_SORT_BY.DISTANCE },
        { key: "limit", value: "20" },
        { key: "page", value: "1" },
        { key: "categoryId", value: "{{category_id}}", disabled: true },
        { key: "search", value: "", disabled: true },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "| Param | Default | Notes |",
        "|---|---|---|",
        "| `page` / `limit` | `1` / `10` | `limit` **max 50** |",
        "| `search` | – | Max 100 chars |",
        "| `categoryId` / `subCategoryId` | – | Filter |",
        "| `suggestedOnly` | `false` | Suggestions tab — alag request neeche |",
        "| `sortBy` | `" + VOUCHER_SORT_BY.DISTANCE + "` | `" + list(VOUCHER_SORT_BY) + "` |",
        "| `sortOrder` | *preset-wise* | `asc` / `desc` |",
        "| `latitude` / `longitude` | saved location | |",
        "",
        "**Sort ka natural direction `sortBy` pe depend karta hai** — `sortOrder` na bhejein to:",
        "",
        "| `sortBy` | Direction |",
        "|---|---|",
        "| `" + VOUCHER_SORT_BY.DISTANCE + "` | Nearest first |",
        "| `" + VOUCHER_SORT_BY.NEWEST + "` | Latest first |",
        "| `" + VOUCHER_SORT_BY.EXPIRING_SOON + "` | Jaldi expire hone wala pehle |",
        "| `" + VOUCHER_SORT_BY.RELEVANCE + "` | Best match first |",
        "",
        "⚠️ **Admin ke pin kiye vouchers har ordering se upar rehte hain.** `sortBy` chahe",
        "kuch bhi ho, `isSuggested` pehli sort key hai.",
      ].join("\n"),
      // `nearestOutlet` carries `subBrandId`, not `_id` — the pipeline's
      // `$group` renames it while collapsing the outlet rows into one voucher.
      capture: [
        ["voucher_id", "d.data[0].voucherId"],
        ["sub_brand_id", "d.data[0].nearestOutlet.subBrandId"],
        ["brand_id", "d.data[0].brand.id"],
      ],
      assert: [
        ...A.status(200),
        ...A.ok("Vouchers fetched successfully."),
        ...A.paged(),
        ...A.custom("isOutOfRange top-level flag hai", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.isOutOfRange, "isOutOfRange").to.be.a("boolean");`,
          `pm.expect(d.isOutOfRange, "geo-honest feed").to.eql(false);`,
        ]),
        ...A.fields(
          {
            voucherId: "string",
            name: "string",
            bannerType: "null-or-string",
            bannerUrl: "null-or-string",
            isSuggested: "boolean",
            outletCount: "number",
            offerCount: "number",
            isAppliedOnAllOutlets: "boolean",
            isContainsAd: "boolean",
            isFavorite: "boolean",
          },
          { each: true },
        ),
        ...A.custom("nearestOutlet me subBrandId hai (_id nahi)", [
          `pm.response.json().data.data.forEach(function (v) {`,
          `  if (!v.nearestOutlet) return;`,
          `  pm.expect(v.nearestOutlet.subBrandId, "subBrandId").to.be.ok;`,
          `  pm.expect(v.nearestOutlet.distance, "distance").to.be.an("object");`,
          `});`,
        ]),
        ...A.custom("bannerType aur bannerUrl hamesha saath chalte hain", [
          `pm.response.json().data.data.forEach(function (v) {`,
          `  const bothNull = v.bannerType === null && v.bannerUrl === null;`,
          `  const bothSet = !!v.bannerType && !!v.bannerUrl;`,
          `  pm.expect(bothNull || bothSet, "banner pair for " + v.name).to.eql(true);`,
          `});`,
        ]),
        ...A.custom(`bannerType enum me se hai (${list(VOUCHER_BANNER_TYPE)})`, [
          `const allowed = ${json(Object.values(VOUCHER_BANNER_TYPE))};`,
          `pm.response.json().data.data.forEach(function (v) {`,
          `  if (v.bannerType !== null) pm.expect(allowed).to.include(v.bannerType);`,
          `});`,
        ]),
        ...A.custom("suggested vouchers list me sabse upar hain", [
          `const rows = pm.response.json().data.data;`,
          `let seenPlain = false;`,
          `rows.forEach(function (v) {`,
          `  if (!v.isSuggested) seenPlain = true;`,
          `  else pm.expect(seenPlain, "suggested row after a plain one: " + v.name).to.eql(false);`,
          `});`,
        ]),
        ...A.custom("DISTANCE sort: nearest pehle (suggested block ke baad)", [
          `const rows = pm.response.json().data.data.filter(function (v) { return !v.isSuggested; });`,
          `const d = rows.map(function (v) { return v.nearestOutlet && v.nearestOutlet.distance ? v.nearestOutlet.distance.meters : 0; });`,
          `const sorted = d.slice().sort(function (a, b) { return a - b; });`,
          `pm.expect(d).to.eql(sorted);`,
        ]),
        ...A.absent(["banner"], { each: true }),
      ],
      examples: [
        {
          name: "404 — is radius me kuch nahi",
          code: 404,
          status: "Not Found",
          body: err("No any voucher found"),
        },
        {
          name: "422 — limit 50 se zyada",
          code: 422,
          status: "Unprocessable Entity",
          body: err('"limit" must be less than or equal to 50'),
        },
        {
          name: "422 — categoryId ObjectId nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Invalid category ID."),
        },
      ],
    }),

    req({
      name: "Voucher feed — saved location se (bina coordinates)",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [{ key: "limit", value: "10" }],
      gate: "`verifyJwtToken`",
      description: [
        "Coordinates na bhejein to customer ki saved location use hoti hai —",
        "isliye folder `02` pehle chalana zaruri hai.",
        "",
        "**Recommendation:** app me har call me GPS coordinates bhejein. Saved location pe",
        "depend karna matlab user travel kare to feed purani jagah ki dikhti rahegi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Vouchers fetched successfully."),
        ...A.paged(),
      ],
      examples: [
        {
          name: "400 — na coordinates, na saved location",
          code: 400,
          status: "Bad Request",
          body: err("Customer location not found."),
        },
        {
          name: "400 — saved location ka geo corrupt",
          code: 400,
          status: "Bad Request",
          body: err("Customer location coordinates not found."),
        },
      ],
    }),

    req({
      name: "Suggestions tab (suggestedOnly=true)",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "suggestedOnly", value: "true" },
        { key: "limit", value: "10" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "Sirf wahi vouchers jo admin ne pin kiye. Order `suggestionOrder` ascending.",
        "",
        "### \"View more\" ke liye alag call nahi chahiye",
        "",
        "Param hata dein aur wahi endpoint sab vouchers deta hai, pinned wale upar. Ye do",
        "lists jodkar nahi banti — **ek hi sorted result set** hai jisme `isSuggested`",
        "pehli sort key hai. Isliye pinned rows page 2 pe repeat nahi hote aur app ko",
        "dedupe nahi karna padta.",
        "",
        "### `isOutOfRange`",
        "",
        "Agar customer ke aas-paas **ek bhi** suggested voucher na mile, backend distance",
        "limit hata deta hai aur door wale bhej deta hai — `isOutOfRange: true` ke saath.",
        "",
        "Wajah: jis sheher me curated brands abhi pahunche hi nahi, wahan khaali tab",
        "**toota hua feature** lagta hai, geographic baat nahi.",
        "",
        "⚠️ `true` pe app ko honest hona chahiye — *\"aapke aas-paas nahi hain\"* dikhayein.",
        "",
        "**Paas me ek bhi pin mil gaya to fallback nahi chalta.** Main feed me ye kabhi",
        "nahi chalta — wo hamesha geo-honest hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Vouchers fetched successfully."),
        ...A.paged(),
        ...A.custom("har row pinned hai", [
          `pm.response.json().data.data.forEach(function (v) {`,
          `  pm.expect(v.isSuggested, "isSuggested for " + v.name).to.eql(true);`,
          `});`,
        ]),
        ...A.custom("isOutOfRange boolean hai", [
          `pm.expect(pm.response.json().data.isOutOfRange).to.be.a("boolean");`,
        ]),
        ...A.custom("out-of-range ho to distances waqai badi hain", [
          `const d = pm.response.json().data;`,
          `if (d.isOutOfRange) {`,
          `  const far = d.data.some(function (v) {`,
          `    return v.nearestOutlet && v.nearestOutlet.distance && v.nearestOutlet.distance.kilometers > 25;`,
          `  });`,
          `  pm.expect(far, "fallback laga par sab paas hi hain?").to.eql(true);`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "200 — fallback laga (aas-paas koi pin nahi tha)",
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
                bannerType: null,
                bannerUrl: null,
                nearestOutlet: {
                  distance: {
                    meters: 1753000,
                    kilometers: 1753,
                    display: "1753.0 km",
                  },
                },
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
      name: "Voucher feed — sortBy=NEWEST",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "sortBy", value: VOUCHER_SORT_BY.NEWEST },
        { key: "limit", value: "20" },
      ],
      gate: "`verifyJwtToken`",
      description:
        "`NEWEST` ka natural direction **desc** hai — `sortOrder` bhejne ki zarurat nahi.",
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("createdAt descending (suggested block ke baad)", [
          `const rows = pm.response.json().data.data.filter(function (v) { return !v.isSuggested; });`,
          `const t = rows.map(function (v) { return new Date(v.createdAt).getTime(); });`,
          `const sorted = t.slice().sort(function (a, b) { return b - a; });`,
          `pm.expect(t).to.eql(sorted);`,
        ]),
      ],
    }),

    req({
      name: "Voucher feed — RELEVANCE bina search (chup-chaap NEWEST ban jaata hai)",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "sortBy", value: VOUCHER_SORT_BY.RELEVANCE },
        { key: "limit", value: "20" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ `RELEVANCE` ko score karne ke liye search term chahiye. Bina `search` ke ye",
        "**koi error nahi** deta — chup-chaap `NEWEST` ban jaata hai aur `relevanceScore`",
        "field bhi nahi aati.",
        "",
        "Isliye `RELEVANCE` hamesha `search` ke saath hi bhejein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("relevanceScore nahi aaya (search tha hi nahi)", [
          `pm.response.json().data.data.forEach(function (v) {`,
          `  pm.expect(v).to.not.have.property("relevanceScore");`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Voucher feed — bahut door ke coordinates → 404",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "-54.8019" },
        { key: "longitude", value: "-68.3030" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "Ushuaia, Argentina — duniya ka sabse southern sheher. Yahan koi outlet nahi hoga.",
        "",
        "⚠️ **`404` ko error mat samjhein.** Naya sheher, kam vendors, ya user radius ke",
        "edge pe — teeno normal hain. Empty-state screen dikhayein.",
        "",
        "**Main feed pe koi geo fallback nahi hai** — sirf Suggestions tab pe hai.",
      ].join("\n"),
      assert: [...A.status(404), ...A.err("No any voucher found")],
    }),

    req({
      name: "Voucher feed — limit 51 → 422",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "limit", value: "51" },
      ],
      gate: "`verifyJwtToken`",
      description: "Hard cap 50 hai.",
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Voucher detail ⭐",
      method: "GET",
      segments: ["vouchers", "customer", "get", "{{voucher_id}}"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "outletId", value: "{{sub_brand_id}}", disabled: true },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "Detail screen — **saare** offers aur **saare** outlets (nearest first).",
        "",
        "`outletId` bhejein to wo `selectedOutlet` me aa jaata hai; na bhejein to nearest",
        "outlet select hota hai.",
        "",
        "⚠️ Ye bhi location-dependent hai. List se detail pe jaate waqt **wahi coordinates**",
        "bhejein jo list me bheje the, warna radius mismatch se `404` aa sakta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Voucher fetched successfully."),
        ...A.fields({
          voucherId: "string",
          name: "string",
          bannerType: "null-or-string",
          bannerUrl: "null-or-string",
          version: "object",
          outlets: "array",
          outletCount: "number",
        }),
        ...A.custom("banner pair consistent hai", [
          `const d = pm.response.json().data;`,
          `const bothNull = d.bannerType === null && d.bannerUrl === null;`,
          `const bothSet = !!d.bannerType && !!d.bannerUrl;`,
          `pm.expect(bothNull || bothSet).to.eql(true);`,
        ]),
        ...A.custom("outlets nearest-first sorted hain", [
          `const m = pm.response.json().data.outlets.map(function (o) { return o.distance ? o.distance.meters : 0; });`,
          `pm.expect(m).to.eql(m.slice().sort(function (a, b) { return a - b; }));`,
        ]),
        ...A.custom("selectedOutlet outlets me se hi hai", [
          `const d = pm.response.json().data;`,
          `if (d.selectedOutlet) {`,
          `  const ids = d.outlets.map(function (o) { return String(o.id); });`,
          `  pm.expect(ids).to.include(String(d.selectedOutlet.id));`,
          `}`,
        ]),
        ...A.custom("har offer me minBillAmount hai (UI me dikhana zaruri)", [
          `(pm.response.json().data.version.offers || []).forEach(function (o) {`,
          `  pm.expect(o.minBillAmount, "minBillAmount").to.be.a("number");`,
          `});`,
        ]),
      ],
    }),

    req({
      name: "Voucher detail — ObjectId format galat → 400",
      method: "GET",
      segments: ["vouchers", "customer", "get", "not-an-objectid"],
      token: CUST,
      gate: "`verifyJwtToken`",
      description: [
        "Joi validator pehle chalta hai, to `422` aata hai — service ka `400`",
        "*\"Invalid voucher ID.\"* tab hi dikhega jab call service ko seedhe ho.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Voucher detail — id valid par voucher nahi → 404",
      method: "GET",
      segments: ["vouchers", "customer", "get", GHOST_ID],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ **Ye `404` chaar alag cases me aata hai** aur frontend unhe distinguish nahi",
        "kar sakta:",
        "",
        "1. Voucher exist hi nahi karta",
        "2. `PUBLISHED` nahi hai",
        "3. Expire ho gaya",
        "4. Radius ke bahar hai",
        "",
        "Generic message dikhayein: *\"Ye voucher abhi available nahi hai\"*.",
      ].join("\n"),
      assert: [
        ...A.status(404),
        ...A.err("Voucher not found or currently unavailable."),
      ],
    }),

    req({
      name: "Discount preview — offer lagta hai ⭐",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: CUST,
      body: {
        voucherId: "{{voucher_id}}",
        outletId: "{{sub_brand_id}}",
        billAmount: 1200,
      },
      gate: "`verifyJwtToken`",
      description: [
        "Bill amount pe **actual** discount calculate karta hai.",
        "",
        "### `pricing` — checkout ki rows",
        "",
        "**App ko koi arithmetic nahi karni.** Backend already total kar chuka hai.",
        "",
        "| Field | Notes |",
        "|---|---|",
        "| `billAmount` | Jo user ne enter kiya |",
        "| `offerDiscount` | `selectedOffer` ka discount |",
        "| `promoDiscount` | Customer promo code ka discount — **ab live hai** |",
        "| `netBill` | `billAmount − offerDiscount`. Vendor ki supply |",
        "| `convenienceFee` | Neeche slab table. **Original bill** pe lagta hai |",
        "| `totalPayable` | `netBill − promo + fee + taxOnTop`. **Yahi charge karna hai** |",
        "| `amountInPaise` | Wahi total, integer paise me — Razorpay ko yahi jaata hai |",
        "| `youSaved` | `offerDiscount + promoDiscount` |",
        "| `vendorPayable` | Vendor ko kitna jayega. Fee isme kabhi nahi aati |",
        "| tax block | `taxType` · `cgst` · `sgst` · `igst` · `gstAmount` · `taxOnTop` · `sacCode` |",
        "",
        "> ⚠️ **Teen purane naam abhi bhi response me hain**, taaki app na toote:",
        "> `discountAmount` → `offerDiscount`, `payableAmount` → `totalPayable`,",
        "> `totalSavings` → `youSaved`. Wahi number, dono naam se. **Naye naam pe shift",
        "> kar lijiye** — purane deprecated hain aur app move hone ke baad hat jayenge.",
        "",
        "**GST abhi band hai** (`tax.isGstEnabled: false`), isliye `taxType: null` aur",
        "koi tax row print hi nahi hoti. On hone par tax **sirf convenience fee** par",
        "lagega — `netBill` vendor ki supply hai aur unka apna tax maamla.",
        "",
        "### `orderSummary` — client koi hisaab na kare",
        "",
        "Har row me `key` · `label` · `amount` · `display` chaaron hote hain, aur",
        "`display` pehle se format hai (`₹ 2,50,000.00`). Zero wali rows aati hi nahi.",
        "",
        "| key | Kab |",
        "|---|---|",
        "| `BILL_AMOUNT` | Hamesha |",
        "| `OFFER_DISCOUNT` | Offer laga ho to |",
        "| `PROMO_DISCOUNT` | Promo laga ho to |",
        "| `NET_BILL` | Koi bhi discount laga ho to |",
        "| `CONVENIENCE_FEE` | Fee > 0 ho to |",
        "| `TAX` | GST on ho **aur** tax > 0 ho to |",
        "",
        "### Convenience fee",
        "",
        `Har **₹${slabSize}** (ya uska part) pe **₹${feePerSlab}** — \`ceil(bill / ${slabSize}) × ${feePerSlab}\`.`,
        "",
        "| Bill | Fee |",
        "|---|---:|",
        ...[1, 2, 3, 4].map((n) => {
          const from = (n - 1) * slabSize + 1;
          const to = n * slabSize;
          return `| ₹${from} – ₹${to} | ₹${feeFor(to)} |`;
        }),
        `| … har agle ₹${slabSize} pe | +₹${feePerSlab} |`,
        "",
        "Fee **original bill** pe lagti hai, discount ke baad wale pe nahi — warna har",
        "offer ke saath fee badalti aur offer comparison ki har row pe alag fee dikhani padti.",
        "",
        "⚠️ Ye numbers **defaults** hain. Live values `Setting.customer.convenienceFee` se",
        "aati hain — admin badal sakta hai ya band kar sakta hai. **Client ko fee calculate",
        "nahi karni — `pricing.convenienceFee` use karein.**",
        "",
        "### `selectedOffer` kaise chunta hai",
        "",
        "1. Sabse zyada `discountAmount`",
        "2. Tie pe zyada `minBillAmount`",
        "",
        "`eligibleOffers` isi order me sorted hai, to `selectedOffer === eligibleOffers[0]`.",
        "",
        "### Discount types",
        "",
        `- \`${VOUCHER_DISCOUNT_TYPES.PERCENTAGE}\` → \`bill × value / 100\`, phir \`maxDiscountAmount\` pe cap`,
        `- \`${VOUCHER_DISCOUNT_TYPES.FLAT}\` / \`${VOUCHER_DISCOUNT_TYPES.FIXED}\` → seedha \`discountValue\``,
        "- Dono ke baad `min(discount, billAmount)`",
        "",
        "⚠️ **Ye endpoint kuch save nahi karta** — pure calculation hai. Koi redemption",
        "record nahi banta. Baar-baar call kar sakte hain.",
        "",
        "⚠️ **Location check nahi hota.** Baaki voucher endpoints radius check karte hain,",
        "ye nahi — 100 km door ke outlet ka preview bhi mil jayega. Outlet selection detail",
        "endpoint ke `outlets` list se hi karein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Voucher preview calculated successfully."),
        ...A.fields({
          billAmount: "number",
          offerApplied: "boolean",
          eligibleOffers: "array",
          pricing: "object",
        }),
        ...A.custom("pricing ki saari rows number hain", [
          `const p = pm.response.json().data.pricing;`,
          `["billAmount","offerDiscount","promoDiscount","netBill","convenienceFee","totalPayable","amountInPaise","youSaved","vendorPayable"].forEach(function (k) {`,
          `  pm.expect(p[k], k).to.be.a("number");`,
          `});`,
        ]),
        ...A.custom("totalPayable = netBill − promo + fee + taxOnTop", [
          `const p = pm.response.json().data.pricing;`,
          `const expected = Math.round((p.netBill - p.promoDiscount + p.convenienceFee + p.taxOnTop) * 100) / 100;`,
          `pm.expect(p.totalPayable).to.eql(expected);`,
          `pm.expect(p.payableAmount, "deprecated alias still echoed").to.eql(p.totalPayable);`,
        ]),
        ...A.custom("bina promoCode bheje promoDiscount 0 rehta hai", [
          `pm.expect(pm.response.json().data.pricing.promoDiscount).to.eql(0);`,
        ]),
        ...A.custom("convenience fee slab rule follow karti hai", [
          `const d = pm.response.json().data;`,
          `if (d.offerApplied && d.pricing.convenienceFee > 0) {`,
          `  const expected = Math.ceil(d.pricing.billAmount / ${slabSize}) * ${feePerSlab};`,
          `  pm.expect(d.pricing.convenienceFee, "default slabs se").to.eql(expected);`,
          `}`,
        ]),
        ...A.custom("selectedOffer hi eligibleOffers[0] hai", [
          `const d = pm.response.json().data;`,
          `if (d.offerApplied) {`,
          `  pm.expect(String(d.selectedOffer.offerId)).to.eql(String(d.eligibleOffers[0].offerId));`,
          `}`,
        ]),
        ...A.custom("eligibleOffers best-first sorted hain", [
          `const o = pm.response.json().data.eligibleOffers.map(function (x) { return x.discountAmount; });`,
          `pm.expect(o).to.eql(o.slice().sort(function (a, b) { return b - a; }));`,
        ]),
        ...A.custom("discount bill se zyada nahi ho sakta", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.pricing.offerDiscount).to.be.at.most(d.pricing.billAmount);`,
        ]),
      ],
      examples: [
        {
          name: "200 — 30% off, ₹300 cap pe",
          code: 200,
          status: "OK",
          body: ok("Voucher preview calculated successfully.", {
            voucher: { id: "{{voucher_id}}", name: "flat 30% off on total bill" },
            version: { id: "…", versionNumber: 3 },
            outlet: { id: "{{sub_brand_id}}", uniqueId: "TDS000201" },
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
              netBill: 1200 - 300,
              convenienceFee: feeFor(1200),
              totalPayable: 1200 - 300 + feeFor(1200),
              amountInPaise: (1200 - 300 + feeFor(1200)) * 100,
              youSaved: 300,
              vendorPayable: 1200 - 300,
              taxType: null,
              // Deprecated aliases, echoed so a live app keeps working.
              payableAmount: 1200 - 300 + feeFor(1200),
              totalSavings: 300,
            },
          }),
        },
        {
          name: "400 — outlet is voucher ka nahi",
          code: 400,
          status: "Bad Request",
          body: err("Selected outlet is not linked with this voucher."),
        },
        {
          name: "400 — koi PUBLISHED version nahi",
          code: 400,
          status: "Bad Request",
          body: err("Voucher is not currently available."),
        },
      ],
    }),

    req({
      name: "Discount preview — bill offer minimum se kam (200, error nahi) ⭐",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: CUST,
      body: {
        voucherId: "{{voucher_id}}",
        outletId: "{{sub_brand_id}}",
        billAmount: 1,
      },
      gate: "`verifyJwtToken`",
      description: [
        "**Ye pehle `400 \"No eligible offer found for this bill amount.\"` deta tha.**",
        "Customer ko lagta tha uska bill galat hai, jabki wo bas chhota tha.",
        "",
        "Ab `200` + `offerApplied: false`, aur customer **sirf apna bill** pay karta hai:",
        "koi offer nahi, koi promo nahi, **koi convenience fee nahi**.",
        "",
        "Do case me aisa hota hai:",
        "1. Bill har offer ke `minBillAmount` se kam hai",
        "2. Voucher version me koi offer hai hi nahi",
        "",
        "**App ka kaam:** `offerApplied === false` pe offer section chhupa dein aur seedha",
        "`pricing.totalPayable` dikhayein. Chahein to nudge dein — *\"₹500 se upar ke bill",
        "pe 30% off milega\"* — kyunki offers ka `minBillAmount` detail endpoint se pata hai.",
        "",
        "`notices[]` me wajah pehle se likhi aati hai, isliye app ko wo line banani nahi padti.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Voucher preview calculated successfully."),
        ...A.custom("offer apply nahi hua", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.offerApplied, "offerApplied").to.eql(false);`,
          `pm.expect(d.selectedOffer, "selectedOffer").to.eql(null);`,
          `pm.expect(d.eligibleOffers, "eligibleOffers").to.eql([]);`,
        ]),
        ...A.custom("koi fee aur koi discount nahi", [
          `const p = pm.response.json().data.pricing;`,
          `pm.expect(p.offerDiscount, "offerDiscount").to.eql(0);`,
          `pm.expect(p.convenienceFee, "convenienceFee").to.eql(0);`,
          `pm.expect(p.promoDiscount, "promoDiscount").to.eql(0);`,
          `pm.expect(p.youSaved, "youSaved").to.eql(0);`,
        ]),
        ...A.custom("totalPayable = bill", [
          `const p = pm.response.json().data.pricing;`,
          `pm.expect(p.totalPayable).to.eql(p.billAmount);`,
        ]),
        ...A.custom("claimable, with a notice explaining why no offer applied", [
          `const d = pm.response.json().data;`,
          `pm.expect(d.canClaim, "canClaim").to.eql(true);`,
          `pm.expect(d.notices.length, "notices").to.be.above(0);`,
        ]),
      ],
    }),

    req({
      name: "Discount preview — billAmount 0 → 422",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: CUST,
      body: {
        voucherId: "{{voucher_id}}",
        outletId: "{{sub_brand_id}}",
        billAmount: 0,
      },
      gate: "`verifyJwtToken`",
      description: [
        "Non-positive bill **ab bhi error hai** — wo malformed input hai, business case",
        "nahi. \"Koi offer nahi lagta\" wala fallback sirf valid bill pe chalta hai.",
      ].join("\n"),
      assert: [
        ...A.status(422),
        ...A.err("Bill amount must be greater than zero."),
      ],
    }),

    req({
      name: "Discount preview — outlet voucher se linked nahi → 400",
      method: "POST",
      segments: ["vouchers", "customer", "voucher", "preview"],
      token: CUST,
      body: {
        voucherId: "{{voucher_id}}",
        outletId: GHOST_ID,
        billAmount: 1000,
      },
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(400),
        ...A.err("Selected outlet is not linked with this voucher."),
      ],
    }),
  ],
);

// ===========================================================================
// 06 — Brand Profile
// ===========================================================================
const brandFolder = folder(
  "06 — Brand Profile",
  [
    "⚠️ **`GET /brands/get` customer ke liye band hai** (`isVendorOrAdmin`). Wo pipeline",
    "14 lookups karti hai aur brand ka PAN, GSTIN, bank account + IFSC aur subscription",
    "billing return karti hai.",
    "",
    "Uski jagah do dedicated endpoints hain jo **sensitive join build hi nahi karte** —",
    "to unme strip karne layak kuch bacha hi nahi. Response ko role ke hisaab se filter",
    "karna ek edit door hota leak se.",
  ].join("\n"),
  [
    req({
      name: "Brand directory ⭐",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "sortBy", value: "TOP_FIRST" },
        { key: "search", value: "", disabled: true },
        { key: "categoryId", value: "{{category_id}}", disabled: true },
      ],
      gate: "`isCustomer`",
      description: [
        "| Param | Default | Notes |",
        "|---|---|---|",
        "| `page` / `limit` | `1` / `10` | `limit` **max 50** |",
        "| `search` | – | `brandName` pe case-insensitive |",
        "| `categoryId` / `subCategoryId` | – | Filter |",
        "| `topOnly` | `false` | Top Brands tab — alag request neeche |",
        "| `sortBy` | `TOP_FIRST` | `TOP_FIRST` \\| `NEWEST` \\| `FOLLOWERS` \\| `NAME` \\| `DISTANCE` |",
        "| `sortOrder` | *preset-wise* | `asc` / `desc` |",
        "| `latitude` / `longitude` | – | **Dono saath**, warna `422` |",
        "",
        "⚠️ **Main list me curation proximity se upar hai** — `sortBy=DISTANCE` pe bhi",
        "pinned brands pehle aayenge. Purely nearest-first chahiye to pinned block ko UI",
        "me alag treat karein.",
        "",
        "Sirf `isActive` brands aate hain — deactivated pinned brand yahan nahi dikhta",
        "(admin ke view me dikhta hai taaki unpin ho sake).",
        "",
        "Ye **list card** ke liye hai. Features / showcase / outlets detail endpoint se.",
      ].join("\n"),
      capture: [["brand_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Brands fetched successfully"),
        ...A.paged(),
        ...A.fields(
          {
            _id: "string",
            brandName: "string",
            isTopBrand: "boolean",
            isVerified: "boolean",
            outletCount: "number",
          },
          { each: true },
        ),
        ...A.custom("top brands sabse upar hain", [
          `let seenPlain = false;`,
          `pm.response.json().data.data.forEach(function (b) {`,
          `  if (!b.isTopBrand) seenPlain = true;`,
          `  else pm.expect(seenPlain, "top brand after a plain one: " + b.brandName).to.eql(false);`,
          `});`,
        ]),
        ...A.custom("bina coordinates ke distance field nahi aati", [
          `pm.response.json().data.data.forEach(function (b) {`,
          `  pm.expect(b, "distanceInMeters").to.not.have.property("distanceInMeters");`,
          `});`,
        ]),
        ...A.absent(
          ["pan", "gst", "bank", "PANId", "GSTId", "BankId", "subscribedId", "merchantId"],
          { each: true },
        ),
      ],
      examples: [
        {
          name: "404 — koi match nahi",
          code: 404,
          status: "Not Found",
          body: err("No any brand found"),
        },
      ],
    }),

    req({
      name: "Top Brands tab (topOnly=true)",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "topOnly", value: "true" },
        { key: "limit", value: "10" },
      ],
      gate: "`isCustomer`",
      description: [
        "Sirf admin ke pin kiye brands, `topOrder` ascending.",
        "",
        "Is tab me **curation hi ordering hai** — `sortBy=DISTANCE` bhejne pe bhi wahi order",
        "rahega, kyunki yahan sab rows already curated hain.",
        "",
        "\"View more\" ke liye bas `topOnly` hata dein — wahi endpoint sab brands deta hai,",
        "pinned upar. Ek hi sorted set hai, to page 2 pe repeat nahi hote.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("har row pinned hai", [
          `pm.response.json().data.data.forEach(function (b) {`,
          `  pm.expect(b.isTopBrand, "isTopBrand for " + b.brandName).to.eql(true);`,
          `});`,
        ]),
      ],
      examples: [
        {
          name: "404 — admin ne abhi koi brand pin nahi kiya",
          code: 404,
          status: "Not Found",
          body: err("No any brand found"),
        },
      ],
    }),

    req({
      name: "Brand directory — coordinates ke saath (distance + DISTANCE sort)",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: CUST,
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "sortBy", value: "DISTANCE" },
        { key: "limit", value: "20" },
      ],
      gate: "`isCustomer`",
      description: [
        "Coordinates dene pe har row pe `distanceInMeters` aata hai — brand ke **sabse",
        "paas ke outlet** ki doori.",
        "",
        "⚠️ Distance **approximate** hai (equirectangular approximation). Sheher-bhar ke",
        "distances pe error ek percent se bhi kam hai. Exact distance voucher endpoints",
        "se aati hai.",
        "",
        "Bina coordinates wale outlets skip ho jaate hain. Brand ke saare outlets bina geo",
        "ke hon to `distanceInMeters` `null` aayega aur wo sort me neeche chala jayega.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.paged(),
        ...A.custom("distanceInMeters aa gaya", [
          `pm.response.json().data.data.forEach(function (b) {`,
          `  pm.expect(b, "distanceInMeters").to.have.property("distanceInMeters");`,
          `});`,
        ]),
        ...A.custom("non-curated block nearest-first sorted hai", [
          `const rows = pm.response.json().data.data.filter(function (b) { return !b.isTopBrand && b.distanceInMeters !== null; });`,
          `const d = rows.map(function (b) { return b.distanceInMeters; });`,
          `pm.expect(d).to.eql(d.slice().sort(function (a, b) { return a - b; }));`,
        ]),
      ],
    }),

    req({
      name: "Brand directory — sirf latitude → 422",
      method: "GET",
      segments: ["brands", "customer", "get-all"],
      token: CUST,
      query: [{ key: "latitude", value: "22.7533" }],
      gate: "`isCustomer`",
      description:
        "`latitude` aur `longitude` dono saath jaate hain — ek akela bhejna galti hai, chup-chaap ignore nahi hota.",
      assert: [
        ...A.status(422),
        ...A.err("latitude and longitude must be provided together"),
      ],
    }),

    req({
      name: "Brand profile ⭐",
      method: "GET",
      segments: ["brands", "customer", "get", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "**Ek call me poori profile screen** — brand + features + visible showcase preview",
        "+ outlets. Pehle teen alag calls lagti thi.",
        "",
        "Backend chaar indexed queries **parallel** me chalata hai.",
        "",
        "| Block | Notes |",
        "|---|---|",
        "| `features` | Max 10, sirf `isActive: true` |",
        "| `showcase.sections` | Sirf `isVisible: true` albums, har ek me pehle **6** media |",
        "| `outlets` | Sirf active. Koi internal field nahi |",
        "| `workHours` | Din **top-level keys** hain — koi `workingHours` wrapper nahi |",
        "",
        "`showcase` me `mediaCount` / `photoCount` / `videoCount` **poore** album ke counts",
        "hain, sirf preview ke nahi. `hasMoreMedia: true` matlab \"See all\" button dikhayein.",
        "`mediaPreviewLimit` cap batata hai — hardcode mat karein.",
        "",
        "`isVerified` `SystemVerify.status === \"APPROVED\"` se derive hota hai. `brand.isApproved`",
        "**nahi** — wo field kahin set hi nahi hoti, hamesha `false` rehti hai.",
        "",
        "Response chhota hai — typical brand ~4 KB, max plan limits pe bhi ~20 KB.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Brand details fetched successfully"),
        ...A.fields({
          _id: "string",
          brandName: "string",
          isVerified: "boolean",
          features: "array",
          showcase: "object",
          outlets: "array",
        }),
        ...A.custom("features cap 10 pe hai", [
          `pm.expect(pm.response.json().data.features.length).to.be.at.most(10);`,
        ]),
        ...A.custom("showcase preview cap respect hota hai", [
          `const s = pm.response.json().data.showcase;`,
          `pm.expect(s.mediaPreviewLimit, "mediaPreviewLimit").to.be.a("number");`,
          `(s.sections || []).forEach(function (sec) {`,
          `  pm.expect(sec.medias.length, "preview size for " + sec.title).to.be.at.most(s.mediaPreviewLimit);`,
          `  pm.expect(sec.hasMoreMedia, "hasMoreMedia for " + sec.title).to.eql(sec.mediaCount > s.mediaPreviewLimit);`,
          `});`,
        ]),
        ...A.custom("showcase media me Cloudinary internals nahi hain", [
          `(pm.response.json().data.showcase.sections || []).forEach(function (sec) {`,
          `  (sec.medias || []).forEach(function (m) {`,
          `    pm.expect(m, "storage").to.not.have.property("storage");`,
          `    pm.expect(m, "metadata").to.not.have.property("metadata");`,
          `  });`,
          `});`,
        ]),
        ...A.custom("outlets me internal fields nahi hain", [
          `(pm.response.json().data.outlets || []).forEach(function (o) {`,
          `  pm.expect(o, "userId").to.not.have.property("userId");`,
          `  pm.expect(o, "brandId").to.not.have.property("brandId");`,
          `});`,
        ]),
        ...A.absent([
          "pan",
          "gst",
          "bank",
          "PANId",
          "GSTId",
          "BankId",
          "subscribedId",
          "subscription",
          "merchantId",
          "verification",
        ]),
      ],
      examples: [
        {
          name: "404 — brand nahi mila ya inactive",
          code: 404,
          status: "Not Found",
          body: err("Brand not found"),
        },
      ],
    }),

    req({
      name: "Brand profile — unknown brand → 404",
      method: "GET",
      segments: ["brands", "customer", "get", GHOST_ID],
      token: CUST,
      gate: "`isCustomer`",
      assert: [...A.status(404), ...A.err("Brand not found")],
    }),

    req({
      name: "Full showcase gallery",
      method: "GET",
      segments: ["showcase", "get-brand-showcase", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "Poore albums — har section ke **saare** media (brand profile wale 6 ke preview",
        "ke ulta).",
        "",
        "✅ **`isVisible` filter ab lagta hai** — brand profile ke saath ek jaisa. Dono",
        "endpoints ek hi shared projection use karte hain, to chhupaya hua album kahin",
        "nahi dikhega.",
        "",
        "Media ka `isShowInVideoClips` yahan filter **nahi** karta — wo sirf reels feed ka",
        "switch hai, album me video phir bhi dikhti hai.",
        "",
        "Sections pe optional `page` / `limit` (default 50). Response me `total`, `page`,",
        "`limit`, `totalPages` bhi aate hain.",
        "",
        "Kuch na ho to **`200` + `sections: []`**. `404` sirf tab jab brand hi na mile",
        "(deleted / deactivated).",
      ].join("\n"),
      capture: [["section_id", "d.sections[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Showcase fetched successfully."),
        ...A.fields({ brandId: "string", sections: "array" }),
        ...A.custom("sections sortOrder ascending hain", [
          `const o = pm.response.json().data.sections.map(function (s) { return s.sortOrder; });`,
          `pm.expect(o).to.eql(o.slice().sort(function (a, b) { return a - b; }));`,
        ]),
        ...A.custom("media counts consistent hain", [
          `pm.response.json().data.sections.forEach(function (s) {`,
          `  pm.expect(s.mediaCount, "mediaCount for " + s.title).to.eql(s.medias.length);`,
          `  pm.expect(s.photoCount + s.videoCount, "photo+video for " + s.title).to.be.at.most(s.mediaCount);`,
          `});`,
        ]),
        ...A.custom("internal fields strip ho gaye", [
          `pm.response.json().data.sections.forEach(function (s) {`,
          `  (s.medias || []).forEach(function (m) {`,
          `    pm.expect(m).to.not.have.property("storage");`,
          `    pm.expect(m).to.not.have.property("metadata");`,
          `    pm.expect(m).to.not.have.property("isActive");`,
          `    pm.expect(m).to.not.have.property("isShowInVideoClips");`,
          `  });`,
          `});`,
        ]),
        ...A.custom("duration / resolution sirf VIDEO pe aate hain", [
          `pm.response.json().data.sections.forEach(function (s) {`,
          `  (s.medias || []).forEach(function (m) {`,
          `    if (m.type === "VIDEO") {`,
          `      pm.expect(m, "video " + m._id).to.have.property("duration");`,
          `      pm.expect(m, "video " + m._id).to.have.property("resolution");`,
          `    } else {`,
          `      pm.expect(m, "photo " + m._id).to.not.have.property("duration");`,
          `      pm.expect(m, "photo " + m._id).to.not.have.property("resolution");`,
          `    }`,
          `  });`,
          `});`,
        ]),
      ],
      examples: [
        {
          name: "200 — brand ka koi visible album nahi",
          code: 200,
          status: "OK",
          body: ok("Showcase fetched successfully.", {
            brandId: "{{brand_id}}",
            total: 0,
            page: 1,
            limit: 50,
            totalPages: 1,
            sections: [],
          }),
        },
        {
          name: "404 — brand nahi mila ya inactive",
          code: 404,
          status: "Not Found",
          body: err("Brand not found"),
        },
      ],
    }),

    req({
      name: "Video clips (reels feed)",
      method: "GET",
      segments: ["showcase", "{{brand_id}}", "video-clips"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "10" },
      ],
      gate: "`isCustomer`",
      description: [
        "Sirf wo videos jo clips feed ke liye marked hain. **Teen** flags saath chahiye:",
        "",
        "- Section: `isVisible: true` **aur** `isShowVideosInClips: true`",
        "- Media: `type: VIDEO`, `isActive`, `isShowInVideoClips: true`",
        "",
        "`isShowInVideoClips` **sirf video** ka switch hai — photo pe wo `false` store hota",
        "hai, aur feed type pe bhi filter karta hai. To yahan kabhi photo nahi aayegi,",
        "purane data me kisi photo pe `true` pada ho tab bhi.",
        "",
        "`limit` max **50**.",
        "",
        "`thumbnail` na ho to section ka `coverImage` fallback ban jaata hai. `duration`",
        "na ho to `0`.",
        "",
        "⚠️ Ye endpoint apni pagination khud banata hai (shared utility nahi) — par khaali",
        "pe phir bhi `404` deta hai, alag message ke saath. Brand hi na mile to bhi `404`,",
        "message `Brand not found`.",
      ].join("\n"),
      assert: [
        ...A.custom("200 ya 404 (dono valid hain)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
        ...A.custom("200 ho to shape sahi hai", [
          `if (pm.response.code !== 200) return;`,
          `const d = pm.response.json().data;`,
          `pm.expect(d.total, "total").to.be.a("number");`,
          `pm.expect(d.data, "data").to.be.an("array");`,
          `d.data.forEach(function (row) {`,
          `  pm.expect(row.video, "video").to.be.an("object");`,
          `  pm.expect(row.video.type, "video.type").to.eql("VIDEO");`,
          `  pm.expect(row.video.url, "video.url").to.be.a("string");`,
          `  pm.expect(row.video.duration, "video.duration").to.be.a("number");`,
          `});`,
        ]),
        ...A.custom("404 ho to message clips-specific hai", [
          `if (pm.response.code !== 404) return;`,
          `pm.expect(pm.response.json().message).to.include("No video clips found");`,
        ]),
      ],
    }),

    req({
      name: "Brand features",
      method: "GET",
      segments: ["brandFeatures", "get-all"],
      token: CUST,
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "isActive", value: "true" },
        { key: "limit", value: "10" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "⚠️ `brandId` **required** hai — bina uske `422`.",
        "",
        "Brand profile endpoint me features already aate hain, to standalone screen ke",
        "liye hi ye chahiye.",
        "",
        "`limit` max 100. `sortBy`: `title` / `createdAt` / `updatedAt` / `isActive`.",
      ].join("\n"),
      capture: [["feature_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Brand features fetched successfully"),
        ...A.paged(),
        ...A.fields({ _id: "string", title: "string" }, { each: true }),
      ],
      examples: [
        {
          name: "404 — is brand ke koi features nahi",
          code: 404,
          status: "Not Found",
          body: err("No any brand feature found"),
        },
      ],
    }),

    req({
      name: "Brand features — brandId bheje bina → 422",
      method: "GET",
      segments: ["brandFeatures", "get-all"],
      token: CUST,
      gate: "`verifyJwtToken`",
      description: [
        "Ye deliberate hai — bina `brandId` ke ye platform ke saare brands ke features",
        "de deta, jo customer ke kaam ka nahi aur unnecessary exposure hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err("Brand ID is required")],
    }),

    req({
      name: "One brand feature",
      method: "GET",
      segments: ["brandFeatures", "get", "{{feature_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Brand feature fetched successfully"),
        ...A.fields({ _id: "string", title: "string" }),
      ],
    }),
  ],
);

// ===========================================================================
// 07 — Engagement
// ===========================================================================
const engagementFolder = folder(
  "07 — Engagement",
  [
    "Follow aur Avoid — dono **toggle** hain, alag add/remove endpoints nahi. Response ka",
    "`followed` / `avoided` flag batata hai ab kya state hai.",
    "",
    "Dono transactional hain: counter (`followersCount` / `avoidanceCount`) usi transaction",
    "me update hota hai, to double-tap se counter drift nahi hota.",
    "",
    "Un-follow karne pe row **soft delete** hoti hai (`isDeleted: true`), physically hatti",
    "nahi — to dobara follow karne pe wahi row reactivate ho jaati hai.",
  ].join("\n"),
  [
    req({
      name: "Follow a brand",
      method: "POST",
      segments: ["follows", "toggle", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "Message state ke hisaab se badalta hai — `\"Brand followed successfully.\"` ya",
        "`\"Brand unfollowed successfully.\"`. Isliye `data.followed` pe bharosa karein,",
        "message pe nahi.",
        "",
        "Ye request aur agli request ek **jodi** hain — dono chalane pe state waisi hi",
        "reh jaati hai jaisi thi.",
      ].join("\n"),
      capture: [["was_followed", "d.followed"]],
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({
          brandId: "string",
          followed: "boolean",
          followersCount: "number",
        }),
        ...A.custom("message state ke saath match karta hai", [
          `const b = pm.response.json();`,
          `pm.expect(b.message).to.eql(b.data.followed ? "Brand followed successfully." : "Brand unfollowed successfully.");`,
        ]),
        ...A.custom("followersCount negative nahi ho sakta", [
          `pm.expect(pm.response.json().data.followersCount).to.be.at.least(0);`,
        ]),
      ],
    }),

    req({
      name: "Followed brands list",
      method: "GET",
      segments: ["follows", "get-all"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "sortBy", value: FOLLOW_SORT_BY.CREATED_AT },
        { key: "sortOrder", value: "desc" },
        { key: "search", value: "", disabled: true, description: "brandName ya uniqueId pe" },
      ],
      gate: "`isCustomer`",
      description: [
        "`sortBy`: `" + list(FOLLOW_SORT_BY) + "` · `limit` max 100.",
        "",
        "Deleted brands filter ho jaate hain, par **deactivated (`isActive: false`) brands",
        "list me rehte hain** — `brand.isActive` check karke UI me mark karein.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Followed brands fetched successfully."),
        ...A.paged(),
        ...A.custom("har row me brand object hai", [
          `pm.response.json().data.data.forEach(function (r) {`,
          `  pm.expect(r.brand, "brand").to.be.an("object");`,
          `  pm.expect(r.brand.brandName, "brand.brandName").to.be.a("string");`,
          `  pm.expect(r.brand.isDeleted, "deleted brand list me nahi aana chahiye").to.eql(false);`,
          `});`,
        ]),
      ],
      examples: [
        {
          name: "404 — abhi koi brand follow nahi kiya",
          code: 404,
          status: "Not Found",
          body: err("No any followed brand found"),
        },
      ],
    }),

    req({
      name: "Follow toggle dobara — state wapas (idempotent jodi)",
      method: "POST",
      segments: ["follows", "toggle", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "Pehli toggle ka ulta. Dono ke baad brand wahi state me hai jahan shuru me tha,",
        "to poori collection dobara chalane pe wahi result milta hai.",
        "",
        "**Order maayne rakhta hai** — list is request se *pehle* chalti hai, warna wo",
        "khaali hoti aur `pagination` `404` de deti.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("flag flip ho gaya", [
          `const now = pm.response.json().data.followed;`,
          `const before = pm.environment.get("was_followed") === "true";`,
          `pm.expect(now, "toggle ne flip nahi kiya").to.eql(!before);`,
        ]),
      ],
    }),

    req({
      name: "Follow — brand exist nahi karta → 404",
      method: "POST",
      segments: ["follows", "toggle", GHOST_ID],
      token: CUST,
      gate: "`isCustomer`",
      assert: [...A.status(404), ...A.err("Brand not found.")],
    }),

    req({
      name: "Avoid a brand",
      method: "POST",
      segments: ["brandAvoidances", "toggle", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description: [
        "Follow ka bilkul mirror. Counter `avoidanceCount` hai.",
        "",
        "⚠️ **Avoid abhi voucher feed ko filter nahi karta.** Flag store hota hai aur",
        "counter badhta hai, par listing pipeline usko dekhti hi nahi — avoided brand ke",
        "vouchers phir bhi feed me aayenge.",
      ].join("\n"),
      capture: [["was_avoided", "d.avoided"]],
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({
          brandId: "string",
          avoided: "boolean",
          avoidanceCount: "number",
        }),
        ...A.custom("message state ke saath match karta hai", [
          `const b = pm.response.json();`,
          `pm.expect(b.message).to.eql(b.data.avoided ? "Brand added to avoid list." : "Brand removed from avoid list.");`,
        ]),
      ],
    }),

    req({
      name: "Avoided brands list",
      method: "GET",
      segments: ["brandAvoidances", "get-all"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "sortBy", value: BRAND_AVOIDANCE_SORT_BY.CREATED_AT },
        { key: "sortOrder", value: "desc" },
      ],
      gate: "`isCustomer`",
      description: "`sortBy`: `" + list(BRAND_AVOIDANCE_SORT_BY) + "` · `limit` max 100.",
      assert: [
        ...A.status(200),
        ...A.ok("Avoided brands fetched successfully."),
        ...A.paged(),
      ],
      examples: [
        {
          name: "404 — avoid list khaali hai",
          code: 404,
          status: "Not Found",
          body: err("No any avoided brand found"),
        },
      ],
    }),

    req({
      name: "Avoid toggle dobara — state wapas",
      method: "POST",
      segments: ["brandAvoidances", "toggle", "{{brand_id}}"],
      token: CUST,
      gate: "`isCustomer`",
      description:
        "Follow wali hi jodi. List is request se pehle chalti hai, warna wo khaali milti.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("flag flip ho gaya", [
          `const now = pm.response.json().data.avoided;`,
          `const before = pm.environment.get("was_avoided") === "true";`,
          `pm.expect(now).to.eql(!before);`,
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 08 — Legal
// ===========================================================================
const legalFolder = folder(
  "08 — Legal",
  [
    "Terms & Conditions aur Privacy Policy. Reads har signed-in role ke liye khule hain.",
    "",
    "Documents me `type` field hota hai (`VENDOR` / `CUSTOMER` jaisa audience marker) —",
    "customer app ko customer wale hi dikhane chahiye.",
  ].join("\n"),
  [
    req({
      name: "All terms & conditions",
      method: "GET",
      segments: ["terms-and-conditions", "getAll"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "isActive", value: "true" },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "| Param | Notes |",
        "|---|---|",
        "| `page` / `limit` | Default `1` / `10`, koi upper cap nahi |",
        "| `search` | `title` **ya** `description` pe |",
        "| `title` | Sirf `title` pe |",
        "| `isActive` · `fromDate` · `toDate` · `sortBy` · `sortOrder` | |",
        "",
        "`description` me 50,000 chars tak markup ho sakta hai aur **lowercase nahi hota** —",
        "legal text ka case preserve rehta hai.",
      ].join("\n"),
      capture: [["legal_terms_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Terms and conditions fetched"),
        ...A.paged(),
        ...A.fields({ _id: "string", title: "string" }, { each: true }),
      ],
      examples: [
        {
          name: "404 — koi document nahi",
          code: 404,
          status: "Not Found",
          body: err("No any termandcondition found"),
        },
      ],
    }),

    req({
      name: "One term & condition",
      method: "GET",
      segments: ["terms-and-conditions", "get", "{{legal_terms_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Term and condition fetched"),
        ...A.fields({ _id: "string", title: "string" }),
      ],
    }),

    req({
      name: "All privacy policies",
      method: "GET",
      segments: ["privacy-and-policies", "getAll"],
      token: CUST,
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "isActive", value: "true" },
      ],
      gate: "`verifyJwtToken`",
      description: "Terms wala hi shape. ⚠️ Success message me typo hai — `\"Privacys and policies fetched\"`.",
      capture: [["legal_privacy_id", "d.data[0]._id"]],
      assert: [
        ...A.status(200),
        ...A.ok("Privacys and policies fetched"),
        ...A.paged(),
      ],
    }),

    req({
      name: "One privacy policy",
      method: "GET",
      segments: ["privacy-and-policies", "get", "{{legal_privacy_id}}"],
      token: CUST,
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(200),
        ...A.ok("Privacy and policy fetched"),
        ...A.fields({ _id: "string", title: "string" }),
      ],
    }),
  ],
);

// ===========================================================================
// 09 — Push Notifications
// ===========================================================================
const pushFolder = folder(
  "09 — Push Notifications",
  [
    "Poora module **role-agnostic** hai — customer ka phone bilkul waise hi register hota",
    "hai jaise vendor ka.",
    "",
    "⚠️ **Customer ke liye in-app notification feed nahi hai.** `/notifications/get-all`",
    "`isVendorOrAdmin` ke peeche hai — customer ko sirf push milega, history dekhne ka",
    "koi endpoint nahi.",
    "",
    "`push_token` environment me set karein (koi bhi 20+ char string chalegi — FCM se",
    "validate nahi hota, sirf length check hai).",
  ].join("\n"),
  [
    req({
      name: "Register this device ⭐",
      method: "POST",
      segments: ["deviceTokens", "register"],
      token: CUST,
      body: {
        token: "{{push_token}}",
        platform: DEVICE_PLATFORMS.ANDROID,
        deviceId: "{{device_id}}",
        deviceName: "Postman Runner",
        appVersion: "1.0.0",
      },
      gate: "`verifyJwtToken`",
      description: [
        "**Upsert hai, insert nahi** — login pe aur jab bhi FCM token rotate ho, safely",
        "dobara call kar sakte hain.",
        "",
        "| Field | Required | Notes |",
        "|---|---|---|",
        "| `token` | ✅ | 20–4096 chars |",
        "| `platform` | ✅ | `" + list(DEVICE_PLATFORMS) + "` — auto-uppercase |",
        "| `deviceId` | ❌ | **Bhejein.** Isse reinstall apna hi purana token retire kar deta hai |",
        "| `deviceName` · `appVersion` | ❌ | Max 128 / 32 chars |",
        "",
        "Do cheezein deliberately handle hoti hain:",
        "",
        "1. **Token kisi aur user ke naam pe tha** — shared phone, ya logout karke doosra",
        "   login. Row **reassign** hoti hai, duplicate nahi banti, taaki purane owner ko",
        "   us device pe push aana band ho jaye.",
        "2. **Wahi install naye token ke saath aaya** — `deviceId` pe match karke purani",
        "   row retire ho jaati hai, warna wo har send pe fail hoti rehti.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Device registered for push notifications"),
        ...A.fields({ device: "object", activeDevices: "number" }),
        ...A.custom("device mere naam pe register hua", [
          `const d = pm.response.json().data.device;`,
          `pm.expect(String(d.userId)).to.eql(String(pm.environment.get("customer_user_id")));`,
          `pm.expect(d.isActive).to.eql(true);`,
          `pm.expect(d.failureCount, "failureCount reset").to.eql(0);`,
        ]),
      ],
      examples: [
        {
          name: "422 — platform enum me nahi",
          code: 422,
          status: "Unprocessable Entity",
          body: err(
            `platform must be one of: ${Object.values(DEVICE_PLATFORMS).join(", ")}`,
          ),
        },
        {
          name: "422 — token bahut chhota",
          code: 422,
          status: "Unprocessable Entity",
          body: err("token does not look like a valid push token"),
        },
      ],
    }),

    req({
      name: "Register dobara — idempotent (duplicate row nahi banti)",
      method: "POST",
      segments: ["deviceTokens", "register"],
      token: CUST,
      body: {
        token: "{{push_token}}",
        platform: DEVICE_PLATFORMS.ANDROID,
        deviceId: "{{device_id}}",
        deviceName: "Postman Runner",
        appVersion: "1.0.1",
      },
      gate: "`verifyJwtToken`",
      description:
        "Wahi token, naya `appVersion`. `activeDevices` badhna **nahi** chahiye — ye upsert hai.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("appVersion update hua", [
          `pm.expect(pm.response.json().data.device.appVersion).to.eql("1.0.1");`,
        ]),
      ],
    }),

    req({
      name: "My registered devices",
      method: "GET",
      segments: ["deviceTokens", "get-mine"],
      token: CUST,
      query: [
        {
          key: "includeInactive",
          value: "false",
          description: "true karein jab push aana band ho gaya ho aur wajah dhoondhni ho",
        },
      ],
      gate: "`verifyJwtToken`",
      description: [
        "Retired devices default me chhupe rehte hain. `includeInactive=true` diagnostics",
        "ke liye — jab push aana band ho gaya ho aur wajah dhoondhni ho (`deactivatedReason`",
        "us row pe likha hota hai).",
        "",
        "### Provider token wapas nahi aata",
        "",
        "Response me `token` nahi hota, sirf **`tokenTail`** (aakhri 8 chars). Wo token ek",
        "**bearer credential** hai — jiske paas hai wo us device pe push bhej sakta hai —",
        "isliye wo server-side hi rehta hai. Tail itna hai ki client apni row pehchaan le.",
        "",
        "`userId` bhi project out hai: list already caller ki hi hai, to usko dobara",
        "bhejne ka koi matlab nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Registered devices fetched successfully"),
        ...A.fields({
          devices: "array",
          activeDevices: "number",
          total: "number",
        }),
        ...A.custom("provider token kabhi wapas nahi aata", [
          `pm.response.json().data.devices.forEach(function (r) {`,
          `  pm.expect(r, "token").to.not.have.property("token");`,
          `  pm.expect(r.tokenTail, "tokenTail").to.be.a("string");`,
          `});`,
        ]),
        ...A.custom("abhi register kiya device list me hai", [
          `const tail = "…" + String(pm.environment.get("push_token")).slice(-8);`,
          `const tails = pm.response.json().data.devices.map(function (r) { return r.tokenTail; });`,
          `pm.expect(tails).to.include(tail);`,
        ]),
      ],
    }),

    req({
      name: "Send myself a test push",
      method: "POST",
      segments: ["deviceTokens", "test"],
      token: CUST,
      body: {
        title: "Trydood test",
        body: "Postman se bheja gaya test push.",
      },
      gate: "`verifyJwtToken`",
      description: [
        "Sirf **caller ke apne** devices pe jaata hai — kisi aur ko bhejne ka koi tareeka",
        "nahi hai.",
        "",
        "`title` aur `body` dono optional hain; na dein to defaults use hote hain.",
        "",
        "⚠️ **Ye ek live Firebase call hai.** Jis environment me FCM credentials configure",
        "nahi hain (ya scratch/staging project galat hai), wahan ye `422` dega —",
        "*\"Push credentials were rejected by the provider\"*. Wo **is endpoint ka bug nahi**",
        "hai; device registration phir bhi theek se hui hai.",
        "",
        "Isliye neeche ka test dono outcomes accept karta hai, aur credentials wale case",
        "ko alag se call out karta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("200, ya provider-credential failure (dono acceptable)", [
          `const b = pm.response.json();`,
          `if (pm.response.code === 200) {`,
          `  pm.expect(b.success).to.eql(true);`,
          `  pm.expect(b.message).to.eql("Test push dispatched");`,
          `} else {`,
          `  pm.expect(b.success, "koi aur failure").to.eql(false);`,
          `  pm.expect(`,
          `    /credential|provider|firebase|fcm/i.test(String(b.message)),`,
          `    "unexpected failure: " + b.message`,
          `  ).to.eql(true);`,
          `  console.log("ℹ️  push provider is not configured here — endpoint itself is fine");`,
          `}`,
        ]),
      ],
      examples: [
        {
          name: "422 — is environment me FCM configure nahi hai",
          code: 422,
          status: "Unprocessable Entity",
          body: err("Push credentials were rejected by the provider."),
        },
      ],
    }),

    req({
      name: "Unregister this device",
      method: "PUT",
      segments: ["deviceTokens", "unregister"],
      token: CUST,
      body: { token: "{{push_token}}" },
      gate: "`verifyJwtToken`",
      description: [
        "Logout pe call karein.",
        "",
        "`{ \"allDevices\": true }` bhejein to *sign out everywhere* — saare devices retire.",
        "",
        "Filter hamesha `userId` carry karta hai, to kisi aur ka device unregister nahi",
        "kiya ja sakta.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok("Device unregistered from push notifications"),
      ],
    }),

    req({
      name: "Unregister — na token na allDevices → 422",
      method: "PUT",
      segments: ["deviceTokens", "unregister"],
      token: CUST,
      body: {},
      gate: "`verifyJwtToken`",
      description:
        "Khaali body accidentally *sab kuch* unregister kar deti, isliye do me se ek dena zaruri hai.",
      assert: [
        ...A.status(422),
        ...A.err("Provide a token, or set allDevices to true."),
      ],
    }),
  ],
);

// ===========================================================================
// 10 — Access control
// ===========================================================================
// ===========================================================================
// 10 — Guest (no token at all)
// ===========================================================================
//
// Built from the route table rather than a hand-kept list: `guestGet` asserts
// that the endpoint really is reachable without a token, so if someone puts a
// gate back on one of these the test fails here instead of in the app.
const guestGet = ({ name, segments, query, description, assert = [] }) =>
  req({
    // Prefixed because several of these exercise the same endpoint as a
    // signed-in request elsewhere, and example capture keys on the request
    // name — `lib/assertUniqueNames.js` refuses the collection otherwise.
    name: `Guest — ${name}`,
    method: "GET",
    segments,
    query,
    // No `token` — this is the whole point of the folder.
    description,
    assert: [
      ...A.custom("guest ke liye khula hai (401/403 nahi)", [
        `pm.expect([401, 403], "auth gate wapas lag gaya?").to.not.include(pm.response.code);`,
      ]),
      ...assert,
    ],
  });

const guestFolder = folder(
  "10 — Guest (bina token)",
  [
    "App store ki requirement hai ki user **sign-up se pehle** app dekh sake, isliye",
    "browse endpoints se auth hata di gayi hai. Ye folder unhe bina kisi token ke chalata",
    "hai — har request ka pass hona matlab guest flow zinda hai.",
    "",
    "### Do tarah ke \"khula\" hai",
    "",
    "| Gate | Matlab |",
    "|---|---|",
    "| **Public** | Token dekha hi nahi jaata. Response sabke liye ek jaisa |",
    "| **`optionalAuth`** | Token ho to decode hota hai aur response personalise hota hai; na ho to guest. **Galat token phir bhi reject hota hai** — expired token ko chup-chaap guest bana dena user ko galat feed dikha deta aur usse dobara login karne ko kabhi kehta hi nahi |",
    "",
    "### ⚠️ Guest ko coordinates khud bhejne padte hain",
    "",
    "Voucher feed signed-in user ke liye uske **saved address** pe gir jaata hai. Guest ka",
    "koi saved address nahi hota, to usse `latitude` + `longitude` bhejne padte hain —",
    "warna saaf `400` aata hai, `404 \"Customer not found.\"` nahi.",
    "",
    "> 🔴 **Ye pehle toota hua tha.** Auth hatane par `req.userId` set hona band ho gaya,",
    "> aur service pehle hi step me `Customer` dhoondhti thi — to feed **har** user ke liye",
    "> `404` deta tha, guest aur signed-in dono. `optionalAuth` gate aur guest-tolerant",
    "> service ne 2026-08-27 ko ise theek kiya.",
  ].join("\n"),
  [
    guestGet({
      name: "Voucher feed ⭐ (coordinates ke saath)",
      segments: ["vouchers", "customer", "get-all"],
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
        { key: "limit", value: "5" },
      ],
      description:
        "Guest ka main screen. Signed-in feed jaisa hi data — bas personalisation nahi (saved address, aur aage chalke favourites).",
      assert: [
        ...A.status(200),
        ...A.ok("Vouchers fetched successfully."),
        ...A.paged(),
      ],
    }),

    guestGet({
      name: "Voucher feed — bina coordinates → 400",
      segments: ["vouchers", "customer", "get-all"],
      query: [{ key: "limit", value: "5" }],
      description: [
        "Guest ke paas saved address nahi hota, to coordinates mandatory hain.",
        "",
        "Message deliberately batata hai ki **dono** raaste kya hain — coordinates bhejo,",
        "ya address save karo — kyunki caller signed-in bhi ho sakta hai jiska address",
        "abhi set nahi hua.",
      ].join("\n"),
      assert: [
        ...A.status(400),
        ...A.err("Location is required."),
      ],
    }),

    req({
      name: "Guest — Voucher feed, galat token → 403 (guest nahi banta)",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
      ],
      headers: [{ key: "Authorization", value: "Bearer not.a.real.jwt" }],
      description: [
        "`optionalAuth` ka **ek token bheja to wo valid hona chahiye** wala hissa.",
        "",
        "Isse chup-chaap guest bana dena zyada 'friendly' lagta hai, par tab expired-token",
        "wale user ko anonymous feed dikhta rehta aur app usse kabhi dobara login karne ko",
        "nahi kehti. Isliye bheja hua token galat ho to wahi error aata hai jo har doosre",
        "gate pe aata.",
      ].join("\n"),
      assert: [
        ...A.status(403),
        ...A.err("Invalid or malformed token. Please log in again."),
      ],
    }),

    guestGet({
      name: "Brand directory",
      segments: ["brands", "customer", "get-all"],
      query: [{ key: "limit", value: "5" }],
      assert: [...A.status(200), ...A.paged()],
    }),

    guestGet({
      name: "Brand profile",
      segments: ["brands", "customer", "get", "{{brand_id}}"],
      description:
        "Poora profile screen — brand + features + visible showcase + outlets, ek call me.",
      assert: [...A.status(200), ...A.ok("Brand details fetched successfully")],
    }),

    guestGet({
      name: "Brand showcase (gallery)",
      segments: ["showcase", "get-brand-showcase", "{{brand_id}}"],
      assert: [...A.status(200), ...A.ok("Showcase fetched successfully.")],
    }),

    guestGet({
      name: "Video clips (reels)",
      segments: ["showcase", "{{brand_id}}", "video-clips"],
      query: [{ key: "limit", value: "5" }],
      assert: [
        ...A.custom("200 ya 404 (koi clip-eligible video nahi)", [
          `pm.expect([200, 404]).to.include(pm.response.code);`,
        ]),
      ],
    }),

    guestGet({
      name: "Brand features",
      segments: ["brandFeatures", "get-all"],
      query: [
        { key: "brandId", value: "{{brand_id}}" },
        { key: "limit", value: "20" },
      ],
      assert: [...A.status(200), ...A.paged()],
    }),

    guestGet({
      name: "Categories",
      segments: ["categories", "getAll"],
      query: [{ key: "limit", value: "20" }],
      assert: [...A.status(200), ...A.paged()],
    }),

    guestGet({
      name: "Sub-categories",
      segments: ["subCategories", "getAll"],
      query: [{ key: "limit", value: "20" }],
      assert: [...A.status(200), ...A.paged()],
    }),

    guestGet({
      name: "Home banner",
      segments: ["banners", "customer", "active"],
      description:
        "Ek hi banner aata hai (ya `null`). Dated banner pehle, warna undated fallback.",
      assert: [...A.status(200)],
    }),

    guestGet({
      name: "Promotional tickers",
      segments: ["promotionalTickers", "customer", "active"],
      assert: [...A.status(200), ...A.ok("Active promotional tickers fetched successfully.")],
    }),

    guestGet({
      name: "Terms & conditions",
      segments: ["terms-and-conditions", "getAll"],
      query: [{ key: "limit", value: "10" }],
      description:
        "Sign-up screen pe consent link ke liye — isiliye ye login se pehle khula hona zaruri hai.",
      assert: [...A.status(200), ...A.paged()],
    }),

    guestGet({
      name: "Privacy policy",
      segments: ["privacy-and-policies", "getAll"],
      query: [{ key: "limit", value: "10" }],
      assert: [...A.status(200), ...A.paged()],
    }),
  ],
);

// ===========================================================================
// 11 — Access control
// ===========================================================================
const gateFolder = folder(
  "11 — Access control (customer token refuse hona chahiye)",
  [
    "Ye folder **negative tests** ka hai — har request ka pass hona matlab gate kaam kar",
    "raha hai. Sab customer ke apne token se chalti hain, koi extra setup nahi chahiye.",
    "",
    "Pehle in me se zyadatar `200` deti thi: 149 me se 35 endpoints bilkul ungated the.",
    "",
    "| Status | Kab |",
    "|---|---|",
    "| `401` | Token hai hi nahi, ya expire ho gaya |",
    "| `403` | Token malformed hai, ya role allowed nahi |",
  ].join("\n"),
  [
    req({
      name: "Bina token — 401",
      method: "GET",
      segments: ["users", "get"],
      gate: "`verifyJwtToken`",
      assert: [
        ...A.status(401),
        ...A.err("Access Denied! Missing authorization token"),
      ],
    }),

    req({
      name: "Garbage token — 403",
      method: "GET",
      segments: ["vouchers", "customer", "get-all"],
      query: [
        { key: "latitude", value: "22.7533" },
        { key: "longitude", value: "75.8937" },
      ],
      // Set as a raw header rather than through `auth`, because the point is to
      // send something that is not a valid JWT at all.
      headers: [
        { key: "Authorization", value: "Bearer not.a.real.jwt" },
      ],
      gate: "`verifyJwtToken`",
      description:
        "Malformed JWT `403` deta hai, `401` nahi — `401` sirf missing ya expired ke liye hai.",
      assert: [
        ...A.status(403),
        ...A.err("Invalid or malformed token. Please log in again."),
      ],
      examples: [
        {
          name: "401 — token expire ho gaya",
          code: 401,
          status: "Unauthorized",
          body: err("Your session has expired. Please log in again."),
        },
      ],
    }),

    ...[
      {
        name: "Vendor/admin brand data",
        method: "GET",
        segments: ["brands", "get"],
        why: "Yahi wo endpoint hai jisme PAN / GSTIN / bank account jaate the. Ab `isVendorOrAdmin`.",
      },
      {
        name: "Saari platform locations",
        method: "GET",
        segments: ["locations", "getAll"],
        why: "Pehle koi bhi signed-in user platform ke **saare** addresses nikal sakta tha, customers ke ghar included.",
      },
      {
        name: "Showcase section banana",
        method: "POST",
        segments: ["showcase", "section", "add"],
        why: "Pehle customer ke token se kisi bhi brand ki gallery edit ho sakti thi.",
        body: { title: "should not work" },
      },
      {
        name: "Admin voucher suggestions",
        method: "GET",
        segments: ["vouchers", "admin", "suggestions"],
        why: "Curation admin ka kaam hai.",
      },
      {
        name: "Admin top brands",
        method: "GET",
        segments: ["brands", "admin", "top-brands"],
        why: "Curation admin ka kaam hai.",
      },
      {
        name: "Platform settings",
        method: "GET",
        segments: ["settings", "get"],
        why: "Convenience fee slabs, voucher radius — sab yahin se aate hain.",
      },
      {
        name: "Notification feed",
        method: "GET",
        segments: ["notifications", "get-all"],
        why: "`isVendorOrAdmin`. Customer ke liye in-app feed abhi hai hi nahi.",
      },
      {
        name: "App banners CRUD",
        method: "GET",
        segments: ["banners", "get-all"],
        why: "Customer ke liye sirf `/banners/customer/active` hai.",
      },
    ].map((c) =>
      req({
        name: `${c.name} → 403`,
        method: c.method,
        segments: c.segments,
        token: CUST,
        ...(c.body ? { body: c.body } : {}),
        gate: "Customer ke liye **band**",
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
  locationFolder,
  masterDataFolder,
  homeFolder,
  voucherFolder,
  brandFolder,
  engagementFolder,
  legalFolder,
  pushFolder,
  guestFolder,
  gateFolder,
];

const stats = countTree(items);

const collection = {
  info: {
    _postman_id: "b41d7e60-9a2c-4f18-8d33-trydood-customer",
    name: "Trydood — Customer Mobile App",
    description: [
      "# Customer Mobile App API",
      "",
      `Customer app ke **35 endpoints**, ${stats.requests} requests me — happy paths,`,
      "behaviour-changing edge cases, aur access-control negative tests.",
      "",
      "Companion doc: `docs/customer_mobile_api_doc.md`",
      "",
      "---",
      "",
      "## Shuru kaise karein",
      "",
      "1. `environments/customer-*.postman_environment.json` import karein aur top-right",
      "   se **select** karein.",
      "2. Sirf **`customer_whatsapp`** bharein. Baaki sab `00 — Setup & Auth` se aage",
      "   apne aap bharta jaata hai.",
      "3. Poora collection **Collection Runner** me chalayein, ya folder-wise. Order",
      "   matter karta hai — baad wale folders pehle wale ke capture kiye ids use karte hain.",
      "",
      "```bash",
      "# CLI se",
      "newman run postman/trydood-customer.postman_collection.json \\",
      "  -e postman/environments/customer-local.postman_environment.json",
      "```",
      "",
      "## Ye collection kaise likhi gayi hai",
      "",
      "- **Happy path aur behaviour badalne wale edge cases alag requests hain** — poora",
      "  folder runnable hai aur waqai API test karta hai, sirf document nahi karta.",
      "- **Per-field Joi rejections saved examples hain**, jo unhi requests pe lage hain",
      "  jinse wo belong karte hain.",
      `- **Har request pe assertions hain** — total ${stats.tests} \`pm.test\` blocks.`,
      "  Status, response envelope, aur documented field shape.",
      "",
      "## Fixture kya chahiye",
      "",
      "Ek chalta hua environment jisme:",
      "",
      "| Chahiye | Kis liye |",
      "|---|---|",
      "| Kam se kam ek category + sub-category | `03` |",
      "| Ek active banner aur ticker | `04` (na ho to bhi 200 aayega) |",
      "| Ek PUBLISHED voucher, active outlet ke saath, Indore ke paas | `05` |",
      "| Ek active brand, showcase + features ke saath | `06`, `07` |",
      "| Ek terms aur ek privacy document | `08` |",
      "",
      "Fixture na ho to un folders me `404` aayega — jo empty state hai, bug nahi.",
      "",
      "## Dhyan rakhne layak",
      "",
      "- **List endpoints khaali pe `404` dete hain**, empty array nahi — shared",
      "  `pagination` utility throw karti hai. Isko empty state samajhein.",
      "  Do exceptions: `/banners/customer/active` (`null` deta hai) aur",
      "  `/promotionalTickers/customer/active` (`[]` deta hai).",
      "- **`coordinates` `[longitude, latitude]`** order me hain — Maps APIs se ulta.",
      "- **WhatsApp OTP abhi verify nahi hota** (deliberate, deferred) — koi bhi 6-digit chalega.",
      "- **`DELETE /users/delete` kuch nahi karta** — folder `01` dekhein.",
      "- **Convenience fee client-side calculate mat karein** — `pricing.convenienceFee` use karein.",
      "",
      "## Regenerate",
      "",
      "```bash",
      "node postman/generate-customer-collection.js",
      "```",
      "",
      "**JSON hand-edit mat karein** — enums aur limits `constants/` se seedhe padhe jaate",
      "hain, to hand-edit karne se collection API ke baare me jhooth bolna shuru kar deti hai.",
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
          '// Har run pe ek naya push token, taaki register/unregister ek doosre se na takrayein.',
          'if (!pm.environment.get("push_token")) {',
          '  pm.environment.set("push_token", "postman-" + pm.variables.replaceIn("{{$guid}}") + "-fcm-token");',
          "}",
          'if (!pm.environment.get("device_id")) {',
          '  pm.environment.set("device_id", "postman-" + pm.variables.replaceIn("{{$guid}}"));',
          "}",
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------- env
const envFile = (name, baseUrl) => ({
  id: `trydood-customer-${name}`,
  name: `Trydood Customer — ${name}`,
  values: [
    { key: "base_url", value: baseUrl, type: "default", enabled: true },

    // ── fill this in ──
    { key: "customer_whatsapp", value: "9876543210", type: "default", enabled: true },
    { key: "otp", value: "000000", type: "default", enabled: true },

    // ── captured automatically ──
    { key: "customer_token", value: "", type: "secret", enabled: true },
    { key: "customer_user_id", value: "", type: "default", enabled: true },
    { key: "customer_id", value: "", type: "default", enabled: true },
    { key: "location_id", value: "", type: "default", enabled: true },
    { key: "category_id", value: "", type: "default", enabled: true },
    { key: "sub_category_id", value: "", type: "default", enabled: true },
    { key: "voucher_id", value: "", type: "default", enabled: true },
    { key: "sub_brand_id", value: "", type: "default", enabled: true },
    { key: "brand_id", value: "", type: "default", enabled: true },
    { key: "section_id", value: "", type: "default", enabled: true },
    { key: "feature_id", value: "", type: "default", enabled: true },
    { key: "legal_terms_id", value: "", type: "default", enabled: true },
    { key: "legal_privacy_id", value: "", type: "default", enabled: true },

    // ── generated per run by the pre-request script ──
    { key: "push_token", value: "", type: "default", enabled: true },
    { key: "device_id", value: "", type: "default", enabled: true },

    // ── assertion scratch ──
    { key: "is_first", value: "", type: "default", enabled: true },
    { key: "was_followed", value: "", type: "default", enabled: true },
    { key: "was_avoided", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

// ---------------------------------------------------------------- write
fs.mkdirSync(ENV_DIR, { recursive: true });

const files = [
  ["trydood-customer.postman_collection.json", collection],
  [
    "environments/customer-local.postman_environment.json",
    envFile("local", "http://localhost:8080/trydood/v1"),
  ],
  [
    "environments/customer-staging.postman_environment.json",
    envFile("staging", "https://backend2-0-4v4i.onrender.com/trydood/v1"),
  ],
  [
    "environments/customer-production.postman_environment.json",
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
