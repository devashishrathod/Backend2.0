# Authorization Middleware — Design Plan

**Date:** 2026-08-22
**Goal:** Ek unified authorization layer jo routes me declaratively lage, role enforce kare, vendor ka brand context resolve kare, aur vendor ke onboarding/approval/subscription stage ke hisaab se different gates lagaye.
**Status:** 🟡 Plan — implement karne se pehle Q1–Q6 confirm karna hai

---

## 1. Aapki requirements (jaisa main samjha)

| # | Requirement | Design me kahan |
|---|---|---|
| 1 | Common (vendor+admin) APIs pe customer ko block karo — 403 | `allowRoles(ADMIN, VENDOR)` |
| 2 | Route me seedha declare ho jaye | Named presets: `isAdmin`, `isVendor`, `isAdminOrVendor` |
| 3 | Vendor hua to `req.brandId` set ho jaye | Brand resolution step |
| 4 | Ek flag se pata chale admin hai ya vendor | `req.isAdmin` / `req.isVendor` + `req.actor` |
| 5 | Brand ke edge cases (na ho, ho, isActive) handle ho | Brand gate — 4 checks |
| 6 | Different routes pe different vendor stage chahiye (approved / subscribed) | Composable brand gates + presets |
| 7 | Security leak se bachna + optimization | Single-query resolution, minimal projection |

---

## 2. ⚠️ Teen blockers jo pehle decide karne honge

Plan implement karne se pehle ye teen cheezein clear karni zaruri hain, warna gate **sabko block kar dega**.

### 2.1 🔴 `brand.isApproved` aur `brand.status` kabhi likhe hi nahi jaate

[models/Brand.js](../models/Brand.js) me dono fields hain:
```js
status: { type: String, enum: SYSTEM_VERIFICATION_STATUS, default: "PENDING" },
isApproved: { type: Boolean, default: false },
```

Par poore codebase me **koi bhi inko set nahi karta.** Verify karne ke liye grep chalaya:
- `brand.status = ...` → **koi match nahi**
- `brand.isApproved = ...` → **koi match nahi**
- `isApproved` sirf **padha** jaata hai — [helpers/vouchers/customerListing.js:1105](../helpers/vouchers/customerListing.js#L1105) me `isVerified: item.brand.isApproved ?? false`

**Do consequences:**

1. **Customer app me har brand "unverified" dikhta hai.** Voucher listing ka `brand.isVerified` hamesha `false` aata hai — chahe brand ka KYC fully approved ho. Ye already-live bug hai.
2. **Approval gate ban hi nahi sakta** in fields pe — sab block ho jayenge.

**Actual truth kahan hai:** [services/systemVerify/verifyVendor.js:220-227](../services/systemVerify/verifyVendor.js#L220) me score-based status calculate hota hai aur ek **`SystemVerify` document** me save hota hai. Brand se link `brand.systemVerifyId` se hota hai:

```js
let status = SYSTEM_VERIFICATION_STATUS.REJECTED;
if (score >= 90)      status = APPROVED;        // + verifiedAt set
else if (score >= 75) status = MANUAL_REVIEW;
// → SystemVerify.create({ brandId, score, status, ... })
// → brand.systemVerifyId = systemVerify._id
```

**→ Q1 me decide karna hai**

---

### 2.2 🔴 Subscription state do jagah galat hai

**(a) `brand.isSubscribed` kabhi `false` nahi hota.**
[services/transactions/verifySubscribeTransaction.js:204](../services/transactions/verifySubscribeTransaction.js#L204) pe `isSubscribed: true` set hota hai. Wapas `false` karne wala **koi code nahi hai**, aur `jobs/index.js` **completely empty** hai — koi expiry cron nahi.

Matlab: ek baar subscribe kiya, `endDate` nikal jane ke baad bhi `brand.isSubscribed === true` rahega. **Forever.**

**(b) `Subscribed.isActive` hamesha `false` hai.**
Schema default `false` hai:
```js
// models/Subscribed.js
isActive: { type: Boolean, default: false },
```
Aur create karte waqt `subscribedData` me `isActive` **set hi nahi hota** ([verifySubscribeTransaction.js:83-95](../services/transactions/verifySubscribeTransaction.js#L83)).

Matlab agar gate `Subscribed.isActive === true` check karega to **koi bhi vendor pass nahi hoga.**

**(c) `isExpired: true` sirf upgrade pe set hota hai**, natural time-expiry pe nahi.

**Reliable check kya hai:** `Subscribed` doc pe `endDate > now && !isExpired`. Ye state-independent hai — kisi flag pe depend nahi karta.

**→ Q2 me decide karna hai**

---

### 2.3 ✅ `SUB_VENDOR` role ka handling — **ye ho chuka hai**

> **Ye section 2026-08-22 ki halat likhta tha. Neeche ke teeno bullets ab galat
> hain** — 2026-09-06 ko code ke against verify kiya gaya. Original text
> historical record ke liye rakha hai, sudhaar ke saath.

`ROLES.SUB_VENDOR` constants me hai, aur [signUpSubBrandWithWhatsapp.js](../services/subBrands/signUpSubBrandWithWhatsapp.js#L51) me outlet users isi role pe bante hain.

| Tab likha tha | Ab kya hai |
|---|---|
| *"`verifyJwtToken` SUB_VENDOR ke liye kuch nahi set karta"* | [authenticate.js:102](../middlewares/authenticate.js#L102) — `req.subBrandId = user.subBrandId` set hota hai |
| *"`validateRoles` me `isSubVendor` preset nahi hai"* | [validateRoles.js:19](../middlewares/validateRoles.js#L19) — hai, aur export bhi hota hai. ⚠️ Par **koi route use nahi karta** — har outlet-facing route `isVendorOrSubVendor` par hai |
| *"Koi route SUB_VENDOR ko handle nahi karta"* | **31 endpoints** khulte hain: 4 `isVendorOrSubVendor` par + 27 `verifyJwtToken` par (koi bhi logged-in role) |
| *"accounts default password ke saath ban rahe hain"* | ❌ Ab nahi. [signUpSubBrandWithWhatsapp.js:72-75](../services/subBrands/signUpSubBrandWithWhatsapp.js#L72-L75) — koi password set hi nahi hota; account OTP se authenticate karta hai, aur password tabhi banta hai jab user khud `POST /auth/set-password` se chune |

**Outlet ka verify step:** signup par outlet ke WhatsApp number par
`sendOtp(WHATSAPP, …)` jaata hai ([:94](../services/subBrands/signUpSubBrandWithWhatsapp.js#L94)).
Uske baad outlet wala `POST /auth/loginOrSignUp-with-whatsapp` se login karta
hai — `SELF_SIGNUP_ROLES` sirf usse *khud ko banane* se rokta hai, login se nahi.

`SubBrand` model me `brandId` hai, aur `User` model me `subBrandId` — resolution
wahi hai jo yahan socha gaya tha: `user.subBrandId → SubBrand.brandId`.

⚠️ **Jo abhi bhi baaki hai** — daayre ka sawaal, handling ka nahi:
`resolveActorBrand` par `String(brand.userId) !== String(userId)` → `403`, aur
SUB_VENDOR ka `userId` Brand par hota hi nahi. To us helper se guzarne wala har
kaam (vouchers, showcase, subscriptions) outlet ke liye band hai. Wo helper
**16 files** use karti hain. Poora vivaran
[super_admin_panel_api_doc.md · Appendix B #5](./super_admin_panel_api_doc.md) me.

---

## 3. Proposed design

### 3.1 Ek factory, kai presets

Sab kuch ek factory function se banega, aur uske upar readable presets honge. Routes me presets use honge, factory sirf special cases me.

```js
// middlewares/authorize.js

authorize({
  roles: [ROLES.ADMIN, ROLES.VENDOR],   // allowlist — inke alawa 403
  brand: {                              // sirf VENDOR/SUB_VENDOR pe apply hota hai
    require:     true,                  // brand doc exist kare
    active:      true,                  // brand.isActive
    verified:    false,                 // KYC approved
    partnership: false,                 // hasAcceptedPartnershipDeed
    subscribed:  false,                 // active non-expired subscription
  },
})
```

**Design principle:** `brand` gates **sirf vendor-type roles pe** chalte hain. Agar ADMIN same route hit kare, wo brand gates skip kar deta hai (admin ka apna brand nahi hota). Isse `isAdminOrVendor` type routes naturally kaam karte hain — ek hi middleware se vendor gated rahega aur admin free.

### 3.2 Presets (routes me ye use honge)

```js
const {
  isAdmin,              // ADMIN only
  isCustomer,           // CUSTOMER only
  isVendor,             // VENDOR + brand exists + active
  isVendorOnboarding,   // VENDOR + brand exists + active (koi aage ka gate nahi)
  isVendorVerified,     // ↑ + KYC approved
  isVendorSubscribed,   // ↑ + active subscription
  isAdminOrVendor,      // ADMIN | VENDOR — vendor ko brand+active chahiye, admin free
  isAdminOrVendorVerified,     // ADMIN | VENDOR(verified)
  isAdminOrVendorSubscribed,   // ADMIN | VENDOR(subscribed)
  authenticated,        // koi bhi valid token (role check nahi)
  authorize,            // raw factory — custom combos ke liye
} = require("../middlewares");
```

**Route me kaisa dikhega:**

```js
// routes/banners.js — customer ko yahan aana hi nahi chahiye
router.post("/create", isAdmin, validateSchema(validateCreateBanner), create);
router.get("/customer/active", isCustomer, getActiveForCustomer);

// routes/vouchers.js — vendor ko subscription ke baad hi allow
router.post("/create", isVendorSubscribed, validateSchema(validateCreateVoucher), create);
router.post("/review/:versionId", isAdmin, validateSchema(validateReviewVoucher), review);
router.post("/publish/:versionId", isAdminOrVendorSubscribed, ..., publish);
router.get("/versions/get-all", isAdminOrVendor, ..., getAllVersions);

// routes/brands.js — onboarding pe abhi verified/subscribed nahi maang sakte
router.post("/onboarding/add-pan-details", isVendorOnboarding, ..., addPanDetails);

// custom combo — factory se
router.put("/onboarding/accept-partnership",
  authorize({ roles: [ROLES.VENDOR], brand: { require: true, active: true, verified: true } }),
  acceptPartnershipDeed,
);
```

### 3.3 Kya set hoga request pe

Middleware pass hone ke baad har handler ko ye milega:

```js
req.userId       // ObjectId — token ka user
req.role         // "ADMIN" | "VENDOR" | "SUB_VENDOR" | "CUSTOMER"
req.user         // lean user object (password/otp exclude)

// Role flags — aapki requirement #4
req.isAdmin      // boolean
req.isVendor     // boolean
req.isSubVendor  // boolean
req.isCustomer   // boolean

// Scope IDs — role ke hisaab se
req.brandId      // VENDOR: apna brand · SUB_VENDOR: parent brand · warna undefined
req.customerId   // CUSTOMER only
req.subBrandId   // SUB_VENDOR only

// Normalized context — naya, controllers ke liye
req.actor = {
  userId, role,
  isAdmin, isVendor, isSubVendor, isCustomer,
  brandId, customerId, subBrandId,
  brand: { _id, isActive, isSubscribed, status, hasAcceptedPartnershipDeed },  // vendor ke liye
  subscription: { endDate, isExpired, daysLeft },                              // subscribed gate pe
}
```

**Backward compatibility:** `req.userId`, `req.role`, `req.user`, `req.brandId`, `req.customerId` — ye paanch already exist karte hain aur existing controllers inko use karte hain. Naya middleware **same fields same tarah set karega**, to purana code bina change chalega. Naye flags aur `req.actor` additive hain.

### 3.4 Internal flow

```
1. Token extract + verify
   ├─ header missing        → 401 "Access Denied! Missing authorization token"
   ├─ "Bearer" ke baad khali → 403 "Access Denied! Invalid authorization token format"
   ├─ expired               → 401 "Your session has expired. Please log in again."
   ├─ malformed             → 403 "Invalid or malformed token. Please log in again."
   └─ notBefore             → 403 "Token not active yet. Please try again later."

2. User fetch  (lean + minimal projection — password/otp exclude)
   ├─ not found / isDeleted → 401 "Access Denied! User not found"
   └─ isActive false        → 403 "Your account is deactivated. Please contact support."   ← NAYA

3. Role check
   └─ allowlist me nahi     → 403 "Forbidden: You do not have permission to perform this action."

4. Scope resolve
   ├─ CUSTOMER    → req.customerId
   ├─ VENDOR      → req.brandId  (+ brand doc fetch agar gate chahiye)
   └─ SUB_VENDOR  → req.subBrandId + parent req.brandId

5. Brand gates  (sirf VENDOR/SUB_VENDOR pe — ADMIN skip)
   ├─ require && brand nahi     → 404 "Brand not found. Please complete your registration."
   ├─ active  && !isActive      → 403 "Your brand account is deactivated. Please contact support."
   ├─ verified && !approved     → 403 "Your brand verification is pending. Complete KYC to continue."
   ├─ partnership && !accepted  → 403 "Please accept the partnership agreement to continue."
   └─ subscribed && !active sub → 403 "Your subscription has expired. Please renew to continue."

6. req.actor build → next()
```

### 3.5 Performance — ek query, ya do?

Abhi `verifyJwtToken` ye karta hai:
```js
// services/users/getUserById.js — verifyJwtToken isko call karta hai
User.findOne({ _id, isDeleted: false })
  .select("-password -otp -isDeleted")
  .populate({ path: "customerId", populate: { path: "locationId" } })   // ← auth ke liye faltu
```

Har single request pe ye **3 collections** hit karta hai (users + customers + locations) — sirf auth ke liye. Location data auth decision me use hi nahi hota.

**Optimization:**

| Case | Queries | Kaise |
|---|---|---|
| Koi brand gate nahi (`isAdmin`, `isCustomer`) | **1** | `User.findById().select("role customerId brandId subBrandId isActive isDeleted").lean()` |
| Brand gate hai, subscription nahi | **1** | Ek aggregation: user + `$lookup` brand |
| Subscription gate bhi hai | **1** | Same aggregation + `$lookup` subscribeds |

Matlab abhi 3 queries lagti hain, naye design me **1** — even brand gates ke saath. Ye net optimization hai.

Aggregation shape:
```js
User.aggregate([
  { $match: { _id: userId, isDeleted: false } },
  { $project: { role: 1, customerId: 1, brandId: 1, subBrandId: 1, isActive: 1, name: 1, email: 1 } },
  // needsBrand hone pe:
  { $lookup: { from: "brands", localField: "brandId", foreignField: "_id", as: "brand",
      pipeline: [{ $match: { isDeleted: false } },
                 { $project: { isActive: 1, isSubscribed: 1, status: 1, isApproved: 1,
                               hasAcceptedPartnershipDeed: 1, systemVerifyId: 1, subscribedId: 1 } }] } },
  // needsSubscription hone pe:
  { $lookup: { from: "subscribeds", localField: "brand.subscribedId", foreignField: "_id", as: "subscription",
      pipeline: [{ $project: { endDate: 1, isExpired: 1, subscriptionId: 1 } }] } },
])
```

**Optional (Q6 me):** short-TTL in-memory cache (30–60s) `userId → resolved context` pe. Auth queries repeat hoti hain (ek screen pe 5-6 API calls). Trade-off: deactivate karne pe TTL tak purana context chalega.

---

## 4. Route-wise gate mapping (proposed)

Ye mera proposal hai — Q4 me confirm karna hai.

### 🟣 ADMIN only (`isAdmin`) — 30 routes
`/auth/register` · `/auth/login` · `/banners` CRUD (5) · `/promotionalTickers` CRUD (5) · `/categories` writes (3) · `/subCategories` writes (3) · `/subscriptions` writes (3) · `/settings` (2) · `/terms-and-conditions` writes (3) · `/privacy-and-policies` writes (3) · `POST /vouchers/review/:versionId`

### 🟢 CUSTOMER only (`isCustomer`) — 12 routes
`/locations/upsert` · `/follows` (2) · `/brandAvoidances` (2) · `/banners/customer/active` · `/promotionalTickers/customer/active` · `/vouchers/customer/*` (3) · `/showcase/get-brand-showcase/:brandId` · `/showcase/:brandId/video-clips`

### 🔵 VENDOR — stage ke hisaab se 26 routes

| Gate | Routes | Kyun |
|---|---|---|
`isVendorOnboarding` <br>*(brand + active)* | `/brands/onboarding/add-basic-details` · `add-pan-details` · `add-gst-details` · `add-bank-details` · `system-verify` · `update-basic-details` · `/verification/*` (3) | Onboarding **ke dauran** hai — verified/subscribed abhi maang nahi sakte
`isVendorVerified` <br>*(+ KYC approved)* | `/brands/onboarding/accept-partnership` | KYC ke baad hi partnership deed
`isVendorSubscribed` <br>*(+ active sub)* | `/subBrands/signUp-with-whatsapp` · `/subBrands/update/:id` · `/workHours/upsert` · `/showcase/section/*` (4) · `/showcase/section/:sectionId/media/*` (5) · `/vouchers/create` · `/update/:voucherId` · `/submit-review/:voucherId` | Paid features — subscription ke baad hi

### ⚪ ADMIN + VENDOR (customer forbidden) — 40 routes

| Gate | Routes |
|---|---|
`isAdminOrVendor` | `/brands/get` · `/brands/update` · `/subBrands/get-all` · `/showcase/section/get-all` · `/showcase/section/:brandId/reorder` · `/vouchers/versions/get-all` · `/brandFeatures/add\|update\|delete` (3) · `/locations/create\|getAll\|update\|delete` (4) · `/subscriptions/getAll\|get` (2) · `/transactions/*` (2) |
`isAdminOrVendorSubscribed` | `/vouchers/publish/:versionId` · `/vouchers/:voucherId/banner` (POST + DELETE) |

### 🔓 All roles (`authenticated`) — 12 routes
`/auth/logout` · `/users/*` (3) · `/locations/get/:id` · `/categories/getAll\|get` (2) · `/subCategories/getAll\|get` (2) · `/brandFeatures/get-all\|get` (2) · legal reads (4)

> ⚠️ `/brandFeatures/get-all` aur `/get` pe customer ko allow karna hai ([queries.md Q5b](./queries.md)) — isliye `authenticated`, `isAdminOrVendor` nahi.

---

## 5. Ownership checks — alag layer (Phase 2)

Role gate lagane ke baad bhi **vendor A, vendor B ka data edit kar sakta hai** — kyunki `:sectionId`, `:voucherId`, `:subBrandId` jaise params ka owner verify nahi hota. Ye [security finding #1 (part B)](./security_findings.md) hai.

Ye **role middleware ka kaam nahi hai** (role sahi hai, resource galat hai). Iske liye alag helper:

```js
// helpers/ownership.js
assertBrandOwnership(model, resourceId, req)
// ADMIN → skip
// VENDOR → resource.brandId === req.brandId, warna 403
```

Affected: `showcase/section/update|delete` · 5 media routes · `vouchers/update|submit-review|banner` · `subBrands/update` · `brandFeatures/update|delete` · `locations/update|delete|get`

**Recommendation:** ye Phase 2 me — pehle role layer solid ho jaye, phir ownership. Warna ek saath dono karne pe testing surface bahut bada ho jayega.

---

## 6. Implementation phases

| Phase | Kya | Files | Risk |
|---|---|---|---|
| **0** | Q1/Q2 ke data fixes — approval + subscription state | `verifyVendor.js`, `verifySubscribeTransaction.js`, backfill script | Low |
| **1** | Core middleware + presets (koi route change nahi) | `middlewares/authorize.js`, `helpers/authContext.js`, `middlewares/index.js` | **Zero** — purana `verifyJwtToken`/`validateRoles` chalte rahenge |
| **2** | Low-risk routes migrate — admin-only + customer-only | `banners`, `promotionalTickers`, `settings`, `follows`, `brandAvoidances`, `categories`, `subCategories`, legal | Low |
| **3** | Vendor routes + stage gates | `brands`, `verification`, `subBrands`, `workHours`, `showcase`, `vouchers` | Medium — onboarding flow test karna hoga |
| **4** | Common routes (`isAdminOrVendor`) | `locations`, `subscriptions`, `transactions`, `brandFeatures` | Medium |
| **5** | Purana `verifyJwtToken`/`validateRoles` deprecate | `middlewares/` cleanup | Low |
| **6** | Ownership layer | `helpers/ownership.js` + affected services | Medium |

**Phase 1 pe kuch nahi tootega** — naya middleware add hoga, purana as-is rahega. Migration route-by-route hogi, to har phase independently testable hai.

---

# ❓ Queries — inko confirm karna hai

## Q1. Approval state — kaise check karein? 🔴 BLOCKING

`brand.isApproved` aur `brand.status` kabhi likhe nahi jaate (section 2.1). Truth `SystemVerify` doc me hai.

- **Option A — Write path fix karo (recommended).** Jab `SystemVerify` `APPROVED` bane, tab `brand.status` aur `brand.isApproved` bhi update karo. Gate sirf brand read karega (extra query nahi). Existing brands ke liye ek chhota backfill script. **Bonus:** customer app ka "verified brand" badge bhi theek ho jayega (abhi hamesha false hai).
- **Option B — Gate SystemVerify padhe.** Brand ke saath ek aur `$lookup`. Write path nahi chhedna padega, par har gated request pe extra lookup, aur customer-facing `isVerified` bug bana rahega.
- **Option C — Dono.** Write path fix + gate SystemVerify se verify kare (defense in depth). Sabse safe, thoda slow.

**Answer:**

---

## Q2. Subscription state — kaise check karein? 🔴 BLOCKING

`brand.isSubscribed` kabhi false nahi hota, `Subscribed.isActive` hamesha false hai, koi expiry job nahi (section 2.2).

- **Option A — Live `endDate` check (recommended).** Gate `Subscribed` doc ka `endDate > now && !isExpired` check kare. Flags pe depend nahi karta, cron ki zarurat nahi, hamesha correct. Ek extra `$lookup`.
- **Option B — Flags fix + cron.** `isActive: true` set karo create pe, aur ek daily job likho jo expired subscriptions pe `isSubscribed: false` + `isExpired: true` kare. Gate sirf `brand.isSubscribed` padhega (fastest). Par cron fail hua to expired vendors andar aa jayenge.
- **Option C — Dono.** Flags bhi fix karo (fast path) aur gate `endDate` bhi verify kare (correctness). Recommended agar aap cron bhi chahte ho.

**Answer:**

---

## Q3. `SUB_VENDOR` (outlet users) ko access dena hai? ✅ **Ho chuka — Option C**

> Ye sawaal 2026-08-22 ko khula tha. Jawab shipped hai; verify 2026-09-06.

- **Option A — Abhi skip.** `SUB_VENDOR` ko koi route access na do. Middleware me support code likh dunga (future-ready) par kisi route pe apply nahi hoga.
- **Option B — Vendor jaisa treat karo.** `req.brandId` = parent brand. Vendor ke saare routes pe allow. ⚠️ Iska matlab outlet user parent brand ka poora data edit kar sakta hai
- **✅ Option C — Limited access.** Sirf apne outlet ke routes + read-only baaki. Isme naya preset `isSubVendor` + ownership check chahiye. Zyada kaam.

**Answer: C.** Jo bana:

- `req.subBrandId` set hota hai ([authenticate.js:102](../middlewares/authenticate.js#L102)); `req.brandId` parent brand ka
- `isSubVendor` aur `isVendorOrSubVendor` presets ([validateRoles.js:19,31](../middlewares/validateRoles.js#L19))
- **31 endpoints** khulte hain — 4 `isVendorOrSubVendor` par, 27 `verifyJwtToken` par
- Ownership check har service ke andar: `assertClaimAccess` outlet ke `subBrandId` par 403 deta hai; wahi narrowing refunds, settlements aur notifications ke pipelines me

⚠️ Option C ka wo hissa jo **nahi** bana: outlet ke apne write routes
(`workHours/upsert`, apna `subBrands/update`). Wo `resolveActorBrand` ke peeche
hain, jo SUB_VENDOR ko 403 deta hai. Baaki details section 2.3 me.

**Answer:**

---

## Q4. Section 4 ka route→gate mapping sahi hai? 🟠

Specially ye 4 decisions confirm karein:

**4a.** Onboarding routes pe **koi verified/subscribed gate nahi** — sirf brand exists + active. (Warna vendor onboarding hi complete nahi kar payega.) Sahi?

**Answer:**

**4b.** `accept-partnership` pe **verified gate** — KYC approve hone ke baad hi partnership deed. Sahi hai ya isko bhi sirf onboarding rakhna?

**Answer:**

**4c.** Showcase + Outlets + WorkHours + Voucher create pe **subscribed gate**. Matlab unsubscribed vendor showcase nahi bana sakta. Sahi hai, ya kuch free tier me allow karna hai?

**Answer:**

**4d.** `/users/*` (get, update, delete) pe **koi role gate nahi** (`authenticated`) — sab apna profile manage karein. Sahi?

**Answer:**

---

## Q5. Naming — presets ke naam theek hain? 🟡

Aapne `isAdmin` style suggest kiya tha. Mera proposal:

```js
isAdmin · isCustomer · isVendor
isVendorOnboarding · isVendorVerified · isVendorSubscribed
isAdminOrVendor · isAdminOrVendorVerified · isAdminOrVendorSubscribed
authenticated · authorize (factory)
```

- **Option A** — Ye naam theek hain
- **Option B** — Chhote naam: `vendorOnboarding`, `vendorVerified`, `adminOrVendor` (bina `is` prefix)
- **Option C** — Aapke naam batayein

**Answer:**

---

## Q6. Auth caching chahiye? 🟡

Har request pe 1 DB query lagti hai (abhi 3 lagti hain). Ek 30–60s in-memory cache se wo bhi bach sakti hai.

- **Option A — Nahi, abhi skip.** 1 query already 3× better hai. Cache baad me add kar sakte hain agar load badhe. Correctness pe koi compromise nahi.
- **Option B — Haan, 30s TTL.** Tez, par account deactivate karne pe 30s tak purana access chalta rahega.
- **Option C — Haan, aur manual invalidation ke saath.** Deactivate/logout pe cache clear. Zyada code.

**Answer:**

---

## Q7. Ek chhota sawal — deactivated user pe kya karein? 🟡

Abhi `verifyJwtToken` `user.isActive` check **nahi** karta — deactivated user ka token phir bhi chalta hai. Sirf login ke waqt check hota hai.

Main naye middleware me `403 "Your account is deactivated. Please contact support."` add kar raha hoon (step 2). Confirm — ye behaviour chahiye na?

**Answer:**

---

**Answers ke baad:** Phase 0 (data fixes) → Phase 1 (middleware) → step-by-step route migration. Har phase ke baad aap test kar sakte ho, phir aage badhenge.
