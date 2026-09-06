# Trydood 2.0 — Super Admin Panel API Documentation

**Version:** 1.0.0
**Base URL (Local):** `http://localhost:8080/trydood/v1`
**Base URL (Staging):** `https://backend2-0-4v4i.onrender.com/trydood/v1`
**Framework:** Express.js (Node.js, CommonJS)
**Database:** MongoDB (Mongoose ODM)
**Scope:** Super admin panel ke endpoints — platform ke **216 routes** me se admin-category ke **84** ([endpoints_category.md](./endpoints_category.md))
**Postman:** [`trydood-admin.postman_collection.json`](../postman/trydood-admin.postman_collection.json) — 71 requests, **har ek par live-captured example**

> **Note:** Ye doc code padhkar likha gaya — har request field, error message aur response shape controller/service/validator se verify kiya gaya hai. Jahan behaviour buggy ya adhoora hai, wahan ⚠️ marker hai.
>
> **Ab uske upar live run bhi hai.** Admin collection ke 71 requests seeded database par asli server ke against chalte hain aur unke saved examples asli responses hain, likhe hue nahi. Wo run **teen cheezein pakad chuka hai** jo code padhne se nahi dikhtin: `PUT /notifications/preferences` har caller ko `500` de raha tha (validator ka closing brace), seeded admin ka email hi login validator ne kabhi accept nahi kiya hota (`.test` TLD), aur settlement approve/retry chup-chaap refuse karte the kyunki kisi brand ke paas verified bank account tha hi nahi.
>
> ⚠️ Baaki 35 admin routes ke requests `trydood-brand-verification`, `trydood-subscription` aur `trydood-security-changes` me hain — admin collection unhe dobara nahi likhti. Dekho [`postman/README.md`](../postman/README.md).

---

## Table of Contents

**Foundation**
1. [Overview](#overview)
2. [Admin Responsibilities](#admin-responsibilities)
3. [Authentication](#authentication)
4. [The `brandId` Rule](#the-brandid-rule)
5. [Standard Response Format](#standard-response-format)
6. [Pagination](#pagination)
7. [HTTP Status Codes](#http-status-codes)
8. [Common Errors](#common-errors)
9. [Enums Reference](#enums-reference)

**Endpoints**

10. [Auth APIs](#auth-apis) — 12
11. [User Profile APIs](#user-profile-apis) — 3
12. [Push Notification APIs](#push-notification-apis) — 4
13. [Notification APIs](#notification-apis) — 3
14. [Brand Verification APIs](#brand-verification-apis) — 3
15. [Brand Data APIs](#brand-data-apis) — 2
16. [Outlet APIs](#outlet-apis) — 3
17. [Location APIs](#location-apis) — 5
18. [Showcase APIs](#showcase-apis) — 2
19. [Voucher APIs](#voucher-apis) — 8
20. [Banner APIs](#banner-apis) — 5
21. [Promotional Ticker APIs](#promotional-ticker-apis) — 5
22. [Brand Feature APIs](#brand-feature-apis) — 5
23. [Category APIs](#category-apis) — 5
24. [Sub Category APIs](#sub-category-apis) — 5
25. [Subscription Plan APIs](#subscription-plan-apis) — 5
26. [Subscribed APIs](#subscribed-apis) — 8
27. [Promo Code APIs](#promo-code-apis) — 6
28. [Payment APIs](#payment-apis) — 4
29. [Webhook & Dispute APIs](#webhook--dispute-apis) — 5
30. [Settings APIs](#settings-apis) — 2
31. [Legal APIs](#legal-apis) — 10

**Reference**

32. [Appendix A — Not For Admin Panel](#appendix-a--not-for-admin-panel)
33. [Appendix B — Known Issues](#appendix-b--known-issues)
34. [Frontend Integration Checklist](#frontend-integration-checklist)

---

## Overview

Super admin panel 22 functional areas cover karta hai:

| # | Area | Endpoints | Kya karta hai |
|---|---|---:|---|
| 1 | Auth | 12 | Register, password login, OTP flows, password set/reset, logout |
| 2 | User Profile | 3 | Profile fetch, update, delete |
| 3 | Push Notifications | 4 | Device register/unregister, my devices, test |
| 4 | Notifications | 3 | Feed, mark read, **broadcast to any audience** |
| 5 | Brand Verification | 3 | KYC review queue, approve/reject/revoke, audit trail |
| 6 | Brand Data | 2 | Brand detail, update |
| 7 | Outlets | 3 | Outlet signup, list, update |
| 8 | Locations | 5 | Saare addresses |
| 9 | Showcase | 2 | Sections list, reorder |
| 10 | Vouchers | 8 | **Approve/reject** + full vendor toolkit |
| 11 | Banners | 5 | App-level home banners CRUD |
| 12 | Promotional Tickers | 5 | App-level ticker strip CRUD |
| 13 | Brand Features | 5 | Brand USP points |
| 14 | Categories | 5 | Master data CRUD |
| 15 | Sub Categories | 5 | Master data CRUD |
| 16 | Subscription Plans | 5 | Plan catalog CRUD + entitlements |
| 17 | Subscribeds | 8 | **Grant / cancel / resync / forfeit compensation** |
| 18 | Promo Codes | 6 | Campaign CRUD + usage report |
| 19 | Payments | 4 | Vendor ke liye checkout drive karna + invoice |
| 20 | Webhooks & Disputes | 5 | Delivery log, replay, chargeback worklist |
| 21 | Settings | 2 | Platform config — GST, limits, policies, channels |
| 22 | Legal | 10 | Terms & Privacy CRUD |

**Important architecture notes:**

- **Admin ko `brandId` explicitly dena hota hai** jahan bhi brand-scoped operation ho — vendor ke ulta, jiska token se resolve ho jaata hai. Detail → [The `brandId` Rule](#the-brandid-rule)
- **Zyada tar admin endpoints properly gated hain** — `isAdmin` ya `validateRoles(VENDOR, ADMIN)`. Kuch pe abhi bhi role check nahi hai → [Appendix B](#appendix-b--known-issues)
- **Admin subscription gates se bahar hai** — `assertActiveSubscription` sirf vendor-owned brand pe chalta hai. Admin kisi bhi brand ke liye voucher/outlet bana sakta hai bina plan ke... ⚠️ **par limits phir bhi lagti hain** kyunki wo brand ke counters pe based hain
- **Soft delete pattern** — kuch bhi actually delete nahi hota
- **Har destructive admin action ka audit trail banta hai** — brand verification, subscription grant/cancel, voucher review sab history rows likhtе hain

---

## Admin Responsibilities

Admin panel ke 5 core workflows:

### 1. Brand verification queue
```
GET  /brands/admin/verifications?status=MANUAL_REVIEW    → queue
GET  /brands/verifications/history?brandId=…             → us brand ka timeline
PUT  /brands/admin/verifications/:brandId/review         → APPROVED / REJECTED / REVOKED / REVIEWED
```

### 2. Voucher approval queue
```
GET  /vouchers/versions/get-all?status=UNDER_REVIEW      → queue
POST /vouchers/review/:versionId                         → APPROVED / REJECTED
POST /vouchers/publish/:versionId                        → live karna (optional, vendor bhi kar sakta hai)
```

### 3. Subscription management
```
GET  /subscribeds/admin/get-all?expiringInDays=7         → renewals worklist
POST /subscribeds/admin/grant                            → bina payment ke plan dena
PUT  /subscribeds/admin/cancel                           → plan revoke
GET  /subscribeds/admin/forfeited?compensated=false      → goodwill worklist
PUT  /subscribeds/admin/forfeited/compensate             → settle
PUT  /subscribeds/admin/resync                           → repair tool
```

### 4. Payment operations
```
GET  /transactions/webhook/events                        → FAILED deliveries (default view)
POST /transactions/webhook/replay/:eventId               → recover
GET  /transactions/disputes                              → chargebacks, deadline-first
POST /transactions/invoice/regenerate                    → invoice re-issue
```

### 5. Platform content
```
Banners · Tickers · Categories · Sub-categories · Plans · Promo codes · Legal · Settings
```

---

## Authentication

Admin do tarah se login kar sakta hai:

**A. Password login (primary)**
```
POST /auth/login   { type: "EMAIL", email, password, role: "ADMIN" }
```
⚠️ Ye tabhi kaam karta hai jab admin ne password set kiya ho. Naye accounts bina password ke bante hain.

**B. OTP login**
```
POST /auth/login-with-email  { email, role: "ADMIN" }     ← default role ADMIN hai
POST /auth/verify-otp-email  { email, otp, role: "ADMIN" }
```

Login ke baad har request me:
```http
Authorization: Bearer <token>
```

**JWT payload:**
```json
{
  "id": "68f1a2b3c4d5e6f7a8b9c000",
  "role": "ADMIN",
  "name": "admin user",
  "email": "admin@trydood.com",
  "whatsappNumber": "9800000000",
  "mobile": "9800000000",
  "iat": 1755820800,
  "exp": 1758412800
}
```

**Expiry:** `JWT_EXPIRY` env se. Expire pe `401` + `"Your session has expired. Please log in again."`

⚠️ **Logout server-side token invalidate nahi karta.**

### `req` context

| Field | Admin ke liye |
|---|---|
| `req.userId` | Set hota hai |
| `req.role` | `"ADMIN"` |
| `req.brandId` | ❌ **`undefined`** — admin ka apna brand nahi hota |
| `req.customerId` | ❌ `undefined` |

Yahi wajah hai ki admin ko har brand-scoped call me `brandId` dena padta hai.

---

## The `brandId` Rule

Ye admin panel ka sabse important pattern hai. Kai endpoints vendor aur admin dono serve karte hain, aur `resolveActorBrand` helper dono ko alag treat karta hai:

```js
// helpers/brands/resolveActorBrand.js
if (role === ROLES.ADMIN) {
  if (!requestedBrandId) {
    throwError(422, "brandId is required when acting as an admin");
  }
  // admin koi bhi brand chun sakta hai
  return brand;
}
// vendor: token ka brand default, aur sirf apna
```

### Iska matlab

| | Vendor | Admin |
|---|---|---|
| `brandId` na do | Token ka brand use hota hai | **`422 "brandId is required when acting as an admin"`** |
| Dusre brand ka `brandId` | `403 Forbidden` | ✅ Allowed |

### Kaunse endpoints pe ye lagta hai

`resolveActorBrand` use karne wale 11 services:

| Endpoint | `brandId` kahan |
|---|---|
| `POST /vouchers/create` | Body (already required) |
| `PUT /vouchers/update/:voucherId` | Voucher se resolve |
| `POST\|DELETE /vouchers/:voucherId/banner` | Voucher se resolve |
| `POST /transactions/subscribe/preview` | **Body — admin ke liye required** |
| `POST /transactions/subscribe/create-order` | **Body — admin ke liye required** |
| `GET /subscribeds/get` | **Query — admin ke liye required** |
| `GET /subscribeds/history` | **Query — admin ke liye required** |
| `GET /notifications/get-all` | Query — **omit karne pe admin-audience feed** |
| `PUT /notifications/mark-read` | Body |
| `POST /subBrands/signUp-with-whatsapp` | Body (already required) |

> ⚠️ **`GET /notifications/get-all` exception hai** — admin `brandId` omit kare to error nahi, balki **admin-audience feed** milti hai (webhook failures, disputes, lapsed brands).

### Jin endpoints pe `brandId` filter hai (ownership nahi)

Ye endpoints scoped nahi hain — `brandId` sirf ek **query filter** hai. Admin ke liye ye actually convenient hai (sab kuch dikhta hai), par jaanein ki data platform-wide hai:

`GET /subBrands/get-all` · `GET /locations/getAll` · `GET /vouchers/versions/get-all` · `GET /showcase/section/get-all` · `GET /brandFeatures/get-all` (yahan `brandId` **required** hai)

---

## Standard Response Format

**Success:**
```json
{ "success": true, "message": "Subscriptions fetched successfully", "data": { } }
```

**Error:**
```json
{ "success": false, "message": "Brand not found!" }
```

⚠️ **Exception:** `DELETE /users/delete` raw `{ "message": "..." }` deta hai, `success` field ke bina.

---

## Pagination

```json
{
  "success": true,
  "message": "Promo codes fetched successfully",
  "data": { "total": 47, "totalPages": 5, "page": 1, "limit": 10, "data": [ ] }
}
```

`data.data` nested hai.

### ⚠️ Empty list = 404 (purane modules me)

`pagination` utility empty pe **404 throw** karti hai:
```json
{ "success": false, "message": "No any promocode found" }
```

**404 ko error treat na karein** — empty-state dikhayein.

**Ye modules 404 dete hain:** banners, tickers, brandFeatures, categories, subCategories, subscriptions, locations, subBrands, showcase, vouchers versions, legal

**Ye modules `[]` dete hain (404 nahi):** `notifications`, `subscribeds`, `promoCodes`, `transactions/webhook/events`, `transactions/disputes`, `deviceTokens` — naye modules apna pagination use karte hain

---

## HTTP Status Codes

| Code | Meaning | Kab |
|---|---|---|
| `200` | OK | Successful GET/PUT/POST |
| `201` | Created | Voucher create, media upload, work hours, **admin grant** |
| `400` | Bad Request | Business rule fail |
| `401` | Unauthorized | Token missing/expired, galat current password |
| `403` | Forbidden | Role not permitted, deactivated account |
| `404` | Not Found | Resource nahi mila **ya empty list** |
| `409` | Conflict | Duplicate (promo code, banner overlap, section title), concurrent modification |
| `422` | Unprocessable Entity | Joi validation, invalid ObjectId, **`brandId` missing for admin** |
| `500` | Server Error | Unexpected |
| `503` | Service Unavailable | Razorpay down |

---

## Common Errors

| Status | Message | Kab |
|---|---|---|
| `401` | `Access Denied! Missing authorization token` | Header nahi |
| `403` | `Access Denied! Invalid authorization token format` | `Bearer <token>` format nahi |
| `401` | `Your session has expired. Please log in again.` | Token expired → **login screen** |
| `403` | `Invalid or malformed token. Please log in again.` | Token corrupt |
| `403` | `Token not active yet. Please try again later.` | `nbf` future me |
| `403` | `Access Denied! Invalid token` | Payload empty |
| `404` | `Access Denied! User not found` | User record nahi |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role `ADMIN` nahi |
| `422` | `brandId is required when acting as an admin` | ⚠️ **Admin-specific** |
| `404` | `Brand not found!` | `brandId` galat |
| `500` | `Authentication failed due to an unexpected error.` | JWT verify me unknown error |
| `422` | *(field-wise Joi message)* | Validation fail |
| `404` | `Invalid API` | Galat path |

### Validation error format

Joi errors ek string me join hote hain (`, ` se), field names human-readable:
```json
{ "success": false, "message": "Code is required, discountType is required" }
```

**Unknown fields silently drop ho jaate hain** (`stripUnknown: true`).

---

## Enums Reference

### ROLES
`ADMIN` · `VENDOR` · `SUB_VENDOR` · `CUSTOMER`

### SYSTEM_VERIFICATION_STATUS
`PENDING` · `APPROVED` · `MANUAL_REVIEW` · `UNDER_REVIEW` · `REJECTED` · `REVOKED`
> `REVOKED` constant ka comment: *"Approval withdrawn by an admin after it was granted. Distinct from REJECTED, which means it was never approved in the first place."*

### BRAND_VERIFICATION_ADMIN_ACTION — review API me kya bhej sakte hain
| Action | Kya karta hai | Extra field |
|---|---|---|
| `APPROVED` | Brand approve | – |
| `REJECTED` | Brand reject | `rejectionReason` **required** (max 1000) |
| `REVOKED` | Pehle di gayi approval wapas | `revokeReason` **required** (max 1000) |
| `REVIEWED` | Sirf "seen" flag toggle — **status nahi badalta** | `isReviewed` optional (omit = toggle) |

### BRAND_VERIFICATION_ACTION — audit trail events
`SYSTEM_VERIFIED` · `RESUBMITTED` · `REVIEWED` · `UNREVIEWED` · `APPROVED` · `REJECTED` · `REVOKED` · `APPROVAL_ACKNOWLEDGED` · `REMEDIATION_UPDATED`

### BRAND_VERIFICATION_ACTOR
`SYSTEM` · `ADMIN` · `VENDOR`

### BRAND_VERIFICATION_SORT_BY
`NEWEST` · `OLDEST` · `SCORE` — sort order `ASC` \| `DESC` (**uppercase**)

### VOUCHER_STATUSES
`DRAFT` · `UNDER_REVIEW` · `APPROVED` · `PUBLISHED` · `REJECTED` · `EXPIRED` · `PAUSED` · `ARCHIVED`

### VOUCHER_APPROVAL_ACTION
`SUBMITTED` · `APPROVED` · `REJECTED` · `PAUSED` · `RESUMED` · `ARCHIVED` · `EXPIRED` · `PUBLISHED`
> Review API sirf `APPROVED` aur `REJECTED` accept karta hai.

### VOUCHER_DISCOUNT_TYPES
`PERCENTAGE` · `FLAT` · ~~`FIXED`~~
> ⚠️ `FIXED` calculation me handle nahi hota → [Appendix B](#appendix-b--known-issues)

### SUBSCRIBED_STATUS
`PENDING` · `ACTIVE` · `EXPIRED` · `UPGRADED` · `DOWNGRADED` · `CANCELLED`
> **Source of truth.** `Brand.isSubscribed` sirf `ACTIVE + endDate > now` ka cache hai.

### SUBSCRIPTION_ACTION
`NEW` · `RENEW` · `UPGRADE` · `DOWNGRADE`
> Admin grant response ka `action` batata hai kaunsa apply hua.

### SUBSCRIPTION_SOURCE
`PAYMENT` · `ADMIN_PAYMENT` · `ADMIN_MANUAL`

### MANUAL_PAYMENT_MODES — admin grant pe
`FREE` *(default)* · `CASH` · `BANK_TRANSFER` · `CHEQUE` · `UPI_OFFLINE`

### SUBSCRIPTION_HISTORY_ACTION
`ORDER_CREATED` · `ACTIVATED` · `RENEWED` · `UPGRADED` · `DOWNGRADED` · `EXPIRED` · `CANCELLED` · `ADMIN_GRANTED`

### HISTORY_PERFORMED_BY
`VENDOR` · `ADMIN` · `SYSTEM` *(expiry job)*

### ENTITLEMENT_BUCKETS — metered pools
`subBrands` · `franchises` · `vouchers` · `showcase`
> Har ek independent. Shape: `{ limit, isUnlimited }`. `limit: 0` + `isUnlimited: false` = feature plan me nahi.

### ENTITLEMENT_SOURCE — limits kahan se aaye
| Value | Matlab |
|---|---|
| `DB` | Plan ka structured `entitlements` — sahi case |
| `DERIVED` | Legacy free-text `features[]` se parse kiya |
| `DEFAULT` | Kuch samajh nahi aaya, conservative fallback |
> `DERIVED`/`DEFAULT` dikhe to us plan ko theek karna chahiye.

### GST_TAX_TYPES
`CGST_SGST` (intra-state) · `IGST` (inter-state)
> `Setting.vendor.subscription.companyStateCode` khali ho to sab `IGST`.

### PROMO_DISCOUNT_TYPES
`PERCENT` · `FLAT`

### PROMO_APPLICABLE_ACTIONS
`NEW` · `RENEW` · `UPGRADE` · `DOWNGRADE`
> Code pe empty list = "any action".

### PROMO_USAGE_STATUS
| Status | Kab |
|---|---|
| `RESERVED` | Order bana, payment nahi hua |
| `CONSUMED` | Payment verified, use final |
| `RELEASED` | Order fail/expire, slot wapas |
> `RESERVED` 30 min se purana ho to sweep job reclaim kar leta hai.

### PROMO_CODE_LIMITS
Code length 3–40 · Description max 300 · Reservation TTL 30 min

### WEBHOOK_STATUS
| Status | Matlab |
|---|---|
| `RECEIVED` | Aaya, abhi process nahi |
| `PROCESSED` | Successfully handled |
| `IGNORED` | Signature sahi, par ye event handle nahi karte |
| `FAILED` | Verified par processing threw — **replay ke liye rakha** |
| `DUPLICATE` | Wahi event id dobara aaya |

> `GET /webhook/events` default `FAILED` dikhata hai — actionable set. `status=ALL` se sab.

### WEBHOOK_REPLAYABLE_STATUSES
`FAILED` · `IGNORED` — sirf ye replay ho sakte hain (`force` ke bina)

### RAZORPAY_WEBHOOK_EVENTS
`payment.captured` · `payment.authorized` · `payment.failed` · `order.paid` · `refund.created` · `refund.processed` · `refund.failed` · `payment.dispute.created` · `payment.dispute.under_review` · `payment.dispute.action_required` · `payment.dispute.won` · `payment.dispute.lost` · `payment.dispute.closed`

### DISPUTE_STATUS
`OPEN` · `UNDER_REVIEW` · `ACTION_REQUIRED` · `WON` · `LOST` · `CLOSED`

### NOTIFICATION_TYPES
**Vendor/customer-facing:** `SUBSCRIPTION_ACTIVATED` · `SUBSCRIPTION_RENEWED` · `SUBSCRIPTION_UPGRADED` · `SUBSCRIPTION_DOWNGRADED` · `SUBSCRIPTION_GRANTED` · `SUBSCRIPTION_EXPIRING` · `SUBSCRIPTION_EXPIRED` · `SUBSCRIPTION_CANCELLED` · `LIMIT_REACHED` · `ANNOUNCEMENT`

**Admin-audience:** `WEBHOOK_FAILED` · `PAYMENT_DISPUTED` · `BRAND_SUBSCRIPTION_LAPSED` · `PROMO_LIMIT_EXCEEDED`

### AUDIENCE_TARGETS — broadcast targeting
`userIds` · `roles` · `brandIds` · `customerIds` · `subBrandIds` · `all`
> Targets **union** hote hain. Kam se kam ek chahiye. `all: true` explicitly likhna padta hai.

### AUDIENCE_LIMITS
Max recipients per dispatch: **5000** · Max tokens per push batch: **500**

### NOTIFICATION_SEVERITY
`INFO` · `WARNING` · `CRITICAL`

### NOTIFICATION_CHANNELS
`IN_APP` (hamesha) · `EMAIL` · `PUSH` · `WHATSAPP` *(reserved)*

### BANNER_TYPE / VOUCHER_BANNER_TYPE
`IMAGE` · `VIDEO` · `GIF`

### BANNER_REDIRECT_TYPE / TICKER_REDIRECT_TYPE
`NONE` · `CATEGORY` · `DEAL` · `BRAND` · `OFFER` · `EXTERNAL_URL`
> `CATEGORY`/`DEAL`/`BRAND`/`OFFER` pe `targetId` **required**; `EXTERNAL_URL` pe `url` **required**.

### BANNER_SORT_BY
`createdAt` · `startDate` · `endDate` · `title`

### SUBSCRIPTION_TYPES
`WEEKLY` (7d) · `MONTHLY` (30d) · `QUATERLY` (90d) · `HALF_YEARLY` (180d) · `YEARLY` (365d)

### DISCOUNT_TYPES (plan-level)
`PERCENT` · `FLAT`

### OUTLET_TYPES
`OUTLET` · `FRANCHISE` — alag plan pools

### SHOWCASE_SECTION_TYPE / SHOWCASE_MEDIA_TYPE
`CUSTOM` · `SYSTEM` / `PHOTO` · `VIDEO`

### DEVICE_PLATFORMS
`ANDROID` · `IOS` · `WEB`

### ADDRESS_TYPES
`HOME` · `WORK` · `OTHER`

### BUSINESS_ENTITY_TYPE
`PROPRIETORSHIP` · `PARTNERSHIP` · `LLP` · `PRIVATE_LIMITED` · `PUBLIC_LIMITED` · `ONE_PERSON_COMPANY` · `TRUST` · `NGO` · `SOCIETY`

### SCREENS — vendor onboarding tracker
`BUSINESS_NAME` · `REGISTRATION_STATUS` · `REGISTRATION_ENTITY_TYPE` · `PAN_VERIFICATION` · `GST_VERIFICATION` · `BANK_VERIFICATION` · `SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `SUBSCRIBE_PLAN` · `OUTLET_PAGE` · `UNDER_REVIEW` · `DASHBOARD`

---

# Auth APIs

## 1. POST /auth/register

Naya user banata hai — **default role `ADMIN`**.

**Access:** Intended: ADMIN · Enforced: 🔴 **Public — koi auth nahi**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `name` | string | ✅ | – | 3–120 chars |
| `email` | string | ✅ | – | Valid email, lowercase |
| `dob` | date | ✅ | – | Past me honi chahiye |
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `mobile` | string | ✅ | – | 10 digits, first `6-9` |
| `username` | string | ✅ | – | `/^[a-z0-9_]{3,50}$/` — lowercase, digits, underscore |
| `password` | string | ✅ | – | 8–30 chars |
| `role` | string | ❌ | **`ADMIN`** | ROLES enum, auto-uppercase |
| `isActive` | boolean | ❌ | – | |

```json
{
  "name": "Admin User",
  "email": "admin@trydood.com",
  "dob": "1990-01-15",
  "whatsappNumber": "9800000000",
  "mobile": "9800000000",
  "username": "admin_user",
  "password": "Admin@2026",
  "role": "ADMIN"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c000",
    "name": "admin user",
    "email": "admin@trydood.com",
    "username": "admin_user",
    "role": "ADMIN",
    "uniqueId": "TDU000001",
    "referralCode": "ADMIN7X2K",
    "isActive": true,
    "createdAt": "2026-04-01T00:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Name is required` / `Name must contain at least 3 characters` | |
| `422` | `Email is required` / `Please enter a valid email address` | |
| `422` | `Username can only contain lowercase letters, numbers, and underscores` | |
| `422` | `Password must contain at least 8 characters` | |
| `422` | `Date of birth cannot be in future` | |
| `422` | `Please enter a valid 10 digit WhatsApp number` / `Mobile number` | |
| `422` | `<value> is already registered for <field>` | Duplicate email/username/mobile |

### 🔴 CRITICAL SECURITY ISSUE

**Ye endpoint public hai aur `role` ka default `ADMIN` hai.**

```js
// routes/auth.js:31 — koi auth middleware nahi
router.post("/register", validateSchema(validateRegisterUser), register);
```
```js
// validator/auth.js:16
role: Joi.string().trim().uppercase().valid(...Object.values(ROLES)).default(ROLES.ADMIN),
```

Internet pe koi bhi valid payload bhej kar **super admin** ban sakta hai — aur phir saare `isAdmin` endpoints khul jaate hain (promo codes, subscription grants, webhook replay, broadcast).

**Recommended fix:** `isAdmin` middleware lagao — sirf existing admin naya admin bana sake. Detail → [security_findings.md](./security_findings.md) #2

---

## 2. POST /auth/login

Password login.

**Access:** Intended: ADMIN · Enforced: **Public**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `type` | string | ✅ | `EMAIL` \| `MOBILE` \| `USERNAME` |
| `email` | string | ⚠️ | `type: EMAIL` pe required |
| `mobile` | string | ⚠️ | `type: MOBILE` pe required |
| `username` | string | ⚠️ | `type: USERNAME` pe required |
| `password` | string | ✅ | |
| `role` | string | ❌ | Default `ADMIN` |

```json
{ "type": "EMAIL", "email": "admin@trydood.com", "password": "Admin@2026", "role": "ADMIN" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Login successful",
  "data": { "user": { "_id": "…", "role": "ADMIN", "name": "admin user" }, "token": "eyJ..." }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | *(user not found)* | Us identifier + role ka user nahi |
| `401` | *(invalid credentials)* | Password galat |
| `403` | `Your account is deactivated. Please contact support.` | |
| `422` | `Invalid login type` | `type` enum me nahi |

### ⚠️ Notes

**1. ✅ Fail-closed hai.** Jin accounts ne `POST /auth/set-password` se password set nahi kiya, un pe ye **kabhi kaam nahi karega**. Model comment: *"password at all, so every password login path fails closed."*

**2. Naye admin ko pehle password set karna hoga** — ya `register` se (jo password maangta hai), ya OTP login karke `set-password` se.

**3. `role` default `ADMIN` hai** — vendor ke liye explicitly `"VENDOR"` bhejna padta.

---

## 3. POST /auth/loginOrSignUp-with-whatsapp

WhatsApp OTP — **`role: "ADMIN"` bhejne pe admin account bhi banata hai**.

**Access:** Intended: Customer + Vendor · Enforced: 🔴 **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `role` | string | ❌ | `CUSTOMER` | ROLES enum, auto-uppercase |

```json
{ "whatsappNumber": "9800000000", "role": "ADMIN" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "OTP sent to your whatsapp number successfully.",
  "data": {
    "isFirst": true,
    "user": {
      "_id": "68f1a2b3c4d5e6f7a8b9c000",
      "role": "ADMIN",
      "loginType": "WHATSAPP",
      "whatsappNumber": "9800000000",
      "uniqueId": "TDU000001",
      "referralCode": "ADMIN7X2K",
      "brandId": null,
      "customerId": null,
      "isActive": true
    }
  }
}
```

### Errors
| Status | Message |
|---|---|
| `403` | `Your account is deactivated. Please contact support.` |
| `422` | `WhatsApp number is required` / `Please enter a valid 10 digit WhatsApp number` |
| `422` | `Invalid role` |

### 🔴 CRITICAL — ye admin banane ka doosra unauthenticated raasta hai

Service koi role restriction nahi lagati:
```js
// services/auth/loginOrSignUpWithWhatsapp.js:19
role = role?.toUpperCase() || ROLES.CUSTOMER;
let user = await User.findOne({ whatsappNumber, role, isDeleted: false });
if (!user) {
  isFirst = true;
  user = await User.create({ whatsappNumber, role, … });   // ← role: "ADMIN" allowed
  // Brand sirf VENDOR pe banta hai, Customer sirf CUSTOMER pe — ADMIN pe kuch nahi
}
```

`role: "ADMIN"` bhejne pe **naya ADMIN user ban jaata hai**, aur kyunki OTP verify commented out hai (#4), koi bhi 6-digit code se uska token mil jaata hai.

**`/auth/register` (#1) se bhi aasan hai** — yahan sirf phone number chahiye, email/username/password/dob kuch nahi.

**Recommended fix:** `role` ko `CUSTOMER` aur `VENDOR` tak seemit karo is endpoint pe — admin creation `/auth/register` ke peeche `isAdmin` ke saath rahe. Detail → [security_findings.md](./security_findings.md) #15

---

## 4. POST /auth/verify-otp-whatsapp

**Access:** Intended: Customer + Vendor · Enforced: 🔴 **Public**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `otp` | string | ✅ | – | Exactly 6 characters |
| `role` | string | ❌ | `CUSTOMER` | ROLES enum |
| `currentScreen` | string | ❌ | – | SCREENS enum |

### Success — `200`
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": { "user": { "_id": "…", "role": "ADMIN" }, "token": "eyJ..." }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Invalid Whatsapp number, user not found!` |
| `422` | `OTP is required` / `OTP must be 6 digits` |

### 🔴 CRITICAL — OTP verify hota hi nahi

```js
// services/auth/verifyOtpWithWhatsapp.js:12
//  await verifyOtp(whatsappNumber, otp);
```

**Koi bhi 6-digit string valid token de deta hai.** #3 ke saath milkar ye poora auth bypass hai — do calls me kisi bhi role ka JWT.

Email aur Mobile OTP flows me verification **intact** hai. Admin panel ko **email OTP (#5–6) ya password login (#2) use karna chahiye**, WhatsApp nahi.

---

## 5–8. Email & Mobile OTP Login Flows

Admin ke liye **email OTP recommended path** hai — yahan verification actually chalti hai.

| # | Endpoint | `role` default | Notes |
|---|---|---|---|
| 5 | `POST /auth/login-with-email` | **`ADMIN`** | Email pe OTP. Admin ke liye default sahi hai |
| 6 | `POST /auth/verify-otp-email` | **`ADMIN`** | OTP 6 digits (`/^\d{6}$/`) → JWT |
| 7 | `POST /auth/login-with-mobile` | **`ADMIN`** | Response me `sessionId` aata hai |
| 8 | `POST /auth/verify-otp-mobile` | **`ADMIN`** | `sessionId` + `otp` dono chahiye |

**Access (chaaron):** Intended: Vendor + Admin · Enforced: **Public**

### Body — #5 (email OTP send)
| Field | Type | Required | Default |
|---|---|---|---|
| `email` | string | ✅ | – |
| `role` | string | ❌ | `ADMIN` |

### Body — #6 (email OTP verify)
| Field | Type | Required | Default |
|---|---|---|---|
| `email` | string | ✅ | – |
| `otp` | string | ✅ | – (6 digits) |
| `role` | string | ❌ | `ADMIN` |
| `currentScreen` | string | ❌ | – |

### Body — #7 (mobile OTP send)
| Field | Type | Required | Default |
|---|---|---|---|
| `mobile` | string | ✅ | – (10 digits) |
| `role` | string | ❌ | `ADMIN` |

### Body — #8 (mobile OTP verify)
| Field | Type | Required | Notes |
|---|---|---|---|
| `mobile` | string | ✅ | 10 digits |
| `sessionId` | string | ✅ | **#7 ke response se** |
| `otp` | string | ✅ | 6 digits |
| `role` | string | ❌ | Default `ADMIN` |
| `currentScreen` | string | ❌ | |

### Success — `200` (verify endpoints)
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": { "user": { "_id": "…", "role": "ADMIN" }, "token": "eyJ..." }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | *(user not found)* |
| `401` | `Please resend OTP! OTP is expired or missing` |
| `403` | `Max attempts exceeded! Please try again later.` |
| `401` | `Invalid OTP! Please try again.` |
| `422` | `OTP must be a 6 digit number` |
| `422` | `Session ID is required` *(mobile only)* |
| `422` | `Mobile number must be 10 digits` |

### ⚠️ Note
**Email aur Mobile OTP flows me verification intact hai** — sirf WhatsApp flow me commented out hai. Admin ke liye ye safe path hai.

---

## 9. POST /auth/set-password

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `currentPassword` | string | ⚠️ | **Sirf tab required jab account pe already password ho** |
| `newPassword` | string | ✅ | 8–72 chars, ≥1 uppercase + ≥1 lowercase + ≥1 number |

```json
{ "currentPassword": "Admin@2026", "newPassword": "Admin@2027" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Password changed successfully.",
  "data": { "userId": "68f1a2b3c4d5e6f7a8b9c000", "wasFirstTime": false, "passwordSetAt": "2026-08-22T12:05:00.000Z" }
}
```
> Pehli baar pe message: `"Password set successfully. You can now sign in with it."` aur `wasFirstTime: true`

### Errors
| Status | Message |
|---|---|
| `404` | `User not found` |
| `422` | `currentPassword is required to change an existing password.` |
| `401` | `Current password is incorrect.` |
| `422` | `The new password must be different from the current one.` |
| `422` | `Password must be at least 8 characters` |
| `422` | `Password cannot exceed 72 characters` |
| `422` | `Password must include an uppercase letter, a lowercase letter and a number` |

### ⚠️ Notes
**1. 72 chars ka cap bcrypt ki wajah se hai** — uske baad silently truncate ho jaata hai.
**2. `GET /users/get` ka `passwordSetAt` batata hai `currentPassword` field dikhani hai ya nahi.**

---

## 10. POST /auth/forgot-password

**Access:** Intended: All roles · Enforced: **Public**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `type` | string | ✅ | `WHATSAPP` \| `EMAIL` \| `MOBILE` |
| `target` | string | ✅ | Number ya email |
| `role` | string | ❌ | **`"ADMIN"` bhejein** |

```json
{ "type": "EMAIL", "target": "admin@trydood.com", "role": "ADMIN" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "If an account exists for this contact, a verification code has been sent.",
  "data": { "message": "If an account exists for this contact, a verification code has been sent.", "type": "EMAIL" }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `type is required` / `type must be one of: WHATSAPP, EMAIL, MOBILE` |
| `422` | `target (the number or email) is required` |
| `422` | `role must be one of: ADMIN, VENDOR, SUB_VENDOR, CUSTOMER` |

### ⚠️ Notes
**1. ✅ Enumeration-safe** — account ho ya na ho, response same. Frontend generic message dikhaye.
**2. `role` matter karta hai** — same email different roles me ho sakta hai.
**3. OTP ka purpose `"password-reset"` hai** — login OTP yahan replay nahi ho sakta.

---

## 11. POST /auth/reset-password

**Access:** Intended: All roles · Enforced: **Public**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `type` | string | ✅ | Step 10 jaisa |
| `target` | string | ✅ | Step 10 jaisa |
| `otp` | string | ✅ | Jo code aaya |
| `role` | string | ❌ | Step 10 jaisa |
| `newPassword` | string | ✅ | 8–72, uppercase + lowercase + number |

### Success — `200`
```json
{
  "success": true,
  "message": "Password updated. Please sign in with your new password.",
  "data": { "userId": "…", "passwordSetAt": "2026-08-22T12:10:00.000Z" }
}
```

### Errors
| Status | Message |
|---|---|
| `401` | `Please resend OTP! OTP is expired or missing` |
| `403` | `Max attempts exceeded! Please try again later.` |
| `401` | `Invalid OTP! Please try again.` |
| `404` | `No account found for this contact.` |
| `403` | `Your account is deactivated. Please contact support.` |
| `422` | `otp is required` |

### ⚠️ Notes
**1. Yahan "account nahi mila" batana safe hai** — valid OTP present hone ke baad enumerate karne ko kuch nahi bacha.
**2. Token issue nahi hota** — reset ke baad login screen pe bhejein.
**3. OTP single-use hai.**

---

## 12. POST /auth/logout

**Access:** Intended: All roles · Enforced: **Any authenticated** (deactivated account bhi kar sakta hai)

### Body — optional
| Field | Type | Default | Kya karta hai |
|---|---|---|---|
| `pushToken` | string | — | Is device ka push band |
| `allDevices` | boolean | `false` | `true` = har device se sign out — **har purana JWT turant dead** |

```jsonc
{ }                        // sirf is session ka flag saaf
{ "pushToken": "fcm..." }  // + is device ka push band
{ "allDevices": true }     // + har device ka JWT aur push khatam
```

### Success — `200`
```jsonc
{
  "success": true,
  "message": "Logout successful",
  "data": {
    "allDevices": false,
    "sessionsEnded": false,
    "pushDeactivated": 1,
    "activeDevices": 1
  }
}
```

### ✅ RESOLVED — pehle ye sach me kuch nahi karta tha

**Pehle:** endpoint `200` deta tha aur **server par kuch nahi hota tha** — na `isLoggedIn`, na push, na token. Ek chori hua JWT apni poori umr tak chalta rehta, aur notifications us phone par aati rehti jisse user sign out kar chuka tha. Ye doc bhi wahi sequence sikhata tha (`unregister` phir `logout`), yaani client ko wo kaam karna padta jo server ko karna chahiye tha.

**Ab:** flags set hote hain, push deactivate hota hai, aur `allDevices: true` par **har** purana JWT khatam.

⚠️ **`allDevices` sabse zaroori admin ke liye.** Ek admin account platform ka har brand, har payment aur har settlement dekh sakta hai — kho gaye laptop par `sessionsEnded` hi wo ek switch hai jo turant sab band karta hai.

---

## 12a. POST /auth/email/send-verification 🆕
## 12b. POST /auth/email/verify 🆕

**Access:** 🔒 `verifyJwtToken` — **har role**, koi role gate nahi.

`User.isEmailVerified` sabke paas tha aur koi bhi use set nahi kar sakta tha — email edit karne par flag `false` ho jaata tha aur wapas `true` karne ka koi raasta nahi tha.

Ye wahi do endpoint hain jo vendor panel aur customer app use karte hain: ek `User`, ek flow. `email` **dono call par optional** — na bhejein to account ka apna address confirm hota hai, bhejein to us par switch (aur **verify hone tak account nahi badalta**).

```jsonc
// 12a
{ }                              // apna address confirm
{ "email": "ops@trydood.com" }   // is par switch

// 12b
{ "otp": "482913" }
```

| Code | Kab |
|---|---|
| `200` | Code gaya / verify ho gaya |
| `401` | Code galat, expire, ya use ho chuka |
| `403` | Attempts khatam |
| `409` | Address pehle se verified, ya kisi aur ke **usi role** ke account par |
| `422` | Account par email hai hi nahi aur aapne bheja bhi nahi |
| `429` | Throttle — 60s gap, 5 per hour, **target address** par keyed |

⚠️ **Code hamesha naye address par jaata hai**, purane par nahi. Purane mailbox par bhejna sirf ye sabit karta hai ki insaan purana mailbox padh leta hai — sawal wo hai hi nahi.

⚠️ **`sentTo` masked hota hai.** Ye endpoint chori hui session se bhi chal sakta hai.

⚠️ **Uniqueness `{ email, role }` par**, aur **verify par dobara** check hoti hai — dono call ke beech minute nikalte hain aur utni der me koi aur wo address le sakta hai.

Poora detail: [vendor doc #19c/#19d](./vendor_panel_api_doc.md#19c-post-authemailsend-verification-).

---

# User Profile APIs

## 13. GET /users/get

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | ⚠️ Kisi bhi user ka profile deta hai — [Appendix B](#appendix-b--known-issues) |

### Success — `200`
```json
{
  "success": true,
  "message": "User fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c000",
    "brandId": null,
    "customerId": null,
    "name": "admin user",
    "role": "ADMIN",
    "loginType": "PASSWORD",
    "email": "admin@trydood.com",
    "username": "admin_user",
    "whatsappNumber": "9800000000",
    "mobile": "9800000000",
    "uniqueId": "TDU000001",
    "referralCode": "ADMIN7X2K",
    "passwordSetAt": "2026-04-01T00:00:00.000Z",
    "isEmailVerified": false,
    "isActive": true,
    "createdAt": "2026-04-01T00:00:00.000Z"
  }
}
```

**Excluded:** `password`, `otp`, `isDeleted`
> Admin ke liye `brandId` aur `customerId` dono `null` rahenge.

### Errors
| Status | Message |
|---|---|
| `401` | `Unauthorized access! User not found.` |
| `422` | `Invalid ID` |

### ⚠️ Note
⚠️ `?userId` support ek IDOR hai — **admin panel ise support tool ke roop me use kar sakta hai**, par jaanein ki **vendor aur customer bhi ye kar sakte hain**. Fix hone pe admin-only ho jayega.

---

## 14. PUT /users/update

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | ⚠️ Kisi bhi user ka update — IDOR |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `fullName` | string | 2–100 chars |
| `email` | string | Valid email |
| `dob` | string | ISO date |
| `appliedReferralCode` | string | Max 20 chars |
| `image` | file | Multipart, field name `image` |

### Success — `200`
```json
{ "success": true, "message": "User profile updated successfully", "data": { "_id": "…", "name": "admin user" } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `User not found` / `Customer not found` |
| `400` | `Email already exists with another user` |
| `422` | `Name should have at least 2 characters` |
| `422` | `Please enter a valid email address` |
| `422` | `Date of birth must be a valid date in ISO format (YYYY-MM-DD)` |

### ⚠️ Notes
**1. `mobile`/`whatsappNumber` update nahi ho sakte** — validator me commented.
**2. Email uniqueness role-scoped hai.**
**3. Ye endpoint `validateSchema` middleware use nahi karta** — controller me manual validation, error format thoda different.

---

## 15. DELETE /users/delete

⚠️ **No-op stub.**

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Success — `200`
```json
{ "message": "User deleted successfully" }
```
> Standard envelope nahi — koi `success` field nahi.

### ⚠️ Critical
Route me inline handler hai, kuch delete nahi hota. Admin panel me user-deletion feature disable rakhein — ya DB-level tooling use karein.

---

# Push Notification APIs

Role-agnostic module. Admin ka browser bhi bilkul vendor/customer jaise register hota hai.
Global middleware: `router.use(verifyJwtToken)`

## 16. POST /deviceTokens/register

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `token` | string | ✅ | 20–4096 chars — FCM token |
| `platform` | string | ✅ | `ANDROID` \| `IOS` \| `WEB` |
| `deviceId` | string | ❌ | Max 128 — **bhejein**, reinstall pe purana retire hota hai |
| `deviceName` | string | ❌ | Max 128 |
| `appVersion` | string | ❌ | Max 32 |

### Success — `200`
```json
{
  "success": true,
  "message": "Device registered for push notifications",
  "data": {
    "device": { "_id": "…", "role": "ADMIN", "platform": "WEB", "isActive": true, "failureCount": 0 },
    "activeDevices": 1
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
**1. Idempotent** — `token` pe upsert.
**2. `role` denormalize hota hai** — isse `roles: ["ADMIN"]` targeted broadcasts fast rehte hain.
**3. Admin ko critical alerts push pe milte hain** — `WEBHOOK_FAILED`, `PAYMENT_DISPUTED`. Register karna zaruri hai.

---

## 17. PUT /deviceTokens/unregister

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body
| Field | Type | Required | Default |
|---|---|---|---|
| `token` | string | ⚠️ | – |
| `allDevices` | boolean | ⚠️ | `false` |

⚠️ Ek dena mandatory hai.

### Success — `200`
```json
{ "success": true, "message": "Device unregistered from push notifications", "data": { "deactivated": 1, "activeDevices": 0 } }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Provide a token, or set allDevices to true.` |

### ⚠️ Note
Self-scoped — filter hamesha `userId` carry karta hai.

---

## 18. GET /deviceTokens/get-mine

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Default |
|---|---|---|
| `includeInactive` | boolean\|string | `false` |

### Success — `200`
```json
{
  "success": true,
  "message": "Registered devices fetched successfully",
  "data": {
    "devices": [{ "_id": "…", "role": "ADMIN", "platform": "WEB", "isActive": true, "tokenTail": "…APA91bH" }],
    "activeDevices": 1,
    "total": 1
  }
}
```

### ⚠️ Note
Poora `token` kabhi nahi aata — sirf `tokenTail`. Empty pe `[]`, 404 nahi.

---

## 19. POST /deviceTokens/test

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Body — dono optional
| Field | Type | Default | Validation |
|---|---|---|---|
| `title` | string | `"Test notification"` | Max 160 |
| `body` | string | `"If you can read this, push notifications are working."` | Max 1000 |

### Success — `200`
```json
{ "success": true, "message": "Test push dispatched", "data": { "devices": 1, "sent": 1, "failed": 0, "delivered": true } }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Push credentials were rejected by the provider: <reason>` |
| `404` | `You have no active devices registered. Call POST /deviceTokens/register from the app first.` |

### ⚠️ Note
**Broadcast bhejne se pehle ye chalayein** — `422` credentials error batata hai ki FCM setup galat hai, aur broadcast bhi fail hoga.

---

# Notification APIs

## 20. GET /notifications/get-all

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | |
| `limit` | number | ❌ | `20` | Max 100 |
| `brandId` | ObjectId | ❌ | – | ⚠️ **Omit karne pe admin-audience feed** |
| `type` | string | ❌ | – | NOTIFICATION_TYPES enum |
| `isRead` | boolean\|string | ❌ | – | |

**Admin-audience feed (apne alerts):**
```http
GET /notifications/get-all?isRead=false
```

**Kisi brand ki feed:**
```http
GET /notifications/get-all?brandId=68f1a2b3c4d5e6f7a8b9c3a1
```

### Success — `200` (admin feed)
```json
{
  "success": true,
  "message": "Notifications fetched successfully",
  "data": {
    "total": 5,
    "unreadCount": 3,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9e001",
        "brandId": null,
        "type": "WEBHOOK_FAILED",
        "title": "Payment captured but plan not activated",
        "body": "Webhook evt_PxAbC123 failed for order_PxYzAbC123 (₹1,178.82). Replay required.",
        "severity": "CRITICAL",
        "channels": ["IN_APP", "EMAIL", "PUSH"],
        "isRead": false,
        "deepLink": "/admin/webhooks/evt_PxAbC123",
        "meta": { "eventId": "evt_PxAbC123", "transactionId": "68f1a2b3c4d5e6f7a8b9m001" },
        "createdAt": "2026-08-22T19:05:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9e002",
        "type": "PAYMENT_DISPUTED",
        "title": "Chargeback raised",
        "body": "Dispute on pay_PxYzDeF456 (₹1,178.82). Respond by 30 Aug 2026.",
        "severity": "CRITICAL",
        "isRead": false,
        "createdAt": "2026-08-22T18:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9e003",
        "type": "BRAND_SUBSCRIPTION_LAPSED",
        "title": "Paying brand lapsed",
        "body": "cafe mocha's BASIC plan expired on 21 Aug 2026.",
        "severity": "WARNING",
        "isRead": true,
        "createdAt": "2026-08-22T00:05:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Invalid brandId` |
| `422` | `type must be one of: SUBSCRIPTION_ACTIVATED, …` |
| `404` | `Brand not found!` |

### ⚠️ Notes

**1. `brandId` omit karna admin ke liye special hai** — validator comment: *"an admin omitting it reads the admin-audience feed instead."* Ye baaki `resolveActorBrand` endpoints se different hai jahan omit karna `422` deta hai.

**2. Admin-only 4 types yahin dikhte hain:**
| Type | Kyun matter karta hai |
|---|---|
| `WEBHOOK_FAILED` | **Paisa captured, plan live nahi** — koi dekhe |
| `PAYMENT_DISPUTED` | Chargeback, deadline hai — miss = paisa gaya |
| `BRAND_SUBSCRIPTION_LAPSED` | Revenue loss, follow-up worth |
| `PROMO_LIMIT_EXCEEDED` | Code cap se aage gaya (pehle quote hua payment baad me settle hua) |

**3. `severity: "CRITICAL"` wale turant dikhane chahiye** — admin dashboard pe banner/toast.

**4. `unreadCount` badge ke liye ready hai.**

**5. Empty pe `[]` aata hai, 404 nahi.**

---

## 21. PUT /notifications/mark-read

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Default |
|---|---|---|---|
| `notificationIds` | ObjectId[] | ⚠️ | – (min 1) |
| `markAll` | boolean | ⚠️ | `false` |
| `brandId` | ObjectId | ❌ | – |

⚠️ **Ek dena mandatory hai.**

### Success — `200`
```json
{ "success": true, "message": "Notifications marked as read", "data": { "modified": 3, "unreadCount": 0 } }
```

### Errors
| Status | Message |
|---|---|
| `422` | `Provide notificationIds or set markAll to true.` |
| `422` | `Provide at least one notificationId` |

---

## 22. POST /notifications/broadcast

🔴 **Platform ke har user tak pahunch sakta hai.** Sabse powerful endpoint.

**Access:** Intended: ADMIN · Enforced: **ADMIN**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `title` | string | ✅ | – | Max 160 chars |
| `body` | string | ✅ | – | Max 1000 chars |
| `target` | object | ✅ | – | Audience — niche detail |
| `severity` | string | ❌ | – | `INFO` \| `WARNING` \| `CRITICAL` |
| `type` | string | ❌ | `ANNOUNCEMENT` | NOTIFICATION_TYPES enum |
| `push` | boolean | ❌ | `true` | Push bhejni hai ya sirf in-app |
| `deepLink` | string | ❌ | – | Max 512 — tap pe kahan jaana |
| `imageUrl` | string | ❌ | – | Valid URI, max 1024 |
| `meta` | object | ❌ | – | Client ke liye extra data |
| `dryRun` | boolean | ❌ | `false` | ⚠️ **Audience size check, kuch bhejta nahi** |
| `broadcastId` | ObjectId | ❌ | – | Pichhle broadcast ka retry |

### `target` object

⚠️ **Kam se kam ek target chahiye.** Multiple do to **union** ho jaate hain.

| Field | Type | Notes |
|---|---|---|
| `userIds` | ObjectId[] | Max **5000** |
| `roles` | string[] | ROLES enum, auto-uppercase |
| `brandIds` | ObjectId[] | Har brand ka owner user |
| `customerIds` | ObjectId[] | Har customer ka user |
| `subBrandIds` | ObjectId[] | Har outlet ka sub-vendor user |
| `all` | boolean | ⚠️ **Explicitly `true` likhna padta hai** |
| `filters.hasEmail` | boolean | Sirf jinke paas email hai |

**Saare vendors ko:**
```json
{
  "title": "Scheduled maintenance",
  "body": "The vendor panel will be unavailable on 25 Aug, 2–4 AM IST.",
  "severity": "WARNING",
  "target": { "roles": ["VENDOR"] },
  "push": true
}
```

**Specific brands ko:**
```json
{
  "title": "Your plan expires soon",
  "body": "Renew before 31 Aug to keep your outlets live.",
  "target": { "brandIds": ["68f1a2b3c4d5e6f7a8b9c3a1", "68f1a2b3c4d5e6f7a8b9c3a2"] },
  "deepLink": "/dashboard/subscription"
}
```

**Sabko (soch-samajh kar):**
```json
{
  "title": "Trydood 2.0 is live",
  "body": "New app, new deals. Update now.",
  "target": { "all": true },
  "dryRun": true
}
```

### Success — `200` (actual send)
```json
{
  "success": true,
  "message": "Notification broadcast successfully",
  "data": {
    "dryRun": false,
    "broadcastId": "68f1a2b3c4d5e6f7a8b9p001",
    "audience": { "resolved": 342, "skipped": 0 },
    "inApp": { "created": 342 },
    "email": { "sent": 310, "failed": 2, "skipped": 30 },
    "push": { "devices": 289, "sent": 285, "failed": 4 }
  }
}
```

### Success — `200` (dry run)
```json
{
  "success": true,
  "message": "Audience resolved — nothing was sent",
  "data": {
    "dryRun": true,
    "audience": { "resolved": 342, "skipped": 0 },
    "inApp": { "created": 0 },
    "email": { "sent": 0 },
    "push": { "devices": 0, "sent": 0 }
  }
}
```

> Message alag hai — `"Audience resolved — nothing was sent"`.

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `An audience is required: pass userIds, roles, brandIds, customerIds, subBrandIds, or all.` | `target` khali |
| `422` | `title is required` / `title cannot exceed 160 characters` | |
| `422` | `body is required` / `body cannot exceed 1000 characters` | |
| `422` | `You cannot name more than 5000 users in one send` | `userIds` limit |
| `422` | `roles must contain only: ADMIN, VENDOR, SUB_VENDOR, CUSTOMER` | |
| `422` | `severity must be one of: INFO, WARNING, CRITICAL` | |
| `422` | `type must be one of: SUBSCRIPTION_ACTIVATED, …` | |
| `422` | `imageUrl must be a valid URL` | |
| `422` | `Invalid broadcastId` | |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role ADMIN nahi |

### ⚠️ Edge cases & notes

**1. ⚠️ HAMESHA `dryRun: true` pehle chalayein.** Validator comment: *"Resolve the audience and report its size without sending anything. Worth running before any wide broadcast."* Audience size dekh kar hi actual send karein.

**2. `all: true` explicitly likhna padta hai.** Comment: *"Nobody should reach every user on the platform by leaving a field off."* Field chhodne se sab tak nahi pahunch sakte.

**3. Targets union hote hain** — `{ roles: ["VENDOR"], brandIds: [...] }` dono ka union bhejega, intersection nahi.

**4. 5000 recipients ka hard cap hai per dispatch.** Usse bada broadcast job ke through jaana chahiye, request ke through nahi — *"so one call cannot tie up the process or the provider quota."*

**5. `broadcastId` se retry** — pichhle broadcast ka id do to **jo already receive kar chuke hain wo skip ho jaate hain**, sirf missed wale ko jaata hai. Partial failure recover karne ke liye.

**6. `IN_APP` hamesha likha jaata hai.** `push` / email tabhi jaate hain jab destination ho aur channel `Setting.vendor.subscription` me enabled ho.

**7. Push 500 tokens ke batches me jaata hai** (FCM limit).

**8. `type` override kar sakte hain** — default `ANNOUNCEMENT`, par koi aur type bhej kar client ke existing rendering/deep-link ko reuse kar sakte hain.

**9. WhatsApp channel abhi off hai** (`isWhatsAppNotificationEnabled: false`) — Meta template approval pending.

---

## 22a. GET /notifications/admin/preferences 🆕

**Access:** Intended: ADMIN · Enforced: **ADMIN**

Kisi bhi ek user ke teen channel toggles padho — customer, vendor, outlet manager
ya doosra admin. Profile card ke switches yahin se aate hain.

### Query — **teeno me se theek ek**
| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | Seedha user |
| `customerId` | ObjectId | Customer directory se |
| `brandId` | ObjectId | Brand list se — brand ka **owner** resolve hota hai |

⚠️ **`xor` hai, `or` nahi.** Do id bhejne par `422`. Warna do id aapas me disagree
karein to service jo pehle check kare wahi jeet jaata — chup-chaap.

```
GET /notifications/admin/preferences?customerId=68f1a2b3c4d5e6f7a8b9c3a1
```

### Success — `200`
```jsonc
{
  "success": true,
  "message": "Notification preferences fetched successfully",
  "data": {
    "userId": "68f1a2b3c4d5e6f7a8b9c001",
    "role": "CUSTOMER",
    "audience": "CUSTOMER",
    "channels": {
      "email":    { "preference": true,  "effective": true,  "blockedBy": null },
      "push":     { "preference": false, "effective": false, "blockedBy": "PREFERENCE" },
      "whatsapp": { "preference": true,  "effective": false, "blockedBy": "PLATFORM" }
    },
    "updatedBy": { "_id": "68f1…", "name": "ops admin", "role": "ADMIN" },
    "updatedAt": "2026-09-05T09:12:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Pass exactly one of userId, customerId or brandId.` |
| `422` | `This customer has no user account to set preferences on` |
| `404` | `User not found` · `Customer not found` · `Brand not found` |

## 22b. PUT /notifications/admin/preferences 🆕

**Access:** Intended: ADMIN · Enforced: **ADMIN**

### Body
| Field | Type | Required | Notes |
|---|---|---|---|
| `userId` \| `customerId` \| `brandId` | ObjectId | ✅ | Theek **ek** |
| `email` | boolean | ⚠️ | |
| `push` | boolean | ⚠️ | |
| `whatsapp` | boolean | ⚠️ | |

⚠️ Kam se kam ek channel bhi chahiye. Sirf id bhejna ek aisi request hoti jo kuch
badalti nahi aur phir bhi `200` deti — panel use "save ho gaya" padhta.

```json
{ "customerId": "68f1a2b3c4d5e6f7a8b9c3a1", "push": false }
```

### 🔴 Ye **user ki** preference likhta hai, platform toggle nahi

Ek customer ka WhatsApp on karne se **har customer** ka WhatsApp on nahi hota.
Platform-wide switch `PUT /settings` me hai (neeche `Setting.admin.notification`
aur `Setting.customer.notification`).

Agar platform switch hi band hai, to write **ho jaata hai** aur response saaf
bolta hai:

```jsonc
"whatsapp": { "preference": true, "effective": false, "blockedBy": "PLATFORM" }
```

Toggle on dikhega ek note ke saath. User ka choice store rehta hai aur jis din
platform switch chalu hoga usi din lag jayega. `422` dena user ka choice record
hi nahi hone deta.

### ⚠️ `updatedBy` sirf naam deta hai

`{ _id, name, role }` — email/mobile nahi. Ye kisi **doosre** ke profile card par
render hota hai; *"kis admin ne chhua"* ke liye naam chahiye, colleague ke inbox
ka raasta nahi.

`updatedBy: null` + `updatedAt` present = **usi bande ne khud badla tha**. Khud ka
change purana admin stamp hata deta hai, taaki naam wahan na pada rahe jo ab state
explain nahi karta.

### ⚠️ Chhe types preference se upar hain

`REFUND_BANK_DETAILS_REQUESTED`, `BRAND_DEACTIVATED`, `REFUND_FAILED`,
`SETTLEMENT_LEDGER_DRIFT`, `SHADOW_INDEX_REAPED`, `DISPUTE_DEADLINE` — inme chup
rehne se padhne wale ki pahunch ya paisa jaata hai. Rule aur poori list:
[`notification_preferences.md`](./notification_preferences.md).

⚠️ **Ye sirf user ka toggle override karti hain, platform ka nahi** — platform
switch tab lagta hai jab SMTP down ho ya Meta template na ho, aur us haalat me
send karna sirf provider se reject hona hai.

### Profile card par bina extra call ke

Raw sub-document un responses me already aa jaata hai jo panel pehle se fetch
karta hai:

| Endpoint | Kahan |
|---|---|
| `GET /customers/admin/get-all` | `account.notificationPreferences` |
| `GET /customers/admin/:customerId` | `account.notificationPreferences` |
| `GET /brands/admin/get-all` | `vendor.notificationPreferences` |

⚠️ **Raw hai, aur aksar poori tarah absent.** Field tabhi banta hai jab koi pehli
baar setting badalta hai — **absent ka matlab sab on**. Un booleans ko seedha mat
padhiye; resolved jawab (aur platform override) `GET /notifications/admin/preferences`
deta hai.

---

# Brand Verification APIs

Vendor KYC review queue. **Ye admin ka core workflow hai.**

> 📖 **Ye 3 endpoints [brand_verification_api_doc.md](./brand_verification_api_doc.md) me full depth me documented hain** — scoring table (har flag ka weightage), state machine, model reference, aur frontend integration notes ke saath. Yahan summary + admin-specific detail hai.

## 23. GET /brands/admin/verifications

Verification queue.

**Access:** Intended: ADMIN · Enforced: **ADMIN**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | |
| `brandId` | ObjectId | ❌ | – | |
| `reviewedByAdminId` | ObjectId | ❌ | – | Kis admin ne review kiya |
| `status` | string | ❌ | – | SYSTEM_VERIFICATION_STATUS enum, auto-uppercase |
| `attemptNumber` | number | ❌ | – | Integer ≥ 1 |
| `isReviewed` | boolean\|string | ❌ | – | "Seen" flag |
| `isRejected` · `isRevoked` · `isAdminApproved` · `isSuperseded` | boolean\|string | ❌ | – | |
| `minScore` · `maxScore` | number | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | `toDate` >= `fromDate` |
| `sortBy` | string | ❌ | – | `NEWEST` \| `OLDEST` \| `SCORE` (**uppercase**) |
| `sortOrder` | string | ❌ | – | `ASC` \| `DESC` (**uppercase**) |

**Review queue (main view):**
```http
GET /brands/admin/verifications?status=MANUAL_REVIEW&isReviewed=false&sortBy=OLDEST
```

**Low-score rejections:**
```http
GET /brands/admin/verifications?status=REJECTED&maxScore=75&sortBy=SCORE&sortOrder=ASC
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand verifications fetched successfully.",
  "data": {
    "total": 14,
    "totalPages": 2,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9h001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "brand": {
          "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
          "brandName": "cafe mocha",
          "legalBusinessName": "mocha hospitality private limited",
          "uniqueId": "TDB000078",
          "merchantId": "TDM000078",
          "businessEntityType": "PRIVATE_LIMITED"
        },
        "score": 82,
        "status": "MANUAL_REVIEW",
        "attemptNumber": 1,
        "isReviewed": false,
        "isRejected": false,
        "isRevoked": false,
        "isAdminApproved": false,
        "isSuperseded": false,
        "flags": {
          "panVerified": true,
          "gstVerified": true,
          "bankVerified": true,
          "panMatchedWithGST": true,
          "panMatchedWithBrand": false,
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
        "nameMatch": { "panGstScore": 100, "panBrandScore": 68, "gstBrandScore": 95, "averageScore": 87.6 },
        "bankNameMatch": { "bankPanScore": 100, "bankGstScore": 98, "bankBrandScore": 71, "highestScore": 100 },
        "duplicateDetails": { "panBrandIds": [], "gstBrandIds": [], "bankBrandIds": [], "whatsappBrandIds": [], "emailBrandIds": [] },
        "remarks": "Brand name differs from PAN holder name",
        "createdAt": "2026-08-22T12:15:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any systemverify found` — **empty-state** |
| `422` | `Invalid Brand ID format` / `Invalid Reviewed By ID format` |
| `422` | `Status must be one of PENDING, APPROVED, MANUAL_REVIEW, UNDER_REVIEW, REJECTED` |
| `422` | `Sort by must be one of NEWEST, OLDEST, SCORE` |
| `422` | `To date cannot be earlier than from date` |
| `422` | `Limit cannot exceed 100` |

### ⚠️ Notes

**1. `sortBy` / `sortOrder` UPPERCASE hain** — baaki modules me lowercase (`asc`/`desc`) hote hain. Yahan `ASC`/`DESC`.

**2. `isReviewed` "seen" flag hai, status nahi.** Admin bina decision liye bhi mark kar sakta hai ki dekh liya — queue triage ke liye.

**3. `isSuperseded: true` matlab vendor ne resubmit kar diya** — ye purana attempt hai, naya dekho.

**4. `flags` me `false` wale hi problem hain** — UI me highlight karein. `remarks` human-readable summary deta hai.

**5. `duplicateDetails` batata hai kaunse doosre brands ne wahi PAN/GST/bank/number/email use kiya** — fraud detection ke liye.

**6. Score bands:** ≥90 auto-`APPROVED`, ≥75 `MANUAL_REVIEW`, <75 `REJECTED`.

> 📖 Har flag ka exact weightage aur scoring formula → [brand_verification_api_doc.md](./brand_verification_api_doc.md) (Scoring Table)

---

## 24. PUT /brands/admin/verifications/:brandId/review

Approve / reject / revoke / reviewed-toggle.

**Access:** Intended: ADMIN · Enforced: **ADMIN**

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `action` | string | ✅ | `APPROVED` \| `REJECTED` \| `REVOKED` \| `REVIEWED` (auto-uppercase) |
| `rejectionReason` | string | ⚠️ | **`REJECTED` pe required**, baaki pe **forbidden**. Max 1000 |
| `revokeReason` | string | ⚠️ | **`REVOKED` pe required**, baaki pe **forbidden**. Max 1000 |
| `isReviewed` | boolean | ⚠️ | **Sirf `REVIEWED` ke saath allowed**. Omit = toggle |
| `note` | string | ❌ | Max 1000 — kisi bhi action ke saath |

**Approve:**
```json
{ "action": "APPROVED", "note": "Documents verified, all good" }
```

**Reject:**
```json
{
  "action": "REJECTED",
  "rejectionReason": "Bank account holder name does not match the PAN holder name. Please update and resubmit.",
  "note": "Name match score 68"
}
```

**Revoke (already-approved brand):**
```json
{ "action": "REVOKED", "revokeReason": "GST registration found cancelled on the portal" }
```

**Reviewed toggle:**
```json
{ "action": "REVIEWED" }
```
```json
{ "action": "REVIEWED", "isReviewed": true }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand approved successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "systemVerifyId": "68f1a2b3c4d5e6f7a8b9h001",
    "action": "APPROVED",
    "status": "APPROVED",
    "isAdminApproved": true,
    "isReviewed": true,
    "attemptNumber": 1,
    "reviewedBy": { "_id": "68f1a2b3c4d5e6f7a8b9c000", "name": "admin user" },
    "reviewedAt": "2026-08-22T13:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | |
| `404` | *(no verification)* | Brand ne system-verify kabhi chalaya hi nahi |
| `400` | *(invalid transition)* | Jaise pending brand ko `REVOKED` karna |
| `422` | `Review action is required` | |
| `422` | `Review action must be one of APPROVED, REJECTED, REVIEWED, REVOKED` | |
| `422` | `Rejection reason is required when rejecting a brand` | |
| `422` | `Rejection reason is only allowed when rejecting a brand` | Galat action ke saath bheja |
| `422` | `Revoke reason is required when revoking an approval` | |
| `422` | `Revoke reason is only allowed when revoking an approval` | |
| `422` | `isReviewed is only allowed with the REVIEWED action` | |
| `422` | `Rejection reason cannot exceed 1000 characters` | |
| `422` | `Invalid Brand ID format` | |

### ⚠️ Edge cases & notes

**1. Validator strict hai — extra fields forbidden hain.** `APPROVED` ke saath `rejectionReason` bhejoge to `422` aayega, silently ignore nahi hoga. Form me action ke hisaab se fields dikhayein.

**2. `REVIEWED` status nahi badalta** — sirf "seen" flag toggle karta hai. Constant ka comment: *"toggle-only, never changes the status."* Queue triage ke liye.

**3. `isReviewed` omit karo = toggle, explicit boolean do = force.** Validator comment: *"Omit it to flip the current value, or send an explicit boolean to force it (idempotent panels)."* Idempotent UI ke liye explicit bhejein.

**4. `REVOKED` sirf already-approved brand pe valid hai.**

**5. `rejectionReason` vendor ko dikhta hai** — `GET /brands/verifications/history` me. Actionable likhein, taaki vendor theek karke resubmit kar sake.

**6. Har action ek naya history row banata hai** — overwrite nahi hota.

**7. Approve karne ke baad vendor ko `PUT /brands/onboarding/acknowledge-approval` call karna hota hai** — tab uska screen `DASHBOARD` hota hai.

**8. ⚠️ `brand.isApproved` aur `brand.status` code me kahin set nahi hote** — approval ka truth `SystemVerify` doc pe hai. Admin panel ko wahi dekhna chahiye.

> 📖 Full state machine, har transition, aur response ka poora shape → [brand_verification_api_doc.md](./brand_verification_api_doc.md) (Section 3)

---

## 25. GET /brands/verifications/history

Verification audit trail. **Admin koi bhi brand dekh sakta hai.**

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `brandId` | ObjectId | ❌ | – | **Admin ke liye — jis brand ki history chahiye** |
| `systemVerifyId` | ObjectId | ❌ | – | Ek attempt ki history |
| `performedBy` | ObjectId | ❌ | – | Kis user ne kiya |
| `action` | string | ❌ | – | BRAND_VERIFICATION_ACTION enum |
| `performedByType` | string | ❌ | – | `SYSTEM` \| `ADMIN` \| `VENDOR` |
| `attemptNumber` | number | ❌ | – | |
| `search` | string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortOrder` | string | ❌ | `DESC` | `ASC` \| `DESC` (**uppercase**) |

```http
GET /brands/verifications/history?brandId=68f1a2b3c4d5e6f7a8b9c3a1&sortOrder=ASC
```

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
        "performedBy": { "_id": "68f1a2b3c4d5e6f7a8b9c000", "name": "admin user", "role": "ADMIN" },
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
        "action": "REMEDIATION_UPDATED",
        "performedByType": "VENDOR",
        "attemptNumber": 1,
        "note": "Bank details updated",
        "createdAt": "2026-08-22T11:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9i004",
        "action": "REJECTED",
        "performedByType": "ADMIN",
        "performedBy": { "_id": "…", "name": "admin user" },
        "attemptNumber": 1,
        "score": 68,
        "rejectionReason": "Bank account holder name does not match the PAN",
        "createdAt": "2026-08-21T10:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9i005",
        "action": "SYSTEM_VERIFIED",
        "performedByType": "SYSTEM",
        "attemptNumber": 1,
        "score": 68,
        "createdAt": "2026-08-21T09:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Brand not found for user.` | Vendor context me brand nahi |
| `422` | `Invalid Brand ID format` | |
| `422` | `Action must be one of SYSTEM_VERIFIED, RESUBMITTED, …` | |
| `422` | `Performed by type must be one of SYSTEM, ADMIN, VENDOR` | |
| `422` | `To date cannot be earlier than from date` | |

### ⚠️ Notes

**1. Admin ke liye `brandId` filter hai, scoping nahi** — jo brand chaho dekho.

**2. Har event naya row hai** — poora timeline milta hai, kuch overwrite nahi hota.

**3. Typical timeline padhne ka tareeka** (`sortOrder=ASC`):
```
SYSTEM_VERIFIED      (SYSTEM)  score 68  → auto-rejected
REJECTED             (ADMIN)   reason bataya
REMEDIATION_UPDATED  (VENDOR)  fields theek kiye
RESUBMITTED          (VENDOR)  score 94  → dobara chalaya
APPROVED             (ADMIN)   ✅
APPROVAL_ACKNOWLEDGED (VENDOR) dashboard pe gaya
```

**4. ⚠️ Ye endpoint pe role gate nahi hai** aur service ki scoping sirf `VENDOR` handle karti hai — `CUSTOMER` bhi koi bhi `brandId` padh sakta hai. Security finding #13 ([Appendix B](#appendix-b--known-issues)).

> 📖 Full detail → [brand_verification_api_doc.md](./brand_verification_api_doc.md) (Section 5)

---

# Brand Data APIs

## 26. GET /brands/get

Brand ka poora detail — 14 lookups.

**Access:** Intended: All roles · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | **Admin ke liye effectively required** — token me `brandId` nahi hota, na do to `400` |

```http
GET /brands/get?brandId=68f1a2b3c4d5e6f7a8b9c3a1
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
    "logo": "https://res.cloudinary.com/…/mocha-logo.jpg",
    "coverImage": "https://res.cloudinary.com/…/mocha-cover.jpg",
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
    "subBrandsLimit": 10,
    "subBrandsUsed": 3,
    "isActive": true,
    "user": [{ "_id": "…", "role": "VENDOR", "name": "rahul sharma", "email": "…" }],
    "pans": [{ "pan": "AABCM1234K", "isVerified": true }],
    "gsts": [{ "gstNumber": "23AABCM1234K1ZP", "isVerified": true }],
    "banks": [{ "accountNumber": "912010012345678", "ifscCode": "UTIB0001234" }],
    "systemverifies": [{ "score": 94, "status": "APPROVED" }],
    "subscribeds": [{ "status": "ACTIVE", "endDate": "2026-09-21T23:59:59.000Z" }],
    "categories": [{ "name": "food & beverages" }],
    "subcategories": [{ "name": "cafe" }],
    "locations": [{ "formattedAddress": "…", "geo": {} }],
    "workhours": [{ "monday": {} }],
    "subbrands": [{ "_id": "…", "storeId": "MOCHA-VN-01", "user": [], "locations": [], "workhours": [] }],
    "createdAt": "2026-03-15T00:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid brand ID` | Format galat, **ya `brandId` bheja hi nahi** |
| `404` | *(empty)* | Brand nahi mila |
| `422` | `Invalid brandId` | Joi check |

### ⚠️ Notes

**1. Admin ke liye `brandId` mandatory hai.** Controller ka logic `req.query.brandId || req.brandId` hai — admin token me `brandId` nahi hota, to `undefined` pass hoga aur `400` aayega.

**2. Ye admin ka brand-detail view hai** — PAN/GST/Bank/verification/subscription sab ek jagah. Admin ke liye ye sahi hai.

**3. ⚠️ Problem ye hai ki customer ko bhi yahi data milta hai** — role-based projection nahi hai ([Appendix B](#appendix-b--known-issues)).

**4. ✅ Approval state brand pe denormalized hai** — `status`, `isApproved`, `isReviewed`, `isRejected`, `isRevoked`, `rejectionReason`, `revokeReason`, `isApprovalAcknowledged`. `PUT /brands/admin/verifications/:brandId/review` (#25) aur vendor ka acknowledge inhe maintain karte hain. Brand list/detail screens ke liye yahi kaafi hai; `systemverifies[0]` sirf score/flags ke liye.

**5. `subBrandsLimit`/`subBrandsUsed` plan pools batate hain** — detailed usage ke liye `GET /subscribeds/get?brandId=…` (#76) behtar hai.

---

## 27. PUT /brands/update

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | **Admin ke liye required** |

### Body — sab optional
| Field | Type | Validation | Notes |
|---|---|---|---|
| `brandName` | string | 2–150 chars | Lowercase me store |
| `email` | string | Valid email | |
| `description` | string | – | |
| `joinedDate` | date | – | |
| `isActive` | boolean\|string | – | ⚠️ **Brand deactivate karne ka tareeka** |
| `isOnboarding` | boolean | Default `false` | `true` pe `subCategoryId` required |
| `subCategoryId` | ObjectId | – | |
| `logo` | file | Multipart, field `logo` | |

**Brand suspend karna:**
```json
{ "isActive": false }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand details updated successfully",
  "data": { "_id": "…", "brandName": "cafe mocha", "isActive": false, "updatedAt": "2026-08-22T20:00:00.000Z" }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand not found!` / `User not found!` |
| `422` | `Brand name must be at least 2 characters` / `cannot exceed 150 characters` |
| `422` | `Please enter a valid email address` |
| `422` | `Sub-category ID is required during onboarding` |
| `500` | *(Cloudinary upload error)* |

### ⚠️ Notes

**1. `isActive: false` brand ko suspend karta hai** — par ye subscription cancel nahi karta. Uske liye `PUT /subscribeds/admin/cancel` (#77) alag se.

**2. `subCategoryId` set karne se `categoryId` auto-resolve hota hai.**

**3. Transactional hai** — logo upload fail pe rollback.

---

# Outlet APIs

## 28. POST /subBrands/signUp-with-whatsapp

Admin kisi brand ke liye outlet bana sakta hai.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | Admin koi bhi brand |
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `isFirstOutlet` | boolean\|string | ❌ | `false` | |
| `outletType` | string | ❌ | `OUTLET` | `OUTLET` \| `FRANCHISE` |

### Success — `200`
```json
{
  "success": true,
  "message": "OTP sent to subBrand whatsapp number successfully.",
  "data": {
    "user": { "_id": "…", "role": "SUB_VENDOR", "uniqueId": "TDU000201" },
    "subBrand": { "_id": "…", "storeId": "MOCHA-VN-01", "uniqueId": "TDS000201", "outletType": "OUTLET" },
    "usage": {
      "subBrands": { "used": 4, "limit": 10, "isUnlimited": false },
      "franchises": { "used": 0, "limit": 2, "isUnlimited": false }
    }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Outlet/Sub-Brand is already registered with this number` | |
| `403` | `Access denied. This feature requires an active subscription. …` | ⚠️ **Brand ka plan check hota hai, admin ka nahi** |
| `403` | `Outlet/Sub-brand limit reached — 10 of 10 used on your current plan. …` | Brand ka pool full |
| `404` | `Brand not found!` | |
| `422` | `brandId is required when acting as an admin` | |
| `422` | `Brand ID is required` / `Invalid Brand ID format` | |

### ⚠️ Notes

**1. ⚠️ Subscription gate admin pe bhi lagta hai** — kyunki wo **brand** ka plan check karta hai, caller ka nahi. Bina plan wale brand ke liye admin bhi outlet nahi bana sakta.

**Workaround:** pehle `POST /subscribeds/admin/grant` (#76) se plan do, phir outlet banao.

**2. Slot reservation atomic hai** — concurrent signups dono pass nahi kar sakte.

**3. Failure pe slot release ho jaata hai** aur adhoore docs delete ho jaate hain.

**4. ⚠️ `SUB_VENDOR` accounts abhi kisi route pe kaam nahi karte** — account banta hai par login karke kuch nahi kar sakta ([Appendix B](#appendix-b--known-issues)).

---

## 29. GET /subBrands/get-all

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | |
| `brandId` | ObjectId | ❌ | – | **Admin ke liye filter** — na do to sabke outlets |
| `userId` · `locationId` · `workHoursId` | ObjectId | ❌ | – | |
| `outletType` | string | ❌ | – | `OUTLET` \| `FRANCHISE` |
| `email` · `mobile` · `whatsappNumber` · `uniqueId` · `storeId` | string | ❌ | – | |
| `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | `joinedDate` \| `createdAt` \| `updatedAt` \| `outletType` \| `isActive` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

**Platform-wide outlet list (admin view):**
```http
GET /subBrands/get-all?limit=100&sortBy=joinedDate&sortOrder=desc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Outlets/Sub-Brands fetched successfully",
  "data": {
    "total": 128,
    "totalPages": 2,
    "page": 1,
    "limit": 100,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "userId": "68f1a2b3c4d5e6f7a8b9j001",
        "locationId": "68f1a2b3c4d5e6f7a8b9c4b1",
        "workHoursId": "68f1a2b3c4d5e6f7a8b9c4c1",
        "outletType": "OUTLET",
        "storeId": "MOCHA-VN-01",
        "uniqueId": "TDS000201",
        "whatsappNumber": "9823456789",
        "email": "vijaynagar@cafemocha.in",
        "joinedDate": "2026-08-22T14:30:00.000Z",
        "isActive": true
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any subbrand found` — **empty-state** |
| `422` | `Invalid Brand ID format` / `Limit cannot exceed 100` |

### ⚠️ Note
Bina `brandId` ke **platform-wide list** milti hai — admin ke liye ye useful hai. (Vendor ke liye ye ek leak hai — [Appendix B](#appendix-b--known-issues).)

---

## 30. PUT /subBrands/update/:subBrandId

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Path Params
| Param | Type | Required |
|---|---|---|
| `subBrandId` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `email` | string | Valid email |
| `outletType` | string | `OUTLET` \| `FRANCHISE` — ⚠️ pool switch |
| `joinedDate` | date | – |
| `description` | string | – |
| `isActive` | boolean | ⚠️ Sirf explicitly bhejne pe apply |

### Success — `200`
```json
{
  "success": true,
  "message": "Outlet/Sub-Brand updated successfully.",
  "data": {
    "subBrand": { "_id": "…", "outletType": "OUTLET", "isActive": true },
    "outletTypeChanged": false,
    "usage": { "subBrands": { "used": 3, "limit": 10 }, "franchises": { "used": 0, "limit": 2 } }
  }
}
```
> Type change pe message: `"Outlet/Sub-Brand updated and outlet type switched successfully."` aur `outletTypeChanged: true`

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Outlet/Sub-Brand not found!` / `Brand not found!` | |
| `403` | `Forbidden: You do not have permission to update this outlet.` | ⚠️ **Admin ke liye nahi aata** — admin koi bhi outlet edit kar sakta hai |
| `403` | `Access denied. This feature requires an active subscription. …` | Type change pe brand ka plan check |
| `403` | `Franchise limit reached — 2 of 2 used on your current plan. …` | Target pool full |

### ⚠️ Notes

**1. Admin ownership check se exempt hai** — service explicitly `actor.role !== ROLES.ADMIN` check karti hai.

**2. Type change pe brand ka subscription gate lagta hai** aur pools shift hote hain (purane se release, naye me reserve). Save fail pe dono revert.

**3. `isActive` ka silent default hataya gaya hai** — ab explicit bhejne pe hi apply hota hai.

---

# Location APIs

Global middleware: `router.use(verifyJwtToken)` — ⚠️ **koi role gate nahi**

## 31. POST /locations/create

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `addressLine1` · `city` · `state` | string | ✅ | – | |
| `zipcode` | string | ✅ | – | Country-wise regex |
| `coordinates` | number[] | ✅ | – | **`[longitude, latitude]`**, range-checked |
| `brandId` | ObjectId | ⚠️ | – | `isBrandAddress: true` pe required |
| `subBrandId` | ObjectId | ⚠️ | – | `isSubBrandAddress: true` pe required |
| `isBrandAddress` · `isSubBrandAddress` | boolean\|string | ❌ | `false` | Dono `true` → `400` |
| `addressLine2` · `landmark` · `district` | string | ❌ | – | |
| `country` | string | ❌ | `india` | 2–80 chars |
| `formattedAddress` | string | ❌ | auto | 1–500 chars |
| `addressType` | string | ❌ | `HOME` | `HOME` \| `WORK` \| `OTHER` |
| `isDefault` | boolean\|string | ❌ | `false` | |
| `userId` | ObjectId | ❌ | token ka user | Brand/outlet address pe ignore hota hai |

### Success — `200`
```json
{
  "success": true,
  "message": "Location created successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c4b1",
    "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
    "addressLine1": "Shop 4, Scheme 54",
    "city": "indore",
    "state": "madhya pradesh",
    "zipcode": "452010",
    "formattedAddress": "shop 4, scheme 54, vijay nagar, indore, madhya pradesh, 452010, india",
    "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] },
    "isSubBrandAddress": true,
    "isActive": true
  }
}
```

### Errors
| Status | Message |
|---|---|
| `400` | `Location cannot be both Brand address and SubBrand address` |
| `400` | `brandId is required for Brand address` / `subBrandId is required for SubBrand address` |
| `404` | `Brand not found` / `SubBrand not found` |
| `422` | `Address Line 1 is required` / `City is required` / `State is required` |
| `422` | `Zip Code/Postal Code is required` / `Invalid Zip Code/Postal Code` |
| `422` | `Coordinates must be [longitude, latitude].` / `Invalid longitude/latitude.` |

### ⚠️ Notes
**1. Coordinates `[longitude, latitude]`** — GeoJSON order, maps APIs se ulta.
**2. Auto-sync:** brand address → `brand.locationId`; outlet address → `subBrand.locationId` **aur** `subBrand.geo`.
**3. Outlet ka geo customer voucher listing ke liye critical hai** — bina location wale outlets ke vouchers customer ko dikhte hi nahi.

---

## 32. GET /locations/getAll

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` |
| `search` | string | ❌ | Address fields me match |
| `brandId` · `subBrandId` · `userId` · `customerId` | ObjectId | ❌ | Filters |
| `city` · `district` · `state` · `zipcode` · `country` | string | ❌ | Exact, lowercase |
| `addressType` | string | ❌ | `HOME` \| `WORK` \| `OTHER` |
| `isBrandAddress` · `isSubBrandAddress` · `isDefault` · `isActive` | boolean\|string | ❌ | |
| `fromDate` · `toDate` | ISO date | ❌ | |
| `sortBy` · `sortOrder` | string | ❌ | `createdAt` / `desc` |

**Sab brand addresses:**
```http
GET /locations/getAll?isBrandAddress=true&limit=100
```

### Success — `200`
```json
{
  "success": true,
  "message": "Locations fetched successfully",
  "data": { "total": 214, "totalPages": 3, "page": 1, "limit": 100, "data": [ ] }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any location found` — **empty-state** |
| `422` | `Invalid brandId format` |

### ⚠️ Note
⚠️ **Bina filter ke ye platform ke saare addresses deta hai — customers ke ghar ke pate bhi.** Admin ke liye by design theek hai, par ye endpoint **vendor aur customer ko bhi khula hai** ([Appendix B](#appendix-b--known-issues)).

---

## 33. GET /locations/get/:id

**Access:** Intended: All roles · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Location fetched successfully",
  "data": { "_id": "…", "addressLine1": "…", "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] } }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Location not found` |
| `422` | `Location ID is required` / `Invalid location ID format` |

### ⚠️ Note
Koi ownership check nahi — admin ke liye theek, par sabke liye khula hai.

---

## 34. PUT /locations/update/:id

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
`addressLine1` · `addressLine2` · `landmark` · `city` · `district` · `state` · `zipcode` (country-wise regex) · `country` (2–80) · `formattedAddress` (1–500) · `coordinates` (`[lng, lat]`) · `addressType` · `isBrandAddress` · `isSubBrandAddress` · `isDefault`

### Success — `200`
```json
{ "success": true, "message": "Location updated successfully", "data": { "_id": "…", "addressLine1": "Shop 4-A, Scheme 54" } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Location not found` |
| `422` | `Invalid Zip Code/Postal Code` / `Invalid longitude/latitude.` |

---

## 35. DELETE /locations/delete/:id

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

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

### ⚠️ Note
⚠️ Outlet ka address delete karne se us outlet ke vouchers customer listing se gayab ho jayenge (geo query fail hogi).

---

# Showcase APIs

Admin ke liye showcase me sirf 2 endpoints relevant hain — list aur reorder. Section/media CRUD vendor ka kaam hai (`validateBrandVendor` token se brand resolve karta hai, jo admin ke paas nahi hota).

## 36. GET /showcase/section/get-all

**Access:** Intended: Admin + Vendor · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | Title me, `""` allowed |
| `isActive` | boolean | ❌ | `true` | |
| `isVisible` | boolean | ❌ | `true` | |
| `sortBy` | string | ❌ | `sortOrder` | `title` \| `sortOrder` \| `createdAt` \| `updatedAt` |
| `order` | string | ❌ | `asc` | `asc` \| `desc` — **`order`, `sortOrder` nahi** |

### Success — `200`
```json
{
  "success": true,
  "message": "Sections fetched successfully.",
  "data": {
    "total": 47,
    "totalPages": 5,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
        "title": "ambience",
        "description": "Our cozy interiors",
        "coverImage": "https://res.cloudinary.com/…/amb-cover.jpg",
        "sectionType": "CUSTOM",
        "sortOrder": 1,
        "isActive": true,
        "mediaCount": 5,
        "photoCount": 4,
        "videoCount": 1,
        "createdAt": "2026-08-22T16:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any showcasesection found` — **empty-state** |
| `422` | `limit > 100`, invalid `sortBy`/`order` |

### ⚠️ Notes

**1. Ye platform-wide list hai** — admin ke liye by design theek. Service me brand filter commented out hai.

**2. ⚠️ `brandId` filter kaam nahi karta.** Na service usko read karta hai, na validator me defined hai (aur `stripUnknown` usko hata deta hai). **Brand-wise moderation abhi possible nahi.**

Response me `brandId` bhi project nahi hota, to client-side filter bhi nahi kar sakte — sirf `GET /brands/get?brandId=` se us brand ka showcase dekh sakte hain.

Ye security finding #4 hai ([Appendix B](#appendix-b--known-issues)).

---

## 37. PUT /showcase/section/:brandId/reorder

**Access:** Intended: Admin + Vendor · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `sections` | array | ✅ | Min 1 item |
| `sections[].id` | ObjectId | ✅ | |
| `sections[].sortOrder` | number | ✅ | Integer ≥ **1** |

```json
{
  "sections": [
    { "id": "68f1a2b3c4d5e6f7a8b9c5a2", "sortOrder": 1 },
    { "id": "68f1a2b3c4d5e6f7a8b9c5a1", "sortOrder": 2 }
  ]
}
```

### Success — `200`
```json
{ "success": true, "message": "Sections reordered successfully.", "data": { "modified": 2 } }
```

### Errors
| Status | Message |
|---|---|
| `400` | `Invalid section list.` |
| `404` | `Section not found.` |
| `422` | Invalid `brandId` / missing `sortOrder` |

### ⚠️ Notes
**1. `sortOrder` minimum `1` hai** (media reorder me `0` allowed hai).
**2. Poori list bhejein** — warna gaps ban sakte hain.
**3. ✅ Route pehle broken tha** (leading `/` missing) — ab fix ho chuka hai.

---

# Voucher APIs

Admin ke paas **voucher approval** ka exclusive power hai, plus vendor ka poora toolkit.

### Lifecycle — admin ka role

```
Vendor: DRAFT → submit-review → UNDER_REVIEW
                                     │
                          Admin: POST /vouchers/review/:versionId
                                     ├── APPROVED ──> publish ──> PUBLISHED
                                     └── REJECTED
```

## 38. POST /vouchers/review/:versionId

🔴 **Admin-exclusive.** Voucher approve ya reject.

**Access:** Intended: ADMIN · Enforced: **ADMIN**

### Path Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `versionId` | ObjectId | ✅ | ⚠️ **Version ka id**, voucher ka nahi |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `action` | string | ✅ | `APPROVED` \| `REJECTED` |
| `rejectionReason` | string | ⚠️ | **`REJECTED` pe required**, `APPROVED` pe **forbidden**. Max 1000 |

**Approve:**
```json
{ "action": "APPROVED" }
```

**Reject:**
```json
{
  "action": "REJECTED",
  "rejectionReason": "Offer terms are unclear — please specify whether the discount applies to beverages only."
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher approved successfully.",
  "data": {
    "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
    "versionId": "68f1a2b3c4d5e6f7a8b9c2b1",
    "versionNumber": 1,
    "versionCode": "TDV000451-V1",
    "status": "APPROVED",
    "reviewedBy": { "_id": "68f1a2b3c4d5e6f7a8b9c000", "name": "admin user" },
    "reviewedAt": "2026-08-22T20:30:00.000Z",
    "approvedAt": "2026-08-22T20:30:00.000Z"
  }
}
```

> Message action se banta hai — `"Voucher approved successfully."` / `"Voucher rejected successfully."`

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | `Admin authentication is required.` | `userId` context missing |
| `400` | `Invalid voucher version ID.` | Format |
| `400` | `Invalid review action. Allowed actions are APPROVED or REJECTED.` | Galat action |
| `400` | `Rejection reason is required when rejecting a voucher.` | |
| `400` | `Rejection reason cannot exceed 1000 characters.` | |
| `404` | `Voucher version not found.` | |
| `404` | `Voucher not found.` | |
| `409` | `This voucher version is no longer the current version.` | Beech me naya version bana |
| `400` | `Published voucher version cannot be reviewed.` | Already published |
| `400` | `Voucher cannot be reviewed from <STATUS> status.` | Voucher-level status block |
| `400` | `Voucher version cannot be reviewed from <STATUS> status.` | Version-level block |
| `400` | `Voucher version submission information is missing.` | Submit hua hi nahi |
| `422` | `Action must be either APPROVED or REJECTED.` | Joi level |
| `422` | `Rejection reason is only allowed when rejecting a voucher.` | `APPROVED` ke saath bheja |

### ⚠️ Edge cases & notes

**1. `versionId` chahiye, `voucherId` nahi.** Queue se lein:
```http
GET /vouchers/versions/get-all?status=UNDER_REVIEW&sortBy=NEWEST
```

**2. Voucher **aur** version dono ka status `UNDER_REVIEW` hona chahiye** — dono alag se check hote hain, alag error messages ke saath.

**3. Validator strict hai** — `APPROVED` ke saath `rejectionReason` bhejne pe `422`. Form me action-wise fields dikhayein.

**4. Approve karne se voucher live nahi hota** — uske baad `POST /vouchers/publish/:versionId` (#42) chahiye. Wo vendor ya admin dono kar sakte hain.

**5. `rejectionReason` vendor ko dikhta hai** — actionable likhein.

**6. `VoucherApprovalHistory` entry banti hai** har review pe.

**7. Transactional hai** — session ke andar chalta hai.

---

## 39–45. Vendor Toolkit (admin bhi use kar sakta hai)

Ye 7 endpoints vendor ke liye banaye gaye hain, par admin bhi chala sakta hai — **`resolveActorBrand` admin ko koi bhi brand chunne deta hai** (aur `brandId` mandatory kar deta hai).

| # | Method | Endpoint | Admin ke liye khaas |
|---|---|---|---|
| 39 | POST | `/vouchers/create` | `brandId` body me — koi bhi brand |
| 40 | PUT | `/vouchers/update/:voucherId` | Voucher se brand resolve, admin ko allowed |
| 41 | POST | `/vouchers/submit-review/:voucherId` | ⚠️ Admin apna hi voucher submit karke khud approve kar sakta hai |
| 42 | POST | `/vouchers/publish/:versionId` | Approved version live karna |
| 43 | GET | `/vouchers/versions/get-all` | **Approval queue** — `?status=UNDER_REVIEW` |
| 44 | POST | `/vouchers/:voucherId/banner` | Featured/promoted vouchers ke liye |
| 45 | DELETE | `/vouchers/:voucherId/banner` | |

**Access (39, 40, 41, 42, 44, 45):** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN** (39/40/44/45 pe **+ ownership**)
**Access (43):** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### 43. GET /vouchers/versions/get-all — approval queue

Admin ke liye ye sabse important hai.

#### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | |
| `search` | string | ❌ | – | Name/description/tags text match |
| `status` | string | ❌ | – | **`UNDER_REVIEW` = approval queue** |
| `brandId` · `voucherId` · `categoryId` · `subCategoryId` | ObjectId | ❌ | – | Filters |
| `createdBy` · `submittedBy` · `reviewedBy` · `approvedBy` · `rejectedBy` | ObjectId | ❌ | – | **Admin audit filters** |
| `versionNumber` | number | ❌ | – | |
| `versionCode` | string | ❌ | – | |
| `isImmutable` · `isActive` | boolean | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `NEWEST` | `DISTANCE` \| `NEWEST` \| `EXPIRING_SOON` \| `RELEVANCE` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Approval queue:**
```http
GET /vouchers/versions/get-all?status=UNDER_REVIEW&sortBy=NEWEST&limit=50
```

**Ek admin ne kya approve kiya:**
```http
GET /vouchers/versions/get-all?approvedBy=68f1a2b3c4d5e6f7a8b9c000&fromDate=2026-08-01
```

#### Success — `200`
```json
{
  "success": true,
  "message": "Voucher versions fetched successfully",
  "data": {
    "total": 7,
    "totalPages": 1,
    "page": 1,
    "limit": 50,
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
        "status": "UNDER_REVIEW",
        "startAt": "2026-09-01T00:00:00.000Z",
        "endAt": "2026-10-01T23:59:59.000Z",
        "isImmutable": false,
        "submittedBy": { "_id": "…", "name": "rahul sharma" },
        "submittedAt": "2026-08-22T17:30:00.000Z",
        "createdAt": "2026-08-22T17:00:00.000Z"
      }
    ]
  }
}
```

#### Errors
| Status | Message |
|---|---|
| `404` | `No any voucherversion found` — **empty-state (queue khali)** |
| `422` | `Invalid Voucher Id` / `Invalid Brand Id` |
| `422` | Invalid `status`/`sortBy` |

#### ⚠️ Notes
**1. Ye **versions** deta hai, vouchers nahi** — ek voucher ke multiple versions honge.
**2. `sortBy=RELEVANCE` bina `search` ke silently `NEWEST` ban jaata hai.**
**3. Review (#38) aur publish (#42) ke liye `versionId` yahin se milta hai.**

### 39–42, 44–45 — quick reference

Poori request/response detail vendor doc me hai (identical behaviour); admin ke liye sirf `brandId` ka rule alag hai.

| Endpoint | Key body/params | Admin note |
|---|---|---|
| `POST /vouchers/create` | `brandId` ✅, `name`, `startAt`, `endAt`, `offers[]`, `subBrandIds[]`, `images` (multipart) | ⚠️ Brand ka subscription gate lagta hai — bina plan ke voucher nahi banega |
| `PUT /vouchers/update/:voucherId` | Delta-based: `newOffers`/`removedOfferIds`/`newTags`/`removedTags`/`newImages` | Status-wise editability lagti hai |
| `POST /vouchers/submit-review/:voucherId` | — | ⚠️ Self-approval possible — audit trail me dono actions dikhenge |
| `POST /vouchers/publish/:versionId` | — | Sirf `APPROVED` version; publish pe `isImmutable: true` |
| `POST /vouchers/:voucherId/banner` | `bannerType` + matching file (`bannerImage`/`bannerVideo`/`bannerGif`) | Approval flow ko touch nahi karta |
| `DELETE /vouchers/:voucherId/banner` | — | Idempotent |

**Common errors (39–45):**
| Status | Message |
|---|---|
| `403` | `Access denied. This feature requires an active subscription. …` *(create)* |
| `403` | `Voucher limit reached — 20 of 20 used on your current plan. …` *(create)* |
| `409` | `Voucher with this name already exists for this brand.` |
| `409` | `Voucher is under review and cannot be edited.` *(update)* |
| `400` | `Only an approved voucher version can be published. Current status: DRAFT.` *(publish)* |
| `400` | `Cannot publish an expired voucher version.` *(publish)* |
| `422` | `brandId is required when acting as an admin` |

> 📖 Full field tables, offer schema, aur saare edge cases → [vendor_panel_api_doc.md](./vendor_panel_api_doc.md) endpoints #54–#60

---

# Banner APIs

App-level home banners — **brand se linked nahi**, poore customer app pe dikhte hain.

⚠️ Global middleware: `router.use(verifyJwtToken)` — **koi `isAdmin` gate nahi** ([Appendix B](#appendix-b--known-issues))

## 46. POST /banners/create

**Multipart** — type ke hisaab se file field.

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Body (multipart)
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `title` | string | ✅ | – | 2–150 chars |
| `type` | string | ✅ | – | `IMAGE` \| `VIDEO` \| `GIF` |
| *(file)* | file | ✅ | – | **`type` ke hisaab se field name** — niche table |
| `description` | string | ❌ | – | Max 1000, `""` allowed |
| `redirect` | object | ❌ | – | JSON string bhi chalta hai |
| `startDate` | ISO date | ❌ | `null` | |
| `endDate` | ISO date | ❌ | `null` | **`startDate` se baad** |
| `isActive` | boolean | ❌ | `true` | |

**File field naam:**
| `type` | File field | Allowed MIME |
|---|---|---|
| `IMAGE` | `image` | jpeg, jpg, png, webp |
| `VIDEO` | `video` | mp4, webm, quicktime |
| `GIF` | `gif` | gif |

**`redirect` object:**
| Field | Type | Required | Validation |
|---|---|---|---|
| `type` | string | ❌ (default `NONE`) | `NONE` \| `CATEGORY` \| `DEAL` \| `BRAND` \| `OFFER` \| `EXTERNAL_URL` |
| `targetId` | ObjectId | ⚠️ | **`CATEGORY`/`DEAL`/`BRAND`/`OFFER` pe required** |
| `url` | string | ⚠️ | **`EXTERNAL_URL` pe required**, valid URI |

```
title:       Monsoon Mega Sale
description: Up to 50% off at partner outlets
type:        IMAGE
image:       <file>
redirect:    {"type":"CATEGORY","targetId":"68f1a2b3c4d5e6f7a8b9c0e1"}
startDate:   2026-09-01T00:00:00.000Z
endDate:     2026-09-30T23:59:59.000Z
isActive:    true
```

### Success — `200`
```json
{
  "success": true,
  "message": "Banner created successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c1a1",
    "title": "monsoon mega sale",
    "description": "Up to 50% off at partner outlets",
    "type": "IMAGE",
    "redirect": { "type": "CATEGORY", "targetId": "68f1a2b3c4d5e6f7a8b9c0e1", "url": null },
    "startDate": "2026-09-01T00:00:00.000Z",
    "endDate": "2026-09-30T23:59:59.000Z",
    "image": {
      "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/banners/monsoon.jpg",
      "storage": { "provider": "CLOUDINARY", "publicId": "banners/monsoon" }
    },
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "createdAt": "2026-08-22T21:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `409` | `An active banner without a date range already exists.` | ⚠️ Evergreen banner already hai |
| `409` | `Already active banner in this date range.` | ⚠️ Date overlap |
| `422` | `Please upload a image file for this banner type.` | File field naam galat/missing |
| `422` | `Title is required.` | |
| `422` | `Banner type is required.` / `Type must be one of: IMAGE, VIDEO, GIF.` | |
| `422` | `Target ID is required for this redirect type.` | |
| `422` | `URL is required for EXTERNAL_URL redirect type.` | |
| `422` | `End date must be after start date.` | |
| `422` | `Redirect must be valid JSON.` | Malformed JSON string |
| `422` | `Redirect: <sub-errors>` | Redirect object ke andar ka error |

### ⚠️ Edge cases & notes

**1. ⚠️ Overlap check hai — ek waqt me ek hi active banner.** Do rules:
- **Evergreen** (`startDate`/`endDate` dono `null`): sirf **ek** ho sakta hai active
- **Dated**: overlapping date range me doosra active nahi ban sakta

Naya banner banane se pehle purane ko `isActive: false` karein ya date range adjust karein.

**2. Customer ko sirf ek banner dikhta hai** (`GET /banners/customer/active`) — pehle date-range wala, warna evergreen fallback, warna `null`.

**3. File field ka naam `type` se match karna chahiye** — `type: "VIDEO"` ke saath `image` field bhejoge to `422`.

**4. Create fail hone pe uploaded media delete ho jaata hai** (rollback).

**5. `redirect` JSON string ho sakta hai** — multipart me object bhejna mushkil hai, validator parse kar leta hai.

**6. Legacy lowercase types handle hote hain** — model me setter hai jo `"image"` ko `"IMAGE"` bana deta hai.

---

## 47. PUT /banners/update/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional, **kam se kam ek field**
| Field | Type | Validation |
|---|---|---|
| `title` | string | 2–150 chars |
| `description` | string | Max 1000, `""` allowed |
| `type` | string | `IMAGE` \| `VIDEO` \| `GIF` — ⚠️ badalne pe nayi file chahiye |
| `redirect` | object | Create jaisa |
| `startDate` · `endDate` | ISO date | `null` allowed |
| `isActive` | boolean | |
| *(file)* | file | `type` ke hisaab se field name |

```json
{ "isActive": false }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Banner updated successfully.",
  "data": { "_id": "68f1a2b3c4d5e6f7a8b9c1a1", "title": "monsoon mega sale", "isActive": false }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Banner not found.` | |
| `409` | `An active banner without a date range already exists.` | Activate karne pe overlap |
| `409` | `Already active banner in this date range.` | |
| `422` | `Please upload a <field> file for this banner type.` | Type badla par file nahi |
| `422` | `End date must be after start date.` | |
| `422` | *(min-1 message)* | Body khali |

### ⚠️ Notes

**1. `isActive: false` sabse aasan tareeka hai banner hatane ka** — delete karne ki zarurat nahi, aur overlap bhi free ho jaata hai.

**2. `type` badalne pe nayi file mandatory hai** — purana media field khali ho jaayega.

**3. Media replace hone pe purana Cloudinary se delete hota hai.**

---

## 48. GET /banners/get-all

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | `title` + `description`, `""` allowed |
| `type` | string | ❌ | – | `IMAGE` \| `VIDEO` \| `GIF` |
| `isActive` | boolean | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | `createdAt` filter |
| `sortBy` | string | ❌ | `createdAt` | `createdAt` \| `startDate` \| `endDate` \| `title` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /banners/get-all?isActive=true&sortBy=startDate&sortOrder=desc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Banners fetched successfully.",
  "data": {
    "total": 8,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c1a1",
        "title": "monsoon mega sale",
        "type": "IMAGE",
        "redirect": { "type": "CATEGORY", "targetId": "…", "url": null },
        "startDate": "2026-09-01T00:00:00.000Z",
        "endDate": "2026-09-30T23:59:59.000Z",
        "image": { "url": "https://res.cloudinary.com/…/monsoon.jpg" },
        "isActive": true,
        "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
        "createdAt": "2026-08-22T21:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any banner found` — **empty-state** |
| `422` | `limit > 100`, invalid `type`/`sortBy` |

### ⚠️ Note
`sortBy=startDate` scheduling calendar ke liye useful hai — kaunsa banner kab live hoga.

---

## 49. GET /banners/get/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Banner fetched successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c1a1",
    "title": "monsoon mega sale",
    "description": "Up to 50% off at partner outlets",
    "type": "IMAGE",
    "redirect": { "type": "CATEGORY", "targetId": "…", "url": null },
    "image": { "url": "…", "storage": { "provider": "CLOUDINARY", "publicId": "banners/monsoon" } },
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "updatedBy": null
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Banner not found.` |
| `422` | `Banner ID is required.` / `Invalid banner ID.` |

---

## 50. DELETE /banners/delete/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Banner deleted successfully.", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Banner not found.` |
| `422` | `Invalid banner ID.` |

### ⚠️ Note
Soft delete hai. **Zyada tar cases me `isActive: false` (#47) behtar hai** — banner history rehti hai aur wapas la sakte hain.

---

# Promotional Ticker APIs

Home screen ka scrolling ticker strip. Banner se different — **multiple tickers ek saath dikhte hain**, `displayOrder` se sorted.

⚠️ Global middleware: `router.use(verifyJwtToken)` — **koi `isAdmin` gate nahi**

## 51. POST /promotionalTickers/create

**Multipart** — `icon` mandatory.

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Body (multipart)
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `title` | string | ✅ | – | 2–**100** chars (banner se chhota) |
| `icon` | file | ✅ | – | **Field name `icon`**. jpeg/jpg/png/webp |
| `redirect` | object | ❌ | – | Banner jaisa — JSON string bhi chalega |
| `displayOrder` | number | ❌ | `0` | Integer ≥ 0 |
| `startDate` · `endDate` | ISO date | ❌ | `null` | `endDate` > `startDate` |
| `isActive` | boolean | ❌ | `true` | |

```
title:        Flat 30% off on cafes today
icon:         <file>
redirect:     {"type":"CATEGORY","targetId":"68f1a2b3c4d5e6f7a8b9c0e1"}
displayOrder: 1
startDate:    2026-09-01T00:00:00.000Z
endDate:      2026-09-30T23:59:59.000Z
```

### Success — `200`
```json
{
  "success": true,
  "message": "Promotional ticker created successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c1b1",
    "title": "flat 30% off on cafes today",
    "icon": {
      "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/tickers/coffee.png",
      "storage": { "provider": "CLOUDINARY", "publicId": "tickers/coffee" }
    },
    "redirect": { "type": "CATEGORY", "targetId": "…", "url": null },
    "displayOrder": 1,
    "startDate": "2026-09-01T00:00:00.000Z",
    "endDate": "2026-09-30T23:59:59.000Z",
    "isActive": true,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "createdAt": "2026-08-22T21:15:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Title is required.` | |
| `422` | *(title length)* | 2–100 chars ke bahar |
| `400`/`422` | *(icon missing/invalid)* | Field naam `icon` hona chahiye |
| `422` | `End date must be after start date.` | |
| `422` | `Target ID is required for this redirect type.` | |
| `422` | `URL is required for EXTERNAL_URL redirect type.` | |
| `422` | `Redirect must be valid JSON.` | |

### ⚠️ Notes

**1. ⚠️ Banner ki tarah overlap check **nahi** hai** — jitne chaho active tickers rakh sakte hain. Ye by design hai, ticker strip me multiple chalte hain.

**2. `displayOrder` se customer ko order milta hai** (ascending). Duplicate values allowed hain par order unpredictable ho jaayega — unique rakhein.

**3. ⚠️ Date gap:** customer endpoint sirf do cases match karta hai — **dono dates set** (aur `now` unke beech me), **ya dono `null`**. Sirf `startDate` ya sirf `endDate` set karoge to wo ticker **kabhi nahi dikhega**. Ya dono do, ya koi nahi.

**4. `title` max 100 hai** — single line me fit hona chahiye.

**5. Create fail pe icon delete ho jaata hai** (rollback).

---

## 52. PUT /promotionalTickers/update/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional, **kam se kam ek field**
| Field | Type | Validation |
|---|---|---|
| `title` | string | 2–100 chars |
| `redirect` | object | Create jaisa |
| `displayOrder` | number | Integer ≥ 0 |
| `startDate` · `endDate` | ISO date | `null` allowed |
| `isActive` | boolean | |
| `icon` | file | Multipart — replace ke liye |

```json
{ "displayOrder": 3, "isActive": true }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Promotional ticker updated successfully.",
  "data": { "_id": "…", "title": "flat 30% off on cafes today", "displayOrder": 3, "isActive": true }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Ticker not found.` |
| `422` | `Ticker ID is required.` / `Invalid ticker ID.` |
| `422` | `End date must be after start date.` |
| `422` | *(min-1 message)* — body khali |

### ⚠️ Note
Reorder ke liye har ticker pe `displayOrder` alag se update karna padta hai — bulk reorder endpoint nahi hai.

---

## 53. GET /promotionalTickers/get-all

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | `title` me |
| `isActive` | boolean | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | `createdAt` \| `displayOrder` \| `title` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /promotionalTickers/get-all?isActive=true&sortBy=displayOrder&sortOrder=asc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Promotional tickers fetched successfully.",
  "data": {
    "total": 4,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c1b1",
        "title": "flat 30% off on cafes today",
        "icon": { "url": "https://res.cloudinary.com/…/coffee.png" },
        "redirect": { "type": "CATEGORY", "targetId": "…", "url": null },
        "displayOrder": 1,
        "startDate": "2026-09-01T00:00:00.000Z",
        "endDate": "2026-09-30T23:59:59.000Z",
        "isActive": true,
        "createdAt": "2026-08-22T21:15:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any promotionalticker found` — **empty-state** |
| `422` | Invalid `sortBy`/`sortOrder` |

### ⚠️ Note
`sortBy=displayOrder&sortOrder=asc` bhejein — usi order me customer ko dikhta hai, to admin panel bhi wahi order dikhaye.

---

## 54. GET /promotionalTickers/get/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Promotional ticker fetched successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c1b1",
    "title": "flat 30% off on cafes today",
    "icon": { "url": "…", "storage": { "provider": "CLOUDINARY", "publicId": "tickers/coffee" } },
    "displayOrder": 1,
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Ticker not found.` |
| `422` | `Invalid ticker ID.` |

---

## 55. DELETE /promotionalTickers/delete/:id

**Access:** Intended: ADMIN · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Promotional ticker deleted successfully.", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Ticker not found.` |
| `422` | `Invalid ticker ID.` |

### ⚠️ Note
Soft delete. `isActive: false` (#52) usually behtar hai.

---

# Brand Feature APIs

Brand ke USP points. Admin kisi bhi brand ke liye manage kar sakta hai.

⚠️ Global middleware: `router.use(verifyJwtToken)` — **koi role gate nahi**

## 56. POST /brandFeatures/add

**Multipart** — `icon` mandatory.

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Body (multipart)
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | Body me — **admin koi bhi brand** |
| `title` | string | ✅ | – | 2–150 chars |
| `icon` | file | ✅ | – | Field name `icon` |
| `description` | string | ❌ | – | Max 500, `""` allowed |
| `isActive` | boolean\|string | ❌ | `true` | |

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
    "icon": "https://res.cloudinary.com/…/wifi.png",
    "isActive": true,
    "createdAt": "2026-08-22T21:30:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | |
| `400` | `A brand can have maximum 10 active features!` | 10 active limit |
| `400` | `Feature icon is required!` | |
| `500` | `Failed to upload feature icon!` | Cloudinary |
| `422` | `Brand ID is required` / `Invalid Brand ID format` | |
| `422` | `Feature title must be at least 2 characters` / `cannot exceed 150 characters` | |
| `422` | `Feature description cannot exceed 500 characters` | |

### ⚠️ Notes
**1. Limit sirf active features pe hai** — inactive count nahi hote.
**2. Plan se metered nahi hai** — koi subscription gate nahi.
**3. `title` lowercase me store nahi hota** (baaki modules se different).

---

## 57. GET /brandFeatures/get-all

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | **Mandatory** — platform-wide list possible nahi |
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | `title` + `description` |
| `title` | string | ❌ | – | |
| `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | `title` \| `createdAt` \| `updatedAt` \| `isActive` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

### Success — `200`
```json
{
  "success": true,
  "message": "Brand features fetched successfully",
  "data": {
    "total": 4,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "title": "Free WiFi",
        "description": "High speed internet for all guests",
        "icon": "https://res.cloudinary.com/…/wifi.png",
        "isActive": true,
        "createdAt": "2026-08-22T21:30:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | brandId galat — **real error** |
| `404` | `No any brandfeature found` | Features nahi — **empty-state** |
| `422` | `Brand ID is required` | ⚠️ Admin ko bhi dena mandatory hai |

### ⚠️ Note
**Do alag 404 messages** — `"Brand not found!"` real error hai, `"No any brandfeature found"` empty-state.

---

## 58. GET /brandFeatures/get/:featureId

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
  "data": { "_id": "…", "brandId": "…", "title": "Free WiFi", "icon": "…", "isActive": true, "isDeleted": false }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand feature not found!` |
| `422` | `Feature ID is required` / `Invalid Feature ID format` |

---

## 59. PUT /brandFeatures/update/:featureId

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

### Path Params
| Param | Type | Required |
|---|---|---|
| `featureId` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `title` | string | 2–150 chars |
| `description` | string | Max 500, `""` allowed |
| `isActive` | boolean\|string | |
| `icon` | file | Multipart |

### Success — `200`
```json
{ "success": true, "message": "Brand feature updated successfully", "data": { "_id": "…", "isActive": true } }
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand feature not found!` | |
| `400` | `A brand can have maximum 10 active features!` | Inactive → active pe limit cross |
| `422` | `Feature title must be at least 2 characters` | |

---

## 60. DELETE /brandFeatures/delete/:featureId

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated** ⚠️

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
| `422` | `Invalid Feature ID format` |

---

# Category APIs

Master data — customer home screen ka category grid aur vendor onboarding ka dropdown isi se banta hai.

**Writes `isAdmin` se gated hain ✅**, reads sab roles ke liye khule hain.

## 61. POST /categories/create

**Multipart** (image optional).

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body (multipart ya JSON)
| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | ✅ | 3–120 chars |
| `description` | string | ❌ | Max 300, `""` allowed |
| `isActive` | boolean | ❌ | |
| `image` | file | ❌ | **Multipart**, field name `image` |

```
name:        Food & Beverages
description: Restaurants, cafes, and food outlets
image:       <file>
isActive:    true
```

### Success — `201`
```json
{
  "success": true,
  "message": "Category created",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0e1",
    "name": "food & beverages",
    "description": "Restaurants, cafes, and food outlets",
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/food.jpg",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T22:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Category already exist with this name` | Duplicate (case-insensitive) |
| `422` | `Name has minimum 3 characters` / `Name cannot exceed 120 characters` | |
| `422` | `Description cannot exceed 300 characters` | |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role ADMIN nahi |

### ⚠️ Notes

**1. `name` lowercase me store hota hai** — display pe capitalize karein.

**2. `image` optional hai** — na do to `DEFAULT_IMAGES.CATEGORY` placeholder use hota hai.

**3. `201` deta hai** (baaki create endpoints se consistent).

**4. Duplicate check `name` pe hai** — same naam ki doosri category nahi ban sakti.

---

## 62. GET /categories/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | Koi max nahi |
| `search` | string | ❌ | – | `name` + `description` |
| `name` | string | ❌ | – | Sirf `name` |
| `isActive` | boolean\|string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | `createdAt` | ⚠️ Validate nahi hota |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

### Success — `200`
```json
{
  "success": true,
  "message": "Categories fetched",
  "data": {
    "total": 12,
    "totalPages": 2,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c0e1",
        "name": "food & beverages",
        "description": "Restaurants, cafes, and food outlets",
        "image": "https://res.cloudinary.com/…/food.jpg",
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

### `stats` — kya ginta hai

| Key | Source | Kya count hota hai |
|---|---|---|
| `subCategories` | `SubCategory.categoryId` | Is category ki sub-categories |
| `brands` | `Brand.categoryId` | Is category me registered brands |
| `vouchers` | `VoucherVersion.categoryId` **current version ka** | Niche note dekhein |
| `promoCodes` | `PromoCode.categoryIds[]` | Jo customer promo codes is category pe scoped hain |

- `total` = jo **exist** karta hai (`isDeleted: false`), chahe active ho ya na ho.
- `active` = usi ka wo hissa jiska `isActive: true` hai. Panel "41 / 48 active" dikha sakta hai.
- **Store nahi hota, har read pe count hota hai** — isliye kuch delete hote hi agli call me number apne aap kam ho jaata hai. Koi counter drift nahi kar sakta.
- Counts **page ke rows** ke liye nikalte hain, poore filter ke liye nahi — `limit` bada karne se hi kaam badhta hai.

### ⚠️ `vouchers` current version pe ginta hai

Category master `Voucher` par nahi, `VoucherVersion` par hai, aur voucher apni saari purani versions rakhta hai. Isliye count wahi vouchers leta hai jinki **`currentVersionId`** wali version is category me hai:

- versions ginne se ek voucher kai baar ginta,
- "kabhi bhi is category me thi" ginne se vendor ke category badalne ke baad voucher **dono** categories me ginta rehta — saari categories ka jod actual voucher count se zyada nikalta.

Draft aur unpublished vouchers bhi ginte hain (wo exist karte hain). `active` master `Voucher.isActive` se aata hai.

### Errors
| Status | Message |
|---|---|
| `404` | `No any category found` — **empty-state** |
| `422` | *(Joi message)* |

### ⚠️ Note
Admin panel me `isActive` filter **na** lagayein — inactive categories bhi manage karni hoti hain.

---

## 63. GET /categories/get/:id

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
    "description": "Restaurants, cafes, and food outlets",
    "image": "https://res.cloudinary.com/…/food.jpg",
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
> `getAll` ke mukable **poora document**. `stats` bilkul wahi shape hai — [#62](#62-get-categoriesgetall) me detail hai.

### Errors
| Status | Message |
|---|---|
| `404` | `Category not found` |
| `422` | `Invalid Category Id` |

---

## 64. PUT /categories/update/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `name` | string | 3–120 chars |
| `description` | string | Max 300, `""` allowed |
| `isActive` | boolean | |
| `image` | file | Multipart |

### Success — `200`
```json
{
  "success": true,
  "message": "Category updated",
  "data": { "_id": "…", "name": "food & beverages", "isActive": true, "updatedAt": "2026-08-22T22:10:00.000Z" }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Category not found` | |
| `400` | `Category already exist with this name` | Naya naam duplicate |
| `422` | `Name has minimum 3 characters` | |
| `403` | `Forbidden: …` | Role check |

### ⚠️ Note
Image replace hone pe purana Cloudinary se delete hota hai.

---

## 65. DELETE /categories/delete/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Category deleted", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Category not found` |
| `422` | `Invalid Category Id` |
| `400` | `Cannot delete this category — 2 sub-categories, 3 brands and 10 vouchers still use it. Move or delete them first.` |

### ⚠️ Notes

**1. Soft delete hai.**

**2. In-use category delete nahi hoti.** Agar koi sub-category, brand ya voucher abhi bhi is category pe hai to `400` aata hai aur message me **exact ginti** hoti hai — admin ko teen listings me ja kar dhoondhna nahi padta. Pehle ye delete chup-chaap ho jata tha aur children dangling `categoryId` ke saath reh jaate the.

Blockers wahi hain jo category ke **andar** hote hain: sub-categories, brands, vouchers. Ginti `stats` waali hi hai (`total`, yani `isDeleted: false` — inactive brand bhi rokega, kyunki wo kal on ho sakta hai).

**Promo codes nahi rokte.** `PromoCode.categoryIds` ownership nahi, sirf scoping filter hai — pichhle season ke ek expired code ki wajah se category delete na ho paana admin ko phasaa dega, aur nuksaan halka hai: deleted id kisi voucher se match nahi karegi, code baaki categories pe scoped reh jayega.

Delete se pehle kya rok raha hai dekhna ho to `GET /categories/get/:id` ka `stats` hi kaafi hai.

**3. `isActive: false` (#64) usually behtar hai** — reference bache rehte hain aur naye brands ko option nahi dikhta.

---

# Sub Category APIs

## 66. POST /subCategories/:categoryId/create

**Multipart** (image optional). Note: `categoryId` **path me** hai, body me nahi.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `categoryId` | ObjectId | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | ✅ | 3–120 chars |
| `description` | string | ❌ | Max 300, `""` allowed |
| `isActive` | boolean | ❌ | |
| `image` | file | ❌ | Multipart |

```
POST /subCategories/68f1a2b3c4d5e6f7a8b9c0e1/create

name:        Cafe
description: Coffee shops and cafes
image:       <file>
```

### Success — `201`
```json
{
  "success": true,
  "message": "Sub-category created",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0f1",
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "name": "cafe",
    "description": "Coffee shops and cafes",
    "image": "https://res.cloudinary.com/…/cafe.jpg",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T22:20:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Invalid category Id` | Path param format |
| `404` | `Category not found` | Parent category nahi |
| `400` | *(duplicate)* | Same category me wahi naam |
| `422` | `Name has minimum 3 characters` / `cannot exceed 120 characters` | |
| `422` | `Description cannot exceed 300 characters` | |

### ⚠️ Note
`categoryId` **path me hai** — baaki create endpoints se different pattern.

---

## 67. GET /subCategories/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
Same as [#62](#62-get-categoriesgetall), plus:

| Param | Type | Required | Notes |
|---|---|---|---|
| `categoryId` | ObjectId | ❌ | ⚠️ Invalid ObjectId pe **500** (validate nahi hota) |

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
        "description": "Coffee shops and cafes",
        "image": "https://res.cloudinary.com/…/cafe.jpg",
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
> Categories ke `getAll` se different — yahan `isDeleted` aur `updatedAt` bhi project hote hain.

### `stats` — kya ginta hai

| Key | Source |
|---|---|
| `brands` | `Brand.subCategoryId` |
| `vouchers` | `VoucherVersion.subCategoryId`, **current version ka** — [#62](#62-get-categoriesgetall) waali hi rule |

`total` / `active` ka matlab, aur counts stored kyun nahi hain, [#62](#62-get-categoriesgetall) me hai.

⚠️ **`promoCodes` yahan hai hi nahi.** `PromoCode` sirf `categoryIds` rakhta hai, sub-category ka koi field usme nahi — hamesha-`0` wali key "abhi koi nahi hai" padhi jaati, jabki sach ye hai ki ye link exist hi nahi karta.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subcategory found` | **Empty-state** |
| `500` | *(cast error)* | ⚠️ `categoryId` invalid ObjectId format — validate nahi hota |

---

## 68. GET /subCategories/get/:id

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
    "_id": "…",
    "categoryId": "…",
    "name": "cafe",
    "image": "…",
    "isActive": true,
    "isDeleted": false,
    "stats": {
      "brands":   { "total": 12, "active": 10 },
      "vouchers": { "total": 34, "active": 28 }
    }
  }
}
```
> `stats` [#67](#67-get-subcategoriesgetall) waala hi hai.

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `422` | `Invalid SubCategory Id` |

---

## 69. PUT /subCategories/update/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
`name` (3–120) · `description` (max 300) · `categoryId` (ObjectId) · `isActive` · `image` (multipart)

### Success — `200`
```json
{ "success": true, "message": "Sub-category updated", "data": { "_id": "…", "name": "cafe" } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `404` | `Category not found!` — naya `categoryId` exist nahi karta |
| `400` | *(duplicate name)* |
| `422` | `Name has minimum 3 characters` / `Invalid categoryId format` |

### ⚠️ Note
`categoryId` bhejkar sub-category ko **dusri category me move** kiya ja sakta hai — `validateUpdateSubCategory` me ye field hai aur service `subcategory.categoryId` set karti hai. (Is doc me pehle likha tha ki ye possible nahi — wo galat tha.) Yahi wo raasta hai jo `DELETE /categories/delete/:id` ka *"Move or delete them first"* wala `400` sujhaata hai.

---

## 70. DELETE /subCategories/delete/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Sub-category deleted", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `422` | `Invalid SubCategory Id` |
| `400` | `Cannot delete this sub-category — 3 brands and 10 vouchers still use it. Move or delete them first.` |

### ⚠️ Note
**In-use sub-category delete nahi hoti.** Brands (`Brand.subCategoryId`) ya vouchers (`VoucherVersion.subCategoryId`) abhi bhi ispe hain to `400` aata hai, exact ginti ke saath. Pehle ye delete ho jaata tha aur wo reference dangling reh jaate the.

Ginti `stats.brands.total` / `stats.vouchers.total` hi hai — `isDeleted: false`, yani inactive brand bhi rokega.

Brand ko hataane ke liye uski `subCategoryId` badlein (`PUT /brands/update`), voucher ke liye nayi version me sub-category badlein. `isActive: false` (#69) tab bhi ek valid option hai jab aap sirf naye brands ko ye option nahi dikhana chahte.

---

# Subscription Plan APIs

Plan catalog. **Entitlements yahin define hote hain** — jo baad me enforce hote hain.

## 71. POST /subscriptions/create

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `name` | string | ✅ | 3–120 chars |
| `price` | number | ✅ | ≥ 0 |
| `type` | string | ✅ | `WEEKLY` \| `MONTHLY` \| `QUATERLY` \| `HALF_YEARLY` \| `YEARLY` |
| `description` | string | ❌ | Max 500, `""` allowed |
| `durationInDays` | number | ❌ | Na do to `type` se derive hota hai |
| `durationInYears` | number | ❌ | ≥ 0 |
| `entitlements` | object | ❌ | ⚠️ **Ye enforce hote hain** — niche detail |
| `features` | array | ❌ | Display-only: `[{ title, value, available }]` |
| `benefits` | string[] | ❌ | |
| `limitations` | string[] | ❌ | |
| `discountType` | string | ❌ | `PERCENT` \| `FLAT` |
| `discountPercent` | number | ❌ | 0–100 |
| `discountAmount` | number | ❌ | ≥ 0 |
| `strikePrice` | number | ❌ | ≥ 0 — **cosmetic only** |
| `isActive` | boolean | ❌ | |

### `entitlements` object — **ye actually enforce hote hain**

| Key | Shape | Kya gate karta hai |
|---|---|---|
| `subBrands` | `{ limit, isUnlimited }` | Outlet signups |
| `franchises` | `{ limit, isUnlimited }` | Franchise signups |
| `vouchers` | `{ isEnabled }` | Voucher creation |
| `showcase` | `{ isEnabled }` | Showcase sections |
| `dealPack` | `{ isEnabled }` | ⚠️ Abhi koi domain gate nahi karta |
| `prioritySupport` | `{ isEnabled }` | ⚠️ Informational only |

```json
{
  "name": "PREMIUM",
  "type": "MONTHLY",
  "price": 2999,
  "strikePrice": 3999,
  "discountType": "PERCENT",
  "discountPercent": 25,
  "description": "For growing brands with multiple outlets",
  "entitlements": {
    "subBrands":  { "limit": 10, "isUnlimited": false },
    "franchises": { "limit": 2,  "isUnlimited": false },
    "vouchers":   { "isEnabled": true },
    "showcase":   { "isEnabled": true },
    "dealPack":   { "isEnabled": true },
    "prioritySupport": { "isEnabled": true }
  },
  "features": [
    { "title": "Outlets", "value": "10", "available": true },
    { "title": "Franchises", "value": "2", "available": true },
    { "title": "Priority Support", "value": "Yes", "available": true }
  ],
  "benefits": ["Featured placement", "Advanced analytics"],
  "limitations": ["Fair usage on media storage"],
  "isActive": true
}
```

### Success — `201`
```json
{
  "success": true,
  "message": "Subscription created successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9k002",
    "name": "PREMIUM",
    "type": "MONTHLY",
    "price": 2999,
    "strikePrice": 3999,
    "discountType": "PERCENT",
    "discountPercent": 25,
    "durationInDays": 30,
    "entitlements": { "subBrands": { "limit": 10, "isUnlimited": false } },
    "features": [ ],
    "benefits": [ ],
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T22:30:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Subscription type is required` | |
| `400` | `Invalid subscription type for duration calculation` | `type` enum me nahi |
| `422` | `Name has minimum 3 characters` / `cannot exceed 120 characters` | |
| `422` | `Price is required` / `Price must be at least 0` | |
| `422` | `Description cannot exceed 500 characters` | |
| `422` | `limit cannot be negative` | Entitlement me |
| `422` | `discountPercent cannot exceed 100` | |
| `422` | `discountAmount cannot be negative` / `strikePrice cannot be negative` | |
| `422` | `discountType must be one of: PERCENT, FLAT` | |

### ⚠️ Edge cases & notes

**1. ⚠️ `entitlements` zaroor set karein.** Ye wo hai jo actually enforce hota hai. Na do to system `features[]` free-text se guess karta hai (`DERIVED`), aur wo bhi fail ho to **conservative fallback** lagta hai:

```js
// DEFAULT_ENTITLEMENTS — jaanbujh kar kanjoos
subBrands:  { limit: 1, isUnlimited: false }
franchises: { limit: 0, isUnlimited: false }
vouchers:   { limit: 0, isUnlimited: false }
showcase:   { limit: 0, isUnlimited: false }
```
Comment: *"if we cannot tell what a plan grants, grant almost nothing rather than leaking a paid feature for free."*

Kaunse plans galat configured hain, ye `GET /subscribeds/get?brandId=…` ke `entitlementsSource` se pata chalta hai — `DERIVED` ya `DEFAULT` dikhe to us plan ko theek karein.

**2. `entitlements` ka key set fixed hai.** Validator comment: *"Fixed key set on purpose (and `stripUnknown` is already on globally), so an admin cannot invent a key that silently enforces nothing."* Naya key bhejoge to chup-chaap drop ho jaayega.

**3. `isUnlimited: true` `limit` ko override karta hai** — dono do to `isUnlimited` jeetega.

**4. `features[]` display-only hai** — plan card pe dikhta hai, kuch enforce nahi karta. `entitlements` ke saath consistent rakhein, warna vendor ko galat expectation milegi.

**5. `strikePrice` cosmetic hai** — *"never used in any maths."*

**6. `durationInDays` na do to `type` se derive hota hai:** WEEKLY=7, MONTHLY=30, QUATERLY=90, HALF_YEARLY=180, YEARLY=365.

**7. `dealPack` aur `prioritySupport` abhi kuch gate nahi karte** — `dealPack` ka koi domain nahi hai, `prioritySupport` informational hai.

---

## 72. GET /subscriptions/getAll

**Access:** Intended: Vendor + Admin · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | |
| `search` | string | ❌ | – | `""` allowed |
| `type` | string | ❌ | – | SUBSCRIPTION_TYPES enum |
| `isActive` | boolean\|string | ❌ | – | |
| `sortBy` | string | ❌ | – | `price` \| `name` \| `createdAt` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

### Success — `200`
```json
{
  "success": true,
  "message": "Subscriptions fetched successfully",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9k001",
        "name": "BASIC",
        "type": "MONTHLY",
        "price": 999,
        "durationInDays": 30,
        "entitlements": { "subBrands": { "limit": 3, "isUnlimited": false } },
        "features": [ ],
        "isActive": true,
        "createdAt": "2026-04-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `No any subscription found` — **empty-state** |
| `422` | Invalid `type`/`sortBy` |

---

## 73. GET /subscriptions/get/:id

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
  "data": { "_id": "…", "name": "BASIC", "type": "MONTHLY", "price": 999, "entitlements": { }, "isActive": true }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Subscription not found` |
| `422` | *(invalid ObjectId)* |

---

## 74. PUT /subscriptions/update/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
Create (#71) ke saare fields, sab optional.

```json
{ "price": 3499, "entitlements": { "subBrands": { "limit": 15, "isUnlimited": false } } }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription updated successfully",
  "data": { "_id": "…", "name": "PREMIUM", "price": 3499, "entitlements": { "subBrands": { "limit": 15 } } }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Subscription not found` |
| `400` | `Invalid subscription type for duration calculation` |
| `422` | `Price must be at least 0` / `limit cannot be negative` |

### ⚠️ Edge cases & notes

**1. ⚠️ Entitlements badalne ka asar existing subscribers pe turant nahi hota.** Brand ke cached counters (`subBrandsLimit` etc.) purane rehte hain jab tak:
- Wo brand renew/upgrade na kare, **ya**
- Admin `PUT /subscribeds/admin/resync` (#81) na chalaye

**Limit badhane ke baad affected brands pe resync chalayein**, warna unhe naya limit nahi milega.

**2. ⚠️ Limit ghatane pe existing brands "overflow" me chale jaate hain** — jaise 5 outlets the aur limit 3 kar diya. Existing outlets **chalte rehte hain** (kuch delete nahi hota), par naye nahi ban sakte. `GET /subscribeds/get` ka `usage[bucket].overflowBy` positive dikhega.

**3. `price` badalne se purane invoices pe koi asar nahi** — wo transaction pe frozen pricing se bante hain.

---

## 75. DELETE /subscriptions/delete/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Subscription deleted successfully", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Subscription not found` |
| `422` | *(invalid ObjectId)* |

### ⚠️ Notes

**1. Soft delete hai.**

**2. ⚠️ Active subscribers wale plan ko delete mat karein.** `Subscribed.subscriptionId` uspe point karta rehta hai, aur `assertActiveSubscription` phir ye error deta hai:
```
404 "The subscription plan for this brand no longer exists."
```
Us brand ke **saare paid features band ho jaayenge**.

Delete se pehle check karein:
```http
GET /subscribeds/admin/get-all?subscriptionId=<id>&status=ACTIVE
```

**3. `isActive: false` (#74) safer hai** — naye vendors ko plan nahi dikhta, existing subscribers chalte rehte hain.

---

# Subscribed APIs

Brand ki **actual subscription** ka lifecycle. `/subscriptions` plan catalog hai, ye "kis brand ne kya liya" hai.

Paid path `/transactions/subscribe/*` pe hai; ye admin ka **manual / without-payment** path hai.

## 76. POST /subscribeds/admin/grant

Bina online payment ke subscription dena. **NEW / RENEW / UPGRADE / DOWNGRADE — chaaron ek hi call me**, response ka `action` batata hai kaunsa apply hua.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | |
| `subscriptionId` | ObjectId | ✅ | – | Plan |
| `note` | string | ✅ | – | **3–500 chars — mandatory hai**, manual grant ka reason |
| `startDate` | date | ❌ | `now` | |
| `durationInDays` | number | ❌ | plan ka | Integer 1–3650 — **bespoke/pro-rated term ke liye** |
| `paymentMode` | string | ❌ | `FREE` | `FREE` \| `CASH` \| `BANK_TRANSFER` \| `CHEQUE` \| `UPI_OFFLINE` |
| `collectedAmount` | number | ❌ | – | ≥ 0. **`FREE` grant pe ignore** |
| `referenceNumber` | string | ❌ | – | Max 80 — cheque no. / UTR |
| `keepCurrentEndDate` | boolean | ❌ | `false` | ⚠️ Tier badlo par validity wahi rakho |

**Free grant:**
```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002",
  "note": "Promotional grant — launch partner for Indore region"
}
```

**Offline payment record:**
```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002",
  "paymentMode": "BANK_TRANSFER",
  "collectedAmount": 3538.82,
  "referenceNumber": "UTR2026082212345",
  "note": "Paid by NEFT on 22 Aug, confirmed by finance"
}
```

**Tier upgrade, validity same:**
```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002",
  "keepCurrentEndDate": true,
  "note": "Goodwill upgrade — compensating for the July outage"
}
```

### Success — `201`
```json
{
  "success": true,
  "message": "Subscription new applied successfully without an online payment",
  "data": {
    "subscribed": {
      "_id": "68f1a2b3c4d5e6f7a8b9f002",
      "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
      "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002",
      "status": "ACTIVE",
      "source": "ADMIN_MANUAL",
      "isFreeGrant": true,
      "startDate": "2026-08-22T00:00:00.000Z",
      "endDate": "2026-09-21T23:59:59.000Z",
      "durationInDays": 30,
      "paidAmount": 0,
      "grantedBy": "68f1a2b3c4d5e6f7a8b9c000",
      "grantNote": "Promotional grant — launch partner for Indore region"
    },
    "transaction": {
      "_id": "68f1a2b3c4d5e6f7a8b9m002",
      "gateway": "MANUAL",
      "paymentMode": "FREE",
      "verified": true,
      "invoiceUrl": "https://res.cloudinary.com/…/TDI-2026-000452.pdf"
    },
    "action": "NEW",
    "pricing": {
      "originalPrice": 3999,
      "discount": 1000,
      "taxableValue": 2999,
      "taxType": "CGST_SGST",
      "gstPercentage": 18,
      "taxAmount": 539.82,
      "totalPayable": 3538.82,
      "currency": "INR"
    },
    "orderSummary": { "rows": [ ], "payable": { "amount": 3538.82, "display": "₹3,538.82" } },
    "limits": {
      "subBrands":  { "used": 3, "limit": 10, "isUnlimited": false, "overflowBy": 0 },
      "franchises": { "used": 0, "limit": 2,  "isUnlimited": false, "overflowBy": 0 },
      "vouchers":   { "used": 4, "limit": 50, "isUnlimited": false, "overflowBy": 0 },
      "showcase":   { "used": 2, "limit": 10, "isUnlimited": false, "overflowBy": 0 }
    },
    "overflow": {},
    "entitlementsSource": "DB"
  }
}
```

> Message `action` se banta hai — `"Subscription new applied…"` / `"Subscription renew applied…"` / `"upgrade"` / `"downgrade"`.

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Manual subscription grants are disabled in the current platform settings.` | `allowAdminFreeGrant: false` |
| `403` | `Downgrades are disabled in the current platform settings.` | `allowAdminDowngrade: false` |
| `404` | `Brand not found!` | |
| `404` | `Subscription plan not found!` | |
| `422` | `Plan "PREMIUM" has no duration configured. Pass durationInDays to grant it.` | Plan misconfigured |
| `422` | `keepCurrentEndDate requires an active subscription to inherit the end date from.` | Koi active plan nahi |
| `422` | `The computed end date is already in the past. Check startDate and durationInDays.` | Past date |
| `422` | `Collected amount (₹5000) cannot exceed the plan total (₹3538.82).` | Overpayment |
| `422` | `A note explaining this manual grant is required` | |
| `422` | `note must be at least 3 characters` / `cannot exceed 500 characters` | |
| `422` | `durationInDays must be at least 1` / `cannot exceed 3650` | |
| `422` | `paymentMode must be one of: FREE, CASH, BANK_TRANSFER, CHEQUE, UPI_OFFLINE` | |
| `422` | `collectedAmount cannot be negative` | |

### ⚠️ Edge cases & notes

**1. `action` khud derive hota hai** — current active plan aur requested plan compare karke:
| `action` | Kab |
|---|---|
| `NEW` | Koi active plan nahi |
| `RENEW` | Wahi plan dobara |
| `UPGRADE` | Mehenga plan |
| `DOWNGRADE` | Sasta plan — `allowAdminDowngrade` setting se gated |

**2. `note` mandatory hai** — validator comment: *"a manual grant must always say why it was given."* Audit trail me jaata hai.

**3. Inactive plan bhi grant ho sakta hai** — jaanbujh kar: *"that is how a retired or bespoke plan gets honoured for a specific brand."*

**4. Invoice PDF banta hai** — `FREE` grant pe bhi (₹0 ka). Agar PDF generation fail ho jaye to **grant phir bhi live rehta hai**: *"The grant is already live; a missing PDF must not undo it."*

**5. Pricing waise hi compute hota hai jaise bik raha ho** — GST breakdown sahi rehta hai, chahe `FREE` grant ho.

**6. `keepCurrentEndDate: true` upgrade ke liye useful hai** — vendor ne jo validity pay ki thi wo bachi rehti hai, sirf tier badalta hai. **Isse forfeit nahi hota.**

**7. `durationInDays` override se bespoke term de sakte hain** — jaise 45 din ka custom deal.

**8. `overflow` non-empty ho sakta hai** downgrade ke baad — existing entries chalte rehte hain, naye nahi ban sakte.

**9. Vendor ko notification jaati hai** — `SUBSCRIPTION_GRANTED` type.

---

## 77. PUT /subscribeds/admin/cancel

Active subscription revoke karta hai.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `brandId` | ObjectId | ✅ | |
| `reason` | string | ✅ | **3–500 chars — mandatory** |

```json
{
  "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
  "reason": "Chargeback raised and lost — plan revoked as per policy"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription cancelled successfully. Existing outlets and content remain intact.",
  "data": {
    "subscribed": {
      "_id": "68f1a2b3c4d5e6f7a8b9f002",
      "status": "CANCELLED",
      "cancelledAt": "2026-08-22T23:00:00.000Z",
      "cancelledBy": "68f1a2b3c4d5e6f7a8b9c000",
      "cancelReason": "Chargeback raised and lost — plan revoked as per policy"
    },
    "isSubscribed": false,
    "limits": {
      "subBrands":  { "used": 3, "limit": 0, "isUnlimited": false, "overflowBy": 3 },
      "franchises": { "used": 0, "limit": 0, "isUnlimited": false, "overflowBy": 0 },
      "vouchers":   { "used": 4, "limit": 0, "isUnlimited": false, "overflowBy": 4 },
      "showcase":   { "used": 2, "limit": 0, "isUnlimited": false, "overflowBy": 2 }
    },
    "usage": { "drifted": false }
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | |
| `422` | `This brand has no active subscription to cancel.` | Koi active plan nahi |
| `422` | `A reason for cancelling is required` | |
| `422` | `reason must be at least 3 characters` / `cannot exceed 500 characters` | |

### ⚠️ Edge cases & notes

**1. ⚠️ Existing content **kabhi** delete nahi hota.** Message hi ye kehta hai — *"Existing outlets and content remain intact."* Service comment: *"All limits go to zero; usage is deliberately untouched, because cancelling a plan never removes what the brand has already built."*

**Practically iska matlab:**
- Saare limits `0` ho jaate hain → naya outlet/voucher/section nahi ban sakta
- Purane outlets, vouchers, showcase sections **live rehte hain**
- `overflowBy` = jitna already bana hua hai

**2. Vendor ko notification jaati hai** — `SUBSCRIPTION_CANCELLED`.

**3. Refund handle nahi hota** — ye sirf entitlement revoke karta hai. Paisa wapas karna alag process hai (Razorpay dashboard se).

**4. Reason vendor ko dikh sakta hai** — professional likhein.

**5. Cancel ke baad brand ko dobara chalu karne ke liye** `POST /subscribeds/admin/grant` (#76) se naya plan dena hoga.

---

## 78. GET /subscribeds/admin/get-all

Saare brands ki subscriptions — **renewals worklist**.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | `""` allowed |
| `brandId` | ObjectId | ❌ | – | |
| `subscriptionId` | ObjectId | ❌ | – | **Plan delete karne se pehle check** |
| `status` | string | ❌ | – | SUBSCRIBED_STATUS enum |
| `source` | string | ❌ | – | `PAYMENT` \| `ADMIN_PAYMENT` \| `ADMIN_MANUAL` |
| `expiringInDays` | number | ❌ | – | ⚠️ Integer 1–365 — **renewals worklist** |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | – | `createdAt` \| `endDate` \| `startDate` \| `paidAmount` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Renewals worklist — 7 din me expire ho rahe:**
```http
GET /subscribeds/admin/get-all?expiringInDays=7&status=ACTIVE&sortBy=endDate&sortOrder=asc
```

**Revenue view:**
```http
GET /subscribeds/admin/get-all?source=PAYMENT&sortBy=paidAmount&sortOrder=desc
```

**Free grants audit:**
```http
GET /subscribeds/admin/get-all?source=ADMIN_MANUAL
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscriptions fetched successfully",
  "data": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9f001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "brand": { "_id": "…", "brandName": "cafe mocha", "uniqueId": "TDB000078" },
        "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001",
        "plan": { "_id": "…", "name": "BASIC", "type": "MONTHLY", "price": 999 },
        "status": "ACTIVE",
        "source": "PAYMENT",
        "isFreeGrant": false,
        "startDate": "2026-08-22T00:00:00.000Z",
        "endDate": "2026-09-21T23:59:59.000Z",
        "daysRemaining": 5,
        "paidAmount": 1178.82,
        "createdAt": "2026-08-22T00:00:05.000Z"
      }
    ]
  }
}
```

> Empty pe `[]` aata hai, 404 nahi.

### Errors
| Status | Message |
|---|---|
| `422` | `Invalid brandId` / `Invalid subscriptionId` |
| `422` | Invalid `status`/`source`/`sortBy` |
| `422` | `expiringInDays` 1–365 ke bahar |

### ⚠️ Notes

**1. `expiringInDays` sabse useful filter hai** — validator comment: *"Renewals worklist: active plans ending within N days."* Backend bhi `[7, 3, 1]` days pe reminders bhejta hai, to admin panel me bhi wahi cadence rakhein.

**2. `subscriptionId` filter plan delete karne se pehle zaruri hai** (#75 note 2 dekho).

**3. `source=ADMIN_MANUAL`** se free/offline grants ka audit milta hai.

---

## 79. GET /subscribeds/admin/forfeited

**Goodwill worklist** — jin vendors ne mid-term plan change pe paid days khoye.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `brandId` | ObjectId | ❌ | – | |
| `compensated` | boolean\|string | ❌ | – | ⚠️ **Default view = actionable set (uncompensated)** |
| `minDays` | number | ❌ | – | Integer ≥ 1 — trivial forfeits ignore karne ke liye |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortBy` | string | ❌ | – | `forfeitedValue` \| `forfeitedDays` \| `upgradeDate` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Actionable worklist — 7+ din ke forfeits, bade pehle:**
```http
GET /subscribeds/admin/forfeited?compensated=false&minDays=7&sortBy=forfeitedValue&sortOrder=desc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Forfeited subscription terms fetched successfully",
  "data": {
    "total": 6,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9f000",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "brand": { "_id": "…", "brandName": "cafe mocha", "uniqueId": "TDB000078" },
        "status": "UPGRADED",
        "plan": { "name": "BASIC", "type": "MONTHLY" },
        "upgradedTo": "68f1a2b3c4d5e6f7a8b9f001",
        "upgradeDate": "2026-08-10T00:00:00.000Z",
        "originalEndDate": "2026-08-31T23:59:59.000Z",
        "forfeitedDays": 21,
        "forfeitedValue": 699.3,
        "forfeitCompensatedAt": null,
        "forfeitCompensationNote": null
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `Invalid brandId` |
| `422` | Invalid `sortBy`/`sortOrder` |

### ⚠️ Edge cases & notes

**1. Ye kyun exist karta hai:** upgrade karne pe purana plan **turant** khatam ho jaata hai aur bache hue din **forfeit** ho jaate hain — koi proration nahi hoti.

`FORFEIT_POLICY` constant ka comment:
> *"Upgrading ends the current plan immediately and starts the new one from that date — the remaining days are forfeited, and the policy states so upfront. No proration is applied, but every forfeit is recorded (`forfeitedDays` / `forfeitedValue`) so those vendors can be found later and compensated with credit or a goodwill extension."*

**2. Ye ek worklist hai, report nahi.** Default view uncompensated forfeits dikhata hai — jinpe action lena hai.

**3. Compensate karne ka tareeka:**
- `PUT /subscribeds/admin/forfeited/compensate` (#80) — **sirf mark karta hai**, actual value nahi deta
- Actual goodwill dene ke liye `POST /subscribeds/admin/grant` (#76) `keepCurrentEndDate` ya `durationInDays` extension ke saath

**4. `minDays` se trivial forfeits filter karein** — 1-2 din ke liye follow-up worth nahi.

**5. `forfeitedValue` rupees me hai** — plan price se pro-rate karke nikala gaya.

---

## 80. PUT /subscribeds/admin/forfeited/compensate

Forfeited term ko "settled" mark karta hai.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `subscribedId` | ObjectId | ✅ | Forfeited record ka id (#79 se) |
| `note` | string | ✅ | **3–500 chars — mandatory** |

```json
{
  "subscribedId": "68f1a2b3c4d5e6f7a8b9f000",
  "note": "Granted 21 extra days on the PREMIUM plan as compensation — ref grant 68f1a2b3c4d5e6f7a8b9f003"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Forfeited term marked as compensated",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9f000",
    "forfeitedDays": 21,
    "forfeitedValue": 699.3,
    "forfeitCompensatedAt": "2026-08-22T23:30:00.000Z",
    "forfeitCompensationNote": "Granted 21 extra days on the PREMIUM plan as compensation — ref grant 68f1a2b3c4d5e6f7a8b9f003",
    "forfeitCompensatedBy": "68f1a2b3c4d5e6f7a8b9c000"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Subscription record not found!` | |
| `422` | `This subscription did not forfeit any days.` | `forfeitedDays` 0 hai |
| `422` | `This forfeit has already been marked as compensated.` | Dobara mark |
| `422` | `A note describing the compensation is required` | |
| `422` | `note must be at least 3 characters` / `cannot exceed 500 characters` | |

### ⚠️ Notes

**1. ⚠️ Ye sirf bookkeeping hai — actual compensation nahi deta.** Vendor ko kuch nahi milta is call se. Ye batata hai ki "ye forfeit handle ho gaya".

**Sahi flow:**
```
1. GET  /subscribeds/admin/forfeited?compensated=false     → worklist
2. POST /subscribeds/admin/grant                            → actual goodwill (extra days / free upgrade)
3. PUT  /subscribeds/admin/forfeited/compensate             → mark as settled, note me grant ka reference
```

**2. Idempotent nahi hai** — dobara mark karne pe `422`.

**3. `note` me actual compensation ka reference likhein** — audit ke liye.

---

## 81. PUT /subscribeds/admin/resync

**Repair tool** — brand ke cached subscription state aur plan limits rebuild karta hai.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

```json
{ "brandId": "68f1a2b3c4d5e6f7a8b9c3a1" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand subscription state resynced successfully",
  "data": {
    "before": {
      "isSubscribed": true,
      "subscribedId": "68f1a2b3c4d5e6f7a8b9f001",
      "subBrandsLimit": 3,
      "subBrandsUsed": 5,
      "franchisesLimit": 0,
      "franchisesUsed": 0,
      "entitlementsSyncedAt": "2026-07-01T00:00:00.000Z"
    },
    "after": {
      "isSubscribed": true,
      "subscribedId": "68f1a2b3c4d5e6f7a8b9f001",
      "subBrandsLimit": 10,
      "subBrandsUsed": 4,
      "franchisesLimit": 2,
      "franchisesUsed": 0,
      "entitlementsSyncedAt": "2026-08-22T23:45:00.000Z"
    },
    "isSubscribed": true,
    "entitlements": {
      "subBrands":  { "limit": 10, "isUnlimited": false },
      "franchises": { "limit": 2,  "isUnlimited": false },
      "vouchers":   { "limit": 50, "isUnlimited": false },
      "showcase":   { "limit": 10, "isUnlimited": false }
    },
    "entitlementsSource": "DB",
    "entitlementWarnings": [],
    "countersDrifted": true,
    "overflow": {}
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand not found!` |
| `422` | `brandId is required` / `Invalid brandId` |

### ⚠️ Edge cases & notes

**1. Kab chalayein:**
| Situation | Kyun |
|---|---|
| Plan ke `entitlements` badle (#74) | Existing subscribers ke cached limits purane rehte hain |
| `usage` counters galat lag rahe hain | Manual DB edit ya bug ke baad drift |
| Vendor kehta hai "limit reached" par actually nahi hai | Counter drift |
| Bulk migration ke baad | State rebuild |

**2. `before` / `after` diff dikhata hai** — kya badla, saaf pata chalta hai.

**3. `countersDrifted: true` matlab counters actual `SubBrand`/`Voucher`/`ShowcaseSection` rows se match nahi kar rahe the** — recount ho gaya. Ye important signal hai; agar baar-baar aa raha hai to koi code path counters sahi update nahi kar raha.

**4. `overflow` non-empty ho sakta hai** — limit ghatne ke baad. Existing entries chalte rehte hain.

**5. Safe hai** — koi data delete nahi karta, sirf counters aur cached flags rebuild karta hai.

---

## 82. GET /subscribeds/get

Ek brand ki current subscription — **admin ke liye `brandId` mandatory**.

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | **Admin ke liye required** — na do to `422` |

```http
GET /subscribeds/get?brandId=68f1a2b3c4d5e6f7a8b9c3a1
```

### Success — `200`
```json
{
  "success": true,
  "message": "Brand subscription details fetched successfully",
  "data": {
    "brand": { "_id": "…", "brandName": "cafe mocha", "isSubscribed": true },
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
      "pricing": { "originalPrice": 999, "taxAmount": 179.82, "totalPayable": 1178.82 },
      "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
      "plan": { "_id": "…", "name": "BASIC", "type": "MONTHLY", "typeLabel": "Monthly", "price": 999 }
    },
    "lastSubscription": null,
    "entitlements": { "subBrands": { "limit": 3, "isUnlimited": false } },
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

> Koi active plan na ho to `subscription: null` aur `lastSubscription` populated — **404 nahi**.

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `brandId is required when acting as an admin` | ⚠️ Admin-specific |
| `404` | `Brand not found!` | |
| `422` | `Invalid brandId` | |

### ⚠️ Notes

**1. Ye brand-detail screen ka main call hai** — plan, dates, entitlements, usage sab ek jagah.

**2. `isSubscribed` live computed hai** (`status === ACTIVE && endDate > now`), `brand.isSubscribed` cache se nahi. **Ispe bharosa karein.**

**3. Self-healing** — expired plan read pe hi expire ho jaata hai.

**4. `entitlementsSource` batata hai plan sahi configured hai ya nahi** — `DERIVED`/`DEFAULT` dikhe to us plan ko theek karein (#74).

**5. `usage[bucket].overflowBy > 0`** = grandfathered downgrade. Existing entries chal rahe hain par naye nahi ban sakte.

---

## 83. GET /subscribeds/history

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | – | **Admin ke liye required** |
| `action` | string | ❌ | – | SUBSCRIPTION_HISTORY_ACTION enum |
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |

```http
GET /subscribeds/history?brandId=68f1a2b3c4d5e6f7a8b9c3a1&limit=50
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription history fetched successfully",
  "data": {
    "total": 6,
    "page": 1,
    "limit": 50,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9n001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "subscribedId": "68f1a2b3c4d5e6f7a8b9f002",
        "action": "ADMIN_GRANTED",
        "performedByType": "ADMIN",
        "performedBy": { "_id": "68f1a2b3c4d5e6f7a8b9c000", "name": "admin user" },
        "planName": "PREMIUM",
        "startDate": "2026-08-22T00:00:00.000Z",
        "endDate": "2026-09-21T23:59:59.000Z",
        "paidAmount": 0,
        "note": "Promotional grant — launch partner for Indore region",
        "createdAt": "2026-08-22T22:50:00.000Z"
      },
      {
        "action": "UPGRADED",
        "performedByType": "VENDOR",
        "planName": "BASIC",
        "forfeitedDays": 21,
        "forfeitedValue": 699.3,
        "createdAt": "2026-08-10T00:00:00.000Z"
      },
      {
        "action": "EXPIRED",
        "performedByType": "SYSTEM",
        "planName": "BASIC",
        "createdAt": "2026-07-22T00:05:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `brandId is required when acting as an admin` |
| `422` | Invalid `action` enum |

### ⚠️ Notes

**1. `performedByType`:** `VENDOR` (khud kiya) · `ADMIN` (grant/cancel) · `SYSTEM` (expiry job).

**2. `UPGRADED` rows pe `forfeitedDays`/`forfeitedValue` dekhein** — yahi forfeited worklist (#79) me aata hai.

**3. `ADMIN_GRANTED` rows pe `note` mandatory tha** — grant ka reason yahin milega.

> 📖 Poori design — pricing, tax, forfeit policy, entitlement sync → [subscription_lifecycle_design.md](./subscription_lifecycle_design.md)

---

# Promo Code APIs

Promo codes **do checkouts** ke liye. **Poora module `router.use(isAdmin)` ke peeche hai ✅** — vendor ya customer codes manage nahi karte, wo sirf redeem karte hain.

### ⚠️ `audience` — sabse pehle ye samjhein

Ek hi collection do bilkul alag campaigns rakhta hai:

| | `audience: "VENDOR"` *(default)* | `audience: "CUSTOMER"` |
|---|---|---|
| Kahan redeem hota hai | `/transactions/subscribe/preview` + `create-order` | Voucher claim checkout |
| Kaun redeem karta hai | Vendor, apne plan pe | Customer, apne bill pe |
| Scope fields | `subscriptionIds`, `applicableActions` | `voucherIds`, `brandIds`, `categoryIds` |
| Minimum | `minOrderValue` (plan-discounted subtotal) | `minBillAmount` (customer ne jo raw bill type kiya) |
| Per-owner cap | `perBrandUsageLimit` | `perCustomerUsageLimit` |
| First-time | `firstTimeOnly` | `firstOrderOnly` |
| Kis base pe lagta hai | Plan subtotal | `appliesTo`: `NET_BILL` \| `CONVENIENCE_FEE` |
| Discount kaun bharta hai | Hamesha platform | `costBearing`: `PLATFORM` \| `VENDOR` \| `SHARED` |

**Dono poori tarah isolated hain.** Ek audience ka code doosre ke checkout pe bilkul waise reject hota hai jaise wo code exist hi na karta ho (`This promo code is not valid.`) — "ye code aapke liye nahi hai" bolne se confirm ho jaata ki code exist karta hai, aur response se live codes enumerate kiye ja sakte the.

**Jo shared hai:** window (`validFrom` / `validTill`), platform-wide `totalUsageLimit`, aur discount ka arithmetic (percent, `maxDiscountAmount` cap, base pe clamp) — ye teeno `helpers/promoCodes/assertPromoWindowAndCaps.js` me ek jagah hain, isliye do checkouts kabhi disagree nahi kar sakte ki code ki value kitni hai.

**⚠️ `audience` create ke baad immutable hai** — har `PromoCodeUsage` row usko claim time pe freeze karti hai aur per-owner cap usi se count hota hai. Flip karne se wo history orphan ho jaati aur single-use code dobara redeem ho jaata. Jo codes is field ke aane se pehle bane the unme value stored nahi hai; wo **har jagah `VENDOR` maane jaate hain** (lookup `$ne: CUSTOMER` se hota hai, `$eq: VENDOR` se nahi — warna ek bhi purana code na milta).

### Discount kaise lagta hai

`constants/promoCode.js` ka comment:
> *"A promo code discount is applied **on top of** the plan's own discount, to the already-discounted subtotal — never to the list price. GST is then charged on `listPrice - planDiscount - promoDiscount`, which keeps the tax base correct."*

```
Original Price       ₹1,499
− Plan discount      ₹  500
= Subtotal           ₹  999
− Promo discount     ₹  200      ← subtotal pe lagta hai, list price pe nahi
= Bill Value         ₹  799
+ GST 18%            ₹  143.82
= You'll Pay         ₹  942.82
```

### Three-step claim

Ek abandoned checkout single-use code ko lock na kar de, isliye:

| Status | Kab | Kya hota hai |
|---|---|---|
| `RESERVED` | Order bana, payment nahi hua | Slot hold |
| `CONSUMED` | Payment verified | Use final |
| `RELEASED` | Order fail/expire | Slot wapas |

⚠️ **`RESERVED` 30 minute se purana ho to sweep job (`releaseStalePromoReservations`, har 15 min) usko reclaim kar leta hai.**

### ⚠️ Promo codes abhi off hain

`Setting.vendor.subscription.isPromoCodeEnabled` ka default **`false`** hai. Checkout preview tab ye deta hai:
```json
{ "promo": { "supported": false, "applied": null, "message": "Promo codes are coming soon" } }
```

**Codes banane se pehle `PUT /settings/update` (#99) se enable karein:**
```json
{ "vendor": { "subscription": { "isPromoCodeEnabled": true } } }
```

## 84. POST /promoCodes/create

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `code` | string | ✅ | 3–40 chars, `/^[A-Z0-9_-]+$/`, auto-uppercase + trim |
| `audience` | string | ❌ | `VENDOR` *(default)* \| `CUSTOMER` — ⚠️ create ke baad change nahi hota |
| `discountType` | string | ✅ | `PERCENT` \| `FLAT` |
| `discountPercent` | number | ⚠️ | 0–100 — **`PERCENT` pe > 0 hona chahiye** |
| `discountAmount` | number | ⚠️ | ≥ 0 — **`FLAT` pe > 0 hona chahiye** |
| `maxDiscountAmount` | number | ❌ | ≥ 1 — ⚠️ **sirf `PERCENT` pe allowed** |
| `minOrderValue` | number | ❌ | ≥ 0 — **plan-discounted subtotal se compare hota hai** |
| `description` | string | ❌ | Max 300, `""` allowed |
| `subscriptionIds` | ObjectId[] | ❌ | Kaunse plans pe valid. Empty = sab |
| `applicableActions` | string[] | ❌ | `NEW` \| `RENEW` \| `UPGRADE` \| `DOWNGRADE`. Empty = sab |
| `firstTimeOnly` | boolean | ❌ | Sirf pehli subscription pe |
| `validFrom` · `validTill` | date | ❌ | `validTill` > `validFrom` |
| `totalUsageLimit` | number | ❌ | Integer ≥ 1 |
| `perBrandUsageLimit` | number | ❌ | Integer ≥ 1 — ⚠️ `totalUsageLimit` se zyada nahi · **VENDOR only** |
| `isActive` | boolean | ❌ | |

**`audience: "CUSTOMER"` ke extra fields:**

| Field | Type | Required | Validation |
|---|---|---|---|
| `voucherIds` | ObjectId[] | ❌ | Kaunse vouchers pe valid. Empty = sab. **Exist karne chahiye** |
| `brandIds` | ObjectId[] | ❌ | Kaunse brands pe valid. Empty = sab. **Exist karne chahiye** |
| `categoryIds` | ObjectId[] | ❌ | Kaunsi categories pe valid. Empty = sab. **Exist karne chahiye** |
| `minBillAmount` | number | ❌ | ≥ 0 — **raw bill se compare hota hai, offer lagne se pehle** |
| `appliesTo` | string | ❌ | `NET_BILL` *(default)* \| `CONVENIENCE_FEE` |
| `perCustomerUsageLimit` | number | ❌ | Integer ≥ 1 — ⚠️ `totalUsageLimit` se zyada nahi |
| `firstOrderOnly` | boolean | ❌ | Sirf customer ke pehle claim pe |
| `costBearing.mode` | string | ❌ | `PLATFORM` *(default)* \| `VENDOR` \| `SHARED` |
| `costBearing.vendorPercent` | number | ❌ | 0–100 — ⚠️ **sirf `SHARED` pe, aur 1–99 hona chahiye** |

⚠️ **Doosri audience ka field bhejna `422` hai, silently ignore nahi hota.** Warna code ban to jaata par kabhi match na karta — jo diagnose karna 422 se kahin mushkil hai.

### `costBearing` — discount kaun bharta hai

Ye wo field hai jo **vendor ke bank account tak pahunchti hai**, isliye iske rules sakht hain:

| mode | Matlab | Kya chahiye |
|---|---|---|
| `PLATFORM` *(default)* | Trydood bharta hai; vendor ka settlement aisa hi rehta hai jaise koi code laga hi na ho | — |
| `VENDOR` | Brand bharta hai; us din ke settlement se minus hota hai | non-empty `brandIds` |
| `SHARED` | Dono me bat-ta hai | non-empty `brandIds` + `vendorPercent` 1–99 |

**`brandIds` `PLATFORM` ke alawa mandatory kyun:** uske bina discount us brand se cut hota jahan customer ittefaq se pahunch gaya — ek aisa code jise fund karne pe wo brand kabhi raazi hi nahi hua tha.

**Split claim time pe `PromoCodeUsage` row pe freeze ho jaata hai** (`vendorCost` + `platformCost`, jinka sum hamesha `discountAmount` hota hai). Isliye code ko baad me edit ya delete karne se koi aisa settlement dobara nahi likha jaata jo pehle hi compute ho chuka hai.

**Customer code, brand-funded:**
```json
{
  "code": "PIZZA50",
  "audience": "CUSTOMER",
  "discountType": "FLAT",
  "discountAmount": 50,
  "brandIds": ["68f1a2b3c4d5e6f7a8b9d001"],
  "minBillAmount": 300,
  "appliesTo": "NET_BILL",
  "perCustomerUsageLimit": 2,
  "costBearing": { "mode": "SHARED", "vendorPercent": 40 },
  "totalUsageLimit": 5000
}
```
₹50 discount pe vendor ₹20 bharta hai, platform ₹30.

**Percentage code with cap:**
```json
{
  "code": "MONSOON20",
  "discountType": "PERCENT",
  "discountPercent": 20,
  "maxDiscountAmount": 1000,
  "minOrderValue": 999,
  "description": "Monsoon campaign — 20% off up to ₹1,000",
  "applicableActions": ["NEW", "RENEW"],
  "validFrom": "2026-09-01T00:00:00.000Z",
  "validTill": "2026-09-30T23:59:59.000Z",
  "totalUsageLimit": 500,
  "perBrandUsageLimit": 1,
  "isActive": true
}
```

**Flat code, first-time only, specific plan:**
```json
{
  "code": "WELCOME500",
  "discountType": "FLAT",
  "discountAmount": 500,
  "firstTimeOnly": true,
  "subscriptionIds": ["68f1a2b3c4d5e6f7a8b9k002"],
  "applicableActions": ["NEW"],
  "totalUsageLimit": 100
}
```

### Success — `201`
```json
{
  "success": true,
  "message": "Promo code created successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9q001",
    "code": "MONSOON20",
    "audience": "VENDOR",
    "description": "Monsoon campaign — 20% off up to ₹1,000",
    "discountType": "PERCENT",
    "discountPercent": 20,
    "maxDiscountAmount": 1000,
    "minOrderValue": 999,
    "subscriptionIds": [],
    "applicableActions": ["NEW", "RENEW"],
    "firstTimeOnly": false,
    "validFrom": "2026-09-01T00:00:00.000Z",
    "validTill": "2026-09-30T23:59:59.000Z",
    "totalUsageLimit": 500,
    "perBrandUsageLimit": 1,
    "usedCount": 0,
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "createdAt": "2026-08-23T00:00:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `409` | `Promo code "MONSOON20" already exists.` | Duplicate code |
| `422` | `A PERCENT promo code needs a discountPercent above 0.` | |
| `422` | `A FLAT promo code needs a discountAmount above 0.` | |
| `422` | `maxDiscountAmount only applies to a PERCENT code — a FLAT code is already a fixed amount.` | |
| `422` | `validTill must be after validFrom.` | |
| `422` | `perBrandUsageLimit cannot exceed totalUsageLimit.` | |
| `422` | `One or more subscriptionIds do not exist.` | ⚠️ Non-existent plan reference |
| `422` | `One or more voucherIds / brandIds / categoryIds do not exist.` | ⚠️ CUSTOMER scope reference |
| `422` | `perCustomerUsageLimit cannot exceed totalUsageLimit.` | |
| `422` | `voucherIds, minBillAmount are not valid on a VENDOR promo code.` | Galat audience ka field |
| `422` | `subscriptionIds, applicableActions are not valid on a CUSTOMER promo code.` | Galat audience ka field |
| `422` | `costBearing applies to CUSTOMER promo codes — a subscription discount is always funded by the platform.` | `VENDOR`/`SHARED` mode VENDOR-audience code pe |
| `422` | `A VENDOR promo code must be scoped with brandIds. Without it the discount would be deducted from whichever brand the customer happens to visit.` | |
| `422` | `A SHARED promo code needs a vendorPercent between 1 and 99. Use PLATFORM for 0 or VENDOR for 100.` | |
| `422` | `vendorPercent only applies to a SHARED promo code — VENDOR already decides who pays in full.` | |
| `422` | `audience must be one of: VENDOR, CUSTOMER` | |
| `422` | `Code is required` | |
| `422` | `Code must be at least 3 characters` / `cannot exceed 40 characters` | |
| `422` | `Code may only contain letters, numbers, dashes and underscores` | |
| `422` | `discountType must be one of: PERCENT, FLAT` | |
| `422` | `discountPercent cannot exceed 100` | |
| `422` | `Description cannot exceed 300 characters` | |
| `422` | `applicableActions may only contain: NEW, RENEW, UPGRADE, DOWNGRADE` | |

### ⚠️ Edge cases & notes

**1. Code format restricted hai** — sirf `A-Z`, `0-9`, `-`, `_`. Validator comment: *"anything else is a pain to read out loud, type on a phone, or put in a campaign."*

**2. `subscriptionIds` validate hote hain** — non-existent plan reference karne pe `422`. Comment: *"Referencing a plan that does not exist would silently make the code unusable rather than erroring at checkout."*

**3. `minOrderValue` **plan-discounted subtotal** se compare hota hai, list price se nahi.** `₹1,499` ka plan `₹999` pe aa raha ho aur `minOrderValue: 1200` set kiya ho, to code **kabhi apply nahi hoga**.

**4. `maxDiscountAmount` sirf `PERCENT` pe** — `FLAT` ke saath bhejne pe explicit `422`.

**5. Empty `subscriptionIds` / `applicableActions` = "any"** — restriction ke liye hi bharein.

**6. Rejection reasons vendor ko specific milte hain** — `PROMO_REJECTION` constants me 11 alag messages hain (`This promo code has expired.`, `You have already used this promo code.` etc.) taaki vendor ko actionable feedback mile.

---

## 85. GET /promoCodes/get-all

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `search` | string | ❌ | – | `""` allowed |
| `isActive` | boolean\|string | ❌ | – | **Stored flag** |
| `status` | string | ❌ | – | ⚠️ `LIVE` \| `SCHEDULED` \| `EXPIRED` — **effective state** |
| `audience` | string | ❌ | – | `VENDOR` \| `CUSTOMER` — omit karne pe dono mix ho jaate hain |
| `sortBy` | string | ❌ | – | `createdAt` \| `code` \| `usedCount` \| `validTill` |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Abhi live codes:**
```http
GET /promoCodes/get-all?status=LIVE&sortBy=usedCount&sortOrder=desc
```

### Success — `200`
```json
{
  "success": true,
  "message": "Promo codes fetched successfully",
  "data": {
    "total": 12,
    "totalPages": 2,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9q001",
        "code": "MONSOON20",
        "description": "Monsoon campaign — 20% off up to ₹1,000",
        "discountType": "PERCENT",
        "discountPercent": 20,
        "maxDiscountAmount": 1000,
        "minOrderValue": 999,
        "applicableActions": ["NEW", "RENEW"],
        "firstTimeOnly": false,
        "validFrom": "2026-09-01T00:00:00.000Z",
        "validTill": "2026-09-30T23:59:59.000Z",
        "totalUsageLimit": 500,
        "perBrandUsageLimit": 1,
        "usedCount": 87,
        "reservedCount": 3,
        "remainingUses": 413,
        "isExpired": false,
        "isActive": true,
        "createdAt": "2026-08-23T00:00:00.000Z"
      }
    ]
  }
}
```

### Computed fields

| Field | Matlab |
|---|---|
| `usedCount` | `CONSUMED` uses — final redemptions |
| `reservedCount` | `RESERVED` uses — abhi checkout me hain |
| `remainingUses` | `totalUsageLimit − usedCount`. **`null` = unlimited** |
| `isExpired` | `validTill` nikal chuki hai |

### Errors
| Status | Message |
|---|---|
| `404` | `No any promo code found` — **empty-state** |
| `422` | Invalid `status`/`sortBy` |

### ⚠️ Notes

**1. `status` filter `isActive` se different hai** — validator comment: *"Effective state, which the stored flags alone do not express."*
| `status` | Matlab |
|---|---|
| `LIVE` | `isActive: true` **aur** date window ke andar |
| `SCHEDULED` | `isActive: true` par `validFrom` abhi aaya nahi |
| `EXPIRED` | `validTill` nikal chuki |

**2. `reservedCount` batata hai kitne checkouts abhi chal rahe hain** — sweep job 30 min baad inko release kar deta hai.

**3. `remainingUses: null` = unlimited** (`totalUsageLimit` set nahi hai).

---

## 86. GET /promoCodes/reports

Campaign performance report.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params — **sab optional**
| Param | Type | Validation | Notes |
|---|---|---|---|
| `promoCodeId` | ObjectId | – | Ek code |
| `code` | string | auto-uppercase | Ek code — **admin ko yahi yaad rehta hai** |
| `from` · `to` | ISO date | – | ⚠️ `to` poore din tak inclusive (23:59:59) |
| `groupBy` | string | `day` \| `month` (lowercase) | `overTime` breakdown |

> Bina kisi filter ke: **saare codes, all time** — dashboard landing case.

```http
GET /promoCodes/reports?code=MONSOON20&from=2026-09-01&to=2026-09-30&groupBy=day
```

### Success — `200`
```json
{
  "success": true,
  "message": "Promo code report generated successfully",
  "data": {
    "period": {
      "from": "2026-09-01T00:00:00.000Z",
      "to": "2026-09-30T23:59:59.999Z",
      "groupBy": "day",
      "basis": "The date the promo was claimed at checkout (createdAt)."
    },
    "summary": {
      "codesUsed": 1,
      "brandsReached": 84,
      "claims": 97,
      "redemptions": 87,
      "openReservations": 3,
      "abandoned": 7,
      "conversionRate": 89.69,
      "discountGiven": 62400,
      "revenueCollected": 189200,
      "revenueBeforePromo": 251600,
      "averageDiscount": 717.24,
      "averageOrderValue": 2174.71
    },
    "byCode": [
      {
        "promoCodeId": "68f1a2b3c4d5e6f7a8b9q001",
        "code": "MONSOON20",
        "claims": 97,
        "redemptions": 87,
        "discountGiven": 62400,
        "revenueCollected": 189200
      }
    ],
    "byPlan": [
      { "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002", "plan": "PREMIUM", "planPrice": 2999, "redemptions": 61, "discountGiven": 45600 },
      { "subscriptionId": "68f1a2b3c4d5e6f7a8b9k001", "plan": "BASIC", "planPrice": 999, "redemptions": 26, "discountGiven": 16800 }
    ],
    "byAction": [
      { "action": "NEW", "redemptions": 72, "discountGiven": 52000 },
      { "action": "RENEW", "redemptions": 15, "discountGiven": 10400 }
    ],
    "overTime": [
      { "period": "2026-09-01", "claims": 12, "redemptions": 11, "discountGiven": 7800 },
      { "period": "2026-09-02", "claims": 9, "redemptions": 8, "discountGiven": 5600 }
    ],
    "topBrands": [
      { "brandId": "68f1a2b3c4d5e6f7a8b9c3a1", "brandName": "cafe mocha", "redemptions": 1, "discountGiven": 720 }
    ]
  }
}
```

### Summary fields ka matlab

| Field | Matlab |
|---|---|
| `claims` | Kitni baar code checkout pe apply hua (`RESERVED` + `CONSUMED`) |
| `redemptions` | Kitni baar actually paid (`CONSUMED`) |
| `openReservations` | Abhi checkout me pade hain |
| `abandoned` | `RELEASED` — checkout chhod diya |
| `conversionRate` | `redemptions / claims × 100` |
| `discountGiven` | Total discount diya (₹) |
| `revenueCollected` | Discount ke **baad** jo mila (₹) |
| `revenueBeforePromo` | Bina promo ke kitna milta — *"the cost of the campaign made explicit"* |
| `averageDiscount` | `discountGiven / redemptions` |
| `averageOrderValue` | `revenueCollected / redemptions` |

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Promo code not found` | `promoCodeId`/`code` galat |
| `422` | `` `from` cannot be later than `to`. `` | |
| `422` | `from must be an ISO date, e.g. 2026-08-01` | |
| `422` | `groupBy must be one of: day, month` | |
| `422` | `audience must be one of: VENDOR, CUSTOMER` | |
| `422` | `MONSOON20 is a VENDOR promo code — asking for the CUSTOMER audience would report on nothing. Drop the audience filter, or use it without naming a code.` | `code`/`promoCodeId` + ulta `audience` |
| `422` | `Unknown query parameter` | Extra param bheja |

### ⚠️ Notes

**1. `revenueBeforePromo` campaign ki cost dikhata hai** — `revenueCollected + discountGiven`. Comment: *"the cost of the campaign made explicit."*

**2. Report caps hain** — `MAX_CODES: 100`, `MAX_BRANDS: 25`, `MAX_PERIODS: 400` (~2 saal months ya ~3 mahine days). Comment: *"an admin reading it wants the shape of a campaign, and a thousand-row table is a data export, not that."*

**3. `to` poore din tak inclusive hai** — service khud 23:59:59 tak widen kar deta hai.

**4. `basis` field response me hai** — batata hai kaunsi date window drive kar rahi hai (claim date, redemption date nahi).

**5. `code` se query karna aasan hai** — `promoCodeId` yaad rakhne ki zarurat nahi.

---

## 87. GET /promoCodes/get/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Promo code fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9q001",
    "code": "MONSOON20",
    "discountType": "PERCENT",
    "discountPercent": 20,
    "maxDiscountAmount": 1000,
    "usedCount": 87,
    "totalUsageLimit": 500,
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "updatedBy": null
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Promo code not found` |
| `422` | `Invalid promo code id` |

---

## 88. PUT /promoCodes/update/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional, **kam se kam ek field**
Create (#84) ke saare fields except `code` aur `audience` — ⚠️ **dono badal nahi sakte**.

```json
{ "totalUsageLimit": 1000, "validTill": "2026-10-15T23:59:59.000Z" }
```

**Code band karna:**
```json
{ "isActive": false }
```

⚠️ **`costBearing` merge hoti hai, replace nahi.** Jis code me pehle se `vendorPercent: 40` hai uspe `{ "costBearing": { "mode": "SHARED" } }` bhejne se 40 bana rehta hai. Ye merge na hota to ek SHARED code silently aisa ban jaata jo vendor ko kuch settle hi na karta — aur validation phir bhi pass kar jaati, kyunki wo stored value dekh ke check karti hai. Jo field badalni hai wahi bhejein.

### Success — `200`
```json
{
  "success": true,
  "message": "Promo code updated successfully",
  "data": {
    "promoCode": {
      "_id": "68f1a2b3c4d5e6f7a8b9q001",
      "code": "MONSOON20",
      "audience": "VENDOR",
      "totalUsageLimit": 1000,
      "validTill": "2026-10-15T23:59:59.000Z",
      "usedCount": 12,
      "isActive": true
    },
    "usage": { "consumed": 11, "reserved": 1 }
  }
}
```

> ⚠️ Response `data.promoCode` **aur** `data.usage` deta hai — flat promo code nahi. `usage` ledger se aata hai, `usedCount` counter se nahi, isliye actual redemptions aur khule checkouts alag dikhte hain.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Promo code not found` | |
| `422` | `A PERCENT promo code needs a discountPercent above 0.` | |
| `422` | `maxDiscountAmount only applies to a PERCENT code …` | |
| `422` | `validTill must be after validFrom.` | Existing + new merge hoke check hota hai |
| `422` | `perBrandUsageLimit cannot exceed totalUsageLimit.` | |
| `422` | `One or more subscriptionIds do not exist.` | |
| `422` | `A promo code's audience cannot be changed from VENDOR to CUSTOMER — its redemption history is counted per audience. Deactivate this one and create a new code instead.` | ⚠️ Wahi value dobara bhejna theek hai |
| `422` | `perCustomerUsageLimit cannot exceed totalUsageLimit.` | |
| `422` | Saare `costBearing` rules (#84 dekhein) | Stored + new merge hoke check hote hain |
| `422` | `Please provide at least one field to update.` | Body khali |

### ⚠️ Notes

**1. `code` immutable hai** — validator me nahi hai. Naya code chahiye to naya banao.

**1b. `audience` bhi immutable hai** — har `PromoCodeUsage` row usko claim time pe freeze karti hai aur per-owner cap usi se count hota hai. Flip karne se purani rows cap me ginna band ho jaati aur single-use code dobara redeem ho jaata. Jo codes is field se pehle bane the wo `VENDOR` count hote hain, isliye unhe `CUSTOMER` bhi nahi banaya ja sakta.

**2. Validations existing + new merge karke chalti hain** — jaise sirf `validTill` bhejo, to wo existing `validFrom` se compare hoga.

**3. `isActive: false` code turant band kar deta hai** — checkout pe `"This promo code is no longer active."` aayega.

**4. `totalUsageLimit` ghatana already-consumed uses ko affect nahi karta** — bas naye rukk jaayenge.

---

## 89. DELETE /promoCodes/delete/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Promo code deleted successfully",
  "data": { "deletedPromoCodeId": "68f1a2b3c4d5e6f7a8b9q001", "code": "MONSOON20" }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Promo code not found` |
| `422` | `Invalid promo code id` |

### ⚠️ Notes

**1. Soft delete + auto-deactivate** — `isDeleted: true` **aur** `isActive: false` dono set hote hain.

**2. Hard delete kabhi nahi hota** — service comment: *"`PromoCodeUsage` rows reference it, and those are the discount ledger."* Reports ke liye history zaruri hai.

**3. Sirf list se hatane ke liye hai.** Code band karna ho to `isActive: false` (#88) kaafi hai — wo checkout pe reject kar dega aur reports me code dikhta rahega.

---

# Payment APIs

Admin vendor ke liye checkout drive kar sakta hai — jaise phone pe support dete waqt.

⚠️ **Admin ko `brandId` mandatory hai** in sab pe.

## 90. POST /transactions/subscribe/preview

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `subscriptionId` | ObjectId | ✅ | Plan |
| `brandId` | ObjectId | ⚠️ | **Admin ke liye required** |
| `promoCode` | string | ❌ | Max 40, auto-uppercase |
| `email` · `whatsappNumber` | string | ❌ | |

> ⚠️ **`amount` field jaanbujh kar nahi hai** — server-side compute hota hai.

```json
{ "brandId": "68f1a2b3c4d5e6f7a8b9c3a1", "subscriptionId": "68f1a2b3c4d5e6f7a8b9k002", "promoCode": "MONSOON20" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Subscription checkout preview fetched successfully",
  "data": {
    "brand": { "_id": "…", "brandName": "cafe mocha", "isApproved": false },
    "plan": { "_id": "…", "name": "PREMIUM", "type": "MONTHLY", "typeLabel": "Monthly", "price": 2999, "entitlements": { } },
    "action": "UPGRADE",
    "currentPlan": { "name": "BASIC", "endDate": "2026-09-21T23:59:59.000Z" },
    "validity": { "startDate": "2026-08-23T00:00:00.000Z", "endDate": "2026-09-22T23:59:59.000Z", "durationLabel": "1 month" },
    "billingDetails": { "brandName": "…", "address": "…", "gstin": "23AABCM1234K1ZP", "pan": "AABCM1234K", "addressSource": "BRAND_LOCATION" },
    "pricing": {
      "originalPrice": 3999,
      "discount": 1000,
      "promoDiscount": 600,
      "taxableValue": 2399,
      "taxType": "CGST_SGST",
      "gstPercentage": 18,
      "cgst": 215.91, "sgst": 215.91, "igst": 0,
      "taxAmount": 431.82,
      "totalPayable": 2830.82,
      "amountInPaise": 283082,
      "currency": "INR",
      "currencySymbol": "₹",
      "youSaved": 1600
    },
    "orderSummary": {
      "rows": [
        { "key": "ORIGINAL_PRICE", "label": "Original Price", "amount": 3999, "display": "₹3,999.00" },
        { "key": "DISCOUNT", "label": "Discount (25%)", "amount": -1000, "display": "- ₹1,000.00" },
        { "key": "PROMO_DISCOUNT", "label": "Promo code (MONSOON20)", "amount": -600, "display": "- ₹600.00" },
        { "key": "BILL_VALUE", "label": "Bill Value", "amount": 2399, "display": "₹2,399.00" },
        { "key": "TAX", "label": "CGST (9%)", "amount": 215.91, "display": "₹215.91" },
        { "key": "TAX", "label": "SGST (9%)", "amount": 215.91, "display": "₹215.91" }
      ],
      "payable": { "label": "You'll Pay", "amount": 2830.82, "display": "₹2,830.82" },
      "youSaved": 1600,
      "savedText": "You saved ₹1,600.00 on This Plan"
    },
    "limits": { "subBrands": { "used": 3, "limit": 10, "isUnlimited": false, "overflowBy": 0 } },
    "promo": {
      "supported": true,
      "applied": { "code": "MONSOON20", "description": "Monsoon campaign — 20% off up to ₹1,000", "discount": 600 },
      "message": "Promo code MONSOON20 applied"
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
| `422` | `Subscription plan "PREMIUM" has no duration configured. Please contact support.` | |
| `422` | `brandId is required when acting as an admin` | ⚠️ **Admin-specific** |
| `404` | `Brand not found!` | |

### ⚠️ Notes

**1. Read-only** — safe to call repeatedly, koi Razorpay call nahi.

**2. `promo.message` rejection reason batata hai** — code fail ho to `PROMO_REJECTION` ka specific message aata hai (`"This promo code has expired."` etc.), generic "invalid" nahi.

**3. `canProceed: false` pe `blockedReason` dikhayein** — jaise downgrade policy.

**4. Admin ke liye downgrade allowed ho sakta hai** (`allowAdminDowngrade: true` default) jabki vendor ke liye nahi (`allowVendorDowngrade: false`).

---

## 91. POST /transactions/subscribe/create-order

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN + ownership**

### Body
Same as #90.

### Success — `200`
```json
{
  "success": true,
  "message": "Subscribe transaction order created successfully",
  "data": {
    "transaction": { "_id": "68f1a2b3c4d5e6f7a8b9m003", "razorpayOrderId": "order_PxYzGhI789", "status": "created", "verified": false },
    "plan": { "name": "PREMIUM" },
    "pricing": { "totalPayable": 2830.82, "amountInPaise": 283082 },
    "orderSummary": { "rows": [ ], "payable": { "amount": 2830.82 } },
    "billingDetails": { },
    "razorpay": { "orderId": "order_PxYzGhI789", "amount": 283082, "currency": "INR", "keyId": "rzp_test_XXXX" },
    "reused": false
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | *(preview ka `blockedReason`)* | `canProceed: false` |
| `422` | `This plan has no payable amount. An admin can grant it directly instead.` | ₹0 plan — **`/subscribeds/admin/grant` use karein** |
| `503` | `Razorpay services unavailable! Please try again later` | |
| `422` | `brandId is required when acting as an admin` | |

### ⚠️ Notes

**1. History me `source: ADMIN_PAYMENT` record hota hai** jab admin drive kare (vendor ke liye `PAYMENT`).

**2. `reused: true`** — same brand+plan ka open order 15 min ke andar ho to wahi wapas milta hai.

**3. ₹0 plan pe `422`** — free plan ke liye `POST /subscribeds/admin/grant` (#76).

---

## 92. POST /transactions/subscribe/verify-transaction

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Body
| Field | Type | Required |
|---|---|---|
| `razorpayPaymentId` | string | ✅ |
| `razorpayOrderId` | string | ✅ |
| `razorpaySignature` | string | ✅ |
| `transactionId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Payment successful! Congratulations — your subscription has been successfully activated",
  "data": {
    "alreadyVerified": false,
    "transaction": { "_id": "…", "status": "captured", "verified": true, "invoiceSnapshot": { "invoiceId": "TDI-2026-000453", "invoiceUrl": "…" } },
    "subscribed": { "_id": "…", "status": "ACTIVE", "source": "ADMIN_PAYMENT", "endDate": "2026-09-22T23:59:59.000Z" },
    "action": "UPGRADE",
    "usage": { "subBrands": { "used": 3, "limit": 10, "isUnlimited": false, "overflowBy": 0 } }
  }
}
```
> Replay pe: `"This payment has already been verified. Your subscription is active."` + `alreadyVerified: true`

### Errors
| Status | Message |
|---|---|
| `404` | `Transaction not found!` |
| `422` | `This transaction was not created through Razorpay.` |
| `422` | `This payment does not belong to the given transaction.` |
| `403` | `You are not authorized to verify this payment request` |
| `400` | `Invalid signature. Payment may be tampered.` |
| `503` | `Razorpay services unavailable! Please try again later` |

### ⚠️ Notes
**1. Idempotent** — webhook aur ye endpoint dono settle kar sakte hain, jo pehle aaye wahi jeetta hai.
**2. Optional hai** — webhook activation guarantee karta hai.

---

## 93. POST /transactions/invoice/regenerate

**Access:** Intended: Vendor + Admin · Enforced: **VENDOR+ADMIN**

### Body
| Field | Type | Required |
|---|---|---|
| `transactionId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Invoice re-issued successfully",
  "data": {
    "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
    "invoice": { "invoiceId": "TDI-2026-000451", "invoiceUrl": "https://res.cloudinary.com/…/TDI-2026-000451.pdf", "issuedAt": "2026-08-23T01:00:00.000Z" },
    "wasBackfilled": false
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Transaction not found!` / `Brand not found!` | |
| `403` | `Forbidden: You do not have permission to access this invoice.` | ⚠️ **Admin pe nahi aata** — admin koi bhi invoice le sakta hai |
| `422` | `This transaction has no completed payment, so there is no invoice to issue.` | Unpaid order |
| `422` | `This transaction has no stored pricing breakdown, so its invoice cannot be rebuilt.` | Purana transaction |

### ⚠️ Notes
**1. Amounts kabhi recompute nahi hote** — frozen pricing se banta hai. Purana invoice exactly wahi dikhata hai jo charge hua tha.
**2. `wasBackfilled: true`** — snapshot pehle nahi tha, pricing se reconstruct hua.
**3. Admin ownership check se exempt hai.**

---

# Webhook & Dispute APIs

Razorpay webhook receiver + admin operations. **Ye payment reliability ka backbone hai.**

### Kyun zaruri hai

`constants/webhook.js` ka comment:
> *"Payment verification used to be client-driven only: if the vendor closed the tab between paying and the browser calling back, the money was captured and no plan was ever activated. The webhook closes that hole."*

Aur admin ops kyun:
> *"Deliveries were already stored but invisible outside the database, so a FAILED event (money captured, plan not live, and Razorpay will not retry once it has our 200) could sit unnoticed."*

## 94. POST /transactions/webhook/razorpay · POST /transactions/webhook/razorpay/customer

🔴 **Public endpoints — Razorpay ke liye.** Admin panel inhe **kabhi call nahi karega**; documentation ke liye hain.

### ⚠️ Do endpoint, do account

| Route | Razorpay account | Kya aata hai | Secrets |
|---|---|---|---|
| `/transactions/webhook/razorpay` | **VENDOR** | Vendor subscription payments | `RAZORPAY_WEBHOOK_SECRETS` |
| `/transactions/webhook/razorpay/customer` 🆕 | **CUSTOMER** | Customer voucher claims | `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS` |

Dono ka body, headers aur behaviour bilkul ek jaisa hai. Farq sirf itna: **account route se tay hota hai, signature se nahi.**

Ye jaan-boojh kar hai. Agar account us secret se derive hota jisne verify kiya, to kabhi dono dashboard par ek hi secret set ho jaane par **har customer payment vendor lookup me chali jaati** — aur wo lookup galat merchant se "payment not found" leke aati. Signature sirf ye batata hai ki delivery asli hai; wo kiska paisa hai, ye endpoint batata hai.

**Galat endpoint par aayi delivery phir bhi process hoti hai** — paisa asli hai aur use girana sabse bura option hai — par ek **WARNING alert** ke saath, jisme likha hota hai kaunsa dashboard kaunse URL par point karna chahiye. Chup-chaap kaam karta rehna sabse khatarnaak hai: wo us din tootta hai jis din secrets alag ho jaate hain.

**Access:** Intended: Razorpay · Enforced: **Public (HMAC-verified)**

### Headers
| Header | Required | Notes |
|---|---|---|
| `x-razorpay-signature` | ✅ | Raw body pe HMAC-SHA256 |
| `x-razorpay-event-id` | ❌ | Retries ke across stable |

### Body
Razorpay ka raw event payload.

### Success — `200`
```json
{
  "success": true,
  "message": "Webhook received",
  "data": { "eventId": "evt_PxAbC123", "event": "payment.captured", "status": "PROCESSED", "outcome": "SUBSCRIPTION_ACTIVATED" }
}
```

### ⚠️ Notes

**1. Signature verify hone ke baad hamesha `200`** — chahe kuch bhi ho. Controller comment: *"Razorpay retries on any non-2xx, so an event we cannot act on has to be acknowledged rather than redelivered forever."* Actual outcome `data.status` me hai.

**2. HMAC properly verify hota hai** — `crypto.createHmac("sha256")` raw body pe, aur compare `crypto.timingSafeEqual` se (timing attack safe).

**3. Raw body sirf is route ke liye capture hota hai** — `index.js` me body-parser ke `verify` hook se. Re-serialized JSON signature match nahi karta.

**4. Handled events (10):** `payment.captured` · `order.paid` · `payment.failed` · `refund.processed` · aur 6 dispute events. Baaki `IGNORED` mark hoke store ho jaate hain.

**5. Webhook secrets ab ek *list* hain** — `RAZORPAY_WEBHOOK_SECRETS` aur `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS`, comma-separated. List isliye ki secret **bina downtime** rotate ho sake: naya add karo → dashboard update karo → agle deploy me purana hata do. Har secret try hota hai.

Purana single-value `RAZORPAY_WEBHOOK_SECRET` VENDOR account ke liye **sabse aakhir me** padha jaata hai, taaki upgrade karte hi kuch toote nahi.

Set na ho to har delivery reject hogi — aur ye boot par dikh jaata hai:

```
✅ [pay] VENDOR    test · rzp_test_TKV… · 1 webhook secret(s)
⚪ [pay] CUSTOMER  test · rzp_test_jkS… · NO webhook secret — deliveries will be rejected
```

**6. Reject hui delivery ab record hoti hai** — `status: REJECTED`. Pehle kuch bhi likha nahi jaata tha, yaani galat ya abhi deploy na hue secret par payments capture hoti rehti aur **kahin koi nishan nahi** hota.

Par wo row **body ke hash** par key hoti hai, `x-razorpay-event-id` header par nahi. Wajah: jis delivery ki signature verify nahi hui, uska header **attacker-controlled** hai. Header par key karte to koi bhi ek forged request bhej kar us event-id ko "istemal" kar deta, aur jab Razorpay wahi event-id sahi signature ke saath retry karta to wo `DUPLICATE` mark hokar **kabhi settle hi na hoti**.

Isliye row me: body ka SHA-256, size, pehle 512 bytes ka preview, source IP — **poora payload nahi** (wo unverified input hai). Aur `REJECTED` kabhi replay nahi hoti: unverified payload ko admin ke ek click par process karna us problem se bura hai jise ye theek karne aayi thi.

---

## 95. GET /transactions/webhook/events

Webhook delivery log — **default view FAILED (actionable set)**.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `status` | string | ❌ | ⚠️ **`FAILED`** | WEBHOOK_STATUS enum + `"ALL"` |
| `event` | string | ❌ | – | RAZORPAY_WEBHOOK_EVENTS enum |
| `transactionId` | ObjectId | ❌ | – | |
| `brandId` | ObjectId | ❌ | – | |
| `razorpayOrderId` | string | ❌ | – | |
| `fromDate` · `toDate` | ISO date | ❌ | – | |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Actionable queue (default):**
```http
GET /transactions/webhook/events
```

**Sab kuch:**
```http
GET /transactions/webhook/events?status=ALL&limit=50
```

### Success — `200`
```json
{
  "success": true,
  "message": "Webhook events fetched successfully",
  "data": {
    "total": 3,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9r001",
        "provider": "RAZORPAY",
        "eventId": "evt_PxAbC123",
        "event": "payment.captured",
        "status": "FAILED",
        "outcome": null,
        "error": "Subscription plan for this brand no longer exists.",
        "attempts": 1,
        "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "razorpayOrderId": "order_PxYzAbC123",
        "razorpayPaymentId": "pay_PxYzDeF456",
        "amount": 117882,
        "receivedAt": "2026-08-22T19:05:00.000Z",
        "createdAt": "2026-08-22T19:05:00.000Z"
      }
    ]
  }
}
```

> Empty pe `[]`, 404 nahi.

### Errors
| Status | Message |
|---|---|
| `422` | `status must be one of: RECEIVED, PROCESSED, IGNORED, FAILED, DUPLICATE, ALL` |
| `422` | `Invalid transactionId` / `Invalid brandId` |

### ⚠️ Edge cases & notes

**1. ⚠️ Default `FAILED` hai, `ALL` nahi** — validator comment: *"Omitted defaults to FAILED — the actionable set."* Ye jaanbujh kar hai: admin ko wahi dikhna chahiye jispe kaam karna hai.

**2. `FAILED` ka matlab serious hai** — paisa captured ho chuka hai par plan activate nahi hua. **Razorpay dobara retry nahi karega** kyunki usse `200` mil chuka hai. Sirf manual replay (#97) se recover hoga.

**3. `error` field batata hai kya galat hua** — replay se pehle wo root cause fix karna pad sakta hai (jaise deleted plan restore karna).

**4. `attempts` batata hai kitni baar try hua** — replay pe badhta hai.

**5. Admin ko `WEBHOOK_FAILED` notification bhi jaati hai** (#18 ki admin feed me).

---

## 96. GET /transactions/webhook/events/:eventId

Ek event ka poora detail — **stored payload ke saath**.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required | Validation |
|---|---|---|---|
| `eventId` | string | ✅ | 3–200 chars. ⚠️ **Razorpay ka event id ya hamara `WebhookEvent._id` — dono chalte hain** |

```http
GET /transactions/webhook/events/evt_PxAbC123
GET /transactions/webhook/events/68f1a2b3c4d5e6f7a8b9r001
```

### Success — `200`
```json
{
  "success": true,
  "message": "Webhook event fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9r001",
    "provider": "RAZORPAY",
    "eventId": "evt_PxAbC123",
    "event": "payment.captured",
    "status": "FAILED",
    "outcome": null,
    "error": "Subscription plan for this brand no longer exists.",
    "attempts": 1,
    "transactionId": "68f1a2b3c4d5e6f7a8b9m001",
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "razorpayOrderId": "order_PxYzAbC123",
    "razorpayPaymentId": "pay_PxYzDeF456",
    "amount": 117882,
    "payload": {
      "entity": "event",
      "event": "payment.captured",
      "payload": { "payment": { "entity": { "id": "pay_PxYzDeF456", "amount": 117882, "status": "captured" } } }
    },
    "receivedAt": "2026-08-22T19:05:00.000Z",
    "lastReplayedAt": null,
    "lastReplayedBy": null
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Webhook event not found.` |
| `422` | `eventId is required` |

### ⚠️ Notes

**1. Dono id forms chalte hain** — validator comment: *"Accepts either Razorpay's event id or our own WebhookEvent `_id`, since an admin reading the listing has the latter to hand."*

**2. `payload` poora raw event hai** — replay isi se chalta hai. Debugging ke liye bhi useful.

**3. `lastReplayedAt` / `lastReplayedBy`** batate hain kisne kab replay kiya.

---

## 97. POST /transactions/webhook/replay/:eventId

Stored payload ko dobara process karta hai — **recovery tool**.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `eventId` | string | ✅ | Razorpay id ya `_id` |

### Body
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `force` | boolean | ❌ | `false` | ⚠️ Already-`PROCESSED` event dobara chalane ke liye — *"which is almost always a mistake"* |

```json
{}
```

**Force (rare):**
```json
{ "force": true }
```

### Success — `200` (recovered)
```json
{
  "success": true,
  "message": "Webhook replayed successfully — the delivery now processed cleanly.",
  "data": {
    "eventId": "evt_PxAbC123",
    "event": "payment.captured",
    "replayedBy": "68f1a2b3c4d5e6f7a8b9c000",
    "before": { "status": "FAILED", "outcome": null, "error": "Subscription plan for this brand no longer exists.", "attempts": 1 },
    "after": { "status": "PROCESSED", "outcome": "SUBSCRIPTION_ACTIVATED", "error": null, "attempts": 2 },
    "recovered": true,
    "result": { "subscribedId": "68f1a2b3c4d5e6f7a8b9f001", "action": "NEW" }
  }
}
```

### Success — `200` (already settled)
```json
{
  "success": true,
  "message": "Webhook replayed. See `after.outcome` for what happened.",
  "data": {
    "eventId": "evt_PxAbC123",
    "before": { "status": "FAILED", "attempts": 1 },
    "after": { "status": "PROCESSED", "outcome": "ALREADY_SETTLED", "attempts": 2 },
    "recovered": false,
    "result": { "alreadySettled": true }
  }
}
```

> Message `recovered` flag pe depend karta hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Webhook event not found.` | |
| `422` | `This event has no stored payload, so it cannot be replayed.` | Payload missing |
| `422` | `This event is PROCESSED, not FAILED or IGNORED. Pass force: true if you are certain you want to re-run it.` | Non-replayable status |
| `422` | `Replay failed: <reason>` | Processing phir se fail |

### ⚠️ Edge cases & notes

**1. ✅ Double-activation safe hai.** Route comment: *"Safe twice over: the settlement claims the transaction conditionally, so a replay of something already settled reports that instead of double-activating."*

**2. Sirf `FAILED` aur `IGNORED` replay ho sakte hain** — `force: true` ke bina. `PROCESSED` ka replay pointless hai, `DUPLICATE` ka apna kaam hi nahi tha.

**3. `recovered` flag dekho, `success` nahi** — service comment: *"True when the replay actually changed the outcome, which is what the admin wants to know at a glance."*
- `recovered: true` → `FAILED` se `PROCESSED` ho gaya ✅
- `recovered: false` → kuch nahi badla, `after.outcome` dekho

**4. `before` / `after` diff dikhata hai** kya badla.

**5. Root cause pehle fix karein** — agar `error` "plan no longer exists" kehta hai, to plan restore karke phir replay karein, warna wahi error dobara aayega.

**6. `attempts` badhta hai** har replay pe.

---

## 98. GET /transactions/disputes

Chargebacks — **deadline-first worklist**.

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` | limit max 100 |
| `status` | string | ❌ | – | DISPUTE_STATUS enum |
| `resolved` | boolean\|string | ❌ | ⚠️ **omit = sirf unresolved** | `true` / `false` |
| `brandId` | ObjectId | ❌ | – | |
| `sortOrder` | string | ❌ | – | `asc` \| `desc` |

**Actionable worklist (default):**
```http
GET /transactions/disputes
```

**Action required only:**
```http
GET /transactions/disputes?status=ACTION_REQUIRED
```

### Success — `200`
```json
{
  "success": true,
  "message": "Disputes fetched successfully",
  "data": {
    "total": 2,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9m001",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "brand": { "_id": "…", "brandName": "cafe mocha", "uniqueId": "TDB000078" },
        "razorpayPaymentId": "pay_PxYzDeF456",
        "razorpayOrderId": "order_PxYzAbC123",
        "amount": 117882,
        "dispute": {
          "id": "disp_PxQrS789",
          "status": "ACTION_REQUIRED",
          "reasonCode": "product_not_received",
          "amount": 117882,
          "respondBy": "2026-08-30T23:59:59.000Z",
          "raisedAt": "2026-08-22T18:00:00.000Z"
        },
        "disputeResolved": false,
        "createdAt": "2026-08-22T00:00:05.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message |
|---|---|
| `422` | `status must be one of: OPEN, UNDER_REVIEW, ACTION_REQUIRED, WON, LOST, CLOSED` |
| `422` | `Invalid brandId` |

### ⚠️ Edge cases & notes

**1. ⚠️ Ye report nahi, worklist hai.** Route comment: *"Chargebacks, soonest response deadline first. Missing the deadline forfeits the money automatically, so this is a worklist rather than a report."*

**2. Default view sirf unresolved dikhata hai** — `resolved` omit karne pe.

**3. `dispute.respondBy` **hard deadline** hai** — miss karne pe paisa **automatically** chala jaata hai. Admin panel me ise prominently dikhayein, aur near-deadline pe highlight karein.

**4. Response Razorpay dashboard se dena hota hai** — ye endpoint sirf visibility deta hai, dispute contest karne ka API nahi hai.

**5. Status flow:** `OPEN` → `UNDER_REVIEW` / `ACTION_REQUIRED` → `WON` / `LOST` / `CLOSED`. Sab webhook events se update hote hain.

**6. Admin ko `PAYMENT_DISPUTED` notification bhi jaati hai** (severity `CRITICAL`).

**7. Dispute lose hone pe** subscription cancel karna pad sakta hai — `PUT /subscribeds/admin/cancel` (#77).

---

# Settings APIs

Platform-wide configuration. **Ek singleton document.**

## 99. GET /settings/get

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Success — `200`
```json
{
  "success": true,
  "message": "Setting fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9s001",
    "vendor": {
      "voucher": { "maxOffers": 10, "maxImages": 5, "maxDistanceKm": 25 },
      "showcase": {
        "maxSections": 5,
        "maxItemsPerSection": 15,
        "maxImagesPerSection": 15,
        "maxVideosPerSection": 5,
        "maxImageSizeMB": 10,
        "maxVideoSizeMB": 50,
        "allowedImages": ["image/jpeg", "image/jpg", "image/png", "image/webp"],
        "allowedVideos": ["video/mp4", "video/webm", "video/quicktime"],
        "isActive": true
      },
      "subscription": {
        "gstPercentage": 18,
        "isGstInclusive": false,
        "currency": "INR",
        "hsnSacCode": "998315",
        "companyName": "Trydood",
        "companyGstin": "",
        "companyAddress": "",
        "companyStateCode": "",
        "companyState": "",
        "allowVendorUpgrade": true,
        "allowVendorDowngrade": false,
        "allowVendorRenewal": true,
        "allowAdminDowngrade": true,
        "allowAdminFreeGrant": true,
        "gracePeriodDays": 0,
        "pendingOrderReuseMinutes": 15,
        "expiryJobIntervalMinutes": 60,
        "isPromoCodeEnabled": false,
        "expiryReminderDays": [7, 3, 1],
        "reminderJobIntervalMinutes": 180,
        "isEmailNotificationEnabled": true,
        "isPushNotificationEnabled": true,
        "isWhatsAppNotificationEnabled": false,
        "isActive": true
      }
    },
    "customer": {
      "convenienceFee": {
        "isEnabled": true,
        "slabSize": 500,
        "feePerSlab": 5,
        "maxFee": 50,
        "chargeWhenNoOffer": false
      },
      "tax": {
        "isGstEnabled": false,
        "gstPercentage": 18,
        "isGstInclusive": true,
        "sacCode": "998599"
      },
      "promoCode": {
        "isEnabled": false,
        "allowWhenNoOffer": false,
        "allowForGuestPreview": true
      },
      "claim": {
        "isEnabled": true,
        "allowWhenNoOffer": true,
        "maxBillAmount": 100000,
        "pendingOrderReuseMinutes": 10,
        "quoteTtlMinutes": 30,
        "allowWhenVendorPlanExpired": false,
        "vendorPlanExpiredGraceDays": 0,
        "redemptionWindowHours": 24
      },
      "notification": {
        "isEmailNotificationEnabled": true,
        "isPushNotificationEnabled": true,
        "isWhatsAppNotificationEnabled": false
      },
      "invoice": { "seriesPrefix": "VCH" },
      "settlement": {
        "isEnabled": true,
        "delayDays": 3,
        "payoutBufferHours": 6,
        "cycleType": "DAILY",
        "requiresAdminApproval": true,
        "minPayoutAmount": 100,
        "payoutProvider": "MANUAL_BANK",
        "commissionPercent": 0,
        "reserve": {
          "isEnabled": false,
          "percent": 5,
          "holdDays": 30,
          "riskChargebackCount": 2
        },
        "newVendorReserveDays": 0,
        "notReceivedAlertHours": 96,
        "gatewayFeeBearer": "PLATFORM"
      },
      "refund": {
        "method": "SOURCE",
        "windowHours": 24,
        "vendorApprovalHours": 24,
        "adminBufferHours": 12,
        "onVendorTimeout": "ESCALATE",
        "allowPartial": true,
        "releasePromoOnRefund": false,
        "authorizedAlertMinutes": 30
      },
      "chargeback": { "writeOffDays": 90 }
    },
    "isActive": true,
    "updatedAt": "2026-08-01T00:00:00.000Z"
  }
}
```

> ⚠️ **Purane document me `customer` khali `{}` bhi ho sakta hai.** Mongoose default sirf **write** par lagta hai, isliye jo block doc banne ke baad add hua wo stored nahi hoga. Padhne wala har flow `helpers/settings/getCustomerConfig.js` se jaata hai, jo `constants/customer.js` se fallback bhar deta hai — to reads hamesha poore rehte hain chahe stored doc adhoora ho.

### Errors
Sirf [common auth errors](#common-errors) + `403` role check.

---

## 100. PUT /settings/update

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Body — **partial merge**, kam se kam ek field
| Block | Fields |
|---|---|
| `vendor.voucher` | `maxOffers` (1–100) · `maxImages` (≥1) · `maxDistanceKm` (≥1) |
| `vendor.showcase` | `maxSections` · `maxItemsPerSection` · `maxImagesPerSection` · `maxVideosPerSection` · `maxImageSizeMB` · `maxVideoSizeMB` (sab ≥1) · `allowedImages[]` · `allowedVideos[]` (min 1 item) · `isActive` |
| `vendor.subscription` | Niche full table |
| `customer` | Niche full table — **naya**, pehle pahunch me hi nahi tha |
| `admin.notification` | 🆕 `isEmailNotificationEnabled` · `isPushNotificationEnabled` · `isWhatsAppNotificationEnabled` |
| `app` | 🆕 `minVersion` · `latestVersion` · `support` · `features` — niche |
| `isActive` | boolean |

### 🆕 `app` — mobile app ka force-update aur support contact

```json
{
  "app": {
    "minVersion":    { "android": "1.4.0", "ios": "1.4.0" },
    "latestVersion": { "android": "1.6.2", "ios": "1.6.1" },
    "support":  { "email": "help@trydood.com", "phone": "18001234567", "whatsapp": "919876543210" },
    "features": { "promoCodes": true, "refunds": true, "voucherClaims": true, "search": true }
  }
}
```

Yahi block **`GET /app-config`** padhta hai — wo public hai, token ke bina, aur app launch par pehla call hota hai.

> ### 🔴 Ye block yahan hone ki poori wajah
>
> Minimum version pehle bhi `Setting` me tha, par use padhne ka ekmatra raasta `GET /settings/get` tha — jo `isAdmin` hai. Matlab app use padh hi nahi sakti thi: number **build me hardcode** hota tha, aur badalne ke liye wahi update chahiye hota jo wo maang raha hai.
>
> Ab yahan se badla ja sakta hai aur app agle launch par dekh legi — koi release nahi.

⚠️ **`updateRequired` server tay karta hai, app nahi.** Client apna version bhejta hai aur `GET /app-config` jawab deta hai. Do apps me *"kya main minimum se neeche hoon"* likhna do mauke hain `"1.10.0" < "1.9.0"` wali galti karne ke — jo **text me sach hai** — aur wo galti theek un builds me hoti jinhe theek karne ke liye wahi update chahiye jo wo maang rahe hain.

⚠️ **`features` display flags hain, gate nahi.** Inhe `false` karne se endpoint band nahi hota — app us tab/button ko chhupa deti hai. Asli gate `customer.promoCode.isEnabled` jaise blocks me hai. Dono ko ek samajhna matlab ek feature UI se gayab par API par khula.

⚠️ `GET /app-config` **whitelist** se banta hai, `Setting` minus kuch nahi. Wahi document commission, reserve rate, settlement timing aur gateway-fee bearer bhi rakhta hai — ek spread us line par bilkul normal dikhta aur platform ki economics public kar deta.

### 🆕 `admin.notification` — admin audience ke apne channels

```json
{
  "admin": {
    "notification": {
      "isEmailNotificationEnabled": false,
      "maxRecipientsPerDispatch": 10000
    }
  }
}
```

Merged hai, replaced nahi — ek flag PATCH karne se baaki waise hi rehte hain.

### 🆕 `maxRecipientsPerDispatch` — ek broadcast kitne logon tak ja sakta hai

Default **5000**. `POST /notifications/broadcast` isse bada audience resolve kare
to **`422`** deta hai:

> This audience resolves to more than 5000 recipients, which is the limit for a
> single dispatch. Narrow the target, raise
> `admin.notification.maxRecipientsPerDispatch` in settings, or send it as a
> background job.

⚠️ **Ye refusal hai, truncation nahi.** Pehle 5000 ko bhejkar baaki chhod dena
sabse bura outcome hai: bhejne wale ko lagta hai sab tak pahunch gaya, aur kisi ko
pata bhi nahi chalta ki nahi pahuncha.

⚠️ **Message me "more than" likha hai, exact ginti nahi** — aur wo jaan-boojh kar
hai. Audience resolve karte waqt sirf `cap + 1` rows fetch hoti hain, theek isliye
ki poori ginti karni hi na pade. Exact number likhne par cap `1` set karne wale
admin ko *"2 recipients"* dikhta tha; wo `2` karta to phir fail hota, ab
*"3 recipients"* kehkar. Jo pata hai wahi bolna sahi hai.

⚠️ **Number badhana broadcast ko sasta nahi banata.** Har recipient ek row hai jo
likhi jaati hai aur ek push jo queue hota hai, aur FCM abhi bhi 500 token per
batch leta hai. Kuch hazaar se upar ye background job ka kaam hai — refusal ka
message yahi kehta hai.

`min: 1` hai. `0` har broadcast ko rok deta, ek naamzad recipient wale ko bhi.

⚠️ `getAdminConfig` ise `??` se padhta hai, `||` se nahi — warna configured `0`
chup-chaap `5000` ban jaata, wahi jaal jo `CLAUDE.md` `settlement.delayDays` ke
liye likhta hai.

### 🔴 Pehle ye block pahunch me hi nahi tha

`getNotificationConfig(audience)` ka branch *"customer? … warna vendor"* tha, aur
**admin `warna` me gir jaata tha**. Matlab `vendor.subscription.isEmailNotificationEnabled`
off karne se admin ki `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` aur har wo alert
bhi band ho jaati thi jo paisa galat hone par kisi insaan tak pahunchne ke liye
hai — aur kuch bola nahi jaata tha, kyunki in-app rows waise hi aati rehti thi.

Ab teen audience, teen block, koi kisi ko chup nahi kara sakta.

### ⚠️ Ye outage ka kill switch hai, preference nahi

Defaults **on** hain aur on hi rehne chahiye — email `true`, push `true`, WhatsApp
`false` (Meta template pending). Jis admin ko personally kam email chahiye uske
paas `PUT /notifications/preferences` hai, jo sirf **use** chup karti hai, poori
team ko nahi.

⚠️ Live `Setting` document me ye field abhi **physically hai hi nahi** — wo iske
add hone se pehle likha gaya tha. Mongoose read par defaults hydrate kar deta hai,
isliye `GET /settings` me block **dikhta hai** aur delivery bhi sahi chalti hai;
DB me row pehli write par banti hai. Koi migration nahi chahiye.

### `vendor.subscription` fields

**Tax & seller identity**
| Field | Type | Validation | Notes |
|---|---|---|---|
| `gstPercentage` | number | 0–100 | |
| `isGstInclusive` | boolean | – | `false` = GST price ke upar |
| `hsnSacCode` | string | Max 20 | |
| `companyName` | string | Max 160 | |
| `companyGstin` | string | Max 15, uppercase, `""` allowed | |
| `companyAddress` | string | Max 500, `""` allowed | |
| `companyStateCode` | string | `/^\d{2}$/`, `""` allowed | ⚠️ **Khali = sab IGST** |
| `companyState` | string | Max 80, `""` allowed | |
| `currency` | string | Sirf `"INR"` | |

**Policy flags**
| Field | Default | Kya control karta hai |
|---|---|---|
| `allowVendorUpgrade` | `true` | Vendor khud upgrade kar sakta hai |
| `allowVendorDowngrade` | `false` | ⚠️ Vendor self-downgrade |
| `allowVendorRenewal` | `true` | Vendor khud renew |
| `allowAdminDowngrade` | `true` | Admin downgrade kar sakta hai |
| `allowAdminFreeGrant` | `true` | ⚠️ `POST /subscribeds/admin/grant` gate karta hai |
| `gracePeriodDays` | `0` | 0–90 |

**Timing**
| Field | Default | Validation |
|---|---|---|
| `pendingOrderReuseMinutes` | `15` | 0–1440 |
| `expiryJobIntervalMinutes` | `60` | 1–1440 |
| `reminderJobIntervalMinutes` | `180` | 1–1440 |
| `expiryReminderDays` | `[7, 3, 1]` | Array of 1–365, **1–6 items** |

**Feature & channel switches**
| Field | Default | Notes |
|---|---|---|
| `isPromoCodeEnabled` | `false` | ⚠️ **Promo codes off hain by default** |
| `isEmailNotificationEnabled` | `true` | |
| `isPushNotificationEnabled` | `true` | Kill switch — FCM credentials na ho to waise bhi nahi jaayega |
| `isWhatsAppNotificationEnabled` | `false` | ⚠️ Meta template approval + `WHATSAPP_TEMPLATE_*` env chahiye |

**GST setup (intra-state CGST+SGST enable karne ke liye):**
```json
{
  "vendor": {
    "subscription": {
      "companyStateCode": "23",
      "companyState": "Madhya Pradesh",
      "companyGstin": "23AAACT1234A1Z5",
      "companyAddress": "Trydood HQ, Vijay Nagar, Indore, MP 452010",
      "companyName": "Trydood Technologies Pvt Ltd"
    }
  }
}
```

**Promo codes on:**
```json
{ "vendor": { "subscription": { "isPromoCodeEnabled": true } } }
```

**Showcase limits badhana:**
```json
{ "vendor": { "showcase": { "maxSections": 10, "maxVideosPerSection": 8 } } }
```

---

### `customer` fields — **naya block**

> ⚠️ **Pehle ye poora tree API se pahunch me tha hi nahi.** Model me `customer.convenienceFee` maujood tha, par `validator/settings.js` me koi `customer` object nahi tha aur `stripUnknown` on hai — matlab har request body se ye chup-chaap gir jaata tha aur sirf schema defaults chalte the. Ab poora tree reachable hai.

Har block alag se merge hota hai. Nested block bhi merge hota hai — `settlement.reserve.percent` bhejne par `holdDays` aur `riskChargebackCount` waise hi rehte hain.

**`customer.convenienceFee`** — discounted bill ke upar platform fee
| Field | Default | Validation | Notes |
|---|---|---|---|
| `isEnabled` | `true` | boolean | |
| `slabSize` | `500` | Integer ≥ 1 | Har itne ₹ par ek slab |
| `feePerSlab` | `5` | ≥ 0 | `ceil(bill / slabSize) × feePerSlab` |
| `maxFee` | **`50`** | ≥ 0, ya `null` | ⚠️ Neeche padhein |
| `chargeWhenNoOffer` | `false` | boolean | Offer na lage to fee lagegi ya nahi |

> ⚠️ **`maxFee` ka matlab badla hai.** Pehle default `null` tha — yaani **koi ceiling nahi**, aur ₹10,000 ke bill par ₹100 fee lag jaati. Ab default **50** hai. `null` abhi bhi accept hota hai aur abhi bhi "no ceiling" hi matlab rakhta hai, par ab wo **jaan-boojh kar chunna** padta hai, setting ko kabhi na chhoo kar mil nahi jaata.

**`customer.tax`** — convenience fee par GST (Trydood ki apni service income)
| Field | Default | Validation |
|---|---|---|
| `isGstEnabled` | **`false`** | boolean — master switch |
| `gstPercentage` | `18` | 0–100 |
| `isGstInclusive` | **`true`** | `true` = slab amount me tax shamil hai aur back-calculate hota hai, isliye switch on karne se customer ka daam nahi badhta |
| `sacCode` | `998599` | Max 20 |

**`customer.promoCode`** — customer-side codes (vendor wale se bilkul alag switch)
| Field | Default | Notes |
|---|---|---|
| `isEnabled` | **`false`** | Off jab tak customer checkout live na ho |
| `allowWhenNoOffer` | `false` | Bina offer ke promo = pura giveaway, koi vendor supply nahi |
| `allowForGuestPreview` | `true` | Guest ko provisional discount; login par dobara validate hota hai |

**`customer.claim`** — claim flow
| Field | Default | Validation | Notes |
|---|---|---|---|
| `isEnabled` | `true` | boolean | Kill switch |
| `allowWhenNoOffer` | `true` | boolean | Bina discount ke bhi bill pay kar sakta hai |
| `maxBillAmount` | `100000` | 1–10000000 | Typo/hostile client ke against guard |
| `pendingOrderReuseMinutes` | `10` | 0–1440 | Khula order dobara diya jaata hai |
| `quoteTtlMinutes` | `30` | 1–1440 | Promo reservation TTL se match karta hai |
| `allowWhenVendorPlanExpired` | `false` | boolean | Lapsed plan par bechna |
| `vendorPlanExpiredGraceDays` | `0` | 0–90 | |
| `redemptionWindowHours` | `24` | 1–8760 | Phase 2 — abhi inert |

**`customer.notification`** — customer channels (vendor ke channels se alag)
| Field | Default | Notes |
|---|---|---|
| `isEmailNotificationEnabled` | `true` | |
| `isPushNotificationEnabled` | `true` | |
| `isWhatsAppNotificationEnabled` | `false` | Meta template approval chahiye |

> Ye jaan-boojh kar `vendor.subscription.is*NotificationEnabled` se share **nahi** kiye gaye — vendor ke renewal reminder band karne se customer ki payment receipt band nahi honi chahiye.

**`customer.invoice`**
| Field | Default | Validation |
|---|---|---|
| `seriesPrefix` | `VCH` | 2–6 letters, sirf `A-Z` |

> ⚠️ **Prefix badalne se naya counter shuru hota hai.** Pehle issue ho chuke invoice apna purana prefix rakhte hain — jo sahi hai, invoice number ek permanent legal reference hai, dobara nahi likha jaata.

**`customer.settlement`** — vendor ko payout
| Field | Default | Validation | Notes |
|---|---|---|---|
| `isEnabled` | `true` | boolean | |
| `delayDays` | `3` | 0–30 | ⚠️ T+N — golden rule dekhein |
| `payoutBufferHours` | `6` | 0–168 | Paisa bank me aane ke baad ka buffer |
| `cycleType` | `DAILY` | `DAILY` \| `WEEKLY` | |
| `requiresAdminApproval` | `true` | boolean | `false` = auto-approve |
| `minPayoutAmount` | `100` | ≥ 0 | Isse kam → carry forward |
| `payoutProvider` | `MANUAL_BANK` | `MANUAL_BANK` \| `RAZORPAY_X` \| `RAZORPAY_ROUTE` | Abhi manual NEFT |
| `commissionPercent` | **`0`** | 0–100 | Structure ready, rate zero |
| `reserve.isEnabled` | `false` | boolean | Risky vendor ka withheld slice |
| `reserve.percent` | `5` | 0–100 | |
| `reserve.holdDays` | `30` | 0–365 | |
| `reserve.riskChargebackCount` | `2` | ≥ 1 | Itne chargeback → reserve on |
| `newVendorReserveDays` | `0` | 0–365 | |
| `notReceivedAlertHours` | `96` | 1–720 | |
| `gatewayFeeBearer` | `PLATFORM` | `PLATFORM` \| `VENDOR` \| `SHARED` | Razorpay MDR kaun uthaye |

**`customer.refund`**
| Field | Default | Validation | Notes |
|---|---|---|---|
| `method` | `SOURCE` | `SOURCE` \| `MANUAL_BANK` | Usi card/UPI par wapas |
| `windowHours` | `24` | 0–720 | ⚠️ Golden rule |
| `vendorApprovalHours` | `24` | 0–720 | ⚠️ Golden rule |
| `adminBufferHours` | `12` | 0–720 | ⚠️ Golden rule |
| `onVendorTimeout` | `ESCALATE` | `ESCALATE` \| `AUTO_APPROVE` | |
| `allowPartial` | `true` | boolean | |
| `releasePromoOnRefund` | **`false`** | boolean | Promo slot wapas nahi — warna claim+refund se single-use code recycle ho jaata |
| `authorizedAlertMinutes` | `30` | 1–1440 | Authorized par atki payment |

**`customer.chargeback`**
| Field | Default | Validation |
|---|---|---|
| `writeOffDays` | `90` | 1–365 |

**`customer.search`** 🆕 — customer home screen ka global search box
| Field | Default | Validation | Kya karta hai |
|---|---|---|---|
| `isEnabled` | `true` | boolean | Kill switch. Neeche dekhein — 404 nahi deta |
| `minQueryLength` | `2` | 1–10 | Isse chhoti query pe `422` |
| `sectionLimit` | `5` | 1–20 | `GET /search` me per-section rows |
| `historyLimit` | `20` | 1–100 | Ek customer ki kitni recent searches rakhni hain |
| `popularQueries` | `[]` | max 10, har ek max 100 chars | Search box ki curated chips |

```json
{ "customer": { "search": { "popularQueries": ["pizza", "salon", "weekend offers"] } } }
```

⚠️ **`popularQueries` traffic se nahi banti.** Customer kya search karta hai wo kahin log
hi nahi hota — ye list poori tarah aapki hai. Khaali chhodna valid hai aur uska matlab
sirf itna hai ki app koi chip nahi dikhayegi (koi `.min(1)` nahi hai, unlike alert wale
arrays).

⚠️ **`isEnabled: false` search band karta hai, endpoint nahi.** `GET /search` phir bhi
`200` deta hai — `isEnabled: false`, khaali `sections`. `404` ya `503` dena app ke
generic error handler tak pahunch jaata aur customer ko "kuch toot gaya" screen milti,
jabki aapne sirf ek switch band kiya tha.

⚠️ **`minQueryLength` yahin se aata hai, Joi se nahi.** Joi schema require ke waqt ek baar
banti hai, to usme value bake karne se aapka har baad ka badlaav chup-chaap ignore ho
jaata. Service har request par ye setting padhti hai.

### ⚠️ Golden rule — ek 422 jo aapko milega

```
settlement.delayDays × 24  ≥  refund.windowHours + vendorApprovalHours + adminBufferHours
```

Default: **72h ≥ 24 + 24 + 12 = 60h** ✓

Jab tak ye sach hai, **koi refund kabhi aise paise ko nahi chhoo sakta jo vendor ko ja chuka ho** — refund bas us cycle ka payable kam karta hai. Ye toot gaya to platform aise vendor se paisa recover kar raha hoga jo wo bank me daal chuka hai; ye galti aaj error banke nahi, hafton baad reconciliation bigaad ke saamne aati hai.

**Ye rule *merged* document par chalta hai, aapki request body par nahi.** Aur yahi is design ka point hai: `{ customer: { refund: { windowHours: 48 } } }` bhejne par body me `settlement` block hai hi nahi, to request-shaped validator ke paas compare karne ko kuch hota hi nahi aur rule chup-chaap toot jaata. Isliye ye `services/settings/updateSetting.js` me merge ke **baad**, save se **pehle** chalta hai.

Dono taraf se block hota hai:
- Stored `delayDays` ke upar windows badhana → 422
- Stored windows ke neeche `delayDays` girana → 422

**Aur reject hone par kuch bhi save nahi hota** — save `assertSettlementTimingRule` ke baad hi hota hai.

**Customer config set karna:**
```json
{
  "customer": {
    "convenienceFee": { "feePerSlab": 9, "maxFee": 75 },
    "claim": { "maxBillAmount": 50000 },
    "settlement": { "delayDays": 4, "requiresAdminApproval": true }
  }
}
```

**Sirf ek nested field badalna (baaki reserve fields waise hi rahenge):**
```json
{ "customer": { "settlement": { "reserve": { "percent": 15 } } } }
```

**Search ki chips set karna:**
```json
{ "customer": { "search": { "popularQueries": ["pizza", "spa", "weekend offers"] } } }
```

**Convenience fee band karna:**
```json
{ "customer": { "convenienceFee": { "isEnabled": false } } }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Setting updated successfully",
  "data": { "_id": "…", "vendor": { "subscription": { "isPromoCodeEnabled": true, "gstPercentage": 18 } }, "updatedAt": "2026-08-23T01:30:00.000Z" }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `Please provide at least one field to update.` | Body khali |
| `422` | `companyStateCode must be a 2-digit GST state code` | |
| `422` | `gstPercentage must be at least 0` / `cannot exceed 100` | |
| `422` | `Provide at least one reminder offset` | `expiryReminderDays` khali |
| `422` | `At most 6 reminder offsets are supported` | |
| `422` | `A refund could outlive the settlement it belongs to. Paying out on T+3 gives 72h, but the refund path needs 120h (…). Either raise settlement.delayDays to 5 or shorten the refund windows.` | ⚠️ Golden rule — dono taraf se |
| `422` | `payoutProvider must be one of: MANUAL_BANK, RAZORPAY_X, RAZORPAY_ROUTE` | |
| `422` | `method must be one of: SOURCE, MANUAL_BANK` | `customer.refund.method` |
| `422` | `cycleType must be one of: DAILY, WEEKLY` | |
| `422` | `onVendorTimeout must be one of: ESCALATE, AUTO_APPROVE` | |
| `422` | `gatewayFeeBearer must be one of: PLATFORM, VENDOR, SHARED` | |
| `422` | `slabSize must be at least 1` | |
| `422` | `seriesPrefix may only contain letters` | |
| `403` | `Forbidden: You do not have permission to perform this action.` | Role check |

### ⚠️ Edge cases & notes

**1. Merge hota hai, replace nahi.** Validator comment: *"Merged onto the existing block, so an admin can change just the GST rate without resetting the seller identity and every policy flag."* Sirf jo bhejein wahi badalta hai.

**1b. Nested block bhi merge hota hai.** `customer.settlement.reserve` block ke andar block hai. Mongoose sub-document par `Object.assign` nested path ko **poora replace** kar deta hai, isliye `{ settlement: { reserve: { percent: 15 } } }` bhejne se `holdDays` aur `riskChargebackCount` apne defaults par wapas chale jaate — live schema par verify kiya, 45/3 se 30/2 par reset ho rahe the. `updateSetting.js` ab nested block ko parent assign se pehle alag kar deta hai, to sibling bache rehte hain.

**2. ⚠️ `companyStateCode` khali hai to har supply `IGST` treat hoti hai.** Comment: *"Leave blank and every supply is treated as inter-state."* Intra-state CGST+SGST split ke liye ye set karna zaruri hai — brand ke GSTIN ke pehle 2 digits se compare hota hai.

**3. `isPromoCodeEnabled: false` default hai** — promo codes banane se pehle enable karein, warna checkout `"Promo codes are coming soon"` dikhayega.

**4. `allowAdminFreeGrant: false` karne se `POST /subscribeds/admin/grant` band ho jaata hai** — `403` aayega.

**5. Limits badalne ka asar:**
| Setting | Effect |
|---|---|
| `voucher.maxDistanceKm` | Customer listing radius — **turant** |
| `voucher.maxOffers`/`maxImages` | Naye vouchers pe — turant |
| `showcase.*` | Naye media uploads pe — turant |
| `subscription.gstPercentage` | Naye orders pe — purane invoices unaffected |
| `expiryJobIntervalMinutes` | ⚠️ **Server restart ke baad** — jobs boot pe schedule hote hain |

**6. `isWhatsAppNotificationEnabled` sirf tab `true` karein** jab Meta-approved templates `WHATSAPP_TEMPLATE_*` env vars me set ho — *"without both, nothing sends on WhatsApp."*

**7. Ye singleton hai** — ek hi Setting document hai, koi `id` nahi chahiye.

---

# Legal APIs

Terms & Conditions aur Privacy Policy — dono ke 5-5 endpoints, identical shape.

## 🔴 ⚠️ CRITICAL — create endpoints kaam hi nahi karte

**`POST /terms-and-conditions/create` aur `POST /privacy-and-policies/create` har baar fail hote hain.**

Model `type` ko mandatory maangta hai:
```js
// models/Terms&Condition.js  (aur Privacy&Policy.js)
type: { type: String, required: true, trim: true },
```

Par poori chain me `type` hai hi nahi:
1. Validator me nahi hai
2. Controller Joi ka `value` pass karta hai — `stripUnknown` `type` ko drop kar deta hai chahe caller bheje bhi
3. Service `create()` me `type` set nahi karti

**Result:**
```json
{ "success": false, "message": "Path `type` is required." }
```
*(Mongoose ValidationError → errorHandler `422` me convert kar deta hai)*

**Do aur problems:**
- `description` sirf **300 characters** tak allowed hai — asli terms text ke liye bilkul kam
- `description` service me **lowercase** ho jaata hai — HTML aur formatting destroy

**Admin panel pe impact:** legal content management screen abhi ban nahi sakta. Detail + fix → [security_findings.md](./security_findings.md) #16

---

## 101. POST /terms-and-conditions/create

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅ · ⚠️ **BROKEN**

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `title` | string | ✅ | 3–120 chars |
| `description` | string | ❌ | ⚠️ Max **300** chars, `""` allowed |
| `isActive` | boolean | ❌ | |

### Expected Success — `201`
```json
{
  "success": true,
  "message": "Term and condition created",
  "data": { "_id": "…", "title": "vendor terms of service", "type": "VENDOR", "description": "…", "isActive": true }
}
```

### Actual behaviour — `422` (hamesha)
```json
{ "success": false, "message": "Path `type` is required." }
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | `` Path `type` is required. `` | ⚠️ **Hamesha** |
| `400` | `Term and condition already exist with this title` | Duplicate title *(is error tak pahunchne se pehle hi type fail ho jaata hai)* |
| `422` | `Title has minimum 3 characters` / `cannot exceed 120 characters` | |
| `422` | `Description cannot exceed 300 characters` | |

---

## 102. GET /terms-and-conditions/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default |
|---|---|---|---|
| `page` · `limit` | number | ❌ | `1` / `10` |
| `search` | string | ❌ | – |
| `title` | string | ❌ | – |
| `isActive` | boolean\|string | ❌ | – |
| `fromDate` · `toDate` | ISO date | ❌ | – |
| `sortBy` | string | ❌ | `createdAt` |
| `sortOrder` | string | ❌ | `desc` |

### Success — `200`
```json
{
  "success": true,
  "message": "Terms and conditions fetched",
  "data": {
    "total": 3,
    "totalPages": 1,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c9a1",
        "title": "vendor terms of service",
        "type": "VENDOR",
        "description": "<p>by listing on trydood you agree to...</p>",
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-04-01T00:00:00.000Z"
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

**1. `type` free-form string hai** — `"VENDOR"`, `"CUSTOMER"` jaisi values. **API me `type` filter nahi hai**, to audience-wise filtering client-side karni padegi.

**2. `description` lowercase me aa sakta hai** — service ne create pe lowercase kar diya tha. HTML tags bhi lowercase ho jaate hain (jo valid HTML hai, par content readability chali jaati hai).

**3. Existing records seed/manual insert se aaye honge** — create endpoint kaam nahi karta.

---

## 103. GET /terms-and-conditions/get/:id

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
  "data": { "_id": "…", "title": "vendor terms of service", "type": "VENDOR", "description": "…", "isActive": true }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Term and condition not found` |
| `422` | `Invalid TermAndCondition Id` |

---

## 104. PUT /terms-and-conditions/update/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Body — sab optional
| Field | Type | Validation |
|---|---|---|
| `title` | string | 3–120 chars |
| `description` | string | ⚠️ Max **300** chars |
| `isActive` | boolean | |

### Success — `200`
```json
{ "success": true, "message": "Term and condition updated", "data": { "_id": "…", "title": "vendor terms of service" } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Term and condition not found` |
| `422` | `Description cannot exceed 300 characters` |
| `422` | `Title has minimum 3 characters` |

### ⚠️ Note
⚠️ **Update bhi 300-char cap se bandha hai** aur `type` update nahi ho sakta. Existing records ka `description` badalna practically possible nahi hai (agar wo 300 se bada hai).

---

## 105. DELETE /terms-and-conditions/delete/:id

**Access:** Intended: ADMIN · Enforced: **ADMIN** ✅

### Path Params
| Param | Type | Required |
|---|---|---|
| `id` | ObjectId | ✅ |

### Success — `200`
```json
{ "success": true, "message": "Term and condition deleted", "data": { "_id": "…", "isDeleted": true } }
```

### Errors
| Status | Message |
|---|---|
| `404` | `Term and condition not found` |
| `422` | `Invalid TermAndCondition Id` |

### ⚠️ Note
Soft delete. ⚠️ **Delete karne se pehle sochein** — create endpoint kaam nahi karta, to naya banana possible nahi hoga. `isActive: false` (#104) safer hai.

---

## 106–110. Privacy & Policies

Bilkul same shape as #101–105, sirf path aur messages alag.

| # | Method | Endpoint | Access | Message |
|---|---|---|---|---|
| 106 | POST | `/privacy-and-policies/create` | **ADMIN** ✅ ⚠️ **BROKEN** | `Privacy and policy created` |
| 107 | GET | `/privacy-and-policies/getAll` | Any authenticated | `Privacys and policies fetched` ⚠️ *(typo backend me hai)* |
| 108 | GET | `/privacy-and-policies/get/:id` | Any authenticated | `Privacy and policy fetched` |
| 109 | PUT | `/privacy-and-policies/update/:id` | **ADMIN** ✅ | `Privacy and policy updated` |
| 110 | DELETE | `/privacy-and-policies/delete/:id` | **ADMIN** ✅ | `Privacy and policy deleted` |

### Body / Query
Terms endpoints (#101–105) se **bilkul identical** — `title` (3–120), `description` (max 300, `""` allowed), `isActive`.

### Errors
| Status | Message |
|---|---|
| `422` | `` Path `type` is required. `` ⚠️ **create pe hamesha** |
| `400` | `Privacy and policy already exist with this title` |
| `404` | `Privacy and policy not found` |
| `404` | `No any privacyandpolicy found` — **empty-state** |
| `422` | `Invalid PrivacyAndPolicy Id` |
| `422` | `Description cannot exceed 300 characters` |

### ⚠️ Notes

**1. `POST /privacy-and-policies/create` bhi broken hai** — same `type` issue.

**2. `getAll` ka success message me typo hai** — `"Privacys and policies fetched"`. Message pe match na karein, `success` flag pe karein.

**3. Baaki saare notes terms (#102–105) jaise hi hain.**

---

# Refund APIs 🆕

Grahak maange → **vendor tay kare** → admin nikaale.

> ### Aap normal raaste par doosra gate nahi hain
>
> Vendor pehle hi tay kar chuka; aap sirf paisa chhodte hain. Vendor ki *"na"* ya uski
> chuppi palatna **alag raasta** hai — likhit wajah ke saath, `isOverride: true` se alag
> gina jaata hai. Badhti override dar ka matlab ye **nahi** ki admin udaar hain; matlab
> hai ki upar kahin gadbad hai — koi outlet jo kabhi jawab nahi deta, ya koi voucher jo
> nibhaya nahi ja sakta. Wo number badhe to dekhne ki jagah refund nahi, wo outlet hai.

## GET /refunds — poori list

**Access:** 🔒 `verifyJwtToken` (admin ko scope se sab dikhta hai)

`?open=true` worklist deta hai — **sabse purani upar**. Admin ko poora `split` milta hai:
`platformPromoReversal`, `gatewayFeeAbsorbed`, `commissionReversal` — reconciliation ko
ye chahiye, aur sirf admin ko.

## PATCH /refunds/admin/:requestId/approve

**Access:** 🔒 `isAdmin`

| Se | `overrideReason` | Nateeja |
|---|:-:|---|
| `VENDOR_APPROVED` | — | `ADMIN_APPROVED` |
| `VENDOR_REJECTED` | ✅ **zaroori** | `ADMIN_OVERRIDE` |
| `VENDOR_TIMEOUT` | ✅ **zaroori** | `ADMIN_OVERRIDE` |

Dono halaton me sawaal alag hai — *"outlet ne mana kiya, batayein aap kyun palat rahe
hain"* banaam *"outlet ne jawab nahi diya, batayein aap khud kyun approve kar rahe hain"*.
Aage ke kadam alag hain.

Override par hi grahak ko doosra "approved" jaata hai. Normal raaste par vendor ki approval
pehle hi bata chuki hoti hai, aur ek ghante baad doosra sandesh doosra refund jaisa padha
jaata hai.

## PATCH /refunds/admin/:requestId/reject

`note` **zaroori**. `settlementHold` hattta hai.

## PATCH /refunds/admin/:requestId/pay — paisa bhejo

**Access:** 🔒 `isAdmin` · Body: **kuch nahi** (har figure approval par freeze ho chuka)

### ⚠️ Ye do baar chalana surakshit hai

```
PROCESSING likho + attemptCount++     ← Razorpay call se PEHLE
  → Razorpay se poocho kya pehle se hai  ← sirf retry par
  → payments.refund()                    ← jiska koi undo nahi
  → refund id sahejo
```

Agar process us beech mare jab Razorpay ne refund maan liya par id sahej na paye — row
`PROCESSING` kehti hai, `attemptCount: 1`, koi `razorpayRefundId` nahi. Agli koshish
`payments.fetchMultipleRefund()` se **poochti hai** aur us refund ko apna leti hai. Counter
baad me badhate to wo shunya rehta aur retry grahak ko paisa **do baar** bhej deta.

Match hamare stamp kiye `notes.refundRequestId` par hota hai, **rakam par nahi** — ek hi
rakam ke do partial refunds rakam se alag nahi kiye ja sakte, aur galat wala apnane se ek
asli refund behisaab reh jaata.

Lookup khud fail ho jaye to **`503`** milta hai aur row `PROCESSING` chhod di jaati hai.
Galat hone ka surakshit tareeka yahi hai.

### Jawab do tarah ka hota hai

| Message | Matlab |
|---|---|
| *"Refund sent to Razorpay successfully"* | Naya refund bheja gaya |
| *"This refund had already reached Razorpay; it is now linked and processing"* | Kuch naya nahi bheja — pichhli koshish pahunch chuki thi, ye run ne use apna liya |

### Fail hone par

Row `FAILED` hoti hai par **khuli rehti hai**, aur `settlementHold` **laga rehta hai** —
paisa abhi bhi wapas jaana hai, aur retry yahin se hoti hai. Admin ko **CRITICAL**
notification jaati hai (attempt number par keyed, taaki har nayi nakaami bhi pahunche — wahi
batati hai ki instrument paisa wapas le hi nahi sakta).

`MANUAL_BANK` abhi automate nahi hai — `422` deta hai. Wo Phase S1.5 hai.

---

## Refund settings (`/settings` → `customer.refund`)

| Key | Default | Kya |
|---|---|---|
| `windowHours` | 24 | Payment ke baad kitni der tak maang sakte hain |
| `vendorApprovalHours` | 24 | Vendor ki window |
| `adminBufferHours` | 12 | Aapka buffer |
| `onVendorTimeout` | `ESCALATE` | Ya `AUTO_APPROVE` |
| `allowPartial` | `true` | |
| `releasePromoOnRefund` | `false` | |
| `maxOpenRequests` | 1 | Ek grahak ki ek saath khuli requests |
| `maxRejectedPerWindow` | 3 | **Thukrai/wapas li** — approve hui nahi gintin |
| `requestWindowDays` | 30 | |

> ### ⚠️ Golden rule — save par `422`
>
> ```
> settlementDelayHours >= windowHours + vendorApprovalHours + adminBufferHours
> ```
>
> Jab tak ye sach hai, **koi refund kabhi aise paise ko chhoo hi nahi sakta jo vendor ko
> ja chuka ho.** Ye config me chhodi hui salah nahi — ek galat setting mahine baad jaakar
> hisaab bigaadti hai, isiliye validator use save hi nahi hone deta.

> ### Abuse limits me approve hui refunds **kabhi nahi** gintin
>
> Galat ka sanket rakam nahi, wo hai *"vendor ne dekhkar kaha ki ye jayaz nahi thi"*. Raw
> count rakhne par sabse kharab brand ka grahak sabse pehle block hota — jo sabse zyada
> haqdaar hai. Limit chhoone par jawab support par bhejta hai, raasta band nahi karta, aur
> aap uski taraf se refund khol sakte hain.

---

## Jobs

| Job | Har | Kya |
|---|---|---|
| `escalateStaleRefunds` | 15m | Vendor ki window khatam → aapke paas (ya auto-approve) |
| `reconcileRefunds` | 30m | Jo Razorpay gaye aur laute nahi — **sirf padhta hai** |
| `remindVendorsAboutRefunds` | 60m | Vendor ko do nudges |

⚠️ `reconcileRefunds` gateway par **kabhi nahi likhta**. Refund jaari karna
`/admin/:requestId/pay` ka kaam hai aur uske apne double-payment guards hain; aisa
reconcile jo pay kar sake, paisa bahar jaane ka doosra bina-pahre wala raasta ban jaata.

Teeno ki sehat `GET /transactions/admin/health` par dikhti hai.

---

# Settlements — vendor ka paisa

**Poora flow → [`settlement_flow.md`](./settlement_flow.md).**

> ### Ye raasta **na hoke** fail hota hai
>
> Baaki har money path shor karke fail hota hai: capture na ho to throw, refund na
> jaaye to worklist par `FAILED`. Settlement ke teen failure aise hain jo **kuchh na
> hone jaise dikhte hain** —
>
> | Kya bigda | Kaisa dikhta hai |
> |---|---|
> | build kabhi chali hi nahi | koi settlement nahi; kaagaz par kisi ka kuchh bakaya nahi |
> | NEFT shuru hui, confirm nahi hui | hamesha `PROCESSING`; vendor padhta hai *"on its way"* |
> | payout ne koi ledger row nahi likhi | kitaab kehti hai paisa abhi hamare paas hai, jo ja chuka |
>
> Teeno me kuchh raise nahi hota. Isi liye har ek ke peechhe ek sweep hai jiska kaam
> hi **ghair-maujoodgi dhoondhna** hai.

---

## GET /settlements — poori list

Admin ko har brand ki settlements dikhti hain. Vendor wale se **alag projection** —
poora `bankSnapshot`, `needsRevalidation`, `taintedTransactionIds`, `failureNote`,
`approvedBy`, `idempotencyKey`, `attemptCount`.

| Param | Notes |
|---|---|
| `needsAttention=true` | **Worklist** — flagged / `FAILED` / `ON_HOLD`, aur **sabse purani upar** |
| `open=true` | Jo abhi chal rahe hain |
| `status` · `brandId` · `settlementNumber` · `from` / `to` | |

`canApprove` / `canPay` / `canRetry` response me **bataye** jaate hain. Panel ko status
se andaza nahi lagana chahiye — naya state judte hi wo andaza galat ho jaayega.

---

## PATCH /settlements/admin/:settlementId/approve

Body: `note` (optional). Aur kuchh nahi — rakam build ke waqt compute ho chuki hai, aur
body me rakam lena matlab admin ko wo aankda badalne dena jispar ledger raazi hai.

### Shart update ke **filter** me hai

```js
Settlement.findOneAndUpdate(
  { _id, status: PENDING_APPROVAL, needsRevalidation: { $ne: true } },
  { $set: { status: APPROVED, approvedBy, approvedAt } },
)
```

`if (settlement.needsRevalidation) throw` **kaafi nahi** hota: read aur write ke beech
webhook aa sakta hai. Shart filter me ho to Mongo faisla karta hai, timing nahi.

### `needsRevalidation` kahan se aata hai

02:00 par build hui, 14:00 par payout hoga. Beech me `dispute.created` ya refund aaya
to? Row claim ho chuki hai — `settlementHold` sirf **claim se pehle** ka filter hai aur
ab bekaar hai. Isliye webhook settlement ko flag karta hai
(`needsRevalidation` + `taintedTransactionIds`), aur **approval hi authority hai**.

### Mana karne par naam milte hain

`refuseAndHold` sirf "approve nahi ho sakta" nahi kehta — **kaunse invoice** kharaab
hue, wo ginta hai:

> *"3 claimed payments are no longer eligible: TD/VCH/26-27/000412,
> TD/VCH/26-27/000455, TD/VCH/26-27/000501"*

Ye sirf aapke liye hai. Vendor ko ye naam kabhi nahi jaate.

---

## PATCH /settlements/admin/:settlementId/rebuild

Sirf `ON_HOLD` par. **Sirf tainted rows** chhoote hain; saaf rows claim me hi rehti
hain — warna agli build unhe rebuild ke beech me utha leti aur wahi rows do settlement
me aa jaate.

Rebuild ke baad kuchh na bache (ya `minPayoutAmount` se kam bache) to
`CARRIED_FORWARD` — rows agle cycle me chale jaate hain, kyunki eligibility me
`periodStart` ka koi floor hai hi nahi.

---

## PATCH /settlements/admin/:settlementId/hold · /cancel

`hold` — review ke liye rok dena. `reason` zaroori (staff ke liye). Vendor ko sirf
*"on hold — being checked"* jaata hai, **bina tafseel ke**.

`cancel` — poori settlement radd, har row agle cycle me. `reason` zaroori: kuchh khota
nahi, par vendor ka paisa is click se cycle badalta hai.

---

## PATCH /settlements/admin/:settlementId/pay — NEFT shuru

Body me **kuchh nahi**. Rakam `netPayable` hai, payee frozen `bankSnapshot`.

### Bank dobara compare hota hai

```
frozen bankSnapshot  vs  live Bank record
        │
   badal gaya?  →  ON_HOLD + aapko dono account bataye jaate hain
```

⚠️ **NEFT ka recall nahi hota.** Isi liye ye "warning" nahi, **rok** hai.

### Leg pehle, status baad me

```
PayoutLeg.create({ legNumber: n, status: INITIATED })   ← unique index race jeetta hai
        ↓
transitionSettlement(→ PROCESSING)
```

Beech me crash: `APPROVED` settlement + `INITIATED` leg — dikhta hai, sweep sambhaal
leti hai. Ulta kram `PROCESSING` bina kisi leg ke chhodta, jo padhne me *"paisa nikal
gaya par kahin nahi mila"* jaisa hai.

Double-click ka faisla `(payoutType, settlementId, legNumber)` unique index karta hai —
count nahi, jise do click ek hi value padh lete.

---

## PATCH /settlements/admin/:settlementId/confirm — UTR

| Field | Zaroori | Notes |
|---|:-:|---|
| `utr` | ✅ | Bank reference |
| `mode` | — | `IMPS · NEFT · RTGS · UPI`, default `NEFT` |
| `reference` | — | Na do to `utr` |
| `paidAt` | — | Na do to abhi |

`MANUAL_BANK` ka koi callback nahi — **aadmi hi callback hai**. UTR isi liye zaroori
hai: teen din baad jab vendor kehta hai "paisa nahi aaya", wahi ek cheez bank statement
par dhoondhi ja sakti hai.

`paidAt` isi liye liya jaata hai ki shukrawaar ki NEFT aksar somwaar type hoti hai, aur
ledger entry **jab paisa gaya** us tareekh ki honi chahiye — jab click hui us ki nahi.

### Settlement `PAID` tabhi jab legs jud jaayein

Badi rakam do NEFT me jaana aam hai. Pehli leg par hi `PAID` kar dena matlab settlement
har worklist se gayab aur aadha paisa abhi baaki — vendor ke paas apna bank statement
ginne ke alawa kuchh nahi bachta. Response me `paidSoFar`, `remaining`, `settled`
milte hain.

Par **ledger pehli hi leg par likhta hai**, kyunki wo paisa sach me nikal chuka hai.
Doosri leg ka intezaar karke dono likhna matlab kitaab ye kahti rahe ki wo paisa abhi
hamare paas hai.

---

## PATCH /settlements/admin/:settlementId/fail · /retry

`fail` — `note` zaroori (bank ne kya kaha). Bounce hui leg **rakhi jaati hai, mitayi
nahi**: retry nayi leg banati hai agle number ke saath, to record me dono koshishen
bachti hain — apne UTR aur apne payee ke saath. Pehli ko edit kar dena us baat ko mita
deta ki paisa kabhi us account me bheja gaya tha, jo jaanch me theek wahi cheez chahiye
hoti hai.

⚠️ `FAILED` rows ko **nahi chhodta**. Bounce aam baat hai aur sahi kaam hai account
theek karke **wahi** settlement dobara bhejna — usi number aur usi statement ke saath.

`retry` — nayi leg, aur **taaza `bankSnapshot`**. Bounce ki aam wajah galat account hi
hoti hai, aur usi galat account me dobara bhejna wo ek cheez hai jo pakka kaam nahi
karegi.

---

## PATCH /settlements/admin/:settlementId/reverse

`reason` zaroori. Bank ne `PAID` hone ke baad wapas kheencha.

**Ledger pehle, rows baad me.** Beech me crash: reversal likha hai, rows abhi bhi
claimed — **zyada** dikha raha hai, dikhta hai, theek ho sakta hai. Ulta kram: rows
chhoot gaye bina reversal ke — padhne me *"paisa kabhi gaya hi nahi"*, aur wo rows
**dobara settle** ho jaate.

`isReversal: true` in entries ko once-per-parent index se bahar rakhta hai — warna
safety mechanism hi correction mechanism ko rok deta.

---

## Jobs

| Job | Har | Kya |
|---|---|---|
| `buildSettlements` | 60m | Kal ka cycle. `isEnabled: false` par **wajah ke saath** skip |
| `sweepStalePayouts` | 30m | 6h+ se bina UTR ki leg — **sirf batata hai** |
| `alertLateSettlements` | 60m | `notReceivedAlertHours` se purana bakaya, ek hi alert |
| `reconcileSettlementLedger` | 180m | legs vs ledger — **sirf padhta hai** |
| `sweepAbandonedDrafts` | 60m | Khaali `DRAFT` jiska key period ghere baitha hai |

### `buildSettlements` ghante me, raat me nahi

`buildSettlements` `idempotencyKey` par idempotent hai — usi period me doosra run kuchh
nahi banata. Chhota interval isliye hai ki **jis raat process band tha wo raat agle tick
par apne aap bhar jaaye**, na ki kisi ke dekhne tak us brand ka din chhoota rahe.

### ⚠️ `sweepStalePayouts` batata hai, karta nahi

Ye jaan-boojh kar kuchh **badalta nahi**. Ho sakta hai paisa sach me nikal chuka ho.
Apne aap `FAILED` kar dena matlab ek kaamyaab transfer ke upar *"bank ne mana kiya"*
likh dena, rows agle cycle me chhod dena, aur vendor ko **dobara** paisa de dena.

Kaun sa hua ye sirf wo aadmi jaanta hai jo banking screen dekh sakta hai. Isliye job us
aadmi ko bulaati hai, andaaza nahi lagati.

### `reconcileSettlementLedger` sirf padhta hai

Ledger row kabhi update ya delete nahi hoti — sudhaar **nayi row** hoti hai
`reversalOf` ke saath. Aisa sweep jo apni entries likh sake, kitaab badalne ka doosra
bina-pahre wala raasta ban jaata.

Dono taraf ka fark matter karta hai: **leg hai par entry nahi** matlab kitaab kehti hai
paisa abhi hamare paas hai jo ja chuka; **entry hai par leg nahi** matlab kitaab kehti
hai humne bheja jo nikla hi nahi. Pehla liability kam dikhata hai, doosra zyada, aur
dono tab tak swasth system jaise padhte hain jab tak koi bank statement se milaan na
kare.

### `sweepAbandonedDrafts`

Build shell **pehle** likhti hai aur rows **baad me** claim karti hai. Beech me crash ek
khaali `DRAFT` chhodta hai jiska `idempotencyKey` us period ko ghere baitha hai — agli
build us brand ka din **skip** kar degi, hamesha ke liye, bina kisi error ke.

Sweep use `CANCELLED` karke key `STL:VOID:<id>` kar deti hai. ⚠️ **Sirf khaali draft** —
jo draft rows pakde hue hai wo aadhi-bani build hai, aur uska key void karna un rows ko
aise settlement se bandha chhod dega jo kabhi pay nahi hogi.

---

## Health — `GET /transactions/admin/health`

| Signal | Level | Matlab |
|---|:-:|---|
| `unconfirmedPayouts` | 🔴 **CRITICAL** | 24h+ se bina UTR ki leg — paisa hil chuka, system ko pata nahi |
| `overdueSettlements` | 🟠 ATTENTION | 7 din+ se bakaya — alert ja chuka aur ignore hua |
| `strandedDrafts` | 🟠 ATTENTION | 6h+ purani khaali `DRAFT` — sweep chal nahi rahi |

---

## Settlement settings (`/settings` → `customer.settlement`)

| Key | Default | Kya karta hai |
|---|---|---|
| `isEnabled` | `true` | Band karne par build skip |
| `delayDays` | 3 | T+N floor |
| `payoutBufferHours` | 6 | Paisa hamare bank me aane ke baad extra buffer |
| `cycleType` | `DAILY` | Period ki lambai |
| `requiresAdminApproval` | `true` | Band karne par auto-approve |
| `minPayoutAmount` | 100 | Isse kam → `CARRIED_FORWARD` |
| `payoutProvider` | `MANUAL_BANK` | RazorpayX aane par sirf yeh badlega |
| `commissionPercent` | 0 | Dhaancha hai, rate abhi zero |
| `reserve.*` | off | Risky vendor ka hissa rokna |
| `notReceivedAlertHours` | 96 | Iske baad aapko alert |
| `gatewayFeeBearer` | `PLATFORM` | MDR kaun uthata hai |

> ⚠️ `delayDays` refund ke golden rule se bandha hai —
> `delayDays * 24 >= windowHours + vendorApprovalHours + adminBufferHours`.
> `assertSettlementTimingRule` ise **save par 422** karta hai, comment me salah nahi:
> ek galat setting mahine baad jaakar hisaab bigaadti hai.

---

## Abhi nahi bana

- **Statement PDF** — `documentUrl` / `documentToken` model me hain, generator nahi.
  Vendor abhi `GET /settlements/:id/transactions` se lines padh sakta hai.
- **RazorpayX / Route** — `payoutProvider` aur `PayoutLeg` isi ke liye bane hain.
- **Reserve release** — `reserveHeld` bookta hai, `holdDays` ke baad chhodne wali job
  nahi. Reserve default me off hai.

---

# Reference — endpoints ka baaki hissa

Ye section un endpoints ko cover karta hai jo `scripts/verifyApiCoverage.js` ne **undocumented** pakde the. Har ek collection me maujood hai, saved example ke saath — yahan wo cheezein likhi hain jo example se nahi dikhtin.

## Brands — status aur curation

### `PUT /brands/admin/:brandId/status`

Do alag switch, aur wo ek jaise **nahi** hain:

| Field | Asar |
|---|---|
| `isActive: false` | Brand **band** — vendor bhi andar nahi aa sakta |
| `hideFromCustomers: true` | Sirf listing se hataata hai; vendor kaam karta rehta hai |

⚠️ Dispute ke dauraan aksar **doosra** chahiye hota hai, pehla nahi. Dono ko ek samajhna ek chalte hue brand ko band kar deta hai, aur vendor ko pata bhi nahi chalta ki kyun.

⚠️ `reason` **sirf deactivate karte waqt** accept hota hai — `isActive: true` ke saath bhejne par `422 "A reason is only accepted when deactivating an account"`. Ye jaan-boojh kar hai: wapas chaalu karne ki wajah record me rakhne layak nahi, band karne ki hai.

### `GET /brands/admin/top-brands` · `PUT /brands/admin/top-brands/:brandId`

Home screen par kaunse brands upar aayenge. `PUT` body: `{ isTopBrand, sortOrder, note }`.

⚠️ Ye **editorial** faisla hai, algorithmic nahi. Koi score isse nahi chalata — jo yahan set hoga wahi dikhega, isliye purani entries kisi ko hataye bina baithi rehti hain.

### `GET /vouchers/admin/suggestions` · `PUT /vouchers/admin/suggestions/:voucherId`

Wahi cheez vouchers ke liye — `suggested: true` wale customer feed me upar aate hain.

---

## Refunds — manual bank ka poora raasta

Gateway refund refuse kar de (window band, payment bahut purana), to paisa NEFT se jaata hai. Chaar endpoints, aur **ye ek state machine hai**:

```
ADMIN_APPROVED → request-bank-details → AWAITING_BANK_DETAILS
                 (customer account jodta hai)
               → pay-to-bank          → PROCESSING
               → confirm-bank-payout  → COMPLETED
                 ya fail-bank-payout  → FAILED (wapas khulta hai)
```

| Endpoint | Body | Kya kehta hai |
|---|---|---|
| `PATCH /refunds/admin/:requestId/request-bank-details` | `{ reason }` | "Gateway se nahi ja sakta, account do" |
| `PATCH /refunds/admin/:requestId/pay-to-bank` | — | "Maine NEFT **shuru** kiya" |
| `PATCH /refunds/admin/:requestId/confirm-bank-payout` | `{ utr, mode, paidAt }` | "Paisa **pahunch** gaya" |
| `PATCH /refunds/admin/:requestId/fail-bank-payout` | `{ reason }` | "Bank ne wapas kiya" |

⚠️ **`pay-to-bank` aur `confirm-bank-payout` alag isliye hain** ki shuru hona aur pahunchna do alag ghatnaayein hain. Ek endpoint hota to dono ek jaise dikhte — aur `sweepStalePayouts` ka poora kaam theek wahi farq dekhna hai: wo un payouts ko dhoondhta hai jo shuru hue aur confirm nahi hue.

⚠️ `paidAt` alag field hai, `updatedAt` nahi. NEFT kal shuru hua aur aaj confirm hua — reconciliation wahi padhta hai jo **bank ne** kiya, wo nahi jab humne form bhara.

⚠️ `utr` bank ka reference hai — baad me "paisa sach me gaya?" ka jawab sirf usi se milta hai.

---

## Settlements — jo `12 — Settlements` me nahi the

| Endpoint | From → To | Rows chhodta hai? |
|---|---|---|
| `PATCH /settlements/admin/:id/cancel` | ON_HOLD / APPROVED → CANCELLED | ✅ haan |
| `PATCH /settlements/admin/:id/retry` | FAILED → APPROVED | ❌ nahi |
| `PATCH /settlements/admin/:id/abandon` | FAILED → ABANDONED | ✅ haan |

⚠️ **`retry` aur `abandon` ka asli farq yahi hai.** Retry rows apne paas rakhta hai — wahi payout dobara koshish karega. Abandon unhe chhod deta hai, to paisa agle cycle me kisi doosri settlement me wapas aa jaata hai. Ulta karne par ya to paisa do baar chala jaata hai, ya hamesha ke liye phans jaata hai.

### `GET /settlements/admin/debt/:brandId` · `PATCH /settlements/admin/debt/:brandId/write-off`

`netPayable <= 0` settlement ko `CARRIED_FORWARD` bhejta hai — aur carry forward karna **hi** rows chhodna hai, to bakaya aur kamai dono agle cycle me chale jaate hain. Jab tak brand bech raha hai, nayi sales use kaat deti hain.

⚠️ **Jis din wo band karta hai, wahi rows hamesha claim aur release hoti rehti hain** — koi error nahi, koi log nahi, aur paisa hamari kitaab par ek aise aadmi se receivable ban kar baith jaata hai jo wapas nahi aa raha. `alertVendorDebt` roz ye report karta hai aur **kuch karta nahi**; 90 din par apne aap maaf kar dena us brand ko maaf kar dega jo bas season ke beech me hai.

Write-off body: `{ reason, olderThanDays }`.

⚠️ Ye har row par **do** `MANUAL_ADJUSTMENT` likhta hai — `VENDOR_PAYABLE` credit taaki agla cycle bakaya na dekhe, aur `PLATFORM_COST` debit kyunki nuksaan humne uthaya. Reference **sirf vendor row par** jaata hai: `ONCE_PER_REFUND` aur `ONCE_PER_DISPUTE` `{reference, entryType}` par unique hain, to dono par daalne se doosra duplicate-key no-op ban jaata — bakaya saaf ho jaata, cost kabhi aati hi nahi, aur kitaab theek utni kam ho jaati jitna maaf kiya.

---

## Transactions — hold chhodna

### `PATCH /transactions/admin/:transactionId/release-hold`

Body: `{ reason }` — **required**.

⚠️ **Is endpoint se pehle in states se koi raasta hi nahi tha.** `settlementHold` refund maangte hi lag jaata hai, aur wahi ek line *"vendor ko de chuke, ab wapas lo"* wali poori samasya hata deti hai. Uska ulta utna hi khatarnak hai: **jo hold koi chhodta nahi, wo vendor ka paisa hamesha ke liye har settlement se bahar rakh deta hai — chup-chaap**, kyunki eligibility predicate bas match karna band kar deti hai.

⚠️ Tab tak mana karta hai jab tak koi refund khula hai ya chargeback unresolved hai.

### `GET /disputes/:disputeId/evidence-pack` · `GET /transactions/disputes/:disputeId/evidence-pack`

Ek hi jawab, do mount — `/disputes` naya saaf raasta, `/transactions/disputes/...` purana. Razorpay ko jawab dene ke liye jo chahiye ek jagah: payment, claim, invoice, redemption ka waqt.

⚠️ `ledger_type_dispute_unique` **dispute** par keyed hai, transaction par nahi — Razorpay dispute webhooks dobara bhejta hai **aur out of order** bhejta hai, to ek der se aaya `lost` ek `won` ke baad aa sakta hai.

---

## Showcase — admin bhi kar sakta hai

Ye aath endpoints `isVendorOrAdmin` hain, yaani admin bhi kisi brand ka showcase chala sakta hai. **Request aur saved example [vendor collection](./vendor_panel_api_doc.md) ke `10 — Showcase` folder me hai** — yahan dobara nahi rakhe gaye, kyunki ek hi request ki do copy matlab do jagah badalna, aur ek badli-doosri-reh-gayi hi drift ki shuruaat hai.

| Endpoint | Kya |
|---|---|
| `GET /showcase/section/get/:sectionId` | Ek section, media ke saath |
| `PUT /showcase/section/update/:sectionId` | Section ka naam/visibility |
| `DELETE /showcase/section/delete/:sectionId` | Soft delete |
| `POST /showcase/section/:sectionId/add-media` | **multipart** — file chahiye |
| `PUT /showcase/section/:sectionId/media/replace/:mediaId` | **multipart** |
| `PATCH /showcase/section/:sectionId/media/update/:mediaId` | Sirf caption/alt — file nahi |
| `PUT /showcase/section/:sectionId/media/reorder` | **Poora** order bhejein |
| `DELETE /showcase/section/:sectionId/media/delete/:mediaId` | Soft delete |

⚠️ Reorder **poori list** maangta hai, sirf hile hue item nahi — `"2 sections expected, 1 received"` wahi refusal hai. Aadha order bhejna baaki ko `sortOrder: 0` par gira deta, aur gallery chup-chaap bikhar jaati.

---

## Public / role-agnostic

### `GET /documents/:token`

⚠️ **Ek hi public document route, chhe kism ke document ke liye** — claim receipt,
subscription invoice, grant advice, payout statement, refund receipt, chargeback
advice. Koi bearer nahi; path ka token hi credential hai. Wahi token vendor aur
customer ke email/WhatsApp link me hota hai, isliye ye us aadmi ke liye kaam karta
hai jo abhi login nahi hai.

⚠️ Pehle `settlements/statement/:token` aur `transactions/invoice/:token` do alag
route the, aur dono ka apna token field naam tha — to bare token se ye pata hi nahi
chalta tha ki wo kis kism ka document hai. Refund aur dispute ke liye teesra aur
chautha route banana padta. Ab chaaron collection par field ka naam `documentToken`
hai aur resolver khud dhoondhta hai.

⚠️ Payout statement ka token **sirf tab mint hota hai jab settlement `PAID` bane**
(`transitionSettlement`: `becomingPaid && !documentToken`), aur snapshot bhi wahin
freeze hota hai — usse pehle har figure abhi bhi hil sakta hai. Galat token par
`404` aata hai, `401` nahi — `401` ye bata deta ki token maujood hai par aapka nahi.

⚠️ Payout statement ke andar **commission ka tax invoice** bhi chhapta hai, apne
alag number ke saath (`TD/CMN/…`). Do document, ek kaagaz: statement batata hai
bank me kya pahuncha, aur commission Trydood ki taraf se vendor ko di gayi taxable
supply hai — GST me wo apna document hai. Commission zero ho to wo section aur uska
number, dono nahi bante.

### `GET /disputes` · `GET /disputes/:disputeId`

Gate sirf `verifyJwtToken` — **scope token se aata hai**. Vendor apne brand ke disputes dekhta hai, admin sabke. Isi wajah se ye kisi ek role ki collection me fit nahi hota; request `13 — Disputes` folder me hai.

⚠️ `respondBy` **absent** hota hai jab tak Razorpay deadline na de. Use aggregation me `null` se compare karna bina `$ifNull` ke ulta jawab deta hai — yahi galti `vendorWasPaid: true` bana chuki hai un payments par jo **kabhi settle hi nahi hue**, aur wahi field admin dekhkar tay karta hai ki wapas lene ko kuch hai bhi ya nahi.

### `GET /` · `GET /my-ip` · `GET /client-ip`

⚠️ Teeno `index.js` seedha serve karta hai — **`/trydood/v1` ke bahar**. Collection me `{{host_url}}` use hota hai, `{{base_url}}` nahi; warna `/trydood/v1/my-ip` banta hai jo router ka catch-all `404` deta hai, aur wo galti routing bug jaisi dikhti hai.

| Route | Kya |
|---|---|
| `GET /` | Health check — plain text, envelope nahi |
| `GET /my-ip` | **Is process** ka outbound address — Atlas Network Access allow-list ke liye |
| `GET /client-ip` | Caller ka address, `TRUST_PROXY` ke through |

⚠️ `/client-ip` galat hona mehnga hai: rate limiter isi par ginta hai. `TRUST_PROXY` ghalat hone par limiter **poore desh ko ek client** gin leta hai; ulta, jo hop hai hi nahi use trust karna matlab caller ka khud likha `X-Forwarded-For` maan lena.

---

# Appendix A — Not For Admin Panel

Admin ke paas platform ka sabse zyada access hai, par **33 endpoints** aise hain jo admin panel me nahi aane chahiye.

### Vendor onboarding (11) — `isVendor` gated, admin ko `403` milega

| Endpoint | Kyun |
|---|---|
| `POST /brands/onboarding/add-basic-details` | Vendor apna business identity bharta hai |
| `POST /brands/onboarding/add-pan-details` | |
| `POST /brands/onboarding/add-gst-details` | |
| `POST /brands/onboarding/add-bank-details` | |
| `GET /brands/onboarding/system-verify` | Vendor apna KYC run karta hai |
| `PUT /brands/onboarding/accept-partnership` | |
| `PUT /brands/onboarding/acknowledge-approval` | Vendor approval screen dismiss karta hai |
| `PUT /brands/onboarding/update-basic-details` | |
| `POST /verification/brands/onboarding/verify-pan` | CGPey live verification — **chargeable** |
| `POST /verification/brands/onboarding/verify-gst` | |
| `POST /verification/brands/onboarding/verify-bank` | Penny-drop — real transaction |

> ⚠️ Ye sab `isVendor` ke peeche hain — admin call kare to `403 "Forbidden: You do not have permission to perform this action."`

### Showcase content management (11) — service-level vendor-only

`POST /showcase/section/add` · `GET /section/get/:sectionId` · `PUT /section/update/:sectionId` · `DELETE /section/delete/:sectionId` · `POST /section/:sectionId/add-media` · `PATCH /media/update/:mediaId` · `PUT /media/replace/:mediaId` · `PUT /media/reorder` · `DELETE /media/delete/:mediaId`

> `POST /showcase/section/add` `validateBrandVendor(userId)` use karta hai — **token se brand resolve hota hai**, jo admin ke paas nahi hota. Admin ke liye sirf `get-all` (#36) aur `reorder` (#37) hain.

### Customer-facing (10)

`POST /locations/upsert` *(customer-only, service me `403`)* · `POST /follows/toggle/:brandId` · `GET /follows/get-all` · `POST /brandAvoidances/toggle/:brandId` · `GET /brandAvoidances/get-all` · `GET /banners/customer/active` · `GET /promotionalTickers/customer/active` · `GET /vouchers/customer/get-all` · `GET /vouchers/customer/get/:voucherId` · `POST /vouchers/customer/voucher/preview`

### Work hours (1)

`POST /workHours/upsert` — vendor apne outlet ki timings set karta hai. Admin ke liye koi use case nahi.

### Provider endpoint (1)

`POST /transactions/webhook/razorpay` — Razorpay ka endpoint. Admin panel ise **kabhi call nahi karega**; visibility ke liye `GET /webhook/events` (#95) hai.

Full categorization → [endpoints_category.md](./endpoints_category.md)

---

# Appendix B — Known Issues

**Status 2026-09-06 ko code ke against dobara verify kiya gaya.**

⚠️ Pichli baar is list me **9 findings aise the jo fix ho chuke the**. Ek fixed
finding likha rehna khaali shor nahi hai — agla insaan use fix karne baithta hai
jo pehle se theek hai, aur baaki list par bhi bharosa kam ho jaata hai. Isliye ab
har entry par wo file aur line likhi hai jisse ye claim verify hota hai.

---

## 🔴 Blocker

### 1. WhatsApp OTP verify hota hi nahi

```js
// services/auth/verifyOtpWithWhatsapp.js:22
//  await verifyOtp(whatsappNumber, otp);
```

Koi bhi kisi ka number daale aur koi bhi 6-digit code de — **uska account khul
jaata hai**. Uski claims, refunds, bank accounts, settlements: sab.

⚠️ **Ye do-line change hai, ek nahi.** `loginOrSignUpWithWhatsapp.js:224` par
`sendOtp` bhi commented hai. Sirf verify chaalu karne se OTP kabhi bheja hi nahi
jaayega aur har login fail hoga.

⚠️ Chaalu karte hi throttle live ho jaayega (60s / 5 per hour, target par keyed),
to Postman collections ke auth folders reseed ke beech `429` khaane lagenge.

**Pehle ye do raaste bhi khule the aur ab band hain** — is finding ka daayra utna
hi hai jitna upar likha hai:

| Tha | Ab |
|---|---|
| `POST /auth/register` public, default role `ADMIN` | `routes/auth.js:46` — `isAdmin` ke peeche |
| WhatsApp signup se `role: "ADMIN"` | `loginOrSignUpWithWhatsapp.js:29` — `SELF_SIGNUP_ROLES` sirf CUSTOMER aur VENDOR |

---

## 🟠 Feature toota hua hai, chup-chaap

### 2. `DELETE /users/delete` kuch delete nahi karta

```js
// routes/users.js:9 — poora handler yahi hai
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```

App ka "Delete my account" button success dikhata hai aur **kuch nahi hota**.
Account deletion Play Store aur App Store dono ki requirement hai.

⚠️ Ye envelope bhi todta hai — `success` field hai hi nahi — aur route file me
business logic hai, jo `CLAUDE.md` ka *"Never"* hai.

⚠️ Fix karte waqt: identity index `partialFilterExpression: { isDeleted: false }`
par hai, to soft delete karte hi wo number free ho jaayega aur wahi insaan dobara
signup kar sakta hai. Ye **sahi behaviour hai**, par money history ka kya karna
hai — wo product decision hai.

### 3. Avoid kiye brands voucher feed se filter nahi hote

Customer "Don't show me this brand" dabata hai; brand phir bhi feed me aata hai.
`BrandAvoidance` row likhi jaati hai aur koi use padhta nahi.

⚠️ Fix se pehle `{customerId, brandId}` par index chahiye — feed pipeline pehle
se bhaari hai (geo distance, offers, promo), aur ek aur lookup bina index ke har
call par full scan karega.

### 4. ✅ Redemption — ye bug **nahi** hai, Phase 1 ka design hai

Pehle yahan likha tha *"redemption flow exist hi nahi karta"*. Wo galat padhta
hai. Code me shuru se **do phase** hain aur Phase 1 hi chaalu hai:

```js
// constants/voucherClaim.js:50
// AUTO is Phase 1: paying at the counter *is* the redemption.
// OUTLET_SCAN is Phase 2, where the claim code is shown and scanned.
CLAIM_REDEMPTION_MODE = { AUTO, OUTLET_SCAN, ADMIN }
```

`createVoucherClaimOrder.js:270` par `AUTO` **hardcoded** hai (model ka default
bhi wahi), aur `settleVoucherClaimPayment.js:312` us par capture ko seedha
`REDEEMED` likhta hai, `redeemedAt` ke saath.

**To Phase 1 me alag se "redeem" karne ko kuch hai hi nahi — payment hi
redemption hai.** `GET /voucher-claims/code/:claimCode` ek **read** hai: counter
par code padh kar dekhna ki kya khareeda gaya. Wo kuch likhta nahi, aur use
likhna bhi nahi chahiye.

Money path teeno jagah iske saath consistent hai:

| Kya | Kahan | Sthiti |
|---|---|---|
| Refund `PAID` **aur** `REDEEMED` dono par milta hai | `requestRefund.js:41` | ✅ Zaroori hai — `REDEEMED` na hota to Phase 1 me koi kabhi refund maang hi nahi sakta |
| Settlement eligibility claim status par gate karti hi nahi | transactions se chalti hai | ✅ |
| Golden rule settings se chalta hai, claim clock se nahi | `assertSettlementTimingRule.js` | ✅ |

**Jo aaj declare hai par inert hai** (aur ye theek hai — enum pehle se likh diya
gaya taaki Phase 2 par shape na badle):

- `PAID` status — koi likhta hi nahi
- `EXPIRED` — **poore codebase me koi producer nahi**, koi sweep job nahi
- `expiresAt`, `redeemedBy` — kabhi set nahi hote
- `{status, expiresAt}` index — dead, par harmless

Phase 2 kya-kya maangega — poora plan **Appendix C · C4** me hai.

### 5. `SUB_VENDOR` ka daayra saankra hai — par utna nahi jitna yahan likha tha

Pehle yahan *"sirf chaar endpoints"* likha tha. Sahi ginti **31** hai.

**Outlet login shipped hai, future ka kaam nahi.** Vendor apna outlet
`POST /subBrands/signUp-with-whatsapp` se jodta hai (gate `isVendorOrAdmin`,
plan ka slot consume hota hai), service `role: SUB_VENDOR` ka User banati hai —
**bina password ke** — aur `signUpSubBrandWithWhatsapp.js:94` par outlet ke
number par `sendOtp(WHATSAPP, …)` chala jaata hai. **Wahi verify step hai.**
Uske baad outlet wala `POST /auth/loginOrSignUp-with-whatsapp` se login karta
hai; `SELF_SIGNUP_ROLES` sirf usse *khud ko banane* se rokta hai, login se
nahi.

**4 endpoints outlet-specific gate (`isVendorOrSubVendor`) par:**

```
POST  /disputes/:disputeId/evidence
POST  /transactions/disputes/:disputeId/evidence
PATCH /refunds/:requestId/approve
PATCH /refunds/:requestId/reject
```

**+ 27 endpoints jo sirf `verifyJwtToken` par hain** — yaani koi bhi logged-in
role. Outlet ke kaam ke jo hain:

```
GET /voucher-claims/code/:claimCode     ← counter par code padhna
GET /voucher-claims · /voucher-claims/:claimId · /voucher-claims/payments
GET /refunds · /refunds/:requestId
GET /disputes · /disputes/:disputeId
GET /settlements · /settlements/:settlementId
```

To **claim verify karne ka read-half aaj hi kaam karta hai** — Phase 2 ke liye
sirf likhne wala aadha banana hai.

**Scoping sahi hai, koi leak nahi.** `assertTransactionAccess.js:133` par:

```js
if (role === SUB_VENDOR && actor.subBrandId && claim.subBrandId &&
    String(claim.subBrandId) !== String(actor.subBrandId))
  throwError(403, "This claim was not made at your outlet.");
```

Aur `VoucherClaim.subBrandId` model me `required: true` hai aur hamesha
`outlet._id` se bharta hai, to wo null-check kabhi bypass nahi ho sakta. Yahi
narrowing `buildRefundReadPipeline`, `buildSettlementReadPipeline` aur
`notificationScope` me bhi hai.

⚠️ **Jo sach me nahi khulta**, aur kyun: `resolveActorBrand` par
`String(brand.userId) !== String(userId)` → `403`. SUB_VENDOR ka `userId` Brand
par hota hi nahi (uske paas `subBrandId` hai), to us helper se guzarne wala har
kaam — vouchers, showcase, subscriptions — outlet ke liye band hai. Wo helper
**16 files** use karti hain, isliye blast radius bada hai.

⚠️ `GET /settlements` par SUB_VENDOR ko **poora brand** dikhta hai, apna outlet
nahi — settlement poore brand ke din ka hota hai, ek counter ka nahi. Ye
`buildSettlementReadPipeline.js:77` par jaan-boojh kar hai.

ℹ️ Do middleware bane hain par koi route inhe use nahi karta: `isSubVendor`
(`validateRoles.js:19`) aur `isBrandSideOrAdmin` (`validateRoles.js:34`).

---

## ✅ Pehle yahan the, ab fix ho chuke hain

Har ek code ke against verify kiya gaya — 2026-09-06.

| Purana finding | Ab kya hai |
|---|---|
| `POST /auth/register` public, default ADMIN | `routes/auth.js:46` — `isAdmin` |
| WhatsApp signup se ADMIN ban sakte ho | `loginOrSignUpWithWhatsapp.js:29` — `SELF_SIGNUP_ROLES` |
| Role enforcement — 35 endpoints open | 81 admin routes sahi gate par; `scripts/verifyApiCoverage.js` naapta hai |
| `?userId` param se kisi bhi user ka data | Aisa koi param bacha nahi |
| Legal create endpoints kaam nahi karte | `controllers/termsAndConditions` — `create` maujood aur wired |
| `showcase/section/get-all` brand-scoped nahi | `services/showcases/getAllSections.js:7` — `resolveActorBrand` |
| `GET /brands/get` PAN/GST/Bank expose karta hai | Projection me wo fields nahi |
| Brand verification history customer ko dikhti hai | `routes/brands.js:146` — `isVendorOrAdmin` |
| `FIXED` discount type kaam nahi karta | `calculateVoucherPricing.js:41` — FLAT ka alias |
| Email verification ka endpoint nahi | `POST /auth/email/send-verification` + `/verify` |
| `POST /auth/logout` push unregister nahi karta | Karta hai, aur `allDevices` bhi |
| `brand.isApproved` kabhi likha nahi jaata | `reviewBrandVerification.js` teeno action par likhta hai |
| Promo codes off by default | Dono defaults ab `true` |
| Notification broadcast ka 5000 ka cap fixed hai | `admin.notification.maxRecipientsPerDispatch` — admin panel se badalta hai |

---

# Appendix C — Future Work

Ye kaam **jaan-boojh kar tala gaya hai**, bhoola nahi. Har ek par alag se approval
lena hai. Jo abhi live hai wo Appendix B me hai; ye wo hai jo abhi tak socha nahi
gaya ya shuru nahi hua.

## C1. Auth aur account

| # | Kya | Use case | Asar agar na kiya | Fix ka shape |
|---|---|---|---|---|
| 1 | **OTP verify chaalu karna** | Koi bhi kisi ke account me ghus sakta hai | Poora auth bypass — Appendix B #1 | `verifyOtpWithWhatsapp.js:22` **aur** `loginOrSignUpWithWhatsapp.js:224` dono uncomment; throttle ka asar collections par dekhna padega |
| 2 | **Account deletion sach me karna** | App ka "Delete my account" jhooth bolta hai | Store policy violation | Service banao: soft-delete User + role profile, sessions khatam, push tokens off, envelope use karo |
| 3 | **Avoided brands ko feed se hatana** | "Don't show me this brand" kaam nahi karta | UI ka promise poora nahi hota | Feed pipeline me `BrandAvoidance` join + `{customerId, brandId}` index |

## C2. Vendor operations

| # | Kya | Use case | Asar agar na kiya | Fix ka shape |
|---|---|---|---|---|
| 4 | **Phase 2 — outlet scan redemption** | Counter par code scan karke redeem mark karna | Kuch toota nahi rehta; Phase 1 (payment = redemption) chalta rehta hai | Poora plan **C4** me — ek switch nahi, saat jude hue badlaav |
| 5 | **SUB_VENDOR ka daayra** | Outlet manager apne outlet ke vouchers/claims/timings dekhe | Login aur 31 endpoints aaj bhi kaam karte hain; baaki par `403` | `resolveActorBrand` ko sub-vendor scope dena — **16 files** use karti hain, blast radius bada |

## C4. Phase 2 — outlet scan redemption ka poora plan

> **Status:** 🔴 Sirf plan. Koi code nahi likha gaya. Approval ke baad hi shuru
> hoga.

Aaj Phase 1 hai: payment hi redemption hai. Phase 2 use do kadam me todta hai —
customer pay karta hai (`PAID`), phir counter par code scan hota hai
(`REDEEMED`). Sunne me ek flag ka kaam lagta hai. **Hai nahi** — kyunki beech me
ek nayi avastha khul jaati hai jo aaj exist hi nahi karti: *paisa liya ja chuka
hai, par voucher abhi tak use nahi hua*.

Us ek avastha se saara kaam nikalta hai.

### C4.0 ⚠️ Pehle ek product faisla — code se pehle

**Customer ne pay kar diya aur window ke andar kabhi scan nahi karaya. Paisa
kiska?**

| Option | Kya hota hai | Kya sochna padega |
|---|---|---|
| **A — Auto refund** | Window band, paisa wapas | Vendor ko settle ho chuka hoga to wapas lena padega — `taintSettlement` ka raasta |
| **B — Vendor rakhta hai** | Voucher zaya, paisa vendor ka | Customer ko *pehle* saaf batana padega, warna dispute banega |
| **C — Platform rakhta hai** | Zaya paisa platform ka | Sabse aasan, par sabse mushkil samjhaana |

**Ye teeno alag settlement code maangte hain.** Isliye ye pehla kadam hai — is
jawab ke bina C4.5 aur C4.6 likhe hi nahi ja sakte.

### C4.1 Jo pehle se bana hua hai ✅

Phase 2 ke liye scaffolding pehle se padi hai — ye **naya nahi likhna**:

| Kya | Kahan |
|---|---|
| `PAID`, `EXPIRED` statuses | `constants/voucherClaim.js:12-21` |
| `CLAIM_REDEMPTION_MODE.OUTLET_SCAN` | `constants/voucherClaim.js:56` |
| `CLAIM_HISTORY_ACTION.REDEEMED` / `EXPIRED` | `constants/voucherClaim.js:64-66` |
| `expiresAt`, `redeemedBy` fields | `models/VoucherClaim.js:100-102` |
| `{status, expiresAt}` index | `models/VoucherClaim.js:202` |
| `redemptionWindowHours: 24` | `constants/customer.js:125` default; **`Setting.js:325` par asli setting hai**, `validator/settings.js:132` validate karta hai, aur `getCustomerConfig.js:91` ise customer config me **return** karta hai. Admin ise aaj hi badal sakta hai — bas koi uspar hisaab nahi karta |
| `VOUCHER_CLAIM_EXPIRED` notification type | `constants/notification.js:150` |
| `notifyClaimExpired({ claim })` | `voucherClaimNotices.js:223` — likha hua, production me wired nahi. `mailRender.test.js:435` iska template test karta hai, to render toota hua nahi hai |
| **Redemption ledger — poora bana hua** | `VoucherUsage` har capture par likhi jaati hai (`settleVoucherClaimPayment.js:233-259`), refund par `applyRefundCompletion.js:336` use reverse karta hai, aur `buildClaimPreview.js:156` use padhta hai |
| Once-per-user — **do parat** | `VoucherClaim` par `{voucherId, customerId, offerId}` + `holdsUsageSlot:true`, aur `VoucherUsage` par wahi keys + `{isOncePerUser:true, isReversed:false}` (`VoucherUsage.js:154`) |
| Slot conflict ka handling | `settleVoucherClaimPayment.js:253-268` — duplicate par usage bina slot ke likhti hai, `slotConflict: true` flag karti hai aur admin ko batati hai. Paisa liya ja chuka hai, to ye business conflict hai, technical failure nahi |
| Guessable-proof claim code | `generateClaimCode.js:20` — `crypto.randomInt`, look-alike letters hataye hue |
| Outlet ka access narrowing | `assertTransactionAccess.js:133` — pehle se sahi |
| Code se claim padhna | `GET /voucher-claims/code/:claimCode` — read-half already live |

> ⚠️ Isliye Phase 2 me *ledger* nahi banana — wo bana hua hai aur chal raha hai.
> Banana sirf **do-kadam wali state machine** hai: capture ko `PAID` par rokna,
> scan par aage badhana, aur na-scan hone par band karna.

### C4.1a Kya ye adhoora scaffolding aaj **error deta hai**? ❌ Nahi

2026-09-06 ko naapa gaya:

| Gate | Natija |
|---|---|
| `npm test` | 59 suites · **1256 pass · 0 fail** |
| `scripts/verifyApiCoverage.js` | 219/219 |
| `scripts/verifySchemaRelationships.js` | 53 models · 194 paths · 0 tooti hui ref |

Ek-ek tukda:

| Tukda | Aaj kya hota hai | Error? |
|---|---|---|
| `PAID` status | Kabhi likha nahi jaata; `REFUNDABLE_CLAIM_STATUSES` me ek extra entry bhar hai | ❌ |
| `EXPIRED` status | Koi producer nahi. `customerStats.js:140` ka `expiredClaims` **hamesha 0** dikhega — galat nahi, bas hamesha 0 | ❌ |
| `expiresAt` | Kabhi set nahi. `{status, expiresAt}` index non-unique hai, missing field null index karta hai | ❌ (bas ek dead index ki write cost) |
| `redeemedBy` | Sirf declare hai — **koi padhta ya populate nahi karta** | ❌ |
| `redemptionWindowHours` | Admin badal sakta hai, config me dikhta hai, **par koi uspar hisaab nahi karta** | ❌ — par badalna bekaar hai, aur wo confuse kar sakta hai |
| `notifyClaimExpired` | Production me call nahi hota; template test pass hai | ❌ |
| `isSubVendor`, `isBrandSideOrAdmin` | Dead exports | ❌ |

### C4.1b ✅ Ek risk tha — ab band hai

Pehle yahan ek asli khatra tha: `redemptionMode` ka enum `OUTLET_SCAN` allow
karta tha, aur `createVoucherClaimOrder` me `AUTO` **hardcoded** tha. Agar wo
value kisi bhi tarah kisi claim par pahunch jaati — seedha DB edit, naya seeder,
ya aage chal kar galti se — to claim capture hoti, `PAID` par ruk jaati, aage
badhane ka endpoint na hota, band karne ka sweep na hota. **Paisa liya ja chuka,
claim hamesha ke liye atki — aur chup-chaap**, kyunki na koi exception uthta na
koi test girta.

Ab teen parat hain:

| Parat | Kahan | Kya karti hai |
|---|---|---|
| **Ek jagah sach** | `constants/voucherClaim.js` — `DEFAULT_REDEMPTION_MODE` + `IMPLEMENTED_REDEMPTION_MODES` | Hardcode hata. Enum kehta hai kaun se mode ka *naam* hai; ye list kehti hai kaun se ke peeche **chalta hua code** hai. Aaj sirf `AUTO` |
| **Paise se pehle mana** | `createVoucherClaimOrder` ka pehla statement | Default aisa mode ho jiske peeche code na ho, to `503` — koi claim banti hi nahi. Pricing aur gateway order se **pehle**, kyunki refuse karna muft hai aur capture karke atkana nahi |
| **Paise ke baad shor** | `settleVoucherClaimPayment` | Yahan mana nahi kar sakte — paisa ja chuka. To `PAID` par parking hoti hai **aur admin ko `CRITICAL` alert** jaata hai, `dedupeKey` ke saath taaki retry se spam na ho |

⚠️ Settle wala hissa jaan-boojh kar claim ko `REDEEMED` **nahi** likh deta. Scan
flow asli hone ke baad wo vendor ko us voucher ka paisa de deta jo kabhi redeem
hi nahi hua — aur atki hui claim se ulta, wo haath se ulta nahi kiya ja sakta.
Atki hui claim refund ho sakti hai: `PAID` `REFUNDABLE_CLAIM_STATUSES` me hai.

⚠️ **Aur wahi baat jo pehle bhi thi:** `OUTLET_SCAN` ko
`IMPLEMENTED_REDEMPTION_MODES` me daalna **C4.4 aur C4.5 ke usi commit me** hona
chahiye, unse pehle kabhi nahi. Test `"creates claims in a mode this build can
carry to REDEEMED"` isi ko pakadta hai.

### C4.2 Switch — `AUTO` se `OUTLET_SCAN`

Hardcode ja chuka (C4.1b). Ab do constants hain — `DEFAULT_REDEMPTION_MODE` aur
`IMPLEMENTED_REDEMPTION_MODES` — to Phase 2 ka switch **do line ka badlaav** hai,
ek code hunt nahi:

```js
// constants/voucherClaim.js — dono ek saath, ek hi commit me
const IMPLEMENTED_REDEMPTION_MODES = Object.freeze([AUTO, OUTLET_SCAN]);
const DEFAULT_REDEMPTION_MODE = CLAIM_REDEMPTION_MODE.OUTLET_SCAN;
```

⚠️ Par ye **tabhi** jab C4.4 (redeem endpoint) aur C4.5 (sweep) ban chuke hon.
Test `"creates claims in a mode this build can carry to REDEEMED"` pehle
badalne par red ho jaayega — wo test badalna galat jawab hai.

⚠️ **Aage chal kar per-brand chahiye hoga, platform-wide nahi.** Ek hi platform
par kirana (scan chahiye) aur salon (appointment, scan bemaani) dono honge. Us
waqt constant se nikal kar brand-level setting banegi — aur tab
`isImplementedRedemptionMode` ka check us setting ke **write path** par bhi
lagana padega, sirf claim banate waqt nahi.

⚠️ **`redemptionMode` claim par freeze hota hai** — jo claims Phase 1 me bane
hain wo `AUTO` hi rahenge aur `REDEEMED` hi rahenge. **Koi migration nahi.**
Yahi wajah hai ki `settleVoucherClaimPayment.js:312` claim ka apna
`redemptionMode` padhta hai, global setting nahi. Ye pehle se sahi likha hai —
todna nahi.

### C4.3 `expiresAt` capture par likhna

Aaj kabhi set nahi hota. `OUTLET_SCAN` par capture ke waqt
`paidAt + redemptionWindowHours` likhna padega.

⚠️ Window **capture se** naapo, claim banne se nahi — customer PENDING me kitni
der raha wo uski window nahi khaani chahiye.

### C4.4 Redeem endpoint — likhne wala aadha

`PATCH /voucher-claims/:claimId/redeem` · gate `isVendorOrSubVendor`

| Zaroorat | Kyun |
|---|---|
| **Conditional update** `{_id, status: PAID}` | Do baar scan karna do baar redeem na kare — read-then-write yahan race hai |
| Sirf `PAID → REDEEMED` | `EXPIRED` ya `REFUNDED` claim scan par 409 mile, chup-chaap na khule |
| `redeemedAt` + `redeemedBy` | `redeemedBy` outlet ka user id — kaun sa counter, kis ne |
| `assertClaimAccess` se guzre | Outlet narrowing already likhi hai, dobara mat likho |
| `CLAIM_HISTORY_ACTION.REDEEMED` audit row | History append-only hai; scan ka nishaan chahiye |
| Idempotent jawab | Pehle se `REDEEMED` hai to wahi claim wapas do, error nahi — counter par staff dobara tap karega |

### C4.5 EXPIRED sweep job — sabse aasani se bhoolne wala hissa

**Aaj `EXPIRED` ko koi likhta hi nahi.** `OUTLET_SCAN` chaalu karte hi
paid-but-never-scanned claims hamesha `PAID` me latke rahenge — matlab customer
ka paisa gaya, voucher use nahi hua, aur system kabhi maanega hi nahi ki window
band ho gayi.

`jobs/index.js` me naya job chahiye — `JobLock` ke saath, warna do instance ek hi
claim ko do baar expire karenge.

⚠️ `EXPIRED` `CLAIM_SLOT_RELEASING_STATUSES` me hai
(`constants/voucherClaim.js:40-45`), to expire karte waqt **`holdsUsageSlot`
false karna hi padega** — warna customer ka once-per-user slot hamesha ke liye
phansa rahega aur wo dobara claim nahi kar payega.

Job ko `notifyClaimExpired` bhi bulana hai — wo function bana hua hai.

### C4.6 ⚠️ Refund window ka clock badalna padega

Aaj refund window payment se naapi jaati hai. Phase 2 me wo **galat** ho jaayegi:

```
Phase 1:  pay ─────────────────────► refund window band
Phase 2:  pay ──── 24h window ──── scan ─────► refund window yahan se shuru
                                                honi chahiye
```

Agar clock payment par hi raha, to jo customer 23ve ghante me scan karayega
uski refund window **scan se pehle hi** band ho chuki hogi. Usne kharab khana
liya aur refund maang hi nahi sakta.

### C4.7 ⚠️ Golden rule dobara nikalna padega

```
settlementDelayHours >= windowHours + vendorApprovalHours + adminBufferHours
```

`assertSettlementTimingRule.js:46-52` ye aaj enforce karta hai. Phase 2 me
refund ka raasta **`redemptionWindowHours` jitna lamba** ho jaata hai, kyunki
refund scan ke baad shuru hota hai aur scan 24 ghante baad tak ho sakta hai:

```
refundPathHours = redemptionWindowHours + windowHours
                  + vendorApprovalHours + adminBufferHours
```

⚠️ Ye badle bina T+2 settlement us refund se **pehle** paisa bhej dega jo abhi
aana baaki hai. Wahi wo halat hai jise ye rule rokne ke liye likha gaya tha.

### C4.8 Settlement me unredeemed claim nahi jaani chahiye

Aaj settlement eligibility claim status par gate karti hi nahi — transactions se
chalti hai, aur Phase 1 me har paid claim redeemed hai, isliye theek hai. Phase
2 me wo dhaarna toot jaati hai: `PAID`-par-`REDEEMED`-nahi claim settlement me
chali jaayegi aur **vendor ko us voucher ka paisa mil jaayega jo kabhi use hi
nahi hua**.

Iska sahi jawab C4.0 ke faisle par tika hai.

### C4.9 Docs, Postman aur tests

`scripts/verifyApiCoverage.js` naya endpoint bina row ke commit nahi hone dega:

- `endpoints_category.md` me category row
- `vendor_panel_api_doc.md` me section (request + saara enum)
- `trydood-vendor` collection me request + **saved example**
- Seeder ko ek `PAID` claim banana padega jise collection scan kar sake

Money suite me kam se kam: double-scan idempotency, `EXPIRED` claim ka scan,
sweep job ka slot release, aur golden rule ka naya hisaab.

### C4.10 Kaam ka kram

```
C4.0  product faisla          ← iske bina baaki likha hi nahi ja sakta
  │
  ├─ C4.2  per-brand switch
  ├─ C4.3  expiresAt likhna
  ├─ C4.4  redeem endpoint
  ├─ C4.5  sweep job + slot release + notification
  │
  ├─ C4.6  refund clock            ┐
  ├─ C4.7  golden rule ka hisaab   ├─ teeno ek saath, ek hi money change hai
  ├─ C4.8  settlement eligibility  ┘
  │
  └─ C4.9  docs + postman + tests
```

⚠️ C4.6/4.7/4.8 alag-alag nahi ja sakte. Teeno ek hi baat ke teen chehre hain —
"paisa kab pakka hota hai". Ek badla aur doosra na badla, to settlement aur
refund ek doosre se aage-peeche ho jaayenge, aur uska lakshan hai **paisa chup-chaap
galat jagah ruk jaana**.

## C3. ✅ Do solve ho gaye, ek bacha

Ye teeno "bug" nahi the — ye wo cheezein thin jo ek **committed collection** kar
nahi sakti. Do ka ab asli coverage hai, teesra jaan-boojh kar waisa hi hai.

### ✅ #6 — Banner aur ticker upload · ab jest me tested

**Kya tha:** dono creates ko file chahiye, aur repo me koi binary fixture nahi.
Dono ka saved example `422` tha — jo sirf ye sabit karta hai ki validator zinda
hai, upload ke baare me kuch nahi.

**Kyun fixture nahi daali:** uploads asli Cloudinary account me `folder: "Images"`
jaate hain. Har capture run par ek asli upload hota, aur wo 1×1 PNG jama hote
rehte — jinhe kabhi koi delete nahi karta.

**Ab:** `__tests__/money/mediaUploadRollback.test.js` — **12 tests**, mocked
uploader. Yahan wo cheezein test hoti hain jo ek captured `200` kabhi nahi
karta:

| Kya | Kyun maayne rakhta hai |
|---|---|
| `type` se field derive hona (IMAGE→`image`, VIDEO→`video`, GIF→`gif`) | Galat hone par banner ban jaata aur **blank render** hota |
| VIDEO banner par image file → `422`, aur upload **attempt hi nahi** | Jo file reject honi hai uske liye Cloudinary ko paisa dena galat kram hai |
| Overlap guard upload se **pehle** chalta hai | Wahi wajah |
| Insert fail hone par uploaded media **delete** ho | Warna asset Cloudinary me hamesha rehta, jise koi reference nahi karta aur koi dhoondh nahi sakta |
| Rollback asli error ko **nigal na le** | Warna `422 "Title is required"` ki jagah rollback ka error dikhta |
| Insert safal hone par kuch delete **na** ho | — |

⚠️ **Mutation-tested.** `deleteBannerMedia` wali line hata kar chalaya — test
fail hua, phir file restore ki. Ek test jo bug hataane par bhi pass ho jaaye,
na hone se bura hai.

⚠️ Ek asli farq bhi pakda gaya: banner khud file ki jaanch karta hai, ticker
`files?.icon` seedha uploader ko de deta hai. Do endpoint jo ek jaise dikhte
hain, alag behave karte hain — ab wo assert hai, taaki badle to jaan-boojh kar
badle.

### ✅ #8 — Email verify ka success · ab asli capture hai

**Kya tha:** code asli inbox me jaata hai, collection mail padh nahi sakti.
Saved example `401` tha.

**Kaise solve kiya — aur kaise nahi kiya:** server me **koi test mode nahi**
daala. Koi `if (isTest)`, koi magic OTP jise server accept kare — kuch nahi.

Uske bajaye **seeder ek asli `Otp` row likhta hai**, usi
`hashOtp(code, target, purpose)` se jo production likhta hai. Collection wahi
code bhejti hai aur `verifyOtp` **bilkul badla hua nahi** chalta: wahi hash
compare, wahi attempt counter, wahi consume-on-success.

⚠️ **Ye farq zaroori hai.** Ek flag daalna — *"test me `000000` chalega"* —
theek wahi shape hai jisse is repo ka WhatsApp OTP bypass shuru hua tha. Jo
branch production me pahunch sakti hai wo gap hai, chahe kaise bhi guard karo —
aur `NODE_ENV` yahan guard karta hi nahi (dev machine ke kuch shells me wo
`production` set hai). Is design me production me **naya code path exist hi
nahi karta**, to exploit karne ko kuch nahi hai.

Do baatein jo isse chalane layak banati hain:

- **Har collection ka apna address** (`verify.customer.…`, `verify.vendor.…`,
  `verify.admin.…`). Ek shared address se pehli collection code consume kar
  leti thi aur baaki do ko `401` milta tha — jo toote endpoint jaisa padha
  jaata hai, khaayi hui fixture jaisa nahi.
- **Admin ke liye restore.** Admin **email se login** karta hai, to badla hua
  address agle run ka login tod deta — aur failure folder `00` par dikhti,
  us request par nahi jisne address hilaya. Wahi jo `Set Password` ne kiya tha.
  Uske liye seeder **doosri** row likhta hai, kyunki pehla verify pehli wali
  consume kar chuka hota hai.

### ⚠️ #7 — Razorpay webhooks · jaan-boojh kar waise hi

`POST /transactions/webhook/razorpay` aur `/customer` ka signature raw body par
HMAC hai. Collection use bana sakti hai — **par tabhi jab webhook secret ek
committed env file me ho**, yaani repo me credential, sirf ek green tick ke
liye. Wo galat sauda hai.

**Aur iski zarurat bhi nahi:** `__tests__/money/webhook.test.js` isko **14
tests** se cover karta hai aur asli HMAC banata hai:

```js
crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
```

To signature verification, replay, aur out-of-order events sab tested hain.
Collection ka `400` **documentation** hai, gap nahi.

⚠️ Par ek baat: naya webhook event type add karne par **jest test likhna
padega** — collection use nahi pakdegi. Aur naya webhook path `index.js` ke
`WEBHOOK_PATHS` me daalna na bhoolein, warna wo rate limiter ke peeche chala
jaayega — jiska symptom hai **paisa chup-chaap rukna**, kyunki `429` par
Razorpay kuch der retry karke chhod deta hai.

**Agar kabhi chahiye ho:** pre-request script jo `pm.environment` se secret le,
aur wo value **CI se inject** ho — repo me kabhi nahi.


---

# Frontend Integration Checklist

**Response handling**
- [ ] **404 = empty list** — purane modules pe (banners, tickers, categories, legal, locations, subBrands, showcase, vouchers versions). Empty-state dikhayein
- [ ] **Naye modules `[]` dete hain** — notifications, subscribeds, promoCodes, webhook events, disputes
- [ ] **Nested `data.data`** — pagination responses me
- [ ] **`DELETE /users/delete` standard envelope use nahi karta**
- [ ] **Token expiry pe login screen** — `401 "Your session has expired..."`

**Request formatting**
- [ ] **`brandId` mandatory hai** `resolveActorBrand` endpoints pe — `422 "brandId is required when acting as an admin"`
- [ ] **`/notifications/get-all` exception hai** — `brandId` omit karo to admin-audience feed milti hai
- [ ] **`role: "ADMIN"` default hai** email/mobile OTP flows pe, par WhatsApp flow pe `CUSTOMER`
- [ ] **Brand verification me `sortBy`/`sortOrder` UPPERCASE hain** (`NEWEST`, `DESC`) — baaki modules me lowercase
- [ ] **Multipart file field names exact** — `image`, `icon`, `logo`, `bannerImage`/`bannerVideo`/`bannerGif`, `images`, `newImages`
- [ ] **`limit` default 10 hai** — listings pe badhayein

**Review workflows**
- [ ] **Brand verification form action-scoped hona chahiye** — `rejectionReason` sirf `REJECTED` pe, `revokeReason` sirf `REVOKED` pe, `isReviewed` sirf `REVIEWED` pe. Warna `422`
- [ ] **Voucher review form bhi action-scoped** — `rejectionReason` sirf `REJECTED` pe
- [ ] **`REVIEWED` status nahi badalta** — sirf "seen" flag toggle
- [ ] **Approval status `systemverifies[0].status` se lein**, `brand.isApproved` se nahi
- [ ] **Review ke baad publish alag step hai** (voucher), aur acknowledge alag (brand)

**Subscription management**
- [ ] **`note` mandatory hai** grant (#76) aur cancel (#77) pe — 3–500 chars
- [ ] **Cancel se content delete nahi hota** — sirf limits `0` ho jaate hain
- [ ] **Plan ke entitlements badalne ke baad `resync` (#81) chalayein** affected brands pe
- [ ] **Active subscribers wala plan delete mat karein** — `404 "The subscription plan for this brand no longer exists."` aayega
- [ ] **`entitlementsSource: DERIVED`/`DEFAULT` = plan misconfigured** — warning dikhayein
- [ ] **`overflowBy > 0` = grandfathered downgrade**
- [ ] **`expiringInDays=7` renewals worklist hai**
- [ ] **Forfeit compensate sirf bookkeeping hai** — actual goodwill `admin/grant` se dena hoga

**Payments & webhooks**
- [ ] **`GET /webhook/events` default `FAILED` deta hai** — `status=ALL` se sab
- [ ] **`FAILED` = paisa liya, plan nahi mila** — Razorpay retry nahi karega, sirf replay se recover hoga
- [ ] **Replay pe `recovered` flag dekho**, `success` nahi
- [ ] **Root cause pehle fix karein**, phir replay
- [ ] **`disputes` ek worklist hai** — `respondBy` deadline miss = paisa gaya. Prominently dikhayein
- [ ] **Razorpay `amount` paise me hai** — `117882` = ₹1,178.82

**Content management**
- [ ] **Banner overlap check hai** — ek waqt me ek active. `409` handle karein
- [ ] **Tickers pe overlap check nahi** — multiple active theek hai
- [ ] **⚠️ Ticker dates: dono do ya koi nahi** — sirf ek set karoge to wo kabhi nahi dikhega
- [ ] **`isActive: false` usually delete se behtar hai** — banner, ticker, category, plan, promo code sab pe
- [ ] **Category/sub-category delete cascade nahi karta** — dangling references bachte hain
- [ ] **⚠️ Legal create endpoints broken hain** — screen abhi na banayein

**Settings**
- [ ] **Merge hota hai, replace nahi** — sirf jo bhejo wahi badalta hai
- [ ] **`companyStateCode` khali = sab IGST** — CGST+SGST ke liye set karein
- [ ] **`isPromoCodeEnabled` on karein** promo codes se pehle
- [ ] **Job interval changes ke liye server restart chahiye**

**Security discipline**
- [ ] **`?userId` param kabhi na bhejein**
- [ ] **`password` field response se drop karein**
- [ ] **Appendix A ke endpoints call na karein** — 11 pe `403` milega, baaki pe kaam nahi aayenge

**Push notifications**
- [ ] **Login ke baad `register` karein** — admin ko `WEBHOOK_FAILED` / `PAYMENT_DISPUTED` alerts push pe milte hain
- [ ] **Broadcast se pehle `test` (#17) chalayein** — FCM credentials verify
- [ ] **⚠️ Broadcast pe HAMESHA `dryRun: true` pehle** — audience size dekh kar hi bhejein
- [ ] **`all: true` explicitly likhna padta hai**
- [ ] **Logout pe `unregister` + `logout` dono**

---

**Doc version:** 1.0.0 · **Last verified:** 2026-08-22 against current code
**Related docs:** [endpoints_category.md](./endpoints_category.md) · [security_findings.md](./security_findings.md) · [brand_verification_api_doc.md](./brand_verification_api_doc.md) · [subscription_lifecycle_design.md](./subscription_lifecycle_design.md) · [subscription_future_updates.md](./subscription_future_updates.md) · [brand_rejection_remediation_design.md](./brand_rejection_remediation_design.md) · [vendor_panel_api_doc.md](./vendor_panel_api_doc.md) · [customer_mobile_api_doc.md](./customer_mobile_api_doc.md)
