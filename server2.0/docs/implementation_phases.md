# Implementation Phases — Build Manifest

> **Design docs:** [customer_voucher_claim_plan.md](./customer_voucher_claim_plan.md) · [vendor_settlement_plan.md](./vendor_settlement_plan.md)
> **Ye doc:** kis phase me kya banega — module-wise, file-level.
> Har module ek coherent unit hai jo ek baar me banta aur review hota hai.

---

## 0. Ek nazar me

| Phase | Kya ship hota hai | Modules | Customer feature ke bina chalega? |
|---|---|---:|---|
| **0** ✅ | Foundation, teen bugs, dono Razorpay accounts | 12 | ✅ **ho gaya** |
| **1A** ✅ | Preview — promo + poora pricing | 12 | — |
| **1B** ✅ | Payment — claim, usage, invoice, notify, **ledger** | 10 | — |
| **1C** | Read APIs — history, detail, invoice link, health | 10 | — |
| **S1** | Refunds — SOURCE + fallback, customer bank | 6 | — |
| **S2** | Settlement — cycle, payout, statement, vendor screens | 6 | — |
| **S3** | Chargebacks — hold, evidence, reserve, receivables | 11 | — |
| **Docs+Postman** | Har phase ke saath chalta hai, alag phase nahi | 12 | — |

**Har phase ki definition of done me shaamil hai:** code · money tests · API doc · Postman collection (saare cases + saved examples) · `endpoints_category.md` entry.

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

| # | Module | Kya |
|---|---|---|
| **1C-A** | Access control | `assertTransactionAccess` + claim twin, SUB_VENDOR identity |
| **1C-B** | Shared read scaffolding | Filters, pipelines, per-role projections |
| **1C-C** | Transaction listings | Customer / vendor / admin |
| **1C-D** | Transaction detail | Notification ka landing page — ek endpoint, teen shapes |
| **1C-E** | Claim listings | Customer / vendor / admin |
| **1C-F** | Claim detail + timeline | Append-only history dikhta hua |
| **1C-G** | Outlet verify surface | `verify/:claimCode` — counter par |
| **1C-H** | Invoice token redirect | Public 302 + lazy PDF + customer re-issue |
| **1C-I** | Admin payment health | "Abhi kuch atka hua hai?" |
| **1C-J** | Docs + Postman + tests | 11 naye endpoints |

---

## 5. Phase S1 — Refunds

| # | Module | Kya |
|---|---|---|
| **S1-1** | Money-out models | `RefundRequest`, `PayoutLeg`, `CustomerBankAccount`, constants, Transaction reshape |
| **S1-2** | Refund + settlement settings | Sub-schemas, validator, merge, **`assertSettlementTimingRule` merged config par** |
| **S1-3** | Refund core helpers | Hold lifecycle, split rule, `applyRefundCompletion` |
| **S1-4** | Customer bank account | Penny-drop (apna cache, koi cross-brand check nahi), OTP-gated attach, frozen payee |
| **S1-5** | RefundRequest lifecycle API | Customer/vendor/admin surfaces, `escalateRefunds` job, notices |
| **S1-6** | Refund execution | `SOURCE` adapter, `MANUAL_BANK` fallback, webhook branch rewrite |

---

## 6. Phase S2 — Settlement

| # | Module | Kya |
|---|---|---|
| **S2-1** | Settlement models | `Settlement`, `SettlementHistory`, `BrandSettlementConfig` + resolver, transition map |
| **S2-2** | Claim/release engine | `claimTransactions`, `releaseSettlementClaims`, `transitionSettlement`, `sweepStaleSettlements` |
| **S2-3** | `buildSettlements` | Canonical IST period, receipt gate, totals, gateway fee |
| **S2-4** | Payout + admin API | Conditional approve, leg initiation, UTR confirm, `reconcilePayouts` |
| **S2-5** | Statement + vendor screens | Frozen snapshot, lazy PDF, per-leg UTR, 6 vendor screens |
| **S2-6** | Docs + Postman + tests | ~40 naye routes |

---

## 7. Phase S3 — Chargebacks

| # | Module | Kya |
|---|---|---|
| **S3-1** | `Dispute` model | Aaj dispute sirf Transaction par 10 denormalised fields hai |
| **S3-2** | Webhook dispute rewrite | **Monotonic `settlementHold` har event par** + settlement taint |
| **S3-3** | Chargeback ledger + adjustment lock | Double-recovery guard, reconcile invariants |
| **S3-4** | Evidence pack builder | `razorpayRefundId` citation, HIGH-LOSS-RISK flag |
| **S3-5** | Dispute API | `/disputes` domain — worklist, detail, hold release |
| **S3-6** | `disputeDeadlines` job | Roz reminder — deadline nikalna matlab apne aap haar |
| **S3-7** | Risk-based reserve | Policy resolution + `RESERVE_HOLD` |
| **S3-8** | `releaseReserves` job | Matured holds chhodo |
| **S3-9** | Vendor receivables + write-off | 90-din wala |
| **S3-10** | Reserve + chargeback config | Schema, validator, resolver |
| **S3-11** | Docs + Postman + tests | |

---

## 8. Docs + Postman — har phase ke saath

**Alag phase nahi hai.** Har phase ki definition of done ka hissa hai.

| # | Module | Kya |
|---|---|---|
| **M1** | Postman shared lib fixes | `routeGates` multi-role, **secret redaction**, 302 handling, money assertions |
| **M2** | Naya `trydood-money` collection | Admin + webhook + cross-role surface jiska aaj koi ghar nahi |
| **M3** | Phase 0 folders + subscription retrofit | Do webhook routes, REJECTED cases, config surface |
| **M4** | Claim lifecycle folders | Preview → order → verify → settle → invoice, har §7 case |
| **M5** | Ledger/settlement/refund/dispute folders | Money-out ka aadha hissa |
| **M6** | Customer collection | Preview rewrite + claim/transaction/invoice |
| **M7** | Vendor collection | Claims, earnings, settlements, refund approvals |
| **M8** | Fixtures + live capture | `seedPostmanFixtures.js` me customer/promo/claim/ledger data |
| **M9–M11** | Teen panel API docs | customer_mobile / vendor_panel / super_admin |
| **M12** | `endpoints_category.md` + index hygiene | Endpoint census, counts, CLAUDE.md ki stale lines |

---

## 9. ⚠️ Manifest pass me mili galtiyaan — design me sudhaar

Ye cheezein design docs me galat ya adhoori thin. **Ab sahi hain.**

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
| **G8** | `promoCode.isEnabled` default **`false`** aur koi use likhta nahi → fresh DB par har promo `DISABLED` | `scripts/setCustomerConfig.js` — `setSubscriptionConfig.js` ka hi pattern (dry-run default, `--apply`). `maxFee: 50` bhi yahin se |
| **G9** | `costBearing` ka rule Joi me nahi reh sakta. `services/promoCodes/createPromoCode.js` ka `assertCoherent()` is repo ka established ghar hai, aur `updatePromoCode.js:11` use merged doc ke saath call karta hai | Rule `assertCoherent` me. PATCH `{ costBearing: { mode: "VENDOR" } }` par Joi ko stored `brandIds` dikhte hi nahi — rule pass ho jaata aur unscoped vendor-borne code live ho jaata |
| **G10** | Promo report / listing audience-aware nahi. `getPromoCodeReport.js:45` `match = {}`, aur `:159`/`:198` `brandId` par group karta hai | `audience` filter + `{ audience, createdAt }` index. `brandId` optional hote hi har customer row **ek null bucket** me gir jaati |
| **G11** | `createSubscribeOrder.js` promo verdict shape ka **doosra consumer** hai (lines 151, 166, 171, 204) — live vendor money path | M3 ke review scope me. Edit nahi chahiye, par shape regression yahin galat charge ya orphan reservation banti hai |

### Nice

| # | Kya |
|---:|---|
| **G12** | `assertSettlementTimingRule(merged.customer)` ka hook point — `updateSetting.js` ki wahi merge branch jo M8 likh raha hai. Abhi inert hai, par baad me retrofit matlab wahi function dobara chhoona |
| **G13** | `previewCustomerVoucher.js:56` `status: "PUBLISHED"` magic string use karta hai jabki `VOUCHER_STATUSES` maujood hai. Rewrite me `buildClaimPreview` me mat le jaana — naye code me violation plant karna hoga |

> **Bache hue 6 phase groups ka gap-hunt nahi chala.** Wo implementation ke waqt haath se hoga — har module par asli file kholkar. Wahi asli verification hai: code jhooth nahi bolta.

---

## 11. Har phase ki definition of done

Ek phase tabhi poora hai jab:

1. ✅ Code — saare modules, barrels update
2. ✅ Money tests — us phase ke concurrency cases pass
3. ✅ API doc — sambandhit panel doc me poora section (request, response, saare error cases)
4. ✅ Postman — generator me entries, **har case** (success + har error) **saved example ke saath**
5. ✅ `endpoints_category.md` — naye endpoints census me
6. ✅ Boot clean — koi index warning nahi, `logPaymentAccounts()` sahi dikhaye
