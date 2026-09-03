# Dispute / Chargeback flow — Trydood 2.0

**Grahak apne bank ke paas gaya → bank ne paisa hamare account se kheench liya →
ab hume sabit karna hai ki sale asli thi.**

Yeh document batata hai ki chargeback **aaj kaise chalta hai**, code me — aur, isse
zyada zaroori, **har aadmi ko kya dikhta hai aur usse kya karna hai**.

Design ka "kyun" `vendor_settlement_plan.md` §7 me hai. Paisa nikalne ka rasta
[`settlement_flow.md`](./settlement_flow.md), refund ka
[`refund_flow.md`](./refund_flow.md).

> **Status:** dispute ka **record aur paisa** poora bana hai — har dispute ki apni row,
> deadline ka alert, ledger, aur agle cycle se vasooli. **Evidence file karna abhi
> haath se hota hai** (Razorpay dashboard par) — §9 dekho.

---

## 1. Sabse pehle: chargeback refund se **bilkul alag** cheez hai

Ye farak samajhna zaroori hai, kyunki dono me paisa wapas jaata hai par **raasta aur
control dono alag** hain.

| | **Refund** | **Chargeback (dispute)** |
|---|---|---|
| Grahak kahan jaata hai | Trydood app par | **Apne bank / card company ke paas** |
| Hume pata kaise chalta hai | Humne hi banaya | **Razorpay ka webhook** — baad me |
| Paisa kab jaata hai | Hum bhejte hain | **Bank khud kheench leta hai** |
| Mana kar sakte hain? | Haan — vendor/admin tay karte hain | ❌ **Nahi.** Sirf **sabit** kar sakte hain |
| Deadline | Hamari apni | **Bank ki** — nikal gayi to apne aap haar |
| Fees | Nahi | Razorpay ki dispute fee (alag) |

⚠️ **Sabse bada farak:** refund me hum faisla karte hain. Chargeback me **bank faisla
karta hai**, aur hum sirf apna paksh rakh sakte hain — wo bhi ek tay tareekh ke andar.

---

## 2. Poora raasta, ek nazar me

```
   Grahak apne bank se shikayat karta hai
                │
                ▼
   Razorpay: payment.dispute.created  ──webhook──►  hum
                │
                ├─►  Dispute row banti hai (OPEN)         ← har dispute ki apni row
                ├─►  Transaction.settlementHold = true    ← MONOTONIC, kabhi apne aap nahi hatta
                ├─►  settlement already bani ho? → taint  ← approve rukega
                └─►  🔴 ADMIN ko CRITICAL notification
                │
                ▼
        ⏰ respond_by  (bank ki deadline — aksar 7-10 din)
                │
        disputeDeadlines job:  72h → ⚠️ WARNING
                               24h → 🔴 CRITICAL
                          nikal gayi → 🔴 CRITICAL ("lost by default")
                │
   ADMIN Razorpay dashboard par evidence file karta hai   ← ⚠️ HAATH SE
                │
        ┌───────┴────────┐
        │                │
      WON              LOST
        │                │
        │         CHARGEBACK ledger debit
        │         (sirf vendor ka hissa)
        │                │
        │         agle settlement cycle se vasooli
        │                │
   koi ledger entry      └─► vendor ke payout se kata
   nahi (agar loss
   book hi nahi hua)
        │
        ▼
   ⚠️ HOLD dono soorat me laga rehta hai
   → admin ko release-hold se, wajah likhkar, hatana padta hai
```

---

## 3. Grahak ko kya dikhta hai — **kuch nahi**

Aur ye jaan-boojh kar hai.

Grahak apne bank se baat kar chuka hai. Uske liye maamla **bank ke paas** hai, hamare
paas nahi. Hum use notification bhejein to:

- Wo confuse hoga — "maine to bank se kaha tha, Trydood kyun likh raha hai"
- Ya bura maanega — "ye log mujhe rok rahe hain"
- Aur wo hume kuch bata bhi nahi sakta jo kaam aaye — sabooot **hamare** paas hai (bill,
  claim code, redemption ka waqt), uske paas nahi

⚠️ Isliye grahak ko dispute ka koi message nahi jaata. Uska paisa bank se aa jaata hai
(ya nahi aata) — dono soorat me faisla bank ka hai.

**Par ek baat dhyan me rakhein:** agar usi claim par grahak ne Trydood par refund bhi
maanga tha, to wo refund apne rasta chalta rahega. ⚠️ Dono ek saath ho sakte hain, aur
tab grahak ko **do baar paisa** mil sakta hai — ek refund se, ek chargeback se. Us soorat
me `settlementHold` dono taraf se laga rehta hai aur admin ko dono dikhte hain.

---

## 4. Vendor ko kya dikhta hai — **asar bhi, aur ab wajah bhi**

> **Pehle ye is flow ka sabse kamzor hissa tha.** Vendor ko dispute ki koi khabar
> nahi jaati thi — na notification, na screen. Unhe sirf itna dikhta tha ki us sale
> ka paisa settlement me **aata hi nahi**, aur baad me statement par ek katauti ki
> line jiske saath koi sale judi hui nahi thi. Yani unke liye ye aisa lagta tha
> jaise paisa bina bataye kat gaya — chahe katauti bilkul sahi ho.

Ab teen cheezein unhe milti hain.

### 4.1 Dispute aate hi — ek notification

`DISPUTE_RAISED_VENDOR`. Sale ka reference, rakam, aur seedha ye ki abhi kya hua hai.
Webhook **stored row** padhkar bhejta hai, live event se nahi — Razorpay dispute
events out-of-order bhejta hai (§7), aur ek purana event vendor ko galat baat bata
sakta tha.

### 4.2 Apni dispute list — `GET /disputes`, aur ek dispute `GET /disputes/:disputeId`

Token se scope hoti hai: vendor ko **sirf apne brand ke** dispute dikhte hain, aur
scoping **filter me** hai — projection me chhupakar nahi. (Ek filter jo sirf lagti
hui dikhe, wahi tarika hai jisse koi baad me ek aur read likh de jo kabhi scope hui
hi na ho.)

| Vendor ko milta hai | Vendor ko **kabhi nahi** milta |
|---|---|
| `disputeId`, invoice, claim ki rakam | `respondBy` / `daysToRespond` / `isOverdue` |
| `disputeStatus`, kab aaya, kab faisla hua | `alertsSent` |
| apna bheja hua note aur uska waqt | `recoverySettlementId`, `recoveredAt`, `vendorWasPaid` |

⚠️ **Detail list ki hi projection use karta hai**, apni alag nahi likhta. Alag
likhna wahi tarika hai jisse list jo field chhupati hai wo detail par aa jaata
hai — mahino baad, bina kuch fail hue.

⚠️ `/disputes` ab apna domain hai. Purane `/transactions/disputes*` chalte rehte
hain kyunki Postman aur pehle se juda hua koi bhi integration unhi par hai — par
wo **wahi controllers** chalate hain, to do implementation hain hi nahi, aur test
dono ko identical rakhta hai.

> ### ⚠️ Deadline vendor ko **jaan-boojh kar** nahi dikhayi jaati
>
> Deadline nibhana **hamara** kaam hai, evidence **hum** file karte hain. Aakhri din
> outlet aisa kuch nahi karta jo pehle din se alag ho. Jis countdown par wo kuch kar
> hi nahi sakte, wo warning nahi — bas ghabrahat hai, aur uska ek hi pakka natija
> hai: support par phone.
>
> `recoverySettlementId` / `vendorWasPaid` hamari andar ki bahi-khata hai — "kya ye
> paisa wapas kheencha ja sakta hai" — jo unke sawaal ka hissa hai hi nahi.

### 4.3 Apni taraf ka sabooot bhejna — `POST /disputes/:disputeId/evidence`

Jo **sirf outlet ke paas hai**: KOT ya bill number, camera ka waqt, staff ko kya yaad
hai.

⚠️ **Ye bonus hai, sahaara nahi.** `buildEvidencePack` hamare apne record par khada
hota hai (§5.3) — is platform par voucher counter par hi pay hota hai, to payment
khud grahak ko wahan rakhta hai. Admin outlet ka jawab aaye bina bhi file kar sakta
hai, aur ye zaroori hai: **dispute ka jawab ek hi baar** jaata hai aur deadline bank
ki hai.

Dispute ka faisla ho jaane ke baad note lena band ho jaata hai (409) — us waqt note
se kuch badalta nahi, aur usse lena ye jhooth bolega ki badalta hai. Refusal ye bhi
batata hai ki faisla kis taraf gaya, taaki unhe ye na sochna pade ki unka message
bounce kyun hua.

### 4.4 Settlement me kuch aaya hi nahi to — ab batate hain

Jis cycle me katautiyan us period ki bikri se zyada nikal jaati hain, `netPayable`
negative ho jaata hai, settlement `CARRIED_FORWARD` jaati hai aur **kuch payout nahi
hota**. Pehle ye bhi chup tha — vendor ne bikri ki, payout ka intezaar kiya, aaya
kuch nahi, aur koi message nahi.

Ab `SETTLEMENT_CARRIED_FORWARD` jaata hai, aur usme wajah unki bhaasha me hoti hai:
*"₹785 ke chargeback is period ki bikri se zyada the"* — "carried forward" hamara
shabd hai, unka nahi.

⚠️ Ye kabhi **invoice nahi** hai. Message saaf kehta hai ki baaki rakam agli
settlement me chali jaati hai aur aage ki bikri se katti hai — **hume kuch dena nahi
hai aur kuch karna nahi hai.** Log pehla matlab yahi nikalte hain ki ab paisa bharna
padega.

⚠️ Aur jo cycle sirf **minimum payout se neeche** rehkar carry forward hui, wo abhi
bhi chup hai. Wo rozmarra ki baat hai; uspar bhi message bhejna sirf itna karega ki
log us message ko ignore karne lagenge jo asal me maayne rakhta hai.

---

## 5. Admin ko kya karna hai — **aur kab tak**

Admin hi is poore flow ka **ekmatra** actor hai.

### 5.1 Dispute aate hi

🔴 **CRITICAL notification** milta hai. Usme:

- Rakam
- Transaction / claim ka reference
- **`respond_by` tareekh** — *"Evidence must be submitted to Razorpay by …"*
- ⚠️ Agar wo payment kisi **bani hui settlement** me hai, to uska settlement number bhi —
  aur ye line: *"That settlement is now on hold for revalidation — rebuild it before
  approving."*

### 5.2 Worklist

```
GET /disputes                       ← sabse jaldi deadline pehle
GET /disputes/:disputeId            ← ek dispute, wahi shape
GET /disputes/:disputeId/evidence-pack
```

Har row me: `daysToRespond`, `isOverdue`, `isUrgent`, aur `vendorWasPaid` — wo aakhri
isliye ki agar vendor ko paisa gaya hi nahi to vasooli ka sawaal hi nahi, nuksaan
seedha hamara hai.

⚠️ **Ek row per dispute, per payment nahi.** Ek payment par chargeback aur uske baad
pre-arbitration — dono alag rows, alag deadline, dono par alag kaam.

### 5.3 Evidence file karna — ⚠️ **file karna haath se, jodna nahi**

`GET /disputes/:disputeId/evidence-pack` (admin-only) sab kuch ek jagah
de deta hai:

| Pack me | Kyun |
|---|---|
| Dispute, deadline, `hoursLeft` | Kitna waqt bacha hai |
| Payment id, order id, method, **signature verified** | Hamare paas sahi signature hona **khud sabooot hai** — callback hamare account ke secret se signed tha, yani payment Razorpay se aayi, client ne dava nahi kiya |
| Grahak ka **masked** email/mobile, account kab bana | Ye document ek third party par jaata hai — poora number kabhi nahi |
| Outlet, brand, address, shahar | Kahan hua |
| Claim code, bill, offer, promo, kitna diya | Kya khareeda |
| `paidInPerson`, redemption ka waqt | Is platform par voucher **counter par** pay hota hai — payment hi redemption hai |
| Poori claim timeline | Kab kya hua, kisne kiya |
| Outlet ka note (§4.3), agar bheja ho | Jo sirf unke paas tha |
| **`narrative`** | Wahi sab, ek paragraph me — Razorpay dashboard me seedha paste karne layak |

> ### ⚠️ Argument pehle se likha hua kyun aata hai
>
> Dispute **ek hi baar** file hota hai, deadline ke dabaav me. Jeetne aur haarne ka
> farak aksar isi baat par hota hai ki kisi ke paas case theek se likhne ka waqt tha
> ya nahi. Isliye `buildNarrative` wo paragraph khud bana deta hai.

Phir bhi **file admin hi karta hai**, Razorpay dashboard par, haath se:

1. Pack kholo (ya `narrative` copy karo)
2. Razorpay dashboard me dispute kholo
3. Paste karo, documents lagao
4. Submit, **`respond_by` se pehle**

> 🔴 **Har dispute par ek hi jawab milta hai.** Submit ke baad badla nahi ja sakta.
> Isliye ye kaam job apne aap nahi karta — jo bhi uske paas ho wahi bhej dena, kuch na
> bhejne se bura hai. Pack banata hai; bhejta aadmi hai.

### 5.4 Deadline nikal gayi to

**Apne aap haar.** Bank dobara nahi poochta, Razorpay chase nahi karta, aur code me
kahin koi error bhi nahi aata — system ke hisaab se kuch hua hi nahi.

Isliye `disputeDeadlines` job har ghante chalti hai:

| Bacha waqt | Kya |
|---|---|
| 72h se zyada | kuch nahi |
| 72h – 24h | ⚠️ WARNING |
| 24h – 0h | 🔴 CRITICAL |
| nikal gayi | 🔴 CRITICAL, 7 din tak |

⚠️ **Ghante me, roz nahi** — aakhri chetavani 24h par hai, aur roz chalne wali sweep use
aakhri din me kahin bhi gira sakti thi, deadline ke baad bhi.

⚠️ **Ek stage ek hi baar** — `alertsSent` counter hi claim hai. Warna ghante-ghante wahi
CRITICAL jaata aur log channel mute kar dete, jo dispute se zyada mehnga padta.

### 5.5 Faisla aane ke baad — hold hatana

⚠️ **Hold apne aap kabhi nahi hatta**, chahe dispute **jeet** hi kyun na jaayein.

```
PATCH /transactions/admin/:transactionId/release-hold    ← wajah zaroori
```

Kyun apne aap nahi: `settlementHold` **monotonic** hai. Har dispute event — khula ho ya
tay ho chuka — use lagata hai. Agar `won` par apne aap hat jaata, to jo dispute **haara**
gaya wo bhi row ko dobara "payable" bana deta, aur agla payout vendor ko wo paisa de deta
jo ab hamare paas hai hi nahi. **Ye race nahi hai — har baar aisa hi hota.**

To faisla aane ke baad kisi insaan ko dekhkar hold hatana padta hai. ⚠️ **Aur agar wo
bhool jaaye, to us vendor ka wo paisa har aane wali settlement se bahar rehta hai —
hamesha, chup-chaap.**

---

## 6. Paisa — kiska, kitna

### 6.1 Nuksaan **sirf vendor ke hisse tak**

Bank poora `amount` kheenchta hai — jisme hamari convenience fee aur promo ka hamara
aadha bhi shamil hai. **Wo sab vendor se nahi kata ja sakta.**

```
vendor ka hissa = netBill − vendorPromoCost − commissionDeduction
CHARGEBACK      = min(dispute ki rakam, vendor ka bacha hua hissa)
```

Baaki — hamari fee, hamara promo hissa, Razorpay ki dispute fee — **platform uthata hai**.

### 6.2 ⚠️ Ek payment par do dispute: cumulative cap

Chargeback → pre-arbitration → arbitration: **har phase ka alag dispute ID**.

Har nuksaan us payment ke **bache hue** vendor-share ke against capped hai, poore share ke
nahi. Warna do dispute alag-alag poora share paas kar jaate aur milkar vendor ko mile se
zyada book kar dete.

```
vendor ka hissa 750:
  dispute 1 (600 maanga)  →  600 book
  dispute 2 (600 maanga)  →  sirf 150 (jitna bacha)
  ──────────────────────────────────────────
  kul 750, 1200 nahi
```

Jeeta hua dispute apni jagah **wapas de deta hai**, to ek asli doosra nuksaan use le
sakta hai.

### 6.3 Vasooli — agle cycle se

```
LOST  →  CHARGEBACK ledger me  →  agli settlement me "Less: chargebacks recovered"
```

⚠️ Vasooli **sirf us payment par jiska paisa vendor ko ja chuka**. Agar dispute payout se
pehle aaya, to `settlementHold` ne use waise hi rok liya tha — vendor ko mila hi nahi, to
kaatne ko kuch hai hi nahi. Nuksaan seedha hamara.

⚠️ Vasooli **wahi rakam jo ledger me book hui**, dobara ganit nahi — warna upar wala cap
bekaar ho jaata.

⚠️ Lock **dispute par** hai (`recoverySettlementId`), payment par nahi. Payment par hota
to ek payment ke do lost dispute me se **ek chup-chaap maaf** ho jaata.

### 6.3a ⚠️ Jab vasooli **kabhi ho hi na paaye**

Vasooli agle cycle se hoti hai. Par agar us brand ki katautiyan uski bikri se zyada
hain, to `netPayable` negative ho jaata hai, settlement `CARRIED_FORWARD` jaati hai —
aur **carry forward ka matlab hi hai ki uske sab claims chhod diye jaate hain**. Agla
cycle wahi rows dobara claim karta hai, wahi negative par pahunchta hai, aur phir chhod
deta hai.

Jab tak brand chal raha hai ye bilkul sahi hai: nayi bikri usse net kar deti hai. **Jis
din wo dhandha band kar de, ye kabhi khatam nahi hota.** Koi error nahi, koi log nahi,
kisi report me kuch nahi — paisa hamari kitaab me aise pada rehta hai jaise kisi se
aana hai, jabki wo aadmi wapas aa hi nahi raha.

| Kaam | Kya karta hai |
|---|---|
| `alertVendorDebt` (roz) | `chargeback.writeOffDays` (default 90) se purani, bina claim hui katautiyan dhoondhta hai aur **admin ko batata hai** |
| `GET /settlements/admin/debt/:brandId` | Kitna, kitne purane, kaunse rows |
| `PATCH /settlements/admin/debt/:brandId/write-off` | Chhodna — likhit wajah ke saath |

⚠️ **Job sirf batata hai, karta kuch nahi.** Debt maaf karna hisaab-kitaab ka faisla
hai jispar kisi aadmi ka naam hota hai; 90 din par apne aap maaf kar dena us brand ko
bhi maaf kar dega jo bas do season ke beech me hai — aur ledger me ek
`MANUAL_ADJUSTMENT` reh jaayega jo kisi ne chuna hi nahi. Wahi batwara
`sweepStalePayouts` karta hai, wahi wajah se.

⚠️ Write-off **do ledger rows** likhta hai, har debt row par:

```
MANUAL_ADJUSTMENT  CREDIT  VENDOR_PAYABLE   →  unka balance zero, aage koi cycle
                                               is debt ko dekhega hi nahi
MANUAL_ADJUSTMENT  DEBIT   PLATFORM_COST    →  humne uthaya
```

Reference (`disputeId` / `refundRequestId`) **sirf vendor wali row par** jaata hai:
`ONCE_PER_DISPUTE` aur `ONCE_PER_REFUND` `{reference, entryType}` par unique hain, to
dono par lagane se doosri row duplicate-key par chup-chaap gir jaati — vendor ka debt
saaf ho jaata aur platform ka cost kabhi aata hi nahi. Kitaab theek utni chhoti reh
jaati jitna maaf kiya tha.

⚠️ Aur `writtenOffAt` **dono claim filters me** hai. Uske bina write-off sirf dikhawa
hota: agla build wahi row phir claim karta, phir kaatta, phir negative, phir chhod deta
— wahi anant loop, ab ek `MANUAL_ADJUSTMENT` ke saath jo kehta hai ki humne pehle hi
uthaa liya tha. Nuksaan kitaab me **do baar** ginha jaata.

### 6.4 Jeetne par

`CHARGEBACK_REVERSAL` — **par sirf tab jab nuksaan pehle book hua ho**. Bina pehle `lost`
ke aaya `won` kuch nahi likhta, warna vendor ko wo paisa mil jaata jo kabhi kisi ne liya
hi nahi tha.

---

## 7. ⚠️ Out-of-order delivery — jo sabse aasani se galat ho jaata

Razorpay ye events **dobara bhejta hai aur kram se bahar bhejta hai**. Ek der se aaya
`lost`, `won` ke baad aa sakta hai.

Agar wo `won` ko `lost` bana de:

```
dispute jeeta  →  koi vasooli nahi  ✅
   ...der se `lost` aata hai...
dispute "haara"  →  vendor se paisa kata  🔴 galat
```

Isliye har event apne **timestamp** se tay hota hai (`lastEventAt`), aur wo shart
**update ke filter me** hai, `if` me nahi — do delivery ek saath aayein to bhi purani nayi
ko nahi haraa sakti.

---

## 8. Jo apne aap chalta hai

| Job | Kitni der me | Kya karta hai |
|---|---|---|
| `disputeDeadlines` | 60 min | Deadline ka alert — **sirf batata hai** |
| `alertVendorDebt` | 24 ghante | Jo katauti kisi cycle tak pahunch hi nahi sakti, uska alert — **sirf batata hai** (§6.3a) |

⚠️ **Sirf batata hai, karta kuch nahi** — aur ye jaan-boojh kar hai. Evidence sirf wo
aadmi file kar sakta hai jiske paas Razorpay dashboard ho, aur **har dispute par ek hi
jawab milta hai**. Job jo apne aap kuch bhej de, wo jo bhi uske paas ho wahi bhej dega.

Baaki dispute ka kaam **webhook** karta hai (row, hold, taint, ledger, alert) aur
**settlement build** karta hai (vasooli).

---

## 9. Jo ab ban gaya, aur jo abhi bhi nahi

### Ban gaya

| # | Kya | Kahan |
|---|---|---|
| ✅ | **Vendor ko dispute ki khabar** | `DISPUTE_RAISED_VENDOR` / `DISPUTE_RESOLVED_VENDOR` (§4.1) |
| ✅ | **Vendor ki apni dispute list**, token se scope, alag shape | `GET /disputes` (§4.2) |
| ✅ | **Outlet se sabooot** | `POST /disputes/:disputeId/evidence` (§4.3) |
| ✅ | **Evidence pack + likha hua argument** | `GET /disputes/:disputeId/evidence-pack` (§5.3) |
| ✅ | **Payout na hone ki wajah vendor ko** | `SETTLEMENT_CARRIED_FORWARD` (§4.4) |
| ✅ | **Jo vasooli ho hi nahi sakti** — alert aur write-off | `alertVendorDebt`, `/settlements/admin/debt/:brandId` (§6.3a) |
| ✅ | **`/disputes` ka apna domain** | `routes/disputes.js` — list, detail, evidence, pack |
| ✅ | **Risk-based reserve** | `helpers/settlements/reserveRisk.js` — `settlement_flow.md` §2.5c |

### Abhi nahi

| # | Kya | Iska matlab |
|---|---|---|
| 🟡 **1** | **Dispute ka Postman folder** | Generator dobara chalana khatarnaak hai — captured examples mit jaate hain (pichhli baar 15,499 lines). Alag se, soch kar karna hai |
| 🟡 **2** | **Razorpay par evidence API se bhejna** | Jaan-boojh kar nahi hai — §5.3 dekho: ek hi jawab milta hai, aur wo faisla aadmi ka hai |

---

## 10. Ek nazar me: kaun kya karta hai

| Kaun | Kya karta hai | Kya dikhta hai |
|---|---|---|
| **Grahak** | Apne bank se shikayat | Trydood se kuch nahi — jaan-boojh kar (§3) |
| **Vendor** | Apni list dekhe, jo unke paas hai wo note bheje | Dispute ki khabar, apne brand ki list (bina hamari deadline queue ke), aur payout na hone ki wajah |
| **Admin** | Pack kholkar Razorpay par file kare, faisle ke baad hold hataaye, jo vasooli nahi ho sakti use band kare | CRITICAL alert, deadline worklist, evidence pack, aged-debt alert |
| **System** | Row banata hai, hold lagata hai, settlement taint karta hai, ledger likhta hai, agle cycle se vasoolta hai, deadline yaad dilata hai, dono ko batata hai | — |

> **Ek line me:** system paisa aur record poora sambhal leta hai, aur ab **koi andhere
> me nahi rehta** — grahak ke alawa, jise jaan-boojh kar kuch nahi dikhta. **Jeetne ka
> kaam aadmi ka hai**, par ab uske paas case likha-likhaya aata hai.
