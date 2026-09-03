# Refund flow — Trydood 2.0

**Grahak maange → vendor tay kare → admin nikaale.**

Yeh document batata hai ki refund **aaj kaise chalta hai**, code me. Design ka
"kyun" `vendor_settlement_plan.md` §5–§6 me hai; yeh "kya hota hai" hai.

> **Status:** Phase S1 ✅ — `SOURCE` refunds (Razorpay usi card/UPI par lautata hai).
> `MANUAL_BANK` fallback **abhi nahi bana** — S1.5. Neeche §7 me saaf likha hai ki
> tab tak failed refund ka kya hota hai.

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
| `COLLECTION` +netBill | `COLLECTION` −clawback | `VENDOR_PAYABLE` |
| `VENDOR_PROMO_SHARE` −share | `VENDOR_PROMO_SHARE` +share | `VENDOR_PAYABLE` |
| `CONVENIENCE_FEE` +fee | `CONVENIENCE_FEE` −fee | `PLATFORM_REVENUE` |
| `PLATFORM_PROMO_COST` −share | `PLATFORM_PROMO_COST` +share | `PLATFORM_COST` |
| `COMMISSION` +commission | `COMMISSION` −commission | `PLATFORM_REVENUE` |
| `GATEWAY_FEE` −MDR | `GATEWAY_FEE` −MDR **phir se** | `PLATFORM_COST` |

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

### 6.3 Har khula state kisi na kisi ki nazar me hai

| State | Kaun dekhta hai |
|---|---|
| `REQUESTED` | `escalateStaleRefunds` |
| `VENDOR_TIMEOUT` | health · `unattendedEscalations` |
| `VENDOR_APPROVED` · `ADMIN_APPROVED` | health · `stalledApprovals` |
| `PROCESSING` | `reconcileRefunds` + health · `stuckProcessingRefunds` |
| `FAILED` | health · `stuckFailedRefunds` (CRITICAL) |
| *koi bhi khula, bina hold* | health · `unheldRefunds` (CRITICAL) + reconcile repair |

`GET /transactions/admin/health` par sab dikhta hai.

---

## 7. ⚠️ Jo abhi nahi bana — `MANUAL_BANK`

Plan (§6.1) kehta hai: `SOURCE` pehle, aur `refund.failed` aane par `MANUAL_BANK` —
grahak se bank account maango, penny-drop verify karo, admin NEFT kare.

**`SOURCE` bana hai. `MANUAL_BANK` nahi.** Aaj `refund.failed` par:

| | Kya hota hai |
|---|---|
| Request | `FAILED`, par **khuli rehti hai** — paisa abhi bhi wapas jaana hai |
| Hold | **laga rehta hai** — us claim ka paisa vendor ko nahi jaayega |
| Admin | CRITICAL notification, har attempt par nayi |
| Retry | `/admin/:id/pay` phir se `SOURCE` try karta hai |
| Health | `stuckFailedRefunds` me ginta hai |

⚠️ **Agar instrument sach me paisa le hi nahi sakta** (band card, expire ho chuka
UPI handle) to `SOURCE` hamesha fail hoti rahegi, aur admin ke paas dabane ko koi
dusra button nahi hai. Aisa refund tab tak khula rehta hai jab tak S1.5 nahi banta.

Kyun tala gaya: `MANUAL_BANK` ko `CustomerBankAccount` chahiye, aur `models/Bank.js`
ek **CGPEY verification record** hai, bank-account model nahi — usme customer row
daalna vendor onboarding ke liye barood hai (account-number uniqueness Mongo index
nahi, **teen jagah** collection-wide query hai, aur teesri jagah patch na ho to
vendor ka KYC score `REJECTED` tak gir sakta hai). Details `vendor_settlement_plan.md`
§6.5 me.

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
