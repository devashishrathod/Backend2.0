# Postman — Trydood 2.0

Ek collection per panel. Har collection **generate hoti hai**, hand-likhi nahi — enums,
limits aur defaults `constants/` se seedhe padhe jaate hain, to collection API ke baare me
jhooth nahi bol sakti.

| Collection | Endpoints | Status |
|---|---:|---|
| `trydood-customer.postman_collection.json` | 48 | ⚠️ 105 requests · **132 captured examples** — 17 naye (Voucher Claims + Refunds) **abhi capture nahi hue** |
| `trydood-vendor.postman_collection.json` | 89 | ⚠️ 112 requests · **105 captured examples** — 13 naye (Voucher Claims + Refunds) **abhi capture nahi hue** |
| `trydood-admin.postman_collection.json` | 114 | ⬜ Phase 3 |
| `trydood-security-changes.postman_collection.json` | – | ⏳ Teeno panel collections ready hone par retire hogi |

Companion docs: [`../docs/customer_mobile_api_doc.md`](../docs/customer_mobile_api_doc.md) ·
[`../docs/vendor_panel_api_doc.md`](../docs/vendor_panel_api_doc.md) ·
[`../docs/endpoints_category.md`](../docs/endpoints_category.md)

---

## Naye endpoints haath se jode jaate hain, generate nahi

Voucher-claim ke 18 aur refund ke 12 requests do scripts ne **jode** — generator kabhi
nahi chalaya gaya:

```bash
node scripts/addClaimRequestsToPostman.js           # kya badlega
node scripts/addClaimRequestsToPostman.js --apply   # badlo

node scripts/addRefundRequestsToPostman.js
node scripts/addRefundRequestsToPostman.js --apply
```

Script sirf **insert** karti hai aur teen guard rakhti hai:

1. **Byte-exact round-trip** — likhne se pehle jaanchti hai ki `JSON.stringify(…, 2)` + CRLF
   file ko hu-ba-hu dobara banata hai. Na bane to likhti hi nahi. Warna har line reformat
   hoti aur asli badlaav 20,000-line diff me dab jaata (in files me **CRLF** line endings hain)
2. **Captured example count** — insert se pehle aur baad me ginti karti hai; badal jaye to
   likhne se mana kar deti hai. Insert karne me ek bhi example nahi jaana chahiye
3. **Folder number** — naya folder access-control wale ka number **le leta hai** aur wo ek
   aage badh jaata hai. Pehli koshish me dono collections me do-do folder `12` / `19` ban
   gaye the: Postman array order me dikhata hai, isliye kuch error nahi hota aur kisi ko
   pata nahi chalta

⚠️ **In 30 requests ke examples abhi capture nahi hue.** Neeche wala capture step chalana
baaki hai — usme `newman` chahiye, jo is machine par install nahi hai.

---

## Examples haath se nahi likhe jaate

Har saved example ek **asli response** hai, live run se capture kiya gaya:

```bash
# 1. Fixtures
node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply

# 2. Server usi database pe
MONGO_URL="<...>/Trydood2_postman" npm run dev

# 3. Capture — collection chalti hai aur har response wapas usi file me examples ban jaata hai
node postman/lib/capture-examples.js \
  postman/trydood-customer.postman_collection.json \
  postman/environments/customer-local.postman_environment.json
```

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

### 2. Sirf ek variable bharna hai

`customer_whatsapp` — koi bhi 10-digit number jo `6-9` se shuru ho. Collection khud us
number se signup kar legi.

Baaki sab (`customer_token`, `brand_id`, `voucher_id`, …) folder `00` se aage **apne aap**
capture hota jaata hai.

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
| 2 brands + 1 outlet each | ek pinned as Top Brand |
| 10 brand features | profile ka 10-cap exercise karne ke liye |
| 1 visible showcase (8 media) + 1 hidden | dono showcase endpoints ka farak dikhane ke liye |
| 2 published vouchers | ek suggested + IMAGE banner, ek plain (`bannerType: null`) |
| 1 banner + 2 tickers | home screen |
| 1 terms + 1 privacy | legal |

Re-runnable hai — apne hi documents pehle clear karta hai, duplicate nahi banata.

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
| `00 — Setup & Auth` | WhatsApp login, token capture, `isFirst` regression, ADMIN self-signup block |
| `01 — User Profile` | Get / update (multipart), aur `DELETE /users/delete` ka no-op behaviour |
| `02 — Location` | Upsert + read, coordinate order aur zipcode ke traps |
| `03 — Master Data` | Categories, sub-categories |
| `04 — Home Screen` | Banner (`null` ho sakta hai) aur tickers (`[]` ho sakta hai) |
| `05 — Vouchers` | Feed, Suggestions tab, detail, discount preview + convenience fee |
| `06 — Brand Profile` | Directory, Top Brands tab, profile, showcase, video clips, features |
| `07 — Engagement` | Follow / avoid toggles + lists |
| `08 — Legal` | Terms aur privacy reads |
| `09 — Push Notifications` | Device register / list / test / unregister |
| `10 — Access control` | Negative tests — customer token in endpoints pe refuse hona chahiye |

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
