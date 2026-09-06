/**
 * Add the two new logout modes to the customer collection.
 *
 * Same guards as the other insert scripts — byte-exact CRLF round-trip and an
 * unchanged captured-example count. `generate-customer-collection.js` would
 * delete all 132 examples, so nothing here regenerates.
 *
 * ⚠️ The existing `6. Logout` request and its one captured example are left
 * **exactly** as they are. That request (empty body) is still a valid call and
 * worth keeping as a regression test — but its example is now **stale**: it was
 * captured when logout returned `"data": {}`, and the response now carries
 * `sessionsEnded`, `pushDeactivated` and `activeDevices`. Only a real run can
 * fix that, which needs newman. Rewriting the example by hand is exactly what
 * this repo does not do: a hand-written example goes out of date invisibly, and
 * a wrong one looks identical to a right one.
 *
 *   node scripts/addLogoutRequestsToPostman.js           # what would change
 *   node scripts/addLogoutRequestsToPostman.js --apply   # change it
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "postman");
const COLLECTION = "trydood-customer.postman_collection.json";

const tests = (code, extra = []) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `pm.test("HTTP ${code}", function () {`,
      `  pm.response.to.have.status(${code});`,
      "});",
      "",
      `pm.test("${code < 300 ? "success" : "failure"} envelope", function () {`,
      "  const b = pm.response.json();",
      `  pm.expect(b.success, "success flag").to.eql(${code < 300});`,
      '  pm.expect(b.message, "message").to.be.a("string").and.not.empty;',
      "});",
      ...(extra.length ? ["", ...extra] : []),
    ],
  },
});

const request = (body, description, extraTests) => ({
  event: [tests(200, extraTests)],
  request: {
    method: "POST",
    header: [{ key: "Content-Type", value: "application/json" }],
    body: {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    },
    url: {
      raw: "{{base_url}}/auth/logout",
      host: ["{{base_url}}"],
      path: ["auth", "logout"],
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{customer_token}}", type: "string" }],
    },
    description,
  },
  response: [],
});

const ITEMS = [
  {
    name: "6a. Logout — is device ka push bhi band 🆕",
    ...request(
      { pushToken: "{{push_token}}" },
      [
        "**Access:** 🔒 `verifyJwtTokenEvenIfDeactivated` — suspended account bhi sign out kar sake.",
        "",
        "App wahi FCM token bhejti hai jo usne `POST /deviceTokens/register` par bheja tha, aur",
        "usi device ke notifications band ho jaate hain. Pehle iske liye alag se",
        "`PUT /deviceTokens/unregister` maarna padta tha — ab ek call kaafi hai.",
        "",
        "| Response field | Kya |",
        "|---|---|",
        "| `pushDeactivated` | Kitne devices retire hue. `pushToken` na bheja to `0` |",
        "| `activeDevices` | Ab kitne devices par push chalu hai. `null` = push chhua hi nahi |",
        "| `sessionsEnded` | Yahan hamesha `false` — saada logout token invalidate nahi karta |",
        "",
        "⚠️ **Anjaan ya pehle se retire token error nahi hai** — `pushDeactivated: 0` aata hai aur",
        "logout phir bhi safal. Client retry kar raha ho, ya provider ne token pehle hi mar diya",
        "ho, to logout us wajah se fail nahi hona chahiye.",
        "",
        "⚠️ **Filter me hamesha `userId` hota hai**, to ek user doosre ka device chup nahi kara",
        "sakta — kisi aur ka token bhejne par bhi `0`.",
        "",
        "⚠️ **Aapka JWT phir bhi zinda hai.** Wo stateless hai aur expiry tak valid rehta hai —",
        "app ko use khud delete karna hai. Sirf `allDevices` tokens marta hai (agla request).",
      ].join("\n"),
      [
        'pm.test("push chhua gaya, aur session nahi mara", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d, "pushDeactivated").to.have.property("pushDeactivated");',
        '  pm.expect(d.sessionsEnded, "sessionsEnded").to.eql(false);',
        "});",
      ],
    ),
  },
  {
    name: "6b. Logout — sab devices se (kho gaya phone) 🆕",
    ...request(
      { allDevices: true },
      [
        "**Access:** 🔒 `verifyJwtTokenEvenIfDeactivated`",
        "",
        "Har device se sign out — phone, tablet, sab. Ye kho gaye phone ka jawab hai, aur pehle",
        "iska koi raasta tha hi nahi.",
        "",
        "Do cheezein hoti hain jo saade logout me nahi hotin:",
        "",
        "1. `User.sessionInvalidatedAt` stamp hota hai — **ab se pehle bana har JWT refuse hone",
        "   lagta hai**, `401 \"Your session has ended. Please log in again.\"` ke saath.",
        "2. Us user ke **saare** push devices retire ho jaate hain.",
        "",
        "⚠️ **Jis token se aapne ye call kiya wo bhi mar jaata hai.** Iske baad is collection ka",
        "koi bhi gated request `401` dega jab tak `00 — Setup & Auth` dobara chal kar naya token",
        "capture na kar le. Isiliye ye request folder ke aakhir me hai.",
        "",
        "⚠️ Session kill `iat` (seconds) par \"strictly before\" compare karta hai, to **usi second",
        "me** bana token bach jaata hai. Ye jaan-boojh kar hai — stamp ko truncate karna, token ko",
        "pad karne se behtar hai: sahi session ko galti se maarne ki bajaay ek second ki dhil.",
        "Practically kabhi nahi dikhta, kyunki token login par banta hai aur logout minton baad.",
      ].join("\n"),
      [
        'pm.test("sab devices, aur session sach me mara", function () {',
        "  const d = pm.response.json().data;",
        '  pm.expect(d.allDevices, "allDevices").to.eql(true);',
        '  pm.expect(d.sessionsEnded, "sessionsEnded").to.eql(true);',
        "});",
        "",
        'pm.test("message batata hai ki sab devices se hua", function () {',
        '  pm.expect(pm.response.json().message).to.match(/all devices/i);',
        "});",
        "",
        "// This token is dead now. Anything after this needs a fresh sign-in.",
        'pm.environment.unset("customer_token");',
      ],
    ),
  },
];

// ---------------------------------------------------------------------------
const serialize = (obj) =>
  `${JSON.stringify(obj, null, 2).replace(/\n/g, "\r\n")}\r\n`;

const countExamples = (list) =>
  list.reduce(
    (sum, i) =>
      sum + (i.item ? countExamples(i.item) : (i.response || []).length),
    0,
  );

const full = path.join(DIR, COLLECTION);
const raw = fs.readFileSync(full, "utf8");
const collection = JSON.parse(raw);

if (serialize(collection) !== raw) {
  console.error(
    `[x] ${COLLECTION}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
  );
  process.exit(1);
}

const folder = collection.item.find((i) => /Setup & Auth/i.test(i.name));
if (!folder) {
  console.error(`[x] ${COLLECTION}: "Setup & Auth" folder not found.`);
  process.exit(1);
}

if (folder.item.some((i) => /^6a\./.test(i.name))) {
  console.log(`[skip] ${COLLECTION}: logout requests already present.`);
  process.exit(0);
}

const before = countExamples(collection.item);

// Straight after the existing plain logout, which stays untouched — and last in
// the folder, because 6b throws the token away.
const at = folder.item.findIndex((i) => /Logout/i.test(i.name));
folder.item.splice(at === -1 ? folder.item.length : at + 1, 0, ...ITEMS);

const after = countExamples(collection.item);
if (after !== before) {
  console.error(
    `[x] ${COLLECTION}: captured examples changed ${before} -> ${after}. Refusing to write.`,
  );
  process.exit(1);
}

console.log(
  `${APPLY ? "[ok]" : "[dry]"} ${COLLECTION}: +${ITEMS.length} requests in "${folder.name}", examples unchanged at ${after}`,
);
ITEMS.forEach((i) => console.log(`        - ${i.name}`));

if (APPLY) {
  fs.writeFileSync(full, serialize(collection), "utf8");
  console.log("written. Validate with postman/lib/validate-collection.js");
} else {
  console.log("Dry run. Re-run with --apply to write.");
}
