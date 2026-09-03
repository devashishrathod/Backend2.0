# Refund flow — Trydood 2.0

**Grahak maange → vendor tay kare → admin nikaale.**

Yeh document batata hai ki refund **aaj kaise chalta hai**, code me. Design ka
"kyun" `vendor_settlement_plan.md` §5–§6 me hai; yeh "kya hota hai" hai.

> ⚠️ **Chargeback isse bilkul alag cheez hai** — usme grahak apne **bank** ke paas jaata
> hai, hamare paas nahi, aur hum mana nahi kar sakte, sirf sabit kar sakte hain.
> [`dispute_flow.md`](./dispute_flow.md) me poora.

> **Status:** Phase S1 ✅ — `SOURCE` refunds (Razorpay usi card/UPI par lautata hai) ka
> poora lifecycle: maangna → vendor ka faisla → escalation → admin payout → webhook →
> ledger → notice. 9 endpoints, §1.5 me. Poora manifest:
> [`implementation_phases.md`](./implementation_phases.md).
>
> ✅ **`MANUAL_BANK` ab ban gaya** — §7. Jiska card band ho gaya ya UPI handle expire ho
> gaya, uska refund ab bank account par jaata hai: admin maangta hai, grahak OTP ke saath
> account deta hai, server penny-drop karta hai, admin NEFT karke UTR bharta hai.
>
> Partial refund ab hold chhodta hai (§5.1a) aur ledger teeno account par **zero par
> aata hai** (§5.1b) — dono money audit me theek hue.

---

## 1. Poora raasta, ek nazar me

```
                     ┌──────────────── grahak ────────────────┐
                     │  POST /refunds                          │
                     └────────────────┬───────────────────────┘
                                      │
              eligibility → allowance → window → split freeze
                                      │
                        RefundRequest banti hai (REQUESTED)
                                      │
                        Transaction.settlementHold = true
                                      │
                     ┌────────────────┴───────────────────────┐
                     │                                         │
              vendor 24h me                            vendor chup
                     │                                         │
        ┌────────────┴────────────┐                   escalateStaleRefunds
        │                         │                            │
   approve                     reject                    VENDOR_TIMEOUT
   (rakam ghata sakta)     (note zaroori)                      │
        │                         │                     admin ke paas
   VENDOR_APPROVED          VENDOR_REJECTED                    │
        │                         │                    ADMIN_OVERRIDE
        │                    hold HATTA                (wajah zaroori)
        │                         │                            │
        └────────────┬────────────┘                            │
                     │                                         │
              admin: PATCH /refunds/admin/:id/pay ◄────────────┘
                     │
        attemptCount++ → PROCESSING → payments.refund()
                     │
              ┌──────┴──────┐
        refund.processed   refund.failed
              │                  │
     applyRefundCompletion    FAILED (khula rehta hai,
              │                hold laga rehta hai,
        COMPLETED              admin ko CRITICAL)
```

---

## 1.5 Endpoints

| Method | Path | Kaun | Kya |
|---|---|---|---|
| `POST` | `/refunds` | customer | Refund maangna |
| `PATCH` | `/refunds/:requestId/withdraw` | customer | Apni hi request wapas lena → `CANCELLED` |
| `PATCH` | `/refunds/:requestId/approve` | vendor / sub-vendor | Rakam ghata sakta hai, badha nahi |
| `PATCH` | `/refunds/:requestId/reject` | vendor / sub-vendor | `note` zaroori · **hold yahin hattta hai** |
| `PATCH` | `/refunds/admin/:requestId/approve` | admin | `ADMIN_APPROVED` ya override |
| `PATCH` | `/refunds/admin/:requestId/reject` | admin | `ADMIN_REJECTED` |
| `PATCH` | `/refunds/admin/:requestId/pay` | admin | Razorpay ko bhejna |
| `GET` | `/refunds` | token | Listing — teeno roles, scope token se |
| `GET` | `/refunds/:requestId` | token | Detail — projection role ke hisaab se (§8) |

**`MANUAL_BANK` (§7)** — jab paisa usi raaste se wapas nahi ja sakta:

| Method | Path | Kaun | Kya |
|---|---|---|---|
| `PATCH` | `/refunds/admin/:requestId/request-bank-details` | admin | `FAILED` → `AWAITING_BANK_DETAILS`, `reason` zaroori |
| `PATCH` | `/refunds/:requestId/bank-account` | customer | Apne verified account me se ek chunna |
| `PATCH` | `/refunds/admin/:requestId/pay-to-bank` | admin | `PayoutLeg` kholna |
| `PATCH` | `/refunds/admin/:requestId/confirm-bank-payout` | admin | **UTR zaroori** → refund band |
| `PATCH` | `/refunds/admin/:requestId/fail-bank-payout` | admin | Bounce — leg rakhi jaati hai |

**Grahak ke bank accounts** — `/bank-accounts`, sab `isCustomer`:

| Method | Path | Kya |
|---|---|---|
| `POST` | `/bank-accounts/otp` | Code WhatsApp ya email par |
| `POST` | `/bank-accounts` | Code + account → server penny-drop karta hai |
| `GET` | `/bank-accounts` | Apne accounts (masked), unverified bhi — nishaan ke saath |
| `DELETE` | `/bank-accounts/:accountId` | Soft delete. ⚠️ Mana, agar koi refund uspar taka hua hai |

⚠️ Inme se koi bhi `customerId` accept **nahi** karta — scope hamesha token se. Jo
endpoint identity filter leta, wo ek aadmi ko doosre ke accounts padhne ya jodne deta.

**Listing query:** `page`, `limit`, `status`, `open`, `brandId`, `from`, `to`.

> Scope aur filter **kaate** jaate hain, upar-neeche rakhe nahi — vendor kisi aur brand ka
> `brandId` bheje to khaali page milta hai, apne rows nahi.

### 1.5a `/withdraw` — grahak apni baat wapas le sakta hai

Ye endpoint isliye hai ki `CANCELLED` allowance ki ginti me aata hai (§2.3) — bina iske
wo status kabhi ban hi nahi sakta tha.

Grahak ke liye ye zaroori hai: galti se maangi hui refund, ya wo jiska maamla outlet se
baat karke sulajh gaya, use vendor ke faisle ka intezaar nahi karna chahiye. Aur vendor
ke liye bhi — jo request wapas li ja chuki, wo uski 24-ghante wali list se hat jaati hai.

⚠️ `CANCELLED` ginti me isliye aata hai ki *raise karo → vendor dekhe → withdraw karo →
phir raise karo* vendor ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye.

---

## 2. Grahak maangta hai — `POST /refunds`

**Kram hi design hai:**

```
eligibility → allowance → window → split freeze → request banao → hold lagao
```

### 2.1 Kya jaancha jaata hai, us kram me

| # | Jaanch | Fail hone par |
|---|---|---|
| 1 | Claim maujood hai | `404` |
| 2 | Claim **is grahak** ki hai (customer par, `userId` par nahi) | `403` |
| 3 | Claim `PAID` ya `REDEEMED` hai | `422`, status naam lekar |
| 4 | Payment `verified` hai | `422` |
| 5 | **Allowance** — §2.3 | `422`, support ka raasta |
| 6 | **Window** — `paidAt + refund.windowHours` | `422`, tareekh ke saath |
| 7 | Rakam refundable ceiling ke andar | `422` |
| 8 | `reason: OTHER` ke saath `reasonNote` | `422` |

> **`REDEEMED` list me hai, aur hona hi chahiye.** Phase 1 me capture seedhe
> `REDEEMED` karta hai (`redemptionMode: AUTO`), to har paid claim redeemed hai.
> Use chhod dene ka matlab hota **koi kabhi refund maang hi na sake**.

> **Window `paidAt` se napi jaati hai, `createdAt` se nahi.** Ek ghante chhoda hua
> checkout phir pay ho to uski window grahak ke paisa dene se *pehle* shuru ho
> jaati.

### 2.2 `amount` optional hai

Na do to poora (`paidAmount − amountRefunded`). Jo figure server ko pehle se pata
hai use dobara type karana hi use galat type karane ka tareeka hai.

### 2.3 Kitni baar maang sakte hain — admin config

| Setting | Default | Kya ginta hai |
|---|---|---|
| `refund.maxOpenRequests` | 1 | Ek saath khuli, **sab claims milakar** |
| `refund.maxRejectedPerWindow` | 3 | `VENDOR_REJECTED` + `ADMIN_REJECTED` + `CANCELLED` |
| `refund.requestWindowDays` | 30 | Rolling window |

⚠️ **Approve hui refunds kabhi nahi gintin.** Galat ka sanket yeh nahi ki kitna
paisa wapas gaya — wo hai *"vendor ne dekhkar kaha ki yeh jayaz nahi thi"*. Jis
grahak ki 5 refunds approve hui, uske saath 5 baar sach me bura hua; uski chhathi
rokna theek usi ko saza dena hai jiske liye yeh vyavastha bani hai. Aur raw count
rakhne par **sabse kharab brand ka grahak sabse pehle block** hota — jo sabse
zyada haqdaar hai.

`CANCELLED` ginta hai kyunki raise → vendor dekhe → withdraw → phir raise, yeh
vendor ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye.

**Caller ka apna payment ginti se bahar hai** — usi claim par dusra tap idempotent
raaste se guzarta hai, block nahi hota.

Limit chhoone par `422`, aur jawab **support par bhejta hai, raasta band nahi
karta**. Koi aarop nahi: *"aapka account flagged hai"* par grahak kuch kar hi nahi
sakta, aur agar flag galat hai to sudharne ka koi zariya nahi.

### 2.4 Do tap, ek request

`(transactionId, isOpen)` par **unique partial index** faisla karta hai — uske upar
wala read-then-write check nahi, jise dono taps paas kar jaate hain.

Haarne wale ko error nahi milta: **wahi request** milti hai `reused: true` ke saath.
Grahak ki taraf se nateeja ek hi hai, usne ek baar maanga.

Index `isOpen: true` par partial hai, isliye September me dobara maangna khula
rehta hai — August me ₹300 refund paane wale ko hamesha ke liye rokna galat hota.

### 2.5 Split yahin freeze hota hai

Mangalwar ko approve aur Guruwar ko paid hone wala refund **theek wahi paisa
hilaye** jitna sabne Mangalwar ko maana tha. Execution par dobara ginne se beech me
badla promo rule vendor ko aisi rakam se kaat deta jise kisi ne approve nahi kiya.

Split `VoucherClaim.pricing` se banta hai — **`Transaction.voucher` se nahi**:

| | `pricing` | `voucher` (denormalised copy) |
|---|:-:|:-:|
| `promoAppliesTo` | ✅ | ❌ |
| `promoDiscount` | ✅ | ❌ |
| `taxOnTop` | ✅ | ❌ |

⚠️ Wo teeno split tay karte hain. **Convenience fee par laga promo vendor ko kuch
nahi padta** — wo hamari apni fee se gaya. Copy se split nikalne par vendor se wo
discount vasoola jaata jo humne khud diya tha.

### 2.6 `settlementHold` lagta hai

**Yahi ek line poori "pehle vendor ko pay kar diya, ab wapas lo" wali samasya
khatam karti hai.**

Golden rule (settings validator me, save par `422`):

```
settlementDelayHours >= windowHours + vendorApprovalHours + adminBufferHours
       72h (T+3)     >=     24h     +        24h         +       12h
```

Jab tak yeh sach hai, koi refund kabhi aise paise ko chhoo hi nahi sakta jo vendor
ko ja chuka ho. Na recovery, na negative balance, na vendor ko kuch samjhana.

**Request pehle banti hai, hold baad me lagta hai** — request hi record hai aur
hold usse nikalta hai. Beech me process mar jaye to `reconcileRefunds` hold
**wapas laga deta hai** (§6.2), aur health page tab tak use CRITICAL ginta hai.

---

## 3. Vendor tay karta hai — 24 ghante

### 3.1 Approve — `PATCH /refunds/:requestId/approve`

**Rakam ghat sakti hai, badh nahi.** *"Aadha order theek tha, starter nahi"* asli
jawab hai. Badhana grahak ne jo maanga uski approval nahi — wo naya faisla hai, aur
is step par ek extra shunya **das guna** pay out kar deta us aadmi ko jisne maanga
hi nahi. `422`.

`requestedAmount` kabhi overwrite nahi hota; `approvedAmount` alag field hai, to
antar dikhta rehta hai — wo baad me kisi ko samjhana pad sakta hai.

Split **dobara freeze** hota hai, is nayi rakam par.

Hold **laga rehta hai** — paisa abhi bhi wapas jaana hai.

### 3.2 Reject — `PATCH /refunds/:requestId/reject`

`note` **zaroori** (min 3 chars). Jab grahak inkaar ko chunauti de, admin ke paas
sameeksha karne ko yahi ek cheez hoti hai; akela *"rejected"* har appeal ko phone
call bana deta hai.

Note **grahak ko kabhi nahi dikhta** — wo staff ke liye hai.

**Hold yahin hattta hai.** ⚠️ Yeh ulta utna hi khatarnak hai: jo hold koi na
hataaye wo vendor ka paisa **hamesha ke liye** har aane wali settlement se bahar kar
deta hai — chup-chaap, kyunki eligibility predicate bas match karna band kar deta
hai. Koi error nahi, koi log nahi.

### 3.3 Do log ek hi request nahi tay kar sakte

`status` update filter ka hissa hai (conditional claim). Owner aur outlet manager
ek hi request dekh sakte hain; iske bina dono clicks lagte aur dusra pehle ko
chup-chaap mita deta — yaani grahak ka jawab is par nirbhar karta ki kaun dheema
tha.

Haarne wale ko `409` milta hai jo **batata hai kya hua**:
*"already been decided (vendor approved)"* ya *"already gone to Trydood for review"*.
Dono ke aage ke kadam alag hain.

### 3.4 Vendor chup rahe to

`escalateStaleRefunds` (har 15 min) `vendorRespondBy` beet chuki requests uthata
hai:

| `refund.onVendorTimeout` | Nateeja |
|---|---|
| `ESCALATE` *(default)* | `VENDOR_TIMEOUT` → admin ke paas, admin ko WARNING |
| `AUTO_APPROVE` | `VENDOR_APPROVED`, grahak ko approval bhej di jaati hai |

**Timeout rejection nahi hai** — paisa abhi bhi bakaya hai, to hold nahi hattta.

`vendorRespondBy` request banate waqt row par likhi jaati hai, har baar gini nahi
jaati: setting kal badhane se aaj ke vaade par intezaar kar rahi request ki window
chup-chaap nahi badhni chahiye.

Do reminders pehle jaate hain (aadhe aur teen-chauthai par), **ek sweep me ek se
zyada nahi** — pehle version dono marks ek hi pass me chala deta tha aur outlet ko
ek hi millisecond me do reminders jaati thi.

---

## 4. Admin nikaalta hai

### 4.1 Wo normal raaste par dusra gate nahi hai

Vendor pehle hi tay kar chuka; admin sirf paisa chhodta hai.

| Se | `overrideReason` | Nateeja |
|---|:-:|---|
| `VENDOR_APPROVED` | — | `ADMIN_APPROVED` |
| `VENDOR_REJECTED` | ✅ | `ADMIN_OVERRIDE` + `isOverride: true` |
| `VENDOR_TIMEOUT` | ✅ | `ADMIN_OVERRIDE` + `isOverride: true` |

Override alag se gina jaata hai. **Badhti override dar ka matlab yeh nahi ki admin
udaar hain** — matlab hai ki upar kahin gadbad hai: koi outlet jo kabhi jawab nahi
deta, ya koi voucher jo nibhaya nahi ja sakta. Wo number badhe to dekhne ki jagah
refund nahi, wo outlet hai.

Override par hi grahak ko dusra "approved" jaata hai — normal raaste par vendor ki
approval pehle hi bata chuki hoti hai.

### 4.2 Paisa bhejna — `PATCH /refunds/admin/:requestId/pay`

```
PROCESSING likho + attemptCount++     ← Razorpay call se PEHLE
  → Razorpay se poocho kya pehle se hai  ← sirf retry par (attemptCount > 1)
  → payments.refund()                    ← jiska koi undo nahi
  → refund id + UTR sahejo
```

⚠️ **Counter pehle badhta hai, aur wahi crash ko jhelne layak banata hai.** Agar
process us beech mare jab Razorpay ne refund maan liya par id sahej na paye — row
`PROCESSING` kehti hai, `attemptCount: 1`, koi `razorpayRefundId` nahi. Agli koshish
`payments.fetchMultipleRefund()` se **poochti hai** aur us refund ko apna leti hai.
Baad me badhate to counter shunya rehta aur retry grahak ko paisa **do baar** bhej
deta.

Match hamare stamp kiye `notes.refundRequestId` par hota hai, **rakam par nahi** —
ek hi rakam ke do partial refunds rakam se alag nahi kiye ja sakte, aur galat wala
apnane se ek asli refund behisaab reh jaata.

Lookup khud fail ho jaye to **`503`** aur row `PROCESSING` chhod di jaati hai. Galat
hone ka surakshit tareeka yahi hai — `undefined` lautana dusra refund bhej deta.

Account `transaction.gatewayAccount` se aata hai, yahan constant se nahi: do alag
Razorpay merchants hain aur galat wale se refund karne par aisa error aata hai jo
*"payment nahi mila"* jaisa padha jaata hai.

Jawab do tarah ka hota hai:

| Message | Matlab |
|---|---|
| *"Refund sent to Razorpay successfully"* | Naya refund bheja gaya |
| *"This refund had already reached Razorpay; it is now linked and processing"* | Kuch naya nahi bheja — pichhli koshish pahunch chuki thi |

### 4.3 Gateway ko bhejne se pehle teen aur jaanch

Ye teeno money audit me judi. Har ek us khidki ko band karti hai jo request banne aur
paisa nikalne ke beech khuli rehti hai — **aur wo khidki ghanton ki hoti hai**.

**1. Rakam dobara naapi jaati hai, live `amountRefunded` ke against.**

Request Mangalwar ko bani, admin Guruwar ko pay kar raha hai. Beech me usi payment par
koi doosra refund pura ho gaya — ya dashboard se refund kar diya gaya — to
`amountRefunded` badh chuki hai. Purani request apni **purani** rakam leke baithi hai.

```js
const alreadyRefunded = Math.round((transaction.amountRefunded || 0) * 100) / 100;
```

Bina is jaanch ke total refund payment se **zyada** ja sakta tha. Razorpay khud bhi mana
karta, par tab error `PROCESSING` row chhod jaata aur samajhne me mushkil hota.

**2. `otherOpen` — usi payment par doosri khuli request ho to mana.**

Do khuli requests, dono approved, dono pay — aur milkar payment se zyada. Ab doosri ko
saaf `422` milta hai **pehli ka claim code naam lekar**, taaki admin ko dhoondhna na pade
ki takraav kis se hai.

**3. `vendorAlreadyPaid` — record hota hai aur jawab me lautaya jaata hai.**

`Boolean(payment.settlementId)` — yaani us payment ka paisa vendor ko ja chuka hai ya
abhi jaa raha hai. Golden rule ke rehte aisa hona hi nahi chahiye, par agar timing
settings badal di gayi thi to ho sakta hai.

⚠️ Ye refund **rokta nahi** — grahak ka paisa lautna hi chahiye. Ye **batata hai**, taaki
admin ko pata ho ki iski recovery agle settlement cycle se hogi (`claimRefundAdjustments`),
aur wo vendor ko pehle se bata sake. Chup-chaap clawback vendor ko agle mahine
statement me milta — bina kisi chetavani ke.

---

## 5. Paisa pahunchta hai — `refund.processed`

`applyRefundCompletion()` — ek jagah, sab kuch. Har step idempotent, kyunki Razorpay
webhook **dobara bhejta hai**; conditional claim tay karta hai kaun kaam karega.

| Kahan | Kya |
|---|---|
| `RefundRequest` | `COMPLETED`, `completedAt`, `utr`, `isOpen: false` |
| `Transaction` | `amountRefunded` **`$max` se cumulative**, `refundStatus` (`PARTIAL`/`COMPLETED`), `paidRefundAt`, hold **laga rehta hai** |
| `VoucherClaim` | Poore refund par `REFUNDED`, `refundAmount`, **`holdsUsageSlot: false`** |
| `VoucherUsage` | Poore refund par `isReversed: true` |
| `PromoCodeUsage` | Sirf `refund.releasePromoOnRefund: true` par, aur sirf poore refund par |
| `LedgerEntry` | 6 rows tak, capture ki mirror image |
| `VoucherClaimHistory` | `REFUNDED` row |
| Notification | Grahak ko, **UTR ke saath** |

### 5.1 Cumulative total gateway se aata hai

⚠️ Purana handler `$set: { amountRefunded: isRefundKaAmount }` likhta tha. ₹300 phir
₹200 → record ₹200 kehta, aur vendor ka bacha ₹310 **adrishya** ho jaata.

Ab `payment.amount_refunded` — wo running total jo Razorpay khud rakhta hai —
`$max` se likha jaata hai. Yeh redelivery, out-of-order delivery aur dashboard se
kiye refund, teeno jhelta hai. `$inc` inme se kisi ko nahi jhelta.

### 5.1a ⚠️ Partial refund par `settlementHold` **hat** jata hai

Poore refund par hold laga rehta hai — wo paisa vendor ka tha hi nahi. Partial
par hatta hai, kyunki sale ka bacha hua hissa ab bhi unka hai.

Pehle har completed refund par hold laga rehta tha, is note ke saath: *"the money
is gone; it was never the vendor's to be paid"*. Poore refund ke liye sach.
₹810 me ₹300 wapas gaye to bacha ₹500 vendor ka hai — aur wo hamesha ke liye har
settlement se bahar ho jata tha, jabki us refund ka clawback agle cycle me kaata
bhi jata tha. Ek ₹800 ki sale par vendor lagbhag ₹1,100 ka nuksaan uthata tha.

`releaseSettlementHold` phir bhi **poochta hai, hukm nahi deta**: usi payment par
chargeback ya koi doosra khula refund ho to hold laga rehta hai.

### 5.1b Ledger ka jodna — teen jagah galat tha

Har ledger test row ka shape dekhta tha; **koi account jodta nahi tha**, aur
teeno bug theek usi gap me chhupe the:

| Kya galat tha | Poore refund ke baad asar |
|---|---|
| refund `vendorClawback` debit karta tha, jo **pehle se** promo ka net hai, aur phir promo share dobara credit | `VENDOR_PAYABLE` par `+vendorPromoCost` bacha reh jata — bhoot ka paisa jo agla payout de deta |
| `split.taxRefund` nikaala jata tha aur **kabhi post nahi hota** | `TAX_PAYABLE` par us fee ki GST rehti jo grahak ko wapas ja chuki |
| `COMMISSION` refund par ulta hota tha par capture par **kabhi post hi nahi** | rate zero se upar hote hi `PLATFORM_REVENUE` negative |

Ab `__tests__/money/ledgerBalance.test.js` **balances** par assert karta hai,
rows par nahi: poore refund ke baad `VENDOR_PAYABLE`, `PLATFORM_REVENUE` aur
`TAX_PAYABLE` teeno **zero** par aate hain.

> ⚠️ `PLATFORM_COST` jaan-boojh kar zero par nahi aata — Razorpay apni MDR rakhta
> hai, refund ho ya na ho.

> ### ⚠️ GST-inclusive fee
>
> Jab fee GST-**inclusive** hoti hai to `convenienceFee` me tax andar hi hota hai
> aur `taxOnTop: 0` hota hai. Ledger gross fee ko revenue me credit karta tha
> **aur** tax alag se — har sale par revenue theek GST jitna zyada. Ab
> `feeNetOfTax` se net jaata hai, aur refund par bhi wahi mirror hota hai.

### 5.1c Teen aur cheezein jo audit me theek huin

**1. `amountRefunded` claim se *pehle* badhta hai.**

Pehla kram tha: claim karo (`isOpen: false`) → phir `amountRefunded` badhao. Beech me ek
khidki thi jisme request band ho chuki thi par total abhi purana tha — aur usi khidki me
aane wali eligibility ya nayi request **galat aankda** padhti. Ab total pehle badhta hai.

**2. `isRefunded` aur `refundStatus` ek hi pipeline me nikalte hain.**

```js
refundStatus: { … },
isRefunded: { $gte: ["$amountRefunded", fullyRefundedAt] },
```

⚠️ Pehle `$max` se `amountRefunded` badhta tha aur uske **baad wala `$set`**
`isRefunded` ko `false` likh deta tha — kyunki `$set` ne wo purani value dekhi jo `$max`
ne abhi badli thi. Nateeja: poori refund hui payment `isRefunded: false` rehti, aur
eligibility use **wapas settlement me le aati**. Ek hi aggregation pipeline me dono
nikalne ka matlab hai ki derived flag apni source value se kabhi asehmat ho hi nahi
sakta.

**3. `FAILED` bhi claimable status hai.**

Gateway hi asli authority hai ki paisa gaya ya nahi. Hamari request `FAILED` tab hoti hai
jab Razorpay ko **call** karte waqt error aaya — par wo call pahunch bhi sakti thi. Baad
me `refund.processed` webhook aaye to use `FAILED` row ko bhi utha lena chahiye. Bina
iske: paisa grahak ko ja chuka hota, aur hamari row hamesha `FAILED` kehti rehti —
`stuckFailedRefunds` me CRITICAL, admin baar-baar retry karta, aur **har retry doosri
baar paisa bhej sakti thi**.

**4. `ALREADY_COMPLETED` par ledger dobara post hota hai.**

Agar row pehle se `COMPLETED` hai to completion `{ applied: false, reason:
"ALREADY_COMPLETED" }` lautati hai — par ledger phir bhi post karke dekhti hai. Ledger
entries apne unique index se idempotent hain, to dobara likhne se kuch nahi bigadta;
**par agar pichhli baar ledger likhne se pehle process mar gaya tha, to wo reversal ab
bhar jaata hai.** Bina iske ek adhoori row hamesha adhoori rehti aur `VENDOR_PAYABLE`
par bhoot ka paisa bacha rehta.

### 5.2 Claim sirf **poore** refund par badalti hai

Aanshik roop se refund hui claim phir bhi ek hui hui claim hai: grahak ne khaya,
outlet ne diya, kuch paisa wapas gaya. Use `REFUNDED` likhna ek aisi bikri mita
deta hai jo zyadatar hui thi.

### 5.3 ⚠️ Once-per-user slot wapas milta hai

Iske bina grahak ko *"aap yeh offer istemaal kar chuke"* sunna padta hai us offer ke
liye **jiska paisa diya aur mila kuch nahi**. Yeh is flow ke galat hone ka sabse
chidhane wala tareeka hai aur hamari taraf se poori tarah adrishya.

### 5.4 Ledger — capture ki mirror image

Har row **usi entry type** ke tehat jaati hai jise wo ulat rahi hai, vipreet disha
me. Tab type ke hisaab se bana report apne aap net ho jaata hai; ek sapaat `REFUND`
type aisa promo cost dikhata jo kabhi ghata hi nahi.

| Capture | Refund | Account |
|---|---|---|
| `COLLECTION` +netBill | `COLLECTION` −**netBillRefund** | `VENDOR_PAYABLE` |
| `VENDOR_PROMO_SHARE` −share | `VENDOR_PROMO_SHARE` +share | `VENDOR_PAYABLE` |
| **`VENDOR_COMMISSION` −deduction** | **`VENDOR_COMMISSION` +deduction** | `VENDOR_PAYABLE` |
| `CONVENIENCE_FEE` +fee *(net of tax)* | `CONVENIENCE_FEE` −fee *(net of tax)* | `PLATFORM_REVENUE` |
| `COMMISSION` +commission *(net of tax)* | `COMMISSION` −commission *(net of tax)* | `PLATFORM_REVENUE` |
| `PLATFORM_PROMO_COST` −share | `PLATFORM_PROMO_COST` +share | `PLATFORM_COST` |
| `TAX_COLLECTED` +fee GST +commission GST | `TAX_COLLECTED` −both | `TAX_PAYABLE` |
| `GATEWAY_FEE` −MDR | `GATEWAY_FEE` −MDR **phir se** | `PLATFORM_COST` |

⚠️ **`COLLECTION` par `netBillRefund` hai, `vendorClawback` nahi.** Do alag number
hain: capture **gross** `netBill` credit karta hai aur promo share alag debit karta hai,
to refund ko bhi wahi shakl chahiye. `vendorClawback` settlement ka number hai —
`computeTotals` use `refundAdjustment` me use karta hai, jahan net hi sahi hai. Galat
wala lagane se ₹800 ki sale par `VENDOR_PAYABLE` **+₹50** par ruk jaata tha.

### 5.4a ⚠️ `VENDOR_COMMISSION` — wo row jiske bina kitaab band hi nahi hoti

`COMMISSION` batata hai **hum kya kamaye**. `VENDOR_COMMISSION` batata hai **vendor ko
ab kya nahi dena**. Ek hi ghatna, do account — bilkul wahi jodi jo
`VENDOR_PROMO_SHARE` / `PLATFORM_PROMO_COST` banate hain, kyunki yahan ek entry type ek
hi account aur ek hi direction rakhta hai.

Iske bina kya hota tha, ₹1,000 ki sale par 10% commission ke saath:

```
capture:   COLLECTION  VENDOR_PAYABLE +1000     (commission ka koi debit nahi)
settlement: netPayable = 1000 − 100 = 900
payout:    PAYOUT      VENDOR_PAYABLE  −900
           ────────────────────────────────
           VENDOR_PAYABLE = +100  ← hamesha ke liye
```

Har sale par commission jitna **bhoot ka payable**, jo kabhi nahi mitta — aur
`getVendorBalance` vendor ko wo paisa dikhata jo kabhi unka tha hi nahi.

⚠️ **`commissionDeduction`, `commissionAmount` nahi.** GST agar commission ke **upar**
lagti hai to vendor se tax bhi kata hai; sirf commission credit karne par unka GST hamare
margin se jaata.

> Aaj rate `0` hai aur GST off hai, to ye dono row kuch post hi nahi karti —
> `recordLedgerEntry` zero amount chhod deta hai. `__tests__/money/ledgerBalance.test.js`
> me **paanch case non-zero rate par** chalte hain, teenon GST modes me, theek isi liye.

Gateway fee hi wo ek row hai jo **reversal nahi** hai: Razorpay refund par apni fee
wapas nahi karta, to wo nuksaan dobara darj hota hai. `calculateRefundSplit` use
pehle refund ke baad shunya kar deta hai, to partial-phir-partial jodi me wo ek hi
baar bookta hai.

`ledger_type_refund_unique` (`refundRequestId` + `entryType`) replay rokta hai.
⚠️ `ONCE_PER_TRANSACTION` yeh kaam kar hi nahi sakta: ek payment do baar refund ho
sakta hai aur dono ki rows ek hi `transactionId` par hain.

### 5.5 Kaun kya lauta paata hai (30 Aug 2026 ka faisla)

| Hissa | Poora refund | Partial |
|---|---|---|
| netBill | grahak ko, vendor se clawback | pro-rata |
| convenience fee | grahak ko, **hum** uthate hain | **nahi** lautti |
| fee par GST | fee ke saath lautta hai | nahi |
| promo — hamara hissa | reverse | pro-rata |
| promo — vendor ka hissa | reverse | pro-rata |
| Razorpay MDR | **hum uthate hain** | pehle refund par ek baar |

Fee poore refund par isliye lautti hai ki jo grahak ₹810 de aur ₹800 paaye wo
support ticket kholta hai, aur ₹10 par sahi hona use sasta nahi banata.

**Balance identity**, lautne se **pehle** assert hoti hai:

```
totalRefund = vendorClawback + commissionReversal − platformPromoReversal
              + convenienceFeeRefund + taxRefund
```

Na mile to kuch bahar nahi jaata. Vaikalpik yeh hai ki toota split ek mahine baad
settlement statement me mile, jab paisa hil chuka ho.

---

## 6. Jo apne aap chalta hai

| Job | Har | Kya |
|---|---|---|
| `escalateStaleRefunds` | 15m | Vendor ki window khatam → admin (ya auto-approve) |
| `reconcileRefunds` | 30m | Gateway se poochta hai + **chhoote hue hold wapas lagata hai** |
| `remindVendorsAboutRefunds` | 60m | Do nudges, ek sweep me ek |
| `remindCustomersAboutBankDetails` | 60m | Do nudges grahak ko, phir 30 din baad admin ko — §6.4 |

### 6.1 `reconcileRefunds` gateway par **kabhi nahi likhta**

Refund jaari karna `/admin/:id/pay` ka kaam hai aur uske apne double-payment guards
hain. Aisa reconcile jo pay kar sake, paisa bahar jaane ka **dusra bina-pahre wala
raasta** ban jaata.

Gateway na pahunche to wo **failed refund nahi** hai — `unreachable` gina jaata hai
aur row jaisi thi waisi chhod di jaati hai.

### 6.2 Chhoot gaya hold wapas lagana

`requestRefund` hold lagata hai, par request banne ke **baad**, dusre round trip
me. Beech me process mare to khuli refund ka paisa payout ke liye eligible reh jaata
hai — aur settlement vendor ko us claim ka paisa de deti hai jo refund hone wali
hai.

Isliye `reconcileRefunds` sabse pehle yeh theek karta hai, sirf report nahi karta:
**noticing aur fixing ke beech ki window ek settlement run hai.**

### 6.2a ⚠️ Jo clawback kisi cycle tak pahunch hi nahi sakti

Poora refund ho jaane ke **baad** bhi ek cheez khuli reh jaati hai: uski clawback.
`COMPLETED` refund ka `vendorClawback` agli settlement claim karti hai — par agar us
brand ki katautiyan uski bikri se zyada hain, `netPayable` negative ho jaata hai,
settlement `CARRIED_FORWARD` jaati hai, aur **carry forward ka matlab hi hai ki uske sab
claims chhod diye jaate hain**. Agla cycle wahi rows dobara claim karta hai, wahi
negative par pahunchta hai, phir chhod deta hai.

Jab tak brand chal raha hai ye bilkul sahi hai — nayi bikri usse net kar deti hai. **Jis
din wo dhandha band kar de, ye kabhi khatam nahi hota.** Koi error nahi, koi log nahi,
kisi report me kuch nahi.

| Kaam | Kya karta hai |
|---|---|
| `alertVendorDebt` (roz) | `chargeback.writeOffDays` (90) se purani, bina claim hui clawback par **admin ko batata hai** |
| `GET /settlements/admin/debt/:brandId` | Faisla lene se pehle dekhna |
| `PATCH /settlements/admin/debt/:brandId/write-off` | Band karna — likhit wajah ke saath |

⚠️ `RefundRequest.writtenOffAt` **claim filter me** hai. Uske bina write-off sirf dikhawa
hota: agli build wahi row phir claim karti, phir kaatti, phir negative, phir chhod deti
— wahi anant loop, ab ek `MANUAL_ADJUSTMENT` ke saath jo kehta hai ki humne pehle hi
uthaa liya tha. Nuksaan kitaab me **do baar** ginha jaata.

Poora hisaab: [`settlement_flow.md`](./settlement_flow.md) §2.6b.

### 6.3 Har khula state kisi na kisi ki nazar me hai

| State | Kaun dekhta hai |
|---|---|
| `REQUESTED` | `escalateStaleRefunds` |
| `VENDOR_TIMEOUT` | health · `unattendedEscalations` |
| `VENDOR_APPROVED` · `ADMIN_APPROVED` | health · `stalledApprovals` |
| `PROCESSING` | `reconcileRefunds` + health · `stuckProcessingRefunds` |
| `FAILED` | health · `stuckFailedRefunds` (CRITICAL) |
| `AWAITING_BANK_DETAILS` | `remindCustomersAboutBankDetails` — §6.4 |
| *koi bhi khula, bina hold* | health · `unheldRefunds` (CRITICAL) + reconcile repair |
| `COMPLETED`, par clawback jo kisi cycle tak pahunch na paaye | `alertVendorDebt` — §6.2a |

### 6.4 `AWAITING_BANK_DETAILS` — do nudge, phir admin ka

Har doosra khula state koi na koi job **hal** kar deta hai. Ye nahi kar sakta: use
sirf grahak hi aage badha sakta hai, aur kuch kabhi nahi badhayenge — number badal
gaya, app hat gayi, ya ₹200 ke liye mehnat karna theek nahi laga.

| Kab | Kya |
|---|---|
| 24 ghante baad | grahak ko nudge |
| 96 ghante baad | doosra nudge |
| **30 din baad** | ⚠️ admin ko — *"ye ab aapka maamla hai"* |

**Nudge dinon ke faasle par hain, ghanton ke nahi.** Jise pehle hi bataya ja chuka ki
uska refund fail hua, aur phir bar-bar uska account number maanga jaaye — wo use **scam
samajhta hai**, aur jo paisa uska hai wahi cheez ban jaati hai jisse wo sabse zyada
katrata hai.

### 6.4a ⚠️ Aakhri stage nudge nahi hai — wo vendor ke liye hai

`settlementHold` us din se laga hai jis din refund maanga gaya, aur wo us payment ko
**har aane wali settlement** se bahar rakhta hai. Jab tak refund zinda hai ye bilkul
sahi hai. Jab wo atak jaaye, to ye chup-chaap sazaa ban jaata hai — **vendor hamesha ke
liye kisi aur ki khamoshi ki keemat bharta hai.**

Isliye 30 din baad admin ko bataya jaata hai, aur wo `release-hold` se hold chhod sakta
hai — **wajah likhkar**.

> ⚠️ **Hold chhodna refund cancel karna nahi hai.** Paisa abhi bhi grahak ka hai aur
> request khuli rehti hai. Agar wo kabhi account de dein, to `claimRefundAdjustments`
> clawback agle cycle se kaat leta hai — kyunki tab tak us payment par `settlementId`
> lag chuka hoga, aur wahi us function ki shart hai. Kuch bhi maaf nahi hota; sirf
> vendor ka paisa jamna band hota hai.

⚠️ **30 din se pehle `release-hold` mana karta hai** — us waqt tak refund apne aap poora
ho sakta hai, aur tab hold chhodna vendor ko us sale ka paisa de deta jo wapas jaane
wala hai.

⚠️ Aur ek doosri khuli refund usi payment par **ban hi nahi sakti** —
`refund_open_per_transaction_unique` rokta hai. Isi wajah se override surakshit hai: jo
ek row chhodi ja rahi hai, wo chupke se kai rows nahi ho sakti.

`GET /transactions/admin/health` par sab dikhta hai.

---

## 7. ✅ `MANUAL_BANK` — jab paisa usi raaste se wapas nahi ja sakta

`SOURCE` paisa usi card ya UPI par lautata hai jisse aaya tha. Jab wo instrument
**band** ho — card cancel, UPI handle expire — to `SOURCE` **har baar** fail hogi, aur
pehle admin ke paas dabane ko koi doosra button tha hi nahi: request `FAILED` par padi
rehti, vendor ka paisa ruka rehta, har retry par CRITICAL jaata, aur grahak ko uska
paisa kabhi nahi milta.

```
SOURCE fail
   → admin: request-bank-details       → AWAITING_BANK_DETAILS   (grahak ko notice)
   → grahak: bank account jodta hai    (OTP + penny drop)
   → grahak: refund par lagata hai     → ADMIN_APPROVED
   → admin: pay-to-bank                → PayoutLeg INITIATED, refund PROCESSING
   → admin haath se NEFT karta hai
   → admin: confirm-bank-payout + UTR  → leg PAID → applyRefundCompletion
```

### 7.1 ⚠️ Admin shuru karta hai, apne aap kabhi nahi

`SOURCE` ka fail hona hamesha *"instrument mar gaya"* nahi hota — gateway ki do-minute
ki dikkat bhi bilkul aisi hi dikhti hai, aur usme retry chal jaata hai.

Apne aap switch karne ka matlab hota: har us grahak se bank details maangna jinka refund
ek transient blip me atka. **Bina zarurat bank details maangna theek wahi cheez hai jo
ek asli message ko scam jaisa bana deti hai** — aur uske baad wo grahak asli message par
bhi bharosa nahi karega.

Isliye `request-bank-details` sirf `FAILED` se chalta hai, aur `reason` **zaroori** hai:
grahak phone karke poochega ki ye sach hai ya nahi, aur support ke paas jawab me kehne
ko ek line honi chahiye.

### 7.2 Grahak ka account — OTP, phir penny drop

| Kadam | Kya | Kyun |
|---|---|---|
| `POST /bank-accounts/otp` | Code WhatsApp ya email par | Account jodna matlab **paisa kahan jaayega** ye tay karna. Jiske paas grahak ka session hai wo refund apne account par mod sakta tha, aur NEFT wapas nahi aati |
| `POST /bank-accounts` | Code + account + IFSC | Server **khud** CGPEY penny-drop karta hai |
| — | `isVerified` server par nikalta hai | ⚠️ Client se verification ki koi baat nahi maani jaati. Jo client `isVerified: true` likh sake, wo refund kahin bhi bhej sakta hai |

⚠️ **Drop fail hone par bhi row likhi jaati hai**, phir error jaata hai. Ye ajeeb lagta
hai aur jaan-boojh kar hai: support ko dikhna chahiye ki grahak ne koshish ki aur
provider ne kya kaha. `isVerified: false` hi paisa rokta hai — wo row sabooti hai,
manzil nahi.

⚠️ **`models/Bank.js` me customer row nahi daali gayi.** Wo ek **CGPEY verification
record** hai, bank-account model nahi: `brandId` required hai, aur account-number ki
uniqueness Mongo index se nahi balki **collection-wide query** se aati hai
(`verifyBankAndFetchDetails`, `createBank`). Customer row waha daalne par ek vendor ko
onboarding ke beech me *"this account number is already in use"* milta — kisi aise
grahak ki wajah se jise wo jaante bhi nahi — aur wahi check brand ke verification score
me jaata hai. Isi liye `MANUAL_BANK` tala gaya tha, aur isi liye ab
`models/CustomerBankAccount.js` alag hai.

### 7.3 NEFT — wahi machinery jo settlement use karta hai

`PayoutLeg` par `payoutType: REFUND` aur `refundRequestId` ka unique index **pehle se**
maujood tha; ye din uske liye hi socha gaya tha.

- **Leg pehle banti hai, status baad me badalta hai** — beech me crash ho to `APPROVED`
  refund + `INITIATED` leg bachti hai, jo dikhti hai. Ulta kram `PROCESSING` refund bina
  kisi leg ke chhodta, jo padhne me *"paisa nikal gaya par kahin nahi mila"* lagta hai.
- **Payee leg par freeze hota hai**, account row par nahi. Account baad me badal sakta
  hai; jhagde me maayne wo rakhta hai ki **is transfer** me paisa kahan gaya.
- **`isVerified` pay ke waqt dobara jaancha jaata hai.** Attach aur NEFT ke beech ghante
  lagte hain, aur account hat sakta hai.
- **UTR zaroori hai** — teen din baad jab grahak kahe "paisa nahi aaya", bank statement
  par dhoondhne layak wahi ek cheez hai.
- **Bounce par leg mitayi nahi jaati.** Retry **nayi leg** kholti hai. Purani ko edit
  karna us baat ko mita deta hai ki paisa kabhi us account me bheja gaya tha — jo jaanch
  me theek wahi cheez chahiye hoti hai.

### 7.4 ⚠️ Hold poore raaste bhar laga rehta hai

`AWAITING_BANK_DETAILS` **khula status hai** (`REFUND_OPEN_STATUSES` me), aur
`REFUND_HOLD_RELEASING_STATUSES` me jaan-boojh kar **nahi** hai.

Iske bina do cheezein ek saath tootti: grahak usi payment par **doosra** refund file kar
pata (`(transactionId, isOpen)` index match karna band kar deta), aur
`releaseSettlementHold` ko koi khuli request na dikhti — to agli settlement vendor ko us
sale ka paisa de deti jiska refund abhi bakaya hai. Dono chup-chaap.

`__tests__/money/manualBankRefund.test.js` isi ek baat par ek poora test rakhta hai —
failure se lekar paisa pahunchne tak, har kadam par hold jaancha jaata hai.

### 7.5 Grahak ko kya dikhta hai

`statusLabel` — **"Add your bank account so we can send it"**, na ki "Awaiting bank
details". Doosra wala hamari queue batata hai, unka agla kadam nahi.

Notification me: unka claim code, ki **paisa abhi bhi unka hai**, kyun original raasta
kaam nahi kiya, aur app me jaane ka link. ⚠️ Wo kabhi kisi web form ka link nahi bhejti
aur kabhi reply me details nahi maangti — kyunki ye ek aisa message hai jo dikhne me
theek scam jaisa ho sakta hai, aur us grahak ka refund pehle hi ek baar fail ho chuka hai.

---

## 8. Kaun kya padh sakta hai

| Field | Customer | Vendor / Outlet | Admin |
|---|:-:|:-:|:-:|
| `split.totalRefund` | ✅ | — | ✅ |
| `split.vendorClawback` · `vendorPromoReversal` | — | ✅ | ✅ |
| `split.platformPromoReversal` · `gatewayFeeAbsorbed` | — | — | ✅ |
| `utr` | ✅ | — | ✅ |
| `reasonNote` (grahak ne kya kaha) | ✅ | ✅ | ✅ |
| `vendorNote` | ❌ | apna | ✅ |
| `adminNote` · `overrideReason` | ❌ | ❌ | ✅ |
| `customerId` | apna | ❌ | ✅ |

⚠️ `split` me hamara promo hissa aur MDR **usi sub-document par** hain jis par
`vendorClawback` hai — jo vendor ko sach me chahiye. Isiliye yeh faisla
`refundProjection()` me **ek jagah** hota hai, har call site par yaad nahi rakha
jaata.

**Grahak ko `statusLabel` milta hai, kaccha status nahi** — `meta` me bhi nahi.
`VENDOR_TIMEOUT` uske liye *"Under review by Trydood"* hai: grahak ko yeh batana ki
outlet ne anasuna kiya ek jhagda shuru karta hai jise phir platform ko suljhana
padta hai, aur wo aisi jaankari nahi jis par wo kuch kar sake.

---

## 9. Notifications

| Kab | Kise | Severity |
|---|---|:-:|
| Refund maanga gaya | vendor | ⚠️ WARNING *(deadline hai)* |
| Refund maanga gaya | grahak | INFO |
| Window band ho rahi hai | vendor | ⚠️ WARNING |
| Approve hua | grahak | INFO — **kam approve hua to dono rakamein naam lekar** |
| Nmanzoor | grahak | INFO + support ka raasta |
| Escalate hua | admin | ⚠️ WARNING |
| **Refund FAIL hua** | admin | 🔴 **CRITICAL** |
| **Bank details maangi gayin** | grahak | INFO — §7.5, wo ek notice jo grahak se kuch karne ko kehti hai |
| Paisa pahuncha | grahak | INFO — **UTR ke saath** |

`PROCESSING` aur `ADMIN_APPROVED` par koi notification **nahi** — asli transitions
hain par unpar kisi ke karne ko kuch nahi, aur jis notification par koi kaam nahi
kar sakta wo logon ko unhein nazarandaaz karna sikha deti hai jo mayne rakhti hain.

Har notice `sendQuietly()` se guzarta hai: jo refund nikal chuka, jo hold hat chuka,
jo faisla darj ho chuka — unme se koi isliye wapas nahi liya ja sakta ki mail server
band tha.

---

## 10. Settings — `/settings` → `customer.refund`

| Key | Default |
|---|---|
| `method` | `SOURCE` |
| `windowHours` | 24 |
| `vendorApprovalHours` | 24 |
| `adminBufferHours` | 12 |
| `onVendorTimeout` | `ESCALATE` |
| `allowPartial` | `true` |
| `releasePromoOnRefund` | `false` |
| `maxOpenRequests` | 1 |
| `maxRejectedPerWindow` | 3 |
| `requestWindowDays` | 30 |

`releasePromoOnRefund: false` default sahi hai: jo grahak claim kare, refund le, aur
usi code par phir claim kare — usne ek bikri ke liye hamara campaign paisa **do
baar** kharch kiya. Use `true` karna udaar hone ka faisla hai, sahi hone ka nahi.
