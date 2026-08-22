# Romani Dating App — Customer API Documentation

> **Scope:** This document covers every API consumed by the **Customer (end-user) mobile app** — auth, onboarding, profile, dating profile, discover/swipe, feed, forum, follow, AI videos, and subscriptions. Admin/vendor-facing management APIs are out of scope here and will be documented separately in `VENDOR_API_DOC.md`.

**Version:** 1.20.0  
**Base URL:** `http://localhost:5000`  
**Framework:** Express.js v5 (Node.js ES Modules)  
**Database:** PostgreSQL via Prisma ORM  
**Tested:** 2026-05-29 (v1.0.0) · Updated: 2026-06-01 (v1.1.0 — Profile APIs) · Updated: 2026-06-02 (v1.2.0 — x-api-key middleware, fixed OTP for testing) · Updated: 2026-06-11 (v1.3.0 — server-side localization via `Accept-Language`) · Updated: 2026-06-11 (v1.4.0 — authenticated responses follow stored `user.language`) · Updated: 2026-06-11 (v1.5.0 — Master Management APIs: genders, looking-for, spoken languages, interests, forum categories, AI video categories, app settings) · Updated: 2026-06-11 (v1.6.0 — Full multi-language support: Romanian (ro), Spanish (es), Russian (ru) for all master data and API messages) · Updated: 2026-06-12 (v1.7.0 — gender_id relation, separate forum-types and politicals endpoints) · Updated: 2026-06-12 (v1.8.0 — Discover Categories public API) · Updated: 2026-06-15 (v1.9.0 — Dating profile image moved into Add/Update flow; all fields optional; GET /api/master/distance-types; feed filters gender_id/religion_id/looking_for/interests/spoken_languages accept arrays) · Updated: 2026-06-16 (v1.10.0 — POST /api/dating-profile is JSON-only again, no image, no discover_preference; added PATCH /api/dating-profile/discover-preference) · Updated: 2026-06-18 (v1.11.0 — PATCH /api/profile/image now accepts image/jpg MIME type (iOS non-standard); GET /api/dating-profile gender field returned as array) · Updated: 2026-06-18 (v1.13.0 — POST /api/dating-profile: added `gender_ids` (UUID[]) for many-to-many gender selection) · Updated: 2026-06-18 (v1.14.0 — Feed/Posts APIs, Forum (User-Facing) APIs, User Profile & Follow APIs, AI Video report endpoint) · Updated: 2026-06-19 (v1.15.0 — Added GET /api/feed/posts/:id, GET /api/forum/threads/:id; AI Videos list+detail documented; followStatus field on likes lists; all 40 endpoints live-tested) · Updated: 2026-07-01 (v1.18.0 — Added GET /api/master/post-types; Added GET /api/discover/swipe-status) · Updated: 2026-07-02 (v1.19.0 — Global + OTP rate limiting; env-driven CORS allowlist; single shared PrismaClient; no response shape changes) · Updated: 2026-07-02 (v1.20.0 — DTO/Mapper layer: all user-data modules now map through explicit allowlist DTOs; response shapes unchanged for existing clients — see [Breaking Changes](#breaking-changes-v1200) below for the admin-only security fixes) · Updated: 2026-07-07 (v1.21.0 — Feed posts wired to admin-managed PostType: `postTypeId` on POST /api/feed/posts + `postTypeId` filter on GET /api/feed/posts; `postType` field added to post responses)

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Rate Limiting](#rate-limiting)
   - [API Versioning](#api-versioning)
   - [Breaking Changes — v1.20.0](#breaking-changes-v1200)
4. [Localization](#localization)
5. [Standard Response Format](#standard-response-format)
6. [HTTP Status Codes](#http-status-codes)
7. [Master APIs](#master-apis)
   - [GET /api/master/belonging-countries](#get-apimasterbelonging-countries)
   - [GET /api/master/religions](#get-apimasterreligions)
   - [GET /api/master/genders](#get-apimastergenders)
   - [GET /api/master/looking-for](#get-apimasterlooking-for)
   - [GET /api/master/spoken-languages](#get-apimasterspoken-languages)
   - [GET /api/master/interests](#get-apimasterinterests)
   - [GET /api/master/forum-types](#get-apimasterforum-types)
   - [GET /api/master/politicals](#get-apimasterpoliticals)
   - [GET /api/master/aivideo-categories](#get-apimasteaivideo-categories)
   - [GET /api/master/discover-categories](#get-apimasterdiscover-categories)
   - [GET /api/master/distance-types](#get-apimasterdistance-types)
   - [GET /api/master/settings](#get-apimastersettings)
   - [GET /api/master/post-types](#get-apimasterpost-types)
8. [Auth APIs](#auth-apis)
   - [POST /api/auth/send-otp](#post-apiauthsend-otp)
   - [POST /api/auth/resend-otp](#post-apiauthresend-otp)
   - [POST /api/auth/verify-otp](#post-apiauthverify-otp)
   - [POST /api/auth/social-login](#post-apiauthsocial-login)
   - [GET /api/auth/profile](#get-apiauthprofile)
   - [POST /api/auth/logout](#post-apiauthlogout)
   - [POST /api/auth/delete-account](#post-apiauthdelete-account)
9. [Onboarding APIs](#onboarding-apis)
   - [POST /api/onboarding/step-1](#post-apionboardingstep-1)
   - [POST /api/onboarding/step-2](#post-apionboardingstep-2)
   - [POST /api/onboarding/step-3](#post-apionboardingstep-3)
10. [Profile APIs](#profile-apis)
   - [PATCH /api/profile/details](#patch-apiprofiledetails)
   - [PATCH /api/profile/image](#patch-apiprofileimage)
   - [PATCH /api/profile/notification-preferences](#patch-apiprofilenotification-preferences)
   - [PATCH /api/profile/language](#patch-apiprofilelanguage)
11. [Dating Profile APIs](#dating-profile-apis)
12. [Discover APIs](#discover-apis)
    - [GET /api/discover/swipe-status](#get-apidiscoverswipe-status)
13. [Feed / Posts APIs](#feed--posts-apis)
    - [POST /api/feed/posts](#post-apifeedposts)
    - [GET /api/feed/posts](#get-apifeedposts)
    - [GET /api/feed/posts/mine](#get-apifeedpostsmine)
    - [GET /api/feed/posts/user/:userId](#get-apifeedpostsuseruserid)
    - [GET /api/feed/posts/:id](#get-apifeedpostsid)
    - [DELETE /api/feed/posts/:id](#delete-apifeedpostsid)
    - [POST /api/feed/posts/:id/like](#post-apifeedpostsidlike)
    - [GET /api/feed/posts/:id/likes](#get-apifeedpostsidlikes)
    - [GET /api/feed/posts/:id/comments](#get-apifeedpostsidcomments)
    - [POST /api/feed/posts/:id/comments](#post-apifeedpostsidcomments)
    - [POST /api/feed/posts/:id/comments/:commentId/like](#post-apifeedpostsidcommentscommentidlike)
    - [POST /api/feed/posts/:id/comments/:commentId/reply](#post-apifeedpostsidcommentscommentidreply)
    - [POST /api/feed/posts/:id/share](#post-apifeedpostsidshare)
    - [POST /api/feed/report](#post-apifeedreport)
    - [GET /api/feed/locations](#get-apifeedlocations)
14. [Forum (User-Facing) APIs](#forum-user-facing-apis)
    - [POST /api/forum/threads](#post-apiformumthreads)
    - [GET /api/forum/threads](#get-apiformumthreads)
    - [GET /api/forum/threads/mine](#get-apiformumthreadsmine)
    - [GET /api/forum/threads/user/:userId](#get-apiformumthreadsuseruserid)
    - [GET /api/forum/threads/:id](#get-apiformumthreadsid)
    - [DELETE /api/forum/threads/:id](#delete-apiformumthreadsid)
    - [POST /api/forum/threads/:id/like](#post-apiformumthreadsidlike)
    - [GET /api/forum/threads/:id/likes](#get-apiformumthreadsidlikes)
    - [GET /api/forum/threads/:id/answers](#get-apiformumthreadsidanswers)
    - [POST /api/forum/threads/:id/answers](#post-apiformumthreadsidanswers)
    - [POST /api/forum/threads/:id/answers/:answerId/like](#post-apiformumthreadsidanswersansweridlike)
    - [POST /api/forum/threads/:id/answers/:answerId/reply](#post-apiformumthreadsidanswersansweridreply)
    - [POST /api/forum/threads/:id/share](#post-apiformumthreadsidshare)
    - [POST /api/forum/report](#post-apiformumreport)
15. [User Profile & Follow APIs](#user-profile--follow-apis)
    - [GET /api/users/:userId](#get-apiusersuserid)
    - [POST /api/users/:userId/follow](#post-apiusersuseridfollow)
    - [DELETE /api/users/:userId/follow](#delete-apiusersuseridfollow)
    - [GET /api/users/:userId/followers](#get-apiusersuseridfolowers)
    - [GET /api/users/:userId/following](#get-apiusersuserid-following)
    - [GET /api/users/follow-requests](#get-apiusersfollow-requests)
    - [PATCH /api/users/follow-requests/:requestId](#patch-apiusersfollow-requestsrequestid)
16. [AI Videos APIs](#ai-videos-apis)
    - [GET /api/videos](#get-apivideos)
    - [GET /api/videos/:id](#get-apivideosid)
    - [POST /api/videos/:id/report](#post-apivideosidreport)
17. [Subscription APIs](#subscription-apis)
    - [GET /api/subscription/plans](#get-apisubscriptionplans)
    - [POST /api/subscription/subscribe](#post-apisubscriptionsubscribe)
    - [POST /api/subscription/boost](#post-apisubscriptionboost)
    - [GET /api/subscription/status](#get-apisubscriptionstatus)
    - [GET /api/subscription/history](#get-apisubscriptionhistory)
    - [POST /api/subscription/cancel](#post-apisubscriptioncancel)
    - [PATCH /api/subscription/auto-renew](#patch-apisubscriptionauto-renew)
    - [POST /api/subscription/restore](#post-apisubscriptionrestore)
    - [POST /api/subscription/webhook](#post-apisubscriptionwebhook)
18. [Dev Mode Notes](#dev-mode-notes)
19. [Test Results Summary](#test-results-summary)

---

## Overview

The Romani Dating App API uses a phone-number-first authentication model. New users register with their phone, verify via OTP, then complete a 3-step onboarding profile. Social login (Google, Facebook, Apple) is also supported as an alternative entry point.

All API routes are prefixed with `/api/`.

---

## Authentication

All API requests require **two** authentication mechanisms:

### 1. API Key (required on every request)

Every request — public or protected — must include the `x-api-key` header:

```
x-api-key: <API_KEY value from .env>
```

Requests missing or with a wrong key receive `401 Invalid or missing API key.`

The key is configured in the backend `.env` file as `API_KEY`. The current development key is:
```
e519b3cd6261872c0b7760bbc912c6cf946b7768ae13f2065a9aad2dd89783ca
```

### 2. Bearer JWT Token (required on protected endpoints)

Protected endpoints additionally require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are issued by:
- `POST /api/auth/verify-otp` (phone-based login/register)
- `POST /api/auth/social-login`

Token lifetime: **7 days** (configurable via `JWT_EXPIRES_IN` env var).

**Conditional Auth:** The OTP endpoints (`send-otp`, `resend-otp`, `verify-otp`) are public for `type: register` and `type: login`, but **require a Bearer token** for `type: update_phone` and `type: update_email`.

---

## Rate Limiting

All `/api/*` routes (both `/api` and `/api/v1`) are rate limited per client IP:

| Scope | Limit | Window |
|---|---|---|
| Global — all `/api` routes | 100 requests | 15 minutes |
| OTP endpoints — `send-otp`, `resend-otp`, `verify-otp` | 10 requests | 15 minutes |

The Stripe webhook (`POST /api/subscription/webhook`) is **exempt** so payment event deliveries are never throttled.

Every response includes standard `RateLimit-*` headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`). When a limit is exceeded the API responds with **429**:

```json
{
  "status": false,
  "message": "Too many requests, please try again later."
}
```

The message is localized like all other API messages (see [Localization](#localization)).

---

## API Versioning

Every endpoint documented below is reachable at **both**:

- `/api/<module>/...` — legacy path, kept for the existing mobile app; will keep working indefinitely.
- `/api/v1/<module>/...` — canonical versioned path for new clients.

Both prefixes are mounted from the same router (`routes/v1.routes.js`) and return identical responses — there is no behavioral difference between them. A future breaking change would ship as `/api/v2/...` while `/api/v1` (and the `/api` alias) keep their current contract.

<a id="breaking-changes-v1200"></a>
### Breaking changes — v1.20.0

None for the mobile app. The v1.20.0 DTO/Mapper layer (every user-data module now maps its Prisma results through an explicit allowlist `<module>.dto.js` before responding) is an internal refactor — every endpoint's response shape is byte-for-byte identical to v1.19.0 for all mobile-facing modules (auth, onboarding, profile, dating-profile, discover, feed, forum, videos, subscription, user-profile).

The only field removed by this change is on the **web admin console**, not the mobile API: the admin's own session `token` no longer appears nested inside the `admin` object in `POST /api/admin/auth/login`, `GET /api/admin/auth/profile`, and `PUT /api/admin/auth/profile` responses (it was an unintended leak — token hijack risk). The admin panel already reads the token from the top-level `token` field, so this has no effect there either.

---

## Localization

The API localizes **all user-facing response content** — success messages, error messages, validation messages (including per-field `errors`), and translatable master/dynamic data (e.g. country and religion names).

The response language is resolved per request from **two sources**, depending on whether the request is authenticated:

### Authenticated requests → stored `user.language` (account preference)

For any request carrying a valid `Authorization: Bearer <token>`, the response language is the language stored on the user's account. The app sets it **once** via `PATCH /api/profile/language`; from then on **every authenticated endpoint responds in that language automatically** — the app does **not** need to send any language header.

- The stored account language is **authoritative**: it **overrides** any `Accept-Language` header on authenticated requests.
- A new user defaults to `en` until they change it via `PATCH /api/profile/language`.
- The change takes effect on the **next** request after the language is updated.

### Unauthenticated / pre-login requests → `Accept-Language` header

Requests with no logged-in user — `send-otp`, `resend-otp`, `verify-otp`, `social-login`, and public master data (`/api/master/...`) and CMS pages — have no stored preference to read, so they use the `Accept-Language` header:

```
Accept-Language: en
```

- Standard header syntax is accepted, including quality values: `Accept-Language: ro,en;q=0.8`.
- If the header is **missing** or the requested language is **not supported**, the API falls back to the default language (`en`).

In all cases fallback is per-key: any string not yet translated for the active language is returned in English rather than failing.

**Supported languages:**

| Code | Language |
|------|----------|
| `en` | English (default) |
| `ro` | Romanian |
| `es` | Spanish |
| `ru` | Russian |

All API response messages (success, error, validation) and all master data `name` fields (countries, religions, genders, interests, etc.) are fully translated for all four languages. The `translations` field is stored in the database but **never returned to clients** — names are resolved server-side before sending the response.

**Example — pre-login request with `Accept-Language: ro`:**

```
GET /api/master/genders
Accept-Language: ro
```
```json
{
  "status": true,
  "message": "Genurile au fost obținute cu succes.",
  "data": [
    { "id": "uuid-1", "name": "Bărbați",  "emoji": "👨", "sortOrder": 1 },
    { "id": "uuid-2", "name": "Femei",    "emoji": "👩", "sortOrder": 2 },
    { "id": "uuid-3", "name": "Nebinar",  "emoji": "🧑", "sortOrder": 3 },
    { "id": "uuid-4", "name": "Toți",     "emoji": "🌍", "sortOrder": 4 }
  ]
}
```

**Example — authenticated endpoint, account language set to `ro`:**

```
PATCH /api/profile/language        Authorization: Bearer <token>
Body: { "language": "ro" }
→ stored. No Accept-Language header needed on later requests.
```
```
PATCH /api/profile/notification-preferences   Authorization: Bearer <token>
(no Accept-Language header)
→ { "status": true, "message": "Preferințele de notificare au fost actualizate.", "data": { ... } }
```

> The login/verify responses (`verify-otp`, `social-login`) are produced **before** the token is active for that request, so their `message` follows the pre-login (header/English) rule. The returned `user` object includes the stored `language`, so the app knows the account's language from the login response.

---

## Standard Response Format

All responses follow a consistent JSON envelope:

### Success Response
```json
{
  "status": true,
  "message": "Human-readable success message",
  "data": { }
}
```

### Error Response
```json
{
  "status": false,
  "message": "Error description",
  "errors": {
    "fieldName": ["Error message 1", "Error message 2"]
  }
}
```

> `errors` field is only present on validation failures (422).

---

## HTTP Status Codes

| Code | Meaning                        | When Used                                      |
|------|--------------------------------|------------------------------------------------|
| 200  | OK                             | Successful GET, POST, or update                |
| 400  | Bad Request                    | Invalid input not caught by schema (e.g. file type) |
| 401  | Unauthorized                   | Missing/wrong x-api-key; missing/invalid/expired Bearer token; invalid/expired OTP |
| 403  | Forbidden                      | Soft-deleted account attempting login          |
| 404  | Not Found                      | User/record not found by ID                    |
| 409  | Conflict                       | Phone/email already taken on update flows      |
| 422  | Unprocessable Entity           | Joi schema validation failure                  |
| 500  | Internal Server Error          | Unhandled server exception                     |
| 503  | Service Unavailable            | OTP delivery (SMS/email) failed                |

---

## Master APIs

> **Localization:** All master data endpoints return `name` fields in the active language. For pre-login requests, set the `Accept-Language` header (`en`, `ro`, `es`, or `ru`). For authenticated requests, the account's stored language is used automatically. The raw `translations` column is never exposed in responses.

### GET /api/master/belonging-countries

Returns the list of active belonging countries used in onboarding step-2.

| Property       | Value                              |
|----------------|------------------------------------|
| **Method**     | GET                                |
| **Path**       | `/api/master/belonging-countries`  |
| **Auth**       | x-api-key required                 |
| **Content-Type** | —                                |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Belonging countries fetched successfully.",
  "data": [
    { "id": "af3e67f2-b23b-401b-a9a7-763e88f14bb2", "name": "Turkey",  "code": "TR", "flag": "🇹🇷", "sortOrder": 1 },
    { "id": "5b395483-1515-4ef1-8ada-82e47f28d099", "name": "Romania", "code": "RO", "flag": "🇷🇴", "sortOrder": 2 },
    { "id": "320f6736-325c-40bb-9f79-138194d4a1f8", "name": "Spain",   "code": "ES", "flag": "🇪🇸", "sortOrder": 3 },
    { "id": "b9b57a54-8a44-4284-abf7-641ddaca2a87", "name": "France",  "code": "FR", "flag": "🇫🇷", "sortOrder": 4 },
    { "id": "1c4de0dd-bf1c-4ff6-b0d0-8e4b7f5ef6cf", "name": "Brazil",  "code": "BR", "flag": "🇧🇷", "sortOrder": 5 },
    { "id": "ca151290-cc0c-4533-9f94-715c2b466182", "name": "Hungary", "code": "HU", "flag": "🇭🇺", "sortOrder": 6 }
  ]
}
```

**Notes:**
- Data is ordered by `sortOrder` ASC.
- Only records with `isActive: true` are returned.
- Use the returned `id` values as `belongingCountryId` in onboarding step-2.
- Names are localized to the active language — see [Localization](#localization) for details.

#### Romanian Example (`Accept-Language: ro`)

```json
{
  "status": true,
  "message": "Țările de origine au fost obținute cu succes.",
  "data": [
    { "id": "af3e67f2-b23b-401b-a9a7-763e88f14bb2", "name": "Turcia",        "code": "TR", "flag": "🇹🇷", "sortOrder": 1 },
    { "id": "5b395483-1515-4ef1-8ada-82e47f28d099", "name": "România",       "code": "RO", "flag": "🇷🇴", "sortOrder": 2 },
    { "id": "320f6736-325c-40bb-9f79-138194d4a1f8", "name": "Spania",        "code": "ES", "flag": "🇪🇸", "sortOrder": 3 },
    { "id": "b9b57a54-8a44-4284-abf7-641ddaca2a87", "name": "Franța",        "code": "FR", "flag": "🇫🇷", "sortOrder": 4 },
    { "id": "1c4de0dd-bf1c-4ff6-b0d0-8e4b7f5ef6cf", "name": "Brazilia",      "code": "BR", "flag": "🇧🇷", "sortOrder": 5 },
    { "id": "ca151290-cc0c-4533-9f94-715c2b466182", "name": "Ungaria",       "code": "HU", "flag": "🇭🇺", "sortOrder": 6 }
  ]
}
```

---

### GET /api/master/religions

Returns the list of active religions used in onboarding step-2.

| Property       | Value                    |
|----------------|--------------------------|
| **Method**     | GET                      |
| **Path**       | `/api/master/religions`  |
| **Auth**       | x-api-key required       |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Religions fetched successfully.",
  "data": [
    { "id": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2", "name": "Roman Catholic",      "sortOrder": 1 },
    { "id": "f4e4f530-dada-4f6b-883b-2d00064569fd", "name": "Eastern Orthodox",    "sortOrder": 2 },
    { "id": "5a26ed77-b63c-4780-b4fe-8d848851b761", "name": "Pentecostalism",      "sortOrder": 3 },
    { "id": "b379b530-0e85-4b54-ad8c-6b920ab7bd0c", "name": "Jehovah's Witnesses", "sortOrder": 4 },
    { "id": "094d3204-73d9-49d7-9683-6b0e26043276", "name": "Judaism",             "sortOrder": 5 },
    { "id": "bb6b3e24-7909-4fbd-ae8b-09ab3298f221", "name": "Islam",               "sortOrder": 6 },
    { "id": "3a582197-4e01-4e5d-afad-4bc9db03851e", "name": "Baptists",            "sortOrder": 7 },
    { "id": "d214f39e-0d8b-4281-a85a-08f960563f67", "name": "Mormonism",           "sortOrder": 8 },
    { "id": "9c6f9ce7-b673-4b07-8427-5affdd393a70", "name": "Other",               "sortOrder": 9 }
  ]
}
```

**Notes:**
- Use the returned `id` values as `religionId` in onboarding step-2.
- Names are localized to the active language — see [Localization](#localization) for details.

#### Romanian Example (`Accept-Language: ro`)

```json
{
  "status": true,
  "message": "Religiile au fost obținute cu succes.",
  "data": [
    { "id": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2", "name": "Catolic Roman",        "sortOrder": 1 },
    { "id": "f4e4f530-dada-4f6b-883b-2d00064569fd", "name": "Ortodox de Răsărit",   "sortOrder": 2 },
    { "id": "5a26ed77-b63c-4780-b4fe-8d848851b761", "name": "Penticostalism",       "sortOrder": 3 },
    { "id": "b379b530-0e85-4b54-ad8c-6b920ab7bd0c", "name": "Martorii lui Iehova",  "sortOrder": 4 },
    { "id": "094d3204-73d9-49d7-9683-6b0e26043276", "name": "Iudaism",              "sortOrder": 5 },
    { "id": "bb6b3e24-7909-4fbd-ae8b-09ab3298f221", "name": "Islam",                "sortOrder": 6 },
    { "id": "3a582197-4e01-4e5d-afad-4bc9db03851e", "name": "Baptiști",             "sortOrder": 7 },
    { "id": "d214f39e-0d8b-4281-a85a-08f960563f67", "name": "Mormonism",            "sortOrder": 8 },
    { "id": "9c6f9ce7-b673-4b07-8427-5affdd393a70", "name": "Altele",               "sortOrder": 9 }
  ]
}
```

---

### GET /api/master/genders

Returns the list of active gender options used in onboarding step-1 and profile editing.

| Property       | Value                    |
|----------------|--------------------------|
| **Method**     | GET                      |
| **Path**       | `/api/master/genders`    |
| **Auth**       | x-api-key required       |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Genders fetched successfully.",
  "data": [
    { "id": "uuid-1", "name": "Men",       "emoji": "👨", "sortOrder": 1 },
    { "id": "uuid-2", "name": "Women",     "emoji": "👩", "sortOrder": 2 },
    { "id": "uuid-3", "name": "Nonbinary", "emoji": "🧑", "sortOrder": 3 },
    { "id": "uuid-4", "name": "Everyone",  "emoji": "🌍", "sortOrder": 4 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- Use the returned `id` value as the `gender_id` field in onboarding step-1 and `PATCH /api/profile/details`.
- Names are localized to the active language — see [Localization](#localization) for details.

#### Romanian Example (`Accept-Language: ro`)

```json
{
  "status": true,
  "message": "Genurile au fost obținute cu succes.",
  "data": [
    { "id": "uuid-1", "name": "Bărbați",  "emoji": "👨", "sortOrder": 1 },
    { "id": "uuid-2", "name": "Femei",    "emoji": "👩", "sortOrder": 2 },
    { "id": "uuid-3", "name": "Nebinar",  "emoji": "🧑", "sortOrder": 3 },
    { "id": "uuid-4", "name": "Toți",     "emoji": "🌍", "sortOrder": 4 }
  ]
}
```

---

### GET /api/master/looking-for

Returns the list of active relationship intent options for profile setup.

| Property       | Value                      |
|----------------|----------------------------|
| **Method**     | GET                        |
| **Path**       | `/api/master/looking-for`  |
| **Auth**       | x-api-key required         |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Looking for options fetched successfully.",
  "data": [
    { "id": "uuid-1", "name": "Long-term relationship", "emoji": "❤️",  "sortOrder": 1 },
    { "id": "uuid-2", "name": "Short-term dating",      "emoji": "😊",  "sortOrder": 2 },
    { "id": "uuid-3", "name": "Something casual",       "emoji": "😄",  "sortOrder": 3 },
    { "id": "uuid-4", "name": "New friends",            "emoji": "💛",  "sortOrder": 4 },
    { "id": "uuid-5", "name": "Not sure yet",           "emoji": "🤔",  "sortOrder": 5 },
    { "id": "uuid-6", "name": "Open to anything",       "emoji": "🌍",  "sortOrder": 6 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.

---

### GET /api/master/spoken-languages

Returns the list of active spoken language options for profile setup.

| Property       | Value                           |
|----------------|---------------------------------|
| **Method**     | GET                             |
| **Path**       | `/api/master/spoken-languages`  |
| **Auth**       | x-api-key required              |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Spoken languages fetched successfully.",
  "data": [
    { "id": "uuid-1",  "name": "Romanian",   "code": "ro", "sortOrder": 1  },
    { "id": "uuid-2",  "name": "English",    "code": "en", "sortOrder": 2  },
    { "id": "uuid-3",  "name": "Spanish",    "code": "es", "sortOrder": 3  },
    { "id": "uuid-4",  "name": "French",     "code": "fr", "sortOrder": 4  },
    { "id": "uuid-5",  "name": "German",     "code": "de", "sortOrder": 5  },
    { "id": "uuid-6",  "name": "Italian",    "code": "it", "sortOrder": 6  },
    { "id": "uuid-7",  "name": "Portuguese", "code": "pt", "sortOrder": 7  },
    { "id": "uuid-8",  "name": "Russian",    "code": "ru", "sortOrder": 8  },
    { "id": "uuid-9",  "name": "Arabic",     "code": "ar", "sortOrder": 9  },
    { "id": "uuid-10", "name": "Korean",     "code": "ko", "sortOrder": 10 },
    { "id": "uuid-11", "name": "Japanese",   "code": "ja", "sortOrder": 11 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- `code` is the ISO 639-1 two-letter language code.

---

### GET /api/master/interests

Returns the list of active interest/hobby options for profile setup.

| Property       | Value                    |
|----------------|--------------------------|
| **Method**     | GET                      |
| **Path**       | `/api/master/interests`  |
| **Auth**       | x-api-key required       |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Interests fetched successfully.",
  "data": [
    { "id": "uuid-1",  "name": "Coffee Lover", "emoji": "☕",  "sortOrder": 1  },
    { "id": "uuid-2",  "name": "Concerts",     "emoji": "🎵",  "sortOrder": 2  },
    { "id": "uuid-3",  "name": "Dancing",      "emoji": "💃",  "sortOrder": 3  },
    { "id": "uuid-4",  "name": "Foodie",       "emoji": "🍕",  "sortOrder": 4  },
    { "id": "uuid-5",  "name": "Cocktails",    "emoji": "🍸",  "sortOrder": 5  },
    { "id": "uuid-6",  "name": "Road Trips",   "emoji": "🚗",  "sortOrder": 6  },
    { "id": "uuid-7",  "name": "Cooking",      "emoji": "🍳",  "sortOrder": 7  },
    { "id": "uuid-8",  "name": "Mountains",    "emoji": "🏔️",  "sortOrder": 8  },
    { "id": "uuid-9",  "name": "Photography",  "emoji": "📷",  "sortOrder": 9  },
    { "id": "uuid-10", "name": "Running",      "emoji": "🏃",  "sortOrder": 10 },
    { "id": "uuid-11", "name": "Art",          "emoji": "🎨",  "sortOrder": 11 },
    { "id": "uuid-12", "name": "Pet Lover",    "emoji": "🐾",  "sortOrder": 12 },
    { "id": "uuid-13", "name": "Shopping",     "emoji": "🛍️",  "sortOrder": 13 },
    { "id": "uuid-14", "name": "Astrology",    "emoji": "🔮",  "sortOrder": 14 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.

---

### GET /api/master/forum-types

Returns the list of active forum type labels used to categorise forum posts.

| Property       | Value                       |
|----------------|-----------------------------|
| **Method**     | GET                         |
| **Path**       | `/api/master/forum-types`   |
| **Auth**       | x-api-key required          |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Forum types fetched successfully.",
  "data": [
    { "id": "uuid-1", "name": "Religion",  "sortOrder": 0 },
    { "id": "uuid-2", "name": "Political", "sortOrder": 1 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- Managed by admin (add/edit/delete via Master Management).

---

### GET /api/master/politicals

Returns the list of active political orientation options for forum posts.

| Property       | Value                       |
|----------------|-----------------------------|
| **Method**     | GET                         |
| **Path**       | `/api/master/politicals`    |
| **Auth**       | x-api-key required          |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Politicals fetched successfully.",
  "data": [
    { "id": "uuid-1", "name": "Left Wing",  "sortOrder": 1 },
    { "id": "uuid-2", "name": "Right Wing", "sortOrder": 2 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- Managed by admin (add/edit/delete via Master Management).

---

### GET /api/master/aivideo-categories

Returns the list of active AI video category options.

| Property       | Value                            |
|----------------|----------------------------------|
| **Method**     | GET                              |
| **Path**       | `/api/master/aivideo-categories` |
| **Auth**       | x-api-key required               |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "AI video categories fetched successfully.",
  "data": [
    { "id": "uuid-1", "name": "Category Name", "sortOrder": 1 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- Categories are managed by admin. The list may be empty if no categories have been created yet.

---

### GET /api/master/discover-categories

Returns the list of active Discover screen category cards.

| Property       | Value                                 |
|----------------|---------------------------------------|
| **Method**     | GET                                   |
| **Path**       | `/api/master/discover-categories`     |
| **Auth**       | x-api-key required                    |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "discoverCategoriesFetched",
  "data": [
    { "id": "uuid-1", "name": "AI Videos", "image": "http://localhost:5000/discover-categories/discover-123.jpg", "sortOrder": 1 },
    { "id": "uuid-2", "name": "Forum",     "image": null, "sortOrder": 2 },
    { "id": "uuid-3", "name": "Live",      "image": null, "sortOrder": 3 },
    { "id": "uuid-4", "name": "Feed",      "image": null, "sortOrder": 4 },
    { "id": "uuid-5", "name": "Dating",    "image": null, "sortOrder": 5 },
    { "id": "uuid-6", "name": "Business",  "image": null, "sortOrder": 6 }
  ]
}
```

**Notes:**
- Only `isActive: true` records are returned, ordered by `sortOrder` ASC.
- `image` is `null` until an admin uploads an image via the admin panel.
- When present, `image` is returned as a full URL (BASE_URL-prefixed).
- 6 categories are seeded by default: AI Videos, Forum, Live, Feed, Dating, Business.
- Supports `Accept-Language` header for localized `name` values (ro, es, ru).

---

### GET /api/master/distance-types

Returns the two supported distance type values used in the dating profile setup form.

| Property       | Value                           |
|----------------|---------------------------------|
| **Method**     | GET                             |
| **Path**       | `/api/master/distance-types`    |
| **Auth**       | x-api-key required              |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Distance types fetched successfully.",
  "data": [
    { "value": "nearby", "label": "Nearby" },
    { "value": "global", "label": "Global" }
  ]
}
```

**Notes:**
- Static list — not stored in the database.
- Use the `value` field when submitting `distance_type` in `POST /api/dating-profile`.

---

### GET /api/master/settings

Returns the app-wide configurable settings for discovery filters.

| Property       | Value                    |
|----------------|--------------------------|
| **Method**     | GET                      |
| **Path**       | `/api/master/settings`   |
| **Auth**       | x-api-key required       |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Settings fetched successfully.",
  "data": {
    "age_max": 80,
    "age_min": 18,
    "free_swipes": 5,
    "live_enabled": true,
    "marketplace_limit": 50,
    "max_distance_km": "50",
    "max_filters": 10,
    "nearby_radius": 100,
    "premium_badge_enabled": true,
    "premium_swipes": -1
  }
}
```

**Notes:**
- Values are returned with their correct types — numbers as numbers, booleans as booleans, strings as strings.
- `free_swipes` — maximum daily swipes for free users. `premium_swipes: -1` means unlimited.
- `age_min` / `age_max` — the default age range for the discovery filter (in years).
- `max_distance_km` — the maximum allowed distance radius for the discovery filter (in kilometres).
- `nearby_radius` — radius in km used for "nearby" distance type filtering.
- `max_filters` — maximum number of active filters a user can apply at once.
- `marketplace_limit` — maximum marketplace listings per user.
- `live_enabled` / `premium_badge_enabled` — feature flags; `false` disables the feature app-wide.

---

### GET /api/master/post-types

Returns the list of active post types. Used in the Feed screen to let users filter posts by visibility.

| Property       | Value                        |
|----------------|------------------------------|
| **Method**     | GET                          |
| **Path**       | `/api/master/post-types`     |
| **Auth**       | x-api-key required           |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Post types fetched.",
  "data": [
    { "id": "uuid-1", "name": "Public", "emoji": null, "sortOrder": 1 },
    { "id": "uuid-2", "name": "My Following Only", "emoji": null, "sortOrder": 2 }
  ]
}
```

**Notes:**
- Results are ordered by `sortOrder` ascending.
- Inactive post types are excluded.
- Managed by admin via the Master Management panel.

---

## Auth APIs

### POST /api/auth/send-otp

Generates and sends a 6-digit OTP. For `register` and `login` types, the endpoint automatically detects whether the user exists:
- **User does not exist** → new account is created, OTP sent via SMS (`isNewUser: true`)
- **User already exists** → OTP sent to existing account via SMS (`isNewUser: false`)

No separate register/login distinction is needed from the client for phone-based auth.

| Property       | Value                              |
|----------------|------------------------------------|
| **Method**     | POST                               |
| **Path**       | `/api/auth/send-otp`               |
| **Auth**       | x-api-key + Conditional (see below)|
| **Content-Type** | `application/json`               |

**Authentication by type:**

| Type           | Auth Required | Action                                                                  |
|----------------|---------------|-------------------------------------------------------------------------|
| `register`     | No            | Creates user if not exists, otherwise uses existing — sends OTP via SMS |
| `login`        | No            | Same as `register` — creates user if not exists, sends OTP via SMS      |
| `update_phone` | Yes (Bearer)  | Sends OTP to the NEW phone number                                       |
| `update_email` | Yes (Bearer)  | Sends OTP via EMAIL to the new email address                            |

#### Request Body

| Field         | Type   | Required When                          | Validation                              |
|---------------|--------|----------------------------------------|-----------------------------------------|
| `type`        | string | Always                                 | `register` \| `login` \| `update_phone` \| `update_email` |
| `phoneCode`   | string | type ∈ {register, login, update_phone} | E.164 format: `+` followed by 1–4 digits (e.g. `+1`, `+91`) |
| `phoneNumber` | string | type ∈ {register, login, update_phone} | 7–15 digits only (no spaces, dashes, or special chars) |
| `email`       | string | type = update_email                    | Valid email format                      |

#### Request Examples

**Register or Login (same screen — works for both new and existing users):**
```json
{
  "type": "register",
  "phoneCode": "+1",
  "phoneNumber": "9000000001"
}
```

**Update phone (auth required):**
```json
{
  "type": "update_phone",
  "phoneCode": "+44",
  "phoneNumber": "7700000001"
}
```

**Update email (auth required):**
```json
{
  "type": "update_email",
  "email": "newemail@example.com"
}
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "OTP sent to your phone number.",
  "data": { "isNewUser": true }
}
```

> `isNewUser` is only present for `register` and `login` types. `true` = new account was created; `false` = existing account found.

#### Error Responses

| Code | Condition                                   | Message                                                         |
|------|---------------------------------------------|-----------------------------------------------------------------|
| 401  | `update_phone`/`update_email` without token | `Access denied. No token provided.`                             |
| 409  | `update_phone` — new phone already taken    | `This phone number is already associated with another account.` |
| 409  | `update_email` — new email already taken    | `This email address is already associated with another account.`|
| 422  | Joi validation failure                      | See errors object                                               |
| 503  | SMS/email delivery failure                  | `Failed to send OTP. Please try again.`                         |

**422 Validation Error Examples:**
```json
{ "status": false, "message": "Validation failed", "errors": { "type": ["type is required"] } }
{ "status": false, "message": "Validation failed", "errors": { "type": ["type must be one of: register, login, update_phone, update_email"] } }
{ "status": false, "message": "Validation failed", "errors": { "phoneNumber": ["phoneNumber is required"] } }
{ "status": false, "message": "Validation failed", "errors": { "phoneNumber": ["phoneNumber must contain digits only"] } }
{ "status": false, "message": "Validation failed", "errors": { "phoneNumber": ["phoneNumber must be at least 7 digits"] } }
{ "status": false, "message": "Validation failed", "errors": { "phoneCode": ["phoneCode must be in E.164 format, e.g. +1 or +91"] } }
{ "status": false, "message": "Validation failed", "errors": { "email": ["email must be a valid email address"] } }
{ "status": false, "message": "Validation failed", "errors": { "email": ["email is required for update_email"] } }
```

---

### POST /api/auth/resend-otp

Regenerates and resends the OTP. User must already exist (no user creation).

| Property       | Value                     |
|----------------|---------------------------|
| **Method**     | POST                      |
| **Path**       | `/api/auth/resend-otp`    |
| **Auth**       | Conditional (same as send-otp) |
| **Content-Type** | `application/json`      |

#### Request Body

Same fields as `send-otp` (no `email` field for `update_email` type — uses stored `pendingEmail`).

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "OTP resent to your phone number.",
  "data": {}
}
```

#### Error Responses

| Code | Condition                                         | Message                                                              |
|------|---------------------------------------------------|----------------------------------------------------------------------|
| 400  | `update_phone` called without prior `send-otp`    | `No pending phone change found. Please initiate the change first.`   |
| 400  | `update_email` called without prior `send-otp`    | `No pending email change found. Please initiate the change first.`   |
| 404  | Phone not found                                   | `No account found for this phone number.`                            |
| 422  | Joi validation failure                            | See errors object                                                    |
| 503  | OTP delivery failure                              | `Failed to resend OTP. Please try again.`                            |

---

### POST /api/auth/verify-otp

Validates the 6-digit OTP and performs the corresponding action.

| Property       | Value                     |
|----------------|---------------------------|
| **Method**     | POST                      |
| **Path**       | `/api/auth/verify-otp`    |
| **Auth**       | Conditional (same as send-otp) |
| **Content-Type** | `application/json`      |

**Action by type:**

| Type           | Action on Success                                               |
|----------------|-----------------------------------------------------------------|
| `register`     | Issues JWT token, clears OTP fields                            |
| `login`        | Issues JWT token, clears OTP fields                            |
| `update_phone` | Promotes `pendingPhone` → `phoneNumber`, clears pending fields |
| `update_email` | Promotes `pendingEmail` → `email`, clears pending fields       |

#### Request Body

| Field         | Type   | Required When                          | Validation                              |
|---------------|--------|----------------------------------------|-----------------------------------------|
| `type`        | string | Always                                 | `register` \| `login` \| `update_phone` \| `update_email` |
| `phoneCode`   | string | type ∈ {register, login, update_phone} | E.164 format                            |
| `phoneNumber` | string | type ∈ {register, login, update_phone} | 7–15 digits only                        |
| `email`       | string | type = update_email                    | Valid email format                      |
| `otp`         | string | Always                                 | Exactly 6 digits                        |

#### Request Examples

**Register/Login verify (use `111111` in testing mode):**
```json
{
  "type": "register",
  "phoneCode": "+1",
  "phoneNumber": "9000000001",
  "otp": "111111"
}
```

**Update phone verify:**
```json
{
  "type": "update_phone",
  "phoneCode": "+1",
  "phoneNumber": "9000000002",
  "otp": "111111"
}
```

**Update email verify:**
```json
{
  "type": "update_email",
  "email": "newemail@example.com",
  "otp": "111111"
}
```

#### Success Response — 200 OK (register/login)

```json
{
  "status": true,
  "message": "OTP verified successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "16f7b6c8-e512-45bf-8550-4ab0a2205622",
      "phoneNumber": "+19000000001",
      "phoneCode": "+1",
      "email": null,
      "onboardingStep": 0,
      "isCompleteProfile": false,
      "isActive": false,
      "fullName": null,
      "dob": null,
      "gender": null,
      "belongingCountryId": null,
      "religionId": null,
      "profileImage": null,
      "isPrivate": false,
      "createdAt": "2026-05-29T07:53:38.755Z",
      "updatedAt": "2026-05-29T08:00:00.000Z",
      "address": null,
      "belongingCountry": null,
      "religion": null
    }
  }
}
```

#### Success Response — 200 OK (update_phone / update_email)

```json
{
  "status": true,
  "message": "Phone number updated successfully.",
  "data": {
    "user": {
      "id": "...",
      "phoneNumber": "+19000000002"
    }
  }
}
```

#### Error Responses

| Code | Condition                          | Message                                              |
|------|------------------------------------|------------------------------------------------------|
| 401  | OTP does not match                 | `Invalid OTP. Please check the code and try again.`  |
| 401  | OTP expired (5-minute window)      | `OTP has expired. Please request a new one.`         |
| 401  | Missing/invalid Bearer token       | `Access denied. No token provided.`                  |
| 404  | User not found                     | `No account found for this phone number.`            |
| 422  | OTP not 6 digits / alphanumeric    | `otp must be exactly 6 digits`                       |
| 422  | Missing otp field                  | `otp is required`                                    |

---

### POST /api/auth/social-login

Authenticates a user via Google, Facebook, or Apple.

| Property       | Value                        |
|----------------|------------------------------|
| **Method**     | POST                         |
| **Path**       | `/api/auth/social-login`     |
| **Auth**       | None                         |
| **Content-Type** | `application/json`         |

**Dev Mode Behavior:** When provider credentials are set to `null` in `.env`, the API trusts the client-supplied `providerId` directly without cryptographic verification. In production, tokens are verified via provider SDKs.

#### Request Body

| Field           | Type   | Required | Validation                                       |
|-----------------|--------|----------|--------------------------------------------------|
| `provider`      | string | Yes      | `google` \| `facebook` \| `apple`               |
| `providerToken` | string | Yes      | Minimum 10 characters                            |
| `providerId`    | string | Yes      | Provider's unique user identifier (sub/uid)      |
| `email`         | string | No       | Valid email (optional; Apple hides after first auth) |
| `name`          | string | No       | Display name, max 100 characters                 |

#### Request Examples

**Google:**
```json
{
  "provider": "google",
  "providerToken": "google_id_token_from_client_sdk",
  "providerId": "118234567890123456789",
  "email": "user@gmail.com",
  "name": "Test User"
}
```

**Facebook:**
```json
{
  "provider": "facebook",
  "providerToken": "facebook_access_token_from_sdk",
  "providerId": "1234567890",
  "email": "user@facebook.com",
  "name": "Facebook User"
}
```

**Apple:**
```json
{
  "provider": "apple",
  "providerToken": "apple_identity_token_from_sdk",
  "providerId": "001234.abcd1234efgh5678ijkl.0123"
}
```

#### Success Response — 200 OK (New User)

```json
{
  "status": true,
  "message": "Social account created successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "dc079208-42bf-45e8-87f3-552ad05273ce",
      "phoneNumber": null,
      "email": "user@gmail.com",
      "fullName": "Test User",
      "onboardingStep": 0,
      "isCompleteProfile": false,
      "isActive": true
    },
    "isNewUser": true
  }
}
```

#### Success Response — 200 OK (Existing User)

```json
{
  "status": true,
  "message": "Logged in successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": { "id": "dc079208-42bf-45e8-87f3-552ad05273ce" },
    "isNewUser": false
  }
}
```

#### Error Responses

| Code | Condition                             | Message                                                  |
|------|---------------------------------------|----------------------------------------------------------|
| 401  | Provider token verification failed    | `Facebook token is invalid or has expired.`              |
| 403  | User's account is soft-deleted        | `This account has been deleted. Please contact support.` |
| 422  | Invalid provider value                | `provider must be one of: google, facebook, apple`       |
| 422  | providerToken too short               | `providerToken appears too short to be valid`            |
| 422  | Missing providerId                    | `providerId is required`                                 |
| 422  | Invalid email format                  | `email must be a valid email address`                    |

---

### GET /api/auth/profile

Returns the authenticated user's complete profile including address, belonging country, and religion.

| Property       | Value                   |
|----------------|-------------------------|
| **Method**     | GET                     |
| **Path**       | `/api/auth/profile`     |
| **Auth**       | Bearer token required   |

#### Request Headers

```
Authorization: Bearer <token>
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Profile fetched successfully.",
  "data": {
    "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
    "phoneNumber": "+919876543210",
    "phoneCode": "+91",
    "email": null,
    "onboardingStep": 3,
    "isCompleteProfile": true,
    "isActive": true,
    "fullName": "Roma User",
    "dob": "1992-03-20T00:00:00.000Z",
    "genderId": "uuid-2",
    "belongingCountryId": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
    "religionId": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
    "profileImage": "/public/avatars/avatar-1780041996718-87464.jpg",
    "isPrivate": false,
    "emailNotification": true,
    "pushNotification": true,
    "language": "en",
    "createdAt": "2026-05-29T08:01:55.382Z",
    "updatedAt": "2026-05-29T08:06:36.722Z",
    "address": {
      "id": "28e51509-d7ed-41a6-a64d-4282c87fda81",
      "userId": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
      "addressLine1": "123 Main Street",
      "addressLine2": "Apt 4B",
      "city": "Bucharest",
      "state": "Ilfov",
      "country": "Romania",
      "zipCode": "010101",
      "latitude": 44.4268,
      "longitude": 26.1025,
      "createdAt": "2026-05-29T08:01:55.693Z",
      "updatedAt": "2026-05-29T08:01:55.693Z"
    },
    "gender": { "id": "uuid-2", "name": "Women", "emoji": "👩" },
    "belongingCountry": {
      "id": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
      "name": "Turkey",
      "code": "TR",
      "flag": "🇹🇷",
      "sortOrder": 1,
      "isActive": true
    },
    "religion": {
      "id": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
      "name": "Roman Catholic",
      "sortOrder": 1,
      "isActive": true
    }
  }
}
```

#### Error Responses

| Code | Condition           | Message                             |
|------|---------------------|-------------------------------------|
| 401  | No token provided   | `Access denied. No token provided.` |
| 401  | Invalid/expired JWT | `Invalid or expired token.`         |
| 401  | Malformed header    | `Access denied. No token provided.` |
| 404  | User not found      | `User not found.`                   |

**Note:** Sensitive fields (`otp`, `otpExpiresAt`, `token`, `pendingPhone`, `pendingPhoneCode`, `pendingEmail`) are stripped from all profile responses.

---

### POST /api/auth/logout

Clears the stored JWT token from the user's database record.

| Property       | Value                   |
|----------------|-------------------------|
| **Method**     | POST                    |
| **Path**       | `/api/auth/logout`      |
| **Auth**       | Bearer token required   |

#### Request Headers

```
Authorization: Bearer <token>
```

No request body required.

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Logged out successfully.",
  "data": {}
}
```

#### Error Responses

| Code | Condition         | Message                             |
|------|-------------------|-------------------------------------|
| 401  | No token          | `Access denied. No token provided.` |
| 401  | Invalid JWT       | `Invalid or expired token.`         |

**Note:** Since JWT is stateless, the token remains cryptographically valid until its expiry date even after logout. The server-side token field is cleared for record-keeping only.

---

### POST /api/auth/delete-account

Soft-deletes the user account by setting a `deletedAt` timestamp. The user cannot log in after deletion.

| Property       | Value                      |
|----------------|----------------------------|
| **Method**     | POST                       |
| **Path**       | `/api/auth/delete-account` |
| **Auth**       | Bearer token required      |

#### Request Headers

```
Authorization: Bearer <token>
```

No request body required.

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Account deleted successfully.",
  "data": {}
}
```

#### Error Responses

| Code | Condition         | Message                             |
|------|-------------------|-------------------------------------|
| 401  | No token          | `Access denied. No token provided.` |
| 401  | Invalid JWT       | `Invalid or expired token.`         |

**Note:** Deletion is a soft delete — the record is retained with `deletedAt` set. Attempting to `register` the same phone number after deletion will require creating a new account (the phone is treated as available since `deletedAt IS NOT NULL`).

---

## Onboarding APIs

All onboarding routes require Bearer token authentication.

### POST /api/onboarding/step-1

Saves user's personal information: full name, date of birth, gender, and optional address. Sets `onboardingStep = 1`.

| Property       | Value                      |
|----------------|----------------------------|
| **Method**     | POST                       |
| **Path**       | `/api/onboarding/step-1`   |
| **Auth**       | Bearer token required      |
| **Content-Type** | `application/json`       |

#### Request Headers

```
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request Body

| Field                   | Type    | Required | Validation                                                      |
|-------------------------|---------|----------|-----------------------------------------------------------------|
| `fullName`              | string  | Yes      | 2–100 characters (trimmed)                                      |
| `dob`                   | string  | Yes      | Format `YYYY-MM-DD`; must be past date; user must be ≥ 18 years |
| `gender_id`             | string  | Yes      | Valid UUID; must exist in `Gender` table (isActive=true)        |
| `address`               | object  | No       | Optional — all sub-fields are individually optional             |
| `address.addressLine1`  | string  | No       | Max 200 characters                                              |
| `address.addressLine2`  | string  | No       | Max 200 characters                                              |
| `address.city`          | string  | No       | Max 100 characters                                              |
| `address.state`         | string  | No       | Max 100 characters                                              |
| `address.country`       | string  | No       | Max 100 characters                                              |
| `address.zipCode`       | string  | No       | Max 20 characters; alphanumeric, hyphens, and spaces only       |
| `address.latitude`      | number  | No       | -90 to +90, precision 8                                         |
| `address.longitude`     | number  | No       | -180 to +180, precision 8                                       |

#### Request Example

```json
{
  "fullName": "Roma Test User",
  "dob": "1990-06-15",
  "gender_id": "<uuid-from-GET-/api/master/genders>",
  "address": {
    "addressLine1": "123 Main Street",
    "addressLine2": "Apt 4B",
    "city": "Bucharest",
    "state": "Ilfov",
    "country": "Romania",
    "zipCode": "010101",
    "latitude": 44.4268,
    "longitude": 26.1025
  }
}
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Step 1 saved successfully.",
  "data": {
    "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
    "phoneNumber": "+919876543210",
    "onboardingStep": 1,
    "fullName": "Roma Test User",
    "dob": "1990-06-15T00:00:00.000Z",
    "genderId": "uuid-1",
    "gender": { "id": "uuid-1", "name": "Men", "emoji": "👨" },
    "address": {
      "id": "28e51509-d7ed-41a6-a64d-4282c87fda81",
      "addressLine1": "123 Main Street",
      "addressLine2": "Apt 4B",
      "city": "Bucharest",
      "state": "Ilfov",
      "country": "Romania",
      "zipCode": "010101",
      "latitude": 44.4268,
      "longitude": 26.1025
    }
  }
}
```

#### Error Responses

| Code | Condition               | Message / Field Error                                    |
|------|-------------------------|----------------------------------------------------------|
| 401  | No / invalid token      | `Access denied. No token provided.`                      |
| 422  | fullName < 2 chars      | `fullName must be at least 2 characters`                 |
| 422  | fullName > 100 chars    | `fullName must not exceed 100 characters`                |
| 422  | dob missing             | `dob is required`                                        |
| 422  | dob wrong format        | `dob must be in YYYY-MM-DD format`                       |
| 422  | dob is future date      | `dob must be in the past`                                |
| 422  | dob underage (< 18)     | `You must be at least 18 years old`                      |
| 422  | dob invalid date        | `dob is not a valid date`                                |
| 404  | gender_id not found     | `Selected gender not found or is inactive.`              |
| 422  | gender_id not a UUID    | `"gender_id" must be a valid GUID`                       |
| 422  | gender_id missing       | `gender_id is required`                                  |
| 422  | zipCode has special chars | `zipCode must be alphanumeric`                         |
| 422  | latitude > 90 or < -90  | `"address.latitude" must be less than or equal to 90`    |
| 422  | longitude out of range  | `"address.longitude" must be less than or equal to 180`  |

**Note:** The `address` object is optional but idempotent — submitting step-1 again will update (`upsert`) the address record.

---

### POST /api/onboarding/step-2

Saves belonging country and religion selection. Both IDs must reference active records in the database. Sets `onboardingStep = 2`.

| Property       | Value                      |
|----------------|----------------------------|
| **Method**     | POST                       |
| **Path**       | `/api/onboarding/step-2`   |
| **Auth**       | Bearer token required      |
| **Content-Type** | `application/json`       |

#### Request Body

| Field                | Type   | Required | Validation                                                      |
|----------------------|--------|----------|-----------------------------------------------------------------|
| `belongingCountryId` | string | Yes      | Valid UUID; must exist in `BelongingCountry` table (isActive=true) |
| `religionId`         | string | Yes      | Valid UUID; must exist in `Religion` table (isActive=true)      |

#### Request Example

```json
{
  "belongingCountryId": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
  "religionId": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2"
}
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Step 2 saved successfully.",
  "data": {
    "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
    "onboardingStep": 2,
    "belongingCountryId": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
    "religionId": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
    "belongingCountry": {
      "id": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
      "name": "Turkey",
      "code": "TR",
      "flag": "🇹🇷"
    },
    "religion": {
      "id": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
      "name": "Roman Catholic"
    }
  }
}
```

#### Error Responses

| Code | Condition                        | Message                                                     |
|------|----------------------------------|-------------------------------------------------------------|
| 401  | No / invalid token               | `Access denied. No token provided.`                         |
| 404  | Country not found or inactive    | `Selected belonging country not found or is inactive.`      |
| 404  | Religion not found or inactive   | `Selected religion not found or is inactive.`               |
| 422  | Invalid UUID format              | `"belongingCountryId" must be a valid GUID`                 |
| 422  | Missing field                    | `belongingCountryId is required` / `religionId is required` |

**Tip:** Always fetch country and religion IDs from the master endpoints before calling this API.

---

### POST /api/onboarding/step-3

Uploads a profile image and sets the privacy preference. This is the final onboarding step — on success, `isCompleteProfile` and `isActive` are set to `true`.

| Property       | Value                         |
|----------------|-------------------------------|
| **Method**     | POST                          |
| **Path**       | `/api/onboarding/step-3`      |
| **Auth**       | Bearer token required         |
| **Content-Type** | `multipart/form-data`       |

#### Request Fields (Form Data)

| Field          | Type   | Required | Validation                               |
|----------------|--------|----------|------------------------------------------|
| `profileImage` | file   | Yes      | JPG/JPEG, PNG, or WebP; max 5MB          |
| `isPrivate`    | string | Yes      | `"true"` or `"false"` (string form-data) |

> **Important:** This endpoint uses `multipart/form-data`, **not** `application/json`. Do not send `Content-Type: application/json`.

#### curl Example

```bash
curl -X POST http://localhost:5000/api/onboarding/step-3 \
  -H "Authorization: Bearer <token>" \
  -F "profileImage=@/path/to/avatar.jpg;type=image/jpeg" \
  -F "isPrivate=false"
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Onboarding completed successfully.",
  "data": {
    "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
    "onboardingStep": 3,
    "isCompleteProfile": true,
    "isActive": true,
    "profileImage": "/public/avatars/avatar-1780041996718-87464.jpg",
    "isPrivate": false,
    "address": { "...": "..." },
    "belongingCountry": { "...": "..." },
    "religion": { "...": "..." }
  }
}
```

Profile image is stored at: `{BASE_URL}/public/avatars/<filename>` (served as a static file).

#### Error Responses

| Code | Condition                    | Message                                                    |
|------|------------------------------|------------------------------------------------------------|
| 400  | File type not allowed        | `Invalid file type. Only JPG, PNG, and WEBP are allowed.`  |
| 400  | File exceeds 5MB             | `File too large. Maximum size is 5MB`                      |
| 401  | No / invalid token           | `Access denied. No token provided.`                        |
| 422  | No `profileImage` file sent  | `{ "profileImage": ["Profile image is required"] }`        |
| 422  | `isPrivate` missing          | `{ "isPrivate": ["isPrivate is required"] }`               |

---

## Profile APIs

All profile routes require Bearer token authentication. These endpoints allow post-onboarding profile management.

---

### PATCH /api/profile/details

Partially updates the user's profile. All fields are optional — only provided fields are written to the database. Submitting again will overwrite previous values.

| Property         | Value                      |
|------------------|----------------------------|
| **Method**       | PATCH                      |
| **Path**         | `/api/profile/details`     |
| **Auth**         | Bearer token required      |
| **Content-Type** | `application/json`         |

#### Request Body

| Field                      | Type    | Required | Validation                                                      |
|----------------------------|---------|----------|-----------------------------------------------------------------|
| `full_name`                | string  | No       | 2–100 characters (trimmed)                                      |
| `dob`                      | string  | No       | Format `YYYY-MM-DD`; must be past date; user must be ≥ 18 years |
| `gender_id`                | string  | No       | Valid UUID; must exist in `Gender` table (isActive=true)        |
| `belonging_country`        | string  | No       | Valid UUID; must exist in `BelongingCountry` table (isActive=true) |
| `religion`                 | string  | No       | Valid UUID; must exist in `Religion` table (isActive=true)      |
| `is_private`               | boolean | No       | `true` or `false`                                               |
| `address`                  | object  | No       | Optional — all sub-fields are individually optional             |
| `address.address_line1`    | string  | No       | Max 200 characters                                              |
| `address.address_line2`    | string  | No       | Max 200 characters                                              |
| `address.city`             | string  | No       | Max 100 characters                                              |
| `address.state`            | string  | No       | Max 100 characters                                              |
| `address.country`          | string  | No       | Max 100 characters                                              |
| `address.zip_code`         | string  | No       | Max 20 characters; alphanumeric, hyphens, and spaces only       |
| `address.lat`              | number  | No       | -90 to +90, precision 8                                         |
| `address.long`             | number  | No       | -180 to +180, precision 8                                       |

> At least one field must be provided. An empty body `{}` returns a 422 error.

#### Request Examples

**Update name only:**
```json
{ "full_name": "Updated Name" }
```

**Full update:**
```json
{
  "full_name": "Roma User",
  "dob": "1992-03-20",
  "gender_id": "<uuid-from-GET-/api/master/genders>",
  "belonging_country": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
  "religion": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
  "is_private": false,
  "address": {
    "address_line1": "123 Main Street",
    "address_line2": "Apt 4B",
    "city": "Bucharest",
    "state": "Ilfov",
    "country": "Romania",
    "zip_code": "010101",
    "lat": 44.4268,
    "long": 26.1025
  }
}
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Profile updated successfully.",
  "data": {
    "user": {
      "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
      "fullName": "Roma User",
      "dob": "1992-03-20T00:00:00.000Z",
      "genderId": "uuid-2",
      "belongingCountryId": "af3e67f2-b23b-401b-a9a7-763e88f14bb2",
      "religionId": "c9aa41fe-0f4d-401e-b6c5-9aba53f49bc2",
      "isPrivate": false,
      "emailNotification": true,
      "pushNotification": true,
      "language": "en",
      "address": {
        "addressLine1": "123 Main Street",
        "addressLine2": "Apt 4B",
        "city": "Bucharest",
        "state": "Ilfov",
        "country": "Romania",
        "zipCode": "010101",
        "latitude": 44.4268,
        "longitude": 26.1025
      },
      "gender": { "id": "uuid-2", "name": "Women", "emoji": "👩" },
      "belongingCountry": { "id": "af3e67f2-...", "name": "Turkey", "code": "TR", "flag": "🇹🇷" },
      "religion": { "id": "c9aa41fe-...", "name": "Roman Catholic" }
    }
  }
}
```

#### Error Responses

| Code | Condition                         | Message / Field Error                                    |
|------|-----------------------------------|----------------------------------------------------------|
| 401  | No / invalid token                | `Access denied. No token provided.`                      |
| 404  | `gender_id` UUID not found        | `Gender not found.`                                      |
| 404  | `belonging_country` UUID not found | `Belonging country not found.`                          |
| 404  | `religion` UUID not found         | `Religion not found.`                                    |
| 422  | Empty body `{}`                   | `At least one field must be provided`                    |
| 422  | `full_name` < 2 chars             | `full_name must be at least 2 characters`                |
| 422  | `dob` underage                    | `You must be at least 18 years old`                      |
| 422  | `gender_id` not a UUID            | `"gender_id" must be a valid GUID`                       |
| 422  | `belonging_country` not a UUID    | `belonging_country must be a valid UUID`                 |

---

### PATCH /api/profile/image

Replaces the user's profile image. The old image is deleted from disk when a new one is uploaded.

| Property         | Value                      |
|------------------|----------------------------|
| **Method**       | PATCH                      |
| **Path**         | `/api/profile/image`       |
| **Auth**         | Bearer token required      |
| **Content-Type** | `multipart/form-data`      |

#### Request Fields (Form Data)

| Field          | Type | Required | Validation                                        |
|----------------|------|----------|---------------------------------------------------|
| `profileImage` | file | Yes      | JPG/JPEG/PNG/WebP; max 5MB                        |

> **Accepted MIME types:** `image/jpeg`, `image/jpg` (iOS non-standard), `image/png`, `image/webp`. Both extension and MIME type are checked — either match is sufficient.
>
> **Important:** This endpoint uses `multipart/form-data`, **not** `application/json`. The RN client must use `FormData` and must **not** manually set `Content-Type` — let the HTTP library set the multipart boundary automatically. Sending `Content-Type: application/x-www-form-urlencoded` causes a `400 Unexpected field` error.

#### curl Example

```bash
curl -X PATCH http://localhost:5000/api/profile/image \
  -H "Authorization: Bearer <token>" \
  -F "profileImage=@/path/to/new-avatar.jpg;type=image/jpeg"
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Profile image updated successfully.",
  "data": {
    "user": {
      "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
      "profileImage": "/public/avatars/avatar-1780041996718-12345.jpg"
    }
  }
}
```

#### Error Responses

| Code | Condition                              | Message                                                   |
|------|----------------------------------------|-----------------------------------------------------------|
| 400  | File type not allowed                  | `Invalid file type. Only JPG, PNG, and WEBP are allowed.` |
| 400  | File exceeds 5MB                       | `File too large. Maximum size is 5MB`                     |
| 400  | Wrong Content-Type (not multipart)     | `Unexpected field` — client sent `application/x-www-form-urlencoded` instead of `multipart/form-data` |
| 401  | No / invalid token                     | `Access denied. No token provided.`                       |
| 422  | No `profileImage` file sent            | `{ "profileImage": ["profileImage is required"] }`        |

---

### PATCH /api/profile/notification-preferences

Toggles email and/or push notification preferences. At least one preference must be provided.

| Property         | Value                                    |
|------------------|------------------------------------------|
| **Method**       | PATCH                                    |
| **Path**         | `/api/profile/notification-preferences`  |
| **Auth**         | Bearer token required                    |
| **Content-Type** | `application/json`                       |

#### Request Body

| Field   | Type    | Required      | Validation       |
|---------|---------|---------------|------------------|
| `email` | boolean | At least one  | `true` or `false` |
| `push`  | boolean | At least one  | `true` or `false` |

> Both `email` and `push` can be sent together, or just one at a time. Sending `false` turns the preference **off**.

#### Request Examples

**Turn off email notifications only:**
```json
{ "email": false }
```

**Turn off both:**
```json
{ "email": false, "push": false }
```

**Turn on push, turn off email:**
```json
{ "email": false, "push": true }
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Notification preferences updated successfully.",
  "data": {
    "user": {
      "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
      "emailNotification": false,
      "pushNotification": true
    }
  }
}
```

#### Error Responses

| Code | Condition                       | Message                                              |
|------|---------------------------------|------------------------------------------------------|
| 401  | No / invalid token              | `Access denied. No token provided.`                  |
| 422  | Empty body `{}`                 | `At least one of email or push must be provided`     |
| 422  | `email` is not a boolean        | Joi type error                                       |

---

### PATCH /api/profile/language

Updates the user's preferred language. Default is `"en"` (English).

| Property         | Value                      |
|------------------|----------------------------|
| **Method**       | PATCH                      |
| **Path**         | `/api/profile/language`    |
| **Auth**         | Bearer token required      |
| **Content-Type** | `application/json`         |

#### Request Body

| Field      | Type   | Required | Validation                                          |
|------------|--------|----------|-----------------------------------------------------|
| `language` | string | Yes      | 2–10 lowercase letters only. Supported values: `en`, `ro`, `es`, `ru` |

#### Request Examples

**Switch to Romanian:**
```json
{ "language": "ro" }
```

**Switch to Spanish:**
```json
{ "language": "es" }
```

**Switch to Russian:**
```json
{ "language": "ru" }
```

**Switch back to English:**
```json
{ "language": "en" }
```

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Language updated successfully.",
  "data": {
    "user": {
      "id": "11090601-aba5-405d-a4c2-9f7d4646f2fe",
      "language": "ro"
    }
  }
}
```

#### Error Responses

| Code | Condition                        | Message                                                |
|------|----------------------------------|--------------------------------------------------------|
| 401  | No / invalid token               | `Access denied. No token provided.`                    |
| 422  | `language` missing               | `language is required`                                 |
| 422  | `language` < 2 chars             | `language must be at least 2 characters`               |
| 422  | `language` > 10 chars            | `language must not exceed 10 characters`               |
| 422  | `language` contains uppercase or digits | `language must contain only lowercase letters`  |

---

---

## Dating Profile APIs

All routes: `Bearer {{AUTH_TOKEN}}` + `x-api-key` header required.

---

### POST /api/dating-profile

Creates or updates the user's dating profile. Plain JSON body — no file upload on this endpoint.

- `type: "add"` — Sets `isDatingProfileCompleted: true`. Upserts the profile.
- `type: "update"` — Partial update of an existing profile. At least one field besides `type` must be provided. Returns 404 if no profile exists yet.

> **All body fields besides `type` are optional** — validation only fires when a field is provided.
> `image` and `discover_preference` are **not** part of this endpoint — see [PATCH /api/dating-profile/discover-preference](#patch-apidating-profilediscover-preference) for the discover category preference. Image upload is not currently exposed via any endpoint.

| Property         | Value                      |
|------------------|----------------------------|
| **Method**       | POST                       |
| **Path**         | `/api/dating-profile`      |
| **Auth**         | Bearer token required      |
| **Content-Type** | `application/json`         |

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"add"` \| `"update"` | ✅ | add = create/replace, update = partial |
| `gender_id` | UUID | ❌ | Single gender to meet (Gender master, legacy) |
| `gender_ids` | UUID[] | ❌ | Multiple genders to meet — many-to-many. Min 1 if provided. |
| `age_range` | `{ min: number, max: number }` | ❌ | Age range (18–100) |
| `distance_type` | `"nearby"` \| `"global"` | ❌ | Search radius preference |
| `looking_for` | UUID[] | ❌ | LookingFor IDs (min 1 if provided) |
| `interests` | UUID[] | ❌ | Interest IDs (min 1 if provided) |
| `spoken_languages` | UUID[] | ❌ | SpokenLanguage IDs (min 1 if provided) |

> `gender_id` and `gender_ids` can be used independently. `gender_ids` populates the many-to-many `genders` relation; `gender_id` sets the scalar FK. Prefer `gender_ids` for new integrations.

**type: "add" — 200 OK**
```json
{
  "status": true,
  "message": "Dating profile saved successfully.",
  "data": {
    "id": "dp-uuid-1",
    "userId": "user-uuid-1",
    "image": null,
    "genderId": null,
    "ageMin": 22,
    "ageMax": 35,
    "distanceType": "nearby",
    "discoverCategoryId": null,
    "genders": [
      { "id": "gen-uuid-1", "name": "Men", "emoji": "👨" },
      { "id": "gen-uuid-2", "name": "Women", "emoji": "👩" }
    ],
    "discoverCategory": null,
    "lookingFor": [ { "id": "lf-uuid-1", "name": "Long-term relationship", "emoji": "❤️" } ],
    "interests": [ { "id": "int-uuid-1", "name": "Foodie", "emoji": "🍕" } ],
    "spokenLanguages": [ { "id": "lang-uuid-1", "name": "Romanian", "code": "ro" } ]
  }
}
```

**type: "update"** — only provided fields are changed. Returns 404 if no profile exists yet.
```json
{ "status": false, "message": "Dating profile not found. Please set up your dating profile first." }
```

---

### GET /api/dating-profile

Returns the current user's dating profile with all related master data. Returns `null` if not set up.

> **Note:** `genders` is a many-to-many array field — always returns an array (empty `[]` if none selected).

**200 OK**
```json
{
  "status": true,
  "message": "Dating profile fetched successfully.",
  "data": {
    "dating_profile": {
      "id": "dp-uuid-1",
      "userId": "user-uuid-1",
      "image": null,
      "genderId": "gen-uuid-2",
      "ageMin": 22,
      "ageMax": 35,
      "distanceType": "nearby",
      "discoverCategoryId": "cat-uuid-1",
      "genders": [ { "id": "gen-uuid-2", "name": "Men", "emoji": "👨" } ],
      "discoverCategory": { "id": "cat-uuid-1", "name": "Dating" },
      "lookingFor": [ { "id": "lf-uuid-1", "name": "Long-term relationship", "emoji": "❤️" } ],
      "interests": [ { "id": "int-uuid-1", "name": "Foodie", "emoji": "🍕" } ],
      "spokenLanguages": [ { "id": "lang-uuid-1", "name": "Romanian", "code": "ro" } ]
    }
  }
}
```

---

### PATCH /api/dating-profile/discover-preference

Updates only the user's Discover-screen category preference (`discoverCategoryId`), independent of the rest of the dating profile. If the user has no dating profile yet, a minimal one is auto-created — this endpoint never returns 404 for a missing profile.

| Property         | Value                                       |
|------------------|----------------------------------------------|
| **Method**       | PATCH                                       |
| **Path**         | `/api/dating-profile/discover-preference`   |
| **Auth**         | Bearer token required                       |
| **Content-Type** | `application/json`                          |

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `discover_preference` | UUID \| `null` | ✅ | DiscoverCategory id, or `null` to clear the preference |

**Request Examples**

```json
{ "discover_preference": "cat-uuid-1" }
```
```json
{ "discover_preference": null }
```

**200 OK**
```json
{
  "status": true,
  "message": "discoverPreferenceUpdated",
  "data": {
    "dating_profile": {
      "id": "dp-uuid-1",
      "discoverCategoryId": "cat-uuid-1",
      "discoverCategory": { "id": "cat-uuid-1", "name": "Dating" },
      "...": "rest of the dating profile fields"
    }
  }
}
```

#### Error Responses

| Code | Condition                                   | Message                                                          |
|------|---------------------------------------------|-------------------------------------------------------------------|
| 401  | No / invalid token                          | `Access denied. No token provided.`                               |
| 404  | `discover_preference` id not found/inactive | `dating-profile:discoverCategoryNotFound`                          |
| 422  | `discover_preference` missing               | `discover_preference is required`                                  |
| 422  | `discover_preference` not a valid UUID      | `discover_preference must be a valid id`                           |

---

## Discover APIs

All routes: `Bearer {{AUTH_TOKEN}}` + `x-api-key` header required.

---

### GET /api/discover/dating-profiles

Paginated feed of other users who have a dating profile. Excludes current user. All filters optional. Previously liked/disliked profiles are still shown.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 10 | Items per page (max 100) |
| `sort_by` | string | `newest` | `newest` \| `oldest` \| `age_asc` \| `age_desc` |
| `gender_id` | UUID \| UUID[] | — | Filter by dating profile target gender. Single value or repeatable: `?gender_id=id1&gender_id=id2` |
| `age_min` | number | — | Minimum age (18–100) |
| `age_max` | number | — | Maximum age (18–100) |
| `religion_id` | UUID \| UUID[] | — | Filter by user's religion. Single value or repeatable: `?religion_id=id1&religion_id=id2` |
| `distance_type` | string | — | `nearby` \| `global` |
| `looking_for` | UUID \| UUID[] | — | Single or repeatable: `?looking_for=id1&looking_for=id2` |
| `interests` | UUID \| UUID[] | — | Single or repeatable: `?interests=id1&interests=id2` |
| `spoken_languages` | UUID \| UUID[] | — | Single or repeatable: `?spoken_languages=id1&spoken_languages=id2` |

> **Multi-value filters:** All five filter params (`gender_id`, `religion_id`, `looking_for`, `interests`, `spoken_languages`) accept either a single UUID or multiple by repeating the query key. Profiles matching **any** of the supplied values are returned (OR logic).

**200 OK**
```json
{
  "status": true,
  "message": "Dating profiles fetched successfully.",
  "data": {
    "profiles": [
      {
        "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "fullName": "Lesli Say",
        "age": 28,
        "dob": "1997-03-15T00:00:00.000Z",
        "city": "New York",
        "state": "New York",
        "country": "United States",
        "religion": { "id": "rel-uuid-1", "name": "Roman Catholic", "sortOrder": 1, "isActive": true },
        "gender": { "id": "gen-uuid-1", "name": "Women", "emoji": "👩", "sortOrder": 2, "isActive": true },
        "profileImage": "http://localhost:5000/avatars/avatar-1781256414076.png",
        "datingProfile": {
          "id": "dp-uuid-1",
          "image": "http://localhost:5000/dating-profiles/dp-1781256414076.png",
          "genderId": "gen-uuid-2",
          "genders": [ { "id": "gen-uuid-2", "name": "Men", "emoji": "👨", "sortOrder": 1, "isActive": true } ],
          "ageMin": 24,
          "ageMax": 35,
          "distanceType": "nearby",
          "lookingFor": [
            { "id": "lf-uuid-1", "name": "Long-term relationship", "emoji": "❤️", "sortOrder": 1, "isActive": true }
          ],
          "interests": [
            { "id": "int-uuid-1", "name": "Foodie", "emoji": "🍕", "sortOrder": 4, "isActive": true }
          ],
          "spokenLanguages": [
            { "id": "lang-uuid-1", "name": "Romanian", "code": "ro", "sortOrder": 1, "isActive": true }
          ]
        }
      }
    ],
    "total": 42,
    "totalPages": 5
  }
}
```

> **Nullable fields:** `city`, `state`, `country`, `religion`, `gender`, `profileImage`, `datingProfile.image` can all be `null`.
> `datingProfile.genders` = who they want to meet (array); top-level `gender` = their own gender.
> **This response now includes the same fields as `GET /api/discover/dating-profiles/:userId`** — the React Native team does not need to call the detail endpoint separately for each card.

---

### GET /api/discover/dating-profiles/:userId

Full profile detail for a single user. Returns 400 if viewing own profile. Returns 404 if user has no dating profile or is inactive/deleted.

**200 OK**
```json
{
  "status": true,
  "message": "Profile fetched successfully.",
  "data": {
    "profile": {
      "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "fullName": "Lesli Say",
      "age": 28,
      "dob": "1997-03-15T00:00:00.000Z",
      "city": "New York",
      "religion": { "id": "rel-uuid-1", "name": "Roman Catholic", "isActive": true },
      "gender": { "id": "gen-uuid-1", "name": "Women", "emoji": "👩" },
      "profileImage": "http://localhost:5000/avatars/avatar-1781256414076.png",
      "datingProfile": {
        "id": "dp-uuid-1",
        "image": "http://localhost:5000/dating-profiles/dp-1781256414076.png",
        "genderId": "gen-uuid-2",
        "genders": [ { "id": "gen-uuid-2", "name": "Men", "emoji": "👨" } ],
        "ageMin": 24,
        "ageMax": 35,
        "distanceType": "nearby",
        "lookingFor": [ { "id": "lf-uuid-1", "name": "Long-term relationship", "emoji": "❤️" } ],
        "interests": [ { "id": "int-uuid-1", "name": "Foodie", "emoji": "🍕" } ],
        "spokenLanguages": [ { "id": "lang-uuid-1", "name": "Romanian", "code": "ro" } ]
      }
    }
  }
}
```

| Status | Condition |
|--------|-----------|
| 200 | Profile found |
| 400 | userId is the current user's own ID |
| 404 | User not found, not active, or has no dating profile |

---

### POST /api/discover/like/:userId

Records a like swipe on the target user. If the target has already liked back, a `UserMatch` record is created.
Idempotent — re-calling converts a previous dislike to a like. No request body.

**200 OK — no match**
```json
{ "status": true, "message": "Profile liked.", "data": { "liked": true, "isMatch": false } }
```

**200 OK — mutual like (match)**
```json
{ "status": true, "message": "It's a match!", "data": { "liked": true, "isMatch": true } }
```

**400** — cannot swipe on own profile.

---

### POST /api/discover/dislike/:userId

Records a dislike swipe. Idempotent — re-calling converts a previous like to a dislike. No request body.

**200 OK**
```json
{ "status": true, "message": "Profile disliked.", "data": { "disliked": true } }
```

**400** — cannot swipe on own profile.

---

### POST /api/discover/report

Reports a user from any context in the app.

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✅ | Report context — any non-empty string e.g. `"user_profile"`, `"post"`, `"ai_video"`, `"chat_message"`. Not restricted to a fixed list. |
| `id` | UUID | ✅ | Target user's UUID |
| `reason` | string | ❌ | Optional reason (max 500 chars) |

**Example — report from dating profile screen**
```json
{ "type": "user_profile", "id": "target-user-uuid", "reason": "Fake profile" }
```

**Example — report from a post**
```json
{ "type": "post", "id": "target-user-uuid", "reason": "Spam" }
```

**200 OK**
```json
{ "status": true, "message": "Report submitted successfully.", "data": { "reported": true } }
```

| Status | Condition |
|--------|-----------|
| 200 | Report saved |
| 400 | Reporting self |
| 404 | Target user not found |
| 422 | `type` is empty or missing, or `id` is not a valid UUID |

---

### GET /api/discover/swipe-status

Returns the logged-in user's swipe usage for today — how many swipes they've used and their daily limit.

| Property       | Value                             |
|----------------|-----------------------------------|
| **Method**     | GET                               |
| **Path**       | `/api/discover/swipe-status`      |
| **Auth**       | x-api-key + Bearer token required |

#### Success Response — 200 OK

```json
{
  "status": true,
  "message": "Swipe status fetched.",
  "data": {
    "swipesUsedToday": 3,
    "limit": 5,
    "isPremium": false
  }
}
```

**Premium user (unlimited swipes):**
```json
{
  "status": true,
  "message": "Swipe status fetched.",
  "data": {
    "swipesUsedToday": 47,
    "limit": null,
    "isPremium": true
  }
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `swipesUsedToday` | number | Number of swipes the user has made since midnight today |
| `limit` | number \| null | Daily swipe cap. `null` means unlimited (premium users with `premium_swipes = -1`) |
| `isPremium` | boolean | Whether the user currently has a premium subscription |

**Notes:**
- The daily swipe cap is read from the `free_swipes` / `premium_swipes` app settings.
- Use this endpoint to decide whether to show a "You've reached your swipe limit" screen before calling `POST /api/discover/like` or `POST /api/discover/dislike`.

---

## Dev Mode Notes

This API is configured for development (`.env` credentials are `null`):

### API Key
- All requests **must** include `x-api-key: <key>` header.
- The development key is stored in `.env` as `API_KEY`.
- In Postman, set the `API_KEY` collection variable and the header is pre-filled on every request.

### OTP (Testing Mode)
- `OTP_TESTING=true` is set in `.env` — the OTP is always **`111111`** for `register` and `login` flows.
- No need to check the server console. Just use `111111` in `verify-otp`.
- To restore real random OTPs, set `OTP_TESTING=false` in `.env` and restart the server.
- **Plivo SMS** is not configured (`PLIVO_AUTH_ID=null`) — in non-testing mode, OTP would be printed to server console only.
- OTP is valid for **5 minutes** from when it was generated.

### Social Login
- **Google, Facebook, Apple** credentials are all `null`
- The API bypasses cryptographic token verification
- Any `providerToken` ≥ 10 characters and any `providerId` string are accepted
- In production, tokens are verified via provider SDKs

### Email OTP
- SMTP is configured with real Gmail credentials
- OTP emails for `update_email` flow **will actually send**
- Use a real email address you control when testing this flow

### Production Checklist
Before going to production, configure in `.env`:
- `API_KEY` — rotate to a new random value; distribute securely to mobile clients
- `OTP_TESTING=false` — disable fixed OTP; configure Plivo for real SMS delivery
- `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_PHONE_NUMBER`
- `GOOGLE_CLIENT_ID`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`
- Set `JWT_SECRET` to a long random string

---

## Test Results Summary

All 47 test scenarios were executed against the live server. Results:

### ✅ Master APIs (2/2 passed — v1.0.0 baseline)
| Test | Expected | Result |
|------|----------|--------|
| GET belonging-countries | 200 | ✅ 200 |
| GET religions | 200 | ✅ 200 |

### Master APIs — v1.5.0 (pending test run)

| Endpoint | Test Cases |
|----------|------------|
| GET /api/master/genders | Returns 4 active genders ordered by sortOrder |
| GET /api/master/looking-for | Returns 6 active options ordered by sortOrder |
| GET /api/master/spoken-languages | Returns 11 active languages ordered by sortOrder |
| GET /api/master/interests | Returns 14 active interests ordered by sortOrder |
| GET /api/master/forum-types | Returns active forum type labels (e.g. Religion, Political) |
| GET /api/master/politicals  | Returns active political orientation options (e.g. Left Wing, Right Wing) |
| GET /api/master/aivideo-categories | Returns active AI video categories (empty until admin adds) |
| GET /api/master/discover-categories | Returns 6 active discover categories (AI Videos, Forum, Live, Feed, Dating, Business) |
| GET /api/master/settings | Returns { age_min, age_max, max_distance_km } as strings |

### ✅ Auth — Send OTP (10/10 passed)
| Test | Expected | Result |
|------|----------|--------|
| Register new user (valid) | 200 | ✅ 200 |
| Register duplicate phone | 409 | ✅ 409 |
| Register missing phoneNumber | 422 | ✅ 422 |
| Register phoneCode without `+` | 422 | ✅ 422 |
| Register type missing | 422 | ✅ 422 |
| Register type invalid | 422 | ✅ 422 |
| Login existing user | 200 | ✅ 200 |
| Login non-existent user | 404 | ✅ 404 |
| Update_phone without auth | 401 | ✅ 401 |
| Update_phone with auth | 200 | ✅ 200 |

### ✅ Auth — Resend OTP (3/3 passed)
| Test | Expected | Result |
|------|----------|--------|
| Resend register/login (valid) | 200 | ✅ 200 |
| Resend non-existent phone | 404 | ✅ 404 |
| Resend missing type | 422 | ✅ 422 |

### ✅ Auth — Verify OTP (6/6 passed)
| Test | Expected | Result |
|------|----------|--------|
| Correct OTP (register) | 200 + token | ✅ 200 |
| Wrong OTP | 401 | ✅ 401 |
| Expired OTP | 401 | ✅ 401 |
| 5-digit OTP | 422 | ✅ 422 |
| Alphanumeric OTP | 422 | ✅ 422 |
| Missing OTP | 422 | ✅ 422 |

### ✅ Auth — Social Login (8/8 passed)
| Test | Expected | Result |
|------|----------|--------|
| Google (new user, dev mode) | 200 + isNewUser:true | ✅ 200 |
| Facebook (new user, dev mode) | 200 + isNewUser:true | ✅ 200 |
| Apple (new user, dev mode) | 200 + isNewUser:true | ✅ 200 |
| Google same user (existing) | 200 + isNewUser:false | ✅ 200 |
| Missing provider | 422 | ✅ 422 |
| Invalid provider (twitter) | 422 | ✅ 422 |
| providerToken < 10 chars | 422 | ✅ 422 |
| Missing providerId | 422 | ✅ 422 |

### ✅ Auth — Profile / Logout / Delete (5/5 passed)
| Test | Expected | Result |
|------|----------|--------|
| GET profile (valid token) | 200 | ✅ 200 |
| GET profile (no token) | 401 | ✅ 401 |
| GET profile (invalid token) | 401 | ✅ 401 |
| POST logout | 200 | ✅ 200 |
| POST delete-account | 200 | ✅ 200 |

### ✅ Onboarding Step 1 (9/9 passed)
| Test | Expected | Result |
|------|----------|--------|
| Valid with full address | 200 | ✅ 200 |
| Valid without address (optional) | 200 | ✅ 200 |
| No auth | 401 | ✅ 401 |
| fullName < 2 chars | 422 | ✅ 422 |
| fullName > 100 chars | 422 | ✅ 422 |
| dob future | 422 | ✅ 422 |
| dob underage | 422 | ✅ 422 |
| dob wrong format | 422 | ✅ 422 |
| gender_id missing | 422 | ✅ 422 |
| gender_id not found | 404 | ✅ 404 |

### ✅ Onboarding Step 2 (5/5 passed)
| Test | Expected | Result |
|------|----------|--------|
| Valid UUIDs | 200 | ✅ 200 |
| No auth | 401 | ✅ 401 |
| Invalid UUID format | 422 | ✅ 422 |
| Non-existent UUID | 404 | ✅ 404 |
| Missing belongingCountryId | 422 | ✅ 422 |

### ✅ Onboarding Step 3 (6/6 passed)
| Test | Expected | Result |
|------|----------|--------|
| Valid JPG + isPrivate=false | 200 | ✅ 200 |
| Valid JPG + isPrivate=true | 200 | ✅ 200 |
| No auth | 401 | ✅ 401 |
| No profileImage | 422 | ✅ 422 |
| Missing isPrivate | 422 | ✅ 422 |
| Wrong file type (PDF) | 400 | ✅ 400 |
| File > 5MB | 400 | ✅ 400 |

---

**Total: 54/54 test scenarios passed ✅** (v1.0.0)

### Profile APIs (v1.1.0 — pending test run)

| Endpoint | Test Cases |
|----------|------------|
| PATCH /api/profile/details | Partial update (name only), full update with address, invalid belonging_country UUID, underage dob, empty body |
| PATCH /api/profile/image | Valid JPG, oversized file (>5MB), invalid type (PDF), missing file |
| PATCH /api/profile/notification-preferences | Toggle email only, push only, both off, empty body |
| PATCH /api/profile/language | Set "ro", set "en", invalid ("english" too long), missing field |

---

### ✅ Feed / Posts, Forum, AI Videos, User Profile (40/40 live-tested — v1.15.0, 2026-06-19)

All endpoints tested against a running server with real PostgreSQL data.

| Module | Endpoint | Result |
|--------|----------|--------|
| Feed | GET /api/feed/locations | ✅ Returns `{popular, results}` |
| Feed | POST /api/feed/posts (multipart) | ✅ 201 Created |
| Feed | GET /api/feed/posts | ✅ Paginated, filter works |
| Feed | GET /api/feed/posts/mine | ✅ Own posts |
| Feed | GET /api/feed/posts/user/:userId | ✅ Privacy gate works |
| Feed | GET /api/feed/posts/:id | ✅ Single post detail |
| Feed | POST /api/feed/posts/:id/like | ✅ Toggle `{liked: true/false}` |
| Feed | GET /api/feed/posts/:id/likes | ✅ `followStatus` field present |
| Feed | POST /api/feed/posts/:id/comments | ✅ 201 Created |
| Feed | GET /api/feed/posts/:id/comments | ✅ Nested replies returned |
| Feed | POST /api/feed/posts/:id/comments/:id/like | ✅ Toggle works |
| Feed | POST /api/feed/posts/:id/comments/:id/reply | ✅ 201 Created |
| Feed | POST /api/feed/posts/:id/share | ✅ Returns `shareUrl` |
| Feed | POST /api/feed/report | ✅ 201 Created |
| Feed | DELETE /api/feed/posts/:id | ✅ Soft deleted |
| Forum | POST /api/forum/threads | ✅ 201 Created |
| Forum | GET /api/forum/threads | ✅ Paginated |
| Forum | GET /api/forum/threads?forum_type=Political | ✅ Filter works |
| Forum | GET /api/forum/threads/mine | ✅ Own threads |
| Forum | GET /api/forum/threads/user/:userId | ✅ User threads |
| Forum | GET /api/forum/threads/:id | ✅ Single thread detail |
| Forum | POST /api/forum/threads/:id/like | ✅ Toggle `{liked: true/false}` |
| Forum | GET /api/forum/threads/:id/likes | ✅ `followStatus` field present |
| Forum | POST /api/forum/threads/:id/answers | ✅ 201 Created |
| Forum | GET /api/forum/threads/:id/answers | ✅ Nested replies returned |
| Forum | POST /api/forum/threads/:id/answers/:id/like | ✅ Toggle works |
| Forum | POST /api/forum/threads/:id/answers/:id/reply | ✅ 201 Created |
| Forum | POST /api/forum/threads/:id/share | ✅ Returns `shareUrl` |
| Forum | POST /api/forum/report | ✅ 201 Created |
| Forum | DELETE /api/forum/threads/:id | ✅ Soft deleted (`isRemoved`) |
| AI Videos | GET /api/videos | ✅ total=10, paginated |
| AI Videos | GET /api/videos/:id | ✅ Single video detail |
| AI Videos | POST /api/videos/:id/report | ✅ 201 Created |
| User Profile | GET /api/users/:userId | ✅ Other user profile, privacy-aware |
| User Profile | POST /api/users/:userId/follow (public) | ✅ `status: "accepted"` immediately |
| User Profile | POST /api/users/:userId/follow (private) | ✅ `status: "pending"` |
| User Profile | GET /api/users/follow-requests | ✅ Pending requests listed |
| User Profile | PATCH /api/users/follow-requests/:id | ✅ Accept → `status: "accepted"` |
| User Profile | GET /api/users/:userId/followers | ✅ Accepted followers only |
| User Profile | DELETE /api/users/:userId/follow | ✅ Unfollow works |

**Total: 40/40 endpoints passing with real database data ✅**

---

---

## Feed / Posts APIs

All routes require `Bearer {{AUTH_TOKEN}}` + `x-api-key` header.

**Base prefix:** `/api/feed`

---

### GET /api/feed/locations

Returns a list of popular location suggestions, optionally filtered by a search string.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Optional substring filter |

**200 OK**
```json
{
  "status": true,
  "message": "Locations fetched successfully.",
  "data": {
    "popular": ["Bucharest, Bucharest", "New York, N.Y.", "Cluj-Napoca, Cluj", "Satu Mare, Satu Mare", "London, UK", "Paris, France"],
    "results": ["London, UK"]
  }
}
```

`popular` — always-returned curated list. `results` — filtered matches when `search` is provided (empty when no query).

---

### POST /api/feed/posts

Create a new post with optional media files, caption, religion tag, and location.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `media` | file[] | No | Up to 10 files (jpg/jpeg/png/webp/mp4/mov, max 50 MB each) |
| `caption` | string | No | Post caption text |
| `religionId` | UUID | No | Religion to tag |
| `postTypeId` | UUID | No | Admin-managed post type to categorize the post (from `GET /api/master/post-types`) |
| `location` | string | No | Free-text city/country string |
| `isPublic` | boolean | No | Default `true` |

**201 Created**
```json
{
  "status": true,
  "message": "Post created successfully.",
  "data": {
    "id": "post-uuid",
    "authorId": "user-uuid",
    "caption": "Sunsets, sea breeze, and no plans",
    "media": ["http://localhost:5000/posts/post-1718700000000-0.jpg"],
    "location": "New York, N.Y.",
    "isPublic": true,
    "createdAt": "2026-06-18T10:00:00.000Z",
    "author": { "id": "user-uuid", "fullName": "Maria R.", "profileImage": "http://localhost:5000/avatars/avatar-xxx.png" },
    "religion": { "id": "rel-uuid", "name": "Roman Catholic" },
    "postType": { "id": "pt-uuid", "name": "News" },
    "likesCount": 0,
    "commentsCount": 0,
    "isLiked": false
  }
}
```

`postType` is `null` when the post was created without a `postTypeId`.

---

### GET /api/feed/posts

Paginated post feed. Supports filtering by type and religion.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `post_type` | `public` \| `following` | `public` | Visibility scope: `public` = all public posts; `following` = posts from users you follow |
| `religions` | UUID \| UUID[] | — | Filter by religion. Repeatable: `?religions=id1&religions=id2` |
| `postTypeId` | UUID \| UUID[] | — | Filter by admin-managed post type. Repeatable: `?postTypeId=id1&postTypeId=id2`. Independent of `post_type` — both filters can be combined. |
| `page` | number | 1 | Page number |
| `pageSize` | number | 10 | Items per page |

**200 OK**
```json
{
  "status": true,
  "message": "Posts fetched successfully.",
  "data": {
    "data": [ /* post objects */ ],
    "total": 42,
    "totalPages": 5
  }
}
```

---

### GET /api/feed/posts/mine

Returns the authenticated user's own posts, latest first.

**Query Parameters:** `page`, `pageSize`

**200 OK** — same pagination shape as GET /api/feed/posts.

---

### GET /api/feed/posts/user/:userId

Returns another user's posts. Respects privacy: if the target account is private and you don't follow them, returns an empty list with `isPrivate: true`.

**Query Parameters:** `page`, `pageSize`

**200 OK (public or followed)**
```json
{
  "status": true,
  "message": "Posts fetched successfully.",
  "data": { "data": [ /* posts */ ], "total": 5, "totalPages": 1 }
}
```

**200 OK (private, not following)**
```json
{
  "status": true,
  "message": "Posts fetched successfully.",
  "data": { "isPrivate": true, "data": [], "total": 0, "totalPages": 1 }
}
```

---

### GET /api/feed/posts/:id

Fetch a single post by ID. Returns the full post object including author, media, religion, like count, comment count, and whether the current user has liked it.

**200 OK**
```json
{
  "status": true,
  "message": "Posts fetched successfully.",
  "data": {
    "id": "post-uuid",
    "caption": "Sunsets, sea breeze, and no plans",
    "media": ["http://localhost:5000/posts/post-xxx.jpg"],
    "location": "London, UK",
    "isPublic": true,
    "createdAt": "2026-06-18T10:00:00.000Z",
    "author": { "id": "user-uuid", "fullName": "Maria R.", "profileImage": "http://localhost:5000/avatars/avatar-xxx.png" },
    "religion": { "id": "rel-uuid", "name": "Roman Catholic" },
    "postType": { "id": "pt-uuid", "name": "News" },
    "likesCount": 5,
    "commentsCount": 3,
    "isLiked": false
  }
}
```

**Error codes:** `404` post not found.

---

### DELETE /api/feed/posts/:id

Soft-deletes the authenticated user's own post (sets `deletedAt`).

**404** if post not found. **403** if not the author.

**200 OK**
```json
{ "status": true, "message": "Post deleted successfully.", "data": null }
```

---

### POST /api/feed/posts/:id/like

Toggle like on a post. First call = like, second call = unlike.

**200 OK**
```json
{ "status": true, "message": "Post liked.", "data": null }
```
or
```json
{ "status": true, "message": "Post unliked.", "data": null }
```

---

### GET /api/feed/posts/:id/likes

Paginated list of users who liked a post. Each entry includes a `followStatus` field so the RN client can render the Follow/Following button inline.

**Query Parameters:** `page`, `pageSize`

**200 OK**
```json
{
  "status": true,
  "message": "Likes fetched successfully.",
  "data": {
    "data": [
      {
        "id": "user-uuid",
        "fullName": "Maria R.",
        "profileImage": "http://localhost:5000/avatars/avatar-xxx.png",
        "likedAt": "2026-06-18T10:05:00.000Z",
        "followStatus": null
      }
    ],
    "total": 3,
    "totalPages": 1
  }
}
```

`followStatus` values: `null` (not following / own entry), `"pending"` (follow request sent), `"accepted"` (following).

---

### GET /api/feed/posts/:id/comments

Paginated top-level comments, each with a nested `replies` array (one level deep), latest first.

**Query Parameters:** `page`, `pageSize`

**200 OK**
```json
{
  "status": true,
  "message": "Comments fetched successfully.",
  "data": {
    "data": [
      {
        "id": "comment-uuid",
        "content": "Beautiful shot!",
        "createdAt": "2026-06-18T10:05:00.000Z",
        "author": { "id": "user-uuid", "fullName": "Ana M.", "profileImage": "http://..." },
        "likesCount": 2,
        "isLiked": false,
        "replies": [
          {
            "id": "reply-uuid",
            "content": "Totally agree!",
            "author": { "id": "user2-uuid", "fullName": "Petru D.", "profileImage": "http://..." },
            "likesCount": 0,
            "isLiked": false
          }
        ]
      }
    ],
    "total": 5,
    "totalPages": 1
  }
}
```

---

### POST /api/feed/posts/:id/comments

Add a top-level comment to a post.

**Request Body (JSON)**
```json
{ "content": "Beautiful shot!" }
```

**201 Created**
```json
{
  "status": true,
  "message": "Comment added successfully.",
  "data": { "id": "comment-uuid", "content": "Beautiful shot!", "postId": "post-uuid", "authorId": "user-uuid", "parentId": null, "createdAt": "..." }
}
```

---

### POST /api/feed/posts/:id/comments/:commentId/like

Toggle like on a comment. First call = like, second call = unlike.

**200 OK** — `"Comment liked."` or `"Comment unliked."`

---

### POST /api/feed/posts/:id/comments/:commentId/reply

Reply to a comment. Creates a `PostComment` with `parentId = commentId`.

**Request Body (JSON)**
```json
{ "content": "Totally agree!" }
```

**201 Created** — returns the new reply comment object.

---

### POST /api/feed/posts/:id/share

Record a share action and return a shareable reference.

**Request Body (JSON)**
```json
{ "share_to": "chat" }
```
`share_to` accepts `"chat"` or `"external"`.

**200 OK**
```json
{
  "status": true,
  "message": "Post shared successfully.",
  "data": { "postId": "post-uuid", "share_to": "external" }
}
```

---

### POST /api/feed/report

Report a post or comment.

**Request Body (JSON)**
```json
{ "type": "post", "id": "{{POST_ID}}", "reason": "Spam content" }
```

| Field | Values |
|-------|--------|
| `type` | `"post"` \| `"post_comment"` |
| `id` | UUID of the target |
| `reason` | Optional text |

**201 Created**
```json
{ "status": true, "message": "Reported successfully.", "data": null }
```

---

## Forum (User-Facing) APIs

All routes require `Bearer {{AUTH_TOKEN}}` + `x-api-key` header.

**Base prefix:** `/api/forum`

---

### POST /api/forum/threads

Create a new forum thread.

**Request Body (JSON)**
```json
{
  "description": "Managing work life while staying committed to daily prayers can be challenging.",
  "forum_type": "Religion",
  "religionId": "{{RELIGION_ID}}"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Thread body (1–5000 chars) |
| `forum_type` | `"Political"` \| `"Religion"` | Yes | Thread category |
| `religionId` | UUID | No | Required when `forum_type = "Religion"` |

**201 Created**
```json
{
  "status": true,
  "message": "Forum created successfully.",
  "data": {
    "id": "thread-uuid",
    "description": "Managing work life...",
    "forum_type": "Religion",
    "categoryName": "Roman Catholic",
    "authorId": "user-uuid",
    "createdAt": "2026-06-18T10:00:00.000Z"
  }
}
```

---

### GET /api/forum/threads

Paginated list of forum threads, latest first.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `forum_type` | `Political` \| `Religion` | Filter by type |
| `religions` | UUID \| UUID[] | Filter by religion. Repeatable: `?religions=id1&religions=id2` |
| `page` | number | Page number (default 1) |
| `pageSize` | number | Items per page (default 10) |

**200 OK**
```json
{
  "status": true,
  "message": "Forums fetched successfully.",
  "data": {
    "data": [
      {
        "id": "thread-uuid",
        "description": "Managing work life...",
        "categoryName": "Roman Catholic",
        "author": { "id": "user-uuid", "fullName": "Maria R.", "profileImage": "http://..." },
        "likesCount": 4,
        "answersCount": 2,
        "isLiked": false,
        "createdAt": "2026-06-18T10:00:00.000Z"
      }
    ],
    "total": 20,
    "totalPages": 2
  }
}
```

---

### GET /api/forum/threads/mine

Returns the authenticated user's own threads. **Query Parameters:** `page`, `pageSize`.

---

### GET /api/forum/threads/user/:userId

Returns a specific user's threads. **Query Parameters:** `page`, `pageSize`.

---

### GET /api/forum/threads/:id

Fetch a single forum thread by ID. Returns the full thread object including author, like count, answer count, and whether the current user has liked it.

**200 OK**
```json
{
  "status": true,
  "message": "Forums fetched successfully.",
  "data": {
    "id": "thread-uuid",
    "description": "Should Romani cultural festivals be government-funded?",
    "categoryName": null,
    "createdAt": "2026-06-18T10:00:00.000Z",
    "forumType": { "id": "type-uuid", "name": "Political" },
    "author": {
      "id": "user-uuid",
      "fullName": "Maria R.",
      "profileImage": "http://localhost:5000/avatars/avatar-xxx.png",
      "belongingCountry": { "flag": "🇷🇴", "code": "RO" }
    },
    "likeCount": 4,
    "answerCount": 2,
    "isLiked": false
  }
}
```

**Error codes:** `404` thread not found or removed.

---

### DELETE /api/forum/threads/:id

Soft-deletes the authenticated user's own thread (sets `isRemoved: true`).

**200 OK** — `"Forum deleted successfully."`

---

### POST /api/forum/threads/:id/like

Toggle like on a thread. First call = like, second call = unlike.

**200 OK** — `"Forum liked."` or `"Forum unliked."`

---

### GET /api/forum/threads/:id/likes

Paginated list of users who liked a thread. Each entry includes `followStatus` (same as post likes). **Query Parameters:** `page`, `pageSize`.

**200 OK** — same shape as [GET /api/feed/posts/:id/likes](#get-apifeedpostsidlikes) (fields: `id`, `fullName`, `profileImage`, `likedAt`, `followStatus`).

---

### GET /api/forum/threads/:id/answers

Paginated top-level answers, each with nested `replies` array (one level deep), latest first.

**Query Parameters:** `page`, `pageSize`

**200 OK**
```json
{
  "status": true,
  "message": "Answers fetched successfully.",
  "data": {
    "data": [
      {
        "id": "answer-uuid",
        "content": "I started with just 5 minutes a day.",
        "author": { "id": "user-uuid", "fullName": "Ana M.", "profileImage": "http://..." },
        "likesCount": 1,
        "isLiked": false,
        "replies": [
          {
            "id": "reply-uuid",
            "content": "Even a few quiet minutes makes a difference.",
            "author": { "id": "user2-uuid", "fullName": "Petru D.", "profileImage": "http://..." },
            "likesCount": 0,
            "isLiked": false
          }
        ]
      }
    ],
    "total": 3,
    "totalPages": 1
  }
}
```

---

### POST /api/forum/threads/:id/answers

Add a top-level answer to a thread.

**Request Body (JSON)**
```json
{ "content": "I started with just 5 minutes a day." }
```

**201 Created** — returns the new answer object.

---

### POST /api/forum/threads/:id/answers/:answerId/like

Toggle like on an answer. First call = like, second call = unlike.

**200 OK** — `"Answer liked."` or `"Answer unliked."`

---

### POST /api/forum/threads/:id/answers/:answerId/reply

Reply to an answer. Creates a `ForumAnswer` with `parentId = answerId`.

**Request Body (JSON)**
```json
{ "content": "Even a few quiet minutes makes a difference." }
```

**201 Created** — returns the new reply object.

---

### POST /api/forum/threads/:id/share

Record a share action for a forum thread.

**Request Body (JSON)**
```json
{ "share_to": "external" }
```

**200 OK** — `"Forum shared successfully."`

---

### POST /api/forum/report

Report a forum thread or answer.

**Request Body (JSON)**
```json
{ "type": "forum_thread", "id": "{{FORUM_ID}}", "reason": "Inappropriate content" }
```

| Field | Values |
|-------|--------|
| `type` | `"forum_thread"` \| `"forum_answer"` |
| `id` | UUID of the target |
| `reason` | Optional text |

**201 Created** — `"Reported successfully."`

---

## User Profile & Follow APIs

All routes require `Bearer {{AUTH_TOKEN}}` + `x-api-key` header.

**Base prefix:** `/api/users`

> **Route ordering note:** `/api/users/follow-requests` and `/api/users/follow-requests/:requestId` are registered **before** `/:userId` so they are not accidentally matched as a userId.

---

### GET /api/users/:userId

View another user's profile. Returns basic info always. Posts, forums, and products are returned only when the account is public or when you follow them.

**200 OK (public account or follower)**
```json
{
  "status": true,
  "message": "Profile fetched successfully.",
  "data": {
    "id": "user-uuid",
    "fullName": "Maria R.",
    "profileImage": "http://localhost:5000/avatars/avatar-xxx.png",
    "isPrivate": false,
    "followersCount": 12,
    "followingCount": 7,
    "belongingCountry": { "id": "country-uuid", "name": "Romania", "flag": "🇷🇴" },
    "religion": { "id": "rel-uuid", "name": "Roman Catholic" },
    "posts": [ /* paginated posts */ ],
    "forums": [ /* paginated threads */ ],
    "products": []
  }
}
```

**200 OK (private account, not following)**
```json
{
  "status": true,
  "message": "Profile fetched successfully.",
  "data": {
    "id": "user-uuid",
    "fullName": "Maria R.",
    "profileImage": "http://localhost:5000/avatars/avatar-xxx.png",
    "isPrivate": true,
    "followersCount": 12,
    "followingCount": 7,
    "posts": [],
    "forums": [],
    "products": []
  }
}
```

**Error codes:** `400` cannot view own profile · `404` user not found.

---

### POST /api/users/:userId/follow

Follow a user or send a follow request.

- **Public account** (`isPrivate: false`) → follow record created with `status: "accepted"` immediately.
- **Private account** (`isPrivate: true`) → follow record created with `status: "pending"`. The target must accept via PATCH /api/users/follow-requests/:requestId.

**200 OK**
```json
{
  "status": true,
  "message": "Follow request sent.",
  "data": { "followId": "follow-uuid", "status": "pending" }
}
```
or
```json
{
  "status": true,
  "message": "Follow request sent.",
  "data": { "followId": "follow-uuid", "status": "accepted" }
}
```

**Error codes:** `400` cannot follow yourself · `404` user not found.

---

### DELETE /api/users/:userId/follow

Unfollow a user or cancel a pending follow request. Deletes the `UserFollow` record regardless of its current status.

**200 OK** — `"Unfollowed successfully."`

**Error codes:** `404` not following this user.

---

### GET /api/users/:userId/followers

Paginated list of users who follow `:userId` (accepted follows only).

**Query Parameters:** `page`, `pageSize`

**200 OK**
```json
{
  "status": true,
  "message": "Followers fetched successfully.",
  "data": {
    "data": [
      { "id": "user-uuid", "fullName": "Ana M.", "profileImage": "http://..." }
    ],
    "total": 12,
    "totalPages": 2
  }
}
```

---

### GET /api/users/:userId/following

Paginated list of users that `:userId` follows (accepted follows only).

**Query Parameters:** `page`, `pageSize`

**200 OK** — same shape as followers list, `"Following list fetched successfully."`

---

### GET /api/users/follow-requests

My incoming pending follow requests (where I am the target).

**Query Parameters:** `page`, `pageSize`

**200 OK**
```json
{
  "status": true,
  "message": "Follow requests fetched successfully.",
  "data": {
    "data": [
      {
        "requestId": "follow-uuid",
        "requester": { "id": "user-uuid", "fullName": "Petru D.", "profileImage": "http://..." },
        "createdAt": "2026-06-18T09:00:00.000Z"
      }
    ],
    "total": 1,
    "totalPages": 1
  }
}
```

---

### PATCH /api/users/follow-requests/:requestId

Accept or reject an incoming follow request. Only the target of the request can call this.

**Request Body (JSON)**
```json
{ "action": "accept" }
```

`action` accepts `"accept"` or `"reject"`.

- **accept** → updates `UserFollow.status` to `"accepted"`
- **reject** → deletes the `UserFollow` record

**200 OK** — `"Follow request handled successfully."`

**Error codes:** `404` request not found · `403` not authorized (not the target) · `400` already handled.

---

## AI Videos APIs

All routes require `Bearer {{AUTH_TOKEN}}` + `x-api-key` header.

**Base prefix:** `/api/videos`

---

### GET /api/videos

Paginated list of AI videos. Premium videos return a thumbnail only; full playback URL requires an active subscription.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default 1) |
| `pageSize` | number | Items per page (default 10) |
| `category` | UUID | Filter by AI video category ID |
| `search` | string | Search by title/description |

**200 OK**
```json
{
  "status": true,
  "message": "Videos fetched successfully.",
  "data": {
    "data": [
      {
        "id": "video-uuid",
        "title": "Romani Traditions — Spring Festival",
        "description": "A deep dive into spring customs.",
        "thumbnail": "http://localhost:5000/videos/thumb-xxx.jpg",
        "videoUrl": "http://localhost:5000/videos/vid-xxx.mp4",
        "isPremium": false,
        "category": { "id": "cat-uuid", "name": "Culture" },
        "createdAt": "2026-06-18T10:00:00.000Z"
      }
    ],
    "total": 10,
    "totalPages": 2
  }
}
```

For `isPremium: true` videos, `videoUrl` is `null` unless the authenticated user has an active subscription.

---

### GET /api/videos/:id

Fetch a single AI video by ID. Same premium gate applies.

**200 OK** — same object shape as a single item from the list above.

**Error codes:** `404` video not found.

---

### POST /api/videos/:id/report

Report an AI video.

**Request Body (JSON)**
```json
{ "reason": "Inappropriate content" }
```

**201 Created**
```json
{ "status": true, "message": "Video reported successfully.", "data": null }
```

**Error codes:** `404` video not found.

---

## Subscription APIs

All subscription endpoints require the `x-api-key` header. All endpoints except `GET /api/subscription/plans` and `POST /api/subscription/webhook` also require `Authorization: Bearer {JWT}`.

---

### GET /api/subscription/plans

List all active subscription plans. Public — no Bearer token required.

| Property | Value |
|---|---|
| **Method** | GET |
| **Path** | `/api/subscription/plans` |
| **Auth** | x-api-key only |

**200 OK**
```json
{
  "status": true,
  "message": "Plans fetched successfully.",
  "data": [
    {
      "id": "plan-uuid-1",
      "name": "Premium Monthly",
      "amount": 999,
      "currency": "usd",
      "interval": "month",
      "features": ["Unlimited swipes", "See who liked you", "Boost profile"]
    }
  ]
}
```

---

### POST /api/subscription/subscribe

Create a Stripe recurring subscription for the authenticated user. Returns a `clientSecret` that the mobile app passes to Stripe SDK to confirm the payment.

**Request Body (JSON)**
```json
{ "planId": "plan-uuid-1" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `planId` | UUID | Yes | Must be an active plan from `/api/subscription/plans` |

**200 OK**
```json
{
  "status": true,
  "message": "Subscription created.",
  "data": {
    "clientSecret": "pi_3xxx_secret_xxx",
    "subscriptionId": "sub_xxx"
  }
}
```

**Error codes:** `404` plan not found, `400` already has active subscription.

---

### POST /api/subscription/boost

Create a one-time Stripe PaymentIntent for a Match Boost ($10). Returns a `clientSecret` for the mobile app to confirm via Stripe SDK.

**Request Body:** none

**200 OK**
```json
{
  "status": true,
  "message": "Boost payment intent created.",
  "data": {
    "clientSecret": "pi_3xxx_secret_xxx"
  }
}
```

---

### GET /api/subscription/status

Get the current user's subscription status, swipe usage, and plan details.

**200 OK**
```json
{
  "status": true,
  "message": "Subscription status fetched.",
  "data": {
    "plan": "premium",
    "subscriptionExpiresAt": "2026-07-19T00:00:00.000Z",
    "isPremium": true,
    "swipesUsedToday": 3,
    "swipesLimit": -1,
    "autoRenew": true,
    "activeSubscription": {
      "id": "sub_xxx",
      "status": "active",
      "plan": { "id": "plan-uuid-1", "name": "Premium Monthly", "amount": 999, "currency": "usd", "interval": "month" },
      "currentPeriodEnd": "2026-07-19T00:00:00.000Z",
      "canceledAt": null
    }
  }
}
```

**Notes:**
- `plan`: `"free"` or `"premium"`.
- `swipesLimit: -1` means unlimited (premium users).
- `activeSubscription` is `null` for free users.

---

### GET /api/subscription/history

Paginated payment history for the authenticated user.

**Query Parameters**

| Param | Type | Default | Constraints |
|---|---|---|---|
| `page` | number | 1 | min 1 |
| `pageSize` | number | 10 | 1–50 |

**200 OK**
```json
{
  "status": true,
  "message": "Payment history fetched.",
  "data": {
    "payments": [
      {
        "id": "payment-uuid-1",
        "amount": 999,
        "currency": "usd",
        "status": "succeeded",
        "type": "subscription",
        "planName": "Premium Monthly",
        "paymentMethod": "card",
        "receiptUrl": "https://pay.stripe.com/receipts/...",
        "createdAt": "2026-06-19T10:00:00.000Z"
      }
    ],
    "total": 3,
    "totalPages": 1
  }
}
```

**Notes:** `type` is `"subscription"` or `"boost"`.

---

### POST /api/subscription/cancel

Cancel the active subscription. It remains active until the end of the current billing period.

**Request Body:** none

**200 OK**
```json
{
  "status": true,
  "message": "Subscription cancelled.",
  "data": {
    "canceled": true,
    "effectiveAt": "2026-07-19T00:00:00.000Z"
  }
}
```

**Error codes:** `400` no active subscription to cancel.

---

### PATCH /api/subscription/auto-renew

Enable or disable auto-renewal for the active subscription.

**Request Body (JSON)**
```json
{ "enabled": false }
```

| Field | Type | Required |
|---|---|---|
| `enabled` | boolean | Yes |

**200 OK**
```json
{
  "status": true,
  "message": "Auto-renew updated.",
  "data": {
    "autoRenew": false,
    "currentPeriodEnd": "2026-07-19T00:00:00.000Z"
  }
}
```

**Error codes:** `400` no active subscription.

---

### POST /api/subscription/restore

Re-sync subscription state from Stripe. Use when the app has missed a webhook (e.g. reinstall, new device).

**Request Body:** none

**200 OK**
```json
{
  "status": true,
  "message": "Purchase restored.",
  "data": {
    "plan": "premium",
    "restored": true,
    "currentPeriodEnd": "2026-07-19T00:00:00.000Z"
  }
}
```

**Notes:** `plan` is `"free"` or `"premium"`. `currentPeriodEnd` is omitted for free users.

---

### POST /api/subscription/webhook

Stripe webhook receiver. Called directly by Stripe — **do not call from the mobile app**.

| Property | Value |
|---|---|
| **Method** | POST |
| **Path** | `/api/subscription/webhook` |
| **Auth** | x-api-key only (no Bearer token) |
| **Content-Type** | `application/json` (raw body — do not parse) |
| **Extra header** | `stripe-signature: t=xxx,v1=xxx` (set by Stripe) |

**Handled events:** `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`, `payment_intent.succeeded`

**200 OK**
```json
{ "received": true }
```

---

*Split into `CUSTOMER_API_DOC.md` on 2026-08-20 from the original `API_DOCUMENTATION.md` — content unchanged, scoped to Customer (mobile app) APIs only. Vendor/admin APIs will be documented separately in `VENDOR_API_DOC.md`.*

*Generated on 2026-05-29 — Romani Dating App v1.0.0*  
*Updated on 2026-06-01 — v1.1.0: Added Profile APIs (details, image, notification preferences, language)*  
*Updated on 2026-06-02 — v1.2.0: Added x-api-key middleware (required on all endpoints); OTP fixed to 111111 when OTP_TESTING=true*  
*Updated on 2026-06-11 — v1.3.0: Server-side localization via Accept-Language header*  
*Updated on 2026-06-11 — v1.4.0: Authenticated responses follow stored user.language*  
*Updated on 2026-06-11 — v1.5.0: Added Master Management APIs — genders, looking-for, spoken languages, interests, forum categories, AI video categories, app settings*  
*Updated on 2026-06-11 — v1.6.0: Full multi-language support — Romanian (ro), Spanish (es), Russian (ru). All master data names and API response messages translated. Seed data updated with translations. 36 new locale files created (locales/ro|es|ru/*.json).*
*Updated on 2026-06-12 — v1.7.0: gender_id (UUID FK) replaces gender enum on Onboarding Step 1 and PATCH /api/profile/details. Separate /api/master/forum-types and /api/master/politicals endpoints replace the removed /api/master/forum-categories.*
*Updated on 2026-06-15 — v1.8.0: Added Dating Profile APIs (POST/GET /api/dating-profile, PATCH /api/dating-profile/image, isDatingProfileCompleted flag). Added Discover APIs — feed, profile detail, like, dislike, report (UserSwipe, UserMatch, UserReport tables).*  
*Updated on 2026-06-12 — v1.8.0: Added GET /api/master/discover-categories public endpoint. Returns 6 seeded discover screen categories (AI Videos, Forum, Live, Feed, Dating, Business). Image field returns full URL when uploaded, null otherwise.*  
*Updated on 2026-06-15 — v1.9.0: Removed PATCH /api/dating-profile/image — image is now uploaded directly in POST /api/dating-profile (multipart/form-data); required on add, optional on update. All dating profile fields made optional (validation fires only when provided). Added GET /api/master/distance-types returning [{value:"nearby"},{value:"global"}]. Discover feed: gender_id, religion_id, looking_for, interests, spoken_languages now each accept a single UUID or an array (repeat the query key).*  
*Updated on 2026-06-16 — v1.10.0: POST /api/dating-profile reverted to JSON-only (no multipart, no image field) — image upload is not exposed on any dating-profile endpoint for now. discover_preference removed from POST /api/dating-profile and split into its own endpoint: PATCH /api/dating-profile/discover-preference, which updates discoverCategoryId independently (accepts a DiscoverCategory UUID or null).*  
*Updated on 2026-06-18 — v1.11.0: PATCH /api/profile/image now accepts image/jpg MIME type (iOS non-standard) in addition to image/jpeg, image/png, image/webp. Added note about Content-Type requirement (multipart/form-data). GET /api/dating-profile: gender field is now returned as an array (e.g. [{id, name, emoji}]) instead of a single object, to match the React Native expected shape.*  
*Updated on 2026-06-18 — v1.12.0: PATCH /api/dating-profile/discover-preference no longer returns 404 when the user has no dating profile — a minimal profile is auto-created (upsert). GET /api/discover/dating-profiles (feed) and GET /api/discover/dating-profiles/:userId (detail): datingProfile.gender renamed to datingProfile.genders (array) to match the many-to-many Prisma relation.*
*Updated on 2026-06-18 — v1.13.0: POST /api/dating-profile now accepts `gender_ids` (UUID[]) to populate the many-to-many `genders` relation directly. Both `type: "add"` and `type: "update"` support it. `gender_id` (single UUID FK) remains supported for backwards compatibility.*  
*Updated on 2026-06-19 — v1.15.0: Added GET /api/feed/posts/:id (single post detail) and GET /api/forum/threads/:id (single thread detail). Added full GET /api/videos and GET /api/videos/:id documentation. Corrected GET /api/feed/locations response shape ({popular, results}). Updated likes list responses for both posts and forum threads to include `followStatus` field. All 40 endpoints live-tested against real database. Postman collection updated to v1.15.0 (2 new requests added).*  
*Updated on 2026-06-19 — v1.16.0: Added Section 16 — Subscription APIs (9 endpoints: GET /plans, POST /subscribe, POST /boost, GET /status, GET /history, POST /cancel, PATCH /auto-renew, POST /restore, POST /webhook). Updated GET /api/master/settings response — now returns typed values (numbers/booleans) and all 10 keys including free_swipes. Fixed GET /api/discover/dating-profiles gender_id filter (was returning 500; now correctly filters via UserDatingProfile.genders many-to-many relation). Postman collection updated to v1.16.0 with Subscription folder (9 requests) and PLAN_ID variable.*  
*Updated on 2026-07-01 — v1.18.0: Added GET /api/master/post-types (returns active post types; used in Feed screen filter — Public, My Following Only). Added GET /api/discover/swipe-status (returns swipesUsedToday, daily limit, and isPremium for the logged-in user). Postman collection updated with both requests.*
*Updated on 2026-07-02 — v1.19.0: Added global rate limiting (100 req/15min/IP on all `/api` routes, 429 with localized message) and a stricter OTP limiter (10 req/15min/IP on send-otp/resend-otp/verify-otp); Stripe webhook exempt. Added env-driven CORS allowlist (`CORS_ALLOWED_ORIGINS`) and `TRUST_PROXY` opt-in. All modules now share a single `PrismaClient` instance instead of one per file. Introduced `/api/v1/*` as the canonical versioned path — `/api/*` (legacy) keeps working identically, no client changes required. No response shape changes.*
*Updated on 2026-07-02 — v1.20.0: Added a DTO/Mapper allowlist layer — every user-data module (auth, onboarding, profile, dating-profile, discover, feed, forum, videos, subscription, subscription-admin, user-profile, users, admin) now maps Prisma results through an explicit `<module>.dto.js` before responding, instead of returning raw rows or ad-hoc inline sanitizers. Response shapes are unchanged for all mobile-facing endpoints (verified via 29-endpoint before/after capture diff). Security fix: the admin's own session `token` no longer leaks inside the nested `admin` object on `POST /api/admin/auth/login`, `GET /api/admin/auth/profile`, `PUT /api/admin/auth/profile` (admin panel already reads it from the top-level `token` field). See [Breaking Changes — v1.20.0](#breaking-changes-v1200).*
