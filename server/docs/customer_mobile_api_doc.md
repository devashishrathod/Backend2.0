# Trydood 2.0 — Customer Mobile App API Documentation

**Version:** 1.7.0
**Base URL (Local):** `http://localhost:8080/trydood/v1`
**Base URL (Staging):** `https://backend2-0-4v4i.onrender.com/trydood/v1`
**Base URL (Production):** `https://api.trydood.com/trydood/v1`
**Framework:** Express.js (Node.js, CommonJS)
**Database:** MongoDB (Mongoose ODM)
**Scope:** Customer mobile app ke **64 endpoints** — jinme se **22 guest ke liye khule hain**
**Last verified:** 2026-09-05 against a running server · Categorization → [endpoints_category.md](./endpoints_category.md) (216 total endpoints)

> ✅ **Ye doc live API ke against verify hota hai**, sirf code padhkar nahi likha jaata. Saare endpoints ek chalte hue server pe seeded fixtures ke saath run hote hain: **135 requests, 473 assertions, 0 failed.**
>
> ✅ **Postman ke saare examples asli responses hain** — **206 examples, 140/140 requests par**, sab ek live run se capture kiye gaye ([`postman/trydood-customer.postman_collection.json`](../postman/trydood-customer.postman_collection.json)). Koi bhi example haath se nahi likha gaya, isliye wo galat ho hi nahi sakta jab tak API khud galat na ho.
>
> ✅ **Har `**Access:**` line routes se derive hoti hai**, likhi nahi jaati — `postman/lib/routeGates.js` `routes/` padhta hai.
>
> ✅ **Saare enum values `constants/` ke against verify hue hain** — [Enums Reference](#enums-reference) me koi value haath se nahi likhi gayi.
>
> Jahan behaviour buggy ya adhoora hai, wahan ⚠️ (ya 🔴, agar wo cheez tod deti hai) marker hai.

> ### ⚠️ Teen requests ke **success** examples capture nahi ho sakte
>
> Baaki 122 par asli success response hai. Ye teen live third-party call karte hain,
> isliye unka saved example wahi asli refusal hai jo is environment me aata hai — aur
> success ka shape doc me code se likha gaya hai, saaf marker ke saath:
>
> | Endpoint | Kyun | Iska example |
> |---|---|---|
> | [`POST /voucher-claims/verify`](#17b-post-voucher-claimsverify) | Signature ek **asli Razorpay checkout** se aata hai; test keys se bhi API payment nahi bana sakti | Galat/khaali signature ka refusal |
> | [`POST /bank-accounts`](#17n-post-bank-accounts--account-jodo-) | **Live CGPey penny drop** — asli paisa, asli bank | Galat OTP ka `401` |
> | [`POST /deviceTokens/test`](#34-post-devicetokenstest) | **Live FCM** call, aur collection ke paas asli device token nahi hota | Provider ka `422` |
>
> ⚠️ **Inke examples haath se mat likhein.** Poora point yahi hai ki example ek asli run
> se aata hai — haath ka likha example chup-chaap purana ho jaata hai aur galat example
> bilkul sahi jaisa dikhta hai. Do aise pehle ship ho chuke hain (`nearestOutlet._id` jo
> asal me `subBrandId` hai, aur flat `medias[]` jo asal me nested `media.data[]` hai), aur
> dono sirf chalane par pakde gaye.

### 🆕 v1.7.0 me kya naya

**Teen gaps band, aur ek leak.** Appendix B ke #11, #13 aur #14 ab RESOLVED hain.

| Change | Detail |
|---|---|
| 🆕 **Email verification** | [#35](#35-post-authemailsend-verification-) · [#36](#36-post-authemailverify-) — **har role ke liye ek hi flow**. `isEmailVerified` sabke `User` par tha aur koi bhi use set nahi kar sakta tha: email edit karne par flag `false` ho jaata tha aur wapas `true` karne ka koi raasta hi nahi tha |
| 🆕 **Notification inbox** | [#37](#37-get-notificationsget-all-) · [#38](#38-put-notificationsmark-read-) — wahi endpoint jo vendor aur admin use karte hain, scope aur projection token se. Rows **pehle se likhi ja rahi thi**; padhne ka raasta nahi tha |
| 🆕 **`GET /app-config`** | [#39](#39-get-app-config-) — public. Min version, force-update, support contact, feature flags. Server `updateRequired` khud tay karta hai |
| 🔴 **Auth leak band** | `/auth/login` aur `/auth/register` **bcrypt hash** response me lauta rahe the. Chaar services raw `user` document return karti thi; ab sab `sanitizeUser()` se guzarti hain |
| **`meta` bhi strip hota hai** | `fcmToken`, `ipAddress`, `deviceId` ab kisi bhi auth response me nahi aate |

#### 🔴 Woh leak, thoda detail me

`loginWithEmailAndPassword` password compare karne ke liye document **hash ke saath** load
karta hai — karna hi padta hai — aur phir wahi `user` raw return kar deta tha. Yani har
safal admin login par bcrypt hash client ke paas, uske logs me, uske crash reports me.

OTP paths `.select("-password")` karte the, to unse sirf `__v` jaata tha. Ab chaaron +
dono `sanitizeUser()` se guzarte hain.

⚠️ **Blast radius sirf teen keys hai** — `password`, `__v`, `meta`. `User` par `otp` ya
`refreshToken` जैसा koi path hai hi nahi. Vendor collection ke 105 captured examples me in
me se ek bhi field pehle se nahi thi, to vendor panel par koi asar nahi.

### v1.6.0 me kya aaya tha

**Poora customer surface — 35 se 57 endpoints.** Pichhla doc keh raha tha "35 endpoints"
jabki usme claims, refunds aur search ke sections **pehle se maujood the** aur ginti me
nahi the; upar se do module poori tarah gayab the.

| Change | Detail |
|---|---|
| 🆕 **Bank Account APIs (4)** | Poora naya module — [17m](#17m-post-bank-accountsotp--code-maango-)–[17p](#17p-delete-bank-accountsaccountid--account-hataao-). Refund jab **usi raaste se wapas nahi ja sakta** tab yahi destination banta hai |
| 🆕 **Failed refund ka redirect** | [17j-1 `PATCH /refunds/:requestId/bank-account`](#17j-1-patch-refundsrequestidbank-account--failed-refund-kahan-bheju-) — customer batata hai paisa kahan bheja jaaye. Iske bina refund `FAILED` par baitha rehta tha, vendor ka paisa hold me phansa rehta tha, aur grahak ko uska **kabhi milta hi nahi** |
| **Claims / Refunds / Search TOC me aaye** | Ye sections doc me the par Table of Contents me nahi — is baar link ho gaye |
| **140/140 Postman requests par saved example** | Pehle 118 me se **30 requests ke examples hi nahi the** (claims, refunds, search, logout). Ab har request par asli captured response hai — 492 assertions, 0 failed |
| 🆕 **Enums Reference poora hua** | 8 naye block: `VOUCHER_CLAIM_STATUS` · `PAYMENT_STATUS` · `REFUND_REASON` · `REFUND_REQUEST_STATUS` + customer labels · refund `method` · abuse limits · `SEARCH_RESULT_TYPES` · claim code alphabet. Sab values `constants/` ke against verify ki gayi hain |
| 🔴 **Postman generator zinda hua** | `generate-customer-collection.js` **chal hi nahi raha tha** — neeche dekhein |
| **Env me teeno URL** | `local_url` · `stage_url` · `prod_url` — teeno environment files me, taaki `base_url` badalne se target switch ho jaaye bina re-import |

#### 🔴 Generator dead tha, aur README uska ulta keh raha tha

`postman/lib/routeGates.js` `router.stack is not iterable` throw kar raha tha us din se
jab `routes/voucherClaims.js` ne `{ router, routePrefix }` export karna shuru kiya. Iska
matlab **`generate-customer-collection.js` bilkul chal hi nahi sakta tha**, aur isi wajah
se claims/refunds/search ke 30 requests sirf `scripts/add*ToPostman.js` se JSON me daale
gaye the.

⚠️ Aur `postman/README.md` keh raha tha *"JSON hand-edit mat karein — generator me add
karke re-run karein"*. Jo bhi us hidayat ko maanta, wo **teen folders aur 96 captured
examples delete** kar deta, aur command "✅ 88 requests" bolkar safal ho jaati.

Dono theek ho gaye: routeGates `routePrefix`/`extraRoutes` handle karta hai, aur wo teen
folders ab `postman/lib/customerMoneyFolders.js` + `customerSearchFolder.js` se **generate**
hote hain.

#### Jo cheezein live run ne pakdi (aur code padhkar nahi dikhti thi)

| Kya | Kahan |
|---|---|
| `POST /voucher-claims/create-order` **reuse path** — pehle se order ho to `200` + `reused: true`, `201` nahi. Response nested hai (`data.claim.id`, `data.transaction.id`, `data.razorpay.orderId`) | [17a](#17a-post-voucher-claimscreate-order) |
| `GET /transactions/invoice/:token` **`409`** deta hai jab `invoiceSnapshot` na ho — sirf token kaafi nahi | [17c](#17c-get-transactionsinvoicetoken) |
| Search sections me rows `items` me hain, `results` me nahi; single-type mode ka shape **poora alag** hai | [14a](#14a-get-search) · [14b](#14b-get-searchqtype--ek-type-paginated) |
| `GET /bank-accounts` **plain array** deta hai — koi pagination envelope nahi, khaali par `[]` aur `404` nahi | [17o](#17o-get-bank-accounts--mere-accounts-) |

### v1.5.0 me kya aaya tha

**Guest browsing** — app store approval ke liye user ab sign-up se pehle app dekh sakta hai.

| Change | Detail |
|---|---|
| **21 endpoints guest ke liye khule** | Vouchers, brands, showcase, features, master data, home screen, legal — sab bina token. Poora naksha [Guest access](#guest-access--bina-token-kya-chalta-hai) me |
| 🔴 **Voucher feed toota tha, ab theek hai** | Auth hatane par `req.userId` set hona band ho gaya tha, aur service pehle hi step me `Customer` dhoondhti thi — to feed **har** user ko `404 "Customer not found."` deta tha, guest aur signed-in dono. Naya `optionalAuth` gate + guest-tolerant service ne fix kiya |
| **Naya error message** | `404 "Customer not found."` ki jagah ab `400 "Location is required. Send latitude and longitude, or save an address first."` — jo actually batata hai karna kya hai |
| **132 real examples** | Har request pe saved examples, sab live run se capture. Ek API kholiye to uske saare flows aur errors ek jagah dikhte hain |
| **Access lines auto-derived** | `postman/lib/routeGates.js` routes padhkar gate nikalta hai; doc aur collection dono usse bante hain |

### v1.4.0 me kya aaya tha

Ye **live verification round** tha. Teen jagah doc code se match nahi kar raha tha:

| Fix | Kya galat tha |
|---|---|
| 🔴 **`currentScreen` warning** | Enum me koi customer screen hai hi nahi, aur galat value **poori login call `422`** kar deti hai ([details](#screens-onboarding-step-tracking--currentscreen-field)) |
| **`nearestOutlet.subBrandId`** | Doc me `_id` likha tha. Pipeline ka `$group` use `subBrandId` rename kar deta hai ([#15](#15-get-voucherscustomerget-all)) |
| **Device list ke fields** | `userId`, `role`, `updatedAt` example me the par service unhe project hi nahi karti ([#33](#33-get-devicetokensget-mine)) |

### v1.3.0 me kya aaya tha

| Change | Detail |
|---|---|
| **Naya brand list endpoint** | `GET /brands/customer/get-all` — directory + "Top Brands" tab, geo optional ([#18a](#18a-get-brandscustomerget-all-)) |
| **Voucher banner fields** | `bannerType` + `bannerUrl` list aur detail dono me. Banner na ho to dono `null` ([#15](#15-get-voucherscustomerget-all), [#16](#16-get-voucherscustomergetvoucherid)) |
| **Suggestions tab** | `?suggestedOnly=true` — admin ke pin kiye vouchers. Bina param ke wahi list, pinned upar ([#15](#15-get-voucherscustomerget-all)) |
| **Convenience fee** | Har ₹500 pe ₹5, original bill pe. Naya `pricing` block ([#17](#17-post-voucherscustomervoucherpreview)) |
| **No-offer ab error nahi** ✅ | Bill kisi offer ke minimum se kam ho to `200` + `offerApplied: false` — customer sirf bill pay karega. Do error messages hat gaye |
| **`FIXED` discount fix** ✅ | Enum me tha par calculate nahi hota tha. Ab `FLAT` ka alias hai |

### v1.2.0 me kya aaya tha

| Change | Detail |
|---|---|
| **Naya brand endpoint** | `GET /brands/customer/get/:brandId` — brand + features + showcase preview + outlets, ek call me ([#18](#18-get-brandscustomergetbrandid)) |
| **Purana `/brands/get` band** ✅ | Ab `isVendorOrAdmin` hai. Wo PAN/GSTIN/bank/subscription expose karta tha — [Appendix B](#appendix-b--known-issues) #7 resolved |
| **`isVerified` ab sahi** | `brand.isApproved` hamesha `false` tha; ab `SystemVerify` se derive hota hai |
| **Hidden albums ab hidden hain** | Naya endpoint `isVisible` filter karta hai |
| **Doc correction** ⚠️ | Lookup fields **singular objects** hain, plural arrays nahi — `pan` not `pans`, `firstSubBrand` not `subbrands`. Pehle galat documented tha |

### v1.1.0 me kya aaya tha

| Change | Detail |
|---|---|
| **+4 endpoints** | Naya `/deviceTokens/*` module — push notifications ([Section 17](#push-notification-apis)) |
| **Security fix** ✅ | Shared default password issue fix ho gaya — OTP accounts ab bina password ke bante hain. [Appendix B](#appendix-b--known-issues) #6 |
| **Backend grew** | Platform 108 → 143 endpoints. Naye modules (`/promoCodes`, `/subscribeds`, `/notifications`) vendor/admin ke liye hain — customer app ko nahi chahiye |
| **Role gates** | Vouchers, transactions, subBrands pe ab proper role checks hain. Customer-facing endpoints pe koi change nahi |

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [**Guest access — bina token kya chalta hai**](#guest-access--bina-token-kya-chalta-hai) 🆕
4. [Standard Response Format](#standard-response-format)
5. [Pagination](#pagination)
6. [HTTP Status Codes](#http-status-codes)
7. [Common Errors](#common-errors)
8. [Enums Reference](#enums-reference)
9. [Auth APIs](#auth-apis)
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
12a. [**Search APIs** 🆕](#search-apis-)
    - [GET /search](#14a-get-search)
    - [GET /search?type= — ek type, paginated](#14b-get-searchqtype--ek-type-paginated)
    - [GET /search/popular](#14c-get-searchpopular)
    - [GET /search/history](#14d-get-searchhistory)
    - [DELETE /search/history](#14e-delete-searchhistoryhistoryid--delete-searchhistory)
13. [Voucher APIs](#voucher-apis)
    - [GET /vouchers/customer/get-all](#15-get-voucherscustomerget-all)
    - [GET /vouchers/customer/get/:voucherId](#16-get-voucherscustomergetvoucherid)
    - [POST /vouchers/customer/voucher/preview](#17-post-voucherscustomervoucherpreview)
13a. [**Voucher Claim APIs** 🆕](#voucher-claim-apis-)
    - [POST /voucher-claims/create-order](#17a-post-voucher-claimscreate-order)
    - [POST /voucher-claims/verify](#17b-post-voucher-claimsverify)
    - [GET /transactions/invoice/:token](#17c-get-transactionsinvoicetoken)
    - [GET /voucher-claims — meri claims](#17d-get-voucher-claims--meri-claims)
    - [GET /voucher-claims/payments](#17e-get-voucher-claimspayments--mere-payments)
    - [GET /voucher-claims/payments/:transactionId](#17f-get-voucher-claimspaymentstransactionid--ek-payment)
    - [GET /voucher-claims/:claimId](#17g-get-voucher-claimsclaimid--ek-claim-timeline-ke-saath)
    - [GET /voucher-claims/code/:claimCode](#17h-get-voucher-claimscodeclaimcode--code-se-kholo)
13b. [**Refund APIs** 🆕](#refund-apis-)
    - [POST /refunds](#17i-post-refunds--refund-maango)
    - [PATCH /refunds/:requestId/withdraw](#17j-patch-refundsrequestidwithdraw--wapas-le-lo)
    - [PATCH /refunds/:requestId/bank-account](#17j-1-patch-refundsrequestidbank-account--failed-refund-kahan-bheju-) 🆕
    - [GET /refunds](#17k-get-refunds--meri-refunds)
    - [GET /refunds/:requestId](#17l-get-refundsrequestid--ek-refund)
13c. [**Bank Account APIs** 🆕](#bank-account-apis-)
    - [POST /bank-accounts/otp](#17m-post-bank-accountsotp--code-maango-) 🆕
    - [POST /bank-accounts](#17n-post-bank-accounts--account-jodo-) 🆕
    - [GET /bank-accounts](#17o-get-bank-accounts--mere-accounts-) 🆕
    - [DELETE /bank-accounts/:accountId](#17p-delete-bank-accountsaccountid--account-hataao-) 🆕
14. [Brand Profile APIs](#brand-profile-apis)
    - [GET /brands/customer/get/:brandId](#18-get-brandscustomergetbrandid)
    - [GET /brands/customer/get-all](#18a-get-brandscustomerget-all-) 🆕
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
16a. [**Email Verification APIs** 🆕](#email-verification-apis-)
    - [POST /auth/email/send-verification](#35-post-authemailsend-verification-) 🆕
    - [POST /auth/email/verify](#36-post-authemailverify-) 🆕
16b. [**Notification APIs** 🆕](#notification-apis-)
    - [GET /notifications/get-all](#37-get-notificationsget-all-) 🆕
    - [PUT /notifications/mark-read](#38-put-notificationsmark-read-) 🆕
    - [GET /notifications/preferences](#38a-get-notificationspreferences-) 🆕
    - [PUT /notifications/preferences](#38b-put-notificationspreferences-) 🆕
16c. [**App Config API** 🆕](#app-config-api-)
    - [GET /app-config](#39-get-app-config-) 🆕
17. [Push Notification APIs 🆕](#push-notification-apis)
    - [POST /deviceTokens/register](#31-post-devicetokensregister)
    - [PUT /deviceTokens/unregister](#32-put-devicetokensunregister)
    - [GET /deviceTokens/get-mine](#33-get-devicetokensget-mine)
    - [POST /deviceTokens/test](#34-post-devicetokenstest)
18. [Appendix A — Not For Customer App](#appendix-a--not-for-customer-app)
19. [Appendix B — Known Issues](#appendix-b--known-issues)

---

## Overview

Customer mobile app 10 functional areas cover karta hai:

| Area | Endpoints | Kya karta hai |
|---|---:|---|
| Auth | 3 | WhatsApp OTP login/signup + logout |
| User Profile | 3 | Profile fetch, update, delete |
| Location | 2 | Customer ka single saved address |
| Master Data | 4 | Categories + Sub-categories |
| Home Screen | 2 | Active banner + promotional tickers |
| Vouchers | 3 | Nearby vouchers list, detail, discount preview |
| Brand Profile | 6 | Brand list, brand detail, showcase gallery, video clips, features |
| Engagement | 4 | Follow / Avoid brand + unki lists |
| Legal | 4 | Terms & Conditions, Privacy Policy |
| Push Notifications 🆕 | 4 | Device register/unregister, my devices, test push |

**Important architecture notes:**

- **21 endpoints guest ke liye khule hain, 14 gated.** Har endpoint pe `**Access:**` line hai jo batati hai kaunsa gate laga hai. Poora naksha → [Guest access](#guest-access--bina-token-kya-chalta-hai)
  > Wo line **routes se derive hoti hai**, likhi nahi jaati (`postman/lib/routeGates.js`). Pehle ye haath se likhi jaati thi aur ek hi commit ne 19 lines ko chup-chaap jhootha kar diya tha — ab code badalne pe line apne aap badal jaati hai.
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

## Guest access — bina token kya chalta hai

App store approval ke liye user ko **sign-up se pehle** app dekhne dena zaruri tha, isliye
browse endpoints se auth hata di gayi hai. **62 me se 22 endpoints guest ke liye khule
hain** (18 poore public + 4 `optionalAuth`).

### Chhah tarah ke access

Ye ginti [`postman/lib/routeGates.js`](../postman/lib/routeGates.js) se nikli hai, jo
`routes/` padhta hai — haath se nahi gini gayi.

| Gate | Matlab | Kitne |
|---|---|---:|
| 🌐 **Public** | Token dekha hi nahi jaata. Response sabke liye ek jaisa | 19 |
| 🌐 **`optionalAuth`** | Token ho to decode hota hai aur response personalise hota hai; na ho to guest chalta hai | 4 |
| 🌐 **Public — auth entry** | Login/OTP. Public hona **majboori** hai, warna koi sign in hi na kar paaye — par ye "browsing" nahi hai | 2 |
| 🔒 **`verifyJwtToken`** | Koi bhi signed-in role — **ek endpoint, kai shapes** (claims, payments, refunds, notifications) | 17 |
| 🔒 **`isCustomer`** | Sirf customer — engagement, location, claims ke writes, bank accounts, refunds ke writes, search history | 17 |
| 🔒 **`verifyJwtTokenEvenIfDeactivated`** | Signed in, suspended account bhi — logout, push unregister aur **notification feed**, warna suspended user phasa reh jaata aur suspension samjhane wala notice bhi na padh paata | 3 |

> ⚠️ **18 Public me `GET /transactions/invoice/:token` bhi hai**, par wo guest surface
> nahi hai: uska 32-byte token hi credential hai. Wo link WhatsApp/email se aata hai,
> jahan browser me koi session hota hi nahi.
>
> ⚠️ Ye table pehle `verifyJwtToken: 7` aur `isCustomer: 5` kehta tha — ginti claims,
> refunds, bank accounts aur search jodne se **pehle** ki thi, aur kisi ne update nahi ki.

### Kya guest kar sakta hai

| Screen | Endpoints |
|---|---|
| **Home** | Banner · tickers · categories · sub-categories |
| **Search** 🆕 | Global search · popular searches. Poora search box guest ke liye khula hai |
| **Voucher feed** | Feed · voucher detail · discount preview |
| **Brand** | Directory · profile · showcase gallery · video clips · features |
| **Legal** | Terms · privacy (sign-up screen ke consent link ke liye zaruri) |

### Kya guest nahi kar sakta

Profile, saved address, follow / avoid, push notifications, **search history** — sab kuch
jo **"mera"** hai.
Wahan `401 "Access Denied! Missing authorization token"` aata hai, jo app ke liye login
screen dikhane ka signal hai.

### ⚠️ Guest ko coordinates khud bhejne padte hain

Voucher feed signed-in user ke liye uske **saved address** pe gir jaata hai. Guest ka koi
saved address hota hi nahi, to usse `latitude` + `longitude` bhejne padte hain:

```http
GET /vouchers/customer/get-all?latitude=22.7533&longitude=75.8937
```

Na bhejein to:

```json
{
  "success": false,
  "message": "Location is required. Send latitude and longitude, or save an address first."
}
```

Global search bhi wahi resolver use karta hai, par usme location **optional** hai:
coordinates na ho to sirf offers wala section skip hota hai (`locationRequired: true` ke
saath) aur brands, categories aur areas normal chalte hain — dekhein [§14a](#14a-get-search).

### ⚠️ `optionalAuth` ka matlab "koi bhi token chalega" nahi hai

Token **na** bhejna bilkul theek hai. Par **galat** token bhejna theek nahi — wo waise hi
reject hota hai jaise kisi bhi gated endpoint pe:

```json
{ "success": false, "message": "Invalid or malformed token. Please log in again." }
```

Ye jaan-boojhkar hai. Expired token ko chup-chaap guest bana dena zyada 'friendly' lagta
hai, par tab user ko anonymous feed dikhta rehta — apne saved address ke bina, apne
follows ke bina — aur app usse kabhi dobara login karne ko kehti hi nahi. Behtar hai ki
app `403` dekhe, token phenke, aur login screen dikhaye.

**App ke liye rule:** token hai to bhejo, nahi hai to header hi mat bhejo. Khaali ya
purana token kabhi mat bhejo.

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

**Exception:** `GET /showcase/get-brand-showcase/:brandId` empty pe `200` + `sections: []` deta hai (404 nahi). Us endpoint pe `404` ka matlab alag hai — brand hi nahi mila (deleted/deactivated), jo genuine error hai.

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
`PERCENTAGE` · `FLAT` · `FIXED`

✅ Teeno kaam karte hain. `FIXED` pehle calculate hi nahi hota tha (`discountAmount: 0` deta tha aur filter ho jaata tha) — ab wo `FLAT` ka alias hai.

### VOUCHER_BANNER_TYPE 🆕
`IMAGE` · `VIDEO` · `GIF`

> Voucher list aur detail me `bannerType` field pe aata hai. Banner na ho to `null`.
> ⚠️ Note: showcase media `PHOTO`/`VIDEO` use karta hai, banner `IMAGE`/`VIDEO`/`GIF` — dono alag enums hain, mix mat karein.

### VOUCHER_USAGE_TYPE
`ONCE_PER_USER` · `MULTIPLE`

### DISCOUNT_APPLICABLE_ON
`SUBTOTAL` · `FINAL_BILL`

### VOUCHER_STATUSES (reference — customer ko sirf `PUBLISHED` dikhte hain)
`DRAFT` · `UNDER_REVIEW` · `APPROVED` · `PUBLISHED` · `REJECTED` · `EXPIRED` · `PAUSED` · `ARCHIVED`

### DEVICE_PLATFORMS 🆕
`ANDROID` · `IOS` · `WEB`
> Push device register karte waqt mandatory. Auto-uppercase hota hai, to `"android"` bhi chalega.

### NOTIFICATION_CHANNELS (reference)
`IN_APP` · `EMAIL` · `PUSH` · `WHATSAPP`
> `IN_APP` hamesha likha jaata hai; baaki tab attempt hote hain jab destination ho aur channel enabled ho. `WHATSAPP` abhi **reserved** hai — provider OTP ke liye hai, par WhatsApp Business har message type ke liye pre-approved template maangta hai.

### SHOWCASE_MEDIA_TYPE
`PHOTO` · `VIDEO`

### SCREENS (onboarding step tracking — `currentScreen` field)
`BUSINESS_NAME` · `REGISTRATION_STATUS` · `REGISTRATION_ENTITY_TYPE` · `PAN_VERIFICATION` · `GST_VERIFICATION` · `BANK_VERIFICATION` · `SYSTEM_VERIFICATION` · `PARTNERSHIP_DEED` · `SUBSCRIBE_PLAN` · `OUTLET_PAGE` · `UNDER_REVIEW` · `DASHBOARD`

> 🔴 **Customer app se `currentScreen` bhejna hi nahi hai.** Is enum me **ek bhi customer screen nahi** hai — sab vendor onboarding ke steps hain.
>
> Aur galat value chup-chaap ignore nahi hoti: Joi ise koi bhi string maan leta hai, par model pe enum lagi hai, to `"HOME"` bhejne pe **poora `/auth/verify-otp-whatsapp` `422` ho jaata hai** aur user login hi nahi kar paata. Error bhi raw mongoose message hota hai:
>
> ```json
> { "success": false, "message": "`HOME` is not a valid enum value for path `currentScreen`." }
> ```
>
> Verify karke confirm kiya gaya (2026-08-26).

### VOUCHER_CLAIM_STATUS 🆕

`constants/voucherClaim.js` — ek **claim** ki haalat.

| Value | Matlab | Customer ko kab dikhta hai |
|---|---|---|
| `PENDING` | Order khula, paisa abhi nahi aaya | Checkout beech me chhoda |
| `PAID` | Paisa aa gaya, voucher use karne layak | Aam haalat |
| `REDEEMED` | Outlet par use ho gaya | Counter par scan/code ke baad |
| `FAILED` | Payment fail | Card decline, UPI timeout |
| `CANCELLED` | Rad kar diya gaya | |
| `EXPIRED` | Voucher ki validity khatam, use nahi hua | Expiry sweep se |
| `REFUNDED` | Paisa wapas ho gaya | Refund `COMPLETED` hone par |

⚠️ **Ye payment ka status nahi hai.** Do alag lifecycle hain, aur ek hi shabd dono ke
liye padhna aam galti hai — neeche wala block dekhein.

---

### PAYMENT_STATUS 🆕

`constants/index.js` — ek **payment** ki haalat. **Lowercase**, kyunki ye Razorpay ki
vocabulary hai, hamari nahi.

| Value | Matlab |
|---|---|
| `created` | Order bana, customer ne abhi pay nahi kiya |
| `authorized` | Bank ne hold kiya, capture nahi hua |
| `captured` | Paisa aa gaya — yahi `PAID` claim banata hai |
| `failed` | Fail |

⚠️ `authorized` par atki payment **~5 din me apne aap refund** ho jaati hai. Isiliye
`GET /transactions/admin/health` use `CRITICAL` ginta hai — wo ghadi ke saath paisa
khoti hai.

⚠️ `GET /voucher-claims/payments?status=` **inhi** values ko leta hai, claim ki nahi.

---

### REFUND_REASON 🆕

`constants/refund.js` — `POST /refunds` ka `reason`.

| Value | Kab |
|---|---|
| `NOT_HONOURED` | Outlet ne voucher maana hi nahi |
| `OUTLET_CLOSED` | Pahunche to band tha |
| `WRONG_AMOUNT` | Galat rakam cut gayi |
| `SERVICE_ISSUE` | Service kharab thi |
| `DUPLICATE_PAYMENT` | Do baar cut gaya |
| `CHANGED_MIND` | Iraada badal gaya |
| `OTHER` | ⚠️ Iske saath `reasonNote` **zaroori** hai |

⚠️ `OTHER` par `reasonNote` maangne ki wajah practical hai: jab outlet inkaar kare aur
grahak us inkaar ko chunauti de, admin ke paas sameeksha karne ko **yahi ek cheez** hoti
hai. *"OTHER"* apne aap me kuch nahi batata.

---

### REFUND_REQUEST_STATUS 🆕

`constants/refund.js`. Bara values, par **app ko `REFUND_CUSTOMER_LABEL` dikhana
chahiye**, raw status nahi — labels usi file me hain aur customer ki zubaan me likhe gaye
hain.

| Value | Customer ko dikhne wala label | Khula? |
|---|---|:-:|
| `REQUESTED` | Refund requested | ✅ |
| `VENDOR_APPROVED` | Approved by the outlet | ✅ |
| `VENDOR_REJECTED` | Declined by the outlet | – |
| `VENDOR_TIMEOUT` | Under review by Trydood | ✅ |
| `ADMIN_APPROVED` | Approved — processing | ✅ |
| `ADMIN_REJECTED` | Declined after review | – |
| `ADMIN_OVERRIDE` | Approved by Trydood | ✅ |
| `PROCESSING` | On its way to your account | ✅ |
| `AWAITING_BANK_DETAILS` | Add your bank account so we can send it | ✅ |
| `COMPLETED` | Refunded | – |
| `FAILED` | Refund failed — we are on it | ✅ |
| `CANCELLED` | Withdrawn | – |

**Khula (`isOpen`)** = `REFUND_OPEN_STATUSES`. ⚠️ `FAILED` **khula ginta hai** — paisa
abhi bhi grahak ko jaana hai, sirf raasta badalna hai
([17j-1](#17j-1-patch-refundsrequestidbank-account--failed-refund-kahan-bheju-)).

⚠️ **Status se `canWithdraw`/`canDecide` khud mat nikaalein** — response me aate hain.
Jo panel unhe status se derive karega wo naye state judte hi galat ho jayega.

---

### Refund `method` 🆕

| Value | Matlab |
|---|---|
| `SOURCE` *(default)* | Usi card/UPI par wapas |
| `MANUAL_BANK` | Bank account me NEFT — jab `SOURCE` chal hi na sake |

`SOURCE` band pade instrument par **har baar** fail hota hai, aur wahi
`AWAITING_BANK_DETAILS` ka raasta kholta hai.

---

### Refund abuse limits (admin-configurable) 🆕

`Setting.customer.refund` · defaults `constants/customer.js` → `REFUND_DEFAULTS`

| Key | Default | Kya |
|---|---:|---|
| `maxOpenRequests` | `1` | Ek waqt me kitni khuli refunds |
| `maxRejectedPerWindow` | `3` | Window me kitni **thukrai** requests |
| `requestWindowDays` | `30` | Window ki lambai |
| `windowHours` | `24` | `paidAt` se kitne ghante tak refund maanga ja sakta hai |
| `allowPartial` | `true` | Aadhi rakam ka refund |

⚠️ Ginti **thukrai** requests ki hoti hai, **approve hui ki kabhi nahi**. Jis grahak ki 5
refunds approve hui, uske saath 5 baar sach me bura hua. `CANCELLED` bhi ginta hai:
raise → outlet dekhe → withdraw → phir raise, ye outlet ko vyast rakhne ka tareeka hai
bina kabhi rejection kamaye.

Limit chhoone par jawab **support par bhejta hai, raasta band nahi karta**.

---

### SEARCH_RESULT_TYPES 🆕

`constants/search.js` — `GET /search` ke sections. `type=` (single, paginated) aur
`types=` (multi, filter) dono inhi values ko lete hain.

| Value | Section label | Location chahiye? | `seeAll` kahan bhejta hai |
|---|---|:-:|---|
| `BRAND` | Brands | ❌ | `/brands/customer/get-all` |
| `VOUCHER` | Offers | ✅ | `/vouchers/customer/get-all` |
| `CATEGORY` | Categories | ❌ | Category listing |
| `SUB_CATEGORY` | Sub-categories | ❌ | Sub-category listing |
| `AREA` | Areas | ❌ | Location switch |

Section order wahi hai jo is table me hai (`SEARCH_SECTION_ORDER`).

⚠️ Sirf `VOUCHER` ko coordinates chahiye, isliye guest ko **khaali screen nahi** milti —
baaki chaar sections phir bhi jawab dete hain.

---

### Claim code alphabet 🆕

`helpers/voucherClaims/generateClaimCode.js`

Confusable characters **jaan-boojh kar chhode** gaye hain: `0`/`O`, `1`/`I`/`L`,
`5`/`S`, `2`/`Z`, `8`/`B`.

Isliye inme se koi bhi character aane par jawab **`422` "mistyped"** hai, `404` nahi —
`404` padhne me lagta hai claim hai hi nahi, jabki asal me code galat likha gaya hai.
Counter par yahi farq tay karta hai ki staff dobara type kare ya grahak ko laut jaaye.

---

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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
| `currentScreen` | string | ❌ | – | 🔴 **Customer app se bhejein hi nahi.** Enum me sirf vendor onboarding screens hain — koi bhi doosri value poori login call `422` kar deti hai. [Details](#screens-onboarding-step-tracking--currentscreen-field) |

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

**3. 🔴 `currentScreen` pe validator loose hai — aur galti login hi tod deti hai.** Joi sirf `Joi.string()` check karta hai (enum nahi), par Mongoose model pe SCREENS enum lagi hai. Matlab galat value Joi se pass ho jaati hai aur Mongoose pe `422` throw karti hai — user login hi nahi kar paata.

Aur SCREENS me **koi customer screen hai hi nahi** (sab vendor onboarding steps hain), to customer app ke paas bhejne layak koi valid value hai hi nahi. **Ye field bhejein hi nahi.**

Live verify kiya (2026-08-26): `{"currentScreen": "HOME"}` → `422 "`HOME` is not a valid enum value for path `currentScreen`."`

**4. Response me `password` hash aata hai** — same issue as endpoint #1.

**5. Token store karna:** `data.token` ko secure storage me rakhein (Keychain / EncryptedSharedPreferences). Har subsequent request me `Authorization: Bearer <token>`.

**6. Original OTP flow (jab uncomment hoga) ye errors dega:** `401 "Please resend OTP! OTP is expired or missing"`, `403 "Max attempts exceeded! Please try again later."`, `401 "Invalid OTP! Please try again."` — app me in cases ko handle karke rakhein.

---

## 3. POST /auth/logout

**Access:** 🔒 **Signed in — suspended account bhi** (`verifyJwtTokenEvenIfDeactivated`)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Body — dono optional 🆕
| Field | Type | Required | Default | Kya karta hai |
|---|---|---|---|---|
| `pushToken` | string | ❌ | – | Is device ka FCM token. Bhejne par isi device ke push notifications band |
| `allDevices` | boolean | ❌ | `false` | `true` = har device se sign out — **har purana JWT turant dead** |

Khaali body bhi bilkul valid hai — wahi purana behaviour, plus flags ab sahi update hote hain.

```jsonc
{}                                     // is device se logout
{ "pushToken": "fcm_abc123..." }       // + is device ka push band
{ "allDevices": true }                 // + har device ka JWT aur push khatam
```

### Success — `200`
```json
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

| Field | Kya |
|---|---|
| `sessionsEnded` | `true` sirf `allDevices` par. Matlab har purana token abhi refuse hone lagega |
| `pushDeactivated` | Kitne devices ka push band hua. `pushToken` na bheja to `0` |
| `activeDevices` | Ab kitne devices par push chalu hai. `null` matlab push ko chhua hi nahi gaya |

`allDevices: true` par message badal jaata hai — `"Signed out of all devices"`.

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | *(auth error)* | Token nahi ya invalid |
| `422` | `pushToken does not look like a valid push token` | 20 chars se chhota |

### ⚠️ Edge cases & notes

**1. Ye endpoint sabke liye ek hi hai** — customer, vendor, sub-vendor, admin. Aur **suspended account bhi ise call kar sakta hai**: baaki har gate deactivated user ko `401` deta hai taaki client use sign out kar de, to sign-out hi refuse karna wo ek cheez hoti jo use phansa deti.

**2. Saada logout aapka token invalidate nahi karta.** JWT stateless hai — wo apni expiry tak valid rehta hai. **App ko token khud delete karna hoga**, cache clear karna hoga, login screen pe jaana hoga. Server ki taraf se sirf flags neeche aate hain aur (token bheja ho to) push band hota hai.

**3. `pushToken` na bheja to push chalta rahega.** Ye jaan-boojh kar hai — purane app versions jo ye field nahi bhejte wo logout to kar payenge. Par tab tak un devices ko notifications aate rahenge. `pushDeactivated: 0` isi ka signal hai.

> App ko apna FCM token yaad rakhna chahiye (wahi jo `POST /deviceTokens/register` me bheja tha) aur logout par wapas bhejna chahiye. Pehle iske liye alag se `PUT /deviceTokens/unregister` call karna padta tha — ab ek hi call kaafi hai.

**4. `allDevices: true` sach me har device band karta hai** — phone, tablet, sab. Ye kho gaye phone ka jawab hai. Iske baad har device par agli hi request `401 "Your session has ended. Please log in again."` degi, **is device par bhi** — jis token se aapne ye call kiya wo bhi mar jaata hai.

> ⚠️ Ek chhoti si baareeki: session kill `iat` (seconds) ko compare karta hai aur "strictly before" hai, to **usi second me** banaya gaya token bach jaata hai. Practically kabhi nahi hota — token login par banta hai, logout minton baad hota hai — par login ke turant baad `allDevices` maarne par wo ek token zinda reh sakta hai.

**5. Pending payment logout se cancel nahi hota.** Agar customer Razorpay ke checkout me hai aur app se logout kar deta hai, to payment phir bhi complete ho sakti hai aur webhook claim bana dega. Ye jaan-boojh kar hai — logout par order cancel karna us paise ko phansa deta jo bank se nikal chuka hai.

---

# User Profile APIs

## 4. GET /users/get

Logged-in customer ka profile, uske customer record aur saved location ke saath.

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

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

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

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

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

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

**Access:** 🔒 **Sirf CUSTOMER** (`isCustomer`)

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

**2. Ye endpoint voucher listing ko aasan banata hai, zaruri nahi hai.** Voucher APIs (#15, #16) ko coordinates chahiye. Address save hone pe wo **apne aap** use ho jaate hain; warna har call me `latitude`/`longitude` explicitly bhejne padte hain, warna `400 "Location is required…"` aata hai.

> Guest ke paas saved address ho hi nahi sakta (ye endpoint `isCustomer` hai), to guest mode me coordinates hamesha explicitly bhejein.

**3. Upsert lookup `userId` pe hota hai**, `customerId` pe nahi. Ek user ki ek hi location rahegi.

**4. `formattedAddress` auto-generate hota hai** agar na bhejein — saare address parts comma-separated, lowercase. Bhejenge to aapka value use hoga.

**5. Text fields lowercase ho jaate hain** (`city`, `district`, `state`, `country`). `addressLine1`, `addressLine2`, `landmark` original case me rehte hain.

**6. `Customer.locationId` auto-sync hota hai** — upsert ke baad customer record us location ko point karta hai.

**7. `isDefault` ka koi practical effect nahi hai** (unique index commented out hai) kyunki ek customer ki ek hi location hoti hai.

**8. Validator `create` se shared hai** — isliye `isBrandAddress`/`isSubBrandAddress` fields accept hote hain, par customer flow me inko `false` (default) rehna chahiye.

---

## 8. GET /locations/get/:id

Location ID se detail fetch.

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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
        "createdAt": "2026-05-10T08:00:00.000Z",
        "stats": {
          "subCategories": { "total": 6, "active": 5 },
          "brands":        { "total": 48, "active": 41 },
          "vouchers":      { "total": 130, "active": 96 },
          "promoCodes":    { "total": 3, "active": 2 }
        }
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c0e2",
        "name": "salon & spa",
        "description": "beauty and wellness services",
        "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/Images/salon.jpg",
        "isActive": true,
        "createdAt": "2026-05-10T08:05:00.000Z",
        "stats": {
          "subCategories": { "total": 4, "active": 4 },
          "brands":        { "total": 11, "active": 9 },
          "vouchers":      { "total": 22, "active": 20 },
          "promoCodes":    { "total": 0, "active": 0 }
        }
      }
    ]
  }
}
```

**Projected fields only:** `_id`, `name`, `description`, `image`, `isActive`, `createdAt`, `stats`. `updatedAt` aur `isDeleted` nahi aate.

### `stats` — ye admin panel ke liye hai

Ye endpoint admin panel aur customer app dono use karte hain, aur `stats` dono ko jaata hai. Customer app ke liye ye **optional** hai — ignore kar sakte hain, ya "48 brands" jaisa count chip dikhana ho to `stats.brands.active` use karein.

| Key | Kya |
|---|---|
| `subCategories` · `brands` · `vouchers` · `promoCodes` | Is category se juda hua kya-kya exist karta hai |
| `total` | Jo exist karta hai (deleted nahi) |
| `active` | Usme se jo `isActive: true` hai — **customer ko yahi dikhana chahiye** |

⚠️ Customer-facing count ke liye `active` lein, `total` nahi. `total` me wo brands/vouchers bhi hain jo abhi off hain, to app "48 brands" dikhayega aur category kholne pe 41 hi milenge.

⚠️ `vouchers` **status nahi dekhta** — draft aur unpublished bhi ginte hain, kyunki wo exist karte hain. Jo customer ko sach me dikhega uska count chahiye to voucher listing ka `total` use karein, ye nahi.

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

> `getAll` ke mukable yahan **poora document** aata hai (`isDeleted`, `updatedAt` bhi). `stats` bilkul wahi shape hai — [#9](#9-get-categoriesgetall) me detail hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Category not found` | ID nahi mili ya soft-deleted |
| `422` | `Invalid Category Id` | Valid ObjectId nahi |

---

## 11. GET /subCategories/getAll

Sub-categories list. `categoryId` se filter kar sakte hain.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

> Note: yahan `isDeleted` aur `updatedAt` bhi project hote hain (categories `getAll` se different).

`stats` yahan sirf `brands` aur `vouchers` rakhta hai — `PromoCode` sirf `categoryIds` pe scoped hota hai, sub-category ka koi field usme nahi. Baaki matlab [#9](#9-get-categoriesgetall) jaisa hi hai (`active` lein, `total` nahi).

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any subcategory found` | Koi sub-category nahi |
| `422` | *(Joi message)* | Invalid query param |
| `500` | *(cast error)* | `categoryId` invalid ObjectId format |

---

## 12. GET /subCategories/get/:id

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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
    "updatedAt": "2026-05-10T09:00:00.000Z",
    "stats": {
      "brands":   { "total": 12, "active": 10 },
      "vouchers": { "total": 34, "active": 28 }
    }
  }
}
```
> `stats` [#11](#11-get-subcategoriesgetall) waala hi hai.

### Errors
| Status | Message |
|---|---|
| `404` | `Sub-category not found` |
| `422` | `Invalid SubCategory Id` |

---

# Home Screen APIs

## 13. GET /banners/customer/active

Home screen ka **ek** active banner. App-level banner hai (kisi brand ka nahi).

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

# Search APIs 🆕

Home screen ke sabse upar wala global search box. Ek call me brands, offers, categories,
sub-categories aur areas — sab.

**Poora module token ke bina chalta hai.** Sirf history wale teen endpoints ko login
chahiye — guest ki recent searches uske apne device par rehti hain (§14d).

---

## 14a. GET /search

**Access:** 🌐 **Public** (`optionalAuth`) — guest aur signed-in dono.

Signed-in customer ko do cheezein extra milti hain, baaki kuch nahi badalta:
coordinates na bhejne par uska saved address use ho jaata hai, aur `commit=true`
wali query yaad rakhi jaati hai.

### Query Params

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `q` | string | ✅ | – | Search text. Minimum **2** (admin-configurable), maximum 100 |
| `latitude` · `longitude` | number | ❌ | – | **Saath me hi** bhejein, warna `422`. Na bhejein to offers skip |
| `types` | CSV | ❌ | sab | `BRAND,VOUCHER,CATEGORY,SUB_CATEGORY,AREA` me se koi bhi |
| `type` | enum | ❌ | – | Ek hi type, paginated — **response shape badal jaata hai**, [§14b](#14b-get-searchqtype--ek-type-paginated) |
| `page` | number | ❌ | `1` | Sirf `type` ke saath. Bina `type` ke `422` |
| `limit` | number | ❌ | `5` | Overview me **per section**; single-type me page size (max 50) |
| `commit` | boolean | ❌ | `false` | `true` = ye query history me save karo |

```http
GET /search?q=pizza&latitude=22.7533&longitude=75.8937&limit=5
```

### Success — `200`

```jsonc
{
  "success": true,
  "message": "Search results fetched",
  "data": {
    "query": "pizza",
    "isEnabled": true,
    "hasLocation": true,
    "totalResults": 31,
    "sections": [
      {
        "type": "BRAND",
        "label": "Brands",
        "total": 3,
        "items": [
          {
            "type": "BRAND",
            "id": "68f1a2b3c4d5e6f7a8b9c0a1",
            "title": "Domino's Pizza",
            "subtitle": "Food & Beverages · 12 outlets",
            "image": "https://res.cloudinary.com/…/dominos.jpg",
            "meta": {
              "uniqueId": "#TB69063",
              "isTopBrand": true,
              "isVerified": true,
              "followersCount": 4821,
              "outletCount": 12,
              "categoryId": "68f0…b3e1",
              "subCategoryId": "68f0…b3e9",
              "distanceInMeters": 2310
            },
            "target": {
              "screen": "BRAND_PROFILE",
              "endpoint": "/brands/customer/get/68f1a2b3c4d5e6f7a8b9c0a1"
            }
          }
        ],
        "seeAll": {
          "endpoint": "/brands/customer/get-all",
          "params": { "search": "pizza" }
        }
      },
      {
        "type": "VOUCHER",
        "label": "Offers",
        "total": 24,
        "locationRequired": false,
        "items": [
          {
            "type": "VOUCHER",
            "id": "68f2a2b3c4d5e6f7a8b9d1b7",
            "title": "Weekend Special – 30% Off",
            "subtitle": "Domino's Pizza · indore · 1.1 km",
            "image": "https://res.cloudinary.com/…/voucher.jpg",
            "meta": {
              "brandId": "68f1a2b3c4d5e6f7a8b9c0a1",
              "brandName": "Domino's Pizza",
              "categoryId": "68f0…b3e1",
              "subCategoryId": "68f0…b3e9",
              "bestOffer": { "title": "30%", "discountType": "PERCENTAGE", "discountValue": 30 },
              "startAt": "2026-09-02T00:00:00.000Z",
              "endAt": "2026-09-30T13:00:00.000Z",
              "isSuggested": true,
              "distance": "1.1 km",
              "distanceInMeters": 1104
            },
            "target": {
              "screen": "VOUCHER_DETAIL",
              "endpoint": "/vouchers/customer/get/68f2a2b3c4d5e6f7a8b9d1b7"
            }
          }
        ],
        "seeAll": {
          "endpoint": "/vouchers/customer/get-all",
          "params": { "search": "pizza", "latitude": 22.7533, "longitude": 75.8937 }
        }
      },
      {
        "type": "CATEGORY",
        "label": "Categories",
        "total": 1,
        "items": [
          {
            "type": "CATEGORY",
            "id": "68f0a2b3c4d5e6f7a8b9b3e1",
            "title": "Food & Beverages",
            "subtitle": "6 sub-categories · 48 brands · 130 offers",
            "image": "https://res.cloudinary.com/…/food.jpg",
            "meta": {
              "description": "restaurants, cafes, and food outlets",
              "subCategoryCount": 6,
              "brandCount": 48,
              "voucherCount": 130
            },
            "target": {
              "screen": "CATEGORY_LISTING",
              "endpoint": "/vouchers/customer/get-all",
              "params": { "categoryId": "68f0a2b3c4d5e6f7a8b9b3e1" }
            }
          }
        ],
        "seeAll": { "endpoint": "/categories/getAll", "params": { "search": "pizza", "isActive": true } }
      },
      { "type": "SUB_CATEGORY", "label": "Sub-categories", "total": 0, "items": [], "seeAll": { "…": "…" } },
      {
        "type": "AREA",
        "label": "Areas",
        "total": 3,
        "items": [
          {
            "type": "AREA",
            "id": "indore|madhya pradesh",
            "title": "indore",
            "subtitle": "madhya pradesh · 23 outlets · 11 brands",
            "image": null,
            "meta": {
              "city": "indore",
              "state": "madhya pradesh",
              "latitude": 22.7533,
              "longitude": 75.8937,
              "outletCount": 23,
              "brandCount": 11
            },
            "target": {
              "screen": "LOCATION_SWITCH",
              "params": { "latitude": 22.7533, "longitude": 75.8937, "label": "indore" }
            }
          }
        ],
        "seeAll": { "endpoint": "/search", "params": { "q": "pizza", "type": "AREA" } }
      }
    ]
  }
}
```

### Har row ka ek hi shape hota hai

Chahe type koi bhi ho, row me yahi saat fields hoti hain:

| Field | Kya |
|---|---|
| `type` | `BRAND` · `VOUCHER` · `CATEGORY` · `SUB_CATEGORY` · `AREA` |
| `id` | Us cheez ki id. ⚠️ AREA me ye **synthetic** hai — neeche dekhein |
| `title` · `subtitle` | Seedha render karne ke liye. Subtitle server banata hai |
| `image` | AREA me hamesha `null` — jagah ki apni koi tasveer nahi hoti |
| `meta` | Type ke hisaab se extra fields |
| `target` | **Tap karne pe kahan jaana hai** |

App ek hi row component se paanchon render kar sakti hai. Naya type kal jud jaye to app ko
bas ek label chahiye, naya parser nahi.

> **`target` server bhejta hai — app hardcode na kare.** Voucher detail ka path kal badla to
> ek jagah badlega, har shipped app version me nahi. Yahi `seeAll` ke saath bhi: section apna
> "see all" endpoint aur params khud batata hai.

| `target.screen` | Kya karna hai |
|---|---|
| `BRAND_PROFILE` | `target.endpoint` khol do |
| `VOUCHER_DETAIL` | `target.endpoint` khol do |
| `CATEGORY_LISTING` · `SUB_CATEGORY_LISTING` | `target.endpoint` ko `target.params` ke saath call karo |
| `LOCATION_SWITCH` | App apni location `target.params` ke point par set kare — koi page nahi khulta |

### ⚠️ Location na ho to offers skip hote hain — chupke se nahi

`latitude`/`longitude` na ho (aur signed-in customer ka saved address bhi na ho) to:

- `hasLocation: false`
- `VOUCHER` section **rehta hai**, par `total: 0` aur **`locationRequired: true`**
- baaki chaar sections normal chalte hain

App ko us section me "Aas-paas ke offers dekhne ke liye location on karein" dikhana chahiye.

⚠️ `locationRequired: true` aur `total: 0` **do alag baatein** hain:

| | Matlab | App kya kahe |
|---|---|---|
| `locationRequired: true` | Humein pata hi nahi aap kahan ho | "Location on karein" |
| `locationRequired: false`, `total: 0` | Aapke 25 km me is naam ka offer nahi hai | "Aas-paas kuch nahi mila" |

**Kyun skip, poori request fail kyun nahi:** voucher pipeline `$geoNear` se shuru hoti hai
aur `$geoNear` pipeline ka pehla stage hi ho sakta hai — to "bina location voucher search"
ek filter hata dena nahi, poori alag pipeline hoti. Aur poori request 422 kar dena us guest
ko brand ka naam bhi nahi dhoondhne deta jisne location permission deny ki hai — jiske liye
location kabhi chahiye hi nahi thi.

### Khaali section gayab nahi hota

Har maanga gaya section response me rehta hai, chahe `total: 0` ho. App ko "Brands me kuch
nahi mila" dikhana ho to uske paas section hona chahiye. Aur `totalResults === 0` se saaf
pata chalta hai ki kuch bhi nahi mila.

**`404` kabhi nahi aata.** Kuch na milna search ka normal jawab hai.

### Kya kis field pe match hota hai

| Section | Match | Location chahiye? |
|---|---|:-:|
| `BRAND` | `brandName` | ❌ |
| `VOUCHER` | Voucher ka naam **aur** offer ka title | ✅ |
| `CATEGORY` · `SUB_CATEGORY` | `name` | ❌ |
| `AREA` | Live outlets ke address ka `city` | ❌ |

Har section me exact match sabse upar, phir jo term se **shuru** hota hai, phir jisme term
kahin aata hai. Bina iske "pizza" search karne par "Tony's Pizza Corner" "Pizza Hut" ke
upar aa sakta hai.

⚠️ **Brand ki `description` pe match nahi hota**, sirf naam pe. Lambi description me aadhi
duniya ke shabd aa jaate hain, aur ek bhatka hua "pizza" kisi ko pizza brand nahi bana deta.

⚠️ **Offer ka title bhi match hota hai.** "buy 1 get 1" kisi voucher ke *naam* me nahi
hota — wo offer hai. Ye jodne se pehle wo phrase, jo customer sach me type karta hai, kuch
nahi dhoondh paata tha.

### AREA — jagah, cheez nahi

Outlet ka apna koi naam nahi hota (`SubBrand` me `name` field hai hi nahi), to areas live
outlets ke **address** se bante hain, city ke hisaab se group karke.

**Tap karne pe koi page nahi khulta.** Row me us jagah ka centroid aata hai aur app apni
location wahan set kar deti hai — home feed aur voucher search pehle se `$geoNear` par hain,
to sab apne aap us area ke ho jaate hain.

- Centroid us area ke **saare** outlets ka औसत hai, kisi ek dukaan ka pin nahi. Ek pin lene
  se "Indore" ka matlab ek gali ban jaata aur wahan switch karne par aadhe area ke offers
  25 km radius se bahar chhoot jaate.
- ⚠️ `id` (`"indore|madhya pradesh"`) **synthetic** hai — sirf list key ke liye. Kisi
  endpoint me id ki tarah **mat bhejein**.
- ⚠️ `city` free text hai, normalise nahi hota. "Andheri West" aur "andheri west" ek row
  hain, par "Andheri  West" (do space) alag reh jaata hai. Search tootti nahi — ek jagah do
  rows ki tarah dikh sakti hai.

### Errors

| Status | Message | Kab |
|---|---|---|
| `422` | `Search text is required.` | `q` khaali |
| `422` | `Search text must be at least 2 characters.` | `minQueryLength` se chhota |
| `422` | `latitude and longitude must be provided together.` | Ek bheja, doosra nahi |
| `422` | `` `page` only applies with `type`. `` | Overview me `page` |
| `422` | Send either `type` … or `types` … | Dono ek saath |
| `401` | `Your session has expired…` | ⚠️ Expired token guest me downgrade **nahi** hota |

⚠️ Aakhri wala jaan-boojh kar hai: expired token ko chupke se guest bana dena signed-in
customer ko anonymous view dikha deta bina kisi wajah ke, aur usse kabhi dobara login karne
ko kaha hi nahi jaata.

### ⚠️ Search box kaise call kare

**`commit=true` sirf tab bhejein jab customer Enter/Search dabaye ya kisi result pe tap
kare** — type karte waqt nahi. Har keystroke pe commit karne se recent list
`p, pi, piz, pizz, pizza` ban jaati hai aur feature na hone se badtar ho jaata hai.

2 characters se pehle call hi na karein, aur calls ko debounce karein.

---

## 14b. GET /search?q=…&type= — ek type, paginated

**Access:** 🌐 **Public** (`optionalAuth`)

`type` dene se **response ka shape badal jaata hai**: `sections[]` ki jagah ek `items[]`
plus pagination. Row ka envelope wahi rehta hai, to app ka row component dono mode me ek hi
chalta hai.

```http
GET /search?q=indore&type=AREA&page=2&limit=20
```

```jsonc
{
  "success": true,
  "message": "Search results fetched",
  "data": {
    "query": "indore",
    "isEnabled": true,
    "type": "AREA",
    "hasLocation": false,
    "total": 12,
    "totalPages": 1,
    "page": 2,
    "limit": 20,
    "items": [ /* wahi row envelope jo sections me hai */ ]
  }
}
```

### "See all" kahan bhejein

| Type | Kahan |
|---|---|
| `AREA` | **Yahin** — `?type=AREA`. Aur koi raasta hai hi nahi |
| `BRAND` | `GET /brands/customer/get-all?search=` — wahan filters aur sort presets hain |
| `VOUCHER` | `GET /vouchers/customer/get-all?search=&latitude=&longitude=` |
| `CATEGORY` · `SUB_CATEGORY` | `GET /categories/getAll?search=` — ya yahin, dono chalega |

Har section apna `seeAll` khud batata hai — app ye table hardcode na kare.

AREA akela type hai jiska apna listing endpoint nahi hai: wo kisi collection ka listing
nahi, live outlets ke addresses ka grouped result hai. Isiliye ye mode maujood hai.

⚠️ `types` (plural — kaunse sections chahiye) aur `type` (singular — mode switch) **alag**
hain. Dono ek saath bhejne pe `422`.

---

## 14c. GET /search/popular

**Access:** 🌐 **Public**

Search box khulte hi dikhne wali chips.

```jsonc
{
  "success": true,
  "message": "Popular searches fetched",
  "data": { "isEnabled": true, "queries": ["pizza", "salon", "weekend offers"] }
}
```

Admin curate karta hai (`PUT /settings/update` → `customer.search.popularQueries`) —
traffic se derive **nahi** hoti. Customer kya search karta hai wo kahin log hi nahi hota,
aur ye endpoint wo shuruaat jaan-boojh kar nahi kar raha.

Mukhya audience guest hai: uski apni recent searches device par hain, to bina iske box
khaali khulta.

⚠️ `isEnabled: false` par bhi `200` aur `queries: []` — `404` nahi. Ek switch band karne se
endpoint gayab hua nahi lagna chahiye, warna app ka generic error handler "kuch toot gaya"
screen dikha dega.

---

## 14d. GET /search/history

**Access:** 🔒 **`isCustomer`**

```jsonc
{
  "success": true,
  "message": "Search history fetched",
  "data": [
    { "_id": "68f5…a1", "query": "pizza", "searchCount": 4, "lastSearchedAt": "2026-09-04T09:12:00.000Z" },
    { "_id": "68f5…a2", "query": "salon", "searchCount": 1, "lastSearchedAt": "2026-09-03T18:40:00.000Z" }
  ]
}
```

| Param | Type | Default | Notes |
|---|---|---|---|
| `limit` | number | `20` | Admin-configurable (`historyLimit`), max 100 |

Newest first. Cap se purani rows har commit ke baad apne aap hat jaati hain.

⚠️ **Khaali history `200` + `[]` hai, `404` nahi** — is doc me baaki list endpoints khaali
pe 404 dete hain (shared `pagination` throw karti hai), par jisne abhi tak kuch search hi
nahi kiya wo bilkul normal haal me hai. Wahan 404 pehle din hi error screen dikha deta.

⚠️ **Guest ko `401` milta hai, khaali list nahi.** Uski history device par hai; khaali array
dena "aapne kuch search nahi kiya" ka daava hota, jo sach nahi. App guest state me ye call
kare hi na.

### History kab likhi jaati hai

Sirf `GET /search?...&commit=true` pe, aur sirf tab jab caller ek live customer ho:

| Caller | `commit=true` pe |
|---|---|
| Signed-in customer | Row upsert — dobara search par nayi row nahi, `searchCount` badhta hai |
| Guest | Kuch nahi, aur koi error bhi nahi |
| Vendor / admin preview | Kuch nahi — unka `Customer` record hota hi nahi |

⚠️ `Pizza`, `pizza` aur `pizza  hut` vs `pizza hut` ek hi row hain.

⚠️ History likhna search ko **kabhi fail nahi karta**. Results jawab hain, history ek side
effect — jo bhi ho jaye, customer ko results milte hain aur error sirf log me jaata hai.

---

## 14e. DELETE /search/history/:historyId · DELETE /search/history

**Access:** 🔒 **`isCustomer`**

```http
DELETE /search/history/68f5a2b3c4d5e6f7a8b9e1f2   → ek entry
DELETE /search/history                            → poori history
```

```jsonc
{ "success": true, "message": "Search history entry removed" }
{ "success": true, "message": "Search history cleared", "data": { "deletedCount": 12 } }
```

### Errors

| Status | Message | Kab |
|---|---|---|
| `404` | `Search history entry not found` | Id nahi mili, **ya kisi aur ki hai**, ya pehle se deleted |
| `422` | `Invalid history id.` | Valid ObjectId nahi |
| `401` | – | Token nahi |
| `403` | – | Customer nahi (vendor/admin token) |

⚠️ Kisi aur ki row par **`404`**, `403` nahi. "Ye hai to sahi, par aapka nahi" khud ek leak
hai — usse pata chal jaata hai ki id asli hai.

⚠️ **Hataya hua term dobara search ho sakta hai** aur nayi row ban jaata hai, count 1 se —
purani count wapas nahi aati. "Maine wo hata diya tha" ka yahi matlab hona chahiye.

⚠️ Pehle se khaali history clear karne par bhi `200` aur `deletedCount: 0`. Customer ne kaha
"meri history hata do" aur history hat chuki hai.

---

# Voucher APIs

Customer ko sirf **`PUBLISHED`** status ke, currently valid (`startAt <= now < endAt`) vouchers dikhte hain, aur wo bhi **location-based** — customer ke coordinates se ek max radius ke andar wale outlets.

**Max distance** platform settings se aata hai (`Setting.vendor.voucher.maxDistanceKm`), fallback **25 km**.

## 15. GET /vouchers/customer/get-all

Nearby vouchers ki paginated list. Home/deals screen ka main feed.

**Access:** 🌐 **Guest bhi** (`optionalAuth`) — token bhejo to personalised, na bhejo to anonymous. Galat token phir bhi reject hota hai

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
| `suggestedOnly` 🆕 | boolean | ❌ | `false` | **Suggestions tab.** `true` → sirf admin ke pin kiye vouchers |
| `sortBy` | string | ❌ | `DISTANCE` | `DISTANCE` \| `NEWEST` \| `EXPIRING_SOON` \| `RELEVANCE` |
| `sortOrder` | string | ❌ | *(preset-wise)* | `asc` \| `desc`. Na do to sortBy ka natural direction |
| `latitude` | number | ❌ | saved location | -90 to 90 |
| `longitude` | number | ❌ | saved location | -180 to 180 |

```http
GET /vouchers/customer/get-all?latitude=22.7533&longitude=75.8937&sortBy=DISTANCE&limit=20
GET /vouchers/customer/get-all?suggestedOnly=true&limit=10
```

### 🆕 Suggestions tab aur "view more" — ek hi endpoint

Admin kuch vouchers ko **suggestions** me pin karta hai. UI do jagah dikhta hai, par API **ek hi** hai:

| UI | Call | Kya milta hai |
|---|---|---|
| **Suggestions tab** | `?suggestedOnly=true` | Sirf pinned, `suggestionOrder` ke order me |
| **View more / main feed** | *(param na bhejein)* | **Sab** vouchers — pinned **upar**, phir baaki |

**Pagination apne aap sahi rehti hai.** Ye do alag lists jodkar nahi banti — ek hi sorted result set hai, jisme `isSuggested` pehle sort key hai. Isliye pinned vouchers page 1 pe upar aate hain aur page 2 pe **dobara nahi** aate. App ko dedupe nahi karna padega.

Har row pe `isSuggested` boolean aata hai — usse badge/highlight kar sakte hain.

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
    "isOutOfRange": false,
    "data": [
      {
        "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
        "name": "flat 30% off on total bill",
        "categoryId": "68f1a2b3c4d5e6f7a8b9c0e1",
        "subCategoryId": "68f1a2b3c4d5e6f7a8b9c0f1",
        "createdAt": "2026-08-10T06:00:00.000Z",
        "bannerType": "IMAGE",
        "bannerUrl": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/vouchers/banner-mocha.jpg",
        "isSuggested": true,
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
          "subBrandId": "68f1a2b3c4d5e6f7a8b9c4a1",
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
| `bannerType` 🆕 | string\|null | `IMAGE` \| `VIDEO` \| `GIF`. Banner na ho to **`null`** — key gayab nahi hoti |
| `bannerUrl` 🆕 | string\|null | Banner ka URL. `bannerType` ke saath hi aata hai — dono `null` ya dono set |
| `isSuggested` 🆕 | boolean | Admin ne pin kiya hai ya nahi. Badge/highlight ke liye |
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
| `400` | `Location is required. Send latitude and longitude, or save an address first.` | Na coordinates bheje, na koi saved address hai. **Guest ke liye normal case** |
| `400` | `Customer location coordinates not found.` | Saved address hai par uska `geo` corrupt/missing |
| `403` | `Invalid or malformed token. Please log in again.` | Token bheja par wo valid nahi. Bina token bilkul theek hai — aadha-adhoora token nahi |
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

**8. 🆕 `bannerType` ke bina `bannerUrl` kabhi nahi aata.** Backend dono ko ek saath resolve karta hai — agar banner ka type set hai par uska media missing hai, to **dono `null`** aate hain. App ko `bannerUrl` ki alag se null-check karne ki zarurat nahi, `bannerType` dekh lena kaafi hai.

**9. 🆕 `isOutOfRange` — sirf Suggestions tab pe matter karta hai.**

Response me ye **top-level** flag hai (`data.isOutOfRange`, rows ke andar nahi):

| Value | Matlab |
|---|---|
| `false` | Normal — sab results max radius ke andar se hain |
| `true` | **Sirf `suggestedOnly=true` pe aata hai.** Customer ke paas koi bhi suggested voucher nahi tha, to backend ne distance limit hata di aur door wale suggested vouchers bhej diye |

Aisa isliye hai ki jis sheher me curated brands abhi pahunche hi nahi, wahan tab bilkul khaali dikhta — jo customer ko toota hua feature lagta hai, geographic baat nahi.

⚠️ **`true` aane pe app ko honest hona chahiye** — "aapke aas-paas nahi hain" jaisa note dikhayein. In vouchers ka `nearestOutlet.distance` bahut bada hoga (100+ km).

**Zaruri:** agar paas me **ek bhi** suggested voucher mil gaya, to door wale **nahi** aayenge aur flag `false` rahega. Geo tabhi ignore hota hai jab tab **poori** khaali ho. Main feed (`suggestedOnly` ke bina) me ye fallback **kabhi nahi** chalta — wo hamesha geo-honest hai.

---

## 16. GET /vouchers/customer/get/:voucherId

Voucher detail screen. Saare offers + saare outlets ke saath.

**Access:** 🌐 **Guest bhi** (`optionalAuth`) — token bhejo to personalised, na bhejo to anonymous. Galat token phir bhi reject hota hai

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
    "bannerType": "VIDEO",
    "bannerUrl": "https://res.cloudinary.com/drvdnqydw/video/upload/v1/vouchers/banner-mocha.mp4",
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
| `400` | `Location is required. Send latitude and longitude, or save an address first.` | Na coordinates, na saved address. **Guest ke liye normal case** |
| `400` | `Customer location coordinates not found.` | Saved address ka `geo` corrupt |
| `403` | `Invalid or malformed token. Please log in again.` | Token bheja par valid nahi |
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

**Access:** 🌐 **Guest bhi** (`optionalAuth`) — token bhejo to personalised, na bhejo to anonymous. Galat token phir bhi reject hota hai

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
| `billAmount` | number | ✅ | Positive (> 0), max 2 decimals. `Setting.customer.claim.maxBillAmount` (default ₹1,00,000) se upar → **422** |
| `offerId` 🆕 | ObjectId | ❌ | Customer ka apna chunaav. Na bhejein to sabse achha offer khud lag jaata hai |
| `promoCode` 🆕 | string | ❌ | 3–40 chars, `A-Z 0-9 _ -`. `""` ya `null` bhejna "koi code nahi" hai |

```json
{
  "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
  "outletId": "68f1a2b3c4d5e6f7a8b9c4a1",
  "billAmount": 1200,
  "promoCode": "WELCOME50"
}
```

### 🆕 `offerId` — jab customer khud offer chunta hai

Kuch na bhejein to backend bill ke hisaab se **sabse achha** offer chun leta hai (barabari par zyada `minBillAmount` wala jeetta hai).

Naam lene par baat badal jaati hai: **unka chunaav chalta hai**, chahe doosra offer zyada faayda de raha ho. Aur agar wo offer lag hi nahi sakta to **422** aata hai apni wajah ke saath — koi doosra offer chupke se nahi lagta, kyunki tab screen aur charge alag-alag cheez keh rahe hote.

| Wajah | Message |
|---|---|
| Us voucher ka offer hi nahi | `That offer is not available on this voucher.` |
| Band ya delete ho chuka | `That offer is no longer available.` |
| Pehle se istemal (ONCE_PER_USER) | `You have already used this offer.` |
| Bill chhota hai | `This offer needs a bill of at least ₹1,000.` |

> **ONCE_PER_USER offer jo customer pehle use kar chuka hai wo list me aata hi nahi.** Warna unhe aisa daam dikhta jo unhe mil hi nahi sakta, aur payment par 409 milta.

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
    "offerApplied": true,
    "selectedOffer": {
      "offerId": "68f1a2b3c4d5e6f7a8b9c2d1",
      "title": "30% off above 500",
      "discountType": "PERCENTAGE",
      "discountValue": 30,
      "minBillAmount": 500,
      "maxDiscountAmount": 300,
      "usageType": "ONCE_PER_USER",
      "discountApplicableOn": "SUBTOTAL",
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
        "usageType": "ONCE_PER_USER",
        "discountApplicableOn": "SUBTOTAL",
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
        "usageType": "MULTIPLE",
        "discountApplicableOn": "FINAL_BILL",
        "discountAmount": 150,
        "finalAmount": 1050
      }
    ],
    "brand": {
      "id": "68f1a2b3c4d5e6f7a8b9c1a1",
      "name": "postman cafe mocha",
      "isApproved": true
    },
    "pricing": {
      "currency": "INR",
      "billAmount": 1200,
      "offerId": "68f1a2b3c4d5e6f7a8b9c2d1",
      "offerTitle": "30% off above 500",
      "offerDiscount": 300,
      "promoCode": "WELCOME50",
      "promoAppliesTo": "NET_BILL",
      "promoBase": 900,
      "promoDiscount": 50,
      "vendorPromoCost": 15,
      "platformPromoCost": 35,
      "netBill": 900,
      "convenienceFee": 15,
      "isGstEnabled": false,
      "taxType": null,
      "gstAmount": 0,
      "taxOnTop": 0,
      "totalPayable": 865,
      "amountInPaise": 86500,
      "youSaved": 350,
      "vendorPayable": 885,
      "commissionPercent": 0,
      "commissionAmount": 0,

      "discountAmount": 300,
      "payableAmount": 865,
      "totalSavings": 350
    },
    "orderSummary": {
      "rows": [
        { "key": "BILL_AMOUNT", "label": "Bill Amount", "amount": 1200, "display": "₹ 1,200.00" },
        { "key": "OFFER_DISCOUNT", "label": "Voucher discount (30% off above 500)", "amount": -300, "display": "- ₹ 300.00" },
        { "key": "PROMO_DISCOUNT", "label": "Promo code (WELCOME50)", "amount": -50, "display": "- ₹ 50.00" },
        { "key": "NET_BILL", "label": "Bill after discount", "amount": 900, "display": "₹ 900.00" },
        { "key": "CONVENIENCE_FEE", "label": "Convenience fee", "amount": 15, "display": "+ ₹ 15.00" }
      ],
      "payable": { "label": "You'll Pay", "amount": 865, "display": "₹ 865.00" },
      "youSaved": 350,
      "youSavedDisplay": "₹ 350.00",
      "savedText": "You saved ₹ 350.00 on this bill"
    },
    "promo": {
      "supported": true,
      "applied": {
        "code": "WELCOME50",
        "description": "Welcome offer",
        "discount": 50,
        "appliesTo": "NET_BILL"
      },
      "provisional": false,
      "message": "Promo code WELCOME50 applied"
    },
    "canClaim": true,
    "blockedReason": null,
    "requiresLogin": false,
    "notices": []
  }
}
```

### ⚠️ Teen naam badle hain — purane abhi bhi aa rahe hain

`pricing` block is phase me poora likha gaya hai. Teen fields ke naam badle:

| Purana | Naya |
|---|---|
| `discountAmount` | `offerDiscount` |
| `payableAmount` | `totalPayable` |
| `totalSavings` | `youSaved` |

**Purane teeno naam response me abhi bhi hain** — wahi number, dono naam se — taaki chalu app na toote. Par wo **deprecated** hain aur app ke shift hone ke baad hata diye jayenge. Naye naam par aa jaayein.

> Store sirf naye naam hote hain. Purane sirf response me echo hote hain.

### 🆕 `canClaim` / `blockedReason` — do tarah ki "nahi"

Ye **error se alag cheez** hai, jaan-boojh kar:

- **Error (4xx)** tab jab request hi galat ho — anjaan voucher (404), outlet linked nahi (400), bill cap se upar (422), aisa `offerId` jo lag nahi sakta (422). Render karne ko kuch hai hi nahi.
- **`canClaim: false` + `blockedReason`** tab jab request theek ho par jawab "nahi" ho — brand approved nahi, vendor ka plan lapse, saare offers pehle use ho chuke. **Page phir bhi voucher aur daam dikhata hai**, bas button disabled aur wajah saath me.

| `blockedReason` | Kab |
|---|---|
| `Voucher claims are temporarily unavailable. Please try again later.` | `Setting.customer.claim.isEnabled: false` |
| `This brand is not accepting claims right now.` | Brand inactive / unapproved / deleted, **ya** vendor ka plan lapse |
| `You have already used every offer on this voucher.` | Saare offers ONCE_PER_USER the aur sab consume ho chuke |

> Brand ki andaruni haalat (unapproved? plan lapse?) customer ko nahi batayi jaati — teeno ka ek hi vaakya hai.

### 🆕 `orderSummary` — client koi hisaab na kare

Har row me `key` · `label` · `amount` · `display` chaaron hote hain, aur `display` **pehle se format** hai (`₹ 2,50,000.00` — bharatiya grouping). Zero wali rows aati hi nahi: `- ₹ 0.00` shor hai aur usse lagta hai kuch laga aur shoonya nikla.

`savedText` `null` hota hai jab kuch bacha hi na ho, taaki "You saved ₹ 0.00" ka banner na dikhe.

### 🆕 `promo` — soft yahan, strict order par

| Field | Matlab |
|---|---|
| `supported` | `Setting.customer.promoCode.isEnabled` — **default `true`** 🆕 |
| `applied` | Laga to `{ code, description, discount, appliesTo }`, warna `null` |
| `provisional` | **Guest ke liye `true`** — neeche padhein |
| `message` | Laga to confirmation, warna **wajah** |

Preview par galat code **error nahi** hai — `message` me wajah aati hai taaki Apply button ke paas inline dikha sakein. **Order creation par wahi wajah 422 ban jaati hai**, kyunki jis code ko customer laga hua samajh raha hai uspar chupchaap poora daam le lena theek nahi.

**`appliesTo`** batata hai discount kis cheez se kata: `NET_BILL` (offer ke baad ka bill) ya `CONVENIENCE_FEE`. Discount hamesha **usi base par clamp** hota hai — ₹10 ki fee par ₹50 ka fee-code ₹10 hi hai, ₹50 nahi.

### 🆕 Guest + promo code — `provisional: true`

Guest ki koi pehchaan nahi, isliye `perCustomerUsageLimit` aur `firstOrderOnly` check ho hi nahi sakte. Mana karne ke bajaye discount **indicative** dikhaya jaata hai:

```jsonc
"promo": { "applied": { "code": "WELCOME50", "discount": 50 }, "provisional": true }
```

`notices[]` me bhi line aati hai: *"Log in to confirm this promo code before paying."*

Login ke baad order creation par **dobara validate** hota hai. Wahan fail ho to **422 wajah ke saath** — chupchaap poora daam nahi.

### 🆕 `pricing` — checkout screen ki rows

Ye block seedha render karne ke liye hai. **App ko koi arithmetic nahi karni** — backend already total kar chuka hai.

| Field | Type | Notes |
|---|---|---|
| `billAmount` | number | Jo user ne enter kiya |
| `offerDiscount` | number | `selectedOffer` ka discount. Koi offer na lage to `0` |
| `promoDiscount` | number | Promo code ka discount — **ab live hai** |
| `netBill` | number | `billAmount − offerDiscount`. **Vendor ki supply** |
| `convenienceFee` | number | Neeche slab table. **Original bill** par lagti hai |
| `taxOnTop` | number | Fee par GST, sirf jab GST on ho. Inclusive mode me `0` |
| `totalPayable` | number | `netBill − promoDiscount + convenienceFee + taxOnTop`. **Yahi charge karna hai** |
| `amountInPaise` | number | Wahi total integer paise me — Razorpay ko yahi jaata hai |
| `youSaved` | number | `offerDiscount + promoDiscount` |
| `vendorPayable` | number | Vendor ko kitna milega. **Fee isme kabhi nahi aati** |
| `taxType` | string\|null | `CGST_SGST` \| `IGST` \| `null` jab GST band ho |
| `cgst` `sgst` `igst` `gstAmount` | number | Tax ka breakup. `cgst + sgst === gstAmount`, hamesha |
| `sacCode` | string\|null | Invoice par |
| `commissionPercent` `commissionAmount` | number | **Abhi `0`.** Claim ke waqt freeze hote hain taaki baad me rate badle to purane claims par retroactive na lage |

> Sab values 2 decimal places pe rounded hain.

**GST abhi band hai** (`Setting.customer.tax.isGstEnabled: false`), isliye `taxType: null` aur `orderSummary` me koi tax row nahi. On hone par tax **sirf convenience fee** par lagega — `netBill` vendor ki supply hai aur unka apna tax maamla; uspar tax lena kisi aur ki sale par tax lena hota.

### 🆕 Convenience fee — slabs

Har **₹500** (ya uska part) pe **₹5**. Fee **original bill** pe lagti hai, discount ke baad wale amount pe nahi — isse fee stable rehti hai chahe koi bhi offer chune:

| Bill amount | Fee |
|---|---:|
| ₹1 – ₹500 | ₹5 |
| ₹501 – ₹1000 | ₹10 |
| ₹1001 – ₹1500 | ₹15 |
| ₹1501 – ₹2000 | ₹20 |
| … har agle ₹500 pe | +₹5 |

Formula: `ceil(billAmount / 500) × 5`

**Ye hardcoded nahi hai** — `Setting.customer.convenienceFee` se aata hai (`isEnabled`, `slabSize`, `feePerSlab`, `maxFee`). Admin slab size ya per-slab amount badal sakta hai, ya poori fee band kar sakta hai. Upar wale numbers defaults hain. **App ko fee calculate nahi karni — `pricing.convenienceFee` hi use karein.**

⚠️ **Koi offer apply na ho to fee bhi `0`.** Customer sirf apna bill pay karega — warna wo Trydood ke bina jitna deta usse **zyada** de raha hota. Admin `convenienceFee.chargeWhenNoOffer` se ise on kar sakta hai; tab `notices[]` me saaf likha aata hai ki bina offer ke bhi fee lagi hai.

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

### 🆕 Koi offer valid na ho to — ab error **nahi**

Pehle jab bill kisi bhi offer ke `minBillAmount` se kam hota tha, to `400 "No eligible offer found for this bill amount."` aata tha. **Ab wo error nahi aata.** Response `200` hi hota hai, bas offer applied nahi hota:

```json
{
  "success": true,
  "message": "Voucher preview calculated successfully.",
  "data": {
    "voucher": { "id": "68f1a2b3c4d5e6f7a8b9c2a1", "name": "flat 30% off on total bill" },
    "version": { "id": "68f1a2b3c4d5e6f7a8b9c2b1", "versionNumber": 3 },
    "outlet":  { "id": "68f1a2b3c4d5e6f7a8b9c4a1", "uniqueId": "TDS000201" },
    "billAmount": 300,
    "offerApplied": false,
    "selectedOffer": null,
    "eligibleOffers": [],
    "pricing": {
      "billAmount": 300,
      "discountAmount": 0,
      "promoDiscount": 0,
      "convenienceFee": 0,
      "payableAmount": 300,
      "totalSavings": 0
    }
  }
}
```

**Customer sirf apna bill pay karega** — koi offer nahi, koi promo nahi, **koi convenience fee nahi**.

Ye do case me hota hai:
1. Bill har offer ke `minBillAmount` se kam hai (bill ₹300, offer ₹500 se shuru)
2. Voucher version me koi offer hai hi nahi

**App ka kaam:** `offerApplied` check karein. `false` ho to offer wala section chhupa dein aur seedha `pricing.payableAmount` dikhayein. Chahein to nudge dikha sakte hain — *"₹500 se upar ke bill pe 30% off milega"* — kyunki offers ka `minBillAmount` endpoint #16 se already pata hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid voucher ID.` | ObjectId format |
| `400` | `Invalid outlet ID.` | ObjectId format |
| `404` | `Voucher not found.` | Voucher exist nahi karta ya inactive |
| `400` | `Voucher is not currently available.` | Koi `PUBLISHED` version nahi jo abhi valid ho |
| `400` | `Selected outlet is not linked with this voucher.` | Outlet is version se mapped nahi |
| `400` | `Selected outlet is currently unavailable.` | Outlet inactive/deleted |
| `400` | `Valid bill amount is required.` | Amount ≤ 0 ya non-numeric. **Ye ab bhi error hai** — malformed input hai, business case nahi |
| `422` | `Voucher ID is required.` / `Outlet ID is required.` / `Bill amount is required.` | Missing fields |
| `422` | `Bill amount must be greater than zero.` | Negative/zero |

> 🔄 **v1.3.0 me hate:** `No offers available for this voucher.` aur `No eligible offer found for this bill amount.` — dono ab `200` + `offerApplied: false` dete hain.

### ⚠️ Edge cases & notes

**1. Ye endpoint kuch save nahi karta** — pure calculation hai. Koi redemption record nahi banta, koi usage count nahi badhta. Baar-baar call kar sakte hain.

**2. 🆕 `FIXED` discount type ab kaam karta hai.** Pehle enum me tha par calculation me handle nahi tha — aisa offer `0` discount deta tha aur eligible list se filter ho jaata tha, jisse user ko lagta tha ki uska bill galat hai. Ab `FLAT` ka alias hai. `PERCENTAGE`, `FLAT`, `FIXED` — teeno valid hain.

**3. Location check nahi hota.** Baaki voucher endpoints radius check karte hain, ye nahi. Matlab 100 km door ke outlet ka preview bhi mil jayega. Frontend ko outlet selection #16 ke `outlets` list se hi karna chahiye.

**5. Sirf latest `PUBLISHED` version use hota hai** (highest `versionNumber` jo abhi valid ho). Purane versions ignore.

**6. Rounding:** `discountAmount` aur `finalAmount` 2 decimal places pe rounded. `billAmount` bhi response me rounded aata hai.

**7. `discountApplicableOn` calculation me use nahi hota.** Backend seedha `billAmount` pe discount lagata hai, `SUBTOTAL` vs `FINAL_BILL` distinction ignore hota hai. Ye field sirf display/terms ke liye hai.

---

# Voucher Claim APIs 🆕

Preview (#17) ke baad ka poora raasta: order kholna, payment confirm karna, aur invoice.

> **Preview guest ke liye bhi hai, order nahi.** Guest ko daam dikhta hai — wo app store ki zaroorat hai — par order kholne ke liye login chahiye. Preview ka `requiresLogin: true` yahi batata hai.

## 17a. POST /voucher-claims/create-order

Razorpay order kholta hai. Iske baad app Razorpay checkout uthata hai aur band hone par #17b call karta hai.

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `application/json` | ✅ |
| `Idempotency-Key` | Koi bhi unique string | ⚠️ **Bhejein** — neeche padhein |

### ⚠️ `Idempotency-Key` — do tap, ek order

Header na bhejein to bhi reuse window (10 min) zyadatar case bacha leti hai. Par **do tap ek hi pal me** — do baar dabana, ya do tab — dono reuse check paas kar jaate hain aur customer ko **ek bill ke liye do payment sheet** dikhte hain.

Key bhejne par server use Razorpay call se **pehle** insert karta hai, aur unique index tay karta hai kaun aage badhega. Haarne wale ko error nahi milta — usi order ka jawab milta hai, `reused: true` ke saath.

**App ka kaam:** ek claim attempt ke liye key ek baar banayein aur **retry par wahi bhejein**. Har retry par nayi key banane se poora mechanism bekaar ho jaata hai.

### Body
Bilkul wahi jo preview (#17) leta hai — jaan-boojh kar. Order creation wahi builder chalata hai, aur ek field jo ek jagah maani jaye aur doosri jagah gir jaye uska matlab hai customer ko kuch aur dikha aur kuch aur cut gaya.

| Field | Type | Required |
|---|---|---|
| `voucherId` | ObjectId | ✅ |
| `outletId` | ObjectId | ✅ |
| `billAmount` | number | ✅ |
| `offerId` | ObjectId | ❌ |
| `promoCode` | string | ❌ |

```json
{
  "voucherId": "68f1a2b3c4d5e6f7a8b9c2a1",
  "outletId": "68f1a2b3c4d5e6f7a8b9c4a1",
  "billAmount": 1200,
  "promoCode": "WELCOME50"
}
```

### Success — `201` (naya) ya `200` (reused)
```jsonc
{
  "success": true,
  "message": "Claim order created successfully.",
  "data": {
    "claim": {
      "id": "68f1a2b3c4d5e6f7a8b9e001",
      "claimCode": "TD-8F3K2Q",
      "status": "PENDING"
    },
    "transaction": { "id": "68f1a2b3c4d5e6f7a8b9e101", "status": "created" },

    "voucher": {}, "version": {}, "outlet": {}, "brand": {},
    "billAmount": 1200,
    "offerApplied": true,
    "selectedOffer": {},
    "pricing": {},        // #17 wala hi block
    "orderSummary": {},
    "promo": {},

    "razorpay": {
      "orderId": "order_PxAbC123",
      "amount": 86500,     // paise. Checkout ko yahi jaata hai
      "currency": "INR",
      "keyId": "rzp_live_xxxxxxxx"
    },
    "reused": false
  }
}
```

**`reused: true` ka matlab** — ye order pehle se khula tha (wahi key, ya reuse window). Response ka aakaar bilkul wahi hai, isliye app ko koi alag branch nahi likhni: dono case me `razorpay` block uthaकर checkout khol dijiye.

**`claimCode`** abhi se mil jaata hai, payment se pehle. Support ke liye customer ke paas quote karne ko kuch hota hai chahe payment beech me atki ho.

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | Access Denied! Missing authorization token | Guest |
| `403` | *(preview ka `blockedReason`)* | Brand approved nahi, vendor ka plan lapse, saare offers use ho chuke |
| `409` | `You already have a claim in progress for this offer. Finish or cancel it first.` | ⚠️ Neeche |
| `422` | `This claim has no payable amount. Please check the bill.` | Promo ne total zero kar diya |
| `422` | *(promo ki wajah)* | `strictPromo` — preview par soft tha, yahan 422 |
| `422` | *(offer ki wajah)* | Naam liya hua offer lag nahi sakta |
| `503` | Razorpay services unavailable! Please try again later. | Gateway down — claim rollback ho jaata hai |

> **409 ke baare me:** ONCE_PER_USER offer par ek hi khula claim ho sakta hai, aur wo slot claim **bante hi** lag jaata hai — payment ka intezaar nahi karta. Warna do checkout ek saath khule rehte, koi kuch pakde nahi hota, aur dono nikal jaate. Customer ko purana claim poora karna ya chhodna padega (10 min me sweep khud band kar deti hai).

---

## 17b. POST /voucher-claims/verify

Razorpay checkout band hone par uska callback yahan bhejein.

**Access:** 🔒 **CUSTOMER only** + ownership

### Body
| Field | Type | Required |
|---|---|---|
| `razorpayOrderId` | string | ✅ |
| `razorpayPaymentId` | string | ✅ |
| `razorpaySignature` | string | ✅ |
| `transactionId` | ObjectId | ✅ |

### Success — `200`
```jsonc
{
  "success": true,
  "message": "Payment confirmed successfully.",
  "data": {
    "alreadySettled": false,
    "alreadyVerified": false,
    "claim": { "status": "REDEEMED", "claimCode": "TD-8F3K2Q" },
    "transaction": {},
    "ledger": { "posted": 5, "duplicates": 0 },
    "promo": { "code": "WELCOME50", "discount": 50 }
  }
}
```

### ⚠️ `alreadyVerified: true` **safalta hai**

Webhook aur ye callback **har payment par** milliseconds ke faasle par chalte hain. Jo jeet jaye wo settle karta hai; doosre ko `alreadyVerified: true` milta hai.

**App ka kaam:** `alreadyVerified` par bhi success screen dikhayein. Use error samajhna sabse aam galti hai — payment ho chuki hai.

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | Invalid signature. Payment may be tampered. | |
| `403` | You are not authorized to confirm this payment. | Kisi aur customer ki payment |
| `404` | Payment not found. | Galat `transactionId`, ya wo subscription payment hai |
| `422` | This payment does not belong to the given order. | |
| `422` | This payment belongs to a different order. | Razorpay ka `order_id` mel nahi khaata |
| `422` | The amount paid does not match this claim. Please contact support. | |
| `402` | *(gateway ki wajah)* | Payment capture hi nahi hui — claim FAILED, slot chhoot gaya |

---

## 17c. GET /transactions/invoice/:token

Invoice download. **Public — koi JWT nahi.**

Link WhatsApp message aur email se khulta hai, jahan browser me koi session hota hi nahi. Login maangna matlab Download button kaam na kare, jo uska ekmatra kaam hai. **32-byte random token hi credential hai.**

`302` redirect deta hai asli PDF par.

| Status | Kab |
|---|---|
| `302` | Theek — `Location` header par PDF |
| `404` | Token galat hai ya hai hi nahi. **Dono ka ek hi jawab** — "lagbhag sahi" batana guessing ko raasta dikhana hai |
| `409` | Settle abhi invoice stage tak pahuncha nahi. Kuch minute me phir |

**PDF pehli request par banti hai** aur uske baad cache hoti hai. Invoice **number** phir bhi settle par hi mil jaata hai, taaki series me gap na aaye.

> **GST band hai to document `PAYMENT RECEIPT` kehlata hai, `TAX INVOICE` nahi**, aur koi tax row nahi chhapti. Bina tax wale document par "TAX INVOICE" chhapna galat hai. Aur bill ki line kehti hai *"Bill collected on behalf of \<Brand\>"* — khana Trydood ne nahi becha, vendor ne becha aur humne unke liye wasoola.

---

## 17d. GET /voucher-claims — meri claims

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`)

**"Maine kya khareeda"** — order history. *"Kaunsa paisa hila"* ke liye #17e.

### ⚠️ Ek endpoint, teen shapes

Ye URL customer, vendor, outlet aur admin — sabke liye ek hi hai. **Scope aur projection
dono token se nikalte hain**, isliye har koi apna jawab paata hai. App ko role ke hisaab
se alag URL nahi chunna:

| Field | Customer | Vendor / Outlet | Admin |
|---|:-:|:-:|:-:|
| `pricing.convenienceFee` | ✅ | — | ✅ |
| `pricing.vendorPayable` · `pricing.netBill` | — | ✅ | ✅ |
| `pricing.platformPromoCost` | — | — | ✅ |
| `customerId` | ✅ (apna) | — | ✅ |
| `refundAmount` · `refundedAt` | ✅ | — | ✅ |

### Query
| Param | Default | Notes |
|---|---|---|
| `page` / `limit` | `1` / `20` | `limit` max **100** |
| `status` | – | `PENDING · PAID · REDEEMED · FAILED · CANCELLED · EXPIRED · REFUNDED` |
| `claimCode` | – | Poora code |
| `brandId` / `outletId` / `voucherId` | – | Narrow karne ke liye |
| `from` / `to` | – | ISO date. `to` **poora din** include karta hai (23:59:59) |

### Snapshots — join nahi

`voucherSnapshot`, `brandSnapshot`, `outletSnapshot` claim banate waqt **freeze** hote hain.
September ki claim March me bhi sahi padhti hai — voucher republish ho chuka ho aur outlet
ka naam badal chuka ho, tab bhi. Jo dikhaya gaya tha wahi dikhta rahega.

### ⚠️ Scope query se chaudi nahi ho sakti

Filter aur scope **intersect** hote hain. Vendor `?brandId=<dusra brand>` bheje to **kuch
nahi** milta — apne rows nahi.

> Pehle scope filter ke **upar** lagta tha. Surakshit tha (vendor dusra brand kabhi nahi
> dekhta), par chup: use apne hi rows waapas milte the, jo bilkul aisa lagta hai jaise
> filter chala ho. Koi us par report bana leta aur pata tab chalta jab numbers par sawaal
> uthta.

### Khaali list `200` hai, `404` nahi

Jis customer ne kuch khareeda hi nahi uski history **khaali** hai, gayab nahi:

```json
{ "success": true, "message": "Claims fetched successfully.", "data": { "total": 0, "totalPages": 0, "page": 1, "limit": 20, "data": [] } }
```

404 pehli baar app kholne par error screen dikha deta — ek bilkul sahi jawab ke liye.

---

## 17e. GET /voucher-claims/payments — mere payments

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`)

Wahi teen-shape niyam. Ye **"kaunsa paisa hila"** hai.

`status` yahan **payment** ki vocabulary hai — `created · authorized · captured · failed` —
claim ki nahi. Baaki query params #17d jaise.

| Field | Customer | Vendor / Outlet | Admin |
|---|:-:|:-:|:-:|
| `voucher.convenienceFee` | ✅ | — | ✅ |
| `voucher.vendorPayable` | — | ✅ | ✅ |
| `gatewayFee` · `netReceived` | — | — | ✅ |
| `voucher.platformPromoCost` | — | — | ✅ |
| `email` · `contact` | ✅ (apna) | — | ✅ |

> Vendor ko `gatewayFee` **kabhi nahi** — Razorpay ne humse kya liya wo commercial
> disclosure hai. `email` / `contact` bhi nahi — wo privacy hai. Dono ek hi document par
> hain, isiliye faisla `claimProjection()` me **ek jagah** hota hai.

`purpose` se scope hai, isliye ek galat filter bhi kabhi **subscription** payment nahi
dikha sakta — ek hi collection dono flows rakhti hai.

---

## 17f. GET /voucher-claims/payments/:transactionId — ek payment

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`)

**Push notification ka deep link yahin utarta hai.**

### Response
```jsonc
{
  "payment": { /* wahi projection jo #17e deti hai */
    "invoiceDownloadUrl": "https://api.trydood.com/trydood/v1/transactions/invoice/<token>"
  },
  "claim":   { /* judi hui claim, frozen snapshots ke saath */ },
  "brand":   { "brandName": "cafe mocha", "logo": "https://…" },
  "outlet":  { "storeId": "T-01", "uniqueId": "…", "address": "…" },
  "viewer":  { "role": "CUSTOMER", "scope": "OWN", "canSeePlatformCosts": false, "canSeeCustomerContact": true }
}
```

- **`claim` saath aata hai** kyunki akela payment sirf ek raqam aur ek timestamp hai —
  customer ko wo dekhna hai *jo usne khareeda*: voucher ka naam, outlet, claim code
- **`viewer`** batata hai caller kya render kar sakta hai. App ko *"main vendor hoon kya?"*
  ka andaza field ki maujoodgi se nahi lagana chahiye — pehli baar hi galat hoga jab koi
  field jayaz taur par khaali ho
- **`invoiceDownloadUrl`, token nahi.** Token PDF ka bina-auth bearer credential hai; bana
  hua URL hi uska poora istemaal hai. Token bhi bhejna client ko ek aur cheez de deta hai
  jo leak ho sake
- `PUBLIC_API_URL` set na ho to **link aata hi nahi** — kahin na jaane wala Download
  button na hone se bura hai. Vendor ko bhi nahi milta: customer ka tax invoice customer
  ke apne details rakhta hai

### Errors
| Status | Kab |
|---|---|
| `404` | Id galat **ya** row kisi aur ka. **Dono ka ek hi jawab** — *"aap ise nahi dekh sakte"* kehna prober ko bata deta hai ki row hai |
| `403` | Dusre brand ka, ya sub-vendor ke liye dusre outlet ka |
| `422` | Malformed id |

⚠️ **Subscription payment yahan nahi khulta.** `purpose` scope ke bina ye endpoint vendor
ka apna billing row khol deta — dusre Razorpay account ka, aur aisi projection se jo voucher
claim ke liye bani hai. **Id ka unique hona iska jawab nahi hai.**

---

## 17g. GET /voucher-claims/:claimId — ek claim, timeline ke saath

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`)

### Response
`claim` · `payment` · `brand` · `outlet` · **`timeline`** · `viewer`

```jsonc
"timeline": [
  { "at": "2026-08-20T10:00:00Z", "action": "CLAIM_CREATED",    "label": "Voucher claim started", "toStatus": "PENDING", "by": "CUSTOMER", "amount": 810 },
  { "at": "2026-08-20T11:00:00Z", "action": "PAYMENT_CAPTURED", "label": "Payment received",      "fromStatus": "PENDING", "toStatus": "PAID", "by": "SYSTEM", "amount": 810 },
  { "at": "2026-08-20T12:00:00Z", "action": "REDEEMED",         "label": "Redeemed at the outlet","fromStatus": "PAID", "toStatus": "REDEEMED", "by": "VENDOR" }
]
```

**Purani pehle** — timeline aage se padhi jaati hai. Listing ulti hai, kyunki list me
sabse naya khoja jaata hai.

### ⚠️ Timeline **banayi** jaati hai, chhaani nahi

`VoucherClaimHistory` append-only hai aur jaan-boojhkar **poori** — jo us waqt mayne rakhta
tha wo sab, forensics ke liye. Wahi poornata wajah hai ki use jaisa ka taisa page par nahi
bheja ja sakta:

| Field | Kyun nahi | Kise milta hai |
|---|---|---|
| `snapshot` | `Mixed` hai; aaj `CLAIM_CREATED` par **poora pricing block** rakhta hai, `platformPromoCost` samet | Sirf admin |
| `reason` | Staff ne **staff ke liye** likha free text. *"Refunded, customer disputes the bill"* wo vaakya nahi hai jo usi customer ko dikhaya jaaye | Sirf admin |
| `performedBy` | Aadmi ki id. `by` (role) kaafi hai — *"expiry job ne kiya"* asli jawab hai aur sensitive nahi | Sirf admin |
| `PROMO_RELEASED` row | Hamari apni budget bookkeeping, internal cost split naam leti hai | Sirf admin |

Kaccha row bhejne ka matlab hota vendor ko hamara margin **pichhle darwaze se** dena — us
projection ko paar karke jo use rokne ke liye bani hai. Aur aage jo bhi field koi call site
`snapshot` me daal de, uske saath bhi wahi hota rehta.

Isliye har row **banayi** jaati hai: `label` · `at` · `fromStatus` → `toStatus` · `by`.
Audit trail me kal juda field default roop se **adrishya** hai, default roop se ujaagar nahi.

---

## 17h. GET /voucher-claims/code/:claimCode — code se kholo

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`)

Wahi service jo #17g chalati hai — isliye ek hi access rule dono par.

Code hi wo cheez hai jo **asli duniya me maujood** hai: screen par chhapa, bolkar padha,
counter par type kiya. Sirf ObjectId lene wala surface outlet ko pehle search karne par
majboor karta — matlab dusra endpoint aur access rules ka dusra set galat hone ke liye.

⚠️ **Code lookup ko narrow karta hai, authorise nahi karta.** Kisi aur ki screen se padha
gaya code bhi kuch nahi kholta — access wahi check hota hai.

### Code ka alphabet

`TD-` + 6 characters `34679ACDEFGHJKMNPQRTUVWXY` me se. `0/O`, `1/I/L`, `5/S`, `2/Z`, `8/B`
**jaan-boojhkar chhode gaye hain** — ye code log counter par ek dusre ko bolkar padhte hain.

Isliye galat character wale code par jawab **`422` "mistyped character"** hai, `404` nahi —
404 lagta hai claim maujood hi nahi.

---

# Refund APIs 🆕

Grahak maange → **outlet tay kare** → Trydood paisa nikaale.

> **Trydood normal raaste par doosra gate nahi hai.** Outlet approve kare, hum bas
> paisa chhod dete hain. Outlet ki *"na"* palatna alag raasta hai — likhit wajah ke
> saath, aur alag se gina jaata hai.

## 17i. POST /refunds — refund maango

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

### Body
| Field | Zaroori | Notes |
|---|:-:|---|
| `claimId` | ✅ | |
| `amount` | — | **Na do to poora.** Jo figure server ko pehle se pata hai use dobara type karana hi use galat type karane ka tareeka hai |
| `reason` | ✅ | `NOT_HONOURED · OUTLET_CLOSED · WRONG_AMOUNT · SERVICE_ISSUE · DUPLICATE_PAYMENT · CHANGED_MIND · OTHER` |
| `reasonNote` | — | `OTHER` ke saath **zaroori** |

### Window

`refund.windowHours` (default **24**) — **payment se**, claim banne se nahi. Ek ghante
chhoda hua checkout phir pay ho to uski window grahak ke paisa dene se *pehle* shuru ho
jaati, jo galat hai.

### Kitni baar maang sakte hain

| Setting | Default | Kya |
|---|---|---|
| `maxOpenRequests` | 1 | Ek saath kitni khuli (sab claims milakar) |
| `maxRejectedPerWindow` | 3 | Rolling window me kitni **thukrai / wapas li** |
| `requestWindowDays` | 30 | Window |

⚠️ **Approve hui refunds kabhi nahi gintin.** Jiski 5 refunds approve hui, uske saath 5
baar sach me bura hua — uski chhathi rokna theek usi ko saza dena hai jiske liye ye
vyavastha bani hai.

Limit chhoo jaaye to `422`, aur jawab **support par bhejta hai, raasta band nahi karta**:
*"We are not able to take this refund request automatically. Please write to support and
we will look at it ourselves."* Koi aarop nahi — *"aapka account flagged hai"* par grahak
kuch kar hi nahi sakta.

### Do tap, ek request

`(transactionId, isOpen)` par unique index faisla karta hai. Haarne wale ko **wahi**
request milti hai `reused: true` ke saath — grahak ki taraf se nateeja ek hi hai, usne
ek baar maanga.

### Errors
| Status | Kab |
|---|---|
| `403` | Kisi aur ki claim |
| `422` | Window beet gayi · claim `cancelled`/`refunded` · rakam paid se zyada · `OTHER` bina note · allowance khatam |
| `404` | Claim maujood nahi |

---

## 17j. PATCH /refunds/:requestId/withdraw — wapas le lo

**Access:** 🔒 **CUSTOMER only**

`REQUESTED`, `VENDOR_APPROVED` ya `VENDOR_TIMEOUT` tak. Uske baad **nahi** — `PROCESSING`
ka matlab paisa Razorpay ke paas hai aur wapas lene ko kuch hai hi nahi. Aisi cancellation
maan lene se behtar hai keh dena jo hogi hi nahi.

⚠️ Wapas lena bhi allowance me **ginta hai**: raise → outlet dekhe → withdraw → phir raise,
ye outlet ko vyast rakhne ka tareeka hai bina kabhi rejection kamaye. Ek baar wapas lena
kuch nahi; paanch baar wahi pattern hai.

---

## 17j-1. PATCH /refunds/:requestId/bank-account — failed refund kahan bheju 🆕

**Access:** 🔒 **CUSTOMER only** (`isCustomer`) + ownership

Jab paisa **usi raaste se wapas nahi ja sakta** — band card, deactivated UPI — tab
customer batata hai kahan bheja jaaye.

```jsonc
// PATCH /refunds/68f2.../bank-account
{ "bankAccountId": "68f3a1..." }
```

### Ye endpoint kyun hai

`SOURCE` refund band pade instrument par **har baar** fail hota hai, aur is se pehle
admin ke paas doosra button hi nahi tha. Request `FAILED` par baithi rehti thi,
**vendor ka paisa hold me phansa rehta tha, aur grahak ko uska kabhi milta hi nahi** —
teen taraf se ek saath atka hua, aur teeno me se kisi ko koi error nahi dikhta tha.

### Sirf ek hi status par chalta hai

| Refund ka status | Kya hota hai |
|---|---|
| `AWAITING_BANK_DETAILS` | ✅ Account jud jaata hai, status `ADMIN_APPROVED` ho jaata hai |
| Koi bhi doosra | `409` — *"This refund is … and is not waiting for bank details."* |

`AWAITING_BANK_DETAILS` par pahunchne ke liye admin ko pehle `SOURCE` fail dekhna aur
`PATCH /refunds/admin/:requestId/request-bank-details` maarna padta hai. Customer ise
khud trigger nahi kar sakta — app ko ye screen **notification par** dikhani hai.

### ⚠️ Status `ADMIN_APPROVED` par jaata hai, `FAILED` par nahi

Refund ka **faisla** bahut pehle ho chuka tha aur badla nahi; sirf **destination** badla
hai. `FAILED` par landing use retry queue me daal deti — jaise `SOURCE` dobara try
karna chahiye — theek wahi ek cheez jo pakka kaam nahi karegi.

### ⚠️ Account aapki apni verified list se hi aa sakta hai

Service teen cheezein jaanchti hai: refund aapka hai, account aapka hai, aur account
**verified** hai. Unverified account par `422` — *"This account has not been verified
yet."* Unverified row saboot hai ki koshish hui, destination kabhi nahi.

| Code | Kab |
|---|---|
| `200` | Jud gaya |
| `403` | Refund aapka nahi |
| `404` | Bank account nahi mila (ya aapka nahi) |
| `409` | Refund is state me nahi hai |
| `422` | Account verified nahi hai |

---

## 17k. GET /refunds — meri refunds

**Access:** 🔒 koi bhi logged-in role (`verifyJwtToken`) — **ek endpoint, teen shapes**

| Field | Customer | Outlet | Admin |
|---|:-:|:-:|:-:|
| `split.totalRefund` | ✅ | — | ✅ |
| `split.vendorClawback` | — | ✅ | ✅ |
| `split.platformPromoReversal` · `gatewayFeeAbsorbed` | — | — | ✅ |
| `utr` | ✅ | — | ✅ |
| `vendorNote` · `adminNote` | ❌ | apna / ❌ | ✅ |

**`vendorNote` aapko kabhi nahi milta.** Wo staff ne staff ke liye likha hai —
*"customer collected the order in full"* wo vaakya nahi jo usi grahak ko dikhaya jaaye
jiske baare me hai. Aapko `statusLabel` milta hai.

### `statusLabel` — jo aap dekhte hain

| Andar | Aapko |
|---|---|
| `REQUESTED` | Refund requested |
| `VENDOR_APPROVED` | Approved by the outlet |
| `VENDOR_REJECTED` | Declined by the outlet |
| **`VENDOR_TIMEOUT`** | **Under review by Trydood** |
| `PROCESSING` | On its way to your account |
| `COMPLETED` | Refunded |
| `FAILED` | Refund failed — we are on it |

⚠️ `VENDOR_TIMEOUT` kabhi apne naam se nahi aata — na body me, na `meta` me. Aapko ye
batana ki outlet ne anasuna kiya ek jhagda shuru karta hai jise phir platform ko suljhana
padta hai, aur wo aisi jaankari nahi jis par aap kuch kar sakein.

`canWithdraw` response me **bataya** jaata hai — app ko status se andaza nahi lagana chahiye.

Khaali list **`200` + `data: []`**, `404` nahi.

---

## 17l. GET /refunds/:requestId — ek refund

**Access:** 🔒 koi bhi logged-in role

**Response:** `refund` · `claim` · **`timeline`** · `viewer`

Timeline **claim ki** hai, refund ki alag nahi — refund claim ke saath hui ek cheez hai,
aur claim ki kahani wahi jagah hai jahan grahak, outlet aur admin teeno jaate hain.

### `utr` — wo ek field jo support maangta hai

Razorpay ka bank reference. Paisa na pahunche to aap yahi apne bank ko quote karte hain.
`refund.processed` aane par bharta hai.

---

## Refund ke notifications

| Kab | Kya milta hai |
|---|---|
| Request dari | *"We have your refund request"* |
| Outlet ne approve kiya | *"Your refund is approved"* — aur **kam approve hua to dono rakamein naam lekar** |
| Outlet ne mana kiya | *"About your refund request"* + support ka raasta |
| Paisa pahuncha | *"Refund issued"* — **UTR ke saath** |

Kam approve hone par dono figure saaf likhe jaate hain: jo grahak ₹810 maange aur
chup-chaap ₹400 paaye wo doosri request aur ek support ticket kholta hai.

`PROCESSING` par koi notification nahi — asli transition hai par uspar kisi ke karne ko
kuch nahi, aur jis notification par koi kaam nahi kar sakta wo logon ko unhein
nazarandaaz karna sikha deti hai jo mayne rakhti hain.

---

# Bank Account APIs 🆕

Customer ke bank accounts — **use tab hote hain jab refund wapas usi raaste se nahi ja
sakta**. Mount `/bank-accounts` par hai (`routes/customerBankAccounts.js`, `routePrefix`
override ke saath).

### Ye apna domain kyun hai, `/refunds` ka hissa kyun nahi

Account **customer ka** hai, ek refund ka nahi. Use refund ke neeche rakhna matlab agle
refund par use **dobara add karna — aur dobara verify karna, paise dekar** — aur ye
dekhne ka koi raasta na rehna ki customer ke paas file me kya hai.

### ⚠️ Koi endpoint `customerId` leta hi nahi

Har route par `isCustomer`, aur customer id har service ke andar **token se** aata hai.
Jo endpoint `customerId` leta wo ek insaan ko doosre ke accounts padhne — ya uske naam
par account jodne — de deta.

---

## 17m. POST /bank-accounts/otp — code maango 🆕

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

Step one: code, kuch add hone se **pehle**. Body nahi lagti — number/email account se
aata hai.

```jsonc
{
  "success": true,
  "message": "We have sent you a code.",
  "data": {
    "sentTo": "98****3210",     // masked, hamesha
    "channel": "WHATSAPP"       // WHATSAPP | EMAIL
  }
}
```

### ⚠️ Login akela galat strength ka gate hai

**Account add karna ye tay karta hai ki paisa kahan jayega.** Live session rakhne wala
koi bhi warna ek pending refund apne account par point kar leta — aur **NEFT wapas nahi
bulayi ja sakti**. Isliye ek OTP.

### ⚠️ Throttle route par nahi, `sendOtp` me hai

60 second ka gap, 5 per hour (`Setting.security.otp` se override ho sakta hai). Ye
`services/otps/sendOtp.js` me baitha hai, route par nahi — agle mahine juda koi bhi OTP
endpoint apne aap covered hai, aur **rate-limit middleware bhoolne par koi error hi nahi
aata**, bas ek unprotected endpoint.

Keyed on **target** (number/email) + purpose, **IP par nahi**: Indian mobile networks
hazaaron asli customers ko ek CGNAT address ke peeche rakhte hain, to IP limit ek block
ke logon ko bahar kar deti hai aur phone wale attacker ko baithe-baithe chhod deti hai.

| Code | Kab |
|---|---|
| `200` | Code chala gaya |
| `404` | Customer nahi mila |
| `422` | Account par na WhatsApp number hai na email |
| `429` | Throttle — 60s ke andar dobara, ya ghante me chhathi baar |

---

## 17n. POST /bank-accounts — account jodo 🆕

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

```jsonc
{
  "accountNumber": "912010004512345",      // 9–18 digits
  "ifscCode": "HDFC0001234",               // 4 letters + '0' + 6
  "accountHolderName": "Asha Kumari",      // optional — bank ka naam jeet jaata hai
  "otp": "482913"                          // 17m se
}
```

### Kram hi design hai

```
OTP (consume)  →  pehle se verified account reuse  →  penny drop  →  store
```

OTP **pehle** jaata hai, taaki chori hui session hamse ek **paid** verification call
kharch na kara sake, account jodna to door ki baat. Reuse check drop se **pehle**, taaki
pehle se sabit account dobara daalne par kuch kharch na ho.

### Response — `201`

```jsonc
{
  "success": true,
  "message": "Bank account verified and added.",
  "data": {
    "_id": "68f3a1...",
    "accountHolderName": "ASHA KUMARI",     // bank ka naam
    "maskedAccountNumber": "***********2345",
    "accountLast4Digits": "2345",
    "ifscCode": "HDFC0001234",
    "bankName": "HDFC Bank",
    "branchName": "Indore Vijay Nagar",
    "isVerified": true,
    "verifiedAt": "2026-09-04T10:12:00.000Z",
    "isNameMatch": true,
    "createdAt": "2026-09-04T10:12:00.000Z"
  }
}
```

⚠️ Raw `accountNumber`, poora `verificationResponse` aur `matchingScore` **kabhi nahi**
aate — projection `present()` se hai, jo listing ke saath **shared** hai.

### ⚠️ Verification ke baare me client se kuch bhi accept nahi hota

Na `isVerified`, na `verifiedAt`, na provider ka response. Server khud penny drop karta
hai aur `isVerified` uske jawab se derive karta hai. Jo client `isVerified: true` keh
sakta ho wo refund **kisi bhi** account par point kar sakta hai.

### ⚠️ Fail hua drop bhi record hota hai

Row error throw hone se **pehle** likhi jaati hai. Padhne me ajeeb lagta hai aur
deliberate hai: support ko dikhna chahiye ki customer ne koshish ki aur provider ne kya
kaha. Bina likhe throw karne par koi insaan kehta rehta hai ki usne details daali thi aur
dikhane ko kahin kuch nahi hota.

`isVerified: false` hi wo cheez hai jo **paisa rokti hai** — har payout path use padhta
hai, to unverified row saboot hai aur destination kabhi nahi.

| Code | Kab |
|---|---|
| `201` | Verified aur juda |
| `401` | OTP galat ya expire |
| `422` | Account number / IFSC ka shape galat, **ya penny drop fail** (message bank ka) |
| `429` | OTP attempts khatam |

> ⚠️ **Iska success example Postman me capture nahi hua**, aur ye jaan-boojh kar hai:
> penny drop ek **live CGPey call** hai jiska hum paisa dete hain. Collection me saved
> example wahi asli refusal hai jo galat OTP par aata hai. Upar wala `201` shape code se
> likha gaya hai (`services/customerBankAccounts/addBankAccount.js` ka `present()`).

---

## 17o. GET /bank-accounts — mere accounts 🆕

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

Customer ke apne accounts, **newest first**.

```jsonc
{
  "success": true,
  "message": "Bank accounts fetched successfully.",
  "data": [                                  // ⚠️ plain array
    {
      "_id": "68f3a1...",
      "accountHolderName": "ASHA KUMARI",
      "maskedAccountNumber": "***********2345",
      "accountLast4Digits": "2345",
      "ifscCode": "HDFC0001234",
      "bankName": "HDFC Bank",
      "branchName": "Indore Vijay Nagar",
      "isVerified": true,
      "verifiedAt": "2026-09-04T10:12:00.000Z",
      "isNameMatch": true,
      "createdAt": "2026-09-04T10:12:00.000Z"
    }
  ]
}
```

### ⚠️ `data` ek plain array hai — koi pagination envelope nahi

Ye endpoint shared `pagination()` utility use **nahi** karta. Iska matlab:

- khaali hone par **`200` + `[]`** aata hai, **`404` nahi** — baaki har listing se ulta
  ([Pagination](#pagination) dekhein)
- `total` / `page` / `limit` nahi aate

Jaan-boojh kar: bank accounts ki ginti chhoti aur bounded hai, aur *"aapka koi account
nahi hai"* ek **normal** haalat hai, error nahi.

### Unverified rows bhi aate hain, aur marked aate hain

Unhe chhupane par jis customer ki koshish fail hui wo khaali list dekhta rehta, bina
jaane ki uski attempt register hui ya nahi. `isVerified: false` wala row screen par
*"verification pending"* dikhana chahiye, aur use refund destination ki tarah **offer
nahi** karna chahiye.

---

## 17p. DELETE /bank-accounts/:accountId — account hataao 🆕

**Access:** 🔒 **CUSTOMER only** (`isCustomer`)

Soft delete, baaki sab ki tarah.

```jsonc
{ "success": true, "message": "Bank account removed.", "data": { "removed": true } }
```

### ⚠️ Refund is par point kar raha ho to refuse — `409`

> *"A refund is waiting to be paid into this account. It can be removed once that refund
> is done."*

`PayoutLeg` apna `bankSnapshot` us waqt freeze karta hai jab paisa bheja jaata hai, to
deletion **history nahi badal sakti**. Par jo refund pay hone ka intezaar kar raha hai wo
apna destination kho deta hai aur admin ki queue me aisi haalat me pahunchta hai **jahan
usme paisa daalne ki jagah hi nahi hoti**.

| Code | Kab |
|---|---|
| `200` | Hat gaya |
| `404` | Nahi mila, ya aapka nahi |
| `409` | Ek khula refund is account par point kar raha hai |

---

# Brand Profile APIs

## 18. GET /brands/customer/get/:brandId

Brand profile screen ka **single call** — brand, features, visible showcase preview aur outlets, sab ek saath.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

> 🔄 **v1.2.0 me badla.** Pehle yahan `GET /brands/get?brandId=` document tha. Wo endpoint ab **customer ke liye band hai** (`isVendorOrAdmin`) — wo brand ka PAN, GSTIN, bank account aur subscription billing return karta tha. Ye naya endpoint sirf wahi banata hai jo profile screen render karti hai, to usme strip karne layak kuch hai hi nahi.

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Success — `200`
```json
{
  "success": true,
  "message": "Brand details fetched successfully",
  "data": {
    "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
    "brandName": "cafe mocha",
    "description": "artisanal coffee and continental bites",
    "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
    "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
    "uniqueId": "TDB000078",
    "followersCount": 1240,
    "joinedDate": "2026-03-15T00:00:00.000Z",
    "isVerified": true,

    "category":    { "_id": "…", "name": "food & beverages", "image": "https://…/food.jpg" },
    "subCategory": { "_id": "…", "name": "cafe",             "image": "https://…/cafe.jpg" },

    "location": {
      "_id": "…",
      "addressLine1": "301, corporate tower",
      "city": "indore", "district": "indore", "state": "madhya pradesh",
      "country": "india", "zipcode": "452001",
      "formattedAddress": "301, corporate tower, indore, madhya pradesh, 452001, india",
      "geo": { "type": "Point", "coordinates": [75.8577, 22.7196] }
    },

    "workHours": {
      "monday":  { "isOpen": true,  "start": "09:00", "end": "23:00" },
      "sunday":  { "isOpen": false, "start": null,    "end": null }
    },

    "features": [
      { "_id": "…", "title": "free wifi",    "description": "high speed internet", "icon": "https://…/wifi.png" },
      { "_id": "…", "title": "pet friendly", "description": "furry friends welcome", "icon": "https://…/pet.png" }
    ],

    "showcase": {
      "totalSections": 2,
      "mediaPreviewLimit": 6,
      "sections": [
        {
          "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
          "title": "ambience",
          "description": "our cozy interiors",
          "coverImage": "https://…/ambience-cover.jpg",
          "sectionType": "CUSTOM",
          "sortOrder": 1,
          "mediaCount": 12,
          "photoCount": 9,
          "videoCount": 3,
          "hasMoreMedia": true,
          "medias": [
            {
              "_id": "…",
              "type": "PHOTO",
              "url": "https://…/amb1.jpg",
              "thumbnail": null,
              "title": "seating area",
              "altText": "cafe seating with wooden tables",
              "sortOrder": 1
            }
          ]
        }
      ]
    },

    "outlets": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c4a1",
        "storeId": "TS-87HD-48L3-PZYW",
        "uniqueId": "TDS000201",
        "description": "vijay nagar outlet",
        "outletType": "OUTLET",
        "location": { "…": "outlet ka address + geo" },
        "workHours": { "…": "outlet ki timings" }
      }
    ]
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `400` | `Invalid brand ID` | `brandId` valid ObjectId nahi |
| `404` | `Brand not found` | Brand exist nahi karta, deleted hai, ya inactive |
| `422` | `Brand ID is required` / `Invalid brandId` | Path param missing/galat |
| `403` | `Forbidden: You do not have permission to perform this action.` | Token customer ka nahi |

### ⚠️ Edge cases & notes

**1. Ek call me poori screen ban jaati hai** — pehle 3 alag calls lagti thi (`/brands/get`, `/brandFeatures/get-all`, `/showcase/get-brand-showcase`). Backend chaar indexed queries **parallel** me chalata hai.

**2. Showcase me sirf preview aata hai — har section me pehle 6 media.** Poora album chahiye to `GET /showcase/get-brand-showcase/:brandId` ([#19](#19-get-showcaseget-brand-showcasebrandid)) call karein.
- `mediaCount` / `photoCount` / `videoCount` **poore** album ke counts hain, sirf preview ke nahi
- `hasMoreMedia: true` matlab "See all" button dikhana chahiye
- `mediaPreviewLimit` batata hai cap kitna hai (abhi 6) — hardcode mat karein

**3. Sirf wahi albums aate hain jo vendor ne dikhane chune hain** — `isVisible: true` filter lagta hai. ✅ Ab `/showcase/get-brand-showcase` ([#19](#19-get-showcaseget-brand-showcasebrandid)) bhi yehi filter lagata hai — dono endpoints ek hi shared projection use karte hain, to shape aur rules kabhi alag nahi honge.

**4. `isVerified` ab sahi aata hai.** Pehle `brand.isApproved` document hota tha jo **hamesha `false`** rehta hai (code me kahin set hi nahi hota). Ab ye `SystemVerify.status === "APPROVED"` se derive hota hai — verified badge ab actually kaam karega.

**5. Response chhota hai** — typical brand ~4 KB, max plan limits pe bhi ~20 KB. Screen pe ek baar call karke cache kar sakte hain.

**6. Features max 10 hote hain** (backend limit), sirf `isActive: true` wale aate hain.

**7. Outlets me sirf active outlets** aate hain, aur unme koi `userId` ya internal field nahi hota.

**8. `workHours` ke din top-level keys hain** — koi `workingHours` wrapper nahi. Jo din set nahi hua wo absent ho sakta hai.

**9. Jo bhi join na mile wo field absent ya `null` hoga** — brand ne category/location/workHours set na kiya ho to. Render se pehle check karein.

---

## 18a. GET /brands/customer/get-all 🆕

Brand directory ki paginated list — aur **"Top Brands" tab** bhi isi se.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

> 🆕 **v1.3.0 me naya.** Pehle koi brand-list endpoint tha hi nahi.

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `10` | Integer 1–**50** |
| `search` | string | ❌ | – | Max 100 chars. `brandName` pe case-insensitive match |
| `categoryId` | ObjectId | ❌ | – | Category filter |
| `subCategoryId` | ObjectId | ❌ | – | Sub-category filter |
| `topOnly` | boolean | ❌ | `false` | **Top Brands tab.** `true` → sirf admin ke pin kiye brands |
| `sortBy` | string | ❌ | `TOP_FIRST` | `TOP_FIRST` \| `NEWEST` \| `FOLLOWERS` \| `NAME` \| `DISTANCE` |
| `sortOrder` | string | ❌ | *(preset-wise)* | `asc` \| `desc` |
| `latitude` | number | ❌ | – | -90..90. **`longitude` ke saath hi** |
| `longitude` | number | ❌ | – | -180..180. **`latitude` ke saath hi** |

```http
GET /brands/customer/get-all?limit=20
GET /brands/customer/get-all?topOnly=true
GET /brands/customer/get-all?latitude=22.7533&longitude=75.8937&sortBy=DISTANCE
```

### Top Brands tab aur "view more" — wahi pattern jo vouchers me hai

| UI | Call | Kya milta hai |
|---|---|---|
| **Top Brands tab** | `?topOnly=true` | Sirf pinned, `topOrder` ke order me |
| **View more / poori directory** | *(param na bhejein)* | **Sab** brands — pinned **upar**, phir baaki |

Ek hi sorted result set hai, isliye pinned brands page 2 pe **dobara nahi** aayenge. Har row pe `isTopBrand` boolean hai.

### Geo optional hai

`latitude` + `longitude` **dono** bhejein to:
- Har row pe `distanceInMeters` aayega (brand ke **sabse paas ke outlet** ki doori)
- `sortBy=DISTANCE` kaam karega

Na bhejein to ye simple directory hai — koi `distanceInMeters` field nahi aayegi, aur `sortBy=DISTANCE` chupchaap `NEWEST` ban jayega.

⚠️ Ek bhejna aur doosra chhodna **`422`** hai — dono saath, ya dono nahi.

### Success — `200`
```json
{
  "success": true,
  "message": "Brands fetched successfully",
  "data": {
    "total": 48,
    "totalPages": 3,
    "page": 1,
    "limit": 20,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
        "brandName": "cafe mocha",
        "description": "artisanal coffee and continental bites",
        "logo": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-logo.jpg",
        "coverImage": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/brands/mocha-cover.jpg",
        "uniqueId": "TDB000078",
        "followersCount": 1243,
        "joinedDate": "2026-03-15T00:00:00.000Z",
        "isTopBrand": true,
        "isVerified": true,
        "outletCount": 4,
        "distanceInMeters": 420,
        "category": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0e1",
          "name": "food and beverages",
          "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/categories/fnb.png"
        },
        "subCategory": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0f1",
          "name": "cafe",
          "image": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/subcategories/cafe.png"
        }
      }
    ]
  }
}
```

### Response fields — detail

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Detail endpoint ([#18](#18-get-brandscustomergetbrandid)) me isko bhejein |
| `isTopBrand` | boolean | Admin ne pin kiya hai ya nahi |
| `isVerified` | boolean | `SystemVerify.status === "APPROVED"` se derive. `brand.isApproved` **nahi** — wo hamesha `false` rehta hai |
| `outletCount` | number | Kitne active outlets hain |
| `distanceInMeters` | number | **Sirf coordinates bhejne pe.** Sabse paas ke outlet ki doori, metres me, rounded |
| `category` / `subCategory` | object\|null | Singular object hai, array nahi |

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `No any brand found` | ⚠️ Koi match nahi — **empty-state dikhayein, error nahi** |
| `422` | `latitude and longitude must be provided together` | Sirf ek bheja |
| `422` | `Invalid category ID` / `Invalid subCategory ID` | ObjectId format |
| `422` | *(Joi message)* | `limit > 50`, coordinates range se bahar, etc. |
| `403` | – | Customer ke alawa koi aur role |

### ⚠️ Edge cases & notes

**1. `404` empty state hai, error nahi.** `search=xyz` pe kuch na mile to `404` hi aayega. Isko "koi brand nahi mila" screen me convert karein.

**2. Sirf active brands aate hain.** `isActive: false` brand list me nahi aata — chahe admin ne use top brands me pin kar rakha ho. (Admin ke apne view me wo dikhta hai taaki unpin kar sake.)

**3. `topOnly=true` pe curation hi ordering hai** — `topOrder` ke hisaab se. `sortBy=DISTANCE` bhejne pe bhi wahi order rahega, kyunki us tab me sab rows already curated hain.

**4. Main list me curation proximity se upar hai.** `sortBy=DISTANCE` pe bhi pinned brands **pehle** aayenge, phir baaki distance ke order me. Agar aapko purely nearest-first chahiye to `topOnly` mat use karein aur pinned block ko UI me alag treat karein.

**5. Distance approximate hai.** Directory sorting ke liye equirectangular approximation use hota hai — sheher-bhar ke distances pe error ek percent se bhi kam hai. Exact distance voucher endpoints (#15/#16) se aati hai.

**6. Bina coordinates wale outlets skip ho jaate hain** distance calculation me. Brand ke saare outlets bina geo ke hon to `distanceInMeters` `null` aayega — sort me wo neeche chala jayega.

**7. Ye list card ke liye hai.** Features, showcase, outlets ki detail nahi aati — uske liye [#18](#18-get-brandscustomergetbrandid).

---

## 19. GET /showcase/get-brand-showcase/:brandId

Brand ka photo/video gallery, sections me organized.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

### Path Params
| Param | Type | Required |
|---|---|---|
| `brandId` | ObjectId | ✅ |

### Query Params
| Param | Type | Required | Default | Validation |
|---|---|---|---|---|
| `page` | number | ❌ | `1` | Integer ≥ 1 |
| `limit` | number | ❌ | `50` | Integer 1–50 — **sections** pe lagta hai, media pe nahi |

### Success — `200`
```json
{
  "success": true,
  "message": "Showcase fetched successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "total": 2,
    "page": 1,
    "limit": 50,
    "totalPages": 1,
    "sections": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a1",
        "title": "Ambience",
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
            "thumbnail": "https://res.cloudinary.com/drvdnqydw/image/upload/v1/showcase/amb1.jpg",
            "title": "seating area",
            "altText": "cafe seating with wooden tables",
            "sortOrder": 1,
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
            "createdAt": "2026-06-01T10:05:00.000Z",
            "duration": 24,
            "resolution": { "width": 1080, "height": 1920 }
          }
        ]
      },
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c5a2",
        "title": "Signature dishes",
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

### Success — `200` (brand hai, par koi visible album nahi)
```json
{
  "success": true,
  "message": "Showcase fetched successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "total": 0,
    "page": 1,
    "limit": 50,
    "totalPages": 1,
    "sections": []
  }
}
```

> ✅ **Album na hone pe 404 nahi aata** — `sections: []`. 404 sirf tab jab brand hi na mile.

### Errors
| Status | Message | Kab |
|---|---|---|
| `404` | `Brand not found` | brandId exist nahi karta, ya brand deactivate/delete ho chuka hai |
| `422` | *(Joi message)* | `brandId` valid ObjectId nahi, ya `limit > 50` |

### ⚠️ Notes

**1. 🔴 Sirf `isVisible: true` sections aate hain** (naya). Pehle ye filter **nahi** lagta tha — vendor ne section chhupaya ho tab bhi yahan aa jaata tha, jabki brand profile (#18) me nahi aata tha. Ab dono screen ek jaisa behave karti hain.

Poora filter: section pe `isVisible && isActive && !isDeleted`, media pe `isActive && !isDeleted`.

**2. `isShowInVideoClips` yahan filter NAHI karta.** Wo sirf reels feed (#20) ka switch hai — jis video ko vendor ne clips se hataya ho, wo apne album me phir bhi dikhega. Ye jaan-boojh kar hai.

**3. Brand check hota hai** (naya) — deleted ya deactivated brand ki gallery ab public nahi rehti, `404` aata hai. Pehle aise brand pe bhi `200` + `sections: []` milta tha.

**4. Sorting handled hai** — sections `sortOrder` ascending, aur har section ke `medias` bhi `sortOrder` ascending. Jo order mile usi me dikhayein.

**5. Response strict whitelist hai** — `storage`, `metadata`, `isActive` aur `isShowInVideoClips` ab response me **nahi** aate (pehle aakhri do aate the). Ye vendor ke internal toggles hain.

**6. `duration` aur `resolution` sirf `VIDEO` rows pe aate hain** (naya) — photo pe ye keys hoti hi nahi. Player ke aspect ratio aur progress bar ke liye use karein; `duration` seconds me.

**7. `thumbnail` hamesha image URL hota hai** — PHOTO ke liye apni hi optimized URL, VIDEO ke liye poster frame.

**8. Counts pre-calculated hain** (`mediaCount`, `photoCount`, `videoCount`) — tabs/badges me directly use karein.

**9. Sections pe pagination hai** (naya) — default 50 sections tak. Media pura aata hai (section cap 15 items), preview chahiye to #18 use karein.

**10. Title ab original case me aata hai** — pehle sab lowercase store hota tha (`"ambience"`), ab jaise vendor ne likha (`"Ambience"`). **Purane sections lowercase hi rahenge** jab tak vendor unhe rename na kare.

---

## 20. GET /showcase/:brandId/video-clips

Brand ke videos ka flat, paginated feed — reels/stories style UI ke liye.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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
| `404` | `Brand not found` | brandId exist nahi karta, ya brand deactivate/delete ho chuka hai |
| `404` | `No video clips found for this brand` | Koi eligible video nahi — **empty-state dikhayein** |
| `422` | *(Joi message)* | `brandId` invalid, ya `limit > 50` |

### ⚠️ Notes

**1. Double opt-in filter.** Video feed me aane ke liye **dono** flags true chahiye:
- Section pe `isShowVideosInClips: true`
- Media pe `isShowInVideoClips: true`

Iske upar section ka `isVisible: true` bhi chahiye — chhupaya hua section clips me bhi nahi aata.

Matlab showcase (#19) me video dikhe par clips feed me na aaye — ye normal hai, vendor ne opt-out kiya hoga.

**2. Yahan sirf `type: "VIDEO"` aata hai, hamesha.** `isShowInVideoClips` **sirf video** ka switch hai — photo pe ye flag store hi nahi hota (`false` rehta hai), aur feed type pe bhi filter karta hai. Purane data me kisi photo pe `true` pada ho to bhi wo yahan kabhi nahi aayega.

**3. `resolution` aur `duration` aate hain.** Player aspect ratio aur progress bar ke liye useful. `duration` seconds me, missing ho to `0`.

**4. `thumbnail` ka fallback section ka `coverImage` hai** — video ka apna thumbnail na ho to section cover use hota hai. Isliye ye field practically kabhi `null` nahi hota.

**5. Sorting:** section `sortOrder` → media `sortOrder` → `createdAt` descending.

**6. `sectionTitle` context deta hai** — video kis section ka hai, UI pe caption me dikha sakte hain.

---

## 21. GET /brandFeatures/get-all

Brand ke USP/highlight points (icon + title + description). Brand profile pe "Features" / "Why choose us" section.

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🔒 **Sirf CUSTOMER** (`isCustomer`)

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

**Access:** 🔒 **Sirf CUSTOMER** (`isCustomer`)

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

**Access:** 🔒 **Sirf CUSTOMER** (`isCustomer`)

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

**Access:** 🔒 **Sirf CUSTOMER** (`isCustomer`)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

**Access:** 🌐 **Public** — koi token nahi chahiye (guest browsing)

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

# Push Notification APIs

🆕 **v1.1.0 me naya module.** Push notifications ke liye device registration.

**Role-agnostic by design** — model ka comment: *"a vendor, a customer, a sub-vendor and any role added later all register here the same way, so push targeting never needs to know what kind of user it is addressing."*

Global middleware: `router.use(verifyJwtToken)` — chaaron endpoints pe.

**Kaise kaam karta hai:** App FCM se token leta hai → yahan register karta hai → backend `DeviceToken` row banata hai (userId + role denormalized) → jab koi notification bhejni ho, backend user ke active tokens nikal kar FCM pe multicast karta hai.

✅ **Push hi sab kuch nahi hai — inbox bhi hai.** Push turant dikhta hai aur chala jaata hai; agar phone band tha, notification silent thi, ya user ne swipe kar diya, to wo message hamesha ke liye gaya. Isliye feed alag se rehti hai:

- [`GET /notifications/get-all`](#37-get-notificationsget-all-) — poori history, paginated
- [`PUT /notifications/mark-read`](#38-put-notificationsmark-read-) — read mark karo
- [`GET`](#38a-get-notificationspreferences-) / [`PUT /notifications/preferences`](#38b-put-notificationspreferences-) — email, push aur WhatsApp alag-alag on/off

⚠️ Device register karna **preferences se alag hai**. `/deviceTokens/register` batata hai *kahan* bhejna hai; preferences batati hain *bhejna hai ya nahi*. Push band karne ke liye token unregister mat karo — `channels.push: false` karo, warna dobara login pe app khud token register kar degi aur push wapas aa jaayega.

---

## 31. POST /deviceTokens/register

Device ko push ke liye register karta hai. **App start pe aur token refresh pe call karein.**

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

### Headers
| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <token>` | ✅ |
| `Content-Type` | `application/json` | ✅ |

### Body
| Field | Type | Required | Validation | Notes |
|---|---|---|---|---|
| `token` | string | ✅ | 20–4096 chars | FCM registration token. Ceiling deliberately generous hai — provider ne pehle length badli hai, aur valid token reject hone ka matlab hai device chup-chaap notifications miss karega |
| `platform` | string | ✅ | `ANDROID` \| `IOS` \| `WEB` | Auto-uppercase |
| `deviceId` | string | ❌ | Max 128 chars | **Bhejna chahiye** — isse reinstall apna purana token replace kar deta hai, dead row nahi chhodta |
| `deviceName` | string | ❌ | Max 128 chars | Jaise `"Pixel 8"` — `get-mine` me user ko dikhane ke liye |
| `appVersion` | string | ❌ | Max 32 chars | Debugging ke liye |

```json
{
  "token": "fMEp8kQ2S0aBcDeFgHiJkL:APA91bH...very-long-fcm-token",
  "platform": "ANDROID",
  "deviceId": "a1b2c3d4e5f6",
  "deviceName": "Pixel 8",
  "appVersion": "1.4.2"
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
      "role": "CUSTOMER",
      "token": "fMEp8kQ2S0aBcDeFgHiJkL:APA91bH...",
      "platform": "ANDROID",
      "deviceId": "a1b2c3d4e5f6",
      "deviceName": "Pixel 8",
      "appVersion": "1.4.2",
      "isActive": true,
      "lastSeenAt": "2026-08-22T12:00:00.000Z",
      "failureCount": 0,
      "createdAt": "2026-08-22T12:00:00.000Z",
      "updatedAt": "2026-08-22T12:00:00.000Z"
    },
    "activeDevices": 2
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | `Authentication is required to register a device.` | Token context missing |
| `422` | `token is required` | Missing |
| `422` | `token does not look like a valid push token` | 20 chars se chhota |
| `422` | `platform is required` | Missing |
| `422` | `platform must be one of: ANDROID, IOS, WEB` | Invalid enum |

### ⚠️ Edge cases & notes

**1. Idempotent hai — baar-baar call karna safe hai.** `token` pe upsert hota hai. Same token dobara bhejo to naya row nahi banta, existing refresh ho jaata hai.

**2. Token ownership transfer handle hota hai.** `token` **unique** hai (`(userId, token)` combo nahi). Model ka reasoning: ek provider token ek device install ko identify karta hai, aur wo install haath badal sakta hai — shared phone, reinstall, logout-and-login as someone else. Isliye already-registered token dobara register karne pe wo **reassign** ho jaata hai. Agar aisa na hota to purana owner naye owner ki notifications receive karta rehta.

**3. `deviceId` bhejne ka faayda:** register pe backend pehle usi `deviceId` ke purane active tokens ko retire kar deta hai (`"Replaced by a newer token from the same device"`), phir naya register karta hai. Bina `deviceId` ke har reinstall ek dead row chhod jaata hai.

**4. Dead token revive ho jaata hai.** Jo token pehle fail hone ki wajah se deactivate hua tha, wo dobara register hone pe `isActive: true` ho jaata hai aur `failureCount` `0` reset ho jaata hai — service ka comment: *"the reason it failed before may well be gone."*

**5. `role` denormalize hota hai** aur har register pe refresh hota hai. Isse role-targeted broadcasts ko har dispatch pe join nahi karna padta.

**6. Kab call karein:**
- App launch pe (token FCM se leke)
- FCM `onTokenRefresh` pe
- Login ke turant baad (taaki `role` sahi user pe map ho)

---

## 32. PUT /deviceTokens/unregister

Device ko push se hata deta hai. **Logout pe call karna zaruri hai.**

**Access:** 🔒 **Signed in — suspended account bhi** (`verifyJwtTokenEvenIfDeactivated`)

### Body
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `token` | string | ⚠️ | – | 20–4096 chars. Is device ka token |
| `allDevices` | boolean | ⚠️ | `false` | `true` = "sign out everywhere" |

⚠️ **Dono me se ek dena mandatory hai** (Joi `.or("token", "allDevices")`). Kuch na bhejo to `422`.

```json
{ "token": "fMEp8kQ2S0aBcDeFgHiJkL:APA91bH..." }
```
```json
{ "allDevices": true }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Device unregistered from push notifications",
  "data": {
    "deactivated": 1,
    "activeDevices": 1
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | *(auth error)* | Token context missing |
| `422` | `Provide a token, or set allDevices to true.` | Dono missing |

### ⚠️ Notes

**1. Row delete nahi hoti, deactivate hoti hai.** `isActive: false` + `deactivatedAt` + `deactivatedReason` (`"Signed out on this device"` ya `"Signed out of all devices"`). Model ka comment: *"Rows are kept rather than deleted so delivery history stays explicable."*

**2. Self-scoped hai — koi doosre ka device band nahi kar sakta.** Service ka filter hamesha `userId` carry karta hai: *"so one user cannot silence another's device."* Kisi aur ka token bhej doge to `deactivated: 0` aayega, error nahi.

**3. `deactivated: 0` error nahi hai** — matlab us filter pe koi active row nahi mili (already unregistered, ya token kisi aur ka).

**4. Logout ab ye khud kar leta hai** 🆕 — `POST /auth/logout` ko `pushToken` bhej dein, alag call ki zarurat nahi:
```
POST /auth/logout  { "pushToken": "<wahi token jo register kiya tha>" }
→ local token + cache clear
```

Ye endpoint tab bhi kaam ka hai jab logout ke bina ek device retire karna ho — jaise
"logged-in devices" screen se koi purana phone hataana.

> Pehle logout push ko chhoota hi nahi tha aur dono call karni padti thi. Ab `pushToken`
> na bhejne par bhi logout chalta hai — bas us device ko notifications aate rahenge.

---

## 33. GET /deviceTokens/get-mine

Caller ke apne registered devices. "Logged-in devices" screen ke liye.

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

### Query Params
| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `includeInactive` | boolean\|string | ❌ | `false` | `true` bhejo to retired devices bhi aayenge. Debugging ke liye — "push kyun nahi aa raha" |

### Success — `200`
```json
{
  "success": true,
  "message": "Registered devices fetched successfully",
  "data": {
    "devices": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9d001",
        "platform": "ANDROID",
        "deviceId": "a1b2c3d4e5f6",
        "deviceName": "Pixel 8",
        "appVersion": "1.4.2",
        "isActive": true,
        "lastSeenAt": "2026-08-22T12:00:00.000Z",
        "lastPushAt": "2026-08-22T11:30:00.000Z",
        "failureCount": 0,
        "tokenTail": "…APA91bH",
        "createdAt": "2026-08-20T09:00:00.000Z"
      }
    ],
    "activeDevices": 1,
    "total": 1
  }
}
```

### Errors
| Status | Message |
|---|---|
| `401` | *(auth error)* |
| `422` | *(Joi message)* — `includeInactive` invalid |

### ⚠️ Notes

**1. Poora `token` kabhi nahi aata.** Uski jagah `tokenTail` aata hai — aakhri 8 characters. Service ka comment: *"Enough to identify the row, not enough to send with."* Achha design hai — leaked response se koi aur push nahi bhej sakta.

> `userId`, `role` aur `updatedAt` bhi **nahi** aate — service ka `.select()` unhe include nahi karta. List already caller ki hi hai, to `userId` dobara bhejne ka matlab nahi. Apni row pehchanne ke liye `tokenTail` ko locally stored token ke aakhri 8 chars se match karein.

**2. Empty pe `404` nahi aata** — `devices: []`, `activeDevices: 0`, `total: 0` milta hai. Baaki list endpoints se different (achhi baat).

**3. Sorting:** active devices pehle, phir `lastSeenAt` descending (sabse recent upar).

**4. `lastPushAt` `null` ho sakta hai** — agar us device pe kabhi push nahi gaya.

**5. `failureCount`** consecutive send failures batata hai. Zyada value = wo token probably dead hai.

---

## 34. POST /deviceTokens/test

Test push bhejta hai — **sirf caller ke apne devices pe**. Setup verify karne ke liye.

**Access:** 🔒 **Koi bhi signed-in role** (`verifyJwtToken`)

### Body — dono optional
| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `title` | string | ❌ | `"Test notification"` | Max 160 chars |
| `body` | string | ❌ | `"If you can read this, push notifications are working."` | Max 1000 chars |

```json
{ "title": "Test", "body": "Checking push setup" }
```

### Success — `200`
```json
{
  "success": true,
  "message": "Test push dispatched",
  "data": {
    "devices": 2,
    "sent": 2,
    "failed": 0,
    "delivered": true
  }
}
```

### Errors
| Status | Message | Kab |
|---|---|---|
| `401` | *(auth error)* | Token context missing |
| `422` | `Push credentials were rejected by the provider: <reason>` | Server ka FCM setup galat hai — **aapki galti nahi** |
| `404` | `You have no active devices registered. Call POST /deviceTokens/register from the app first.` | Pehle register karo |
| `422` | *(Joi message)* | `title`/`body` limit cross |

### ⚠️ Notes

**1. Sirf apne devices pe jaata hai** — `dispatchPush([actor.userId], ...)`. Kisi aur ko test push bhejne ka koi tareeka nahi.

**2. `delivered` flag dekho, `success` nahi.** Service ka comment batata hai kyun: *"The interesting answer is not 'did the request succeed' but 'did a phone light up', and those are different things."*
- `success: true` + `delivered: true` → phone pe notification aayi
- `success: true` + `delivered: false` (`sent: 0`) → request theek gayi par kisi device pe nahi pahunchi (dead tokens)

**3. Credentials error alag se handle hota hai.** Service pehle `probeFcmAuth()` chalata hai — comment: *"Separates 'credentials are wrong' from 'the token is dead', which otherwise both look like a failed send."* `422` = server config issue, `404` = koi device nahi.

**4. Push payload me `data: { type: "TEST" }` jaata hai** — app isse test notification ko normal se distinguish kar sakta hai.

**5. Ye debugging tool hai, production feature nahi.** App ke settings/developer screen me rakhein, normal user flow me nahi.

---

---

# Email Verification APIs 🆕

**Access:** 🔒 `verifyJwtToken` — **har role**: customer, vendor, outlet manager, admin.

`User.isEmailVerified` sabke paas tha aur **koi bhi use set nahi kar sakta tha**. Email
edit karne par flag `false` ho jaata tha aur wapas `true` karne ka koi endpoint hi nahi
tha — badge sirf ek taraf ja sakta tha.

### Verify aur change ek hi jodi hai

`email` **dono call par optional** hai:

| Bheja | Kya hota hai |
|---|---|
| kuch nahi | Account par jo address hai wahi confirm hota hai |
| naya address | Us par switch — par **verify hone tak account nahi badalta** |

Do alag endpoints ka matlab hota client pehle decide kare ki address badla hai ya nahi —
aur wo faisla server ke paas pehle se hai.

> ### ⚠️ Code hamesha **naye** address par jaata hai
>
> Purane mailbox par code bhejna sirf ye sabit karta hai ki insaan purana mailbox padh
> leta hai. Sawal wo hai hi nahi — sawal ye hai ki naya address unka hai ya nahi.

---

## 35. POST /auth/email/send-verification 🆕

```jsonc
{ }                              // account ka apna email confirm karo
{ "email": "new@example.com" }   // is address par switch karo
```

### Response — `200`

```jsonc
{
  "success": true,
  "message": "We have sent a code to as***a@gmail.com.",
  "data": {
    "sentTo": "as***a@gmail.com",   // ⚠️ hamesha masked
    "isChange": false                // true = address badla ja raha hai
  }
}
```

⚠️ **`sentTo` masked hai** kyunki ye endpoint chori hui session se bhi chal sakta hai, aur
poora address us haath me nayi jaankari hoti.

### Throttle

`sendOtp` ke andar — **60 second gap, 5 per hour**, aur **target address** par keyed, IP
par nahi. Route par rakhna matlab agla OTP endpoint bina protection ke chala jaata, aur
rate-limit bhoolne par **koi error hi nahi aata** — bas ek khula endpoint jo har request
par paisa kharch karta hai.

| Code | Kab |
|---|---|
| `200` | Code chala gaya |
| `409` | Ye address pehle se verified hai (aur badla bhi nahi ja raha) |
| `409` | Wo address kisi aur ke **usi role** ke account par hai |
| `422` | Account par email hai hi nahi, aur aapne bheja bhi nahi |
| `429` | Throttle — 60s ke andar dobara, ya ghante me chhathi baar |

---

## 36. POST /auth/email/verify 🆕

```jsonc
{ "otp": "482913" }                                   // apna address confirm
{ "otp": "482913", "email": "new@example.com" }       // switch confirm
```

### Response — `200`

```jsonc
{
  "success": true,
  "message": "Email address updated and verified.",
  "data": { "email": "new@example.com", "isEmailVerified": true, "wasChange": true }
}
```

⚠️ **Address likhna aur verified mark karna ek hi save me** hota hai. Do step me karne par
ek pal aisa banta jahan naya address padha hota aur `isEmailVerified: false` — theek wahi
haalat jisse nikalne ka raasta ye feature de raha hai.

⚠️ **Uniqueness yahan dobara check hoti hai.** Dono call ke beech minute nikalte hain, aur
utni der me koi aur wo address le sakta hai. Sirf bhejte waqt check karna aapko ek verified
duplicate de deta.

⚠️ **`loginType` nahi badalta.** `verifyEmailOTP` use `EMAIL` karta hai kyunki wo ek
sign-in hai; ye nahi — aapke paas pehle se token hai. Yahan badalna ek WhatsApp customer ka
record sirf isliye badal deta ki usne apna address confirm kiya.

⚠️ **Code consume ho jaata hai** — wahi code dobara nahi chalega, warna ek purana code baad
me address phir se badal sakta tha.

| Code | Kab |
|---|---|
| `200` | Verified |
| `401` | Code galat, expire, ya pehle se use ho chuka |
| `403` | Attempts khatam — naya code maangna padega |
| `409` | Wo address is beech me kisi aur ne le liya |
| `422` | `otp` nahi bheja, ya email ka format galat |

> ⚠️ **Iska success example Postman me capture nahi hua** — code ek asli inbox me jaata hai
> aur collection use padh nahi sakti. Saved example wahi refusal hai jo khaali code par
> aata hai; upar wala `200` shape code se likha gaya hai.

---

# Notification APIs 🆕

**Access:** 🔒 `verifyJwtToken` — **ek endpoint, chaar shapes**.

Customer apni rows dekhta hai, vendor apne brand ki, admin ya to admin feed ya kisi bhi
brand ki, aur outlet manager ko saaf mana kiya jaata hai. Scope **aur** projection dono
token se nikalte hain.

### Rows pehle se likhi ja rahi thi

`refundNotices` aur `voucherClaimNotices` dono `audience: CUSTOMER` par likhte hain —
sirf unhe **padhne ka koi raasta nahi tha**. Customer ko push milta tha aur history kahin
nahi.

### ⚠️ Alag `/notifications/customer` kyun nahi

Wahi wajah jo `/refunds`, `/settlements` aur `/voucher-claims` ki hai: do surface ka
matlab do jagah yaad rakhna ki customer ko `emailError`, `dedupeKey` ya kaccha `meta`
nahi dikhna chahiye. Ek jagah bhoolna = leak — aur wo detail screen par milta hai, jise koi
dobara nahi padhta.

---

## 37. GET /notifications/get-all 🆕

`?page=` · `?limit=` · `?type=` · `?isRead=`

### Response — `200`

```jsonc
{
  "success": true,
  "message": "Notifications fetched successfully",
  "data": {
    "total": 3, "totalPages": 1, "page": 1, "limit": 20,
    "unreadCount": 2,
    "data": [
      {
        "_id": "68f4…",
        "type": "REFUND_REQUESTED",
        "severity": "INFO",
        "title": "We have your refund request",
        "body": "We have asked the outlet about your ₹500.00 refund on TD-FPHTTY…",
        "meta": {                       // ⚠️ whitelist — sirf deep-link ke ids
          "refundRequestId": "68f3…",
          "claimId": "68f2…",
          "claimCode": "TD-FPHTTY"
        },
        "isRead": false,
        "createdAt": "2026-09-04T10:12:00.000Z"
      }
    ]
  }
}
```

**Sort:** unread pehle, phir newest.

### ⚠️ `meta` whitelist hai, delete-list nahi

Customer ko sirf `claimId` · `claimCode` · `refundRequestId` · `transactionId` ·
`brandId` milte hain — inbox ko row tap karne par kahin le jaana hota hai, isliye ye
chahiye. `meta` khud `Mixed` hai: jo notice kal usme kuch bhi daalega wo **default roop
se adrishya** rahega. Row-minus-kuch bhejne ka matlab hota har naya notice by default leak.

`channels` · `emailSentAt` · `emailError` · `dedupeKey` · `audience` · `customerId` —
in me se kuch bhi customer ko kabhi nahi jaata.

### ⚠️ `unreadCount` **scope** par ginta hai, filter par nahi

`?type=ANNOUNCEMENT` lagane par list chhoti ho jaati hai par badge wahi rehta hai. Filter
ke saath ginne par badge us bell se hi asehmat ho jaata jisne use khola tha.

### ⚠️ Khaali inbox `200` + `data: []` deta hai, `404` nahi

Naya customer sabse pehle yahi tapta hai, aur *"abhi koi notification nahi"* ek **normal
haalat** hai — error screen nahi. (Ye `pagination` ka `allowEmpty`, wahi jo claims listing
ko diya gaya tha.)

---

## 38. PUT /notifications/mark-read 🆕

```jsonc
{ "notificationIds": ["68f4…"] }   // kuch rows
{ "markAll": true }                 // poora inbox
```

```jsonc
{ "success": true, "message": "Notifications marked as read",
  "data": { "matched": 1, "updated": 1, "unreadCount": 1 } }
```

### ⚠️ Kisi aur ki row par `matched: 0` aata hai, `403` nahi

Scope **update ke filter me** hai. Kisi aur customer ka valid id bhejne par row match hi
nahi karti — kyunki `customerId` usi query ka hissa hai jo likhti hai.

`403` dene ke liye pehle padhna padta *"ye kiski hai"*, aur wahi read-then-write wapas le
aata jise filter hataata hai: do call ke beech ek khidki, aur ownership ka faisla doosri
jagah. `matched: 0` utna hi saaf jawab hai aur ek kam sawal poochta hai.

---

## 38a. GET /notifications/preferences 🆕

**Access:** ⚪ **Har role** — customer, vendor, outlet manager, admin. Id token se
aati hai, to ye endpoint kisi **aur** ko address kar hi nahi sakta.

Teen channel — email, push, WhatsApp — **ek doosre se poori tarah independent**.
WhatsApp band aur baaki do chalu ho to baaki do jaate hain.

### Response — `200`

```jsonc
{
  "success": true,
  "message": "Notification preferences fetched successfully",
  "data": {
    "userId": "68f4…",
    "role": "CUSTOMER",
    "audience": "CUSTOMER",          // kaunsa platform block isko govern karta hai
    "channels": {
      "email":    { "preference": true,  "effective": true,  "blockedBy": null },
      "push":     { "preference": true,  "effective": true,  "blockedBy": null },
      "whatsapp": { "preference": true,  "effective": false, "blockedBy": "PLATFORM" }
    },
    "updatedBy": null,               // admin ne badla ho to { _id, name, role }
    "updatedAt": null                // kabhi nahi badla to null
  }
}
```

### ⚠️ `preference` aur `effective` do alag cheezein hain

`preference` = **aapne kya chuna**. `effective` = **abhi actually kuch jata hai ya
nahi**. Dono isliye, kyunki ek platform-wide switch aapke choice ko roke bhi sakta
hai — aur uss haalat me sirf `preference: true` dikhana app ka jhooth bolna hota.

Aaj **WhatsApp teeno audience ke liye platform-wide off hai** (Meta-approved
template har message type ke liye chahiye), to `blockedBy: "PLATFORM"` normal
case hai, koi edge case nahi. Aapka choice phir bhi store hota hai aur jis din
platform switch chalu hoga usi din lag jayega.

`blockedBy` ki teen halatein: `null` (chal raha hai), `"PREFERENCE"` (aapne band
kiya), `"PLATFORM"` (platform ne band kiya).

### ⚠️ In-app feed in teen me nahi hai, jaan-boojh ke

Notification **row hamesha** likhi jaati hai. Ye toggles sirf **bahar jaane wali
delivery** tay karte hain. Row hi record hai — feed usi ko padhti hai, aur har
delivery ka nateeja usi par likha jaata hai.

## 38b. PUT /notifications/preferences 🆕

**Access:** ⚪ Har role — apni hi.

```jsonc
{ "whatsapp": false }                        // ek channel
{ "email": false, "push": true }             // ya jitne chahiye
```

⚠️ **Partial hai.** Sirf wahi channel badalte hain jo body me hain. Poora object
bhejna zaroori nahi — aur bhejna chahiye bhi nahi: paanch minute purani screen
tab kisi doosre device par kiye gaye change ko chup-chaap palat degi.

Kam se kam ek channel chahiye, warna `422`.

Response wahi shape jo `GET` ka hai.

### ⚠️ Kuch notifications band nahi hoti

Chhe types preference se upar hain — wo jinme chup rehna aapka hi nuksaan hai:

| Type | Kyun |
|---|---|
| `REFUND_BANK_DETAILS_REQUESTED` | Refund tab tak hamare paas ruka hai jab tak aap account na dein |
| `BRAND_DEACTIVATED` | Vendor sign in hi nahi kar sakta — in-app row pahunch se bahar hai |
| `REFUND_FAILED` · `SETTLEMENT_LEDGER_DRIFT` · `SHADOW_INDEX_REAPED` · `DISPUTE_DEADLINE` | Admin-side, paisa ruka/khoya hua |

Baaki sab silence ho sakta hai. Poori list aur uska rule:
[`docs/notification_preferences.md`](./notification_preferences.md).

⚠️ **OTP ismein nahi aata.** Login/verification OTP alag raste se jaata hai —
koi apne hi code ko silence na kar paye.

---

# App Config API 🆕

## 39. GET /app-config 🆕

**Access:** 🌐 **Public — token ki zarurat nahi**

App launch par pehla call. Min version, force-update, support contact aur feature flags.

`?platform=android|ios` · `?version=1.2.3` — dono optional.

### Response — `200`

```jsonc
{
  "app": {
    "minVersion":    { "android": "1.0.0", "ios": "1.0.0" },
    "latestVersion": { "android": "1.4.0", "ios": "1.4.0" },
    "forceUpdate": false,
    "updateMessage": "A newer version of Trydood is available…",
    "storeUrl": { "android": "https://play.google.com/…", "ios": "https://apps.apple.com/…" },
    "platform": "android",       // jiske against judge kiya gaya
    "updateRequired": false,     // null jab tak version na bhejein
    "updateAvailable": true
  },
  "support":  { "email": "help@trydood.com", "phone": "1800-000-000", "whatsapp": "97…" },
  "features": { "promoCodes": true, "refunds": true, "voucherClaims": true, "search": true },
  "pricing":  { "currency": "INR", "currencySymbol": "₹",
                "convenienceFee": { "isEnabled": true, "slabSize": 500, "feePerSlab": 5, "maxFee": null } },
  "refund":   { "windowHours": 24, "allowPartial": true }
}
```

### ⚠️ Version comparison **server par** hoti hai

`version` bhejiye to server `updateRequired` khud tay karta hai. Do apps me
*"kya main minimum se neeche hoon"* likhna do mauke hain yeh galti karne ke:

```
"1.10.0" < "1.9.0"     // text me TRUE — aur bilkul galat
```

Aur wo galti un builds me hoti hai jinhe theek karne ke liye **wahi update chahiye jo wo
maang rahe hain**. Segment-wise numeric compare hi iska sahi jawab hai.

⚠️ `version` na bhejein to `updateRequired` aur `updateAvailable` **`null`** aate hain —
ek imaandaar *"poocha hi nahi"*, us `false` ki jagah jis par client bharosa kar leta.

### ⚠️ `features` screen chhupate hain, endpoint band nahi karte

`promoCodes: false` ka matlab hai app promo ka box na dikhaye. `create-order` phir bhi
apna hard `422` deta hai agar promo band ho — server apni enforcement khud karta hai.
Flag ko enforcement samajhna wo tareeka hai jisse feature UI me "off" hota hai aur API par
khula.

### ⚠️ Ye whitelist hai, "Setting minus kuch" nahi

`Setting` me commission percentage, reserve rates, settlement timing aur gateway-fee
bearer bhi hain. `helpers/settings/getAppConfig.js` **har field naam lekar** banata hai —
kyunki ek `...spread` us line par bilkul normal dikhta aur platform ki economics public
kar deta.

**Admin ise `PUT /settings/update` ke `app` block se badalta hai.** Partial PATCH safe
hai: sirf `support` bhejne par `features` waise hi rehte hain.

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

### 🆕 Naye modules (v1.1.0) — customer app inko use na kare

| Module | Endpoints | Kiske liye |
|---|---:|---|
| `/promoCodes/*` | 6 | **Admin only** (`router.use(isAdmin)`). Subscription promo codes ka management. Vendor bhi manage nahi karta — wo sirf `/transactions/subscribe/preview` me code redeem karta hai |
| `/subscribeds/*` | 8 | Admin (6) + Vendor (2). Brand subscription lifecycle — grant, cancel, resync, forfeit compensation |
| `/notifications/*` | 7 → **sirf 3 chhodo** | ✅ Chaar customer ke liye hain aur upar documented hain — [#37](#37-get-notificationsget-all-), [#38](#38-put-notificationsmark-read-), [#38a](#38a-get-notificationspreferences-), [#38b](#38b-put-notificationspreferences-). Baaki teen — `GET|PUT /notifications/admin/preferences` aur `POST /notifications/broadcast` — **admin-only** hain (`isAdmin`); broadcast platform ke har user tak pahunch sakta hai |
| `/auth/set-password` · `/forgot-password` · `/reset-password` | 3 | Technically role-agnostic hain, par customer app WhatsApp OTP se login karta hai — password flow ki zarurat nahi |
| `/transactions/*` | 9 | Vendor + Admin payments, Razorpay webhook, dispute worklist |
| `/brands/admin/verifications*` · `/brands/verifications/history` | 3 | Brand KYC review queue aur audit trail |
| `/brands/onboarding/acknowledge-approval` | 1 | Vendor onboarding step |

**Total not-for-customer:** 114 endpoints (149 total − 35 customer)

Full categorization → [endpoints_category.md](./endpoints_category.md)

---

# Appendix B — Known Issues

Ye backend issues hain jo customer app ko directly affect karte hain. **Status 2026-09-04 ko code ke against verify kiya gaya** — har entry `routes/`, validators aur services padhkar, kisi doosre doc par bharosa karke nahi. Full technical detail + suggested fixes → [security_findings.md](./security_findings.md)

## ✅ Jo fix ho gaya

### `POST /auth/logout` kuch karta hi nahi tha — FIXED 🆕
**Pehle:** controller sirf ek line log karke `200` de deta tha. Na push band hota tha, na
`isLoggedIn` neeche aata tha, na koi token khatam hota tha. App ko alag se
`PUT /deviceTokens/unregister` maarna padta tha, aur na maare to logged-out phone par
notifications aate rehte the.

**Ab:** `pushToken` bhejein to usi device ka push band; `allDevices: true` bhejein to har
device ka JWT aur push dono khatam (kho gaye phone ka jawab). Flags dono taraf se sahi
hote hain — aur wo teen login paths bhi theek hue jo inhe kabhi set hi nahi karte the,
WhatsApp login samet. Detail [endpoint #3](#3-post-authlogout) me.

⚠️ Saada logout phir bhi aapka JWT invalidate nahi karta — wo stateless hai aur expiry
tak valid rehta hai. App ko token khud delete karna hoga. Sirf `allDevices` tokens marta hai.

---

### "No eligible offer" error — FIXED (v1.3.0)
**Pehle:** bill kisi bhi offer ke `minBillAmount` se kam ho to preview `400` deta tha. Customer ko lagta tha uska bill hi galat hai, jabki wo bas chhota tha.

**Ab:** `200` + `offerApplied: false`. Customer sirf apna bill pay karega — koi offer, promo ya convenience fee nahi. `pricing.payableAmount` render kar dein.

---

### `isFirst` retry pe galat aata tha — FIXED
**Pehle:** OTP na aane pe user dobara signup call karta tha, to `isFirst: false` aa jaata tha — kyunki flag User document ke **hone** pe based tha, verify hone pe nahi. App use returning user samajh leta tha.

**Ab:** `isFirst` verification state pe based hai (`!user.isMobileVerified`). Jitni baar bhi retry karein, jab tak verify nahi hua `true` hi rahega.

---

### Signup adha-adhoora reh jaata tha — FIXED
**Pehle:** User ban jaata tha par `Customer` document banne me error aa jaaye to account orphan reh jaata tha — aur kyunki agli baar `isFirst: false` aata tha, user kabhi recover hi nahi kar paata tha.

**Ab:** dono ek **transaction** me bante hain. Aur agar purana orphan account mile to wo apne aap repair ho jaata hai.

---

### Shared default password — FIXED
**Pehle:** har OTP account (customer included) ek hi hardcoded password pe banta tha (`DEFAULT_PASSWORD` ya `"Trydood@123"`), aur badalne ka koi tareeka nahi tha.

**Ab:** `User.password` optional hai — OTP accounts **bina password ke** bante hain. `passwordSetAt` field track karti hai ki user ne kab apna password chuna. **Password login fail-closed hai** — jinhone set nahi kiya, unpe `/auth/login` chalega hi nahi.

**App pe impact:** kuch karna nahi hai. Customer app WhatsApp OTP se login karta hai, wo waise hi chalega. Bas ab pata hai ki customer account password-login se compromise nahi ho sakta.

---

## 🔴 Blocker — ab sirf ek bacha hai

Is section me pehle teen the. #2 (role enforcement) aur #3 (password hash) dono band ho
chuke hain aur neeche wahi likha hai. **Sirf #1 production blocker hai.**

### 1. OTP verify hota hi nahi — auth bypass · 🔴 abhi bhi OPEN
Dono OTP lines abhi bhi commented out hain:
```js
// services/auth/loginOrSignUpWithWhatsapp.js:56 — OTP send nahi hota
// services/auth/verifyOtpWithWhatsapp.js:12     — OTP verify nahi hota
```
**Matlab:** kisi ka bhi WhatsApp number pata ho to koi bhi 6-digit OTP daal ke uske account me login kiya ja sakta hai. **Production blocker.**

> ⚠️ Ye ab **pehle se zyada serious** hai — password login fix hone ke baad WhatsApp OTP hi primary entry point hai.

**App pe impact:** development me convenient (koi bhi OTP chalega), par live jaane se pehle uncomment hona zaruri hai. Uncomment hone ke baad naye error cases aayenge — endpoint #2 ke note 6 me listed hain, unko app me pehle se handle karke rakhein.

⚠️ **Aur ek: chaalu karte hi throttle live ho jaayega** — 60 second gap, 5 per hour, target number par keyed. App ko `429` handle karna hoga (`retryAfterSeconds` response me aata hai), warna resend button dabate hi user ek aisi error dekhega jiska matlab use samajh nahi aayega.

📋 Scheduled → [super admin doc, Appendix C1 #1](./super_admin_panel_api_doc.md#appendix-c--future-work).

### 2. ✅ RESOLVED — Role enforcement poora ho gaya

**Pehle:** 108 me se sirf 20 gated the. Phir 143 me se 108. Ye doc **35 endpoints ko
open** batata tha: `banners` (5), `promotionalTickers` (5), `showcase` section/media
(11), `locations` (5), `brandFeatures` (3), `workHours` (1), plus
`subBrands/get-all`, `vouchers/versions/get-all`, `brands/get`, `brands/update`,
`brands/verifications/history`.

**Ab:** un 35 me se **34 role-gated hain** — `isAdmin` (banners, tickers),
`isVendorOrAdmin` (showcase, brandFeatures writes, workHours, subBrands, locations ke
brand-side routes, brands get/update/history), aur `isCustomer` (`locations/upsert`).

**35va, `GET /locations/get/:id`, jaan-boojh kar `verifyJwtToken` par hai** — aur wo
"open" nahi hai. Ek `Location` model teen cheezein serve karta hai (customer ka address,
brand ka, outlet ka), to *kaunsi* location dikhegi ye **service me per-role** tay hota
hai: customer sirf apni, vendor sirf apne brand ki, admin koi bhi — warna `403`. Role
gate akela ise theek nahi kar sakta tha.

⚠️ Ginti [`postman/lib/routeGates.js`](../postman/lib/routeGates.js) se verify ki gayi,
jo `routes/` padhta hai — 209 me se har route ka gate.

**App pe impact:** Appendix A ke endpoints ab sach me `403` denge, sirf convention nahi
hai. Purane "app khud discipline rakhe" wale note ki zarurat nahi rahi.

---

### 3. ✅ RESOLVED (customer paths) — password hash ab response me nahi aata

**Pehle:** `#1` aur `#2` ka `user` object poora Mongoose document tha, bina kisi field
exclusion ke.

**Ab:** dono WhatsApp paths `sanitizeUser()` se guzarte hain
(`helpers/users/sanitizeUser.js`), jo `password`, `otp` aur `__v` hata deta hai —
Mongoose document ho ya plain object, aur hamesha plain object lautata hai taaki caller
galti se stripped document dobara save na kar de.

Verify kaise hua: collection ke **182 captured responses** me `"password"`, `"otp"`,
`"refreshToken"`, `"verificationResponse"`, `"accountNumber"` aur `"matchingScore"`
— chhah me se **ek bhi nahi** mila.

> ⚠️ **Ye sirf customer (WhatsApp) paths ke liye sach hai.** Email/mobile OTP aur
> password login — yani **vendor aur admin** ke entry points — abhi bhi kaccha `user`
> lautate hain. Wo customer app ke scope me nahi hain; vendor/admin doc phase me dekha
> jayega. Detail [security_findings.md](./security_findings.md) me.

**App pe impact:** kuch nahi. Field aati hi nahi.

---

## ✅ Data access issues — teeno band ho gaye

### 4. ✅ RESOLVED — `?userId` param se kisi bhi user ka data

**Pehle:** `GET /users/get?userId=<koi_bhi>` aur `PUT /users/update?userId=<koi_bhi>`
kisi bhi user ka profile padh/likh dete the.

**Ab:** dono controllers `req.userId` **token se** lete hain
(`controllers/users/getUser.js`, `updateUser.js`) — query param padha hi nahi jaata,
to bhejne se kuch nahi hota.

---

### 5. ✅ RESOLVED — `POST /locations/upsert` body me `userId`

**Pehle:** upsert `validateCreateLocation` schema udhaar leta tha, jisme `userId` accept
hota tha — to body me kisi aur ka id bhejkar uski location overwrite ki ja sakti thi.

**Ab:** `validateUpsertLocation` **apna, narrower schema** hai jisme `userId` hai hi
nahi. Ye sirf accident se nahi hua: key ko accept karte rehna use `stripUnknown` ki
pahunch se **bahar** rakh deta, isliye use hataana zaruri tha, ignore karna kaafi nahi.

Saath me `brandId` / `subBrandId` bhi gaye — create schema reuse karne ka matlab tha ki
ek customer apne ghar ke address ko **brand address** mark kar sakta tha.

---

### 6. ✅ RESOLVED — `GET /locations/get/:id` pe ownership check

**Pehle:** koi bhi location id se koi bhi address fetch ho jaata tha.

**Ab:** ownership **service me, per role** resolve hoti hai — customer sirf apni,
vendor sirf apne brand ki (bina `brandId` ke `403`), admin koi bhi. Route par gate
sirf `verifyJwtToken` hai aur wahi sahi hai: ek `Location` model teen cheezein serve
karta hai, to "signed in" ke aage ka faisla role dekhe bina liya hi nahi ja sakta.

---

### 7. ✅ RESOLVED — `/brands/get` PAN/GST/Bank expose karta tha
Ab wo endpoint `isVendorOrAdmin` ke peeche hai. Customer ke liye naya [`GET /brands/customer/get/:brandId`](#18-get-brandscustomergetbrandid) hai, jisme sirf public fields hain — sensitive lookup wahan build hi nahi hota.

**App pe impact:** naye endpoint pe shift kar dijiye. Purana ab `403` dega.

## 🟡 Functional gaps (feature adhoora hai)

### 8. `DELETE /users/delete` kuch delete nahi karta
No-op stub — poora handler route file me hi hai (`routes/users.js:9`) aur ek hardcoded message lautata hai. Detail endpoint #6 me.

**App pe impact:** "Delete Account" feature ko disable rakhein ya "coming soon" dikhayein. Store compliance risk hai — Play Store aur App Store dono maangte hain.

📋 Scheduled → [super admin doc, Appendix C1 #2](./super_admin_panel_api_doc.md#appendix-c--future-work).

### 9. Avoid kiye brands voucher feed se filter nahi hote

`POST /brandAvoidances/toggle` record banata hai par `GET /vouchers/customer/get-all` usko padhta nahi.

**App pe impact:** UI me "ye brand ab nahi dikhega" promise na karein. Ya client-side par avoid list se feed filter karein (#26 se lein).

📋 Scheduled → [super admin doc, Appendix C1 #3](./super_admin_panel_api_doc.md#appendix-c--future-work).

### 9a. ✅ RESOLVED — ab sirf verified brands dikhte hain

**Pehle:** har customer-facing surface sirf `{isDeleted: false, isActive: true}` par filter karti thi. `Brand.isApproved` par koi nahi — aur do service files me comment likha tha ki wo field "kabhi likhi hi nahi jaati", jo **galat tha**: `reviewBrandVerification` use APPROVED par `true`, REJECTED aur REVOKED par `false` likhta hai.

Nateeja: jo brand kabhi verify hua hi nahi, wo directory me aata tha — jismein chhe aise bhi the jinka owner `User` hi maujood nahi tha (khaali dabbe, na outlet na voucher).

**Ab:** ek hi shared filter `customerVisibleBrandFilter` paanchon jagah lagta hai — brand directory, brand detail, voucher feed, global search, aur showcase/clips (`assertPublicBrand` ke through).

⚠️ **App par asar:** ek unverified brand ka **deep link ab `404` deta hai**, `200` nahi. Jo link pehle share ho chuke hain wo tab tak nahi khulenge jab tak brand verify na ho — ye jaan-boojh kar hai, kyunki URL se khulna aur search me na aana wahi leak hai jo showcase endpoints me tha.

### 10. ✅ RESOLVED — voucher claim flow ab poora hai

**Pehle:** customer voucher dekh sakta tha aur discount preview kar sakta tha, par claim
nahi kar sakta tha. `VoucherUsage` model bana tha, koi route nahi. `usageType`
(`ONCE_PER_USER`) enforce nahi hota tha.

**Ab:** poora paid flow maujood hai —
[`create-order`](#17a-post-voucher-claimscreate-order) →
[`verify`](#17b-post-voucher-claimsverify) → claim listing → ek claim + timeline →
[counter par `code/:claimCode`](#17h-get-voucher-claimscodeclaimcode--code-se-kholo),
aur uske aage refunds ka poora raasta.

**`ONCE_PER_USER` ab sach me enforce hota hai**, aur wo bhi database me: partial unique
index `claim_usageSlot_oncePerUser` `{voucherId, customerId, offerId}` par, jo
`VoucherClaim.holdsUsageSlot` par key karta hai.

⚠️ Slot **claim bante hi** liya jaata hai, payment par nahi. Payment ka intezaar karna
theek wahi khidki chhod deta hai jo race ko chahiye: do checkout khule, dono ke paas
kuch nahi, dono andar.

> ⚠️ **Redeem karna customer ka action nahi hai.** `REDEEMED` status outlet ki taraf se
> aata hai — customer sirf apna claim code dikhata hai. Isliye customer app me koi
> "redeem" button nahi hai, aur uski zarurat bhi nahi.

### 11. ✅ RESOLVED — email verification ab hai

**Pehle:** email change karne pe `isEmailVerified: false` ho jaata tha, par verify karne ka
raasta nahi tha — flag sirf ek taraf ja sakta tha.

**Ab:** [`POST /auth/email/send-verification`](#35-post-authemailsend-verification-) aur
[`POST /auth/email/verify`](#36-post-authemailverify-). **Har role ke liye ek hi flow** —
customer, vendor, outlet manager, admin — kyunki `isEmailVerified` sabke `User` par hai.

`email` dono call par optional hai: na bhejein to account ka apna address confirm hota hai,
bhejein to us par switch. ⚠️ Code hamesha **naye** address par jaata hai — purane par
bhejna sirf ye sabit karta ki wo purana mailbox padh lete hain, jo sawal hai hi nahi.

**App pe impact:** email verified badge aur "change email" flow ab ban sakta hai.

### ~~12. `FIXED` discount type kaam nahi karta~~ ✅ FIXED (v1.3.0)
Enum me tha, calculation me handle nahi tha — aisa offer `discountAmount: 0` deta tha aur eligible list se filter ho jaata tha. Customer ko `"No eligible offer found for this bill amount"` dikhta tha, jaise uska bill hi galat ho.

Ab `FIXED` ko `FLAT` ka alias treat kiya jaata hai — teeno discount types kaam karte hain.

### 13. ✅ RESOLVED — `GET /app-config` ab hai

**Pehle:** min version, force-update, support contact aur feature flags sab `Setting` me
the par `GET /settings/get` `isAdmin` hai — to app unhe padh hi nahi sakti thi.
Force-update ke liye number build me hardcode karna padta, aur use badalne ke liye **wahi
update chahiye hota jo wo maang raha hai**.

**Ab:** [`GET /app-config`](#39-get-app-config-) — public, aur ek **explicit whitelist**.
Server `version` dekh kar `updateRequired` khud tay karta hai, taaki
`"1.10.0" < "1.9.0"` wali string-compare galti do apps me dobara na likhi jaaye.

### 14. ✅ RESOLVED — customer notification feed ab hai

**Pehle:** `/notifications/get-all` `isVendorOrAdmin` ke peeche tha. Customer ko sirf
**push** milta tha — history dekhne ka koi endpoint nahi.

**Ab:** [`GET /notifications/get-all`](#37-get-notificationsget-all-) aur
[`PUT /notifications/mark-read`](#38-put-notificationsmark-read-), wahi endpoint jo vendor
aur admin use karte hain — scope aur projection token se.

⚠️ Doc ka purana daava ki *"customer-facing type sirf `ANNOUNCEMENT` hai"* **galat ho chuka
tha**. `NOTIFICATION_TYPES` me pehle se `VOUCHER_PAYMENT_SUCCESS`,
`VOUCHER_PAYMENT_FAILED`, `VOUCHER_REFUNDED`, `REFUND_REQUESTED`, `REFUND_APPROVED`,
`REFUND_REJECTED`, `REFUND_FAILED`, `VOUCHER_CLAIM_RECEIVED` aur
`REFUND_BANK_DETAILS_REQUESTED` hain — aur `refundNotices` / `voucherClaimNotices` unhe
**likh bhi rahe the**. Sirf padhne ka raasta nahi tha.

## Frontend integration checklist

Doc padhne ke baad ye points dhyaan me rakhein:

**Response handling**
- [ ] **404 = empty list** — list endpoints pe 404 ko error toast na dikhayein, empty-state dikhayein
- [ ] **Nested `data.data`** — pagination responses me
- [ ] **`DELETE /users/delete` standard envelope use nahi karta** — koi `success` field nahi
- [ ] **Token expiry pe login screen** — `401 "Your session has expired..."`

**Request formatting**
- [ ] **Coordinates `[longitude, latitude]`** order me — ulta karna sabse common bug hai
- [ ] **`limit` default 10 hai** — categories/vouchers pe explicitly badhayein
- [ ] **`isActive=true` bhejein** master data + features + legal endpoints pe
- [ ] **Enums UPPERCASE** hain, `sortBy` values bhi (`DISTANCE`, `NEWEST`)
- [ ] **Voucher APIs ko coordinates chahiye** — GPS bhejein ya pehle location save karein

**Display**
- [ ] **Sab text lowercase** aata hai DB se — display pe capitalize karein
- [ ] **`bestOffer` real discount nahi hai** — actual ke liye preview endpoint (#17)
- [ ] **Banner ka media `type` pe depend karta hai** — `image`/`video`/`gif`
- [ ] **`redirect.targetId`/`url` null ho sakte hain** — navigate se pehle check
- [ ] **HTML content** terms/privacy `description` me — WebView use karein

**Security discipline**
- [ ] **`?userId` param aur body ka `userId` kabhi na bhejein**
- [ ] **PAN/GST/Bank fields ignore karein** `/brands/get` response me
- [ ] **`password` field response se drop karein** (jab aaye)
- [ ] **Appendix A ke endpoints kabhi call na karein** — 35 pe backend abhi bhi nahi rokega

**Push notifications 🆕**
- [ ] **Login ke baad `register` call karein** — role sahi map hone ke liye
- [ ] **`deviceId` zaroor bhejein** — reinstall pe dead rows na bane
- [ ] **FCM `onTokenRefresh` pe dobara register karein**
- [ ] **Logout pe `unregister` + `logout` dono** — sirf logout kaafi nahi
- [ ] **`test` endpoint pe `delivered` flag dekho**, `success` nahi

---

**Doc version:** 1.1.0 · **Last verified:** 2026-08-22 against current code
**Related docs:** [endpoints_category.md](./endpoints_category.md) · [security_findings.md](./security_findings.md) · [queries.md](./queries.md) · [authorization_plan.md](./authorization_plan.md)
**Pending:** Vendor panel doc (phase 2) · Super admin panel doc (phase 3)
