# Postman — Trydood 2.0

Ek collection per panel. Har collection **generate hoti hai**, hand-likhi nahi — enums,
limits aur defaults `constants/` se seedhe padhe jaate hain, to collection API ke baare me
jhooth nahi bol sakti.

**Teen collections. Teen docs. Aur koi nahi.**

| Collection | Requests | Status |
|---|---:|---|
| `trydood-customer.postman_collection.json` | 140 | ✅ 492 assertions · **0 failed** · 206 examples, **140/140 requests par** |
| `trydood-vendor.postman_collection.json` | 127 | ✅ 294 assertions · **0 failed** · 143 examples, **127/127 requests par** |
| `trydood-admin.postman_collection.json` | 113 | ✅ 258 assertions · **0 failed** · 124 examples, **113/113 requests par** |

> ### ✅ 219/219 — aur ye ab naapa jaata hai, gina nahi jaata
>
> ```bash
> node scripts/verifyApiCoverage.js
> ```
>
> ```
> Routes served: 219  (216 in routes/, 3 in index.js)
>   ✅ endpoints_category.md    219/219 categorised
>   ✅ role docs                219/219 documented
>   ✅ collections              219/219 have a request
>   ✅ saved examples           219/219 have an example
> ```
>
> Ye routes **built Express routers** se padhta hai (`lib/routeInventory.js`),
> kisi list se nahi — to jo route maujood hai wo report me hai, chahe kisi ko
> yaad ho ya na ho.
>
> ⚠️ Pehle ye haath se gina jaata tha aur **har baar** drift karta tha: vendor
> doc 78 endpoints kehti thi, uski collection me 116 requests thin, aur uska
> generator 19 folders banata tha ek aisi file ke liye jisme 22 the. Teen number,
> teen source, koi milaane wala nahi.

> ### 🔴 Teen collections delete ki gayin — aur kyun
>
> `trydood-brand-verification`, `trydood-security-changes` aur
> `trydood-subscription` kabhi panel nahi thin — har ek kaam ka ek tukda thi
> jise kisi aur cheez ke liye token chahiye tha. Par unme **32 admin routes ki
> ekmatra request** thi, yaani wo galti se load-bearing ban chuki thin: unhe
> delete karna un endpoints ki coverage bhi le jaata, chup-chaap.
>
> Pehle sab kuch teen panel collections me migrate hua
> (`lib/adminMigratedFolders.js`, script se — haath se nahi, aur field-by-field
> diff karke), **tab** wo hataayi gayin.
>
> **Chauthi collection mat banao.** Jo endpoint upar wali table me fit na ho,
> uska matlab gate galat hai — table nahi.

### Kaunsa endpoint kahan jaata hai

Gate se tay hota hai, isse nahi ki kahan achha lagta hai:

| Gate | Doc | Collection |
|---|---|---|
| `isCustomer` | customer | `trydood-customer` |
| `isVendor` · `isVendorOrSubVendor` | vendor | `trydood-vendor` |
| `isAdmin` | admin | `trydood-admin` |
| `isVendorOrAdmin` · `isBrandSideOrAdmin` | **vendor + admin** | vendor only |
| `PUBLIC` · `optionalAuth` · `verifyJwtToken` | koi ek | koi ek |

⚠️ `isVendorOrAdmin` **dono docs** me likha jaata hai par **ek** collection me
request hoti hai. Dono role sach me call kar sakte hain, to dono docs ko bolna
chahiye — par do collections me ek hi request rakhna matlab do jagah maintain
karna, aur jis din ek badli aur doosri reh gayi, jo reh gayi wo chup-chaap jhooth
bolne lagti hai.

Companion docs: [`../docs/customer_mobile_api_doc.md`](../docs/customer_mobile_api_doc.md) ·
[`../docs/vendor_panel_api_doc.md`](../docs/vendor_panel_api_doc.md) ·
[`../docs/super_admin_panel_api_doc.md`](../docs/super_admin_panel_api_doc.md) ·
[`../docs/endpoints_category.md`](../docs/endpoints_category.md)

---

## 🔴 Customer generator dead tha — ab zinda hai

**`generate-customer-collection.js` chal hi nahi sakta tha**, aur ye baat is README ki
apni hidayat ko ek jaal bana rahi thi.

`lib/routeGates.js` `router.stack is not iterable` throw karta tha us din se jab
`routes/voucherClaims.js` ne `{ router, routePrefix }` export karna shuru kiya — wo
`.stack` seedhe module object par padh raha tha, aur mount bhi **filename** se banata tha
(`/voucherClaims`, jabki asli mount `/voucher-claims` hai).

Isi wajah se claims/refunds/search/logout ke 30 requests `scripts/add*ToPostman.js` se
seedhe JSON me daale gaye the. Generator un 30 ke baare me **kuch nahi jaanta tha**.

> ⚠️ Aur ye README neeche keh raha tha *"JSON hand-edit mat karein — generator me add
> karke re-run karein"*. Jo bhi us hidayat ko maanta, wo **teen folders aur 96 captured
> examples delete** kar deta — aur command `✅ 88 requests` bolkar **safal** ho jaati.
> Naapa gaya: 118 requests → 88, 132 examples → 36.

Ab dono theek hain:

| Kya | Kahan |
|---|---|
| `routePrefix` + `extraRoutes` handle hote hain | `lib/routeGates.js` → `build()` |
| Malformed id wale requests ka gate bhi derive hota hai | `lib/routeGates.js` → `gateNameFor()` — trailing segments ko `:x` maan kar retry karta hai. Pehle inhe hand-written `gate:` chahiye tha, aur unme se ek **galat** tha (`/vouchers/customer/get/:id` ko `verifyJwtToken` likha tha jabki wo `optionalAuth` ho chuka hai) |
| Comment ke peeche chhupe gates | `stripComments()` — `routes/disputes.js` aur `transactions.js` `router.get(` aur path ke **beech** JSDoc rakhte hain, jisse wo routes chup-chaap `PUBLIC` report ho rahe the |
| Claims / Refunds / Bank Accounts folders | `lib/customerMoneyFolders.js` |
| Search folder | `lib/customerSearchFolder.js` |

`scripts/addClaimRequestsToPostman.js`, `addRefundRequestsToPostman.js`,
`addSearchRequestsToPostman.js` aur `addLogoutRequestsToPostman.js` ab **customer ke liye
zaroori nahi** hain — unka content generator me hai. (Vendor ke liye wo abhi bhi use hote
hain; vendor generator port hona baaki hai.)

---

## ⚠️ Do cheezein jo order par nirbhar hain

### 1. Generate → seed → capture. Isi kram me.

`generate-customer-collection.js` environment file **dobara likhta hai**, khaali values
ke saath. Seeder usme das ids bharta hai. Ulta chalane par capture khaali `{{…}}`
bhejta hai.

```bash
node postman/generate-customer-collection.js                          # 1
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply     # 2 — ids likhta hai
node postman/lib/capture-examples.js \                                # 3
  postman/trydood-customer.postman_collection.json \
  postman/environments/customer-local.postman_environment.json
```

### 2. `19 — Logout: sab devices se` poore run ke aakhir me hai

`allDevices: true` `sessionInvalidatedAt` stamp karta hai, jo **us waqt se pehle bana har
JWT** mar deta hai — apna wala bhi.

> ⚠️ Ye request pehle `00 — Setup & Auth` ke aakhir me thi. Padhne me theek lagta hai aur
> galat hai: folder `00` **sabse pehle** chalta hai. Ek request ne baaki pandrah folders
> ke **206 assertions** gira diye, aur capture ne 125 asli responses save kar liye — sab
> ek **mare hue token** ke. Isliye ab uska apna folder hai, sabse aakhir me.

---

## Seeded ids — jo collection khud capture nahi kar sakti

**Das** variables seeder likhta hai, kyunki inhe paane ka koi customer-facing raasta nahi:

| Variable | Kyun seeded |
|---|---|
| `customer_whatsapp` | Seeded customer ka number — money folders usi ki history padhte hain |
| `bank_account_id` | Ek **paid CGPey penny drop** chahiye. Seeder pehle-se-verified row rakhta hai |
| `spare_bank_account_id` | Doosra verified account **jispar koi refund point nahi karta**. Folder 12 `bank_account_id` ko parked refund se jod deta hai, to uspar `DELETE` sahi tarah `409` deta hai — aur success kabhi dikhta hi nahi |
| `invoice_token` | Koi endpoint ise **jaan-boojh kar** return nahi karta — `payments/:id` `invoiceDownloadUrl` deta hai, token nahi |
| `awaiting_bank_refund_id` | `AWAITING_BANK_DETAILS` par pahunchne ke liye admin ko `SOURCE` fail dekhna aur bank details maangni padti hai — teen actor ka sequence |
| `refundable_claim_id` | Ek **doosri** paid claim jispar koi refund nahi. Pehli claim parked refund rakhti hai, to `POST /refunds` uspar hamesha *"You already have a refund in progress"* deta |
| `other_customer_claim_id` · `other_customer_transaction_id` | **Doosra** customer aur uski claim — cross-customer `403` tests ke liye |
| `offer_id` | Offers published `VoucherVersion` par hain, aur koi customer endpoint unhe id se nahi deta |
| `other_customer_notification_id` 🆕 | **Doosre** customer ki ek asli notification. Scope test ko ek valid id chahiye jise chhoona mana ho — banaya hua id bhi `matched: 0` deta, aur scope hata dene par bhi deta rehta: test pass hota aur kuch check na karta |

### Teen fixture traps jo ek-doosre me chhupe the

Ye teeno **ek hi wajah** se the — ek seeded open refund — aur teen alag shaklon me dikhe:

| Dikha | Asli wajah |
|---|---|
| `POST /refunds` → `422` *"You already have a refund in progress"* | `maxOpenRequests` default **1** hai, aur parked refund poori allowance kha gaya. Seeder ab use `3` karta hai — allowance admin-configurable hai, to ye fixture config hai, workaround nahi |
| `PATCH /refunds/:id/withdraw` → **`404 "Invalid API"`** | Ye business 404 **nahi** tha — `refund_request_id` khaali reh gaya, URL `/refunds//withdraw` ban gaya, aur router ka catch-all lag gaya. Khaali variable is tarah bhi dikh sakta hai |
| `DELETE /bank-accounts/:id` → `409` | Sahi behaviour, par folder 12 pehle chalta hai aur account ko refund se jod deta hai. `spare_bank_account_id` isiliye hai |

⚠️ Aur ek: `OTHER bina note — 422` **sahi status par galat wajah se** pass ho raha tha.
`reasonNote` ka rule `requestRefund.js` me hai, **eligibility ke baad** — to ineligible
claim par eligibility ka 422 pehle aata hai aur rule chhua hi nahi jaata. Ab wo request
`refundable_claim_id` use karti hai aur **message bhi assert** karti hai
(*"Please tell us what went wrong"*), sirf status code nahi.

### ⚠️ Seeder shadow indexes reap karta hai — aur usse pehle nahi kar raha tha

Is scratch database me `invoiceId_1` aur `razorpayOrderId_1` pade the — **blanket** unique
indexes nullable paths par, theek wahi jodi jiska `CLAUDE.md` zikr karta hai. Mongo missing
field ko `null` index karta hai, to blanket unique **doosre** aise row ko reject kar deta
hai jiske paas abhi value nahi: do unsettled transactions seed karte hi
`dup key: { invoiceId: null }` — ek aise field ka naam lekar jo fixture ne kabhi set hi
nahi kiya.

`reapShadowIndexes` normally boot par aur ghante me chalta hai — par capture run server ko
`ENABLE_JOBS=false` ke saath uthata hai (taaki sweeps beech me na chalein), aur **isi liye**
inhe koi reap nahi kar raha tha. Seeder ab money rows likhne se **pehle** khud reap chalata
hai; helper ki apni do shartein use surakshit rakhti hain (sirf pehle se superseded blanket
unique, aur partial replacement na ho to kuch bhi drop nahi).

### 🔴 In do authorization tests ka trap — ab band

Ye do requests test karti hain ki ek customer doosre ka payment/claim **na khol paaye**:

```
GET  /voucher-claims/payments/{{other_customer_transaction_id}}   -> asserts 403
POST /refunds { "claimId": "{{other_customer_claim_id}}" }        -> asserts 403
```

Variable set na ho, to literal `{{other_customer_claim_id}}` body me jaata tha. Dono
validators `objectId()` use karte hain, to jawab **`422` "Invalid claimId."** aata tha —
`403` nahi. Test fail hota tha, par **galat wajah se**.

⚠️ **Ise assertion me `422` accept karwa ke chup mat karana.** Tab test hamesha ke liye
green ho jayega aur kabhi kuch check nahi karega — aur jo wo check kar raha hai wo ye hai
ki ek customer doosre ka paisa dekh sakta hai ya nahi. Seeder ab wo rows banata hai.

### `offer_id` khaali hone par poora claim flow rukta hai

`offerId` validator me optional hai par **nullable nahi**. Khaali `{{offer_id}}` "no
offer" nahi hai — wo `422 "Body.offerId is not allowed to be empty"` hai, aur claim ka
pehla hi request wahin ruk jaata hai.

---

## Examples haath se nahi likhe jaate

Har saved example ek **asli response** hai, live run se capture kiya gaya:

```bash
# 0. newman — capture-examples.js ise require karta hai
#    ⚠️ `npx newman` chalta hai par `require("newman")` fail hota hai; module
#    chahiye, CLI nahi. Aur `NODE_ENV=production` kuch shells me set hai, jo npm
#    ko devDependencies skip kara deta hai — install "safal" hota hai aur newman
#    kabhi nahi aata.
NODE_ENV=development npm install --include=dev --save-dev newman

# 1. Collection + environment
node postman/generate-customer-collection.js

# 2. Fixtures — shadow indexes reap karta hai aur das ids environment me likhta hai
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply

# 3. Server usi database pe (jobs band, warna sweeps beech me chalte hain)
MONGO_URL="<...>/Trydood2_postman" ENABLE_JOBS=false npm run dev

# 4. Capture — collection chalti hai aur har response wapas usi file me example ban jaata hai
node postman/lib/capture-examples.js \
  postman/trydood-customer.postman_collection.json \
  postman/environments/customer-local.postman_environment.json
```

> ### Non-JSON jawab bhi example banta hai
>
> `capture-examples.js` pehle non-JSON body ko `continue` kar deta tha, is bharose par ki
> har endpoint envelope deta hai. **Ek nahi deta:** `GET /transactions/invoice/:token`
> `302` + `Location` deta hai. To wo request chup-chaap collection ki **ekmatra** request
> thi jiska koi example nahi tha — aur summary line phir bhi kehti thi ki sab covered hai.
>
> Ab non-JSON `previewlanguage: "text"` ke saath save hota hai, `Location` header ke saath,
> aur body 2,000 chars par cap hai. Us request par `followRedirects: false` bhi hai —
> warna captured "response" Cloudinary ka **poora PDF** hota.

> ### ⚠️ Generator dobara chalane se captured examples **mit jaate hain**
>
> `node postman/generate-customer-collection.js` collection ko **poora dobara likhta hai**.
> Generator sirf haath se likhe examples jaanta hai — live capture se aaye examples uske
> source me hain hi nahi, isliye wo saare gayab ho jaate hain.
>
> Naapa gaya: customer + vendor collections ko bina soche regenerate karne par
> **15,499 line delete** hui, yaani 237 captured examples. `git diff --stat` ke bina ye
> dikhta bhi nahi — command "✅ 88 requests" bolkar khatam ho jaati hai.
>
> **Isliye:** generator wahi chalao jiska source tumne badla hai, aur chalane ke baad
> `git diff --stat postman/` zaroor dekho. Delete ki ginti insert se badi ho to ruk kar
> socho. Regenerate ke baad capture step (upar wala 1-2-3) dobara chalana padta hai.
>
> Abhi ke haal: `customer` me 132 aur `vendor` me 105 captured examples hain;
> `subscription` aur `security` poori tarah generated hain, unme capture hai hi nahi —
> unhe regenerate karna surakshit hai.

Capture ke baad:

- **Sanitize** — asli ObjectId `{{brand_id}}` jaisi environment variable ban jaati hai,
  timestamps ek fixed instant pe pin ho jaate hain, JWT redact ho jaate hain.
- **Consolidate** — ek hi endpoint ko chhune wali saari sibling requests ke examples
  **primary request pe bhi** aa jaate hain. Matlab Postman me ek API kholiye to uska poora
  behaviour ek jagah dikhta hai: success, har validation failure, har business refusal.

Voucher feed pe 11 examples hain — guest, signed-in, saari sort modes, suggestions tab,
aur har error.

**Kyun capture, likhna kyun nahi:** haath se likha example code badalte hi purana ho jaata
hai, aur wo galti dikhti nahi — galat example bilkul sahi jaisa lagta hai. Pichhle rounds
me aise do ship ho chuke the (`nearestOutlet._id` jo actually `subBrandId` hai, flat
`medias[]` jo actually nested `media.data[]` hai) aur dono sirf chalane pe pakde gaye. Ab
example galat ho hi nahi sakta jab tak API khud galat na ho.

---

### Ab tak kya nikla

Live runs ne paanch aise defects pakde jo code padhkar nahi dikhte the:

| Kya | Kahan |
|---|---|
| 🔴 **Voucher feed har user ke liye `404` de raha tha** — guest-login commit ne auth hata di, to `req.userId` set hona band ho gaya aur service `Customer` dhoondhti reh gayi. Naya `optionalAuth` gate + guest-tolerant service | Customer |
| 🔴 `currentScreen` galat value poori login call `422` kar deti hai — aur enum me koi customer screen hai hi nahi | Customer |
| 🔴 `GET /brands/verifications/history` har vendor request pe `500` (`isVendor is not defined`) | Vendor |
| 🔴 Dono showcase reorder endpoints har request pe `500` — `id` vs `sectionId`/`mediaId`. **Kabhi kaam nahi kiye** | Vendor |
| Doc me `nearestOutlet._id` likha tha, asli me `subBrandId` hai | Customer |
| Doc me section detail ka `medias[]` flat likha tha, asli me nested `media.data[]` hai | Vendor |

Teeno 🔴 fix ho chuke hain aur ab collections me unke regression tests hain.

---

## Ye collections kaise likhi gayi hain

Teen decisions jo har collection pe lagte hain:

**1. Happy path aur behaviour badalne wale edge cases alag requests hain.**
Matlab poora folder Collection Runner / Newman me chalta hai aur waqai API **test** karta
hai, sirf document nahi karta. Per-field Joi rejections (`limit > 50`, bad ObjectId,
missing required field) **saved examples** hain — wo sirf validator ko dohraate hain, unhe
alag request banane se collection bhaari ho jaati aur signal kam ho jaata.

**2. Har request pe `pm.test` assertions hain.** Status, response envelope, aur documented
field shape. Envelope check har 2xx pe isliye hai ki wo ek aisa controller pakad leta hai
jo chup-chaap `res.json(...)` return kar de — jo yahan pehle ho chuka hai
(`DELETE /users/delete`).

**3. Sensitive fields ka absence bhi assert hota hai.** Sasta check hai aur failure mode
severe: ek projection edit jo `password` ya brand ka PAN wapas le aaye, wo baaki saare
tests pass karte hue nikal jaata.

---

## Customer collection chalana

### 1. Import

```
Postman → Import → trydood-customer.postman_collection.json
Postman → Import → environments/customer-local.postman_environment.json
```

Top-right dropdown se environment **select** karein — bina iske pre-request script warning
deta hai.

### 2. Variables — kuch bharna nahi hai

`customer_whatsapp` **seeded customer** par default hai (`9700000021`), aur usi par rehna
chahiye: money folders (`11` Claims, `12` Refunds, `13` Bank Accounts) us customer ki
claim, payment, refund aur bank account padhte hain.

> Koi naya number daalein to folders `00`–`10` aur `14` phir bhi pass honge — signup,
> `isFirst`, saare guest reads. Sirf money folders khaali chalenge. Yahi arrangement
> vendor collection me seeded vendor ke saath pehle se hai.

`customer_token`, `brand_id`, `voucher_id`, `claim_id`, … folder `00` se aage **apne aap**
capture hote hain. Paanch seeded ids seeder likhta hai (upar dekhein).

**Teen URL har environment me hain** — `local_url` · `stage_url` · `prod_url`. Target
badalna ho to unme se ek value `base_url` me copy kar dein; re-import ki zarurat nahi.

⚠️ `base_url` beech run me badalne se **re-authentication nahi hota**. Captured
`customer_token` usi deployment ka hai jisne diya tha, to environment switch karne ke baad
`00 — Setup & Auth` dobara chalayein.

### 3. Fixtures seed karein

Voucher feed geo-scoped hai aur `pagination` khaali result pe `404` deti hai, to bina data
ke aadhi collection empty-state hit karegi. Seeder wahi banata hai jo collection expect
karti hai:

```bash
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply
```

Dry run default hai; `--apply` chahiye. **Production database name pe wo chalta hi nahi** —
koi flag nahi hai jo usko allow kare.

Kya banta hai — sab Indore (`[75.8937, 22.7533]`) me:

| | |
|---|---|
| 1 admin user | banners / tickers ka `createdBy`, curation stamps |
| 1 category + sub-category | master data |
| 1 customer promo code (`PMFX10`) | claim order ka promo path. ⚠️ Saath me `Setting.customer.promoCode.isEnabled = true` bhi set hota hai — wo default me **`false`** hai, aur `create-order` par band promo ek **hard 422** hai |
| 2 brands + 1 outlet each | ek pinned as Top Brand |
| 10 brand features | profile ka 10-cap exercise karne ke liye |
| 1 visible showcase (8 media) + 1 hidden | dono showcase endpoints ka farak dikhane ke liye |
| 2 published vouchers | ek suggested + IMAGE banner, ek plain (`bannerType: null`) |
| 1 banner + 2 tickers | home screen |
| 1 terms + 1 privacy | legal |
| **1 customer** (`9700000021`) 🆕 | Jispar poori money history baithi hai. `customer_whatsapp` isi par default hai |
| **1 paid + settled claim** 🆕 | Claims list, claim detail, payments, aur `invoiceToken` + `invoiceSnapshot` — dono, warna invoice link `409` deta hai |
| **1 verified bank account** 🆕 | List, delete aur refund ka bank-account choose — teeno ke asli examples, **bina penny drop ka paisa kharch kiye** |
| **1 refund `AWAITING_BANK_DETAILS`** 🆕 | `PATCH /refunds/:id/bank-account` ka **ekmatra** valid status |
| **1 doosra customer + uski claim** 🆕 | Cross-customer `403` tests — inke bina wo `422` dete the |

⚠️ **`pricing` aur `invoiceSnapshot` haath se nahi likhe jaate.** Seeder
`buildClaimPreview()` aur `buildVoucherInvoiceSnapshot()` — wahi builders jo live path
chalata hai — call karta hai. Money numbers type kar dena wo tareeka hai jisse fixture us
API se disagree karne lagta hai jise wo demonstrate kar raha hai, aur uspar bana **har
captured example wo jhoot inherit** kar leta hai.

Re-runnable hai — apne hi documents pehle clear karta hai, duplicate nahi banata.

⚠️ Money rows **customer par** keyed hain, user par nahi (`VoucherClaim.customerId`), to
clear step pehle `Customer` resolve karta hai. Sirf `User` delete karne par orphan claims
bach jaate hain jo agle run ki listing me aa jaate — aur output me kuch nahi kehta.

### 4. Server usi database pe chalayein

```bash
MONGO_URL="<...>/Trydood2_postman" npm run dev
```

### 5. Run

Collection Runner se, ya CLI se:

```bash
npx newman run postman/trydood-customer.postman_collection.json \
  -e postman/environments/customer-local.postman_environment.json \
  --env-var "customer_whatsapp=9812340011"
```

**Order maayne rakhta hai.** Baad wale folders pehle wale ke capture kiye ids use karte
hain, aur folder `07` ke toggle-pairs deliberately aise arrange hain ki list request
`on` state me chale. Poori collection idempotent hai — dobara chalane pe wahi result.

---

## Folder map — customer

| Folder | Kya |
|---|---|
| `00 — Setup & Auth` | WhatsApp login, token capture, `isFirst` regression, ADMIN self-signup block, saada + push logout |
| `01 — User Profile` | Get / update (multipart), aur `DELETE /users/delete` ka no-op behaviour |
| `02 — Location` | Upsert + read, coordinate order aur zipcode ke traps |
| `03 — Master Data` | Categories, sub-categories |
| `04 — Home Screen` | Banner (`null` ho sakta hai) aur tickers (`[]` ho sakta hai) |
| `05 — Vouchers` | Feed, Suggestions tab, detail, discount preview + convenience fee |
| `06 — Brand Profile` | Directory, Top Brands tab, profile, showcase, video clips, features |
| `07 — Engagement` | Follow / avoid toggles + lists |
| `08 — Legal` | Terms aur privacy reads |
| `09 — Push Notifications` | Device register / list / test / unregister |
| `10 — Guest (bina token)` | Har public endpoint bina Authorization header ke |
| `11 — Voucher Claims` | Order → verify → meri claims / payments → ek claim → code → **invoice link** |
| `12 — Refunds` | Refund maango, wapas lo, **failed refund ka bank account chuno** 🆕, dekho |
| `13 — Bank Accounts` 🆕 | OTP → add (live penny drop) → list → delete |
| `14 — Search` | Global search (guest + signed-in), single-type paginated mode, history CRUD, popular chips |
| `15 — Email Verification` 🆕 | Code maango → verify. **Har role** — `verifyJwtToken`, koi role gate nahi |
| `16 — Notifications` 🆕 | Customer inbox, mark-read, aur wo scope test jo **doosre customer ki** row par `matched: 0` sabit karta hai |
| `17 — App Config (public)` 🆕 | Guest config, version compare (`updateRequired`), aur leak check ki commission/reserve kabhi na aayein |
| `18 — Access control` | Negative tests — customer token in endpoints pe refuse hona chahiye |
| `19 — Logout: sab devices se` | ⚠️ **Session kill — sabse aakhir me, aur wahin rehna chahiye** |

> ⚠️ **Folder number naam me hai, aur duplicate par koi error nahi aata.** Chaar naye
> folders jodne par access-control wala `11` par hi reh gaya tha — do folder `11`, aur
> Postman array order me render karta hai to sab bilkul normal dikhta hai. Yahi collision
> pehle bhi ek baar hua tha (`12` / `19`). Naya folder jodein to neeche wale renumber
> karein.

---

## Chalane se pehle jaan lein

- **List endpoints khaali pe `404` dete hain**, empty array nahi — shared `pagination`
  utility throw karti hai. Ise empty state samajhein, error nahi.
  Do exceptions: `/banners/customer/active` (`null` deta hai) aur
  `/promotionalTickers/customer/active` (`[]` deta hai).
- **`coordinates` `[longitude, latitude]`** order me hain — GeoJSON standard, Maps APIs se
  ulta. Indore = `[75.8937, 22.7533]`.
  ⚠️ Indore ke case me dono numbers valid ranges me aate hain, to ulta bhejne pe **koi
  error nahi aayega** — address chup-chaap Somalia ke paas chala jayega aur feed khaali
  aa jayegi.
- **WhatsApp OTP abhi verify nahi hota** (deliberate, deferred) — koi bhi 6-digit chalega.
- **`currentScreen` customer app se mat bhejein** — us enum me koi customer screen hai hi
  nahi, aur galat value poori login call `422` kar deti hai.
- **`POST /deviceTokens/test` live Firebase call hai** — jis environment me FCM configure
  nahi hai wahan `422` dega. Wo endpoint ka bug nahi; test dono outcomes accept karta hai.

---

## Generate / validate

```bash
node postman/generate-customer-collection.js

node postman/lib/validate-collection.js \
  postman/trydood-customer.postman_collection.json \
  postman/environments/customer-local.postman_environment.json
```

Validator wo cheezein pakadta hai jo generate hui collection me sasti hain check karna aur
mehngi discover karna: test-script ka syntax error (jo generator me error nahi hota, sirf
Postman me run-time pe phatta hai), `{{variable}}` jo environment me hai hi nahi, aur koi
request jispe assertion hi nahi hai.

**JSON hand-edit mat karein.** Naya case add karna ho to generator me add karke re-run
karein.

| File | Kya |
|---|---|
| `lib/builders.js` | Teeno collections ke shared builders — request, assertions, envelope |
| `lib/routeGates.js` | Har route ka **asli gate**, `routes/` se padha gaya |
| `lib/capture-examples.js` | Live run se asli responses capture karke examples me daalta hai |
| `lib/assertUniqueNames.js` | Duplicate request name pe build fail karta hai (capture name pe key karta hai) |
| `lib/validate-collection.js` | Pre-import sanity checks |
| `generate-customer-collection.js` | Customer collection |
| `generate-vendor-collection.js` | Vendor collection |
| `../scripts/seedPostmanFixtures.js` | Fixture seeder (customer + vendor dono ke liye) |

---

## Vendor collection — jo customer se alag hai

### Do tokens

| Token | Kaun | Kis liye |
|---|---|---|
| `vendor_token` | Seeded vendor — brand approved + subscribed | Baaki saare folders |
| `onboard_token` | Har run pe naya throwaway vendor | Sirf folder `04 — Onboarding` |

Onboarding ek **state machine** hai. Seeded brand us machine ke aakhir me khada hai, to
uspe onboarding steps chalane ka matlab ya refusal hai ya usko peeche dhakelna. Isliye wo
folder apna alag vendor banata hai.

### Har poore pass se pehle seed karein

Vendor collection idempotent **nahi** hai, aur ho bhi nahi sakti — voucher lifecycle
one-way hai:

```
DRAFT ──submit──▶ UNDER_REVIEW ──[admin]──▶ APPROVED ──publish──▶ PUBLISHED
```

Ek pass DRAFT ko `UNDER_REVIEW` aur APPROVED ko `PUBLISHED` kar deta hai. Doosre pass me
un dono ke liye input bacha hi nahi hota. Assertions us refusal ko accept karti hain aur
console pe bata deti hain, par wo teen endpoints tabhi **actually** verify hote hain jab
seed fresh ho.

### Jo headless verify nahi ho sakta — 10 endpoints

| Kya | Kitne | Kyun |
|---|---:|---|
| KYC verify | 3 | Live CGPey calls |
| Razorpay order + verify | 2 | Live Razorpay calls |
| Test push | 1 | Live Firebase call |
| File uploads | 4 | Multipart with a real file |

In sab pe assertions success **aur** documented failure dono accept karte hain, aur kisi
*aur* tarah ke failure pe fail ho jaate hain — to wo abhi bhi ek real check hai, bas
kamzor. File fields request me maujood hain par **disabled**; enable karke file chunein to
success path chal jaata hai.

```bash
newman run postman/trydood-vendor.postman_collection.json \
  -e postman/environments/vendor-local.postman_environment.json \
  --env-var "vendor_whatsapp=9700000011"
```
