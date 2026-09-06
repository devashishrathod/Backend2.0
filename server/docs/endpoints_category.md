# Trydood 2.0 — Endpoint Categorization Map

**Purpose:** Har backend endpoint ko uske consumer (Guest / Customer Mobile App / Vendor Panel / Super Admin Panel) ke hisaab se categorize karna, taaki alag-alag API documentation files aur Postman collections banayi ja sakein.

**Status:** ✅ **Round 6 — email verification, notification inbox, public app config (2026-09-05).**

**Base URL:**
- Local: `http://localhost:8080/trydood/v1`
- Staging: `https://backend2-0-4v4i.onrender.com/trydood/v1`

**Framework:** Express.js (CommonJS) · **DB:** MongoDB (Mongoose)
**Route mounting:** `routes/index.js` auto-mounts har file ko uske filename se → `routes/subBrands.js` = `/trydood/v1/subBrands` (camelCase preserved). Do file `routePrefix` override karti hain — `voucherClaims.js` → `/voucher-claims`, `customerBankAccounts.js` → `/bank-accounts`.

**Scanned:** 2026-09-05 · **Total endpoints: 216** (+3 utility/non-versioned)

> ### ⚠️ Ye ginti pichhli baar 53 endpoint peeche reh gayi thi
>
> Pichhli file me `Status:` line **149** kehti thi jabki usi file ki `Scanned:` line
> **202** keh rahi thi — dono ek saath, do jagah, mahino tak. Neeche ke saare
> per-module tables 149 wale purane scan ke the, to **60 endpoint kisi table me
> the hi nahi**, jinme do poore module (`/bank-accounts`, `/customers`) shaamil hain.
>
> Isliye ginti hamesha introspection se, route files hand-count karke nahi —
> aur **jis din nikaali gayi ho usi din sach maani jaaye**:
>
> ```bash
> node -e "const fs=require('fs');let t=0;for(const f of fs.readdirSync('routes')){if(f==='index.js'||!f.endsWith('.js'))continue;const r=require('./routes/'+f),R=r.router||r;if(typeof R==='function'&&R.stack)t+=R.stack.filter(l=>l.route).length}console.log(t)"
> ```
>
> ⚠️ Ye snippet `extraRoutes` aur `routePrefix` ko nahi ginta. Poora dump —
> method, path, aur har route ka middleware chain — ke liye
> `scripts/dumpRoutes.js` pattern use karo (Round 5 me isi se ye file bani).

---

## Legend

| Tag | Meaning | Kis doc me jayega |
|---|---|---|
| 🟠 **GUEST** 🆕 | **Bina login** chalta hai — guest app surface | `guest` section + `customer_mobile_api_doc.md` |
| 🟢 **CUSTOMER** | Sirf customer mobile app ke liye | `customer_mobile_api_doc.md` |
| 🔵 **VENDOR** | Sirf vendor/brand panel ke liye (outlet/SUB_VENDOR bhi isi me) | `vendor_panel_api_doc.md` |
| 🟣 **ADMIN** | Sirf super admin panel ke liye | `super_admin_panel_api_doc.md` |
| ⚪ **GLOBAL** | 2+ panels use karte hain | Saare relevant docs me (panel-specific note ke saath) |
| 🤖 **MACHINE** 🆕 | Koi insaan-role nahi — webhook ya signed link | Admin doc me reference ke liye |

**Access column format:**

```
Intended: <jiske liye banaya gaya hai>  ·  Enforced: <backend actually kya rokta hai>
```

`Enforced` values:

| Value | Matlab |
|---|---|
| `Public` | Koi token nahi, koi gate nahi |
| `optionalAuth` | Token **optional** — guest ko jawab milta hai, par jo token de wo **valid hona chahiye** (expired = 401, silent guest-downgrade nahi) |
| `Public (HMAC)` | Token nahi, authenticity raw body ke HMAC se |
| `Public (token)` | Token nahi, 32-byte random URL token hi credential hai |
| `Any authenticated` | Sirf `verifyJwtToken` — role check **nahi** hai |
| `Any auth (scope)` | `verifyJwtToken`, par scope + projection **token se** derive hote hain (ek endpoint, kai shapes) |
| `ADMIN` / `VENDOR` / `CUSTOMER` / `VENDOR+ADMIN` / `VENDOR+SUB` | Role middleware se enforced |
| `+ ownership` | `resolveActorBrand` / `assert*Access` se brand ya customer-level ownership bhi |
| `…EvenIfDeactivated` | `isActive` check jaan-boojh kar relax — deactivated user ko phasne se bachata hai |

---

## 🟠 GUEST category kya hai — aur kya nahi hai

**212 me se 35 endpoint koi token nahi maangte.** Par wo teen alag kism ke hain, aur
sabko "guest" keh dena ek asli farq mita deta hai:

| Kism | Kitne | Tag | Kyu alag |
|---|---:|---|---|
| **Guest browse** — bina login app dekhna | **22** | 🟠 GUEST | Yahi asli guest mode hai: brand profile, voucher listing, home banners, legal pages, search |
| **Auth entry** — login / OTP / password | 9 | 🟣 ya ⚪ | Public hona **majboori** hai, warna koi login hi na kar paaye. Ye "browsing" nahi hai — inhe GUEST me daalna guest surface ko 9 endpoint bada dikhata jo asal me sirf darwaza hain |
| **Machine / signed link** | 4 | 🤖 MACHINE | Razorpay webhooks (HMAC) aur do signed-link download. Koi insaan-role nahi — inhe guest doc me daalna galat audience ko dikhana hai |

> ### ⚠️ 4 guest endpoint `optionalAuth` par hain, `Public` par nahi — ye farq load-bearing hai
>
> `GET /search` · `GET /vouchers/customer/get-all` · `GET /vouchers/customer/get/:voucherId` · `POST /vouchers/customer/voucher/preview`
>
> Inpe **koi gate na hona** ek bug tha, guest-friendliness nahi. Ye handlers
> `req.userId` padhte hain taaki signed-in customer ka **saved address** missing
> coordinates ki jagah le sake — aur gate ke bina `req.userId` us caller ke liye
> bhi `undefined` rehta hai jo bilkul sahi token de raha ho. Nateeja: in teeno
> voucher endpoints ne **sabke liye** `404 "Customer not found."` diya.
>
> `optionalAuth` dono kaam karta hai — guest ko andar aane deta hai, aur token
> hone par use resolve karta hai. Aur jo token **hai** wo valid hona chahiye:
> expired token par `401`, chup-chaap guest view par downgrade **nahi** —
> warna session expire hone par customer ko apni saved location aur history
> gayab dikhti aur kahin koi error nahi hota.
>
> Isliye ye chaar **dono** category me hain: 🟠 GUEST + 🟢 CUSTOMER.

> ### `/search/history` guest ke liye khula **nahi** hai — aur ye soch-samajh kar hai
>
> Baaki search endpoints `optionalAuth` par hain, par teen history wale `isCustomer`
> par. Guest ki recent searches uske **device par** rehti hain: yahan koi anonymous
> identity nahi hai jispar row key ki ja sake. Guest ko khaali list dena ye daava
> hoga ki *"tumne kuch search nahi kiya"*, jabki uski history bas wahan hai jahan
> ye endpoint dekh nahi sakta.

---

## Summary — 216 endpoints

| # | Module | Base path | Total | 🟠 | 🟢 | 🔵 | 🟣 | ⚪ | 🤖 |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Auth | `/auth` | 14 | – | – | – | 5 | 9 | – |
| 2 | Users | `/users` | 3 | – | – | – | – | 3 | – |
| 3 | Customers 🆕 | `/customers` | 2 | – | – | – | 2 | – | – |
| 4 | Device Tokens | `/deviceTokens` | 4 | – | – | – | – | 4 | – |
| 5 | Notifications | `/notifications` | 7 | – | – | – | 3 | 4 | – |
| 6 | Brands | `/brands` | 19 | 2 | – | 8 | 6 | 3 | – |
| 7 | Verification (KYC) | `/verification` | 3 | – | – | 3 | – | – | – |
| 8 | Sub Brands (Outlets) | `/subBrands` | 3 | – | – | – | – | 3 | – |
| 9 | Work Hours | `/workHours` | 1 | – | – | – | – | 1 | – |
| 10 | Locations | `/locations` | 6 | – | 1 | – | – | 5 | – |
| 11 | Showcase | `/showcase` | 13 | 2 | – | – | – | 11 | – |
| 12 | Brand Features | `/brandFeatures` | 5 | 2 | – | – | – | 3 | – |
| 13 | Vouchers | `/vouchers` | 13 | 3\* | 3\* | – | 3 | 7 | – |
| 14 | Banners (App-level) | `/banners` | 6 | 1 | – | – | 5 | – | – |
| 15 | Promotional Tickers | `/promotionalTickers` | 6 | 1 | – | – | 5 | – | – |
| 16 | Categories | `/categories` | 5 | 2 | – | – | 3 | – | – |
| 17 | Sub Categories | `/subCategories` | 5 | 2 | – | – | 3 | – | – |
| 18 | Search | `/search` | 5 | 2\* | 4\* | – | – | – | – |
| 19 | Follows | `/follows` | 2 | – | 2 | – | – | – | – |
| 20 | Brand Avoidances | `/brandAvoidances` | 2 | – | 2 | – | – | – | – |
| 21 | Subscriptions (Plans) | `/subscriptions` | 5 | – | – | – | 3 | 2 | – |
| 22 | Subscribeds | `/subscribeds` | 8 | – | – | – | 6 | 2 | – |
| 23 | Promo Codes | `/promoCodes` | 6 | – | – | – | 6 | – | – |
| 24 | Transactions | `/transactions` | 15 | – | – | 1 | 6 | 5 | 3 |
| 25 | Voucher Claims | `/voucher-claims` | 7 | – | 2 | – | – | 5 | – |
| 26 | Customer Bank Accounts 🆕 | `/bank-accounts` | 4 | – | 4 | – | – | – | – |
| 27 | Refunds | `/refunds` | 14 | – | 3 | 2 | 7 | 2 | – |
| 28 | Disputes | `/disputes` | 4 | – | – | 1 | 1 | 2 | – |
| 29 | Settlements | `/settlements` | 16 | – | – | – | 12 | 3 | 1 |
| 30 | Settings | `/settings` | 2 | – | – | – | 2 | – | – |
| 31 | Terms & Conditions | `/terms-and-conditions` | 5 | 2 | – | – | 3 | – | – |
| 32 | Privacy & Policies | `/privacy-and-policies` | 5 | 2 | – | – | 3 | – | – |
| 33 | App Config 🆕 | `/app-config` | 1 | 1 | – | – | – | – | – |
| | **TOTAL** | | **216** | **22** | **17** | **15** | **84** | **74** | **4** |

> \* **4 endpoints do category me hain** (`optionalAuth`) — teen `/vouchers/customer/*`
> aur `GET /search`. Wo 🟠 aur 🟢 dono column me ginne gaye hain, isliye
> `22 + 17 + 15 + 84 + 74 + 4 = 216` **tabhi** milta hai jab un chaar ko ek baar
> hi gina jaaye: distinct = `18 (pure guest) + 4 (dual) + 17 (customer) + 15 + 84 + 74 + 4 = 216` ✓
>
> **Round 6 me kya juda:** `/auth` me do (email verification, ⚪ — har role),
> naya `/app-config` (🟠 public), aur `/notifications` ke do endpoints ab customer
> bhi padh sakta hai — wo ⚪ hi rehte hain, unki shapes teen se chaar ho gayi.

**Per-doc endpoint count:**

| Doc | Endpoints | Breakdown | Status |
|---|---:|---|---|
| 🟠 Guest surface | **21** | Poori list neeche `§ Guest Surface` me | 🆕 Round 5 |
| 📱 `customer_mobile_api_doc.md` | **62** | 17 exclusive + 22 guest + 22 shared global + 1 🤖 invoice link | ✅ **v1.7.0 — poora.** Live verified: 135 requests · 473 assertions · 0 failed · 198 captured examples |
| 🏪 `vendor_panel_api_doc.md` | **97** | 15 exclusive + 70 shared global + 10 guest reads + 2 🤖 links | ⚠️ v1.2.1 me 78 the — 19 naye jodne hain |
| 🛡️ `super_admin_panel_api_doc.md` | **170** | 82 exclusive + 70 shared global + 14 guest reads + 4 🤖 reference | ⬜ Baaki |

> Sum > 216 kyunki shared endpoints kai docs me aate hain.
>
> **Cross-check:** har endpoint kam se kam ek doc me hai —
> 🟠 21 (customer doc me saare 21) · 🟢 17 (customer) · 🔵 15 (vendor) ·
> 🟣 82 (admin) · ⚪ 70 (vendor + admin, jinme 18 customer bhi) ·
> 🤖 4 (admin reference). **Koi endpoint chhoota nahi.** ✓
>
> ### ⚠️ Per-doc ginti "reachable" nahi hai — do baar ghatayi jaati hai
>
> Route ka gate poora jawab nahi deta. **6 endpoints bare `verifyJwtToken` par
> baithe hain aur phir CUSTOMER ko service ke andar `403` dete hain** —
> disputes (#148, #178, #181) aur settlements (#195, #196, #197) ka `scopeFor`.
> Inhe customer-reachable ginna theek wahi galti hai jisne purane doc ke per-doc
> numbers bekaar kar diye the.
>
> Uske upar **do product decisions** (gate nahi):
>
> - **#120, #121** — plan catalogue vendor/admin tooling hai
> - **#5–#8** — customer auth **sirf WhatsApp OTP** hai. Email/mobile OTP routes
>   public hain aur unka validator har role allow karta hai, to customer unhe use
>   *kar sakta* hai; app karta nahi, aur inhe customer surface likhna ek doosra
>   login path bulaawa dena hai jo kisi ne banaya hi nahi
>
> Ye teeno list `scripts/`-style ek hi jagah likhi hain — per-doc ginti **derive**
> hoti hai, haath se jodi nahi jaati. Isi liye Round 5 me teen per-doc tables ki
> ginti pakdi gayi (56→57, 95→97, 166→170).

---

## 🆕 Round 4 → Round 5 me kya badla

**Scan:** 2026-09-04 · 149 (documented) → **209 (actual)** = **+60**

### Do poore module jo kisi table me nahi the

| Module | Endpoints | Kya karta hai | Cat |
|---|---:|---|---|
| `/bank-accounts` 🆕 | 4 | Customer ke bank accounts — OTP, add (penny-drop), list, soft delete. Refund jab **wapas usi raaste se nahi ja sakta** tab yahi destination banta hai | 🟢 CUSTOMER (4) |
| `/customers` 🆕 | 2 | Admin ka customer directory + ek customer ka poora support screen | 🟣 ADMIN (2) |

### Existing modules me naye endpoints — 25

| Module | Naye | Kya |
|---|---:|---|
| `/brands` | +2 | `admin/get-all` (brand triage directory) · `admin/:brandId/status` (account on/off switch — **brand aur owning vendor dono**) |
| `/refunds` | +5 | `:requestId/bank-account` (customer batata hai kahan bheja jaaye) + 4 `admin/*` MANUAL_BANK routes: `request-bank-details` · `pay-to-bank` · `confirm-bank-payout` · `fail-bank-payout` |
| `/settlements` | +16 | Poora module pehli baar table me — `statement/:token` (public), `admin/*` ke 12, aur 3 scoped reads. `admin/:settlementId/abandon` bhi naya |
| `/transactions` | +2 | `admin/health` · `admin/:transactionId/release-hold` |
| `/voucher-claims` | +7 | Poora module pehli baar Summary table me |
| `/disputes` | +4 | Poora module pehli baar Summary table me |
| `/search` | +5 | Poora module pehli baar Summary table me |

### 🟠 Naya GUEST category — 21 endpoints

Pichhli file me ye endpoints `Enforced: Any authenticated` likhe the. **Wo ab sach
nahi hai** — 17 par koi gate hai hi nahi aur 4 `optionalAuth` par hain. Poori list
`§ Guest Surface` me.

Sabse badi chaal: `/brands/customer/*`, `/showcase` ke customer reads,
`/brandFeatures` ke reads, `banners`/`tickers` ke `customer/active`, aur poora
`categories`/`subCategories`/`terms`/`privacy` read side — **sab public ho gaya**,
kyunki brand browse karne wala customer abhi tak sign-in kiya bhi nahi hota.

### 🤖 Naya MACHINE category — 4 endpoints

`webhook/razorpay` · `webhook/razorpay/customer` · `transactions/invoice/:token` ·
`settlements/statement/:token`. Pehle ye 🟣 ADMIN me pade the, jo padhne me lagta
tha ki admin panel inhe call karta hai. Karta nahi — pehle do Razorpay call karta
hai, baaki do wo link hain jo WhatsApp/email se seedha browser me khulte hain.

### Category corrections — jo pehle galat likha tha

| Endpoint(s) | Pehle | Ab | Kyu |
|---|---|---|---|
| `/auth/forgot-password` · `/reset-password` | ⚪ GLOBAL, "Intended: All" | 🟣 **ADMIN** | Validator me `role` sirf `ROLES.ADMIN` **valid** hai (`validator/auth.js`). Password sign-in hi admin-only hai — baaki har role OTP se aata hai, to unke liye password ek chori hone wali cheez ke alawa kuch nahi |
| `/auth/login` | 🟣 "Enforced: Public" | 🟣 **Public, validator ADMIN-only** | Wahi baat — refusal Joi se aata hai, isliye saaf `422` milta hai, confusing "user not found" nahi |
| `/showcase/section/*` ke 9 | 🔵 VENDOR-exclusive, "Any authenticated" | ⚪ **VENDOR+ADMIN** | Sab 11 managed routes `isVendorOrAdmin` par hain, aur services (`resolveSectionForActor`) admin ko **kisi bhi** brand par act karne dete hain. Inhe vendor-exclusive ginna hi wo wajah thi jisse admin count 114 aaya |
| `/banners/*` · `/promotionalTickers/*` writes | "Any authenticated ⚠️" | 🟣 **ADMIN** | ✅ Fix ho gaya. Pehle customer ka apna token home screen ke banners edit/delete kar sakta tha |
| `/locations/getAll` | "Any authenticated ⚠️ customer sabke addresses dekh sakta hai" | ⚪ **VENDOR+ADMIN** | ✅ Fix ho gaya |
| `/workHours/upsert` | 🔵 "Any authenticated ⚠️" | ⚪ **VENDOR+ADMIN** | ✅ Fix ho gaya |
| `/brandFeatures` writes | "Any authenticated ⚠️" | ⚪ **VENDOR+ADMIN** | ✅ Fix ho gaya |
| `/subBrands/get-all` | "Any authenticated ⚠️ role gate missing" | ⚪ **VENDOR+ADMIN** | ✅ Fix ho gaya |
| `/vouchers/customer/*` | 🟢 "Any authenticated" | 🟠 + 🟢 `optionalAuth` | Neeche wala box dekho — gate ka **na hona** bug tha |

### ✅ Round 4 ke ⚠️ findings — ab kya haal hai

| Finding | Round 4 | Ab |
|---|---|---|
| `/banners` · `/promotionalTickers` — koi role gate nahi | 🟠 Open | ✅ `isAdmin` |
| `/brandFeatures` writes — koi role gate nahi | 🟠 Open | ✅ `isVendorOrAdmin` |
| `/locations` — ownership + `getAll` leak | 🟠 Open | ✅ `isVendorOrAdmin` / `isCustomer` split |
| `/showcase` — bare `verifyJwtToken`, brand scoping commented out | 🟠 Open | ✅ `isVendorOrAdmin` + services me per-request ownership |
| `/subBrands/get-all` — role gate missing | 🟠 Open | ✅ `isVendorOrAdmin` |
| `/workHours/upsert` — role gate missing | 🟠 Open | ✅ `isVendorOrAdmin` |
| `settlementHold` ka koi exit nahi | 🔴 Open | ✅ `PATCH /transactions/admin/:transactionId/release-hold` |
| `MANUAL_BANK` refund ka koi raasta nahi | 🔴 Open | ✅ 4 naye `admin/*` routes + `/bank-accounts` module |
| `FAILED` settlement ka koi exit nahi | 🟠 Open | ✅ `admin/:settlementId/abandon` |
| WhatsApp OTP verify commented out | ⏸️ Deferred | ⏸️ **Ab bhi deferred** — aapka decision |
| `DELETE /users/delete` no-op | ⏸️ Deferred | ⏸️ **Ab bhi no-op** — [account_deletion_plan.md](./account_deletion_plan.md) |
| `/users/get` · `/update` — `?userId` IDOR | ✅ Fixed | ✅ Token se aata hai |

### ⚠️ Jo ab bhi khula hai

| # | Endpoint | Kya |
|---|---|---|
| 15 | `DELETE /users/delete` | **No-op stub** — `200 "User deleted successfully"` deta hai aur kuch delete nahi karta. Route file me inline handler hai, koi controller bhi nahi. ⚠️ Ye galat tarah se khatarnak hai: customer app "account deleted" dikha deta hai, phir wahi login kaam karta rehta hai |
| 4 | `POST /auth/verify-otp-whatsapp` | OTP verify **commented out** — sahi format ka koi bhi code chal jaata hai |
| 110 | `GET /search` | `optionalAuth` — expired token par `401`. Client ko iska matlab "sign out karo" samajhna chahiye, "guest ban jao" nahi |

---

## Older history (Round 2 → 4)

<details>
<summary>Round 2 → Round 3 (2026-08-21, 108 → 143)</summary>

### Naye modules (4) — 21 endpoints

| Module | Endpoints | Kya karta hai | Primary consumer |
|---|---:|---|---|
| `/promoCodes` | 6 | Subscription promo codes — CRUD + usage report | 🟣 ADMIN (poora module `router.use(isAdmin)`) |
| `/subscribeds` | 8 | Subscription lifecycle — grant, cancel, resync, forfeit compensation, history | 🟣 ADMIN (6) + ⚪ Vendor/Admin (2) |
| `/deviceTokens` | 4 | Push notification device registration | ⚪ **All roles** (role-agnostic by design) |
| `/notifications` | 3 | In-app notification feed + admin broadcast | ⚪ Vendor+Admin (2) + 🟣 ADMIN (1) |

### 🔒 `resolveActorBrand` helper aaya — [helpers/brands/resolveActorBrand.js](../helpers/brands/resolveActorBrand.js)

Ownership enforcement ka proper pattern:
- **ADMIN** ko `brandId` dena mandatory hai, koi bhi brand chun sakta hai
- **VENDOR** default apna brand, aur **sirf apna** — brand ka `userId` token ke `userId` se match hota hai (token ka cached `brandId` trust nahi karta, wo smart hai)

### Shared default password issue fix ✅

`User.password` optional ho gaya (`required: true` hata), `passwordSetAt` add hui, aur proper `set-password` / `forgot-password` / `reset-password` flow aaya. Pehle har OTP account ek hi known password pe banta tha.

</details>

<details>
<summary>Round 3 → Round 4 (2026-08-26, 143 → 149)</summary>

### Naye middleware

| Name | Kya |
|---|---|
| `isVendorOrAdmin` | Customer ko vendor/admin shared routes se bahar rakhta hai; vendor ke liye `req.brandId` set karta hai |
| `isSubVendor` | Outlet-level actor |

### Naye endpoints — 6

`GET /brands/customer/get/:brandId` · `GET /brands/customer/get-all` ·
`PUT /brands/admin/top-brands/:brandId` · `GET /brands/admin/top-brands` ·
`PUT /vouchers/admin/suggestions/:voucherId` · `GET /vouchers/admin/suggestions`

### Existing endpoints me naye fields

| Endpoint | Naya |
|---|---|
| `GET /vouchers/customer/get-all` | `suggestedOnly` param · `bannerType` · `bannerUrl` · `isSuggested` · `isOutOfRange` |
| `POST /vouchers/customer/voucher/preview` | `offerApplied` · `pricing.convenienceFee` · `pricing.promoDiscount` · no-offer fallback (ab error nahi) |
| `GET /categories/getAll` · `/get/:id` | `stats.subCategories` · `stats.brands` · `stats.vouchers` · `stats.promoCodes`, har ek `{ total, active }` |
| `DELETE /categories/delete/:id` · `/subCategories/delete/:id` | Naya `400` — jab tak koi sub-category / brand / voucher use kar raha hai, delete nahi hoga |
| `GET /vouchers/customer/get-all` | 🔴 `categoryId` / `subCategoryId` **filter ab kaam karta hai** — pehle har category-filtered request `404` deti thi. Taxonomy `VoucherVersion` par hai, `Voucher` par nahi thi |
| `GET /vouchers/customer/get-all?search=` | Offer ka title bhi match hota hai, aur term ab escape hoti hai — `(` type karne pe `500` nahi aata |
| `POST /auth/logout` | Naya optional body — `pushToken` aur `allDevices`. Pehle ye endpoint kuch karta hi nahi tha |
| Har login response | `isLoggedIn` / `isOnline` **ab sach me set hote hain** — 7 me se 4 token-dene wale paths inhe kabhi set hi nahi karte the |

</details>

---

# A. Identity & Access

## 1. Auth — `/auth` (14)

> ⚠️ **Is router par koi blanket gate nahi hai** — har route apna gate likhta hai,
> kyunki 9 me se koi bhi entry point token nahi de sakta (wahi to unka kaam hai).

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `role` **required**, koi default nahi. `ADMIN` self-signup block. Pehla admin `scripts/seedAdmin.js` se |
| 2 | POST | `/auth/login` | Intended: ADMIN · Enforced: Public, **validator ADMIN-only** | 🟣 | Password login. `type`: `EMAIL` \| `MOBILE` \| `USERNAME`. Role restriction validator me hai, route pe nahi — refusal saaf `422` banta hai, confusing "user not found" nahi. Fail-closed: jinhone password set nahi kiya unpe login fail |
| 3 | POST | `/auth/loginOrSignUp-with-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | `role` default `CUSTOMER`, `ADMIN` **block**. Naya number → user + `Customer`/`Brand` ek transaction me. `isFirst` verification state pe hai, document existence pe nahi |
| 4 | POST | `/auth/verify-otp-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | OTP verify → JWT. ⚠️ **Verify commented out** — sahi format ka koi bhi code chal jaata hai |
| 5 | POST | `/auth/login-with-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ | Email OTP send. `role` default `ADMIN`, par har role valid |
| 6 | POST | `/auth/verify-otp-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ | |
| 7 | POST | `/auth/login-with-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ | Mobile OTP send |
| 8 | POST | `/auth/verify-otp-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ | |
| 9 | POST | `/auth/set-password` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Pehli baar password set, ya change. OTP accounts bina password ke bante hain |
| 10 | POST | `/auth/forgot-password` | Intended: ADMIN · Enforced: **Public**, validator ADMIN-only | 🟣 | ✅ Account exist kare ya na kare — **same response**, to enumeration nahi ho sakti. ⚠️ Category badli: ye ⚪ nahi hai, validator me `role` sirf `ADMIN` valid hai |
| 11 | POST | `/auth/reset-password` | Intended: ADMIN · Enforced: Public, validator ADMIN-only | 🟣 | 2-step flow ka step 2. Deactivated account par `403` |
| 12a 🆕 | POST | `/auth/email/send-verification` | Intended: All · Enforced: **Any authenticated** | ⚪ | Email confirm ya change ka code. `email` **optional** — na do to account ka apna address, do to us par switch. ⚠️ Code **naye** address par jaata hai; purane par bhejna sirf ye sabit karta ki wo purana mailbox padh lete hain, jo sawal hai hi nahi. Uniqueness `{email, role}` par, aur **verify par dobara** check hoti hai kyunki do call ke beech minute nikalte hain. Throttle `sendOtp` me — 60s / 5 per hour, target par keyed |
| 12b 🆕 | POST | `/auth/email/verify` | Intended: All · Enforced: **Any authenticated** | ⚪ | Code se confirm. Address likhna aur `isEmailVerified: true` **ek hi save me** — do step me karne par ek pal aisa banta jahan naya address padha hai aur verified nahi, theek wahi haalat jisse nikalne ka raasta ye hai. ⚠️ `loginType` **nahi** chhua jaata: `verifyEmailOTP` use `EMAIL` karta hai kyunki wo sign-in hai, ye nahi. Code consume ho jaata hai |
| 12 | POST | `/auth/logout` | Intended: All · Enforced: **Any authenticated, EvenIfDeactivated** | ⚪ | Body optional — `pushToken` (is device ka push band), `allDevices` (har JWT + har device khatam). Response: `sessionsEnded` · `pushDeactivated` · `activeDevices` |

> ### ⚠️ Logout jaan-boojh kar deactivated account ko bhi chalta hai
>
> Baaki har gate suspended user ko `401` deta hai — wahi client ko sign-out karne
> ka signal hai. **Sign-out khud** refuse karna theek wo ek cheez hai jo use phansa
> deti hai: app "logout" bhejta hai, `401` aata hai, aur wo screen se nikal hi nahi
> paata.
>
> `…EvenIfDeactivated` sirf `isActive` check relax karta hai. `User.sessionInvalidatedAt`
> se maara gaya session yahan bhi refuse hota hai.

> **Guest surface me:** koi nahi — auth entry apni kism hai (upar `§ GUEST category` dekho)
> **Customer doc me:** #3, #4, #12 (3)
> **Vendor doc me:** #3–#8, #12 (7)
> **Admin doc me:** saare 12

---

## 2. Users — `/users` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 13 | GET | `/users/get` | Intended: All · Enforced: Any authenticated | ⚪ | ✅ `userId` token se aata hai — `?userId` query param hata diya gaya (IDOR fix) |
| 14 | PUT | `/users/update` | Intended: All · Enforced: Any authenticated | ⚪ | ✅ Wahi fix |
| 15 | DELETE | `/users/delete` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ **No-op stub.** Route file me inline handler hai — `200 "User deleted successfully"` bhejta hai aur kuch delete nahi karta. Customer app "account deleted" dikha deta hai aur wahi login chalta rehta hai. → [account_deletion_plan.md](./account_deletion_plan.md) |

> **Customer doc me:** teeno (3) · **Vendor doc me:** teeno · **Admin doc me:** teeno

---

## 3. Customers 🆕 — `/customers` (2)

Admin ka customer directory. **Poora module `isAdmin`, aur ye ittefaq nahi hai.**

> ### ⚠️ Yahan role branch jaan-boojh kar nahi hai
>
> Ye endpoints refund refusals, chargeback counts aur wallet balance report karte
> hain — **aise facts jo us insaan ko khud kabhi nahi diye ja sakte**, aur jinpe
> vendor ka bhi koi haq nahi. `getAllAdminBrands` me role branch na hone ki wahi
> wajah hai: jo projection inhe strip karti hai wo **ek edit** door hai leak se.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 16 | GET | `/customers/admin/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Triage list — identity, uske peeche ka account, spend, refunds, chargebacks, engagement, profile completeness; ek row per customer. ⚠️ `/:customerId` se **pehle** declare hai, warna literal `get-all` customer id padha jaata |
| 17 | GET | `/customers/admin/:customerId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Row ke peeche ka support screen — wahi figures + history, addresses, **masked** bank rows, referral graph, aur live refund allowance. **Mongo id ya wo `#TC64840` number** jo customer bolkar batata hai: `#` ko URL me `%23` chahiye, par bina `#` wala `TC64840` bhi chalta hai — aur ticket se paste karne wala admin wahi type karega. ⚠️ **Deleted aur deactivated customer bhi yahan khulte hain** — directory unhe chhupati hai, par *"ye account kahan gaya?"* ka jawab dena zaroori hai, aur band account par bhi refund baaki ho sakta hai |

> **Admin doc me:** dono (2) · Customer/Vendor doc me: **koi nahi**

---

## 4. Device Tokens — `/deviceTokens` (4)

Push notification device registration. **Deliberately role-agnostic** — code comment:
*"A customer's phone registers exactly the same way a vendor's does."*

> ⚠️ Gates **per route** likhe hain, `router.use` se nahi — `unregister` ko baaki
> teeno se alag gate chahiye, aur router-level middleware unse pehle chal jaata hai,
> to koi opt out nahi kar sakta.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 18 | POST | `/deviceTokens/register` | Intended: All · Enforced: Any authenticated | ⚪ | FCM token register |
| 19 | PUT | `/deviceTokens/unregister` | Intended: All · Enforced: **Any auth, EvenIfDeactivated** | ⚪ | Logout pe call karna chahiye. ⚠️ Deactivated account ko bhi chalta hai: suspended user ko apne phone par push band karne ka haq hai. Toggle server-side unke devices retire kar deta hai, par client ka apna retry refuse nahi hona chahiye |
| 20 | GET | `/deviceTokens/get-mine` | Intended: All · Enforced: Any authenticated | ⚪ | Caller ke apne devices |
| 21 | POST | `/deviceTokens/test` | Intended: All · Enforced: Any authenticated | ⚪ | Delivery check — **sirf caller ke apne devices pe** |

> **Customer doc me:** chaaron (4) · **Vendor doc me:** chaaron · **Admin doc me:** chaaron

---

## 5. Notifications — `/notifications` (7)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 22 | GET | `/notifications/get-all` | Intended: **All signed-in** · Enforced: **Any auth (scope) EvenIfDeactivated** | ⚪ | Vendor apne brand tak scoped (`resolveActorBrand`). Admin koi bhi `brandId`, ya omit karke admin-audience feed. ⚠️ Deactivated ko bhi chalta hai — **suspension samjhane wala notice yahi utarta hai**, to ise refuse karna vendor ko bina kisi in-app explanation ke bahar bitha dena hai |
| 23 | PUT | `/notifications/mark-read` | Intended: **All signed-in** · Enforced: **Any auth (scope)** | ⚪ | ⚠️ Ye exempt **nahi** hai: write hai, aur suspended account ka likhne ka koi kaam nahi |
| 23a 🆕 | GET | `/notifications/preferences` | Intended: All · Enforced: **Any authenticated** | ⚪ | Apne email / push / WhatsApp toggles padho. Role gate nahi: har role ke paas theek ek `User` hai, to *"meri preferences"* sabke liye ek hi operation hai aur id **token se** aati hai — body se nahi, isliye ye endpoint kisi aur ko address kar hi nahi sakta |
| 23b 🆕 | PUT | `/notifications/preferences` | Intended: All · Enforced: **Any authenticated** | ⚪ | Apne toggles badlo. ⚠️ Ye **vyakti** ki preference likhta hai, platform switch nahi — `Setting.<audience>` poore audience ka kill switch hai aur wo alag cheez hai. Response `blockedBy: "PLATFORM"` se batata hai jab channel platform-level par band hai, warna user apna toggle on karke sochta rehta ki kaam ho gaya |
| 23c 🆕 | GET | `/notifications/admin/preferences` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Kisi bhi user ki, profile card se — `userId`, `customerId` ya `brandId`, jo bhi screen ke paas ho |
| 23d 🆕 | PUT | `/notifications/admin/preferences` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Admin-only kyunki kisi aur ke notifications band karna ek aisa badlaav hai jo unhe dikhta nahi — `updatedBy` record karta hai kisne kiya. ⚠️ `/admin/…` routes self-service wale ke **baad** declare hain taaki koi literal path doosre ka parameter na ban jaaye |
| 24 | POST | `/notifications/broadcast` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ Platform ke **har** user tak pahunch sakta hai |

> ### 🆕 Round 6 — ab **ek endpoint, chaar shapes**
>
> Gate `isVendorOrAdmin` se `verifyJwtToken` ho gaya. Customer apni rows padhta hai,
> vendor apne brand ki, admin ya to admin feed ya kisi bhi brand ki, aur **outlet manager
> ko saaf mana** kiya jaata hai.
>
> ⚠️ Rows **pehle se likhi ja rahi thi** — `refundNotices` aur `voucherClaimNotices` dono
> `audience: CUSTOMER` par likhte hain. Sirf padhne ka raasta nahi tha: customer ko push
> milta tha aur history kahin nahi.
>
> ⚠️ Gate chauda karna sirf isliye surakshit hai ki scope **role se pehle** narrow hoti
> hai, caller ka `brandId` padhne se **pehle** — customer `resolveActorBrand` tak
> pahunchta hi nahi. `services/notifications/notificationScope.js` me, aur read + write
> dono usi ko use karte hain taaki wo kabhi asehmat na hon.
>
> ⚠️ Customer ki projection **whitelist** hai: `meta` `Mixed` hai, to sirf `claimId`,
> `claimCode`, `refundRequestId`, `transactionId`, `brandId` jaate hain. `emailError`,
> `dedupeKey`, `channels` kabhi nahi.
>
> ⚠️ **Outlet manager ko `403`**, deliberately: pehle wo pahunch hi nahi sakta tha, to
> refuse karna aaj ka behaviour badalta nahi. Aur brand ka feed unhe dena bhi saaf nahi
> hai — usme settlement amounts aur vendor-debt notices hain, jo brand owner ka mamla hai,
> ek counter ka nahi.
>
> **Customer doc me:** #22, #23 (2)
> **Vendor doc me:** #22, #23 · **Admin doc me:** teeno

---

# B. Brand side

## 6. Brands — `/brands` (19)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 25 | POST | `/brands/onboarding/add-basic-details` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | Step 1 — business name, registration status, entity type |
| 26 | POST | `/brands/onboarding/add-pan-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 27 | POST | `/brands/onboarding/add-gst-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 28 | POST | `/brands/onboarding/add-bank-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 29 | GET | `/brands/onboarding/system-verify` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Auto PAN/GST/Bank cross-match → score → `SystemVerify` doc |
| 30 | PUT | `/brands/onboarding/accept-partnership` | Intended: VENDOR · Enforced: VENDOR | 🔵 | → `SCREENS.SUBSCRIBE_PLAN` |
| 31 | PUT | `/brands/onboarding/acknowledge-approval` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Approval congratulations screen dismiss → `SCREENS.DASHBOARD` |
| 32 | PUT | `/brands/onboarding/update-basic-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Review/edit flow. Wahi controller jo #25 ka hai |
| 33 🆕 | GET | `/brands/admin/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Brand triage directory — identity, owner, verification state, plan, usage, aur deactivation trail; ek row per brand. ⚠️ **Apni pipeline hai, customer listing par role branch nahi** — wahi wajah jo `/customers` par hai. ⚠️ `/admin/:brandId/status` se **pehle** declare, warna literal `get-all` brand id padha jaata |
| 34 🆕 | PUT | `/brands/admin/:brandId/status` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | **Brand account ka on/off switch — platform par ekmatra.** `Brand.isActive` aur owning vendor ka `User.isActive` **saath** chalte hain, isliye brand har customer listing se nikal jaata hai **aur** vendor ko uski agli hi request par auth gate refuse karta hai — agle login par nahi |
| 35 | GET | `/brands/admin/verifications` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Brand verification queue |
| 36 | PUT | `/brands/admin/verifications/:brandId/review` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | approve / reject / revoke / reviewed-toggle |
| 37 | PUT | `/brands/admin/top-brands/:brandId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Top brand add / remove / reorder — ek hi endpoint dono taraf (`isTopBrand: false` = remove, naya `topOrder` = reorder) |
| 38 | GET | `/brands/admin/top-brands` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Admin view — **deactivated pinned brands bhi dikhte hain** taaki unpin ho sakein |
| 39 | GET | `/brands/verifications/history` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Shared audit trail — admin koi bhi brand, vendor sirf apna (service-level scoping) |
| 40 | GET | `/brands/customer/get-all` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Brand directory + "Top Brands" tab (`topOnly`). Geo optional. `/customer/get/:brandId` se **pehle** declare |
| 41 | GET | `/brands/customer/get/:brandId` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Public brand profile — brand + 10 features + visible showcase + outlets. Koi PII nahi |
| 42 | GET | `/brands/get` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | PAN/GST/Bank/KYC scores/subscription billing yahin rehte hain — customer ke liye #41 hai |
| 43 | PUT | `/brands/update` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |

> ### Customer ka brand profile apna endpoint hai, `/get` par role-filtered projection nahi
>
> `/get` ki pipeline brand ka PAN, GSTIN, bank account, KYC scores aur subscription
> billing join karti hai. **Chhah sensitive joins strip karne wali projection ek edit
> door hai dobara leak hone se.** #41 sirf wahi banata hai jo profile screen render
> karti hai — brand, features, visible showcase, outlets — to **strip karne ko kuch
> hai hi nahi**.

> **Guest surface me:** #40, #41 (2) · **Customer doc me:** #40, #41
> **Vendor doc me:** #25–#32, #39, #42, #43 (11) · **Admin doc me:** #33–#39, #42, #43 (9)

---

## 7. Verification / KYC — `/verification` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 44 | POST | `/verification/brands/onboarding/verify-pan` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | CGPey PAN verify |
| 45 | POST | `/verification/brands/onboarding/verify-gst` | Intended: VENDOR · Enforced: VENDOR | 🔵 | CGPey GST verify |
| 46 | POST | `/verification/brands/onboarding/verify-bank` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Penny-drop bank verify |

> **Vendor doc me:** teeno (3) · Customer/Admin doc me: **koi nahi**

---

## 8. Sub Brands / Outlets — `/subBrands` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 47 | POST | `/subBrands/signUp-with-whatsapp` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Outlet banana brand ke plan ka **slot consume** karta hai, isliye brand owner (ya admin) tak gated — kisi bhi authenticated user tak nahi. Outlet → `SUB_VENDOR` user |
| 48 | GET | `/subBrands/get-all` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | ✅ Round 4 ka missing role gate lag gaya |
| 49 | PUT | `/subBrands/update/:subBrandId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Outlet ko outlet aur franchise pool ke beech move kar sakta hai, isliye creation jaisa hi gate; ownership service me |

> **Vendor doc me:** teeno · **Admin doc me:** teeno

---

## 9. Work Hours — `/workHours` (1)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 50 | POST | `/workHours/upsert` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Brand ya uske outlet ke weekly opening hours. ✅ Gate lag gaya — target body me `brandId`/`subBrandId` se aata hai, to sirf `verifyJwtToken` ke saath **koi bhi signed-in caller kisi bhi outlet ke hours badal sakta tha** |

> **Vendor doc me:** #50 · **Admin doc me:** #50

---

## 10. Locations — `/locations` (6)

> ⚠️ **Ek `Location` model teen cheezein serve karta hai** — customer ka address,
> brand ka registered address, aur outlet ka. Neeche ke gates isi par baante hain
> ki kiska kya hai.
>
> Pehle ye saare sirf `verifyJwtToken` par the, to `GET /getAll` kisi bhi
> authenticated caller ko **platform ka har address** de deta tha — customers ke
> ghar samet.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 51 | POST | `/locations/create` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Brand/outlet address. Vendor service me apne brand se bandha, admin kisi par |
| 52 | GET | `/locations/getAll` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | ✅ Leak fix |
| 53 | PUT | `/locations/update/:id` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 54 | DELETE | `/locations/delete/:id` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 55 | POST | `/locations/upsert` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Customer ka ek saved address. ✅ Token holder tak scoped — endpoint ab `userId` **leta hi nahi** |
| 56 | GET | `/locations/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | Har role id se location padhta hai, to gate sirf "signed in" hai; **kaunsi location dikhegi wo per-role service me** decide hota hai |

> **Customer doc me:** #55, #56 (2) · **Vendor doc me:** #51–#54, #56 (5) · **Admin doc me:** wahi 5

---

## 11. Showcase — `/showcase` (13)

Brand ki photo/video gallery. **Do audience, ek hi documents ke do view.**

> ### ⚠️ Category correction — 9 endpoints 🔵 se ⚪ ho gaye
>
> Pichhli file ke 9 section-CRUD endpoints "🔵 VENDOR, Enforced: Any authenticated"
> likhe the. Dono halve galat the: gate ab `isVendorOrAdmin` hai, **aur** services
> (`resolveSectionForActor`) admin ko kisi bhi brand par act karne dete hain.
> Inhe vendor-exclusive ginna hi wo wajah thi jisse pichhla admin count 114 aaya.

> Poori file pehle bare `verifyJwtToken` par thi aur services ek `userId` lete the
> **jise wo kabhi check nahi karte the** — to koi bhi signed-in caller sirf id se
> kisi bhi brand ki gallery edit, reorder ya delete kar sakta tha. Ownership ab
> per-request services me resolve hoti hai: `resolveSectionForActor` (jo bhi
> `sectionId` se address ho) aur `resolveActorBrand` (jahan `brandId` naam se aaye).

### 11a. Sections (6) — sab ⚪, Enforced: **VENDOR+ADMIN**

| # | Method | Endpoint | Notes |
|---|---|---|---|
| 57 | POST | `/showcase/section/add` | Duplicate title → `409` |
| 58 | GET | `/showcase/section/get/:sectionId` | |
| 59 | GET | `/showcase/section/get-all` | ✅ Brand scoping ab kaam karti hai — vendor apne brand par pinned, admin global |
| 60 | PUT | `/showcase/section/update/:sectionId` | |
| 61 | PUT | `/showcase/section/:brandId/reorder` | |
| 62 | DELETE | `/showcase/section/delete/:sectionId` | |

### 11b. Media (5) — sab ⚪, Enforced: **VENDOR+ADMIN**

| # | Method | Endpoint |
|---|---|---|
| 63 | POST | `/showcase/section/:sectionId/add-media` |
| 64 | PATCH | `/showcase/section/:sectionId/media/update/:mediaId` |
| 65 | PUT | `/showcase/section/:sectionId/media/replace/:mediaId` |
| 66 | PUT | `/showcase/section/:sectionId/media/reorder` |
| 67 | DELETE | `/showcase/section/:sectionId/media/delete/:mediaId` |

**Managed view** (57–67) **wo sab deta hai jo soft-deleted nahi hai** — hidden aur
switched-off content bhi, kyunki vendor ko usi ki zarurat hai use **wapas on karne**
ke liye.

### 11c. Guest-facing (2)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 68 | GET | `/showcase/get-brand-showcase/:brandId` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Poori gallery — sirf `isVisible` sections, `isActive` media, display order me. ⚠️ Clips feed se opt-out kiya media phir bhi apne album ka hissa hai, isliye `isShowInVideoClips` yahan **jaan-boojh kar filter nahi** hai. `storage`/`metadata` strip |
| 69 | GET | `/showcase/:brandId/video-clips` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Reels feed, uske upar **double opt-in** filter. ⚠️ `/:brandId` wildcard first segment hai, to ye route file ke **har literal path ke neeche** rehna chahiye — warna `/section/...` aur `/get-brand-showcase/...` brand id padhe jaate |

> Guest-facing dono `/brands/customer/*` ki tarah **public** hain: gallery brand ke
> public profile ka hissa hai, aur brands browse karne wala customer abhi sign-in
> kiya bhi nahi hota. Storage internals aur vendor ke apne toggles server se bahar
> kabhi nahi jaate.

> **Guest surface me:** #68, #69 (2) · **Customer doc me:** #68, #69
> **Vendor doc me:** #57–#67 (11) · **Admin doc me:** #57–#67 (11)

---

## 12. Brand Features — `/brandFeatures` (5)

Brand ke highlight points. Max **10 active** per brand.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 70 | POST | `/brandFeatures/add` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | `brandId` body me. ✅ Gate lag gaya — pehle customer ka token **kisi bhi** brand ke features edit kar sakta tha, kyunki `brandId` body se aata hai aur write ko kuch scope hi nahi karta tha |
| 71 | PUT | `/brandFeatures/update/:featureId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 72 | DELETE | `/brandFeatures/delete/:featureId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 73 | GET | `/brandFeatures/get-all` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | `brandId` query mandatory. Customer brand-page isse render hoti hai, isliye read khula hai |
| 74 | GET | `/brandFeatures/get/:featureId` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | |

> **Guest surface me:** #73, #74 (2) · **Customer doc me:** #73, #74
> **Vendor doc me:** saare 5 · **Admin doc me:** saare 5

---

# C. Catalogue & discovery

## 13. Vouchers — `/vouchers` (13)

**Lifecycle:** Vendor create → submit review → Admin approve/reject → publish (Vendor ya Admin) → Customer ko visible
**Note:** Har voucher write brand ke plan ka slot consume karta hai — isliye ye brand owner (ya admin) tak gated hain. Ownership khud services me `resolveActorBrand` se; route gate ka kaam sirf customers ko vendor tooling se bahar rakhna hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 75 | POST | `/vouchers/create` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Transactional, image rollback |
| 76 | PUT | `/vouchers/update/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Naya version banata hai |
| 77 | POST | `/vouchers/submit-review/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 78 | POST | `/vouchers/review/:versionId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Approval ka faisla admin ka hai, vendor ka nahi. `APPROVED` \| `REJECTED` |
| 79 | POST | `/vouchers/publish/:versionId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Sirf `APPROVED` version |
| 80 | GET | `/vouchers/versions/get-all` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 81 | PUT | `/vouchers/admin/suggestions/:voucherId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Suggested voucher add / remove / reorder — ek hi endpoint dono taraf. ⚠️ `/:voucherId/banner` se **pehle** declare, warna `admin` voucher id padha jaata |
| 82 | GET | `/vouchers/admin/suggestions` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Admin view — **expired/unpublished pins bhi** dikhte hain taaki unpin ho sakein |
| 83 | POST | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Master-level banner, version/approval flow se independent |
| 84 | DELETE | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | |
| 85 | GET | `/vouchers/customer/get-all` | Intended: Guest + Customer · Enforced: **optionalAuth** | 🟠 🟢 | Geo listing · `suggestedOnly` tab · `bannerType`/`bannerUrl`/`isSuggested`/`isOutOfRange`. `categoryId`/`subCategoryId` filter kaam karta hai. Search offer ka title bhi match karti hai aur term escape hoti hai. **Guest ko `latitude` + `longitude` khud dena padta hai** |
| 86 | GET | `/vouchers/customer/get/:voucherId` | Intended: Guest + Customer · Enforced: **optionalAuth** | 🟠 🟢 | `bannerType`/`bannerUrl` |
| 87 | POST | `/vouchers/customer/voucher/preview` | Intended: Guest + Customer · Enforced: **optionalAuth** | 🟠 🟢 | Discount + convenience fee + promo. `offerApplied` · `pricing.convenienceFee` · `pricing.promoDiscount`. Koi offer valid na ho to **error nahi** — plain bill. **Guest ko daam milta hai, order nahi** (order `/voucher-claims/create-order` par `isCustomer` hai) |

> ### ⚠️ #85–#87 par `optionalAuth` hai, "koi gate nahi" nahi — aur farq ek bug tha
>
> Ye handlers `req.userId` padhte hain taaki customer ka **saved location** missing
> coordinates ki jagah le sake. Gate ke bina wo `undefined` rehta hai **signed-in
> caller ke liye bhi** — jisne in teeno ko **sabke liye** `404 "Customer not found."`
> bana diya tha.

> **Guest surface me:** #85, #86, #87 (3) · **Customer doc me:** #85, #86, #87
> **Vendor doc me:** #75–#77, #79, #80, #83, #84 (7) · **Admin doc me:** #75–#84 (10)

---

## 14. Banners (App-level) — `/banners` (6)

> Brand se juda nahi — platform content hai, isliye manage karna admin ka kaam.
> ⚠️ **Poori file pehle bare `verifyJwtToken` par thi**, matlab customer ka apna
> token wo banners create, edit ya delete karne ke liye kaafi tha **jo app ka har
> user home screen par dekhta hai**.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 88 | POST | `/banners/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 89 | PUT | `/banners/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 90 | GET | `/banners/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 91 | GET | `/banners/get/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 92 | DELETE | `/banners/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 93 | GET | `/banners/customer/active` | Intended: Guest + Customer · Enforced: **Public** | 🟠 |

> **Guest surface me:** #93 · **Customer doc me:** #93 · **Admin doc me:** #88–#92 (5)

---

## 15. Promotional Tickers — `/promotionalTickers` (6)

Banners jaisi hi ownership story — platform content, admin-managed.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 94 | POST | `/promotionalTickers/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 95 | PUT | `/promotionalTickers/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 96 | GET | `/promotionalTickers/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 97 | GET | `/promotionalTickers/get/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 98 | DELETE | `/promotionalTickers/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 99 | GET | `/promotionalTickers/customer/active` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Display order me |

> **Guest surface me:** #99 · **Customer doc me:** #99 · **Admin doc me:** #94–#98 (5)

---

## 16. Categories — `/categories` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 100 | POST | `/categories/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 101 | GET | `/categories/getAll` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | `stats.subCategories` · `stats.brands` · `stats.vouchers` · `stats.promoCodes`, har ek `{ total, active }` |
| 102 | GET | `/categories/get/:id` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | Wahi stats |
| 103 | PUT | `/categories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 104 | DELETE | `/categories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ `400` jab tak koi sub-category / brand / voucher use kar raha hai |

> **Guest surface me:** #101, #102 · **Customer doc me:** #101, #102
> **Vendor doc me:** #101, #102 (voucher banate waqt taxonomy) · **Admin doc me:** saare 5

---

## 17. Sub Categories — `/subCategories` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 105 | POST | `/subCategories/:categoryId/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 106 | GET | `/subCategories/getAll` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | `stats.brands` · `stats.vouchers` (`promoCodes` sirf category level pe hai) |
| 107 | GET | `/subCategories/get/:id` | Intended: Guest + all panels · Enforced: **Public** | 🟠 | |
| 108 | PUT | `/subCategories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 109 | DELETE | `/subCategories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ `400` jab tak koi brand / voucher use kar raha hai |

> **Guest surface me:** #106, #107 · **Customer doc me:** #106, #107
> **Vendor doc me:** #106, #107 · **Admin doc me:** saare 5

---

## 18. Search — `/search` (5)

Customer home screen ka global search box.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 110 | GET | `/search` | Intended: Guest + Customer · Enforced: **optionalAuth** | 🟠 🟢 | Ek call me **paanch sections** — BRAND, VOUCHER, CATEGORY, SUB_CATEGORY, AREA. `?type=` dene par ek hi type, paginated. Signed-in customer ko: saved address missing coordinates ki jagah leta hai, aur committed query yaad rakhi jaati hai |
| 111 | GET | `/search/popular` | Intended: Guest + Customer · Enforced: **Public** | 🟠 | Kisi ne type karne se pehle dikhne wale chips. **Mostly guests ke liye**, jinki apni history device par hai |
| 112 | GET | `/search/history` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | `/:historyId` se **pehle** declare (literal `history` id na padha jaaye), aur `/` se bhi pehle |
| 113 | DELETE | `/search/history` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Poori history clear |
| 114 | DELETE | `/search/history/:historyId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Ek entry |

> ### History guest ke liye khula nahi hai — `isCustomer`, `optionalAuth` nahi
>
> Guest ki recent searches uske **device par** rehti hain: yahan koi anonymous
> identity nahi hai jispar row key ki ja sake. Guest ko khaali list dena ye daava
> hoga ki *"tumne kuch search nahi kiya"*, jabki uski history bas wahan hai jahan
> ye endpoint dekh nahi sakta.
>
> Design ka poora *kyun* → [global_customer_search_plan.md](./global_customer_search_plan.md)

> **Guest surface me:** #110, #111 (2) · **Customer doc me:** saare 5

---

# D. Customer engagement

## 19. Follows — `/follows` (2)

Global middleware: `router.use(isCustomer)`

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 115 | POST | `/follows/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |
| 116 | GET | `/follows/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |

> Brand follow karna shuru se aakhir tak customer action hai — services token se
> `Customer` resolve karte hain aur warna `404` dete hain. Route par keh dena usse
> saaf `403` bana deta hai, confusing *"Customer not found"* nahi.

> **Customer doc me:** dono (2)

---

## 20. Brand Avoidances — `/brandAvoidances` (2)

Global middleware: `router.use(isCustomer)`

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 117 | POST | `/brandAvoidances/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |
| 118 | GET | `/brandAvoidances/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |

> **Customer doc me:** dono (2)

---

# E. Subscriptions — vendor ka paisa andar

## 21. Subscriptions (Plans) — `/subscriptions` (5)

Plan master data — catalogue. Customer doc me **nahi**.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 119 | POST | `/subscriptions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 120 | GET | `/subscriptions/getAll` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ |
| 121 | GET | `/subscriptions/get/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ |
| 122 | PUT | `/subscriptions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 123 | DELETE | `/subscriptions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Vendor doc me:** #120, #121 (2) · **Admin doc me:** saare 5

---

## 22. Subscribeds — `/subscribeds` (8)

Brand ki **actual subscription** ka lifecycle (`/subscriptions` = plan catalog, ye = kis brand ne kya liya).
Paid path `/transactions/subscribe/*` par hai; ye admin ka manual/without-payment path hai — jise admin vendor ki taraf se bhi chala sakta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 124 | POST | `/subscribeds/admin/grant` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Bina payment ke subscription. **NEW / RENEW / UPGRADE / DOWNGRADE ek hi call me** — response ka `action` batata hai kaunsa apply hua |
| 125 | PUT | `/subscribeds/admin/cancel` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 126 | GET | `/subscribeds/admin/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Saare brands ki subscriptions |
| 127 | GET | `/subscribeds/admin/forfeited` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Goodwill worklist — jin vendors ne mid-term plan change pe paid days khoye. **Upgrade par proration nahi hota**, isliye wo terms yahan se dhoondhe aur baad me settle kiye jaate hain |
| 128 | PUT | `/subscribeds/admin/forfeited/compensate` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Forfeited days compensate |
| 129 | PUT | `/subscribeds/admin/resync` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Repair endpoint — cached subscription state + plan limits rebuild |
| 130 | GET | `/subscribeds/get` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | `resolveActorBrand` |
| 131 | GET | `/subscribeds/history` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | |

> **Vendor doc me:** #130, #131 (2) · **Admin doc me:** saare 8

---

## 23. Promo Codes — `/promoCodes` (6)

Subscription promo codes. **Poora module `router.use(isAdmin)`** — vendor manage nahi karta, wo sirf `/transactions/subscribe/preview` aur `create-order` me code redeem karta hai.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 132 | POST | `/promoCodes/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 133 | GET | `/promoCodes/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 134 | GET | `/promoCodes/reports` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 135 | GET | `/promoCodes/get/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 136 | PUT | `/promoCodes/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 137 | DELETE | `/promoCodes/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Admin doc me:** saare 6

---

## 24. Transactions — `/transactions` (15)

Razorpay subscription payments + webhook operations + payment health.

> ### ⚠️ Is router par koi blanket `verifyJwtToken` **nahi** hai
>
> Aur ye oversight nahi hai — public invoice link ek blanket gate se bach hi nahi
> paata. **Har route apna gate likhta hai.** Isi wajah se `routes/disputes.js` par
> bhi blanket gate nahi hai: do file ke beech move karne wale reader ko ye yaad
> rakhna na pade ki kaunsi file me blanket gate hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 138 | GET | `/transactions/invoice/:token` | Intended: Customer + Vendor · Enforced: **Public (token)** | 🤖 | ⚠️ **Deliberately unauthenticated.** Link WhatsApp message aur email se khulta hai, jahan browser me koi session hota hi nahi — login maangne ka matlab hai Download button kaam na kare, jo uska ekmatra kaam hai. 32-byte random token hi credential hai; galat token par wahi `404` jo na-maujood token par. PDF **pehli request par** banti hai aur uske baad cache hoti hai — har claim par render + upload scale par nahi chalega, aur zyadatar invoice kabhi khulti hi nahi. Invoice **number** phir bhi settle par milta hai, taaki series me gap na aaye |
| 139 | POST | `/transactions/webhook/razorpay/customer` | Intended: Razorpay · Enforced: **Public (HMAC)** | 🤖 | **CUSTOMER account** (voucher claims); secrets `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS`. Account **route se** aata hai, signature se nahi — signature sirf authenticate karta hai. Galat endpoint par aayi delivery phir bhi process hoti hai, par WARNING alert ke saath |
| 140 | POST | `/transactions/webhook/razorpay` | Intended: Razorpay · Enforced: **Public (HMAC)** | 🤖 | **VENDOR account** (subscriptions); secrets `RAZORPAY_WEBHOOK_SECRETS` (comma-separated, rotation-safe). Isse activation browser se independent hai — jo customer tab band kar de use bhi apna claim milta hai |
| 141 | POST | `/transactions/subscribe/preview` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Price + promo code preview, order banane se pehle |
| 142 | POST | `/transactions/subscribe/create-order` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Gated — pehle koi bhi user kisi bhi brand ke against order khol sakta tha |
| 143 | POST | `/transactions/subscribe/verify-transaction` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 144 | POST | `/transactions/invoice/regenerate` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | PDF invoice re-issue. **Amounts kabhi recompute nahi hote** — transaction pe frozen pricing se banta hai, to purana invoice exactly wahi dikhata hai jo charge hua tha. Vendor apna, admin koi bhi |
| 145 | GET | `/transactions/webhook/events` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Webhook delivery log. Deliveries pehle bhi store hoti thi par DB ke bahar invisible thi — ek `FAILED` event (paisa captured, plan live nahi, **aur Razorpay hamara `200` mil jaane ke baad retry nahi karta**) chup-chaap pada reh sakta tha |
| 146 | GET | `/transactions/webhook/events/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 147 | POST | `/transactions/webhook/replay/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Stored payload dobara wahi processing se. **Idempotent** — settlement transaction ko conditionally claim karta hai, to already-settled ka replay double-activate nahi karta, wo batata hai |
| 148 | GET | `/transactions/disputes` | Intended: Vendor + Admin · Enforced: **Any authenticated** | ⚪ | **Legacy mount** — canonical ghar #178 hai |
| 149 | POST | `/transactions/disputes/:disputeId/evidence` | Intended: Vendor / Outlet · Enforced: **VENDOR+SUB** | 🔵 | **Legacy mount** — canonical #179 |
| 150 | GET | `/transactions/disputes/:disputeId/evidence-pack` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | **Legacy mount** — canonical #180 |
| 151 | GET | `/transactions/admin/health` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Neeche wala box dekho |
| 152 | PATCH | `/transactions/admin/:transactionId/release-hold` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Neeche wala box dekho |

> ### #148–#150 legacy hain — **yahan naya kuch mat jodo**
>
> Dispute pehle `Transaction` par das denormalised fields tha, isliye ye yahan the.
> Ab uska apna collection, apne jobs, apni notifications aur apni worklist hai, aur
> **`/disputes` uska ghar hai**.
>
> Ye teen rehte hain kyunki Postman collections aur pehle se juda koi bhi integration
> inhi par hai — `404` dene se bura kuch nahi. Ye **wahi controllers** mount karte
> hain, to exactly ek implementation hai aur drift ka koi rasta nahi;
> `__tests__/money/disputeVisibility.test.js` isi baat ko assert karta hai.
>
> ⚠️ Naye dispute routes sirf `/disputes` par — jaise `GET /disputes/:disputeId`
> (#181) already hai. Dono mounts ko badhana wahi tareeka hai jisse compatibility
> ke liye rakha gaya surface **doosra maintain karne wala surface** ban jaata hai.

> ### #152 `release-hold` — `settlementHold` ka ekmatra exit
>
> `settlementHold` design se **monotonic** hai: **paanch** paths use set karte the
> aur, is endpoint se pehle, **exactly ek** clear karta tha — aur wo ek bhi sirf
> refund reject hone se pahuncha ja sakta tha.
>
> Baaki har cheez jo paisa hold karti hai uska **koi raasta hi nahi tha**: chargeback
> (wo bhi jo hum **jeet** gaye), `FAILED` tak pahuncha refund, Razorpay dashboard se
> issue kiya refund, aur complete ho chuka refund. Dispute webhook apne hi comment me
> ye keh raha tha — *"releasing it is an explicit admin action, taken once somebody
> has decided who bears the loss"* — aur **wo action banaya hi nahi gaya tha**.
>
> Nateeja: jis vendor ka chargeback hum jeet gaye, uska wo paisa **har aane wali
> settlement se hamesha ke liye**, **chup-chaap** bahar tha.
>
> ⚠️ Written reason **zaroori**, aur refund khula ho ya chargeback unresolved ho to
> **refuse** karta hai: grahak ko pehle jawab chahiye, aur refund ka faisla apne aap
> hold hata deta hai.

> ### #151 `admin/health` — liveness probe **nahi**
>
> Server ka jawab dena hi wo sabit karta hai. Ye wo sawaal hai jo admin ko subah nau
> baje hota hai: *raat me kuch atka to nahi, aur abhi kuch chup-chaap paisa to nahi
> kho raha?* Teen hisse: `jobs` (safety net ruk gaya) · `stuck` (paisa aisi haalat me
> jise kuch nikalega nahi) · `indexes`.
>
> **`CRITICAL` sirf us cheez ke liye jo ghadi ke saath paisa khoti hai** — bina capture
> hui authorization ~5 din me khud refund ho jaati hai, dispute deadline chookne par
> paisa apne aap chala jaata hai, koi nirnay liye bina. Baaki `ATTENTION`: asli hai
> par insaan ka intezaar karte hue bigadta nahi. Dono ko ek rang dena logon ko laal
> nazarandaaz karna sikha deta hai.
>
> Har ginti **query hai, cached counter nahi** — ruk gaya cached number *"shunya
> samasyaein"* padha jaata hai jabki samasya badh rahi hoti hai. 8 me se koi job kabhi
> na chala ho to bhi `ATTENTION`: `startJobs` boot par har job ek baar chalata hai, to
> `NEVER_RUN` bachna matlab **runner chala hi nahi** — aur tab upar ke saare safety net
> maujood hi nahi.
>
> Hamesha `200`, khabar buri ho tab bhi: jo health endpoint unhealthy hone par `500`
> de wo bata hi nahi sakta **kya** unhealthy hai.
>
> **No validator: ye kuch leta hi nahi.** Query parameter yahan sirf ek tareeka hota
> kam poora jawab maangne ka.

> **Customer doc me:** #138 (invoice link) · **Vendor doc me:** #138, #141–#144, #148, #149 (7)
> **Admin doc me:** saare 15

---

# F. Voucher claims — grahak ka paisa andar

## 25. Voucher Claims — `/voucher-claims` (7)

Customer ka voucher claim — paisa andar. **Likhne wale** do endpoint `isCustomer` ke peeche: guest ko **daam milta hai** (preview #87 `optionalAuth` par hai) par **order nahi**. **Padhne wale** paanch `verifyJwtToken` par hain — role gate nahi, kyunki wo **ek endpoint, teen shapes** hain.

> ### Ek endpoint, teen shapes — teen endpoint kyun nahi
>
> Har audience ke liye alag endpoint plan me tha (`customer/get-all`, `vendor/get-all`,
> `admin/get-all`). Bane ek-ek. Scope `buildAccessScopeFilter()` se aur projection
> `claimProjection(role)` se — dono token se — isliye ek hi URL par customer, vendor,
> outlet aur admin apna jawab paate hain.
>
> **Wajah drift hai.** Teen endpoint ka matlab tha teen jagah ye yaad rakhna ki vendor
> ko `gatewayFee`, `netReceived`, `voucher.platformPromoCost`, `email`, `contact` nahi
> dikhne chahiye. Ek jagah bhoolna = leak — aur wo listing me nahi, **detail page par**
> milta, jise koi jaanchta nahi.
>
> ⚠️ **Detail poora row padhta hai, phir chhaanta hai** — listing ki tarah pipeline me
> project nahi kar sakta. Ownership `customerId` / `brandId` me rehti hai, aur vendor
> projection wahi chhupati hai; pehle project karne ka matlab hota *"ye tumhara hai?"*
> aise document se poochna jo ab batata hi nahi kiska hai. Isliye `pickByProjection()`
> **whitelist** hai, delete-list nahi: model me kal juda field default roop se adrishya hai.
>
> ⚠️ **Scope query se chaudi nahi ho sakti** — filter aur scope **intersect** hote hain.
> Vendor `?brandId=<dusra>` bheje to **kuch nahi** milta. Pehle scope overlay hota tha:
> surakshit tha par chup — vendor ko apne rows waapas milte the, jo bilkul chale hue
> filter jaisa dikhta hai.

> **Route file `voucherClaims.js` hai, mount `/voucher-claims` par.** `routes/index.js`
> prefix filename se banata hai, isliye file `module.exports = { router, routePrefix }`
> deti hai. ⚠️ `exports.routePrefix` ke saath `module.exports = router` likhna kaam
> **nahi** karta — doosri assignment poora exports object badal deti hai aur prefix
> chup-chaap kho jaata hai. Sirf boot log me dikhta hai. (`customerBankAccounts.js` me
> wahi trap dobara aaya tha.)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 153 | POST | `/voucher-claims/create-order` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Razorpay order kholta hai. **Kram hi design hai:** daam (wahi builder jo preview chalata hai, `strictPromo` ke saath) → `Idempotency-Key` insert → reuse window → claim + once-per-user slot hold → promo reservation → **Razorpay sabse aakhir**. Key Razorpay call se **pehle** jaati hai: header lekar check kar lena kaafi nahi, do concurrent tap dono read-then-write paas kar jaate aur customer ko ek bill ke liye do payment sheet dikhte. Razorpay aakhir me kyunki uska undo nahi hai |
| 154 | POST | `/voucher-claims/verify` | Intended: CUSTOMER · Enforced: **CUSTOMER + ownership** | 🟢 | Browser callback. Signature sirf ye sabit karta hai ki payment Razorpay ne banayi — is order ki hai, sahi rakam hai, ya poochne wala wahi hai, ye **nahi**. Isliye chaar aur jaanch: account **transaction se** (hardcode nahi), `payment.order_id` milana, rakam `claim.pricing.amountInPaise` se milana, aur ownership **customer par** (`userId` par nahi — ek login saajha karte do customer me se ek doosre ki payment settle kar leta). Webhook race jeet le to `alreadyVerified: true` — wo **safalta hai, error nahi** |
| 155 | GET | `/voucher-claims/payments` | Intended: sab · Enforced: **Any auth (scope)** | ⚪ | *"Kaunsa paisa hila"*. `status` yahan **payment** ki vocabulary hai (`created · authorized · captured · failed`), claim ki nahi. `purpose` se scope, isliye ek galat filter bhi kabhi subscription payment nahi dikha sakta. `/payments/:transactionId` se **pehle** declare |
| 156 | GET | `/voucher-claims/payments/:transactionId` | Intended: sab · Enforced: **`assertTransactionAccess`** | ⚪ | **Push notification ka deep link yahin utarta hai.** `payment` · `claim` · `brand` · `outlet` · `viewer`. Claim saath aata hai kyunki akela payment sirf raqam aur timestamp hai. `invoiceDownloadUrl` deta hai, **token nahi** — token PDF ka bina-auth bearer credential hai. ⚠️ `purpose` scope ke bina ye **subscription** payment khol deta — dusre Razorpay account ka row, voucher-claim ki projection se. Id ka unique hona iska jawab nahi hai |
| 157 | GET | `/voucher-claims` | Intended: sab · Enforced: **Any auth (scope)** | ⚪ | *"Maine kya khareeda"*. Frozen snapshots padhta hai (`voucherSnapshot` / `brandSnapshot` / `outletSnapshot`), join nahi — September ki claim March me bhi sahi padhti hai, voucher republish aur outlet rename ke baad bhi. **Khaali list `200` + `data: []`, `404` nahi**: jisne kuch khareeda hi nahi uski history khaali hai, gayab nahi. `pagination()` me `allowEmpty` isiliye juda — `404` pehli baar app kholne par error screen dikha deta |
| 158 | GET | `/voucher-claims/code/:claimCode` | Intended: sab · Enforced: **`assertClaimAccess`** | ⚪ | Counter wala surface — code hi wo cheez hai jo asli duniya me hai: chhapa, bolkar padha, type kiya. ⚠️ **Code lookup narrow karta hai, authorise nahi karta** — kisi aur ki screen se padha code kuch nahi kholta. Route file me `/code/:claimCode` **`/:claimId` se upar** likha hai, warna parameter use nigal leta (`claimId = "code"` → sahi code par `422`). Alphabet `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` chhodta hai, isliye galat character par `422` *"mistyped"* — `404` lagta hai claim hai hi nahi |
| 159 | GET | `/voucher-claims/:claimId` | Intended: sab · Enforced: **`assertClaimAccess`** | ⚪ | Claim + **timeline**. ⚠️ Timeline **banayi** jaati hai, chhaani nahi: `VoucherClaimHistory.snapshot` `Mixed` hai aur `CLAIM_CREATED` par **poora pricing block** rakhta hai (`platformPromoCost` samet), `reason` staff ka free-text note hai. Kaccha row bhejna vendor ko hamara margin pichhle darwaze se de deta — us projection ko paar karke jo use rokti hai. Non-admin ko sirf `label` · `at` · `fromStatus` → `toStatus` · `by` (role, aadmi nahi). `PROMO_RELEASED` sirf admin ko |

> **Customer doc me:** saare 7 · **Vendor doc me:** #155–#159 (5) · **Admin doc me:** #155–#159 (5)

---

## 26. Customer Bank Accounts 🆕 — `/bank-accounts` (4)

Customer ke bank accounts — **use hote hain jab refund wapas usi raaste se nahi ja sakta.**

> ### Ye apna domain kyun hai, `/refunds` ka hissa kyun nahi
>
> Account **customer ka** hai, ek refund ka nahi. Use refund ke neeche rakhna matlab
> agle refund par use **dobara add karna — aur dobara verify karna, paise dekar** — aur
> ye dekhne ka koi raasta na rehna ki customer ke paas file me kya hai.

> ⚠️ **Har route par `isCustomer`**, aur customer id har service ke andar **token se**
> aata hai. Yahan kuch bhi `customerId` **leta hi nahi**: jo leta wo ek insaan ko doosre
> ke accounts padhne ya add karne de deta.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 160 | POST | `/bank-accounts/otp` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Step one: code, kuch add hone se pehle. ⚠️ **Account add karna ye tay karta hai ki paisa kahan jayega**, to sirf login galat strength ka gate hai: live session rakhne wala koi bhi warna pending refund apne account par point kar leta — aur **NEFT wapas nahi bulayi ja sakti**. Throttle `services/otps/sendOtp.js` me hai (60s / 5 per hour), route par nahi |
| 161 | POST | `/bank-accounts/` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Step two: account, code ke saath. **Penny drop server khud karta hai** aur `isVerified` provider ke jawab se derive karta hai — verification ke baare me client se kuch bhi accept nahi hota |
| 162 | GET | `/bank-accounts/` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Customer ke apne accounts |
| 163 | DELETE | `/bank-accounts/:accountId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Soft delete, aur **refund is par point kar raha ho to refuse** — warna wo refund apna destination kho deta aur admin queue me aisi haalat me pahunchta jahan usme paisa daalne ki jagah hi nahi hoti |

> **Customer doc me:** chaaron (4) · Vendor/Admin doc me: **koi nahi**

---

## 27. Refunds — `/refunds` (14)

Grahak maange → **vendor tay kare** → admin nikaale.
**Poora flow → [`refund_flow.md`](./refund_flow.md).** Admin normal raaste par doosra gate **nahi** hai; wo sirf paisa chhodta hai.

> ### Golden rule — settings validator me enforce hai
>
> ```
> settlementDelayHours >= refundWindowHours + vendorApprovalHours + adminBufferHours
>          72h         >=        24h        +        24h         +       12h
> ```
>
> Jab tak ye sach hai, **koi refund kabhi aise paise ko chhoo hi nahi sakta jo vendor ko ja chuka ho.** Na recovery, na negative balance, na vendor ko kuch samjhana. Refund us cycle ka payable kam karta hai, bas.

> ### ⚠️ `settlementHold` lagta bhi hai, **hatta bhi** hai
>
> Refund `REQUESTED` hote hi hold lag jaata hai — wahi ek line poori "pehle pay kar diya, ab wapas lo" wali samasya khatam karti hai. Ulta utna hi khatarnak hai: **jo hold koi nahi hataata, wo vendor ka paisa har aane wali settlement se hamesha ke liye bahar kar deta hai — chup-chaap**, kyunki eligibility predicate bas match karna band kar deta hai. Koi error nahi, koi log nahi.
>
> Isliye `releaseSettlementHold()` teeno terminal states se bulaya jaata hai jahan paisa hilta hi nahi — `VENDOR_REJECTED`, `ADMIN_REJECTED`, `CANCELLED`. `FAILED` aur `COMPLETED` se **nahi**: pehle me paisa abhi bhi wapas jaana hai, doosre me wo vendor ka tha hi nahi. Aur wo kisi aur ki taraf se release **nahi** karta — chargeback ka hold sirf explicit admin action (#152) se hatta hai, webhook se kabhi nahi.

> ### Abuse limits — admin config se
>
> `refund.maxOpenRequests` (1) · `refund.maxRejectedPerWindow` (3) · `refund.requestWindowDays` (30)
>
> ⚠️ Ginti **thukrai** requests ki hoti hai, approve hui ki **kabhi nahi**. Galat ka sanket ye nahi ki kitna paisa wapas gaya — wo hai *"vendor ne dekhkar kaha ki ye jayaz nahi thi"*. Jis grahak ki 5 refunds approve hui, uske saath 5 baar sach me bura hua; uski chhathi rokna theek usi ko saza dena hai jiske liye ye poori vyavastha bani hai. Aur raw count rakhne par **sabse kharab brand ka grahak sabse pehle block** hota — jo sabse zyada haqdaar hai. `CANCELLED` bhi ginta hai: raise → vendor dekhe → withdraw → phir raise, ye vendor ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye.
>
> Limit chhoone par jawab **support par bhejta hai, raasta band nahi karta** — admin uski taraf se refund khol sakta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 164 | POST | `/refunds` | Intended: CUSTOMER · Enforced: **CUSTOMER + ownership** | 🟢 | **Kram hi design hai:** eligibility → allowance → window → split freeze → **request banao** → hold lagao. Request pehle, hold baad me: request hi record hai aur hold usse nikalta hai. Do tap ka faisla `(transactionId, isOpen)` wala unique index karta hai, uske upar wala read-then-write check nahi (dono use paas kar jaate hain) — haarne wale ko wahi request milti hai `reused: true` ke saath. Window **`paidAt` se** napi jaati hai, `createdAt` se nahi. `amount` optional — na do to poora. ⚠️ Ownership **customer** par check hoti hai, user par nahi, to ek login saajha karte do log ek doosre ke claims refund nahi kara sakte |
| 165 | PATCH | `/refunds/:requestId/withdraw` | Intended: CUSTOMER · Enforced: **CUSTOMER + ownership** | 🟢 | `PROCESSING` ke baad nahi — paisa Razorpay ke paas hai, wapas lene ko kuch hai hi nahi. Hold hatta hai |
| 166 🆕 | PATCH | `/refunds/:requestId/bank-account` | Intended: CUSTOMER · Enforced: **CUSTOMER + ownership** | 🟢 | Failed refund kahan jaaye, ye customer batata hai. Account uski **apni verified list** se chuna jaata hai (#162), aur service refund ko uska hona verify karti hai — to koi kisi aur ka refund kahin point nahi kar sakta |
| 167 | PATCH | `/refunds/:requestId/approve` | Intended: Vendor / Outlet · Enforced: **VENDOR+SUB** | 🔵 | **Rakam ghat sakti hai, badh nahi** — *"aadha order theek tha"* asli jawab hai; badhana approval nahi, naya faisla hai, aur ek extra shunya das guna pay out kar deta. Split wahin dobara freeze hota hai. `status` update filter me hai (conditional claim): owner aur outlet manager ek hi request dekh sakte hain, warna dono clicks lagte aur grahak ka jawab is par nirbhar karta ki kaun dheema tha. ⚠️ **Admin yahan nahi hai** — normal path par vendor tay karta hai aur admin sirf execute karta hai |
| 168 | PATCH | `/refunds/:requestId/reject` | Intended: Vendor / Outlet · Enforced: **VENDOR+SUB** | 🔵 | `note` **zaroori** — jab grahak inkaar ko chunauti de, admin ke paas sameeksha karne ko yahi ek cheez hoti hai. `settlementHold` yahin hatta hai |
| 169 | PATCH | `/refunds/admin/:requestId/approve` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Normal raaste par doosra gate nahi. Vendor ki *"na"* ya chuppi palatne par `overrideReason` **zaroori** aur `isOverride: true` — alag se gina jaata hai: **badhti override dar ka matlab admin udaar nahi, matlab upar kahin gadbad hai** |
| 170 | PATCH | `/refunds/admin/:requestId/reject` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Hold hatta hai |
| 171 | PATCH | `/refunds/admin/:requestId/pay` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ **`attemptCount` gateway call se PEHLE badhta hai.** Agar process us beech mare jab Razorpay ne refund maan liya par id sahej na paye — row `PROCESSING` kehti hai, `attemptCount: 1`, koi `razorpayRefundId` nahi — aur agli koshish `payments.fetchMultipleRefund()` se **poochti hai**, doosra refund bhejti nahi. Baad me badhate to counter shunya rehta aur retry grahak ko paisa **do baar** bhej deta. Match hamare stamp kiye `notes.refundRequestId` par, rakam par nahi. Lookup khud fail ho to **503**, row `PROCESSING` chhod deta — galat hone ka surakshit tareeka |
| 172 🆕 | PATCH | `/refunds/admin/:requestId/request-bank-details` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | MANUAL_BANK step 1 — customer se bank details maango. Neeche wala box dekho |
| 173 🆕 | PATCH | `/refunds/admin/:requestId/pay-to-bank` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | MANUAL_BANK step 2 — `PayoutLeg` kholta hai |
| 174 🆕 | PATCH | `/refunds/admin/:requestId/confirm-bank-payout` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | MANUAL_BANK step 3 — **haath se type kiya UTR** hi ise khatam karta hai |
| 175 🆕 | PATCH | `/refunds/admin/:requestId/fail-bank-payout` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | NEFT bounce hui |
| 176 | GET | `/refunds` | Intended: sab · Enforced: **Any auth (scope)** | ⚪ | Ek endpoint, teen shapes. `?open=true` worklist hai — **sabse purani upar**, kyunki wahi timeout ke sabse kareeb hai aur usi grahak ne sabse lamba intezaar kiya. ⚠️ `split` me `platformPromoReversal` aur `gatewayFeeAbsorbed` (hamara margin) **usi sub-document par** hain jis par `vendorClawback` hai — isiliye faisla ek jagah hota hai. `canDecide` / `canWithdraw` response me **bataye** jaate hain: jo panel status se nikalega wo naye state judte hi galat hoga |
| 177 | GET | `/refunds/:requestId` | Intended: sab · Enforced: **`assertRefundAccess`** | ⚪ | Refund + claim + **claim ki timeline** (alag refund timeline nahi — refund claim ke saath hui cheez hai, aur claim ki kahani wahi jagah hai jahan teeno jaate hain). Poora row padhkar, jaanchkar, phir `pickByProjection` se chhanta hai: ownership `customerId`/`brandId` me hai aur vendor projection unhi ko chhupati hai |

> ### 🆕 MANUAL_BANK (#172–#175) — jab original instrument paisa wapas le hi nahi sakta
>
> `SOURCE` refund **band pade instrument par har baar fail hota hai** — closed card,
> deactivated UPI. Aur is se pehle admin ke paas doosra button hi nahi tha: request
> `FAILED` par baithi rehti, **vendor ka paisa hold me phansa rehta, aur grahak ko
> uska kabhi milta hi nahi**. Teen taraf se ek saath atka hua.
>
> ⚠️ `/pay` (#171) se **jaan-boojh kar alag.** Wo gateway call karta hai; ye
> `PayoutLeg` kholte hain, kisi insaan ke NEFT karne ka intezaar karte hain, aur
> **haath se type kiye UTR** se khatam hote hain. Dono ko ek endpoint banana matlab
> settlement ko paid mark karna **NEFT key hone se pehle**.
> → `services/refunds/manualBankRefund.js`
>
> Destination customer ke apne verified accounts (#160–#163) me se aata hai, aur
> customer #166 se chunta hai.

**Webhooks:** `refund.created` · `refund.processed` · `refund.failed` — teeno ab handle hote hain. ⚠️ Pehle sirf `refund.processed` tha; baaki do enum me the par kisi branch me nahi, to **failed refund chup-chaap `IGNORED` hokar gir jaata** — grahak ka paisa kabhi nahi pahuncha, request abhi bhi `PROCESSING` kehti thi, aur koi kuch nahi batata tha.

**Jobs (3):** `escalateStaleRefunds` (15m) · `reconcileRefunds` (30m, **sirf padhta hai** — refund jaari karna `executeRefund` ka kaam hai aur uske apne double-payment guards hain) · `remindVendorsAboutRefunds` (60m)

> **Customer doc me:** #164–#166, #176, #177 (5) · **Vendor doc me:** #167, #168, #176, #177 (4)
> **Admin doc me:** #169–#177 (9)

---

## 28. Disputes — `/disputes` (4)

Chargebacks. **Canonical ghar** — legacy mount `/transactions/disputes*` (#148–#150) wahi controllers use karta hai.

> ### Ye apna domain kyun hai
>
> Dispute `Transaction` par **das denormalised fields** se shuru hua aur
> `/transactions/disputes` par tha, kyunki data wahan tha. Ab uska apna collection
> hai — **ek payment kai dispute rakh sakti hai, har ek ki apni deadline aur apna
> paisa** — aur jis record ka apna model, apne jobs, apni notifications aur apni
> worklist ho, wo ek domain hai.

> ⚠️ **Is router par blanket `router.use(verifyJwtToken)` nahi hai, jaan-boojh kar** —
> `routes/transactions.js` par bhi nahi hai kyunki uska public invoice link ek blanket
> gate se bach nahi paata, aur do file ke beech move karne wale reader ko ye yaad
> rakhna na pade ki kaunsi file me blanket gate hai. **Har line apna gate likhti hai.**

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 178 | GET | `/disputes` | Intended: Vendor + Admin · Enforced: **Any auth (scope)** | ⚪ | Sabse pehle deadline wala upar. Deadline miss = paisa automatically forfeit, isliye ye **report nahi worklist** hai. **Ek endpoint, do shape**: vendor ko sirf apne brand ke, aur scoping **filter me** — projection me chhupa kar nahi. ⚠️ Vendor ko `respondBy`/`daysToRespond`/`isOverdue`/`alertsSent`/`recoverySettlementId`/`vendorWasPaid` **kabhi nahi**: deadline nibhana hamara kaam hai aur evidence hum file karte hain, to jis countdown par outlet kuch kar hi nahi sakta wo warning nahi — sirf ghabrahat aur ek support call hai. ⚠️ **CUSTOMER ko `scopeFor` me `403`**: chargeback unke bank aur hamare beech hai; unhone wahan raise kiya, aur Trydood ki screen sirf confuse ya bhadka sakti hai. ⚠️ `verifyJwtToken` **saaf-saaf** likha hai — `isAdmin` hatate waqt uski jagah kuch na rakhna poori worklist URL jaanne wale ke liye khol deta |
| 179 | POST | `/disputes/:disputeId/evidence` | Intended: Vendor / Outlet · Enforced: **VENDOR+SUB** | 🔵 | Jo sirf outlet ke paas hai — KOT/bill number, camera ka waqt, staff ko kya yaad hai. ⚠️ **Bonus hai, sahaara nahi**: `buildEvidencePack` hamare apne record par khada hota hai, aur filing outlet ke jawab ka intezaar **nahi** karti — dispute ka jawab **ek hi baar** jaata hai aur deadline **bank ki** hai. Faisla ho chuka ho to **409**, aur refusal batata hai ki kis taraf gaya taaki wo soch me na pade ki message bounce kyun hua. ⚠️ `/:disputeId` se **upar** declare — segment count aaj alag hai to Express confuse nahi hoga, par ordering hi wo cheez hai jo us din faisla karegi jab ek-segment ka write aayega |
| 180 | GET | `/disputes/:disputeId/evidence-pack` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Sab kuch jo hum sabit kar sakte hain — payment + **signature verified** (khud sabooot: callback hamare account ke secret se signed tha), outlet, claim code, timeline, aur **`narrative`** jo Razorpay dashboard me seedha paste ho jaata hai. Argument pehle se likha hua isliye ki dispute **ek baar** file hota hai aur jeet-haar aksar isi par hoti hai ki case theek se likhne ka waqt tha ya nahi. ⚠️ Admin-only: grahak ka **masked** contact, poori claim timeline aur wo daleel jo hum dene wale hain — kuch bhi outlet ka padhne ka nahi. ⚠️ Razorpay se baat nahi karta aur kuch submit nahi karta |
| 181 | GET | `/disputes/:disputeId` | Intended: Vendor + Admin · Enforced: **Any auth (scope)** | ⚪ | Ek dispute, wahi do shape. ⚠️ Projection **list se shared hai**, apni likhi hui nahi — alag likhna wahi tarika hai jisse list jo field chhupati hai wo detail par aa jaata hai, mahino baad, bina kuch fail hue. Razorpay ka `disp_…` **ya** hamara `_id` — dono chalte hain, kyunki pehla dashboard par dikhta hai aur har alert usi ko carry karta hai, doosra panel ke paas list call ke baad hota hai. Doosre brand ka dispute **404**, missing jaisa hi: *"hai par tumhara nahi"* kehna id asli hone ki tasdeeq hai |

> ### ⚠️ Hold release karna yahan **nahi** hai, aur ye oversight nahi hai
>
> `settlementHold` **transaction** par baithta hai, dispute par nahi — ek payment ko
> refund, dashboard refund, ya failed payout bhi hold kar sakta hai, jinke aaspaas
> koi dispute nahi hota. Use clear karne wala ekmatra endpoint
> **#152 `PATCH /transactions/admin/:transactionId/release-hold`** hai, jo written
> reason maangta hai aur refund khula hone tak refuse karta hai. Ise yahan mirror
> karna matlab **ek hi paisa hilane ke do raaste**, aur unme se ek ke us check ko
> skip kar jaane ke do mauke.

**Poora flow → [`dispute_flow.md`](./dispute_flow.md)** (vendor shape §4 me)

> **Vendor doc me:** #178, #179, #181 (3) · **Admin doc me:** saare 4 · Customer doc me: **koi nahi** (403)

---

## 29. Settlements — `/settlements` (16)

Din band ho → kabza ho → admin manzoori de → NEFT jaaye → UTR record ho.
**Poora flow → [`settlement_flow.md`](./settlement_flow.md).** Vendor ke liye yahan **koi write nahi** hai: settlement hamara record hai ki hum unhe kya de rahe hain, koi form nahi jo wo bharein. Ikhtilaf support se hota hai.

> ### Kabza hi lock hai
>
> `Transaction.settlementId: null` wahi ek cheez hai jo do cycles ko ek hi payment baantne se rokti hai. Shell **pehle** banti hai, rows **baad me** claim hoti hain — ulta karne par rows aise settlement se bandh jaate jo bani hi nahi, aur wo phir kabhi kisi cycle me nahi aate, **bina kisi error ke**.

> ### ⚠️ `settlementHold` sirf claim se **pehle** ka filter hai
>
> Ek baar `settlementId` lag gaya, hold lagane se is settlement par koi asar nahi — eligibility claim ke waqt tay ho chuki. 02:00 ki build aur 14:00 ke payout ke beech ghanton ki khidki hai, aur wahi waqt hai jab `dispute.created` ya refund aata hai. Isliye webhook settlement ko **flag** karta hai (`needsRevalidation` + `taintedTransactionIds`), aur **approval hi authority hai**: shart update ke filter me hai, `if` me nahi.

> ### ⚠️ NEFT ka recall nahi hota
>
> Isi ek line se teen design faisle nikalte hain: (1) payout se pehle live bank aur frozen `bankSnapshot` compare hote hain aur farq par settlement `ON_HOLD` jaata hai — warning nahi, **rok**; (2) `sweepStalePayouts` sirf **batata** hai, apne aap `FAILED` nahi karta, warna kaamyaab transfer ke upar "bank ne mana kiya" likh kar vendor ko dobara paisa chala jaata; (3) bounce hui leg **mitayi nahi jaati** — retry nayi leg banati hai, taaki record me dono koshishen bachein, apne UTR aur apne payee ke saath.

> ⚠️ **Declaration order:** `/statement/:token` aur saare `/admin/...` routes reads se
> **upar** hain. Aaj `/statement/:token` aur `/:settlementId/transactions` sirf isliye
> alag hain ki `transactions` ek literal hai — **aur wo margin agla route judne tak hi
> hai.** Safe order me declare karna sasta hai, baad me yaad rakhne se.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 182 🆕 | GET | `/settlements/statement/:token` | Intended: VENDOR · Enforced: **Public (token)** | 🤖 | **Public payout statement. Koi JWT nahi.** Link payout notification aur email me aata hai, aur us browser me vendor ka koi session nahi hota — session maangne ka matlab hai Download button kaam na kare, jo uska ekmatra kaam hai. 32-byte token hi credential hai, aur ek ko revoke karna ek field update hai. **File stream nahi karta, redirect karta hai** — PDF pehle se CDN par hai, aur har download ko is service se proxy karne se kuch nahi milta |
| 183 | PATCH | `/settlements/admin/:settlementId/approve` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `needsRevalidation: {$ne: true}` **update ke filter me**, `if` me nahi — read aur write ke beech webhook aa sakta hai. Mana karne par `refuseAndHold` **kaunse invoice** kharaab hue wo naam se ginta hai; wo naam vendor ko kabhi nahi jaate |
| 184 | PATCH | `/settlements/admin/:settlementId/rebuild` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Sirf `ON_HOLD` par. **Sirf tainted rows** chhoote hain — saaf rows claim me hi rehti hain, warna agli build unhe rebuild ke beech me utha leti aur wahi rows do settlement me aa jaate. Rebuild ke baad kuchh na bache to `CARRIED_FORWARD` |
| 185 | PATCH | `/settlements/admin/:settlementId/hold` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Vendor ko *"on hold — being checked"* jaata hai, **bina tafseel ke**: `reason` aksar kisi disputed payment ka naam leta hai, aur wo batana do din ki der ko ek aise chargeback par behes bana deta hai jispar abhi faisla hua hi nahi |
| 186 | PATCH | `/settlements/admin/:settlementId/cancel` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `reason` **zaroori** — har row agle cycle me chali jaati hai, kuchh khota nahi par vendor ka paisa is click se cycle badalta hai |
| 187 🆕 | PATCH | `/settlements/admin/:settlementId/abandon` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Us payout par haath khada karna jo kabhi chalega hi nahi. **Sirf `FAILED` se**, aur sirf written reason ke saath. **Retry default rehta hai** — ye us waqt ka exit hai jab retry jawab nahi hai, aur iske bina settlement ke rows **hamesha ke liye** aise kisi ke naam claim rehte hain jo unhe kabhi pay nahi karega |
| 188 | PATCH | `/settlements/admin/:settlementId/pay` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Body me **kuchh nahi** — rakam `netPayable` hai aur payee frozen `bankSnapshot`; body me rakam lena matlab aisi rakam jo ledger se mel na khaye. Live bank vs frozen compare **pehle**; farq par `ON_HOLD`. Leg **pehle** banti hai, status **baad me**: beech me crash `APPROVED` + `INITIATED` leg chhodta hai (dikhta hai), ulta kram `PROCESSING` bina leg ke (padhne me "paisa gaya par kahin nahi mila"). Double-click ka faisla `(payoutType, settlementId, legNumber)` unique index karta hai, count nahi |
| 189 | PATCH | `/settlements/admin/:settlementId/confirm` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `utr` **zaroori** — `MANUAL_BANK` ka koi callback nahi, **aadmi hi callback hai**, aur teen din baad *"paisa nahi aaya"* par wahi ek cheez bank statement me dhoondhi ja sakti hai. Leg conditional claim se badalti hai (do admin, ek jeet). `paidAt` liya jaata hai kyunki shukrawaar ki NEFT somwaar type hoti hai aur ledger entry **jab paisa gaya** us tareekh ki honi chahiye. Settlement `PAID` **tabhi** jab legs jud jaayein — split NEFT aam hai, aur pehli leg par hi `PAID` karna settlement ko har worklist se hata deta jabki aadha paisa baaki hai |
| 190 | PATCH | `/settlements/admin/:settlementId/fail` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Leg **rakhi** jaati hai, badli nahi. `FAILED` rows ko **nahi chhodta** — bounce aam hai aur sahi kaam hai account theek karke wahi settlement dobara bhejna, usi number aur statement ke saath. Vendor ko `failureReason` (category) jaata hai, `failureNote` (staff note) **kabhi nahi** |
| 191 | PATCH | `/settlements/admin/:settlementId/retry` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Nayi leg, agla number, aur **taaza `bankSnapshot`** — bounce ki aam wajah galat account hi hoti hai, aur usi galat account me dobara bhejna wo ek cheez hai jo pakka kaam nahi karegi |
| 192 | PATCH | `/settlements/admin/:settlementId/reverse` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Bank ne paid mark karne ke baad wapas kheench liya. **Ledger pehle, rows baad me.** Beech me crash: reversal likha, rows abhi claimed — zyada dikha raha hai, dikhta hai, theek ho sakta hai. Ulta kram: rows chhoot gaye bina reversal ke — padhne me "paisa kabhi gaya hi nahi" aur wo rows **dobara settle** ho jaate. `isReversal: true` inhe once-per-parent index se bahar rakhta hai, warna safety mechanism hi correction mechanism ko rok deta |
| 193 | GET | `/settlements/admin/debt/:brandId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Jo katauti kisi settlement cycle tak **pahunch hi nahi sakti**. `netPayable <= 0` `CARRIED_FORWARD` bhejta hai, aur carry forward ka matlab hi hai uske sab claims chhod dena — brand chal raha ho to sahi (nayi bikri net kar deti hai), band kar de to **anant loop**: koi error nahi, koi log nahi, kisi report me kuch nahi. ⚠️ **Brand par keyed, settlement par nahi** — ye theek wo paisa hai jo koi settlement utha hi nahi paayi, to settlement id wo ek key hai jo definition se ise nahi rakhti. ⚠️ Ledger balance **nahi** ginta, rows ginta hai: balance debt ko un takings se net kar deta hai jo abhi payout hui hi nahi, yani jo paisa hum unka abhi bhi rakhe hue hain. ⚠️ Sirf un rows par jinka payment vendor ko diya ja chuka — jo mila hi nahi uska chargeback debt hai hi nahi, aur use ginna ek receivable gaḍhna hai. ⚠️ **Admin-only read**: *"outstanding debt"* wali screen vendor ko invoice jaisi padhegi jabki dena kuch nahi hai — unhe asar `SETTLEMENT_CARRIED_FORWARD` aur apne statement se milta hai |
| 194 | PATCH | `/settlements/admin/debt/:brandId/write-off` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Peechha chhodna, aur kitaab me likhna. `reason` **zaroori**: ledger kabhi edit nahi hota aur bina wajah wala adjustment mahino baad galti se alag nahi kiya ja sakta. Optional `olderThanDays` — *"90 din se purana sab"* asli maang hai, *"sab"* se kahin zyada. ⚠️ Har row par `MANUAL_ADJUSTMENT` ka **joda**: `VENDOR_PAYABLE` credit (balance zero, aage koi cycle dekhega hi nahi) + `PLATFORM_COST` debit (humne uthaya). Reference **sirf vendor wali row par** — `ONCE_PER_DISPUTE`/`ONCE_PER_REFUND` `{reference, entryType}` par unique hain, to dono par lagane se doosri row duplicate-key par chup-chaap gir jaati aur kitaab theek utni chhoti reh jaati jitna maaf kiya tha. ⚠️ **Ledger pehle, rows baad me**; `writtenOffAt` **dono** claim filters me, warna write-off sirf dikhawa hai aur nuksaan **do baar** gina jaata |
| 195 | GET | `/settlements` | Intended: sab · Enforced: **Any auth (scope)** | ⚪ | Ek endpoint, do shapes. Scope aur filter **kaate** jaate hain, upar-neeche rakhe nahi — vendor kisi aur ka `brandId` bheje to khaali page, apne rows nahi. `?needsAttention=true` admin worklist hai (flagged / `FAILED` / `ON_HOLD`) aur **sabse purani upar**; baaki listing `periodEnd` desc, kyunki wo *"pichhle hafte ka paisa aaya?"* ka jawab hai. Khaali list **404 nahi** — pehle hafte wale brand ko "kuchh gadbad hai" nahi dikhna chahiye. `SUB_VENDOR` ko **poora brand** dikhta hai, apna outlet nahi: settlement poore brand ke din ka hai. ⚠️ `CUSTOMER` ko `scopeFor` me `403` |
| 196 | GET | `/settlements/:settlementId` | Intended: sab · Enforced: **brand + admin** | ⚪ | Settlement + **legs (UTR ke saath)** + timeline. Poora row padhkar, jaanchkar, phir `pickByProjection` — whitelist hai, to model me kal koi field jude to wo tab tak chhupi rehti hai jab tak koi use naam na de. `reason` / `performedBy` / `snapshot` timeline me **sirf admin ko**: *"3 claimed payments are no longer eligible"* aise dispute ka naam leta hai jispar faisla hua hi nahi |
| 197 | GET | `/settlements/:settlementId/transactions` | Intended: sab · Enforced: **brand + admin** | ⚪ | Statement lines, alag se paged — vyast brand ka cycle sau-sau rows ka hota hai aur detail call zyadatar *"kitna, aur kab"* ke liye padha jaata hai. ⚠️ `voucher.platformPromoCost`, `gatewayFee`, `netReceived` vendor ko **nahi** — hamara margin usi sub-document par baitha hai jispar unka `vendorPayable` hai |

> ### `settlement.requiresAdminApproval: false` — koi endpoint nahi, par asar hai
>
> Manzoori band ho to build **seedha `APPROVED`** par jaata hai. Pehle ye setting
> constants me, `Setting` schema me, aur admin panel me — teen jagah wired thi, aur
> **koi code use padhta hi nahi tha**. `false` karne ka koi asar nahi hota tha, **bina
> error ke**.
>
> ⚠️ **Manzoori dena paisa dena nahi:** `pay` (#188) ab bhi aadmi ka kaam hai, aur
> `paySettlement` `needsRevalidation` **usi waqt** dobara padhta hai — us khidki me
> ghante nikal jaate hain. To ye ek queue hataata hai, ek guard nahi. `APPROVED`
> `SETTLEMENT_PRE_PAYOUT_STATUSES` me hai, isliye `alertLateSettlements` phir bhi
> use dekhta rehta hai.
>
> ⚠️ `settings.requiresAdminApproval === false`, `Boolean(...)` **nahi** — jo settings
> document field aane se pehle likha gaya usme value hi nahi hai, aur truthiness padhne
> par agle deploy par platform ka **har payout** chup-chaap auto-approve ho jaata.
>
> ⚠️ `approvedAt` stamp hota hai, `approvedBy` **kabhi nahi**. `approvedAt` khaali
> chhodna auto-approved settlement ko hamesha ke liye atka hua dikhata; `approvedBy`
> me kisi user ka naam daalna us record me **jhoot** hai jo log ye poochne ke liye
> kholte hain ki payout kisne authorise kiya. History row kehta hai *"no person
> reviewed this settlement"*.

**Jobs (5):** `buildSettlements` (60m — ghante me, raat me nahi: `idempotencyKey` par idempotent hai, to jis raat process band tha wo agle tick par apne aap bhar jaata hai) · `sweepStalePayouts` (30m, **sirf batata hai**) · `alertLateSettlements` (60m, counter usi update me badhta hai jo row claim karta hai — ek hi alert) · `reconcileSettlementLedger` (180m, **sirf padhta hai**: ledger row kabhi update ya delete nahi hoti, sudhaar nayi row hoti hai) · `sweepAbandonedDrafts` (60m — khaali `DRAFT` ka key us period ko ghere baitha hota hai aur agli build us brand ka din **skip** kar deti hai, hamesha ke liye)

**Health signals:** `unconfirmedPayouts` (**CRITICAL** — paisa hil chuka, system ko pata nahi) · `overdueSettlements` · `strandedDrafts`

> **Vendor doc me:** #182, #195, #196, #197 (4) · **Admin doc me:** #183–#197 (15) · Customer doc me: **koi nahi** (403)

---

# G. Platform

## 30. Settings — `/settings` (2)

Global middleware: `router.use(verifyJwtToken)`, uske upar per-route `isAdmin`.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 198 | GET | `/settings/get` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `security.otp` (60s / 5 per hour), `refund.*` limits, `settlement.*` (golden rule + `requiresAdminApproval`), reserve rates, `chargeback.writeOffDays` — sab yahin se |
| 199 | PUT | `/settings/update` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ Validator golden rule enforce karta hai: `settlementDelayHours >= refundWindowHours + vendorApprovalHours + adminBufferHours` |

> **Admin doc me:** dono (2)

---

## 31. Terms & Conditions — `/terms-and-conditions` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 200 | POST | `/terms-and-conditions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 201 | GET | `/terms-and-conditions/getAll` | Intended: Guest + all panels · Enforced: **Public** | 🟠 |
| 202 | GET | `/terms-and-conditions/get/:id` | Intended: Guest + all panels · Enforced: **Public** | 🟠 |
| 203 | PUT | `/terms-and-conditions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 204 | DELETE | `/terms-and-conditions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> Legal page bina login khulni **chahiye** — signup screen se hi uska link hota hai.

> **Guest surface me:** #201, #202 · **Customer doc me:** #201, #202 · **Vendor doc me:** #201, #202 · **Admin doc me:** saare 5

---

## 32. Privacy & Policies — `/privacy-and-policies` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 205 | POST | `/privacy-and-policies/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 206 | GET | `/privacy-and-policies/getAll` | Intended: Guest + all panels · Enforced: **Public** | 🟠 |
| 207 | GET | `/privacy-and-policies/get/:id` | Intended: Guest + all panels · Enforced: **Public** | 🟠 |
| 208 | PUT | `/privacy-and-policies/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 209 | DELETE | `/privacy-and-policies/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Guest surface me:** #206, #207 · **Customer doc me:** #206, #207 · **Vendor doc me:** #206, #207 · **Admin doc me:** saare 5

---

## 33. App Config 🆕 — `/app-config` (1)

App launch ka pehla call. Mount `/app-config` par (`routes/appConfig.js`, `routePrefix`
override ke saath — filename se `/appConfig` banta).

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 210 🆕 | GET | `/app-config` | Intended: Guest + har app · Enforced: **Public** | 🟠 | Min version, force-update, support contact, feature flags, convenience-fee slab, refund window. `?platform=` + `?version=` dene par server **khud** `updateRequired` tay karta hai |

> ### ⚠️ Whitelist hai, "`Setting` minus kuch" nahi
>
> Wahi document commission percentage, reserve rates, settlement timing aur gateway-fee
> bearer bhi rakhta hai. `helpers/settings/getAppConfig.js` **har field naam lekar**
> banata hai — kyunki ek `...spread` us line par bilkul normal dikhta aur platform ki
> economics public kar deta. Yahi wajah `/brands/customer/get/:brandId` ke apne endpoint
> hone ki bhi hai.

> ### ⚠️ Version comparison server par hoti hai, app me nahi
>
> ```
> "1.10.0" < "1.9.0"     // text me TRUE — aur bilkul galat
> ```
>
> Do apps me *"kya main minimum se neeche hoon"* likhna do mauke hain ye galti karne ke,
> aur wo galti un builds me hoti hai jinhe theek karne ke liye **wahi update chahiye jo wo
> maang rahe hain**. Segment-wise numeric compare, ek jagah.
>
> ⚠️ `version` na aaye to `updateRequired` **`null`** hai — imaandaar *"poocha hi nahi"*,
> us `false` ki jagah jis par client bharosa kar leta.

> ### ⚠️ `features` screen chhupate hain, endpoint band nahi karte
>
> `promoCodes: false` app ko promo ka box na dikhane ko kehta hai. `create-order` phir
> bhi apna hard `422` deta hai jab promo band ho — server apni enforcement khud karta hai.
> Flag ko enforcement samajhna wo tareeka hai jisse feature UI me "off" hota hai aur API
> par khula.

**Admin ise `PUT /settings/update` ke naye `app` block se badalta hai.** Partial PATCH
safe hai: sirf `support` bhejne par `features` waise hi rehte hain (`mergeBlock`, wahi
jo baaki blocks use karte hain).

---

## Utility / Non-versioned (3) — docs se bahar

`GET /` (health) · `GET /my-ip` · `GET /client-ip` — sab public, `/trydood/v1` ke **bahar**, `index.js` me seedha declare.

| Path | Kya | Kyu |
|---|---|---|
| `GET /` | `"Welcome to Trydood 2.0🚀"` | Health check. ⚠️ Rate limiter me **skip** hai — ise ginne ka koi fayda nahi |
| `GET /my-ip` | `configs/render.js` ka `getIP` | Outbound address, jo **Atlas Network Access** list me daalna hota hai. EC2 par jaate waqt yahi batata hai kaunsa Elastic IP allow karna hai |
| `GET /client-ip` | `x-forwarded-for` ya socket address | `TRUST_PROXY` sahi set hai ya nahi, ye debug karne ke liye |

> ⚠️ **Rate limiter ke exemptions `index.js` me hain:** `WEBHOOK_PATHS` (dono Razorpay
> endpoints, #139 aur #140) aur `/`. Webhook ko `429` dena kuch der retry hota hai
> aur phir **drop** ho jaata hai, aur uska ekmatra lakshan hai **paisa jo hilna band
> kar deta hai** — koi error nahi, koi alert nahi. **Teesra webhook jodo to use
> `WEBHOOK_PATHS` me bhi jodo.**

---

# 🟠 Guest Surface — 21 Endpoints

**Bina kisi token ke** chalne wale endpoints — guest app ka poora surface.
17 par koi gate nahi hai; 4 `optionalAuth` par hain (⭐ se mark).

| # | Method | Endpoint | Enforced | Section |
|---|---|---|---|---|
| 40 | GET | `/brands/customer/get-all` | Public | Brand directory + Top Brands tab |
| 41 | GET | `/brands/customer/get/:brandId` | Public | Brand profile |
| 68 | GET | `/showcase/get-brand-showcase/:brandId` | Public | Brand gallery |
| 69 | GET | `/showcase/:brandId/video-clips` | Public | Reels feed |
| 73 | GET | `/brandFeatures/get-all` | Public | Brand highlights (`brandId` query mandatory) |
| 74 | GET | `/brandFeatures/get/:featureId` | Public | Ek highlight |
| 85 ⭐ | GET | `/vouchers/customer/get-all` | **optionalAuth** | Voucher listing (guest ko `latitude`+`longitude` dena hoga) |
| 86 ⭐ | GET | `/vouchers/customer/get/:voucherId` | **optionalAuth** | Voucher detail |
| 87 ⭐ | POST | `/vouchers/customer/voucher/preview` | **optionalAuth** | **Daam** — guest ko price milta hai, order nahi |
| 93 | GET | `/banners/customer/active` | Public | Home banner |
| 99 | GET | `/promotionalTickers/customer/active` | Public | Home ticker strip |
| 101 | GET | `/categories/getAll` | Public | Category list + stats |
| 102 | GET | `/categories/get/:id` | Public | Ek category |
| 106 | GET | `/subCategories/getAll` | Public | Sub-category list + stats |
| 107 | GET | `/subCategories/get/:id` | Public | Ek sub-category |
| 110 ⭐ | GET | `/search` | **optionalAuth** | Global search — 5 sections ek call me |
| 111 | GET | `/search/popular` | Public | Popular chips (mostly guests ke liye) |
| 201 | GET | `/terms-and-conditions/getAll` | Public | Legal |
| 202 | GET | `/terms-and-conditions/get/:id` | Public | Legal |
| 206 | GET | `/privacy-and-policies/getAll` | Public | Legal |
| 207 | GET | `/privacy-and-policies/get/:id` | Public | Legal |

### ⭐ optionalAuth wale 4 — guest aur signed-in ka farq

| Endpoint | Guest ko | Token ke saath extra |
|---|---|---|
| `/vouchers/customer/get-all` | `latitude`+`longitude` **khud dena padega** | Saved address coordinates ki jagah le leta hai |
| `/vouchers/customer/get/:voucherId` | Wahi | Wahi |
| `/vouchers/customer/voucher/preview` | Daam mil jaata hai | Wahi, aur customer-specific promo eligibility |
| `/search` | Chalta hai | Saved address fallback + committed query **history me save** hoti hai |

⚠️ **Expired token = `401`, guest-view par silent downgrade nahi.** Client ko iska
matlab *"sign out karo"* samajhna chahiye, *"guest ban jao"* nahi — warna session
expire hone par customer ko apni saved location aur history gayab dikhti aur kahin
koi error nahi hota.

### Guest ko kya **nahi** milta — aur ye deliberate hai

| Kya | Kahan | Kyu |
|---|---|---|
| Order kholna | `/voucher-claims/create-order` `isCustomer` | **Guest ko daam milta hai, order nahi.** Paisa hilne ka lamha signed-in hona chahiye |
| Search history | `/search/history` `isCustomer` | Guest ki history uske **device par** hai — yahan koi anonymous identity nahi jispar row key ho. Khaali list dena jhoot hoga |
| Follow / avoid | `/follows` · `/brandAvoidances` `isCustomer` | Kis par save karein? |
| Location save | `/locations/upsert` `isCustomer` | Wahi |

---

# 📱 Customer Mobile App Doc — 57 Endpoints

**17 exclusive + 21 guest + 18 shared global + 1 🤖 invoice link**

| Section | Count | Endpoints (#) |
|---|---:|---|
| 1. Authentication | 3 | 3, 4, 12 |
| 2. User Profile | 3 | 13, 14, 15 ⚠️ (no-op) |
| 3. Push Notifications | 4 | 18, 19, 20, 21 |
| 4. Location | 2 | 55, 56 |
| 5. Master Data 🟠 | 4 | 101, 102, 106, 107 |
| 6. Home Screen 🟠 | 2 | 93, 99 |
| 7. Search 🟠🟢 | 5 | 110 ⭐, 111, 112, 113, 114 |
| 8. Vouchers 🟠🟢 | 3 | 85 ⭐, 86 ⭐, 87 ⭐ |
| 9. Brand Profile 🟠 | 6 | 40, 41, 68, 69, 73, 74 |
| 10. Engagement | 4 | 115, 116, 117, 118 |
| 11. Voucher Claims | 7 | 153, 154, 155, 156, 157, 158, 159 |
| 12. Refunds | 5 | 164, 165, 166 🆕, 176, 177 |
| 13. Bank Accounts 🆕 | 4 | 160, 161, 162, 163 |
| 14. Invoice link 🤖 | 1 | 138 |
| 15. Legal 🟠 | 4 | 201, 202, 206, 207 |
| **TOTAL** | **57** | |

> ✅ Saare 57 distinct hain — koi endpoint do section me nahi hai.
>
> **✅ v1.6.0 me poora ho gaya — 35 se 57.** Jude: bank accounts (4 🆕), voucher claims
> (7 — pehle doc me nahi the), refunds (5, jisme #166 naya), search (5 — pehle
> nahi the), invoice link (1).
>
> **Customer ko ye nahi milte, gate ke bawajood:**
> #148/#178/#181 (disputes) aur #195/#196/#197 (settlements) — bare
> `verifyJwtToken` par hain par service `403` deti hai. #120/#121 (plan catalogue)
> aur #5–#8 (email/mobile OTP) product decision se bahar hain.

---

# 🏪 Vendor Panel Doc — 97 Endpoints

**15 exclusive + 70 shared global + 10 guest reads + 2 🤖 links**

| # | Section | Count | Endpoints (#) |
|---:|---|---:|---|
| 1 | Authentication (WhatsApp/Email/Mobile OTP + logout) | 7 | 3–8, 12 |
| 2 | User Profile | 3 | 13–15 |
| 3 | Push Notifications | 4 | 18–21 |
| 4 | Notification Feed | 2 | 22, 23 |
| 5 | Onboarding (basic ×2, PAN, GST, bank, system-verify, partnership, acknowledge) | 8 | 25–32 |
| 6 | KYC Verification (PAN / GST / bank) | 3 | 44–46 |
| 7 | Brand (get, update, verification history) | 3 | 39, 42, 43 |
| 8 | Outlets / Sub-brands | 3 | 47–49 |
| 9 | Work Hours | 1 | 50 |
| 10 | Locations | 5 | 51–54, 56 |
| 11 | Showcase (6 sections + 5 media) | 11 | 57–67 |
| 12 | Vouchers (create/update/submit/publish/versions/banner ×2) | 7 | 75–77, 79, 80, 83, 84 |
| 13 | Brand Features | 5 | 70–74 |
| 14 | Subscription Plans (browse) | 2 | 120, 121 |
| 15 | My Subscription (get, history) | 2 | 130, 131 |
| 16 | Payments (preview, order, verify, invoice regenerate, invoice link) | 5 | 141–144, 138 |
| 17 | Voucher Claims (reads — "meri bikri") | 5 | 155–159 |
| 18 | Refunds (decide ×2, reads ×2) | 4 | 167, 168, 176, 177 |
| 19 | Disputes (worklist, evidence, detail) | 3 | 178, 179, 181 |
| 20 | Disputes — legacy mount (Postman inhi par hai) | 2 | 148, 149 |
| 21 | Settlements (statement link + 3 reads) | 4 | 182, 195, 196, 197 |
| 22 | Master Data 🟠 | 4 | 101, 102, 106, 107 |
| 23 | Legal 🟠 | 4 | 201, 202, 206, 207 |
| **TOTAL** | | **97** | |

> ### 🔵 Outlet / SUB_VENDOR token se kya khulta hai
>
> Alag doc **nahi** hai — vendor ye sab bhi kar sakta hai, isliye ye vendor doc me
> hi hain, "outlet manager bhi" note ke saath.
>
> **Outlet ka account kaise banta hai:** vendor `POST /subBrands/signUp-with-whatsapp`
> (#47) call karta hai; service `role: SUB_VENDOR` ka User banati hai **bina
> password ke**, aur outlet ke number par `sendOtp(WHATSAPP, …)` bhejti hai
> (`signUpSubBrandWithWhatsapp.js:94`) — **wahi verify step hai**. Uske baad
> outlet wala `POST /auth/loginOrSignUp-with-whatsapp` se login karta hai;
> `SELF_SIGNUP_ROLES` sirf usse *khud ko banane* se rokta hai, login se nahi.
>
> **4 — outlet-specific gate (`isVendorOrSubVendor`):**
>
> | # | Endpoint | Kya |
> |---|---|---|
> | 167 | `PATCH /refunds/:requestId/approve` | Outlet manager apne counter par kya hua wo tay karta hai; service use usi outlet tak narrow karti hai |
> | 168 | `PATCH /refunds/:requestId/reject` | `note` zaroori |
> | 179 | `POST /disputes/:disputeId/evidence` | KOT/bill number, camera timestamp, staff ko kya yaad hai |
> | 149 | `POST /transactions/disputes/:disputeId/evidence` | Wahi, legacy mount |
>
> **+ 27 — sirf `verifyJwtToken` par**, yaani koi bhi logged-in role. Outlet ke
> kaam ke jo hain: `GET /voucher-claims/code/:claimCode` (counter par code
> padhna), `/voucher-claims`, `/voucher-claims/:claimId`,
> `/voucher-claims/payments`, `/refunds`, `/refunds/:requestId`, `/disputes`,
> `/disputes/:disputeId`, `/settlements`, `/settlements/:settlementId`.
>
> **Kul 31.** Har ek par scope service ke andar kata jaata hai —
> `assertClaimAccess` outlet ka `subBrandId` match karta hai warna `403`, aur
> `VoucherClaim.subBrandId` `required: true` hai to wo check kabhi skip nahi hota.
>
> ⚠️ `GET /settlements` (#195) par `SUB_VENDOR` ko **poora brand** dikhta hai, apna
> outlet nahi — settlement poore brand ke din ka hai, ek counter ka nahi.
>
> ⚠️ **Baaki sab par `403`**, aur wajah ek hi hai: `resolveActorBrand` par
> `String(brand.userId) !== String(userId)`. SUB_VENDOR ka `userId` Brand par
> hota hi nahi (uske paas `subBrandId` hai), to us helper se guzarne wala har
> kaam — vouchers, showcase, subscriptions — outlet ke liye band hai. Wo helper
> **16 files** use karti hain.
>
> ℹ️ Do middleware bane hain par **koi route inhe use nahi karta**: `isSubVendor`
> (`validateRoles.js:19`) aur `isBrandSideOrAdmin` (`validateRoles.js:34`).

> **Vendor ko ye nahi milte:** 17 customer-exclusive + 82 admin-exclusive +
> 11 guest reads jo panel use nahi karta (#40, #41, #68, #69, #85–#87, #93, #99,
> #110, #111) + 2 machine (#139, #140 — Razorpay ke) = 112. `209 − 112 = 97` ✓

---

# 🛡️ Super Admin Panel Doc — 170 Endpoints

**82 exclusive + 70 shared global + 14 guest reads + 4 🤖 reference**

| # | Section | Count | Endpoints (#) |
|---:|---|---:|---|
| 1 | Authentication (register, login, OTP ×6, password ×3, logout) | 12 | 1–12 |
| 2 | User Profile | 3 | 13–15 |
| 3 | Customers 🆕 (directory + support screen) | 2 | 16, 17 |
| 4 | Push Notifications | 4 | 18–21 |
| 5 | Notifications (feed, mark-read, **broadcast**) | 3 | 22–24 |
| 6 | Brand Directory 🆕 (triage list + **account on/off**) | 2 | 33, 34 |
| 7 | Brand Verification (queue, review, history) | 3 | 35, 36, 39 |
| 8 | Top Brands curation | 2 | 37, 38 |
| 9 | Brand Data (get, update) | 2 | 42, 43 |
| 10 | Outlets / Sub-brands | 3 | 47–49 |
| 11 | Work Hours | 1 | 50 |
| 12 | Locations | 5 | 51–54, 56 |
| 13 | Showcase (6 sections + 5 media) | 11 | 57–67 |
| 14 | Vouchers (**review**, create, update, submit, publish, versions, banner ×2) | 8 | 75–80, 83, 84 |
| 15 | Voucher Suggestions curation | 2 | 81, 82 |
| 16 | Banners (app-level CRUD) | 5 | 88–92 |
| 17 | Promotional Tickers CRUD | 5 | 94–98 |
| 18 | Brand Features | 5 | 70–74 |
| 19 | Categories CRUD | 5 | 100–104 |
| 20 | Sub Categories CRUD | 5 | 105–109 |
| 21 | Subscription Plans CRUD | 5 | 119–123 |
| 22 | Subscribeds (grant, cancel, get-all, forfeited, compensate, resync, get, history) | 8 | 124–131 |
| 23 | Promo Codes (CRUD + reports) | 6 | 132–137 |
| 24 | Transactions & Payments (preview, order, verify, invoice regenerate) | 4 | 141–144 |
| 25 | Webhook Ops (events, event detail, replay) | 3 | 145–147 |
| 26 | Payment Health 🆕 | 1 | 151 |
| 27 | Release Hold 🆕 | 1 | 152 |
| 28 | Voucher Claims (reads) | 5 | 155–159 |
| 29 | Refunds (admin approve/reject/pay + 4 MANUAL_BANK 🆕 + 2 reads) | 9 | 169–177 |
| 30 | Disputes (worklist, evidence-pack, detail) | 3 | 178, 180, 181 |
| 31 | Disputes — legacy mount | 2 | 148, 150 |
| 32 | Settlements (12 admin actions + 3 reads) | 15 | 183–197 |
| 33 | Settings | 2 | 198, 199 |
| 34 | Legal CRUD (terms ×5 + privacy ×5) | 10 | 200–209 |
| 35 | 🤖 Machine (reference — admin call **nahi** karta) | 4 | 138, 139, 140, 182 |
| 36 | 🟠 Guest reads (brand preview — panel ye screens dikhata hai) | 4 | 40, 41, 68, 69 |
| **TOTAL** | | **170** | |

> ⚠️ Section 35 **reference** hai — admin panel ye chaar call nahi karta. #139/#140
> Razorpay call karta hai; #138/#182 wo link hain jo WhatsApp/email se seedha browser
> me khulte hain. Fir bhi admin doc me hain kyunki webhook config, invoice recovery
> aur statement revoke sab admin ke kaam hain.
>
> ### ⚠️ Round 5 me is table ki teen ginti pakdi gayi
>
> Pehle isme **166** likha tha, aur teen galtiyaan thi — sab ek hi kism ki, ki
> gate padhe bina maan liya gaya ki admin sab kuch kar sakta hai:
>
> | Kya | Tha | Ab | Kyu |
> |---|---|---|---|
> | Disputes | `178–181` (4) | `178, 180, 181` (3) | **#179 `isVendorOrSubVendor` hai** — admin evidence add **nahi** kar sakta. Wo outlet ka kaam hai (KOT number, camera timestamp), aur admin ke paas wo cheezein hoti hi nahi |
> | Legacy mount | `148–150` (3) | `148, 150` (2) | **#149 wahi baat**, legacy mount par |
> | Guest reads | 6 (`…, 73, 74`) | 4 | #73/#74 (brandFeatures reads) **section 18 me pehle se the** — do baar gine gaye |
>
> **Admin ko ye nahi milte:** 17 customer-exclusive (#55, #112–#118, #153, #154,
> #160–#166) + 15 vendor-exclusive (onboarding 8, KYC 3, refund decide 2, dispute
> evidence 2) = 32, aur uske upar 7 guest reads jo panel use nahi karta
> (#85–#87, #93, #99, #110, #111). `209 − 32 − 7 = 170` ✓

---

## Doc build status

| Doc | Endpoints | Status |
|---|---:|---|
| `endpoints_category.md` | **216** | ✅ **Round 6 — ye file.** Live routers ke against introspection se verify |
| 🟠 Guest surface | 21 | 🆕 Round 5 — naya category, poori list is file me |
| `customer_mobile_api_doc.md` | 62 | ✅ **v1.7.0** — live verified, 135 requests · 473 assertions · 0 failed · 198 captured examples (135/135 requests) |
| `vendor_panel_api_doc.md` | 97 | ⚠️ **v1.2.1 me 78 hain** — 19 jodne hain (voucher claims reads, refunds, disputes, settlements, legacy mounts) |
| `super_admin_panel_api_doc.md` | 170 | ⬜ Baaki |
| `security_findings.md` | 3 open (2 deferred) | ⚠️ Round 5 ke naye findings jodne hain — #15 no-op delete, #4 OTP verify commented |
| `account_deletion_plan.md` | – | ⏸️ Deferred — full flow ready hone pe |

**Postman:** customer (74 requests · 308 assertions) aur vendor (101 requests · 234
assertions) — dono verified → [postman/README.md](../postman/README.md). Admin baaki.

> ⚠️ **Postman generators captured examples delete kar dete hain.** `trydood-customer`
> aur `trydood-vendor` me live runs ke captured examples hain jo generators ke bare me
> jaante hi nahi — generator dobara chalane par poori file rewrite hoti hai aur wo
> examples chale jaate hain (**15,499 lines** naapi gayi thi, command phir bhi success
> report karta hai). Sirf us generator ko chalao jiska source badla, aur baad me
> `git diff --stat postman/` dekho.

> `API_DOCUMENTATION.md` **Romani project ka reference doc** hai — Trydood ka nahi. Ise chheda nahi gaya.
> (`CUSTOMER_API_DOC.md` bhi wahi tha aur delete kar diya gaya — 2026-08-30.)

**Ab baaki:** customer doc ke 22 naye + vendor doc ke 19 naye + poora admin doc (170).

**Related design docs** (in-scope, alag maintain hote hain):
[refund_flow.md](./refund_flow.md) · [settlement_flow.md](./settlement_flow.md) ·
[dispute_flow.md](./dispute_flow.md) · [global_customer_search_plan.md](./global_customer_search_plan.md) ·
[customer_voucher_claim_plan.md](./customer_voucher_claim_plan.md) ·
[brand_verification_api_doc.md](./brand_verification_api_doc.md) ·
[brand_admin_list_and_status_api_doc.md](./brand_admin_list_and_status_api_doc.md) ·
[brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md) ·
[brand_verification_future_updates.md](./brand_verification_future_updates.md) ·
[subscription_lifecycle_design.md](./subscription_lifecycle_design.md) ·
[subscription_future_updates.md](./subscription_future_updates.md) ·
[api_client_auth_plan.md](./api_client_auth_plan.md)
