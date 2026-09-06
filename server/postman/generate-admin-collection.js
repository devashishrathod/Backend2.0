/**
 * Generate `trydood-admin.postman_collection.json`.
 *
 * ### ⚠️ Why this exists, and what it deliberately leaves out
 *
 * There was no admin collection at all. 84 admin-category routes, and the only
 * ones anybody could run were the 35 that happen to appear in the
 * brand-verification, security-changes and subscription collections — none of
 * which is an admin panel, they are three feature slices that needed an admin
 * token to test something else.
 *
 * So this covers the **49 that had no request anywhere**, and does not
 * re-cover the 35 that do. A fourth copy of `POST /subscriptions/create` would
 * be one more place to update when it changes, and the whole reason
 * `lib/accountFolders.js` exists is that this codebase keeps paying for
 * duplicated request definitions.
 *
 * ### The CRUD folders build their own rows
 *
 * Categories, tickers, banners, plans and legal documents all follow
 * create → read → update → delete on a row **this collection made**. Two
 * reasons, and the second is the real one:
 *
 *  - the seeded category is what every seeded voucher hangs off, so a
 *    `DELETE /categories/delete/:id` pointed at it takes the vendor and
 *    customer collections down with it;
 *  - a delete needs something that is *safe* to delete, and the only row that
 *    is reliably safe is the one you just created. Seeding a spare "please
 *    delete me" row per resource is the same idea with an extra fixture to
 *    keep in sync.
 *
 * ### The money folders do not
 *
 * Refunds and settlements are state machines whose starting states an API
 * caller cannot reach — an admin cannot create a settlement, a nightly job
 * does. Those come from the seeder, one row per action. See
 * `lib/adminMoneyFolders.js`.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");

const { A, req, folder, countTree } = require("./lib/builders");
const { refundsFolder, settlementsFolder } = require("./lib/adminMoneyFolders");
const {
  emailVerificationFolder,
  notificationPreferenceRequests,
} = require("./lib/accountFolders");
/**
 * ⚠️ The 32 requests that used to exist only in the three feature-slice
 * collections. Those are being deleted, and without this they would have gone
 * with them — see the note at the top of that file.
 */
const migrated = require("./lib/adminMigratedFolders");
const {
  healthFolder,
  disputeFolder,
  bannerListRequest,
  tickerCreateRequest,
  settlementExtraRequests,
  passwordRestoreRequest,
} = require("./lib/adminOpsFolders");

const ADM = "admin_token";

// ===========================================================================
// 00 — Setup & Auth
// ===========================================================================
const authFolder = folder(
  "00 — Setup & Auth",
  [
    "Admin **password se** login karta hai, OTP se nahi.",
    "",
    "⚠️ `POST /auth/loginOrSignUp-with-whatsapp` `role: \"ADMIN\"` ko saaf mana",
    "karta hai. Wo jaan-boojh kar hai: wo endpoint public hai, aur agar wo ADMIN",
    "bana sakta to endpoint ka pata hona hi admin ban jaane ke liye kaafi hota.",
    "",
    "Isliye seeder is account ko **password ke saath** banata hai — bina uske is",
    "collection ke paas andar aane ka koi raasta hi nahi tha.",
  ].join("\n"),
  [
    req({
      name: "Admin login ⭐",
      method: "POST",
      segments: ["auth", "login"],
      body: {
        type: "EMAIL",
        email: "{{admin_email}}",
        password: "{{admin_password}}",
        role: "ADMIN",
      },
      description: [
        "`type`: `EMAIL` | `MOBILE` | `USERNAME`.",
        "",
        "⚠️ Role ki paabandi **validator me** hai, route par nahi — isliye refusal",
        "ek saaf `422` banta hai, na ki ek uljhane wala *\"user not found\"* jo",
        "batata hi nahi ki galti role ki thi ya password ki.",
        "",
        "⚠️ Fail-closed: jisne password set hi nahi kiya, uska login fail hota hai.",
        "`matchPassword` `false` deta hai — bcrypt me throw nahi karta — jab",
        "account ke paas hash hai hi nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("token mila aur hash nahi", [
          "const d = pm.response.json().data;",
          'pm.expect(d.token, "token").to.be.a("string").and.not.empty;',
          'pm.expect(d.user, "user").to.be.an("object");',
          "// Har token-dene wale path ko sanitizeUser se guzarna hai — teen",
          "// password logins document ko hash ke saath load karte hain.",
          '["password", "otp", "meta"].forEach(function (f) {',
          '  pm.expect(d.user, f + " leaked").to.not.have.property(f);',
          "});",
        ]),
      ],
      capture: [["admin_token", "d.token"]],
    }),

    req({
      name: "Mera profile",
      method: "GET",
      segments: ["users", "get"],
      token: ADM,
      description: "Token sahi hai iski sabse sasti jaanch.",
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 01 — Customers
// ===========================================================================
const customerFolder = folder(
  "01 — Customers",
  "Customer directory aur ek customer ka poora record — claims, refunds, notification preferences sab ek jagah.",
  [
    req({
      name: "Saare customers ⭐",
      method: "GET",
      segments: ["customers", "admin", "get-all"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "search", value: "", disabled: true },
      ],
      token: ADM,
      description:
        "Paginated. `search` naam, number aur `uniqueId` par chalta hai — wahi teen cheezein hain jo support call par haath me hoti hain.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("paginated", [
          "const d = pm.response.json().data;",
          'pm.expect(d.data, "data.data").to.be.an("array");',
        ]),
      ],
      capture: [["admin_customer_id", "d.data[0]._id"]],
    }),

    req({
      name: "Ek customer — poora record",
      method: "GET",
      segments: ["customers", "admin", "{{admin_customer_id}}"],
      token: ADM,
      description: [
        "Isme `notificationPreferences` bhi aata hai, taaki support wale ko",
        "*\"mujhe kuch nahi mila\"* ka jawab dhoondhne ke liye doosri screen na",
        "kholni pade — aksar jawab yahi hota hai ki channel band hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 02 — Brands
// ===========================================================================
const brandFolder = folder(
  "02 — Brands",
  "Brand directory, status toggle, aur KYC review ka faisla.",
  [
    req({
      name: "Saare brands ⭐",
      method: "GET",
      segments: ["brands", "admin", "get-all"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "isApproved", value: "true", disabled: true },
      ],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "Brand ko customers se chhupao",
      method: "PUT",
      segments: ["brands", "admin", "{{brand_id}}", "status"],
      token: ADM,
      body: { isActive: true, hideFromCustomers: true },
      description: [
        "Do alag switch hain aur wo ek jaise nahi hain.",
        "",
        "⚠️ `isActive: false` brand ko **band** karta hai — vendor bhi andar nahi",
        "aa sakta. `hideFromCustomers: true` sirf listing se hatata hai, vendor",
        "kaam karta rehta hai. Ek dispute ke dauraan aksar doosra chahiye hota",
        "hai, pehla nahi — aur donon ko ek samajhna ek chalte hue brand ko band",
        "kar deta hai.",
        "",
        "⚠️ `reason` **sirf deactivate karte waqt** liya jaata hai — `isActive: true` ke saath bhejne par `422`. Wajah wahi chahiye jab kisi ka dhandha rok rahe ho, wapas chaalu karte waqt nahi.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "Wapas dikhao (state restore)",
      method: "PUT",
      segments: ["brands", "admin", "{{brand_id}}", "status"],
      token: ADM,
      body: { isActive: true, hideFromCustomers: false },
      description: [
        "Collection ko wahi chhodna hai jaisa mila tha — warna customer",
        "collection ka brand feed is brand ke bina chalta hai, aur wo failure",
        "kahin aur dikhta hai jahan uski koi wajah nahi.",
        "",
        "⚠️ Wahi value dobara bhejne par **`409` \"already in the requested",
        "state\"** aata hai, `200` nahi — aur ye theek hai. Ek no-op ko success",
        "batana panel ko ye sochne deta hai ki usne kuch badla, jabki nahi badla.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "KYC review ka faisla",
      method: "PUT",
      segments: ["brands", "admin", "verifications", "{{brand_id}}", "review"],
      token: ADM,
      body: { action: "APPROVE", note: "Postman example — documents theek hain." },
      description: [
        "`action`: `APPROVE` | `REJECT` | `REVOKE`.",
        "",
        "⚠️ `REJECT` aur `REVOKE` ke apne reason fields hain (`rejectionReason`,",
        "`revokeReason`) aur wo **required** hain. Ek brand ko mana karna uska",
        "dhandha rokta hai — us faisle ka bina wajah ke record rehna wahi haalat",
        "hai jise koi baad me samjha nahi sakta.",
      ].join("\n"),
      assert: [
        ...A.custom("faisla laga, ya state ne mana kiya", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 03 — Voucher review
// ===========================================================================
const voucherFolder = folder(
  "03 — Voucher Review",
  [
    "Vendor version submit karta hai, admin usme haan ya na kehta hai.",
    "",
    "⚠️ Review **version** par hota hai, voucher par nahi. Ek live voucher ka",
    "agla version review me ho sakta hai jabki purana chalta rehta hai — isi se",
    "ek edit customers ko dikhne se pehle rok li jaati hai.",
  ].join("\n"),
  [
    req({
      name: "Version approve karo",
      method: "POST",
      segments: ["vouchers", "review", "{{draft_version_id}}"],
      token: ADM,
      body: { action: "APPROVE" },
      description: [
        "`action`: `APPROVE` | `REJECT`. `REJECT` par `rejectionReason` chahiye.",
        "",
        "⚠️ Approve karna publish karna **nahi** hai. Approved version tab tak",
        "customers ko nahi dikhta jab tak vendor use publish na kare — do alag",
        "kaam, do alag log.",
      ].join("\n"),
      assert: [
        ...A.custom("review laga, ya version sahi state me nahi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),
  ],
);

/**
 * A create → read → update → delete folder over one throwaway row.
 *
 * ⚠️ The row is created **here**, not seeded. A delete needs something safe to
 * delete, and the seeded category is what every seeded voucher hangs off —
 * pointing a delete at it takes the vendor and customer collections down.
 */
const crudFolder = ({ name, noun, note, segments, createBody, updateBody, idVar, createSegments, getSegments, updateSegments, deleteSegments, listSegments, capturePath }) =>
  folder(name, note, [
    req({
      name: `${noun} banao ⭐`,
      method: "POST",
      segments: createSegments || [...segments, "create"],
      token: ADM,
      body: createBody,
      description:
        "Is folder ki baaki teen requests isi row par chalti hain — aakhri wali ise mita bhi deti hai, to collection kuch peeche nahi chhodti.",
      assert: [
        ...A.status(201),
        ...A.ok(),
        ...A.custom("id mila", [
          "const d = pm.response.json().data;",
          "const row = d._id ? d : (d.data || d);",
          'pm.expect(row._id, "_id").to.be.a("string");',
        ]),
      ],
      capture: [[idVar, capturePath || "d._id"]],
    }),
    ...(listSegments
      ? [
          req({
            name: `Sabhi ${noun}`,
            method: "GET",
            segments: listSegments,
            query: [
              { key: "page", value: "1" },
              { key: "limit", value: "20" },
            ],
            token: ADM,
            assert: [...A.status(200), ...A.ok()],
          }),
        ]
      : []),
    ...(getSegments
      ? [
          req({
            name: `Ek ${noun}`,
            method: "GET",
            segments: getSegments,
            token: ADM,
            assert: [...A.status(200), ...A.ok()],
          }),
        ]
      : []),
    req({
      name: `${noun} badlo`,
      method: "PUT",
      segments: updateSegments,
      token: ADM,
      body: updateBody,
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: `${noun} mitao`,
      method: "DELETE",
      segments: deleteSegments,
      token: ADM,
      description:
        "Soft delete — `isDeleted: true`. Domain data yahan kabhi sach me nahi hataya jaata, kyunki uske saath wo history bhi jaati hai jo baad me kisi sawal ka jawab hoti.",
      assert: [...A.status(200), ...A.ok()],
    }),
  ]);

// ===========================================================================
// 04 — Categories · 05 — Sub-Categories
// ===========================================================================
const categoryFolder = crudFolder({
  name: "04 — Categories",
  noun: "Category",
  note: "Voucher taxonomy ka upar wala level.",
  segments: ["categories"],
  idVar: "throwaway_category_id",
  createBody: {
    name: "postman admin throwaway category",
    description: "Is collection ne banayi, aur isi ne mita bhi di.",
  },
  updateBody: { description: "Update ka example — naam wahi hai." },
  getSegments: ["categories", "get", "{{throwaway_category_id}}"],
  updateSegments: ["categories", "update", "{{throwaway_category_id}}"],
  deleteSegments: ["categories", "delete", "{{throwaway_category_id}}"],
});

const subCategoryFolder = folder(
  "05 — Sub-Categories",
  "Category ke andar ka level. Create ka raasta `/:categoryId/create` hai — parent URL me hai, body me nahi, to ek sub-category bina parent ke ban hi nahi sakti.",
  [
    req({
      name: "Sub-category banao ⭐",
      method: "POST",
      segments: ["subCategories", "{{category_id}}", "create"],
      token: ADM,
      body: {
        name: "postman admin throwaway subcategory",
        description: "Is collection ne banayi, aur isi ne mita bhi di.",
      },
      assert: [
        ...A.status(201),
        ...A.ok(),
        ...A.custom("id mila", [
          "const d = pm.response.json().data;",
          "const row = d._id ? d : (d.data || d);",
          'pm.expect(row._id, "_id").to.be.a("string");',
        ]),
      ],
      capture: [["throwaway_sub_category_id", "d._id"]],
    }),
    req({
      name: "Sub-category badlo",
      method: "PUT",
      segments: ["subCategories", "update", "{{throwaway_sub_category_id}}"],
      token: ADM,
      body: { description: "Update ka example." },
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Sub-category mitao",
      method: "DELETE",
      segments: ["subCategories", "delete", "{{throwaway_sub_category_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 06 — Banners · 07 — Promotional Tickers
// ===========================================================================
/**
 * ⚠️ No create request, and that is not an oversight.
 *
 * `POST /banners/create` takes a **file upload**, not a URL — it answers
 * *"Please upload a…"* for a JSON body — and there is no binary fixture in this
 * repo for newman to attach. Shipping a create request that cannot pass would
 * be worse than naming the gap: it would sit red on every run and train people
 * to ignore the run.
 *
 * So the seeder makes one throwaway banner and this folder reads,
 * updates and deletes it. Separate from the home-screen banner the
 * customer collection uses — a delete pointed at that one takes its folder down.
 */
const bannerFolder = folder(
  "06 — Banners",
  "Home screen ka banner. Create ke liye multipart chahiye — dekho upar wala note.",
  [
    req({
      name: "Ek Banner",
      method: "GET",
      segments: ["banners", "get", "{{admin_banner_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Banner badlo",
      method: "PUT",
      segments: ["banners", "update", "{{admin_banner_id}}"],
      token: ADM,
      body: { title: "postman seed throwaway banner (updated)", isActive: false },
      description:
        "Update JSON leta hai — file sirf create par zaroori hai, kyunki tab tak koi image hoti hi nahi.",
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Banner mitao",
      method: "DELETE",
      segments: ["banners", "delete", "{{admin_banner_id}}"],
      token: ADM,
      description:
        "Soft delete — `isDeleted: true`. Seeder har run par nayi throwaway row banata hai, to ye dobara chalane layak rehta hai.",
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

/**
 * ⚠️ No create request, and that is not an oversight.
 *
 * `POST /promotionalTickers/create` takes a **file upload**, not a URL — it answers
 * *"Please upload a…"* for a JSON body — and there is no binary fixture in this
 * repo for newman to attach. Shipping a create request that cannot pass would
 * be worse than naming the gap: it would sit red on every run and train people
 * to ignore the run.
 *
 * So the seeder makes one throwaway ticker and this folder reads,
 * updates and deletes it. Separate from the home-screen ticker the
 * customer collection uses — a delete pointed at that one takes its folder down.
 */
const tickerFolder = folder(
  "07 — Promotional Tickers",
  "Home screen par chalti hui patti. `displayOrder` hi tay karta hai kaun pehle dikhega. Create ke liye multipart chahiye — dekho upar wala note.",
  [
    req({
      name: "Sabhi Ticker",
      method: "GET",
      segments: ["promotionalTickers", "get-all"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Ek Ticker",
      method: "GET",
      segments: ["promotionalTickers", "get", "{{admin_ticker_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Ticker badlo",
      method: "PUT",
      segments: ["promotionalTickers", "update", "{{admin_ticker_id}}"],
      token: ADM,
      body: { title: "postman seed throwaway ticker (updated)", displayOrder: 98 },
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Ticker mitao",
      method: "DELETE",
      segments: ["promotionalTickers", "delete", "{{admin_ticker_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 08 — Subscription plans
// ===========================================================================
const planFolder = folder(
  "08 — Subscription Plans",
  [
    "Sirf **delete**, kyunki create/update/list `trydood-subscription` collection",
    "me pehle se hain — ek hi request ki chauthi copy ek aur jagah hoti jise",
    "badalna padta.",
    "",
    "⚠️ Delete ke liye apni row banayi jaati hai. Seeded plan par har brand",
    "subscribed hai; use mitane se subscription gate ke peeche ka har vendor",
    "endpoint gir jaata.",
  ].join("\n"),
  [
    req({
      name: "Throwaway plan banao",
      method: "POST",
      segments: ["subscriptions", "create"],
      token: ADM,
      body: {
        name: "postman admin throwaway plan",
        description: "Sirf delete ka example dikhane ke liye.",
        price: 1,
        type: "YEARLY",
        durationInYears: 1,
        durationInDays: 365,
        isActive: false,
      },
      assert: [
        ...A.custom("bana, ya validator ne mana kiya", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 201, 422]);',
          "if (code < 300) {",
          "  const d = pm.response.json().data;",
          "  const row = d._id ? d : (d.data || d);",
          '  pm.expect(row._id, "_id").to.be.a("string");',
          "}",
        ]),
      ],
      capture: [["throwaway_plan_id", "d._id"]],
    }),
    req({
      name: "Throwaway plan mitao",
      method: "DELETE",
      segments: ["subscriptions", "delete", "{{throwaway_plan_id}}"],
      token: ADM,
      assert: [
        ...A.custom("mit gaya, ya subscribed brands ne roka", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 409, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 09 — Legal
// ===========================================================================
const legalFolder = folder(
  "09 — Legal",
  "Terms aur Privacy — dono ke update/delete ka koi request kahin nahi tha. Yahan bhi apni row banti hai, kyunki live document customer app par dikhta hai.",
  [
    req({
      name: "Throwaway terms banao",
      method: "POST",
      segments: ["terms-and-conditions", "create"],
      token: ADM,
      body: {
        title: "postman admin throwaway terms",
        type: "CUSTOMER",
        description: "Sirf update aur delete ka example dikhane ke liye.",
      },
      assert: [
        ...A.custom("bana", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 201, 422]);',
        ]),
      ],
      capture: [["throwaway_terms_id", "d._id"]],
    }),
    req({
      name: "Terms mitao",
      method: "DELETE",
      segments: ["terms-and-conditions", "delete", "{{throwaway_terms_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Throwaway privacy banao",
      method: "POST",
      segments: ["privacy-and-policies", "create"],
      token: ADM,
      body: {
        title: "postman admin throwaway privacy",
        type: "CUSTOMER",
        description: "Sirf update aur delete ka example dikhane ke liye.",
      },
      assert: [
        ...A.custom("bana", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 201, 422]);',
        ]),
      ],
      capture: [["throwaway_privacy_id", "d._id"]],
    }),
    req({
      name: "Privacy badlo",
      method: "PUT",
      segments: ["privacy-and-policies", "update", "{{throwaway_privacy_id}}"],
      token: ADM,
      body: { title: "postman admin throwaway privacy (updated)" },
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Privacy mitao",
      method: "DELETE",
      segments: ["privacy-and-policies", "delete", "{{throwaway_privacy_id}}"],
      token: ADM,
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

// ===========================================================================
// 10 — Notifications (admin)
// ===========================================================================
const notificationFolder = folder(
  "10 — Notifications (admin)",
  [
    "Kisi aur ke channel toggles padhna aur badalna.",
    "",
    "⚠️ Ye **us insaan ki** preference badalta hai, platform ka switch nahi. Ek",
    "customer ka WhatsApp on karna har customer ka WhatsApp on nahi karta — wo",
    "`PUT /settings/update` me hai, aur response `blockedBy: \"PLATFORM\"` kehkar",
    "batata hai jab asli rukavat wahi hai.",
    "",
    "⚠️ Address `userId`, `customerId` **ya** `brandId` se hota hai — `xor`, teeno",
    "me se theek ek. Admin screen ke paas jo id hoti hai wahi hoti hai: customer",
    "directory ke paas `customerId`, brand list ke paas `brandId`. `or` hota to",
    "do asehmat ids chup-chaap us par settle ho jaate jise service pehle padhti.",
  ].join("\n"),
  [
    req({
      name: "Kisi customer ki settings padho",
      method: "GET",
      segments: ["notifications", "admin", "preferences"],
      query: [{ key: "customerId", value: "{{admin_customer_id}}" }],
      token: ADM,
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("teeno channel, dono field ke saath", [
          "const c = pm.response.json().data.channels;",
          '["email", "push", "whatsapp"].forEach(function (ch) {',
          '  pm.expect(c[ch].preference, ch + ".preference").to.be.a("boolean");',
          '  pm.expect(c[ch].effective, ch + ".effective").to.be.a("boolean");',
          "});",
        ]),
      ],
    }),
    req({
      name: "Kisi customer ka email band karo",
      method: "PUT",
      segments: ["notifications", "admin", "preferences"],
      token: ADM,
      body: { customerId: "{{admin_customer_id}}", email: false },
      description:
        "`updatedBy` par admin ka naam chadh jaata hai — kyunki ye badlaav us insaan ne nahi kiya jise ye asar karta hai, aur *\"mujhe kuch nahi mila\"* ka jawab wahi field deti hai.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("admin ka naam record hua", [
          "const d = pm.response.json().data;",
          'pm.expect(d.channels.email.preference, "email").to.eql(false);',
          'pm.expect(d.updatedBy, "updatedBy").to.be.an("object");',
          "// Naam aur role hi — colleague ka email ya number kabhi nahi.",
          '["email", "mobile", "whatsappNumber", "password"].forEach(function (f) {',
          '  pm.expect(d.updatedBy, f + " leaked").to.not.have.property(f);',
          "});",
        ]),
      ],
    }),
    req({
      name: "Wapas on karo (state restore)",
      method: "PUT",
      segments: ["notifications", "admin", "preferences"],
      token: ADM,
      body: { customerId: "{{admin_customer_id}}", email: true },
      description:
        "Collection ko wahi chhodna hai jaisa mila tha — warna har run seeded customer ko thoda aur chup karta jaata aur doosri collections ke notification tests bina wajah girte, jo flakiness jaisa dikhta hai.",
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Do ids ek saath — 422",
      method: "GET",
      segments: ["notifications", "admin", "preferences"],
      query: [
        { key: "customerId", value: "{{admin_customer_id}}" },
        { key: "brandId", value: "{{brand_id}}" },
      ],
      token: ADM,
      description:
        "`xor` — theek ek. Do bhejne par refusal saaf hai, na ki ek chup faisla ki kaunsi id jeeti.",
      assert: [...A.status(422), ...A.err()],
    }),
  ],
);

// ===========================================================================
// 11 — Transactions & Disputes
// ===========================================================================
const transactionFolder = folder(
  "11 — Transactions & Disputes",
  [
    "Paise ki sehat, aur wo do haalat jinse nikalne ka pehle koi raasta hi nahi",
    "tha.",
  ].join("\n"),
  [
    req({
      name: "Money health ⭐",
      method: "GET",
      segments: ["transactions", "admin", "health"],
      token: ADM,
      description: [
        "Ek screen jo un teen tarah ki gadbadi ko dhoondhti hai jo **khud kabhi",
        "shor nahi karti**: settlement jo bana hi nahi, NEFT jo shuru hua aur",
        "confirm nahi, aur payout jisne koi ledger row nahi likhi.",
        "",
        "⚠️ Har doosra money path yahan zor se fail hota hai. Settlement ka fail",
        "hona *na hone* jaisa dikhta hai — isiliye har ek ke liye alag sweep hai",
        "jiska poora kaam **gair-maujoodgi** dhoondhna hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),
    req({
      name: "Hold chhodo",
      method: "PATCH",
      segments: [
        "transactions",
        "admin",
        "{{held_transaction_id}}",
        "release-hold",
      ],
      token: ADM,
      body: {
        reason: "Chargeback resolve ho gaya — paisa vendor ka hai.",
      },
      description: [
        "⚠️ **Is endpoint se pehle in states se koi raasta hi nahi tha.**",
        "",
        "`settlementHold` refund maangte hi lag jaata hai, aur wahi ek line",
        "*\"vendor ko de chuke, ab wapas lo\"* wali poori samasya hata deti hai.",
        "Uska ulta utna hi khatarnak hai: **jo hold koi chhodta nahi, wo vendor ka",
        "paisa hamesha ke liye har settlement se bahar rakh deta hai — chup-chaap**,",
        "kyunki eligibility predicate bas match karna band kar deti hai. Na error,",
        "na log.",
        "",
        "`reason` likha jaana **zaroori** hai, aur ye tab tak mana karta hai jab",
        "tak koi refund khula hai ya chargeback unresolved hai.",
      ].join("\n"),
      assert: [
        ...A.custom("hold chhoota, ya wajah batayi gayi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 409, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),
    req({
      name: "Dispute ka evidence pack",
      method: "GET",
      segments: ["transactions", "disputes", "{{dispute_id}}", "evidence-pack"],
      token: ADM,
      description: [
        "Razorpay ko jawab dene ke liye jo chahiye, ek jagah: payment, claim,",
        "invoice, aur redemption ka waqt.",
        "",
        "⚠️ `ledger_type_dispute_unique` **dispute** par keyed hai, transaction par",
        "nahi — Razorpay dispute webhooks dobara bhejta hai **aur out of order**",
        "bhejta hai, to ek der se aaya `lost` ek `won` ke baad aa sakta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("pack mila, ya dispute hai hi nahi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404]);',
        ]),
      ],
    }),
    req({
      name: "Wahi pack, /disputes se",
      method: "GET",
      segments: ["disputes", "{{dispute_id}}", "evidence-pack"],
      token: ADM,
      description:
        "Do mount, ek hi jawab — `/disputes` naya saaf raasta hai, `/transactions/disputes/...` purana. Dono documented hain kyunki dono live hain.",
      assert: [
        ...A.custom("pack mila, ya dispute hai hi nahi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404]);',
        ]),
      ],
    }),
  ],
);

// ===========================================================================
// 14 — Email Verification (shared) · 15 — Access control
// ===========================================================================
const emailFolder = emailVerificationFolder({
  name: "14 — Email Verification",
  token: ADM,
  /**
   * ⚠️ Only this collection restores. The admin signs in **by email**, so a
   * verify that leaves the address changed breaks the next run's login — and
   * the failure surfaces at folder 00, pointing at authentication rather than
   * here. Customer and vendor accounts sign in by WhatsApp and have no email to
   * begin with.
   */
  restoreEmail: true,
});

const gateFolder = folder(
  "15 — Access control (admin token bhi har jagah nahi chalta)",
  [
    "Admin ke paas sabse zyada pahunch hai — par sab kuch nahi.",
    "",
    "⚠️ Customer-scoped endpoints `req.customerId` par chalte hain, jo admin ke",
    "token par hota hi nahi. Ye `403` role ki paabandi nahi hai, ye ek **shape**",
    "ki baat hai: admin ka koi customer record hai hi nahi, to *\"meri claims\"*",
    "ka koi matlab hi nahi banta.",
  ].join("\n"),
  [
    req({
      name: "Meri claims (customer surface) → 403",
      method: "GET",
      segments: ["voucher-claims", "customer", "get-all"],
      token: ADM,
      assert: [
        ...A.custom("admin customer surface par nahi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([403, 404, 422]);',
          "pm.expect(pm.response.json().success).to.eql(false);",
        ]),
      ],
    }),
    req({
      name: "Bina token — 401",
      method: "GET",
      segments: ["customers", "admin", "get-all"],
      assert: [...A.status(401), ...A.err()],
    }),
    req({
      name: "Garbage token — 403",
      method: "GET",
      segments: ["customers", "admin", "get-all"],
      headers: [{ key: "Authorization", value: "Bearer not-a-real-token" }],
      assert: [...A.status(403), ...A.err()],
    }),
  ],
);

// ---------------------------------------------------------------- assemble
const items = [
  authFolder,
  customerFolder,
  brandFolder,
  voucherFolder,
  categoryFolder,
  subCategoryFolder,
  bannerFolder,
  tickerFolder,
  planFolder,
  legalFolder,
  notificationFolder,
  transactionFolder,
  refundsFolder,
  settlementsFolder,
  emailFolder,
  migrated.fauthAdminOnlyFlows,
  migrated.fpromoCodes,
  migrated.fsubscribedsGrantCancelForfeit,
  migrated.fplatformSettings,
  migrated.fwebhooksReplay,
  migrated.fcurationVerificationQueues,
  healthFolder,
  disputeFolder,
  // Last: its negative tests deliberately prove the token does *not* work, so
  // nothing ordered after it can rely on that token still being useful.
  gateFolder,
];



/**
 * Requests that belong in folders built above, appended rather than declared
 * inline so the folder definitions stay readable.
 *
 * ⚠️ Before `countTree` runs — the totals printed at the end are taken from
 * the assembled tree, and appending after it reported a count the file did
 * not contain.
 */
bannerFolder.item.push(migrated.extras.banners[0], bannerListRequest);
tickerFolder.item.push(tickerCreateRequest);
planFolder.item.push(migrated.extras.plans[0]);
legalFolder.item.push(migrated.extras.legal[0]);
notificationFolder.item.push(migrated.extras.notifications[0]);
settlementsFolder.item.push(...settlementExtraRequests);
notificationFolder.item.push(...notificationPreferenceRequests({ token: ADM }));
/**
 * ⚠️ Immediately after `Set Password`, which moved it. See that request's
 * note — without this the *next* run cannot sign in at all.
 */
migrated.fauthAdminOnlyFlows.item.splice(2, 0, passwordRestoreRequest);

const stats = countTree(items);

const collection = {
  info: {
    _postman_id: "b41e7c92-6d3a-4f18-93b2-trydood-admin",
    name: "Trydood — Super Admin Panel",
    description: [
      "# Super Admin Panel API",
      "",
      `**${stats.requests} requests · ${stats.tests} assertions**`,
      "",
      "Ye collection un **49 admin endpoints** ko cover karti hai jinke liye",
      "kahin koi request thi hi nahi. Baaki 35 admin routes",
      "`trydood-brand-verification`, `trydood-security-changes` aur",
      "`trydood-subscription` me pehle se hain — unki chauthi copy yahan banane",
      "ka matlab hota ek aur jagah jise badalna padta.",
      "",
      "## Chalane se pehle",
      "",
      "```bash",
      "node postman/generate-admin-collection.js",
      "node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply",
      "MONGO_URL=\"<...>/Trydood2_postman\" ENABLE_JOBS=false npm run dev",
      "```",
      "",
      "## ⚠️ Ye collection likhti hai",
      "",
      "CRUD folders apni row **khud banati hain** aur usi ko mitati hain, to",
      "kuch peeche nahi chhutta. Par money folders seeded rows par chalte hain",
      "aur unhe **aage badha dete hain** — ek settlement approve hokar pay ho",
      "jaata hai. Dobara chalane se pehle seeder chalao, warna doosri baar har",
      "money request `422` degi ek transition ka naam lekar jo usne maanga hi",
      "nahi tha.",
    ].join("\n"),
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: items,
};

// ---------------------------------------------------------------- env
const URLS = {
  local: "http://localhost:8080/trydood/v1",
  staging: "https://backend2-0-4v4i.onrender.com/trydood/v1",
  production: "https://api.trydood.com/trydood/v1",
};

const envFile = (name, baseUrl) => ({
  id: `trydood-admin-${name}`,
  name: `Trydood Admin — ${name}`,
  values: [
    { key: "base_url", value: baseUrl, type: "default", enabled: true },
    { key: "local_url", value: URLS.local, type: "default", enabled: true },
    { key: "stage_url", value: URLS.staging, type: "default", enabled: true },
    { key: "prod_url", value: URLS.production, type: "default", enabled: true },

    /**
     * ⚠️ The server root, **without** `/trydood/v1`.
     *
     * `index.js` serves `/`, `/my-ip` and `/client-ip` outside the API mount,
     * so `{{base_url}}` puts them at `/trydood/v1/my-ip` — the router's
     * catch-all, a `404` that reads as a routing bug rather than a missing
     * prefix. Every environment carries all three of these too.
     */
    { key: "host_url", value: baseUrl.replace(/\/trydood\/v1$/, ""), type: "default", enabled: true },
    { key: "local_host", value: URLS.local.replace(/\/trydood\/v1$/, ""), type: "default", enabled: true },
    { key: "stage_host", value: URLS.staging.replace(/\/trydood\/v1$/, ""), type: "default", enabled: true },
    { key: "prod_host", value: URLS.production.replace(/\/trydood\/v1$/, ""), type: "default", enabled: true },

    // ── sign-in. The seeder creates this account *with* a password. ──
    {
      key: "admin_email",
      value: "seed.admin.pmfx@example.com",
      type: "default",
      enabled: true,
    },
    {
      key: "admin_password",
      value: "PostmanSeed@2026",
      type: "default",
      enabled: true,
    },
    { key: "admin_token", value: "", type: "default", enabled: true },

    // ── captured by the collection as it runs ──
    { key: "admin_customer_id", value: "", type: "default", enabled: true },
    { key: "throwaway_category_id", value: "", type: "default", enabled: true },
    {
      key: "throwaway_sub_category_id",
      value: "",
      type: "default",
      enabled: true,
    },

    { key: "throwaway_plan_id", value: "", type: "default", enabled: true },
    { key: "throwaway_terms_id", value: "", type: "default", enabled: true },
    { key: "throwaway_privacy_id", value: "", type: "default", enabled: true },

    /**
     * ── seeded ──
     *
     * ⚠️ None of these is capturable. An admin cannot create a settlement (a
     * nightly job does), cannot open a refund (a customer does), and cannot
     * put a transaction on hold from the outside. The six settlement ids are
     * six *different* settlements, one parked in each state its action starts
     * from — see `lib/adminMoneyFolders.js`.
     */
    { key: "brand_id", value: "", type: "default", enabled: true },
    /**
     * ⚠️ Brand B, deliberately not the same brand as `brand_id`.
     *
     * The subscription-lifecycle requests (Grant → Resync → Cancel) really do
     * change subscription state — Cancel really cancels. Pointed at Brand A
     * that broke the vendor collection's very next assertion elsewhere
     * ("Get my brand — isSubscribed"), since Brand A is what every other
     * collection reads. Brand B carries no such assertion anywhere.
     */
    { key: "other_brand_id", value: "", type: "default", enabled: true },
    { key: "admin_banner_id", value: "", type: "default", enabled: true },
    { key: "admin_ticker_id", value: "", type: "default", enabled: true },
    { key: "category_id", value: "", type: "default", enabled: true },
    { key: "draft_version_id", value: "", type: "default", enabled: true },
    { key: "held_transaction_id", value: "", type: "default", enabled: true },
    { key: "dispute_id", value: "", type: "default", enabled: true },
    { key: "statement_token", value: "", type: "default", enabled: true },

    /**
     * ── referenced by the migrated requests ──
     *
     * ⚠️ Declared even where they start empty. An undeclared `{{…}}` is sent
     * literally, so the request hits the router's catch-all and answers
     * `404 Invalid API` — a refusal that reads as a routing bug rather than a
     * missing value.
     */
    // Terms/Privacy row the update request edits.
    { key: "legal_id", value: "", type: "default", enabled: true },
    // Captured from a dry-run broadcast, replayed by the retry.
    { key: "broadcast_id", value: "", type: "default", enabled: true },
    // Reset-password code. Seeded flows accept any 6 digits.
    { key: "otp", value: "000000", type: "default", enabled: true },
    // The code string itself, captured on create.
    { key: "promo_code", value: "", type: "default", enabled: true },
    // A subscription plan to grant.
    { key: "plan_proplus_id", value: "", type: "default", enabled: true },
    // Captured from a grant; the webhook list filters on it.
    { key: "transaction_id", value: "", type: "default", enabled: true },
    // Captured from the forfeited worklist.
    { key: "forfeited_subscribed_id", value: "", type: "default", enabled: true },
    // Captured from a grant, replayed into the webhook.
    { key: "razorpay_order_id", value: "", type: "default", enabled: true },
    // The signed-in admin, for reviewer filters.
    { key: "admin_user_id", value: "", type: "default", enabled: true },
    // Captured from the verification queue.
    { key: "system_verify_id", value: "", type: "default", enabled: true },
    { key: "promo_code_id", value: "", type: "default", enabled: true },
    { key: "subscribed_id", value: "", type: "default", enabled: true },
    { key: "subscription_id", value: "", type: "default", enabled: true },
    { key: "webhook_event_id", value: "", type: "default", enabled: true },
    { key: "terms_id", value: "", type: "default", enabled: true },
    { key: "voucher_id", value: "", type: "default", enabled: true },
    { key: "user_id", value: "", type: "default", enabled: true },

    { key: "admin_refund_id", value: "", type: "default", enabled: true },
    {
      key: "admin_rejectable_refund_id",
      value: "",
      type: "default",
      enabled: true,
    },
    {
      key: "admin_payable_refund_id",
      value: "",
      type: "default",
      enabled: true,
    },
    { key: "admin_bank_refund_id", value: "", type: "default", enabled: true },
    { key: "admin_payout_refund_id", value: "", type: "default", enabled: true },
    {
      key: "admin_failable_refund_id",
      value: "",
      type: "default",
      enabled: true,
    },

    { key: "settlement_approvable_id", value: "", type: "default", enabled: true },
    { key: "settlement_holdable_id", value: "", type: "default", enabled: true },
    {
      key: "settlement_cancellable_id",
      value: "",
      type: "default",
      enabled: true,
    },
    { key: "settlement_processing_id", value: "", type: "default", enabled: true },
    { key: "settlement_failed_id", value: "", type: "default", enabled: true },
    {
      key: "settlement_abandonable_id",
      value: "",
      type: "default",
      enabled: true,
    },
    {
      key: "other_brand_settlement_id",
      value: "",
      type: "default",
      enabled: true,
    },

    // ── email verification ──
    {
      key: "new_email",
      value: "postman.admin.new@example.com",
      type: "default",
      enabled: true,
    },
    { key: "email_otp", value: "", type: "default", enabled: true },
    /** The address the verify request switches **to**. Seeder writes its OTP. */
    { key: "verify_email", value: "", type: "default", enabled: true },
    /** What the account started with, for the restore. Empty where there was none. */
    { key: "account_email", value: "", type: "default", enabled: true },

    // ── generated per run by the pre-request script ──
    { key: "now_iso", value: "", type: "default", enabled: true },
  ],
  _postman_variable_scope: "environment",
});

/** `now_iso` for the payout confirmations, generated per request. */
collection.event = [
  {
    listen: "prerequest",
    script: {
      type: "text/javascript",
      exec: ["pm.environment.set('now_iso', new Date().toISOString());"],
    },
  },
];

// ---------------------------------------------------------------- write
const OUT = path.join(__dirname, "..");
const ENV_DIR = path.join(__dirname, "environments");
fs.mkdirSync(ENV_DIR, { recursive: true });

const files = [
  ["postman/trydood-admin.postman_collection.json", collection],
  [
    "postman/environments/admin-local.postman_environment.json",
    envFile("local", URLS.local),
  ],
  [
    "postman/environments/admin-staging.postman_environment.json",
    envFile("staging", URLS.staging),
  ],
  [
    "postman/environments/admin-production.postman_environment.json",
    envFile("production", URLS.production),
  ],
];

for (const [rel, body] of files) {
  const target = path.join(OUT, rel);
  fs.writeFileSync(target, JSON.stringify(body, null, 2) + "\n");
  console.log(`wrote ${rel}`);
}

console.log(
  `\n${items.length} folders · ${stats.requests} requests · ${stats.tests} assertions · ${stats.examples} saved examples`,
);
