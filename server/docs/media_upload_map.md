# Media Upload / Delete / Replace — Complete Map

Poore project me **jahan bhi** koi file (image, gif, video, audio, PDF, koi bhi
media) upload, replace, delete ya generate hoti hai — sab kuch yahan ek jagah.

> Scope: `server/` hi poora project hai (repo root par sirf `README.md` aur
> `server/` hai). Ye doc `server/` ke har route, controller, service, helper aur
> job ko cover karta hai.

---

## 0. Ek line me poori kahani

**Ek hi provider hai — Cloudinary.** S3 sirf enum aur ek commented-out `case`
block me exist karta hai, koi bhi code S3 par kuch nahi bhejta. Har upload
`configs/cloudinary.js` se guzarta hai, har delete bhi. Files browser se
`express-fileupload` ke through aati hain, disk par temp file banti hai, wahan se
Cloudinary jaati hai — MongoDB me sirf **URL string** ya **`{url, thumbnail,
storage, metadata}` subdocument** store hota hai, bytes kabhi nahi.

Iske alawa ek **doosri, alag pipeline** hai — PDF documents (invoice, refund
receipt, payout statement, chargeback advice). Wo koi user upload nahi hai:
server khud PDFKit se PDF banata hai, OS temp folder me likhta hai, Cloudinary
par bhejta hai, aur local file turant delete kar deta hai.

---

## 1. Provider aur config

| Cheez | Value | Kahan |
|---|---|---|
| Provider | **Cloudinary** (`cloudinary@^2.10.0`) | [configs/cloudinary.js](../configs/cloudinary.js) |
| SDK client | `cloudinary.v2`, `cloudinary.config({...})` | [configs/cloudinary.js:3](../configs/cloudinary.js#L3) |
| Multipart parser | **`express-fileupload@^1.5.2`**, `useTempFiles: true`, `tempFileDir: "/tmp/"` | [index.js:114](../index.js#L114) |
| PDF generator | **`pdfkit@^0.19.1`** | [helpers/documents/renderDocument.js](../helpers/documents/renderDocument.js) |
| S3 | **kahin implement nahi** — sirf enum + commented `case` | [helpers/showcases/upload.js:53-57](../helpers/showcases/upload.js#L53-L57) |

### Environment variables

| Var | Kaam |
|---|---|
| `CLOUD_NAME` | Cloudinary cloud name (upload ke liye) |
| `CLOUD_API_KEY` | API key |
| `CLOUD_SECRET` | API secret |
| `CLOUD_BASE_URL` | **Sirf delete ke liye.** Delete se pehle URL isse match hona chahiye, warna delete chup-chaap skip ho jaata hai. Details §8.2 me. |

### Cloudinary par folder structure

| Folder | Kya jaata hai | `resource_type` |
|---|---|---|
| `Images/` | har image, gif, icon, logo, thumbnail, poster | `image` |
| `Videos/` | har video | `video` |
| `Audio/` | *(kuch nahi — function dead hai, §8.5)* | `video` |
| `Documents/` | har generated PDF | `auto` |

---

## 2. Layer stack — request se Cloudinary tak

Har media request in **4 layers** se guzarti hai. Koi bhi layer skip nahi hoti.

```
HTTP multipart request
        │
        ▼
[L0]  express-fileupload            index.js:114
        →  req.files.<fieldName> = { name, mimetype, size, tempFilePath }
        →  bytes disk par /tmp/ me likhe jaate hain
        │
        ▼
[L1]  Controller                    controllers/<domain>/<verb>.js
        →  req.files me se sahi field nikaalta hai
        →  service ko pass karta hai (controller khud kabhi upload nahi karta)
        │
        ▼
[L2]  Domain media helper           helpers/<domain>/media.js | upload.js
        →  mime-type check, size check, count check
        →  rollback / orphan-cleanup ka faisla yahan hota hai
        →  (kuch domains me ye layer hai hi nahi — seedha L3, §8.4)
        │
        ▼
[L3]  services/uploads/index.js     ← *** SABKA SINGLE ENTRY POINT ***
        →  uploadImage / uploadVideo* / uploadPDF / uploadImageWithMetadata /
           uploadVideoWithMetadata / deleteImage / deleteAudioOrVideo / deletePDF*
        │
        ▼
[L4]  helpers/cloudinary/index.js
        →  uploadFile()   → cloudinary.uploader.upload()
        →  deleteFile()   → cloudinary.uploader.destroy()
        →  getOptimizedImageUrl() → f_auto,q_auto delivery URL
        │
        ▼
     Cloudinary
```

### L3 — `services/uploads/index.js` ka poora API

| Function | Kya karta hai | folder | resource_type | Return | Call sites |
|---|---|---|---|---|---|
| `uploadImage(path)` | image upload | `Images` | `image` | optimized URL **string** | **10** |
| `uploadImageWithMetadata(path, file)` | image + metadata | `Images` | `image` | `{url, thumbnail, storage, metadata}` | **5** |
| `uploadVideoWithMetadata(path, file)` | video + metadata | `Videos` | `video` | `{url, thumbnail, storage, metadata}` | **3** |
| `uploadPDF(path, fileName)` | PDF upload + local file unlink | `Documents` | `auto` | `secure_url` **string** | **1** |
| `deleteImage(url)` | Cloudinary se image destroy | — | `image` | `boolean` | **16** |
| `deleteAudioOrVideo(url)` | video destroy | — | `video` | `boolean` | **3** |
| `uploadVideo(path)` | ⚠️ **DEAD** — koi call nahi | `Videos` | `video` | `secure_url` | **0** |
| `uploadAudio(path)` | ⚠️ **DEAD** — koi call nahi | `Audio` | `video` | `secure_url` | **0** |
| `deletePDF(url)` | ⚠️ **DEAD** — koi call nahi | — | `raw` | `boolean` | **0** |

> Counts sirf actual invocations hain (`require` lines nahi). `uploadPDF` ka
> ekmatra caller `generateAndUploadDocument` hai — yaani **har PDF ek hi darwaze
> se Cloudinary jaati hai**.

> **`uploadImage` vs `uploadImageWithMetadata` ka fark:** pehla sirf ek URL string
> deta hai (purane domains — user, brand, category). Doosra `storage.publicId`,
> `metadata.mimeType`, `size`, `width`, `height`, `duration` bhi deta hai (naye
> domains — showcase, banner, ticker, voucher). Delete ke liye dono me se URL hi
> use hota hai; `publicId` sirf thumbnail-detection me kaam aata hai.

### L4 — `helpers/cloudinary/index.js`

| Function | Detail |
|---|---|
| `uploadFile(path, options)` | `cloudinary.uploader.upload()`. Fail hone par **`throwError(500)`** — yaani upload failure hamesha request ko fail karti hai. |
| `deleteFile(url, resourceType)` | Pehle `isValidCloudinaryUrl(url)` (URL `CLOUD_BASE_URL` se start hona chahiye **aur** `/upload/` contain karna chahiye), phir `extractPublicId(url)` (transformation segments jaise `f_auto,q_auto` aur `v123` strip karta hai), phir `destroy()`. `"ok"` aur `"not found"` dono success maane jaate hain. |
| `getOptimizedImageUrl(publicId)` | `f_auto,q_auto` wala delivery URL. Video ke liye bhi call hota hai → wahi poster-frame thumbnail deta hai. |

---

## 3. Complete endpoint list — har media operation

Sab routes ka prefix `/trydood/v1` hai. `routes/index.js` filename se
auto-mount karta hai.

### 3.1 User / account images

| # | Method + Path | Gate | Form field | Operation | Provider path |
|---|---|---|---|---|---|
| 1 | `POST /auth/register` | `isAdmin` | `image` | **upload** | `uploadImage` → `Images/` |
| 2 | `PUT /users/update` | `verifyJwtToken` | `image` | **replace** (old delete → new upload) | `deleteImage` + `uploadImage` |

- **1** — [controllers/auth/register.js:5](../controllers/auth/register.js#L5) → [services/auth/registerUser.js:36](../services/auth/registerUser.js#L36). Optional field. **Koi mime-type ya size check nahi.**
- **2** — [services/users/updateUserById.js:55-57](../services/users/updateUserById.js#L55-L57). Customer ho to `User.image` ke saath `Customer.image` bhi sync hota hai. **Koi mime-type check nahi**, aur delete pehle hota hai (§8.3).

### 3.2 Brand logo

| # | Method + Path | Gate | Form field | Operation | Provider path |
|---|---|---|---|---|---|
| 3 | `PUT /brands/update` | `isVendorOrAdmin` | `logo` | **replace** | `uploadImage` + `deleteImage` |

[services/brands/updateBrand.js:66-92](../services/brands/updateBrand.js#L66-L92) — ye poora block ek **mongoose transaction** ke andar hai:

- Naya logo pehle upload hota hai, phir document save hota hai.
- Save ke **baad** purana logo delete hota hai (failure sirf `console.error`, request fail nahi hoti).
- Transaction fail ho to `catch` me naya uploaded logo Cloudinary se hata diya jaata hai — orphan nahi banta.
- **Koi mime-type / size check nahi.**

> `Brand.coverImage` field model me hai aur har customer-facing pipeline me
> project hota hai, lekin **koi endpoint use likhta hi nahi** — §8.7.

### 3.3 Brand features (icon)

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 4 | `POST /brandFeatures/add` | `isVendorOrAdmin` | `icon` | **upload** |
| 5 | `PUT /brandFeatures/update/:featureId` | `isVendorOrAdmin` | `icon` | **replace** |
| 6 | `DELETE /brandFeatures/delete/:featureId` | `isVendorOrAdmin` | — | **delete** |

- **5** — [services/brandFeatures/updateBrandFeature.js:39-52](../services/brandFeatures/updateBrandFeature.js#L39-L52): naya upload → `save()` → purana `deleteImage` (try/catch). Order sahi hai.
- **6** — [services/brandFeatures/deleteBrandFeature.js:11-20](../services/brandFeatures/deleteBrandFeature.js#L11-L20): soft delete (`isDeleted: true`), lekin Cloudinary asset **sach me destroy** hota hai. Yaani soft delete audit trail hai, restore point nahi.
- **Koi mime-type check nahi.**

### 3.4 Category / SubCategory images

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 7 | `POST /categories/create` | `isAdmin` | `image` | **upload** |
| 8 | `PUT /categories/update/:id` | `isAdmin` | `image` | **replace** |
| 9 | `DELETE /categories/delete/:id` | `isAdmin` | — | **delete** |
| 10 | `POST /subCategories/:categoryId/create` | `isAdmin` | `image` | **upload** |
| 11 | `PUT /subCategories/update/:id` | `isAdmin` | `image` | **replace** |
| 12 | `DELETE /subCategories/delete/:id` | `isAdmin` | — | **delete** |

- Dono models ka `image` field ek **hardcoded default URL** rakhta hai
  (`constants.js` → `DEFAULT_IMAGES.CATEGORY` / `.SUBCATEGORY`). Ye default ek
  **purane Cloudinary cloud** par hai — §8.6 padhein, ye important hai.
- **9 / 12** — [services/categories/deleteCategoryById.js:13-14](../services/categories/deleteCategoryById.js#L13-L14): pehle `assertCategoryDeletable()` (usage check), phir `deleteImage`. Order deliberately aisa hai — comment me likha hai ki refuse hone wala delete pehle refuse hona chahiye, warna category 400 ke saath bach jaati hai par uski picture ja chuki hoti hai.
- **8 / 11** — delete **pehle**, upload **baad me** (§8.3).
- **Koi mime-type check nahi.**

### 3.5 Home banners (IMAGE / VIDEO / GIF)

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 13 | `POST /banners/create` | `isAdmin` | `image` \| `video` \| `gif` | **upload** |
| 14 | `PUT /banners/update/:id` | `isAdmin` | `image` \| `video` \| `gif` | **replace** |
| 15 | `DELETE /banners/delete/:id` | `isAdmin` | — | soft delete — **media delete NAHI hota** |

Form field ka naam `type` par depend karta hai — [constants/banner.js:9-13](../constants/banner.js#L9-L13):

| `type` | form field | Allowed mime types |
|---|---|---|
| `IMAGE` | `image` | `image/jpeg`, `image/jpg`, `image/png`, `image/webp` |
| `VIDEO` | `video` | `video/mp4`, `video/webm`, `video/quicktime` |
| `GIF` | `gif` | `image/gif` |

Helper: [helpers/banners/media.js](../helpers/banners/media.js) →
`uploadBannerMedia(type, file)` / `deleteBannerMedia(type, media)`.
`VIDEO` → `uploadVideoWithMetadata`, baaki dono → `uploadImageWithMetadata`.
**Yahan mime-type check hai** aur galat type par `422` milta hai.

**Update ka order** ([services/banners/updateBanner.js:51-78](../services/banners/updateBanner.js#L51-L78)) — ye pattern important hai:

```
1. naya file upload  →  newMedia
2. document me newMedia set + save()
3. save fail ho     →  newMedia ko Cloudinary se delete, error rethrow
4. save success     →  purana media delete
```

Yaani **kabhi bhi purana asset naye ke safely save hone se pehle nahi hatta.**

> ⚠️ **Banner delete media clean nahi karta.** [services/banners/deleteBanner.js](../services/banners/deleteBanner.js)
> sirf `isDeleted: true` set karta hai. Cloudinary par file rah jaati hai. Ye
> brandFeatures/showcase ke behaviour se ulta hai — §8.8.

### 3.6 Promotional ticker (icon)

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 16 | `POST /promotionalTickers/create` | `isAdmin` | `icon` | **upload** (required) |
| 17 | `PUT /promotionalTickers/update/:id` | `isAdmin` | `icon` | **replace** |
| 18 | `DELETE /promotionalTickers/delete/:id` | `isAdmin` | — | soft delete — **media delete NAHI hota** |

Helper: [helpers/promotionalTickers/media.js](../helpers/promotionalTickers/media.js).
Allowed: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`
([constants/promotionalTicker.js:16-21](../constants/promotionalTicker.js#L16-L21)).
Create par icon **mandatory** hai — file na ho to `422`.
Update ka order banner jaisa hi hai (upload → save → purana delete).

### 3.7 Brand showcase — sabse bada media surface

Yahi ek jagah hai jahan **multi-file upload**, **replace**, **thumbnail
(poster) upload** aur **bulk delete** — sab kuch hai.

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 19 | `POST /showcase/section/:sectionId/add-media` | `isVendorOrAdmin` | `files` (multiple) | **bulk upload** |
| 20 | `PATCH /showcase/section/:sectionId/media/update/:mediaId` | `isVendorOrAdmin` | `thumbnail` | **poster upload / replace** |
| 21 | `PUT /showcase/section/:sectionId/media/replace/:mediaId` | `isVendorOrAdmin` | `file` (exactly 1) | **replace** |
| 22 | `DELETE /showcase/section/:sectionId/media/delete/:mediaId` | `isVendorOrAdmin` | — | **delete** |
| 23 | `DELETE /showcase/section/delete/:sectionId` | `isVendorOrAdmin` | — | **bulk delete (poora album)** |

Helper: [helpers/showcases/upload.js](../helpers/showcases/upload.js) +
[helpers/showcases/validateMedia.js](../helpers/showcases/validateMedia.js).

#### Limits — ye **admin-configurable** hain

`getShowcaseConfig()` pehle `Setting.showcase` padhta hai, na mile to
`constants/showcase.js` ke defaults:

| Limit | Default | Setting field |
|---|---|---|
| `maxItems` (ek section me total) | 15 | `Setting.showcase.maxItems` |
| `maxImages` | 15 | `Setting.showcase.maxImagesPerSection` |
| `maxVideos` | 5 | `Setting.showcase.maxVideos` |
| `maxImageSizeMB` | **10 MB** | `Setting.showcase.maxImageSizeMB` |
| `maxVideoSizeMB` | **50 MB** | `Setting.showcase.maxVideoSizeMB` |
| `allowedImages` | jpeg, jpg, png, webp | `Setting.showcase.allowedImages` |
| `allowedVideos` | mp4, webm, quicktime | `Setting.showcase.allowedVideos` |

> **Poore project me size limit sirf yahan hai.** Baaki har media endpoint
> unlimited size accept karta hai — §8.1.

#### 19 — add-media (bulk)

[services/showcases/addSectionMedia.js](../services/showcases/addSectionMedia.js)

```
resolveSectionForActor()     ← ownership: vendor apna brand, admin koi bhi
normalizeFiles(files.files)  ← single file ya array, dono handle
validateMediaFiles()         ← count + mime + size, existing count ke saath
uploadMultipleMedia()        ← ek-ek karke serial upload (parallel nahi)
$push medias
coverImage auto-set          ← sirf pehli baar, aur sirf agar mode !== MANUAL
```

Kahin bhi fail ho → `rollbackUploads(uploaded)` sab uploaded assets Cloudinary
se hata deta hai. `Promise.allSettled` use hota hai, isliye ek delete fail hone
par baaki nahi rukte.

Mime type se hi decide hota hai ki PHOTO hai ya VIDEO — `file.mimetype.startsWith("image")`
/ `("video")`. Kuch aur ho to `400 "Unsupported media type."`.

#### 20 — media update (custom video poster)

[services/showcases/updateSectionMedia.js](../services/showcases/updateSectionMedia.js)

- `thumbnail` sirf **VIDEO** par allowed — photo par `422`.
- `validateThumbnailFile()` — image hona chahiye, `allowedImages` me hona chahiye, `maxImageSizeMB` se chhota.
- Upload → `save()` → tab purana poster delete. Save fail ho to naya poster rollback.
- Purana poster tabhi delete hota hai jab wo **vendor ne khud upload kiya tha** — `isCustomThumbnail()` check karta hai:
  - PHOTO ka thumbnail uska apna `url` hota hai → delete karne se media hi mar jaayega
  - VIDEO ka default poster video ke apne `publicId` ka transformation hota hai → wahi baat
  - Sirf alag se upload kiya gaya poster delete hota hai

#### 21 — media replace

[services/showcases/replaceSectionMedia.js](../services/showcases/replaceSectionMedia.js)

- **Exactly 1 file**, warna `400`.
- Type match hona chahiye — photo ki jagah photo, video ki jagah video. Ye check **upload se pehle** mime type par chalta hai (pehle upload ke baad chalta tha, to har reject hui request ek upload + rollback ki cost deti thi).
- Media ka `_id`, `sortOrder`, settings sab same rehte hain — sirf `url`, `thumbnail`, `storage`, `metadata` badalte hain.
- `syncSectionCoverImage()` cover recompute karta hai.
- Save ke **baad** purana asset + uska custom poster delete.

#### 22 — media delete

[services/showcases/deleteSectionMedia.js](../services/showcases/deleteSectionMedia.js)

- **Soft delete** — row `isDeleted: true` ke saath rehti hai.
- Cloudinary asset **sach me destroy** hota hai (+ custom poster bhi).
- Section me kam se kam 1 live media rehna chahiye — aakhri wala delete nahi hota (`400`).

#### 23 — section delete (bulk)

[services/showcases/deleteFullSection.js](../services/showcases/deleteFullSection.js)

- `deleteAllMedia(section.medias)` — **saare** assets destroy (`Promise.allSettled`).
- Cloudinary failure delete ko block nahi karti (`try/catch` + `console.error`).
- Phir sab media aur section soft-delete, aur plan ka showcase slot release.

### 3.8 Voucher images + voucher banner

| # | Method + Path | Gate | Form field | Operation |
|---|---|---|---|---|
| 24 | `POST /vouchers/create` | `isVendorOrAdmin` | `images` (multi) + `bannerImage`/`bannerVideo`/`bannerGif` | **upload** |
| 25 | `PUT /vouchers/update/:voucherId` | `isVendorOrAdmin` | `newImages` (multi) | **add / remove** |
| 26 | `POST /vouchers/:voucherId/banner` | `isVendorOrAdmin` | `bannerImage` \| `bannerVideo` \| `bannerGif` | **set / replace** |
| 27 | `DELETE /vouchers/:voucherId/banner` | `isVendorOrAdmin` | — | **delete** |

#### Voucher images (`images` / `newImages`)

Helper: [helpers/vouchers/validateImagesFiles.js](../helpers/vouchers/validateImagesFiles.js)

- Sirf `image/*` allowed (`mimetype.startsWith("image/")`) — koi specific format list nahi, **koi size limit nahi**.
- Max count `getVoucherConfig().maxImages` se aata hai (`Setting.voucher.maxImages`, default **5**).
- Create par kam se kam 1 image **mandatory** (`422`).
- Serial upload; beech me fail ho to `uploadVoucherImages` apne hi uploaded images rollback karke `500` deta hai.
- Images `VoucherVersion.images[]` par baithti hain, `Voucher` par nahi.

**Update ka behaviour version-status par depend karta hai** —
[services/vouchers/updateVoucher.js](../services/vouchers/updateVoucher.js):

| Case | Purani removed images ka kya hota hai |
|---|---|
| Version **DRAFT / REJECTED** (in-place edit) | `removedImagesToDelete = removedImages` → commit ke baad Cloudinary se **delete** |
| Version **PUBLISHED** (naya version fork hota hai) | **delete nahi** — purana version wahi images reference karta rehta hai |

Transaction abort ho to `rollbackVoucherImages(uploadedImages)` naye uploads hata deta hai.

#### Voucher banner (master-level, version flow se bilkul alag)

[constants/voucherBanner.js](../constants/voucherBanner.js) — banner ka apna
type system hai, `constants/banner.js` se **jaan-boojh kar independent**:

| `bannerType` | form field | DB subdoc field | Allowed mime |
|---|---|---|---|
| `IMAGE` | `bannerImage` | `banner.image` | jpeg, jpg, png, webp |
| `VIDEO` | `bannerVideo` | `banner.video` | mp4, webm, quicktime |
| `GIF` | `bannerGif` | `banner.gif` | gif |

Helper: [helpers/vouchers/voucherBannerMedia.js](../helpers/vouchers/voucherBannerMedia.js).
Order banner/ticker jaisa: upload → `save()` → purana delete; save fail ho to naya rollback.
`27` par banner clear hota hai aur asset destroy hota hai.

---

## 4. PDF documents — dusri pipeline (user upload nahi)

Ye poori tarah alag hai. Koi request file nahi bhejti — **server khud PDF banata
hai**. 6 tarah ke documents hain, ek hi renderer, ek hi public link.

### 4.1 Kaise banta hai

[helpers/documents/renderDocument.js](../helpers/documents/renderDocument.js)

```
renderDocumentPdf(snapshot)
   → os.tmpdir()/trydood-documents/document_<ts>_<rand>.pdf
   → PDFKit stream se likhta hai
   → { filePath, fileName } return

generateAndUploadDocument(snapshot)
   → renderDocumentPdf()
   → uploadPDF(filePath, fileName)     ← Cloudinary "Documents/", resource_type: auto
   → finally: fs.promises.unlink(filePath)   ← chahe upload chale ya fail ho
```

> `uploadPDF` khud bhi ek `fs.unlinkSync` karta hai
> ([services/uploads/index.js:38](../services/uploads/index.js#L38)), aur
> `generateAndUploadDocument` ka `finally` doosra. Double cleanup deliberate
> safety hai — dono `existsSync` / `.catch(() => {})` ke saath guard hain.

Renderer **kisi bhi kind par branch nahi karta**. Har document apna frozen
`snapshot` carry karta hai (`models/documentSnapshotSchema.js`) jisme printed
blocks pehle se worded hote hain.

### 4.2 6 document kinds

[constants/document.js](../constants/document.js)

| Kind | Series | Kahan issue hota hai | Record + field |
|---|---|---|---|
| `VOUCHER_CLAIM` | `VCH` | [helpers/voucherClaims/settleVoucherClaimPayment.js:490](../helpers/voucherClaims/settleVoucherClaimPayment.js#L490) | `Transaction.invoiceSnapshot` |
| `SUBSCRIPTION` | `SUB` | [helpers/subscribeds/settleSubscriptionPayment.js:367](../helpers/subscribeds/settleSubscriptionPayment.js#L367) | `Transaction.invoiceSnapshot` |
| `SUBSCRIPTION_GRANT` | `GRT` | [services/subscribeds/adminGrantSubscription.js:240](../services/subscribeds/adminGrantSubscription.js#L240) | `Transaction.invoiceSnapshot` |
| `PAYOUT_STATEMENT` | `STL` | [helpers/settlements/issueSettlementDocument.js](../helpers/settlements/issueSettlementDocument.js) | `Settlement.documentSnapshot` |
| `REFUND` | `REF` | [helpers/refunds/issueRefundDocument.js](../helpers/refunds/issueRefundDocument.js) | `RefundRequest.documentSnapshot` |
| `CHARGEBACK` | `DBN` | [helpers/disputes/issueChargebackDocument.js](../helpers/disputes/issueChargebackDocument.js) | `Dispute.documentSnapshot` |
| *(COMMISSION)* | `CMN` | payout statement ke andar embedded tax invoice | — |

### 4.3 PDF **issue** hone par nahi banti — pehli baar maangne par banti hai

Ye design decision important hai:

- **Issue time** par sirf **number** allot hota hai (`generateDocumentNumber`) aur
  snapshot + 32-byte random `documentToken` record par likha jaata hai. **Koi PDF
  nahi banti, Cloudinary par kuch nahi jaata.**
- **Pehli baar** koi `GET /documents/:token` hit karta hai, tab PDF render + upload
  hoti hai aur URL record par cache ho jaata hai
  ([services/documents/getDocumentByToken.js:134-146](../services/documents/getDocumentByToken.js#L134-L146)).
- Uske baad har request cached URL return karti hai — dobara upload nahi.

Wajah: har claim/payout/refund ki PDF banana scale par nahi chalta aur zyadatar
kabhi khuli hi nahi jaati. Number pehle allot hota hai taaki series me gap na ho.

### 4.4 Document endpoints

| # | Method + Path | Gate | Operation |
|---|---|---|---|
| 28 | `GET /documents/:token` | **PUBLIC — koi JWT nahi** | lazy render + upload + cache |
| 29 | `POST /transactions/invoice/regenerate` | `isVendorOrAdmin` | **forced re-render + re-upload** |

- **28** — deliberately unauthenticated. Link WhatsApp/email se khulta hai jahan
  browser ke paas session nahi hota. Token hi credential hai. Galat token aur
  na-mile token — dono ka same `404`.
- **29** — [services/transactions/regenerateInvoice.js](../services/transactions/regenerateInvoice.js).
  **Sirf Transaction-backed documents re-issue ho sakte hain** (subscription,
  grant, claim). Refund receipt, payout statement aur chargeback advice ke liye
  **koi re-issue endpoint nahi hai** — isliye unka issuer fail ho to
  `alertDocumentFailed` hi ekmatra recovery path hai.

### 4.5 Issuer ka contract

Har `issue*Document` helper paisa move hone ke **baad** chalta hai, isliye:

- **Kabhi throw nahi karta** — missing PDF ke liye completed refund ya finished payout fail karna kahin zyada bura hai.
- **Silent bhi nahi** — har ek `alertDocumentFailed()` call karta hai (per-record deduped, aur alert khud wrapped hai taaki alert ka failure bhi handler se escape na kare).
- **Idempotent** — pehle `if (documentNumber) return null`, aur write bhi conditional (`{ documentNumber: { $exists: false } }`) taaki do racing webhooks dono number allot na kar sakein.
- **Number sabse aakhir me allot hota hai** — pehle saare lookups, kyunki `generateDocumentNumber` shared counter aage badhata hai aur beech me throw hone se series me hole ban jaata hai.

### 4.6 Ek aur PDF path — email attachment (script)

[scripts/sendDocumentVerificationMails.js:787-829](../scripts/sendDocumentVerificationMails.js#L787-L829)

- `renderDocumentPdf()` se PDF banata hai `os.tmpdir()/trydood-doc-verify/` me
- **Cloudinary par upload nahi karta** — seedha `sendMail({ attachments: [{ filename, path }] })`
- Ye ek maintenance/QA script hai, runtime path nahi. `nodemailer` ka `attachments`
  option poore codebase me sirf yahi use karta hai.

---

## 5. Media jo store hota hai par **hum upload nahi karte**

Ye important hai — inhe media upload samajh kar dhoondhna waqt ki barbadi hai.

| Kya | Kahan | Source |
|---|---|---|
| `imageUrl` broadcast notification me | [services/notifications/broadcastNotification.js:37](../services/notifications/broadcastNotification.js#L37) → `notifyAudience` → FCM `notification.image` | Admin ek **URL string** bhejta hai (`Joi.string().uri().max(1024)`). Koi upload nahi. |
| FCM push image | [helpers/push/fcmClient.js:147](../helpers/push/fcmClient.js#L147) | Upar wala hi URL forward hota hai |
| `DEFAULT_IMAGES.*` | [constants.js:293](../constants.js#L293) | Hardcoded Cloudinary URLs — §8.6 |
| Postman fixture URLs | [scripts/seedPostmanFixtures.js](../scripts/seedPostmanFixtures.js) | `res.cloudinary.com/demo/...` — Cloudinary ke public demo assets, seed ke waqt string likh di jaati hai |
| `Setting.appConfig.storeUrl` | [models/Setting.js:813](../models/Setting.js#L813) | App store links, media nahi |

WhatsApp (`configs/whatsapp.js`, `helpers/whatsapp/`) aur email
(`helpers/nodeMailer/`) — **koi media header, image ya attachment support nahi**
(script wale attachment ko chhod kar). Sab text + link based hai; documents
`GET /documents/:token` link ke roop me jaate hain, file ke roop me nahi.

---

## 6. Har media field — model ke hisaab se

| Model | Field | Shape | Kis endpoint se likha jaata hai |
|---|---|---|---|
| `User` | `image` | `String` (URL) | `POST /auth/register`, `PUT /users/update` |
| `Customer` | `image` | `String` | `PUT /users/update` (User se mirror) |
| `Brand` | `logo` | `String` | `PUT /brands/update` |
| `Brand` | `coverImage` | `String` | ⚠️ **kahin se nahi** — §8.7 |
| `SubBrand` | `logo`, `coverImage` | `String` | ⚠️ **kahin se nahi** — §8.7 |
| `BrandFeatures` | `icon` | `String` | `POST/PUT /brandFeatures/*` |
| `Category` | `image` | `String` (default set) | `POST/PUT /categories/*` |
| `SubCategory` | `image` | `String` (default set) | `POST/PUT /subCategories/*` |
| `Banner` | `image` / `video` / `gif` | `{url, storage}` subdoc | `POST/PUT /banners/*` |
| `PromotionalTicker` | `icon` | `{url, storage}` subdoc | `POST/PUT /promotionalTickers/*` |
| `ShowcaseSection` | `medias[]` | `{type, url, thumbnail, storage, metadata, title, altText, sortOrder, ...}` | `/showcase/section/:id/*` |
| `ShowcaseSection` | `coverImage` | `String` | auto — `syncSectionCoverImage()` |
| `VoucherVersion` | `images[]` | `{url, storage, sortOrder}` | `POST /vouchers/create`, `PUT /vouchers/update/:id` |
| `Voucher` | `banner.{image,video,gif}` | `{url, storage}` subdoc | `POST/DELETE /vouchers/:id/banner` |
| `Transaction` | `invoiceUrl` | `String` (PDF) | lazy render / regenerate |
| `RefundRequest` | `documentUrl` | `String` (PDF) | lazy render |
| `Settlement` | `documentUrl` | `String` (PDF) | lazy render |
| `Dispute` | `documentUrl` | `String` (PDF) | lazy render |

### `storage` subdocument ka shape

```js
storage: {
  provider: "CLOUDINARY" | "S3",   // hamesha CLOUDINARY likha jaata hai
  publicId: String,                 // Cloudinary public id
  bucket:   null,                   // S3 ke liye reserved
  key:      null,                   // S3 ke liye reserved
}
```

`deleteMedia()` isi `provider` par switch karta hai; `S3` case abhi **khaali
`return`** hai ([helpers/showcases/upload.js:53](../helpers/showcases/upload.js#L53)).

---

## 7. Rollback patterns — 3 alag approaches

Project me media rollback ke **teen** alag patterns hain. Naya code likhte waqt
domain ka pattern follow karein.

### Pattern A — "upload → save → purana delete" (sabse safe)

Banner, ticker, voucher banner, brand feature, showcase.

```js
const newMedia = await upload(file);       // naya pehle
try { await doc.save(); }
catch (e) { await deleteNew(newMedia); throw e; }   // save fail → naya hata do
await deletePrevious(previousMedia);        // save ke baad hi purana hatta hai
```

Koi bhi step fail ho, user ka purana media zinda rehta hai.
`__tests__/money/mediaUploadRollback.test.js` isi line ko test karta hai.

### Pattern B — bulk rollback

Showcase add-media, voucher create/update.

```js
let uploaded = [];
try { uploaded = await uploadMultiple(files); /* ... */ }
catch (e) { await rollbackUploads(uploaded); throw e; }
```

`Promise.allSettled` — ek delete fail hone par baaki nahi rukte.

### Pattern C — "purana delete → naya upload" ⚠️ **asymmetric, risky**

Users, categories, subCategories.

```js
if (user.image) await deleteImage(user.image);   // purana pehle hi ja chuka
const imageUrl = await uploadImage(image.tempFilePath);  // ye fail ho to?
```

Upload fail hua to purana **ja chuka** hai aur naya bana nahi — user ke paas
kuch nahi bachta. Detail §8.3 me.

---

## 8. Gaps, risks aur inconsistencies

Ye sab **verify kiye gaye** hain, guess nahi. Har ek ke saath file:line diya hai.

### 8.1 `express-fileupload` par **koi limit nahi**

```js
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
```
[index.js:114](../index.js#L114)

Na `limits.fileSize`, na `limits.files`, na `abortOnLimit`. Iska matlab:

- Sirf **showcase** endpoints par size check hai (10 MB image / 50 MB video), aur
  wo bhi upload ke **baad** — file pehle `/tmp/` par poori likhi ja chuki hoti hai.
- Baaki har media endpoint (user image, brand logo, category image, voucher
  images, banner, ticker) par size **unlimited** hai.
- Ek 5 GB file `/tmp/` bhar sakti hai, aur Render/EC2 par disk full hone se poora
  process girta hai.

**Fix:** `fileUpload({ limits: { fileSize: N }, abortOnLimit: true })`.
Ye ek jagah ka change hai jo har endpoint ko cover karta hai.

### 8.2 `CLOUD_BASE_URL` galat/khaali ho to **har delete chup-chaap skip**

```js
const CLOUD_BASE = process.env.CLOUD_BASE_URL;
const isValidCloudinaryUrl = (url) => url.startsWith(CLOUD_BASE) && url.includes("/upload/");
```
[helpers/cloudinary/index.js:2-8](../helpers/cloudinary/index.js#L2-L8)

- Var unset ho → `startsWith(undefined)` → `"undefined"` string se compare → hamesha `false`
- `deleteFile` `console.log("Skip delete → Not a Cloudinary URL")` karke `false` return karta hai
- **Koi error nahi, koi alert nahi, request 200 deti hai**
- Har delete band, Cloudinary storage bill silently badhta rehta hai

Ye §8.6 ke saath milta-julta hai: **cloud name badalne par purane cloud ke saare
assets permanently orphan ho jaate hain**, kyunki unka URL naye `CLOUD_BASE_URL`
se match nahi karega. `.env` me `CLOUD_NAME=dtpy1lbmf #dbrkf1j5w` — commented
out purana cloud isi migration ka nishaan hai.

### 8.3 Users / categories / subCategories me **delete pehle, upload baad me**

| File | Line |
|---|---|
| [services/users/updateUserById.js:55-57](../services/users/updateUserById.js#L55-L57) | `if (user.image) await deleteImage(user.image); const imageUrl = await uploadImage(...)` |
| [services/categories/updateCategoryById.js:25-27](../services/categories/updateCategoryById.js#L25-L27) | same shape |
| [services/subCategories/updateSubCategoryById.js:59-61](../services/subCategories/updateSubCategoryById.js#L59-L61) | same shape |

`uploadFile` fail par **`throwError(500)`** karta hai
([helpers/cloudinary/index.js:42](../helpers/cloudinary/index.js#L42)) — yaani
ye ek real failure path hai, theoretical nahi.

**Customer ka experience:** profile photo badalne ki koshish ki, Cloudinary ne
timeout diya → "Something went wrong" 500 mila, aur ab unke paas **purani photo
bhi nahi hai**. Refresh karne par blank avatar. Wo photo hamesha ke liye gayi —
DB me `image` field abhi bhi purana URL rakhta hai (kyunki save nahi hua), par wo
URL ab dead hai. Yaani UI toota hua image dikhata hai.

Category/subcategory par bhi wahi — admin image update karta hai, fail hota hai,
aur ab customer app me us category ki tile blank ho jaati hai.

**Fix:** Pattern A (§7) apply karein — upload → save → purana delete.

### 8.4 6 endpoint groups me **koi mime-type check hi nahi**

| Endpoint | File | Check |
|---|---|---|
| `POST /auth/register` | [services/auth/registerUser.js:36](../services/auth/registerUser.js#L36) | ❌ kuch nahi |
| `PUT /users/update` | [services/users/updateUserById.js:56](../services/users/updateUserById.js#L56) | ❌ kuch nahi |
| `PUT /brands/update` (logo) | [services/brands/updateBrand.js:68](../services/brands/updateBrand.js#L68) | ❌ kuch nahi |
| `POST/PUT /brandFeatures/*` (icon) | [services/brandFeatures/addBrandFeature.js:25](../services/brandFeatures/addBrandFeature.js#L25) | ❌ kuch nahi |
| `POST/PUT /categories/*` | [services/categories/createCategory.js:14](../services/categories/createCategory.js#L14) | ❌ kuch nahi |
| `POST/PUT /subCategories/*` | [services/subCategories/createSubCategory.js:24](../services/subCategories/createSubCategory.js#L24) | ❌ kuch nahi |

In sab me file seedha `uploadImage(file.tempFilePath)` chali jaati hai
`resource_type: "image"` ke saath. Cloudinary khud reject kar dega agar file
image nahi hai — lekin tab error `500 "Cloudinary upload failed"` banta hai,
`422 "Only images allowed"` nahi.

**Customer ka experience:** vendor galti se PDF ko logo ki jagah attach kar deta
hai → "Something went wrong, please try again" 500 milta hai. Message kahin nahi
batata ki file galat hai, isliye wo wahi PDF 3-4 baar retry karta hai, phir
support ko likhta hai. Sahi jawab — *"Logo must be a JPG, PNG or WebP image"* —
kabhi nahi milta.

Compare karein: banner/ticker/showcase/voucher-banner sab clean `422` dete hain
expected mime types ki list ke saath.

### 8.5 3 dead functions

[services/uploads/index.js](../services/uploads/index.js) me export hain, poore
codebase me **0 call sites**:

| Function | Line |
|---|---|
| `uploadVideo` | [:24](../services/uploads/index.js#L24) |
| `uploadAudio` | [:16](../services/uploads/index.js#L16) |
| `deletePDF` | [:47](../services/uploads/index.js#L47) |

Iska practical matlab: **project me kahin bhi audio (mp3, wav) upload nahi
hota.** `Audio/` folder Cloudinary par kabhi banega hi nahi. Aur `deletePDF`
na hone ki wajah se **koi bhi generated PDF kabhi delete nahi hoti** — har
invoice, receipt aur statement Cloudinary par permanent hai. Ye galat nahi hai
(documents-of-record hone chahiye bhi), par ye jaan-boojh kar liya gaya faisla
lagta nahi — sirf koi caller likha hi nahi gaya.

### 8.6 `DEFAULT_IMAGES` **purane Cloudinary account** par hain

[constants.js:293-303](../constants.js#L293-L303)

```
DEFAULT_IMAGES.CATEGORY    → res.cloudinary.com/drvdnqydw/...
DEFAULT_IMAGES.SUBCATEGORY → res.cloudinary.com/drvdnqydw/...
```

Par active cloud `.env` me **`dtpy1lbmf`** hai. Do nateeje:

1. **Aaj:** `isValidCloudinaryUrl()` in defaults ko reject kar deta hai (`drvdnqydw`
   `dtpy1lbmf` se start nahi hota), isliye `deleteCategoryById` unhe destroy nahi
   karta. Ye **accident se bacha hua hai**, design se nahi.
2. **Risk:** agar kabhi koi in defaults ko current cloud par re-upload karke
   `constants.js` update karta hai, to `deleteCategoryById` / `deleteSubCategoryById`
   turant **shared default asset destroy karne lagenge** — kyunki:
   ```js
   await deleteImage(category?.image);   // image === shared DEFAULT_IMAGES.CATEGORY
   ```
   Ek category delete karne se **har us category/subcategory ki image toot
   jaayegi jisne apni image kabhi upload nahi ki.** Aur `updateCategoryById` bhi
   wahi karega (§8.3 wala `if (category.image) await deleteImage(...)`).

3. **Aur ek:** `drvdnqydw` account hamare control me hai ya nahi — pata nahi. Wo
   band ho gaya to har default-image wali category/subcategory app me broken
   image dikhayegi.

**Fix:** delete se pehle `if (image !== DEFAULT_IMAGES.CATEGORY)` guard, **aur**
defaults ko current cloud par migrate karna. Dono karne padenge — sirf migrate
karna problem #2 ko live kar dega.

### 8.7 3 media fields jo **kabhi likhe hi nahi jaate**

| Field | Read hota hai | Write |
|---|---|---|
| `Brand.coverImage` | 9 pipelines me project hota hai — `getCustomerBrand`, `getAllCustomerBrands`, `getTopBrands`, `getAllAdminBrands`, `getAllFollowedBrands`, `getAllBrandAvoidances`, `customerListing` | ❌ **koi endpoint nahi** |
| `SubBrand.logo` | model me hai | ❌ koi endpoint nahi |
| `SubBrand.coverImage` | model me hai | ❌ koi endpoint nahi |

Customer app har brand profile aur listing me `coverImage` maangti hai aur
hamesha `null` paati hai. Ya to endpoint missing hai, ya field ko hatana chahiye.

Isi tarah **`ShowcaseSection.coverImageMode`**: `MANUAL` value
`syncSectionCoverImage()` me honour hoti hai
([helpers/showcases/validateMedia.js:232](../helpers/showcases/validateMedia.js#L232))
lekin **koi endpoint use `MANUAL` set nahi karta** — validator me bhi nahi. Yaani
vendor cover pin kar hi nahi sakta; wo hamesha AUTO hi rehta hai.

### 8.8 Delete par media cleanup **inconsistent** hai

| Domain | Record delete | Cloudinary asset |
|---|---|---|
| Showcase media | soft | ✅ destroy |
| Showcase section | soft | ✅ destroy (saare) |
| Brand feature | soft | ✅ destroy |
| Category / SubCategory | soft | ✅ destroy |
| Voucher banner | field clear | ✅ destroy |
| Voucher images (draft version) | replace | ✅ destroy |
| **Banner** | soft | ❌ **rah jaata hai** |
| **Promotional ticker** | soft | ❌ **rah jaata hai** |
| Voucher (poora voucher delete) | — | ❌ koi delete endpoint hi nahi |
| PDF documents | — | ❌ kabhi delete nahi (§8.5) |

Banner aur ticker sabse zyada churn wale content hain (campaign-based, har hafte
badalte hain) — aur wahi do assets peeche chhod jaate hain.
[services/banners/deleteBanner.js](../services/banners/deleteBanner.js) aur
[services/promotionalTickers/deleteTicker.js](../services/promotionalTickers/deleteTicker.js)
me `deleteBannerMedia` / `deleteTickerIcon` ka koi call hi nahi hai — helpers
maujood hain, sirf use nahi hue.

### 8.9 `/tmp/` Windows par exist nahi karta

```js
app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
```

Linux (Render, EC2) par theek hai. Windows dev machine par `/tmp/` current drive
ke root par resolve hota hai (`C:\tmp`) — wo folder hai to chal jaayega, warna
upload fail hoga. `helpers/documents/renderDocument.js` sahi kaam karta hai —
`os.tmpdir()` use karta hai, hardcoded path nahi.

### 8.10 `/tmp/` me har uploaded file ki copy **hamesha ke liye** rah jaati hai

`CLAUDE.md` me already likha hai: *"make sure the unit has a writable `/tmp` and
something clears it"* — **kuch clear nahi karta.**

`express-fileupload` ka `cleanup()` (jo temp file `unlink` karta hai) sirf
**failure paths** par chalta hai — `lib/processMultipart.js` me line `82` (write
error), `109` (size-limit abort), `129` (empty file) aur `154` (file error).
**Success path par `complete()` chalta hai, jo file delete nahi karta**
(`lib/tempFileHandler.js:47-52`).

Library expect karti hai ki aap `file.mv()` call karke file ko move kar denge —
lekin ye codebase kabhi `mv()` call nahi karta. Har jagah `file.tempFilePath`
seedha Cloudinary ko de diya jaata hai aur temp file wahin chhod di jaati hai.

Sirf `uploadPDF` `fs.unlinkSync` karta hai — aur wo bhi apni **khud ki banayi**
PDF ke liye, kisi uploaded file ke liye nahi.

**Yaani: har successful image/video/gif upload ki ek poori copy `/tmp/` me
permanently baithi hai.** Ek 50 MB showcase video upload = 50 MB Cloudinary par
+ 50 MB disk par, hamesha ke liye. Ek instance jo mahino chalti rahe, uski disk
bharegi aur process gir jaayega — aur wajah kisi log me nahi dikhegi.

**Fix ke 3 options:** (a) service me upload ke baad `fs.unlink(tempFilePath)`,
(b) ek middleware jo `res.on("finish")` par `req.files` ki saari temp files
saaf kare, (c) OS-level cron/tmpfiles.d. (b) sabse safe hai kyunki wo har
endpoint ko cover karta hai, aaj ke aur kal ke dono.

---

### 8.11 🔴 `brandFeatures` me ownership check hai hi nahi

Ye poore media surface ka sabse serious gap hai.

| Endpoint | Gate | Actor check | Media asar |
|---|---|---|---|
| `POST /brandFeatures/add` | `isVendorOrAdmin` | ❌ **koi nahi** | kisi bhi brand par icon upload |
| `PUT /brandFeatures/update/:featureId` | `isVendorOrAdmin` | ❌ **koi nahi** | kisi bhi brand ka icon replace |
| `DELETE /brandFeatures/delete/:featureId` | `isVendorOrAdmin` | ❌ **koi nahi** | kisi bhi brand ka icon Cloudinary se destroy |

Controllers service ko `req.userId` / `req.role` / `req.brandId` bhejte hi nahi:

```js
// controllers/brandFeatures/create.js
const result = await addBrandFeature(req.validatedData, req.files?.icon);
//                                   ↑ brandId body se aata hai, actor kahin nahi

// controllers/brandFeatures/deleteFeature.js
const result = await deleteBrandFeature(req.validatedData.featureId);
//                                      ↑ sirf id, aur kuch nahi
```

Aur service sirf itna karti hai:

```js
const brand = await Brand.findOne({ _id: brandId, isDeleted: false });
if (!brand) throwError(404, "Brand not found!");   // "exist karta hai?" — "tumhara hai?" nahi
```

**Matlab:** koi bhi signed-in vendor kisi bhi doosre brand ka feature bana
sakta hai, uska icon badal sakta hai, aur delete karke uska Cloudinary asset
permanently destroy kar sakta hai — sirf `brandId` ya `featureId` jaan kar. Wo
ids customer-facing brand profile API se milti hain.

⚠️ **Route file ka comment kehta hai ye theek hai:**

> *"writes belong to the brand owner or an admin. Before this, a customer's
> token could edit any brand's features — `brandId` arrives in the body, so
> nothing scoped the write."*

Sirf **role** gate theek hua tha (customer → vendor), **ownership** nahi. Comment
padhne wale ko lagta hai dono ho gaya.

Compare karein — baaki har domain me ye check hai:

| Domain | Helper |
|---|---|
| Vouchers, voucher banner | `resolveActorBrand(actor, voucher.brandId)` |
| Showcase (saare 9 endpoints) | `resolveSectionForActor(actor, sectionId)` |
| **brandFeatures** | **kuch nahi** |

Dono helpers ownership ko `Brand.userId` se verify karte hain, token ke cached
`brandId` se nahi — taaki purana token access widen na kar sake. Fix yahi
pattern hai: controllers `actor` banayein, service `resolveActorBrand` call kare.

### 8.12 🔴 `mimetype` client ka bheja hua hai, file ka nahi

`express-fileupload` busboy se `info.mimeType` leta hai
(`lib/processMultipart.js:63`), jo multipart part ke **client-supplied
`Content-Type` header** se aata hai. File ke bytes kabhi padhe nahi jaate.

Yaani `BANNER_ALLOWED_MIME_TYPES`, `SHOWCASE_MEDIA_CONFIG.allowedImages`,
`TICKER_ICON_ALLOWED_MIME_TYPES` — **teenon allowlists ko caller bypass kar
sakta hai** bas header badal kar:

```
Content-Disposition: form-data; name="image"; filename="x.png"
Content-Type: image/png          ← jhooth. andar kuch bhi ho sakta hai.
```

**Aaj isse bachav Cloudinary kar raha hai**, hum nahi — `resource_type: "image"`
ke saath wo non-image ko reject kar deta hai. Wo ek accident hai, ek design
nahi, **aur S3 par wo bachav nahi rahega**: S3 jo diya jaayega wahi store karega
aur usi content-type se serve karega.

**Fix:** upload se pehle magic bytes se sniff karein (`file-type` package), aur
allowlist **sniffed** type par lagayein — bheje gaye header par nahi. Provider ko
bhi wahi sniffed type diya jaaye.

### 8.13 🟠 Voucher images me SVG allowed hai

```js
if (!mimeType || !mimeType.startsWith("image/")) throwError(400, ...);
```
[helpers/vouchers/validateImagesFiles.js:22](../helpers/vouchers/validateImagesFiles.js#L22)

`image/svg+xml` is check ko pass kar jaata hai. SVG ek XML document hai jisme
`<script>` ho sakta hai.

Aaj `res.cloudinary.com` se serve hota hai — cross-origin, to panel ka session
usse nahi milta. **Apne CloudFront/S3 domain par serve karte hi ye stored XSS
ban jaata hai**, khaas kar agar CDN kabhi panel ke same domain ka subdomain ho.

Showcase, banner, ticker aur voucher-banner me ye problem nahi hai — un sabme
explicit allowlist hai. Sirf voucher images (aur §8.4 wale 6 endpoints jinme
koi check hi nahi) prefix-match par chalte hain.

### 8.14 🟠 PDF ka storage URL public, permanent, aur `Math.random()` se guessable

```js
const fileName = `document_${Date.now()}_${Math.floor(Math.random() * 10000)}.pdf`;
// ...
public_id: fileName.replace(".pdf", "")
```
[renderDocument.js:193](../helpers/documents/renderDocument.js#L193) →
[services/uploads/index.js:36](../services/uploads/index.js#L36)

Teen baatein ek saath:

1. **`Math.random()`** — `CLAUDE.md` saaf kehta hai: *"Never `Math.random()` for
   anything a stranger benefits from guessing."* V8 ka generator seeded nahi hai
   aur uski state outputs se recover ho sakti hai.
2. **URL public hai.** Cloudinary ka `Documents/` folder public delivery par hai.
   Jise URL mil gaya, use document mil gaya — `documentToken` beech me aata hi
   nahi.
3. **URL revoke nahi ho sakta.** `regenerateInvoice` ka apna comment kehta hai:
   *"The raw storage URL above cannot be revoked; this one resolves through the
   token and can be."* — aur wahi function `previousUrl` caller ko return bhi
   karta hai.

In documents me naam, address, GSTIN aur amounts hote hain. `documentToken` ka
poora design (32 random bytes, revocable, `404` for a bad token) is ek layer se
bypass ho jaata hai.

**Fix S3 me natural hai:** private bucket + `crypto.randomUUID()` key + sirf
short-TTL presigned GET. Tab token sach me ek credential ban jaata hai.

### 8.15 🟡 Uploads serial hain — 15 images = 15 sequential round trips

```js
exports.uploadMultipleMedia = async (files = []) => {
  const uploaded = [];
  for (const file of files) {
    const media = await exports.uploadSingleMedia(file);   // ek-ek karke
    uploaded.push(media);
  }
  return uploaded;
};
```
[helpers/showcases/upload.js:30-37](../helpers/showcases/upload.js#L30-L37)

Wahi shape `uploadVoucherImages` me bhi hai
([validateImagesFiles.js:36](../helpers/vouchers/validateImagesFiles.js#L36)).

Showcase ek section me **15 items** allow karta hai. Har upload ka apna TLS
handshake + transfer hai, to 15 images ka matlab 15 sequential round trips — jab
ye aaram se 4-5 ke batches me parallel ho sakte hain.

⚠️ Ise theek karte waqt dhyan: rollback abhi is baat par tika hai ki `uploaded`
array me sirf wahi hain jo **safal** hue. Parallel karte waqt `Promise.allSettled`
chahiye, `Promise.all` nahi — warna ek fail hone par baaki ke safal uploads ka
handle hi kho jaayega aur wo orphan ban jaayenge.

### 8.16 🟡 Delivery URL me koi size nahi — mobile list ko full-resolution image jaati hai

```js
exports.getOptimizedImageUrl = (publicId) =>
  cloudinary.url(publicId, { fetch_format: "auto", quality: "auto" });
```
[helpers/cloudinary/index.js:46-51](../helpers/cloudinary/index.js#L46-L51)

`f_auto,q_auto` format aur compression sambhaal leta hai, par **dimensions
nahi**. Ek 4000×3000 ka upload customer ke voucher list card par bhi 4000×3000
hi jaata hai — bas WebP me.

Aur videos ko to ye bhi nahi milta: `uploadVideoWithMetadata` seedha
`result.secure_url` return karta hai, koi transformation nahi. Ek 50 MB `.mp4`
showcase feed me jaisa hai waisa hi jaata hai — na transcode, na adaptive
streaming, na poster-only preload.

**Ye "get bhi fast ho" wali baat ka asli jawab hai** — aur S3 migration me ye
aur bigadta hai, kyunki Cloudinary `f_auto,q_auto` **free** deta hai aur S3 kuch
nahi deta. Bina resizing layer ke S3 par shift delivery ko **dheema** karega.
Options `environment_and_services_map.md` ke **D-2** me hain.

---

## 9. Quick reference — file map

```
configs/
  cloudinary.js                    ← SDK client, env config

helpers/cloudinary/
  index.js                         ← uploadFile, deleteFile, getOptimizedImageUrl
                                     + isValidCloudinaryUrl, extractPublicId

services/uploads/
  index.js                         ← *** SINGLE ENTRY POINT ***
                                     uploadImage, uploadImageWithMetadata,
                                     uploadVideoWithMetadata, uploadPDF,
                                     deleteImage, deleteAudioOrVideo
                                     (+ 3 dead: uploadVideo, uploadAudio, deletePDF)

helpers/banners/media.js           ← uploadBannerMedia, deleteBannerMedia
helpers/promotionalTickers/media.js← uploadTickerIcon, deleteTickerIcon
helpers/showcases/upload.js        ← uploadSingleMedia, uploadMultipleMedia,
                                     deleteMedia, deleteAllMedia, rollbackUploads,
                                     isCustomThumbnail, deleteCustomThumbnail
helpers/showcases/validateMedia.js ← normalizeFiles, validateMediaFiles,
                                     validateThumbnailFile, syncSectionCoverImage
helpers/vouchers/validateImagesFiles.js  ← uploadVoucherImages, rollbackVoucherImages
helpers/vouchers/voucherBannerMedia.js   ← uploadVoucherBannerMedia, deleteVoucherBannerMedia

helpers/documents/
  renderDocument.js                ← renderDocumentPdf, generateAndUploadDocument
  generateDocumentNumber.js        ← series counter
  alertDocumentFailed.js           ← issuer failure alert
  layout.js, format.js             ← PDFKit primitives

constants/
  banner.js                        ← BANNER_TYPE, MEDIA_FIELD, ALLOWED_MIME_TYPES
  voucherBanner.js                 ← VOUCHER_BANNER_* (independent from banner.js)
  promotionalTicker.js             ← TICKER_ICON_ALLOWED_MIME_TYPES
  showcase.js                      ← SHOWCASE_MEDIA_CONFIG, STORAGE_PROVIDER
  document.js                      ← DOCUMENT_KIND, DOCUMENT_SERIES, titles
constants.js                       ← DEFAULT_IMAGES

__tests__/money/
  mediaUploadRollback.test.js      ← banner + ticker rollback contract
  documentRender.test.js           ← PDF renderer
  voucherInvoice.test.js, refundDocument.test.js,
  settlementStatement.test.js, chargebackDocument.test.js
```

---

## 10. Naya media endpoint add karte waqt checklist

1. **Constants** — `constants/<domain>.js` me `ALLOWED_MIME_TYPES` add karein. Bina iske `uploadImage` par jaana matlab §8.4 wali problem dobara.
2. **Helper** — `helpers/<domain>/media.js` banayein `upload*` + `delete*` pair ke saath. Mime check helper me, service me nahi.
3. **Service** — **Pattern A** (§7): upload → save → purana delete. Pattern C kabhi nahi.
4. **Delete path** — record delete karne wale service me asset delete bhi likhein (warna §8.8 ki list lambi hoti hai).
5. **Size limit** — showcase ki tarah `Setting` se padhein, ya kam se kam constant se. `express-fileupload` aapko cover nahi karega (§8.1).
6. **Rollback test** — `__tests__/money/mediaUploadRollback.test.js` ka pattern follow karein: upload/delete helpers mock karke assert karein ki DB fail hone par `delete*` call hua.
7. **Docs + Postman** — `docs/endpoints_category.md` me row, role-doc me section, matching collection me request + captured example. `node scripts/verifyApiCoverage.js` teenon check karta hai.
