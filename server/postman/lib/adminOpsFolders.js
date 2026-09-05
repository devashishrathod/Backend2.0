/**
 * The last routes that had no request in any collection.
 *
 * ### ⚠️ Why these were the ones left behind
 *
 * Each is awkward in its own way, and awkward is how a route goes uncovered:
 *
 *  - `/`, `/my-ip` and `/client-ip` are served by `index.js` **outside** the
 *    `/trydood/v1` mount, so `{{base_url}}` cannot reach them at all. They
 *    needed a second variable before they could even be written down.
 *  - the dispute worklist sits behind a plain `verifyJwtToken`, so it belongs
 *    to no single role and every role-shaped collection skipped it.
 *  - `GET /settlements/statement/:token` is **public** and authenticates on the
 *    token in the path — the one settlement route with no bearer at all.
 *  - `POST /promotionalTickers/create` takes a file, and there is no binary
 *    fixture in this repo.
 *
 * `scripts/verifyApiCoverage.js` is what found them. Nothing else would have:
 * every one of them had a doc section, so reading the docs suggested they were
 * covered.
 */

const { req, folder, A } = require("./builders");

const ADM = "admin_token";

// ------------------------------------------------------------ health & ops

const healthFolder = folder(
  "22 — Health & Ops (API mount ke bahar)",
  [
    "Teen route jo `index.js` seedha serve karta hai — `/trydood/v1` ke **andar**",
    "nahi.",
    "",
    "⚠️ Isiliye ye `{{host_url}}` use karte hain, `{{base_url}}` nahi. Dono ek",
    "hi server hain; farq sirf itna hai ki `base_url` me `/trydood/v1` shaamil",
    "hai. `{{base_url}}/my-ip` `404 Invalid API` deta — router ka catch-all —",
    "aur wo galti routing bug jaisi dikhti, missing prefix jaisi nahi.",
  ].join("\n"),
  [
    req({
      name: "Health check",
      method: "GET",
      segments: [],
      host: "{{host_url}}",
      description: [
        "Plain text, jaan-boojh kar — `Welcome to Trydood 2.0🚀`.",
        "",
        "⚠️ Ye API ka JSON envelope **nahi** deta, aur ye theek hai: ye uptime",
        "probe ke liye hai, client ke liye nahi. Par isi wajah se ye ek jhooth",
        "bhi bol sakta tha — port jawab deta tha jabki database gir chuka hota.",
        "Ab boot database ke bina start hi nahi hota, to is 200 ka matlab ab",
        "sach me *\"server chal raha hai\"* hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.custom("plain text, envelope nahi", [
          'pm.expect(pm.response.text()).to.include("Trydood");',
        ]),
      ],
    }),

    req({
      name: "Mera outbound IP",
      method: "GET",
      segments: ["my-ip"],
      host: "{{host_url}}",
      description: [
        "Wo address jo **ye process** bahar jaate waqt use karta hai.",
        "",
        "Iski ek hi asli wajah hai: Atlas ka **Network Access** allow-list. Wo",
        "list Render ke addresses par bani hai; EC2 par jaate hi wo galat ho",
        "jaati hai, aur ek bhoola hua entry ab **deploy fail** karta hai (boot",
        "database ke bina chalta hi nahi) — pehle wo chalte hue server ke saath",
        "toote hue requests deta tha.",
      ].join("\n"),
      assert: [...A.status(200)],
    }),

    req({
      name: "Caller ka IP (TRUST_PROXY ke through)",
      method: "GET",
      segments: ["client-ip"],
      host: "{{host_url}}",
      description: [
        "Wo address jo ye process **caller** ka samajhta hai.",
        "",
        "⚠️ Rate limiter isi par ginta hai, isliye ye galat hona mehnga hai.",
        "`TRUST_PROXY` ghalat hone par `req.ip` proxy ka address ban jaata hai —",
        "aur limiter **poore desh ko ek client** gin leta hai: pehle kuch sau",
        "requests bucket khatam kar deti hain aur baaki sab bahar. Ulta bhi",
        "utna hi bura hai: jo hop hai hi nahi use trust karna matlab caller ka",
        "khud likha `X-Forwarded-For` maan lena, jo limiter ke aas-paas ka free",
        "raasta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.custom("ip laut kar aaya", [
          'pm.expect(pm.response.json().ip, "ip").to.be.a("string");',
        ]),
      ],
    }),
  ],
);

// ------------------------------------------------------------- disputes

const disputeFolder = folder(
  "23 — Disputes (chargeback worklist)",
  [
    "Razorpay ka dispute — bank ne payment wapas maanga.",
    "",
    "⚠️ Gate sirf `verifyJwtToken` hai, koi role nahi — **scope token se aata",
    "hai**. Vendor apne brand ke disputes dekhta hai, admin sabke. Isliye ye",
    "kisi ek role ki collection me fit nahi hota, aur theek isi wajah se teeno",
    "collections ne ise chhod diya tha.",
    "",
    "⚠️ `ledger_type_dispute_unique` **dispute** par keyed hai, transaction par",
    "nahi — Razorpay dispute webhooks dobara bhejta hai **aur out of order**",
    "bhejta hai, to ek der se aaya `lost` ek `won` ke baad aa sakta hai.",
  ].join("\n"),
  [
    req({
      name: "Dispute worklist ⭐",
      method: "GET",
      segments: ["disputes"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        {
          key: "status",
          value: "OPEN",
          disabled: true,
          description: "OPEN | UNDER_REVIEW | ACTION_REQUIRED | WON | LOST | CLOSED",
        },
        {
          key: "resolved",
          value: "false",
          disabled: true,
          description: "true = sirf WON/LOST/CLOSED",
        },
        {
          key: "brandId",
          value: "{{brand_id}}",
          disabled: true,
          description: "Admin hi kisi aur brand par filter kar sakta hai",
        },
      ],
      token: ADM,
      description: [
        "Paginated — rows `data.data` me hain.",
        "",
        "⚠️ `respondBy` **absent** hota hai jab tak Razorpay deadline na de. Use",
        "aggregation me `null` se compare karna bina `$ifNull` ke ulta jawab",
        "deta hai — yahi galti `vendorWasPaid: true` bana chuki hai un payments",
        "par jo **kabhi settle hi nahi hue**, aur wahi field admin dekhkar tay",
        "karta hai ki wapas lene ko kuch hai bhi ya nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("paginated", [
          "const d = pm.response.json().data;",
          'pm.expect(d.data, "data.data").to.be.an("array");',
        ]),
      ],
    }),

    req({
      name: "Ek dispute",
      method: "GET",
      segments: ["disputes", "{{dispute_id}}"],
      token: ADM,
      description:
        "Ek dispute ki poori haalat. Evidence pack alag endpoint hai — wo Razorpay ko jawab dene ke liye sab kuch ek jagah jodta hai.",
      assert: [
        ...A.custom("mila, ya hai hi nahi", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404]);',
        ]),
      ],
    }),
  ],
);

/**
 * The two evidence endpoints belong to the **vendor**, not the admin.
 *
 * `isVendorOrSubVendor` — an outlet manager who actually served the customer is
 * often the only person who knows what happened, which is the whole reason the
 * gate reaches down to `SUB_VENDOR`.
 */
const vendorDisputeRequests = ({ token }) => [
  req({
    name: "Dispute par apna bayaan do",
    method: "POST",
    segments: ["disputes", "{{dispute_id}}", "evidence"],
    token,
    body: { note: "Customer ne counter par voucher redeem kiya, CCTV timestamp ke saath." },
    description: [
      "Vendor ka apna note, jo evidence pack me jaata hai.",
      "",
      "⚠️ Gate `isVendorOrSubVendor` hai — outlet manager tak. Wahi insaan aksar",
      "jaanta hai ki counter par kya hua, aur use bahar rakhne ka matlab hota",
      "sabse achhi gawahi ka na aana.",
      "",
      "⚠️ Ye faisla nahi karta, sirf record karta hai. Dispute jeetne ya haarne",
      "ka jawab Razorpay se webhook par aata hai.",
    ].join("\n"),
    assert: [
      ...A.custom("bayaan record hua, ya dispute hai hi nahi", [
        "const code = pm.response.code;",
        'pm.expect(code, "status").to.be.oneOf([200, 403, 404, 422]);',
        "pm.expect(pm.response.json()).to.have.property('success');",
      ]),
    ],
  }),

  req({
    name: "Wahi bayaan, /transactions mount se",
    method: "POST",
    segments: ["transactions", "disputes", "{{dispute_id}}", "evidence"],
    token,
    body: { note: "Same note, purane mount se." },
    description:
      "Do mount, ek hi handler — `/disputes` naya saaf raasta hai, `/transactions/disputes/...` purana. Dono live hain, isliye dono documented hain; naya kaam naye wale par likhein.",
    assert: [
      ...A.custom("dono mount ek jaisa jawab dete hain", [
        "const code = pm.response.code;",
        'pm.expect(code, "status").to.be.oneOf([200, 403, 404, 422]);',
      ]),
    ],
  }),
];

// ------------------------------------------- requests that join existing folders

/** Appended to the admin Banners folder. */
const bannerListRequest = req({
  name: "Sabhi Banner",
  method: "GET",
  segments: ["banners", "get-all"],
  query: [
    { key: "page", value: "1" },
    { key: "limit", value: "20" },
    { key: "type", value: "IMAGE", disabled: true, description: "IMAGE | VIDEO" },
    { key: "isActive", value: "true", disabled: true },
    { key: "search", value: "", disabled: true },
  ],
  token: ADM,
  description:
    "Admin ki poori list — customer wali `/banners/customer/active` sirf live banners deti hai, ye draft aur band kiye hue bhi.",
  assert: [...A.status(200), ...A.ok()],
});

/** Appended to the admin Promotional Tickers folder. */
const tickerCreateRequest = req({
  name: "Ticker banao (file chahiye)",
  method: "POST",
  segments: ["promotionalTickers", "create"],
  token: ADM,
  form: [
    { key: "icon", type: "file", description: "⚠️ Required — yahan apni file attach karein" },
    { key: "title", value: "postman example ticker" },
    { key: "displayOrder", value: "50" },
    { key: "isActive", value: "false" },
  ],
  description: [
    "⚠️ **Iska saved example ek refusal hai, aur wo jaan-boojh kar hai.**",
    "",
    "`createTicker` `files?.icon` maangta hai, yaani ye multipart hai. Is repo",
    "me newman ke attach karne layak koi binary fixture nahi hai, to capture",
    "wahi `422` record karta hai jo bina file ke aata hai.",
    "",
    "Postman me `icon` par apni image attach karke chalayein — request ka",
    "baaki sab hissa sahi hai.",
    "",
    "Ye request isliye rakhi gayi hai ki ise hataa dena `verifyApiCoverage` ko",
    "green dikhata jabki endpoint kahin documented hi na hota.",
  ].join("\n"),
  assert: [
    ...A.custom("bana, ya file maangi gayi", [
      "const code = pm.response.code;",
      'pm.expect(code, "status").to.be.oneOf([200, 201, 422]);',
      "pm.expect(pm.response.json()).to.have.property('success');",
    ]),
  ],
});

/** Appended to the admin Settlements folder. */
const settlementExtraRequests = [
  req({
    name: "Bakaya write off karo",
    method: "PATCH",
    segments: ["settlements", "admin", "debt", "{{brand_id}}", "write-off"],
    token: ADM,
    body: {
      reason: "Brand band ho gaya — 90 din se koi sale nahi.",
      olderThanDays: 90,
    },
    description: [
      "Ek soch-samajh kar liya gaya accounting faisla, jis par insaan ka naam",
      "hota hai. `alertVendorDebt` roz ye bakaya report karta hai aur **kuch",
      "karta nahi** — 90 din par apne aap maaf kar dena us brand ko maaf kar",
      "dega jo bas season ke beech me hai.",
      "",
      "⚠️ Ye har row par **do** `MANUAL_ADJUSTMENT` likhta hai —",
      "`VENDOR_PAYABLE` credit taaki agla cycle bakaya na dekhe, aur",
      "`PLATFORM_COST` debit kyunki nuksaan humne uthaya. Reference **sirf",
      "vendor row par** jaata hai: `ONCE_PER_REFUND` aur `ONCE_PER_DISPUTE`",
      "`{reference, entryType}` par unique hain, to dono par daalne se doosra",
      "duplicate-key no-op ban jaata — bakaya saaf ho jaata, cost kabhi aati",
      "hi nahi, aur kitaab theek utni kam ho jaati jitna maaf kiya.",
    ].join("\n"),
    assert: [
      ...A.custom("write off hua, ya bakaya hai hi nahi", [
        "const code = pm.response.code;",
        'pm.expect(code, "status").to.be.oneOf([200, 404, 422]);',
        "pm.expect(pm.response.json()).to.have.property('success');",
      ]),
    ],
  }),

  req({
    name: "Statement — token se, bina login",
    method: "GET",
    segments: ["settlements", "statement", "{{statement_token}}"],
    description: [
      "⚠️ **Poori settlements module me ekmatra public route.** Koi bearer",
      "nahi — path ka token hi credential hai.",
      "",
      "Wahi token vendor ke email/WhatsApp me jaane wale statement link me hota",
      "hai. Isliye ye us aadmi ke liye kaam karta hai jo abhi login nahi hai —",
      "aur isiliye token ka guess na hona hi poori suraksha hai.",
      "",
      "⚠️ Iska matlab ye bhi hai ki galat token par `404` aata hai, `401` nahi:",
      "`401` ye bata deta ki token maujood hai par aapka nahi.",
    ].join("\n"),
    assert: [
      ...A.custom("statement mila, ya token galat", [
        "const code = pm.response.code;",
        'pm.expect(code, "status").to.be.oneOf([200, 404, 422]);',
      ]),
    ],
  }),
];

/**
 * Puts the admin's password back.
 *
 * ⚠️ Without this the collection breaks its own next run. `Set Password`
 * changes the seeded admin's password to `N3wStr0ngPass`; the run after that
 * signs in with `{{admin_password}}`, gets `401`, and **all 112 requests fail**
 * in a cascade that points at authentication rather than at the request that
 * moved the password. The first run is green, the second is entirely red, and
 * nothing in the failure names the cause.
 *
 * Same discipline as the notification-preference restore and the brand-status
 * restore: a collection leaves the database the way it found it.
 */
const passwordRestoreRequest = req({
  name: "Password wapas set karo (state restore)",
  method: "POST",
  segments: ["auth", "set-password"],
  token: ADM,
  body: {
    currentPassword: "N3wStr0ngPass",
    newPassword: "{{admin_password}}",
  },
  description: [
    "Upar wali request ne password badal diya. Ye use wapas wahi kar deti hai",
    "jo environment me likha hai.",
    "",
    "⚠️ Ye cosmetic nahi hai. Bina iske agla run login hi nahi kar paata, aur",
    "failure `00 — Setup & Auth` par dikhti hai — us request par nahi jisne",
    "password hilaya tha. Ek fixture jo dheere-dheere kharaab hota hai, wo sabse",
    "mehngi kism ki galti hai kyunki wo flakiness jaisi dikhti hai.",
  ].join("\n"),
  assert: [
    ...A.custom("password wapas aa gaya", [
      "const code = pm.response.code;",
      'pm.expect(code, "status").to.be.oneOf([200, 400, 401]);',
      "pm.expect(pm.response.json()).to.have.property('success');",
    ]),
  ],
});

module.exports = {
  healthFolder,
  disputeFolder,
  vendorDisputeRequests,
  bannerListRequest,
  tickerCreateRequest,
  settlementExtraRequests,
  passwordRestoreRequest,
};
