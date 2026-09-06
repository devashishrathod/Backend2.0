/**
 * The customer's notification inbox, and the public app config.
 *
 * Email verification and the channel toggles used to live here too. They moved
 * to `lib/accountFolders.js` when the vendor collection needed the same twelve
 * requests: both features are role-agnostic in the code — one `User`, no role
 * gate, the id read off the token — so keeping a per-collection copy meant the
 * next change to either endpoint had to be made twice.
 *
 * What is left is genuinely customer-shaped:
 *
 *  - customer notifications were **written** (`refundNotices`,
 *    `voucherClaimNotices` both target `audience: CUSTOMER`) and had no endpoint
 *    to read them back, so the app got a push and no history
 *  - `Setting` held the minimum app version behind `isAdmin`, which made
 *    force-update impossible without shipping a build to fix the build
 */

const { req, folder, A } = require("./builders");
const {
  emailVerificationFolder,
  notificationPreferenceRequests,
} = require("./accountFolders");

const CUST = "customer_token";

const emailFolder = emailVerificationFolder({
  name: "15 — Email Verification",
  token: CUST,
});

const inboxFolder = folder(
  "16 — Notifications",
  [
    "Customer ka notification inbox — **wahi endpoint jo vendor aur admin use**",
    "**karte hain**, scope aur projection token se.",
    "",
    "### Alag `/notifications/customer` kyun nahi",
    "",
    "Wahi wajah jo `/refunds`, `/settlements` aur `/voucher-claims` ki hai: do",
    "surface ka matlab do jagah yaad rakhna ki customer ko `emailError`,",
    "`dedupeKey` ya kaccha `meta` nahi dikhna chahiye. Ek jagah bhoolna = leak.",
    "",
    "⚠️ Rows pehle se likhi ja rahi thi (`refundNotices`, `voucherClaimNotices`",
    "dono `audience: CUSTOMER` par likhte hain) — bas unhe padhne ka koi raasta",
    "nahi tha. Customer ko push milta tha aur history kahin nahi.",
    "",
    "⚠️ `meta` **whitelist** hai, delete-list nahi: sirf `claimId`, `claimCode`,",
    "`refundRequestId`, `transactionId`, `brandId`. Baaki jo bhi koi notice kal",
    "`meta` me daalega wo default roop se adrishya rahega.",
    "",
    "---",
    "",
    "### Channel preferences — aakhri chaar request",
    "",
    "Email, push aur WhatsApp alag-alag on/off. Yahan bhi koi role gate nahi:",
    "customer, vendor, outlet manager aur admin — sabke paas ek `User` hai, to",
    '*"meri settings"* sabke liye ek hi operation hai aur service id **token se**',
    "padhti hai, body se nahi. Is endpoint ke paas kisi aur ko address karne ka",
    "koi raasta hi nahi hai.",
    "",
    "⚠️ **Yahan in-app feed band nahi hoti.** Row hamesha likhi jaati hai; ye",
    "toggles sirf *delivery* tay karte hain. Warna wo notice bhi gayab ho jaata",
    "jo batata hai ki delivery band kyun hai.",
  ].join("\n"),
  [
    req({
      name: "Mera inbox ⭐",
      method: "GET",
      segments: ["notifications", "get-all"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      token: CUST,
      description: [
        "Unread pehle, phir newest.",
        "",
        "`unreadCount` **usi response me** aata hai — bell ko har baar chahiye aur",
        "ek number ke liye doosra round trip barbaadi hai.",
        "",
        "⚠️ `unreadCount` **scope** par ginta hai, filter par nahi. `?type=` lagane",
        "par list chhoti ho jati hai par badge wahi rehta hai — warna badge us bell",
        "se hi asehmat ho jata jisne use khola tha.",
        "",
        "⚠️ Khaali inbox **`200` + `data: []`** deta hai, `404` nahi. Naya customer",
        "sabse pehle yahi tapta hai, aur *\"koi notification nahi\"* ek normal",
        "haalat hai — error screen nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.paged(),
        ...A.custom("badge aur rows", [
          "const d = pm.response.json().data;",
          'pm.expect(d.unreadCount, "unreadCount").to.be.a("number");',
          "(d.data || []).forEach(function (r) {",
          '  pm.expect(r.type, "type").to.be.a("string");',
          '  pm.expect(r.title, "title").to.be.a("string");',
          '  pm.expect(r.isRead, "isRead").to.be.a("boolean");',
          "});",
        ]),
        ...A.custom("customer ko delivery internals kabhi nahi", [
          "const rows = pm.response.json().data.data || [];",
          "const raw = JSON.stringify(rows);",
          '["emailError", "emailSentAt", "dedupeKey", "channels", "audience", "customerId"].forEach(function (f) {',
          '  pm.expect(raw, f + " leaked").to.not.include("\\"" + f + "\\"");',
          "});",
        ]),
      ],
      capture: [["notification_id", "d.data[0]._id"]],
    }),

    req({
      name: "Ek notification read karo",
      method: "PUT",
      segments: ["notifications", "mark-read"],
      token: CUST,
      body: { notificationIds: ["{{notification_id}}"] },
      description: [
        "Ids do, ya `markAll: true`.",
        "",
        "⚠️ Scope **update ke filter me** hai, pehle padhkar nahi. Kisi aur ka id",
        "guess karne par `matched: 0` aata hai — kyunki `customerId` usi query ka",
        "hissa hai jo likhti hai. Pehle padhna aur phir id se update karna ek",
        "khidki chhod deta, aur ownership ka faisla doosri jagah le jata.",
        "",
        "`unreadCount` wapas aata hai taaki badge turant sahi ho jaye.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({
          matched: "number",
          updated: "number",
          unreadCount: "number",
        }),
      ],
    }),

    req({
      name: "Dusre ka notification read karne ki koshish — matched 0",
      method: "PUT",
      segments: ["notifications", "mark-read"],
      token: CUST,
      body: { notificationIds: ["{{other_customer_notification_id}}"] },
      description: [
        "Ek asli id, par kisi aur customer ki.",
        "",
        "⚠️ Jawab **`403` nahi, `matched: 0`** hai — aur ye jaan-boojh kar hai.",
        "Scope filter me hai, to row match hi nahi karti; `403` dene ke liye pehle",
        "padhna padta *\"ye kiski hai\"*, aur wahi read-then-write wapas le aata",
        "jise filter hataata hai. `matched: 0` bhi utna hi saaf jawab hai aur ek",
        "kam sawal poochta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("kisi aur ki row chhui hi nahi gayi", [
          "const d = pm.response.json().data;",
          'pm.expect(d.matched, "matched").to.eql(0);',
          'pm.expect(d.updated, "updated").to.eql(0);',
        ]),
      ],
    }),

    ...notificationPreferenceRequests({ token: CUST }),
  ],
);

// ----------------------------------------------------------- app config

const appConfigFolder = folder(
  "17 — App Config (public)",
  [
    "App launch par pehla call — **token ke bina**.",
    "",
    "Min version, force-update, support contact aur feature flags. `Setting`",
    "yahi sab pehle se rakhta tha par `GET /settings/get` `isAdmin` hai, isliye",
    "force-update ka koi raasta hi nahi tha: number build me hardcode hota, aur",
    "use badalne ke liye wahi update chahiye hota jo wo maang raha hai.",
    "",
    "⚠️ **Whitelist hai, `Setting` minus kuch nahi.** Wahi document commission",
    "percentage, reserve rates, settlement timing aur gateway-fee bearer bhi",
    "rakhta hai. `helpers/settings/getAppConfig.js` har field naam lekar banata",
    "hai — kyunki ek spread us line par bilkul normal dikhta aur platform ki",
    "economics public kar deta.",
  ].join("\n"),
  [
    req({
      name: "App config — guest, koi token nahi ⭐",
      method: "GET",
      segments: ["app-config"],
      description: [
        "Sab kuch defaults ke saath. `updateRequired` aur `updateAvailable`",
        "**`null`** aate hain jab tak client apna version na bheje — ek imaandaar",
        '*"poocha hi nahi"*, us `false` ki jagah jis par client bharosa kar leta.',
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({
          app: "object",
          support: "object",
          features: "object",
          pricing: "object",
          refund: "object",
        }),
        ...A.custom("platform economics kabhi nahi", [
          "const raw = JSON.stringify(pm.response.json().data).toLowerCase();",
          '["commission", "reserve", "settlement", "chargeback", "gatewayfee", "delaydays", "payout"].forEach(function (f) {',
          '  pm.expect(raw, f + " leaked into a public endpoint").to.not.include(f);',
          "});",
        ]),
      ],
    }),

    req({
      name: "Purana build — updateRequired true",
      method: "GET",
      segments: ["app-config"],
      query: [
        { key: "platform", value: "android" },
        { key: "version", value: "0.9.0" },
      ],
      description: [
        "Version bhejne par server khud tay karta hai.",
        "",
        "⚠️ Comparison **yahan** hoti hai, app me nahi. Do apps me *\"kya main",
        'minimum se neeche hoon"* likhna do mauke hain `"1.10.0" < "1.9.0"` wali',
        "galti karne ke — jo **text me sach hai** — aur wo galti un builds me",
        "hoti jinhe theek karne ke liye wahi update chahiye jo wo maang rahe hain.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("purana build update maangta hai", [
          "const a = pm.response.json().data.app;",
          'pm.expect(a.updateRequired, "updateRequired").to.eql(true);',
          'pm.expect(a.platform, "platform").to.eql("android");',
        ]),
      ],
    }),

    req({
      name: "Naya build — updateRequired false",
      method: "GET",
      segments: ["app-config"],
      query: [
        { key: "platform", value: "android" },
        { key: "version", value: "9.9.9" },
      ],
      description:
        "Minimum se upar, to koi rukavat nahi. `updateAvailable` phir bhi bata sakta hai ki naya build hai — wo alag sawal hai.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("naya build rukta nahi", [
          "const a = pm.response.json().data.app;",
          'pm.expect(a.updateRequired, "updateRequired").to.eql(false);',
        ]),
      ],
    }),

    req({
      name: "Galat version format — 422",
      method: "GET",
      segments: ["app-config"],
      query: [{ key: "version", value: "not-a-version" }],
      description: [
        "Shape validator me check hoti hai.",
        "",
        "⚠️ Bina check ke ye `0.0.0` ban jata aur **har minimum se neeche** hota —",
        "yani ek typo har us customer se update maangta jo pehle se sabse naye",
        "build par hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),
  ],
);

module.exports = { emailFolder, inboxFolder, appConfigFolder };
