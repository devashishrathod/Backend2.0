# Vendor Settlement, Refunds & Chargebacks — Implementation Plan

> ## ⏳ Aadha ban chuka hai — aur ye doc "kya banana tha" hai, "kya hai" nahi
>
> | Phase | Haalat |
> |---|---|
> | **S1 — Refunds** | ✅ `SOURCE` ka poora lifecycle. ❌ `MANUAL_BANK` (§6.1, §6.5) nahi bana |
> | **S2 — Settlement** | ✅ build · claim · approve · payout · reversal · sweeps. ❌ statement PDF, per-brand config |
> | **S3 — Chargebacks** | ⏳ **sirf recovery bana** (§7.5). Dispute model, evidence pack, reserve, receivables — kuch nahi |
>
> **Ye doc jaan-boojh kar waise ka waisa rakha gaya hai.** Isme har faisle ka *kyun* hai —
> golden rule, hold ka design, promo split, chargeback strategy — aur wo kahin aur nahi
> likha. Par is doc me likhi baat aur aaj ke code me farak ho, to **code sahi hai**.
>
> | Kya jaanna hai | Kahan padho |
> |---|---|
> | Kaunsa module bana, kya nahi, kis file me | [`implementation_phases.md`](./implementation_phases.md) |
> | Refund aaj kaise chalta hai | [`refund_flow.md`](./refund_flow.md) |
> | Settlement aaj kaise chalta hai | [`settlement_flow.md`](./settlement_flow.md) |
>
> ⚠️ **Chaar jagah is doc ka likha aaj galat ya adhoora hai:**
> 1. **§7.5 chargeback recovery ka strategy likha tha, par code me `chargebackAdjustment`
>    hardcoded `0` tha** aur ledger types koi likhta hi nahi tha — platform chup-chaap
>    nuksaan utha raha tha. Money audit me bana. `settlement_flow.md` §2.5a dekho.
> 2. **Partial refund** ka netting is doc me arithmetic me tha, par code use **filter se**
>    bahar kar deta tha — ek ₹800 ki sale par vendor ko lagbhag ₹1,100 ka farak. Ab
>    arithmetic me hi kata hai.
> 3. **`BrandSettlementConfig`** is doc me maana gaya hai; wo model **bana hi nahi**.
>    Config saare brands ke liye ek hi hai (`Setting.customer.settlement`).
> 4. **~40 endpoints implied the par ek bhi path likha nahi tha.** Ab teeno jagah likhe
>    hain: `settlement_flow.md` §7, `refund_flow.md` §1.5, aur `endpoints_category.md`.
>
> **Sibling doc:** [customer_voucher_claim_plan.md](./customer_voucher_claim_plan.md) — paisa andar aane wala hissa
> **Scope:** money ledger → settlement cycle → vendor payout → refunds → chargebacks

Ye doc **paisa bahar jaane** ka design hai. Claim / checkout side sibling doc me hai.

---

## 0. Locked decisions

| # | Sawaal | Faisla |
|---|---|---|
| 1 | Payout provider | **`MANUAL_BANK` abhi.** RazorpayX aur Route future — §11 |
| 2 | Payout timing | Razorpay khud T+2 hold karta hai → vendor ko **T+3**, per vendor per day |
| 3 | Commission | **0% abhi**, poora structure banega — on karna config-only |
| 4 | Vendor balance | **Append-only `LedgerEntry`** |
| 5 | Refund flow | Customer raise → **vendor approve** → admin execute. Admin override sirf rare case |
| 6 | Refund destination | **`SOURCE`** — Razorpay se usi card/UPI me wapas. `MANUAL_BANK` fallback (band card / dead VPA) — §6 |
| 7 | Refund par promo | **Wapas nahi** by default; `releasePromoOnRefund` config se |
| 8 | Chargeback | Layered defence, reserve **sirf risky vendor** par |
| 9 | Gateway fee (MDR) | Ab **model hoga** — bearer config, default `PLATFORM` — §2.5 |
| 10 | Payout record | Ek hi `PayoutLeg` model — settlement aur refund dono ke liye — §3.2 |

---

## 1. Aaj codebase me kya hai

- `Transaction.settlementId` (`models/Transaction.js:38`) aur `validObjectId.js:38` → `refField("Settlement")` **maujood hain** — model banaya nahi gaya. Jagah chhodi hui hai
- `models/Bank.js` — vendor ka bank, CGPEY penny-drop se verified (`isVerified`, `maskedAccountNumber`, `accountLast4Digits`, IFSC)
- `helpers/promoCodes/promoReservation.js` — **claim-lock ka established pattern**: reserve / release / stale-sweep. Settlement bilkul isi shape par banega
- Payout / settlement / refund ka koi code nahi. `grep settlementId` → sirf 3 schema declarations, koi writer nahi

---

## 2. Money ledger

Iske bina "is vendor ka kitna baaki hai" har baar transactions par aggregation se nikalta, aur har naya case (refund, partial refund, chargeback, chargeback jeeta, adjustment, reserve) us query me ek aur clause banta jaata. Chhe mahine me wo query hi bug ban jaati.

### 2.1 Model

```js
// models/LedgerEntry.js — append-only. Kabhi update nahi, kabhi delete nahi.
{
  entryType,          // §2.2
  direction,          // CREDIT | DEBIT
  amount,             // hamesha positive; direction se matlab banta hai
  currency,

  account,            // VENDOR_PAYABLE | PLATFORM_REVENUE | PLATFORM_COST | TAX_PAYABLE
  brandId,            // VENDOR_PAYABLE par hamesha

  transactionId, voucherClaimId, settlementId,
  refundRequestId, disputeId, payoutLegId,

  narration,          // insaan ke padhne layak — accountLast4 + UTR bhi
  occurredAt,
  reversalOf,         // jab ek entry doosri ko ulta karti hai
  isDeleted,          // sirf shape ke liye — ledger row kabhi delete nahi hoti
}

// indexes
{ brandId: 1, account: 1, occurredAt: -1 }   // balance ek scan me
{ transactionId: 1 }
{ settlementId: 1 }
{ entryType: 1, occurredAt: -1 }
{ entryType: 1, transactionId: 1 }   // unique jahan ek hi ho sakti hai
```

### 2.2 Entry types

₹1000 bill, 20% offer, ₹50 promo (SHARED 30/70), ₹10 fee:

| Type | Kab | Account | Amount |
|---|---|---|---:|
| `COLLECTION` | payment capture | VENDOR_PAYABLE | + 800.00 |
| `VENDOR_PROMO_SHARE` | payment capture | VENDOR_PAYABLE | − 15.00 |
| `CONVENIENCE_FEE` | payment capture | PLATFORM_REVENUE | + 10.00 |
| `PLATFORM_PROMO_COST` | payment capture | PLATFORM_COST | − 35.00 |
| `GATEWAY_FEE` | payment capture | PLATFORM_COST *(bearer se)* | − 17.94 |
| `COMMISSION` | settlement PAID | PLATFORM_REVENUE | 0.00 *(abhi 0%)* |
| `TAX_COLLECTED` | capture, GST on hone par | TAX_PAYABLE | 0.00 |
| `REFUND` | `refund.processed` webhook | VENDOR_PAYABLE / PLATFORM_REVENUE | − split |
| `CHARGEBACK` | dispute LOST | VENDOR_PAYABLE | − 785.00 |
| `CHARGEBACK_REVERSAL` | dispute WON | VENDOR_PAYABLE | + 785.00 |
| `RESERVE_HOLD` | settlement, risky vendor | VENDOR_PAYABLE | − X |
| `RESERVE_RELEASE` | miyaad khatam | VENDOR_PAYABLE | + X |
| `PAYOUT` | payout leg PAID | VENDOR_PAYABLE | − leg amount |
| `PAYOUT_REVERSAL` | bank ne wapas kiya | VENDOR_PAYABLE | + leg amount |
| `MANUAL_ADJUSTMENT` | admin, wajah zaroori | koi bhi | ± |

**Vendor ka baaki paisa** = us brand ki `VENDOR_PAYABLE` rows ka sum. Ek index scan, koi shart nahi, koi bhoola hua clause nahi.

### 2.3 Do sakht niyam

1. **Ledger kabhi update nahi hoti.** Galti sudharni ho to ulti entry (`reversalOf`), purani badli nahi jaati
2. **Ledger sach hai, baaki sab uska pratibimb.** `Transaction.isPaidToVendor`, `Settlement.netPayable` — ye cache hain. Farq aane par ledger jeetega

> **⚠️ Kab likhna hai:** `DRAFT` / `PENDING_APPROVAL` par **koi ledger row nahi**. `COLLECTION`, `VENDOR_PROMO_SHARE`, `CONVENIENCE_FEE`, `PLATFORM_PROMO_COST` capture par; `COMMISSION` aur `PAYOUT` sirf `PAID` par. Ledger append-only hai aur correction sirf reversal se hoti hai — isliye ek recompute kabhi aise paise ke liye reversal na maange jo hila hi nahi.

### 2.4 `reconcileLedger` job — roz ka health check

```
1. har brand ka sum(VENDOR_PAYABLE) === us brand ke un-settled transactions ka jod
2. har settlement ka netPayable === us settlement ki PAYOUT entries ka jod
3. har verified transaction ke liye COLLECTION entry maujood hai
4. koi PAYOUT entry bina settlementId ke nahi
5. koi Transaction aise Settlement ko point na kare jiska status FAILED / REVERSED / CANCELLED ho   ← §3.5
6. har transaction ka amountRefunded === us par COMPLETED RefundRequest ka jod                      ← §6.4
```

Farq mila → `LEDGER_DRIFT` / `STRANDED_SETTLEMENT_ROWS`, severity CRITICAL, poora byora.

### 2.5 ⚠️ Gateway fee — audit finding, CRITICAL

**Razorpay net settle karta hai, gross nahi.** Customer ₹760 deta hai; Razorpay MDR (~2%) + uspar GST kaat kar lagbhag **₹742** bank me bhejta hai. Par vendor ko `vendorPayable` **₹785** gross par computed milta hai. Har transaction par platform chup-chaap ~₹18 kha raha hai, aur wo kahin record hi nahi hota.

Data pehle se aa raha hai — `settleSubscriptionPayment.js:39-40` `payment.fee` / `payment.tax` Transaction par likh hi raha hai. Sirf model karna baaki hai:

- `GATEWAY_FEE` ledger entry — capture par, `gatewayFeeBearer` ke hisaab se `PLATFORM_COST` ya `VENDOR_PAYABLE`
- `Settlement.gatewayFeeDeduction` + statement me apni row
- `settlement.gatewayFeeBearer` config — **default `PLATFORM`** (aaj wala behaviour, par **ab dikhta hua**)

Claim doc §4.1 me poora hisaab hai.

> **Ek zaroori baat:** `payment.fee` capture ke waqt payload me aata hai, isliye ye settlement ka intezaar nahi karta — ledger me capture par hi chala jayega. `VENDOR` par flip karne ke liye vendor agreement chahiye; config tab ke liye taiyar rahegi.

#### 2.5.1 Unit economics — faisla: **platform uthayega**

MDR model karte hi ek baat saaf ho jaati hai jo pehle chhupi hui thi. Method ke hisaab se MDR bahut alag hai:

| Method | MDR | Kyun |
|---|---|---|
| **UPI** | **0%** | RBI mandate (Jan 2020) — zero MDR |
| **RuPay debit** | **0%** | Wahi mandate |
| Other debit card | ~0.4–0.9% + GST | RBI ne chhote ticket par cap lagaya hai |
| **Credit card** | ~2% + GST | Koi cap nahi |
| Netbanking | ~1.6–2% + GST | |
| Wallet | ~2% + GST | |

**₹1,000 bill · 20% offer · promo nahi · GST off → customer ₹810 deta hai:**

| Method | MDR | Platform |
|---|---:|---:|
| UPI | ₹0 | **+₹10.00** ✓ |
| RuPay debit | ₹0 | **+₹10.00** ✓ |
| Debit card (~0.6%) | ₹5.73 | +₹4.27 ✓ |
| Netbanking (~1.8%) | ₹17.20 | −₹7.20 ✗ |
| Credit card (2%) | ₹19.12 | −₹9.12 ✗ |

**Blended — 80% UPI / 10% credit / 5% debit / 5% netbanking:**

```
0.80(+10.00) + 0.10(−9.12) + 0.05(+4.27) + 0.05(−7.20)  =  +₹6.94
```

**Nateeja: sankat nahi hai, par margin patla hai aur promo-sensitive hai.** Bharat me restaurant bills zyadatar UPI par hote hain, isliye blended positive rehta hai — par **₹50 ka ek platform-funded promo lagbhag 7 transactions ka margin kha jaata hai**.

**Faisla: `gatewayFeeBearer: PLATFORM`.** Abhi kuch nahi badal raha — bas ab MDR **dikhta hai** (`GATEWAY_FEE` ledger entry + statement row), jahan pehle invisible tha. Jab bhi badalna ho, §12.4 me paanchon raste config-only hain.

> Ye design ki khaami nahi thi — design ne wo cheez dikha di jo pehle chhupi hui thi.

---

## 3. Settlement

> ### ✅ Ban gaya — Phase S2 (2 Sep 2026)
>
> **Jo bana hai wo kaise chalta hai → [`settlement_flow.md`](./settlement_flow.md).**
> Yeh section design ka *kyun* rakhta hai; wo document *kya hota hai* batata hai.
>
> `models/Settlement.js` · `models/SettlementHistory.js` · `models/PayoutLeg.js` ·
> `constants/settlement.js` · `constants/payout.js` · `helpers/settlements/*` ·
> `helpers/dates/istDate.js` · `services/settlements/*` · 12 endpoints · 5 jobs.
> Tests: `settlementFoundation` · `settlementClaims` · `buildSettlements` ·
> `approveSettlement` · `paySettlement` · `payoutLedger` · `settlementListings` ·
> `settlementJobs`.
>
> **Abhi nahi bana:** statement PDF (`documentUrl` / `documentToken` model me
> hain, generator nahi) · reserve release job (`reserveHeld` bookta hai,
> `holdDays` ke baad chhodne wala kuchh nahi — reserve default me off hai) ·
> RazorpayX / Route adapter.

### 3.1 Model

```js
{
  settlementNumber,        // TD/STL/25-26/000123 — Counter pattern
  brandId,

  bankSnapshot: {          // jam gaya
    accountHolderName, maskedAccountNumber, accountLast4Digits,
    ifscCode, bankName, bankId, verifiedAt,
  },

  periodStart, periodEnd, cycleType,      // DAILY | WEEKLY | MANUAL

  grossCollected, vendorPromoCost,
  commissionAmount, commissionTax,        // abhi 0 — structure taiyar
  refundAdjustment, chargebackAdjustment,
  reserveHeld, reserveReleased,
  netPayable, transactionCount,

  status,                  // §3.4
  payoutProvider,          // MANUAL_BANK | RAZORPAYX | RAZORPAY_ROUTE

  approvedBy, approvedAt,
  needsRevalidation,       // §3.6
  taintedTransactionIds,   // §3.6
  documentUrl, documentToken,
  idempotencyKey,          // STL:<brandId>:<periodEnd> — unique
  isDeleted,
}
```

**Indexes**

| Index | Options | Kiske liye |
|---|---|---|
| `{ idempotencyKey }` | unique | **Ek period ka ek hi settlement** |
| `{ settlementNumber }` | unique | Statement identity |
| `{ brandId, periodEnd:-1 }` | — | Vendor history |
| `{ status, createdAt:-1 }` | — | Admin worklist, stuck detection |
| `{ documentToken }` | unique, partial `$type:string` | Public statement link |

### 3.2 `PayoutLeg` — ek hi model, settlement aur refund dono ke liye ⚠️

*Audit finding: ek `payoutUtr` field kaafi nahi hai.*

Money kabhi ek leg me nahi hilti:
- **MANUAL_BANK** — admin bada payout do NEFT me tod sakta hai; ek bounce hua to dobara bhejega. Do UTR, ek field
- **RazorpayX** — har retry ke baad naya payout id
- **Route** — har payment par ek transfer (`transfers.create`), phir Razorpay apne batches me linked account ko settle karta hai (`recipient_settlement_id`). Ek settlement = N transfer ids + M recipient settlement ids

Aur **refund bhi MANUAL_BANK me bilkul wahi cheez hai** — admin apne bank se NEFT karta hai aur UTR daalta hai. Isliye **ek hi model dono ke liye**: ek adapter, ek reconcile job, ek UTR ka record, aur RazorpayX/Route aane par dono ek saath switch ho jaate hain.

```js
// models/PayoutLeg.js
{
  payoutType,               // SETTLEMENT | REFUND
  settlementId,             // SETTLEMENT par — aur REFUND par bhi, §5.4
  refundRequestId,          // REFUND par
  brandId,                  // SETTLEMENT par
  customerId,               // REFUND par

  legNumber,
  amount,
  provider,                 // MANUAL_BANK | RAZORPAYX | RAZORPAY_ROUTE
  providerReference,        // payout id / transfer id / refund id
  utr,                      // bank reference — vendor aur customer dono yehi maangenge
  mode,                     // IMPS | NEFT | RTGS | UPI
  status,                   // INITIATED | PAID | FAILED | REVERSED
  bankSnapshot,             // is leg ke waqt ka payee — frozen
  initiatedAt, paidAt, failedAt, failureReason,
  initiatedBy,              // kis admin ne kiya
  isDeleted,
}
// { payoutType: 1, settlementId: 1, legNumber: 1 } unique partial (settlementId $type objectId)
// { payoutType: 1, refundRequestId: 1, legNumber: 1 } unique partial
// { utr: 1 } partial $type:string
// { providerReference: 1 } partial $type:string
// { status: 1, initiatedAt: 1 }   // reconcilePayouts
```

`PAYOUT` / `REFUND` ledger entry **leg par** likhi jaati hai, parent par nahi. Isse partially-paid settlement bhi theek se express hoti hai aur `reconcilePayouts` ke paas milane ko kuch hota hai.

### 3.3 Cycle kaise banta hai — pehle kabza, phir hisaab

Seedha tareeka lagta hai: eligible transactions **chuno**, jod lagao, settlement banao. Par chunne aur likhne ke beech me ek refund aa sakta hai — aur wo paisa do baar count ho jaata hai.

```js
// 1. Shell (idempotencyKey ki wajah se dobara nahi banega)
const settlement = await Settlement.create({
  brandId, periodStart, periodEnd,
  idempotencyKey: `STL:${brandId}:${periodEnd}`, status: DRAFT,
});

// 2. Atomically kabza — settlementId: null hi taala hai
await Transaction.updateMany(
  {
    purpose: VOUCHER_CLAIM, brandId, gatewayAccount: CUSTOMER,
    verified: true, status: CAPTURED,
    settlementId: null,               // <- taala
    settlementHold: false,
    amountRefunded: { $lte: 0 },      // boolean par nahi, amount par — §6.4
    isDeleted: false,
    verifiedAt:      { $lte: eligibleBefore },   // refund golden rule ka floor
    fundsReceivedAt: { $ne: null, $lte: bufferBefore },   // §3.8
  },
  { $set: { settlementId: settlement._id } },
);

// 3. Ab SIRF kabze me aayi rows se hisaab
// 4. status → PENDING_APPROVAL
```

Ek transaction do settlement me nahi ja sakta, kyunki taala `settlementId: null` hai.

> **⚠️ `periodEnd` canonical hona chahiye — audit finding.** `jobs/index.js` har job ko **boot par ek baar** chalata hai (`await runJob(job)` `setInterval` se pehle), aur runner **per-process** hai. Do instance ya ek restart matlab `buildSettlements` dobara chalega. `idempotencyKey` tabhi bachata hai jab `periodEnd` **exactly wahi** value ho — isliye wo `new Date()` se kabhi derive na ho: `periodEnd = istDayEnd(today − delayDays)` (claim doc §5.5 ka `istDate.js`). Ek din ka ek hi canonical value, chahe job dus baar chale.

> **⚠️ Adjustments par bhi claim lock chahiye — audit finding.** `refundAdjustment` aur `chargebackAdjustment` pichhle cycles ke events se aate hain. Agar wo har baar "is brand ke un-adjusted refunds/chargebacks" se compute hue, to **wahi katauti har cycle me dobara lagegi** — vendor se ek hi chargeback ka paisa baar-baar kata jayega.
> Isliye `RefundRequest` aur dispute-adjustment dono par `settlementId` field ho, aur claim usi tarah atomically ho:
> ```js
> RefundRequest.updateMany(
>   { brandId, status: COMPLETED, settlementId: null, /* … */ },
>   { $set: { settlementId: settlement._id } },
> )
> ```
> Aur `reconcileLedger` ka 7th invariant: koi bhi `COMPLETED` adjustment jiska `settlementId` kisi terminal-failed settlement ko point kare, release hona chahiye.

### 3.4 States

```
DRAFT
  → PENDING_APPROVAL
      → APPROVED → PROCESSING → PAID
                              → FAILED    → (retry-in-place) APPROVED
                                          → (ABANDONED) → release
                              → REVERSED  → release
      → ON_HOLD    → PENDING_APPROVAL (rebuild ke baad)
      → CANCELLED  → release
```

> **State machine encode karo, imply mat karo.** `ALLOWED_SETTLEMENT_TRANSITIONS` map `constants/settlement.js` me (frozen), aur har status change ek hi `transitionSettlement(settlement, toStatus, ctx)` se: (a) illegal transition par 422, (b) us edge ka ledger side-effect, (c) us edge ka release, (d) history row. Yehi release ko afterthought banne se rokta hai.

Har transition ek **conditional update** hai — do admin ek saath approve dabaayein to payout ek hi baar nikalta hai.

### 3.5 ⚠️ Release — audit finding, CRITICAL

Design me claim lock ek hi taraf tha: `settlementId: null → S`. **Kuch bhi use wapas `null` nahi karta.** Har future cycle ka predicate `settlementId: null` maangta hai, to settlement ke happy path se hatte hi wo rows har cycle ke liye **invisible** ho jaati hain — koi error nahi, koi alert nahi, predicate bas match karna band kar deta hai.

Ek admin click me ₹92,400 permanently unpayable ho sakte hain, aur ledger bhi shant rahega kyunki uska hisaab *sahi* hai (koi PAYOUT entry likhi hi nahi gayi, VENDOR_PAYABLE abhi bhi baaki dikhata hai — jo sach hai).

**Fix:**

1. **Release hi ekmatra exit hai** non-PAID terminal state se. Ek helper — `helpers/settlements/settlementClaims.js` → `claimTransactions()` / `releaseSettlementClaims()` — bilkul `promoReservation.js` ke reserve/release/sweep par. `CANCELLED`, `REVERSED`, aur abandoned-`FAILED` ki **har** transition ise status write ke saath hi bulaye. Caller ke bharose mat chhodo

2. **Release ko double-payout se guard karo.** `PAID` + `utr` wali settlement seedha release nahi ho sakti — pehle `PAID → REVERSED`, aur us transition me `PAYOUT_REVERSAL` ledger entry (`reversalOf` original PAYOUT par). Order: **pehle ledger reverse, phir rows release.** `FAILED`/`CANCELLED` me paisa hila hi nahi, to spurious reversal mat likho — wo invariants tod dega

3. **`FAILED` ka default retry-in-place hai, rebuild nahi.** MANUAL_BANK ka bounce aam case hai; sahi operation hai `bankSnapshot` refresh + wahi settlement dobara (`FAILED → APPROVED → …`), `settlementNumber` aur statement bachate hue. `ABANDONED` reason hi release trigger kare

4. **`idempotencyKey` me attempt counter mat jodo.** `STL:<brandId>:<periodEnd>` waisa hi rahe. Attempt counter ek read-then-write race hai aur — kahin zyada bura — ek adhoore daily job ka plain retry **doosri settlement** bana dega. Release hone par rows agle cycle ke `STL:<brandId>:<nextPeriodEnd>` me apne aap aa jaati hain, kyunki eligibility me `periodStart` ka koi floor hai hi nahi. Agar same-period rebuild sach me chahiye to mari hui settlement ki key `STL:VOID:<settlementNumber>` kar do

5. **Stranding ko loud banao** — `reconcileLedger` ka 5th invariant (§2.4)

6. **Sweep ka naam aur dayra badhao** — `sweepDraftSettlements` → `sweepStaleSettlements`: DRAFT shells jo N minute purani hain (crash mid-build → release + cancel), **aur** koi bhi terminal-failed settlement jo abhi bhi rows pakde hai

### 3.6 ⚠️ Claim ke baad, payout se pehle — audit finding, CRITICAL

`settlementHold` sirf **pre-claim filter** hai. Ek baar `buildSettlements` ne `settlementId` stamp kar diya, uske baad `settlementHold: true` karne se us settlement par **kuch asar nahi** hota — eligibility predicate sirf claim ke waqt evaluate hoti hai, aur compute step "sirf jo kabze me aaya" padhta hai.

Claim (02:00 DRAFT) aur paisa hilne (admin approval + NEFT, 14:00) ke beech ghanton ka window hai — theek wahi window jisme `dispute.created` ya refund request girta hai.

**Aur ek deterministic bug:** `handleRazorpayWebhook.js:213` par `isDisputed: isOpen` likha jaata hai, aur `constants/webhook.js` ka `isOpen` `WON/LOST/CLOSED` ko exclude karta hai. Yaani **`payment.dispute.lost` `isDisputed: false` likhta hai** — jo chargeback hum haar chuke hain wo transaction fully eligible dikhne lagta hai aur agla `buildSettlements` vendor ko us paise ka payout kar deta hai jo Trydood ke paas hai hi nahi. Ye race nahi, ye pakka hai.

**Fix:**

1. **Ineligibility monotonic aur single-flagged.** `settlementHold` har risk event par set ho — refund request, `refund.processed`, aur **har** dispute event (`won`/`lost`/`closed` sameत). **Webhook ise kabhi clear nahi karega** — hold hataana explicit admin action hai. Eligibility `settlementHold: false` par key kare, `isDisputed: false` par **nahi**

2. **Webhook single-doc aur idempotent rahe.** Dispute/refund branch me existing `updateOne` ke baad: `settlementHold` set karo, aur agar doc me `settlementId` hai to ek flat idempotent write —
   ```js
   Settlement.updateOne(
     { _id: settlementId, status: { $in: [DRAFT, PENDING_APPROVAL, APPROVED] } },
     { $set: { needsRevalidation: true }, $addToSet: { taintedTransactionIds: _id } },
   )
   ```
   plus ek CRITICAL notice **jo settlementNumber bataye** (aaj ka `PAYMENT_DISPUTED` alert settlement ka naam nahi leta — isi liye approve karne wala admin miss kar deta hai). Yahan totals recompute **mat** karo

3. **Approval hi authority hai, aur conditional ho:**
   ```js
   Settlement.findOneAndUpdate(
     { _id, status: PENDING_APPROVAL, needsRevalidation: { $ne: true } },
     { $set: { status: APPROVED, approvedBy, approvedAt } },
   )
   ```
   `null` mile to claimed set dobara query karo aur 422 me offending transactions ka naam lo, settlement `ON_HOLD` par

4. **Rebuild karo, in-place mutate mat karo.** `ON_HOLD` par explicit admin action: tainted rows ko `settlementId: null` karo (clean rows kabze me hi rahen taaki agla build unhe double-claim na kare), bache hue rows se totals recompute, flags clear, `PENDING_APPROVAL` par wapas, history row. Poora operation `status: ON_HOLD` par guarded

5. Design ki line badlo: *"payout se pehle"* → **"settlement APPROVED hone se pehle"**. Approval hi wo aakhri point hai jahan exclusion muft hai

### 3.7 ⚠️ Negative netPayable, sub-minimum, aur baasi bankSnapshot

- `netPayable ≤ 0` legit hai (adjustments gross se zyada, ya quiet brand `minPayoutAmount` se neeche). Iska apna state chahiye — **`CARRIED_FORWARD`** — aur wo settlement `PAID` **nahi** hoti aur uski koi `PAYOUT` entry nahi banti. Warna ledger us amount ke liye PAYOUT likh dega jo kisi bank transfer ne uthaya hi nahi, aur `LEDGER_DRIFT` chillayega bina ye bataye kaunsi settlement se
- `bankSnapshot` DRAFT par freeze hota hai par MANUAL_BANK me paisa dino baad `APPROVED → PAID` par nikalta hai. `createBank.js:112-125` account number badalne par purana doc `isDeleted` karke `brand.BankId` repoint kar deta hai — to vendor ke mid-cycle change ke baad settlement ek **band account** ko point kar rahi hoti hai, aur snapshot hi use invisible banata hai. **Fix:** har payout leg apna `bankSnapshot` le jab wo leg initiate ho, aur `APPROVED → PROCESSING` par live bank se milaan ho; alag ho to `ON_HOLD` + admin ko batao
- Bank verified nahi / hai hi nahi → settlement `ON_HOLD`, vendor ko saaf batao ki kya karna hai

### 3.8 ⚠️ T+3 calendar days safe nahi hai — audit finding

Design ka apna tark tha: *"Razorpay ~T+2 hold karta hai, isliye payout T+3."* Wo premise apne hi terms par galat hai — **T+2 working days me ginta hai**, T+3 calendar days me. Dono sirf us hafte milte hain jisme weekend na aaye.

Bina holiday ke bhi, har hafte: Friday ka capture → Razorpay T+2 working = Tuesday. Hamara predicate Monday eligible kar deta hai. **Har Thursday aur Friday ke capture par ek din pehle payout.** Diwali jaise cluster me ye 2-3 din ho jaata hai, poore weekend ke GMV ke saath.

Aur bura variant: Razorpay account ko hold par daal de (KYC re-verification, risk review, volume spike — young platform ke liye routine) → settlements ruk jaate hain, aur hum T+3 timer par payout karte rehte hain **kyunki system ko pata hi nahi**.

**Fix — receipt ko observe karo, infer mat karo:**

1. `Transaction` par `razorpaySettlementId` (indexed, sparse) aur `fundsReceivedAt` (indexed)
2. `settlement.processed` ko `RAZORPAY_WEBHOOK_EVENTS` + `WEBHOOK_HANDLED_EVENTS` me. **`settlement.failed` mat jodo** — Razorpay wo event document nahi karta. `settlement.processed` sirf aggregate entity leke aata hai (id, amount, settled_at), payment list nahi — isliye use **trigger** maano, mapping ka source nahi
3. `reconcileSettlements` job (daily, per account) — `GET /v1/settlements/recon/combined?year=&month=&day=`, har Transaction par `razorpayPaymentId` se match karke `razorpaySettlementId` + `fundsReceivedAt = settled_at` stamp kare. Webhook job ko jaldi trigger karta hai; daily sweep asli backstop hai
4. **Predicate fail-closed, par escape hatch aur floor ke saath:**
   `fundsReceivedAt != null AND fundsReceivedAt <= now − payoutBufferHours` **AND** `verifiedAt <= now − settlementDelayHours` (ye independent floor rahega taaki refund golden rule bana rahe)
5. **Zaroori:** `fundsReceivedAt != null` ka hard gate matlab ek toota recon run **saare** payouts chup-chaap rok dega — jo account-on-hold jaisa hi dikhta hai. Isliye:
   - per-settlement **admin override** flag + reason, ledger me provenance ke saath, taaki jaldi payout auditable ho
   - `lastSuccessfulReconAt` per account — taaki *"recon toota hai"* aur *"Razorpay ne paisa roka hai"* **alag** alerts banein. Dono ka insaani jawab alag hai
6. **Bank holiday list mat banao.** Bharat ki holidays state-wise hain aur har saal badalti hain; hath se maintain ki gayi list sadegi. `fundsReceivedAt` observe hone ke baad working-day calculation apne aap redundant hai
7. **Alerts:** `fundsReceivedAt == null` wali captured rows ka `max(now − verifiedAt)` threshold (96h) paar kare → CRITICAL `SETTLEMENT_NOT_RECEIVED` (account + atka hua rupee amount). `now − lastSuccessfulReconAt > 26h` → alag WARNING

### 3.9 Statement PDF

Wahi frozen-snapshot pattern: settlement banate waqt `statementSnapshot` jam jaata hai, PDF **pehli download par**. Usme: period, transaction-wise list (claim code, voucher, outlet, date, bill, discount, net), gross, saare deductions alag rows me, net payable, bank ke aakhri 4 digit, **har leg ka UTR**, aur payout ki tareekh.

### 3.10 Timezone

Period boundary aur financial year **IST me** — `helpers/common/istDate.js` (sibling doc §5.5). Server UTC par chala to 00:00–05:30 IST ka paisa pichhle din aur galat FY series me chala jayega.

---

## 4. Payout — abhi MANUAL_BANK

```
Settlement PENDING_APPROVAL
  → admin APPROVE (conditional, needsRevalidation check)
  → PROCESSING + payout leg INITIATED (bankSnapshot us waqt ka)
  → admin apne bank se NEFT/IMPS
  → admin UTR panel me daale → leg PAID → PAYOUT ledger entry
  → saare legs PAID + jod === netPayable → settlement PAID
  → statement + vendor notify
```

**Provider adapter abhi se:** `helpers/payouts/<provider>.js` — `initiate(settlement, leg)`, `confirm(leg, ref)`, `reverse(leg)`. `MANUAL_BANK` me `initiate` sirf leg banata hai aur `confirm` admin ke UTR se chalta hai. RazorpayX/Route baad me isi interface par plug honge.

**Zaroori:** admin `PAID` mark kar de aur transfer sach me fail ho — UTR mandatory hai, aur `reconcilePayouts` (6h) bank/gateway se milata hai aur farq par alert deta hai.

---

## 5. Refund

> ### ✅ Ban gaya — Phase S1 (1 Sep 2026), `SOURCE` refunds ke liye
>
> **Jo bana hai wo kaise chalta hai → [`refund_flow.md`](./refund_flow.md).** Yeh
> section design ka *kyun* rakhta hai; wo document *kya hota hai* batata hai.
>
> `models/RefundRequest.js` · `constants/refund.js` · `helpers/refunds/*` ·
> `services/refunds/*` · 9 endpoints · 3 jobs · 3 webhook handlers.
> Tests: `refundRequest` · `refundSplit` · `refundAllowance` · `requestRefund` ·
> `decideRefund` · `executeRefund` · `refundCompletion` · `refundJobs` ·
> `refundListings` · `refundNotices`.
>
> **Plan se do jagah hataa gaya, dono jaan-boojhkar:**
>
> 1. **`PayoutLeg` nahi bana.** §3.2 me wo `MANUAL_BANK` aur settlement dono ke liye
>    socha gaya tha. `SOURCE` refund me leg jaisa kuch hai hi nahi — Razorpay ka
>    `refund.id` + `acquirer_data.arn` hi poora record hai, aur wo `RefundRequest` par
>    hi rakha gaya. `PayoutLeg` tab banega jab `MANUAL_BANK` ya settlement aayegi,
>    yaani jab uski zaroorat sach me hogi.
> 2. **`MANUAL_BANK` aur `CustomerBankAccount` nahi bane** (§6.5). Wo sirf
>    `refund.failed` par chahiye — 90%+ refunds `SOURCE` se nikal jaate hain — aur
>    unhe banane ka matlab `models/Bank.js` wali landmine ke paas jaana hai:
>    account-number uniqueness Mongo index nahi, teen jagah collection-wide query hai
>    (`createBank.js:62`, `verifyBankAndFetchDetails.js:24`, `verifyVendor.js:228`),
>    aur banks collection me ek customer row vendor ka KYC score gira sakti hai.
>    Tab tak failed refund admin worklist me `FAILED` par khula baithta hai, hold laga
>    rehta hai, aur admin ko CRITICAL notification jaati hai.
>
> **Jo audit findings §6.4 me the, teeno theek ho gaye:**
> `$set → $max` cumulative (`payment.amount_refunded` se) · `REFUND_STATUS.PARTIAL`
> juda · `Transaction.refundId` → `latestRefundRequestId` (wo `Refund` model ko ref
> karta tha jo kabhi bana hi nahi) · `refund.created` / `refund.failed` ko handler mile
> (pehle enum me the par kisi branch me nahi, to failed refund chup-chaap `IGNORED`
> hokar girta tha).
>
> **Do aur cheezein jo plan me nahi thi aur banate waqt zaroori nikli:**
> - `ledger_type_refund_unique` — `REFUND` rows kisi unique index se surakshit nahi thi.
>   `ONCE_PER_TRANSACTION` unhe cover kar hi nahi sakta: ek payment do baar refund ho
>   sakta hai aur dono ki rows ek hi `transactionId` par hain. Iske bina dobara bheja
>   gaya `refund.processed` vendor ko **do baar** claw back kar deta.
> - Abuse limits (`maxOpenRequests`, `maxRejectedPerWindow`, `requestWindowDays`) —
>   ginti **thukrai** requests ki, approve hui ki kabhi nahi.

### 5.1 States

```
REQUESTED
  → VENDOR_APPROVED → ADMIN executes → PROCESSING → COMPLETED     ← normal
                                                  → FAILED
  → VENDOR_REJECTED ┐
  → VENDOR_TIMEOUT  ┘→ ADMIN_OVERRIDE (rare, wajah zaroori)       ← exception
  → CANCELLED   // customer ne khud wapas le liya
```

**Normal path me vendor approve karta hai aur admin sirf execute karta hai** — admin doosra gate nahi hai. Override wala rasta alag se log hota hai aur admin report me alag dikhta hai; wo number badhe to kahin aur dikkat hai.

Vendor chup rah gaya → `refund.vendorApprovalHours` (default 24) ke baad apne aap admin ke paas, do reminder ke saath. Ek chup vendor customer ka paisa nahi rok sakta.

### 5.2 Golden rule — settings validator me enforce hoga

```
settlementDelayHours >= refundWindowHours + vendorApprovalHours + adminBufferHours
```

Default: 24 + 24 + 12 = **60h ≤ 72h** ✓ (T+3)

Jab tak ye sach hai, **koi refund kabhi aise paise ko nahi chhoo sakta jo vendor ko ja chuka ho.** Refund us cycle ke payable ko kam karta hai, bas. Na recovery, na negative balance, na vendor ko kuch samjhana.

Ye config me chhodi hui salah nahi — **settings save par 422**. Ek galat setting mahine baad jaakar hisaab bigaadti hai.

> Razorpay ka apna T+2 hold is rule ko apne aap satisfy karta hai — paisa Trydood ke bank me hi day 2 se pehle nahi aata, to T+3 hi ekmatra sambhav vikalp tha.

### 5.3 `settlementHold` — lagta bhi hai, hatta bhi hai

Refund `REQUESTED` hote hi `Transaction.settlementHold = true`. Wo us cycle me count hi nahi hoga, chahe T+N aa bhi gaya ho. **Yehi wo ek line hai jo "pehle pay kar diya, ab recover karo" wali poori samasya khatam karti hai.**

> **⚠️ Release path likhna zaroori hai — audit finding.** Hold **hatta bhi** hona chahiye, warna ek rejected/cancelled/timed-out refund vendor ka paisa **hamesha ke liye** har future settlement se bahar kar deta hai — chup-chaap, kyunki eligibility predicate bas match karna band kar deti hai.
>
> `releaseSettlementHold(transactionId, reason)` — ek helper, aur har terminal refund state se bulaya jaye:
>
> | Refund state | Hold |
> |---|---|
> | `VENDOR_REJECTED` (admin ne bhi mana kiya) | **hatta hai** |
> | `ADMIN_REJECTED` | **hatta hai** |
> | `CANCELLED` (customer ne wapas liya) | **hatta hai** |
> | `FAILED` | **laga rehta hai** — paisa abhi bhi wapas jaana hai |
> | `COMPLETED` | **laga rehta hai** — wo paisa ab vendor ka hai hi nahi |
>
> Dispute wala hold alag hai aur **webhook se kabhi nahi hattta** — use hataana explicit admin action hai (§3.6).
>
> Aur `reconcileLedger` ka 8th invariant: koi transaction `settlementHold: true` par N din se zyada na baithe bina kisi khuli refund request ya khule dispute ke → WARNING.

### 5.4 Refund ka payout record aur settlement se link

Aapki zaroorat: *"jis settlement se refund kiya uski ID link ho jaye, taaki pata chale iska refund is settlement se hua tha."* Do alag cheezein hain, dono ban rahi hain:

**(a) Refund ka apna payout record** — `PayoutLeg` with `payoutType: REFUND` (§3.2). Usme UTR, tareekh, mode, frozen `bankSnapshot`, aur kis admin ne kiya. Bilkul waise hi jaise vendor ke settlement ka record banta hai.

**(b) Kis vendor settlement ne is refund ki katauti uthayi** — `RefundRequest.settlementId`. Jab `buildSettlements` us refund ko `refundAdjustment` me claim karta hai (§3.3 ka adjustment lock), tabhi ye bhar jaata hai.

Isse teen sawaal ek-ek query me answer ho jaate hain:

| Sawaal | Kahan se |
|---|---|
| "Customer ko paisa kab aur kaise gaya?" | `PayoutLeg` → UTR + date + account last-4 |
| "Vendor se ye katauti kis settlement me lagi?" | `RefundRequest.settlementId` → Settlement + uska statement |
| "Is settlement me kaun-kaun se refunds kate?" | `RefundRequest.find({ settlementId })` |

Vendor ke statement me refund apni row me dikhega — claim code, date, amount — aur customer ke transaction view me refund ka UTR aur date. **Dono taraf poora record.**

### 5.5 Claim / transaction / history par kya update hoga

Refund `COMPLETED` hote hi, ek hi jagah se (`applyRefundCompletion()`):

| Kahan | Kya |
|---|---|
| `Transaction` | `amountRefunded` (§6.4 ka `$max`), `refundStatus` (`PARTIAL`/`COMPLETED`), `isRefunded`, `paidRefundAt`, `settlementHold` laga rehta hai |
| `VoucherClaim` | Full refund par `status: REFUNDED`, `refundedAt`, `refundAmount`, `refundReason`, `holdsUsageSlot: false`. Partial par status wahi |
| `VoucherClaimHistory` | `REFUNDED` row — `performedBy` (admin), `performedByRole: ADMIN`, snapshot me amount + UTR + `refundRequestId` |
| `VoucherUsage` | Full refund par `isReversed: true`, `reversedAt`, `reversalReason` — once-per-user slot chhoot jaata hai |
| `LedgerEntry` | `REFUND` entry, `PayoutLeg` se linked, narration me account last-4 + UTR |
| `PromoCodeUsage` | `releasePromoOnRefund: true` ho tabhi — default nahi |
| Notification | Customer ko refund confirmation (UTR ke saath), vendor ko "ye claim reverse hua" |

---

## 6. Refund destination — `SOURCE` default, `MANUAL_BANK` fallback

### 6.1 Flow

**Approval flow bilkul wahi hai** — customer raise → vendor approve → admin approve. Sirf **aakhri step** badalta hai:

```
Customer refund raise kare (window ke andar)
  → request vendor AUR admin dono ko dikhti hai
  → vendor approve kare
  → admin approve kare
  → SOURCE:       payments.refund() — paisa usi card/UPI me wapas       ← 90%+ cases
  → MANUAL_BANK:  refund.failed aane par hi — tab customer se bank
                  account maangte hain, penny-drop verify, admin NEFT    ← baaki
  → PayoutLeg PAID → RefundRequest COMPLETED
  → claim / transaction / history sab me refunded update — §5.5
  → us refund ki katauti jis settlement me lagi, uski ID link — §5.4(b)
```

**Admin ka kaam kam ho jaata hai**, zyada nahi: net banking kholne, NEFT karne aur UTR copy karne ki jagah panel me ek button. Vendor ka approval gate waisa ka waisa.

### 6.2 Kyun `SOURCE` default hai

Refund ke **do** kaam hote hain. Manual NEFT sirf **pehla** karta hai:

| | Kaam | Manual NEFT | `payments.refund()` |
|---|---|---|---|
| 1 | Customer ko paisa wapas dena | ✅ | ✅ |
| 2 | **Payment network ko batana ki refund hua** | ❌ | ✅ |

Doosra chhootne par: 70 din baad chargeback aata hai, Razorpay turant amount debit karta hai, aur hum evidence me ek NEFT UTR dete hain **jise issuing bank apne card se jod hi nahi sakta**. Credit-not-processed reason code par network sirf original authorization par `amount_refunded` maanta hai. Dispute haare — **paisa do baar bahar, recovery zero** (`settlementHold` ki wajah se vendor ko wo paisa mila hi nahi tha, to usse maangna bhi galat hoga).

Teen aur faayde: koi bank detail nahi maangni, koi manual transfer nahi, aur ledger CUSTOMER account ke settlement se apne aap net ho jaata hai.

> **Ek fraud vector bhi band hota hai:** manual refund us account me jaata hai jo customer *batata* hai — payment ke source me nahi. Agar payment kisi aur ke card se hua tha, to refund galat aadmi ko ja sakta hai. `SOURCE` me ye sawaal uthta hi nahi.

Ek manual NEFT ke baad Razorpay ke record me wo payment hamesha **"captured, not refunded"** hi rehta hai. `Transaction.amountRefunded` 0, `refundStatus` null, `isRefunded` false — kyunki inka ekmatra writer `refund.processed` webhook hai (`handleRazorpayWebhook.js:175-196`), jo out-of-band NEFT par kabhi fire hi nahi hota.

**Nateeja — do baar paisa:**

| Kab | Kya | Balance |
|---|---|---:|
| T0 | Customer ₹2,000 card se pay karta hai (pay_ABC) | +2,000 |
| T+62h | Admin ₹2,000 NEFT karta hai, UTR record. `settlementHold` se vendor ka ₹1,700 ruka rehta hai | −2,000 |
| T+70 din | Customer card par chargeback file karta hai. Razorpay ₹2,000 debit karta hai | −2,000 |
| | **Net** | **−2,000, permanent** |

Design ke paanch chargeback defence me se **do is path me structurally void hain**: evidence pack ke paas card network ke maanne layak kuch hai hi nahi (ek NEFT UTR jise issuer apne card se jod nahi sakta), aur "next-cycle recovery" chal hi nahi sakti kyunki `settlementHold` ki wajah se vendor ko wo paisa mila hi nahi tha — usse wapas maangna use us paise ke liye charge karna hoga jo usne kabhi paya nahi.

Razorpay ka apna `payments.refund()`:
- Original instrument par wapas bhejta hai — UPI/card/netbanking/wallet sabke liye ek jaisa
- Koi bank detail nahi maangta, koi manual kaam nahi
- **Credit-not-processed / duplicate-processing reason codes par yahi ekmatra sabooot hai jo network maanta hai** — aur Razorpay use apne aap attach karta hai
- CUSTOMER account ke settlement se apne aap net ho jaata hai
- SDK instance `configs/razorpay.js` me **pehle se maujood** hai — integration cost zero

### 6.3 Design

```js
// RefundRequest
method: { type: String, enum: ["SOURCE", "MANUAL_BANK"], default: "SOURCE" },
razorpayRefundId: { type: String },      // SOURCE par — partial $type:string unique
refundSpeed,                              // "normal" | "optimum"
bankSnapshot,                             // sirf MANUAL_BANK par, frozen — §6.5
componentSplit: { netBillPortion, convenienceFeePortion, promoPortion },
settlementId,                             // kis settlement ne katauti uthayi — §5.4(b)
fallbackReason,                            // MANUAL_BANK par kyun gira
attemptCount, lastError: { code, description },
```

**`SOURCE` ke chaar rules:**

1. **Adapter se chalao, inline nahi** —
   `getRazorpayAccount(transaction.gatewayAccount).instance.payments.refund(paymentId, { amount, speed, notes })`
   Aur **Razorpay ka refund idempotency header `refundRequestId` ke saath** — admin ka dobara click ya job ka re-run doosra refund na bana de. Duplicate refund us nuksaan se bura hai jo ye rok raha hai
2. **API 200 par `COMPLETED` mat karo.** `payments.refund` zyadatar methods par `status: "pending"` deta hai. API call par `PROCESSING` + `razorpayRefundId` store; `REFUND` ledger row aur `COMPLETED` **sirf `refund.processed` webhook se**. Wahi niyam jo money-in par hai
3. **`refund.failed` par apne aap fallback** — `method: MANUAL_BANK`, `fallbackReason` record, wapas `ADMIN_APPROVED`, HIGH alert, aur **tab** customer se bank account maango. Band card ya dead VPA par yahi ekmatra rasta bachta hai
4. `REFUND_CREATED` / `REFUND_PROCESSED` / `REFUND_FAILED` teeno `WEBHOOK_HANDLED_EVENTS` me — **dashboard se kiya gaya koi bhi refund** bhi inhi se pakda jayega

**`MANUAL_BANK` fallback ke paanch rules (jab wo raasta lena pade):**

1. **Razorpay par nishaan chhodo** — `payments.edit(paymentId, { notes: { refunded_offline: true, refund_utr, refund_date, refund_request_id } })`. Koi paisa nahi hilta, sirf record. Dispute ke waqt yehi ekmatra cheez hai jo Razorpay ke apne record me dikhegi
2. **Evidence pack me refund proof pehle** — `PayoutLeg` ka UTR, date, account last-4, vendor ka approval, poori timeline
3. **Dispute par HIGH-LOSS-RISK flag** — `PAYMENT_DISPUTED` alert saaf batae ki refund `MANUAL_BANK` se hua tha, isliye pack kamzor hai. Admin ko deadline par nahi, **pehle** pata chale
4. **`settlementHold` kabhi na hate** refunded transaction par — §5.3
5. **`amountRefunded` khud likho** — `refund.processed` yahan nahi aayega, isliye `applyRefundCompletion()` (§5.5) manually set karega. Warna settlement eligibility ko lagega refund hua hi nahi

**Dono methods par common:** wahi state machine, wahi `REFUND` ledger row, wahi `settlementHold`, wahi `PayoutLeg`, wahi vendor history — sirf executor alag. Executor amount recompute kare aur captured-minus-prior-refunds se zyada par refuse kare.

> **`CustomerBankAccount` (§6.5) phir bhi banega** — `MANUAL_BANK` fallback ke liye zaroori hai. Bas wo ab pehle refund par nahi, sirf fallback par maanga jayega — isse default path se un-KYC'd beneficiary payout ki position aur ek chunk PII dono hat jaate hain.

### 6.4 ⚠️ Partial refunds — audit finding

`handleRazorpayWebhook.js:178-188` `$set: { amountRefunded: refunded }` karta hai — **`$inc` nahi** — aur `refunded` us *ek* refund entity ka amount hai. Do partial refund me doosra pehle ko overwrite kar deta hai. `fullyRefunded` test bhi latest slice par chalta hai.

`Transaction.refundId` ek ObjectId hai (aur `refField("Refund")` — aisa model hai hi nahi), to doosri RefundRequest pehli ko orphan kar deti hai.

**Fix:**

1. **Cumulative total payment entity se lo, slice se nahi.** `refund.*` webhooks ke saath Razorpay payment entity bhi bhejta hai aur `extract()` use `ids.payment` me parse karta hi hai:
   `amountRefunded = max(existing, (ids.payment.amount_refunded ?? 0) / 100)` — monotonic non-decreasing (`$max`). Redelivery aur admin replay dono par idempotent, koi dedupe table nahi. `settleSubscriptionPayment.js:34` pehle se `payment.amount_refunded` use karta hai, to dono writer ab ek hi baat kahenge. `ids.payment` na ho to hi `$inc` + persisted unique `razorpayRefundId` par giro
2. `isRefunded` aur `refundStatus` cumulative se compute karo. `REFUND_STATUS` me **`PARTIAL` add karo** — abhi sirf PENDING/COMPLETED/FAILED/null hai, isliye partial refund `COMPLETED` likha jaata hai aur invisible ho jaata hai
3. **`settlementHold = true` har refund landing par**, sirf customer-filed RefundRequest par nahi. Isse dashboard-refund aur auto-refund wale raste bhi cover hote hain
4. **Settlement eligibility amount par test kare, boolean par nahi** — `amountRefunded > 0` wali rows exclude, aur `refundAdjustment` claimed transactions ki `COMPLETED` RefundRequest rows ke jod se. `Transaction.amountRefunded` cache/cross-check rahe, aur `reconcileLedger` ka 6th invariant use verify kare
5. `Transaction.refundId` **drop** karo (dangling ref). Convenience pointer chahiye to `latestRefundRequestId` — naam se hi saaf ki wo poori tasveer nahi
6. **Split rule likho aur ek helper me enforce karo:** pehle `netBill` refund ho (vendor claw-back, DEBIT VENDOR_PAYABLE), convenience fee sirf full refund par (DEBIT PLATFORM_REVENUE), aur promo cost `promoCostBearing` snapshot se pro-rata reverse ho. Split `RefundRequest` par admin-visible field ho, taaki override ek darj kiya hua faisla ho, code ke order ka haadsa nahi

### 6.5 ⚠️ `CustomerBankAccount` — alag model, aur payee freeze

**`models/Bank.js` reuse mat karo.** Wo bank-account model hai hi nahi — wo ek CGPEY penny-drop **verification record** hai. `brandId`, `maskedAccountNumber`, `isValid`, `recommendedAction`, `verificationResponse`, `providerTransactionId`, `providerRequestId`, `isVerified` — sab `required: true`, aur sirf ek paid CGPEY call se bharte hain.

Isse bhi bura: account-number uniqueness Mongo index nahi hai, wo ek **application-level collection-wide query** hai **teen** jagah — `createBank.js:62-69`, `verifyBankAndFetchDetails.js:24-31`, aur `systemVerify/verifyVendor.js:228-233`. Banks collection me koi customer row = vendor onboarding ke liye landmine, aur teesri jagah patch na ho to vendor ka KYC score 20 se gir kar `REJECTED` ho sakta hai *"Duplicate merchant details detected"* ke saath.

```js
// models/CustomerBankAccount.js — alag collection
{
  customerId,            // required, index
  accountHolderName, accountNumber, maskedAccountNumber, accountLast4Digits,
  ifscCode, bankName, branchName, isPrimary,
  verification: { ...CGPEY fields — sab OPTIONAL },
  isDeleted,
}
// { customerId: 1, isDeleted: 1 }
// koi cross-collection accountNumber uniqueness NAHI — do customer ek joint account share kar sakte hain
```

Verification ke liye alag service. ⚠️ **Bani `services/customerBankAccounts/addBankAccount.js` me**, alag `cgpeyAPIs` file ke bajaye — wahi `verifyBankAndFetchDetails` reuse karta hai. Apna cache (`{customerId, accountNumber}`), aur **koi cross-brand duplicate check nahi**. `verifyBankAndFetchDetails` aur `createBank` ko haath mat lagao, wo onboarding ke liye load-bearing hain.

Account attach hone se pehle `verificationStatus: SUCCESS` + `recommendedAction: PROCEED` zaroori. `isNameMatch` / `matchingScore` snapshot me jaayein taaki admin ko approval screen par name-match verdict dikhe.

**Payee freeze — audit finding, HIGH:**

Settlement ka `bankSnapshot` freeze hota hai, par refund ka nahi tha. Account editable hai, to admin worklist live join render karega. NEFT/IMPS ka **koi recall nahi**.

1. `RefundRequest.bankSnapshot` **attach hote hi** freeze — `{ accountHolderName, maskedAccountNumber, accountLast4Digits, ifscCode, bankName, verificationProvider, isNameMatch, matchingScore, verifiedAt, sourceBankAccountId }`. Admin worklist, approval screen aur executor **sirf yahi** padhein — customer ke live account par kabhi `populate`/`$lookup` nahi. Bilkul jaisa invoice generator karta hai: koi lookup nahi
2. Customer bank record **append-only** ho — `createBank.js:110-127` ka hi pattern (number badla to purana soft-delete + naya row). Phir destructive edit hai hi nahi. **Edit-block 422 mat lagao** — wo us case ko strand kar dega jo sabse zaroori hai: galat IFSC se `FAILED` hua refund jise customer ab theek karna chahta hai. In-flight refund ka payee badalna ek **explicit state transition** ho (re-attach → re-snapshot → wapas `ADMIN_APPROVED`), profile edit ka side effect nahi
3. `COMPLETED` par **jo sach me paid hua wo record karo** — `paidToSnapshot`, `payoutUtr`, `payoutMode`, `payoutProvider`, `paidAt`, `paidBy`. `accountLast4Digits` + UTR `REFUND` ledger narration me bhi, taaki akela ledger *"paisa kahan gaya"* ka jawab de. **Ye chargeback evidence pack ko chahiye aur iske bina har refund par data loss hai — attacker ki zarurat hi nahi**
4. Payout account attach/replace par **OTP** (`models/OTP.js` me `purpose` field aur `{target, purpose}` unique index pehle se hai — `purpose: "bank_change"`). Har profile field par nahi. Note: `updateUserById.js` abhi JWT ke alawa kuch nahi maangta, to ye naya behaviour hai
5. Executor amount bhi recompute kare — captured minus prior refunds se zyada ho to refuse

---

## 7. Chargebacks

### 7.1 Kya hai

Refund me customer **aapse** maangta hai. Chargeback me wo **apne bank se** maangta hai — aap beech me hote hi nahi. Bank paisa Razorpay se kheenchta hai, Razorpay aapse. Aapko notice milta hai aur kuch din sabooot dene ko.

### 7.2 Aata kyun hai

| Wajah | Kitna mumkin |
|---|---|
| **Refund maanga, mila nahi** | **Sabse zyada** — aur yehi poori tarah aapke haath me hai |
| **Service nahi mili** — pay kiya, outlet ne voucher maana nahi | Zyada, khaas kar Phase 1 me |
| "Maine kiya hi nahi" — ghar ka koi aur, card chori | Kam — UPI par bahut kam |
| Duplicate charge | Bahut kam — double-capture guard + idempotency |
| Friendly fraud — voucher use kiya phir dispute | Kam. Phase 2 ka redemption record iska pakka jawab |

> Sabse badi wajah "refund nahi mila" hai — **chargeback zyadatar aapke refund process ki nakami ka nateeja hota hai.** Tez refund hi sabse sasta bachaav hai.

### 7.3 Kab tak, aur paisa kab kata

- **Card** — aam taur par **120 din** tak
- **UPI** — window chhoti aur dispute bahut kam. Bharat me zyadatar payments UPI hain, isliye asli exposure card volume jitna
- **Jawab dene ka waqt** — notice ke baad 7–10 din. `disputeRespondBy` field pehle se hai. **Ye tareekh nikal gayi to dispute apne aap haar jaate hain**
- **Paisa dispute khulte hi** rok/kaat liya jaata hai. Jeete to wapas; haare to gaya + Razorpay ki chargeback fee

**Paimana:** ₹1000 bill par kamai ₹10. Ek ₹800 ka chargeback ≈ **80 transactions ki kamai**.

### 7.4 Har mumkin case

| Kab aaya | Paisa kahan | Kya hoga |
|---|---|---|
| **Payout se pehle** | Trydood ke paas | `settlementHold` → vendor tak jaata hi nahi. **Koi risk nahi** |
| Payout ke baad, vendor chaalu | Vendor ke paas | `CHARGEBACK` ledger entry → agle settlement me adjustment, statement me alag row |
| Payout ke baad, vendor ka volume nahi | Vendor ke paas | Receivable khada rehta hai. Naya volume aane par apne aap katega. **Yehi asli exposure hai** |
| Dispute jeet gaye | Wapas | `CHARGEBACK_REVERSAL` — vendor ko agle cycle me |
| **Us transaction ka refund pehle ho chuka** | Do baar bahar jaane ka khatra | Adjustment se **pehle** check; refund proof hi jawab hai |
| Ek vendor par bahut chargebacks | — | Reserve on + admin alert |
| `dispute.lost` aaya | — | ⚠️ `isDisputed: false` likhta hai — §3.6 ka deterministic bug |

### 7.5 Strategy — reserve nahi, parat-dar-parat

Sabko rolling reserve me daalna **galat jawab** hai — har vendor ka har settlement kam ho jayega taaki kuch % vendors ke chargebacks cover ho sakein. Wo saaf dikhta hai aur chubhta hai.

1. **Waqt (sabse bada)** — settlement delay refund window se bada, aur `fundsReceivedAt` gate. 80% kaam yehi
2. **Tez refund** — customer ko bank jaane ki naubat na aaye
3. **Sabooot apne aap** — dispute aate hi evidence pack: transaction, claim, offer, outlet, timestamps, invoice, `RefundRequest.razorpayRefundId`, aur (Phase 2) redemption record. `MANUAL_BANK` refund wali rows par dispute ko **HIGH-LOSS-RISK** flag karo, taaki insaan ko pehle pata chale ki pack kamzor hai — `disputeRespondBy` ki deadline par nahi
4. **Agle settlement se recovery** — payout ke baad wala default
5. **Reserve sirf risk par** — naye vendor ke pehle N din, ya jiska chargeback rate threshold se upar. Baaki sabko poora paisa, poore samay par

Saaf vendor ko kabhi pata bhi nahi chalega ki reserve naam ki koi cheez hai.

---

## 8. Kise kya dikhega

### Vendor

| Screen | Kya |
|---|---|
| **Earnings — aaj** | Aaj kitne claims, kitna collect hua, kitna banta hai. Live |
| **Din-war breakdown** | Har din: claims, gross, promo share, net |
| **Agli payment** | Kitna, kis din, kis bank me (aakhri 4 digit) |
| **Settlement history** | Number, period, gross, deductions, net, **har leg ka UTR**, tareekh, statement PDF |
| **Abhi rukka hua** | Khule refund/dispute ki wajah se hold rows — **kyun** ke saath |
| **Refund requests** | Jinpar approve chahiye, deadline ke saath |

### Admin

- **Settlement worklist** — approval pending, PROCESSING me atki, FAILED, `needsRevalidation`
- **Payment health** — captured par settle nahi · failed/REJECTED webhooks · khule disputes deadline se · ledger drift · `SETTLEMENT_NOT_RECEIVED` · recon health
- **Dispute worklist** — `respond_by` se, evidence pack ready, **kaunsa Razorpay account**, aur evidence-poor flag
- **Refund queue** — vendor approved / timeout / rejected
- **Vendor receivables** — chargeback se jinpar udhaar khada hai

### Customer

Apni transaction history, status, invoice download, refund request ka live status — vendor ke paas atka hai ya admin ke, dono me saaf farq.

---

## 9. Edge cases

### Settlement

| # | Case | Behaviour |
|---:|---|---|
| 1 | Job do baar chala | `idempotencyKey` unique — doosra wahi settlement paata hai |
| 2 | Ek transaction do settlement me | Namumkin — `settlementId: null` hi taala |
| 3 | Kabze aur hisaab ke beech refund | Kabza pehle — ya andar ya bahar, beech me nahi |
| 4 | Job DRAFT chhodkar mara | `sweepStaleSettlements` release karta hai |
| 5 | **CANCELLED / REVERSED / abandoned-FAILED** | **`releaseSettlementClaims()` — §3.5. Iske bina rows hamesha ke liye invisible** |
| 6 | **Claim ke baad dispute/refund** | **`needsRevalidation` + conditional approve — §3.6** |
| 7 | **`dispute.lost` → `isDisputed: false`** | Eligibility `settlementHold` par key kare, `isDisputed` par **nahi** |
| 8 | Bank verified nahi | `ON_HOLD` + vendor ko batao |
| 9 | Vendor ne bank badla mid-cycle | Leg par apna snapshot + `APPROVED → PROCESSING` par live milaan — §3.7 |
| 10 | **`netPayable ≤ 0`** | **`CARRIED_FORWARD` state — PAID nahi, koi PAYOUT entry nahi** |
| 11 | `netPayable < minPayoutAmount` | Wahi `CARRIED_FORWARD` |
| 12 | Do admin ek saath approve | Conditional transition — ek jeetega |
| 13 | Admin ne PAID mark kiya par transfer fail | UTR mandatory + `reconcilePayouts` milata hai |
| 14 | **Payout do NEFT me toota** | **`PayoutLeg` — §3.2. Ek `payoutUtr` field kaafi nahi** |
| 15 | Payout fail (galat IFSC) | Leg `FAILED` → retry-in-place, `settlementNumber` bachta hai |
| 16 | Payout ke baad bank ne wapas kiya | Leg `REVERSED` + `PAYOUT_REVERSAL` entry |
| 17 | **Razorpay ne abhi settle hi nahi kiya** | **`fundsReceivedAt` gate — §3.8. Warna har Fri capture par ek din pehle payout** |
| 18 | **Razorpay account hold par** | `SETTLEMENT_NOT_RECEIVED` CRITICAL |
| 19 | Recon job toot gaya | Alag WARNING — "recon toota" aur "paisa roka" alag alerts |
| 20 | Cycle me ek bhi eligible transaction nahi | Settlement banti hi nahi |
| 21 | Vendor deactivate, paisa baaki | `ON_HOLD`, admin manually chhodega |
| 22 | **Do instance / restart par job dobara chala** | **Canonical `periodEnd` (§3.3) + `idempotencyKey` — warna har restart nayi settlement mint karta** |
| 23 | **Wahi chargeback agle cycle me dobara kata** | **Adjustment claim lock — §3.3. Iske bina har cycle me dobara lagta** |
| 24 | **Sweep ne chalti hui build ke rows chhod diye** | Sweep par age + status guard — DRAFT N minute purani ho tabhi |
| 25 | **MDR ke baad bank me kam paisa aaya** | `GATEWAY_FEE` ledger + `netReceived` — §2.5. Warna platform chup-chaap kha raha tha |
| 26 | Vendor delete karna chahe, paisa baaki | Pre-check block — §12.7 |

### Refund

| # | Case | Behaviour |
|---:|---|---|
| 22 | Window ke baahar | 422 + window batao. Admin override kar sakta hai |
| 23 | Vendor chup | `vendorApprovalHours` ke baad admin ke paas + 2 reminder |
| 24 | Vendor ne reject kiya | Admin ko wajah ke saath dikhta hai, faisla uska |
| 25 | Refund pending + T+N aa gaya | `settlementHold` se settlement me jaata hi nahi |
| 26 | Refund reject hua | Hold hatta, agle cycle me |
| 27 | Gateway par fail | `FAILED` + alert + `MANUAL_BANK` escalation. Hold laga rehta hai |
| 28 | Ek claim par do request | Ek waqt me ek khuli — partial index |
| 29 | **Do partial refund** | **`$max` cumulative — §6.4. `$set` se doosra pehle ko overwrite kar deta** |
| 30 | Partial refund | Payable utna ghatta; usage reverse nahi, slot held |
| 31 | **API 200 par COMPLETED** | **Nahi — `refund.processed` webhook par. `payments.refund` `pending` deta hai** |
| 32 | **Customer ne account badal diya beech me** | **`bankSnapshot` frozen — §6.5. Live join kabhi nahi** |
| 33 | Settle ho chuke transaction par refund | Admin override par hi; receivable banta hai |
| 34 | Config delay < windows | Settings save par 422 |
| 35 | Dashboard se refund (koi RefundRequest nahi) | `settlementHold` phir bhi set — §6.4(3). `REFUND_CREATED` handled event isi liye |
| 36 | **Refund reject / cancel hua, hold laga rah gaya** | **`releaseSettlementHold()` — §5.3. Warna vendor ka paisa hamesha ke liye rukta** |
| 37 | **`MANUAL_BANK` par `amountRefunded` kisne likha** | `applyRefundCompletion()` manually — `refund.processed` webhook yahan aata hi nahi (§6.3 mitigation 5) |
| 38 | Refund ka NEFT do transfer me toota | `PayoutLeg` — do legs, do UTR |
| 39 | "Ye refund kis settlement se kata?" | `RefundRequest.settlementId` — §5.4(b) |
| 40 | "Customer ko paisa kab gaya?" | `PayoutLeg` — UTR + date + account last-4 |

### Chargeback

| # | Case | Behaviour |
|---:|---|---|
| 36 | Payout se pehle | `settlementHold` — koi risk nahi |
| 37 | Payout ke baad | `CHARGEBACK` entry → agle settlement me adjustment |
| 38 | Jeet gaye | `CHARGEBACK_REVERSAL` |
| 39 | **Refund pehle ho chuka** | Adjustment se pehle check; **bina check ke ek paisa do baar jayega** |
| 40 | Vendor ka volume nahi | Receivable, admin report me. 90 din baad write-off |
| 41 | `respond_by` nikal gaya | Apne aap haar. Deadline worklist + roz reminder |
| 42 | Threshold paar | Us vendor par reserve on + alert |
| 43 | `MANUAL_BANK` refund par dispute | HIGH-LOSS-RISK flag — pack kamzor hai |

### Ledger

| # | Case | Behaviour |
|---:|---|---|
| 44 | Settle hua par entry nahi bani | Invariant job roz pakadta hai + CRITICAL |
| 45 | Entry do baar | `{ entryType, transactionId }` unique jahan ek hi ho sakti hai |
| 46 | Purani entry galat nikli | Ulti entry, update nahi |
| 47 | Ledger aur transactions me farq | Ledger jeetega, alert jaata hai |
| 48 | **DRAFT par ledger entry** | **Likhi hi nahi jaati — §2.3** |
| 49 | Manual adjustment | Sirf admin, wajah zaroori, hamesha darj |

---

## 10. Jobs & config

| Job | Kab | Kaam |
|---|---|---|
| `buildSettlements` | roz | Har eligible brand ka cycle — kabza, hisaab, `PENDING_APPROVAL` |
| `reconcileLedger` | roz | 6 invariants (§2.4). Farq par CRITICAL |
| `reconcileSettlements` | roz | Razorpay recon API se `fundsReceivedAt` stamp — §3.8 |
| `reconcilePayouts` | 6 ghante | PROCESSING legs ko gateway/bank se milao |
| `releaseReserves` | roz | Miyaad poori huyi reserves |
| `escalateRefunds` | ghante me | Vendor SLA khatam → admin + reminders |
| `disputeDeadlines` | roz | `respond_by` paas hai — roz reminder |
| `sweepStaleSettlements` | ghante me | Atki DRAFT + terminal-failed jo rows pakde hain. **Age + status guard** — chalti hui build ke neeche se rows na kheenche |

Claim doc ke jobs (Phase 1B) jo money-out ko bhi cover karte hain:

| Job | Kab | Kaam |
|---|---|---|
| `reconcilePayments` | ghante me | Captured par settle nahi hui payments — teesra safety net |
| `resumeIncompleteSettlements` | 15 min | `settlementStage != COMPLETE` — claim ke baad crash se recovery |
| `alertStuckAuthorizations` | ghante me | Authorized par atki payments — auto-capture band hone ka signal |

### `Setting.customer.settlement` / `.refund`

| Path | Default | Kya |
|---|---|---|
| `settlement.isEnabled` | `true` | Master switch |
| `settlement.delayDays` | `3` | T+N. **Windows ke jod se kam nahi ho sakta** |
| `settlement.payoutBufferHours` | `6` | `fundsReceivedAt` ke baad ka buffer |
| `settlement.cycleType` | `DAILY` | DAILY \| WEEKLY |
| `settlement.requiresAdminApproval` | `true` | false par auto-approve |
| `settlement.minPayoutAmount` | `100` | Isse kam → `CARRIED_FORWARD` |
| `settlement.payoutProvider` | `MANUAL_BANK` | Route milte hi badlega |
| `settlement.commissionPercent` | **`0`** | Structure ready, abhi band |
| `settlement.reserve.isEnabled` | `false` | Sabke liye band |
| `settlement.reserve.percent / holdDays` | `5 / 30` | Sirf risky vendor |
| `settlement.reserve.riskChargebackCount` | `2` | Itne chargeback → reserve on |
| `settlement.newVendorReserveDays` | `0` | Naye vendor ke shuruati din |
| `settlement.notReceivedAlertHours` | `96` | `SETTLEMENT_NOT_RECEIVED` threshold |
| `settlement.gatewayFeeBearer` | **`PLATFORM`** | MDR kaun uthaye — §2.5 |
| `refund.method` | **`SOURCE`** | §6 — `MANUAL_BANK` fallback |
| `refund.windowHours` | `24` | Customer kitni der tak |
| `refund.vendorApprovalHours` | `24` | Uske baad admin |
| `refund.adminBufferHours` | `12` | Admin ka waqt |
| `refund.onVendorTimeout` | `ESCALATE` | ESCALATE \| AUTO_APPROVE |
| `refund.allowPartial` | `true` | Partial refund |
| `refund.releasePromoOnRefund` | **`false`** | Promo wapas nahi |
| `chargeback.writeOffDays` | `90` | Uske baad admin write-off |
| `refund.authorizedAlertMinutes` | `30` | Authorized par atki payment ka alert |

> **⚠️ Golden rule validator merged settings par chalega — audit finding.** `updateSetting` **partial payload merge** karta hai, aur usme abhi `customer` branch hai hi nahi. Agar validator sirf incoming payload dekhega to `{ refund: { windowHours: 48 } }` bhej dene par wo `settlementDelayHours` dekh hi nahi payega aur rule chup-chaap toot jayega.
>
> Isliye: validation **service layer me**, merge ke **baad**, save se **pehle** — `assertSettlementTimingRule(mergedCustomerConfig)`. Joi validator sirf shape dekhega; ye rule uska kaam hai hi nahi.

---

## 11. Phases

### Phase S0 — Ledger
*Claim-side Phase 1B ke **saath** jaana chahiye — warna baad me purani transactions se ledger bharna padega*

- `LedgerEntry` model + `constants/ledger.js`
- `recordLedgerEntry()` — settle / refund / dispute ke andar se
- `getVendorBalance(brandId)` — ek scan
- `reconcileLedger` job + `LEDGER_DRIFT` notification

### Phase S1 — Refund (`SOURCE` + fallback)
- `RefundRequest` model + states + `Transaction.settlementHold` + **`releaseSettlementHold()` har terminal state se** (§5.3)
- **`SOURCE` refund adapter** — idempotency header, `PROCESSING → COMPLETED` sirf `refund.processed` webhook se (§6.3)
- **`refund.failed` par apne aap `MANUAL_BANK` fallback** + `CustomerBankAccount` model + `verifyCustomerBankAccount` (penny-drop, CGPEY reuse)
- `PayoutLeg` model (§3.2) — `payoutType: REFUND` ke saath
- **`applyRefundCompletion()`** — claim + transaction + history + usage + ledger, ek jagah se (§5.5)
- **§6.3 ke fallback rules** — Razorpay notes stamp, evidence pack, HIGH-LOSS-RISK flag, hold, manual `amountRefunded`
- `REFUND_CREATED` / `REFUND_PROCESSED` / `REFUND_FAILED` handled events
- **§6.4 ka `$max` cumulative fix** + `REFUND_STATUS.PARTIAL` + split helper
- **§6.5 ka frozen `bankSnapshot`** + `paidToSnapshot` + OTP on bank change
- **`assertSettlementTimingRule()` merged config par** — §10
- `escalateRefunds` job + teeno taraf notifications

### Phase S2 — Settlement + manual payout
- `Settlement` model, `constants/settlement.js` + transition map (`PayoutLeg` S1 me ban chuka)
- `claimTransactions()` / `releaseSettlementClaims()` — §3.5 — **aur adjustment claim lock** (§3.3)
- `transitionSettlement()` — har edge par ledger + release + history
- `buildSettlements` job — **canonical `periodEnd`** (§3.3) · conditional approve (§3.6) · leg-wise UTR · statement PDF (lazy)
- **`razorpaySettlementId` + `fundsReceivedAt` + `reconcileSettlements`** — §3.8
- **`gatewayFeeBearer` + `GATEWAY_FEE` ledger + statement row** — §2.5
- `CARRIED_FORWARD` state (§3.7) + leg-wise `bankSnapshot` re-check
- `payoutProvider` adapter — `MANUAL_BANK` pehla
- **`BrandSettlementConfig` + `getBrandSettlementConfig()`** (§12.8) — sparse, har brand ki row nahi
- Vendor screens — aaj, din-war, agli payment, history
- `reconcilePayouts` + **`sweepStaleSettlements`** (age + status guard, taaki chalti hui build ke neeche se rows na kheenche)

### Phase S3 — Chargeback
- Dispute → `settlementHold` (har event par, `lost` sameत) ya adjustment
- Evidence pack builder + `razorpayRefundId` citation + HIGH-LOSS-RISK flag
- Deadline worklist + roz reminder
- Risk-based reserve + `releaseReserves`
- Vendor receivables report + 90-din write-off

---

## 12. Future plan

### 12.1 RazorpayX

Alag product — ek current account jispar API se payout. UTR apne aap, webhook confirm karta hai.

- Alag onboarding, alag API keys, **teesra webhook secret** (`RAZORPAYX_WEBHOOK_SECRETS`), har vendor ka "fund account"
- Balance pehle se bhara hona chahiye
- `payout.processed` / `payout.failed` / **`payout.reversed`** — teesra sabse zaroori: paisa 2-3 din baad wapas aa sakta hai
- Adapter me `initiate()` payout banata hai (idempotency key = `settlementId`), `confirm()` webhook se, `reverse()` `payout.reversed` par

> **Seedhi baat:** RazorpayX payout ka *manual kaam* hataata hai par §12.3 wala sawaal **bilkul waisa hi** chhod deta hai. Isliye ye tabhi lene layak hai jab Route na mile aur vendor bahut ho jayein.

### 12.2 Razorpay Route

Capture ke waqt hi batwara. Vendor ka hissa uske **linked account** me, aapka hissa aapke paas. Beech me aapke account me aata hi nahi.

- Order creation me `transfers[]` + `on_hold: true, on_hold_until: paidAt + delayDays`
- **"2 din baad pay karo" Razorpay ka apna feature ban jaata hai** — aapko likhna hi nahi padta
- Refund = `payments.refund({ reverse_all: true })` ya explicit transfer reversal — **hold ke dauraan paisa vendor tak pahuncha hi nahi**, isliye recover karne ki naubat hi nahi
- `transfer.processed` / `transfer.reversed` → `PayoutLeg` + `PAYOUT` ledger entries
- Har payment par ek transfer, aur Razorpay apne batches me linked account ko settle karta hai (`recipient_settlement_id`) — **isliye §3.2 ka leg model abhi se zaroori hai**

**Structural farq jo jaan lena chahiye:** Route **order creation par** split karta hai, settlement time par nahi. Yaani Route aane par `Settlement` payout **chalati nahi** — wo transfers ke upar ek **statement view** ban jaati hai. Ledger, statements aur vendor screens waise ke waise rehte hain. Isi liye `PayoutLeg` aur adapter abhi se zaroori hain — inke bina Route apnana ek rewrite hota, config change nahi.

### 12.3 Compliance — Route ki application aaj daalein

Doosron ka paisa lekar unhe dena **payment aggregation** hai, aur uske apne RBI niyam hain. Hal ye nahi ki khud licence lo — hal ye hai ki **kisi ke aggregator ke upar marketplace bano**. Route yahi hai: licence Razorpay ke paas, split wahi karta hai.

Manual/RazorpayX me kuch nahi hota — *jab tak nahi hota*. Volume badhne par ek hi account se bahut beneficiaries ko regular payout risk review trigger karti hai, aur nateeja account hold hota hai — **collections bhi ruk jaate hain**, sirf payouts nahi.

Main compliance salahkaar nahi hoon, isliye ye faisla nahi ek **flag** hai: Route ki application aaj daal dein aur Razorpay se likhit me confirm kar lein. Aapka use-case textbook marketplace hai — customer restaurant ka bill app se pay karta hai, discount lagta hai, paisa restaurant ka hai, Trydood convenience fee kamata hai.

### 12.4 MDR ka bojh kam / khatam karne ke paanch raste

Aaj `gatewayFeeBearer: PLATFORM` hai — platform poora MDR uthata hai (§2.5.1). Jab kabhi badalna ho, ye paanch raste hain. **Teen bilkul config-only hain, do me vendor se baat karni padegi.**

| # | Rasta | Vendor se baat? | Kitna cover |
|---:|---|---|---|
| 1 | **Kuch mat karo** *(aaj yahi)* | Nahi | UPI-heavy mix par blended positive |
| 2 | `feePerSlab` badhao | **Nahi** | Har method — ek config value |
| 3 | `commissionPercent` 0 → 2% | Haan | Poora, aur revenue bhi |
| 4 | `gatewayFeeBearer: VENDOR` | Haan | Poora, par variable deduction |
| 5 | **Method-wise fee** | **Nahi** | Poora, aur UPI ki taraf steer bhi karta hai |

#### Rasta 2 — sabse sasta lever

```js
// Setting.customer.convenienceFee — sirf do value
feePerSlab: 5 → 8 ya 10
maxFee:     50   // cap — warna ₹10,000 bill par fee bahut badi ho jaati hai
```

| feePerSlab | ₹500 bill | ₹1,000 | ₹2,000 | Credit card cover? |
|---|---:|---:|---:|---|
| ₹5 *(aaj)* | ₹5 | ₹10 | ₹20 | ✗ |
| ₹8 | ₹8 | ₹16 | ₹32 | ~haan |
| ₹10 | ₹10 | ₹20 | ₹40 | ✓ |

Customer ₹200 bacha kar ₹20 fee de — **92% net faayda**. Zomato/Swiggy ₹6–10 flat lete hain, BookMyShow ₹20–30 per ticket. Defensible hai, aur **vendor se koi baat nahi karni**.

#### Rasta 5 — method-wise fee *(sabse smart)*

Yahi asal me Zomato/Swiggy karte hain — isiliye "UPI par fee kam". Do faayde ek saath: MDR poora cover hota hai, **aur customer apne aap UPI ki taraf jaata hai** — jo hume chahiye hi hai.

```js
// Setting.customer.convenienceFee.byMethod
{
  UPI:        { feePerSlab: 5,  maxFee: 25 },   // MDR 0% — sasta rakho
  CARD:       { feePerSlab: 12, maxFee: 60 },   // MDR ~2% — cover karo
  NETBANKING: { feePerSlab: 12, maxFee: 60 },
  WALLET:     { feePerSlab: 12, maxFee: 60 },
  DEFAULT:    { feePerSlab: 8,  maxFee: 50 },
}
```

**Ek adchan aur uska hal:** convenience fee **preview par** tay hota hai, par method Razorpay checkout me chuna jaata hai — yaani hume pehle se pata nahi hota.

Hal — app `create-order` se **pehle** method poochhe:

```
Preview screen par:
  ⦿ UPI          — Convenience fee ₹10   ← default, sasta
  ○ Card         — Convenience fee ₹24
  ○ Netbanking   — Convenience fee ₹24

App chuna hua `method` preview aur create-order dono ko bhejta hai.
Razorpay order me bhi `method` restrict ho jaata hai, taaki customer
checkout par kuch aur chunkar sasti fee na le jaye.   ← ye zaroori hai
```

**Kya banana padega:**
- `Setting.customer.convenienceFee.byMethod` + `isMethodWiseEnabled` flag
- `calculateVoucherPricing()` me `method` ek naya optional input — na aaye to `DEFAULT` slab
- `previewCustomerVoucher` aur `createVoucherClaimOrder` dono `method` accept karein
- Razorpay `orders.create` me `method` pass ho
- Preview response me `feeByMethod` block — taaki app teeno option ek saath dikha sake
- **App-side:** ek method chooser screen

**Migration:** koi nahi. `isMethodWiseEnabled: false` par aaj wala behaviour hi chalta hai; flag on karte hi naya. Purani claims ka pricing frozen hai, isliye unpar koi asar nahi.

> **Faayda sirf paise ka nahi:** UPI par steer karne se blended MDR apne aap gir jaata hai, aur wo har agle mahine faayda deta hai.

### 12.5 Promo wale claims par outlet confirmation

Phase 1 me `billAmount` customer khud batata hai aur server use verify nahi kar sakta. **Akela customer isse fraud nahi kar sakta** — bill kam bataye to kam discount milega, zyada bataye to zyada asli paisa dena padega.

Asli exploit **vendor + customer milkar** karte hain, aur **sirf tab jab platform-funded promo laga ho:**

```
Asli bill ₹100, bataya ₹1,000
Offer 20%   → ₹200 discount   (vendor ko farq nahi — use netBill milta hai)
Promo ₹200  → PLATFORM-funded
Customer deta hai ₹610, vendor ko milte hain ₹800

Vendor + customer milkar  +₹190     ← promo ka paisa
Platform                  −₹200
```

Promo ke bina ye exploit khud ghaate ka hai (fee ki wajah se). **Yaani jokhim promo ki raqam tak hi seemit hai** — aur promo par pehle se `perCustomerUsageLimit`, `totalUsageLimit`, `maxDiscountAmount` lage hain.

**Future fix — Phase 2 ki machinery sirf risky hisse par:**

```js
// Setting.customer.claim
requireRedemptionWhenPromoApplied: false,   // future me true

// settle me:
promo laga nahi → capture par seedha REDEEMED     (aaj jaisa — ~95% claims)
promo laga      → capture par PAID, outlet scan ke baad REDEEMED
```

Isse **jo hissa exploit ho sakta hai sirf wahi** outlet confirmation maangta hai, baaki sab tez rehta hai. Schema abhi se dono states rakhta hai (`PAID`, `REDEEMED`, `redemptionMode`), isliye **is din koi migration nahi lagegi** — sirf ek config flag.

**Saath me ek anomaly report** — jis customer ya customer+outlet pair ka average bill us outlet ke median se bahut upar ho, ya frequency asaadhaaran ho. Pakadta hai, rokta nahi — par pattern dikha deta hai.

### 12.6 Commission on karna

`commissionPercent` config badalne se chalu. Structure abhi bana hai — rate, per-brand override, statement row, GST.

> **⚠️ Ye rule abhi se lagega, future me nahi — audit finding.** Commission agar **settle par** padha gaya to rate badalte hi wo transactions bhi affect honge jo collect ho chuke hain par settle nahi — yaani vendor ko dikha diya gaya amount retroactively kat jayega. Isliye `commissionPercent` ka snapshot **claim par freeze** hoga (`voucher.commissionPercent`, abhi `0`), aur settlement **usi frozen value** ko jodega. Aaj rate 0 hai to koi farq nahi dikhta — par field abhi na daali to on karne wale din ye chup-chaap kaat lega.

### 12.7 Account deletion

`docs/account_deletion_plan.md` money-out se **pehle** likha gaya tha. Uske pre-checks me ye add karne honge:

| Kise | Pre-check |
|---|---|
| Vendor | `getVendorBalance(brandId) !== 0` ya koi non-terminal Settlement → delete block, "pehle settlement complete hone dein" |
| Vendor | Koi khula dispute (`isDisputed: true`) → block |
| Customer | Koi `RefundRequest` non-terminal state me → block |
| Customer | `VoucherClaim` `PAID` par (Phase 2) → block ya warn |

Aur `LedgerEntry` / `Settlement` / `PayoutLeg` **kabhi delete nahi** honge — wo financial record hain. `account_deletion_plan.md` ki "preserve" list me teeno jodne honge.

### 12.8 Per-brand settings — `BrandSettlementConfig`

`Setting` poore platform ka **ek** document hai. Per-brand niyam usme reh hi nahi sakte. Ye chaar cheezein per-brand chahiye hongi:

| Cheez | Kab |
|---|---|
| `commissionPercent` | Bade vendor se alag deal |
| `reservePercent` / `reserveHoldDays` | **Design me pehle se per-vendor hai** (§7.5) |
| `settlementDelayDays` | Bharosemand vendor ko T+1 |
| `gatewayFeeBearer` | Kuch vendor MDR uthane ko raazi, kuch nahi |

```js
// models/BrandSettlementConfig.js
{
  brandId,                    // unique
  commissionPercent,          // SAB optional — null matlab global se lo
  reservePercent, reserveHoldDays,
  settlementDelayDays,
  gatewayFeeBearer,
  notes, updatedBy, updatedAt, isDeleted,
}

// helpers/settlements/getBrandSettlementConfig.js
// brand ka override → global Setting → constants
// wahi pattern jo getCustomerConfig() ka hai
```

> **⚠️ Har brand ki row banani NAHI padegi.** Ye collection **sparse** hai — row sirf us brand ki banegi jiski **alag deal** hai. Baaki sab global `Setting` se chalte hain, unka kuch nahi karna.
>
> **500 brands, 3 special deals → 3 rows.** Resolver ko row na mile to seedha global padh leta hai.

**Phase S2 me bana dena hai, bhale har field khali rahe** — kyunki har settlement calculation ko is resolver se padhna hai. Baad me retrofit karna matlab har calculation dobara chhoona.

### 12.9 Provider payout-account identity

RazorpayX ko har vendor ka `fund_account_id` chahiye, Route ko `linked_account_id`. Aaj `Bank` / `Brand` par aisi koi field nahi hai. Un din ke liye `Brand.payoutAccounts: { razorpayXFundAccountId, routeLinkedAccountId }` chahiye hoga, aur `bankSnapshot` me bhi wo id freeze honi chahiye — kyunki account number badalne par provider ke paas ek **naya** fund account banta hai.

### 12.10 Promo `SHARED` — vendor consent

**Aaj:** admin promo code banata hai `costBearing: { mode: SHARED, vendorPercent: 30 }` + `brandIds` ke saath. Vendor se baat offline. Har claim par split freeze, aur vendor ke statement me **"promo me aapka hissa"** alag row.

**Kal:**

```js
// models/PromoCodeVendorConsent.js — future
{
  promoCodeId, brandId,
  proposedBy,                 // admin
  vendorPercent,
  status,                     // PROPOSED | ACCEPTED | DECLINED | WITHDRAWN | EXPIRED
  respondedBy, respondedAt, declineReason,
  validFrom, validTill,
  isDeleted,
}
// { promoCodeId, brandId } unique
```

Flow: admin brand chunkar prastaav bhejta hai → vendor ko notification + panel me card → accept/decline (wajah ke saath) → accept hote hi **us vendor ke vouchers par code apne aap chalu**. Decline par us brand par kabhi nahi lagta.

**Do rule jo aaj hi maan lene chahiye:**
1. **Consent ka snapshot claim par jamega**, live consent par nahi. Vendor kal withdraw kare to purani claims ka hisaab na hile. `promoCostBearing` claim par pehle se ja raha hai — wahi jagah hai
2. **Consent na hona = consent hona nahi.** Jis din ye model aayega, `mode !== PLATFORM` wale codes ko `ACCEPTED` consent chahiye. Aaj banaye codes ke liye ek backfill lagega jo maujooda arrangements ko `ACCEPTED` maan le — us din ka chhota migration, par **abhi likh dena zaroori hai**

### 12.11 Aur

- **Notification digest** — settlement/claim notifications volume par per-outlet hourly batch
- **Counter batching** — sustained 1000+/sec par har process 100 numbers ka block reserve kare
- **Auto-approve settlement** — bharosa banne par `requiresAdminApproval: false`
- **Account deletion** — `docs/account_deletion_plan.md` me "khula refund/dispute hote hue customer delete kare" ka rule add karna hoga. Naye models me `isDeleted` hai

---

## 13. Bache hue sawaal

| # | Sawaal | Default |
|---:|---|---|
| 1 | **MDR kaun uthaye?** | `PLATFORM` — §2.5. Ab record hoga. `VENDOR` par flip karne ke liye vendor agreement chahiye |
| 2 | Route ki application kab? | Aaj hi, samanantar. Manual tab tak chalta rahega |
| 3 | Chargeback receivable kitne din baad write-off? | 90 din, phir admin manually (`MANUAL_ADJUSTMENT` wajah ke saath) |
| 4 | Settlement auto-approve ya admin? | `requiresAdminApproval: true` |
| 5 | Promo wale claims par outlet confirm kab? | Future — §12.5. Schema abhi se ready, sirf ek config flag |

---

## Appendix — audit findings jo is doc me lagu hue

Audit ne **51 findings** nikaleen. 17 par doosri raay mil payi (13 confirmed, 4 refuted); baaki 34 ki verification session limit se ruk gayi, isliye wo **haath se judge ki gayi** codebase ke khilaf. Duplicates hatane ke baad settlement side par ye lagu hue:

### Verified (adversarially confirmed)

| # | Finding | Sev | Kahan |
|---:|---|---|---|
| B1 | FAILED/REVERSED/CANCELLED settlement apni transactions hamesha ke liye strand kar deti hai — release hai hi nahi | CRITICAL | §3.5 |
| B2 | Claim ke baad par payout se pehle aaya dispute/refund transaction ko settlement se bahar nahi karta; aur `dispute.lost` `isDisputed: false` likhta hai | CRITICAL | §3.6 |
| B3 | Refund-to-bank chargeback ka ekmatra maanya sabooot chhod deta hai — double-payout window | CRITICAL | §6.2, §6.3, §12.4 |
| B4 | `models/Bank.js` customer account rakh hi nahi sakta, aur reuse karne par vendor onboarding lock (3 call sites) | HIGH | §6.5 |
| B5 | Ek `refundId`/`amountRefunded` partial refunds express nahi kar sakta; `$set` doosre ko overwrite karta hai | HIGH | §6.4 |
| B6 | Refund request par frozen `bankSnapshot` nahi | HIGH | §6.5 |
| B7 | T+3 calendar days safe nahi — Razorpay T+2 **working** days me settle karta hai; `fundsReceivedAt` kahin hai hi nahi | HIGH | §3.8 |
| B8 | Ek `payoutUtr` field N payout legs nahi rakh sakta | HIGH | §3.2 |
| B9 | Negative `netPayable` / sub-minimum ka koi terminal state nahi; `bankSnapshot` payout se pehle re-check nahi hota | MEDIUM | §3.7 |

### Haath se judge ki gayi (verification chhoot gayi thi)

| # | Finding | Sev | Kahan |
|---:|---|---|---|
| B10 | **Razorpay net settle karta hai — MDR + GST kahin model hi nahi. Har transaction par ~₹18 chup-chaap platform ki jeb se** | CRITICAL | §2.5 |
| B11 | **Refund/chargeback adjustments par claim lock nahi — wahi katauti har cycle me dobara lagti** | CRITICAL | §3.3 |
| B12 | **`settlementHold` ka release path nahi — rejected refund vendor ka paisa hamesha ke liye rok deta** | HIGH | §5.3 |
| B13 | `periodEnd` canonical nahi to har restart/instance nayi settlement mint karta | HIGH | §3.3 |
| B14 | `sweepStaleSettlements` chalti hui build ke neeche se rows kheench sakti hai | HIGH | §3.3, S2 |
| B15 | Golden rule request validator se enforce nahi ho sakta — `updateSetting` partial merge karta hai aur usme `customer` branch hai hi nahi | MEDIUM | §10 |
| B16 | Commission settle par padha to rate flip retroactively vendor ka paisa kaat leta | HIGH | §12.5 |
| B17 | `account_deletion_plan.md` money-out se pehle ka hai — paisa baaki hote hue account delete ho sakta hai | HIGH | §12.6 |
| B18 | Provider payout-account identity (`fund_account_id` / `linked_account_id`) kahin nahi | MEDIUM | §12.7 |
| B19 | Model naming existing `refField("Refund")` / `refField("Settlement")` se diverge karti hai | LOW | §6.4(5) |

Baaki findings claim side ki hain — [customer_voucher_claim_plan.md](./customer_voucher_claim_plan.md) ka appendix dekhein.

**Refute huyi 4 claims** (inpar kaam nahi ho raha): period-bounded claim query · `vendorPayable > captured` · `settlementHold` under Route · `refund.failed` ka stranding scenario.
