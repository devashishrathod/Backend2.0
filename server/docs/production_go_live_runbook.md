# Production go-live — Cloudinary se S3 par, kadam-dar-kadam

> **Ye doc kya hai:** production ko Cloudinary se S3 par le jaane ka **operational
> sequence** — kram, har kadam ka verify, aur wapas aane ka raasta.
>
> **Ye doc kya nahi hai:** AWS ka setup. Bucket, IAM, CloudFront, CORS, lifecycle
> — har `aws` command [aws_s3_setup.md](./aws_s3_setup.md) me hai. Ye doc maanta
> hai ki wo ho chuka.
>
> ⚠️ **Is doc ki har takneeki baat code se verify karke likhi gayi hai** — file
> aur line number ke saath, taaki jo padhe wo khud dekh sake. Jahan naap liya gaya
> hai, uski taareekh likhi hai.
>
> **Aakhri baar verify: 2026-09-19**

---

## 0. Ek line me

Production par jaane ke liye **is server me ek line code badalne ki zarurat nahi
hai**. Jo chahiye wo do cheezein hain: AWS ka infra tayyar ho, aur admin panel me
ek dropdown badle. Baaki sab pehle se likha aur test kiya hua hai.

---

## 1. Do switch hain, ek nahi — ye pehle samajh lein

`Setting.storage` me **do alag knob** hain, aur inhe ek samajhna sabse aam galti
hai:

| Knob | Kya tay karta hai | Default |
|---|---|---|
| `storage.provider` | Bytes **kahan** jaate hain — `CLOUDINARY` ya `AWS_S3` | seed se |
| `storage.upload.presignEnabled` | Client **kis raaste** bhejta hai — server ke through, ya seedha S3 | `false` |

Ye ek doosre se azaad hain. Iska seedha natija:

> 🔴 **S3 par jaane ke liye client (panel/app) me ek bhi change ki zarurat nahi
> hai.**

`provider = AWS_S3` + `presignEnabled = false` → wahi purana multipart road, wahi
purani API, bas bytes S3 par girte hain. Dono providers ka surface bilkul ek jaisa
hai — [`providers/s3.js`](../services/storage/providers/s3.js) aur
[`providers/cloudinary.js`](../services/storage/providers/cloudinary.js), dono me
`upload` · `remove` · `url`.

Direct-to-S3 (presign) **baad ka** kadam hai — §7.

---

## 2. Provider ka maalik kaun — env ya admin?

**Admin.** Ye baar-baar galat samjha jaata hai, isliye poora saboot:

| Sawaal | Jawab | Kahan |
|---|---|---|
| Runtime par provider kahan se aata hai? | `Setting.storage.provider` | [`services/storage/index.js:47`](../services/storage/index.js) |
| `MEDIA_PROVIDER` env kaun padhta hai? | **Sirf ek jagah** — Mongoose ka `default()` | [`models/Setting.js:996`](../models/Setting.js) |
| Wo `default()` kab chalta hai? | Sirf jab `Setting` document **pehli baar bane** | Mongoose ka behaviour |
| Redeploy se provider badalta hai? | ❌ **Nahi** | wahi — default sirf create par |

Iska apna test bhi hai — `__tests__/unit/storage.test.js:401`:
*"The admin panel decides this, not a redeploy."*

### 🔴 Par production DB **fresh** hai — aur yahan ek khatra hai

Fresh DB ka matlab: `Setting` document **pehli baar wahan banega**. Us waqt jo
`MEDIA_PROVIDER` hoga, wahi provider ban jaayega — aur wo **preflight se nahi
guzrega**, kyunki preflight sirf panel se provider badalne par chalta hai
([`services/settings/updateSetting.js:242`](../services/settings/updateSetting.js)).

> ⚠️ Yaani agar production `MEDIA_PROVIDER=AWS_S3` ke saath pehli baar boot hua
> aur CloudFront tayyar nahi hai, to platform **S3 par live ho jaayega aur har
> image 403 degi** — bina kisi rukawat ke, bina kisi warning ke.

**Isliye niyam:**

> 🔴 **Production ka pehla boot `MEDIA_PROVIDER=CLOUDINARY` par hona chahiye.**
> S3 par baad me **panel se** jaana — tabhi preflight rakshak ban jaata hai.

---

## 3. Env — production par kya hona chahiye

| Variable | Production value | Zaroori? |
|---|---|---|
| `MEDIA_PROVIDER` | `CLOUDINARY` (pehle boot par — §2) | ✅ |
| `CLOUD_NAME` · `CLOUD_API_KEY` · `CLOUD_SECRET` | Cloudinary account | ✅ jab tak Cloudinary chal raha hai |
| `CLOUD_BASE_URL` | `https://res.cloudinary.com/<cloud>` | ✅ (Joi me `required`) |
| `AWS_REGION` | `ap-south-1` | ✅ S3 ke liye |
| `S3_BUCKET_PUBLIC` | `trydood-prod-public` | ✅ S3 ke liye |
| `S3_BUCKET_PRIVATE` | `trydood-prod-private` | ✅ S3 ke liye |
| `S3_PREFIX` | *(khaali)* | prod par khaali — prefix sirf nonprod ko baantne ke liye hai |
| `CDN_BASE_URL` | **prod** distribution ka domain | ✅ (§5 dekhein) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | EC2 par **nahi** (instance role), Render par haan | host ke hisaab se |
| `MAX_UPLOAD_SIZE_MB` | `100` | ✅ — restart chahiye |

**Bucket ke naam code me kahin hardcode nahi hain** —
[`configs/s3.js:42-60`](../configs/s3.js) unhe `S3_BUCKET_PUBLIC` /
`S3_BUCKET_PRIVATE` se padhta hai, aur na mile to `500` deta hai (default nahi
leta — warna invoice public bucket me gir sakti thi). Isliye **prod buckets ke
liye koi code change nahi**, sirf env.

### ⚠️ `MAX_UPLOAD_SIZE_MB` restart maangta hai

[`index.js:157`](../index.js) use **boot par ek baar** padhta hai aur
`express-fileupload` ke `limits.fileSize` me daal deta hai
([`index.js:176`](../index.js)). Ye transport ka ceiling hai — disk bachane ke
liye. Per-surface limits alag hain aur wo **live** hain (`Setting.storage.limits`).

### ⚠️ Credentials ka kram ek jaal hai

SDK ki chain: explicit → env keys → shared config → ECS → EC2 metadata.
**Env keys instance role ko haraate hain.** EC2 par role laga kar purani Render
keys env me chhod dena = server galat identity par chup-chaap chalta rahega, jab
tak wo key revoke na ho. Isi liye boot par ek line chhapti hai
([`configs/s3.js:83`](../configs/s3.js), `index.js:267` se):

```
✅ [s3] trydood-prod-public / trydood-prod-private · ap-south-1 · credentials: instance role or shared config
```

Production me env key mili to wo `⚠️` ke saath chhapti hai aur saaf-saaf kehti
hai ki kya hatana hai.

---

## 4. Kram — kya pehle, kya baad me

> ## ✅ CloudFront zinda hai — 2026-09-22 ko live naapa gaya
>
> | | |
> |---|---|
> | prod CDN | `https://cdn.trydood.com` |
> | nonprod CDN | `https://d3hfpe4kcf7s6s.cloudfront.net` |
> | prefix | `dev/` · `stg/` · prod me khaali |
>
> Non-prod par poora round trip chal chuka hai, asli code se:
>
> ```
> checkS3Ready()              ✅ ok: true
> upload → CDN unsigned GET   ✅ 200, bytes byte-for-byte wahi
> delete                      ✅ S3 se sach me gaya
> private url()               ✅ null       signed GET ✅ 200
> private anonymous           ✅ 403        url() throw ✅
> staging/dev/…  CDN se       ✅ 403
> ```
>
> 🔒 **Prod bucket yahan se verify nahi ho saka, aur wo sahi hai:**
> `trydood-app-nonprod` user ko `trydood-prod-public` par `s3:PutObject` ka
> access nahi hai. IAM separation kaam kar rahi hai. Prod ka verification switch
> ke din `checkS3Ready()` prod ke apne role se karega.

### Abhi kahan khade hain — 2026-09-19 ko naapa gaya

| Cheez | Haalat |
|---|---|
| Chaaron buckets (`prod` + `nonprod`, public + private) | ✅ **ban chuke hain**, `ap-south-1` me |
| Block Public Access, dono public buckets par | ✅ **ON** — CloudFront + OAC ke liye yahi sahi hai |
| IAM policy ka daayra | ✅ tang — `s3:ListBucket` nahi diya gaya |
| Backend code (Phase 0–5) | ✅ poora |
| **CloudFront + DNS** | ❌ **nahi bana** — `cdn.trydood.com` resolve nahi hota |
| `Setting.storage.provider` | `CLOUDINARY` |

> 🔴 **Bacha sirf CloudFront + DNS.** Buckets ka kaam ho chuka hai — wo sawaal
> ("prod buckets abhi banayein ya baad me") ab khatam hai.

```
  1. AWS buckets + IAM        → ✅ HO CHUKA
  2. Non-prod CloudFront      → aws_s3_setup.md §3   ← ab yahan hain
  3. Non-prod par REHEARSAL   → §5   ← sabse zaroori kadam
  4. Prod CloudFront + DNS    → wahi steps, naam alag
  5. Prod env set + deploy    → §3   (MEDIA_PROVIDER abhi bhi CLOUDINARY)
  6. Panel se switch          → §6
  7. Verify                   → §6.3
  ── yahan ruk jaayein, kuch din chalne dein ──
  8. Presign on + client      → §7   (X-3)
```

> 🔴 **Kadam 2 ko mat chhodein.** Non-prod par poora rehearse kiye bina prod par
> jaana matlab CloudFront ka shape (OAC, `staging/*` deny, ACM cert ka region)
> pehli baar production par aazmana.

---

## 5. Non-prod rehearsal

Yahan wo sab hota hai jo prod par **nahi** hona chahiye.

### 5.1 🔴 Pehle ek galat config theek karein

Naapa gaya **2026-09-19**, dev machine par:

```
S3_BUCKET_PUBLIC   trydood-nonprod-public     ✅
S3_PREFIX          dev/                       ✅
CDN_BASE_URL       https://cdn.trydood.com    🔴 ye PROD distribution ka CNAME hai
```

[aws_s3_setup.md §3](./aws_s3_setup.md) me **do alag distributions** banti hain —
ek prod bucket par, ek nonprod par. `cdn.trydood.com` pehli wali ka hai.

Aaj ye khamosh hai (`cdn.trydood.com` resolve hi nahi hota, DB me 0 S3 rows). Par
dono live hote hi dev ka har upload row par ye likhega:

```
https://cdn.trydood.com/dev/images/categories/<id>/<uuid>.png
         └── prod distribution        └── key nonprod bucket me hai → 404
```

Aur URL row par **likhne ke waqt** banta hai, padhte waqt dobara nahi — to har
aisi row baad me haath se theek karni padegi.

**Fix:** non-prod deploy par `CDN_BASE_URL` = **non-prod** distribution ka domain.

### 5.2 Rehearsal ki checklist

- [ ] Non-prod CloudFront banaya, origin `trydood-nonprod-public`, OAC ke saath
- [ ] `staging/*` par deny laga — **aur ek asli key se naap kar dekha**, sirf
      policy padh kar nahi. Yahi wo jagah hai jahan ye chup-chaap khula reh gaya
      tha: policy sahi likhi thi, par key ka shape `dev/staging/…` tha
- [ ] `staging/` par lifecycle rule (1 din) — **ek hi rule**, kyunki `staging/`
      sabse upar hai
- [ ] `CDN_BASE_URL` non-prod domain par set, deploy hua
- [ ] Boot log me `[s3]` line sahi buckets aur region dikha rahi hai
- [ ] Panel se `provider = AWS_S3` — **save hua** (preflight pass)
- [ ] Har tarah ka upload: image · GIF · video + poster · PDF
- [ ] Sab **dikh** rahe hain (browser me, panel me, app me)
- [ ] Ek upload **delete** kiya — S3 se sach me gaya
- [ ] Private PDF: link milta hai aur khulta hai; wahi link bina sign kiye 403 deta hai
- [ ] `provider = CLOUDINARY` par **wapas** — bina preflight, turant (§8)
- [ ] Wapas aane ke baad bhi S3 wale purane media **abhi bhi dikh rahe hain**

---

## 6. Production switch

### 6.1 API

```
PUT /trydood/v1/settings/update        (ADMIN only)

{ "storage": { "provider": "AWS_S3" } }
```

Route: [`routes/settings.js:11`](../routes/settings.js) (`isAdmin` +
`validateUpdateSetting`). Prefix `/trydood/v1` [`index.js:212`](../index.js) se,
aur `/settings` filename se auto-mount hota hai
([`routes/index.js`](../routes/index.js)). Documented:
[endpoints_category.md:1339](./endpoints_category.md).

### 6.2 Save par apne aap kya hota hai

`provider` **badal raha ho** aur target `AWS_S3` ho, tabhi
[`updateSetting.js:242`](../services/settings/updateSetting.js) `checkS3Ready()`
chalata hai. Wo teen cheezein karta hai
([`services/storage/preflight.js`](../services/storage/preflight.js)):

| # | Kya | Kyun |
|---|---|---|
| 1 | **Dono** buckets me ek chhota object likho, padho, mitao | Read-only check jhooth bolte hain: `HeadBucket` ko `s3:ListBucket` chahiye jo policy jaanboojh kar nahi deti; `GetObject` missing key par `AccessDenied` deta hai — jo tooti policy jaisa hi dikhta hai |
| 2 | Public bucket me ek object likh kar use **bina credentials** fetch karo | Signed request ye sawaal hi nahi puchta ki **customer** padh sakta hai ya nahi. Block Public Access on ho to step 1 pass hota hai aur har `<img>` 403 deta hai |
| 3 | Object mitao | `finally` me — probe fail ho sakta hai, kachra chhod nahi sakta |

⚠️ Delivery probe `staging/` me **nahi** likhta — distribution ko `staging/*` deny
karna hai, to wahan probe karna **sahi** CloudFront par bhi fail hota. Wo
`<prefix>images/__preflight/` me likhta hai, jahan asli media rehta hai
([`preflight.js:111`](../services/storage/preflight.js)).

**Fail hone par save hota hi nahi** — `422` aata hai, `Cannot switch to AWS_S3: …`
ke saath, aur wajah usme likhi hoti hai (galat key vs policy missing vs DNS).

> 🔴 Delivery ka fail **warning nahi, refusal hai**. Ek warning padh kar aage
> badha jaata hai — aur uska natija platform ki har image, video aur GIF ka us
> dropdown ke save hote hi 403 dena hai, bina kisi log ke jo dono ko jode.

### 6.3 Save ke baad verify

- [ ] Response ka message padha — warnings usi me aate hain ([`controllers/settings/update.js:19`](../controllers/settings/update.js))
- [ ] `GET /trydood/v1/settings/get` → `storage.provider = "AWS_S3"`
- [ ] Ek naya image upload → row me URL CDN wala hai
- [ ] Wahi URL **incognito** me khulta hai
- [ ] Ek video + poster upload → dono dikhte hain
- [ ] Ek PDF (invoice) → link khulta hai; **bina sign kiye** wahi key 403 deti hai
- [ ] Purana Cloudinary media **abhi bhi dikh raha hai** (§8)
- [ ] Ek naya upload delete kiya → S3 se gaya
- [ ] Ek purana Cloudinary asset delete kiya → Cloudinary se gaya

### 6.4 Ek warning jo aa sakti hai, aur wo theek hai

`CDN_BASE_URL` khaali ho to preflight **warning** deta hai (refusal nahi):
*"CloudFront is not configured… images will be served at their original size."*

Matlab: upload, delete, delivery sab chalenge — bas **resize nahi hoga**, yaani
4 MB ka original phone par jaayega 40 KB thumbnail ki jagah.

> ⚠️ Par production ke liye main ise **suggest nahi karta**, aur wajah permanent
> hai: URL row par likhne ke waqt banta hai. Aaj raw S3 URL par gaye to aaj se
> CloudFront aane tak ki **har row hamesha** raw S3 par point karti rahegi —
> unhe resize kabhi nahi milega, aur bucket ko hamesha public rakhna padega.
> Ek din ka shortcut, permanent do-tarah ka data.

---

## 7. Presign (direct-to-S3) — baad ka kadam

Ye **X-3** hai aur client ka kaam maangta hai. Isliye §6 ke kuch din baad.

```
{ "storage": { "upload": { "presignEnabled": true } } }
```

| Baat | Code |
|---|---|
| Default `false` | [`models/Setting.js:1038`](../models/Setting.js) |
| Off par presign `503` — aur message multipart ka raasta bhi batata hai | [`presign.js:78`](../services/storage/presign.js) |
| Platform S3 par na ho to `409` | [`presign.js:102`](../services/storage/presign.js) |
| `intentTtlMinutes` < `presignTtlMinutes` par save `422` | `helpers/settings/assertStorageLimitRule.js` |

> 🔴 **Cloudinary par `presignEnabled` kabhi on mat karein.** Presign sirf S3 par
> likhta hai (`@aws-sdk/s3-presigned-post`; Cloudinary ka koi equivalent nahi).
> On karne par ek hi surface ke kuch row S3 par aur kuch Cloudinary par baith
> jaate — sirf is hisaab se ki client ne kaunsa road liya. Ab wo ho nahi sakta
> (`409`), par setting ka matlab yahi hai.
> ([`services/storage/index.js:299`](../services/storage/index.js))

⚠️ **`confirm` ye flag jaan-bujh kar nahi padhta.** Switch off karte waqt jinke
paas valid signature hai aur jinki file S3 par ja chuki hai, unka confirm chalega
— wo bytes kharch ho chuke hain. Switch darwaza band karta hai, andar wale ko
phansata nahi.

---

## 8. Wapas aana (rollback)

### Turant hai, aur koi preflight nahi

```
{ "storage": { "provider": "CLOUDINARY" } }
```

`PROVIDERS_NEEDING_PREFLIGHT` me **sirf `AWS_S3`** hai
([`preflight.js:262`](../services/storage/preflight.js)) — to wapas jaana bina
kisi round trip ke, turant save ho jaata hai. Ye jaan-bujh kar hai: incident ke
waqt wapas aana kabhi kisi probe par nahi atakna chahiye.

### 🔴 Purana media **nahi tootta** — na switch par, na rollback par

`provider` setting sirf **naye** uploads ka raasta batati hai. Kisi maujooda asset
ko padhna ya delete karna hamesha **us row ke apne** `storage.provider` ko follow
karta hai ([`services/storage/index.js:60`](../services/storage/index.js)):

```js
const name = asset?.storage?.provider ?? STORAGE_PROVIDER.CLOUDINARY;
```

Matlab:

| Row kab bani | Switch ke baad | Rollback ke baad |
|---|---|---|
| Cloudinary par | ✅ chalti hai | ✅ chalti hai |
| S3 par | ✅ chalti hai | ✅ **chalti hai** |
| Purani row, koi `storage` field hi nahi | ✅ Cloudinary maan li jaati hai | ✅ wahi |

Naapa gaya **2026-09-18**: DB me **458 Cloudinary URLs, 0 S3, 0 cdn**. Un 458 ko
**koi migration nahi chahiye** — wo `res.cloudinary.com` par hain aur Cloudinary
zinda hai.

⚠️ Rollback ke baad S3 par bani rows Cloudinary par **nahi** chali jaatin. Wo S3
par hi rehti hain aur wahi se serve hoti hain — isi liye bucket aur CloudFront ko
rollback ke baad bhi zinda rakhna hai.

---

## 9. Jo is server me **abhi bhi likhna baaki** hai

> Ye poora sach hai, code se verify karke — 2026-09-19.

| Kaam | Backend code bacha? | Kya, theek-theek |
|---|---|---|
| Prod buckets (B-2) | ❌ | **Ban chuke hain.** Code ko bataane ke liye sirf env — naam kahin hardcode nahi |
| Provider switch | ❌ | Ek dropdown |
| **X-1** CloudFront + resize | ❌ | Backend ka hissa ho chuka. `?w=` client jodta hai; repo me koi width/allowlist/srcset logic hai hi nahi. GIF ko resize se bachana key ke prefix (`gifs/`) se hota hai, aur G2 ke baad `kind` verified bytes se banta hai |
| **X-2** metadata Lambda | ✅ **haan** | `mediaSchema` par `pending` flag nahi · hourly retry sweep job nahi (par `jobs/index.js` + `jobLock` maujood) · Lambda se DB tak ka raasta tay nahi (endpoint hua to naya route + 3 docs + Postman) |
| **X-3** client presign | ❌ | Doc + Postman tayyar; ek setting |
| **X-4** multipart hatana | ✅ haan — **roka hua** | Cloudinary ka ekmatra upload raasta yahi hai; sunset tabhi jab Cloudinary ka apna presign ship ho |

**Lambda ka source is repo me nahi hai** — koi `lambda/`, `infra/` ya
`terraform/` folder maujood nahi.

🔴 **X-2 S3 ko rokta nahi.** Wo **sirf video duration** ke liye hai. Images ke
`width`/`height` G3 me server par hi ban jaate hain — wahi 1 KB jo signature ke
liye padha jaata hai, dimensions bhi de deta hai. To X-2 se pehle bhi images poori
tarah theek, videos chalti aur dikhti hain, bas duration `0:00` rehti hai.

---

## 10. Jaldi dekhne ke liye

| Sawaal | Jawab |
|---|---|
| Provider ka maalik? | `Setting.storage.provider` — admin panel. Env sirf pehla document seed karta hai |
| S3 ke liye client change? | ❌ nahi — jab tak presign off hai |
| Prod buckets ke liye code change? | ❌ nahi — sirf env |
| Switch galat nikla to? | Turant wapas, bina preflight. Purana media dono taraf chalta rehta hai |
| Switch galat config par ho sakta hai? | ❌ nahi — preflight `422` deta hai, save hota hi nahi |
| CloudFront ke bina S3 chalega? | Haan, par bucket public karna padega — **aur wo faisla permanent hai** (§6.4) |
| Invoice/PDF public ho jaayenge? | ❌ nahi — wo private bucket me hain, link har request par sign hota hai |

---

## Sambandhit docs

| Doc | Kya |
|---|---|
| [aws_s3_setup.md](./aws_s3_setup.md) | AWS ka poora setup — bucket, IAM, CloudFront, har command |
| [master_execution_plan.md](./master_execution_plan.md) | §0.5 storage ka locked faisla · Block X · O-1…O-4 |
| [s3_migration_phases.md](./s3_migration_phases.md) | Phase 0-9, har phase ke edge cases |
| [environment_and_services_map.md](./environment_and_services_map.md) | Har env var, tier-wise |
| [setting_fields_reference.json](./setting_fields_reference.json) | Har setting field ka matlab aur cross-field rules |
