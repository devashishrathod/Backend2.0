# Showcase Rules + Upload — Final Design & Execution Plan

> 📌 **Master plan ab [master_execution_plan.md](./master_execution_plan.md) hai** —
> poore bache hue kaam ka single source (storage, media, showcase, voucher, upload,
> infra). **Phase numbering wahan se lein** — is doc ke `P-0` / `SC-*` / `U-*` wahan
> `F-1` / `S-*` / `U-*` ban gaye hain, aur purana `SC-0` (cover `.mp4`) ab `M-4` me
> hai. Neeche ka **design** poora valid hai; sirf phase naam badle hain.

> **Status:** design **LOCKED aur approved**. Showcase ka code (Block **S**) abhi
> shuru nahi hua — wo Block F aur M ke baad aata hai; order master plan me hai.
>
> Related: [s3_migration_phases.md](./s3_migration_phases.md) · [aws_s3_setup.md](./aws_s3_setup.md) ·
> [media_upload_map.md](./media_upload_map.md) · [s3_media_migration_plan.md](./s3_media_migration_plan.md)
>
> Har claim neeche code se verify kiya gaya hai. Jahan "aaj aisa hai" likha hai,
> file aur line di gayi hai.

---

## 0. Locked decisions

| # | Faisla | Value |
|---|---|---|
| **S-1** | "3 items" ka matlab | **Customer-visible count** — `isActive && !isDeleted`. Isse `isActive:false` wala bypass apne aap band |
| **S-2** | Section guarantee | **Dono** — (a) kam se kam 1 section *exist* karega, (b) kam se kam 1 section *visible flags* ke saath rahega. Teeno raaste guard honge: delete, `isVisible:false`, `isActive:false` |
| **S-3** | ADMIN exemption | **Har showcase floor se exempt.** Asli rule customer-read filter hai; write guards sirf vendor ke liye guardrail hain — to admin ko rokna moderation todta hai, rule nahi |
| **S-4** | Customer payload me position | **`sortOrder` key hi overwrite** hogi (display position 1..n). App me zero change |
| **S-5** | Deleted media ka `sortOrder` | **Chhod denge** — 0 karna model ke default se collide karta |
| **S-6** | Clips API khaali par | **Empty list**, 404 nahi. Gallery endpoint se consistent |
| **S-7** | GIF ka type | **`PHOTO`** rahega — par ab wo derive hota hai, stored nahi (M-4: `showcaseTypeOf`). `media.kind` me `GIF` sach likha rehta hai, aur usi se file `gifs/` prefix me jaati hai, resize step se door |
| **S-8** | Managed reads | Naya derived read-only field **`customerVisibility { isLive, reasons[] }`** |
| **S-9** | Optimistic locking | `ShowcaseSection` par **`__v` wapas on**; `VersionError` → **409** |
| **S-10** | Legacy (1–2 media) sections | Customer view se **turant gayab**. Grandfather flag nahi. Delete phir bhi allowed |
| **S-11** | Floor ka enforcement kahan | **Computed (`$expr`), denormalized counter nahi.** Koi nayi state, koi drift nahi, koi backfill nahi |
| **S-12** | Stored `sortOrder` ka scope | **Dense 1..n over non-deleted** (hidden bhi shaamil). Customer position alag se compute hoti hai |
| **S-13** | `sortOrder` request me | `createSection` / `updateSection` se **hata denge** — positions sirf reorder endpoint ki property (media update me pehle se aisa hi hai) |
| **S-14** | Media reorder ka scope | **Non-deleted sab** (aaj sirf live). Section reorder pehle se aisa hi hai — symmetry |
| **S-15** | `getSetting()` | **TTL cache + update par invalidate.** Aaj har read ek write hai — public endpoints par config lagane se pehle zaruri |
| **S-16** | Video poster (cover) | Cover **hamesha ek image** hogi. `.mp4` cover ban hi nahi sakta — Cloudinary aur S3 dono par |

Pehle se locked (pichle sessions me): Route A (middleware verify + facade `acceptUpload`) ·
E1 file+uploadId dono → 422 · E2 purpose mismatch → 422 · E5 `updateBrand` ka upload
transaction ke bahar · pehli surface = category · array ka naam `uploadIds` ·
showcase me GIF = haan · quota presign par bhi check · **video poster VIDEO par
schema-level mandatory** (purana "option C / flag" superseded — master §1.5) ·
Problem 1 = **B** · Problem 2 = floor se neeche
wale legacy section phir bhi delete ho sakte hain.

---

# Part A — Showcase business rules

## A.1 Design ka core: read filter hi asli rule hai

Ye poore design ka sabse zaruri paragraph hai.

"Section me 3 media mandatory" do tarike se enforce ho sakta hai:

1. **Write par** — vendor ko 3 se neeche jaane hi na do.
2. **Read par** — 3 se kam media wala section customer ko dikhayo hi mat.

Sirf (1) kaam nahi kar sakta, kyunki `createSection` **khaali section** banata hai
([createSection.js:69](../services/showcases/createSection.js#L69)) — 0 media wala
section pehle din se maujood hai. Isliye (2) lazmi hai. Aur jab (2) maujood hai, to
(1) ek **guardrail** ban jaata hai — vendor ko galti se apna section chhupa lene se
rokne ke liye — na ki security boundary.

Isi se S-3 nikalta hai: **admin ko har floor se exempt karna safe hai.** Admin ek
media hata de aur section 2 par aa jaye, to customer use dekhega hi nahi — rule
khud-ba-khud bacha rehta hai.

## A.2 "Live section" — ek hi definition

Ek section customer ko tabhi dikhega jab **chaaron** sach hon:

```
!isDeleted            operational
isActive === true     vendor ka apna on/off
isVisible === true    vendor ka public switch
visibleMedia >= minItemsPerSection    naya (S-1)
```

jahan `visibleMedia` = `medias.filter(m => m.isActive && !m.isDeleted).length`.

Pipeline me:

```js
// helpers/showcases/projections.js
exports.customerSectionMatch = (brandObjectId, { minItems = 0 } = {}) => {
  const match = { brandId: brandObjectId, isDeleted: false, isActive: true, isVisible: true };
  if (minItems > 0) {
    match.$expr = { $gte: [{ $size: { $filter: { input: "$medias", as: "m",
      cond: exports.visibleMediaCondition("m") } } }, minItems] };
  }
  return match;
};
```

`$expr` index nahi use karta, par query pehle se `brandId` par scoped hai aur ek brand
ke paas plan-capped (~10) sections hain jinme ≤15 media — cost shunya. Agar kabhi
profiling maange, escape hatch denormalized `liveMediaCount` field hai; abhi nahi
(S-11) kyunki wo ek nayi state hai jo drift kar sakti hai.

## A.3 `sortOrder` — do alag numbers, ek naam

Yahi wo cheez hai jisne aapko 1,3 dikhaya tha.

| | Stored `sortOrder` | Customer `sortOrder` |
|---|---|---|
| Kis par dense | **non-deleted** items (hidden bhi shaamil) | **visible** items |
| Kaun likhta hai | server, har add/delete/reorder par | kabhi likha nahi jaata — read par compute |
| Kaun dekhta hai | vendor/admin panel | customer app |

Do alag numbers rakhne ka faayda: hidden section ko wapas on karne par uski jagah
wahi rehti hai jahan vendor ne chhodi thi, aur customer ko phir bhi kabhi gap nahi
dikhta.

**Aaj ka behaviour jo tootega aur theek hoga:**

| Jagah | Aaj | Locked |
|---|---|---|
| [`getNextMediaSortOrder`](../helpers/showcases/validateMedia.js#L165) | `max(sortOrder) + 1` — **deleted bhi count** karta hai | `count(non-deleted) + 1`, phir resequence |
| [`deleteSectionMedia`](../services/showcases/deleteSectionMedia.js) | renumber nahi karta → stored me gap | soft-delete ke baad baaki 1..n |
| [`deleteFullSection`](../services/showcases/deleteFullSection.js) | sibling sections renumber nahi hote | baaki sections 1..n |
| [`createSection`](../services/showcases/createSection.js#L52) | `last.sortOrder + 1` — deletes ke baad number badhte jaate hain | `count(non-deleted) + 1` |
| [`reorderSectionMedia`](../services/showcases/reorderSectionMedia.js#L37) | sirf **live** media 1..n — inactive apna purana number rakhte hain → **collision** jab wapas on ho | **non-deleted sab** (S-14) |
| [`updateSection`](../services/showcases/updateSection.js#L55) | raw `sortOrder` accept — duplicate/99 set ho sakta hai | field hata (S-13) |
| `updateSectionMedia` | `sortOrder` accept nahi karta | ✅ pehle se sahi — yahi pattern sab jagah |

**Concurrency:** renumber poore media array ka read-modify-write hai, aur
`ShowcaseSection` par abhi **`versionKey: false`** hai
([model:131](../models/ShowcaseSection.js#L131)). Do simultaneous delete duplicate
order chhod sakte hain. S-9: `__v` on, aur
[errorHandler.js](../middlewares/errorHandler.js) me `VersionError` → 409 (aaj wo
500 par girta hai — koi branch nahi hai).

## A.4 Setting me kya add hoga

`Setting.vendor.showcase` me:

| Field | Default | Guard |
|---|---|---|
| `minItemsPerSection` | `3` | `min: 1`, aur **≤ `maxItemsPerSection`** |
| `minSectionsPerBrand` | `1` | `min: 1` |
| `allowedImages` | `+ "image/gif"` | — |
| `maxGifSizeMB` | `15` | `min: 1` — GIF bade hote hain, 10 MB image cap kam padta hai |

Cross-validation `validator/setting.js` me aur model-level pe dono jagah, kyunki
admin panel se aane wala update aur seeder dono ise tod sakte hain.

`getShowcaseConfig()` me `minItems`, `minSections`, `maxGifSizeMB` expose honge —
wahi re-shaping jo baaki fields ki hai.

> ⚠️ Admin ke liye doc me warning: `minItemsPerSection` 3 se 5 karte hi har 3–4
> media wala section customer se turant gayab ho jayega. Code isse rok nahi sakta.

## A.5 Write guards — poori table

Naya `helpers/showcases/guards.js` — ek jagah, taaki rule 9 services me drift na kare.

| Service | Naya guard | Error |
|---|---|---|
| `deleteSectionMedia` | visible count `< minItems` ho jaye to rok | 400 · "Is section me kam se kam N media chahiye. Pehle naya media add karein, ya poora section delete karein." |
| `updateSectionMedia` (`isActive:false`) | wahi floor | 422 · same shape |
| `deleteFullSection` | brand ke non-deleted sections `< minSections` | 400 · "Brand ka kam se kam ek section hona chahiye." |
| `updateSection` (`isVisible:false`) | is section ke alawa koi aur section visible-flags ke saath bache | 422 · "Ye brand ka aakhri dikhne wala section hai." |
| `updateSection` (`isActive:false`) | wahi check | 422 · same |
| `addSectionMedia` | kuch nahi — add se count badhta hai | — |
| `replaceSectionMedia` | kuch nahi — type-locked, count same | — |

Sab par **ADMIN exempt** (S-3).

> Note: "aakhri visible section" ka check **flags** par hai, media count par nahi.
> Media count par karna asambhav hai — brand ka pehla section hamesha 0 media se
> shuru hota hai, to koi bhi aisa guard pehle din hi impossible state banata.

## A.6 Customer reads — before / after

Teeno customer reads aaj **stored** `sortOrder` project karte hain:
[getBrandsAllShowcase.js:55](../services/showcases/getBrandsAllShowcase.js#L55) ·
[getCustomerBrand.js:203](../services/brands/getCustomerBrand.js#L203) ·
`customerMediaFields` → `sortOrder: "$$m.sortOrder"`.

**Baad me:**

```
1. $match   customerSectionMatch(brandId, { minItems })   ← naya $expr
2. $sort    { sortOrder: 1, createdAt: 1 }                 ← stored order
3. filter + sort media ($sortArray)                        ← pehle se hai
4. $project + $facet                                       ← pehle se hai
5. JS: sections.forEach((s, i) => s.sortOrder = skip + i + 1)
       s.medias.forEach((m, j) => m.sortOrder = j + 1)      ← naya
```

Step 5 JS me kyun, pipeline me nahi: `$setWindowFields` / `$documentNumber` is
codebase me kahin use nahi hota, aur sections ≤50 × media ≤15 par JS ka cost
shunya hai. Mongo version par koi nayi dependency nahi banti.

**Clips feed:** media apne section se nikal kar flat ho jaata hai, to per-section
position ka koi matlab nahi bachta. Wahan `sortOrder` payload se **hata denge**
(`customerMediaFields({ withSortOrder: false })`) — feed ka apna order hi order hai.

## A.7 API-by-API — kya dikhega (final)

### Managed — `isVendorOrAdmin` (VENDOR + ADMIN; **SUB_VENDOR ko access nahi**)

| Endpoint | Kya badlega |
|---|---|
| `POST /section/add` | `sortOrder` request se hata; server `count+1` deta hai. Section khaali banta hai (aaj jaisa) → customer ko tab tak nahi dikhega jab tak N media na ho |
| `GET /section/get/:sectionId` | `+ customerVisibility { isLive, reasons[] }`. Media list jaisi hai waisi (deleted chhod kar sab) |
| `GET /section/get-all` | `+ customerVisibility` har row par |
| `PUT /section/update/:sectionId` | `sortOrder` hata. `isVisible:false` / `isActive:false` par aakhri-section guard |
| `PUT /section/:brandId/reorder` | koi change nahi — pehle se non-deleted sab par 1..n |
| `DELETE /section/delete/:sectionId` | `minSectionsPerBrand` guard + bache hue sections ka renumber |
| `POST /:sectionId/add-media` | GIF allowed; `updateOne` → `save()` (version guard); start = `count+1`, phir resequence |
| `PATCH …/media/update/:mediaId` | `isActive:false` par media floor guard |
| `PUT …/media/replace/:mediaId` | GIF allowed. Baaki same |
| `PUT …/media/reorder` | **scope badla** — ab non-deleted sab chahiye, sirf live nahi |
| `DELETE …/media/delete/:mediaId` | floor `1` hardcoded → `minItemsPerSection` config se; baaki media ka renumber |

### Customer — public

| Endpoint | Kya dikhega |
|---|---|
| `GET /showcase/get-brand-showcase/:brandId` | Sirf **live sections** (A.2 ki chaaron shart). `sortOrder` = display position `skip+i+1`. Har media ka `sortOrder` = `j+1`. Khaali = empty list |
| `GET /showcase/:brandId/video-clips` | Section: live + `isShowVideosInClips`. Media: `VIDEO && isActive && !isDeleted && isShowInVideoClips`. **Incomplete sections ab exclude** (naya). Clip ka `sortOrder` payload se hata. Khaali = **empty list** (aaj 404) |
| `GET /brands/customer/...` → `showcase` | Wahi live-section filter. `sortOrder` re-sequenced. Har section me pehle **6** media (`MEDIA_PREVIEW_PER_SECTION`) + `hasMoreMedia` — aaj jaisa |

### `isVisible` / `isShowVideosInClips` / `isShowInVideoClips` — final semantics

| Switch | Level | Asar |
|---|---|---|
| `isVisible` | section | Poora section customer se hide — profile aur gallery dono se. **Aakhri visible section par block** |
| `isActive` | section | Bilkul wahi asar (customer match dono maangta hai). Isliye ispar bhi wahi guard |
| `isShowVideosInClips` | section | Us section ke **saare videos** clips feed se hide. Album me rehte hain |
| `isShowInVideoClips` | media | Sirf **ek video** clips feed se hide. Album me rehta hai. VIDEO-only — model hook + `prepareMediaDocuments` + `updateSectionMedia` (422) teeno jagah enforce ✅ |
| `isActive` | media | Customer se hide, vendor ko dikhta hai. **Ab floor guard ke peeche** |

## A.8 Contract changes — panel team ko batane hain

1. `POST /section/add` aur `PUT /section/update` ab `sortOrder` accept **nahi** karenge (422 agar bheja). Position sirf reorder endpoint se.
2. `PUT …/media/reorder` ab **non-deleted sab** media maangta hai (aaj sirf live). Panel ke paas ye list pehle se hai — `getSection` deleted ke alawa sab deta hai.
3. Naya response field `customerVisibility` managed reads par.
4. `GET /:brandId/video-clips` khaali par ab **200 + empty list**, 404 nahi.
5. Customer reads me `sortOrder` ka matlab badal gaya — ab display position hai, stored value nahi. Value use karne wala koi logic ho to batayein.

---

# Part B — Upload flow

## B.1 Do raaste, ek hi manzil

Dono raaste chalte hain. ⚠️ Multipart ka sunset **waqt par nahi** hai — wo
Cloudinary ke apne presign ke baad hoga (master §0.5); purana "Phase 5 + 6 hafte"
wala window hata diya gaya.

```
Raasta 1 (multipart)                 Raasta 2 (presigned)
client → multipart → server          client → presign → S3 (direct)
       → req.files                          → confirm par uploadId
            \                                        /
             → describeIncoming  ← surface ke apne rules yahan chalte hain,
             |                      aur upload abhi kharch nahi hua
             → storage.acceptUpload
             → { url, storage, metadata }
                          ↓
                 same media subdocument
```

🔴 **Ab dono raaste ek hi function se guzarte hain** — `acceptUpload`. Pehle ye
diagram do alag entry point dikhata tha; uska matlab hota har surface me apni
`if` ugti, aur unnees `if` matlab unnees mauke ek me purpose check karne aur agle
me bhool jaane ke.

Dono ka **return shape ek** hai, isliye showcase/category/brand services ko farak
nahi padta ki file kaise aayi.

## B.2 Presign → upload → confirm

```
1. POST /uploads/presign        { purpose, contentType, sizeBytes, fileName }
   → { uploadId, url, fields, expiresInSeconds, stagingKey, typePrefix }
   Server: purpose valid? · kind surface par allowed? · size cap? · quota?
   Signed policy: eq $key · content-length-range 1..maxBytes · eq $Content-Type

2. POST <url>  (S3 par seedha, multipart form)
   fields sab PEHLE, file SABSE AAKHIR me — S3 file ke baad ka field ignore karta hai

3. Surface API ko uploadId bhejo:
   POST /showcase/section/:id/add-media   { uploadIds: [...] }
   Server (middleware → facade):
     Upload row _id + userId dono se milta hai   ← doosre ka id load hi nahi hota
     purpose match?                              ← galat surface → 422, upload bachi rehti hai

     agar client pehle /uploads/confirm bula chuka hai:
       row ka storage + verified wahin se padh lo  ← S3 ko chhuo hi mat
     warna:
       HeadObject                                ← file aayi bhi thi?
       ranged GET 1 KB → identify(bytes)         ← asli type, header nahi
       kind vs purpose                           ← avatar presign karke video nahi
       CopyObject staging/ → images|videos|gifs/ ← MetadataDirective: REPLACE
       conditional findOneAndUpdate(consumedAt:null) ← do confirm ki race

     conditional findOneAndUpdate(attachedAt:null) ← 🔴 ek upload, ek row
```

> 🔴 **Guard `attachedAt` par hai, `consumedAt` par nahi.** Pehle dono ek hi field
> tha, aur us wajah se wo sequence — client confirm kare, phir surface ko id de —
> jo har panel doc batati hai, **kabhi chal hi nahi sakti thi**: surface ko `409
> "That upload has already been used."` mil jaata, ek hi baar upload ki gayi file
> par. Showcase samet saari 11 presigned surfaces par tha.

✅ **Ye sab ban chuka hai** — U-1 me route, controller, validator aur facade
(`acceptUpload` / `acceptUploads`), U-3 me `describeIncoming` aur showcase surface.
[presign.js](../services/storage/presign.js) · [confirm.js](../services/storage/confirm.js) ·
[inspect.js](../services/storage/inspect.js) · [accept.js](../services/storage/accept.js) ·
[Upload.js](../models/Upload.js) · [routes/uploads.js](../routes/uploads.js).

## B.3 Showcase ka poora example

Aapka case: **2 video + unke 2 thumbnail + 3 image = 5 media, 7 file.**

### Raasta 1 — multipart (aaj jaisa, `req.files`)

```
POST /showcase/section/:sectionId/add-media
Content-Type: multipart/form-data

files            = video_a.mp4      ← index 0
files            = image_1.jpg      ← index 1
files            = video_b.mp4      ← index 2
files            = image_2.png      ← index 3
files            = image_3.gif      ← index 4
thumbnailFor_0   = poster_a.jpg     ← index se bandha
thumbnailFor_2   = poster_b.jpg
```

Pairing **index se** hai, naam se nahi — isliye kisi aur video ka poster attach ho
hi nahi sakta. Server rules:

- `thumbnailFor_N` ka `N` `files` array ke andar hona chahiye → warna 422
- `files[N]` ka type `VIDEO` hona chahiye → photo par thumbnail 422 (wahi rule jo
  [updateSectionMedia.js:62](../services/showcases/updateSectionMedia.js#L62) me pehle se hai)
- har `N` sirf ek baar → duplicate 422
- thumbnail khud image hona chahiye aur `maxImageSizeMB` ke andar
  (`validateThumbnailFile` pehle se maujood hai)
- **Poster mandatory hai** — `mediaSchema` par VIDEO ke liye schema-level, pehle din
  se. Bina poster wala video **422**. Koi `requireVideoThumbnail` setting nahi
  (purana option-C flag superseded — master §1.5)

### Raasta 2 — presign (naya)

```
1. 7 baar POST /uploads/presign  (parallel)
   purpose: SHOWCASE_MEDIA      × 5
   purpose: SHOWCASE_THUMBNAIL  × 2
   → 7 uploadId

2. 7 direct POST S3 par (parallel)

3. POST /showcase/section/:sectionId/add-media
   {
     "medias": [
       { "uploadId": "u1", "thumbnailUploadId": "t1" },   ← video_a + poster_a
       { "uploadId": "u2" },                              ← image_1
       { "uploadId": "u3", "thumbnailUploadId": "t2" },   ← video_b + poster_b
       { "uploadId": "u4" },                              ← image_2
       { "uploadId": "u5" }                               ← image_3 (gif)
     ]
   }
```

> ### ⚠️ Jo bana wo ye nahi hai — parallel arrays hain, nested objects nahi
>
> Upar ka `medias: [{ uploadId, thumbnailUploadId }]` explicit pairing deta hai,
> jo apne aap me behtar hai. Par is doc ne khud likha tha ki multipart me JSON
> nest nahi ho sakti, yaani **do shapes** maintain karni padengi — ek har raaste
> ke liye.
>
> Jo bana:
>
> ```json
> {
>   "uploadIds":          ["u1", "u2", "u3", "u4", "u5"],
>   "thumbnailUploadIds": ["t1", "t2"]
> }
> ```
>
> ⚠️ Pairing index se hai, **aur har raasta apne andar pair karta hai** —
> `thumbnails[2]` teesri attached file ka poster, `thumbnailUploadIds[0]` pehle
> uploadId ka. Store hone ka kram **files pehle, ids baad me** (wahi kram jo
> `acceptUploads` use karta hai), to sortOrder aur pairing kabhi alag nahi hote.
>
> **Ek hi shape dono raaston par** — multipart `thumbnails[]` index se jodta tha
> aur ab bhi jodta hai; presigned `thumbnailUploadIds[]` bilkul waise hi. Do
> shapes maintain karne se ye saasta hai, aur mila-jula batch bhi ek hi list
> banta hai — jo zaruri hai, kyunki section ki ginti **poore batch** par lagti
> hai, har raaste par alag nahi.
>
> 🔴 Agar explicit pairing chahiye to wo **client-facing** badlaav hai aur uska
> apna faisla hai — abhi wo nahi liya gaya.

**Dono raaste ek hi jagah milte hain** — `addSectionMedia` ko ek normalized list
milti hai `[{ name, mimetype, size, file | uploadId }]`, uske aage sab same.

### Baaki cases

| Case | Multipart | Presign |
|---|---|---|
| Single image | `files = a.jpg` | `medias: [{ uploadId }]` |
| Multiple image | `files` × N | `medias: [{uploadId} × N]` |
| Single video | `files = v.mp4` + `thumbnailFor_0` | `[{ uploadId, thumbnailUploadId }]` |
| Multiple video | `files` × N + `thumbnailFor_0..N-1` | `[{uploadId, thumbnailUploadId} × N]` |
| Mix + GIF | upar wala example | upar wala example |

## B.4 Layering — jo bana, aur kyun alag bana

> ### 🔴 Yahan design se hata gaya hai — jaan-bujh kar, aur wajah ke saath
>
> Pehle jo likha tha (aur "Route A (locked)" kaha tha) wo ye tha:
>
> ```
> middleware     acceptUploads({ purpose })
>                body me uploadIds hon to har ek ko facade se RESOLVE karke
>                req.resolvedUploads me daal deta hai
> ```
>
> Us shape me ek problem hai jo likhte waqt nahi dikhi: **"resolve" ka matlab
> confirm hai, aur confirm ka matlab consume.** Middleware service se pehle
> chalta hai, to jab tak service apne rules tak pahunchti — section bhar chuka
> hai, ye mime hum nahi lete, photo ki jagah photo — tab tak saari uploads
> kharch ho chuki hoti. Vendor ek extra file chunta aur poori batch dobara
> upload karta.
>
> Isliye do hisse alag kiye gaye:
>
> ```
> route          isVendorOrAdmin · requireShowcaseEnabled · validateSchema
>    ↓
> service        describeAllIncoming(actor, { files, uploadIds, purpose })
>                → [{ name, mimetype, size, file | uploadId }]   ← kuch consume nahi
>                surface ke apne rules isi list par chalte hain
>    ↓
> facade         storage.acceptUpload(actor, { file | uploadId, purpose, entityId })
>                → confirmUpload() → { url, storage, metadata }  ← ab consume hota hai
> ```
>
> **Ownership ka cross-cutting check phir bhi ek hi jagah hai** — wahi wajah jo
> middleware ke liye di gayi thi. `describeIncoming` aur `fromIntent` dono
> `_id + userId` se hi row dhoondhte hain, aur dono facade me hain.
>
> ⚠️ Middleware ka ek aur nuksaan: purpose har surface ka apna hai, aur showcase
> me **do** hain ek hi request me (`SHOWCASE_MEDIA` + `SHOWCASE_THUMBNAIL`). Ek
> route-level `acceptUploads({ purpose })` us jodi ko express hi nahi kar sakta.

## B.5 Error matrix

| Kab | Code | Message |
|---|---|---|
| `files` aur `uploadIds` dono (E1) | 422 | "Ek hi tarike se file bhejein — file ya uploadId, dono nahi." |
| uploadId ka purpose match nahi (E2) | 422 | "Ye upload is jagah ke liye nahi tha." |
| uploadId kisi aur ka | 404 | "That upload was not found." (exist/not-exist leak nahi) |
| uploadId pehle use ho chuka | 409 | "That upload has already been used." |
| file S3 par hai hi nahi | 400 | "That file was never uploaded, or has already expired." |
| bytes se type pehchana nahi gaya | 400 | "That file type is not supported." |
| SVG / HTML | 400 | naam ke saath refusal ("SVG … scripts") |
| kind surface par allowed nahi | 422 | "SHOWCASE_MEDIA does not accept PDF files." |
| size cap | 413 | "That file is N MB. The limit here is M MB." |
| quota (presign par bhi) | 400 | wahi message jo aaj `validateMediaFiles` deta hai |
| poster ka id gallery ka nikla (ya ulta) | 422 | "That upload was authorised for SHOWCASE_MEDIA, and this is SHOWCASE_THUMBNAIL. …" |
| photo par thumbnail | 422 | pehle se maujood message |

---

# Part C — Phases

> ⛔ **Is doc ka purana phase plan hata diya gaya hai.**
>
> Wo `P-0` / `SC-0…SC-5` / `U-1…U-4` wali list ab **stale** thi — master plan me
> numbering, order, dependency aur estimation sab badal chuke hain (`SC-0` ab
> `M-4` me hai, `P-0` ab `F-1` hai, `U-*` ka scope bada hai). Do jagah do plan
> rakhna hi wo galti hai jisse purana plan chup-chaap follow ho jaata.
>
> **Phases yahan hain → [master_execution_plan.md](./master_execution_plan.md)**
> (Part 4 = phase map, **Part 4B = har phase ka kaam**, Part 5 = order).
>
> Upar ka **design** (Part A + Part B) poori tarah valid hai — master usi ko
> reference karta hai.

> ⚠️ Ek design correction: Part B ka "thumbnail mandatory = option C (abhi
> optional, `requireVideoThumbnail` flag se mandatory)" **superseded** hai.
> Poster ab `mediaSchema` par VIDEO ke liye **schema-level mandatory** hai —
> pehle din se, bina kisi flag ke. Wajah master §1.5 me: Cloudinary ka
> auto-poster URL toota hua tha. Koi `requireVideoThumbnail` setting nahi banegi.
