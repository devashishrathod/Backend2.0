# Implementation Phases — Build Manifest

> **Design docs:** [customer_voucher_claim_plan.md](./customer_voucher_claim_plan.md) · [vendor_settlement_plan.md](./vendor_settlement_plan.md)
> **Ye doc:** kis phase me kya banega — module-wise, file-level.
> Har module ek coherent unit hai jo ek baar me banta aur review hota hai.

---

## 0. Ek nazar me

| Phase | Kya ship hota hai | Modules | Haalat |
|---|---|---:|---|
| **0** ✅ | Foundation, teen bugs, dono Razorpay accounts | 12 | **ho gaya** |
| **1A** ✅ | Preview — promo + poora pricing | 12 | **ho gaya** |
| **1B** ✅ | Payment — claim, usage, invoice, notify, **ledger** | 10 | **ho gaya** |
| **1C** ✅ | Read APIs — history, detail, invoice link, health | 10 | **ho gaya** |
| **S1** ✅ | Refunds — `SOURCE` **aur** `MANUAL_BANK`, dono | 6 | **poora ho gaya** |
| **S2** ✅ | Settlement — cycle, claim, approve, payout, reversal | 6 | **ho gaya**, statement PDF + per-brand config baaki |
| **S3** ⏳ | Chargebacks — hold, evidence, reserve, receivables | 11 | **10/11 ho gaya** — sirf Postman baaki |
| **Docs+Postman** ⏳ | Har phase ke saath chalta hai, alag phase nahi | 12 | API docs + census ✅ · `trydood-money` collection ❌ |

**Har phase ki definition of done me shaamil hai:** code · money tests · API doc · Postman collection (saare cases + saved examples) · `endpoints_category.md` entry.

### Aaj ki asli haalat — code se naapi hui

| | |
|---|---|
| Money test suites | **55 suites · 1086 pass · 5 todo** (`npm test`, **~33 min** — run lock ka TTL 90 min) |
| Background jobs | **21** registered in `jobs/index.js` |
| Money endpoints | 16 settlement · 14 refund · 7 voucher-claim · 15 transaction · **4 dispute** · 4 customer-bank = **60** |
| Ledger entry types | capture · refund · payout · chargeback · reserve · commission · **manual adjustment** — saat, aur har ek ko koi likhta hai |

> **Ye tableau haath se nahi bhara gaya.** Har ✅ ke peeche neeche section me file:line hai.
> Jahan doc aur code alag mile, **code jeeta** aur doc badla — dono jagah likha hai
> ki kya farak tha.

### ⏳ Launch se pehle — jo abhi khula hai

Code ki taraf se ek bhi cheez khuli nahi hai. Ek **operational** kaam bacha hai:

| # | Kya | Kahan likha hai |
|---|---|---|
| ⏳ **1** | **Dusra writer `Trydood2` par likh raha hai** — jad mil gayi: commit `59fd080` ka `invoiceId: { unique: true }`. Aaj ka code sahi hai; **purana build** kahin chal raha hai aur uska `autoIndex` index dobara banata hai. Code ki taraf se band: `reapShadowIndexes` boot par aur har ghante hata deta hai, aur har baar admin ko CRITICAL alert jaata hai (**timestamp hi wo lead hai** — reap matlab writer usi ghante restart hua). ⚠️ **Bacha hua kaam code me nahi hai**: Atlas → Network Access ko EC2 ke Elastic IP tak seemit karna, purane deployment ke DB user ko `readOnly`/delete, purana service suspend | `helpers/transactions/reapShadowIndexes.js` · `scripts/findIndexWriters.js` · CLAUDE.md ka box |
| ✅ | ~~`MANUAL_BANK` refund fallback nahi hai~~ — **ban gaya** | S1-4 · `refund_flow.md` §7 |
| ✅ | ~~Statement PDF nahi bana~~ — **ban gaya** | S2-5 · `settlement_flow.md` §12 |

---

## 1. Phase 0 — Foundation

*Customer feature ke bina bhi ship ho sakta hai. Isme teen maujooda bugs bhi thik hote hain.*

| # | Module | Kya |
|---|---|---|
| ✅ **M1** | Transaction money model + constants + `buildTransactionFilter` | `constants/transaction.js`, Transaction me `purpose`/`gatewayAccount`/`customerId`/`voucher{}`/`invoiceToken`/`settlementStage`, teen **named partial-unique indexes** |
| ✅ **M2** | Do Razorpay accounts | `getRazorpayAccount()`, account-bound signature + lookup, rotation-safe multi-secret verify, `logPaymentAccounts()` |
| ✅ **M3** | `WebhookEvent` REJECTED redesign | `REJECTED` status, `claimedEventId`, payload hash+preview, TTL, replay se block |
| ✅ **M4** | Webhook receiver rewrite | Do routes, account-scoped lookup, `purpose` router, `payment.authorized` ka apna handler, double-capture guard |
| ✅ **M5** | Invoice numbering + IST dates | `helpers/common/istDate.js` (naya folder), Counter-based `generateInvoiceNumber()` |
| ✅ **M6** | `VoucherUsage` redesign | Dead refs hatao, `voucherClaimId` unique, partial once-per-user index |
| ✅ **M7** | PromoCode `audience` + `costBearing` | Customer scope fields, promo helpers generalize, report me audience filter |
| ✅ **M8** | `Setting.customer` config surface | Model sub-schemas, constants, **validator + `updateSetting` branch** |
| ✅ **M9** | `JobLock` + job health + boot check | Multi-instance safety, `lastSuccessfulRunAt` |
| ✅ **M10** | Dev/staging migration script | Naye indexes → verify → purane drop → backfill. Production fresh hai to no-op |
| ✅ **M11** | Jest (**bina** `mongodb-memory-server`) | Repo ka pehla test runner, sirf `__tests__/money/`. 39 pass, 7 todo |
| ✅ **M12** | Docs + Postman | Doosra webhook endpoint, config surface, env vars, `.env.example` |

**Order:** M1 → M2 → M3 → M4 (sabse risky — ye live money path rewrite karta hai) → baaki parallel.

### ✅ Phase 0 ho gaya — aur design se teen jagah hata

Implement karte waqt DB par teen cheezein aisi mili jo plan ke likhe se ulat theen. Har ek verify karke badli gayi, sochkar nahi.

**1. `JobLock` par TTL index nahi lagaya (M9).**
Plan me `lockedAt` par TTL tha taaki stale lock apne aap chhoot jaye. Par TTL **poora document delete** karta hai — aur usi document par `lastSuccessfulRunAt` hai, jo is poore module ka maqsad hai. Har lapsed lease par health history mit jaati. Zarurat bhi nahi thi: acquire `expiresAt: { $lte: now }` par match karta hai, to expired lock pehle se available hai. **Expiry ek comparison hai, lifecycle nahi.**

**2. `mongodb-memory-server` nahi liya (M11).**
Machine par naapa: free RAM **0.5 GB / 7.4 GB**, aur `mongod` default me `max(256MB, aadhi (RAM − 1GB))` ≈ 3.2 GB reserve karta hai — jest ke har worker ke liye alag. Iski jagah asli cluster par alag database (`Trydood2_test`), jo repo me pehle se maujood pattern hai (`Trydood2_postman`). Fidelity nahi khoyi: har test hone wali guarantee **server-side** hai, to race ab bhi server par hi hoti hai. Sab `__tests__/money/setup/testDb.js` ke peeche hai, to badalna ek file ka kaam rahega.

**3. `settlementStage` ka backfill plan me tha hi nahi (M10).**
Purani transactions me ye field nahi hai, aur `!= "COMPLETE"` **missing field par sach** hota hai — yaani `resumeIncompleteSettlements` ko har pehle se settle ho chuki transaction adhoori lagti. Migration ab `verified: true` wali rows par `COMPLETE` likhti hai. §9.9 isi ka doosra aadha hai, aur ab wo do taraf se bandha hai: job bhi scope karega, aur data bhi saaf hai.

### Implement karte waqt code me mile bugs

Ye plan me nahi the — DB par test karte waqt nikle, aur teeno chup-chaap galat data deta.

| Kahan | Kya |
|---|---|
| `updatePromoCode` (M7) | Partial `costBearing` PATCH stored `vendorPercent` **uda deta tha** — `{mode:"SHARED"}` bhejne par 40 gayab, default tak nahi bachta. Aur `assertCoherent` phir bhi pass, kyunki wo stored value dekhta hai. Ek SHARED code chup-chaap vendor ko kuch settle na karta |
| `getAllPromoCodes` / `getPromoCodeReport` (M7) | `?audience=VENDOR` `$eq` kar raha tha, to `audience` field se purane **6 me se 5 code gayab** ho jaate. Ab dono `buildAudienceFilter` se jaate hain |
| `updateSetting` (M8) | Nested `settlement.reserve` PATCH siblings ko default par reset kar deta tha (`holdDays` 45 → 30). Pehla fix bhi nahi chala kyunki wo parent assign ke **baad** tha |

**M12 me do aur nikle:**

| Kahan | Kya |
|---|---|
| `configs/razorpay.js` | Key na hone par **import par hi crash** karta tha — `new Razorpay({})` module load par bana raha tha aur wo `key_id is mandatory` throw karta hai. Matlab ek account ki key chhoot jaane par poora server boot hi nahi hota, aur `logPaymentAccounts()` — jo hai hi isliye ki missing key ek shaant line me bata de — kabhi chalta hi nahi. M2 me maine likha tha "import par kuch nahi throw hota"; wo mera code sach tha, SDK constructor nahi. Ab clients **lazy** hain: missing key `isRazorpayAccountConfigured() === false` banti hai, aur call site par saaf 500 |
| `transactions` ke legacy indexes | M10 me drop kiye, boot se wapas nahi aaye — **phir bhi wapas aa gaye**. Bisect kiya: plain connect + `autoIndex`, app boot, migration dono mode, aur test suite — **koi bhi nahi banata**, aur schema me declare hi nahi hain. Legacy `server/` folder alag cluster par hai. Yaani writer is working copy ke bahar hai (neeche) |

### ⚠️ Khula sawaal — `Trydood2` par koi aur bhi likh raha hai

`invoiceId_1` aur `razorpayOrderId_1` (purana blanket-unique roop) dev DB par **do baar drop karne ke baad bhi wapas aaye**. Is repo ka koi step unhe nahi banata — paanchon candidate bisect karke dekhe.

Sabse sambhavit wajah: **is service ka koi purana build kahin chal raha hai** aur usi database par point kar raha hai. Uske schema me abhi bhi path par `unique: true` hai, aur uska `autoIndex` har restart par unhe dobara bana deta hai. Yahan se pehchana nahi ja saka — M0 tier par `currentOp` allowed nahi hai.

**Isliye chup-chaap dobara drop karte rehne ki jagah, ab har boot batata hai:**

```
✅ [idx] money indexes correct · 22 on transactions
```

aur galat hone par:

```
⚠️  [idx] legacy invoiceId_1 is back — a blanket unique index that rejects the second
    row with no value. Nothing in this build creates it, so another process is writing
    to this database. Drop it with scripts/migrateCustomerClaimFoundation.js --apply,
    and find what recreated it.
```

Boot par kuch **apne aap drop nahi hota**. Boot par index gira dena theek wahi surprise hai jo kabhi khud-ba-khud nahi hona chahiye, aur jo build replace hone wala hai use apne replacement se index par ladna nahi chahiye.

> **Launch se pehle ye band hona chahiye.** Jab tak wo doosra writer chal raha hai, migration ka drop tikta nahi — aur production me wo index **har doosre voucher claim ko reject** kar dega.

Aur do jagah **test khud galat** tha, jo utna hi zaruri hai pakadna:

- Char webhook test sirf `statusCode: 400` assert kar rahe the — aur "no webhook secret configured" bhi 400 hai. Env var ka naam galat hone se signature verify hone tak baat pahunchti hi nahi thi; **char test galat wajah se pass ho rahe the**. Ab har rejection apni wajah bhi assert karti hai
- `Setting.customer` ka missing-block check hydrated document par chal raha tha, jahan Mongoose defaults bhar deta hai — hamesha "0 missing" aata tha. Ab raw collection padhi jaati hai

---

## 2. Phase 1A — Preview

| # | Module | Kya |
|---|---|---|
| ✅ **M1** | Customer config surface | Phase 0 M8 par depend — 1A uske bina chal hi nahi sakta |
| ✅ **M2** | PromoCode customer audience | Phase 0 M7 ka baaki hissa |
| ✅ **M3** | `assertPromoWindowAndCaps` | Shared gate — dono audiences ke liye ek |
| ✅ **M4** | `validateCustomerPromoCode` | Voucher/brand/category scope, per-customer limit ledger se |
| ✅ **M5** | `voucherPricingSchema` | Frozen pricing block — cross-phase contract |
| ✅ **M6** | `calculateVoucherPricing` | §4.1 ka ekmatra source, pure, koi I/O nahi |
| ✅ **M7** | `buildVoucherOrderSummary` | Checkout ki rows — frontend koi arithmetic na kare |
| ✅ **M8** | `resolveClaimOffer` | Kaunsa offer lage, explicit `offerId` ka handling |
| ✅ **M9** | `buildClaimPreview` | **Ek builder preview + order dono ke liye** — `strictPromo` ke saath |
| ✅ **M10** | Preview rewrite + wiring | Route, validator, controller, additive response |
| ✅ **M11** | Money tests | Promo clamp, audience isolation, no-offer case |
| ✅ **M12** | Docs + Postman | Customer collection ke saved examples — **capture pending, neeche** |

### ✅ Phase 1A ho gaya

M1–M3 Phase 0 me hi ban gaye the (M8 aur M7), to asli kaam M4 se shuru hua.

**G-findings jo band hue:**

| # | Kya hua |
|---|---|
| **G1** | `req.customerId` sach me populated **document** nikla — live DB par dekha, `String()` "[object Object]" deta hai. `helpers/customers/resolveCustomerId.js` har jagah normalise karta hai, aur stringified document ko **mana** karta hai bajaye galat query banane ke |
| **G2** | Seed me `isApproved` kabhi set nahi hota tha aur `Subscribed` sirf `brands[0]` ko milta tha — dono theek. Ab approval `verified` flag se bandhi hai (brand B jaan-boojh kar unapproved rehta hai, "blocked" example uske against capture hoga) aur **har** brand ko live plan milta hai |
| **G3** | 400-vs-422 ka jawab **code padh kar** nikla, chun kar nahi: validator me `billAmount` `.positive()` hai aur `validateSchema` controller se pehle chalta hai — Joi pehle jawab deta hai, aur 422 deta hai. Yaani `calculateVoucherOffer` ka apna 400 API se **pahunch hi nahi sakta**. Security collection me pinned 400 hata, dono collections ab sehmat |
| **G13** | `buildClaimPreview` me `VOUCHER_STATUSES.PUBLISHED` — naya code purani magic string leke nahi aaya |

### ⚠️ `pricing` ka aakaar badla — aur wo "additive" nahi tha

Plan ne response ko **purely additive** kaha tha. Likhte waqt pakda ki `pricing` block ke teen naam badal gaye: `discountAmount` → `offerDiscount`, `payableAmount` → `totalPayable`, `totalSavings` → `youSaved`. Chalu app teeno purane naam padh raha hai — yaani vaada toot raha tha.

**Teeno purane naam ab response me echo hote hain** (wahi number, dono naam), par **store sirf naye** hote hain: ek jame hue record me ek number ke do naam nahi hone chahiye. Deprecated hain aur app ke shift hone ke baad hatenge.

Isse ek aur cheez saabit hui — **committed customer collection nayi API par bhi pass karti hai**. Purani assertions (`p.payableAmount === bill − discount + fee`) asli response par chala kar dekha: chaaron pass.

### ⏳ Customer collection ka capture baaki hai

`generate-customer-collection.js` naye shape par update ho gaya hai — pricing table, assertions, aur saved example body. **Par regenerate nahi kiya**, kyunki us collection me **132 live-captured examples** hain jinhe generator dobara nahi banata (`postman/README.md` ki chetavani).

Sahi tarika teen step ka hai, aur uske liye `newman` chahiye jo abhi install nahi hai:

```bash
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply
MONGO_URL="<...>/Trydood2_postman" npm run dev
node postman/lib/capture-examples.js \
  postman/trydood-customer.postman_collection.json \
  postman/environments/customer-local.postman_environment.json
```

G2 ka fix isse **pehle** zaroori tha: bina uske har seeded preview `canClaim: false` deta aur captured examples "blocked" ko hi happy path bana dete.

Tab tak committed collection chalti rehti hai — aliases ki wajah se — bas naye fields usme dikhte nahi.

---

## 3. Phase 1B — Payment

| # | Module | Kya |
|---|---|---|
| ✅ **M1** | Claim domain | `VoucherClaim`, `VoucherClaimHistory`, constants, claim-code + history helpers |
| ✅ **M2** | **Ledger (S0)** | `LedgerEntry`, `recordLedgerEntry`, `getVendorBalance`, `reconcileLedger`. **1B ke saath hi jaana hai** |
| ✅ **M3** | `POST /voucher-claims/create-order` | Idempotency key → reuse check → slot hold → promo reserve → Razorpay order |
| ✅ **M4** | `settleVoucherClaimPayment` | Conditional claim + chaar idempotent stages + webhook wiring |
| ✅ **M5** | `POST /voucher-claims/verify` | Browser callback, account-bound HMAC, ownership check |
| ✅ **M6** | Voucher invoice | Snapshot, receipt-vs-tax-invoice, renderer branch, lazy PDF |
| ✅ **M7** | Notifications | `customerId` recipients, audience toggles, 5 naye types, deep links |
| ✅ **M8** | Chaar jobs | `releaseStaleClaimHolds`, `reconcilePayments`, `resumeIncompleteSettlements`, `alertStuckAuthorizations` |
| ✅ **M9** | Money tests | Concurrency wale saare cases |
| ✅ **M10** | Docs + Postman + env | Teen naye endpoints, CLAUDE.md rules |

### ✅ Phase 1B ho gaya

Suite **197 pass / 14 suites**, aath jobs chal rahe hain.

**Do G-findings band hue:**

| # | Kya hua |
|---|---|
| **G9.1** | `routePrefix` chahiye tha, aur likhne par bhi kaam nahi kiya — `exports.routePrefix` ke baad `module.exports = router` poora exports object badal deta hai aur prefix chup-chaap kho jaata hai. Route `/voucherClaims` par mount ho gaya, **kahin koi error nahi**, sirf boot log me dikha. Ab `module.exports = { router, routePrefix }` |
| **G9.4** | `sendRedirect()` `utils/response.js` me — `res.*` usi ek file me rehta hai. Public invoice link isi se redirect karta hai |
| **G9.8** | `Notification.customerId` jud gaya. Uske bina claim notification par `brandId` ka matlab wo vendor hota jiska voucher claim hua — bilkul galat aadmi — aur customer ka apna feed query hi nahi ho sakta tha |

### ⚠️ Chetavani sach nikli — legacy index ne asli claim rok diya

M3 ka pehla run **10 failure** se gira:

```
E11000  index: invoiceId_1  dup key: { invoiceId: null }
```

Voucher claim apne invoice se **pehle** banta hai, isliye doosra claim `null` par takraya. Wahi bug jiske liye partial index banaya tha, aur wahi index jo Phase 0 M12 ka boot check usi session me wapas aaya bata chuka tha.

Drop karte hi 27/27 pass. **Ab ye anuman nahi, pradarshit tathya hai** ki us doosre writer ko launch se pehle band karna zaroori hai — warna production me har doosra claim reject hoga.

### Design se do jagah hata

**1. Ledger ka `$in` partial filter chal hi nahi sakta.** "In chhe types me se ek" `partialFilterExpression` me vyakt hota hi nahi — wahi adchan jo claim model par thi. `isOncePerTransaction` boolean, aur index usi par.

**2. `reverseLedgerEntry` apne hi index me fans jaata tha.** Reversal paribhasha se usi transaction par usi type ki **doosri** row hai — index me rehti to likhi hi na ja sakti, yaani **sudhaar ka raasta suraksha-tantra se band**. Ab explicit `isReversal` flag.

### Chaar bug likhte waqt pakde

| Kahan | Kya |
|---|---|
| `getPlatformTotals` | **Sign error, sahi shakl wala.** `credited − debited` har account par lagaya tha, par `PLATFORM_COST` debit-normal hai — to `revenue − cost` use **jod** deta tha. Jis claim par platform ne ₹42.94 gawaye, wo ₹62.94 munafa report karta. Aur mera test usi galat maan par pass ho raha tha |
| `settleVoucherClaimPayment` | `gatewayFee` me tax dobara jud raha tha. Razorpay ka `payment.fee` **kul** hai aur usme `payment.tax` pehle se shamil hai |
| `generateAndUploadInvoice` | Claim ke footer me *"GST is charged in addition to the plan price"* — do tarah se galat: na koi plan hai, na koi GST lagi |
| `notify()` | Toggles har audience ke liye **vendor settings** se padh raha tha. Vendor ke reminder band karne se har customer ki receipt bhi band ho jaati, aur customer-side toggle ka koi asar hi na hota |

### Apne hi test me paanch galtiyaan

Ye utni hi zaroori hain — ek galat test us cheez par pass ho jaata hai jo hai hi nahi:

- **PDF me text plain substring nahi milta.** PDFKit hex-encoded glyph runs likhta hai; pehla version sahi ban rahi invoices par fail ho raha tha. Ab decoder asli text nikalta hai
- **Lifecycle fixture non-deterministic tha** — `previewFor()` har call par naya `voucher._id` banata, to reuse window aur once-per-user index dono kabhi match hi na karte. **Do test kaam karte dikhte hue kuch bhi exercise nahi kar rahe the**
- **Ek test ka premise hi galat tha** — once-per-user offer par "alag bill naya order kholta hai" jaancha ja hi nahi sakta
- `notifyAdmins` ko asli admin user chahiye, warna wo kuch likhta hi nahi — sahi vyavhar, par assert karne layak nahi
- `User` aur `Customer` dono ko `uniqueId` chahiye

### ⏳ Postman abhi baaki hai

Teen naye endpoint hain aur customer collection me **132 captured examples**, jinhe generator dobara nahi banata. Sahi raasta seed → server → capture hai, aur uske liye `newman` chahiye jo abhi install nahi hai (`postman/README.md` ki chetavani). Commands Phase 1A ke section me likhe hain.

---

## 4. Phase 1C — Read APIs

| # | Module | Kya | Code |
|---|---|---|---|
| ✅ **1C-A** | Access control | `assertTransactionAccess` + claim twin, SUB_VENDOR identity | `helpers/transactions/assertTransactionAccess.js` · `services/refunds/getRefunds.js:assertRefundAccess` |
| ✅ **1C-B** | Shared read scaffolding | Filters, pipelines, per-role projections | `helpers/transactions/buildClaimReadPipeline.js` · `helpers/refunds/buildRefundReadPipeline.js` · `helpers/settlements/buildSettlementReadPipeline.js` |
| ✅ **1C-C** | Transaction listings | Customer / vendor / admin | `GET /voucher-claims/payments` → `services/voucherClaims/getClaimTransactions.js` |
| ✅ **1C-D** | Transaction detail | Notification ka landing page — ek endpoint, teen shapes | `GET /voucher-claims/payments/:transactionId` → `getClaimTransactionDetail.js` |
| ✅ **1C-E** | Claim listings | Customer / vendor / admin | `GET /voucher-claims` → `getClaimDetail.js` |
| ✅ **1C-F** | Claim detail + timeline | Append-only history dikhta hua | `GET /voucher-claims/:claimId` · `helpers/voucherClaims/buildClaimTimeline.js` |
| ✅ **1C-G** | Outlet verify surface | Counter par | `GET /voucher-claims/code/:claimCode` — path `verify/:claimCode` **nahi** hai |
| ✅ **1C-H** | Invoice token redirect | Public 302 + lazy PDF + customer re-issue | `GET /transactions/invoice/:token` (PUBLIC) · `POST /transactions/invoice/regenerate` · `utils/response.js:sendRedirect` |
| ✅ **1C-I** | Admin payment health | "Abhi kuch atka hua hai?" | `GET /transactions/admin/health` → `services/transactions/getPaymentHealth.js` |
| ✅ **1C-J** | Docs + Postman + tests | | `accessControl` · `claimListings` · `claimDetail` · `claimTimeline` · `paymentHealth` · `voucherInvoice` test suites |

### ✅ Phase 1C ho gaya

Saat naye endpoint `voucherClaims` par, chhe `transactions` par. Do jagah plan se hata:

**1. Outlet verify ka path `code/:claimCode` hai, `verify/:claimCode` nahi.** Manifest me
`verify/` likha tha. Counter par jo scan hota hai wo claim **code** hai, aur `verify`
naam pehle se `routes/verification.js` (brand KYC) le chuka tha — do alag cheezon ka ek
naam padhne wale ko bhatkata hai.

**2. Health ka path `/transactions/admin/health` hai.** `settlement_flow.md` §8.5 me kuchh
samay tak `/transactions/payment-health` likha tha — wo galat tha aur ab theek kar diya
gaya hai. Baaki saare admin routes bhi `/admin/` ke neeche hain, to yahi consistent hai.

---

## 5. Phase S1 — Refunds

| # | Module | Kya | Haalat |
|---|---|---|---|
| ✅ **S1-1** | Money-out models | `RefundRequest`, `PayoutLeg`, `CustomerBankAccount`, constants, Transaction reshape | `models/CustomerBankAccount.js` |
| ✅ **S1-2** | Refund + settlement settings | Sub-schemas, validator, merge | `helpers/settings/assertSettlementTimingRule.js:35` — save par `422` |
| ✅ **S1-3** | Refund core helpers | Hold lifecycle, split rule, completion | `helpers/refunds/`: `applyRefundCompletion` · `calculateRefundSplit` · `releaseSettlementHold` · `assertRefundAllowance` |
| ✅ **S1-4** | Customer bank account | CGPEY penny-drop (server-side), OTP-gated attach, payee frozen on the leg | `services/customerBankAccounts/` · 4 endpoints |
| ✅ **S1-5** | RefundRequest lifecycle API | Customer / vendor / admin surfaces + job + notices | 9 endpoints · `services/refunds/{requestRefund,decideRefund,executeRefund,getRefunds,refundJobs}.js` |
| ✅ **S1-6** | Refund execution | `SOURCE` adapter ✅, `MANUAL_BANK` fallback ✅, webhook branch ✅ | `services/refunds/manualBankRefund.js` · 5 endpoints |

### Asli endpoints — jo doc me kabhi likhe hi nahi the (§9.3)

| Method | Path | Kaun |
|---|---|---|
| `POST` | `/refunds` | customer |
| `PATCH` | `/refunds/:requestId/withdraw` | customer |
| `PATCH` | `/refunds/:requestId/approve` · `/reject` | vendor / sub-vendor |
| `PATCH` | `/refunds/admin/:requestId/approve` · `/reject` · `/pay` | admin |
| `GET` | `/refunds` · `/refunds/:requestId` | token (teenon roles) |

⚠️ `/withdraw` (`cancelRefund`) manifest me kahin nahi tha. Wo hai kyunki `CANCELLED`
allowance ki ginti me aata hai (`refund_flow.md` §2.3) — bina endpoint ke wo status
kabhi bin sakta hi nahi tha.

### ✅ Phase S1 poora ho gaya

Dono raaste bane hain: `SOURCE` (Razorpay usi card/UPI par lautata hai) aur
`MANUAL_BANK` (jab wo instrument hi band ho). Poora rasta
[`refund_flow.md`](./refund_flow.md) me hai.

### ✅ S1-4 aur `MANUAL_BANK` — jo sabse der se ruka tha

**Pehle kya hota tha:** jiska card band ho gaya, uska `SOURCE` refund **har baar** fail
hota. Request `FAILED` par khuli rehti, vendor ka paisa ruka rehta, admin ko har attempt
par CRITICAL jaata — aur admin ke paas dabane ko **koi doosra button nahi tha**. Wo
grahak apna paisa kabhi nahi paata.

**Ab:**

```
SOURCE fail → admin maangta hai → grahak OTP + account deta hai
            → server penny-drop karta hai → admin NEFT → UTR → band
```

**Chaar cheezein jo dhyan se ki gayin:**

**1. `CustomerBankAccount` alag model hai, `Bank` me customer row nahi daali.**
`models/Bank.js` ek **CGPEY verification record** hai: `brandId` required hai, aur
account-number ki uniqueness Mongo index se nahi balki **collection-wide query** se aati
hai (`verifyBankAndFetchDetails`, `createBank`). Customer row waha daalne par ek vendor
ko onboarding ke beech *"this account number is already in use"* milta — kisi aise grahak
ki wajah se jise wo jaante bhi nahi — aur wahi check brand ke verification score me jaata
hai. **Isi liye ye kaam itne mahine ruka tha**, aur isi liye ab alag collection hai.

**2. Admin shuru karta hai, apne aap kabhi nahi.** `SOURCE` ka fail hona hamesha
"instrument mar gaya" nahi hota — gateway ka blip bilkul aisa hi dikhta hai. Apne aap
switch karne ka matlab hota har us grahak se bank details maangna jinka refund ek
transient blip me atka, aur ⚠️ **bina zarurat bank details maangna theek wahi cheez hai
jo ek asli message ko scam jaisa bana deti hai.**

**3. Verification server par hoti hai, client se ek shabd nahi maana jaata.** Client jo
`isVerified: true` likh sake, wo refund kahin bhi bhej sakta hai. Drop fail hone par bhi
row likhi jaati hai (support ko dikhna chahiye ki grahak ne koshish ki), par
`isVerified: false` paisa rokta hai.

**4. NEFT ki machinery pehle se thi.** `PayoutLeg` par `payoutType: REFUND` aur
`refundRequestId` ka unique index S2 ke waqt hi ban chuke the — ye din unke liye hi socha
gaya tha. Leg pehle, status baad me; payee leg par freeze; UTR zaroori; bounce par leg
**rakhi** jaati hai aur retry nayi kholti hai.

⚠️ **Naya status `AWAITING_BANK_DETAILS` khula hai** (`REFUND_OPEN_STATUSES` me) aur
hold-releasing list me **nahi**. Chhootne par do cheezein ek saath tootti: grahak usi
payment par doosra refund file kar pata, aur agli settlement vendor ko us sale ka paisa
de deti jiska refund abhi bakaya hai — dono chup-chaap.

`__tests__/money/manualBankRefund.test.js` me **18 case** hain, jinme ek poora test sirf
is baat par hai ki hold failure se lekar paisa pahunchne tak har kadam par laga rehta hai.

---

## 6. Phase S2 — Settlement

| # | Module | Kya | Haalat |
|---|---|---|---|
| ⏳ **S2-1** | Settlement models | `Settlement` ✅, `SettlementHistory` ✅, `PayoutLeg` ✅, transition map ✅ | `BrandSettlementConfig` **nahi bana** — neeche |
| ✅ **S2-2** | Claim/release engine | `helpers/settlements/`: `settlementClaims.js` · `transitionSettlement.js` · `taintSettlement.js` | Sweeps ke naam badle — neeche |
| ✅ **S2-3** | `buildSettlements` | Canonical IST period, receipt gate, totals, gateway fee | `services/settlements/buildSettlements.js` · `helpers/dates/istDate.js` |
| ✅ **S2-4** | Payout + admin API | `startPayout` · `confirmPayout` · `failPayout` · `retryPayout` · `reversePayout`, aur **`requiresAdminApproval` ab kaam karta hai** | 12 admin endpoints. ⚠️ Wo setting dono taraf wired thi aur **koi padhta hi nahi tha** — `false` karne par kuch nahi hota tha, bina error ke. Ab build seedha `APPROVED` par jaata hai; `pay` ab bhi aadmi ka kaam hai aur `paySettlement` taint dobara check karta hai. `settlement_flow.md` §3.0 |
| ✅ **S2-5** | Statement + vendor screens | Frozen `bankSnapshot` ✅, per-leg UTR ✅, 3 read endpoints ✅, **statement PDF** ✅ | `helpers/settlements/generateAndUploadStatement.js` · `GET /settlements/statement/:token` |
| ✅ **S2-6** | Docs + Postman + tests | | 10 settlement test suites · `settlement_flow.md` · census |

### ✅ Phase S2 ho gaya — poora paisa nikalne ka rasta

Cycle banta hai, rows kabza hote hain, admin manzoori deta hai, NEFT jaati hai, UTR
record hota hai, aur bank wapas kheenche to reversal bhi hai. Poora rasta
[`settlement_flow.md`](./settlement_flow.md) me hai.

**Teen jagah plan se hata:**

**1. `BrandSettlementConfig` nahi bana — config global hai.** `buildSettlements.js:63`
`getCustomerConfig()` se `config.settlement` padhta hai, yaani **saare brands ke liye ek
hi** `delayDays`, `minPayoutAmount`, `payoutProvider`. Per-brand override ka koi model
nahi hai. Aaj iski zarurat nahi thi aur ek aisa model banana jise koi padhta na ho, sirf
bhram deta. **Jis din ek brand ko alag T+N chahiye, ye banana padega** — aur tab
`buildEligibilityFilter` ko brand-wise config lena hoga, jo abhi ek hi baar loop ke bahar
padhta hai.

**2. Sweeps ke naam alag hain.** Manifest me ek `sweepStaleSettlements` tha. Asal me
**teen alag** sweeps hain, kyunki teen alag tarah ka "kuch nahi hua" hai:

| Job | Kya dhoondhta hai |
|---|---|
| `sweepStalePayouts` | 6h+ se `INITIATED` leg — **sirf batata hai**, kabhi act nahi karta |
| `sweepAbandonedDrafts` | Mari hui `DRAFT` jo period ka key ghere baithi hai |
| `sweepStrandedClaims` | Terminal settlement jo ab bhi rows pakde hai |

Ek hi job me teenon karna matlab ek hi threshold, ek hi interval, aur ek hi tarah ka
alert — jabki `sweepStalePayouts` ka **jaan-boojh kar kuch na karna** hi uska design hai.

**3. "6 vendor screens" asal me 3 endpoints hain.** `GET /settlements`,
`/settlements/:id`, `/settlements/:id/transactions` — teeno token se scope hote hain.
Screens frontend ki ginti thi, endpoints ki nahi.

### ✅ Statement PDF ban gaya

`statementUrl` aur `statementToken` model par shuru se the aur read pipeline unhe
project bhi karta tha — par **unhe koi bharta nahi tha**. Ab:

```
GET /settlements/statement/:token       ← PUBLIC, koi JWT nahi
```

**Teen faisle jo sabse zyada maayne rakhte hain:**

**1. Token `transitionSettlement` me banta hai, `confirmPayout` me nahi.** ⚠️ `PAID` **do**
jagah se aata hai — normal aakhri leg, aur us confirmation ka self-heal jo leg pay hone ke
baad crash hua tha. `confirmPayout` me mint karne par doosre raaste se aayi settlement ka
statement hota hi nahi, aur wo chhed sirf tab dikhta jab vendor apna kaagaz maangta.

**2. Sirf `PAID` ka statement.** Har pichhla state abhi hil sakta hai — `rebuild` rows
chhodta hai, `CARRIED_FORWARD` unhe agle cycle me deta hai, bounce nayi leg se retry hoti
hai. Unme se kisi ka PDF cache karna matlab **aisa kaagaz dena jiske aankde baad me badal
gaye**, aur wo vendor ke paas hamare naam ke saath pada rehta.

**3. ⚠️ Platform ka margin kaagaz par nahi jaata.** `platformPromoCost`, `gatewayFee` aur
`netReceived` **usi sub-document** par hain jispar vendor ke apne aankde hain. API ye
faisla `buildSettlementReadPipeline` me karta hai; kaagaz ko **wahi faisla dobara** karna
padta hai, na ki jo row me pada ho wo chhaap dena. Account number bhi sirf masked —
statement forward hota hai, screenshot hota hai, support chat me paste hota hai.

**Har katauti apne naam se**, aur **commission ki line zero par bhi chhapti hai** — taaki
jis din rate on ho, do mahine milaane wale vendor ko ek number badalta dikhe, na ki ek
nayi line kahin se prakat hoti. Har transfer ka UTR bhi, kyunki teen din baad wahi ek
cheez bank statement par dhoondhi ja sakti hai.

Poora: [`settlement_flow.md`](./settlement_flow.md) §12.

---

## 7. Phase S3 — Chargebacks

| # | Module | Kya | Haalat |
|---|---|---|---|
| ✅ **S3-1** | `Dispute` model | Har dispute apni row, out-of-order delivery sambhalta hua | `models/Dispute.js` · `helpers/disputes/recordDispute.js` |
| ✅ **S3-2** | Webhook dispute rewrite | Dispute events ✅, settlement taint ✅, **vendor ko khabar** ✅ | `handleRazorpayWebhook.js` · `taintSettlement.js` · `disputeNotices.js`. ⚠️ Notice **stored row** se banti hai, live event se nahi — dispute events out-of-order aate hain |
| ✅ **S3-3** | Chargeback ledger + adjustment lock | **Money audit me bana** | `helpers/ledger/postChargebackEntries.js` · `claimChargebackAdjustments` · `Transaction.chargebackSettlementId:349` |
| ✅ **S3-4** | Evidence pack builder | Hamare apne record se poora case + **paste karne layak `narrative`** | `helpers/disputes/buildEvidencePack.js` · `GET /transactions/disputes/:disputeId/evidence-pack` (admin). Outlet ka note `POST .../evidence` se. ⚠️ Grahak ka contact **masked** — document third party par jaata hai |
| ✅ **S3-5** | Dispute API | **Apna domain** — list, detail, evidence, pack. Do shape, ek endpoint | `routes/disputes.js` → `/trydood/v1/disputes`. Purane `/transactions/disputes*` **wahi controllers** chalate hain (Postman tootne se bachane ke liye), aur test dono mounts ko identical rakhta hai. ⚠️ Vendor ko `respondBy`/`daysToRespond`/`alertsSent`/`vendorWasPaid` **kabhi nahi**. Hold `PATCH /transactions/admin/:id/release-hold` par hi rehta hai — wo transaction par hai, dispute par nahi |
| ✅ **S3-6** | `disputeDeadlines` job | Har ghante, do stage + overdue | `services/transactions/disputeJobs.js` · `helpers/notifications/disputeNotices.js` |
| ✅ **S3-7** | Risk-based reserve | Har brand ka apna rate — count **aur** rate dono, volume floor, ceiling | `helpers/settlements/reserveRisk.js`. Rate `Settlement.reservePercent` + `reserveBasis` me **freeze** hota hai. Poore run ke liye do query, per-brand do nahi. `settlement_flow.md` §2.5c |
| ✅ **S3-8** | Reserve wapas dena | Alag job ki zarurat nahi padi — build hi claim karta hai | `claimMaturedReserves` · `brandsWithMaturedReserves` |
| ✅ **S3-9** | Vendor receivables + write-off | Jo katauti kisi cycle tak pahunch hi nahi sakti — dikhti hai, alert karti hai, band ki ja sakti hai | `helpers/settlements/vendorDebt.js` · `alertVendorDebt` (roz) · `GET/PATCH /settlements/admin/debt/:brandId` · `writtenOffAt` dono claim filters me. Vendor ko wajah `SETTLEMENT_CARRIED_FORWARD` se |
| ✅ **S3-10** | Reserve + chargeback config | Poora engine, aur har field ab koi padhta hai | `reserve.isEnabled: false` (band, par raasta bandha hua), `percent: 5`, `holdDays: 30`, `riskChargebackCount: 2`, `riskLookbackDays: 180`, `riskMinPayments: 20`, `riskDisputeRatePercent: 1`, `riskPercent: 15`, `maxPercent: 25`, `newVendorReserveDays: 0`, `chargeback.writeOffDays: 90`. ⚠️ Inme se **do** — `riskChargebackCount` aur `newVendorReserveDays` — dono taraf wired the aur koi padhta hi nahi tha |
| ⏳ **S3-11** | Docs + Postman + tests | Tests aur docs ✅, Postman baaki | `chargebackRecovery.test.js` · `disputeModel.test.js` · `disputeVisibility.test.js` · `vendorDebt.test.js` · `reserveRisk.test.js` · `reserveRelease.test.js` · `moneyInvariants.test.js` (write-off identity) · `docs/dispute_flow.md` · `settlement_flow.md` §2.5a/§2.5c/§2.6a/§2.6b. ⚠️ Postman **jaan-boojh kar baaki** — generator dobara chalane par captured examples mit jaate hain (pichhli baar 15,499 lines), to ye alag se soch kar karna hai |

### ⏳ S3 ab lagbhag poora — aur jo bacha wo jaan-boojh kar bacha hai

**Ek module (S3-3) money audit me banana pada**, kyunki uske bina platform chup-chaap
paisa kha raha tha:

`chargebackAdjustment` code me **hardcoded `0`** tha, aur `CHARGEBACK` /
`CHARGEBACK_REVERSAL` ledger types rules table me maujood the par **koi unhe likhta hi
nahi tha**. Matlab: payment settle hui → vendor ko paisa gaya → bank ne chargeback me
wapas kheench liya → **poora nuksaan platform ne uthaya, aur kitaab me nishaan tak nahi**.

Ab `LOST` dispute par `CHARGEBACK` debit hota hai — **sirf vendor ka hissa**
(`netBill − vendorPromoCost − commissionAmount`), poora disputed amount nahi, kyunki
usme hamari fee aur promo ka aadha bhi hai. `WON` par reversal, par **sirf tab jab loss
pehle book hua ho**. Recovery agle cycle me `chargebackSettlementId` lock ke saath kati
hai — bina lock ke wahi ek chargeback **har cycle** kata jaata, hamesha ke liye, aur har
mahine ka hisaab apne aap me sahi dikhta.

`ledger_type_dispute_unique` dispute par keyed hai, transaction par nahi — Razorpay
dispute webhooks **dobara bhejta hai aur kram se bahar bhejta hai**: ek der se aaya
`lost`, `won` ke baad aa sakta hai.

### ✅ S3-2/4/5 — *"koi andhere me na rahe"*

Ye teen ek saath bane, kyunki alag-alag inka matlab hi nahi banta.

Pehle vendor ko dispute ki **koi khabar nahi** jaati thi. Unhe sirf itna dikhta tha ki
us sale ka paisa settlement me aata hi nahi, aur baad me statement par ek katauti ki
line jiske saath koi sale judi hui nahi thi. Yani unke liye ye aisa lagta tha jaise
**paisa bina bataye kat gaya** — chahe katauti bilkul sahi ho. Support par phone aata,
aur support ko ledger kholkar dhoondhna padta ki kaunsi sale thi.

Ab:

| Kise | Kya milta hai |
|---|---|
| Vendor | Dispute aate hi notification, apne brand ki list, aur apna note bhejne ka raasta |
| Admin | Poora evidence pack — hamare apne record se — **aur argument pehle se likha hua** |

⚠️ **Vendor ko hamari queue nahi dikhti**: `respondBy`, `daysToRespond`, `isOverdue`,
`alertsSent`, `recoverySettlementId`, `vendorWasPaid` — kuch bhi nahi. Deadline nibhana
hamara kaam hai aur evidence hum file karte hain; jis countdown par outlet kuch kar hi
nahi sakta wo warning nahi, sirf ghabrahat hai.

⚠️ **Scoping filter me hai, projection me nahi.** Ek filter jo sirf lagti hui dikhe,
wahi tarika hai jisse koi baad me ek aur read likh de jo kabhi scope hui hi na ho.

⚠️ `GET /transactions/disputes` par `verifyJwtToken` **saaf-saaf** likha hai. Us router
par koi blanket `router.use(verifyJwtToken)` nahi hai — public invoice link isi wajah se
— to `isAdmin` hatate waqt uski jagah kuch na rakhna poori chargeback worklist ko URL
jaanne wale kisi ke liye bhi khol deta.

⚠️ Outlet ka note **bonus hai, sahaara nahi**. Pack hamare apne record par khada hota
hai, kyunki is platform par voucher counter par pay hota hai — payment khud grahak ko
wahan rakhta hai. Filing outlet ke jawab ka intezaar nahi karti: **dispute ka jawab ek
hi baar** jaata hai aur deadline bank ki hai.

### ✅ S3-7/10 — reserve ka rate ab har brand ka apna

`reserve.percent` sabke liye ek hi number tha. Aur `riskChargebackCount`
`constants/customer.js` me, `Setting` schema me aur `getCustomerConfig` me maujood tha —
admin panel se badla ja sakta tha — jabki **koi code use padhta hi nahi tha**. Wahi
shakal jo `chargebackAdjustment: 0`, `commissionTax: 0`, `reserveReleased: 0` aur
`chargeback.writeOffDays` ki thi.

`helpers/settlements/reserveRisk.js` ab rate chunta hai. Teen faisle isme maayne rakhte
hain, aur teeno "kya ye vendor ko samjhaya ja sakta hai" par tikte hain:

⚠️ **Count akela size ko sazaa deta hai.** 10,000 sale par 2 chargeback wala brand 40
sale par 2 wale se **behtar** hai; sirf `riskChargebackCount >= 2` dekhne se pehle wale
se zyada roka jaata — theek ulta. Count trigger hai, rate test hai; **dono** paar hone
chahiye.

⚠️ **Rate akela chhote sample par jhooth bolta hai.** 3 sale me se 1 chargeback matlab
33%, jiska koi matlab nahi. `riskMinPayments` se neeche brand base rate par hi rehta hai
— aur wo *"dekha, par judge karne layak bikri nahi thi"* (`TOO_FEW_PAYMENTS`) alag se
kehta hai, chup-chaap saaf nahi maan leta. Iske bina ek naye outlet ka sabse kharab
hafta unke pehle mahine ka chautha hissa jama deta.

⚠️ **`maxPercent` business faisla hai, ganit nahi** — aur base rate par bhi lagta hai.
Uske bina ek bura mahina lagbhag poora payout rok leta, aur wahi tarika hai jisse ek
sudhrne wali dikkat **band outlet** ban jaati hai.

⚠️ **Jeeta hua dispute nahi ginha jaata.** Wo is baat ka sabooot hai ki sale sahi thi,
aur jeete hue case par vendor ka paisa rokna unhe samjhaya nahi ja sakta.

⚠️ **Poore run ke liye do query, per-brand do nahi.** Seedha tarika — ek helper jo
`brandId` leta hai, loop ke andar se bulaya jaata — 500 brands ki raat me 1,000 round
trip ban jaata, yani wahi number badhta hai jo badhna hi nahi chahiye.
`buildReserveRiskMap` do aggregation brand se group karke sabka jawab ek saath deta hai
aur `buildForBrand` ko **pass** hota hai.

⚠️ **Rate settlement par freeze hota hai.** `reserveHeld` pehle store hota tha par rate
nahi — jo tab tak theek tha jab sabka ek hi rate tha. Ab rate ek *chalti hui* window se
aata hai: statement khulne tak wo window hil chuki hoti hai, to *"March me mujhse 15%
kyun roka"* ka jawab aaj ka number hoga, jo alag number hai, aur page ka hisaab
reproduce hona band ho jaayega. `Settlement.reservePercent` + `reserveBasis` jawab ke
saath **kaam** bhi rakhte hain: *"180 din me 260 sale par 4 chargeback"* aisi baat hai
jispar vendor bahas kar sakta hai; *"15%"* nahi. Aur wo unhe **dikhta** bhi hai
(`reserveLabel`).

`reserve.isEnabled` abhi bhi `false` hai — raasta poora bandha hua hai, switch band hai.

### ✅ S3-9 — jo vasooli kabhi ho hi nahi sakti

Vasooli agle cycle se hoti hai. Par jis brand ki katautiyan uski bikri se zyada hain,
uska `netPayable` negative ho jaata hai, settlement `CARRIED_FORWARD` jaati hai — aur
**carry forward ka matlab hi hai ki uske sab claims chhod diye jaate hain**. Agla cycle
wahi rows dobara claim karta hai, wahi negative par pahunchta hai, phir chhod deta hai.

Brand chal raha ho to ye sahi hai: nayi bikri net kar deti hai. **Jis din wo band kar de,
ye kabhi khatam nahi hota** — koi error nahi, koi log nahi, kisi report me kuch nahi.

Ab teen cheezein hain: `alertVendorDebt` (roz, `chargeback.writeOffDays` padhkar — jo
ab tak **kisi code ne padha hi nahi tha**), `GET /settlements/admin/debt/:brandId`, aur
write-off jo `MANUAL_ADJUSTMENT` ka joda likhta hai — vendor ko credit, `PLATFORM_COST`
ko debit.

⚠️ Reference sirf vendor wali row par jaata hai: `ONCE_PER_DISPUTE`/`ONCE_PER_REFUND`
`{reference, entryType}` par unique hain, to dono par lagane se doosri row duplicate-key
par chup-chaap gir jaati — vendor ka debt saaf ho jaata aur platform ka cost kabhi aata
hi nahi.

⚠️ Aur vendor ko ab **wajah milti hai**: `SETTLEMENT_CARRIED_FORWARD`, sirf tab jab
katautiyan wajah ho. Sirf minimum-payout se neeche wali cycle abhi bhi chup hai — wo
rozmarra ki baat hai, aur uspar bhi message bhejna sirf itna karega ki log us message
ko ignore karne lagenge jo asal me maayne rakhta hai.

### ✅ S3-6 ban gaya — jo sabse mehnga khula chhed tha

`Transaction.disputeRespondBy` webhook se bharta tha aur **use dekhne wala koi nahi tha**.
Dispute me deadline nikal jaana matlab **apne aap haar** — bank yaad nahi dilata, Razorpay
yaad nahi dilata, aur kahin koi error bhi nahi aata, kyunki system ke hisaab se kuch hua
hi nahi. Wo tareekh sirf tab dikhti jab koi admin worklist kholkar khud padhta.

Ab `disputeDeadlines` har ghante chalta hai:

| Kitna waqt bacha | Kya |
|---|---|
| 72h se zyada | kuch nahi |
| 72h – 24h | ⚠️ WARNING |
| 24h – 0h | 🔴 CRITICAL |
| nikal gaya | 🔴 CRITICAL — *"an unanswered dispute is lost by default"* |

**Ghante me, roz nahi:** aakhri chetavani 24h par hai, aur roz chalne wali sweep use
aakhri din me kahin bhi gira sakti hai — deadline ke baad bhi.

**Sirf batata hai, karta kuch nahi** — `sweepStalePayouts` wali hi wajah se: evidence file
karne ke liye Razorpay dashboard chahiye, aur **har dispute par ek hi jawab milta hai**.
Job jo apne aap kuch bhej de, wo jo bhi uske paas hai wahi bhej dega — jo kuch na bhejne
se bura hai.

**Ek stage, ek baar** — `disputeAlertsSent` counter hi claim hai, usi conditional write me
badalta hai jo tay karta hai kaun bhejega. Do instance saath sweep karein to bhi ek hi
alert jaata hai. ⚠️ Bina iske ghante-ghante wahi CRITICAL jaata, aur uska pakka nateeja ye
hai ki log channel mute kar dete hain — jo dispute se zyada mehnga padta hai.

⚠️ **Overdue par bhi ek seema hai** (7 din). Uske bina sweep kabhi khaali nahi hoti:
`OPEN` status tabhi badalta hai jab Razorpay faisla bheje, to jo dispute kabhi answer nahi
hua wo hamesha query me rehta — wahi non-draining shakl jo refund sweep me thi.

### 🔴 Aur is kaam ne ek chhupa hua landmine bhi nikaala

`jobs/index.js` me `services/transactions` import karte hi ek **require cycle band ho
gaya**:

```
jobs/index.js → services/transactions → getPaymentHealth.js → require("../../jobs")
                            ↑                                            │
                            └────────────────────────────────────────────┘
```

Node cycle ka jawab **aadha-bana hua exports object** dekar deta hai. Load order ke hisaab
se ya `disputeDeadlines` `undefined` hota — job registered, par `run: undefined`, **kabhi
chalta hi nahi** — ya `getJobsHealth` `undefined` ho jaata. Load par kuch throw nahi hota.

⚠️ **Ye bilkul wahi shakl hai** jo us chhoote hue `};` ki thi jisne har settlement rok di
thi (§7.5). `getPaymentHealth.js` ab `jobs` ko **function ke andar** require karta hai, to
cycle load-time par banta hi nahi — dono entry order me jaancha gaya. Aur
`__tests__/money/disputeJobs.test.js` teenon service barrels par assert karta hai ki koi
export `undefined` na ho, taaki agla aadmi ise dobara na laaye.

---

## 7.5 🔬 Money audit — S2 ke baad ka poora sweep

S2 khatam hone par ek sawaal poocha gaya: *"khi bhi koi catch to nhi bcha na? kahin
payment atak kar reh na jaye."* Uska jawab dhoondhne ke liye poora money path — claim →
payment → refund → settlement → ledger — ek-ek karke padha gaya.

**53 sawaal uthe · 13 padhne par galat nikle · 40 asli the aur theek hue.**

Wo 13 bhi likhna zaroori hai: "shayad bug hai" aur "bug hai" ka farak sirf code kholne se
pata chalta hai, aur bina jaanche fix karna apne aap me ek naya bug hai.

Commits: `d2ba3e2` · `0cc2302` · `331b56e` · `c36f774` · `4d29f81` · `7a5f763` · `d697fb4`

### 🔴 Showstopper — S2 poora inert tha, aur kisi ko pata nahi chalta

`services/transactions/handleRazorpayWebhook.js` me **ek `};` chhoot gaya tha.** Uska
matlab `processWebhookEvent` line 207 se 792 tak faila hua tha, aur teen functions ko
apne andar nigal gaya tha — jismein `handleGatewaySettlement` bhi tha, jo line 425 par
declare hota hai par 259 par call hota hai.

Runtime par sabit kiya gaya:

```
THREW: ReferenceError: Cannot access 'handleGatewaySettlement' before initialization
AT   : handleRazorpayWebhook.js:259:5
```

**Nateeja ki poori zanjeer:**

```
handleGatewaySettlement kabhi chala hi nahi
        ↓
recordFundsReceived kabhi nahi chala
        ↓
fundsReceivedAt hamesha null raha
        ↓
buildEligibilityFilter me `fundsReceivedAt: { $ne: null }` hai
        ↓
KOI settlement kabhi ban hi nahi sakti thi — KISI vendor ko kabhi paisa nahi jaata
```

Aur ye **chup-chaap** hota: throw line 917 par catch ho jaata, webhook `200` lautata,
Razorpay ko lagta sab theek hai, koi retry nahi. `buildSettlements` har ghante chalti,
har baar "0 brands eligible" paati, aur wo bilkul normal dikhta.

⚠️ **Ye wahi shakl hai jiske baare me `settlement_flow.md` §8 ki pehli line kehti hai:**
*"Settlement na hoke fail hota hai."* Doc ne is khatre ko theek pehchana tha — par jis
waqt wo likha gaya, wo khatra pehle se hakikat ban chuka tha.

### Baaki 39 — kya theek hua

| # | Kya | Asar |
|---|---|---|
| 1 | **Partial refund double-penalty** — eligibility `amountRefunded: { $lte: 0 }` par thi, aur wo field sirf badhti hai | ₹810 me ₹300 refund par vendor ka poora ₹800 sale **hamesha ke liye** bahar, *aur* ₹296.30 clawback agle cycle me kata — ek ₹800 ki sale par lagbhag **₹1,100 ka farak**. Ab `isRefunded: { $ne: true }` |
| 2 | **Ledger jodta hi nahi tha** — chaar defects | Neeche alag se |
| 3 | **Chargeback kabhi book hi nahi hote the** | S3-3 (upar) |
| 4 | **Do operator escape jinka koi caller nahi tha** | `abandon` aur `release-hold` — `settlement_flow.md` §10a |
| 5 | **Sweeps jo drain hi nahi hote the** | `claimRefundAdjustments` poori brand history sweep karta tha; ab sirf un-claimed refunds se shuru hota hai |
| 6 | **Claims `Promise.all` me the** | Refund claim wahi `settlementId` padhta hai jo transaction claim likhta hai — ab **kram se** |
| 7 | **Ek brand ka throw poori raat gira deta tha** | Ab per-brand `try/catch` |
| 8 | **`delayDays: 0` chup-chaap 3 ban jaata tha** | `Number.isFinite` — `0` ek jaayaz value hai |
| 9 | **`refund.failed` par status guard nahi tha** | Ek der se aaya `failed` ek `COMPLETED` refund ko wapas `FAILED` kar sakta tha |
| 10 | **`amountRefunded` claim ke baad badhta tha** | Ab claim `isOpen` clear karne se **pehle**, warna beech ki khidki me eligibility galat padhti |
| 11 | **`FAILED` claimable status me nahi tha** | Failed refund ko retry karne ka raasta hi band tha |
| 12 | **Import chhoota tha jo load par nahi girta** | `SETTLEMENT_STATUS` `settlementNotices.js` me function ke andar use hota tha bina import ke — module load hota, **pehle asli notice par phatta** |

### Ledger — chaar defects, ek hi andhe kone me

Har ledger test **row ka shape** dekhta tha. **Koi account jodta nahi tha.** Chaaron bug
theek usi gap me baithe the:

| Kya galat tha | Poore refund ke baad |
|---|---|
| Refund `vendorClawback` debit karta tha, jo **pehle se** promo ka net hai, phir promo share dobara credit | `VENDOR_PAYABLE` par `+vendorPromoCost` bacha reh jaata — bhoot ka paisa jo agla payout de deta |
| `split.taxRefund` nikaala jaata tha aur **kabhi post nahi hota** | `TAX_PAYABLE` par us fee ki GST rehti jo grahak ko wapas ja chuki |
| `COMMISSION` refund par ulta hota tha par capture par **kabhi post hi nahi** | rate zero se upar hote hi `PLATFORM_REVENUE` negative |
| GST-**inclusive** fee par gross revenue credit hota **aur** tax alag se | Har sale par revenue theek GST jitna zyada |

Ab do naye test balances par assert karte hain, rows par nahi:

- `ledgerBalance.test.js` — capture + poore refund ke baad `VENDOR_PAYABLE`,
  `PLATFORM_REVENUE`, `TAX_PAYABLE` **teeno zero** par aate hain
- `moneyInvariants.test.js` — ek hi pehchaan, har ending par:

  ```
  vendor ko jo diya  +  jo abhi bakaya hai
      ===  unka sale ka hissa  −  unka refund ka hissa
  ```

> ⚠️ `PLATFORM_COST` jaan-boojh kar zero par nahi aata — Razorpay apni MDR rakhta hai,
> refund ho ya na ho.

### Test ka tareeka hi badla — teen naye kism ke suite

| Suite | Kya pakadta hai jo pehle nahi pakda jaata tha |
|---|---|
| `ledgerBalance.test.js` | Account ka jod. Row-shape test chaaron ledger bugs ke upar se guzar gaye the |
| `moneyInvariants.test.js` | Har ending ke baad vendor ki pehchaan. Ek ending bhi toote to pakdi jaati hai |
| `noticeSmoke.test.js` | Har money notice **sach me banakar** dekhta hai — wahi missing-import bug pakda jo module load par nahi girta |

Suite ab **44 suites · 848 pass** hai (audit se pehle 14 suites / 197 the).

---

## 7.6 ✅ Commission — rate `0` par bhi poora raasta bandha gaya

`commissionPercent` aaj `0` hai aur rahega. Par **`0` ek khatarnak default hai**: har
commission figure zero hota hai, `recordLedgerEntry` zero amount chhod deta hai, aur is
poore raaste ki har galti tab tak adrishya rehti hai jab tak koi rate set na kare — jis
din wo hoga, galti poore volume ke saath ek saath bahar aayegi.

Isliye poora path non-zero rate par chalakar jaancha gaya. **Teen asli hole mile.**

### 🔴 1. Ledger `VENDOR_PAYABLE` ko kabhi debit hi nahi karta tha

`COMMISSION` sirf `PLATFORM_REVENUE` credit karta tha. Capture gross `netBill` credit
karta hai, payout sirf `netPayable` debit karta hai — jisme se `computeTotals` commission
pehle hi kaat chuka hota hai. Beech ka farak kabhi clear nahi hota:

```
₹1,000 sale · 10% commission
  capture:    VENDOR_PAYABLE  +1000
  payout:     VENDOR_PAYABLE   −900
  ──────────────────────────────────
              VENDOR_PAYABLE  = +100   ← har sale par, hamesha ke liye
```

10% par ₹1,000 ki 1,000 sales/mahina = **₹1 lakh/mahina ka jhootha liability**, aur
`getVendorBalance` vendor ko wo paisa dikhata jo kabhi unka tha hi nahi.

⚠️ Ye pehle audit me **pakda gaya tha aur jaan-boojh kar chhoda gaya tha** — code me
apna comment likhkar: *"getting it wrong at a non-zero one is worse than leaving it
visible."* Wo faisla us waqt theek tha. Ab wo band hai: naya entry type
`VENDOR_COMMISSION` (`VENDOR_PAYABLE` / DEBIT), refund par credit — wahi jodi jo
`VENDOR_PROMO_SHARE` / `PLATFORM_PROMO_COST` banate hain.

### 🔴 2. `commissionTax` hardcoded `0` tha

`computeTotals` me `commissionTax: 0` likha tha — jabki field `Settlement` model par thi
**aur vendor ko project bhi hoti thi**. Bilkul wahi shakl jo `chargebackAdjustment: 0` ki
thi, jo asli hole nikla tha.

Ab wo commission par wahi teen switches lagata hai jo convenience fee par lagti hain
(`isGstEnabled` · `gstPercentage` · `isGstInclusive`). Aaj **do baar zero** hai — rate 0,
GST off — par ab ganit ki wajah se, kisi ke na jodne ki wajah se nahi.

### 🔴 3. `netPayable` galat number ghatata

| GST | commission | tax | vendor se kata | vendorPayable *(₹1,000)* |
|---|---:|---:|---:|---:|
| off | 100 | 0 | 100 | 900 |
| 18% inclusive | 100 | 15.25 | 100 | 900 |
| 18% **on top** | 100 | 18 | **118** | **882** |

On-top me sirf `commissionAmount` ghatane par **vendor ka GST platform apne margin se
bharta** — har sale par, aur settlement phir bhi apne aap me sahi dikhta kyunki usme har
number alag-alag theek hota. Ab naya frozen field `commissionDeduction` hai, aur
`netPayable`, chargeback ka vendor-share, aur ledger teenon wahi padhte hain.

### Kya-kya badla

| File | Kya |
|---|---|
| `constants/ledger.js` | naya `VENDOR_COMMISSION` type + rule |
| `helpers/vouchers/calculateVoucherPricing.js` | `commissionTax` + `commissionDeduction` nikaalta hai |
| `models/voucherPricingSchema.js` · `Transaction.js` · `Settlement.js` · `RefundRequest.js` | naye fields — ⚠️ schema ke bina Mongoose inhe **chup-chaap gira deta** |
| `helpers/ledger/postCaptureEntries.js` | `VENDOR_COMMISSION` debit · commission net-of-tax · `TAX_COLLECTED` me commission GST |
| `helpers/ledger/postRefundEntries.js` | teenon ka reversal |
| `helpers/ledger/postChargebackEntries.js` | vendor share ab `commissionDeduction` par |
| `helpers/refunds/calculateRefundSplit.js` | `commissionTaxReversal` + `commissionDeductionReversal` |
| `services/settlements/buildSettlements.js` | `commissionTax` derived · `netPayable` deduction par |
| `helpers/settlements/buildSettlementReadPipeline.js` | vendor ko deduction dikhta hai |

### Sabooti — non-zero rate par bandha hua

`__tests__/money/ledgerBalance.test.js` me ab **paanch case non-zero rate par** chalte
hain, teenon GST modes me. Har case me `VENDOR_PAYABLE`, `PLATFORM_REVENUE` aur
`TAX_PAYABLE` poore refund ke baad **zero** par aate hain, aur capture ke baad
`VENDOR_PAYABLE` frozen `vendorPayable` se hoobahoo milta hai.

> **Rate on karne ka din:** sirf `Setting.customer.settlement.commissionPercent` badalna
> hai. Wo us din ke **baad** wali claims par lagega — purani par nahi, kyunki har claim
> apna `commissionPercent`, `commissionTax` aur `commissionDeduction` banate waqt freeze
> karti hai. GST alag switch hai aur alag din on ho sakti hai; dono ka koi kram nahi hai.

---

## 7.7 ✅ OTP — do asli chhed, dono band

`MANUAL_BANK` banate waqt ek OTP gate joda gaya (bank account jodne par). Us
machinery ko dekha to **do cheezein nikleen jo pehle se khuli theen** — aur ab wo
paise ke raaste ko bhi chhu rahi theen.

### 🔴 1. OTP `Math.random()` se banti thi

```js
digits += Math.floor(Math.random() * 10);   // pehle
digits += crypto.randomInt(0, 10);          // ab
```

V8 ka generator **predictable** hai: wo kisi aisi entropy se seed nahi hota jise
caller chhoo na sake, aur uska andaruni state kuch outputs dekhkar nikala ja sakta
hai. Aur wo outputs jama karna mushkil bhi nahi — attacker apne hi number par
jitne chahe codes mangwa sakta hai, har ek ek sample.

Us code se kya khulta hai, isse farak padta hai: **kisi aur ke roop me login**,
aur ab **wo bank account jodna jisme refund jaayega**. Hashing hamesha sahi
HMAC-SHA256 thi — kamzori sirf us number me thi jo hash ho raha tha.

### 🔴 2. Bhejne par koi rok hi nahi thi

`saveOtp` har call par upsert karta tha, bas. Yani koi bhi kisi ajnabi ka number
public login route par daal kar jitni tezi se chahe OTP bhijwa sakta tha — aur har
request ek WhatsApp message ya SMS banti thi **jiska paisa hum bharte hain**, us
phone par jisne kabhi maanga hi nahi. Kharcha aur pareshani, ek hi chhed se.

| | |
|---|---|
| Kis par | **target** (number/email) + purpose — IP par **nahi** |
| Default | 60s gap, 5/ghanta — `constants/otp.js` |
| Admin config | `Setting.security.otp`, jo default se **upar** hai |
| Storage | `models/OtpThrottle.js` — **rolling** window |

⚠️ **IP par nahi.** Indian mobile networks hazaaron asli grahakon ko ek CGNAT
address ke peeche rakhte hain — IP limit ek poore mohalle ko bahar kar deti aur
phone wale attacker ko mushkil se rokti. Number ek aadmi hai.

⚠️ **`Otp` document par nahi.** Uspar 5-minute ka TTL hai, to counter ek ghante ki
window me baarah baar mit jaata aur kuch cap hi na karta.

⚠️ **Claim hi write hai.** `claimOtpSend` window prune karke append **ek hi**
aggregation-pipeline update me karta hai, aur caller ye poochkar jaanta hai ki
uska apna timestamp bacha ya nahi. Read-then-write me do tap do message bhejte, aur
doosra instance aate hi limit dogunni ho jaati. (Mongoose 9 me `{ updatePipeline:
true }` chahiye — test ne yahi pakda tha.)

⚠️ **Send fail hone par slot wapas** milta hai, aur **value se** hataya jaata hai.
Rakhne par provider ka outage grahak ko ek ghante ke liye login se bahar kar deta —
aur wo galti poori tarah hamari hoti. Time-range se hatane par usi second me claim
kiye doosre callers ke slot bhi chhoot jaate.

### Aur ek adhoori wiring pakdi

Config to bana di, par `updateSetting` sirf `vendor` aur `customer` blocks handle
karta tha — `security` nahi. Yani admin use **set kar hi nahi sakta tha** aur
"config se lo" bekaar padi rehti. Ab validator aur merge dono me hai, aur
`Object.assign` **sub-block par** hota hai, parent par nahi — warna sirf
`maxPerHour` bhejne par cooldown ud jaata, bilkul wahi bug jo `settlement.reserve`
par ho chuka hai.

`__tests__/money/otpThrottle.test.js` — **11 case**, jinme ek 8 samanantar claims
bhejta hai aur assert karta hai ki **theek ek** paas hui.

---

## 7.8 ✅ `AWAITING_BANK_DETAILS` ka watcher — aur ek adhoori settings surface

`MANUAL_BANK` banate waqt naya status joda, aur usne apne aap ek chhed bhi bana diya:
wo **ek matra khula refund state** tha jispar koi job nahi thi.

Har doosra khula state koi job **hal** kar deta hai. Ye nahi kar sakta — use sirf
grahak badha sakta hai, aur kuch kabhi nahi badhayenge.

| Kab | Kya |
|---|---|
| 24h | grahak ko nudge |
| 96h | doosra nudge |
| **30 din** | ⚠️ admin ko — hold chhodne ka faisla |

⚠️ **Aakhri stage nudge nahi hai, wo vendor ke liye hai.** `settlementHold` us din se
laga hai jis din refund maanga gaya. Refund zinda ho to sahi; atak jaaye to
**vendor hamesha ke liye kisi aur ki khamoshi ki keemat bharta hai.**

⚠️ **Hold chhodna refund cancel karna nahi hai.** Grahak baad me account de de to
`claimRefundAdjustments` clawback agle cycle se kaat leta hai — tab tak payment par
`settlementId` lag chuka hoga, aur wahi us function ki shart hai. **Ye maine pehle
verify kiya, phir design banaya** — warna hold chhodna paisa maaf karna hota.

### Do cheezein jo test ne pakdi

**1. Helper ka apna guard tha.** `releaseSettlementHold` khud khuli refunds ginta hai
aur kisi par bhi mana karta hai. Uska hal helper ko dheela karna **nahi** tha — usme
pehle se `exceptRequestId` maujood tha. Ek row naam se chhodna, taaki baaki har caller
ke liye guard poora bana rahe.

**2. Mera ek test hi galat tha, aur uska jawab behtar nikla.** Maine likha *"doosri
khuli refund hone par mana kare"* — aur database ne wo setup hi banane se **inkaar** kar
diya: `refund_open_per_transaction_unique` ek payment par ek hi khuli refund deta hai.
Test ab wahi assert karta hai. Isi guarantee ki wajah se `exceptRequestId` surakshit
hai: jo ek row chhodi ja rahi hai wo chupke se kai rows nahi ho sakti.

### 🔴 Aur ek adhoori surface pakdi — 6 settings jo admin set hi nahi kar sakta tha

Naye config fields jodte waqt validator dekha, to mila ki `stripUnknown` on hone ki
wajah se **jo field validator me naam se nahi hai wo chup-chaap gir jaata hai** — admin
ko `200` milta hai, panel refresh tak value dikhti hai, aur kuch badalta nahi. Koi error
kahin nahi.

| Field | Kiska |
|---|---|
| `maxOpenRequests` · `maxRejectedPerWindow` · `requestWindowDays` | ⚠️ **pehle se** — aur ye teeno `refund_flow.md` §2.3 me **"admin config"** ke table me likhe hain |
| `bankDetailsReminderHours` · `bankDetailsStaleDays` · `deadlineAlertHours` | is session ke |

Doc kehta tha ki ye set ho sakte hain; code me raasta tha hi nahi. Chhe ke chhe ab
validator me hain, aur `__tests__/money/settingsSurface.test.js` **har settings block ko
model se milakar** dekhta hai — taaki agla field jodne wala isi jagah phir na chooke. Wo
ye bhi jaanchta hai ki `updateSetting` har top-level block ko merge karna jaanta hai,
kyunki `security` ke waqt wahi chhoot gaya tha.

---

## 7.9 ✅ Reserve — andar jaane ka raasta tha, bahar aane ka nahi

⚠️ **Teesri baar wahi shakl**, `chargebackAdjustment: 0` aur `commissionTax: 0` ke baad:

| | Pehle |
|---|---|
| `reserveHeld` | ✅ compute, `netPayable` se ghatana, ledger me `RESERVE_HOLD` |
| `reserveReleased` | 🔴 **hardcoded `0`** |
| `RESERVE_RELEASE` | 🔴 ledger type maujood, likhta koi nahi |
| release ka raasta | 🔴 tha hi nahi |

Yani `reserve.isEnabled: true` karte hi **paisa andar jaata aur kabhi bahar nahi aata** —
hamesha ke liye, aur beech ki har settlement bilkul sahi dikhti.

**Chaar cheezein jo dhyan se ki gayin:**

**1. Chhoda hua reserve dobara nahi roka jaata.** Released amount **naye hold ke baad**
juda hai. Base me milane par us paise par phir 5% kat jaata — reserve par reserve — aur
har cycle guzarne par vendor ka paisa thoda-thoda ghatta rehta, hamesha ke liye.

**2. Lock, refunds aur chargebacks ki tarah.** Bina `reserveReleaseSettlementId` ke ek
live "kya matured hai" query wahi reserve **har cycle** wapas kar deti.

**3. ⚠️ Jo brand dhandha band kar de, uska bhi wapas aata hai.**
`brandsWithEligibleMoney` eligible **transactions** par `distinct` hai — jis brand ki koi
nayi sale nahi wo cycle me aata hi nahi, aur uska reserve wahin pada rehta. Build ab
`brandsWithMaturedReserves` se bhi brands uthata hai. **Unka paisa isliye unka rehna band
nahi ho jaata ki unhone bechna band kar diya.**

**4. Release me teesra lock.** `releaseSettlementClaims` ab teen chhodta hai —
transactions, chargebacks, reserves. Jo settlement kisi ka reserve pakde mar jaaye wo use
*"pehle hi release ho chuka"* mark chhod deti, aur koi aage ka cycle use uthata nahi.

### Do cheezein raaste me mileen

**🔴 `Settlement.paidAt` tha hi nahi.** `approvedAt` tha — yani settlement jaanti thi ki
kab **manzoori** mili, par nahi ki paisa **kab gaya**. `paidAt` sirf `PayoutLeg` par tha,
to *"is vendor ko paisa kab mila"* ke liye join chahiye tha aur uspar `distinct` practical
hi nahi tha. Reserve ki ghadi yahin se chalti hai — hold **paisa nikalne ke baad** aane
wale chargeback ke liye hai. Ab `transitionSettlement` `PAID` par stamp karta hai, aur
vendor ko bhi dikhta hai.

**⚠️ Ek free identifier pakda gaya.** Maine `buildForBrand` ke andar `at.getTime()` likh
diya tha — par wo module-level function hai, `buildSettlements` ke locals par close nahi
karta. Wo pehle matured reserve par `ReferenceError` deta, aur **`node --check` free
identifier nahi pakadta**. Ab cutoff upar ek baar nikalkar pass hota hai — jaisa
`fundsReceivedBefore` hota hai, kyunki wo run-level faisla hai.

**S3-8 ke liye alag job nahi bani.** Build hi claim karta hai, aur dormant brands wale
hisse ke saath wo poora hai — ek aur sweep banana matlab ek aur cheez jo chal na rahi ho
to pata na chale.

---

## 8. Docs + Postman — har phase ke saath

**Alag phase nahi hai.** Har phase ki definition of done ka hissa hai.

| # | Module | Kya | Haalat |
|---|---|---|---|
| ✅ **M1** | Postman shared lib fixes | `routeGates` multi-role, secret redaction, 302 handling | `postman/lib/` |
| ❌ **M2** | Naya `trydood-money` collection | | **Nahi bana.** Money requests maujooda collections me daali gayin — neeche |
| ✅ **M3** | Phase 0 folders + subscription retrofit | Do webhook routes, REJECTED cases | `trydood-subscription` |
| ✅ **M4** | Claim lifecycle folders | Preview → order → verify → settle → invoice | `scripts/addClaimRequestsToPostman.js` |
| ⏳ **M5** | Ledger/settlement/refund folders | Settlement ✅ refund ✅ | `addSettlementRequestsToPostman.js` · `addRefundRequestsToPostman.js`. **Dispute folder nahi** (S3 nahi bana) |
| ✅ **M6** | Customer collection | Preview rewrite + claim/transaction/invoice | `trydood-customer` |
| ✅ **M7** | Vendor collection | Claims, earnings, settlements, refund approvals | `trydood-vendor` |
| ✅ **M8** | Fixtures + live capture | | `scripts/seedPostmanFixtures.js` |
| ✅ **M9–M11** | Teen panel API docs | | `customer_mobile` (refund 4 · claim 7) · `vendor_panel` (settlement 3 · refund 4 · claim 5) · `super_admin` (settlement 9 · refund 4) |
| ✅ **M12** | `endpoints_category.md` census | | settlement 13 · refund 10 · voucher-claim 9 |

### M2 kyun nahi bana — aur uski jagah kya hua

Alag `trydood-money` collection banane ki jagah, money requests **maujooda collections
me** joda gaya — teen chhote scripts se jo **sirf add karte hain, regenerate nahi**:

```bash
node scripts/addClaimRequestsToPostman.js
node scripts/addRefundRequestsToPostman.js
node scripts/addSettlementRequestsToPostman.js
```

⚠️ **Wajah seedhi hai aur mehngi thi.** `trydood-customer` aur `trydood-vendor` me
**live-captured examples** hain jo generator dobara nahi banata. Ek regenerate ne
**15,499 lines** ke captured examples chup-chaap uda diye the — aur command ne success
report kiya tha.

Isiliye:

> **Kabhi bhi Postman generator dobara mat chalao.** Sirf usi generator ko chalao jiska
> source badla ho, aur baad me `git diff --stat postman/` zaroor dekho.
> `postman/README.md` me poori chetavani hai.

Ek alag money collection banane ka matlab hota ki wahi endpoints do jagah rehte, aur
dono kabhi ek jaise nahi rehte.

---

## 9. ⚠️ Manifest pass me mili galtiyaan — design me sudhaar

Ye cheezein design docs me galat ya adhoori thin. **Ab sahi hain.**

### Aaj ki haalat — code se milaayi hui

| # | Kya | Haalat | Code |
|---:|---|:-:|---|
| 9.1 | Route auto-mount kebab-case | ✅ | `routes/voucherClaims.js:126` — `module.exports = { router, routePrefix: "/voucher-claims" }` |
| 9.2 | `optionalAuth` pehle se tha | ✅ | `middlewares/` |
| 9.3 | Endpoint paths kabhi likhe hi nahi gaye | ✅ | Ab teeno jagah: S1 section (refund) · `settlement_flow.md` §7 · `endpoints_category.md` |
| 9.4 | 302 ka sanctioned raasta | ✅ | `utils/response.js:sendRedirect` |
| 9.5 | `buildTransactionFilter` admin listing | ✅ | `purpose` optional par explicit — `{ purpose: null }` matlab "sab, jaan-boojh kar" |
| 9.6 | SUB_VENDOR ke paas `brandId` nahi | ✅ | `middlewares/` me SUB_VENDOR branch **aur** `isVendorOrSubVendor` gate — dono maujood |
| 9.7 | `generateUniqueInvoiceId` dead code | ✅ | File delete ho chuki |
| 9.8 | `Notification.customerId` | ✅ | `models/Notification.js` |
| 9.9 | `resumeIncompleteSettlements` scope | ✅ | Job registered, 15 min |
| 9.10 | Postman secret redaction | ✅ | `postman/lib/` |
| 9.11 | Do assertions 1A ke din fail hongi | ✅ | Aliases ki wajah se dono collections pass hui |
| 9.12 | `.env.example` | ✅ | 67 keys, sirf naam aur shape |

**Baarah me se baarah band.** ⚠️ Sirf ek cheez khuli hai, aur wo design ki galti nahi —
neeche wala "doosra writer" wala box.

### 9.1 Route auto-mount kebab-case nahi deta 🔴

`routes/index.js` filename se prefix banata hai — `routes/voucherClaims.js` **`/trydood/v1/voucherClaims`** par mount hoga, `/voucher-claims` par **nahi**. Dono design docs me har endpoint path kebab-case me likha hai.

**Fix:** `routes/voucherClaims.js` me `module.exports.routePrefix = "/voucher-claims"` export karo — auto-mounter isko support karta hai (`routes/index.js:17`). Wahi `/disputes` par bhi.

> Aur `postman/lib/routeGates.js` `routePrefix` ko **ignore karta hai** — usko bhi thik karna padega, warna collection me galat path jayega.

### 9.2 `optionalAuth` pehle se maujood hai ✅

Maine naya banane ko likha tha. **Wo already hai aur preview route par already laga hua hai.** Banana nahi hai.

### 9.3 Settlement/refund/dispute ke endpoint paths kabhi likhe hi nahi gaye 🔴

Settlement doc me ~40 endpoints implied hain par **ek bhi path specified nahi hai.** Postman aur API docs uske bina ban hi nahi sakte. S1 shuru hone se pehle likhne honge.

### 9.4 302 redirect ka koi sanctioned raasta nahi

`GET /transactions/invoice/:token` ko 302 bhejna hai, par repo ka rule hai `res.*` sirf `utils/response.js` me. **`sendRedirect()` `utils/response.js` me add karna padega** — warna ya rule tootega ya endpoint.

### 9.5 `buildTransactionFilter` admin listing ko hi rok deta hai

Maine `purpose` ko **required** likha tha. Par admin listing ko **saare purposes** chahiye. Fix: `purpose` optional ho par **explicitly pass karna pade** — `{ purpose: null }` matlab "sab, jaanbujh kar".

### 9.6 SUB_VENDOR ke paas `brandId` hai hi nahi

`middlewares/authenticate.js` CUSTOMER par `customerId` aur VENDOR par `brandId` set karta hai — **SUB_VENDOR par kuch nahi.** Outlet verify screen aur claim access check dono iske bina kaam nahi karenge. `authenticate.js` me SUB_VENDOR branch chahiye (`subBrandId` + parent `brandId`), aur ek `isVendorOrSubVendor` gate (aaj hai hi nahi).

### 9.7 `generateUniqueInvoiceId` dead code ban jaata hai ✅ **ho gaya (M5)**

Naya Counter-based helper aane par purana kahin use nahi hota. File delete ho gayi aur barrel se hat gayi — repo me ab uska ek hi zikr bacha hai, `generateInvoiceNumber.js` ke comment me, jo batata hai kis cheez ki jagah ye aaya.

### 9.8 `Notification` model me `customerId` column hai hi nahi

`notify()` ko `customerId` sikhana kaafi nahi — model me field bhi chahiye, warna customer notifications sirf `userId` par tikengi.

### 9.9 `resumeIncompleteSettlements` pehli baar chalte hi poori subscription history sweep kar dega

Purani saari transactions me `settlementStage` hai hi nahi (`!= "COMPLETE"` sab par sach hai). **Job ko `purpose: VOUCHER_CLAIM` aur `settlementStage: { $exists: true }` dono se scope karna hoga.**

### 9.10 Postman ka example capture secrets commit kar dega

`lib/capture-examples.js` response bodies ko jaisa hai waisa save karta hai — usme `invoiceToken`, `statementToken`, UTR, account last-4 sab aa jayenge, aur wo **git me** chala jayega. Redaction pehle chahiye.

### 9.11 Do assertions Phase 1A ke din se fail karengi

`postman/generate-customer-collection.js` me chaar saved preview examples hain jo `promoDiscount: 0` assert karte hain. 1A ke din wo galat ho jaayenge.

### 9.12 `.env.example` repo me hai hi nahi ✅ **ban gaya (M12)**

Naye env vars declare karne ki koi jagah nahi thi. `.env.example` ab repo me hai — 67 key, sirf naam aur shape, koi value nahi. `.env` gitignored hai aur rahega.

Verify kiya: `.env` ki har key template me maujood hai, aur template me koi asli value nahi gayi.

---

## 10. Faisle — tay ho chuke ✅

| # | Sawaal | Faisla |
|---:|---|---|
| **1** | Gateway-fee fields kahan? | **Transaction par, top-level.** `models/pricingSchema.js` `Subscribed` ke saath shared hai — usme daalne se blast radius bekaar me bada hota. Fields: `gatewayFee`, `gatewayFeeBearer`, `vendorGatewayFee`, `netReceived` |
| **2** | SUBSCRIPTION transactions bhi ledger me? | **Nahi.** Ledger sirf `purpose: VOUCHER_CLAIM` par. `recordLedgerEntry()` khud purpose check karega. Subscriptions ka ledger baad me backfill ho sakta hai — abhi karne se 1B ka scope do guna ho jaata |
| **3** | Purane docs | `CUSTOMER_API_DOC.md` **delete** (2026-08-30). `API_DOCUMENTATION.md` **jaisa hai waisa** — chhua nahi jayega |

> **Note:** dono purane docs asal me *Romani Dating App* ke reference docs the (PostgreSQL + Prisma + ES Modules) — Trydood ke superseded docs nahi. `endpoints_category.md:688` me ye pehle se likha tha.

---

## 10.5 ⚠️ Gap-hunt me mile 13 aur — Phase 1A (aur uske upstream) ke corrections

Manifest ke baad ek adversarial gap-hunt chala (sirf 1A par pura ho paya — baaki 6 session limit se ruk gaye, wo implementation ke waqt haath se verify honge). Usne 13 asli gaps nikale, 3 blockers. **Sab codebase se milakar dekhe gaye.**

### Blockers

| # | Kya | Fix |
|---:|---|---|
| **G1** | **`req.customerId` ek populated Customer document hai, ObjectId nahi.** `middlewares/authenticate.js:82` set karta hai aur `services/users/getUserById.js:8-11` use **populate** karta hai. `String(actor.customerId)`, response me echo, ya aggregation `$expr` — teeno chup-chaap galat chalenge | Har jagah `._id` normalise karo. Ek helper — `resolveCustomerId(actor)`. Aur populate `-isDeleted` select karta hai, to §7 case 7 (customer deleted) ke liye alag Customer read chahiye |
| **G2** | **Seed fixtures 1A ke din se toot jayenge.** `models/Brand.js:161` `isApproved` default `false`, aur `scripts/seedPostmanFixtures.js:208-222` use kabhi set nahi karta. `Subscribed.create` sirf ek baar (line 554), hard-wired `brands[0]` par | Seed me `isApproved: true` + har brand ko `Subscribed`. Warna har seeded preview `canClaim: false` dega aur regenerated collection "blocked" ko hi happy path bana degi |
| **G3** | **Doosra Postman generator bhi hai.** `generate-security-collection.js` me apne preview examples hain purane shape ke (lines ~1429, ~1481). Aur **dono committed collections aapas me virodh karte hain**: security wala `billAmount ≤ 0` par **400** pin karta hai, customer wala **422** | Dono regenerate. Aur 400-vs-422 ka ek jawab: **422** — Joi (`validateCustomerVoucherPreview` `.positive()`) pehle chalta hai, to `calculateVoucherOffer` ka 400 branch API se reachable hi nahi |

### Important

| # | Kya | Fix |
|---:|---|---|
| **G4** | `commissionPercent` `voucherPricingSchema` me hai hi nahi — settlement §12.6 saaf kehta hai isko **abhi** freeze karo | `voucher.commissionPercent` (abhi `0`) schema me. Field abhi na daali to on karne wale din retroactively kaat legi |
| **G5** | **Poora GST split block gayab** — `taxType, cgst, sgst, igst, hsnSacCode, placeOfSupplyStateCode, placeOfSupplyState, currency`. `buildOrderSummary.js` ka `buildTaxRows()` pura `pricing.taxType` par branch karta hai | `voucherPricingSchema` me `pricingSchema` wala hi tax block. GST off par `taxType: null` — tab tax rows print hi nahi hoti |
| **G6** | **B2C convenience fee ka place-of-supply kabhi tay hi nahi hua** | GST off hai to abhi asar nahi. On karte waqt: **outlet ka state** (service wahin consume hoti hai). CA se confirm — settlement doc §2.5 |
| **G7** | Customer ke liye koi `currency` / `currencySymbol` source nahi. `formatMoney` uspar tika hai, `getCustomerConfig()` deta hi nahi | `constants/customer.js` me `currency: "INR"`, `currencySymbol: "₹"` + `getCustomerConfig()` project kare. Warna ya magic string (Never list) ya vendor config customer path me |
| **G8** | `promoCode.isEnabled` default **`false`** aur koi use likhta nahi → fresh DB par har promo `DISABLED` | *Tab ka prastaav:* `scripts/setCustomerConfig.js` — `setSubscriptionConfig.js` ka hi pattern. ⚠️ **Wo script bani nahi** — neeche G8 ka nateeja dekho; default hi sahi kar diya gaya |
| **G9** | `costBearing` ka rule Joi me nahi reh sakta. `services/promoCodes/createPromoCode.js` ka `assertCoherent()` is repo ka established ghar hai, aur `updatePromoCode.js:11` use merged doc ke saath call karta hai | Rule `assertCoherent` me. PATCH `{ costBearing: { mode: "VENDOR" } }` par Joi ko stored `brandIds` dikhte hi nahi — rule pass ho jaata aur unscoped vendor-borne code live ho jaata |
| **G10** | Promo report / listing audience-aware nahi. `getPromoCodeReport.js:45` `match = {}`, aur `:159`/`:198` `brandId` par group karta hai | `audience` filter + `{ audience, createdAt }` index. `brandId` optional hote hi har customer row **ek null bucket** me gir jaati |
| **G11** | `createSubscribeOrder.js` promo verdict shape ka **doosra consumer** hai (lines 151, 166, 171, 204) — live vendor money path | M3 ke review scope me. Edit nahi chahiye, par shape regression yahin galat charge ya orphan reservation banti hai |

### Nice

| # | Kya |
|---:|---|
| **G12** | `assertSettlementTimingRule(merged.customer)` ka hook point — `updateSetting.js` ki wahi merge branch jo M8 likh raha hai. Abhi inert hai, par baad me retrofit matlab wahi function dobara chhoona |
| **G13** | `previewCustomerVoucher.js:56` `status: "PUBLISHED"` magic string use karta hai jabki `VOUCHER_STATUSES` maujood hai. Rewrite me `buildClaimPreview` me mat le jaana — naye code me violation plant karna hoga |

> **Bache hue 6 phase groups ka gap-hunt nahi chala.** Wo implementation ke waqt haath se hoga — har module par asli file kholkar. Wahi asli verification hai: code jhooth nahi bolta.

### ✅ Teraah me se teraah band — code se milaaye hue

| # | Haalat | Kahan |
|---:|:-:|---|
| G1 | ✅ | `helpers/customers/resolveCustomerId.js` |
| G2 | ✅ | `scripts/seedPostmanFixtures.js` — `isApproved` set hota hai, har brand ko `Subscribed` milta hai |
| G3 | ✅ | Dono collections **422** par sehmat |
| G4 | ✅ | `models/voucherPricingSchema.js` — `commissionPercent` |
| G5 | ✅ | Wahi file — poora GST block (`taxType`, `cgst`, `sgst`, `igst`, `hsnSacCode`, `placeOfSupply*`, `currency`) |
| G6 | ⏳ | **Faisla baaki** — B2C fee ka place-of-supply. GST abhi off hai to asar nahi; on karne se pehle CA se confirm |
| G7 | ✅ | `constants/customer.js` — `currency` + `currencySymbol` |
| G8 | ⚠️ **badal kar** | `setCustomerConfig.js` script **nahi** bani. Uski jagah defaults seedhe `constants/customer.js:41,44` me (`isEnabled: true`, `maxFee: 50`) — script chalana **yaad rakhna padta**, default apne aap sahi hota hai |
| G9 | ✅ | `services/promoCodes/createPromoCode.js` — `assertCoherent` me |
| G10 | ✅ | `buildAudienceFilter` |
| G11 | ✅ | `createSubscribeOrder` review me raha, shape nahi toota |
| G12 | ✅ | `services/settings/updateSetting.js` — `assertSettlementTimingRule` wired |
| G13 | ✅ | Koi `"PUBLISHED"` magic string nahi |

⚠️ **G8 ka sabak alag hai:** ek "config set karne wali script" aur ek "sahi default" me
farak ye hai ki script chalana bhoola ja sakta hai. Fresh DB par har promo `DISABLED`
milna — jo asli dar tha — ab ho hi nahi sakta, kyunki koi step chhootne ko hi nahi hai.

---

## 10.6 ⚠️ Aakhri pass — S3 poora karte waqt jo mila

S3-4/5/7/9 banate waqt ek **mechanical sweep** bhi chalaya: `getCustomerConfig()` ke
**66 config fields** me se har ek ko poore repo me grep karke dekha ki koi padhta bhi
hai ya nahi, aur 8 known systemic traps poore codebase par dobara chalaye.

### Jo mile — aur teeno ek hi shakl ke the

| # | Kya | Kya toota tha | Kahan |
|---:|---|---|---|
| **A1** | **`$ne: ["$x", null]` aggregation *expression* me** | Query **filter** me missing aur `null` ek jaise hain; **expression** me nahi. `settlementId` tab tak likha hi nahi jaata jab tak settlement claim na kare, yani **absent** hota hai — to `vendorWasPaid` har **kabhi settle na hui** payment par `true` aa raha tha. Theek ulta, aur wahi ek field hai jispar admin tay karta hai ki vendor se kuch vasoolna bhi hai | `services/transactions/getDisputes.js` |
| **A2** | Wahi bug, doosri jagah | `validTill` optional hai, to hamesha chalne wale promo code par wo **absent** hota hai. `$ne` `true` deta hai aur `$lt: [missing, now]` bhi `true` (missing har date se neeche sort hoti hai) — yani **har perpetual promo code `isExpired` dikhta tha** | `services/promoCodes/getAllPromoCodes.js` |
| **A3** | **`pagination` bina `allowEmpty`** | Zero disputes wale vendor ko 404 *"No any dispute found"* milta. Saaf record error screen jaisa padhta hai — aur log wahi tab samajh lete hain ki Disputes tab toota hua hai, to kholna band kar dete hain. Wahi tab jise us hafte kholna zaroori hai jab usme kuch aaye | `services/transactions/getDisputes.js` |
| **A4** | **`settlement.requiresAdminApproval` koi padhta hi nahi tha** | `constants/customer.js` me, `Setting` schema me, `getCustomerConfig` me, `validator/settings.js` me — aur uska apna comment kehta hai *"turning this off auto-approves"*. Admin band karta to **kuch nahi hota, bina error ke**. Saatvin field jo dono taraf wired thi | `services/settlements/buildSettlements.js` §3.0 |
| **A5** | **`sendQuietly(promise)`** | Wo **function** leta hai aur use apne try/catch ke **andar** bulata hai. Already-invoked promise dene par notice to chali jaati hai, par guard ke bahar bani hoti hai — delivery fail hone par unhandled rejection, aur Node 24 me wo job runner le doobta. ⚠️ Mocked `notify` dono tarah call record karta hai, **to test isse pakadta hi nahi** — assertion `console.error` par lagani padti hai | `services/settlements/settlementJobs.js` |

⚠️ **A1/A2 aur A4/A5 ek hi seekh ke do roop hain:** jo cheez *lagti* hai ki kaam kar rahi
hai. `$ne` sahi likha dikhta hai, `sendQuietly` sahi bulaya dikhta hai, config field
sahi wired dikhti hai — aur teeno chup rehte hain. Isliye teeno ab CLAUDE.md ki
**Never** list me hain, apne asli natije ke saath.

### Jo saaf nikla — aur ye bhi natija hai

| Sweep | Natija |
|---|---|
| 66 config fields | **Ek bhi aisa nahi jise koi na padhta ho.** Do sirf `validator/settings.js` me the: `requiresAdminApproval` (bug, ab fix) aur `claim.redemptionWindowHours` (**sahi hai** — Phase 2 `OUTLET_SCAN` ka hai; aaj counter par pay karna hi redemption hai, to window hai hi nahi) |
| `$in` in `partialFilterExpression` | Ek bhi nahi — saare hits warning comments hain |
| Seedha `LedgerEntry.create` | Ek bhi nahi |
| Pipeline update bina `updatePipeline: true` | Chaaron jagah maujood |
| `Transaction` query bina `buildTransactionFilter` | 7 files, par har ek `_id`/`settlementId`/`subscriptionId` par — jo dono purpose me ho hi nahi sakta |
| Hardcoded Razorpay account | Ek bhi nahi |
| Require cycles | Jo mila wo `getPaymentHealth` ka **lazy** require hai — wahi documented fix hai |
| Doc me cite kiye gaye file:line | **Ek bhi line number file ke end ke baad nahi.** 3 stale filename mile, teeno **plan** docs me proposal the (cheez bani, dusri jagah) |

---

## 10.7 🔴 `invoiceId_1` — jad, aur kyun wo wapas aata tha

Ye manifest me do baar "launch blocker" likha gaya. Ab jad mil gayi.

**Commit `59fd080`** me tha:

```js
invoiceId: { type: String, unique: true },
```

Path-level `unique: true` se Mongoose ka banaya index ka naam theek `invoiceId_1` hota
hai — **na sparse, na partial**. Mongo missing field ko `null` maankar index karta hai,
to nullable path par blanket unique **doosre** document ko reject karta hai jiske paas
value nahi. Har voucher claim apne invoice se **pehle** banta hai, yani production me
**lagbhag har doosra claim fail**, aur error me wo field jise customer ne chhua bhi
nahi. Kisi aur layer ko ye fault nahi lagta — validation error jaisa dikhta hai.

`3494bb8` ne use named partial se badal diya. **Aaj ka code ise banata hi nahi.** Phir
bhi cluster par do baar wapas aaya.

**Wajah:** *isi service ka purana build* abhi bhi usi database se juda hua chal raha
hai. Uske schema me us path par `unique: true` hai, aur Mongoose ka `autoIndex` **uske**
har restart par ise dobara bana deta hai. ⚠️ `MONGO_AUTO_INDEX=false` use rok bhi nahi
sakta — purane builds **bina kisi option ke** connect karte the, wo switch tab tha hi
nahi. Legacy `server/` folder isi tarah `razorpayOrderId_1` banata hai.

### Code ki taraf se ab band

`helpers/transactions/reapShadowIndexes.js` — boot par **aur har ghante**. Shadow ko
**shakl se** dhoondhta hai, list se nahi: koi bhi unique index jispar na partial filter
ho na sparse, aur usi collection me usi key par ek partial-unique maujood ho.

⚠️ Isse **28 partial-unique indexes** apne aap surakshit hain, jabki
`LEGACY_TRANSACTION_INDEXES` sirf do naam ginati thi — aur agle saal joda gaya field
usi din surakshit ho jaata hai jis din uska index declare hota hai.

Do **shart** ise surakshit banati hain, bharosa nahi:

1. Sirf wahi index hatta hai jo **pehle se supersede ho chuka** hai — ye shakl kabhi
   sahi hoti hi nahi, partial wala usi ko replace karne ke liye hai.
2. Partial replacement **gayab** ho to **kuch nahi hatta** — warna field par uniqueness
   hi nahi bachegi, jo asli samasya se bhi bura hai.

⚠️ Ye `assertMoneyIndexes` ka ek purana faisla palatta hai — *"nothing is changed
automatically"*. Tark sahi tha, natija nahi: jab koi hataata hi nahi, **purana build
default se jeet jaata hai**, aur jo wo jeetta hai wo aisa database hai jo aadhe claims
reject karta hai. Boot par console warning, jise production me koi padhta hi nahi,
bachaav nahi hai.

### ⚠️ Par asli jad-se-khatma code me hai hi nahi

Reaper production ko sahi rakhta hai; writer ko marta nahi. Har reap par admin ko
**CRITICAL alert** jaata hai — aur uska **timestamp hi lead hai**, kyunki reap hona
matlab wo writer usi ghante restart hua (`$currentOp`, jo use naam se bata deta, Atlas
shared tier par band hai).

```bash
node scripts/findIndexWriters.js   # shadows, connection count, aur asli kadam
```

Khatam karne ka kaam **operational** hai:

1. **Atlas → Network Access** — `0.0.0.0/0` hatao, sirf EC2 ka Elastic IP rakho
2. **Atlas → Database Access** — purane deployment ke user ko `readOnly`, ya delete
3. **Purana Render service** suspend/delete

Teeno me se koi ek bhi ise poori tarah khatam kar deta hai. Jo account likh nahi
sakta wo index bana hi nahi sakta.

---

## 10.8 ✅ Poore flow ka cross-verify — claim se dispute tak

Aakhri pass: har layer ko **code se ginkar** doc se milaya gaya, padhkar nahi.

| Sweep | Natija |
|---|---|
| 60 money endpoints (claim · settlement · refund · dispute · bank) | **Sab documented** — ek bhi aisa nahi jo kisi doc me na ho |
| 21 background jobs | Sab registered aur doc me |
| 63 notification types | Do aise jinhe **koi bhejta nahi** — neeche |
| Ledger entry types | Ek aisa jise **koi nahi likhta** — `REFUND`, hata diya gaya |
| Settlement / refund / payout / claim / dispute statuses | Har status ka nikalne ka raasta hai. Chaar terminal hain aur sahi hain |
| Doc me cite kiye gaye har `file.js:NNN` | Ek bhi line file ke end ke baad nahi |

### Jo mila

**1. 🔴 `customer_voucher_claim_plan.md` ki endpoint table me nau path jo bane hi nahi.**

`/transactions/customer/get-all`, `/voucher-claims/vendor/get-all`,
`/voucher-claims/verify/:claimCode` — ye Phase 1 ke *prastaav* the. Ban kuch aur, kyunki
teen role-wise endpoints ki jagah **ek endpoint, teen shapes** chuna gaya. Doc us badlav
ke saath nahi chali, aur jo panel us table se banta use **nau 404** milte. Table ab code
se nikali gayi hai.

⚠️ Ye is poore audit ka sabse mehnga drift tha, aur wo isliye ki wo **plan** doc me tha —
jise log design padhne aate hain, par jo lagta reference jaisa hai.

**2. `LEDGER_ENTRY_TYPE.REFUND` — declared, rules table me nahi, kabhi kisi ne nahi
likha.**

Refund har row usi entry type ke tehat bookta hai jise wo ulat raha hai, ulti disha me —
tabhi type se grouped report apne aap net hoti hai (`refund_flow.md` §5.4). Ek sapaat
`REFUND` row wo netting tod deti: promo cost dikhta jo kabhi ghata hi nahi.

Chup-chaap istemaal to nahi ho sakta tha — bina rule ke `recordLedgerEntry` account maangta
hai — par jo `account` aur `direction` haath se de deta, use ek aisi row milti jo post bhi
hoti, balance bhi hoti, aur us din se har type-grouped report chup-chaap todti. **18 live
rows me se ek bhi nahi tha, kisi commit ne kabhi nahi likha** — to hata diya gaya, aur
uski **gair-maujoodgi ki wajah** wahin likh di gayi.

⚠️ Ek test isi type se ye sabit kar raha tha ki "kuch types ek hi transaction par dobara
aa sakti hain" — aur wo theek wahi misuse tha. Ab wo chargeback se sabit hota hai, jo
asli wajah se dobara aata hai: ek payment disputed, phir pre-arbitration — do dispute, do
id.

**3. Phase 2 ke chhah placeholders bikhre hue the.**

`VOUCHER_CLAIM_STATUS.PAID` par rukna, `EXPIRED`, `CLAIM_REDEMPTION_MODE.OUTLET_SCAN`,
`claim.redemptionWindowHours`, `VOUCHER_CLAIM_EXPIRED` notice, aur ek index — chhah sire,
**ek hi switch**. Har audit inhe naye gap jaisa padhta tha. Ab ek jagah:
`customer_voucher_claim_plan.md` §10.0, is chetavani ke saath ki inme se **ek** bana dena
sabse bura nateeja hai — ek window jo napi jaaye par kuch expire na kare.

**4. Do notification types jinhe koi nahi bhejta** — `LIMIT_REACHED` aur
`BRAND_SUBSCRIPTION_LAPSED`. Dono **subscription domain** ke hain, money flow ke nahi.
Nahi banaye gaye: jo notice kisi ne maangi nahi, use bana dena scope badhana hai, aur
`SUBSCRIPTION_EXPIRED` pehle se jaati hai. Yahan darj hain taaki agla audit inhe dobara
na khode.

---

## 11. Har phase ki definition of done

Ek phase tabhi poora hai jab:

1. ✅ Code — saare modules, barrels update
2. ✅ Money tests — us phase ke concurrency cases pass
3. ✅ API doc — sambandhit panel doc me poora section (request, response, saare error cases)
4. ✅ Postman — generator me entries, **har case** (success + har error) **saved example ke saath**
5. ✅ `endpoints_category.md` — naye endpoints census me
6. ✅ Boot clean — koi index warning nahi, `logPaymentAccounts()` sahi dikhaye

### Scorecard — kaun sa phase sach me poora hai

| Phase | Code | Tests | API doc | Postman | Census | Boot | Poora? |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **0** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **1A** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **1B** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **1C** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **S1** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **S2** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **S3** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ⏳ Postman |

⚠️ **Boot ab har phase par ✅ hai.** Pehle wo ⚠️ tha aur ek hi wajah se — legacy index ka
wapas aana. Wo kisi phase ki galti nahi thi; wo doosra writer tha, aur ab uski jad bhi
mil gayi aur code ki taraf se band bhi ho gaya: `reapShadowIndexes` boot par aur har
ghante hata deta hai (§10.7). Jo bacha wo **operational** hai — Atlas Network Access ko
seemit karna — aur wo kisi phase ko rokta nahi.

### Aage kya — kram me

| # | Kya | Kyun pehle | Haalat |
|---:|---|---|---|
| 1 | **Doosra writer band karo** | Iske bina production me har doosra claim reject hoga | ⏳ **code ki taraf se band** — `reapShadowIndexes` boot par aur har ghante hataata hai, har baar admin ko CRITICAL alert. **Bacha sirf operational**: Atlas Network Access seemit karna (§10.7) |
| 2 | ~~S3-6 `disputeDeadlines` job~~ | Deadline nikalna matlab apne aap haar | ✅ **ban gaya** |
| 3 | ~~Commission ka poora raasta~~ | `0` har galti chhupa deta hai | ✅ **ban gaya** (§7.6) |
| 4 | ~~S1-4 `CustomerBankAccount` + `MANUAL_BANK`~~ | Jiska card band hai uska paisa | ✅ **ban gaya** |
| 5 | ~~Per-account rate limits (OTP)~~ | IP wala limiter CGNAT ki wajah se dheela hai | ✅ **ban gaya** (§7.7) |
| 6 | ~~`AWAITING_BANK_DETAILS` reminder job~~ | Har doosra khula state kisi job ki nazar me hai, ye nahi tha | ✅ **ban gaya** (§7.8) |
| 7 | ~~S2-5 statement PDF~~ | Vendor ko dene layak kaagaz | ✅ **ban gaya** |
| 8 | ~~Reserve wapas dena~~ | On karte hi paisa andar jaakar bahar nahi aata tha | ✅ **ban gaya** (§7.9) |
| 9 | ~~Baaki S3 — dispute model, evidence pack, `/disputes` domain, receivables, risk-based rate~~ | Sab ban gaya | ✅ **ban gaya** (§7 S3 table · §10.6) |
| 10 | **Postman** — dispute folder + `trydood-money` collection | Aakhri bacha hua module. ⚠️ **Jaan-boojh kar rok rakha hai**: generator dobara chalane par captured examples mit jaate hain — pichhli baar **15,499 lines**, aur command phir bhi success bolta hai. Isliye ye append-only tareeke se, alag se karna hai | 🟡 khula |
| 11 | `BrandSettlementConfig` — per-brand `delayDays` / `minPayoutAmount` | ⚪ **Jaan-boojh kar nahi bana.** Aaj koi brand alag T+N nahi maangta, aur aisa model banana jise koi padhta na ho sirf bhram deta hai. Jis din ek brand ko alag chahiye, tab | ⚪ tay |
