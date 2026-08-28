# Admin — Brand Directory + Account/Visibility Switches

| # | Method | Path | Access | Kaam |
|---|---|---|---|---|
| 1 | `GET` | `/trydood/v1/brands/admin/get-all` | `isAdmin` | Brand directory — triage list |
| 2 | `PUT` | `/trydood/v1/brands/admin/:brandId/status` | `isAdmin` | Vendor account on/off + (optional) customer visibility |

Iske saath **poore API pe ek naya auth gate** lag gaya hai (section 3) — wahi cheez hai jo deactivate ko *turant* effective banati hai aur vendor ko **auto-logout** karati hai.

---

## 🔑 Do switch, bilkul alag

Ye samajhna zaroori hai — poora design isi pe khada hai:

| Switch | Field | Kya karta hai | Kya **nahi** karta |
|---|---|---|---|
| **Account** | `User.isActive` | Vendor login nahi kar sakta, aur uske **64 route gates / 11 domains** har request pe refuse. Kuch naya bana/edit/publish nahi kar sakta. | Customer app pe kuch nahi badalta |
| **Visibility** | `Brand.isActive` | Brand profile, directory + Top Brands tab, aur showcase customer app se hat jaate hain | Vendor ke apne access pe koi asar nahi |

**Default se account deactivate karne pe brand customers ko dikhta rehta hai** — profile, showcase, aur uske published vouchers sab live. Vendor sirf naya kuch nahi kar sakta. Visibility bhi hataani ho to `hideFromCustomers: true` explicitly bhejein.

### Kyu dono ek saath flip nahi karte

Customer voucher listing `brand.isActive` **filter hi nahi karti** — chain hai `SubBrand(isActive) → VoucherSubBrand(isActive) → VoucherVersion(PUBLISHED + date window) → Voucher(isActive)`, brand sirf **project** hota hai. To agar hum `Brand.isActive` bhi flip kar dete, to voucher card listing me dikhta rehta par tap karne pe brand profile **404** deta — wo suspension nahi, visibly toota app hai.

---

## 1. `GET /brands/admin/get-all`

Ek row per brand, har column jo admin ko brand kholne se pehle chahiye.

### Kyu alag endpoint hai

`GET /brands/customer/get-all` customer ke liye banaya gaya hai — usme owner ke contact details, rejection reasons, billing ya deactivation trail daalne ka matlab hota ki ek galat projection edit se customer app me sensitive data leak ho jaye. Wahi wajah jisse `getCustomerBrand` aur `getBrand` alag hain.

Aur `GET /brands/get?brandId=…` (detail) se ye **halka** hai jaan-boojh kar: PAN / GSTIN / bank account / raw KYC breakdown per-brand detail hai, 100 rows me fetch karne ki cheez nahi. Is list me sirf **kaunsa step bhara hua hai** aata hai (`onboarding.hasPan` etc.).

> List batati hai **kisko attention chahiye**; detail endpoint batata hai **kyu**.

Soft-deleted brands kabhi nahi aate. **Deactivated / hidden brands hamesha aate hain** — wahi rows to admin ko wapas on karne ke liye dikhni chahiye.

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | number ≥ 1 | `1` | |
| `limit` | number 1–100 | `10` | |
| `search` | string ≤ 120 | – | `brandName` · `legalBusinessName` · `uniqueId` · `merchantId` · `email` · `mobile` · `whatsappNumber` (regex escaped, case-insensitive) |
| **`accountActive`** | boolean\|`"true"`/`"false"` | – | **Vendor ka account switch** (`User.isActive`). Na bhejo to on + off dono |
| **`isActive`** | boolean\|`"true"`/`"false"` | – | **Customer visibility** (`Brand.isActive`). Na bhejo to dono |
| `status` | enum | – | `SYSTEM_VERIFICATION_STATUS` — `PENDING` \| `APPROVED` \| `REJECTED` \| `MANUAL_REVIEW` \| `REVOKED` |
| `isApproved` · `isReviewed` · `isRejected` · `isRevoked` | boolean | – | |
| `isSubscribed` | boolean | – | `Brand.isSubscribed` mirror pe |
| `isTopBrand` | boolean | – | |
| `categoryId` · `subCategoryId` | ObjectId | – | |
| `businessEntityType` | enum | – | `BUSINESS_ENTITY_TYPE` |
| `businessRegistrationStatus` | enum | – | `REGISTERED` \| `UNREGISTERED` |
| `currentScreen` | enum | – | Vendor ka screen — **"kaun kahan atka hai"** worklist. `SCREENS` ke values |
| `fromDate` · `toDate` | ISO date | – | `joinedDate` pe, dono inclusive (`toDate` ka din pura) |
| `sortBy` | enum | `NEWEST` | `NEWEST` \| `OLDEST` \| `NAME` \| `FOLLOWERS` \| `VOUCHERS` \| `OUTLETS` \| `SUBSCRIPTION_END` \| `STATUS_CHANGED` |
| `sortOrder` | `ASC` \| `DESC` | per-column | **`NEWEST`/`OLDEST` pe ignore** — wo khud direction hain |

```
GET /brands/admin/get-all?accountActive=false&sortBy=STATUS_CHANGED
    → jo vendors abhi deactivate hue, latest pehle

GET /brands/admin/get-all?isActive=false
    → jo brands customer app se hataaye gaye hain

GET /brands/admin/get-all?accountActive=true&isActive=false
    → vendor kaam kar raha hai par brand de-listed hai (audit case)

GET /brands/admin/get-all?status=MANUAL_REVIEW&isReviewed=false&sortBy=OLDEST
    → verification queue, sabse purana pehle

GET /brands/admin/get-all?currentScreen=PAN_VERIFICATION&sortBy=OLDEST
    → PAN pe atke vendors

GET /brands/admin/get-all?isSubscribed=true&sortBy=SUBSCRIPTION_END&sortOrder=ASC
    → renewal worklist
```

### Response (200)

```jsonc
{
  "success": true,
  "message": "Brands fetched successfully.",
  "data": {
    "total": 214, "totalPages": 22, "page": 1, "limit": 10,
    "data": [
      {
        "_id": "68f1a2b3c4d5e6f7a8b9c3a1",
        // ---------- identity ----------
        "brandName": "chai point",
        "legalBusinessName": "Chai Point Foods Pvt Ltd",
        "uniqueId": "BRD-00000123",
        "merchantId": "TDMID00000123",
        "logo": "https://…", "coverImage": "https://…", "description": "…",
        "email": "owner@chaipoint.in", "mobile": "9876543210", "whatsappNumber": "9876543210",
        "businessEntityType": "COMPANY",
        "businessRegistrationStatus": "REGISTERED",
        "joinedDate": "2026-03-11T00:00:00.000Z",
        "createdAt": "2026-03-11T09:12:44.000Z",
        "updatedAt": "2026-08-20T06:41:02.000Z",

        // ---------- owner + taxonomy ----------
        "vendor": {
          "_id": "68f1…c001", "name": "Ramesh",
          "email": "ramesh@chaipoint.in", "mobile": "9876543210",
          "whatsappNumber": "9876543210", "uniqueId": "USR-00000456",
          "role": "VENDOR", "currentScreen": "DASHBOARD",
          "isActive": true,          // ← the account switch, raw
          "isLoggedIn": true, "isMobileVerified": true,
          "isSignUpCompleted": true, "isOnBoardingCompleted": true,
          "createdAt": "2026-03-11T09:10:00.000Z"
        },
        "category":    { "_id": "…", "name": "Food & Beverage", "image": "…" },
        "subCategory": { "_id": "…", "name": "Cafe", "image": "…" },

        // ---------- verification (brand pe mirrored) ----------
        "status": "APPROVED",
        "isApproved": true, "isReviewed": true, "isRejected": false, "isRevoked": false,
        "rejectionReason": null, "revokeReason": null,
        "verifiedBy": "SYSTEM",
        "verifiedAt": "…", "reviewedAt": "…", "approvedAt": "…",
        "rejectedAt": null, "revokedAt": null,
        "reviewedByAdminId": "68f1…a001", "approvedByAdminId": "68f1…a001",
        "rejectedByAdminId": null, "revokedByAdminId": null,
        "verificationAttemptCount": 1,
        "isApprovalAcknowledged": true,
        "systemVerify": {
          "_id": "…", "status": "APPROVED", "score": 92,
          "attemptNumber": 1, "isSuperseded": false,
          "isReviewed": true, "isRejected": false,
          "isRevoked": false, "isAdminApproved": true
        },

        // ---------- onboarding progress (presence only) ----------
        "onboarding": {
          "hasPan": true, "hasGst": true, "hasBank": true,
          "hasLocation": true, "hasWorkHours": true,
          "hasFirstOutlet": true, "hasSystemVerification": true,
          "hasAcceptedPartnershipDeed": true
        },

        // ---------- plan + entitlements ----------
        "isSubscribed": true,
        "subscription": {
          "subscribedId": "…", "planId": "…", "planName": "Advanced",
          "status": "ACTIVE", "source": "PAYMENT",
          "startDate": "…", "endDate": "2027-04-01T…",
          "paidAmount": 11800, "isFreeGrant": false,
          "endsInDays": 217
        },
        "usage": {
          "subBrands":  { "used": 3, "limit": 5,  "isUnlimited": false },
          "franchises": { "used": 0, "limit": 2,  "isUnlimited": false },
          "vouchers":   { "used": 8, "limit": 20, "isUnlimited": false },
          "showcase":   { "used": 2, "limit": 5,  "isUnlimited": false }
        },

        // ---------- engagement ----------
        "followersCount": 1204, "avoidanceCount": 3, "outletCount": 3,

        // ---------- curation ----------
        "isTopBrand": true, "topOrder": 2, "topAddedAt": "…",

        // ---------- SWITCH 1: vendor account ----------
        "isAccountActive": true,
        "statusChangedAt": "2026-08-20T06:41:02.000Z",
        "accountDeactivatedAt": null,
        "accountDeactivatedByAdminId": null,
        "accountDeactivationReason": null,
        "accountActivatedAt": "2026-08-20T06:41:02.000Z",
        "accountActivatedByAdminId": "68f1…a001",

        // ---------- SWITCH 2: customer visibility ----------
        "isVisibleToCustomers": true,
        "customerVisibilityUpdatedAt": null,
        "customerVisibilityUpdatedByAdminId": null
      }
    ]
  }
}
```

### Notes

**1. `isActive` response me **nahi** aata.** Jaan-boojh kar — us naam se ye clear nahi hota ki kaunsa switch hai. Do explicit fields aate hain: `isAccountActive` (vendor login kar sakta hai?) aur `isVisibleToCustomers` (brand customer app pe hai?). Raw `vendor.isActive` bhi milta hai.

**2. `subscription: null`** = brand ne kabhi plan nahi liya. `endsInDays` server-side `$$NOW` se banta hai, client ke clock se nahi — warna expiry sweep se disagree karega. Negative = plan lapse ho gaya par sweep ne abhi touch nahi kiya.

**3. `outletCount` vs `usage.subBrands.used`** — `outletCount` **live** count hai (`isActive: true, isDeleted: false` sub-brands), `usage.subBrands.used` billing mirror hai. Dono ka farak hona khud dekhne layak cheez hai.

**4. Admin ids raw hain, joined nahi** — per row 5 extra user lookups list ke liye mehenge hain. Naam chahiye to `GET /users/…`.

**5. `statusChangedAt`** = **account** switch ka last flip (`accountDeactivatedAt` ya `accountActivatedAt`; kabhi na hua ho to `createdAt`). Reactivation pe `accountDeactivatedAt` clear ho jaata hai, isliye live account ke saath purani reason nahi dikhti.

**6. Projection allow-list hai**, `{ __v: 0 }` nahi. Brand model me kal koi field add ho to wo apne aap serve hona shuru nahi hogi.

**7. Khaali result 404 hai** — `pagination()` ka platform-wide behaviour (`No any brand found`).

---

## 2. `PUT /brands/admin/:brandId/status`

### Request

```
PUT /trydood/v1/brands/admin/68f1a2b3c4d5e6f7a8b9c3a1/status
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `isActive` | boolean | ✅ | **Vendor account** ka target state |
| `hideFromCustomers` | boolean | ❌ | **Customer visibility.** Na bhejo to visibility bilkul waisi hi rehti hai |
| `reason` | string ≤ 1000 | ❌ | **Sirf `isActive: false` ke saath.** `true` ke saath bhejne pe `422` |

```jsonc
// 1. Vendor ko lock karo, brand customers ko dikhta rahe  ← default use case
{ "isActive": false, "reason": "Suspected fake GST — flagged by ops" }

// 2. Vendor lock + brand bhi customer app se hatao
{ "isActive": false, "hideFromCustomers": true, "reason": "Fraud investigation" }

// 3. Sirf brand hide karo, vendor kaam karta rahe
{ "isActive": true, "hideFromCustomers": true }

// 4. Sab wapas on
{ "isActive": true, "hideFromCustomers": false }
```

**`isActive` required kyu hai, bare flip kyu nahi** — panel ka switch pehle se jaanta hai kis taraf ja raha hai, aur explicit hone se call idempotent ho jaati hai: do admin ek saath tap karein to account us state me nahi ja sakta jo kisi ne bhi nahi chuna tha. Aur `reason` ka rule ("sirf deactivate pe") tabhi enforce ho sakta hai jab direction pata ho.

**`hideFromCustomers` ka koi default nahi** — default hota to koi bhi call jisme visibility ka zikr hi nahi, chup-chaap brand ko list/de-list kar deti. Yahi bug `validator/subBrands.js` outlet `isActive` ke liye document karta hai.

### Deactivate karne pe exactly kya hota hai

1. `User.isActive: false`, `isLoggedIn: false`, `isOnline: false`
2. Vendor ke saare active **DeviceToken retire** (push band)
3. `Brand.accountDeactivatedAt` / `…ByAdminId` / `…Reason` stamp
4. `BrandStatusHistory` me `ACCOUNT_DEACTIVATED` row
5. Vendor ko **email + in-app** notice (reason internal rehta hai)
6. Uske next kisi bhi request pe **`401` + `code: ACCOUNT_DEACTIVATED`** → app auto-logout

`Brand.isActive` chhua bhi nahi jaata (jab tak `hideFromCustomers` na bheja ho).

### Reactivate karne pe

`User.isActive: true`, **plus `User.sessionInvalidatedAt = now`** — isse suspension se pehle ka **har token turant dead** ho jaata hai. Vendor ko fresh login karna padega; purana token le kar wapas andar nahi aa sakta.

### Response (200)

```jsonc
{
  "success": true,
  "message": "Vendor account deactivated successfully.",
  "data": {
    "brandId": "68f1a2b3c4d5e6f7a8b9c3a1",
    "brandName": "chai point",
    "brandUniqueId": "BRD-00000123",
    "merchantId": "TDMID00000123",
    "vendorUserId": "68f1…c001",

    "isActive": false,                 // account switch, after
    "isVisibleToCustomers": true,      // visibility, after  ← untouched
    "actions": ["ACCOUNT_DEACTIVATED"],
    "reason": "Suspected fake GST — flagged by ops",
    "previousState": { "userIsActive": true, "brandIsActive": true },

    "accountActivatedAt": null,
    "accountDeactivatedAt": "2026-08-27T11:02:31.000Z",
    "sessionsInvalidatedAt": null,     // only set on reactivation

    "performedBy": "68f1…a001",
    "performedAt": "2026-08-27T11:02:31.000Z",
    "historyIds": ["68f1…h001"],
    "devicesRetired": 3,
    "isVendorNotified": true
  }
}
```

`actions` values: `ACCOUNT_ACTIVATED` · `ACCOUNT_DEACTIVATED` · `CUSTOMER_VISIBILITY_SHOWN` · `CUSTOMER_VISIBILITY_HIDDEN`. **Dono switch move karein to `actions` me do entries aur `historyIds` me do ids** — par vendor ko **ek hi notice** jaata hai (account wali badi khabar hai, visibility uske meta/copy me).

Messages:
| Kab | `message` |
|---|---|
| Account off (visibility bhi ho ya na ho) | `Vendor account deactivated successfully.` |
| Account on | `Vendor account activated successfully.` |
| Sirf visibility hidden | `Brand is now hidden from customers.` |
| Sirf visibility shown | `Brand is now visible to customers.` |

### Errors

| Code | Kab |
|---|---|
| `422` | `isActive` missing / non-boolean · `hideFromCustomers` non-boolean · `reason` activate ke saath · `reason` > 1000 chars · invalid `brandId` format |
| `400` | `brandId` service-level invalid |
| `404` | Brand nahi mila (ya soft-deleted) · brand ka vendor **User** row nahi mila |
| `409` | **Kuch bhi change nahi hoga** (`This account is already deactivated.` / `This brand is already in the requested state.`) · ya beech me kisi aur admin ne flip kar diya |

**`409` ka rule:** sirf tab jab **dono** switch already wahi hain jo maanga gaya. `isActive` unchanged bhejna + `hideFromCustomers` change karna **valid** hai — panel poora form post karta hai, account switch already sahi jagah ho sakta hai.

### Notes

**1. Curation touch nahi hoti.** Hidden brand DB me "Top Brands" pe pinned rehta hai — customers ko already invisible hai, aur pin clear kar dete to har temporary suspension pe admin ki curation chup-chaap khatam ho jaati. Yahi baat `docs/voucher_brand_features_plan.md` Q8 me decide hui thi.

**2. Kuch delete nahi hota.** Outlets, vouchers, showcase, followers — sab waise hi.

**3. Optimistic guards.** Account switch `User.isActive` ki purani value pe match karta hai, visibility switch `Brand.isActive` ki — jo switch move ho raha hai uska guard hi lagta hai. Do concurrent admins me se ek `409` khaata hai, silent last-write-wins nahi.

**4. Legacy rows** jinme `isActive` field hi nahi hai, "on" maane jaate hain (schema default) — guards `{ $ne: false }` / `false` use karte hain, literal match nahi.

**5. Notification vendor-facing hai, reason internal.** `reason` in-app/email body me **nahi** jaata (admin notes admin ke liye likhe jaate hain), sirf `Notification.meta.reason` me. Deactivate pe push jaan-boojh kar off hai — usi operation me device tokens retire ho rahe hain, to push apne hi token ke against race karta. Email wo channel hai jo locked-out account tak pahunchta hai. Copy bhi batati hai ki brand customers ko dikh raha hai ya nahi.

**6. Notification/device fail hona toggle ko rollback nahi karta** — `notify()` kabhi throw nahi karta, aur dono transaction ke **baad** chalte hain.

**7. Audit: `BrandStatusHistory`** (append-only), **ek row per switch jo actually move hua**. Row me action, kisne, kab, reason, aur dono flags ka before/after. Brand pe jo `account*` / `customerVisibility*` fields hain wo sirf **latest** value hain. Indexes: `{brandId, createdAt}`, `{performedBy, createdAt}`, `{action, createdAt}`.
> GET endpoint abhi expose nahi kiya — zarurat pade to `getBrandVerificationHistory` ke pattern pe seedha ban jaata hai.

**8. 🔴 `PUT /brands/update` ab `isActive` accept nahi karta** — `422` deta hai jisme naye endpoint ka naam hota hai. Silently strip nahi kiya gaya jaan-boojh kar: strip karte to panel `isActive` bhejta rehta, `200` paata, aur samajhta ki brand off ho gaya. Purana behaviour audit-less tha aur vendor ke account ko touch nahi karta tha, to dono chup-chaap disagree kar sakte the.

---

## 3. Auth gate — `helpers/auth/assertAccountAccess.js`

### Pehle kya problem thi

`user.isActive` sirf **login** pe check hota tha. Ek logged-in vendor us check se dobara guzarta hi nahi — to deactivate karne ke baad bhi uska valid token **poori token-life tak full access** deta rehta tha. Aur 7 me se **6 token-issuing paths me check hi nahi tha**, to deactivated account fresh token bhi mint kar sakta tha.

### Ab

Ek hi helper, jo **teen jagah** chalta hai: `verifyJwtToken`, `validateRoles` (API ke dono darwaze), aur **saare 7 token-issuing paths**.

| Check | Kis pe | Refusal | Bypass ho sakta? |
|---|---|---|---|
| `user.isActive === false` \| `isDeleted === true` | Har role | `401` + `code: ACCOUNT_DEACTIVATED` | Haan — 3 endpoints (neeche) |
| JWT ka `iat` < `user.sessionInvalidatedAt` | Har role | `401` + `code: SESSION_INVALIDATED` | **Kabhi nahi** |

> `Brand.isActive` gate me **consult hi nahi hota**. Wo customer visibility hai, vendor ke access se alag cheez — de-listed brand ka vendor apne panel se lock nahi hota. Gate ab **pure function** hai, koi DB query nahi (pehle per-vendor-request ek brand lookup tha).

### Auto-logout: `401`, `403` nahi

`403` ka matlab "signed in ho, par ye allowed nahi" — app interceptors us pe user ko andar hi rakhte hain. Deactivated account ko sign **out** hona hai, aur har mobile HTTP layer `401` pe wahi karti hai. Isliye deactivation `401` hai — auto-logout client ke existing interceptor se ho jaata hai, kisi custom handling ki zarurat nahi.

Role refusal ab bhi `403` hai, aur usme koi `code` nahi hota — to dono confuse nahi hote.

```jsonc
{
  "success": false,
  "message": "Your account is deactivated. Please contact support.",
  "details": { "code": "ACCOUNT_DEACTIVATED" }
}
```

**Client `details.code` pe branch kare, message pe nahi.** Enum: `constants/accountAccess.js`.

| Code | Client kya kare |
|---|---|
| `ACCOUNT_DEACTIVATED` | Token clear → login screen → "contact support" |
| `SESSION_INVALIDATED` | Token clear → login screen → "please log in again" |
| *(no code, `401`)* | Token expired → silent re-login |
| *(no code, `403`)* | Permission nahi — user ko andar hi rakho |

### `sessionInvalidatedAt` — server-side session kill

JWT revoke nahi ho sakta, wo expire hone tak valid hai. `User.sessionInvalidatedAt` wo primitive hai jo us se pehle ke saare tokens ko refuse karwa deta hai.

**Reactivation pe stamp hota hai, deactivation pe nahi** — deliberate:
- Account off hone par `isActive` khud hi har request refuse kar deta hai
- Token ko zinda chhodne se wo 3 deactivation-aware endpoints kaam karte rehte hain
- Reactivation pe stamp lagne se **koi token suspension ke aar-paar zinda nahi bachta** — vendor fresh login karega

`iat` seconds me hota hai aur stamp milliseconds me, to comparison **second granularity** pe hai (stamp truncate hota hai, token pad nahi hota) — isse same-second me bana legit token galti se nahi marta.

Ye "sign out of all devices" aur password-change pe sessions band karne ke liye bhi ready hai.

### 3 endpoints jo deactivated account bhi reach kar sakta hai

`…EvenIfDeactivated` gates (`middlewares/index.js`):

| Endpoint | Gate | Kyu |
|---|---|---|
| `POST /auth/logout` | `verifyJwtTokenEvenIfDeactivated` | Clean exit. Isko refuse karna hi wo ek cheez hai jo user ko phansa deti |
| `PUT /deviceTokens/unregister` | `verifyJwtTokenEvenIfDeactivated` | Apne phone ki push band kar sake |
| `GET /notifications/get-all` | `isVendorOrAdminEvenIfDeactivated` | Yahi wo notice aati hai jo suspension explain karti hai. Read-only, apne hi brand ka scope |

Ye sirf `isActive` check relax karte hain. **`sessionInvalidatedAt` se mara hua token yahan bhi refuse hota hai** — wo primitive "sign out everywhere" ka base hai, uska exception nahi hona chahiye.

`PUT /notifications/mark-read` exempt **nahi** hai — wo write hai, aur suspended account ko likhne ka kaam nahi.

### Ek implementation, do darwaze

`verifyJwtToken` aur `validateRoles` pehle near-duplicate the — same 40 lines token parsing, same user load, same `req` decoration, sirf aakhir me role check ka farak. Ye copy karne ki galat jagah hai: ek darwaze pe rule add karke doosre pe bhool jaana API khula chhod deta hai. Ab body `middlewares/authenticate.js` me **ek baar** hai (`buildAuthGate`), aur har exported gate usi ka call hai. JWT failure modes ke status codes bilkul waise hi rakhe gaye hain, to downstream kuch nahi badla.

### Token-issuing paths — sab seal

| Service | Pehle | Ab |
|---|---|---|
| `loginOrSignUpWithWhatsapp` | inline `isActive` check | shared gate |
| `verifyOtpWithWhatsapp` | inline `isActive` check | shared gate |
| `verifyEmailOTP` | ❌ koi check nahi | ✅ gate |
| `verifyMobileOTP` | ❌ koi check nahi | ✅ gate |
| `loginWithEmailAndPassword` | ❌ `isActive` **aur** `isDeleted` dono nahi | ✅ gate + `isDeleted: false` filter |
| `loginWithMobileAndPassword` | ❌ dono nahi | ✅ gate + `isDeleted: false` filter |
| `loginWithUsernameAndPassword` | ❌ dono nahi | ✅ gate + `isDeleted: false` filter |

Password logins me check **password match se pehle** hai, taaki suspended account pe password probe bhi na kiya ja sake. `isDeleted` query filter me hai (check ke bajaye), to deleted account "exist hi nahi karta" jaisa dikhta hai — enumeration nahi hoti.

`forgot-password` / `reset-password` pehle se `isActive` check karte the — unme kuch badla nahi.

`POST /transactions/webhook/razorpay` public hai (signature-verified), gate use touch nahi karta.

### Notes

**1. ⚠️ Ye gate har role pe lagta hai** — deactivated CUSTOMER ya ADMIN bhi mid-session block honge. Jaan-boojh kar: "deactivated ka matlab deactivated" ek hi rule hona chahiye.

**2. Cost:** zero extra DB queries. Gate pure function hai.

**3. `services/gst/createGst.js` aur `services/bank/createBank.js` ke apne `!user.isActive` checks ab reachable nahi** (gate pehle pakad leta hai). Harmless — chhode gaye.

**4. SUB_VENDOR:** `grep isSubVendor routes/` = **zero routes**. Sub-vendor abhi koi endpoint reach hi nahi karta, to "unko access rahega" aaj practically no-op hai. Wo sirf apne `isActive` ke aadheen hain — brand ke switch se unpe koi asar nahi.

**5. ⚠️ Legacy `server/` folder:** `server/service/userServices/updateUserById.js` blind `findByIdAndUpdate(User, id, updatedData)` karta hai — koi bhi field, `isActive` included, bina audit set ho sakti hai. `server/` frozen hai (`CLAUDE.md`) isliye chhoda gaya. `server2.0/services/users/updateUserById.js` safe hai: sirf `fullName` / `dob` / `email` / `appliedReferralCode` / `image` whitelist karta hai.

---

## Changed / new files

| File | Kya |
|---|---|
| `constants/brandStatus.js` | 🆕 4 actions (`ACCOUNT_*` + `CUSTOMER_VISIBILITY_*`) · limits · list sort enums |
| `constants/accountAccess.js` | 🆕 `ACCOUNT_DEACTIVATED` · `SESSION_INVALIDATED` codes + messages |
| `constants/notification.js` | 4 naye types: brand activated/deactivated + hidden/visible |
| `models/BrandStatusHistory.js` | 🆕 Append-only audit, 1 row per switch |
| `models/Brand.js` | `account*` (5) + `customerVisibility*` (2) fields; `isActive` ka comment = visibility |
| `models/User.js` | 🆕 `sessionInvalidatedAt` |
| `helpers/auth/assertAccountAccess.js` | 🆕 The gate — pure function, 401 + codes, session kill, `allowDeactivated` |
| `helpers/brands/recordBrandStatusHistory.js` | 🆕 History writer |
| `helpers/notifications/brandStatusNotices.js` | 🆕 3 vendor notices |
| `middlewares/authenticate.js` | 🆕 `buildAuthGate` — dono darwazon ke peeche ek implementation |
| `middlewares/verifyJwtToken.js` | Wrapper + `verifyJwtTokenEvenIfDeactivated` |
| `middlewares/validateRoles.js` | Wrapper + `validateRolesEvenIfDeactivated` + `isVendorOrAdminEvenIfDeactivated` |
| `services/auth/` (7 files) | Sab token-issuing paths pe gate; 3 me `isDeleted` filter bhi |
| `services/brands/getAllAdminBrands.js` | 🆕 Endpoint #1 |
| `services/brands/toggleBrandStatus.js` | 🆕 Endpoint #2 — do switch |
| `services/brands/updateBrand.js` | `isActive` handling hataayi |
| `controllers/brands/getAllAdmin.js` · `toggleStatus.js` | 🆕 |
| `validator/brands.js` | `validateGetAllAdminBrands` · `validateToggleBrandStatus` · `update` me `isActive` forbidden |
| `routes/brands.js` | Dono routes |
| `routes/auth.js` · `routes/deviceTokens.js` · `routes/notifications.js` | 3 bypass gates |
