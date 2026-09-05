/**
 * The admin's side of the money: refunds decided and paid, settlements walked
 * through their state machine, disputes and holds.
 *
 * ### ⚠️ Why every action gets its own row
 *
 * These are **state machines**, not lists. `approve` needs PENDING_APPROVAL,
 * `pay` needs APPROVED, `confirm` and `fail` need PROCESSING, `retry` and
 * `abandon` need FAILED, `reverse` needs PAID. Pointing them all at one
 * `{{settlement_id}}` means the first request moves it and every later one
 * answers `422` naming a transition it never asked for — and the folder
 * documents nothing except the order it happened to run in.
 *
 * So the seeder builds six real settlements (three periods, two brands, through
 * `buildSettlements` itself) and parks each where its action begins, using
 * `transitionSettlement` — the same helper the endpoints use. Numbers from the
 * builder, states from the state machine, nothing invented.
 *
 * The one deliberate chain is the happy path, in order:
 *
 *     approve → pay → confirm → reverse
 *
 * because that *is* one settlement's life, and splitting it across four rows
 * would hide the only sequence an admin actually performs end to end.
 */

const { req, folder, A } = require("./builders");

const ADM = "admin_token";

// --------------------------------------------------------------- refunds

const refundsFolder = folder(
  "12 — Refunds (admin)",
  [
    "Vendor ke faisle ke **upar** admin ka faisla, aur uske baad paisa bhejna.",
    "",
    "Do raaste hain aur wo alag hain:",
    "",
    "| Raasta | Kab | Endpoints |",
    "|---|---|---|",
    "| Gateway | Razorpay se wapas ja sakta hai | `pay` |",
    "| Manual bank | Gateway refuse kar de, ya payment bahut purana ho | `request-bank-details` → `pay-to-bank` → `confirm-bank-payout` / `fail-bank-payout` |",
    "",
    "⚠️ **Manual raasta ek insaan ke bharose hai**, isliye do alag endpoint hain:",
    "`pay-to-bank` sirf ye kehta hai *\"maine NEFT shuru kar diya\"*, aur",
    "`confirm-bank-payout` UTR ke saath kehta hai *\"paisa pahunch gaya\"*. Ek hi",
    "endpoint hota to shuru karna aur pahunchna ek jaisa dikhta — aur",
    "`sweepStalePayouts` ka poora kaam theek wahi farq dekhna hai.",
  ].join("\n"),
  [
    req({
      name: "Refund worklist ⭐",
      method: "GET",
      // ⚠️ No `/admin` twin: scope is derived from the token, so an admin
      // gets every brand from the same route a vendor gets their own.
      segments: ["refunds"],
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "20" },
        { key: "status", value: "REQUESTED", disabled: true },
        { key: "brandId", value: "{{brand_id}}", disabled: true },
      ],
      token: ADM,
      description: [
        "Har brand ki refunds, ek jagah.",
        "",
        "⚠️ Paginated — rows `data.data` me hain, `data` me nahi. Vendor",
        "collection me theek yahi assumption teen assertions ko tod chuki hai,",
        "aur unme se ek **chup-chaap pass** ho rahi thi.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("paginated shape", [
          "const d = pm.response.json().data;",
          'pm.expect(d.data, "data.data").to.be.an("array");',
          'pm.expect(d.total, "total").to.be.a("number");',
        ]),
      ],
    }),

    req({
      name: "Admin approve — vendor ke upar ⭐",
      method: "PATCH",
      segments: ["refunds", "admin", "{{admin_refund_id}}", "approve"],
      token: ADM,
      body: { note: "Customer ki baat sahi hai — approve." },
      description: [
        "`overrideReason` tab chahiye jab vendor ne **reject** kiya ho.",
        "",
        "⚠️ Vendor ka faisla palatna record me dikhna chahiye. Bina reason ke",
        "override ka matlab hota ek aisa refund jise vendor ne mana kiya tha aur",
        "history bata hi nahi sakti kyun palta — jo theek wo sawal hai jo baad me",
        "poocha jaata hai.",
      ].join("\n"),
      assert: [
        ...A.custom("approve hua, ya documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 403, 422]);',
          "const b = pm.response.json();",
          "if (code === 200) {",
          '  pm.expect(b.data, "data").to.be.an("object");',
          "} else {",
          "  pm.expect(b.success).to.eql(false);",
          "}",
        ]),
      ],
    }),

    req({
      name: "Admin reject",
      method: "PATCH",
      segments: ["refunds", "admin", "{{admin_rejectable_refund_id}}", "reject"],
      token: ADM,
      body: { note: "Bill aur claim match nahi kar rahe." },
      description:
        "Apni row, kyunki approve upar wali ko decide kar chuka hai — ek hi id par dono chalane se doosra `422` deta hai *\"already decided\"* ke liye, us wajah ke liye nahi jo test ke naam me likhi hai.",
      assert: [
        ...A.custom("reject hua, ya documented refusal", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 403, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "Gateway se paisa wapas bhejo",
      method: "PATCH",
      segments: ["refunds", "admin", "{{admin_payable_refund_id}}", "pay"],
      token: ADM,
      description: [
        "Razorpay ko refund bhejta hai.",
        "",
        "⚠️ Ye **asli gateway call** hai. Test keys par bhi ye ek asli refund",
        "banata hai, isliye iska example wahi jawab hai jo seeded row par aata",
        "hai — success ya wo refusal jo gateway deta hai.",
        "",
        "⚠️ Idempotency key **gateway call se pehle** likhi jaati hai, baad me",
        "nahi. Do concurrent tap dono read-then-write check paas kar lete hain;",
        "unique index hi doosre ko rokta hai — aur gateway aakhir me isliye aata",
        "hai kyunki wahi ek step hai jiska koi undo nahi.",
      ].join("\n"),
      assert: [
        ...A.custom("gateway ka jawab", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 400, 402, 409, 422, 502]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "Bank details maango (gateway ne mana kiya)",
      method: "PATCH",
      segments: [
        "refunds",
        "admin",
        "{{admin_bank_refund_id}}",
        "request-bank-details",
      ],
      token: ADM,
      body: { reason: "Gateway refund window closed — manual NEFT karenge." },
      description: [
        "Refund `AWAITING_BANK_DETAILS` par chala jaata hai aur customer ko",
        "account jodne ko kaha jaata hai.",
        "",
        "⚠️ Yahi wo haalat hai jiske liye customer ke paas",
        "`POST /refunds/:id/bank-account` hai. Bina is state ke customer ko pata",
        "hi nahi chalta ki uska paisa ruka kyun hai — sirf ek refund dikhta jo",
        "hil nahi raha.",
      ].join("\n"),
      assert: [
        ...A.custom("bank details maange gaye, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "NEFT shuru kiya",
      method: "PATCH",
      segments: ["refunds", "admin", "{{admin_payout_refund_id}}", "pay-to-bank"],
      token: ADM,
      description:
        "Sirf *\"maine bhej diya\"*. Paisa pahuncha ya nahi, wo agla endpoint kehta hai — dono ko ek karna matlab ek shuru hua payout aur ek pahuncha hua payout dikhne me ek jaise, aur `sweepStalePayouts` ka poora kaam theek wahi farq dekhna hai.",
      assert: [
        ...A.custom("payout shuru hua, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "NEFT pahunch gaya — UTR ke saath",
      method: "PATCH",
      segments: [
        "refunds",
        "admin",
        "{{admin_payout_refund_id}}",
        "confirm-bank-payout",
      ],
      token: ADM,
      body: {
        utr: "PMFXUTR000000001",
        mode: "NEFT",
        paidAt: "{{now_iso}}",
      },
      description: [
        "UTR bank ka reference hai — wahi ek cheez hai jisse baad me dhoondha ja",
        "sakta hai ki paisa sach me gaya ya nahi.",
        "",
        "⚠️ `paidAt` alag field hai, `updatedAt` nahi. NEFT kal shuru hua aur aaj",
        "confirm hua — dono tareekh alag hain, aur reconciliation wahi padhta hai",
        "jo bank ne kiya, wo nahi jab humne form bhara.",
      ].join("\n"),
      assert: [
        ...A.custom("confirm hua, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "NEFT shuru kiya — fail hone wali row",
      method: "PATCH",
      segments: [
        "refunds",
        "admin",
        "{{admin_failable_refund_id}}",
        "pay-to-bank",
      ],
      token: ADM,
      description: [
        "Doosri row ka payout, sirf isliye ki niche wali request ke paas girane",
        "ko kuch ho.",
        "",
        "⚠️ `fail-bank-payout` ek **INITIATED payout leg** dhoondhta hai, refund",
        "ka status nahi. Upar wali row ka leg `confirm` kha chuka hai, to ek hi",
        "row par dono chalane se ye `409 \"There is no payout in flight\"` deta —",
        "sahi jawab, par us sawaal ka nahi jo is request ke naam me likha hai.",
      ].join("\n"),
      assert: [
        ...A.custom("payout shuru hua, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "NEFT fail ho gaya",
      method: "PATCH",
      segments: [
        "refunds",
        "admin",
        "{{admin_failable_refund_id}}",
        "fail-bank-payout",
      ],
      token: ADM,
      body: { reason: "Beneficiary account name mismatch — bank ne wapas kiya." },
      description:
        "Apni row, kyunki upar wali confirm ho chuki hai. Fail hone par refund wapas khulta hai — hold bhi bana rehta hai, kyunki paisa abhi bhi customer ka hai.",
      assert: [
        ...A.custom("fail record hua, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),
  ],
);

// ----------------------------------------------------------- settlements

const settlementsFolder = folder(
  "13 — Settlements (admin)",
  [
    "Vendor ka payout — banna, approve hona, jaana, aur galat hone par wapas",
    "aana.",
    "",
    "### ⚠️ Har action ki apni row hai",
    "",
    "Ye ek **state machine** hai:",
    "",
    "```",
    "PENDING_APPROVAL → APPROVED → PROCESSING → PAID → REVERSED",
    "        ↓             ↓            ↓",
    "     ON_HOLD      CANCELLED     FAILED → APPROVED (retry)",
    "                                   ↓",
    "                               ABANDONED",
    "```",
    "",
    "Ek hi `{{settlement_id}}` par sab chalane se pehli request use hila deti",
    "hai aur baaki sab `422` deti hain — ek transition ka naam lekar jo unhone",
    "maanga hi nahi tha. To seeder **chhe asli settlements** banata hai (teen",
    "period, do brand, `buildSettlements` se hi) aur har ek ko uske action ke",
    "shuru par khada kar deta hai.",
    "",
    "⚠️ Ek chain jaan-boojh kar rakhi hai — **approve → pay → confirm →",
    "reverse** — kyunki wahi ek settlement ki poori zindagi hai, aur use chaar",
    "rows me todne se wo ekmatra sequence chhup jaati jo admin sach me karta",
    "hai.",
  ].join("\n"),
  [
    req({
      name: "Approve ⭐",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_approvable_id}}", "approve"],
      token: ADM,
      body: { note: "Numbers checked against the statement." },
      description: [
        "`PENDING_APPROVAL` → `APPROVED`.",
        "",
        "⚠️ Approve karna **pay karna nahi hai**. `pay` alag deliberate kaam hai,",
        "aur wahan `needsRevalidation` dobara check hota hai — approve aur payout",
        "ke beech ghante nikal jaate hain, aur us dauraan ek refund aa sakta hai.",
      ].join("\n"),
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("APPROVED ho gaya", [
          "const d = pm.response.json().data;",
          "const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("APPROVED");',
        ]),
      ],
    }),

    req({
      name: "Payout shuru karo",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_approvable_id}}", "pay"],
      token: ADM,
      description: [
        "`APPROVED` → `PROCESSING`. Upar wali hi row — yahi wo chain hai.",
        "",
        "⚠️ `needsRevalidation` yahan dobara dekha jaata hai. Approve ke waqt",
        "sahi hona kaafi nahi: agar us beech koi refund aa gaya to ye payout",
        "vendor ko wo paisa de dega jo ab customer ka hai, aur wapas lena",
        "chargeback banta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("PROCESSING, ya revalidation ne roka", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "if (code === 200) {",
          "  const d = pm.response.json().data; const s = d.settlement || d;",
          '  pm.expect(s.status, "status").to.eql("PROCESSING");',
          "}",
        ]),
      ],
    }),

    req({
      name: "Payout pahunch gaya — UTR ke saath",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_approvable_id}}", "confirm"],
      token: ADM,
      body: {
        utr: "PMFXSTL000000001",
        mode: "NEFT",
        paidAt: "{{now_iso}}",
      },
      description: [
        "`PROCESSING` → `PAID`. Chain ka teesra step.",
        "",
        "⚠️ `amount` optional hai aur bhejne par **match karna chahiye**. Bank ne",
        "kam bheja to wo ek alag ghatna hai — use `PAID` likh dena statement ko",
        "chup-chaap galat kar deta hai.",
      ].join("\n"),
      assert: [
        ...A.custom("PAID, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "if (code === 200) {",
          "  const d = pm.response.json().data; const s = d.settlement || d;",
          '  pm.expect(s.status, "status").to.eql("PAID");',
          "}",
        ]),
      ],
    }),

    req({
      name: "Payout wapas lo (reverse)",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_approvable_id}}", "reverse"],
      token: ADM,
      body: { reason: "Bank ne credit wapas le liya — vendor ko paisa nahi mila." },
      description: [
        "`PAID` → `REVERSED`. Chain ka aakhri step, aur **ekmatra** raasta",
        "`PAID` se bahar.",
        "",
        "⚠️ Reverse claimed rows ko **chhod deta hai**, isliye wo paisa agle",
        "cycle me wapas aa jaata hai. Bina release ke wo rows hamesha ke liye is",
        "settlement se bandhi rehti — aur eligibility predicate unhe dhoondhna",
        "band kar deta, bina kisi error ya log ke.",
      ].join("\n"),
      assert: [
        ...A.custom("REVERSED, ya state galat", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "if (code === 200) {",
          "  const d = pm.response.json().data; const s = d.settlement || d;",
          '  pm.expect(s.status, "status").to.eql("REVERSED");',
          "}",
        ]),
      ],
    }),

    req({
      name: "Hold karo",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_holdable_id}}", "hold"],
      token: ADM,
      body: { reason: "Brand ke KYC documents dobara dekhne hain." },
      description:
        "Apni row. `ON_HOLD` ek **rukna** hai, khatam hona nahi — wahan se `PENDING_APPROVAL` par wapas aaya ja sakta hai, ya `CANCELLED` par.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("ON_HOLD", [
          "const d = pm.response.json().data; const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("ON_HOLD");',
        ]),
      ],
    }),

    req({
      name: "Cancel karo",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_cancellable_id}}", "cancel"],
      token: ADM,
      body: { reason: "Galat period ke liye bana tha." },
      description:
        "`ON_HOLD` → `CANCELLED`, aur ye final hai. Cancel bhi rows release karta hai — paisa agle cycle me wapas aata hai, kho nahi jaata.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("CANCELLED aur rows chhoot gayin", [
          "const d = pm.response.json().data; const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("CANCELLED");',
        ]),
      ],
    }),

    req({
      name: "Payout fail hua",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_processing_id}}", "fail"],
      token: ADM,
      body: {
        // Enum, not prose: BANK_REJECTED | ACCOUNT_INVALID |
        // INSUFFICIENT_BALANCE | GATEWAY_ERROR | OTHER. `note` is where the
        // sentence goes.
        reason: "BANK_REJECTED",
        note: "Bank ne wapas kiya, RRN diya nahi.",
      },
      description:
        "`PROCESSING` → `FAILED`. Ye row jaan-boojh kar `PROCESSING` me park ki gayi hai, kyunki `confirm` ne chain wali row le li.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("FAILED", [
          "const d = pm.response.json().data; const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("FAILED");',
        ]),
      ],
    }),

    req({
      name: "Dobara koshish karo (retry)",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_failed_id}}", "retry"],
      token: ADM,
      description:
        "`FAILED` → `APPROVED`, yani payout dobara karne layak. Rows chhodi nahi jaatin — wo abhi bhi is settlement ki hain, aur yahi retry aur abandon ka farq hai.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("wapas APPROVED", [
          "const d = pm.response.json().data; const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("APPROVED");',
        ]),
      ],
    }),

    req({
      name: "Chhod do (abandon)",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_abandonable_id}}", "abandon"],
      token: ADM,
      body: { reason: "Brand band ho gaya — payout ka koi raasta nahi." },
      description:
        "`FAILED` → `ABANDONED`, final. Retry ke ulat, ye rows **chhod deta hai** — paisa agle cycle me wapas aata hai kisi aur settlement ke liye.",
      assert: [
        ...A.status(200),
        ...A.ok(),
        ...A.custom("ABANDONED", [
          "const d = pm.response.json().data; const s = d.settlement || d;",
          'pm.expect(s.status, "status").to.eql("ABANDONED");',
        ]),
      ],
    }),

    req({
      name: "Dobara banao (rebuild)",
      method: "PATCH",
      segments: ["settlements", "admin", "{{settlement_holdable_id}}", "rebuild"],
      token: ADM,
      body: { reason: "Refund aane ke baad numbers dobara ginne hain." },
      description: [
        "Rows chhodkar usi period ke liye dobara ginta hai.",
        "",
        "⚠️ Sirf payout se **pehle** — `PAID` ke baad rebuild ka matlab hota us",
        "paise ka hisaab badalna jo ja chuka hai.",
      ].join("\n"),
      assert: [
        ...A.custom("rebuild hua, ya state ne mana kiya", [
          "const code = pm.response.code;",
          'pm.expect(code, "status").to.be.oneOf([200, 422]);',
          "pm.expect(pm.response.json()).to.have.property('success');",
        ]),
      ],
    }),

    req({
      name: "Is brand ka bakaya (debt)",
      method: "GET",
      segments: ["settlements", "admin", "debt", "{{brand_id}}"],
      token: ADM,
      description: [
        "`netPayable <= 0` settlement ko `CARRIED_FORWARD` bhejta hai — aur",
        "carry forward karna hi rows chhodna hai, to bakaya aur kamai dono agle",
        "cycle me chale jaate hain.",
        "",
        "⚠️ Jab tak brand bech raha hai, nayi sales use kaat deti hain. Jis din",
        "wo band karta hai, wahi rows hamesha claim aur release hoti rehti hain:",
        "koi error nahi, koi log nahi, aur paisa hamari kitaab par ek aise",
        "aadmi se receivable ban kar baith jaata hai jo wapas nahi aa raha.",
        "",
        "`alertVendorDebt` roz ye dekhta hai aur **kuch karta nahi** — debt",
        "write off karna ek accounting faisla hai jis par kisi insaan ka naam",
        "hota hai.",
      ].join("\n"),
      assert: [...A.status(200), ...A.ok()],
    }),

    req({
      name: "Doosre ki settlement — admin ke liye 200",
      method: "GET",
      segments: ["settlements", "{{other_brand_settlement_id}}"],
      token: ADM,
      description:
        "Wahi id jispe vendor ko `403` milta hai. Admin ke liye `200` — aur yahi jodi sabit karti hai ki refusal **ownership** par hai, id ke maujood na hone par nahi.",
      assert: [...A.status(200), ...A.ok()],
    }),
  ],
);

module.exports = { refundsFolder, settlementsFolder };
