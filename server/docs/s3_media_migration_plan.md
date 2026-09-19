# AWS S3 Media Migration — Complete Flow & Design Plan

> **Status — 2026-09-19:** ✅ Confirm ho chuka. **Phase 0–5 ship ho chuke hain**
> (facade · S3 provider · 6 surfaces ka `storage` sibling · private bucket +
> presigned GET · `/uploads/presign` + `/uploads/confirm`). Bacha **Block X** —
> live progress [s3_migration_phases.md](./s3_migration_phases.md) me.
>
> ⚠️ **Ye line pehle "Phase 0 aur Phase 1" kehti thi.**
>
> 🔴 **D-1 abhi live nahi hai.** Presigned raasta likha aur test kiya hua hai, par
> `storage.upload.presignEnabled` ka default **`false`** hai — aaj har upload
> multipart se aata hai aur server bytes chhuta hai. Wo switch **X-3** ke saath
> khulega. Neeche ka design us din ka hai, aaj ka nahi.
>
> Execution: [s3_migration_phases.md](./s3_migration_phases.md) ·
> **AWS setup: [aws_s3_setup.md](./aws_s3_setup.md)** ·
> **Go-live: [production_go_live_runbook.md](./production_go_live_runbook.md)**
> Related: [media_upload_map.md](./media_upload_map.md) ·
> [environment_and_services_map.md](./environment_and_services_map.md) ·
> [dead_code_audit.md](./dead_code_audit.md)

---

## 0. Jo decide ho chuka hai

| # | Faisla | Detail |
|---|---|---|
| **D-1** | **Presigned direct-to-S3** | Client seedha S3 par upload karega. Server bytes nahi chhuyega. |
| **D-2** | **T1 — CloudFront + resize Lambda** | `?w=400` style on-the-fly resize. Cloudinary ka `fetch_format:auto` ka replacement. |
| **M-1** | **S3 event → Lambda** metadata nikaalega | width / height / duration / format |
| **P-1** | **S3 default hoga, Cloudinary zinda rahega** | Major sab S3. Cloudinary backup / kabhi-kabhi ke liye. **Dono provider ka code chalu.** |
| **L-1** | **Global limit 100 MB**, `Setting` se | Per-surface limits baad me, zaroorat par (showcase ki tarah). |
| **DB-1** | **Sab test data hai** | Koi migration script nahi. DB disposable. |
| **FE-1** | **Panels doosri team ke paas hain** | Coordination lagega — §11 dekho. |

> ✅ **§15 ke saare sawaal ab lock ho chuke hain.** Execution plan:
> **[s3_migration_phases.md](./s3_migration_phases.md)**
>
> Q-2 ka jawab: **option (a)** — Cloudinary ka code aur config zinda rahega aur
> ek env flag se switch ho sakta hai, par har naya upload S3 par jaayega. Koi
> runtime auto-failover nahi, koi dual-write nahi. Isi wajah se Phase 9
> (`express-fileupload` hatana) possible rehta hai.

---

## 1. Aaj ki haalat — verified

```
client ──multipart──► express-fileupload ──► C:\tmp ya /tmp par poori file
                                                │
                                      file.tempFilePath
                                                │
                          services/uploads ──► helpers/cloudinary ──► Cloudinary
                                                │
                                          URL string ──► Mongo
```

| Kya | Ginti | Kahan se verified |
|---|---|---|
| Controllers jo `req.files` padhte hain | **19** | grep |
| Upload helper call sites | **20** (15 files) | grep |
| Models jinme `storage` subdoc hai | **5** — Banner, PromotionalTicker, ShowcaseSection, Voucher, VoucherVersion | grep |
| Surfaces jinme sirf URL string hai | **6** | §3.2 |
| `res.cloudinary.com` docs/postman/fixtures me | **224** | §12 |
| `@aws-sdk/*` installed | **0** | package.json |

---

## 2. 🔴 Aaj ke code me 6 landmine — S3 chalu hote hi phatengi

Ye **abhi maujood hain** aur S3 aane par chup-chaap toot jaayengi. Plan inhe
pehle theek karta hai.

### L-1 · S3 delete ek silent no-op stub hai

[helpers/showcases/upload.js:53-56](../helpers/showcases/upload.js#L53-L56)

```js
case "S3": {
  // Future Implementation
  // await deleteFromS3(media.storage.key);
  return;                                  // ← kuch nahi karta, error bhi nahi
}
```

**Asar:** S3 par pada showcase media kabhi delete nahi hoga. Row DB se hategi,
object S3 par hamesha rahega. **Koi log, koi alert nahi.**

### L-2 · `deleteFile` S3 URL chup-chaap chhod deta hai

[helpers/cloudinary/index.js:58-62](../helpers/cloudinary/index.js#L58-L62)

```js
if (!isValidCloudinaryUrl(url)) {
  console.log("Skip delete → Not a Cloudinary URL:", url);
  return false;
}
```

Ek `console.log`, aur `false`. **Yahi 6 bare-URL surfaces ka delete path hai** (§3.2).

### L-3 · Voucher rollback provider-blind hai

[helpers/vouchers/validateImagesFiles.js:51,63](../helpers/vouchers/validateImagesFiles.js#L51)

```js
if (image?.url) await deleteImage(image.url);     // hamesha Cloudinary
```

S3 par upload hui voucher image ka rollback = L-2 ka silent skip = orphan.

### L-4 · `isCustomThumbnail` Cloudinary ke URL shape par tika hai

[helpers/showcases/upload.js:75-83](../helpers/showcases/upload.js#L75-L83)

```js
const publicId = media?.storage?.publicId;
if (publicId && thumbnail === getOptimizedImageUrl(publicId)) return false;
```

S3 media me `publicId` `null` hoga → ye check skip → ek **auto-generated poster
ko custom samajh liya jaayega** → `deleteCustomThumbnail` use delete kar dega.

**🔴 Vendor ko kya dikhega:** video ka poster gayab, section me kaali tile.

### L-5 · `limits` bina `abortOnLimit` = chup-chaap kati hui file

[express-fileupload/lib/index.js:17](../node_modules/express-fileupload/lib/index.js#L17) — `abortOnLimit` default **`false`**.

```js
file.on('limit', () => {
  if (isFunc(options.limitHandler)) { options.limitHandler(req, res, next); }
  if (options.abortOnLimit) { closeConnection(413, ...); cleanup(); }  // skip
});
```

`truncated: true` set hota hai — par is codebase me `truncated` **kahin nahi
padha jaata** (0 hits). Aadhi file Cloudinary/S3 par chali jaayegi aur valid row
ban jaayegi.

### L-6 · Temp file success path par kabhi delete nahi hoti

[tempFileHandler.js:46-52](../node_modules/express-fileupload/lib/tempFileHandler.js#L46-L52) —
`complete()` sirf `writeStream.end()` karta hai. `cleanup()` (jo unlink karta
hai) **sirf failure paths** par chalta hai.

Aaj ka natija: `C:\tmp` me **493 files, 7.70 GB**, sabse badi **2,615 MB**,
Oct 2025 se Sep 2026 tak.

---

## 3. Target architecture

### 3.1 Layer stack

```
routes/uploads.js                 ← NAYA:  POST /uploads/presign
     │
controllers/uploads/presign.js    ← NAYA
     │
services/storage/                 ← NAYA: provider-agnostic facade
     ├── index.js                 ← createPresign / confirm / delete / publicUrl
     ├── providers/s3.js          ← @aws-sdk/client-s3 + s3-presigned-post
     └── providers/cloudinary.js  ← aaj ka helpers/cloudinary, wrapped
     │
configs/env/                      ← NAYA (env doc §3.2)
     ├── load.js  schema.js  index.js
configs/s3.js                     ← NAYA
```

**Rule:** koi bhi service/helper `helpers/cloudinary` ya S3 SDK ko **seedha**
nahi chhuyega. Sab `services/storage` se jaayega. Yahi P-1 (do provider) ko
ek jagah rakhta hai.

### 3.2 6 bare-URL surfaces ko `storage` subdoc milega

⚠️ **Sibling field, nested object nahi.** Pehle yahan `image: { url, storage }`
likha tha — wo **breaking response change** hota aur Phase 3 ka poora point
(panel team ko kuch na karna pade) khatam ho jaata. Sahi tarika: URL wala field
bilkul waisa hi rahega, uske bagal me ek naya internal field.

| Surface | Model | Aaj | Baad me |
|---|---|---|---|
| User profile image | `User` | `image: String` | `image` waisa hi **+ `imageMedia`** |
| Register image | `User` | same | same |
| Category image | `Category` | `image: String` | **+ `imageMedia`** |
| SubCategory image | `SubCategory` | `image: String` | **+ `imageMedia`** |
| Brand logo | `Brand` | `logo: String` | **+ `logoMedia`** |
| BrandFeature icon | `BrandFeatures` | `icon: String` | **+ `iconMedia`** |
| Showcase thumbnail | `ShowcaseSection` | `thumbnail: String` | **+ `thumbnailStorage`** |

`storage` ka shape wahi jo already 5 models me hai:

```js
storage: {
  provider: { type: String, enum: ["CLOUDINARY", "S3"] },
  publicId: { type: String },   // Cloudinary
  bucket:   { type: String },   // S3
  key:      { type: String },   // S3
}
```

> `STORAGE_PROVIDER` constant already maujood hai —
> [constants/showcase.js:21](../constants/showcase.js#L21). Use shift karke
> `constants/storage.js` bana denge (showcase-specific nahi hai).

⚠️ **Backward compatibility:** purani rows me `storage` nahi hoga. Reader ka
rule — `storage.provider` missing ⇒ `CLOUDINARY` maano. DB test data hai, par
ye rule phir bhi rakhenge taaki koi row bina provider ke chup-chaap skip na ho.

---

## 4. Presigned flow — step by step

### 4.1 Sequence

```
┌─ 1. POST /uploads/presign ──────────────────────────────────────────┐
│  { purpose: "SHOWCASE_MEDIA", fileName, contentType, sizeBytes }    │
│                                                                     │
│  Server:                                                            │
│    a) auth + role check (purpose ke hisaab se)                      │
│    b) getMediaConfig() → global 100 MB ceiling                      │
│    c) purpose ka apna rule (showcase: 10 MB img / 50 MB video)      │
│    d) contentType allowlist check                                   │
│    e) key banao: staging/<userId>/<uuid>.<ext>                      │
│    f) createPresignedPost() — policy me conditions                  │
│                                                                     │
│  → 200 { uploadId, url, fields, key, expiresAt }                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─ 2. client ──POST multipart──► S3 (direct) ─────────────────────────┐
│  S3 khud enforce karta hai: size range, content-type, key prefix    │
│  → 204                                                              │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─ 3. POST /showcase/section/:id/media  { uploadId }  ────────────────┐
│  Server:                                                            │
│    a) uploadId ka record dekho — kya ye isi user ka hai?            │
│    b) HeadObject  → sach me chadhi? size kya hai?                   │
│    c) GetObject Range: bytes=0-1023  → MAGIC BYTE check             │
│    d) image ho to dimensions parse karo (header se)                 │
│    e) CopyObject staging/… → showcase/<sectionId>/<uuid>.<ext>      │
│    f) Mongo transaction: row banao                                  │
│    g) DeleteObject staging/… (best effort)                          │
│                                                                     │
│  → 201 { media }                                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─ 4. (async) S3 event → Lambda ──────────────────────────────────────┐
│  Sirf VIDEO ke liye: ffprobe se duration                            │
│  → PATCH metadata.duration on the row                               │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 ⚠️ Presigned **POST**, presigned PUT nahi

Ye technical detail sabse important hai:

| | Presigned **PUT** | Presigned **POST** |
|---|---|---|
| Size limit S3 enforce karega | ❌ **nahi** | ✅ `content-length-range` |
| Content-Type bandh sakta hai | 🟡 signed header me, client bypass kar sakta hai | ✅ `starts-with` condition |
| Key prefix bandh sakta hai | ❌ key fixed hota hai | ✅ `starts-with` |
| Browser se seedha form POST | 🟡 | ✅ |

**PUT use kiya to 100 MB ka limit lagega hi nahi** — client 5 GB daal sakta hai.
Isliye `@aws-sdk/s3-presigned-post` ka `createPresignedPost`.

```js
createPresignedPost(s3, {
  Bucket: config.s3.publicBucket,
  Key: `${prefix}staging/${userId}/${uuid}.${ext}`,
  Conditions: [
    ["content-length-range", 1, maxBytes],          // 100 MB ceiling
    ["starts-with", "$Content-Type", "image/"],     // ya "video/"
    ["starts-with", "$key", `${prefix}staging/${userId}/`],
  ],
  Expires: 1800,                                     // 30 min — §7.4
});
```

### 4.3 Magic byte check — F-12 aur F-13 ka asli fix

Confirm step par ek **ranged GET** (pehle 1 KB):

```js
const head = await s3.send(new GetObjectCommand({
  Bucket, Key, Range: "bytes=0-1023",
}));
```

- `FF D8 FF` → JPEG · `89 50 4E 47` → PNG · `52 49 46 46 … 57 45 42 50` → WebP
- `00 00 00 … 66 74 79 70` → MP4/MOV · `1A 45 DF A3` → WebM/MKV
- `<?xml` / `<svg` → **reject** (F-13 — SVG me script chal sakta hai)

Kharcha: ek 1 KB GET. ✅ **Ship ho chuka, aur ab dono raaston par** — pehle
`identify()` sirf `confirm` se bulaya jaata tha, yaani multipart file ka mimetype
wahi rehta tha jo client ne header me likha. Block G (G2) ne wo band kiya:
multipart road bhi local file ka pehla kilobyte padhta hai (wahan GET bhi nahi
lagta, file already disk par hai), aur `HEAD_BYTES` ek hi jagah se aata hai taaki
dono barabar padhein.

Aur usi 1 KB se **image dimensions** bhi mil jaate hain (JPEG SOF0, PNG IHDR,
WebP VP8X sab header me hain). Isliye image ke liye Lambda ki zaroorat hi nahi —
sirf **video duration** ke liye chahiye (moov atom file ke aakhir me ho sakta
hai).

> ❓ **Q-1** — ye refinement theek hai? M-1 me aapne kaha tha "sab Lambda se".
> Mera propose: **image = synchronous, server par** (turant, sach, sasta);
> **video duration = Lambda** (M-1). Isse image rows kabhi bhi adhoori metadata
> ke saath nahi dikhengi.

### 4.4 `staging/` prefix — orphan ka ilaaj

```
trydood-<tier>-public
  staging/<userId>/<uuid>.<ext>      ← CloudFront se NOT served, lifecycle 24h
  showcase/<sectionId>/<uuid>.mp4    ← confirm ke baad yahan
  brands/<brandId>/logo/<uuid>.webp
  vouchers/<voucherId>/images/<uuid>.webp
  banners/<bannerId>/<uuid>.webp
  categories/<categoryId>/<uuid>.webp
  users/<userId>/avatar/<uuid>.webp

trydood-<tier>-private
  documents/<year>/<series>/<number>.pdf   ← Block Public Access ON
```

**S3 lifecycle rule:** `staging/` prefix → 1 din baad auto-delete.

Isse client ka gayab ho jaana (app crash, net gaya, cancel) apne aap saaf ho
jaata hai. **Koi cron, koi code nahi.**

CloudFront behavior me `staging/*` ko **deny** karna zaroori hai — warna
unvalidated file ek public URL par live ho jaayegi.

### 4.5 Immutable keys — CloudFront cache ka ilaaj

Har upload ka **naya uuid**. Kabhi bhi same key par overwrite nahi.

Iska matlab CloudFront par `Cache-Control: public, max-age=31536000, immutable`
safe hai, aur kabhi invalidation nahi chahiye. Purana object delete hone par URL
404 dega — jo sahi hai, kyunki row bhi ja chuki hogi.

---

## 5. Provider strategy — S3 default, Cloudinary zinda (P-1)

`services/storage/index.js` ka contract:

```js
createPresign({ purpose, fileName, contentType, sizeBytes, userId })
confirmUpload({ uploadId, userId, destinationPrefix })
deleteAsset(storage)          // storage.provider dekh kar route karta hai
publicUrl(storage, opts)      // { width } → CloudFront ?w=  |  Cloudinary transform
```

`deleteAsset` — L-1/L-2/L-3 ka ek jagah ilaaj:

```js
exports.deleteAsset = async (storage) => {
  const provider = storage?.provider ?? STORAGE_PROVIDER.CLOUDINARY;  // legacy
  switch (provider) {
    case STORAGE_PROVIDER.S3:          return s3Provider.remove(storage);
    case STORAGE_PROVIDER.CLOUDINARY:  return cloudinaryProvider.remove(storage);
    default:
      // ⚠️ chup nahi — ye wahi silent-skip hai jo aaj bug hai
      throwError(500, `Unknown storage provider: ${provider}`);
  }
};
```

> ❓ **Q-2 — "Cloudinary backup" ka matlab kya?** Do bilkul alag cheezein hain:
>
> | | Matlab | Kaam |
> |---|---|---|
> | **(a) Code zinda** | Cloudinary ka code + config maujood, par har naya upload S3 par. Zaroorat pade to ek env flag se switch. | 🟢 chhota |
> | **(b) Runtime failover** | S3 presign fail ho to apne aap Cloudinary par multipart fallback | 🔴 **bada** — server-through path hamesha zinda rakhna padega, `express-fileupload` kabhi nahi hatega, L-5/L-6 zinda |
> | **(c) Dual write** | Har file dono jagah | 🔴 dugna storage + dugna cost |
>
> Mera suggestion: **(a)**. Aapne kaha "backup or kbhi use ke liye" — wo (a)
> jaisa lagta hai. Par confirm kar dijiye, kyunki (b) chuna to poora Phase 5
> (express-fileupload hatana) cancel ho jaata hai.

---

## 6. Limits — global 100 MB, admin config se (L-1)

### 6.1 Do layer

```
100 MB   ← global hard ceiling. Server/S3 ko bachata hai. Normal user ko kabhi nahi dikhta.
  └─ purpose ka apna rule   ← product decision, achha error message
       showcase:  10 MB image / 50 MB video   (already Setting me)
       baaki:     abhi sirf global            (aapne kaha — zaroorat par batayenge)
```

### 6.2 `Setting` me naya block

```js
media: {
  maxUploadSizeMB: { type: Number, default: 100, min: 1, max: 2048 },
  allowedImageTypes: { type: [String], default: [...] },
  allowedVideoTypes: { type: [String], default: [...] },
  defaultProvider:  { type: String, enum: ["S3","CLOUDINARY"], default: "S3" },
}
```

Naya reader `helpers/settings/getMediaConfig.js` — wahi pattern jo already 7
config readers me hai (`getShowcaseConfig`, `getVoucherConfig`, …).

### 6.3 ⚠️ `getSetting()` me cache nahi hai

[helpers/settings/getSetting.js:4](../helpers/settings/getSetting.js#L4) har call
par `findOneAndUpdate` + `upsert` chalata hai — ye ek **write-path** operation
hai, `findOne` nahi.

Presign har upload par chalega, to ye har upload par ek write-path round trip
hoga. Chahiye: **module-level TTL cache (30-60s)**, aur
`services/settings/updateSetting.js` par invalidate.

> ❓ **Q-3** — TTL cache sirf `getMediaConfig` ke liye lagaun, ya `getSetting()`
> ke level par (jisse saare 7 readers ko fayda ho)? Baad wala behtar hai par
> blast radius bada — subscription/voucher/security config bhi usi se aate hain.

### 6.4 Interim me `express-fileupload` ka limit

Jab tak panels migrate nahi hote, multipart path zinda rahega. Us par:

```js
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: path.join(os.tmpdir(), "trydood-uploads"),   // "/tmp/" nahi
  limits: { fileSize: HARD_CEILING_BYTES },
  abortOnLimit: true,                                        // L-5 — zaroori
  limitHandler: (req, res) => { /* JSON 413, plain text nahi */ },
}));
```

⚠️ Ye value **boot par jam jaati hai** —
[express-fileupload/lib/index.js:33](../node_modules/express-fileupload/lib/index.js#L33)
me `buildOptions` middleware ke **bahar** chalta hai. Isliye interim me ye
`.env` se aayega (restart chahiye), aur **admin-config wali live limit
sirf presign path par** milegi. Presigned poora ho jaane ke baad ye line hat
jaayegi aur sirf live limit bachegi.

> ❓ **Q-4** — interim ceiling `.env` (`MAX_UPLOAD_SIZE_MB=100`, restart chahiye)
> se theek hai? Ya per-request wrapper likhun jo DB se padhe? Wrapper ~20 lines
> ka hai par wo code Phase 5 me delete ho jaayega.

### 6.5 Cleanup middleware (L-6) — interim ke liye

```js
// res.on("finish") par har req.files[*].tempFilePath unlink
app.use(cleanupTempFiles);
```

Ek jagah, har endpoint, aaj aur kal dono. Presigned poora hone tak zaroori hai;
uske baad `express-fileupload` ke saath hi hat jaayega.

---

## 7. Edge cases — poori list

### 7.1 Presign / upload / confirm

| # | Case | Kya hoga | Handling |
|---|---|---|---|
| E-1 | Presign liya, upload kabhi nahi kiya | S3 par kuch nahi | Kuch nahi chahiye. `uploadId` record TTL se expire |
| E-2 | Upload kiya, confirm nahi kiya | `staging/` me orphan | **Lifecycle 24h auto-delete** |
| E-3 | Confirm kiya par object hai hi nahi | — | `HeadObject` 404 → `400 "Upload not found"` |
| E-4 | Same `uploadId` do baar confirm | Do rows ban sakti hain | `uploadId` record par `consumedAt` — dusra `409` |
| E-5 | Kisi aur ka `uploadId` confirm kiya | Chori | `uploadId` record me `userId`; mismatch → `403` |
| E-6 | Key manually badal kar upload | — | Policy me `starts-with $key staging/<userId>/` — S3 khud reject karega |
| E-7 | `Content-Type` jhooth bola | `.exe` ko `image/jpeg` keh diya | **Magic byte check** (§4.3) → `400`, object delete |
| E-8 | SVG upload (F-13) | XSS risk | Magic byte `<svg`/`<?xml` → reject |
| E-9 | 100 MB se badi file | — | S3 policy `content-length-range` → S3 khud `EntityTooLarge` |
| E-10 | Upload slow, policy expire ho gayi | S3 `403` | `Expires: 1800` (30 min). 100 MB @ 3G ≈ 20 min — §7.4 |
| E-11 | Presign spam (1000 URLs maang liye) | — | Presign route par **per-user rate limit** |
| E-12 | Confirm ke waqt section 15 media full ho chuka | Limit toot sakti hai | Count check **transaction ke andar**, phir se |
| E-13 | Confirm hua, `CopyObject` fail | Row nahi bani, staging me file | Lifecycle saaf karega |
| E-14 | `CopyObject` hua, Mongo transaction fail | Public prefix me orphan | `DeleteObject` `catch` me + `scripts/cleanupOrphans.js` sweep |
| E-15 | Bulk (5 voucher images) me 3rd fail | Pehli 2 orphan | Rollback = 2 `DeleteObject`. Provider-aware (L-3 ka fix) |

### 7.2 Delete / lifecycle

| # | Case | Handling |
|---|---|---|
| E-16 | Row delete hui, S3 delete fail | Best effort + log. `cleanupOrphans.js` sweep se pakda jaayega |
| E-17 | Purani Cloudinary row delete | `storage.provider` missing → `CLOUDINARY` default → Cloudinary destroy |
| E-18 | Video ka **auto** poster delete ho gaya (L-4) | S3 par `publicId` null → naya rule: `thumbnailStorage.key` ho **tabhi** custom |
| E-19 | Ek hi object do rows se linked | Immutable uuid keys — kabhi share nahi hote |
| E-20 | CloudFront cache me purana object | Immutable keys — problem hi nahi |

### 7.3 PDF / private bucket

| # | Case | Handling |
|---|---|---|
| E-21 | **PDF ka cached URL ab expire hoga** | 🔴 Aaj `getDocumentByToken` Cloudinary URL row par cache karta hai ([§4.3](./media_upload_map.md)). Private bucket me presigned GET **expire** hota hai → ab **key** cache hogi, URL har request par fresh banega |
| E-22 | `GET /documents/:token` public hai | Theek hai — token hi credential hai. Private bucket **F-14 ko fix karta hai**: ab storage URL guessable + permanent nahi raha |
| E-23 | PDF upload presigned nahi hai | Server khud banata hai → **server-side PutObject**. Sahi hai |
| E-24 | `scripts/sendDocumentVerificationMails.js` | Cloudinary par upload karta hi nahi — seedha attach karta hai. **Koi change nahi** |

### 7.4 Network / mobile

| # | Case | Kya hoga | Handling |
|---|---|---|---|
| E-25 | 100 MB upload beech me toot gaya | Poora dobara | 🟠 **Known limitation.** Single POST me resume nahi hota. S3 multipart upload se hota hai par presigned ke saath kaafi complex. §13 |
| E-26 | Client ki ghadi galat | Presign server banata hai, expiry absolute | Koi asar nahi |
| E-27 | **Browser panel se CORS** | 🔴 Panel ka `fetch` S3 par cross-origin POST hai | **Bucket CORS config zaroori** — warna panel upload ek opaque CORS error se fail hoga aur console me kuch samajh nahi aayega |
| E-28 | Mobile app | CORS lagu nahi | multipart form POST — standard |

### 7.5 Environment / safety

| # | Case | Handling |
|---|---|---|
| E-29 | Dev machine par prod bucket ke creds | 🔴 Dev prod data likh dega | Guard 3 style assert: `NODE_ENV=production` ⇒ bucket naam me `prod`, aur ulta bhi |
| E-30 | `CDN_BASE_URL` khaali | URLs toot jaayenge | Joi schema me **required** |
| E-31 | IAM key leak | — | EC2 par **IAM instance role** (static key hi nahi). Local par restricted non-prod user |
| E-32 | Presign signer ke paas zyada permission | Presigned URL usi ka authority carry karta hai | IAM policy sirf `s3:PutObject` on `staging/*` |

---

## 8. Metadata strategy (M-1 + Q-1)

| Field | Kahan se | Kab |
|---|---|---|
| `originalName` | client ne presign me bheja | turant |
| `mimeType` | **magic bytes se**, client ke string se nahi | turant (confirm) |
| `size` | `HeadObject` → `ContentLength` | turant (confirm) |
| `format` | magic bytes | turant |
| `width` / `height` | **image**: header parse (1 KB me hai) | turant |
| | **video**: Lambda ffprobe | async |
| `duration` | **video**: Lambda ffprobe | async |

Video row pehle `duration: 0` ke saath banegi, Lambda baad me bhar degi.

> ❓ **Q-5** — video row ko `metadata.pending: true` flag dun jab tak Lambda
> nahi chalta? Isse UI "processing…" dikha sakta hai. Bina iske vendor ko ek
> aisi video dikhegi jiski length `0:00` likhi hai.
>
> Aur — Lambda fail ho jaaye (ffprobe crash, timeout) to? Mera propose: **DLQ +
> ek hourly sweep job** jo `pending: true` aur 1 ghante purani rows ko dobara
> try kare. Warna ye wahi silent failure hai jo `CLAUDE.md` mana karta hai.

---

## 9. Image delivery — T1

```
Aaj:   cloudinary.url(publicId, { fetch_format: "auto", quality: "auto" })
Baad:  https://cdn.trydood.com/showcase/<id>/<uuid>.jpg?w=400&q=75
                    │
             CloudFront ──miss──► Lambda@Edge / CloudFront Function
                                        │
                                   sharp se resize ──► S3 origin
```

`services/storage/publicUrl(storage, { width })` — ek hi call site shape, provider
ke hisaab se sahi URL.

> ❓ **Q-6** — kaun se width presets? Mera propose: `160` (thumb/avatar), `400`
> (list card), `800` (detail), `1600` (full). Sirf allowlist widths accept karna
> zaroori hai — warna koi `?w=1`…`?w=9999` hit karke cache poison + Lambda bill
> bana sakta hai.
>
> ❓ **Q-7** — ye Lambda@Edge kaun likhega/deploy karega? Ye **backend repo ke
> bahar** ka kaam hai (AWS console + alag deploy). Mere scope me hai ya aapki
> infra team ka?

---

## 10. Har surface ka target — 29 endpoints

| Group | Endpoints | `storage` aaj | Purpose enum | Nayi limit |
|---|---|---|---|---|
| User image | 2 (register, update) | ❌ | `USER_AVATAR` | global |
| Brand logo | 1 | ❌ | `BRAND_LOGO` | global |
| BrandFeature icon | 2 | ❌ | `BRAND_FEATURE_ICON` | global |
| Category image | 2 | ❌ | `CATEGORY_IMAGE` | global |
| SubCategory image | 2 | ❌ | `SUBCATEGORY_IMAGE` | global |
| Banner img/video/gif | 2 | ✅ | `BANNER_MEDIA` | global |
| Promotional ticker | 2 | ✅ | `TICKER_ICON` | global |
| Showcase media | 4 | ✅ | `SHOWCASE_MEDIA` | **10/50 MB** |
| Showcase thumbnail | 1 | ❌ | `SHOWCASE_THUMBNAIL` | **10 MB** |
| Voucher images | 2 | ✅ | `VOUCHER_IMAGE` | global |
| Voucher banner | 1 | ✅ | `VOUCHER_BANNER` | global |
| Documents (PDF) | 2 | — | *(server-side)* | — |

`purpose` enum hi **authorization** aur **destination prefix** dono decide karta
hai. Ek jagah table, har surface ke liye ek row:

```js
const UPLOAD_PURPOSES = {
  SHOWCASE_MEDIA: {
    prefix: "showcase",
    allow: ["image/*", "video/*"],
    roles: ["VENDOR"],
    limits: (cfg) => ({ image: cfg.showcase.maxImageSizeMB, video: cfg.showcase.maxVideoSizeMB }),
  },
  CATEGORY_IMAGE: { prefix: "categories", allow: ["image/*"], roles: ["ADMIN"] },
  ...
};
```

> 🔴 **F-11 yahin fix ho jaata hai.** Aaj `brandFeatures` me ownership check
> **hai hi nahi** — koi bhi vendor kisi bhi brand ka feature bana/mita sakta
> hai. `purpose` table me `roles` + `ownership` check ek jagah hone se ye hole
> band ho jaata hai. (Ye alag se bhi fix ho sakta hai — §13 dekho.)

---

## 11. Phases — aur panel team ke saath coordination

🔴 **Sabse bada schedule risk:** panels doosri team ke paas hain.

| Phase | Kaam | Client change | Ship alone? |
|---|---|---|---|
| **0** | Temp cleanup middleware + `limits`+`abortOnLimit` + `os.tmpdir()` + `limitHandler` | ❌ | ✅ **aaj** |
| **1** | `configs/env/` + Joi schema + 3 guards | ❌ | ✅ |
| **2** | `services/storage` facade + S3 provider. **L-1…L-4 fix.** Sab call sites facade par | ❌ | ✅ |
| **3** | 6 surfaces ko `storage` subdoc + `constants/storage.js` | ❌ | ✅ |
| **4** | PDF → private bucket, presigned GET (E-21) | ❌ | ✅ |
| **5** | `POST /uploads/presign` + confirm. **Multipart abhi bhi chalu** | ✅ naya raasta | ✅ |
| **6** | CloudFront + resize Lambda (T1) | 🟡 URL shape | infra |
| **7** | Metadata Lambda (M-1) | ❌ | infra |
| **8** | Panel + app migrate karein | ✅ | **unka** |
| **9** | `express-fileupload` + multipart path delete | ❌ | 🔄 Cloudinary presign ke **baad** — master §0.5 |

**Phase 0-4 me panel team ko kuch nahi karna** — poora backend taiyaar ho jaata
hai bina unka intezaar kiye. Phase 5 par unhe contract mil jaata hai aur wo apni
speed se kaam karte hain.

Yani practically ye **C1 (dual mode) hi hai, par ek tay sunset date ke saath** —
Phase 9. Big bang (C2) tab hi ho sakta tha jab panel bhi hamare paas hota.

> ❓ **Q-8** — Phase 9 (multipart hatana) ke liye koi **deadline** rakhein? Bina
> deadline ke dual mode hamesha ke liye reh jaata hai — aur wahi "legacy stale"
> hai jo aap nahi chahte. Mera propose tha: Phase 5 ship hone se **6 hafte**.
>
> 🔄 **Wo answer badal gaya (2026-09-18).** Sunset ab waqt par nahi hai — multipart
> Cloudinary ka ekmatra upload raasta hai, to trigger Cloudinary ka apna presign
> hai (master §0.5).

---

## 12. Doc + Postman sync — 224 jagah

S3 aane par ye sab stale ho jaayenge:

| File | `res.cloudinary.com` |
|---|---|
| `postman/trydood-customer.postman_collection.json` | 57 |
| `docs/customer_mobile_api_doc.md` | 46 |
| `docs/vendor_panel_api_doc.md` | 33 |
| `postman/trydood-vendor.postman_collection.json` | 21 |
| `scripts/seedPostmanFixtures.js` | 20 |
| `postman/trydood-admin.postman_collection.json` | 19 |
| `docs/super_admin_panel_api_doc.md` | 16 |
| baaki 5 files | 12 |
| **Total** | **224** |

⚠️ Postman collections me **captured examples** hain — regenerate karne se wo
9k lines chali jaayengi jo dobara nahi banti. **JSON in-place patch karna hoga.**

Phase 5 ke saath hi ye sab update honge — `verifyApiCoverage.js` aur pre-commit
hook isse enforce karenge (naye `/uploads/presign` route ko map row + role-doc
section + request + captured example chahiye).

---

## 13. Jo is plan ke bahar hai — par jaanna zaroori

| # | Item | Kyun bahar |
|---|---|---|
| **F-11** | `brandFeatures` ownership hole 🔴 | Ye **aaj ka security bug** hai, S3 ka intezaar nahi karna chahiye. Alag se fix karna behtar |
| **E-25** | Resumable upload (S3 multipart) | Alag feature. 100 MB mobile par ek baar me — pehle dekhte hain kitna dard deta hai |
| §8.3 | Users/categories me delete-pehle-upload-baad | Phase 3 me saath hi theek ho jaayega |
| §8.6 | `DEFAULT_IMAGES` purane Cloudinary account par | DB test data hai — reseed me chala jaayega |
| §8.15 | Uploads serial hain | Presigned me client parallel karega — apne aap fix |
| O-1 | `invoiceUrl` naam ka takraav | S3 se sambandh nahi |
| O-2 | `{endDate, isExpired}` index | S3 se sambandh nahi |

---

## 14. Naya dependency + infra

```
@aws-sdk/client-s3
@aws-sdk/s3-presigned-post
@aws-sdk/s3-request-presigner     ← private bucket GET (documents)
```

**AWS side (backend repo ke bahar):**

- 2 buckets × 2 tier = 4 (public/private × prod/nonprod)
- Bucket CORS config (E-27)
- Lifecycle rule `staging/` → 1 din
- CloudFront distribution + `staging/*` deny behavior
- Lambda@Edge (resize) + Lambda (metadata) + DLQ
- IAM: prod role, nonprod user, dono narrow

> ❓ **Q-9** — ye AWS resources kaun banayega? Agar main banaun to mujhe console
> access nahi hai — main sirf **Terraform / CLI script** likh sakta hu jo aap
> chalayen. Theek hai?

---

## 15. Sawaal — ✅ sab lock ho chuke

| # | Sawaal | **Faisla** |
|---|---|---|
| **Q-1** | Image metadata server par sync, ya sab Lambda se? | ✅ **Image sync + video Lambda** |
| **Q-2** | "Cloudinary backup" = (a) code zinda, (b) runtime failover, (c) dual write? | ✅ **(a)** — env flag se switchable, auto-failover nahi |
| **Q-3** | TTL cache sirf `getMediaConfig` par ya poore `getSetting()` par? | ✅ **`getSetting()` par** |
| **Q-4** | Interim upload ceiling `.env` se ya DB wrapper se? | ✅ **`.env`** — wo code Phase 9 me delete hoga |
| **Q-5** | Video par `metadata.pending` flag + retry sweep? | ✅ **Haan** |
| **Q-6** | Resize width presets kya? Allowlist? | ✅ **`160/400/800/1600`, strict allowlist** |
| **Q-7** | Lambda@Edge kaun likhega/deploy karega? | ✅ Main **source + Terraform** dunga, deploy aap |
| **Q-8** | Phase 9 (multipart sunset) ki deadline? | 🔄 **Badla 2026-09-18** — waqt ki deadline nahi. Sunset **Cloudinary ka apna presign ship hone ke baad**, kyunki tab tak multipart hi Cloudinary ka upload raasta hai (master §0.5) |
| **Q-9** | AWS resources main Terraform likhun, aap chalayen? | ✅ **Haan** |

Naye sawaal (Q-10…Q-13) execution doc me hain —
[s3_migration_phases.md §10](./s3_migration_phases.md).

---

## 16. Sabse pehla kadam

**Phase 0 kisi bhi sawaal par depend nahi karta.** Wo aaj ka 7.7 GB leak band
karta hai, S3 se uska koi lena-dena nahi, aur koi client change nahi maangta.

Poora execution plan: **[s3_migration_phases.md](./s3_migration_phases.md)**
