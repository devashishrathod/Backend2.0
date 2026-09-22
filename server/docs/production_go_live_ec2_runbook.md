# Production go-live — EC2 par, fresh database ke saath

> **Ye doc kya hai:** Trydood 2.0 backend ko pehli baar production me le jaane ka
> **poora** sequence — EC2 se lekar pehle admin login tak. Har kadam, har env
> var, har script, aur har jagah jahan galti chup-chaap hoti hai.
>
> **Ye doc kya nahi hai:**
> - Cloudinary → S3 ka **switch**. Wo
>   [production_go_live_runbook.md](./production_go_live_runbook.md) me hai, aur
>   wo doc aaj bhi sahi hai — §13 me batata hoon usme kya purana pad chuka hai.
> - AWS ka bucket/IAM/CloudFront **banana**. Wo
>   [aws_s3_setup.md](./aws_s3_setup.md) me hai.
>
> ⚠️ **Is doc ki har takneeki baat 2026-09-22 ko code se verify karke likhi gayi
> hai** — file aur line number ke saath, taaki jo padhe wo khud dekh sake.
> Jahan naapa gaya hai, wahan likha hai ki kaise naapa.
>
> 🔴 **Sabse pehle [§2](#2--launch-blockers--ye-do-band-kiye-bina-live-mat-jaiye)
> padhiye.** Do cheezein aisi hain jo baaki sab theek hone par bhi launch rok
> deni chahiye, aur unme se ek **security bypass** hai.

---

## Fehrist

| § | Kya |
|---|---|
| [0](#0-ek-page-me--poora-kaam) | Ek page me — poora kaam |
| [1](#1-chaar-faisle-aur-unhe-kaise-tay-karna-hai) | Chaar faisle, aur unhe kaise tay karna hai |
| [2](#2--launch-blockers--ye-do-band-kiye-bina-live-mat-jaiye) | 🔴 Launch blockers |
| [3](#3-jo-blocker-nahi-hain-par-jaan-kar-jaana-chahiye) | Jo blocker nahi, par jaan kar jaana chahiye |
| [4](#4-aws--kya-banana-hai) | AWS — kya banana hai |
| [5](#5-machine-setup--node-user-systemd-nginx) | Machine setup |
| [6](#6-env--poori-tasveer-aur-paanch-jaal) | Env — poori tasveer, aur paanch jaal |
| [7](#7-mongodb--fresh-db-indexes-aur-pool) | MongoDB — fresh DB, indexes, pool |
| [8](#8-fresh-db-me-kya-seed-hoga--aur-kya-bilkul-nahi) | Seeding — kya, aur kya bilkul nahi |
| [9](#9-third-party--har-service-ka-production-switch) | Third-party services |
| [10](#10-deploy-sequence--theek-kram) | Deploy sequence |
| [11](#11-boot-ke-baad--line-by-line-kya-dikhna-chahiye) | Boot ke baad verify |
| [12](#12-pehle-48-ghante) | Pehle 48 ghante |
| [13](#13-purane-doc-me-kya-stale-hai) | Purane doc me kya stale hai |
| [14](#14-rollback) | Rollback |
| [15](#15-quick-reference) | Quick reference |
| [16](#16-kadam-dar-kadam--command-ke-saath) | **Kadam-dar-kadam, command ke saath** |
| [17](#17-staging-server--aur-database-share-karne-ka-sawaal) | Staging server — `Trydood2` share karna (✅) vs prod ka DB (🔴) |

---

## 0. Ek page me — poora kaam

```
  ── PEHLE, code me ──────────────────────────────────────────
  1. 🔴 WhatsApp OTP verify wapas chaalu karo          §2.1
     (ekmatra code blocker)
  ── PHIR, AWS par ───────────────────────────────────────────
  2. Naya Atlas project + cluster + DB user            §4.1
  3. EC2 + Elastic IP + Security Group + IAM role      §4.2
  4. Nginx + TLS cert                                  §5.4
  ── PHIR, machine par ───────────────────────────────────────
  5. Node 24.20, deploy user, clone, npm ci            §5
  6. Env file (host env se, .env se nahi)              §6
  7. systemd unit + logrotate                          §5.3
  ── PHIR, database par ──────────────────────────────────────
  8. ensureIndexes --apply  →  MONGO_AUTO_INDEX=false  §7.2
  9. seedAdmin --apply                                 §8.1
  ── PHIR, panel se ──────────────────────────────────────────
 10. Admin ka email verify (warna alert nahi milenge)  §8.4
 11. 🔴 Seller identity — GSTIN + companyStateCode
     PEHLE ASLI PAYMENT SE PEHLE. Baad me tax head
     theek nahi hota                                   §2.2
 12. Commission, GST %, settlement, refund windows     §8.3
 13. Categories, plans, legal pages                    §8.3
 14. Storage: CLOUDINARY par boot → panel se AWS_S3    §9.2
  ── PHIR ────────────────────────────────────────────────────
 15. Razorpay webhook URL + 14 events, dono account    §9.1
 16. Boot log line-by-line padho                       §11
 17. Pehla test payment  ← kadam 11 ke BAAD hi         §10
 18. 48 ghante nigrani                                 §12
```

**Code me kitna badalna hai:** **ek** jagah — §2.1. Baaki sab **configuration**
hai, code nahi. (§2.2 ke liye ek optional script fix hai, par uske bina bhi kaam
admin API se ho jaata hai.)

---

## 1. Chaar faisle, aur unhe kaise tay karna hai

### 1.1 ✅ Atlas — naya alag project + cluster *(tay ho gaya)*

Naya Atlas **project**, uska apna cluster, apna DB user, aur Network Access me
**sirf** EC2 ka Elastic IP.

**Kyun ye itna zaroori hai —** `CLAUDE.md` ka ek poora section isi par hai. Is
service ka ek **purana build** kahin chal raha hai jo usi cluster par
`invoiceId_1` naam ka blanket unique index **dobara bana deta hai**, har apne
restart par. Jab tak wo index hai, har doosra voucher claim duplicate-key error
se reject hota hai — ek aise field par jise customer ne chhua bhi nahi. Naye
project me wo build pahunch hi nahi sakta.

> 🔴 **Database ka naam me `prod` hona **zaroori** hai.**
> [`configs/env/load.js:142`](../configs/env/load.js) ka guard `CONFIG_PROFILE=PRODUCTION`
> par `MONGO_URL` ke path se DB ka naam nikalta hai aur `/prod/i` se match karta
> hai. `Trydood2` naam rakha to boot **fail** hoga. `Trydood2_prod` rakhiye.

### 1.2 ✅ Timezone — `TZ=Asia/Kolkata` *(tay ho gaya)*

systemd unit me `Environment=TZ=Asia/Kolkata`.

**Kya badlega:**

| | |
|---|---|
| Admin listing ke `from` / `to` date filter | IST din par cut honge. **18 jagah** `setHours(23,59,59,999)` process ke TZ par chalta hai (`services/` + `helpers/`, naapa gaya) |
| Chargeback evidence pack ka time | sahi IST chhapega — [`helpers/disputes/buildEvidencePack.js:17`](../helpers/disputes/buildEvidencePack.js) ka `at()` **koi timeZone set nahi karta**, to wo process ka TZ padhta hai |
| morgan ka log timestamp | IST |

**Kya nahi badlega —** aur yahi wajah hai ki ye safe hai:

| | Kyun |
|---|---|
| Invoice ka financial year | [`helpers/common/istDate.js`](../helpers/common/istDate.js) **fixed +5:30 offset** se ginta hai, process TZ se nahi |
| Settlement period, day-wise report | wahi helper |
| Notification me chhapne wale date-time | [`helpers/notifications/formatDateTime.js`](../helpers/notifications/formatDateTime.js) me `Asia/Kolkata` **hardcoded** hai |
| MongoDB me stored dates | hamesha UTC. Mongo TZ jaanta hi nahi |

> ⚠️ `.env.example` me `TZ` "test-only" likha hai — wo baat **jest** ke liye hai
> (mail-render test ke date assertions pin karne ke liye). Host par TZ set karna
> alag cheez hai aur uske liye koi rok nahi.

---

### 1.3 Aage kya baithega — *(aapne poocha: "kaise pata karu?")*

**Asli sawaal ye hai:** customer ke phone se lekar `node index` (port 8080) tak,
beech me **kitni machine** request ko dobara likhegi?

Ye isliye maayne rakhta hai ki Express ko khud nahi pata chalta. Aap use
`TRUST_PROXY` se batate hain ([`index.js:66`](../index.js)), aur rate limiter
`req.ip` par ginta hai:

```
TRUST_PROXY galat — bahut zyada  →  koi bhi X-Forwarded-For header khud likh kar
                                     limiter ko chakma de sakta hai
TRUST_PROXY galat — bahut kam    →  har customer ka IP proxy ka IP dikhega, yaani
                                     poora India ek hi bucket me. 3000 request ke
                                     baad sab ko 429, bina kisi wajah ke
```

#### Pehla sawaal: kya proxy ki zarurat hai bhi?

Haan, aur ye vikalp nahi hai:

- Razorpay webhook **sirf HTTPS** par deliver karta hai.
- Play Store / App Store bina HTTPS ke API call allow nahi karte.
- Is repo me Node khud TLS terminate **nahi** karta — `app.listen(port)` plain
  HTTP hai ([`index.js:254`](../index.js)).

To koi na koi cheez TLS terminate karegi hi. Yaani **"kuch nahi" wala vikalp
practically hai hi nahi**, aur `TRUST_PROXY=0` production ke liye galat hai.

#### Doosra sawaal: nginx ya ALB?

| | Nginx, usi EC2 par | AWS ALB |
|---|---|---|
| Kharcha | ₹0 | ~₹1,600–2,000/mahina |
| TLS cert | Let's Encrypt + certbot, 90 din me auto-renew | ACM, free, AWS khud renew karta hai |
| Dusra server jodna | naya setup | ek target jodna |
| Aapke zimme | nginx config + certbot timer | kuch nahi |
| `TRUST_PROXY` | **1** | **1** |

> 🔮 **Launch ke liye sifarish: nginx, usi EC2 par.** Sabse kam hilne wale hisse,
> ₹0 extra, aur **baad me ALB par jaane par `TRUST_PROXY` badalta hi nahi** —
> dono ek hop hain. To ye faisla aapko kisi cheez me phansata nahi.

⚠️ Agar kabhi **CloudFront → ALB → EC2** karein, to hop **do** ho jaate hain aur
`TRUST_PROXY=2` chahiye.

#### 🔬 Aur ye kaise **naapein** ki value sahi lagi — guess mat kijiye

> ⚠️ `express-rate-limit` 8.7.0 me `ERR_ERL_PERMISSIVE_TRUST_PROXY` aur
> `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` naam ke do validator hain, **par ye yahan
> kabhi nahi chalenge** — wo `trust proxy === true` / `=== false` (boolean)
> dekhte hain, aur yahan hamesha ek **number** set hota hai
> ([`node_modules/express-rate-limit/dist/index.cjs:382,400`](../node_modules/express-rate-limit/dist/index.cjs)).
> Isliye neeche wala manual test hi ekmatra pakka tareeka hai.

`GET /trydood/v1/app-config` public hai, sasta hai, aur **rate limiter me ginaa
jaata hai** (`/` aur webhook hi chhoote hain — [`index.js:131`](../index.js)).
`standardHeaders: "draft-7"` ki wajah se har jawab me `RateLimit` header aata hai.

**Test A — "bahut zyada" pakadne ke liye:**

```bash
# 1. ek normal request
curl -si https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
#    RateLimit: limit=3000, remaining=2999, reset=...

# 2. dobara — remaining ek kam hona chahiye
curl -si https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
#    remaining=2998   ✅

# 3. ab ek NAKLI X-Forwarded-For ke saath
curl -si -H "X-Forwarded-For: 203.0.113.9" \
  https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
```

| Step 3 ka natija | Matlab |
|---|---|
| `remaining=2997` (ginti chalti rahi) | ✅ **Sahi.** Nakli header ignore hua |
| `remaining=2999` (ginti reset ho gayi) | 🔴 `TRUST_PROXY` **bahut zyada** hai. Koi bhi limiter bypass kar sakta hai. Value ek kam kijiye |

**Test B — "bahut kam" pakadne ke liye:** do alag network se (ek WiFi, ek mobile
data) wahi request maariye.

| Natija | Matlab |
|---|---|
| Dono ka `remaining` ~2999 se shuru | ✅ Alag-alag bucket — sahi |
| Doosre ka `remaining` pehle wale ki ginti se aage badha | 🔴 `TRUST_PROXY` **bahut kam** hai. Sab ek bucket me hain |

---

### 1.4 Process kaise chalega — *(aapne poocha: "kaise pata karu?")*

**Asli sawaal do hain:** process marne par use dobara kaun chalu karega, aur
**kitni copy** chalengi?

#### Dobara chalane wala zaroori hai — vikalp nahi

Boot Mongo ko teen baar try karta hai aur phir `process.exit(1)` kar deta hai
([`index.js:242-252`](../index.js)). Ye jaan-bujh kar hai: bina database ke
server chalne se accha hai deploy fail ho jaaye. Par iska matlab ye bhi hai ki
Atlas ka ek do-minute ka blip **deploy ke waqt** server ko hamesha ke liye neeche
chhod dega, agar koi use wapas start na kare.

Aur ek: is repo me `process.on("unhandledRejection")` ya `uncaughtException`
**kahin nahi hai** (poore repo me khoja, 0 hits). Node 24 me ek unhandled
rejection process ko **maar deta hai**. To restart karne wala hona hi chahiye.

#### systemd ya PM2?

| | systemd | PM2 |
|---|---|---|
| Kahan se aata hai | Linux me pehle se hai | ek aur npm package, jise khud update karna hai |
| Restart on crash | `Restart=on-failure` | haan |
| Boot par auto-start | `systemctl enable` | `pm2 startup` + `pm2 save` (do kadam, aur bhoolne par reboot ke baad server neeche) |
| Logs | `journalctl -u trydood -f`, rotation OS ke paas | apni file, `pm2-logrotate` alag se lagana padta hai |
| Cluster (N copy) | nahi | haan |

#### Kitni copy? — launch par **ek**

Node single-threaded hai, to ek process = ek CPU core. Do copy chalane ka faayda
tabhi hai jab ek core bhar chuka ho. Launch par traffic zero hai.

Aur do copy **teen numbers badal deti hain** — tootata kuch nahi, par jo aapne
tune kiya wo galat ho jaata hai:

| Cheez | Ek process | Do process |
|---|---|---|
| Rate limit | 3000/15min, jaisa likha hai | **6000** — counter process ke andar hai ([`index.js:109-112`](../index.js)) |
| Mongo connections | 20 | **40** (`pool × workers × instances`) |
| Settings cache | ek hi sach | 30s tak do worker alag jawab de sakte hain ([`helpers/settings/getSetting.js:53`](../helpers/settings/getSetting.js)) |
| Background jobs | 22 jobs, ek baar | ✅ phir bhi ek baar — `JobLock` cross-process hai |

> 🔮 **Sifarish: systemd, ek hi process.** `CLAUDE.md` ka apna line yahi kehta
> hai — *"One instance now, more later."*

#### 🔬 Kab doosri copy chahiye — naapiye, andaaza mat lagaiye

```bash
top -p $(pgrep -f 'node index')      # %CPU ek core ka hai, 100% = ek core full
journalctl -u trydood -f | grep '⛔' # kya error aa rahe hain
```

**Trigger:** `%CPU` lagataar 70–100% par baitha ho **aur** Mongo khali ho. Tab
worker badhaiye — par `RATE_LIMIT_MAX` aur `MONGO_MAX_POOL_SIZE` dono usi din
aadhe kijiye, warna upar wali table sach ho jaayegi.

---

## 2. 🔴 Launch blockers — ye do band kiye bina live mat jaiye

> 📌 **Do alag tarah ki cheezein hain, aur farq maayne rakhta hai:**
>
> | | Kya |
> |---|---|
> | **2.1** | Ek **code blocker**. Deploy se pehle code me badalna hi hoga |
> | **2.2** | Ek **checklist gate**. Code change optional hai — par pehle asli payment **se pehle** ho jaana chahiye, warna jo galti hui wo permanent hai |

### 2.1 🔴 WhatsApp OTP verify hota hi nahi — account takeover

**Files:** [`services/auth/verifyOtpWithWhatsapp.js:25`](../services/auth/verifyOtpWithWhatsapp.js)
· [`services/auth/loginOrSignUpWithWhatsapp.js:240`](../services/auth/loginOrSignUpWithWhatsapp.js)

Dono line **aaj bhi comment me hain** (2026-09-22 ko code me dekha gaya):

```js
// loginOrSignUpWithWhatsapp.js:240
//  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);

// verifyOtpWithWhatsapp.js:25
//  await verifyOtp(whatsappNumber, otp);
```

Yaani kisi ka WhatsApp number pata hona hi kaafi hai — do call me uska JWT:

```bash
POST /trydood/v1/auth/loginOrSignUp-with-whatsapp
     { "whatsappNumber": "9876543210", "role": "CUSTOMER" }

POST /trydood/v1/auth/verify-otp-whatsapp
     { "whatsappNumber": "9876543210", "otp": "000000", "role": "CUSTOMER" }
→ 200 { "data": { "token": "eyJ..." } }
```

`verifyOtpWithWhatsapp` sirf itna dekhta hai ki us number+role ka account
**maujood hai** ([line 16-17](../services/auth/verifyOtpWithWhatsapp.js)), phir
seedha `getSignedJwtToken()` de deta hai ([line 83](../services/auth/verifyOtpWithWhatsapp.js)).
`otp` parameter kahin padha hi nahi jaata.

**Kiska asar:**

| Raasta | Asar |
|---|---|
| `POST /auth/verify-otp-whatsapp` | Kisi bhi **maujood** CUSTOMER / VENDOR / SUB_VENDOR account ka takeover |
| `POST /auth/loginOrSignUp-with-whatsapp` | Kisi bhi number par naya account ban jaata hai |
| Sub-brand signup | [`services/subBrands/signUpSubBrandWithWhatsapp.js:93`](../services/subBrands/signUpSubBrandWithWhatsapp.js) OTP **bhejta hai**, par verify wahi toota hua raasta karta hai |

**Jo theek hai:** Email aur Mobile ke OTP flow bilkul sahi hain —
`emailVerification.js`, `verifyEmailOTP.js`, `resetPassword.js`,
`contactVerification.js`, sab `verifyOtp` call karte hain (grep se verify kiya).
Bug sirf WhatsApp path me hai. ADMIN WhatsApp se ban hi nahi sakta aur
`/auth/register` `isAdmin` ke peeche hai, to ye admin-escalation **nahi** hai —
par customer aur vendor accounts poore khule hain.

**Fix (patch [security_findings.md §7](./security_findings.md) me ready hai):**
dono line uncomment karni hain.

> ⚠️ **Uncomment karte hi TENDIGIT provider live ho jaata hai.**
> [`helpers/otps/tendigit.js`](../helpers/otps/tendigit.js) fail hone par
> `503 "OTP service unavailable"` throw karta hai. Yaani agar
> `TENDIGIT_APIKEY` / `TENDIGIT_LICENSE` / `TENDIGIT_TEMPLATE_ID` production me
> galat hue, to **saare WhatsApp login band** — aur wahi platform ka mukhya
> login raasta hai.
>
> 🔴 **Isliye kram ye hai:** pehle staging par credentials se ek asli OTP
> aata-jaata dekhiye, **phir** uncomment kijiye, **phir** prod par deploy. Ulta
> karne par login ka poora darwaza band ho jaayega.

**Customer ko kya dikhega agar TENDIGIT girta hai:** login screen par
*"Please try in some time! OTP service unavailable"* — wo koi retry nahi kar
sakte, koi doosra raasta nahi hai (email login alag identity hai). To ye ek
**total login outage** hai, partial nahi.

---

### 2.2 🔴 Seller identity — pehle asli payment **se pehle** set honi chahiye

Platform ki apni seller identity `Setting.vendor.subscription` me rehti hai —
paanch field, aur ye **document-of-record data** hai, "setting" nahi. Ye har us
kaagaz par chhapte hain jo platform jaari karta hai:

| Kahan | File |
|---|---|
| Subscription / grant invoice | [`buildInvoiceSnapshot.js:260-265`](../helpers/transactions/buildInvoiceSnapshot.js) |
| Customer voucher claim invoice | [`buildVoucherInvoiceSnapshot.js:182-187`](../helpers/voucherClaims/buildVoucherInvoiceSnapshot.js) |
| Refund receipt | [`buildRefundDocumentSnapshot.js:207-210`](../helpers/refunds/buildRefundDocumentSnapshot.js) |
| Payout statement + commission invoice | [`buildSettlementDocumentSnapshot.js:229-233`](../helpers/settlements/buildSettlementDocumentSnapshot.js) |
| Chargeback advice | [`buildChargebackDocumentSnapshot.js:135-139`](../helpers/disputes/buildChargebackDocumentSnapshot.js) |

#### Fresh DB par default kya hai — aur wo kya todta hai

⚠️ `scripts/setSubscriptionConfig.js` ka apna header kehta hai ki defaults me
placeholder hain (`23AAACT1234A1Z5`, "Trydood HQ, Indore"). **Wo header stale
hai.** Aaj ke asli defaults
([`constants/subscription.js:244-250`](../constants/subscription.js)):

```js
companyName      : "Trydood"
companyGstin     : ""      // khali
companyAddress   : ""      // khali
companyStateCode : ""      // khali
companyState     : ""      // khali
```

To khatra "nakli GSTIN" nahi, **khali GSTIN** hai — aur wo do jagah chubhta hai:

**1. Tax invoice par seller ka GSTIN hoga hi nahi.**
`gstin: config?.companyGstin || undefined` — blank matlab field hi gayab. GST ke
hisaab se supplier ke GSTIN bina wo valid tax invoice nahi hai, aur vendor uspar
input tax credit claim nahi kar sakta.

**2. Har invoice par IGST lagega, CGST+SGST kabhi nahi.**
[`helpers/subscribeds/calculatePricing.js:21-52`](../helpers/subscribeds/calculatePricing.js):

```
sellerStateCode blank  →  pehli branch skip
companyState    blank  →  fallback me bhi match nahi
                       →  hamesha IGST
```

Schema ka apna comment yahi kehta hai: *"Blank => we cannot prove intra-state, so
IGST."* Vendor ko **paisa utna hi lagega** (`gstPercentage: 18` dono taraf, to
18% IGST = 9% + 9%), par **tax head galat jaayega** — IGST kendra ko, CGST/SGST
batega. Galat head = galat GST return.

#### 🔴 Baad me kya theek hota hai, aur kya nahi

Ye sabse zaroori hissa hai, kyunki dono aadhe alag-alag vyavhaar karte hain:

| Cheez | Kahan se aati hai | Baad me theek hoti hai? |
|---|---|---|
| Seller ka naam, GSTIN, address | **live config**, snapshot banate waqt | ✅ **Haan** — `POST /transactions/invoice/regenerate` naya snapshot banata hai aur `getSubscriptionConfig()` taaza padhta hai ([`regenerateInvoice.js:53,76`](../services/transactions/regenerateInvoice.js)) |
| Tax split — `taxType`, `cgst`, `sgst`, `igst` | **transaction par frozen** ([`models/pricingSchema.js:42-49`](../models/pricingSchema.js)) | ❌ **Nahi.** Regenerate `pricing: transaction.pricing` hi paas karta hai ([line 79](../services/transactions/regenerateInvoice.js)), to wahi purana split dobara chhapega |

Aur regenerate **sirf Transaction-backed documents** ke liye hai — subscription,
grant, claim. Refund receipt, payout statement aur chargeback advice ke liye koi
regenerate raasta hai hi nahi.

> 🔴 **Isliye deadline ye hai: pehla asli payment.** Uske pehle set kar diya to
> kuch kho nahi raha — ek bhi invoice bani hi nahi hogi. Uske baad set kiya to
> beech ki har invoice ka **tax head permanently galat** rahega, aur regenerate
> use theek nahi kar sakta.
>
> Deploy sequence me ye **kadam 21** hai, aur pehla test payment **kadam 25** —
> ye kram jaan-bujh kar hai.

#### Ise likhne ke do raaste

**Raaste B — admin API, zero code change** *(launch ke liye yahi kaafi hai)*.
Validator ye saare field allow karta hai
([`validator/settings.js:106-119`](../validator/settings.js)), aur change 30
second me live ho jaata hai (settings cache ka TTL):

```http
PUT /trydood/v1/settings/update        (ADMIN token)

{
  "vendor": {
    "subscription": {
      "companyName":     "TRYDOOD RETAIL PRIVATE LIMITED",
      "companyGstin":    "33AAKCT3750H1ZB",
      "companyAddress":  "2nd Floor, Phase-3, Suite No. 250, No. S101, Door No. 769, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
      "companyStateCode":"33",
      "companyState":    "Tamil Nadu"
    }
  }
}
```

Ye raasta kaam karta hai — dev DB me aaj `companyGstin: 33AAKCT3750H1ZB` set hai,
jo neeche wale toote script se aa hi nahi sakta tha.

**Raasta A — script theek karo** *(optional, par ek asli faayda hai)*.

#### 🟡 `setSubscriptionConfig.js --apply` aaj toota hua hai

**File:** [`scripts/setSubscriptionConfig.js:66,103-104`](../scripts/setSubscriptionConfig.js)

Script ye karti hai:

```js
const setting = await getSetting();                       // line 66
Object.assign(setting.vendor.subscription, CONFIG);       // line 103
await setting.save();                                     // line 104
```

Par `getSetting()` ek **frozen plain object** lautata hai, Mongoose document
nahi — [`helpers/settings/getSetting.js:125`](../helpers/settings/getSetting.js)
me `deepFreeze(document.toObject())`.

**Naapa gaya** (dev DB par, read-only):

```
typeof save : undefined
isFrozen    : true
sub frozen  : true
```

To `--apply` par `TypeError: setting.save is not a function` aayega. Dry run
kaam karta hai (wo kuch likhta hi nahi), isliye galti chhupi rahti hai.

**Fix — ek shabd:**

```js
const { getSettingDocument } = require("../helpers/settings");   // line 28
…
const setting = await getSettingDocument();                      // line 66
```

`getSettingDocument` usi module se pehle se export hota hai
([`helpers/settings/index.js:28`](../helpers/settings/index.js)) — wo asli,
non-frozen, non-cached document deta hai, theek isi kaam ke liye. `updateSetting`
bhi wahi use karta hai.

Seedha `save()` karne se koi guard nahi chhootta (check kiya gaya):

- Paanchon field plain `String` hain, koi schema validator nahi — `save()` mana
  nahi karega.
- Paanchon cross-field rule (`assertSettlementTimingRule`, `assertReserveRateRule`,
  storage / showcase / voucher floors) me se **koi bhi** in fields ko chhoota nahi.
- Cache invalidate karne ki zarurat nahi — script alag process hai, aur server ka
  apna snapshot 30s me khud expire hota hai.

**Script rakhne layak kyun hai** — uski lines 78-95. Likhne se **pehle** wo har
brand ka GSTIN aapke `companyStateCode` se milaa kar dikhati hai ki kis par
`CGST 9% + SGST 9%` lagega aur kis par `IGST 18%`:

```
    AcmeFoods      GSTIN 33  ->  CGST 9% + SGST 9%
    BlueMart       GSTIN 27  ->  IGST 18%
```

API call ye nahi dikhati. Ek aisa faisla jo har future invoice ka tax head tay
karta hai, andhere me karna theek nahi.

> ⚠️ Script ka header comment bhi purana hai (placeholder values wali baat) —
> theek karte waqt wo bhi badal dijiye, kyunki usi ne asli khatra chhupa rakha
> tha.

---

## 3. Jo blocker nahi hain, par jaan kar jaana chahiye

Ye sab **aaj tootata nahi hai**. Par har ek ka ek din aata hai, aur us din
jawab pata hona chahiye.

### 3.1 🟠 500 ka message client tak jaata hai

[`middlewares/errorHandler.js:71-74`](../middlewares/errorHandler.js):

```js
const status = err.status || 500;
const message = err.message || "Something went wrong";
console.error("⛔ Error:", err);
return sendError(res, status, message);
```

Jo bhi error kisi branch me nahi pakda jaata, uska **asli message** client ko
chala jaata hai. Stack trace nahi jaata — par Mongo ka driver message, AWS SDK ka
message, kabhi path bhi. `NODE_ENV=production` isse rok **nahi** sakta, kyunki ye
Express ka default handler nahi hai.

**Kya karna:** ya to accept kijiye (aaj tak koi leak nahi mila), ya `status >= 500`
par message ko `"Something went wrong"` se badal dijiye. Fix ek line ka hai, par
**code change hai** — isliye yahan sirf bataya hai.

### 3.2 🟠 CORS bilkul khula hai, aur client-auth layer bana hi nahi

[`index.js:90`](../index.js) — `app.use(cors())`, yaani
`Access-Control-Allow-Origin: *`. Cookie use nahi hoti (token
`Authorization` header me aata hai —
[`middlewares/authenticate.js:43`](../middlewares/authenticate.js)), to ye
classic CSRF nahi hai. Par iska matlab hai ki **koi bhi website** browser se
aapka API call kar sakti hai.

[`docs/api_client_auth_plan.md`](./api_client_auth_plan.md) me poora design
locked hai — handshake + short-lived client token, CORS origin allowlist,
per-account rate limits, session revoke — **par implement kuch nahi hua**
(status: *"architecture locked, implementation shuru karne ke liye ready"*).

**Launch par ye rokta nahi.** Par jaan lijiye ki aaj:
- kisi bhi origin se API call ho sakti hai,
- login / OTP / refund par **per-account** koi limit nahi (sirf OTP par target-wise
  throttle hai — `services/otps/sendOtp.js`),
- ek chori hua JWT 30 din chalega (`JWT_EXPIRY=30d`) aur use marne ka ek hi
  raasta hai — `User.sessionInvalidatedAt`.

### 3.3 🟠 Graceful shutdown nahi hai

`process.on("SIGTERM")` kahin nahi hai. `systemctl restart` par process turant
marta hai — jo request beech me thi wo katti hai.

**Money ke liye ye utna bura nahi jitna lagta hai:** settle staged hai
(`CLAIMED → RECORDED → INVOICED → COMPLETE`) aur `resumeIncompleteSettlements`
har 15 minute me adhoore ko poora karta hai. To ek katti hui request paisa
kho nahi deti, wo agli sweep par theek ho jaati hai.

**Kya karna:** deploy chhote traffic window me kijiye, aur restart ke baad 15
minute me `resumeIncompleteSettlements` ka log dekh lijiye.

### 3.4 🟡 Email — Gmail, aur ek dheela TLS

[`helpers/nodeMailer/sendMail.js:16-29`](../helpers/nodeMailer/sendMail.js):

| Baat | Asar |
|---|---|
| `service: "gmail"` | Free Gmail ~500 mail/din, Workspace ~2000/din. Ek vendor ko 8-10 notification aate hain — 50-60 vendor par hi ye chhoo jaayega |
| `tls: { rejectUnauthorized: false }` | SMTP ka certificate check **band** hai. Ek MITM SMTP credentials pakad sakta hai |
| `pool: true` + timeouts | ✅ sahi hai — blocked port par request latakti nahi |

> 🔮 **Sifarish:** launch Gmail par kar dijiye (chal jaayega), par SES/SendGrid
> par jaane ka plan rakhiye. AWS EC2 par **port 25 block hai**, par Gmail 465
> use karta hai — to wo chalega.

### 3.5 🟡 `verifySchemaRelationships.js` abhi exit 1 deta hai

Aaj chalaया, natija:

```
Models loaded: 54   ObjectId paths checked: 202
  ✅ ref points at a model that does not exist      0
  ✅ ref disagrees with the field name              0
  ❌ ObjectId with no ref                           2
       ShowcaseSection.coverMediaId
       Voucher.banner.reviewedBy
```

Dono `populate()` se follow nahi ho sakte. **Aaj koi inhe populate karta bhi
nahi**, to runtime par kuch nahi tootata — par script exit 1 deti hai, to agar
aap ise deploy pipeline me daalenge to pipeline red rahegi.

### 3.6 🟡 Money suite ka natija run-dar-run badalta hai (O-2)

102 test file, ek hi `Trydood2_test` database par, 36–72 minute.
[master_execution_plan.md](./master_execution_plan.md) ka **O-2** khula hai —
daava ye nahi ki suite hamesha red hai, daava ye hai ki natija **badalta hai**.
Aakhri do run: 101/101 green, phir 100/101.

**Go-live ke liye iska matlab:** deploy se pehle suite chalaiye, par ek-do red ko
turant "code toota" mat maaniye — use akele dobara chalaiye. Agar akele green hai
to wo isolation ka issue hai, aapke change ka nahi.

> 🔴 **Suite ko production ke MONGO_URL ke saath kabhi mat chalaiye.**
> `__tests__/money/setup/testDb.js` naam me `_test` jodta hai — yaani wo
> **production cluster par** `Trydood2_prod_test` bana dega, aur uski har
> `beforeEach` collections delete karti hai. Guard sirf itna dekhta hai ki naam
> `_test` par khatam ho; wo ye nahi dekhta ki cluster kaunsa hai.

---

## 4. AWS — kya banana hai

### 4.1 MongoDB Atlas

| # | Kaam | Detail |
|---|---|---|
| 1 | Naya **project** | Purane project se alag — users, network access, alerts sab alag |
| 2 | Cluster | Region **`ap-south-1` (Mumbai)** — EC2 ke saath. Alag region = har query par 100ms+ |
| 3 | Database user | Sirf `readWrite` **us ek database par**, `readWriteAnyDatabase` **nahi** |
| 4 | Network Access | Sirf EC2 ka **Elastic IP** /32. `0.0.0.0/0` nahi |
| 5 | Database ka naam | Me **`prod`** hona zaroori hai — §6.2 |
| 6 | Backup | Continuous / daily snapshot on kijiye |
| 7 | Alerts | Connection count, disk, CPU |

> ⚠️ Elastic IP **pehle** le lijiye. Bina uske instance restart par public IP
> badal jaata hai aur Atlas ki list purani ho jaati hai — aur ab boot bina DB ke
> chalta hi nahi, to wo ek **failed deploy** dikhega, jo accha hai.
>
> Outbound IP confirm karne ke liye: `GET /my-ip` ([`configs/render.js`](../configs/render.js)).

### 4.2 EC2

| Cheez | Kya |
|---|---|
| Region | `ap-south-1` |
| AMI | Ubuntu 24.04 LTS ya Amazon Linux 2023 |
| Size | `t3.small` se shuru (2 vCPU / 2 GB). Ek Node process + 22 job isme aaram se |
| Disk | **20 GB gp3** se kam nahi — §4.3 |
| Elastic IP | haan |
| IAM role | `TrydoodAppProd` — [aws_s3_setup.md §5.3](./aws_s3_setup.md) |

**Security Group (inbound):**

| Port | Kahan se | Kyun |
|---|---|---|
| 443 | `0.0.0.0/0` | HTTPS |
| 80 | `0.0.0.0/0` | certbot ka HTTP-01 challenge + 443 par redirect |
| 22 | **sirf aapka IP** ya SSM | `0.0.0.0/0` par SSH matlab din bhar brute force |

🔴 **8080 kabhi khula mat rakhiye.** Wo nginx ke peeche localhost par rahega.
Khula hua 8080 nginx ko bypass kar deta hai — aur uske saath `TRUST_PROXY=1` ka
matlab ye ho jaata hai ki caller apna `X-Forwarded-For` khud likh sakta hai.

### 4.3 Disk kitna — aur kyun 8 GB kaafi nahi

Do jagah files banti hain, dono `os.tmpdir()` (Linux par `/tmp`) me:

| Folder | Kaun | Safai |
|---|---|---|
| `/tmp/trydood-uploads` | har multipart upload ([`index.js:175`](../index.js)) | ✅ `middlewares/cleanupTempFiles.js` har response ke baad |
| `/tmp/trydood-documents` | har PDF ([`helpers/documents/renderDocument.js:207`](../helpers/documents/renderDocument.js)) | ✅ `finally` me unlink ([line 291](../helpers/documents/renderDocument.js)) |

Dono khud saaf hote hain. Par **peak** ye hai: `MAX_UPLOAD_SIZE_MB=100` × ek
saath chal rahi upload requests. 10 upload ek saath = 1 GB.

Aur logs: morgan `combined` har request par ek line, journald me.

> 🔮 20 GB gp3, aur `/tmp` ko alag mount karne ki zarurat nahi.

### 4.4 S3 + CloudFront

Poora setup [aws_s3_setup.md](./aws_s3_setup.md) me hai. Production ke liye
sirf itna check kijiye:

- [ ] `trydood-prod-public` aur `trydood-prod-private` — dono `ap-south-1`
- [ ] Dono par **Block Public Access ON** (CloudFront + OAC ke liye yahi sahi hai)
- [ ] Prod distribution `cdn.trydood.com` par, OAC ke saath
- [ ] CORS sirf **public** bucket par, `*` nahi — panel ke origins
- [ ] IAM role `TrydoodAppProd` sirf prod buckets par, `s3:ListBucket` ke bina
- [ ] 🔴 Instance par role lagane ke baad `AWS_ACCESS_KEY_ID` /
      `AWS_SECRET_ACCESS_KEY` env se **hata dijiye** — §6.5

---

## 5. Machine setup — Node, user, systemd, nginx

### 5.1 Node

```bash
node -p "process.versions.ares"     # 1.34.6 aaye to us Node par mat rukiye
```

`package.json` `"engines": { "node": ">=24.19.0" }`, `.nvmrc` me `24.20.0`.

> ⚠️ **24.19.0 se neeche mat jaiye.** c-ares 1.34.6 ka Windows regression
> `mongodb+srv://` ko todta hai. Linux par wo kam dikhta hai, par version floor
> repo ka contract hai, aur `database/mongoDb.js` uska naam leta hai.
> Amazon Linux 2023 / Ubuntu 24.04 ka default Node **purana** hai — nvm ya
> NodeSource se 24.20 lagaiye.

**bcrypt ke liye compiler ki zarurat nahi** — bcrypt 6.0.0 `node-gyp-build` use
karta hai aur `prebuilds/` me `linux-x64` aur `linux-arm64` dono maujood hain
(dekha gaya). Graviton (arm64) bhi chalega.

### 5.2 User, folder, install

```bash
sudo useradd -r -m -d /opt/trydood -s /bin/bash trydood
sudo -u trydood git clone <repo> /opt/trydood/app
cd /opt/trydood/app/server

sudo -u trydood npm ci --omit=dev
```

> ⚠️ `npm ci`, `npm install` nahi. `package-lock.json` **jaan-bujh kar commit
> kiya gaya hai** (`.gitignore:44-46`) taaki production me wahi version chalein
> jinke saath money suite green hui thi. `npm install` `^` ranges dobara resolve
> karta hai.
>
> ⚠️ `--omit=dev` chahiye hi — `ngrok` devDependency me hai aur
> [`index.js:325`](../index.js) use **sirf `ENABLE_NGROK` par** require karta
> hai, isi wajah se. Agar shell me `NODE_ENV=production` hai to npm khud hi
> devDeps chhod dega.

### 5.3 systemd unit

`/etc/systemd/system/trydood.service`:

```ini
[Unit]
Description=Trydood 2.0 API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=trydood
WorkingDirectory=/opt/trydood/app/server
ExecStart=/usr/local/bin/node index
EnvironmentFile=/etc/trydood/prod.env

Environment=TZ=Asia/Kolkata

Restart=on-failure
RestartSec=10
# Boot Mongo ko 3 baar try karta hai, ~90s tak. Default StartLimit us par trip
# ho sakta hai, isliye jaan-bujh kar set kar rahe hain.
StartLimitIntervalSec=600
StartLimitBurst=5

# /tmp private — upload aur PDF ke scratch files wahin rahenge
PrivateTmp=true
NoNewPrivileges=true

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 600 /etc/trydood/prod.env
sudo chown root:trydood /etc/trydood/prod.env   # root likhe, service padhe
sudo systemctl daemon-reload
sudo systemctl enable --now trydood
```

**Log rotation:** journald khud rotate karta hai, par default unbounded ho sakta
hai. `/etc/systemd/journald.conf`:

```ini
SystemMaxUse=2G
MaxRetentionSec=30day
```

### 5.4 Nginx + TLS

```nginx
server {
    listen 443 ssl http2;
    server_name api.trydood.com;

    ssl_certificate     /etc/letsencrypt/live/api.trydood.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.trydood.com/privkey.pem;

    # 🔴 MAX_UPLOAD_SIZE_MB ke barabar ya usse zyada. Kam hua to nginx 413 dega
    #    aur express-fileupload ka apna JSON 413 kabhi nahi pahunchega —
    #    client ko HTML error page milega jise wo parse nahi kar sakta.
    client_max_body_size 110M;

    # Bada upload dheere network par 60s se zyada le sakta hai
    proxy_read_timeout    120s;
    proxy_send_timeout    120s;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        # ⚠️ Yahi wo line hai jiske hone par TRUST_PROXY=1 sahi hai
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.trydood.com;
    return 301 https://$host$request_uri;
}
```

> 🔴 `client_max_body_size` bhoolna sabse aam galti hai. Nginx ka default
> **1 MB** hai — yaani har voucher image, har showcase video, har PDF nginx par
> hi ruk jaayega, aur Node ke logs me **kuch nahi** dikhega.

---

## 6. Env — poori tasveer, aur paanch jaal

### 6.1 🔴 Jaal 1 — `CONFIG_PROFILE` **host env** me hona chahiye, file me nahi

[`configs/env/load.js:212-217`](../configs/env/load.js):

```js
const profileBeforeFiles = process.env.CONFIG_PROFILE;
const loaded = loadFiles(resolveProfile());   // ← profile FILE PADHNE SE PEHLE tay hota hai
```

Matlab: **kaunsi `.env.<profile>` file load hogi, ye shell/systemd ki
`CONFIG_PROFILE` se tay hota hai — file ke andar likhi value se nahi.**

Agar host par `CONFIG_PROFILE` set nahi hai, to profile `DEVELOPMENT` maan liya
jaata hai, `.env.development` overlay hoti hai, aur **Guard 3 (§6.2) chalta hi
nahi** — yaani production ke saare check chup-chaap skip.

> ✅ **Isliye:** `CONFIG_PROFILE=PRODUCTION` systemd ke `EnvironmentFile` me
> likhiye. Ye pehli line honi chahiye.

⚠️ Aur ek: Guard 2 (`assertProfileAgrees`,
[`load.js:108-120`](../configs/env/load.js)) file aur shell ke beech
disagreement pakadne ke liye likha gaya tha — **par wo kabhi fire nahi kar
sakta.** Wo `process.env.CONFIG_PROFILE` (file padhne ke **baad**) ko
`resolveProfile()` se compare karta hai, jo usi value ko padhta hai. Do baar ek
hi cheez. To us guard par bharosa mat kijiye; `CONFIG_PROFILE` ko host par set
karna hi aapki suraksha hai.

### 6.2 Guard 3 — production ko production jaisa dikhna hi hoga

[`configs/env/load.js:130-192`](../configs/env/load.js). `CONFIG_PROFILE=PRODUCTION`
par boot **ruk jaata hai** agar:

| Check | Rule |
|---|---|
| `MONGO_URL` | path me database ka naam ho, aur usme **`prod`** ho (case-insensitive) |
| `RAZORPAY_VENDOR_KEY_ID` | agar set hai to `rzp_live_` se shuru ho |
| `RAZORPAY_CUSTOMER_KEY_ID` | wahi |
| `S3_BUCKET_PUBLIC` · `PRIVATE` · `ADMIN` · `CUSTOMER` · `VENDOR` | **jo bhi set ho**, usme `prod` ho |
| `S3_PREFIX` | **khali hona chahiye** — production bucket ke root me likhta hai |

Ye guard aapka dost hai. Isse ladiye mat.

### 6.3 🔴 Jaal 2 — `.env.example` ke teen bucket naam production boot rok denge

[`.env.example:164-166`](../.env.example) me aaj bhi ye hain:

```ini
S3_BUCKET_VENDOR=trydood-vendor
S3_BUCKET_ADMIN=trydood-admin
S3_BUCKET_CUSTOMER=trydood-customer
```

Inhe koi **runtime code padhta nahi** — sirf Guard 3 dekhta hai. Aur inme `prod`
nahi hai, to `.env.example` ko copy karke production env banaya to boot:

```
❌ CONFIG_PROFILE is PRODUCTION, but the environment is not.
   S3_BUCKET_ADMIN is "trydood-admin" — not a production bucket.
```

> ✅ **Production env me ye teen line likhiye hi mat.** Guard `if (value && …)`
> hai — absent par chup rehta hai.

⚠️ Ek purani baat theek kar dein: [aws_s3_setup.md §10.1](./aws_s3_setup.md)
kehta hai *"Aaj `.env` me `S3_BUCKET_ADMIN=trydood-admin` hai"*. **Ab nahi hai**
(aaj `.env` ki 75 keys me se ek bhi bucket-role naam nahi). Khatra sirf
`.env.example` se copy karne ka bacha hai.

### 6.4 🔴 Jaal 3 — `.env.production` **poori file nahi hai**

Aaj `.env.production` me sirf 6 line hain:

```ini
AWS_REGION=ap-south-1
S3_BUCKET_PUBLIC=trydood-prod-public
S3_BUCKET_PRIVATE=trydood-prod-private
S3_PREFIX=
CDN_BASE_URL=https://cdn.trydood.com
MEDIA_PROVIDER=CLOUDINARY
```

Ye ek **overlay** hai — `.env` ke upar chadhne ke liye
([`load.js:65-81`](../configs/env/load.js)). Usme `MONGO_URL`, `JWT_SECRET`,
`OTP_HMAC_SECRET`, kuch nahi hai. Akela le jaane par boot ye kahega:

```
❌ The environment is not valid.
   MONGO_URL: any.required
   JWT_SECRET: any.required
   ...
```

> ✅ **EC2 par sabse saaf tareeka: koi `.env` file rakhiye hi mat.** Sab kuch
> systemd ke `EnvironmentFile=/etc/trydood/prod.env` me. Tab
> `loadFiles()` khali lautega aur `assertSomethingWasLoaded`
> ([`load.js:91-99`](../configs/env/load.js)) `MONGO_URL` dekh kar aage badh
> jaayega — bilkul waise jaise design kiya gaya hai.

### 6.5 🔴 Jaal 4 — AWS key role ko **haraati** hai

SDK ka kram: explicit → **env keys** → shared config → ECS → EC2 metadata.
Env key role se pehle aati hai.

Yaani instance role laga dene ke baad bhi, agar env me purani key padi rahi, to
server **purani identity par chalta rahega** — aur jis din wo key revoke hogi,
har upload band, bina kisi log ke.

Boot par ek line isi ke liye hai
([`configs/s3.js:83-107`](../configs/s3.js)):

```
✅ [s3] trydood-prod-public / trydood-prod-private · ap-south-1 · credentials: instance role or shared config
```

Production me env key mili to `⚠️` ke saath saaf likha aata hai ki kya hataana
hai. **Us line ko boot ke baad padhiye.**

### 6.6 🟡 Jaal 5 — scripts profile overlay padhte hi nahi

`scripts/*.js` me se koi bhi `configs/env` use nahi karta (ek ko chhod kar —
`verifyEnvCoverage.js`). Baaki ya to plain `require("dotenv").config()` karte
hain (jo **cwd ki `.env`** padhta hai) ya kuch bhi nahi karte.

**Iska EC2 par matlab:** `.env` file hogi hi nahi, to `node scripts/ensureIndexes.js`
seedha chalane par `MONGO_URL is not set` aayega.

✅ **Script chalane se pehle env load kijiye:**

```bash
sudo -u trydood env $(sudo cat /etc/trydood/prod.env | grep -v '^#' | xargs) \
  node scripts/ensureIndexes.js
```

…ya seedha:

```bash
set -a; . /etc/trydood/prod.env; set +a
node scripts/ensureIndexes.js
```

> ⚠️ Iska ek doosra pehlu bhi hai jo **accha** hai: scripts Guard 3 se nahi
> guzarte, to wo production ke check apply nahi karte. Yaani script chalate waqt
> **aap khud** zimmedar hain ki `MONGO_URL` kaunsa hai. `--apply` se pehle
> hamesha dry run ka output padhiye — usme database ka naam chhapta hai.

### 6.7 Production env — poori table

**6 variable `required` hain** — inke bina boot hoga hi nahi:
`MONGO_URL`, `JWT_SECRET`, `CLOUD_BASE_URL`, `OTP_HMAC_SECRET`,
`MERCHANT_ID_SECRET`, `STORE_ID_SECRET`.

#### Tier aur core

| Variable | Production value | Note |
|---|---|---|
| `CONFIG_PROFILE` | `PRODUCTION` | 🔴 **host env me**, file me nahi — §6.1 |
| `NODE_ENV` | `production` | lowercase. npm aur Express ka hai, hamara nahi |
| `PORT` | `8080` | nginx localhost:8080 par proxy karega |
| `MONGO_URL` | `mongodb+srv://…/Trydood2_prod` | 🔴 naam me **`prod`** — §6.2 |
| `JWT_SECRET` | naya, lamba random | 🔴 dev wala **mat** le jaiye. Badalne par har issued token mar jaata hai |
| `JWT_EXPIRY` | `30d` (aaj `.env` me) ya kam | 30 din lamba hai; §3.2 |
| `TZ` | `Asia/Kolkata` | systemd `Environment=` se — §1.2 |

#### Permanent secrets — **ek baar, hamesha ke liye**

| Variable | Kyun permanent |
|---|---|
| `MERCHANT_ID_SECRET` | Har brand ka public merchant id isse derive hota hai. Badla to **har purana id badal jaayega** |
| `STORE_ID_SECRET` | Wahi, store id ke liye |
| `OTP_HMAC_SECRET` | OTP hash sign karta hai. Badalne par **udan bhar rahe har OTP** invalid |

> 🔴 Ye teeno **launch se pehle** final kar lijiye aur kahin surakshit likh
> lijiye (Secrets Manager / Parameter Store). Launch ke baad inhe badalna
> "config change" nahi, **data migration** hai.

#### Panel aur public URLs

| Variable | Production value | Unset hone par |
|---|---|---|
| `ADMIN_PANEL_URL` | `https://admin.trydood.com` | admin mails ka button gaayab |
| `VENDOR_PANEL_URL` | `https://vendor.trydood.com` | vendor mails ka button gaayab |
| `PUBLIC_API_URL` | `https://api.trydood.com` | 🔴 **invoice download link ban hi nahi paayega** |
| `CUSTOMER_APP_URL` | `https://app.trydood.com` | 🔴 **das customer email apne button kho denge** — receipt aur bank-detail wali sameत |

> ⚠️ `CUSTOMER_APP_URL` wala host `/.well-known/assetlinks.json` (Android) aur
> `/.well-known/apple-app-site-association` (iOS) serve karna chahiye, **aur** ek
> aisa page bhi jo app install na hone par khule. Backend sirf pata deta hai.
>
> 🔴 Us page par **kabhi bank details mat maangiye** —
> `REFUND_BANK_DETAILS_REQUESTED` wahin link karta hai aur uski copy vaada karti
> hai ki hum message par details nahi maangte.

Boot par ye chaaron check hote hain
([`helpers/notifications/logChannelStatus.js`](../helpers/notifications/logChannelStatus.js)) —
`⚪ [notify] mail CTA  … unset` line dhoondhiye.

#### Razorpay — do alag merchant

| Variable | Production |
|---|---|
| `RAZORPAY_VENDOR_KEY_ID` | 🔴 `rzp_live_…` (warna boot fail) |
| `RAZORPAY_VENDOR_SECRET` | live |
| `RAZORPAY_CUSTOMER_KEY_ID` | 🔴 `rzp_live_…` |
| `RAZORPAY_CUSTOMER_SECRET` | live |
| `RAZORPAY_BASEURL` | `https://api.razorpay.com` |
| `RAZORPAY_WEBHOOK_SECRETS` | VENDOR ka webhook secret (comma-separated list) |
| `RAZORPAY_CUSTOMER_WEBHOOK_SECRETS` | CUSTOMER ka |
| `RAZORPAY_WEBHOOK_SECRET` | **khali chhodiye** — ye legacy single-value naam hai |

#### Storage

| Variable | Production |
|---|---|
| `MEDIA_PROVIDER` | `CLOUDINARY` — 🔴 pehle boot par, §9.2 |
| `CLOUD_NAME` · `CLOUD_API_KEY` · `CLOUD_SECRET` | Cloudinary prod account |
| `CLOUD_BASE_URL` | `https://res.cloudinary.com/<cloud>` — 🔴 `required` |
| `CLOUDINARY_URL` | khali — kuch padhta nahi |
| `AWS_REGION` | `ap-south-1` |
| `S3_BUCKET_PUBLIC` | `trydood-prod-public` |
| `S3_BUCKET_PRIVATE` | `trydood-prod-private` |
| `S3_PREFIX` | **khali** |
| `CDN_BASE_URL` | `https://cdn.trydood.com` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 🔴 **likhiye hi mat** — §6.5 |
| `S3_BUCKET_ADMIN` / `CUSTOMER` / `VENDOR` | 🔴 **likhiye hi mat** — §6.3 |

> ⚠️ `CLOUD_BASE_URL` naam se zyada load-bearing hai. `deleteFile` har URL ko
> isse compare karta hai — unset hone par har comparison false, yaani **har media
> delete chup-chaap skip** ho jaata hai, aur server 200 deta rehta hai. Isi liye
> schema me `required` hai.

#### Notification channels

| Variable | Production |
|---|---|
| `NODEMAILER_EMAIL` · `NODEMAILER_PASSWORD` | Gmail app password — §3.4 |
| `FCM_PROJECT_ID` · `FCM_CLIENT_EMAIL` · `FCM_PRIVATE_KEY` | teeno ya koi nahi. PEM me `\n` literal likhein |
| `TENDIGIT_BASEURL` · `TENDIGIT_APIKEY` · `TENDIGIT_LICENSE` · `TENDIGIT_TEMPLATE_ID` | 🔴 §2.1 ke baad ye **login ka raasta** ban jaate hain |
| `TWO_FACTOR_API_KEY` | mobile OTP ke liye |
| `WHATSAPP_TEMPLATE_*` (17) | jo Meta se approve ho chuke hain, sirf wahi. Khali = us message par WhatsApp skip, error nahi |

`configs/fcm.js` **service account JSON file nahi padhta** — sirf ye teen env
(grep se verify kiya, `firebaseServiceAccountKey.json` ko koi require nahi karta).
To EC2 par wo file le jaane ki zarurat nahi.

#### KYC

`CGPEY_BASE_URL` · `CGPEY_MERCHANT_ID` · `CGPEY_API_KEY` · `CGPEY_SECRET_KEY` ·
`CGPEY_PAN_ENDPOINT` · `CGPEY_GST_ENDPOINT` · `CGPEY_BANK_ENDPOINT` ·
`CGPEY_TIMEOUT=15000` — production credentials.

#### Runtime toggles

| Variable | Production | Kyun |
|---|---|---|
| `TRUST_PROXY` | **1** (nginx / ALB) | §1.3 — naapiye, maan mat lijiye |
| `RATE_LIMIT_MAX` | `3000` | jaan-bujh kar dheela. CGNAT — ek IP = hazaron log |
| `LOG_FORMAT` | khali (prod me `combined` khud ban jaata hai) | |
| `ENABLE_JOBS` | **`true`** (ya set hi mat kijiye) | 🔴 `false` reh gaya to koi sweep nahi chalegi, aur **kuch bhi error nahi aayega** |
| `MAX_UPLOAD_SIZE_MB` | `100` | ⚠️ boot par **ek baar** padha jaata hai ([`index.js:157`](../index.js)) — badalne par restart |
| `ENABLE_NGROK` | `false` | |
| `DEFAULT_PASSWORD` | **khali** | aaj koi runtime code ise padhta nahi (verify kiya), par khali hi rakhiye |

#### Database tuning

| Variable | Production | Kyun |
|---|---|---|
| `MONGO_MAX_POOL_SIZE` | `20` | §7.4 ki arithmetic |
| `MONGO_MIN_POOL_SIZE` | `2` | shaant time ke baad pehli request TLS handshake na bhare |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `10000` | |
| `MONGO_AUTO_INDEX` | 🔴 pehle `true`, `ensureIndexes --apply` ke **baad** `false` | §7.3 |

#### Test-only — server par kabhi nahi

`TEST_DB_KEEP_CONNECTION` — production env me likhiye hi mat.

---

## 7. MongoDB — fresh DB, indexes, aur pool

### 7.1 Fresh DB par kuch bhi "migrate" nahi karna hai

Ye saaf-saaf likh raha hoon kyunki `scripts/` me 10 migration/backfill script
hain aur wo sab **maujooda data** ke liye hain:

| Script | Fresh prod DB par |
|---|---|
| `migrateCustomerClaimFoundation.js` | ❌ zarurat nahi |
| `migrateRefundFoundation.js` | ❌ |
| `migrateLegacyMediaShape.js` | ❌ — uska apna header kehta hai *"Production will never run this"* |
| `backfillIdentityFlags.js` | ❌ |
| `backfillLocationOwnership.js` | ❌ |
| `backfillSubscriptionState.js` | ❌ |
| `backfillVoucherBanners.js` | ❌ — *"Stage only"* |
| `dedupeUserIdentities.js` | ❌ |
| `normalisePhoneNumbers.js` | ❌ |
| `syncRoleProfileIdentity.js` | ❌ |

Khali database me convert karne ko kuch hai hi nahi. In sab ka kaam **aaj ka
code pehle se sahi karta hai** — isi liye wo scripts likhi gayi thin.

### 7.2 Indexes — `ensureIndexes.js`

Schemas me **181 index declaration** hain 54 models par, jisme **18 files** me
partial unique index hain. Money ke liye ye **correctness** hain, speed nahi:
`holdsUsageSlot`, `isOncePerTransaction`, idempotency keys,
`ledger_type_dispute_unique` — inke bina do aisi rows insert ho jaati hain jo
kabhi saath nahi honi chahiye, aur **koi error nahi aata**.

```bash
set -a; . /etc/trydood/prod.env; set +a

node scripts/ensureIndexes.js            # dry run — kya missing hai
node scripts/ensureIndexes.js --apply    # bana do
```

Output me `database :` line dekh kar **confirm kijiye ki naam sahi hai**.

Safe hai: `diffIndexes()` read-only hai, `createIndexes()` sirf banata hai —
**kabhi drop nahi karta**. Jo "extra" mile wo report hota hai aur chhoda jaata
hai.

> 🔴 `syncIndexes()` kabhi mat chalaiye. Wo har wo index drop kar deta hai jo
> current schema me nahi hai — bina naam liye.

Fresh DB par ye collections bhi bana dega. Kuch khaas indexes jo isse aate hain:

| Type | Kahan | Kyun maayne rakhta hai |
|---|---|---|
| **TTL** | `OtpThrottle`, `Upload.expiresAt`, `WebhookEvent.expiresAt` | Inke bina rows kabhi expire nahi hongi — collection badhti rahegi |
| **2dsphere** | `Location.geo`, `SubBrand.geo`, `VoucherSubBrand.geo` | Iske bina `$geoNear` **throw** karta hai — customer ka poora voucher listing 500 |
| **text** | `Voucher`, `VoucherVersion` | Search |

### 7.3 `MONGO_AUTO_INDEX=false` — kab aur kyun

Mongoose har model ke pehle use par uske saare index server se check karta hai —
naapa gaya: **6.3s sirf 5 models ke liye**, jab har index pehle se maujood tha.
54 models par wo ~65 second ka background traffic hai, theek us window me jab
deploy ke baad sabse zyada asli traffic aata hai. Aur mismatch hone par
`IndexOptionsConflict` **chup-chaap nigal liya jaata hai** — index bas kabhi
banta hi nahi.

To band karna sahi hai. Par **kram ulta karne par** wahi partial unique index
gaayab ho jaate hain jin par money ki correctness tiki hai.

```
1. MONGO_AUTO_INDEX=true  ke saath boot
2. node scripts/ensureIndexes.js --apply     →  "✅ Nothing missing"
3. MONGO_AUTO_INDEX=false karo
4. systemctl restart trydood
5. boot log me  "autoIndex off"  confirm karo
```

⚠️ Har baar jab bhi koi naya index schema me jude, kadam 2 dobara chalana hoga
— warna wo production me kabhi banega hi nahi.

### 7.4 Pool arithmetic

```
total connections  =  pool size  ×  workers per instance  ×  instances
```

| Setup | Connections |
|---|---|
| systemd, ek process, pool 20 *(sifarish)* | **20** |
| PM2 cluster 2 worker | 40 |
| 4 worker × 3 instance | 240 |
| Mongoose ka default (100) × 4 × 3 | **1200** — Flex ki 500 ki chhat se bahut upar |

Chhat paar karte hi Atlas nayi connection refuse karta hai aur **har request ek
saath fail** hoti hai — dikhta aisa hai jaise database hi chala gaya ho.

> ⚠️ Ek aur baat jo aasani se chhoot jaati hai: har **script** apni alag
> connection kholti hai, aur `mongoose.connect(url, { autoIndex: false })` me
> pool ka koi option nahi — yaani driver ka default **100**. Do script ek saath
> mat chalaiye, aur peak traffic me mat chalaiye.

### 7.5 Shadow index reaper — fresh cluster par iska matlab

`reapShadowIndexes` boot par aur har ghante chalta hai. Wo blanket unique index
dhoondhta hai jinhe kisi partial unique ne pehle se replace kar rakha hai, aur
unhe drop karta hai — aur **har reap par ek CRITICAL admin notice** bhejta hai.

Naye alag cluster par ise **kabhi kuch nahi milna chahiye**. Agar production me
kabhi ye notice aaye, to uska ek hi matlab hai: koi doosra writer usi database
par hai. Us din:

```bash
node scripts/findIndexWriters.js
```

### 7.6 Launch se pehle do read-only check

```bash
node scripts/verifyNullableUniques.js      # aaj: ✅ 0 findings (chalaya gaya)
node scripts/verifySchemaRelationships.js  # aaj: ❌ 2 findings — §3.5
```

Pehla wala ye pakadta hai ki kahin koi blanket unique kisi optional field par to
nahi — wahi bug jisne `invoiceId_1` aur `User.referralCode` ke roop me do baar
kaata hai.

---

## 8. Fresh DB me kya seed hoga — aur kya bilkul nahi

### 8.1 Jo chalane hain

| # | Script | Kab | Zaroori? |
|---|---|---|---|
| 1 | `ensureIndexes.js --apply` | pehle boot ke baad | ✅ haan |
| 2 | `seedAdmin.js --apply` | uske baad | ✅ haan — pehla admin kahin se to aana hai |

```bash
node scripts/seedAdmin.js \
  --email admin@trydood.com --password '<strong>' \
  --name "Admin User" --username admin_user --mobile 9800000000 --apply
```

`/auth/register` ab `isAdmin` ke peeche hai, to pehla admin **sirf** yahin se
banega. Ye lockout ka recovery raasta bhi hai.

> ⚠️ Password 8–30 character, username lowercase+digits+underscore. Script pehle
> dry run chalti hai; `--apply` ke bina kuch nahi likhti.

| # | Script | Kab | Zaroori? |
|---|---|---|---|
| 3 | `setSubscriptionConfig.js --apply` | seller identity | 🟡 **aaj toota hua — §2.2.** Uske bina admin API se likhiye, par **pehle asli payment se pehle** |
| 4 | `seedPopularSearches.js --apply` | **baad me**, jab categories/brands/vouchers ban jaayein | ⚪ optional |
| 5 | `setPlanEntitlements.js --apply` | plans ban jaane ke **baad** (naam se match karta hai) | ⚪ optional par sifarish |

### 8.2 🔴 Jo production par **kabhi** nahi

| Script | Kyun |
|---|---|
| `seedHomeBanners.js` | **Hard delete** karta hai — is repo ki ekmatra aisi script. Saare banner mita kar 18 fake banaata hai |
| `seedPostmanFixtures.js` | Postman ka fixture data |
| `markFundsReceived.js` | Gateway ka stand-in — *"paisa aa gaya"* jhooth likhta hai. Isme DB naam wala guard hai, par bharosa mat kijiye |
| `clearSeededPasswords.js` | Fresh DB par kuch hai hi nahi |
| `replaceBannerMedia.js` | Dev artwork |
| `sendTestNotificationMails.js` · `sendDocumentVerificationMails.js` | Review ke liye har mail bhej dete hain |
| `npm test` (money suite) | 🔴 **prod cluster par `<db>_test` bana kar collections delete karega** — §3.6 |

### 8.3 Admin panel se kya banana hai — script se nahi

Ye `Setting` ke defaults hain jo kaam kar jaate hain, par **commercially galat**
hain:

| Kya | Aaj ka default | Kahan |
|---|---|---|
| Seller GSTIN / naam / address / state code | placeholder | §2.2 |
| `settlement.commissionPercent` | **`0`** | `constants/customer.js:179` — *"the rate is zero until commercials say otherwise"* |
| `settlement.delayDays` | `3` (T+3) | Razorpay khud T+2 rokta hai |
| `settlement.payoutBufferHours` | `6` | |
| `settlement.requiresAdminApproval` | `true` | `false` karne par payouts **apne aap approve** ho jaayenge |
| `settlement.minPayoutAmount` | `100` | |
| `settlement.reserve.isEnabled` | `false` | |
| `refund.windowHours` · `vendorApprovalHours` · `adminBufferHours` | | 🔴 teeno ka jod `delayDays × 24` se zyada nahi ho sakta — save par enforce hota hai |
| `vendor.subscription.gstPercentage` · `isGstInclusive` | | |
| `customer` ke voucher/claim knobs | | |
| `storage.limits` (per-surface size caps) | | live hain, restart nahi chahiye |

Poori list: [setting_fields_reference.json](./setting_fields_reference.json).

**Aur ye domain data, panel se:**

- [ ] Categories + SubCategories
- [ ] Subscription plans (phir `setPlanEntitlements.js --apply`)
- [ ] Terms & Conditions, Privacy Policy
- [ ] Banners / promotional tickers (asli artwork)
- [ ] `app` block — force-update version, support number (`GET /app-config` yahi
      public deta hai)

### 8.4 🔴 Pehla admin **alert nahi le paayega** jab tak email verify na ho

`seedAdmin.js` account banata hai jisme `isEmailVerified: false`
([`models/User.js:165`](../models/User.js) ka default).

Aur admin audience ke liye WhatsApp platform-wide **band** hai
(`ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled = false`). Yaani
admin ka **ekmatra** outbound channel email hai — aur unverified email par
`ALWAYS_DELIVER_TYPES` (`SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED`,
`SHADOW_INDEX_REAPED`) **bheje hi nahi jaate**.

Boot par ye check hota hai
([`helpers/notifications/assertReachableAdmins.js`](../helpers/notifications/assertReachableAdmins.js))
aur log me bolta hai.

**Theek kaise karein — do call:**

```http
POST /trydood/v1/auth/email/send-verification
POST /trydood/v1/auth/email/verify        { "otp": "…" }
```

> 🔴 Ye launch checklist ka hissa hai, "baad me dekh lenge" wali cheez nahi.
> Iske bina jis din ledger drift hoga ya refund fail hoga, us din kisi ko pata
> hi nahi chalega — aur `CLAUDE.md` ke hisaab se wahi failure ka sabse mehenga
> shape hai.

### 8.5 `Setting` document kab banta hai

Koi seeder iske liye nahi hai. Wo **pehli settings read par** apne aap ban jaata
hai ([`helpers/settings/getSetting.js:100-116`](../helpers/settings/getSetting.js)),
schema defaults ke saath.

Aur production me wo read **boot par hi** ho jaati hai — `startJobs()` →
`getSubscriptionConfig()`. Yaani:

> 🔴 **Pehle boot ke waqt jo `MEDIA_PROVIDER` hoga, wahi `Setting.storage.provider`
> ban jaayega** ([`models/Setting.js:996`](../models/Setting.js)) — aur wo
> **preflight se nahi guzrega**, kyunki preflight sirf panel se provider badalne
> par chalta hai. §9.2 dekhiye.

---

## 9. Third-party — har service ka production switch

### 9.1 Razorpay — do alag merchant, do alag webhook

**Dashboard → Settings → Webhooks**, **dono** account par alag-alag:

| Account | URL |
|---|---|
| VENDOR (subscription) | `https://api.trydood.com/trydood/v1/transactions/webhook/razorpay` |
| CUSTOMER (voucher claim) | `https://api.trydood.com/trydood/v1/transactions/webhook/razorpay/customer` |

**14 events subscribe kijiye** ([`constants/webhook.js:15-37`](../constants/webhook.js)):

```
payment.captured            payment.authorized          payment.failed
order.paid
refund.created              refund.processed            refund.failed
settlement.processed
payment.dispute.created     payment.dispute.under_review
payment.dispute.action_required
payment.dispute.won         payment.dispute.lost        payment.dispute.closed
```

> 🔴 **`settlement.processed` chhootne ka natija sabse chhupa hua hai.**
> `fundsReceivedAt` ka ekmatra writer wahi hai, aur `buildEligibilityFilter`
> uske bina kisi payment ko settle karne se mana kar deta hai. Ek lost delivery
> = us batch ke payments **hamesha ke liye unpayable**, aur kahin kuch nahi
> kehta: koi webhook fail nahi hota, koi `Settlement` row banti hi nahi jise
> `alertLateSettlements` dhoondh sake, aur build `brandsChecked: 0` ke saath
> **success** report karta hai.
>
> Isi liye `reconcileGatewaySettlements` job hai — par event subscribe karna
> phir bhi pehla kaam hai.

**Aur:**

- [ ] Dono account ka webhook **secret** alag hai — sahi env var me daaliye
- [ ] `RAZORPAY_WEBHOOK_SECRETS` comma-separated list hai, taaki rotation me
      downtime na ho
- [ ] Dono webhook path rate limiter se **exempt** hain
      ([`index.js:114-117`](../index.js)). Teesra webhook joda to use bhi
      `WEBHOOK_PATHS` me daalna padega — warna 429 milega, Razorpay kuch der
      retry karega aur phir chhod dega, aur ekmatra lakshan ye hoga ki **paisa
      chalna band ho gaya**
- [ ] Auto-capture **on** hai — warna `alertStuckAuthorizations` har payment par
      firing karega

Boot par `logPaymentAccounts()` dono account ka mode (`live` / `test`) aur
webhook secret ki ginti chhapta hai. **Us line ko padhiye.**

### 9.2 Storage — 🔴 pehla boot **`CLOUDINARY`** par

Ye is doc ki sabse aasani se ho jaane wali galti hai.

Fresh DB par `Setting` pehle boot par banta hai (§8.5) aur `MEDIA_PROVIDER` se
apna `storage.provider` utha leta hai — **bina preflight ke**. Agar wo waqt
`AWS_S3` hua aur CloudFront tayyar nahi, to platform S3 par live ho jaayega aur
**har image 403 degi**, bina kisi rukawat ke, bina kisi warning ke.

```
1. MEDIA_PROVIDER=CLOUDINARY  ke saath pehla boot
2. Panel se:  PUT /settings/update  { "storage": { "provider": "AWS_S3" } }
   → checkS3Ready() chalega: dono bucket me likho-padho-mitao, aur public bucket
     ki ek object BINA CREDENTIALS ke fetch karo
   → fail hua to 422, save hota hi nahi
3. Verify: naya upload → row me URL cdn.trydood.com ka ho → incognito me khule
```

> 🔮 **Fresh DB ka ek faayda uthaiye:** ye switch **pehle asli upload se pehle**
> kar dijiye. Tab ek bhi row Cloudinary par nahi banegi, aur aapke paas do-provider
> wali kisi cheez ka koi legacy hi nahi rahega. Boot CLOUDINARY par, phir turant
> panel se AWS_S3 — dono baatein ek saath.

Poora storage sequence, rollback samet:
[production_go_live_runbook.md](./production_go_live_runbook.md).

⚠️ `presignEnabled` **off** hi rehne dijiye (default `false`). Wo client ka kaam
maangta hai aur Cloudinary par to wo `409` deta hi hai.

### 9.3 Baaki

| Service | Production checklist |
|---|---|
| **Cloudinary** | Prod account (dev wala nahi). `CLOUD_BASE_URL` sahi cloud ka |
| **FCM** | Prod Firebase project ka service account. `FCM_PRIVATE_KEY` me newline `\n` likhiye |
| **Email** | Gmail app password (account password nahi) — §3.4 |
| **TENDIGIT** | 🔴 §2.1 ke baad ye login ka raasta hai. Staging par pehle asli OTP test kijiye |
| **2Factor** | `TWO_FACTOR_API_KEY` |
| **CGPEY** | Prod merchant id + keys. PAN/GST/bank verification isi par hai |
| **WhatsApp templates** | Sirf Meta-approved template ids. Khali = us message par skip, error nahi |

---

## 10. Deploy sequence — theek kram

```
┌─ CODE ────────────────────────────────────────────────────────┐
│  1. §2.1 WhatsApp OTP uncomment  (staging par TENDIGIT test    │
│     karne ke BAAD)                                            │
│  2. §2.2 ka script fix — OPTIONAL. Chhod sakte hain,          │
│     panel se ho jaayega (kadam 21)                            │
│  3. npm run verify                                            │
│  4. npm run test:unit            (41 file, seconds)           │
│  5. npm test                     (102 file, 36-72 min) — §3.6 │
└───────────────────────────────────────────────────────────────┘
┌─ AWS ─────────────────────────────────────────────────────────┐
│  6. Atlas: project, cluster, user, Network Access (EIP)       │
│  7. EC2 + EIP + SG + IAM role                                 │
│  8. S3 prod buckets + CloudFront verify                       │
│  9. DNS: api.trydood.com → EIP                                │
└───────────────────────────────────────────────────────────────┘
┌─ MACHINE ─────────────────────────────────────────────────────┐
│ 10. Node 24.20, user, clone, npm ci --omit=dev                │
│ 11. /etc/trydood/prod.env   (chmod 600)                       │
│     ⚠️ CONFIG_PROFILE=PRODUCTION  yahin                        │
│     ⚠️ MONGO_AUTO_INDEX=true      abhi ke liye                 │
│     ⚠️ MEDIA_PROVIDER=CLOUDINARY                               │
│ 12. nginx + certbot  (client_max_body_size 110M!)             │
│ 13. systemd unit + enable --now                               │
└───────────────────────────────────────────────────────────────┘
┌─ PEHLA BOOT ──────────────────────────────────────────────────┐
│ 14. journalctl -u trydood -f     →  §11 ki har line padhiye   │
│ 15. curl https://api.trydood.com/               → welcome     │
│ 16. §1.3 ka TRUST_PROXY test                                  │
└───────────────────────────────────────────────────────────────┘
┌─ DATABASE ────────────────────────────────────────────────────┐
│ 17. ensureIndexes.js --apply   →  "Nothing missing"           │
│ 18. MONGO_AUTO_INDEX=false  →  restart  →  "autoIndex off"    │
│ 19. seedAdmin.js --apply                                      │
└───────────────────────────────────────────────────────────────┘
┌─ PANEL ───────────────────────────────────────────────────────┐
│ 20. Admin login → email verify  (§8.4)                        │
│ 21. 🔴 Seller identity — GSTIN + companyStateCode  (§2.2)     │
│     Ye kadam 25 se PEHLE hona hi chahiye                      │
│ 22. Commission, GST %, settlement, refund windows             │
│ 23. Categories, plans, legal, app config                      │
│ 24. setPlanEntitlements.js --apply                            │
└───────────────────────────────────────────────────────────────┘
┌─ GATEWAY + STORAGE ───────────────────────────────────────────┐
│ 25. Razorpay: 2 webhook URL, 14 events, dono account          │
│ 26. Test payment (chhoti amount) → webhook aaya? → refund     │
│     🔴 Iski invoice kholiye: seller GSTIN hai? CGST+SGST      │
│        aaya ya IGST? Ye kadam 21 ka asli proof hai            │
│ 27. Panel se storage AWS_S3  (preflight pass hona chahiye)    │
│ 28. Upload → CDN URL → incognito me khule                     │
└───────────────────────────────────────────────────────────────┘
┌─ 48 GHANTE ───────────────────────────────────────────────────┐
│ 29. §12                                                       │
└───────────────────────────────────────────────────────────────┘
```

---

## 11. Boot ke baad — line by line, kya dikhna chahiye

`journalctl -u trydood -n 100`. Ye log jaan-bujh kar itna mukhar hai — har line
ek aise sawaal ka jawab hai jo warna weeks baad pata chalta.

```
✅ Trydood 2.0 MongoDb connection established
   pool 2-20 · select 10000ms · autoIndex off          ← §7.3 ke baad "off"
✅ Mounted: /auth → auth.js                            ← 36 router
   …
✅ Trydood 2.0 Server running on http://localhost:8080
✅ [notify] email     configured
✅ [notify] push      FCM configured
✅ [notify] mail CTA  vendor, admin and invoice link bases configured
✅ [notify] whatsapp  N template(s): …
✅ [pay] VENDOR    rzp_live_xxxx… · live · 1 webhook secret
✅ [pay] CUSTOMER  rzp_live_xxxx… · live · 1 webhook secret
✅ [s3] trydood-prod-public / trydood-prod-private · ap-south-1 · credentials: instance role or shared config
🕒 [jobs] expireSubscriptions scheduled every 60m
   … (22 jobs)
✅ [jobs] 22 registered · lock: enabled · instance <id>
```

**Ek-ek line ka matlab, aur galat aaye to kya:**

| Line | Galat hone par |
|---|---|
| `autoIndex on` jabki aapne `false` set kiya | env file load hi nahi hui, ya `EnvironmentFile` path galat |
| `⚪ [notify] mail CTA  PUBLIC_API_URL, CUSTOMER_APP_URL unset` | invoice link aur 10 customer email ke button gaayab — §6.7 |
| `⚪ [notify] email  not configured` | **koi mail nahi jaayegi**, aur kahin error nahi aayega |
| `[pay] … test` | 🔴 test keys. (Waise Guard 3 ko boot pehle hi rok dena chahiye tha) |
| `[pay] … 0 webhook secrets` | 🔴 webhook signature verify hi nahi hoga → payment settle nahi honge |
| `⚠️ [s3] … credentials: environment key (…XXXX)` | 🔴 §6.5 — role ki jagah purani key chal rahi hai |
| `⏸️ [jobs] DISABLED via ENABLE_JOBS=false` | 🔴 22 safety net band. Sabse chup failure |
| `⚠️ [jobs] X last succeeded Nm ago` | wo job chal nahi rahi |
| `⚠️ [idx] <name> is MISSING` | uniqueness enforce nahi ho rahi — `ensureIndexes` dobara |
| `[notify] admin reachability` warning | §8.4 — admin ka email verify nahi hua |

**Aur ye teen check:**

```bash
curl -s https://api.trydood.com/                         # "Welcome to Trydood 2.0🚀"
curl -s https://api.trydood.com/my-ip                    # EIP dikhna chahiye (Atlas list ke liye)
curl -s https://api.trydood.com/trydood/v1/app-config    # public config
```

⚠️ `GET /` **health check hai, readiness nahi** — wo database ko chhoo tak nahi
raha. Uska 200 sirf itna kehta hai ki process zinda hai. Par kyunki boot bina
database ke chalta hi nahi, "port khula hai" ka matlab hai "boot ke waqt DB
theek tha".

Gehra health check (admin token chahiye):

```http
GET /trydood/v1/transactions/admin/health
```

---

## 12. Pehle 48 ghante

| Kab | Kya dekhein | Kahan |
|---|---|---|
| +5 min | `⛔ Error` koi hai? | `journalctl -u trydood -f \| grep '⛔'` |
| +15 min | `resumeIncompleteSettlements` chali? | `✅ [jobs] resumeIncompleteSettlements finished` |
| +1 ghanta | 22 jobs me se koi fail? | `journalctl \| grep '❌ \[jobs\]'` |
| +1 ghanta | Atlas connection count | 20 ke aas-paas hona chahiye |
| Pehla payment | Webhook aaya? | `GET /transactions/webhook/events` (admin) |
| Pehla payment | Invoice bani? | Transaction par `settlementStage = COMPLETE` |
| Pehla refund | Ledger balance | `GET /transactions/admin/health` |
| +24 ghanta | `buildSettlements` ne kuch banaya? | jobs ka log |
| +24 ghanta | Disk | `df -h /` aur `du -sh /tmp/trydood-*` |
| +48 ghanta | `reapShadowIndexes` ne kuch drop kiya? | 🔴 kiya to koi aur writer hai — §7.5 |

**Alert set kar lijiye (kam se kam ye chaar):**

1. Atlas — connection count, disk, CPU
2. CloudWatch — EC2 disk > 80%, CPU sustained
3. Uptime monitor — `GET /` par, 1 minute
4. 🔴 **Admin ke email par asli inbox** — `SETTLEMENT_LEDGER_DRIFT` aur
   `REFUND_FAILED` wahin aayenge, aur §8.4 ke bina wo kahin nahi aayenge

---

## 13. Purane doc me kya stale hai

[production_go_live_runbook.md](./production_go_live_runbook.md) **aaj bhi sahi
hai** — Cloudinary→S3 ke switch ke liye wahi padhiye. Jo cheezein purani pad
chuki hain, sirf ye:

| Kahan | Kya likha hai | Aaj ka sach |
|---|---|---|
| §4 "Abhi kahan khade hain — 2026-09-19" | `CloudFront + DNS` ❌ **nahi bana** | ✅ Ban chuka hai. Usi doc ke §4 ka upar wala box (2026-09-22) sahi hai — nonprod par poora round trip pass. Neeche ki table us box se **takra** rahi hai |
| §4 ka kram box | `2. Non-prod CloudFront ← ab yahan hain` | Wo kadam ho chuka |
| §9 ki table, X-1 ki row | "CloudFront + resize — backend ka hissa ho chuka" | Sahi, par status "nahi bana" ab galat |

**Aur in dono doc me:**

| Doc | Kya purana |
|---|---|
| [aws_s3_setup.md](./aws_s3_setup.md) §Status (2026-09-19) | `CloudFront ❌ nahi bana` — ab bana hai |
| [aws_s3_setup.md](./aws_s3_setup.md) §10.1 | *"Aaj `.env` me `S3_BUCKET_ADMIN=trydood-admin` hai"* — **ab nahi hai**. Khatra sirf `.env.example` se copy karne ka bacha (§6.3) |
| [master_execution_plan.md](./master_execution_plan.md) §0.6 | *"🔴 Delivery blocked hai"* + `cdn.trydood.com` ENOTFOUND — wo 2026-09-18 ka probe hai |
| [security_findings.md](./security_findings.md) header | "229 endpoints" — aaj **231** (`verifyApiCoverage.js` se naapa) |
| `CLAUDE.md` · Production section | "21 background jobs" — registry me **22** hain (`jobs/index.js` gina) |

**Chhoti line-number drift** (purane runbook me, material nahi):

| Reference | Asli |
|---|---|
| `preflight.js:262` — `PROVIDERS_NEEDING_PREFLIGHT` | line **271** |
| `preflight.js:111` — `images/__preflight/` | line **120** |

Baaki saare references maine spot-check kiye — `services/storage/index.js:47`,
`:60`, `:299`, `models/Setting.js:996`, `:1038`, `index.js:157`, `:176`, `:212`,
`:267`, `configs/s3.js:42-60`, `:83`, `updateSetting.js:242`, `routes/settings.js:11`
— **sab sahi hain**.

---

## 14. Rollback

### Storage (turant, bina preflight)

```json
{ "storage": { "provider": "CLOUDINARY" } }
```

`PROVIDERS_NEEDING_PREFLIGHT` me **sirf `AWS_S3`** hai
([`preflight.js:271`](../services/storage/preflight.js)) — wapas jaana kisi round
trip par nahi atakta. Jaan-bujh kar: incident ke waqt wapas aana kabhi kisi probe
par nahi rukna chahiye.

🔴 **Purana media dono taraf chalta rehta hai.** `provider` sirf **naye** upload
ka raasta batata hai; kisi maujooda asset ko padhna/delete karna hamesha **us row
ke apne** `storage.provider` ko follow karta hai
([`services/storage/index.js:60`](../services/storage/index.js)). Isi liye
rollback ke baad bhi bucket aur CloudFront zinda rakhne hain.

### Code

```bash
cd /opt/trydood/app && sudo -u trydood git checkout <pichhla-tag>
cd server && sudo -u trydood npm ci --omit=dev
sudo systemctl restart trydood
```

⚠️ Agar us release ne koi naya index joda tha, to **index wapas nahi jaata** —
aur wo theek hai: extra index kuch todta nahi. `ensureIndexes` kabhi drop nahi
karta.

### Database

Fresh launch ke pehle kuch din, Atlas ka point-in-time restore hi asli rollback
hai. **Isi liye backup pehle din se on hona chahiye.**

---

## 15. Quick reference

| Sawaal | Jawab |
|---|---|
| Kitne code change chahiye? | **Ek** — §2.1 (WhatsApp OTP). §2.2 ka script fix optional hai |
| Seller GSTIN baad me badal sakte hain? | Naam/GSTIN/address ✅ (regenerate live config padhta hai). **Tax head ❌** — `pricing` frozen hai. Isliye **pehle asli payment se pehle** — §2.2 |
| Migration scripts chalane hain? | ❌ Ek bhi nahi. Fresh DB me convert karne ko kuch nahi |
| DB ka naam kya rakhein? | Kuch bhi jisme **`prod`** ho. Warna boot fail |
| `CONFIG_PROFILE` kahan? | 🔴 **systemd ke EnvironmentFile me**, `.env` me nahi |
| `TRUST_PROXY`? | nginx/ALB ke saath **1**. Naapiye — §1.3 |
| `MONGO_AUTO_INDEX`? | Pehle `true` → `ensureIndexes --apply` → phir `false` |
| Pehle boot par `MEDIA_PROVIDER`? | 🔴 `CLOUDINARY`. S3 par **panel se** jaiye |
| AWS keys env me? | 🔴 Nahi. Instance role |
| `S3_BUCKET_ADMIN/CUSTOMER/VENDOR`? | 🔴 Likhiye hi mat — boot rok denge |
| `ENABLE_JOBS`? | `true`. `false` = 22 safety net band, chup-chaap |
| Pehla admin kahan se? | `scripts/seedAdmin.js --apply` |
| Admin ko alert kab milenge? | Uska email verify karne ke **baad** — §8.4 |
| Razorpay events kitne? | **14**, dono account par |
| Invoice number kahan se? | `Counter` collection, per series per financial year. Fresh DB = `000001` se |
| Server ka TZ? | `Asia/Kolkata`. Money ka code phir bhi fixed-offset hai |
| `npm test` prod par? | 🔴 **Kabhi nahi** — prod cluster par `<db>_test` bana kar delete karega |

---

## 16. Kadam-dar-kadam — command ke saath

> §4-§11 batate hain **kyun**. Ye section batata hai **kya type karna hai**, ek
> seedhi line me. Har kadam ke aage us section ka link hai jahan uski wajah likhi
> hai.

### A · AWS console par — machine chhoone se pehle

```
A1  Atlas: naya project banao                                     §4.1
A2  Atlas: cluster, region ap-south-1
A3  Atlas: DB user — readWrite SIRF us ek database par
A4  EC2: instance launch (Ubuntu 24.04, t3.small, 20 GB gp3)      §4.2
A5  EC2: Elastic IP allocate + associate
A6  Atlas: Network Access me wahi Elastic IP /32 daalo            §4.1
A7  IAM: role TrydoodAppProd banao, EC2 par attach karo           §4.4
A8  Security Group: 443 + 80 sabke liye, 22 sirf apna IP
    🔴 8080 kabhi mat kholna                                      §4.2
A9  DNS: api.trydood.com  →  Elastic IP
A10 S3: prod buckets + CloudFront verify                          §4.4
```

### B · Machine par — Node aur code

```bash
# B1 — Node 24.20 (Ubuntu ka default purana hai)                    §5.1
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24.20.0 && nvm alias default 24.20.0
node -v                                    # v24.20.0 aana chahiye

# B2 — deploy user                                                  §5.2
sudo useradd -r -m -d /opt/trydood -s /bin/bash trydood

# B3 — code
sudo -u trydood git clone <repo-url> /opt/trydood/app
cd /opt/trydood/app/server

# B4 — install  (npm ci, npm install NAHI)                          §5.2
sudo -u trydood npm ci --omit=dev

# B5 — node ka asli path note kar lo, systemd ko chahiye
which node                                 # /home/.../nvm/.../bin/node
```

> ⚠️ B5 zaroori hai. nvm ka node `/usr/local/bin/node` par nahi hota, aur
> systemd `$PATH` nahi padhta — `ExecStart` me **poora path** likhna padega.

### C · Env file

```bash
# C1
sudo mkdir -p /etc/trydood
sudo nano /etc/trydood/prod.env          # poori list §6.7 me

# C2 — permissions
sudo chmod 600 /etc/trydood/prod.env
sudo chown root:trydood /etc/trydood/prod.env
```

**C3 — likhne se pehle ye paanch dobara dekh lijiye** (§6 ke paanch jaal):

```ini
CONFIG_PROFILE=PRODUCTION      # 🔴 YAHIN, kisi .env file me nahi        §6.1
MONGO_URL=...../Trydood2_prod  # 🔴 naam me "prod" — warna boot fail     §6.2
MONGO_AUTO_INDEX=true          # abhi true. G3 ke baad false             §7.3
MEDIA_PROVIDER=CLOUDINARY      # 🔴 pehle boot par                       §9.2
TRUST_PROXY=1                  # nginx ke saath                          §1.3
```

**C4 — aur ye likhiye hi mat:**

```
AWS_ACCESS_KEY_ID  /  AWS_SECRET_ACCESS_KEY     → instance role hai     §6.5
S3_BUCKET_ADMIN / CUSTOMER / VENDOR             → boot rok denge        §6.3
TEST_DB_KEEP_CONNECTION                         → test-only
```

> 🔴 **`.env` ya `.env.production` file machine par rakhiye hi mat.** Sab kuch
> `/etc/trydood/prod.env` me. Wajah §6.4 me.

### D · nginx + TLS

```bash
# D1
sudo apt install -y nginx certbot python3-certbot-nginx

# D2 — config  (poora block §5.4 me)
sudo nano /etc/nginx/sites-available/trydood
sudo ln -s /etc/nginx/sites-available/trydood /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# D3 — 🔴 do line jo bhoolna mehenga padta hai
#      client_max_body_size 110M;                          §5.4
#      proxy_set_header X-Forwarded-For $remote_addr;       §1.3

# D4
sudo nginx -t && sudo systemctl reload nginx

# D5 — TLS
sudo certbot --nginx -d api.trydood.com
systemctl list-timers | grep certbot       # auto-renew laga?
```

### E · systemd

```bash
# E1 — unit file  (poora block §5.3 me)
sudo nano /etc/systemd/system/trydood.service
#   ExecStart me B5 wala poora node path
#   Environment=TZ=Asia/Kolkata
#   Restart=on-failure
#   EnvironmentFile=/etc/trydood/prod.env

# E2
sudo systemctl daemon-reload
sudo systemctl enable --now trydood        # 🔴 enable bhoolna = reboot par server wapas nahi

# E3
sudo systemctl status trydood
```

### F · Pehla boot verify

```bash
# F1 — boot log, line by line                                       §11
journalctl -u trydood -n 100 --no-pager

# F2 — teen check
curl -s https://api.trydood.com/
curl -s https://api.trydood.com/my-ip            # EIP dikhe
curl -s https://api.trydood.com/trydood/v1/app-config

# F3 — TRUST_PROXY ka asli test                                     §1.3
curl -si https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
curl -si https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
curl -si -H "X-Forwarded-For: 203.0.113.9" \
     https://api.trydood.com/trydood/v1/app-config | grep -i '^ratelimit'
# ginti chalti rahe = sahi · reset ho jaaye = TRUST_PROXY zyada hai
```

### G · Database

```bash
cd /opt/trydood/app/server
set -a; . /etc/trydood/prod.env; set +a     # 🔴 scripts .env padhte hain, host env nahi  §6.6

# G1 — dry run. "database :" line me naam confirm karo
node scripts/ensureIndexes.js

# G2 — apply
node scripts/ensureIndexes.js --apply       # "✅ Nothing missing" aana chahiye

# G3 — ab autoIndex band                                            §7.3
sudo nano /etc/trydood/prod.env             # MONGO_AUTO_INDEX=false
sudo systemctl restart trydood
journalctl -u trydood -n 20 | grep autoIndex    # "autoIndex off"

# G4 — pehla admin                                                  §8.1
node scripts/seedAdmin.js --email admin@trydood.com --password '<strong>' \
  --name "Admin User" --username admin_user --mobile 9800000000
node scripts/seedAdmin.js ... --apply       # dry run dekh kar phir --apply

# G5 — do read-only check                                           §7.6
node scripts/verifyNullableUniques.js
node scripts/verifySchemaRelationships.js   # 2 known findings — §3.5
```

### H · Panel se

```
H1  Admin login
H2  🔴 Admin ka email verify                                        §8.4
      POST /auth/email/send-verification  →  POST /auth/email/verify
      bina iske ledger-drift / refund-failed alert KAHIN nahi jaayenge
H3  🔴 Seller identity — companyGstin + companyStateCode            §2.2
      PEHLE ASLI PAYMENT SE PEHLE
H4  Commission %, GST %, settlement delayDays, refund windows       §8.3
H5  Categories + SubCategories
H6  Subscription plans      →  phir  node scripts/setPlanEntitlements.js --apply
H7  Terms & Conditions, Privacy Policy
H8  app block — force-update version, support number
```

### I · Gateway + storage

```
I1  Razorpay VENDOR   → webhook URL + 14 events                     §9.1
I2  Razorpay CUSTOMER → webhook URL + 14 events
I3  Dono ke webhook secret env me  →  restart  →  boot log me count check
I4  🔴 Test payment (chhoti amount)
      · webhook aaya?          GET /transactions/webhook/events
      · settlementStage COMPLETE?
      · invoice par seller GSTIN hai? CGST+SGST aaya ya IGST?   ← H3 ka proof
I5  Refund test
I6  Panel se storage → AWS_S3  (preflight pass hona chahiye)        §9.2
I7  Upload → row me CDN URL → incognito me khule
```

### J · Nigrani

```
J1  Atlas alerts: connection count, disk, CPU                       §12
J2  CloudWatch: disk > 80%, CPU
J3  Uptime monitor: GET /  har 1 minute
J4  🔴 Admin ke email ka asli inbox — alerts wahin aayenge
J5  48 ghante ki checklist                                          §12
```

---

## 17. Staging server — aur database share karne ka sawaal

> ⚠️ **Do bilkul alag sawaal hain, aur jawab ulta hai:**
>
> | | Sawaal | Jawab |
> |---|---|---|
> | **17.0** | Staging aaj wala **`Trydood2`** (dev DB) use kare? | ✅ **Haan** — teen shart ke saath |
> | **17.1** | Staging **production** ka DB use kare? | 🔴 **Bilkul nahi** |
>
> Farq data ka hai. `Trydood2` development data hai — `CLAUDE.md` ka apna line:
> *"Production starts on a fresh, empty database at launch"*, aur dev/stage/postman
> teeno **disposable** hain. Production ka DB kuch aur hi cheez hai.

### 17.0 ✅ Staging par `Trydood2` — haan, teen shart ke saath

Aaj dev laptop `Trydood2` par chalta hai. Staging server bhi usi par chale — ye
theek hai, aur kai baar yahi chahiye bhi hota hai (staging par wahi data dikhe jo
aap mahino se bana rahe hain).

#### Jo apne aap theek rahega — kuch karna nahi padega

| Cheez | Kyun kaam karta hai |
|---|---|
| **Media** | Dev `dev/` prefix par likhta hai, staging `stg/` par — ek hi nonprod bucket, ek hi CloudFront. URL row par **poora** bake hota hai, to dono URL saath chalti hain. Design me yahi socha gaya tha |
| **Razorpay webhook** | `WebhookEvent.eventId` **unique** hai ([`models/WebhookEvent.js:44`](../models/WebhookEvent.js)), to ek hi event dono jagah pahunche to doosra dedupe ho jaata hai. Dono URLs dashboard me rakh sakte hain |
| **Money suite** | `npm test` `MONGO_URL` se `<db>_test` derive karta hai **aur** run lock leta hai — do machine ek saath chalane par doosri naam lekar refuse hoti hai |
| **Jobs ka takrav** | `JobLock` cross-process hai. Dono par on hue to bhi ek hi chalega, doosra skip |

#### 🔴 Teen cheezein jo karni hi hongi

**1. Staging wahi commit chalaye jo dev branch par hai — ya `MONGO_AUTO_INDEX=false`**

Yahi wo bug hai jo is cluster par **do baar** aa chuka hai. Staging ka Mongoose
apne schema ke indexes `Trydood2` par banata hai. Staging kisi purani branch par
raha aur uske schema me `unique: true` kahin bacha hua hua, to `invoiceId_1`
wapas — aur uske rehte **har doosra voucher claim** duplicate-key se reject hota
hai.

```ini
# staging par, agar commit dev se alag ho sakta hai:
MONGO_AUTO_INDEX=false
```

…aur schema badalne par `node scripts/ensureIndexes.js --apply` haath se.

**2. `ENABLE_JOBS` ka faisla saaf kijiye — aaj wo ulta laga hua hai**

| | Aaj | Hona chahiye |
|---|---|---|
| Dev laptop (`.env`) | `ENABLE_JOBS` set hi nahi → **`true`** | **`false`** |
| Staging (`.env.staging`) | `ENABLE_JOBS=false` | **`true`** |

`.env.example` khud kehta hai: *"Set `false` on a development machine — 21
background jobs run against the shared development database and send real
notifications."* Aaj ulta hai.

Aur agar dono par `false` raha, to `Trydood2` par **koi job chalegi hi nahi** —
settlement kabhi build nahi honge, refund escalate nahi honge, subscription expire
nahi hongi. Staging par money flow test karna hai to ye chalna zaroori hai.

> 🔮 Jobs staging ko de dijiye — wo 24×7 upar rehta hai, laptop nahi. Aur laptop
> par notifications bhejna band ho jaayega, jo waise bhi chahiye tha.

**3. 🔴 `.env.staging` ki AWS key purani hai**

```
.env.development   AWS_ACCESS_KEY_ID=AKIAYQOUJNVJWHPKZOGJ     ← naya
.env.staging       AWS_ACCESS_KEY_ID=AKIAYQOUJNVJW52NAL7L     ← purana
```

Dev ki key rotate ho chuki hai, staging ki nahi. Agar rotation me purani key
**delete** ki gayi thi ([aws_s3_setup.md §9](./aws_s3_setup.md) ka kram yahi
kehta hai), to staging ka har upload `InvalidAccessKeyId` par girega.

> 🔮 Staging EC2 par ja raha hai to **key hataiye hi** — instance role laga
> dijiye ([§4.4](#44-s3--cloudfront)). Tab ye poori samasya khatam, aur boot line
> `credentials: instance role` bol kar confirm bhi kar degi.

#### Jo jaan kar chaliye — todta kuch nahi

| | Kya hoga |
|---|---|
| **Settings ek hi document** | Staging par koi setting badli → dev 30 second me wahi dekhega. Dono non-prod hain, to nuksaan nahi — par "maine to kuch nahi badla" wali confusion hoti hai |
| **Test data mil jaayega** | Staging ke clicks dev me dikhenge aur ulta bhi. Demo server ke liye ye aksar chahiye hi hota hai |
| **`seedHomeBanners.js`** | **Hard delete** karta hai — kisi bhi machine se chalaya, dono ke banner gaye |
| **OTP throttle** | Ek hi number ka 5-per-hour quota dono me batega |
| **Connections** | laptop 20 + staging 20 = 40, aur koi script chale to transiently +100 |
| `CONFIG_PROFILE=STAGING` | Guard 3 (`prod` naam wala check) chalta hi nahi — `Trydood2` naam chalega |

#### Ya ek saaf raasta, kharcha ₹0

`.env.staging` me **pehle se** `Trydood2_staging` likha hai. Wahi rehne dijiye to:

- staging par ek saaf demo dataset rakh sakte hain,
- branch ke beech index drift kabhi paar nahi karega,
- kisi ek ko wipe karna doosre ko chhuega nahi.

**Faisla is par hai:** staging par **wahi data** dikhana hai jo aap dev par bana
rahe hain → `Trydood2` share kijiye (upar ki teen shart ke saath). Staging ko
**apna saaf** data chahiye → `Trydood2_staging`.

---

### 17.1 🔴 Production ka database share mat kijiye

Ye "thoda risky" wali baat nahi hai. Ye **wahi bug dobara banana** hai jiska
`CLAUDE.md` me poora section likha hai.

Code se verify karke, nau cheezein jo tootengi:

| # | Kya | Kyun, code se |
|---|---|---|
| 1 | 🔴 **Shadow index wapas** | Stage ka Mongoose apne schema ke index **production ki collections** par banayega. Stage kisi purani branch par hua to `invoiceId_1` wapas — aur uske rehte **har doosra voucher claim** duplicate-key se reject hota hai, ek aise field par jise customer ne chhua bhi nahi. `CLAUDE.md` ka *"an older build of this same service"* — wahi, jaan-bujh kar banaya hua |
| 2 | 🔴 **Media URL mil jaayenge** | URL row par **likhne ke waqt** bake hota hai, padhte waqt nahi. Stage `.../stg/...` likhega production ki rows me. Aur `staging/` prefix par **1 din ka lifecycle** hai ([aws_s3_setup.md §2.4](./aws_s3_setup.md)) — to ek din baad production me tooti hui image, jise haath se theek karna padega |
| 3 | 🔴 **Settings ek hi document hai** | `Setting` poore platform ka ek document hai. Stage par `storage.provider` ka dropdown badla → **production badal gaya**. Commission, GST %, settlement timing, aur public `app` block (force-update version) — sab shared |
| 4 | 🔴 **Invoice number me hole** | `Counter._id` sirf `INVOICE:<series>:<FY>` hai — usme tier hai hi nahi ([`models/Counter.js:5`](../models/Counter.js)). Stage ki ek test invoice production ki series se ek number kha jaayegi. [`generateDocumentNumber.js`](../helpers/documents/generateDocumentNumber.js) kehta hai ki hole *"the one thing these series may not have"* |
| 5 | 🔴 **Jobs takrayenge** | `JobLock._id` sirf **job ka naam** hai ([`models/JobLock.js:28`](../models/JobLock.js)) — koi tier nahi. Dono par `ENABLE_JOBS=true` hua to jo pehle lock leta hai wahi chalta hai. Yaani stage ki **test Razorpay keys** se production ke payment reconcile karne ki koshish |
| 6 | 🔴 **Test data production me** | Har brand, voucher, customer jo stage par click karke banega, production me dikhega |
| 7 | 🔴 **Seed script** | `seedHomeBanners.js` **hard delete** karta hai — is repo ki ekmatra aisi script. Stage par ek baar chala diya, production ke saare banner gaye |
| 8 | 🟠 **OTP throttle** | `OtpThrottle` number+purpose par shared. Stage ki testing production customer ka 5-per-hour quota kha jaayegi |
| 9 | 🟠 **Notifications** | Stage se asli email / WhatsApp production users ko |

### 17.2 Agar phir bhi share karna hi ho

Paanch cheezein **non-negotiable** hongi, aur phir bhi #2, #3, #4, #6 bachengi:

| | Kya | Kyun |
|---|---|---|
| 1 | `ENABLE_JOBS=false` stage par | `.env.staging` me pehle se hai — hataiye mat |
| 2 | `MONGO_AUTO_INDEX=false` stage par | #1 ka ekmatra bachaav |
| 3 | Stage **wahi commit** chalaye jo prod | Alag schema = alag index |
| 4 | Stage par koi seed / migration script **nahi** | #7 |
| 5 | Stage se `PUT /settings/update` **kabhi nahi** | #3 |

> 🔴 Ye paanch lagane ke baad bhi: stage ka test data production me dikhega,
> stage ki media URL production ki rows me hogi aur ek din me mar jaayegi, aur
> invoice series me hole rahenge. **Ye configuration se theek hone wali cheez
> nahi hai.**

### 17.3 Jo karna chahiye — aur uska kharcha ₹0 hai

Stage ko **apna database** dijiye. Sirf connection string ka naam badalta hai:

```ini
MONGO_URL=mongodb+srv://…/Trydood2_staging
```

`.env.staging` me ye pehle se likha hai. Aur baaki sab bhi pehle se alag hai —
`stg/` prefix, nonprod buckets, test Razorpay keys.

> 🔮 **Sabse saaf bandobast:** stage **purane cluster par hi rahe** (jahan aaj
> hai), aur production **naye project + cluster** par jaaye (§4.1). Tab do
> faayde ek saath milte hain — stage prod ko chhoo hi nahi sakta, **aur** wo
> purana build jo `invoiceId_1` banata hai wo bhi production tak nahi pahunch
> sakta.

Agar dono ek hi cluster par rakhne hain, to bas do baatein:

- Atlas Network Access me **stage ke server ka IP bhi** daalna hoga
- Connection ginti jud jaayegi — prod 20 + stage 20 = 40 (§7.4)

### 17.4 Stage server ka setup — prod se kya alag

Wahi §16 ke kadam, in farqon ke saath:

| | Production | Staging |
|---|---|---|
| `CONFIG_PROFILE` | `PRODUCTION` | `STAGING` |
| Guard 3 (prod checks) | chalta hai | **nahi chalta** — `load.js:131` sirf PRODUCTION par |
| `MONGO_URL` | `…/Trydood2_prod` | `…/Trydood2_staging` |
| Razorpay | `rzp_live_` | `rzp_test_` |
| S3 buckets | `trydood-prod-*` | `trydood-nonprod-*` |
| `S3_PREFIX` | khali | `stg/` |
| `CDN_BASE_URL` | `https://cdn.trydood.com` | non-prod distribution ka domain |
| AWS credentials | instance role | role ya non-prod IAM user |
| `ENABLE_JOBS` | `true` | `false` — `.env.staging` me pehle se |
| `RATE_LIMIT_MAX` | `3000` | `10000` (testing ke liye) |
| `MONGO_AUTO_INDEX` | `false` (G3 ke baad) | `true` theek hai — apna DB hai |
| `MEDIA_PROVIDER` | `CLOUDINARY` → panel se S3 | wahi |

> 🔴 **Ek galti jo stage par chup-chaap hoti hai:** `CDN_BASE_URL` me **prod** ka
> domain reh jaana. Purane runbook ka §5.1 isi par hai — tab dev machine par
> `cdn.trydood.com` set tha jabki bucket nonprod tha. Nateeja: har row me
> `https://cdn.trydood.com/stg/...` likha jaata, jo prod distribution hai aur
> key nonprod bucket me — yaani **404**. Aur URL likhne ke waqt bake hoti hai,
> to har aisi row baad me haath se theek karni padti.

---

## Sambandhit docs

| Doc | Kya |
|---|---|
| [production_go_live_runbook.md](./production_go_live_runbook.md) | Cloudinary → S3 switch ka sequence, preflight, rollback |
| [aws_s3_setup.md](./aws_s3_setup.md) | AWS ka poora setup — bucket, IAM, CloudFront, har command |
| [environment_and_services_map.md](./environment_and_services_map.md) | Har env var, tier-wise, aur kyun `CONFIG_PROFILE` |
| [setting_fields_reference.json](./setting_fields_reference.json) | Har setting field ka matlab aur cross-field rules |
| [security_findings.md](./security_findings.md) | §7 — WhatsApp OTP bypass ka ready patch |
| [api_client_auth_plan.md](./api_client_auth_plan.md) | Client auth + CORS allowlist + per-account limits — **locked, unimplemented** |
| [master_execution_plan.md](./master_execution_plan.md) | Block X (infra), Block O (khula: O-2) |
| [settlement_flow.md](./settlement_flow.md) · [refund_flow.md](./refund_flow.md) · [dispute_flow.md](./dispute_flow.md) | Money ke teen flow |
