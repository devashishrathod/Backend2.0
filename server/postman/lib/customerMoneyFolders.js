/**
 * The customer collection's money folders — claims, refunds, bank accounts and
 * search.
 *
 * ### Why these four live in their own module
 *
 * They used to be inserted into the JSON by one-off scripts in `scripts/`
 * instead of being generated, and the reason was not neglect: `lib/routeGates.js`
 * threw `router.stack is not iterable` from the day `routes/voucherClaims.js`
 * started exporting `{ router, routePrefix }`, and that took the whole
 * generator down with it. `generate-customer-collection.js` could not run at
 * all, so the requests could only be bolted on afterwards — and the generator
 * drifted 30 requests behind the file it supposedly produces. Anyone who then
 * followed the README's "add it to the generator and re-run" would have deleted
 * three folders and 96 captured examples.
 *
 * routeGates handles `routePrefix` and `extraRoutes` now, so these are
 * generated like everything else and the "Access:" line is derived from
 * `routes/` rather than written down.
 *
 * They are a module rather than 900 more lines inside the generator because the
 * generator is already 3,000 lines, and because the prose here is thick with
 * backticks, regexes and `$` — which is exactly the content that gets silently
 * mangled when a build script edits a big string with `String.replace`.
 */

const { req, folder, A } = require("./builders");

/** The env var holding the customer bearer token, matching the generator. */
const CUST = "customer_token";

// ---------------------------------------------------------------- 11. claims

const claimsFolder = folder(
  "11 — Voucher Claims",
  [
    "Voucher khareedne se lekar us claim ki poori kahani tak.",
    "",
    "Listing aur detail dono **ek hi endpoint, teen shapes** hain — scope aur",
    "projection token se nikalte hain. Teen alag endpoint ka matlab hota teen",
    "jagah ye yaad rakhna ki vendor ko kya nahi dikhna chahiye, aur ek jagah",
    "bhoolna = leak — wo bhi listing me nahi, **detail page par**, jise koi",
    "jaanchta nahi.",
    "",
    "⚠️ **Guest ko daam milta hai, order nahi.** Preview `optionalAuth` par hai",
    "(folder 05), par `create-order` `isCustomer` par — paisa hilne ka lamha",
    "signed-in hona chahiye.",
  ].join("\n"),
  [
    req({
      name: "Claim order kholo (promo ke saath)",
      method: "POST",
      segments: ["voucher-claims", "create-order"],
      token: CUST,
      body: {
        voucherId: "{{voucher_id}}",
        outletId: "{{sub_brand_id}}",
        billAmount: 1000,
        offerId: "{{offer_id}}",
        promoCode: "{{promo_code}}",
      },
      description: [
        "Razorpay order kholta hai. **Kram hi design hai:**",
        "",
        "daam (wahi builder jo preview chalata hai, `strictPromo` ke saath) →",
        "`Idempotency-Key` insert → reuse window → claim + once-per-user slot",
        "hold → promo reservation → **Razorpay sabse aakhir**.",
        "",
        "⚠️ Key Razorpay call se **pehle** jaati hai. Header lekar check kar lena",
        "kaafi nahi — do concurrent tap dono read-then-write paas kar jaate, aur",
        "customer ko ek bill ke liye **do payment sheet** dikhte. Unique index",
        "faisla karta hai, timing nahi. Razorpay aakhir me kyunki uska undo nahi hai.",
        "",
        "⚠️ Promo **default me band hai** (`Setting.customer.promoCode.isEnabled`).",
        "Seeder use `true` kar deta hai; band ho to ye ek hard `422` hai,",
        "chup-chaap ignore nahi.",
      ].join("\n"),
      assert: [
        /**
         * ⚠️ **`200` is as correct as `201` here, and that is the design.**
         *
         * A customer who already has an open — or recently paid — order for the
         * same voucher gets that one back with `reused: true`, at `200`, instead
         * of a second Razorpay order for the same bill. Asserting `201` only
         * meant this request failed on a re-run against seeded data, and the
         * "failure" was the idempotency working.
         */
        ...A.custom("order khula (201) ya pehle wala mila (200, reused)", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 201]);',
          "const d = pm.response.json().data;",
          'pm.expect(d.claim.id, "claim.id").to.be.a("string");',
          'pm.expect(d.transaction.id, "transaction.id").to.be.a("string");',
          'pm.expect(d.razorpay.orderId, "razorpay.orderId").to.be.a("string");',
          'pm.expect(d.razorpay.amount, "razorpay.amount").to.be.a("number");',
          'pm.expect(d.razorpay.keyId, "razorpay.keyId").to.be.a("string");',
          "if (code === 200) {",
          '  pm.expect(d.reused, "reused").to.eql(true);',
          "}",
        ]),
        /**
         * The bill the customer is shown has to add up to the amount Razorpay is
         * asked for. These are the two numbers a mismatch would hide behind.
         */
        ...A.custom("payable aur Razorpay ka amount ek hi cheez hain", [
          "const d = pm.response.json().data;",
          'pm.expect(d.razorpay.amount, "paise").to.eql(d.pricing.amountInPaise);',
          'pm.expect(d.pricing.totalPayable * 100, "rupees→paise").to.eql(d.pricing.amountInPaise);',
          'pm.expect(d.orderSummary.payable.amount, "summary payable").to.eql(d.pricing.totalPayable);',
        ]),
        /**
         * ⚠️ `pricing` here is the **customer's** copy and legitimately carries
         * `platformPromoCost` / `vendorPayable`, because this is the payer's own
         * order. The projection that hides them is the **vendor's**, on the
         * claim listing — so this request must not assert their absence. An
         * earlier version did, and it was asserting the wrong contract.
         */
        ...A.custom("promo ka hisaab poora dikhta hai", [
          "const p = pm.response.json().data.pricing;",
          'pm.expect(p.promoDiscount + p.offerDiscount, "total discount").to.be.at.least(0);',
          'pm.expect(p.youSaved, "youSaved").to.be.a("number");',
        ]),
      ],
      capture: [
        ["claim_transaction_id", "d.transaction.id"],
        ["claim_id", "d.claim.id"],
        ["claim_code", "d.claim.claimCode"],
        ["razorpay_order_id", "d.razorpay.orderId"],
      ],
    }),

    req({
      name: "Payment verify karo (browser callback)",
      method: "POST",
      segments: ["voucher-claims", "verify"],
      token: CUST,
      body: {
        razorpayOrderId: "{{razorpay_order_id}}",
        razorpayPaymentId: "{{razorpay_payment_id}}",
        razorpaySignature: "{{razorpay_signature}}",
        transactionId: "{{claim_transaction_id}}",
      },
      description: [
        "Browser callback.",
        "",
        "⚠️ **Iska success headless capture nahi ho sakta.**",
        "`razorpay_payment_id` aur `razorpay_signature` ek **asli Razorpay",
        "checkout** se browser me aate hain; test keys se bhi API se payment nahi",
        "banayi ja sakti. Saved example wahi asli refusal hai jo khaali ya galat",
        "signature par aata hai — success ka shape doc me hai, aur wahan saaf",
        "likha hai ki wo capture nahi hua.",
        "",
        "Signature sirf ye sabit karta hai ki payment **Razorpay ne banayi**. Ye",
        "nahi ki wo is order ki hai, sahi rakam hai, ya poochne wala wahi hai.",
        "Isliye chaar aur jaanch: account **transaction se** (hardcode nahi),",
        "`payment.order_id` milana, rakam `claim.pricing.amountInPaise` se milana,",
        "aur ownership **customer par** — `userId` par nahi, warna ek login",
        "saajha karte do customer me se ek doosre ki payment settle kar leta.",
        "",
        "⚠️ Webhook race jeet le to `alreadyVerified: true` — wo **safalta hai,",
        "error nahi**. Activation browser se independent hai, isliye tab band",
        "karne wale customer ko bhi uska claim milta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("verify: success, ya asli documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 400, 403, 404, 422]);',
          "const b = pm.response.json();",
          'pm.expect(b, "envelope").to.have.property("success");',
          "if (code === 200) {",
          '  pm.expect(b.data).to.have.property("claimId");',
          "} else {",
          '  pm.expect(b.success, "success flag").to.eql(false);',
          "}",
        ]),
      ],
    }),

    req({
      name: "Meri claims — order history",
      method: "GET",
      segments: ["voucher-claims"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      token: CUST,
      description: [
        'Wo screen jo *"maine kya khareeda"* ka jawab deti hai.',
        "",
        "**Frozen snapshots padhta hai** (`voucherSnapshot` / `brandSnapshot` /",
        "`outletSnapshot`), join nahi — September ki claim March me bhi sahi",
        "padhti hai, voucher republish aur outlet rename ke baad bhi.",
        "",
        "⚠️ **Khaali list `200` + `data: []`, `404` nahi.** Jisne kuch khareeda hi",
        "nahi uski history **khaali** hai, gayab nahi. `pagination()` me",
        "`allowEmpty` isiliye juda — `404` pehli baar app kholne par error screen",
        "dikha deta.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.paged(),
        ...A.fields(
          {
            _id: "string",
            claimCode: "string",
            status: "string",
            billAmount: "number",
            voucherSnapshot: "object",
            brandSnapshot: "object",
          },
          { each: true },
        ),
        ...A.absent(["platformPromoCost", "vendorPayable", "commissionAmount"], {
          each: true,
        }),
      ],
      capture: [
        ["claim_id", "d.data[0]._id"],
        ["claim_code", "d.data[0].claimCode"],
      ],
    }),

    req({
      name: "Mere payments",
      method: "GET",
      segments: ["voucher-claims", "payments"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      token: CUST,
      description: [
        'Wo screen jo *"kaunsa paisa hila"* ka jawab deti hai.',
        "",
        "⚠️ `status` yahan **payment** ki vocabulary hai —",
        "`created · authorized · captured · failed` — claim ki nahi. Do alag",
        "lifecycle hain aur ek hi shabd dono ke liye padhna aam galti hai.",
        "",
        "⚠️ `purpose` se scope hota hai, isliye ek **galat filter bhi** kabhi",
        "subscription payment nahi dikha sakta. Ek `transactions` collection dono",
        "flows rakhti hai, aur bhoola hua `purpose` unhe chup-chaap mila deta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.paged(),
        ...A.fields(
          { _id: "string", amount: "number", status: "string" },
          { each: true },
        ),
        ...A.absent(["gatewayFee", "netReceived"], { each: true }),
      ],
      capture: [["claim_transaction_id", "d.data[0]._id"]],
    }),

    req({
      name: "Ek payment kholo (notification ka deep link yahin utarta hai)",
      method: "GET",
      segments: ["voucher-claims", "payments", "{{claim_transaction_id}}"],
      token: CUST,
      description: [
        "**Push notification ka deep link yahin utarta hai.**",
        "",
        "`payment` · `claim` · `brand` · `outlet` · `viewer` — claim saath aata",
        "hai kyunki akela payment sirf raqam aur timestamp hai.",
        "",
        "⚠️ `invoiceDownloadUrl` deta hai, **token nahi**. Token PDF ka bina-auth",
        "bearer credential hai; use response me bhejna uska matlab hi khatam kar",
        "deta.",
        "",
        "⚠️ `purpose` scope ke bina ye **subscription** payment khol deta — dusre",
        "Razorpay account ka row, voucher-claim ki projection se. **Id ka unique",
        "hona iska jawab nahi hai.**",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.fields({ payment: "object", claim: "object", viewer: "object" }),
        ...A.custom("invoice link haan, token kabhi nahi", [
          "const d = pm.response.json().data;",
          'pm.expect(d.payment, "invoiceToken").to.not.have.property("invoiceToken");',
        ]),
      ],
    }),

    req({
      name: "Ek claim kholo — timeline ke saath",
      method: "GET",
      segments: ["voucher-claims", "{{claim_id}}"],
      token: CUST,
      description: [
        "Claim + **timeline**.",
        "",
        "⚠️ Timeline **banayi** jaati hai, chhaani nahi.",
        "`VoucherClaimHistory.snapshot` `Mixed` hai aur `CLAIM_CREATED` par",
        "**poora pricing block** rakhta hai (`platformPromoCost` samet), aur",
        "`reason` staff ka free-text note hai. Kaccha row bhejna vendor ko hamara",
        "margin **pichhle darwaze se** de deta — us projection ko paar karke jo",
        "use rokti hai.",
        "",
        "Non-admin ko sirf `label` · `at` · `fromStatus` → `toStatus` · `by`",
        "(role, aadmi nahi). `PROMO_RELEASED` sirf admin ko.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        /**
         * ⚠️ The claim is nested under `data.claim`, not spread onto `data`.
         *
         * `data` carries `claim` · `payment` · `brand` · `outlet` · `timeline` ·
         * `viewer` — the claim alone is a row of ids, so the screen needs all
         * six. Asserting `data._id` passed review and failed the moment it ran.
         */
        ...A.custom("claim + payment + brand + outlet + timeline + viewer", [
          "const d = pm.response.json().data;",
          '["claim", "payment", "brand", "outlet", "timeline", "viewer"].forEach(function (k) {',
          "  pm.expect(d, k).to.have.property(k);",
          "});",
          'pm.expect(d.claim._id, "claim._id").to.be.a("string");',
          'pm.expect(d.claim.claimCode, "claim.claimCode").to.be.a("string");',
          'pm.expect(d.timeline, "timeline").to.be.an("array");',
        ]),
        ...A.custom("timeline rows saaf hain — snapshot/reason nahi", [
          "const t = pm.response.json().data.timeline || [];",
          "t.forEach(function (row) {",
          '  pm.expect(row, "snapshot").to.not.have.property("snapshot");',
          '  pm.expect(row, "reason").to.not.have.property("reason");',
          '  pm.expect(row).to.have.property("label");',
          "});",
        ]),
      ],
    }),

    req({
      name: "Claim code se kholo (counter wala surface)",
      method: "GET",
      segments: ["voucher-claims", "code", "{{claim_code}}"],
      token: CUST,
      description: [
        "Counter wala surface — **code hi wo cheez hai jo asli duniya me hai**:",
        "chhapa, bolkar padha, type kiya.",
        "",
        "⚠️ **Code lookup narrow karta hai, authorise nahi karta.** Kisi aur ki",
        "screen se padha code kuch nahi kholta — ownership phir bhi",
        "`assertClaimAccess` tay karti hai.",
        "",
        "⚠️ Route file me `/code/:claimCode` **`/:claimId` se upar** likha hai,",
        'warna parameter use nigal leta (`claimId = "code"`) aur bilkul sahi code',
        "par `422` aata.",
        "",
        "Alphabet `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` chhodta hai, isliye galat",
        'character par `422` *"mistyped"* — `404` lagta hai claim hai hi nahi.',
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        // Same nested shape as `/:claimId` — the code only narrows *which* claim,
        // and the controller is literally the same one.
        ...A.custom("wahi shape jo /:claimId deta hai", [
          "const d = pm.response.json().data;",
          'pm.expect(d.claim._id, "claim._id").to.be.a("string");',
          'pm.expect(d.claim.claimCode, "claim.claimCode").to.be.a("string");',
          'pm.expect(d.timeline, "timeline").to.be.an("array");',
        ]),
      ],
    }),

    req({
      name: "Invoice PDF kholo (WhatsApp/email ka link)",
      method: "GET",
      segments: ["transactions", "invoice", "{{invoice_token}}"],
      /**
       * ⚠️ The 302 **is** the answer, so do not follow it.
       *
       * With following on, the captured response was the PDF Cloudinary served:
       * non-JSON, so the capture step dropped it and this was the one request in
       * the collection with no saved example — and if it had been saved, a
       * binary document would have gone into the file.
       */
      followRedirects: false,
      description: [
        "Wo link jo invoice ke WhatsApp message aur email me jaata hai.",
        "",
        "⚠️ **Jaan-boojh kar bina auth.** Link us browser me khulta hai jahan koi",
        "session hota hi nahi — login maangne ka matlab hai ki Download button",
        "kaam na kare, jo uska **ekmatra kaam** hai. 32-byte random token hi poora",
        "credential hai, aur galat token par wahi `404` aata hai jo na-maujood",
        "token par — to token guess karne se kuch pata nahi chalta.",
        "",
        "⚠️ **`302` deta hai, PDF stream nahi karta.** File pehle se CDN par hai,",
        "aur har download ko is service se proxy karne se kuch nahi milta.",
        "Postman/newman redirect follow kar lete hain, isliye assertion `302`",
        "**aur** follow ke baad ka `200` dono accept karti hai.",
        "",
        "PDF **pehli request par** banti hai aur uske baad cache hoti hai — har",
        "claim par render + upload scale par nahi chalega, aur zyadatar invoice",
        "kabhi khulti hi nahi. Invoice **number** phir bhi settle par milta hai,",
        "taaki series me gap na aaye.",
        "",
        "⚠️ Token seeder se aata hai (`invoice_token`). Collection use khud capture",
        "**nahi** kar sakti: `GET /voucher-claims/payments/:id` jaan-boojh kar",
        "`invoiceDownloadUrl` deta hai aur token nahi.",
      ].join("\n"),
      assert: [
        ...A.custom("invoice link redirect karta hai, ya 404 deta hai", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 302, 404]);',
          "if (code === 302) {",
          '  pm.expect(pm.response.headers.get("Location"), "Location").to.be.a("string");',
          "}",
        ]),
      ],
    }),

    req({
      name: "Claim listing — bina token 401",
      method: "GET",
      segments: ["voucher-claims"],
      description: [
        "Poori listing token ke peeche hai. Guest ko yahan kuch nahi milta —",
        "uska koi claim ho hi nahi sakta.",
      ].join("\n"),
      assert: [...A.status(401), ...A.err()],
    }),

    req({
      name: "Dusre ka payment kholna — 403",
      method: "GET",
      segments: [
        "voucher-claims",
        "payments",
        "{{other_customer_transaction_id}}",
      ],
      token: CUST,
      description: [
        "Ek customer doosre ka payment **na khol paaye** — yahi ye request check",
        "karti hai.",
        "",
        "⚠️ **Ye tab tak bekaar tha jab tak seeder me doosra customer nahi tha.**",
        "`other_customer_transaction_id` khaali rehta tha, literal `{{…}}` URL me",
        'jaata tha, `objectId()` validator use reject karta tha, aur jawab **`422`**',
        "aata tha — `403` nahi. Test fail hota tha, par **galat wajah se**.",
        "",
        "⚠️ Ise `422` accept karwa ke chup **mat** karna. Tab ye hamesha ke liye",
        "green ho jayega aur kabhi kuch check nahi karega — aur jo ye check kar",
        "raha hai wo ye hai ki **ek customer doosre ka paisa dekh sakta hai ya",
        "nahi**.",
      ].join("\n"),
      assert: [...A.status(403), ...A.err()],
    }),

    req({
      name: "Malformed transaction id — 422",
      method: "GET",
      segments: ["voucher-claims", "payments", "not-an-object-id"],
      token: CUST,
      description: [
        "`objectId()` validator. Route ke andar pahunchne se pehle ruk jaata hai,",
        "isliye yahan `404` nahi `422` aata hai.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Galat shape ka claim code — 422",
      method: "GET",
      segments: ["voucher-claims", "code", "TD-0OI1L5"],
      token: CUST,
      description: [
        "Alphabet `0`, `O`, `I`, `1`, `L`, `5`, `S` jaise confusable characters",
        "**chhodta hai**, isliye inme se koi bhi aaya to code galat type hua hai.",
        "",
        '`422 "mistyped"` deta hai, `404` nahi — `404` padhne me lagta hai claim',
        "hai hi nahi, jabki asal me code galat likha gaya hai. Counter par ye",
        "farq hi tay karta hai ki staff dobara type kare ya customer ko laut jaye.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),
  ],
);

// --------------------------------------------------------------- 12. refunds

const refundsFolder = folder(
  "12 — Refunds",
  [
    "Paisa wapas maangna, aur uska kya hua.",
    "",
    "Grahak maange → **outlet tay kare** → Trydood nikaale. Trydood normal",
    "raaste par doosra gate nahi hai; wo sirf paisa chhodta hai.",
    "",
    "> ### Golden rule — settings validator me enforce hai",
    ">",
    "> ```",
    "> settlementDelayHours >= refundWindowHours + vendorApprovalHours + adminBufferHours",
    ">          72h         >=        24h        +        24h         +       12h",
    "> ```",
    ">",
    "> Jab tak ye sach hai, **koi refund kabhi aise paise ko chhoo hi nahi sakta",
    "> jo vendor ko ja chuka ho.** Na recovery, na negative balance, na vendor ko",
    "> kuch samjhana.",
    "",
    "**Abuse limits:** `refund.maxOpenRequests` (1) ·",
    "`refund.maxRejectedPerWindow` (3) · `refund.requestWindowDays` (30).",
    "",
    "⚠️ Ginti **thukrai** requests ki hoti hai, approve hui ki **kabhi nahi**.",
    "Jis grahak ki 5 refunds approve hui, uske saath 5 baar sach me bura hua;",
    "uski chhathi rokna theek usi ko saza dena hai jiske liye ye poori vyavastha",
    "bani hai. Raw count rakhne par **sabse kharab brand ka grahak sabse pehle",
    "block** hota — jo sabse zyada haqdaar hai.",
  ].join("\n"),
  [
    req({
      name: "Refund maango",
      method: "POST",
      segments: ["refunds"],
      token: CUST,
      body: {
        /**
         * ⚠️ `refundable_claim_id`, not `claim_id`.
         *
         * `claim_id` is whatever the claims listing captured first, and that
         * claim already carries the seeded `AWAITING_BANK_DETAILS` refund — so
         * this request answered *"You already have a refund in progress"* every
         * time. The seeder keeps a second paid claim with nothing on it.
         */
        claimId: "{{refundable_claim_id}}",
        amount: 500,
        reason: "NOT_HONOURED",
        reasonNote: "The outlet was shut when I got there.",
      },
      description: [
        "**Kram hi design hai:** eligibility → allowance → window → split freeze →",
        "**request banao** → hold lagao.",
        "",
        "Request pehle, hold baad me: request hi record hai aur hold usse nikalta",
        "hai.",
        "",
        "⚠️ Do tap ka faisla `(transactionId, isOpen)` wala **unique index** karta",
        "hai, uske upar wala read-then-write check nahi — dono use paas kar jaate",
        "hain. Haarne wale ko wahi request milti hai `reused: true` ke saath.",
        "",
        "⚠️ Window **`paidAt` se** napi jaati hai, `createdAt` se nahi.",
        "",
        "⚠️ Ownership **customer** par check hoti hai, user par nahi — ek login",
        "saajha karte do log ek doosre ke claims refund nahi kara sakte.",
        "",
        "`amount` optional — na do to poora. `settlementHold` yahin lagta hai, aur",
        "wahi ek line poori *\"pehle pay kar diya, ab wapas lo\"* wali samasya",
        "khatam karti hai.",
      ].join("\n"),
      assert: [
        ...A.custom("refund khul gayi, ya documented business refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([201, 200, 409, 422]);',
          "const b = pm.response.json();",
          "if (code < 300) {",
          "  pm.expect(b.success).to.eql(true);",
          '  pm.expect(b.data, "_id").to.have.property("_id");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
      capture: [["refund_request_id", "d._id"]],
    }),

    req({
      name: "Refund wapas le lo",
      method: "PATCH",
      segments: ["refunds", "{{refund_request_id}}", "withdraw"],
      token: CUST,
      description: [
        "`PROCESSING` ke baad **nahi** — paisa Razorpay ke paas hai, wapas lene ko",
        "kuch hai hi nahi.",
        "",
        "`settlementHold` yahin hatta hai. ⚠️ Jo hold koi nahi hataata wo vendor ka",
        "paisa **har aane wali settlement se hamesha ke liye** bahar kar deta hai,",
        "**chup-chaap** — eligibility predicate bas match karna band kar deta hai,",
        "koi error nahi, koi log nahi.",
        "",
        "⚠️ `CANCELLED` bhi abuse counter me ginta hai: raise → vendor dekhe →",
        "withdraw → phir raise, ye vendor ko vyast rakhne ka tareeka hai bina",
        "kabhi rejection kamaye.",
      ].join("\n"),
      assert: [
        ...A.custom("withdraw hua, ya documented refusal", [
          'pm.expect(pm.response.code, "status").to.be.oneOf([200, 404, 409, 422]);',
          'pm.expect(pm.response.json()).to.have.property("success");',
        ]),
      ],
    }),

    req({
      name: "Failed refund kahan bheju — apna bank account chuno",
      method: "PATCH",
      segments: ["refunds", "{{awaiting_bank_refund_id}}", "bank-account"],
      token: CUST,
      body: { bankAccountId: "{{bank_account_id}}" },
      description: [
        "Jab paisa **usi raaste se wapas nahi ja sakta** — band card, deactivated",
        "UPI — tab customer batata hai kahan bheja jaaye.",
        "",
        "`SOURCE` refund band pade instrument par **har baar** fail hota hai. Is",
        "endpoint se pehle admin ke paas doosra button hi nahi tha: request",
        "`FAILED` par baithi rehti, **vendor ka paisa hold me phansa rehta, aur",
        "grahak ko uska kabhi milta hi nahi** — teen taraf se ek saath atka hua.",
        "",
        "⚠️ Account customer ki **apni verified list** se aata hai",
        "(`GET /bank-accounts`), aur service refund ka unka hona verify karti hai —",
        "koi kisi aur ka refund kahin point nahi kar sakta.",
        "",
        "⚠️ **Sirf `AWAITING_BANK_DETAILS` status par chalta hai**, aur wahan",
        "pahunchne ke liye admin ko pehle `SOURCE` fail dekhna aur bank details",
        "maangni padti hai — teen actor ka sequence jo customer collection khud",
        "drive nahi kar sakti. **Seeder us state me ek refund rakhta hai**,",
        "isiliye iska asli example capture ho paata hai.",
        "",
        "⚠️ Status seedha `ADMIN_APPROVED` par jaata hai, `FAILED` par **nahi** —",
        "refund ka faisla bahut pehle ho chuka hai aur badla nahi; sirf",
        "**destination** badla hai. `FAILED` par landing use retry queue me daal",
        "deti jaise `SOURCE` dobara try karna chahiye — theek wahi ek cheez jo",
        "pakka kaam nahi karegi.",
      ].join("\n"),
      assert: [
        ...A.custom("bank account jud gaya, ya documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 403, 404, 409, 422]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          "  pm.expect(b.success).to.eql(true);",
          '  pm.expect(b.data.status, "status").to.eql("ADMIN_APPROVED");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),

    req({
      name: "Meri refunds",
      method: "GET",
      segments: ["refunds"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
      ],
      token: CUST,
      description: [
        "Ek endpoint, teen shapes — scope aur projection **token se**.",
        "",
        "⚠️ `split` me `platformPromoReversal` aur `gatewayFeeAbsorbed` (hamara",
        "margin) **usi sub-document par** hain jispar `vendorClawback` hai —",
        "isiliye faisla ek jagah hota hai, teen endpoint me nahi.",
        "",
        "⚠️ `canDecide` / `canWithdraw` response me **bataye** jaate hain. Jo panel",
        "inhe status se khud nikalega wo naye state judte hi **galat** ho jayega.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.paged(),
        ...A.fields(
          { _id: "string", status: "string", requestedAmount: "number" },
          { each: true },
        ),
        ...A.absent(["gatewayFeeAbsorbed", "platformPromoReversal"], {
          each: true,
        }),
      ],
      capture: [["refund_request_id", "d.data[0]._id"]],
    }),

    req({
      name: "Ek refund — timeline ke saath",
      method: "GET",
      segments: ["refunds", "{{refund_request_id}}"],
      token: CUST,
      description: [
        "Refund + claim + **claim ki timeline**.",
        "",
        "Alag refund timeline **nahi** hai, aur ye jaan-boojh kar: refund claim ke",
        "saath hui ek cheez hai, aur claim ki kahani wahi jagah hai jahan teeno",
        "(customer, vendor, admin) jaate hain.",
        "",
        "Poora row padhkar, jaanchkar, phir `pickByProjection` se chhanta hai —",
        "ownership `customerId`/`brandId` me hai aur vendor projection unhi ko",
        'chhupati hai, to pehle project karna *"ye tumhara hai?"* aise document se',
        "poochna hota jo ab batata hi nahi kiska hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        /**
         * ⚠️ Nested under `data.refund`, with the **claim** beside it — a refund
         * on its own is an amount and a status, and every question anyone asks
         * about it ("of what? bought when? at which outlet?") is on the claim.
         */
        ...A.custom("refund + claim + timeline + viewer", [
          "const d = pm.response.json().data;",
          '["refund", "claim", "timeline", "viewer"].forEach(function (k) {',
          "  pm.expect(d, k).to.have.property(k);",
          "});",
          'pm.expect(d.refund._id, "refund._id").to.be.a("string");',
          'pm.expect(d.refund.status, "refund.status").to.be.a("string");',
          'pm.expect(d.timeline, "timeline").to.be.an("array");',
        ]),
      ],
    }),

    req({
      name: "Dusre ki claim par refund — 403",
      method: "POST",
      segments: ["refunds"],
      token: CUST,
      body: { claimId: "{{other_customer_claim_id}}", reason: "NOT_HONOURED" },
      description: [
        "Ek customer doosre ki claim **refund na kara paaye**.",
        "",
        "⚠️ Wahi trap jo claim wale 403 test me tha — variable khaali hone par",
        "jawab `422` aata tha, `403` nahi, aur test **galat wajah se** fail hota",
        "tha. Seeder ab doosre customer ki claim banata hai.",
      ].join("\n"),
      assert: [...A.status(403), ...A.err()],
    }),

    req({
      name: "OTHER bina note — 422",
      method: "POST",
      segments: ["refunds"],
      token: CUST,
      /**
       * ⚠️ `refundable_claim_id`, and the assertion checks the **message**.
       *
       * The note rule lives in `requestRefund.js`, **after** eligibility and the
       * window. Point this at an ineligible claim and the eligibility 422 fires
       * first — the test still goes green on the status code while never
       * reaching the rule it exists to check. It was doing exactly that,
       * answering *"This claim is pending and cannot be refunded."*
       *
       * By this point in the folder the spare claim's refund has been withdrawn,
       * so it is eligible again and the only thing wrong is the missing note.
       */
      body: { claimId: "{{refundable_claim_id}}", reason: "OTHER" },
      description: [
        "`reason: OTHER` ke saath `reasonNote` **zaroori** hai.",
        "",
        "Wajah practical hai: jab vendor inkaar kare aur grahak us inkaar ko",
        "chunauti de, admin ke paas sameeksha karne ko **yahi ek cheez** hoti hai.",
        '*"OTHER"* apne aap me kuch nahi batata.',
        "",
        "⚠️ Ye rule **validator me nahi, service me** hai (`requestRefund.js`) —",
        "eligibility aur window ke **baad**. Iska matlab: ineligible claim par",
        "eligibility ka `422` pehle aata hai aur ye rule chhua hi nahi jaata. Isliye",
        "yahan message bhi assert hota hai, sirf status code nahi.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err("Please tell us what went wrong")],
    }),
  ],
);

// ---------------------------------------------------------- 13. bank accounts

const bankFolder = folder(
  "13 — Bank Accounts",
  [
    "Customer ke bank accounts — **use tab hote hain jab refund wapas usi raaste",
    "se nahi ja sakta**.",
    "",
    "### Ye apna domain kyun hai, `/refunds` ka hissa kyun nahi",
    "",
    "Account **customer ka** hai, ek refund ka nahi. Use refund ke neeche rakhna",
    "matlab agle refund par use **dobara add karna — aur dobara verify karna,",
    "paise dekar** — aur ye dekhne ka koi raasta na rehna ki customer ke paas",
    "file me kya hai.",
    "",
    "⚠️ **Har route par `isCustomer`**, aur customer id har service ke andar",
    "**token se** aata hai. Yahan kuch bhi `customerId` **leta hi nahi**: jo leta",
    "wo ek insaan ko doosre ke accounts padhne ya add karne de deta.",
    "",
    "⚠️ **Pehle do endpoints ke success examples capture nahi hue, aur ye",
    "deliberate hai.** `POST /otp` ek asli WhatsApp/SMS bhejta hai **jiska hum",
    "paisa dete hain**, aur `POST /` ek **live CGPey penny drop** hai asli bank",
    "account par. Seeder ek pehle-se-verified account rakhta hai, isliye list,",
    "delete aur refund ka bank-account choose — teeno ke **asli** examples hain,",
    "bina ek rupya kharch.",
  ].join("\n"),
  [
    req({
      name: "Bank account jodne ka code maango",
      method: "POST",
      segments: ["bank-accounts", "otp"],
      token: CUST,
      description: [
        "Step one: code, kuch add hone se **pehle**.",
        "",
        "⚠️ **Account add karna ye tay karta hai ki paisa kahan jayega**, to sirf",
        "login galat strength ka gate hai: live session rakhne wala koi bhi warna",
        "ek pending refund apne account par point kar leta — aur **NEFT wapas nahi",
        "bulayi ja sakti**.",
        "",
        "⚠️ Throttle `services/otps/sendOtp.js` me hai, **route par nahi** — 60s",
        "gap, 5 per hour (`Setting.security.otp` se override). Route par rakhna",
        "matlab agle mahine juda endpoint bina protection ke chala jaata, aur",
        "**bhoolne par koi error hi nahi aata** — bas ek khula endpoint.",
        "",
        "⚠️ Keyed on **target** (number/email), IP par nahi. Indian mobile networks",
        "hazaaron asli customers ko ek CGNAT address ke peeche rakhte hain — IP",
        "limit ek block ke logon ko bahar kar deti hai aur phone wale attacker ko",
        "baithe-baithe chhod deti hai. Ek number ek insaan hai.",
        "",
        "Response `sentTo` **masked** hai — poora number wapas bhejna use phir",
        "uska hi verification nahi rehne deta.",
      ].join("\n"),
      assert: [
        ...A.custom("code chala gaya, ya throttle/documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404, 422, 429]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          "  pm.expect(b.success).to.eql(true);",
          '  pm.expect(b.data.sentTo, "sentTo").to.be.a("string");',
          '  pm.expect(b.data.channel, "channel").to.be.a("string");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),

    req({
      name: "Bank account jodo (live penny drop)",
      method: "POST",
      segments: ["bank-accounts"],
      token: CUST,
      body: {
        accountNumber: "912010004512345",
        ifscCode: "HDFC0001234",
        accountHolderName: "postman seed customer",
        otp: "{{otp}}",
      },
      description: [
        "Step two: account, code ke saath.",
        "",
        "⚠️ **Ye ek live CGPey penny drop hai — asli paisa, asli bank.** Isiliye",
        "iska success example capture nahi kiya gaya; jo example saved hai wo asli",
        "refusal hai jo galat ya expire hue OTP par aata hai.",
        "",
        "**Kram hi design hai:**",
        "",
        "```",
        "OTP (consume)  →  pehle se verified account reuse  →  penny drop  →  store",
        "```",
        "",
        "OTP **pehle** jaata hai, taaki chori hui session hamse ek **paid**",
        "verification call kharch na kara sake, account jodna to door ki baat.",
        "Reuse check drop se pehle, taaki pehle se sabit account dobara daalne par",
        "**kuch kharch na ho**.",
        "",
        "⚠️ **Verification ke baare me client se kuch bhi accept nahi hota** — na",
        "`isVerified`, na `verifiedAt`, na provider ka response. Server khud drop",
        "karta hai aur `isVerified` uske jawab se derive karta hai. Jo client",
        "`isVerified: true` keh sakta ho wo refund kisi bhi account par point kar",
        "sakta hai.",
        "",
        "⚠️ **Fail hua drop bhi record hota hai** — row error throw hone se",
        "**pehle** likhi jaati hai. Padhne me ajeeb lagta hai aur deliberate hai:",
        "support ko dikhna chahiye ki customer ne koshish ki aur provider ne kya",
        "kaha. Bina likhe throw karne par koi insaan kehta rehta hai ki usne",
        "details daali thi aur dikhane ko kahin kuch nahi hota.",
        "`isVerified: false` hi wo cheez hai jo **paisa rokti hai** — unverified",
        "row saboot hai, destination kabhi nahi.",
      ].join("\n"),
      assert: [
        ...A.custom("account juda, ya asli provider/OTP refusal", [
          "const code = pm.response.code;",
          // ⚠️ `401` is in this list because a wrong OTP is a 401 here, and the
          // collection's `otp` is a placeholder — the bank code is a real one
          // sent to a real phone. That refusal *is* this request's captured
          // example, and it is the honest one.
          'pm.expect(code, "status").to.be.oneOf([201, 400, 401, 404, 422, 429, 503]);',
          "const b = pm.response.json();",
          "if (code === 201) {",
          "  pm.expect(b.success).to.eql(true);",
          '  pm.expect(b.data.isVerified, "isVerified").to.eql(true);',
          '  pm.expect(b.data, "raw accountNumber").to.not.have.property("accountNumber");',
          '  pm.expect(b.data, "provider dump").to.not.have.property("verificationResponse");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
      capture: [["bank_account_id", "d._id"]],
    }),

    req({
      name: "Mere bank accounts",
      method: "GET",
      segments: ["bank-accounts"],
      token: CUST,
      description: [
        "Customer ke apne accounts, **newest first**.",
        "",
        "⚠️ `data` ek **plain array** hai — ye endpoint `pagination()` use **nahi**",
        "karta, to khaali hone par `[]` aata hai, `404` nahi. Baaki listings se",
        "ulta hai, aur jaan-boojh kar: bank accounts ki ginti chhoti aur bounded",
        "hai.",
        "",
        "⚠️ Projection `present()` se aati hai, jo **attach path ke saath shared**",
        "hai — alag likhne par ek surface par masked `accountNumber` doosre se",
        "poora leak ho jaata. Ek faisla, ek jagah.",
        "",
        "**Unverified rows bhi aate hain, aur marked aate hain.** Unhe chhupane par",
        "jis customer ki koshish fail hui wo khaali list dekhta rehta, bina jaane",
        "ki uski attempt register hui ya nahi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("plain array, pagination envelope nahi", [
          "const d = pm.response.json().data;",
          'pm.expect(d, "data").to.be.an("array");',
          "d.forEach(function (o) {",
          '  pm.expect(o.maskedAccountNumber, "maskedAccountNumber").to.be.a("string");',
          '  pm.expect(o.accountLast4Digits, "accountLast4Digits").to.be.a("string");',
          '  pm.expect(o.isVerified, "isVerified").to.be.a("boolean");',
          '  pm.expect(o, "raw accountNumber").to.not.have.property("accountNumber");',
          '  pm.expect(o, "provider dump").to.not.have.property("verificationResponse");',
          '  pm.expect(o, "matchingScore").to.not.have.property("matchingScore");',
          "});",
        ]),
      ],
      capture: [["bank_account_id", "d[0]._id"]],
    }),

    req({
      name: "Galat IFSC — 422",
      method: "POST",
      segments: ["bank-accounts"],
      token: CUST,
      body: {
        accountNumber: "912010004512345",
        ifscCode: "NOTANIFSC",
        otp: "{{otp}}",
      },
      description: [
        "IFSC ka shape chaar letters, phir **hamesha ek `0`**, phir chhah",
        "characters hai.",
        "",
        "Joi me isliye check hota hai (model me bhi hai) ki typo ek **field error**",
        "ban kar aaye jise app box ke paas dikha sake, Mongoose validation failure",
        "ban kar nahi.",
        "",
        "⚠️ Ye penny drop tak **pahunchta hi nahi** — validator pehle rok deta hai,",
        "to ye request koi paisa kharch nahi karti.",
      ].join("\n"),
      assert: [...A.status(422), ...A.err()],
    }),

    req({
      name: "Bank account hataao",
      method: "DELETE",
      /**
       * ⚠️ The **spare** account, not `bank_account_id`.
       *
       * Folder 12's bank-details request attaches `bank_account_id` to the
       * parked refund, and folder 12 runs first — so deleting that one is
       * correctly refused with `409` and this request could never show its
       * success. The seeder keeps a second verified account that nothing
       * references. The 409 path is documented in the description below and
       * still reachable by pointing this at `{{bank_account_id}}`.
       */
      segments: ["bank-accounts", "{{spare_bank_account_id}}"],
      token: CUST,
      description: [
        "Soft delete, baaki sab ki tarah.",
        "",
        "⚠️ **Refund is par point kar raha ho to refuse (`409`).** `PayoutLeg` apna",
        "`bankSnapshot` us waqt freeze karta hai jab paisa bheja jaata hai, to",
        "deletion history nahi badal sakti — par **jo refund pay hone ka intezaar",
        "kar raha hai wo apna destination kho deta** aur admin ki queue me aisi",
        "haalat me pahunchta hai jahan usme paisa daalne ki jagah hi nahi hoti.",
        "",
        "⚠️ Ye request folder ke **aakhir me** hai. Ise `GET` se pehle chalane par",
        "list khaali ho jaati aur `bank_account_id` kabhi capture na hota.",
      ].join("\n"),
      assert: [
        ...A.custom("hat gaya, ya refund ke kaaran refuse", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 404, 409]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          '  pm.expect(b.data.removed, "removed").to.eql(true);',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),
  ],
);

module.exports = { claimsFolder, refundsFolder, bankFolder };
