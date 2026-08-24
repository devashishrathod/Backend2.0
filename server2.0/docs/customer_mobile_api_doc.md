# Trydood 2.0 — Customer Mobile App API Documentation

**Version:** 1.0.0
**Base URL (Local):** `http://localhost:8080/trydood/v1`
**Base URL (Staging):** `https://backend2-0-4v4i.onrender.com/trydood/v1`
**Framework:** Express.js (Node.js, CommonJS)
**Database:** MongoDB (Mongoose ODM)
**Scope:** Customer mobile app ke 30 endpoints
**Generated:** 2026-08-22 · Source: `server2.0` codebase scan (108 total endpoints, categorization → `endpoints_category.md`)

> **Note:** Ye doc code se banaya gaya hai, live API testing se nahi. Har request field, error message, aur response shape actual controller/service/validator code se verify kiya gaya hai. Jahan behaviour buggy ya adhoora hai, wahan ⚠️ marker hai.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Standard Response Format](#standard-response-format)
4. [Pagination](#pagination)
5. [HTTP Status Codes](#http-status-codes)
6. [Common Errors](#common-errors)
7. [Enums Reference](#enums-reference)
8. [Auth APIs](#auth-apis)
   - [POST /auth/loginOrSignUp-with-whatsapp](#1-post-authloginorsignup-with-whatsapp)
   - [POST /auth/verify-otp-whatsapp](#2-post-authverify-otp-whatsapp)
   - [POST /auth/logout](#3-post-authlogout)
9. [User Profile APIs](#user-profile-apis)
   - [GET /users/get](#4-get-usersget)
   - [PUT /users/update](#5-put-usersupdate)
   - [DELETE /users/delete](#6-delete-usersdelete)
10. [Location APIs](#location-apis)
    - [POST /locations/upsert](#7-post-locationsupsert)
    - [GET /locations/get/:id](#8-get-locationsgetid)
11. [Master Data APIs](#master-data-apis)
    - [GET /categories/getAll](#9-get-categoriesgetall)
    - [GET /categories/get/:id](#10-get-categoriesgetid)
    - [GET /subCategories/getAll](#11-get-subcategoriesgetall)
    - [GET /subCategories/get/:id](#12-get-subcategoriesgetid)
12. [Home Screen APIs](#home-screen-apis)
    - [GET /banners/customer/active](#13-get-bannerscustomeractive)
    - [GET /promotionalTickers/customer/active](#14-get-promotionaltickerscustomeractive)
13. [Voucher APIs](#voucher-apis)
    - [GET /vouchers/customer/get-all](#15-get-voucherscustomerget-all)
    - [GET /vouchers/customer/get/:voucherId](#16-get-voucherscustomergetvoucherid)
    - [POST /vouchers/customer/voucher/preview](#17-post-voucherscustomervoucherpreview)
14. [Brand Profile APIs](#brand-profile-apis)
    - [GET /brands/get](#18-get-brandsget)
    - [GET /showcase/get-brand-showcase/:brandId](#19-get-showcaseget-brand-showcasebrandid)
    - [GET /showcase/:brandId/video-clips](#20-get-showcasebrandidvideo-clips)
    - [GET /brandFeatures/get-all](#21-get-brandfeaturesget-all)
    - [GET /brandFeatures/get/:featureId](#22-get-brandfeaturesgetfeatureid)
15. [Engagement APIs](#engagement-apis)
    - [POST /follows/toggle/:brandId](#23-post-followstogglebrandid)
    - [GET /follows/get-all](#24-get-followsget-all)
    - [POST /brandAvoidances/toggle/:brandId](#25-post-brandavoidancestogglebrandid)
    - [GET /brandAvoidances/get-all](#26-get-brandavoidancesget-all)
16. [Legal APIs](#legal-apis)
    - [GET /terms-and-conditions/getAll](#27-get-terms-and-conditionsgetall)
    - [GET /terms-and-conditions/get/:id](#28-get-terms-and-conditionsgetid)
    - [GET /privacy-and-policies/getAll](#29-get-privacy-and-policiesgetall)
    - [GET /privacy-and-policies/get/:id](#30-get-privacy-and-policiesgetid)
17. [Appendix A — Not For Customer App](#appendix-a--not-for-customer-app)
18. [Appendix B — Known Issues](#appendix-b--known-issues)

---

## Overview

Customer mobile app 9 functional areas cover karta hai:

| Area | Endpoints | Kya karta hai |
|---|---:|---|
| Auth | 3 | WhatsApp OTP login/signup + logout |
| User Profile | 3 | Profile fetch, update, delete |
| Location | 2 | Customer ka single saved address |
| Master Data | 4 | Categories + Sub-categories |
| Home Screen | 2 | Active banner + promotional tickers |
| Vouchers | 3 | Nearby vouchers list, detail, discount preview |
| Brand Profile | 5 | Brand detail, showcase gallery, video clips, features |
| Engagement | 4 | Follow / Avoid brand + unki lists |
| Legal | 4 | Terms & Conditions, Privacy Policy |

**Important architecture notes:**

- **Sab endpoints pe `role` check nahi hai.** Sirf `verifyJwtToken` lagta hai — matlab customer token se vendor/admin endpoints bhi technically call ho sakte hain. Har endpoint pe **Intended** (kis role ke liye banaya) aur **Enforced** (backend actually kya rokta hai) dono likha hai. Details → [Appendix B](#appendix-b--known-issues)
- **Soft delete pattern** — kuch bhi actually delete nahi hota, `isDeleted: true` set hota hai
- **Lowercase normalization** — names, addresses, city/state/country DB me lowercase store hote hain. UI pe capitalize karna frontend ka kaam hai
- **Voucher listing geo-based hai** — customer ke coordinates chahiye (query me ya saved location se)

---

## Authentication

Login ke baad har protected request me JWT bhejna hai:

```http
Authorization: Bearer <token>
```

**Token kahan se milta hai:** `POST /auth/verify-otp-whatsapp` ke response me `data.token`

**JWT payload (decode karke ye milega):**
```json
{
  "id": "68f1a2b3c4d5e6f7a8b9c0d1",
  "role": "CUSTOMER",
  "name": "rahul sharma",
  "email": "rahul@example.com",
  "whatsappNumber": "9876543210",
  "mobile": "9876543210",
  "iat": 1755820800,
  "exp": 1758412800
}
```

**Expiry:** `JWT_EXPIRY` env variable se aata hai (server config). Token expire hone pe `401` + `"Your session has expired. Please log in again."` — app ko login screen pe bhejna hai.

⚠️ **Logout server-side token invalidate nahi karta** (koi blacklist nahi hai). Token expiry tak valid rehta hai. App ko locally token delete karna hoga.

---

## Standard Response Format

**Success:**
```json
{
  "success": true,
  "message": "User fetched successfully",
  "data": { }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Voucher not found."
}
```

Kabhi-kabhi error me extra `details` field bhi aati hai:
```json
{
  "success": false,
  "message": "Validation failed",
  "details": { }
}
```

⚠️ **Ek exception:** `DELETE /users/delete` standard envelope use **nahi** karta — wo raw `{ "message": "..." }` return karta hai, `success` field ke bina. Detail endpoint #6 pe.

---

## Pagination

Jo endpoints list return karte hain, unka `data` ye shape me aata hai:

```json
{
  "success": true,
  "message": "Categories fetched",
  "data": {
    "total": 47,
    "totalPages": 5,
    "page": 1,
    "limit": 10,
    "data": [ ]
  }
}
```

Dhyaan dijiye — `data.data` nested hai (outer `data` envelope ka hai, inner `data` actual array).

### ⚠️ Empty list = 404, empty array nahi

Ye **sabse important gotcha** hai. `pagination` utility jab koi record nahi milta to **404 throw** karti hai:

```json
{
  "success": false,
  "message": "No any category found"
}
```

Matlab: **404 ko "error" treat na karein** in list endpoints pe — wo "koi data nahi hai" ka matlab hai. Frontend ko 404 pe empty-state UI dikhana chahiye, error toast nahi.

Har list endpoint ka exact 404 message alag hai (entity name ke hisaab se) — har endpoint ke section me diya hai.

**Exception:** `GET /showcase/get-brand-showcase/:brandId` empty pe `200` + `sections: []` deta hai (404 nahi).

---

## HTTP Status Codes

| Code | Meaning | Kab aata hai |
|---|---|---|
| `200` | OK | Successful GET/PUT/POST |
| `201` | Created | Sirf `POST /locations/upsert` |
| `400` | Bad Request | Business rule fail (invalid ID, outlet not linked, location missing) |
| `401` | Unauthorized | Token missing / expired / user not found |
| `403` | Forbidden | Invalid token format, deactivated account, wrong role |
| `404` | Not Found | Resource nahi mila **ya empty list** (upar dekho) |
| `409` | Conflict | Duplicate resource |
| `422` | Unprocessable Entity | Joi validation fail, ya invalid ObjectId format |
| `500` | Server Error | Unexpected failure |

---

## Common Errors

Ye errors kisi bhi protected endpoint pe aa sakte hain — har endpoint pe repeat nahi kiye:

| Status | Message | Kab |
|---|---|---|
| `401` | `Access Denied! Missing authorization token` | `Authorization` header hi nahi bheja |
| `403` | `Access Denied! Invalid authorization token format` | Header hai par `Bearer <token>` format nahi (space ke baad kuch nahi) |
| `401` | `Your session has expired. Please log in again.` | Token expired → **login screen pe bhejo** |
| `403` | `Invalid or malformed token. Please log in again.` | Token corrupt / galat secret se signed |
| `403` | `Token not active yet. Please try again later.` | Token ka `nbf` future me hai (rare) |
| `403` | `Access Denied! Invalid token` | Decode ho gaya par payload empty |
| `404` | `Access Denied! User not found` | Token valid hai par us user ka record DB me nahi |
| `500` | `Authentication failed due to an unexpected error.` | JWT verify me unknown error |
| `422` | *(field-wise Joi message)* | Request validation fail |
| `404` | `Invalid API` | Galat endpoint path |

### Validation errors ka format

Joi validation fail hone pe saare errors ek string me join hote hain (`, ` se separated), aur field names human-readable ban jaate hain (camelCase → spaced + capitalized):

```json
{
  "success": false,
  "message": "WhatsApp number is required, OTP must be 6 digits"
}
```

**Unknown fields silently drop ho jaate hain** (`stripUnknown: true`). Matlab agar aap koi extra field bhejte ho jo validator me define nahi hai, wo error nahi degi — chup-chaap ignore ho jayegi. Debugging me ye confuse kar sakta hai.

---

## Enums Reference

Saare enum values **UPPERCASE** hain (payment ke alawa).

### ROLES
`ADMIN` · `VENDOR` · `SUB_VENDOR` · `CUSTOMER`
> Customer app hamesha `CUSTOMER` bhejega (ya skip kare — default `CUSTOMER` hai)

### ADDRESS_TYPES
`HOME` · `WORK` · `OTHER` — default `HOME`

### GENDERS
`MALE` · `FEMALE` · `OTHER`

### BANNER_TYPE
`IMAGE` · `VIDEO` · `GIF`
> Banner ka media field type ke hisaab se aata hai: `IMAGE` → `image`, `VIDEO` → `video`, `GIF` → `gif`

### BANNER_REDIRECT_TYPE / TICKER_REDIRECT_TYPE
`NONE` · `CATEGORY` · `DEAL` · `BRAND` · `OFFER` · `EXTERNAL_URL`
> `redirect.type` batata hai tap pe kahan jaana hai; `redirect.targetId` ya `redirect.url` destination deta hai

### VOUCHER_SORT_BY
| Value | Sort kis pe | Default direction |
|---|---|---|
| `DISTANCE` *(default)* | Nearest outlet pehle | asc |
| `NEWEST` | `voucher.createdAt` | desc |
| `EXPIRING_SOON` | `version.endAt` | asc |
| `RELEVANCE` | Text match score | best-match first |

> `RELEVANCE` sirf tab kaam karta hai jab `search` param bhi ho. Bina search ke ye automatically `NEWEST` ban jaata hai.

### VOUCHER_DISCOUNT_TYPES
`PERCENTAGE` · `FLAT` · ~~`FIXED`~~

⚠️ `FIXED` enum me define hai par calculation logic me **handle nahi hota** — aisa offer `discountAmount: 0` dega aur eligible list se filter ho jayega. Practically sirf `PERCENTAGE` aur `FLAT` kaam karte hain.

### VOUCHER_USAGE_TYPE
`ONCE_PER_USER` · `MULTIPLE`

### DISCOUNT_APPLICABLE_ON
`SUBTOTAL` · `FINAL_BILL`

### VOUCHER_STATUSES (reference — customer ko sirf `PUBLISHED` dikhte hain)
`DRAFT` · `UNDER_REVIEW` · `APPROVED` · `PUBLISHED` · `REJECTED` · `EXPIRED` · `PAUSED` · `ARCHIVED`

### SHOWCASE_MEDIA_TYPE
`PHOTO` · `VIDEO`

### SCREENS (onboarding step tracking — `currentScreen` field)
`BUSINESS_NAME` · `REGISTRATION_STATUS` · `REGISTRATION_ENTITY_TYPE` · `PAN_VERIFICATION` · `GST_VERIFICATION` · `BANK_VERIFICATION` · `SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `SUBSCRIBE_PLAN` · `OUTLET_PAGE` · `UNDER_REVIEW` · `DASHBOARD`
> Ye mostly vendor onboarding ke liye hai. Customer app ko generally iski zarurat nahi.

### ZIP code validation (country-wise)
`zipcode` field ka format `country` field pe depend karta hai:

| Country | Pattern | Example |
|---|---|---|
| `IN` / india *(default)* | 6 digits, first digit 1-9 | `452001` |
| `US` | 5 digits ya ZIP+4 | `90210`, `90210-1234` |
| `CA` | A1A 1A1 | `K1A 0B1` |
| `UK` | SW1A 1AA style | `SW1A 1AA` |
| `AU` | 4 digits | `2000` |
| `DE`/`FR`/`IT`/`ES` | 5 digits | `10115` |
| `BR` | 12345-678 | `01310-100` |
| `RU` | 6 digits | `101000` |

---

# Auth APIs

## 1. POST /auth/loginOrSignUp-with-whatsapp

Customer app ka **primary login endpoint**. Ek hi call login aur signup dono handle karta hai — agar number naya hai to user + customer record auto-create ho jaate hain.

**Access:** Intended: Customer + Vendor · Enforced: **Public** (koi token nahi chahiye)

### Headers
| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | ✅ |

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | Exactly 10 digits, first digit `6-9` (`/^[6-9]\d{9}$/`) |
| `role` | string | ❌ | `CUSTOMER` | Enum: `ADMIN` \| `VENDOR` \| `SUB_VENDOR` \| `CUSTOMER`. Auto-uppercase |

```json
{
  "whatsappNumber": "9876543210",
  "role": "CUSTOMER"
}
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
      "customerId": "68f1a2b3c4d5e6f7a8b9c0d2",
      "role": "CUSTOMER",
      "loginType": "WHATSAPP",
      "whatsappNumber": "9876543210",
      "uniqueId": "TDU000123",
      "referralCode": "RAHUL7X2K",
      "referralCount": 0,
      "followerCount": 0,
      "followingCount": 0,
      "reviewCount": 0,
      "walletBalance": 0,
      "tCoinsBalance": 0,
      "isEmailVerified": false,
      "isMobileVerified": false,
      "isSignUpCompleted": false,
      "isOnBoardingCompleted": false,
      "isLoggedIn": false,
      "isActive": true,
      "isDeleted": false,
      "createdAt": "2026-08-22T10:15:30.000Z",
      "updatedAt": "2026-08-22T10:15:30.000Z"
    }
  }
}
```

**`isFirst` flag:**
- `true` → naya user bana hai. App ko profile-completion screen dikhana chahiye (name, dob, email)
- `false` → existing user login kar raha hai. Direct home screen

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `Your account is deactivated. Please contact support.` | User exist karta hai par `isActive: false` |
| `422` | `WhatsApp number is required` | Field missing/empty |
| `422` | `Please enter a valid 10 digit WhatsApp number` | Pattern fail (9 digits, 0-5 se shuru, letters) |
| `422` | `Invalid role` | `role` enum me nahi |

### ⚠️ Edge cases & notes

**1. OTP actually send nahi hota.** Service me OTP send karne wali line **commented out** hai:
```js
// services/auth/loginOrSignUpWithWhatsapp.js:51
//  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
```
Message me "OTP sent" likha aata hai par WhatsApp pe kuch nahi jaata. Testing ke liye next step (`verify-otp-whatsapp`) me **koi bhi 6-digit number** kaam karega.

**2. Response me `password` hash aa raha hai.** Ye `user` object full Mongoose document hai, koi field exclusion nahi hai — matlab bcrypt password hash bhi response me aata hai. Naye users ka password ek shared default value hota hai. Frontend ko is field ko touch nahi karna chahiye. Ye security issue hai → [Appendix B](#appendix-b--known-issues)

**3. Role + number ka combination unique hai.** Same number `CUSTOMER` aur `VENDOR` dono roles me register ho sakta hai — dono alag users honge. Isliye `role` bhejna important hai (ya default `CUSTOMER` pe rely karo).

**4. Naya customer banne pe kya hota hai:** `User` doc + `Customer` doc dono bante hain, aur `user.customerId` link ho jaata hai. `uniqueId` aur `referralCode` auto-generate hote hain.

**5. Idempotent nahi hai** — same number pe dobara call karne se naya user nahi banta (existing mil jaata hai), par `isFirst: false` aayega.

---

## 2. POST /auth/verify-otp-whatsapp

OTP verify karke JWT token deta hai. **Yahi se app ka token milta hai.**

**Access:** Intended: Customer + Vendor · Enforced: **Public**

### Headers
| Header | Value | Required |
|---|---|---|
| `Content-Type` | `application/json` | ✅ |

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `whatsappNumber` | string | ✅ | – | 10 digits, first `6-9` |
| `otp` | string | ✅ | – | Exactly 6 characters (string, number nahi) |
| `role` | string | ❌ | `CUSTOMER` | ROLES enum, auto-uppercase |
| `currentScreen` | string | ❌ | – | SCREENS enum (auto-uppercase + trim) |

```json
{
  "whatsappNumber": "9876543210",
  "otp": "123456",
  "role": "CUSTOMER"
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "user": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
      "customerId": "68f1a2b3c4d5e6f7a8b9c0d2",
      "role": "CUSTOMER",
      "whatsappNumber": "9876543210",
      "uniqueId": "TDU000123",
      "referralCode": "RAHUL7X2K",
      "isMobileVerified": true,
      "isActive": true,
      "createdAt": "2026-08-22T10:15:30.000Z",
      "updatedAt": "2026-08-22T10:16:12.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZjFhMmIzYzRkNWU2ZjdhOGI5YzBkMSIsInJvbGUiOiJDVVNUT01FUiJ9.abc123xyz"
  }
}
```

Verify hone pe backend `isMobileVerified: true` set kar deta hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Invalid Whatsapp number, user not found!` | Is number + role ka user nahi hai (pehle step-1 call karo) |
| `422` | `OTP is required` | `otp` missing |
| `422` | `OTP must be 6 digits` | Length 6 nahi |
| `422` | `Please enter a valid 10 digit WhatsApp number` | Number pattern fail |
| `422` | *(mongoose validation)* | `currentScreen` SCREENS enum me nahi (niche note 3 dekho) |

### ⚠️ Edge cases & notes

**1. OTP verify nahi hota — koi bhi 6-digit chalega.** Verification line commented out hai:
```js
// services/auth/verifyOtpWithWhatsapp.js:11
//  await verifyOtp(whatsappNumber, otp);
```
Matlab `"000000"` bhi valid token de dega. Ye **auth bypass** hai → [Appendix B](#appendix-b--known-issues). Testing ke liye convenient, production ke liye blocker.

**2. `otp` string hona chahiye, number nahi.** `Joi.string().length(6)` hai — `123456` (number) bhejne pe Joi convert kar dega (`convert: true`), par safe raha ke liye string bhejein: `"123456"`.

**3. `currentScreen` pe validator loose hai.** Joi sirf `Joi.string()` check karta hai (enum nahi), par Mongoose model me SCREENS enum hai. Matlab galat value Joi se pass ho jayegi aur Mongoose pe `422` throw karegi. Customer app ko ye field generally bhejna hi nahi chahiye.

**4. Response me `password` hash aata hai** — same issue as endpoint #1.

**5. Token store karna:** `data.token` ko secure storage me rakhein (Keychain / EncryptedSharedPreferences). Har subsequent request me `Authorization: Bearer <token>`.

**6. Original OTP flow (jab uncomment hoga) ye errors dega:** `401 "Please resend OTP! OTP is expired or missing"`, `403 "Max attempts exceeded! Please try again later."`, `401 "Invalid OTP! Please try again."` — app me in cases ko handle karke rakhein.

---

## 3. POST /auth/logout

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Body
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Logout successful",
  "data": {}
}
```

### Errors
Sirf [common auth errors](#common-errors).

### ⚠️ Edge cases & notes

**1. Server-side kuch nahi hota.** Controller sirf success return karta hai — token blacklist nahi hota, `isLoggedIn` flag update nahi hota, FCM token remove nahi hota (wo code commented hai). Purana token expiry tak valid rahega.

**2. App ko locally cleanup karna hoga:** token delete, user cache clear, login screen pe navigate.

**3. FCM/push unsubscribe abhi implement nahi hai** — commented out hai. Logout ke baad bhi push notifications aa sakti hain (jab push feature live hoga).

---

# User Profile APIs

## 4. GET /users/get

Logged-in customer ka profile, uske customer record aur saved location ke saath.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | Na do to token ka user. ⚠️ **Customer app ko ye kabhi nahi bhejna chahiye** — dusre users ka data fetch ho jaata hai (security issue, [Appendix B](#appendix-b--known-issues)) |

### Success — `200`
```json
{
  "success": true,
  "message": "User fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
    "customerId": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d2",
      "locationId": {
        "_id": "68f1a2b3c4d5e6f7a8b9c0d3",
        "addressLine1": "12, sunrise apartments",
        "addressLine2": "vijay nagar",
        "landmark": "near c21 mall",
        "addressType": "HOME",
        "city": "indore",
        "district": "indore",
        "state": "madhya pradesh",
        "country": "india",
        "zipcode": "452010",
        "formattedAddress": "12, sunrise apartments, vijay nagar, near c21 mall, indore, indore, madhya pradesh, 452010, india",
        "geo": { "type": "Point", "coordinates": [75.8937, 22.7533] },
        "isBrandAddress": false,
        "isSubBrandAddress": false,
        "isDefault": true,
        "isActive": true
      },
      "fullName": "rahul sharma",
      "whatsappNumber": "9876543210",
      "uniqueId": "TDC000456",
      "isSignUpCompleted": true,
      "isActive": true
    },
    "name": "rahul sharma",
    "dob": "1998-04-12T00:00:00.000Z",
    "role": "CUSTOMER",
    "loginType": "WHATSAPP",
    "email": "rahul@example.com",
    "whatsappNumber": "9876543210",
    "uniqueId": "TDU000123",
    "referralCode": "RAHUL7X2K",
    "appliedReferralCode": "PRIYA9M3L",
    "referralCount": 2,
    "followerCount": 0,
    "followingCount": 5,
    "reviewCount": 0,
    "walletBalance": 0,
    "tCoinsBalance": 150,
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/profile/abc.jpg",
    "isEmailVerified": false,
    "isMobileVerified": true,
    "isSignUpCompleted": true,
    "isActive": true,
    "createdAt": "2026-08-22T10:15:30.000Z",
    "updatedAt": "2026-08-22T11:02:44.000Z"
  }
}
```

**Excluded fields (kabhi nahi aayenge):** `password`, `otp`, `isDeleted`

**Populated nesting:** `customerId` → poora Customer doc, uske andar `locationId` → poora Location doc. Agar customer ne location save nahi ki to `locationId: null`.

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | `Unauthorized access! User not found.` | User soft-deleted hai ya `?userId` galat |
| `422` | `Invalid ID` | `?userId` valid ObjectId nahi |

### ⚠️ Notes

**1. `name` do jagah hai** — `data.name` (User) aur `data.customerId.fullName` (Customer). Update dono jagah sync hota hai. UI me `data.name` use karein.

**2. `walletBalance` aur `tCoinsBalance` fields exist karti hain** par unko manage karne wala koi endpoint abhi nahi hai. Read-only treat karein.

**3. `followerCount` / `followingCount` User model pe hain.** Brand-follow count `Brand.followersCount` pe track hota hai (endpoint #23 ka response dekho) — ye do alag cheezein hain.

---

## 5. PUT /users/update

Profile update. JSON ya multipart dono chalta hai (image ke liye multipart).

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `application/json` **ya** `multipart/form-data` | ✅ |

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId | ❌ | ⚠️ **Kabhi na bhejein** — kisi bhi doosre user ka profile update ho jaata hai ([Appendix B](#appendix-b--known-issues)) |

### Body — saare fields optional (jo bhejo wahi update hoga)
| Field | Type | Validation | Notes |
|---|---|---|---|
| `fullName` | string | 2–100 chars | Lowercase me store hoga |
| `email` | string | Valid email | Change karne pe `isEmailVerified` reset ho jaata hai |
| `dob` | string | ISO date (`YYYY-MM-DD`) | Age check commented out hai — 18+ validation abhi nahi lagti |
| `appliedReferralCode` | string | Max 20 chars, `""` allowed | Kisi ka referral code apply karna |
| `image` | file | – | **Sirf multipart me.** Field name exactly `image`. Cloudinary pe upload hoga, purani image delete |

**JSON example:**
```json
{
  "fullName": "Rahul Sharma",
  "email": "rahul.new@example.com",
  "dob": "1998-04-12",
  "appliedReferralCode": "PRIYA9M3L"
}
```

**Multipart example:**
```
fullName: Rahul Sharma
dob: 1998-04-12
image: <file>
```

### Success — `200`
```json
{
  "success": true,
  "message": "User profile updated successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
    "name": "rahul sharma",
    "email": "rahul.new@example.com",
    "dob": "1998-04-12T00:00:00.000Z",
    "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/profile/xyz.jpg",
    "isEmailVerified": false,
    "updatedAt": "2026-08-22T11:30:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `User not found` | User nahi ya soft-deleted |
| `404` | `Customer not found` | Customer record missing (data inconsistency) |
| `400` | `Email already exists with another user` | Same role ke doosre user ka email |
| `422` | `Name should have at least 2 characters` | `fullName` chhota |
| `422` | `Name should not exceed 100 characters` | `fullName` bada |
| `422` | `Please enter a valid email address` | Email format |
| `422` | `Date of birth must be a valid date in ISO format (YYYY-MM-DD)` | `dob` format |
| `422` | `Applied referral code cannot exceed 20 characters` | Referral code lamba |

### ⚠️ Edge cases & notes

**1. Email uniqueness role-scoped hai.** Same email `CUSTOMER` aur `VENDOR` roles me exist kar sakta hai — check sirf same role ke andar hota hai.

**2. Email change karne pe re-verification chahiye** (`isEmailVerified: false` ho jaata hai), par verification email bhejne ka endpoint abhi nahi hai. Practically email verified hone ka koi raasta nahi hai.

**3. `mobile` update nahi ho sakta** — validator me commented out hai. `whatsappNumber` bhi nahi. Number change karne ka koi flow abhi nahi hai.

**4. Sab kuch lowercase me store hota hai.** `"Rahul Sharma"` bhejo, `"rahul sharma"` milega. Display ke liye frontend pe capitalize karein.

**5. Customer record bhi sync hota hai** — `fullName`, `email`, `dob`, `image` User aur Customer dono me update hote hain.

**6. Ye endpoint `validateSchema` middleware use nahi karta** — controller ke andar manually validate hota hai. Isliye error format thoda different hai (`d.message` join, `cleanJoiError` nahi) — field names raw camelCase me aa sakte hain.

**7. Image upload fail hone pe `500` aa sakta hai** Cloudinary error ke saath.

---

## 6. DELETE /users/delete

⚠️ **Ye endpoint kuch delete nahi karta.** Neeche detail me.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Success — `200`
```json
{
  "message": "User deleted successfully"
}
```

### ⚠️⚠️ CRITICAL — ye ek no-op stub hai

Route me inline handler hai, koi controller/service nahi:

```js
// routes/users.js:12
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```

**Iska matlab:**
- Account **actually delete nahi hota** — na soft delete, na hard delete
- User dobara login kar sakta hai, saara data waise hi rehta hai
- Response format **standard envelope follow nahi karta** — `success` field hi nahi hai. Agar app `response.success` check karta hai to wo `undefined` milega. Isko specially handle karein
- **Play Store / App Store compliance risk** — account deletion mandatory requirement hai. Ye endpoint requirement pura hone ka bharam deta hai

**Frontend recommendation:** Jab tak backend implement na ho, "Delete Account" button ko app me disable rakhein ya "coming soon" dikhayein. Success message dikhana galat expectation set karega.

→ [Appendix B](#appendix-b--known-issues)

---

# Location APIs

## 7. POST /locations/upsert

Customer ka address save/update. **Ek customer = ek location** — dobara call karne pe existing update hoti hai, nayi nahi banti.

**Access:** Intended: CUSTOMER · Enforced: **CUSTOMER** (service level pe verify hota hai — role check wala ek endpoint)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `application/json` | ✅ |

### Body
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `addressLine1` | string | ✅ | – | – |
| `city` | string | ✅ | – | – |
| `state` | string | ✅ | – | – |
| `zipcode` | string | ✅ | – | `country` ke hisaab se regex ([table dekho](#zip-code-validation-country-wise)) |
| `coordinates` | number[] | ✅ | – | Exactly 2 numbers: `[longitude, latitude]`. lng: -180..180, lat: -90..90 |
| `addressLine2` | string | ❌ | – | – |
| `landmark` | string | ❌ | – | – |
| `district` | string | ❌ | – | – |
| `country` | string | ❌ | `india` | 2–80 chars |
| `formattedAddress` | string | ❌ | auto-generated | 1–500 chars |
| `addressType` | string | ❌ | `HOME` | `HOME` \| `WORK` \| `OTHER` |
| `isDefault` | boolean\|string | ❌ | `false` | – |
| `isBrandAddress` | boolean\|string | ❌ | `false` | Customer app ke liye relevant nahi |
| `isSubBrandAddress` | boolean\|string | ❌ | `false` | Customer app ke liye relevant nahi |
| `userId` | ObjectId | ❌ | token ka user | ⚠️ **Kabhi na bhejein** — dusre user ki location overwrite ho jaati hai ([Appendix B](#appendix-b--known-issues)) |

```json
{
  "addressLine1": "12, Sunrise Apartments",
  "addressLine2": "Vijay Nagar",
  "landmark": "Near C21 Mall",
  "city": "Indore",
  "district": "Indore",
  "state": "Madhya Pradesh",
  "zipcode": "452010",
  "country": "india",
  "coordinates": [75.8937, 22.7533],
  "addressType": "HOME",
  "isDefault": true
}
```

### Success — `201` *(note: 201, not 200)*
```json
{
  "success": true,
  "message": "Location upserted successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d3",
    "userId": "68f1a2b3c4d5e6f7a8b9c0d1",
    "customerId": "68f1a2b3c4d5e6f7a8b9c0d2",
    "addressLine1": "12, Sunrise Apartments",
    "addressLine2": "Vijay Nagar",
    "landmark": "Near C21 Mall",
    "addressType": "HOME",
    "city": "indore",
    "district": "indore",
    "state": "madhya pradesh",
    "country": "india",
    "zipcode": "452010",
    "formattedAddress": "12, sunrise apartments, vijay nagar, near c21 mall, indore, indore, madhya pradesh, 452010, india",
    "geo": { "type": "Point", "coordinates": [75.8937, 22.7533] },
    "isBrandAddress": false,
    "isSubBrandAddress": false,
    "isDefault": true,
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-08-22T11:45:00.000Z",
    "updatedAt": "2026-08-22T11:45:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `403` | `User is not a customer` | Token vendor/admin ka hai |
| `404` | `User not found` | User missing/deleted |
| `404` | `Customer not found` | Customer record missing |
| `422` | `Address Line 1 is required` | Missing |
| `422` | `City is required` | Missing |
| `422` | `State is required` | Missing |
| `422` | `Zip Code/Postal Code is required` | Missing |
| `422` | `Invalid Zip Code/Postal Code` | Country pattern fail |
| `422` | `Coordinates are required.` | Missing |
| `422` | `Coordinates must be [longitude, latitude].` | Array length 2 nahi |
| `422` | `Coordinates must contain only numbers.` | Non-numeric |
| `422` | `Invalid longitude/latitude.` | Range se bahar |

### ⚠️ Edge cases & notes

**1. Coordinates ka order `[longitude, latitude]` hai** — GeoJSON standard. Ye **ulta** hai us se jo maps APIs usually dete hain (`lat, lng`). **Galat order sabse common bug hai** — Indore ke liye `[75.8937, 22.7533]` sahi hai, `[22.7533, 75.8937]` galat.

**2. Ye endpoint voucher listing ke liye zaruri hai.** Voucher APIs (#15, #16) customer ke coordinates use karte hain. Agar location save nahi ki to wo `400 "Customer location not found."` denge — unless har call me `latitude`/`longitude` explicitly bhejein.

**3. Upsert lookup `userId` pe hota hai**, `customerId` pe nahi. Ek user ki ek hi location rahegi.

**4. `formattedAddress` auto-generate hota hai** agar na bhejein — saare address parts comma-separated, lowercase. Bhejenge to aapka value use hoga.

**5. Text fields lowercase ho jaate hain** (`city`, `district`, `state`, `country`). `addressLine1`, `addressLine2`, `landmark` original case me rehte hain.

**6. `Customer.locationId` auto-sync hota hai** — upsert ke baad customer record us location ko point karta hai.

**7. `isDefault` ka koi practical effect nahi hai** (unique index commented out hai) kyunki ek customer ki ek hi location hoti hai.

**8. Validator `create` se shared hai** — isliye `isBrandAddress`/`isSubBrandAddress` fields accept hote hain, par customer flow me inko `false` (default) rehna chahiye.

---

## 8. GET /locations/get/:id

Location ID se detail fetch.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Path Params
| Param | Type | Required | Validation |
|---|---|---|---|
| `id` | ObjectId | ✅ | Valid MongoDB ObjectId |

### Success — `200`
```json
{
  "success": true,
  "message": "Location fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c0d3",
    "userId": "68f1a2b3c4d5e6f7a8b9c0d1",
    "customerId": "68f1a2b3c4d5e6f7a8b9c0d2",
    "addressLine1": "12, Sunrise Apartments",
    "addressType": "HOME",
    "city": "indore",
    "state": "madhya pradesh",
    "country": "india",
    "zipcode": "452010",
    "formattedAddress": "12, sunrise apartments, vijay nagar, near c21 mall, indore, indore, madhya pradesh, 452010, india",
    "geo": { "type": "Point", "coordinates": [75.8937, 22.7533] },
    "isDefault": true,
    "isActive": true,
    "createdAt": "2026-08-22T11:45:00.000Z",
    "updatedAt": "2026-08-22T11:45:00.000Z"
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Location not found` | ID nahi mili ya soft-deleted |
| `422` | `Location ID is required` | Missing |
| `422` | `Invalid location ID format` | Valid ObjectId nahi |

### ⚠️ Notes

**1. Koi ownership check nahi hai.** Kisi bhi valid location ID se koi bhi user data fetch kar sakta hai — dusre customers ke addresses, brand addresses, outlet addresses sab. → [Appendix B](#appendix-b--known-issues)

**2. Practically ye endpoint optional hai** — customer ki location already `GET /users/get` ke response me nested aa jaati hai (`data.customerId.locationId`). Ye sirf tab chahiye jab specific location ID se refresh karna ho.

---

# Master Data APIs

## 9. GET /categories/getAll

Categories list. Home screen ke category grid ke liye.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer ≥ 1 (koi max nahi) |
| `search` | string | ❌ | – | `name` + `description` me case-insensitive match |
| `name` | string | ❌ | – | Sirf `name` me match |
| `isActive` | boolean\|string | ❌ | – | `true` / `false`. **Na do to inactive categories bhi aayengi** |
| `fromDate` | string | ❌ | – | ISO date, `createdAt` filter |
| `toDate` | string | ❌ | – | ISO date (us din ke 23:59:59 tak) |
| `sortBy` | string | ❌ | `createdAt` | Koi bhi field name (validate nahi hota) |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

**Recommended call:**
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
        "createdAt": "2026-05-10T08:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c0e2",
        "name": "salon & spa",
        "description": "beauty and wellness services",
        "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/salon.jpg",
        "isActive": true,
        "createdAt": "2026-05-10T08:05:00.000Z"
      }
    ]
  }
}
```

**Projected fields only:** `_id`, `name`, `description`, `image`, `isActive`, `createdAt`. `updatedAt` aur `isDeleted` nahi aate.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any category found` | ⚠️ **Koi category nahi mili** — empty array nahi, 404. Empty-state UI dikhayein |
| `422` | *(Joi message)* | Invalid query param |

### ⚠️ Notes

**1. Default `limit` 10 hai.** Home screen pe saari categories chahiye to `limit` badhayein (`limit=50`), warna sirf 10 aayengi.

**2. `isActive` filter explicitly bhejein.** Na bhejne pe inactive categories bhi list me aa jaayengi. Customer app ko `isActive=true` bhejna chahiye.

**3. `sortBy` validate nahi hota** — galat field name pe error nahi, MongoDB usko ignore kar dega (unpredictable order).

**4. `image` ka fallback:** category ke paas image na ho to default placeholder URL hota hai (constants me `DEFAULT_IMAGES.CATEGORY`).

---

## 10. GET /categories/get/:id

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
    "updatedAt": "2026-05-10T08:00:00.000Z"
  }
}
```

> `getAll` ke mukable yahan **poora document** aata hai (`isDeleted`, `updatedAt` bhi).

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Category not found` | ID nahi mili ya soft-deleted |
| `422` | `Invalid Category Id` | Valid ObjectId nahi |

---

## 11. GET /subCategories/getAll

Sub-categories list. `categoryId` se filter kar sakte hain.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
Same as [#9](#9-get-categoriesgetall), plus:

| Param | Type | Required | Notes |
|---|---|---|---|
| `categoryId` | ObjectId | ❌ | Ek category ke sub-categories. ⚠️ Invalid ObjectId bhejne pe **500** aa sakta hai (validate nahi hota, seedha cast hota hai) |

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
        "updatedAt": "2026-05-10T09:00:00.000Z"
      }
    ]
  }
}
```

> Note: yahan `isDeleted` aur `updatedAt` bhi project hote hain (categories `getAll` se different).

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subcategory found` | Koi sub-category nahi |
| `422` | *(Joi message)* | Invalid query param |
| `500` | *(cast error)* | `categoryId` invalid ObjectId format |

---

## 12. GET /subCategories/get/:id

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
    "createdAt": "2026-05-10T09:00:00.000Z",
    "updatedAt": "2026-05-10T09:00:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `422` | `Invalid SubCategory Id` |

---

# Home Screen APIs

## 13. GET /banners/customer/active

Home screen ka **ek** active banner. App-level banner hai (kisi brand ka nahi).

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
Koi nahi.

### Success — `200` (banner mila)
```json
{
  "success": true,
  "message": "Active banner fetched successfully.",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c1a1",
    "title": "monsoon mega sale",
    "description": "up to 50% off at partner outlets",
    "type": "IMAGE",
    "redirect": {
      "type": "CATEGORY",
      "targetId": "68f1a2b3c4d5e6f7a8b9c0e1",
      "url": null
    },
    "startDate": "2026-08-01T00:00:00.000Z",
    "endDate": "2026-08-31T23:59:59.000Z",
    "image": {
      "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/banners/monsoon.jpg",
      "storage": {
        "provider": "CLOUDINARY",
        "publicId": "banners/monsoon"
      }
    },
    "isActive": true,
    "isDeleted": false,
    "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
    "createdAt": "2026-07-28T10:00:00.000Z",
    "updatedAt": "2026-07-28T10:00:00.000Z"
  }
}
```

### Success — `200` (koi banner nahi)
```json
{
  "success": true,
  "message": "No active banner found.",
  "data": null
}
```

> ✅ Ye endpoint 404 nahi deta — `data: null` aur different message. Frontend ko `data === null` check karna hai.

### Errors
Sirf [common auth errors](#common-errors).

### ⚠️ Edge cases & notes

**1. Sirf ek banner aata hai, array nahi.** Selection logic:
1. Pehle wo banner jiska aaj ka date `startDate`–`endDate` range me hai (latest `startDate` wala jeetega)
2. Nahi mila to wo banner jisme `startDate` aur `endDate` dono `null` hain — "evergreen" banner (latest `createdAt`)
3. Kuch bhi nahi mila to `null`

**2. Media field `type` pe depend karta hai.** Response me sirf ek media field hoga:
- `type: "IMAGE"` → `image.url`
- `type: "VIDEO"` → `video.url`
- `type: "GIF"` → `gif.url`

Frontend ko `type` dekh kar right field padhna hai. Baaki fields absent ya empty honge.

**3. `redirect` handling:**
| `redirect.type` | Kya karna |
|---|---|
| `NONE` | Tap disable — koi navigation nahi |
| `CATEGORY` | `targetId` = categoryId → category screen |
| `BRAND` | `targetId` = brandId → brand profile |
| `DEAL` / `OFFER` | `targetId` = voucherId → voucher detail |
| `EXTERNAL_URL` | `url` → browser / webview |

⚠️ `redirect` object hamesha aata hai par uske fields `null` ho sakte hain — navigate karne se pehle `targetId`/`url` null-check karein.

**4. `storage` field internal hai** (Cloudinary publicId) — frontend ko sirf `url` chahiye. Ye field customer response se strip nahi hota.

**5. Legacy lowercase types handle hote hain** — model me setter hai jo purane `"image"` ko `"IMAGE"` bana deta hai. Response me hamesha uppercase aayega.

---

## 14. GET /promotionalTickers/customer/active

Home screen ka scrolling ticker strip. Multiple tickers aate hain.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Query Params
Koi nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Active promotional tickers fetched successfully.",
  "data": [
    {
      "_id": "68f1a2b3c4d5e6f7a8b9c1b1",
      "title": "flat 30% off on cafes today",
      "icon": {
        "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/tickers/coffee.png",
        "storage": { "provider": "CLOUDINARY", "publicId": "tickers/coffee" }
      },
      "redirect": {
        "type": "CATEGORY",
        "targetId": "68f1a2b3c4d5e6f7a8b9c0e1",
        "url": null
      },
      "displayOrder": 1,
      "startDate": "2026-08-01T00:00:00.000Z",
      "endDate": "2026-08-31T23:59:59.000Z",
      "isActive": true,
      "isDeleted": false,
      "createdBy": "68f1a2b3c4d5e6f7a8b9c000",
      "createdAt": "2026-07-28T10:00:00.000Z",
      "updatedAt": "2026-07-28T10:00:00.000Z"
    },
    {
      "_id": "68f1a2b3c4d5e6f7a8b9c1b2",
      "title": "refer & earn 100 tcoins",
      "icon": { "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/tickers/gift.png" },
      "redirect": { "type": "NONE", "targetId": null, "url": null },
      "displayOrder": 2,
      "startDate": null,
      "endDate": null,
      "isActive": true,
      "createdAt": "2026-07-20T10:00:00.000Z"
    }
  ]
}
```

### Success — `200` (koi ticker nahi)
```json
{
  "success": true,
  "message": "Active promotional tickers fetched successfully.",
  "data": []
}
```

> ✅ Empty pe `[]` aata hai, 404 nahi. Message same rehta hai.

### Errors
Sirf [common auth errors](#common-errors).

### ⚠️ Notes

**1. `displayOrder` ascending me sorted aate hain** — jis order me mile usi order me dikhayein.

**2. Do tarah ke active tickers aate hain (dono ek hi list me):**
- Date-bounded: `startDate <= now <= endDate`
- Evergreen: `startDate` aur `endDate` dono `null`

⚠️ Ek gap hai: jis ticker ka sirf `startDate` set hai (`endDate: null`), ya sirf `endDate`, wo **kabhi nahi aayega** — query dono ya dono-null match karti hai. Admin ko ya dono dates deni chahiye ya koi nahi.

**3. Pagination nahi hai** — saare active tickers ek saath. Practically ye chhoti list hoti hai.

**4. `redirect` handling** banner (#13) jaisa hi hai.

**5. `title` max 100 chars hai** — UI me single line me fit ho jaana chahiye.

---

# Voucher APIs

Customer ko sirf **`PUBLISHED`** status ke, currently valid (`startAt <= now < endAt`) vouchers dikhte hain, aur wo bhi **location-based** — customer ke coordinates se ek max radius ke andar wale outlets.

**Max distance** platform settings se aata hai (`Setting.vendor.voucher.maxDistanceKm`), fallback **25 km**.

## 15. GET /vouchers/customer/get-all

Nearby vouchers ki paginated list. Home/deals screen ka main feed.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–**50** |
| `search` | string | ❌ | – | Max 100 chars. Voucher name/description/tags pe text match |
| `categoryId` | ObjectId | ❌ | – | Category filter |
| `subCategoryId` | ObjectId | ❌ | – | Sub-category filter |
| `sortBy` | string | ❌ | `DISTANCE` | `DISTANCE` \| `NEWEST` \| `EXPIRING_SOON` \| `RELEVANCE` |
| `sortOrder` | string | ❌ | *(preset-wise)* | `asc` \| `desc`. Na do to sortBy ka natural direction |
| `latitude` | number | ❌ | saved location | -90 to 90 |
| `longitude` | number | ❌ | saved location | -180 to 180 |

```http
GET /vouchers/customer/get-all?latitude=22.7533&longitude=75.8937&sortBy=DISTANCE&limit=20
```

### Location resolution — important

1. Agar `latitude` **aur** `longitude` dono query me hain → wahi use honge (live GPS ke liye best)
2. Warna customer ki **saved location** (`Customer.locationId` → `Location.geo`) use hogi
3. Saved location bhi nahi hai → **`400`** error

**Recommendation:** App me GPS coordinates har call me bhejein — tab saved location pe dependency nahi rahegi aur user ke actual location ke hisaab se results milenge.

### Success — `200`
```json
{
  "success": true,
  "message": "Vouchers fetched successfully.",
  "data": {
    "total": 34,
    "totalPages": 2,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
        "name": "flat 30% off on total bill",
        "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
        "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
        "createdAt": "2026-08-10T06:00:00.000Z",
        "brand": {
          "id": "68f1a2b3c4d5e6f7a8b9c3a1",
          "brandName": "cafe mocha",
          "description": "artisanal coffee and continental bites",
          "legalBusinessName": "mocha hospitality pvt ltd",
          "merchantId": "TDM000078",
          "uniqueId": "TDB000078",
          "isActive": true,
          "isVerified": true,
          "joinedDate": "2026-03-15T00:00:00.000Z",
          "subscriptionPlan": "PREMIUM"
        },
        "version": {
          "id": "68f1a2b3c4d5e6f7a8b9c2b1",
          "versionNumber": 3,
          "description": "valid on dine-in and takeaway",
          "images": [
            {
              "_id": "68f1a2b3c4d5e6f7a8b9c2c1",
              "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/vouchers/mocha1.jpg",
              "sortOrder": 1
            }
          ],
          "bestOffer": {
            "_id": "68f1a2b3c4d5e6f7a8b9c2d1",
            "title": "30% off above 500",
            "minBillAmount": 500,
            "discountType": "PERCENTAGE",
            "discountValue": 30,
            "maxDiscountAmount": 300,
            "usageType": "ONCE_PER_USER",
            "discountApplicableOn": "SUBTOTAL"
          },
          "startAt": "2026-08-10T00:00:00.000Z",
          "endAt": "2026-09-10T23:59:59.000Z"
        },
        "nearestOutlet": {
          "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
          "uniqueId": "TDS000201",
          "storeId": "MOCHA-VN-01",
          "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
          "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
          "description": "vijay nagar outlet",
          "location": {
            "id": "68f1a2b3c4d5e6f7a8b9c4b1",
            "addressLine1": "shop 4, scheme 54",
            "addressLine2": "vijay nagar",
            "landmark": "opposite c21 mall",
            "city": "indore",
            "district": "indore",
            "state": "madhya pradesh",
            "country": "india",
            "zipcode": "452010",
            "formattedAddress": "shop 4, scheme 54, vijay nagar, opposite c21 mall, indore, madhya pradesh, 452010, india",
            "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] }
          },
          "distance": {
            "meters": 420,
            "kilometers": 0.42,
            "display": "420 m"
          }
        },
        "outletCount": 4,
        "offerCount": 3,
        "isAppliedOnAllOutlets": true,
        "isContainsAd": false,
        "isFavorite": false
      }
    ]
  }
}
```

### Response fields — detail

| Field | Type | Notes |
|---|---|---|
| `voucherId` | ObjectId | Detail endpoint (#16) me isko bhejein |
| `name` | string | Voucher ka naam (lowercase) |
| `brand` | object\|null | Brand summary. `isVerified` = brand approved hai ya nahi |
| `brand.subscriptionPlan` | string\|null | `FREE`/`BASIC`/`PREMIUM`/`FAMILY` ya `null` |
| `version.bestOffer` | object\|null | **Display heuristic** — sabse zyada `discountValue` wala active offer. Ye actual discount nahi hai (bill amount ke bina calculate nahi ho sakta). Real discount ke liye endpoint #17 |
| `version.images` | array | `_id`, `url`, `sortOrder`. `sortOrder` se sort karein |
| `nearestOutlet` | object\|null | Customer ke sabse paas ka outlet |
| `nearestOutlet.distance` | object\|null | Ready-to-display: `< 1 km` pe `"420 m"`, warna `"4.2 km"` |
| `outletCount` | number | Total kitne outlets pe ye voucher valid hai |
| `offerCount` | number | Voucher me kitne offers hain |
| `isAppliedOnAllOutlets` | boolean | Brand ke saare outlets pe valid hai ya selected pe |
| `isContainsAd` | boolean | ⚠️ **Hardcoded `false`** — ads feature abhi nahi hai |
| `isFavorite` | boolean | ⚠️ **Hardcoded `false`** — favorites feature abhi nahi hai |
| `relevanceScore` | number | Sirf `sortBy=RELEVANCE` + `search` ke saath aata hai |

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Customer not found.` | Token ka customer record nahi ya inactive |
| `400` | `Customer location not found.` | Coordinates nahi bheje aur saved location bhi nahi |
| `400` | `Customer location coordinates not found.` | Saved location hai par uska `geo` corrupt/missing |
| `404` | `No any voucher found` | ⚠️ Radius me koi voucher nahi — **empty-state dikhayein, error nahi** |
| `500` | `Invalid voucher maximum distance configuration.` | Platform settings me `maxDistanceKm` galat |
| `422` | `Invalid category ID.` / `Invalid subCategory ID.` | ObjectId format galat |
| `422` | *(Joi message)* | `limit > 50`, latitude/longitude range se bahar, etc. |

### ⚠️ Edge cases & notes

**1. Sorting ka default direction sortBy pe depend karta hai** — `sortOrder` na bhejein to natural direction milegi:
| `sortBy` | Natural direction |
|---|---|
| `DISTANCE` | Nearest first (asc) |
| `NEWEST` | Latest first (desc) |
| `EXPIRING_SOON` | Jaldi expire hone wala pehle (asc) |
| `RELEVANCE` | Best match first |

**2. `RELEVANCE` bina `search` ke silently `NEWEST` ban jaata hai.** Koi error nahi aayega — bas relevance sorting nahi hogi. Isliye `RELEVANCE` sirf search ke saath bhejein.

**3. Pipeline `SubBrand` (outlets) se shuru hoti hai, `Voucher` se nahi.** Iska matlab: bina outlet wale ya bina location wale outlets ke vouchers list me nahi aayenge — chahe voucher published ho.

**4. `limit` ka hard cap 50 hai.** 51+ bhejne pe `422`.

**5. Distance filter strict hai** — max radius (default 25 km) ke bahar ke outlets ke vouchers list me nahi aate. Bade shehar me user radius ke edge pe ho to results kam aa sakte hain.

**6. `bestOffer` ko real discount na samjhein.** Wo sirf highest `discountValue` uthata hai — `PERCENTAGE 30` aur `FLAT 200` me se `FLAT 200` "best" dikhega kyunki 200 > 30, chahe actual bill pe percentage zyada de. Real calculation ke liye #17.

**7. Empty results common hain** (new city, kam vendors) — 404 handling zaruri hai.

---

## 16. GET /vouchers/customer/get/:voucherId

Voucher detail screen. Saare offers + saare outlets ke saath.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required | Validation |
|---|---|---|---|
| `voucherId` | ObjectId | ✅ | Valid ObjectId |

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `latitude` | number | ❌ | -90..90. Na do to saved location |
| `longitude` | number | ❌ | -180..180 |
| `outletId` | ObjectId | ❌ | Specific outlet pre-select karne ke liye → `selectedOutlet` me aayega |

```http
GET /vouchers/customer/get/68f1a2b3c4d5e6f7a8b9c2a1?latitude=22.7533&longitude=75.8937
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher fetched successfully.",
  "data": {
    "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
    "name": "flat 30% off on total bill",
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
    "version": {
      "id": "68f1a2b3c4d5e6f7a8b9c2b1",
      "versionNumber": 3,
      "description": "valid on dine-in and takeaway. not valid with other offers.",
      "images": [
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c2c1",
          "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/vouchers/mocha1.jpg",
          "sortOrder": 1
        },
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c2c2",
          "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/vouchers/mocha2.jpg",
          "sortOrder": 2
        }
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
          "isActive": true
        },
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c2d2",
          "title": "flat 150 off above 800",
          "minBillAmount": 800,
          "discountType": "FLAT",
          "discountValue": 150,
          "maxDiscountAmount": null,
          "usageType": "MULTIPLE",
          "discountApplicableOn": "FINAL_BILL",
          "isActive": true
        }
      ],
      "startAt": "2026-08-10T00:00:00.000Z",
      "endAt": "2026-09-10T23:59:59.000Z"
    },
    "selectedOutlet": null,
    "outlets": [
      {
        "id": "68f1a2b3c4d5e6f7a8b9c4a1",
        "uniqueId": "TDS000201",
        "storeId": "MOCHA-VN-01",
        "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
        "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
        "description": "vijay nagar outlet",
        "distance": { "meters": 420, "kilometers": 0.42, "display": "420 m" },
        "location": {
          "id": "68f1a2b3c4d5e6f7a8b9c4b1",
          "addressLine1": "shop 4, scheme 54",
          "addressLine2": "vijay nagar",
          "landmark": "opposite c21 mall",
          "city": "indore",
          "district": "indore",
          "state": "madhya pradesh",
          "country": "india",
          "zipcode": "452010",
          "formattedAddress": "shop 4, scheme 54, vijay nagar, opposite c21 mall, indore, madhya pradesh, 452010, india",
          "geo": { "type": "Point", "coordinates": [75.8951, 22.7548] }
        },
        "workHours": {
          "monday": { "isOpen": true, "slots": [{ "openAt": "09:00", "closeAt": "23:00" }] },
          "tuesday": { "isOpen": true, "slots": [{ "openAt": "09:00", "closeAt": "23:00" }] },
          "sunday": { "isOpen": false, "slots": [] }
        }
      }
    ],
    "outletCount": 4
  }
}
```

### Response fields — detail

| Field | Notes |
|---|---|
| `version.offers` | **Saare** offers (list view me sirf `bestOffer` tha). Har offer ka `minBillAmount` dekh kar user ko dikhayein |
| `selectedOutlet` | `outletId` query bheji to us outlet ka object, warna `null` |
| `outlets` | Saare linked outlets, distance ke saath (nearest first) |
| `outlets[].workHours` | Weekly schedule ya `null` (agar outlet ne set nahi kiya) |
| `outletCount` | Total count |

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid voucher ID.` | ObjectId format galat |
| `404` | `Customer not found.` | Customer record missing/inactive |
| `400` | `Customer location not found.` | Coordinates + saved location dono nahi |
| `400` | `Customer location coordinates not found.` | Saved location ka geo corrupt |
| `404` | `Voucher not found or currently unavailable.` | Voucher exist nahi karta, `PUBLISHED` nahi, expire ho gaya, ya radius ke bahar |
| `400` | `Selected outlet is not linked with this voucher.` | `outletId` is voucher ka nahi |
| `500` | `Invalid voucher maximum distance configuration.` | Settings issue |
| `422` | `Invalid outlet ID format.` | – |

### ⚠️ Edge cases & notes

**1. `404` ka matlab ambiguous hai.** "Voucher not found or currently unavailable" 4 different cases me aata hai — exist nahi karta / published nahi / expire / radius ke bahar. Frontend distinguish nahi kar sakta. Generic message dikhayein: *"Ye voucher abhi available nahi hai"*.

**2. Ye endpoint bhi location-dependent hai.** List se detail pe jaate waqt wahi coordinates bhejein jo list me bheje the — warna radius mismatch se 404 aa sakta hai.

**3. `offers` ka `minBillAmount` UI me dikhayein.** User ko pata hona chahiye ki 500 se kam bill pe 30% offer nahi milega.

**4. `discountApplicableOn`** batata hai discount `SUBTOTAL` pe lagega ya `FINAL_BILL` (tax ke baad) pe. Terms me mention karein.

**5. `usageType`:** `ONCE_PER_USER` = ek baar hi use ho sakta hai, `MULTIPLE` = baar-baar. ⚠️ Enforcement abhi implement nahi hai (redemption tracking hi nahi hai) — ye informational hai.

**6. Redemption flow abhi exist nahi karta.** Customer voucher dekh sakta hai, discount preview kar sakta hai, par actually "redeem" karne ka koi endpoint nahi hai. (`VoucherUsage` model bana hua hai par koi route nahi.)

---

## 17. POST /vouchers/customer/voucher/preview

Bill amount pe **actual discount** calculate karta hai. Ye batata hai user ko kitna bachega.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `application/json` | ✅ |

### Body
| Field | Type | Required | Validation |
|---|---|---|---|
| `voucherId` | ObjectId | ✅ | Valid ObjectId |
| `outletId` | ObjectId | ✅ | Valid ObjectId. Voucher se linked hona chahiye |
| `billAmount` | number | ✅ | Positive (> 0), max 2 decimal places |

```json
{
  "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
  "outletId": "68f1a2b3c4d5e6f7a8b9c4a1",
  "billAmount": 1200
}
```

### Success — `200`
```json
{
  "success": true,
  "message": "Voucher preview calculated successfully.",
  "data": {
    "voucher": {
      "id": "68f1a2b3c4d5e6f7a8b9c2a1",
      "name": "flat 30% off on total bill",
      "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
      "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1"
    },
    "version": {
      "id": "68f1a2b3c4d5e6f7a8b9c2b1",
      "versionNumber": 3
    },
    "outlet": {
      "id": "68f1a2b3c4d5e6f7a8b9c4a1",
      "uniqueId": "TDS000201",
      "storeId": "MOCHA-VN-01"
    },
    "billAmount": 1200,
    "selectedOffer": {
      "offerId": "68f1a2b3c4d5e6f7a8b9c2d1",
      "title": "30% off above 500",
      "discountType": "PERCENTAGE",
      "discountValue": 30,
      "minBillAmount": 500,
      "maxDiscountAmount": 300,
      "discountAmount": 300,
      "finalAmount": 900
    },
    "eligibleOffers": [
      {
        "offerId": "68f1a2b3c4d5e6f7a8b9c2d1",
        "title": "30% off above 500",
        "discountType": "PERCENTAGE",
        "discountValue": 30,
        "minBillAmount": 500,
        "maxDiscountAmount": 300,
        "discountAmount": 300,
        "finalAmount": 900
      },
      {
        "offerId": "68f1a2b3c4d5e6f7a8b9c2d2",
        "title": "flat 150 off above 800",
        "discountType": "FLAT",
        "discountValue": 150,
        "minBillAmount": 800,
        "maxDiscountAmount": null,
        "discountAmount": 150,
        "finalAmount": 1050
      }
    ]
  }
}
```

### Calculation logic

**PERCENTAGE:**
```
discount = billAmount × discountValue / 100
if (maxDiscountAmount != null) discount = min(discount, maxDiscountAmount)
```
Upar ke example me: `1200 × 30% = 360`, par `maxDiscountAmount: 300` hai → discount `300`.

**FLAT:**
```
discount = discountValue
```

**Dono ke baad:** `discount = min(discount, billAmount)` — discount bill se zyada nahi ho sakta.

**Eligibility filter (offer skip ho jaata hai agar):**
- `isDeleted: true` ya `isActive: false`
- `startAt` future me hai
- `endAt` already nikal gaya
- `billAmount < minBillAmount`
- Calculated `discountAmount` `0` hai

**`selectedOffer` kaise chunta hai:**
1. Sabse zyada `discountAmount` wala jeeta
2. Tie hone pe zyada `minBillAmount` wala jeeta

> `eligibleOffers` bhi isi order me sorted aata hai — `selectedOffer` hamesha `eligibleOffers[0]` hi hota hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid voucher ID.` | ObjectId format |
| `400` | `Invalid outlet ID.` | ObjectId format |
| `404` | `Voucher not found.` | Voucher exist nahi karta ya inactive |
| `400` | `Voucher is not currently available.` | Koi `PUBLISHED` version nahi jo abhi valid ho |
| `400` | `Selected outlet is not linked with this voucher.` | Outlet is version se mapped nahi |
| `400` | `Selected outlet is currently unavailable.` | Outlet inactive/deleted |
| `400` | `Valid bill amount is required.` | Amount ≤ 0 ya non-numeric |
| `400` | `No offers available for this voucher.` | Version me offers array empty |
| `400` | `No eligible offer found for this bill amount.` | ⚠️ **Sabse common** — bill kisi bhi offer ke `minBillAmount` se kam hai |
| `422` | `Voucher ID is required.` / `Outlet ID is required.` / `Bill amount is required.` | Missing fields |
| `422` | `Bill amount must be greater than zero.` | Negative/zero |

### ⚠️ Edge cases & notes

**1. `"No eligible offer found for this bill amount."` error hai, empty result nahi.** Ye tab aata hai jab user ka bill kisi bhi offer ke minimum se kam ho. Frontend ko `400` ko friendly message me convert karna chahiye — jaise *"₹500 se upar ke bill pe offer available hai"*. Iske liye offers ka `minBillAmount` (endpoint #16 se) pehle se pata hona chahiye, taaki API call se pehle hi user ko guide kar sakein.

**2. Ye endpoint kuch save nahi karta** — pure calculation hai. Koi redemption record nahi banta, koi usage count nahi badhta. Baar-baar call kar sakte hain.

**3. `FIXED` discount type kaam nahi karta.** Enum me hai par calculation me handle nahi — aisa offer `discountAmount: 0` dega aur eligible list se filter ho jayega. Practically `PERCENTAGE` aur `FLAT` hi valid hain.

**4. Location check nahi hota.** Baaki voucher endpoints radius check karte hain, ye nahi. Matlab 100 km door ke outlet ka preview bhi mil jayega. Frontend ko outlet selection #16 ke `outlets` list se hi karna chahiye.

**5. Sirf latest `PUBLISHED` version use hota hai** (highest `versionNumber` jo abhi valid ho). Purane versions ignore.

**6. Rounding:** `discountAmount` aur `finalAmount` 2 decimal places pe rounded. `billAmount` bhi response me rounded aata hai.

**7. `discountApplicableOn` calculation me use nahi hota.** Backend seedha `billAmount` pe discount lagata hai, `SUBTOTAL` vs `FINAL_BILL` distinction ignore hota hai. Ye field sirf display/terms ke liye hai.

---

# Brand Profile APIs

## 18. GET /brands/get

Brand ka poora detail. Brand profile screen ka main call.

**Access:** Intended: All roles · Enforced: **Any authenticated**

> ⚠️ **Ye endpoint customer ke liye dedicated nahi hai** — vendor apna brand dekhne ke liye bhi yahi use karta hai. Isliye response me business-sensitive data aata hai jo customer ko nahi chahiye. Detail niche.

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
| Param | Type | Required | Notes |
|---|---|---|---|
| `brandId` | ObjectId | ⚠️ | Customer ke liye **effectively required** — na do to token ka `brandId` use hota hai, jo customer ke paas nahi hota → `400` |

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
    "legalBusinessName": "mocha hospitality pvt ltd",
    "description": "artisanal coffee and continental bites",
    "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
    "email": "hello@cafemocha.in",
    "whatsappNumber": "9812345678",
    "uniqueId": "TDB000078",
    "merchantId": "TDM000078",
    "followersCount": 1240,
    "avoidanceCount": 12,
    "joinedDate": "2026-03-15T00:00:00.000Z",
    "isApproved": true,
    "isActive": true,
    "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
    "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
    "user": [ { "_id": "...", "role": "VENDOR", "name": "..." } ],
    "categories": [ { "_id": "...", "name": "food & beverages" } ],
    "subcategories": [ { "_id": "...", "name": "cafe" } ],
    "locations": [ { "_id": "...", "formattedAddress": "...", "geo": {} } ],
    "workhours": [ { "monday": {}, "tuesday": {} } ],
    "subbrands": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
        "storeId": "MOCHA-VN-01",
        "uniqueId": "TDS000201",
        "user": [],
        "locations": [],
        "workhours": []
      }
    ],
    "pans": [ ],
    "gsts": [ ],
    "banks": [ ],
    "systemverifies": [ ],
    "subscribeds": [ ],
    "createdAt": "2026-03-15T00:00:00.000Z",
    "updatedAt": "2026-08-20T10:00:00.000Z"
  }
}
```

### 🟢 Customer app ko ye fields use karne chahiye

| Field | Use |
|---|---|
| `brandName`, `description` | Header |
| `logo`, `coverImage` | Images |
| `followersCount` | Social proof |
| `isApproved` | "Verified" badge |
| `joinedDate` | "Member since" |
| `categories`, `subcategories` | Category tags |
| `locations` | Brand ka main address |
| `workhours` | Timings |
| `subbrands` | Outlet list (`storeId`, `locations`, `workhours`) |

### 🔴 Customer app ko ye fields IGNORE karne chahiye

⚠️ **Ye business-sensitive data hai jo API galti se bhej rahi hai:**

| Field | Kya hai |
|---|---|
| `pans` | **PAN number** aur PAN holder details |
| `gsts` | **GST number** aur registration details |
| `banks` | **Bank account number + IFSC** |
| `systemverifies` | KYC verification internal status/history |
| `subscribeds` | Brand ka subscription/billing data |
| `user` | Vendor ka personal account (email, mobile) |

**Frontend ko in fields ko:**
- Kabhi UI pe display nahi karna
- Local cache/storage me save nahi karna
- Logs me print nahi karna

Backend fix chahiye (role-based response filtering). → [Appendix B](#appendix-b--known-issues)

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid brand ID` | `brandId` galat format **ya** customer ne bheja hi nahi (token me brandId nahi hota) |
| `404` | *(empty result)* | Brand nahi mila ya soft-deleted |

### ⚠️ Notes

**1. `brandId` bhejna mandatory hai customer app ke liye.** Controller ka logic `req.query.brandId || req.brandId` hai — customer token me `brandId` nahi hota (wo sirf vendor ke liye set hota hai), to `undefined` pass hoga aur `400 "Invalid brand ID"` aayega.

**2. Response bhaari hai** — 14 aggregation lookups. Brand profile screen pe ek hi baar call karein, aur result cache karein.

**3. Lookup arrays hamesha arrays hote hain**, single object nahi — even 1 record ho to `[{...}]`. Empty ho to `[]`.

**4. Nested outlets:** `subbrands[]` ke andar bhi `user`, `locations`, `workhours` arrays hote hain.

**5. `avoidanceCount` bhi aata hai** — kitne customers ne is brand ko avoid kiya. Customer UI pe ye dikhana probably nahi chahiye.

---

## 19. GET /showcase/get-brand-showcase/:brandId

Brand ka photo/video gallery, sections me organized.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Showcase fetched successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "sections": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
        "title": "ambience",
        "description": "our cozy interiors",
        "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/ambience-cover.jpg",
        "sortOrder": 1,
        "sectionType": "CUSTOM",
        "mediaCount": 5,
        "photoCount": 4,
        "videoCount": 1,
        "medias": [
          {
            "_id": "68f1a2b3c4d5e6f7a8b9c5b1",
            "type": "PHOTO",
            "url": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1.jpg",
            "thumbnail": null,
            "title": "seating area",
            "altText": "cafe seating with wooden tables",
            "sortOrder": 1,
            "isActive": true,
            "isShowInVideoClips": true,
            "createdAt": "2026-06-01T10:00:00.000Z"
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
            "createdAt": "2026-06-01T10:05:00.000Z"
          }
        ]
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a2",
        "title": "signature dishes",
        "description": "must-try items",
        "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/dishes-cover.jpg",
        "sortOrder": 2,
        "sectionType": "CUSTOM",
        "mediaCount": 8,
        "photoCount": 8,
        "videoCount": 0,
        "medias": [ ]
      }
    ]
  }
}
```

### Success — `200` (koi showcase nahi)
```json
{
  "success": true,
  "message": "Showcase fetched successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "sections": []
  }
}
```

> ✅ **Ye endpoint 404 nahi deta** — empty pe `sections: []`. Baaki list endpoints se different behaviour.

### Errors
| Status | Message | Kab |
|---|---|---|
| `422` | *(Joi message)* | `brandId` valid ObjectId nahi |

> Invalid/non-existent `brandId` pe bhi `200` + `sections: []` aata hai (404 nahi) — brand existence verify nahi hota.

### ⚠️ Notes

**1. Sirf active content aata hai** — `isActive: true`, `isDeleted: false` wale sections aur medias. Vendor ne kuch hide kiya to customer ko nahi dikhega.

**2. Sorting handled hai** — sections `sortOrder` ascending, aur har section ke `medias` bhi `sortOrder` ascending. Jo order mile usi me dikhayein.

**3. `storage` aur `metadata` fields strip ho jaate hain** (Cloudinary internals, video dimensions). Ye customer response se hata diye jaate hain — accha hai.

**4. `thumbnail` `PHOTO` ke liye `null` hota hai**, `VIDEO` ke liye actual thumbnail URL. Video player pe placeholder ke liye use karein.

**5. Counts pre-calculated hain** (`mediaCount`, `photoCount`, `videoCount`) — tabs/badges me directly use karein, khud count karne ki zarurat nahi.

**6. Pagination nahi hai** — poora showcase ek call me. Bahut zyada media wale brand pe response bada ho sakta hai.

---

## 20. GET /showcase/:brandId/video-clips

Brand ke videos ka flat, paginated feed — reels/stories style UI ke liye.

**Access:** Intended: CUSTOMER · Enforced: **Any authenticated**

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–**50** |

```http
GET /showcase/68f1a2b3c4d5e6f7a8b9c3a1/video-clips?page=1&limit=10
```

### Success — `200`
```json
{
  "success": true,
  "message": "Video clips fetched successfully.",
  "data": {
    "page": 1,
    "limit": 10,
    "total": 7,
    "totalPages": 1,
    "data": [
      {
        "sectionId": "68f1a2b3c4d5e6f7a8b9c5a1",
        "sectionTitle": "ambience",
        "sectionCoverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/ambience-cover.jpg",
        "video": {
          "_id": "68f1a2b3c4d5e6f7a8b9c5b2",
          "type": "VIDEO",
          "url": "https://res.cloudinary.com/drvdnqydw/video/upload/v1/showcase/amb-tour.mp4",
          "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb-tour-thumb.jpg",
          "title": "cafe walkthrough",
          "altText": "video tour",
          "createdAt": "2026-06-01T10:05:00.000Z",
          "resolution": { "width": 1080, "height": 1920 },
          "duration": 24,
          "sortOrder": 2
        }
      }
    ]
  }
}
```

> Note: is endpoint ka pagination shape standard `pagination` util se **thoda different** hai — field order alag hai (`page`, `limit`, `total`, `totalPages`, `data`) par same fields hain.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No video clips found for this brand` | Koi eligible video nahi — **empty-state dikhayein** |
| `422` | *(Joi message)* | `brandId` invalid, ya `limit > 50` |

### ⚠️ Notes

**1. Double opt-in filter.** Video feed me aane ke liye **dono** flags true chahiye:
- Section pe `isShowVideosInClips: true`
- Media pe `isShowInVideoClips: true`

Matlab showcase (#19) me video dikhe par clips feed me na aaye — ye normal hai, vendor ne opt-out kiya hoga.

**2. `resolution` aur `duration` aate hain** (showcase endpoint me `metadata` strip ho jaata hai). Player aspect ratio aur progress bar ke liye useful. `duration` seconds me, missing ho to `0`.

**3. `thumbnail` ka fallback section ka `coverImage` hai** — video ka apna thumbnail na ho to section cover use hota hai. Isliye ye field practically kabhi `null` nahi hota.

**4. Sorting:** section `sortOrder` → media `sortOrder` → `createdAt` descending.

**5. `sectionTitle` context deta hai** — video kis section ka hai, UI pe caption me dikha sakte hain.

---

## 21. GET /brandFeatures/get-all

Brand ke USP/highlight points (icon + title + description). Brand profile pe "Features" / "Why choose us" section.

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `brandId` | ObjectId | ✅ | – | **Mandatory** |
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | `title` + `description` match |
| `title` | string | ❌ | – | Sirf `title` match |
| `isActive` | boolean\|string | ❌ | – | `true` / `false` |
| `fromDate` | string | ❌ | – | ISO date |
| `toDate` | string | ❌ | – | ISO date |
| `sortBy` | string | ❌ | `createdAt` | `title` \| `createdAt` \| `updatedAt` \| `isActive` |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /brandFeatures/get-all?brandId=68f1a2b3c4d5e6f7a8b9c3a1&isActive=true&limit=10
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
    "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c6a1",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "title": "free wifi",
        "description": "high speed internet for all guests",
        "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/wifi.png",
        "isActive": true,
        "createdAt": "2026-06-10T10:00:00.000Z",
        "updatedAt": "2026-06-10T10:00:00.000Z"
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c6a2",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "title": "pet friendly",
        "description": "your furry friends are welcome",
        "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/pet.png",
        "isActive": true,
        "createdAt": "2026-06-10T10:05:00.000Z",
        "updatedAt": "2026-06-10T10:05:00.000Z"
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found!` | `brandId` ka brand nahi ya deleted |
| `404` | `No any brandfeature found` | Brand hai par koi feature nahi — **empty-state** |
| `422` | `Brand ID is required` | `brandId` missing |
| `422` | `Invalid Brand ID format` | ObjectId format galat |

### ⚠️ Notes

**1. Max 10 active features per brand** (backend limit). `limit=10` kaafi hai.

**2. `isActive=true` explicitly bhejein** — warna vendor ke hide kiye features bhi aa jayenge.

**3. Do 404 messages hain** aur dono ka matlab different hai:
- `"Brand not found!"` → brandId galat, real error
- `"No any brandfeature found"` → brand sahi hai, features nahi hain, empty-state dikhao

**4. `icon` hamesha hota hai** — backend pe mandatory field hai.

---

## 22. GET /brandFeatures/get/:featureId

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
    "title": "free wifi",
    "description": "high speed internet for all guests",
    "icon": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/features/wifi.png",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-06-10T10:00:00.000Z",
    "updatedAt": "2026-06-10T10:00:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Brand feature not found!` |
| `422` | `Feature ID is required` |
| `422` | `Invalid Feature ID format` |

### ⚠️ Note

Practically ye endpoint customer app me shayad na chahiye — `get-all` (#21) me poora data already aa jaata hai. Ye tab useful hai jab kisi feature ka deep link ho.

---

# Engagement APIs

## 23. POST /follows/toggle/:brandId

Brand follow/unfollow. **Ek hi endpoint dono karta hai** — current state ka ulta ho jaata hai.

**Access:** Intended: CUSTOMER · Enforced: **CUSTOMER** (service level pe customer resolve hota hai)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body
Koi nahi.

### Success — `200` (follow hua)
```json
{
  "success": true,
  "message": "Brand followed successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "followed": true,
    "followersCount": 1241
  }
}
```

### Success — `200` (unfollow hua)
```json
{
  "success": true,
  "message": "Brand unfollowed successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "followed": false,
    "followersCount": 1240
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found.` | brandId galat ya brand deleted |
| `404` | *(customer resolve error)* | Token ka customer record nahi mila |
| `500` | `Failed to toggle brand follow.` | Transaction fail |
| `422` | `Brand ID is required.` / `Invalid brand ID.` | Param issue |

### ⚠️ Notes

**1. `followed` flag response me hai** — usi se button state update karein. Optimistic UI use kar rahe ho to response se reconcile karein.

**2. `followersCount` fresh value hai** — increment/decrement ke baad ka. Directly display karein.

**3. Transactional hai** — Follow record aur `Brand.followersCount` dono ek saath update hote hain. Fail hone pe kuch bhi change nahi hota.

**4. Idempotent nahi hai** — dobara call karne pa state ulta ho jayega. Double-tap protection frontend pe karein.

**5. Soft delete se toggle hota hai** — unfollow pe record delete nahi hota, `isDeleted: true` ho jaata hai. Dobara follow pe wahi record revive hota hai.

**6. Count underflow-safe hai** — `followersCount` 0 se neeche nahi jaata (query me `$gt: 0` condition hai).

---

## 24. GET /follows/get-all

Customer ne jin brands ko follow kiya, unki paginated list.

**Access:** Intended: CUSTOMER · Enforced: **CUSTOMER** (service level)

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–100 |
| `search` | string | ❌ | – | Brand `brandName` + `uniqueId` me match. `""` allowed |
| `sortBy` | string | ❌ | `createdAt` | Sirf `createdAt` valid hai |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /follows/get-all?page=1&limit=20
```

### Success — `200`
```json
{
  "success": true,
  "message": "Followed brands fetched successfully.",
  "data": {
    "total": 5,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c7a1",
        "followerId": "68f1a2b3c4d5e6f7a8b9c0d2",
        "followeeId": "68f1a2b3c4d5e6f7a8b9c3a1",
        "isDeleted": false,
        "createdAt": "2026-08-15T14:20:00.000Z",
        "updatedAt": "2026-08-15T14:20:00.000Z",
        "brand": {
          "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
          "brandName": "cafe mocha",
          "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
          "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
          "description": "artisanal coffee and continental bites",
          "followersCount": 1241,
          "uniqueId": "TDB000078",
          "isActive": true,
          "isDeleted": false
        }
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any followed brand found` | Kuch follow nahi kiya — **empty-state dikhayein** |
| `404` | *(customer resolve error)* | Customer record missing |
| `422` | *(Joi message)* | `limit > 100`, invalid `sortBy` |

### ⚠️ Notes

**1. `brand` ek nested object hai** (array nahi) — lookup unwind ho jaata hai.

**2. Deleted brands filter ho jaate hain** — jo brands delete ho gaye wo list me nahi aayenge, chahe follow record ho.

**3. Sirf active follows aate hain** — unfollow kiye brands (`isDeleted: true`) list me nahi.

**4. Navigation ke liye `followeeId`** (ya `brand._id`) use karein brand profile (#18) pe jaane ke liye.

**5. `sortBy` me sirf `createdAt` valid hai** — koi aur value `422` degi.

---

## 25. POST /brandAvoidances/toggle/:brandId

Brand ko "avoid list" me add/remove. "Bad experience" / "Don't show me this brand" feature.

**Access:** Intended: CUSTOMER · Enforced: **CUSTOMER** (service level)

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Body
Koi nahi.

### Success — `200` (avoid list me add hua)
```json
{
  "success": true,
  "message": "Brand added to avoid list.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "avoided": true,
    "avoidanceCount": 13
  }
}
```

### Success — `200` (remove hua)
```json
{
  "success": true,
  "message": "Brand removed from avoid list.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "avoided": false,
    "avoidanceCount": 12
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found.` | brandId galat |
| `404` | *(customer resolve error)* | Customer record missing |
| `500` | `Failed to toggle brand avoidance.` | Transaction fail |
| `422` | `Brand ID is required.` / `Invalid brand ID.` | Param issue |

### ⚠️ Notes

**1. Structure follow (#23) se identical hai** — sirf `followed`→`avoided`, `followersCount`→`avoidanceCount`.

**2. ⚠️ Avoid karne se voucher listing filter nahi hoti.** Ye important hai: `GET /vouchers/customer/get-all` (#15) ki pipeline avoidance check **nahi** karti. Matlab avoided brand ke vouchers phir bhi feed me aayenge. Abhi ye feature sirf "record ho raha hai", actual filtering nahi hoti. Agar UI me "avoid karne se ye brand nahi dikhega" promise kar rahe ho to wo pura nahi hota — backend fix chahiye.

**3. Follow aur Avoid mutually exclusive nahi hain** — technically ek brand ko follow **aur** avoid dono kar sakte hain. Frontend pe logically prevent karna chahiye.

**4. Transactional + underflow-safe** — follow jaisa hi.

---

## 26. GET /brandAvoidances/get-all

Avoid kiye brands ki paginated list.

**Access:** Intended: CUSTOMER · Enforced: **CUSTOMER** (service level)

### Query Params
Same as [#24](#24-get-followsget-all).

### Success — `200`
```json
{
  "success": true,
  "message": "Avoided brands fetched successfully.",
  "data": {
    "total": 2,
    "totalPages": 1,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c8a1",
        "customerId": "68f1a2b3c4d5e6f7a8b9c0d2",
        "brandId": "68f1a2b3c4d5e6f7a8b9c3a2",
        "isDeleted": false,
        "createdAt": "2026-08-18T09:00:00.000Z",
        "updatedAt": "2026-08-18T09:00:00.000Z",
        "brand": {
          "_id": "68f1a2b3c4d5e6f7a8b9c3a2",
          "brandName": "quick bites",
          "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/qb-logo.jpg",
          "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/qb-cover.jpg",
          "description": "fast food chain",
          "followersCount": 340,
          "avoidanceCount": 13,
          "uniqueId": "TDB000091",
          "isActive": true,
          "isDeleted": false
        }
      }
    ]
  }
}
```

> Follow list ke mukable yahan `brand.avoidanceCount` bhi aata hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any avoided brand found` | Empty list — **empty-state** |
| `404` | *(customer resolve error)* | Customer record missing |
| `422` | *(Joi message)* | Invalid query param |

---

# Legal APIs

## 27. GET /terms-and-conditions/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer ≥ 1 |
| `search` | string | ❌ | – | `title` + `description` match |
| `title` | string | ❌ | – | Sirf `title` match |
| `isActive` | boolean\|string | ❌ | – | `true` / `false` |
| `fromDate` | string | ❌ | – | ISO date |
| `toDate` | string | ❌ | – | ISO date |
| `sortBy` | string | ❌ | `createdAt` | Field name |
| `sortOrder` | string | ❌ | `desc` | `asc` \| `desc` |

```http
GET /terms-and-conditions/getAll?isActive=true&limit=20
```

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
        "title": "general terms of use",
        "type": "CUSTOMER",
        "description": "<p>By using the Trydood application you agree to...</p>",
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
| Status | Message | Kab |
|---|---|---|
| `404` | `No any termandcondition found` | Koi record nahi — **empty-state** |
| `422` | *(Joi message)* | Invalid query param |

### ⚠️ Notes

**1. `description` me HTML ho sakta hai.** Admin panel se rich-text content aata hai — app me WebView ya HTML renderer use karein, plain text nahi.

**2. `type` field free-form string hai** (enum nahi). Values `"CUSTOMER"`, `"VENDOR"` jaisi ho sakti hain — admin par depend karta hai. **Client-side filtering karni pad sakti hai** kyunki API me `type` filter param nahi hai. Frontend ko `type` dekh kar customer-relevant records chunna hoga.

**3. Multiple records ho sakte hain.** Ek hi "Terms" page nahi — sections me split ho sakte hain. `sortBy=createdAt&sortOrder=asc` se consistent order milega.

**4. `isActive=true` bhejein** — purane/draft terms filter ho jayenge.

---

## 28. GET /terms-and-conditions/get/:id

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
    "title": "general terms of use",
    "type": "CUSTOMER",
    "description": "<p>By using the Trydood application you agree to...</p>",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-07-15T00:00:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Term and condition not found` |
| `422` | `Invalid TermAndCondition Id` |

---

## 29. GET /privacy-and-policies/getAll

**Access:** Intended: All roles · Enforced: **Any authenticated**

### Query Params
Same as [#27](#27-get-terms-and-conditionsgetall).

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
        "type": "CUSTOMER",
        "description": "<p>We collect the following information...</p>",
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-04-01T00:00:00.000Z",
        "updatedAt": "2026-07-15T00:00:00.000Z"
      }
    ]
  }
}
```

> Note: success message me typo hai — `"Privacys and policies fetched"`. Backend me aisa hi hai; message pe match na karein, `success` flag pe karein.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any privacyandpolicy found` | Empty — **empty-state** |
| `422` | *(Joi message)* | Invalid query param |

---

## 30. GET /privacy-and-policies/get/:id

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
    "type": "CUSTOMER",
    "description": "<p>We collect the following information...</p>",
    "isActive": true,
    "isDeleted": false,
    "createdAt": "2026-04-01T00:00:00.000Z",
    "updatedAt": "2026-07-15T00:00:00.000Z"
  }
}
```

### Errors
| Status | Message |
|---|---|
| `404` | `Privacy and policy not found` |
| `422` | `Invalid PrivacyAndPolicy Id` |

---

# Appendix A — Not For Customer App

Ye endpoints backend me exist karte hain par **customer app inko use na kare**. Zyada tar pe role check nahi hai, matlab customer token se call ho jayenge — par ye vendor/admin functionality hai. Galti se call karne pe data corrupt ho sakta hai.

### Auth (6) — customer app sirf WhatsApp OTP use karta hai
`POST /auth/register` · `POST /auth/login` · `POST /auth/login-with-email` · `POST /auth/verify-otp-email` · `POST /auth/login-with-mobile` · `POST /auth/verify-otp-mobile`

### Vendor Onboarding & KYC (11)
`POST /brands/onboarding/add-basic-details` · `POST /brands/onboarding/add-pan-details` · `POST /brands/onboarding/add-gst-details` · `POST /brands/onboarding/add-bank-details` · `GET /brands/onboarding/system-verify` · `PUT /brands/onboarding/accept-partnership` · `PUT /brands/onboarding/update-basic-details` · `PUT /brands/update` · `POST /verification/brands/onboarding/verify-pan` · `POST /verification/brands/onboarding/verify-gst` · `POST /verification/brands/onboarding/verify-bank`

### Outlets & Work Hours (4)
`POST /subBrands/signUp-with-whatsapp` · `GET /subBrands/get-all` · `PUT /subBrands/update/:subBrandId` · `POST /workHours/upsert`

### Locations — write/list operations (4)
`POST /locations/create` · `GET /locations/getAll` · `PUT /locations/update/:id` · `DELETE /locations/delete/:id`
> Customer sirf `POST /locations/upsert` (#7) aur `GET /locations/get/:id` (#8) use kare

### Showcase management (11)
`POST /showcase/section/add` · `GET /showcase/section/get/:sectionId` · `GET /showcase/section/get-all` · `PUT /showcase/section/update/:sectionId` · `PUT /showcase/section/:brandId/reorder` · `DELETE /showcase/section/delete/:sectionId` · `POST /showcase/section/:sectionId/add-media` · `PATCH /showcase/section/:sectionId/media/update/:mediaId` · `PUT /showcase/section/:sectionId/media/replace/:mediaId` · `PUT /showcase/section/:sectionId/media/reorder` · `DELETE /showcase/section/:sectionId/media/delete/:mediaId`

### Voucher management (8)
`POST /vouchers/create` · `PUT /vouchers/update/:voucherId` · `POST /vouchers/submit-review/:voucherId` · `POST /vouchers/review/:versionId` · `POST /vouchers/publish/:versionId` · `GET /vouchers/versions/get-all` · `POST /vouchers/:voucherId/banner` · `DELETE /vouchers/:voucherId/banner`

### Banner & Ticker management (10)
`POST|PUT|GET|DELETE /banners/*` (5 — `customer/active` ke alawa) · `POST|PUT|GET|DELETE /promotionalTickers/*` (5 — `customer/active` ke alawa)

### Brand Features management (3)
`POST /brandFeatures/add` · `PUT /brandFeatures/update/:featureId` · `DELETE /brandFeatures/delete/:featureId`

### Master data writes (6)
`POST /categories/create` · `PUT /categories/update/:id` · `DELETE /categories/delete/:id` · `POST /subCategories/:categoryId/create` · `PUT /subCategories/update/:id` · `DELETE /subCategories/delete/:id`

### Subscriptions & Payments (7)
`POST|GET|PUT|DELETE /subscriptions/*` (5) · `POST /transactions/subscribe/create-order` · `POST /transactions/subscribe/verify-transaction`

### Platform settings (2)
`GET /settings/get` · `PUT /settings/update`

### Legal writes (6)
`POST|PUT|DELETE /terms-and-conditions/*` (3) · `POST|PUT|DELETE /privacy-and-policies/*` (3)

**Total not-for-customer:** 78 endpoints (108 total − 30 customer)

Full categorization → [endpoints_category.md](./endpoints_category.md)

---

# Appendix B — Known Issues

Ye backend issues hain jo customer app ko directly affect karte hain. Full technical detail + suggested fixes → [security_findings.md](./security_findings.md)

## 🔴 Blockers (production se pehle fix hone chahiye)

### 1. OTP verify hota hi nahi — auth bypass
Dono OTP lines commented out hain:
```js
// services/auth/loginOrSignUpWithWhatsapp.js:51 — OTP send nahi hota
// services/auth/verifyOtpWithWhatsapp.js:11    — OTP verify nahi hota
```
**Matlab:** kisi ka bhi WhatsApp number pata ho to koi bhi 6-digit OTP daal ke uske account me login kiya ja sakta hai. **Production blocker.**

**App pe impact:** development me convenient (koi bhi OTP chalega), par live jaane se pehle uncomment hona zaruri hai. Uncomment hone ke baad naye error cases aayenge — endpoint #2 ke note 6 me listed hain, unko app me pehle se handle karke rakhein.

### 2. Role enforcement missing (88 endpoints)
108 me se sirf 20 endpoints pe role check hai. Customer token se admin endpoints call ho sakte hain (`POST /banners/create`, `POST /vouchers/review/:versionId`).

**App pe impact:** app ko khud discipline rakhni hogi — Appendix A ke endpoints kabhi call na karein. Backend nahi rokega.

### 3. Password hash API response me aa raha hai
Endpoints #1 aur #2 ka `user` object full Mongoose document hai — bcrypt `password` hash bhi response me aata hai.

**App pe impact:** is field ko kabhi store/log na karein. Ideally response parsing me hi drop kar dein.

## 🟠 Data access issues (app ko discipline rakhni hogi)

### 4. `?userId` param se kisi bhi user ka data
- `GET /users/get?userId=<koi_bhi>` → us user ka poora profile
- `PUT /users/update?userId=<koi_bhi>` → us user ka profile update

**App pe impact:** ye param **kabhi na bhejein**. Token se hi user resolve hone dein.

### 5. `POST /locations/upsert` body me `userId`
Body me `userId` bhejne se doosre customer ki location overwrite ho jaati hai.

**App pe impact:** body me `userId` kabhi include na karein.

### 6. `GET /locations/get/:id` pe ownership check nahi
Koi bhi location ID se koi bhi address fetch ho jaata hai.

**App pe impact:** sirf apni location ID use karein (`GET /users/get` ke `data.customerId.locationId._id` se).

### 7. `GET /brands/get` PAN/GST/Bank expose karta hai
Detail endpoint #18 me hai. `pans`, `gsts`, `banks`, `systemverifies`, `subscribeds`, `user` — sab customer ko mil jaate hain.

**App pe impact:** in fields ko display/cache/log na karein. Backend me role-based filtering chahiye.

## 🟡 Functional gaps (feature adhoora hai)

### 8. `DELETE /users/delete` kuch delete nahi karta
No-op stub. Detail endpoint #6 me.

**App pe impact:** "Delete Account" feature ko disable rakhein ya "coming soon" dikhayein. App store compliance risk.

### 9. Avoid kiye brands voucher feed se filter nahi hote
`POST /brandAvoidances/toggle` record banata hai par `GET /vouchers/customer/get-all` usko dekhta nahi.

**App pe impact:** UI me "ye brand ab nahi dikhega" promise na karein. Ya client-side pe avoid list se feed filter karein (avoid list #26 se lein).

### 10. Voucher redemption flow exist nahi karta
Customer voucher dekh sakta hai, discount preview kar sakta hai — par redeem nahi kar sakta. `VoucherUsage` model bana hai, koi route nahi.

**App pe impact:** redemption screen abhi ban nahi sakta. `usageType` (`ONCE_PER_USER`) bhi enforce nahi hota.

### 11. Email verification ka koi endpoint nahi
Email change karne pe `isEmailVerified: false` ho jaata hai, par verify karne ka raasta nahi.

**App pe impact:** email verified badge/flow abhi na banayein.

### 12. `FIXED` discount type kaam nahi karta
Enum me hai, calculation me handle nahi. Aisa offer `discountAmount: 0` dega aur filter ho jayega.

**App pe impact:** practically sirf `PERCENTAGE` aur `FLAT` handle karein.

### 13. Public app config endpoint nahi hai
Min app version, force-update flag, support contact, feature flags — inke liye koi endpoint nahi (`GET /settings/get` admin-only hai).

**App pe impact:** force-update / remote config abhi possible nahi. Hardcode karna padega ya Firebase Remote Config jaisa alag solution use karein.

---

## Frontend integration checklist

Doc padhne ke baad ye points dhyaan me rakhein:

- [ ] **404 = empty list** — list endpoints pe 404 ko error toast na dikhayein, empty-state dikhayein
- [ ] **Coordinates `[longitude, latitude]`** order me — ulta karna sabse common bug hai
- [ ] **`limit` default 10 hai** — categories/vouchers pe explicitly badhayein
- [ ] **`isActive=true` bhejein** master data + features + legal endpoints pe
- [ ] **Nested `data.data`** — pagination responses me
- [ ] **Enums UPPERCASE** hain, `sortBy` values bhi (`DISTANCE`, `NEWEST`)
- [ ] **Sab text lowercase** aata hai DB se — display pe capitalize karein
- [ ] **Voucher APIs ko coordinates chahiye** — GPS bhejein ya pehle location save karein
- [ ] **`bestOffer` real discount nahi hai** — actual ke liye preview endpoint (#17)
- [ ] **Banner ka media `type` pe depend karta hai** — `image`/`video`/`gif`
- [ ] **`redirect.targetId`/`url` null ho sakte hain** — navigate se pehle check
- [ ] **HTML content** terms/privacy `description` me — WebView use karein
- [ ] **`?userId` param aur body ka `userId` kabhi na bhejein**
- [ ] **PAN/GST/Bank fields ignore karein** `/brands/get` response me
- [ ] **`DELETE /users/delete` no-op hai** aur standard envelope use nahi karta
- [ ] **Token expiry pe login screen** — `401 "Your session has expired..."`

---

**Doc version:** 1.0.0 · **Generated:** 2026-08-22
**Related docs:** [endpoints_category.md](./endpoints_category.md) · [security_findings.md](./security_findings.md) · [queries.md](./queries.md)
**Pending:** Vendor panel doc (phase 2) · Super admin panel doc (phase 3)
