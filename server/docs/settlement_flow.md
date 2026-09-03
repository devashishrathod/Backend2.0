# Settlement flow — Trydood 2.0

**Din band ho → kabza ho → admin manzoori de → NEFT jaaye → UTR record ho.**

Yeh document batata hai ki vendor ka paisa **aaj kaise nikalta hai**, code me.
Design ka "kyun" `vendor_settlement_plan.md` §2–§4 me hai; yeh "kya hota hai" hai.
Refund ka rasta alag doc me: [`refund_flow.md`](./refund_flow.md), chargeback ka
[`dispute_flow.md`](./dispute_flow.md).

> **Status:** Phase S2 ✅ — build, claim, approve, payout (MANUAL_BANK), ledger,
> reversal, listings aur sweeps sab bane hain. Chargeback recovery bhi ab bani hai
> (§2.5a). Poora manifest: [`implementation_phases.md`](./implementation_phases.md).
>
> `payoutProvider` abhi **`MANUAL_BANK`** hai — matlab NEFT haath se hoti hai aur
> UTR admin type karta hai. RazorpayX / Route aane par sirf yeh value badlegi,
> flow nahi.
>
> Statement PDF (§12) aur reserve release (§13) bhi ab bane hain.
>
> **Jo nahi bana:** per-brand settlement config · RazorpayX — §11 me poora.
>
> ⚠️ **Ek baar poora S2 chup-chaap mara pada tha** — ek chhoote hue `};` ki wajah se
> `fundsReceivedAt` kabhi set hi nahi hota tha, to koi settlement ban hi nahi sakti thi.
> §2.4 me poora likha hai. Wo ab theek hai aur test se bandha hua hai.

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

### 2.2a Ek brand ka girna poori raat nahi giraata

Build har brand par loop karti hai, aur har brand apne `try/catch` me hai
(`buildSettlements.js:138`). Girne wala brand `failures[]` me apni wajah ke saath jaata
hai aur **baaki brands chalte rehte hain**.

Bina iske ek kharaab bank record, ek missing config, ya ek rounding throw **us raat ke
saare vendors** ka payout rok deta — aur agli build agle din chalti. Ek brand ka ek din
ruk jaana theek hai; sab ka ruk jaana nahi.

### 2.2b `settlementNumber` counter se aata hai, timestamp se nahi

`generateInvoiceNumber({ series: INVOICE_SERIES.SETTLEMENT })` — wahi Counter-based
helper jo invoice numbers deta hai.

Timestamp ya random se banane par do settlement ka number ek jaisa ho sakta tha, aur wahi
number vendor ko email me jaata hai aur support par bola jaata hai. Counter atomic hai,
to do samanantar build bhi do alag number paate hain.

### 2.2c `delayDays: 0` ek jaayaz value hai

```js
const configuredDelay = Number(settings.delayDays);
const delayDays = Number.isFinite(configuredDelay) ? configuredDelay : 3;
```

⚠️ Pehle `settings.delayDays || 3` tha. `0` falsy hai — to admin ka jaan-boojh kar rakha
hua "same-day payout" **chup-chaap T+3 ban jaata**, settings page par `0` dikhta rehta,
aur koi error kahin nahi aata. `Number.isFinite` "set nahi hai" aur "zero set hai" me
farak karta hai.

> Golden rule phir bhi lagta hai: `delayDays: 0` tabhi save hoga jab refund window +
> vendor approval + admin buffer bhi zero ho. `assertSettlementTimingRule` **save par
> 422** deta hai.

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

> ### 🔴 Yahi wo jagah thi jahan poora S2 chup-chaap mara pada tha
>
> `handleRazorpayWebhook.js` me **ek `};` chhoot gaya tha**. Uske kaaran
> `processWebhookEvent` line 207 se 792 tak fail gaya aur `handleGatewaySettlement` ko
> apne andar nigal gaya — jo line 425 par declare hota hai par 259 par call hota hai:
>
> ```
> ReferenceError: Cannot access 'handleGatewaySettlement' before initialization
>     at handleRazorpayWebhook.js:259:5
> ```
>
> Zanjeer poori hai: handler kabhi chala nahi → `recordFundsReceived` kabhi nahi chala →
> `fundsReceivedAt` **hamesha `null`** → eligibility filter usi par tikta hai → **koi
> settlement kabhi ban hi nahi sakti thi, kisi vendor ko kabhi paisa nahi jaata.**
>
> Aur ye poori tarah **khamosh** tha: throw line 917 par catch hota, webhook `200`
> lautata, Razorpay ko lagta sab theek hai, koi retry nahi. `buildSettlements` har ghante
> chalti aur har baar "0 brands eligible" paati — jo bilkul normal dikhta hai.
>
> ⚠️ Yahi §8 ki pehli line ka asli matlab hai: **settlement na hoke fail hota hai.** Jis
> waqt wo line likhi gayi, wo khatra pehle se hakikat ban chuka tha. Isi liye ab
> `__tests__/money/gatewaySettlement.test.js` **signed payload** ke saath poora webhook
> chalata hai — seedha `processWebhookEvent` bulane wala test is bug ke upar se guzar
> jaata tha, kyunki wo `body` khud de deta tha.

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

### 2.5b ⚠️ Ek payment par **do** dispute — aur jo silently maaf ho jaata tha

Razorpay ek payment par ek se zyada dispute utha sakta hai: chargeback →
pre-arbitration → arbitration, **har phase ka alag dispute ID**, alag rakam aur alag
deadline.

Pehle ye sab `Transaction` ke das denormalised fields par `$set` hote the. Yani doosra
dispute aate hi pehle ka **overwrite** ho jaata — uski deadline gayab, uski rakam gayab.
Aur deadline nikalna matlab **apne aap haar**.

Ledger pehle se theek tha (`ledger_type_dispute_unique` dispute par keyed hai), par
recovery nahi:

```
Ek payment, do LOST dispute:
  Ledger   → dono CHARGEBACK likhe          = 2 nuksaan book
  Recovery → chargebackSettlementId ek hi    = 1 hi vasooli
  ─────────────────────────────────────────────────────────
  Doosra nuksaan platform chup-chaap kha jaata tha
```

Ab har dispute ki **apni row** hai (`models/Dispute.js`), aur:

| | |
|---|---|
| Recovery lock | `Dispute.recoverySettlementId` — per dispute |
| Deadline job | `Dispute.respondBy` padhta hai — **har** deadline, sirf naya nahi |
| Worklist | `GET /transactions/disputes` ab ek row **per dispute** deta hai |
| Vasooli ki rakam | Ledger me **jo sach me book hua** wahi — dobara ganit nahi |

⚠️ **Cumulative cap.** `postChargebackLoss` har nuksaan ko us payment ke **bache hue**
vendor-share ke against caps karta hai, poore share ke nahi. Do dispute alag-alag poora
share paas kar jaate aur milkar vendor ko mile se zyada book kar dete. Reversal ulta
ginta hai, to jeeta hua dispute apni jagah wapas de deta hai.

⚠️ **Out-of-order delivery.** Razorpay ye events **dobara aur kram se bahar** bhejta hai
— ek der se aaya `lost`, `won` ke baad aa sakta hai. `recordDispute` event ke apne
timestamp se tay karta hai, aur wo shart **update ke filter me** hai: jeeta hua dispute
haara nahi ban sakta, aur uske baad vendor se galat vasooli nahi hoti.

⚠️ `Transaction` par ab bhi ek **summary** rehti hai listing ke liye — par usme
`disputeRespondBy` **sabse jaldi khatam hone wali khuli** deadline hoti hai, sabse nayi
nahi. Do dispute saath chal rahe hon to maayne wahi rakhta hai jo pehle nikal jaayega.

### 2.5b Commission — rate aaj `0` hai, par poora raasta bandha hua hai

`commissionPercent` ka default `0` hai, to aaj platform sirf convenience fee kamata hai.
Par **`0` har galti chhupa deta hai**: sign ulta ho, base galat ho, ya kahin ghatana
chhoot gaya ho — sab kuch zero hi dikhega, aur galti us din bahar aayegi jis din rate set
hoga, poore volume ke saath.

Isliye ye teen cheezein ab likhi hui hain, na ki maani hui:

**1. `commissionTax` GST config se nikalta hai, hardcoded nahi.**

`computeTotals` me `commissionTax: 0` likha tha — jabki field model par thi **aur vendor
ko project bhi hoti thi**. Bilkul wahi shakl jo `chargebackAdjustment: 0` ki thi (§2.5a),
jo asli hole nikla. Ab wo commission par wahi teen switches lagata hai jo convenience fee
par lagti hain — `isGstEnabled`, `gstPercentage`, `isGstInclusive`. Do jagah do niyam
nahi.

**2. `netPayable` `commissionDeduction` ghatata hai, `commissionAmount` nahi.**

| GST | commission | tax | vendor se kata | vendorPayable *(₹1,000 sale)* |
|---|---:|---:|---:|---:|
| off | 100 | 0 | 100 | **900** |
| 18% **inclusive** | 100 | 15.25 | 100 | **900** |
| 18% **on top** | 100 | 18 | **118** | **882** |

⚠️ Inclusive me dono barabar hain. On-top me nahi — aur sirf `commissionAmount` ghatane
par **vendor ka GST platform apne margin se bharta**, har sale par, aur settlement phir
bhi apne aap me sahi dikhta kyunki usme har number alag-alag theek hota.

**3. Ledger me commission `VENDOR_PAYABLE` ko debit karta hai.**

Pehle `COMMISSION` sirf `PLATFORM_REVENUE` credit karta tha. Capture gross `netBill`
credit karta hai aur payout sirf `netPayable` debit karta hai — jisme se commission
pehle hi kat chuka hai. Beech ka farak kabhi clear hi nahi hota tha:

```
VENDOR_PAYABLE = 1000 − 900 = +100   ← har sale par, hamesha ke liye
```

Ab `VENDOR_COMMISSION` (naya entry type) `VENDOR_PAYABLE` ko debit karta hai, aur refund
par credit — poora hisaab [`refund_flow.md`](./refund_flow.md) §5.4a me.

> **Sabooti**: `__tests__/money/ledgerBalance.test.js` me **paanch case non-zero rate
> par** chalte hain — GST off, inclusive aur on-top, teenon me. Teenon me
> `VENDOR_PAYABLE`, `PLATFORM_REVENUE` aur `TAX_PAYABLE` poore refund ke baad **zero**
> par aate hain.

**Vendor ko kya dikhega:** `commissionAmount`, `commissionTax` aur `commissionDeduction`
teenon statement me alag line par hain. ⚠️ Chhupane par pehli hi settlement par wahi
sawaal aayega — *"mera ₹1,000 ka sale tha, ₹882 kyun aaye"* — aur uska jawab statement me
kahin nahi hota.

### 2.6 Refund aur chargeback adjustment

Pichhle cycle ka refund is cycle me kata hai — aur `RefundRequest.settlementId`
par **claim** hota hai, bilkul transactions ki tarah.

> ⚠️ Yahi wo jagah hai jahan "live query" sabse zyada nuksaan karti. Agar har
> cycle "is brand ke un-adjusted refunds" live poochhta, to **ek hi chargeback
> har cycle me kata jaata** — vendor ko baar-baar. Isi liye figure ek baar compute
> hoke store hota hai.

### 2.5c Reserve ka rate — ab **har brand ka apna** (S3-7)

`reserve.percent` sabke liye ek hi number tha, aur `riskChargebackCount`
`constants/customer.js` me, `Setting` schema me aur `getCustomerConfig` me
maujood tha — admin panel se badla ja sakta tha — jabki **koi code use padhta hi
nahi tha**. Wahi shakal jo `chargebackAdjustment: 0`, `commissionTax: 0`,
`reserveReleased: 0` aur `chargeback.writeOffDays` ki thi.

`helpers/settlements/reserveRisk.js` ab rate chunta hai:

| Haalat | `basis` | Rate |
|---|---|---|
| Reserve band hai | `DISABLED` | 0 |
| Kuch khilaaf nahi | `BASE` | `percent` (5) |
| Chargeback count **aur** rate dono paar | `RISK_CHARGEBACKS` | `riskPercent` (15) |
| Count paar, par bikri bahut kam | `TOO_FEW_PAYMENTS` | `percent` |
| Brand bilkul naya (`newVendorReserveDays`) | `NEW_VENDOR` | `riskPercent` |

⚠️ **Count akela kaafi nahi — size ko sazaa deta hai.** 10,000 sale par 2
chargeback wala brand 40 sale par 2 wale se **behtar** hai; sirf
`riskChargebackCount >= 2` dekhne se pehle wale se zyada roka jaata — theek ulta.
Count trigger hai, rate test hai; **dono** paar hone chahiye.

⚠️ **Aur rate akela bhi kaafi nahi — chhote sample par jhooth bolta hai.** 3 sale
me se 1 chargeback matlab 33%, jiska koi matlab nahi. `riskMinPayments` se neeche
brand base rate par hi rehta hai, chahe ganit kuch bhi kahe. Iske bina ek naye
outlet ka sabse kharab hafta unke pehle mahine ka chautha hissa jama deta.

⚠️ **`maxPercent` ek business faisla hai, ganit nahi.** Uske bina ek bura mahina
lagbhag poora payout rok leta — aur wahi tarika hai jisse ek sudhrne wali dikkat
band outlet ban jaati hai. Ceiling base rate par bhi lagti hai: galti se
`percent: 90` set ho jaana bhi payout khaali nahi kar sakta.

⚠️ **Jeeta hua dispute nahi ginha jaata.** Wo is baat ka sabooot hai ki sale sahi
thi, aur jeete hue case par vendor ka paisa rokna unhe samjhaya nahi ja sakta.
Baaki sab ginha jaata hai — khula hua (jiske liye reserve hai hi) aur haara hua
(jisme paisa gaya).

⚠️ **Poore run ke liye do query, per-brand do nahi.** Seedha tarika — ek helper jo
`brandId` leta hai, loop ke andar se bulaya jaata — 500 brands ki raat me 1,000
round trip ban jaata, yani wahi number badhta hai jo badhna hi nahi chahiye.
`buildReserveRiskMap` do aggregation brand se group karke sabka jawab ek saath
deta hai, aur `buildForBrand` ko **pass** hota hai — dobara fetch nahi.

⚠️ **Rate settlement par freeze hota hai.** `reserveHeld` pehle store hota tha par
**rate nahi** — jo tab tak theek tha jab sabka ek hi rate tha. Ab rate ek
*chalti hui* window se aata hai: statement khulne tak wo window hil chuki hoti
hai, to *"March me mujhse 15% kyun roka"* ka jawab aaj ka number hoga, jo alag
number hai, aur page ka hisaab reproduce hona band ho jaayega.
`Settlement.reservePercent` + `reserveBasis` jawab ke saath **kaam** bhi rakhte
hain: *"180 din me 260 sale par 4 chargeback"* aisi baat hai jispar vendor bahas
kar sakta hai; *"15%"* nahi.

⚠️ Aur ye vendor ko bhi **dikhta** hai (`reserveLabel`), kyunki sirf `reserveHeld`
dikhna aisa number hai jise wo check hi nahi kar sakta — ek hi ₹1,000 ki bikri
par ek outlet se ₹50 aur doosre se ₹150 rukta hai, aur page par wajah kahin nahi.
Wo arbitrary padhta hai, aur arbitrary par vendor escalate karta hai.

### 2.6a ⚠️ Jab katautiyan bikri se zyada nikal jaayein

`netPayable <= 0` ho to settlement `CARRIED_FORWARD` jaati hai, aur **carry forward ka
matlab hi hai ki uske sab claims chhod diye jaate hain** — jaan-boojh kar, taaki debt
aur bikri dono agle cycle me beh jaayein. Eligibility par koi `periodStart` floor nahi
hai, isliye release hi carry forward hai.

Do bilkul alag baatein is ek status me hain:

| Kya hua | Vendor ko message | Kyun |
|---|---|---|
| Minimum payout se neeche | **kuch nahi** | Rozmarra ki baat. Ispar bhi message bhejna sirf itna karega ki log us message ko ignore karne lagenge jo maayne rakhta hai |
| Katautiyan bikri se zyada | `SETTLEMENT_CARRIED_FORWARD` | Payout aa hi nahi raha, aur wajah aksar is cycle se purani hai |

Doosri wali pehle **bhi chup thi**. Outlet ne bikri ki, payout ka intezaar kiya, aaya
kuch nahi, koi message nahi — unki taraf se ye us payout se alag dikhta hi nahi jo
chup-chaap fail ho gaya ho. Pehli khabar support par phone se aati thi, aksar hafton
baad.

⚠️ Message **kabhi invoice nahi** hai. Wo saaf kehta hai ki baaki rakam agli settlement
me jaati hai aur aage ki bikri se katti hai — *"hume kuch dena nahi hai aur kuch karna
nahi hai"*. Log pehla matlab yahi nikalte hain ki ab paisa bharna padega.

⚠️ Aur jo cycle theek **zero** par net hui, uska message alag hai: wahan kuch carry
nahi hota. *"Baaki ₹0.00 agli settlement me jaata hai"* aisa vaakya hai jiska koi
matlab nahi aur jo padhne me system ki galti lagta hai.

### 2.6b ⚠️ Jo katauti kisi cycle tak pahunch hi nahi sakti — S3-9

Jab tak brand chal raha hai, upar wala loop apne aap khatam ho jaata hai: nayi bikri
katauti ko net kar deti hai. **Jis din wo dhandha band kar de, ye kabhi khatam nahi
hota.** Wahi rows har cycle claim hote hain, wahi negative aata hai, phir chhod diye
jaate hain — koi error nahi, koi log nahi, kisi report me kuch nahi. Paisa hamari
kitaab me aise pada rehta hai jaise kisi se aana hai, jabki wo aadmi wapas aa hi nahi
raha.

| Kaam | Kya karta hai |
|---|---|
| `computeVendorDebt({brandId})` | Kitna, kitna purana, kaunse rows — **rows ginta hai, ledger balance nahi** |
| `alertVendorDebt` (roz) | `chargeback.writeOffDays` (90) se purani debt par admin ko alert |
| `GET /settlements/admin/debt/:brandId` | Faisla lene se pehle dekhna |
| `PATCH /settlements/admin/debt/:brandId/write-off` | Band karna — likhit wajah ke saath, optional `olderThanDays` |

⚠️ **Ledger balance kyun nahi.** Brand ka `VENDOR_PAYABLE` balance *"net position kya
hai"* ka jawab hai — balance sheet ke liye sahi number. Faisle ke liye galat: wo debt
ko un takings se net kar deta hai jo abhi payout hui hi nahi — yani jo paisa hum unka
abhi bhi rakhe hue hain. Ek brand us balance par ₹2,000 upar ho sakta hai aur phir bhi
₹800 ka chargeback dhoye baitha ho jise koi cycle chhoo hi nahi sakti.

⚠️ **Sirf un rows par jinka payment vendor ko diya ja chuka.** Wahi test dono claim
functions lagate hain. Jo payment unhe kabhi mili hi nahi, uska refund ya chargeback
debt hai hi nahi — `settlementHold` ne wo paisa har cycle se bahar rakha, yani **abhi
bhi hamare paas hai**. Use ginna ek receivable gaḍhna hai, aur uspar write-off platform
ke naam wo nuksaan likh dega jo platform ne kabhi uthaya hi nahi.

⚠️ **Chargeback ki keemat wahi jo ledger me book hui**, dobara ganit nahi —
`postChargebackLoss` har nuksaan ko us payment ke bache hue hisse tak cap karta hai
(§2.5b), aur dobara ganit us cap ko ignore karke wo paisa report — aur phir maaf — kar
dega jo kabhi gaya hi nahi.

⚠️ Write-off har row par **do** `MANUAL_ADJUSTMENT` likhta hai:

```
CREDIT  VENDOR_PAYABLE   →  unka balance zero; aage koi cycle is debt ko dekhega hi nahi
DEBIT   PLATFORM_COST    →  humne uthaya
```

Reference (`disputeId` / `refundRequestId`) **sirf vendor wali row par**.
`ONCE_PER_DISPUTE` aur `ONCE_PER_REFUND` `{reference, entryType}` par unique hain, to
dono par lagane se doosri row duplicate-key par chup-chaap gir jaati — vendor ka debt
saaf ho jaata, platform ka cost kabhi aata hi nahi, aur kitaab theek utni chhoti reh
jaati jitna maaf kiya tha. Isliye joda saath likha jaata hai aur cost wali row tabhi
chhodi jaati hai jab vendor wali row khud kehti hai ki wo pehle se thi.

⚠️ Ledger pehle, rows baad me — wahi kram jo har reversal use karta hai. Unique index
vendor wali row ko idempotent bana deta hai, to crash ke baad retry kuch dobara nahi
likhta aur aage badhkar rows mark kar deta hai. Pehle mark karke crash hona ek debt ko
bina nishaan ke maaf kar dega.

⚠️ Aur `writtenOffAt` **dono claim filters me** hai. Uske bina write-off sirf dikhawa
hai: agla build wahi row phir claim karta, phir kaatta, phir negative, phir chhod deta
— wahi anant loop, ab ek `MANUAL_ADJUSTMENT` ke saath jo kehta hai ki humne pehle hi
uthaa liya tha. Nuksaan kitaab me **do baar** ginha jaata.

> ### Identity ab teen hisson ki hai
>
> ```
> jo abhi bhi dena hai  +  jo de diya  +  jo maaf kiya
>     ===  unke hisse ki bikri  −  unke hisse ka refund
> ```
>
> Purani do-hisson wali identity us duniya ki thi jahan har debt aakhir me vasool ho
> jaati hai. `moneyInvariants.test.js` dono likhta hai — taaki koi baad me
> `PLATFORM_COST` wali row hata kar ise "theek" na kar de.

---

## 3. Admin manzoori — `PATCH /settlements/admin/:id/approve`

### 3.0 ⚠️ Jab manzoori band ho — `settlement.requiresAdminApproval`

Ye setting `constants/customer.js` me hai, `Setting` schema me hai, admin panel se
badli ja sakti hai, aur uska apna comment kehta hai *"turning this off
auto-approves"* — jabki **koi code use padhta hi nahi tha**. Jis admin ne isse band
kiya taaki payout kisi aadmi ke click ka intezaar na kare, use na auto-approval
mila **na koi error**: har settlement pehle jaisa hi ruki rahi, aur jo switch ise
theek karne ke liye tha usne kuch kiya hi nahi. Is flow me **saatvin** field jo
dono taraf wired thi aur beech me kisi se judi nahi thi.

Ab `false` par build seedha `APPROVED` par jaata hai.

⚠️ **Manzoori dena paisa dena nahi hai.** `PATCH /settlements/admin/:id/pay` ab bhi
aadmi ka jaan-boojh kar kiya gaya kaam hai, aur `paySettlement` usi waqt
`needsRevalidation` **dobara** padhta hai — uska apna note kehta hai ki approval par
flag dekh lena *"kaafi nahi"* hai, kyunki us khidki me ghante guzarte hain aur uske
andar dispute aa sakta hai. Yani ye ek **qatar hataata hai, pehredaar nahi**.

⚠️ **`!== false`, `Boolean(...)` nahi.** Jo settings document is field ke banne se
pehle ka hai usme ye hai hi nahi. `Boolean(undefined)` padhne par agle deploy par
platform ka **har payout** chup-chaap auto-approve ho jaata.

⚠️ **`approvedAt` haan, `approvedBy` kabhi nahi.** `approvedAt` wahi hai jo statement
aur har *"kitni der se atka hai"* query padhti hai — na likhna matlab auto-approved
settlement hamesha ke liye atki hui dikhti. Aur `approvedBy` me kisi user ka naam
likhna theek us record me jhooth hoga jise log *"is payout ki ijaazat kisne di"*
poochhne par kholte hain. History row saaf kehti hai: *"no person reviewed this
settlement"*.

⚠️ Auto-approved settlement bhi `SETTLEMENT_PRE_PAYOUT_STATUSES` me hai, to
`alertLateSettlements` use waise hi dekhta hai — koi na paye to 96 ghante baad wahi
alert aata hai.

⚠️ Aur agar baad me taint ho jaaye: `paySettlement` mana karke `ON_HOLD` bhejta hai,
admin rebuild karta hai, `PENDING_APPROVAL` par aa jaati hai. Yani **aadmi theek tab
shaamil hota hai jab kuch galat hua ho** — jo is switch ka poora matlab hai.


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

> ### ⚠️ Race ko `legNumber` wala index nahi rokta — `payout_settlement_inflight_unique` rokta hai
>
> `legNumber` maujooda legs **gin kar** nikalta hai, aur wo ek read hai. Do samanantar
> `pay` chalein to ek ko 1 milta hai aur doosre ko 2 — **dono inserts number wale unique
> index se nikal jaate hain**. Phir status transition sirf ek jeeta hai, aur haarne wale
> ki leg `INITIATED` par **anath** pad jaati hai.
>
> Wo anath harmless nahi hai: `sweepStalePayouts` 6 ghante purani `INITIATED` leg ko
> *"paisa shayad ja chuka"* batata hai, aur use confirm karne wala admin vendor ko
> **do baar** paisa de deta hai.
>
> Isliye ab ek aur partial unique index hai — `(payoutType, settlementId)` **jahan
> `status: INITIATED`**. Ek settlement par ek waqt me ek hi leg udaan me. ⚠️ `status`
> filter me hona zaroori hai: uske bina ek settlement par kabhi doosri leg banti hi nahi,
> aur bounce ke baad retry **hamesha ke liye** band ho jaata.
>
> Refund ke payout par bhi wahi — `payout_refund_inflight_unique` ([`refund_flow.md`](./refund_flow.md) §7.3).
>
> **Ye ek maujooda test ne pakda** (`paySettlement.test.js` ka concurrency case), jo
> kabhi-kabhi hi girta tha — timing par nirbhar tha, isliye pehle flake jaisa dikhta.

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

⚠️ `CARRIED_FORWARD` par label kaafi nahi hai jab wajah katautiyan hon — us haalat me
`SETTLEMENT_CARRIED_FORWARD` notice bhi jaati hai, aur wajah unki bhaasha me hoti hai.
Dekho §2.6a.

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
| `GET` | `/settlements/statement/:token` | **PUBLIC** — §12 |

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
| `disputeDeadlines` | 60 min | dispute ka jawab dene ki tareekh — **sirf batata hai** |
| `alertVendorDebt` | 24 ghante | jo katauti kisi cycle tak pahunch hi nahi sakti — **sirf batata hai** (§2.6b) |
| `reapShadowIndexes` | 60 min | blanket unique index jise ek partial pehle hi replace kar chuka hai — **hataata hai**, aur har baar admin ko CRITICAL alert |

⚠️ **`reapShadowIndexes` iss list me akela hai jo asal me kuch badalta hai.** Baaki sab
jaan-boojh kar sirf report karte hain, kyunki unka faisla aadmi ka hai — ek unconfirmed
NEFT sach me chali gayi ho sakti hai, aur use apne aap fail karna vendor ko do baar paisa
de dega.

Ye alag isliye hai ki yahan koi faisla hai hi nahi: wo index kisi bhi haalat me sahi
nahi hai, uska replacement pehle se maujood hai (aur na ho to **kuch nahi hataya
jaata**), aur jab tak wo baitha hai tab tak **lagbhag har doosra voucher claim** fail ho
raha hai. Sirf report karna yahan "na karna" hi hai — aur pehle wahi ho raha tha.
Poora hisaab: `implementation_phases.md` §10.7.

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

### 8.2a `disputeDeadlines` — wo tareekh jise koi aur nahi dekhta

Baaki har money deadline baad me theek ho sakti hai. Ye nahi: **dispute ka jawab dene ki
tareekh nikal jaana matlab apne aap haar**. Bank dobara nahi poochta, Razorpay chase nahi
karta, aur kahin koi error bhi nahi aata — system ke hisaab se kuch hua hi nahi.

`Transaction.disputeRespondBy` webhook se bharta tha aur **use padhne wala koi nahi tha**.

| Bacha waqt | Kya |
|---|---|
| 72h+ | kuch nahi |
| 72h – 24h | ⚠️ WARNING |
| 24h – 0h | 🔴 CRITICAL |
| nikal gaya | 🔴 CRITICAL, 7 din tak |

⚠️ **Ghante me, roz nahi.** Aakhri chetavani 24h par hai; roz chalne wali sweep use aakhri
din me kahin bhi gira sakti thi — deadline ke baad bhi.

⚠️ **Sirf batata hai** — §8.2 wali hi wajah: evidence sirf wo aadmi file kar sakta hai
jiske paas Razorpay dashboard ho, aur **har dispute par ek hi jawab milta hai**. Job jo
apne aap kuch bhej de, wo jo bhi uske paas hai wahi bhej dega.

`disputeAlertsSent` counter hi claim hai — ek stage ek hi baar, chahe do instance saath
sweep karein. Bina iske ghante-ghante wahi CRITICAL jaata, aur log channel mute kar dete.

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

`GET /transactions/admin/health` me settlement ke teen signal hain:

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
| admin | `DISPUTE_DEADLINE` — 72h par | WARNING |
| admin | `DISPUTE_DEADLINE` — 24h par, aur nikal jaane par | **CRITICAL** |
| vendor | `SETTLEMENT_CARRIED_FORWARD` — **sirf jab katautiyan wajah hon** (§2.6a) | WARNING |
| admin | `VENDOR_DEBT_AGED` — jo vasooli kisi cycle tak pahunch na sake (§2.6b) | WARNING |
| admin | `SHADOW_INDEX_REAPED` — doosra writer zinda hai | **CRITICAL** |

Har state ke liye notice nahi hai — `DRAFT`, `PENDING_APPROVAL`, `APPROVED`
aisi cheezein hain jinke baare me koi kuchh kar nahi sakta. Jispar koi amal nahi
kar sakta wo notification logon ko un notifications ko ignore karna sikhaati hai
jo matter karti hain.

⚠️ `CARRIED_FORWARD` isi niyam ka **apwaad** hai, aur soch kar. Do bilkul alag baatein
us ek status me hain: *"minimum payout se neeche, agli baar mil jaayega"* rozmarra ki
hai aur chup rehti hai; *"aapki katautiyan is period ki bikri se zyada thi"* ek payout
hai jo aa hi nahi raha, aur wo pehle bhi chup tha. Outlet ki taraf se wo us payout se
alag dikhta hi nahi jo chup-chaap fail ho gaya ho.

⚠️ `SHADOW_INDEX_REAPED` **din ke hisaab se dedupe nahi hota**, `VENDOR_DEBT_AGED` ke
ulat. Har reap doosre writer ka **alag restart** hai, aur ginti aur waqt hi sabooot
hain — unhe ek roz ke message me nichodna wahi ek signal phenk dena hai jo batata hai
ki ye kitni baar ho raha hai. Dedupe key **minute** par hai: itna ki ek hi sweep me do
instance ek hi cheez reap karein to ek message jaaye, aur itna nahi ki ek ghante baad
ka doosra restart chhup jaaye.

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
| `requiresAdminApproval` | `true` | band karne par build seedha `APPROVED` par jaata hai — §3.0. ⚠️ Ye setting **kisi code ne padhi hi nahi thi** jab tak §3.0 nahi bana |
| `minPayoutAmount` | 100 | isse kam → `CARRIED_FORWARD` |
| `payoutProvider` | `MANUAL_BANK` | RazorpayX aane par sirf yeh badlega |
| `commissionPercent` | 0 | Rate zero, par poora raasta bandha hua — §2.5b. On karne par us din ke **baad** wali sales par lagega; purani par nahi, kyunki har claim apna rate freeze karti hai |
| `reserve.isEnabled` | `false` | band. Raasta poora bandha hua hai — §2.5c |
| `reserve.percent` | 5 | base rate, jab reserve on ho |
| `reserve.holdDays` | 30 | kitne din baad reserve matured maani jaati hai |
| `reserve.riskChargebackCount` | 2 | itne chargeback ke baad hi dekha jaata hai. ⚠️ **Trigger hai, poora test nahi** — akela ye bade brand ko sazaa deta hai |
| `reserve.riskLookbackDays` | 180 | count aur rate dono isi window me naape jaate hain |
| `reserve.riskMinPayments` | 20 | isse kam bikri par rate ka koi matlab nahi — brand base rate par rehta hai aur `TOO_FEW_PAYMENTS` kehta hai |
| `reserve.riskDisputeRatePercent` | 1 | chargeback ÷ payments, isse upar risky |
| `reserve.riskPercent` | 15 | risky brand ka rate |
| `reserve.maxPercent` | 25 | ⚠️ **Ceiling — base rate par bhi lagta hai.** Uske bina ek bura mahina lagbhag poora payout rok leta |
| `newVendorReserveDays` | 0 | band. On karne par itne din purana na hone wala brand `riskPercent` par — unproven matlab **zyada** roka jaata, kam nahi |
| `chargeback.writeOffDays` | 90 | isse purani bina claim hui katauti par `alertVendorDebt` — §2.6b |
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

- ~~**Statement PDF**~~ — ✅ **ban gaya**, §12 dekho.
- **Per-brand settlement config** — `buildSettlements.js:63` `getCustomerConfig()` se
  `config.settlement` padhta hai, yaani **saare brands ke liye ek hi** `delayDays`,
  `minPayoutAmount` aur `payoutProvider`. Koi `BrandSettlementConfig` model nahi hai.
  ⚠️ Jis din ek brand ko alag T+N chahiye, ye banana padega — aur tab
  `buildEligibilityFilter` ko brand-wise config lena hoga, jo abhi ek hi baar loop ke
  **bahar** padha jaata hai.
- **RazorpayX / Route** — `payoutProvider` aur `PayoutLeg` isi ke liye bane hain.
  Aane par `startPayout` / `confirmPayout` me provider branch judega, flow nahi
  badlega.
- ~~**Reserve release**~~ — ✅ **ban gaya**, §13 dekho.
- ~~**`MANUAL_BANK` refund fallback**~~ — ✅ **ban gaya**, `refund_flow.md` §7 dekho.

---

## 12. ✅ Statement PDF

`statementUrl` aur `statementToken` model par shuru se the aur read pipeline unhe
project bhi karta tha — par **unhe koi bharta nahi tha**. Vendor lines API se padh
sakta tha, par accountant ko bhejne layak koi kaagaz nahi tha.

```
GET /settlements/statement/:token       ← PUBLIC, koi JWT nahi
```

### 12.1 Token `PAID` hone par banta hai — aur `transitionSettlement` me

⚠️ `PAID` **do** jagah se aata hai: normal aakhri leg, aur us confirmation ka
self-heal jo leg pay hone ke baad crash ho gaya tha. Token `confirmPayout` me
banate to doosre raaste se aayi settlement ka koi statement hota hi nahi — aur wo
chhed sirf tab dikhta jab vendor apna kaagaz maangta.

Isliye wo `transitionSettlement` me banta hai, jahan **har** raasta guzarta hai.
Jo token pehle se hai wo badalta nahi — warna kisi ke inbox me pada link mar jaata.

### 12.2 Sirf `PAID` ka statement hota hai

Har pichhla state abhi hil sakta hai: `rebuild` tainted rows chhodta hai,
`CARRIED_FORWARD` unhe agle cycle me deta hai, bounce hui payout nayi leg se retry
hoti hai. Un me se kisi ka PDF cache karna matlab aisa kaagaz dena **jiske aankde
baad me badal gaye** — aur wo vendor ke paas, hamare naam ke saath, padha rehta.

### 12.3 Pehli baar maangne par bana, payout par nahi

Zyadatar statement kabhi khole hi nahi jaate. **Number** build ke waqt hi allot ho
jaata hai, to series me gap nahi padta; **kaagaz** pehli baar maangne par banta hai
aur uske baad settlement par cache ho jaata hai — bilkul invoice ki tarah.

### 12.4 ⚠️ Kaagaz par kya nahi jaata

`platformPromoCost`, `gatewayFee` aur `netReceived` **usi sub-document** par baithe
hain jispar vendor ke apne aankde hain — par wo hamara margin aur hamari laagat hain.
API ye faisla `buildSettlementReadPipeline` me ek baar karta hai; kaagaz ko **wahi
faisla dobara** karna padta hai, na ki jo row me pada ho wo chhaap dena.

Account number bhi **sirf masked** — statement forward hota hai, screenshot hota hai,
support chat me paste hota hai. Poora number chhaapne ka matlab hai use un sab jagah
hamesha ke liye chhod dena.

### 12.5 Har katauti apne naam se

Jis vendor ke ₹1,000 ke sale par ₹802 aaye, wo poochega kyun — aur uska jawab
**kaagaz par** hona chahiye, email me ya support se nahi. Har wo line jo payout ghatati
hai, naam se likhi hai. **Commission ki line zero par bhi chhapti hai**, taaki jis din
rate on ho, do mahine milaane wale vendor ko ek number badalta dikhe, na ki ek nayi
line kahin se prakat hoti.

Har transfer ka **UTR** bhi — teen din baad jab vendor kahe "paisa nahi aaya", bank
statement par dhoondhne layak wahi ek cheez hai, aur wo usi kaagaz par hai jo unke paas
pehle se hai.

---

## 13. ✅ Reserve — andar jaane ka raasta tha, bahar aane ka nahi

Reserve ek risky vendor ka thoda hissa rok lene ke liye hai — chargeback aane par uske
paas kuch bacha ho. `reserve.isEnabled` **abhi `false`** hai.

Par uska aadha raasta hi bana hua tha:

| | Pehle |
|---|---|
| `reserveHeld` | ✅ compute hota, `netPayable` se ghatata, ledger me `RESERVE_HOLD` bhi likhta |
| `reserveReleased` | 🔴 **hardcoded `0`** |
| `RESERVE_RELEASE` | 🔴 ledger type maujood, likhta koi nahi |
| release job | 🔴 tha hi nahi |

Yani **reserve on karte hi paisa andar jaata aur kabhi bahar nahi aata** — hamesha ke
liye, chup-chaap, aur beech ki har settlement bilkul sahi dikhti.

⚠️ Ye **teesri** baar wahi shakl thi: `chargebackAdjustment: 0` (§2.5a), `commissionTax: 0`
(§2.5b), aur ab ye.

### 13.1 Matured reserve agli settlement me jud jaata hai

```
Settlement N:    earned 1000 → reserve 50 roka → payout 950
                 (30 din baad)
Settlement N+1:  earned 1000 → reserve 50 roka → +50 wapas → payout 1000
```

`claimMaturedReserves` use **lock ke saath** claim karta hai
(`reserveReleaseSettlementId`) — bilkul refunds aur chargebacks ki tarah. ⚠️ Bina lock
ke ek live "kya matured hai" query wahi reserve **har cycle** wapas karti, aur har mahine
ka hisaab apne aap me sahi dikhta jabki vendor ko wahi paisa baar-baar milta.

### 13.2 ⚠️ Chhoda hua reserve dobara nahi roka jaata

```js
reserveHeld  = max(0, beforeReserve) * pct     // sirf is cycle ki sales par
netPayable   = beforeReserve − reserveHeld + reserveReleased
```

Released reserve **naye hold ke baad** juda hai. Use base me milane par us paise par
dobara 5% kat jaata — reserve par reserve — aur har cycle guzarne par vendor ka paisa
thoda-thoda ghatta rehta, hamesha ke liye, jabki har settlement alag se sahi dikhti.

### 13.3 ⚠️ Jo brand dhandha band kar de, uska reserve bhi wapas aata hai

`brandsWithEligibleMoney` eligible **transactions** par `distinct` hai. Jis brand ki koi
nayi sale nahi, wo cycle me aata hi nahi — aur mahine pehle roka hua uska reserve wahin
pada rehta, hamesha, bina kisi nishaan ke.

Isliye build ab do jagah se brands uthata hai: sales wale, **aur** `brandsWithMaturedReserves`
wale. Unka paisa isliye unka rehna band nahi ho jaata ki unhone bechna band kar diya.

### 13.4 Release apne aap, par payout par manzoori waise hi

`holdDays` poore hote hi reserve agli settlement me jud jaata hai — alag manzoori nahi
maangi jaati us cheez ke liye jo pehle se tay thi. Par wo settlement phir bhi
`requiresAdminApproval` se guzarti hai, to paisa bina dekhe nahi nikalta.

### 13.5 ⚠️ Teesra claim lock — release me chhootne par

`releaseSettlementClaims` ab **teen** lock chhodta hai: transactions, chargebacks, aur
reserves. Jo settlement kisi ka reserve pakde hue mar jaaye, wo use *"pehle hi release ho
chuka"* mark chhod deti — koi aage ka cycle use uthata nahi, aur vendor ka paisa aise
reserve me baith jaata jise koi kabhi wapas nahi karega. Chup-chaap, kyunki claim bilkul
poora dikhta.

### 13.6 Aur ek cheez jo raaste me mili — `Settlement.paidAt` tha hi nahi

Settlement par `approvedAt` tha, `paidAt` **nahi**. Yani wo ye jaanti hi nahi thi ki
**paisa kab gaya** — sirf ki kab manzoori mili. `paidAt` `PayoutLeg` par tha, to
*"is vendor ko paisa kab mila"* ke liye join chahiye tha, aur uspar `distinct` karna
practical hi nahi tha.

Reserve ki hold ki ghadi yahin se chalti hai — hold isliye hai ki **paisa nikalne ke
baad** aane wale chargeback cover ho jaayein, to ghadi nikalne ke waqt se hi shuru honi
chahiye. Ab `transitionSettlement` `PAID` par use stamp karta hai (statement token ke
saath hi), aur vendor ko bhi dikhta hai.
