# Security & Correctness Findings — server2.0

**Date:** 2026-08-21
**Source:** Full endpoint scan (21 route files, 108 endpoints) — jo API documentation banate waqt mila
**Context:** `queries.md` Q10b ke hisaab se ye alag doc banaya hai. Ye documentation task ka scope nahi hai — sirf record ke liye. Aap review karke decide karo kya fix karna hai.

**Total findings:** 12 (4 High, 5 Medium, 3 Low)
**Updated:** 2026-08-22 — customer doc banate waqt 6 naye findings mile (#7–#12)

| # | Finding | Severity | File |
|---|---|---|---|
| 7 | **OTP verify hi nahi hota — auth bypass** | 🔴 **High** | `services/auth/verifyOtpWithWhatsapp.js:11` |
| 1 | Role enforcement 88 endpoints pe missing | 🔴 High | `routes/*.js` |
| 2 | `/auth/register` public hai, default role `ADMIN` | 🔴 High | `routes/auth.js:26` |
| 8 | `?userId` param se kisi bhi user ka profile read/write | 🔴 High | `controllers/users/getUser.js:4`, `updateUser.js:6` |
| 9 | Auth response me bcrypt password hash aata hai | 🟠 Medium | `services/auth/loginOrSignUpWithWhatsapp.js` |
| 3 | `/brands/get` PAN/GST/Bank customer ko expose karta hai | 🟠 Medium | `services/brands/getBrand.js` |
| 4 | `showcase/section/get-all` brand scoping nahi karta | 🟠 Medium | `services/showcases/getAllSections.js:7` |
| 10 | `locations/upsert` body ka `userId` — dusre ki location overwrite | 🟠 Medium | `services/locations/upsertLocation.js:26` |
| 11 | `locations/get/:id` pe ownership check nahi | 🟠 Medium | `services/locations/getLocation.js` |
| 5 | `DELETE /users/delete` no-op stub hai | 🟡 Low | `routes/users.js:12` |
| 6 | Sub-brand accounts pe shared default password | 🟡 Low | `services/subBrands/signUpSubBrandWithWhatsapp.js:28` |
| 12 | `FIXED` discount type calculate nahi hota | 🟡 Low *(correctness)* | `helpers/voucherOffers/calculateVoucherOffer.js` |

---

## 1. 🔴 High — Role enforcement 88 endpoints pe missing

**Kya hai:** 108 endpoints me se sirf **20** pe role middleware (`isAdmin` / `isVendor`) laga hai. Baaki **88** pe sirf `verifyJwtToken` hai — matlab koi bhi valid token (customer ka bhi) chalega.

**Middleware toh exist karta hai** ([middlewares/validateRoles.js](../middlewares/validateRoles.js)) — `isAdmin`, `isVendor`, `isCustomer` teeno ready hain, bas routes pe lagaye nahi gaye.

**Concrete exploit examples** — ek normal customer apne app ka token le kar:

| Call | Kya hoga |
|---|---|
| `POST /banners/create` | App ka home banner customer create kar sakta hai |
| `POST /promotionalTickers/create` | App ka ticker customer create kar sakta hai |
| `POST /vouchers/review/:versionId` | **Customer kisi bhi voucher ko approve/reject kar sakta hai** |
| `POST /vouchers/publish/:versionId` | Approved voucher publish kar sakta hai |
| `PUT /brands/update?brandId=<koi_bhi>` | Kisi bhi brand ka naam/logo/email badal sakta hai |
| `DELETE /banners/delete/:id`, `DELETE /brandFeatures/delete/:featureId` | Data delete kar sakta hai |
| `GET /locations/getAll` | Saare brands + saare users ke addresses dekh sakta hai |
| `GET /subBrands/get-all` | Saare outlets ke number/email/storeId dekh sakta hai |
| `GET /vouchers/versions/get-all` | Sabhi brands ke draft/unpublished vouchers dekh sakta hai |

**Ek important detail:** `POST /vouchers/review/:versionId` ki service ka param hi `adminUserId` hai aur wo "Admin authentication is required" error bhi throw karta hai — lekin wo error sirf tab aata hai jab `userId` hi na ho. Role verify kahin nahi hota. Matlab intent admin-only tha, implementation reh gaya.

**Kahan-kahan lagana chahiye (module-wise):**

```js
// routes/banners.js — line 22 ke aas-paas
router.post("/create", isAdmin, validateSchema(validateCreateBanner), create);
router.put("/update/:id", isAdmin, ...);
router.get("/get-all", isAdmin, ...);
router.get("/get/:id", isAdmin, ...);
router.delete("/delete/:id", isAdmin, ...);
router.get("/customer/active", isCustomer, getActiveForCustomer);  // ya open rakho
```

| File | Kya add karna hai |
|---|---|
| `routes/banners.js` | 5 CRUD pe `isAdmin`, `customer/active` pe `isCustomer` |
| `routes/promotionalTickers.js` | Same as above |
| `routes/vouchers.js` | `review` pe `isAdmin`; `create`/`update`/`submit-review` pe `isVendor`; `customer/*` (3) pe `isCustomer`; `publish`/`versions/get-all`/`banner` pe `validateRoles(ADMIN, VENDOR)` |
| `routes/showcase.js` | section/media CRUD (11) pe `isVendor`; `get-brand-showcase` + `video-clips` pe `isCustomer`; `get-all`/`reorder` pe `validateRoles(ADMIN, VENDOR)` |
| `routes/follows.js`, `routes/brandAvoidances.js` | `isCustomer` (service me check hai, lekin route pe bhi hona chahiye — fail fast) |
| `routes/locations.js` | `upsert` pe `isCustomer`; `create`/`getAll`/`update`/`delete` pe `validateRoles(ADMIN, VENDOR)` |
| `routes/subBrands.js`, `routes/workHours.js` | `isVendor` (get-all pe `validateRoles(ADMIN, VENDOR)`) |
| `routes/brandFeatures.js` | `add`/`update`/`delete` pe `validateRoles(ADMIN, VENDOR)` |
| `routes/brands.js` | `update` pe `validateRoles(ADMIN, VENDOR)` |
| `routes/transactions.js` | `validateRoles(ADMIN, VENDOR)` |
| `routes/subscriptions.js` | `getAll`/`get` pe `validateRoles(ADMIN, VENDOR)` |

**Ownership check ka alag issue:** Role lagane ke baad bhi ek problem bachti hai — **vendor A, vendor B ka data edit kar sakta hai**, kyunki ye endpoints resource ka owner verify nahi karte:

- `PUT /showcase/section/update/:sectionId` — sectionId kisi bhi brand ka ho sakta hai
- `DELETE /showcase/section/delete/:sectionId`
- Saare 5 media endpoints (`:sectionId` + `:mediaId`)
- `PUT /vouchers/update/:voucherId`, `POST /vouchers/submit-review/:voucherId`
- `POST/DELETE /vouchers/:voucherId/banner`
- `PUT /subBrands/update/:subBrandId`
- `PUT /brandFeatures/update/:featureId`, `DELETE /brandFeatures/delete/:featureId`
- `PUT /locations/update/:id`, `DELETE /locations/delete/:id`

Achhi baat: `POST /showcase/section/add` sahi karta hai — `validateBrandVendor(userId)` se token se brand resolve karta hai. Wahi pattern baaki endpoints me chahiye: resource fetch karo → uska `brandId` token ke `req.brandId` se match karo → mismatch pe 403.

**Documentation pe impact:** Isi wajah se docs me `Intended` aur `Enforced` dono likh rahe hain (Q10a → Option B). Fix hone ke baad ye column simplify ho jayega.

---

## 2. 🔴 High — `/auth/register` public hai aur default role `ADMIN` hai

**File:** [routes/auth.js:26](../routes/auth.js#L26) + [validator/auth.js:16-20](../validator/auth.js#L16)

```js
// routes/auth.js — koi auth middleware nahi
router.post("/register", validateSchema(validateRegisterUser), register);
```

```js
// validator/auth.js
role: Joi.string().trim().uppercase().valid(...Object.values(ROLES)).default(ROLES.ADMIN),
```

**Kya hai:** Endpoint public hai, aur `role` na bheje to **default `ADMIN`** ban jaata hai. Matlab internet pe koi bhi valid payload (name, email, dob, whatsapp, mobile, username, password) bhej kar apne aap ko **super admin** bana sakta hai.

Aur finding #1 ke saath milakar: admin ban jaane ke baad `isAdmin`-protected endpoints (settings, categories, subscriptions) bhi khul jaate hain.

**Suggested fix — teen me se koi ek:**
1. `isAdmin` middleware lagao (sirf existing admin naya admin bana sake) — recommended
2. `role` ka default `CUSTOMER` karo aur `ADMIN` value ko validator me hi reject karo
3. Endpoint ko production me disable karo, admin seeding script se banao

---

## 3. 🟠 Medium — `/brands/get` PAN/GST/Bank details customer ko expose karta hai

**File:** [services/brands/getBrand.js](../services/brands/getBrand.js)

**Kya hai:** Customer app ke brand profile page ko brand detail chahiye, aur wahi endpoint use hoga. Lekin ye aggregation 14 lookups karta hai:

`users` · **`pans`** · **`gsts`** · **`banks`** · `locations` · `systemverifies` · `subscribeds` · `categories` · `subcategories` · `workhours` · `subbrands` (+ nested users/locations/workhours)

Matlab customer ko brand ka **PAN number, GST number, aur bank account + IFSC** dikh jaata hai. Subscription/billing data bhi.

Note: `users` lookup me `password`, `otp`, `refreshToken` properly excluded hain — wo sahi hai. Bas PAN/GST/Bank pe wo protection nahi hai.

**Suggested fix — do options:**
1. Role-based projection — service me `role` param lo, customer ke liye `pans`/`gsts`/`banks`/`systemverifies`/`subscribeds` lookups skip karo
2. Alag customer endpoint — `GET /brands/customer/get/:brandId` jo sirf public fields de (brandName, logo, description, category, location, workHours, features, followerCount)

**Q18 pe aapka decision:** Option B — customer doc me as-is document karenge, aur ye finding yahan flag kar diya. Doc me bhi ⚠️ note rahega.

---

## 4. 🟠 Medium — `showcase/section/get-all` brand scoping nahi karta

**File:** [services/showcases/getAllSections.js:4-14](../services/showcases/getAllSections.js#L4)

```js
// const { validateVendorBrand } = require("../../helpers/showcase/common");

exports.getAllSections = async (userId, query) => {
  // const brand = await validateVendorBrand(userId);
  const { page, limit, search, sortBy, order, isActive, isVisible } = query;
  const match = {
    // brandId: brand._id,          ← commented out
    isActive: ..., isVisible: ..., isDeleted: false
  };
```

**Kya hai:** Brand scoping commented out hai — vendor ye call kare to **sabhi brands ke showcase sections** aa jaate hain, sirf apne nahi.

**⚠️ Q12 pe important correction:** Aapne kaha tha "Super admin ke lie he, vendor bhi krega, **brandId jaa skti he**". Lekin abhi `brandId` query param **kaam nahi karega**, do wajah se:

1. **Service isko read hi nahi karta** — destructure me `brandId` nahi hai (line 8)
2. **Validator isko strip kar deta hai** — [validator/showcase.js:40-52](../validator/showcase.js#L40) me `validateGetAllSections.query` me `brandId` define nahi hai, aur `validateSchema` middleware `stripUnknown: true` ke saath chalta hai — matlab `?brandId=xyz` bheja to wo request me se hat jayega

Iska matlab: agar admin ko brand-wise filter karna hai aur vendor ko apna hi data chahiye, to ye endpoint **code change ke bina wo nahi kar sakta**. Isliye `queries.md` me **Q22** add kiya hai — batayein exact behaviour kya chahiye.

**Suggested fix:**
```js
// validator/showcase.js — validateGetAllSections.query me add karo
brandId: objectId().optional(),
```
```js
// services/showcases/getAllSections.js
exports.getAllSections = async (userId, query, role) => {
  const { brandId, page, limit, ... } = query;
  // VENDOR → apna brand force karo, brandId query ignore
  // ADMIN  → brandId query optional, na ho to sab dikhao
```

---

## 5. 🟡 Low — `DELETE /users/delete` no-op stub hai

**File:** [routes/users.js:12-14](../routes/users.js#L12)

```js
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```

**Kya hai:** Kuch delete nahi hota — na soft delete, na hard delete. Success message aata hai aur bas. Controller/service exist hi nahi karta.

**Impact:**
- **Data-privacy compliance** — app stores (Play Store / App Store) account deletion mandatory karte hain. Ye endpoint pass hone ka bharam deta hai lekin actually kuch nahi karta
- Customer app "Delete Account" button dabayega, success dikhega, user logout ho jayega, lekin account zinda rahega
- Response format bhi baaki API se different hai — `sendSuccess` envelope use nahi karta, raw `res.json` hai

**Suggested fix:** Proper implementation — `User.isDeleted = true` + linked `Customer`/`Brand` soft delete + `Follow`/`BrandAvoidance`/`Location` cleanup + token invalidate. Ya jab tak implement na ho, endpoint hi hata do (silent failure se explicit 404 behtar hai).

**Q4 pe aapka decision:** Option A — customer doc me ⚠️ "Not implemented — no-op" warning ke saath document hoga.

---

## 6. 🟡 Low — Sub-brand accounts pe shared hardcoded default password

**File:** [services/subBrands/signUpSubBrandWithWhatsapp.js:28](../services/subBrands/signUpSubBrandWithWhatsapp.js#L28)

```js
user = await User.create({
  whatsappNumber,
  role: ROLES.SUB_VENDOR,
  password: process.env.DEFAULT_PASSWORD || "Trydood@123",
  ...
});
```

**Kya hai:** Har `SUB_VENDOR` (outlet) account ek hi known password pe banta hai. Fallback value **code me hardcoded** hai (`Trydood@123`) — matlab `DEFAULT_PASSWORD` env set na ho to repo padhne wala koi bhi kisi outlet account me `POST /auth/login` se ghus sakta hai.

Same pattern `loginOrSignUpWithWhatsapp.js:31` pe bhi hai (customer/vendor accounts ke liye), lekin wahan impact kam hai kyunki wo accounts OTP se login karte hain. Phir bhi password login (`/auth/login`) toh available hai hi.

**Suggested fix:**
- Hardcoded fallback hatao — `DEFAULT_PASSWORD` na mile to throw karo (fail loud, silently insecure na raho)
- Behtar: OTP-only accounts ke liye password field hi na set karo (`password: undefined`) aur password login ko block karo un accounts pe
- Ya per-account random password generate karo aur first login pe change mandatory

---

---

# 🆕 Round 2 findings (customer doc banate waqt mile)

## 7. 🔴 High — OTP verify hi nahi hota (auth bypass)

**Files:** [services/auth/verifyOtpWithWhatsapp.js:11](../services/auth/verifyOtpWithWhatsapp.js#L11) + [services/auth/loginOrSignUpWithWhatsapp.js:51](../services/auth/loginOrSignUpWithWhatsapp.js#L51)

**Kya hai:** WhatsApp login flow ke **dono** OTP steps commented out hain.

```js
// loginOrSignUpWithWhatsapp.js:51 — OTP send nahi hota
//  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
```
```js
// verifyOtpWithWhatsapp.js:11 — OTP verify nahi hota
//  await verifyOtp(whatsappNumber, otp);
```

**Impact — ye poora auth bypass hai:**

Kisi ka WhatsApp number pata hona hi kaafi hai. Do calls me uske account ka valid JWT mil jaata hai:

```bash
# Step 1 — number se user resolve
POST /auth/loginOrSignUp-with-whatsapp
{ "whatsappNumber": "9876543210", "role": "CUSTOMER" }

# Step 2 — koi bhi 6-digit OTP, token mil gaya
POST /auth/verify-otp-whatsapp
{ "whatsappNumber": "9876543210", "otp": "000000", "role": "CUSTOMER" }
→ 200 { "data": { "token": "eyJ..." } }
```

`role: "VENDOR"` ya `"ADMIN"` bhej kar unke accounts pe bhi same trick chalegi (agar us number pe wo role ka account exist karta ho).

**Ye finding #1 (role enforcement) aur #2 (public register) ke saath compound hota hai** — teeno milkar poora system open kar dete hain.

**Note:** Email/Mobile OTP flows me verification **intact** hai — sirf WhatsApp flow me commented hai. Aur `services/otps/verifyOtp.js` ka logic bhi sahi likha hua hai (hash compare, max attempts, expiry) — bas call nahi hota.

**Suggested fix:** dono lines uncomment karo. Dev/testing ke liye env flag rakho:
```js
if (process.env.SKIP_OTP !== "true") {
  await verifyOtp(whatsappNumber, otp);
}
```
Aur `SKIP_OTP` production env me kabhi set na ho — deploy checklist me daal do.

**Documentation impact:** customer doc me endpoint #1 aur #2 pe ye warning hai, aur uncomment hone ke baad aane wale naye error cases (`401 "Invalid OTP! Please try again."` etc.) pehle se list kar diye hain taaki app unko handle kar sake.

---

## 8. 🔴 High — `?userId` query param se kisi bhi user ka profile read/write

**Files:** [controllers/users/getUser.js:4](../controllers/users/getUser.js#L4) + [controllers/users/updateUser.js:6](../controllers/users/updateUser.js#L6)

```js
// getUser.js
const userId = req.query?.userId || req.userId;

// updateUser.js
const userId = req.query?.userId || req.userId;
```

**Kya hai:** Token se resolve hua `req.userId` sirf **fallback** hai — query param usse override kar deta hai. Koi ownership check nahi.

**Exploit:**
```bash
# Kisi bhi user ka poora profile (email, dob, phone, wallet, referral)
GET /users/get?userId=68f1a2b3c4d5e6f7a8b9c0d1

# Kisi bhi user ka profile update — naam, email, dob, profile picture
PUT /users/update?userId=68f1a2b3c4d5e6f7a8b9c0d1
{ "fullName": "hacked", "email": "attacker@evil.com" }
```

Read wala classic IDOR hai. **Write wala zyada serious hai** — attacker kisi ka email badal sakta hai. Aur ObjectId brute-force karna mushkil hai, par ObjectIds kai API responses me leak hote hain (`createdBy`, `userId`, `followerId`, brand ka `user[]` array) — to targets easily mil jaate hain.

**Suggested fix:** Query param support hatao, ya `isAdmin` ke peeche daalo:
```js
// Simplest
const userId = req.userId;

// Ya admin ke liye allow, warna reject
const userId = req.query?.userId
  ? (req.role === ROLES.ADMIN ? req.query.userId : throwError(403, "Forbidden"))
  : req.userId;
```

**Documentation impact:** customer doc me endpoints #4 aur #5 pe "ye param kabhi na bhejein" warning hai.

---

## 9. 🟠 Medium — Auth response me bcrypt password hash aata hai

**Files:** [services/auth/loginOrSignUpWithWhatsapp.js](../services/auth/loginOrSignUpWithWhatsapp.js) + [services/auth/verifyOtpWithWhatsapp.js](../services/auth/verifyOtpWithWhatsapp.js)

**Kya hai:** Dono services full Mongoose document return karte hain, koi field exclusion nahi:

```js
let user = await User.findOne({ whatsappNumber, role, isDeleted: false });
// ...
return { isFirst, user };   // ← password hash included
```

Matlab `POST /auth/loginOrSignUp-with-whatsapp` aur `POST /auth/verify-otp-whatsapp` ke response me bcrypt hash chala jaata hai — HTTP over the wire, client logs me, crash reports me, analytics payloads me.

Compare karo `getUserById.js` se, jo sahi karta hai:
```js
.select("-password -otp -isDeleted")
```

**Impact:** bcrypt hash direct login nahi deta, par:
- Naye users ka password ek **shared default** hota hai (`DEFAULT_PASSWORD` ya `Trydood@123` — finding #6). Ek hash mila to pata chal jaata hai kaunse accounts default password pe hain
- Offline cracking possible hai
- Client-side logs/Sentry me password hash jaana compliance issue hai

**Suggested fix:** dono services me `.select("-password -otp")` add karo, ya better — User schema me `password: { select: false }` set karo taaki default se hi exclude ho (aur jahan chahiye wahan explicitly `.select("+password")` karo — jaise `matchPassword` flow me).

---

## 10. 🟠 Medium — `locations/upsert` body ka `userId` — dusre customer ki location overwrite

**File:** [services/locations/upsertLocation.js:26](../services/locations/upsertLocation.js#L26)

```js
userId = userId || tokenUserId;   // ← body ka userId token ko override karta hai
const user = await User.findById(userId);
if (!user || user.isDeleted) throwError(404, "User not found");
if (user.role !== ROLES.CUSTOMER) throwError(403, "User is not a customer");
```

**Kya hai:** Role check achhi tarah hota hai (customer hi hona chahiye) — par check **target user** pe hota hai, caller pe nahi. Matlab customer A, customer B ki `userId` bhej kar B ka address overwrite kar sakta hai.

Validator me `userId` explicitly allowed hai ([validator/locations.js](../validator/locations.js) — `validateCreateLocation` upsert ke liye reuse hota hai), to `stripUnknown` isko nahi hatata.

**Impact:** address tampering. Aur kyunki voucher listing customer ki saved location pe depend karti hai, address badalne se victim ka poora deals feed badal jaata hai.

**Suggested fix:** upsert ke liye alag validator banao jisme `userId` na ho, aur service me seedha `tokenUserId` use karo:
```js
exports.upsertLocation = async (tokenUserId, payload) => {
  const user = await User.findById(tokenUserId);   // body ka userId ignore
```

---

## 11. 🟠 Medium — `locations/get/:id` pe ownership check nahi

**File:** [services/locations/getLocation.js](../services/locations/getLocation.js)

```js
exports.getLocation = async (payload) => {
  const { id } = payload;
  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  return result;
};
```

**Kya hai:** ID validate hoti hai, ownership nahi. Koi bhi authenticated user kisi bhi location ka poora record padh sakta hai — doosre customers ke ghar ke addresses, brand addresses, outlet addresses, coordinates sab.

Ye finding #1 (role enforcement) se alag hai — yahan role lagane se bhi problem solve nahi hogi, kyunki customer ko apni location padhne ka haq hai, bas doosre ki nahi.

**Suggested fix:** caller context pass karo aur match karo:
```js
exports.getLocation = async (payload, { userId, role }) => {
  const result = await Location.findById(payload.id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  if (role === ROLES.CUSTOMER && String(result.userId) !== String(userId)) {
    throwError(403, "Forbidden");
  }
  return result;
};
```

Same pattern `PUT /locations/update/:id` aur `DELETE /locations/delete/:id` pe bhi chahiye (finding #1 ki ownership-check list me already hai).

---

## 12. 🟡 Low (correctness) — `FIXED` discount type calculate nahi hota

**Files:** [constants/voucher.js](../constants/voucher.js) + [helpers/voucherOffers/calculateVoucherOffer.js](../helpers/voucherOffers/calculateVoucherOffer.js)

Enum me teen types hain:
```js
const VOUCHER_DISCOUNT_TYPES = Object.freeze({
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
  FLAT: "FLAT",
});
```

Par calculation sirf do handle karta hai:
```js
if (offer.discountType === "PERCENTAGE") { ... }
if (offer.discountType === "FLAT") { ... }
// FIXED ke liye kuch nahi → discountAmount 0 rehta hai
```

**Impact:** `FIXED` type ka offer:
1. `discountAmount: 0` deta hai
2. `.filter((offer) => offer.discountAmount > 0)` se eligible list se hat jaata hai
3. Agar voucher me **sirf** `FIXED` offers hain → `400 "No eligible offer found for this bill amount."` — jo misleading error hai (bill amount ki galti nahi hai, type unsupported hai)

Vendor `FIXED` chunega to uska offer silently kaam nahi karega. Koi validation error bhi nahi aayega — [validateVoucherOffers.js](../helpers/voucherOffers/validateVoucherOffers.js) enum se validate karta hai, aur `FIXED` enum me hai.

Aur list view ka `pickBestOffer` (customer listing) `discountType` dekhta hi nahi — sirf `discountValue` sort karta hai. To `FIXED` offer list me "best offer" dikh sakta hai, par detail pe click karne pe preview fail hoga. Ye customer-facing inconsistency hai.

**Suggested fix — do options:**
1. `FIXED` ko `FLAT` ka alias banao (dono ka matlab same hai — fixed rupee amount off):
   ```js
   if (offer.discountType === "FLAT" || offer.discountType === "FIXED") {
     discountAmount = Number(offer.discountValue);
   }
   ```
2. Ya enum se `FIXED` hata do aur validator me reject karo — taaki vendor wo option chun hi na sake. Existing `FIXED` records ke liye migration chahiye hoga.

**Recommendation:** Option 1 (alias) — backward compatible hai, existing data break nahi karta.

---

## Summary — priority order

| Priority | Kya karein | Effort |
|---|---|---|
| 1 | **Finding #7 — WhatsApp OTP verify uncomment karo (env flag ke saath)** | 2 lines |
| 2 | Finding #2 — `/auth/register` pe `isAdmin` ya role default badlo | 1 line |
| 3 | Finding #8 — `?userId` query param hatao (users get/update) | 2 lines |
| 4 | Finding #9 — auth responses se password exclude karo | 2 lines |
| 5 | Finding #10 — upsert me body ka `userId` ignore karo | ~15 min |
| 6 | Finding #1 (part A) — role middleware saare routes pe lagao | ~1-2 ghante, mechanical |
| 7 | Finding #6 — hardcoded password fallback hatao | ~15 min |
| 8 | Finding #11 — `locations/get/:id` ownership check | ~20 min |
| 9 | Finding #1 (part B) — ownership checks (vendor A ≠ vendor B ka data) | ~half day |
| 10 | Finding #3 — `/brands/get` role-based projection | ~1 ghanta |
| 11 | Finding #12 — `FIXED` ko `FLAT` ka alias banao | 1 line |
| 12 | Finding #4 — `section/get-all` brandId support (Q22 → baad me) | ~30 min |
| 13 | Finding #5 — account deletion implement karo | ~2 ghante |

**Top 5 mile kar ~30 minute ka kaam hai** aur system ka sabse bada exposure band ho jaata hai.

---

## Positives (jo already sahi hai)

Scan me ye achhi cheezein bhi dikhi — record ke liye:

- ✅ **Password/OTP/token leak nahi hote** — `getBrand.js` ke `users` lookup me `password`, `otp`, `refreshToken` explicitly excluded hain
- ✅ **JWT error handling proper hai** — `TokenExpiredError` / `JsonWebTokenError` / `NotBeforeError` alag-alag messages ke saath handle hote hain
- ✅ **Transactions correctly use hote hain** — voucher create, follow/avoidance toggle, brand update — sab `session.withTransaction` me hain
- ✅ **File upload rollback** — voucher/banner create fail ho to uploaded media cleanup ho jaata hai (`rollbackVoucherImages`, `deleteBannerMedia`)
- ✅ **Joi validation strong hai** — `stripUnknown: true` se mass-assignment se bachav, zipcode country-wise regex, coordinate range checks
- ✅ **Soft delete pattern consistent hai** — har query me `isDeleted: false`
- ✅ **Error handler centralized hai** — Mongoose validation, duplicate key (11000), CustomError sab clean messages me convert hote hain
- ✅ **`escapeRegex` use hota hai** search me — regex injection se bachav

---

**Note:** Ye findings documentation scan ka by-product hain, dedicated security audit nahi. Full audit chahiye to alag se bolo — rate limiting, CORS config (abhi `cors()` fully open hai), JWT expiry policy, refresh token flow, aur file upload validation (MIME spoofing) bhi dekhne layak hain.
