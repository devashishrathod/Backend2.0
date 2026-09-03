# Voucher & Brand Features — Design Plan

**Date:** 2026-08-26
**Status:** 🟢 **Approved — implement ho raha hai**
**Next phase (abhi nahi):** customer voucher claim / transaction flow

## ✅ Confirmed decisions

| Q | Decision |
|---|---|
| **Q1** | `bannerType` me **`IMAGE`** hi jayega (jo DB me hai wahi) — koi mapping nahi |
| **Q2** | Convenience fee ka **pattern chalta rahega**, koi cap nahi — `ceil(bill/500) × 5` |
| **Q3** | Fee **original bill amount** pe — discount ke baad wale pe nahi. Isse fee stable rehti hai |
| **Q4** | Curation **model pe fields** — `isSuggested` / `isTopBrand` + order + audit stamps |
| **Q5** | Suggested **geo respect karenge, par khaali ho to fallback** — paas wale na milein to distance ignore karke top suggested dikhao |
| **Q6** | Get-all-brands me geo **optional** — coordinates do to distance-sorted, warna simple directory |
| **Q7** | Customer promo **abhi nahi** — `pricing.promoDiscount` field rahegi par hamesha `0` |
| **Q8** | Stale curation **apne aap chhup jayegi** — expired/unpublished voucher list se gayab, admin ko kuch nahi karna |

Aapke 6 requirements:

| # | Requirement | Plan me |
|---|---|---|
| 1 | Voucher list + single me `bannerType` + `bannerUrl` (null if absent) | [§1](#1-voucher-banner-fields) |
| 2 | Get all brands API | [§2](#2-get-all-brands-api) |
| 3 | Admin suggested vouchers — add/remove, customer tab + view-more | [§3](#3-admin-curation--suggested-vouchers--top-brands) |
| 4 | Admin top brands — add/remove, customer tab + view-more | [§3](#3-admin-curation--suggested-vouchers--top-brands) |
| 5 | Convenience fee slabs, pricing model me | [§4](#4-convenience-fee) |
| 6 | Koi offer valid na ho to error nahi — plain bill amount | [§5](#5-no-offer-fallback) |

---

## 1. Voucher banner fields

### Abhi kya hai

`Voucher.banner` ek nested object hai — type ke hisaab se media alag field me:

```js
banner: {
  type: { type: String, enum: ["IMAGE", "VIDEO", "GIF"], default: null },
  image: { url, storage: { provider, publicId, … } },
  video: { … },
  gif:   { … },
}
```

Customer ke dono endpoints me ye **bilkul aata hi nahi** — na list ke pipeline me project hota hai, na detail ke.

### Fix

Dono jagah **flat do fields**, jaise aapne kaha:

```json
"bannerType": "IMAGE",
"bannerUrl": "https://res.cloudinary.com/…/promo.jpg"
```

Banner na ho to **dono `null`** — key hamesha present rahegi, taaki client ko `undefined` check na karna pade.

**Kahan-kahan change hoga:**

| File | Kya |
|---|---|
| `helpers/vouchers/customerListing.js` — list pipeline (voucher lookup ka `$project`) | `banner: 1` add |
| Same file — detail pipeline | `banner: 1` add |
| `mapCustomerVoucherListItem` | `bannerType` + `bannerUrl` derive |
| `mapCustomerVoucherDetail` | Wahi |

Ek chhota helper banega — `pickVoucherBanner(banner)` — jo type dekhkar sahi sub-field se `url` uthaye, taaki dono mappers me logic duplicate na ho.

⚠️ `storage` (Cloudinary `publicId`, `bucket`, `key`) **kabhi expose nahi hoga** — sirf `url`.

> ❓ **Q1** — enum naming, niche dekhein.

---

## 2. Get all brands API

### Abhi kya hai

Koi brands-list endpoint hai hi nahi. `GET /brands/get` sirf **ek** brand deta hai, aur wo ab `isVendorOrAdmin` hai.

### Naya endpoint

```
GET /brands/customer/get-all
```

Customer ke liye — brand directory + "Top Brands" tab, dono isi se.

**Query params:**

| Param | Type | Default | Kya karta hai |
|---|---|---|---|
| `page` | number | `1` | |
| `limit` | number | `10` | max 50 |
| `search` | string | – | `brandName` pe match |
| `categoryId` / `subCategoryId` | ObjectId | – | Filter |
| `topOnly` | boolean | `false` | **`true`** → sirf top brands (wo tab). **`false`** → sab, **top pehle** |
| `sortBy` | string | `TOP_FIRST` | `TOP_FIRST` \| `NEWEST` \| `FOLLOWERS` \| `NAME` |
| `latitude` / `longitude` | number | – | ❓ Q6 pe depend |

**Response shape** — customer brand profile ka chhota version (list card ke liye):

```json
{
  "total": 47, "totalPages": 5, "page": 1, "limit": 10,
  "data": [
    {
      "_id": "…",
      "brandName": "cafe mocha",
      "description": "artisanal coffee",
      "logo": "https://…/logo.jpg",
      "coverImage": "https://…/cover.jpg",
      "uniqueId": "#TB000078",
      "followersCount": 1240,
      "isVerified": true,
      "isTopBrand": true,
      "category":    { "_id": "…", "name": "food & beverages" },
      "subCategory": { "_id": "…", "name": "cafe" },
      "outletCount": 4
    }
  ]
}
```

Poora detail (features + showcase + outlets) `GET /brands/customer/get/:brandId` pe hi rahega — list me wo bhaari padega.

---

## 3. Admin curation — suggested vouchers & top brands

Dono ka pattern **bilkul same** hai, to ek hi design.

### Storage — do options

**Option A — model pe fields** *(recommended)*

`Voucher` aur `Brand` pe:

```js
isSuggested:     { type: Boolean, default: false, index: true },   // Voucher
suggestionOrder: { type: Number,  default: 0 },
suggestedAt:     { type: Date,    default: null },
suggestedBy:     userField,
```
```js
isTopBrand:  { type: Boolean, default: false, index: true },       // Brand
topOrder:    { type: Number,  default: 0 },
topAddedAt:  { type: Date,    default: null },
topAddedBy:  userField,
```

✅ Existing pipelines me seedha `$sort` ho jaata hai — koi extra lookup nahi
✅ `PromotionalTicker` ka `displayOrder` + `createdBy` pattern hi follow karta hai
⚠️ "Kab hataya gaya tha" ka history nahi rehta

**Option B — alag collection** (`VoucherSuggestion`, `TopBrand`)

✅ Poora audit trail (kisne kab add/remove kiya)
✅ Date-ranged curation possible (jaise banners me hai)
⚠️ Har list query me ek aur lookup
⚠️ Zyada code

> ❓ **Q4**

### Admin endpoints (Option A maankar)

| Method | Endpoint | Kya |
|---|---|---|
| `PUT` | `/vouchers/admin/suggestions/:voucherId` | Add / remove / reorder |
| `GET` | `/vouchers/admin/suggestions` | Suggested list (admin view) |
| `PUT` | `/brands/admin/top-brands/:brandId` | Add / remove / reorder |
| `GET` | `/brands/admin/top-brands` | Top brands (admin view) |

**Body:**
```json
{ "isSuggested": true, "suggestionOrder": 1 }
```

Ek hi endpoint add aur remove dono karta hai (`isSuggested: false` = remove) — jaise `subBrands/update` me `isActive` handle hota hai. Reorder ke liye `suggestionOrder`.

### Customer side

**Vouchers** — `GET /vouchers/customer/get-all` me naye params:

| Param | Behaviour |
|---|---|
| `suggestedOnly=true` | Sirf suggested — **"Suggestions" tab** |
| *(default)* | Sab, **suggested pehle** — **"View more"** |

Sort order: `isSuggested desc` → `suggestionOrder asc` → phir aapka chuna hua `sortBy` (`DISTANCE` default).

**Pagination apne aap sahi rehti hai** — suggested page 1 ke top pe aayenge, aur page 2 pe repeat nahi honge, kyunki wo ek hi sorted result set hai. Alag se dedupe nahi karna padega.

**Brands** — bilkul wahi, `topOnly` param se.

---

## 4. Convenience fee

### Aapka rule

> "1 se 500 tak to 5 rs, 1 se 1000 tak to 10rs, 1 se 1500 tak to 15rs, 1 se 2000 tak to 20 rs"

Ye slabs hain — har **₹500 block pe ₹5**:

| Bill | Fee |
|---|---:|
| ₹1 – 500 | ₹5 |
| ₹501 – 1000 | ₹10 |
| ₹1001 – 1500 | ₹15 |
| ₹1501 – 2000 | ₹20 |

Formula: `ceil(billAmount / 500) × 5`

> ❓ **Q2** — ₹2000 ke upar kya? Pattern chalta rahe (₹2500 → ₹25, ₹10000 → ₹100), ya ₹20 pe cap?

### Kahan store hoga

`Setting.customer` abhi **khaali hai** (`// Future customer settings`) — yahi sahi jagah hai:

```js
const convenienceFeeSchema = new mongoose.Schema({
  isEnabled:  { type: Boolean, default: true },
  slabSize:   { type: Number, default: 500 },   // har itne rupaye pe…
  feePerSlab: { type: Number, default: 5 },     // …itni fee
  maxFee:     { type: Number, default: null },  // null = koi cap nahi
}, { _id: false });
```

Aur `helpers/settings/getCustomerConfig.js` — baaki config helpers jaisa (DB jeet'ta hai, constants sirf fallback).

Isse admin `PUT /settings/update` se slab badal sakta hai, code change kiye bina.

### Pricing model

`calculateVoucherOffer` ka return shape badlega — ab ek **saaf breakdown**:

```json
{
  "billAmount": 1200,
  "offerApplied": true,
  "selectedOffer": {
    "offerId": "…", "title": "30% off above 500",
    "discountType": "PERCENTAGE", "discountValue": 30,
    "minBillAmount": 500, "maxDiscountAmount": 300,
    "discountAmount": 300
  },
  "eligibleOffers": [ … ],
  "pricing": {
    "billAmount":       1200,
    "discountAmount":   300,
    "promoDiscount":    0,
    "convenienceFee":   15,
    "payableAmount":    915,
    "totalSavings":     300
  }
}
```

`pricing` alag object me isliye hai ki client ko arithmetic na karni pade — checkout screen seedha ye rows render kare. `helpers/subscribeds/buildOrderSummary.js` bhi yahi pattern follow karta hai.

> ❓ **Q3** — fee **bill amount** pe lagegi ya **discount ke baad wale amount** pe?

---

## 5. No-offer fallback

### Abhi kya hota hai

`calculateVoucherOffer` **do jagah throw** karta hai:

```js
if (!Array.isArray(offers) || !offers.length) {
  throwError(400, "No offers available for this voucher.");
}
…
if (!eligibleOffers.length) {
  throwError(400, "No eligible offer found for this bill amount.");
}
```

Customer ko lagta hai uske bill ki galti hai, jabki wo sirf minimum se kam hai.

### Fix

Dono jagah **throw hatana** — success return karo, bas offer `null`:

```json
{
  "billAmount": 300,
  "offerApplied": false,
  "selectedOffer": null,
  "eligibleOffers": [],
  "pricing": {
    "billAmount":     300,
    "discountAmount": 0,
    "promoDiscount":  0,
    "convenienceFee": 0,
    "payableAmount":  300,
    "totalSavings":   0
  }
}
```

**Aapne kaha tha "koi offer, promocode or convenience fee nahi lagegi"** — to `offerApplied: false` hone pe convenience fee bhi **0** rahegi. Customer sirf apna bill pay karega.

✅ **Blast radius sirf 1 hai** — `calculateVoucherOffer` ka ek hi caller hai (`previewCustomerVoucher`), to ye change safe hai.

⚠️ `billAmount <= 0` pe **throw hi rahega** (`"Valid bill amount is required."`) — wo genuine input error hai, business case nahi.

---

## 6. Implementation order — ✅ sab complete

| # | Kya | Status | Verify |
|---|---|---|---|
| 1 | Banner fields (list + detail + helper) | ✅ Done | 9/9 |
| 2 | No-offer fallback + `pricing` block | ✅ Done | 33/33 |
| 3 | Convenience fee (settings + helper + wiring) | ✅ Done | ↑ same run |
| 4 | Curation fields + admin endpoints (voucher + brand) | ✅ Done | 69/69 |
| 5 | Customer sorting (`suggestedOnly` / `topOnly`) | ✅ Done | ↑ same run |
| 6 | Get all brands API | ✅ Done | ↑ same run |

Har step scratch DB (`Trydood2_curation_scratch`) pe verify hua, run ke baad drop.
Production `Trydood2` pe ek bhi write nahi gaya.

### Naye endpoints

| Method | Endpoint | Gate |
|---|---|---|
| `GET` | `/brands/customer/get-all` | `isCustomer` |
| `PUT` | `/brands/admin/top-brands/:brandId` | `isAdmin` |
| `GET` | `/brands/admin/top-brands` | `isAdmin` |
| `PUT` | `/vouchers/admin/suggestions/:voucherId` | `isAdmin` |
| `GET` | `/vouchers/admin/suggestions` | `isAdmin` |

### Naye query params (existing endpoints pe)

| Endpoint | Param | Kya |
|---|---|---|
| `GET /vouchers/customer/get-all` | `suggestedOnly` | Suggestions tab |

### Naye response fields

| Endpoint | Field |
|---|---|
| `GET /vouchers/customer/get-all` | `bannerType`, `bannerUrl`, `isSuggested`, `isOutOfRange` (top-level) |
| `GET /vouchers/customer/get/:voucherId` | `bannerType`, `bannerUrl` |
| `POST /vouchers/customer/voucher/preview` | `offerApplied`, `pricing.convenienceFee`, `pricing.promoDiscount` |

### Do implementation notes jo plan me nahi the

1. **Admin lists filter nahi karti** — `GET /vouchers/admin/suggestions` expired/unpublished vouchers bhi dikhata hai, aur `GET /brands/admin/top-brands` deactivated brands bhi. Customer tab me wo chhupe rehte hain (Q8). Wajah: admin ko unpin karne ke liye wo row **dikhni** chahiye — filter kar dete to wo list me se gayab ho jati par flag DB me pinned hi रह jata.

2. **Fallback sirf poori khaali tab pe** — `suggestedOnly` me agar paas ka ek bhi pin mil gaya to door wale nahi aayenge. Geo tabhi ignore hota hai jab tab bilkul empty ho (Q5). Response me `isOutOfRange: true` isi case me aata hai.

---

# ❓ Queries

## Q1. `bannerType` me kaunsi values?

Aapne kaha "photo video or gif", par existing enum `VOUCHER_BANNER_TYPE` me **`IMAGE`** hai (`IMAGE` / `VIDEO` / `GIF`).

Codebase me dono naming chal rahi hain — showcase media `PHOTO`/`VIDEO` use karta hai, banner `IMAGE`/`VIDEO`/`GIF`.

- **Option A — `IMAGE` hi rakho** *(recommended)* — jo DB me store hai wahi bhejo, koi mapping nahi
- **Option B — customer response me `PHOTO` bhejo** — DB me `IMAGE` rahega, sirf output me map hoga
- **Option C — enum hi rename karo `PHOTO`** — ⚠️ existing data + vendor upload flow + admin panel sab break honge

**Answer:**

---

## Q2. ₹2000 se upar convenience fee?

Formula `ceil(bill / 500) × 5` hai.

- **Option A — pattern chalta rahe** — ₹2500 → ₹25, ₹5000 → ₹50, ₹10000 → ₹100
- **Option B — ₹20 pe cap** — ₹2000 ke upar hamesha ₹20
- **Option C — koi aur cap** — bata dijiye kitna

**Answer:**

---

## Q3. Convenience fee kis amount pe calculate hogi?

Example: bill **₹600**, offer 30% off → discount **₹180**

- **Option A — original bill pe** *(recommended)*
  Slab ₹600 → fee **₹10**. Payable = 600 − 180 + 10 = **₹430**
  ✅ Fee stable rehti hai, offer badalne pe nahi badalti — customer ko predictable lagti hai
  ✅ `eligibleOffers` me har offer ke saath ek hi fee dikhani padegi

- **Option B — discount ke baad wale amount pe**
  420 → slab fee **₹5**. Payable = 420 + 5 = **₹425**
  ⚠️ Har offer ka apna fee hoga, to `eligibleOffers` ki har row me alag fee dikhani padegi

**Answer:**

---

## Q4. Curation kaise store karein?

- **Option A — model pe fields** *(recommended)* — `isSuggested` / `isTopBrand` + order + audit stamps. Simple, existing pipelines me seedha sort
- **Option B — alag collection** — poora add/remove history, date-ranged curation possible, par har query me extra lookup

**Answer:**

---

## Q5. Suggested vouchers geo filter respect karenge?

Customer ki voucher list **geo-scoped** hai — sirf `maxDistanceKm` (default 25 km) ke andar wale outlets ke vouchers aate hain.

- **Option A — haan, geo respect karo** *(recommended)*
  Suggested wahi dikhenge jo customer actually use kar sakta hai. Door ka suggested chhup jayega
  ⚠️ Alag-alag shehar ke customers ko alag suggestions dikhengi — admin ko "khaali tab" bhi mil sakta hai

- **Option B — nahi, suggested hamesha dikhao**
  Admin ne pin kiya hai to sabko dikhe, distance chahe kuch bhi ho
  ⚠️ Customer ko aisa voucher dikhega jise wo redeem karne 200 km jaana padega

**Answer:**

---

## Q6. "Get all brands" me geo chahiye?

- **Option A — nahi, simple directory** *(recommended for now)* — name/category/followers pe sort, koi coordinates nahi
- **Option B — haan, nearest-first** — brand ke outlets pe `$geoNear`, voucher list jaisa. Zyada bhaari, par "aas paas ke brands" possible
- **Option C — optional** — `latitude`/`longitude` bhejo to distance-sorted, warna simple

**Answer:**

---

## Q7. Customer-side promo code — abhi scope me hai?

Aapne kaha *"koi offer, promocode or convenience fee nahi lagegi"* — par abhi `previewCustomerVoucher` me **promo code ka koi handling hai hi nahi**. `PromoCode` model sirf **vendor subscription checkout** ke liye use hota hai (`/transactions/subscribe/preview`).

- **Option A — abhi nahi** *(recommended)* — `pricing.promoDiscount` field response me rahegi par hamesha `0`. Next phase (claim/transaction) me wire karenge
- **Option B — abhi hi customer promo add karo** — alag design chahiye: customer promo codes vendor wale se alag honge? Kaun banayega? Kis pe apply?

**Answer:**

---

## Q8. Suggested / top ka `isActive` se rishta?

Agar admin ne koi voucher suggest kiya, aur baad me wo voucher **expire** ho gaya ya vendor ne **unpublish** kar diya —

- **Option A — apne aap chhup jaye** *(recommended)* — customer list already sirf `PUBLISHED` + valid-date vouchers dikhati hai, to suggested flag rehne ke bawajood wo list se gayab ho jayega. Admin ko manually hataana nahi padega
- **Option B — admin ko warning dikhao** — admin ke suggestions list me "ye ab live nahi hai" badge

Same sawaal brands ke liye — brand deactivate/delete ho jaye to top list se?

**Answer:**

---

**Answers ke baad:** step-by-step implement karunga, har step ke baad verify. Uske baad next phase — customer voucher claim / transaction flow.
