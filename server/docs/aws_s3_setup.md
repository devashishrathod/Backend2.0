# AWS S3 — poora setup runbook

> Ye **karne** wala doc hai, design nahi. Design
> [s3_media_migration_plan.md](./s3_media_migration_plan.md) me hai, phases
> [s3_migration_phases.md](./s3_migration_phases.md) me.
>
> 🚀 **Production par jaane ka sequence is doc me nahi hai** — wo
> [production_go_live_runbook.md](./production_go_live_runbook.md) me hai: kram,
> har kadam ka verify, rollback, aur env. Ye doc sirf AWS **banane** ka hai.

> ## 📌 Status — 2026-09-19 ko naapa gaya, andaaz nahi
>
> **Ye line pehle kehti thi "AWS par abhi kuch nahi bana". Wo ab sach nahi.**
>
> | Cheez | Naap | Kaise naapa |
> |---|---|---|
> | `trydood-nonprod-public` | ✅ **maujood** | signed `GetObject` par `AccessDenied`, `NoSuchBucket` nahi |
> | `trydood-nonprod-private` | ✅ **maujood** | wahi |
> | `trydood-prod-public` | ✅ **maujood** | wahi |
> | `trydood-prod-private` | ✅ **maujood** | wahi |
> | Region | `ap-south-1` | anonymous GET par koi `PermanentRedirect` nahi aaya |
> | Block Public Access (dono public) | ✅ **ON** | anonymous GET → `403` |
> | IAM policy ka daayra | ✅ tang hai | missing key par `NoSuchKey` nahi, `AccessDenied` — yaani `s3:ListBucket` nahi diya gaya, jo §5.1 ka iraada hai |
> | **CloudFront** | ❌ **nahi bana** | `cdn.trydood.com` resolve hi nahi hota (connect fail) |
> | Code ki taraf | ✅ Phase **0–5 poore** | facade, S3 provider, presign+confirm, 6 surfaces, private PDF |
>
> 🔴 **Bacha sirf CloudFront + DNS.** Buckets ban chuke hain aur unki Block Public
> Access sahi hai (CloudFront + OAC ke liye wo **ON** hi honi chahiye — §2.2).
>
> ⚠️ `AccessDenied` ye sabit karta hai ki **naam maujood hai**, ye nahi ki wo
> hamara hi account hai — bina `s3:ListBucket` ke dono ek jaise dikhte hain. Prod
> par likhne wala probe maine **jaan-bujh kar nahi chalaya**. Ownership console se
> confirm karein; ya panel se switch karte waqt `checkS3Ready()` khud likh-padh kar
> bata dega.

---

## 0. Ek nazar me — kya banana hai

| Cheez | Kitne |
|---|---|
| S3 bucket | **4** |
| CloudFront distribution | **2** (har public bucket ke liye ek) |
| IAM user | **2** (Render ke liye) |
| IAM role | **1-2** (EC2 ke liye) |
| IAM policy | **2** (prod ke liye ek, non-prod ke liye ek) |

Region har jagah **`ap-south-1`** (Mumbai) — customers India me hain, aur wo
already `.env` me set hai.

---

## 1. Faisla: public + private, role se nahi

`.env` me abhi teen bucket naam pade hain — `trydood-admin`,
`trydood-customer`, `trydood-vendor`. Koi bhi **runtime** code unhe padhta nahi
(sirf [configs/env/load.js:156](../configs/env/load.js#L156) ka production guard
dekhta hai — §10.1). Wo naam role ke hisaab se hain, aur ye split is system me
kaam nahi karta.

Wajah sawaal me hai. Sawaal ye **nahi** hai ki kaun upload karta hai — ye hai ki
**kaun dekh sakta hai**:

| Media | Upload | Dekhta kaun hai |
|---|---|---|
| Brand logo | vendor / admin | **guest bhi** (`GET /brands/customer/get-all` PUBLIC) |
| Showcase video | vendor | **guest bhi** (`GET /showcase/get-brand-showcase/:x` PUBLIC) |
| Voucher image | vendor | **guest bhi** (`optionalAuth`) |
| Banner, category, ticker | admin | **guest bhi** |
| Customer profile photo | customer | customer + admin panel |
| **PDF documents** | server khud | vendor **aur** customer, dono |

`trydood-vendor` bucket me wo cheezein hoti jo sirf customer aur guest dekhte
hain. Aur ek invoice — vendor wale me ya customer wale me? Dono use dekhte hain.

**Uploader ka role ye batata hi nahi ki file khuli rakhi ja sakti hai ya nahi.**

### 🔴 Isliye asli line yahi hai

```
PUBLIC   guest bhi dekh sakta hai · CloudFront ke peeche · cacheable
         logo · category · subcategory · showcase · banner · ticker · voucher image

PRIVATE  credential ke bina kuch nahi · sirf presigned GET, short TTL
         saare 6 PDF documents
```

Aaj har invoice ek **public, permanent** Cloudinary URL par hai jiska `public_id`
`Math.random()` se bana hai, aur usme naam, address, GSTIN aur amount hai.
`documentToken` revoke ho sakta hai — **wo URL nahi**. Private bucket is poore
problem ko khatam karta hai.

> ⚠️ Purane teen naam `.env` me **rehne diye gaye hain**, hataye nahi. Code unhe
> use nahi karta. Jab S3 par pura shift ho jaaye, tab ek saath hatana.

---

## 2. Buckets — 4, aur kyun 4

| Bucket | Tier | Prefix | Block Public Access |
|---|---|---|---|
| `trydood-prod-public` | production | *(khaali)* | ⚠️ **OFF** (CloudFront ke liye — §2.2) |
| `trydood-prod-private` | production | *(khaali)* | ✅ **ON, poora** |
| `trydood-nonprod-public` | dev + staging | `dev/` · `staging/` | ⚠️ OFF |
| `trydood-nonprod-private` | dev + staging | `dev/` · `staging/` | ✅ ON, poora |

**Production apna alag kyun:** taaki ek galat prefix, ek galat credential, ya ek
galat `CONFIG_PROFILE` bhi production ka data na chhu sake. Dev aur staging ek
bucket share karte hain kyunki dono ka data barabar disposable hai.

### 2.1 Console se banana

**S3 → Create bucket**, har ek ke liye:

```
Bucket name          trydood-prod-public
AWS Region           Asia Pacific (Mumbai) ap-south-1
Object Ownership     ACLs disabled (recommended)
Block Public Access  §2.2 dekho — public aur private me alag
Bucket Versioning    Disable
Default encryption   SSE-S3 (Amazon S3 managed keys)
```

CLI se:

```bash
for b in trydood-prod-public trydood-prod-private \
         trydood-nonprod-public trydood-nonprod-private; do
  aws s3api create-bucket --bucket "$b" --region ap-south-1 \
    --create-bucket-configuration LocationConstraint=ap-south-1
done
```

### 2.2 ⚠️ Block Public Access — do buckets par do alag setting

**PRIVATE buckets — chaaron option ON.** Ye default hai, kuch mat badlo.

**PUBLIC buckets — bhi chaaron ON rakhein.**

Ye ulta lagta hai, par sahi hai: object **bucket se** public nahi honge, wo
**CloudFront se** serve honge. CloudFront ko **Origin Access Control (OAC)** se
access milega, aur bucket policy sirf CloudFront ko padhne degi.

```
Bucket khud     → band rahega, internet se koi object nahi milega
CloudFront       → padh sakta hai (OAC)
Customer/guest   → CloudFront URL se dekhte hain
```

**Faayda:** bucket ka direct URL kabhi kaam nahi karega, to koi CloudFront ko
bypass karke original (bina resize, bina cache) nahi kheench sakta — aur bill
CloudFront par rahega, S3 GET par nahi.

### 2.3 CORS — sirf PUBLIC buckets par

⚠️ **Iske bina panel ka upload fail hoga**, aur error browser console me ek
bematlab CORS message hoga jisse kuch samajh nahi aayega.

Presigned POST me **browser seedha S3 par** POST karta hai — wo cross-origin hai.

**S3 → bucket → Permissions → CORS:**

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["POST", "PUT", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://admin.trydood.com",
      "https://vendor.trydood.com",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    "ExposeHeaders": ["ETag", "Location"],
    "MaxAgeSeconds": 3000
  }
]
```

> ⚠️ `AllowedOrigins` me `"*"` mat likhiye. Mobile app ko CORS lagu hi nahi hota
> (wo browser ka niyam hai), to sirf panel ke asli domain aur local dev ports
> chahiye. Apne asli panel domains se badal lijiye.

### 2.4 Lifecycle rule — `staging/` prefix, 1 din

Presigned upload me ek beech ka kadam hai: file pehle `staging/` prefix par
jaati hai, phir confirm hone par asli jagah copy hoti hai. Client agar beech me
gayab ho gaya (app crash, net gaya, cancel) to wo file wahin reh jaati hai.

**Ye rule use apne aap saaf kar deta hai — koi cron nahi, koi code nahi.**

**S3 → bucket → Management → Lifecycle rule → Create:**

```
Rule name      expire-unconfirmed-uploads
Prefix         staging/
Action         Expire current versions of objects
Days after creation  1
```

Chaaron buckets par lagayein.

> ⚠️ Ye `staging/` **prefix** hai, `STAGING` **tier** nahi. Naam ek jaisa hai par
> rishta koi nahi — `staging/` ka matlab "abhi confirm nahi hua" hai. Tier ka
> prefix uske andar aata hai: `dev/staging/…`, `staging/staging/…`.

---

## 3. CloudFront — sirf public buckets ke liye

**CloudFront → Create distribution**, `trydood-prod-public` aur
`trydood-nonprod-public` ke liye ek-ek:

```
Origin domain              trydood-prod-public.s3.ap-south-1.amazonaws.com
Origin access              Origin access control settings (recommended)
                           → Create new OAC → Sign requests
Viewer protocol policy     Redirect HTTP to HTTPS
Allowed HTTP methods       GET, HEAD
Cache policy               CachingOptimized
Price class                Use only North America, Europe, Asia…  (India cover)
Alternate domain (CNAME)   cdn.trydood.com        ← optional, par behtar
Custom SSL certificate     ACM cert (us-east-1 me banana hoga)
```

⚠️ **ACM certificate `us-east-1` me hi banana padta hai** — CloudFront sirf wahan
se certificate leta hai, chahe bucket Mumbai me ho. Ye ek aam jagah hai atakne ki.

OAC banane ke baad CloudFront ek **bucket policy** dikhata hai — use copy karke
bucket par lagaiye. Wo aisi hoti hai:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontServicePrincipal",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::trydood-prod-public/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DIST_ID>"
      }
    }
  }]
}
```

### 3.1 ⚠️ `staging/` ko CloudFront se band karein

Wo prefix un files ka hai jo **abhi validate nahi hui**. Unhe ek public URL
milna nahi chahiye.

**Distribution → Behaviors → Create behavior:**

```
Path pattern          staging/*
Viewer protocol       HTTPS only
Allowed methods       GET, HEAD
Cache policy          CachingDisabled
Response headers      —
→ aur is behavior ko ek aise origin par bhejein jo 403 de,
  ya CloudFront Function se seedha 403 return karein
```

Sabse aasan: ek CloudFront Function jo `staging/` par `403` lauta de.

---

## 4. Key layout — file kahan jaayegi

Shape: **`<prefix><type>/<entity>/<entityId>/<uuid>.<ext>`**

```
trydood-<tier>-public
  <prefix>staging/<userId>/<uuid>.<ext>          ← confirm hone se pehle

  <prefix>images/brands/<brandId>/<uuid>.webp
  <prefix>images/categories/<categoryId>/<uuid>.webp
  <prefix>images/showcase/<sectionId>/<uuid>.webp
  <prefix>images/banners/<bannerId>/<uuid>.webp
  <prefix>images/vouchers/<voucherId>/<uuid>.webp
  <prefix>images/users/<userId>/<uuid>.webp

  <prefix>videos/showcase/<sectionId>/<uuid>.mp4
  <prefix>videos/banners/<bannerId>/<uuid>.mp4

  <prefix>gifs/banners/<bannerId>/<uuid>.gif

trydood-<tier>-private
  <prefix>documents/<year>/<series>/<documentNumber>.pdf
```

`<prefix>`: production me **khaali**, dev me `dev/`, staging me `staging/`.

**Type sabse upar kyun** — kyunki teen infra cheezein prefix par chalti hain:
`images/*` par resize Lambda ka CloudFront behaviour (§3), `videos/*` par
Infrequent Access lifecycle, aur 🔴 **`gifs/*` resizer se bahar** — ek animated
GIF ko resize karne ka matlab hai uski animation khatam.

**Entity uske andar kyun** — taaki key dekh kar pata chale file kiski hai.
Cloudinary par aaj sab ek flat `Images/` me random id ke saath hai, isliye orphan
media dhoondhna hi namumkin hai.

### ⚠️ Har upload ka naya `uuid` — kabhi overwrite nahi

Isi wajah se CloudFront par
`Cache-Control: public, max-age=31536000, immutable` safe hai aur **kabhi
invalidation nahi chahiye**. Purana object delete hone par uska URL 404 dega —
jo sahi hai, kyunki row bhi ja chuki hogi.

Agar key reuse karte (jaise `brands/<id>/logo.webp`), to har logo badalne par
CloudFront invalidation chalani padti — jo paisa bhi leti hai aur bhoolne par
purana logo mahino dikhta rehta.

---

## 5. IAM — kya banana hai

### 5.1 Do policy

**`TrydoodS3Prod`** — sirf production buckets:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": [
      "arn:aws:s3:::trydood-prod-public/*",
      "arn:aws:s3:::trydood-prod-private/*"
    ]
  }]
}
```

**`TrydoodS3NonProd`** — wahi, `trydood-nonprod-*` ke saath.

⚠️ **`s3:ListBucket` jaan-boojh kar nahi hai, aur `s3:*` to bilkul nahi.** Agar
credential kabhi leak ho, to uske paas bucket list karne ka, naya bucket banane
ka, policy badalne ka, ya kisi doosre bucket ko chhune ka rasta **hai hi nahi**.
Sirf naam se object padhna, likhna, hataana.

> `ListBucket` ki zarurat tab padegi jab koi cleanup script orphan objects
> dhoondhe. Tab ek **alag** policy banegi, ek alag identity ke liye — app ke
> runtime credential me nahi.

⚠️ **Iska ek aur asar hai:** `HeadBucket` bhi kaam nahi karega (use `ListBucket`
chahiye). Isiliye boot par koi S3 "ping" nahi hoga — sirf ek credential-source
line (§6.3), aur setup ke baad §7 ke probe. Poori wajah
[s3_migration_phases.md §2.6.1](./s3_migration_phases.md) me.

### 5.2 Do user (Render ke liye)

| User | Policy | Kiske liye |
|---|---|---|
| `trydood-app-nonprod` | `TrydoodS3NonProd` | Render dev + Render staging backup |
| `trydood-app-prod` | `TrydoodS3Prod` | *(sirf agar production kabhi Render par chale)* |

**IAM → Users → Create user → Attach policies directly → Create access key →
Application running outside AWS.**

🔴 **Non-prod user ko production policy kabhi mat dijiye.** Yahi wo cheez hai jo
laptop ki ya Render ki key ko production data se door rakhti hai — chahe koi
galti se `CONFIG_PROFILE=PRODUCTION` set kar de.

### 5.3 Role (EC2 ke liye)

**IAM → Roles → Create role → AWS service → EC2 →** wahi policy attach karein,
naam `TrydoodAppProd` / `TrydoodAppStaging`. Phir **EC2 instance → Actions →
Security → Modify IAM role**.

Role par **koi key hoti hi nahi**, aur AWS credentials har kuch ghante apne aap
badal deta hai.

---

## 6. Code me kya dena hai — aur kya **nahi**

### 6.1 Ek hi code, dono host

AWS SDK v3 me **default credential provider chain** hai. Credentials pass **na
karein**, to wo khud kram se dhoondhta hai:

```
1. explicit credentials (jo code me do)
2. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   ← Render yahan milega
3. ~/.aws/credentials
4. ECS container credentials
5. EC2 instance metadata (IMDS)                ← EC2 yahan milega
```

Isliye code me bas:

```js
// configs/s3.js
new S3Client({ region: config.AWS_REGION });
```

**Koi `if` nahi, koi branch nahi.** Render par env keys mil jaati hain, EC2 par
instance role. Farq sirf itna ki kis host par kaunse env vars set hain.

### 6.2 Env vars — host ke hisaab se

| | Profile | Host | `AWS_ACCESS_KEY_ID` / `SECRET` | Buckets |
|---|---|---|---|---|
| Development | `DEVELOPMENT` | Render | ✅ non-prod user | `trydood-nonprod-*` |
| Staging | `STAGING` | **AWS** | ❌ *(role)* | `trydood-nonprod-*` |
| Staging backup | `STAGING` | Render | ✅ **wahi** non-prod user | `trydood-nonprod-*` |
| Production | `PRODUCTION` | **AWS** | ❌ *(role)* | `trydood-prod-*` |

Naye env vars:

```ini
AWS_REGION=ap-south-1
S3_BUCKET_PUBLIC=trydood-nonprod-public
S3_BUCKET_PRIVATE=trydood-nonprod-private
S3_PREFIX=dev/                                 # staging par staging/, prod par khaali
CDN_BASE_URL=https://cdn.trydood.com

# sirf Render par — EC2 par ye do lines hoti hi nahi
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
```

> Ye `configs/env/schema.js` me jodenge jab Phase 2 ka S3 provider banega, taaki
> ek missing bucket naam boot par pakda jaaye — runtime par nahi.

### 6.3 🔴 Ek khatra jo chain ke kram me chhupa hai

Env keys **instance role ko haraati hain** (step 2 step 5 se pehle hai).

To ye ho sakta hai: EC2 par jaate waqt role attach kar dein par **purani
Render-wali keys env se hataana bhool jaayein**. Tab —

- server chalta rahega ✅
- par **purani keys** use hongi, role nahi
- jis din wo keys revoke hongi, **production uploads chup-chaap band**
- aur kahin kuch nahi kahega ki wajah kya thi

**Ilaaj:** boot par ek line, bilkul waise jaise `logPaymentAccounts()` abhi karta
hai:

```
✅ [s3] prod-public / prod-private · ap-south-1 · credentials: instance role
⚠️  [s3] nonprod-public / nonprod-private · ap-south-1 · credentials: environment key (…7Q)
```

Key ke sirf **aakhri 4 akshar**, taaki pata chale *kaunsi* key hai aur secret
kahin na jaaye. Aur `CONFIG_PROFILE=PRODUCTION` ke saath env key mile to boot par
saaf warning — wo galti tab dikhegi jab theek karna aasan hai.

---

## 7. Verify — sab theek laga ya nahi

```bash
# 1. bucket bane?
aws s3 ls | grep trydood

# 2. Block Public Access — chaaron true hone chahiye
aws s3api get-public-access-block --bucket trydood-prod-public

# 3. CORS laga?
aws s3api get-bucket-cors --bucket trydood-nonprod-public

# 4. lifecycle laga?
aws s3api get-bucket-lifecycle-configuration --bucket trydood-nonprod-public

# 5. credential ke paas sirf utna access hai jitna chahiye —
#    ye SUCCEED hona chahiye
aws s3api put-object --bucket trydood-nonprod-public \
  --key dev/__probe.txt --body /dev/null

#    …aur ye FAIL hona chahiye (AccessDenied). Agar succeed kare to
#    policy bahut chaudi hai.
aws s3 ls s3://trydood-nonprod-public
aws s3api put-object --bucket trydood-prod-public --key __probe.txt --body /dev/null

# 6. saaf karo
aws s3api delete-object --bucket trydood-nonprod-public --key dev/__probe.txt
```

⚠️ Step 5 ka doosra hissa **sabse zaroori hai**. Agar non-prod credential se
`trydood-prod-public` par likha ja saka, to policy galat hai — aur us galti ka
pata us din chalega jis din dev ka data production me chala jaayega.

---

## 8. EC2 par jaate waqt

1. Role banaiye aur instance par attach kijiye (§5.3)
2. **`AWS_ACCESS_KEY_ID` aur `AWS_SECRET_ACCESS_KEY` env se hataiye**
3. Restart karke boot line dekhiye — `credentials: instance role` aana chahiye
4. IAM se purana user ki access key **delete** kijiye (deactivate nahi — delete)

**Code me kuch nahi badalna.**

---

## 9. Key rotation — jab tak Render par hain

Static key ek asli secret hai. AWS ek user par **do key ek saath** allow karta
hai, isi wajah se:

```
1. nayi key banao        (ab do hain, dono chalti hain)
2. Render env me nayi daalo → redeploy → boot line se confirm karo
3. purani key DELETE karo  (deactivate nahi — delete)
```

Har **90 din**. Downtime zero, kyunki beech me dono zinda hoti hain.

---

## 10. Kya **nahi** karna

| ❌ | Kyun |
|---|---|
| Bucket ko public-read karna | Private bucket ka poora point hi khatam. Invoice me naam, address, GSTIN, amount hai |
| CORS me `"*"` | Koi bhi site aapke panel ke naam par upload karwa sakti hai |
| `s3:*` ya `Resource: "*"` | Ek leaked key se poora AWS account |
| Key `.env.example` me likhna | Wo file git me jaati hai. Sirf naam, value kabhi nahi |
| Non-prod user ko prod policy | Laptop ki key production data chhu legi |
| Key reuse (`logo.webp`) | Har badlaav par CloudFront invalidation, aur bhoolne par purana logo mahino dikhega |
| Purane teen bucket naam abhi hataana | Env doc me hain, S3 shift poora hone par ek saath hatenge — par §10.1 padhiye |

### 10.1 🔴 Purane teen naam production boot **rok denge**

[configs/env/load.js:156](../configs/env/load.js#L156) ka Guard 3 kehta hai: agar
`CONFIG_PROFILE=PRODUCTION` hai, to har set bucket naam me `prod` hona chahiye.

Aaj `.env` me `S3_BUCKET_ADMIN=trydood-admin` hai — usme `prod` nahi hai. To
production me wahi `.env` le jaate hi boot **fail** hoga:

```
CONFIG_PROFILE is PRODUCTION, but the environment is not.
  · S3_BUCKET_ADMIN is "trydood-admin" — not a production bucket.
```

Guard theek kar raha hai apna kaam. Do raaste hain:

- **Production ke `.env.production` me ye teen line likhiye hi mat** — guard
  `if (value && …)` hai, khaali/absent par chup rehta hai. Non-prod me pade
  rahein, koi farq nahi. ✅ **Yahi karein**
- ya prod ke liye naam `trydood-prod-admin` kar dijiye — par wo bucket banega hi
  nahi, to bekaar hai

⚠️ Aur jab Phase 2 me `S3_BUCKET_PUBLIC`/`S3_BUCKET_PRIVATE` judenge, **usi loop
me unhe bhi jodna hai** — warna production `trydood-nonprod-public` ki taraf
ishara kar sakta hai aur guard chup rahega.

---

## 11. Kram — kya pehle

| # | Kaam | Kaun | Rukavat |
|---|---|---|---|
| 1 | 4 bucket + BPA + CORS + lifecycle | aap | — |
| 2 | 2 policy + non-prod user | aap | 1 |
| 3 | **Phase 2 — storage facade + 4 landmine fix** | main | ❌ **kisi par nahi** |
| 4 | CloudFront × 2 + ACM cert | aap | 1 |
| 5 | Phase 2 ka S3 provider live | main | 1, 2 |
| 6 | EC2 role | aap | EC2 par jaane par |

🟢 **Step 3 abhi shuru ho sakta hai.** Phase 2 ka asli faayda chaar landmine
marna hai, aur wo Cloudinary par hi test ho jaate hain — AWS ka intezaar nahi.
