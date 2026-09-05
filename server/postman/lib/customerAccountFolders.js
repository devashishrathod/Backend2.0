/**
 * Email verification, the notification inbox, and the public app config.
 *
 * Three separate features, one module, because each is small and all three
 * arrived together. They share nothing except that none of them existed before:
 *
 *  - `isEmailVerified` was on every `User` and settable by nobody, so the badge
 *    could only ever go from `true` to `false`
 *  - customer notifications were **written** (`refundNotices`,
 *    `voucherClaimNotices` both target `audience: CUSTOMER`) and had no endpoint
 *    to read them back, so the app got a push and no history
 *  - `Setting` held the minimum app version behind `isAdmin`, which made
 *    force-update impossible without shipping a build to fix the build
 */

const { req, folder, A } = require("./builders");

const CUST = "customer_token";

// ------------------------------------------------------ email verification

const emailFolder = folder(
  "15 — Email Verification",
  [
    "Ek email address confirm karna — **har role ke liye ek hi flow**.",
    "",
    "Customer, vendor, outlet manager aur admin sab isi raaste se aate hain,",
    "isiliye gate `verifyJwtToken` hai, koi role gate nahi: `isEmailVerified`",
    "`User` par sabke liye maujood hai aur **ab tak koi bhi use set nahi kar",
    "sakta tha**. Email edit karne par flag `false` ho jata tha aur wapas `true`",
    "karne ka koi raasta hi nahi tha.",
    "",
    "### Verify aur change — do alag endpoint nahi hain",
    "",
    "`email` **dono call par optional** hai. Na bhejein to jo address account par",
    "pehle se hai wo confirm hota hai; bhejein to usme badal jata hai. Do alag",
    "endpoints ka matlab hota client ko pehle decide karna ki address badla hai",
    "ya nahi — aur wahi faisla server ke paas pehle se hai.",
    "",
    "⚠️ **Code hamesha us address par jata hai jo claim kiya ja raha hai**, us par",
    "nahi jo account par likha hai. Purane mailbox par code bhejna ye sabit karta",
    "hai ki insaan purana mailbox padh leta hai — sawal wo hai hi nahi.",
  ].join("\n"),
  [
    req({
      name: "Email verify ka code maango",
      method: "POST",
      segments: ["auth", "email", "send-verification"],
      token: CUST,
      body: {},
      description: [
        "Khaali body — account par jo email hai usi ko confirm karta hai.",
        "",
        "⚠️ Pehle se verified email par **`409`** aata hai, na ki ek bekaar code.",
        "Code bhejkar kuch na badalna customer ka waqt aur hamara paisa dono",
        "kharch karta.",
        "",
        "⚠️ Account par email hi na ho to **`422`**, aur message batata hai ki",
        "address bhejna hai — `404` yahan jhooth hota, account to maujood hai.",
        "",
        "Throttle `sendOtp` ke andar hai: 60 second gap, 5 per hour, **target",
        "address** par keyed (IP par nahi). Route par rakhna matlab agla OTP",
        "endpoint bina protection ke chala jata, aur bhoolne par koi error hi",
        "nahi aata.",
        "",
        "Response ka `sentTo` **masked** hai — ye endpoint chori hui session se",
        "bhi chal sakta hai, aur poora address us haath me nayi jaankari hoti.",
      ].join("\n"),
      assert: [
        ...A.custom("code gaya, ya documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 409, 422, 429]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          '  pm.expect(b.data.sentTo, "sentTo").to.be.a("string");',
          '  pm.expect(b.data.sentTo, "masked").to.include("*");',
          '  pm.expect(b.data.isChange, "isChange").to.be.a("boolean");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),

    req({
      name: "Naye email par switch karne ka code",
      method: "POST",
      segments: ["auth", "email", "send-verification"],
      token: CUST,
      body: { email: "{{new_email}}" },
      description: [
        "`email` bhejte hi ye **change** ban jata hai — aur account par abhi kuch",
        "nahi badalta. Address tabhi update hota hai jab code sahi nikle.",
        "",
        "⚠️ Uniqueness usi role ke andar dekhi jati hai (`{ email, role }`), kyunki",
        "poora codebase users ko waise hi dhoondhta hai — ek hi address ka",
        "CUSTOMER aur VENDOR account rakhna supported hai, collision nahi.",
        "",
        "⚠️ Dusre ke paas wo address ho to **`409`**, aur ye check **verify par",
        "dobara** hota hai: dono call ke beech minute nikalte hain, aur utni der",
        "me koi aur wo address le sakta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("change ka code gaya, ya conflict", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 409, 422, 429]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          '  pm.expect(b.data.isChange, "isChange").to.eql(true);',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),

    req({
      name: "Galat code — 401",
      method: "POST",
      segments: ["auth", "email", "verify"],
      token: CUST,
      body: { otp: "000000" },
      description: [
        "`verifyOtp` hash compare karta hai, to galat code match hi nahi karta.",
        "",
        "⚠️ Code ka hash `hashOtp(code, target, purpose)` hai — **purpose fold hota",
        "hai**. Iska matlab: email verify ke liye bheja gaya code login par nahi",
        "chalega, chahe address wahi ho. Bina purpose ke wahi ek address dono ka",
        "input hota aur ek code doosra darwaza khol deta.",
        "",
        "Attempts bhi ginte hain — limit paar hone par `403`, aur code delete.",
      ].join("\n"),
      assert: [
        ...A.custom("galat code refuse hua", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([400, 401, 403, 422]);',
          "pm.expect(pm.response.json().success).to.eql(false);",
        ]),
      ],
    }),

    req({
      name: "Code ke saath verify karo",
      method: "POST",
      segments: ["auth", "email", "verify"],
      token: CUST,
      body: { otp: "{{email_otp}}" },
      description: [
        "Sahi code par address **likha aur verified dono ek hi save me** hota hai.",
        "",
        "⚠️ Do step me karne par ek pal aisa banta jahan naya address padha hota",
        "aur `isEmailVerified: false` — theek wahi haalat jisse nikalne ka raasta",
        "ye feature de raha hai.",
        "",
        "⚠️ `loginType` **nahi** chhua jata. `verifyEmailOTP` use `EMAIL` karta hai",
        "kyunki wo ek sign-in hai; ye nahi — caller ke paas pehle se token hai.",
        "Yahan badalna ek WhatsApp customer ka record sirf isliye badal deta ki",
        "usne apna address confirm kiya.",
        "",
        "⚠️ Code **consume** ho jata hai, to wahi code dobara nahi chalega — warna",
        "ek purana code baad me address phir se badal sakta tha.",
        "",
        "⚠️ `{{email_otp}}` ek asli inbox se aata hai. Collection ise bhar nahi",
        "sakti, isliye iska saved example wahi refusal hai jo khaali/galat code par",
        "aata hai — success ka shape doc me hai.",
      ].join("\n"),
      assert: [
        ...A.custom("verify hua, ya asli refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 400, 401, 403, 409, 422]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          '  pm.expect(b.data.isEmailVerified, "isEmailVerified").to.eql(true);',
          '  pm.expect(b.data.email, "email").to.be.a("string");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),
  ],
);

// ------------------------------------------------------ notification inbox

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

    req({
      name: "Meri notification settings ⭐",
      method: "GET",
      segments: ["notifications", "preferences"],
      token: CUST,
      description: [
        "Teeno channel, **do field ke saath**: `preference` aur `effective`.",
        "",
        "⚠️ Dono isliye, ek nahi. Do alag switch har send ko rokte hain aur wo ek",
        "jaisi cheez nahi hain:",
        "",
        "| Switch | Kiska | Matlab |",
        "|---|---|---|",
        "| `Setting.customer.…` | platform ka | operational kill switch — SMTP down, Meta templates approve nahi |",
        "| `notificationPreferences.email` | insaan ka | *\"mujhe email mat bhejo\"* |",
        "",
        "Sirf `preference` lautana panel se jhooth bolna hota: toggle `true`",
        "dikhta jabki platform ne channel band kar rakha hai. **WhatsApp abhi",
        "platform-wide off hai**, to ye edge case nahi — yahi normal case hai.",
        "`blockedBy` naam leta hai ki kaun rok raha hai: `PLATFORM` ya",
        "`PREFERENCE`.",
        "",
        "⚠️ Jis user ne kabhi settings chhui hi nahi, uske paas ye field hoti hi",
        "nahi — aur wo **on** ginte hain. Read `!== false` hai, `=== true` nahi;",
        "warna har purana account chup ho jata aur feed theek chalti rehti, to",
        "kisi ko pata bhi na chalta.",
        "",
        "`updatedBy` sirf tab bharta hai jab **kisi aur** ne badla ho (admin).",
        "Khud badalne par `updatedAt` hota hai aur `updatedBy: null`.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({ userId: "string", role: "string", audience: "string" }),
        ...A.custom("teeno channel poore shape ke saath", [
          "const c = pm.response.json().data.channels;",
          '["email", "push", "whatsapp"].forEach(function (ch) {',
          '  pm.expect(c[ch], ch).to.be.an("object");',
          '  pm.expect(c[ch].preference, ch + ".preference").to.be.a("boolean");',
          '  pm.expect(c[ch].effective, ch + ".effective").to.be.a("boolean");',
          "  // blockedBy null hai ya do naamon me se ek — kabhi kuch aur nahi.",
          '  pm.expect([null, "PLATFORM", "PREFERENCE"], ch + ".blockedBy")',
          "    .to.include(c[ch].blockedBy);",
          "});",
        ]),
        ...A.custom("effective kabhi preference se aage nahi ja sakta", [
          "const c = pm.response.json().data.channels;",
          '["email", "push", "whatsapp"].forEach(function (ch) {',
          "  if (c[ch].preference === false) {",
          "    // Sirf ALWAYS_DELIVER type hi is niyam ko todta hai, aur wo faisla",
          "    // send ke waqt hota hai — is summary me nahi.",
          '    pm.expect(c[ch].effective, ch + " off hai par effective true").to.eql(false);',
          "  }",
          "  if (c[ch].effective === true) {",
          '    pm.expect(c[ch].blockedBy, ch + " chalu hai par blockedBy set").to.eql(null);',
          "  }",
          "});",
        ]),
      ],
    }),

    req({
      name: "Email band karo",
      method: "PUT",
      segments: ["notifications", "preferences"],
      token: CUST,
      body: { email: false },
      description: [
        "Ek channel, akela.",
        "",
        "⚠️ Response me `preference: false` aata hai **aur `blockedBy:",
        '"PREFERENCE"`** — yani rukavat insaan ki chuni hui hai, platform ki nahi.',
        "Panel ko yahi farq dikhana hota hai.",
        "",
        "⚠️ In-app feed par koi asar nahi. `GET /notifications/get-all` waise hi",
        "chalti rahegi — ye sirf email bhejna band karta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("email band, aur wajah naam lekar", [
          "const c = pm.response.json().data.channels;",
          'pm.expect(c.email.preference, "email.preference").to.eql(false);',
          'pm.expect(c.email.effective, "email.effective").to.eql(false);',
          'pm.expect(c.email.blockedBy, "email.blockedBy").to.eql("PREFERENCE");',
        ]),
        ...A.custom("khud badla, to updatedBy khaali", [
          "const d = pm.response.json().data;",
          'pm.expect(d.updatedBy, "updatedBy").to.eql(null);',
          'pm.expect(d.updatedAt, "updatedAt").to.be.a("string");',
        ]),
      ],
    }),

    req({
      name: "Push bhi band — par email chhua nahi gaya (partial write)",
      method: "PUT",
      segments: ["notifications", "preferences"],
      token: CUST,
      body: { push: false },
      description: [
        "Ye request pichli wali ke **turant baad** chalti hai, aur asli assertion",
        "email par hai: `push` bhejne se email `false` hi rehna chahiye.",
        "",
        "⚠️ Write **partial** hai, jaan-boojh kar. Poora object likhne par ek",
        "purani screen chupchaap wo badlaav palat deti jo abhi doosre device par",
        "hua tha — aur panel me toggle ek waqt me ek hi badalta hai.",
        "",
        "Isiliye service sirf un keys ko chhuti hai jo body me **aayi** hain",
        "(`payload[channel] === undefined` par `continue`), aur kuch na badle to",
        "`updatedAt` bhi nahi chhedti.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("push band hua", [
          "const c = pm.response.json().data.channels;",
          'pm.expect(c.push.preference, "push.preference").to.eql(false);',
        ]),
        ...A.custom("aur email pehle jaisa hi hai — reset nahi hua", [
          "const c = pm.response.json().data.channels;",
          'pm.expect(c.email.preference, "email partial write me reset ho gaya").to.eql(false);',
        ]),
      ],
    }),

    req({
      name: "Khaali body — 422",
      method: "PUT",
      segments: ["notifications", "preferences"],
      token: CUST,
      body: {},
      description: [
        "`.min(1)` — kam se kam ek channel chahiye.",
        "",
        "⚠️ Bina iske khaali body ek chup no-op hoti: `200`, kuch nahi badla, aur",
        "client ko lagta ki ho gaya. Message batata hai ki kya bhejna hai.",
      ].join("\n"),
      assert: [
        ...A.status(422),
        ...A.err(),
        ...A.custom("message batata hai kya bhejna hai", [
          "const m = pm.response.json().message || '';",
          "pm.expect(m.toLowerCase()).to.match(/email|push|whatsapp/);",
        ]),
      ],
    }),

    req({
      name: "Dono wapas on (state restore)",
      method: "PUT",
      segments: ["notifications", "preferences"],
      token: CUST,
      body: { email: true, push: true },
      description: [
        "Collection ko wahi chhodna hai jaisa mila tha.",
        "",
        "⚠️ Bina iske har run seeded customer ko thoda aur chup karta jata, aur",
        "dusri collections (vendor, admin) me notification tests bina wajah fail",
        "hone lagte — ek fixture jo dheere-dheere kharaab hota hai, wo sabse mehnga",
        "kism ki galti hai kyunki wo flakiness jaisi dikhti hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("dono wapas on", [
          "const c = pm.response.json().data.channels;",
          'pm.expect(c.email.preference, "email").to.eql(true);',
          'pm.expect(c.push.preference, "push").to.eql(true);',
        ]),
      ],
    }),
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
