/**
 * Add the voucher-claim endpoints to the customer and vendor collections.
 *
 * ⚠️ **Deliberately not a generator.**
 *
 * `generate-customer-collection.js` rewrites the whole file, and it only knows
 * about hand-written examples — the 132 + 105 examples captured from live runs
 * are not in its source, so a regenerate deletes them and still reports success.
 * That happened once already, measured at 15,499 lines.
 *
 * So this script **only inserts**. It parses, appends items, and writes back with
 * `JSON.stringify(…, 2)` + CRLF, which is a byte-exact round-trip of both files —
 * verified before writing. Anything it did not add is untouched, and the captured
 * example count is asserted unchanged on the way out.
 *
 * Dry-run by default, like every script here:
 *
 *   node scripts/addClaimRequestsToPostman.js           # what would change
 *   node scripts/addClaimRequestsToPostman.js --apply   # change it
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

/** The success-envelope assertions every request in these collections carries. */
const envelopeTests = (extra = []) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      'pm.test("HTTP 200", function () {',
      "  pm.response.to.have.status(200);",
      "});",
      "",
      'pm.test("success envelope", function () {',
      "  const b = pm.response.json();",
      '  pm.expect(b.success, "success flag").to.eql(true);',
      '  pm.expect(b.message, "message").to.be.a("string").and.not.empty;',
      '  pm.expect(b, "data key").to.have.property("data");',
      "});",
      ...(extra.length ? ["", ...extra] : []),
    ],
  },
});

const refusalTests = (code, why) => ({
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      `// ${why}`,
      `pm.test("HTTP ${code}", function () {`,
      `  pm.response.to.have.status(${code});`,
      "});",
      "",
      'pm.test("failure envelope", function () {',
      "  const b = pm.response.json();",
      '  pm.expect(b.success, "success flag").to.eql(false);',
      '  pm.expect(b.message, "message").to.be.a("string").and.not.empty;',
      "});",
    ],
  },
});

// ---------------------------------------------------------------------------
// The shared description of what "one endpoint, three shapes" means, because a
// reader hitting these in Postman has no other way to know why the same URL
// answers differently for two tokens.
// ---------------------------------------------------------------------------
const THREE_SHAPES = [
  "**Ek endpoint, teen shapes.** Scope aur projection dono token se nikalte hain —",
  "customer apne, vendor apne brand ke, sub-vendor apne outlet ke, admin sab dekhta hai.",
  "",
  "| Field | Customer | Vendor / Outlet | Admin |",
  "|---|:-:|:-:|:-:|",
  "| `voucher.convenienceFee` | ✅ | — | ✅ |",
  "| `voucher.vendorPayable` | — | ✅ | ✅ |",
  "| `gatewayFee` · `netReceived` | — | — | ✅ |",
  "| `voucher.platformPromoCost` | — | — | ✅ |",
  "| `email` · `contact` · `customerId` | ✅ (apna) | — | ✅ |",
  "| `invoiceDownloadUrl` | ✅ | — | ✅ |",
  "",
  "> Vendor ko `gatewayFee` / `platformPromoCost` **kabhi nahi** — wo hamara margin hai,",
  "> aur `email` / `contact` customer ki privacy. Dono ek hi document par hain, isiliye",
  "> ye faisla `claimProjection()` me ek jagah hota hai, har call site par yaad nahi rakha jaata.",
].join("\n");

// ---------------------------------------------------------------------------
// Customer folder
// ---------------------------------------------------------------------------
const customerItems = [
  {
    name: "Claim order kholo (promo ke saath) ⭐",
    event: [
      envelopeTests([
        "// ── capture into the environment ──",
        "if (pm.response.code < 300) {",
        "  const d = pm.response.json().data;",
        '  try { if (d.transaction._id) pm.environment.set("claim_transaction_id", String(d.transaction._id)); } catch (e) {}',
        '  try { if (d.claim._id) pm.environment.set("claim_id", String(d.claim._id)); } catch (e) {}',
        '  try { if (d.claim.claimCode) pm.environment.set("claim_code", String(d.claim.claimCode)); } catch (e) {}',
        "}",
      ]),
    ],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: {
        mode: "raw",
        raw: JSON.stringify(
          {
            voucherId: "{{voucher_id}}",
            outletId: "{{outlet_id}}",
            billAmount: 1000,
            offerId: "{{offer_id}}",
            promoCode: "{{promo_code}}",
          },
          null,
          2,
        ),
        options: { raw: { language: "json" } },
      },
      url: url("/voucher-claims/create-order", ["voucher-claims", "create-order"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `isCustomer` — 🔒 sign-in zaroori. Guest ko **daam** milta hai (preview), **order nahi**.",
        "",
        "Order of operations hi design hai:",
        "",
        "```",
        "price → idempotency key insert → reuse window → claim + usage slot",
        "      → promo reserve → Razorpay (sabse aakhir me)",
        "```",
        "",
        "- **Key pehle, gateway baad me.** Do concurrent taps dono read-then-write check paas kar jaate hain;",
        "  key insert karna hi dusre ko haraata hai — unique index faisla karta hai, timing nahi.",
        "  Razorpay aakhir me isliye ki wahi ek step hai jiska koi undo nahi.",
        "- **Usage slot claim banate hi** liya jaata hai, payment par nahi — warna wahi window bachti hai",
        "  jo race ko chahiye: do checkout khule, koi kuch hold na kare, dono paas.",
        "- `promoCode` yahan **422** deta hai agar na chale. Preview par wahi rejection narm hai —",
        "  par yahan customer daam dekh chuka hai aur Pay daba chuka hai, to poora daam le lena theek nahi.",
        "",
        "| Field | Zaroori | Notes |",
        "|---|:-:|---|",
        "| `voucherId` | ✅ | |",
        "| `outletId` | ✅ | Jis outlet par bill bana |",
        "| `billAmount` | ✅ | > 0, `claim.maxBillAmount` (default ₹1,00,000) tak |",
        "| `offerId` | — | Na do to best applicable offer khud chunta hai |",
        "| `promoCode` | — | Na chale to **422**, chup-chaap ignore nahi |",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Payment verify karo (browser callback)",
    event: [envelopeTests()],
    request: {
      method: "POST",
      header: [{ key: "Content-Type", value: "application/json" }],
      body: {
        mode: "raw",
        raw: JSON.stringify(
          {
            razorpayOrderId: "{{razorpay_order_id}}",
            razorpayPaymentId: "{{razorpay_payment_id}}",
            razorpaySignature: "{{razorpay_signature}}",
            transactionId: "{{claim_transaction_id}}",
          },
          null,
          2,
        ),
        options: { raw: { language: "json" } },
      },
      url: url("/voucher-claims/verify", ["voucher-claims", "verify"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `isCustomer` — settlement claim ka maalik check karta hai, aur anonymous caller ke paas check karne ko kuch nahi.",
        "",
        "Ye aur webhook **har payment par race karte hain** — dono ek hi `settleVoucherClaimPayment` chalate hain,",
        "aur conditional claim (`verified: false → true`) tay karta hai kaun jeeta. Haarne wala",
        "\"pehle ho chuka\" report karta hai, dobara settle nahi karta.",
        "",
        "Chaaron field **zaroori** hain. `transactionId` khaas taur par: vendor wale twin me ye kabhi",
        "optional tha, jisse ek verify request bina kuch verify kiye nikal jaati thi.",
        "",
        "> Signature usi Razorpay account ke secret se check hota hai jo `transaction.gatewayAccount`",
        "> par likha hai — call site par account hardcode karna mana hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Meri claims — order history ⭐",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims?page=1&limit=20",
        ["voucher-claims"],
        [
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "status", value: "REDEEMED", disabled: true },
          { key: "claimCode", value: "{{claim_code}}", disabled: true },
          { key: "brandId", value: "{{brand_id}}", disabled: true },
          { key: "from", value: "2026-08-01", disabled: true },
          { key: "to", value: "2026-08-31", disabled: true },
        ],
      ),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `verifyJwtToken` — koi bhi role. " + THREE_SHAPES,
        "",
        "Ye **\"maine kya khareeda\"** hai, \"kaunsa paisa hila\" nahi (uske liye `/payments`).",
        "",
        "Frozen snapshots padhta hai — `voucherSnapshot`, `brandSnapshot`, `outletSnapshot` — isliye",
        "September ki claim March me bhi sahi padhti hai, voucher republish hone aur outlet ka naam",
        "badalne ke baad bhi. Ye join nahi hai.",
        "",
        "| Param | Notes |",
        "|---|---|",
        "| `page` / `limit` | `1` / `20`, limit max **100** |",
        "| `status` | `PENDING · PAID · REDEEMED · FAILED · CANCELLED · EXPIRED · REFUNDED` |",
        "| `claimCode` | Poora code |",
        "| `brandId` / `outletId` / `voucherId` | Narrow karne ke liye |",
        "| `from` / `to` | ISO date. `to` **poore din** ko include karta hai (23:59:59) |",
        "",
        "⚠️ **Scope query se chaudi nahi ho sakti.** Filter aur scope **intersect** hote hain:",
        "vendor `?brandId=<dusra brand>` bheje to **kuch nahi** milta — apne rows nahi. Overlay karna",
        "surakshit tha par chup: filter kaam karta hua *dikhta* tha, aur koi us par report bana leta.",
        "",
        "> Khaali list **200 + `data: []`** hai, 404 nahi. Jis customer ne kuch khareeda hi nahi",
        "> uski history khaali hai, gayab nahi — 404 pehli baar app kholne par error screen dikha deta.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Mere payments",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments?page=1&limit=20",
        ["voucher-claims", "payments"],
        [
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "status", value: "captured", disabled: true },
          { key: "from", value: "2026-08-01", disabled: true },
          { key: "to", value: "2026-08-31", disabled: true },
        ],
      ),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `verifyJwtToken` — koi bhi role. " + THREE_SHAPES,
        "",
        "Ye **\"kaunsa paisa hila\"** hai. `status` yahan **payment** ki vocabulary hai",
        "(`created · authorized · captured · failed`), claim ki nahi.",
        "",
        "> `purpose` se scope hai, isliye ek galat filter bhi kabhi **subscription** payment",
        "> nahi dikha sakta — ek hi collection dono flows rakhti hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek payment kholo (notification ka deep link yahin utarta hai) ⭐",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments/{{claim_transaction_id}}",
        ["voucher-claims", "payments", "{{claim_transaction_id}}"],
      ),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `verifyJwtToken` — koi bhi role. " + THREE_SHAPES,
        "",
        "Push notification tap karke customer yahin aata hai, aur vendor apne din ki ek row",
        "kholkar bhi. Wahi projection jo listing use karti hai — detail page par wo field dikhna",
        "jo list chhupati hai, exactly wo leak hai jise koi jaanchta nahi.",
        "",
        "**Response:** `payment` · `claim` · `brand` · `outlet` · `viewer`",
        "",
        "- `claim` saath aata hai kyunki akela payment sirf ek raqam aur ek timestamp hai —",
        "  customer ko wo dekhna hai jo usne khareeda",
        "- `viewer` batata hai caller kya render kar sakta hai, taaki client ko andaza na lagana pade",
        "- `payment.invoiceDownloadUrl` — **token nahi**. Token PDF ka bina-auth bearer credential hai;",
        "  bana hua URL hi uska poora istemaal hai",
        "- `PUBLIC_API_URL` set na ho to link **aata hi nahi** — kahin na jaane wala Download button",
        "  na hone se bura hai",
        "",
        "**Errors:** `404` na milne par (galat id **aur** dusre ka row — dono, warna prober ko pata",
        "chal jaata hai ki row hai) · `403` dusre outlet ka payment · `422` malformed id",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek claim kholo — timeline ke saath ⭐",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url("/voucher-claims/{{claim_id}}", ["voucher-claims", "{{claim_id}}"]),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `verifyJwtToken` — koi bhi role. " + THREE_SHAPES,
        "",
        "**Response:** `claim` · `payment` · `brand` · `outlet` · **`timeline`** · `viewer`",
        "",
        "### Timeline banayi jaati hai, chhaani nahi",
        "",
        "`VoucherClaimHistory` append-only hai aur jaan-boojhkar **poori** — jo us waqt mayne rakhta",
        "tha wo sab. Wahi poornata wajah hai ki use jaisa ka taisa page par nahi bheja ja sakta:",
        "",
        "- `snapshot` **Mixed** hai aur aaj `CLAIM_CREATED` row par poora pricing block rakhta hai,",
        "  `platformPromoCost` samet. Kaccha bhejna vendor ko hamara margin pichhle darwaze se de deta",
        "- `reason` staff ne **staff ke liye** likha free text hai. *\"Refunded, customer disputes the bill\"*",
        "  wo vaakya nahi hai jo usi customer ko dikhaya jaaye",
        "",
        "Isliye non-admin ko har row se sirf: `label` · `at` · `fromStatus` → `toStatus` · `by` (role, aadmi nahi).",
        "`PROMO_RELEASED` sirf admin ko — wo hamari budget bookkeeping hai.",
        "",
        "**Timeline aage se padhi jaati hai (purani pehle).** Listing ulti hai, kyunki list me sabse naya khoja jaata hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Claim code se kholo (counter wala surface)",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/code/{{claim_code}}",
        ["voucher-claims", "code", "{{claim_code}}"],
      ),
      auth: bearer("customer_token"),
      description: [
        "**Access:** `verifyJwtToken` — wahi service jo `/:claimId` chalati hai, to ek hi access rule dono par.",
        "",
        "Code hi wo cheez hai jo asli duniya me maujood hai: screen par chhapa, bolkar padha, type kiya.",
        "Sirf ObjectId lene wala surface outlet ko pehle search karne par majboor karta — matlab dusra",
        "endpoint aur access rules ka dusra set galat hone ke liye.",
        "",
        "⚠️ **Code lookup ko narrow karta hai, authorise nahi karta.** Kisi aur ki screen se padha",
        "gaya code bhi kuch nahi kholta.",
        "",
        "Code us alphabet se banta hai jo galat padhe jaane wale characters **chhodta** hai —",
        "`0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` — kyunki ye code log ek dusre ko counter par bolkar padhte hain.",
        "Isliye validator shape check karta hai: galat character wale code par *\"mistyped\"* kehna",
        "404 se zyada kaam ka hai, jo lagta hai claim hai hi nahi.",
      ].join("\n"),
    },
    response: [],
  },
];

// ---------------------------------------------------------------------------
// Vendor folder — read-only. Phase 1 me vendor claim par kuch badal nahi sakta.
// ---------------------------------------------------------------------------
const vendorItems = [
  {
    name: "Mere brand ki claims ⭐",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims?page=1&limit=20",
        ["voucher-claims"],
        [
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "status", value: "REDEEMED", disabled: true },
          { key: "outletId", value: "{{sub_brand_id}}", disabled: true },
          { key: "from", value: "2026-08-01", disabled: true },
          { key: "to", value: "2026-08-31", disabled: true },
        ],
      ),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** `verifyJwtToken`. " + THREE_SHAPES,
        "",
        "`SUB_VENDOR` token isi URL par **sirf apne outlet** ki rows paata hai — brand ki poori nahi.",
        "",
        "⚠️ **Scope query se chaudi nahi ho sakti.** `?brandId=<dusra brand>` bhejne par **kuch nahi**",
        "milta, apne rows nahi — filter aur scope intersect hote hain.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Mere brand ke payments",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments?page=1&limit=20",
        ["voucher-claims", "payments"],
        [
          { key: "page", value: "1" },
          { key: "limit", value: "20" },
          { key: "outletId", value: "{{sub_brand_id}}", disabled: true },
        ],
      ),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** `verifyJwtToken`. " + THREE_SHAPES,
        "",
        "Vendor ko `voucher.vendorPayable` dikhta hai — jo unhe milega. `gatewayFee`, `netReceived`",
        "aur `voucher.platformPromoCost` **kabhi nahi**: Razorpay ne humse kya liya ye commercial",
        "disclosure hai. `email` / `contact` bhi nahi — wo privacy hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek payment kholo",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments/{{claim_transaction_id}}",
        ["voucher-claims", "payments", "{{claim_transaction_id}}"],
      ),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** `verifyJwtToken`. " + THREE_SHAPES,
        "",
        "Vendor ko `payment.invoiceDownloadUrl` **nahi** milta — customer ka tax invoice customer",
        "ke apne details rakhta hai.",
        "",
        "**Errors:** `403` dusre brand ka payment · `403` \"not taken at your outlet\" (sub-vendor) · `404` id galat",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Claim code se verify karo (counter par) ⭐",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/code/{{claim_code}}",
        ["voucher-claims", "code", "{{claim_code}}"],
      ),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** `verifyJwtToken`. Counter par grahak code dikhaata hai, staff yahan daalta hai.",
        "",
        "**Phase 1 me ye read-only hai.** Capture par claim seedhe `REDEEMED` ho jaati hai",
        "(`redemptionMode: AUTO`) — payment hi redemption hai. Ye page batata hai *kitna pay hua,*",
        "*kaunsa offer, kab, kaunsa outlet*.",
        "",
        "> **Phase 2** me asli redemption aayegi (`POST /voucher-claims/redeem`), aur uske saath",
        "> dobara-scan ka samajhdaar jawab aur reversal — teeno ek saath. Sirf scan deploy karna",
        "> grahak ko phansa deta hai: scan chala nahi, saamaan mila nahi, aur *\"already redeemed\"*.",
        "> Dekhein `docs/customer_voucher_claim_plan.md` §15.1.",
        "",
        "⚠️ Code lookup narrow karta hai, **authorise nahi karta** — dusre brand ya dusre outlet ka",
        "code 403 deta hai.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Ek claim kholo — timeline ke saath",
    event: [envelopeTests()],
    request: {
      method: "GET",
      header: [],
      url: url("/voucher-claims/{{claim_id}}", ["voucher-claims", "{{claim_id}}"]),
      auth: bearer("vendor_token"),
      description: [
        "**Access:** `verifyJwtToken`. " + THREE_SHAPES,
        "",
        "`timeline` har audience ke liye **banayi** jaati hai, chhaani nahi — kaccha audit row",
        "`snapshot` me poora pricing block rakhta hai (`platformPromoCost` samet), aur `reason`",
        "staff ka note hai. Vendor ko dono me se kuch nahi.",
      ].join("\n"),
    },
    response: [],
  },
];

/** The negative cases that prove the scope actually holds. */
const customerRefusals = [
  {
    name: "Claim listing — bina token 401",
    event: [refusalTests(401, "Scope token se aata hai, isliye token ke bina koi scope hi nahi.")],
    request: {
      method: "GET",
      header: [],
      url: url("/voucher-claims", ["voucher-claims"]),
      auth: { type: "noauth" },
      description: "Token ke bina koi listing nahi — scope hi token se nikalta hai.",
    },
    response: [],
  },
  {
    name: "Dusre ka payment kholna — 403",
    event: [refusalTests(403, "Doosre customer ka payment.")],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments/{{other_customer_transaction_id}}",
        ["voucher-claims", "payments", "{{other_customer_transaction_id}}"],
      ),
      auth: bearer("customer_token"),
      description: [
        "Detail par access `assertTransactionAccess` se hota hai, aur listing ka scope usi rule",
        "se nikalta hai — isliye listing kabhi wo row nahi dikha sakti jise detail kholne se mana kar de.",
      ].join("\n"),
    },
    response: [],
  },
  {
    name: "Malformed transaction id — 422",
    event: [refusalTests(422, "Joi ObjectId validator; warna Mongoose CastError 500 ban jaata.")],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments/not-an-object-id",
        ["voucher-claims", "payments", "not-an-object-id"],
      ),
      auth: bearer("customer_token"),
      description:
        "ObjectId validator hi wo cheez hai jo malformed id ko `findOne` tak pahunchne se rokti hai — warna wo saaf 422 ki jagah 500 CastError banti.",
    },
    response: [],
  },
  {
    name: "Galat shape ka claim code — 422",
    event: [refusalTests(422, "Code ke alphabet me ye characters hain hi nahi.")],
    request: {
      method: "GET",
      header: [],
      url: url("/voucher-claims/code/TD-0OI1L5", ["voucher-claims", "code", "TD-0OI1L5"]),
      auth: bearer("customer_token"),
      description: [
        "`0`, `O`, `I`, `1`, `L`, `5` code ke alphabet me hain hi nahi — ye counter par galat padhe",
        "jaate hain, isliye generator unhe chhodta hai.",
        "",
        "Isliye jawab *\"mistyped character\"* hai, 404 nahi — 404 lagta hai claim maujood hi nahi.",
      ].join("\n"),
    },
    response: [],
  },
];

const vendorRefusals = [
  {
    name: "Dusre brand ki claim — 403",
    event: [refusalTests(403, "Dusre brand ka row.")],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/{{other_brand_claim_id}}",
        ["voucher-claims", "{{other_brand_claim_id}}"],
      ),
      auth: bearer("vendor_token"),
      description: "Brand-side access parent `brandId` se hota hai; dusre brand ka row 403.",
    },
    response: [],
  },
  {
    name: "Subscription payment ko claim detail se kholna — 404",
    event: [refusalTests(404, "Ek collection, do money flows — purpose scope isse rokta hai.")],
    request: {
      method: "GET",
      header: [],
      url: url(
        "/voucher-claims/payments/{{subscription_transaction_id}}",
        ["voucher-claims", "payments", "{{subscription_transaction_id}}"],
      ),
      auth: bearer("vendor_token"),
      description: [
        "⚠️ Ek hi collection vendor subscriptions aur customer voucher claims dono rakhti hai.",
        "`purpose` scope ke bina ye endpoint apne hi billing row ko — dusre Razorpay account ka,",
        "aur aisi projection se jo voucher claim ke liye bani hai — khol deta. **Id ka unique hona",
        "iska jawab nahi hai.**",
      ].join("\n"),
    },
    response: [],
  },
];

const FOLDERS = [
  {
    file: "trydood-customer.postman_collection.json",
    folder: {
      name: "12 — Voucher Claims",
      description: [
        "Voucher khareedne se lekar us claim ki poori kahani tak.",
        "",
        "Listing aur detail dono **ek hi endpoint, teen shapes** hain — scope aur projection",
        "token se nikalte hain. Teen alag endpoint ka matlab hota teen jagah ye yaad rakhna ki",
        "vendor ko kya nahi dikhna chahiye, aur ek jagah bhoolna = leak.",
      ].join("\n"),
      item: [...customerItems, ...customerRefusals],
    },
  },
  {
    file: "trydood-vendor.postman_collection.json",
    folder: {
      name: "19 — Voucher Claims (read-only)",
      description: [
        "Grahak ne mere outlet par kya khareeda, aur mujhe kitna milega.",
        "",
        "**Phase 1 me poori tarah read-only.** Capture par claim seedhe `REDEEMED` ho jaati hai —",
        "payment hi redemption hai. Outlet scan aur reversal Phase 2 hain",
        "(`docs/customer_voucher_claim_plan.md` §15.1).",
      ].join("\n"),
      item: [...vendorItems, ...vendorRefusals],
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

  /**
   * The round-trip guard.
   *
   * If re-serialising does not reproduce the file byte for byte, then writing it
   * back would reformat every line and bury the real change in a 20,000-line
   * diff — and nobody would review it. Refuse instead.
   */
  const roundTrip = `${JSON.stringify(collection, null, 2).replace(/\n/g, "\r\n")}\r\n`;
  if (roundTrip !== raw) {
    console.error(
      `❌ ${file}: re-serialising does not reproduce the file byte-for-byte. Refusing to write.`,
    );
    process.exitCode = 1;
    continue;
  }

  if (collection.item.some((i) => i.name === folder.name)) {
    console.log(`⏭️  ${file}: "${folder.name}" already present — nothing to do.`);
    continue;
  }

  const beforeExamples = countExamples(collection.item);
  const beforeRequests = countRequests(collection.item);

  /**
   * Inserted **before** the access-control folder, which is deliberately last in
   * both collections, and that folder is renumbered. Appending after it would
   * read as an afterthought; renumbering everything would churn the whole file.
   */
  const accessIndex = collection.item.findIndex((i) => /Access control/i.test(i.name));
  if (accessIndex === -1) {
    collection.item.push(folder);
  } else {
    const access = collection.item[accessIndex];
    const slot = parseInt(access.name, 10);

    // The new folder **takes** the slot the access folder was in, and the access
    // folder moves up one. Numbering the new folder independently is how both
    // collections ended up with two folders called `12` — Postman shows them in
    // array order regardless, so nothing errors and nobody notices.
    folder.name = folder.name.replace(/^\d+/, String(slot).padStart(2, "0"));
    access.name = access.name.replace(/^\d+/, String(slot + 1).padStart(2, "0"));
    collection.item.splice(accessIndex, 0, folder);
  }

  // Two folders sharing a number is silent in Postman. Catch it here instead.
  const numbers = collection.item.map((i) => i.name.slice(0, 2));
  const duplicated = numbers.filter((n, idx) => numbers.indexOf(n) !== idx);
  if (duplicated.length) {
    console.error(`❌ ${file}: duplicate folder number(s) ${duplicated.join(", ")}.`);
    process.exitCode = 1;
    continue;
  }

  const afterExamples = countExamples(collection.item);
  const afterRequests = countRequests(collection.item);

  // Inserting must never cost an example. If it did, something overwrote rather
  // than appended — and captured examples cannot be recovered from source.
  if (afterExamples !== beforeExamples) {
    console.error(
      `❌ ${file}: captured examples changed ${beforeExamples} → ${afterExamples}. Refusing to write.`,
    );
    process.exitCode = 1;
    continue;
  }

  console.log(
    `${APPLY ? "✅" : "🔍"} ${file}: +${folder.item.length} requests ` +
      `(${beforeRequests} → ${afterRequests}), examples unchanged at ${afterExamples}`,
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

if (!APPLY) {
  console.log("\n🔍 Dry run. Re-run with --apply to write.");
} else {
  console.log(`\n✅ ${changed} collection(s) updated.`);
}
