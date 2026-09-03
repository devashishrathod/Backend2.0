# Settlement flow — Trydood 2.0

**Din band ho → kabza ho → admin manzoori de → NEFT jaaye → UTR record ho.**

Yeh document batata hai ki vendor ka paisa **aaj kaise nikalta hai**, code me.
Design ka "kyun" `vendor_settlement_plan.md` §2–§4 me hai; yeh "kya hota hai" hai.
Refund ka rasta alag doc me: [`refund_flow.md`](./refund_flow.md).

> **Status:** Phase S2 ✅ — build, claim, approve, payout (MANUAL_BANK), ledger,
> reversal, listings aur sweeps sab bane hain.
> `payoutProvider` abhi **`MANUAL_BANK`** hai — matlab NEFT haath se hoti hai aur
> UTR admin type karta hai. RazorpayX / Route aane par sirf yeh value badlegi,
> flow nahi. Statement PDF abhi nahi bana — §9 dekho.

---

## 1. Poora raasta, ek nazar me

```
        ┌──────────────── har ghante: buildSettlements ───────────────┐
        │  settlement.isEnabled == false  →  skip (wajah ke saath)        │
        └───────────────────────────┬────────────────────────────────────┘
                                    │
                 canonical IST period  (delayDays + payoutBufferHours)
                                    │
                    shell banti hai  →  DRAFT  (idempotencyKey lock)
                                    │
              claimTransactions()  →  Transaction.settlementId = <id>
              claimRefundAdjustments() → pichhle cycle ke refund/chargeback
                                    │
                          computeTotals()  →  netPayable
                                    │
                    ┌───────────────┴───────────────┐
            netPayable >= minPayoutAmount      netPayable <= 0
                    │                          ya < minPayoutAmount
             PENDING_APPROVAL                        │
                    │                        CARRIED_FORWARD
                    │                     (rows chhoot jaate hain,
                    │                      agle cycle me aa jaate)
                    │
        ┌───────────┴────────────────────────────────────┐
        │  admin: PATCH /settlements/admin/:id/approve    │
        │  filter me needsRevalidation: {$ne: true}       │
        └───────────┬────────────────────────────────────┘
                    │
            ┌───────┴────────┐
       APPROVED          refuseAndHold → ON_HOLD
            │             (kaunse invoice kharaab hue, naam ke saath)
            │                     │
            │              rebuild → sirf tainted rows chhoote
            │                     │
            │              PENDING_APPROVAL / CARRIED_FORWARD
            │
   PATCH /settlements/admin/:id/pay
   → live bank vs frozen bankSnapshot compare
   → mismatch: ON_HOLD (NEFT ka recall nahi hota)
            │
      PayoutLeg #1 banti hai (INITIATED)  ──unique index par claim──
            │
      status → PROCESSING
            │
   ┌────────┴─────────────────────────────────┐
   │  PATCH .../confirm  (UTR zaroori)         │  PATCH .../fail
   │  leg → PAID, ledger PAYOUT likha jaata    │  leg → FAILED (rakhi jaati hai)
   │        │                                  │  settlement → FAILED
   │  legs total == netPayable ?               │  rows NAHI chhootte
   │     ├── nahi → PROCESSING hi rehta        │       │
   │     │   (split NEFT, agli leg baaki)      │  retry → naya leg, naya
   │     └── haan → PAID + vendor ko UTR       │          bankSnapshot
   └───────────────────────────────────────────┘
            │
   bank ne wapas kheencha?  →  PATCH .../reverse
   → ledger PEHLE (PAYOUT_REVERSAL), rows BAAD me → REVERSED
```

---

## 2. Cycle kaise banta hai — pehle kabza, phir hisaab

### 2.1 Period canonical hota hai, "abhi se peechhe" nahi

`helpers/dates/istDate.js` IST ko **UTC+05:30 fixed** maanta hai (India me DST
nahi hai) aur din ki seemayein `settlementPeriodStart` / `settlementPeriodEnd`
se nikaalta hai.

Yeh zaroori kyun hai: `idempotencyKey` me `periodEnd` jaata hai. Agar period
"abhi minus 72 ghante" hota, to 02:00 par chalne wali job aur 02:05 par chalne
wali retry **do alag keys** banati — aur ek hi din ke do settlement ban jaate.
Canonical seemaayein matlab key har run me byte-ke-byte wahi.

### 2.2 Shell pehle, rows baad me

```js
Settlement.create({ status: DRAFT, idempotencyKey: `STL:<brandId>:<periodEnd>` })
   ↓
claimTransactions({ settlementId, brandId, eligibleBefore, fundsReceivedBefore })
```

Ulta karne ka matlab hota: rows par `settlementId` likh diya, phir shell banane
me fail — aur wo rows kisi aise settlement se bandhe reh jaate jo hai hi nahi.
Wo rows phir kabhi kisi cycle me nahi aate, **bina kisi error ke**.

> ⚠️ Iska ulta risk bhi hai: shell ban gayi aur rows claim hone se pehle process
> mar gaya, to ek **khaali DRAFT** bach jaati hai jiska key us period ko ghere
> baitha hai — agli build us brand ka din **skip** kar degi, hamesha ke liye.
> Isi liye `sweepAbandonedDrafts` hai (§8.4).

### 2.3 Eligible kya hai

`buildEligibilityFilter` — `helpers/settlements/settlementClaims.js`:

| Shart | Kyun |
|---|---|
| `settlementId: null` | kisi aur cycle ne pehle hi le liya to nahi |
| `settlementHold: false` | refund/dispute chal raha hai — paisa rukega |
| `isRefunded: { $ne: true }` | sirf **poora** refund bahar — partial ka bacha hissa ab bhi vendor ka hai |
| `fundsReceivedAt: { $ne: null, $lte: cutoff }` | Razorpay se paisa **hamare** bank me aa chuka |
| `verified: true`, `status: CAPTURED` | adhoora payment nahi |

> ⚠️ `settlementHold` **sirf claim se pehle** ka filter hai. Ek baar
> `settlementId` lag gaya, to hold lagane se is settlement par koi asar nahi —
> eligibility claim ke waqt tay ho chuki hai. Us khidki ke liye `needsRevalidation`
> hai (§3.2).

> ### ⚠️ Partial refund — arithmetic me katta hai, filter se nahi
>
> Pehle filter `amountRefunded: { $lte: 0 }` tha, jo partial refund wali payment
> ko bhi bahar kar deta — aur wo field sirf badhta hai, to **hamesha ke liye**
> bahar. Uper se uska clawback agle cycle me kaata bhi jata tha. ₹810 me ₹300
> refund par vendor ka ₹800 ka sale gaya *aur* ₹296.30 aur kata — ek ₹800 ki
> sale par lagbhag ₹1,100 ka farak, bina kisi error ke.
>
> Ab payment **poori keemat par** claim hoti hai aur uska refund uske saath
> claim hota hai, to `computeTotals` theek utna hi ghatata hai:
>
> ```
> 800 (netBill) − 50 (vendorPromoCost) − 0 (commission) − 296.30 (clawback) = 453.70
> ```
>
> Do niyam isko surakshit banate hain:
>
> 1. `claimRefundAdjustments` sirf un refunds ko leta hai jinki payment par
>    `settlementId` laga hai — yaani jo pay hui ya ab ho rahi hai. Jis payment ka
>    paisa vendor ko kabhi gaya hi nahi, uska clawback dusri sales se nahi kat
>    sakta.
> 2. Dono claim **kram se** chalte hain, pehle transactions. Pehle ye
>    `Promise.all` me the — aur refund claim wahi id padhta hai jo transaction
>    claim likhta hai.

### 2.4 `fundsReceivedAt` — "vendor ko paisa mila" ka asli sawaal

`verifiedAt` matlab grahak ne pay kiya. `fundsReceivedAt` matlab **Razorpay ne
hamare bank me bheja**. Do alag cheezein hain, aur T+N usi doosri se ginna
chahiye — warna hum wo paisa baant rahe honge jo abhi aaya hi nahi.

`recordFundsReceived` isko `settlement.processed` webhook se bharta hai.

### 2.5 Do floor, dono lagte hain

```
eligibleBefore       = now - delayDays * 24h        (T+N)
fundsReceivedBefore  = now - payoutBufferHours      (paisa aane ke baad buffer)
```

Dono paas karni padti hain. `delayDays` refund ke golden rule se bandha hai —
`assertSettlementTimingRule` ise **settings save par 422** karta hai, comment me
salaah nahi.

### 2.5a Chargeback recovery — jo doc me tha par bana nahi tha

`vendor_settlement_plan.md` §7.5 me strategy pehle se likhi thi: *"agle settlement
se recovery — payout ke baad wala default"*. Code me `chargebackAdjustment`
**hardcoded 0** tha aur `CHARGEBACK` / `CHARGEBACK_REVERSAL` ledger types rules
table me the par **koi unhe likhta hi nahi tha**.

Matlab: payment settle hui → vendor ko paisa gaya → bank ne chargeback me wapas
kheench liya → poora nuksaan platform ne chup-chaap uthaya, aur books me nishaan
tak nahi.

Ab:

| Dispute | Kya hota hai |
|---|---|
| `LOST` | `CHARGEBACK` debit — **sirf vendor ka hissa** (netBill − promo − commission), poora disputed amount nahi, kyunki usme hamari fee aur promo ka aadha bhi hai |
| `WON` | `CHARGEBACK_REVERSAL` — par **sirf tab jab loss pehle book hua ho** |
| Recovery | `claimChargebackAdjustments` agle cycle me kaatta hai, `chargebackSettlementId` lock ke saath |

> ⚠️ Lock isliye ki refunds wali hi galti na ho: live query se nikala figure
> **wahi ek chargeback har cycle** kaat deta, hamesha ke liye, aur har mahine ka
> hisaab apne aap me sahi dikhta.
>
> Aur recovery sirf us payment par jiska `settlementId` laga hai — yaani jo pay
> ho chuki. Agar dispute payout se pehle aaya to `settlementHold` ne use waise hi
> rok liya tha; vendor ko mila hi nahi, to kaatne ko kuch hai hi nahi.

### 2.6 Refund aur chargeback adjustment

Pichhle cycle ka refund is cycle me kata hai — aur `RefundRequest.settlementId`
par **claim** hota hai, bilkul transactions ki tarah.

> ⚠️ Yahi wo jagah hai jahan "live query" sabse zyada nuksaan karti. Agar har
> cycle "is brand ke un-adjusted refunds" live poochhta, to **ek hi chargeback
> har cycle me kata jaata** — vendor ko baar-baar. Isi liye figure ek baar compute
> hoke store hota hai.

---

## 3. Admin manzoori — `PATCH /settlements/admin/:id/approve`

### 3.1 Filter me shart, if me nahi

```js
Settlement.findOneAndUpdate(
  { _id, status: PENDING_APPROVAL, needsRevalidation: { $ne: true } },
  { $set: { status: APPROVED, approvedBy, approvedAt } },
)
```

`if (settlement.needsRevalidation) throw` **kaafi nahi** hota: read aur write ke
beech webhook aa sakta hai. Shart update ke filter me hai, to Mongo faisla karta
hai — timing nahi.

### 3.2 `needsRevalidation` — build aur payout ke beech ki khidki

02:00 par build hui, 14:00 par payout hoga. Beech me `dispute.created` ya refund
request aayi to? Row to claim ho chuki hai, `settlementHold` ab bekaar hai.

Isliye webhook **settlement ko flag karta hai** — `taintSettlement()`:

```js
{ $set: { needsRevalidation: true }, $addToSet: { taintedTransactionIds: txnId } }
```

...aur sirf `SETTLEMENT_PRE_PAYOUT_STATUSES` me. Paisa nikal chuka ho to flag
lagana galat sandesh hai; wahan reversal ka rasta hai.

### 3.3 Mana karne par naam bhi milte hain

`refuseAndHold` sirf "approve nahi ho sakta" nahi kehta — **kaunse invoice**
kharaab hue, wo ginta hai:

> *"3 claimed payments are no longer eligible: TD/VCH/26-27/000412,
> TD/VCH/26-27/000455, TD/VCH/26-27/000501"*

Yeh admin ke liye hai. Vendor ko yeh kabhi nahi dikhta (§6).

### 3.4 Rebuild — sirf gande rows chhootte hain

`PATCH /settlements/admin/:id/rebuild` (sirf `ON_HOLD` par):

```js
Transaction.updateMany(
  { _id: { $in: taintedIds }, settlementId: settlement._id },
  { $set: { settlementId: null } },
)
```

Saaf rows **claim me hi rehti hain**. Sab chhod dete to agli build unhe
rebuild ke beech me utha leti, aur wahi rows do settlement me aa jaate.

Rebuild ke baad agar kuchh bacha hi nahi → `CARRIED_FORWARD`.

---

## 4. Paisa nikalna — do kadam, ek hi liye

### 4.1 `pay` — leg khulti hai, phir status badalta hai

`PATCH /settlements/admin/:id/pay` body me kuchh nahi leta. Rakam
`netPayable` hai aur payee frozen `bankSnapshot`.

**Pehle bank dobara compare hota hai:**

```
frozen bankSnapshot  vs  live Bank record
        │
   badal gaya?  →  ON_HOLD + admin ko dono account bataye jaate
```

NEFT ka recall nahi hota. Isi liye yeh "warning" nahi, **rok** hai.

Phir:

```
PayoutLeg.create({ legNumber: n, status: INITIATED })   ← unique index par race jeetti hai
        ↓
transitionSettlement(→ PROCESSING)
```

**Kram jaan-boojh kar yeh hai.** Beech me crash ho to `APPROVED` settlement +
`INITIATED` leg bachti hai — dikhti hai, sweep sambhaal leti hai. Ulta kram
`PROCESSING` settlement bina kisi leg ke chhodta, jo padhne me "paisa nikal gaya
par kahin nahi mila" jaisa lagta hai.

### 4.2 `confirm` — UTR hi asli baat hai

`MANUAL_BANK` ka koi callback nahi hota. **Aadmi hi callback hai.**

```js
PayoutLeg.findOneAndUpdate(
  { _id: leg._id, status: INITIATED },      ← do admin, ek jeet
  { $set: { status: PAID, utr, mode, paidAt } },
)
```

UTR zaroori hai kyunki teen din baad jab vendor kehta hai "paisa nahi aaya", wahi
ek cheez hai jo bank statement par dhoondhi ja sakti hai.

`paidAt` bhi liya jaata hai: shukrawaar ki NEFT aksar somwaar type hoti hai, aur
ledger entry **jab paisa gaya** us tareekh ki honi chahiye, jab click hui us ki
nahi.

### 4.3 Settlement `PAID` tabhi jab legs jud jaayein

```js
const isFinalLeg = paidSoFar >= round2(settlement.netPayable) - 0.005;
```

Badi rakam do NEFT me jaana MANUAL_BANK me aam hai. Pehli leg par hi `PAID`
kar dena matlab settlement har worklist se gayab, aur aadha paisa abhi bhi baaki
— vendor ke paas apna bank statement ginne ke alawa kuchh nahi bachta.

Par **ledger pehli hi leg par likha jaata hai**, kyunki wo paisa sach me nikal
chuka hai.

### 4.4 `fail` — leg mitayi nahi jaati

Bounce hone par leg **rakhi** jaati hai, badli nahi. Retry **nayi leg** banati
hai agle number ke saath. Record me dono koshishen bachti hain — apne UTR aur
apne payee ke saath. Pehli ko edit kar dena us baat ko mita deta ki paisa kabhi
us account me bheja gaya tha, jo jaanch me theek wahi cheez chahiye hoti hai.

`FAILED` rows ko **nahi chhodta**: bounce aam baat hai, aur sahi kaam hai account
theek karke **wahi settlement** dobara bhejna — usi number aur usi statement ke
saath.

### 4.5 `reverse` — ledger pehle, rows baad me

Bank ne `PAID` hone ke baad wapas kheencha:

```
reversePayoutEntries()   ← PAYOUT_REVERSAL, isReversal: true
        ↓
transitionSettlement(→ REVERSED)  → rows chhoot jaate hain
```

Beech me crash: reversal likha hai, rows abhi bhi claimed — **zyada** dikha raha
hai, dikhta hai, theek ho sakta hai. Ulta kram: rows chhoot gaye bina reversal ke
— padhne me "paisa kabhi gaya hi nahi", aur wo rows dobara settle ho jaate.

---

## 5. Ledger

### 5.1 Entry **leg** par bookti hai, settlement par nahi

`ledger_type_payoutleg_unique` har leg ki entry ko apne aap idempotent banata
hai. Settlement-level key hoti to split payout ki doosri leg ki entry mana ho
jaati — aur paisa phir bhi nikal chuka hota.

| Entry | Kab | Kitna |
|---|---|---|
| `PAYOUT` | har leg `PAID` hone par | **us leg** ne jitna bheja, `netPayable` nahi |
| `RESERVE_HOLD` | sirf aakhri leg par | `settlement.reserveHeld` |
| `PAYOUT_REVERSAL` | `reverse` par, har paid leg ke liye | leg ki rakam |

> Reserve alag entry hai: vendor ka paisa hai, bas abhi de nahi rahe. Use payout
> ke saath debit karna matlab kehna ki hum de chuke.

### 5.2 Ledger row kabhi update ya delete nahi hoti

Sudhaar = nayi row, `reversalOf` set. Isi liye `reconcileSettlementLedger`
**sirf padhta hai** (§8.3).

---

## 6. Kise kya dikhta hai

Ek endpoint, do shakl. Scope aur projection dono token se nikalte hain —
`helpers/settlements/buildSettlementReadPipeline.js`.

### Vendor / sub-vendor

`bankSnapshot.accountLast4Digits`, `bankSnapshot.bankName`, poora money
breakdown, `statusLabel`, `approvedAt`, `failureReason`.

**Kabhi nahi:**

| Field | Kyun |
|---|---|
| `taintedTransactionIds` | faisla hone se pehle disputed payments ke naam |
| `needsRevalidation` | andar ka review state — sach ye hai ki "payout ruka hai" |
| `failureNote` | staff-se-staff |
| `approvedBy` | kis admin ne sign kiya, unka kaam nahi |
| `idempotencyKey` | andar ki plumbing |
| poora `bankSnapshot` | last 4 aur bank ka naam bas |

Statement lines me `voucher.platformPromoCost`, `gatewayFee`, `netReceived` bhi
nahi — hamara margin usi sub-document par baitha hai jispar unka `vendorPayable`
hai.

### `statusLabel` — vendor ko enum nahi dikhta

| Status | Vendor padhta hai |
|---|---|
| `DRAFT` / `PENDING_APPROVAL` | Being prepared |
| `APPROVED` | Scheduled for payout |
| `PROCESSING` | On its way to your bank |
| `PAID` | Paid |
| `FAILED` | Payout failed — we are on it |
| `ON_HOLD` | On hold — being checked |
| `REVERSED` | Reversed by the bank |
| `CANCELLED` / `ABANDONED` | Cancelled |
| `CARRIED_FORWARD` | Carried forward to the next payout |

`PENDING_APPROVAL` unhe waise kabhi nahi dikhta: unki taraf se kuchh "pending"
nahi hai, paisa bas aa raha hai.

### Timeline

`SettlementHistory` ki har row dono ko dikhti hai, par `reason`, `performedBy`
aur `snapshot` **sirf admin ko**. *"3 claimed payments are no longer eligible"*
ek aise dispute ka naam leta hai jispar abhi faisla hua hi nahi.

### Customer

Kuchh nahi. `scopeFor` unhe 403 deta hai — settlement me unka kuchh hai hi nahi.

### SUB_VENDOR poora brand dekhta hai, apna outlet nahi

Yeh jaan-boojh kar `buildAccessScopeFilter` **nahi** hai. Settlement poore brand
ke din ka hai; outlet se kaat kar dikhane ka matlab ek aisa figure jo unke dekhe
kisi bhi cheez se match nahi karta — aur paisa chhup jaata hai jo brand ka sach
me bakaya hai.

---

## 7. Endpoints

| Method | Path | Kaun |
|---|---|---|
| `GET` | `/settlements` | token (vendor / sub-vendor / admin) |
| `GET` | `/settlements/:settlementId` | token |
| `GET` | `/settlements/:settlementId/transactions` | token |
| `PATCH` | `/settlements/admin/:settlementId/approve` | admin |
| `PATCH` | `/settlements/admin/:settlementId/rebuild` | admin |
| `PATCH` | `/settlements/admin/:settlementId/hold` | admin |
| `PATCH` | `/settlements/admin/:settlementId/cancel` | admin |
| `PATCH` | `/settlements/admin/:settlementId/pay` | admin |
| `PATCH` | `/settlements/admin/:settlementId/confirm` | admin |
| `PATCH` | `/settlements/admin/:settlementId/fail` | admin |
| `PATCH` | `/settlements/admin/:settlementId/retry` | admin |
| `PATCH` | `/settlements/admin/:settlementId/abandon` | admin |
| `PATCH` | `/transactions/admin/:transactionId/release-hold` | admin |
| `PATCH` | `/settlements/admin/:settlementId/reverse` | admin |

Vendor ke liye koi write nahi hai. Settlement hamara record hai ki hum unhe kya
de rahe hain — koi form nahi jo wo bharein. Ikhtilaf support se hota hai.

**Listing query:** `page`, `limit`, `status`, `settlementNumber`, `open`,
`needsAttention`, `brandId`, `from`, `to`.

`?needsAttention=true` admin ki worklist hai — flagged, `FAILED` ya `ON_HOLD` —
aur **sabse purani pehle** aati hai. Baaki listing `periodEnd` desc hai, kyunki
wo "pichhle hafte ka paisa aaya?" ka jawaab hai.

> Scope aur filter **kaate** jaate hain, upar-neeche rakhe nahi. Vendor kisi aur
> brand ka `brandId` bhejta hai to khaali page milta hai — apne rows nahi. Filter
> "chal gaya" dikhna wahi tarika hai jisse koi aisi report bana leta hai jo kabhi
> lagi hi nahi thi.

---

## 8. Jo apne aap chalta hai

Baaki har money path yahan **shor karke** fail hota hai. Settlement **na hoke**
fail hota hai — aur na hone ko dhoondhna padta hai.

| Job | Kitni der me | Karta kya hai |
|---|---|---|
| `buildSettlements` | 60 min | kal ka cycle banata hai; `isEnabled: false` par wajah ke saath skip |
| `sweepStalePayouts` | 30 min | 6h+ se `INITIATED` leg — **sirf batata hai** |
| `alertLateSettlements` | 60 min | `notReceivedAlertHours` se purana bakaya |
| `reconcileSettlementLedger` | 180 min | legs vs ledger — **sirf padhta hai** |
| `sweepAbandonedDrafts` | 60 min | mari hui `DRAFT` — khaali ho ya aadhi-bani, dono |
| `sweepStrandedClaims` | 60 min | terminal settlement jo ab bhi rows pakde hai |

### 8.1 `buildSettlements` ghante me, raat me nahi

`buildSettlements` `idempotencyKey` par idempotent hai — usi period me doosra run
kuchh nahi banata. Chhota interval isliye hai ki **jis raat process band tha wo
raat agle tick par apne aap bhar jaaye**, na ki kisi ke dekhne tak us brand ka din
chhoota rahe.

### 8.2 `sweepStalePayouts` batata hai, karta nahi

⚠️ Yeh jaan-boojh kar kuchh **badalta nahi**. Ho sakta hai paisa sach me nikal
chuka ho — MANUAL_BANK NEFT type hote hi wapas nahi aati. Apne aap `FAILED` kar
dena matlab ek kaamyaab transfer ke upar "bank ne mana kiya" likh dena, rows agle
cycle me chhod dena, aur vendor ko **dobara** paisa de dena.

Kaun sa hua yeh sirf wo aadmi jaanta hai jo banking screen dekh sakta hai. Isliye
job us aadmi ko bulaati hai, andaaza nahi lagati.

Alert **leg** par keyed hai, settlement par nahi: retry nayi leg kholti hai, aur
doosri leg ka chup ho jaana dekhne layak nayi baat hai.

### 8.3 `reconcileSettlementLedger` sirf padhta hai

Dono taraf ka fark matter karta hai:

- **leg hai, entry nahi** → kitaab kehti hai paisa abhi bhi hamare paas hai, jo ja chuka
- **entry hai, leg nahi** → kitaab kehti hai humne bheja, jo nikla hi nahi

Pehla hamari liability kam dikhata hai, doosra zyada — aur dono tab tak swasth
system jaise padhte hain jab tak koi bank statement se milaan na kare.

Aadha paisa (0.005) ki chhoot hai, taaki rounding kabhi alarm na bajaye.

### 8.4 `sweepAbandonedDrafts`

Khaali `DRAFT` ko `CANCELLED` karta hai aur uska key `STL:VOID:<id>` kar deta
hai, taaki agli build wo period le sake.

⚠️ **Sirf khaali.** Jo draft rows pakde hue hai wo aadhi-bani build hai — uska key
yahan void karna un rows ko aise settlement se bandha chhod dega jo kabhi pay
nahi hogi. Rows chhodna sirf `transitionSettlement` ka kaam hai.

Yeh bhi `transitionSettlement` se hi hota hai, seedha write se nahi — to history
row banti hai aur `performedByRole: SYSTEM` likha jaata hai.

### 8.5 Admin health page

`GET /transactions/payment-health` me settlement ke teen signal hain:

| Signal | Level | Matlab |
|---|---|---|
| `unconfirmedPayouts` | **CRITICAL** | 24h+ se bina UTR ki leg — paisa hil chuka, system ko pata nahi |
| `overdueSettlements` | ATTENTION | 7 din+ se bakaya, alert ja chuka aur ignore hua |
| `strandedDrafts` | ATTENTION | 6h+ purani `DRAFT` — sweep chal nahi rahi |

---

## 9. Notifications

| Kise | Kab | Level |
|---|---|---|
| vendor | `SETTLEMENT_PAID` — UTR ke saath | INFO |
| vendor | `SETTLEMENT_FAILED` — sirf category, note nahi | WARNING |
| vendor | `SETTLEMENT_ON_HOLD` — bina tafseel ke | WARNING |
| admin | `SETTLEMENT_STUCK` — leg par keyed | WARNING |
| admin | `SETTLEMENT_LATE` — ek hi baar, counter par claim | WARNING |
| admin | `SETTLEMENT_LEDGER_DRIFT` | **CRITICAL** |

Har state ke liye notice nahi hai — `DRAFT`, `PENDING_APPROVAL`, `APPROVED`
aisi cheezein hain jinke baare me koi kuchh kar nahi sakta. Jispar koi amal nahi
kar sakta wo notification logon ko un notifications ko ignore karna sikhaati hai
jo matter karti hain.

Har notice par `dedupeKey` hai, to retry hui job ek hi message bhejti hai.
`SETTLEMENT_LATE` ke liye `overdueAlertsSent` counter usi update me badhta hai jo
row claim karta hai — do instance ek saath padh kar dono nahi bhej sakte.

---

## 10. Settings — `/settings` → `customer.settlement`

| Key | Default | Kya karta hai |
|---|---|---|
| `isEnabled` | `true` | band karne par build skip |
| `delayDays` | 3 | T+N floor |
| `payoutBufferHours` | 6 | paisa aane ke baad extra buffer |
| `cycleType` | `DAILY` | period ki lambai |
| `requiresAdminApproval` | `true` | band karne par auto-approve |
| `minPayoutAmount` | 100 | isse kam → `CARRIED_FORWARD` |
| `payoutProvider` | `MANUAL_BANK` | RazorpayX aane par sirf yeh badlega |
| `commissionPercent` | 0 | dhaancha hai, rate abhi zero |
| `reserve.*` | off | risky vendor ka hissa rokna |
| `notReceivedAlertHours` | 96 | iske baad admin ko alert |
| `gatewayFeeBearer` | `PLATFORM` | MDR kaun uthata hai |

> ⚠️ `delayDays` refund ke golden rule se bandha hai:
> `delayDays * 24 >= windowHours + vendorApprovalHours + adminBufferHours`.
> `assertSettlementTimingRule` ise **save par 422** karta hai. Todne ka matlab
> aisa refund jo us paise ka peechha kare jo vendor ke bank me ja chuka.

---

## 10a. Phanse hue paise ke do darwaze

Dono aise the jinke liye code me jagah thi par koi caller nahi — matlab paisa ek
aisi haalat me atak jata tha jisse use koi nikal hi nahi sakta tha.

### `PATCH /settlements/admin/:settlementId/abandon`

`FAILED → ABANDONED` state machine me shuru se tha aur **koi ise call nahi karta
tha**. `ABANDONED` hi ek raasta hai jisse FAILED settlement apni rows chhodti hai
— `failPayout` unhe jaan-boojh kar pakde rehta hai, kyunki bounce ka aam jawab
account theek karke wahi settlement dobara bhejna hai.

Par kuch bounce kabhi theek nahi hote: brand band ho gaya, account sudhar hi
nahi sakta. Bina caller ke wo rows hamesha ke liye ek aisi settlement se bandhi
reh jati thi jise koi kabhi pay nahi karega. Wajah zaroori hai.

### `PATCH /transactions/admin/:transactionId/release-hold`

`settlementHold` paanch jagah lagta hai aur, is endpoint se pehle, **ek** jagah
hatta tha — sirf refund reject hone par. Baaki sab ke liye koi raasta tha hi
nahi: chargeback (jo humne **jeeta** ho tab bhi), `FAILED` refund, dashboard se
kiya gaya refund, poora refund.

Dispute webhook ka apna comment kehta hai *"releasing it is an explicit admin
action"* — wo action bana hi nahi tha. Jis vendor ka chargeback humne jeeta,
uska paisa har aane wali settlement se hamesha ke liye bahar tha, chup-chaap.

Ye override nahi karta jo abhi zinda hai:

| Haalat | Kya hota hai |
|---|---|
| refund abhi khula hai | mana — pehle refund tay karo, hold apne aap hat jayega |
| refund `FAILED` hai | mana — grahak ka paisa abhi bhi bakaya hai (S1.5) |
| chargeback abhi tay nahi hua | mana — bank ka faisla aane do |
| chargeback jeeta / haara (tay ho gaya) | haan, wajah ke saath — yahi wo faisla hai |

---

## 11. Jo abhi nahi bana

- **Statement PDF** — `statementUrl` aur `statementToken` model me hain, generator
  nahi. Abhi vendor `GET /settlements/:id/transactions` se lines padh sakta hai.
- **RazorpayX / Route** — `payoutProvider` aur `PayoutLeg` isi ke liye bane hain.
  Aane par `startPayout` / `confirmPayout` me provider branch judega, flow nahi
  badlega.
- **Reserve release** — `reserveHeld` bookta hai, `reserveReleased` field hai, par
  `holdDays` ke baad chhodne wali job nahi hai. Reserve default me off hai.
- **`MANUAL_BANK` refund fallback** — S1.5, `refund_flow.md` §7 dekho.
