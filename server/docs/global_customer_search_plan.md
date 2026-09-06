# Global Customer Search — Implementation Plan

> ## ✅ Ye ban chuka hai — par ye doc "kya banana tha" hai, "kya hai" nahi
>
> **Saaton phase live hain (2026-09-04).** Har faisle ka *kyun* yahin likha hai aur kahin
> nahi — isliye doc waise ka waisa rakha gaya hai. Implement karte waqt jahan is plan se
> hatna pada wo **§15** me hai, aur kya-kya verify hua wo **§16** me.
>
> ⚠️ Is doc aur aaj ke code me farak mile to **code sahi hai**.
>
> **Scope:** customer home screen ke top wale search box ka backend — ek global search
> API, uske results, aur search history (+ delete).
> **Auth:** poora module **token-less** — guest aur signed-in customer dono chalayenge.
> Sirf history wale endpoints ko token chahiye.
> **Date:** 2026-09-04

---

## 0. Locked decisions

Ye sab aapse confirm ho chuke hain. Implement karte waqt inme se kisi se hatna pade to
pehle poocha jayega.

| # | Sawaal | Faisla |
|---|---|---|
| 1 | Search me kya-kya aayega | **Vouchers · Brands · Categories · Sub-categories · Areas** — paanchon |
| 2 | Result ka structure | **Type-wise sections**, har section me `total` + top N rows |
| 3 | Location na ho to | **Optional** — brands/categories chalte rahenge, voucher section khaali aayega `locationRequired: true` ke saath |
| 4 | Search history kiski | **Sirf signed-in customer ki**, server pe. Guest ki history app ke device pe |
| 5 | History kab likhi jaye | **Sirf `commit=true` pe** — as-you-type calls kuch save nahi karti |
| 6 | Trending / popular | **Admin manually set karega** — koi query logging nahi |
| 7 | Area pe click | **Us area ke coordinates** lautao, app apni location wahan switch kare |
| 8 | History delete | **Dono** — ek entry hataana aur poori history clear karna |
| 9 | Ek type ki poori list | **`/search` pe `type` + `page` mode** — AREA ke paas apna listing endpoint nahi hai, aur ye chaaron types ke liye bhi chal jayega |

---

## 1. Aaj kya maujood hai

Ye plan zero se nahi shuru ho raha. Adha kaam pehle se banaa pada hai:

| Cheez | Kahan | Search ke kaam ka kaise |
|---|---|---|
| `optionalAuth` middleware | [middlewares/verifyJwtToken.js](../middlewares/verifyJwtToken.js) | Token-less requirement isi se poori ho jayegi. Header na ho to guest, ho to **valid hona chahiye** — expired token chupke se guest me downgrade nahi hota |
| Brand directory + `search` | [getAllCustomerBrands.js](../services/brands/getAllCustomerBrands.js) | `brandName` pe escaped regex, location optional. Brand section ka base |
| Voucher listing pipeline | [helpers/vouchers/customerListing.js](../helpers/vouchers/customerListing.js) | `$geoNear` → VoucherSubBrand → published version → voucher → brand. Voucher section isi ko reuse karega, naya pipeline nahi banega |
| Category / sub-category listing | [getAllCategories.js](../services/categories/getAllCategories.js) · [getAllSubCategories.js](../services/subCategories/getAllSubCategories.js) | `search` param pehle se hai, dono public hain |
| `escapeRegex` | [validator/common.js:18](../validator/common.js#L18) | Har regex isi se guzregi — bina iske `.` ya `(` type karte hi query blow up hoti |
| `pagination(..., { allowEmpty })` | [utils/pagination.js](../utils/pagination.js) | ⚠️ Default me **404 throw karta hai** khaali page pe. Search me khaali normal hai — har jagah `allowEmpty: true` |
| `Setting.customer.*` + `PUT /settings/update` | [models/Setting.js](../models/Setting.js) | Search ke limits aur admin ki popular list yahin baithegi |

### Do rukawatein jo pehle se maujood hain

**1. Voucher search bina location ke ho hi nahi sakta.**
[getCustomerVouchers.js:47](../services/vouchers/getCustomerVouchers.js#L47) — coordinates na ho
aur customer ka saved address bhi na ho to `400`. Pipeline ka pehla stage `$geoNear` hai, aur
`$geoNear` **pipeline ka pehla stage hi ho sakta hai** — to ise "optional" banane ka matlab ek
poora doosra pipeline likhna hota. Isliye faisla #3: location na ho to voucher section
skip, baaki sab chalta rahe.

**2. Outlet ka apna koi naam hai hi nahi.**
[models/SubBrand.js](../models/SubBrand.js) me `storeId`, `uniqueId`, `locationId` hain —
`name` nahi. To "Domino's Andheri" naam se outlet search nahi ho sakta. AREA section isliye
`Location.city` pe chalega, outlet ke naam pe nahi.

---

## 2. Endpoints

Naya router `routes/search.js` — auto-mount se `/trydood/v1/search` pe chadh jayega.

| # | Method | Path | Gate | Kya |
|---|---|---|---|---|
| 1 | GET | `/search` | `optionalAuth` | Global search — sections |
| 2 | GET | `/search/history` | `isCustomer` | Meri recent searches |
| 3 | DELETE | `/search/history/:historyId` | `isCustomer` | Ek entry hataao |
| 4 | DELETE | `/search/history` | `isCustomer` | Poori history clear |
| 5 | GET | `/search/popular` | *(public)* | Admin ki curated list |

`PUT /settings/update` pehle se hai — usme bas naya `customer.search` block support karna hai.

### Route order

`/history` aur `/popular` literal paths hain, aur `/search` pe koi `:param` nahi hai — to
collision ka koi risk nahi. Phir bhi `/history/:historyId` ko `/history` ke **baad** likhenge,
jaisa [routes/brands.js](../routes/brands.js) me `customer/get-all` ko `customer/get/:brandId`
se pehle likha gaya hai.

---

## 3. `GET /search` — contract

### Query params

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `q` | string | ✅ | – | Trimmed, `minQueryLength`–100 chars. Chhota ho to `422` |
| `latitude` · `longitude` | number | ❌ | – | Saath me hi bhejein (`.and()`), warna `422`. Na bhejein to voucher section skip |
| `types` | CSV | ❌ | sab | `VOUCHER,BRAND,CATEGORY,SUB_CATEGORY,AREA` me se koi bhi. **Overview mode me hi** |
| `type` | enum | ❌ | – | Ek hi type. Diya to **single-type mode** (§3b) — response shape badal jata hai |
| `page` | number | ❌ | `1` | Sirf single-type mode me. Overview mode me diya to `422` |
| `limit` | number | ❌ | `5` / `10` | Overview me per-section rows (max 20); single-type mode me page size (max 50) |
| `commit` | boolean | ❌ | `false` | `true` = ye query history me likho. Dono mode me chalta hai |

Endpoint ke **do mode** hain, aur `type` hi decide karta hai kaunsa:

- **Overview** (`type` nahi) — saare sections, har ek me top N. Home search box ka default.
- **Single-type** (`type=AREA`) — ek hi section, paginated. "See all" ke liye.

⚠️ `types` (plural, overview filter) aur `type` (singular, mode switch) alag cheezein hain.
Dono ek saath aaye to `422` — chup-chaap ek ko ignore karna wo galti hai jise koi debug nahi
kar paata.

### Signed-in customer ke liye location fallback

Agar `latitude`/`longitude` nahi aaye **par token hai**, to customer ka saved address
use hoga — bilkul waise hi jaise `getCustomerVouchers` karta hai. Iske liye wahi
`Customer → locationId → Location.geo` hop dobara likhne ki jagah use ek helper me nikalenge
(§8), taaki dono jagah ka behaviour ek hi rahe.

Guest ko coordinates khud bhejne padenge — uske paas saved address hai hi nahi.

### Response — `200`

```jsonc
{
  "success": true,
  "message": "Search results fetched",
  "data": {
    "query": "pizza",
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
            "id": "68f1…c0a1",
            "title": "Domino's Pizza",
            "subtitle": "Food & Beverages · 12 outlets",
            "image": "https://res.cloudinary.com/…/dominos-logo.jpg",
            "meta": {
              "isTopBrand": true,
              "isVerified": true,
              "followersCount": 4821,
              "outletCount": 12,
              "distanceInMeters": 2310
            },
            "target": {
              "screen": "BRAND_PROFILE",
              "endpoint": "/brands/customer/get/68f1…c0a1"
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
            "id": "68f2…d1b7",
            "title": "Buy 1 Get 1 on Large Pizza",
            "subtitle": "Domino's Pizza · Andheri West · 1.1 km",
            "image": "https://res.cloudinary.com/…/voucher.jpg",
            "meta": {
              "brandId": "68f1…c0a1",
              "brandName": "Domino's Pizza",
              "bestOffer": { "title": "Buy 1 Get 1", "…": "…" },
              "endAt": "2026-10-31T18:29:59.000Z",
              "distance": "1.1 km",
              "distanceInMeters": 1104
            },
            "target": {
              "screen": "VOUCHER_DETAIL",
              "endpoint": "/vouchers/customer/get/68f2…d1b7"
            }
          }
        ],
        "seeAll": {
          "endpoint": "/vouchers/customer/get-all",
          "params": { "search": "pizza", "latitude": 19.1364, "longitude": 72.8296 }
        }
      },
      {
        "type": "CATEGORY",
        "label": "Categories",
        "total": 1,
        "items": [
          {
            "type": "CATEGORY",
            "id": "68f0…b3e1",
            "title": "Food & Beverages",
            "subtitle": "6 sub-categories · 48 brands",
            "image": "https://res.cloudinary.com/…/food.jpg",
            "meta": { "subCategoryCount": 6, "brandCount": 48, "voucherCount": 130 },
            "target": {
              "screen": "CATEGORY_LISTING",
              "endpoint": "/vouchers/customer/get-all",
              "params": { "categoryId": "68f0…b3e1" }
            }
          }
        ],
        "seeAll": { "endpoint": "/categories/getAll", "params": { "search": "pizza" } }
      },
      { "type": "SUB_CATEGORY", "label": "Sub-categories", "total": 0, "items": [], "seeAll": { "…": "…" } },
      {
        "type": "AREA",
        "label": "Areas",
        "total": 3,
        "items": [
          {
            "type": "AREA",
            "id": "andheri west|maharashtra",
            "title": "Andheri West",
            "subtitle": "Maharashtra · 23 outlets · 11 brands",
            "image": null,
            "meta": {
              "city": "Andheri West",
              "state": "Maharashtra",
              "latitude": 19.1364,
              "longitude": 72.8296,
              "outletCount": 23,
              "brandCount": 11
            },
            "target": {
              "screen": "LOCATION_SWITCH",
              "params": { "latitude": 19.1364, "longitude": 72.8296, "label": "Andheri West" }
            }
          }
        ],
        "seeAll": { "endpoint": "/search", "params": { "q": "andheri", "type": "AREA" } }
      }
    ]
  }
}
```

### Response ke design faisle

**Har item ka ek hi envelope** — `type` · `id` · `title` · `subtitle` · `image` · `meta` ·
`target`. App ek hi row component se paanchon types render kar sakti hai; jo type-specific
hai wo `meta` me hai. Naya type add karne pe app ko naya parser nahi likhna padta.

**`target` server bhejta hai, app hardcode nahi karti.** Kal ko voucher detail ka path badla
to ek jagah badlega. Yahi `seeAll` ke saath bhi — section apna "see all" endpoint aur uske
params khud batata hai.

**Khaali section bhi aata hai** (`total: 0`, `items: []`), gayab nahi hota. App ko "Brands me
kuch nahi mila" dikhana ho to uske paas section hona chahiye. Aur `totalResults === 0` se
"kuch bhi nahi mila" wala state saaf pata chalta hai.

**`404` kabhi nahi.** Kuch na milna search ka normal jawab hai, missing resource nahi.
Isliye har jagah `pagination(..., { allowEmpty: true })` — [utils/pagination.js](../utils/pagination.js)
ka apna comment yahi rule likhta hai.

---

## 3b. Single-type mode — `?type=…&page=…`

```http
GET /search?q=andheri&type=AREA&page=2&limit=20
```

```jsonc
{
  "success": true,
  "message": "Search results fetched",
  "data": {
    "query": "andheri",
    "type": "AREA",
    "hasLocation": false,
    "total": 12,
    "totalPages": 1,
    "page": 2,
    "limit": 20,
    "items": [ /* wahi item envelope jo sections me hai */ ]
  }
}
```

**Item ka shape bilkul wahi hai** jo overview ke section me hota hai — `type` · `id` ·
`title` · `subtitle` · `image` · `meta` · `target`. App ka row component dono mode me ek hi
rehta hai; sirf wrapper alag hai (`sections[]` banaam `items[]` + pagination).

**Kis type pe kaunsa mode use karein:**

| Type | "See all" kahan bheje |
|---|---|
| AREA | **Yahin** — `?type=AREA`. Iske alawa koi raasta hai hi nahi |
| BRAND · VOUCHER | Behtar hai apne listing endpoints (§5) — wahan category filter, sort presets, distance sab hai, jo yahan nahi |
| CATEGORY · SUB_CATEGORY | Dono chal jayenge. `/categories/getAll?search=` ke paas `isActive`, date filter aur sort hai |

Yani `type` mode chaaron ke liye kaam karta hai, par sirf AREA ke liye **zaroori** hai. Ye
jaan-boojh kar hai: app chahe to sab jagah ek hi shape use karke simple reh sakti hai, aur
jahan richer filter chahiye wahan asli listing endpoint pe ja sakti hai. Section ka `seeAll`
field batata hai kaunsa behtar hai — app hardcode na kare.

**`page` overview mode me `422` deta hai.** Overview me paanch sections hain; "page 2" ka
matlab hi nahi banta, aur usko chup-chaap ignore karne se app dev ghanton dhoondhta rahega
ki uska `page=2` kyun kaam nahi kar raha.

---

## 4. Har section kaise match karega

### BRAND

```
Brand: { isActive: true, isDeleted: false, brandName: /q/i }
```

Aaj brand directory jo karti hai wahi — escaped regex `brandName` pe. `description` pe
**nahi**: ek lambi description me "pizza" hone se woh brand pizza ka brand nahi ban jata,
aur search box me shor sabse mehnga hota hai.

**Ranking:** exact match → prefix match → contains, phir `isTopBrand`, phir `followersCount`.
`$switch` + `$indexOfCP` se ek `matchRank` field banega. Iske bina "Pizza Hut" ke upar
"Tony's Pizza Corner" aa sakta hai.

Row me `outletCount` aur (location ho to) `distanceInMeters` — dono `getAllCustomerBrands`
me pehle se compute hote hain.

### VOUCHER

Poora `buildCustomerVoucherPipeline` **jaisa hai waisa reuse** hoga — `search: q`,
`sortBy` default (DISTANCE). Naya pipeline bilkul nahi.

⚠️ **`sortBy=RELEVANCE` jaan-boojh kar nahi.** RELEVANCE `$text` index use karta hai, aur
`$text` **prefix match nahi karta** — "piz" type karne pe "pizza" nahi milega, poora shabd
chahiye. Search box me customer aadha shabd hi type karta hai. Default (non-relevance) path
`voucher.name` pe regex chalata hai, jo substring/prefix dono pakadta hai.
[customerListing.js:288](../helpers/vouchers/customerListing.js#L288) wahi branch hai.

Ye pipeline pehle se `maxDistanceKm` (Setting, default 25) ke andar hi dekhta hai, to regex
ka candidate set chhota rehta hai.

**Ek chhota extension:** aaj regex sirf `voucher.name` pe hai. Offer ka title
(`version.offers[].title`) bhi match karna chahiye — "buy 1 get 1" naam me nahi, offer me
likha hota hai. Ye `$match` me ek `$or` add karne ka kaam hai:
`{ $or: [ { "voucher.name": /q/i }, { "version.offers.title": /q/i } ] }`.
⚠️ Ye badlaav `/vouchers/customer/get-all` ko bhi asar karega, kyunki pipeline shared hai —
matlab wahan bhi search behtar ho jayegi. Chahein to search-only rakhne ke liye pipeline me
ek flag pass kar sakte hain; recommendation: **dono jagah rakhein**, kyunki listing me bhi
yahi sahi behaviour hai.

### CATEGORY · SUB_CATEGORY

```
Category:    { isActive: true, isDeleted: false, name: /q/i }
SubCategory: { isActive: true, isDeleted: false, name: /q/i }
```

Bahut sasta — aaj poore DB me 8 categories aur 19 sub-categories hain. Wahi exact → prefix →
contains ranking.

Row ka `subtitle` abhi-abhi bane `stats` se aayega (`GET /categories/getAll` ka `stats` block),
to "6 sub-categories · 48 brands" free me mil jata hai — [buildTaxonomyStats.js](../helpers/taxonomy/buildTaxonomyStats.js)
ka wahi helper.

⚠️ Category ke naam DB me mixed-case padein hain ("Luxury Hotels") jabki `createCategory`
lowercase karta hai. Search case-insensitive hai to fark nahi padta, par `title` jo DB me hai
wahi jayega — app capitalize kare.

### AREA

Ye sabse naya hai. Source: `Location` rows jo kisi **live outlet** ki hain.

```
Location: { subBrandId: { $exists: true }, isActive: true, isDeleted: false, city: /q/i }
  → $lookup SubBrand   (isActive, isDeleted: false)
  → $lookup Brand      (isActive, isDeleted: false)
  → $group by { city: $toLower(city), state: $toLower(state) }
      outletCount : $sum 1
      brandCount  : $addToSet brandId → $size
      latitude    : $avg of coordinates[1]
      longitude   : $avg of coordinates[0]
      title       : $first (original casing wala city)
```

**Centroid `$avg` se** — us area ke saare outlets ka औसत point. Ek outlet ka point lene se
"Andheri West" ka matlab ek dukaan ki gali ban jata, aur customer us point pe switch karke
aadhe area ke offers 25 km radius se bahar chhod deta.

**`id` synthetic hai** (`"andheri west|maharashtra"`) — AREA koi document nahi hai, group ka
result hai. App ise sirf list key ki tarah use kare, kabhi kisi API me id ki tarah na bheje.

**Click pe kya hota hai:** app apni location `meta.latitude/longitude` pe set kar deti hai.
Home feed, voucher search — sab pehle se `$geoNear` pe hain, to sab apne aap us area ka ho
jata hai. Koi naya filter, naya pipeline, brand listing me naya `city` param — kuch nahi.

⚠️ **`city` free-text hai, normalised nahi.** "Andheri West", "andheri (w)", "Andheri  West"
teen alag groups banenge. `$toLower` + whitespace collapse se kuch milta hai, baaki nahi.
Isse search **tootegi nahi** — bas ek hi jagah do rows ki tarah dikh sakti hai. Iska asli
ilaaj address normalisation hai, jo alag kaam hai (§13).

---

## 5. "See all" — click karke poori list

Section-wise response ka poora point yahi hai: overview yahan se, aur poori list **un
endpoints se jo pehle se bane hain**, apne saare filter aur sort ke saath.

| Section | See all |
|---|---|
| BRAND | `GET /brands/customer/get-all?search=q` — filters, sort, pagination sab maujood |
| VOUCHER | `GET /vouchers/customer/get-all?search=q&latitude=&longitude=` |
| CATEGORY | `GET /categories/getAll?search=q&isActive=true` |
| SUB_CATEGORY | `GET /subCategories/getAll?search=q&isActive=true` |
| AREA | `GET /search?q=…&type=AREA&page=2` — [§3b](#3b-single-type-mode--typepage) |

**Kyun AREA alag hai:** wo kisi collection ka listing nahi, `Location` rows ka ek grouped
result hai — uske peeche koi endpoint hai hi nahi aur naya banane ka matlab wahi query
doosri jagah likhna hota. Isliye `/search` khud hi `type` mode deta hai.

Har section apna `seeAll` khud batata hai (`endpoint` + `params`), to app ko ye table
hardcode nahi karna. AREA ka `seeAll` `/search` ki taraf hi point karega:

```jsonc
"seeAll": { "endpoint": "/search", "params": { "q": "andheri", "type": "AREA" } }
```

---

## 6. Search history

### `GET /search/history` — `isCustomer`

```jsonc
{
  "success": true,
  "message": "Search history fetched",
  "data": [
    { "_id": "68f5…a1", "query": "pizza",  "searchCount": 4, "lastSearchedAt": "2026-09-04T09:12:00.000Z" },
    { "_id": "68f5…a2", "query": "salon",  "searchCount": 1, "lastSearchedAt": "2026-09-03T18:40:00.000Z" }
  ]
}
```

`lastSearchedAt` descending, `historyLimit` (default 20) tak. Khaali history **`200` + `[]`**
deti hai, `404` nahi — nayi ID ki history khaali hona bilkul normal hai.

⚠️ Guest ko ye endpoint `401` dega (`isCustomer` gate). App ko chahiye ki guest state me ye
call kare hi na — uski history device pe hai. Ye jaan-boojh kar hai: `optionalAuth` laga kar
guest ko khaali array dena "aapki history khaali hai" jaisa lagta, jabki asal me uski
history device pe padi hai.

### `DELETE /search/history/:historyId` — `isCustomer`

Ek entry hataata hai. Soft delete (`isDeleted: true`), house rule ke mutabik.

**Ownership check zaroori:** row ka `customerId` token wale customer se match hona chahiye,
warna `404`. Bina iske koi bhi customer kisi aur ki history ki id pass karke uski entry
hata sakta hai. `403` ki jagah `404` — kisi aur ki id maangne pe "ye exist karta hai par
aapka nahi" batana bhi ek leak hai.

```jsonc
{ "success": true, "message": "Search history entry removed" }
```

| Status | Kab |
|---|---|
| `404` | Id nahi mili, ya kisi aur ki hai, ya pehle se deleted |
| `422` | `historyId` valid ObjectId nahi |
| `401`/`403` | Token nahi / customer nahi |

### `DELETE /search/history` — `isCustomer`

Poori history clear. `updateMany({ customerId, isDeleted: false }, { isDeleted: true })`.

```jsonc
{ "success": true, "message": "Search history cleared", "data": { "deletedCount": 12 } }
```

Pehle se khaali history pe bhi `200` + `deletedCount: 0` — "clear karo" ka jawab "kuch tha hi
nahi" error nahi hai, customer ka intent to poora ho hi gaya.

### History likhi kab jaati hai

Sirf `GET /search?...&commit=true` pe, aur sirf tab jab caller ek **live customer** ho.

```
commit=true + customer token  -> upsert
commit=true + guest           -> kuch nahi, koi error nahi
commit=true + vendor/admin    -> kuch nahi (unka Customer record hi nahi hota)
commit absent                 -> kuch nahi
```

**Upsert, insert nahi.** `{ customerId, normalizedQuery }` pe match karke `searchCount` ko
`$inc: 1` aur `lastSearchedAt` ko abhi. Warna "pizza" 4 baar search karne pe recent list me
"pizza" 4 baar dikhega.

**Cap:** upsert ke baad `historyLimit` se purani rows soft-delete. Prune upsert ke **baad**
chalta hai, pehle nahi — warna limit pe baithi list me nayi query add karte waqt kabhi-kabhi
19 rows bachti.

**⚠️ History likhna search ko kabhi fail nahi karega.** Ye ek side effect hai, jawab nahi.
Upsert `try/catch` me hoga jo error log karke aage badh jayega —
[helpers/notifications/sendQuietly.js](../helpers/notifications/sendQuietly.js) wala hi
pattern, wahi kaaran. Customer ko results milte rehne chahiye chahe history collection pe
kuch bhi ho raha ho.

CLAUDE.md kehta hai controller me `try/catch` nahi — ye **service** me hai aur error type pe
branch nahi kar raha, best-effort side effect hai. Yahi chhoot `sendQuietly` ko bhi hai.

---

## 7. `GET /search/popular` — admin ki curated list

```jsonc
{
  "success": true,
  "message": "Popular searches fetched",
  "data": { "isEnabled": true, "queries": ["pizza", "salon", "weekend offers", "spa"] }
}
```

Public. Guest ko search box khulte hi ye chips dikhengi; signed-in customer ko apni recent
history ke neeche.

Admin `PUT /settings/update` se set karega:

```jsonc
{ "customer": { "search": { "popularQueries": ["pizza", "salon", "weekend offers"] } } }
```

> ⚠️ **`isEnabled: false` ka matlab "list khaali", endpoint band nahi.** Endpoint tab bhi
> `200` aur `queries: []` dega. Ek switch band karne se ek endpoint `404` dene lage, to app
> ka error handler use "kuch toota hai" samajh kar screen pe error dikha dega — jabki admin ne
> sirf chips hatayi thi.

---

## 8. Naya code

### Naya model — `models/SearchHistory.js`

| Field | Type | Notes |
|---|---|---|
| `customerId` | ObjectId → Customer | required |
| `query` | String | Jaisa customer ne likha — display ke liye |
| `normalizedQuery` | String | lowercase + whitespace collapse — dedupe ke liye |
| `searchCount` | Number | default 1, har repeat pe `$inc` |
| `lastSearchedAt` | Date | Sort isi pe |
| `isDeleted` | Boolean | default false |

**Index:**
```js
searchHistorySchema.index(
  { customerId: 1, normalizedQuery: 1 },
  { name: "search_history_customer_query_unique",
    unique: true,
    partialFilterExpression: { isDeleted: false } },
);
searchHistorySchema.index({ customerId: 1, isDeleted: 1, lastSearchedAt: -1 });
```

⚠️ Unique **partial** hai, blanket nahi. Blanket unique hone pe customer ek entry delete
karke wahi cheez dobara search hi nahi kar paata — purani soft-deleted row duplicate key de
deti. `partialFilterExpression: { isDeleted: false }` deleted rows ko index se bahar rakhta
hai. Yahi wo galti hai jo CLAUDE.md me `invoiceId_1` wale section me likhi hai.

⚠️ `$in` partial filter me nahi ja sakta — yahan zarurat bhi nahi, `isDeleted: false`
seedhi equality hai.

### Naya settings block — `Setting.customer.search`

| Field | Default | Kya |
|---|---|---|
| `isEnabled` | `true` | Kill switch — `false` pe `/search` `503` deta hai saaf message ke saath |
| `minQueryLength` | `2` | Isse chhoti query pe `422` |
| `sectionLimit` | `5` | Per section default rows |
| `historyLimit` | `20` | Ek customer ki kitni recent searches rakhni hain |
| `popularQueries` | `[]` | Admin ki curated chips, max 10 |

⚠️ **`updateSetting.js` ke `CUSTOMER_BLOCKS` array me `"search"` add karna zaroori hai.**
Us file ka apna comment kehta hai: jo block schema aur validator me ho par is list me na ho,
wo **`200` return karega aur kuch save nahi karega**. Chup-chaap.

⚠️ Constants `constants/customer.js` me `CUSTOMER_SEARCH_DEFAULTS` — `getCustomerConfig`
`??` se padhega, `||` se nahi. `minQueryLength: 0` galat hai par `sectionLimit` ke liye
`0`-jaisi values ka fark padta hai, aur `isEnabled: false` `||` se chup-chaap `true` ban
jayega.

### Naye files

```
models/SearchHistory.js                          (new)
constants/search.js                              (new)  SEARCH_RESULT_TYPES, SEARCH_SECTION_LABELS
constants/customer.js                            (edit) CUSTOMER_SEARCH_DEFAULTS

helpers/search/buildBrandSection.js              (new)
helpers/search/buildVoucherSection.js            (new)  customerListing pipeline reuse
helpers/search/buildTaxonomySections.js          (new)  CATEGORY + SUB_CATEGORY
helpers/search/buildAreaSection.js               (new)
helpers/search/recordSearchQuery.js              (new)  best-effort upsert + prune
helpers/search/matchRank.js                      (new)  exact > prefix > contains
helpers/search/index.js                          (new)

helpers/customers/resolveSearchLocation.js       (new)  saved-address fallback, getCustomerVouchers
                                                        se nikaal kar shared

services/search/globalSearch.js                  (new)
services/search/getSearchHistory.js              (new)
services/search/deleteSearchHistoryById.js       (new)
services/search/clearSearchHistory.js            (new)
services/search/getPopularSearches.js            (new)
services/search/index.js                         (new)

controllers/search/*.js  + index.js              (new)  5 controllers
validator/search.js                              (new)
routes/search.js                                 (new)

validator/settings.js                            (edit) customer.search block
services/settings/updateSetting.js               (edit) CUSTOMER_BLOCKS me "search"
models/Setting.js                                (edit) searchSettingSchema
helpers/settings/getCustomerConfig.js            (edit) search block
helpers/vouchers/customerListing.js              (edit) offer title bhi match kare
services/vouchers/getCustomerVouchers.js         (edit) shared location resolver use kare
models/Location.js                               (edit) city index
```

### Naye indexes

| Collection | Index | Kyun |
|---|---|---|
| `searchhistories` | `{customerId, normalizedQuery}` unique partial | Dedupe |
| `searchhistories` | `{customerId, isDeleted, lastSearchedAt: -1}` | History listing |
| `locations` | `{subBrandId: 1, city: 1}` | AREA section. Aaj `city` pe koi index nahi — bina iske har area search poori locations collection scan karegi |
| `brands` | `{brandName: 1}` | Brand regex. Prefix-anchored regex isse use karti hai; `contains` phir bhi scan karega, par top-ranked prefix matches sasti ho jati hain |

Sab non-unique (ek partial-unique ke alawa), to `reapShadowIndexes` inhe nahi chhuega.

---

## 9. Kaam kaise chalega — ek request ka poora flow

```
GET /search?q=pizza&latitude=19.1&longitude=72.8&commit=true
  │
  ├── optionalAuth          token ho to req.userId, na ho to guest
  ├── validateSchema        q, coords, types, limit, commit
  │
  └── globalSearch(userId, query)
        │
        ├── config = getCustomerConfig().search
        │     isEnabled false  -> 503
        │     q.length < min   -> 422 (Joi pehle hi pakad lega)
        │
        ├── coords resolve
        │     query me hain            -> wahi
        │     nahi, par customer hai   -> saved address
        │     nahi, guest              -> hasLocation: false
        │
        ├── Promise.all([
        │     buildBrandSection,        // hamesha
        │     buildVoucherSection,      // sirf coords ho to
        │     buildTaxonomySections,    // hamesha
        │     buildAreaSection,         // hamesha
        │   ])
        │
        ├── recordSearchQuery()   // commit && customer, best-effort
        │
        └── sections assemble -> sendSuccess(200)
```

**Saare sections `Promise.all` me** — sequential chalane pe voucher wala geo pipeline
(6 lookups) baaki sabko rok deta. Ek search box ko 200-300ms me jawab dena hai.

**Ek section fail hua to poori request fail hogi**, chup-chaap khaali section nahi aayega.
Ye jaan-boojh kar hai: khaali section aur "section toot gaya" dono ek jaise dikhte hain, aur
is codebase ki har doc yahi kehti hai ki chup failure sabse mehnga hota hai. Log me error,
customer ko `500`, aur hume pata chalta hai.

---

## 10. Edge cases — customer ko kya dikhega

| Halat | Response | Customer ka experience |
|---|---|---|
| `q` khaali ya 1 char | `422` | App 2 chars se pehle call hi na kare. Isliye `minQueryLength` config me hai |
| `q` me `.` `(` `*` jaise chars | Normal results | `escapeRegex` se guzarta hai. Bina iske `(` type karte hi `500` |
| Kuch nahi mila | `200`, saare sections `total: 0` | "koi result nahi mila" + popular chips |
| Location nahi | `200`, `hasLocation: false`, VOUCHER `locationRequired: true` | "Aas-paas ke offers dekhne ke liye location on karein" — brands/categories phir bhi dikhte hain |
| Location hai par 25 km me kuch nahi | `200`, VOUCHER `total: 0` | Alag baat hai `locationRequired` se — "aapke aas-paas is naam ka offer nahi hai" |
| Guest + `commit=true` | `200`, kuch save nahi | Kuch farq nahi dikhta. App device pe apni history rakhe |
| Search band (`isEnabled: false`) | `503` + saaf message | "Search abhi uplabdh nahi hai" — `500` nahi, taaki app "kuch toot gaya" na dikhaye |
| Expired token | `401` | ⚠️ `optionalAuth` isko guest nahi banata. Sahi hai — warna signed-in customer ko chupke se guest view milta aur wo kabhi dobara login karne ko nahi kaha jata |
| Deactivated account ka token | `401` | `assertAccountAccess` — wahi rule jo baaki har gate pe hai |

---

## 11. Phases

| Phase | Kya | Kyun is order me |
|---|---|---|
| **1** | `SearchHistory` model + `Setting.customer.search` + constants + indexes | Sabse neeche ki tehen. Iske bina baaki kuch test nahi ho sakta |
| **2** | `GET /search` — BRAND + CATEGORY + SUB_CATEGORY sections | Ye teen location ke bina chalte hain, to poora flow bina geo ke end-to-end test ho jata hai |
| **3** | VOUCHER section + location resolver | Sabse bhaari hissa, aur akela aisa jo existing pipeline chhoo raha hai |
| **4** | AREA section + `type`/`page` single-type mode | Naya matching, alag risk. Alag rakha taaki phase 3 isse na latke. `type` mode yahan isliye ki AREA hi uska ekmatra zaroori consumer hai |
| **5** | History — GET + dono DELETE + `commit=true` write | Search ke bina history ka koi matlab nahi |
| **6** | `GET /search/popular` + settings wiring | Sabse chhota, akela chal sakta hai |
| **7** | Docs — `customer_mobile_api_doc.md`, `endpoints_category.md`, Postman | ⚠️ Postman: sirf customer generator chalega, aur `git diff --stat postman/` check hoga |

---

## 12. Kya test hoga

`npm test` sirf money paths cover karta hai, aur search money path nahi hai — to repo ki
no-test convention isi tarah rahegi. Manually verify hoga, live DB ke against, read-only
script se (wahi tareeka jo abhi taxonomy counts me use hua):

- Har section ka count ek independent naive query se cross-check
- `escapeRegex` — `.` `(` `[` `\` wali queries se `500` na aaye
- History upsert — ek hi query 3 baar, ek hi row, `searchCount: 3`
- Cap prune — 25 alag queries, sirf 20 bachein
- Delete + wahi query dobara — partial unique index duplicate key na de
- Do alag customers — ek dusre ki history na dikhe, na delete ho paye
- Guest call — `commit=true` ke saath bhi koi row na bane
- Bina location — VOUCHER `locationRequired: true`, baaki sections bharay hue

---

## 13. Jo jaan-boojh kar nahi kar rahe

| Cheez | Kyun nahi |
|---|---|
| Typo tolerance / "did you mean" | Fuzzy matching ke liye Atlas Search ya n-gram index chahiye. Regex + `$text` se nahi hota. Alag kaam |
| Guest ki server-side history | Faisla #4. Anonymous device id server pe rakhna privacy surface badhata hai, aur reinstall pe waise bhi udd jati hai |
| Query logging se auto-trending | Faisla #6 — admin curate karega. Logging baad me add ho sakti hai, response shape wahi rahega |
| Address / city normalisation | AREA grouping isse behtar hoti, par ye apna alag kaam hai aur poore address data ko chhoota hai. Abhi `$toLower` + whitespace collapse se kaam chalega |
| Outlet ko naam se search | `SubBrand` me `name` field hai hi nahi. Pehle wo field aaye |
| Search analytics dashboard | Alag feature. Iske liye query logging chahiye jo abhi nahi kar rahe |
| Personalised ranking (jo pehle dekha) | History ka data pehle jama hone do |

---

## 14. Approval ke liye tayyar *(ho chuka)*

Saare nau faisle §0 me locked hain, koi khula sawaal nahi bacha. Approve karne pe phase 1 se
shuru — model, settings block, constants, indexes.

**Approve karne se pehle ye teen cheezein dhyaan se dekh lein**, kyunki inka asar `/search`
ke bahar bhi padta hai:

1. **`helpers/vouchers/customerListing.js` badlega** — offer title bhi search me match hoga.
   Ye pipeline `/vouchers/customer/get-all` bhi use karti hai, to wahan ki search bhi behtar
   ho jayegi. Mere hisaab se wahan bhi yahi sahi behaviour hai, par ye ek shared file hai.

2. **`services/vouchers/getCustomerVouchers.js` badlega** — saved-address wala fallback ek
   shared helper me nikal jayega taaki search aur voucher listing ka behaviour ek hi rahe.
   Logic wahi rahega, sirf jagah badlegi.

3. **`services/settings/updateSetting.js` ke `CUSTOMER_BLOCKS` me `"search"` add hoga** —
   bina iske naya settings block validate to ho jayega, `200` bhi milega, aur save kuch nahi
   hoga. Us file ka apna comment yahi warning deta hai.

Baaki sab naya code hai — naya model, naya router, naye services/helpers. Kisi maujooda
endpoint ka response shape nahi badal raha.

---

## 15. Implement karte waqt plan se kahan hatna pada

Chaar cheezein — teen code me nikli hui asli dikkatein, ek naming.

### 15.1 🔴 Customer voucher listing ka `categoryId` filter kabhi kaam hi nahi karta tha

Ye plan me nahi tha; implement karte waqt nikla, aur feature ko **block** karta tha.

`GET /vouchers/customer/get-all?categoryId=<koi bhi>` **hamesha `404`** deta tha, aur har
row me `categoryId` / `subCategoryId` `undefined` aate the. Wajah: pipeline
`voucher.categoryId` par match karti thi, par `Voucher` schema me wo field **hai hi nahi** —
taxonomy `VoucherVersion` par rehti hai (`required: true`).

Kisi ne report nahi kiya kyunki client ko khaali category aur bina-offer wali category ek
jaisi dikhti hain, aur 404 wahi hai jo sach me khaali listing bhi deti hai.

Search ke CATEGORY / SUB_CATEGORY rows ka `target` bilkul isi endpoint par `categoryId`
ke saath bhejta hai — to iske bina har category tap karne par "koi offer nahi" aata.
`helpers/vouchers/customerListing.js` me teen jagah `voucher.` → `version.` ho gaya.

### 15.2 Voucher search me offer ka title, aur regex escaping

Plan me offer-title match "chhota extension" likha tha; wo ho gaya. Saath me ek chhupi hui
dikkat bhi mili: search term **escape nahi hoti thi**. `(` type karte hi Mongo throw karta
aur customer ko `500` milta; `.` aur `*` isse bhi bure — wo parse ho jaate the aur sab
kuch match kar lete the. Ab `escapeRegex` se guzarti hai.

### 15.3 Distance formula ek jagah aa gaya

Brand section ko wahi per-outlet distance chahiye jo brand directory nikaalti hai. Formula
copy karne ki jagah `helpers/brands/outletDistanceExpression.js` bana, aur
`getAllCustomerBrands` bhi wahi use karta hai — do copies drift karti hain aur symptom
("ek screen pe 2.3 km, doosri pe 2.4") aisa hai jiske liye koi bug file nahi karta.

### 15.4 Naam

`helpers/customers/resolveSearchLocation.js` ki jagah **`resolveCustomerCoordinates.js`** —
wo sirf search ka nahi, voucher feed ka bhi resolver hai. `required: true/false` hi dono ke
beech ka poora farak hai.

---

## 16. Kya verify hua

Live database ke against, read-only scripts se — repo ki no-test convention ke andar
(`npm test` sirf money paths cover karta hai).

| Kya | Nateeja |
|---|---|
| Paanchon sections, guest aur signed-in dono | ✅ |
| Bina location → VOUCHER `locationRequired: true`, baaki chaar bharay hue | ✅ |
| Single-type mode (`type`+`page`), `types` filter | ✅ |
| `(` jaisi query pe `500` nahi | ✅ clean 404 |
| History: upsert, case/whitespace dedupe, cap prune, listing | ✅ 16 checks |
| Delete ke baad wahi term dobara search — partial unique index | ✅ |
| Dusre customer ki entry delete karne ki koshish | ✅ 404 |
| Guest `commit=true` — koi row nahi banti | ✅ |
| `PUT /settings/update` → `customer.search`, siblings safe | ✅ |
| Kill switch — `200` + khaali sections | ✅ |
| Poore HTTP layer ke against saare 5 endpoints | ✅ |
| Brand directory aur voucher feed refactor ke baad waise ke waise | ✅ |

Saari test rows saaf kar di gayin — `searchhistories` collection khaali hai.
