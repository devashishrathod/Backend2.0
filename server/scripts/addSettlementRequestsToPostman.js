/**
 * Add the vendor-facing settlement endpoints to the vendor collection.
 *
 * ⚠️ **Deliberately not a generator.** `generate-vendor-collection.js` rewrites
 * the whole file and only knows about hand-written examples — the examples
 * captured from live runs are not in its source, so a regenerate deletes them
 * and still reports success. That happened once, measured at 15,499 lines across
 * the two collections.
 *
 * Same three guards as `addRefundRequestsToPostman.js`:
 *
 *  1. **Byte-exact round-trip**, checked before writing. These files use CRLF;
 *     re-serialising with LF reformats every line and buries the real change in
 *     a 20,000-line diff nobody reviews.
 *  2. **Captured example count**, asserted unchanged. Inserting must never cost
 *     an example — they cannot be recovered from source.
 *  3. **Folder numbering**, with a duplicate check. The new folder *takes* the
 *     access-control folder's slot rather than being numbered independently —
 *     that is how two folders ended up sharing a number last time, and Postman
 *     shows them in array order so nothing errors and nobody notices.
 *
 * ### Why only three requests
 *
 * A settlement has twelve endpoints and **nine of them are admin writes**. There
 * is no admin collection yet (phase 3), and putting an `isAdmin` route into the
 * vendor collection would mean a folder whose every request 403s by design —
 * which trains whoever runs the suite to ignore red. The three reads are the
 * whole vendor-facing surface.
 *
 *   node scripts/addSettlementRequestsToPostman.js           # what would change
 *   node scripts/addSettlementRequestsToPostman.js --apply   # change it
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "postman");
const FILE = "trydood-vendor.postman_collection.json";

const url = (raw, pathParts, query = []) => ({
  raw: `{{base_url}}${raw}`,
  host: ["{{base_url}}"],
  path: pathParts,
  ...(query.length ? { query } : {}),
});

const bearer = (token) => ({
  type: "bearer",
  bearer: [{ key: "token", value: `{{${token}}}`, type: "string" }],
});

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

/**
 * The one assertion worth repeating on every settlement read.
 *
 * Our margin sits on the same documents as the figures the vendor legitimately
 * needs — `netReceived` beside `vendorPayable`, the full bank account beside the
 * last four digits — so the leak these guard against is a field appearing, not a
 * request failing. A 200 proves nothing here.
 */
const NO_MARGIN_LEAK = [
  'pm.test("hamara margin aur poora bank account nahi bheja jaata", function () {',
  "  const rows = pm.response.json().data;",
  "  const list = Array.isArray(rows) ? rows : [rows.settlement || rows];",
  "  list.forEach(function (row) {",
  "    if (!row) return;",
  '    pm.expect(row, "needsRevalidation").to.not.have.property("needsRevalidation");',
  '    pm.expect(row, "taintedTransactionIds").to.not.have.property("taintedTransactionIds");',
  '    pm.expect(row, "failureNote").to.not.have.property("failureNote");',
  '    pm.expect(row, "approvedBy").to.not.have.property("approvedBy");',
  '    pm.expect(row, "idempotencyKey").to.not.have.property("idempotencyKey");',
  "    if (row.bankSnapshot) {",
  '      pm.expect(row.bankSnapshot, "ifscCode").to.not.have.property("ifscCode");',
  '      pm.expect(row.bankSnapshot, "accountHolderName").to.not.have.property("accountHolderName");',
  '      pm.expect(row.bankSnapshot, "maskedAccountNumber").to.not.have.property("maskedAccountNumber");',
  "    }",
  "  });",
  "});",
];

const vendorItems = [
  {
    name: "Mere payouts",
    event: [
      tests(200, [
        ...NO_MARGIN_LEAK,
        "",
        'pm.test("vendor ko enum nahi, plain language milti hai", function () {',
        "  const rows = pm.response.json().data;",
        "  rows.forEach(function (row) {",
        '    pm.expect(row.statusLabel, "statusLabel").to.be.a("string").and.not.empty;',
        '    pm.expect(row.statusLabel, "raw enum leaked").to.not.eql(row.status);',
        "  });",
        "});",
        "",
        'pm.test("vendor ko koi action offer nahi hota", function () {',
        "  pm.response.json().data.forEach(function (row) {",
        '    pm.expect(row.canApprove, "canApprove").to.eql(false);',
        '    pm.expect(row.canPay, "canPay").to.eql(false);',
        '    pm.expect(row.canRetry, "canRetry").to.eql(false);',
        "  });",
        "});",
        "",
        "const first = pm.response.json().data[0];",
        "if (first) pm.collectionVariables.set(\"settlement_id\", first._id);",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/settlements?page=1&limit=20", ["settlements"], [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "status", value: "PAID", disabled: true },
        { key: "open", value: "true", disabled: true },
        { key: "from", value: "2026-08-01", disabled: true },
        { key: "to", value: "2026-08-31", disabled: true },
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — `VENDOR` aur `SUB_VENDOR` dono",
        "",
        "`SUB_VENDOR` ko is baar **poora brand** dikhta hai, apna outlet nahi: settlement",
        "poore brand ke ek din ka hai, aur outlet se kaat kar dikhane ka matlab ek aisa",
        "figure jo unke dekhe kisi bhi cheez se match nahi karta.",
        "",
        "**Khaali list `404` nahi deti.** Pehle hafte wale brand ke paas koi settlement nahi",
        "hoti — wo bilkul sahi jawab hai, aur use \"kuchh gadbad hai\" jaisa dikhana galat.",
        "",
        "Sort `periodEnd` desc: ye list *\"pichhle hafte ka paisa aaya?\"* ka jawab dene ke",
        "liye padhi jaati hai.",
        "",
        "| Aapko | Aapko nahi |",
        "|---|---|",
        "| `netPayable` · `grossCollected` · `commissionAmount` | `needsRevalidation` |",
        "| `bankSnapshot.accountLast4Digits` · `bankName` | `taintedTransactionIds` |",
        "| `failureReason` (category) | `failureNote` (staff note) |",
        "| `statusLabel` | `approvedBy` · `idempotencyKey` |",
        "",
        "⚠️ Doosre brand ka `brandId` bhejne par **khaali page** milta hai, apne rows nahi.",
        "Scope aur filter kaate jaate hain, upar-neeche rakhe nahi — filter ka \"chal gaya\"",
        "dikhna wahi tareeka hai jisse koi aisi report bana leta hai jo kabhi lagi hi nahi thi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek payout, legs ke saath",
    event: [
      tests(200, [
        ...NO_MARGIN_LEAK,
        "",
        'pm.test("legs UTR ke saath aati hain", function () {',
        "  const legs = pm.response.json().data.legs;",
        '  pm.expect(legs, "legs").to.be.an("array");',
        "  legs.forEach(function (leg) {",
        '    pm.expect(leg, "legNumber").to.have.property("legNumber");',
        "  });",
        "});",
        "",
        'pm.test("staff ka note timeline me nahi hai", function () {',
        "  pm.response.json().data.timeline.forEach(function (row) {",
        '    pm.expect(row, "reason").to.not.have.property("reason");',
        '    pm.expect(row, "performedBy").to.not.have.property("performedBy");',
        '    pm.expect(row, "snapshot").to.not.have.property("snapshot");',
        "  });",
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/settlements/{{settlement_id}}", [
        "settlements",
        "{{settlement_id}}",
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — apne brand ka",
        "",
        "`settlement` · **`legs`** · `timeline` · `viewer`.",
        "",
        "### `legs` — yahan UTR milta hai",
        "",
        "Ek payout do NEFT me bhi ja sakta hai (badi rakam), aur bounce ke baad retry",
        "**nayi leg** banata hai — purani mitayi nahi jaati, taaki record me dono",
        "koshishen bachein. Har leg apna `utr`, `mode`, `paidAt` aur `amount` rakhti hai.",
        "",
        "**UTR wahi ek cheez hai** jo aap teen din baad apne bank statement par dhoondh",
        "sakte hain jab paisa nahi dikhta. Isi liye ek `payoutUtr` field kaafi nahi thi.",
        "",
        "Timeline me `reason` / `performedBy` / `snapshot` **sirf admin ko** jaate hain:",
        "wo notes staff ne staff ke liye likhe hain aur aksar kisi aise dispute ka naam",
        "lete hain jispar faisla hua hi nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Statement lines — is payout me kya-kya tha",
    event: [
      tests(200, [
        'pm.test("hamara margin statement par nahi hai", function () {',
        "  pm.response.json().data.forEach(function (row) {",
        '    pm.expect(row, "gatewayFee").to.not.have.property("gatewayFee");',
        '    pm.expect(row, "netReceived").to.not.have.property("netReceived");',
        "    if (row.voucher) {",
        '      pm.expect(row.voucher, "platformPromoCost").to.not.have.property("platformPromoCost");',
        "    }",
        "  });",
        "});",
      ]),
    ],
    request: {
      method: "GET",
      header: [],
      url: url("/settlements/{{settlement_id}}/transactions?page=1&limit=50", [
        "settlements",
        "{{settlement_id}}",
        "transactions",
      ], [
        { key: "page", value: "1" },
        { key: "limit", value: "50" },
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — apne brand ka",
        "",
        "Alag se paged, kyunki vyast brand ka ek cycle sau-sau rows ka hota hai aur detail",
        "call zyadatar sirf *\"kitna, aur kab\"* ke liye padha jaata hai.",
        "",
        "⚠️ `voucher.platformPromoCost`, `gatewayFee` aur `netReceived` aapko **nahi** milte —",
        "wo hamara margin hai, aur wo **usi sub-document par** baitha hai jispar aapka",
        "`vendorPayable` hai. Isi liye ye faisla ek jagah hota hai.",
        "",
        "`fundsReceivedAt` **`verifiedAt` se alag** hai: pehla matlab Razorpay ne hamare bank",
        "me paisa bheja, doosra matlab grahak ne pay kiya. T+N **pehli** se ginta hai — warna",
        "hum wo paisa baant rahe hote jo abhi aaya hi nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Doosre brand ki settlement — 403",
    event: [tests(403)],
    request: {
      method: "GET",
      header: [],
      url: url("/settlements/{{other_brand_settlement_id}}", [
        "settlements",
        "{{other_brand_settlement_id}}",
      ]),
      auth: bearer("vendor_token"),
      description: [
        "Detail par `403`, listing par **khaali page** — aur wo farq jaan-boojh kar hai.",
        "",
        "Listing ek sawaal hai (*\"in sharton par kya hai?\"*) aur uska sahi jawab \"kuchh nahi\"",
        "ho sakta hai. Detail ek naam liya hua record hai, aur uska sahi jawab \"aap ise nahi",
        "dekh sakte\" hai.",
      ].join("\n"),
    },
    response: [],
  },
];

const FOLDER = {
  name: "00 — Settlements",
  description: [
    "**Aapka record, aapka form nahi.**",
    "",
    "Settlement par vendor ke liye koi write endpoint nahi hai — na approve, na dispute,",
    "na edit. Ye hamara record hai ki hum aapko kya de rahe hain. Ikhtilaf support se",
    "hota hai, kyunki uske peechhe aksar koi disputed payment hota hai jispar faisla",
    "abhi hua hi nahi.",
    "",
    "Poora flow → `docs/settlement_flow.md`.",
  ].join("\n"),
  item: vendorItems,
};

// ---------------------------------------------------------------------------

const countExamples = (items) =>
  items.reduce(
    (sum, i) => sum + (i.item ? countExamples(i.item) : (i.response || []).length),
    0,
  );

const countRequests = (items) =>
  items.reduce((sum, i) => sum + (i.item ? countRequests(i.item) : 1), 0);

const full = path.join(DIR, FILE);
const raw = fs.readFileSync(full, "utf8");
const collection = JSON.parse(raw);

const roundTrip = `${JSON.stringify(collection, null, 2).replace(/\n/g, "\r\n")}\r\n`;
if (roundTrip !== raw) {
  console.error(
    `❌ ${FILE}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
  );
  process.exit(1);
}

if (collection.item.some((i) => /Settlements/.test(i.name))) {
  console.log(`⏭️  ${FILE}: a Settlements folder is already present — nothing to do.`);
  process.exit(0);
}

const beforeExamples = countExamples(collection.item);
const beforeRequests = countRequests(collection.item);

/**
 * Inserted before the access-control folder, which is deliberately last, and
 * that folder is renumbered. The new folder **takes** its slot.
 */
const accessIndex = collection.item.findIndex((i) => /Access control/i.test(i.name));
if (accessIndex === -1) {
  collection.item.push(FOLDER);
} else {
  const access = collection.item[accessIndex];
  const slot = parseInt(access.name, 10);
  FOLDER.name = FOLDER.name.replace(/^\d+/, String(slot).padStart(2, "0"));
  access.name = access.name.replace(/^\d+/, String(slot + 1).padStart(2, "0"));
  collection.item.splice(accessIndex, 0, FOLDER);
}

const numbers = collection.item.map((i) => i.name.slice(0, 2));
const duplicated = numbers.filter((n, idx) => numbers.indexOf(n) !== idx);
if (duplicated.length) {
  console.error(`❌ ${FILE}: duplicate folder number(s) ${duplicated.join(", ")}.`);
  process.exit(1);
}

const afterExamples = countExamples(collection.item);
if (afterExamples !== beforeExamples) {
  console.error(
    `❌ ${FILE}: captured examples changed ${beforeExamples} → ${afterExamples}. Refusing to write.`,
  );
  process.exit(1);
}

console.log(
  `${APPLY ? "✅" : "🔍"} ${FILE}: +${FOLDER.item.length} requests ` +
    `(${beforeRequests} → ${countRequests(collection.item)}), examples unchanged at ${afterExamples}`,
);

if (APPLY) {
  fs.writeFileSync(
    full,
    `${JSON.stringify(collection, null, 2).replace(/\n/g, "\r\n")}\r\n`,
    "utf8",
  );
  console.log("\n✅ 1 collection updated.");
} else {
  console.log("\n🔍 Dry run. Re-run with --apply to write.");
}
