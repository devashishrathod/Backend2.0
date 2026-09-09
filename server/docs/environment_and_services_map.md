# Environment & Services Map

Har third-party service, har external dependency aur har environment variable —
category-wise, aur **NODE_ENV ke base par kaun sa kya switch karega**.

> Ye doc **design** hai, code nahi. Iske approve hone ke baad `configs/` layer
> banegi, phir uske upar AWS-S3 migration hoga.
> Media ka poora current flow: [media_upload_map.md](./media_upload_map.md)

---

## 0. Jo decide ho chuka hai

| Decision | Chuna gaya | Kya matlab |
|---|---|---|
| **Switch key** | `NODE_ENV` | Alag `APP_ENV` nahi. Iska ek asli khatra hai — §2 me uska guard design hai. |
| **Config model** | Per-env file + central validated config layer | `.env.development` / `.env.staging` / `.env.production`, sab me **same variable naam**, alag values. Upar ek `configs/env.js` jo boot par validate kare. |
| **Dev vs Staging** | Alag DB, shared bucket | DB alag (`Trydood2` / `Trydood2_staging`), S3 bucket ek — sirf prefix alag (`dev/`, `staging/`). |
| **S3 layout** | 2 bucket per tier: public + private | Public = images/videos (CloudFront). Private = saare PDF documents (presigned GET only). |

In chaaron ko jodne se **2 config tiers** bante hain, jaisa aapne kaha tha —
production ka ek setup, dev+staging ka ek:

```
                  ┌──────────────── PRODUCTION TIER ────────────────┐
NODE_ENV=production   .env.production
                      DB: production cluster
                      S3: trydood-prod-public  /  trydood-prod-private
                      Razorpay: LIVE keys (dono accounts)
                  └────────────────────────────────────────────────┘

                  ┌──────────────── NON-PROD TIER ─────────────────┐
NODE_ENV=staging      .env.staging
                      DB: Trydood2_staging
                      S3: trydood-nonprod-*  , prefix  staging/
                      Razorpay: TEST keys
                      ─────────────────────────────────────────────
NODE_ENV=development  .env.development
                      DB: Trydood2
                      S3: trydood-nonprod-*  , prefix  dev/
                      Razorpay: TEST keys        ← same keys as staging
                  └────────────────────────────────────────────────┘
```

**Total 4 buckets**, 3 env files, 3 databases.

---

## 1. Aaj ki haalat — ek line me

**`NODE_ENV` poore codebase me sirf EK jagah use hota hai**, aur wo bhi log
format chunne ke liye ([index.js:29](../index.js#L29)). Iske alawa **koi bhi
service environment ke hisaab se switch nahi hoti**. Ek `.env` file hai, usme
jo hai wahi har jagah chalta hai.

`constants.js:32` me ek `NODE_ENV` enum bhi hai:

```js
NODE_ENV: Object.freeze({ DEVELOPMENT: "DEVELOPMENT", PRODUCTION: "PRODUCTION" })
```

Ise **koi file import nahi karti** — dead hai. Aur values uppercase hain jabki
`index.js` lowercase `"production"` se compare karta hai, to dono kabhi mil bhi
nahi sakte. `STAGING` hai hi nahi.

---

## 2. ⚠️ `NODE_ENV` chunne ka khatra, aur uska guard

Ye section sabse important hai. `CLAUDE.md` khud likhta hai:

> *"`NODE_ENV=production` is set in some shells here… anything that changes
> behaviour must not hang off it — the money paths and index handling all read
> their own named variables instead."*

Aaj tak ye safe tha kyunki **kuch bhi `NODE_ENV` par depend karta hi nahi tha.**
Jis din S3 bucket, Razorpay keys aur MONGO_URL isse decide honge, us din ek
stray shell **production ka data chhu legi** — aur kahin error nahi aayega.

Iska matlab ye nahi ki `NODE_ENV` galat choice hai. Iska matlab hai ki
**loader ko ye maan kar chalna hoga ki `NODE_ENV` jhooth bol sakta hai.** Teen
layer ka guard, teenon sasta:

### Guard 1 — env file ka hona hi permission hai

```
NODE_ENV=production  →  .env.production load karo
                     →  file nahi mili?  BOOT FAIL, loud message
```

Dev machine par `.env.production` **rakhi hi nahi jaayegi**. To stray
`NODE_ENV=production` wali shell se server chalane par:

```
❌ NODE_ENV=production but .env.production was not found.

   Production credentials are never kept on a developer machine.
   If you meant to run locally:  NODE_ENV=development npm run dev
```

Silently prod chhoone ki jagah, **turant, saaf failure**. Yahi wo cheez hai jo
aaj nahi hai.

### Guard 2 — file khud batati hai wo kaun si hai

Har env file me ek marker line:

```ini
# .env.staging
CONFIG_PROFILE=staging
```

Loader `CONFIG_PROFILE === NODE_ENV` assert karta hai. Agar kisi ne
`.env.staging` ko copy karke `.env.production` bana diya aur values badalna
bhool gaya — boot fail:

```
❌ NODE_ENV=production but .env.production declares CONFIG_PROFILE=staging.
```

Ye wo galti pakadta hai jo file-per-env model me sabse aam hai.

### Guard 3 — production apne aap ko pehchanti hai

`NODE_ENV=production` par boot ye bhi assert karega:

- `MONGO_URL` ka database naam production wala hai (test/staging/dev naam **refuse**)
- S3 bucket naam `-prod-` carry karta hai
- dono Razorpay key ids `rzp_live_` se shuru hoti hain
- `ENABLE_NGROK` set nahi hai

Aapki memory me pehle se yahi principle hai — *"guard on DB name, never
NODE_ENV"*. Money suite ka `testDb.js` yahi karta hai (`_test` se end na ho to
connect refuse). Ye uska production wala mirror hai.

> **Teenon milkar:** `NODE_ENV` switch karta hai, par wo **akela** kuch decide
> nahi karta. Har environment ko ek file chahiye jo maujood ho, khud ko declare
> kare, aur jiski values apni tier se match karein.

### Ek chhota npm side-effect

`npm` `NODE_ENV=production` par apne aap `omit=dev` kar deta hai — devDependencies
install hi nahi hoti (`CLAUDE.md` me ye already noted hai, jest isi wajah se
gayab hota hai). `NODE_ENV=staging` par ye **nahi** hoga, yaani staging par jest
aur newman install ho jaayenge. Staging deploy me `npm ci --omit=dev` explicitly
likhna hoga.

---

## 3. Config architecture

### 3.1 Aaj ka problem

`process.env.*` **poore codebase me bikhra hua hai**:

| Variable | Kitni jagah padha jaata hai |
|---|---|
| `MONGO_URL` | **38** |
| `PUBLIC_API_URL` | **33** |
| `NODEMAILER_EMAIL` | 8 |
| `NODEMAILER_PASSWORD` | 5 |
| `TWO_FACTOR_API_KEY` | 3 |
| baaki ~45 vars | 1-2 each |

Iska matlab: koi ek jagah nahi hai jahan se pata chale ki app ko kya chahiye,
koi validation nahi hai, aur ek missing var ka pata **tab** chalta hai jab wo
code path pehli baar chalta hai — jo mahine baad ho sakta hai.

### 3.2 Target shape

```
server/
  configs/
    env/
      load.js        ← NODE_ENV padho, .env.<NODE_ENV> load karo, guards chalao
      schema.js      ← Joi schema: har var ka type, required/optional, default
      index.js       ← validated, frozen config object export karo
    cloudinary.js    ← ab config.media.cloudinary se padhega
    razorpay.js      ← ab config.payments.razorpay se
    s3.js            ← NAYA
    ...
```

Aur baaki code me:

```js
// pehle
const url = process.env.PUBLIC_API_URL;

// baad me
const { config } = require("../configs/env");
const url = config.urls.publicApi;
```

**Teen faayde, teenon aaj missing hain:**

1. **Fail fast** — boot par Joi poori env validate karega. Missing `JWT_SECRET`
   ya galat `MONGO_URL` ek saaf boot error hai, na ki teen hafte baad ek 500.
2. **Ek jagah sach** — naya dev ko ye doc + `schema.js` padhna kaafi hai. Aaj
   uske paas 60 files grep karne ke alawa koi rasta nahi.
3. **Environment-aware defaults** — `RATE_LIMIT_MAX` prod me 3000, dev me
   100000; `LOG_FORMAT` prod me `combined`, dev me `dev`. Ye schema me ek line
   hai, har call site par `??` nahi.

### 3.3 Loading order

```
1. NODE_ENV padho (default: "development")
2. Value validate karo — sirf development | staging | production
3. .env.<NODE_ENV> load karo   → na mile to FAIL (Guard 1)
4. CONFIG_PROFILE check karo   → mismatch to FAIL (Guard 2)
5. Joi schema se validate karo → missing/galat var par FAIL, saare naam ek saath
6. production ho to tier assertions chalao (Guard 3)
7. Object.freeze karke export
```

> ⚠️ Production par values file se nahi, **platform environment** (Render env
> vars / EC2 + AWS Secrets Manager) se aayengi. Wahan `.env.production` file
> nahi hogi — Guard 1 ko iske liye ek exception chahiye: agar `CONFIG_PROFILE`
> already environment me set hai to file optional hai. Yahi wo ek raasta hai
> jisse dev machine par bhi bypass ho sakta hai, isliye Guard 3 (DB naam +
> `rzp_live_` check) usi ke liye hai.

---

## 4. Service catalogue — category-wise

Har row me: provider, kaam, prod vs non-prod kya alag hoga, aur **galat hone par
kya toota**.

---

### A. Data store

| | |
|---|---|
| **Provider** | MongoDB Atlas |
| **Client** | `mongoose@^9.7.1` — [database/mongoDb.js](../database/mongoDb.js) |
| **Switch** | ✅ **Har tier alag** — dev, staging, prod teenon ka apna DB |

| Variable | Production | Staging | Development |
|---|---|---|---|
| `MONGO_URL` | prod cluster | `.../Trydood2_staging` | `.../Trydood2` |
| `MONGO_MAX_POOL_SIZE` | `20` | `10` | `5` |
| `MONGO_MIN_POOL_SIZE` | `2` | `1` | `1` |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `10000` | `10000` | `10000` |
| `MONGO_AUTO_INDEX` | `false` *(sirf `ensureIndexes.js --apply` ke baad)* | `true` | `true` |

**Alag databases jo already exist hain aur inhe chhedna nahi hai:**

| DB | Kaun banata hai |
|---|---|
| `Trydood2_test` | money suite (`__tests__/money/setup/testDb.js`) — `_test` guard load-bearing hai |
| `Trydood2_postman` | `scripts/seedPostmanFixtures.js` — collection fixtures |

⚠️ **Blast radius:** `MONGO_URL` galat tier par point kare to staging ka test
data production me likha jaayega, ya ulta. Guard 3 ka DB-naam check isi ke liye
hai. Boot ab DB ke bina start hi nahi hota (3 retry, phir `process.exit(1)`),
to galat URL ek failed deploy hai — silent nahi.

⚠️ `MONGO_MAX_POOL_SIZE` ki arithmetic: `pool × workers × instances`. Flex
cluster ka ceiling **500 per account** hai — aur wo ceiling **teenon tiers ke
liye ek hi hai** agar sab ek hi Atlas account par hain. Prod 20×4×3 = 240,
staging 10, dev 5 — 255, fits. Default 100 par yahi 1200 ho jaata.

---

### B. Payments — Razorpay (do alag merchants)

| | |
|---|---|
| **Provider** | Razorpay |
| **Client** | `razorpay@^2.9.6` — [configs/razorpay.js](../configs/razorpay.js) |
| **Switch** | ✅ **Prod = LIVE keys, non-prod = TEST keys** |

Yahan **do bilkul alag merchant accounts** hain, aur ye NODE_ENV se alag axis
hai — dono tiers me dono accounts chahiye:

| Account | Kis liye | Bank |
|---|---|---|
| `VENDOR` | vendor subscription purchase | Trydood vendor account |
| `CUSTOMER` | customer voucher claim | Trydood customer account |

Yaani **2 accounts × 2 tiers = 4 key sets.**

| Variable | Production | Non-prod (dev + staging) |
|---|---|---|
| `RAZORPAY_VENDOR_KEY_ID` | `rzp_live_…` | `rzp_test_…` |
| `RAZORPAY_VENDOR_SECRET` | live secret | test secret |
| `RAZORPAY_WEBHOOK_SECRETS` | live webhook secret(s) | test webhook secret(s) |
| `RAZORPAY_CUSTOMER_KEY_ID` | `rzp_live_…` | `rzp_test_…` |
| `RAZORPAY_CUSTOMER_SECRET` | live secret | test secret |
| `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS` | live | test |
| `RAZORPAY_BASEURL` | `https://api.razorpay.com/v1/payments/` | same |

`RAZORPAY_WEBHOOK_SECRET` (singular) legacy hai — `configs/razorpay.js` ise
list ki aakhri entry ke roop me padhta hai taaki purana env chalta rahe. Naye
env files me **sirf plural** rakhein.

> Webhook secrets **comma-separated list** hain, single value nahi — rotation ke
> liye. Naya add karo → dashboard me rotate karo → purana hatao. Single value
> ke saath rotation window me har delivery signature check fail karti hai aur
> uske peeche ka payment **chup-chaap kabhi settle nahi hota**.

⚠️ **Blast radius:** live keys non-prod me chali gayin to test click asli paisa
kaat lega. Isliye Guard 3 me `rzp_live_` prefix check hai. Boot par
`describeRazorpayAccounts()` already har account ka mode (`live`/`test`) print
karta hai — wo line deploy ke baad padhne layak hai.

⚠️ **Webhook URL bhi tier-specific hai.** Razorpay dashboard me har environment
ka apna webhook endpoint register karna padega, jo `PUBLIC_API_URL` par depend
karta hai. Dev par wo ngrok URL hoga (§L).

---

### C. Media storage — Cloudinary (aaj) → AWS S3 (target)

#### C1. Cloudinary — jo abhi chal raha hai

| | |
|---|---|
| **Provider** | Cloudinary |
| **Client** | `cloudinary@^2.10.0` — [configs/cloudinary.js](../configs/cloudinary.js) |
| **Switch** | ❌ **Aaj koi switch nahi — ek hi cloud sab jagah** |

| Variable | Aaj | Target |
|---|---|---|
| `CLOUD_NAME` | `dtpy1lbmf` | prod aur non-prod ke alag cloud/folder |
| `CLOUD_API_KEY` | ek | tier-wise |
| `CLOUD_SECRET` | ek | tier-wise |
| `CLOUD_BASE_URL` | `https://res.cloudinary.com/dtpy1lbmf` | tier-wise |
| `CLOUDINARY_URL` | `.env` me hai | ❌ **koi code nahi padhta — hatana hai** |

⚠️ **Abhi dev aur production ek hi Cloudinary account share karte hain.** Local
par ek category delete karna production ka asset uda deta hai. S3 migration ke
baad ye khud theek ho jaayega, par tab tak ye sach hai.

⚠️ `CLOUD_NAME` me `dtpy1lbmf #dbrkf1j5w` likha hai — commented-out purana
cloud. Aur `constants.js` ke `DEFAULT_IMAGES` ek **teesre** cloud (`drvdnqydw`)
par point karte hain. Teen cloud accounts ka nishaan hai, aur `deleteFile()`
sirf current `CLOUD_BASE_URL` wale assets delete kar sakta hai — baaki dono ke
assets **permanently orphan** hain.
(Details: [media_upload_map.md §8.2, §8.6](./media_upload_map.md))

#### C2. AWS S3 — target

| | |
|---|---|
| **Provider** | AWS S3 (+ CloudFront) |
| **Client** | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` *(abhi install nahi hai)* |
| **Switch** | ✅ **Prod tier alag bucket, dev+staging shared bucket alag prefix** |

| Variable | Production | Non-prod (dev + staging) |
|---|---|---|
| `AWS_REGION` | `ap-south-1` | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | prod IAM user | non-prod IAM user |
| `AWS_SECRET_ACCESS_KEY` | prod | non-prod |
| `S3_BUCKET_PUBLIC` | `trydood-prod-public` | `trydood-nonprod-public` |
| `S3_BUCKET_PRIVATE` | `trydood-prod-private` | `trydood-nonprod-private` |
| `S3_PREFIX` | *(khaali)* | `dev/` ya `staging/` |
| `CDN_BASE_URL` | `https://cdn.trydood.com` | non-prod CloudFront domain |

**Bucket layout:**

```
trydood-<tier>-public          ← CloudFront ke peeche, cacheable, immutable keys
  <prefix>brands/<brandId>/logo/<uuid>.webp
  <prefix>vouchers/<voucherId>/images/<uuid>.webp
  <prefix>showcase/<sectionId>/<uuid>.mp4
  <prefix>banners/<bannerId>/<uuid>.webp
  <prefix>categories/<categoryId>/<uuid>.webp
  <prefix>users/<userId>/avatar/<uuid>.webp

trydood-<tier>-private         ← Block Public Access ON, sirf presigned GET
  <prefix>documents/<year>/<series>/<documentNumber>.pdf
```

**Public/private ka split kyun** — aaj har invoice ek public, permanent
Cloudinary URL par baithi hai jisme naam, address, GSTIN aur amount hai.
`documentToken` revoke ho sakta hai, wo storage URL nahi
([media_upload_map.md §F-14](./media_upload_map.md)). Private bucket +
presigned URL (short TTL) is poore problem ko khatam kar deta hai — aur
`GET /documents/:token` ka public rehna bhi safe ho jaata hai, kyunki token ab
sach me ek credential ban jaata hai.

⚠️ **Aapke `.env` me abhi `S3_BUCKET_ADMIN` / `_CUSTOMER` / `_VENDOR` hain** —
role ke hisaab se teen. Ye teenon **replace ho rahe hain**, kyunki is system me
media role se nahi banta: ek showcase video vendor upload karta hai par customer
dekhta hai, aur ek invoice vendor aur customer dono ko dikhta hai. Asli farq
**public vs private** ka hai, role ka nahi. Purani teen keys hata dena.

⚠️ `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` abhi `.env` me hain hi nahi.
EC2 par inki jagah **IAM instance role** behtar hai — koi static key hi nahi,
to leak hone ke liye kuch nahi. Local dev ke liye ek restricted IAM user
chahiye jiske paas sirf non-prod buckets ka access ho.

---

### D. WhatsApp + SMS OTP — TENDIGIT

| | |
|---|---|
| **Provider** | TENDIGIT (WhatsApp Business + SMS) |
| **Client** | `axios` — [configs/whatsapp.js](../configs/whatsapp.js), [configs/tendigitOtp.js](../configs/tendigitOtp.js) |
| **Switch** | ⚠️ **Credentials same, templates aur delivery behaviour alag** |

Ek hi TENDIGIT account OTP aur notifications dono chalata hai.

| Variable | Production | Non-prod |
|---|---|---|
| `TENDIGIT_BASEURL` | same | same |
| `TENDIGIT_LICENSE` | prod license | test/sandbox license |
| `TENDIGIT_APIKEY` | prod | test |
| `TENDIGIT_TEMPLATE_ID` | approved OTP template | same |
| `WHATSAPP_TEMPLATE_*` (17 keys) | approved template names | **jaan-boojh kar khaali chhodein** |

**17 template keys**, notification type ke hisaab se:

```
WHATSAPP_TEMPLATE_SUBSCRIPTION_ACTIVATED / _EXPIRING / _EXPIRED / _RENEWED /
  _UPGRADED / _DOWNGRADED / _CANCELLED / _GRANTED
WHATSAPP_TEMPLATE_BRAND_APPROVED / _REJECTED / _UNDER_REVIEW / _RESUBMITTED /
  _ACTIVATED / _DEACTIVATED / _APPROVAL_REVOKED /
  _HIDDEN_FROM_CUSTOMERS / _VISIBLE_TO_CUSTOMERS
```

Jis type ka template set nahi hai wo WhatsApp par jaata hi nahi — in-app row aur
email phir bhi jaate hain. **Non-prod me inhe khaali rakhna hi sahi hai**: har
message ek asli phone par jaata hai aur uske paise lagte hain, aur test data ke
vendors ke numbers aksar asli logon ke hote hain.

⚠️ **Blast radius, aur ye sabse mehnga hai.** Prod credentials non-prod me chale
gaye to har test run se asli WhatsApp messages jaate hain, asli logon ko, aur
har ek ka bill aata hai. OTP throttle (`60s / 5 per hour`, target ke hisaab se)
isse kuch had tak rokta hai, par notification broadcasts par wo lagu nahi hota —
`broadcastNotification` ek call me hazaron logon ko bhej sakta hai.

**Recommendation:** non-prod me ek "safe mode" — recipient allowlist. Jo number
list me nahi, uska message log ho aur bheja na jaaye. Ye ek `NOTIFY_ALLOWLIST`
var se ho sakta hai jo sirf non-prod tier me set ho.

---

### D2. SMS OTP fallback — 2Factor

| | |
|---|---|
| **Provider** | 2Factor.in |
| **Client** | `2factor@^1.0.6` + direct `axios` — [helpers/otps/twofactor.js](../helpers/otps/twofactor.js), [helpers/twoFactor/](../helpers/twoFactor/) |
| **Switch** | ✅ Prod aur non-prod ke alag API key |

| Variable | Production | Non-prod |
|---|---|---|
| `TWO_FACTOR_API_KEY` | prod key | test key |

⚠️ **Base URL hardcoded hai** — `https://2factor.in/API/V1/...` **4 jagah**
([helpers/otps/twofactor.js:33,50](../helpers/otps/twofactor.js#L33),
[helpers/twoFactor/sendOtpToMobile.js:10](../helpers/twoFactor/sendOtpToMobile.js#L10),
[helpers/twoFactor/verifyOtpToMobile.js:10](../helpers/twoFactor/verifyOtpToMobile.js#L10)).
Baaki har provider (CGPEY, TENDIGIT, Razorpay) ka base URL env se aata hai.
Config layer me ise bhi `TWO_FACTOR_BASE_URL` bana dena chahiye — consistency ke
liye aur isliye ki provider ka domain badalna aaj 4 file edits hai.

⚠️ **Do alag OTP implementations hain** — `helpers/otps/twofactor.js` aur
`helpers/twoFactor/`. Dono same API hit karti hain, dono same env var padhti
hain. Config migration ke waqt ye tay karna hoga ki kaun si zinda hai.

---

### E. Email — Gmail SMTP

| | |
|---|---|
| **Provider** | Gmail SMTP (`service: "gmail"`) |
| **Client** | `nodemailer@^9.0.1` — [helpers/nodeMailer/sendMail.js](../helpers/nodeMailer/sendMail.js) |
| **Switch** | ✅ Prod aur non-prod ke alag mailbox |

| Variable | Production | Non-prod |
|---|---|---|
| `NODEMAILER_EMAIL` | `noreply@trydood.com` | ek test mailbox |
| `NODEMAILER_PASSWORD` | app password | test app password |
| `NODEMAILER_APP_NAME` | — | ❌ **`.env` me hai, koi code nahi padhta — hatana hai** |

Credentials na hone par `sendMail` `{ sent: false, skipped: true }` return karta
hai aur kuch nahi bhejta — yaani dev me ise **khaali chhodna ek valid choice**
hai.

⚠️ **`tls: { rejectUnauthorized: false }`**
([sendMail.js:22](../helpers/nodeMailer/sendMail.js#L22)) — TLS certificate
verification band hai. Production ke liye ye galat hai: koi bhi MITM SMTP
session padh sakta hai, aur usme OTP aur document links jaate hain. Config
layer me ye **tier-dependent** hona chahiye — prod me hamesha `true`.

⚠️ **Gmail production ke liye sahi provider nahi hai** — per-day sending limits
hain, aur bulk notifications par account block ho sakta hai. Production ke liye
Amazon SES (kyunki AWS par ja hi rahe hain) ya SendGrid dekhna chahiye. Ye is
doc ka scope nahi, par env split ke waqt socha jaana chahiye kyunki tab
`MAIL_PROVIDER` ek variable ban sakta hai.

---

### F. Push notifications — Firebase Cloud Messaging

| | |
|---|---|
| **Provider** | Firebase Cloud Messaging (HTTP v1) |
| **Client** | `axios` + `jsonwebtoken` (`firebase-admin` jaan-boojh kar nahi) — [configs/fcm.js](../configs/fcm.js) |
| **Switch** | ✅ **Alag Firebase project per tier** |

| Variable | Production | Non-prod |
|---|---|---|
| `FCM_PROJECT_ID` | prod project | dev project |
| `FCM_CLIENT_EMAIL` | prod service account | dev service account |
| `FCM_PRIVATE_KEY` | prod PEM | dev PEM |

⚠️ `FCM_PRIVATE_KEY` multi-line PEM hai. `.env` me literal `\n` escapes ke saath
quoted likhna padta hai; `configs/fcm.js` unhe wapas newlines me badalta hai.
**Har env file me ye same trap hai** — copy-paste karte waqt sabse aam galti.

⚠️ **Alag Firebase project kyun zaroori hai:** device tokens project-specific
hote hain. Ek hi project share karne ka matlab hai ki staging ka test push
production user ke phone par ja sakta hai, agar wo dono jagah registered hai.

Config na hone par `isFcmConfigured()` false deta hai aur push skip ho jaate
hain — dev me khaali chhodna valid hai.

---

### G. KYC / business verification — CGPEY

| | |
|---|---|
| **Provider** | CGPEY (PAN, GST, bank account verification) |
| **Client** | `axios` — [configs/cgpey.js](../configs/cgpey.js), [helpers/cgpeyAPIs/](../helpers/cgpeyAPIs/) |
| **Switch** | ✅ **Prod = live endpoints, non-prod = sandbox** |

| Variable | Production | Non-prod |
|---|---|---|
| `CGPEY_BASE_URL` | live | sandbox |
| `CGPEY_API_KEY` | prod | sandbox |
| `CGPEY_SECRET_KEY` | prod | sandbox |
| `CGPEY_MERCHANT_ID` | prod | sandbox |
| `CGPEY_PAN_ENDPOINT` | same path | same path |
| `CGPEY_GST_ENDPOINT` | same path | same path |
| `CGPEY_BANK_ENDPOINT` | same path | same path |
| `CGPEY_TIMEOUT` | `30000` | `30000` |

⚠️ **Blast radius:** har CGPEY call ke paise lagte hain aur wo asli PAN/GST
numbers query karti hai. Non-prod me live credentials ka matlab hai seed data ke
farzi PAN numbers par asli billed lookups. `verifyVendor` onboarding par
automatically chalta hai, to ye har test signup par hoga.

---

### H. Geo / location lookup — ❌ HATAYA JA CHUKA HAI

| | |
|---|---|
| **Provider** | *(tha: Nominatim-shaped reverse geocode + Indian PIN API)* |
| **Client** | *(tha: `axios` — `helpers/locations/`)* |
| **Status** | 🗑️ **Deleted** |

`helpers/locations/` ek **closed loop** tha — us folder ke bahar koi file use
import nahi karti thi. Uske andar sirf teen files thin, jo ek doosre ko call
karti thin, aur bas:

```
helpers/locations/index.js                     ← barrel, koi consumer nahi
helpers/locations/getLocationDetailsFromCoords.js
helpers/locations/getDistrictOrCityPostcode.js ← sirf upar wali file se call
```

Teenon `LOCATION_*` env vars bhi sirf usi folder ke andar padhe jaate the. Folder
aur teenon keys (`.env.example` se) hata di gayin.

> ⚠️ **`Location` model se confuse na hon.** `routes/locations.js` →
> `controllers/locations/` → `services/locations/` **poori tarah zinda hai** —
> wo customer address, brand address aur outlet address ka CRUD hai. Uska is
> geocode helper se koi rishta tha hi nahi: `services/locations/*` me se koi bhi
> `helpers/locations` import nahi karta tha. Isi tarah aggregation pipelines me
> `from: "locations"` wo **collection** hai, ye helper nahi.

Agar aage kabhi coordinates se address chahiye ho, to naya code likhna hoga —
purana wala kabhi kisi request path par chala hi nahi tha.

---

### I. Public URLs — links jo bahar jaate hain

| | |
|---|---|
| **Kaam** | Email buttons, WhatsApp links, push deep links, document download URLs |
| **Kahan** | [helpers/notifications/panelLinks.js](../helpers/notifications/panelLinks.js) |
| **Switch** | ✅ **Har tier bilkul alag** |

| Variable | Production | Staging | Development |
|---|---|---|---|
| `PUBLIC_API_URL` | `https://api.trydood.com` | staging API host | ngrok URL |
| `VENDOR_PANEL_URL` | `https://vendor.trydood.com` | staging panel | `http://localhost:3000` |
| `ADMIN_PANEL_URL` | `https://admin.trydood.com` | staging admin | `http://localhost:3001` |
| `CUSTOMER_APP_URL` | `https://app.trydood.com` | staging app link host | staging wala |

⚠️ **Inme se koi bhi unset ho to error nahi aata — button hi gayab ho jaata
hai.** `vendorUrl()` / `adminUrl()` / `documentUrl()` `undefined` return karte
hain aur renderer button chhod deta hai. Ye deliberate hai (dead link se behtar),
par iska matlab **ek missing var ka koi symptom nahi hai**. `logChannelStatus()`
boot par missing bases naam se print karta hai — wo line padhni chahiye.

⚠️ `CUSTOMER_APP_URL` unset ho to **10 customer emails apna button kho dete
hain**, jisme receipt aur bank-account maangne wala email bhi hai. Uska koi
fallback nahi.

⚠️ `PUBLIC_API_URL` **33 jagah** padha jaata hai aur har document download link
usi se banta hai. Dev par ngrok URL har restart par badalta hai — yaani dev me
purane generated links dead ho jaate hain. Ye theek hai, bas pata hona chahiye.

---

### J. Application secrets

| | |
|---|---|
| **Switch** | ⚠️ **Mila-jula — kuch alag hone CHAHIYE, kuch same rehne CHAHIYE** |

| Variable | Alag per tier? | Kyun |
|---|---|---|
| `JWT_SECRET` | ✅ **Zaroor alag** | Ek dev token production par kabhi kaam na kare. ⚠️ Badalne par us tier ke saare sessions logout ho jaate hain. |
| `JWT_EXPIRY` | ⚪ Same (`7d` type) | Behaviour hai, secret nahi. Dev me lamba rakh sakte hain. |
| `OTP_HMAC_SECRET` | ✅ Alag | OTP hashing. Badalne par sirf in-flight OTPs marte hain (5 min TTL) — sasta. |
| `MERCHANT_ID_SECRET` | 🔴 **Sab jagah SAME rehna chahiye** | Ye ek **CHARSET** hai jisse merchant id **generate** aur **validate** dono hote hain ([validator/common.js:2](../validator/common.js#L2), [helpers/brands/generateBrandMerchantId.js:4](../helpers/brands/generateBrandMerchantId.js#L4)). Alag hua to ek env me bana id doosre me **invalid** ho jaayega — aur production me badla to **har maujooda merchant id fail karne lagega**. |
| `STORE_ID_SECRET` | 🔴 **Sab jagah SAME** | Wahi baat, sub-brand store ids ke liye. |
| `DEFAULT_PASSWORD` | ⚪ Legacy | Ab sirf `scripts/clearSeededPasswords.js` padhta hai. Naye env files me **na daalein** — ye us purane bug ka bacha hua nishaan hai jahan har vendor/customer ka password ek hi shared string tha. |

🔴 `MERCHANT_ID_SECRET` / `STORE_ID_SECRET` — ye "secret" naam ke bawajood secret
ki tarah behave nahi karte. Inhe **kabhi rotate nahi karna**, aur env files me
teenon jagah **bilkul same** value likhni hai. Config schema me inhe explicitly
comment karna chahiye, warna koi agla banda "har env ka apna secret" samajh kar
teen alag daal dega aur ye chup-chaap toot jaayega — sirf naye records par, jo
mahine baad dikhega.

---

### K. Runtime / ops toggles

| | |
|---|---|
| **Switch** | ✅ **Values alag, sab optional (code me defaults hain)** |

| Variable | Production | Staging | Development | Default (aaj) |
|---|---|---|---|---|
| `PORT` | platform deta hai | `8080` | `8080` | `8080` |
| `NODE_ENV` | `production` | `staging` | `development` | — |
| `CONFIG_PROFILE` | `production` | `staging` | `development` | 🆕 naya |
| `TRUST_PROXY` | `1` (Render/ALB) ya `0` (bare EC2) | `1` | `0` | `1` |
| `RATE_LIMIT_MAX` | `3000` | `10000` | `100000` | `3000` |
| `LOG_FORMAT` | `combined` | `combined` | `dev` | env par depend |
| `ENABLE_JOBS` | `true` | `true` | `false` | on |

⚠️ **`ENABLE_JOBS` dev me `false` hona chahiye.** Aaj on hai. **21 background
jobs** registered hain ([jobs/index.js](../jobs/index.js)) — `buildSettlements`,
`expireSubscriptions`, `reconcileRefunds`, `alertVendorDebt`, `reapShadowIndexes`
aur baaki. Local machine par ye shared dev DB ke against chalte hain aur asli
notifications bhejte hain.

⚠️ **`TRUST_PROXY` galat set karna security issue hai.** Agar EC2 par kuch bhi
aage nahi hai aur `TRUST_PROXY=1` hai, to server caller ke apne likhe
`X-Forwarded-For` header par bharosa karega — yaani rate limiter poori tarah
bypass ho jaayega.

⚠️ **`RATE_LIMIT_MAX` per-process counter hai.** Do instances = effective limit
double. Load balancer ke peeche jaane par ise Redis me le jaana hoga, aadha
karne se nahi chalega.

---

### L. Development-only — ngrok tunnel

| | |
|---|---|
| **Provider** | ngrok |
| **Client** | `ngrok@^5.0.0-beta.2` — [index.js:204](../index.js#L204) |
| **Switch** | 🔴 **Sirf development. Production me hona hi nahi chahiye.** |

| Variable | Production | Staging | Development |
|---|---|---|---|
| `ENABLE_NGROK` | ❌ set hi nahi | ❌ | `true` |
| `NGROK_AUTH_TOKEN` | ❌ | ❌ | dev token |
| `NGROK_SUBDOMAIN` | ❌ | ❌ | optional (code me commented hai) |

Ngrok ka ekmatra kaam hai **Razorpay webhooks ko localhost tak pahunchana**.
Production me ye ek public tunnel hai jo saare gates ko bypass karta hai —
Guard 3 me `ENABLE_NGROK` set hone par production boot **fail** karna chahiye.

⚠️ `ngrok` `dependencies` me hai, `devDependencies` me nahi. Production build me
ye package install hoga hi. Ise `devDependencies` me le jaana chahiye aur import
ko lazy karna chahiye — warna `require("ngrok")` production me bhi load hota hai.

---

### M. Test-only

| Variable | Kahan |
|---|---|
| `TEST_DB_KEEP_CONNECTION` | `__tests__/money/setup/testDb.js` — debugging ke liye connection khula rakhta hai |
| `TZ` | `__tests__/money/mailRender.test.js` — `UTC` set karta hai |

Ye env files me nahi jaayenge — test command me inline set hote hain.

---

## 5. Poori env variable inventory

**89 rows** — aaj `.env` me **69** keys hain (jinme 17 WhatsApp templates), `.env.example`
me bhi ab **69** (teen `LOCATION_*` keys hata di gayin — §H). Baaki: **9 naye**
add karne hain, aur **8** aise hain jo code padhta hai par `.env` me nahi — unka
code me default maujood hai. Status column aaj ki haalat hai.

### Legend
- ✅ `.env` me hai aur code padhta hai
- 🟡 `.env` me hai, **koi code nahi padhta** → hatana hai
- 🔴 code padhta hai, `.env` me **nahi hai** → add karna hai
- ⚪ code padhta hai, `.env` me nahi, par **default hai** → optional

| # | Variable | Category | Status | Prod vs Non-prod |
|---|---|---|---|---|
| 1 | `MONGO_URL` | A. Data | ✅ | **alag** |
| 2 | `MONGO_MAX_POOL_SIZE` | A | ⚪ | alag |
| 3 | `MONGO_MIN_POOL_SIZE` | A | ⚪ | alag |
| 4 | `MONGO_SERVER_SELECTION_TIMEOUT_MS` | A | ⚪ | same |
| 5 | `MONGO_AUTO_INDEX` | A | ⚪ | **alag** |
| 6 | `RAZORPAY_VENDOR_KEY_ID` | B. Pay | ✅ | **alag (live/test)** |
| 7 | `RAZORPAY_VENDOR_SECRET` | B | ✅ | **alag** |
| 8 | `RAZORPAY_WEBHOOK_SECRETS` | B | ✅ | **alag** |
| 9 | `RAZORPAY_WEBHOOK_SECRET` | B | ✅ legacy | drop |
| 10 | `RAZORPAY_CUSTOMER_KEY_ID` | B | ✅ | **alag** |
| 11 | `RAZORPAY_CUSTOMER_SECRET` | B | ✅ | **alag** |
| 12 | `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS` | B | ✅ | **alag** |
| 13 | `RAZORPAY_BASEURL` | B | ✅ | same |
| 14 | `CLOUD_NAME` | C1. Media | ✅ | alag *(S3 tak)* |
| 15 | `CLOUD_API_KEY` | C1 | ✅ | alag |
| 16 | `CLOUD_SECRET` | C1 | ✅ | alag |
| 17 | `CLOUD_BASE_URL` | C1 | ✅ | alag |
| 18 | `CLOUDINARY_URL` | C1 | 🟡 | **hatao** |
| 19 | `AWS_REGION` | C2. S3 | 🟡 → ✅ | same |
| 20 | `AWS_ACCESS_KEY_ID` | C2 | 🔴 naya | **alag** |
| 21 | `AWS_SECRET_ACCESS_KEY` | C2 | 🔴 naya | **alag** |
| 22 | `S3_BUCKET_PUBLIC` | C2 | 🔴 naya | **alag** |
| 23 | `S3_BUCKET_PRIVATE` | C2 | 🔴 naya | **alag** |
| 24 | `S3_PREFIX` | C2 | 🔴 naya | **alag (dev/ vs staging/)** |
| 25 | `CDN_BASE_URL` | C2 | 🔴 naya | **alag** |
| 26 | `S3_BUCKET_ADMIN` | C2 | 🟡 | **hatao** |
| 27 | `S3_BUCKET_CUSTOMER` | C2 | 🟡 | **hatao** |
| 28 | `S3_BUCKET_VENDOR` | C2 | 🟡 | **hatao** |
| 29 | `TENDIGIT_BASEURL` | D. WA/SMS | ✅ | same |
| 30 | `TENDIGIT_LICENSE` | D | ✅ | **alag** |
| 31 | `TENDIGIT_APIKEY` | D | ✅ | **alag** |
| 32 | `TENDIGIT_TEMPLATE_ID` | D | ✅ | same |
| 33-49 | `WHATSAPP_TEMPLATE_*` ×17 | D | ✅ | **non-prod me khaali** |
| 50 | `TWO_FACTOR_API_KEY` | D2. SMS | ✅ | **alag** |
| 51 | `TWO_FACTOR_BASE_URL` | D2 | 🔴 naya | same *(aaj hardcoded)* |
| 52 | `NODEMAILER_EMAIL` | E. Mail | ✅ | **alag** |
| 53 | `NODEMAILER_PASSWORD` | E | ✅ | **alag** |
| 54 | `NODEMAILER_APP_NAME` | E | 🟡 | **hatao** |
| 55 | `FCM_PROJECT_ID` | F. Push | ✅ | **alag** |
| 56 | `FCM_CLIENT_EMAIL` | F | ✅ | **alag** |
| 57 | `FCM_PRIVATE_KEY` | F | ✅ | **alag** |
| 58 | `CGPEY_BASE_URL` | G. KYC | ✅ | **alag** |
| 59 | `CGPEY_API_KEY` | G | ✅ | **alag** |
| 60 | `CGPEY_SECRET_KEY` | G | ✅ | **alag** |
| 61 | `CGPEY_MERCHANT_ID` | G | ✅ | **alag** |
| 62 | `CGPEY_PAN_ENDPOINT` | G | ✅ | same |
| 63 | `CGPEY_GST_ENDPOINT` | G | ✅ | same |
| 64 | `CGPEY_BANK_ENDPOINT` | G | ✅ | same |
| 65 | `CGPEY_TIMEOUT` | G | ✅ | same |
| ~~66~~ | ~~`LOCATION_API`~~ | H. Geo | 🗑️ **hata diya** | — |
| ~~67~~ | ~~`LOCATION_HEADER`~~ | H | 🗑️ **hata diya** | — |
| ~~68~~ | ~~`LOCATION_PINCODE_API`~~ | H | 🗑️ **hata diya** | — |
| 69 | `PUBLIC_API_URL` | I. URLs | ✅ | **alag** |
| 70 | `VENDOR_PANEL_URL` | I | ✅ | **alag** |
| 71 | `ADMIN_PANEL_URL` | I | ✅ | **alag** |
| 72 | `CUSTOMER_APP_URL` | I | ✅ | **alag** |
| 73 | `JWT_SECRET` | J. Secrets | ✅ | **alag** |
| 74 | `JWT_EXPIRY` | J | ✅ | same |
| 75 | `OTP_HMAC_SECRET` | J | ✅ | **alag** |
| 76 | `MERCHANT_ID_SECRET` | J | ✅ | 🔴 **SAME rakhna hai** |
| 77 | `STORE_ID_SECRET` | J | ✅ | 🔴 **SAME rakhna hai** |
| 78 | `DEFAULT_PASSWORD` | J | ✅ legacy | drop |
| 79 | `PORT` | K. Ops | ✅ | alag |
| 80 | `NODE_ENV` | K | ✅ | **alag — yahi switch hai** |
| 81 | `CONFIG_PROFILE` | K | 🔴 naya | **alag — Guard 2** |
| 82 | `TRUST_PROXY` | K | ⚪ | **alag** |
| 83 | `RATE_LIMIT_MAX` | K | ⚪ | **alag** |
| 84 | `LOG_FORMAT` | K | ⚪ | **alag** |
| 85 | `ENABLE_JOBS` | K | ⚪ | **alag** |
| 86 | `NOTIFY_ALLOWLIST` | K | 🔴 naya | **sirf non-prod** |
| 87 | `ENABLE_NGROK` | L. Dev | ✅ | **sirf dev** |
| 88 | `NGROK_AUTH_TOKEN` | L | ✅ | **sirf dev** |
| 89 | `NGROK_SUBDOMAIN` | L | ✅ | **sirf dev** |

**Summary:** 3 hataye ja chuke (`LOCATION_*`), 6 aur hatane hain, 9 naye add karne hain.

---

## 6. Aaj ke env setup ke gaps

| # | Gap | Asar |
|---|---|---|
| ~~G-1~~ | ✅ **THEEK HO GAYA** — `LOCATION_*` teenon keys aur `helpers/locations/` folder delete. Wo helper kabhi kisi request path par chala hi nahi tha (closed loop), isliye "toota hua" hone ka koi asar bhi nahi tha | — |
| G-2 | `CLOUDINARY_URL`, `NODEMAILER_APP_NAME`, `S3_BUCKET_ADMIN/CUSTOMER/VENDOR` `.env` me hain par koi code nahi padhta | Padhne wale ko lagta hai ye kaam kar rahe hain. `S3_BUCKET_*` to poori tarah ek adhoora plan hai |
| G-3 | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` hain hi nahi, jabki `AWS_REGION` aur 3 buckets hain | S3 ka setup aadha shuru hua tha |
| G-4 | `constants.js:32` ka `NODE_ENV` enum dead hai, uppercase hai, aur `STAGING` nahi hai | Naye code ke liye ek galat reference maujood hai |
| G-5 | Dev aur production **ek hi Cloudinary account** share karte hain | Local delete production asset uda sakta hai |
| G-6 | `.env.example` aur `.env` ab dono me **69** keys hain — sync me. Par example me na tiers ka koi zikr hai, na AWS/S3 keys | Aaj example copy karna theek kaam karta hai, par 3 env files me split hone ke baad ek hi flat template kisi bhi environment ke liye sahi nahi rahega — har tier ka apna `.env.<tier>.example` chahiye |
| G-7 | `ENABLE_JOBS` dev me on hai | 21 background jobs local machine par shared dev DB ke against chalte hain aur asli notifications bhejte hain |
| G-8 | `2factor.in` base URL 4 jagah hardcoded | Provider ya endpoint badla to 4 file edits, aur non-prod ko sandbox par point nahi kar sakte |
| G-9 | `ngrok` `dependencies` me hai, `devDependencies` me nahi | Production install me ek dev-only tunneling library shipped hoti hai |
| G-10 | nodemailer me `rejectUnauthorized: false` | Production me TLS verification off — MITM SMTP padh sakta hai, aur usme OTP aur document links jaate hain |

---

## 7. Media flow ke woh findings jinka seedha rishta env split se hai

Poori list [media_upload_map.md §8](./media_upload_map.md) me hai. Ye chaar
S3 design ko **directly** shape karte hain:

| Finding | S3 design me iska jawab |
|---|---|
| **F-12** — `mimetype` client-controlled hai (busboy ise multipart part ke `Content-Type` header se leta hai, content sniff nahi hota). Aaj Cloudinary reject kar deta hai isliye bacha hua hai | S3 me ye bachav khatam. Upload se pehle **magic-byte sniffing** (`file-type` package), aur `ContentType` sniffed value se set hoga — client ke bheje header se nahi |
| **F-13** — voucher images me `image/svg+xml` allowed hai (`mimetype.startsWith("image/")`) | Har domain ke liye explicit **allowlist**, SVG kahin nahi. Aur public bucket par `Content-Disposition: attachment` un types ke liye jo inline render ho sakte hain |
| **F-14** — PDF ka `public_id` `Math.random()` se banta hai, aur Cloudinary URL public + permanent hai | Documents **private bucket** me, key `crypto.randomUUID()`, access sirf short-TTL presigned GET se. `documentToken` tab sach me credential ban jaata hai |
| **§8.10** — `/tmp/` kabhi saaf nahi hota, har uploaded file ki copy permanently padi rehti hai | S3 shift ke saath hi decide karna hai: temp file rakhein (aur cleanup middleware lagayein) ya memory/stream par jaayein ya presigned direct-upload par |

---

## 8. Rollout order

Har step apne aap me complete hai aur alag se test ho sakta hai. **Media aur S3
sabse aakhir me**, kyunki unhe ek kaam karti hui config layer chahiye.

| Step | Kya | Kyun is order me |
|---|---|---|
| **1** | `configs/env/` layer + Joi schema + 3 guards. Abhi **koi behaviour nahi badalna** — sirf `process.env` ki jagah `config` padhna | Ye foundation hai. Iske bina S3 selection ke paas koi bharosemand `NODE_ENV` hi nahi |
| **2** | 3 env files banao, baaki gaps (G-2, G-3, G-6) theek karo, dead enum (G-4) hatao. *(G-1 ho chuka)* | Ab har environment ka setup likha hua aur validated hai |
| **3** | Tier-specific values on karo — `ENABLE_JOBS`, `RATE_LIMIT_MAX`, `LOG_FORMAT`, `MONGO_AUTO_INDEX`, `NOTIFY_ALLOWLIST` | Sabse kam risk wale switches pehle. Yahin pata chalta hai ki guards sach me kaam karte hain |
| **4** | Ownership fix — `brandFeatures` me `resolveActorBrand` (F-11) | Security fix hai, S3 par wait karne ki koi wajah nahi. Aur ye batata hai ki naye media code me ownership kahan lagti hai |
| **5** | Media validation layer — magic-byte sniffing, SVG block, size limits, `/tmp` cleanup (F-12, F-13, §8.1, §8.10) | **Cloudinary par hi.** Provider badalne se pehle validation theek karo, warna dono cheezein ek saath debug karni padengi |
| **6** | S3 provider — `storage.provider` par dual-read, naye uploads S3 par, purane Cloudinary URLs chalte rahein | `storage.provider` enum aur `deleteMedia` ka switch **already maujood hai**. Naya provider ek naya `case` hai, rewrite nahi |
| **7** | Documents → private bucket + presigned GET (F-14) | Alag step, kyunki iska access model public media se bilkul alag hai |
| **8** | CloudFront + image resizing + delivery | Iske bina S3 par shift Cloudinary se **dheema** hoga — §9 dekhen |
| **9** | Purane Cloudinary assets ka migration ya sunset | Aakhir me, jab dono raste kaam kar rahe hon |

---

## 9. Ab bhi jo decide karna baaki hai (agla doc)

Ye chaar sawaal S3 design doc ko shape karenge. Inka jawab abhi nahi chahiye,
par doc likhne se pehle chahiye.

### D-1 · Upload server ke through ya presigned direct-to-S3?

| | Server ke through (aaj jaisa) | Presigned direct |
|---|---|---|
| Speed | har byte Node se guzarta hai | **client seedha S3 par — bahut tez** |
| Server load | disk + RAM + bandwidth | lagbhag zero |
| Validation | poori, upload se pehle | presigned policy (size/type) + upload ke baad verify |
| Client change | **koi nahi** | mobile app + dono panels badalne padenge |
| 50 MB video | server par 50 MB, phir S3 par 50 MB | ek baar, seedha |

Aapne "fast uploading" kaha tha — bade videos ke liye asli jawab presigned hi
hai. Par ye ek client-side change hai, sirf backend ka nahi.

### D-2 · Image resizing kahan hoga?

Ye sabse important performance sawaal hai. **Aaj Cloudinary
`f_auto,q_auto` free me deta hai. S3 ye kuch nahi deta.** Bina iske S3 par shift
karne se **delivery dheemi ho jaayegi**, tez nahi — mobile list view par poori
resolution wali original image jaayegi.

| Option | Kaise | Trade-off |
|---|---|---|
| Upload par variants | `sharp` se 3-4 size + WebP, sab S3 par | Simple, predictable cost. Upload thoda slow, storage zyada |
| CloudFront + Lambda@Edge | on-the-fly resize, URL me size | Flexible, pay-per-use. Pehli request slow (cold) |
| AWS Serverless Image Handler | ready-made CloudFront+Lambda stack | Sabse kam kaam, kam control |

### D-3 · Purane Cloudinary assets ka kya?

`storage.provider` enum aur `deleteMedia` ka provider switch already maujood
hai, to **dual-read lagbhag free hai**. Par kuch fields bare URL string hain
(`User.image`, `Brand.logo`, `Category.image`, `BrandFeatures.icon`) — unke paas
`storage` object hai hi nahi, to provider sirf URL ke host se pata chalega.
Sawaal: sab migrate karein, ya naya S3 par aur purana Cloudinary par chalta rahe?

### D-4 · `S3_BUCKET_ADMIN/CUSTOMER/VENDOR` ka original plan kya tha?

Maine inhe public/private se replace kiya hai (§C2 me wajah likhi hai). Agar
aapke man me role-wise buckets ki koi khaas wajah thi — jaise alag IAM boundary
ya alag AWS account — to bataiye, main design usi hisaab se badal dunga.

---

## 10. Reference

```
configs/
  cloudinary.js       C1   CLOUD_NAME, CLOUD_API_KEY, CLOUD_SECRET
  razorpay.js         B    2 accounts × keyId/secret/webhookSecrets
  whatsapp.js         D    TENDIGIT_* + 17 × WHATSAPP_TEMPLATE_*
  tendigitOtp.js      D    TENDIGIT_* + OTP_HMAC_SECRET
  fcm.js              F    FCM_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY
  cgpey.js            G    CGPEY_BASE_URL, CGPEY_TIMEOUT
  render.js           —    api.ipify.org (hardcoded, /my-ip ke liye)

database/mongoDb.js   A    MONGO_URL + 4 pool/index vars
helpers/otps/         D2   TWO_FACTOR_API_KEY  (base URL hardcoded)
helpers/twoFactor/    D2   TWO_FACTOR_API_KEY  (base URL hardcoded)
helpers/nodeMailer/   E    NODEMAILER_EMAIL, NODEMAILER_PASSWORD
helpers/notifications/panelLinks.js
                      I    PUBLIC_API_URL, VENDOR_PANEL_URL,
                           ADMIN_PANEL_URL, CUSTOMER_APP_URL
validator/common.js   J    MERCHANT_ID_SECRET, STORE_ID_SECRET  ← same rakhein
index.js              K    PORT, NODE_ENV, TRUST_PROXY, RATE_LIMIT_MAX,
                           LOG_FORMAT, ENABLE_NGROK
jobs/index.js         K    ENABLE_JOBS — 21 registered jobs
```
