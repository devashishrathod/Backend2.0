# Trydood 2.0 — Endpoint Categorization Map

**Purpose:** Har backend endpoint ko uske consumer (Customer Mobile App / Vendor Panel / Super Admin Panel / Global) ke hisaab se categorize karna, taaki 3 alag-alag API documentation files banayi ja sakein.

**Status:** ✅ **Round 3 — full re-scan (2026-08-22).** Code ke against verify kiya gaya, 143 endpoints.

**Base URL:**
- Local: `http://localhost:8080/trydood/v1`
- Staging: `https://backend2-0-4v4i.onrender.com/trydood/v1`

**Framework:** Express.js (CommonJS) · **DB:** MongoDB (Mongoose)
**Route mounting:** `routes/index.js` auto-mounts har file ko uske filename se → `routes/subBrands.js` = `/trydood/v1/subBrands` (camelCase preserved)
**Scanned:** 2026-08-22 · **Total endpoints:** 143 (+3 utility/non-versioned)

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
| `/transactions` | +7 | `subscribe/preview` · `invoice/regenerate` · `webhook/razorpay` (public HMAC) · `webhook/events` + `/:eventId` + `replay/:eventId` · `disputes` |

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

### ⚠️ Jo abhi bhi open hai

| Finding | Status |
|---|---|
| WhatsApp OTP verify commented out (auth bypass) | 🔴 **Open** — `verifyOtpWithWhatsapp.js:12` |
| `/auth/register` public + default role `ADMIN` | 🔴 **Open** |
| `/users/get\|update?userId=` IDOR | 🔴 **Open** |
| Role gates missing: banners, tickers, showcase, locations, brandFeatures, workHours | 🟠 **Open** (~35 endpoints) |
| `showcase/section/get-all` brand scoping | 🟠 **Open** |
| `/brands/get` PII exposure | 🟠 **Open** |
| `DELETE /users/delete` no-op | 🟡 **Open** |

Detail → [security_findings.md](./security_findings.md)

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
| Brands | `/brands` | 13 | – | 8 | 2 | 3 |
| Verification (KYC) | `/verification` | 3 | – | 3 | – | – |
| Sub Brands (Outlets) | `/subBrands` | 3 | – | – | – | 3 |
| Work Hours | `/workHours` | 1 | – | 1 | – | – |
| Locations | `/locations` | 6 | 1 | – | – | 5 |
| Showcase | `/showcase` | 13 | 2 | 9 | – | 2 |
| Vouchers | `/vouchers` | 11 | 3 | – | 1 | 7 |
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
| **TOTAL** | | **143** | **12** | **21** | **49** | **61** |

**Per-doc endpoint count:**

| Doc | Endpoints | Breakdown | Status |
|---|---:|---|---|
| 📱 `customer_mobile_api_doc.md` | **34** | 12 exclusive + 22 shared | ✅ **v1.1.0 done** — 3,179 lines |
| 🏪 `vendor_panel_api_doc.md` | **81** | 21 exclusive + 60 shared | ✅ **v1.0.0 done** — 5,936 lines |
| 🛡️ `super_admin_panel_api_doc.md` | **110** | 49 exclusive + 61 shared | ✅ **v1.0.0 done** — 6,410 lines |

> Sum > 143 kyunki shared endpoints multiple docs me aate hain.
>
> **Cross-check:** 143 total − 50 admin-exclusive − 12 customer-exclusive = **81 vendor-accessible** ✓

---

## 1. Auth — `/auth` (12)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | Intended: ADMIN · Enforced: **Public** | 🟣 | `role` body param, default `ADMIN`. ⚠️ Public hai — koi bhi admin bana sakta hai |
| 2 | POST | `/auth/login` | Intended: ADMIN · Enforced: Public | 🟣 | Password login. `type`: `EMAIL` \| `MOBILE` \| `USERNAME`. ✅ Ab fail-closed hai — jin accounts ne password set nahi kiya, unpe login fail hota hai |
| 3 | POST | `/auth/loginOrSignUp-with-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | `role` default `CUSTOMER`. Naya number → user + `Customer`/`Brand` auto-create. Returns `isFirst` |
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

## 5. Brands — `/brands` (13)

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
| 33 🆕 | GET | `/brands/verifications/history` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Shared audit trail — admin koi bhi brand, vendor sirf apna (service-level scoping) |
| 34 | GET | `/brands/get` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ PAN/GST/Bank lookups response me — customer ko nahi jaana chahiye |
| 35 | PUT | `/brands/update` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | ⚠️ Role gate missing |

> **Customer doc me:** #34 (1)

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

## 11. Vouchers — `/vouchers` (11)

**Lifecycle:** Vendor create → submit review → Admin approve/reject → publish (Vendor ya Admin) → Customer ko visible
**Note:** Har voucher write brand ke plan ka slot consume karta hai.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 62 | POST | `/vouchers/create` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ `resolveActorBrand`. Transactional, image rollback |
| 63 | PUT | `/vouchers/update/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Naya version banata hai |
| 64 | POST | `/vouchers/submit-review/:voucherId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 65 | POST | `/vouchers/review/:versionId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | ✅ Ab properly gated. `APPROVED` \| `REJECTED` |
| 66 | POST | `/vouchers/publish/:versionId` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | Sirf `APPROVED` version |
| 67 | GET | `/vouchers/versions/get-all` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | ⚠️ Role gate missing |
| 68 | POST | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Master-level banner |
| 69 | DELETE | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ |
| 70 | GET | `/vouchers/customer/get-all` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Geo-based listing |
| 71 | GET | `/vouchers/customer/get/:voucherId` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | |
| 72 | POST | `/vouchers/customer/voucher/preview` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Discount calculation |

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
| 123 🆕 | POST | `/transactions/webhook/razorpay` | Intended: Razorpay · Enforced: **Public (HMAC)** | 🟣 | ⚠️ **Deliberately unauthenticated** — Razorpay JWT nahi de sakta. Authenticity raw body pe HMAC se aati hai (`RAZORPAY_WEBHOOK_SECRET`). Isse activation browser se independent hai — vendor tab band kar de to bhi plan mil jaata hai |
| 124 🆕 | POST | `/transactions/subscribe/preview` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | Price + promo code preview, order banane se pehle |
| 125 | POST | `/transactions/subscribe/create-order` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** | ⚪ | ✅ Ab gated — pehle koi bhi user kisi bhi brand ke against order khol sakta tha |
| 126 | POST | `/transactions/subscribe/verify-transaction` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | |
| 127 🆕 | POST | `/transactions/invoice/regenerate` | Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** | ⚪ | PDF invoice re-issue. Amounts kabhi recompute nahi hote — transaction pe frozen pricing se banta hai, to purana invoice exactly wahi dikhata hai jo charge hua tha |
| 128 🆕 | GET | `/transactions/webhook/events` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Webhook delivery log. Pehle deliveries store hoti thi par DB ke bahar invisible thi — ek FAILED event (paisa captured, plan live nahi) chup-chaap pada reh sakta tha |
| 129 🆕 | GET | `/transactions/webhook/events/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 130 🆕 | POST | `/transactions/webhook/replay/:eventId` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Stored payload dobara process. **Idempotent** — settlement transaction ko conditionally claim karta hai, to already-settled ka replay double-activate nahi karta |
| 131 🆕 | GET | `/transactions/disputes` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Chargebacks, sabse pehle deadline wala upar. Deadline miss = paisa automatically forfeit, isliye ye report nahi **worklist** hai |

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

# 📱 Customer Mobile App Doc — 34 Endpoints

| Section | Count | Endpoints |
|---|---:|---|
| 1. Authentication | 3 | `/auth/loginOrSignUp-with-whatsapp` · `/auth/verify-otp-whatsapp` · `/auth/logout` |
| 2. User Profile | 3 | `/users/get` · `/users/update` · `/users/delete` ⚠️ |
| 3. Push Notifications 🆕 | 4 | `/deviceTokens/register` · `/unregister` · `/get-mine` · `/test` |
| 4. Location | 2 | `/locations/upsert` · `/locations/get/:id` |
| 5. Master Data | 4 | `/categories/getAll` · `/get/:id` · `/subCategories/getAll` · `/get/:id` |
| 6. Home Screen | 2 | `/banners/customer/active` · `/promotionalTickers/customer/active` |
| 7. Vouchers | 3 | `/vouchers/customer/get-all` · `/get/:voucherId` · `/voucher/preview` |
| 8. Brand Profile | 5 | `/brands/get` ⚠️ · `/showcase/get-brand-showcase/:brandId` · `/showcase/:brandId/video-clips` · `/brandFeatures/get-all` · `/get/:featureId` |
| 9. Engagement | 4 | `/follows/toggle/:brandId` · `/get-all` · `/brandAvoidances/toggle/:brandId` · `/get-all` |
| 10. Legal | 4 | terms `getAll` + `get/:id` · privacy `getAll` + `get/:id` |

---

# 🏪 Vendor Panel Doc — 81 Endpoints

| # | Section | Count | Endpoint numbers |
|---|---|---:|---|
| 1 | Authentication (WhatsApp/Email/Mobile OTP + password set/forgot/reset + logout) | 10 | 1–10 |
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

> **Vendor ko ye nahi milte:** 12 customer-exclusive + 50 admin-exclusive = 62. `143 − 62 = 81` ✓
> **Note:** `/vouchers/review/:versionId` admin-only hai, isliye vendor ke vouchers 7 hain (11 total − 3 customer − 1 admin review).

---

# 🛡️ Super Admin Panel Doc — 110 Endpoints

| # | Section | Count |
|---|---|---:|
| 1 | Authentication (register, login, OTP flows ×6, password ×3, logout) | 12 |
| 2 | User Profile | 3 |
| 3 | Push Notifications | 4 |
| 4 | Notifications (feed, mark-read, **broadcast**) | 3 |
| 5 | Brand Verification (queue, review, history) | 3 |
| 6 | Brand Data (get, update) | 2 |
| 7 | Outlets / Sub-brands | 3 |
| 8 | Locations | 5 |
| 9 | Showcase (get-all, reorder) | 2 |
| 10 | Vouchers (**review/approve**, create, update, submit, publish, versions, banner ×2) | 8 |
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

> **Admin ko ye nahi milte:** 12 customer-exclusive + 21 vendor-exclusive (onboarding 8, KYC 3, work hours 1, showcase vendor-CRUD 9) = 33. `143 − 33 = 110` ✓
> **Note:** `POST /transactions/webhook/razorpay` public hai (Razorpay HMAC), par admin doc me reference ke liye document hoga — webhook ops section usi ke around hai.

---

## Doc build status

| Doc | Endpoints | Lines | Status |
|---|---:|---:|---|
| `endpoints_category.md` | 143 | 616 | ✅ Round 3 — ye file |
| `security_findings.md` | 16 findings | ~700 | ✅ Re-verified (2 fixed) |
| `customer_mobile_api_doc.md` | 34 | 3,179 | ✅ v1.1.0 |
| `vendor_panel_api_doc.md` | 81 | 5,936 | ✅ v1.0.0 |
| `super_admin_panel_api_doc.md` | 110 | 6,410 | ✅ v1.0.0 |

> `API_DOCUMENTATION.md` aur `CUSTOMER_API_DOC.md` **Romani project ke reference docs** hain — Trydood ke nahi. Inko chheda nahi gaya.

**Ab baaki:** design docs ko current code ke against verify karna.

**Related design docs** (in-scope, alag maintain hote hain):
[brand_verification_api_doc.md](./brand_verification_api_doc.md) · [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md) · [brand_verification_future_updates.md](./brand_verification_future_updates.md) · [subscription_lifecycle_design.md](./subscription_lifecycle_design.md) · [subscription_future_updates.md](./subscription_future_updates.md)
