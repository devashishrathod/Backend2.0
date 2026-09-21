# Trydood 2.0 — Master Execution Plan

> **Status:** design **approved aur locked**.
>
> **Ship ho chuka:** Block A (A-1 · A-2 · A-2b · A-3) · Block F (F-1…F-4) ·
> Block M (M-1 · M-1a′ · M-1a″ · M-1b · M-2 · M-3 · M-3a · M-4 · M-5) ·
> **Block S poora** (S-1…S-5) · **Block V poora** (V-1…V-7).
>
> **Block V ka V-6 bhi ship ho chuka** — teen commit me: `verifyApiCoverage` ka
> fix, `WriteConflict` → 409, aur delete khud.
>
> **Block V poora** (V-1…V-7), **Block U poora** (U-1…U-5) aur **Block G poora**
> (G1…G12 — code-end ke saare gap). **Agla: Block X** (infra) — X-1 CloudFront +
> resize Lambda, X-2 metadata Lambda, X-3 panel migration (doosri team), aur X-4
> multipart sunset jo Cloudinary ke apne presign ke baad hoga. Storage ka final
> faisla §0.5 me locked hai — prod S3-only aur client sirf presigned.
> ⚠️ **X-4 (multipart sunset) wapas khula hai** — multipart Cloudinary ka
> ekmatra upload raasta hai, to wo tab tak rahega jab tak Cloudinary ka apna
> presign ship na ho (§0.5 🔮).
>
> ### 🔴 Delivery abhi bhi blocked hai, aur wo code ka issue nahi hai
>
> Live probe (2026-09-18) se: `CDN_BASE_URL` `https://cdn.trydood.com` par set
> hai aur wo host **resolve hi nahi hota** (ENOTFOUND); public bucket bina
> credentials ke **403** deta hai. Yaani provider S3 par karte hi har media URL
> mar jaayegi. Upload, delete, replace aur documents sab chalte hain — sirf
> public media ka **delivery** toota hai. Detail §0.6 me.
>
> ### ⚠️ U-1 commit 2 se aage ka kuch bhi commit nahi hua
>
> Aapke kehne par: kaam poora, test poore, mutation poori — par `git commit` ek
> bhi nahi. Kaunsi file kis logical commit ki hai, wo
> `scratchpad/UNCOMMITTED-MANIFEST.md` me likha hai, taaki baad me commit karna
> khudai ka kaam na ho.
>
> **O-3** (chaar dead knob) aur **O-4** (multipart par size cap) ab **band** hain
> — Block G me. **O-1** (OTP throttle) 2026-09-21 ko band hua. Khula sirf **O-2**
> (poori money suite ek saath green nahi rehti) hai, jaanboojh kar. **Block X** (infra) baaki
> hai, aur uska pehla kadam code nahi — AWS hai (§0.6).
>
> Har phase ka detail aur uska commit hash Part 4B me. Part 4 ka table sirf
> **estimate** hai — jo actually laga wo detail section me likha hai.
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
| **M-1a** | Sidecar kaise banega | **Sidecar hi rahega, par generic** — `logo: String` (delivery URL) + `logoMedia: mediaSchema`. `logo` ko khud `mediaSchema` banane ka matlab tha **55 read sites** (49 projection + 6 select, ~25 files) me se har ek ko map karna, aur aggregation ke `$project: { logo: 1 }` me koi mapper hota hi nahi — ek miss = us endpoint par string ki jagah object, **chupchaap**. Duplication (`url` do jagah) yahan sasti hai: dono hamesha ek hi service me, ek saath likhe jaate hain |
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

## 0.5 Storage ka final faisla — locked 2026-09-18

> **Kuch bhi live nahi hai** — na app, na vendor panel, na admin panel. Ye ek
> aisi khidki hai jo dobara nahi milegi, aur ye saare faisle usi par tike hain.
> Jis din koi client live hua, inme se aadhe palatne mehenge ho jayenge.

| Cheez | Faisla |
|---|---|
| **Production ka storage** | **S3-only**, din ek se |
| **Cloudinary** | Code me rahega — `url` + `remove` ke liye, aur `upload` bhi **multipart ke raaste** (neeche) |
| **Dev / stage** | S3 par, `dev/` aur `staging/` prefix ke saath |
| **Stage ka purana data** | **Jaisa hai waisa** — 211 Cloudinary rows, migrate nahi karenge |
| **Provider switch** | **Dynamic rahega** — `providerFor(asset)` har row ka apna provider padhta hai |
| **Client ka upload** | **Sirf presigned** (S3). Multipart server par rahega, client ko nahi diya jaayega |
| **Dual mode (transport)** | **Nahi chahiye** — koi purana client version hai hi nahi |
| **X-4 (multipart sunset)** | 🔄 **Badla — 2026-09-18.** Multipart U-5 me **delete nahi** hoga; wo Cloudinary ka ekmatra upload raasta hai. Sunset tabhi jab Cloudinary ka apna presign (§🔮) ship ho jaye |
| **Order** | V-6c → V-7 → U-1…U-5 → X-1/X-2 |

### Prod S3-only kyun — suvidha nahi, ek gap

Cloudinary par **private documents ka short-lived link ban hi nahi sakta**.
`services/storage/index.js` ka `documentUrl` khud kehta hai: Cloudinary ki
delivery URL hi ekmatra URL hai — permanent aur public. Invoice PDF par
customer ka naam, pata, GSTIN aur amount hota hai. Wo finding **S3 par hi band
hoti hai**, kyunki `signedGetUrl` sirf S3 provider ke paas hai.

### ⚠️ Cloudinary ka `upload` sirf multipart se pahunchta hai — aur isi liye multipart rahega

Ye **maan kar** liya gaya hai, bhoola nahi gaya:

```
provider.upload()  ←  sirf uploadFromPath() bulata hai
uploadFromPath()   ←  sirf 19 call-sites bulate hain
wo 19 call-sites   ←  sirf multipart se file paate hain
koi script/seeder upload nahi karta — check kiya, zero
```

Multipart hatte hi Cloudinary ka `upload` kisi ke haath nahi aayega, kyunki
`presign.js` `@aws-sdk/s3-presigned-post` par bana hai aur Cloudinary ke paas
is shape ka kuch nahi hai.

> ### 🔴 Isiliye U-5 multipart **delete nahi** karega — faisla 2026-09-18 ko dobara confirm hua
>
> Pehle yahan likha tha ki prod S3-only hai, to doosra upload raasta zinda rakhne
> ka koi kharidar nahi. Wo tab tak sach hai jab tak **koi** Cloudinary par nahi
> jaata — aur `Setting.storage.provider` ek dropdown hai jo kal badal sakta hai.
>
> Multipart hata dene ka matlab hota: us dropdown ko Cloudinary par le jaate hi
> upload ka **koi** raasta nahi bachta. Ek switch jo sab kuch chalu rakhne ka
> vaada karta ho aur upload band kar de, wo switch na hone se bura hai.
>
> To multipart **rahega**, Cloudinary ke upload raaste ke roop me. Sunset tabhi
> hoga jab §🔮 wala Cloudinary presign ship ho jaye — tab dono provider ka apna
> presign hoga aur multipart ka koi kaam nahi bachega.

### 🔮 Future (locked): dono provider presigned, zero client change

> **Faisla 2026-09-18 — abhi S3, Cloudinary baad me.** Aaj presigned raasta sirf
> S3 par hai aur wahi ship ho raha hai. Cloudinary ka apna presigned upload
> **baad me** aayega, **usi generic shape me**, taaki client me **ek line na
> badle** — surface wahi `uploadId` bhejegi, facade tay karega kis provider ka
> presign dena hai.
>
> Andaza **~8-10 ghante + tests** (pehle ~6-8 likha tha; `confirm` ka
> magic-byte + move step Cloudinary par alag shape leta hai, isliye upar).
>
> ⚠️ **Tab tak multipart hi Cloudinary ka upload raasta hai** — dekhein upar.

Cloudinary ka signed direct upload (`presign`/`confirm` ka Cloudinary version)
facade ke peechhe aayega, taaki `acceptUpload` dono par ek jaisa chale.

🔴 **Client me tab bhi kuch nahi badlega.** Wo already sabit hai:

- `toMediaResponse` ek **whitelist** hai — default me sirf URL string, `withMeta`
  par `url,kind,width,height`. `provider` sirf admin ko, aur `bucket`/`key`/
  `publicId` kabhi kisi ko nahi
- `providerFor(asset)` har row ka apna provider padhta hai, aaj ka setting nahi

**2026-09-18 ko stage par naapa gaya:** 211 asli media rows, sab Cloudinary —
`url()` me **0 fail**, asli fetch **5/5 → HTTP 200**. Usi process me ek
synthetic `AWS_S3` row ne `https://cdn.trydood.com/images/…` lautaya. Ek hi
setting, do alag jawab, row ke hisaab se. **Mixed database sach me chalta hai.**

### Stage migrate kyun nahi kar rahe

Wahi mixed state prod me kabhi nahi hogi (prod fresh hai) — par stage par usi
se roz sabit hota rehta hai ki migration path zinda hai. Migrate kar dete to ye
ek kaam karta hua raasta apne aap test hona band ho jaata.

### Jo blocker nahi hain

- **X-1 (CloudFront)** — `preflight.js` khud kehta hai ki uske bina S3 poora
  chalta hai: upload, delete, delivery sab. Sirf **resize** nahi hota, yaani
  bhaari original phone par jaata hai. Isi liye wo **warning hai, refusal nahi**
- **X-2 (metadata Lambda)** — sirf S3 par chahiye. Cloudinary upload par hi
  `width`/`height` laut deta hai (18 Sept ke probe me dikha); S3 kuch nahi
  batata, isliye `mediaSchema` me wo `null` default hain
- **"6 hafte"** — wo window sirf purane app versions ke liye tha. Koi purana
  version hai hi nahi, to wo window bemani hai. ⚠️ Par **X-4 khud khatam nahi
  hua** — multipart Cloudinary ka ekmatra upload raasta hai, to uska sunset
  Cloudinary ke apne presign (§0.5 🔮) ke baad hi hoga, waqt ke hisaab se nahi

---

## 0.6 🔴 Delivery blocked hai — aur wo code me nahi hai

> **Live probe, 2026-09-18.** Code padh kar nahi — asli bucket par asli object
> likh kar, aur wahi URL **bina credentials ke** kholi jo app DB me likhti hai.

```
CDN_BASE_URL      : https://cdn.trydood.com      ← .env me SET hai
AWS_REGION        : ap-south-1
public bucket     : trydood-nonprod-public
private bucket    : trydood-nonprod-private

── CDN wali URL (jo DB me likhi jaati hai)   🔴 ENOTFOUND
── Seedhi S3 URL (CDN bypass)                🔴 403 AccessDenied
── private bucket anonymous                  ✅ 403 (jaisa hona chahiye)
── signed GET banti hai                      ✅ haan
```

`nslookup cdn.trydood.com` → naam hai, **address nahi**.

### Do blocker, dono AWS ke

| # | Kya | Asar |
|---|---|---|
| **1** | Public bucket par Block Public Access **on** hai | Har `<img src>` ko **403** |
| **2** | `cdn.trydood.com` exist hi nahi karta | Har URL **ENOTFOUND** |

⚠️ **Preflight ise pehle nahi pakadta tha** — wo `getS3Client()` se likhta-padhta
hai, yaani signed. Ab **G4** dono check karta hai aur switch ko **rokta** hai
(warning nahi), kyunki nateeja "poore platform ka media toota" hai.

### Aaj ki haalat — DB se

```
Setting.storage.provider : (set hi nahi)  →  code Cloudinary par gir jaata hai
DB me Cloudinary URLs    : 458
DB me S3 URLs            : 0
DB me cdn.trydood URLs   : 0
```

Yaani **abhi kuch toota hua nahi hai**. Ye tab tootega jis second koi dropdown
S3 par le jaayega — aur ab preflight use rok dega.

### ✅ Kya phir bhi chalta hai

Upload (dono road), delete, replace, aur **documents poori tarah** — wo private
bucket + per-request signed link par hain, jinhe na public read chahiye na
CloudFront. Sirf **public media ka delivery** ruka hai.

### Do raaste

| | Kya karna | Trade-off |
|---|---|---|
| **A** | `CDN_BASE_URL` khali karo + bucket par public-read policy | Turant chalu, par koi resize nahi aur bucket khula. ⚠️ URL **likhne ke waqt** row me bake hoti hai, to is raaste par likhi rows me raw S3 URL hamesha rahegi |
| **B** | `CDN_BASE_URL` waisa hi rakho, provider **S3 par mat karo** jab tak CloudFront live na ho | Bucket band rahega (OAC), resize milega, aur **ek bhi tooti URL kabhi likhi hi nahi jaayegi** |

🔮 **Sifarish: B.** Stage ka data disposable hai, to intezaar ka koi kharcha nahi.

### ⚠️ Frontend team ko kya batana hai

Presign ka contract final hai — integration aaj shuru ho sakta hai. Par
**presign se chadhi file abhi dikhegi nahi**, aur wo backend ka bug nahi hai.
Bina ye bataye wo teen din "images kyu nahi aa rahi" debug karenge.

🔴 Aur ek: `presign`/`confirm` **hamesha S3 par likhte hain**. Provider Cloudinary
par ho to presign ab **409** deta hai (G5) — pehle wo chup-chaap do provider par
row bana deta.

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
✅ BANNER_TYPE · BANNER_MEDIA_FIELD · BANNER_ALLOWED_MIME_TYPES   ← M-3 me hate
⬜ VOUCHER_BANNER_TYPE · VOUCHER_BANNER_MEDIA_FIELD
⬜ VOUCHER_BANNER_FILE_FIELD · VOUCHER_BANNER_ALLOWED_MIME_TYPES  ← M-5
```

Banner ki jagah ab ek `BANNER_MEDIA_KINDS` hai — teen mime lists ki jagah ek
kind list, aur kind `kindFromMime` se aata hai. Mime allow-lists
`Setting.storage.allowed.*` se aayengi.

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
| 3 | `GET /banners/get-all`, `/get/:id` (admin) | `image`\|`video`\|`gif` object + `storage` + top-level `type` + `isDeleted` | `media` object (`provider` ke saath, locator ke bina); `type`/`isDeleted` **hate** | M-8 |
| 4 | `POST /banners/create`, `PUT /banners/update/:id` | body me `type` + file field `image`\|`video`\|`gif` | file field **`media`** (+ `poster` video par); `type` **hata** | M-8 |
| 5 | `POST /vouchers/:voucherId/banner` | `bannerType` + teen file field | `media` (+ `poster`) | M-8 |
| 6 | `DELETE /vouchers/:voucherId/banner` | maujood | **hata** | V-3 |
| 7 | Voucher customer reads | `{bannerType, bannerUrl}` | wahi **+** `bannerStatus`, `bannerIsFallback` | V-4a (additive) |
| 8 | Showcase vendor reads (`formatManagedMedia`) | `thumbnail` + `storage` + `metadata` alag-alag | ek `media` object | M-4 |
| 9 | Ticker admin reads (`get-all`, `get/:id`, create, update) | `icon.storage` + `isDeleted` | `icon` (media, `provider` ke saath); `isDeleted` **hata** | M-3 |
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
| **F-1** ✅ | `getSetting()` TTL cache + invalidate — aaj har read ek **write** hai | ~1 h · 1 commit |
| **F-2** ✅ | `Setting.storage` block + `getStorageConfig()` + min(global,surface) + cross-validation | ~3 h · 2 commit |
| **F-3** ✅ | `mediaSchema` + `posterSchema` + `toMediaResponse` + facade ka naya return shape | ~3.5 h · 2 commit |
| **F-4** ✅ | Provider Setting se (ST-1) + **preflight probe** (ST-2) + env sirf seed default | ~2.5 h · 1 commit |

## Block M — Media unification (5 chunk, domain-wise)

| Phase | Kaam | Size |
|---|---|---|
| **M-1** ✅ | Sidecar → `mediaSchema`: Brand ×2, SubBrand ×2, Category, SubCategory, BrandFeatures, User | ~3 h · 2 commit |
| **M-1b** ✅ | **Customer profile pic** — CUSTOMER role ka upload `Customer.image` par, `User.image` unset rahe | ~1.5 h · 1 commit |
| **M-2** ✅ | Documents: Dispute, RefundRequest, Settlement, Transaction | ~2 h · 1 commit |
| **M-3** ✅ | Banner ×3 + PromotionalTicker (inline → mediaSchema, hardcoded enum khatam) | ~2.5 h · 1 commit |
| **M-4** ✅ | ShowcaseSection: `medias[]` + `thumbnail` → mediaSchema + **poster** | ~2.5 h · 1 commit |
| **M-5** ✅ | Voucher.banner + VoucherVersion.images[] + dead joi import (P10, P11) | ~2.5 h · 1 commit |

## Block S — Showcase ([detail yahan](./showcase_rules_and_upload_plan.md))

| Phase | Kaam | Size |
|---|---|---|
| **S-1** ✅ | Setting: `minItemsPerSection`, `minSectionsPerBrand`, GIF, cross-validation | ~2 h · 1 commit |
| **S-2** ✅ | `sortOrder` auto-manage (media + section) + `__v` + `VersionError` → 409 | ~4 h · 3 commit |
| **S-3** ✅ | Write guards — media floor, section floor, ADMIN exempt | ~2.5 h · 2 commit |
| **S-4** ✅ | Customer reads — min filter + **re-sequencing (1,3 → 1,2)** + clips | ~3.5 h · 2 commit |
| **S-5** ✅ | Managed reads — `customerVisibility { isLive, reasons[] }` | ~1.5 h · 1 commit |

> Purana **SC-0** (cover `.mp4`) ab **M-4** me hai — `poster` mandatory hone se
> wo bug rah hi nahi jaata.

## Block V — Voucher

| Phase | Kaam | Size |
|---|---|---|
| **V-1** ✅ | Setting: `minImages` + per-kind size caps config se (P12) | ~2 h · 1 commit |
| **V-2** ✅ | **Min 3 images** — 3 jagah, ek helper, ek message (P13) | ~1.5 h · 1 commit |
| **V-3** ✅ | Uploads transaction ke bahar — create + update (P3) | ~2.5 h · 1 commit |
| **V-4** ✅ | **Banner ka naya shape + approval + image fallback** (V-2…V-6, V-4a, P5, P9) — sabse bada | ~5 h · 3 commit |
| **V-5** ✅ | **Pause / resume** + unique-index trap ka 409 (V-7, P7) | ~2 h · 1 commit |
| **V-6** ✅ | **Delete**: `DELETED` status · `deletedAt`/`deletedBy`/`deleteReason` · slot release · live-claim guard (V-8, V-11, P7) | ~2.5 h · 1 commit |
| **V-6b** ✅ | **Admin ko deleted dikhana** — `includeDeleted` filter, ADMIN-only (V-13) | ~1.5 h · 1 commit |
| **V-6c** ✅ | **Claim snapshot bharna** — `voucherSnapshot` me banner + pehli image (V-12) | ~1.5 h · 1 commit |
| **V-7** ✅ | Image **reorder** endpoint (V-9, P8) | ~1.5 h · 1 commit |

## Block U — Upload (presigned direct-to-S3)

| Phase | Kaam | Size |
|---|---|---|
| **U-1** ✅ | `/uploads/presign` + `/uploads/confirm` wiring + `acceptUpload` facade | ~4 h · 2 commit |
| **U-2** ✅ | Pehli surface — category (pilot) | ~1.5 h · 1 commit (uncommitted) |
| **U-3** ✅ | Showcase surface — multi-file + thumbnail pairing (+ limits dono raaston par) | ~4 h · 2 commit (uncommitted) |
| **U-4** ✅ | Voucher surface — images + banner + poster (+ 🆕 `VOUCHER_BANNER_POSTER` purpose) | ~3 h · 1 commit (uncommitted) |
| **U-5** ✅ | Baaki surfaces — brand, subBrand, **subCategory**, ticker, avatar, features (+ 🆕 `BANNER_POSTER`, E5, teesri delete-order galti). ⚠️ **multipart delete isme se nikal gaya** — wo X-4 hai, aur X-4 Cloudinary ke presign ke baad hi hoga (§0.5) | ~4 h (uncommitted) |

## Block G — Code-end ke saare gap ✅

> **Sab DONE, uncommitted.** Ye block U-5 ke baad ke poore gap hunt se aaya: code
> se dhoondha gaya, docs se nahi. Barah me se **paanch ek hi cheez** the — *ek hi
> file, do road, do jawab* — jo migration ki sabse khatarnak class hai, kyunki
> dono taraf code "sahi" chalta hai aur kisi log me kuch nahi aata.

| # | Gap | Kya tha | Kahan |
|---|---|---|---|
| **G1** ✅ | Multipart par nau surfaces ka koi size cap nahi | Sirf 100 MB ka transport limit; presigned road purpose ka cap lagata tha | `accept.js` |
| **G2** ✅ | 🔴 Multipart road file ke **bytes dekhta hi nahi** tha | `identify()` ka ek hi caller tha — `confirm`. Mime wahi tha jo client ne header me likha | `accept.js` · `inspect.js` |
| **G3** ✅ | Multipart par dimensions hamesha `null` | Ek hi PNG, do road, do row | `accept.js` |
| **G4** ✅ | Preflight dead CDN aur band bucket ko nahi pakadta tha | Sirf "CDN_BASE_URL khali hai kya" puchta tha, "kaam karta hai kya" nahi | `preflight.js` |
| **G5** ✅ | `Setting.storage` ke chaar knob dead | Schema, validator, doc — par koi reader nahi (= purana O-3) | `presign.js` · `index.js` |
| **G6** ✅ | Chaar create-path me confirm ke baad rollback nahi | Object final key par orphan; `staging/` lifecycle use kabhi nahi chhuti | 4 services |
| **G9** ✅ | Do stale comment | Dono kehte the "multipart U-5 me hat jaayega" | `accept.js` · `index.js` |
| **G10** ✅ | `uploadAudio` dead code | 0 caller. Purpose aur `MAX_BYTES` row bhi saath gaye | `uploads/index.js` |
| **G11** ✅ | Showcase poster pairing galat jud sakti thi | Comment ne jo daava kiya, code wo karta nahi tha | `pairPosters.js` 🆕 |
| **G12** ✅ | Teen poster purpose apni surface rule se **wide** the | Presign GIF poster ko signature de deta, surface uske baad 422 deta — bytes kharch hone ke baad | `constants/storage.js` |
| **G13** ✅ | 🔴 **iPhone ki HEIC photo video ban jaati thi** | G2 ka apna blind spot — `ftyp` dekh kar rukna. Detail neeche | `inspect.js` · `presign.js` |

> ### 🔴 G13 — G2 ne jo khud chhod diya tha
>
> **Kaise mila:** commit se pehle ke aakhri check me, ye puch kar ki "bytes hi
> faisla karte hain, to iPhone ki photo ka kya hota hai?"
>
> HEIC, HEIF aur AVIF **wahi container** hain jo MP4/MOV hai — teeno me offset 4
> par `ftyp`. Signature check wahin ruk jaata tha, to:
>
> ```
> HEIC (iPhone photo)  →  MP4/MOV / video/mp4 / VIDEO
> ```
>
> **Asar 18 me se 4 surfaces par** — `SHOWCASE_MEDIA`, `BANNER_MEDIA`,
> `VOUCHER_BANNER`, `LEGACY` — kyunki `accept.js:199` sirf
> `entry.kinds.includes(identified.kind)` dekhta hai:
>
> | Surface | Kya hota tha |
> |---|---|
> | Image-only (14) | Refuse — par message *"does not accept MP4/MOV files"*, jo photo bhejne wale ko samajh hi nahi aata |
> | **Video lene wali (4)** | 🔴 Photo `videos/` me `video/mp4` ban kar **store ho jaati**. Player khol nahi paata. Kuch error nahi, kuch log nahi |
>
> ⚠️ **Ye G2 ka apna regression tha, aur wo likha hona chahiye.** HEAD par
> purani allow-list (`constants/showcase.js:66`) me `image/heic` tha hi nahi, to
> header par bharosa karne wala purana code use **refuse** kar deta tha. Bytes
> padhne ke baad wo `VIDEO` ban kar aage nikal gayi. Ek check ko sahi karne ne
> ek naya raasta khol diya — isi liye "ab bytes padhte hain" kaafi nahi hota,
> ye bhi dekhna padta hai ki **kaun se** bytes.
>
> **Fix:** offset 8 ka ISO brand padho. HEIF/AVIF brands naam se refuse, jaise
> SVG aur HTML hote hain; asli video brands (`isom`, `mp42`, `qt  `, `3gp4`,
> `avc1`) jaise the waise. **Image family allow-list hai, video nahi** — dono
> ulti disha me fail hote hain: anjaan video brand ko video maanna sahi hai,
> anjaan image brand ko video maanna yahi bug hai.
>
> 🔴 **Aur ek parat, usi jaanch me:** `kindFromMime("image/heic")` → `IMAGE`, to
> presign road signature de deta, client **poori file** chadhata, aur tab confirm
> refuse karta. Wahi G12 wali baat. **SVG par bhi yahi ho raha tha.** Ab
> `refusalForMime()` ek hi list se dono road ko jawab deta hai, aur refusal ke
> shabd word-for-word ek hain.
>
> ⚠️ Refusal ka message customer ke liye likha gaya hai, hamare liye nahi:
> *"HEIC photos are not supported yet — please send a JPEG or PNG. On an iPhone:
> Settings → Camera → Formats → Most Compatible."* Ye wo refusal hai jise ek aam
> customer sach me milega, to use "no" par khatam nahi hona chahiye.

> ### 🔴 G2 — sabse zaroori, aur sabse chupa hua
>
> `inspect.js` khud apne header me likhta hai ki har "is this an image?" check
> `file.mimetype` padhta hai aur wo **client likhta hai**. Us file ka
> `identify()` poore repo me sirf **ek jagah** se bulaya jaata tha — `confirm`,
> yaani sirf presigned road. Multipart par:
>
> - `providers/s3.js` ne wahi `Content-Type` store kiya jo client ne bheja
> - SVG aur HTML ka naam-se-refusal chalta hi nahi tha
> - `kind` bhi usi claim se banta tha → galat prefix → ek GIF `images/` me girta,
>   `gifs/` me nahi, jahan X-1 ka resize uski animation flatten kar deta
>
> ⚠️ **XSS ka risk kam hai** (type pinned hone par browser SVG nahi chalata), par
> **koi bhi bytes** aapke CDN domain se serve ho sakte the. Ab dono road pehla
> kilobyte padhte hain — `HEAD_BYTES` bhi ek hi jagah se aata hai, taaki dono
> barabar padhein.
>
> ### ⚠️ Refusal ke shabd dono road par ek jaise hain
>
> Jaan-bujh kar word-for-word: *"That file type is not supported."*,
> *"USER_AVATAR does not accept MP4/MOV files."*, *"That file is 3 MB. The limit
> here is 2 MB."* Ek hi problem ke do wording support queue ko sikha deti hai ki
> ye do alag problem hain.
>
> ### 🔴 G5 ka faisla — default `false`, aur `confirm` flag padhta hi nahi
>
> Presign band karna un uploads ko nahi phansana chahiye jo chal rahe hain: wo
> bytes bucket me aa chuke hain aur kharch ho chuke hain. To switch **darwaza
> band karta hai, andar wale ko phansata nahi**.
>
> ⚠️ Aur ek naya guard: platform Cloudinary par ho aur presign on ho to **409**.
> Warna ek hi surface ke kuch row S3 par aur kuch Cloudinary par baith jaate, sirf
> is hisaab se ki client ne kaunsa road liya.
>
> ⚠️ `assertStorageLimitRule` me naya rule: `intentTtlMinutes` `presignTtlMinutes`
> se chhota nahi ho sakta. Dono alag-alag valid hain (1–60 aur 1–1440), to koi
> validator ise akela pakad nahi sakta — galat sirf **ek doosre ke rishte me** hai.
>
> ### Proof
>
> unit **711/711** (40 suites) · money upload suites **153/153** ·
> `uploadPresignConfirm` **23/23** · mutation **29/29 MARA** (20 unit + 9 money) ·
> naya `pairPosters.test.js` · naya shared fixture `__tests__/support/localFile.js`
>
> ⚠️ Mutation me ek mutant **zinda bacha tha** aur wo ganwaaya nahi gaya:
> `presignTtlSeconds` do jagah use hota hai — `Expires:` (jo S3 enforce karta hai)
> aur `expiresInSeconds:` (jo client ko bataya jaata hai) — aur test sirf doosri
> ka tha. Naya test signed policy ko base64 se decode karke uski apni `expiration`
> padhta hai. Review se ye nahi milta; mutation se mila.

---

## Block X — Infra

> 🚀 **Production par jaane ka kadam-dar-kadam sequence:**
> **[production_go_live_runbook.md](./production_go_live_runbook.md)** — kram,
> har kadam ka verify, rollback, aur kya-kya env badalna hai.
> AWS ka setup (bucket, IAM, CloudFront) uska vishay nahi —
> wo [aws_s3_setup.md](./aws_s3_setup.md) me hai.

> ### 📌 Is server me **kitna code** bacha hai — 2026-09-19, code se verify karke
>
> Block X ka naam "Infra" hai, par sab infra nahi hai. Ye table sirf **is repo ka**
> bacha hua kaam ginati hai:
>
> | Phase | Backend code bacha? | Kya, theek-theek |
> |---|---|---|
> | **X-1** | ❌ **kuch nahi** | Backend ka hissa **ho chuka**. `?w=` client jodta hai; poore repo me koi width/allowlist/srcset logic hai hi nahi (khoja gaya, 0 hits). GIF ko resize se bachana key ke prefix se hota hai (`gifs/` vs `images/`), aur G2 ke baad `kind` **verified bytes** se banta hai — to `.png` naam wali GIF bhi `gifs/` me hi girti hai |
> | **X-2** | ✅ **haan — teen cheezein** | 1. `mediaSchema` par **`pending` flag nahi hai** (P7-1 ko chahiye). `duration` hai, default `0` — [`models/mediaSchema.js:148`](../models/mediaSchema.js) · 2. **Hourly retry sweep job nahi hai** (P7-2) — par infra maujood hai: [`jobs/index.js`](../jobs/index.js) me ~20 job `setInterval` + [`helpers/jobs/jobLock.js`](../helpers/jobs/jobLock.js) par · 3. Lambda se DB tak ka **raasta tay nahi** — agar endpoint se, to naya route + `endpoints_category` + role doc + Postman request + example (teeno collection ka niyam) |
> | **X-3** | ❌ backend ka nahi | Doc + Postman pehle se tayyar. Ek setting badalni hogi: `storage.upload.presignEnabled = true` |
> | **X-4** | ✅ haan — par **roka hua** | Multipart + `express-fileupload` hatana. Niche dekhein |
>
> ⚠️ **X-1 aur X-2 ka Lambda source is repo me nahi hai** — koi `lambda/`,
> `infra/` ya `terraform/` folder maujood nahi. Wo AWS ka kaam hai.
>
> 🔴 **X-2 S3 ko rokta nahi.** Wo **sirf video duration** ke liye hai. Image ke
> `width`/`height` G3 me server par hi ban jaate hain — wahi 1 KB jo signature ke
> liye padha jaata hai, dimensions bhi de deta hai (`services/storage/inspect.js`
> → `readDimensions`). To X-2 se pehle bhi: images poori tarah theek, videos
> chalti aur dikhti hain, bas duration `0:00` rehti hai.
>
> ⚠️ Aur wo `0:00` **chup-chaap** galat hai, isi liye P7-2 ko plan
> ([s3_migration_phases.md:1125](./s3_migration_phases.md)) `CLAUDE.md` ka silent-
> failure rule todne wala batata hai. Isliye X-2 ka sweep uske Lambda ke **saath**
> jaana chahiye, pehle nahi — warna ek aisa job likha jaayega jise koi kabhi green
> hote nahi dekhega, jo bilkul wahi gap hai jo G5 me chaar knobs par mila tha.

| Phase | Kaam |
|---|---|
| **X-1** | CloudFront + resize Lambda (widths `160/400/800/1600`, `gifs/` bahar) |
| **X-2** | Metadata Lambda (video duration/dimensions) + retry sweep |
| **X-3** | Panel + app migration (doosri team) |
| **X-4** | Multipart + `express-fileupload` sunset — 🔄 **wapas khula, 2026-09-18** (§0.5). Pehle "U-5 ke ant me seedha delete" likha tha; wo galat tha, kyunki multipart hi Cloudinary ka ekmatra upload raasta hai aur `Setting.storage.provider` ek dropdown hai. **Sunset tabhi jab Cloudinary ka apna presign ship ho** (§🔮, ~8-10 h). 6-hafte ka purana window ab bhi bemani hai — koi client live nahi hua |

## Block O — OTP throttle (media migration se bahar)

| Phase | Kaam |
|---|---|
| **O-1** ✅ | ~~**OTP throttle burst me khul jaata hai**~~ — **band, 2026-09-21.** Claim ki pehchaan ab per-call nonce se hai, timestamp se nahi; release bhi nonce se. Detail neeche |
| **O-2** | ⚠️ **Poori money suite ek saath green nahi rehti** — suite ke design ki wajah se, kisi ek test ke bug se nahi. Detail neeche |
| **O-3** ✅ | ~~`Setting.storage` ke chaar knob kuch karte hi nahi~~ — **band, Block G me (G5)**. Chaaron ab live hain, aur ek naya rule bhi: intent TTL signature se chhota nahi ho sakta |
| **O-4** ✅ | ~~Multipart raaste par nau surfaces ka koi size cap hai hi nahi~~ — **band, Block G me (G1)**. Dono road ab `getUploadLimit` ka ek hi number padhte hain |

---

# Part 4B — Har phase ka kaam, poori list

> Har phase ek chhota, apne aap me poora chunk hai. Har ek ke baad report, phir
> aapki commit permission.

## A-1 · Voucher customer detail ka storage leak — ✅ **DONE** (`90e1d3a`)
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

## A-2 · Shared image delete se published voucher bachao — ✅ **DONE** (`04d8e2e`)
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

## A-2b · Ek stale test theek kiya (A-1/A-2 ke dauraan mila) — ✅ **DONE** (`14475e5`)
`__tests__/unit/storage.test.js`
- [x] `buildDocumentKey` ka test **purana signature** bhej raha tha — object `{year, series, documentNumber}`, jabki production (`services/uploads/index.js`) **string** bhejta hai
- [x] `keys.js` sahi tha, test stale tha — suite me ek permanent red
- [x] Sahi contract par laaya + ek refusal test joda

## A-3 · Ticker customer leak — ✅ **DONE** (`2c84707`)
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

## F-1 · `getSetting()` TTL cache — ✅ **DONE** (`765669c`)
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

## F-2 · `Setting.storage` block — ✅ **DONE** (`64d1a34`)
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

## F-3 · `mediaSchema` + `toMediaResponse` — ✅ **DONE** (`9e0b19c`, enum rename `7d716bc`)
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

## F-4 · Provider Setting se + preflight — ✅ **DONE** (`6518df1`)
naya `services/storage/preflight.js` · `services/storage/index.js` · `services/settings/updateSetting.js` · `controllers/settings/update.js` · `models/Setting.js`
- [x] `activeProvider()` ab **async**, `Setting.storage.provider` se
- [x] `MEDIA_PROVIDER` sirf **seed default** — model ke `default: () => config.MEDIA_PROVIDER` se, jo sirf document banne par chalta hai. Redeploy panel ki choice ko override nahi karta
- [x] Preflight probe — PUT→GET→DELETE, **dono bucket**, `staging/` prefix, `finally` me cleanup
- [x] Fail → **422**, switch save hi nahi hota; message me bucket + teenon permission
- [x] **Sirf badalne par** probe — wahi provider dobara save karna free hai
- [x] CloudFront na hone par **warning**, block nahi
- [x] `providerFor(asset)` jaisa tha waisa — delete row ka apna provider follow karta hai
- [x] **24 test** (12 preflight + 6 gate + 6 pehle wale) · **Mutation 10/10**

> 🔴 **Mere naye test ne ek asli bug pakda:** `updateSetting` me `throwError`
> **import hi nahi tha**, aur wo naye 422 path me use ho raha tha. `verifyImports`
> ise pakad nahi sakta — wo `require` check karta hai, function body ke andar
> undefined global nahi. Preflight fail hone par `ReferenceError` girta, 422 nahi.

> ⚠️ **Response shape jaan-boojh kar nahi hilaya.** Service ab hamesha
> `{ setting, warnings }` deti hai (kabhi ek shape kabhi doosra — wo har caller
> ko ek branch deta hai). Par **HTTP `data` wahi settings document hai**, jaisa
> tha. Warning **message** me jaati hai, kyunki wahi ek string admin panel hamesha
> dikhata hai.

---

## M-1 · Sidecar models → `mediaSchema` — ✅ **DONE** (`177d67f`, missing-import fix `3118e1a`)
6 models · 11 services · naya `helpers/media/toMediaDocument.js` · 4 docs
- [x] **M-1a ke mutabik**: `logo: String` waisa hi, `logoStorage: storageSchema` → **`logoMedia: mediaSchema`**. Aath field, chhe model
- [x] `toMediaDocument(uploaded)` — ek jagah jo facade ke result ko model ke shape me badalti hai. Pehle gyarah services apni do line likhti thin (`url` + `storage`), isi liye platform ko file ke baare me **kuch aur pata hi nahi tha**
- [x] `toDeletable(media, url)` — `mediaSchema` khud `{url, storage}` hai, to delete me seedha jaata hai; migration se pehle wali row apne URL se delete hoti hai
- [x] `kind` **derive** hota hai, default nahi — na mile to throw. Galat `kind` prefix decide karta hai (`images/` vs `gifs/`), aur use koi dobara nahi poochta
- [x] 11 services: 4 create · 4 update · 3 delete, + brand/subBrand ka `IMAGE_SLOTS` pattern
- [x] **12 unit test** · **Mutation 9/9**
- [x] Docs sync: `s3_media_migration_plan.md`, `media_upload_map.md`, `s3_migration_phases.md` (historical — banner ke saath)

> ✅ **Response shape bilkul nahi hila.** Verify kiya: koi read path sidecar field
> return karta hi nahi tha — na projection me, na `select` me. Isliye `toMediaResponse`
> abhi kisi read me lagana nahi pada; wo M-3/M-4/M-5 me aayega jahan media sach me
> response me jaata hai.

> ⚠️ **Money-suite ka `brandImages.test.js` tootne wala tha** — 16 jagah purane
> naam, aur rename ke baad path bhi galat ho jaate (`logoMedia.provider` ab
> `logoMedia.storage.provider` hai). 60 minute ki suite chalane se pehle theek kiye.

> 🔴 **Ek mutant pehle bacha tha** — `...(poster ? { poster } : {})` → `poster,`.
> Dekha to Jest ka `toEqual` undefined keys ignore karta hai aur Mongoose ke liye
> dono barabar hain. Par ek asli farak hai: `{ ...current, poster: undefined }`
> maujood poster ko **mita** deta hai. Wahi pin karne wala test joda — ab 9/9.

## M-1a′ · Naam: check case-insensitive, save jaisa type kiya — ✅ **DONE** (`0affcfa`)
naya `helpers/common/caseInsensitiveName.js` · `helpers/vouchers/validate.js` · 5 services
- [x] Ye `refactor(naming)` commit ka **anjaana side-effect** theek karta hai. Naam ab jaisa type kiya waisa save hota hai — wo sahi hai — par usi ne duplicate check tod diya tha, kyunki check pehle *lowercase storage* par nirbhar tha
- [x] **Category / SubCategory**: `findOne({ name })` exact match tha → ab `sameNameAs(name)`, anchored + escaped + case-insensitive. "Pizza" aur "pizza" dono nahi ban sakte
- [x] **Voucher**: `normalizedName` wapas lowercase key — uska kaam hi yahi hai. `{ brandId, normalizedName }` ek **unique index** hai, aur wo bytes compare karta hai, matlab nahi
- [x] 🔴 **Ek aur bug jo isi ke saath nikla**: `createVoucher` inner whitespace collapse karta tha, `updateVoucher` sirf trim. To "Pizza  Hut" create par ek row banata aur update par doosra — unique index ke saamne se, kyunki wo do alag string dekhta tha. Ab dono ek hi helper
- [x] `name` / `brandName` / category ka `name` — **sab jaisa type kiya waisa hi** store hote hain. Koi display badla nahi
- [x] **11 unit test** · **Mutation 7/7**

## M-1a″ · Naam UI me jaisa dikhna chahiye waisa save — ✅ **DONE** (`77dc38f`, missing-import fix `fc5531c`)
`helpers/common/names.js` (renamed) · 19 services · 1 helper
- [x] `toDisplayName()` — **sirf tab** badalta hai jab input **poora lowercase** ho. Ek bhi capital ho to vendor par bharosa
- [x] `"john doe"` → `"John Doe"` · `"30% off"` → `"30% Off"` · `"jean-luc"` → `"Jean-Luc"`
- [x] `"30% OFF"` · `"KFC"` · `"iPhone"` · `"McDonald's"` — **haath nahi lagta**
- [x] ALL-CAPS jaan-boojh kar chhoda — "JOHN DOE" shouting hai aur "KFC" naam, aur string me koi farak nahi. Length rule KFC/TGI bachata hai phir IKEA/HDFC bigadta hai
- [x] `cleanName()` — sirf trim + whitespace collapse. **PAN, legalBusinessName, companyName** ke liye: wo document ka record hai, screen ka nahi
- [x] **13 display fields**, 19 write sites: brand, user, category, subCategory, voucher, offer title, showcase section, banner, ticker, brandFeature, subscription
- [x] **18 unit test** · **Mutation 6/6**

> 🔴 **Ek leftover mila**: `addOrUpdateBasicDetails.js` me `brandName` par abhi bhi
> `.toLowerCase()` tha, jabki `updateBrand` me hat chuka tha — **ek hi field, do
> behaviour**. Ab dono ek hi helper se guzarte hain.

> ⚠️ `Customer.fullName` aur `ShowcaseSection.medias[].title` chhode: pehle ka
> koi write path hai hi nahi (M-1b me aayega), doosra **filename se machine-derived**
> hai — `"my_photo_01"` ko `"My_photo_01"` karna behtar nahi.

## M-1b · Customer profile pic — ✅ **DONE** (`564e99c`, doc fix `c0a412b`)
`models/Customer.js` · `services/users/updateUserById.js` · `services/customers/{getAdminCustomerDetail,getAllAdminCustomers}.js` · doc · postman
- [x] `Customer.imageMedia` → `mediaSchema` (M-1a ke sidecar pattern par)
- [x] **CUSTOMER** ka photo `Customer` row par, **`User.image` unset**
- [x] VENDOR / SUB_VENDOR / ADMIN pehle jaisa `User` par
- [x] 🔴 Purana mirror (`customer.image = user.image`) **hata** — ek field ke do writer, wahi jisne email ko dono jagah alag kar diya tha
- [x] Delete us row ka purana photo hataata hai jise replace kiya ja raha hai, doosre ka nahi
- [x] **Referral cards** ab `Customer` se photo lete hain — `User.select("image")` un logon ke liye khali aata jinke baare me wo fraud screen hai. Poore page ke liye ek query
- [x] Admin listing se `account.image` **hata** — wo customer ke liye hamesha null hota
- [x] **16 unit test** · **Mutation 8/8**

> 🔴 **Is phase ke test ne M-1 ka ek shipped bug pakda.** Das services me
> `toMediaDocument` / `toDeletable` **use ho rahe the par import hi nahi hue the** —
> mere patch script ka import-guard chal nahi paaya kyunki file me pehle se
> `helpers/media` ka ek aur import tha. Har image upload runtime par
> `ReferenceError` deta. `verifyImports` ise pakad nahi sakta: wo `require` check
> karta hai, function body ke andar undefined global nahi. **Doosri baar** hua hai
> (pehle F-4 me `throwError`).

> 🔴 **Doc pehle se jhootha tha**: `PUT /users/update` ka response flat
> `{_id, name, image}` dikhaya gaya tha, jabki service hamesha
> `{ userData, customerData }` lautati hai. Ab sach likha hai. Postman ka captured
> example sahi tha (asli API se capture hua tha).

## M-2 · Documents → `mediaSchema` — ✅ **DONE** (`6fabc53`)
`models/{Dispute,RefundRequest,Settlement,Transaction}.js` · `services/documents/getDocumentByToken.js` · `services/transactions/regenerateInvoice.js` · `services/storage/providers/s3.js` · `models/mediaSchema.js` · doc
- [x] `documentStorage: storageSchema` → **`documentMedia: mediaSchema`**, `kind: DOCUMENT` — chaaron models
- [x] `getDocumentByToken` ab `documentMedia.storage` se link mint karta hai; URL-only legacy rows waise hi chalti hain
- [x] `regenerateInvoice` purana document `toDeletable(previousMedia, previousUrl)` se hataata hai
- [x] Response me **kuch nahi badla** — `documentUrl`, `invoiceUrl`, `invoiceDownloadUrl` sab waise ke waise. Postman me koi storage field tha hi nahi, to wahan change nahi
- [x] Phase 4 ka per-request minting flow intact (`storage.documentUrl`)
- [x] **313 unit test pass** · **Mutation 6/6** · `verifyNoUndef` 0 · `verifyImports` 0

> 🔴 **`mediaSchema.url` ka `required: true` galat tha.** Private bucket me generated
> document ka koi lasting URL hota hi nahi — link har request par minta hai. Sahi
> invariant ye hai ki media **locatable** ho: ya URL ho, ya storage key/publicId.
> Ab conditional `required` hai.
>
> ⚠️ Pehle ise `pre("validate")` + `this.invalidate()` se likha tha — **wo chup-chaap
> kuch karta hi nahi**. Single nested sub-document par `invalidate()` parent ki error
> list tak pahunchta hi nahi; measured: bina URL bina key wali media clean validate
> ho gayi. **Yahi trap F-3 me poster par bhi laga tha** — doosri baar.

> 🔴 **`services/storage/providers/s3.js` me ek latent bug mila.** `upload()` me
> `url: exports.url({ storage })` bina guard ke call hota tha, aur `exports.url`
> private bucket par jaan-boojh kar **throw** karta hai. Matlab `MEDIA_PROVIDER=AWS_S3`
> hote hi **har invoice / settlement / refund / chargeback upload 500 deta** — chaaron
> private bucket me render hote hain. Kisi ne pakda nahi kyunki provider abhi
> Cloudinary hai aur document test upload ko mock karte hain. Ab `isPublic` guard hai,
> aur private object par `url`/`thumbnail` dono `null` — jo sahi jawab hai, missing
> nahi.

> 🔴 **Ek jhootha comment hataya** — usi file me likha tha ki thumbnail na hone par
> `syncSectionCoverImage` "falls through to the next visible media". Aisa hota hi
> nahi: `getMediaCoverImage` `thumbnail || url` hai, to cover khud `.mp4` ban jaata
> tha. M-4 derivation poori hataata hai.

## M-3 · Banner + Ticker → `mediaSchema` — ✅ **DONE** (`5c6a60e` + poster follow-up)
`models/{Banner,PromotionalTicker}.js` · `constants/{banner,storage}.js` · `helpers/banners/{media,shape,index}.js` · `helpers/promotionalTickers/{media,shape,index}.js` · `helpers/media/toMediaResponse.js` · banner ×5 + ticker ×5 services · `validator/banners.js` · 3 scripts · docs · postman
- [x] `Banner.image|video|gif` → ek **`media: mediaSchema`**; `Banner.type` field **hata** (`media.kind` se aata hai)
- [x] `PromotionalTicker.icon` → `mediaSchema`, **IMAGE-only** (strip me player hai hi nahi)
- [x] `BANNER_TYPE` · `BANNER_MEDIA_FIELD` · `BANNER_ALLOWED_MIME_TYPES` **hate** → ek `BANNER_MEDIA_KINDS`
- [x] `toCustomerShape` ab `media.kind`/`media.url` se — **same 4 keys, same order**
- [x] create/update: file field **`media`** (+ `poster` video par); body se `type` hata
- [x] admin reads: `media` object — `provider` ke saath, `bucket`/`key`/`publicId` ke bina
- [x] `pre("validate")` hook **hata** — `required` + ek kind validator, aur wo raw `Error` bhi gaya jo 422 ki jagah 500 deta tha
- [x] **30 naye unit test** (`bannerMedia.test.js`) · poori suite **343 pass** · `verifyNoUndef` 0 · `verifyImports` 0

> 🔴 **`.min(1)` validator se hatana pada.** Banner ki tasveer badalna sabse
> common edit hai aur usme koi body field jaata hi nahi — sirf file. `validateSchema`
> ko `req.files` milta hi nahi (wo body/query/params/headers validate karta hai),
> to "at least one field to update" theek wahi request reject karta. Pehle bach
> gaya tha kyunki media badalne ka matlab `type` bhejna bhi tha; ab `type` hai hi
> nahi, to khali body normal case ban gaya. Check ab `updateBanner` me hai jahan
> dono dikhte hain.

> ⚠️ **`?type=` query param jaan-boojh kar bacha hai.** Panel ka filter waisa hi
> chalta hai; andar `media.kind` par match hota hai. Naam badalne se panel tootta
> aur milta kuch nahi.

> 🔴 **Ticker ke admin reads bhi `icon.storage` de rahe the.** A-3 me customer
> feed wala leak band hua tha kyunki wo route bina auth ke tha — ye chaar
> (`get-all`, `get/:id`, create, update) admin gate ke peeche the, isliye kam
> urgent the, utne hi galat. `isDeleted` bhi hataya: har admin read pehle se
> `isDeleted: false` filter karti hai, to wo column hamesha ek hi jawab deta tha.

> ⚠️ **Delete ab `validateBeforeSave: false` se save karta hai** (banner aur
> ticker dono). Pre-migration row me `media`/`icon.kind` hai hi nahi, aur bina
> iske admin theek wahi purani rows delete nahi kar paata jinhe wo saaf karna
> chahta hai.

> ⚠️ **`toCustomerShape` test ke liye export kiya.** Ye migration ka ekmatra
> hissa hai jo app dekhti hai, aur uska proof (keys, naam, values) bina database
> ke ban jaata hai. Sirf live query se reachable rakhne ka matlab tha customer
> contract ka proof money suite me daalna — jo real Atlas par ghante bhar chalti
> hai, yaani practically kabhi-kabhi.

### M-3a · Poster client tak pahunchana — **locked rule**

> 🔴 **Poster store karke na bhejna mandatory rakhne ka matlab hi khatam kar deta
> hai.** M-3 me VIDEO banner par poster mandatory ho gaya tha par customer
> response me jaata hi nahi tha — app phir bhi `.mp4` buffer hone tak khali
> rectangle dikhati.
>
> **Niyam:** jahan bhi VIDEO client tak jaata hai, uska poster `thumbnail` key me
> saath jaata hai. DB me field `poster` rahega, wire par naam `thumbnail` — kyunki
> showcase/vendor/clips sab pehle se `thumbnail` bolte hain.

- [x] `toMediaResponse` ab `poster` ki jagah **`thumbnail`** key nikaalta hai (withMeta + forAdmin dono)
- [x] Banner customer response me **`thumbnail`** — VIDEO par poster, IMAGE/GIF par media ka apna URL (kabhi `null` nahi, taaki client `type` par branch na kare)
- [x] Purane app builds par asar nahi — naya key **additive** hai

**Har VIDEO surface ka audit:**

| Surface | Poster stored | Client tak | Kahan |
|---|---|---|---|
| `GET /banners/customer/active` | ✅ | ✅ `thumbnail` | **M-3a** |
| Banner admin reads | ✅ | ✅ `media.thumbnail` | **M-3a** |
| Showcase customer (`customerMediaMap`) | M-4 | ✅ `thumbnail` (key pehle se) | M-4 |
| Showcase vendor (`formatManagedMedia`) | M-4 | ✅ `thumbnail` | M-4 |
| `getAllVideoClips` | M-4 | ✅ `thumbnail` | M-4 |
| Brand customer profile media strip | M-4 | ✅ `thumbnail` | M-4 |
| **Voucher banner customer** | ❌ **abhi poster hai hi nahi** | ❌ | 🔴 **M-5** |
| Ticker | IMAGE-only | — | — |

> 🔴 **M-5 ke liye locked:** `Voucher.banner.video` aaj `{url, storage}` hai —
> poster ka koi concept hi nahi. M-5 me `mediaSchema` par aate hi poster VIDEO par
> mandatory ho jayega, aur tab `pickVoucherBanner` ko `bannerType` + `bannerUrl`
> ke saath **`bannerThumbnail`** bhi dena hoga. Ye chhootna nahi chahiye.

## M-4 · Showcase media → `mediaSchema` — ✅ **DONE** (`7964b37`)
`models/ShowcaseSection.js` · `constants/showcase.js` · `helpers/showcases/{upload,validateMedia,projections,index}.js` · showcase services ×7 · `controllers/showcases/replaceMedia.js` · docs · postman
- [x] `medias[]` ka item ab **`{ media: mediaSchema, title, altText, sortOrder, … }`** — file aur gallery-entry alag
- [x] `thumbnail` + `thumbnailStorage` → **`media.poster`** (VIDEO par mandatory)
- [x] `isCustomThumbnail` / `deleteCustomThumbnail` **poore hate** — auto-poster hai hi nahi, to wo sawaal hi nahi bachta
- [x] `getMediaCoverImage` ab VIDEO par **sirf poster** deta hai → **`.mp4` cover khatam**
- [x] `getAllVideoClips` ka `$ifNull` blank-frame fallback **hata**
- [x] Customer response me `type` / `url` / `thumbnail` **bilkul same** — ab `media.kind` / `media.url` / `media.poster.url` se
- [x] Vendor `formatManagedMedia` → ek `media` object; `storage`/`metadata` **hate**
- [x] Dono provider se dead `thumbnail` field **hata** — Cloudinary ka video par 404 deta tha, photo par url ki copy tha; S3 ka video par `null`
- [x] **32 naye unit test** (`showcaseMedia.test.js`) + `sectionCover` naye shape par · poori suite **376 pass** · **Mutation 14/14** · `verifyNoUndef` 0 · `verifyImports` 0 · coverage 223/223

> ⚠️ **`type` ab stored field nahi hai** — `media.kind` se derive hota hai
> (`showcaseTypeOf`). Wire par `PHOTO`/`VIDEO` waisa hi rehta hai aur GIF `PHOTO`
> padha jaata hai (S-7), par DB me `kind: "GIF"` likha rehta hai — jo use `gifs/`
> prefix me rakhta hai, resize step se door. Banner me yahi do-source-of-truth
> `type: "VIDEO"` + image bytes ban jaati thi.

> 🔴 **`isCustomThumbnail` ka apna bug bhi khatam.** Wo poochhta tha "ye poster
> vendor ne upload kiya ya derive hua?" — S3 par `publicId` null hone se URL
> comparison skip ho jaata aur **har** derived poster custom padha jaata, yaani
> video ka poster badalne par wahi poster delete ho jaata jo vendor dekh raha
> tha. Ab kuch derive hi nahi hota.

> ⚠️ **Poster ab request me aata hai** — `add-media` par `thumbnails[]`
> (index se files[] ke saath jodta hai), `media/replace` par `thumbnail`.
> Dono jagah video bina poster ke **upload se pehle** `422` se rukta hai.

> 🔴 **`validateSync()` `pre("validate")` middleware nahi chalata.** Clips-flag
> wala test pehle fail hua kyunki wo sync path par tha; `await doc.validate()`
> par hook sach me chalta hai. Ye usi trap-family ka hai jismein
> `this.invalidate()` nested sub-document me kuch karta hi nahi (F-3, M-2).

> 🔴 **Do money-test mock M-1 ke din se toote pade the.** `brandImages` aur
> `brandFeatureOwnership` dono `uploadFromPath` ko `{ url, storage }` lautate the,
> **`metadata` ke bina**. `toMediaDocument` `kind` ko `metadata.mimeType` se derive
> karta hai aur guess karne ki jagah **throw** karta hai — to har wo service jo
> media sibling likhti hai wahan "Cannot store media: no kind" se girti thi.
> **16 test fail.** Asli facade hamesha `metadata` bharta hai, to ye mock apni hi
> cheez ka galat chitra tha. M-1 ke commit me likha tha ki ye test theek kar diya —
> naam theek kiye the, par **suite chalayi nahi gayi**, isliye ye bacha reh gaya.
>
> ⚠️ Yahi wajah hai ki M-4 par targeted money run kiya. Poori suite M-5 par
> chalegi.

> ⚠️ **Ek flaky test pakda gaya — M-4 ka code nahi, par M-4 ne ubhaara.**
> `uploadLimits.test.js` cleanup ke liye flat `setTimeout(250)` par bharosa karta
> tha. Akele chalane par pass, poori suite me kabhi-kabhi fail — naye test files
> se load badha to disk par cleanup 250ms ke galat side par aa gaya. Ab wo
> condition par poll karta hai (ceiling 5s), to wait utna hi lagta hai jitna
> sach me lagta hai aur asli regression phir bhi fail karega. Teen baar poori
> suite clean chali.

## M-5 · Voucher media → `mediaSchema` — ✅ **DONE** (`00fdf82`)
`models/{Voucher,VoucherVersion}.js` · `helpers/vouchers/{voucherBannerMedia,pickVoucherBanner,orphanImages,validateImagesFiles,customerListing}.js` · `services/vouchers/{createVoucher,updateVoucher,setVoucherBanner}.js` · `controllers/vouchers/setBanner.js` · docs · postman
- [x] `VoucherVersion.images[]` → **`{ media: mediaSchema, sortOrder }`**
- [x] `Voucher.banner.{image,video,gif}` → **`mediaSchema`**; VIDEO par poster mandatory
- [x] 🔴 **`pickVoucherBanner` me `bannerThumbnail`** — M-3a ka locked rule apni aakhri surface par
- [x] `sortOrder max: 5` **hata** (P4) — asli ceiling `VOUCHER_OFFER_LIMITS.MAX_IMAGES` hai
- [x] Dead `require("joi")` **hata** (P10) · hardcoded provider enum **hata** (P11)
- [x] `default: () => ({})` **hata** (P9) — har voucher par teen khaali object nahi

> ⚠️ **`banner` ka `current`/`pending`/`status` shape yahan nahi kiya — wo V-4 me
> hai.** Plan me wo line dono jagah likhi thi. Agar shape ab bana dete to har
> banner `pending` me atka rehta, kyunki approve karne wala endpoint V-4 tak
> banta hi nahi — aur customer ko tab tak `images[0]` fallback dikhta. M-block
> media unification hai; workflow V-block ka hai. (Aapka faisla.)

> 🔴 **Banner ka type↔file rule ab `required` function hai, hook nahi — aur ye
> teesri baar hai jab ye trap-family mehnga pada.**
> Purana hook `throw new Error(...)` karta tha, jo bina status ke escape hota hai
> — yaani galat type bhejne par **500**, 422 nahi. `this.invalidate()` se status
> theek hua par reach nahi: Mongoose `pre("validate")` **sirf async path** par
> chalata hai, to `validateSync()` document ko bilkul saaf batata tha (measured).
> `required` function dono par chalta hai — aur yahi ek cheez `type` aur uske
> file ke beech khadi hai.
>
> Pehle do baar: `this.invalidate()` nested sub-document hook me **kuch karta hi
> nahi** (F-3 poster, M-2 locatable), aur `validateSync()` ne showcase ka
> clips-flag rule bhi chhupa liya tha.

> ⚠️ **`orphanImages` dono shape padhta hai.** Wo tay karta hai ki file
> **delete** hogi ya nahi — ek taraf galti se paid-for file strand hoti hai,
> doosri taraf live voucher ki tasveer delete ho jaati hai. Pre-migration row
> (`url` + `storage` seedhe image par) aur current row (`media` ke andar) dono
> ka jawab dena zaroori hai.

---

## O-4 ✅ · ~~Multipart raaste par nau surfaces ka koi size cap hai hi nahi~~

> ✅ **BAND — Block G, gap G1** (aur G2/G3 ne usi jagah do aur farak bhi mitaye).
> Ab dono road `getUploadLimit(purpose, kind)` ka **ek hi number** padhte hain,
> aur `kind` verified bytes se aata hai — declared mime se nahi, to ek video ko
> GIF ka allowance nahi mil sakta. Refusal ke shabd bhi dono taraf word-for-word
> ek jaise hain.
>
> Neeche ka poora vishleshan waise hi rakha hai — wo batata hai ki galti **kaise
> dikhi**, aur wahi cheez agli baar bhi kaam aayegi.

`helpers/media/assertImageFile.js` · `helpers/banners/media.js` · `helpers/promotionalTickers/media.js` · aur wo saat surfaces jo sirf `assertImageFile` bulate hain

> 🔴 **U-5 ke final verification me mila, 2026-09-18.** Ek hi file do raaston se
> bhejne par do alag jawab milte hain:
>
> | Raasta | Kaun rokta hai | Kitne par |
> |---|---|---|
> | Multipart | `express-fileupload` ka `MAX_UPLOAD_SIZE_MB` | **100 MB** |
> | Presigned | presign ki policy + confirm ka apna check | **purpose ka apna cap** |
>
> Aur purpose ke cap bahut chhote hain:
>
> | Purpose | Cap | Multipart par asar |
> |---|---|---|
> | `BRAND_FEATURE_ICON` | 2 MB | 100 MB tak chal jaata hai |
> | `TICKER_ICON` | 2 MB | wahi |
> | `USER_AVATAR` | 5 MB | wahi |
> | `BRAND_LOGO` · `SUB_BRAND_LOGO` | 5 MB | wahi |
> | `CATEGORY_IMAGE` · `SUBCATEGORY_IMAGE` | 10 MB | wahi |
> | `BRAND_COVER` · `SUB_BRAND_COVER` | 10 MB | wahi |
> | `BANNER_MEDIA` · `BANNER_POSTER` | 50 / 10 MB | wahi |
>
> **Wajah:** in surfaces par multipart road sirf `assertImageFile` bulata hai, aur
> wo **mime** dekhta hai, size nahi — file me likha hai: *"Is this an image?"*.
> App banner aur ticker ke apne helper me bhi koi size check nahi hai.
>
> ⚠️ **Teen surfaces isse bahar hain aur pehle se theek hain** — showcase
> (`validateMediaFiles`), voucher images (`validateVoucherImages`) aur voucher
> banner (`assertWithinSize`). Wahan multipart par bhi size naapa jaata hai.
>
> ### ⚠️ Ye U ne nahi banaya — U ne dikhaya
>
> Presign pehle din se `entry.maxBytes` par cap lagata tha, to farak hamesha tha.
> U-3 ne sirf ye badla ki presign ab **admin ka** number padhta hai (aur wo aur
> chhota ho sakta hai), aur U-5 ne wo raasta in nau surfaces tak pahuncha diya —
> jisse farak ab har surface par dikhta hai, ek-do par nahi.
>
> ### 🔴 Customer ko kya dikhta hai
>
> Ek 8 MB ki phone photo: multipart se **chadh jaati hai**, presigned se `413`.
> Jab panel presigned par shift hoga, wahi photo jo kal chadh rahi thi aaj mana ho
> jaayegi — aur koi nahi bata payega ki kya badla, kyunki dono taraf se code
> "sahi" chal raha hoga.
>
> ### Theek karne ka raasta
>
> `getUploadLimit(purpose, kind)` pehle se maujood hai aur wahi number dono jagah
> deta hai. Surface ke multipart branch me ek `assertWithinLimit(file, purpose)`
> jodna kaafi hai — naya number nahi, wahi number.
>
> ⚠️ **Ye behaviour change hai, isliye abhi nahi kiya.** Aaj multipart se 40 MB ka
> brand cover chadh sakta hai; cap lagte hi wo mana ho jaayega. Kitni purani rows
> us cap se upar hain ye naapna hoga, aur kya un par koi asar padta hai — stage ka
> data disposable hai, par faisla aapka hai.

---

## O-3 ✅ · ~~`Setting.storage` ke chaar knob kuch karte hi nahi~~

> ✅ **BAND — Block G, gap G5.** Chaaron live hain: `presignEnabled` (`presign`
> padhta hai, `confirm` jaanboojh kar **nahi**), `presignTtlMinutes`,
> `intentTtlMinutes`, aur `signedUrlTtlMinutes` (facade `documentUrl` me).
>
> ⚠️ Do naye guard saath aaye: platform S3 par na ho to presign **409**, aur
> `intentTtlMinutes` `presignTtlMinutes` se chhota ho to save par **422**.

`helpers/settings/getStorageConfig.js:102–105` · `services/storage/presign.js:75,158,189,201` · `services/storage/providers/s3.js`

> ⚠️ **Ye line pehle `presign.js:41,50` kehti thi** — wo purane hardcoded
> constants (`PRESIGN_TTL_SECONDS`, `INTENT_TTL_MS`) ke pate the, jo G5 me hat
> gaye. Aaj ke chaar pate: `:75` setting padhna · `:158` `Expires` (jo **S3
> enforce karta hai**) · `:189` intent ka `expiresAt` · `:201` `expiresInSeconds`
> (jo **client ko bataya jaata hai**). Pehle do alag ho jaayen to vendor ko ek
> waqt bataya jaata aur S3 doosre par chalta — isi liye `:158` ka apna test hai,
> jo signed policy ko base64 se decode karke uski `expiration` padhta hai.

> 🔴 **U-2 ke doc sync me mila.** Admin doc (§ Settings) in chaar ko kaam karta
> hua batata hai:
>
> | Knob | Doc kya kehta hai | Asal me |
> |---|---|---|
> | `storage.upload.presignEnabled` | *"Direct-to-S3 raasta, bina deploy ke on/off"* | **Koi reader nahi.** `/uploads/presign` `false` par bhi chalta hai |
> | `storage.upload.presignTtlMinutes` | *"Client ke paas upload shuru karne ka waqt"* | `presign.js:41` me `PRESIGN_TTL_SECONDS = 15 * 60` hardcoded |
> | `storage.upload.intentTtlMinutes` | intent row kitni der zinda | `presign.js:50` me `INTENT_TTL_MS` hardcoded |
> | `storage.delivery.signedUrlTtlMinutes` | private document ke link ki umar | `s3.js` apna hi expiry use karta hai |
>
> `getStorageConfig` chaaron ko theek se padhta hai aur `storageConfig.test.js`
> unhe wapas padh kar green bhi hai — par wo test sirf ye sabit karta hai ki
> **helper** setting padh leta hai, ye nahi ki koi uspar chalta hai.
>
> ⚠️ **Ye khud plan ka apna rule todta hai.** §2 me likha hai: *"Har field ka ek
> asli reader hai — koi aisa knob nahi jo kuch na kare. Wahi galti `maxSections`
> me thi, aur wo isi wajah se hataya gaya tha."*
>
> 🔴 **Kill switch ka jhooth sabse mehenga hai.** Agar kal presigned raaste me
> kuch kharaab nikle, admin panel me switch off karega, `Setting` me `false` likha
> jaayega, UI *"band ho gaya"* dikhayegi — aur raasta poori tarah chalta rahega.
> Ek kill switch ka galat hona uske na hone se bura hai, kyunki incident ke waqt
> log usi par bharosa karke aage badh jaate hain.
>
> ### ⛔ Kyun abhi fix nahi kiya — ye design ka faisla hai, coding ka nahi
>
> `presignEnabled` ka default **`false`** hai (`models/Setting.js:1038`). Use
> aaj ke code se joda jaaye to **naye install par presigned raasta band** hoga —
> aur §0.5 me prod ke liye locked faisla *"client sirf presigned"* hai. To do me
> se ek chunna padega, aur dono ke asar alag hain:
>
> **(a) Default `true` kar do** — jo §0.5 se mel khata hai. Switch phir sirf
> emergency ka off rehta hai. Par ek stored `false` (aaj ki har row me wahi hai)
> flip hote hi raasta band kar dega, to `true` karne ke saath ek backfill bhi
> chahiye.
>
> **(b) Default `false` rehne do**, aur switch off hone par `/uploads/presign`
> ek saaf `503` de jo client ko multipart par bhejta hai. Par tab stage/prod dono
> me use **haath se on** karna padega, aur jis din koi naya environment bina on
> kiye khada hoga, wahan upload chup-chaap purane raaste par chala jaayega.
>
> TTL waale teen knob is faisle par nahi latke — unhe wire karna seedha hai, par
> unhe akele karna aadha kaam hai aur wahi galatfehmi chhodta hai ki chaaron ab
> kaam karte hain.
>
> **Tab tak:** in chaaron ko **mat badalna** — badalne se kuch nahi hoga, aur ye
> maan lena ki hua wo asli khatra hai. Admin doc me inke saamne ek line honi
> chahiye; wo bhi is faisle ke saath hi jaayegi.

---

## O-2 · Poori money suite ek saath chalane par green **rehti nahi thi** — ab ek run green hai, par daava variance ka hai

`__tests__/money/*` — **101 files**, ek hi `Trydood2_test` database par

> 📌 **2026-09-21:** O-1 band hone ke baad poori suite **101/101 green** aayi —
> is doc ka pehla aisa run. Phir bhi O-2 khula hai, kyunki iska daava "hamesha
> red" nahi balki **"natija run-dar-run badalta hai"** hai, aur ek green run us
> daave ka jawab nahi deta. Detail neeche.

> 🔴 **Ye pehli baar 2026-09-18 ko naapa gaya, V-6 ke dauraan.** Poori suite:
> **2 suite fail, 4 test fail, 1802 pass**. Wahi suites akele chalane par
> **34/34 pass** karti hain.
>
> ### 📌 Block U ke baad dobara naapa — 2026-09-18, U-5 ke ant me
>
> **99 suite, 1945 test: 96 pass, 3 fail (10 test).** Teen me se:
>
> | Suite | Wajah | Kiska |
> |---|---|---|
> | `otpThrottle` | **O-1** — bug zinda hai, test sahi behaviour likhta hai | pehle se |
> | `brandFeatureOwnership` | uska `services/storage` mock naya `describeIncoming` nahi rakhta tha | U-5 ne toda, **theek ho gaya** |
> | `mediaUploadRollback` | `uploadBannerMedia` ki nayi signature (actor pehle) | U-5 ne toda, **theek ho gaya** |
>
> Dono U-5 wale fix hone ke baad akele green hain. Bacha sirf `otpThrottle`, jo
> O-1 ka apna red marker hai.
>
> ### 🟢 O-1 ke baad — **poori suite pehli baar green**, 2026-09-21
>
> **101 suite, 2011 test: 101 pass, 5 todo, 0 fail — 52 min.**
>
> Is doc ke itihaas me ye pehla run hai jisme kuch bhi red nahi. Pichhla red
> `otpThrottle` tha aur wo O-1 ka apna marker tha, to O-1 band hote hi suite ka
> **ekmatra sthayi red** hat gaya.
>
> ⚠️ **Isse O-2 band nahi hota, aur ye line usi galti se bachne ke liye hai.**
> O-2 ka daava kabhi "suite hamesha red rehti hai" tha hi nahi — daava ye hai ki
> **natija run-dar-run badalta hai**, aur ek green run us daave ka jawab nahi
> deta, jaise 2026-09-19 ki do run me alag-alag suites red aayi thin. O-2 tab
> band hoga jab isolation ka koi structural jawab ho, ya jab kai run lagatar
> green aayein.
>
> Jo ye run **sach me** batati hai, wo teen cheezein:
>
> - Block G ke baad jo **asli** tootan thi (nakli `tempFilePath` wali do suites)
>   wo band hai — wo is baar bhi red nahi aayi.
> - O-1 ka fix kisi aur suite se nahi takraata: 101 me se ek bhi nahi giri.
> - Ab suite me koi bhi red **naya** hoga. Pehle har run me ek pehle se red hota
>   tha, to "maine kuch toda kya" ka jawab dene me har baar ek extra kadam lagta
>   tha.
>
> ⚠️ Is run me working tree me O-1 ka kaam **aur** kisi aur ka V-4a
> banner-fallback kaam dono maujood the — yaani 101/101 dono ke saath hai.
>
> ### 📌 Promo listing ke baad dobara naapa — 2026-09-21
>
> **101 suite, 2006 test: 100 pass, 1 fail (1 test) — 47 min.** Red sirf
> `otpThrottle › two requests at the same moment`, yaani **O-1 ka apna marker**.
>
> Is section ke itihaas me ye sabse saaf run hai (pehle: 4 test → 10 test → 10
> aur 78). Iska matlab ye **nahi** ki O-2 khatam ho gaya — ek saaf run sirf ek
> data point hai, aur O-2 ki dalील hi yahi thi ki natija run-dar-run badalta hai.
> Par ye batata hai ki Block G ke baad jo asli tootan thi (nakli `tempFilePath`
> wali do suites) wo sach me band hui hain, kyunki wo is baar red nahi aayi.
>
> ⚠️ Is run ke waqt working tree me promo-listing ka kaam **aur** kisi aur ka
> V-4a banner-fallback kaam (`helpers/vouchers/customerListing.js` +
> `services/vouchers/getAllVoucherVersions.js` + do unit test) dono maujood the.
> Yaani 100/101 dono ke saath hai.
>
> ### 📌 Block G ke baad dobara naapa — 2026-09-19
>
> Ek hi shaam me **do baar** chalayi gayi, aur dono baar alag suites red hui —
> yahi is section ka sabse saaf saboot hai.
>
> | | Suites | Tests | Red kaun |
> |---|---|---|---|
> | **Run 1** | 95 pass / 4 fail | 1963 (10 fail) | `otpThrottle` · `voucherImageFloorPaths` · `voucherUploadOutsideTransaction` · `settlementClaims` |
> | **Run 2** | 93 pass / 6 fail | 1963 (78 fail) | `otpThrottle` · `documentFailureAlerts` · `bannerCapacity` · `settlementStatement` · `refundAllowance` · `showcaseCustomerReads` |
>
> Dono run me **sirf `otpThrottle`** saanjha hai. Har doosra naam ek run me red
> aur doosri me green — aur akele chalane par **har ek** green:
> `settlementClaims` ✅ · baaki paanch **89/89** ✅.
>
> 🔴 **Run 1 ki do suites asli thin, aur unka fix code me nahi tha.**
> `voucherImageFloorPaths` aur `voucherUploadOutsideTransaction` nakli
> `tempFilePath` (`/tmp/photo-1.jpg`) par chal rahi thin. Ye G2 se pehle isliye
> chalta tha ki multipart road file kholta hi nahi tha; ab `describeAllIncoming`
> pehla kilobyte padhta hai, to wo `ENOENT` deti hain. Dono ab
> `__tests__/support/localFile.js` se asli bytes likhti hain — **32/32**. Iske
> saath HEAD par jitni bhi suites nakli path par thin (chhah), sab asli bytes par
> aa gayi hain.
>
> ⚠️ **Run 2 ka 78 ek code ka naap nahi hai.** Paanch suites ke **saare** test
> gire, 60.8 / 61.3 / 60.9 / 61.1 second par — yaani `testTimeout: 60000` par,
> assertion par nahi. Ek galat assertion pandrah test ek saath nahi girati. Wahi
> run apne aap me ~40 min le gayi jabki usse pehle wali ~18 min me poori hui thi:
> shared M0 us waqt dhimi thi. `jest.config.js` ka `testTimeout` comment theek
> isi ghatna ko pehle se likh kar rakhta hai.
>
> 📌 **Padhne ka tareeka:** poori suite ka number ek gate nahi hai. Jo suite red
> aaye use **akele** chalao — wahi jawab hai. Jo dono jagah red rahe, wahi asli
> hai.
>
> `moneyInvariants` ka fail ek settlement total par hai — `488.7` expect,
> `1273.7` mila. Farq ka aakaar batata hai ki jod me aisi rows aa rahi hain jo
> us test ne banayi hi nahi. Doosra `vendorDebt` ka "a debt we decide not to
> chase" hai.
>
> ⚠️ **Wajah suite ka design hai, kisi ek test ka bug nahi.** Har suite apne
> `beforeEach` me apni collections clear karti hai, par `moneyInvariants` jaisi
> suite **poore collection par total ginti hai** — uske liye "meri rows saaf
> hain" kaafi nahi, use ye chahiye ki us waqt aur kisi ki rows bhi na hon.
> `--runInBand` par 91 suites ek hi DB baantti hain, to jo suite pehle chali
> uski bachi hui row agle ke jod me aa jaati hai.
>
> **V-6 ne ye nahi todha, aur wo saboot ke saath hai:** `moneyInvariants`
> **#7** par chalti hai jabki V-6 ka pehla suite **#22** par — uske fail hone
> tak V-6 ki ek bhi row DB me nahi aati. `vendorDebt` **#24** par hai aur
> `voucherDelete` **#22** par, to wo jodi usi kram me alag chalayi gayi:
> **46/46 pass**. V-6 ki saari 10 voucher suites un dono ke saath: **195/195**.
>
> ⚠️ **Iska koi baseline nahi hai** — 91 files ek saath is repo me aaj se
> pehle kabhi chalayi hi nahi gayi thin, isliye ye nahi kaha ja sakta ki ye kab
> se hai.
>
> Theek karne ke do raste: har aisi suite ko apna scope dena (marker field ya
> apna database), ya `moneyInvariants` jaise totals ko poore collection ke
> bajaye us test ki apni rows par ginana. Doosra sasta hai, pehla pakka.
>
> Tab tak: **money suites blocks me chalayein** (jaise `--runInBand
> __tests__/money/voucher`), poori suite ko ek gate ki tarah na maanein.

---

## O-1 · OTP throttle — claim ki pehchaan timestamp se nahi ho sakti — ✅ **DONE** (2026-09-21)

> ### ✅ Wo test ab green hai
>
> `__tests__/money/otpThrottle.test.js` → *"two requests at the same moment ›
> lets exactly one through"*. Aath ek saath bheje jaate hain; ab **ek** nikalta
> hai, aur row par uska apna nonce hota hai.
>
> **Ye is repo ka sabse lamba red tha** — hafton tak jaan-bujh kar. Us waqt ka
> faisla yahan likha rehna chahiye kyunki wo sahi tha: test `skip` **nahi** kiya
> gaya, kyunki skipped test chup ho jaata hai aur red har run me yaad dilata
> hai. Poori money suite isi ek test ki wajah se kabhi green nahi hoti thi, aur
> wo keemat jaan-bujh kar di gayi.
>
> Iska ek aur asar tha: har naye kaam ke baad suite me **ek** red pehle se hota
> tha, to "maine kuch toda kya" ka jawab dene me har baar ek extra kadam lagta
> tha. Ab suite ka ekmatra red **asli** red hoga.

`helpers/otps/claimOtpSend.js` · `services/otps/sendOtp.js` ·
`helpers/twoFactor/sendThrottledMobileOtp.js` · `models/OtpThrottle.js`

> ⚠️ Yahan pehle `helpers/otps/releaseOtpSend.js` likha tha — **wo file kabhi
> thi hi nahi**. Release do jagah inline `$pull` hai, aur dono me wahi bug tha.
> Ek file ka naam likh dene se wo khoj ek hi jagah rukti, aur doosri chhoot
> jaati.

> 🔴 **Throttle burst me poora khul jaata hai.** Verdict ye hai:
>
> ```js
> const allowed = sends.includes(now.getTime());
> ```
>
> Yaani "mera timestamp array me bacha ya nahi". Jab N caller **ek hi
> millisecond** me `new Date()` lete hain, sabka `now.getTime()` ek jaisa hota
> hai — pehla use append karta hai, aur baaki saare wahi value dekh kar
> `allowed: true` laut aate hain **bina kuch likhe**.
>
> Nateeja: "resend" ke N ek-saath taps par N message chale jaate hain. Throttle
> theek us waqt fail hota hai jab uski sabse zyada zarurat hai — aur chup-chaap.
>
> ⚠️ File ka apna comment ye takraav pehle se jaanta tha: *"Releasing by a time
> range would pull entries claimed by other callers in the same second."* —
> release path ke liye socha gaya, identity check ke liye nahi.

**Pakda kaise gaya:** `__tests__/money/otpThrottle.test.js` → *"two requests at
the same moment › lets exactly one through"*. 8 concurrent claims, saare 8
`allowed`, teenon ka `at` byte-identical. Ye test **sach bata raha hai** — isse
skip nahi karna, fix karna hai.

⚠️ Pehla andaza ye tha ki `OtpThrottle` ka unique index build nahi hua. **Wo
galat tha** — index maujood hai (`scripts/showTestIndexes.js OtpThrottle` se
dekha). Index ke rehte hue bhi ye bug hai, kyunki race document ke andar hai,
document banane me nahi.

- [x] `sends: [Date]` → `[{ at, nonce }]` — sub-schema, `_id: false` (value hai, record nahi)
- [x] `claimOtpSend` verdict apne **nonce** se, timestamp se nahi
- [x] Release bhi nonce se — ⚠️ `releaseOtpSend` naam ki **file hai hi nahi**; release do jagah inline hai: `services/otps/sendOtp.js` aur `helpers/twoFactor/sendThrottledMobileOtp.js`. Dono badle
- [x] Window pruning `$filter` ab `$$this.at` par; `$max` ab **mapped `at`s** par (`$max` seedha documents par lagta to unhe field-order se compare karta — aaj sahi jawab deta, aur field hilte hi chup-chaap galat)
- [x] `updatedAt` TTL index jaisa hai waisa
- [x] Purani rows: koi migration nahi. ⚠️ Bare-`Date` entries **drop** hoti hain, tolerate nahi — mixed array ko `$size` ginta par mapped-`at` wala `$max` legacy ko chhod deta, yaani hourly cap aur cooldown ek hi row par alag jawab dete. Ek row ka clean slate chhoti aur predictable galti hai; TTL 2 ghante ka hai
- [x] **Proof:** `otpThrottle.test.js` **16/16** (pehle 10/11). Do mutation chalayi aur dono red aayi — nonce check hatao to concurrency test 8/8 pass kar jaata hai; `sendOtp` ka pull wapas `claim.at` karo to call-site test girta hai
- [x] Naye test: winner ka nonce row par hai · har caller ka apna nonce · release sirf apni entry hataata hai · refused claim kuch nahi hata sakta · **asli `sendOtp` failure branch** (provider stub) · legacy bare-date row

> ✅ **DONE — 2026-09-21.** `models/OtpThrottle.js` · `helpers/otps/claimOtpSend.js` ·
> `services/otps/sendOtp.js` · `helpers/twoFactor/sendThrottledMobileOtp.js` ·
> `__tests__/money/otpThrottle.test.js` · `CLAUDE.md`
>
> Koi route, koi response shape, koi API surface nahi badla — isliye docs/collections
> ki coverage par asar nahi.

> ⚠️ **Media migration se bilkul alag.** Security code hai, stored shape badalta
> hai, aur M-block/V-block me se kisi par depend nahi karta — isliye apna phase.

## S-1 … S-5 · Showcase
Detail: [showcase_rules_and_upload_plan.md](./showcase_rules_and_upload_plan.md) §SC-1…SC-5

### S-1 — ✅ **DONE** (`56ac077`)
`models/Setting.js` · `constants/showcase.js` · `helpers/settings/{getShowcaseConfig,assertShowcaseFloorRule,index}.js` · `validator/settings.js` · `services/settings/updateSetting.js` · `helpers/showcases/validateMedia.js` · docs · postman

- [x] `minItemsPerSection` (3) · `minSectionsPerBrand` (1) · `maxGifSizeMB` (15) schema par
- [x] `allowedImages` me **`image/gif`** — schema aur constant dono
- [x] Cross-validation **teen jagah**: path validator (model), Joi (payload), `assertShowcaseFloorRule` (merged document)
- [x] `getShowcaseConfig()` ab `minItems` · `minSections` · `maxGifSizeMB` lautata hai
- [x] `validateMediaFiles` GIF ko uske apne cap par naapta hai, aur message me wahi limit bolta hai
- [x] **19 naye unit test** · poori suite **425 pass** · **Mutation 12/12** · guards clean

> ⚠️ **GIF ka cap enforce karna isi phase me rakha.** `image/gif` ko allow-list me
> daalkar `maxGifSizeMB` na lagana ek aisa knob chhod deta jo kuch nahi karta —
> GIF `maxImageSizeMB` (10 MB) par naapa jaata, yaani platform format ko
> "supported" kehta aur practice me reject karta. Is codebase me wahi pattern
> `maxSections` aur `showcase.isActive` dono ke saath ho chuka hai.

> ⚠️ **Cross-validation teen jagah kyun.** Joi sirf payload dekhta hai, to ek hi
> request me dono number aayein tabhi pakadta hai. Admin aaj floor 6 kar sakta
> hai (legal — ceiling 15) aur kal ceiling 5 — dono baar ek hi field aata hai.
> `assertShowcaseFloorRule` merged document par chalta hai, jahan dono number ek
> saath sach hote hain. Model ka path validator isliye ki panel akela writer nahi
> hai — seeder aur script seedhe model par jaate hain.

> 🔴 **Floor > ceiling** har section ko ek saath *dikhane ke liye bahut chhota*
> aur *theek karne ke liye bahut bhara* bana deta — customer read use chhupa deti
> aur jo upload use bachata wo ceiling se ruk jaata. Vendor ke paas koi raasta
> nahi bachta, aur kahin kuch batata bhi nahi.

> ⚠️ `minItems`/`minSections` abhi **koi nahi padhta** — write guards **S-3** me
> hain, customer filter **S-4** me. S-1 sirf unhe rakhta aur pehra lagata hai.

### S-2 — ✅ **DONE** (`a4539c7`, `aa9c322`, `f361092`)
`models/ShowcaseSection.js` · `middlewares/errorHandler.js` · `helpers/showcases/{resolveSectionForActor,validateMedia,resequenceSections}.js` · services · validator · docs · postman

- [x] `versionKey: false` hataya **aur** `optimisticConcurrency: true` lagaya — default versioning `__v` ko filter me sirf positionally-unsafe ops (`$pop`/`$pull`) par daalti hai, positional `$set` par nahi
- [x] `VersionError` → **409** ek padhne layak message ke saath (pehle 500 girta tha)
- [x] `resolveSectionForActor` ki **har** projection me `__v` — warna save ke paas compare karne ko kuch hota hi nahi
- [x] Media `sortOrder` server ginta hai (non-deleted ka count + 1); delete par `resequenceMedias` dense 1..n
- [x] Section `sortOrder` brand-level dense — `resequenceSections`, **delete aur create dono** se
- [x] `create`/`update` payload se `sortOrder`/`position` hata di — wo ek request ki cheez nahi hai
- [x] **Proof:** money `showcaseVersionLock` + `showcaseSortOrderScope` · mutation clean

> ⚠️ Do baatein jo maine comment me likhi thi aur mere apne test ne galat sabit
> kar di: "dusra save poori array replace kar deta hai" (nahi — Mongo field-by-field
> merge karta hai aur sirf *badle hue* path bhejta hai) aur "`versionKey` akela
> kaafi hai" (nahi — isi liye `optimisticConcurrency`). Dono comment sudhaar diye.

> ⚠️ Section drift ki kahani bhi galat likhi thi — "deleted sections number
> badha dete the". `git show HEAD:...createVoucher.js` ne dikhaya ki purani query
> pehle se `isDeleted: false` filter karti thi. Ek mutant ne pakda. `create` par
> resequence isliye chahiye ki **drifted data** par `count+1` galat jagah daal deta hai.

### S-3 — ✅ **DONE** (`85c8edf`)
`helpers/showcases/guards.js` (naya) · services · docs · postman

- [x] `assertSectionKeepsItsFloor` · `assertBrandKeepsASection` · `assertBrandKeepsAVisibleSection`
- [x] ADMIN teeno se exempt
- [x] **Carve-out:** pehle se floor ke neeche ho to rokna kuch nahi bachata — `if (before < minItems) return`
- [x] **Proof:** money `showcaseFloors` · mutation clean

### S-4 — ✅ **DONE** (`98d5258`)
`helpers/showcases/projections.js` · customer services · docs

- [x] `customerSectionMatch(brandObjectId, { minItems })` me `$expr` — **visible** media ginta hai
- [x] `applyDisplayPositions(sections, { startAt, mediaKey })` — **1,3 → 1,2**
- [x] `customerMediaFields({ withSortOrder })`; clips se incomplete sections bahar
- [x] **Proof:** money `showcaseCustomerReads` · mutation, jisme **M13** ne ek asli gap pakda (brand-profile ka floor test hi nahi tha)

> ⚠️ M12 par maine comment me likha tha ki `$sort` ka tiebreaker hatane se feed
> reshuffle ho jayegi — 10 run ne dikhaya ki **nahi hoti**. Comment aur test dono
> sudhaar diye: wo ek *documented freedom* ki pehredari karta hai jise engine aaj
> istemal nahi karta.

### S-5 — ✅ **DONE** (`8fd2401`)
`helpers/showcases/customerVisibility.js` (naya) · `constants/showcase.js` · managed reads · docs

- [x] `isVisibleMedia` · `countVisibleMedia` (ab `guards.js` bhi yahi se leta hai) · `describeCustomerVisibility` · `attachCustomerVisibility`
- [x] `SHOWCASE_VISIBILITY_REASON = { HIDDEN, INACTIVE, NOT_ENOUGH_MEDIA }` — `DELETED` nahi, wo pahunch me hi nahi aata
- [x] **Har** failing reason lautata hai, pehla nahi — vendor ko ek-ek karke theek karwana ek hi baat teen baar kehna hai
- [x] **Proof:** money `showcaseVisibilityReport` · mutation clean

> 🔴 Is phase me mutation runner ne **poore jhoothe result** diye: M4 ki jest ne
> money run-lock le liya aur mar gayi, phir har agla run `globalSetup` me fail
> hokar MARA gina gaya. Runner theek kiya — `Tests:` line na mile to **NAAKAAM**,
> ek green baseline lazmi, aur `execSync` → `spawnSync` kyunki **jest apni summary
> stderr par likhta hai**.

---

## V-1 · Voucher Setting + model limits — ✅ **DONE** (`a4f211a`)
- [x] `Setting.vendor.voucher.minImages` (default **3**, `min: 1`, **≤ maxImages**) — path validator ke saath
- [x] Per-kind size cap global se (P12 — pehle voucher images par **koi size check nahi** tha)
- [x] `getVoucherConfig()` ab `minImages` · `maxBytes` · `maxSizeMB` · `allowedImageTypes` deta hai
- [x] `helpers/settings/assertVoucherFloorRule.js` — merged document par, `assertShowcaseFloorRule` jaisa
- [x] Docs + postman

> 🔴 Yahan poochhne par pata chala ki `docs/setting_default_response.json` aur
> `docs/setting_fields_reference.json` **S-1 se stale** the (`git show --stat 56ac077`
> se confirm). Dono theek kiye aur `settingReferenceDocs.test.js` likha taaki
> dobara chupke se na bigdein. Us test ka ek assertion bhi narm karna pada — teen
> cross-field entry advisory hain, validation nahi, to unka `failsWith` hota hi nahi.

> ⚠️ Mutation **M4** ne ek asli gap pakda: floor == ceiling ki boundary par koi
> test nahi tha.

## V-2 · Min 3 images — ✅ **DONE** (`966d113`)
- [x] Ek helper, **teen** jagah — `createVoucher` · `mergeImages` · `validateVoucherBeforeSubmit`
- [x] Model par `>= 1` structural floor rahega (model async config nahi padh sakta)
- [x] **Ek message**, aur usme agla kadam — `helpers/vouchers/assertImageFloor.js` (P13: pehle 4 jagah 4 alag message the)
- [x] `validateVoucherImages(files, config)` ab poora config leta hai aur **size** bhi enforce karta hai (P12)
- [x] `normalizeVoucherImages` me `looksLikeFile()` — `{}` ab phantom `[{}]` nahi banata
- [x] **Proof:** money `voucherImageFloorPaths` (teenon raaste) · mutation: har jagah alag-alag hataya

> ⚠️ `validateVoucherForApproval` jaanboojh kar **structural** `imageCount === 0`
> hi rakhta hai, configurable floor nahi. Warna admin ka floor badalna un vouchers
> ko phansa deta jo vendor pehle hi bhej chuka hai — peechhe se retire kiya hua
> voucher, jo `minImages` ko rokna hi tha.

## V-3 · Uploads transaction ke bahar — ✅ **DONE** (`8f811b5`)
`services/vouchers/{createVoucher,updateVoucher}.js`
- [x] `createVoucher`: images + banner upload **transaction shuru hone se pehle**
- [x] `updateVoucher`: images transaction ke bahar
- [x] Fail par rollback pehle jaisa hi kaam karta hai
- [x] **Proof:** money `voucherUploadOutsideTransaction` · rollback test
- [x] 🔴 **A-2 ka bacha hua integration test yahan** — `updateVoucher` ko koi test service
      level par exercise nahi karta, isliye "orphan check bypass" wala mutant unit
      level par pakda nahi jaata. Yahan `updateVoucher` waise bhi chhu rahe hain, to
      voucher + fork + update ka setup share ho jayega: v1 PUBLISHED → fork v2 → v2 se
      image remove → **v1 ka file zinda** rehna chahiye (aapka faisla)

## V-4 · Banner ka naya shape + approval + fallback — ✅ **DONE** (`fda516d`, `7400909`)
`models/Voucher.js` · `services/vouchers/{setVoucherBanner,reviewVoucherBanner,publishVoucher,submitVoucherForReview}.js` · routes · docs · postman
- [x] `banner: { current, pending, status, rejectionReason, reviewedBy, reviewedAt }`
- [x] `VOUCHER_BANNER_TYPE` / `MEDIA_FIELD` / `FILE_FIELD` map / `ALLOWED_MIME_TYPES` **hata diye** — `media.kind` se
- [x] **Replace par `current` live rehta hai**, naya `pending` me
- [x] **`DELETE` endpoint hata diya** (V-3 rule)
- [x] Admin banner review endpoint — `POST /vouchers/:voucherId/banner/review`, approve / reject + reason
- [x] **Fallback:** `banner.current ?? images[0]` — `bannerIsFallback` + `bannerStatus` response me
- [x] `submit-for-review` par banner **mandatory** (`current` ya `pending`); publish **block nahi**
- [x] VIDEO banner par poster mandatory — aur banner par pehli baar **size check** (P12)
- [x] **Proof:** money `voucherBannerReview` (18) · reject ke baad voucher PUBLISHED aur pehli image dikhti hai · replace ke dauraan purana live rehta hai · mutation 11/11

> ⚠️ **Do commit me hua, teen me nahi.** Plan ne ~5 h · 3 commit rakha tha; c1 me
> shape + fallback + DELETE hatana + poster mandatory sab aa gaya, c2 me review
> endpoint + submit gate. Teesre commit ke liye checklist par kuch bacha hi nahi.

> ⚠️ Mutation **M1** pehle zinda bacha aur wo **asli gap** tha: replace wale test
> me delete to check kiya tha, par ye nahi ki `current` ab **naya** banner hai.
> Test sakht karne par mar gaya.

> 🔴 **Stage par backfill chali, prod par nahi chalegi.** `scripts/backfillVoucherBanners.js`
> purane `{type, image|video|gif}` ko `{current, status: APPROVED}` me le jaati hai —
> **database ke naam** par guard karti hai (`NODE_ENV` par nahi), `--dry`/`--force`
> leti hai, aur dobara chalne par kuch nahi karti. Stage par 10 move hue, dusre run
> par 0. Prod DB fresh hoga, isliye **application code kahin bhi ye maan kar nahi
> chalta ki backfill chal chuki hai** — `pickVoucherBanner` khali banner par bhi
> `images[0]` par gir jaata hai.

## V-5 · Pause / resume — ✅ **DONE** (`245ae13`, `2780dfc`)
`services/vouchers/{pauseResumeVoucher,publishVoucher,expireVouchers}.js` · `constants/voucher.js` · `models/VoucherVersion.js` · routes · validator · docs · postman
- [x] `PUBLISHED → PAUSED` aur ulta — `POST /vouchers/{pause,resume}/:versionId`
- [x] 🔴 **Resume se pehle check** — koi aur `PUBLISHED` version to nahi; ho to **saaf 409** jo batata hai kaunsa live hai aur ab kya karna hai, `E11000` nahi
- [x] Nikal chuki validity par bhi resume 409 — warna expired offer customer ke saamne jaata aur agle ghante ki sweep use utaar deti
- [x] Customer reads par kuch nahi kiya — `customerListing` version ke `status: "PUBLISHED"` par match karti hai, paused turant gir jaata hai
- [x] `pausedAt`/`pausedBy`/`pauseReason` — **resume par clear**, `archivedAt`/`expiredAt` ke ulat
- [x] **Proof:** money `voucherPauseResume` (18) · mutation **11/11**, jisme **M1 (pre-check hata do) ne 18 me se 17 test girae** — yaani index sach me firing karta hai

> 🔴 **Ye do commit me hua, aur pehla commit V-5 ka scope hi nahi tha.**
> `expireVouchers` master vouchers ko `{ endAt: { $lte: now } }` se dhundhti thi
> aur **`Voucher` me `endAt` field hai hi nahi** — stage par 18 me se 0 ke paas.
> Yaani wo query har run par khali lauti, masters kabhi `EXPIRED` nahi hue, aur
> brand ki list bhi unhi rows se banti thi — to **`recountBrandUsage` us job se
> kabhi pukara hi nahi gaya**, yaani expire hone par slot kabhi release nahi
> hua. Master ab versions se derive hota hai (mirror nahi — wo ek date do jagah
> sach bana deta), **survivor rule** ke saath: master tabhi expire hota hai jab
> us voucher ka kuch bhi in play na bache.

> ⚠️ `publishVoucher` master ko ab `PUBLISHED` bolta hai — pehle `APPROVED` pada
> reh jaata tha, isliye `PAUSED` ke paas utarne ki seedhi hi nahi thi (**P7**).
> `VOUCHER_IN_PLAY_STATUSES` ek list hai do naam ke saath;
> `VOUCHER_SLOT_CONSUMING_STATUSES` uska alias hai, dusri copy nahi.

> ⚠️ Mutation **M7** (`$ne: EXPIRED` guard hata do) **zinda bacha aur kill nahi
> gina** — us row tak pahunchne ke liye pehle se `EXPIRED` master chahiye jiski
> koi version abhi due padi ho, par sweep ek hi pass me saari due versions
> nipta deti hai. Guard rakha hai, par wo aaj ke data me pahunch se bahar hai.

> ⚠️ Pause master ko tabhi chhuta hai jab wo isi version ki baat kar raha ho.
> `updateVoucher` fork par master ko `DRAFT` kar deta hai, to voucher v1 par live
> ho sakta hai jabki master `DRAFT` padha hai. History me `masterFollowed: false`
> darj hota hai, warna wo row aadhi-likhi lagti.

## V-6 · Delete — ✅ **DONE** (`f869beb`, `a3ec6d5`, `5dbde70`)
`services/vouchers/deleteVoucher.js` · `helpers/vouchers/{assertNoLiveClaims,markDeleted}.js` · `middlewares/errorHandler.js` · `scripts/verifyApiCoverage.js` · models · routes · validator · docs · postman
- [x] `VOUCHER_STATUSES.DELETED` enum me (aur `VOUCHER_APPROVAL_ACTION.DELETED`)
- [x] Soft delete + `status: DELETED` + `deletedAt` + `deletedBy` + `deleteReason` — **`voucherDeletionFields()` se, ek hi `$set` me**
- [x] Saari versions saath — warna ek deleted voucher ki `PUBLISHED` version reh jaati jise customer listing serve karti rehti
- [x] `releaseSlot(brandId, VOUCHERS)` — **commit ke baad**, kyunki wo `Brand` par likhta hai aur jaan-bujh kar kabhi throw nahi karta
- [x] **Live-claim guard** — `PENDING`/`PAID` par 409, **ADMIN par bhi**; `liveClaims` + `breakdown` + `suggestedAction`
- [x] **Proof:** money `voucherDelete` (23) · poori voucher money suite **161/161** · mutation **13/14**

> ⚠️ **M7/M8 dono marte hain** — `status: DELETED` hatane par 8 test girte hain,
> `isDeleted` hatane par 4. Yaani V-11 ka "dono hamesha saath" sirf comment nahi.
> **M2** (`toId()` hata do) 6 test girata hai: aggregation ka `$match` cast
> **nahi** karta, aur jo guard chupke se kuch match na kare wo hamesha pass karta hai.

> ⚠️ **M12 zinda hai aur kill nahi gina.** Usne teen cheezein kholin: (1)
> concurrency ka test tha hi nahi — purana "double delete" sequential tha aur
> load ke 404 par ruk jaata tha; (2) do ek-saath delete par haarne wale ko
> **`WriteConflict` ka 500** milta tha (ab `errorHandler` me 409, har
> transactional service ke liye); (3) **mera apna comment jhooth bol raha tha** —
> wo filter double click nahi rokta, Mongo rokta hai. Filter beech ki patli
> khidki dekhta hai (doosre ka `findOne` pehle ke commit se pehle, write baad me),
> jo bahar se deterministically banayi nahi ja sakti.

> 🔴 **`verifyApiCoverage` me do hole mile** — `:param` ka pattern **koi bhi
> segment** match karta tha (to `DELETE /vouchers/:voucherId` ko
> `POST /vouchers/create` "documented" bana deta tha), aur lookahead me `/` nahi
> tha (to chhota path lambe par free-ride kar leta). Tighten karne par 226 me se
> **theek ek** route pass se fail hua — wahi jiska sach me kuch likha nahi tha.

## V-6b · Admin ko deleted dikhana — ✅ **DONE** (uncommitted)
`services/vouchers/getAllVoucherVersions.js` · `validator/vouchers.js` · docs · postman
- [x] `getAllVoucherVersions` ka `isDeleted: false` **admin ke liye bhi hardcoded** tha — ab `?includeDeleted=true`, **ADMIN-only**, default off
- [x] Vendor/sub-vendor ke bhejne par **403**, chup-chaap ignore nahi — aur refusal **brand scoping se pehle**
- [x] `deletedAt` · `deletedBy` · `deleteReason` response me — projection `{ $project: { __v: 0 } }` exclusion hai, to teeno pehle se aa rahe the
- [x] Docs (3) + postman (disabled query param, kyunki flag ADMIN-only hai aur vendor env me `admin_token` nahi hai)
- [x] **Proof:** money `voucherDeletedListing` (14) · mutation **6 mare, 1 equivalent**

> ⚠️ **M7 zinda hai aur kill nahi gina — par wo equivalent hai.** Wo mutant
> `scopeToActor` ko skip karta hai jab `wantsDeleted` sach ho. Us line tak
> `wantsDeleted === true` leke **sirf ADMIN** pahunch sakta hai (403 guard), aur
> `scopeToActor` ADMIN ke liye pehli hi line par `return match` karta hai —
> yaani wo waise bhi no-op hai.

> ⚠️ **Teen test pehli baar galat likhe the.** Wo ek hi voucher bana kar use
> delete karte the, aur `pagination()` khali page par **404 "No any
> voucherversion found"** phenkta hai — khali list nahi. To wo us behaviour ko
> naap rahe the, is wale ko nahi. Ab teeno me ek live voucher bhi hai.
>
> Khali listing ka 404 hona theek nahi lagta (filter kuch match na kare to wo
> "not found" nahi hai), par wo **pehle se hai aur poore codebase me ek jaisa**,
> isliye V-6b me chheda nahi gaya.

## V-6c · Claim snapshot bharna — ✅ **DONE** (uncommitted)
`helpers/vouchers/buildVoucherSnapshot.js` (naya) · `buildClaimPreview.js` · `createVoucherClaimOrder.js` · docs · postman
- [x] `voucherSnapshot` me ab `bannerUrl` · `bannerThumbnail` · `bannerType` · `imageUrl` bhi
- [x] Banner **`pickVoucherBanner` se resolve** hokar — yaani wahi tasveer jo customer ne dekhi thi, raw `banner.current` nahi
- [x] Pehli image **`sortOrder` se**, array position se nahi
- [x] Purane claims me field nahi → `?? null`
- [x] Schema aur projection **kuch nahi badla** — `claimSnapshotSchema` `strict: false` hai aur `claimRecordProjection` me `voucherSnapshot: 1`
- [x] **Proof:** unit `voucherSnapshot` (13) · money `voucherClaimSnapshot` (9) · mutation **8 mare, 1 dead code**

> 🔴 **M1 pehli baar zinda bacha, aur wo asli gap tha.** Mera test apna khud ka
> `select` string likhta tha — yaani wo sabit karta tha ki *main string likh sakta
> hoon*, na ki ye ki service field bhoolti nahi. Ab test asli `buildClaimPreview`
> se guzarta hai (PUBLISHED version window me, asli outlet, mapping), aur M1 marta hai.

> ⚠️ **M4 ne meri apni galti pakdi.** Maine `[...images]` likha tha aur comment me
> daawa kiya tha ki wo caller ki array bachata hai. Wo **jhooth** tha — `.filter()`
> pehle hi nayi array de deta hai, to `.sort()` original tak pahunchta hi nahi.
> Spread dead code tha; hata diya aur comment sach kar diya.

> ⚠️ Money test pehli baar 2 fail hui — **V-6 ke apne live-claim guard se**.
> Seeded claim default `PENDING` par banta hai aur wahi delete rokta hai. Guard
> sahi tha, fixture galat: ab `REDEEMED`, jo asli scenario bhi hai (kharida,
> istemal kiya, baad me vendor ne voucher hataya).

> 🔴 **Ye is baat par tika hai ki `deleteVoucher` storage se kuch nahi hataata.**
> Isi se ye URL freeze karna imaandari hai, jhootha vaada nahi. Money test me wo
> pin bhi hai — kal koi "files bhi delete karo" jode to har purana claim tootega,
> aur is file ko chhue bina.

## V-7 · Voucher image reorder — ✅ **DONE** (uncommitted)
`services/vouchers/reorderVoucherImages.js` (naya) · `helpers/common/ordering.js` (naya) · routes · validator · docs · postman
- [x] `PUT /vouchers/versions/:versionId/images/reorder` — poori list, 1..n, showcase jaisa
- [x] Bheje gaye number sirf **kram** batate hain — `10, 20, 30` → `1, 2, 3`
- [x] 🔴 **Sirf `DRAFT`/`REJECTED`** — published `isImmutable` hai. **Fork nahi hota**: ek drag-and-drop jo chupke se version bana kar approval queue me daal de wo vendor ne maanga hi nahi tha. Saaf **409** jo batata hai ki naya version banaiye
- [x] Pehli image hi banner fallback hai (V-4a) aur claim snapshot usi ko freeze karta hai (V-6c) — ek test seedha yahi naapta hai
- [x] Response me sirf `{ id, sortOrder, url }` — `media` ka baaki hissa storage locator hai
- [x] Docs (3) + postman (3 saved example)
- [x] **Proof:** money `voucherImageReorder` (19) · mutation **14/14**

> ⚠️ **Teen helper `helpers/showcases` se `helpers/common/ordering.js` me shift kiye**
> — `normalizeSortOrder`, `validateUniqueIds`, `validateUniqueSortOrders`. Teeno
> poori tarah generic hain (list, key, number — section ka naam tak nahi). Voucher
> service se `helpers/showcases` import karna ek aisi dependency hoti jiska koi
> matlab nahi, aur copy banana do jagah ek rule ka drift. Sirf **2 call sites**
> the, dono showcase reorder services — showcase money suites **80/80** unke baad bhi.

> 🔴 **Do mutant zinda bache the, aur dono meri apni andhi jagah thi.**
>
> **M14** (`normalizeSortOrder` ka `.sort()` hata do) — mere saare test aisi list
> bhejte the jiska array-kram aur `sortOrder` pehle se ek tha, to wo sort un sab me
> no-op tha. Bina uske renumbering **array position** se hoti, `sortOrder` se nahi.
> Naya test dono ko jaan-bujh kar alag rakhta hai.
>
> **M3** (`|| version.isImmutable` hata do) — mera fixture `isImmutable` ko status se
> hi derive karta tha, to DRAFT+immutable ka combination banta hi nahi tha. Aaj ke
> flows me wo pahunch se bahar hai, par pin kiya: us field ka matlab hi hai "ise
> dobara kabhi edit mat karo", aur agar wo sirf status ke raaste pahunchti hai to ek
> naya flow uske galat hone ke liye kaafi hai.
>
> Dono ke liye test jodne ke baad **dono marte hain**.

---

## U-1 … U-5 · Upload
### U-1 — ✅ **DONE** (`f14f7bb` + `1d87d75`)
`routes/uploads.js` · `controllers/uploads/*` · `validator/uploads.js` · `services/storage/{presign,confirm,inspect,accept}.js` · `models/Upload.js`

- [x] `POST /uploads/presign` — presigned **POST**, policy S3 enforce karta hai
- [x] `POST /uploads/confirm` — magic bytes se asli pehchaan, `staging/` se asli key par move
- [x] Facade `acceptUpload` / `acceptUploads` — ek darwaza, dono raaste
- [x] **E1** file+uploadId dono → **422**, aur upload consume nahi hota
- [x] **E2** purpose mismatch → **422**, aur **confirm se pehle** — upload jalta nahi
- [x] Teen-docs rule: vendor doc #94/#95, endpoints_category, postman "12 — Uploads"
- [x] **Proof:** money `uploadPresignConfirm` (17) + `uploadAccept` (16), **asli bucket ke against** · unit `inspect` (26) · mutation **11/11**

> 🔴 **Test mock par nahi likhe.** Is raaste ka poora daawa yahi hai ki policy
> **S3 enforce karta hai, hum nahi** — aur mock wahi enforce karta jo use bataya
> jaye, yaani wo teen cheezein maan leta jo test ko sabit karni hain: size cap,
> pinned content-type, aur exact key. S3 preflight `ok` tha, to test asli likhe.

> ⚠️ **Facade ka asli kaam translation hai, aur wo chhupa hua tha.**
> `confirmUpload` `{ contentType, sizeBytes }` deta hai aur `url` bilkul nahi;
> `toMediaDocument` `{ mimeType, size }` padhta hai. Bina translate kiye har
> surface ek aisi media row likhti jisme **mime `null` aur size `0`** hota — aur
> **kahin koi error nahi aata**. Mutation M6 ne wahi pin kiya.

> 🔴 **Ek security gap mutation se mila (M4).** Facade ke lookup se `userId`
> hataane par mere saare test pass rahe, kyunki sab matching purpose bhejte the
> aur `confirmUpload` ke apne owner check par 404 ho jaate the. Par kisi aur ka
> id **galat purpose** ke saath alag raasta leta hai: intent mil jaata, purpose
> check chalta, aur **422** aata jo batata ki wo upload kis surface ka tha —
> yaani prober ko id ka asli hona **aur** uska surface dono muft. Ab uska apna
> test hai.
### U-2 — ✅ **DONE** (uncommitted)
`validator/categories.js` · `controllers/categories/{createCategory,updateCategory}.js` · `services/categories/{createCategory,updateCategoryById}.js`

- [x] `uploadId` dono schema me — 24-char hex, dono failure ka ek hi message
- [x] Dono controller `{ userId, role }` service tak le jaate hain
- [x] Dono service `uploadFromPath` ki jagah `acceptUpload` — multipart abhi bhi chalta hai
- [x] `if (image || uploadId)` — warna presigned raasta update par pahunchta hi nahi
- [x] 🔴 **Delete ab `save()` ke BAAD** — neeche
- [x] Teen-docs rule: endpoints_category #100/#103, admin doc #61/#64 + naye #111–#112, admin Postman dono request
- [x] **Proof:** money `categoryUpload` **19** (asli bucket) · unit `categoryController` **6** · money `brandImages` **30** (3 naye) · mutation **18/18**

> ### 🔴 Ek asli defect isi block me nikla — delete `save()` se pehle tha
>
> Upar ka comment daawa karta tha ki kram theek ho chuka hai, aur ek qadam tak wo
> sach bhi tha: upload delete se pehle hota tha. Par delete **`save()` se pehle**
> tha — to ek save jo throw kar jaaye, bytes le jaata aur row purane URL par hi
> chhod deta. Wahi toota hua tile, bas thoda door hat kar, aur ab row ko kisi aur
> tasveer par point karne ka koi tareeka bhi nahi.
>
> Ab: **upload → save → tab delete**, aur delete ka fail hona sirf log hota hai.
> Us waqt tak row nayi tasveer par hai, yaani customer ko sahi cheez dikh rahi
> hai; `500` dena us update ke liye hota jo ho chuka, aur admin ek ho chuke save
> ko dobara karne jaata. Peechhe ek unreferenced object reh jaata hai — wahi
> `scripts/auditOrphans.js` ka kaam hai.
>
> ⚠️ **Sahi pattern repo me pehle se tha** — `updateBrand`, `updateSubBrand`,
> `updateBrandFeature` aur `updateSectionMedia` chaaron save ke baad delete karte
> hain. Teen surface uske bahar thi; category ab andar hai, `subCategory` aur
> avatar **U-5** ki checklist me hain.

> 🔴 **`actor` hi asli naya kaam hai, aur uska galat hona kahin fail nahi hota.**
> Facade upload intent ko **id aur owner dono** se dhoondhta hai. Controller se
> `req.userId` na aaye to service ke apne test green rehte hain (wo apna actor
> khud banate hain), multipart raasta green rehta hai (wo actor dekhta hi nahi),
> aur asli client ko **har upload par** `404 That upload was not found.` milta
> hai. Isi ek baat ke liye `categoryController.test.js` alag se hai.

> 🔴 **Refusal purani tasveer ki keemat par nahi aa sakta.**
> Purana order delete pehle karta tha, aur tab ek fail hui upload category ko
> bina tasveer ke chhod deti thi — customer ki list me toota hua tile, ek aisi
> request se jo `500` deti thi aur retry karne layak lagti thi.
>
> Presigned raasta ise **aur** zaroori banata hai: yahan reject hone ke do naye
> tareeke hain jo multipart par the hi nahi — galat purpose ka upload, aur kisi
> aur ka upload. `categoryUpload.test.js` ka poora ek describe block isi par hai,
> aur har assertion **asli bucket par `HeadObject`** hai, mock par nahi.

> ⚠️ **Missing object S3 par `403` deta hai, `404` nahi** — aur ye theek hai.
> S3 tabhi batata hai ki object nahi hai jab caller ke paas `s3:ListBucket` ho;
> hamare upload role ke paas jaanboojh kar nahi hai, to *"no such key"* *"access
> denied"* ban ke aata hai. Isliye har `false` assertion ke bagal me usi
> credential se ek `true` assertion hai — permission ki dikkat pehle usi ko
> giraati, to jodi ka pass hona sirf ek hi matlab rakhta hai.

> ⚠️ **`assertImageFile` surface par hi rahega**, facade me nahi. Wo ek **exact
> mime allow-list** hai, aur purpose ka `kinds` jaanboojh kar nahi hai —
> `constants/storage.js:97` khud likhta hai ki kinds routing hai, security
> boundary nahi. `kindFromMime("image/svg+xml")` `IMAGE` deta hai, aur apne CDN
> se serve hui SVG stored XSS hai. Presigned raaste par yahi kaam confirm ka
> magic-byte check karta hai.

> ⚠️ **`brandImages` ka storage mock ab asli facade rakhta hai**
> (`jest.requireActual(".../storage/accept")`). Stub rakhna us ek cheez ko hata
> deta jo tay karti hai ki request kis raaste par gayi; ab uska multipart raasta
> wahi mock `uploadFromPath` par utarta hai, to S3 tak kuch nahi jaata.

> **Teen doc galtiyan isi sync me nikli** (U-2 ne banayi nahi, U-2 ne dikhayi):
> `210` do alag endpoint par tha — pause aur `/app-config` — pause ab `216`;
> `/uploads` ki dono row §13 Vouchers me padi thi jabki summary table use module
> 35 keh raha tha, ab apna section §35; aur `GET /documents/:token` isi shape me
> §24 me tha, ab §34.

### U-3 commit 1 — ✅ **DONE** (uncommitted) · limits dono raaston par
`helpers/settings/getUploadLimit.js` 🆕 · `helpers/settings/getShowcaseConfig.js` · `helpers/settings/assertStorageLimitRule.js` · `services/storage/{presign,confirm}.js`

- [x] `getUploadLimit(purpose, kind)` — `min(code ka ceiling, Setting.storage.limits, surface override)`
- [x] `presign` ka **413 aur policy dono** usi number se
- [x] `confirm` asli byte count ko usi cap se naape — over ho to object discard + 413
- [x] `getShowcaseConfig` ab `effectiveLimitMB` se guzarta hai — uska pehla asli caller
- [x] `assertStorageLimitRule` me **GIF ka rule** — pehle chhoota hua tha
- [x] Docs: endpoints_category #214/#215, admin #111/#112 + `storage` settings block, vendor #94/#95
- [x] **Proof:** money `uploadSizeLimits` **11** (asli bucket) · unit `uploadLimit` **9** · mutation **16/16**

> ### 🔴 Kyun ye U-3 ke andar hai, aur kyun ise pehle karna pada
>
> Showcase pehli surface hai jiski limits settings-driven aur global se **narrow**
> hain. Uske bina U-3 ka limits wala hissa ek jhooth hota.
>
> **Jo tha:** `presign` apni S3 policy ek **static constant** se banata tha
> (`UPLOAD_PURPOSES[purpose].maxBytes`), aur `confirm` ke paas asli byte count
> (`head.ContentLength`) hote hue bhi wo kisi limit se compare hota hi nahi tha —
> sirf kind check hota tha.
>
> Matlab `Setting.storage.limits` (ST-3) aur har surface override (ST-4) **sirf
> multipart raaste par** lagte the. Admin platform ka video limit 50 se 20 karta:
> panel maan jaata, seedha-S3 raasta 50 par hi rehta. Ek platform, do limit — aur
> chhoti wali hi wo thi jise band kiya ja sakta tha.
>
> ⚠️ **Under-declare karke bhi kuch nahi milta.** Policy hamesha **limit** se
> banti hai, client ke `sizeBytes` se nahi — wo sirf padhne-layak 413 ke liye hai.
> Ek test 1 byte declare karke 2 MB bhejta hai aur S3 ka apna `EntityTooLarge`
> wapas padhta hai.

> ### 🔴 `confirm` ka check policy ki jagah nahi leta — wo uska doosra half hai
>
> Signature ek baar likhi jaati hai aur pandrah minute chalti hai. Admin us beech
> limit ghata de to client ke haath ki signature nahi badalti — to har bakaya
> presign purani ceiling par chalta rehta. Aur is commit se pehle jaari hui har
> signature me to static constant hi hai.
>
> ⚠️ Aur wahan limit **verified kind** ki hai, declared ki nahi. GIF ka apna bada
> ceiling hai, to PNG ko `image/gif` bata kar bhejna warna GIF ka allowance muft
> me de deta — kind magic bytes se isi liye tay hota hai.

> ### ⚠️ `effectiveLimitMB` ka koi caller hi nahi tha
>
> `assertStorageLimitRule` ka apna comment kehta hai *"read path chhoti wali leta
> hai aur ye save mana karta hai — belt and braces"*. Read path lete hi nahi tha:
> `getShowcaseConfig` `vendor.showcase` ki value seedha lautata tha, kahin `min`
> nahi. Do me se ek brace lagi hi nahi thi.
>
> Ye O-3 ke chaar dead knobs jaisi hi cheez hai, aur isi wajah se dhoondhne par
> mili. Ab uska pehla asli caller hai, aur ek test us state ko pin karta hai jo
> save-rule rok nahi sakta — seed kiya hua ya purane shape se restore hua document.

> ⚠️ **GIF ka save-rule chhoota hua tha.** `STORAGE_LIMIT_RULES` me sirf image aur
> video the, jabki `getShowcaseConfig` GIF ka apna ceiling lautata hai aur
> `validateMediaFiles` GIF ko usi se naapta hai. Admin showcase ka GIF limit global
> se bada set karta aur `200` milta. Ab ek test ye bhi naapta hai ki **jo bhi
> ceiling read path ghatata hai, uska save-rule maujood ho** — do list ka drift
> dobara chup-chaap na ho.

### U-3 commit 2 — ✅ **DONE** (uncommitted) · showcase surface
`services/storage/accept.js` · `models/Upload.js` · `helpers/showcases/{upload,validateMedia}.js` · `services/showcases/{addSectionMedia,replaceSectionMedia,updateSectionMedia}.js` · `validator/showcase.js`

- [x] `describeIncoming` / `describeAllIncoming` — surface ko pata chale **kya aa raha hai**, upload kharch kiye bina
- [x] Teeno endpoint par `uploadIds` / `thumbnailUploadIds` / `uploadId` / `thumbnailUploadId`
- [x] Poster index-aligned, aur har raasta apne andar pair karta hai
- [x] `Upload.declaredFileName` — warna presigned raaste par har media ka title khali
- [x] 🔴 Poster ab `SHOWCASE_THUMBNAIL` par (pehle use video ka 50 MB allowance milta tha)
- [x] Title/altText 100 char par capped
- [x] Docs: endpoints_category #63–#65, vendor #48/#49/#50, admin showcase block, vendor Postman ×3
- [x] **Proof:** money `showcaseUpload` **16** (asli bucket) · unit `showcaseMedia` **41** · mutation **22/22**

> ### 🔴 Surface ke apne rules platform ke rules nahi hain
>
> Section meter karta hai **kitni** photo aur video ek section me aa sakti hain,
> aur **kaunse exact mime** wo leta hai. `presign` aur `confirm` in dono ko
> jaante hi nahi — wo kind ka parivaar aur size dekhte hain.
>
> Multipart par surface `file.mimetype` aur `file.size` padh leti thi. Presigned
> par file hai hi nahi, sirf id hai. `describeIncoming` wahi teen field intent row
> se lauta deta hai, to surface ke saare purane check bina badle chalte hain.
>
> 🔴 **Aur wo confirm se PEHLE chalte hain.** Baad me chalte to jawab wahi rehta —
> "section bhar chuka hai" — par vendor ki **saari** files jal chuki hotin, sirf
> isliye ki unhone ek zyada chun li.

> ### ⚠️ Poster ka apna purpose — aur ye ek fix hai, translation nahi
>
> `uploadSingleMedia` poster ko `SHOWCASE_MEDIA` bhejta tha, yaani use video ka
> **50 MB** allowance milta tha. `SHOWCASE_THUMBNAIL` 10 MB par capped hai aur
> VIDEO leta hi nahi — jo ek still ke liye theek hai. `updateSectionMedia` pehle
> se sahi purpose likhta tha; ye path uske bahar tha.
>
> 🔴 Presigned raaste par ye ek aur wajah se zaroori hai: video aur uska poster do
> alag upload hain, aur ek ka id doosre ki jagah kharch nahi hona chahiye — warna
> do me se **tighter** rule hi wo hai jise skip kiya ja sakta hai.

> ### ⚠️ Title khali aa raha tha, aur kisi test me nahi dikhta
>
> `prepareMediaDocuments` har item ka naam uski file se leta hai
> (`media.originalName`). Presigned raaste par file ka naam kahin store hi nahi
> hota tha — `presign` use sirf extension ke liye padhta tha. Nateeja: multipart
> se aayi media ka title bhara hua, presigned se aayi ka khali, ek hi request ke
> do jawab — aur wo raasta vendor ne chuna bhi nahi tha.
>
> Ab `Upload.declaredFileName` rakhta hai aur facade use `metadata.originalName`
> me lauta deta hai. ⚠️ Wo S3 tak phir bhi nahi jaata — key uuid hi rehti hai,
> taaki public URL me kisi ka rakha hua naam na aaye.

> ⚠️ **Title ab 100 char par capped hai.** `title` ka apna limit 100 hai aur
> `altText` ka 150, par ye path unhe seedha likhta hai — to 300-character filename
> aisi media banata tha jise vendor dekh to sakta tha, edit nahi kar sakta tha,
> kyunki har save ek aisi value par reject hota tha jo usne kabhi type hi nahi ki.

> ⚠️ **Postman me do field ke naam galat the** — `medias` aur `media`, jabki
> service `files` aur `file` padhti hai. Dono request default par disabled hain,
> isliye wo kabhi chali hi nahi aur galti pakdi nahi gayi. Ab theek hain, aur
> dono raaste likhe hue hain.
### U-4 — ✅ **DONE** (uncommitted) · voucher surface
`constants/storage.js` · `helpers/vouchers/{validateImagesFiles,voucherBannerMedia}.js` · `services/vouchers/{createVoucher,updateVoucher,setVoucherBanner}.js` · `validator/vouchers.js` · `controllers/vouchers/setBanner.js`

- [x] `imageUploadIds` (create) · `newImageUploadIds` (update) · `bannerUploadId` + `bannerPosterUploadId` (create aur #83)
- [x] 🆕 **`VOUCHER_BANNER_POSTER`** purpose — poster ab banner ke allowance par nahi
- [x] Image floor, ginti aur mime allow-list **describe par**, confirm se pehle
- [x] Mila-jula batch ek hi list, files pehle ids baad me — floor poore batch par
- [x] Docs: endpoints_category #75/#76/#83, vendor #54/#55/#59, admin vendor-toolkit block, vendor Postman ×3
- [x] **Proof:** money `voucherImageFloorPaths` **23** · money `voucherBannerReview` **21** · unit `voucherMedia` **44** · mutation **18/18**

> ### 🔴 Poster ko apna purpose dena ek fix hai, naam badalna nahi
>
> `uploadVoucherBannerMedia` poster ko `VOUCHER_BANNER` par bhejta tha, yaani ek
> still ko video ka **50 MB** allowance milta tha. `VOUCHER_BANNER_POSTER` 10 MB
> par capped hai aur VIDEO leta hi nahi.
>
> 🔴 Presigned raaste par ye ek aur wajah se zaruri hai: purpose hi wo **ek**
> cheez hai jo banner aur uske poster me farq karti hai. Share karne ka matlab
> hota dono id aapas me badle ja sakein — aur do rules me se **tighter** wala hi
> wo hota jise skip kiya ja sakta.
>
> ⚠️ Bucket aur `vouchers/<id>` prefix dono ke liye ek hi hain, to koi object
> hilta nahi. Sirf allowance alag hai.

> ### 🔴 Floor describe par chalta hai, upload par nahi
>
> `assertVoucherImageFloor` pehle se upload se pehle chalta tha — par wo `files`
> ginta tha. Presigned raaste par file hai hi nahi, to bina `describeAllIncoming`
> ke wo ginti **zero** hoti aur har presigned create floor par mar jaata.
>
> Ab dono raaste ek hi list banate hain, aur floor us list par lagta hai: do
> attached + ek `uploadId` = teen. Raaston ko alag ginna wo galti hai jisme do-do
> karke koi bhi floor paar kar leta.

> ⚠️ **`jsonTolerantArray` ko upar shift karna pada.** Wo `validateCreateVoucher`
> aur `validateUpdateVoucher` ke **beech** declare tha; create ab use karta hai,
> aur ek `const` ko uske temporal dead zone me chhoona module load par throw karta
> — yaani poora process boot par girta, ek request nahi.

> ⚠️ **Postman me do aur galat field naam mile.** Update request `images` bhejti
> thi jabki service `newImages` padhti hai, aur banner request ka description
> abhi bhi `bannerType` + `bannerImage`/`bannerVideo`/`bannerGif` batata tha — wo
> teeno V-4 me hataye ja chuke the. Dono request disabled hain, isliye kabhi
> chali hi nahi.
### U-5 — ✅ **DONE** (uncommitted) · baaki saari surfaces
`constants/storage.js` · `services/storage/accept.js` · `helpers/{banners,promotionalTickers}/media.js` · `services/{banners,promotionalTickers,brands,subBrands,subCategories,users,auth,brandFeatures}/*` · 8 validator

- [x] App banners `mediaUploadId` + `posterUploadId` · 🆕 **`BANNER_POSTER`** purpose
- [x] Tickers `iconUploadId`
- [x] Brand aur outlet — `logoUploadId` + `coverImageUploadId`, har slot ka apna purpose
- [x] SubCategory `uploadId` · avatar `uploadId` (profile aur register dono)
- [x] Brand feature icon `iconUploadId`
- [x] 🔴 **E5** — `updateBrand` ke uploads ab transaction ke **bahar**
- [x] 🔴 Delete ab `save()` ke **baad** — `updateSubCategoryById` aur `updateUserById`
- [x] 🔴 Facade ab saaf **500** deta hai jab surface actor bhejna bhool jaye
- [x] Docs: endpoints_category, vendor doc, admin doc · Postman ×8
- [x] **Proof:** unit **660** (38 suites) · money `brandImages` **35** · mutation **19/19**

> ### 🔴 Multipart delete U-5 me **nahi** hai — X-4 wapas khul gaya
>
> Plan kehta tha ki U-5 ke ant me multipart seedha delete ho jaye. Wo galat tha.
>
> `presign.js` `@aws-sdk/s3-presigned-post` par bana hai aur Cloudinary ke paas is
> shape ka kuch nahi — yaani **multipart hi Cloudinary ka ekmatra upload raasta
> hai**. Aur `Setting.storage.provider` ek dropdown hai jo kal badal sakta hai.
> Multipart hata dete to us dropdown ko Cloudinary par le jaate hi upload ka koi
> raasta nahi bachta: ek switch jo sab chalu rakhne ka vaada kare aur upload band
> kar de, wo switch na hone se bura hai.
>
> **Faisla (2026-09-18, dobara confirm):** abhi **S3 + presign**. Cloudinary ka
> apna presign **baad me**, usi generic shape me, **zero client change** ke saath
> (~8-10 h). Multipart ka sunset (X-4) usi ke baad — kisi tareekh par nahi.

> ### 🔴 E5 — `updateBrand` ke uploads transaction ke bahar
>
> Do file provider tak jaane me jitna waqt leti, utni der ek Mongo transaction
> khuli rehti thi. Mongo ki apni seemaa 60 second hai, aur ek dheemi connection
> use paar kar sakti hai — tab transaction abort hota hai aur vendor ki **poori
> edit** chali jaati, ek aisi wajah se jiska database se koi lena-dena nahi.
>
> ⚠️ Brand ka wajood ab upload se **pehle** check hota hai. Wo check pehle
> transaction ke apne read se muft milta tha; upload ko aage le jaane par galat id
> ka 404 do uploads ke **baad** aata — yaani vendor paise deta aur phir 404 sunta.
>
> ⚠️ Rollback ab `uploadedBySlot` se padhta hai, `replaced` se nahi. Uploads ab
> session se pehle hote hain, to ek transaction jo assignment loop se **pehle**
> fail ho jaye wo `replaced` khali chhodta hai jabki objects bucket me aa chuke
> hote.

> ### 🔴 Teesri aur aakhri delete-order galti
>
> `updateSubCategoryById` aur `updateUserById` dono purani file ko `save()` se
> **pehle** delete karte the. U-2 me `updateCategoryById` me yahi mila tha; ye wo
> baaki do hain. Ab teeno: upload → save → tab delete, aur delete ka fail hona
> sirf log hota hai (row nayi tasveer par point kar chuki hoti hai, to 500 dena us
> update ke liye hoga jo ho chuka).

> ### ⚠️ Actor bhoolna ab chup-chaap fail nahi hota
>
> `describeIncoming`/`acceptUpload` ab **500** dete hain agar surface actor na
> bheje. Pehle `findOne({ _id, userId: undefined })` kuch match nahi karta aur
> jawab `404 That upload was not found` hota — yaani vendor ko har baar batate ki
> unka upload expire ho gaya, ek service signature ki galti ki wajah se.
>
> 🔴 Ye wo class hai jo multipart se bhari suite me **kabhi nahi dikhti**: wo
> raasta actor padhta hi nahi.

> ⚠️ **`registerUser` ko bhi actor mila.** `POST /auth/register` admin-gated hai,
> to caller hamesha maujood hai — actor wo **admin** hai jo account bana raha hai,
> na ki wo account jo ban raha hai (wo abhi hai hi nahi).

> ⚠️ **Category/subCategory validator ab ek hi message deta hai.**
> `Joi.string().hex().length(24)` `"nope"` par **dono** rule report karta hai, aur
> controller unhe join karke *"Invalid uploadId., Invalid uploadId."* bhejta tha.
> Repo ka apna `objectId()` helper ek baar jawab deta hai.

> ### 🔴 U-5 me do surface ka delete-order bhi theek karna hai
>
> `updateCategoryById` purani tasveer ko **`save()` se pehle** delete karta tha.
> Matlab save fail hone par bytes ja chuke hote aur row purane URL par hi hoti —
> customer ki list me toota hua tile, aur wapas laane ka koi tareeka nahi. U-2 me
> wo theek ho gaya: upload → save → **tab** delete, aur delete ka fail hona
> request nahi giraata (sirf orphan chhodta hai, jise `auditOrphans` pakadta hai).
>
> Wahi galti do aur jagah hai, aur dono U-5 ki files hain:
>
> - `services/subCategories/updateSubCategoryById.js:75` — comment me likha hai
>   *"see `updateCategoryById`"*, aur wahi purana order copy kiya hua hai
> - `services/users/updateUserById.js:99` — avatar, bilkul wahi shape
>
> ⚠️ **Jo pattern sahi hai wo repo me pehle se hai** — `updateBrand`,
> `updateSubBrand`, `updateBrandFeature` aur `updateSectionMedia` chaaron save ke
> **baad** delete karte hain aur failure ko `console.error` par chhodte hain. Ye
> teen surface hi uske bahar thi.

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

# Part 5B — `verifyNoUndef` — ✅ **DONE** (`e2fd846`)

naya `scripts/verifyNoUndef.js` · `.githooks/pre-commit` · `package.json` · `CLAUDE.md`

Ek bug class **teen baar** aa chuki thi, aur do baar ship ho gayi thi:

| Kab | Kya |
|---|---|
| F-4 | `updateSetting` naye 422 path par `throwError` call karta tha, import nahi tha |
| M-1 | **das** services har image upload par `toMediaDocument` / `toDeletable` |
| M-1a″ | **paanch** aur `toDisplayName` par — category, subCategory, offer title |

Teenon ki ek hi wajah: patch ka "is file me `helpers/x` ka import hai kya?" guard
ne usi module ka **koi aur** import dekh liya aur naya naam jodna chhod diya.

🔴 **`verifyImports` ise pakad hi nahi sakta.** Wo module load karta hai aur
destructured naam check karta hai; JavaScript free variable tab tak resolve hi
nahi karta jab tak line chale. To module load hota hai, export hota hai, check
pass karta hai — aur user ke us branch par pahunchte hi `ReferenceError`.

- [x] Babel ki scope analysis (`@babel/parser` + `@babel/traverse` — **jest ke saath pehle se installed**, koi nayi dependency nahi)
- [x] Har referenced identifier par poochta hai: iska binding hai? Na ho aur global na ho → report
- [x] Ek naam par ek report per file, har use par nahi
- [x] Jo file parse na ho, wo **report** hoti hai, skip nahi — chup-chaap pass karna wahi failure hai jise ye scripts rokti hain
- [x] **Pre-commit hook** har `server/**/*.js` change par chalata hai
- [x] `npm run verify` teenon ek saath
- [x] **9 unit test** — dono shipped bugs ka shape reproduce karke, aur 6 tarah ki cheezein jinhe flag *nahi* karna chahiye (catch binding, hoisting, object key, property access, destructured params)

> 🔴 **Banate hi 5 naye bug mile** — M-1a″ wale `toDisplayName` ke, jo already
> commit ho chuke the (`77dc38f`). Har category, subCategory aur offer title
> create/update `ReferenceError` deta. Guard ne pehli hi run me pakde.

---

# Part 6 — Har phase ka acceptance (kuch na chhoote)

Har phase ye **sab** poora karega, warna wo phase done nahi hai:

- [ ] Code + inline `⚠️` / `🔴` notes wahan jahan wajah non-obvious ho
- [ ] Unit tests — nayi shakha par ek, har guard par ek
- [ ] **Mutation test** — fix hatao, test marna chahiye. Na mare to test jhootha hai
- [ ] `verifyImports` · **`verifyNoUndef`** · `verifyEnvCoverage` · `verifyApiCoverage` chaaron pass (`npm run verify` pehle teen)
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
