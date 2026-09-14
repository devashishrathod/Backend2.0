# Trydood 2.0 — Master Execution Plan

> **Status:** design **approved aur locked**. Block A (A-1 · A-2 · A-2b · A-3)
> **ship ho chuka** — teenon leak band, 36 naye test, 22/22 mutant. Agla: **F-1**.
>
> Progress Part 4 ke table me, aur har phase ka detail Part 4B me.
>
> Ye doc poore bache hue kaam ka single source hai — storage, media, showcase,
> voucher, upload, infra. Showcase ka detailed design
> [showcase_rules_and_upload_plan.md](./showcase_rules_and_upload_plan.md) me hai
> aur wahi valid hai; yahan uske phases list hain.
>
> Har claim code se verify kiya gaya hai. Jahan "aaj aisa hai" likha hai, file
> aur line di gayi hai.

---

# Part 0 — Locked decision register

## 0.1 Storage & media (naya)

| # | Faisla | Value |
|---|---|---|
| **M-1** | Ek hi generic media shape | **`models/mediaSchema.js`** — har jagah, bina exception. `storageSchema` sidecars **aur** har inline `storage` object isme milte hain |
| **M-2** | Provider enum | **`AWS_S3`** — aaj `"S3"` hai, badalna hai. Underscore, baaki har enum ki tarah |
| **M-7** | Video poster | **Hamesha alag se upload hoga.** Provider se derive **kabhi nahi** — na Cloudinary par, na S3 par. Maujooda Cloudinary derivation **hatani hai** (wo galat URL banata hai, verified) |
| **M-8** | Type-specific media fields | **Khatam.** `image`/`video`/`gif` jaise teen-field shapes ek `media: mediaSchema` ban jayenge; `type` `media.kind` se aayega |
| **M-3** | Client contract | DB me poora media object, par response me **ek helper decide karta hai** kya jaata hai. Default: sirf `url` string — **koi client nahi tootega** |
| **M-4** | Storage internals | `bucket` / `key` / `publicId` **kabhi** customer response me nahi — helper me structurally band, har endpoint par yaad rakhne ki zarurat nahi |
| **M-5** | Purana data | **Ignore.** Pre-launch hai, koi migration script nahi |
| **M-6** | Video ka poster | `mediaSchema.poster` — **VIDEO par mandatory**, model-level |
| **ST-1** | Provider kahan set ho | **`Setting.storage.provider`** — admin panel se, env se nahi |
| **ST-2** | S3 par switch | **Preflight probe** ke baad hi — PUT→GET→DELETE round trip fail ho to 422, switch save hi na ho |
| **ST-3** | Env ka role | `MEDIA_PROVIDER` sirf **pehli baar ka seed default**. Uske baad Setting hi single source |
| **ST-4** | Do layer ka rule | **Global = ceiling, surface = narrower.** Effective = `min(global, surface)`, aur surface > global save hi nahi hoga |

## 0.2 Voucher (naya)

| # | Faisla | Value |
|---|---|---|
| **V-1** | Voucher images | **Minimum 3**, maximum config se. GIF haan, video nahi |
| **V-2** | Banner mandatory | **Submit-for-review par banner dena zaruri.** Publish **block nahi** hota — V-4a ka fallback hai |
| **V-3** | Banner delete | **Nahi ho sakta.** Sirf replace / edit. `DELETE` endpoint hata diya jayega |
| **V-4** | Banner approval | Apna alag state — `PENDING` / `APPROVED` / `REJECTED`. Customer ko **sirf approved** dikhega |
| **V-4a** | Banner reject / abhi approved nahi | **Voucher ki pehli image (sortOrder 1) hi banner ban jaati hai.** Voucher PUBLISHED rehta hai, hatta nahi. Banner slot kabhi khali nahi — isi se "har voucher ka banner hoga" guarantee milti hai |
| **V-5** | Banner replace | Naya `pending` me jaata hai, **purana approved live rehta hai** jab tak naya approve na ho |
| **V-6** | Banner types | IMAGE · VIDEO · GIF — teeno. Video ke saath **poster mandatory** |
| **V-7** | Voucher pause | `PUBLISHED ⇄ PAUSED`. Customer reads pehle se `PUBLISHED` filter karte hain, to paused apne aap gayab |
| **V-8** | Voucher delete | Soft delete + `status: DELETED` + plan slot release. **Live claim (`PENDING`/`PAID`) ho to block — ADMIN ke liye bhi** |
| **V-11** | `DELETED` status | `VOUCHER_STATUSES` me naya value. `isDeleted` operational flag rahega, `status: DELETED` display ke liye — **dono hamesha ek saath**, ek hi jagah se likhe jayenge |
| **V-12** | Delete ke baad history | Claim reads **snapshot-based** hain (verified) — kuch nahi tootega. Par snapshot patla hai, use **banner + pehli image** ke saath bharna hoga |
| **V-13** | Admin ko deleted dikhega | `deletedAt` · `deletedBy` · `deleteReason` ke saath. Aaj listing me `isDeleted: false` **admin ke liye bhi hardcoded** hai |
| **V-9** | Image reorder | Naya endpoint, showcase jaisa |
| **V-10** | Voucher `allowedImages` | Alag list **nahi** — global `Setting.storage.allowed.imageTypes` hi |

## 0.3 Showcase (pehle se locked — S-1…S-16)

[showcase_rules_and_upload_plan.md §0](./showcase_rules_and_upload_plan.md) me. Sab valid.

## 0.4 Upload (pehle se locked)

Route A (middleware verify + facade `acceptUpload`) · E1 file+uploadId dono → 422 ·
E2 purpose mismatch → 422 · E5 upload transaction ke bahar · pehli surface = category ·
`uploadIds` array · quota presign par bhi.

> ⚠️ Purana "thumbnail mandatory = option C (abhi optional, flag se mandatory)"
> **superseded** hai — M-7 ke baad poster VIDEO par schema-level mandatory hai,
> pehle din se, bina kisi flag ke. Dekhein §1.5.

---

# Part 1 — Ek generic media shape

## 1.1 Aaj teen alag shapes hain

Poore models folder ka sweep karke:

| Pattern | Kahan | Shape |
|---|---|---|
| **A — sidecar** | Brand ×2, SubBrand ×2, Category, SubCategory, BrandFeatures, User, ShowcaseSection.thumbnail, Dispute, RefundRequest, Settlement, Transaction | `logo: String` + `logoStorage: storageSchema` |
| **B — inline nested** | Banner ×3, PromotionalTicker, Voucher.banner ×3, VoucherVersion.images[], ShowcaseSection.medias[] | `image: { url, storage: { provider, publicId, bucket, key } }` |
| **C — kuch bhi nahi** | **`Customer.image`** | `image: String` — koi storage detail nahi, aur koi upload path likhta bhi nahi |

### Profile picture — do role, do key (aapka faisla)

| Role | Key | Kyun |
|---|---|---|
| VENDOR · SUB_VENDOR · ADMIN | **`User.image`** — jaisa hai waisa | Panel ka profile pic yahin rehta hai |
| CUSTOMER | **`Customer.image`** — naya, `mediaSchema` par | Customer ka apna row, apna media |

Yaani CUSTOMER role ka profile update `User.image` ko **chhuega nahi** (wo unset
rahega) aur `Customer.image` me likhega. Aaj `Customer.image` ek khaali `String`
hai jise **koi upload path likhta hi nahi** — ye use zinda karta hai.

Pattern B me `provider` ka enum **paanch jagah hardcoded string literal** hai —
`["CLOUDINARY","S3"]` — `STORAGE_PROVIDER` use hi nahi hota:
[Banner.js:65,80,95](../models/Banner.js#L65) · [PromotionalTicker.js:20](../models/PromotionalTicker.js#L20) ·
[Voucher.js:16](../models/Voucher.js#L16) · [VoucherVersion.js:74](../models/VoucherVersion.js#L74).

Aur `size`, `width`, `height`, `duration`, `mimeType` sirf showcase par hain —
baaki har surface par file ke baare me kuch bhi record nahi hota.

## 1.2 Naya shape

```js
// models/mediaSchema.js

// Bytes kahan rakhi hain — sirf locator.
storageRefSchema = {
  provider,          // STORAGE_PROVIDER enum — CLOUDINARY | S3
  publicId,          // Cloudinary
  bucket, key,       // S3
}

// Ek poster ka apna poster nahi hota, isliye ye alag aur chhota hai.
posterSchema = { url, storage: storageRefSchema, width, height }

mediaSchema = {
  url,               // delivery URL
  storage,           // storageRefSchema
  kind,              // MEDIA_KIND — IMAGE | VIDEO | GIF | DOCUMENT | AUDIO
  mimeType,
  sizeBytes,
  width, height,     // image / video
  duration,          // video / audio
  originalName,
  poster,            // posterSchema — VIDEO par mandatory (M-6)
}
```

`kind` model par hone ka faayda: aaj "ye GIF hai ya image" ka jawab har surface
apne tarike se nikalta hai (`mimetype.startsWith("image")`), aur GIF chup-chaap
`PHOTO` ban jaata hai. `kind` likha hone ke baad wo sawaal ek baar answer hota hai —
upload ke waqt, bytes se.

## 1.3 🔴 Client kaise nahi tootega

Ye sabse zaruri design decision hai.

Aaj `brand.logo` ek **string** hai. Use `mediaSchema` banane ka matlab response me
`logo: { url, kind, sizeBytes, … }` — yaani **panel aur app dono ke har screen par**
badlaav. Isliye:

```js
// helpers/media/toMediaResponse.js
toMediaResponse(media)                    →  "https://cdn…/x.webp"     (default: sirf URL)
toMediaResponse(media, { withMeta: true }) →  { url, kind, width, height, duration, poster }
```

- **DB me poora object** — jo aap chahte hain
- **Response me aaj sirf URL** — koi client change nahi
- Kal app ko dimensions chahiye → ek flag, DB dobara nahi chhuna
- `bucket`/`key`/`publicId` **kabhi** nahi jaate — helper me structurally band

Ye **P2 leak ko permanently band karta hai**: aaj
`GET /vouchers/customer/get/:voucherId` raw `images` bhejta hai jisme
`storage.bucket` + `storage.key` hain. Helper ke baad aisa likhna possible hi nahi rahega.

## 1.4 Scope — 18 upload call sites, 17 files

```
services/auth/registerUser.js              services/subBrands/updateSubBrand.js
services/brandFeatures/addBrandFeature.js  services/subCategories/createSubCategory.js
services/brandFeatures/updateBrandFeature  services/subCategories/updateSubCategoryById
services/brands/updateBrand.js             services/users/updateUserById.js
services/categories/createCategory.js      services/uploads/index.js
services/categories/updateCategoryById.js  helpers/banners/media.js
services/showcases/updateSectionMedia.js   helpers/promotionalTickers/media.js
helpers/showcases/upload.js                helpers/vouchers/validateImagesFiles.js
                                           helpers/vouchers/voucherBannerMedia.js
```

## 1.5 🔴 Poster kabhi derive nahi hoga (M-7)

Aaj Cloudinary provider har upload par ye likhta hai
([cloudinary.js:77](../services/storage/providers/cloudinary.js#L77)):

```js
thumbnail: getOptimizedImageUrl(result.public_id),
```

Aur `getOptimizedImageUrl` ye hai ([helpers/cloudinary/index.js:70](../helpers/cloudinary/index.js#L70)):

```js
cloudinary.url(publicId, { fetch_format: "auto", quality: "auto" })
```

`cloudinary.url()` bina `resource_type` ke **`image`** maan leta hai. To ek **video**
ke public id par ye banata hai:

```
https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto/<videoPublicId>
   ↑ image delivery path, jabki asset /video/upload/ me padi hai  →  404
```

**Yaani aaj Cloudinary par har video ka poster ek toota hua URL hai.** Sahi banane
ke liye `{ resource_type: "video", format: "jpg" }` chahiye tha.

Aur PHOTO par `thumbnail === url` hai — wahi string do baar.

### Faisla

- **Poster hamesha alag se upload hoga**, dono provider par. Koi derivation nahi.
- `cloudinary.js` se `thumbnail` **hata** — provider ab poster banata hi nahi.
- `getOptimizedImageUrl` sirf **image** delivery ke liye rahega (jahan wo sahi hai).
- `helpers/showcases/upload.js` ka poora `isCustomThumbnail` legacy branch —
  "kya ye thumbnail `getOptimizedImageUrl(publicId)` ke barabar hai?" — **dead ho
  jata hai** aur hat jaayega. Auto-poster hai hi nahi, to "custom hai ya nahi" ek
  sawaal hi nahi bachta.
- `getAllVideoClips.js:71` ka `$ifNull: ["$clips.thumbnail", "$coverImage"]`
  fallback bhi hat jaayega — `poster` mandatory hai.

### Iska ek asar pehle wale faisle par

Showcase ka "thumbnail mandatory = option C (abhi optional, flag se mandatory)"
ab **nahi** chahiye. Poster VIDEO par **schema-level mandatory** hai — pehle din se,
bina flag ke. Ek setting kam.

## 1.6 Ek schema decision, chaar bug

`mediaSchema.poster` VIDEO par mandatory hone se ek saath band ho jaate hain:

1. Showcase ka `.mp4` cover (S3 par)
2. Voucher ka video banner bina poster (**P6**)
3. Cloudinary ka toota poster URL (upar wala — **teeno provider par**)
4. Clips feed ka blank-frame fallback

---

# Part 1B — Teen-field media shapes ko generic banana (M-8)

## 1B.1 Sawaal: in extra fields ka koi sense hai?

Aaj teen jagah ek hi pattern hai:

```js
Banner        { type, image: {...}, video: {...}, gif: {...} }
Voucher       { banner: { type, image: {...}, video: {...}, gif: {...} } }
```

Ek waqt me **sirf ek** bharta hai — model ka `pre("validate")` yahi enforce karta
hai ([Banner.js:110](../models/Banner.js#L110), [Voucher.js:170](../models/Voucher.js#L170)).

**Kya koi wajah hai inhe rakhne ki? Maine dono taraf se dekha — nahi.**

| Sambhavit wajah | Sach? |
|---|---|
| "Ek banner me ek saath video **aur** fallback image ho sakti hai" | ❌ Model ek se zyada allow hi nahi karta |
| "Har type ki apni alag properties hain (video ko duration chahiye, image ko nahi)" | ❌ `mediaSchema` me `kind` + optional fields se ye behtar handle hota hai |
| "Type badalne par purana media rah jaata hai" | ❌ Ulta **nuksan** — `setVoucherBanner` poora object replace karta hai, to purana chup-chaap gayab, aur uski file orphan |

Aur nuksan asli hain:
- Client ko ek hi cheez ke liye **teen key names** par branch karna padta hai
- `BANNER_MEDIA_FIELD` / `VOUCHER_BANNER_MEDIA_FIELD` ki poori indirection layer
- `Voucher` par `default: () => ({})` ki wajah se **har doc me teen khaali object**
- Naya type add karna = model + constants + validator + services, sab jagah

## 1B.2 Naya shape

```js
// Banner
{
  title, description,
  media: mediaSchema,          // kind = IMAGE | VIDEO | GIF
                               // VIDEO ho to poster mandatory
  redirect: { type, targetId, url },
  startDate, endDate, isActive, isDeleted,
}

// Voucher
banner: {
  current: mediaSchema,        // APPROVED
  pending: mediaSchema,        // review ka intezaar
  status, rejectionReason, reviewedBy, reviewedAt,
}

// PromotionalTicker
{ icon: mediaSchema, ... }     // pehle se single field — bas shape badlega
```

### PromotionalTicker — Banner jaisa hi treatment

Ticker me Banner wali teen-field problem **nahi** hai (ek hi `icon` hai), par
baaki sab problem wahi hain:

| Aaj | Naya |
|---|---|
| `icon: { url, storage: { provider: enum ["CLOUDINARY","S3"], publicId, bucket, key } }` — **hardcoded enum**, `STORAGE_PROVIDER` use hi nahi | `icon: mediaSchema` |
| Koi `kind` / `mimeType` / `sizeBytes` / `width` / `height` nahi | Sab `mediaSchema` se |
| `redirect.type` ka enum **inline 6 string literals** hain, `BANNER_REDIRECT_TYPE` maujood hone ke bawajood | `BANNER_REDIRECT_TYPE` (Banner jaisa) |
| Customer endpoint **poora document** bhejta hai — `icon.storage.publicId`/`bucket`/`key` leak, route **bilkul public** | Banner jaisa customer shape helper |

**Customer response (naya) — Banner ke bilkul saath me:**

```js
{ _id, title, icon: "https://…", redirect: { type, targetId, url }, displayOrder }
```

Sirf wahi jo ticker render karne ke liye chahiye. `storage`, `createdBy`,
`updatedBy`, `startDate`, `endDate`, `isActive`, `isDeleted` — **ek bhi nahi**.
Ye saare admin ke fields hain; admin endpoints pehle jaisa poora document dete
rahenge.

> Leak ka fix **A-3** me hai (turant), shape ka **M-3** me (Banner ke saath).
> Do hisse isliye ki leak live hai aur `mediaSchema` ka intezaar nahi kar sakta.

**`type` field ki zarurat hi nahi rahegi** — `media.kind` wahi batata hai.
`BANNER_TYPE` aur `VOUCHER_BANNER_TYPE` ki values (`IMAGE`/`VIDEO`/`GIF`)
`MEDIA_KIND` ki values se **bilkul** milti hain, to `MEDIA_KIND` hi kaafi hai.

**Ye sab khatam ho jaayega:**

```
BANNER_TYPE · BANNER_MEDIA_FIELD · BANNER_ALLOWED_MIME_TYPES
VOUCHER_BANNER_TYPE · VOUCHER_BANNER_MEDIA_FIELD
VOUCHER_BANNER_FILE_FIELD · VOUCHER_BANNER_ALLOWED_MIME_TYPES
```

Mime allow-lists `Setting.storage.allowed.*` se aayengi, kind bytes se.

## 1B.3 Upload kaise hoga

Aaj: `type: "VIDEO"` + file field `bannerVideo`. Naya:

```
media   = <file>        ← kind bytes se pata chalega, type bhejne ki zarurat nahi
poster  = <file>        ← sirf tab jab media VIDEO ho (mandatory)
```

`type` body me bhejne ki zarurat khatam — aur wo behtar bhi hai, kyunki aaj client
jo `type` bolta hai wo file se match karta hai ya nahi, uski jaanch alag se
karni padti hai.

# Part 1C — Har response change, ek jagah

Sabse zaruri sawaal: **kahan-kahan client ka response badlega.**

## ✅ Jahan kuch nahi badlega

| Endpoint | Kyun |
|---|---|
| `GET /banners/customer/active` | `toCustomerShape` pehle se flat hai — `{_id, type, url, redirect}`. `type` ab `media.kind` se, `url` `media.url` se. **Bilkul same keys** |
| Brand / SubBrand / Category / SubCategory / BrandFeature / User ke saare reads | `logo`, `image`, `icon` aaj bhi plain URL string hain; `toMediaResponse` default bhi URL string deta hai |
| `GET /vouchers/customer/get-all` (listing) | Pehle se whitelist — `{_id, url, sortOrder}` |
| Showcase ke customer reads | `thumbnail` key bani rahegi, ab `poster.url` se bharegi |
| Invoice / document URLs | `documentUrl` string hi rahega |

## 🔴 Jahan badlega

| # | Endpoint | Aaj | Naya | Kyun |
|---|---|---|---|---|
| 1 | `GET /vouchers/customer/get/:voucherId` | `images[]` **raw** — `storage.bucket`/`key`/`publicId` | `{_id, url, sortOrder}` | **Leak fix (P2)** |
| 2 | `GET /promotional-tickers/customer/active` | **Poora document** — `icon.storage.publicId`/`bucket`/`key` | `{_id, title, icon: url, redirect, …}` | **Naya leak mila** (A-3) |
| 3 | `GET /banners/get-all`, `/get/:id` (admin) | `image`\|`video`\|`gif` object + `storage` | `media` object | M-8 |
| 4 | `POST /banners/create`, `PUT /banners/update/:id` | `type` + `bannerImage`\|`bannerVideo`\|`bannerGif` | `media` (+ `poster`) | M-8 |
| 5 | `POST /vouchers/:voucherId/banner` | `bannerType` + teen file field | `media` (+ `poster`) | M-8 |
| 6 | `DELETE /vouchers/:voucherId/banner` | maujood | **hata** | V-3 |
| 7 | Voucher customer reads | `{bannerType, bannerUrl}` | wahi **+** `bannerStatus`, `bannerIsFallback` | V-4a (additive) |
| 8 | Showcase vendor reads (`formatManagedMedia`) | `thumbnail` + `storage` + `metadata` alag-alag | ek `media` object | M-4 |
| 9 | Ticker admin reads | `icon.storage` | `icon` (media) | M-3 |
| 10 | Customer profile pic | `User.image` | `Customer.image` | M-1b |

**Customer app par asar sirf 3 jagah** (#1, #2, #7) — aur teenon me se do **fix**
hain jo aaj data leak kar rahe hain. Baaki sab admin/vendor panel hai.

# Part 2 — Global Storage Setting

Naya **top-level** block, `vendor` / `customer` / `security` / `admin` / `app` ke saath.
Vendor-specific nahi hai — platform-wide hai.

```js
Setting.storage = {
  provider: "CLOUDINARY",            // CLOUDINARY | S3   (ST-1)

  limits: {                          // MB me — MAX_BYTES yahan se banega
    maxImageSizeMB:    10,
    maxGifSizeMB:      15,           // GIF bade hote hain
    maxVideoSizeMB:    50,
    maxDocumentSizeMB: 20,
    maxAudioSizeMB:    20,
  },

  allowed: {                         // mime allow-lists
    imageTypes:    ["image/jpeg","image/jpg","image/png","image/webp"],
    gifTypes:      ["image/gif"],
    videoTypes:    ["video/mp4","video/webm","video/quicktime"],
    documentTypes: ["application/pdf"],
    audioTypes:    ["audio/mpeg","audio/mp4"],
  },

  upload: {
    presignEnabled:    false,        // direct-to-S3 raasta on/off, bina deploy
    presignTtlMinutes: 15,           // aaj presign.js me hardcoded
    intentTtlMinutes:  60,           // aaj presign.js me hardcoded
  },

  delivery: {
    signedUrlTtlMinutes: 5,          // private documents — aaj s3.js me hardcoded
  },
}
```

**GIF alag kyun:** GIF ka apna size cap chahiye, aur har surface alag se tay karti
hai ki wo GIF leti hai ya nahi (voucher image = haan, voucher banner = haan,
showcase = haan, avatar = shayad nahi). Global batata hai "GIF kya hoti hai",
surface batati hai "main leti hoon ya nahi".

**Har field ka ek asli reader hai** — koi aisa knob nahi jo kuch na kare. Wahi
galti `maxSections` me thi, aur wo isi wajah se hataya gaya tha.

## 2.1 Do layer, ek rule (ST-4)

```
Global  Setting.storage.limits.maxImageSizeMB = 10     ← ceiling
Surface Setting.vendor.showcase.maxImageSizeMB = 8     ← narrower

effective = min(10, 8) = 8
```

Aur save par validation: surface > global ho to **422**, message me dono numbers.
Do jagah se ek hi sawaal ka jawab tabhi safe hai jab kaun jeeta ye likha ho.

## 2.2 Provider switch — preflight (ST-2)

Seedha Setting me daal dena footgun hai: admin S3 chun le aur AWS galat ho, to
**platform ka har upload turant fail**, aur koi deploy gate nahi jo roke.

```
PUT /settings/update  { storage: { provider: "S3" } }
  ↓
preflight: PUT → GET → DELETE  (dono bucket, staging/ prefix)
  ↓ fail                          ↓ pass
422, switch save nahi hota      save, aur us instant se naye uploads S3 par
```

**Purani files strand nahi hongi** — ye pehle se sahi hai:

```js
// services/storage/index.js:46 — activeProvider() NAHI
const providerFor = (asset) =>
  PROVIDERS[asset?.storage?.provider ?? STORAGE_PROVIDER.CLOUDINARY];
```

Delete hamesha us **row ke apne** provider ko follow karta hai. Aaj 10,000 file
Cloudinary par hain, kal S3 on hua — purani wahin se delete hongi, nayi S3 se.
Dono ek saath chalte hain. Dynamic switch ki neenv pehle se padi hai.

⚠️ **Ek shart:** S3 par image resize aur video poster **Phase X-1/X-2** (CloudFront
+ Lambda) par aate hain. Us se pehle switch karne par admin ko warning dikhegi.

---

# Part 3 — Voucher: final design

## 3.1 13 problems, sab locked

| # | Problem | Fix | Phase |
|---|---|---|---|
| **P1** 🔴 | Fork ke baad shared image delete → **live published voucher ka image mar jaata hai** | Delete se pehle reference-count: wo `storage.key` kisi aur non-deleted version me hai? | A-2 |
| **P2** 🔴 | `GET /vouchers/customer/get/:voucherId` **public** hai aur `storage.bucket`/`key`/`publicId` bhejta hai | `toMediaResponse` helper — structurally band | A-1 |
| **P3** 🔴 | Uploads Mongo transaction ke **andar** ([create:125,184](../services/vouchers/createVoucher.js#L125), [update:305](../services/vouchers/updateVoucher.js#L305)) — 60s limit paar kar sakta hai | Upload transaction ke bahar (E5 jaisa) | V-3 |
| **P4** 🟠 | `sortOrder max: 5` hardcoded vs `maxImages` (koi max nahi) → samajh na aane wala 422 | Model se `max: 5` hatao, limit config ki | **M-5** |
| **P5** 🟠 | Banner review ko poora bypass karta hai | Banner ka apna approval (V-4) | V-4 |
| **P6** 🟠 | VIDEO banner ka koi poster nahi | `mediaSchema.poster` mandatory | F-3 |
| **P7** 🟠 | CRUD ka "D" hai hi nahi; `PAUSED` **kabhi assign hi nahi hota** (verified) | Pause/resume + delete | V-5, V-6 |
| **P8** 🟡 | Images reorder nahi ho sakti | Naya reorder endpoint | V-7 |
| **P9** 🟡 | `banner.image/video/gif` par `default: () => ({})` → har voucher me teen khaali object | Naya banner shape — teen field hi khatam | V-4 |
| **P10** 🟡 | [VoucherVersion.js:11](../models/VoucherVersion.js#L11) — `require("joi")` dead import | Hatao | M-5 |
| **P11** 🟡 | `storage` inline, enum hardcoded | `mediaSchema` | M-5 |
| **P12** 🟡 | Voucher images par **koi size check nahi** — sirf global 100 MB | Config se per-kind cap | V-1 |
| **P13** 🟡 | min-1 check **4 jagah, 4 alag message** | Ek helper, ek message | V-2 |

## 3.2 Banner ka naya shape (V-2…V-6)

Aaj: `banner: { type, image: {}, video: {}, gif: {} }` — teen field, ek bharta hai,
teen khaali object har doc me, aur `VOUCHER_BANNER_MEDIA_FIELD` ki poori indirection.

```js
// Voucher.banner — naya
banner: {
  current: mediaSchema,        // APPROVED, customer ko yahi dikhta hai
  pending: mediaSchema,        // review ka intezaar
  status:  PENDING | APPROVED | REJECTED,
  rejectionReason, reviewedBy, reviewedAt,
}
```

`type` field ki zarurat hi nahi — `current.kind` batata hai IMAGE/VIDEO/GIF hai.
Teen khaali object (P9) aur teen file-field ki indirection dono khatam.

**Flow:**

```
pehla banner     → pending, status PENDING     → voucher submit BHI ho sakta hai
                                                  aur publish BHI — tab tak
                                                  images[0] banner ka kaam karegi
admin approve    → current = pending, pending saaf, status APPROVED
admin reject     → pending ki file delete, reason save
                   current hai to status APPROVED wapas, warna REJECTED

replace          → naya pending me jaata hai
                   🔴 current LIVE rehta hai — customer ko purana approved
                      dikhta rahega jab tak naya approve na ho
delete           → endpoint hi nahi (V-3)
```

**Gates:**

| Kab | Shart |
|---|---|
| `submit-for-review` | banner **maujood** ho (`current` ya `pending`) — warna 422 |
| `publish` | **Koi banner shart nahi** — `banner.current` na ho to `images[0]` fallback chalti hai (V-4a) |
| VIDEO banner | `poster` ho — warna 422 |

Isse admin ek hi review screen par voucher + banner dono dekh leta hai, **aur**
banner baad me alag se replace + review ho sakta hai bina voucher ko chhue.

## 3.3 Images (V-1, V-9)

- **Min 3**, max config se — teen jagah enforce: `createVoucher` · `mergeImages` · `validateVoucherBeforeSubmit`
- Model par `>= 1` structural floor rahega (model async config nahi padh sakta)
- Ek hi message, aur usme agla kadam: *"Voucher ke liye kam se kam 3 images chahiye. Abhi 2 hain — 1 aur add karein."*
- GIF haan (pehle se sahi), video nahi (pehle se sahi) — **kuch nahi karna**
- Per-file size cap config se (P12 band)
- Naya reorder endpoint — vendor card ki pehli image chun sake

## 3.4 Banner resolution — banner slot kabhi khali nahi (V-2, V-4a)

```
bannerToShow =
    banner.current            (APPROVED ho to)
 ?? images[0]                 (sortOrder 1 wali voucher image)
```

Isi ek line se aapki dono baatein ek saath poori hoti hain:

- **"Har voucher ka banner hoga"** — fallback hamesha maujood hai, kyunki voucher
  ke paas **kam se kam 3 images** hain (V-1). Banner slot khali ho hi nahi sakta.
- **"Banner reject hua to voucher rukega nahi"** — PUBLISHED rehta hai, bas customer
  ko pehli image dikhti hai.

Isliye **publish banner par block nahi hota**. Sirf `submit-for-review` par banner
dena zaruri hai (V-2) — taaki admin ek hi screen par dono dekh le.

## 3.5 Pause / Delete — code se verified

### Pause

`PUBLISHED → PAUSED`, resume ulta.

✅ Customer reads pehle se `status: "PUBLISHED"` filter karte hain
([customerListing.js:116,673](../helpers/vouchers/customerListing.js#L116)) — to
paused voucher **apne aap** gayab. Kuch alag karne ki zarurat nahi.

⚠️ **Resume ka trap — poora samjhein:**

`VoucherVersion` par ye index hai ([model:263](../models/VoucherVersion.js#L263)):

```js
{ voucherId: 1, status: 1 }
unique: true
partialFilterExpression: { status: "PUBLISHED", isDeleted: false }
```

Matlab: **ek voucher ke sirf ek hi version ka status `PUBLISHED` ho sakta hai.**
Mongo isse database level par enforce karta hai.

```
v3 PUBLISHED          ← wo ek slot v3 ne le rakha hai
   ↓ vendor pause kare
v3 PAUSED             ← ab status PUBLISHED nahi raha → SLOT KHALI
   ↓ is beech vendor v4 banaye, approve ho, publish kare
v4 PUBLISHED          ← v4 ne wo khali slot le liya
   ↓ ab vendor v3 resume kare
v3 → PUBLISHED ?      ← 🔴 index tootega: E11000 duplicate key
```

Aur `E11000` ko [errorHandler.js:12](../middlewares/errorHandler.js#L12) generic
message me badal deta hai — *"PUBLISHED is already registered for status"* — jo
vendor ko kuch nahi batata.

**Fix:** resume se pehle check ki us voucher ka koi aur `PUBLISHED` version to
nahi. Ho to **saaf 409**: *"Is voucher ka version 4 abhi live hai. Version 3 resume
karne ke liye pehle use pause karein."*

### Delete

Soft delete + `status: DELETED` + `deletedAt`/`deletedBy`/`deleteReason` +
`releaseSlot(brandId, VOUCHERS)`.

#### 🔴 Delete kis-kis cheez ko chhoota hai — sab verify kiya

| Surface | Aaj kya hota hai | Delete ke baad | Kaam chahiye? |
|---|---|---|---|
| **Customer claim history** | `VoucherClaim` apna **`voucherSnapshot`** rakhti hai; claim read pipeline `vouchers`/`voucherversions` ka **lookup karti hi nahi** ([buildClaimReadPipeline.js:296](../helpers/transactions/buildClaimReadPipeline.js#L296)) | ✅ **Kuch nahi tootega** — history poori tarah snapshot par chalti hai | ❌ |
| **Dobara claim** | `buildClaimPreview` `status: PUBLISHED` + `isActive` + `isDeleted: false` teeno maangta hai ([buildClaimPreview.js:100-104](../helpers/vouchers/buildClaimPreview.js#L100)), aur `createVoucherClaimOrder` wahi builder use karta hai | ✅ **Apne aap block** — deleted aur paused dono par | ❌ |
| **Customer listing / detail** | `status: "PUBLISHED"` + `isDeleted: false` | ✅ Apne aap gayab | ❌ |
| **Category / subcategory counts** | `buildTaxonomyStats` dono par `isDeleted: false` ([:88, :94](../helpers/taxonomy/buildTaxonomyStats.js#L88)) | ✅ Count se nikal jayega | ❌ |
| **Suggested vouchers** | `isDeleted: false` | ✅ | ❌ |
| **Vendor listing** | `getAllVoucherVersions` → `match = { isDeleted: false }` | ✅ Vendor ko nahi dikhega | ❌ |
| **Admin listing** | 🔴 **Wahi `isDeleted: false` hardcoded hai — ADMIN ke liye bhi** ([:124](../services/vouchers/getAllVoucherVersions.js#L124)) | ❌ **Admin deleted voucher dekh hi nahi payega** | ✅ **Haan** |
| **Claim history me voucher ki image** | `voucherSnapshot` me sirf `{ name, categoryId, subCategoryId }` hai ([createVoucherClaimOrder.js:290](../services/voucherClaims/createVoucherClaimOrder.js#L290)) — **koi image, koi banner nahi** | ⚠️ **Aaj bhi** history me image dikhti hi nahi | ✅ **Haan** |

#### Do kaam nikle

1. **Admin ko deleted dikhana** — `getAllVoucherVersions` me `includeDeleted`
   filter, sirf ADMIN ke liye, `deletedAt` / `deletedBy` / `deleteReason` ke saath.
2. **Snapshot bharna (V-12)** — `voucherSnapshot` me `bannerUrl` + `image` (pehli
   image) bhi save hon. Ye **aaj bhi ek gap hai**, delete ke baad nahi banta —
   claim history me voucher ki tasveer kabhi dikhi hi nahi.

   > ⚠️ Purane claims me ye field nahi hoga. Response par `?? null` — client ko
   > blank tile ki jagah "no image" milega, code nahi phatega.

#### Delete block

Claim `PENDING` ya `PAID` ho to delete **nahi** — **ADMIN ke liye bhi**.

`PAID` ka matlab: customer ne **paise de diye**, par abhi tak redeem nahi kiya.
Us voucher ko delete karna customer ka paisa phansa dega — aur ye moderation ka
sawaal nahi, paise ka hai. Admin ke paas galat content hatane ke liye **pause** aur
**expire** dono hain, jo paisa nahi phansate. Isliye yahan admin ko exempt karna
ek shortcut hai jiska nateeja customer bhugtega.

Message: *"Is voucher par N live claim hain. Pehle pause karein — claim redeem ya
expire hone ke baad delete ho jayega."*

---

# Part 4 — Master phase list

**37 phase, 6 block.** Har phase ek chhota, apne aap me poora chunk hai.

## Block A — Hotfix (sabse pehle, live data ka risk)

| Phase | Kaam | Size |
|---|---|---|
| **A-1** ✅ | **P2** — voucher customer detail se storage leak band (`images` + `offers` whitelist) | ~1.5 h · 1 commit |
| **A-2** ✅ | **P1** — shared-image delete se published voucher bachao (reference count) | ~2 h · 1 commit |
| **A-2b** ✅ | Stale `storage.test.js` — suite ka permanent red (A-1/A-2 ke dauraan mila) | ~0.5 h · 1 commit |
| **A-3** ✅ | **Naya leak** — `GET /promotional-tickers/customer/active` poora document bhejta hai (`icon.storage.publicId`/`bucket`/`key`), route **bilkul public** hai | ~1 h · 1 commit |

> A-1/A-2 `toMediaResponse` se pehle hain kyunki ye live risk hain aur F-3 ka
> intezaar nahi kar sakte. F-3 baad me inhe generic bana dega.

## Block F — Foundation (sab isi par khada hai)

| Phase | Kaam | Size |
|---|---|---|
| **F-1** | `getSetting()` TTL cache + invalidate — aaj har read ek **write** hai | ~1 h · 1 commit |
| **F-2** | `Setting.storage` block + `getStorageConfig()` + min(global,surface) + cross-validation | ~3 h · 2 commit |
| **F-3** | `mediaSchema` + `posterSchema` + `toMediaResponse` + facade ka naya return shape | ~3.5 h · 2 commit |
| **F-4** | Provider Setting se (ST-1) + **preflight probe** (ST-2) + env sirf seed default | ~2.5 h · 1 commit |

## Block M — Media unification (5 chunk, domain-wise)

| Phase | Kaam | Size |
|---|---|---|
| **M-1** | Sidecar → `mediaSchema`: Brand ×2, SubBrand ×2, Category, SubCategory, BrandFeatures, User | ~3 h · 2 commit |
| **M-1b** | **Customer profile pic** — CUSTOMER role ka upload `Customer.image` par, `User.image` unset rahe | ~1.5 h · 1 commit |
| **M-2** | Documents: Dispute, RefundRequest, Settlement, Transaction | ~2 h · 1 commit |
| **M-3** | Banner ×3 + PromotionalTicker (inline → mediaSchema, hardcoded enum khatam) | ~2.5 h · 1 commit |
| **M-4** | ShowcaseSection: `medias[]` + `thumbnail` → mediaSchema + **poster** | ~2.5 h · 1 commit |
| **M-5** | Voucher.banner + VoucherVersion.images[] + dead joi import (P10, P11) | ~2.5 h · 1 commit |

## Block S — Showcase ([detail yahan](./showcase_rules_and_upload_plan.md))

| Phase | Kaam | Size |
|---|---|---|
| **S-1** | Setting: `minItemsPerSection`, `minSectionsPerBrand`, GIF, cross-validation | ~2 h · 1 commit |
| **S-2** | `sortOrder` auto-manage (media + section) + `__v` + `VersionError` → 409 | ~4 h · 3 commit |
| **S-3** | Write guards — media floor, section floor, ADMIN exempt | ~2.5 h · 2 commit |
| **S-4** | Customer reads — min filter + **re-sequencing (1,3 → 1,2)** + clips | ~3.5 h · 2 commit |
| **S-5** | Managed reads — `customerVisibility { isLive, reasons[] }` | ~1.5 h · 1 commit |

> Purana **SC-0** (cover `.mp4`) ab **M-4** me hai — `poster` mandatory hone se
> wo bug rah hi nahi jaata.

## Block V — Voucher

| Phase | Kaam | Size |
|---|---|---|
| **V-1** | Setting: `minImages` + per-kind size caps config se (P12) | ~2 h · 1 commit |
| **V-2** | **Min 3 images** — 3 jagah, ek helper, ek message (P13) | ~1.5 h · 1 commit |
| **V-3** | Uploads transaction ke bahar — create + update (P3) | ~2.5 h · 1 commit |
| **V-4** | **Banner ka naya shape + approval + image fallback** (V-2…V-6, V-4a, P5, P9) — sabse bada | ~5 h · 3 commit |
| **V-5** | **Pause / resume** + unique-index trap ka 409 (V-7, P7) | ~2 h · 1 commit |
| **V-6** | **Delete**: `DELETED` status · `deletedAt`/`deletedBy`/`deleteReason` · slot release · live-claim guard (V-8, V-11, P7) | ~2.5 h · 1 commit |
| **V-6b** | **Admin ko deleted dikhana** — `includeDeleted` filter, ADMIN-only (V-13) | ~1.5 h · 1 commit |
| **V-6c** | **Claim snapshot bharna** — `voucherSnapshot` me banner + pehli image (V-12) | ~1.5 h · 1 commit |
| **V-7** | Image **reorder** endpoint (V-9, P8) | ~1.5 h · 1 commit |

## Block U — Upload (presigned direct-to-S3)

| Phase | Kaam | Size |
|---|---|---|
| **U-1** | `/uploads/presign` + `/uploads/confirm` wiring; TTL config se | ~4 h · 2 commit |
| **U-2** | Pehli surface — category (pilot, dual mode) | ~2 h · 1 commit |
| **U-3** | Showcase surface — multi-file + thumbnail pairing | ~4 h · 2 commit |
| **U-4** | Voucher surface — images + banner + poster | ~3 h · 2 commit |
| **U-5** | Baaki surfaces — brand, subBrand, category, ticker, avatar, features | ~5 h · 6 commit |

## Block X — Infra

| Phase | Kaam |
|---|---|
| **X-1** | CloudFront + resize Lambda (widths `160/400/800/1600`, `gifs/` bahar) |
| **X-2** | Metadata Lambda (video duration/dimensions) + retry sweep |
| **X-3** | Panel + app migration (doosri team) |
| **X-4** | Multipart + `express-fileupload` sunset (U ship + 6 hafte) |

---

# Part 4B — Har phase ka kaam, poori list

> Har phase ek chhota, apne aap me poora chunk hai. Har ek ke baad report, phir
> aapki commit permission.

## A-1 · Voucher customer detail ka storage leak — ✅ **DONE** (uncommitted)
`helpers/vouchers/customerListing.js` · `docs/customer_mobile_api_doc.md` · `postman/trydood-customer.*`
- [x] Shared `toCustomerImage` / `toCustomerOffer` / `toCustomerOffers` — listing **aur** detail dono isi ko padhte hain, to dobara drift nahi ho sakta
- [x] `mapCustomerVoucherDetail` me `images` whitelist → `{_id, url, sortOrder}`
- [x] `offers` whitelist → 8 field; `_id` **rakha** (claim `offerId` isi par lagta hai)
- [x] 🔴 **Deleted aur switched-off offers ab bhejte hi nahi** — pehle poora array jaata tha, to band offer screen par dikhta tha aur tap karne par `buildClaimPreview` payment ke waqt refuse karta tha
- [x] `NARROW_VERSION_IMAGES` stage — `storage` Mongo se hi nahi nikalta (dono pipeline)
- [x] `pickBestOffer` bhi wahi shape use karta hai
- [x] **12 unit test** — `__tests__/unit/customerVoucherLeak.test.js`
- [x] **Mutation 7/7 mare** — whitelist, offer filter, `_id`, pipeline narrowing, sab
- [x] Docs + postman captured example naye shape par

> **Postman me asli leak capture hua tha** — `images[].storage.provider` aur offers
> me `sortOrder`/`isActive`/`isDeleted`. Patch in-place kiya (1 line diff), poori
> collection regenerate nahi ki.

## A-2 · Shared image delete se published voucher bachao — ✅ **DONE** (uncommitted)
naya `helpers/vouchers/orphanImages.js` · `services/vouchers/updateVoucher.js` · `docs/vendor_panel_api_doc.md` · `postman/trydood-vendor.*`
- [x] `pickOrphanImages(images, voucherId)` — identity par match: S3 `key` → Cloudinary `publicId` → legacy `url`
- [x] Commit ke **baad** chalta hai, taaki surviving versions ki asli haalat padhe
- [x] `voucherId` par scoped — fork hi ek raasta hai jisse key share hoti hai, aur wo ek voucher ke andar rehta hai (indexed query)
- [x] Jiska koi identity hi nahi, use delete list me daala hi nahi jaata
- [x] Fork path ka behaviour nahi badla (wo pehle se sahi tha)
- [x] **12 unit test** · **Mutation 7/7 mare**

> 🔴 **Pehli mutation run me 4 mutant zinda bache the.** Wajah: S3 fixture ka
> `url` khud key se banta tha, to `key` comparison hatane par bhi URL se match ho
> jaata tha — test us comparison ke baare me kuch prove hi nahi kar raha tha. Aur
> legacy wale test me assertion **galat direction** me tha (`[]` dono soorat me
> aata). Fixtures se `url` hataya taaki har identity path akela exercise ho, aur
> ek ulta-direction test joda. Tab 7/7.

## A-2b · Ek stale test theek kiya (A-1/A-2 ke dauraan mila)
`__tests__/unit/storage.test.js`
- [x] `buildDocumentKey` ka test **purana signature** bhej raha tha — object `{year, series, documentNumber}`, jabki production (`services/uploads/index.js`) **string** bhejta hai
- [x] `keys.js` sahi tha, test stale tha — suite me ek permanent red
- [x] Sahi contract par laaya + ek refusal test joda

## A-3 · Ticker customer leak — ✅ **DONE** (uncommitted)
`services/promotionalTickers/getActiveTickersForCustomer.js` · `docs/customer_mobile_api_doc.md` · `postman/trydood-customer.*`
- [x] `toCustomerShape` whitelist (banner jaisa) — `{_id, title, icon, redirect, displayOrder}`
- [x] `icon` ab **string** hai, object nahi — banner ke `url` jaisa
- [x] `.select("title icon.url redirect displayOrder")` — `storage` Mongo se nikalta hi nahi
- [x] Ye bhi hate: `startDate` · `endDate` · `isActive` · `isDeleted` · `createdBy` · `updatedBy` · `createdAt` · `updatedAt`
- [x] Admin reads (`getAllTickers`, `getTicker`) **chhue nahi**
- [x] **10 unit test** · **Mutation 8/8 mare**
- [x] Customer doc ka example khud leak dikha raha tha (`"storage": {...}`) — rewrite kiya, contract-change note ke saath
- [x] Postman ke **3 captured example** patch kiye — ab poori customer collection me `storage` **0**

> ⚠️ **Contract change** (Part 8 me bhi): `icon` object → string, aur 8 admin
> fields hat gaye. Pre-launch hai, app abhi ban raha hai — isliye ek hi baar
> badla, M-3 me dobara nahi badlega.

---

## F-1 · `getSetting()` TTL cache — ✅ **DONE** (uncommitted)
`helpers/settings/getSetting.js` · `helpers/settings/index.js` · `services/settings/updateSetting.js` · `helpers/notifications/audienceChannels.js`
- [x] 30s TTL snapshot; `updateSetting` **save ke baad** invalidate karta hai
- [x] **Read path se `upsert` hata** — ab wo sirf tab chalta hai jab document hai hi nahi
- [x] **In-flight dedupe** — cold cache par burst ek query karta hai, N nahi
- [x] 🔴 **Writer ko alag document** — `getSettingDocument()`, uncached. `updateSetting` jo mila usi par `Object.assign` karke `save()` karta hai; shared snapshot dena readers ko aadha-bana update dikha deta, aur validation fail hone par bhi wahi dikhta rehta
- [x] ⚠️ **`toObject()`, `.lean()` nahi** — lean hydration skip karta hai, aur hydration hi schema defaults lagati hai. Maap kar dekha: `hydrate(raw).toObject()` → `maxImages: 5`, raw → `undefined`. Lean lene par har config helper jiske paas `??` fallback nahi hai, `undefined` padhta
- [x] Snapshot **deep-frozen** — reader galti se bhi shared state nahi badal sakta
- [x] Stale comment theek kiya — `audienceChannels.js` kehta tha "`getSetting()` is a `findOneAndUpdate` ... a **write**"
- [x] **12 unit test** · **Mutation 8/8**

> ⚠️ **Multi-instance ki seema:** cache **per process** hai. Render par do instance
> settings badalne ke baad **30 second tak** alag jawab de sakte hain. Ye theek hai
> kyunki ye commercial knobs hain (fee slab, upload ceiling, limits) — koi paisa
> 30 second purane number se reconcile nahi hota. Jis value ko sach me exact hona
> ho, wo is function se **padhi hi nahi jaani chahiye**.

## F-2 · `Setting.storage` block — ✅ **DONE** (uncommitted)
`models/Setting.js` · `validator/settings.js` · naye `helpers/settings/{getStorageConfig,assertStorageLimitRule}.js` · `services/settings/updateSetting.js` · 3 docs · postman
- [x] Naya **top-level** `storage` block — `provider` · `limits` (5) · `allowed` (5) · `upload` (3) · `delivery` (1) = **15 field**
- [x] `getStorageConfig()` — `MEDIA_KIND` ke hisaab se `maxBytes` / `maxSizeMB` / `allowedTypes`, aur TTL har caller ki unit me
- [x] `effectiveLimitMB(global, surface)` = **min**
- [x] `assertStorageLimitRule` — surface > global par **422**, **merged document** par (dono alag request me aa sakte hain)
- [x] `updateSetting` block-by-block merge karta hai + guard chalata hai
- [x] Provider enum `Object.values(STORAGE_PROVIDER)` se — F-3 me `AWS_S3` hote hi apne aap follow karega
- [x] **16 unit test** · **Mutation 9/10**
- [x] admin doc · `setting_fields_reference.json` (15 field + cross-field rule) · `setting_default_response.json` · admin postman (GET example + PUT description)
- [x] Money-suite ka `settingsSurface` guard pre-verify kiya — model **15** leaves, validator **15**, dono taraf exact match

> 🔴 **Bacha hua mutant ne meri ek galat comment pakdi.** `presignEnabled ?? false`
> par maine likha tha ki `||` stored `false` ko "unset" padhega — **is field ke liye
> sach nahi**, kyunki default bhi `false` hai, to teenon input par dono ek hi
> jawab dete hain. Comment aur test dono me sach likh diya: `??` yahan **habit**
> hai, kisi maujooda behaviour ki wajah nahi — aur wo habit us din kaam aayegi jab
> koi default `true` kar dega.

> ⚠️ **`MAX_BYTES` ko config se jodna U-1 me hai, yahan nahi.** `constants/storage.js`
> ka `MAX_BYTES` uncommitted Phase 5 kaam hai aur use sirf `presign.js` padhta hai
> (wo bhi uncommitted). Use abhi chhedne ka matlab doosre phase ka aadha kaam is
> commit me ghaseetna hota. `getStorageConfig()` taiyaar hai; U-1 usi se padhega.

## F-3 · `mediaSchema` + `toMediaResponse` — ✅ **DONE** (uncommitted)
naye `models/mediaSchema.js` · `helpers/media/toMediaResponse.js` · `constants/storage.js` · 4 models · `configs/env/schema.js` · 5 test files
- [x] `storageRefSchema` · `posterSchema` · `mediaSchema`
- [x] **VIDEO par `poster` required**
- [x] `toMediaResponse(media, { withMeta })` — default URL string, `storage` **kabhi nahi**; poster bhi URL par flatten
- [x] Provider enum `S3` → **`AWS_S3`** (M-2)
- [x] 🔴 **Chaar model ka hardcoded `["CLOUDINARY","S3"]` ab `Object.values(STORAGE_PROVIDER)`** — Banner ×3, Ticker, Voucher, VoucherVersion. Warna enum rename unhe ek aise value par chhod deta jise aur koi use hi nahi karta
- [x] `configs/env/schema.js` · `.env.example` · reference JSON · admin doc · `s3_migration_phases.md`
- [x] **17 unit test** · **Mutation 11/11**

> 🔴 **Mera pehla validator chal hi nahi raha tha.** `mediaSchema.pre("validate")`
> me `this.invalidate("poster", …)` — single nested sub-document par wo parent ki
> error list tak **pahunchta hi nahi**: VIDEO bina poster ke bilkul clean validate
> ho gaya. Maap kar pakda, phir conditional `required` par le gaya, jo chaaron case
> sahi karta hai aur sahi path (`…poster`) bhi deta hai.

> ⚠️ **Do money-suite test tootne wale the** — `brandImages.test.js` aur
> `documentDelivery.test.js` `provider: "S3"` likhte hain, jo ab enum me hai hi
> nahi. Enum rename ke saath hi 8 jagah theek kiye. 60 minute ki suite chalane se
> pehle pakda.

> ⚠️ **Cloudinary ka toota `thumbnail` derivation yahan nahi hataya — M-4 me
> jaayega.** Use aaj `helpers/showcases/upload.js` padhta hai, aur showcase abhi
> `thumbnail` field par hai, `poster` par nahi. Abhi hataane se ek window banti
> jisme video ke paas **na** toota poster hota **na** naya — aur cover `.mp4` ban
> jaata. M-4 me showcase `poster` par jaayega aur derivation usi commit me hategi,
> to kabhi dono ke beech ka haal nahi aayega.

## F-4 · Provider Setting se + preflight
`services/storage/index.js` · `services/settings/updateSetting.js` · `configs/env/schema.js` · naya `services/storage/preflight.js`
- [ ] `activeProvider()` ab `Setting.storage.provider` se
- [ ] `MEDIA_PROVIDER` env sirf **seed default**
- [ ] Preflight probe — PUT→GET→DELETE, dono bucket, `staging/` prefix
- [ ] Fail → **422**, switch save hi na ho
- [ ] CloudFront na hone par **warning** (block nahi)
- [ ] `providerFor(asset)` jaisa hai waisa — row apna provider follow kare
- [ ] **Proof:** galat creds par switch refuse · switch ke baad naye upload naye provider par, purane delete purane se

---

## M-1 · Sidecar models → `mediaSchema`
Brand ×2 · SubBrand ×2 · Category · SubCategory · BrandFeatures · User
- [ ] `logoStorage` / `imageStorage` / `iconStorage` → `logo: mediaSchema` etc.
- [ ] Har read par `toMediaResponse` → **URL string, koi client change nahi**
- [ ] `DEFAULT_IMAGES` placeholder guard chalu rahe
- [ ] **Proof:** response string hi rahe · shared placeholder delete na ho

## M-1b · Customer profile pic
`models/Customer.js` · `services/users/updateUserById.js` · customer reads
- [ ] `Customer.image` → `mediaSchema` (aaj khaali `String`, koi upload path likhta hi nahi)
- [ ] **CUSTOMER role** ka profile update `Customer.image` likhe, `User.image` **chhue hi nahi**
- [ ] VENDOR / SUB_VENDOR / ADMIN pehle jaisa `User.image` par
- [ ] Customer reads `Customer.image` se
- [ ] **Proof:** customer update ke baad `User.image` unset · vendor update se Customer row na bane

## M-2 · Documents → `mediaSchema`
Dispute · RefundRequest · Settlement · Transaction
- [ ] `documentStorage` → `document: mediaSchema`, `kind: DOCUMENT`
- [ ] `documentUrl` response me waisa hi
- [ ] Phase 4 ka presigned-GET flow na toote
- [ ] **Proof:** invoice URL Cloudinary **aur** S3 dono par

## M-3 · Banner + Ticker → `mediaSchema`
`models/Banner.js` · `models/PromotionalTicker.js` · `constants/banner.js` · banner/ticker services · docs · postman
- [ ] `Banner.image|video|gif` → ek **`media: mediaSchema`**; `Banner.type` field **hatao** (`media.kind` se aayega)
- [ ] `PromotionalTicker.icon` → `mediaSchema`
- [ ] `BANNER_TYPE` · `BANNER_MEDIA_FIELD` · `BANNER_ALLOWED_MIME_TYPES` **hatao**
- [ ] `toCustomerShape` ab `media.kind`/`media.url` se — **same keys**
- [ ] create/update: file field `media` (+ `poster` video par); body se `type` hatao
- [ ] admin reads: `media` object
- [ ] **Proof:** customer banner response **byte-for-byte same** · video bina poster reject

## M-4 · Showcase media → `mediaSchema`
`models/ShowcaseSection.js` · `helpers/showcases/{upload,validateMedia,projections}.js` · showcase services
- [ ] `medias[]` → `mediaSchema`; `thumbnail` + `thumbnailStorage` → **`poster`**
- [ ] `isCustomThumbnail` ka legacy Cloudinary branch **hatao** — auto-poster ab hai hi nahi, to wo sawaal hi nahi bachta
- [ ] `getMediaCoverImage` ab poster/image se → **`.mp4` cover khatam**
- [ ] `getAllVideoClips` ka `$ifNull` blank-frame fallback hatao
- [ ] Customer response me `thumbnail` key **bani rahe** (`poster.url` se)
- [ ] **Proof:** video-first section ka cover kabhi `.mp4` nahi · clips me poster hamesha

## M-5 · Voucher media → `mediaSchema`
`models/VoucherVersion.js` · `models/Voucher.js` · voucher services
- [ ] `VoucherVersion.images[]` → `mediaSchema`
- [ ] `Voucher.banner` → naya shape (`current` / `pending` / `status`)
- [ ] `sortOrder max: 5` **hatao** (P4)
- [ ] Dead `require("joi")` hatao (P10) · hardcoded provider enum hatao (P11)
- [ ] **Proof:** money suite

---

## S-1 … S-5 · Showcase
Detail: [showcase_rules_and_upload_plan.md](./showcase_rules_and_upload_plan.md) §SC-1…SC-5

- **S-1** Setting: `minItemsPerSection` · `minSectionsPerBrand` · GIF · `maxGifSizeMB` · cross-validation
- **S-2** `sortOrder` auto-manage (media + section) · `versionKey` on · `VersionError` → **409** (aaj 500 girta hai) · `reorderSectionMedia` ka scope non-deleted sab · create/update se `sortOrder` hatao
- **S-3** Write guards — `assertMediaFloor` · `assertSectionFloor` · ADMIN exempt
- **S-4** Customer reads — `$expr` min filter · **re-sequencing (1,3 → 1,2)** · clips se incomplete sections exclude · clips 404 → empty list
- **S-5** `customerVisibility { isLive, reasons[], minItemsRequired }` managed reads par

---

## V-1 · Voucher Setting + model limits
- [ ] `Setting.vendor.voucher.minImages` (default **3**, `min: 1`, **≤ maxImages**)
- [ ] Per-kind size cap global se (P12 — aaj voucher images par **koi size check nahi**)
- [ ] `getVoucherConfig()` naye fields expose kare
- [ ] Docs + postman

## V-2 · Min 3 images
- [ ] Ek helper, **teen** jagah — `createVoucher` · `mergeImages` · `validateVoucherBeforeSubmit`
- [ ] Model par `>= 1` structural floor rahega (model async config nahi padh sakta)
- [ ] **Ek message**, aur usme agla kadam — *"kam se kam 3 chahiye, abhi 2 hain, 1 aur add karein"* (P13: aaj 4 jagah 4 alag message)
- [ ] **Proof:** teenon raaste par test · mutation: har jagah alag-alag hatao

## V-3 · Uploads transaction ke bahar
`services/vouchers/{createVoucher,updateVoucher}.js`
- [ ] `createVoucher`: images (`:125`) + banner (`:184`) upload **transaction shuru hone se pehle**
- [ ] `updateVoucher`: images (`:305`) transaction ke bahar
- [ ] Fail par rollback pehle jaisa hi kaam kare
- [ ] **Proof:** 5 image + video banner par transaction 60s limit na chhue · rollback test
- [ ] 🔴 **A-2 ka bacha hua integration test yahan** — `updateVoucher` ko koi test service
      level par exercise nahi karta, isliye "orphan check bypass" wala mutant unit
      level par pakda nahi jaata. Yahan `updateVoucher` waise bhi chhu rahe hain, to
      voucher + fork + update ka setup share ho jayega: v1 PUBLISHED → fork v2 → v2 se
      image remove → **v1 ka file zinda** rehna chahiye (aapka faisla)

## V-4 · Banner ka naya shape + approval + fallback
`models/Voucher.js` · `services/vouchers/{setVoucherBanner,publishVoucher,submitVoucherForReview}.js` · naya review service · routes · docs · postman
- [ ] `banner: { current, pending, status, rejectionReason, reviewedBy, reviewedAt }`
- [ ] `VOUCHER_BANNER_*` constants **hatao** — `media.kind` se
- [ ] **Replace par `current` live rehta hai**, naya `pending` me
- [ ] **`DELETE` endpoint hatao** (V-3)
- [ ] Admin banner review endpoint (approve / reject + reason)
- [ ] **Fallback:** `banner.current ?? images[0]` — `bannerIsFallback` flag response me
- [ ] `submit-for-review` par banner **mandatory**; publish **block nahi**
- [ ] VIDEO banner par poster mandatory
- [ ] **Proof:** reject ke baad voucher PUBLISHED rahe aur pehli image dikhe · replace ke dauraan purana live rahe · money suite

## V-5 · Pause / resume
- [ ] `PUBLISHED → PAUSED` aur ulta
- [ ] 🔴 **Resume se pehle check** — koi aur `PUBLISHED` version to nahi (partial unique index `{voucherId, status}`); ho to **saaf 409**, `E11000` nahi
- [ ] Customer reads par kuch nahi karna — `status: "PUBLISHED"` filter pehle se hai
- [ ] **Proof:** pause → naya version publish → resume par 409 (500/E11000 nahi)

## V-6 · Delete
- [ ] `VOUCHER_STATUSES.DELETED` enum me
- [ ] Soft delete + `status: DELETED` + `deletedAt` + `deletedBy` + `deleteReason` — **ek hi jagah se, saath me**
- [ ] `releaseSlot(brandId, VOUCHERS)`
- [ ] **Live-claim guard** — `PENDING`/`PAID` par block, **ADMIN par bhi**; response me `liveClaims` + `breakdown` + `suggestedAction`
- [ ] **Proof:** claim history na tootey (snapshot-based, verified) · dobara claim block (pehle se) · money suite

## V-6b · Admin ko deleted dikhana
- [ ] `getAllVoucherVersions` me `isDeleted: false` **hardcoded hai admin ke liye bhi** — `includeDeleted` filter (ADMIN-only)
- [ ] `deletedAt` · `deletedBy` · `deleteReason` response me
- [ ] Docs + postman

## V-6c · Claim snapshot bharna
- [ ] `voucherSnapshot` me `bannerUrl` + pehli image bhi (aaj sirf `{name, categoryId, subCategoryId}`)
- [ ] Purane claims me field nahi → `?? null`, client ko saaf "no image"
- [ ] **Proof:** naya claim → history me image · purana claim → blank nahi, null

## V-7 · Voucher image reorder
- [ ] Naya endpoint, showcase jaisa — poori list, 1..n
- [ ] Pehli image hi banner fallback hai, to iska seedha asar dikhega
- [ ] Docs + postman

---

## U-1 … U-5 · Upload
- **U-1** `/uploads/presign` + `/uploads/confirm` — facade `acceptUpload` · `acceptUploads` middleware · route/controller/validator · TTL config se · teen-docs rule
- **U-2** Category pilot (dual mode, sabse chhoti surface)
- **U-3** Showcase surface — multi-file + poster pairing
- **U-4** Voucher surface — images + banner + poster
- **U-5** Baaki surfaces — brand, subBrand, ticker, avatar, features (6 commit)

---

# Part 4C — Traceability: har faisla → kaunsa phase

> **Ye review ka tool hai.** Har locked decision aur har verified problem ke
> saamne wo phase likha hai jo use poora karta hai. Phase ka report aate hi aap
> is table se match kar sakte hain. Koi row bina phase ke nahi hai.

## Storage & media

| Decision | Kya | Phase |
|---|---|---|
| M-1 | Ek generic `mediaSchema` har jagah | F-3 → M-1…M-5 |
| M-2 | Provider enum `AWS_S3` | F-3 |
| M-3 | `toMediaResponse` — client na toote | F-3 |
| M-4 | Storage internals kabhi leak na hon | F-3 (+ A-1, A-3 turant) |
| M-5 | Purana data ignore | — (koi migration nahi) |
| M-6 | `poster` VIDEO par mandatory | F-3 |
| M-7 | Poster kabhi derive nahi — Cloudinary derivation hatao | F-3 (+ M-4 cleanup) |
| M-8 | `image`/`video`/`gif` teen-field khatam | M-3 (Banner), M-5 (Voucher) |
| ST-1 | Provider `Setting.storage.provider` se | F-4 |
| ST-2 | S3 switch par preflight probe | F-4 |
| ST-3 | Env sirf seed default | F-4 |
| ST-4 | `min(global, surface)` + 422 | F-2 |

## Voucher — decisions

| Decision | Kya | Phase |
|---|---|---|
| V-1 | Min 3 images, GIF haan / video nahi | V-2 (limit V-1 me) |
| V-2 | Banner submit par mandatory | V-4 |
| V-3 | Banner delete nahi | V-4 |
| V-4 | Banner ka apna approval | V-4 |
| V-4a | Reject par `images[0]` fallback, publish block nahi | V-4 |
| V-5 | Replace par `current` live rehta hai | V-4 |
| V-6 | Banner IMAGE/VIDEO/GIF + poster | V-4 |
| V-7 | Pause / resume | V-5 |
| V-8 | Delete + live-claim guard (admin par bhi) | V-6 |
| V-9 | Image reorder endpoint | V-7 |
| V-10 | Alag `allowedImages` nahi | V-1 |
| V-11 | `DELETED` status enum | V-6 |
| V-12 | Claim snapshot me banner + pehli image | V-6c |
| V-13 | Admin ko deleted dikhe | V-6b |

## Voucher — 13 verified problems

| # | Problem | Phase |
|---|---|---|
| P1 🔴 | Shared image delete → published voucher ka image marta hai | **A-2** |
| P2 🔴 | Customer detail se `storage` leak | **A-1** |
| P3 🔴 | Uploads Mongo transaction ke andar | **V-3** |
| P4 🟠 | `sortOrder max: 5` vs config | **M-5** |
| P5 🟠 | Banner review bypass | **V-4** |
| P6 🟠 | VIDEO banner ka poster nahi | **F-3** |
| P7 🟠 | Delete/pause hai hi nahi; `PAUSED` dead | **V-5 + V-6** |
| P8 🟡 | Image reorder nahi | **V-7** |
| P9 🟡 | `default: () => ({})` — teen khaali object | **V-4** |
| P10 🟡 | Dead `require("joi")` | **M-5** |
| P11 🟡 | Inline storage + hardcoded enum | **M-5** |
| P12 🟡 | Voucher images par koi size check nahi | **V-1** |
| P13 🟡 | min-1 check 4 jagah, 4 message | **V-2** |

## Teen leak (sab covered)

| Leak | Endpoint | Phase |
|---|---|---|
| Voucher detail — `images[].storage`, raw `offers` | `GET /vouchers/customer/get/:id` (public) | **A-1** |
| Ticker — poora document, `icon.storage` | `GET /promotional-tickers/customer/active` (public) | **A-3** |
| Structural fix — dobara ho hi na sake | sab | **F-3** (`toMediaResponse`) |

> Banner customer endpoint pehle se saaf hai — koi phase nahi chahiye.

## Showcase (S-1…S-16 → S-1…S-5)

| Decisions | Phase |
|---|---|
| S-1 (3 = visible), S-11 (`$expr`), S-4 (position), S-6 (clips empty), S-10 (legacy gayab) | **S-4** |
| S-7 (GIF = PHOTO), S-15 (`getSetting` cache → F-1) | **S-1**, **F-1** |
| S-2 (section guarantee), S-3 (ADMIN exempt) | **S-3** |
| S-5, S-12, S-13, S-14 (`sortOrder` scope), S-9 (`__v` + 409) | **S-2** |
| S-8 (`customerVisibility`) | **S-5** |
| S-16 (cover hamesha image) | **M-4** |

## Upload

| Decision | Phase |
|---|---|
| Route A · E1 · E2 · `uploadIds` · quota presign par | **U-1** |
| Pehli surface = category | **U-2** |
| E5 — upload transaction ke bahar | **V-3** (voucher), **U-5** (`updateBrand`) |

---

# Part 5 — Order aur dependency

```
A-1 ─┐
A-2 ─┤  (live risk — sabse pehle, kisi par depend nahi)
     │
F-1 ─┤  (har config read isi par)
F-2 ─┤  (F-1 par)
F-3 ─┤  (mediaSchema — M aur V-4 dono ko chahiye)
F-4 ─┘  (F-2 par)
     │
M-1 … M-5   (F-3 par · aapas me independent · koi bhi order)
     │
     ├── S-1 → S-2 → S-3 → S-4 → S-5      (S-1 F-2 par; S-4 M-4 par)
     │
     ├── V-1 → V-2 → V-3 → V-4 → V-5 → V-6 → V-7   (V-1 F-2 par; V-4 M-5 par)
     │
     └── U-1 → U-2 → U-3 → U-4 → U-5      (U-3 S ke baad, U-4 V ke baad)
                │
                └── X-1 … X-4
```

**S aur V block aapas me independent hain** — dono M ke baad, kisi bhi kram me, ya
saath saath.

## Estimation

| Block | Phases | Waqt | Commits |
|---|---|---|---|
| A — Hotfix | 3 | ~4.5 h | 3 |
| F — Foundation | 4 | ~10 h | 6 |
| M — Media | 6 | ~15.5 h | 7 |
| S — Showcase | 5 | ~13.5 h | 9 |
| V — Voucher | 9 | ~22 h | 14 |
| U — Upload | 5 | ~18 h | 13 |
| **Kul (X chhod kar)** | **32** | **~83.5 h** | **52** |

Alag se: money suite ~60 min × 5 (M-5, S-2, S-4, V-4, **V-6**) = **~5 h**.
V-6 par isliye ki delete claim/transaction/settlement sab ko chhoota hai.

**Sabse chhota useful stop:** A + F + M = **~27.5 h** — teeno 🔴 bug band, ek
generic media shape, customer profile pic zinda, aur admin se provider switch.

---

# Part 6 — Har phase ka acceptance (kuch na chhoote)

Har phase ye **sab** poora karega, warna wo phase done nahi hai:

- [ ] Code + inline `⚠️` / `🔴` notes wahan jahan wajah non-obvious ho
- [ ] Unit tests — nayi shakha par ek, har guard par ek
- [ ] **Mutation test** — fix hatao, test marna chahiye. Na mare to test jhootha hai
- [ ] `verifyImports` · `verifyApiCoverage` · `verifyEnvCoverage` teeno pass
- [ ] **Teen docs ka rule** (naye/badle endpoint par): map row + role-doc section + postman request + captured example
- [ ] Money suite — sirf M-5, S-2, S-4, V-4 par
- [ ] Report → **phir aap bolenge, tab commit**

---

# Part 7 — Challenges

| # | Challenge | Handling |
|---|---|---|
| 1 | `mediaSchema` har model chhoota hai — ek bada diff | 5 domain-wise chunk (M-1…M-5), har ek apne aap me poora |
| 2 | Client response shape | `toMediaResponse` default sirf URL — **koi client nahi tootega** (M-3) |
| 3 | M ke dauraan do shape saath chalengi | `toMediaResponse` dono padhta hai; har chunk ke baad ek domain poora naye shape par |
| 4 | Admin S3 par switch kar de aur AWS galat ho | Preflight probe — 422, switch save hi nahi (ST-2) |
| 5 | S3 par resize/poster X-1/X-2 tak nahi | Switch par warning; `poster` mandatory hone se video phir bhi theek |
| 6 | Banner mandatory — purane bina-banner voucher | Pre-launch, data disposable. Submit par rukega, message saaf |
| 7 | Voucher resume par E11000 | Resume se pehle "koi aur PUBLISHED version to nahi" check → saaf 409 |
| 8 | Delete se customer ka paisa phans sakta hai | `PENDING`/`PAID` claim par block, pause suggest karo |
| 9 | Setting cache multi-instance par 30s stale | Har row apna provider likhti hai → nuksan nahi. Doc me seema likhi |
| 10 | Global vs surface limit ka conflict | `min()` + save par 422 (ST-4) |
| 11 | S-2 ka renumber concurrent delete par | `__v` on + `VersionError` → 409 |
| 12 | Panel ko 5 + 4 contract change | Har ek doc + postman ke saath usi commit me; Part 8 me list |

---

# Part 8 — Panel / app team ko batane hain

**Showcase (5):** `sortOrder` create/update se hata · media reorder ab non-deleted
sab maangta hai · naya `customerVisibility` · clips 404 → empty list · customer
`sortOrder` ab display position hai.

**Voucher (6):** `DELETE /vouchers/:voucherId/banner` **hata** · banner response me
`bannerType`/`bannerUrl` ke saath ab `bannerStatus` aur `bannerIsFallback` · naya
image reorder endpoint · naye pause / resume / delete endpoints · admin listing me
`includeDeleted` filter · `VOUCHER_STATUSES` me naya `DELETED`.

**Storage (2):** admin Setting me naya top-level `storage` block · provider enum
ki value badli (`S3` → `AWS_S3`).

**Customer app (3):** CUSTOMER ka profile pic ab `Customer.image` se aayega,
`User.image` se nahi · **ticker ka `icon` ab string hai** (object nahi) aur 8 admin
fields hat gaye (A-3 — **ship ho chuka**) · voucher detail me `offers` se band/deleted
offers nahi aate (A-1 — **ship ho chuka**).

---

# Part 9 — Jawab mil chuke (locked)

| # | Sawaal | Faisla |
|---|---|---|
| Q1 | `Customer.image` | ✅ **Zinda karna hai.** CUSTOMER role ka profile pic yahan, `User.image` vendor/admin ke liye jaisa hai waisa (M-1b) |
| Q2 | Banner kab mandatory | ✅ **Submit-for-review par** |
| Q3 | Banner reject hua to | ✅ **Voucher PUBLISHED rehta hai**, pehli image banner ban jaati hai (V-4a) |
| Q4 | Delete ADMIN ke liye bhi block | ✅ **Haan** — paise ka guard |
| Q5 | S3 switch X-1 se pehle | ✅ **Warning ke saath haan** |
| Q6 | GIF avatar/logo par | ✅ **Nahi** |
| — | Provider enum | ✅ **`AWS_S3`** (aaj `"S3"` hai) |

| Q7 | Provider enum ki spelling | ✅ **`AWS_S3`** — underscore, baaki sab jaisa |
| Q8 | Video poster derive karein? | ✅ **Bilkul nahi.** Hamesha alag se upload. Cloudinary ki maujooda derivation hatani hai — wo toota URL banati hai |
| Q9 | Banner ke teen field (`image`/`video`/`gif`) | ✅ **Khatam** — ek `media: mediaSchema`. Rakhne ka koi valid karan nahi mila (§1B.1) |
