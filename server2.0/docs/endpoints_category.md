# Trydood 2.0 — Endpoint Categorization Map

**Purpose:** Har backend endpoint ko uske consumer (Customer Mobile App / Vendor Panel / Super Admin Panel / Global) ke hisaab se categorize karna, taaki 3 alag-alag API documentation files banayi ja sakein.

**Status:** ✅ **Round 2 — `queries.md` ke answers apply ho gaye.** Aapke final approval ke baad `customer_mobile_api_doc.md` banega.

**Base URL:**
- Local: `http://localhost:8080/trydood/v1`
- Staging: `https://backend2-0-4v4i.onrender.com/trydood/v1`

**Framework:** Express.js (CommonJS) · **DB:** MongoDB (Mongoose)
**Route mounting:** `routes/index.js` auto-mounts har file ko uske filename se → `routes/subBrands.js` = `/trydood/v1/subBrands` (camelCase preserved)
**Scanned:** 2026-08-21 · **Total endpoints:** 108 (+3 utility/non-versioned)

---

## Legend

| Tag | Meaning | Kis doc me jayega |
|---|---|---|
| 🟢 **CUSTOMER** | Sirf customer mobile app ke liye | `customer_mobile_api_doc.md` |
| 🔵 **VENDOR** | Sirf vendor/brand panel ke liye | `vendor_panel_api_doc.md` |
| 🟣 **ADMIN** | Sirf super admin panel ke liye | `super_admin_panel_api_doc.md` |
| ⚪ **GLOBAL** | 2+ panels use karte hain | Saare relevant docs me (panel-specific note ke saath) |

**Access column format** (Q10a → Option B — dono likhenge):

```
Intended: <jiske liye banaya gaya hai>  ·  Enforced: <backend actually kya rokta hai>
```

`Enforced` values:
- `Public` — koi token nahi
- `Any authenticated` — sirf `verifyJwtToken`, **role check nahi hai**
- `ADMIN` / `VENDOR` — `isAdmin` / `isVendor` middleware se enforced
- `CUSTOMER (service)` — route pe middleware nahi, lekin service code me role verify hota hai

---

## Summary

| Module | Base path | Total | 🟢 | 🔵 | 🟣 | ⚪ |
|---|---|---:|---:|---:|---:|---:|
| Auth | `/auth` | 9 | – | – | 2 | 7 |
| Users | `/users` | 3 | – | – | – | 3 |
| Brands | `/brands` | 9 | – | 7 | – | 2 |
| Verification (KYC) | `/verification` | 3 | – | 3 | – | – |
| Sub Brands (Outlets) | `/subBrands` | 3 | – | 3 | – | – |
| Work Hours | `/workHours` | 1 | – | 1 | – | – |
| Locations | `/locations` | 6 | 1 | – | – | 5 |
| Showcase | `/showcase` | 13 | 2 | 9 | – | 2 |
| Vouchers | `/vouchers` | 11 | 3 | 3 | 1 | 4 |
| Banners (App-level) | `/banners` | 6 | 1 | – | 5 | – |
| Promotional Tickers | `/promotionalTickers` | 6 | 1 | – | 5 | – |
| Brand Features | `/brandFeatures` | 5 | – | – | – | 5 |
| Brand Avoidances | `/brandAvoidances` | 2 | 2 | – | – | – |
| Follows | `/follows` | 2 | 2 | – | – | – |
| Categories | `/categories` | 5 | – | – | 3 | 2 |
| Sub Categories | `/subCategories` | 5 | – | – | 3 | 2 |
| Subscriptions (Plans) | `/subscriptions` | 5 | – | – | 3 | 2 |
| Transactions | `/transactions` | 2 | – | – | – | 2 |
| Settings | `/settings` | 2 | – | – | 2 | – |
| Terms & Conditions | `/terms-and-conditions` | 5 | – | – | 3 | 2 |
| Privacy & Policies | `/privacy-and-policies` | 5 | – | – | 3 | 2 |
| **TOTAL** | | **108** | **12** | **26** | **30** | **40** |

**Per-doc endpoint count:**

| Doc | Endpoints | Breakdown |
|---|---:|---|
| 📱 `customer_mobile_api_doc.md` | **30** | 12 exclusive + 18 global |
| 🏪 `vendor_panel_api_doc.md` | **~59** | 26 exclusive + ~33 global *(phase 2)* |
| 🛡️ `super_admin_panel_api_doc.md` | **~68** | 30 exclusive + ~38 global *(phase 3)* |

---

## Decisions applied (from `queries.md`)

| Q | Decision | Effect |
|---|---|---|
| Q1 | Customer app = **sirf WhatsApp OTP** | Email/Mobile OTP flows customer doc se bahar |
| Q2 | `/auth/register` + `/auth/login` = **Super Admin only** | 🟣 ADMIN |
| Q3 | Customer locations = `upsert` + `get/:id` | 2 endpoints customer doc me |
| Q5a | Brand features manage = **Vendor + Admin dono** | ⚪ GLOBAL |
| Q5b | Brand features read = **customer ko bhi chahiye** | Customer doc me 2 endpoints |
| Q6 | Voucher publish = **Vendor + Admin dono** | ⚪ GLOBAL |
| Q7 | Voucher banner = **Vendor + Admin dono** | ⚪ GLOBAL |
| Q8 | `versions/get-all` = **dono docs me** | ⚪ GLOBAL |
| Q9 | Subscriptions customer doc me **nahi** | ⚪ (Vendor + Admin) |
| Q10a | Access column = **Intended + Enforced dono** | Format above |
| Q10b | Security gaps = **alag doc** | → `security_findings.md` ✅ banaya |
| Q11 | Reorder route **aapne fix kar diya** ✅ + Vendor & Admin dono | ⚪ GLOBAL |
| Q12 | `section/get-all` = **Admin + Vendor**, brandId se filter | ⚪ GLOBAL ⚠️ *(brandId abhi support nahi hai — Q22 dekhein)* |
| Q13 | Local + Staging URLs | Header me added |
| Q14 | Sirf live APIs document honge | VoucherUsage/expiry = skip |
| Q15 | **Hinglish** | Notes/warnings Hinglish, technical terms English |
| Q16 | Customer doc me "Not for customer app" list bhi | Appendix section |
| Q17 | Categories me customer-specific change nahi | As-is document |
| Q19 | Transactions = **Vendor + Admin dono** | ⚪ GLOBAL |
| Q4 | `DELETE /users/delete` = document with ⚠️ no-op warning | Customer doc me included |
| Q18 | `/brands/get` as-is document + security flag | → `security_findings.md` |
| Q20 | Utility + public config = ignore for now | Docs se bahar |

---

## 1. Auth — `/auth` (9)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 1 | POST | `/auth/register` | Intended: ADMIN · Enforced: **Public** | 🟣 | `role` body param, default `ADMIN`. Email+mobile+username+password+dob+whatsapp sab required. ⚠️ Public hai — koi bhi admin bana sakta hai |
| 2 | POST | `/auth/login` | Intended: ADMIN · Enforced: Public | 🟣 | Password login. `type`: `EMAIL` \| `MOBILE` \| `USERNAME` + `role` |
| 3 | POST | `/auth/loginOrSignUp-with-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | `role` default `CUSTOMER`. Naya number → user + `Customer`/`Brand` doc auto-create. Returns `isFirst`. **Customer app ka primary login** |
| 4 | POST | `/auth/verify-otp-whatsapp` | Intended: Customer + Vendor · Enforced: Public | ⚪ | OTP verify → JWT token |
| 5 | POST | `/auth/login-with-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ ❓ | Email OTP send → Q21 |
| 6 | POST | `/auth/verify-otp-email` | Intended: Vendor + Admin · Enforced: Public | ⚪ ❓ | → Q21 |
| 7 | POST | `/auth/login-with-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ ❓ | Mobile OTP send → Q21 |
| 8 | POST | `/auth/verify-otp-mobile` | Intended: Vendor + Admin · Enforced: Public | ⚪ ❓ | → Q21 |
| 9 | POST | `/auth/logout` | Intended: All · Enforced: Any authenticated | ⚪ | Sab panels |

> **Customer doc me:** #3, #4, #9 (3 endpoints)

---

## 2. Users — `/users` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 10 | GET | `/users/get` | Intended: All · Enforced: Any authenticated | ⚪ | Logged-in user profile |
| 11 | PUT | `/users/update` | Intended: All · Enforced: Any authenticated | ⚪ | `fullName`, `email`, `dob`, `appliedReferralCode`, `image` (multipart). Customer ke liye `Customer` doc bhi sync. Email change → `isEmailVerified` false |
| 12 | DELETE | `/users/delete` | Intended: All · Enforced: Any authenticated | ⚪ | ⚠️ **No-op stub** — kuch delete nahi karta, sirf 200 message. Doc me warning ke saath rahega (Q4) |

> **Customer doc me:** teeno (3 endpoints)

---

## 3. Brands — `/brands` (9)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 13 | POST | `/brands/onboarding/add-basic-details` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | Step 1 — business name, registration status, entity type |
| 14 | POST | `/brands/onboarding/add-pan-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 15 | POST | `/brands/onboarding/add-gst-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 16 | POST | `/brands/onboarding/add-bank-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | |
| 17 | GET | `/brands/onboarding/system-verify` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Auto PAN/GST/Bank cross-match → `SYSTEM_VERIFICATION_STATUS` |
| 18 | PUT | `/brands/onboarding/accept-partnership` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Partnership deed accept |
| 19 | PUT | `/brands/onboarding/update-basic-details` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Review/edit flow (same controller as #13) |
| 20 | GET | `/brands/get` | Intended: All · Enforced: Any authenticated | ⚪ | `?brandId` optional (na do to token ka brand). ⚠️ Response me PAN/GST/Bank/SystemVerify/Subscribed lookups aate hain — customer doc me as-is document hoga + security flag (Q18) |
| 21 | PUT | `/brands/update` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | `?brandId` optional. Logo upload (multipart) |

> **Customer doc me:** #20 (1 endpoint — brand profile page)

---

## 4. Verification / KYC — `/verification` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 22 | POST | `/verification/brands/onboarding/verify-pan` | Intended: VENDOR · Enforced: **VENDOR** | 🔵 | CGPey PAN verify + details fetch |
| 23 | POST | `/verification/brands/onboarding/verify-gst` | Intended: VENDOR · Enforced: VENDOR | 🔵 | CGPey GST verify + details fetch |
| 24 | POST | `/verification/brands/onboarding/verify-bank` | Intended: VENDOR · Enforced: VENDOR | 🔵 | Penny-drop bank verify |

---

## 5. Sub Brands / Outlets — `/subBrands` (3)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 25 | POST | `/subBrands/signUp-with-whatsapp` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Outlet create → `SUB_VENDOR` role user + default password. `isFirstOutlet` flag. Duplicate number → 403 |
| 26 | GET | `/subBrands/get-all` | Intended: Vendor + Admin · Enforced: Any authenticated | 🔵 | Filters: `brandId`, `outletType`, `storeId`, `uniqueId`, search, pagination |
| 27 | PUT | `/subBrands/update/:subBrandId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Outlet details update |

---

## 6. Work Hours — `/workHours` (1)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 28 | POST | `/workHours/upsert` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Brand/SubBrand weekly hours (monday…sunday) upsert |

---

## 7. Locations — `/locations` (6)

Ek hi model me customer address, brand address, sub-brand address — `isBrandAddress` / `isSubBrandAddress` flags se distinguish.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 29 | POST | `/locations/create` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Brand address → `Brand.locationId` sync; SubBrand → geo sync. Dono flags true → 400 |
| 30 | GET | `/locations/getAll` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Filters: `userId`, `customerId`, `brandId`, `subBrandId`, city/district/state/zipcode/country, `addressType`, `isDefault`, pagination |
| 31 | GET | `/locations/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | Single location — **customer doc me bhi** (Q3) |
| 32 | POST | `/locations/upsert` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | Service me `role !== CUSTOMER` → 403. Ek customer = ek location. `Customer.locationId` sync |
| 33 | PUT | `/locations/update/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |
| 34 | DELETE | `/locations/delete/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |

> **Customer doc me:** #31, #32 (2 endpoints)

---

## 8. Showcase — `/showcase` (13)

Brand ka photo/video gallery. Vendor manage karta hai, customer dekhta hai.

### 8a. Sections (6)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 35 | POST | `/showcase/section/add` | Intended: VENDOR · Enforced: **VENDOR (service)** | 🔵 | `validateBrandVendor(userId)` — brand token se resolve. Duplicate title → 409. Auto slug + sortOrder |
| 36 | GET | `/showcase/section/get/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Single section + medias |
| 37 | GET | `/showcase/section/get-all` | Intended: Admin + Vendor · Enforced: Any authenticated | ⚪ ⚠️ | Q12 ke hisaab se `brandId` filter chahiye — **abhi service/validator dono me `brandId` support nahi hai** → Q22 |
| 38 | PUT | `/showcase/section/update/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | |
| 39 | PUT | `/showcase/section/:brandId/reorder` | Intended: Admin + Vendor · Enforced: Any authenticated | ⚪ | ✅ Route fix ho gaya (leading `/` add). Body: `sections[{ id, sortOrder }]` |
| 40 | DELETE | `/showcase/section/delete/:sectionId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | |

### 8b. Media (5) — sab 🔵 VENDOR

| # | Method | Endpoint | Access | Notes |
|---|---|---|---|---|
| 41 | POST | `/showcase/section/:sectionId/add-media` | Intended: VENDOR · Enforced: Any authenticated | Photo/Video upload (multipart). `isShowInVideoClips` default true |
| 42 | PATCH | `/showcase/section/:sectionId/media/update/:mediaId` | Intended: VENDOR · Enforced: Any authenticated | Metadata only |
| 43 | PUT | `/showcase/section/:sectionId/media/replace/:mediaId` | Intended: VENDOR · Enforced: Any authenticated | File replace |
| 44 | PUT | `/showcase/section/:sectionId/media/reorder` | Intended: VENDOR · Enforced: Any authenticated | |
| 45 | DELETE | `/showcase/section/:sectionId/media/delete/:mediaId` | Intended: VENDOR · Enforced: Any authenticated | |

### 8c. Customer-facing (2)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 46 | GET | `/showcase/get-brand-showcase/:brandId` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Sirf active sections + active medias, `sortOrder` sorted. `storage`/`metadata` strip. `mediaCount`/`photoCount`/`videoCount` included |
| 47 | GET | `/showcase/:brandId/video-clips` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | `isShowVideosInClips` + `isShowInVideoClips` true wale videos, paginated. Reels feed |

> **Customer doc me:** #46, #47 (2 endpoints)

---

## 9. Vouchers — `/vouchers` (11)

**Lifecycle:** Vendor create → submit review → Admin approve/reject → publish (Vendor ya Admin) → Customer ko visible
**Status flow:** `DRAFT` → `PENDING_REVIEW` → `APPROVED` / `REJECTED` → `PUBLISHED` → `EXPIRED`

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 48 | POST | `/vouchers/create` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Transactional. Images upload, offers, tags, category/subcategory, sub-brand mapping, validity. Version 1 auto-create. Rollback on failure |
| 49 | PUT | `/vouchers/update/:voucherId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | Naya version banata hai (immutable versioning) |
| 50 | POST | `/vouchers/submit-review/:voucherId` | Intended: VENDOR · Enforced: Any authenticated | 🔵 | → `PENDING_REVIEW` |
| 51 | POST | `/vouchers/review/:versionId` | Intended: **ADMIN** · Enforced: Any authenticated | 🟣 | `action`: `APPROVED` \| `REJECTED`. Reject pe `rejectionReason` mandatory (max 1000). `VoucherApprovalHistory` entry |
| 52 | POST | `/vouchers/publish/:versionId` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Sirf `APPROVED` version publish ho sakta hai, warna 400 (Q6) |
| 53 | GET | `/vouchers/versions/get-all` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Filters: `voucherId`, `brandId`, `categoryId`, `subCategoryId`, `status`, `createdBy`, `submittedBy`, `reviewedBy`, `approvedBy`, `rejectedBy`, `versionNumber`, `versionCode`, `isImmutable`, date range, `sortBy` (incl. `RELEVANCE`). Dono docs me (Q8) |
| 54 | POST | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Master-level promo banner — version/approval flow ko touch nahi karta. Purana media auto-delete (Q7) |
| 55 | DELETE | `/vouchers/:voucherId/banner` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | (Q7) |
| 56 | GET | `/vouchers/customer/get-all` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Published + active vouchers listing |
| 57 | GET | `/vouchers/customer/get/:voucherId` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Voucher detail screen |
| 58 | POST | `/vouchers/customer/voucher/preview` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Bill amount pe discount calculation preview |

> **Customer doc me:** #56, #57, #58 (3 endpoints)
> **Note (Q14):** `models/VoucherUsage.js` + `services/vouchers/expireVouchers.js` exist karte hain lekin koi route exposed nahi — doc me nahi jayenge

---

## 10. Banners (App-level) — `/banners` (6)

Global app banners — brand se linked nahi, `createdBy` = admin.
`type`: `IMAGE` \| `VIDEO` \| `GIF` · `redirect`: `NONE` \| `CATEGORY` \| `DEAL` \| `BRAND` \| `OFFER` \| `EXTERNAL_URL`

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 59 | POST | `/banners/create` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | Type ke hisaab se file field (`image`/`video`/`gif`). Active date-range overlap check |
| 60 | PUT | `/banners/update/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | |
| 61 | GET | `/banners/get-all` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | Filters: `type`, `isActive`, date range, search, `sortBy` (`createdAt`/`startDate`/`endDate`/`title`) |
| 62 | GET | `/banners/get/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | |
| 63 | DELETE | `/banners/delete/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | Soft delete |
| 64 | GET | `/banners/customer/active` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Ek hi banner: pehle date-range wala, warna evergreen fallback, warna `null` |

> **Customer doc me:** #64 (1 endpoint)

---

## 11. Promotional Tickers — `/promotionalTickers` (6)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 65 | POST | `/promotionalTickers/create` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | `title`, `icon` upload, `redirect`, `displayOrder`, date range |
| 66 | PUT | `/promotionalTickers/update/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | |
| 67 | GET | `/promotionalTickers/get-all` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | |
| 68 | GET | `/promotionalTickers/get/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | |
| 69 | DELETE | `/promotionalTickers/delete/:id` | Intended: ADMIN · Enforced: Any authenticated | 🟣 | Soft delete |
| 70 | GET | `/promotionalTickers/customer/active` | Intended: CUSTOMER · Enforced: Any authenticated | 🟢 | Active tickers list, `displayOrder` sorted |

> **Customer doc me:** #70 (1 endpoint)

---

## 12. Brand Features — `/brandFeatures` (5)

Brand ke USP/highlight points (icon + title + description). Max **10 active** per brand.
**Q5:** manage = Vendor + Admin dono · read = customer ko bhi chahiye → poora module ⚪ GLOBAL

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 71 | POST | `/brandFeatures/add` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | `brandId` **body me**. Icon mandatory. 10 active limit → 400 |
| 72 | GET | `/brandFeatures/get-all` | Intended: All · Enforced: Any authenticated | ⚪ | `brandId` query mandatory. Filters: `title`, `isActive`, search, date range, pagination. **Customer brand-page** (Q5b) |
| 73 | GET | `/brandFeatures/get/:featureId` | Intended: All · Enforced: Any authenticated | ⚪ | **Customer doc me bhi** (Q5b) |
| 74 | PUT | `/brandFeatures/update/:featureId` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |
| 75 | DELETE | `/brandFeatures/delete/:featureId` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Soft delete |

> **Customer doc me:** #72, #73 (2 endpoints)

---

## 13. Brand Avoidances — `/brandAvoidances` (2)

"Bad experience / don't show me this brand" feature.

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 76 | POST | `/brandAvoidances/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | `resolveCustomerByUserId`. Toggle avoid/un-avoid, transactional |
| 77 | GET | `/brandAvoidances/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | Avoided brands list, paginated |

> **Customer doc me:** dono (2 endpoints)

---

## 14. Follows — `/follows` (2)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 78 | POST | `/follows/toggle/:brandId` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | `resolveCustomerByUserId`. Follow/unfollow toggle, transactional |
| 79 | GET | `/follows/get-all` | Intended: CUSTOMER · Enforced: **CUSTOMER (service)** | 🟢 | Followed brands list, paginated |

> **Customer doc me:** dono (2 endpoints)

---

## 15. Categories — `/categories` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 80 | POST | `/categories/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 81 | GET | `/categories/getAll` | Intended: All · Enforced: Any authenticated | ⚪ | Customer home + Vendor onboarding + Admin (Q17 — as-is) |
| 82 | GET | `/categories/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 83 | PUT | `/categories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 84 | DELETE | `/categories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

> **Customer doc me:** #81, #82 (2 endpoints)

---

## 16. Sub Categories — `/subCategories` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 85 | POST | `/subCategories/:categoryId/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 86 | GET | `/subCategories/getAll` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 87 | GET | `/subCategories/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 88 | PUT | `/subCategories/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 89 | DELETE | `/subCategories/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

> **Customer doc me:** #86, #87 (2 endpoints)

---

## 17. Subscriptions (Plans) — `/subscriptions` (5)

Vendor subscription plans (master data). Customer doc me **nahi** (Q9).
`SUBSCRIPTION_TYPES`: `WEEKLY` \| `MONTHLY` \| `QUATERLY` \| `HALF_YEARLY` \| `YEARLY`
`SUBSCRIPTION_PLANS`: `FREE` \| `BASIC` \| `PREMIUM` \| `FAMILY`

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 90 | POST | `/subscriptions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 91 | GET | `/subscriptions/getAll` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Vendor plan-selection screen |
| 92 | GET | `/subscriptions/get/:id` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | |
| 93 | PUT | `/subscriptions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 94 | DELETE | `/subscriptions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

---

## 18. Transactions — `/transactions` (2)

Razorpay subscription payments. **Vendor + Admin dono** (Q19).
`PAYMENT_STATUS`: `created` \| `authorized` \| `captured` \| `failed`

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 95 | POST | `/transactions/subscribe/create-order` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Razorpay order create. Admin kisi bhi brand ke liye kar sakta hai |
| 96 | POST | `/transactions/subscribe/verify-transaction` | Intended: Vendor + Admin · Enforced: Any authenticated | ⚪ | Signature verify → `Subscribed` doc create |

---

## 19. Settings — `/settings` (2)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 97 | GET | `/settings/get` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | Platform config (voucher config etc.) |
| 98 | PUT | `/settings/update` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

---

## 20. Terms & Conditions — `/terms-and-conditions` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 99 | POST | `/terms-and-conditions/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 100 | GET | `/terms-and-conditions/getAll` | Intended: All · Enforced: Any authenticated | ⚪ | Customer app "Terms" screen |
| 101 | GET | `/terms-and-conditions/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 102 | PUT | `/terms-and-conditions/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 103 | DELETE | `/terms-and-conditions/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

> **Customer doc me:** #100, #101 (2 endpoints)

---

## 21. Privacy & Policies — `/privacy-and-policies` (5)

| # | Method | Endpoint | Access | Cat | Notes |
|---|---|---|---|---|---|
| 104 | POST | `/privacy-and-policies/create` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 105 | GET | `/privacy-and-policies/getAll` | Intended: All · Enforced: Any authenticated | ⚪ | Customer app "Privacy Policy" screen |
| 106 | GET | `/privacy-and-policies/get/:id` | Intended: All · Enforced: Any authenticated | ⚪ | |
| 107 | PUT | `/privacy-and-policies/update/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |
| 108 | DELETE | `/privacy-and-policies/delete/:id` | Intended: ADMIN · Enforced: **ADMIN** | 🟣 | |

> **Customer doc me:** #105, #106 (2 endpoints)

---

## Utility / Non-versioned (3) — docs se bahar (Q20)

`GET /` (health) · `GET /my-ip` · `GET /client-ip` — sab public, `/trydood/v1` ke bahar.

---

# 📱 FINAL: Customer Mobile App Doc — 30 Endpoints

Ye exact list `customer_mobile_api_doc.md` me jayegi, isi structure me:

### Section 1 — Authentication (3)
| # | Method | Endpoint |
|---|---|---|
| 1 | POST | `/auth/loginOrSignUp-with-whatsapp` *(role=`CUSTOMER`)* |
| 2 | POST | `/auth/verify-otp-whatsapp` |
| 3 | POST | `/auth/logout` |

### Section 2 — User Profile (3)
| # | Method | Endpoint |
|---|---|---|
| 4 | GET | `/users/get` |
| 5 | PUT | `/users/update` |
| 6 | DELETE | `/users/delete` ⚠️ *no-op stub* |

### Section 3 — Location (2)
| # | Method | Endpoint |
|---|---|---|
| 7 | POST | `/locations/upsert` |
| 8 | GET | `/locations/get/:id` |

### Section 4 — Master Data (4)
| # | Method | Endpoint |
|---|---|---|
| 9 | GET | `/categories/getAll` |
| 10 | GET | `/categories/get/:id` |
| 11 | GET | `/subCategories/getAll` |
| 12 | GET | `/subCategories/get/:id` |

### Section 5 — Home Screen (2)
| # | Method | Endpoint |
|---|---|---|
| 13 | GET | `/banners/customer/active` |
| 14 | GET | `/promotionalTickers/customer/active` |

### Section 6 — Vouchers / Deals (3)
| # | Method | Endpoint |
|---|---|---|
| 15 | GET | `/vouchers/customer/get-all` |
| 16 | GET | `/vouchers/customer/get/:voucherId` |
| 17 | POST | `/vouchers/customer/voucher/preview` |

### Section 7 — Brand Profile Page (5)
| # | Method | Endpoint |
|---|---|---|
| 18 | GET | `/brands/get?brandId=` ⚠️ *PII in response — security flag* |
| 19 | GET | `/showcase/get-brand-showcase/:brandId` |
| 20 | GET | `/showcase/:brandId/video-clips` |
| 21 | GET | `/brandFeatures/get-all?brandId=` |
| 22 | GET | `/brandFeatures/get/:featureId` |

### Section 8 — Engagement (4)
| # | Method | Endpoint |
|---|---|---|
| 23 | POST | `/follows/toggle/:brandId` |
| 24 | GET | `/follows/get-all` |
| 25 | POST | `/brandAvoidances/toggle/:brandId` |
| 26 | GET | `/brandAvoidances/get-all` |

### Section 9 — Legal (4)
| # | Method | Endpoint |
|---|---|---|
| 27 | GET | `/terms-and-conditions/getAll` |
| 28 | GET | `/terms-and-conditions/get/:id` |
| 29 | GET | `/privacy-and-policies/getAll` |
| 30 | GET | `/privacy-and-policies/get/:id` |

### Appendix — "Not for customer app" (Q16 → Option B)
Reference list — ye endpoints exist karte hain par customer app inko use na kare:
`/auth/register` · `/auth/login` · `/auth/login-with-email` · `/auth/verify-otp-email` · `/auth/login-with-mobile` · `/auth/verify-otp-mobile` · `/brands/onboarding/*` · `/brands/update` · `/verification/*` · `/subBrands/*` · `/workHours/*` · `/locations/create|getAll|update|delete` · `/showcase/section/*` (media + CRUD) · `/vouchers/create|update|submit-review|review|publish|versions|banner` · `/banners/*` (customer/active ke alawa) · `/promotionalTickers/*` (customer/active ke alawa) · `/brandFeatures/add|update|delete` · `/categories|subCategories` writes · `/subscriptions/*` · `/transactions/*` · `/settings/*` · legal writes

---

## Doc structure jo customer doc me follow hoga

Reference doc (`API_DOCUMENTATION.md`) ka exact same format:

1. **Header** — version, base URLs (local + staging), framework, DB, last updated
2. **Table of Contents** — section + har endpoint ka anchor link
3. **Overview** — app kya hai, kaunse modules cover hue
4. **Authentication** — JWT flow, header format, token expiry, role
5. **Standard Response Format** — success/error envelope shape
6. **HTTP Status Codes** — 200/201/400/401/403/404/409/422/500 ka meaning
7. **Enums Reference** — saare relevant constants (ADDRESS_TYPES, BANNER_TYPE, BANNER_REDIRECT_TYPE, VOUCHER_STATUSES, GENDERS, LOGIN_TYPES etc.)
8. **Per-endpoint blocks** — har endpoint ke liye:
   - `### METHOD /path`
   - Description + kis screen pe use hota hai
   - **Access:** Intended + Enforced
   - Headers table
   - Path params / Query params / Body table (type, required, default, enum, validation rule)
   - Success response — real JSON example + status code
   - Error responses — status-wise, actual backend messages ke saath
   - Edge cases + notes
9. **Appendix A** — "Not for customer app" list
10. **Appendix B** — known issues (no-op delete, PII exposure) → `security_findings.md` ka reference

---

**⏳ Pending (blocking nahi):** 2 naye questions `queries.md` me add kiye hain — **Q21** (email/mobile OTP flows kiske liye) aur **Q22** (`showcase/section/get-all` me `brandId` support hi nahi hai). Ye customer doc ko affect nahi karte, isliye aap chaahein to abhi approve kar dijiye — main customer doc start kar dunga.

**Security gaps:** `security_findings.md` me alag document kar diye (Q10b) — 6 findings.
