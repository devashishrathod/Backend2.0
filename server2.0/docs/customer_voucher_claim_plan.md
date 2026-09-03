# Customer Voucher Claim — Implementation Plan

> ## ✅ Ye ban chuka hai — par ye doc "kya banana tha" hai, "kya hai" nahi
>
> **Phase 0 · 1A · 1B · 1C — chaaron ho gaye.** Preview, promo, payment, claim, usage,
> invoice, notifications, ledger aur saari read APIs sab live hain.
>
> **Ye doc jaan-boojh kar waise ka waisa rakha gaya hai.** Isme har faisle ka *kyun* hai
> — aur wo kahin aur nahi likha. Par implement karte waqt kai jagah is plan se **hatna
> pada**, kyunki DB par sach kuch aur nikla. Is doc me likhi baat aur aaj ke code me
> farak ho, to **code sahi hai**.
>
> | Kya jaanna hai | Kahan padho |
> |---|---|
> | Aaj kaunsa module bana hai, kya nahi | [`implementation_phases.md`](./implementation_phases.md) |
> | Plan se kahan-kahan hatna pada, aur kyun | Wahi doc — har phase ka "ho gaya" section |
> | Refund aaj kaise chalta hai | [`refund_flow.md`](./refund_flow.md) |
> | Settlement aaj kaise chalta hai | [`settlement_flow.md`](./settlement_flow.md) |
>
> ⚠️ **Teen jagah is doc ka likha aaj galat hai:**
> 1. `pricing` block ke teen naam badal gaye (`discountAmount` → `offerDiscount`,
>    `payableAmount` → `totalPayable`, `totalSavings` → `youSaved`). Purane naam response
>    me abhi bhi echo hote hain, par **store sirf naye** hote hain.
> 2. Endpoint paths kebab-case me likhe hain; asli mount `routePrefix` se hota hai —
>    `/voucher-claims` sahi hai, par outlet verify ka path `code/:claimCode` hai,
>    `verify/:claimCode` **nahi**.
> 3. `database/mongoDb.js` wala `autoIndex` note ab purana hai — connection ab tuned hai,
>    `CLAUDE.md` ka "Production" section dekho.
>
> **Sibling doc:** [vendor_settlement_plan.md](./vendor_settlement_plan.md) — paisa bahar jaane wala hissa
> **Scope:** customer voucher preview → promo → Razorpay payment → claim + usage + transaction records → invoice → notifications

Ye doc **paisa andar aane** ka poora design hai. Vendor ko paisa dene wala hissa sibling doc me hai.

---

## 0. Locked decisions

| # | Sawaal | Faisla |
|---|---|---|
| 1 | Customer kya pay karta hai | Poora amount — `bill − offer − promo + convenienceFee + tax` |
| 2 | Claim lifecycle | **Phase 1: payment hi final.** Capture par claim `REDEEMED`. Phase 2 me outlet scan |
| 3 | Promo codes | Existing `PromoCode` model extend, `audience: VENDOR \| CUSTOMER` |
| 4 | Promo ki laagat | Per-code `costBearing`: `PLATFORM` (default) / `VENDOR` / `SHARED` (%) |
| 5 | Commission | **0% abhi**, poora structure banega — on karna config-only |
| 6 | GST | **Default OFF.** On karne par convenience fee **GST-inclusive** |
| 7 | Offer se neeche ka bill | **Error nahi** — seedha `billAmount` pay, koi promo/fee/tax nahi |
| 8 | BrandAvoidance | Claim block **nahi** karta |
| 9 | Preview auth | `optionalAuth` — guest preview kar sakta hai (promo ke saath bhi), claim nahi |
| 10 | Razorpay accounts | **Do bilkul alag** — VENDOR (subscription) aur CUSTOMER (voucher) |
| 11 | Vendor plan expired | Block, par admin config se allow + grace days |

---

## 1. Aaj codebase me kya hai

### 1.1 Reference — vendor subscription flow (chhedna nahi hai)

| Cheez | File |
|---|---|
| Ek builder preview + order dono ke liye | `helpers/subscribeds/buildCheckoutPreview.js` |
| Pricing ka ek hi source | `helpers/subscribeds/calculatePricing.js` |
| Ek settlement path (verify + webhook) | `helpers/subscribeds/settleSubscriptionPayment.js` |
| Promo 3-step ledger + atomic counter | `helpers/promoCodes/promoReservation.js` |
| Frozen invoice snapshot | `helpers/transactions/buildInvoiceSnapshot.js` |
| Webhook receiver + replay | `services/transactions/handleRazorpayWebhook.js` |

Har naya pattern inhi se copy hoga — dobara nahi socha jayega.

### 1.2 Customer side par kya hai

- `services/vouchers/previewCustomerVoucher.js` — sirf bill × offer × fee, `promoDiscount: 0` **hardcoded**
- Route `routes/vouchers.js:127` par **koi auth gate nahi**, aur controller `req.userId` bhejta hai jo hamesha `undefined` hai
- Claim / payment / redemption ka koi endpoint nahi

### 1.3 Teen bugs jo customer payment ke bina bhi galat hain

**Bug 1 — webhook har customer payment par fatega.**
`handleRazorpayWebhook.js:96` sirf `razorpayOrderId` se transaction dhoondhta hai aur seedha `settleSubscriptionPayment` chala deta hai. Customer transaction aate hi *"Subscription plan not found"* par `FAILED` hoga aur har payment par admins ko `CRITICAL` alert jayega.

**Bug 2 — invoice number collide karega.**
`generateUniqueInvoiceId()` `INV-#` + random 5-digit banata hai — sirf 90,000 values, har baar ek `findOne` loop, aur do concurrent create ek hi id le sakte hain.

**Bug 3 — `VoucherUsage` likha hi nahi ja sakta.**
- `orderId` → `ref: "Order"` — aisa model hai hi nahi, aur field `required` hai
- `offerId` → `ref: "VoucherOffer"` — offers `VoucherVersion` ke andar embedded subdoc hain
- Unique index `{voucherId, customerId}` har voucher ko zabardasti once-per-user bana deta hai
- Na `brandId`, na `transactionId`, na `isDeleted`

---

## 2. Ek hi Transaction collection

Subscription aur voucher payments **ek hi collection** me rahenge. Teen guardrails ke saath:

### 2.1 `purpose` + `gatewayAccount` required, naye fields namespaced

```js
// models/Transaction.js
purpose:        { type: String, enum: TRANSACTION_PURPOSE, required: true, index: true },
gatewayAccount: { type: String, enum: RAZORPAY_ACCOUNTS, required: true, index: true },
customerId:     customerField,
invoiceToken:   { type: String },   // index alag se — section 2.3

voucher: {                           // naya sub-doc, sirf VOUCHER_CLAIM par
  claimId, voucherId, voucherVersionId, versionNumber, offerId,
  billAmount, offerDiscount, convenienceFee, netBill,
  vendorPayable, platformPromoCost, vendorPromoCost,
},

// settlement ke liye — sibling doc dekhein
settlementHold:       { type: Boolean, default: false, index: true },
settlementHoldReason: { type: String },
razorpaySettlementId: { type: String, index: true, sparse: true },
fundsReceivedAt:      { type: Date, index: true },
```

Existing `subscriptionId` / `subscribedId` **jahan hain wahin rahenge** — unko sub-doc me shift karna badi migration hai jiska koi fayda nahi.

### 2.2 Har query ek hi darwaze se

```js
// helpers/transactions/buildTransactionFilter.js
exports.buildTransactionFilter = ({ purpose, brandId, customerId, ... }) => {
  if (!purpose) throwError(500, "Transaction query needs a purpose.");
  return { purpose, isDeleted: false, ... };
};
```

Koi service `Transaction.find()` seedha na kare — ye rule `CLAUDE.md` ke **Never** list me add hoga.

### 2.3 ⚠️ Unique index trap — audit finding, CRITICAL

`models/Transaction.js:104,107` par `razorpayOrderId` aur `invoiceId` **unique hain par sparse nahi**. Aaj har transaction ko create ke waqt hi `invoiceId` mil jaata hai (`createSubscribeOrder.js:144`), isliye ye kabhi nahi kaata.

Naya design invoice number **settle par** allot karta hai → voucher transaction bina `invoiceId` ke insert hoga → Mongo use `null` index karega → **doosre claim par `E11000`**. Ye 100% reproducible hai, har fresh environment me pehle hi din.

**Fix — schema aur DB dono badalne honge:**

```js
// 1. path se unique HATAO
razorpayOrderId: { type: String },
invoiceId:       { type: String },

// 2. explicit partial unique index, ALAG NAAM ke saath
transactionSchema.index({ invoiceId: 1 },
  { unique: true, partialFilterExpression: { invoiceId: { $type: "string" } },
    name: "invoiceId_unique_partial" });
transactionSchema.index({ razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $type: "string" } },
    name: "razorpayOrderId_unique_partial" });
transactionSchema.index({ invoiceToken: 1 },
  { unique: true, partialFilterExpression: { invoiceToken: { $type: "string" } },
    name: "invoiceToken_unique_partial" });
```

> **Migration order:** naya named index pehle banao → verify karo → *phir* purana `invoiceId_1` / `razorpayOrderId_1` naam se drop karo. Sirf schema badalne se `IndexOptionsConflict` (code 85) aayega jo Mongoose chup-chaap `index` event par nigal leta hai.

> **Write site par bhi:** VOUCHER_CLAIM transaction insert karte waqt `invoiceId` / `invoiceToken` **bilkul mat likho** — explicit `null` bhi nahi. `$type: "string"` dono ko chhod deta hai, par omission niyat saaf rakhta hai. `sparse` ki jagah `partialFilterExpression` isliye kyunki sparse explicit `null` ko index kar leta hai.

### 2.4 Index plan

| Index | Options | Kiske liye |
|---|---|---|
| `{ invoiceId }` | unique, partial `$type:string`, named | ⚠️ purana drop karna hoga |
| `{ razorpayOrderId }` | unique, partial `$type:string`, named | ⚠️ purana drop karna hoga |
| `{ invoiceToken }` | unique, partial `$type:string` | public invoice link |
| `{ razorpayPaymentId }` | sparse | existing |
| `{ purpose, customerId, createdAt:-1 }` | partial `purpose:VOUCHER_CLAIM` | customer history |
| `{ purpose, brandId, createdAt:-1 }` | partial `purpose:VOUCHER_CLAIM` | vendor earnings |
| `{ purpose, subBrandId, createdAt:-1 }` | partial `purpose:VOUCHER_CLAIM` | outlet listing |
| `{ purpose, status, createdAt:-1 }` | — | admin filters |
| `{ razorpayOrderId, gatewayAccount }` | — | account-scoped webhook lookup |
| `{ "voucher.claimId" }` | unique, sparse | ek claim = ek transaction |
| `{ settlementId }` | sparse | settlement ke liye |

Partial indexes ka poora point ye hai ki **subscription insert voucher index ko chhuta hi nahi**, aur ulta bhi. Isliye 99% rows customer ke hone par bhi vendor queries ka cost nahi badhta.

### 2.5 Infrastructure — launch se pehle

#### ⚠️ Atlas M0 free tier money data ke liye kaafi nahi

Abhi MongoDB Atlas **M0 (free)** par hain. Development ke liye bilkul theek — par asli paisa isape nahi chal sakta:

| M0 | Dikkat |
|---|---|
| **512 MB storage** | `WebhookEvent` poora payload rakhta hai (~3–5 KB per delivery). 1000 payments/day ≈ **150 MB/mahina sirf webhooks se**. Ledger, claims, history, transactions alag. **2–3 mahine me bhar jayega** |
| **Automated backup nahi** | Payment ledger ka backup na hona — data gaya to gaya, koi restore nahi. Ye sabse bada hai |
| Shared CPU | Load par performance anischit; concurrency-sensitive paths yahin dukhte hain |
| 500 connection cap | Multi-instance par jaldi lag jaata hai |

**Launch se pehle kam se kam M10** — dedicated CPU, continuous backup + point-in-time restore.

Aur storage kam rakhne ke liye ye teen abhi se:

1. **`WebhookEvent.payload` ko chhota rakho** — pehle se `WEBHOOK_DEFAULTS.maxPayloadBytes` (512 KB) hai, par asli payload ~4 KB hota hai. `REJECTED` rows par to sirf sha256 + preview jaa hi raha hai (§3.4d). Processed rows par bhi **90 din ka TTL index** daalo — replay ke liye itna kaafi hai
2. **`LedgerEntry` archival** — 2 saal se purani rows alag collection me. Abhi nahi, par field design ready hai
3. Boot par `logPaymentAccounts()` me DB tier bhi print karo, taaki galti se M0 par live na chala jaye

> **Ek achhi khabar:** M0 bhi replica set hai, isliye Mongo transactions technically available hain. Par design unpar nahi tika (§A3) — aur M0 ke shared CPU par wo aur bhi dheeme honge. Faisla wahi rehta hai: idempotency + resume job.

### 2.6 ⚠️ Migration ka deploy order — audit finding

`database/mongoDb.js` me `autoIndex` disable nahi hai, yaani Mongoose har boot par schema ke indexes banane ki koshish karta hai. Agar naya schema pehle deploy ho gaya aur purana index abhi DB me hai, to `IndexOptionsConflict` (code 85) aayega — jo Mongoose **`index` event par chup-chaap nigal leta hai**, process nahi marta. Nateeja: koi bhi index jeet sakta hai, aur aapko pata nahi chalega.

Repo me koi migrations framework nahi hai — `scripts/` me one-off scripts ka pattern hai (`scripts/backfillSubscriptionState.js` jaisa). Wahi use hoga.

#### ✅ Production DB fresh hai — isse bahut kuch aasan ho jaata hai

Production abhi launch nahi hua aur DB khali rahega. Iska matlab:

| Cheez | Fresh DB par |
|---|---|
| `purpose` / `gatewayAccount` `required: true` | **Pehle deploy me hi** — do-deploy wala dance nahi chahiye |
| `audience` backfill | Zaroori nahi — koi purana promo code hai hi nahi |
| Index drop-by-name | Zaroori nahi — purane indexes bane hi nahi honge |
| `invoiceId` partial index | Seedha sahi definition se banao |

**Yaani production par migration script chalani hi nahi padegi.** Schemas shuru se sahi likhe jayenge.

> **Par script phir bhi likhni hai** — kyunki **dev / staging DB me data hai** (existing subscriptions, promo codes, transactions). Wahan ye teen step lagenge hi. Script idempotent ho, har step par count print kare, aur khali DB par chup-chaap no-op ho jaye.

#### Jahan purana data hai (dev / staging) — teen step

| Step | Kya | Kyun |
|---|---|---|
| **1** | Migration script chalao (purana code abhi live hai) | Naye named indexes banao → verify → purane naam se drop. Saath hi `purpose` / `gatewayAccount` / `audience` backfill |
| **2** | Naya code deploy — `required: true` **abhi nahi**, sirf `default` | In-flight orders strand na ho jayein |
| **3** | Agle deploy me `required: true` | Tab tak sab rows bhar chuki hain |

### ✅ 2.6.1 Script ban gaya — `scripts/migrateCustomerClaimFoundation.js`

```bash
node scripts/migrateCustomerClaimFoundation.js            # dry run, kuch nahi likhta
node scripts/migrateCustomerClaimFoundation.js --apply    # asli run
```

Repo ke maujooda `scripts/backfillSubscriptionState.js` wala hi pattern — dry run default, `--apply` se likhta hai, har step par count, aur dobara chalane par saaf no-op.

**Chaar step:**

| Step | Kya |
|---|---|
| 1 | `createIndexes()` → har naye named index ki maujoodgi verify → **tabhi** purane naam se drop |
| 2 | `Transaction.purpose` / `gatewayAccount` / `settlementStage` backfill |
| 3 | `PromoCode.audience` + `PromoCodeUsage.audience` backfill |
| 4 | `Setting.customer` ke nau block persist |

**`syncIndexes()` kyun nahi:** wo schema me na hone wala **har** index drop kar deta hai. Koi index jo haath se bana ho, kisi ops task ne banaya ho, ya kisi doosri branch ka ho — bina naam liye gayab. Naam se drop karne ka matlab hai script sirf wahi hata sakti hai jo use bataya gaya hai, aur anjaan index report hota hai, delete nahi.

**Drop se pehle guard:** har legacy index ke saath uska replacement bandha hua hai. `invoiceId_1` tabhi drop hota hai jab `invoiceId_unique_partial` sach me maujood ho — warna us window me `invoiceId` par **koi** uniqueness hi nahi bachegi, aur us dauran issue hua duplicate invoice number baad me undo nahi hota.

**Dev DB par asli nateeja:**

```
✅ dropped transactions.invoiceId_1
✅ dropped transactions.razorpayOrderId_1
✅ purpose         -> SUBSCRIPTION  (49)
✅ gatewayAccount  -> VENDOR        (49)
✅ settlementStage -> COMPLETE      (26)
✅ PromoCode      -> VENDOR  (4)
✅ PromoCodeUsage -> VENDOR  (4)
✅ materialised 9 block(s) from their schema defaults
```

Uske baad app boot karke check kiya — `autoIndex` ne legacy index **wapas nahi banaye**, aur dobara `--apply` chalane par sab 0.

**Do baat jo likhte waqt DB par pakdi gayi:**

1. **`settlementStage` ka backfill soch se nahi nikla tha.** Purani 49 rows me wo field hai hi nahi, aur `!= "COMPLETE"` missing field par **sach** hota hai. Yaani `resumeIncompleteSettlements` job ko har pehle se settle ho chuki transaction adhoori lagti aur dobara settle karne jaati. Ab `verified: true` wali 26 rows par `COMPLETE` likh diya gaya (wo sach me poori hui theen), aur unverified rows ko chhua nahi — wo unpaid order hain, pipeline me kabhi ghuse hi nahi.

2. **`Setting.customer` ka check hydrated document par galat aata tha.** Mongoose sub-schema defaults **load par** bhar deta hai, to `Setting.findOne()` nau block wapas deta hai jabki stored `customer: {}` hai. Script pehle 0 missing bata rahi thi. Ab raw collection padhi jaati hai.

---

## 3. Do Razorpay accounts

VENDOR account = subscriptions. CUSTOMER account = voucher claims. **Alag keyId, alag secret, alag webhook secret.**

`configs/razorpay.js`, `generateRazorpaySignature.js` aur `getPaymentDetails.js` teeno pehle se do accounts support karte hain. Gyarah jagah account identity ya hardcoded hai ya hai hi nahi.

### 3.1 Account ek hi jagah tay hota hai

```js
// constants/transaction.js
const RAZORPAY_ACCOUNTS  = Object.freeze({ VENDOR: "VENDOR", CUSTOMER: "CUSTOMER" });
const TRANSACTION_PURPOSE = Object.freeze({
  SUBSCRIPTION: "SUBSCRIPTION", VOUCHER_CLAIM: "VOUCHER_CLAIM",
});
const ACCOUNT_FOR_PURPOSE = Object.freeze({
  SUBSCRIPTION:  RAZORPAY_ACCOUNTS.VENDOR,
  VOUCHER_CLAIM: RAZORPAY_ACCOUNTS.CUSTOMER,
});

// configs/razorpay.js — instance aur keyId hamesha SAATH
exports.getRazorpayAccount = (account) => ({ instance, keyId });
```

Account transaction par `gatewayAccount` me **likh diya jaata hai**. Uske baad har account-sensitive call (signature, payment lookup, refund) wahi padhti hai — koi hardcode nahi. Isse "galat secret utha liya" wali poori shreni khatam ho jaati hai.

### 3.2 Gyarah fixes

| # | Issue | Fix |
|---|---|---|
| 1 | Reject hui delivery ka koi nishaan nahi bachta | `WebhookEvent` row `REJECTED` status ke saath — **par section 3.4 padhein, seedha karne par ulta nuksaan hai** |
| 2 | Webhook verify ke paas ek hi secret | Do routes, har ek apna `expect` account. Secret env var **comma-separated list** (rotation zero-downtime) |
| 3 | `findTransaction` account se scoped nahi | Lookup `{ razorpayOrderId, gatewayAccount }` par |
| 4 | Verify galat account ka secret utha sakta hai | Sab `transaction.gatewayAccount` padhein |
| 5 | Instance aur `keyId` alag jagah se | `getRazorpayAccount()` dono saath de |
| 6 | Refund/lookup owning account se hona chahiye | Wahi binding |
| 7 | Replay ko account pata nahi | `WebhookEvent.account` |
| 8 | Dispute worklist nahi batata kaunsa dashboard | `account` + `purpose` dikhein |
| 9 | Test/live keys mix ho sakti hain | `logPaymentAccounts()` boot par |
| 10 | Settlement ka paisa CUSTOMER account me | Sibling doc, forward decision |
| 11 | Order `notes` khali | claimId, voucherId, brandId, subBrandId, storeId |

### 3.3 Webhook routing

```
verify signature (expected account ke secrets pehle, phir doosre)
  ↓ account maloom
findTransaction({ razorpayOrderId, gatewayAccount: account })
  ↓
transaction.purpose SETTLERS map se match kare?
  nahi → STOP + CRITICAL alert. Guess kabhi nahi.
  haan  → SETTLERS[purpose](...)
```

Galat endpoint par aayi delivery bhi chal jayegi (fallback secret) **par chup-chaap nahi** — WARNING alert ke saath, taaki dashboard ki galti dikh jaye.

### 3.4 ⚠️ REJECTED WebhookEvent — audit finding, CRITICAL

Signature-fail par `WebhookEvent` row likhna sahi hai, **par seedha likhne par ek naya, bada hole khulta hai.**

`eventId` unique + required hai. Signature fail hone par uski ekmatra available value **untrusted `x-razorpay-event-id` header** hai. Agar wo row likh di, to jab wahi event sahi signature ke saath dobara aayega:
1. `WebhookEvent.create` → `E11000`
2. `handleRazorpayWebhook.js:331` ka catch **bina status padhe** `DUPLICATE` + **200** return karta hai
3. Razorpay 200 dekh kar retry band kar deta hai
4. `processWebhookEvent` kabhi chalta hi nahi

**Nateeja:** claim hamesha `PENDING`, koi `VoucherUsage` nahi, koi invoice nahi, koi notification nahi, aur paisa CUSTOMER account me kisi ka nahi. **Rollout ke din ye har event par hoga**, ek par nahi.

**Fix — teen hisse, teeno zaroori:**

**(a) Rejected key ko namespace karo, deterministic rakho**

```js
eventId: `REJECTED:${account}:${sha256(rawBody)}`
```

`Date.now()` **mat lagao** — us se har rejected delivery ek nayi row banegi aur jo bhi URL jaanta hai wo 512KB payload ki anginat copies likhwa sakta hai. Deterministic key par 11000 aane pe sirf `$inc: { attempts: 1 }` karo aur phir bhi **400** lautao. Untrusted header ko alag **non-unique** `claimedEventId` field me rakho.

> Partial index wala rasta yahan kaam nahi karta — Mongo ka `partialFilterExpression` `$ne` support nahi karta, to `{status: {$ne: "REJECTED"}}` invalid hai.

**(b) 11000 branch ko status padhna sikhao**

| Existing row ka status | Kya karo |
|---|---|
| `PROCESSED` / `IGNORED` / `DUPLICATE` | `DUPLICATE`, 200 (aaj jaisa) |
| `REJECTED` | (a) ke baad pahunchna hi nahi chahiye — pahunche to CRITICAL alert + process karo |
| `FAILED` | `processWebhookEvent` chalao. Safe — settlement `verified:false` par conditional claim karta hai |
| `RECEIVED` | Iska matlab ek request **abhi chal rahi hai**. Blindly fall-through do settlers ki race banata hai. Sirf tab takeover karo jab row stale ho (~2 min, `processedAt` nahi), aur wo bhi conditional `findOneAndUpdate` se |

**(c) REJECTED ko replay se bahar rakho**

`WEBHOOK_REPLAYABLE_STATUSES` me to hai hi nahi, par `replayWebhookEvent.js:52-60` ke `force` escape hatch se bhi **explicitly 422** karo. Replay signature verification skip karta hai — ek REJECTED payload force-replay karna matlab unauthenticated attacker-controlled JSON seedha `processWebhookEvent` me daalna.

**(d)** REJECTED row par **poora raw payload mat rakho** — sha256, byte length, source IP, aur truncated preview kaafi hai.

### 3.5 Events

`WEBHOOK_HANDLED_EVENTS` me ye add honge:

| Event | Kyun | Kaunsa handler |
|---|---|---|
| `payment.authorized` | Enum me hai par handled list me nahi → aaj chup-chaap `IGNORED`. Auto-capture ek **per-account dashboard setting** hai; off hone par payment 5 din baad auto-refund ho jaata hai | **Apna alag handler — §3.5.1** |
| `refund.created` | Refund pipeline ka trigger | Refund branch |
| `refund.failed` | Bina iske escalation exist hi nahi karta | Refund branch |
| `settlement.processed` | `fundsReceivedAt` ke liye — sibling doc §3.8 | `reconcileSettlements` trigger |

Order creation par `payment_capture` **explicitly** bheja jayega — dashboard setting par bharosa nahi.

#### 3.5.1 ⚠️ `payment.authorized` ko settler me MAT bhejo — audit finding, CRITICAL

`payment.authorized` **har successful payment par firing hota hai** — Razorpay pehle authorize karta hai, phir capture. Agar use `SETTLERS[purpose]` me route kar diya, to `settleSubscriptionPayment.js:100` ka `if (!payment.captured)` branch **har payment par** chalega:

1. `releasePromoCode()` — customer ka promo hold chhoot jayega
2. `throwError(402)` — WebhookEvent `FAILED`
3. Admins ko CRITICAL alert — **har payment par**

Phir milliseconds baad `payment.captured` aayega aur bina promo ke settle hoga. Yaani ye "fix" har transaction todta.

**Sahi handling — ek chhota alag handler, settler bilkul nahi:**

```js
// processWebhookEvent me — SETTLERS se pehle, apni branch
if (event === RAZORPAY_WEBHOOK_EVENTS.PAYMENT_AUTHORIZED) {
  // Sirf record. Koi promo release nahi, koi claim state change nahi.
  await Transaction.updateOne(
    { _id: transaction._id, verified: false },
    { $set: { authorizedAt: new Date(), status: payment.status } },
  );
  return finish(WEBHOOK_STATUS.PROCESSED, "Authorized recorded; capture ka intezaar.");
}
```

Aur `alertStuckAuthorizations` job (hourly): jo transactions `authorizedAt` set hain par `verified: false` aur N minute (config `authorizedAlertMinutes`, default 30) purane hain → CRITICAL alert. **Yehi wo signal hai jo auto-capture band hone par chahiye** — aur wo bina kisi payment ko chhede milta hai.

#### 3.5.2 Account route se aata hai, secret se nahi

Signature ka kaam **authenticate** karna hai, account **batana nahi**. `gatewayAccount` **route se** aayega (`/webhook/razorpay` → VENDOR, `/webhook/razorpay/customer` → CUSTOMER). Fallback secret sirf tab account badalta hai jab **sirf doosre account ka secret match kare** — aur tab WARNING alert bhi jaata hai.

Warna agar kabhi dono dashboards par ek hi secret string set ho gayi, to har CUSTOMER payment VENDOR lookup me chala jayega.

### 3.6 Double-capture guard

Settle me jab conditional claim `alreadySettled` bole, to incoming `payment.id` ko `transaction.razorpayPaymentId` se milao. **Alag hua = doosri capture** → record + CRITICAL alert + auto-refund. Ye subscription flow ka bhi wahi hole thik karta hai.

### 3.7 ⚠️ Conditional claim ke baad crash — audit finding, CRITICAL

`settleSubscriptionPayment.js:117` ka conditional claim **terminal** hai — `verified: false → true`. Uske **baad** chhe dependent writes hote hain: activate/claim REDEEMED, VoucherUsage, promo commit, ledger entries, invoice snapshot, notify.

Agar process un beech me mar gaya (deploy, OOM, Mongo blip), to transaction `verified: true` hai par kaam aadha hua hai — aur **koi rasta wapas andar nahi jaata**: verify `alreadyVerified` lautata hai, webhook retry `alreadySettled`, replay bhi wahi. Money captured, claim `PENDING`, vendor ko kabhi paisa nahi.

Mongo multi-document transactions is codebase me kahin use nahi hote, aur unhe abhi introduce karna bada badlaav hai. Iski jagah wahi cheez jo repo pehle se karta hai — **har step idempotent + ek repair path**:

```js
// Transaction par ek naya field
settlementStage: {
  type: String,
  enum: ["CLAIMED", "RECORDED", "INVOICED", "COMPLETE"],
  index: true,
},
```

- Conditional claim ke saath hi `settlementStage: "CLAIMED"` likho
- Har group ke baad stage aage badhao — `RECORDED` (claim + usage + promo + ledger), `INVOICED`, `COMPLETE`
- Har step apne aap idempotent hai: `VoucherUsage` par `voucherClaimId` unique, promo commit pehle se idempotent, claim status conditional, ledger par `{entryType, transactionId}` unique
- **`resumeIncompleteSettlements` job** (15 min): `verified: true` **aur** `settlementStage != "COMPLETE"` **aur** N minute purane → `settleVoucherClaimPayment` ko `resume: true` ke saath dobara chalao. Wo conditional claim skip karke seedha bache hue steps chalata hai

Kyunki har step idempotent hai, resume ko ye jaanne ki zarurat hi nahi ki kahan ruka tha — wo bas sab dobara chala deta hai aur jo ho chuka hai wo no-op ho jaata hai.

> Yehi gap aaj subscription flow me bhi hai. Ek hi fix dono ko cover karta hai.

### 3.8 Env vars

```
RAZORPAY_VENDOR_KEY_ID              # hai
RAZORPAY_VENDOR_SECRET              # hai
RAZORPAY_CUSTOMER_KEY_ID            # hai
RAZORPAY_CUSTOMER_SECRET            # hai
RAZORPAY_WEBHOOK_SECRETS            # NAYA naam — comma-separated list (vendor)
RAZORPAY_CUSTOMER_WEBHOOK_SECRETS   # NAYA — comma-separated list (customer)
RAZORPAY_BASEURL                    # hai — account-agnostic
PUBLIC_API_URL                      # NAYA — invoice link + WhatsApp template base
```

Purana `RAZORPAY_WEBHOOK_SECRET` fallback ke taur par padha jayega taaki kuch toote nahi.

---

## 4. Pricing

### 4.1 Formula

```
netBill        = billAmount − offerDiscount
promoDiscount  = validateCustomerPromoCode(...)        // appliesTo: NET_BILL | CONVENIENCE_FEE
convenienceFee = ceil(billAmount / slabSize) * feePerSlab   // ORIGINAL bill par
tax            = isGstEnabled ? gstOn(convenienceFee) : 0   // default OFF

totalPayable   = netBill − promoDiscount + convenienceFee + taxOnTop
amountInPaise  = round(totalPayable * 100)

vendorPromoCost   = round2(promoDiscount * costBearing.vendorPercent / 100)
platformPromoCost = round2(promoDiscount − vendorPromoCost)   // remainder platform ko
vendorPayable     = netBill − vendorPromoCost

youSaved = offerDiscount + promoDiscount
```

`convenienceFee` **original bill** par lagta hai, discounted par nahi — ye rule `calculateConvenienceFee.js` me pehle se hai aur wahi rahega, warna alag offer chunne par fee hilti rahegi.

GST inclusive hone par `taxOnTop = 0` aur fee ke andar se tax back-calculate hota hai — bilkul `calculatePricing.js` ka `isGstInclusive` branch.

#### ⚠️ Promo apne base par clamp hoga — audit finding

`promoDiscount` ko **usi cheez par** clamp karo jispar wo lagta hai, poore total par nahi:

```js
const promoBase = appliesTo === "CONVENIENCE_FEE" ? convenienceFee : netBill;
promoDiscount   = Math.min(round2(rawPromoDiscount), promoBase);
```

Bina iske: ₹10 fee par ₹50 ka `CONVENIENCE_FEE` promo bill me se ₹40 aur kaat leta, aur ek bada `NET_BILL` promo `totalPayable` ko zero ya negative tak le jaata — jispar Razorpay order banta hi nahi. Aur `totalPayable ≤ 0` par 422 (§7 case 26) **ye clamp lag jaane ke baad** check hoga.

#### ⚠️ Gateway fee — audit finding, CRITICAL

Razorpay **net settle karta hai, gross nahi.** Customer ₹760 deta hai, Razorpay MDR + uspar GST kaat kar (~2% + 18%, yaani ~₹18) lagbhag **₹742** Trydood ke bank me bhejta hai. Par design vendor ko `netBill` se `vendorPayable` **₹785** deta hai — gross par computed.

| | |
|---|---:|
| Customer se aaya | 760.00 |
| Razorpay ne bank me bheja (MDR ~2% + GST) | **742.06** |
| Vendor ko dena | 785.00 |
| Convenience fee kamai | 10.00 |
| Promo cost (platform ka 70%) | −35.00 |
| **Platform ki jeb se** | **−42.94** |

Isme ₹25 to campaign ki soch-samajh kar li gayi laagat hai. Par **₹17.94 MDR chup-chaap platform kha raha hai** aur kahin record hi nahi hota.

**Achhi khabar:** data pehle se aa raha hai — `settleSubscriptionPayment.js:39-40` `payment.fee` aur `payment.tax` ko Transaction par likh hi raha hai. Sirf model karna baaki hai:

```js
// pricing block me
gatewayFee:      // payment.fee / 100  — MDR + uspar GST
gatewayFeeBearer // PLATFORM (default) | VENDOR | SHARED
vendorGatewayFee // bearer ke hisaab se vendor ka hissa
netReceived      // totalPayable − gatewayFee — jo sach me bank me aaya
```

- Ledger me naya `GATEWAY_FEE` entry type — `PLATFORM_COST` par (ya `gatewayFeeBearer` ke hisaab se `VENDOR_PAYABLE` par)
- Settlement statement me apni row
- Default `PLATFORM` — yaani aaj wala behaviour, par **ab dikhta hua**. `VENDOR` par flip karne ke liye vendor agreement chahiye, config ready rahegi

> Ye capture ke waqt hi pata chal jaata hai (`payment.fee` webhook payload me aata hai), isliye settlement se pehle hi ledger me chala jayega.

### 4.2 Case A — offer + promo (SHARED 30/70), GST off (**default config**)

| Row | Customer |
|---|---:|
| Bill Amount | 1,000.00 |
| Voucher discount (20% off) | − 200.00 |
| Promo (WELCOME50) | − 50.00 |
| Convenience fee | + 10.00 |
| **You'll Pay** | **760.00** |
| | |
| Vendor payable | 785.00 |
| Platform promo cost | 35.00 |
| Platform net | − 25.00 |

### 4.3 Case B — bill har offer ke minimum se neeche

| Row | Customer |
|---|---:|
| Bill Amount | 300.00 |
| Voucher discount | — |
| Promo | — (`allowWhenNoOffer: false`) |
| Convenience fee | — (`chargeWhenNoOffer: false`) |
| **You'll Pay** | **300.00** |
| Vendor payable | 300.00 |

**Teeno records phir bhi banenge** — Transaction, VoucherClaim, aur VoucherUsage (`offerApplied: false`, `offerId: null`, `discountAmount: 0`). Once-per-user index chhuta hi nahi kyunki `isOncePerUser: false`.

> `chargeWhenNoOffer: true` karne par customer bina discount ke apne bill se **zyada** dega. Config allow karta hai, par preview us haalat me saaf notice dega.

### 4.4 Promo cost bearing

| Mode | vendorPercent | Vendor payable |
|---|---:|---|
| `PLATFORM` (default) | 0 | `netBill` |
| `VENDOR` | 100 | `netBill − promoDiscount` |
| `SHARED` | 1–99 | `netBill − vendorShare` |

Do validator rules:
1. `mode !== PLATFORM` ho to `brandIds` khali nahi ho sakta — bina brand scope ke vendor-borne code jis brand par lage uska paisa kaat lega
2. Rounding ek hi baar: `vendorShare` round hota hai, `platformShare = promoDiscount − vendorShare` — jod hamesha exactly `promoDiscount`

`costBearing` ka snapshot **claim par freeze** hota hai. Promo code baad me badle to purani claims ka hisaab nahi hilta.

---

## 5. Data model

### 5.1 `VoucherClaim` — naya

```js
{
  customerId, userId,
  voucherId, voucherVersionId, versionNumber,
  offerId,                              // null jab koi offer apply nahi hua
  brandId, subBrandId,

  // frozen snapshots — reports aur invoice inhe hi padhte hain, live lookup nahi
  offerSnapshot, voucherSnapshot, brandSnapshot, outletSnapshot,

  billAmount, offerApplied,
  pricing: voucherPricingSchema,

  transactionId,
  status,          // PENDING | PAID | REDEEMED | FAILED | EXPIRED | CANCELLED | REFUNDED
  claimCode,       // TD-8F3K2Q — Phase 1 me reference, Phase 2 me redeem key
  redemptionMode,  // AUTO | OUTLET_SCAN | ADMIN

  paidAt, redeemedAt, redeemedBy, expiresAt,
  cancelledAt, cancelReason, refundedAt, refundAmount, refundReason,

  holdsUsageSlot: false,   // once-per-user ka atomic lock
  isOncePerUser:  false,

  promoCodeId, promoCode, promoDiscount, promoQuotedUntil,
  promoCostBearing: { mode, vendorPercent },
  isDeleted,
}
```

**Indexes**

| Index | Options |
|---|---|
| `{ voucherId, customerId, offerId }` | unique, partial `{ holdsUsageSlot: true }` — **per-offer**, §5.3 |
| `{ transactionId }` | unique, sparse |
| `{ claimCode }` | unique, partial `$type:string` |
| `{ customerId, createdAt:-1 }` | — |
| `{ brandId, createdAt:-1 }` | — |
| `{ subBrandId, createdAt:-1 }` | — |
| `{ status, createdAt:1 }` | stale PENDING sweep |
| `{ status, expiresAt:1 }` | Phase 2 |

> **Partial index me boolean kyun:** Mongo ka `partialFilterExpression` `$in` support nahi karta — sirf equality, `$exists`, comparison, `$type`, `$and`. Isliye "in these statuses" ki jagah ek denormalized boolean. Lock claim **banate hi** lagta hai, payment ka intezaar nahi karta.

### 5.2 `VoucherClaimHistory` — naya

`SubscribedHistory` ki tarah append-only. `recordClaimHistory()` failure-tolerant — audit row kho jana kabhi paid claim rollback nahi karega.

Actions: `CLAIM_CREATED` · `PAYMENT_CAPTURED` · `PAYMENT_FAILED` · `REDEEMED` · `EXPIRED` · `CANCELLED` · `REFUND_REQUESTED` · `REFUNDED` · `PROMO_RELEASED`

Har row par `performedBy`, `performedByRole` (`CUSTOMER | VENDOR | ADMIN | SYSTEM`), aur free-form `snapshot`.

### 5.3 `VoucherUsage` — redesign

```js
{
  voucherClaimId,          // unique — idempotency ka anchor
  transactionId,
  customerId, userId,
  voucherId, voucherVersionId, versionNumber,
  offerId,                 // ab optional — no-offer claim par null
  brandId, subBrandId,     // dono naye
  offerApplied, offerSnapshot,
  billAmount, discountAmount, promoDiscount, convenienceFee, paidAmount,
  usageType, isOncePerUser,
  usedAt,
  isReversed, reversedAt, reversalReason,
  isDeleted,
}

voucherUsageSchema.index(
  { voucherId: 1, customerId: 1, offerId: 1 },
  { unique: true,
    partialFilterExpression: { isOncePerUser: true, isReversed: false },
    name: "voucherUsage_oncePerUser" },
);
```

> **Migration:** purana `{voucherId, customerId}` unique index **naam se drop** karna hoga, warna nayi partial definition boot par `IndexOptionsConflict` degi. Collection khali hai — risk zero, par step apne aap nahi hoga.

#### ⚠️ ONCE_PER_USER **per-offer** hai, per-voucher nahi

`models/VoucherVersion.js:37` par `usageType` **offer ke andar** hai — yaani ek hi version me ek offer `ONCE_PER_USER` ho sakta hai aur doosra `MULTIPLE`. Ye ek asli use case hai:

```
Voucher V:
  Offer A — "First order 50% off"   ONCE_PER_USER
  Offer B — "10% off hamesha"       MULTIPLE
```

Pehle design me lock poore **voucher** par tha, jo galat tha — customer A use karne ke baad B se bhi kat jaata, jispar uska haq tha.

**Sahi behaviour:**

| Kya hua | Nateeja |
|---|---|
| Customer ne offer A consume kiya | Sirf **A** band. B chalu |
| Agli baar preview | A `eligibleOffers` se hat jaata hai, B apply hota hai, price B ke hisaab se |
| `canClaim` | **`true`** — us voucher par ab bhi kuch mil raha hai |
| Saare eligible offers ONCE_PER_USER the aur sab consume | Tab `canClaim: false` + reason |

**Isliye:**
- `VoucherClaim` ka lock bhi `{ voucherId, customerId, offerId }` par — `holdsUsageSlot` ke saath
- `resolveClaimOffer` (§Phase 1A M8) consumed `ONCE_PER_USER` offers ko chhod kar bacha hua best chunta hai
- `isOncePerUser` claim aur usage dono par **us offer ka** `usageType` hai, voucher ka nahi
- No-offer claim par `offerId: null` — aur `isOncePerUser: false`, to partial index chhuta hi nahi

### 5.4 `PromoCode` / `PromoCodeUsage` — extend

```js
// PromoCode — naye fields
audience: { enum: [VENDOR, CUSTOMER], default: VENDOR, required, index },
voucherIds, brandIds, categoryIds,
perCustomerUsageLimit: { default: 1, min: 1 },
firstOrderOnly, minBillAmount,
appliesTo:   { enum: [NET_BILL, CONVENIENCE_FEE], default: NET_BILL },
costBearing: { mode: { enum: [PLATFORM, VENDOR, SHARED], default: PLATFORM },
               vendorPercent: { default: 0, min: 0, max: 100 } },

// PromoCodeUsage
brandId       // required hataya — VENDOR audience par hi bharta hai
customerId, voucherClaimId, audience, vendorCost, platformCost   // naye
```

`validatePromoCode.js` teen tukdon me:
- `assertPromoWindowAndCaps()` — active, deleted, window, `totalUsageLimit`, discount calc, clamping. Dono audiences ke liye ek
- `validateVendorPromoCode()` — jaisa abhi hai
- `validateCustomerPromoCode()` — voucher/brand/category scope, `minBillAmount`, `perCustomerUsageLimit` (ledger se, `RESERVED + CONSUMED` gin kar), `firstOrderOnly`

`reservePromoCode` / `commitPromoCode` / `releasePromoCode` / `releaseStalePromoReservations` — chaaron generalize (`brand` ki jagah `owner: { brandId?, customerId? }`).

**Report:** `getPromoCodeReport` ke `$match` me `audience` add hoga + `{ audience, createdAt }` index — warna customer aur vendor reports ek doosre ko scan karenge.

> **⚠️ `audience` ka default purani rows par lagta hi nahi — audit finding.** Mongoose ka `default` **write par** lagta hai, existing documents par nahi. Yaani `PromoCode.findOne({ code, audience: "VENDOR" })` **abhi live har promo code ko miss kar dega**, kyunki un rows me `audience` field hai hi nahi. Do cheezein zaroori hain:
> 1. Migration me `updateMany({ audience: { $exists: false } }, { $set: { audience: "VENDOR" } })` — **naye code se pehle** (§2.5 step 1)
> 2. Aur belt-and-braces: vendor path ka filter `{ audience: { $ne: "CUSTOMER" } }` ho, `{ audience: "VENDOR" }` nahi — taaki ek chhooti hui row bhi kaam karti rahe
>
> Yahi rule `PromoCodeUsage.audience` par bhi.

> **Dono taraf filter lagega.** `validateVendorPromoCode` me bhi audience check jaayega, sirf customer wale me nahi — warna customer ka voucher promo vendor ke subscription checkout par chal jayega.

### 5.5 Invoice numbering

```js
// helpers/transactions/generateInvoiceNumber.js
// Counter key:  INVOICE:VCH:25-26   |   INVOICE:SUB:25-26
// Output:       TD/VCH/25-26/000001
const counter = await Counter.findOneAndUpdate(
  { _id: `INVOICE:${series}:${fy}` },
  { $inc: { sequence: 1 } },
  // setDefaultsOnInsert NAHI, aur new: true bhi NAHI — dono wajah niche
  { upsert: true, returnDocument: "after" },
);
```

`$inc` atomic hai — na scan, na race. Purani `INV-#xxxxx` rows waisi hi.

> **⚠️ `new: true` Mongoose 9 me deprecated hai** — `returnDocument: "after"` use karo. `helpers/settings/getSetting.js:7-9` me iska comment pehle se likha hai (har settings read par warning aa rahi thi). Yahi `Settlement` ke `settlementNumber` par bhi lagega.

> **✅ Sudhaar — pehle yahan ek galat baat likhi thi.** Is doc me pehle likha tha ki `setDefaultsOnInsert` `$inc` ke saath conflict karega, kyunki `models/Counter.js` me `sequence` ka default `1000` hai. **Wo galat tha.** Mongoose un paths ke defaults skip kar deta hai jo update me pehle se hain, isliye `sequence` par koi `$setOnInsert` jodta hi nahi.
>
> Live DB par verify kiya gaya (2026-08-30) — `setDefaultsOnInsert` `true` ho ya `false`, dono me fresh key par `sequence = 1` hi aata hai. `helpers/vouchers/generateUniueCode.js` bilkul yahi combination (`$inc` + `setDefaultsOnInsert: true`) pehle se production me chala raha hai, aur maujooda `VOUCHER` counter ka pehla voucher `VCH-00000005` hai — 1 se shuru, 1001 se nahi.
>
> To pehla invoice `000001` hi hoga. Option chhodne ya rakhne se koi farq nahi padta; naya helper use omit karta hai kyunki wahan uski zarurat hi nahi.

> **⚠️ Timezone — audit finding.** Financial year (Apr–Mar) aur din ki boundary **IST me** compute honi chahiye, host timezone me nahi. Server UTC par chala to 00:00–05:30 IST ka paisa pichhle din aur galat FY series me chala jayega. Ek hi helper — `helpers/common/istDate.js` — `istDayStart()`, `istFinancialYear()` — aur **sab** wahi use karein: invoice series, settlement period, daily reports.

---

## 6. Flow

### 6.1 Preview → order → payment → settle

```
Customer app          server2.0              Razorpay CUSTOMER      MongoDB
     │  preview (bill + promoCode)  │                      │
     ├─────────────────────────────>│  gates + offer + promo — READ ONLY
     │<─────────────────────────────┤  pricing · orderSummary · canClaim
     │                              │
     │  create-order (isCustomer)   │
     ├─────────────────────────────>│  orders.create(amountInPaise, payment_capture)
     │                              ├─────────────────────>│
     │                              ├──────────────────────────────────> Transaction(gatewayAccount)
     │                              │                      │             + Claim(PENDING) + promo RESERVED
     │<─────────────────────────────┤  orderId · matching keyId
     │                              │
     │  checkout — customer pays    │                      │
     ├────────────────────────────────────────────────────>│
     │                              │                      │
     │  verify (browser callback)   │                      │
     ├─────────────────────────────>│                      │
     │                              │<─── webhook payment.captured
     │                              │
     │              ┌───────────────────────────────┐
     │              │ settleVoucherClaimPayment     │
     │              │ findOneAndUpdate({verified:false}) — sirf ek jeetega
     │              └───────────────────────────────┘
     │                              ├──────────────────────────────────> claim REDEEMED
     │                              │                                    VoucherUsage
     │                              │                                    promo CONSUMED
     │                              │                                    LedgerEntry (sibling doc)
     │                              │                                    invoiceSnapshot + number
     │<─────────────────────────────┤  claim + invoiceUrl                notify
```

**Teesra safety net:** `reconcilePayments` job (hourly, per account) Razorpay se captured payments maang kar settled transactions se milata hai. Jo captured hai par settled nahi, usi `settle*` path se chalta hai. Browser callback chhoot sakta hai, webhook ke waqt hum down ho sakte hain — ye teesra layer un dono ko cover karta hai. Conditional claim pehle se idempotent hai, isliye job baar-baar chalne par kuch double nahi hota.

### 6.2 Claim state machine

```
                    ┌── PHASE 1: capture (redemptionMode AUTO) ──────────┐
                    │                                                     ▼
  PENDING ──capture──> PAID ──outlet scan──> REDEEMED ──> VoucherUsage likhi jaati hai
     │                  │      (Phase 2)         │
     │                  │                        └──refund──> REFUNDED
     │                  └──window beeta──> EXPIRED (Phase 2)
     │
     └──fail / sweep──> FAILED / CANCELLED
```

Ek hi state machine dono phases ke liye. Phase 1 me capture seedha `REDEEMED` karta hai; Phase 2 me wahi capture `PAID` par rukta hai. **Phase 2 par koi migration nahi lagegi** — sirf behaviour switch.

### 6.3 Preview response

Existing route `POST /vouchers/customer/voucher/preview` **wahin rahega** — app abhi usko call kar raha hai. Response purely **additive**:

```jsonc
{
  "voucher": {}, "version": {}, "outlet": {}, "brand": {},   // brand naya
  "billAmount": 1000, "offerApplied": true,
  "selectedOffer": {}, "eligibleOffers": [],

  "pricing": {},        // §4.1 ka poora block
  "orderSummary": { "rows": [], "payable": {}, "youSaved": 0, "savedText": "" },

  "promo": {
    "supported": true,
    "applied": { "code": "", "description": "", "discount": 0 },
    "provisional": false,   // guest ke liye true — §7 case 17
    "message": "Promo code WELCOME50 applied"
  },

  "canClaim": true,
  "blockedReason": null,
  "requiresLogin": false,
  "notices": []
}
```

`canClaim: false` hone par `blockedReason` hamesha ek **specific** vaakya hoga.

---

## 7. Edge cases

### Stage A — Preview

| # | Case | Behaviour |
|---:|---|---|
| 1 | voucherId invalid / not found / inactive / deleted | 400 / 404 |
| 2 | Koi PUBLISHED version nahi, ya window band | 400 |
| 3 | Outlet is version se linked nahi | 400 |
| 4 | Outlet inactive / deleted | 400 |
| 5 | Brand inactive / unapproved / hidden | `canClaim: false` + reason |
| 6 | Vendor plan expired | `allowWhenVendorPlanExpired` + `graceDays` ke hisaab se |
| 7 | Customer inactive / deleted | 403 (authed par hi) |
| 8 | **BrandAvoidance me daala hai** | **Koi asar nahi — claim kar sakta hai** |
| 9 | billAmount ≤ 0 / non-numeric | 400 |
| 10 | billAmount > `maxBillAmount` | 422 — cap batao |
| 11 | **Bill har offer ke minimum se neeche** | **Error nahi** — `totalPayable = billAmount`, `canClaim: true` |
| 12 | Bill offer ke neeche + promo bheja | Promo drop + notice |
| 13 | Offer ka apna window band | Us offer ko chhod do |
| 14 | Explicit `offerId` jo eligible nahi | 422 |
| 15 | ONCE_PER_USER pehle consume | `canClaim: false` |
| 16 | Promo ke saare rejection cases | Soft reject, har ek ka **apna** message |
| 17 | **Guest + promoCode** | Apply hoga, par `provisional: true` — `perCustomerUsageLimit`/`firstOrderOnly` bina login check ho hi nahi sakte |
| 18 | VENDOR audience ka code customer bhejta hai | "not valid" — vendor codes leak nahi hone chahiye |
| 19 | Promo discount netBill se zyada | Clamp |
| 20 | Fee slab misconfigured (≤ 0) | Fee 0, Infinity nahi |
| 21 | `chargeFeeWhenNoOffer: true` + discount 0 | Allow + notice |

### Stage B — Order creation

| # | Case | Behaviour |
|---:|---|---|
| 22 | Guest create-order | 401 |
| 23 | Saare preview gates dobara, `strictPromo: true` | Soft reject ab 422 |
| 24 | Guest ka provisional promo login ke baad fail | 422 with reason — silently full price **nahi** |
| 25 | `canClaim: false` | 403 + `blockedReason` |
| 26 | `totalPayable ≤ 0` | 422 |
| 27 | Same customer+voucher+outlet+bill, reuse window me | Wahi open order. **Reuse check slot-hold se pehle** |
| 28 | Reuse candidate ka `promoQuotedUntil` beeta | Naya order |
| 29 | Promo reservation race | 409, transaction `isDeleted`, promo released |
| 30 | Once-per-user slot race | Partial unique index par duplicate key → 409 |
| 31 | Razorpay down | 503, koi orphan Transaction nahi |
| 32 | Preview aur order ke beech version republish | Offer dobara resolve; gayab ho to 422 |
| 33 | Promo `costBearing` beech me badla | Claim par freeze hua snapshot chalega |
| 34 | **Insert par `invoiceId: null` collision** | §2.3 partial index — **iske bina doosra claim hi fail ho jaata** |

### Stage C — Verify & webhook

| # | Case | Behaviour |
|---:|---|---|
| 35 | Signature mismatch | 400 + `WebhookEvent: REJECTED` (§3.4 ke namespaced key ke saath) |
| 36 | **Rejected key ka genuine retry** | §3.4(a)+(b) — warna payment hamesha ke liye atak jaata |
| 37 | Customer webhook vendor endpoint par | Fallback secret se verify, process, + WARNING |
| 38 | Order mila par `gatewayAccount` match nahi | Settle mat karo — `FAILED` + alert |
| 39 | `payment.order_id` alag | 422 |
| 40 | Amount mismatch | 422 — frozen `amountInPaise` se |
| 41 | Payment captured nahi | 402, promo release, claim `FAILED`, slot free |
| 42 | **`payment.authorized` aaya, capture nahi hua** | Handle + N min baad alert — warna 5 din baad auto-refund |
| 43 | Double verify / replay | `verified:false` conditional claim |
| 44 | Verify aur webhook ek saath | Wahi conditional claim |
| 45 | **Ek order par do capture** | `alreadySettled` + alag paymentId → CRITICAL + auto-refund |
| 46 | Customer payment ka webhook | `purpose` router |
| 47 | Unknown order | `IGNORED` + reason |
| 48 | Settle capture ke baad throw | `FAILED` + CRITICAL + replay endpoint |
| 49 | Replay par account pata nahi | `WebhookEvent.account` |
| 50 | REJECTED row ka force-replay | **422** — unverified payload kabhi process nahi |
| 51 | Invoice PDF fail | Kabhi block nahi — snapshot freeze, lazy generation |
| 52 | Promo reservation payment se pehle sweep | `commitPromoCode` reconciliation |
| 53 | Payment aur settle ke beech version expire | Payment honour — paisa kat chuka hai |
| 54 | Settle ke waqt customer deleted | Honour, transaction par store contact se notify |
| 55 | `VoucherUsage` dobara likhne ki koshish | `voucherClaimId` unique — idempotent |
| 56 | No-offer claim ki VoucherUsage | Likhi jayegi — `offerApplied: false` |
| 57 | Browser aur webhook dono chhoot gaye | `reconcilePayments` job |
| 58 | **`payment.authorized` settler me chala gaya** | **Nahi — apna handler. §3.5.1. Warna har payment par promo release + CRITICAL alert** |
| 59 | Auto-capture band hai, payment authorized par atka | `alertStuckAuthorizations` job → CRITICAL. 5 din baad auto-refund se pehle |
| 60 | **Conditional claim ke baad crash** | **`settlementStage` + `resumeIncompleteSettlements` job — §3.7** |
| 61 | Dono dashboards par ek hi webhook secret | Account **route** se aata hai, secret se nahi — §3.5.2 |
| 62 | **`releaseStaleClaimHolds` ne slot chhoda, phir late capture aayi** | Neeche |
| 63 | Promo `appliesTo: CONVENIENCE_FEE`, discount fee se bada | Clamp `promoBase` par — §4.1 |
| 64 | `Idempotency-Key` do concurrent taps | Neeche |

#### Case 62 — stale sweep vs late capture

`releaseStaleClaimHolds` ek `PENDING` claim ko `CANCELLED` karke `holdsUsageSlot: false` kar deta hai. Par payment **uske baad** capture ho sakti hai (customer ne tab kholkar chhod diya tha, ya webhook late aaya). Tab tak doosri claim wo once-per-user slot le chuki ho sakti hai → settle ke andar `VoucherUsage` insert par `E11000` → settle **capture ke baad** fat jaata hai.

**Fix — sweep ke waqt hi decide karo, settle ke waqt nahi:**
1. Sweep `CANCELLED` karne se pehle Razorpay se payment status check kare (`getPaymentDetails`); captured mila to **cancel mat karo** — settle hone do
2. Aur settle me `VoucherUsage` ka insert `E11000` par **fail na ho**: agar wo slot kisi doosri claim ke paas hai to usage `isOncePerUser: false` + `slotConflict: true` ke saath likho, transaction ko settle hone do (paisa to kat chuka hai), aur admin ko WARNING — kyunki ye business decision hai, technical failure nahi

Paisa kabhi settle hone se nahi rukega. Slot ka conflict ek notice hai, ek crash nahi.

#### Case 64 — Idempotency-Key ki storage

Header lena kaafi nahi — **use store karna aur unique banana** padega, warna do concurrent taps dono reuse-window check paas kar ke do Razorpay order khol denge.

```js
// Transaction par
idempotencyKey: { type: String },
// index: { customerId: 1, idempotencyKey: 1 } unique, partial $type:string
```

Order banane se **pehle** row insert karne ki koshish karo — `E11000` mila matlab wahi request dobara aayi hai, to maujooda transaction lauta do. Key ka TTL `pendingOrderReuseMinutes` ke barabar.

---

## 8. Notifications

### 8.1 `notify()` me do changes

- **`customerId` support** — `resolveRecipient()` abhi sirf Brand → User dekhta hai. `customerId` aane par `Customer.email` / `whatsappNumber` / `mobile` pehle, phir User par fallback
- **Audience-aware toggles** — abhi toggles `getSubscriptionConfig()` (yaani **vendor** settings) se aate hain. `getNotificationConfig(audience)` banega jo `CUSTOMER` ke liye `Setting.customer.notification` padhe

### 8.2 Naye types

| Type | Kise | Sev | Vars | WhatsApp params | Tap par |
|---|---|---|---:|---|---|
| `VOUCHER_PAYMENT_SUCCESS` | Customer | INFO | 4 | brand · amount · invoice no · date | Download Invoice → `/invoice/<token>` |
| `VOUCHER_PAYMENT_FAILED` | Customer | WARNING | 3 | brand · amount · reason | voucher page |
| `VOUCHER_REFUNDED` | Customer | INFO | 3 | brand · amount · refund ref | transaction view |
| `VOUCHER_CLAIM_RECEIVED` | Vendor + outlet | INFO | 4 | voucher · outlet · amount · date | vendor panel |
| `VOUCHER_CLAIM_EXPIRED` (P2) | Customer | WARNING | 2 | brand · claim code | claim view |

Admin ke liye naya type nahi chahiye — `WEBHOOK_FAILED`, `PAYMENT_DISPUTED`, `PROMO_LIMIT_EXCEEDED` teeno purpose-agnostic hain.

> **Scale note:** ek brand par roz ~50+ claims aane par `VOUCHER_CLAIM_RECEIVED` ki barish ho jayegi. Tab isko per-outlet hourly digest banana hoga. Abhi banane ki zarurat nahi, par jaan lena zaroori hai.

### 8.3 Deep links

`panelLinks.js` me: `CUSTOMER_PATHS`, `PANEL_PATHS.transaction(id)`, `publicUrl()`. `PUBLIC_API_URL` set na ho to `publicUrl()` `undefined` deta hai aur button chup-chaap chhoot jaata hai — `vendorUrl()` ka hi pattern.

---

## 9. Invoice

### 9.1 `buildVoucherInvoiceSnapshot()`

Wahi `invoiceSnapshotSchema`, do naye blocks ke saath:
- `lineItems` — *Bill collected on behalf of \<Brand\>* aur (fee lagi ho to) *Convenience fee*
- `voucherBlock` — voucher name, versionCode, offer title, outlet storeId, claim code
- `brandBlock` — brand name, outlet address
- `kind: "VOUCHER_CLAIM"` — renderer ka branch key

> **GST off hone par header `PAYMENT RECEIPT` hoga, `TAX INVOICE` nahi**, aur tax block print hi nahi hoga. Zero GST ke saath "TAX INVOICE" chhapna galat hai.

> **⚠️ Renderer ko branch chahiye — audit finding.** `generateAndUploadInvoice.js` ka `renderInvoicePdf` poora subscription ke liye likha hai: *"Original Price"*, *"Discount"*, plan name + type + duration, `Validity: <start> to <end>`, `HSN/SAC`, aur `taxRows()` jo hamesha CGST/SGST ya IGST line chhaapta hai. Ek voucher claim ko usi se chala diya to invoice me plan naam khali, validity `- to -`, aur ₹0.00 ki tax rows chhapengi.
>
> `renderInvoicePdf` me `snapshot.kind` par branch lagegi. `SUBSCRIPTION` ka layout **bilkul jaisa hai waisa** rahega — usko chhedna nahi hai. `VOUCHER_CLAIM` ka apna layout: bill → offer discount → promo → convenience fee → (tax jab on ho) → paid, plus voucher/outlet/claim-code block.

### 9.2 Lazy PDF

Settle par sirf **`invoiceSnapshot` freeze + invoice number allot**. PDF **pehli download request par** banti hai. Har claim par render + Cloudinary upload scale par nahi chalega, aur zyadatar invoices kabhi download hi nahi hoti.

Invoice number phir bhi settle par hi allot hoga — series me gap nahi aana chahiye.

### 9.3 Download link

```
GET /trydood/v1/transactions/invoice/:token   — public, no JWT
// token = 32-byte random hex, unique partial index
// → 302 redirect to invoiceUrl
// → invoiceUrl missing ho to snapshot se generate, phir redirect

// WhatsApp template base:  {PUBLIC_API_URL}/trydood/v1/transactions/invoice/
// URLParam:                <token>
```

WhatsApp template ka URL button Meta se **base URL ke saath** approve hota hai — sirf aakhri segment dynamic. Cloudinary ka URL har invoice ke liye random hai, isliye wo dynamic segment ban hi nahi sakta.

---

## 10. Read APIs

| Endpoint | Gate | Scope |
|---|---|---|
| `GET /transactions/customer/get-all` | isCustomer | Sirf apni, `purpose: VOUCHER_CLAIM` |
| `GET /transactions/vendor/get-all` | isVendorOrAdmin | brand-scoped |
| `GET /transactions/admin/get-all` | isAdmin | Sab + purpose/account/status/date filters |
| `GET /transactions/get/:transactionId` | verifyJwtToken | Role-scoped — notification ka landing page |
| `GET /transactions/invoice/:token` | public | 302 → PDF |
| `POST /transactions/invoice/regenerate` | + isCustomer | Customer apni re-issue kar sake |
| `GET /voucher-claims/customer/get-all` | isCustomer | Claim history |
| `GET /voucher-claims/vendor/get-all` | isVendorOrAdmin | Brand ke claims |
| `GET /voucher-claims/admin/get-all` | isAdmin | Sab + filters |
| `GET /voucher-claims/get/:claimId` | verifyJwtToken | Role-scoped detail |
| `GET /voucher-claims/verify/:claimCode` | isVendor / isSubVendor | Outlet counter par read-only verification — **§10.1 padhein** |
| `GET /transactions/admin/health` | isAdmin | "Abhi kuch atka hua hai?" |

### 10.1 ⚠️ Phase 1 me counter par verify karne ka koi surface nahi hai

Outlet staff ke paas abhi **koi app ya panel nahi hai**. Yaani endpoint ban bhi jaye, use khologa kaun?

**Phase 1 ki asli haqeeqat:** customer apni phone screen dikhayega — bilkul jaise koi payment success screen dikhata hai. Isliye wo screen **dikhane ke liye** design honi chahiye, sirf padhne ke liye nahi:

| Claim success screen par | Kyun |
|---|---|
| **Claim code bada aur saaf** — `TD-8F3K2Q` | Counter par bolne/likhne layak |
| **Kitna pay hua** — bada | Ye sabse zaroori number hai |
| **Outlet ka naam + storeId** | Sahi outlet hai ya nahi |
| **Brand logo** | Pehchan |
| **Date + time, live chalta hua** | Purana screenshot dikhane par pakda jaye |
| Bill amount aur discount alag-alag | Vendor mila sake |

Ye ek **frontend spec item** hai — backend sab data pehle se de raha hai.

**Jokhim jo khula rehta hai:** screenshot banaya ja sakta hai. Live timestamp usse mushkil banata hai, par khatam nahi karta. **Phase 2 ka outlet redemption hi asli hal hai.**

#### Ek sasta beech ka raasta — naya app banaye bina

`SUB_VENDOR` role, `isSubVendor` gate, aur `SubBrand.userId` **teeno codebase me pehle se hain** — yaani **har outlet ka apna user account already hai.**

To bina koi naya app banaye:

1. Outlet staff ko unka `SUB_VENDOR` login do
2. Vendor panel ka **verify screen mobile browser me khulne layak** bana do — ek input box, claim code daalo, result dikhe
3. Bas. Koi app, koi install, koi play-store nahi

Endpoint (`GET /voucher-claims/verify/:claimCode`) **Phase 1C me hi ban jayega** — wo sasta hai aur baad me outlet app usi ko call karega. Bas uska frontend Phase 1 me vendor panel ka ek page hai, alag app nahi.

> **Aapka call:** ye page Phase 1 me banwana hai ya customer ki screen se hi kaam chalana hai. Backend dono me ek jaisa hai.

`assertTransactionAccess(actor, transaction)`: ADMIN sab; VENDOR/SUB_VENDOR ko `brandId` match; CUSTOMER ko `customerId` match; warna 403.

Har listing `pagination()` + `buildAggregateLookup()` se — manual `$skip`/`$lookup` repo ke **Never** list me hai.

**Detail response me:** voucher details, brand + outlet details, offer snapshot, poora pricing breakdown, promo code + discount + kaun bhara, payment method, Razorpay order + payment id, `gatewayAccount`, date/time, invoice number + download link, claim status, aur history timeline.

**`/admin/health`:** captured par settle nahi · failed webhooks jo replay nahi hue · REJECTED webhook rows · khule disputes deadline ke hisaab se · ledger drift · stuck settlements.

---

## 11. Endpoints

| Method | Path | Gate | Phase |
|---|---|---|---|
| POST | `/vouchers/customer/voucher/preview` | optionalAuth | 1A (extend) |
| POST | `/voucher-claims/create-order` | isCustomer | 1B |
| POST | `/voucher-claims/verify` | isCustomer | 1B |
| POST | `/transactions/webhook/razorpay` | public (HMAC · VENDOR) | 0 (router) |
| POST | `/transactions/webhook/razorpay/customer` | public (HMAC · CUSTOMER) | 0 (new) |
| GET | `/voucher-claims` | verifyJwtToken | ✅ 1C-C |
| GET | `/voucher-claims/payments` | verifyJwtToken | ✅ 1C-C |
| GET | `/voucher-claims/payments/:transactionId` | verifyJwtToken | ✅ 1C-D |
| GET | `/voucher-claims/:claimId` | verifyJwtToken | ✅ 1C-F |
| GET | `/voucher-claims/code/:claimCode` | verifyJwtToken | ✅ 1C-F |
| GET | `/transactions/invoice/:token` | public | ✅ 1B-M6 |
| GET | `/transactions/admin/health` | isAdmin | 1C-I |
| POST | `/voucher-claims/redeem` | isVendor (outlet-bound) | **Phase 2** |
| POST | `/voucher-claims/:claimId/un-redeem` | isVendor (owner) / isAdmin | **Phase 2** |

> **Yahan plan se hataa gaya (1C, 30 Aug 2026).** Upar ki suchi me pehle har audience ke
> liye **alag** endpoint tha — `customer/get-all`, `vendor/get-all`, `admin/get-all`, aur
> `transactions/...` ke teen aur. Bane **ek-ek**, teen shapes:
>
> - Scope aur projection dono token se nikalte hain (`buildAccessScopeFilter`,
>   `claimProjection(role)`), isliye ek hi URL par customer, vendor, outlet aur admin
>   apna-apna jawab paate hain
> - Teen endpoint ka matlab tha **teen jagah ye yaad rakhna** ki vendor ko `gatewayFee`,
>   `netReceived`, `platformPromoCost`, `email`, `contact` nahi dikhne chahiye. Ek jagah
>   bhool = leak, aur wo listing me nahi, detail page par milta hai — jise koi jaanchta nahi
> - Isi wajah se `claimProjection` / `claimRecordProjection` ek hi source hain, listing aur
>   detail dono ke liye. `__tests__/money/claimDetail.test.js` ismein service ka **asli
>   output** jaanchti hai, projection ko projection se nahi milati
>
> Path bhi badle: `get/:claimId` → `/:claimId`, `verify/:claimCode` → `/code/:claimCode`.

---

## 12. Admin config — `Setting.customer`

Har value ka fallback `constants/customer.js` me, aur padhi sirf `getCustomerConfig()` se.

| Path | Default | Kya |
|---|---|---|
| `convenienceFee.isEnabled` | `true` | Fee lagegi ya nahi |
| `convenienceFee.slabSize / feePerSlab / maxFee` | `500 / 5 / 50` | Slab formula |
| `convenienceFee.chargeWhenNoOffer` | `false` | Offer na lage to fee |
| `tax.isGstEnabled` | **`false`** | Master switch |
| `tax.gstPercentage` | `18` | Rate |
| `tax.isGstInclusive` | **`true`** | Fee ke andar tax |
| `tax.sacCode` | `998599` | Invoice par |
| `promoCode.isEnabled` | `false` | Customer promo master switch |
| `promoCode.allowWhenNoOffer` | `false` | Offer na lage to promo |
| `promoCode.allowForGuestPreview` | `true` | Guest ko provisional promo |
| `claim.isEnabled` | `true` | Kill switch |
| `claim.allowWhenNoOffer` | **`true`** | Offer na lage to bhi seedha pay |
| `claim.maxBillAmount` | `100000` | Absurd input par cap |
| `claim.pendingOrderReuseMinutes` | `10` | Khula order dobara |
| `claim.quoteTtlMinutes` | `30` | = promo reservation TTL |
| `claim.allowWhenVendorPlanExpired` | `false` | Expired plan par bechna |
| `claim.vendorPlanExpiredGraceDays` | `0` | "Recently expired" |
| `claim.redemptionWindowHours` | `24` | Phase 2 |
| `notification.isEmail / isPush / isWhatsApp` | `true / true / false` | Customer channels |
| `invoice.seriesPrefix` | `VCH` | `TD/VCH/25-26/000123` |
| `currency` / `currencySymbol` | `INR` / `₹` | **Read-only** — `getCustomerConfig()` project karta hai. Admin-configurable nahi; yahan isliye hai taaki customer-facing string na vendor config me haath daale na `₹` hardcode kare (G7) |

Seller identity (company name, GSTIN, address, state) `Setting.vendor.subscription.company*` se hi aayegi — legal entity ek hi hai.

### ⚠️ 12.1 `Setting.customer` API se pahunch me hai hi nahi — abhi mila

`Setting` model me `customer.convenienceFee` **maujood hai**, par:

- `validator/settings.js` me sirf `vendor` object hai — koi `customer` branch nahi
- `services/settings/updateSetting.js` sirf `payload.vendor.voucher`, `.showcase`, `.subscription` merge karta hai — **`customer` ko chhuta hi nahi**

Yaani **aaj `convenienceFee` bhi admin panel se set nahi ho sakta**, aur is design ki har config value (tax, promo, claim, refund, settlement, notification, invoice) bhi unreachable hogi — sirf schema defaults chalenge.

**Phase 0 me ye zaroori hai:**

1. `validator/settings.js` me poora `customer` object — har sub-block, har field, apne `.messages()` ke saath
2. `updateSetting.js` me `customer` ki merge branches — `vendor.subscription` wala hi pattern (merge, replace nahi), taaki admin sirf `feePerSlab` PATCH kar sake bina baaki sab reset kiye
3. **Merge ke baad, save se pehle** `assertSettlementTimingRule(merged.customer)` — settlement doc §10. Ye Joi ka kaam nahi hai, kyunki rule do alag blocks ko jodkar dekhta hai
4. Admin panel me ye saare fields — warna API bana kar bhi koi use nahi karega

> **`maxFee` par dhyan:** default `null` tha — yaani koi ceiling nahi, aur ₹10,000 ke bill par ₹100 fee lag jaati. **Ab default `50` hai**, schema aur `constants/customer.js` dono me. `null` abhi bhi accept hota hai aur abhi bhi "no ceiling" hi matlab rakhta hai, par ab wo jaan-boojh kar chunna padta hai.
>
> Isi wajah se `getCustomerConfig()` sirf `maxFee` ko `?? ` se nahi, **explicit `undefined` check** se padhta hai. `null ?? 50` → `50` hota hai, to `??` us admin ke faisle ko chup-chaap palat deta jisne ceiling hataana chuna tha. Baaki har field `??` se hi padhti hai, kyunki wahan `0` aur `false` legit values hain.

### ✅ 12.2 M8 me kya bana — verified

`Setting.customer` ke **nau block** ab reachable hain: `convenienceFee`, `tax`, `promoCode`, `claim`, `notification`, `invoice`, `settlement`, `refund`, `chargeback`.

- `constants/customer.js` — har block ke defaults + `SETTLEMENT_CYCLE_TYPES` / `PAYOUT_PROVIDERS` / `REFUND_METHODS` / `VENDOR_TIMEOUT_ACTIONS` enums
- `models/Setting.js` — nau sub-schema, defaults constants se hi aate hain (do jagah likhe hue number kabhi disagree na karein)
- `validator/settings.js` — poora `customer` object, har enum apne `.messages()` ke saath
- `services/settings/updateSetting.js` — per-block merge + **nested block merge**
- `helpers/settings/assertSettlementTimingRule.js` — golden rule, merged doc par
- `helpers/settings/getCustomerConfig.js` — sab kuch project karta hai, `currency` / `currencySymbol` sameत

**Do bug live DB par pakde gaye, dono fix:**

1. **Nested `reserve` wipe ho raha tha.** `Object.assign` Mongoose sub-document par nested path ko poora replace karta hai, to `{ settlement: { reserve: { percent: 15 } } }` bhejne par `holdDays` 45 → 30 aur `riskChargebackCount` 3 → 2 par reset ho gaye. Pehla fix bhi kaam nahi kiya kyunki wo parent assign ke **baad** chal raha tha — ab nested block parent assign se **pehle** alag kiya jaata hai.
2. **`maxFee` ka `??`** — upar wali baat. Ek admin jo ceiling hataana chahta, use chup-chaap 50 mil jaata.

61 assertion pass, 0 fail — validator shape, golden rule dono directions me, merge semantics, persistence, aur fresh-doc defaults.

---

## 13. Security

- **Amount kabhi client se nahi.** Client sirf `billAmount` (+ optional `offerId`, `promoCode`) bhejta hai
- **`billAmount` cap** — wo ek input hai jo server verify nahi kar sakta. Asli verification Phase 2 ka outlet confirmation
- **Promo audience isolation** — vendor code customer se aur ulta, dono 422
- **Verify sirf apna** — customer sirf apni transaction verify kare
- **Account binding** — har account-sensitive call `transaction.gatewayAccount` se
- **Webhook** — raw body par HMAC, multi-secret, timing-safe. REJECTED payload kabhi replay nahi
- **Invoice token** — 32-byte random, sequential invoice number kabhi URL me nahi
- **Rate limiting** — reuse window + khule `PENDING` claims par cap
- **Idempotency-Key** — `create-order` par, taaki app ka retry do order na banaye

---

## 14. Phases

### Phase 0 — Foundation + bugs + dono accounts
*Customer feature ke bina bhi shippable*

- `Transaction` — `purpose`, `gatewayAccount`, `customerId`, `voucher` sub-doc, `invoiceToken`, `settlementHold`, `settlementStage`, `idempotencyKey`, `authorizedAt`, `razorpaySettlementId`, `fundsReceivedAt`, gateway-fee fields
- **§2.3 ka partial-unique index fix** + **§2.5 ka teen-step deploy order**
- `buildTransactionFilter()`
- Razorpay account layer — `getRazorpayAccount()`, rotation-safe multi-secret verify, do webhook routes + **account route se** (§3.5.2), `WebhookEvent.account` + `REJECTED` + `claimedEventId`, **§3.4 ka poora fix**, `logPaymentAccounts()`
- Webhook `purpose` router + account cross-check + **`payment.authorized` ka apna handler** (§3.5.1) + double-capture guard
- `generateInvoiceNumber()` Counter-based + `istDate.js` helper
- `VoucherUsage` redesign + purana index drop
- `PromoCode.audience` (+ **`$ne: CUSTOMER` filter dono taraf**) + `costBearing` + promo helpers generalize + report me `audience`
- `optionalAuth` · `Setting.customer` model · `constants/customer.js`
- **`validator/settings.js` + `updateSetting.js` me `customer` branch** (§12.1) — warna koi bhi config value set hi nahi ho sakti
- **`JobLock` + job health + boot config check** (§14.5) — multi-instance par chalane se pehle zaroori
- ✅ **Migration script — `scripts/migrateCustomerClaimFoundation.js`** (§2.6.1, idempotent): naye indexes → verify → purane **naam se** drop · `purpose` + `gatewayAccount` + `settlementStage` backfill · `audience` backfill (`$exists: false` par) · `VoucherUsage` index drop · `Setting.customer` seed

**Files:** `models/Transaction.js` · `VoucherUsage.js` · `PromoCode.js` · `PromoCodeUsage.js` · `WebhookEvent.js` · `Setting.js` · `constants/transaction.js` · `customer.js` · `promoCode.js` · `webhook.js` · `configs/razorpay.js` · `middlewares/verifyJwtToken.js` (`optionalAuth` wahin se export hota hai — alag file nahi bani) · `helpers/transactions/*` · `helpers/promoCodes/*` · `helpers/common/istDate.js` · `services/transactions/handleRazorpayWebhook.js` · `routes/transactions.js` · `scripts/migrations/*`

### Phase 1A — Preview
- `calculateVoucherPricing()` — §4.1, saare config flags
- `buildVoucherOrderSummary()`
- `validateCustomerPromoCode()` + shared `assertPromoWindowAndCaps()` + `costBearing` split
- `buildClaimPreview()` — preview aur order dono ka **ek** builder, `strictPromo` ke saath
- `previewCustomerVoucher` rewrite; route par `optionalAuth`; response additive

### Phase 1B — Payment
- `VoucherClaim` + `VoucherClaimHistory`, `constants/voucherClaim.js`
- `createVoucherClaimOrder()` — Idempotency-Key, reuse check pehle, phir slot hold, promo reserve, Razorpay order + explicit `payment_capture` + trace notes
- `settleVoucherClaimPayment()` — `settleSubscriptionPayment` ka mirror
- `verifyVoucherClaimPayment()` + webhook branch usi settler par
- `buildVoucherInvoiceSnapshot()` + lazy PDF + receipt/tax-invoice branch
- **`LedgerEntry` entries** incl. `GATEWAY_FEE` (sibling doc §S0 — Phase 1B ke saath hi jaana chahiye)
- `settlementStage` + `resume: true` path (§3.7)
- `notify()` customer support + `getNotificationConfig(audience)` + `voucherClaimNotices.js` + naye types + panelLinks
- Jobs: `releaseStaleClaimHolds` (capture-check ke saath) · `reconcilePayments` · `resumeIncompleteSettlements` · `alertStuckAuthorizations`

### Phase 1C — Read
- Transaction + claim listings — customer / vendor / admin
- `assertTransactionAccess()` + role-scoped detail
- `GET /transactions/invoice/:token` (lazy PDF yahin) + regenerate customer ke liye
- `GET /voucher-claims/verify/:claimCode` — outlet counter
- `GET /transactions/admin/health`

---

## 14.5 Operational — jo shipping se pehle chahiye

Poora design **jobs par tika hai**: `reconcilePayments`, `resumeIncompleteSettlements`, `releaseStaleClaimHolds`, `reconcileLedger`, `buildSettlements`. Ye safety nets hain — aur safety net tabhi kaam karta hai jab wo sach me chal raha ho.

### 14.5.1 ⚠️ Multi-instance par har job har instance me chalega

`jobs/index.js` in-process `setInterval` hai. Do instance (PM2 cluster, ya do dyno) matlab **har job dono me chalega** — aur boot par to `await runJob(job)` turant chalta hai.

Zyadatar jobs idempotent hain isliye nuksaan nahi hoga, par:
- `buildSettlements` ko `idempotencyKey` bachata hai — **sirf tab jab `periodEnd` canonical ho** (settlement doc §3.3)
- Baaki jobs bekaar me do baar Razorpay API hit karenge aur ek doosre se race karenge

**Fix — ek chhota `JobLock`. ✅ M9 me ban gaya.**

```js
// models/JobLock.js — _id hi job ka naam hai, ek row per job
{
  _id: String,
  lockedBy: String,          // hostname:pid:boot-token
  lockedAt: Date,
  expiresAt: Date,           // lease — comparison, TTL index NAHI (neeche)
  lastRunAt, lastSuccessfulRunAt, lastFailedAt: Date,
  lastDurationMs, lastResult, lastError, consecutiveFailures,
  intervalMinutes, lockedOutCount,
}
```

`jobs/index.js` ke maujooda `inFlight` Set ka hi DB version — wahi soch, bas process ke bahar. `runJob()` pehle `inFlight` dekhta hai (sasta), fir lock leta hai.

**Design ke teen faisle jo likhne layak hain:**

**1. TTL index nahi lagaya, jaan-boojh kar.** Upar wala original design `lockedAt` par TTL kehta tha taaki stale lock apne aap chhoot jaye. Par TTL **poora document delete** karta hai — aur usi document par `lastSuccessfulRunAt` hai, jo is poori exercise ka asli maqsad hai. Har lapsed lease par health history mit jaati. Zarurat bhi nahi: acquire `expiresAt: { $lte: now }` par match karta hai, to expired lock pehle se hi available hai. **Expiry ek comparison hai, lifecycle nahi.**

**2. Duplicate-key error hi "kisi aur ke paas hai" ka signal hai.** `findOneAndUpdate(filter, update, { upsert: true })` ke teen case hain, aur teesra samajhne layak hai:

| Case | Kya hota hai |
|---|---|
| Row hai hi nahi | Filter match nahi karta → upsert insert karta hai → lock mila |
| Row hai, lease expire | Filter match karta hai → takeover → lock mila |
| **Row hai, lease zinda** | Filter match nahi karta **aur** upsert `_id` insert karne jaata hai jo pehle se hai → **11000** |

Wo 11000 failure nahi, jawab hai. Catch karke clean miss report hota hai. Poori cheez ek atomic operation hai, to ek hi millisecond me boot hue do instance dono jeet nahi sakte.

**3. Heartbeat, taaki lease chhoti rah sake.** Bina heartbeat ke lease itni lambi rakhni padti jitni sabse dheemi run ho sakti hai — aur wahi lambai fir ye tay karti ki *crash* hua instance us job ko kitni der block karega. Chalta hua job har 5 min apni lease aage badha deta hai (`lockedBy` par scoped, taaki lapsed process apne replacement ki lock na badha de), to lease 15 min rah sakti hai aur sirf **mara hua** instance apni lock khota hai.

**Live DB par verify hua (42 assertion):** fresh acquire, zinda foreign lease par miss, expired foreign lease par takeover, heartbeat renewal, lock kho dene ke baad renew ka refuse, release ke baad turant re-acquire, failure streak aur uska reset, 500-char error truncation, aur paanchon health status.

**Do process ka asli test:** ek process ne chaaron lock foreign instance ban kar hold kiye, fir app boot hui — chaaron job ne `🔒 held by another instance, skipping` diya aur schedule phir bhi ho gaye. Locks chhodne ke baad normal boot par chaaron chale aur `lastSuccessfulRunAt` + `lastResult` likh gaye.

### 14.5.2 Job health monitoring

Abhi agar `ENABLE_JOBS=false` chhoot gaya, ya process ghanton down raha, to **koi nahi batayega**. Safety nets chup-chaap band rahenge aur pata tab chalega jab paisa atak chuka hoga.

- ✅ Har job apna `lastSuccessfulRunAt` likhta hai (`JobLock` par hi)
- ✅ `helpers/jobs/getJobHealth.js` — har job ka status, `jobs/index.js` se `getJobsHealth()` ke through
- ⏳ `GET /transactions/admin/health` — endpoint Phase 1C me hai (§14.4). Helper ready hai, bas mount karna hai

**Staleness har job ke *apne* interval ke multiple me naapi jaati hai**, absolute minute me nahi — 15-minute sweep aur 3-ghante ka reminder dono apni raftaar par healthy hain, aur fixed threshold ya to ek par bekaar shor machata ya doosre ko kabhi na pakadta.

| Status | Kab |
|---|---|
| `OK` | Aakhri success 2× interval ke andar |
| `STALE` | ≥ 2× interval — do run miss |
| `CRITICAL` | ≥ 3× interval — kuch galat hai, dheema nahi |
| `NEVER_RUN` | Registered hai par ek bhi run poori nahi hui |
| `DISABLED` | Is instance par `ENABLE_JOBS=false` |

Do baatein jaan-boojh kar aisi hain:

- **`lastSuccessfulRunAt` padha jaata hai, `lastRunAt` nahi.** Har tick par throw karne wala job lagatar *chal* raha hai aur kaam kabhi nahi kar raha; sirf success timestamp dono me farq batata hai. `consecutiveFailures` isi liye alag se rakha gaya.
- **Ek job ka CRITICAL poore runner ko CRITICAL karta hai.** Ye safety net hain, aur aadha kaam karta safety net wahi cheez hai jo nazar se chhoot jaati hai.

Aur `DISABLED` kabhi `OK` ki tarah report nahi hota — `ENABLE_JOBS=false` chhoot jaana is poore section ki asli wajah hai.

### 14.5.3 Boot par config check

`logChannelStatus()` ka hi pattern — `logPaymentAccounts()` me ye bhi:

✅ **Ban gaya.** Asli boot output:

```
✅ [pay] VENDOR    test · rzp_test_TKV… · 1 webhook secret(s)
⚪ [pay] CUSTOMER  test · rzp_test_jkS… · NO webhook secret — deliveries will be rejected
⚪ [pay] PUBLIC_API_URL  not set — invoice links and WhatsApp buttons will be omitted
✅ [jobs] 4 registered · lock: enabled · instance Mahadev-PC:7440:37503fc4
```

`ENABLE_JOBS=false` par uski jagah:

```
⏸️  [jobs] DISABLED via ENABLE_JOBS=false — no sweeps, no reconciliation, no reminders on this instance
```

Aur boot par ek self-check bhi chalta hai: koi job apne interval se 3× zyada purana ho, ya lagatar 3 baar fail hua ho, to `⚠️` line deploy log me dikh jaati hai — *"was this instance down?"*

`PUBLIC_API_URL` set na hone par link chup-chaap गायब ho jaata hai — wo graceful degradation hai, par boot par ek line me dikh jaana chahiye.

### 14.5.4 Automated tests — sirf money paths ke liye

`CLAUDE.md` kehta hai is repo me koi test runner nahi hai, aur wo convention baaki repo par bani rahegi. **Par yahi ek jagah hai jahan use modna chahiye.**

Wajah: ye design ~15 aisi jagah par tika hai jo **concurrency** par nirbhar hain — atomic claims, partial unique indexes, conditional transitions, idempotency keys, resume paths. **Ye click karke test ho hi nahi sakte.** Ye kam baar hote hain aur mehnge hote hain — theek wo class jo manual QA kabhi nahi pakadti aur jo production me hi dikhti hai.

**Setup — chhota aur alag-thalag. ✅ M11 me ban gaya.**

```
package.json   →  "test": "jest --runInBand"   (naya script, baaki kuch nahi chhua)
devDeps        →  jest  (sirf jest)
__tests__/money/   ←  sirf yahi folder. Baaki repo par koi asar nahi
```

### ⚠️ `mongodb-memory-server` nahi liya — machine par naapne ke baad

Original plan me `mongodb-memory-server` tha. Is machine par naap kar reject kiya:

| | Naapa gaya |
|---|---|
| Free RAM | **0.5 GB / 7.4 GB** (pehle se swap ho rahi thi) |
| Free disk | 9.1 GB — jisme **6.94 GB sirf npm cache** tha |

`mongod` WiredTiger cache default me `max(256MB, aadhi (RAM − 1GB))` reserve karta hai — yahan **~3.2 GB**. Aur jest har core par ek worker fork karta hai, yaani ek nahi, kai mongod. Install khud bhi is machine par `MemoryError` se mar sakta tha.

**Iski jagah: asli cluster par ek alag database** — `Trydood2_test`, `MONGO_URL` se derive hoke. Repo me ye pattern pehle se hai (`Trydood2_postman`).

Trade-off imaandari se: tests dheeme hain (har op ek network round trip), cluster reachable chahiye, aur CI me bina credentials ke nahi chalenge. **Jo nahi khota wo fidelity hai** — yahan test hone wali har guarantee (atomic `findOneAndUpdate`, partial unique index, `$inc` under contention) **server-side** enforce hoti hai, to ek hi process se do operation race karana server par ab bhi race hi karta hai. Latency badalti hai ki test kitna lamba chalega, ye nahi ki wo kya sabit karta hai.

Sab kuch ek hi `__tests__/money/setup/testDb.js` ke peeche hai, to kabhi in-memory par jaana ek file ka badlav rahega.

### 🔒 Guard — ye tests documents delete karte hain

`testDb.js` connect karne se **mana** kar deta hai, aur `clearCollections` chalne se mana karta hai, jab tak **live connection ka database name** `_test` par khatam na ho. Name derive karke bharosa nahi kiya jaata — connection se **wapas padha** jaata hai, warna `toTestUri` ka bug apna hi guard band kar deta.

Asli DB par sabit kiya:

```
connected to: Trydood2
✅ guard refused: Refusing to clear collections on "Trydood2".
transactions still there: 49 (was 49)
```

URI `URL` se parse hota hai, regex se nahi — Atlas password me `/` aur `@` aam hain, aur jo regex ek credential par sahi lagta hai wo doosre me galat slash pakad leta hai. Iska apna test file hai (`testDbGuard.test.js`), jo network chhuta hi nahi.

### Nateeja

```
Test Suites: 5 passed, 5 total
Tests:       7 todo, 39 passed, 46 total
```

| File | Kya |
|---|---|
| `indexes.test.js` | Test 1, 4, 15 — partial unique indexes, once-per-user race, idempotency key |
| `webhook.test.js` | Test 2, 3, 6 — rejected-retry, dedupe race, `payment.authorized` |
| `promoAudience.test.js` | Test 7, 8, 9 — legacy code, audience isolation, discount clamp |
| `testDbGuard.test.js` | Guard khud |
| `pending.test.js` | Test 5, 10–14 `it.todo` ke roop me — har run par output me dikhte hain |

**Do baat jo test likhte waqt pakdi gayi:**

1. **`NODE_ENV=production` shell me set tha**, jisse npm `omit=dev` kar deta hai. `npm i -D jest` ne `package.json` me entry likh di, "up to date" bola, aur jest kabhi install hua hi nahi. `NODE_ENV=development npm install --include=dev` se laga.

2. **Char webhook test pehle *galat wajah* se pass ho rahe the.** Wo sirf `statusCode: 400` assert kar rahe the — aur "no webhook secret configured" bhi 400 hai. Env var ka naam galat tha (`RAZORPAY_VENDOR_WEBHOOK_SECRETS`, jabki asli `RAZORPAY_WEBHOOK_SECRETS` hai), to signature verify hone tak baat pahunchti hi nahi thi. Ab har rejection apni **wajah** bhi assert karti hai.

> **Ab karna hi sabse sasta hai:** production launch nahi hua, DB fresh hai, koi user nahi. Tests pehle likhne par har phase ka kaam pehle din se verify hota rahega — baad me retrofit karna hamesha mehnga hota hai.

**Pehla set — 15 tests, ek-ek finding par:**

| # | Test | Expect | Kis finding se |
|---:|---|---|---|
| 1 | Do concurrent claims, ONCE_PER_USER voucher | Ek jeete, doosre ko 409 | §7 case 30 |
| 2 | Verify aur webhook ek saath | Ek settle kare, doosra `alreadySettled` | §7 case 44 |
| 3 | **REJECTED webhook, phir sahi signature se retry** | **Settle ho — `DUPLICATE` nahi** | §3.4 |
| 4 | Doosra claim create-order | `E11000` **na** aaye | §2.3 |
| 5 | Settle ke beech process kill | `resumeIncompleteSettlements` complete kare | §3.7 |
| 6 | `payment.authorized` aaye | Promo release **na** ho, CRITICAL alert **na** jaye | §3.5.1 |
| 7 | Purana promo code (bina `audience` field) | Vendor checkout par chale | §5.4 |
| 8 | Customer code vendor checkout par | 422 | §7 case 18 |
| 9 | Promo `appliesTo: CONVENIENCE_FEE`, fee se bada | `promoBase` par clamp | §4.1 |
| 10 | Do partial refunds | `amountRefunded` cumulative (`$max`) | settlement §6.4 |
| 11 | Refund reject | `settlementHold` **hate** | settlement §5.3 |
| 12 | Settlement CANCELLED | Rows agle cycle me **wapas aayein** | settlement §3.5 |
| 13 | Claim ke baad dispute, phir approve | Approve **ruk jaye** (`needsRevalidation`) | settlement §3.6 |
| 14 | `dispute.lost` aaye | Row settlement-eligible **na** bane | settlement §3.6 |
| 15 | Same `Idempotency-Key` do baar | Ek hi transaction | §7 case 64 |

Har phase apne tests ke saath aayega. Phase 0 me 1–8, S1 me 10–11, S2 me 12–14.

---

## 15. Future plan

### 15.1 Phase 2 — outlet redemption (QR / code scan)

Ye **outlet ke paas kuch hone par hi** ho sakta hai. Isliye ise teen chhote step me toda gaya hai — har step apne aap me useful hai, aur agla step pichhle par khada hai.

#### Step 1 — Vendor panel me verify page *(sabse sasta, koi app nahi)*

- `SUB_VENDOR` login pehle se maujood hai (§10.1)
- Vendor panel ka ek mobile-friendly page: claim code daalo → kitna pay hua, kaunsa offer, kab, kaunsa outlet
- **Read-only** — kuch badalta nahi
- ✅ **Ban gaya (1C-F).** Path `GET /voucher-claims/code/:claimCode` hai, `verify/...` nahi —
  wahi service `GET /voucher-claims/:claimId` ko bhi chalati hai, to ek hi access rule
  dono par lagta hai. Route file me `/code/:claimCode` **`/:claimId` se upar** likha hai,
  warna parameter use nigal leta (`claimId = "code"` → 422 sahi code par)

#### Step 2 — Outlet app (ya PWA) + QR

- Customer ki screen par **QR** aa jaata hai (claim code hi encode hota hai)
- Outlet app camera se scan kare — code type karne ki zarurat nahi
- Abhi bhi read-only. Bas tez aur galti-rahit
- PWA se bhi ho sakta hai — native app zaroori nahi

#### Step 3 — Asli redemption *(schema abhi se taiyar)*

Yahan behaviour switch hota hai. **Koi migration nahi lagegi:**

- Settle par `REDEEMED` ki jagah `PAID`, `expiresAt` set
- `POST /voucher-claims/redeem` — outlet confirm kare
- `VoucherUsage` ka write payment se hat kar **redemption par**
- `expireVoucherClaims` job + expiry notification
- **Redeem par outlet asli bill confirm karega** — `billAmount` ka asli verification yahi hai
- Redemption record chargeback evidence ka **sabse mazboot hissa** ban jaata hai

#### Step 3 ka asli jaal — dobara scan aur ulta karna

Scan akela mat bhejiye. Akela scan wahi phansane wali sthiti banata hai:

> Customer ne pay kiya. Staff ne scan kiya. Scan "chala nahi" — customer ko saamaan
> mila hi nahi. Ab wo dobara maangta hai aur system kehta hai *"already redeemed"*.
> Paisa gaya, saamaan nahi mila, aur nikalne ka koi raasta nahi.

Iska hal **"dobara redeem karne do" nahi hai.** Wo khola to ek payment se teen outlet
par teen discount mil jaayenge — nuksaan vendor ka, aur `holdsUsageSlot` / once-per-user
lock ka koi matlab nahi bachta.

Asli baat ye hai ki *"scan chala nahi"* **do alag cheezein** hain, aur unke hal alag hain:

| Kya hua | Kaisa dikhta hai | Hal |
|---|---|---|
| Network fail, staff ko pata nahi chala | Wahi outlet, wahi user, kuch second baad dobara scan | **Wording ki samasya, security ki nahi.** Server dekh sakta hai ki dusra scan usi outlet se usi banda ne abhi kiya tha → jawab *"Ho chuka hai, 12:04 par, aapke hi counter se"* — laal error nahi |
| Customer ko sach me saamaan nahi mila | Kuch der baad, ya manager ke paas shikayat | **Reversal chahiye** — vendor owner / admin un-redeem kare, append-only history me darj ho |
| Wahi code dusre outlet par | Alag `subBrandId` | **Yahi asli double-redemption hai.** Block, aur audit row |

Teeno ek hi endpoint par alag jawab dete hain, isliye response me sirf "already redeemed"
kaafi nahi — `redeemedAt`, `outlet`, aur `by` bhi jaana chahiye, warna staff teeno case me
ek jaisa laal box dekhega.

**Reversal ke niyam:**

- `POST /voucher-claims/:claimId/un-redeem` — `isVendor` (owner) ya `isAdmin`. `SUB_VENDOR` nahi:
  jisne galti ki wahi use chhupa sake, ye control ka matlab hi khatam kar deta hai
- `reason` **required** — free text, `CLAIM_HISTORY_ACTION` me ek nayi `REDEMPTION_REVERSED` row
- `REDEEMED → PAID` waapas, `redeemedAt`/`redeemedBy` clear, `VoucherUsage` waapas
- Ek time limit — settlement ke baad reversal nahi (paisa ja chuka), `settlementHold` dekhna hoga

**Redemption us outlet se bandha hai jo claim par likha hai** (tay kiya 30 Aug 2026).
Brand-level `VENDOR` account bhi dusre outlet ka claim redeem nahi kar sakta. Wajah
accounting hai, access nahi: settlement outlet-wise hota hai, to dusre outlet par redeem
ka matlab paisa outlet A ko settle ho aur saamaan outlet B ne diya. Per-outlet report
jhoot bolne lagti hai. `SUB_VENDOR` par ye pehle se lagu hai (`assertClaimAccess`),
`VENDOR` par bhi wahi niyam lagana hoga — `assertClaimAccess` VENDOR ko poore brand par
paas karta hai, isliye redeem ke waqt outlet match **alag se** dekhna padega
- **Rate ke saath dikhna chahiye:** jo vendor din me 50 baar reverse kare wo admin health
  page par upar aana chahiye. Isiliye history append-only hai

⚠️ **Teeno ek saath jaayenge, warna Step 3 mat kijiye.** Sirf scan deploy karna customer ko
phansata hai; sirf reversal bina scan ke bekaar hai.

**Config se control:**

```js
claim.redemptionMode: "AUTO"          // Phase 1 — capture par REDEEMED
                    | "OUTLET_SCAN"   // Step 3 — outlet confirm ke baad
claim.requireRedemptionWhenPromoApplied: false   // beech ka raasta — settlement doc §12.5
```

> **Beech ka ek smart raasta:** poore Step 3 par jaane se pehle, `requireRedemptionWhenPromoApplied: true` kar dijiye. Tab **sirf promo wale claims** outlet confirmation maangte hain — aur wahi hissa hai jo exploit ho sakta hai (settlement doc §12.5). Baaki 95% claims tez rehte hain.

### 15.2 Notification digest

Ek brand par roz ~50+ claims aane par `VOUCHER_CLAIM_RECEIVED` per-outlet hourly digest banega ("pichhle ghante 12 claims"). Ya vendor ko preference milegi.

### 15.3 Counter batching

`Counter` doc par har claim ka `$inc` — sustained ~1000+ claims/second par hot document banega. Realistic volume par koi dikkat nahi. Tab har process 100 numbers ka block reserve karega.

### 15.4 Archival

`purpose` ek clean split key hai. Volume bahut badhne par purani voucher rows `transactions_archive` me ja sakti hain ya purpose par shard ho sakti hain — API shape badle bina.

---

## 16. Bache hue sawaal

| # | Sawaal | Default |
|---:|---|---|
| 1 | Vendor-borne promo par vendor ki haan kaise aayegi? | Admin seedha configure karega; consent flow future doc me — sibling doc §12 |
| 2 | `PUBLIC_API_URL` ki value | Endpoint Phase 1C me ban jayega; URL set na ho to button chhoot jaata hai |

---

## Appendix — audit findings jo is doc me lagu hue

Audit ne **51 findings** nikaleen. 17 par doosri raay mil payi (13 confirmed, 4 refuted); baaki 34 ki verification session limit se ruk gayi, isliye wo **haath se judge ki gayi** codebase ke khilaf. Duplicates hatane ke baad claim side par ye lagu hue:

### Verified (adversarially confirmed)

| # | Finding | Sev | Kahan |
|---:|---|---|---|
| A1 | REJECTED WebhookEvent eventId dedupe ko poison karta hai — genuine retry `DUPLICATE` ban kar nigal jaata hai | CRITICAL | §3.4 |
| A2 | `invoiceId` / `razorpayOrderId` unique par sparse nahi — doosre claim par `E11000` | CRITICAL | §2.3 |
| A3 | Din aur FY boundary host timezone me | HIGH | §5.5 |
| A4 | `refund.created` / `refund.failed` handled list me nahi | HIGH | §3.5 |

### Haath se judge ki gayi (verification chhoot gayi thi)

| # | Finding | Sev | Kahan |
|---:|---|---|---|
| A5 | **`payment.authorized` ko settler me bhejna har payment todta hai** — not-captured branch promo release karke CRITICAL alert deta | CRITICAL | §3.5.1 |
| A6 | **Razorpay net settle karta hai — MDR + GST kahin model hi nahi** | CRITICAL | §4.1 |
| A7 | **Conditional claim ke baad crash row ko permanently aadha-settled chhod deta hai** | CRITICAL | §3.7 |
| A8 | **`audience` ka Mongoose default purani rows par lagta hi nahi** — har live promo code mar jaata | CRITICAL | §5.4 |
| A9 | `autoIndex` on hai — index-options change chup-chaap fail hota hai; deploy order chahiye | HIGH | §2.5 |
| A10 | `promoDiscount` apne `appliesTo` base par clamp nahi hota | HIGH | §4.1 |
| A11 | Invoice renderer subscription ke fields chhaapega — voucher par khali plan aur ₹0 tax rows | HIGH | §9.1 |
| A12 | `releaseStaleClaimHolds` vs late capture — settle ke andar `E11000` | HIGH | §7 case 62 |
| A13 | `Idempotency-Key` ki koi storage/uniqueness nahi | MEDIUM | §7 case 64 |
| A14 | Account agar secret se derive hua to same-secret par galat lookup | HIGH | §3.5.2 |
| A15 | `validatePromoCode` me audience filter dono taraf chahiye | MEDIUM | §5.4 |
| A16 | `purpose`/`gatewayAccount` required karne se deploy ke waqt in-flight orders strand | HIGH | §2.5 |

Baaki findings settlement side ki hain — [vendor_settlement_plan.md](./vendor_settlement_plan.md) ka appendix dekhein.

**Refute huyi 4 claims** (inpar kaam nahi ho raha): period-bounded claim query · `vendorPayable > captured` · `settlementHold` under Route · `refund.failed` ka stranding scenario.
