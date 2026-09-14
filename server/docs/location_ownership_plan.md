# Location — production-ready ownership, linking aur audit

> **Status:** ✅ **DONE.** Sab 20 issue band · 42 tests (asli DB) · mutation 15/15 killed.
>
> Related: [vendor_panel_api_doc.md → Appendix B](./vendor_panel_api_doc.md#appendix-b--known-issues)

---

## ✅ Kya hua — natija

| Group | Issue | |
|---|---|---|
| **A** Security | A-1, A-2, A-3 | ✅ teenon band |
| **B** Data linking | B-1 … B-7 | ✅ saat ke saat |
| **C** Correctness | C-1 … C-5 | ✅ paanchon |
| **D** Performance | D-1, D-2, D-3 | ✅ teenon |
| **E** Tooling | E-1, E-2 | ✅ dono |

**Naye files:** `constants/location.js`, `helpers/locations/` (resolver + barrel),
`scripts/backfillLocationOwnership.js`, `__tests__/money/locationOwnership.test.js`

**Q-L6 aur customer-delete bhi ho gaye** — routes ab `isBrandSideOrAdmin` hain
(outlet manager apne outlet ka address rakh sakta hai) aur delete `verifyJwtToken`
par hai, taaki customer apna address hata sake. Kaun kis par kaam kar sakta hai,
wo ab bhi `resolveLocationTarget` tay karta hai — gate sirf *kya* pooch raha hai,
*kiska* nahi.

⚠️ **D-3 scan ki tuning nahi nikli — ek asli bug nikla.** `getAllLocations` 13
jagah **raw user input** `new RegExp()` me daal raha tha, jabki chhe doosri
services `escapeRegex` use karti hain. Teen nateeje, aur pehla hi sabse kam bura:
`search=[` par `new RegExp` throw karta tha (**500**, bracket se), `search=.*` har
row match karta tha (filter band), aur `search=(a+)+$` catastrophic backtracking —
29-character subject par Node ke engine me naapa: **36.7 second**, ek string se.
Wahi expression Mongo har scan kiye document par chalata.

`$text` index **nahi** lagaya: repo ka apna documented faisla hai ki search box ke
liye regex chahiye, kyunki `$text` part-word match nahi karta
(`buildVoucherSection.js:22`). Aur `formattedAddress` akela bhi kaafi nahi — wo
baaki aath se banta hai par validator caller ko apna bhejne deta hai, aur aisi row
maujood hai jiske `formattedAddress` me uska apna `addressLine1` nahi hai.

**3 dangling pointers clear ho gaye** — `cleanupOrphans --apply` se. Ab aathon
check par 0.

**Backfill chal chuka** — 24 rows ko `kind`, 19 ko `userId`, 16 ko `brandId`,
4 duplicate soft-deleted. Chaaron duplicate "parent points elsewhere" the, yaani
jo row rakhi gayi wahi thi jo panel/app pehle se dikha rahe the — screen par kuch
nahi badla.

**Indexes:** 4 naye bane (`{brandId,isActive,isDeleted}` + teen partial unique),
`location_2dsphere` shadow index drop hua (0 documents me wo field thi).

### ⚠️ Teen cheezein jo likhte waqt mili — plan me nahi thi

**1. `SubBrand.geo` ka `default: [0,0]` ek poori zanjeer nikla.** Q-L5 (`$unset`)
akela kaam hi nahi karta tha: Mongoose hydrate par default wapas laga deta hai,
aur `updateSubBrand` `.save()` karta hai. Default hataana bhi seedha nahi tha —
array path bina kahe `[]` default karta hai (validator fail), aur `geo.type` ka
apna `default: "Point"` bacha rehne se document me **aadha GeoJSON**
(`{type:"Point"}`) reh jaata tha, jise 2dsphere index **insert par hi reject**
karta hai. Ab `geo` ek sub-schema hai jiska `default: undefined` hai.

Isi ne ek live bug khola: `signUpSubBrandWithWhatsapp` `geo` set karta hi nahi,
to **har naya outlet `[0,0]` par paida hota tha** — Gulf of Guinea. Uska voucher
ban jaata, approve hota, publish hota, aur **customer ko kabhi nahi dikhta**.
Ab `validateVoucherSubBrands` (create aur update dono ka ek gate) saaf `400`
deta hai.

**2. `resolveExistingLocationTarget` me apna hi hole tha.** Customer ke liye wo
caller ke **apne** account par resolve karta hai — create par wahi sahi hai — to
ek maujooda row handing karne par wo **hamesha successful** aata tha, chahe row
kisi ki bhi ho. Ab per-kind owner comparison hai.

**3. Duplicate ab `409` deta hai, `500` nahi.** Partial unique index ka raw
`E11000` `errorHandler` tak jaakar 500 banta. Ab: *"This already has an address.
Delete the existing one before adding another."*

### Guest par asar — verify kiya

`GET /locations/*` guest ke 34 open routes me **hai hi nahi**, to scope kabhi
guest tak pahunchta nahi. Aur asli 2dsphere index par naapa: `geo` **bilkul na
ho** to insert chalta hai aur `$geoNear` use **chup-chaap skip** karta hai. Purana
`[0,0]` ulta **`maxDistance` bina wali query me aa jaata tha** — Suggestions tab
ka fallback wahi karta hai, to guest ko bina pate wala outlet 8,900 km door
"suggestion" ban kar dikh sakta tha. Ab nahi.

---

## 0. Ek nazar me — 20 issue, paanch group

| Group | # | Kitne | Sabse bura |
|---|---|---|---|
| **A** | Security — kaun likh sakta hai | 3 | A-3: koi bhi vendor **saare** customer address padh sakta hai |
| **B** | Data linking — production ka dil | 7 | B-4: **7 address abhi bhi apne parent se un-linked hain** |
| **C** | Correctness bugs | 5 | C-1: har galat `brandId` ek orphan row chhodta hai |
| **D** | Performance / scale | 3 | D-1: ek **shadow index** jo 0 documents par lagta hai |
| **E** | Tooling | 2 | E-1: seeder ka clear 19 of 24 rows ko **dekh hi nahi sakta** |

Sab kuch dev DB (`Trydood2`) par naapa gaya — 24 locations, 20 outlets, 32 brands.

---

# GROUP A — Security

## A-1 · `updateLocation` `userId` leta hai, use nahi karta

**Kya hai** — [updateLocation.js:5](../services/locations/updateLocation.js#L5)

```js
exports.updateLocation = async (userId, payload) => {
  const location = await Location.findById(id);        // sirf id
  // ...userId kahin use nahi hota
```

**Use case — kab phatega**

Vendor A ke panel me ek stale list hai, ya usne galat row se id copy kar li.
Request jaati hai, `200` aata hai — aur **vendor B ke outlet ka address badal
jaata hai**. Vendor B ko dikhega ki uske outlet ka pata galat hai; use pata hi
nahi chalega kisne badla.

Aur kyunki ek Location **customer ki** bhi ho sakti hai, wahi id kisi customer ke
ghar ka pata badal sakti hai. Customer ka voucher feed usi address se banta hai —
to uska poora feed chup-chaap badal jaayega.

**Fix** — `updateLocation(actor, payload)`. Row se kind nikaalo, `resolveLocationTarget`
se ownership check karo, warna `403`.

---

## A-2 · `deleteLocation` me actor hai hi nahi

**Kya hai** — [deleteLocation.js:7](../services/locations/deleteLocation.js#L7)

```js
exports.deleteLocation = async (payload) => {     // userId leta hi nahi
  const result = await Location.findById(id);
```

**Use case**

A-1 jaisa, par **wapas nahi aata**. Soft delete hai, par uske saath
`Brand.locationId` / `SubBrand.locationId` / `Customer.locationId` **`null`** ho
jaate hain. Customer app par us outlet ka pata gayab, "near me" se wo outlet
gayab, aur customer ka apna address gayab — jisse uska voucher feed khaali ho
jaayega.

**Fix** — `deleteLocation(actor, payload)` + wahi resolver.

---

## A-3 · 🔴 `getAllLocations` par koi scope hi nahi

**Kya hai** — [getAllLocations.js:5](../services/locations/getAllLocations.js#L5)

```js
exports.getAllLocations = async (query) => {      // koi actor nahi
  const match = { isDeleted: false };             // aur koi filter zaroori nahi
```

Route `isVendorOrAdmin` hai — yaani caller vendor hai, itna hi tay hai.

**Use case**

Koi bhi vendor, apne asli token se:

```
GET /trydood/v1/locations/getAll?limit=100
```

…aur use **platform ka har address** mil jaata hai — abhi 24, jisme **5 customer
ke ghar ke pate** hain, unke **GPS coordinates** samet. Pagination hai, to poora
data nikaalna bas kuch requests ka kaam hai.

Ye sirf leak nahi hai — ye competitor ke liye ek ready-made list hai: har outlet
kahan hai, aur har customer kahan rehta hai.

**Fix** — `getAllLocations(actor, query)`:

| Role | Kya dikhega |
|---|---|
| ADMIN | sab |
| VENDOR | sirf apna brand + apne outlets (B-2 ke baad **ek line**) |

> `getLocation` (single read) me ye check **pehle se sahi hai** —
> [getLocation.js:18-55](../services/locations/getLocation.js#L18). Wahi pattern
> baaki jagah le jaana hai.

---

# GROUP B — Data linking (production ka dil)

## B-1 · Brand/outlet address par `userId` likha hi nahi jaata

**Kya hai** — [createLocation.js:47-51](../services/locations/createLocation.js#L47)

```js
if (!isBrandAddress && !isSubBrandAddress) {
  userId = userId || tokenUserId;
} else {
  userId = undefined;          // ← jaan-boojh kar mitaya jaata hai
}
```

Naapa hua: **19 of 24 rows me `userId` nahi hai**.

**Use case**

Production me teen jagah kaatta hai:

1. **"Is user ka saara data do"** — GDPR-type request, ya account delete. `userId`
   par query karo aur outlet ka address milega hi nahi.
2. **Cleanup** — E-1 dekho: seeder ka clear `userId` par tika hai, to wo in rows
   ko dekh hi nahi sakta.
3. **Audit** — "ye address kis account se juda hai" ka jawab do lookups ke bina
   nahi milta.

**Fix** — har row par `userId`, entity se derive karke:

| Kind | `userId` |
|---|---|
| BRAND | `brand.userId` |
| SUB_BRAND | `subBrand.userId` |
| CUSTOMER | `user._id` |

Teenon model me ye field **pehle se `required`** hai — kuch invent nahi karna.

---

## B-2 · Outlet ke address par `brandId` nahi

**Kya hai** — outlet address me sirf `subBrandId` jaata hai. Naapa: 16 of 19 rows
me `brandId` nahi. Baaki 3 me hai — par wo **ittefaq** hai, `createLocation`
payload ka `brandId` bina kind dekhe copy kar deta hai.

**Use case — aapne yahi maanga tha**

"Ek brand ke saare outlets ke address do" aaj **do query** maangta hai:

```js
const outletIds = await SubBrand.find({ brandId }).distinct("_id");
const rows = await Location.find({ subBrandId: { $in: outletIds } });
```

200 outlet wale brand par wo `$in` 200 ids ka array banata hai — har request par.

**Fix** — outlet address par `brandId = subBrand.brandId`. Phir:

```js
Location.find({ brandId })       // brand ka apna + saare outlets, ek query
```

🟢 **Aur ye A-3 ka fix bhi saste me kar deta hai** — vendor scoping bhi wahi ek
line ban jaati hai.

---

## B-3 · `createdBy` / `updatedBy` hai hi nahi

**Kya hai** — Location par audit ka koi field nahi. Naapa: 0 of 24.

**Use case**

Admin ne customer ki location theek ki. Ab row me `userId` = customer ka.
**Kisne badla?** Koi jawab nahi.

Production me jab customer kahe "mera address kisi ne badal diya", `userId` sirf
ye batata hai ki address **kiska** hai — ye nahi ki **kisne** chhua.

**Fix** — do naye field, aur ye farq spasht rakhna:

| Field | Sawaal |
|---|---|
| `userId` | address **kiska** hai |
| `createdBy` | **kisne banaya** |
| `updatedBy` | **kisne aakhri baar badla** |

```
Vendor apne outlet ka address daalta hai:
  userId     = subBrand.userId     ← outlet ka apna login
  brandId    = subBrand.brandId
  subBrandId = subBrand._id
  createdBy  = vendor ka userId    ← jisne type kiya

Admin customer ka address theek karta hai:
  userId     = customer ke user ki id
  customerId = user.customerId
  createdBy  = admin ka userId     ← saaf dikhega
```

---

## B-4 · 🔴 Do-tarfa pointer, aur wo **abhi hi** alag ho chuke hain

**Kya hai** — link dono taraf rakha jaata hai:

```
Location.brandId  →  Brand          aur          Brand.locationId  →  Location
```

Inhe sync me rakhne ke liye **kuch bhi nahi** hai.

**Naapa hua — ye pehle se toota hua hai:**

| Parent | Live address |
|---|---|
| 1 brand | **3** |
| 12 outlets | 1 ✅ |
| 2 outlets | **2** |
| 1 outlet | **3** |
| 5 customers | 1 ✅ |

`Brand.locationId` **ek** par point karta hai. Baaki 2 zinda hain, kisi se jude
nahi. Outlets me bhi wahi — **kul 7 live address apne parent se un-linked hain.**

**Use case**

Vendor panel outlet ka pata dikhata hai `SubBrand.locationId` se — "Ring Road".
Wahi vendor `getAll` khole to teen pate dikhte hain. **Kaunsa sahi hai?** Koi nahi
bata sakta. Customer app `locationId` follow karti hai, aur "near me" search
`SubBrand.geo` se chalti hai — jo teesre address ka ho sakta hai.

Production me iska matlab hai: **customer ek pate par pahunchta hai, dukaan kahin
aur hai.**

**Fix — do hisse**

**(i) Ek `kind` field, do boolean ki jagah.** Aaj `isBrandAddress` aur
`isSubBrandAddress` do alag boolean hain jo aapas me **asehmat** ho sakte hain —
aur hain: 3 rows me `brandId` hai par `isBrandAddress` **`false`** hai. Ek enum
is class ki galti ko hi mita deta hai:

```js
kind: { type: String, enum: ["BRAND", "SUB_BRAND", "CUSTOMER"], required: true }
```

> Response me dono boolean **waise hi rahenge** — `kind` se derive karke. API
> contract nahi badlega, panel team ko kuch nahi karna.

**(ii) Partial unique index** — ek parent ka ek hi live address:

```js
locationSchema.index({ brandId: 1 },
  { unique: true, partialFilterExpression: { kind: "BRAND", isDeleted: false } });
locationSchema.index({ subBrandId: 1 },
  { unique: true, partialFilterExpression: { kind: "SUB_BRAND", isDeleted: false } });
locationSchema.index({ customerId: 1 },
  { unique: true, partialFilterExpression: { kind: "CUSTOMER", isDeleted: false } });
```

Ab duplicate **database** rok dega, code ki neeyat par nahi tika rahega. Soft
delete ke saath kaam karta hai kyunki `isDeleted: false` filter me hai — purana
address delete karke naya daalna chalta rahega.

⚠️ **Deployment note:** ye index **maujooda data par banega hi nahi** — 7 duplicate
hain, `E11000` aayega. Production me (khaali collection) koi dikkat nahi. Yahan
pehle dedupe karna hoga — §7 dekho.

---

## B-5 · Parent pointer aur Location alag-alag write hain — koi transaction nahi

**Kya hai** — [createLocation.js:130-147](../services/locations/createLocation.js#L130)

```js
const location = await Location.create(locationData);   // write 1
// ...
brand.locationId = location._id;
await brand.save();                                      // write 2
```

Beech me kuch bhi fail ho — network, validation, process restart — to **Location
ban chuki hai aur pointer nahi laga**. Bilkul B-4 wali halat, par naye sirey se.

**Use case**

Vendor address save karta hai, request fail hoti hai, wo dobara save karta hai.
Ab **do** Location rows hain aur pointer doosri par. Pehli zinda, un-linked. Yahi
7 rows ki wajah ho sakti hai.

**Fix** — `session.withTransaction()`. Codebase me ye pattern pehle se hai —
`updateBrand`, `toggleFollow`, `loginOrSignUpWithWhatsapp` sab isi tarah karte
hain. Location + parent pointer ek saath, ya dono nahi.

---

## B-6 · Parent soft-delete ho to uska address reh jaata hai

**Kya hai** — `SubBrand.isDeleted = true` hone par uski Location ko koi nahi
chhuta.

🟢 Abhi iska asar zero hai: `routes/subBrands.js` me **delete route hai hi nahi**
(sirf `post`/`get`/`put`). To aaj outlet delete hota hi nahi.

**Use case (production)**

Jis din outlet delete ka endpoint banega — ya admin `updateSubBrand` se
`isDeleted` set kar dega — us outlet ka address **zinda** reh jaayega. Aur
`getAll` par wo abhi bhi dikhega, kyunki filter `Location.isDeleted` dekhta hai,
parent ka nahi.

**Fix** — do layer:
1. Jahan bhi parent soft-delete ho, uski Location bhi soft-delete ho (usi
   transaction me — B-5).
2. **Safety net:** `scripts/cleanupOrphans.js` me do naye check —
   `Location → SubBrand` aur `Location → Brand`. Aaj us script me Location ka
   **koi** check nahi hai (sirf `Brand → User`, `SubBrand → Brand`).

---

## B-7 · Customer address ka apna rasta alag hai

**Kya hai** — `upsertLocation` sahi kaam karta hai (`userId` + `customerId` likhta
hai — 5 of 5 rows theek hain), par wo `createLocation` se **alag code** hai.

**Use case**

Aaj admin customer ka address bana hi nahi sakta — `createLocation` ka CUSTOMER
raasta adhoora hai (`customerId` payload se padha jaata hai par validator me wo
field hai hi nahi → hamesha `undefined`, C-5).

Aapki R-5: admin ko customer ki location banani/theek karni ho.

**Fix** — dono ek hi `resolveLocationTarget` se jaayein. `upsert` customer ka
shortcut bana rahe (ek address, token se), par ownership aur field-filling ek hi
jagah se.

---

# GROUP C — Correctness bugs

## C-1 · Row pehle banti hai, validate baad me hota hai

[createLocation.js:130](../services/locations/createLocation.js#L130) par
`Location.create()`, aur [line 137-144](../services/locations/createLocation.js#L137)
par brand ka check.

**Use case** — vendor galat `brandId` bhejta hai. Use `404 Brand not found` milta
hai, wo maan leta hai kuch nahi hua. Par **row ban chuki hai** — kisi se judi
nahi, kabhi nahi dikhegi, kabhi delete nahi hogi. Har galti ek kachra row.

**Fix** — pehle resolve, phir create. Aur B-5 ki transaction dono ko ek saath
baandh degi.

## C-2 · `syncSubBrandLocAndGeo` `await` ke bina

[updateLocation.js:48](../services/locations/updateLocation.js#L48)

```js
if (isSubBrandLocation) syncSubBrandLocAndGeo(location.subBrandId, locGeo);
```

**Use case** — outlet shift hota hai, vendor naya pata daalta hai. `Location`
update ho jaati hai, par `SubBrand.geo` ka update chup-chaap fail ho sakta hai —
`await` nahi hai to error kahin nahi jaata. Ab **panel naya pata dikhata hai, aur
"near me" search purani jagah par outlet dikhati hai.** Customer purane pate par
pahunchta hai.

**Fix** — `await`, aur fail hone par request fail ho (usi transaction me).

## C-3 · Location ka kind beech me badla ja sakta hai

[updateLocation.js:51-56](../services/locations/updateLocation.js#L51) — dono
boolean freely flip hote hain, aur koi pointer re-sync nahi hota.

**Use case** — customer ke address par `isBrandAddress: true` set kar do. Ab wo
row brand address "ban" jaati hai, par `Brand.locationId` kisi aur par hai aur
`Customer.locationId` abhi bhi isi par. Dono taraf se toota hua.

**Fix** — `kind` **immutable**. Flip par `400 "A location's type cannot be
changed. Delete it and create a new one."`

Alternative tha: flip allow karke poora re-sync likhna — kaafi zyada code, aur ye
use case shayad hai hi nahi.

## C-4 · `console.log(payload, "snsqs")`

[updateLocation.js:23](../services/locations/updateLocation.js#L23) — debug
leftover. **Poora address har update par log me chhap raha hai** — production
logs me customer ke ghar ke pate.

**Fix** — hatao.

## C-5 · `customerId` dead param

[createLocation.js:10](../services/locations/createLocation.js#L10) me destructure
hota hai, par `validateCreateLocation` me wo field hai hi nahi → `stripUnknown`
hamesha uda deta hai.

**Fix** — resolver se aayega, payload se nahi.

---

# GROUP D — Performance / scale

## D-1 · 🔴 Shadow index — `location_2dsphere`

**Naapa hua:**

```
location_2dsphere   {"location":"2dsphere"}  partial
```

…aur `location` naam ka field **kisi document me nahi hai** (0 of 24). Model me
field `geo` hai. Ye kisi purane rename ka bacha hua index hai.

**Use case** — ek geo index har insert aur har update par **compute hota hai**,
chahe field ho ya na ho. Wo disk leta hai, RAM me working set kha jaata hai, aur
kisi query ko tez nahi karta. 24 rows par kuch nahi; 10 lakh addresses par ye
seedha write latency hai.

**Fix** — drop. Codebase me iske liye pehle se ek jagah hai —
`helpers/transactions/reapShadowIndexes.js` wahi kaam money indexes ke liye karta
hai. Yahan ek chhoti script ya `ensureIndexes.js` me entry.

## D-2 · `brandId` par index nahi

Abhi `customerId` aur `subBrandId` par index hai, **`brandId` par nahi**. B-2 ke
baad har vendor scoping query `brandId` par chalegi — bina index ke wo poora
collection scan karegi, **jisme customer ke ghar ke pate bhi hain**.

**Fix** — `{ brandId: 1, isActive: 1, isDeleted: 1 }`, wahi shape jo baaki do ka
hai.

## D-3 · `search` bina anchor ke 9 regex chalata hai

[getAllLocations.js:80-92](../services/locations/getAllLocations.js#L80) — `search`
par 9 fields par `$regex` ka `$or`. Koi anchor nahi, koi text index nahi → **har
search poora collection scan** karta hai.

24 rows par theek. Production me address collection sabse tezi se badhne wali
collections me hoti hai.

**Fix (is kaam me nahi)** — ya to `formattedAddress` par ek text index, ya
search ko anchored prefix par le jaana. **Abhi sirf note kar raha hu** — A-3 ka
scope filter iske aage lagta hai, to blast radius pehle hi chhota ho jaata hai.

> ❓ **Q-L8** — D-3 abhi karun ya alag se? Meri salah: **alag se** — ye tuning
> hai, correctness nahi, aur scope filter lagne ke baad iski jaldi kam ho jaati
> hai.

---

# GROUP E — Tooling

## E-1 · 🔴 Seeder ka clear 19 of 24 rows dekh hi nahi sakta

**Kya hai** — seeder aur API ek hi field par **alag niyam** chala rahe hain.

Seeder ([seedPostmanFixtures.js:587](../scripts/seedPostmanFixtures.js#L587)) `userId`
ke **saath** likhta hai. API ([createLocation.js:47-51](../services/locations/createLocation.js#L47))
use **mita** deta hai. Aur clear ([line 372](../scripts/seedPostmanFixtures.js#L372))
`userId` par tika hai:

```js
Location.deleteMany({ userId: { $in: userIds } }),
```

Usi `Promise.all` me `SubBrand.deleteMany({ brandId })` bhi chalta hai — **parent
jaata hai, address rehta hai**.

🟢 Abhi orphan count **0** hai, kyunki maujooda 20 outlets haath se bane hain,
seeder se nahi (`PMFX` marker: 0). Mechanism fire nahi hua, par lagi hui hai.

**Fix** — B-1 ise apne aap theek kar deta hai (har row par `userId`). Saath me
clear ko chaudा bhi karo:

```js
Location.deleteMany({ $or: [
  { userId:     { $in: userIds } },
  { brandId:    { $in: brandIds } },     // NAYA
  { subBrandId: { $in: subBrandIds } },  // NAYA
]}),
```

## E-2 · `cleanupOrphans.js` me Location ka koi check nahi

Wo sirf `Brand → User` aur `SubBrand → Brand` dekhta hai.

**Fix** — `Location → Brand`, `Location → SubBrand`, `Location → Customer`. Ye
B-6 ka safety net hai.

---

# 6. Target model

```js
// models/Location.js
kind: {                                        // NAYA — do boolean ki jagah sach
  type: String,
  enum: ["BRAND", "SUB_BRAND", "CUSTOMER"],
  required: true,
},
userId:    { ...userField, required: true },   // ab REQUIRED
customerId: customerField,
brandId:    brandField,                        // outlet par bhi — B-2
subBrandId: subBrandField,
createdBy: userField,                          // NAYA
updatedBy: userField,                          // NAYA

// isBrandAddress / isSubBrandAddress — response me `kind` se derive honge.
// API contract nahi badlega.
```

**Indexes**

| Index | Kyun |
|---|---|
| `{ brandId, isActive, isDeleted }` | D-2 — vendor scoping |
| `{ brandId }` unique partial `kind:"BRAND"` | B-4 |
| `{ subBrandId }` unique partial `kind:"SUB_BRAND"` | B-4 |
| `{ customerId }` unique partial `kind:"CUSTOMER"` | B-4 |
| `location_2dsphere` | **DROP** — D-1 |

---

# 7. Test DB par kya hoga, aur kya karna padega

| # | Change | Rows | Asar | Kya karna hoga |
|---|---|---|---|---|
| 1 | `userId` required | **19/24** | `.save()` fail → delete tootega | backfill |
| 2 | `kind` required | **24/24** | wahi | backfill (ids se derive) |
| 3 | `brandId` on outlets | **16/24** | `getAll` se gayab | backfill |
| 4 | **partial unique index** | **7 duplicate** | 🔴 **index ban hi nahi payega — `E11000`** | **dedupe** |
| 5 | `createdBy`/`updatedBy` | 24/24 | khaali rahenge, nullable | kuch nahi |
| 6 | `location_2dsphere` drop | 0 docs | 🟢 sirf faayda | kuch nahi |
| 7 | `kind` immutable | 0 | koi asar nahi | kuch nahi |

🟢 **Money suite par zero asar** — `__tests__/money/` me koi test Location banata
hi nahi (verify kiya, 0 hits).

🟢 **Production par zero asar** — wahan collection khaali hai, index pehle banega,
data uske baad. Ye saari dikkatein sirf is test DB ki hain.

### Ek hi script dono kaam karegi

`scripts/backfillLocationOwnership.js` — repo ka standard: **dry-run by default,
`--apply` se likhta hai**.

```
1. Har row ka parent padho (SubBrand / Brand / Customer)
2. kind, userId, brandId bhar do
3. Duplicate group me sabse naya rakho — baaki ko isDeleted: true
   (parent ka locationId jispar point karta hai, use preference)
4. Uske baad hi index banao
```

Wo wahi logic use karega jo resolver use karega — yaani resolver ka ek muft ka
test bhi ban jaata hai.

> ❓ **Q-L4** — script, ya locations collection wipe karke naye sirey se daalein?
> Wipe karne par 20 outlets aur 5 customers ke pate **dobara haath se** daalne
> padenge (maine check kiya — maujooda outlets par `PMFX` marker nahi hai, to
> `seedPostmanFixtures` unhe wapas nahi banayega). Meri salah: **script**.

---

# 8. Files

| File | | Kya |
|---|---|---|
| `helpers/locations/resolveLocationTarget.js` | 🆕 | kind + ownership, ek jagah |
| `helpers/locations/index.js` | 🆕 | barrel |
| `constants/location.js` | 🆕 | `LOCATION_KINDS` |
| `models/Location.js` | ✏️ | `kind`, `userId` required, `createdBy`/`updatedBy`, 4 index |
| `services/locations/createLocation.js` | ✏️ | actor, resolver, transaction, C-1, C-5 |
| `services/locations/updateLocation.js` | ✏️ | actor, resolver, C-2, C-3, C-4 |
| `services/locations/deleteLocation.js` | ✏️ | actor, resolver, transaction, geo |
| `services/locations/getAllLocations.js` | ✏️ | actor scope (A-3) |
| `services/locations/upsertLocation.js` | ✏️ | resolver share, audit fields |
| `controllers/locations/*.js` (4) | ✏️ | actor pass karein |
| `validator/locations.js` | ✏️ | kind fields, update se immutable hatao |
| `scripts/backfillLocationOwnership.js` | 🆕 | §7 |
| `scripts/seedPostmanFixtures.js` | ✏️ | E-1 |
| `scripts/cleanupOrphans.js` | ✏️ | E-2 |
| `scripts/ensureIndexes.js` | ✏️ | D-1 shadow index drop |
| `__tests__/money/locationOwnership.test.js` | 🆕 | asli DB |
| 3 API docs + 3 Postman | ✏️ | 403, naya scope, naye field |

---

# 9. Tests

| # | |
|---|---|
| 1 | Vendor doosre brand ka address nahi bana sakta → `403` |
| 2 | Vendor doosre brand ke **outlet** ka nahi → `403` |
| 3 | Vendor apne outlet ka bana sakta hai — `userId = subBrand.userId`, `brandId = subBrand.brandId`, `createdBy = vendor` |
| 4 | Admin kisi bhi brand ka — `userId = brand.userId`, `createdBy = admin` |
| 5 | Admin customer ka — `userId`/`customerId` customer ke, `createdBy` admin ka |
| 6 | Vendor **customer ka** address update nahi kar sakta → `403` |
| 7 | Vendor customer ka delete nahi kar sakta → `403`, row zinda |
| 8 | `getAll` — vendor ko sirf apna brand + outlets; **customer ka kabhi nahi** |
| 9 | `kind` flip → `400`, row waisi hi |
| 10 | Galat `brandId` par create → `404` **aur koi row nahi bani** (C-1) |
| 11 | **Doosra live address usi parent ka → `E11000` / `409`** (B-4) |
| 12 | Purana delete karke naya banana **chalta hai** (partial index soft-delete ke saath) |
| 13 | Beech me fail → **na Location bani, na pointer laga** (B-5 transaction) |
| 14 | Outlet address update → `SubBrand.geo` **sach me** sync hua (C-2) |
| 15 | Delete → pointer clear + soft delete + `updatedBy` |
| 16 | `updatedBy` har update par badalta hai, `createdBy` nahi |

Har ownership check mutation se verify karunga.

---

# 10. Kaam ka kram

| Step | | Alag deploy ho sakta? |
|---|---|---|
| **1** | `constants/location.js` + resolver + `kind` derive helper | ✅ |
| **2** | Model: `kind`, `createdBy`, `updatedBy` — sab **nullable** abhi | ✅ |
| **3** | Services + controllers: actor, resolver, transaction, C-1…C-5 | ✅ |
| **4** | `getAll` scope (A-3) | ✅ |
| **5** | Backfill script chalao | — |
| **6** | Model: `kind` + `userId` **required**, partial unique index, shadow index drop | ✅ *(5 ke baad)* |
| **7** | Seeder + cleanupOrphans (E-1, E-2) | ✅ |
| **8** | Docs + Postman | ✅ |

**Kyun is kram me:** step 6 (required + unique) **tabhi** safe hai jab step 5
saara data theek kar chuka ho. Production me 5 ka koi matlab nahi (khaali
collection), par yahi kram staging par bhi chalega.

---

# 11. ❓ Sawaal

| # | Sawaal | Meri salah |
|---|---|---|
| **Q-L1** | `userId` + `kind` `required: true`? | **Haan** — backfill ke baad |
| **Q-L2** | `kind` immutable (flip par `400`)? | **Haan** |
| **Q-L3** | Vendor panel `getAll` ko "saari locations" ke liye use karta hai? | — *(unhe batana padega)* |
| **Q-L4** | Backfill script ya locations wipe? | **Script** |
| **Q-L5** | Delete par `SubBrand.geo` `[0,0]` → `$unset`? `[0,0]` Gulf of Guinea hai, asli point hai | **Haan**, `updateOne` se (`geo.coordinates` required hai, `.save()` toot sakta hai) |
| **Q-L6** | Sub-vendor apne outlet ka address khud edit kare? | **Abhi nahi** — alag change |
| **Q-L7** | Seeder + cleanupOrphans isi kaam me? | **Haan** — warna fix aadha hai |
| **Q-L8** | D-3 (search scan) abhi ya alag se? | **Alag se** — tuning hai, correctness nahi |
| **Q-L9** | **`kind` field** — do boolean ki jagah enum, response me boolean derive? Ya boolean hi rehne dun aur unique index ka doosra raasta dhoondun? | **`kind`** — boolean aapas me asehmat ho sakte hain aur **abhi hain** (3 rows me `brandId` hai par `isBrandAddress: false`) |
