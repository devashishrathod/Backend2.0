/**
 * The two account surfaces every role shares: confirming an email address, and
 * switching notification channels on and off.
 *
 * ### ⚠️ Why these are factories and not two copies
 *
 * Both features are deliberately **role-agnostic** in the code. A customer, a
 * vendor, an outlet manager and an admin all have exactly one `User`, so
 * `POST /auth/email/verify` and `PUT /notifications/preferences` are one
 * operation for all of them — the services read the id off the token and there
 * is no role gate on either route.
 *
 * Writing them once per collection would put the same twelve requests in two
 * files, and the next change to either endpoint would have to be made twice.
 * That is the same failure the services themselves avoid by not branching on
 * role, and the reason `/notifications/get-all` is one endpoint rather than a
 * customer twin. Only the token variable and the folder number differ.
 */

const { req, folder, A } = require("./builders");

// ------------------------------------------------------ email verification

/**
 * @param {object} args
 * @param {string} args.name   the folder's numbered title in this collection
 * @param {string} args.token  environment variable holding the bearer token
 */
const emailVerificationFolder = ({ name, token }) =>
  folder(
    name,
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
        token,
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
        token,
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
        token,
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
        token,
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

// -------------------------------------------------- notification preferences

/**
 * The five requests that exercise the channel toggles.
 *
 * Returned as a bare list rather than a folder, because each collection files
 * them alongside its own notification feed rather than in a folder of their
 * own — the feed and the toggles are one screen to the person using them.
 *
 * ⚠️ The order is load-bearing: "email band karo" then "push bhi band" is what
 * proves the write is **partial**, and the last request puts both back so a
 * re-run starts where the previous one did.
 */
const notificationPreferenceRequests = ({ token }) => [
  req({
    name: "Meri notification settings ⭐",
    method: "GET",
    segments: ["notifications", "preferences"],
    token,
    description: [
      "Teeno channel, **do field ke saath**: `preference` aur `effective`.",
      "",
      "⚠️ Dono isliye, ek nahi. Do alag switch har send ko rokte hain aur wo ek",
      "jaisi cheez nahi hain:",
      "",
      "| Switch | Kiska | Matlab |",
      "|---|---|---|",
      "| `Setting.<audience>.…` | platform ka | operational kill switch — SMTP down, Meta templates approve nahi |",
      '| `notificationPreferences.email` | insaan ka | *"mujhe email mat bhejo"* |',
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
    token,
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
    token,
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
    token,
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
    token,
    body: { email: true, push: true },
    description: [
      "Collection ko wahi chhodna hai jaisa mila tha.",
      "",
      "⚠️ Bina iske har run seeded account ko thoda aur chup karta jata, aur",
      "dusri collections me notification tests bina wajah fail hone lagte — ek",
      "fixture jo dheere-dheere kharaab hota hai, wo sabse mehngi kism ki galti",
      "hai kyunki wo flakiness jaisi dikhti hai.",
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
];

module.exports = { emailVerificationFolder, notificationPreferenceRequests };
