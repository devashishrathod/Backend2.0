# S3 Migration — Phase-by-Phase Execution Plan

> 📌 **Ye doc ab historical hai.** Phase 0–4 ship ho chuke; Phase 5–9 ka kaam
> **[master_execution_plan.md](./master_execution_plan.md)** me chala gaya hai,
> jahan wo showcase, voucher aur media-unification ke saath ek hi order me hai
> (`U-*` aur `X-*` blocks). **Naya kaam wahan se lein, yahan se nahi.**
>
> **Status:** Phase 0 ✅ · 1 ✅ · 2 ✅ (step A **aur** B) · 3 ✅ · 4 ✅.
> Phase 5 ka code likha ja chuka hai par **wire nahi hua** (`models/Upload.js`,
> `services/storage/{presign,confirm,inspect}.js` — uncommitted) — wo ab **U-1** hai.
>
> Design + edge cases: [s3_media_migration_plan.md](./s3_media_migration_plan.md)
> **AWS setup runbook: [aws_s3_setup.md](./aws_s3_setup.md)**
> Aaj ka media flow: [media_upload_map.md](./media_upload_map.md)
> Env / services: [environment_and_services_map.md](./environment_and_services_map.md)

---

## 0. Locked decisions

| # | Faisla | Value |
|---|---|---|
| D-1 | Upload raasta | **Presigned POST** direct-to-S3 |
| D-2 / T1 | Image delivery | **CloudFront + resize Lambda**, widths `160/400/800/1600` (allowlist) |
| M-1 / Q-1 | Metadata | **Image: server par sync** (magic bytes + header parse) · **Video duration: Lambda** |
| P-1 / Q-2 | Provider | **S3 default. Cloudinary code + config zinda, env flag se switchable. Koi auto-failover nahi, koi dual-write nahi.** |
| Q-3 | Settings cache | **`getSetting()` par TTL cache**, update par invalidate |
| Q-4 | Interim ceiling | **`.env` → `MAX_UPLOAD_SIZE_MB=100`** (restart chahiye). Live/admin limit presign path par |
| Q-5 | Video metadata | **`metadata.pending` flag + hourly retry sweep** |
| Q-6 | Resize widths | `160 / 400 / 800 / 1600`, **strict allowlist** |
| Q-7 / Q-9 | Infra | Main **Terraform + CLI scripts** likhunga, aap chalayenge. Mere paas AWS console access nahi |
| Q-8 | Multipart sunset | **Phase 5 ship + 6 hafte** |
| L-1 | Limit | Global **100 MB** ceiling. Per-surface limits sirf showcase par (10/50 MB) |
| DB-1 | Data | Sab test data. **Koi migration script nahi** |
| FE-1 | Clients | Panels + app **doosri team** ke paas |
| **B-1** | Bucket split | **Public / private — role se nahi.** Uploader ka role ye batata hi nahi ki file khuli rakhi ja sakti hai ya nahi |
| **B-2** | Bucket count | **4** — `trydood-prod-{public,private}` + `trydood-nonprod-{public,private}`. Dev/staging prefix se alag |
| **B-3** | Credentials | Render par **IAM user key**, AWS par **instance role**. SDK ki default chain dono sambhaalti hai — **code me koi `if` nahi** |
| **B-4** | Order | **Facade pehle**, S3 provider baad me. Step A bina AWS ke ship hota hai |
| **B-5** | Key shape | **`<prefix><type>/<entity>/<entityId>/<uuid>.<ext>`** — type upar (Lambda/lifecycle/GIF), entity andar (orphan sweep). `audio/` abhi nahi |

> Ye chaar [aws_s3_setup.md](./aws_s3_setup.md) me poore detail me hain — wajah,
> policy JSON, aur har `aws` command.

---

## 1. Phase map — ek nazar me

| Phase | Kaam | Client change | Infra | Ship alone | Kis par depend |
|---|---|---|---|---|---|
| **0** ✅ | Temp leak + upload limits — **DONE** | ❌ | ❌ | ✅ | — |
| **1** ✅ | `configs/env/` + Joi + 3 guards — **DONE** | ❌ | ❌ | ✅ | — |
| **2** ✅ | `services/storage` facade + S3 provider · **L-1…L-4 fix — DONE** | ❌ | ❌ | ✅ | 1 |
| **3** ✅ | 6 surfaces ko `storage` sibling field | ❌ | ❌ | ✅ | 2 |
| **4** ✅ | PDF → private bucket + presigned GET | ❌ | 🟡 private bucket | ✅ | 2 |
| **5** → **U-1** | `POST /uploads/presign` + confirm (**dual mode**) | ✅ naya raasta | ❌ | ✅ | 2, 3 |
| **6** → **X-1** | CloudFront + resize Lambda (T1) | 🟡 URL shape | ✅ | ✅ | 2 |
| **7** → **X-2** | Metadata Lambda + retry sweep (M-1) | ❌ | ✅ | ✅ | 5 |
| **8** → **X-3** | Panel + app migrate | ✅ | ❌ | — | 5, 6 |
| **9** → **X-4** | Multipart + `express-fileupload` delete | ❌ | ❌ | ✅ | 8 |

**Phase 0-4 me doosri team ko kuch nahi karna.** Unka contract **U-1** par milta hai.

**Infra ka lead time:** Q-7 me tay hua tha ki main Terraform likhunga. Baad me ye
**console + CLI runbook** ban gaya — [aws_s3_setup.md](./aws_s3_setup.md) — kyunki
4 bucket + 2 policy ek baar ka kaam hai aur Terraform state sambhaalne ka bojh
uske faayde se zyada hai. Runbook me har `aws` command likhi hai.

**Phase 2 step A ko AWS ki zarurat nahi** — facade Cloudinary par banega aur
L-1…L-4 wahin marenge. Bucket step B par chahiye. Yaani aap runbook chala rahe
hon, tab bhi Phase 2 shuru ho sakta hai.

---

# Phase 0 · Temp file leak + upload limits ✅ DONE

| | |
|---|---|
| **Goal** | Aaj ka 7.70 GB leak band. Upload par ek hard ceiling. |
| **Depends on** | Kuch nahi |
| **Client change** | ❌ |
| **S3 se sambandh** | ❌ — ye aaj ka bug hai |
| **Status** | ✅ Implement + tested. §0.8 me natija |

## 0.1 Files

| File | | Kya |
|---|---|---|
| `middlewares/cleanupTempFiles.js` | 🆕 | Response khatam hote hi har temp file unlink |
| `middlewares/index.js` | ✏️ | Barrel me add |
| `configs/uploadLimit.js` | 🆕 | `MAX_UPLOAD_SIZE_MB` parse + validate — §0.7 |
| `index.js` | ✏️ | Mount order, `fileUpload` options, boot guard |
| `.env` / `.env.example` | ✏️ | `MAX_UPLOAD_SIZE_MB=100` |
| `jest.unit.config.js` | 🆕 | Q-10 (a) — DB-free suite, money suite se alag |
| `package.json` | ✏️ | `npm run test:unit` |
| `__tests__/unit/cleanupTempFiles.test.js` | 🆕 | 8 tests |
| `__tests__/unit/uploadLimits.test.js` | 🆕 | 6 tests — asli multipart request, socket par |
| `__tests__/unit/uploadLimitBootGuard.test.js` | 🆕 | 7 tests — parser + ek asli boot |

## 0.2 Design — jaisa ship hua

Poora source: [middlewares/cleanupTempFiles.js](../middlewares/cleanupTempFiles.js)
aur [index.js](../index.js). Yahan sirf dhaancha:

```js
// middlewares/cleanupTempFiles.js
exports.cleanupTempFiles = (req, res, next) => {
  let swept = false;                    // "finish" aur "close" dono fire ho sakte hain
  const sweep = () => {
    if (swept) return;
    swept = true;
    for (const tempFilePath of collectTempPaths(req.files)) {
      // Fire and forget: response ja chuka hai, ab fail hone ko kuch nahi
      // aur batane ko koi nahi. ENOENT normal hai — failure path par library
      // khud cleanup kar chuki hoti hai.
      fs.unlink(tempFilePath).catch((error) => { /* ENOENT chhodo, baaki log */ });
    }
  };
  res.on("finish", sweep);   // response chala gaya
  res.on("close", sweep);    // client beech me bhaag gaya — "finish" kabhi nahi aata
  next();
};
```

```js
// index.js
/**
 * ⚠️ fileUpload() se PEHLE — §0.7 dekho. Size abort par express-fileupload
 * khud response band karta hai aur next() kabhi nahi bulaata, to uske baad
 * mount kiya middleware us request par chalta hi nahi.
 */
app.use(cleanupTempFiles);
app.use(
  fileUpload({
    useTempFiles: true,
    // ⚠️ "/tmp/" nahi — wo Windows par C:\tmp par resolve hota hai, drive root.
    tempFileDir: path.join(os.tmpdir(), "trydood-uploads"),
    limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
    // ⚠️ Iske bina `limits` ULTA kaam karta hai — busboy file ko chup-chaap
    // kaat deta hai, `truncated: true` set karta hai, request chalti rehti hai,
    // aur is codebase me `truncated` kahin padha nahi jaata.
    abortOnLimit: true,
    limitHandler: (req, res) => {
      if (res.headersSent) return;   // kai files = kai baar fire hota hai
      res.status(413).json({ success: false, message: /* … */ });
    },
  }),
);
```

⚠️ `collectTempPaths` ko dono shape handle karne padte hain — ek field jo form
me repeat hua ho wo **array** banta hai (voucher images), single nahi (brand
logo). Sirf object shape padhne se har multi-file upload chhoot jaata — aur
wahi sabse bada hota hai.

## 0.3 Edge cases

| # | Case | Handling |
|---|---|---|
| P0-1 | Client beech me disconnect | `res.on("close")` — `"finish"` nahi aata |
| P0-2 | `finish` aur `close` dono fire | `swept` flag — sweep ek hi baar. ⚠️ Iska test log par assert karta tha aur jhootha tha; §0.7 dekho |
| P0-3 | File pehle hi delete ho chuki (failure path) | `ENOENT` ignore |
| P0-4 | Ek field me kai files (`images[]`) | `Array.isArray` branch |
| P0-5 | 5 files me se 3 limit cross karein | `res.headersSent` guard |
| P0-6 | PDF ki temp file | `req.files` me hai hi nahi — server khud banata hai, `uploadPDF` khud unlink karta hai. **Chhua nahi jaayega** |
| P0-7 | `os.tmpdir()` me directory nahi hai | express-fileupload khud banata hai (`checkAndMakeDir({createParentPath:true})`) |
| P0-8 | Unlink fail (permission/lock) | Log, request fail **nahi** karta — response ja chuka hota hai |

## 0.4 🔴 Customer ko kya dikhega

| | Pehle | Ab |
|---|---|---|
| 200 MB video | Poora upload hota tha, phir reject (ya nahi hota) — data aur waqt dono gaye | ~100 MB par connection kat jaata hai, turant `413` *"File is too large. The maximum upload size is 100 MB."* |
| 120 MB video, agar limit bina `abortOnLimit` ke lagta | "Success" dikhta, par video beech me ruk jaati | Aisa kabhi nahi hoga |

⚠️ **Client team ke liye zaroori** (teenon API docs me likh diya): `413` par
server connection **turant** band karta hai, poori file bheji nahi jaati.
Upload library ise aksar **network error / abort** ki tarah report karti hai,
HTTP error ki tarah nahi. Agar app sirf *"Network error, try again"* dikhata hai
to customer wahi file baar-baar try karta rahega. Abort ke baad status padhna
zaroori hai.

## 0.5 Verification

```bash
node scripts/verifyImports.js          # barrel + import graph
node -e "require('./middlewares')"     # cycle check
# manual: upload karo, phir
node -e "const fs=require('fs'),os=require('os'),p=require('path');
  const d=p.join(os.tmpdir(),'trydood-uploads');
  console.log(fs.existsSync(d)?fs.readdirSync(d).length+' files':'dir absent')"
```

## 0.6 Done ka matlab

- [x] Upload ke baad temp dir khaali
- [x] Oversize file par `413` **JSON**, aur temp dir khaali
- [x] Multi-file upload par ek hi response
- [x] Client abort par bhi temp file gayi
- [x] `verifyImports.js` clean — 865 modules, 4281 names, 0 error
- [x] `verifyApiCoverage.js` clean — 223/223 × 4

## 0.7 ⚠️ Teen cheezein jo implement karte waqt mili

### Mount order load-bearing nikla

Plan me `app.use(cleanupTempFiles)` `fileUpload()` ke **baad** tha. Wo galat hai.

Size abort par `express-fileupload` khud `res.end()` karta hai aur `next()`
**kabhi nahi bulaata** — to uske baad mount kiya middleware us request par
chalta hi nahi. Library sirf us file ko saaf karti hai jisne limit todi; **usi
request ki pehle wali chhoti file, jo already disk par likhi ja chuki hai, chhoot
jaati hai.**

Isliye ab `cleanupTempFiles` **pehle** mount hota hai — listeners us se pehle lag
jaate hain, aur `req.files` sweep ke waqt padha jaata hai, mount ke waqt nahi.
Test: *"cleans up an earlier file when a later one trips the limit"*.

### Ek test jhootha nikla — mutation ne pakda

*"sweeps once when both finish and close fire"* pehle log par assert karta tha.
Wo **guard hata dene par bhi pass** ho raha tha, kyunki doosra sweep `ENOENT`
par chup rehta hai — jaan-boojh kar.

Ab `fs.unlink` calls **gini** jaati hain. Mutation ab use kill karta hai.

> Sabak: cleanup code me "kuch log nahi hua" par assert karna lagbhag hamesha
> ek aisa test hota hai jo kabhi fail nahi ho sakta.

### `MAX_UPLOAD_SIZE_MB` me ek typo poora fix chup-chaap ud sakta tha

```
Number.parseInt("abc", 10)   →  NaN
limits: { fileSize: NaN }    →  har comparison false  →  KOI LIMIT NAHI
```

Yaani ek env var me galti se `100 MB` (space ke saath) ya `abc` likhne par
server bilkul theek chalta, koi error nahi deta, aur **limit hoti hi nahi** —
ekdum wahi haalat jise theek karne ke liye ye phase bana hai. `0` ulta dard
deta: har upload `413`, aur wajah kisi ko samajh nahi aati.

Isliye [configs/uploadLimit.js](../configs/uploadLimit.js) — parse + validate,
aur galat value par **boot fail**. Ek alag pure module isliye ki ise test karne
ke liye server boot na karna pade: boot karta to wo cluster se connect hota aur
background jobs chalu kar deta, ek `parseInt` check karne ke liye.

Phase 1 me ye `configs/env/` me chala jaayega, poore Joi schema ke saath.

## 0.8 Natija

**Tests** — **21 passed, ~7s**, teen suites. `npm test` (money) chhua tak nahi.

**Mutation — 11/11 killed:**

| Mutant | |
|---|---|
| `close` listener hatao (disconnect leak) | killed |
| double-sweep guard hatao | killed |
| array fields handle mat karo | killed |
| cleanup ko `fileUpload` ke **baad** mount karo | killed |
| `abortOnLimit: false` | killed |
| `limitHandler` hatao | killed |
| limit guard poora hatao (NaN = no limit) | killed |
| NaN check hatao, range rakho | killed |
| zero allow karo | killed |
| galat value message me mat batao | killed |
| khaali string `parseInt` tak jaane do | killed |

**Verification** — `verifyImports.js` 866 modules / 4281 names / 0 error ·
`verifyApiCoverage.js` 223/223 × 4 · **`npm test` 74 suites / 1491 passed / 0 fail** (2165s)

**Docs updated** — `media_upload_map.md` (§8.1, §8.9, §8.10 → FIXED + status
table), `environment_and_services_map.md` (§K inventory, §7), teenon API docs
(`413` status + Common Errors + upload limits section), `CLAUDE.md` (commands).

**Postman** — koi change nahi. Phase 0 me koi route nahi juda aur kisi endpoint
ka request/response shape nahi badla; `413` teenon docs ke Common Errors me hai,
jahan baaki cross-cutting errors rehte hain.

## 0.9 Baaki — aapki machine par

`C:\tmp` me **493 files / 7.70 GB** abhi bhi padi hain. Naye uploads ab wahan
nahi jaate, par purani apne aap nahi hategi. **Aapke kehne par** dry-run list
dikhaunga, phir delete.

---

# Phase 1 · `configs/env/` — validated, frozen config

| | |
|---|---|
| **Goal** | Ek jagah sach. Boot par fail-fast. Prod/non-prod ka guard. |
| **Depends on** | Kuch nahi |
| **Client change** | ❌ |

## 1.1 🟢 Ye socha se aasan hai

Dar tha ki 89 vars × 60 files rewrite karna padega. **Nahi.** Module-scope par
`process.env` sirf **11 jagah** padha jaata hai — baaki sab function ke andar
hai, jo `dotenv` ke baad chalta hai.

| File | Line | Var |
|---|---|---|
| `helpers/brands/generateBrandMerchantId.js` | 4 | `MERCHANT_ID_SECRET` |
| `helpers/cloudinary/index.js` | 2 | `CLOUD_BASE_URL` |
| `helpers/otps/twofactor.js` | 1 | `TWO_FACTOR_API_KEY` |
| `helpers/subBrands/generateSubBrandStoreId.js` | 3 | `STORE_ID_SECRET` |
| `helpers/twoFactor/sendOtpToMobile.js` | 3 | `TWO_FACTOR_API_KEY` |
| `helpers/twoFactor/verifyOtpToMobile.js` | 3 | `TWO_FACTOR_API_KEY` |
| `index.js` | 21, 29 | `PORT`, `NODE_ENV` |
| `jobs/index.js` | 369 | `ENABLE_JOBS` *(function ke andar — safe)* |
| `validator/common.js` | 2, 3 | `MERCHANT_ID_SECRET`, `STORE_ID_SECRET` |

Sirf inhe `config` se padhna hai. Baaki incremental.

> ❓ **Q-11** — Phase 1 ka scope: **layer bane + boot par saari 89 vars
> validate** hon, par baaki call sites (jo function ke andar hain) **waise hi
> rahein**, aur har aage wala phase apne domain ke call sites shift kare?
>
> Ye safe hai — validation ka fayda **din 1 se** milta hai, par 60 files ka
> ek-saath rewrite nahi karna padta. Big-bang rewrite me ek typo kisi aise code
> path me chhup sakta hai jo mahine baad chalta hai.

## 1.2 Files

| File | | Kya |
|---|---|---|
| `configs/env/schema.js` | 🆕 | Joi — har var: type, required/optional, default, per-tier |
| `configs/env/load.js` | 🆕 | `NODE_ENV` → dotenv → 3 guards → validate → freeze |
| `configs/env/index.js` | 🆕 | Frozen nested config export |
| `index.js` | ✏️ | Line 1 ka `require("dotenv").config()` → `require("./configs/env")` |
| `.env.example` | 🆕 | Har var, comment ke saath. **Koi asli value nahi** |
| `docs/environment_and_services_map.md` | ✏️ | §3 ko "ho gaya" me badlo |

## 1.3 ⚠️ Loading order — ye sabse nazuk hissa hai

`index.js:1` par abhi `require("dotenv").config()` hai. Uske **baad** ke har
`require` par module-scope env reads chalte hain (upar wali 11). Agar env loader
pehle nahi chala, wo sab `undefined` padhenge — **aur chup-chaap**, kyunki
`const CHARSET = undefined` koi error nahi deta.

```js
// index.js — sabse pehli line, kisi aur require se pehle
const { config } = require("./configs/env");   // yahi dotenv bhi load karta hai
```

**Guard:** `configs/env/index.js` me ek `loaded` flag — dobara require hone par
same frozen object, kabhi re-parse nahi.

## 1.4 Teen guards

| Guard | Rule | Kyun |
|---|---|---|
| **1** | `.env.<NODE_ENV>` na mile → **boot fail** | Galti se `development` ke saath prod creds |
| **2** | `CONFIG_PROFILE` file me hai aur `NODE_ENV` se match kare | File khud batati hai wo kaun si hai |
| **3** | `NODE_ENV=production` ⇒ DB naam me `prod`, Razorpay key `rzp_live_`, S3 bucket me `prod` | Dev machine par prod data likhne se rokta hai |

> ⚠️ Guard 1 ka exception: production par values **platform env** (Render /
> Secrets Manager) se aati hain, file nahi hoti. Agar `CONFIG_PROFILE` pehle se
> environment me set hai to file optional. Yahi ek bypass hai — aur Guard 3
> usi ke liye hai.

> ⚠️ `NODE_ENV=production` is machine ke kuch shells me set hai (CLAUDE.md).
> Isliye **behaviour kabhi `NODE_ENV` par nahi tikega** — sirf log format aur
> Guard 3 ka trigger.

## 1.5 Edge cases

| # | Case | Handling |
|---|---|---|
| P1-1 | Ek var missing | Boot fail, **saare** missing naam ek saath (`abortEarly: false`) |
| P1-2 | Galat type (`PORT=abc`) | Joi catch, boot fail |
| P1-3 | Extra/unknown var | Warn, fail nahi — platform apne vars inject karta hai |
| P1-4 | Secret log me aa gaya | Joi error me value kabhi print nahi — sirf key naam |
| P1-5 | Test suite ka env | `__tests__/money/setup/` apna load karta hai — **na toote**, verify karna hai |
| P1-6 | `scripts/*.js` standalone chalte hain | Har script ko bhi loader chahiye — audit list banegi |

## 1.6 Done ka matlab

- [ ] Ek var hatao → boot saaf error de, chale nahi
- [ ] `NODE_ENV=production` + test DB → Guard 3 rok de
- [ ] `npm test` chale (P1-5)
- [ ] Har `scripts/*.js` chale (P1-6)
- [ ] `.env.example` me har var, koi asli secret nahi

---

# Phase 2 · `services/storage` facade + S3 provider ✅ DONE

| | |
|---|---|
| **Goal** | Ek jagah provider decide ho. **L-1…L-4 landmines yahin marte hain.** |
| **Depends on** | Phase 1 |
| **Client change** | ❌ |
| **Infra** | ❌ — dono step bina AWS ke ship hue. S3 provider likha hua hai, `MEDIA_PROVIDER=AWS_S3` par jaga hoga |
| **Status** | ✅ Step A + Step B. Natija §2.8 me |

## 2.1 Files

| File | | Kya |
|---|---|---|
| `constants/storage.js` | 🆕 | `STORAGE_PROVIDER`, `UPLOAD_PURPOSES` |
| `constants/showcase.js` | ✏️ | `STORAGE_PROVIDER` yahan se hatao (showcase-specific nahi hai) |
| `configs/s3.js` | 🆕 | `S3Client`, `config.media.s3` se |
| `services/storage/index.js` | 🆕 | Facade — `uploadFromPath` / `deleteAsset` / `publicUrl` |
| `services/storage/providers/s3.js` | 🆕 | PutObject / DeleteObject / HeadObject |
| `services/storage/providers/cloudinary.js` | 🆕 | `helpers/cloudinary` ko wrap karta hai |
| `services/storage/keys.js` | 🆕 | Key building, prefix, uuid |
| `services/uploads/index.js` | ✏️ | Facade ko delegate (**step A**), phir delete (**step B**) |
| `helpers/showcases/upload.js` | ✏️ | **L-1, L-4** |
| `helpers/vouchers/validateImagesFiles.js` | ✏️ | **L-3** |
| 20 call sites | ✏️ | Facade par shift (step B) |

## 2.2 Do step me — ek saath nahi

**Step A — facade bane, purana chalta rahe.** `services/uploads/index.js` andar
se facade call karega, uske exports waise hi rahenge. **Zero call-site change.**
Yahin `deleteAsset` provider-aware ban jaata hai → L-1, L-2, L-3 khatam.

**Step B — 20 call sites facade par**, `services/uploads/index.js` delete.

Do step isliye ki Step A akela deploy ho sakta hai aur usi me saare silent-skip
bugs mar jaate hain. Step B mechanical hai.

## 2.3 Facade contract

```js
// services/storage/index.js   — jaisa ship hua
uploadFromPath({ filePath, purpose, entityId, originalFile, kind })
                              // → { url, thumbnail, storage, metadata }
deleteAsset(asset)            // asset = { url, storage, type|kind|metadata }
deleteAssets(assets)          // → { deleted, failed }
publicUrl(asset)
```

> ⚠️ **Plan me `deleteAsset(storage)` tha, ship `deleteAsset(asset)` hua.**
> Callers ke paas ek media object hota hai (`{ url, storage, type, metadata }`),
> bare `storage` nahi. Sirf `storage` lene ka matlab hota ki har call site pehle
> use tod kar nikaale — aur `url` ke bina legacy rows (jinme `storage` hai hi
> nahi) delete ho hi nahi sakti. Poora object lene se provider row se aata hai
> aur kind `metadata.mimeType` se — jo Cloudinary ke `resource_type` ke liye
> zaroori hai, warna ek video ko image ki tarah destroy karne par wo "not found"
> keh kar file chhod deta hai.

```js
exports.deleteAsset = async (storage) => {
  if (!storage) return false;
  // Legacy rows me `storage` hai hi nahi — sirf ek URL string. Wo hamesha
  // Cloudinary ka hai, kyunki S3 se pehle koi doosra provider tha hi nahi.
  const provider = storage.provider ?? STORAGE_PROVIDER.CLOUDINARY;
  switch (provider) {
    case STORAGE_PROVIDER.S3:         return s3.remove(storage);
    case STORAGE_PROVIDER.CLOUDINARY: return cloudinary.remove(storage);
    default:
      // ⚠️ Chup NAHI. Aaj ka bug yahi hai: `helpers/showcases/upload.js:59`
      // `console.warn` karke `return` kar deta hai, aur object hamesha ke liye
      // reh jaata hai — koi error, koi alert nahi.
      throwError(500, `Unknown storage provider: ${provider}`);
  }
};
```

## 2.4 L-4 ka fix — `isCustomThumbnail`

Aaj ([showcases/upload.js:75-83](../helpers/showcases/upload.js#L75)):

```js
const publicId = media?.storage?.publicId;
if (publicId && thumbnail === getOptimizedImageUrl(publicId)) return false;
```

S3 media me `publicId` **`null`** hota hai → check skip → auto-generated poster
"custom" samjha jaata hai → `deleteCustomThumbnail` use uda deta hai.

Naya rule — URL ka shape guess karne ki jagah **ek explicit field**:

```js
// ShowcaseSection.media[].thumbnailStorage — set tabhi hota hai jab
// vendor ne khud poster upload kiya ho. Auto poster me ye hamesha khaali.
exports.isCustomThumbnail = (media) => Boolean(media?.thumbnailStorage?.key
                                            || media?.thumbnailStorage?.publicId);
```

🔴 **Vendor ko kya bachta hai:** bina iske, S3 par ek video ka poster badalne
par **poster gayab** ho jaata aur section me kaali tile reh jaati.

## 2.5 Key layout

**Shape: `<prefix><type>/<entity>/<entityId>/<uuid>.<ext>`** — type sabse upar,
entity uske andar. Dono chahiye, alag-alag wajah se (B-5).

**PUBLIC bucket** (`S3_BUCKET_PUBLIC`) — CloudFront ke peeche:

```
<prefix>staging/<userId>/<uuid>.<ext>          ← unvalidated, lifecycle 24h, CloudFront DENY

<prefix>images/brands/<brandId>/<uuid>.<ext>
<prefix>images/showcase/<sectionId>/<uuid>.<ext>        ← poster
<prefix>images/vouchers/<voucherId>/<uuid>.<ext>
<prefix>images/banners/<bannerId>/<uuid>.<ext>
<prefix>images/categories/<categoryId>/<uuid>.<ext>
<prefix>images/subcategories/<subCategoryId>/<uuid>.<ext>
<prefix>images/tickers/<tickerId>/<uuid>.<ext>
<prefix>images/users/<userId>/<uuid>.<ext>

<prefix>videos/showcase/<sectionId>/<uuid>.<ext>
<prefix>videos/banners/<bannerId>/<uuid>.<ext>
<prefix>videos/vouchers/<voucherId>/<uuid>.<ext>

<prefix>gifs/banners/<bannerId>/<uuid>.<ext>
<prefix>gifs/vouchers/<voucherId>/<uuid>.<ext>
```

**PRIVATE bucket** (`S3_BUCKET_PRIVATE`) — koi CloudFront nahi, sirf presigned GET:

```
<prefix>documents/<year>/<series>/<documentNumber>.pdf     ← Phase 4
```

`<prefix>` — prod me khaali, non-prod me `dev/` ya `staging/`.
Har upload ka **naya uuid** — kabhi overwrite nahi ⇒ CloudFront invalidation kabhi nahi chahiye.

### Type upar kyun

| Cheez | Type prefix se |
|---|---|
| **Resize Lambda** (Phase 6) | `images/*` par ek CloudFront behaviour. Entity-first hota to `*.mp4` extension par route karna padta |
| **🔴 GIF ka bachav** | `gifs/*` resizer se **bahar** rehta hai. `images/` me hota to Lambda uski **animation maar deta** |
| **Lifecycle** | `videos/*` → 90 din baad Infrequent Access. Bade sirf video hi hain |
| **Cache TTL** | video aur image ke liye alag behaviour |

### Entity andar kyun

Aaj Cloudinary par sab `folder: "Images"` me ek random `public_id` ke saath
girta hai — **key se pata hi nahi chalta file kiski hai**. Isiliye
[cleanupOrphans.js](../scripts/cleanupOrphans.js) me media ka ek bhi sweep
nahi hai: orphan image dhoondhne ka koi rasta hi nahi. Entity key me aate hi
wo mumkin ho jaata hai.

> ⚠️ `staging/` **prefix** ka `STAGING` **tier** se koi rishta nahi. Non-prod
> staging par path `staging/staging/…` banta hai — dekhne me ajeeb, par sahi.
>
> 🟢 Aur `staging/` type-tree ke **bahar** hai, jaan-boojh kar: us waqt type abhi
> **saabit nahi hua** hota. Type folder §5.4 ke magic-byte check ke **baad**
> milta hai. Ek type-named prefix content ka daawa hai, aur wo daawa tabhi banega
> jab bytes dekh li gayi hon.
>
> `audio/` abhi **nahi** banega — `uploadAudio` zinda hai par uska koi caller
> nahi. Table me row rahegi; object tab girega jab koi sach me audio bhejega.

## 2.6 Edge cases

| # | Case | Handling |
|---|---|---|
| P2-1 | Legacy row me `storage` nahi | `?? CLOUDINARY` |
| P2-2 | `storage.provider` unknown | **throw** — chup nahi |
| P2-3 | S3 delete par `NoSuchKey` | Success maano (Cloudinary ka `"not found"` bhi aisa hi treat hota hai) |
| P2-4 | S3 credentials galat | Boot par ek **credential-source line** (§2.6.1), aur setup ke baad `aws` probe — [aws_s3_setup.md §7](./aws_s3_setup.md) |
| P2-5 | Cloudinary flag se on kiya gaya | `config.media.provider` — dono raaste tested |
| P2-6 | Barrel cycle (`services/storage` ↔ `helpers/*`) | `verifyImports.js` |

### 2.6.1 ⚠️ `HeadBucket` **nahi** — wo policy tod deta

Pehle yahan likha tha "boot par `HeadBucket` check". Wo galat tha:
**`HeadBucket` ke liye `s3:ListBucket` chahiye**, aur wo permission
[aws_s3_setup.md §5.1](./aws_s3_setup.md) me jaan-boojh kar nahi di gayi.

Sirf is check ke liye `ListBucket` dene ka matlab hota: ek leaked key se koi
private bucket ki **poori key list** padh leta — yaani har invoice ka
`documentNumber`, har brand ka id. Ek boot-time nicety ke liye ye sauda mehenga hai.

`HeadObject` bhi kaam nahi karta: `ListBucket` ke bina missing key par S3
**403 deta hai, 404 nahi** — to "credential kharab" aur "file hai hi nahi" me
farq hi nahi kar paate.

**Jo hoga:**

1. **Boot par, bina network ke** — SDK se credentials *resolve* karwa kar unka
   **source** log karo (`instance role` / `environment key (…7Q)`). Ye batata hai
   ki kaunsi identity use hogi — [aws_s3_setup.md §6.3](./aws_s3_setup.md) ka
   stale-key khatra yahin pakda jaata hai. Koi S3 call nahi, boot slow nahi.
2. **Setup ke baad ek baar** — [aws_s3_setup.md §7](./aws_s3_setup.md) ke `aws`
   probe commands. Wo ye bhi saabit karte hain ki non-prod credential se
   production bucket par likha **nahi** ja sakta — jo `HeadBucket` kabhi
   batata hi nahi.

## 2.7 Done ka matlab

- [x] `deleteAsset` dono provider par sach me delete kare
- [x] Unknown provider par **throw**, silent skip nahi
- [x] Legacy URL-only row Cloudinary se delete ho
- [x] `MEDIA_PROVIDER=CLOUDINARY` se purana behaviour wapas aaye
- [x] `verifyImports.js` clean, koi cycle nahi — 877 modules
- [x] Unit suite 73/73, `verifyEnvCoverage` teeno list agree

## 2.8 Natija — jo sach me ship hua

### Naye files

| File | Kya |
|---|---|
| `constants/storage.js` | `STORAGE_PROVIDER`, `MEDIA_KIND`, `MEDIA_KIND_PREFIX`, `STORAGE_BUCKET`, **`UPLOAD_PURPOSES`** (14 rows), `kindFromMime` |
| `services/storage/index.js` | Facade — `uploadFromPath` · `uploadUrl` · `deleteAsset` · `deleteAssets` · `publicUrl` |
| `services/storage/keys.js` | `buildKey` · `buildDocumentKey` · `buildStagingKey` · `bucketFor` · `cloudinaryFolder` |
| `services/storage/providers/cloudinary.js` | folder + `public_id` + `resource_type` sab yahin |
| `services/storage/providers/s3.js` | `PutObject` / `DeleteObject`, CDN URL, private bucket par URL **refuse** |
| `configs/s3.js` | Lazy `S3Client`, `bucketName`, **`logS3Config`** (credential-source line) |
| `__tests__/unit/storage.test.js` | 32 test |

### Chaar landmine

| | Kya tha | Ab |
|---|---|---|
| **L-1** | `case "S3": // Future Implementation` — return karta tha jaise delete ho gaya ho. `default` branch `console.warn` karke return | Facade dispatch karta hai; **unknown provider par throw** |
| **L-2** | `deleteFile` URL ko `CLOUD_BASE_URL` se match karta tha; match na ho to `console.log` aur `false` | `storage.publicId` se delete — URL parse hi nahi hota |
| **L-3** | Voucher rollback `deleteImage(url)` se — yaani L-2 wala silent skip | `deleteAssets(uploaded)`, jo `{ deleted, failed }` ginta hai |
| **L-4** | S3 par `publicId` null → URL comparison skip → **auto poster "custom" pada jaata** → vendor ka live poster delete | `media[].thumbnailStorage` — hai ya nahi, bas. Legacy Cloudinary rows purani heuristic par |

### 🔴 Wahi bug teen aur jagah mila (plan me nahi tha)

Banner, voucher banner aur ticker — teenon ke paas row par `storage` object **tha**, par teenon URL se delete kar rahe the. Yaani L-2 ka silent skip un teenon par bhi lagta. Ab teenon `deleteAsset({ url, storage, type })` se jaate hain, aur `type` isliye jaata hai ki ek GIF plain image ki tarah destroy na ho — Cloudinary galat `resource_type` par `"not found"` keh kar file chhod deta hai.

### Step B — 19 call site

Har call site ab `purpose` + `entityId` deta hai, to key aisi banti hai:

```
dev/images/brands/<brandId>/<uuid>.webp
dev/videos/showcase/<sectionId>/<uuid>.mp4
dev/gifs/banners/<bannerId>/<uuid>.gif
```

⚠️ **Create flows me id upload se pehle mint hoti hai.** `createCategory`,
`createSubCategory`, `registerUser`, `createBanner`, `createTicker`,
`createVoucher`, `addBrandFeature` — sab me upload insert se pehle hota hai, to
key ko id chahiye thi. Mongo ids waise bhi client-side bante hain, to ye wahi
value hai jo `create` khud banata.

`services/uploads/index.js` **delete nahi hua** — usme `uploadPDF` (Phase 4 me
private bucket par jaayega) aur `uploadAudio` (koi caller nahi, jaan-boojh kar
rakha) bache hain. `uploadImage`, `uploadVideo`, `deleteImage`,
`deleteAudioOrVideo`, `upload*WithMetadata` sab chale gaye.

### Saath me band hua

- **§8.2** — `CLOUD_BASE_URL` khaali/galat hone par har delete skip *(L-2 ka hi doosra chehra)*
- **§8.3** — `updateCategoryById`, `updateSubCategoryById`, `updateUserById` me
  **delete pehle, upload baad me** tha. Upload fail = purani image ja chuki, nayi
  aayi nahi. Ab ulta: upload → assign → phir purani delete
- **§8.5** — `uploadVideo` dead tha, hata

### Proof

9 mutant banaye, **9 ke 9 killed** — har fix ke bina uska test sach me fail hota hai:

```
killed  L-1  unknown provider warns and returns (the old behaviour)
killed  L-1  delete follows MEDIA_PROVIDER instead of the row
killed  L-2  delete by URL first, public id ignored
killed  L-4  isCustomThumbnail drops the provider guard
killed  L-4  thumbnailStorage ignored
killed  GIF  treated as a plain image
killed  keys path traversal not stripped
killed  keys purpose/kind mismatch allowed
killed  keys reuse one key instead of a fresh uuid
```

### ⚠️ Do cheezein jo implement karte waqt badalni padi

**1. `kinds` security boundary nahi hai.** Pehle har image purpose me sirf
`[IMAGE]` tha. Par ek GIF `image/gif` hai, aur voucher images sirf
`startsWith("image/")` check karti hain jabki logo/avatar **kuch bhi check nahi
karte** (§8.4). To ek GIF aa sakta hai — aur `kinds` me na hone se wo S3 par ek
uljhan bhara 422 ban jaata. Ab har image purpose `GIF` bhi list karta hai: file
`gifs/` me jaati hai (resizer se bahar), aur **rokne ka kaam mime allow-lists ka
hai**, is table ka nahi.

**2. `deleteAsset(storage)` → `deleteAsset(asset)`.** §2.3 dekhein — callers ke
paas poora media object hota hai, bare `storage` nahi, aur legacy rows me
`storage` hai hi nahi.

---

# Phase 3 · 6 surfaces ko `storage` field ✅ DONE

| | |
|---|---|
| **Goal** | Har media ka provider + key DB me ho. Bina response badle. |
| **Depends on** | Phase 2 |
| **Client change** | ❌ |
| **Infra** | ❌ |
| **Status** | ✅ Natija §3.6 me |

## 3.1 ⚠️ Design correction

Design doc §3.2 me maine likha tha `image: String` → `image: { url, storage }`.
**Wo galat tha — wo ek breaking response change hai**, aur Phase 3 ka poora point
"panel team ko kuch na karna pade" tha.

Sahi tarika — **sibling field**:

```js
// models/User.js
image:        { type: String },                     // ← bilkul waisa hi, response nahi badla
imageStorage: { type: storageSchema, default: undefined },   // ← naya, internal
```

Response me `image` waisa hi string rahega. `imageStorage` sirf server padhta
hai — delete aur re-upload ke liye. **Client ko pata bhi nahi chalega.**

## 3.2 Files

| Model | Naya field | |
|---|---|---|
| `models/storageSchema.js` | 🆕 shared sub-schema — 6 models me duplicate shape ek jagah | ✅ |
| `models/User.js` | `imageStorage` | ✅ |
| `models/Category.js` | `imageStorage` | ✅ |
| `models/SubCategory.js` | `imageStorage` | ✅ |
| `models/Brand.js` | `logoStorage` · `coverImageStorage` | ✅ |
| `models/SubBrand.js` | `logoStorage` · `coverImageStorage` | ✅ *(plan me nahi tha — cover ke saath aaya)* |
| `models/BrandFeatures.js` | `iconStorage` | ✅ |
| `models/ShowcaseSection.js` | `media[].thumbnailStorage` | ✅ Phase 2 — L-4 ko iski zarurat thi; ab shared schema par |

Services (11): `registerUser`, `updateUserById`, `createCategory`,
`updateCategoryById`, `deleteCategoryById`, `createSubCategory`,
`updateSubCategoryById`, `deleteSubCategoryById`, `updateBrand`,
`updateSubBrand`, `addBrandFeature`, `updateBrandFeature`,
`deleteBrandFeature`.

## 3.3 ✅ §8.3 Phase 2 me hi band ho gaya

Ye Phase 3 ke saath hona tha, par teenon services wahin chhui ja rahi thin to
usi waqt theek kar di gayin:

```
tha:  deleteImage(purana)  →  uploadImage(naya)   ← upload fail = dono gaye
ab:   uploadUrl(naya)      →  assign             →  deleteAsset(purana)
```

`updateCategoryById`, `updateSubCategoryById`, `updateUserById` — teenon.

🔴 **Customer ko kya hota tha:** profile photo badalta, upload fail hota —
**purani photo bhi ja chuki hoti.** Ab uske paas koi photo nahi hoti, aur wo kuch
nahi kar sakta tha.

### ⚠️ Phase 3 ke saath ek aur cheez dekhni hai — §8.6

`Category.image` aur `SubCategory.image` ka **default hi ek shared URL hai**
(`DEFAULT_IMAGES.CATEGORY`). Jis category ne apni image kabhi upload nahi ki,
uska `image` wahi shared default hai — aur update/delete ab use `deleteAsset`
par bhejte hain.

Aaj ye **sirf ittefaq se safe hai**: default purane cloud `drvdnqydw` par hai
aur active cloud `dtpy1lbmf`, to host check use skip kar deta hai. Jis din koi
in defaults ko current cloud par le aayega, **ek category delete karne se har
default-image wali category ki image toot jaayegi.**

Fix: delete se pehle `if (image !== DEFAULT_IMAGES.CATEGORY)` guard. Phase 3 me
`imageStorage` aane ke baad ye aur saaf ho jaata hai — default ka koi
`imageStorage` hoga hi nahi, to "hamara upload hai ya shared default" ka jawab
guess ki jagah ek field ban jaata hai.

## 3.4 Edge cases

| # | Case | Handling |
|---|---|---|
| P3-1 | Purani rows me `*Storage` nahi | `default: undefined` — field likhi hi nahi jaati, `deleteAsset` legacy branch le lega |
| P3-2 | `default: {}` galti | ⚠️ Mongoose khaali subdoc likh deta → `provider: undefined` → P2-2 throw. Isliye `default: undefined` |
| P3-3 | Naya upload hua, save fail | `deleteAsset(naya)` `catch` me |
| P3-4 | Purana delete fail | Best effort + log. Orphan `cleanupOrphans.js` pakdega |
| P3-5 | Response shape badal gaya | **Nahi badla** — §3.1. Postman example diff se verify |

## 3.5 Done ka matlab

- [x] Sabhi services `*Storage` likhein
- [x] **Response shape bilkul same** — `logo` abhi bhi string hai, test me pinned
- [x] Upload fail hone par purani image bachi rahe
- [x] Legacy rows (URL hai, storage nahi) abhi bhi delete ho
- [x] Naye row par field **absent** ho, `{}` nahi

## 3.6 Natija

### Ek shared sub-schema, chhe model

`models/storageSchema.js` — `{ provider, publicId, bucket, key }`. Chhe jagah
wahi shape copy karne se wo waqt ke saath alag ho jaati; ek jagah se nahi hoti.

### 🔴 Sibling, nested nahi — aur yahi poora point hai

Saaf shakl `image: { url, storage }` lagti hai. Wo **breaking response change**
hai: har client jo `brand.logo` ko string ki tarah padhta hai use object mil
jaata. Sibling — `logo` string hi rehta hai, `logoStorage` uske bagal me aata
hai — client ko kuch dikhta hi nahi. Test isi ko pin karta hai.

### ⚠️ `default: undefined`, har jagah

Mongoose sub-document iske bina **har document par `{}`** bana deta hai — un
purani rows par bhi jo is field se pehle ki hain. Aur `{}` ka matlab
`provider: undefined` hai, jise facade "Unknown storage provider" keh kar mana
karta hai.

```
absent  →  "is field se pehle likhi gayi, URL se kaam chalao"
{}      →  "kisi tooti hui cheez ne likhi"
```

Dono ek jaise dikhte hain, aur inka farq hi delete ke chalne ya na chalne ka
farq hai.

### ⚠️ Purani jodi **overwrite se pehle** pakdi jaati hai

```js
const previous = { url: category.image, storage: category.imageStorage };
// …upload…
category.image = uploaded.url;
category.imageStorage = uploaded.storage;
if (previous.url) await storage.deleteAsset(previous);
```

Baad me pakadne ka matlab hota: abhi upload ki hui file delete, aur purani wahin
padi — bilkul ulta. Mutation me yahi pinned hai.

### §8.6 ab guess se ek field ban gaya

`Category.image` ka **default hi ek shared URL hai**. Ab us default ke paas
`imageStorage` hota hi nahi — to "ye hamara upload hai ya shared placeholder" ka
jawab ek field hai, URL ke host ka andaaza nahi. URL wala guard bhi facade me
laga hua hai; ye doosri, saaf layer hai.

### `uploadUrl` hata

Wo ek step ke liye tha: jin surfaces ke paas `storage` rakhne ki jagah hi nahi
thi, unke call sites chhote rakhne ko. Ab har ek ke paas sibling hai aur sabko
dono hisse chahiye — to uska koi caller bacha hi nahi.

---

# Phase 4 · PDF → private bucket

| | |
|---|---|
| **Goal** | F-14 fix: invoice ab public + permanent + guessable URL par nahi. |
| **Depends on** | Phase 2 |
| **Client change** | ❌ |

## 4.1 🟢 Redirect ki wajah se ye free me mil jaata hai

[controllers/documents/getByToken.js](../controllers/documents/getByToken.js)
`sendRedirect(res, url)` karta hai. Client kabhi stored value dekhta hi nahi —
wo bas redirect follow karta hai.

Iska matlab: hum stored value ko URL se **key** me badal sakte hain, aur har
request par ek **fresh presigned GET** bana sakte hain. **Client ko zero farq.**

## 4.2 Design

```
aaj:   record.invoiceUrl = "https://res.cloudinary.com/…/Documents/abc.pdf"
       → har request wahi URL, hamesha zinda, guessable (Math.random() public_id)

baad:  record.documentStorage = { provider:"S3", bucket, key:"documents/2026/VCH/VCH-000123.pdf" }
       → har request par naya presigned GET, TTL 5 min
```

## 4.3 Edge cases

| # | Case | Handling |
|---|---|---|
| P4-1 | Purani rows me Cloudinary URL cached | `documentStorage` na ho to `urlField` se redirect — legacy chalta rahe |
| P4-2 | Presigned GET expire | Har request par naya. TTL 5 min — download shuru hone ko kaafi |
| P4-3 | User ne link WhatsApp par forward kiya | 🟢 **Ab ye theek hai** — token hi credential hai, aur storage URL 5 min me mar jaata hai |
| P4-4 | `Transaction.invoiceUrl` naam ka takraav (O-1) | Naya field `documentStorage` — purane naam ko chheda hi nahi |
| P4-5 | `regenerateInvoice` re-upload | Naya uuid key, purani `deleteAsset` se |
| P4-6 | `scripts/sendDocumentVerificationMails.js` | Upload karta hi nahi, seedha attach karta hai. **Koi change nahi** |
| P4-7 | Private bucket par CloudFront | Nahi chahiye — presigned GET seedha S3 se |

## 4.4 🔴 Aaj ka risk, saaf shabdon me

Ek invoice ka Cloudinary URL public, permanent aur `Math.random()` se bana hai.
Us URL me customer ka **naam, address, GSTIN aur amount** hai. `documentToken`
revoke ho sakta hai — **wo storage URL nahi**. Jiske paas ek baar URL aaya, wo
hamesha padh sakta hai.

## 4.5 Done ka matlab

- [ ] Naya document private bucket me jaaye
- [ ] `GET /documents/:token` redirect kare (behaviour same)
- [ ] Presigned URL 5 min baad `403` de
- [ ] Purani Cloudinary-cached rows abhi bhi khulein
- [ ] `npm test` — document tests pass

---

# Phase 5 · `POST /uploads/presign` + confirm

| | |
|---|---|
| **Goal** | Client seedha S3 par upload kare. Server bytes na chhuye. |
| **Depends on** | Phase 2, 3 |
| **Client change** | ✅ **naya raasta** — purana multipart chalta rahega |

## 5.1 Files

| File | | Kya |
|---|---|---|
| `models/Upload.js` | 🆕 | uploadId, userId, purpose, key, contentType, sizeBytes, consumedAt, expiresAt (TTL index) |
| `routes/uploads.js` | 🆕 | `POST /uploads/presign` |
| `routes/index.js` | ✏️ | Mount |
| `controllers/uploads/presign.js` | 🆕 | |
| `services/storage/presign.js` | 🆕 | `createPresignedPost` |
| `services/storage/confirm.js` | 🆕 | Head + magic bytes + dimensions + copy |
| `services/storage/inspect.js` | 🆕 | Magic byte + header dimension parser |
| `validator/uploads.js` | 🆕 | Joi |
| `constants/storage.js` | ✏️ | `UPLOAD_PURPOSES` table |
| `helpers/settings/getMediaConfig.js` | 🆕 | |
| `helpers/settings/getSetting.js` | ✏️ | **TTL cache (Q-3)** |
| `models/Setting.js` | ✏️ | `media` block |
| `validator/settings.js` | ✏️ | |
| 19 controllers | ✏️ | `uploadId` bhi accept karein (dual mode) |
| 3 API docs + 3 Postman | ✏️ | |

## 5.2 `UPLOAD_PURPOSES` — ek table, teen kaam

```js
SHOWCASE_MEDIA: {
  prefix: "showcase",
  allow: ["image/jpeg","image/png","image/webp","video/mp4","video/webm","video/quicktime"],
  roles: [VENDOR],
  ownership: "brandOfCaller",
  limits: (cfg) => ({ image: cfg.showcase.maxImageSizeMB, video: cfg.showcase.maxVideoSizeMB }),
},
```

Ek row = **allowed types + kaun kar sakta hai + kiska hai + kitna bada + kahan jaayega**.

> ✅ **F-11 alag se band ho chuka hai** — Phase 0 ke saath, apne commit me.
> `brandFeatures` ke teenon writes ab `resolveActorBrand` se guzarte hain.
> Ye table us fix ki jagah nahi leta; ye har surface ke liye wahi cheez ek
> jagah le aata hai, taaki agla endpoint likhne wale ko sochna hi na pade.

## 5.3 Presigned **POST**, PUT nahi

| | PUT | **POST** |
|---|---|---|
| Size limit S3 enforce kare | ❌ | ✅ `content-length-range` |
| Content-Type bandhe | 🟡 bypass ho sakta | ✅ `starts-with` |
| Key prefix bandhe | ❌ | ✅ `starts-with` |

**PUT me aapka 100 MB ka limit lagega hi nahi.**

## 5.4 Confirm step

```
1. Upload record → userId match? consumedAt khaali?     → 403 / 409
2. HeadObject                                           → 400 agar nahi hai
3. GetObject Range: bytes=0-1023  → magic bytes          → 400 + object delete
4. Image ho to header se width/height                    → metadata
5. Verified type se hi type-prefix chuno                 → images/ | videos/ | gifs/
6. CopyObject staging/… → <prefix><type>/<entity>/…
   ContentType: **verified type se**, ContentTypeDirective: REPLACE
7. Mongo transaction: row + consumedAt
8. DeleteObject staging/…  (best effort)
```

Magic bytes — F-12 aur F-13 ka asli fix:

| Bytes | Type | Prefix |
|---|---|---|
| `FF D8 FF` | JPEG | `images/` |
| `89 50 4E 47` | PNG | `images/` |
| `52 49 46 46 … 57 45 42 50` | WebP | `images/` |
| **`47 49 46 38`** (`GIF8`) | **GIF** | **`gifs/`** |
| `… 66 74 79 70` | MP4 / MOV | `videos/` |
| `1A 45 DF A3` | WebM / MKV | `videos/` |
| `<?xml` / `<svg` | ❌ **reject** (F-13) | — |

> 🔴 **GIF pehle is table me tha hi nahi**, jabki `BANNER_TYPE.GIF` aur
> `VOUCHER_BANNER_TYPE.GIF` live supported types hain (`image/gif`). Uske bina
> har banner GIF confirm par 400 kha jaata.

> 🔴 **`Content-Type` client se mat lo — verified type se set karo.** Presigned
> POST me client `Content-Type` khud bhejta hai. Agar wahi copy kar diya, to ek
> MP4 `image/jpeg` ban kar CloudFront par **permanently cache** ho jaayega:
> browser broken-image dikhayega aur kisi bhi log me ek line nahi aayegi.
> `CopyObject` par `MetadataDirective: "REPLACE"` chahiye — warna S3 source ka
> `Content-Type` chupke se carry kar leta hai.

Wahi 1 KB image ke dimensions bhi de deta hai (JPEG SOF0 / PNG IHDR / WebP VP8X)
— isliye image ke liye Lambda chahiye hi nahi.

## 5.5 Edge cases — §7 ka poora E-1…E-15 yahin lagta hai

| # | Case | Handling |
|---|---|---|
| E-2 | Upload kiya, confirm nahi | `staging/` lifecycle 24h |
| E-3 | Object hi nahi | `HeadObject` 404 → `400` |
| E-4 | Same uploadId do baar | `consumedAt` → `409` |
| E-5 | Kisi aur ka uploadId | `userId` mismatch → `403` |
| E-6 | Key badal kar upload | S3 policy `starts-with $key` |
| E-7 | Content-Type jhooth | Magic bytes → `400` + delete |
| E-9 | 100 MB+ | S3 `EntityTooLarge` |
| E-10 | Upload > policy expiry | `Expires: 1800` (30 min) |
| E-11 | Presign spam | Per-user rate limit |
| E-12 | 15 media ka limit race | Count check **transaction ke andar** |
| E-14 | Copy hua, Mongo fail | `DeleteObject` catch me + `cleanupOrphans.js` |
| E-15 | 5 me se 3rd fail | Provider-aware rollback (L-3 fixed) |
| E-27 | **Browser panel CORS** | 🔴 **Bucket CORS config zaroori** — warna panel upload ek opaque CORS error se failega |

## 5.6 Docs + Postman

Naya route ko **teen cheezein** chahiye (verifyApiCoverage enforce karta hai):
map row + role-doc section + Postman request + captured example.

⚠️ Postman collections me captured examples hain — **regenerate mat karna**,
9k lines chali jaayengi. **JSON in-place patch.**

## 5.7 Done ka matlab

- [ ] Presign → S3 POST → confirm end-to-end
- [ ] `.exe` ko `image/jpeg` keh kar bhejo → `400`, object delete
- [ ] SVG → `400`
- [ ] 101 MB → S3 khud reject
- [ ] Dusre user ka uploadId → `403`
- [ ] Do baar confirm → `409`
- [ ] Purana multipart raasta **abhi bhi chale**
- [ ] `node scripts/verifyApiCoverage.js` clean
- [ ] Pre-commit hook pass

---

# Phase 6 · CloudFront + resize (T1) — infra

| | |
|---|---|
| **Goal** | Cloudinary ka `fetch_format:auto` + `quality:auto` ka replacement |
| **Deliverable** | Terraform + Lambda@Edge source. **Aap deploy karenge** (Q-7/Q-9) |

```
https://cdn.trydood.com/showcase/<id>/<uuid>.jpg?w=400
            │
      CloudFront ──miss──► Lambda@Edge (sharp) ──► S3 origin
```

| # | Edge case | Handling |
|---|---|---|
| P6-1 | `?w=9999` — cache poison + Lambda bill | **Strict allowlist `160/400/800/1600`**, baaki ignore |
| P6-2 | `staging/*` public ho gaya | CloudFront behavior **deny** |
| P6-3 | Video par `?w=` | Video resize nahi — origin se as-is |
| P6-4 | Cache me purana object | Immutable uuid keys — problem hi nahi |
| P6-5 | Lambda@Edge fail | Origin ka original serve ho (fail-open) |

🔴 **Customer ko kya milta hai:** aaj home screen ki 20 images = ~5 MB full-res.
`?w=400` ke saath ~600 KB. 4G par 10 second ki khaali screen → ~1.5 second.

---

# Phase 7 · Metadata Lambda + retry sweep (M-1, Q-5)

| | |
|---|---|
| **Goal** | Video duration. **Sirf video** — image Phase 5 me sync ho chuki. |

```
S3 PutObject event → Lambda (ffprobe) → PATCH metadata.duration, pending:false
                          │ fail
                          └─► DLQ
```

| # | Edge case | Handling |
|---|---|---|
| P7-1 | Lambda abhi chala nahi | Row `metadata.pending: true` ke saath banti. UI "processing…" |
| P7-2 | Lambda fail / timeout | DLQ + **hourly sweep job** jo 1 ghanta purani `pending` rows dobara try kare |
| P7-3 | Row Lambda se pehle delete | Lambda ko row na mile → chup-chaap exit (warning nahi, ye normal hai) |
| P7-4 | Corrupt video | ffprobe fail → `pending:false, duration:0` + admin alert |

⚠️ Bina P7-2 ke ye wahi silent failure hai jo `CLAUDE.md` mana karta hai —
kuch error nahi deta, bas duration hamesha `0:00` dikhti hai.

---

# Phase 8 · Panel + app migration — **doosri team**

Hamara kaam: contract + sandbox + support. Phase 5 par unhe milta hai:

- `POST /uploads/presign` ka doc + Postman
- Har `purpose` ka allowed types + limits
- S3 POST ka example (form fields, order)
- 6-hafte ka sunset notice (Q-8)

---

# Phase 9 · Multipart hatao

| | |
|---|---|
| **Trigger** | Phase 8 poora + 6 hafte (Q-8) |

| File | |
|---|---|
| `express-fileupload` dependency | 🗑️ |
| `index.js` ka `fileUpload(...)` + `cleanupTempFiles` | 🗑️ |
| `middlewares/cleanupTempFiles.js` | 🗑️ |
| 19 controllers ka `req.files` branch | 🗑️ |
| `MAX_UPLOAD_SIZE_MB` env | 🗑️ — ab sirf `Setting.media` |

⚠️ **Pehle verify:** koi client abhi bhi multipart bhej raha hai ya nahi. Phase 5
me ek counter/log lagega taaki Phase 9 par **aankh band kar ke** na hataana pade.

---

## 10. Naye sawaal

### ✅ Q-10 — Test kahan rakhun? → **(a)**, ho chuka

`jest.config.js` ka `testMatch` **sirf** `__tests__/money/**` hai, aur
`CLAUDE.md` kehta hai baaki repo ki no-test convention jaan-boojh kar hai. Money
suite **32+ minute** leti hai, asli cluster par chalti hai, aur ek run lock leti
hai — us par media tests laadna theek nahi.

Par kuch cheezein aisi hain jo "manual QA kabhi nahi pakdega" wale category me
aati hain:

- key scoping (E-5, E-6) — ye ek **security boundary** hai
- magic byte validation (E-7, E-8) — **security boundary**
- idempotent confirm (E-4)
- `deleteAsset` ka provider routing (L-1…L-3)
- `cleanupTempFiles` (P0-1…P0-5)

Ye sab **pure functions** hain — DB nahi chahiye, milliseconds me chalte hain.

**Chuna gaya (a):** `__tests__/unit/` + `jest.unit.config.js`, `npm run test:unit`.
Money suite bilkul nahi chhui gayi — `npm test` ab bhi wahi matlab rakhta hai.
14 tests, ~3.3 second, koi DB nahi, koi lock nahi.

```bash
npm test         # money suite — 74 suites, asli cluster, run lock, ~36 min
npm run test:unit  # pure functions — no DB, no lock, seconds
```

Q-11, Q-12, Q-13 ke jawab bhi mil gaye: Phase 1 incremental (A), Phase 3 sibling
field, aur F-11 Phase 0 ke saath alag commit me.

### ❓ Q-11 — Phase 1 ka scope

Layer bane + boot par **saari** vars validate hon, par call sites incremental
shift hon (§1.1)? Ya ek saath sab?

### ❓ Q-12 — Phase 3 sibling field

§3.1 wala correction confirm kar dijiye — `image: String` waisa hi rahega,
`imageStorage` naya sibling. Isse **response shape nahi badalta** aur panel team
ko Phase 3 me kuch nahi karna.

### ✅ Q-13 — F-11 → ho gaya

Phase 0 ke saath, apne commit me. Teenon writes par `resolveActorBrand`.

Likhte waqt do aur bug mile, usi file me:

  - `throwError` **teen lines par call, import kahin nahi** — har ek
    `ReferenceError`. Feature na milne par `404` ki jagah `500`, aur — zyada
    bura — 10-active ki limit khud ko report hi nahi kar paati thi: vendor ko
    *"server error"* dikhta tha, ye nahi ki limit 10 hai.
  - `if (isActive)` boolean `false` ke liye falsy hai, to feature **band karna**
    accept hota tha, `200 "updated successfully"` deta tha, aur kuch badalta
    nahi tha.

13 tests, asli DB. Mutation: 5/5 killed.

🔴 **Aur teen ownership hole abhi khule hain** — media se rishta nahi, par wahi
bimari. `PUT /locations/update/:id` aur `DELETE /locations/delete/:id` (dono me
**customer ka apna address** bhi aata hai), aur `POST /vouchers/publish/:versionId`.
Teenon `userId` lete hain (ya lete bhi nahi) aur ownership ke liye use nahi karte.
Detail: [vendor_panel_api_doc.md → Appendix B](./vendor_panel_api_doc.md#appendix-b--known-issues).

---

## 11. Har phase ka standard checklist

Har phase par ye chalega — koi exception nahi:

```bash
node scripts/verifyImports.js         # 848 modules, 4192 names — koi toota import nahi
node scripts/verifyApiCoverage.js     # 218 routes × 4 checks
npm test                              # 74 suites / 1491 tests, ~36 min
```

Aur:

- [ ] Docs sach bolein — **koi stale line nahi**
- [ ] Postman requests + captured examples sync
- [ ] Pre-commit hook pass
- [ ] Alag logical commit, explicit path se staged
- [ ] Naya test (Q-10 ke jawab par)
- [ ] Purana code **kuch na toote** — regression list phase me likhi hai
