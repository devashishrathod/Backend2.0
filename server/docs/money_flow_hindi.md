# Paisa ka Pura Flow — Voucher Claim se Vendor Payout tak

> **Ye doc kya hai:** customer ke voucher select karne se lekar vendor ke bank me
> paisa pahunchne tak ka **complete flow**, code ke base par — har step, har API,
> har use case, aur har edge case.
>
> **Base URL:** sab API `/trydood/v1` ke neeche mounted hain
> (`index.js:125` → `app.use("/trydood/v1", allRoutes)`).
>
> **Kis code se bana:** `services/voucherClaims/`, `services/settlements/`,
> `services/refunds/`, `helpers/ledger/`, `helpers/settlements/`, `jobs/index.js`,
> `constants/settlement.js`, `constants/refund.js`, `constants/voucherClaim.js`.

---

## Index

| # | Phase | Kya hota hai |
|---|---|---|
| [0](#phase-0--setup-flow-shuru-hone-se-pehle) | Setup | Vendor ka voucher publish + bank verify |
| [1](#phase-1--customer-voucher-dhundhta-hai) | Discovery | Customer voucher browse / detail dekhta hai |
| [2](#phase-2--price-dekhna-preview) | Preview | Bill daal ke price dekhta hai (paisa nahi lagta) |
| [3](#phase-3--claim-banana--razorpay-order-khulna) | Order | Claim + Transaction + Razorpay order |
| [4](#phase-4--payment-aur-capture) | Capture | Customer pay karta hai, claim REDEEMED hota hai |
| [5](#phase-5--ledger--paisa-kiske-khaate-me-gaya) | Ledger | Har rupaya kis account me gaya |
| [6](#phase-6--razorpay-se-humare-bank-me-paisa) | Funds | Razorpay ka paisa humare bank me aata hai |
| [7](#phase-7--settlement-build-nightly-job) | Settlement | Din ka settlement banta hai |
| [8](#phase-8--admin-approval) | Approval | Admin sign-off karta hai |
| [9](#phase-9--payout--vendor-ke-bank-me-paisa) | Payout | NEFT + UTR + PAID |
| [10](#phase-10--payout-history-statement-aur-documents) | History | Statement, invoice, payout history |
| [11](#phase-11--refund-ka-pura-flow) | Refund | Customer se lekar paisa wapas jane tak |
| [12](#phase-12--refund-ka-settlement-par-asar-clawback) | Clawback | Refund settlement se kaise kata |
| [13](#phase-13--dispute--chargeback) | Dispute | Bank chargeback aur recovery |
| [14](#phase-14--reserve-hold-aur-release) | Reserve | Risky vendor ka paisa rokna |
| [15](#phase-15--vendor-debt-aur-write-off) | Debt | Jab vendor humara udhaar rakh de |
| [16](#background-jobs--jo-apne-aap-chalte-hain) | Jobs | Background safety nets |
| [17](#status-machines--ek-jagah-par) | States | Sare status diagrams |
| [18](#complete-api-index) | API | Poori API list ek table me |
| [19](#end-to-end-numeric-example) | Example | ₹1000 ke bill ka pura hisaab |
| [20](#kya-hoga-agar--edge-case-table) | Edge cases | "Agar aisa ho jaye to kya hoga" |

---

## Ek nazar me — pura flow

```
CUSTOMER SIDE                     PLATFORM                       VENDOR SIDE
─────────────                     ────────                       ───────────

Voucher dekha
     │
     ▼
Bill amount daala
POST /vouchers/customer/voucher/preview
     │  (sirf price dikhta hai, kuch save nahi hota)
     ▼
"Pay" dabaya
POST /voucher-claims/create-order ───► VoucherClaim (PENDING)
     │                                 Transaction  (CREATED)
     │                                 Razorpay order khula
     ▼
Razorpay checkout me pay kiya
     │
     ├──► POST /voucher-claims/verify   (browser callback)
     └──► POST /transactions/webhook/razorpay/customer  (webhook)
              │
              │   dono ek saath aate hain — ek jeetta hai
              ▼
        settleVoucherClaimPayment()
              │
              ├─► VoucherClaim → REDEEMED
              ├─► VoucherUsage row
              ├─► Promo commit
              ├─► LedgerEntry × 6                    ───► Vendor ko ₹785 owed
              ├─► Invoice number (TD/INV/...)
              └─► Notifications (customer + vendor)
                        │
                        ▼
              Razorpay T+2 me humare bank me paisa bhejta hai
              webhook: settlement.processed
              → Transaction.fundsReceivedAt set
                        │
                        ▼
              JOB: buildSettlements (har ghante chalta hai)
              → Settlement banta hai (DRAFT → PENDING_APPROVAL)
                        │
                        ▼
              ADMIN: PATCH /settlements/admin/:id/approve  → APPROVED
              ADMIN: PATCH /settlements/admin/:id/pay      → PROCESSING + PayoutLeg
              ADMIN: haath se NEFT karta hai
              ADMIN: PATCH /settlements/admin/:id/confirm  → PAID
                        │                                        │
                        └─► LedgerEntry PAYOUT                   ▼
                        └─► Payout statement (TD/STL/...)   Vendor ke bank me paisa
                        └─► Vendor ko notification
```

---

## Kirdaar aur collections

Pehle ye samajh lo ki kaunsi cheez kis collection me likhi jaati hai — poora flow
inhi ke beech ghoomta hai.

| Collection | Kya rakhta hai | Kyun alag hai |
|---|---|---|
| `VoucherClaim` | Customer ka record — "maine ye voucher claim kiya" | Ye wo cheez hai jo customer apni order history me kholta hai aur support me quote karta hai |
| `Transaction` | Paisa ka record — Razorpay order/payment | Ek hi collection me subscription aur claim dono hain, isliye har query me `purpose` filter lagta hai |
| `VoucherUsage` | Redemption ledger — "ye offer use ho gaya" | Once-per-user rule aur reporting isi se chalti hai |
| `VoucherClaimHistory` | Append-only timeline | "Is claim ka kya hua?" — customer, vendor, admin teeno yahi dekhte hain |
| `LedgerEntry` | Double-entry books | **Sach yahi hai.** Baaki sab cache hai |
| `RefundRequest` | Ek refund request ka poora safar | Ek payment par kai refund ho sakte hain |
| `Settlement` | Ek brand ka ek period ka payout | `settlementNumber` = document of record |
| `PayoutLeg` | Ek actual bank transfer (NEFT) | Ek settlement kai legs me ja sakta hai |
| `SettlementHistory` | Settlement ka status trail | "Ye payout late kyun tha?" |
| `Dispute` | Bank chargeback | Ek payment par do dispute bhi ho sakte hain |

**Ek line me:** `VoucherClaim` customer ki nazar hai, `Transaction` paise ki nazar
hai, `LedgerEntry` accountant ki nazar hai, aur `Settlement` vendor ki nazar hai.

---

## PHASE 0 — Setup (flow shuru hone se pehle)

Ye phase customer ke aane se pehle ka hai, par iske bina aage kuch nahi hota.

### 0.1 Vendor ka voucher live hona

| Step | API | Kaun | Kya hota hai |
|---|---|---|---|
| Voucher banana | `POST /vouchers/create` | Vendor | Draft `Voucher` + pehla `VoucherVersion` |
| Review me bhejna | `POST /vouchers/submit-review/:voucherId` | Vendor | Version admin ke paas jata hai |
| Admin review | `POST /vouchers/review/:versionId` | Admin | Approve / reject |
| Publish | `POST /vouchers/publish/:versionId` | Admin | Ab customer ko dikhega |

**Zaroori baat:** claim hamesha ek **version** par banta hai, voucher par nahi
(`VoucherClaim.voucherVersionId`). Vendor kal offer badal de, to purana claim
purane version par hi rahega.

### 0.2 Vendor ka bank account verify hona

`models/Bank.js` ek **CGPEY penny-drop verification record** hai — matlab row hone
ka matlab ye nahi ki account sahi hai. `bank.isVerified` hona zaroori hai.

**Ye kyun matter karta hai:** `buildSettlements.js:676` (`freezeBankSnapshot`) sirf
`isVerified: true` wale account ka snapshot leta hai. Bina verified bank ke:

- Settlement **phir bhi banta hai** (paisa to vendor ka hai hi)
- Par `approveSettlement.js:77` 422 deta hai:
  *"This brand has no verified bank account. Ask them to add one, then rebuild this settlement."*

> **Customer/vendor ko kya dikhta hai:** vendor ko payout nahi aata, aur admin
> panel par settlement `PENDING_APPROVAL` par atka rehta hai. Fix: vendor bank
> add kare → verify ho → admin `rebuild` kare.

---

## PHASE 1 — Customer voucher dhundhta hai

### 1.1 Voucher list

**API:** `GET /trydood/v1/vouchers/customer/get-all`
**Auth:** optional — guest bhi dekh sakta hai
**Service:** `services/vouchers/getCustomerVouchers.js`

**Use case:** customer app kholta hai, usse aas-paas ke / category ke voucher
dikhte hain.

### 1.2 Ek voucher ka detail

**API:** `GET /trydood/v1/vouchers/customer/get/:voucherId`
**Auth:** optional
**Service:** `services/vouchers/getCustomerSingleVoucher.js`

**Use case:** customer ek voucher par tap karta hai — usse offers, outlets aur
terms dikhte hain.

**Yahan customer sirf dekhta hai — abhi tak database me kuch nahi likha gaya.**

---

## PHASE 2 — Price dekhna (preview)

### 2.1 Preview API

**API:** `POST /trydood/v1/vouchers/customer/voucher/preview`
**Auth:** optional (guest ko bhi price milta hai)
**Service:** `services/vouchers/previewCustomerVoucher.js` → `helpers/vouchers/buildClaimPreview.js`

**Body:**
```json
{
  "voucherId": "...",
  "outletId": "...",
  "billAmount": 1000,
  "offerId": "...",        // optional — na do to system best offer chunta hai
  "promoCode": "SAVE50"    // optional
}
```

**Kya wapas aata hai:** poora `pricing` block + `orderSummary` + `canClaim` +
`blockedReason`.

**Use case:** customer counter par khada hai, bill ₹1000 ka hai, wo app me amount
daalta hai aur dekhta hai ki usse kitna dena padega.

### 2.2 Price kaise banta hai — `calculateVoucherPricing`

Ye function **poore system me ekmatra jagah hai jahan claim ka price decide hota
hai** (`helpers/vouchers/calculateVoucherPricing.js`). Ye **pure** hai — na DB,
na config lookup, na clock. Sab kuch andar pass hota hai.

```
netBill        = billAmount − offerDiscount
convenienceFee = ceil(billAmount / slabSize) × feePerSlab      ← ORIGINAL bill par
promoDiscount  = apne base tak clamp (netBill ya fee)
taxOnTop       = GST, sirf fee par, aur sirf jab GST on ho
totalPayable   = netBill − promoDiscount + convenienceFee + taxOnTop
vendorPayable  = netBill − vendorPromoCost − commissionDeduction
youSaved       = offerDiscount + promoDiscount
```

**Teen design decisions jo samajhne zaroori hain:**

1. **Fee original bill par lagti hai, discounted par nahi.**
   Agar fee discounted amount par lagti to har offer badalne par fee badalti —
   customer ko arbitrary lagta, aur offer comparison list me har row ki apni fee
   honi padti.

2. **GST sirf humari fee par lagti hai, khane par nahi.**
   `netBill` vendor ki supply hai — unka apna tax matter. Hum khana nahi bech
   rahe. Default me GST **off** hai (`CUSTOMER_TAX_DEFAULTS.isGstEnabled: false`).

3. **Koi offer apply na ho to fee bhi nahi lagti** (default).
   `chargeWhenNoOffer: false` — warna customer ko Trydood ke bina jitna dena
   padta, usse **zyada** dena padta. Wo bekaar hai.

### 2.3 Convenience fee slabs (default)

| Bill | Fee |
|---:|---:|
| 1 – 500 | ₹5 |
| 501 – 1000 | ₹10 |
| 1001 – 1500 | ₹15 |
| 1501 – 2000 | ₹20 |

`slabSize: 500`, `feePerSlab: 5`, `maxFee: 50` (ceiling — warna ₹10,000 ke bill
par ₹100 fee lag jati).

### 2.4 Preview par promo "soft" reject hota hai

Preview me galat promo code par error nahi aata — verdict return hota hai taaki
page inline dikha sake *"ye code is bill par nahi lagta"*. **Order banate waqt
wahi cheez 422 ban jaati hai** (`strictPromo: true`).

> **Kyun:** customer ne price dekh liya aur Pay daba diya. Ab usse full price
> charge karna, jabki wo samajh raha hai ki code laga hai — acceptable nahi hai.

---

## PHASE 3 — Claim banana + Razorpay order khulna

### 3.1 API

**API:** `POST /trydood/v1/voucher-claims/create-order`
**Auth:** `isCustomer` — **guest ko order nahi milta** (guest ko sirf price milta hai)
**Header:** `Idempotency-Key: <uuid>` (strongly recommended)
**Service:** `services/voucherClaims/createVoucherClaimOrder.js`

**Body:** preview jaisa hi —
```json
{
  "voucherId": "...",
  "outletId": "...",
  "billAmount": 1000,
  "offerId": "...",
  "promoCode": "SAVE50"
}
```

**Response:**
```json
{
  "claim":       { "id": "...", "claimCode": "TD-8F3K2Q", "status": "PENDING" },
  "transaction": { "id": "...", "status": "created" },
  "pricing":     { "...poora 39-field block..." },
  "razorpay":    { "orderId": "order_...", "amount": 76000, "currency": "INR", "keyId": "rzp_..." },
  "reused":      false
}
```

### 3.2 Andar kya hota hai — **order of operations hi design hai**

Har step do baar reach ho sakta hai (double tap, retry, do browser tab), aur unka
**kram** decide karta hai ki customer ka paisa safe hai ya nahi.

```
1. price it            preview wala hi builder, strictPromo: true
2. idempotency key     sabse PEHLE insert — koi bhi external cheez se pehle
3. reuse window        purana khula order wapas do, doosra mat kholo
4. claim + slot hold   once-per-user lock — database leta hai, code nahi
5. transaction row     idempotency key ke saath
6. promo reservation   atomic, taaki limited code oversell na ho
7. Razorpay order      SABSE AAKHIR ME — kyunki isi ka undo nahi hai
```

**Do sabse important baatein:**

- **Idempotency key Razorpay call se pehle daalti hai, baad me nahi.**
  Header lekar check kar lena kaafi nahi hai — do concurrent tap dono read-then-write
  check pass kar jate hain, dono Razorpay order khol dete hain, aur customer ko
  ek bill ke liye **do payment sheet** dikhte hain. Key insert karna hi wo cheez
  hai jo doosre tap ko harati hai — **unique index decide karta hai, timing nahi.**

- **Razorpay sabse aakhir me call hota hai** kyunki wahi ek step hai jiska undo
  nahi hai. Usse pehle kuch bhi fail ho to sirf humare database me kuch bacha,
  bahar kuch nahi.

### 3.3 Once-per-user slot — asli lock database me hai

```js
// models/VoucherClaim.js:176
voucherClaimSchema.index(
  { voucherId: 1, customerId: 1, offerId: 1 },
  { unique: true, partialFilterExpression: { holdsUsageSlot: true } },
);
```

- **Per offer, per voucher nahi.** Ek voucher me kai offers hote hain — 20%-off
  use karne se free-dessert wala offer khatam nahi hota.
- `holdsUsageSlot: true` scope karta hai, isliye failed/refunded claim index se
  nikal jata hai aur slot free ho jata hai — **row delete kiye bina**. History
  bachi rehti hai.
- Slot **claim bante hi** hold hota hai, payment ke baad nahi. Payment ka wait
  karna matlab wo exact window chhod dena jiski race ko zaroorat hai: do checkout
  khule, dono kuch hold nahi kar rahe, dono allowed.

**Duplicate key par customer ko:**
> *"You already have a claim in progress for this offer. Finish or cancel it first."* (409)

### 3.4 Reuse window — page refresh par doosra order nahi khulta

`config.claim.pendingOrderReuseMinutes` ke andar agar same customer + voucher +
outlet + billAmount + offer par ek `PENDING` claim pada hai, to wahi order wapas
mil jata hai (`reused: true`).

**Ye slot hold se PEHLE check hota hai** — warna customer apne hi purane attempt
ke slot se takra jata.

**Ek exception:** agar promo quote expire ho chuka hai (`promoQuotedUntil` beet
gaya), to purana order wapas nahi milta. Uske peeche ki reservation sweep ho
chuki ho sakti hai, aur expired discount chupke se honour karna matlab wo paisa
dena jiska ledger me koi record nahi.

### 3.5 Snapshots — join nahi, copy

Claim par 5 snapshot freeze hote hain:

| Field | Kya copy hota hai | Kyun |
|---|---|---|
| `offerSnapshot` | Poora offer | Voucher republish ho sakta hai |
| `voucherSnapshot` | name, category | Voucher rename ho sakta hai |
| `brandSnapshot` | brand name | Brand rename ho sakta hai |
| `outletSnapshot` | uniqueId, storeId, state | Outlet band ho sakta hai |
| `customerSnapshot` | name, number, email | Customer apna naam badal sakta hai |

> **September ka claim March me bhi wahi padhna chahiye.** Isliye invoice aur
> report ye snapshots padhte hain, live record kabhi nahi.

### 3.6 Rollback — agar beech me kuch fail ho gaya

Claim ban chuka hai aur wo ek slot hold kar raha hai. Agar transaction ya Razorpay
step fail ho:

```js
// createVoucherClaimOrder.js:365
const rollback = async (note) => {
  await VoucherClaim.updateOne({ _id: claim._id }, { $set: {
    status: CANCELLED, holdsUsageSlot: false, cancelledAt: new Date(),
    cancelReason: note, isDeleted: true,
  }});
};
```

Promo reservation bhi release hoti hai. **Order discount ke bina bekaar hai, aur
slot order ke bina bekaar hai — dono undo hote hain.**

### 3.7 Safety catch — redemption mode

Function ka **pehla statement** hi ye hai:

```js
if (!isImplementedRedemptionMode(DEFAULT_REDEMPTION_MODE)) {
  throwError(503, "Voucher claims are temporarily unavailable. Please try again later.");
}
```

**Kyun:** agar `DEFAULT_REDEMPTION_MODE` aisa mode ho jise code `REDEEMED` tak le
hi nahi ja sakta, to sahi jawab hai **claim banao hi mat**. Warna: claim banta
hai, customer pay karta hai, capture usse `PAID` par park kar deta hai, aur usse
aage badhane ke liye kuch exist hi nahi karta — **paisa le liya, error kahin
nahi.**

---

## PHASE 4 — Payment aur capture

Customer Razorpay checkout me pay karta hai. Ab **do raaste ek saath** aate hain:

```
Browser callback ──┐
                   ├──► settleVoucherClaimPayment()  ← ek hi implementation
Razorpay webhook ──┘
```

### 4.1 Browser callback

**API:** `POST /trydood/v1/voucher-claims/verify`
**Auth:** `isCustomer`
**Service:** `services/voucherClaims/verifyVoucherClaimPayment.js`

**Body:**
```json
{
  "razorpayOrderId": "order_...",
  "razorpayPaymentId": "pay_...",
  "razorpaySignature": "...",
  "transactionId": "..."
}
```

**Signature ke alawa ye 3 cheezein bhi check hoti hain** — kyunki valid signature
sirf ye sabit karta hai ki Razorpay ne ye payment banaya, ye nahi ki:

1. **Order match karta hai** — `payment.order_id` humare order se. Warna kisi
   doosre payment ka signature utha kar is claim ko settle kiya ja sakta tha.
2. **Account transaction se padha jata hai**, hardcode nahi.
   Do alag Razorpay merchant hain (customer aur vendor), aur galat secret matlab
   signature kabhi match nahi karega — paisa capture ho chuka hoga tab.
3. **Ownership customer par check hoti hai**, user par nahi.
   Ek user par do customer record ho sakte hain; `userId` check karna matlab
   doosre ka payment settle karne dena.

**Amount bhi check hota hai:**
```js
if (expectedPaise && payment.amount !== expectedPaise) {
  throwError(422, "The amount paid does not match this claim. Please contact support.");
}
```
Iske bina ek genuine ₹1 ka payment yahan present karke ₹760 ka claim settle
kiya ja sakta tha.

### 4.2 Webhook

**API:** `POST /trydood/v1/transactions/webhook/razorpay/customer`
**Auth:** Razorpay signature (no JWT)
**Service:** `services/transactions/handleRazorpayWebhook.js`

Events jo handle hote hain:

| Event | Kya hota hai |
|---|---|
| `payment.captured` / `order.paid` | Claim settle hota hai |
| `payment.authorized` | Alert (paisa hold me hai, kisi ka nahi) |
| `payment.failed` | Claim `FAILED`, slot release |
| `refund.created` / `refund.processed` / `refund.failed` | Refund lifecycle |
| `settlement.processed` | `fundsReceivedAt` set hota hai (Phase 6) |
| `payment.dispute.*` | Dispute lifecycle (Phase 13) |

### 4.3 Dono race karte hain — by design

Browser callback aur webhook normally **milliseconds ke andar** aate hain. Shared
settlement transaction ko ek conditional update se claim karta hai:

```js
// helpers/voucherClaims/settleVoucherClaimPayment.js:181
claimed = await Transaction.findOneAndUpdate(
  { _id: transaction._id, verified: false },   // ← ye filter hi lock hai
  { $set: { ...mapPayment(payment), verified: true, settlementStage: CLAIMED } },
  { returnDocument: "after" },
);
```

Exactly ek jeetta hai. Doosre ko `alreadySettled: true` milta hai — aur wo bhi
**success hai**, error nahi.

### 4.4 Settlement stages — crash se bachne ka tareeka

Wo conditional claim **terminal** hai — usme dobara ghusa nahi ja sakta. Aur uske
baad 5 dependent writes hain. Beech me process mar jaye (deploy, OOM, Mongo blip)
to transaction `verified: true` hoga aur kaam aadha — **paisa liya, claim ab bhi
PENDING, vendor ko credit nahi, aur kahin kuch bolta nahi.**

Isliye har step **idempotent** hai aur `settlementStage` batata hai kitna hua:

```
CLAIMED   → conditional claim laga
RECORDED  → claim redeemed, usage row, promo commit, ledger post
INVOICED  → invoice number mil gaya
COMPLETE  → notifications gaye
```

`resumeIncompleteSettlements` job (har 15 min) `verified: true` par jo `COMPLETE`
nahi hai, use dhundh kar `resume: true` ke saath dobara chalati hai. **Resume ko
ye jaanne ki zaroorat nahi ki kahan ruka tha** — sab dobara chalta hai, aur jo ho
chuka wo no-op ban jata hai.

### 4.5 Settle ke andar kya-kya hota hai

| # | Kaam | Idempotent kaise |
|---|---|---|
| 1 | `VoucherUsage` row | Pehle `findOne` se check |
| 2 | Claim → `REDEEMED` (Phase 1) ya `PAID` (Phase 2) | Update `status: PENDING` par conditional |
| 3 | Promo commit | `commitPromoCode` apne aap idempotent |
| 4 | 8 ledger entries | Unique index par |
| 5 | Invoice number + snapshot | `invoiceId: { $exists: false }` par conditional |
| 6 | Notifications (customer + vendor) | `dedupeKey` par |
| 7 | `VoucherClaimHistory` row | Append-only |

### 4.6 Phase 1 vs Phase 2 — `REDEEMED` ya `PAID`

```js
const paidStatus = claim.redemptionMode === AUTO ? REDEEMED : PAID;
```

- **Phase 1 (aaj):** counter par pay karna hi redemption hai → seedha `REDEEMED`
- **Phase 2 (aage):** capture `PAID` par rukega aur outlet ke scan ka intezaar karega

Mode **claim par freeze** hai, aaj ke constant se nahi padha jata — isliye Phase 2
flip hone ke baad bhi purane claim usi tareeke se khatam honge jaise shuru hue the.
**Ye behaviour switch hai, migration nahi.**

### 4.7 Invoice — number abhi, PDF baad me

**Sirf number aur snapshot** settle ke waqt banta hai. **PDF pehli download
request par render hota hai.**

> **Kyun:** har claim par PDF render + upload karna scale par nahi chalta, aur
> zyadatar invoice kabhi khule hi nahi jate. Par **number** abhi hi allot hota hai
> kyunki invoice series me gap nahi hona chahiye — lazily allot karte to invoice
> download hone ke kram me number milte, issue hone ke kram me nahi.

**Agar document fail ho jaye:** throw nahi hota (warna customer ko 500 milta ek
aise claim par jo actually kaamyaab tha — usse laga payment fail hua aur kuch
customer **dobara pay kar dete hain**). Instead: admin ko alert, aur stage aage
nahi badhta — sweep dobara try karta rahega.

### 4.8 Payment fail ho gaya to

```
releasePromoCode()  →  Claim: PENDING → FAILED, holdsUsageSlot: false
                    →  History row (PAYMENT_FAILED)
                    →  notifyClaimFailed()  ← customer ko batate hain
                    →  402 with Razorpay ka reason
```

> **Customer ka experience:** usse hum batate hain ki payment nahi hua. Warna wo
> missing receipt se khud andaza lagata, aur zyadatar log dobara pay kar dete hain.

### 4.9 Double capture — jab do baar paisa kat jaye

Razorpay ek order par ek se zyada attempt allow karta hai. To "kisi aur ne settle
kar diya" hamesha **same payment** nahi hota — genuinely **doosra capture** ho
sakta hai.

```js
await detectDoubleCapture({ transaction: settled, payment });
```

Ye admin tak pahunchta hai. Chupchap drop nahi hota.

### 4.10 Slot conflict — paisa kat gaya par slot kisi aur ke paas hai

Stale-claim sweep ek `PENDING` claim cancel karke uska slot release kar sakti hai,
aur payment uske **baad** capture ho sakta hai — tab tak wo once-per-user slot koi
aur claim le chuka ho.

**Paisa ja chuka hai, isliye settle karne se mana karna matlab customer ko charge
karke kuch na dena.** To:

- `VoucherUsage` row **slot ke bina** likhi jati hai (`isOncePerUser: false`, `slotConflict: true`)
- Admin ko WARNING notification jaata hai, do link ke saath (claim + transaction)
- Decision admin ka: refund karna hai ya nahi

> Ye **business conflict** hai, technical failure nahi.

---

## PHASE 5 — Ledger — paisa kiske khaate me gaya

### 5.1 Ledger kyun hai

Iske bina "is vendor ka kitna bakaya hai?" ek aggregation ban jata hai
`transactions` par, aur har naya case usme ek aur clause jodta hai: refund,
partial refund, chargeback, chargeback jeeta hua, adjustment, reserve. 6 mahine
baad **query hi bug ban jaati hai** — koi nahi bata sakta ki missing clause
galti hai ya jaan-boojh kar chhoda gaya hai.

Ledger ke saath jawab ek index par sum hai: vendor ka balance = uske
`VENDOR_PAYABLE` rows ka total. **Koi condition nahi, koi bhoola hua clause nahi.**

### 5.2 Do hard rules

1. **Ledger row kabhi update nahi hoti, kabhi delete nahi hoti.**
   Galti sudharne ka tareeka hai ulta entry likhna `reversalOf` ke saath.
   Row edit karna matlab us waqt kya maana ja raha tha uska ekmatra record mita
   dena — jo ledger rakhne ka poora maqsad hi hai.

2. **Ledger sach hai; baaki sab cache hai.**
   `Settlement.netPayable`, `Transaction.isPaidToVendor` — ye sab convenience
   hain. Jab ledger se disagree karein, **ledger sahi hai aur doosra bug hai.**

### 5.3 Char accounts

| Account | Kya rakhta hai |
|---|---|
| `VENDOR_PAYABLE` | Kisi brand ka humara upar bakaya (sirf yahi brand-scoped hai) |
| `PLATFORM_REVENUE` | Trydood ne kya kamaya — convenience fee, commission |
| `PLATFORM_COST` | Trydood ne kya kharcha kiya — promo ka apna hissa, gateway fee |
| `TAX_PAYABLE` | GST jo aage government ko deni hai |

### 5.4 Capture par kaunsi rows banti hain

`helpers/ledger/postCaptureEntries.js` — ₹1000 bill, 20% offer, ₹50 promo (30/70
split), ₹10 fee ka example:

| Entry | Account | Direction | Amount |
|---|---|---|---:|
| `COLLECTION` | VENDOR_PAYABLE | CREDIT | +800.00 |
| `VENDOR_PROMO_SHARE` | VENDOR_PAYABLE | DEBIT | −15.00 |
| `CONVENIENCE_FEE` | PLATFORM_REVENUE | CREDIT | +10.00 |
| `PLATFORM_PROMO_COST` | PLATFORM_COST | DEBIT | −35.00 |
| `GATEWAY_FEE` | PLATFORM_COST | DEBIT | −17.94 |
| `TAX_COLLECTED` | TAX_PAYABLE | CREDIT | +0.00 *(GST off)* |
| `COMMISSION` | PLATFORM_REVENUE | CREDIT | +0.00 *(rate 0)* |
| `VENDOR_COMMISSION` | VENDOR_PAYABLE | DEBIT | −0.00 *(rate 0)* |

**Zero-amount entries skip ho jati hain** — promo na ho to 8 me se 3 rows banti
hain, 8 me se 5 khali nahi.

### 5.5 Gateway fee — wo row jo pehle missing thi

**Razorpay net settle karta hai:** ₹760 ka payment humare bank me lagbhag ₹742
aata hai. Vendor ko gross `netBill` par pay kiya jata hai. Is row ke bina wo
farak **chupchap platform ke margin se** jata tha aur kisi report me nahi dikhta
tha.

```js
fee: (payment.fee ?? 0) / 100,   // ← total, jisme tax ANDAR hai
tax: (payment.tax ?? 0) / 100,
```
> ⚠️ `payment.fee` me `payment.tax` **pehle se shamil hai** — ye do alag fees
> nahi hain. Dono jodna matlab deduction overstate karna aur har reconciliation
> ka short pad jana.

### 5.6 `VENDOR_COMMISSION` — wo row jo books band karti hai

`COMMISSION` credit karta hai jo hum kamate hain. Kuch bhi debit nahi karta tha jo
hum ab vendor ko **nahi** dete — to `VENDOR_PAYABLE` me poora `netBill` pada
rehta tha jabki payout sirf `netPayable` debit karta tha (jisme se `computeTotals`
commission pehle hi nikal chuka hota).

**Farak kabhi clear nahi hota tha:** 10% rate par har ₹1,000 ki sale par ₹100 ka
phantom liability, hamesha ke liye badhta hua, aur `getVendorBalance` vendor ko
wo paisa dikhata jo kabhi unka tha hi nahi.

### 5.7 Idempotency — indexes

| Index | Kya rokta hai |
|---|---|
| `ledger_type_transaction_unique` | Ek entry type per transaction (capture rows) |
| `ledger_type_refund_unique` | Ek entry type per refund (ek payment do baar refund ho sakta hai) |
| `ledger_type_dispute_unique` | Ek entry type per dispute (ek payment par do dispute ho sakte hain) |
| `ledger_type_payoutleg_unique` | Ek entry type per payout leg (ek settlement kai NEFT me ja sakta hai) |
| `ledger_reversalof_unique` | Ek correction per entry |

---

## PHASE 6 — Razorpay se humare bank me paisa

**Ye wo phase hai jise log sabse zyada miss karte hain.**

### 6.1 `verifiedAt` ≠ paisa humara hai

`verifiedAt` kehta hai **customer ne pay kiya**. Ye nahi kehta ki paisa humare
paas hai. Razorpay use apne cycle (default T+2) ke liye rokta hai, fir batch humare
bank me settle karta hai. **Un do moments ke beech paisa sirf dashboard par exist
karta hai.**

`verifiedAt` se T+N nikalna ek **andaza** hai ki gateway tab tak settle kar chuka
hoga. Ye zyadatar sahi hota hai — aur jab galat hota hai, tab sabse bura waqt hota
hai:

- Razorpay ne account review par settlement suspend kar diya
- Bank holiday par batch ruk gaya
- Kisi payment par KYC flag lag gaya

**Aise me vendor ko pay karna matlab apna float khud fund karna — bina decide kiye.**

### 6.2 `settlement.processed` webhook

**Event:** `settlement.processed`
**Helper:** `helpers/transactions/recordFundsReceived.js`

```js
await Transaction.updateMany(
  { razorpayPaymentId: { $in: paymentIds },
    fundsReceivedAt: null },        // ← redelivery par no-op
  { $set: { fundsReceivedAt: settledAt, razorpaySettlementId: settlementId } },
);
```

Timestamp **gateway ka apna `created_at`** hai, humare process karne ka moment
nahi — 2 din late aaya webhook paise ko 2 din naya nahi dikhana chahiye.

### 6.3 Settlement eligibility isi par keyed hai

```js
fundsReceivedAt: { $ne: null, $lte: fundsReceivedBefore }
```

Agar ye field khali hai, wo payment **kisi settlement me nahi jayega** — chahe
customer ne mahina pehle pay kiya ho.

> **Vendor ka experience:** "mera payout kyun nahi aaya?" ka ek bada jawab yahi
> hota hai — Razorpay ne abhi humare bank me paisa bheja hi nahi.

---

## PHASE 7 — Settlement build (nightly job)

### 7.1 Job

**Job name:** `buildSettlements`
**Interval:** **har 60 minute** (nightly nahi)
**Service:** `services/settlements/buildSettlements.js`

> **Har ghante kyun, raat me ek baar kyun nahi:** ye `idempotencyKey` par
> idempotent hai, to same period me doosri run kuch nahi banati. Chhota interval
> ye khareedta hai ki **jis raat process down tha, wo agle tick par khud theek ho
> jaye** — na ki kisi brand ka din tab tak skip ho jab tak koi notice na kare.

### 7.2 Period kaise decide hota hai

```js
const periodStart = settlementPeriodStart(delayDays, at);   // canonical IST
const periodEnd   = settlementPeriodEnd(delayDays, at);     // canonical IST
```

⚠️ **Ye kabhi `new Date()` se derive nahi hote.** Ek IST din ka exactly ek hi
`periodEnd` hota hai, chahe job kitni baar aur kitne process se chale.

`idempotencyKey = STL:<brandId>:<periodEnd.toISOString()>` — ye tabhi kaam karta
hai jab `periodEnd` dono run me **byte-identical** ho.

### 7.3 Settings jo yahan padhi jati hain

| Setting | Default | Kya karta hai |
|---|---|---|
| `settlement.isEnabled` | `true` | Off karo to poora build skip |
| `settlement.delayDays` | `3` | T+3 — Razorpay khud T+2 rokta hai |
| `settlement.payoutBufferHours` | `6` | Paisa humare bank me aane ke baad extra buffer |
| `settlement.minPayoutAmount` | `100` | Isse kam ho to carry forward (₹12 ka NEFT karne me effort zyada) |
| `settlement.requiresAdminApproval` | `true` | Off karo to auto-approve |
| `settlement.commissionPercent` | `0` | Structure ready hai, rate abhi 0 hai |
| `settlement.payoutProvider` | `MANUAL_BANK` | Aaj haath se NEFT |
| `settlement.gatewayFeeBearer` | `PLATFORM` | MDR kaun bharta hai |

> ⚠️ `delayDays` `?? 3` se padha jata hai, `|| 3` se nahi. Configured `0` falsy
> hai, to `||` usse chupchap `3` bana deta tha aur **3 din purana period** build
> hota tha — galat din, bina kisi error ke.

### 7.4 Kaunse brands consider hote hain

**Do sources:**

1. `brandsWithEligibleMoney` — jinke paas settle karne layak transactions hain
   (`Transaction.distinct("brandId", eligibleFilter)`)
2. `brandsWithMaturedReserves` — jinka reserve matured ho gaya

> ⚠️ **Doosra source nicety nahi hai.** Pehla ek `distinct` hai eligible
> **transactions** par — to jo brand trading band kar deta hai wo consider hi nahi
> hota, aur mahine pehle liya gaya unka reserve **hamesha ke liye** waheen pada
> rehta, bina kisi record ke. *Unka paisa unka hona band nahi ho jata sirf isliye
> ki unhone bechna band kar diya.*

### 7.5 Eligibility filter — ek transaction settle hone layak kab hai

`helpers/settlements/settlementClaims.js:52` — **buildEligibilityFilter**

| Condition | Matlab |
|---|---|
| `purpose: VOUCHER_CLAIM` | Subscription payment nahi |
| `verified: true` | Settle ho chuka payment |
| `status: CAPTURED` | Paisa actually liya gaya |
| `settlementId: null` | **Ye hi lock hai** — kisi doosre settlement ne nahi liya |
| `settlementHold: false` | Koi refund/dispute isse rok nahi raha |
| `isRefunded: { $ne: true }` | **Sirf poori tarah refunded** payment bahar |
| `verifiedAt: { $lte: periodEnd }` | Period ka ceiling |
| `fundsReceivedAt: { $ne: null, $lte: X }` | **Gateway ne humein pay kar diya** |
| `isDeleted: false` | — |

> ⚠️ `isRefunded` par pehle `amountRefunded: { $lte: 0 }` tha — jo **partially**
> refunded payment ko bhi bahar kar deta tha, **hamesha ke liye** (field monotonic
> hai). Intent sahi tha (poori sale ka paisa mat do jab part wapas gaya) par asar
> galat: vendor ka bacha hua hissa har future cycle se invisible ho gaya, jabki
> `claimRefundAdjustments` refunded part ka clawback baad ke cycle se **kaat bhi
> raha tha**. ₹810 ke payment par ₹300 refund hone par vendor ₹1,100 ka nuksaan
> me tha ek ₹800 ki sale par.
>
> Ab partial refund **arithmetic me net** hota hai, exclusion se nahi.

### 7.6 Order of operations — **claim pehle, hisaab baad me**

```
canonical period → shell (idempotency key) → rows atomically claim
    → SIRF jo claim hua usi ka total → PENDING_APPROVAL (ya CARRIED_FORWARD)
```

**Obvious order — select, total, write — galat hai.** Select aur write ke beech
ek refund land kar sakta hai. Wo payment ek aise settlement me gin liya jata hai
jisme use hona hi nahi chahiye tha **aur** refund bhi deduct ho jata hai —
**wahi paisa do baar hilta hai.**

Isliye: shell pehle banta hai, rows `settlementId: null` ko lock ki tarah use
karke claim hote hain, aur arithmetic **sirf jo capture hua** usi ko padhta hai.

### 7.7 Char claims — aur unka kram load-bearing hai

```js
const transactions = await claimTransactions(...);        // 1
const refunds      = await claimRefundAdjustments(...);   // 2
const chargebacks  = await claimChargebackAdjustments(...);// 3
const reserves     = await claimMaturedReserves(...);     // 4
```

**Ye `Promise.all` me nahi chal sakte.** `claimRefundAdjustments` sirf un refunds
ko leta hai jinke payment par `settlementId` hai. Partially refunded payment ko wo
id `claimTransactions` se milti hai — agar dono race karein to refund claim stamp
lagne se pehle dekh sakta hai aur is cycle ka deduction skip kar dega: **vendor ko
poori sale ka paisa mil jayega aur clawback kabhi nahi hoga.**

**Har claim ka apna lock:**

| Kya | Lock field | Kis collection par |
|---|---|---|
| Transactions | `settlementId` | `Transaction` |
| Refunds | `settlementId` | `RefundRequest` |
| Chargebacks | `recoverySettlementId` | `Dispute` |
| Matured reserves | `reserveReleaseSettlementId` | `Settlement` |

> **Lock kyun zaroori hai:** live query se nikala gaya figure **har cycle me wahi
> deduction** laga deta — ek chargeback ke liye vendor ko baar-baar, hamesha ke
> liye charge kiya jata, aur har mahine ka hisaab andar se sahi dikhta.

### 7.8 `computeTotals` — asli arithmetic

```js
beforeReserve = grossCollected
              − vendorPromoCost
              − commissionDeduction        // ← commissionAmount NAHI
              − refundAdjustment
              − chargebackAdjustment

reserveHeld     = max(0, beforeReserve) × (reservePercent / 100)
reserveReleased = purane matured reserves ka total

netPayable = beforeReserve − reserveHeld + reserveReleased
```

**Field-by-field:**

| Field | Kahan se | Note |
|---|---|---|
| `grossCollected` | `Σ voucher.netBill` | **`amount` nahi.** Customer ne `amount` diya jisme humari fee hai aur promo ghata hua hai — wo vendor ka nahi |
| `vendorPromoCost` | `Σ voucher.vendorPromoCost` | Promo ka vendor wala hissa |
| `commissionDeduction` | `Σ voucher.commissionDeduction` | **Commission nahi — deduction.** GST upar hone par dono alag hote hain |
| `refundAdjustment` | `Σ refund.split.vendorClawback` | **`totalRefund` nahi** — customer ko jo mila usme humari fee aur promo ka humara hissa bhi tha |
| `chargebackAdjustment` | `Σ dispute.recoverAmount` (ledger se) | Recompute nahi — ledger ne jo book kiya wahi |
| `reserveHeld` | is brand ka apna rate | `buildReserveRiskMap` se |
| `reserveReleased` | `Σ purane settlement.reserveHeld` | **reserve ke baad joda jata hai**, pehle nahi |

> ⚠️ `reserveReleased` **naya hold nikalne ke BAAD** jodta hai. Usse
> `beforeReserve` me ghusa dena matlab us paise par dobara percentage kaatna —
> *reserve par reserve* — aur 5% rate par vendor ka paisa har cycle thoda-thoda
> ghat-ta jata, hamesha ke liye.

### 7.9 Teen outcomes

```js
const nothingToPay = totals.netPayable <= 0 || totals.netPayable < minPayout;
const autoApprove  = !nothingToPay && settings.requiresAdminApproval === false;

let to = PENDING_APPROVAL;
if (nothingToPay)      to = CARRIED_FORWARD;
else if (autoApprove)  to = APPROVED;
```

| Outcome | Kab | Kya hota hai |
|---|---|---|
| `PENDING_APPROVAL` | Normal | Admin ke worklist par jata hai |
| `APPROVED` | `requiresAdminApproval: false` | Queue skip, par payout ab bhi manual |
| `CARRIED_FORWARD` | `netPayable <= 0` ya `< minPayout` | Rows release, agle cycle me jayenge |

> ⚠️ `!== false`, `Boolean(...)` nahi. Unset value ka matlab **on** hona chahiye:
> warna field aane se pehle likha gaya settings document agle deploy par platform
> ke har payout ko chupchap auto-approve kar deta.

### 7.10 `CARRIED_FORWARD` — "kuch nahi dena" ek legitimate outcome hai

Ye `PAID` **nahi** ban sakta. `PAID` settlement ek `PAYOUT` ledger entry likhta
hai, aur jis paise ko kisi bank transfer ne uthaya hi nahi uska payout book karna
`reconcileLedger` ko `LEDGER_DRIFT` chillane par majboor karta hai — bina ye bataye
ki kis settlement se hua.

**Release hona hi carry-forward hai:** eligibility me koi `periodStart` floor nahi
hai, to takings aur unapplied deductions dono apne aap agle cycle me chale jate
hain aur wahan net off ho jate hain.

### 7.11 Vendor ko batana — par sirf jab wajah deductions hon

```js
if (nothingToPay && totals.netPayable <= 0 && deductions > 0) {
  await notifyVendorSettlementCarriedForward({ ... });
}
```

Do bahut alag outcomes `CARRIED_FORWARD` share karte hain:

- *"₹500 ke minimum se kam"* — routine hai, chup rehta hai
- *"Tumhare refunds aur chargebacks is period ki sales se zyada ho gaye"* —
  **ye payout hai jo aa hi nahi raha**, aur ye bhi chup tha. Outlet ki taraf se
  ye ek chupchap fail hue payout jaisa hi lagta tha. Pehli baar kisi ko pata
  chalta tha support call se, aksar hafton baad.

### 7.12 Ek brand ka fail hona baaki sabka payout nahi rok sakta

```js
for (const brandId of brandIds) {
  try { await buildForBrand({...}); }
  catch (error) { failures.push({ brandId, reason: error?.message }); }
}
```

Pehle ye guard nahi tha — ek throw (bina verified bank wala brand, corrupt pricing,
transient write error) poori nightly run gira deta tha. **Ek bad row ek platform
ke payouts rok sakti thi aur kuch bolta bhi nahi.**

---

## PHASE 8 — Admin approval

### 8.1 API

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/approve`
**Auth:** `isAdmin`
**Service:** `services/settlements/approveSettlement.js`

### 8.2 Approval hi wo aakhri point hai jahan exclusion free hai

`settlementHold` sirf payment ko **claim** hone se rokta hai. Claim ho jane ke
baad wo kuch nahi karta — eligibility build time par evaluate ho chuki thi aur
totals wahi describe karte hain jo tab capture hua tha.

**02:00 ke build aur 14:00 ke payout ke beech 12 ghante hain**, aur exactly wahi
waqt hai jab ek chargeback ya refund request aati hai ek aise payment par jo
pehle se is settlement ke andar hai.

To webhook **settlement ko flag** karta hai (`needsRevalidation: true`), aur flag
yahan katata hai — **update filter me, uske upar ek `if` me nahi:**

```js
const approved = await Settlement.findOneAndUpdate(
  { _id: settlement._id,
    status: PENDING_APPROVAL,
    needsRevalidation: { $ne: true } },   // ← filter me
  { $set: { status: APPROVED, approvedBy, approvedAt, isOpen: true } },
);
```

> Jo check document padh kar fir likhta hai, wo wahi window chhod deta hai jise
> wo band karne aaya tha: flag read aur write ke beech land kar sakta hai.

### 8.3 Approval mana ho gaya to kya hota hai

Settlement `ON_HOLD` par park hota hai (pending queue me nahi chhoda jata — warna
admin wahi click dobara karta aur error ko noise samajhne lagta), aur error me
**offending transactions ke naam** hote hain:

> *"3 payment(s) in this settlement are no longer eligible (TD/INV/26-27/000041,
> TD/INV/26-27/000058, TD/INV/26-27/000073). It has been put on hold — rebuild it
> to settle the rest."*

### 8.4 Rebuild — bure rows nikaal kar dobara

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/rebuild`
**Sirf `ON_HOLD` se**

```js
// sirf tainted rows wapas jate hain
await Transaction.updateMany(
  { _id: { $in: taintedIds }, settlementId: settlement._id },
  { $set: { settlementId: null } },
);
```

> ⚠️ **Sab release karke dobara claim karna zyada saaf lagta hai aur galat hai.**
> Release aur re-claim ke beech koi doosra build wo rows le sakta hai, aur is
> settlement ka number aur statement un payments ko describe karega jo admin ne
> approve kiye hi nahi the.

Rebuild ke baad → `PENDING_APPROVAL` (ya `CARRIED_FORWARD` agar kuch bacha hi nahi).

### 8.5 Baaki admin actions

| API | Kab | Rows release hote hain? |
|---|---|---|
| `PATCH .../hold` | Kabhi bhi review ke liye rokna ho | ❌ |
| `PATCH .../cancel` | Poora settlement mana karna (reason **required**) | ✅ |
| `PATCH .../abandon` | `FAILED` par jo kabhi retry nahi hoga (reason **required**) | ✅ |

> **`abandon` kyun exist karta hai:** `FAILED → ABANDONED` state machine me shuru
> se tha aur **kabhi kisi ne call nahi kiya**. `ABANDONED` hi ekmatra tareeka hai
> jisse `FAILED` settlement apne rows release karta hai — `failPayout` unhe
> jaan-boojh kar rakhta hai, kyunki bounce ka aam jawab hai account theek karke
> wahi settlement retry karna.
>
> Par kuch bounces kabhi theek nahi hote: brand band ho gaya, account sudhar nahi
> sakta, vendor chala gaya. Bina caller ke wo rows **hamesha ke liye** ek aise
> settlement ke paas claimed rehte jise koi kabhi pay nahi karega — har future
> cycle se invisible, bina error, bina log.

### 8.6 `hold` par vendor ko kya batate hain

```js
await sendQuietly(() => notifyVendorSettlementOnHold({ settlement: moved }), ...);
```

**`payload.reason` jaan-boojh kar aage nahi bheja jata.** Wo aksar kisi disputed
payment ka naam leta hai, aur vendor ko ye batana ki unka kaunsa claim review me
hai — ek do din ki delay ko ek aise chargeback ki behes bana deta hai jis par abhi
kisi ne faisla hi nahi diya. Support poochhne par samjhata hai.

---

## PHASE 9 — Payout — vendor ke bank me paisa

### 9.1 Do steps, jaan-boojh kar

```
PATCH .../pay      →  PayoutLeg banta hai (INITIATED), settlement PROCESSING
   ↓  admin apne banking screen par NEFT karta hai (haath se)
PATCH .../confirm  →  UTR type karta hai → leg PAID → settlement PAID
```

`MANUAL_BANK` me koi callback nahi hai — **insaan hi callback hai.** Dono ko ek
button me collapse karna matlab settlement ko paid mark karna **isse pehle ki
NEFT type bhi hui ho.**

### 9.2 `pay` — paisa nikalne se pehle ka aakhri moment

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/pay`
**Service:** `services/settlements/paySettlement.js` → `startPayout`

**Yahan 5 check hote hain:**

**1. Status** — `APPROVED` (ya `PROCESSING` agar split payout ka agla leg hai)

**2. `needsRevalidation` dobara check hota hai**
```js
if (settlement.needsRevalidation) {
  await transitionSettlement({ settlement, to: ON_HOLD, ... });
  throwError(409, "Some payments in this settlement stopped being eligible after
    it was approved, so the payout was stopped and the settlement put on hold...");
}
```
> Approval par check karna kaafi nahi hai. Us window ka poora point hi ye hai ki
> usme **ghante** guzarte hain, aur ye aakhri moment hai paisa ek aise raaste se
> nikalne se pehle jiska **koi recall nahi hai**.

**3. `netPayable > 0`**

**4. Bank account badla to nahi** — `assertBankUnchanged`

```js
const changed = live.accountLast4Digits !== frozen.accountLast4Digits
             || live.ifscCode          !== frozen.ifscCode;
```

`buildSettlements` ne `bankSnapshot` freeze kiya tha taaki vendor ek approve ho
chuke payout ko redirect na kar sake. Par vendor ka beech cycle me account badalna
**attack nahi hai** — aksar account band ho gaya hota hai, aur usme pay karna
pay na karne se bura hai: NEFT kuch din baad bounce hoga, ya wahan land karega
jahan vendor ka control nahi hai.

> Ye push karne wala error nahi hai. Settlement `ON_HOLD` jata hai aur admin ko
> bataya jata hai ki kaunsa account badla:
> *"This brand's bank account changed after the settlement was approved
> (…4821 → …7734). It is on hold — check with the brand, then rebuild and re-approve."*

**5. Kitna abhi bhi baaki hai**
```js
const alreadyPaid = await paidTotal(settlement._id);
const outstanding = round2(settlement.netPayable - alreadyPaid);
```
> ⚠️ Pehle ye har leg par `settlement.netPayable` tha. Split payout par doosra leg
> poora amount dobara claim kar leta, aur pehle par ₹400 ki NEFT confirm karne se
> ₹800 record hota — `paidTotal` `netPayable` clear kar deta aur settlement
> `PAID` ban jata **aadha paisa kabhi bheje bina**. Vendor kam paisa, aur system
> kehta ki poora pay ho gaya.

### 9.3 PayoutLeg — ek leg = ek actual bank transfer

```js
leg = await PayoutLeg.create({
  payoutType: SETTLEMENT,
  settlementId, brandId,
  legNumber,               // = existing legs count + 1
  amount: outstanding,
  provider: MANUAL_BANK,
  status: INITIATED,
  initiatedBy: actor.userId,
  bankSnapshot: settlement.bankSnapshot,   // is attempt ka payee
});
```

**Do unique index isse safe banate hain:**

- `(payoutType, settlementId, legNumber)` — legNumber duplicate nahi
- `payout_settlement_inflight_unique` — **ek waqt me ek hi leg in-flight**

> ⚠️ Sirf `legNumber` index kaafi nahi tha: `legNumber` existing legs **gin kar**
> aata hai, to do concurrent start 1 aur 2 le lete aur dono insert pass ho jate.
> Fir sirf ek status transition jeetta, aur haarne wale ka leg `INITIATED` par
> orphan pada rehta — jise `sweepStalePayouts` "paisa shayad ja chuka hai" ki
> tarah report karta, aur use confirm karne wala admin **vendor ko do baar pay
> kar deta.**

**Status leg banne ke BAAD move hota hai.** Beech me crash hone par `APPROVED`
settlement ke saath `INITIATED` leg bachta hai — dikhta hai, aur sweep usse
resolve kar sakti hai. Ulta kram `PROCESSING` settlement bina kisi leg ke chhodta
hai, jo padhne me "paisa ja raha hai par kisi ko milta nahi" jaisa lagta hai.

### 9.4 `confirm` — UTR se paisa real hota hai

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/confirm`

**Body:**
```json
{
  "utr": "SBIN123456789",
  "amount": 785.00,         // optional — default: leg ka amount
  "mode": "NEFT",           // optional
  "reference": "...",       // optional
  "paidAt": "2026-09-11T14:30:00.000Z"   // optional
}
```

**UTR required hai** — *"it is what a vendor quotes back when money has not landed."*

**`amount` ka rule:**
- Default = leg ka amount (aam single-NEFT case unchanged)
- Kam ho sakta hai (admin ne bada payout tod diya)
- **Zyada nahi ho sakta** — wo typo hai, aur leg hi wo cheez hai jiske against
  bank instruction uthi thi

> ⚠️ Iske bina leg apna planned amount record karta, `paidTotal` `netPayable`
> clear kar deta, aur aadha bheja payout `PAID` ban kar band ho jata — vendor kam
> paisa, ledger wo paisa book karta jo kabhi nikla hi nahi, aur kahin koi disagree
> nahi karta.

**Fir:**
```js
await postPayoutEntries({ leg: paidLeg, settlement, isFinalLeg });

if (!isFinalLeg) return { ... settled: false, remaining: ... };

await transitionSettlement({ settlement, to: PAID, ... });
await sendQuietly(() => notifyVendorSettlementPaid({ settlement: moved, utr }));
```

> **Ledger leg confirm hote hi likha jata hai, settlement complete hone par nahi.**
> Split payout ki pehli NEFT genuinely humare account se nikal chuki hai. Doosre
> leg ka wait karna matlab books ka ye kehna ki humare paas ab bhi wo paisa hai
> jo ja chuka hai.

### 9.5 Self-heal — confirmation crash ho gaya

`confirmPayout` leg ko `PAID` mark karta hai aur ledger book karta hai **settlement
transition se pehle**. Beech me throw hone par `PROCESSING` settlement bachta hai
jiska paisa poori tarah ja chuka hai: confirm karne ko kuch nahi, aur `startPayout`
mana karta hai kyunki pay karne ko kuch bacha nahi. **Terminally stuck — vendor ko
paisa mil chuka aur record ulta keh raha.**

To bina open leg ke aayi confirmation **refuse nahi karti**, wo crash hue kaam ko
poora karti hai:

```js
const already = await paidTotal(settlement._id);
if (already >= round2(settlement.netPayable) - 0.005) {
  // → PAID, healed: true
}
```

### 9.6 `fail` — bank ne bounce kar diya

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/fail`
**Body:** `{ "note": "Account closed", "reason": "ACCOUNT_INVALID" }` (note required)

- Failed leg **rakha jata hai, edit nahi hota**. Retry ek naya leg hai agle number
  ke saath, to record me dono attempts hain — jo bounce hua aur jo chala — apne
  UTR aur payee ke saath. Pehla edit karna matlab ye mitana ki us account me paisa
  kabhi bheja bhi gaya tha, jo exactly wahi cheez hai jo investigation ko chahiye.
- Settlement `FAILED` jata hai — **jo apne rows release nahi karta**. Bounce aam
  baat hai aur sahi operation hai account theek karke wahi settlement retry karna,
  uska number aur statement rakhte hue.

**Vendor ko `reason` ka category jata hai, admin ka `note` nahi:**
> Note admin ne doosre admins ke liye likha hai; category vendor ko batata hai ki
> theek karne wali cheez **unki** hai (band account) ya **humari**.

| `SETTLEMENT_FAILURE_REASON` | Matlab |
|---|---|
| `BANK_REJECTED` | Bank ne mana kar diya |
| `ACCOUNT_INVALID` | Account details galat |
| `INSUFFICIENT_BALANCE` | Humare account me paisa kam |
| `GATEWAY_ERROR` | Technical |
| `OTHER` | — |

### 9.7 `retry` — dobara koshish

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/retry`
**Sirf `FAILED` se** → `APPROVED`

**Bank snapshot yahan REFRESH hota hai:**
```js
const fresh = await liveBankSnapshot(settlement.brandId);
if (!fresh) throwError(422, "This brand still has no verified bank account...");
```
> Payout bounce hone ki aam wajah hi galat account hoti hai. **Usi galat account
> me dobara bhejna hi ek cheez hai jo pakka kaam nahi karegi.**

### 9.8 `reverse` — bank ne paid payout wapas kheench liya

**API:** `PATCH /trydood/v1/settlements/admin/:settlementId/reverse`
**Sirf `PAID` se** → `REVERSED` (reason required)

**Ledger pehle, rows baad me:**
```js
await transitionSettlement({
  settlement, to: REVERSED, reason,
  beforeRelease: async () => {
    await reversePayoutEntries({ legs: paidLegs, settlement, reason });
    await PayoutLeg.updateMany({ _id: { $in: ... } }, { $set: { status: REVERSED } });
  },
});
```

> ⚠️ **Kram hi poora point hai.** Beech me crash hone par over-stated reversal
> bachta hai — ledger me dikhta hai, aur theek kiya ja sakta hai. Ulta kram rows
> release kar deta hai bina reversal book kiye — jo padhne me lagta hai ki paisa
> kabhi diya hi nahi gaya, aur wo **dobara settle** hone ke liye free ho jata hai.

---

## PHASE 10 — Payout history, statement aur documents

### 10.1 Vendor apna payout dekhta hai

**API:** `GET /trydood/v1/settlements/`
**Auth:** `verifyJwtToken` — **ek endpoint, do shapes**

Scope aur projection dono token se derive hote hain — vendor panel aur admin
worklist ek hi URL call karte hain.

> **Role gate kyun nahi:** do endpoints matlab do mauke ki koi ek `bankSnapshot`
> ya humara commission leak kar de. `CUSTOMER` token andar `scopeFor` me 403 hota
> hai — settlement me unka kuch nahi hai.

**Query filters:** `status`, `brandId` (admin only), date range, pagination,
`settlementNumber` search.

### 10.2 Ek settlement ka detail

**API:** `GET /trydood/v1/settlements/:settlementId`

Vendor ko dikhta hai: period, `grossCollected`, deductions, `netPayable`, status,
`approvedAt`, `paidAt`, bank ke last 4 digits, UTR.

### 10.3 Statement lines — kis payment ne ye payout banaya

**API:** `GET /trydood/v1/settlements/:settlementId/transactions`
**Paged**

> Detail se alag isliye hai kyunki ek busy brand ka cycle sau-sau rows ka hota
> hai, aur detail call zyadatar "kitna aur kab" jaanne ke liye padha jata hai.

### 10.4 Public documents

**API:** `GET /trydood/v1/documents/:token`
**Auth:** koi nahi — token hi authorization hai

Char document kinds, **ek hi endpoint**:

| Document | Number series | Kab banta hai |
|---|---|---|
| Claim invoice (customer) | `TD/INV/26-27/000123` | Settle ke waqt |
| Payout statement (vendor) | `TD/STL/26-27/000123` | Settlement `PAID` hone par |
| Commission tax invoice | `TD/CMN/26-27/000045` | Commission > 0 hone par |
| Refund document | apna series | Refund complete hone par |

**`documentToken`** ek unguessable handle hai — chaaron collections me **ek hi
naam**, taaki `/documents/:token` bare token resolve kar sake.

> **Commission invoice alag number kyun rakhta hai:** payout statement vendor ko
> batata hai ki unke bank me kya pahuncha; commission jo Trydood ne charge kiya wo
> **humse unko ek taxable supply** hai aur GST ke tehat uska apna tax invoice, apne
> series me hona chahiye. **Chhapte ek hi kagaz par hain** — vendor ko ek payout ke
> liye do file reconcile nahi karni chahiye — par GST me wo do documents hain aur
> do ki tarah number hote hain.

### 10.5 Statement `PAID` par freeze hota hai

`transitionSettlement.js:176` — `issueSettlementDocument` sirf `PAID` ki taraf
jaate waqt, aur ledger + row release ke **baad**.

> **`PAID` hi pehla state hai jiske peeche ki koi cheez hil nahi sakti:** rebuild
> tainted rows release karta hai, `CARRIED_FORWARD` unhe agle cycle ko de deta
> hai, bounce hua payout naye leg se retry hota hai. In me se kisi se freeze kiya
> statement aise figures likhta jo baad me badal gaye — **humare naam wale kagaz
> par.**

---

## PHASE 11 — Refund ka pura flow

### 11.1 Poora raasta ek nazar me

```
REQUESTED                                              ← customer
   │
   ├──► VENDOR_APPROVED ──► ADMIN_APPROVED ──► PROCESSING ──► COMPLETED   ← NORMAL
   │                                                      └─► FAILED
   │                                                            │
   │                                    ┌───────────────────────┘
   │                                    ▼
   │                          AWAITING_BANK_DETAILS ──► ADMIN_APPROVED ──► ...
   │                          (MANUAL_BANK fallback)
   │
   ├──► VENDOR_REJECTED ┐
   ├──► VENDOR_TIMEOUT  ┘──► ADMIN_OVERRIDE (reason REQUIRED)              ← EXCEPTION
   │                    └──► ADMIN_REJECTED
   │
   └──► CANCELLED                                       ← customer ne withdraw kiya
```

**Ek line ka rule:** **vendor approve karta hai, admin execute karta hai.**
Normal path par admin doosra gate nahi hai. Vendor ke `no` (ya unki chuppi) ko
override karna ek **alag route** hai, jo log hota hai aur alag se gina jata hai —
kyunki badhta hua override rate ye nahi kehta ki admin generous hain, wo kehta hai
ki **upar kahin kuch galat hai**.

### 11.2 Golden rule — jo poori problem hi mita deta hai

```
delayDays × 24  >=  windowHours + vendorApprovalHours + adminBufferHours
Default:  72h  >=  24 + 24 + 12 = 60h  ✓
```

**Jab tak ye sach hai, refund kabhi us paise ko chhu nahi sakta jo vendor ke paas
ja chuka hai.** Refund bas us cycle ka payable kam kar deta hai. Isse todo aur
platform us vendor se paisa vasool karne me lag jayega jo wo bank me daal chuka
hai — matlab negative balances, awkward baat-cheet, aur ek reconciliation problem
jo hafton baad dikhti hai.

> **Isliye ye comment me advice nahi, save par 422 hai.**
> `assertSettlementTimingRule` **merged config** par check karta hai — kyunki jo
> PATCH sirf `windowHours` badhata hai, wo `delayDays` kabhi dekhta hi nahi.

### 11.3 Customer refund maangta hai

**API:** `POST /trydood/v1/refunds/`
**Auth:** `isCustomer`
**Service:** `services/refunds/requestRefund.js`

**Body:**
```json
{
  "claimId": "...",
  "amount": 760,                 // optional — na do to poora
  "reason": "NOT_HONOURED",
  "reasonNote": "..."            // reason OTHER ho to REQUIRED
}
```

**Reasons (closed list):** `NOT_HONOURED`, `OUTLET_CLOSED`, `WRONG_AMOUNT`,
`SERVICE_ISSUE`, `DUPLICATE_PAYMENT`, `CHANGED_MIND`, `OTHER`.

> **Free text kyun nahi:** ye ekmatra field hai jisse report group kar sakti hai —
> *"is brand ke 40% refunds NOT_HONOURED hain"* ek vendor conversation hai;
> hazaar alag-alag vaakya nahi hain.

**Checks ka kram:**

```
1. Ownership     — CUSTOMER par, user par nahi
2. Claim status  — PAID ya REDEEMED hi refundable hain
3. Payment       — verified hona chahiye
4. Allowance     — abuse limits (neeche)
5. Window        — paidAt + windowHours
6. Amount        — partial allowed hai ya nahi, ceiling
7. Split         — freeze
8. Request       — create
9. Hold          — settlement rok do
10. Taint        — settlement ko flag kar do
```

**Allowance sabse pehle check hoti hai, window se bhi pehle:**
> Apni limit paar kar chuke customer ko **wahi** batana chahiye, ye nahi ki unka
> claim purana ho gaya — pehli cheez support theek kar sakta hai, doosri unhe ek
> aisi problem dhundhne bhej deti hai jo hai hi nahi.

**Window `paidAt` se nap-ta hai, claim bante waqt se nahi:**
> Ek ghante ke liye chhoda hua checkout jo baad me pay hua — uska refund window
> customer ke paise dene se pehle shuru ho jata.

### 11.4 Abuse limits — **refused** requests ginte hain, approved nahi

| Setting | Default | Kya |
|---|---|---|
| `maxOpenRequests` | `1` | Ek customer ke total kitne refund in-flight ho sakte hain |
| `windowHours` | `24` | Pay karne ke baad kitne ghante tak refund maang sakte hain |
| `vendorApprovalHours` | `24` | Vendor ka jawab dene ka window |
| `adminBufferHours` | `12` | Admin ka execute karne ka window |
| `allowPartial` | `true` | Partial refund allowed |
| `releasePromoOnRefund` | `false` | Refund par promo code slot **wapas nahi** milta |
| `onVendorTimeout` | `ESCALATE` | Chup vendor ke baad kya ho |

> ⚠️ **Sirf refused requests ginte hain.** Signal ye nahi hai ki kitna paisa wapas
> gaya — signal ye hai ki *"vendor ne isse dekha aur kaha ki ye jaayaz nahi hai"*.
> Jis customer ke 5 refund approve hue, uske 5 genuinely bure experience the, aur
> uska chhatha block karna exactly usi insaan ko saza deta hai jiske liye ye poora
> process bana hai. Aur usse bura — sabse kharab brand ke customers hi raw request
> cap sabse pehle hit karte, aur wahi log sabse zyada haqdaar hain poochhne ke.

### 11.5 Split **request ke waqt** freeze hota hai, execution ke waqt nahi

```js
const split = calculateRefundSplit({
  pricing: claim.pricing,        // ← claim se, TRANSACTION se nahi
  paidAmount, requestedAmount, alreadyRefunded,
  gatewayFee: transaction.gatewayFee || 0,
});
```

> Mangalvaar ko approve hua aur Guruvaar ko paid hua refund **exactly wahi paisa
> hilana chahiye jis par sabne Mangalvaar ko haan kahi thi.** Execution par
> recompute karna matlab beech me promo rule badal jane dena, aur vendor ko wo
> amount kaat lena jise kisi ne approve kiya hi nahi.

**`claim.pricing` se kyun, `Transaction.voucher` se kyun nahi:**
`Transaction.voucher` ek **denormalised copy** hai (taaki settlement bina har claim
join kiye total kar sake). Usme `netBill`, `platformPromoCost`, `commissionAmount`
hain — par **`promoDiscount`, `promoAppliesTo` aur `taxOnTop` nahi**.

Wahi teen split decide karte hain. **Convenience fee** par laga promo vendor ko
kuch nahi padta aur unse claw nahi hona chahiye; **net bill** par laga promo hona
chahiye. Transaction ki copy in dono ko alag nahi bata sakti — aur vendor ko us
discount ka paisa chupchap kaat leti jo humne apni fee se diya tha.

### 11.6 Refund split — kaun kya bharta hai

**(Decided 30 Aug 2026)**

| Hissa | Full refund | Partial |
|---|---|---|
| Net bill | Vendor se clawback | Pro-rata |
| Convenience fee | Customer ko wapas, **hum absorb karte hain** | **Wapas nahi** |
| Fee par GST | Fee ke saath wapas | Wapas nahi |
| Promo — humara hissa | Reverse, hum bharna band | Pro-rata |
| Promo — vendor ka hissa | Reverse | Pro-rata |
| Razorpay MDR | **Hum absorb karte hain** | Pehle refund par ek baar |

> **Full refund par fee wapas kyun:** jo customer ₹810 de kar ₹800 wapas paata
> hai wo support ticket kholta hai, aur ₹10 par sahi hone se wo ticket sasta nahi
> hota. Razorpay refund par apni fee wapas nahi karta, to MDR seedha nuksaan hai —
> aur use **nuksaan ki tarah record** kiya jata hai taaki ledger me dikhe, na ki
> chupchap margin khaye.

**Balance identity — return se pehle assert hoti hai:**
```
totalRefund   = vendorPortion + convenienceFeeRefund + taxRefund
vendorPortion = vendorClawback + commissionReversal − platformPromoReversal
```
> Jo split balance nahi hota wo rounding ki pareshani nahi hai — wo **paisa hai jo
> darwaze se bahar jata bina doosri taraf matching entry ke.**

**Rounding `vendorClawback` par land hoti hai** — wo sabse bada component hai, wo
apne settlement ke against reconcile hota hai, aur wo kabhi customer ko dikhaya
jane wala number nahi hai.

### 11.7 Do lines jo "vendor ko pehle hi pay kar diya" problem mita deti hain

```js
// 1. Future settlement rok do
await Transaction.updateOne({ _id: transaction._id }, { $set: {
  settlementHold: true,
  settlementHoldReason: `Refund requested (${request._id})`,
  latestRefundRequestId: request._id,
}});

// 2. Jo settlement PEHLE SE is payment ko pakde hai, use flag kar do
await taintSettlement({ transaction, reason: `Refund requested (${request._id})` });
```

**Dono zaroori hain:**
- `settlementHold` sirf **future** claim rokti hai
- Agar payment pehle se kisi settlement ke andar hai — aur 02:00 ke build aur
  14:00 ke payout ke beech bilkul ho sakta hai — to `settlementHold` set karna us
  settlement ka kuch nahi badalta. **Isliye settlement ko bhi flag karte hain**,
  aur approval flag lage hone tak mana karta hai.

### 11.8 Double tap — ek open refund per payment

```js
// RefundRequest index: refund_open_per_transaction_unique
{ transactionId: 1, isOpen: 1 }  unique, partial on isOpen: true
```

Duplicate key par error nahi milta — **jo request jeeti wahi wapas milti hai**:

```js
return present(existing, {
  reused: true,
  ...(Math.abs(asked - open) > PAISA ? { askedFor: asked } : {}),
});
```

> `askedFor` **sirf tab** set hota hai jab doosri request **alag amount** maangti
> hai. Jis customer ka ₹810 ka refund pending hai aur wo fir ₹100 maangta hai —
> usse ₹810 wali request mil jati thi bina kisi farak ke. Usse pata hi nahi chalta
> ki uski doosri koshish kahin gayi nahi, aur wo ek aise figure ka intezaar karta
> rehta jo kabhi aana hi nahi tha.

### 11.9 Vendor faisla karta hai

**Approve:** `PATCH /trydood/v1/refunds/:requestId/approve`
**Reject:** `PATCH /trydood/v1/refunds/:requestId/reject`
**Auth:** `isVendorOrSubVendor`

> **Outlet manager sirf apne counter ka faisla karta hai** — `subBrandId` match
> hona zaroori hai. Admin yahan **nahi** hai: normal path par vendor approve karta
> hai aur admin sirf execute.

**Amount neeche ja sakta hai, upar nahi:**
```js
if (approvedAmount > request.requestedAmount + 0.005) {
  throwError(422, `The customer asked for ₹${...}. You can approve that or less, not more.`);
}
```
> *"Aadha order theek tha, starter nahi"* ek asli jawab hai, aur amount kam karna
> hi usse dene ka tareeka hai. Badhana approval nahi hai — wo **naya faisla** hai,
> aur is step par ek extra zero pad jane se us insaan ko claim se 10 guna paisa
> chala jata jisne maanga hi nahi tha.

**Split **is** amount par dobara freeze hota hai** — aage sab kuch (vendor ka
clawback, humara promo reversal, ledger) yahi block padhta hai aur usse wo paisa
describe karna chahiye jo **actually hilne wala hai**.

**Reject par note REQUIRED hai:**
> Wo ekmatra cheez hai jo admin ko review karne ko milti hai jab customer refusal
> challenge kare, aur akela *"rejected"* har appeal ko phone call bana deta hai.

**Reject settlement hold **utar deta hai**** — yahi wo state hai jo warna vendor
ka apna paisa ek aise hold me phansa deti jise koi kabhi nahi hatata.

**Conditional claim:**
```js
findOneAndUpdate({ _id, status: { $in: VENDOR_CAN_DECIDE } }, ...)
```
> Owner aur outlet manager ek hi request dekh rahe ho sakte hain. Iske bina dono
> click land karte aur doosra pehle ko chupchap overwrite kar deta — customer ka
> jawab is baat par depend karta ki kaun der se click kara.

**Race haarne wale ko kya batate hain:** row **dobara padhi jati hai**.
> Pehle `request.status` report hota tha — jo definition se ek aisa status hai jo
> abhi bhi decidable tha. To ek second se haarne wale outlet manager ko milta tha:
> *"This refund has already been decided (requested)."* — jo kuch nahi kehta aur
> bug jaisa padhta hai.

### 11.10 Customer withdraw kar sakta hai

**API:** `PATCH /trydood/v1/refunds/:requestId/withdraw`
**Auth:** `isCustomer`

**Kab tak:** `REQUESTED`, `VENDOR_APPROVED`, `VENDOR_TIMEOUT`.
`PROCESSING` ho gaya to paisa Razorpay ke paas ja chuka hai — withdraw karne ko
kuch bacha hi nahi, aur ye keh dena us cancellation ko accept karne se behtar hai
jo hogi hi nahi.

### 11.11 Vendor chup raha to — escalation

**Job:** `escalateStaleRefunds` (har 15 min)

`vendorRespondBy` beetne par request `VENDOR_TIMEOUT` par chali jati hai — ab wo
admin ki hai. Vendor phir se usme haath nahi daal sakta:

```js
const VENDOR_CAN_DECIDE = [REFUND_REQUEST_STATUS.REQUESTED];   // TIMEOUT nahi
```

> Warna ek hi cheez do log decide karte, aur customer ka jawab is baat par depend
> karta ki aakhri click kisne kiya.

**Nudges:** `remindVendorsAboutRefunds` (har ghante) window band hone se pehle
**do** reminder bhejta hai — taaki timeout kabhi surprise na ho.

**Customer ko `VENDOR_TIMEOUT` kabhi nahi dikhta:**
```js
[REFUND_REQUEST_STATUS.VENDOR_TIMEOUT]: "Under review by Trydood",
```
> Customer ko ye batana ki outlet ne unhe ignore kiya, ek aisi ladai shuru karta
> hai jise platform ko hi sulajhana padega, aur wo aisi cheez nahi hai jis par
> customer kuch kar sake.

### 11.12 Admin execute karta hai

**Approve:** `PATCH /trydood/v1/refunds/admin/:requestId/approve`
**Reject:** `PATCH /trydood/v1/refunds/admin/:requestId/reject` (note required)
**Auth:** `isAdmin`

**Admin kin states par act kar sakta hai:**

| From | Kya banta hai | Reason chahiye? |
|---|---|---|
| `VENDOR_APPROVED` | `ADMIN_APPROVED` | ❌ (normal path) |
| `VENDOR_REJECTED` | `ADMIN_OVERRIDE` | ✅ **required** |
| `VENDOR_TIMEOUT` | `ADMIN_OVERRIDE` | ✅ **required** |

**Do zaroori checks:**

**1. Naya open request to nahi aa gaya?**
```js
if (otherOpen) {
  throwError(409, `The customer has since raised another refund on this payment
    (${otherOpen.claimCode}), and that one is still open. Decide that request
    instead — approving this older one would act on an amount they may have changed.`);
}
```

**2. Kya vendor ko is sale ka paisa ja chuka hai?**
```js
const vendorAlreadyPaid = Boolean(payment?.settlementId);
```
> Vendor ka rejection `settlementHold` **release** karta hai, to wo payment agle
> cycle me chala jata hai aur ghanton me payout ho sakta hai. Hafton baad ka
> override us paise se customer ko refund karta hai jo vendor ke paas pehle se hai.
>
> Ye recoverable hai — `claimRefundAdjustments` unke agle payout se clawback le
> lega — par free nahi hai, aur wo nahi hai jo golden rule promise karta hai.
> **Admin hi ekmatra insaan hai jo "customer sahi hai" ko "ye ab us vendor se
> aayega jisne neek-niyati se paisa liya" ke against tol sakta hai.** Isliye faisla
> unka hai; jo unhe nahi karna chahiye wo hai **bina jaane faisla karna.**

`vendorAlreadyPaid` response me bhi aata hai taaki panel pay dabane se pehle warn
kar sake.

### 11.13 Paisa bhejna — `pay`

**API:** `PATCH /trydood/v1/refunds/admin/:requestId/pay`
**Auth:** `isAdmin`
**Service:** `services/refunds/executeRefund.js`

**Kin states se:** `ADMIN_APPROVED`, `ADMIN_OVERRIDE`, `FAILED` (retry),
`PROCESSING` (crash recovery).

**Order of operations hi poori safety story hai:**
```
PROCESSING mark karo + attemptCount bump   ← gateway call se PEHLE
   → Razorpay se poochho kya pehle se hai  ← sirf retry par
   → payments.refund()                     ← jiska undo nahi hai
   → refund id store karo
```

> **Counter call se pehle badhta hai, baad me nahi.** Agar process call safal hone
> aur id store hone ke beech mar jaye, to row kehta hai `PROCESSING` with
> `attemptCount: 1` aur koi `razorpayRefundId` nahi — aur agli koshish jaanti hai
> ki **Razorpay se poochhna hai**, doosra refund issue nahi karna. Baad me
> increment karne se counter zero par rehta aur retry customer ko **do baar** paisa
> bhej deta.

**Ceiling paisa hilne se ek moment pehle dobara check hoti hai:**
```js
if (amount > remaining + 0.005) {
  throwError(422, `This refund is for ${amount} but only ${remaining} of this payment
    is still refundable — ${alreadyRefunded} has already gone back...`);
}
```
> Ek asli window hai: `applyRefundCompletion` pehli request ka `isOpen` **pehle**
> clear karta hai aur `amountRefunded` **baad me** badhata hai. Us gap me file hui
> request ek purane total ke against size hoti hai. Abhi-abhi complete hue ₹300 ke
> refund ke baad poore ₹811.80 ki request ho sakti thi — aur ye function use bhej
> bhi deta, ₹811.80 ke payment par ₹1,111.80 wapas le kar.
>
> *Razorpay shayad mana kar deta. Wo bhejne ki wajah nahi hai:* apni hi arithmetic
> pakadne ke liye gateway par bharosa karna request ko `FAILED` chhod deta hai ek
> aise message ke saath jis par koi kuch kar nahi sakta.

**Crash recovery:**
```js
if (claimed.attemptCount > 1) {
  const existing = await findOurRefund(instance, transaction.razorpayPaymentId, request._id);
  if (existing) return adopt(request, existing, actor, { recovered: true });
}
```

`findOurRefund` **humare stamp kiye note par** match karta hai, amount par nahi —
ek hi value ke do partial refunds amount se alag nahi kiye ja sakte, aur galat wala
adopt karna ek asli refund ko untracked chhod deta.

> ⚠️ **Razorpay par `failed` state wala refund adopt NAHI hota.** Wo refund koi
> paisa nahi hilata. Use adopt karna recovery nahi, **trap** hai: `adopt` request
> ko `PROCESSING` par set karta hai, `refund.failed` webhook use `FAILED` karta
> hai, admin retry karta hai, ye wahi mara hua refund dhundh kar dobara adopt kar
> leta hai. **Request hamesha ke liye do states ke beech ghoomti rehti hai aur
> customer ko kabhi paisa nahi milta — jabki har screen kehti hai ki refund raste
> me hai.**

**Lookup fail ho jaye to:**
```js
throwError(503, "Could not check Razorpay for an existing refund. Left as processing
  — try again shortly.");
```
> `undefined` return karna paisa dobara bhej deta. Throw karna row ko `PROCESSING`
> par ek insaan ya reconcile job ke liye chhod deta hai — **galat hone ka safe
> tareeka.**

**Fail ho gaya to:** request `FAILED` (par **`isOpen: true`** — paisa abhi bhi jana
hai), history row, aur **admin ko CRITICAL alert**:
> Failed refund matlab wo customer jise bataya gaya ki paisa aa raha hai aur nahi
> aa raha — **aur system me aur kuch ise theek nahi karega.** Sirf ek insaan ka
> retry, ya bank transfer par switch karna, ise aage badhata hai.

### 11.14 Refund land hota hai — `refund.processed` webhook

**Helper:** `helpers/refunds/applyRefundCompletion.js`

**Ek function, ek call site**, kyunki alternative hai chhe call sites jo har ek
chhe me se paanch cheezein yaad rakhte hain.

**Kya-kya hota hai:**

```
1. Transaction.amountRefunded  ← $max se badhaya jata hai (request band hone se PEHLE)
2. RefundRequest → COMPLETED   ← conditional claim
3. refundStatus + isRefunded   ← ek hi aggregation pipeline me
4. Partial ho to settlement hold RELEASE
5. Full ho to: claim → REFUNDED, VoucherUsage reverse, slot wapas
6. Ledger entries
7. History row
8. Refund document (number + snapshot)
9. Customer ko notification (UTR ke saath)
```

**`amountRefunded` gateway ka running total leta hai, is refund ka nahi:**
```js
amountRefunded: { $max: [{ $ifNull: ["$amountRefunded", 0] }, cumulative] }
```
> ⚠️ Purana handler `$set: { amountRefunded: thisRefundsAmount }` likhta tha. Do
> partial refunds aur doosra pehle ko overwrite kar deta — ₹300 fir ₹200 refund
> hue payment par ₹200 report hota, aur vendor ka ₹310 bakaya **invisible** ho
> jata.
>
> Razorpay refund ke saath payment entity bhi bhejta hai jisme `amount_refunded`
> hota hai — **uska apna running total**. Use `$max` se lena field ko monotonic aur
> sahi banata hai redelivery, out-of-order delivery, aur dashboard se haath se
> kiye gaye refunds — teeno me. `$inc` in me se kisi me bhi survive nahi karta.

**Sab kuch ek hi aggregation pipeline me:**
> Purana shape tha number par `$max` aur uske bagal me flags par plain `$set` — aur
> wo do `refund.processed` out-of-order aate hi disagree karte hain: `$max` sahi
> tareeke se ₹810 ko ₹300 par wapas nahi le jata, jabki bagal wala `$set` khushi se
> `isRefunded` ko `false` aur `refundStatus` ko `PARTIAL` likh deta. Poori tarah
> refunded payment **partly refunded** padhne lagta — aur eligibility ke saath, wo
> use dobara payout run me daal deta.

**Partial refund vendor ki baaki sale freeze nahi kar sakta:**
```js
if (!isFullyRefunded) {
  await releaseSettlementHold({ transactionId, exceptRequestId: claimed._id,
    reason: `Partial refund completed; remainder still owed to the vendor` });
}
```
> Hold pehle **har** completed refund par lagi rehti thi. Full refund par ye sahi
> hai. ₹810 ke payment par ₹300 ke refund par isne vendor ka bacha ₹500 har future
> settlement se **hamesha ke liye aur chupchap** phansa diya — jabki refund ka
> clawback baad ke cycle se **kaata bhi ja raha tha**. Vendor ₹800 ki sale par
> lagbhag ₹1,100 ka nuksaan me tha.

**Claim ka status sirf FULL refund par badalta hai:**
> Partially refunded claim ab bhi ek claim hai jo hua — customer ne khaya, outlet
> ne serve kiya, aur paise ka ek hissa wapas gaya. Use `REFUNDED` mark karna us
> sale ko mita dena hai jo zyadatar hui thi.

**Once-per-user slot wapas jaata hai (full refund par):**
```js
holdsUsageSlot: false
```
> ⚠️ Iske bina customer ko *"you have already used this offer"* dikhta hai — ek
> aise offer ke liye jiska unhone paisa diya aur mila kuch nahi. **Ye is flow ke
> galat hone ka sabse chidhane wala tareeka hai, aur humari taraf se bilkul
> invisible hai.**

**Ledger kho jane se bachav:**
```js
if (!claimed) {
  const done = await RefundRequest.findById(refundRequest._id).lean();
  if (done?.status === COMPLETED) {
    const repaired = await postRefundEntries({ ... });   // dobara post
  }
}
```
> Conditional claim ledger likhne se **pehle** kharch ho jata hai. Beech me kahin
> throw — dropped connection, validation error, process ka marna — refund ka ledger
> reversal hamesha ke liye kho deta tha: request kehti `COMPLETED`, har redelivery
> is guard se takra kar wapas ho jati, aur un rows ko aur koi post nahi karta.
> `reconcileSettlementLedger` sirf payouts audit karta hai, to kisi ko kabhi pata
> hi nahi chalta ki books me ek reversal kam hai.
>
> Dobara post karna construction se safe hai: `ledger_type_refund_unique` har entry
> ko idempotent banata hai.

### 11.15 `MANUAL_BANK` fallback — jab paisa usi raaste wapas na ja sake

`SOURCE` refund usi card/UPI par wapas jata hai jisne pay kiya tha. Wo instrument
band ya expire ho to **har baar fail** hota hai. Isse pehle admin ke paas doosra
button tha hi nahi: request `FAILED` par padi rehti, vendor ka paisa hold me rehta,
har retry par admin ko CRITICAL aata, aur **customer ko apna paisa kabhi nahi
milta**.

```
SOURCE fail hota hai
   → admin: request-bank-details    → AWAITING_BANK_DETAILS   (customer ko notify)
   → customer bank account add karta hai   (OTP + penny drop)
   → customer: attach to this refund       → ADMIN_APPROVED
   → admin: pay-to-bank                    → PayoutLeg INITIATED, refund PROCESSING
   → admin haath se NEFT karta hai
   → admin: confirm-bank-payout with UTR   → leg PAID → applyRefundCompletion
```

| API | Auth | Kya |
|---|---|---|
| `PATCH /refunds/admin/:requestId/request-bank-details` | Admin | Sirf `FAILED` se. Reason required |
| `PATCH /refunds/:requestId/bank-account` | Customer | Apne **verified** accounts me se ek chunta hai |
| `PATCH /refunds/admin/:requestId/pay-to-bank` | Admin | Leg kholta hai |
| `PATCH /refunds/admin/:requestId/confirm-bank-payout` | Admin | UTR |
| `PATCH /refunds/admin/:requestId/fail-bank-payout` | Admin | NEFT bounce |

**Customer bank account add karne ke APIs:**
`POST /bank-accounts/otp`, `POST /bank-accounts/` (verify), `GET /bank-accounts/`,
`DELETE /bank-accounts/:id`

> ⚠️ **Admin-initiated, kabhi automatic nahi.** `SOURCE` ka fail hona hamesha dead
> instrument nahi hota — gateway ka blip bhi waise hi fail hota hai, aur retry
> aksar chal jata hai. Automatic switch karna matlab do minute ke outage par har
> customer se bank details maangna — **aur bina zaroorat maangi gayi bank details
> hi wo cheez hai jisse refund flow phishing jaisa dikhne lagta hai.**

> ⚠️ **Sirf verified account.** Unverified row ye record hai ki kisi ne koshish ki,
> destination nahi — penny drop us account par bhi fail ho sakta hai jo exist karta
> hai, aur usme ki gayi NEFT wapas nahi aa sakti.

**`AWAITING_BANK_DETAILS` par nazar:** `remindCustomersAboutBankDetails` job (har
ghante). Do nudge (`bankDetailsReminderHours: [24, 96]` — **din ke faasle par,
ghante ke nahi**), fir `bankDetailsStaleDays: 30` ke baad admin ko.

> **Chup customer ki keemat VENDOR par padti hai:** `settlementHold` us payment ko
> har settlement se bahar rakhti hai jab tak koi kuch na kare, aur kuch karne wala
> koi tha hi nahi. Ye deadline customer ke liye nahi hai — unka paisa unka hi
> rehta hai — ye **vendor ke liye** deadline hai.

### 11.16 Refund customer ko kaise dikhta hai

Internal vocabulary internal rehti hai:

| Internal status | Customer ko |
|---|---|
| `REQUESTED` | "Refund requested" |
| `VENDOR_APPROVED` | "Approved by the outlet" |
| `VENDOR_REJECTED` | "Declined by the outlet" |
| `VENDOR_TIMEOUT` | **"Under review by Trydood"** |
| `ADMIN_APPROVED` | "Approved — processing" |
| `ADMIN_REJECTED` | "Declined after review" |
| `ADMIN_OVERRIDE` | "Approved by Trydood" |
| `PROCESSING` | "On its way to your account" |
| `COMPLETED` | "Refunded" |
| `FAILED` | "Refund failed — we are on it" |
| `AWAITING_BANK_DETAILS` | **"Add your bank account so we can send it"** |
| `CANCELLED` | "Withdrawn" |

> `AWAITING_BANK_DETAILS` ka label ekmatra hai jo customer se **kuch karne** ko
> kehta hai, isliye wo batata hai **kya**. "Awaiting bank details" humari queue
> describe karta hai, unka agla step nahi. Jiska refund ek baar fail ho chuka hai
> usse usi vaakya me batana padega ki paisa abhi bhi unka hai aur kya karne se
> aayega — warna wajib reading yahi hai ki wo gum ho gaya.

**Vendor ka note kabhi customer ko nahi dikhta:**
> `notifyCustomerRefundRejected` `REFUND_CUSTOMER_LABEL` render karta hai, vendor
> ka likha note kabhi nahi: wo note staff-to-staff hai, aur *"customer collected
> the order in full"* aisa vaakya nahi hai jo us customer ko dikhaya ja sake jiske
> baare me hai.

---

## PHASE 12 — Refund ka settlement par asar (clawback)

### 12.1 Teen alag-alag situations

| Situation | Kya hota hai |
|---|---|
| Refund request payout se **pehle** | `settlementHold` payment ko cycle se bahar rakhti hai. Vendor ko us sale ka paisa milta hi nahi. **Clawback ki zaroorat nahi.** |
| Refund request payout ke **beech** (build ho chuka, pay nahi hua) | `taintSettlement` flag lagati hai → approval/pay mana karta hai → admin rebuild karta hai |
| Refund **payout ke baad** complete hua | `claimRefundAdjustments` agle cycle se clawback leta hai |

**Golden rule teesri situation ko exception banati hai, rule nahi.**

### 12.2 Clawback claim kaise hota hai

```js
// helpers/settlements/settlementClaims.js:148
const candidates = await RefundRequest.find({
  brandId,
  status: COMPLETED,
  settlementId: null,      // ← abhi tak kisi cycle ne nahi liya
  writtenOffAt: null,      // ← write-off ho chuka clawback dobara nahi aata
  isDeleted: false,
});
```

Fir **sirf un refunds ko** jinke payment par `settlementId` hai:

```js
const settledPayments = await Transaction.find({
  _id: { $in: candidates.map(r => r.transactionId) },
  settlementId: { $ne: null },
});
```

> **Clawback ka matlab sirf ek hai:** vendor ko us sale ka paisa mila jo baad me
> wapas ho gayi. Agar payment unhe kabhi pahuncha hi nahi, to claw karne ko kuch
> hai hi nahi — aur fir bhi kaat lena **paisa do baar lena** hai.
>
> Exactly yahi ho raha tha **poori tarah** refunded payment ke saath: wo
> eligibility se hamesha ke liye bahar hai, to `settlementId` null rehta hai aur
> vendor ko uska paisa kabhi nahi milta — aur ye uska refund fir bhi claim kar ke
> unki **doosri** sales se clawback kaat leta tha.

**`settlementId: { $ne: null }` ek hi test do case cover karta hai:**

- **Pichhle cycle me pay hua** — payment par us settlement ki id hai, to refund
  yahan claim hota hai aur abhi deduct hota hai
- **Partially refunded, abhi settle ho raha hai** — `claimTransactions` pehle chala
  aur isi settlement ki id stamp kar di, to refund saath me claim hota hai aur usi
  cycle me net off ho jata hai

**Refunds pehle, unke payments baad me — ulta nahi:**
> Mongo se "is brand ke har settled payment" maang kar `$in` me daalna sahi hai
> aur scale nahi karta: wo set brand ki **poori history** hai aur hamesha badhta
> hai, jabki jawab sirf un gine-chune refunds par depend karta hai jo abhi tak
> unclaimed hain. Ek busy brand har cycle, har brand ke liye ek lakh-element `$in`
> banata.

### 12.3 Deduct kitna hota hai

```js
const refundAdjustment = refunds.reduce(
  (sum, r) => sum + (Number(r.split?.vendorClawback) || 0), 0,
);
```

**`vendorClawback`, `totalRefund` nahi.**
> Customer ko jo wapas mila usme humari convenience fee aur promo ka humara hissa
> bhi tha, aur wo dono vendor se nahi aate.

### 12.4 Vendor ko kya dikhta hai

Uske settlement statement par:
```
Gross collected       ₹ 24,800.00
Vendor promo cost     −    450.00
Commission            −      0.00
Refund adjustment     −  1,570.00   ← pichhle cycles ke refunds
Chargeback adjustment −      0.00
Reserve held          −      0.00
Reserve released      +      0.00
─────────────────────────────────
Net payable           ₹ 22,780.00
```

Aur agar deductions sales se zyada ho gaye to `CARRIED_FORWARD` +
`SETTLEMENT_CARRIED_FORWARD` notification.

---

## PHASE 13 — Dispute / chargeback

### 13.1 Dispute kya hai

Customer apne **bank** se kehta hai ki ye charge galat tha. Bank paisa
**humse** wapas kheench leta hai. Ye refund se alag hai — isme humari marzi nahi
chalti.

### 13.2 Webhook events

| Event | `DISPUTE_STATUS` |
|---|---|
| `payment.dispute.created` | `OPEN` |
| `payment.dispute.under_review` | `UNDER_REVIEW` |
| `payment.dispute.action_required` | `ACTION_REQUIRED` |
| `payment.dispute.won` | `WON` |
| `payment.dispute.lost` | `LOST` |
| `payment.dispute.closed` | `CLOSED` |

### 13.3 Dispute aate hi kya hota hai

- `Dispute` row banti/update hoti hai
- `Transaction.settlementHold: true` — payment har future cycle se bahar
- `taintSettlement` — agar payment pehle se kisi settlement me hai to wo flag ho
  jata hai (approval/pay mana karenge)
- `disputeRespondBy` deadline set hoti hai

### 13.4 `isDisputed` eligibility me kyun nahi use hota

```js
settlementHold: false,     // ← ye use hota hai
// isDisputed: false       ← ye NAHI
```

> `isDisputed` track karta hai ki dispute **live** hai ya nahi. To jo chargeback
> humne **haara**, wo sahi tareeke se use wapas `false` kar deta hai — aur us par
> key karna us row ko bilkul payable dikha deta jise humne abhi khoya hai.
>
> `settlementHold` **monotonic** hai. Wahi single flag ineligibility carry karta hai.

### 13.5 Dispute APIs

| API | Auth | Kya |
|---|---|---|
| `GET /trydood/v1/disputes/` | Token | Dispute list (scope token se) |
| `GET /trydood/v1/disputes/:disputeId` | Token | Ek dispute |
| `POST /trydood/v1/disputes/:disputeId/evidence` | Vendor/Admin | Evidence upload |
| `GET /trydood/v1/disputes/:disputeId/evidence-pack` | Vendor/Admin | Evidence bundle download |

### 13.6 Deadline — ekmatra money deadline jise aur kuch nahi dekhta

**Job:** `disputeDeadlines` (har **ghante**, daily nahi)

> `disputeRespondBy` webhook likhta tha aur **koi nahi padhta tha**. Nikal jaane
> wali dispute deadline **automatic haar** hai — bank dobara nahi poochhta,
> Razorpay chase nahi karta, aur koi error nahi uthta, kyunki system ki nazar me
> **kuch hua hi nahi**.
>
> Ghante-ghante, daily nahi: aakhri warning 24h pehle fire hoti hai, aur daily
> sweep use aakhri din me kahin bhi land kar sakti hai — **uske baad bhi.**
>
> Sirf alert karta hai. Evidence file karne ke liye Razorpay dashboard wala insaan
> chahiye, aur har dispute par **exactly ek** response hota hai.

### 13.7 Dispute haar gaye to — recovery

Jab `payment.dispute.lost` aata hai:
- `CHARGEBACK` ledger entry (VENDOR_PAYABLE DEBIT)
- `postChargebackLoss` har loss ko **cap** karta hai us cheez ke against jo wo
  payment pehle hi de chuka hai

**Fir agle settlement me recovery:**
```js
const lost = await Dispute.find({
  brandId, status: LOST,
  recoverySettlementId: null,   // ← lock
  writtenOffAt: null,
});
```

**Teen important baatein:**

**1. Lock DISPUTE par hai, payment par nahi.**
> Pehle ye `Transaction.chargebackSettlementId` tha — ek lock per payment. Ledger
> dispute par key karta hai, to **do lost disputes wala ek payment do `CHARGEBACK`
> losses book karta aur ek recover karta** — doosra chupchap maaf ho jata, aur
> books dono dikhate rehte.

**2. Amount ledger se padha jata hai, recompute nahi hota.**
```js
const chargebackAdjustment = chargebacks.reduce(
  (sum, dispute) => sum + Math.max(0, Number(dispute.recoverAmount) || 0), 0,
);
```
> Recompute karna us cap ko ignore karta jo `postChargebackLoss` lagata hai, aur
> vendor se poora share **do baar** charge kar leta — books kehti ki humne wo paisa
> recover kiya jo kabhi khoya hi nahi tha.

**3. Sirf un payments par jinka vendor ko paisa mila.**
> Agar dispute payout se pehle aayi, `settlementHold` ne payment ko har cycle se
> bahar rakha — vendor ko kabhi mila hi nahi, to recover karne ko kuch nahi hai.

**4. Sirf wo dispute jiska loss ledger actually carry karta hai.**
```js
const claimable = onPaidOut.filter(d => (bookedBy.get(d.disputeId) || 0) > 0);
```
> Agar `CHARGEBACK` entry missing hai, loss kabhi book hua hi nahi — aur fir bhi
> dispute claim karna uspar `recoverySettlementId` stamp kar deta **zero** recovery
> ke liye: hamesha ke liye recovered mark, bina kuch liye. Wahi silently-forgiven
> bug jise ye poora lock rokne aaya hai, naya chehra pehne.

> ⚠️ **`chargebackAdjustment` pehle hardcoded `0` tha.** `vendor_settlement_plan.md`
> §7.5 ne agle cycle se recovery ko default chuna tha — wo kabhi implement hua hi
> nahi. Platform chupchap har haari hui dispute kha jata tha aur books ek healthy
> sale dikhati thi.

---

## PHASE 14 — Reserve hold aur release

### 14.1 Reserve kya hai

Risky vendor ke payout ka ek hissa rok kar rakhna, **future chargebacks ke against**.

**Aaj ye OFF hai** (`reserve.isEnabled: false`).

### 14.2 Settings

| Setting | Default | Kya |
|---|---|---|
| `reserve.isEnabled` | `false` | Master switch |
| `reserve.percent` | `5` | Base rate — jinke against kuch nahi wo yahi bharte hain |
| `reserve.holdDays` | `30` | Kitne din rokna |
| `reserve.riskChargebackCount` | `2` | Window me kitne chargebacks ke baad dekhna shuru |
| `reserve.riskLookbackDays` | `180` | Count aur rate kitna peeche tak napte hain |
| `reserve.riskMinPayments` | `20` | Isse kam payments par base rate hi (chhota sample) |
| `reserve.riskDisputeRatePercent` | `1` | Chargebacks ÷ payments % jiske upar risky |
| `reserve.riskPercent` | `15` | Risky brand kya bharta hai |
| `reserve.maxPercent` | `25` | **Ceiling** |
| `newVendorReserveDays` | `0` | Naye brand ke pehle kuch din (0 = off) |

> **`riskChargebackCount` akela kyun kaafi nahi:** count size ko saza deta hai.
> 10,000 sales par 2 chargebacks wala brand 40 sales par 2 wale se **safe** hai,
> aur pehle se zyada rokna behtar merchant se zyada rokna hai.
> `riskDisputeRatePercent` doosra aadha hai.

> **`riskMinPayments` kyun:** teen sales me se ek chargeback 33% hai aur kuch nahi
> kehta — sample itna chhota hai ki koi raay nahi rakh sakta. Iske bina ek unlucky
> hafta naye outlet ka paisa unke pehle mahine me freeze kar deta.

> **`maxPercent` kyun:** ye business decision hai, arithmetic nahi. Iske bina ek
> bura mahina lagbhag sab kuch rok leta aur vendor ko unke apne cash flow se kaat
> deta — **jo ek recoverable problem ko band outlet bana deta hai.**

### 14.3 Rate settlement par FREEZE hota hai

```js
reservePercent: round2(reservePercent),
reserveBasis: {
  reason: risk?.basis,               // RESERVE_BASIS
  disputeCount, paymentCount, disputeRatePercent, lookbackDays,
},
```

> ⚠️ Pehle `reserveHeld` store hota tha aur **rate nahi** — jo tab tak theek tha
> jab tak har brand ek hi rate bharta tha. Ab jab rate ek **trailing** chargeback
> window se aata hai, wo window statement khulne tak hil chuki hoti hai — to
> *"March me mujhse 15% kyun roka gaya?"* ka jawab aaj ka number recompute kar ke
> dena matlab ek **alag number** dena, aur page ki arithmetic reproduce hona band
> ho jati hai.
>
> `reserveBasis` **kaam** carry karta hai, sirf jawab nahi: *"tumhare 260 sales me
> 180 din me 4 chargebacks the"* aisi baat hai jis par vendor behes kar sakta hai.
> *"15%"* nahi hai.

**`RESERVE_BASIS` values:** `DISABLED`, `BASE`, `TOO_FEW_PAYMENTS`,
`RISK_CHARGEBACKS`, `NEW_VENDOR`.

### 14.4 Rate poori run ke liye ek baar decide hota hai

```js
const reserveRisk = await buildReserveRiskMap({ brandIds, settings });
```

> ⚠️ Loop ke **andar nahi**. Obvious shape — ek helper jo ek `brandId` leta hai,
> har brand par call hota hai — do extra round trips × jitne brands raat me hain,
> jo exactly wo number hai jo badhta hai. Do aggregation, brand se grouped, sabka
> jawab de deti hain.
>
> Aur wo **neeche pass** hota hai, dobara fetch nahi. Jo rate reserve calculation
> aur usse record karne wali row ke beech hil gaya, wo aisa settlement banata hai
> **jiski apni arithmetic add nahi hoti.**

### 14.5 Release — aur wo jagah jahan paisa hamesha ke liye phans sakta tha

```js
const matured = await Settlement.find({
  brandId,
  status: PAID,                          // ← sirf PAID se
  reserveHeld: { $gt: 0 },
  reserveReleaseSettlementId: null,      // ← lock
  paidAt: { $ne: null, $lte: maturedBefore },
});
```

> ⚠️ **`reserveHeld` poori tarah wired tha** — compute hota tha, `netPayable` se
> ghatta tha, ledger me `RESERVE_HOLD` book hota tha. **`reserveReleased` ek
> hardcoded `0` tha**, `RESERVE_RELEASE` ek ledger type tha jise koi likhta nahi
> tha, aur koi job thi hi nahi.
>
> To `reserve.isEnabled: true` ke saath paisa reserve me jata aur **kabhi bahar
> nahi aata** — hamesha ke liye, chupchap, aur beech ka har settlement bilkul sahi
> dikhta.
>
> Ye is system me **teesra field** tha jiska yahi shape tha, `chargebackAdjustment`
> aur `commissionTax` ke baad.

**Clock `paidAt` se chalti hai, period se nahi:**
> Hold isliye hai ki paisa **nikalne ke baad** aane wale chargebacks cover ho, to
> ghadi tab shuru honi chahiye jab paisa nikla — period band hone par nahi, aur
> admin ke approve karne par bhi nahi.

**Sirf `PAID` se:**
> Reserve tabhi exist karta hai jab wo payout actually nikal chuka ho jisse roka
> gaya tha. Cancelled, carried-forward ya reversed settlement ne kuch roka hi nahi
> — wapas dene ko kuch nahi hai, aur usse release karna **paisa invent karna** hai.

**Ledger:**
| Entry | Account | Direction | Kab |
|---|---|---|---|
| `RESERVE_HOLD` | VENDOR_PAYABLE | DEBIT | Final leg par, ek baar |
| `RESERVE_RELEASE` | VENDOR_PAYABLE | CREDIT | Final leg par, ek baar |

> Per-leg book karna reserve ko kai baar rok deta / kai baar wapas de deta.

---

## PHASE 15 — Vendor debt aur write-off

### 15.1 Problem

Jis brand ke deductions unki takings se zyada ho jayein, uska settlement **negative
`netPayable`** ke saath banta hai. Wo `CARRIED_FORWARD` jata hai, aur carry forward
karna matlab **har claim release kar dena**.

**Jab tak wo trade kar rahe hain, nayi sales isse net off kar deti hain.**

**Jis din wo band kar dete hain** — wahi rows har cycle claim aur release hote
rehte hain, hamesha ke liye. **Kuch error nahi hota, kuch log nahi hota, koi report
nahi dikhati.** Aur paisa humari books par ek aise insaan se receivable ki tarah
baitha rehta hai jo wapas nahi aa raha.

### 15.2 Alert

**Job:** `alertVendorDebt` (**daily**)

> Daily kyunki state static hai — is position wala brand kal bhi usi me hai, aur
> isse tight kuch bhi ek aise decision par noise hai jo koi 3am par nahi leta.
>
> **Alert karta hai, act kabhi nahi karta:** debt write off karne par kisi insaan
> ka naam hota hai.

### 15.3 Debt dekhna

**API:** `GET /trydood/v1/settlements/admin/debt/:brandId`
**Auth:** `isAdmin` — **sirf admin**

> ⚠️ **Settlement id par nahi, brand par keyed hai.** Ye exactly wo paisa hai jise
> koi settlement carry nahi kar paaya, to settlement id hi wo ek key hai jo
> definition se ise rakhti hi nahi.

> **Vendor ko ye kyun nahi dikhta:** wo consequence dekhte hain — wo cycle jisne
> unhe kuch nahi diya, aur kyun — `SETTLEMENT_CARRIED_FORWARD` aur apne statement
> se. Jo unhe **nahi** dikhna chahiye wo hai "outstanding debt" heading wali screen
> jisme ek figure ho: wo **invoice jaisa padhta hai**, aur unke bharne ke liye
> kuch hai hi nahi.

**Ye rows ginta hai** (unclaimed deductions, kitne purane), balance nahi:
> Brand ka `VENDOR_PAYABLE` balance *"net position kya hai?"* ka jawab deta hai.
> Ye alag sawaal hai.

### 15.4 Write off

**API:** `PATCH /trydood/v1/settlements/admin/debt/:brandId/write-off`
**Auth:** `isAdmin`
**Body:** `{ "reason": "Brand closed in Aug 2026, no recovery possible" }` — **required**

**Har row par ek matched pair likhta hai:**

| Entry | Account | Direction | Kyun |
|---|---|---|---|
| `MANUAL_ADJUSTMENT` | VENDOR_PAYABLE | CREDIT | Taaki koi future cycle debt na dekhe |
| `MANUAL_ADJUSTMENT` | PLATFORM_COST | DEBIT | Kyunki humne wo absorb kiya |

**Aur `writtenOffAt` stamp hota hai:**
```js
// claimRefundAdjustments / claimChargebackAdjustments dono me:
writtenOffAt: null,
```
> ⚠️ Iske bina write-off cosmetic hai: row agle build me dobara claim hoti,
> dobara deduct hoti, `netPayable` dobara negative karti, aur dobara release hoti —
> wahi endless loop jise khatam karne write-off aaya tha, ab bas ledger me ek
> `MANUAL_ADJUSTMENT` ke saath jo kehta hai ki platform ne isse pehle hi absorb kar
> liya. **Books nuksaan ko do baar gin leti.**

> **Reason required kyun:** ledger kabhi edit nahi hota, aur bina wajah wala
> adjustment mahino baad galti se alag nahi kiya ja sakta.

---

## Background jobs — jo apne aap chalte hain

**Runner:** `jobs/index.js` — dependency-free (`setInterval`), har job boot par ek
baar chalta hai fir apne interval par.

**Do lock:**
- `inFlight` Set — ek process me overlap nahi
- `JobLock` collection — **processes ke beech** overlap nahi (PM2 cluster, do dyno)

**Health record:** har run apna outcome usi `JobLock` row me likhta hai.
> Sabse mehnga failure wo job nahi hai jo throw kare — wo log ho jata hai. Wo hai
> **`ENABLE_JOBS=false` jo debugging session ke baad set chhod diya gaya**, ya
> ghanton se down process. Kuch error nahi hota; safety nets bas ruk jate hain, aur
> ye din baad kahin phansa hua paisa ban kar dikhta hai.

### Claim side

| Job | Interval | Kya karta hai |
|---|---|---|
| `releaseStaleClaimHolds` | 15 min | Abandoned checkout ka once-per-user slot free. **Cancel karne se pehle Razorpay se poochhta hai** |
| `resumeIncompleteSettlements` | 15 min | **Sabse important.** `verified: true` par jo `COMPLETE` nahi — dobara settle karta hai |
| `reconcileClaimPayments` | 30 min | Wo payments jo gateway ne le liye par na webhook ne na browser ne bataya |
| `alertStuckAuthorizations` | 30 min | Bank ke paas paisa hold me hai aur kisi ne uthaya nahi. **Ye fire ho to auto-capture off hai aur har payment usi haal me hai** |
| `releaseStalePromoReservations` | 15 min | Adhure order ka promo hold wapas |

### Refund side

| Job | Interval | Kya karta hai |
|---|---|---|
| `escalateStaleRefunds` | 15 min | Chup vendor ke baad `VENDOR_TIMEOUT` |
| `reconcileRefunds` | 30 min | Razorpay gaye aur wapas nahi aaye refunds. **Sirf READ** — refund issue karna `executeRefund` ka kaam hai |
| `remindVendorsAboutRefunds` | 60 min | Window band hone se pehle **do** nudge |
| `remindCustomersAboutBankDetails` | 60 min | `AWAITING_BANK_DETAILS` — do nudge, fir admin ko |

### Settlement side

> Baaki har money path loudly fail hota hai. Settlement **na hone se** fail hota
> hai — koi build nahi, unconfirmed NEFT, ek payout jisne koi ledger row nahi
> likhi — aur **absence ko dhundhna padta hai.** Ye jobs wahi karte hain.

| Job | Interval | Kya karta hai |
|---|---|---|
| `buildSettlements` | 60 min | Settlement banata hai. Idempotent, to down raat agle tick par heal ho jati hai |
| `sweepStalePayouts` | 30 min | NEFT shuru hui aur confirm nahi hui. **Alert karta hai, act kabhi nahi** — paisa sach me ja chuka ho sakta hai |
| `alertLateSettlements` | 60 min | Promise kiye window se zyada purana bakaya — taaki pehla jaanne wala intezaar karta vendor na ho |
| `reconcileSettlementLedger` | 180 min | Books aur bank transfers agree karte hain? **Read-only** |
| `sweepStrandedClaims` | 60 min | Wo rows jo terminal settlement ab bhi pakde hai — `beforeRelease` throw ka nishan |
| `sweepAbandonedDrafts` | 60 min | Khali `DRAFT` jiski key period ghere baithi hai (warna agla build us brand ka din **hamesha ke liye** skip karta) |
| `alertVendorDebt` | **Daily** | Wo debt jisko koi cycle nahi pahunch sakta |

### Aur

| Job | Interval | Kya karta hai |
|---|---|---|
| `disputeDeadlines` | 60 min | Nikalne wali dispute deadline = automatic haar. **Alert only** |
| `reapShadowIndexes` | 60 min | Purana build `invoiceId_1` blanket unique index dobara bana deta hai — usse hatata hai |

> ⚠️ **`reapShadowIndexes` ka case samajhne layak hai:** `invoiceId_1` **doosre**
> us transaction ko reject karta hai jiska invoice abhi nahi bana — aur har voucher
> claim apne invoice se pehle banta hai. To jab tak wo index maujood hai, lagbhag
> **har doosra claim** duplicate-key error se fail hota hai ek aise field par jise
> customer ne chhua tak nahi. Aur har doosri layer ko wo validation error jaisa
> dikhta hai.

---

## Status machines — ek jagah par

### VoucherClaim

```
PENDING ──┬──► REDEEMED   (Phase 1: counter par pay karna hi redemption hai)
          ├──► PAID       (Phase 2: scan ka intezaar)
          ├──► FAILED     (gateway ne mana kiya / sweep ne band kiya)
          └──► CANCELLED

PAID ─────┬──► REDEEMED   (Phase 2: outlet ne scan kiya)
          └──► EXPIRED    (Phase 2: window me scan nahi hua)

PAID / REDEEMED ──► REFUNDED   (full refund)
```

**Refundable statuses:** `PAID`, `REDEEMED`

### Settlement

```
DRAFT
  ├──► PENDING_APPROVAL
  │       ├──► APPROVED ──► PROCESSING ──► PAID ──► REVERSED     (release)
  │       │                            └─► FAILED ──► APPROVED   (retry in place)
  │       │                                       └─► ABANDONED  (release)
  │       ├──► ON_HOLD ──► PENDING_APPROVAL        (rebuild ke baad)
  │       │            └─► CARRIED_FORWARD          (release)
  │       ├──► CARRIED_FORWARD                      (release)
  │       └──► CANCELLED                            (release)
  ├──► APPROVED            (requiresAdminApproval: false)
  ├──► CARRIED_FORWARD     (kuch dena hi nahi)
  └──► CANCELLED
```

**Release karne wale statuses:** `CANCELLED`, `ABANDONED`, `REVERSED`, `CARRIED_FORWARD`

> `PAID` jaan-boojh kar nahi hai: wo paisa nikal gaya. Wo sirf `REVERSED` se
> release hota hai, aur sirf `PAYOUT_REVERSAL` ledger entry ke baad.
>
> `FAILED` bhi nahi hai: wahan default retry-in-place hai, aur bounce par release
> karna settlement ke rows agle cycle me bikher deta aur uska number aur statement
> kho deta.

**Open statuses** (rows ab bhi hold me): `DRAFT`, `PENDING_APPROVAL`, `APPROVED`,
`PROCESSING`, `ON_HOLD`, `FAILED`

**Pre-payout statuses** (risk event abhi bhi free me exclude ho sakta hai):
`DRAFT`, `PENDING_APPROVAL`, `APPROVED`

### PayoutLeg

```
INITIATED ──┬──► PAID ──► REVERSED
            └──► FAILED
```

### RefundRequest

```
REQUESTED
   ├──► VENDOR_APPROVED ──► ADMIN_APPROVED ──► PROCESSING ──► COMPLETED
   │                                                      └─► FAILED ──┐
   │                                                                    │
   │    ┌───────────────────────────────────────────────────────────────┘
   │    ▼
   │  AWAITING_BANK_DETAILS ──► ADMIN_APPROVED ──► PROCESSING ──► COMPLETED
   │
   ├──► VENDOR_REJECTED ──► ADMIN_OVERRIDE / ADMIN_REJECTED
   ├──► VENDOR_TIMEOUT  ──► ADMIN_OVERRIDE / ADMIN_REJECTED
   └──► CANCELLED
```

**Open statuses:** `REQUESTED`, `VENDOR_APPROVED`, `VENDOR_TIMEOUT`,
`ADMIN_APPROVED`, `ADMIN_OVERRIDE`, `PROCESSING`, `FAILED`, `AWAITING_BANK_DETAILS`

> `FAILED` jaan-boojh kar open hai: paisa abhi bhi jana hai, aur admin isi se retry
> karta hai.

**Hold release karne wale statuses:** `VENDOR_REJECTED`, `ADMIN_REJECTED`, `CANCELLED`

> `FAILED` aur `COMPLETED` jaan-boojh kar nahi hain: failure ke baad paisa abhi bhi
> jana hai, aur completion ke baad wo vendor ka raha hi nahi.

---

## Complete API index

**Base:** `/trydood/v1`

### Customer — voucher dhundhna aur claim karna

| Method | Path | Auth | Use case |
|---|---|---|---|
| GET | `/vouchers/customer/get-all` | Optional | Voucher browse |
| GET | `/vouchers/customer/get/:voucherId` | Optional | Ek voucher ka detail |
| POST | `/vouchers/customer/voucher/preview` | Optional | Bill daal ke price dekhna |
| POST | `/voucher-claims/create-order` | **Customer** | Claim + Razorpay order |
| POST | `/voucher-claims/verify` | **Customer** | Payment confirm (browser callback) |
| GET | `/voucher-claims/` | Token | Meri claims / brand ki claims / sab (scope token se) |
| GET | `/voucher-claims/:claimId` | Token | Ek claim + timeline |
| GET | `/voucher-claims/code/:claimCode` | Token | Claim code se dhundhna (counter/support) |
| GET | `/voucher-claims/payments` | Token | Payment listing |
| GET | `/voucher-claims/payments/:transactionId` | Token | Ek payment (push notification ka deep link) |

### Customer — refund

| Method | Path | Auth | Use case |
|---|---|---|---|
| POST | `/refunds/` | **Customer** | Refund maangna |
| PATCH | `/refunds/:requestId/withdraw` | **Customer** | Apni request wapas lena |
| PATCH | `/refunds/:requestId/bank-account` | **Customer** | Failed refund ke liye bank account chunna |
| GET | `/refunds/` | Token | Refund listing |
| GET | `/refunds/:requestId` | Token | Ek refund |

### Customer — bank accounts

| Method | Path | Auth | Use case |
|---|---|---|---|
| POST | `/bank-accounts/otp` | **Customer** | OTP maangna |
| POST | `/bank-accounts/` | **Customer** | Account add + penny drop verify |
| GET | `/bank-accounts/` | **Customer** | Apne accounts |
| DELETE | `/bank-accounts/:accountId` | **Customer** | Account hatana |

### Vendor — refund decide karna

| Method | Path | Auth | Use case |
|---|---|---|---|
| PATCH | `/refunds/:requestId/approve` | **Vendor/SubVendor** | Approve (kam amount bhi) |
| PATCH | `/refunds/:requestId/reject` | **Vendor/SubVendor** | Reject (**note required**) |

### Vendor + Admin — settlement padhna

| Method | Path | Auth | Use case |
|---|---|---|---|
| GET | `/settlements/` | Token | Payout history (scope token se) |
| GET | `/settlements/:settlementId` | Token | Ek settlement ka detail |
| GET | `/settlements/:settlementId/transactions` | Token | Statement lines (paged) |

> **Settlement par koi vendor-facing write nahi hai.** Vendor apna paisa padhta hai
> aur support ke through dispute karta hai — **settlement humara record hai ki hum
> unhe kya dete hain, wo document nahi jo wo bharte hain.**

### Admin — settlement chalana

| Method | Path | Use case | Reason required? |
|---|---|---|---|
| PATCH | `/settlements/admin/:id/approve` | Sign off | ❌ |
| PATCH | `/settlements/admin/:id/rebuild` | Bure rows nikaal kar dobara (`ON_HOLD` se) | ❌ |
| PATCH | `/settlements/admin/:id/hold` | Review ke liye rokna | ❌ |
| PATCH | `/settlements/admin/:id/cancel` | Poora mana karna (rows release) | ✅ |
| PATCH | `/settlements/admin/:id/abandon` | `FAILED` par jise retry nahi karenge | ✅ |
| PATCH | `/settlements/admin/:id/pay` | Payout leg kholna | ❌ |
| PATCH | `/settlements/admin/:id/confirm` | UTR daalna | **UTR** ✅ |
| PATCH | `/settlements/admin/:id/fail` | Bank ne bounce kiya | **note** ✅ |
| PATCH | `/settlements/admin/:id/retry` | Dobara koshish (bank refresh hota hai) | ❌ |
| PATCH | `/settlements/admin/:id/reverse` | Paid payout wapas aa gaya | ✅ |
| GET | `/settlements/admin/debt/:brandId` | Brand ka unclaimed debt | — |
| PATCH | `/settlements/admin/debt/:brandId/write-off` | Chasing band karna | ✅ |

### Admin — refund chalana

| Method | Path | Use case | Reason required? |
|---|---|---|---|
| PATCH | `/refunds/admin/:id/approve` | Clear for payment | Override par ✅ |
| PATCH | `/refunds/admin/:id/reject` | Mana karna | ✅ |
| PATCH | `/refunds/admin/:id/pay` | Razorpay se paisa bhejna | ❌ |
| PATCH | `/refunds/admin/:id/request-bank-details` | `SOURCE` fail hua, bank maangna | ✅ |
| PATCH | `/refunds/admin/:id/pay-to-bank` | NEFT leg kholna | ❌ |
| PATCH | `/refunds/admin/:id/confirm-bank-payout` | UTR | **UTR** ✅ |
| PATCH | `/refunds/admin/:id/fail-bank-payout` | NEFT bounce | ✅ |

### Admin — dispute, health, documents

| Method | Path | Auth | Use case |
|---|---|---|---|
| GET | `/disputes/` | Token | Dispute list |
| GET | `/disputes/:disputeId` | Token | Ek dispute |
| POST | `/disputes/:disputeId/evidence` | Vendor/Admin | Evidence upload |
| GET | `/disputes/:disputeId/evidence-pack` | Vendor/Admin | Evidence bundle |
| GET | `/transactions/admin/health` | **Admin** | Payment health dashboard |
| PATCH | `/transactions/admin/:transactionId/release-hold` | **Admin** | Held payment ko settlement run me wapas |
| GET | `/transactions/webhook/events` | **Admin** | Webhook event log |
| GET | `/transactions/webhook/events/:eventId` | **Admin** | Ek event |
| POST | `/transactions/webhook/replay/:eventId` | **Admin** | Event replay |
| GET | `/documents/:token` | **None** | Invoice / statement / refund doc download |

### Webhooks (Razorpay)

| Method | Path | Kya |
|---|---|---|
| POST | `/transactions/webhook/razorpay/customer` | Customer merchant — claims, refunds, disputes, settlements |
| POST | `/transactions/webhook/razorpay` | Vendor merchant — subscriptions |

---

## End-to-end numeric example

**Scenario:** Customer "Pizza Palace" me ₹1,000 ka bill banata hai.
Voucher par 20% off (max ₹200) ka offer hai. Promo code `SAVE50` bhi hai
(flat ₹50, net bill par, cost bearing: vendor 30% / platform 70%).

**Settings:** GST off, `commissionPercent: 0`, reserve off, `minPayoutAmount: 100`,
`delayDays: 3`.

### Step 1 — Pricing (`POST /vouchers/customer/voucher/preview`)

```
billAmount        = 1,000.00
offerDiscount     =   200.00     (20% of 1000, max 200 se kam)
netBill           =   800.00     (1000 − 200)

convenienceFee    =    10.00     ceil(1000/500) × 5 = 2 × 5
                                 ⚠️ ORIGINAL bill par, 800 par nahi
promoDiscount     =    50.00
  vendorPromoCost =    15.00     (30% of 50)
  platformPromoCost =  35.00     (remainder — hamesha exactly)

taxOnTop          =     0.00     (GST off)

totalPayable      =   760.00     (800 − 50 + 10 + 0)
amountInPaise     =  76,000
youSaved          =   250.00     (200 + 50)

commissionPercent =     0
commissionAmount  =     0.00
commissionDeduction =   0.00
vendorPayable     =   785.00     (800 − 15 − 0)
```

**Customer ko dikhta hai:** *"₹1,000 ka bill, ₹250 bache, aap ₹760 dete hain."*

### Step 2 — Order (`POST /voucher-claims/create-order`)

```
VoucherClaim  → PENDING, claimCode TD-8F3K2Q, holdsUsageSlot: true
Transaction   → CREATED, amount 760.00, idempotencyKey stored
PromoCodeUsage → reserved
Razorpay order → order_abc123, amount 76000
```

### Step 3 — Payment (`POST /voucher-claims/verify` + webhook)

Razorpay ka payment: `amount: 76000`, `fee: 1794` (₹17.94 — 2% + 18% GST), `captured: true`

```
Transaction  → verified: true, status CAPTURED, paidAmount 760.00,
               gatewayFee 17.94, netReceived 742.06
VoucherClaim → REDEEMED, paidAt set
VoucherUsage → row banti hai
PromoCodeUsage → committed
Invoice      → TD/INV/26-27/000418 + snapshot
```

### Step 4 — Ledger (capture ke waqt)

| Entry | Account | Dir | Amount |
|---|---|---|---:|
| `COLLECTION` | VENDOR_PAYABLE | CR | +800.00 |
| `VENDOR_PROMO_SHARE` | VENDOR_PAYABLE | DR | −15.00 |
| `CONVENIENCE_FEE` | PLATFORM_REVENUE | CR | +10.00 |
| `PLATFORM_PROMO_COST` | PLATFORM_COST | DR | −35.00 |
| `GATEWAY_FEE` | PLATFORM_COST | DR | −17.94 |

*(`TAX_COLLECTED`, `COMMISSION`, `VENDOR_COMMISSION` zero hain — skip)*

**Ab:**
```
Vendor ka VENDOR_PAYABLE  =  ₹785.00     ← vendorPayable se match ✓
Platform revenue          =  ₹ 10.00
Platform cost             =  ₹ 52.94     (35 promo + 17.94 MDR)
Platform net              =  −₹42.94
```

### Step 5 — Razorpay humein pay karta hai (T+2)

```
webhook: settlement.processed
Transaction.fundsReceivedAt = <Razorpay ka settled_at>
Transaction.razorpaySettlementId = setl_xyz789
```

### Step 6 — Settlement build (T+3, job)

Maan lo us din us brand par sirf yahi ek sale thi:

```
idempotencyKey  = STL:<brandId>:2026-09-08T18:30:00.000Z
settlementNumber = TD/STL/26-27/000123
bankSnapshot     = { …4821, IFSC HDFC0001234, verified }

grossCollected        =   800.00     (Σ netBill)
vendorPromoCost       =    15.00
commissionAmount      =     0.00
commissionTax         =     0.00
commissionDeduction   =     0.00
refundAdjustment      =     0.00
chargebackAdjustment  =     0.00
─────────────────────────────────
beforeReserve         =   785.00
reservePercent        =     0       (reserve off)
reserveHeld           =     0.00
reserveReleased       =     0.00
─────────────────────────────────
netPayable            =   785.00
transactionCount      =     1

785 > 100 (minPayout)  →  PENDING_APPROVAL
```

### Step 7 — Approval

```
PATCH /settlements/admin/TD-STL-123/approve
→ needsRevalidation false hai ✓, bankSnapshot hai ✓
→ APPROVED, approvedBy, approvedAt
→ SettlementHistory row
```

### Step 8 — Payout

```
PATCH /settlements/admin/TD-STL-123/pay
→ live bank === frozen bank ✓
→ PayoutLeg { legNumber: 1, amount: 785.00, INITIATED }
→ Settlement PROCESSING, attemptCount 1

  [ admin apne bank portal se ₹785 NEFT karta hai ]

PATCH /settlements/admin/TD-STL-123/confirm
Body: { "utr": "HDFCN26091100123456" }
→ PayoutLeg PAID, utr set, paidAt set
→ Ledger: PAYOUT  VENDOR_PAYABLE  DR  −785.00
→ paidSoFar 785 >= netPayable 785 → isFinalLeg ✓
→ Settlement PAID, paidAt set, documentToken minted
→ Payout statement issue (TD/STL/26-27/000123)
→ Vendor ko notification (UTR ke saath)
```

**Ab:**
```
Vendor ka VENDOR_PAYABLE  =  ₹0.00      ← books band ✓
Vendor ke bank me         =  ₹785.00
```

### Step 9 — Agar customer full refund maange (₹760)

```
calculateRefundSplit:
  paid                 =  760.00
  feeActuallyPaid      =   10.00      (promo net bill par tha, fee par nahi)
  vendorSidePaid       =  750.00      (760 − 10 − 0)
  isFullRefund         =  true
  ratio                =  750/750 = 1

  totalRefund          =  760.00
  convenienceFeeRefund =   10.00      ← hum absorb karte hain
  taxRefund            =    0.00
  netBillRefund        =  800.00
  vendorPromoReversal  =   15.00
  commissionReversal   =    0.00
  platformPromoReversal =  35.00
  vendorClawback       =  785.00      (800 − 15 − 0)
  gatewayFeeAbsorbed   =   17.94      ← Razorpay wapas nahi karta

Balance check:
  785.00 + 0.00 − 35.00 + 10.00 + 0.00  =  760.00  ✓ = totalRefund
```

**Refund complete hone par ledger:**

| Entry | Account | Dir | Amount |
|---|---|---|---:|
| `COLLECTION` | VENDOR_PAYABLE | DR | −785.00 |
| `VENDOR_PROMO_SHARE` | VENDOR_PAYABLE | CR | +15.00 |
| `CONVENIENCE_FEE` | PLATFORM_REVENUE | DR | −10.00 |
| `PLATFORM_PROMO_COST` | PLATFORM_COST | CR | +35.00 |
| `GATEWAY_FEE` | PLATFORM_COST | DR | −17.94 |

*(gateway fee **dobara** debit hoti hai — reverse nahi hoti, kyunki Razorpay apni
fee wapas nahi karta)*

**Final position:**
```
Customer  :  ₹0     (₹760 diya, ₹760 wapas)
Vendor    :  −₹785  (agle payout se clawback)
Platform  :  −₹35.88 (₹17.94 × 2 MDR)
```

> Vendor ko ₹785 pehle hi pay ho chuka tha, to agla settlement
> `refundAdjustment: 785.00` carry karega. Agar us cycle me unki sales ₹785 se kam
> hain, to `netPayable` negative hoga → `CARRIED_FORWARD` → agle cycle me jayega.

---

## "Kya hoga agar" — edge case table

### Customer side

| Situation | Kya hota hai | Customer ko kya dikhta hai |
|---|---|---|
| Do baar tap kiya (create-order) | Idempotency key ya reuse window — **ek hi order** | Wahi payment screen, `reused: true` |
| Do tab me same offer par claim | Once-per-user index doosre ko rokta hai | 409: *"You already have a claim in progress for this offer."* |
| Page refresh kiya order ke baad | Reuse window wahi order wapas deta hai | Same amount, same order |
| Promo quote expire ho gaya | Naya order banta hai | Naya price (shayad promo ke bina) |
| Payment fail ho gaya | Claim `FAILED`, slot release, promo release | Notification + 402 with Razorpay ka reason |
| Browser callback aur webhook dono aaye | Ek settle karta hai, doosre ko `alreadySettled` | Dono success — koi farak nahi |
| Settle ke beech server crash | `resumeIncompleteSettlements` (15 min) dobara chalata hai | Thodi der me receipt aata hai |
| Invoice generate nahi hua | Stage aage nahi badhta, admin alert, sweep retry karti hai | **Claim successful dikhta hai** (500 nahi) |
| Refund window nikal gaya | 422 with **exact date** | *"Refunds can be requested within 24 hours of payment. This one was paid on Mon Sep 08 2026."* |
| Pending refund par doosri request | Purani wapas milti hai + `askedFor` | *"Aapka ₹810 ka refund pehle se chal raha hai"* |
| Full refund hua | Slot wapas milta hai | Wahi offer dobara claim kar sakte hain |
| Partial refund hua | Slot **hold rehta hai** | Offer use ho chuka (sahi — unhe part mila) |
| `SOURCE` refund fail hua | Admin `request-bank-details` kar sakta hai | *"Add your bank account so we can send it"* |
| Vendor ne jawab nahi diya | 24h baad `VENDOR_TIMEOUT` | *"Under review by Trydood"* (timeout kabhi nahi) |
| Vendor ne reject kiya | Hold release, admin override kar sakta hai | *"Declined by the outlet"* (vendor ka note nahi) |

### Vendor side

| Situation | Kya hota hai | Vendor ko kya dikhta hai |
|---|---|---|
| Bank verified nahi hai | Settlement banta hai par approve nahi hota | Payout nahi aata; admin unse bank maangta hai |
| Cycle me bank badal diya | `pay` mana karta hai, settlement `ON_HOLD` | Payout ruk jata hai; support contact karta hai |
| Deductions > sales | `CARRIED_FORWARD` | **Notification** batati hai ki refunds/chargebacks wajah hain |
| `minPayoutAmount` se kam | `CARRIED_FORWARD` | Chup — routine hai, agle cycle me mil jayega |
| NEFT bounce ho gaya | `FAILED`, rows **hold me rehte hain** | Notification **category** ke saath (note nahi) |
| Admin ne hold kiya | `ON_HOLD` | *"Settlement on hold"* — **wajah nahi batai jati** |
| Do din ke payout ek saath | Har din ka apna settlement + apna number | Do alag statements |
| Bada payout, do NEFT | Do `PayoutLeg`, settlement tab `PAID` jab dono add hon | Ek statement, do UTR |
| Dispute haar gaye | `CHARGEBACK` ledger + agle cycle se recovery | Statement par `chargebackAdjustment` |
| Brand band kar diya, debt bacha | `alertVendorDebt` daily alert | Kuch nahi — vendor ko debt screen nahi dikhta |

### System side

| Situation | Kya hota hai |
|---|---|
| Job runner down tha | Har job apne interval par catch up karta hai; boot par health warning |
| Do instance ek saath chal rahe | `JobLock` — ek chalta hai, baaki skip |
| `buildSettlements` do baar chala | `idempotencyKey` unique index doosre ko refuse karta hai |
| Build beech me marr gaya | `sweepAbandonedDrafts` khali DRAFT hatati hai (warna us brand ka din hamesha skip) |
| Ek brand ka build fail hua | Baaki brands chalte rehte hain; failure report hoti hai (naam ke saath) |
| Transition ke beech crash | `sweepStrandedClaims` wo rows release karti hai jinhe terminal settlement pakde hai |
| Webhook redeliver hua | Har step idempotent — conditional claim, `$max`, unique indexes |
| `refund.processed` out of order aaya | `$max` + aggregation pipeline — flags aur amount kabhi disagree nahi karte |
| Razorpay ne do baar capture kiya | `detectDoubleCapture` admin ko batata hai |
| Ledger aur bank disagree | `reconcileSettlementLedger` (3 ghante) alert karta hai — **read-only** |
| Purana build ne shadow index bana diya | `reapShadowIndexes` (ghante) hatata hai + alert |

---

## Do rules jo poore system par lagte hain

### 1. Lock ek taraf jata hai — release bhoolna nahi

```
Transaction.settlementId: null  →  S
```

Har future cycle ka predicate `settlementId: null` maangta hai. Jo settlement
happy path se bina release kiye nikal jata hai, uske rows **har cycle se hamesha
ke liye invisible** ho jate hain — na error, na alert, predicate bas match karna
band kar deta hai.

> **Ek admin click ₹92,400 ko permanently unpayable bana sakta tha, aur ledger
> chup rehta** kyunki uski apni arithmetic **sahi** hai: koi `PAYOUT` entry nahi
> likhi gayi, to `VENDOR_PAYABLE` ab bhi wo paisa owed dikhata hai. Wo owed hai
> bhi. Bas usse pahuncha nahi ja sakta.

Isliye release **transition ke baad karne wali cheez nahi hai — release HI
transition hai** (`transitionSettlement`).

### 2. Sach hamesha frozen hota hai, live query nahi

| Kya | Kahan freeze hota hai | Kyun |
|---|---|---|
| Offer, voucher, brand, outlet, customer | `VoucherClaim.*Snapshot` | Sab editable hain |
| Price ka poora block | `VoucherClaim.pricing` | Rate kal badal sakta hai |
| Refund split | `RefundRequest.split` | Approve aur pay ke beech din guzarte hain |
| Bank account | `Settlement.bankSnapshot` | Vendor beech me badal sakta hai; NEFT ka recall nahi |
| Reserve rate + basis | `Settlement.reservePercent`, `reserveBasis` | Trailing window hil chuki hoti hai |
| Chargeback recovery amount | Ledger se padha jata hai | Cap ko recompute ignore kar deta |
| Statement ke sare figures | `Settlement.documentSnapshot` | Render time par koi lookup nahi |

> **Ek settlement ke figures un rows se add hone chahiye jinhe wo describe karta
> hai — aur live query wahi cheez hai jisse ye chupchap sach hona band ho jata hai.**

---

## Related docs

| Doc | Kya hai |
|---|---|
| `docs/settlement_flow.md` | Settlement ka technical design (English) |
| `docs/refund_flow.md` | Refund ka technical design (English) |
| `docs/dispute_flow.md` | Dispute/chargeback design (English) |
| `docs/customer_voucher_claim_plan.md` | Claim flow ka original plan |
| `docs/vendor_settlement_plan.md` | Settlement ka original plan |
| `docs/customer_mobile_api_doc.md` | Customer API reference |
| `docs/vendor_panel_api_doc.md` | Vendor panel API reference |
| `docs/super_admin_panel_api_doc.md` | Admin panel API reference |
