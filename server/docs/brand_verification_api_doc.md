# Trydood 2.0 — Brand Verification & Admin Approval API Documentation

**Version:** 1.0.0
**Base URL (Local):** `http://localhost:8080/trydood/v1`
**Base URL (Staging):** `https://backend2-0-4v4i.onrender.com/trydood/v1`
**Framework:** Express.js (Node.js, CommonJS)
**Database:** MongoDB (Mongoose ODM)
**Scope:** Brand KYC system verification + admin approve/reject/revoke/review + audit trail — **5 endpoints**
**Generated:** 2026-08-23 · Source: `server2.0` code scan
**Router file:** `routes/brands.js` → auto-mounted at `/trydood/v1/brands`

> Ye doc code se banaya gaya hai. Har request field, error message aur response shape actual controller / service / validator / model se verify kiya gaya hai. Jahan behaviour jaan-boojh kar deferred hai, wahan 📌 marker hai.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Standard Response Format](#standard-response-format)
4. [HTTP Status Codes](#http-status-codes)
5. [Common Errors](#common-errors)
6. [Enums Reference](#enums-reference)
7. [Scoring Table](#scoring-table)
8. [State Machine](#state-machine)
9. [Endpoints](#endpoints)
   - [1. GET /brands/onboarding/system-verify](#1-get-brandsonboardingsystem-verify)
   - [2. GET /brands/admin/verifications](#2-get-brandsadminverifications)
   - [3. PUT /brands/admin/verifications/:brandId/review](#3-put-brandsadminverificationsbrandidreview)
   - [4. PUT /brands/onboarding/acknowledge-approval](#4-put-brandsonboardingacknowledge-approval)
   - [5. GET /brands/verifications/history](#5-get-brandsverificationshistory)
10. [Model Reference](#model-reference)
11. [Frontend Integration Notes](#frontend-integration-notes)

---

## Overview

Brand approval **do-step** process hai:

```
STEP 1 — SYSTEM (automatic KYC)
  vendor → GET /brands/onboarding/system-verify
  PAN / GST / Bank / naam-matching / duplicate checks → score 0-100
  SystemVerify record banta hai: status = APPROVED | MANUAL_REVIEW | REJECTED
  Brand.status = UNDER_REVIEW  ← chahe system ne kuch bhi score kiya ho
  Brand.isApproved = false     ← system kabhi auto-approve nahi karta

STEP 2 — ADMIN (manual decision)
  admin → PUT /brands/admin/verifications/:brandId/review
  REVIEWED  → sirf "dekh liya" toggle, status ko chhuta nahi
  APPROVED  → Brand.isApproved = true
  REJECTED  → reason zaroori, Brand.status = REJECTED
  REVOKED   → pehle di gayi approval wapas, reason zaroori

STEP 3 — VENDOR (approval acknowledge)
  vendor UNDER_REVIEW screen pe hi rehta hai, congratulations dikhta hai
  vendor → PUT /brands/onboarding/acknowledge-approval
  ab currentScreen = DASHBOARD
```

**Do source of truth:**

| Collection | Kya rakhta hai | Kaun padhta hai |
|---|---|---|
| `systemverifies` | Poora KYC detail — score, flags, name-match %, duplicates, remarks | **Admin panel** — isse admin ko har document manually dekhne ki zaroorat nahi padti |
| `brands` | Sirf final decision ka mirror — `status`, `isApproved`, `isReviewed`, reasons | **Vendor panel** + customer app |
| `brandverificationhistories` | Append-only audit trail — har event ka apna row | Dono panels |

Har brand ka **ek hi live attempt** hota hai. Vendor resubmit kare to naya `SystemVerify` banta hai (`attemptNumber` +1) aur purana `isSuperseded: true` ho jaata hai — delete kabhi nahi hota.

---

## Authentication

Sab endpoints pe `Authorization` header zaroori:

```
Authorization: Bearer <accessToken>
```

| Endpoint | Middleware | Allowed role |
|---|---|---|
| `GET /brands/onboarding/system-verify` | `isVendor` | `VENDOR` |
| `PUT /brands/onboarding/acknowledge-approval` | `isVendor` | `VENDOR` |
| `GET /brands/admin/verifications` | `isAdmin` | `ADMIN` |
| `PUT /brands/admin/verifications/:brandId/review` | `isAdmin` | `ADMIN` |
| `GET /brands/verifications/history` | `verifyJwtToken` | **koi bhi** — `ADMIN` ko sab brands, `VENDOR` ko sirf apna |

---

## Standard Response Format

**Success**

```json
{
  "success": true,
  "message": "Brand approved successfully.",
  "data": {}
}
```

**Error**

```json
{
  "success": false,
  "message": "Rejection reason is required when rejecting a brand."
}
```

**Validation error (422)** — `details` object me field-wise:

```json
{
  "success": false,
  "message": "Validation failed",
  "details": {
    "action": "Review action must be one of APPROVED, REJECTED, REVIEWED, REVOKED",
    "rejectionReason": "Rejection reason is required when rejecting a brand"
  }
}
```

---

## HTTP Status Codes

| Code | Kab aata hai |
|---|---|
| `200` | Success (saare endpoints) |
| `400` | Business rule fail — reason missing, brand approved nahi hai, system-verify hua hi nahi |
| `401` | Token missing / expired / user not found |
| `403` | Galat role, invalid token format, deactivated account |
| `404` | Brand / SystemVerify nahi mila, **ya list empty** |
| `409` | Conflict — duplicate decision, superseded attempt, concurrent admin |
| `422` | Joi validation fail, ya invalid ObjectId |
| `500` | Unexpected |

> ⚠️ **List endpoints pe `404` = "koi data nahi"**, error nahi. `pagination` utility empty result pe 404 throw karti hai. Frontend ko empty-state UI dikhana chahiye, error toast nahi.

---

## Common Errors

Kisi bhi protected endpoint pe aa sakte hain:

| Status | Message |
|---|---|
| `401` | `Access Denied! Missing authorization token` |
| `403` | `Access Denied! Invalid authorization token format` |
| `401` | `Your session has expired. Please log in again.` |
| `403` | `Invalid or malformed token. Please log in again.` |
| `403` | `Token not active yet. Please try again later.` |
| `403` | `Access Denied! Invalid token` |
| `404` | `Access Denied! User not found` |
| `403` | `Forbidden: You do not have permission to perform this action.` |
| `500` | `Authentication failed due to an unexpected error.` |

---

## Enums Reference

### `SYSTEM_VERIFICATION_STATUS`
`constants.js` — `SystemVerify.status` aur `Brand.status` dono pe lagta hai

| Value | Matlab |
|---|---|
| `PENDING` | System verify hua hi nahi (Brand ka default) |
| `MANUAL_REVIEW` | Score 75-89 — admin manually dekhe |
| `UNDER_REVIEW` | **Vendor-facing** — system ho gaya, admin ka decision baaki |
| `APPROVED` | Approved (system score ≥ 90, ya admin ne manually kiya) |
| `REJECTED` | Reject — kabhi approve hua hi nahi tha |
| `REVOKED` | Approve hua tha, baad me admin ne wapas le liya |

### `BRAND_VERIFICATION_ADMIN_ACTION`
`constants/brandVerification.js` — review API ka `action` field

`APPROVED` · `REJECTED` · `REVIEWED` · `REVOKED`

### `BRAND_VERIFICATION_ACTION`
History row ka `action` field

| Value | Kab banta hai |
|---|---|
| `SYSTEM_VERIFIED` | Pehla system run (attempt 1) |
| `RESUBMITTED` | Vendor ne dobara system verify chalaya (attempt ≥ 2) |
| `REVIEWED` | Admin ne reviewed flag ON kiya |
| `UNREVIEWED` | Admin ne reviewed flag OFF kiya |
| `APPROVED` | Admin ne approve kiya |
| `REJECTED` | Admin ne reject kiya |
| `REVOKED` | Admin ne approval wapas li |
| `APPROVAL_ACKNOWLEDGED` | Vendor ne congratulations screen dismiss kiya |
| `REMEDIATION_UPDATED` | Vendor ne rejection ke baad koi onboarding section edit kiya (resubmit se pehle) — dekho [remediation design](./brand_rejection_remediation_design.md) |

### `BRAND_VERIFICATION_ACTOR`
History row ka `performedByType`

`SYSTEM` · `ADMIN` · `VENDOR`

### `BRAND_SYSTEM_VERIFY_UPDATED_BY`
`verifiedBy` / `rejectedBy` / `revokedBy`

`SYSTEM` · `ADMIN`

### `BRAND_VERIFICATION_SORT_BY`
`NEWEST` · `OLDEST` · `SCORE`

### `BRAND_VERIFICATION_SORT_ORDER`
`ASC` · `DESC`

### `BRAND_VERIFICATION_LIMITS`

```json
{ "MAX_REASON_LENGTH": 1000, "MAX_NOTE_LENGTH": 1000 }
```

### `SCREENS` (is flow me relevant)
`SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `UNDER_REVIEW` · `DASHBOARD`

---

## Scoring Table

`services/systemVerify/verifyVendor.js` — max **100**

| Check | Points | Flag |
|---|---|---|
| PAN verified (CGPey `SUCCESS`) | +10 | `panVerified` |
| GST verified | +10 | `gstVerified` |
| Bank verified (`SUCCESS` + `isVerified`) | +10 | `bankVerified` |
| PAN GST number ke andar match (chars 3-12) | +10 | — |
| Business naam match average ≥ 85% | +20 | `panMatchedWithGST`, `panMatchedWithBrand`, `gstMatchedWithBrand` |
| Bank account-holder naam match ≥ 85% | +15 | `bankMatched` |
| GST registration active | +15 | `gstActive` |
| GST constitution ↔ brand entity type match | +10 | `businessEntityMatched` |
| **Duplicate mila** (PAN/GST/bank/WhatsApp/email) | **−20** | `duplicatePAN`, `duplicateGST`, `duplicateBank`, `duplicateWhatsapp`, `duplicateEmail` |

**Status decide:**

| Score | `SystemVerify.status` | `Brand.status` |
|---|---|---|
| ≥ 90 | `APPROVED` (+ `verifiedAt` set) | `UNDER_REVIEW` |
| 75 – 89 | `MANUAL_REVIEW` | `UNDER_REVIEW` |
| < 75 | `REJECTED` (+ `rejectedBy: SYSTEM`, reason = remarks) | `UNDER_REVIEW` |

> Score kuch bhi ho, `Brand.status` **hamesha** `UNDER_REVIEW` hi hota hai aur `Brand.isApproved` **hamesha** `false`. Sirf admin approve kar sakta hai.

---

## State Machine

```
                    ┌──────────┐
                    │ PENDING  │  (naya brand)
                    └────┬─────┘
                         │ GET /onboarding/system-verify
                         ▼
              ┌─────────────────────┐
              │ Brand: UNDER_REVIEW │◄────────────┐
              │ SysVerify: APPROVED │             │
              │  / MANUAL_REVIEW    │             │ resubmit
              │  / REJECTED         │             │ (naya attempt,
              └──┬───────┬──────┬───┘             │  purana superseded)
    REVIEWED     │       │      │                 │
    (toggle) ◄───┘       │      │                 │
                         │      │                 │
            APPROVED     │      │  REJECTED       │
                         ▼      ▼                 │
              ┌──────────────┐ ┌──────────┐       │
              │   APPROVED   │ │ REJECTED ├───────┤
              │ isApproved ✓ │ └──────────┘       │
              └──────┬───────┘                    │
                     │ REVOKED (reason zaroori)   │
                     ▼                            │
              ┌──────────────┐                    │
              │   REVOKED    ├────────────────────┘
              │ isApproved ✗ │
              └──────┬───────┘
                     │ APPROVED (admin dobara approve kar sakta hai)
                     └──────────► APPROVED
```

**Blocked transitions:**

| Kya | Result |
|---|---|
| Approved brand → `REJECTED` | `409` — "Revoke the approval instead." |
| Approved brand → `REVIEWED` toggle | `409` |
| Approved brand → `APPROVED` dobara | `409` |
| Admin-rejected attempt → `REJECTED` dobara | `409` — vendor resubmit kare |
| Non-approved brand → `REVOKED` | `409` |
| Superseded attempt pe koi bhi action | `409` |
| Approved brand pe system-verify dobara | `400` |
| `UNDER_REVIEW` attempt pe system-verify dobara | `409` |

---

# Endpoints

## 1. GET /brands/onboarding/system-verify

Automatic KYC verification chalata hai. **Onboarding ka STEP 1.**

| | |
|---|---|
| **Method** | `GET` |
| **Full path** | `/trydood/v1/brands/onboarding/system-verify` |
| **Auth** | `isVendor` → role `VENDOR` |
| **Validator** | koi nahi (body/query nahi lagta — `brandId` token se aata hai) |
| **Service** | `services/systemVerify/verifyVendor.js` |
| **Transactional** | ✅ (SystemVerify create + supersede + Brand + User + history — sab ek transaction me) |

### Request

Koi body ya query nahi. Brand `req.user.brandId` se resolve hota hai.

```
GET /trydood/v1/brands/onboarding/system-verify
Authorization: Bearer <vendorAccessToken>
```

### Response `200` — poora SystemVerify record

📌 Ye jaan-boojh kar **poora record** return karta hai (score/flags/remarks ke saath) — ye KYC pass hai jisse admin ko sab manually na dekhna pade. Ek lean vendor-facing shape service ke neeche comment me ready hai, jab panel switch karna chahe.

```json
{
  "success": true,
  "message": "Brand's vendor verified successfully.",
  "data": {
    "_id": "68a1f4c2b1e2c3d4e5f60801",
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "attemptNumber": 1,
    "score": 100,
    "status": "APPROVED",
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
      "duplicatePAN": false,
      "duplicateGST": false,
      "duplicateBank": false,
      "duplicateWhatsapp": false,
      "duplicateEmail": false
    },
    "nameMatch": {
      "panGstScore": 100,
      "panBrandScore": 100,
      "gstBrandScore": 100,
      "averageScore": 100
    },
    "bankNameMatch": {
      "bankPanScore": 100,
      "bankGstScore": 100,
      "bankBrandScore": 100,
      "highestScore": 100
    },
    "entityMatch": {
      "gstConstitution": "Proprietorship",
      "brandEntityType": "PROPRIETORSHIP",
      "matched": true
    },
    "duplicateDetails": {
      "panBrandIds": [],
      "gstBrandIds": [],
      "bankBrandIds": [],
      "whatsappBrandIds": [],
      "emailBrandIds": []
    },
    "remarks": [],
    "verifiedAt": "2026-08-23T10:15:30.000Z",
    "verifiedBy": "SYSTEM",
    "isRejected": false,
    "isReviewed": false,
    "isAdminApproved": false,
    "isRevoked": false,
    "isSuperseded": false,
    "isDeleted": false,
    "createdAt": "2026-08-23T10:15:30.000Z",
    "updatedAt": "2026-08-23T10:15:30.000Z"
  }
}
```

### Response `200` — low score (system ne reject kiya)

```json
{
  "success": true,
  "message": "Brand's vendor verified successfully.",
  "data": {
    "_id": "68a1f4c2b1e2c3d4e5f60802",
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "attemptNumber": 2,
    "score": 55,
    "status": "REJECTED",
    "flags": {
      "panVerified": true,
      "gstVerified": false,
      "bankVerified": false,
      "panMatchedWithGST": false,
      "panMatchedWithBrand": true,
      "gstMatchedWithBrand": false,
      "bankMatched": false,
      "businessEntityMatched": true,
      "gstActive": false,
      "duplicatePAN": false,
      "duplicateGST": false,
      "duplicateBank": false,
      "duplicateWhatsapp": false,
      "duplicateEmail": false
    },
    "nameMatch": {
      "panGstScore": 0,
      "panBrandScore": 100,
      "gstBrandScore": 0,
      "averageScore": 33.33
    },
    "bankNameMatch": {
      "bankPanScore": 0,
      "bankGstScore": 0,
      "bankBrandScore": 0,
      "highestScore": 0
    },
    "entityMatch": {
      "gstConstitution": null,
      "brandEntityType": "PROPRIETORSHIP",
      "matched": true
    },
    "duplicateDetails": {
      "panBrandIds": [],
      "gstBrandIds": [],
      "bankBrandIds": [],
      "whatsappBrandIds": [],
      "emailBrandIds": []
    },
    "remarks": [
      "GST verification failed",
      "Bank verification failed",
      "Business name mismatch (33.33%)",
      "Bank holder name mismatch (0%)",
      "GST not active"
    ],
    "verifiedBy": "SYSTEM",
    "rejectedBy": "SYSTEM",
    "rejectedAt": "2026-08-23T10:15:30.000Z",
    "rejectionReason": "GST verification failed | Bank verification failed | Business name mismatch (33.33%) | Bank holder name mismatch (0%) | GST not active",
    "isRejected": true,
    "isReviewed": false,
    "isAdminApproved": false,
    "isRevoked": false,
    "isSuperseded": false,
    "isDeleted": false,
    "createdAt": "2026-08-23T10:15:30.000Z",
    "updatedAt": "2026-08-23T10:15:30.000Z"
  }
}
```

### Side effects

| Collection | Kya hota hai |
|---|---|
| `systemverifies` | Naya record; purana (agar tha) `isSuperseded: true` + `supersededAt` + `supersededById` |
| `brands` | `systemVerifyId`, `status: UNDER_REVIEW`, `verificationAttemptCount`, saare admin-decision fields `null`/`false` reset |
| `users` | `currentScreen: PARTNERSHIP_DEED` |
| `brandverificationhistories` | `SYSTEM_VERIFIED` (attempt 1) ya `RESUBMITTED` (attempt ≥ 2) |

### Errors

| Status | Message | Kab |
|---|---|---|
| `401` | `Unauthorized access. User not found.` | User delete ho gaya |
| `403` | `Your account is inactive/deactivated! Please contact support.` | `user.isActive: false` |
| `403` | `You are not authorized to verify a brand.` | Role `VENDOR` nahi |
| `400` | `Brand not found for user.` | `user.brandId` nahi |
| `404` | `Brand not found.` | Brand delete ho gaya |
| `400` | `Your brand is already approved. Verification cannot be run again.` | `Brand.isApproved: true` ya attempt `isAdminApproved: true` |
| `409` | `Your brand verification is already under review. Please wait for the admin's decision.` | Live attempt na rejected na revoked hai |
| `409` | `Brand state changed while verifying. Please refresh and try again.` | Double-submit — compare-and-swap fail |

> **Re-run rule:** system verify sirf tab dobara chalega jab live attempt `REJECTED` ya `REVOKED` ho. `UNDER_REVIEW` pe baitha attempt lock hai.

---

## 2. GET /brands/admin/verifications

Admin ka work-queue. Default me sirf **live attempts** (superseded chhupe rehte hain).

| | |
|---|---|
| **Method** | `GET` |
| **Full path** | `/trydood/v1/brands/admin/verifications` |
| **Auth** | `isAdmin` → role `ADMIN` |
| **Validator** | `validateGetAllBrandVerifications` |
| **Service** | `services/systemVerify/getAllBrandVerifications.js` |

### Query params (sab optional)

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | number ≥ 1 | `1` | |
| `limit` | number 1-100 | `10` | |
| `search` | string | — | Regex on `brand.brandName`, `brand.legalBusinessName`, `brand.uniqueId`, `brand.merchantId`, `remarks` |
| `brandId` | ObjectId | — | |
| `reviewedByAdminId` | ObjectId | — | Kis admin ne review kiya |
| `status` | `SYSTEM_VERIFICATION_STATUS` | — | Uppercase auto |
| `attemptNumber` | number ≥ 1 | — | |
| `isReviewed` | boolean/string | — | `"true"` / `"false"` dono chalte hain |
| `isRejected` | boolean/string | — | |
| `isRevoked` | boolean/string | — | |
| `isAdminApproved` | boolean/string | — | |
| `isSuperseded` | boolean/string | `false` | `true` bhejo to purane attempts bhi aayenge |
| `minScore` | number | — | |
| `maxScore` | number | — | |
| `fromDate` | ISO date | — | |
| `toDate` | ISO date | — | `fromDate` se pehle nahi ho sakti; end-of-day tak inclusive |
| `sortBy` | `NEWEST` \| `OLDEST` \| `SCORE` | `NEWEST` | |
| `sortOrder` | `ASC` \| `DESC` | `DESC` | Sirf `sortBy=SCORE` pe asar |

### Example request

```
GET /trydood/v1/brands/admin/verifications?status=MANUAL_REVIEW&isReviewed=false&sortBy=SCORE&sortOrder=DESC&page=1&limit=10
Authorization: Bearer <adminAccessToken>
```

### Response `200`

```json
{
  "success": true,
  "message": "Brand verifications fetched successfully.",
  "data": {
    "total": 24,
    "totalPages": 3,
    "page": 1,
    "limit": 10,
    "data": [
      {
        "_id": "68a1f4c2b1e2c3d4e5f60801",
        "brandId": "68a1f4c2b1e2c3d4e5f60718",
        "attemptNumber": 2,
        "score": 85,
        "status": "MANUAL_REVIEW",
        "flags": {
          "panVerified": true,
          "gstVerified": true,
          "bankVerified": true,
          "panMatchedWithGST": true,
          "panMatchedWithBrand": true,
          "gstMatchedWithBrand": true,
          "bankMatched": false,
          "businessEntityMatched": true,
          "gstActive": true,
          "duplicatePAN": false,
          "duplicateGST": false,
          "duplicateBank": false,
          "duplicateWhatsapp": false,
          "duplicateEmail": false
        },
        "nameMatch": {
          "panGstScore": 100,
          "panBrandScore": 96,
          "gstBrandScore": 96,
          "averageScore": 97.33
        },
        "bankNameMatch": {
          "bankPanScore": 62,
          "bankGstScore": 58,
          "bankBrandScore": 60,
          "highestScore": 62
        },
        "entityMatch": {
          "gstConstitution": "Proprietorship",
          "brandEntityType": "PROPRIETORSHIP",
          "matched": true
        },
        "duplicateDetails": {
          "panBrandIds": [],
          "gstBrandIds": [],
          "bankBrandIds": [],
          "whatsappBrandIds": [],
          "emailBrandIds": []
        },
        "remarks": ["Bank holder name mismatch (62%)"],
        "verifiedBy": "SYSTEM",
        "verifiedAt": null,
        "rejectedBy": null,
        "rejectedAt": null,
        "rejectionReason": null,
        "reviewedAt": null,
        "reviewedByAdminId": null,
        "adminApprovedAt": null,
        "revokedBy": null,
        "revokedAt": null,
        "revokeReason": null,
        "isReviewed": false,
        "isRejected": false,
        "isRevoked": false,
        "isAdminApproved": false,
        "isSuperseded": false,
        "isDeleted": false,
        "createdAt": "2026-08-23T10:15:30.000Z",
        "updatedAt": "2026-08-23T10:15:30.000Z",
        "brand": {
          "_id": "68a1f4c2b1e2c3d4e5f60718",
          "brandName": "test cafe",
          "legalBusinessName": "test cafe private limited",
          "uniqueId": "DOOD-0001",
          "merchantId": "MID-0001",
          "logo": "https://res.cloudinary.com/.../logo.png",
          "email": "cafe@example.com",
          "mobile": "9876543210",
          "whatsappNumber": "9876543210",
          "businessEntityType": "PROPRIETORSHIP",
          "businessRegistrationStatus": "REGISTERED",
          "status": "UNDER_REVIEW",
          "verificationAttemptCount": 2,
          "isApproved": false,
          "isReviewed": false,
          "isRejected": false
        },
        "vendor": {
          "_id": "68a1f4c2b1e2c3d4e5f60700",
          "name": "Ramesh Kumar",
          "email": "ramesh@example.com",
          "mobile": "9876543210",
          "role": "VENDOR",
          "currentScreen": "UNDER_REVIEW"
        },
        "reviewedByAdmin": null,
        "verifiedByAdmin": null,
        "rejectedByAdmin": null,
        "revokedByAdmin": null,
        "rejectionCount": 1,
        "revocationCount": 0,
        "submissionCount": 2
      }
    ]
  }
}
```

### Derived counters

| Field | Matlab |
|---|---|
| `rejectionCount` | Is brand ka kitni baar `REJECTED` hua (poore history se) |
| `revocationCount` | Kitni baar approval revoke hui |
| `submissionCount` | Total system-verify submissions (pehla + saare resubmits) |

### Errors

| Status | Message |
|---|---|
| `404` | `No any brand verification found` — koi record match nahi hua (empty state) |
| `422` | `Invalid Brand ID format` |
| `422` | `Invalid Reviewed By ID format` |
| `422` | `Status must be one of PENDING, APPROVED, MANUAL_REVIEW, UNDER_REVIEW, REJECTED, REVOKED` |
| `422` | `Sort by must be one of NEWEST, OLDEST, SCORE` |
| `422` | `Sort order must be one of ASC, DESC` |
| `422` | `To date cannot be earlier than from date` |
| `422` | `Page must be at least 1` |
| `422` | `Limit must be at least 1` / `Limit cannot exceed 100` |

> ObjectId ke do error message hain: Joi pehle chalti hai → `Invalid Brand ID format`. Agar kabhi Joi bypass ho, to service ka `validateObjectId` `Invalid Brand Id` / `Invalid Reviewed By Id` deta hai (bhi `422`).

---

## 3. PUT /brands/admin/verifications/:brandId/review

**Ye main admin API hai** — approve / reject / revoke / reviewed-toggle, sab isi se.

| | |
|---|---|
| **Method** | `PUT` |
| **Full path** | `/trydood/v1/brands/admin/verifications/:brandId/review` |
| **Auth** | `isAdmin` → role `ADMIN` |
| **Validator** | `validateReviewBrandVerification` |
| **Service** | `services/systemVerify/reviewBrandVerification.js` |
| **Transactional** | ✅ + optimistic locking (concurrent admin pe `409`) |

### Path param

| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body

| Field | Type | Required | Allowed with |
|---|---|---|---|
| `action` | `APPROVED` \| `REJECTED` \| `REVIEWED` \| `REVOKED` | ✅ | — (lowercase bhi chalega, uppercase ho jaata hai) |

**Success message action ke hisaab se badalta hai:**

| Result `action` | `message` |
|---|---|
| `APPROVED` | `Brand approved successfully.` |
| `REJECTED` | `Brand rejected successfully.` |
| `REVOKED` | `Brand approval revoked successfully.` |
| `REVIEWED` | `Brand marked as reviewed.` |
| `UNREVIEWED` | `Brand marked as not reviewed.` |
| *(fallback)* | `Brand verification updated successfully.` — defensive, practically nahi aata |
| `rejectionReason` | string, 1-1000 | ✅ sirf `REJECTED` pe | **sirf** `REJECTED` — warna `422` |
| `revokeReason` | string, 1-1000 | ✅ sirf `REVOKED` pe | **sirf** `REVOKED` — warna `422` |
| `isReviewed` | boolean | ❌ | **sirf** `REVIEWED` — warna `422`. Na bhejo to toggle, bhejo to force |
| `note` | string, ≤ 1000 | ❌ | koi bhi action. History ke `reason` (approve/review) aur `metadata.note` me jaata hai |

---

### Case A — `APPROVED`, jab system pehle se APPROVED tha (confirm only)

`verifiedBy` **`SYSTEM` hi rehta hai** — admin ne sirf confirm kiya, dobara verify nahi kiya.

**Request**

```json
{
  "action": "APPROVED"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Brand approved successfully.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "brandName": "test cafe",
    "brandUniqueId": "DOOD-0001",
    "merchantId": "MID-0001",
    "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
    "historyId": "68a1f4c2b1e2c3d4e5f60901",
    "action": "APPROVED",
    "attemptNumber": 1,
    "score": 100,
    "previousStatus": "APPROVED",
    "status": "APPROVED",
    "brandStatus": "APPROVED",
    "isReviewed": true,
    "isRejected": false,
    "isRevoked": false,
    "isAdminApproved": true,
    "isApproved": true,
    "verifiedBy": "SYSTEM",
    "rejectionReason": null,
    "revokeReason": null,
    "reviewedBy": "68a1f4c2b1e2c3d4e5f60600",
    "reviewedAt": "2026-08-23T11:00:00.000Z"
  }
}
```

---

### Case B — `APPROVED` manual override (system ne `MANUAL_REVIEW` / `REJECTED` diya tha)

`verifiedBy` **`ADMIN`** ho jaata hai, `verifiedAt` + `verifiedByAdminId` set hote hain, purani rejection clear hoti hai.

**Request**

```json
{
  "action": "APPROVED",
  "note": "Bank passbook manually verified over call"
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Brand approved successfully.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "brandName": "test cafe",
    "brandUniqueId": "DOOD-0001",
    "merchantId": "MID-0001",
    "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
    "historyId": "68a1f4c2b1e2c3d4e5f60902",
    "action": "APPROVED",
    "attemptNumber": 2,
    "score": 85,
    "previousStatus": "MANUAL_REVIEW",
    "status": "APPROVED",
    "brandStatus": "APPROVED",
    "isReviewed": true,
    "isRejected": false,
    "isRevoked": false,
    "isAdminApproved": true,
    "isApproved": true,
    "verifiedBy": "ADMIN",
    "rejectionReason": null,
    "revokeReason": null,
    "reviewedBy": "68a1f4c2b1e2c3d4e5f60600",
    "reviewedAt": "2026-08-23T11:00:00.000Z"
  }
}
```

**`APPROVED` ke side effects (dono cases)**

| Collection | Fields |
|---|---|
| `systemverifies` | `status: APPROVED`, `isAdminApproved: true`, `isReviewed: true`, `isRejected: false`, `isRevoked: false`, `reviewedByAdminId`, `reviewedAt`, `adminApprovedAt`, rejection+revoke fields `null`; Case B me `verifiedBy: ADMIN` + `verifiedByAdminId` + `verifiedAt` |
| `brands` | `status: APPROVED`, **`isApproved: true`**, `isReviewed: true`, `verifiedBy`, `verifiedAt`, `reviewedByAdminId`, `reviewedAt`, `approvedByAdminId`, `approvedAt`, `isApprovalAcknowledged: false` |
| `users` | 📌 **kuch nahi** — vendor `UNDER_REVIEW` screen pe hi rehta hai |
| `brandverificationhistories` | `APPROVED` row, `metadata.manualOverride` = Case A me `false`, Case B me `true` |

> **Reviewer preserve hota hai:** agar kisi doosre admin ne pehle `REVIEWED` toggle kiya tha, to `reviewedByAdminId`/`reviewedAt` uske hi rehte hain; `approvedByAdminId` current admin ka hota hai.

---

### Case C — `REJECTED`

**Request**

```json
{
  "action": "REJECTED",
  "rejectionReason": "GST registration is cancelled. Please upload an active GST certificate."
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Brand rejected successfully.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "brandName": "test cafe",
    "brandUniqueId": "DOOD-0001",
    "merchantId": "MID-0001",
    "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
    "historyId": "68a1f4c2b1e2c3d4e5f60903",
    "action": "REJECTED",
    "attemptNumber": 1,
    "score": 85,
    "previousStatus": "MANUAL_REVIEW",
    "status": "REJECTED",
    "brandStatus": "REJECTED",
    "isReviewed": true,
    "isRejected": true,
    "isRevoked": false,
    "isAdminApproved": false,
    "isApproved": false,
    "verifiedBy": null,
    "rejectionReason": "GST registration is cancelled. Please upload an active GST certificate.",
    "revokeReason": null,
    "reviewedBy": "68a1f4c2b1e2c3d4e5f60600",
    "reviewedAt": "2026-08-23T11:05:00.000Z"
  }
}
```

**Side effects**

| Collection | Fields |
|---|---|
| `systemverifies` | `status: REJECTED`, `isRejected: true`, `isReviewed: true`, `isAdminApproved: false`, `rejectedBy: ADMIN`, `rejectedByAdminId`, `rejectedAt`, `rejectionReason`, `adminApprovedAt: null` |
| `brands` | `status: REJECTED`, `isApproved: false`, `isRejected: true`, `isReviewed: true`, `rejectedByAdminId`, `rejectedAt`, `rejectionReason`, `approvedByAdminId: null`, `approvedAt: null`, `verifiedBy: null`, `verifiedAt: null` |
| `users` | 📌 **kuch nahi** — failure case me `currentScreen` nahi badalta |
| `brandverificationhistories` | `REJECTED` row, `reason` = rejectionReason |

> **System ne pehle reject kiya tha?** Admin reject karega to `rejectedBy` `SYSTEM` → `ADMIN` ho jaayega aur `rejectedAt` naya. Ye allowed hai (pehli admin decision).
> **Admin ne pehle reject kiya tha?** `409` — vendor ko resubmit karna padega. Duplicate decision block hai.

---

### Case D — `REVIEWED` (toggle)

Status ko **bilkul nahi** chhuta. Sirf "dekh liya" flag.

**Request — toggle (flag flip)**

```json
{
  "action": "REVIEWED"
}
```

**Request — force (idempotent panel ke liye)**

```json
{
  "action": "REVIEWED",
  "isReviewed": true
}
```

**Response `200` (false → true)**

```json
{
  "success": true,
  "message": "Brand marked as reviewed.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "brandName": "test cafe",
    "brandUniqueId": "DOOD-0001",
    "merchantId": "MID-0001",
    "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
    "historyId": "68a1f4c2b1e2c3d4e5f60904",
    "action": "REVIEWED",
    "attemptNumber": 1,
    "score": 85,
    "previousStatus": "MANUAL_REVIEW",
    "status": "MANUAL_REVIEW",
    "brandStatus": "UNDER_REVIEW",
    "isReviewed": true,
    "isRejected": false,
    "isRevoked": false,
    "isAdminApproved": false,
    "isApproved": false,
    "verifiedBy": "SYSTEM",
    "rejectionReason": null,
    "revokeReason": null,
    "reviewedBy": "68a1f4c2b1e2c3d4e5f60600",
    "reviewedAt": "2026-08-23T11:10:00.000Z"
  }
}
```

**Response `200` (true → false)** — `action` `"UNREVIEWED"` aata hai, message `"Brand marked as not reviewed."`, aur `reviewedByAdminId`/`reviewedAt` `null` ho jaate hain.

**Side effects**

| Collection | Fields |
|---|---|
| `systemverifies` | Sirf `isReviewed`, `reviewedByAdminId`, `reviewedAt` |
| `brands` | Sirf `isReviewed`, `reviewedByAdminId`, `reviewedAt` |
| `users` | kuch nahi |
| `brandverificationhistories` | `REVIEWED` ya `UNREVIEWED` row — **har flip ka apna row** |

---

### Case E — `REVOKED`

Pehle di gayi approval wapas leta hai. Attempt phir se actionable ho jaata hai.

**Request**

```json
{
  "action": "REVOKED",
  "revokeReason": "GST was cancelled by the department after approval. Brand suspended pending fresh documents."
}
```

**Response `200`**

```json
{
  "success": true,
  "message": "Brand approval revoked successfully.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "brandName": "test cafe",
    "brandUniqueId": "DOOD-0001",
    "merchantId": "MID-0001",
    "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
    "historyId": "68a1f4c2b1e2c3d4e5f60905",
    "action": "REVOKED",
    "attemptNumber": 1,
    "score": 100,
    "previousStatus": "APPROVED",
    "status": "REVOKED",
    "brandStatus": "REVOKED",
    "isReviewed": true,
    "isRejected": false,
    "isRevoked": true,
    "isAdminApproved": false,
    "isApproved": false,
    "verifiedBy": null,
    "rejectionReason": null,
    "revokeReason": "GST was cancelled by the department after approval. Brand suspended pending fresh documents.",
    "reviewedBy": "68a1f4c2b1e2c3d4e5f60600",
    "reviewedAt": "2026-08-23T12:00:00.000Z"
  }
}
```

**Side effects**

| Collection | Fields |
|---|---|
| `systemverifies` | `status: REVOKED`, `isRevoked: true`, `isAdminApproved: false`, `isReviewed: true`, `revokedBy: ADMIN`, `revokedByAdminId`, `revokedAt`, `revokeReason`, `adminApprovedAt: null` |
| `brands` | `status: REVOKED`, **`isApproved: false`**, `isRevoked: true`, `revokedByAdminId`, `revokedAt`, `revokeReason`, `approvedByAdminId: null`, `approvedAt: null`, `verifiedBy: null`, `verifiedAt: null`, `isApprovalAcknowledged: false` |
| `users` | kuch nahi |
| `brandverificationhistories` | `REVOKED` row, `reason` = revokeReason |

**Revoke ke baad do raste** (dono khule rehte hain):
1. Admin dobara `APPROVED` bhej sakta hai → wapas approve (manual override path)
2. Vendor `GET /onboarding/system-verify` chala sakta hai → naya attempt

> `isApproved: false` hone se brand customer listing me unverified ho jaata hai (`helpers/vouchers/customerListing.js` → `isVerified: brand.isApproved`).

---

### Errors (saare actions)

**Validation `422`**

| Message |
|---|
| `Brand ID is required` |
| `Invalid Brand ID format` |
| `Review action is required` |
| `Review action cannot be empty` |
| `Review action must be one of APPROVED, REJECTED, REVIEWED, REVOKED` |
| `Rejection reason is required when rejecting a brand` |
| `Rejection reason is only allowed when rejecting a brand` |
| `Rejection reason cannot exceed 1000 characters` |
| `Revoke reason is required when revoking an approval` |
| `Revoke reason is only allowed when revoking an approval` |
| `Revoke reason cannot exceed 1000 characters` |
| `isReviewed is only allowed with the REVIEWED action` |
| `isReviewed must be a boolean` |
| `Note cannot be empty` |
| `Note cannot exceed 1000 characters` |

**Business `400` / `401` / `404` / `409`**

| Status | Message | Kab |
|---|---|---|
| `401` | `Admin authentication is required.` | `req.userId` nahi |
| `400` | `Invalid brand ID.` | Service-level ObjectId check |
| `400` | `Invalid review action. Allowed actions are APPROVED, REJECTED, REVIEWED, REVOKED.` | Service-level (Joi bypass) |
| `400` | `Rejection reason is required when rejecting a brand.` | |
| `400` | `Revoke reason is required when revoking an approval.` | |
| `400` | `Note cannot exceed 1000 characters.` | |
| `404` | `Brand not found.` | |
| `400` | `System verification has not been completed for this brand yet.` | `brand.systemVerifyId` nahi |
| `404` | `Brand's system verification record not found.` | Record delete ho gaya |
| `409` | `This verification attempt was superseded by a newer submission. Please refresh and act on the latest one.` | Vendor ne beech me resubmit kar diya |
| `409` | `This brand is already approved.` | `APPROVED` dobara |
| `409` | `An approved brand cannot be rejected. Revoke the approval instead.` | Approved pe `REJECTED` |
| `409` | `This verification attempt is already rejected. The vendor must resubmit before it can be actioned again.` | Admin-rejected pe `REJECTED` dobara |
| `409` | `Only an approved brand can have its approval revoked.` | Non-approved pe `REVOKED` |
| `409` | `The reviewed flag cannot be changed for an already approved brand.` | Approved pe `REVIEWED` |
| `400` | `This brand's verification is already marked as reviewed.` | `isReviewed: true` force, already true |
| `400` | `This brand's verification is already marked as not reviewed.` | `isReviewed: false` force, already false |
| `409` | `This brand verification was updated by someone else. Please refresh and try again.` | Do admin ek saath — optimistic lock |
| `409` | `Brand state changed while reviewing. Please refresh and try again.` | Brand ka `systemVerifyId` beech me badal gaya |

---

## 4. PUT /brands/onboarding/acknowledge-approval

Vendor congratulations screen dismiss karta hai → `currentScreen` `DASHBOARD` ho jaata hai. **Onboarding ka STEP 3.**

| | |
|---|---|
| **Method** | `PUT` |
| **Full path** | `/trydood/v1/brands/onboarding/acknowledge-approval` |
| **Auth** | `isVendor` → role `VENDOR` |
| **Validator** | koi nahi (body nahi lagta) |
| **Service** | `services/systemVerify/acknowledgeBrandApproval.js` |
| **Transactional** | ✅ · **Idempotent** — double tap safe |

### Request

Koi body nahi.

```
PUT /trydood/v1/brands/onboarding/acknowledge-approval
Authorization: Bearer <vendorAccessToken>
```

### Response `200`

```json
{
  "success": true,
  "message": "Welcome aboard! Redirecting you to your dashboard.",
  "data": {
    "brandId": "68a1f4c2b1e2c3d4e5f60718",
    "status": "APPROVED",
    "isApproved": true,
    "isApprovalAcknowledged": true,
    "approvalAcknowledgedAt": "2026-08-23T11:30:00.000Z",
    "currentScreen": "DASHBOARD"
  }
}
```

### Side effects

| Collection | Fields |
|---|---|
| `brands` | `isApprovalAcknowledged: true`, `approvalAcknowledgedAt` |
| `users` | `currentScreen: DASHBOARD` |
| `brandverificationhistories` | `APPROVAL_ACKNOWLEDGED` row (`performedByType: VENDOR`) — **sirf pehli baar** |

### Errors

| Status | Message | Kab |
|---|---|---|
| `401` | `Unauthorized access. User not found.` | |
| `403` | `Your account is inactive/deactivated! Please contact support.` | |
| `403` | `You are not authorized to acknowledge brand approval.` | Role `VENDOR` nahi |
| `400` | `Brand not found for user.` | |
| `404` | `Brand not found.` | |
| `400` | `Your brand is not approved yet. Please wait for the admin's decision.` | `Brand.isApproved: false` |
| `409` | `Brand approval changed while acknowledging. Please refresh and try again.` | Approval beech me revoke ho gayi |

### Idempotency

Already acknowledged **aur** `currentScreen` already `DASHBOARD` → koi write nahi hoti, wahi payload wapas aata hai. Double tap se duplicate history row nahi banega.

---

## 5. GET /brands/verifications/history

Audit trail. **Admin** kisi bhi brand ka dekh sakta hai, **vendor** sirf apna (aur trimmed).

| | |
|---|---|
| **Method** | `GET` |
| **Full path** | `/trydood/v1/brands/verifications/history` |
| **Auth** | `verifyJwtToken` → koi bhi logged-in role |
| **Validator** | `validateGetBrandVerificationHistory` |
| **Service** | `services/systemVerify/getBrandVerificationHistory.js` |

### Query params (sab optional)

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | number ≥ 1 | `1` | |
| `limit` | number 1-100 | `10` | |
| `brandId` | ObjectId | — | ⚠️ **Vendor ke liye ignore** — service force karke apna `brandId` lagati hai |
| `systemVerifyId` | ObjectId | — | Ek hi attempt ka trail |
| `performedBy` | ObjectId | — | Kis user ne action kiya |
| `action` | `BRAND_VERIFICATION_ACTION` | — | |
| `performedByType` | `SYSTEM` \| `ADMIN` \| `VENDOR` | — | |
| `attemptNumber` | number ≥ 1 | — | |
| `search` | string | — | Regex on `brandUniqueId`, `merchantId`, `reason` |
| `fromDate` | ISO date | — | |
| `toDate` | ISO date | — | `fromDate` se pehle nahi |
| `sortOrder` | `ASC` \| `DESC` | `DESC` | `createdAt` pe |

### Example request (admin)

```
GET /trydood/v1/brands/verifications/history?brandId=68a1f4c2b1e2c3d4e5f60718&sortOrder=DESC&page=1&limit=20
Authorization: Bearer <adminAccessToken>
```

### Response `200` — ADMIN view (poora)

```json
{
  "success": true,
  "message": "Brand verification history fetched successfully.",
  "data": {
    "total": 5,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68a1f4c2b1e2c3d4e5f60905",
        "brandId": "68a1f4c2b1e2c3d4e5f60718",
        "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
        "action": "REJECTED",
        "performedByType": "ADMIN",
        "performedBy": "68a1f4c2b1e2c3d4e5f60600",
        "attemptNumber": 2,
        "brandUniqueId": "DOOD-0001",
        "merchantId": "MID-0001",
        "score": 85,
        "previousStatus": "MANUAL_REVIEW",
        "newStatus": "REJECTED",
        "reason": "GST registration is cancelled. Please upload an active GST certificate.",
        "metadata": {
          "requestedAction": "REJECTED",
          "previousBrandStatus": "UNDER_REVIEW",
          "newBrandStatus": "REJECTED",
          "previousFlags": {
            "isReviewed": false,
            "isRejected": false,
            "isRevoked": false,
            "isAdminApproved": false,
            "isBrandApproved": false
          },
          "newFlags": {
            "isReviewed": true,
            "isRejected": true,
            "isRevoked": false,
            "isAdminApproved": false,
            "isBrandApproved": false
          },
          "systemScore": 85,
          "systemRemarks": ["Bank holder name mismatch (62%)"],
          "note": null,
          "manualOverride": false
        },
        "createdAt": "2026-08-23T11:05:00.000Z",
        "updatedAt": "2026-08-23T11:05:00.000Z",
        "brand": {
          "_id": "68a1f4c2b1e2c3d4e5f60718",
          "brandName": "test cafe",
          "legalBusinessName": "test cafe private limited",
          "uniqueId": "DOOD-0001",
          "merchantId": "MID-0001",
          "logo": "https://res.cloudinary.com/.../logo.png",
          "status": "REJECTED",
          "isApproved": false,
          "isReviewed": true,
          "isRejected": true
        },
        "performedByUser": {
          "_id": "68a1f4c2b1e2c3d4e5f60600",
          "name": "Admin One",
          "email": "admin@trydood.com",
          "mobile": "9999999999",
          "role": "ADMIN"
        }
      },
      {
        "_id": "68a1f4c2b1e2c3d4e5f60899",
        "brandId": "68a1f4c2b1e2c3d4e5f60718",
        "systemVerifyId": "68a1f4c2b1e2c3d4e5f60801",
        "action": "RESUBMITTED",
        "performedByType": "SYSTEM",
        "performedBy": "68a1f4c2b1e2c3d4e5f60700",
        "attemptNumber": 2,
        "brandUniqueId": "DOOD-0001",
        "merchantId": "MID-0001",
        "score": 85,
        "previousStatus": "REJECTED",
        "newStatus": "MANUAL_REVIEW",
        "reason": null,
        "metadata": {
          "triggeredByType": "VENDOR",
          "triggeredBy": "68a1f4c2b1e2c3d4e5f60700",
          "isResubmission": true,
          "previousSystemVerifyId": "68a1f4c2b1e2c3d4e5f60800",
          "systemStatus": "MANUAL_REVIEW",
          "brandStatus": "UNDER_REVIEW",
          "flags": { "panVerified": true, "gstVerified": true },
          "nameMatch": { "averageScore": 97.33 },
          "bankNameMatch": { "highestScore": 62 },
          "entityMatch": { "matched": true },
          "duplicateDetails": { "panBrandIds": [] },
          "remarks": ["Bank holder name mismatch (62%)"]
        },
        "createdAt": "2026-08-23T10:15:30.000Z",
        "updatedAt": "2026-08-23T10:15:30.000Z",
        "brand": { "_id": "68a1f4c2b1e2c3d4e5f60718", "brandName": "test cafe" },
        "performedByUser": {
          "_id": "68a1f4c2b1e2c3d4e5f60700",
          "name": "Ramesh Kumar",
          "email": "ramesh@example.com",
          "mobile": "9876543210",
          "role": "VENDOR"
        }
      }
    ]
  }
}
```

### Response `200` — VENDOR view (trimmed)

Vendor ko **`score`, `metadata`, `performedByUser`, `merchantId`, `brandUniqueId` nahi milte** — scoring internals aur kis admin ne action liya, ye admin-side data hai. Reject kab hua aur kyun hua, wo poora dikhta hai.

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
        "_id": "68a1f4c2b1e2c3d4e5f60905",
        "brandId": "68a1f4c2b1e2c3d4e5f60718",
        "action": "REJECTED",
        "performedByType": "ADMIN",
        "attemptNumber": 2,
        "previousStatus": "MANUAL_REVIEW",
        "newStatus": "REJECTED",
        "reason": "GST registration is cancelled. Please upload an active GST certificate.",
        "createdAt": "2026-08-23T11:05:00.000Z",
        "brand": {
          "_id": "68a1f4c2b1e2c3d4e5f60718",
          "brandName": "test cafe",
          "legalBusinessName": "test cafe private limited",
          "uniqueId": "DOOD-0001",
          "merchantId": "MID-0001",
          "logo": "https://res.cloudinary.com/.../logo.png",
          "status": "REJECTED",
          "isApproved": false,
          "isReviewed": true,
          "isRejected": true
        }
      }
    ]
  }
}
```

### Errors

| Status | Message | Kab |
|---|---|---|
| `404` | `No any brand verification history found` | Empty (empty-state UI dikhao) |
| `400` | `Brand not found for user.` | Vendor ka `brandId` nahi |
| `422` | `Invalid Brand ID format` | |
| `422` | `Invalid System Verify ID format` | |
| `422` | `Invalid Performed By ID format` | |
| `422` | `Action must be one of SYSTEM_VERIFIED, RESUBMITTED, REVIEWED, UNREVIEWED, APPROVED, REJECTED, REVOKED, APPROVAL_ACKNOWLEDGED, REMEDIATION_UPDATED` | |
| `422` | `Performed by type must be one of SYSTEM, ADMIN, VENDOR` | |
| `422` | `Sort order must be one of ASC, DESC` | |
| `422` | `To date cannot be earlier than from date` | |
| `422` | `Page must be at least 1` / `Limit must be at least 1` / `Limit cannot exceed 100` | |

---

## Model Reference

### `SystemVerify` (`systemverifies`)

```json
{
  "_id": "ObjectId",
  "brandId": "ObjectId → Brand (required, indexed)",
  "attemptNumber": "Number (default 1, min 1)",
  "score": "Number (default 0)",
  "status": "SYSTEM_VERIFICATION_STATUS (default PENDING)",
  "flags": {
    "panVerified": "Boolean", "gstVerified": "Boolean", "bankVerified": "Boolean",
    "panMatchedWithGST": "Boolean", "panMatchedWithBrand": "Boolean",
    "gstMatchedWithBrand": "Boolean", "bankMatched": "Boolean",
    "businessEntityMatched": "Boolean", "gstActive": "Boolean",
    "panEmbeddedInGST": "Boolean",
    "duplicatePAN": "Boolean", "duplicateGST": "Boolean", "duplicateBank": "Boolean",
    "duplicateWhatsapp": "Boolean", "duplicateEmail": "Boolean"
  },
  "nameMatch": {
    "panGstScore": "Number", "panBrandScore": "Number",
    "gstBrandScore": "Number", "averageScore": "Number"
  },
  "bankNameMatch": {
    "bankPanScore": "Number", "bankGstScore": "Number",
    "bankBrandScore": "Number", "highestScore": "Number"
  },
  "entityMatch": {
    "gstConstitution": "String", "brandEntityType": "String", "matched": "Boolean"
  },
  "duplicateDetails": {
    "panBrandIds": "[ObjectId]", "gstBrandIds": "[ObjectId]",
    "bankBrandIds": "[ObjectId]", "whatsappBrandIds": "[ObjectId]",
    "emailBrandIds": "[ObjectId]"
  },
  "remarks": "[String]",

  "verifiedBy": "SYSTEM | ADMIN (default SYSTEM)",
  "verifiedByAdminId": "ObjectId → User",
  "verifiedAt": "Date",

  "reviewedByAdminId": "ObjectId → User",
  "reviewedAt": "Date",
  "adminApprovedAt": "Date",

  "rejectedBy": "SYSTEM | ADMIN",
  "rejectedByAdminId": "ObjectId → User",
  "rejectedAt": "Date",
  "rejectionReason": "String (max 1000)",

  "revokedBy": "SYSTEM | ADMIN",
  "revokedByAdminId": "ObjectId → User",
  "revokedAt": "Date",
  "revokeReason": "String (max 1000)",

  "isReviewed": "Boolean (default false)",
  "isAdminApproved": "Boolean (default false)",
  "isRejected": "Boolean (default false)",
  "isRevoked": "Boolean (default false)",
  "isSuperseded": "Boolean (default false)",
  "supersededAt": "Date",
  "supersededById": "ObjectId → SystemVerify",
  "isDeleted": "Boolean (default false)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:** `brandId` · `{ brandId: 1, attemptNumber: -1 }` · `{ status: 1, isReviewed: 1, createdAt: -1 }`

### `Brand` — verification mirror fields (`brands`)

```json
{
  "systemVerifyId": "ObjectId → SystemVerify (live attempt)",
  "status": "SYSTEM_VERIFICATION_STATUS (default PENDING)",
  "verificationAttemptCount": "Number (default 0)",

  "verifiedBy": "SYSTEM | ADMIN",
  "verifiedAt": "Date",
  "reviewedByAdminId": "ObjectId → User",
  "reviewedAt": "Date",
  "approvedByAdminId": "ObjectId → User",
  "approvedAt": "Date",
  "rejectedByAdminId": "ObjectId → User",
  "rejectedAt": "Date",
  "rejectionReason": "String (max 1000)",
  "revokedByAdminId": "ObjectId → User",
  "revokedAt": "Date",
  "revokeReason": "String (max 1000)",

  "isApprovalAcknowledged": "Boolean (default false)",
  "approvalAcknowledgedAt": "Date",

  "isReviewed": "Boolean (default false)",
  "isRejected": "Boolean (default false)",
  "isRevoked": "Boolean (default false)",
  "isApproved": "Boolean (default false)"
}
```

### `BrandVerificationHistory` (`brandverificationhistories`)

Append-only — koi row kabhi update nahi hoti.

```json
{
  "_id": "ObjectId",
  "brandId": "ObjectId → Brand (required)",
  "systemVerifyId": "ObjectId → SystemVerify (required)",
  "action": "BRAND_VERIFICATION_ACTION (required)",
  "performedByType": "SYSTEM | ADMIN | VENDOR (required)",
  "performedBy": "ObjectId → User (null only for unattended jobs)",
  "attemptNumber": "Number (required, min 1)",
  "brandUniqueId": "String (indexed, denormalised)",
  "merchantId": "String (indexed, denormalised)",
  "score": "Number",
  "previousStatus": "SYSTEM_VERIFICATION_STATUS",
  "newStatus": "SYSTEM_VERIFICATION_STATUS",
  "reason": "String (max 1000) — rejection/revoke reason ya admin note",
  "metadata": "Mixed (default null) — action ke hisaab se",
  "isDeleted": "Boolean (default false)",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

**Indexes:** `{ brandId: 1, createdAt: -1 }` · `{ systemVerifyId: 1, createdAt: -1 }` · `{ performedBy: 1, createdAt: -1 }` · `{ action: 1, createdAt: -1 }` · `brandUniqueId` · `merchantId`

**`metadata` shape by action:**

| Action | Keys |
|---|---|
| `SYSTEM_VERIFIED` / `RESUBMITTED` | `triggeredByType`, `triggeredBy`, `isResubmission`, `previousSystemVerifyId`, `systemStatus`, `brandStatus`, `flags`, `nameMatch`, `bankNameMatch`, `entityMatch`, `duplicateDetails`, `remarks` |
| `APPROVED` / `REJECTED` / `REVOKED` / `REVIEWED` / `UNREVIEWED` | `requestedAction`, `previousBrandStatus`, `newBrandStatus`, `previousFlags`, `newFlags`, `systemScore`, `systemRemarks`, `note`, `manualOverride` |
| `APPROVAL_ACKNOWLEDGED` | `acknowledgedAt`, `previousScreen`, `newScreen` |
| `REMEDIATION_UPDATED` | `section` (`BASIC_DETAILS`/`PAN`/`GST`/`BANK`), `changeType` (`UPDATED`/`REPLACED`), `details.fields` |

---

## Frontend Integration Notes

### Vendor panel — kaunsi screen dikhani hai

`GET /brands/get` se brand uthao, phir:

| `user.currentScreen` | `brand.status` | `brand.isApproved` | `brand.isApprovalAcknowledged` | Dikhao |
|---|---|---|---|---|
| `SYSTEM_VERIFICATION` | `PENDING` | `false` | `false` | System verify chalao |
| `PARTNERSHIP_DEED` | `UNDER_REVIEW` | `false` | `false` | Partnership deed screen |
| `UNDER_REVIEW` | `UNDER_REVIEW` | `false` | `false` | ⏳ "Aapki application review me hai" |
| `UNDER_REVIEW` | **`APPROVED`** | **`true`** | **`false`** | 🎉 **Congratulations + "Go to Dashboard" button** |
| `DASHBOARD` | `APPROVED` | `true` | `true` | Dashboard |
| any | `REJECTED` | `false` | `false` | ❌ `brand.rejectionReason` dikhao + "Fix & Resubmit" |
| any | `REVOKED` | `false` | `false` | ⚠️ `brand.revokeReason` dikhao + "Fix & Resubmit" |

**Congratulations screen ka exact behaviour:**

- Trigger: `brand.isApproved === true && brand.isApprovalAcknowledged === false`
- Button click → `PUT /brands/onboarding/acknowledge-approval`
- Uske baad `currentScreen` `DASHBOARD` ho jaata hai → **agli login ya refresh pe seedha dashboard**, message dobara nahi
- Button dabane se **pehle** refresh kiya → message phir dikhega (sahi hai, usne dismiss hi nahi kiya)
- Revoke ke baad dobara approve hua → flag reset ho chuka hai, message phir dikhega

**"Fix & Resubmit" flow:** vendor documents theek kare (`add-pan-details` / `add-gst-details` / `add-bank-details`), phir `GET /brands/onboarding/system-verify` dobara call kare. `REJECTED`/`REVOKED` pe hi allowed hai.

### Admin panel

- **Queue:** `GET /brands/admin/verifications?isReviewed=false&sortBy=SCORE&sortOrder=DESC` — sabse pehle high-score wale
- **Manual review bucket:** `?status=MANUAL_REVIEW`
- **Rejected history:** `?isRejected=true` ya `?isSuperseded=true` (purane attempts)
- **`remarks` array** hi asli value hai — admin ko har document manually kholna nahi padta, remarks batate hain kya mismatch hai
- **`409` handling:** list refresh karo aur user ko batao ki record beech me badal gaya
- **Reviewed toggle** status nahi badalta — isse "main isko dekh chuka hoon" mark karo, decision baad me lo
- Approve karne se pehle reviewed toggle karna **zaroori nahi** — approve khud hi `isReviewed: true` kar deta hai

### 📌 Deferred (abhi nahi hai)

Notifications, reason-code enum, stale-attempt expiry, aur vendor-facing lean response — sab `docs/brand_verification_future_updates.md` me tracked hain.
