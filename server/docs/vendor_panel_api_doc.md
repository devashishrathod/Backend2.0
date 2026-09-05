# Trydood 2.0 — Vendor Panel API Documentation

**Version:** 1.2.0
**Base URL (Local):** `http://localhost:8080/trydood/v1`
**Base URL (Staging):** `https://backend2-0-4v4i.onrender.com/trydood/v1`
**Framework:** Express.js (Node.js, CommonJS)
**Database:** MongoDB (Mongoose ODM)
**Scope:** Vendor / brand panel ke **81 endpoints**
**Last verified:** 2026-08-27 against current code · Source: `server2.0` scan (149 total endpoints, categorization → [endpoints_category.md](./endpoints_category.md))

> ✅ **v1.2.0 se ye doc live API ke against verify ho chuka hai** — sirf code padhkar nahi likha gaya. Saare 78 endpoints ek chalte hue server pe seeded fixtures ke saath run kiye gaye: **101 requests, 234 assertions, sab pass.** Collection: [`postman/trydood-vendor.postman_collection.json`](../postman/trydood-vendor.postman_collection.json)
>
> Jahan behaviour buggy ya adhoora hai, wahan ⚠️ (ya 🔴, agar wo cheez tod deti hai) marker hai.

### 🆕 v1.2.0 me kya naya

Live run ne **teen** aise bugs pakde jo code padhkar nahi dikhte the — teeno ab fix hain:

| Bug | Kya hota tha |
|---|---|
| 🔴 `GET /brands/verifications/history` **500** | `isVendor is not defined` — ek `ReferenceError`. Security round me per-role scoping add karte waqt uski declaration hat gayi thi par pipeline me do reads reh gaye. Har vendor request marti thi ([#33](#33-get-brandsverificationshistory)) |
| 🔴 `PUT /showcase/section/:brandId/reorder` **500** | Service `item.sectionId` padhti thi, validator `id` bhejta hai → `undefined.toString()`. **Endpoint kabhi kaam hi nahi kiya** ([#47](#47-put-showcasesectionbrandidreorder)) |
| 🔴 `PUT /showcase/section/:sectionId/media/reorder` **500** | Wahi bug (`item.mediaId` vs `id`). **Ye bhi kabhi kaam nahi kiya** ([#51](#51-put-showcasesectionsectionidmediareorder)) |

Aur do response shapes doc me galat likhi thi:

| Fix | Kya galat tha |
|---|---|
| Section detail ka `media` block | Doc me flat `medias[]` + top-level pagination tha. Asli me **nested** hai — `data.media.data[]` ([#44](#44-get-showcasesectiongetsectionid)) |
| Reorder responses | Dono `updated` return karte hain, `modified` nahi |

### v1.1.0 me kya badla tha

Ye **re-verification round** tha — har endpoint ka gate code se dobara nikala gaya, hand-check nahi kiya.

| Change | Detail |
|---|---|
| **81 → 78 endpoints** | Password flow (`set-password`, `forgot-password`, `reset-password`) ab **admin-only** hai — [#7–9](#79-password-flow--%E2%9B%94-ab-vendor-ke-liye-nahi) dekhein |
| **25 Access lines stale thi** ✅ | Doc `"Any authenticated"` claim kar raha tha un routes pe jo ab properly gated hain — brands, locations, showcase, brand features, voucher versions. Sab code se regenerate ki gayi |
| **Ownership markers** | Jin 24 routes pe service ownership resolve karti hai (`resolveActorBrand` / `resolveSectionForActor`), unpe ab `+ ownership` likha hai — gate kehta hai *"koi vendor"*, ownership kehti hai *"**yahi** vendor"* |
| **`FIXED` discount ab kaam karta hai** ✅ | Pehle enum me tha par calculate nahi hota tha |
| **Voucher banner fields** | `bannerType` + `bannerUrl` customer-facing responses me |

> **Vendor-reachable vs vendor-intended:** teen customer voucher endpoints (`/vouchers/customer/*`) sirf `verifyJwtToken` pe hain, to vendor token unpe technically pahunch jaata hai. Wo vendor panel ke liye nahi hain — [Appendix A](#appendix-a--not-for-vendor-panel) me hain.

---

## Table of Contents

**Foundation**
1. [Overview](#overview)
2. [Vendor Journey](#vendor-journey)
3. [Authentication](#authentication)
4. [Standard Response Format](#standard-response-format)
5. [Pagination](#pagination)
6. [HTTP Status Codes](#http-status-codes)
7. [Common Errors](#common-errors)
8. [Subscription Gate](#subscription-gate)
9. [Enums Reference](#enums-reference)

**Endpoints**

10. [Auth APIs](#auth-apis) — 7 *(password flow admin-only ho gaya)*
11. [User Profile APIs](#user-profile-apis) — 3
12. [Push Notification APIs](#push-notification-apis) — 4
13. [Notification Feed APIs](#notification-feed-apis) — 2
14. [Onboarding APIs](#onboarding-apis) — 8
15. [KYC Verification APIs](#kyc-verification-apis) — 3
16. [Brand APIs](#brand-apis) — 3
17. [Outlet / Sub-Brand APIs](#outlet--sub-brand-apis) — 3
18. [Work Hours APIs](#work-hours-apis) — 1
19. [Location APIs](#location-apis) — 5
20. [Showcase APIs](#showcase-apis) — 11
21. [Voucher APIs](#voucher-apis) — 7
22. [Brand Feature APIs](#brand-feature-apis) — 5
23. [Subscription Plan APIs](#subscription-plan-apis) — 2
24. [My Subscription APIs](#my-subscription-apis) — 2
25. [Payment APIs](#payment-apis) — 4
26. [Master Data APIs](#master-data-apis) — 4
27. [Legal APIs](#legal-apis) — 4

**Reference**

28. [Appendix A — Not For Vendor Panel](#appendix-a--not-for-vendor-panel)
29. [Appendix B — Known Issues](#appendix-b--known-issues)
30. [Frontend Integration Checklist](#frontend-integration-checklist)

---

## Overview

Vendor panel 18 functional areas cover karta hai:

| # | Area | Endpoints | Kya karta hai |
|---|---|---:|---|
| 1 | Auth | 10 | WhatsApp/Email/Mobile OTP login + password set/forgot/reset + logout |
| 2 | User Profile | 3 | Profile fetch, update, delete |
| 3 | Push Notifications | 4 | Device register/unregister, my devices, test |
| 4 | Notification Feed | 2 | In-app notifications + mark read |
| 5 | Onboarding | 8 | Business details → PAN → GST → Bank → system verify → partnership → acknowledge |
| 6 | KYC Verification | 3 | Live PAN / GST / Bank verification (CGPey) |
| 7 | Brand | 3 | Brand detail, update, verification history |
| 8 | Outlets / Sub-Brands | 3 | Outlet signup, list, update |
| 9 | Work Hours | 1 | Weekly timings upsert |
| 10 | Locations | 5 | Brand + outlet addresses |
| 11 | Showcase | 11 | Photo/video gallery — sections + media |
| 12 | Vouchers | 7 | Create, update, submit for review, publish, versions, banner |
| 13 | Brand Features | 5 | USP / highlight points |
| 14 | Subscription Plans | 2 | Available plans browse |
| 15 | My Subscription | 2 | Current plan + history |
| 16 | Payments | 4 | Checkout preview, order, verify, invoice |
| 17 | Master Data | 4 | Categories + sub-categories |
| 18 | Legal | 4 | Terms & Conditions, Privacy Policy |

**Important architecture notes:**

- **Role gates kaafi endpoints pe lag chuke hain.** Vouchers, transactions, subBrands, subscribeds, notifications pe proper `VENDOR+ADMIN` checks hain. Lekin showcase, locations, brandFeatures, workHours pe abhi sirf `verifyJwtToken` hai → [Appendix B](#appendix-b--known-issues)
- **Ownership `resolveActorBrand` se enforce hoti hai** — 11 services isko use karte hain. Vendor sirf apna brand touch kar sakta hai, aur wo check brand ke apne `userId` se hota hai, token ke cached `brandId` se nahi
- **Paid features subscription gate ke peeche hain** — outlets, vouchers, showcase sections ke liye active plan chahiye → [Subscription Gate](#subscription-gate)
- **Soft delete pattern** — kuch bhi actually delete nahi hota, `isDeleted: true` set hota hai
- **Lowercase normalization** — brand names, addresses DB me lowercase store hote hain. UI pe capitalize karna frontend ka kaam hai

---

## Vendor Journey

Vendor ka poora lifecycle, screen-by-screen. `user.currentScreen` field track karti hai vendor kahan hai — har onboarding endpoint use aage badhata hai.

```
1. SIGNUP
   POST /auth/loginOrSignUp-with-whatsapp  { role: "VENDOR" }
   POST /auth/verify-otp-whatsapp          → JWT + Brand doc auto-create
                                             currentScreen: BUSINESS_NAME

2. ONBOARDING — business identity
   POST /brands/onboarding/add-basic-details  { currentScreen: REGISTRATION_STATUS }
        → legalBusinessName, brandName
   POST /brands/onboarding/add-basic-details  { currentScreen: REGISTRATION_ENTITY_TYPE }
        → businessRegistrationStatus (REGISTERED / UNREGISTERED)
   POST /brands/onboarding/add-basic-details  { currentScreen: PAN_VERIFICATION }
        → businessEntityType (PROPRIETORSHIP / PARTNERSHIP / LLP / …)

3. KYC — har step do calls: pehle verify (live), phir save
   POST /verification/brands/onboarding/verify-pan   → CGPey se PAN details
   POST /brands/onboarding/add-pan-details           → save
                                             currentScreen: GST_VERIFICATION
   POST /verification/brands/onboarding/verify-gst   → CGPey se GST details
   POST /brands/onboarding/add-gst-details           → save
                                             currentScreen: BANK_VERIFICATION
   POST /verification/brands/onboarding/verify-bank  → penny-drop
   POST /brands/onboarding/add-bank-details          → save
                                             currentScreen: SYSTEM_VERIFICATION

4. SYSTEM VERIFICATION — automatic cross-match + score
   GET /brands/onboarding/system-verify
        → score ≥ 90  → APPROVED
        → score ≥ 75  → MANUAL_REVIEW
        → warna       → REJECTED
                                             currentScreen: PARTNERSHIP_DEED

5. PARTNERSHIP
   PUT /brands/onboarding/accept-partnership
                                             currentScreen: SUBSCRIBE_PLAN

6. SUBSCRIPTION
   GET  /subscriptions/getAll                        → plans browse
   POST /transactions/subscribe/preview              → price + promo preview
   POST /transactions/subscribe/create-order         → Razorpay order
   POST /transactions/subscribe/verify-transaction   → activate
                                             currentScreen: OUTLET_PAGE

7. FIRST OUTLET
   POST /subBrands/signUp-with-whatsapp  { isFirstOutlet: true }
   POST /locations/create                { isSubBrandAddress: true }
   POST /workHours/upsert                { subBrandId }
                                             currentScreen: UNDER_REVIEW

8. ADMIN APPROVAL (vendor waits)
   Admin: PUT /brands/admin/verifications/:brandId/review  { action: "APPROVED" }
   PUT /brands/onboarding/acknowledge-approval
                                             currentScreen: DASHBOARD

9. OPERATE
   Showcase · Vouchers · Brand features · More outlets
```

⚠️ **Rejection ka raasta:** agar admin reject kare to vendor onboarding sections edit karke `GET /brands/onboarding/system-verify` dobara call karta hai (`RESUBMITTED` action). Poora remediation flow → [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md)

---

## Authentication

Login ke baad har protected request me JWT bhejna hai:

```http
Authorization: Bearer <token>
```

**Token kahan se milta hai:** `POST /auth/verify-otp-whatsapp` (ya email/mobile variant) ke response me `data.token`

**JWT payload:**
```json
{
  "id": "68f1a2b3c4d5e6f7a8b9c0d1",
  "role": "VENDOR",
  "name": "cafe mocha",
  "email": "hello@cafemocha.in",
  "whatsappNumber": "9812345678",
  "mobile": "9812345678",
  "iat": 1755820800,
  "exp": 1758412800
}
```

**Expiry:** `JWT_EXPIRY` env variable se. Expire hone pe `401` + `"Your session has expired. Please log in again."` → login screen.

⚠️ **Logout server-side token invalidate nahi karta.** Client ko locally token delete karna hoga, aur push ke liye `PUT /deviceTokens/unregister` bhi call karna hoga.

### `req` context jo backend set karta hai

Middleware ke baad har handler ko ye milta hai — samajhna useful hai kyunki kai endpoints `brandId` optional rakhte hain:

| Field | Kab set hota hai |
|---|---|
| `req.userId` | Hamesha |
| `req.role` | Hamesha — `VENDOR` |
| `req.brandId` | Sirf `VENDOR` role pe — vendor ka apna brand |

Isliye vendor ke liye `brandId` zyadatar endpoints pe **optional** hai (token se resolve ho jaata hai), jabki admin ke liye **mandatory**.

---

## Standard Response Format

**Success:**
```json
{
  "success": true,
  "message": "Brand details fetched successfully",
  "data": { }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Brand not found!"
}
```

Kabhi-kabhi error me extra `details` field bhi aati hai.

⚠️ **Ek exception:** `DELETE /users/delete` standard envelope use **nahi** karta — raw `{ "message": "..." }`, `success` field ke bina.

---

## Pagination

List endpoints ka `data` ye shape me aata hai:

```json
{
  "success": true,
  "message": "Outlets/Sub-Brands fetched successfully",
  "data": {
    "total": 12,
    "totalPages": 2,
    "page": 1,
    "limit": 10,
    "data": [ ]
  }
}
```

`data.data` nested hai — outer `data` envelope ka, inner `data` actual array.

### ⚠️ Empty list = 404, empty array nahi

`pagination` utility jab koi record nahi milta to **404 throw** karti hai:

```json
{ "success": false, "message": "No any subbrand found" }
```

**404 ko error treat na karein** in list endpoints pe — wo "koi data nahi hai" ka matlab hai. Empty-state UI dikhayein, error toast nahi.

Har list endpoint ka exact 404 message alag hai — har endpoint ke section me diya hai.

**Exceptions (ye 404 nahi dete):**
- `GET /deviceTokens/get-mine` → `devices: []`
- `GET /subscribeds/get` → `null` ya `{ subscribed: null }`
- Naye modules (`notifications`, `subscribeds`, `transactions`) apna khud ka pagination use karte hain — wo empty pe `200` + `[]` dete hain

---

## HTTP Status Codes

| Code | Meaning | Kab |
|---|---|---|
| `200` | OK | Successful GET/PUT/POST |
| `201` | Created | Voucher create, media upload, work hours upsert, admin grant |
| `400` | Bad Request | Business rule fail |
| `401` | Unauthorized | Token missing / expired, ya galat current password |
| `403` | Forbidden | Role not permitted, **subscription required**, **limit reached**, deactivated account |
| `404` | Not Found | Resource nahi mila **ya empty list** |
| `409` | Conflict | Duplicate (jaise showcase section title) |
| `422` | Unprocessable Entity | Joi validation fail, invalid ObjectId, missing `brandId` for admin |
| `500` | Server Error | Unexpected failure |

---

## Common Errors

Ye kisi bhi protected endpoint pe aa sakte hain — har endpoint pe repeat nahi kiye:

| Status | Message | Kab |
|---|---|---|
| `401` | `Access Denied! Missing authorization token` | `Authorization` header nahi bheja |
| `403` | `Access Denied! Invalid authorization token format` | `Bearer <token>` format nahi |
| `401` | `Your session has expired. Please log in again.` | Token expired → **login screen** |
| `403` | `Invalid or malformed token. Please log in again.` | Token corrupt / galat secret |
| `403` | `Token not active yet. Please try again later.` | `nbf` future me (rare) |
| `403` | `Access Denied! Invalid token` | Decode hua par payload empty |
| `404` | `Access Denied! User not found` | Token valid, user record nahi |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role allowlist me nahi |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | `resolveActorBrand` — dusre brand pe operate karne ki koshish |
| `404` | `No brand is linked to your account` | Vendor ke paas brand hi nahi |
| `404` | `Brand not found!` | brandId ka brand nahi ya deleted |
| `500` | `Authentication failed due to an unexpected error.` | JWT verify me unknown error |
| `422` | *(field-wise Joi message)* | Request validation fail |
| `404` | `Invalid API` | Galat endpoint path |

### Validation errors ka format

Joi errors ek string me join hote hain (`, ` se), field names human-readable ban jaate hain:

```json
{
  "success": false,
  "message": "Legal Business Name is required, Current Screen is required"
}
```

**Unknown fields silently drop ho jaate hain** (`stripUnknown: true`) — extra field bhejne pe error nahi, chup-chaap ignore.

---

## Subscription Gate

Vendor ke **paid features** active subscription ke peeche hain. Ye gate `assertActiveSubscription` helper se lagta hai.

### Kaunse features gated hain

| Feature | Bucket | Endpoint |
|---|---|---|
| Outlets | `subBrands` | `POST /subBrands/signUp-with-whatsapp` |
| Franchises | `franchises` | Same endpoint, `outletType: "FRANCHISE"` |
| Vouchers | `vouchers` | `POST /vouchers/create` |
| Showcase sections | `showcase` | `POST /showcase/section/add` |

Har bucket **independent pool** hai — ek doosre se nahi kharchta.

### Gate ke errors

| Status | Message | Kab |
|---|---|---|
| `403` | `Access denied. This feature requires an active subscription. Please subscribe to continue.` | Koi active plan nahi |
| `403` | `Your current plan does not include outlets. Please upgrade your subscription to add outlets.` | Bucket ka `limit: 0` — plan me feature hai hi nahi |
| `403` | `Outlet/Sub-brand limit reached — 3 of 3 used on your current plan. Please upgrade your subscription to add more.` | Pool khatam |
| `403` | `Your current BASIC plan does not include deal pack. Please upgrade your subscription to use this feature.` | Flag feature off hai |
| `404` | `The subscription plan for this brand no longer exists.` | Plan delete ho gaya (data issue) |

Messages me bucket ka label plural/singular ke hisaab se badalta hai — `outlet`/`outlets`, `franchise`/`franchises`, `voucher`/`vouchers`, `showcase section`/`showcase sections`.

### Subscription kab "active" hai

**`Brand.isSubscribed` pe bharosa mat karo** — wo sirf denormalized cache hai. Actual truth:

```
Subscribed.status === "ACTIVE"  AND  Subscribed.endDate > now
```

Backend self-healing hai: agar koi doc `ACTIVE` claim kare par `endDate` nikal chuki ho, wo read pe hi expire ho jaata hai. Ek background job (`expireSubscriptions`, default har 60 min) bhi chalta hai, par correctness uspe depend nahi karti.

**Expire hone pe kya hota hai:** naya kuch create nahi kar sakte (saare limits `0`), par **existing rows kabhi touch nahi hote** — outlets, vouchers, showcase sab bache rehte hain.

Poori design → [subscription_lifecycle_design.md](./subscription_lifecycle_design.md)

---

## Enums Reference

Saare enum values **UPPERCASE** hain (payment gateway values ke alawa).

### ROLES
`ADMIN` · `VENDOR` · `SUB_VENDOR` · `CUSTOMER`
> Vendor panel hamesha `VENDOR` bhejega auth calls me. Outlet accounts `SUB_VENDOR` role pe bante hain — ⚠️ un pe abhi koi route kaam nahi karta

### SCREENS — `currentScreen` onboarding tracker
`BUSINESS_NAME` · `REGISTRATION_STATUS` · `REGISTRATION_ENTITY_TYPE` · `PAN_VERIFICATION` · `GST_VERIFICATION` · `BANK_VERIFICATION` · `SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `SUBSCRIBE_PLAN` · `OUTLET_PAGE` · `UNDER_REVIEW` · `DASHBOARD`

### BUSINESS_REGISTRATION_STATUS
`REGISTERED` · `UNREGISTERED`

### BUSINESS_ENTITY_TYPE
`PROPRIETORSHIP` · `PARTNERSHIP` · `LLP` · `PRIVATE_LIMITED` · `PUBLIC_LIMITED` · `ONE_PERSON_COMPANY` · `TRUST` · `NGO` · `SOCIETY`

### PAN_TYPES
`INDIVIDUAL` · `COMPANY` · `FIRM` · `LLP` · `HUF` · `TRUST` · `AOP` · `BOI` · `GOVERNMENT` · `ARTIFICIAL_JURIDICAL_PERSON` · `LOCAL_AUTHORITY` · `FOREIGN_COMPANY`

### BANK_ACCOUNT_TYPES
`SAVINGS` · `CURRENT` · `NRE` · `NRO` · `OD` · `CC` · `OTHER`

### GST_TAXPAYER_TYPE
`REGULAR` · `COMPOSITION` · `SEZ_UNIT` · `SEZ_DEVELOPER` · `INPUT_SERVICE_DISTRIBUTOR` · `TAX_DEDUCTOR` · `TAX_COLLECTOR` · `CASUAL_TAXABLE_PERSON` · `NON_RESIDENT_TAXABLE_PERSON` · `GOVERNMENT_DEPARTMENT` · `UN_BODY` · `EMBASSY` · `OIDAR` · `REGISTERED_PERSON` · `UNKNOWN`

### GST_REGISTRATION_STATUS
`SUCCESS` · `CANCELLED` · `SUSPENDED` · `PROVISIONAL` · `MIGRATED` · `INACTIVE` · `PENDING_CANCELLATION` · `FAILED` · `UNKNOWN`

### PRIMARY_VERIFICATION_STATUSES
`PENDING` · `IN_PROGRESS` · `SUCCESS` · `FAILED` · `REJECTED`

### PRIMARY_VERIFICATION_PROVIDERS
`CGPEY` *(default)* · `ZOOP` · `SIGNZY` · `SUREPASS` · `CASHFREE` · `OTHER`

### SYSTEM_VERIFICATION_STATUS
`PENDING` · `APPROVED` · `MANUAL_REVIEW` · `UNDER_REVIEW` · `REJECTED` · `REVOKED`
> `REVOKED` = approval milne ke baad admin ne wapas li. `REJECTED` se alag — wo matlab kabhi approve hua hi nahi tha.

### BRAND_VERIFICATION_ACTION — audit trail events
`SYSTEM_VERIFIED` · `RESUBMITTED` · `REVIEWED` · `UNREVIEWED` · `APPROVED` · `REJECTED` · `REVOKED` · `APPROVAL_ACKNOWLEDGED` · `REMEDIATION_UPDATED`

### BRAND_VERIFICATION_ACTOR
`SYSTEM` · `ADMIN` · `VENDOR`

### OUTLET_TYPES
`OUTLET` *(default)* · `FRANCHISE`
> ⚠️ Ye alag-alag plan pools se kharchte hain — `subBrands` aur `franchises`

### SUBSCRIBED_STATUS
`PENDING` · `ACTIVE` · `EXPIRED` · `UPGRADED` · `DOWNGRADED` · `CANCELLED`
> **Source of truth.** `Brand.isSubscribed` sirf `ACTIVE + endDate > now` ka cache hai

### SUBSCRIPTION_ACTION — checkout pe kya ho raha hai
| Value | Kab |
|---|---|
| `NEW` | Koi active plan nahi |
| `RENEW` | Wahi plan dobara |
| `UPGRADE` | Mehenga plan |
| `DOWNGRADE` | Sasta plan — ⚠️ vendor self-downgrade nahi kar sakta (`allowVendorDowngrade: false`) |

### SUBSCRIPTION_SOURCE
`PAYMENT` (vendor ne khud pay kiya) · `ADMIN_PAYMENT` (admin ne vendor ke liye pay karaya) · `ADMIN_MANUAL` (admin grant, bina payment)

### SUBSCRIPTION_TYPES
`WEEKLY` (7d) · `MONTHLY` (30d) · `QUATERLY` (90d) · `HALF_YEARLY` (180d) · `YEARLY` (365d)

### SUBSCRIPTION_HISTORY_ACTION
`ORDER_CREATED` · `ACTIVATED` · `RENEWED` · `UPGRADED` · `DOWNGRADED` · `EXPIRED` · `CANCELLED` · `ADMIN_GRANTED`

### ENTITLEMENT_BUCKETS — metered pools
`subBrands` · `franchises` · `vouchers` · `showcase`
> Har ek independent hai. Shape: `{ limit, isUnlimited }`. `limit: 0` + `isUnlimited: false` = feature plan me hai hi nahi

### VOUCHER_STATUSES
`DRAFT` · `UNDER_REVIEW` · `APPROVED` · `PUBLISHED` · `REJECTED` · `EXPIRED` · `PAUSED` · `ARCHIVED`

### VOUCHER_DISCOUNT_TYPES
`PERCENTAGE` · `FLAT` · ~~`FIXED`~~
> ⚠️ `FIXED` enum me hai par calculation me handle nahi hota — aisa offer customer ko kabhi apply nahi hoga. `PERCENTAGE` ya `FLAT` hi use karein → [Appendix B](#appendix-b--known-issues)

### VOUCHER_USAGE_TYPE
`ONCE_PER_USER` · `MULTIPLE`
> ⚠️ Enforcement abhi implement nahi hai — redemption tracking hi nahi hai

### DISCOUNT_APPLICABLE_ON
`SUBTOTAL` *(default)* · `FINAL_BILL`
> ⚠️ Calculation me use nahi hota — sirf display/terms ke liye

### VOUCHER_SORT_BY
`DISTANCE` · `NEWEST` · `EXPIRING_SOON` · `RELEVANCE`

### VOUCHER_BANNER_TYPE
`IMAGE` · `VIDEO` · `GIF`
> Multipart file field alag hai: `bannerImage` / `bannerVideo` / `bannerGif`

### SHOWCASE_SECTION_TYPE
`CUSTOM` *(default)* · `SYSTEM`

### SHOWCASE_MEDIA_TYPE
`PHOTO` · `VIDEO`

### SHOWCASE_MEDIA_CONFIG — per-section limits
| Limit | Value |
|---|---:|
| Max items | 15 |
| Max images | 15 |
| Max videos | 5 |
| Max image size | 10 MB |
| Max video size | 50 MB |

Allowed images: `image/jpeg` · `image/jpg` · `image/png` · `image/webp`
Allowed videos: `video/mp4` · `video/webm` · `video/quicktime`

### DEVICE_PLATFORMS
`ANDROID` · `IOS` · `WEB`

### NOTIFICATION_TYPES — vendor ko ye dikhte hain
`SUBSCRIPTION_ACTIVATED` · `SUBSCRIPTION_RENEWED` · `SUBSCRIPTION_UPGRADED` · `SUBSCRIPTION_DOWNGRADED` · `SUBSCRIPTION_GRANTED` · `SUBSCRIPTION_EXPIRING` · `SUBSCRIPTION_EXPIRED` · `SUBSCRIPTION_CANCELLED` · `LIMIT_REACHED` · `ANNOUNCEMENT`

> Admin-only types (`WEBHOOK_FAILED`, `PAYMENT_DISPUTED`, `BRAND_SUBSCRIPTION_LAPSED`, `PROMO_LIMIT_EXCEEDED`) vendor ko nahi dikhte

### NOTIFICATION_CHANNELS
`IN_APP` (hamesha) · `EMAIL` · `PUSH` · `WHATSAPP` *(reserved — Meta template approval pending)*

### NOTIFICATION_SEVERITY
`INFO` · `WARNING` · `CRITICAL`

### ADDRESS_TYPES
`HOME` · `WORK` · `OTHER` — default `HOME`

### GENDERS
`MALE` · `FEMALE` · `OTHER`

### LOGIN_TYPES
`EMAIL` · `MOBILE` · `USERNAME` · `WHATSAPP` · `GOOGLE` · `PASSWORD` · `FACEBOOK` · `OTHER`

### ZIP code validation (country-wise)
`zipcode` ka format `country` field pe depend karta hai:

| Country | Pattern | Example |
|---|---|---|
| `IN` / india *(default)* | 6 digits, first 1-9 | `452001` |
| `US` | 5 digits ya ZIP+4 | `90210` |
| `CA` | A1A 1A1 | `K1A 0B1` |
| `UK` | SW1A 1AA style | `SW1A 1AA` |
| `AU` | 4 digits | `2000` |
| `DE`/`FR`/`IT`/`ES` | 5 digits | `10115` |
| `BR` | 12345-678 | `01310-100` |
| `RU` | 6 digits | `101000` |

---

# Auth APIs

Vendor 3 tarah se login kar sakta hai — WhatsApp OTP (primary), Email OTP, ya Mobile OTP.

⚠️ **Password login vendor ke liye hai hi nahi.** `POST /auth/login` aur poora password
set/reset flow ab ADMIN-only hai — [#7–9](#79-password-flow--%E2%9B%94-ab-vendor-ke-liye-nahi)
dekhein. Vendor ke paas password banane ka koi raasta nahi, isliye login karne ka bhi nahi.

## 1. POST /auth/loginOrSignUp-with-whatsapp

Vendor ka primary login. Naya number → `User` + `Brand` dono auto-create.

**Access:** Intended: Vendor + Customer · Enforced: **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` (`/^[6-9]\d{9}$/`) |
| `role` | string | ⚠️ | `CUSTOMER` | **Vendor panel ko `"VENDOR"` bhejna zaruri hai** — default customer hai |

```json
{ "whatsappNumber": "9812345678", "role": "VENDOR" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "OTP sent to your whatsapp number successfully.",
  "data": {
    "isFirst": true,
    "user": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "role": "VENDOR",
      "loginType": "WHATSAPP",
      "whatsappNumber": "9812345678",
      "uniqueId": "TDU000078",
      "referralCode": "MOCHA7X2K",
      "isMobileVerified": false,
      "isOnBoardingCompleted": false,
      "isActive": true,
      "createdAt": "2026-08-22T10:15:30.000Z"
    }
  }
}
```

**`isFirst`:**
- `true` → naya vendor. `Brand` doc bhi ban gaya (`uniqueId` + `merchantId` ke saath). Onboarding start karo
- `false` → existing vendor. `currentScreen` dekh kar wahin resume karo

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Your account is deactivated. Please contact support.` | `isActive: false` |
| `422` | `WhatsApp number is required` | Missing |
| `422` | `Please enter a valid 10 digit WhatsApp number` | Pattern fail |
| `422` | `Invalid role` | Enum me nahi |

### ⚠️ Notes

**1. `role: "VENDOR"` bhejna mandatory hai.** Default `CUSTOMER` hai — na bhejo to vendor ke bajaye customer account ban jayega. Same number dono roles me alag accounts rakh sakta hai.

**2. OTP actually send nahi hota** — `services/auth/loginOrSignUpWithWhatsapp.js:56` pe line commented hai. Testing me koi bhi 6-digit OTP chalega → [Appendix B](#appendix-b--known-issues)

**3. Naya vendor banne pe:** `User` + `Brand` dono create, `user.brandId` link, `Brand.uniqueId` + `Brand.merchantId` auto-generate.

**4. Response me `password` hash aa sakta hai** — agar vendor ne pehle password set kiya ho. Is field ko store/log na karein.

---

## 2. POST /auth/verify-otp-whatsapp

OTP verify → JWT.

**Access:** Intended: Vendor + Customer · Enforced: **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `otp` | string | ✅ | – | Exactly 6 characters |
| `role` | string | ⚠️ | `CUSTOMER` | **`"VENDOR"` bhejein** |
| `currentScreen` | string | ❌ | – | SCREENS enum, auto-uppercase |

```json
{ "whatsappNumber": "9812345678", "otp": "123456", "role": "VENDOR" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "user": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "role": "VENDOR",
      "whatsappNumber": "9812345678",
      "uniqueId": "TDU000078",
      "currentScreen": "BUSINESS_NAME",
      "isMobileVerified": true,
      "isActive": true
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Invalid Whatsapp number, user not found!` | Is number + role ka user nahi — pehle step 1 |
| `422` | `OTP is required` / `OTP must be 6 digits` | Format |

### ⚠️ Notes

**1. OTP verify nahi hota** — `verifyOtpWithWhatsapp.js:12` commented hai. Koi bhi 6-digit chalega. Uncomment hone ke baad ye errors aayenge, inko pehle se handle karein:
- `401 "Please resend OTP! OTP is expired or missing"`
- `403 "Max attempts exceeded! Please try again later."`
- `401 "Invalid OTP! Please try again."`

**2. `currentScreen` pe validator loose hai** — Joi sirf string check karta hai, enum nahi. Galat value Mongoose pe `422` degi. Onboarding endpoints khud screen aage badhate hain, isliye yahan bhejne ki zarurat nahi.

**3. Login ke baad `user.currentScreen` dekh kar route karein** — vendor wahin resume hoga jahan chhoda tha.

---

## 3. POST /auth/login-with-email

Email pe OTP bhejta hai.

**Access:** Intended: Vendor + Admin · Enforced: **Public**

### Body
| Field | Type | Required | Default |
|---|---|---|---|
| `email` | string | ✅ | – |
| `role` | string | ⚠️ | **`ADMIN`** |

⚠️ Is flow ka `role` default **`ADMIN`** hai (WhatsApp flow me `CUSTOMER` hai). Vendor panel ko `"VENDOR"` explicitly bhejna hoga.

```json
{ "email": "hello@cafemocha.in", "role": "VENDOR" }
```

### Success — `200`
```json
{ "success": true, "message": "OTP sent to your email successfully.", "data": { } }
```

### Errors
| Status | Message |
|---|---|
| `404` | *(user not found)* |
| `422` | `Email is required` / `Please enter a valid email address` |
| `422` | `Invalid role` |

### ⚠️ Note
Email OTP flow me verification **intact** hai (WhatsApp ke ulta) — actual OTP mail jaata hai aur verify hota hai.

---

## 4. POST /auth/verify-otp-email

**Access:** Intended: Vendor + Admin · Enforced: **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `email` | string | ✅ | – | Valid email |
| `otp` | string | ✅ | – | Exactly 6 digits (`/^\d{6}$/`) |
| `role` | string | ⚠️ | `ADMIN` | `"VENDOR"` bhejein |
| `currentScreen` | string | ❌ | – | SCREENS enum |

### Success — `200`
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": { "user": { }, "token": "eyJ..." }
}
```

### Errors
| Status | Message |
|---|---|
| `401` | `Please resend OTP! OTP is expired or missing` |
| `403` | `Max attempts exceeded! Please try again later.` |
| `401` | `Invalid OTP! Please try again.` |
| `422` | `OTP must be a 6 digit number` |

---

## 5. POST /auth/login-with-mobile

**Access:** Intended: Vendor + Admin · Enforced: **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `mobile` | string | ✅ | – | Exactly 10 digits (`/^\d{10}$/`) |
| `role` | string | ⚠️ | `ADMIN` | `"VENDOR"` bhejein |

### Success — `200`
```json
{ "success": true, "message": "OTP sent to your mobile successfully.", "data": { "sessionId": "abc-123" } }
```

> Mobile flow `sessionId` return karta hai — verify step me wahi bhejna hoga.

### Errors
| Status | Message |
|---|---|
| `422` | `Mobile number must be 10 digits` / `Mobile number is required` |

---

## 6. POST /auth/verify-otp-mobile

**Access:** Intended: Vendor + Admin · Enforced: **Public**

### Body
| Field | Type | Required | Notes |
|---|---|---|---|
| `mobile` | string | ✅ | 10 digits |
| `sessionId` | string | ✅ | **Step 5 ke response se** — sirf is flow me hai |
| `otp` | string | ✅ | 6 digits |
| `role` | string | ⚠️ | Default `ADMIN` — `"VENDOR"` bhejein |
| `currentScreen` | string | ❌ | SCREENS enum |

### Success — `200`
```json
{ "success": true, "message": "OTP verified successfully", "data": { "user": { }, "token": "eyJ..." } }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Session ID is required` |
| `401` | `Invalid OTP! Please try again.` |

---

## 7–9. Password flow — ⛔ ab vendor ke liye nahi

`POST /auth/set-password` · `POST /auth/forgot-password` · `POST /auth/reset-password`

**Access:** Intended: ADMIN · Enforced: **ADMIN**

Ye teeno pehle is doc me the. **Ab vendor inhe use nahi kar sakta** — password
sign-in ek product decision se admin-only kar diya gaya.

### Kyun

Vendor WhatsApp OTP se sign in karta hai. Uspe password rakhne ka matlab sirf ek
aur credential hai jo chori ho sakta hai — koi naya access nahi milta. To wo
option hata diya gaya.

### Enforcement kahan hai

| Endpoint | Kaise block hota hai |
|---|---|
| `/auth/set-password` | Route pe `isAdmin` — vendor token pe `403` |
| `/auth/forgot-password` | Route public hai, par validator me `role` sirf `ADMIN` allow karta hai |
| `/auth/reset-password` | Wahi — validator me `role` sirf `ADMIN` |

Baad wale do public hi rehte hain (unhe sign-in ki zarurat nahi), par
`role: "VENDOR"` bhejne pe **`422`** aata hai:

```json
{
  "success": false,
  "message": "Password sign-in is only available for admin accounts. Customers and vendors sign in with a WhatsApp OTP."
}
```

Message deliberately actionable hai — bare "Invalid role" ke bajaye ye batata hai
ki karna kya hai.

### Vendor ke liye sign-in ke raaste

| Flow | Endpoints |
|---|---|
| WhatsApp OTP *(primary)* | [#1](#1-post-authloginorsignup-with-whatsapp) → [#2](#2-post-authverify-otp-whatsapp) |
| Email OTP | [#3](#3-post-authlogin-with-email) → [#4](#4-post-authverify-otp-email) |
| Mobile OTP | [#5](#5-post-authlogin-with-mobile) → [#6](#6-post-authverify-otp-mobile) |

⚠️ **Vendor `POST /auth/login` (password login) bhi use nahi kar sakta** — uska
validator bhi `role` ko `ADMIN` tak seemit karta hai. Isliye wo endpoint is doc
me kabhi tha hi nahi.

> Numbering 7–9 isliye chhodi nahi gayi ki doc ke baaki links tootein na. Agla
> endpoint #10 hai.

---

## 10. POST /auth/logout

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
Koi nahi.

### Success — `200`
```json
{ "success": true, "message": "Logout successful", "data": {} }
```

### ⚠️ Notes

**1. Server-side kuch nahi hota** — token blacklist nahi hota, `isLoggedIn` update nahi hota, device token deactivate nahi hota.

**2. Sahi logout sequence:**
```
PUT  /deviceTokens/unregister  { token }     ← warna push aati rahegi
POST /auth/logout
→ local token + cache clear
```

---

# User Profile APIs

## 11. GET /users/get

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | ⚠️ **Kabhi na bhejein** — kisi bhi user ka profile mil jaata hai ([Appendix B](#appendix-b--known-issues)) |

### Success — `200`
```json
{
  "success": true,
  "message": "User fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "customerId": null,
    "name": "rahul sharma",
    "dob": "1985-04-12T00:00:00.000Z",
    "role": "VENDOR",
    "loginType": "WHATSAPP",
    "email": "hello@cafemocha.in",
    "whatsappNumber": "9812345678",
    "uniqueId": "TDU000078",
    "referralCode": "MOCHA7X2K",
    "passwordSetAt": "2026-08-22T12:00:00.000Z",
    "currentScreen": "DASHBOARD",
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/profile/abc.jpg",
    "isEmailVerified": false,
    "isMobileVerified": true,
    "isOnBoardingCompleted": true,
    "isActive": true,
    "createdAt": "2026-03-15T00:00:00.000Z",
    "updatedAt": "2026-08-22T12:00:00.000Z"
  }
}
```

**Excluded:** `password`, `otp`, `isDeleted`

> `customerId` vendor ke liye `null` rahega — wo sirf CUSTOMER role pe populate hota hai.

### Errors
| Status | Message |
|---|---|
| `401` | `Unauthorized access! User not found.` |
| `422` | `Invalid ID` |

### ⚠️ Notes

**1. `currentScreen` se onboarding resume karein** — login ke baad yahi field batati hai vendor kahan tha.

**2. `passwordSetAt` vendor panel me ignore karein.** Field response me aati hai, par vendor password set kar hi nahi sakta ([#7–9](#79-password-flow--%E2%9B%94-ab-vendor-ke-liye-nahi)) — to vo hamesha `null` rahegi. "Set password" screen mat banayein.

---

## 12. PUT /users/update

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | ⚠️ **Kabhi na bhejein** — IDOR |

### Body — sab optional
| Field | Type | Validation | Notes |
|---|---|---|---|
| `fullName` | string | 2–100 chars | Lowercase me store |
| `email` | string | Valid email | Change pe `isEmailVerified` reset |
| `dob` | string | ISO date | |
| `appliedReferralCode` | string | Max 20 chars | |
| `image` | file | – | **Multipart only**, field name `image` |

### Success — `200`
```json
{
  "success": true,
  "message": "User profile updated successfully",
  "data": { "_id": "...", "name": "rahul sharma", "email": "new@cafemocha.in", "isEmailVerified": false }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `User not found` |
| `400` | `Email already exists with another user` |
| `422` | `Name should have at least 2 characters` / `Name should not exceed 100 characters` |
| `422` | `Please enter a valid email address` |
| `422` | `Date of birth must be a valid date in ISO format (YYYY-MM-DD)` |

### ⚠️ Notes

**1. Ye personal profile hai, brand nahi.** Brand ka naam/logo/description ke liye `PUT /brands/update` use karein (endpoint #24).

**2. Email uniqueness role-scoped hai** — same email VENDOR aur CUSTOMER dono me ho sakta hai.

**3. `mobile` / `whatsappNumber` update nahi ho sakte** — validator me commented hain.

**4. Ye endpoint `validateSchema` middleware use nahi karta** — controller ke andar manual validation hai, isliye error format thoda different (field names raw camelCase me).

---

## 13. DELETE /users/delete

⚠️ **No-op stub — kuch delete nahi karta.**

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Success — `200`
```json
{ "message": "User deleted successfully" }
```

> ⚠️ Standard envelope **nahi** hai — koi `success` field nahi.

### ⚠️ Critical
Route me inline handler hai, koi controller/service nahi:
```js
// routes/users.js:11
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```
Account actually delete nahi hota. Vendor panel me is feature ko disable rakhein.

---

# Push Notification APIs

Role-agnostic module — vendor ka browser/phone bilkul customer jaise register hota hai.
Global middleware: `router.use(verifyJwtToken)`

## 14. POST /deviceTokens/register

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
| Field | Type | Required | Validation | Notes |
|---|---|---|---|---|
| `token` | string | ✅ | 20–4096 chars | FCM registration token |
| `platform` | string | ✅ | `ANDROID` \| `IOS` \| `WEB` | Vendor panel web hai to `WEB` |
| `deviceId` | string | ❌ | Max 128 | **Bhejein** — reinstall pe purana token retire ho jaata hai |
| `deviceName` | string | ❌ | Max 128 | |
| `appVersion` | string | ❌ | Max 32 | |

```json
{
  "token": "fMEp8kQ2S0aBcDeFgHiJkL:APA91bH...",
  "platform": "WEB",
  "deviceId": "chrome-macbook-01",
  "deviceName": "Chrome on MacBook"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Device registered for push notifications",
  "data": {
    "device": {
      "_id": "68f1a2b3c4d5e6f7a8b9d001",
      "userId": "68f1a2b3c4d5e6f7a8b9c0d1",
      "role": "VENDOR",
      "platform": "WEB",
      "deviceId": "chrome-macbook-01",
      "isActive": true,
      "lastSeenAt": "2026-08-22T12:00:00.000Z",
      "failureCount": 0
    },
    "activeDevices": 2
  }
}
```

### Errors
| Status | Message |
|---|---|
| `401` | `Authentication is required to register a device.` |
| `422` | `token is required` / `token does not look like a valid push token` |
| `422` | `platform must be one of: ANDROID, IOS, WEB` |

### ⚠️ Notes

**1. Idempotent** — `token` pe upsert hota hai, baar-baar safe hai.

**2. Token ownership transfer handle hota hai** — `token` unique hai, `(userId, token)` nahi. Ek install haath badal sakta hai (shared machine, logout-login as someone else), isliye already-registered token **reassign** ho jaata hai.

**3. `role` denormalize hota hai aur har register pe refresh** — isse role-targeted broadcasts fast rehte hain.

**4. Login ke baad register karein** — taaki `role` sahi user pe map ho.

---

## 15. PUT /deviceTokens/unregister

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
| Field | Type | Required | Default |
|---|---|---|---|
| `token` | string | ⚠️ | – |
| `allDevices` | boolean | ⚠️ | `false` |

⚠️ Dono me se **ek dena mandatory** hai (`.or("token", "allDevices")`).

### Success — `200`
```json
{ "success": true, "message": "Device unregistered from push notifications", "data": { "deactivated": 1, "activeDevices": 1 } }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Provide a token, or set allDevices to true.` |

### ⚠️ Notes

**1. Self-scoped** — filter hamesha `userId` carry karta hai, *"so one user cannot silence another's device."*

**2. `deactivated: 0` error nahi hai** — us filter pe koi active row nahi mili.

**3. Logout pe zaruri hai** — `/auth/logout` push ko touch nahi karta.

---

## 16. GET /deviceTokens/get-mine

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Default | Notes |
|---|---|---|---|
| `includeInactive` | boolean\|string | `false` | Retired devices bhi dikhane ke liye |

### Success — `200`
```json
{
  "success": true,
  "message": "Registered devices fetched successfully",
  "data": {
    "devices": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9d001",
        "role": "VENDOR",
        "platform": "WEB",
        "deviceName": "Chrome on MacBook",
        "isActive": true,
        "lastSeenAt": "2026-08-22T12:00:00.000Z",
        "lastPushAt": "2026-08-22T11:30:00.000Z",
        "failureCount": 0,
        "tokenTail": "…APA91bH"
      }
    ],
    "activeDevices": 1,
    "total": 1
  }
}
```

### ⚠️ Notes
**Poora `token` kabhi nahi aata** — sirf `tokenTail` (aakhri 8 chars). *"Enough to identify the row, not enough to send with."*
**Empty pe 404 nahi** — `devices: []`.

---

## 17. POST /deviceTokens/test

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body — dono optional
| Field | Type | Default | Validation |
|---|---|---|---|
| `title` | string | `"Test notification"` | Max 160 |
| `body` | string | `"If you can read this, push notifications are working."` | Max 1000 |

### Success — `200`
```json
{
  "success": true,
  "message": "Test push dispatched",
  "data": { "devices": 2, "sent": 2, "failed": 0, "delivered": true }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Push credentials were rejected by the provider: <reason>` | Server ka FCM setup galat — aapki galti nahi |
| `404` | `You have no active devices registered. Call POST /deviceTokens/register from the app first.` | Pehle register karo |

### ⚠️ Note
**`delivered` flag dekho, `success` nahi.** *"The interesting answer is not 'did the request succeed' but 'did a phone light up', and those are different things."*

---

# Notification Feed APIs

Vendor apne brand ki in-app notifications padhta hai. Vendor `resolveActorBrand` se apne brand tak scoped rehta hai.

## 18. GET /notifications/get-all

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `20` | Integer 1–100 |
| `brandId` | ObjectId | ❌ | token ka brand | **Vendor ke liye optional** — apna brand auto. Dusre brand ka bhejne pe `403` |
| `type` | string | ❌ | – | NOTIFICATION_TYPES enum |
| `isRead` | boolean\|string | ❌ | – | `true` / `false` |

```http
GET /notifications/get-all?isRead=false&limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Notifications fetched successfully",
  "data": {
    "total": 8,
    "unreadCount": 3,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9e001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "type": "SUBSCRIPTION_ACTIVATED",
        "title": "Your PREMIUM plan is active",
        "body": "Valid until 22 Sep 2026. You can now add up to 10 outlets.",
        "severity": "INFO",
        "channels": ["IN_APP", "EMAIL", "PUSH"],
        "isRead": false,
        "deepLink": "/dashboard/subscription",
        "meta": { "subscribedId": "68f1a2b3c4d5e6f7a8b9f001" },
        "createdAt": "2026-08-22T10:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9e002",
        "type": "LIMIT_REACHED",
        "title": "Outlet limit reached",
        "body": "You have used 3 of 3 outlets on your BASIC plan.",
        "severity": "WARNING",
        "channels": ["IN_APP"],
        "isRead": true,
        "createdAt": "2026-08-20T14:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | Dusre brand ka `brandId` |
| `404` | `No brand is linked to your account` | Vendor ka brand nahi |
| `422` | `Invalid brandId` | Format |
| `422` | `type must be one of: SUBSCRIPTION_ACTIVATED, …` | Invalid enum |

### ⚠️ Notes

**1. Vendor ko `brandId` bhejne ki zarurat nahi** — token se resolve hota hai. Bhejna chaho to sirf apna hi chalega.

**2. `unreadCount` badge ke liye ready hai** — alag call ki zarurat nahi.

**3. Admin-only types kabhi nahi dikhte** — `WEBHOOK_FAILED`, `PAYMENT_DISPUTED`, `BRAND_SUBSCRIPTION_LAPSED`, `PROMO_LIMIT_EXCEEDED` sirf admin audience ke hain.

**4. `channels` batata hai kahan-kahan bheja gaya** — `IN_APP` hamesha, baaki tab jab destination ho aur channel enabled ho.

**5. `deepLink` tap pe kahan jaana hai** — client route.

---

## 19. PUT /notifications/mark-read

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `notificationIds` | ObjectId[] | ⚠️ | – | Min 1 item |
| `markAll` | boolean | ⚠️ | `false` | Sab read kar do |
| `brandId` | ObjectId | ❌ | token ka brand | Vendor ke liye optional |

⚠️ **`notificationIds` ya `markAll` — ek dena mandatory hai.**

```json
{ "notificationIds": ["68f1a2b3c4d5e6f7a8b9e001"] }
```
```json
{ "markAll": true }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Notifications marked as read",
  "data": { "modified": 3, "unreadCount": 0 }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Provide notificationIds or set markAll to true.` |
| `422` | `Provide at least one notificationId` |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` |

### ⚠️ Note
Response ka `unreadCount` fresh hai — badge directly update kar sakte hain.

---

## 19a. GET /notifications/preferences 🆕

**Access:** ⚪ **Har role** — Vendor, Sub-vendor, Customer, Admin

Teen channel — email, push, WhatsApp — **ek doosre se independent**. Id token se
aati hai, to ye endpoint kisi aur ko address nahi kar sakta.

### Success — `200`
```jsonc
{
  "success": true,
  "message": "Notification preferences fetched successfully",
  "data": {
    "userId": "68f1a2b3c4d5e6f7a8b9c001",
    "role": "VENDOR",
    "audience": "VENDOR",
    "channels": {
      "email":    { "preference": true,  "effective": true,  "blockedBy": null },
      "push":     { "preference": true,  "effective": true,  "blockedBy": null },
      "whatsapp": { "preference": true,  "effective": false, "blockedBy": "PLATFORM" }
    },
    "updatedBy": null,
    "updatedAt": null
  }
}
```

### ⚠️ `preference` alag hai, `effective` alag

`preference` = vendor ne kya chuna. `effective` = abhi actually kuch jaata hai ya
nahi. Ek platform-wide switch vendor ke choice ko rok sakta hai, aur us haalat me
sirf `preference: true` dikhana panel ka jhooth bolna hota.

Aaj **WhatsApp platform-wide off hai** (Meta template pending), to
`blockedBy: "PLATFORM"` normal case hai. `blockedBy`: `null` · `"PREFERENCE"` ·
`"PLATFORM"`.

### ⚠️ Sub-vendor ka toggle apna alag hai

Brand ke notifications brand ke **owner** ko jaate hain. Outlet manager alag
`User` hai apni toggles ke saath. Owner ki band karne se counter par baitha banda
chup nahi hota.

### ⚠️ In-app feed in teen me nahi hai

Notification **row hamesha** likhi jaati hai — ye toggles sirf bahar jaane wali
delivery tay karte hain.

## 19b. PUT /notifications/preferences 🆕

**Access:** ⚪ Har role — apni hi.

### Body
| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | boolean | ⚠️ | |
| `push` | boolean | ⚠️ | |
| `whatsapp` | boolean | ⚠️ | |

⚠️ **Kam se kam ek** chahiye. **Partial hai** — sirf jo bheja wahi badalta hai.
Poora object bhejne se paanch minute purani screen doosre device ka change palat
degi.

```json
{ "whatsapp": false }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Send at least one of email, push or whatsapp to change.` |

### ⚠️ Chhe notifications band nahi hoti

Wo jinme chup rehna padhne wale ka hi nuksaan hai — jaise `BRAND_DEACTIVATED`,
jismein vendor sign in hi nahi kar sakta, to in-app row uski pahunch se bahar hai
aur email/WhatsApp hi ek raasta bachta hai. Poori list aur rule:
[`docs/notification_preferences.md`](./notification_preferences.md).

⚠️ **OTP ismein nahi aata** — koi apne hi login code ko silence na kar paye.

---

# Onboarding APIs

Vendor onboarding 8 endpoints me hota hai. Har step `user.currentScreen` aage badhata hai — login ke baad wahi field batati hai vendor kahan resume kare.

**Sab pe `isVendor` middleware laga hai** — ye onboarding vendor-only hai, admin bhi nahi kar sakta.

## 20. POST /brands/onboarding/add-basic-details

Business identity. **Ek hi endpoint 3 screens serve karta hai** — `currentScreen` decide karta hai kaunse fields chahiye.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body — `currentScreen` pe depend karta hai

⚠️ **Ye validator strict hai.** Har screen pe sirf uske apne fields allowed hain — dusre screen ka field bhejne pe `Joi.forbidden()` error aayega.

| `currentScreen` | Required | Optional | Baaki fields |
|---|---|---|---|
| `REGISTRATION_STATUS` | `legalBusinessName` (3–120) | `brandName` (2–120) | ❌ forbidden |
| `REGISTRATION_ENTITY_TYPE` | `businessRegistrationStatus` | – | ❌ forbidden |
| `PAN_VERIFICATION` | `businessEntityType` | – | ❌ forbidden |

**Screen 1 — business name:**
```json
{
  "currentScreen": "REGISTRATION_STATUS",
  "legalBusinessName": "Mocha Hospitality Private Limited",
  "brandName": "Cafe Mocha"
}
```

**Screen 2 — registered ya nahi:**
```json
{ "currentScreen": "REGISTRATION_ENTITY_TYPE", "businessRegistrationStatus": "REGISTERED" }
```

**Screen 3 — entity type:**
```json
{ "currentScreen": "PAN_VERIFICATION", "businessEntityType": "PRIVATE_LIMITED" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Basic details updated successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
    "whatsappNumber": "9812345678",
    "currentScreen": "REGISTRATION_ENTITY_TYPE",
    "isActive": true
  }
}
```

> Response me **user** aata hai (brand nahi) — sirf `_id`, `whatsappNumber`, `currentScreen`, `isActive`. Naya `currentScreen` hi aage ka route decide karta hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Current Screen is required` | Missing |
| `422` | `Current screen must be either REGISTRATION_STATUS, REGISTRATION_ENTITY_TYPE or PAN_VERIFICATION` | Galat screen |
| `422` | `Legal Business Name is required` | Screen 1 pe missing |
| `422` | `Legal Business Name must contain at least 3 characters` | Chhota |
| `422` | `Business Registration Status is required` | Screen 2 pe missing |
| `422` | `Business Registration Status must be one of REGISTERED, UNREGISTERED` | Invalid |
| `422` | `Business Entity Type is required` | Screen 3 pe missing |
| `422` | `Business Entity Type must be one of PROPRIETORSHIP, PARTNERSHIP, LLP, …` | Invalid |
| `422` | *(forbidden field)* | Screen ke bahar ka field bheja |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role VENDOR nahi |

### ⚠️ Notes

**1. `currentScreen` yahan "abhi kaunsi screen pe hoon" batata hai.** Response me jo `currentScreen` wapas aata hai wo **agla** step hota hai.

**2. Fields cumulative hain** — har call sirf apne screen ke fields save karta hai, purane overwrite nahi hote.

**3. Screens skip nahi kar sakte** — har screen ke fields alag required hain, sequence follow karna padega.

**4. Edit ke liye alag endpoint hai** — `PUT /brands/onboarding/update-basic-details` (#27), jo sab optional rakhta hai.

---

## 21. POST /brands/onboarding/add-pan-details

Verified PAN details save. **Pehle `verify-pan` (#28) call karein** — uska response yahan bhejna hai.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `pan` | string | ✅ | `/^[A-Z]{5}[0-9]{4}[A-Z]$/`, auto-uppercase |
| `fullName` | string | ✅ | Min 3 chars |
| `verificationResponse` | object | ✅ | **Provider ka poora raw response** |
| `providerTransactionId` | string | ✅ | Provider se |
| `providerRequestId` | string | ✅ | Provider se |
| `isVerified` | boolean | ✅ | |
| `panType` | string | ❌ | PAN_TYPES enum |
| `firstName` · `middleName` · `lastName` | string | ❌ | Min 3 each |
| `dob` | date | ❌ | |
| `gender` | string | ❌ | `MALE` \| `FEMALE` \| `OTHER` |
| `aadhaarNumber` | string | ❌ | `/^\d{4}\s?\d{4}\s?\d{4}$/` |
| `isAadhaarLinked` | boolean | ❌ | |
| `addressDetails` | object | ❌ | `buildingName`, `locality`, `streetName`, `pincode`, `city`, `state`, `country` |
| `chargeable` · `userConsent` | boolean | ❌ | |
| `verificationStatus` | string | ❌ | PRIMARY_VERIFICATION_STATUSES |
| `verificationMessage` | string | ⚠️ | **Required jab status `FAILED`/`REJECTED`** |
| `verificationProvider` | string | ❌ | Default `CGPEY` |
| `verifiedAt` | date | ⚠️ | **Required jab status `SUCCESS`** |
| `currentScreen` | string | ❌ | Default `GST_VERIFICATION` |

```json
{
  "pan": "AABCM1234K",
  "panType": "COMPANY",
  "fullName": "MOCHA HOSPITALITY PRIVATE LIMITED",
  "isVerified": true,
  "verificationStatus": "SUCCESS",
  "verifiedAt": "2026-08-22T12:00:00.000Z",
  "verificationProvider": "CGPEY",
  "providerTransactionId": "cgp_txn_8891",
  "providerRequestId": "cgp_req_4412",
  "verificationResponse": { "…": "provider ka poora raw response" },
  "userConsent": true
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "PAN details added successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9g001",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "pan": "AABCM1234K",
    "panType": "COMPANY",
    "fullName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "isVerified": true,
    "verificationStatus": "SUCCESS",
    "verifiedAt": "2026-08-22T12:00:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `PAN Number is required` / `Please enter a valid PAN Number` |
| `422` | `Full name is required` / `Full name must be at least 3 characters long` |
| `422` | `Verification response date is required` |
| `422` | `Provider transaction ID is required` / `Provider request ID is required` |
| `422` | `Is verified is required` |
| `422` | `Verification message is required when verification status is FAILED or REJECTED` |
| `422` | `Verified at date is required when verification status is SUCCESS` |
| `422` | `PAN type must be one of INDIVIDUAL, COMPANY, FIRM, …` |

### ⚠️ Notes

**1. Ye "save" step hai, "verify" nahi.** Do-step design ka faayda: vendor verify karke result dekh sakta hai, phir confirm karke save.

**2. `verificationResponse` poora raw response hona chahiye** — audit trail ke liye.

**3. `businessEntityType` PAN se cross-check hota hai** system verification (#24) me. Mismatch score girata hai.

**4. Screen aage** → `GST_VERIFICATION`

---

## 22. POST /brands/onboarding/add-gst-details

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `gstNumber` | string | ✅ | `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/` |
| `legalName` | string | ✅ | 3–100 chars |
| `constitutionOfBusiness` | string | ✅ | |
| `taxpayerType` | string | ✅ | GST_TAXPAYER_TYPE enum |
| `registrationDate` | date | ✅ | |
| `registrationStatus` | string | ✅ | GST_REGISTRATION_STATUS enum |
| `address` | object | ✅ | Andar `location`, `district`, `state`, `pin` **required**; baaki optional |
| `verificationResponse` | object | ✅ | Raw provider response |
| `providerTransactionId` · `providerRequestId` | string | ✅ | |
| `isVerified` | boolean | ✅ | |
| `tradeName` | string | ❌ | 3–100 chars |
| `cancellationDate` | date | ❌ | |
| `filingStatus` · `stateCode` · `centerCode` · `stateJurisdiction` · `stateJurisdictionCode` | string | ❌ | |
| `natureOfBusiness` | array | ❌ | |
| `lastUpdated` | date | ❌ | |
| `chargeable` · `userConsent` | boolean | ❌ | |
| `verificationStatus` | string | ❌ | PRIMARY_VERIFICATION_STATUSES |
| `verificationMessage` | string | ⚠️ | Required on `FAILED`/`REJECTED` |
| `verificationProvider` | string | ❌ | Default `CGPEY` |
| `verifiedAt` | date | ⚠️ | Required on `SUCCESS` |
| `currentScreen` | string | ❌ | Default `BANK_VERIFICATION` |

```json
{
  "gstNumber": "23AABCM1234K1ZP",
  "legalName": "MOCHA HOSPITALITY PRIVATE LIMITED",
  "tradeName": "Cafe Mocha",
  "constitutionOfBusiness": "Private Limited Company",
  "taxpayerType": "REGULAR",
  "registrationDate": "2023-04-01",
  "registrationStatus": "SUCCESS",
  "address": {
    "buildingNumber": "4",
    "location": "Scheme 54, Vijay Nagar",
    "city": "Indore",
    "district": "Indore",
    "state": "Madhya Pradesh",
    "pin": "452010",
    "country": "India"
  },
  "isVerified": true,
  "verificationStatus": "SUCCESS",
  "verifiedAt": "2026-08-22T12:05:00.000Z",
  "providerTransactionId": "cgp_txn_8892",
  "providerRequestId": "cgp_req_4413",
  "verificationResponse": { "…": "raw" }
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "GST details added successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9g002",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "gstNumber": "23AABCM1234K1ZP",
    "legalName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "taxpayerType": "REGULAR",
    "registrationStatus": "SUCCESS",
    "isVerified": true
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `GST number is required` / `Please enter a valid GSTIN` |
| `422` | `Legal name is required` / `Legal name must be at least 3 characters long` |
| `422` | `Constitution of business is required` |
| `422` | `GST taxpayerType must be one of REGULAR, COMPOSITION, …` |
| `422` | `GST registration status must be one of SUCCESS, CANCELLED, …` |
| `422` | `Registration date is required` |
| `422` | *(address sub-field errors)* — `location`, `district`, `state`, `pin` required |

### ⚠️ Notes

**1. PAN GST me embedded hota hai** — GSTIN ke characters 3–12. System verification isko check karta hai (`panEmbeddedInGST` flag).

**2. `registrationStatus` matter karta hai** — `CANCELLED`/`SUSPENDED`/`INACTIVE` score girate hain (`gstActive` flag).

**3. Screen aage** → `BANK_VERIFICATION`

---

## 23. POST /brands/onboarding/add-bank-details

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `isValid` | boolean | ✅ | Provider ka verdict |
| `recommendedAction` | string | ✅ | Provider se |
| `accountHolderName` | string | ✅ | 3–100 chars |
| `accountNumber` | string | ✅ | `/^\d{9,18}$/` |
| `ifscCode` | string | ✅ | `/^[A-Z]{4}0[A-Z0-9]{6}$/`, auto-uppercase |
| `verificationResponse` | object | ✅ | Raw provider response |
| `providerTransactionId` · `providerRequestId` | string | ✅ | |
| `isVerified` | boolean | ✅ | |
| `bankName` · `branchName` | string | ❌ | |
| `bankAddress` | object | ❌ | |
| `accountType` | string | ❌ | BANK_ACCOUNT_TYPES enum |
| `isNameMatch` | boolean | ❌ | |
| `matchingScore` | string | ❌ | |
| `paymentMode` · `retrievalReferenceNumber` | string | ❌ | |
| `failureReason` · `npciErrorCode` | string | ❌ | |
| `user` | object | ❌ | |
| `chargeable` · `userConsent` | boolean | ❌ | |
| `verificationStatus` | string | ❌ | PRIMARY_VERIFICATION_STATUSES |
| `verificationMessage` | string | ⚠️ | Required on `FAILED`/`REJECTED` |
| `verificationProvider` | string | ❌ | Default `CGPEY` |
| `verifiedAt` | date | ⚠️ | Required on `SUCCESS` |
| `currentScreen` | string | ❌ | Default `SYSTEM_VERIFICATION` |

```json
{
  "isValid": true,
  "recommendedAction": "ACCEPT",
  "accountHolderName": "MOCHA HOSPITALITY PRIVATE LIMITED",
  "accountNumber": "912010012345678",
  "ifscCode": "UTIB0001234",
  "bankName": "Axis Bank",
  "branchName": "Vijay Nagar, Indore",
  "accountType": "CURRENT",
  "isNameMatch": true,
  "matchingScore": "98",
  "isVerified": true,
  "verificationStatus": "SUCCESS",
  "verifiedAt": "2026-08-22T12:10:00.000Z",
  "providerTransactionId": "cgp_txn_8893",
  "providerRequestId": "cgp_req_4414",
  "verificationResponse": { "…": "raw" }
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Bank details added successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9g003",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "accountHolderName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "accountNumber": "912010012345678",
    "ifscCode": "UTIB0001234",
    "accountType": "CURRENT",
    "isNameMatch": true,
    "isVerified": true
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Account number is required` / `Please enter a valid account number!` |
| `422` | `IFSC code is required` / `Please enter a valid IFSC code` |
| `422` | `Account holder name is required` / `Account holder name has minimum 3 characters` |
| `422` | `Bank account type must be one of SAVINGS, CURRENT, …` |

### ⚠️ Notes

**1. `isNameMatch` aur `matchingScore` scoring me jaate hain** — account holder ka naam PAN/GST/brand se match hona chahiye (`bankMatched` flag).

**2. Screen aage** → `SYSTEM_VERIFICATION`

---

## 24. GET /brands/onboarding/system-verify

Automatic cross-verification. PAN + GST + Bank + brand details aapas me match karke score deta hai.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Params
Koi nahi — brand token se resolve hota hai.

### Scoring

| Score | Status | Matlab |
|---:|---|---|
| ≥ 90 | `APPROVED` | Auto-approve, `verifiedAt` set |
| ≥ 75 | `MANUAL_REVIEW` | Admin dekhega |
| < 75 | `REJECTED` | Vendor theek karke resubmit kare |

### Success — `200`
```json
{
  "success": true,
  "message": "Brand's vendor verified successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9h001",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "score": 94,
    "status": "APPROVED",
    "verifiedAt": "2026-08-22T12:15:00.000Z",
    "flags": {
      "panVerified": true,
      "gstVerified": true,
      "bankVerified": true,
      "panMatchedWithGST": true,
      "panMatchedWithBrand": true,
      "gstMatchedWithBrand": true,
      "bankMatched": true,
      "businessEntityMatched": true,
      "gstActive": true,
      "panEmbeddedInGST": true,
      "duplicatePAN": false,
      "duplicateGST": false,
      "duplicateBank": false,
      "duplicateWhatsapp": false,
      "duplicateEmail": false
    },
    "nameMatch": { "panGstScore": 100, "panBrandScore": 92, "gstBrandScore": 95, "averageScore": 95.6 },
    "bankNameMatch": { "bankPanScore": 100, "bankGstScore": 98, "bankBrandScore": 91, "highestScore": 100 },
    "duplicateDetails": { "panBrandIds": [], "gstBrandIds": [], "bankBrandIds": [], "whatsappBrandIds": [], "emailBrandIds": [] },
    "remarks": "All checks passed",
    "createdAt": "2026-08-22T12:15:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | Brand missing |
| `400`/`422` | *(missing KYC)* | PAN / GST / Bank save nahi hue |

### ⚠️ Notes

**1. Ye `GET` hai par write karta hai** — naya `SystemVerify` doc banata hai. Idempotent **nahi** hai; har call naya attempt banata hai. (REST-wise `POST` hona chahiye tha.)

**2. Purana attempt supersede ho jaata hai** — pehla `SystemVerify` `REJECTED` mark hota hai, naya current banta hai. Timeline `/brands/verifications/history` (#33) me rehti hai.

**3. `duplicateDetails` batata hai kaunse doosre brands ne wahi PAN/GST/bank/number/email use kiya.**

**4. Rejection ke baad resubmit:** vendor sections edit karke yahi endpoint dobara call karta hai. History me `RESUBMITTED` record hoti hai.

**5. Screen aage** → `PARTNERSHIP_DEED`

> 📖 **Full detail** — scoring table, state machine, har flag ka weightage, admin review flow → **[brand_verification_api_doc.md](./brand_verification_api_doc.md)** (Section 1)

---

## 25. PUT /brands/onboarding/accept-partnership

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Partnership Deed accepted!",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "hasAcceptedPartnershipDeed": true,
    "currentScreen": "SUBSCRIBE_PLAN"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand not found!` |
| `403` | `Forbidden: You do not have permission to perform this action.` |

### ⚠️ Notes
**1. `brand.hasAcceptedPartnershipDeed: true` set hota hai.**
**2. Screen aage** → `SUBSCRIBE_PLAN` — ab plan choose karna hai.

---

## 26. PUT /brands/onboarding/acknowledge-approval

Admin approve karne ke baad vendor congratulations screen dismiss karta hai.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Welcome aboard! Redirecting you to your dashboard.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "currentScreen": "DASHBOARD",
    "acknowledgedAt": "2026-08-22T14:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | |
| `400` | *(not approved)* | Brand abhi approve hi nahi hua |

### ⚠️ Notes
**1. Screen aage** → `DASHBOARD`. Onboarding ka aakhri step.
**2. History me `APPROVAL_ACKNOWLEDGED` record hoti hai.**
**3. Sirf approved brand pe kaam karta hai.**

> 📖 Full detail → [brand_verification_api_doc.md](./brand_verification_api_doc.md) (Section 4)

---

## 27. PUT /brands/onboarding/update-basic-details

Onboarding fields edit — review/remediation ke liye. Same controller as #20, par validator **loose**.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `currentScreen` | string | **Koi bhi** SCREENS value (#20 sirf 3 allow karta hai) |
| `brandName` | string | 2–120 chars |
| `legalBusinessName` | string | 3–120 chars |
| `businessRegistrationStatus` | string | BUSINESS_REGISTRATION_STATUS |
| `businessEntityType` | string | BUSINESS_ENTITY_TYPE |

```json
{ "legalBusinessName": "Mocha Hospitality Pvt Ltd", "businessEntityType": "PRIVATE_LIMITED" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Basic details updated successfully.",
  "data": { "_id": "...", "currentScreen": "SYSTEM_VERIFICATION", "isActive": true }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Current screen must be one of BUSINESS_NAME, REGISTRATION_STATUS, …` |
| `422` | `Brand Name must contain at least 2 characters` |
| `422` | `Legal Business Name must contain at least 3 characters` |
| `422` | `Business Entity Type must be one of PROPRIETORSHIP, …` |

### ⚠️ Notes

**1. #20 se difference:** wo screen-scoped + strict, ye sab optional. Isliye ye **edit/remediation** ke liye hai.

**2. Rejection ke baad ka flow:** admin reject → vendor yahan fields theek kare → `system-verify` (#24) dobara → naya attempt. History me `REMEDIATION_UPDATED`.

> 📖 Poora remediation design → [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md)

---

# KYC Verification APIs

Live verification — CGPey provider se. **Ye sirf verify karte hain, save nahi.** Result lekar `add-*-details` endpoints pe bhejna hota hai.

Sab pe `isVendor` middleware.

## 28. POST /verification/brands/onboarding/verify-pan

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `pan` | string | ✅ | `/^[A-Z]{5}[0-9]{4}[A-Z]$/`, auto-uppercase + trim |

```json
{ "pan": "AABCM1234K" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "PAN verified successfully",
  "data": {
    "pan": "AABCM1234K",
    "fullName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "panType": "COMPANY",
    "isValid": true,
    "isAadhaarLinked": true,
    "providerTransactionId": "cgp_txn_8891",
    "providerRequestId": "cgp_req_4412",
    "verificationResponse": { "…": "provider ka raw response" }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `PAN Number is required` | Missing |
| `422` | `Please enter a valid PAN Number` | Pattern fail |
| `400`/`422` | *(provider ka message)* | PAN invalid ya provider ne reject kiya |
| `500` | *(provider error)* | CGPey down / credentials issue |

### ⚠️ Notes

**1. Ye save nahi karta.** Response `add-pan-details` (#21) pe bhejna hoga.

**2. Chargeable ho sakta hai** — har call provider ko paisa lagata hai. Retry loop mat banayein; user explicitly "Verify" dabaye.

**3. `verificationResponse` poora save karein** — #21 pe mandatory hai.

---

## 29. POST /verification/brands/onboarding/verify-gst

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `gstNumber` | string | ✅ | `/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/` |

```json
{ "gstNumber": "23AABCM1234K1ZP" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "GST verified successfully",
  "data": {
    "gstNumber": "23AABCM1234K1ZP",
    "legalName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "tradeName": "Cafe Mocha",
    "constitutionOfBusiness": "Private Limited Company",
    "taxpayerType": "REGULAR",
    "registrationStatus": "SUCCESS",
    "registrationDate": "2023-04-01",
    "address": {
      "buildingNumber": "4",
      "location": "Scheme 54, Vijay Nagar",
      "city": "Indore",
      "district": "Indore",
      "state": "Madhya Pradesh",
      "pin": "452010"
    },
    "natureOfBusiness": ["Retail Business", "Service Provision"],
    "providerTransactionId": "cgp_txn_8892",
    "providerRequestId": "cgp_req_4413",
    "verificationResponse": { "…": "raw" }
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `GST number is required` / `Please enter a valid GSTIN` |
| `400`/`422` | *(provider ka message)* — GSTIN not found / cancelled |
| `500` | *(provider error)* |

### ⚠️ Note
Provider ka `constitutionOfBusiness` string `BUSINESS_ENTITY_TYPE` enum pe map hota hai (`GST_TO_BRAND_ENTITY_MAP`) — jaise `"Private Limited Company"` → `PRIVATE_LIMITED`. Ye mapping system verification me entity match check karti hai.

---

## 30. POST /verification/brands/onboarding/verify-bank

Penny-drop verification.

**Access:** Intended: VENDOR · Enforced: **VENDOR**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `accountNumber` | string | ✅ | `/^\d{9,18}$/` |
| `ifscCode` | string | ✅ | `/^[A-Z]{4}0[A-Z0-9]{6}$/`, auto-uppercase |
| `beneficiaryName` | string | ❌ | 3–100 chars — name-match score ke liye |

```json
{
  "accountNumber": "912010012345678",
  "ifscCode": "UTIB0001234",
  "beneficiaryName": "MOCHA HOSPITALITY PRIVATE LIMITED"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Bank account verified successfully",
  "data": {
    "isValid": true,
    "recommendedAction": "ACCEPT",
    "accountHolderName": "MOCHA HOSPITALITY PRIVATE LIMITED",
    "accountNumber": "912010012345678",
    "ifscCode": "UTIB0001234",
    "bankName": "Axis Bank",
    "branchName": "Vijay Nagar, Indore",
    "isNameMatch": true,
    "matchingScore": "98",
    "paymentMode": "IMPS",
    "retrievalReferenceNumber": "523412998877",
    "providerTransactionId": "cgp_txn_8893",
    "providerRequestId": "cgp_req_4414",
    "verificationResponse": { "…": "raw" }
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Account number is required` / `Please enter a valid account number!` |
| `422` | `IFSC code is required` / `Please enter a valid IFSC code` |
| `422` | `Beneficiary name has minimum 3 characters` |
| `400`/`422` | *(provider ka message)* — account invalid / NPCI error |
| `500` | *(provider error)* |

### ⚠️ Notes

**1. `beneficiaryName` bhejein** — usi se `isNameMatch` aur `matchingScore` aate hain, jo `bankMatched` flag me jaate hain.

**2. Penny-drop real transaction hai** — provider account me ₹1 bhejta hai. Retry mahenga hai.

**3. `recommendedAction` provider ka verdict hai** — `ACCEPT`/`REJECT`. Ise #23 pe as-is bhejein.

---

# Brand APIs

## 31. GET /brands/get

Brand ka poora detail — 14 lookups ke saath.

**Access:** Intended: All roles · Enforced: **VENDOR+ADMIN** ⚠️

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ❌ | **Vendor ke liye optional** — na do to token ka brand |

```http
GET /brands/get
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand details fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
    "brandName": "cafe mocha",
    "legalBusinessName": "mocha hospitality private limited",
    "description": "artisanal coffee and continental bites",
    "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
    "email": "hello@cafemocha.in",
    "whatsappNumber": "9812345678",
    "uniqueId": "TDB000078",
    "merchantId": "TDM000078",
    "businessRegistrationStatus": "REGISTERED",
    "businessEntityType": "PRIVATE_LIMITED",
    "status": "PENDING",
    "isApproved": false,
    "isSubscribed": true,
    "hasAcceptedPartnershipDeed": true,
    "followersCount": 1240,
    "avoidanceCount": 12,
    "joinedDate": "2026-03-15T00:00:00.000Z",
    "subBrandsLimit": 10,
    "subBrandsUsed": 3,
    "isActive": true,
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
    "user": { "_id": "…", "role": "VENDOR", "name": "rahul sharma" },
    "pan": { "pan": "AABCM1234K", "isVerified": true },
    "gst": { "gstNumber": "23AABCM1234K1ZP", "isVerified": true },
    "bank": { "accountNumber": "912010012345678", "ifscCode": "UTIB0001234" },
    "systemVerify": { "score": 94, "status": "APPROVED" },
    "subscribed": { "status": "ACTIVE", "endDate": "2026-09-22T00:00:00.000Z" },
    "category": { "name": "food & beverages" },
    "subCategory": { "name": "cafe" },
    "location": { "formattedAddress": "…", "geo": {} },
    "workHours": { "monday": {}, "tuesday": {} },
    "firstSubBrand": { "_id": "…", "storeId": "MOCHA-VN-01", "uniqueId": "TDS000201", "user": {}, "location": {}, "workHours": {} },
    "createdAt": "2026-03-15T00:00:00.000Z",
    "updatedAt": "2026-08-22T14:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid brand ID` | Galat format, ya token me brandId nahi |
| `404` | *(empty)* | Brand nahi mila |
| `422` | `Invalid brandId` | Joi format check |

### ⚠️ Notes

**1. Vendor ke liye ye "my brand" endpoint hai** — `brandId` skip karo.

**2. Vendor ko apna PAN/GST/Bank dikhna sahi hai.** ⚠️ Problem: **customer ko bhi yahi data milta hai** ([Appendix B](#appendix-b--known-issues)). Backend fix chahiye, vendor panel ko kuch nahi karna.

**3. ✅ Approval fields brand pe hi mil jaate hain.** `status` (`SYSTEM_VERIFICATION_STATUS`), `isApproved`, `isReviewed`, `isRejected`, `isRevoked`, `rejectionReason`, `revokeReason`, `isApprovalAcknowledged` — sab `reviewBrandVerification` (admin review) aur `acknowledgeBrandApproval` se maintain hote hain. Vendor panel inhi se approval banner/state decide kar sakta hai; `systemverifies[0]` sirf score aur flags ke liye chahiye.

**4. `subBrandsLimit` / `subBrandsUsed` plan ka outlet pool batate hain** — dashboard pe "3 of 10 outlets used".

**5. Response bhaari hai** — dashboard pe ek baar call karke cache karein.

**6. Lookup fields singular objects hain, arrays nahi** — `buildAggregateLookup` default se `$unwind` karta hai. Naam collection ka nahi, lookup ke `as` ka hai: `pan`, `gst`, `bank`, `location`, `workHours`, `category`, `subCategory`, `systemVerify`, `subscribed`, `firstSubBrand`.

---

## 32. PUT /brands/update

Brand ki public profile update.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ❌ | Vendor ke liye optional — token se |

### Body — sab optional
| Field | Type | Validation | Notes |
|---|---|---|---|
| `brandName` | string | 2–150 chars | Lowercase me store |
| `email` | string | Valid email | |
| `description` | string | – | |
| `joinedDate` | date | – | |
| `isActive` | boolean\|string | – | |
| `isOnboarding` | boolean | Default `false` | ⚠️ `true` pe `subCategoryId` **required** ho jaata hai |
| `subCategoryId` | ObjectId | – | `isOnboarding: true` pe required |
| `logo` | file | – | **Multipart only**, field name `logo` |

```json
{ "brandName": "Cafe Mocha", "description": "Artisanal coffee and continental bites", "email": "hello@cafemocha.in" }
```

**Onboarding pe category set karna:**
```json
{ "isOnboarding": true, "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand details updated successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
    "brandName": "cafe mocha",
    "description": "artisanal coffee and continental bites",
    "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo-v2.jpg",
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
    "updatedAt": "2026-08-22T14:10:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | |
| `404` | `User not found!` | Brand ka owner user missing |
| `422` | `Brand name must be at least 2 characters` / `Brand name cannot exceed 150 characters` | |
| `422` | `Please enter a valid email address` | |
| `422` | `Sub-category ID is required during onboarding` | `isOnboarding: true` par `subCategoryId` nahi |
| `422` | `Invalid Sub-category ID format` | |
| `500` | *(upload error)* | Cloudinary fail |

### ⚠️ Notes

**1. `subCategoryId` set karne se `categoryId` bhi auto-set hota hai** — service parent category resolve karta hai.

**2. Logo replace hone pe purana Cloudinary se delete** — transactional, fail pe rollback.

**3. `brandName` lowercase me store** — display pe capitalize karein.

**4. ⚠️ Role gate missing** — customer bhi call kar sakta hai ([Appendix B](#appendix-b--known-issues)).

---

## 33. GET /brands/verifications/history

Brand ke verification lifecycle ka audit trail.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** ⚠️
**Scoping:** Vendor service-level pe apne brand tak scoped hai

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `brandId` | ObjectId | ❌ | – | **Vendor ke liye ignore hota hai** |
| `systemVerifyId` | ObjectId | ❌ | – | Ek attempt ki history |
| `performedBy` | ObjectId | ❌ | – | Kis user ne kiya |
| `action` | string | ❌ | – | BRAND_VERIFICATION_ACTION enum |
| `performedByType` | string | ❌ | – | `SYSTEM` \| `ADMIN` \| `VENDOR` |
| `attemptNumber` | number | ❌ | – | Integer ≥ 1 |
| `search` | string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | `toDate` >= `fromDate` |
| `sortOrder` | string | ❌ | `DESC` | `ASC` \| `DESC` (uppercase) |

### Success — `200`
```json
{
  "success": true,
  "message": "Brand verification history fetched successfully.",
  "data": {
    "total": 5,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9i001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "systemVerifyId": "68f1a2b3c4d5e6f7a8b9h001",
        "action": "APPROVED",
        "performedByType": "ADMIN",
        "performedBy": { "_id": "…", "name": "admin user", "role": "ADMIN" },
        "attemptNumber": 2,
        "score": 94,
        "note": "Documents verified, all good",
        "createdAt": "2026-08-22T13:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9i002",
        "action": "RESUBMITTED",
        "performedByType": "VENDOR",
        "attemptNumber": 2,
        "score": 94,
        "createdAt": "2026-08-22T12:15:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9i003",
        "action": "REJECTED",
        "performedByType": "ADMIN",
        "attemptNumber": 1,
        "score": 68,
        "rejectionReason": "Bank account holder name does not match the PAN",
        "createdAt": "2026-08-21T10:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Brand not found for user.` | Vendor ke paas brand nahi |
| `422` | `Invalid Brand ID format` | |
| `422` | `Action must be one of SYSTEM_VERIFIED, RESUBMITTED, …` | Invalid enum |
| `422` | `To date cannot be earlier than from date` | |
| `422` | `Limit cannot exceed 100` | |

### ⚠️ Notes

**1. Vendor ke liye `brandId` bekaar hai** — validator comment: *"Ignored for vendors — the service always scopes them to their own brand."*

**2. Har event naya row hai** — re-rejection purana overwrite nahi karti, poora timeline milta hai.

**3. Rejection reason yahin se milta hai** — `action: "REJECTED"` row ka `rejectionReason`. Vendor ko yahi dikhana hai.

**4. `attemptNumber` batata hai kaunsa attempt tha** — resubmit pe badhta hai.

**5. ⚠️ Customer ko bhi khula hai** — security finding #13 ([Appendix B](#appendix-b--known-issues)).

> 📖 Full detail → [brand_verification_api_doc.md](./brand_verification_api_doc.md) (Section 5)

---

# Outlet / Sub-Brand APIs

Outlets (aur franchises) brand ke physical stores hain. Har outlet ka apna `SUB_VENDOR` user account banta hai.

⚠️ **Ye plan ke limits se metered hain** — `OUTLET` aur `FRANCHISE` **alag-alag pools** se kharchte hain.

## 34. POST /subBrands/signUp-with-whatsapp

Naya outlet register karta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | ⚠️ Validator me **required** hai, chahe vendor ho. Vendor apna hi bhej sakta hai |
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `isFirstOutlet` | boolean\|string | ❌ | `false` | Onboarding ka pehla outlet — `brand.firstSubBrandId` set hota hai |
| `outletType` | string | ❌ | `OUTLET` | `OUTLET` \| `FRANCHISE` — **kaunsa plan pool kharcha hoga** |

```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "whatsappNumber": "9823456789",
  "isFirstOutlet": true,
  "outletType": "OUTLET"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "OTP sent to subBrand whatsapp number successfully.",
  "data": {
    "user": {
      "_id": "68f1a2b3c4d5e6f7a8b9j001",
      "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
      "role": "SUB_VENDOR",
      "whatsappNumber": "9823456789",
      "uniqueId": "TDU000201",
      "referralCode": "OUTLET7K2X",
      "isActive": true
    },
    "subBrand": {
      "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
      "userId": "68f1a2b3c4d5e6f7a8b9j001",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "outletType": "OUTLET",
      "whatsappNumber": "9823456789",
      "uniqueId": "TDS000201",
      "storeId": "MOCHA-VN-01",
      "joinedDate": "2026-08-22T14:30:00.000Z",
      "isActive": true
    },
    "usage": {
      "subBrands": { "used": 3, "limit": 10, "isUnlimited": false },
      "franchises": { "used": 0, "limit": 2, "isUnlimited": false }
    }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Outlet/Sub-Brand is already registered with this number` | Wo number kisi aur outlet pe hai |
| `403` | `Access denied. This feature requires an active subscription. Please subscribe to continue.` | Koi active plan nahi |
| `403` | `Your current plan does not include outlets. Please upgrade your subscription to add outlets.` | Plan me outlet pool hai hi nahi (`limit: 0`) |
| `403` | `Outlet/Sub-brand limit reached — 10 of 10 used on your current plan. Please upgrade your subscription to add more.` | Pool khatam |
| `403` | `Your current plan does not include franchises. …` | `outletType: "FRANCHISE"` par franchise pool nahi |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | Dusre brand ka `brandId` |
| `404` | `Brand not found!` | |
| `422` | `Brand ID is required` / `Invalid Brand ID format` | |
| `422` | `Please enter a valid 10 digit WhatsApp number` | |
| `422` | `outletType must be one of: FRANCHISE, OUTLET` | |

### ⚠️ Edge cases & notes

**1. Order matter karta hai — errors isi order me aayenge:**
```
1. Ownership check       → resolveActorBrand
2. Duplicate number      → 403 "already registered"
3. Subscription gate     → 403 "requires an active subscription"
4. Slot reservation      → 403 "limit reached"
5. Actual creation
```
Service ka comment: *"Gate first, so a vendor with no plan gets 'subscribe to continue' rather than a limit message about a plan they do not have."*

**2. Slot reservation atomic hai.** `reserveOutletSlot` ek **conditional increment** hai — limit test aur increment ek hi operation me. Do concurrent signups dono pass nahi kar sakte (read-then-write check se ye guarantee nahi milti).

**3. Failure pe slot wapas mil jaata hai.** Agar OTP bhejne me ya DB me error aaye, to reserved slot release ho jaata hai aur adhoore `User`/`SubBrand` docs delete ho jaate hain. Comment: *"otherwise a transient OTP or DB failure silently costs the vendor one outlet from their plan."*

**4. `usage` response me aata hai** — dashboard ka counter turant update kar sakte hain, alag call ki zarurat nahi. `limit: null` matlab unlimited.

**5. Outlet user ka koi password nahi hota** — wo OTP se login karta hai. ✅ Ye pehle ka shared-default-password issue fix ho chuka hai.

**6. ⚠️ `SUB_VENDOR` accounts abhi kisi route pe kaam nahi karte.** Account ban jaata hai, OTP bhi jaata hai, par login karke wo kuch nahi kar sakta — koi route `SUB_VENDOR` role handle nahi karta. Outlet management abhi vendor ke through hi hoti hai.

**7. `storeId` auto-generate hota hai** — brand ke naam se derive hota hai (jaise `MOCHA-VN-01`).

**8. Outlet banane ke baad** uski location (`POST /locations/create` with `isSubBrandAddress: true`) aur work hours (`POST /workHours/upsert` with `subBrandId`) set karni chahiye.

---

## 35. GET /subBrands/get-all

Outlets ki paginated list.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | |
| `brandId` | ObjectId | ⚠️ | – | **Vendor ko apna bhejna chahiye** — warna sabke outlets aa jayenge (role gate missing hai) |
| `userId` · `locationId` · `workHoursId` | ObjectId | ❌ | – | |
| `outletType` | string | ❌ | – | `OUTLET` \| `FRANCHISE` |
| `email` · `mobile` · `whatsappNumber` | string | ❌ | – | |
| `uniqueId` · `storeId` | string | ❌ | – | |
| `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | `joinedDate` \| `createdAt` \| `updatedAt` \| `outletType` \| `isActive` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /subBrands/get-all?brandId=68f1a2b3c4d5e6f7a8b9c3a1&isActive=true&limit=50
```

### Success — `200`
```json
{
  "success": true,
  "message": "Outlets/Sub-Brands fetched successfully",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 50,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
        "userId": "68f1a2b3c4d5e6f7a8b9j001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "locationId": "68f1a2b3c4d5e6f7a8b9c4b1",
        "workHoursId": "68f1a2b3c4d5e6f7a8b9c4c1",
        "outletType": "OUTLET",
        "storeId": "MOCHA-VN-01",
        "uniqueId": "TDS000201",
        "whatsappNumber": "9823456789",
        "email": "vijaynagar@cafemocha.in",
        "description": "vijay nagar outlet",
        "joinedDate": "2026-08-22T14:30:00.000Z",
        "isActive": true,
        "createdAt": "2026-08-22T14:30:00.000Z",
        "updatedAt": "2026-08-22T14:30:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subbrand found` | ⚠️ Koi outlet nahi — **empty-state dikhayein** |
| `422` | `Invalid Brand ID format` | |
| `422` | `Limit cannot exceed 100` | |
| `422` | `Outlet type can't be empty` | |

### ⚠️ Notes

**1. ⚠️ Ye endpoint scoped nahi hai.** Route pe sirf `verifyJwtToken` hai aur service `brandId` ko token se resolve nahi karti — jo query me aaye wahi filter hota hai. **Vendor panel ko `brandId` explicitly bhejna chahiye**, warna platform ke saare outlets aa jayenge. Ye security finding #1 ka hissa hai ([Appendix B](#appendix-b--known-issues)).

**2. Empty pe 404 aata hai** — error nahi, empty-state.

**3. `locationId` / `workHoursId` `null` ho sakte hain** — naya outlet jiski address/timings set nahi hui.

---

## 36. PUT /subBrands/update/:subBrandId

Outlet details update.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Path Params
| Param | Type | Required |
|---|---|---|
| `subBrandId` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation | Notes |
|---|---|---|---|
| `email` | string | Valid email | |
| `outletType` | string | `OUTLET` \| `FRANCHISE` | ⚠️ Change karne pe **naya pool kharcha hoga** — subscription gate lagta hai |
| `joinedDate` | date | – | |
| `description` | string | – | |
| `isActive` | boolean | – | ⚠️ **Sirf tab apply hota hai jab explicitly bhejo** |

```json
{ "description": "Vijay Nagar flagship outlet", "email": "vn@cafemocha.in" }
```

**Type change:**
```json
{ "outletType": "FRANCHISE" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Outlet/Sub-Brand updated successfully.",
  "data": {
    "subBrand": {
      "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
      "outletType": "OUTLET",
      "storeId": "MOCHA-VN-01",
      "description": "Vijay Nagar flagship outlet",
      "email": "vn@cafemocha.in",
      "isActive": true,
      "updatedAt": "2026-08-22T15:00:00.000Z"
    },
    "outletTypeChanged": false,
    "usage": {
      "subBrands": { "used": 3, "limit": 10, "isUnlimited": false },
      "franchises": { "used": 0, "limit": 2, "isUnlimited": false }
    }
  }
}
```

### Success — `200` (type change)
```json
{
  "success": true,
  "message": "Outlet/Sub-Brand updated and outlet type switched successfully.",
  "data": {
    "subBrand": { "outletType": "FRANCHISE" },
    "outletTypeChanged": true,
    "usage": {
      "subBrands": { "used": 2, "limit": 10, "isUnlimited": false },
      "franchises": { "used": 1, "limit": 2, "isUnlimited": false }
    }
  }
}
```

> Message aur `outletTypeChanged` flag dono badalte hain.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Outlet/Sub-Brand not found!` | |
| `404` | `Brand not found!` | Outlet ka parent brand missing |
| `403` | `Forbidden: You do not have permission to update this outlet.` | Dusre brand ka outlet |
| `403` | `Access denied. This feature requires an active subscription. …` | Type change par plan nahi |
| `403` | `Franchise limit reached — 2 of 2 used on your current plan. …` | Target pool full |
| `422` | `Invalid Brand ID format` | `subBrandId` galat (message me "Brand" likha hai — validator ka copy-paste) |

### ⚠️ Notes

**1. `isActive` ka silent default hata diya gaya hai.** Validator ka comment: *"No `.default(true)` — it used to silently reactivate a deactivated outlet on any update that simply did not mention isActive."* Ab deactivated outlet accidentally reactivate nahi hoga.

**2. Type change do pools ko touch karta hai** — purane se slot release, naye me reserve. Save fail ho to dono revert ho jaate hain: *"Undo the counter movement so the pools do not drift from reality."*

**3. Type change pe subscription gate lagta hai** — kyunki wo naya slot kharchta hai. Sirf description edit karne pe nahi lagta.

**4. Ownership check yahan explicit hai** — `resolveActorBrand` nahi, par same logic: admin koi bhi outlet, vendor sirf apne brand ka.

**5. `422` message me "Brand ID" likha aata hai** jabki param `subBrandId` hai — validator me copy-paste rah gaya hai. Cosmetic issue.

---

# Work Hours APIs

## 37. POST /workHours/upsert

Brand ya outlet ke weekly timings set karta hai. Upsert hai — dobara call karne pe update hota hai.

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN** ⚠️

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | Brand-level timings ke liye |
| `subBrandId` | ObjectId | ⚠️ | Outlet-level timings ke liye |
| `monday` … `sunday` | object | ⚠️ | Din ka schedule — kam se kam **ek din** chahiye |

⚠️ **`brandId` ya `subBrandId` — exactly ek dena hai.** Dono ya koi nahi = error.

**Din ka object:**
| Field | Type | Required | Validation |
|---|---|---|---|
| `isOpen` | boolean | ❌ (default `false`) | |
| `start` | string | ⚠️ **`isOpen: true` pe required** | `HH:mm` 24-hour (`/^([01]\d\|2[0-3]):([0-5]\d)$/`) |
| `end` | string | ⚠️ **`isOpen: true` pe required** | `HH:mm`, aur `start` se **baad** hona chahiye |

```json
{
  "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
  "monday":    { "isOpen": true,  "start": "09:00", "end": "23:00" },
  "tuesday":   { "isOpen": true,  "start": "09:00", "end": "23:00" },
  "wednesday": { "isOpen": true,  "start": "09:00", "end": "23:00" },
  "thursday":  { "isOpen": true,  "start": "09:00", "end": "23:00" },
  "friday":    { "isOpen": true,  "start": "09:00", "end": "23:59" },
  "saturday":  { "isOpen": true,  "start": "10:00", "end": "23:59" },
  "sunday":    { "isOpen": false }
}
```

### Success — `201` *(note: 201, not 200)*
```json
{
  "success": true,
  "message": "WorkHours upserted successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c4c1",
    "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
    "brandId": null,
    "monday":    { "isOpen": true,  "start": "09:00", "end": "23:00" },
    "tuesday":   { "isOpen": true,  "start": "09:00", "end": "23:00" },
    "wednesday": { "isOpen": true,  "start": "09:00", "end": "23:00" },
    "thursday":  { "isOpen": true,  "start": "09:00", "end": "23:00" },
    "friday":    { "isOpen": true,  "start": "09:00", "end": "23:59" },
    "saturday":  { "isOpen": true,  "start": "10:00", "end": "23:59" },
    "sunday":    { "isOpen": false, "start": null,    "end": null },
    "isActive": true,
    "createdAt": "2026-08-22T15:10:00.000Z",
    "updatedAt": "2026-08-22T15:10:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Either brandId or subBrandId is required` | Dono missing |
| `422` | `Provide either brandId or subBrandId, not both` | Dono diye |
| `422` | `At least one working day is required` | Koi din nahi bheja |
| `422` | `Start time must be in HH:mm format` | Galat format |
| `422` | `End time must be in HH:mm format` | |
| `422` | `Start time is required when the day is open` | `isOpen: true` par `start` nahi |
| `422` | `End time is required when the day is open` | |
| `422` | `Start time must be earlier than end time` | `start >= end` |
| `422` | `Invalid brandId format` / `Invalid subBrandId format` | |
| `404` | `Brand not found` / `SubBrand not found` | |

### ⚠️ Notes

**1. Partial update possible hai** — sirf jo din bhejo wahi update hote hain, baaki waise hi rehte hain. Poora hafta bhejna zaruri nahi.

**2. Bandh din ke liye sirf `isOpen: false` kaafi hai** — `start`/`end` optional ho jaate hain (`null`/`""` bhi allowed).

**3. Time 24-hour format me hai.** `"09:00"` (leading zero ke saath), `"23:59"`. `"9:00"` ya `"11:00 PM"` reject honge.

**4. Overnight timings support nahi hain.** `start < end` mandatory hai — matlab `22:00` se `02:00` (raat bhar khula) express nahi kar sakte. Aisi jagah ke liye `23:59` tak set karna padega.

**5. `brandId` bhejo to brand-level default timings ban'ti hain**, `subBrandId` bhejo to us outlet ki. Outlet ki apni timings brand ki default ko override karti hain (customer ko outlet wali dikhti hai).

**6. Response `201` deta hai** chahe update hi kyun na ho — upsert hai.

**7. ⚠️ Role gate missing** — koi bhi authenticated user kisi bhi brand/outlet ke work hours badal sakta hai ([Appendix B](#appendix-b--known-issues)).

---

# Location APIs

Ek hi `Location` model teen cheezein serve karta hai — customer address, brand address, outlet address. `isBrandAddress` / `isSubBrandAddress` flags se distinguish hota hai.

Global middleware: `router.use(verifyJwtToken)` — ⚠️ **koi role gate nahi**

> `POST /locations/upsert` customer-only hai (service me role check hai) — vendor ke liye nahi.

## 38. POST /locations/create

Brand ya outlet ka address banata hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `addressLine1` | string | ✅ | – | |
| `city` | string | ✅ | – | |
| `state` | string | ✅ | – | |
| `zipcode` | string | ✅ | – | `country` ke hisaab se regex ([table](#zip-code-validation-country-wise)) |
| `coordinates` | number[] | ✅ | – | Exactly 2: **`[longitude, latitude]`**. lng −180..180, lat −90..90 |
| `brandId` | ObjectId | ⚠️ | – | **`isBrandAddress: true` pe required** |
| `subBrandId` | ObjectId | ⚠️ | – | **`isSubBrandAddress: true` pe required** |
| `isBrandAddress` | boolean\|string | ❌ | `false` | |
| `isSubBrandAddress` | boolean\|string | ❌ | `false` | |
| `addressLine2` · `landmark` · `district` | string | ❌ | – | |
| `country` | string | ❌ | `india` | 2–80 chars |
| `formattedAddress` | string | ❌ | auto-generated | 1–500 chars |
| `addressType` | string | ❌ | `HOME` | `HOME` \| `WORK` \| `OTHER` |
| `isDefault` | boolean\|string | ❌ | `false` | |
| `userId` | ObjectId | ❌ | token ka user | Vendor flow me na bhejein |

**Outlet ka address:**
```json
{
  "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
  "isSubBrandAddress": true,
  "addressLine1": "Shop 4, Scheme 54",
  "addressLine2": "Vijay Nagar",
  "landmark": "Opposite C21 Mall",
  "city": "Indore",
  "district": "Indore",
  "state": "Madhya Pradesh",
  "zipcode": "452010",
  "country": "india",
  "coordinates": [75.8951, 22.7548],
  "addressType": "WORK"
}
```

**Brand ka registered address:**
```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "isBrandAddress": true,
  "addressLine1": "301, Corporate Tower",
  "city": "Indore",
  "state": "Madhya Pradesh",
  "zipcode": "452001",
  "coordinates": [75.8577, 22.7196]
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Location created successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c4b1",
    "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
    "brandId": null,
    "userId": null,
    "addressLine1": "Shop 4, Scheme 54",
    "addressLine2": "Vijay Nagar",
    "landmark": "Opposite C21 Mall",
    "addressType": "WORK",
    "city": "indore",
    "district": "indore",
    "state": "madhya pradesh",
    "country": "india",
    "zipcode": "452010",
    "formattedAddress": "shop 4, scheme 54, vijay nagar, opposite c21 mall, indore, indore, madhya pradesh, 452010, india",
    "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] },
    "isBrandAddress": false,
    "isSubBrandAddress": true,
    "isDefault": false,
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T15:20:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Location cannot be both Brand address and SubBrand address` | Dono flags `true` |
| `400` | `brandId is required for Brand address` | Flag `true` par id nahi |
| `400` | `subBrandId is required for SubBrand address` | |
| `404` | `Brand not found` / `SubBrand not found` | |
| `422` | `Address Line 1 is required` / `City is required` / `State is required` | |
| `422` | `Zip Code/Postal Code is required` / `Invalid Zip Code/Postal Code` | |
| `422` | `Coordinates are required.` | |
| `422` | `Coordinates must be [longitude, latitude].` | Array length 2 nahi |
| `422` | `Coordinates must contain only numbers.` | |
| `422` | `Invalid longitude/latitude.` | Range se bahar |

### ⚠️ Edge cases & notes

**1. Coordinates ka order `[longitude, latitude]` hai** — GeoJSON standard. Ye **ulta** hai us se jo maps APIs usually dete hain (`lat, lng`). **Ye sabse common bug hai.** Indore = `[75.8951, 22.7548]`, `[22.7548, 75.8951]` **nahi**.

**2. Sync automatic hota hai:**
- `isBrandAddress: true` → `brand.locationId` set ho jaata hai
- `isSubBrandAddress: true` → `subBrand.locationId` **aur** `subBrand.geo` dono sync hote hain

**3. Outlet ka geo customer voucher listing ke liye critical hai.** `GET /vouchers/customer/get-all` outlets pe `$geoNear` chalata hai — bina location wale outlets ke vouchers customer ko **kabhi nahi dikhenge**, chahe voucher published ho.

**4. Text fields lowercase ho jaate hain** — `city`, `district`, `state`, `country`. `addressLine1`, `addressLine2`, `landmark` original case me rehte hain.

**5. `formattedAddress` auto-generate hota hai** agar na bhejein — saare parts comma-separated, lowercase.

**6. `userId` vendor flow me na bhejein** — brand/outlet address pe wo `undefined` set ho jaata hai (service khud handle karta hai).

---

## 39. GET /locations/getAll

Locations ki paginated list.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | |
| `limit` | number | ❌ | `10` | |
| `search` | string | ❌ | – | addressLine1/2, landmark, city, district, state, zipcode, country, formattedAddress me match |
| `brandId` | ObjectId | ⚠️ | – | **Vendor ko bhejna chahiye** — warna sabke addresses aayenge |
| `subBrandId` | ObjectId | ❌ | – | |
| `userId` · `customerId` | ObjectId | ❌ | – | |
| `city` · `district` · `state` · `zipcode` · `country` | string | ❌ | – | Exact match, lowercase |
| `addressType` | string | ❌ | – | `HOME` \| `WORK` \| `OTHER` |
| `isBrandAddress` · `isSubBrandAddress` · `isDefault` · `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | Validate nahi hota |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /locations/getAll?brandId=68f1a2b3c4d5e6f7a8b9c3a1&isSubBrandAddress=true
```

### Success — `200`
```json
{
  "success": true,
  "message": "Locations fetched successfully",
  "data": {
    "total": 4,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c4b1",
        "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
        "addressLine1": "Shop 4, Scheme 54",
        "city": "indore",
        "state": "madhya pradesh",
        "zipcode": "452010",
        "formattedAddress": "shop 4, scheme 54, vijay nagar, …",
        "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] },
        "isSubBrandAddress": true,
        "isActive": true,
        "createdAt": "2026-08-22T15:20:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any location found` | Empty — **empty-state dikhayein** |
| `422` | `Invalid brandId format` / `Invalid subBrandId format` | |

### ⚠️ Notes

**1. ⚠️ Scoped nahi hai.** Bina `brandId` ke ye **platform ke saare addresses** deta hai — dusre customers ke ghar ke pate bhi. Vendor panel ko hamesha `brandId` bhejna chahiye ([Appendix B](#appendix-b--known-issues)).

**2. City/state/zipcode filters lowercase me match karte hain** — service khud `.toLowerCase()` karta hai, to input case matter nahi karta.

**3. `sortBy` validate nahi hota** — galat field name pe error nahi, MongoDB ignore kar dega (unpredictable order).

---

## 40. GET /locations/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Location fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c4b1",
    "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
    "addressLine1": "Shop 4, Scheme 54",
    "city": "indore",
    "state": "madhya pradesh",
    "zipcode": "452010",
    "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] },
    "isSubBrandAddress": true,
    "isActive": true
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Location not found` |
| `422` | `Location ID is required` / `Invalid location ID format` |

### ⚠️ Note
**Koi ownership check nahi hai** — kisi bhi valid location ID se koi bhi address mil jaata hai ([Appendix B](#appendix-b--known-issues)).

---

## 41. PUT /locations/update/:id

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `addressLine1` · `addressLine2` · `landmark` | string | – |
| `city` · `district` · `state` | string | – |
| `zipcode` | string | Country-wise regex |
| `country` | string | 2–80 chars |
| `formattedAddress` | string | 1–500 chars |
| `coordinates` | number[] | `[longitude, latitude]`, range-checked |
| `addressType` | string | `HOME` \| `WORK` \| `OTHER` |
| `isBrandAddress` · `isSubBrandAddress` · `isDefault` | boolean\|string | – |

```json
{ "addressLine1": "Shop 4-A, Scheme 54", "coordinates": [75.8952, 22.7549] }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Location updated successfully",
  "data": { "_id": "…", "addressLine1": "Shop 4-A, Scheme 54", "geo": { "type": "Point", "coordinates": [75.8952, 22.7549] } }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Location not found` |
| `422` | `Invalid Zip Code/Postal Code` |
| `422` | `Coordinates must be [longitude, latitude].` / `Invalid longitude/latitude.` |
| `422` | `Invalid location ID format` |

### ⚠️ Notes

**1. Coordinates update karne pe outlet ka `geo` bhi sync hona chahiye** — verify karein ki voucher listing sahi chal rahi hai, kyunki `SubBrand.geo` alag se store hota hai.

**2. ⚠️ Ownership check nahi hai** — koi bhi kisi ka address edit kar sakta hai ([Appendix B](#appendix-b--known-issues)).

---

## 42. DELETE /locations/delete/:id

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Location deleted successfully", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Location not found` |
| `422` | `Invalid location ID format` |

### ⚠️ Notes

**1. Soft delete hai** — `isDeleted: true`, record rehta hai.

**2. ⚠️ Outlet ka address delete karne se pehle sochein** — `subBrand.locationId` dangling reference ban jayega, aur us outlet ke vouchers customer listing se gayab ho jayenge (geo query fail hogi).

**3. ⚠️ Ownership check nahi hai** ([Appendix B](#appendix-b--known-issues)).

---

# Showcase APIs

Brand ka photo/video gallery — **sections** me organized, har section me **media** (photos + videos). Customer ise brand profile pe dekhta hai.

⚠️ **Sections plan se metered hain** — `showcase` bucket. Media pe koi plan limit nahi, par per-section config limits hain.

Global middleware: `router.use(verifyJwtToken)` — ⚠️ **koi role gate nahi** ([Appendix B](#appendix-b--known-issues))

### Media config (admin-configurable)

Live values `Setting.vendor.showcase` se aate hain; ye fallbacks hain:

| Limit | Default |
|---|---:|
| Max sections per brand | 5 |
| Max items per section | 15 |
| Max images per section | 15 |
| Max videos per section | 5 |
| Max image size | 10 MB |
| Max video size | 50 MB |

Allowed images: `image/jpeg` · `image/jpg` · `image/png` · `image/webp`
Allowed videos: `video/mp4` · `video/webm` · `video/quicktime`

---

## 43. POST /showcase/section/add

Naya showcase section banata hai.

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** — vendor apna brand, admin `brandId` de kar kisi ka bhi

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | admin ke liye ✅ | – | Vendor ke liye optional (apna brand auto) |
| `title` | string | ✅ | – | 2–60 chars. **Jaisa likha waisa store hota hai** (pehle lowercase hota tha) |
| `description` | string | ❌ | – | Max 500 chars, `""` allowed |
| `sortOrder` | number | ❌ | auto (last + 1) | Integer ≥ 1 |
| `sectionType` | string | ❌ | `CUSTOM` | `CUSTOM` \| `SYSTEM` |
| `isActive` | boolean | ❌ | `true` | |
| `isVisible` | boolean | ❌ | `true` | `false` bhejein to section hidden banega |
| `isShowVideosInClips` | boolean | ❌ | `true` | Is section ke videos customer ke reels feed me aayein ya nahi |

```json
{
  "title": "Ambience",
  "description": "Our cozy interiors",
  "isShowVideosInClips": true
}
```

### Success — `201`
```json
{
  "success": true,
  "message": "Section created successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "title": "Ambience",
    "slug": "ambience",
    "description": "Our cozy interiors",
    "coverImageMode": "AUTO",
    "sortOrder": 1,
    "sectionType": "CUSTOM",
    "isActive": true,
    "isVisible": true,
    "isShowVideosInClips": true,
    "isDeleted": false,
    "mediaCount": 0,
    "createdAt": "2026-08-22T16:00:00.000Z"
  }
}
```

> `medias: []` ki jagah ab `mediaCount` aata hai — create/update response me media array bhejne ka koi matlab nahi tha.

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Access denied. This feature requires an active subscription. Please subscribe to continue.` | Koi active plan nahi |
| `403` | `Your current plan does not include showcase sections. Please upgrade your subscription to add showcase sections.` | Plan me showcase pool nahi |
| `403` | `Showcase section limit reached — 5 of 5 used on your current plan. Please upgrade your subscription to add more.` | Pool khatam |
| `409` | `Section title already exists.` | Same brand me wahi title (case-insensitive) |
| `404` | `Brand not found.` | Vendor ka brand nahi |
| `422` | `Section title is required.` | |
| `422` | `Section title must contain at least 2 characters.` | |
| `422` | `Section title cannot exceed 60 characters.` | |

### ⚠️ Notes

**1. Order of checks:** subscription gate → duplicate title → slug generate → **slot reserve (sabse last)**. Service ka comment: *"Claimed as late as possible — after the duplicate-title and slug checks."* Matlab duplicate title pe slot waste nahi hota.

**2. `title` original case me store hota hai** (naya) — customer app wahi render karta hai. Duplicate check case-insensitive hi hai, to `"Ambience"` aur `"ambience"` ek saath nahi rah sakte (409).

**3. `slug` auto-generate hota hai** brand ke andar unique — same title dobara nahi ho sakta, par slug collision handle ho jaata hai.

**4. `sortOrder` na do to auto** — last section ka `sortOrder + 1`.

**5. ✅ Teeno toggle ab actually apply hote hain** (naya) — `isActive` / `isVisible` / `isShowVideosInClips` validator accept karta tha par service inhe drop kar deti thi, to hidden section banane ki koshish karne pe bhi visible section banta tha.

**6. `isShowVideosInClips` reels feed control karta hai.** Customer ka `/showcase/:brandId/video-clips` **double opt-in** maangta hai: section pe ye flag **aur** media pe `isShowInVideoClips` — dono `true` hone chahiye. Media wala flag **sirf videos** pe lagta hai.

**7. Section khali banta hai** — media alag se `POST /showcase/section/:sectionId/add-media` (#48) se add karni hoti hai.

---

## 44. GET /showcase/section/get/:sectionId

Ek section + uska media, paginated.

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | Max 100 chars — media title/altText me |
| `type` | string | ❌ | – | `PHOTO` \| `VIDEO` |
| `isActive` | boolean | ❌ | – | **Naya.** Default me on aur off dono media aati hain; ye ek side pe filter karta hai |

```http
GET /showcase/section/get/68f1a2b3c4d5e6f7a8b9c5a1?type=VIDEO
```

### Success — `200`
```json
{
  "success": true,
  "message": "Section fetched successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "title": "ambience",
    "slug": "ambience",
    "description": "Our cozy interiors",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-cover.jpg",
    "sortOrder": 1,
    "sectionType": "CUSTOM",
    "coverImageMode": "AUTO",
    "isActive": true,
    "isVisible": true,
    "isShowVideosInClips": true,
    "mediaCount": 5,
    "photoCount": 4,
    "videoCount": 1,
    "inactiveMediaCount": 1,
    "media": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "totalPages": 1,
      "data": [
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c5b1",
          "type": "PHOTO",
          "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1.jpg",
          "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1-thumb.jpg",
          "title": "seating area",
          "altText": "cafe seating with wooden tables",
          "sortOrder": 1,
          "isActive": true,
          "storage": { "provider": "CLOUDINARY", "publicId": "showcase/amb1" },
          "metadata": { "width": 1920, "height": 1080, "sizeMB": 2.4 },
          "createdAt": "2026-08-22T16:05:00.000Z",
          "updatedAt": "2026-08-22T16:05:00.000Z"
        },
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c5b2",
          "type": "VIDEO",
          "url": "https://res.cloudinary.com/drvdnqydw/video/upload/v1/showcase/amb-tour.mp4",
          "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-tour-thumb.jpg",
          "title": "cafe walkthrough",
          "altText": "video tour",
          "sortOrder": 2,
          "isActive": true,
          "isShowInVideoClips": true,
          "storage": { "provider": "CLOUDINARY", "publicId": "showcase/amb-tour" },
          "metadata": { "width": 1080, "height": 1920, "duration": 24, "sizeMB": 18.2 },
          "createdAt": "2026-08-22T16:06:00.000Z",
          "updatedAt": "2026-08-22T16:06:00.000Z"
        }
      ]
    }
  }
}
```

> ⚠️ **Media ek nested block hai — `data.media.data[]`, na ki `data.medias[]`.** Pagination bhi usi block me hai, section ke saath flat nahi. Live run me pakda gaya (2026-08-27); doc me pehle flat `medias[]` + top-level `total` likha tha.

### Errors
| Status | Message |
|---|---|
| `404` | `Showcase section not found.` |
| `422` | *(Joi message)* — invalid `sectionId`, `limit > 100`, invalid `type` |

### ⚠️ Notes

**1. Vendor ko `storage` aur `metadata` dikhte hain** — customer ke response se ye strip ho jaate hain. Vendor panel me file size / dimensions dikhane ke liye useful.

**2. 🔴 `isActive: false` media ab bhi aati hai** (naya). Pehle wo list se gayab ho jaati thi — matlab off karne ke baad usko wapas on karne ka koi rasta hi nahi bachta tha. Ab sirf soft-deleted media chhupti hai. Ek side chahiye to `?isActive=true|false`.

**3. `isShowInVideoClips` sirf `VIDEO` rows pe aata hai** (naya). Photo pe ye key hoti hi nahi — wo video-only switch hai, to photo pe toggle mat dikhayein.

**4. Section ke teeno switch ab response me hain** — `isVisible`, `isShowVideosInClips`, `isActive` (aur `slug`, `coverImageMode`). Ye doc pehle se inhe list karta tha, par service bhejti nahi thi — ab bhejti hai.

**5. Counts pre-calculated hain** — `mediaCount`, `photoCount`, `videoCount`, `inactiveMediaCount`. Ye **poore album** ke counts hain (soft-deleted chhod kar), `type`/`search`/`isActive` filter inhe nahi badalta — filter sirf `media.data[]` page ko narrow karta hai.

**6. ✅ Ownership check hoti hai** — `resolveSectionForActor` verify karta hai ki section aapke brand ka hai.

---

## 45. GET /showcase/section/get-all

Sections ki paginated list.

**Access:** Intended: Admin + Vendor · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ❌ | – | Vendor: sirf apna brand chalega. Admin: kisi bhi brand pe narrow karne ke liye |
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | Title me match, `""` allowed |
| `isActive` | boolean | ❌ | *(koi default nahi)* | Bheja to filter, na bheja to on+off dono |
| `isVisible` | boolean | ❌ | *(koi default nahi)* | Bheja to filter, na bheja to visible+hidden dono |
| `sortBy` | string | ❌ | `sortOrder` | `title` \| `sortOrder` \| `createdAt` \| `updatedAt` |
| `order` | string | ❌ | `asc` | `asc` \| `desc` — **note: `order` hai, `sortOrder` nahi** |

### Success — `200`
```json
{
  "success": true,
  "message": "Showcase sections fetched successfully.",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "title": "Ambience",
        "slug": "ambience",
        "description": "Our cozy interiors",
        "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-cover.jpg",
        "coverImageMode": "AUTO",
        "sectionType": "CUSTOM",
        "sortOrder": 1,
        "isActive": true,
        "isVisible": true,
        "isShowVideosInClips": true,
        "mediaCount": 5,
        "photoCount": 4,
        "videoCount": 1,
        "inactiveMediaCount": 0,
        "createdAt": "2026-08-22T16:00:00.000Z",
        "updatedAt": "2026-08-22T16:05:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any showcasesection found` | Empty — **empty-state** |
| `422` | *(Joi message)* — `limit > 100`, invalid `sortBy`/`order` |

### ⚠️ Notes

**1. ✅ Brand scoping fix ho chuki hai.** Pehle service me brand filter commented out tha — vendor ko **platform ke saare brands ke sections** mil jaate the (security finding #4). Ab:
- **VENDOR** apne brand pe pinned hai. `brandId` bhejein to `resolveActorBrand` verify karta hai ki wo aapka hi hai, warna `403`.
- **ADMIN** global hai — `brandId` na bhejein to sab brands, bhejein to us brand ke sections.

**2. 🔴 `isActive` / `isVisible` ke default filter hata diye gaye hain** (naya). Pehle default `true`/`true` tha, matlab jis section ko aapne abhi hide kiya wo aapki apni list se hi gayab ho jaata tha — usko dubara dhoondh kar on karne ka koi tareeka nahi bachta tha. Ab managed list me **sirf soft-deleted** sections chhupte hain.

Panel me "Hidden" tab chahiye to `?isVisible=false` bhejein.

**3. Counts soft-deleted media ko chhod kar sab count karte hain** — `isActive: false` media bhi `mediaCount` me hai, aur `inactiveMediaCount` alag se batata hai kitni off hain.

**4. Search case-insensitive hai** aur title pe chalta hai.

---

## 46. PUT /showcase/section/update/:sectionId

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |

### Body — sab optional, **kam se kam ek field chahiye**
| Field | Type | Validation |
|---|---|---|
| `title` | string | 2–60 chars |
| `description` | string | Max 500 chars, `""` bhej kar clear kar sakte hain |
| `sortOrder` | number | Integer ≥ **1** (pehle `0` bhi allowed tha — ab create/reorder ke saath consistent) |
| `sectionType` | string | `CUSTOM` \| `SYSTEM` |
| `isActive` | boolean | – |
| `isVisible` | boolean | – |
| `isShowVideosInClips` | boolean | – |

```json
{ "description": "Our cozy interiors, refreshed", "isShowVideosInClips": false }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Section updated successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "title": "Ambience",
    "slug": "ambience",
    "description": "Our cozy interiors, refreshed",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-cover.jpg",
    "coverImageMode": "AUTO",
    "sectionType": "CUSTOM",
    "sortOrder": 1,
    "isActive": true,
    "isVisible": true,
    "isShowVideosInClips": false,
    "mediaCount": 5,
    "createdAt": "2026-08-22T16:00:00.000Z",
    "updatedAt": "2026-08-22T16:20:00.000Z"
  }
}
```

> `medias[]` array response me **nahi** aata (naya) — title badalne pe poori media list wapas bhejne ka koi matlab nahi tha. Media ke liye #44 hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Showcase section not found.` | |
| `409` | `Section title already exists.` | Naya title kisi aur section ka hai |
| `422` | *(min-1 message)* | Body khali |
| `422` | `Section title must contain at least 2 characters.` | |

### ⚠️ Notes

**1. Body khali nahi ho sakti** — validator pe `.min(1)` hai.

**2. Teen alag-alag switch hain, confuse na karein:**

| Field | Customer pe asar | Vendor list (#45) pe asar | Slot |
|---|---|---|---|
| `isVisible: false` | Section brand profile aur gallery dono se hat jaata hai | Dikhta rehta hai | Release nahi |
| `isActive: false` | Section customer ko dikhna band | Dikhta rehta hai | Release nahi |
| `isShowVideosInClips: false` | Sirf reels feed se videos hatte hain, album me rehte hain | Dikhta rehta hai | Release nahi |

Section poora hatana ho tabhi delete (#53) — wohi slot release karta hai.

**3. `title` original case me store hota hai** (naya) — pehle sab lowercase ho jaata tha. Uniqueness ab bhi case-insensitive hai, to "Ambience" aur "ambience" ek saath nahi rah sakte (`409`).

**4. ✅ Rename pe slug ab drift nahi karta** (naya) — pehle har rename `ambience` → `ambience-2` → `ambience-3` karta chala jaata tha, kyunki section apne hi slug se "duplicate" match kar jaata tha.

**5. ✅ Ownership check hoti hai** — `resolveSectionForActor`.

---

## 47. PUT /showcase/section/:brandId/reorder

Sections ka order badalta hai.

**Access:** Intended: Admin + Vendor · Enforced: **VENDOR+ADMIN + ownership** ⚠️

> ✅ Ye route pehle broken tha (leading `/` missing) — ab fix ho chuka hai.

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `sections` | array | ✅ | Min 1 item |
| `sections[].id` | ObjectId | ✅ | Section ka `_id` |
| `sections[].sortOrder` | number | ✅ | Integer ≥ **1** |

```json
{
  "sections": [
    { "id": "68f1a2b3c4d5e6f7a8b9c5a2", "sortOrder": 1 },
    { "id": "68f1a2b3c4d5e6f7a8b9c5a1", "sortOrder": 2 },
    { "id": "68f1a2b3c4d5e6f7a8b9c5a3", "sortOrder": 3 }
  ]
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Sections reordered successfully.",
  "data": { "updated": 3 }
}
```

> 🔴 **Ye endpoint 2026-08-27 se pehle kabhi kaam nahi karta tha.** Service `item.sectionId` padhti thi jabki validator (aur ye doc) `id` accept karte hain — har well-formed request `undefined.toString()` pe `500` de deti thi. Live run me pakda gaya aur fix kar diya gaya. Field ab bhi **`id`** hi hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid section list.` | Koi `id` us brand ka nahi |
| `400` | `Please send the complete section order — N sections expected, M received.` | ⚠️ **Naya** — partial list ab reject hoti hai |
| `400` | `Duplicate id found.` / `Duplicate sort order found.` | |
| `422` | *(Joi message)* | Invalid `brandId` / missing `sortOrder` |

### ⚠️ Notes

**1. `sortOrder` `1` se start hota hai** — media reorder (#51) bhi ab yehi hai (pehle wahan `0` allowed tha).

**2. 🔴 Poori list mandatory hai** (naya) — pehle partial list accept ho jaati thi, par service list ko `1..n` renumber karti hai, to chhod diye gaye sections ke saath positions takra jaati thi (do sections `sortOrder: 1` pe). Ab #51 ki tarah complete list maangi jaati hai. Drag-and-drop UI ke paas poori list hoti hi hai.

**3. Customer ko sections isi `sortOrder` me dikhte hain** (ascending).

---

## 48. POST /showcase/section/:sectionId/add-media

Photos/videos upload karta hai. **Multipart request.**

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `multipart/form-data` | ✅ |

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |

### Body (multipart)
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| *(files)* | file[] | ✅ | – | Ek ya multiple images/videos |
| `isShowInVideoClips` | boolean | ❌ | `true` | **Sirf batch ki videos pe lagta hai.** Photos pe hamesha `false` store hota hai |

### Success — `201`
```json
{
  "success": true,
  "message": "Media uploaded successfully.",
  "data": {
    "uploaded": 3,
    "medias": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5b1",
        "type": "PHOTO",
        "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1.jpg",
        "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1-thumb.jpg",
        "sortOrder": 1,
        "isShowInVideoClips": false,
        "isActive": true,
        "storage": { "provider": "CLOUDINARY", "publicId": "showcase/amb1" },
        "metadata": { "width": 1920, "height": 1080, "sizeMB": 2.4 }
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5b2",
        "type": "VIDEO",
        "url": "https://res.cloudinary.com/drvdnqydw/video/upload/v1/showcase/amb-tour.mp4",
        "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-tour-thumb.jpg",
        "sortOrder": 2,
        "isShowInVideoClips": true,
        "metadata": { "width": 1080, "height": 1920, "duration": 24, "sizeMB": 18.2 }
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Showcase section not found.` | |
| `400` | `Please upload at least one media.` | Koi file nahi |
| `400` | `Please upload at least one image or video.` | Files hain par koi valid media nahi |
| `400` | `Maximum 15 media items are allowed in one section.` | Total limit |
| `400` | `Maximum 15 images are allowed.` | Image limit |
| `400` | `Maximum 5 videos are allowed.` | Video limit |
| `400` | `<filename> image format is not supported.` | jpeg/jpg/png/webp ke bahar |
| `400` | `<filename> video format is not supported.` | mp4/webm/quicktime ke bahar |
| `400` | `<filename> exceeds maximum image size of 10 MB.` | |
| `400` | `<filename> exceeds maximum video size of 50 MB.` | |
| `400` | `Duplicate <filename> found.` | Same file do baar |
| `400` | `Unsupported media type.` | MIME detect nahi hua |
| `500` | `Failed to add media to showcase section.` | Upload fail — **uploaded files rollback ho jaate hain** |
| `500` | `Showcase configuration not found.` | Settings issue |

### ⚠️ Notes

**1. Limits **existing + naye** dono milakar check hote hain** — agar section me 13 images hain aur aap 3 aur bhejo, to `"Maximum 15 images are allowed."` aayega.

**2. Rollback on failure** — koi bhi file fail ho to **saari** uploaded files Cloudinary se delete ho jaati hain. Partial upload nahi hota.

**3. `isShowInVideoClips` sirf videos pe apply hota hai** (naya). Photos par hamesha `false` store hota hai — response me bhi `false` dikhega. Pehle har media pe `true` chala jaata tha, jiska koi asar nahi hota tha (clips feed type pe filter karta hai) par panel me ek bekaar toggle dikh jaata tha.

**4. Cover image auto-set hoti hai** — batch ki pehli media ka `thumbnail`, **agar pehle se koi cover na ho** aur `coverImageMode` `AUTO` ho. Video bhi cover ban sakta hai (uska poster frame use hota hai, `.mp4` link nahi).

**5. Video thumbnail auto-generate hota hai** Cloudinary se.

**6. `sortOrder` auto-assign hota hai** — existing ke baad append.

**7. Limits admin-configurable hain** — `Setting.vendor.showcase` se. Upar diye defaults hain; live values alag ho sakti hain. Error message me actual value aati hai.

**8. Plan limit yahan nahi lagti** — media pe koi entitlement bucket nahi hai, sirf section pe hai.

**9. Validation errors ab sahi status ke saath aate hain** (naya) — unsupported format jaisi cheezein pehle outer catch me `500 Failed to add media…` ban jaati thi; ab original `400` + asli message milta hai.

---

## 49. PATCH /showcase/section/:sectionId/media/update/:mediaId

Media ka metadata update — **file nahi badalti**.

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |
| `mediaId` | ObjectId | ✅ |

### Body — sab optional (multipart bhi ho sakta hai, `thumbnail` file ke liye)
| Field | Type | Validation |
|---|---|---|
| `title` | string | Max 100 chars, `""` se clear |
| `altText` | string | Max 150 chars, `""` se clear |
| `isShowInVideoClips` | boolean | ⚠️ **Sirf VIDEO pe** — photo pe bhejne se `422` |
| `isActive` | boolean | – |
| *(file)* `thumbnail` | file | ⚠️ **Sirf VIDEO pe** — image format, max 10 MB |

> 🔴 **`sortOrder` hata diya gaya hai** (naya). Position ab sirf reorder endpoint (#51) badalta hai. Yahan se set karne pe do media ek hi `sortOrder` pe aa jaati thi aur order arbitrary ho jaata tha.

```json
{ "title": "Seating area", "altText": "Cafe seating with wooden tables", "isShowInVideoClips": false }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Media info updated successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c5b2",
    "type": "VIDEO",
    "url": "https://res.cloudinary.com/drvdnqydw/video/upload/v1/showcase/amb-tour.mp4",
    "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/custom-poster.jpg",
    "title": "Cafe walkthrough",
    "altText": "Video tour",
    "sortOrder": 2,
    "isActive": true,
    "isShowInVideoClips": false,
    "storage": { "provider": "CLOUDINARY", "publicId": "showcase/amb-tour" },
    "metadata": { "width": 1080, "height": 1920, "duration": 24 },
    "createdAt": "2026-08-22T16:06:00.000Z",
    "updatedAt": "2026-08-27T11:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Please provide at least one field to update.` | Na koi field, na thumbnail file |
| `404` | `Media not found.` | Media nahi, ya soft-deleted hai |
| `422` | `isShowInVideoClips applies to video media only. This media is a photo.` | **Naya** |
| `422` | `A custom thumbnail can only be set on video media. This media is a photo.` | **Naya** |
| `400` | `Thumbnail must be an image in a supported format.` | **Naya** — thumbnail ab validate hoti hai |
| `400` | `Thumbnail exceeds maximum image size of 10 MB.` | **Naya** |
| `422` | *(Joi message)* | invalid ids, title/altText limit cross |

### ⚠️ Notes

**1. File replace karne ke liye `PUT .../media/replace/:mediaId` (#50) use karein** — ye metadata aur (video ka) poster badalta hai.

**2. `altText` accessibility ke liye hai** — customer app screen readers ke liye use kar sakta hai.

**3. `isActive: false` karne se media customer ko dikhna band** — delete nahi karna padta, aur ab wo vendor list (#44) me bhi dikhti rehti hai to wapas on kar sakte hain.

**4. 🔴 `isShowInVideoClips` sirf video ka switch hai** (naya) — photo pe bhejne pe `422` aata hai. Panel me photo ke liye ye toggle dikhayein hi nahi (#44 photo rows me ye key bhejta hi nahi).

**5. 🔴 Custom thumbnail bhi sirf video pe** (naya) — photo apna hi thumbnail hai. Pehle ye check nahi tha, aur photo pe thumbnail set karne se photo ka apna asset delete hone ka risk tha.

**6. ✅ Purana custom poster ab actually delete hota hai** (naya) — pehle ek galat condition ki wajah se Cloudinary pe orphan files chhut jaati thi. Auto-generated poster (video ke apne public id se bana) delete **nahi** hota — wo video ke saath hi jaata hai.

**7. ✅ Thumbnail upload fail hone pe ab request fail hoti hai** (naya) — pehle error swallow ho jaata tha aur `200` aa jaata tha, jabki poster badla hi nahi hota tha.

**8. Cover image auto-sync hoti hai** — poster ya `isActive` badalne se section ka cover shift ho sakta hai (jab tak `coverImageMode: MANUAL` na ho).

---

## 50. PUT /showcase/section/:sectionId/media/replace/:mediaId

Media file replace karta hai. **Multipart.**

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |
| `mediaId` | ObjectId | ✅ |

### Body (multipart)
| Field | Type | Required | Notes |
|---|---|---|---|
| *(file)* | file | ✅ | **Exactly ek** file |

### Success — `200`
```json
{
  "success": true,
  "message": "Media replaced successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c5b1",
    "type": "PHOTO",
    "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1-v2.jpg",
    "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1-v2-thumb.jpg",
    "sortOrder": 1,
    "metadata": { "width": 2048, "height": 1152, "sizeMB": 3.1 }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Media not found.` | Section ya media nahi, ya media inactive/deleted hai |
| `400` | `Please upload exactly one media file.` | Zero ya multiple files |
| `400` | `Only photo replacement is allowed for this media.` | Type mismatch — **upload se pehle** check hota hai |
| `400` | *(format/size errors)* | #48 jaise |
| `500` | `Failed to replace media` | Upload fail — file rollback ho jaati hai |

### ⚠️ Notes

**1. Purani file Cloudinary se delete ho jaati hai** — sirf new upload succeed **aur** document save hone ke baad. Video ka custom poster bhi saath me hat jaata hai.

**2. `_id`, `sortOrder`, `isActive` aur `isShowInVideoClips` same rehte hain** — sirf file badalti hai.

**3. 🔴 Type badal NAHI sakta** — photo ki jagah photo, video ki jagah video. (Ye rule pehle bhi tha par upload ke **baad** check hota tha, aur uska `400` outer catch me `500` ban jaata tha. Ab mime type se pehle hi check hota hai — na bekaar upload, na galat status code.)

**4. Cover image auto-sync hoti hai** — agar ye media cover thi to naya poster cover ban jaata hai (`coverImageMode: MANUAL` na ho to).

---

## 51. PUT /showcase/section/:sectionId/media/reorder

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `medias` | array | ✅ | Min 1 item — **section ki saari live media** |
| `medias[].id` | ObjectId | ✅ | |
| `medias[].sortOrder` | number | ✅ | Integer ≥ **1** (pehle `0` allowed tha; ab section reorder ke saath consistent) |

```json
{
  "medias": [
    { "id": "68f1a2b3c4d5e6f7a8b9c5b2", "sortOrder": 1 },
    { "id": "68f1a2b3c4d5e6f7a8b9c5b1", "sortOrder": 2 }
  ]
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Media reordered successfully.",
  "data": {
    "updated": 2,
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-tour-thumb.jpg"
  }
}
```

> Already sahi order me ho to `{ "updated": 0, "message": "Media already in same order." }` aata hai.
>
> 🔴 **Ye bhi 2026-08-27 se pehle kabhi kaam nahi karta tha** — section reorder wala hi bug (service `item.mediaId` padhti thi, payload me `id` aata hai). Live run me pakda gaya aur fix kar diya gaya.

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Media list is required.` | Empty |
| `404` | `Showcase section not found.` | |
| `400` | `Please send the complete media order — N media expected, M received.` | ⚠️ **Section ki saari live media bhejni hoti hai**, sirf badli hui nahi |
| `400` | `Invalid media id : <id>` | Koi id us section ki nahi (ya inactive/deleted hai) |

### ⚠️ Notes

**1. ⚠️ Poori list mandatory hai.** Partial reorder allowed nahi. Error message ab batata hai kitni expected thi aur kitni mili.

**2. `sortOrder` `1` se start hota hai** — #47 ke saath ab consistent.

**3. Cover image order ke saath move karti hai** — pehli media ka thumbnail cover ban jaata hai, isliye response me naya `coverImage` bhi aata hai. `coverImageMode: MANUAL` ho to cover nahi badalta. (Pehle cover ke liye media ka `url` prefer hota tha — video pehle number pe aa jaaye to cover ek `.mp4` link ban jaati thi aur UI me broken image dikhti thi. Ab hamesha `thumbnail` prefer hota hai.)

---

## 52. DELETE /showcase/section/:sectionId/media/delete/:mediaId

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |
| `mediaId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Media deleted successfully.",
  "data": {
    "deletedMediaId": "68f1a2b3c4d5e6f7a8b9c5b1",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb2.jpg"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Media not found.` | Section ya media nahi, ya pehle se deleted/inactive |
| `400` | `At least one media is required in this section.` | ⚠️ **Aakhri live media delete nahi kar sakte** |

### ⚠️ Notes

**1. ⚠️ Section khali nahi ho sakta.** Aakhri media delete karne ki koshish pe `400` aayega. Section hi hatana ho to `DELETE /showcase/section/delete/:sectionId` (#53) use karein.

**2. 🔴 Ab soft delete hai** (naya) — media document `isDeleted: true` + `deletedAt` ke saath rehta hai, array se `$pull` nahi hoti. Ye is domain ka aakhri hard delete tha. Kisi bhi API me wo media ab nahi aayegi (vendor list me bhi nahi).

**3. Cloudinary se file phir bhi delete hoti hai** — storage cost bachane ke liye. Matlab soft delete ek **audit record** hai, restore point nahi.

**4. ✅ Cover image ab khud sudhar jaati hai** (naya) — deleted media cover thi to bachi hui pehli media ka thumbnail cover ban jaata hai, aur naya `coverImage` response me aata hai. Pehle cover stale reh jaati thi (comparison `url` se hoti thi jabki cover `thumbnail` se set hui thi).

---

## 53. DELETE /showcase/section/delete/:sectionId

Poora section delete — media ke saath.

**Access:** Intended: VENDOR · Enforced: **VENDOR+ADMIN + ownership** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `sectionId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Section deleted successfully.",
  "data": {
    "deletedSectionId": "68f1a2b3c4d5e6f7a8b9c5a1",
    "deletedMediaIds": [
      "68f1a2b3c4d5e6f7a8b9c5b1",
      "68f1a2b3c4d5e6f7a8b9c5b2"
    ]
  }
}
```

> `deletedMediaIds` me ab sach me **ids** aati hain (naya) — pehle is key me poore media documents (storage, metadata sameta) chale jaate the.

### Errors
| Status | Message |
|---|---|
| `404` | `Showcase section not found.` |
| `422` | `Invalid section ID format` |

### ⚠️ Notes

**1. ✅ Plan slot release ho jaata hai** — `releaseSlot(brandId, SHOWCASE)`. Delete karke naya section bana sakte hain.

**2. Soft delete hai** — section aur uski saari media pe `isDeleted: true`. **Cloudinary files delete ho jaati hain** (doc me pehle ulta likha tha) — to restore possible nahi, ye audit record hai.

**3. Sirf hide karna ho to `isVisible: false` ya `isActive: false` (#46) use karein** — wo slot release **nahi** karte, par customer ko dikhna band ho jaata hai aur file bhi safe rehti hai.

---

# Voucher APIs

Vouchers **immutable versioning** pe chalte hain — har edit naya version banata hai, purana version untouched rehta hai.

⚠️ **Vouchers plan se metered hain** — `vouchers` bucket.

### Lifecycle

```
DRAFT ──submit-review──> UNDER_REVIEW ──admin review──> APPROVED ──publish──> PUBLISHED
                                              │                                    │
                                              └──> REJECTED                        └──> EXPIRED (job)
```

| Status | Kaun set karta hai | Editable? |
|---|---|---|
| `DRAFT` | Vendor (create) | ✅ Haan |
| `UNDER_REVIEW` | Vendor (submit) | ❌ `409` |
| `APPROVED` | **Admin** | ✅ Naya version banta hai |
| `REJECTED` | **Admin** | ✅ Haan |
| `PUBLISHED` | Vendor ya Admin | ⚠️ Naya version banana padta hai |
| `EXPIRED` | Background job | ❌ `409` |
| `PAUSED` | – | ❌ Pehle resume karein |
| `ARCHIVED` | – | ❌ `409` |

---

## 54. POST /vouchers/create

Naya voucher banata hai. **Multipart** (images mandatory).

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership** (`resolveActorBrand`)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `multipart/form-data` | ✅ |

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | Vendor apna hi bhej sakta hai |
| `name` | string | ✅ | – | 2–150 chars |
| `startAt` | ISO date | ✅ | – | |
| `endAt` | ISO date | ✅ | – | `startAt` se baad |
| `offers` | array | ✅ | – | Min 1. JSON string bhi accept hota hai |
| `subBrandIds` | ObjectId[] | ✅ | – | Min 1 — kaunse outlets pe valid |
| `images` | file[] | ✅ | – | **Multipart**, field name `images`. Min 1 |
| `description` | string | ❌ | – | Max 2000 chars |
| `tags` | string[] | ❌ | – | Min 1 item agar bhejein |
| `isSaveAsDraft` | boolean | ❌ | `true` | |
| `bannerType` | string | ❌ | – | `IMAGE` \| `VIDEO` \| `GIF` — saath me matching file bhi chahiye |

**Offer ka shape:**
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `title` | string | ✅ | – | |
| `minBillAmount` | number | ✅ | – | Positive |
| `discountType` | string | ✅ | – | `PERCENTAGE` \| `FLAT` \| ~~`FIXED`~~ |
| `discountValue` | number | ✅ | – | Positive |
| `usageType` | string | ✅ | – | `ONCE_PER_USER` \| `MULTIPLE` |
| `sortOrder` | number | ✅ | – | Integer ≥ 1 |
| `discountApplicableOn` | string | ❌ | `SUBTOTAL` | `SUBTOTAL` \| `FINAL_BILL` |
| `maxDiscountAmount` | number | ❌ | – | Positive — **`PERCENTAGE` pe cap** |
| `isActive` | boolean | ❌ | – | |

**Multipart example:**
```
brandId:      68f1a2b3c4d5e6f7a8b9c3a1
name:         Flat 30% off on total bill
description:  Valid on dine-in and takeaway
startAt:      2026-09-01T00:00:00.000Z
endAt:        2026-10-01T23:59:59.000Z
subBrandIds:  ["68f1a2b3c4d5e6f7a8b9c4a1","68f1a2b3c4d5e6f7a8b9c4a2"]
tags:         ["coffee","cafe","discount"]
offers:       [{"title":"30% off above 500","minBillAmount":500,"discountType":"PERCENTAGE","discountValue":30,"maxDiscountAmount":300,"usageType":"ONCE_PER_USER","discountApplicableOn":"SUBTOTAL","sortOrder":1}]
images:       <file1>
images:       <file2>
bannerType:   IMAGE
bannerImage:  <file>
```

### Success — `201`
```json
{
  "success": true,
  "message": "Voucher created successfully.",
  "data": {
    "voucher": {
      "_id": "68f1a2b3c4d5e6f7a8b9c2a1",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "name": "flat 30% off on total bill",
      "voucherCode": "TDV000451",
      "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
      "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
      "status": "DRAFT",
      "currentVersionId": "68f1a2b3c4d5e6f7a8b9c2b1",
      "publishedVersionId": null,
      "banner": {
        "type": "IMAGE",
        "image": { "url": "https://res.cloudinary.com/…/banner.jpg" }
      },
      "isActive": true,
      "createdAt": "2026-08-22T17:00:00.000Z"
    },
    "version": {
      "_id": "68f1a2b3c4d5e6f7a8b9c2b1",
      "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
      "versionNumber": 1,
      "versionCode": "TDV000451-V1",
      "name": "flat 30% off on total bill",
      "description": "Valid on dine-in and takeaway",
      "tags": ["coffee", "cafe", "discount"],
      "images": [
        { "_id": "…", "url": "https://res.cloudinary.com/…/v1.jpg", "sortOrder": 1 }
      ],
      "offers": [
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c2d1",
          "title": "30% off above 500",
          "minBillAmount": 500,
          "discountType": "PERCENTAGE",
          "discountValue": 30,
          "maxDiscountAmount": 300,
          "usageType": "ONCE_PER_USER",
          "discountApplicableOn": "SUBTOTAL",
          "sortOrder": 1,
          "isActive": true
        }
      ],
      "startAt": "2026-09-01T00:00:00.000Z",
      "endAt": "2026-10-01T23:59:59.000Z",
      "status": "DRAFT",
      "isImmutable": false,
      "isActive": true
    },
    "usage": { "vouchers": { "used": 4, "limit": 20, "isUnlimited": false } }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Access denied. This feature requires an active subscription. …` | Koi active plan nahi |
| `403` | `Your current plan does not include vouchers. Please upgrade your subscription to add vouchers.` | Plan me voucher pool nahi |
| `403` | `Voucher limit reached — 20 of 20 used on your current plan. Please upgrade your subscription to add more.` | Pool khatam |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | Dusre brand ka `brandId` |
| `400` | `Brand not found` | |
| `400` | `Voucher name is required.` | Trim ke baad khali |
| `409` | `Voucher with this name already exists for this brand.` | Duplicate name |
| `422` | `At least one voucher image is required.` | `images` file nahi |
| `422` | `At least one offer is required.` | |
| `422` | `Offer 1: "title" is required` | Offer ke andar ka error — `Offer <n>:` prefix ke saath |
| `422` | `Invalid offer JSON at index 0.` | JSON string malformed |
| `422` | `Offer at index 0 must be an object.` | |
| `422` | `Minimum bill amount must be greater than zero.` | |
| `422` | `Sort order is required.` / `Sort order must be at least 1.` | |
| `422` | `Brand ID is required.` / `Invalid Brand ID.` | |
| `422` | `Invalid sub-brand ID.` | |
| `422` | `Banner type must be one of: IMAGE, VIDEO, GIF.` | |
| `500` | *(upload error)* | **Images rollback ho jaati hain** |

### ⚠️ Edge cases & notes

**1. Fully transactional hai.** Voucher + Version + SubBrand mappings sab ek MongoDB transaction me bante hain. Fail hone pe **uploaded images bhi rollback** ho jaati hain (`rollbackVoucherImages`).

**2. `offers` JSON string ho sakta hai** — multipart me array bhejna mushkil hai, isliye validator string parse kar leta hai. Error message me index bhi aata hai (`Offer 1: …`).

**3. `subBrandIds` mandatory hai** — voucher kis outlet pe valid hai. **Bina location wale outlets ke vouchers customer ko nahi dikhenge** (geo query fail hogi) — pehle outlet ki location set karein.

**4. Version 1 auto-create hota hai** `DRAFT` status me. `voucher.currentVersionId` uspe point karta hai.

**5. ⚠️ `FIXED` discount type mat use karein** — enum me hai par calculation me handle nahi hota. Aisa offer customer ko `discountAmount: 0` dega aur eligible list se filter ho jayega. Sirf `PERCENTAGE` ya `FLAT` ([Appendix B](#appendix-b--known-issues)).

**6. `maxDiscountAmount` sirf `PERCENTAGE` pe matlab rakhta hai** — cap lagata hai. `FLAT` pe ignore hota hai.

**7. Banner optional aur independent hai** — approval flow se alag. `bannerType` bhejo to matching file bhi chahiye: `IMAGE` → `bannerImage`, `VIDEO` → `bannerVideo`, `GIF` → `bannerGif`.

**8. `maxImages` / `maxOffers` admin-configurable hain** (`Setting.vendor.voucher`) — defaults 5 images, 10 offers.

---

## 55. PUT /vouchers/update/:voucherId

Voucher edit — **naya version banata hai**. Multipart.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Path Params
| Param | Type | Required |
|---|---|---|
| `voucherId` | ObjectId | ✅ |

### Body — sab optional, **delta-based**
| Field | Type | Validation | Notes |
|---|---|---|---|
| `name` | string | 2–150 chars | |
| `description` | string | Max 2000, `""` allowed | |
| `startAt` · `endAt` | ISO date | – | |
| `newTags` | string[] | – | Add karne wale tags |
| `removedTags` | string[] | – | Hatane wale tags |
| `newOffers` | array | Offer schema | Naye offers |
| `removedOfferIds` | ObjectId[] | – | Hatane wale offers |
| `removeImageIds` | ObjectId[] | – | Hatane wali images |
| `newSubBrandIds` | ObjectId[] | – | Naye outlets |
| `removeSubBrandIds` | ObjectId[] | – | Hatane wale outlets |
| `newImages` | file[] | – | **Multipart**, field name `newImages` |

```json
{
  "name": "Flat 35% off on total bill",
  "newOffers": [
    { "title": "35% off above 600", "minBillAmount": 600, "discountType": "PERCENTAGE", "discountValue": 35, "maxDiscountAmount": 400, "usageType": "ONCE_PER_USER", "sortOrder": 2 }
  ],
  "removedOfferIds": ["68f1a2b3c4d5e6f7a8b9c2d1"],
  "newTags": ["monsoon"],
  "removedTags": ["discount"]
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher updated successfully.",
  "data": {
    "voucher": { "_id": "68f1a2b3c4d5e6f7a8b9c2a1", "status": "DRAFT", "currentVersionId": "68f1a2b3c4d5e6f7a8b9c2b2" },
    "version": {
      "_id": "68f1a2b3c4d5e6f7a8b9c2b2",
      "versionNumber": 2,
      "versionCode": "TDV000451-V2",
      "name": "flat 35% off on total bill",
      "status": "DRAFT",
      "isImmutable": false
    },
    "createdNewVersion": true
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Voucher not found.` | |
| `404` | `Voucher current version not found.` | Data inconsistency |
| `400` | `Voucher has no editable version.` | `currentVersionId` nahi |
| `409` | `Voucher is under review and cannot be edited.` | `UNDER_REVIEW` |
| `409` | `Archived voucher cannot be edited.` | `ARCHIVED` |
| `409` | `Paused voucher cannot be edited directly. Resume it first.` | `PAUSED` |
| `409` | `Expired voucher cannot be edited.` | `EXPIRED` |
| `409` | `Voucher cannot be edited from <STATUS> status.` | Baaki blocked statuses |
| `409` | `Voucher with this name already exists for this brand.` | Naya naam duplicate |
| `400` | `Voucher name cannot be empty.` | |
| `400` | `At least one offer is required.` | Sab offers hata diye |
| `400` | `At least one voucher image is required.` | Sab images hata di |
| `400` | `Maximum 5 voucher images are allowed.` | Limit cross |
| `400` | `At least one SubBrand is required.` | Sab outlets hata diye |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | |

### ⚠️ Edge cases & notes

**1. Delta-based hai, replace nahi.** `newOffers` add karta hai, `removedOfferIds` hataata hai. Poori list bhejne ki zarurat nahi — aur bhejni bhi nahi chahiye.

**2. Naya version kab banta hai:** agar current version `PUBLISHED` ya `APPROVED` ho (immutable), to naya `DRAFT` version banta hai. `DRAFT` version ho to wahi update hota hai. Response ka `createdNewVersion` batata hai kya hua.

**3. Published voucher edit karne se live version pe asar nahi padta** — customer ko purana published version dikhta rehta hai jab tak naya approve + publish na ho.

**4. Status-wise editability** — upar [Lifecycle](#voucher-apis) table dekho.

**5. Image limit combined check hoti hai** — existing − removed + new.

**6. `removedTags` / `newTags` JSON string bhi accept karte hain** (multipart ke liye).

---

## 56. POST /vouchers/submit-review/:voucherId

Voucher ko admin review ke liye bhejta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Path Params
| Param | Type | Required |
|---|---|---|
| `voucherId` | ObjectId | ✅ |

### Body
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher submitted for review successfully.",
  "data": {
    "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
    "versionId": "68f1a2b3c4d5e6f7a8b9c2b1",
    "versionNumber": 1,
    "status": "UNDER_REVIEW",
    "submittedAt": "2026-08-22T17:30:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Voucher not found.` | |
| `403` | `You are not authorized to submit this voucher.` | Dusre brand ka voucher |
| `400` | `Voucher has no editable version.` | |
| `404` | `Voucher version not found.` | |
| `400` | `Published voucher cannot be submitted directly. Create a new version first.` | Already published version submit karne ki koshish |
| `409` | `Voucher status changed. Please refresh and try again.` | Concurrent modification |
| `409` | `Voucher version status changed. Please refresh and try again.` | Version race |
| `400` | *(validation)* | Offers/images/dates adhoore |

### ⚠️ Notes

**1. Submit ke baad edit block ho jaata hai** — `UNDER_REVIEW` pe `PUT /vouchers/update` `409` dega. Admin approve/reject karne ke baad hi aage badh sakte hain.

**2. Pre-submit validation chalti hai** — `validateVoucherBeforeSubmit` offers, images, validity period sab check karta hai. Adhoora voucher submit nahi hoga.

**3. Concurrent-safe hai** — conditional update se, `modifiedCount !== 1` pe `409`. Do tabs se ek saath submit karne pe ek fail hoga.

**4. `VoucherApprovalHistory` entry banti hai** `SUBMITTED` action ke saath.

**5. Ye ownership `resolveActorBrand` se nahi karta** — apna check hai (`403 "You are not authorized to submit this voucher."`).

---

## 57. POST /vouchers/publish/:versionId

Approved version ko live karta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Path Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `versionId` | ObjectId | ✅ | ⚠️ **Version ka id**, voucher ka nahi |

### Body
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher published successfully.",
  "data": {
    "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
    "versionId": "68f1a2b3c4d5e6f7a8b9c2b1",
    "versionNumber": 1,
    "status": "PUBLISHED",
    "publishedAt": "2026-08-22T18:00:00.000Z",
    "isImmutable": true,
    "startAt": "2026-09-01T00:00:00.000Z",
    "endAt": "2026-10-01T23:59:59.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | `User authentication is required.` | |
| `400` | `Invalid voucher version ID.` | Format |
| `404` | `Voucher version not found.` | |
| `400` | `Only an approved voucher version can be published. Current status: DRAFT.` | Admin ne approve nahi kiya |
| `400` | `This voucher version is already immutable and cannot be published again.` | Dobara publish |
| `409` | `This voucher version is no longer the current version and cannot be published.` | Beech me naya version ban gaya |
| `400` | `Voucher cannot be published from <STATUS> status.` | Voucher-level status block |
| `404` | `Voucher not found.` | |
| `400` | `Voucher validity period is required.` | `startAt`/`endAt` nahi |
| `400` | `Voucher end date/time must be after voucher start date/time.` | |
| `400` | `Cannot publish an expired voucher version.` | `endAt` already nikal chuki |

### ⚠️ Notes

**1. `versionId` chahiye, `voucherId` nahi.** `GET /vouchers/versions/get-all` (#58) se lein.

**2. Sirf `APPROVED` version publish ho sakta hai** — admin ke `POST /vouchers/review/:versionId` ke baad.

**3. Publish karte hi version `isImmutable: true` ho jaata hai** — ab wo kabhi edit nahi ho sakta. Change chahiye to naya version.

**4. Expired voucher publish nahi hota** — `endAt` future me honi chahiye.

**5. Publish ke baad customer ko dikhne lagta hai** — `GET /vouchers/customer/get-all` me, agar outlet radius me ho aur `startAt <= now < endAt`.

**6. ⚠️ Ownership check yahan nahi hai** — service sirf `userId` leta hai, `resolveActorBrand` use nahi karta. Role gate hai par brand-level nahi ([Appendix B](#appendix-b--known-issues)).

---

## 58. GET /vouchers/versions/get-all

Voucher versions ki paginated list — vendor ka voucher dashboard.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | |
| `limit` | number | ❌ | `10` | |
| `search` | string | ❌ | – | Name/description/tags me text match |
| `brandId` | ObjectId | ⚠️ | – | **Vendor ko bhejna chahiye** — warna sabke vouchers |
| `voucherId` | ObjectId | ❌ | – | Ek voucher ke saare versions |
| `categoryId` · `subCategoryId` | ObjectId | ❌ | – | |
| `status` | string | ❌ | – | VOUCHER_STATUSES enum |
| `createdBy` · `submittedBy` · `reviewedBy` · `approvedBy` · `rejectedBy` | ObjectId | ❌ | – | |
| `versionNumber` | number | ❌ | – | |
| `versionCode` | string | ❌ | – | |
| `isImmutable` · `isActive` | boolean | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `NEWEST` | `DISTANCE` \| `NEWEST` \| `EXPIRING_SOON` \| `RELEVANCE` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

```http
GET /vouchers/versions/get-all?brandId=68f1a2b3c4d5e6f7a8b9c3a1&status=DRAFT&limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher versions fetched successfully",
  "data": {
    "total": 12,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c2b1",
        "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "versionNumber": 1,
        "versionCode": "TDV000451-V1",
        "name": "flat 30% off on total bill",
        "description": "Valid on dine-in and takeaway",
        "tags": ["coffee", "cafe"],
        "images": [{ "_id": "…", "url": "…", "sortOrder": 1 }],
        "offers": [
          { "_id": "…", "title": "30% off above 500", "minBillAmount": 500, "discountType": "PERCENTAGE", "discountValue": 30, "maxDiscountAmount": 300 }
        ],
        "status": "PUBLISHED",
        "startAt": "2026-09-01T00:00:00.000Z",
        "endAt": "2026-10-01T23:59:59.000Z",
        "isImmutable": true,
        "publishedAt": "2026-08-22T18:00:00.000Z",
        "submittedBy": { "_id": "…", "name": "rahul sharma" },
        "approvedBy": { "_id": "…", "name": "admin user" },
        "isActive": true,
        "createdAt": "2026-08-22T17:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any voucherversion found` | Empty — **empty-state** |
| `422` | `Invalid Voucher Id` / `Invalid Brand Id` | |
| `422` | *(Joi message)* — invalid `status`/`sortBy` | |

### ⚠️ Notes

**1. ⚠️ Scoped nahi hai.** Route pe sirf `verifyJwtToken` hai aur service `brandId` ko token se resolve nahi karti. **Vendor panel ko `brandId` explicitly bhejna chahiye** ([Appendix B](#appendix-b--known-issues)).

**2. Ye **versions** deta hai, vouchers nahi.** Ek voucher ke multiple versions honge. Voucher-wise group karna ho to `voucherId` se filter karein ya client-side group karein.

**3. `sortBy=RELEVANCE` bina `search` ke silently `NEWEST` ban jaata hai** — koi error nahi.

**4. `publish` (#57) ke liye `versionId` yahin se milta hai** — `status: "APPROVED"` filter karke.

---

## 59. POST /vouchers/:voucherId/banner

Voucher ka independent promo banner set/replace karta hai. **Multipart.**

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Path Params
| Param | Type | Required |
|---|---|---|
| `voucherId` | ObjectId | ✅ |

### Body (multipart)
| Field | Type | Required | Validation |
|---|---|---|---|
| `bannerType` | string | ✅ | `IMAGE` \| `VIDEO` \| `GIF` |
| `bannerImage` / `bannerVideo` / `bannerGif` | file | ✅ | **`bannerType` ke hisaab se sahi field name** |

| `bannerType` | File field | Allowed MIME |
|---|---|---|
| `IMAGE` | `bannerImage` | jpeg, jpg, png, webp |
| `VIDEO` | `bannerVideo` | mp4, webm, quicktime |
| `GIF` | `bannerGif` | gif |

```
bannerType:  IMAGE
bannerImage: <file>
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher banner saved successfully.",
  "data": {
    "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
    "banner": {
      "type": "IMAGE",
      "image": {
        "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/vouchers/banner-451.jpg",
        "storage": { "provider": "CLOUDINARY", "publicId": "vouchers/banner-451" }
      }
    }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Voucher not found.` | |
| `422` | `Please upload a image file for the voucher banner.` | File field missing/galat naam |
| `422` | `Banner type is required.` | |
| `422` | `Banner type must be one of: IMAGE, VIDEO, GIF.` | |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | |

### ⚠️ Notes

**1. Approval flow se bilkul independent hai.** Code comment: *"Never touches status/approval/versions — works regardless of the voucher's current version state."* Matlab published voucher ka banner bhi kabhi bhi badal sakte hain, bina naya version banaye.

**2. Purana banner auto-delete hota hai** — naya upload succeed hone ke baad Cloudinary se hat jaata hai.

**3. File field ka naam `bannerType` se match karna chahiye** — `bannerType: "VIDEO"` ke saath `bannerImage` bhejoge to `422` aayega.

**4. Ye voucher ke `images` se alag hai** — `images` version ka hissa hain (approval flow me), banner master-level hai.

---

## 60. DELETE /vouchers/:voucherId/banner

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Path Params
| Param | Type | Required |
|---|---|---|
| `voucherId` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Voucher banner deleted successfully.", "data": {} }
```

> Note: `data` khali hai — controller `sendSuccess(res, 200, "…")` bina data ke call karta hai.

### Errors
| Status | Message |
|---|---|
| `404` | `Voucher not found.` |
| `422` | `Voucher ID is required.` / `Invalid voucher ID.` |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` |

### ⚠️ Note
Cloudinary se file bhi delete hoti hai. Banner na ho tab bhi `200` aata hai (idempotent).

---

# Brand Feature APIs

Brand ke USP / highlight points — icon + title + description. Customer ko brand profile pe dikhte hain.

**Max 10 active features per brand.** Plan se metered **nahi** hain.
Global middleware: `router.use(verifyJwtToken)` — ⚠️ **koi role gate nahi**

## 61. POST /brandFeatures/add

**Multipart** (icon mandatory).

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Body (multipart)
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | Body me — token se resolve nahi hota |
| `title` | string | ✅ | – | 2–150 chars |
| `icon` | file | ✅ | – | **Multipart**, field name `icon` |
| `description` | string | ❌ | – | Max 500 chars, `""` allowed |
| `isActive` | boolean\|string | ❌ | `true` | |

```
brandId:     68f1a2b3c4d5e6f7a8b9c3a1
title:       Free WiFi
description: High speed internet for all guests
icon:        <file>
isActive:    true
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand feature added successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "title": "Free WiFi",
    "description": "High speed internet for all guests",
    "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/wifi.png",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T18:30:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | `brandId` galat ya deleted |
| `400` | `A brand can have maximum 10 active features!` | 10 active already hain |
| `400` | `Feature icon is required!` | File nahi bheji |
| `500` | `Failed to upload feature icon!` | Cloudinary fail |
| `422` | `Brand ID is required` / `Invalid Brand ID format` | |
| `422` | `Feature title is required` / `Feature title must be at least 2 characters` | |
| `422` | `Feature title cannot exceed 150 characters` | |
| `422` | `Feature description cannot exceed 500 characters` | |

### ⚠️ Notes

**1. 10-limit sirf active features pe hai.** `isActive: false` wale count nahi hote. 10 ho jaayein to kisi ko deactivate karke naya add kar sakte hain.

**2. `brandId` body me mandatory hai** — token se resolve nahi hota, aur ⚠️ ownership check bhi nahi hai. Koi bhi authenticated user kisi bhi brand ke features add kar sakta hai ([Appendix B](#appendix-b--known-issues)).

**3. Icon mandatory hai** — bina icon ke feature nahi banta.

**4. `title` lowercase me store nahi hota** — jaisa bhejo waisa rehta hai (baaki modules se different).

---

## 62. GET /brandFeatures/get-all

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | **Mandatory** |
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | `title` + `description` me match |
| `title` | string | ❌ | – | Sirf `title` me |
| `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | `title` \| `createdAt` \| `updatedAt` \| `isActive` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /brandFeatures/get-all?brandId=68f1a2b3c4d5e6f7a8b9c3a1&limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand features fetched successfully",
  "data": {
    "total": 4,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "title": "Free WiFi",
        "description": "High speed internet for all guests",
        "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/wifi.png",
        "isActive": true,
        "createdAt": "2026-08-22T18:30:00.000Z",
        "updatedAt": "2026-08-22T18:30:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | brandId galat — **real error** |
| `404` | `No any brandfeature found` | Brand sahi, features nahi — **empty-state** |
| `422` | `Brand ID is required` / `Invalid Brand ID format` | |

### ⚠️ Notes

**1. Do alag 404 messages hain** aur matlab alag hai:
- `"Brand not found!"` → brandId galat, real error dikhayein
- `"No any brandfeature found"` → empty-state dikhayein

**2. Vendor panel me `isActive` filter na lagayein** — vendor ko apne inactive features bhi dikhne chahiye (manage karne ke liye). Customer app `isActive=true` bhejta hai.

**3. Ye endpoint customer ko bhi khula hai** — brand profile page ke liye by design.

---

## 63. GET /brandFeatures/get/:featureId

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `featureId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Brand feature fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "title": "Free WiFi",
    "description": "High speed internet for all guests",
    "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/wifi.png",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T18:30:00.000Z",
    "updatedAt": "2026-08-22T18:30:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand feature not found!` |
| `422` | `Feature ID is required` / `Invalid Feature ID format` |

### ⚠️ Note
Practically vendor panel me shayad na chahiye — `get-all` (#62) me poora data aa jaata hai.

---

## 64. PUT /brandFeatures/update/:featureId

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `featureId` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `title` | string | 2–150 chars |
| `description` | string | Max 500, `""` allowed |
| `isActive` | boolean\|string | – |
| `icon` | file | **Multipart** — replace karne ke liye |

```json
{ "description": "High speed fibre internet, free for all guests", "isActive": true }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand feature updated successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
    "title": "Free WiFi",
    "description": "High speed fibre internet, free for all guests",
    "isActive": true,
    "updatedAt": "2026-08-22T18:40:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand feature not found!` | |
| `400` | `A brand can have maximum 10 active features!` | Inactive ko active karne pe limit cross |
| `422` | `Feature title must be at least 2 characters` | |
| `422` | `Invalid Feature ID format` | |

### ⚠️ Notes

**1. `isActive: false` → `true` karne pe 10-limit check hota hai.** Agar already 10 active hain to `400` aayega.

**2. Icon replace karne pe purana Cloudinary se delete hota hai.**

**3. ⚠️ Ownership check nahi hai** ([Appendix B](#appendix-b--known-issues)).

---

## 65. DELETE /brandFeatures/delete/:featureId

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `featureId` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Brand feature deleted successfully", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand feature not found!` |
| `422` | `Feature ID is required` / `Invalid Feature ID format` |

### ⚠️ Notes

**1. Soft delete hai** — `isDeleted: true`.
**2. Sirf hide karna ho to `isActive: false` (#64) behtar hai** — 10-limit se bhi bahar ho jaata hai aur wapas la sakte hain.

---

# Subscription Plan APIs

Available plans browse karne ke liye. Plans **admin** banata hai — vendor sirf padh sakta hai.

## 66. GET /subscriptions/getAll

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer ≥ 1 |
| `search` | string | ❌ | – | `""` allowed |
| `type` | string | ❌ | – | `WEEKLY` \| `MONTHLY` \| `QUATERLY` \| `HALF_YEARLY` \| `YEARLY` |
| `isActive` | boolean\|string | ❌ | – | `true` / `false` |
| `sortBy` | string | ❌ | – | `price` \| `name` \| `createdAt` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

```http
GET /subscriptions/getAll?isActive=true&sortBy=price&sortOrder=asc&limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscriptions fetched successfully",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9k001",
        "name": "BASIC",
        "type": "MONTHLY",
        "price": 999,
        "strikePrice": 1499,
        "discountType": "PERCENT",
        "discountPercent": 10,
        "durationInDays": 30,
        "entitlements": {
          "subBrands": { "limit": 3, "isUnlimited": false },
          "franchises": { "limit": 0, "isUnlimited": false },
          "vouchers": { "isEnabled": true },
          "showcase": { "isEnabled": true },
          "dealPack": { "isEnabled": false },
          "prioritySupport": { "isEnabled": false }
        },
        "features": [
          { "title": "Outlets", "value": "3", "available": true },
          { "title": "Vouchers", "value": "Unlimited", "available": true },
          { "title": "Priority Support", "value": "No", "available": false }
        ],
        "benefits": ["Listing on customer app", "Basic analytics"],
        "isActive": true,
        "createdAt": "2026-04-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subscription found` | Empty — **empty-state** |
| `422` | *(Joi message)* | Invalid `type`/`sortBy` |

### ⚠️ Notes

**1. `entitlements` structured hai aur enforce hota hai** — plan card pe yahi dikhana chahiye. `features[]` free-text hai, **sirf display ke liye**.

> Validator ka comment: *"Fixed key set on purpose … so an admin cannot invent a key that silently enforces nothing. This is what the gates read — `features[]` below stays free-text and display-only."*

**2. `isUnlimited: true` ho to `limit` ignore hota hai** — UI me "Unlimited" dikhayein.

**3. `strikePrice` cosmetic hai** — *"never used in any maths."* Sirf "was ₹1499" dikhane ke liye.

**4. `isActive=true` bhejein** — retired plans na dikhein.

**5. Plan chunne ke baad `POST /transactions/subscribe/preview` (#70) call karein** — actual payable amount (tax + promo ke saath) wahan se milta hai, `price` field se nahi.

---

## 67. GET /subscriptions/get/:id

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9k001",
    "name": "BASIC",
    "type": "MONTHLY",
    "price": 999,
    "durationInDays": 30,
    "entitlements": { "subBrands": { "limit": 3, "isUnlimited": false } },
    "features": [ ],
    "benefits": [ ],
    "isActive": true,
    "isDeleted": false
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Subscription not found` |
| `422` | *(invalid ObjectId)* |

---

# My Subscription APIs

Vendor ki apni subscription state. `resolveActorBrand` se scoped.

## 68. GET /subscribeds/get

Current subscription + entitlements + usage — **vendor dashboard ka main call**.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ❌ | **Vendor ke liye optional** (token se). Admin ke liye **required** |

```http
GET /subscribeds/get
```

### Success — `200` (active plan hai)
```json
{
  "success": true,
  "message": "Brand subscription details fetched successfully",
  "data": {
    "brand": {
      "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
      "brandName": "cafe mocha",
      "isSubscribed": true
    },
    "isSubscribed": true,
    "subscription": {
      "_id": "68f1a2b3c4d5e6f7a8b9f001",
      "status": "ACTIVE",
      "source": "PAYMENT",
      "isFreeGrant": false,
      "startDate": "2026-08-22T00:00:00.000Z",
      "endDate": "2026-09-21T23:59:59.000Z",
      "daysRemaining": 30,
      "durationLabel": "1 month",
      "paidAmount": 1178.82,
      "pricing": {
        "originalPrice": 999,
        "discount": 0,
        "promoDiscount": 0,
        "billValue": 999,
        "taxType": "CGST_SGST",
        "gstPercentage": 18,
        "taxAmount": 179.82,
        "payableAmount": 1178.82,
        "currency": "INR"
      },
      "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
      "plan": {
        "_id": "68f1a2b3c4d5e6f7a8b9k001",
        "name": "BASIC",
        "type": "MONTHLY",
        "typeLabel": "Monthly",
        "price": 999,
        "features": [ ],
        "benefits": [ ]
      }
    },
    "lastSubscription": null,
    "entitlements": {
      "subBrands": { "limit": 3, "isUnlimited": false },
      "franchises": { "limit": 0, "isUnlimited": false },
      "vouchers": { "limit": 20, "isUnlimited": false },
      "showcase": { "limit": 5, "isUnlimited": false },
      "dealPack": { "isEnabled": false },
      "prioritySupport": { "isEnabled": false }
    },
    "entitlementsSource": "DB",
    "entitlementWarnings": [],
    "usage": {
      "subBrands":  { "used": 3, "limit": 3,  "isUnlimited": false, "overflowBy": 0 },
      "franchises": { "used": 0, "limit": 0,  "isUnlimited": false, "overflowBy": 0 },
      "vouchers":   { "used": 4, "limit": 20, "isUnlimited": false, "overflowBy": 0 },
      "showcase":   { "used": 2, "limit": 5,  "isUnlimited": false, "overflowBy": 0 },
      "syncedAt": "2026-08-22T00:00:05.000Z"
    },
    "totalSubscriptions": 2
  }
}
```

### Success — `200` (koi active plan nahi)
```json
{
  "success": true,
  "message": "Brand subscription details fetched successfully",
  "data": {
    "brand": { "_id": "…", "brandName": "cafe mocha", "isSubscribed": false },
    "isSubscribed": false,
    "subscription": null,
    "lastSubscription": {
      "_id": "68f1a2b3c4d5e6f7a8b9f000",
      "status": "EXPIRED",
      "endDate": "2026-07-21T23:59:59.000Z",
      "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001"
    },
    "entitlements": null,
    "entitlementsSource": null,
    "entitlementWarnings": [],
    "usage": { "subBrands": { "used": 3, "limit": 0, "isUnlimited": false, "overflowBy": 3 } },
    "totalSubscriptions": 1
  }
}
```

> ✅ Empty pe **404 nahi** — `subscription: null` aata hai. `lastSubscription` se "expired on …" dikha sakte hain.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No brand is linked to your account` | Vendor ka brand nahi |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | Dusre brand ka `brandId` |
| `422` | `brandId is required when acting as an admin` | Admin ne `brandId` nahi diya |
| `422` | `Invalid brandId` | Format |

### ⚠️ Edge cases & notes

**1. Ye vendor dashboard ka single source of truth hai** — plan, dates, entitlements, usage sab ek call me. "3 of 10 outlets used" render karne ke liye alag lookup ki zarurat nahi.

**2. `isSubscribed` yahan **live computed** hai** (`status === ACTIVE && endDate > now`), `brand.isSubscribed` cache se nahi. Ispe bharosa karein.

**3. Self-healing hai** — agar koi doc `ACTIVE` claim kare par expire ho chuka ho, ye call use expire karke tab jawab deta hai.

**4. `usage[bucket].limit: null` matlab unlimited** — UI me "∞" ya "Unlimited" dikhayein.

**5. `overflowBy` grandfathered downgrade ke baad positive hota hai** — jaise 5 outlets the aur plan 3 ka ho gaya. Existing outlets chalte rehte hain, par naye nahi ban sakte. UI me warning dikhayein.

**6. `entitlementsSource` batata hai limits kahan se aaye:**
| Value | Matlab |
|---|---|
| `DB` | Plan ka structured `entitlements` — sahi case |
| `DERIVED` | Legacy free-text `features[]` se parse kiya |
| `DEFAULT` | Kuch samajh nahi aaya, conservative fallback laga |

`DERIVED` ya `DEFAULT` ho to admin ko us plan ko theek karna chahiye. `entitlementWarnings` me detail hoti hai.

**7. `daysRemaining` ready hai** — renewal reminder dikhane ke liye. Backend bhi `[7, 3, 1]` days pe reminder bhejta hai.

**8. `pricing` frozen snapshot hai** — jo actually charge hua tha wahi. Recompute nahi hota.

---

## 69. GET /subscribeds/history

Subscription ka audit trail.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ❌ | token ka brand | Admin ke liye required |
| `action` | string | ❌ | – | SUBSCRIPTION_HISTORY_ACTION enum |
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |

```http
GET /subscribeds/history?limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription history fetched successfully",
  "data": {
    "total": 6,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9n001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "subscribedId": "68f1a2b3c4d5e6f7a8b9f001",
        "action": "ACTIVATED",
        "performedByType": "VENDOR",
        "performedBy": { "_id": "…", "name": "rahul sharma" },
        "planName": "BASIC",
        "startDate": "2026-08-22T00:00:00.000Z",
        "endDate": "2026-09-21T23:59:59.000Z",
        "paidAmount": 1178.82,
        "note": null,
        "createdAt": "2026-08-22T00:00:05.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9n002",
        "action": "EXPIRED",
        "performedByType": "SYSTEM",
        "planName": "BASIC",
        "endDate": "2026-07-21T23:59:59.000Z",
        "createdAt": "2026-07-22T00:05:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9n003",
        "action": "UPGRADED",
        "performedByType": "VENDOR",
        "planName": "PREMIUM",
        "forfeitedDays": 12,
        "forfeitedValue": 399.6,
        "createdAt": "2026-06-10T00:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No brand is linked to your account` | |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | |
| `422` | `brandId is required when acting as an admin` | |
| `422` | *(Joi message)* | Invalid `action` enum |

### ⚠️ Notes

**1. `performedByType`:**
| Value | Kab |
|---|---|
| `VENDOR` | Vendor ne khud kiya |
| `ADMIN` | Admin ne kiya (grant, cancel) |
| `SYSTEM` | Expiry job |

**2. ⚠️ `UPGRADED` rows pe `forfeitedDays` / `forfeitedValue` dekhein.** Upgrade karne pe purana plan **turant** khatam ho jaata hai aur bache hue din **forfeit** ho jaate hain — koi proration nahi hoti.

Ye deliberately record hota hai taaki admin baad me compensate kar sake (`GET /subscribeds/admin/forfeited` worklist). Vendor panel ko upgrade se **pehle** ye clearly batana chahiye ki kitne din jaayenge.

**3. Vendor ko `brandId` bhejne ki zarurat nahi.**

> 📖 Poori design — pricing, tax, forfeit policy, entitlement sync → [subscription_lifecycle_design.md](./subscription_lifecycle_design.md)

---

# Payment APIs

Razorpay checkout flow. **3 steps + 1 utility.**

```
1. POST /transactions/subscribe/preview           → price dikhao (read-only)
2. POST /transactions/subscribe/create-order      → Razorpay order
   [ Razorpay checkout widget ]
3. POST /transactions/subscribe/verify-transaction → activate
```

⚠️ **Activation browser pe depend nahi karti.** Razorpay ka webhook (`POST /transactions/webhook/razorpay`) bhi settlement karta hai — vendor tab band kar de to bhi plan activate ho jaata hai. Step 3 fast-path hai, guarantee webhook deta hai.

## 70. POST /transactions/subscribe/preview

Checkout preview — **read-only**, koi state change nahi.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `subscriptionId` | ObjectId | ✅ | Plan ka id |
| `brandId` | ObjectId | ⚠️ | **Vendor ke liye optional** (token se), admin ke liye required |
| `promoCode` | string | ❌ | Max 40 chars, auto-uppercase + trim |
| `email` | string | ❌ | Valid email |
| `whatsappNumber` | string | ❌ | |

> ⚠️ **`amount` field jaanbujh kar nahi hai.** Payable amount server-side compute hota hai. Validator ka comment: *"It used to be accepted here and applied as `amount || price`, which let a caller buy any plan for ₹1."*

```json
{ "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001", "promoCode": "MONSOON20" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription checkout preview fetched successfully",
  "data": {
    "brand": { "_id": "68f1a2b3c4d5e6f7a8b9c3a1", "brandName": "cafe mocha", "isApproved": false },
    "plan": {
      "_id": "68f1a2b3c4d5e6f7a8b9k001",
      "name": "BASIC",
      "type": "MONTHLY",
      "typeLabel": "Monthly",
      "price": 999,
      "strikePrice": 1499,
      "discountType": "PERCENT",
      "discountPercent": 10,
      "durationInDays": 30,
      "durationLabel": "1 month",
      "benefits": ["Listing on customer app"],
      "limitations": [],
      "features": [{ "title": "Outlets", "value": "3", "available": true }],
      "entitlements": {
        "subBrands": { "limit": 3, "isUnlimited": false },
        "vouchers": { "limit": 20, "isUnlimited": false },
        "showcase": { "limit": 5, "isUnlimited": false }
      }
    },
    "action": "NEW",
    "currentPlan": null,
    "validity": {
      "startDate": "2026-08-22T00:00:00.000Z",
      "endDate": "2026-09-21T23:59:59.000Z",
      "durationLabel": "1 month"
    },
    "billingDetails": {
      "brandName": "mocha hospitality private limited",
      "address": "Shop 4, Scheme 54, Vijay Nagar, Indore, Madhya Pradesh, 452010",
      "gstin": "23AABCM1234K1ZP",
      "pan": "AABCM1234K",
      "addressSource": "BRAND_LOCATION"
    },
    "pricing": {
      "originalPrice": 1499,
      "discount": 500,
      "promoDiscount": 0,
      "taxableValue": 999,
      "taxType": "CGST_SGST",
      "gstPercentage": 18,
      "cgst": 89.91,
      "sgst": 89.91,
      "igst": 0,
      "taxAmount": 179.82,
      "totalPayable": 1178.82,
      "amountInPaise": 117882,
      "currency": "INR",
      "currencySymbol": "₹",
      "youSaved": 500
    },
    "orderSummary": {
      "rows": [
        { "key": "ORIGINAL_PRICE", "label": "Original Price", "amount": 1499, "display": "₹1,499.00" },
        { "key": "DISCOUNT", "label": "Discount (10%)", "amount": -500, "display": "- ₹500.00" },
        { "key": "BILL_VALUE", "label": "Bill Value", "amount": 999, "display": "₹999.00" },
        { "key": "TAX", "label": "CGST (9%)", "amount": 89.91, "display": "₹89.91" },
        { "key": "TAX", "label": "SGST (9%)", "amount": 89.91, "display": "₹89.91" }
      ],
      "payable": { "label": "You'll Pay", "amount": 1178.82, "display": "₹1,178.82" },
      "youSaved": 500,
      "youSavedDisplay": "₹500.00",
      "savedText": "You saved ₹500.00 on This Plan"
    },
    "limits": {
      "subBrands": { "used": 0, "limit": 3, "isUnlimited": false, "overflowBy": 0 },
      "franchises": { "used": 0, "limit": 0, "isUnlimited": false, "overflowBy": 0 },
      "vouchers": { "used": 0, "limit": 20, "isUnlimited": false, "overflowBy": 0 },
      "showcase": { "used": 0, "limit": 5, "isUnlimited": false, "overflowBy": 0 }
    },
    "promo": {
      "supported": false,
      "applied": null,
      "message": "Promo codes are coming soon"
    },
    "canProceed": true,
    "blockedReason": null,
    "notices": []
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Subscription plan not found!` | |
| `422` | `This subscription plan is no longer available.` | Plan `isActive: false` |
| `422` | `Subscription plan "BASIC" has no duration configured. Please contact support.` | Plan misconfigured |
| `422` | `This promo code is not valid.` | Strict promo mode me |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | |
| `422` | `brandId is required when acting as an admin` | |
| `404` | `No brand is linked to your account` | |

### ⚠️ Edge cases & notes

**1. Safe to call repeatedly.** Read-only — koi Razorpay call nahi, koi `Transaction` row nahi. Plan card switch karte waqt har baar call kar sakte hain.

**2. Yahi amount Razorpay tak jaata hai.** Comment: *"The amount here is produced by the same code path order creation uses, so the 'You'll Pay' figure shown is the figure that reaches Razorpay."* Frontend ko koi arithmetic nahi karni.

**3. `orderSummary.rows` ko as-is render karein** — labels, amounts, display strings sab ready hain. Comment: *"The checkout page renders these in order and does no arithmetic of its own."*

**4. `canProceed` + `blockedReason` check karein** — `false` ho to pay button disable karein aur `blockedReason` dikhayein. Jaise vendor downgrade ki koshish kare (`allowVendorDowngrade: false`).

**5. `action` batata hai kya ho raha hai:**
| Value | UI copy |
|---|---|
| `NEW` | "Subscribe" |
| `RENEW` | "Renew" |
| `UPGRADE` | ⚠️ "Upgrade — bache hue X din forfeit honge" |
| `DOWNGRADE` | Vendor ke liye usually blocked |

**6. ⚠️ Upgrade pe forfeit warning dikhayein.** Upgrade purana plan turant khatam karta hai, koi proration nahi. `notices` array me warning aa sakti hai.

**7. Promo codes abhi off hain by default** (`isPromoCodeEnabled: false`). `promo.supported: false` aur message `"Promo codes are coming soon"` aata hai. Code bhejne pe silently full price charge **nahi** hoga — message clearly batayega.

**8. Tax type location se decide hota hai** — `CGST_SGST` (intra-state) ya `IGST` (inter-state). Agar admin ne `companyStateCode` set nahi kiya to fallback `IGST` hota hai.

**9. `limits` naye plan ke hisaab se hain**, current ke nahi — "upgrade karne pe kya milega" dikhane ke liye.

---

## 71. POST /transactions/subscribe/create-order

Razorpay order banata hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
Same as #70 — `subscriptionId` (✅), `brandId` (⚠️), `promoCode`, `email`, `whatsappNumber`.

```json
{ "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscribe transaction order created successfully",
  "data": {
    "transaction": {
      "_id": "68f1a2b3c4d5e6f7a8b9m001",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001",
      "razorpayOrderId": "order_PxYzAbC123",
      "status": "created",
      "verified": false,
      "pricing": { "totalPayable": 1178.82, "amountInPaise": 117882, "currency": "INR" },
      "createdAt": "2026-08-22T19:00:00.000Z"
    },
    "plan": { "_id": "…", "name": "BASIC", "type": "MONTHLY", "price": 999 },
    "pricing": { "totalPayable": 1178.82, "amountInPaise": 117882, "currency": "INR" },
    "orderSummary": { "rows": [ ], "payable": { "amount": 1178.82, "display": "₹1,178.82" } },
    "billingDetails": { "brandName": "…", "gstin": "…", "pan": "…" },
    "razorpay": {
      "orderId": "order_PxYzAbC123",
      "amount": 117882,
      "currency": "INR",
      "keyId": "rzp_test_XXXXXXXXXXXX"
    },
    "reused": false
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Subscription plan not found!` | |
| `422` | `This subscription plan is no longer available.` | |
| `403` | *(preview ka `blockedReason`)* | `canProceed: false` — jaise downgrade blocked |
| `422` | `This plan has no payable amount. An admin can grant it directly instead.` | ₹0 plan — admin grant use karein |
| `503` | `Razorpay services unavailable! Please try again later` | Gateway down |
| `403` | `Forbidden: You do not have permission to perform this action on this brand.` | |
| `422` | `brandId is required when acting as an admin` | |

### ⚠️ Edge cases & notes

**1. `razorpay` object seedha checkout widget me pass karein:**
```js
const rzp = new Razorpay({
  key: data.razorpay.keyId,
  order_id: data.razorpay.orderId,
  amount: data.razorpay.amount,      // paise me
  currency: data.razorpay.currency,
  handler: (res) => {
    // res.razorpay_payment_id, razorpay_order_id, razorpay_signature
    // → POST /transactions/subscribe/verify-transaction
  },
});
```

**2. `amount` paise me hai** — `117882` = ₹1,178.82. Razorpay isi format me maangta hai.

**3. `reused: true` aa sakta hai.** Agar same brand + plan ka ek order abhi bhi open hai (default 15 min ke andar), to naya nahi banta — wahi wapas milta hai. Comment: *"rather than leaving a trail of abandoned Razorpay orders every time the page is reloaded."* Window `Setting.vendor.subscription.pendingOrderReuseMinutes` se configurable hai.

**4. `transaction._id` sambhal ke rakhein** — step 3 (#72) me `transactionId` chahiye hoga.

**5. ₹0 plan pe order nahi banega** — free plan admin `POST /subscribeds/admin/grant` se deta hai.

**6. History me `ORDER_CREATED` entry banti hai** — `source: PAYMENT` (vendor) ya `ADMIN_PAYMENT` (admin).

---

## 72. POST /transactions/subscribe/verify-transaction

Payment verify karke subscription activate karta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Body
| Field | Type | Required | Notes |
|---|---|---|---|
| `razorpayPaymentId` | string | ✅ | Checkout handler se |
| `razorpayOrderId` | string | ✅ | Checkout handler se |
| `razorpaySignature` | string | ✅ | Checkout handler se |
| `transactionId` | ObjectId | ✅ | **#71 ke response se.** Pehle optional tha — *"which let a verify request through with nothing to verify"* |

```json
{
  "razorpayPaymentId": "pay_PxYzDeF456",
  "razorpayOrderId": "order_PxYzAbC123",
  "razorpaySignature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d",
  "transactionId": "68f1a2b3c4d5e6f7a8b9m001"
}
```

### Success — `200` (nayi activation)
```json
{
  "success": true,
  "message": "Payment successful! Congratulations — your subscription has been successfully activated",
  "data": {
    "alreadyVerified": false,
    "transaction": {
      "_id": "68f1a2b3c4d5e6f7a8b9m001",
      "status": "captured",
      "verified": true,
      "razorpayPaymentId": "pay_PxYzDeF456",
      "invoiceSnapshot": {
        "invoiceId": "TDI-2026-000451",
        "invoiceUrl": "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/TDI-2026-000451.pdf"
      }
    },
    "subscribed": {
      "_id": "68f1a2b3c4d5e6f7a8b9f001",
      "status": "ACTIVE",
      "source": "PAYMENT",
      "startDate": "2026-08-22T00:00:00.000Z",
      "endDate": "2026-09-21T23:59:59.000Z",
      "paidAmount": 1178.82
    },
    "action": "NEW",
    "usage": {
      "subBrands": { "used": 0, "limit": 3, "isUnlimited": false, "overflowBy": 0 },
      "vouchers": { "used": 0, "limit": 20, "isUnlimited": false, "overflowBy": 0 },
      "showcase": { "used": 0, "limit": 5, "isUnlimited": false, "overflowBy": 0 }
    }
  }
}
```

### Success — `200` (already verified)
```json
{
  "success": true,
  "message": "This payment has already been verified. Your subscription is active.",
  "data": { "alreadyVerified": true, "subscribed": { "status": "ACTIVE" } }
}
```

> ✅ Message alag hai. Controller ka comment: *"A replayed verification is a success, not a new activation — say so rather than congratulating the vendor twice for one payment."*

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Transaction not found!` | `transactionId` galat |
| `422` | `This transaction was not created through Razorpay.` | Manual/admin grant transaction |
| `422` | `This payment does not belong to the given transaction.` | `razorpayOrderId` mismatch |
| `403` | `You are not authorized to verify this payment request` | Dusre brand ka transaction |
| `400` | `Invalid signature. Payment may be tampered.` | HMAC fail |
| `503` | `Razorpay services unavailable! Please try again later` | Gateway down |
| `422` | `transactionId is required` / `Invalid transactionId` | |
| `422` | `razorpayPaymentId is required` | |

### ⚠️ Edge cases & notes

**1. Idempotent hai** — dobara call karne pe `alreadyVerified: true` aata hai, double activation nahi hoti. Network retry safe hai.

**2. Webhook race handle hota hai.** Webhook aur ye endpoint dono settle kar sakte hain. Settlement transaction ko **conditionally claim** karta hai, to jo pehle aaye wahi activate karta hai, doosra `alreadyVerified` report karta hai.

**3. Ye step **optional** hai (technically).** Agar vendor payment ke baad tab band kar de, webhook phir bhi activate kar dega. Ye fast-path hai taaki UI turant confirm dikha sake.

**4. Invoice PDF auto-generate hota hai** — `invoiceSnapshot.invoiceUrl` se download link milta hai.

**5. `usage` response me aata hai** — activation ke baad naye limits turant dikha sakte hain.

**6. Signature verify HMAC se hota hai** — tampered payload `400` dega.

---

## 73. POST /transactions/invoice/regenerate

Invoice PDF dobara issue karta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Body
| Field | Type | Required |
|---|---|---|
| `transactionId` | ObjectId | ✅ |

```json
{ "transactionId": "68f1a2b3c4d5e6f7a8b9m001" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Invoice re-issued successfully",
  "data": {
    "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
    "invoice": {
      "invoiceId": "TDI-2026-000451",
      "invoiceUrl": "https://res.cloudinary.com/drvdnqydw/raw/upload/v1/invoices/TDI-2026-000451.pdf",
      "issuedAt": "2026-08-22T19:30:00.000Z"
    },
    "wasBackfilled": false
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Transaction not found!` | |
| `404` | `Brand not found!` | |
| `403` | `Forbidden: You do not have permission to access this invoice.` | Dusre brand ka transaction |
| `422` | `This transaction has no completed payment, so there is no invoice to issue.` | Unpaid order |
| `422` | `This transaction has no stored pricing breakdown, so its invoice cannot be rebuilt.` | Purana transaction bina pricing ke |
| `422` | `transactionId is required` / `Invalid transactionId` | |

### ⚠️ Notes

**1. Amounts kabhi recompute nahi hote.** Invoice transaction pe **frozen pricing** se banta hai — matlab purana invoice exactly wahi dikhata hai jo tab charge hua tha, chahe plan ka price ya GST rate baad me badal gaya ho.

**2. `wasBackfilled: true`** matlab is transaction ka invoice snapshot pehle nahi tha aur ab pricing se reconstruct kiya gaya. Purane transactions pe aisa ho sakta hai.

**3. Vendor sirf apna invoice le sakta hai**, admin koi bhi.

**4. Manual admin grants pe bhi kaam karta hai** — wo creation pe hi captured mark hote hain, to `verified` check pass ho jaata hai.

---

# Master Data APIs

Categories aur sub-categories. **Admin** manage karta hai, vendor sirf padhta hai (onboarding me brand ki category chunne ke liye).

## 74. GET /categories/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | |
| `limit` | number | ❌ | `10` | ⚠️ Default chhota hai |
| `search` | string | ❌ | – | `name` + `description` me |
| `name` | string | ❌ | – | Sirf `name` me |
| `isActive` | boolean\|string | ❌ | – | **Bhejein** — warna inactive bhi aayenge |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | Validate nahi hota |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /categories/getAll?isActive=true&limit=50&sortBy=name&sortOrder=asc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Categories fetched",
  "data": {
    "total": 12,
    "totalPages": 1,
    "page": 1,
    "limit": 50,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c0e1",
        "name": "food & beverages",
        "description": "restaurants, cafes, and food outlets",
        "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/food.jpg",
        "isActive": true,
        "createdAt": "2026-05-10T08:00:00.000Z",
        "stats": {
          "subCategories": { "total": 6, "active": 5 },
          "brands":        { "total": 48, "active": 41 },
          "vouchers":      { "total": 130, "active": 96 },
          "promoCodes":    { "total": 3, "active": 2 }
        }
      }
    ]
  }
}
```

**Projected fields only:** `_id`, `name`, `description`, `image`, `isActive`, `createdAt`, `stats`

### Errors
| Status | Message |
|---|---|
| `404` | `No any category found` — **empty-state** |
| `422` | *(Joi message)* |

### ⚠️ Notes
**1. Default `limit` 10 hai** — onboarding dropdown ke liye badhayein (`limit=50`).
**2. `isActive=true` bhejein.**
**3. Names lowercase me aate hain** — display pe capitalize karein.

**4. `stats` vendor panel ke liye nahi hai.** Ye endpoint teeno consumers share karte hain aur counts admin panel ke liye add hue the — onboarding ke category dropdown me inhe ignore karein. `stats.brands` platform-wide ginti hai, vendor ke apne brands ki nahi.

Shape: `subCategories` / `brands` / `vouchers` / `promoCodes`, har ek me `{ total, active }`. Poori detail super admin doc ke `GET /categories/getAll` me hai.

---

## 75. GET /categories/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Category fetched",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0e1",
    "name": "food & beverages",
    "description": "restaurants, cafes, and food outlets",
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/food.jpg",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-05-10T08:00:00.000Z",
    "updatedAt": "2026-05-10T08:00:00.000Z",
    "stats": {
      "subCategories": { "total": 6, "active": 5 },
      "brands":        { "total": 48, "active": 41 },
      "vouchers":      { "total": 130, "active": 96 },
      "promoCodes":    { "total": 3, "active": 2 }
    }
  }
}
```

> `getAll` ke mukable **poora document** aata hai. `stats` wahi hai — [#74](#74-get-categoriesgetall) dekhein.

### Errors
| Status | Message |
|---|---|
| `404` | `Category not found` |
| `422` | `Invalid Category Id` |

---

## 76. GET /subCategories/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
Same as [#74](#74-get-categoriesgetall), plus:

| Param | Type | Required | Notes |
|---|---|---|---|
| `categoryId` | ObjectId | ❌ | Ek category ke sub-categories. ⚠️ Invalid ObjectId pe **500** aa sakta hai (validate nahi hota) |

```http
GET /subCategories/getAll?categoryId=68f1a2b3c4d5e6f7a8b9c0e1&isActive=true&limit=50
```

### Success — `200`
```json
{
  "success": true,
  "message": "Sub-categories fetched",
  "data": {
    "total": 8,
    "totalPages": 1,
    "page": 1,
    "limit": 50,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c0f1",
        "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
        "name": "cafe",
        "description": "coffee shops and cafes",
        "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/cafe.jpg",
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-05-10T09:00:00.000Z",
        "updatedAt": "2026-05-10T09:00:00.000Z",
        "stats": {
          "brands":   { "total": 12, "active": 10 },
          "vouchers": { "total": 34, "active": 28 }
        }
      }
    ]
  }
}
```
> `stats` yahan sirf `brands` aur `vouchers` rakhta hai — `promoCodes` sirf category level pe hota hai. Vendor panel ke liye ye counts relevant nahi, [#74](#74-get-categoriesgetall) ka note dekhein.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subcategory found` | **Empty-state** |
| `500` | *(cast error)* | `categoryId` invalid ObjectId format |

### ⚠️ Note
Onboarding me brand ki category set karne ke liye `PUT /brands/update` (#32) pe `subCategoryId` bhejein — `categoryId` khud resolve ho jaata hai.

---

## 77. GET /subCategories/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Sub-category fetched",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0f1",
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "name": "cafe",
    "description": "coffee shops and cafes",
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/cafe.jpg",
    "isActive": true,
    "isDeleted": false,
    "stats": {
      "brands":   { "total": 12, "active": 10 },
      "vouchers": { "total": 34, "active": 28 }
    }
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `422` | `Invalid SubCategory Id` |

---

# Legal APIs

Terms & Conditions aur Privacy Policy — read-only. Admin manage karta hai.

## 78. GET /terms-and-conditions/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | |
| `limit` | number | ❌ | `10` | |
| `search` | string | ❌ | – | `title` + `description` |
| `title` | string | ❌ | – | |
| `isActive` | boolean\|string | ❌ | – | **Bhejein** |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

### Success — `200`
```json
{
  "success": true,
  "message": "Terms and conditions fetched",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c9a1",
        "title": "vendor terms of service",
        "type": "VENDOR",
        "description": "<p>By listing on Trydood you agree to...</p>",
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-04-01T00:00:00.000Z",
        "updatedAt": "2026-07-15T00:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any termandcondition found` — **empty-state** |
| `422` | *(Joi message)* |

### ⚠️ Notes

**1. `description` me HTML hota hai** — admin panel se rich-text aata hai. WebView ya HTML renderer use karein, plain text nahi.

**2. `type` free-form string hai** (enum nahi) — `"VENDOR"`, `"CUSTOMER"` jaisi values ho sakti hain. **API me `type` filter param nahi hai**, to vendor-relevant records **client-side** filter karne padenge.

**3. Multiple records ho sakte hain** — sections me split. `sortBy=createdAt&sortOrder=asc` se consistent order.

**4. Onboarding ke partnership deed step (#25) se pehle ye dikhana chahiye.**

---

## 79. GET /terms-and-conditions/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Term and condition fetched",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c9a1",
    "title": "vendor terms of service",
    "type": "VENDOR",
    "description": "<p>By listing on Trydood you agree to...</p>",
    "isActive": true,
    "isDeleted": false
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Term and condition not found` |
| `422` | `Invalid TermAndCondition Id` |

---

## 80. GET /privacy-and-policies/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
Same as [#78](#78-get-terms-and-conditionsgetall).

### Success — `200`
```json
{
  "success": true,
  "message": "Privacys and policies fetched",
  "data": {
    "total": 2,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9ca01",
        "title": "privacy policy",
        "type": "VENDOR",
        "description": "<p>We collect the following information...</p>",
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-04-01T00:00:00.000Z"
      }
    ]
  }
}
```

> Note: success message me typo hai — `"Privacys and policies fetched"`. Backend me aisa hi hai; message pe match na karein, `success` flag pe karein.

### Errors
| Status | Message |
|---|---|
| `404` | `No any privacyandpolicy found` — **empty-state** |
| `422` | *(Joi message)* |

---

## 81. GET /privacy-and-policies/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Privacy and policy fetched",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9ca01",
    "title": "privacy policy",
    "type": "VENDOR",
    "description": "<p>We collect the following information...</p>",
    "isActive": true,
    "isDeleted": false
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Privacy and policy not found` |
| `422` | `Invalid PrivacyAndPolicy Id` |

---

# Voucher Claim APIs 🆕

Grahak ne mere outlet par kya khareeda, aur mujhe kitna milega.

> **Phase 1 me poori tarah read-only.** Capture par claim seedhe `REDEEMED` ho jaati hai
> (`redemptionMode: AUTO`) — **payment hi redemption hai**. Outlet scan aur reversal
> Phase 2 hain, `docs/customer_voucher_claim_plan.md` §15.1 dekhein.

## ⚠️ Ek endpoint, teen shapes

Ye wahi URLs hain jo customer app use karta hai. **Scope aur projection dono token se
nikalte hain** — vendor token bhejne par vendor ka jawab aata hai, `SUB_VENDOR` token
bhejne par sirf us outlet ka.

| Field | Vendor / Outlet | Kyun |
|---|:-:|---|
| `voucher.vendorPayable` · `pricing.netBill` | ✅ | Aapko kitna milega |
| `voucher.vendorPromoCost` | ✅ | Promo me aapka hissa |
| `gatewayFee` · `netReceived` | ❌ | Razorpay ne **humse** kya liya — commercial disclosure |
| `voucher.platformPromoCost` | ❌ | Promo me hamara hissa |
| `email` · `contact` · `customerId` | ❌ | Grahak ki privacy |
| `invoiceDownloadUrl` | ❌ | Grahak ka tax invoice uske apne details rakhta hai |

Ye faisla `claimProjection()` me **ek jagah** hota hai, har endpoint par yaad nahi rakha
jaata — teen alag endpoint hote to ek jagah bhoolna leak ban jaata, aur wo listing me nahi,
detail page par milta, jise koi jaanchta nahi.

## 82. GET /voucher-claims — mere brand ki claims

**Access:** 🔒 `verifyJwtToken` — `VENDOR` aur `SUB_VENDOR` dono

`SUB_VENDOR` token isi URL par **sirf apne outlet** ki rows paata hai, brand ki poori nahi.

| Param | Default | Notes |
|---|---|---|
| `page` / `limit` | `1` / `20` | `limit` max **100** |
| `status` | – | `PENDING · PAID · REDEEMED · FAILED · CANCELLED · EXPIRED · REFUNDED` |
| `outletId` | – | Outlet-wise report |
| `claimCode` | – | Poora code |
| `from` / `to` | – | ISO date. `to` **poora din** include karta hai |

⚠️ **Scope query se chaudi nahi ho sakti.** `?brandId=<dusra brand>` bhejne par **kuch
nahi** milta — apne rows nahi. Filter aur scope intersect hote hain, isliye galat filter
par khaali jawab aata hai, chup-chaap galat jawab nahi.

Khaali list `200` + `data: []` hai, `404` nahi.

---

## 83. GET /voucher-claims/payments — mere brand ke payments

**Access:** 🔒 `verifyJwtToken`

*"Kaunsa paisa hila"*. `status` yahan **payment** ki vocabulary hai —
`created · authorized · captured · failed`.

Settlement ke fields bhi yahin: `settlementId`, `settlementHold`, `paidToVendorAt`.

---

## 84. GET /voucher-claims/payments/:transactionId — ek payment

**Access:** 🔒 `verifyJwtToken`

| Status | Kab |
|---|---|
| `404` | Id galat **ya** row kisi aur ka — dono ka ek hi jawab |
| `403` | Dusre brand ka, ya `SUB_VENDOR` ke liye dusre outlet ka |
| `422` | Malformed id |

⚠️ **Apna subscription payment yahan nahi khulta.** Ek hi collection vendor subscriptions
aur customer voucher claims dono rakhti hai; `purpose` scope hi use rokta hai. Apni
subscription ke liye `/transactions/...` use karein.

---

## 85. GET /voucher-claims/:claimId — ek claim, timeline ke saath

**Access:** 🔒 `verifyJwtToken`

`claim` · `payment` · `brand` · `outlet` · **`timeline`** · `viewer`

Timeline har audience ke liye **banayi** jaati hai, chhaani nahi. Aapko har row se
`label` · `at` · `fromStatus` → `toStatus` · `by` milta hai. Kaccha audit row `snapshot`
me poora pricing block rakhta hai (`platformPromoCost` samet) aur `reason` staff ka note
hai — dono me se kuch nahi aata.

---

## 86. GET /voucher-claims/code/:claimCode — counter par verify

**Access:** 🔒 `verifyJwtToken`

Counter par grahak code dikhaata hai, staff yahan daalta hai: **kitna pay hua, kaunsa
offer, kab, kaunsa outlet**.

⚠️ **Code lookup ko narrow karta hai, authorise nahi karta.** Dusre brand ya dusre outlet
ka code `403` deta hai — kisi aur ki screen se padha gaya code kuch nahi kholta.

Code `TD-` + 6 characters `34679ACDEFGHJKMNPQRTUVWXY` me se. `0/O`, `1/I/L`, `5/S`, `2/Z`,
`8/B` chhode gaye hain kyunki ye counter par bolkar padhe jaate hain. Galat character wale
code par `422` *"mistyped character"* — `404` lagta hai claim maujood hi nahi.

> **Phase 2 me yahi surface redeem karega.** Uske saath dobara-scan ka samajhdaar jawab
> aur reversal bhi aayenge — teeno ek saath. Sirf scan deploy karna grahak ko phansa deta
> hai: scan chala nahi, saamaan mila nahi, aur *"already redeemed"*.

---

# Refund APIs 🆕

**Aap tay karte hain, Trydood sirf nikaalta hai.** Normal raaste par Trydood doosra gate
nahi hai — aap approve karein, paisa chala jaata hai.

## ⚠️ Aapke paas ek window hai

`refund.vendorApprovalHours` (default **24**), aur wo `vendorRespondBy` par row me likhi
hoti hai. Beet gayi to request **aapki rehti hi nahi** — Trydood ke paas chali jaati hai,
aur aap uspar kuch nahi kar sakte (`409` *"already gone to Trydood for review"*). Do
reminder pehle aate hain, taaki timeout kabhi achanak na ho.

Ek chup outlet grahak ka paisa nahi rok sakta — par window ke andar faisla aapka hi hai.

## 87. GET /refunds — mere brand ki refunds

**Access:** 🔒 `verifyJwtToken` — `VENDOR` aur `SUB_VENDOR` dono

`SUB_VENDOR` token isi URL par **sirf apne outlet** ki rows paata hai.

| Param | Notes |
|---|---|
| `open=true` | **Worklist** — sabse purani upar, kyunki wahi timeout ke sabse kareeb hai aur usi grahak ne sabse lamba intezaar kiya |
| `status` | `REQUESTED · VENDOR_APPROVED · VENDOR_REJECTED · VENDOR_TIMEOUT · ADMIN_APPROVED · ADMIN_REJECTED · ADMIN_OVERRIDE · PROCESSING · COMPLETED · FAILED · CANCELLED` |
| `claimCode` · `outletId` · `from` / `to` | Narrow karne ke liye |

### Aapko kya dikhta hai

| Field | Aapko | Kyun |
|---|:-:|---|
| `reasonNote` | ✅ | Grahak ne kya kaha — aapke faisle ka poora aadhaar |
| `split.vendorClawback` | ✅ | Aapse kitna katega |
| `split.vendorPromoReversal` | ✅ | Promo me aapka hissa, wapas |
| `split.platformPromoReversal` · `gatewayFeeAbsorbed` | ❌ | Hamara margin — commercial disclosure |
| `vendorNote` | ✅ (apna) | |
| `adminNote` · `overrideReason` | ❌ | Staff-to-staff, aur override aapke khilaf liya faisla naam leta hai |
| `customerId` | ❌ | Privacy |

⚠️ `split` me hamara promo hissa aur MDR **usi sub-document par** hain jis par
`vendorClawback` hai, jo aapko sach me chahiye. Isiliye ye faisla `refundProjection()` me
**ek jagah** hota hai.

`canDecide` response me **bataya** jaata hai — panel ko status se andaza nahi lagana chahiye.

---

## 88. PATCH /refunds/:requestId/approve — haan

**Access:** 🔒 `verifyJwtToken` — `VENDOR` / `SUB_VENDOR` (apne outlet ka)

| Field | Zaroori | Notes |
|---|:-:|---|
| `approvedAmount` | — | Na do to poora |
| `note` | — | |

### ⚠️ Rakam **ghat** sakti hai, **badh nahi**

*"Aadha order theek tha, starter nahi"* asli jawab hai, aur rakam kam karna use dene ka
tareeka hai. Badhana grahak ne jo maanga uski approval nahi — wo naya faisla hai, aur is
step par ek extra shunya **das guna** pay out kar deta us aadmi ko jisne maanga hi nahi.
`422` milega.

Split wahin **dobara freeze** hota hai — jo paisa asal me hilega wahi block me likha hona
chahiye.

Hold **laga rehta hai**: paisa abhi bhi wapas jaana hai.

> **Do log ek hi request nahi tay kar sakte.** `status` update filter ka hissa hai. Owner
> aur outlet manager ek hi request dekh sakte hain; iske bina dono clicks lagte aur doosra
> pehle ko chup-chaap mita deta — yaani grahak ka jawab is par nirbhar karta ki kaun dheema
> tha. Haarne wale ko `409` milta hai jo **batata hai kya hua**, sirf ye nahi ki nakaam raha.

---

## 89. PATCH /refunds/:requestId/reject — na

**Access:** 🔒 `verifyJwtToken` — `VENDOR` / `SUB_VENDOR`

`note` **zaroori** (min 3 chars). Jab grahak inkaar ko chunauti de, admin ke paas sameeksha
karne ko yahi ek cheez hoti hai — akela *"rejected"* har appeal ko phone call bana deta hai.

⚠️ Aapka note **grahak ko kabhi nahi dikhta**. Wo staff ke liye hai.

### `settlementHold` yahin hattta hai

Refund maangte hi aapke us claim ka paisa har settlement se bahar ho jaata hai. Reject
karne par wo **wapas aa jaata hai**.

> Ye ulta utna hi khatarnak hai: jo hold koi na hataaye wo aapka paisa **hamesha ke liye**
> har aane wali settlement se bahar kar deta hai — chup-chaap, kyunki eligibility predicate
> bas match karna band kar deta hai. Koi error nahi aata. Isiliye teeno terminal states se
> release bulaya jaata hai.

Ek apwaad: us payment par **chargeback** khula ho to hold nahi hattta. Use hataana explicit
admin action hai — refund ki logic se hataane ka matlab hota wo paisa settle kar dena jise
bank usi waqt wapas kheench raha hai.

---

## 90. GET /refunds/:requestId — ek refund

**Access:** 🔒 `verifyJwtToken`

`refund` · `claim` · **`timeline`** · `viewer`. Timeline claim ki hai, aur har audience ke
liye **banayi** jaati hai — kaccha audit row `snapshot` me poora pricing block rakhta hai
(`platformPromoCost` samet).

---

## Refund ke notifications

| Kab | Severity | Kya |
|---|:-:|---|
| Refund maanga gaya | ⚠️ WARNING | *"Please respond by \<date\> — after that it goes to Trydood"* |
| Window band ho rahi hai | ⚠️ WARNING | Do nudges, adhe aur teen-chauthai par |

WARNING isliye ki deadline hai, aur use chookne par faisla aapke haath se nikal jaata hai.

---

# Appendix A — Not For Vendor Panel

Ye 62 endpoints backend me hain par vendor panel inko use na kare. Zyada tar ab properly gated hain (`403` denge), par kuch pe abhi bhi role check nahi hai — un pe app ko khud discipline rakhni hogi.

### 🔒 Properly gated — `403` aayega

| Module | Endpoints | Gate |
|---|---|---|
| **Promo Codes** | `POST /promoCodes/create` · `GET /get-all` · `GET /reports` · `GET /get/:id` · `PUT /update/:id` · `DELETE /delete/:id` | `router.use(isAdmin)` |
| **Subscription admin ops** | `POST /subscribeds/admin/grant` · `PUT /admin/cancel` · `GET /admin/get-all` · `GET /admin/forfeited` · `PUT /admin/forfeited/compensate` · `PUT /admin/resync` | `isAdmin` |
| **Webhook ops** | `GET /transactions/webhook/events` · `GET /webhook/events/:eventId` · `POST /webhook/replay/:eventId` · `GET /transactions/disputes` | `isAdmin` |
| **Voucher approval** | `POST /vouchers/review/:versionId` | `isAdmin` |
| **Brand verification review** | `GET /brands/admin/verifications` · `PUT /brands/admin/verifications/:brandId/review` | `isAdmin` |
| **Notification broadcast** | `POST /notifications/broadcast` | `isAdmin` |
| **Platform settings** | `GET /settings/get` · `PUT /settings/update` | `isAdmin` |
| **Subscription plan writes** | `POST /subscriptions/create` · `PUT /update/:id` · `DELETE /delete/:id` | `isAdmin` |
| **Master data writes** | `POST /categories/create` · `PUT /update/:id` · `DELETE /delete/:id` · `POST /subCategories/:categoryId/create` · `PUT /update/:id` · `DELETE /delete/:id` | `isAdmin` |
| **Legal writes** | `POST\|PUT\|DELETE /terms-and-conditions/*` (3) · `POST\|PUT\|DELETE /privacy-and-policies/*` (3) | `isAdmin` |
| **Admin auth** | `POST /auth/register` | `isAdmin` — pehla admin `scripts/seedAdmin.js` se banta hai |
| **Password sign-in** 🆕 | `POST /auth/login` · `POST /auth/set-password` · `POST /auth/forgot-password` · `POST /auth/reset-password` | ADMIN-only. `login`/`forgot`/`reset` routes public hain par unke validator `role` ko `ADMIN` tak seemit karte hain → vendor ko `422`. `set-password` pe `isAdmin` hai → `403`. [Details](#79-password-flow--%E2%9B%94-ab-vendor-ke-liye-nahi) |

### ⚠️ Reachable hai, par vendor ke liye nahi — app khud na call kare

Neeche wale endpoints pe koi **role** gate nahi hai (sirf `verifyJwtToken`), to vendor token
technically pahunch jaata hai. Wo vendor panel ke liye design nahi hue — inhe call karna
matlab customer ka data ya customer ka behaviour vendor UI me le aana.

| Endpoint | Kyun nahi |
|---|---|
| `GET /vouchers/customer/get-all` · `/get/:voucherId` · `POST /customer/voucher/preview` | ⚠️ **Sirf ye teen waqai reachable hain.** Customer voucher browsing — geo-scoped feed jo caller ki saved location pe based hai. Vendor ke liye iska koi matlab nahi |
| `POST\|PUT\|GET\|DELETE /banners/*` (5) | ✅ Ab `isAdmin` — vendor token pe `403` |
| `POST\|PUT\|GET\|DELETE /promotionalTickers/*` (5) | ✅ Ab `isAdmin` — `403` |
| `GET /banners/customer/active` · `GET /promotionalTickers/customer/active` | ✅ Ab `isCustomer` — `403` |
| `POST /locations/upsert` | ✅ Ab `isCustomer` — `403` |
| `POST /follows/toggle/:brandId` · `GET /follows/get-all` | ✅ Ab `isCustomer` — `403` |
| `POST /brandAvoidances/toggle/:brandId` · `GET /brandAvoidances/get-all` | ✅ Ab `isCustomer` — `403` |
| `GET /showcase/get-brand-showcase/:brandId` · `GET /showcase/:brandId/video-clips` | ✅ Ab `isCustomer` — `403` |
| `POST /transactions/webhook/razorpay` | Razorpay ka endpoint (public, HMAC-verified) |

> Jin rows pe ✅ hai wo pehle **bilkul ungated** the — is doc ke pichhle version me
> "gate nahi hai, discipline se mat call karo" likha tha. Ab discipline ki zarurat nahi,
> backend hi refuse karta hai.

Full categorization → [endpoints_category.md](./endpoints_category.md)

---

# Appendix B — Known Issues

Ye backend issues hain jo vendor panel ko directly affect karte hain. **Status 2026-08-22 ko code ke against verify kiya gaya.** Full detail → [security_findings.md](./security_findings.md)

---

## ⚠️ Settlement aapka record hai, aapka form nahi

Settlement par vendor ke liye **koi write endpoint nahi** hai — na approve, na dispute,
na edit. Ye hamara record hai ki hum aapko kya de rahe hain. Ikhtilaf support se hota
hai, kyunki uske peechhe aksar koi disputed payment ya chargeback hota hai jispar
faisla abhi hua hi nahi.

`SUB_VENDOR` ko is baar **poora brand** dikhta hai, apna outlet nahi. Settlement poore
brand ke ek din ka hai; outlet se kaat kar dikhane ka matlab ek aisa figure jo aapke
dekhe kisi bhi cheez se match nahi karta — aur wo paisa chhup jaata jo brand ka sach
me bakaya hai.

---

## 91. GET /settlements — mere payouts

**Access:** 🔒 `verifyJwtToken` — `VENDOR` aur `SUB_VENDOR` dono

| Param | Notes |
|---|---|
| `status` | `DRAFT · PENDING_APPROVAL · APPROVED · PROCESSING · PAID · FAILED · ON_HOLD · REVERSED · CANCELLED · ABANDONED · CARRIED_FORWARD` |
| `open=true` | Jo abhi chal rahe hain |
| `settlementNumber` · `from` / `to` | Narrow karne ke liye |
| `page` · `limit` (max 100) | Default 20 |

Sort **`periodEnd` desc** — ye list *"pichhle hafte ka paisa aaya?"* ka jawab dene ke
liye padhi jaati hai.

> **Khaali list `404` nahi deti.** Pehle hafte wale brand ke paas koi settlement nahi
> hoti, aur wo bilkul sahi jawab hai — use "kuchh gadbad hai" jaisa dikhana galat hoga.

### Aapko kya dikhta hai

| Field | Aapko | Kyun |
|---|:-:|---|
| `grossCollected` · `commissionAmount` · `commissionTax` | ✅ | Apni kitaab se milane ke liye |
| `vendorPromoCost` · `refundAdjustment` · `chargebackAdjustment` | ✅ | Kya-kya kata |
| `reserveHeld` · `reserveReleased` · `netPayable` | ✅ | |
| `bankSnapshot.accountLast4Digits` · `bankName` | ✅ | Kahan bheja |
| poora `bankSnapshot` (`ifscCode`, `accountHolderName`, `maskedAccountNumber`) | ❌ | Last 4 aur bank ka naam kaafi hai |
| `needsRevalidation` | ❌ | Andar ka review state — aapke liye sach *"payout ruka hai"* hai |
| `taintedTransactionIds` | ❌ | Faisla hone se pehle disputed payments ke naam |
| `failureNote` | ❌ | Staff-to-staff — aapko `failureReason` (category) milta hai |
| `approvedBy` · `idempotencyKey` | ❌ | Kis admin ne sign kiya, aur andar ki plumbing |

### `statusLabel` — aapko enum nahi dikhta

| Status | Aap padhte hain |
|---|---|
| `DRAFT` / `PENDING_APPROVAL` | Being prepared |
| `APPROVED` | Scheduled for payout |
| `PROCESSING` | On its way to your bank |
| `PAID` | Paid |
| `FAILED` | Payout failed — we are on it |
| `ON_HOLD` | On hold — being checked |
| `REVERSED` | Reversed by the bank |
| `CANCELLED` / `ABANDONED` | Cancelled |
| `CARRIED_FORWARD` | Carried forward to the next payout |

`PENDING_APPROVAL` aapko waise kabhi nahi dikhta: aapki taraf se kuchh *"pending"* nahi
hai, paisa bas aa raha hai.

> ⚠️ Doosre brand ka `brandId` bhejne par **khaali page** milta hai, apne rows nahi.
> Scope aur filter kaate jaate hain, upar-neeche rakhe nahi — filter ka "chal gaya"
> dikhna wahi tareeka hai jisse koi aisi report bana leta hai jo kabhi lagi hi nahi thi.

---

## 92. GET /settlements/:settlementId — ek payout, legs ke saath

**Access:** 🔒 `verifyJwtToken` — apne brand ka

`settlement` · **`legs`** · `timeline` · `viewer`.

### `legs` — yahan UTR milta hai

Ek payout do NEFT me bhi ja sakta hai (badi rakam), aur bounce ke baad retry **nayi
leg** banata hai. Har leg apna `utr`, `mode`, `paidAt` aur `amount` rakhti hai.

**UTR wahi ek cheez hai** jo aap teen din baad apne bank statement par dhoondh sakte
hain jab paisa nahi dikhta. Isi liye ek `payoutUtr` field kaafi nahi thi.

### `timeline`

Har status badla, tareekh ke saath — sabse purana upar. `reason`, `performedBy` aur
`snapshot` **sirf admin ko** jaate hain: wo notes staff ne staff ke liye likhe hain aur
aksar kisi aise dispute ka naam lete hain jispar faisla hua hi nahi.

---

## 93. GET /settlements/:settlementId/transactions — statement lines

**Access:** 🔒 `verifyJwtToken` — apne brand ka

| Param | Notes |
|---|---|
| `page` · `limit` (max 200) | Default 50 |

Ye alag se paged hai kyunki vyast brand ka ek cycle sau-sau rows ka hota hai, aur
detail call zyadatar sirf *"kitna, aur kab"* ke liye padha jaata hai.

| Field | Aapko |
|---|:-:|
| `invoiceId` · `verifiedAt` · `fundsReceivedAt` · `amount` | ✅ |
| `voucher.billAmount` · `netBill` · `vendorPayable` · `vendorPromoCost` | ✅ |
| `voucher.platformPromoCost` · `gatewayFee` · `netReceived` | ❌ |

⚠️ Aakhri teen hamara margin hain, aur wo **usi sub-document par** baithe hain jispar
aapka `vendorPayable` hai — isi liye ye faisla ek jagah hota hai.

`fundsReceivedAt` **`verifiedAt` se alag** hai: pehla matlab Razorpay ne hamare bank me
paisa bheja, doosra matlab grahak ne pay kiya. T+N doosri se nahi, **pehli** se ginta
hai — warna hum wo paisa baant rahe hote jo abhi aaya hi nahi.

---

## Settlement ke notifications

| Kab | Severity | Kya |
|---|:-:|---|
| Payout bheja gaya | ℹ️ INFO | Rakam, account ke aakhri 4 digit, aur **UTR** |
| Payout bounce hua | ⚠️ WARNING | Category (account band, galat IFSC…), staff note nahi |
| Payout hold par gaya | ⚠️ WARNING | *"On hold — being checked"*, bina tafseel ke |

Har state ke liye notice **nahi** hai. `PENDING_APPROVAL` aur `APPROVED` aisi cheezein
hain jinke baare me aap kuchh kar nahi sakte, aur jispar amal na ho sake wo
notification logon ko un notifications ko ignore karna sikhaati hai jo matter karti
hain.

Hold wali notice me tafseel jaan-boojh kar nahi hai: jo cheez check ho rahi hai wo
aksar ek disputed payment hoti hai, aur uska naam lena do din ki der ko ek aise
chargeback par behes bana deta hai jispar abhi kisi ne faisla nahi kiya. Support
poochhne par bata deta hai — wo baat-cheet hai, push notification nahi.

**Poora settlement flow → [`settlement_flow.md`](./settlement_flow.md).**

---

## ✅ Jo fix ho gaya

### Shared default password — FIXED
**Pehle:** har OTP account (vendor + outlet included) ek hi hardcoded password pe banta tha, aur badalne ka koi raasta nahi tha.

**Ab:** `User.password` optional hai — OTP accounts bina password ke bante hain, aur password login **fail-closed** hai (jinhone set nahi kiya unpe chalta hi nahi).

**Vendor panel pe impact:** ⚠️ **"Set password" screen mat banayein.** Fix ke baad ek aur decision liya gaya — password sign-in **sirf admin** ke liye rakha gaya, kyunki vendor WhatsApp OTP se aata hai aur uspe password sirf ek chori hone layak credential hota. Poora flow [#7–9](#79-password-flow--%E2%9B%94-ab-vendor-ke-liye-nahi) me hai.

### Subscription expiry — FIXED
**Pehle:** `brand.isSubscribed` kabhi `false` nahi hota tha, koi expiry job nahi tha.

**Ab:** `SUBSCRIBED_STATUS` source of truth hai, `getActiveSubscription` **read pe self-heal** karta hai (`status === ACTIVE && endDate > now`), aur 4 background jobs chalte hain (`expireSubscriptions`, `expireVouchers`, `sendExpiryReminders`, `releaseStalePromoReservations`).

**Vendor panel pe impact:** `GET /subscribeds/get` (#68) ke `isSubscribed` pe bharosa karein, `brand.isSubscribed` pe nahi.

### Checkout amount tampering — FIXED
**Pehle:** `amount` field checkout pe accept hota tha aur `amount || price` apply hota tha — koi bhi plan ₹1 me khareed sakta tha.

**Ab:** `amount` validator se hata diya gaya. Payable amount server-side compute hota hai.

### Outlet reactivation bug — FIXED
**Pehle:** `PUT /subBrands/update` pe `isActive` ka `.default(true)` tha — koi bhi update deactivated outlet ko chup-chaap reactivate kar deta tha.

**Ab:** `isActive` sirf tab apply hota hai jab explicitly bheja jaye.

---

## ✅ Pichhle round me jo band ho gaya

Ye sab is doc ke v1.0.0 me **open** listed the. Ab nahi hain — agar aapne inke liye
frontend me workaround likha tha, wo hata sakte hain.

| Tha | Ab |
|---|---|
| **Role enforcement — 35 endpoints ungated** | ✅ 149/149 accounted. Sirf 10 public hain (9 auth entry + Razorpay webhook). Showcase, locations, brandFeatures, workHours, subBrands, voucher versions — sab gated |
| **`?userId` param se kisi bhi user ka data** | ✅ Param hata diya gaya. `GET|PUT /users/*` hamesha token wale user pe chalte hain |
| **`GET /brands/get` PAN/GST/Bank customer ko** | ✅ Ab `isVendorOrAdmin`. Customer ke liye alag `/brands/customer/get/:brandId` hai jisme sensitive join **build hi nahi hota** |
| **`showcase/section/get-all` brand-scoped nahi** | ✅ Vendor apne brand pe pinned, admin global. `brandId` param ab support hota hai. **Ye endpoint ab bharosemand hai** |
| **Showcase ownership missing** | ✅ `resolveSectionForActor` — saare 11 showcase endpoints ab verify karte hain ki section aapke brand ka hai |
| **Verification history customer ko dikhti thi** | ✅ Ab `isVendorOrAdmin`, aur service me har role explicitly named hai |
| **Auth response me password hash** | ✅ `sanitizeUser()` — `password` aur `otp` har auth response se strip |
| **`FIXED` discount type kaam nahi karta** | ✅ Ab `FLAT` ka alias hai. Voucher offer form me teeno types dikha sakte hain |
| **Signup adha-adhoora reh jaata tha** | ✅ `User` + `Brand` ek transaction me. Purane toote accounts agli login pe khud repair ho jaate hain |
| **`isFirst` retry pe `false` ho jaata tha** | ✅ Ab verification state pe based hai. OTP na aaye to retry pe bhi `true` |
| **`brands/verifications/history` har request pe 500** | ✅ `isVendor is not defined` — live run me pakda gaya, 2026-08-27 |
| **Dono showcase reorder endpoints har request pe 500** | ✅ `id` vs `sectionId`/`mediaId` mismatch — live run me pakda gaya, 2026-08-27. Ye endpoints **kabhi** kaam nahi kiye the |

---

## 🔴 Blockers (production se pehle)

### 1. WhatsApp OTP verify hota hi nahi — auth bypass
```js
// services/auth/loginOrSignUpWithWhatsapp.js — OTP send nahi hota
// services/auth/verifyOtpWithWhatsapp.js     — OTP verify nahi hota
```
Kisi ka WhatsApp number pata ho to koi bhi 6-digit OTP daal ke uske vendor account me
login kiya ja sakta hai. **Production blocker.**

Ye **jaan-boojhkar** deferred hai — patch likha hua hai
([security_findings.md](./security_findings.md) #7), uncomment karne ka call aapka hai.

⚠️ Ab ye pehle se **zyada** matter karta hai: password login vendor ke liye band ho gaya,
to WhatsApp OTP hi ekmatra primary entry point hai.

**Vendor panel pe impact:** development me convenient. Uncomment hone ke baad naye error
cases aayenge — endpoint [#2](#2-post-authverify-otp-whatsapp) ke notes me listed hain,
unhe pehle se handle karein.

> Email aur Mobile OTP flows me verification **intact** hai — sirf WhatsApp me commented hai.

---

## 🟠 Ownership — abhi bhi khuli hai

Role gate lag gaya hai (customer ab in pe nahi aa sakta), par **vendor A abhi bhi vendor B
ka resource** touch kar sakta hai — service sirf ye check karti hai ki caller vendor hai,
ye nahi ki wo **is** brand ka vendor hai.

| Endpoint | Kya ho sakta hai |
|---|---|
| `PUT /brandFeatures/update/:featureId` | Kisi bhi brand ka feature edit — service `featureId` se feature uthati hai aur uska `brandId` caller se match nahi karti |
| `DELETE /brandFeatures/delete/:featureId` | Wahi, delete ke saath |
| `PUT /locations/update/:id` | Kisi bhi brand/outlet ka address edit |
| `DELETE /locations/delete/:id` | Wahi, delete ke saath |
| `POST /vouchers/publish/:versionId` | Kisi bhi brand ka approved voucher publish — `publishVoucher(userId, versionId)` `userId` leta hai par use ownership ke liye **use hi nahi karta** |

Pattern repo me maujood hai — `resolveActorBrand` aur `resolveSectionForActor` 22
services me chal rahe hain. In paanch me apply karna baaki hai.

**Vendor panel pe impact:** apne hi resources ke ids use karein. Ye "defensive coding"
wali salaah nahi hai — ye batana hai ki backend abhi aapko rok nahi raha, to accidental
cross-brand id (galat list se copy-paste, stale cache) **chup-chaap kaam kar jayegi**.

---

## 🟡 Functional gaps

### 2. `SUB_VENDOR` accounts kuch nahi kar sakte
Outlet signup pe `SUB_VENDOR` user banta hai aur OTP bhi jaata hai, par **koi route
`SUB_VENDOR` role handle nahi karta**. `isSubVendor` middleware ab exist karta hai par
kisi route pe laga nahi hai, aur `verifyJwtToken` un ke liye `req.brandId` set nahi karta.

**Vendor panel pe impact:** outlet-level login screen abhi na banayein. Outlet management
vendor ke through hi hogi.

### 3. `DELETE /users/delete` no-op hai
Kuch delete nahi karta, aur standard response envelope bhi use nahi karta (`success`
field hi nahi aati).

Cascade plan likha hua hai ([account_deletion_plan.md](./account_deletion_plan.md)) —
implement tab hoga jab poora flow ready ho.

**Vendor panel pe impact:** "Delete account" feature disable rakhein.

### 4. Voucher redemption flow exist nahi karta
Customer voucher dekh sakta hai aur discount preview kar sakta hai, par redeem nahi kar
sakta. `VoucherUsage` model bana hai, koi route nahi. `usageType` (`ONCE_PER_USER`)
enforce nahi hota.

**Vendor panel pe impact:** redemption/scan screen abhi ban nahi sakta. Voucher analytics
bhi limited rahegi. Ye agle phase ka kaam hai.

### 5. Email verification ka endpoint nahi hai
Email change pe `isEmailVerified: false` ho jaata hai, par verify karne ka raasta nahi.

**Vendor panel pe impact:** email verified badge/flow abhi na banayein.

### 6. `POST /auth/logout` push unregister nahi karta
Aur token blacklist bhi nahi hai — JWT apni expiry tak valid rehta hai.

**Vendor panel pe impact:** logout pe `PUT /deviceTokens/unregister` bhi call karein, aur
token locally delete karein.

### 7. Promo codes vendor checkout pe abhi off hain
`isPromoCodeEnabled: false` default hai. Checkout preview `"Promo codes are coming soon"`
message deta hai.

**Vendor panel pe impact:** promo code field dikhayein par `preview.promo.supported`
check karein — `false` ho to disable ya hide karein.

### 8. `brand.isApproved` aur `brand.status` kabhi likhe nahi jaate
Dono fields model me hain par koi code inhe set nahi karta — hamesha `false` / `PENDING`.
Asli verdict `SystemVerify` document me hai.

**Vendor panel pe impact:** approval status ke liye `GET /brands/verifications/history`
([#33](#33-get-brandsverificationshistory)) ya `systemVerify.status` dekhein —
`brand.isApproved` pe kabhi bharosa na karein.

---

# Frontend Integration Checklist

**Response handling**
- [ ] **404 = empty list** — list endpoints pe 404 pe empty-state, error toast nahi
- [ ] **Nested `data.data`** — pagination responses me
- [ ] **`DELETE /users/delete` standard envelope use nahi karta**
- [ ] **Token expiry pe login screen** — `401 "Your session has expired..."`
- [ ] **`subscribeds/get` empty pe `null` deta hai**, 404 nahi

**Request formatting**
- [ ] **`role: "VENDOR"` bhejein** auth calls pe — WhatsApp flow ka default `CUSTOMER` hai, email/mobile ka `ADMIN`
- [ ] **`brandId` hamesha bhejein** un endpoints pe jo scoped nahi hain (`subBrands/get-all`, `locations/getAll`, `vouchers/versions/get-all`)
- [ ] **Coordinates `[longitude, latitude]`** order me — ulta karna sabse common bug
- [ ] **`limit` default 10 hai** — categories/plans pe badhayein
- [ ] **`isActive=true` bhejein** master data + legal pe
- [ ] **Multipart file field names exact hone chahiye** — `images`, `newImages`, `icon`, `logo`, `bannerImage`/`bannerVideo`/`bannerGif`
- [ ] **`offers` JSON string ke roop me bhej sakte hain** multipart me

**Onboarding**
- [ ] **`currentScreen` se resume karein** — login ke baad `GET /users/get` ka `currentScreen` dekhein
- [ ] **`add-basic-details` screen-scoped hai** — har screen pe sirf uske fields, warna `forbidden` error
- [ ] **KYC do-step hai** — pehle `verify-*`, phir `add-*-details`
- [ ] **`verificationResponse` poora raw response bhejein** — audit ke liye mandatory
- [ ] **Approval status `systemverifies[0].status` se lein**, `brand.isApproved` se nahi (wo kabhi set hi nahi hota)

**Subscription & limits**
- [ ] **`GET /subscribeds/get` dashboard ka single call hai** — plan + entitlements + usage sab ek jagah
- [ ] **`usage[bucket].limit: null` = unlimited**
- [ ] **`overflowBy > 0` pe warning dikhayein** — grandfathered downgrade
- [ ] **`orderSummary.rows` as-is render karein** — koi arithmetic nahi
- [ ] **`canProceed` + `blockedReason` check karein** pay button se pehle
- [ ] **⚠️ Upgrade pe forfeit warning** — bache hue din chale jayenge, koi proration nahi
- [ ] **Razorpay `amount` paise me hai** — `117882` = ₹1,178.82
- [ ] **`transactionId` sambhal ke rakhein** create-order se verify tak
- [ ] **Verify optional hai** — webhook bhi activate karta hai; retry safe hai (`alreadyVerified`)

**Limits & gates**
- [ ] **`403` "requires an active subscription"** → subscribe screen pe bhejein
- [ ] **`403` "limit reached"** → upgrade prompt dikhayein
- [ ] **Outlets aur franchises alag pools hain** — `outletType` se decide hota hai

**Vouchers**
- [ ] **`FIXED` discount type ab kaam karta hai** — `FLAT` ka alias. Teeno types dikha sakte hain
- [ ] **Status-wise editability** — `UNDER_REVIEW`/`EXPIRED`/`ARCHIVED` pe edit block
- [ ] **Update delta-based hai** — `newOffers`/`removedOfferIds`, poori list nahi
- [ ] **`publish` ko `versionId` chahiye**, `voucherId` nahi
- [ ] **Outlet ki location zaruri hai** — bina uske voucher customer ko nahi dikhega

**Showcase**
- [ ] **Media limits combined check hote hain** — existing + naye
- [ ] **Media reorder pe poori list bhejein** — partial allowed nahi
- [ ] **Aakhri media delete nahi hoti** — section hi delete karein
- [ ] **Section delete slot release karta hai**, `isActive: false` nahi

**Security discipline**
- [ ] **`?userId` param support hi nahi hota** — hata diya gaya, token se user resolve hota hai
- [ ] **`password` ab response me aata hi nahi** — `sanitizeUser()` har auth response se strip karta hai
- [ ] **Apne resources ke ids hi use karein** — 5 endpoints pe ownership check abhi bhi missing hai ([Appendix B](#-ownership--abhi-bhi-khuli-hai))
- [ ] **Password / "Set password" screen mat banayein** — vendor ke liye wo flow band hai
- [ ] **`brand.isApproved` pe bharosa na karein** — hamesha `false` rehta hai; `SystemVerify.status` dekhein
- [ ] **Appendix A ke endpoints kabhi call na karein**

**Push notifications**
- [ ] **Login ke baad `register` call karein** — role sahi map hone ke liye
- [ ] **`deviceId` zaroor bhejein** — reinstall pe dead rows na bane
- [ ] **Logout pe `unregister` + `logout` dono**
- [ ] **`test` endpoint pe `delivered` flag dekho**, `success` nahi

---

**Doc version:** 1.2.1 · **Last verified:** 2026-08-28 against a running server (99 requests · 228 assertions · 105 captured examples · all pass)
**Related docs:** [endpoints_category.md](./endpoints_category.md) · [security_findings.md](./security_findings.md) · [brand_verification_api_doc.md](./brand_verification_api_doc.md) · [subscription_lifecycle_design.md](./subscription_lifecycle_design.md) · [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md) · [customer_mobile_api_doc.md](./customer_mobile_api_doc.md)
**Pending:** Super admin panel doc (phase 3)

