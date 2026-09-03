/**
 * Add the refund endpoints to the customer and vendor collections.
 *
 * ⚠️ **Deliberately not a generator.** `generate-customer-collection.js` rewrites
 * the whole file and only knows about hand-written examples — the 132 + 105
 * examples captured from live runs are not in its source, so a regenerate
 * deletes them and still reports success. That happened once, measured at 15,499
 * lines.
 *
 * Same three guards as `addClaimRequestsToPostman.js`:
 *
 *  1. **Byte-exact round-trip**, checked before writing. These files use CRLF;
 *     re-serialising them with LF reformats every line and buries the real change
 *     in a 20,000-line diff nobody reviews.
 *  2. **Captured example count**, asserted unchanged. Inserting must never cost
 *     an example — they cannot be recovered from source.
 *  3. **Folder numbering**, with a duplicate check. The first attempt at the
 *     claim folders left two folders called `12` in one collection and `19` in
 *     the other: Postman shows them in array order, so nothing errors and nobody
 *     notices.
 *
 *   node scripts/addRefundRequestsToPostman.js           # what would change
 *   node scripts/addRefundRequestsToPostman.js --apply   # change it
 */
const fs = require("fs");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "postman");

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

const json = (body) => ({
  mode: "raw",
  raw: JSON.stringify(body, null, 2),
  options: { raw: { language: "json" } },
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

/** The rule that has to be visible wherever a refund is read. */
const SPLIT_TABLE = [
  "| Field | Customer | Vendor / Outlet | Admin |",
  "|---|:-:|:-:|:-:|",
  "| `split.totalRefund` | ✅ | — | ✅ |",
  "| `split.vendorClawback` · `vendorPromoReversal` | — | ✅ | ✅ |",
  "| `split.platformPromoReversal` · `gatewayFeeAbsorbed` | — | — | ✅ |",
  "| `utr` | ✅ | — | ✅ |",
  "| `vendorNote` | ❌ | apna | ✅ |",
  "| `adminNote` · `overrideReason` | ❌ | ❌ | ✅ |",
  "| `customerId` | ✅ (apna) | ❌ | ✅ |",
  "",
  "> ⚠️ `split` me hamara promo hissa aur wo MDR jo hum khaate hain **usi**",
  "> sub-document par hain jis par `vendorClawback` hai — jo vendor ko sach me",
  "> chahiye. Isiliye ye faisla `refundProjection()` me ek jagah hota hai, har call",
  "> site par yaad nahi rakha jaata.",
].join("\n");

// ---------------------------------------------------------------------------
const customerItems = [
  {
    name: "Refund maango ⭐",
    event: [
      tests(201, [
        "// ── capture into the environment ──",
        "if (pm.response.code < 300) {",
        '  try { const d = pm.response.json().data; if (d._id) pm.environment.set("refund_request_id", String(d._id)); } catch (e) {}',
        "}",
      ]),
    ],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({
        claimId: "{{claim_id}}",
        amount: 810,
        reason: "NOT_HONOURED",
        reasonNote: "The outlet was shut when I got there.",
      }),
      url: url("/refunds", ["refunds"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `isCustomer` — ownership **customer** par check hoti hai, user par nahi,",
        "to ek login saajha karte do log ek doosre ki claim refund nahi kar sakte.",
        "",
        "**Kram hi design hai:**",
        "",
        "```",
        "eligibility → allowance → window → split freeze → request banao → hold lagao",
        "```",
        "",
        "- **Request pehle, hold baad me** — request hi record hai aur hold usse nikalta hai.",
        "- Do tap ka faisla `(transactionId, isOpen)` wala **unique index** karta hai, uske",
        "  upar wala read-then-write check nahi (dono use paas kar jaate hain). Haarne wale ko",
        "  **wahi** request milti hai `reused: true` ke saath — grahak ki taraf se nateeja ek",
        "  hi hai, usne ek baar maanga.",
        "- **Split yahin freeze hota hai.** Mangalwar ko approve aur Guruwar ko paid hone wala",
        "  refund theek wahi paisa hilaye jitna sabne Mangalwar ko maana tha.",
        "",
        "| Field | Zaroori | Notes |",
        "|---|:-:|---|",
        "| `claimId` | ✅ | |",
        "| `amount` | — | **Na do to poora.** Jo figure server ko pehle se pata hai use dobara type karana hi use galat type karane ka tareeka hai |",
        "| `reason` | ✅ | `NOT_HONOURED · OUTLET_CLOSED · WRONG_AMOUNT · SERVICE_ISSUE · DUPLICATE_PAYMENT · CHANGED_MIND · OTHER` |",
        "| `reasonNote` | — | `OTHER` ke saath **zaroori** |",
        "",
        "### Window",
        "",
        "`refund.windowHours` (24) — **`paidAt` se**, claim banne se nahi. Ek ghante chhoda hua",
        "checkout phir pay ho to uski window grahak ke paisa dene se *pehle* shuru ho jaati.",
        "",
        "### ⚠️ `settlementHold`",
        "",
        "Request bante hi lag jaata hai. **Wahi ek line poori \"pehle vendor ko pay kar diya, ab",
        "wapas lo\" wali samasya khatam karti hai** — golden rule",
        "(`72h >= 24 + 24 + 12`) ke chalte refund kabhi us paise ko chhoo hi nahi sakta jo ja chuka ho.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Refund wapas le lo",
    event: [tests(200)],
    request: {
      method: "PATCH",
      header: [],
      url: url("/refunds/{{refund_request_id}}/withdraw", [
        "refunds",
        "{{refund_request_id}}",
        "withdraw",
      ]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `isCustomer` + ownership",
        "",
        "`REQUESTED`, `VENDOR_APPROVED` ya `VENDOR_TIMEOUT` tak. Uske baad **nahi** —",
        "`PROCESSING` ka matlab paisa Razorpay ke paas hai aur wapas lene ko kuch hai hi nahi.",
        "Aisi cancellation maan lene se behtar hai keh dena jo hogi hi nahi (`409`).",
        "",
        "`settlementHold` hattta hai.",
        "",
        "⚠️ Wapas lena allowance me **ginta hai**: raise → outlet dekhe → withdraw → phir raise,",
        "ye outlet ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Meri refunds ⭐",
    event: [tests(200)],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/refunds?page=1&limit=20",
        ["refunds"],
        [
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "open", value: "true", disabled: true },
          { key: "status", value: "COMPLETED", disabled: true },
          { key: "claimCode", value: "{{claim_code}}", disabled: true },
        ],
      ),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — **ek endpoint, teen shapes**",
        "",
        SPLIT_TABLE,
        "",
        "### `statusLabel` — jo grahak dekhta hai",
        "",
        "| Andar | Grahak ko |",
        "|---|---|",
        "| `VENDOR_REJECTED` | Declined by the outlet |",
        "| **`VENDOR_TIMEOUT`** | **Under review by Trydood** |",
        "| `PROCESSING` | On its way to your account |",
        "| `FAILED` | Refund failed — we are on it |",
        "",
        "⚠️ `VENDOR_TIMEOUT` kabhi apne naam se nahi aata — na body me, **na `meta` me**.",
        "Grahak ko ye batana ki outlet ne anasuna kiya ek jhagda shuru karta hai jise phir",
        "platform ko suljhana padta hai, aur wo aisi jaankari nahi jis par wo kuch kar sake.",
        "",
        "`vendorNote` bhi kabhi nahi — wo staff ne staff ke liye likha hai.",
        "",
        "`canWithdraw` response me **bataya** jaata hai; app ko status se andaza nahi lagana",
        "chahiye — jo panel status se nikalega wo naye state judte hi galat hoga.",
        "",
        "Khaali list **`200` + `data: []`**, `404` nahi.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek refund — timeline ke saath",
    event: [tests(200)],
    request: {
      method: "GET",
      header: [],
      url: url("/refunds/{{refund_request_id}}", [
        "refunds",
        "{{refund_request_id}}",
      ]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken`",
        "",
        "**Response:** `refund` · `claim` · **`timeline`** · `viewer`",
        "",
        "Timeline **claim ki** hai, refund ki alag nahi — refund claim ke saath hui ek cheez",
        "hai, aur claim ki kahani wahi jagah hai jahan grahak, outlet aur admin teeno jaate",
        "hain. Alag timeline ka matlab hota join, aur do orderings ko ek saath rakhna.",
        "",
        "### `utr` — wo ek field jo support maangta hai",
        "",
        "Razorpay ka bank reference (`acquirer_data.arn`). Paisa na pahunche to grahak yahi",
        "apne bank ko quote karta hai. `refund.processed` aane par bharta hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Dusre ki claim par refund — 403",
    event: [tests(403, ["// Ownership customer par hai, user par nahi."])],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ claimId: "{{other_customer_claim_id}}", reason: "NOT_HONOURED" }),
      url: url("/refunds", ["refunds"]),
      auth: bearer("customer_token"),
      description:
        "Ownership **customer** par check hoti hai, `userId` par nahi — ek login saajha karte do customer me se ek doosre ki claim refund nahi kar sakta.",
    },
    response: [],
  },
  {
    name: "OTHER bina note — 422",
    event: [tests(422, ["// Closed list ke bahar ka reason free text maangta hai."])],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ claimId: "{{claim_id}}", reason: "OTHER" }),
      url: url("/refunds", ["refunds"]),
      auth: bearer("customer_token"),
      description: [
        "`reason` closed list hai kyunki wahi ek field hai jis par report group ho sakti hai —",
        "*\"is brand ki 40% refunds NOT_HONOURED hain\"* ek vendor conversation hai; hazaar alag",
        "vaakya nahi. `OTHER` free text uthata hai, aur uske bina 422.",
      ].join("\n"),
    },
    response: [],
  },
];

const vendorItems = [
  {
    name: "Refund worklist ⭐",
    event: [tests(200)],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/refunds?open=true&page=1&limit=20",
        ["refunds"],
        [
          { key: "open", value: "true" },
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "outletId", value: "{{sub_brand_id}}", disabled: true },
        ],
      ),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — `VENDOR` aur `SUB_VENDOR` dono. Outlet token isi URL",
        "par **sirf apne outlet** ki rows paata hai.",
        "",
        "`?open=true` par **sabse purani upar** — wahi timeout ke sabse kareeb hai aur usi",
        "grahak ne sabse lamba intezaar kiya. Bina uske sabse nayi upar (history browse karne",
        "ke liye).",
        "",
        SPLIT_TABLE,
        "",
        "`canDecide` response me bataya jaata hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Refund approve karo ⭐",
    event: [tests(200)],
    request: {
      method: "PATCH",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ approvedAmount: 400, note: "Only the starter was wrong." }),
      url: url("/refunds/{{refund_request_id}}/approve", [
        "refunds",
        "{{refund_request_id}}",
        "approve",
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — apne brand ka, aur `SUB_VENDOR` ke liye apne outlet ka",
        "",
        "### ⚠️ Rakam **ghat** sakti hai, **badh nahi**",
        "",
        "*\"Aadha order theek tha, starter nahi\"* asli jawab hai, aur rakam kam karna use dene",
        "ka tareeka hai. Badhana grahak ne jo maanga uski approval nahi — wo naya faisla hai,",
        "aur is step par ek extra shunya **das guna** pay out kar deta us aadmi ko jisne maanga",
        "hi nahi. `422` milega.",
        "",
        "`approvedAmount` na do to poora. `requestedAmount` kabhi overwrite nahi hota — antar",
        "dikhta rehta hai, kyunki wo baad me kisi ko samjhana pad sakta hai.",
        "",
        "**Split wahin dobara freeze hota hai** — jo paisa asal me hilega wahi block me likha",
        "hona chahiye.",
        "",
        "### Do log ek hi request nahi tay kar sakte",
        "",
        "`status` update filter ka hissa hai. Owner aur outlet manager ek hi request dekh sakte",
        "hain; iske bina dono clicks lagte aur doosra pehle ko chup-chaap mita deta — yaani",
        "grahak ka jawab is par nirbhar karta ki kaun dheema tha. Haarne wale ko `409` milta hai",
        "jo **batata hai kya hua**: *\"already been decided (vendor approved)\"* ya",
        "*\"already gone to Trydood for review\"*. Dono ke aage ke kadam alag hain.",
        "",
        "Hold **laga rehta hai** — paisa abhi bhi wapas jaana hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Refund reject karo",
    event: [tests(200)],
    request: {
      method: "PATCH",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ note: "Customer collected the order in full." }),
      url: url("/refunds/{{refund_request_id}}/reject", [
        "refunds",
        "{{refund_request_id}}",
        "reject",
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken` — apne brand ka",
        "",
        "`note` **zaroori** (min 3 chars). Jab grahak inkaar ko chunauti de, admin ke paas",
        "sameeksha karne ko yahi ek cheez hoti hai — akela *\"rejected\"* har appeal ko phone",
        "call bana deta hai.",
        "",
        "⚠️ Aapka note **grahak ko kabhi nahi dikhta**. Wo staff ke liye hai.",
        "",
        "### `settlementHold` yahin hattta hai",
        "",
        "Refund maangte hi aapke us claim ka paisa har settlement se bahar ho jaata hai. Reject",
        "karne par wo **wapas aa jaata hai**.",
        "",
        "> ⚠️ Ulta utna hi khatarnak hai: **jo hold koi na hataaye wo aapka paisa hamesha ke liye",
        "> har aane wali settlement se bahar kar deta hai — chup-chaap**, kyunki eligibility",
        "> predicate bas match karna band kar deta hai. Koi error nahi aata, koi log nahi. Isiliye",
        "> teeno terminal states (`VENDOR_REJECTED`, `ADMIN_REJECTED`, `CANCELLED`) se release",
        "> bulaya jaata hai — aur `FAILED` / `COMPLETED` se **nahi**: pehle me paisa abhi bhi",
        "> wapas jaana hai, doosre me wo aapka tha hi nahi.",
        "",
        "Ek apwaad: us payment par **chargeback** khula ho to hold nahi hattta. Use hataana",
        "explicit admin action hai — refund ki logic se hataane ka matlab hota wo paisa settle",
        "kar dena jise bank usi waqt wapas kheench raha hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek refund — claim aur timeline ke saath",
    event: [tests(200)],
    request: {
      method: "GET",
      header: [],
      url: url("/refunds/{{refund_request_id}}", [
        "refunds",
        "{{refund_request_id}}",
      ]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** 🔒 `verifyJwtToken`",
        "",
        "`refund` · `claim` · **`timeline`** · `viewer`. Timeline har audience ke liye",
        "**banayi** jaati hai, chhaani nahi — kaccha audit row `snapshot` me poora pricing",
        "block rakhta hai (`platformPromoCost` samet) aur `reason` staff ka note hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Approve karne ki koshish, jab rakam badha rahe ho — 422",
    event: [tests(422)],
    request: {
      method: "PATCH",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ approvedAmount: 8100 }),
      url: url("/refunds/{{refund_request_id}}/approve", [
        "refunds",
        "{{refund_request_id}}",
        "approve",
      ]),
      auth: bearer("vendor_token"),
      description:
        "Ek extra shunya das guna pay out kar deta us aadmi ko jisne maanga hi nahi. Jawab naam lekar batata hai: *\"The customer asked for ₹810.00. You can approve that or less, not more.\"*",
    },
    response: [],
  },
  {
    name: "Dusre brand ki refund — 403",
    event: [tests(403)],
    request: {
      method: "PATCH",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: json({ note: "Not ours." }),
      url: url("/refunds/{{other_brand_refund_id}}/reject", [
        "refunds",
        "{{other_brand_refund_id}}",
        "reject",
      ]),
      auth: bearer("vendor_token"),
      description:
        "Faisla lena padhne se strong action hai, isliye gate usse dheela nahi ho sakta — `SUB_VENDOR` ko dusre outlet ki refund par bhi 403 milta hai.",
    },
    response: [],
  },
];

const FOLDERS = [
  {
    file: "trydood-customer.postman_collection.json",
    folder: {
      name: "00 — Refunds",
      description: [
        "Paisa wapas maangna, aur uska kya hua.",
        "",
        "Grahak maange → **outlet tay kare** → Trydood nikaale. Trydood normal raaste par",
        "doosra gate nahi hai.",
      ].join("\n"),
      item: customerItems,
    },
  },
  {
    file: "trydood-vendor.postman_collection.json",
    folder: {
      name: "00 — Refunds",
      description: [
        "**Aap tay karte hain, Trydood sirf nikaalta hai.**",
        "",
        "Aapke paas `refund.vendorApprovalHours` (24) ki window hai. Beet gayi to request",
        "aapki rehti hi nahi — Trydood ke paas chali jaati hai. Do reminder pehle aate hain,",
        "taaki timeout kabhi achanak na ho.",
      ].join("\n"),
      item: vendorItems,
    },
  },
];

// ---------------------------------------------------------------------------

const countExamples = (items) =>
  items.reduce(
    (sum, i) => sum + (i.item ? countExamples(i.item) : (i.response || []).length),
    0,
  );

const countRequests = (items) =>
  items.reduce((sum, i) => sum + (i.item ? countRequests(i.item) : 1), 0);

let changed = 0;

for (const { file, folder } of FOLDERS) {
  const full = path.join(DIR, file);
  const raw = fs.readFileSync(full, "utf8");
  const collection = JSON.parse(raw);

  const roundTrip = `${JSON.stringify(collection, null, 2).replace(/\n/g, "\r\n")}\r\n`;
  if (roundTrip !== raw) {
    console.error(
      `❌ ${file}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
    );
    process.exitCode = 1;
    continue;
  }

  if (collection.item.some((i) => /Refunds/.test(i.name))) {
    console.log(`⏭️  ${file}: a Refunds folder is already present — nothing to do.`);
    continue;
  }

  const beforeExamples = countExamples(collection.item);
  const beforeRequests = countRequests(collection.item);

  /**
   * Inserted before the access-control folder, which is deliberately last, and
   * that folder is renumbered. The new folder **takes** its slot — numbering it
   * independently is how two folders ended up sharing a number last time.
   */
  const accessIndex = collection.item.findIndex((i) => /Access control/i.test(i.name));
  if (accessIndex === -1) {
    collection.item.push(folder);
  } else {
    const access = collection.item[accessIndex];
    const slot = parseInt(access.name, 10);
    folder.name = folder.name.replace(/^\d+/, String(slot).padStart(2, "0"));
    access.name = access.name.replace(/^\d+/, String(slot + 1).padStart(2, "0"));
    collection.item.splice(accessIndex, 0, folder);
  }

  const numbers = collection.item.map((i) => i.name.slice(0, 2));
  const duplicated = numbers.filter((n, idx) => numbers.indexOf(n) !== idx);
  if (duplicated.length) {
    console.error(`❌ ${file}: duplicate folder number(s) ${duplicated.join(", ")}.`);
    process.exitCode = 1;
    continue;
  }

  const afterExamples = countExamples(collection.item);
  if (afterExamples !== beforeExamples) {
    console.error(
      `❌ ${file}: captured examples changed ${beforeExamples} → ${afterExamples}. Refusing to write.`,
    );
    process.exitCode = 1;
    continue;
  }

  console.log(
    `${APPLY ? "✅" : "🔍"} ${file}: +${folder.item.length} requests ` +
      `(${beforeRequests} → ${countRequests(collection.item)}), examples unchanged at ${afterExamples}`,
  );

  if (APPLY) {
    fs.writeFileSync(
      full,
      `${JSON.stringify(collection, null, 2).replace(/\n/g, "\r\n")}\r\n`,
      "utf8",
    );
    changed += 1;
  }
}

console.log(
  APPLY ? `\n✅ ${changed} collection(s) updated.` : "\n🔍 Dry run. Re-run with --apply to write.",
);
