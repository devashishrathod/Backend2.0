# Dead Code Audit — deletion candidates

**Kuch delete nahi hua** (LOCATION cleanup ko chhod kar, jo alag se ho chuka).
Ye list approval ke liye hai.

---

## 📌 DECISIONS aur EXECUTION LOG

| # | Item | Faisla | Status |
|---|---|---|---|
| A | `configs/firebaseServiceAccountKey.json` (live key) | Kuch nahi karna — sirf record | 🟡 chhoda |
| B | 4 poori dead files (`dbServices.js`, `twofactor.js`, `suite.log`, `money-audit-raw-findings.json`) | Rehne do — sirf mention | 🟡 chhoda |
| C1 | 18 dead exports / 8 helper files | Hatana | ✅ **done** |
| C2 | 15 dead exports / 12 service files *(uploads ke 3 rakhe)* | Hatana | ✅ **done** |
| C3 | `calculateDuration.js`, `calculateVoucherOffer.js` | Poori file hatana | ✅ **done** |
| D | 3 barrel keys (`resolveSettler` & co.) | Consumers already sahi — kuch nahi | ✅ verified |
| D | `isSubVendor` | Rehne do | 🟡 chhoda |
| D | `isVendorOrAdminEvenIfDeactivated` + `validateRolesEvenIfDeactivated` | Cascade ke saath hatana | ✅ **done** |
| E | 8 spent scripts | Rehne do | 🟡 chhoda |
| — | Barrel standardization — 28 safe switches | Karna | ✅ **done** |
| — | `CLAUDE.md` ka `dbServices` zikr | Stale — hatana | ✅ **done** |
| — | `postman/README.md` stale line | Theek karna | ✅ **done** |
| — | `docs/implementation_phases.md` stale commands | Theek karna | ✅ **done** |
| — | `nodemon` + `ngrok` → `devDependencies` | Karna | ✅ **done** |
| I1 | `PartnershipDeed.js`, `Legal.js` | Kuch nahi karna — sirf record | 🟡 chhoda |
| I2 | `validateStatementByToken` | Naye naam se `/documents/:token` par lagana | ✅ **done** |
| I3 | `PLATFORMS`, `SUBSCRIPTION_PLANS` | Hatana | ✅ **done** |
| I3 | `NODE_ENV` | Mat hatao — env work me theek hoga | 🟡 chhoda |
| I4 | 12 dead `constants/` exports | Hatana | ✅ **done** |
| I5 | `Transaction.isRemoved`, `isRefundRequested` | Hatana | ✅ **done** |
| I5 | `Transaction.vendorGatewayFee`, `chargebackRecoveredAt` | Future fields — chhod do | 🟢 chhoda |
| I5 | `VoucherVersion.archivedAt` + ARCHIVED feature | Implement karna | ✅ **done** |
| I5 | `VoucherVersion.attachedSubBrandsCount` | Field zinda karo, live count bhi rakho | ✅ **done** |

### Kya banaya / badla

| Naya | Kaam |
|---|---|
| `validator/documents.js` | `validateDocumentByToken` — 64-hex token shape, ab `routes/documents.js` par laga |
| `helpers/vouchers/syncAttachedSubBrandsCount.js` | Har `VoucherSubBrand` write ke baad count ko rows se recompute karta hai |

| Behaviour change | Kahan |
|---|---|
| Superseded version ab `ARCHIVED` + `archivedAt`, `EXPIRED` nahi | `services/vouchers/publishVoucher.js` |
| `expireVouchers` ab `ARCHIVED` ko bhi sweep karta hai aur `expiredAt` set karta hai | `services/vouchers/expireVouchers.js` |
| `ngrok` lazy require ke andar | `index.js` — `devDependencies` me hai, prod install me nahi hoga |

### ⚠️ Do cheezein jo saath me theek karni padin

1. **Orphan imports.** Exports hataane se 5 imports bekaar ho gaye —
   `NOTIFICATION_AUDIENCE`, `DOCUMENT_TITLE`, aur `buildSettlements.js` ke teen
   (`TRANSACTION_PURPOSE`, `PAYMENT_STATUS`, `buildTransactionFilter`). Aakhri
   teen **pehle se** dead the. `buildTransactionFilter` ka na hona pehle bug
   laga tha — par nahi hai: wo query `buildEligibilityFilter` se jaati hai, jo
   andar se `buildTransactionFilter` use karta hai.
2. **Duplicate requires.** Barrel switch ke baad 11 files me ek hi module do baar
   require ho raha tha. Sab merge kiye — sirf **top-level** wale, taaki koi
   deliberate lazy require na toote.

---

## ⏳ KHULE ITEMS — jaan-boojh kar nahi kiye

Do cheezein mili jo dead-code cleanup me **nahi** ki gayin, kyunki dono ka risk
baaki kaam se alag kism ka hai. Dono ka poora hisaab neeche.

---

### O-1 · `invoiceUrl` — ek naam, do bilkul alag cheezein

`helpers/notifications/panelLinks.js:279`

```js
const invoiceUrl = documentUrl;   // @deprecated alias
```

#### Kya hai

Is codebase me **`invoiceUrl` naam ki do cheezein** hain:

| | Kya | Kahan |
|---|---|---|
| **Function** | `invoiceUrl(token)` — `documentUrl` ka alias. `<PUBLIC_API_URL>/trydood/v1/documents/<token>` banata hai | `panelLinks.js:279` |
| **DB field** | `Transaction.invoiceUrl` — Cloudinary par cache kiye gaye PDF ka URL | `models/Transaction.js:216` |

Aur dono **ek hi object literal ki paas-paas lines par** baithe hain:

```js
// helpers/subscribeds/settleSubscriptionPayment.js:206-207
invoiceUrl: settled?.invoiceUrl || null,                 // ← DB FIELD
invoiceDownloadUrl: invoiceUrl(settled?.documentToken),  // ← FUNCTION
```

```js
// services/transactions/verifySubscribeTransaction.js:85-86
invoiceUrl: transaction.invoiceUrl || null,              // ← DB FIELD
invoiceDownloadUrl: invoiceUrl(transaction.documentToken), // ← FUNCTION
```

#### Use case — dono kis kaam aate hain

- **DB field** (`Transaction.invoiceUrl`) — PDF ek baar render hone ke baad uska
  storage URL yahan cache hota hai, taaki agli baar dobara render na karna pade.
  `services/documents/getDocumentByToken.js:38` isi field ka naam ek **string**
  me rakhta hai (`urlField: "invoiceUrl"`) aur wahin likhta hai.
- **Function** (`invoiceUrl(token)`) — customer/vendor ko dene wala **revocable
  public link**. Storage URL revoke nahi ho sakta, ye token wala ho sakta hai.
  Isliye API response me dono jaate hain: `invoiceUrl` (raw storage) aur
  `invoiceDownloadUrl` (token wala).

#### ~35 grep hits ka asli breakdown

| Kya | Kitne | Chhu sakte hain? |
|---|---|---|
| Function calls — `invoiceUrl(` | **9** | ✅ safe |
| Import lines | **10** | ✅ safe |
| **DB field / response key** | **11** | 🔴 **bilkul nahi** |
| Comments (dono ka zikr) | 5 | padh kar |

#### 🔴 Careless kiya to kya tootega

| Galti | Nateeja |
|---|---|
| Response key `invoiceUrl:` rename | Mobile app / panels ka field gayab — **chup-chaap** toota, koi error nahi |
| `transaction.invoiceUrl` rename | `undefined` padhega → cached PDF URL kho jaayega → **har download par PDF dobara render + Cloudinary upload** (paisa aur slowness) |
| `getDocumentByToken.js:38` ka `urlField: "invoiceUrl"` | Ye **string** hai, variable nahi — rename hua to document caching chup-chaap band ho jaayegi aur koi test nahi pakdega |

#### Karne ka faayda

- Naam ka takraav khatam — `invoiceUrl` ka matlab phir **sirf DB field**
- Ek `@deprecated` marker gaya
- **Behaviour me zero change** — dono literally ek hi function hain

> ⚠️ Alias ka apna comment thoda galat hai. Kehta hai *"Kept as an alias so a
> link already sent … resolves to the same place"* — par purane link isliye kaam
> karte hain ki **route wahi hai** (`GET /documents/:token`), function ke naam se
> koi lena-dena nahi. Comment khud aage maan leta hai: *"both produce the new
> route."* Yaani ye backward-compat nahi, sirf naam ki suvidha hai.

**Faisla baaki:** karna hai to **surgical** — sirf 9 calls + 10 imports.
Mechanical find-and-replace **nahi** chalega.

---

### O-2 · `{ endDate: 1, isExpired: 1 }` index — likha jaata hai, padha nahi

`models/Subscribed.js:110`

#### Kya hai

`Subscribed` par **8 indexes** hain. Do relevant:

```js
:110  { endDate: 1, isExpired: 1 }                       ← sawaal isi par
:116  { status: 1, endDate: 1, isDeleted: 1 }   // "Drives the expiry job's sweep"
```

Aur `services/subscribeds/expireSubscriptions.js:41-45` ka asli query:

```js
Subscribed.find({ status: ACTIVE, endDate: { $lte: cutoff }, isDeleted: false })
```

Ye query **`:116` se poori tarah serve hoti hai** — filter aur index ka order
bilkul match karta hai.

#### `:110` ka haal

- `isExpired` hissa **kisi query ko serve nahi karta** — verify kiya: zero
  `find` / `$match` / `countDocuments` uspar
- `endDate` prefix akele-endDate query serve kar sakta tha — par **char me se
  chaaron** query `status` bhi filter karti hain
  (`expireSubscriptions:43`, `sendExpiryReminders:41`,
  `getActiveSubscription:29,43`), to `:116` har haal me behtar hai
- **Nateeja: `:110` poori tarah redundant lagta hai**

#### Cost

Har `Subscribed` insert, aur `endDate`/`isExpired` chhoone wale har update par ye
index bhi likhna padta hai. Per-write chhota, par poora waste.

#### 🔴 Hataane me kya issue hai

| Risk | Detail |
|---|---|
| **Sirf schema se hatana kaafi nahi** | Live DB se index apne aap nahi jaata. Explicit `dropIndex` **naam se** chahiye, ek script me |
| **`syncIndexes()` kabhi nahi** | `CLAUDE.md`: *"It drops **every** index not in the current schema, including any added by hand or by another branch, and it names none of them on the way out"* |
| Koi query jo scan me nahi mili | Wo index-scan se collection-scan par gir jaayegi — **dheemi, par tooti nahi** |
| `reapShadowIndexes` confuse hoga? | **Nahi** — wo sirf *unique-without-partial* shape dhoondhta hai; ye plain compound index hai |

#### Kyun is cleanup me nahi kiya

Baaki poora kaam **sirf source code** chhoota hai — galat ho to `git checkout`
se wapas. Ye **live database state** badalta hai, jahan wapas jaana index dobara
build karna hai (bade collection par minute lagta hai, lock ke saath).

**Sifarish:** alag chhota task — schema line + `scripts/ensureIndexes.js` ke
pattern me drop-by-name step, **dry-run default** ke saath, jaisa baaki
migration scripts karte hain.

---

## ⚠️ Pehle: ye audit poora nahi hai

Audit ek 8-lens parallel sweep + adversarial verification ke roop me chalaya tha.
**Session limit lag gayi — 191 me se sirf 22 agents complete hue, 169 fail.**

Iska matlab:

| Lens | Status |
|---|---|
| helpers, services, exports, scripts, config-env-deps, artifacts | ✅ finder chala |
| controllers | ✅ chala — **0 candidates mile** (koi dead controller nahi) |
| **models / constants / validator** | ❌ agent fail — **baad me grep se dobara chalaya, §I** |

Adversarial verification ke 169 agents mar gaye, isliye **finders ke 48 candidates
maine khud grep se verify kiye** — har symbol ko poore repo me trace karke, apni
file aur apne barrel ko chhod kar. Neeche har row me wahi ginti hai.

✅ **Jo lens fail hua tha wo ab poora ho chuka hai** — `models/` (57),
`constants/` (29 + `constants.js`), `validator/` (37), sab grep se sweep kiye
gaye. Results **§I** me.

---

## ✅ VERIFICATION PASS — code se, doc se nahi

Har item par ek hi test lagaya: **symbol ka naam poore repo me** (har file type,
`__tests__` / `scripts` / `postman` / `.claude` / `.githooks` sab), apni file aur
apne barrel ko chhod kar. Jo bacha, wahi asli consumer.

| Group | Verdict |
|---|---|
| **C1** — 18 symbols / 8 files | ✅ **18/18 SAFE** — elsewhere = 0 |
| **C2** — 18 symbols / 13 files | ✅ 3 uploads *(aapne rehne diye)* · 12 SAFE · 3 sirf comment me |
| **C3** — 2 poori files | ✅ **dono SAFE** |
| **Constants** — 14 (NODE_ENV chhod kar) | ✅ **14/14 SAFE** — par ek naam-takraav mila |
| `isRefundRequested` | ✅ code me SAFE — ⚠️ postman examples stale honge |
| `isVendorOrAdminEvenIfDeactivated` | ⚠️ **dependency hai** — `routeGates.js` |
| Barrel standardization | ⚠️ **34 me se 6 par circular require banega** |
| 8 spent scripts | ✅ **verified superseded** |
| ARCHIVED feature | ✅ verified — enum + field + guard maujood, setter nahi |
| `attachedSubBrandsCount` | ✅ 5 write-points mile |
| `validateStatementByToken` | ✅ kahin use nahi, aur `/documents/:token` par validator hai hi nahi |

### V1 — C2 ke 3 symbols jo "ALIVE" dikhe (par nahi hain)

Grep ne inke naam bahar bhi dhoonde — par **teenon hits sirf prose/comment hain**,
koi `require` ya destructure nahi:

| Symbol | Kahan mila | Kaisi line |
|---|---|---|
| `paidTotal` | `__tests__/money/paySettlement.test.js:623` | `* payout recorded ₹800, \`paidTotal\` cleared…` — JSDoc |
| `freezeBankSnapshot` | `scripts/seedPostmanFixtures.js:634, 681` | `⚠️ Without this…` aur `// …reads Brand.BankId` — dono comment |
| `REFUNDABLE_CLAIM_STATUSES` | `helpers/voucherClaims/settleVoucherClaimPayment.js:348` | `* A stuck one still refunds: PAID is in…` — JSDoc |

Comment-lines nikaal kar dobara grep chalaya — **teenon ka result khaali**. Export
hataane par ye comments bhi sahi rahenge, kyunki wo **andar wale function** ki baat
kar rahe hain, export ki nahi.

### V2 — ⚠️ `SUBSCRIPTION_PLANS` par naam-takraav

Sadhaaran grep ne **12 hits** dikhaye — jinse lagta hai ye zinda hai. Par wo ek
**alag cheez** hai:

| Kahan | Kya hai |
|---|---|
| `constants.js:199` | `SUBSCRIPTION_PLANS: Object.freeze({...})` ← **ye dead hai** |
| `helpers/notifications/panelLinks.js:32` | `PANEL_PATHS.SUBSCRIPTION_PLANS: "subscription/plans"` ← **alag, zinda hai** |

Saare 12 hits `PANEL_PATHS.SUBSCRIPTION_PLANS` ke hain. `constants.js` waale ko
**kabhi `require(".../constants")` se destructure nahi kiya gaya** — ye alag se
verify kiya.

> Ye batata hai ki bare-name grep kaafi nahi hota. Isliye har constant ko
> destructure-pattern se bhi check kiya gaya.

### V3 — ⚠️ `isVendorOrAdminEvenIfDeactivated` ki asli dependency

Ye sirf `middlewares/` me nahi hai — **`postman/lib/routeGates.js` bhi ise jaanta
hai**, string ke roop me (lines 20, 29, 52-53). Aur wo file ek
**longest-prefix-first matcher** hai:

```js
// Longest first — `isVendorOrAdminEvenIfDeactivated` must match before
// `isVendorOrAdmin`, which must match before `isVendor`.
//
// ⚠️ Every gate `middlewares/index.js` exports has to appear here. One that is
// missing does not error — the route silently falls through to PUBLIC, which
// is the most dangerous wrong answer this file can give.
const GATES = [ "isVendorOrAdminEvenIfDeactivated", ... ];
```

Us comment me likha hai ki `isVendorOrSubVendor` aur `isBrandSideOrAdmin` pehle
missing the, jiski wajah se **4 outlet-facing routes khud ko PUBLIC document kar
rahe the**.

**Hataana technically SAFE hai** — verify kiya ki `routeGates.js` GATES list ko
`middlewares/index.js` se **programmatically check nahi karta**; wo ek haath se
maintain ki gayi list hai. To:

- middlewares se hataya, GATES me chhoda → **harmless** (ek entry jo kabhi match nahi karegi)
- GATES se hataya, middlewares me chhoda → 🔴 **khatarnak** (route khud ko PUBLIC batayega)

Yaani surakshit disha wahi hai jo hum kar rahe hain.

#### 🔴 Ek cascade bhi hai — do cheezein marengi, ek nahi

`isVendorOrAdminEvenIfDeactivated` **`validateRolesEvenIfDeactivated` factory ka
ekmatra consumer hai** (`middlewares/validateRoles.js:52`). Ise hataane par wo
factory bhi dead ho jaayegi.

```
validateRolesEvenIfDeactivated   (factory, middlewares/validateRoles.js:13)
        └── isVendorOrAdminEvenIfDeactivated   ← iska AKELA consumer
                    └── (koi route nahi)
```

⚠️ `verifyJwtTokenEvenIfDeactivated` **bilkul alag cheez hai aur zinda hai** —
`routes/auth.js`, `routes/deviceTokens.js`, `routes/notifications.js` teenon use
karte hain. Naam milta-julta hai, isliye confuse mat hona.

#### Poora removal — 7 jagah, 3 files

| # | File | Kya |
|---|---|---|
| 1 | `middlewares/validateRoles.js:51-55` | JSDoc + `const isVendorOrAdminEvenIfDeactivated = ...` |
| 2 | `middlewares/validateRoles.js:13` | `validateRolesEvenIfDeactivated` factory *(cascade)* |
| 3 | `middlewares/validateRoles.js` module.exports | 2 lines |
| 4 | `middlewares/index.js:19` | destructure line |
| 5 | `middlewares/index.js:53` | re-export line |
| 6 | `postman/lib/routeGates.js:29, 31` | GATES array ki 2 entries |
| 7 | `postman/lib/routeGates.js:20-21, 52-53` | "Longest first" comment + LABEL entry |

> **Faisla aapka.** Rakhne ka faayda: agar kal koi route deactivated vendor ko
> notifications ya support screen tak pahunchana chahe, to gate ready hai.
> Hataane ka faayda: 7 jagah se ek jhooth nikal jaayega — kyunki uska comment
> **abhi galat hai** (*"Notifications only"* likha hai, par `routes/notifications.js`
> `verifyJwtTokenEvenIfDeactivated` use karta hai).
>
> Agar hataana hai to **cascade ke saath** hatana — factory bhi, warna wo agli
> baar isi list me dobara aayegi.

### V4 — 🔴 Barrel standardization: 6 jagah circular require banega

Aapki baat sahi hai ki structure ek generic hona chahiye. Poora require-graph
banaya (850 modules) aur har bypass ko simulate karke dekha.

| | Kitne |
|---|---|
| **Internal imports** (ek hi folder ke andar, `./sibling`) | **662** — ye SAHI hain, inhe barrel se **nahi** karna (barrel khud unhe load karta hai → circular) |
| **Cross-domain bypass** (asli scope) | **34** |
| — safe to switch | **28** ✅ |
| — 🔴 **circular ban jaayega** | **6** ❌ |

**Wo 6 jo direct hi rehne chahiye:**

| Importer | Target barrel |
|---|---|
| `helpers/customers/customerStats.js` | `helpers/transactions` |
| `helpers/notifications/subscriptionNotices.js` | `helpers/subscribeds` |
| `helpers/promoCodes/assertPromoWindowAndCaps.js` | `helpers/subscribeds` |
| `helpers/promoCodes/validateCustomerPromoCode.js` | `helpers/subscribeds` |
| `helpers/transactions/buildInvoiceSnapshot.js` | `helpers/subscribeds` |
| 🔴 **`jobs/index.js`** | **`services/transactions`** |

> 🔴 **Aakhri wala theek wahi hai jo aapne poocha tha.** `jobs/index.js`
> `resumeIncompleteSettlements` ko `services/transactions/settlementJobs.js` se
> **seedha** isliye leta hai kyunki barrel se lene par **circular require ban
> jaata hai**. Wo jaan-boojh kar hai, laparwahi nahi.

**Pehle 3 export add karne padenge** — `helpers/notifications/index.js` abhi ye
export **nahi** karta: `formatDateTime`, `channelPreferences`, `audienceChannels`.
Baaki 13 targets barrel me pehle se hain (verify kiya).

#### Poori list — 34 cross-domain bypasses

🔴 **6 — CIRCULAR, direct hi rehne do:**

| Importer:line | Symbol | Abhi | Barrel |
|---|---|---|---|
| `helpers/notifications/subscriptionNotices.js:7` | `formatMoney` | `helpers/subscribeds/buildOrderSummary.js` | `helpers/subscribeds` |
| `helpers/promoCodes/assertPromoWindowAndCaps.js:5` | `round2` | `helpers/subscribeds/calculatePricing.js` | `helpers/subscribeds` |
| `helpers/promoCodes/validateCustomerPromoCode.js:13` | `round2` | `helpers/subscribeds/calculatePricing.js` | `helpers/subscribeds` |
| `helpers/transactions/buildInvoiceSnapshot.js:1` | `formatDuration`, `formatSubscriptionType` | `helpers/subscribeds/formatDuration.js` | `helpers/subscribeds` |
| `helpers/customers/customerStats.js:26` | `buildTransactionFilter` | `helpers/transactions/buildTransactionFilter.js` | `helpers/transactions` |
| **`jobs/index.js:18`** | **`resumeIncompleteSettlements`** | `services/transactions/settlementJobs.js` | `services/transactions` |

✅ **28 — SAFE to switch:**

| Importer:line | Symbol | Barrel |
|---|---|---|
| `helpers/notifications/brandStatusNotices.js:6` | `resolveBrandIdentity` | `helpers/brands` |
| `helpers/notifications/brandVerificationNotices.js:8` | `resolveBrandIdentity` | `helpers/brands` |
| `helpers/subBrands/releaseOutletSlot.js:1` | `releaseSlot` | `helpers/brands` |
| `helpers/subBrands/reserveOutletSlot.js:3` | `reserveSlot`, `bucketLabel` | `helpers/brands` |
| `helpers/subBrands/switchOutletType.js:1` | `switchSlot` | `helpers/brands` |
| `helpers/subscribeds/syncBrandSubscriptionState.js:5` | `applyPlanEntitlements` | `helpers/brands` |
| `helpers/disputes/buildEvidencePack.js:9` | `invoiceUrl` | `helpers/notifications` |
| `helpers/subscribeds/settleSubscriptionPayment.js:29` | `invoiceUrl` | `helpers/notifications` |
| `services/subscribeds/adminGrantSubscription.js:37` | `invoiceUrl` | `helpers/notifications` |
| `services/transactions/regenerateInvoice.js:17` | `invoiceUrl` | `helpers/notifications` |
| `services/transactions/verifySubscribeTransaction.js:3` | `invoiceUrl` | `helpers/notifications` |
| `services/voucherClaims/getClaimDetail.js:14` | `invoiceUrl` | `helpers/notifications` |
| `services/voucherClaims/getClaimTransactionDetail.js:13` | `invoiceUrl` | `helpers/notifications` |
| `services/deviceTokens/sendTestPush.js:3` | `resolveChannelPreferences` | `helpers/notifications` ⚠️ add |
| `services/notifications/notificationPreferences.js:9` | `describeChannelPreferences` | `helpers/notifications` ⚠️ add |
| `services/notifications/notificationPreferences.js:12` | `resolveAudienceChannels` | `helpers/notifications` ⚠️ add |
| `services/transactions/handleRazorpayWebhook.js:62` | `formatDateTime` | `helpers/notifications` ⚠️ add |
| `services/transactions/settlementJobs.js:10` | `formatDateTime` | `helpers/notifications` ⚠️ add |
| `services/voucherClaims/claimJobs.js:19` | `formatDateTime` | `helpers/notifications` ⚠️ add |
| `helpers/ledger/getVendorBalance.js:7` | `round2` | `helpers/subscribeds` |
| `helpers/ledger/recordLedgerEntry.js:9` | `round2` | `helpers/subscribeds` |
| `helpers/vouchers/buildVoucherOrderSummary.js:4` | `formatMoney`, `formatPercent` | `helpers/subscribeds` |
| `helpers/vouchers/calculateVoucherPricing.js:7` | `round2` | `helpers/subscribeds` |
| `helpers/promoCodes/validateCustomerPromoCode.js:14` | `buildTransactionFilter` | `helpers/transactions` |
| `services/transactions/indexJobs.js:1` | `reapShadowIndexes` | `helpers/transactions` |
| `services/voucherClaims/getClaimTransactions.js:4` | `buildClaimTransactionPipeline`, `buildClaimPipeline` | `helpers/transactions` |
| `helpers/vouchers/calculateVoucherPricing.js:8` | `calculateConvenienceFee` | `helpers/voucherOffers` |
| `services/auth/loginWithEmailOTP.js:3` | `sendOtp` | `services/otps` |

> ⚠️ **`validateCustomerPromoCode.js` do baar aata hai** — line 13 CIRCULAR hai
> (subscribeds), line 14 SAFE hai (transactions). Ek hi file me dono, isliye
> dhyan se: sirf line 14 badalni hai.
>
> ⚠️ **`calculateVoucherPricing.js` bhi do baar** — lines 7 aur 8, dono SAFE.

**Teen barrel keys jo aapne poochhe the — nateeja:**

| Key | Consumer | Kya karna |
|---|---|---|
| `resolveSettler` | `handleRazorpayWebhook.js` → `require("./webhookSettlers")` — **internal, same folder** | ✅ **Sahi hai, mat badlo** |
| `SETTLER_PURPOSES` | `handleRazorpayWebhook.js`, `getPaymentHealth.js` — **dono internal** | ✅ **Sahi hai, mat badlo** |
| `resumeIncompleteSettlements` | `jobs/index.js` — cross-domain, **par circular** | 🔴 **Direct hi rehne do** |

To teenon ke consumers **already sahi hain**. Barrel me unki entries rehne dein —
wo kisi ko nuksaan nahi karti.

### V5 — `isRefundRequested` hataane ka ek side-effect

Code me poori tarah safe — sirf `models/Transaction.js:380` par hai.

⚠️ **Par wo 2 captured Postman examples me chhapa hua hai:**

- `postman/trydood-admin.postman_collection.json:13174`
- `postman/trydood-vendor.postman_collection.json:11623`

Wo saved API responses hain jinme `"isRefundRequested": false` literally likha
hai, kyunki model me field thi. Field hataane par **wo examples purani ho
jaayengi** — code tootega nahi, aur `verifyApiCoverage` ise **pakadta bhi nahi**
(wo response body ke fields nahi dekhta).

Theek karne ka tarika: field hatane ke baad collections **re-capture** karna.

> Yahi baat `isRemoved` aur `vendorGatewayFee` par bhi lagu hai — teenon usi
> captured response me hain.

### V6 — `attachedSubBrandsCount` ko zinda karne ke 5 write-points

Aapne kaha: live count chalta rahe, **aur** field bhi inc/dec ho. Ye rahe wo saare
jagah jahan `VoucherSubBrand` rows bante/badalte hain:

| File:line | Operation |
|---|---|
| `services/vouchers/createVoucher.js:202` | `insertMany` — naya voucher |
| `services/vouchers/updateVoucher.js:394` | `insertMany` — forked version |
| `services/vouchers/updateVoucher.js:484` | `updateMany` — hataye gaye sub-brands |
| `services/vouchers/updateVoucher.js:508` | `insertMany` — naye sub-brands |
| `helpers/vouchers/validateVersions.js:114` | `insertMany` — version clone |

Live count yahan padha jaata hai (**ye chalta rahega**):
`helpers/vouchers/validate.js:196` aur `:267`.

### V7 — 8 scripts: superseded confirm

Har folder generator ki lib me maujood hai, aur generator use require karta hai:

| Folder | Lib file | Generator require |
|---|---|---|
| `claimsFolder` | `lib/customerMoneyFolders.js` ✅ · `lib/vendorMoneyFolders.js` ✅ | `generate-customer:47` · `generate-vendor:65` |
| `refundsFolder` | dono lib files ✅ | wahi |
| `settlementsFolder` | `lib/vendorMoneyFolders.js` ✅ | `generate-vendor:65` |
| `searchFolder` | `lib/customerSearchFolder.js` ✅ | `generate-customer:48` |

`findIndexCulprit.js` → `findIndexWriters.js` (naya, bada, saari collections).
`convertMongoUrlToDirect.js` → wo workaround jo `mongoDb.js` ne hataya aur
`package.json` ab `node >=24.19.0` maangta hai.

---

## 🔴 A. Sabse pehle — ye code nahi, security hai

### `configs/firebaseServiceAccountKey.json`

| | |
|---|---|
| Size | 2,392 bytes |
| Git | **untracked** (`.gitignore:47`) |
| Consumers | **shunya** |

`configs/fcm.js` ka apna header kehta hai *"Deliberately not using the
`firebase-admin` SDK"* — wo `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` /
`FCM_PRIVATE_KEY` env se padhta hai. `firebase-admin` `package.json` me hai hi
nahi. Poore repo me is file ka naam sirf `.gitignore` me aur `.claude/settings*.json`
ki permission-allowlist strings me hai — koi `require()` nahi.

🔴 **Par ye khaali file nahi hai — isme ek asli, chalu private key hai, aur wo
`.env` wali key se ALAG hai** (alag `private_key_id`). Yaani ek service account ke
do keys zinda hain, jinme se ek ko koi code use nahi karta aur wo ek gitignored
file me disk par padi hai.

> **File delete karna kaafi nahi hai.** Wo key Firebase console
> (Project settings → Service accounts) se **revoke** karni padegi. File hatane se
> key invalid nahi hoti — wo Google ke paas valid rehti hai.

**Recommend:** pehle console se revoke, phir file delete.

---

## 🟢 B. Poori files — koi consumer nahi

| # | File | Size | Git | Verification |
|---|---|---|---|---|
| B1 | `database/dbServices.js` | 53 lines | tracked | `grep -rn "dbServices"` poore repo me → **file ke bahar 0 hits**. `database/index.js` sirf `buildAggregateLookup` export karta hai, dbServices ko nahi. |
| B2 | `helpers/otps/twofactor.js` | 1,480 B | tracked | Chaaron exports (`sendOTP`, `verifyOTP`, `urlSendTestOtp`, `urlVerifyOtp`) → file ke bahar **0 hits**. Apne barrel (`helpers/otps/index.js`) me bhi nahi hai. |
| B3 | `suite.log` | 40,843 B | **untracked** | Purana jest output. `.gitignore` me `*.log` already hai. |
| B4 | `docs/money-audit-raw-findings.json` | 126,705 B | tracked | Koi file link nahi karti (0 hits). Andar **40 lines** deleted `server2.0/` folder ke paths par point karti hain. |

### B1 par ek note — CLAUDE.md jhooth bol raha hai

`CLAUDE.md` ka Directory Map kehta hai:

> `database/` — *Mongo connection, `dbServices`, `buildAggregateLookup`*

Par `dbServices` ke 7 generic CRUD wrappers (`createItem`, `findById`, `findOne`,
`findMany`, `updateOne`, `findOneAndUpdate`, `findByIdAndUpdate`) ko **koi nahi
bulata** — poora codebase Mongoose models se seedha baat karta hai. Naya dev
Directory Map padh kar sochega ki queries isse jaani chahiye.

> ⚠️ `database/` ke baaki teen bhai **zinda hain** — `mongoDb.js`,
> `buildAggregateLookup.js` (5+ consumers), `otpRepository.js` (3 consumers).
> Sirf `dbServices.js` dead hai.

### B2 ke saath ek dependency bhi jaayegi

`package.json` ka **`2factor`** package sirf `helpers/otps/twofactor.js` require
karta hai. Wo file gayi to dependency bhi dead. Live 2Factor integration
(`helpers/twoFactor/`) package use hi nahi karta — wo seedha HTTP call karta hai.

> Dono ek saath hatane hain. Pehle package hataya to file toot jaayegi.

---

## 🟡 C. Dead exports — file rehti hai, sirf export line jaati hai

Inme se har ek me: symbol apni file ke andar **use hota hai**, aur `exports.` line
+ barrel re-export ke alawa **kahin nahi**. Yaani function zinda hai, uska public
API dead hai.

### C1 — helpers/

| Symbol | File | Note |
|---|---|---|
| `cloneVoucherVersion` | `helpers/vouchers/validateVersions.js` | ~80 line async function, poore repo me naam **sirf apni definition par** |
| `validateObjectIds` | `helpers/vouchers/validate.js` | naam sirf definition line par |
| `BRAND_REVIEW_ADMIN_AUDIENCE` | `helpers/notifications/brandVerificationNotices.js` | one-line alias, apni file bhi nahi padhti |
| `mapRazorpayPayment` | `helpers/subscribeds/settleSubscriptionPayment.js` | alias; andar wala `mapPayment` zinda hai |
| `USAGE_COUNTERS` | `helpers/brands/recountBrandUsage.js` | alias of internal `COUNTERS` |
| `SETTLEMENT_DOCUMENT_TITLE` | `helpers/settlements/buildSettlementDocumentSnapshot.js` | alias; callers `DOCUMENT_TITLE` seedha padhte hain |
| `formatTime`, `TIME_ZONE`, `ABSENT` | `helpers/notifications/formatDateTime.js` | file **zinda hai** — `formatDateTime` / `formatDateRange` 3 notice files use karti hain. Sirf ye 3 exports dead. |
| 9 symbols: `FONT`, `COLOR`, `RIGHT`, `CONTENT_WIDTH`, `LABEL_WIDTH`, `VALUE_X`, `VALUE_WIDTH`, `ensureSpace`, `applyStyle` | `helpers/documents/layout.js` | Barrel inhe re-export karta hai par koi issuer import nahi karta. `renderDocument.js` sirf `row/field/paragraph/title/heading/divider/table/SIZE/LEFT/PAGE` leta hai. |

### C2 — services/

| Symbol | File |
|---|---|
| `uploadAudio`, `uploadVideo`, `deletePDF` | `services/uploads/index.js` |
| `countExpiringSoon` | `services/subscribeds/expireSubscriptions.js` |
| `presentHistory` | `services/settlements/getSettlements.js` |
| `liveBankSnapshot`, `paidTotal` | `services/settlements/paySettlement.js` |
| `freezeBankSnapshot` | `services/settlements/buildSettlements.js` |
| `describeFlows` | `services/transactions/settlementJobs.js` |
| `vendorDisputeProjection`, `adminDisputeProjection` | `services/transactions/getDisputes.js` |
| `MEDIA_PREVIEW_PER_SECTION` | `services/brands/getCustomerBrand.js` |
| `DOCUMENT_SOURCES` | `services/documents/getDocumentByToken.js` |
| `assertRefundAccess` | `services/refunds/getRefunds.js` |
| `VENDOR_CAN_DECIDE` | `services/refunds/decideRefund.js` |
| `ADMIN_CAN_DECIDE`, `OVERRIDE_FROM` | `services/refunds/executeRefund.js` |
| `REFUNDABLE_CLAIM_STATUSES` | `services/refunds/requestRefund.js` |

> ⚠️ **`paidTotal`, `REFUNDABLE_CLAIM_STATUSES` aur `freezeBankSnapshot`** ke naam
> repo me dikhte to hain — par sirf **comments** me (`paySettlement.test.js:623`,
> `settleVoucherClaimPayment.js:348`, `seedPostmanFixtures.js:634,681`). Koi
> import nahi. Export hataane par wo comments ab bhi sahi rahenge, kyunki wo
> internal function ki baat kar rahe hain.

### C3 — do files jo poori dead ho sakti hain

| File | Lines | Situation |
|---|---|---|
| `helpers/subscribeds/calculateDuration.js` | 36 | Iska ekmatra export `calculateDuration` sirf apni file + barrel me hai. Yaani **poori file dead** — sirf export nahi. |
| `helpers/voucherOffers/calculateVoucherOffer.js` | 174 | Wahi baat — ekmatra export barrel tak pahunch kar ruk jaata hai. Claim-pricing ab `helpers/vouchers/resolveClaimOffer.js` se hota hai. |

Ye C ki jagah B me jaate hain agar aap poori file hataana chahein.

---

## 🔵 D. Dead barrel keys — code zinda, sirf re-export bekaar

`services/transactions/index.js` teen cheezein re-export karta hai jo **kaam kar
rahi hain**, par har consumer unhe **seedhe source module se** leta hai:

| Barrel key | Asli consumers kahan se lete hain |
|---|---|
| `resolveSettler` | `require("./webhookSettlers")` — `handleRazorpayWebhook.js:69` |
| `SETTLER_PURPOSES` | `require("./webhookSettlers")` — `handleRazorpayWebhook.js:69`, `getPaymentHealth.js:47` |
| `resumeIncompleteSettlements` | `require(".../settlementJobs")` — `jobs/index.js` |

> 🔴 **Ye functions delete NAHI karne hain** — teenon money path ke core hain.
> Sirf `services/transactions/index.js` ki barrel entries hatani hain (ya rehne
> deni hain). Ye lowest-value change hai; agar chhodna chahein to bilkul theek.

Isi tarah do middleware **bane hain par kisi route par mount nahi hain**:

| Middleware | Situation |
|---|---|
| `middlewares/validateRoles.js :: isSubVendor` | Koi route use nahi karta. Sub-vendor routes `isVendorOrSubVendor` / `isBrandSideOrAdmin` use karte hain. |
| `middlewares/validateRoles.js :: isVendorOrAdminEvenIfDeactivated` | Apna doc comment kehta hai *"Notifications only"*, par `routes/notifications.js` `verifyJwtTokenEvenIfDeactivated` use karta hai. |

> ⚠️ Dono `postman/lib/routeGates.js` me **string ke roop me** darj hain (line 29,
> 38, 48, 52). Delete karne par wahan se bhi hatana padega. Kyunki ye auth gates
> hain aur bahut sasta hai inhe rakhna, main **keep** recommend karta hoon — par
> unka doc comment theek karna chahiye, kyunki abhi wo jhooth bol raha hai.

---

## 🟠 E. scripts/ — kaam ho chuka, par default KEEP

Aapne kaha tha "dikhao par default keep" — to ye list hai, delete nahi ki.

| Script | Kisne replace kiya |
|---|---|
| `addClaimRequestsToPostman.js` | `postman/lib/customerMoneyFolders.js` + `vendorMoneyFolders.js` (`claimsFolder`) |
| `addRefundRequestsToPostman.js` | dono lib files ka `refundsFolder` |
| `addSettlementRequestsToPostman.js` | `vendorMoneyFolders.js` ka `settlementsFolder` |
| `addSearchRequestsToPostman.js` | `postman/lib/customerSearchFolder.js` — jo apne header me isi script ka naam leta hai |
| `addLogoutRequestsToPostman.js` | `generate-customer-collection.js:293-334` dono logout requests khud banata hai |
| `fixPostmanClaimVariables.js` | generator ab wahi environment file dobara likhta hai jise ye patch karta tha |
| `findIndexCulprit.js` | `findIndexWriters.js` (naya: 3 Sep vs 31 Aug, 6.7 KB vs 2 KB, saari collections cover karta hai). Ye purana wala `dns.setServers` workaround bhi use karta hai jise `mongoDb.js` ne jaan-boojh kar hataya tha. |
| `convertMongoUrlToDirect.js` | Wahi `mongodb+srv` workaround automate karta hai jo Node 24.19 fix ke baad zaroori nahi. `package.json` ab `>=24.19.0` maangta hai. |

### 🔴 E ke saath do docs jhooth bol rahe hain

Ye **delete se alag** issue hai — ye theek karna chahiye chahe scripts rahein ya jaayein:

1. **`postman/README.md:106-109`** kehta hai:
   > *"…ab customer ke liye zaroori nahi hain — unka content generator me hai.
   > (Vendor ke liye wo abhi bhi use hote hain; **vendor generator port hona baaki
   > hai**.)"*

   **Wo port ho chuka hai.** `generate-vendor-collection.js:65` already
   `require("./lib/vendorMoneyFolders")` karta hai, jo `claimsFolder`,
   `refundsFolder`, `settlementsFolder` teenon export karta hai. README stale hai.

2. **`docs/implementation_phases.md:1037-1039`** aaj bhi ye commands chalane ko
   kehta hai:
   ```
   node scripts/addClaimRequestsToPostman.js
   node scripts/addRefundRequestsToPostman.js
   node scripts/addSettlementRequestsToPostman.js
   ```
   Inhe chalane se ab kuch nahi hoga (skip branch), par koi naya banda inhe
   collection workflow ka hissa samjhega.

---

## ⚪ F. Jo dead LAGTE the par ZINDA hain

Adversarial verification ne inhe refute kiya — **delete nahi karna**:

| Candidate | Kyun zinda hai |
|---|---|
| `package.json :: nodemon` | `npm run dev` use karta hai |
| `NGROK_SUBDOMAIN` | ngrok setup ka hissa |
| `services/transactions :: resolveSettler` & co. | function zinda, sirf barrel key bekaar (§D) |

> **Do packages galat jagah hain** (delete nahi, move karna hai):
> `nodemon` aur `ngrok` dono `dependencies` me hain, `devDependencies` me nahi.
> Production install me dono ship hote hain. `ngrok` to ek public tunnel library
> hai — production bundle me uska koi kaam nahi.

---

## G. Ginti

| Category | Kitne | Recommendation |
|---|---|---|
| A — security (live key) | 1 | **Revoke phir delete** |
| B — poori files | 4 | Delete (+ `2factor` dependency) |
| C1/C2 — dead exports | **36 symbols, 21 files** (C1: 18 / 8 files · C2: 18 / 13 files) | Delete export lines |
| C3 — poori file ban sakti hain | 2 | Aapka faisla |
| D — barrel keys + middlewares | 5 | **Keep recommend**, comment theek karein |
| E — spent scripts | 8 | **Keep (aapka faisla)**, par 2 docs theek karein |
| F — false positives | 3 | Chhodein; 2 packages `devDependencies` me shift karein |
| **I1** — dead models | **2** | Delete — `PartnershipDeed`, `Legal` |
| **I2** — dead validator | **1** | Delete — `validateStatementByToken` |
| **I3** — dead `constants.js` exports | **3** | `NODE_ENV` env-work ke saath theek karein |
| **I4** — dead `constants/` exports | **12** | Delete — 4 ek adhoore refactor ka nishaan hain |
| **I5** — kabhi na chhue gaye model fields | **6** | 4 delete; **2 money fields product ka faisla** |

**Kul: 74 items.** 2 ko action chahiye jo deletion nahi hai (Firebase key revoke,
2 money fields ka product decision).

---

## H. Delete karne ka safe order

Agar approve karein, to is kram me — har step ke baad verify:

```bash
node scripts/verifyImports.js      # 848 modules, har destructured naam check
node scripts/verifyApiCoverage.js  # 218/218 routes
npm test                           # money paths (~33 min, ek waqt me ek run)
```

| Step | Kya |
|---|---|
| 1 | Firebase key **revoke**, phir `configs/firebaseServiceAccountKey.json` delete |
| 2 | `suite.log`, `docs/money-audit-raw-findings.json` delete (koi code nahi chhoota) |
| 3 | `database/dbServices.js` delete + `CLAUDE.md` Directory Map se `dbServices` hataayein |
| 4 | `helpers/otps/twofactor.js` delete **aur** `package.json` se `2factor` ek hi commit me |
| 5 | Dead export lines (C1/C2) — har domain alag commit, beech me `verifyImports.js` |
| 6 | `postman/README.md` aur `docs/implementation_phases.md` ka stale hissa theek karein |
| 7 | `nodemon` + `ngrok` → `devDependencies` |

> Step 5 sabse zyada files chhoota hai par sabse kam risk wala hai —
> `verifyImports.js` har destructured naam check karta hai, to koi bhi galat
> deletion turant pakdi jaayegi.

---

## I. models / constants / validator — ye sweep ab chal chuka hai

Pehli baar ye lens session limit se fail hua tha. Ab **grep se, agents ke bina**
chalaya gaya — 57 models + 29 constants files + `constants.js` + 37 validators.

### I1 — Models: 2 poori tarah dead

| Model | Lines | Situation |
|---|---|---|
| `models/PartnershipDeed.js` | 14 | Poore repo me **ek bhi reference nahi** |
| `models/Legal.js` | 14 | Poore repo me **ek bhi reference nahi** |

Dono ka schema **bilkul ek jaisa** hai — `title`, `type`, `description`,
`isActive`, `isDeleted`. Ye `Privacy&Policy` / `Terms&Condition` ka ek adhoora
generalisation lagta hai: wo dono zinda hain aur unke apne routes hain
(`routes/privacy-and-policies.js`, `routes/terms-and-conditions.js`), ye dono
kabhi wire hi nahi hue.

> ⚠️ **`PartnershipDeed` model aur partnership feature alag cheezein hain.**
> `PUT /brands/onboarding/accept-partnership` route zinda hai — par
> `services/brands/acceptPartnership.js` sirf `brand.hasAcceptedPartnershipDeed = true`
> set karta hai **Brand model par**. Wo `PartnershipDeed` model ko chhuta hi nahi.
> Model delete karne se ye feature nahi tootega.

**Baaki 55 models zinda hain.** Sabse kam consumer wale bhi legit nikle —
`BrandStatusHistory` (1: `recordBrandStatusHistory.js`), `OTP` (1:
`database/otpRepository.js`), `WorkHours` (1: `upsertWorkHours.js`), `Setting`
(1 app + 13 tests: `helpers/settings/getSetting.js`).

> ⚠️ Chaar files jo pehle "0 consumers" dikhi thin wo **false positives** thin —
> `documentSnapshotSchema.js`, `pricingSchema.js`, `voucherPricingSchema.js` aur
> `validObjectId.js` sub-schemas hain jo `models/` ke **andar se** relative
> require hoti hain. `validObjectId` akela **40 models** use karte hain.

### I2 — Validators: 1 dead

| Validator | File |
|---|---|
| `validateStatementByToken` | `validator/settlements.js` |

Ye us hate hue `GET /settlements/statement/:token` route ka bacha hua hissa hai,
jise `GET /documents/:token` ne replace kiya
([media_upload_map.md §4.4](./media_upload_map.md)). **Baaki 36 validator files
ke saare `validate*` exports kisi na kisi route ke `validateSchema()` me jaate
hain.**

### I3 — `constants.js` (root): 3 dead top-level exports

| Export | Note |
|---|---|
| `NODE_ENV` | `{ DEVELOPMENT, PRODUCTION }` — koi import nahi karta, values uppercase hain jabki `index.js:29` lowercase `"production"` se compare karta hai, aur `STAGING` hai hi nahi. §2 wale env kaam se pehle ise theek karna hoga |
| `PLATFORMS` | koi consumer nahi |
| `SUBSCRIPTION_PLANS` | koi consumer nahi — plans ab `Subscription` model se aate hain |

Method: `require(".../constants")` se **jo naam destructure hote hain** unki poori
list nikaali (26 naam), aur usse top-level exports ka diff liya. Isi wajah se
`BUSINESS_ENTITY_TYPE` aur `GST_TO_BRAND_ENTITY_MAP` (shorthand exports) sahi se
zinda mark hue.

### I4 — `constants/`: 12 dead exports, saari 29 files zinda

**Koi bhi constants file dead nahi hai** — har ek ka kam se kam 1 importer hai.
Par 12 individual exports ka koi consumer nahi:

| File | Dead export |
|---|---|
| `ledger.js` | `LEDGER_DRIFT_KIND` |
| `mongo.js` | `INDEX_OPTIONS_CONFLICT` |
| `notification.js` | `AUDIENCE_TARGETS` |
| `payout.js` | `PAYOUT_OPEN_STATUSES` |
| `settlement.js` | `SETTLEMENT_NUMBER` |
| `showcase.js` | `SHOWCASE_SORT_BY` |
| `subscription.js` | `FORFEIT_POLICY`, `SUBSCRIBED_TERMINAL_STATUSES` |
| `voucher.js` | `VOUCHER_SLOT_RELEASING_STATUSES`, `VOUCHER_SORT_ORDER` |
| `voucherClaim.js` | `CLAIM_SLOT_HOLDING_STATUSES`, `CLAIM_SLOT_RELEASING_STATUSES` |

> 💡 In 12 me se chaar — `CLAIM_SLOT_HOLDING_STATUSES`,
> `CLAIM_SLOT_RELEASING_STATUSES`, `VOUCHER_SLOT_RELEASING_STATUSES`,
> `SUBSCRIBED_TERMINAL_STATUSES` — ek hi kahani batate hain. `CLAUDE.md` kehta hai
> ki `$in` `partialFilterExpression` me nahi chal sakta, isliye *"in one of these
> statuses"* ko **denormalised boolean** banana pada — `VoucherClaim.holdsUsageSlot`,
> `LedgerEntry.isOncePerTransaction`. Jab boolean aa gaya, ye status arrays
> bekaar ho gaye — par kisi ne hataye nahi. Ye dead code nahi, ek **poora ho chuka
> refactor** hai jiska aakhri step reh gaya.

`SETTLEMENT_NUMBER` bhi isi shakl ka hai — document numbering ab
`constants/document.js` ke `DOCUMENT_SERIES` se hoti hai.

### I4a — "status arrays" wali kahani, poori tarah

Chaar dead constants ek hi wajah se mare: `CLAIM_SLOT_HOLDING_STATUSES`,
`CLAIM_SLOT_RELEASING_STATUSES`, `VOUCHER_SLOT_RELEASING_STATUSES`,
`SUBSCRIBED_TERMINAL_STATUSES`.

#### Problem kya thi

Voucher claim ka niyam: *"ek customer ek voucher ka ek hi slot hold kar sakta
hai"*. Isko database me enforce karna tha — code me check karna kaafi nahi,
kyunki do request ek saath aayein to dono check pass kar jaate hain aur dono
insert ho jaate hain. Sirf ek **unique index** hi sach me rok sakta hai.

Par slot sirf **kuch statuses** me hold hota hai — `PENDING`, `PAID`, `ACTIVE`
type ke; `CANCELLED` ya `REFUNDED` me nahi. To index aisa chahiye tha:

```js
// jo hum LIKHNA chahte the
partialFilterExpression: { status: { $in: CLAIM_SLOT_HOLDING_STATUSES } }
```

#### 🔴 Mongo ye allow nahi karta

`partialFilterExpression` me Mongo sirf **equality**, `$exists`, comparison
(`$gt`/`$lt`) aur `$type` leta hai. **`$in` allowed nahi hai.** `CLAUDE.md` ka
"Never" section me ye likha hai.

#### Isliye rasta badla — denormalised boolean

Status array ki jagah model par ek **boolean** aaya, jo har status change par
saath me set hota hai:

| Purana array | Naya boolean |
|---|---|
| `CLAIM_SLOT_HOLDING_STATUSES` | `VoucherClaim.holdsUsageSlot` |
| `CLAIM_SLOT_RELEASING_STATUSES` | wahi boolean, ulta (`false` ho jaata hai) |
| `VOUCHER_SLOT_RELEASING_STATUSES` | wahi shakl, voucher slots ke liye |
| — | `LedgerEntry.isOncePerTransaction` (isi pattern se) |

Ab index seedha boolean par:

```js
partialFilterExpression: { holdsUsageSlot: true }   // ✅ Mongo ise leta hai
```

`CLAUDE.md` khud kehta hai: *"'In one of these statuses' has to become a
denormalised boolean — `VoucherClaim.holdsUsageSlot`, `LedgerEntry.isOncePerTransaction`
— and the index keys on that."*

#### To ye 4 constants kya hain

Refactor **poora ho chuka hai** — boolean kaam kar raha hai, index laga hua hai,
tests uspar hain. Bas **purane arrays delete karna reh gaya**.

> ⚠️ Ye "kabhi use hi nahi hua" wala dead code nahi hai. Ye **use hota tha**,
> phir uski jagah kuch behtar aa gaya, aur purana hataana bhool gaye. Isliye ye
> sabse surakshit deletion hai — inka kaam koi aur cheez pehle se kar rahi hai.
>
> 🔴 **Par ek khatra hai:** koi naya developer ye array dekh kar sochega
> "achha, slot in statuses me hold hota hai" aur usse naya code likh dega — jo
> boolean se **out of sync** ho jaayega. Ek jhoothi lekin bharosemand-dikhne wali
> list ka yahi nuksaan hai.

`SUBSCRIBED_TERMINAL_STATUSES` bhi isi family ka hai — subscription ke terminal
states ab `Subscribed.status` par seedha check hote hain.

### I4b — 15 dead constants, poori list

**Root `constants.js` (3):**

| Export | Kyun dead |
|---|---|
| `NODE_ENV` | `{ DEVELOPMENT, PRODUCTION }` — koi import nahi karta. Uppercase values, jabki `index.js:29` lowercase `"production"` se compare karta hai. `STAGING` hai hi nahi. **Env work (§environment_and_services_map.md) me isko theek karna hoga, delete nahi** |
| `PLATFORMS` | koi consumer nahi |
| `SUBSCRIPTION_PLANS` | koi consumer nahi — plans ab `Subscription` **model** se aate hain, hardcoded list se nahi |

**`constants/` (12):**

| # | File | Export | Kya replace hua |
|---|---|---|---|
| 1 | `voucherClaim.js` | `CLAIM_SLOT_HOLDING_STATUSES` | `VoucherClaim.holdsUsageSlot` boolean |
| 2 | `voucherClaim.js` | `CLAIM_SLOT_RELEASING_STATUSES` | wahi boolean |
| 3 | `voucher.js` | `VOUCHER_SLOT_RELEASING_STATUSES` | wahi pattern |
| 4 | `subscription.js` | `SUBSCRIBED_TERMINAL_STATUSES` | `Subscribed.status` par seedha check |
| 5 | `settlement.js` | `SETTLEMENT_NUMBER` | `constants/document.js` ka `DOCUMENT_SERIES` |
| 6 | `subscription.js` | `FORFEIT_POLICY` | forfeit logic `settleSubscriptionPayment` me inline |
| 7 | `ledger.js` | `LEDGER_DRIFT_KIND` | `reconcileSettlementLedger` apne shabd use karta hai |
| 8 | `mongo.js` | `INDEX_OPTIONS_CONFLICT` | error code `85` — ab kahin check nahi hota |
| 9 | `notification.js` | `AUDIENCE_TARGETS` | `NOTIFICATION_AUDIENCE` ne le li jagah |
| 10 | `payout.js` | `PAYOUT_OPEN_STATUSES` | `PayoutLeg` par seedha status check |
| 11 | `showcase.js` | `SHOWCASE_SORT_BY` | sort validator me inline |
| 12 | `voucher.js` | `VOUCHER_SORT_ORDER` | sort validator me inline |

> **Ginti par dhyan:** `constants/` ki **saari 29 files zinda hain** — har ek ka
> kam se kam 1 importer hai. Ye 12 unke **andar ke individual exports** hain. Koi
> file delete nahi hogi, sirf 12 export lines.

### I2a — `validateStatementByToken`: kya hoga delete karne par?

**Sawaal tha:** iska use case kya hai, aur kya `/documents/:token` ne ise replace
kar diya hai?

**Jawab: NAHI, replace nahi hua — replacement ke paas validator hai hi nahi.**

Purana route tha `GET /settlements/statement/:token`. Wo hata kar
`GET /documents/:token` bana. Par:

```js
// routes/documents.js — poori file me sirf ye ek line
router.get("/:token", getByToken);      // ← koi validateSchema NAHI
```

Yaani aaj **document token par koi format validation hai hi nahi.**

`validateStatementByToken` kya karta tha:

```js
token: Joi.string().trim().pattern(/^[a-f0-9]{64}$/i).required()
```

64 hex characters — kyunki token `crypto.randomBytes(32).toString("hex")` se
banta hai.

**Delete karne par kya hoga:** aaj ke behaviour me **kuch nahi badlega**, kyunki
wo kisi route par laga hi nahi hai. Par ek cheez khatam ho jaayegi:

`getDocumentByToken` bina validator ke **4 collections me query** karta hai
(`Transaction`, `RefundRequest`, `Dispute`, `Settlement`) — ek-ek karke, jab tak
token na mile. Yaani `GET /documents/abc` jaise ek bekaar request par bhi **4
database queries** chalti hain, aur wo route **public hai (koi JWT nahi)**.

Pattern check laga hota to malformed token DB tak pahunchta hi nahi.

> **Meri sifarish: delete mat karo — ise `routes/documents.js` par LAGA do.**
> Ye ek line ka kaam hai, ek dead validator ko live guard bana deta hai, aur ek
> public unauthenticated route ko sasta DB-amplification se bachata hai.
> (Security hole nahi hai — query safe hai. Sirf 4 bekaar queries per bad request.)

---

### I5 — Model fields jo declare hain par kabhi chhue hi nahi jaate

53 models ke saare top-level fields scan kiye. **6 fields aise mile jinka naam
apni model file ke bahar ek baar bhi nahi aata** — na koi likhta hai, na koi
padhta hai:

| Model | Field | Kya kehta hai |
|---|---|---|
| `Transaction` | `vendorGatewayFee` | 🔴 **Money field.** Razorpay ka MDR vendor par daalne ke liye jagah banayi gayi thi. Kabhi populate nahi hoti, to hamesha `undefined`. `PLATFORM_COST` ledger entry hi wo cost uthati hai. |
| `Transaction` | `chargebackRecoveredAt` | 🔴 **Money field.** Chargeback recovery ab `Transaction.chargebackSettlementId` (claim lock) se track hoti hai — ye timestamp us design se pehle ka hai. |
| `Transaction` | `isRefundRequested` | Refund state ab `RefundRequest` collection + `settlementHold` se aati hai. Ye boolean kabhi set nahi hota. |
| `Transaction` | `isRemoved` | `isDeleted` ke saath duplicate — soft delete `isDeleted` use karta hai. |
| `VoucherVersion` | `archivedAt` | Version lifecycle `status` + `isImmutable` se chalti hai; archive kabhi implement nahi hua. |
| `VoucherVersion` | `attachedSubBrandsCount` | Denormalised counter jo kabhi likha nahi gaya — count `VoucherSubBrand` se aata hai. |

> ⚠️ **Ye media wale gaps se alag hain.** `Brand.coverImage`, `SubBrand.logo`,
> `SubBrand.coverImage` ([media_upload_map.md §8.7](./media_upload_map.md))
> **padhe jaate hain** — 9 pipelines unhe project karti hain — bas likhe kabhi
> nahi jaate. Upar wale 6 na padhe jaate hain na likhe. Wo customer ko `null`
> dikhate hain; ye poori tarah invisible hain.

> 🔴 **Do money fields (`vendorGatewayFee`, `chargebackRecoveredAt`) delete karne
> se pehle rukiye.** Baaki sab se ye alag hain: agar kabhi vendor par MDR daalna
> hai ya chargeback recovery ka timestamp chahiye, to schema pehle se maujood hai.
> Sawaal ye hai ki wo feature aane wala hai ya nahi — ye code ka faisla nahi,
> product ka hai.

**Baaki har field kahin na kahin use hota hai.** Scan ne 53 models ke har
top-level field ka naam poore repo me dhoonda; sirf ye 6 kahin nahi mile.

---

### I5a — `isRefundRequested`: refund kis transaction/claim se juda hai?

**Sawaal tha:** customer refund request daale to kaise pata chalega kis
transaction aur kis voucher claim se? Koi link hai ya nahi?

**Jawab: link pehle se maujood hai, aur wo `isRefundRequested` se kahin mazboot hai.**

`models/RefundRequest.js` me char **required + indexed** foreign keys hain:

| Field | Line | Note |
|---|---|---|
| `claimId` | 100 | `required: true, index: true` → kaun sa voucher claim |
| `transactionId` | 101 | `required: true, index: true` → kaun sa payment |
| `customerId` | 102 | `required: true, index: true` → kis customer ka |
| `brandId` | 103 | `required: true, index: true` → kis brand ka |
| `claimCode` | 114 | indexed — support ke liye human-readable code |

Iske alawa `isOpen: true` (line 152) ek denormalised flag hai jisse "abhi khula
refund hai kya" ek query me pata chal jaata hai.

**To sawaal ka seedha jawab:**

```js
// "is transaction par koi refund hai?"     → ek indexed query
await RefundRequest.find({ transactionId, isDeleted: false })

// "is claim par koi khula refund hai?"     → ek indexed query
await RefundRequest.findOne({ claimId, isOpen: true, isDeleted: false })
```

Aur code aaj yahi karta hai — `executeRefund.js:97` khule refund dhoondhne ke
liye, `getAdminCustomerDetail.js:313` customer ke refund ginne ke liye,
`getBankAccounts.js:42` ye dekhne ke liye ki bank account kisi refund me laga hai.

**`Transaction.isRefundRequested` kya hota:** ek shortcut flag taaki refund ka
pata lagane ke liye doosri collection na dekhni pade. Par:

- 🔴 Wo **kabhi set hi nahi hota** — `default: false`, aur poore repo me ek bhi
  jagah likha nahi jaata. To aaj wo har transaction par `false` hai, chahe uspar
  10 refund hon.
- 🔴 Agar kal koi ise padhne lage to **galat jawab milega** — aur wo galat jawab
  `false` hoga, yaani "koi refund nahi", jo sabse khatarnak disha hai.
- 🔴 Do jagah sach rakhne ka matlab hai unke beech drift. `RefundRequest` row hi
  ekmatra sach honi chahiye.

> **Meri sifarish: `isRefundRequested` hata dena safe hai.** Link tootega nahi —
> link `claimId` + `transactionId` hai, aur wo required-indexed hai. Ye field ek
> aisa shortcut hai jo kabhi bana hi nahi, aur jhooth bolne ke liye taiyaar baitha
> hai.
>
> ⚠️ Agar aap performance ke liye aisa flag chahte hain, to wo `holdsUsageSlot`
> wale pattern se banega — likhne wale hi rasta par set ho, aur uspar index ho.
> Aaj wo dono nahi hain.

---

### I5b — VoucherVersion: aaj kaise chalta hai, aur `ARCHIVED` kyun kabhi nahi aata

**Sawaal tha:** voucher version create/update me kya hota hai — pehle samjho.

#### Aaj ka asli flow

```
create  →  VoucherVersion v1, status = DRAFT
           └─ images, offers, subBrands sab v1 par

update  →  do raaste, version ke status par depend:
           ├─ v1 DRAFT/REJECTED hai   → wahi version in-place edit hota hai
           └─ v1 PUBLISHED hai        → naya v2 FORK hota hai (DRAFT), v1 chhua nahi jaata

submit  →  DRAFT → UNDER_REVIEW
review  →  UNDER_REVIEW → APPROVED  ya  REJECTED     (admin)
publish →  APPROVED → PUBLISHED                       (vendor/admin)
```

#### 🔴 Publish par purane version ka kya hota hai

`services/vouchers/publishVoucher.js:150-174` —

```js
await VoucherVersion.updateMany(
  { voucherId, status: PUBLISHED, _id: { $ne: version._id } },
  { $set: { status: VOUCHER_STATUSES.EXPIRED, isActive: false } }
);
```

**Purana published version turant `EXPIRED` ho jaata hai** — chahe uski apni
`endAt` abhi 3 mahine door ho.

Aur `services/vouchers/expireVouchers.js` (nightly job) bhi wahi karta hai, par
sahi wajah se: `endAt <= now` wale versions ko `EXPIRED` karta hai.

#### To dono raaste ek hi state me milte hain

| Kya hua | Aaj ka status | Aapke hisaab se hona chahiye |
|---|---|---|
| Naya version publish hua, purana replace ho gaya | `EXPIRED` | **`ARCHIVED`** + `archivedAt = now` |
| Version ki apni `endAt` aa gayi | `EXPIRED` | `EXPIRED` ✅ (yahi sahi hai) |
| `ARCHIVED` version ki `endAt` aa gayi | *(hota hi nahi)* | job `ARCHIVED → EXPIRED` kare |

Iska matlab: **"replace ho gaya" aur "waqt khatam ho gaya" — do bilkul alag
cheezein aaj ek hi shabd `EXPIRED` me ghus jaati hain.** Reporting me aap ye
alag nahi kar sakte ki voucher isliye band hua ki vendor ne naya banaya, ya
isliye ki uski tareekh nikal gayi.

#### 🟢 Achhi khabar — aadha kaam pehle se maujood hai

| Cheez | Status |
|---|---|
| `VOUCHER_STATUSES.ARCHIVED` enum | ✅ **exist karta hai** (`constants/voucher.js:42`) |
| `VoucherVersion.archivedAt` field | ✅ **exist karta hai** (`models/VoucherVersion.js:218`) |
| `updateVoucher.js:217` guard — ARCHIVED version edit nahi ho sakta | ✅ **exist karta hai** |
| Koi code jo `ARCHIVED` **set** kare | ❌ **kahin nahi** |
| Koi job jo `ARCHIVED → EXPIRED` kare | ❌ **kahin nahi** |

> 🔴 **Isliye `archivedAt` DELETE nahi karna.** Wo "bekaar field" nahi hai — wo
> ek aadhe bane feature ka hissa hai. Enum hai, field hai, guard hai; sirf do
> jagah code likhna baaki hai:
>
> 1. `publishVoucher.js:150-174` me `EXPIRED` ki jagah `ARCHIVED` + `archivedAt: now`
> 2. `expireVouchers.js` ke filter me `PUBLISHED` ke saath `ARCHIVED` bhi jodna,
>    taaki `endAt` aane par wo `EXPIRED` ho jaaye

#### `attachedSubBrandsCount` — ye alag kahani hai

Ye ek **denormalised counter** hai jo kabhi likha nahi gaya. Sub-brand count aaj
live nikala jaata hai:

```js
// helpers/vouchers/validate.js:196, 267
const subBrandCount = await VoucherSubBrand.countDocuments({ ... });
```

Aur wahi count `reviewVoucher.js:209,240` me use hota hai. Yaani **kaam ho raha
hai, bas is field se nahi.**

> Ye `isRefundRequested` jaisa hi case hai — ek shortcut jo kabhi bana nahi.
> Hatana safe hai. Rakhna hai to tabhi jab koi ise **likhe bhi**, warna wo hamesha
> `0` batayega jabki asli count 5 ho.
