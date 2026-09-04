# Trydood 2.0 — Endpoint Categorization Map

**Purpose:** Har backend endpoint ko uske consumer (Customer Mobile App / Vendor Panel / Super Admin Panel / Global) ke hisaab se categorize karna, taaki 3 alag-alag API documentation files banayi ja sakein.

**Status:** ✅ **Round 4 — security fixes + curation features (2026-08-26).** Code ke against verify kiya gaya, 149 endpoints.

**Base URL:**
- Local: `http://localhost:8080/trydood/v1`
- Staging: `https://backend2-0-4v4i.onrender.com/trydood/v1`

**Framework:** Express.js (CommonJS) · **DB:** MongoDB (Mongoose)
**Route mounting:** `routes/index.js` auto-mounts har file ko uske filename se → `routes/subBrands.js` = `/trydood/v1/subBrands` (camelCase preserved)
**Scanned:** 2026-09-03 · **Total endpoints:** 202 (+3 utility/non-versioned)

> Count Express router introspection se nikala gaya hai (har mounted router ka `stack`),
> route files hand-count karke nahi.
>
> ⚠️ **Par ye phir bhi drift karta hai, aur kiya bhi.** Pehle yahan likha tha *"is liye
> ye drift nahi karega"* — introspection ek **baar** chalaya gaya tha aur uska nateeja
> yahan chipka diya gaya tha. Ek hafte me ginti 149 se 202 ho gayi aur ye line wahi
> padi rahi, apne aap par bharosa dilati hui. Kisi bhi doc me likhi hui sankhya sirf us
> din sach hoti hai jis din wo nikali gayi ho:
>
> ```bash
> node -e "const fs=require('fs');let t=0;for(const f of fs.readdirSync('routes')){if(f==='index.js'||!f.endsWith('.js'))continue;const r=require('./routes/'+f),R=r.router||r;if(typeof R==='function'&&R.stack)t+=R.stack.filter(l=>l.route).length}console.log(t)"
> ```

---

## 🆕 Round 2 → Round 3 me kya badla

Pichhla scan 2026-08-21 ko hua tha (108 endpoints). Uske baad **35 naye endpoints** aaye aur security posture kaafi improve hui.

### Naye modules (4) — 21 endpoints

| Module | Endpoints | Kya karta hai | Primary consumer |
|---|---:|---|---|
| `/promoCodes` | 6 | Subscription promo codes — CRUD + usage report | 🟣 ADMIN (poora module `router.use(isAdmin)`) |
| `/subscribeds` | 8 | Subscription lifecycle — grant, cancel, resync, forfeit compensation, history | 🟣 ADMIN (6) + ⚪ Vendor/Admin (2) |
| `/deviceTokens` | 4 | Push notification device registration | ⚪ **All roles** (role-agnostic by design) |
| `/notifications` | 3 | In-app notification feed + admin broadcast | ⚪ Vendor+Admin (2) + 🟣 ADMIN (1) |

### Existing modules me naye endpoints — 14

| Module | Naye | Kya |
|---|---:|---|
| `/auth` | +3 | `set-password` (signed-in), `forgot-password` + `reset-password` (public 2-step) |
| `/brands` | +4 | `onboarding/acknowledge-approval` (vendor) · `admin/verifications` (list) · `admin/verifications/:brandId/review` · `verifications/history` (shared audit trail) |
| `/transactions` | +8 | `subscribe/preview` · `invoice/regenerate` · `webhook/razorpay` + `webhook/razorpay/customer` (public HMAC, ek per Razorpay account) · `webhook/events` + `/:eventId` + `replay/:eventId` · `disputes*` (⚠️ ab canonical ghar `/disputes` hai — ye compatibility ke liye rehte hain) |
| `/disputes` 🆕 | 4 | `` (worklist) · `/:disputeId` · `/:disputeId/evidence` · `/:disputeId/evidence-pack`. Dispute pehle `Transaction` par das fields tha; ab apna collection, apne jobs, apni notifications — yani apna domain |

### 🔒 Security improvements (badi baat)

**1. `resolveActorBrand` helper aa gaya** — [helpers/brands/resolveActorBrand.js](../helpers/brands/resolveActorBrand.js)

Ye ownership enforcement ka proper pattern hai:
- **ADMIN** ko `brandId` dena mandatory hai, koi bhi brand chun sakta hai
- **VENDOR** default apna brand, aur **sirf apna** — brand ka `userId` token ke `userId` se match hota hai (token ka cached `brandId` trust nahi karta, wo smart hai)

11 services isko use karte hain: vouchers (create/update/banner×2), transactions (preview/create-order), subscribeds (get/history), notifications (get-all/mark-read), subBrands (signup).

**2. Role gates kaafi routes pe lag gaye** — pichhle scan me 108 me se sirf 20 gated the. Ab:

| Module | Pehle | Ab |
|---|---|---|
| `/vouchers` | sab open | `isVendorOrAdmin` (5), `isAdmin` (1), `verifyJwtToken` (5) |
| `/transactions` | sab open | `isVendorOrAdmin` (4), `isAdmin` (4), public webhook (1) |
| `/subBrands` | sab open | `isVendorOrAdmin` (2), `verifyJwtToken` (1) |
| `/brands` | 7 vendor | +`isAdmin` (2) admin verification |
| `/promoCodes` | – | `isAdmin` (poora module) |
| `/subscribeds` | – | `isAdmin` (6), `isVendorOrAdmin` (2) |
| `/notifications` | – | `isVendorOrAdmin` (2), `isAdmin` (1) |

**3. Shared default password issue fix ho gaya** ✅ — `User.password` ab optional hai (`required: true` hata), `passwordSetAt` field add hui, aur proper `set-password` / `forgot-password` / `reset-password` flow hai. Pehle har OTP account ek hi known password pe banta tha.

> Ye Round 3 ka snapshot hai. Jo tab open tha uska current status neeche Round 4 me hai.

---

## 🆕 Round 3 → Round 4 me kya badla

**Scan:** 2026-08-26 · 143 → **149 endpoints** (+6)

### ✅ Round 3 ke open findings — ab band

| Finding | Round 3 | Ab |
|---|---|---|
| `/auth/register` public + default role `ADMIN` | 🔴 Open | ✅ `isAdmin` gated, `role` required (no default), `ADMIN` self-signup blocked |
| `/users/get\|update?userId=` IDOR | 🔴 Open | ✅ `userId` ab token se aata hai, query param hata diya |
| Role gates missing (~35 endpoints) | 🟠 Open | ✅ 149/149 accounted — 10 hi intentionally public (9 auth entry + Razorpay webhook) |
| `showcase/section/get-all` brand scoping | 🟠 Open | ✅ Vendor apne brand pe pinned, admin global |
| `/brands/get` PII exposure | 🟠 Open | ✅ `isVendorOrAdmin`; customer ke liye alag `/brands/customer/get/:brandId` |
| Location IDOR + `userId` spoofing | 🟠 Open | ✅ Per-role ownership `getLocation` / `upsertLocation` me |
| Signup half-fail (User bane, Brand/Customer nahi) | 🟠 Open | ✅ `session.withTransaction` + orphan self-heal |
| `isFirst: false` jab OTP na aaye | 🟠 Open | ✅ Ab verification state pe based hai, document existence pe nahi |
| WhatsApp OTP verify commented out | 🔴 Open | ⏸️ **Deferred** — aapka decision, patch ready hai |
| `DELETE /users/delete` no-op | 🟡 Open | ⏸️ **Deferred** — [account_deletion_plan.md](./account_deletion_plan.md), full flow ready hone pe |

### Naye middleware

| Name | Kya |
|---|---|
| `isVendorOrAdmin` | Customer ko vendor/admin shared routes se bahar rakhta hai; vendor ke liye `req.brandId` set karta hai |
| `isSubVendor` | Outlet-level actor |

### Naye endpoints — 6

| Method | Endpoint | Gate | Kyu |
|---|---|---|---|
| `GET` | `/brands/customer/get/:brandId` | `isCustomer` | Customer brand profile — `/brands/get` ka PII kabhi nahi chhuta |
| `GET` | `/brands/customer/get-all` | `isCustomer` | Brand directory + "Top Brands" tab (`topOnly`) |
| `PUT` | `/brands/admin/top-brands/:brandId` | `isAdmin` | Top brand add / remove / reorder |
| `GET` | `/brands/admin/top-brands` | `isAdmin` | Admin ka top-brands view |
| `PUT` | `/vouchers/admin/suggestions/:voucherId` | `isAdmin` | Suggested voucher add / remove / reorder |
| `GET` | `/vouchers/admin/suggestions` | `isAdmin` | Admin ka suggestions view |

### Existing endpoints me naye fields

| Endpoint | Naya |
|---|---|
| `GET /vouchers/customer/get-all` | `suggestedOnly` param · `bannerType` · `bannerUrl` · `isSuggested` · `isOutOfRange` |
| `GET /vouchers/customer/get/:voucherId` | `bannerType` · `bannerUrl` |
| `POST /vouchers/customer/voucher/preview` | `offerApplied` · `pricing.convenienceFee` · `pricing.promoDiscount` · no-offer fallback (ab error nahi) |
| `GET /categories/getAll` · `/get/:id` | `stats.subCategories` · `stats.brands` · `stats.vouchers` · `stats.promoCodes`, har ek `{ total, active }` |
| `GET /subCategories/getAll` · `/get/:id` | `stats.brands` · `stats.vouchers` (`promoCodes` sirf category level pe hai) |
| `DELETE /categories/delete/:id` · `/subCategories/delete/:id` | Naya `400` — jab tak koi sub-category / brand / voucher use kar raha hai, delete nahi hoga |
| `GET /vouchers/customer/get-all` | 🔴 `categoryId` / `subCategoryId` **filter ab kaam karta hai** — pehle har category-filtered request `404` deti thi, aur har row me ye fields `undefined` aati thi. Taxonomy `VoucherVersion` par hai, `Voucher` par nahi thi |
| `GET /vouchers/customer/get-all?search=` | Offer ka title bhi match hota hai ("buy 1 get 1"), aur term ab escape hoti hai — `(` type karne pe `500` nahi aata |

Detail → [security_findings.md](./security_findings.md) · [voucher_brand_features_plan.md](./voucher_brand_features_plan.md)

---

## Legend

| Tag | Meaning | Kis doc me jayega |
|---|---|---|
| 🟢 **CUSTOMER** | Sirf customer mobile app ke liye | `customer_mobile_api_doc.md` |
| 🔵 **VENDOR** | Sirf vendor/brand panel ke liye | `vendor_panel_api_doc.md` |
| 🟣 **ADMIN** | Sirf super admin panel ke liye | `super_admin_panel_api_doc.md` |
| ⚪ **GLOBAL** | 2+ panels use karte hain | Saare relevant docs me (panel-specific note ke saath) |

**Access column format** (Q10a → Option B):

```
Intended: <jiske liye banaya gaya hai>  ·  Enforced: <backend actually kya rokta hai>
```

`Enforced` values:
- `Public` — koi token nahi
- `Any authenticated` — sirf `verifyJwtToken`, **role check nahi hai**
- `ADMIN` / `VENDOR` / `VENDOR+ADMIN` — role middleware se enforced
- `+ ownership` — `resolveActorBrand` se brand-level ownership bhi enforced
- `CUSTOMER (service)` — route pe middleware nahi, lekin service code me role verify hota hai

---

## Summary

| Module | Base path | Total | 🟢 | 🔵 | 🟣 | ⚪ |
|---|---|---:|---:|---:|---:|---:|
| Auth | `/auth` | 12 | – | – | 2 | 10 |
| Users | `/users` | 3 | – | – | – | 3 |
| Device Tokens 🆕 | `/deviceTokens` | 4 | – | – | – | 4 |
| Notifications 🆕 | `/notifications` | 3 | – | – | 1 | 2 |
| Brands | `/brands` | 17 | 2 | 8 | 4 | 3 |
| Verification (KYC) | `/verification` | 3 | – | 3 | – | – |
| Sub Brands (Outlets) | `/subBrands` | 3 | – | – | – | 3 |
| Work Hours | `/workHours` | 1 | – | 1 | – | – |
| Locations | `/locations` | 6 | 1 | – | – | 5 |
| Showcase | `/showcase` | 13 | 2 | 9 | – | 2 |
| Vouchers | `/vouchers` | 13 | 3 | – | 3 | 7 |
| Banners (App-level) | `/banners` | 6 | 1 | – | 5 | – |
| Promotional Tickers | `/promotionalTickers` | 6 | 1 | – | 5 | – |
| Brand Features | `/brandFeatures` | 5 | – | – | – | 5 |
| Brand Avoidances | `/brandAvoidances` | 2 | 2 | – | – | – |
| Follows | `/follows` | 2 | 2 | – | – | – |
| Categories | `/categories` | 5 | – | – | 3 | 2 |
| Sub Categories | `/subCategories` | 5 | – | – | 3 | 2 |
| Subscriptions (Plans) | `/subscriptions` | 5 | – | – | 3 | 2 |
| Subscribeds 🆕 | `/subscribeds` | 8 | – | – | 6 | 2 |
| Promo Codes 🆕 | `/promoCodes` | 6 | – | – | 6 | – |
| Transactions | `/transactions` | 9 | – | – | 4 | 5 |
| Settings | `/settings` | 2 | – | – | 2 | – |
| Terms & Conditions | `/terms-and-conditions` | 5 | – | – | 3 | 2 |
| Privacy & Policies | `/privacy-and-policies` | 5 | – | – | 3 | 2 |
| **TOTAL** | | **149** | **14** | **21** | **53** | **61** |

**Per-doc endpoint count:**

| Doc | Endpoints | Breakdown | Status |
|---|---:|---|---|
| 📱 `customer_mobile_api_doc.md` | **35** | 14 exclusive + 21 shared | ✅ **v1.4.0** — live verified, 308 assertions pass |
| 🏪 `vendor_panel_api_doc.md` | **78** | 21 exclusive + 57 shared | ✅ **v1.2.0** — live verified, 234 assertions pass |
| 🛡️ `super_admin_panel_api_doc.md` | **114** | 53 exclusive + 61 shared | ⬜ Baaki hai |

> Sum > 149 kyunki shared endpoints multiple docs me aate hain.
>
> **Cross-check (vendor):** vendor token 81 endpoints tak **pahunch** sakta hai, par unme se 3 customer voucher endpoints hain jo sirf `verifyJwtToken` pe hain — wo vendor panel ke liye nahi. **Vendor-intended = 78.**
>
> Breakdown: 6 public auth entry + 21 shared reads + 40 `isVendorOrAdmin` + 11 `isVendor` = 78.
>
> ⚠️ Round 4 me composition badli thi: password flow (`set-password`, `forgot-password`, `reset-password`) **admin-only** ho gaya, to wo teen vendor set se nikal gaye.
>
> **Cross-check (admin):** 149 − 14 customer-exclusive − 21 vendor-exclusive = **114** ✓

---

## 1. Auth — `/auth` (12)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ✅ Ab gated. `role` **required** hai, koi default nahi. Pehla admin `scripts/seedAdmin.js` se banta hai |
| 2 | POST | `/auth/login` | Intended: ADMIN · Enforced: Public | 🟣 | Password login. `type`: `EMAIL` \| `MOBILE` \| `USERNAME`. ✅ Ab fail-closed hai — jin accounts ne password set nahi kiya, unpe login fail hota hai |
| 3 | POST | `/auth/loginOrSignUp-with-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | `role` default `CUSTOMER`, `ADMIN` **block** hai. Naya number → user + `Customer`/`Brand` ek transaction me. `isFirst` ab verification state pe hai, document existence pe nahi |
| 4 | POST | `/auth/verify-otp-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | OTP verify → JWT. ⚠️ Verify commented out |
| 5 | POST | `/auth/login-with-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ | Email OTP send (Q21 → Option C) |
| 6 | POST | `/auth/verify-otp-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ | |
| 7 | POST | `/auth/login-with-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ | Mobile OTP send |
| 8 | POST | `/auth/verify-otp-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ | |
| 9 🆕 | POST | `/auth/set-password` | Intended: All · Enforced: Any authenticated | ⚪ | Pehli baar password set, ya change. OTP accounts bina password ke bante hain |
| 10 🆕 | POST | `/auth/forgot-password` | Intended: All · Enforced: **Public** | ⚪ | ✅ Account exist kare ya na kare — **same response** deta hai, to enumeration nahi ho sakti |
| 11 🆕 | POST | `/auth/reset-password` | Intended: All · Enforced: Public | ⚪ | 2-step flow ka step 2 |
| 12 | POST | `/auth/logout` | Intended: All · Enforced: Any authenticated | ⚪ | |

> **Customer doc me:** #3, #4, #12 (3 endpoints — Q1 → sirf WhatsApp OTP)
> **Password flows (#9–11) customer doc me nahi** — aapka decision. Vendor + Admin docs me jayenge.

---

## 2. Users — `/users` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 13 | GET | `/users/get` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ `?userId` se kisi bhi user ka profile — IDOR |
| 14 | PUT | `/users/update` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ `?userId` se kisi bhi user ka update — IDOR |
| 15 | DELETE | `/users/delete` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ **No-op stub** — kuch delete nahi karta |

> **Customer doc me:** teeno (3)

---

## 3. Device Tokens 🆕 — `/deviceTokens` (4)

Push notification device registration. **Deliberately role-agnostic** — code comment: *"A customer's phone registers exactly the same way a vendor's does."*
Global middleware: `router.use(verifyJwtToken)`

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 16 | POST | `/deviceTokens/register` | Intended: All · Enforced: Any authenticated | ⚪ | FCM token register |
| 17 | PUT | `/deviceTokens/unregister` | Intended: All · Enforced: Any authenticated | ⚪ | Logout pe call karna chahiye |
| 18 | GET | `/deviceTokens/get-mine` | Intended: All · Enforced: Any authenticated | ⚪ | Caller ke apne devices |
| 19 | POST | `/deviceTokens/test` | Intended: All · Enforced: Any authenticated | ⚪ | Delivery check — **sirf caller ke apne devices pe** |

> **Customer doc me:** chaaron (4) — aapka decision ✅

---

## 4. Notifications 🆕 — `/notifications` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 20 | GET | `/notifications/get-all` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Vendor apne brand tak scoped (`resolveActorBrand`). Admin koi bhi `brandId` de sakta hai, ya omit karke admin-audience feed padh sakta hai |
| 21 | PUT | `/notifications/mark-read` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | |
| 22 | POST | `/notifications/broadcast` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ Platform ke har user tak pahunch sakta hai |

> **Customer doc me:** koi nahi — customer ke liye notification feed abhi nahi hai (sirf push milega)

---

## 5. Brands — `/brands` (17)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 23 | POST | `/brands/onboarding/add-basic-details` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | Step 1 — business name, registration status, entity type |
| 24 | POST | `/brands/onboarding/add-pan-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 25 | POST | `/brands/onboarding/add-gst-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 26 | POST | `/brands/onboarding/add-bank-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 27 | GET | `/brands/onboarding/system-verify` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Auto PAN/GST/Bank cross-match → score → `SystemVerify` doc |
| 28 | PUT | `/brands/onboarding/accept-partnership` | Intended: VENDOR · Enforced: VENDOR | 🔵 | → `SCREENS.SUBSCRIBE_PLAN` |
| 29 🆕 | PUT | `/brands/onboarding/acknowledge-approval` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Approval congratulations screen dismiss → `SCREENS.DASHBOARD` |
| 30 | PUT | `/brands/onboarding/update-basic-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Review/edit flow |
| 31 🆕 | GET | `/brands/admin/verifications` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Brand verification queue |
| 32 🆕 | PUT | `/brands/admin/verifications/:brandId/review` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | approve / reject / revoke / reviewed-toggle |
| 32a 🆕 | PUT | `/brands/admin/top-brands/:brandId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Top brand add / remove / reorder — ek hi endpoint dono taraf (`isTopBrand: false` = remove) |
| 32b 🆕 | GET | `/brands/admin/top-brands` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Admin view — deactivated pinned brands bhi dikhte hain taaki unpin ho sakein |
| 33 🆕 | GET | `/brands/verifications/history` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Shared audit trail — admin koi bhi brand, vendor sirf apna (service-level scoping) |
| 33a 🆕 | GET | `/brands/customer/get/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Public brand profile — brand + 10 features + visible showcase + outlets. Koi PII nahi |
| 33b 🆕 | GET | `/brands/customer/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 | Brand directory + "Top Brands" tab (`topOnly`). Geo optional |
| 34 | GET | `/brands/get` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | ✅ Ab gated. PAN/GST/Bank yahin rehte hain — customer ke liye #33a hai |
| 35 | PUT | `/brands/update` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | ✅ Ab gated |

> **Customer doc me:** #33a, #33b (2) — #34 ab customer-facing **nahi** hai

---

## 6. Verification / KYC — `/verification` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 36 | POST | `/verification/brands/onboarding/verify-pan` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | CGPey PAN verify |
| 37 | POST | `/verification/brands/onboarding/verify-gst` | Intended: VENDOR · Enforced: VENDOR | 🔵 | CGPey GST verify |
| 38 | POST | `/verification/brands/onboarding/verify-bank` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Penny-drop bank verify |

---

## 7. Sub Brands / Outlets — `/subBrands` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 39 | POST | `/subBrands/signUp-with-whatsapp` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Ab `resolveActorBrand` use karta hai. Outlet → `SUB_VENDOR` user. ✅ Shared default password fix ho gaya |
| 40 | GET | `/subBrands/get-all` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | ⚠️ Role gate missing (sirf `verifyJwtToken`) |
| 41 | PUT | `/subBrands/update/:subBrandId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |

---

## 8. Work Hours — `/workHours` (1)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 42 | POST | `/workHours/upsert` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | ⚠️ Role gate missing |

---

## 9. Locations — `/locations` (6)

Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi**

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 43 | POST | `/locations/create` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |
| 44 | GET | `/locations/getAll` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | ⚠️ Customer sabke addresses dekh sakta hai |
| 45 | GET | `/locations/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ Ownership check nahi |
| 46 | POST | `/locations/upsert` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | Ek customer = ek location. ⚠️ Body ka `userId` override kar sakta hai |
| 47 | PUT | `/locations/update/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |
| 48 | DELETE | `/locations/delete/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |

> **Customer doc me:** #45, #46 (2)

---

## 10. Showcase — `/showcase` (13)

Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi**

### 10a. Sections (6)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 49 | POST | `/showcase/section/add` | Intended: VENDOR · Enforced: **VENDOR (service)** | 🔵 | `validateBrandVendor(userId)`. Duplicate title → 409 |
| 50 | GET | `/showcase/section/get/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | |
| 51 | GET | `/showcase/section/get-all` | Intended: Admin + Vendor · Enforced: Any authenticated | ⚪ ⚠️ | Brand scoping commented out — sabke sections aate hain. `brandId` param support nahi (Q22 → as-is document) |
| 52 | PUT | `/showcase/section/update/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | |
| 53 | PUT | `/showcase/section/:brandId/reorder` | Intended: Admin + Vendor · Enforced: Any authenticated | ⚪ | ✅ Route fix (leading `/`) |
| 54 | DELETE | `/showcase/section/delete/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | |

### 10b. Media (5) — sab 🔵 VENDOR, Enforced: Any authenticated

| # | Method | Endpoint |
|---|---|---|
| 55 | POST | `/showcase/section/:sectionId/add-media` |
| 56 | PATCH | `/showcase/section/:sectionId/media/update/:mediaId` |
| 57 | PUT | `/showcase/section/:sectionId/media/replace/:mediaId` |
| 58 | PUT | `/showcase/section/:sectionId/media/reorder` |
| 59 | DELETE | `/showcase/section/:sectionId/media/delete/:mediaId` |

### 10c. Customer-facing (2)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 60 | GET | `/showcase/get-brand-showcase/:brandId` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Sirf active content, `storage`/`metadata` strip |
| 61 | GET | `/showcase/:brandId/video-clips` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Reels feed, double opt-in filter |

> **Customer doc me:** #60, #61 (2)

---

## 11. Vouchers — `/vouchers` (13)

**Lifecycle:** Vendor create → submit review → Admin approve/reject → publish (Vendor ya Admin) → Customer ko visible
**Note:** Har voucher write brand ke plan ka slot consume karta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 62 | POST | `/vouchers/create` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ `resolveActorBrand`. Transactional, image rollback |
| 63 | PUT | `/vouchers/update/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Naya version banata hai |
| 64 | POST | `/vouchers/submit-review/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 65 | POST | `/vouchers/review/:versionId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ✅ Ab properly gated. `APPROVED` \| `REJECTED` |
| 66 | POST | `/vouchers/publish/:versionId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Sirf `APPROVED` version |
| 67 | GET | `/vouchers/versions/get-all` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | ✅ Ab gated |
| 67a 🆕 | PUT | `/vouchers/admin/suggestions/:voucherId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Suggested voucher add / remove / reorder — ek hi endpoint dono taraf |
| 67b 🆕 | GET | `/vouchers/admin/suggestions` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Admin view — expired/unpublished pins bhi dikhte hain taaki unpin ho sakein |
| 68 | POST | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Master-level banner |
| 69 | DELETE | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ |
| 70 | GET | `/vouchers/customer/get-all` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Geo listing · `suggestedOnly` tab · `bannerType`/`bannerUrl`/`isSuggested` |
| 71 | GET | `/vouchers/customer/get/:voucherId` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | `bannerType`/`bannerUrl` |
| 72 | POST | `/vouchers/customer/voucher/preview` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Discount + convenience fee. Koi offer valid na ho to error nahi — plain bill |

> **Customer doc me:** #70, #71, #72 (3)

---

## 12. Banners (App-level) — `/banners` (6)

Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi** ⚠️

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 73 | POST | `/banners/create` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 74 | PUT | `/banners/update/:id` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 75 | GET | `/banners/get-all` | Intended: ADMIN · Enforced: Any authenticated | 🟣 |
| 76 | GET | `/banners/get/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 |
| 77 | DELETE | `/banners/delete/:id` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 78 | GET | `/banners/customer/active` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 |

> **Customer doc me:** #78 (1)

---

## 13. Promotional Tickers — `/promotionalTickers` (6)

Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi** ⚠️

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 79 | POST | `/promotionalTickers/create` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 80 | PUT | `/promotionalTickers/update/:id` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 81 | GET | `/promotionalTickers/get-all` | Intended: ADMIN · Enforced: Any authenticated | 🟣 |
| 82 | GET | `/promotionalTickers/get/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 |
| 83 | DELETE | `/promotionalTickers/delete/:id` | Intended: ADMIN · Enforced: Any authenticated ⚠️ | 🟣 |
| 84 | GET | `/promotionalTickers/customer/active` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 |

> **Customer doc me:** #84 (1)

---

## 14. Brand Features — `/brandFeatures` (5)

Max **10 active** per brand. Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi**

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 85 | POST | `/brandFeatures/add` | Intended: Vendor + Admin · Enforced: Any authenticated ⚠️ | ⚪ | `brandId` body me |
| 86 | GET | `/brandFeatures/get-all` | Intended: All · Enforced: Any authenticated | ⚪ | `brandId` query mandatory. Customer brand-page (Q5b) |
| 87 | GET | `/brandFeatures/get/:featureId` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 88 | PUT | `/brandFeatures/update/:featureId` | Intended: Vendor + Admin · Enforced: Any authenticated ⚠️ | ⚪ | |
| 89 | DELETE | `/brandFeatures/delete/:featureId` | Intended: Vendor + Admin · Enforced: Any authenticated ⚠️ | ⚪ | |

> **Customer doc me:** #86, #87 (2)

---

## 15. Brand Avoidances — `/brandAvoidances` (2)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 90 | POST | `/brandAvoidances/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 |
| 91 | GET | `/brandAvoidances/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 |

> **Customer doc me:** dono (2)

---

## 16. Follows — `/follows` (2)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 92 | POST | `/follows/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 |
| 93 | GET | `/follows/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 |

> **Customer doc me:** dono (2)

---

## 17. Categories — `/categories` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 94 | POST | `/categories/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 95 | GET | `/categories/getAll` | Intended: All · Enforced: Any authenticated | ⚪ |
| 96 | GET | `/categories/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ |
| 97 | PUT | `/categories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 98 | DELETE | `/categories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Customer doc me:** #95, #96 (2)

---

## 18. Sub Categories — `/subCategories` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 99 | POST | `/subCategories/:categoryId/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 100 | GET | `/subCategories/getAll` | Intended: All · Enforced: Any authenticated | ⚪ |
| 101 | GET | `/subCategories/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ |
| 102 | PUT | `/subCategories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 103 | DELETE | `/subCategories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Customer doc me:** #100, #101 (2)

---

## 18a. Search — `/search` (5) 🆕

Customer home screen ka global search box. Poora module token-less hai; sirf history
wale teen endpoints `isCustomer` gated hain.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 103a | GET | `/search` | Intended: All · Enforced: **optionalAuth** | 🟢 |
| 103b | GET | `/search/popular` | Intended: All · Enforced: **Public** | 🟢 |
| 103c | GET | `/search/history` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |
| 103d | DELETE | `/search/history` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |
| 103e | DELETE | `/search/history/:historyId` | Intended: CUSTOMER · Enforced: **CUSTOMER** | 🟢 |

> **Customer doc me:** sab paanch
>
> `GET /search` ek call me paanch sections deta hai — BRAND, VOUCHER, CATEGORY,
> SUB_CATEGORY, AREA. `?type=` dene par ek hi type, paginated. Design ka poora *kyun*
> [global_customer_search_plan.md](./global_customer_search_plan.md) me hai.

---

## 19. Subscriptions (Plans) — `/subscriptions` (5)

Plan master data. Customer doc me **nahi** (Q9).

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 104 | POST | `/subscriptions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 105 | GET | `/subscriptions/getAll` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ |
| 106 | GET | `/subscriptions/get/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ |
| 107 | PUT | `/subscriptions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 108 | DELETE | `/subscriptions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

---

## 20. Subscribeds 🆕 — `/subscribeds` (8)

Brand ki **actual subscription** ka lifecycle (`/subscriptions` = plan catalog, ye = kis brand ne kya liya).
Paid path `/transactions/subscribe/*` pe hai; ye admin ka manual/without-payment path hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 109 | POST | `/subscribeds/admin/grant` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Bina payment ke subscription de. **NEW / RENEW / UPGRADE / DOWNGRADE ek hi call me** — response ka `action` batata hai kaunsa apply hua |
| 110 | PUT | `/subscribeds/admin/cancel` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 111 | GET | `/subscribeds/admin/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Saare brands ki subscriptions |
| 112 | GET | `/subscribeds/admin/forfeited` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Goodwill worklist — jin vendors ne mid-term plan change pe paid days khoye. Upgrade pe proration nahi hota, isliye ye baad me settle hote hain |
| 113 | PUT | `/subscribeds/admin/forfeited/compensate` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Forfeited days compensate |
| 114 | PUT | `/subscribeds/admin/resync` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Repair endpoint — cached subscription state + plan limits rebuild |
| 115 | GET | `/subscribeds/get` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ `resolveActorBrand` |
| 116 | GET | `/subscribeds/history` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ |

---

## 21. Promo Codes 🆕 — `/promoCodes` (6)

Subscription promo codes. **Poora module `router.use(isAdmin)`** — vendor manage nahi karta, wo sirf `/transactions/subscribe/preview` aur `create-order` me code redeem karta hai.

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 117 | POST | `/promoCodes/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 118 | GET | `/promoCodes/get-all` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 119 | GET | `/promoCodes/reports` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 120 | GET | `/promoCodes/get/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 121 | PUT | `/promoCodes/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 122 | DELETE | `/promoCodes/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

---

## 22. Transactions — `/transactions` (9)

Razorpay subscription payments + webhook operations.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 123 🆕 | POST | `/transactions/webhook/razorpay` | Intended: Razorpay · Enforced: **Public (HMAC)** | 🟣 | ⚠️ **Deliberately unauthenticated** — Razorpay JWT nahi de sakta. Authenticity raw body pe HMAC se aati hai. **VENDOR account** (subscriptions); secrets `RAZORPAY_WEBHOOK_SECRETS` (comma-separated, rotation-safe). Isse activation browser se independent hai |
| 123a 🆕 | POST | `/transactions/webhook/razorpay/customer` | Intended: Razorpay · Enforced: **Public (HMAC)** | 🟣 | Wahi cheez **CUSTOMER account** (voucher claims) ke liye; secrets `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS`. Account **route se** aata hai, signature se nahi — signature sirf authenticate karta hai. Galat endpoint par aayi delivery phir bhi process hoti hai, par WARNING alert ke saath |
| 124 🆕 | POST | `/transactions/subscribe/preview` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Price + promo code preview, order banane se pehle |
| 125 | POST | `/transactions/subscribe/create-order` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Ab gated — pehle koi bhi user kisi bhi brand ke against order khol sakta tha |
| 126 | POST | `/transactions/subscribe/verify-transaction` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 126a 🆕 | GET | `/transactions/invoice/:token` | Intended: Customer + Vendor · Enforced: **Public (token)** | 🟣 | ⚠️ **Deliberately unauthenticated.** Link WhatsApp message aur email se khulta hai, jahan browser me koi session hota hi nahi — login maangne ka matlab hai Download button kaam na kare, jo uska ekmatra kaam hai. 32-byte random token hi credential hai; galat token par wahi 404 jo na-maujood token par. PDF **pehli request par** banti hai aur uske baad cache hoti hai — har claim par render + upload scale par nahi chalega, aur zyadatar invoice kabhi khulti hi nahi. Invoice **number** phir bhi settle par milta hai, taaki series me gap na aaye |
| 127 🆕 | POST | `/transactions/invoice/regenerate` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | PDF invoice re-issue. Amounts kabhi recompute nahi hote — transaction pe frozen pricing se banta hai, to purana invoice exactly wahi dikhata hai jo charge hua tha |
| 128 🆕 | GET | `/transactions/webhook/events` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Webhook delivery log. Pehle deliveries store hoti thi par DB ke bahar invisible thi — ek FAILED event (paisa captured, plan live nahi) chup-chaap pada reh sakta tha |
| 129 🆕 | GET | `/transactions/webhook/events/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 130 🆕 | POST | `/transactions/webhook/replay/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Stored payload dobara process. **Idempotent** — settlement transaction ko conditionally claim karta hai, to already-settled ka replay double-activate nahi karta |
| 131 🆕 | GET | `/disputes` | Intended: Vendor + Admin · Enforced: **TOKEN** | 🟣 | Chargebacks, sabse pehle deadline wala upar. Deadline miss = paisa automatically forfeit, isliye ye report nahi **worklist** hai. **Ek endpoint, do shape**: vendor ko sirf apne brand ke, aur scoping **filter me** — projection me chhupa kar nahi. ⚠️ Vendor ko `respondBy`/`daysToRespond`/`isOverdue`/`alertsSent`/`recoverySettlementId`/`vendorWasPaid` **kabhi nahi**: deadline nibhana hamara kaam hai aur evidence hum file karte hain, to jis countdown par outlet kuch kar hi nahi sakta wo warning nahi — sirf ghabrahat aur ek support call hai. ⚠️ CUSTOMER ko 403: chargeback unke bank aur hamare beech hai. ⚠️ `verifyJwtToken` **saaf-saaf** likha hai — is router par blanket gate nahi hai, to `isAdmin` hatate waqt uski jagah kuch na rakhna poori worklist URL jaanne wale ke liye khol deta |
| 131a 🆕 | GET | `/disputes/:disputeId` | Intended: Vendor + Admin · Enforced: **TOKEN** | 🟣 | Ek dispute, wahi do shape. ⚠️ Projection **list se shared hai**, apni likhi hui nahi — alag likhna wahi tarika hai jisse list jo field chhupati hai wo detail par aa jaata hai, mahino baad, bina kuch fail hue. Razorpay ka `disp_…` **ya** hamara `_id` — dono chalte hain, kyunki pehla dashboard par dikhta hai aur doosra panel ke paas hota hai. Doosre brand ka dispute **404**, missing jaisa hi: *"hai par tumhara nahi"* kehna id asli hone ki tasdeeq hai |
| 131b 🆕 | POST | `/disputes/:disputeId/evidence` | Intended: Vendor + SubVendor · Enforced: **VENDOR+SUB** | 🟠 | Jo sirf outlet ke paas hai — KOT/bill number, camera ka waqt, staff ko kya yaad hai. ⚠️ **Bonus hai, sahaara nahi**: pack hamare apne record par khada hota hai, aur filing outlet ke jawab ka intezaar nahi karti — dispute ka jawab **ek hi baar** jaata hai aur deadline bank ki hai. Faisla ho chuka ho to **409**, aur refusal batata hai ki kis taraf gaya taaki wo soch me na pade ki message bounce kyun hua |
| 131c 🆕 | GET | `/disputes/:disputeId/evidence-pack` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Sab kuch jo hum sabit kar sakte hain — payment + **signature verified** (khud sabooot: callback hamare account ke secret se signed tha), outlet, claim code, timeline, aur **`narrative`** jo Razorpay dashboard me seedha paste ho jaata hai. Argument pehle se likha hua isliye ki dispute **ek baar** file hota hai aur jeet-haar aksar isi par hoti hai ki case theek se likhne ka waqt tha ya nahi. ⚠️ Admin-only: grahak ka **masked** contact, poori claim timeline aur wo daleel jo hum dene wale hain — kuch bhi outlet ka padhne ka nahi. ⚠️ Razorpay se baat nahi karta aur kuch submit nahi karta |
| 131d | GET | `/transactions/disputes` · `POST /transactions/disputes/:id/evidence` · `GET /transactions/disputes/:id/evidence-pack` | wahi gates | ⚪ | **Purane raaste, wahi controllers.** Dispute pehle `Transaction` par das denormalised fields tha, isliye yahan tha. Ab apna collection aur apna domain hai. Ye teen rehte hain kyunki Postman aur pehle se juda koi bhi integration inhi par hai — 404 dene se bura kuch nahi. ⚠️ **Yahan naya kuch mat jodo**: `disputeVisibility.test.js` dono mounts ko identical rakhta hai aur naye route ko purane mount par aane se rokta hai |
| 131h 🆕 | GET | `/transactions/admin/health` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | **Liveness probe nahi** — server ka jawab dena hi wo sabit karta hai. Ye wo sawaal hai jo admin ko subah nau baje hota hai: *raat me kuch atka to nahi, aur abhi kuch chup-chaap paisa to nahi kho raha?* Teen hisse: `jobs` (safety net ruk gaya) · `stuck` (paisa aisi haalat me jise kuch nikalega nahi) · `indexes`. **`CRITICAL` sirf us cheez ke liye jo ghadi ke saath paisa khoti hai** — bina capture hui authorization ~5 din me khud refund ho jaati hai, dispute deadline chookne par paisa apne aap chala jaata hai, koi nirnay liye bina. Baaki `ATTENTION`: asli hai par insaan ka intezaar karte hue bigadta nahi. Dono ko ek rang dena logon ko laal nazarandaaz karna sikha deta hai. Har ginti **query hai, cached counter nahi** — ruk gaya cached number *"shunya samasyaein"* padha jaata hai jabki samasya badh rahi hoti hai. 8 me se koi job kabhi na chala ho to bhi `ATTENTION`: `startJobs` boot par har job ek baar chalata hai, to `NEVER_RUN` bachna matlab runner chala hi nahi — aur tab upar ke saare safety net maujood hi nahi. Hamesha `200`, khabar buri ho tab bhi: jo health endpoint anhealthy hone par 500 de wo bata hi nahi sakta **kya** anhealthy hai |

---

## 22a. Voucher Claims 🆕 — `/voucher-claims` (7)

Customer ka voucher claim — paisa andar. **Likhne wale** do endpoint `isCustomer` ke peeche: guest ko **daam milta hai** (preview `optionalAuth` par hai) par **order nahi**. **Padhne wale** paanch `verifyJwtToken` par hain — role gate nahi, kyunki wo **ek endpoint, teen shapes** hain.

> ### Ek endpoint, teen shapes — teen endpoint kyun nahi
>
> Har audience ke liye alag endpoint plan me tha (`customer/get-all`, `vendor/get-all`, `admin/get-all`). Bane ek-ek. Scope `buildAccessScopeFilter()` se aur projection `claimProjection(role)` se — dono token se — isliye ek hi URL par customer, vendor, outlet aur admin apna jawab paate hain.
>
> **Wajah drift hai.** Teen endpoint ka matlab tha teen jagah ye yaad rakhna ki vendor ko `gatewayFee`, `netReceived`, `voucher.platformPromoCost`, `email`, `contact` nahi dikhne chahiye. Ek jagah bhoolna = leak — aur wo listing me nahi, **detail page par** milta, jise koi jaanchta nahi.
>
> ⚠️ **Detail poora row padhta hai, phir chhaanta hai** — listing ki tarah pipeline me project nahi kar sakta. Ownership `customerId` / `brandId` me rehti hai, aur vendor projection wahi chhupati hai; pehle project karne ka matlab hota *"ye tumhara hai?"* aise document se poochna jo ab batata hi nahi kiska hai. Isliye `pickByProjection()` **whitelist** hai, delete-list nahi: model me kal juda field default roop se adrishya hai.
>
> ⚠️ **Scope query se chaudi nahi ho sakti** — filter aur scope **intersect** hote hain. Vendor `?brandId=<dusra>` bheje to **kuch nahi** milta. Pehle scope overlay hota tha: surakshit tha par chup — vendor ko apne rows waapas milte the, jo bilkul chale hue filter jaisa dikhta hai.

> **Route file `voucherClaims.js` hai, mount `/voucher-claims` par.** `routes/index.js` prefix filename se banata hai, isliye file `module.exports = { router, routePrefix }` deti hai. ⚠️ `exports.routePrefix` ke saath `module.exports = router` likhna kaam **nahi** karta — doosri assignment poora exports object badal deti hai aur prefix chup-chaap kho jaata hai. Sirf boot log me dikhta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 131a 🆕 | POST | `/voucher-claims/create-order` | Intended: Customer · Enforced: **CUSTOMER** | 🔵 | Razorpay order kholta hai. **Kram hi design hai:** daam (wahi builder jo preview chalata hai, `strictPromo` ke saath) → `Idempotency-Key` insert → reuse window → claim + once-per-user slot hold → promo reservation → **Razorpay sabse aakhir**. Key Razorpay call se **pehle** jaati hai: header lekar check kar lena kaafi nahi, do concurrent tap dono read-then-write paas kar jaate aur customer ko ek bill ke liye do payment sheet dikhte. Razorpay aakhir me kyunki uska undo nahi hai |
| 131b 🆕 | POST | `/voucher-claims/verify` | Intended: Customer · Enforced: **CUSTOMER + ownership** | 🔵 | Browser callback. Signature sirf ye sabit karta hai ki payment Razorpay ne banayi — is order ki hai, sahi rakam hai, ya poochne wala wahi hai, ye nahi. Isliye chaar aur jaanch: account **transaction se** (hardcode nahi), `payment.order_id` milana, rakam `claim.pricing.amountInPaise` se milana, aur ownership **customer par** (`userId` par nahi — ek login saajha karte do customer me se ek doosre ki payment settle kar leta). Webhook race jeet le to `alreadyVerified: true` — wo safalta hai, error nahi |
| 131c 🆕 | GET | `/voucher-claims` | Intended: sab · Enforced: **token se scope** | 🔵 | *"Maine kya khareeda"*. Frozen snapshots padhta hai (`voucherSnapshot` / `brandSnapshot` / `outletSnapshot`), join nahi — September ki claim March me bhi sahi padhti hai, voucher republish aur outlet rename ke baad bhi. **Khaali list `200` + `data: []`, `404` nahi**: jisne kuch khareeda hi nahi uski history khaali hai, gayab nahi. `pagination()` me `allowEmpty` isiliye juda — 404 pehli baar app kholne par error screen dikha deta |
| 131d 🆕 | GET | `/voucher-claims/payments` | Intended: sab · Enforced: **token se scope** | 🔵 | *"Kaunsa paisa hila"*. `status` yahan **payment** ki vocabulary hai (`created · authorized · captured · failed`), claim ki nahi. `purpose` se scope, isliye ek galat filter bhi kabhi subscription payment nahi dikha sakta |
| 131e 🆕 | GET | `/voucher-claims/payments/:transactionId` | Intended: sab · Enforced: **`assertTransactionAccess`** | 🔵 | **Push notification ka deep link yahin utarta hai.** `payment` · `claim` · `brand` · `outlet` · `viewer`. Claim saath aata hai kyunki akela payment sirf raqam aur timestamp hai. `invoiceDownloadUrl` deta hai, **token nahi** — token PDF ka bina-auth bearer credential hai. ⚠️ `purpose` scope ke bina ye **subscription** payment khol deta — dusre Razorpay account ka row, voucher-claim ki projection se. Id ka unique hona iska jawab nahi hai |
| 131f 🆕 | GET | `/voucher-claims/:claimId` | Intended: sab · Enforced: **`assertClaimAccess`** | 🔵 | Claim + **timeline**. ⚠️ Timeline **banayi** jaati hai, chhaani nahi: `VoucherClaimHistory.snapshot` `Mixed` hai aur `CLAIM_CREATED` par **poora pricing block** rakhta hai (`platformPromoCost` samet), `reason` staff ka free-text note hai. Kaccha row bhejna vendor ko hamara margin pichhle darwaze se de deta — us projection ko paar karke jo use rokti hai. Non-admin ko sirf `label` · `at` · `fromStatus` → `toStatus` · `by` (role, aadmi nahi). `PROMO_RELEASED` sirf admin ko |
| 131g 🆕 | GET | `/voucher-claims/code/:claimCode` | Intended: sab · Enforced: **`assertClaimAccess`** | 🔵 | Counter wala surface — code hi wo cheez hai jo asli duniya me hai: chhapa, bolkar padha, type kiya. ⚠️ **Code lookup narrow karta hai, authorise nahi karta** — kisi aur ki screen se padha code kuch nahi kholta. Route file me `/code/:claimCode` **`/:claimId` se upar** likha hai, warna parameter use nigal leta (`claimId = "code"` → sahi code par 422). Alphabet `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B` chhodta hai, isliye galat character par `422` *"mistyped"* — `404` lagta hai claim hai hi nahi |

---

## 22b. Refunds 🆕 — `/refunds` (9)

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
> Isliye `releaseSettlementHold()` teeno terminal states se bulaya jaata hai jahan paisa hilta hi nahi — `VENDOR_REJECTED`, `ADMIN_REJECTED`, `CANCELLED`. `FAILED` aur `COMPLETED` se **nahi**: pehle me paisa abhi bhi wapas jaana hai, doosre me wo vendor ka tha hi nahi. Aur wo kisi aur ki taraf se release **nahi** karta — chargeback ka hold sirf explicit admin action se hatta hai, webhook se kabhi nahi.

> ### Abuse limits — admin config se
>
> `refund.maxOpenRequests` (1) · `refund.maxRejectedPerWindow` (3) · `refund.requestWindowDays` (30)
>
> ⚠️ Ginti **thukrai** requests ki hoti hai, approve hui ki **kabhi nahi**. Galat ka sanket ye nahi ki kitna paisa wapas gaya — wo hai *"vendor ne dekhkar kaha ki ye jayaz nahi thi"*. Jis grahak ki 5 refunds approve hui, uske saath 5 baar sach me bura hua; uski chhathi rokna theek usi ko saza dena hai jiske liye ye poori vyavastha bani hai. Aur raw count rakhne par **sabse kharab brand ka grahak sabse pehle block** hota — jo sabse zyada haqdaar hai. `CANCELLED` bhi ginta hai: raise → vendor dekhe → withdraw → phir raise, ye vendor ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye.
>
> Limit chhoone par jawab **support par bhejta hai, raasta band nahi karta** — admin uski taraf se refund khol sakta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 133a 🆕 | POST | `/refunds` | Intended: Customer · Enforced: **CUSTOMER + ownership** | 🔵 | **Kram hi design hai:** eligibility → allowance → window → split freeze → **request banao** → hold lagao. Request pehle, hold baad me: request hi record hai aur hold usse nikalta hai. Do tap ka faisla `(transactionId, isOpen)` wala unique index karta hai, uske upar wala read-then-write check nahi (dono use paas kar jaate hain) — haarne wale ko wahi request milti hai `reused: true` ke saath. Window **`paidAt` se** napi jaati hai, `createdAt` se nahi. `amount` optional — na do to poora |
| 133b 🆕 | PATCH | `/refunds/:requestId/withdraw` | Intended: Customer · Enforced: **CUSTOMER + ownership** | 🔵 | `PROCESSING` ke baad nahi — paisa Razorpay ke paas hai, wapas lene ko kuch hai hi nahi. Hold hattta hai |
| 133c 🆕 | PATCH | `/refunds/:requestId/approve` | Intended: Vendor / Outlet · Enforced: **brand + outlet** | 🟢 | **Rakam ghat sakti hai, badh nahi** — *"aadha order theek tha"* asli jawab hai; badhana approval nahi, naya faisla hai, aur ek extra shunya das guna pay out kar deta. Split wahin dobara freeze hota hai. `status` update filter me hai (conditional claim): owner aur outlet manager ek hi request dekh sakte hain, warna dono clicks lagte aur grahak ka jawab is par nirbhar karta ki kaun dheema tha |
| 133d 🆕 | PATCH | `/refunds/:requestId/reject` | Intended: Vendor / Outlet · Enforced: **brand + outlet** | 🟢 | `note` **zaroori** — jab grahak inkaar ko chunauti de, admin ke paas sameeksha karne ko yahi ek cheez hoti hai. `settlementHold` yahin hattta hai |
| 133e 🆕 | PATCH | `/refunds/admin/:requestId/approve` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Normal raaste par doosra gate nahi. Vendor ki *"na"* ya chuppi palatne par `overrideReason` **zaroori** aur `isOverride: true` — alag se gina jaata hai: badhti override dar ka matlab admin udaar nahi, matlab upar kahin gadbad hai |
| 133f 🆕 | PATCH | `/refunds/admin/:requestId/reject` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Hold hattta hai |
| 133g 🆕 | PATCH | `/refunds/admin/:requestId/pay` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ⚠️ **`attemptCount` gateway call se PEHLE badhta hai.** Agar process us beech mare jab Razorpay ne refund maan liya par id sahej na paye — row `PROCESSING` kehti hai, `attemptCount: 1`, koi `razorpayRefundId` nahi — aur agli koshish `payments.fetchMultipleRefund()` se **poochti hai**, doosra refund bhejti nahi. Baad me badhate to counter shunya rehta aur retry grahak ko paisa **do baar** bhej deta. Match hamare stamp kiye `notes.refundRequestId` par, rakam par nahi. Lookup khud fail ho to **503**, row `PROCESSING` chhod deta — galat hone ka surakshit tareeka |
| 133h 🆕 | GET | `/refunds` | Intended: sab · Enforced: **token se scope** | 🔵 | Ek endpoint, teen shapes. `?open=true` worklist hai — **sabse purani upar**, kyunki wahi timeout ke sabse kareeb hai aur usi grahak ne sabse lamba intezaar kiya. ⚠️ `split` me `platformPromoReversal` aur `gatewayFeeAbsorbed` (hamara margin) **usi sub-document par** hain jis par `vendorClawback` hai — isiliye faisla ek jagah hota hai. `canDecide` / `canWithdraw` response me **bataye** jaate hain: jo panel status se nikalega wo naye state judte hi galat hoga |
| 133i 🆕 | GET | `/refunds/:requestId` | Intended: sab · Enforced: **`assertRefundAccess`** | 🔵 | Refund + claim + **claim ki timeline** (alag refund timeline nahi — refund claim ke saath hui cheez hai, aur claim ki kahani wahi jagah hai jahan teeno jaate hain). Poora row padhkar, jaanchkar, phir `pickByProjection` se chhanta hai: ownership `customerId`/`brandId` me hai aur vendor projection unhi ko chhupati hai |

**Webhooks:** `refund.created` · `refund.processed` · `refund.failed` — teeno ab handle hote hain. ⚠️ Pehle sirf `refund.processed` tha; baaki do enum me the par kisi branch me nahi, to **failed refund chup-chaap `IGNORED` hokar gir jaata** — grahak ka paisa kabhi nahi pahuncha, request abhi bhi `PROCESSING` kehti thi, aur koi kuch nahi batata tha.

**Jobs (3):** `escalateStaleRefunds` (15m) · `reconcileRefunds` (30m, **sirf padhta hai** — refund jaari karna `executeRefund` ka kaam hai aur uske apne double-payment guards hain) · `remindVendorsAboutRefunds` (60m)

---

## 22c. Settlements 🆕 — `/settlements` (12)

Din band ho → kabza ho → admin manzoori de → NEFT jaaye → UTR record ho.
**Poora flow → [`settlement_flow.md`](./settlement_flow.md).** Vendor ke liye yahan
**koi write nahi** hai: settlement hamara record hai ki hum unhe kya de rahe hain,
koi form nahi jo wo bharein. Ikhtilaf support se hota hai.

> ### Kabza hi lock hai
>
> `Transaction.settlementId: null` wahi ek cheez hai jo do cycles ko ek hi payment
> baantne se rokti hai. Shell **pehle** banti hai, rows **baad me** claim hoti hain —
> ulta karne par rows aise settlement se bandh jaate jo bani hi nahi, aur wo phir
> kabhi kisi cycle me nahi aate, **bina kisi error ke**.

> ### ⚠️ `settlementHold` sirf claim se **pehle** ka filter hai
>
> Ek baar `settlementId` lag gaya, hold lagane se is settlement par koi asar nahi —
> eligibility claim ke waqt tay ho chuki. 02:00 ki build aur 14:00 ke payout ke
> beech ghanton ki khidki hai, aur wahi waqt hai jab `dispute.created` ya refund
> aata hai. Isliye webhook settlement ko **flag** karta hai (`needsRevalidation` +
> `taintedTransactionIds`), aur **approval hi authority hai**: shart update ke
> filter me hai, `if` me nahi.

> ### ⚠️ NEFT ka recall nahi hota
>
> Isi ek line se teen design faisle nikalte hain: (1) payout se pehle live bank
> aur frozen `bankSnapshot` compare hote hain aur farq par settlement `ON_HOLD`
> jaata hai — warning nahi, **rok**; (2) `sweepStalePayouts` sirf **batata** hai,
> apne aap `FAILED` nahi karta, warna kaamyaab transfer ke upar "bank ne mana
> kiya" likh kar vendor ko dobara paisa chala jaata; (3) bounce hui leg **mitayi
> nahi jaati** — retry nayi leg banati hai, taaki record me dono koshishen bachein,
> apne UTR aur apne payee ke saath.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 134a 🆕 | GET | `/settlements` | Intended: sab · Enforced: **token se scope** | 🔵 | Ek endpoint, do shapes. Scope aur filter **kaate** jaate hain, upar-neeche rakhe nahi — vendor kisi aur ka `brandId` bheje to khaali page, apne rows nahi. `?needsAttention=true` admin worklist hai (flagged / `FAILED` / `ON_HOLD`) aur **sabse purani upar**; baaki listing `periodEnd` desc, kyunki wo *"pichhle hafte ka paisa aaya?"* ka jawab hai. Khaali list **404 nahi** — pehle hafte wale brand ko "kuchh gadbad hai" nahi dikhna chahiye. `SUB_VENDOR` ko poora brand dikhta hai, apna outlet nahi: settlement poore brand ke din ka hai |
| 134b 🆕 | GET | `/settlements/:settlementId` | Intended: sab · Enforced: **brand + admin** | 🔵 | Settlement + **legs (UTR ke saath)** + timeline. Poora row padhkar, jaanchkar, phir `pickByProjection` — whitelist hai, to model me kal koi field jude to wo tab tak chhupi rehti hai jab tak koi use naam na de. `reason` / `performedBy` / `snapshot` timeline me **sirf admin ko**: *"3 claimed payments are no longer eligible"* aise dispute ka naam leta hai jispar faisla hua hi nahi |
| 134c 🆕 | GET | `/settlements/:settlementId/transactions` | Intended: sab · Enforced: **brand + admin** | 🔵 | Statement lines, alag se paged — vyast brand ka cycle sau-sau rows ka hota hai aur detail call zyadatar *"kitna, aur kab"* ke liye padha jaata hai. ⚠️ `voucher.platformPromoCost`, `gatewayFee`, `netReceived` vendor ko **nahi** — hamara margin usi sub-document par baitha hai jispar unka `vendorPayable` hai |
| 134d 🆕 | PATCH | `/settlements/admin/:settlementId/approve` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `needsRevalidation: {$ne: true}` **update ke filter me**, `if` me nahi — read aur write ke beech webhook aa sakta hai. Mana karne par `refuseAndHold` **kaunse invoice** kharaab hue wo naam se ginta hai; wo naam vendor ko kabhi nahi jaate |
| 134e 🆕 | PATCH | `/settlements/admin/:settlementId/rebuild` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Sirf `ON_HOLD` par. **Sirf tainted rows** chhoote hain — saaf rows claim me hi rehti hain, warna agli build unhe rebuild ke beech me utha leti aur wahi rows do settlement me aa jaate. Rebuild ke baad kuchh na bache to `CARRIED_FORWARD` |
| 134f 🆕 | PATCH | `/settlements/admin/:settlementId/hold` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Vendor ko *"on hold — being checked"* jaata hai, **bina tafseel ke**: `reason` aksar kisi disputed payment ka naam leta hai, aur wo batana do din ki der ko ek aise chargeback par behes bana deta hai jispar abhi faisla hua hi nahi |
| 134g 🆕 | PATCH | `/settlements/admin/:settlementId/cancel` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `reason` **zaroori** — har row agle cycle me chali jaati hai, kuchh khota nahi par vendor ka paisa is click se cycle badalta hai |
| 134h 🆕 | PATCH | `/settlements/admin/:settlementId/pay` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Body me **kuchh nahi** — rakam `netPayable` hai aur payee frozen `bankSnapshot`; body me rakam lena matlab aisi rakam jo ledger se mel na khaye. Live bank vs frozen compare **pehle**; farq par `ON_HOLD`. Leg **pehle** banti hai, status **baad me**: beech me crash `APPROVED` + `INITIATED` leg chhodta hai (dikhta hai), ulta kram `PROCESSING` bina leg ke (padhne me "paisa gaya par kahin nahi mila"). Double-click ka faisla `(payoutType, settlementId, legNumber)` unique index karta hai, count nahi |
| 134i 🆕 | PATCH | `/settlements/admin/:settlementId/confirm` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | `utr` **zaroori** — `MANUAL_BANK` ka koi callback nahi, aadmi hi callback hai, aur teen din baad *"paisa nahi aaya"* par wahi ek cheez bank statement me dhoondhi ja sakti hai. Leg conditional claim se badalti hai (do admin, ek jeet). `paidAt` liya jaata hai kyunki shukrawaar ki NEFT somwaar type hoti hai aur ledger entry **jab paisa gaya** us tareekh ki honi chahiye. Settlement `PAID` **tabhi** jab legs jud jaayein — split NEFT aam hai, aur pehli leg par hi `PAID` karna settlement ko har worklist se hata deta jabki aadha paisa baaki hai |
| 134j 🆕 | PATCH | `/settlements/admin/:settlementId/fail` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Leg **rakhi** jaati hai, badli nahi. `FAILED` rows ko **nahi chhodta** — bounce aam hai aur sahi kaam hai account theek karke wahi settlement dobara bhejna, usi number aur statement ke saath. Vendor ko `failureReason` (category) jaata hai, `failureNote` (staff note) kabhi nahi |
| 134k 🆕 | PATCH | `/settlements/admin/:settlementId/retry` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Nayi leg, agla number, aur **taaza `bankSnapshot`** — bounce ki aam wajah galat account hi hoti hai, aur usi galat account me dobara bhejna wo ek cheez hai jo pakka kaam nahi karegi |
| — | — | *(no endpoint)* `settlement.requiresAdminApproval: false` | Admin config | ⚪ | Manzoori band ho to build **seedha `APPROVED`** par jaata hai — pehle ye setting dono taraf wired thi aur koi padhta hi nahi tha, to `false` karne ka koi asar nahi hota tha, bina error ke. ⚠️ Manzoori dena paisa dena nahi: `pay` ab bhi aadmi ka kaam hai aur `paySettlement` `needsRevalidation` **usi waqt** dobara padhta hai. ⚠️ `!== false`, `Boolean()` nahi — purane settings document me field hai hi nahi, aur truthiness padhne par agle deploy par har payout chup-chaap auto-approve ho jaata. ⚠️ `approvedAt` haan, `approvedBy` kabhi nahi |
| 134m 🆕 | GET | `/settlements/admin/debt/:brandId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Jo katauti kisi settlement cycle tak **pahunch hi nahi sakti**. `netPayable <= 0` `CARRIED_FORWARD` bhejta hai, aur carry forward ka matlab hi hai uske sab claims chhod dena — brand chal raha ho to sahi (nayi bikri net kar deti hai), band kar de to **anant loop**: koi error nahi, koi log nahi, kisi report me kuch nahi. ⚠️ **Brand par keyed, settlement par nahi** — ye theek wo paisa hai jo koi settlement utha hi nahi paayi. ⚠️ Ledger balance **nahi** ginta, rows ginta hai: balance debt ko un takings se net kar deta hai jo abhi payout hui hi nahi, yani jo paisa hum unka abhi bhi rakhe hue hain. ⚠️ Sirf un rows par jinka payment vendor ko diya ja chuka — jo mila hi nahi uska chargeback debt hai hi nahi, aur use ginna ek receivable gaḍhna hai. ⚠️ **Admin-only read**, is surface par ekmatra: *"outstanding debt"* wali screen vendor ko invoice jaisi padhegi jabki dena kuch nahi hai — unhe asar `SETTLEMENT_CARRIED_FORWARD` se milta hai |
| 134n 🆕 | PATCH | `/settlements/admin/debt/:brandId/write-off` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Peechha chhodna, aur kitaab me likhna. `reason` **zaroori**: ledger kabhi edit nahi hota aur bina wajah wala adjustment galti se alag nahi kiya ja sakta. Optional `olderThanDays` — *"90 din se purana sab"* asli maang hai, *"sab"* se kahin zyada. ⚠️ Har row par `MANUAL_ADJUSTMENT` ka **joda**: `VENDOR_PAYABLE` credit (balance zero, aage koi cycle dekhega hi nahi) + `PLATFORM_COST` debit (humne uthaya). Reference **sirf vendor wali row par** — `ONCE_PER_DISPUTE`/`ONCE_PER_REFUND` `{reference, entryType}` par unique hain, to dono par lagane se doosri row duplicate-key par chup-chaap gir jaati aur kitaab theek utni chhoti reh jaati jitna maaf kiya tha. ⚠️ **Ledger pehle, rows baad me**; `writtenOffAt` dono claim filters me, warna write-off sirf dikhawa hai aur nuksaan **do baar** ginha jaata |
| 134l 🆕 | PATCH | `/settlements/admin/:settlementId/reverse` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | **Ledger pehle, rows baad me.** Beech me crash: reversal likha, rows abhi claimed — zyada dikha raha hai, dikhta hai, theek ho sakta hai. Ulta kram: rows chhoot gaye bina reversal ke — padhne me "paisa kabhi gaya hi nahi" aur wo rows **dobara settle** ho jaate. `isReversal: true` inhe once-per-parent index se bahar rakhta hai, warna safety mechanism hi correction mechanism ko rok deta |

**Jobs (5):** `buildSettlements` (60m — ghante me, raat me nahi: `idempotencyKey` par idempotent hai, to jis raat process band tha wo agle tick par apne aap bhar jaata hai) · `sweepStalePayouts` (30m, **sirf batata hai**) · `alertLateSettlements` (60m, counter usi update me badhta hai jo row claim karta hai — ek hi alert) · `reconcileSettlementLedger` (180m, **sirf padhta hai**: ledger row kabhi update ya delete nahi hoti, sudhaar nayi row hoti hai) · `sweepAbandonedDrafts` (60m — khaali `DRAFT` ka key us period ko ghere baitha hota hai aur agli build us brand ka din **skip** kar deti hai, hamesha ke liye)

**Health signals:** `unconfirmedPayouts` (**CRITICAL** — paisa hil chuka, system ko pata nahi) · `overdueSettlements` · `strandedDrafts`

---

## 23. Settings — `/settings` (2)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 132 | GET | `/settings/get` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 133 | PUT | `/settings/update` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

---

## 24. Terms & Conditions — `/terms-and-conditions` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 134 | POST | `/terms-and-conditions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 135 | GET | `/terms-and-conditions/getAll` | Intended: All · Enforced: Any authenticated | ⚪ |
| 136 | GET | `/terms-and-conditions/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ |
| 137 | PUT | `/terms-and-conditions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 138 | DELETE | `/terms-and-conditions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Customer doc me:** #135, #136 (2)

---

## 25. Privacy & Policies — `/privacy-and-policies` (5)

| # | Method | Endpoint | Access | Cat |
|---|---|---|---|---|
| 139 | POST | `/privacy-and-policies/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 140 | GET | `/privacy-and-policies/getAll` | Intended: All · Enforced: Any authenticated | ⚪ |
| 141 | GET | `/privacy-and-policies/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ |
| 142 | PUT | `/privacy-and-policies/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |
| 143 | DELETE | `/privacy-and-policies/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 |

> **Customer doc me:** #140, #141 (2)

---

## Utility / Non-versioned (3) — docs se bahar (Q20)

`GET /` (health) · `GET /my-ip` · `GET /client-ip` — sab public, `/trydood/v1` ke bahar.

---

# 📱 Customer Mobile App Doc — 35 Endpoints

| Section | Count | Endpoints |
|---|---:|---|
| 1. Authentication | 3 | `/auth/loginOrSignUp-with-whatsapp` · `/auth/verify-otp-whatsapp` · `/auth/logout` |
| 2. User Profile | 3 | `/users/get` · `/users/update` · `/users/delete` ⚠️ |
| 3. Push Notifications 🆕 | 4 | `/deviceTokens/register` · `/unregister` · `/get-mine` · `/test` |
| 4. Location | 2 | `/locations/upsert` · `/locations/get/:id` |
| 5. Master Data | 4 | `/categories/getAll` · `/get/:id` · `/subCategories/getAll` · `/get/:id` |
| 6. Home Screen | 2 | `/banners/customer/active` · `/promotionalTickers/customer/active` |
| 7. Vouchers | 3 | `/vouchers/customer/get-all` · `/get/:voucherId` · `/voucher/preview` |
| 8. Brand Profile | 6 | `/brands/customer/get/:brandId` 🆕 · `/brands/customer/get-all` 🆕 · `/showcase/get-brand-showcase/:brandId` · `/showcase/:brandId/video-clips` · `/brandFeatures/get-all` · `/get/:featureId` |
| 9. Engagement | 4 | `/follows/toggle/:brandId` · `/get-all` · `/brandAvoidances/toggle/:brandId` · `/get-all` |
| 10. Legal | 4 | terms `getAll` + `get/:id` · privacy `getAll` + `get/:id` |

---

# 🏪 Vendor Panel Doc — 78 Endpoints

| # | Section | Count | Endpoint numbers |
|---|---|---:|---|
| 1 | Authentication (WhatsApp/Email/Mobile OTP + logout) — password flow ab admin-only | 7 | 1–10 |
| 2 | User Profile | 3 | 11–13 |
| 3 | Push Notifications | 4 | 14–17 |
| 4 | Notification Feed | 2 | 18–19 |
| 5 | Onboarding (basic ×3 screens / PAN / GST / bank / system-verify / partnership / acknowledge / update) | 8 | 20–27 |
| 6 | KYC Verification (PAN / GST / bank) | 3 | 28–30 |
| 7 | Brand (get, update, verification history) | 3 | 31–33 |
| 8 | Outlets / Sub-brands | 3 | 34–36 |
| 9 | Work Hours | 1 | 37 |
| 10 | Locations | 5 | 38–42 |
| 11 | Showcase (6 sections + 5 media) | 11 | 43–53 |
| 12 | Vouchers (create/update/submit/publish/versions/banner ×2) | 7 | 54–60 |
| 13 | Brand Features | 5 | 61–65 |
| 14 | Subscription Plans (browse) | 2 | 66–67 |
| 15 | My Subscription (get, history) | 2 | 68–69 |
| 16 | Payments (preview, create-order, verify, invoice) | 4 | 70–73 |
| 17 | Master Data (categories, sub-categories) | 4 | 74–77 |
| 18 | Legal (reads) | 4 | 78–81 |

> **Vendor ko ye nahi milte:** 14 customer-intended + 54 admin-exclusive + 3 password endpoints = 71. `149 − 71 = 78` ✓
> **Note:** `/vouchers/review/:versionId` aur dono `admin/suggestions` admin-only hain, isliye vendor ke vouchers 7 hi hain (13 total − 3 customer − 3 admin).

---

# 🛡️ Super Admin Panel Doc — 114 Endpoints

| # | Section | Count |
|---|---|---:|
| 1 | Authentication (register, login, OTP flows ×6, password ×3, logout) | 12 |
| 2 | User Profile | 3 |
| 3 | Push Notifications | 4 |
| 4 | Notifications (feed, mark-read, **broadcast**) | 3 |
| 5 | Brand Verification (queue, review, history) | 3 |
| 5a 🆕 | Top Brands curation (pin/unpin/reorder, list) | 2 |
| 6 | Brand Data (get, update) | 2 |
| 7 | Outlets / Sub-brands | 3 |
| 8 | Locations | 5 |
| 9 | Showcase (get-all, reorder) | 2 |
| 10 | Vouchers (**review/approve**, create, update, submit, publish, versions, banner ×2) | 8 |
| 10a 🆕 | Voucher Suggestions curation (pin/unpin/reorder, list) | 2 |
| 11 | Banners (app-level CRUD) | 5 |
| 12 | Promotional Tickers CRUD | 5 |
| 13 | Brand Features | 5 |
| 14 | Categories CRUD | 5 |
| 15 | Sub Categories CRUD | 5 |
| 16 | Subscription Plans CRUD | 5 |
| 17 | Subscribeds (grant, cancel, get-all, forfeited, compensate, resync, get, history) | 8 |
| 18 | Promo Codes (CRUD + reports) | 6 |
| 19 | Transactions & Payments (preview, order, verify, invoice) | 4 |
| 20 | Webhook Ops (razorpay receiver, events, event detail, replay, disputes) | 5 |
| 21 | Settings | 2 |
| 22 | Legal CRUD (terms ×5 + privacy ×5) | 10 |

> **Admin ko ye nahi milte:** 14 customer-exclusive + 21 vendor-exclusive (onboarding 8, KYC 3, work hours 1, showcase vendor-CRUD 9) = 35. `149 − 35 = 114` ✓
> **Note:** dono `POST /transactions/webhook/razorpay` aur `/webhook/razorpay/customer` public hain (Razorpay HMAC), par admin doc me reference ke liye document honge — webhook ops section unke around hai.

---

## Doc build status

| Doc | Endpoints | Status |
|---|---:|---|
| `endpoints_category.md` | 149 | ✅ Round 4 — ye file |
| `security_findings.md` | 3 open (2 deferred) | ✅ Fixed wale clean kar diye |
| `voucher_brand_features_plan.md` | – | ✅ Sab 6 steps done |
| `account_deletion_plan.md` | – | ⏸️ Deferred — full flow ready hone pe |
| `customer_mobile_api_doc.md` | 35 | ✅ v1.5.0 — live verified · 132 captured examples · guest access documented |
| `vendor_panel_api_doc.md` | 78 | ✅ v1.2.1 — live verified · 105 captured examples |
| `super_admin_panel_api_doc.md` | 114 | ⬜ Baaki |

**Postman:** customer (74 requests · 308 assertions) aur vendor (101 requests · 234
assertions) — dono verified → [postman/README.md](../postman/README.md). Admin phase 3 me.

> `API_DOCUMENTATION.md` **Romani project ka reference doc** hai — Trydood ka nahi. Ise chheda nahi gaya.
> (`CUSTOMER_API_DOC.md` bhi wahi tha aur delete kar diya gaya — 2026-08-30.)

**Ab baaki:** vendor doc ke 39 endpoints + poora admin doc.

**Related design docs** (in-scope, alag maintain hote hain):
[brand_verification_api_doc.md](./brand_verification_api_doc.md) · [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md) · [brand_verification_future_updates.md](./brand_verification_future_updates.md) · [subscription_lifecycle_design.md](./subscription_lifecycle_design.md) · [subscription_future_updates.md](./subscription_future_updates.md)
