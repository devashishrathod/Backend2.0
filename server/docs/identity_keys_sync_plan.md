# Identity keys — `email` · `mobile` · `whatsappNumber`

**Kaun si key kis flag ki hai, kaun use likh sakta hai, kahan verify hoti hai, aur role collection ke saath kaise sync rehti hai.**

> **Status: IMPLEMENTATION chal raha hai. Saare decisions §12 me tay hain.**
>
> | Phase | | |
> |---|---|---|
> | 0 · phone normalise | ✅ | `normalisePhone` + `contactFields.js` + `validJoiPhone.js` + script. Setter har write path par verify hua. Dev DB pe 0 rows badalne the — sab pehle se 10-digit. Money suite: 68/69 suites pass |
> | 1 · flags ki wiring | ✅ | `isWhatsappVerified` + `loginType` + `isFirst` + admin panel ke 4 filter/projection. Backfill **apply ho chuka**: 55 flagged, 53 cleared, 2 ke dono flag |
> | 2 · identity layer | ✅ | `roleProfiles` · `applyIdentityChange` · `syncRoleProfileIdentity` · `canWriteIdentity` + 9 call sites + sync script. **18 naye test**, guard hata kar fail hote dekhe |
> | 3 · login gate | ✅ | `assertIdentityVerified` dono OTP login paths par + seed fix. **6 naye test**, takeover scenario end-to-end |
> | 4 · mobile | ✅ | `sendThrottledMobileOtp` (throttle ab teeno channels par) + `/auth/mobile/*` |
> | 5 · whatsappNumber | ✅ | Step-up + `sessionInvalidatedAt` + `/auth/whatsapp/*`. **11 naye test**, step-up guard hata kar fail hote dekha |
> | 6 · admin contact | ✅ | `PATCH /users/admin/:userId/contact` — reason required, flags `false`, sessions kill, in-app notice |
> | 7 · notification guard | ✅ | Default table sach me padhi jaati hai · `isChannelAllowed` me teesra switch · `notify` ka fallback chain hata · toggle-on `422` · `blockedBy: UNVERIFIED` · `assertReachableAdmins` boot par. **11 naye test** |
> | 8 · docs + postman | ✅ | 4 docs · 3 collections · 3 generators · 3 environments. `verifyApiCoverage` **223/223**, totals **220** |
>
> ✅ **Wo 5 purani failures ab theek hain.** Wo `constants/notification.js` ke
> uncommitted `email: false` se thin, jinka saathi fix §6.3 me tha — Phase 7 ke saath
> dono ek hi commit me jaa rahe hain.
> Scanned: 2026-09-11 · Router count aaj: **215** → plan ke baad **220**

---

## 0. TL;DR

Teen contact keys — `email`, `mobile`, `whatsappNumber` — aur teen flags —
`isEmailVerified`, `isMobileVerified`, `isWhatsappVerified`. Aaj:

- WhatsApp verify **galat flag** set karta hai (`isMobileVerified`), aur `isWhatsappVerified` ko koi likhta hi nahi.
- Sirf `email` ke paas proper verify/change flow hai.
- Role collections me ye teen keys **sirf signup ke waqt** likhi jaati hain — aur **paanch jagah wahi purani value padhi jaati hai**, jinme se ek refund ka OTP bhejta hai.

Naya model, teen line me:

1. **`User` aur role collection hamesha barabar.** Kisi bhi taraf se likho, dono jagah jaayega.
2. **Flag sirf OTP se `true` hota hai.** Plain write karo to `false` ho jaayega. Koi bhi kare — vendor, admin, khud user — bina OTP ke verified nahi hoga.
3. **`whatsappNumber` ka plain write hai hi nahi** (ek audited admin exception chhod kar). Wo login identity hai.
4. **Unverified key se login nahi hota.** Teeno OTP login paths ab apna flag padhenge — to kisi doosre ka likha hua pata us account me ghusne ka raasta nahi banta.
5. **Unverified key par notification bhi nahi jaata.** Email tabhi jab `isEmailVerified`, WhatsApp tabhi jab `isWhatsappVerified` — preference on hone ke saath. Push aur in-app is niyam se bahar. (§6)

---

## 1. Aaj kya hai — code se mila hua

### 1.1 Teen keys, chaar collections

| Collection | `email` | `mobile` | `whatsappNumber` | Verified flags |
|---|:---:|:---:|:---:|---|
| [`models/User.js`](../models/User.js) | ✅ | ✅ | ✅ | teeno flags yahan |
| [`models/Customer.js`](../models/Customer.js) | ✅ | ✅ | ✅ | ❌ |
| [`models/Brand.js`](../models/Brand.js) | ✅ | ✅ | ✅ | ❌ |
| [`models/SubBrand.js`](../models/SubBrand.js) | ✅ | ✅ | ✅ | ❌ |

`User` par teeno keys pe **partial unique index** hai — `{ field, role }` par,
`isDeleted: false` filter ke saath ([`models/User.js:309-323`](../models/User.js#L309-L323)).
Role collections par in teeno me se **kisi par koi index nahi**.

### 1.2 🔴 Defect 1 — WhatsApp verify galat flag set karta hai

[`services/auth/verifyOtpWithWhatsapp.js:24`](../services/auth/verifyOtpWithWhatsapp.js#L24):

```js
user.isMobileVerified = true;      // ← WhatsApp verify hua, mobile nahi
```

Aur [`loginOrSignUpWithWhatsapp.js:232`](../services/auth/loginOrSignUpWithWhatsapp.js#L232)
usi flag par `isFirst` decide karta hai:

```js
isFirst: !user.isMobileVerified,
```

Nateeja: WhatsApp se signup kiya hua har customer/vendor DB me
`isMobileVerified: true` liye baitha hai — jabki uske `mobile` field me **kuch hai
hi nahi**. Flag ek aisi cheez ke baare me dava kar raha hai jo maujood nahi.

### 1.3 🆕 `isWhatsappVerified` abhi sirf schema me hai

Poore repo me sirf **ek** jagah: schema declaration
([`models/User.js:173`](../models/User.js#L173)). Koi likhta nahi, koi padhta nahi.

Ye purana bug nahi hai — ye field is working copy me **abhi joda gaya hai** aur abhi
commit nahi hua (`git diff server/models/User.js` — ek line, `+isWhatsappVerified`). Isi
ko wire karna Phase 1 ka kaam hai.

⚠️ Phase 1 ka commit is line ko **saath le kar** jaana chahiye — akela schema field jo
kuch nahi karta, wo agle developer ke liye wahi sawaal hai jo aaj hai.

### 1.4 🔴 Defect 3 — role collection kabhi sync nahi hoti, aur wahi padhi jaati hai

Signup ke waqt value dono jagah likhi jaati hai
([`loginOrSignUpWithWhatsapp.js:40-55`](../services/auth/loginOrSignUpWithWhatsapp.js#L40-L55),
[`signUpSubBrandWithWhatsapp.js:79-86`](../services/subBrands/signUpSubBrandWithWhatsapp.js#L79-L86)).
Uske baad **kabhi nahi**.

Ek adhoora sync hai — [`updateUserById.js:61-68`](../services/users/updateUserById.js#L61-L68) —
sirf `CUSTOMER` ke liye, sirf `fullName`/`dob`/`email`/`image`. `mobile` aur
`whatsappNumber` wahan bhi nahi. `VENDOR`/`SUB_VENDOR` ke liye kuch bhi nahi. Aur
email verify flow ([`emailVerification.js:175`](../services/auth/emailVerification.js#L175))
sirf `User.email` likhta hai.

**Ye cosmetic drift nahi hai — paanch jagah role collection ki value hi asli hai:**

| Jagah | Kya karta hai | Drift ka nateeja |
|---|---|---|
| [`sendBankOtp.js:18-26`](../services/customerBankAccounts/sendBankOtp.js#L18-L26) | Bank-account attach ka OTP **`Customer.whatsappNumber`** par | Number badla, `Customer` me purana → **refund ka OTP purane number par**. Jiske paas ab wo number hai, wo bank account attach kar sakta hai |
| [`notify.js:66-74`](../helpers/notifications/notify.js#L66-L74) | `customer?.email \|\| brand?.email \|\| user?.email` — role collection **pehle** | Har receipt, refund notice, settlement statement purane pate par |
| [`buildBillingDetails.js:131`](../helpers/subscribeds/buildBillingDetails.js#L131) | Invoice par `brand?.email` | Invoice par purana email |
| [`verifyVendor.js:241-244`](../services/systemVerify/verifyVendor.js#L241-L244) | Verification mail `brand.email` par | Vendor ko approval mail nahi milta |
| [`buildVoucherInvoiceSnapshot.js:206`](../helpers/voucherClaims/buildVoucherInvoiceSnapshot.js#L206) | `billTo.email \|\| customer.email` | Voucher invoice par purana email |

`sendBankOtp` wala **security issue hai**, cosmetic nahi.

### 1.5 🟠 Defect 4 — mobile OTP par koi throttle nahi

`CLAUDE.md` kehta hai *"Every OTP path goes through `services/otps/sendOtp.js`"* —
mobile nahi jaata:

```js
// services/otps/sendOtp.js:29
if (type !== LOGIN_TYPES.WHATSAPP && type !== LOGIN_TYPES.EMAIL) {
  throwError(401, "Invalid login type");
}
```

[`loginWithMobileOTP.js:13`](../services/auth/loginWithMobileOTP.js#L13) seedha
[`sendOtpToMobile`](../helpers/twoFactor/sendOtpToMobile.js) call karta hai → 2factor
`AUTOGEN`. Beech me **koi `claimOtpSend` nahi** — na 60s cooldown, na 5/hour cap.
`POST /auth/login-with-mobile` public hai, to kisi ke bhi number par jitne chaaho SMS
bhijwaye ja sakte hain, har ek ka paisa hamara. → §4.4 me band hoga.

### 1.6 🟠 Defect 5 — phone number normalise nahi hota

[`validator/common.js:25`](../validator/common.js#L25):

```js
isValidPhoneNumber: (phone) => /^(?:\+91|91)?[6-9]\d{9}$/.test(phone)
```

`9876543210`, `919876543210`, `+919876543210` — **teeno valid, teeno alag string**.
Unique index string par lagta hai, to ek hi insaan teen account bana sakta hai. Aur
sync ka compare bhi jhooth bolega jab dono ek hi number ke do format hain. → Phase 0.

### 1.7 Email flow — jo sahi hai, aur uska shape

[`services/auth/emailVerification.js`](../services/auth/emailVerification.js) hi wo
template hai jise baaki dono keys pe copy karna hai:

1. **Verify aur change ek hi do calls hain.**
2. **Code hamesha *claim ki ja rahi* value par jaata hai**, file par padi value par nahi.
3. `assertNotTaken` **do baar** — send pe aur verify pe.
4. Value likhna aur flag `true` karna **ek hi save me**.
5. Race ka asli guard **index** hai; code wala check politeness hai. `11000` → `409`.
6. `loginType` **nahi** chhua jaata — ye sign-in nahi hai.
7. Response me pata **masked** (`maskEmail`).
8. Throttle `sendOtp` ke andar, apne `purpose` bucket (`email-verify`) me.

---

## 2. Target model

### 2.1 Ownership — kaun si key, kaun sa flag

| Key | Flag | Kaun `true` karta hai |
|---|---|---|
| `whatsappNumber` | `isWhatsappVerified` | `POST /auth/verify-otp-whatsapp` (login) · `POST /auth/whatsapp/verify` 🆕 |
| `mobile` | `isMobileVerified` | `POST /auth/verify-otp-mobile` (login) · `POST /auth/mobile/verify` 🆕 |
| `email` | `isEmailVerified` | `POST /auth/verify-otp-email` (login) · `POST /auth/email/verify` ✅ |

### 2.2 Do-tarfa sync — ek hi niyam *(D1)*

> Teen keys `User` aur uske role profile par **hamesha barabar** rehti hain.
> Kisi bhi taraf se likho — dono jagah jaayegi.
> **Flag sirf OTP verify se `true` hota hai.** Baaki har write us key ka flag
> `false` kar dega. Koi bhi kare — khud user, vendor, ya admin.

| Write ka type | Kahan se | Value | Flag |
|---|---|---|---|
| **Verified write** | `/auth/<channel>/verify`, aur OTP login paths | dono jagah | **`true`** |
| **Plain write** | `PUT /users/update`, `PUT /brands/update`, `PUT /subBrands/update`, admin contact endpoint | dono jagah | **`false`** |
| **Create** | signup paths | dono jagah | `false` |

`ADMIN` → sirf `User`, koi mirror nahi.
`CUSTOMER` → `Customer` · `VENDOR` → `Brand` · `SUB_VENDOR` → `SubBrand`

### 2.3 🔑 Kaun kiski identity likh sakta hai *(D1)*

| Actor | Kiski identity likh sakta hai |
|---|---|
| **ADMIN** | **kisi ki bhi**, kisi bhi role ki |
| **VENDOR** | apni, aur **apne SUB_VENDOR ki** (add bhi, change bhi) |
| **SUB_VENDOR** | sirf apni |
| **CUSTOMER** | sirf apni |

⚠️ Vendor sirf **apne hi brand ke** outlets tak — `updateSubBrand` me ownership check
pehle se maujood hai ([`updateSubBrand.js:36-44`](../services/subBrands/updateSubBrand.js#L36-L44)),
usi ko identity write ka gate banaya jaayega. Koi doosra vendor kisi aur ke outlet ko
nahi chhoo sakta.

### 2.4 🔒 `whatsappNumber` ka plain write hai hi nahi *(D1)*

`email` aur `mobile` plain write se badal sakte hain (flag `false` ho jaayega).
**`whatsappNumber` nahi.** Wo teeno non-admin roles ka primary login identity hai, aur
uska raasta sirf OTP hai.

Iska matlab code me:

| Jagah | Aaj | Baad me |
|---|---|---|
| `PUT /users/update` | `whatsappNumber` leta hi nahi | waise hi — koi change nahi |
| `PUT /brands/update` | `whatsappNumber` leta hi nahi | waise hi |
| `PUT /subBrands/update` | `whatsappNumber` leta hi nahi | waise hi |
| `POST /auth/register` | `whatsappNumber` **required** hai | account banate waqt theek hai — `isWhatsappVerified: false` rahega |
| naya admin contact endpoint | — | **ek exception, §2.5** |

### 2.5 ⚠️ Ek takraav, aur uska hal — admin exception

Do jawab aapas me takra rahe the:

- **Q1:** *"whatsapp number me change/update me verified hi hona chahiye, without verified accept nahi hoga"*
- **Q3:** *"purana SIM kho jaye to abhi admin endpoint bana do"*

Agar admin endpoint bhi `whatsappNumber` nahi likh sakta, to wo us case ko hal hi nahi
karta jiske liye banaya ja raha hai — jiska SIM chala gaya wo hamesha ke liye bahar.

**Hal jo dono rakhta hai:** admin endpoint `whatsappNumber` ki **value** badal sakta hai,
par flag hamesha `false` par girega.

```
PATCH /users/admin/:userId/contact   { whatsappNumber, reason }
  → User.whatsappNumber = naya,  isWhatsappVerified = false
  → role collection me mirror
  → sessionInvalidatedAt = now              (purani sab sessions band)
  → reason + adminId + timestamp audit me
  → user ab naye number se loginOrSignUp-with-whatsapp karega
     → OTP naye number par → verify → isWhatsappVerified = true
```

To niyam bacha rehta hai: **kisi ka bhi `isWhatsappVerified` bina OTP ke `true` nahi
hota.** Sirf value badalne ka ek recorded, reason-wala admin raasta khulta hai — jo
support desk ko chahiye hi chahiye.

*→ confirm ho chuka, §12 ka row **A**.*

### 2.6 Aaj role-side se kaun si keys likhi ja sakti hain

| Endpoint | Gate | Fields | Service |
|---|---|---|---|
| `PUT /brands/update` | `isVendorOrAdmin` | `email`, `mobile` | [`updateBrand.js:40-41`](../services/brands/updateBrand.js#L40-L41) |
| `PUT /subBrands/update/:subBrandId` | `isVendorOrAdmin` | `email` | [`updateSubBrand.js:64`](../services/subBrands/updateSubBrand.js#L64) |

`Customer` ke liye koi aisa endpoint nahi — customer ka raasta `PUT /users/update` hai.
`whatsappNumber` kahin bhi role-side se editable nahi (aur rahega bhi nahi — §2.4).

---

## 3. Sync layer

### 3.1 Ek hi helper

```js
// helpers/users/roleProfiles.js
//   ROLE_PROFILES table — model, userField, lookup.
//   Aaj ye loginOrSignUpWithWhatsapp.js:36-56 ke andar band hai; wahan se
//   nikaalna hi hai, taaki create path aur sync path kabhi alag baat na kahein.

// helpers/users/applyIdentityChange.js
applyIdentityChange(user, { email?, mobile?, whatsappNumber? }, {
  verified: false,        // true sirf OTP flows se
  allowWhatsapp: false,   // true sirf verify flow aur admin contact endpoint se
  session,
}) → { changed: [...], profileSynced: Boolean }
```

1. Bheji hui keys normalise karta hai (phone → 10-digit, email → lowercase+trim).
2. `whatsappNumber` aaya aur `allowWhatsapp` nahi hai → `422` ("WhatsApp number sirf
   verify karke badla ja sakta hai").
3. Jo value sach me badli hai sirf usi ko chhoota hai.
4. Badli hui key ka flag set karta hai — `verified` ke hisaab se. Jo key nahi badli,
   uska flag nahi chhoota.
5. `user.save()` ke baad role profile par teeno values mirror.
6. `ADMIN` par step 5 no-op.
7. `11000` pakadta nahi — har caller ka `409` message alag hai.

### 3.2 Kahan-kahan call hoga

| # | Jagah | `verified` | `allowWhatsapp` |
|---|---|---|---|
| 1 | `emailVerification.js` → `verifyEmail` | `true` | — |
| 2 | naya `verifyMobile` | `true` | — |
| 3 | naya `verifyWhatsapp` | `true` | ✅ |
| 4 | [`verifyOtpWithWhatsapp.js`](../services/auth/verifyOtpWithWhatsapp.js) (login) | `true` | ✅ |
| 5 | [`verifyEmailOTP.js`](../services/auth/verifyEmailOTP.js) · [`verifyMobileOTP.js`](../services/auth/verifyMobileOTP.js) | `true` | — |
| 6 | [`updateUserById.js`](../services/users/updateUserById.js) | `false` | ❌ |
| 7 | [`updateBrand.js`](../services/brands/updateBrand.js) | `false` | ❌ |
| 8 | [`updateSubBrand.js`](../services/subBrands/updateSubBrand.js) | `false` | ❌ |
| 9 | naya admin contact endpoint | `false` | ✅ |
| 10 | [`repairRoleProfile`](../services/auth/loginOrSignUpWithWhatsapp.js#L165-L187) | mirror only | — |
| 11 | naya `scripts/syncRoleProfileIdentity.js` | mirror only | — |

⚠️ **`registerUser` list me nahi hai** — `POST /auth/register` sirf `User` banata hai,
koi role profile nahi.

### 3.3 Atomicity

`User` aur role profile ka save ek `session.withTransaction` me — wahi pattern jo
[`createUserWithProfile`](../services/auth/loginOrSignUpWithWhatsapp.js#L68-L153) aur
[`updateBrand`](../services/brands/updateBrand.js#L15-L76) pehle se use karte hain
(`updateBrand` to already transaction me hai, wahan sirf ek line jodni hai).

⚠️ **OTP transaction se pehle consume hota hai.** Transaction fail hua to code ja chuka
hoga aur naya maangna padega. Ulta karna matlab `deleteOtp` rollback ho sakta hai — aur
wo ek code ko dobara chalne ka darwaza khol dega.

### 3.4 Role-side write par ab uniqueness check bhi chahiye 🆕

Aaj `Brand.email` par koi unique index nahi, isliye `updateBrand` bina check ke likh
deta hai. Do-tarfa sync ke baad wahi write `User` par jaayega, jahan
`user_email_role_unique` hai. To `updateBrand` / `updateSubBrand` / admin endpoint me:

- pehle `assertNotTaken({ field, target, role })` → saaf `409`
- `11000` catch karke wahi `409` — index hi asli guard hai
- warna vendor ko *"validation failed"* jaisa `422` milega ek index ka naam leke

---

## 4. Verify / change flow — ek shape, teen channel

### 4.1 Channel registry

| | `email` | `mobile` | `whatsappNumber` |
|---|---|---|---|
| Flag | `isEmailVerified` | `isMobileVerified` | `isWhatsappVerified` |
| OTP purpose | `email-verify` ✅ | `mobile-verify` 🆕 | `whatsapp-verify` + `whatsapp-change-current` 🆕 |
| Transport | Nodemailer | 2factor AUTOGEN (`sessionId`) | WhatsApp template |
| OTP store | `Otp` collection | 2factor ke paas | `Otp` collection |
| Normalise | `trim().toLowerCase()` | 10-digit | 10-digit |
| Mask | `maskEmail` | `maskPhone` | `maskPhone` |
| Unique index | `user_email_role_unique` ✅ | `user_mobile_role_unique` ✅ | `user_whatsappNumber_role_unique` ✅ |
| Plain write | ✅ allowed | ✅ allowed | ❌ **sirf OTP** (+ admin exception) |
| Step-up | nahi | nahi | **haan** |
| Login-by-OTP ke liye flag chahiye | **haan** 🆕 | **haan** 🆕 | haan (waise bhi hamesha verified hi hota hai) |

Teeno unique index **pehle se maujood hain** — koi naya index nahi banana.

⚠️ Alag `purpose` sirf safai ke liye nahi: `hashOtp(code, target, purpose)` purpose ko
hash me ghol deta hai, to ek purpose ka code doosre me nahi chalega. Aur `Otp` par
`{ target, purpose }` unique hai — agar kisi ka `mobile` aur `whatsappNumber` ek hi
number hai (aam baat hai), to same purpose par dono ek doosre ka code mita denge.

### 4.2 Step 1 — `POST /auth/<channel>/send-verification`

```
body: { <field>?: string }        // omit = jo file par hai use confirm karo
gate: verifyJwtToken              // har role
```

1. `loadUser(actor.userId)` → 404
2. `target = normalise(payload.<field>) || current`
3. `target` khaali → `422`
4. `isChange = target !== current`
5. `!isChange && flag === true` → `409` "already verified"
6. `isChange` → `assertNotTaken` → `409`
7. OTP bhejo (WhatsApp me step-up ka pehla code purane number par — §4.5)
8. → `{ sentTo: masked, isChange }` *(mobile me `sessionId` bhi)*

### 4.3 Step 2 — `POST /auth/<channel>/verify`

```
body: { <field>?: string, otp: string }      // mobile me sessionId bhi
gate: verifyJwtToken
```

1–4 same
5. OTP verify — galat/expire/max-attempts par throw, success par consume
6. `isChange` → `assertNotTaken` **dobara** (do call ke beech minute lagte hain)
7. **Transaction:** `applyIdentityChange(user, { <field>: target }, { verified: true, session })`
8. `11000` → `409` "verify karte waqt kisi aur ne le liya"
9. `loginType` nahi chhua jaata — ye sign-in nahi hai
10. → `{ <field>, <flag>: true, wasChange }`

### 4.4 Mobile — `sessionId` rahega, throttle jud jaayega *(D5 + Q2 = haan)*

Transport waise hi: 2factor `AUTOGEN`, `sessionId` client ko jaata hai aur `verify` me
wapas aata hai. `Otp` collection aur `models/OTP.js` ka enum nahi chhua jaayega.

Throttle ke liye transport badalne ki zaroorat nahi — `claimOtpSend` OTP store se alag
cheez hai, wo sirf ek rolling window count karta hai:

```js
// helpers/twoFactor/sendThrottledMobileOtp.js
const claim = await claimOtpSend(mobile, purpose);      // 60s / 5-per-hour
if (!claim.allowed) throwError(429, ..., { retryAfterSeconds });
try   { return await sendOtpToMobile(mobile); }
catch (e) {
  await OtpThrottle.updateOne({ target: mobile, purpose }, { $pull: { sends: claim.at } });
  throw e;                                              // fail hua to slot wapas — value se, range se nahi
}
```

- ➕ Login aur verification, dono mobile paths throttled
- ➕ App ke liye **koi breaking change nahi** — `sessionId` waise ka waisa
- ➕ `Setting.security.otp` se hi tune hota rahega
- ➖ Codes 2factor ke paas hi rahenge, hamare `Otp` store me nahi — to attempts cap aur
  purpose-binding mobile par nahi milega (email/WhatsApp par hai). Ye jaan-boojh kar
  chhoda gaya hai, kyunki transport badalne ke liye DLT template chahiye.

### 4.5 `whatsappNumber` change — step-up *(D2)*

```
POST /auth/whatsapp/send-verification  { whatsappNumber: "<naya>" }
  → isChange && isWhatsappVerified  →  code PURANE number par  (whatsapp-change-current)
  → { step: "CONFIRM_CURRENT", sentTo: "******3210" }

POST /auth/whatsapp/verify   { whatsappNumber: "<naya>", otp: <purane wala> }
  → purana confirm  →  ab code NAYE number par  (whatsapp-verify)
  → { step: "CONFIRM_NEW", sentTo: "******7788" }

POST /auth/whatsapp/verify   { whatsappNumber: "<naya>", otp: <naye wala> }
  → applyIdentityChange(..., { verified: true, allowWhatsapp: true })
  → sessionInvalidatedAt = now        // baaki sab devices logout
```

- Pehla step **sirf tab** jab number badal raha ho *aur* purana verified ho. Naya number
  add karna (jo verified nahi tha) single-step rahega.
- `sessionInvalidatedAt` isliye ki agar change attacker ne kiya tha, to asli maalik ki
  purani session bhi nahi bachegi — aur wo apne purane number se dobara login kar sakega
  (change ke liye purane number ka OTP chahiye tha, jo uske paas hai).
- Purana number kho gaya → §2.5 ka admin endpoint.

`email` aur `mobile` par step-up nahi.

### 4.6 Phone normalise *(D7)*

`+91` / `91` prefix strip karke **10 digit** store hoga.

- `validator/common.js` me ek `normalisePhone()`, aur `isValidPhoneNumber`
  normalise-ke-baad validate karega
- Joi schemas me `.custom(normalisePhone)` — app jo bhi format bheje server ek hi format
  me badal dega, to **app ko kuch badalna nahi padega**
- `scripts/normalisePhoneNumbers.js` (dry-run default) chaaron collections theek karega
- ⚠️ Normalise ke baad do rows takra rahe hon (ek number, do format, ek role) to script
  unhe **report karegi, merge nahi karegi** — wo insaani faisla hai

### 4.7 🔑 Unverified key se login nahi hoga *(§12 ka row **B**)*

`whatsappNumber` ko isliye locked kiya gaya ki wo login key hai. Par `email` aur
`mobile` bhi login keys hain, aur ye dono apna flag **padhte hi nahi**:

```
POST /auth/login-with-email   { email, role }     ← koi bhi role
POST /auth/login-with-mobile  { mobile, role }
```

Iske bina D1a ki chhoot ek raasta khol deti: vendor apne outlet manager ka email apna
set karta, OTP apne inbox me paata, aur us account me login kar leta. Isliye:

```js
// loginWithEmailOTP.js aur loginWithMobileOTP.js, user mil jaane ke turant baad
if (!user.isEmailVerified) {
  throwError(403, "Is email address ko pehle verify karna hoga. " +
                  "Apne account me sign in karke email verify kijiye.",
             { code: "IDENTITY_NOT_VERIFIED" });
}
```

⚠️ **Ye kisi ko bahar nahi karta, aur wajah dekhne layak hai.**

`verifyEmailOTP` aur `verifyMobileOTP` **pehle se** har kaamyaab OTP login par apna flag
`true` kar dete hain ([`verifyEmailOTP.js:24`](../services/auth/verifyEmailOTP.js#L24),
[`verifyMobileOTP.js:20`](../services/auth/verifyMobileOTP.js#L20)). To jis kisi ne bhi
kabhi email/mobile OTP se login kiya hai, uska flag **already `true` hai** — gate uske
liye kuch badalta hi nahi. Gate sirf un rows ko rokta hai jinhone us key se kabhi login
kiya hi nahi — yaani theek wahi rows jo kisi *doosre* ne likhi ho sakti hain.

Aur har account ke paas ek doosra darwaza hai:

| Role | Doosra raasta |
|---|---|
| CUSTOMER · VENDOR · SUB_VENDOR | WhatsApp OTP — signup wahi se hota hai |
| ADMIN | Password — `POST /auth/register` `password` **required** karta hai ([`validator/auth.js`](../validator/auth.js)), aur `whatsappNumber` bhi |

To locked-out ka koi case nahi banta. Ek hi asar bachta hai: jis customer ne
`PUT /users/update` se email daala aur verify nahi kiya, wo us email se login nahi kar
payega — use ek baar `/auth/email/verify` chalana hoga. Aur wahi to point hai.

---

## 5. Har scenario, end to end

### 5.1 Naya signup (WhatsApp) — CUSTOMER / VENDOR

```
POST /auth/loginOrSignUp-with-whatsapp
  → User + Customer/Brand ek transaction me, dono par whatsappNumber   ✅ pehle se
  → isFirst: !user.isWhatsappVerified                                  🔄

POST /auth/verify-otp-whatsapp
  → isWhatsappVerified = true                                          🔄 (aaj isMobileVerified)
  → isMobileVerified ko haath nahi lagta                               🔄
  → mirror sync (drift repair)                                         🆕
```

### 5.2 Email / mobile add ya change — khud user

```
POST /auth/<channel>/send-verification  { email | mobile }   → code us pate/number par
POST /auth/<channel>/verify             { ..., otp }
  → User + flag true + role collection                                 🆕
```

Ya plain raasta:

```
PUT /users/update  { email: "naya@x.com" }
  → User.email = naya, isEmailVerified = false, role collection bhi    🆕
  → phir /auth/email/verify se flag true
```

### 5.3 Vendor apne outlet ka email set karta hai

```
PUT /subBrands/update/:id  { email: "outlet@cafe.in" }
  → ownership check: ye outlet isi vendor ka hai?                      (pehle se hai)
  → assertNotTaken({ email, role: SUB_VENDOR })                        🆕
  → SubBrand.email + User(SUB_VENDOR).email                            🆕
  → isEmailVerified = false
  → outlet manager khud verify karega tabhi true
```

### 5.4 Admin kisi ka bhi contact badalta hai

```
PATCH /users/admin/:userId/contact  { email? mobile? whatsappNumber? reason }
  → assertNotTaken har bheji hui key par                               🆕
  → User + role collection                                             🆕
  → jo key badli uska flag false
  → whatsappNumber badla to sessionInvalidatedAt = now
  → reason + adminId audit me
```

### 5.5 WhatsApp number change — §4.5 ka teen-step flow

### 5.6 Login — teeno

| Endpoint | Aaj | Baad me |
|---|---|---|
| `login-with-email` | koi flag check nahi | `isEmailVerified` `false` → **`403`** (§4.7) |
| `login-with-mobile` | koi flag check nahi | `isMobileVerified` `false` → **`403`** (§4.7) + throttle |
| `verify-otp-whatsapp` | `isMobileVerified = true` | `isWhatsappVerified = true` + mirror |
| `verify-otp-email` | `isEmailVerified = true` | wahi + mirror |
| `verify-otp-mobile` | `isMobileVerified = true` | wahi + mirror |

### 5.7 ADMIN account khud

Koi role collection nahi — mirror step no-op. Teeno verify flow admin ke liye waise hi
chalte hain (gate `verifyJwtToken`, role gate nahi).

---

## 6. Notification guard — unverified par kuch nahi jaata

### 6.1 Niyam

> **Email sirf unko jaayega jinka `isEmailVerified: true` hai.**
> **WhatsApp sirf unko jinka `isWhatsappVerified: true` hai.**
> Preference `on` hona **aur** key verified hona — dono chahiye. Ek bhi kam, to us
> channel par kuch nahi jaata. Push aur in-app is niyam se bahar hain.

Aur: **jab kisi key ka verified flag `false` hota hai, us channel ka preference bhi
`false` ho jaata hai.** To email badal kar verify na karo → email notifications
apne aap band. Wapas chaalu karne ke liye **verify + toggle on**, dono.

### 6.2 Aaj notification layer kaisa hai

Do switch pehle se hain, aur dono ek hi jagah jurte hain —
[`helpers/notifications/channelPreferences.js`](../helpers/notifications/channelPreferences.js):

| Switch | Kiska | Matlab |
|---|---|---|
| `Setting.<audience>.…isEmailNotificationEnabled` | platform ka | operational kill switch — SMTP down, Meta template approve nahi |
| `User.notificationPreferences.email` | insaan ka | "mujhe email mat bhejo" |

`isChannelAllowed()` hi wo ek jagah hai jo dono ko jodti hai, aur us file ka apna
comment kehta hai *"which is why this is the only place that combines them"*.
**Verification teesra switch hai, usi kism ka — to wo bhi wahi jaayega.**

Delivery ke do raaste hain, aur dono cover hone chahiye:

| Raasta | Kya bhejta hai | Guard chahiye? |
|---|---|---|
| [`notify.js`](../helpers/notifications/notify.js) | email · push · whatsapp | ✅ email + whatsapp |
| [`notifyAudience.js`](../helpers/notifications/notifyAudience.js) | **sirf push** | ❌ push par verification ka koi matlab nahi |

### 6.3 🔴 Aapka `email: false` wala change abhi kaam nahi kar raha

`git diff server/constants/notification.js` — aapne `NOTIFICATION_PREFERENCE_DEFAULTS`
me `email: true` → `email: false` kiya hai. Par
[`channelPreferences.js`](../helpers/notifications/channelPreferences.js) us table ki
**values padhta hi nahi** — sirf uske **keys** ka istemaal karta hai:

```js
for (const channel of Object.keys(NOTIFICATION_PREFERENCE_DEFAULTS)) {
  resolved[channel] = prefs?.[channel] !== false;   // ← default table yahan aata hi nahi
}
```

`!== false` ka matlab hai "absent = ON", har channel ke liye, hamesha. To:

| Kaun | `email` ka nateeja aaj |
|---|---|
| Purana user (field hi nahi hai) | **`true`** — aapka change bekaar gaya |
| Naya user (schema se `default: NOTIFICATION_PREFERENCE_DEFAULTS.email` mila) | `false` — aapka change laga |

Yani abhi aadha lagta hai, aadha nahi — aur dono me se kaun sa milega, ye is baat par
nirbhar hai ki account kab bana tha. **Ye theek hona chahiye:**

```js
resolved[channel] = prefs?.[channel] ?? NOTIFICATION_PREFERENCE_DEFAULTS[channel];
```

Ab har channel apna khud ka default maanega — `email` ka `false`, `push` aur
`whatsapp` ka `true`. Us file ka bada ⚠️ *"absent means ON"* wala comment `push` aur
`whatsapp` ke liye **waise hi sach rahega**; sirf `email` ke liye jaan-boojh kar ulta
hoga, aur uski wajah wahi likhni hogi.

⚠️ **Iska asar aaj lagbhag zero hai, aur ye achhi baat hai.** Purane users ka `email`
`true` se `false` ho jaayega — par §6.1 ka guard unhe waise bhi rok deta, kyunki unme
se kisi ka email verified nahi hai. Do badlaav ek hi natije par pahunchte hain, aur
isliye ek saath hi jaane chahiye.

### 6.4 Guard kahan baithega

`isChannelAllowed()` me, **teesre switch ki tarah**:

```js
isChannelAllowed({
  channel,
  preferences,
  platformEnabled,
  type,
  verified,          // 🆕 { email: Boolean, whatsapp: Boolean }
})
```

Faisle ka order — aur ye order jaan-boojh kar hai:

```
1. platform off?        → blockedBy: "PLATFORM"       (kabhi override nahi hota)
2. verified nahi?       → blockedBy: "UNVERIFIED"     🆕 (kabhi override nahi hota)
3. ALWAYS_DELIVER type? → allowed, forced: true
4. preference off?      → blockedBy: "PREFERENCE"
5. warna                → allowed
```

⚠️ **Verification `ALWAYS_DELIVER_TYPES` se bhi upar hai (step 2, step 3 nahi).**

Ye list — `BRAND_DEACTIVATED`, `REFUND_BANK_DETAILS_REQUESTED`, `REFUND_FAILED`,
`SETTLEMENT_LEDGER_DRIFT` — insaan ki *marzi* ko override karti hai, kyunki un notices
me chuppi ka nuksaan paise ya access ka hota hai. Par unverified *marzi nahi hai* — wo
ye kehta hai ki **hume pata hi nahi ki wo pata is insaan ka hai**. Us pate par
`REFUND_FAILED` bhejna matlab kisi ajnabi ke inbox me ek asli customer ka refund
detail. Marzi ko override karna theek hai; pehchan ko nahi.

### 6.5 Guard ko data kahan se milega

`notify.js` ka `resolveRecipient` **pehle se** `User` padhta hai —
`notificationPreferences` ke liye. Us hi `select` me do field aur jud jaayenge:

```js
.select("email name mobile whatsappNumber notificationPreferences " +
        "isEmailVerified isWhatsappVerified")        // 🆕 do field, zero extra query
```

Yahi wo wajah hai jo `models/User.js` ke comment me pehle se likhi hai —
*"reading these costs no extra query on any path, which is precisely why they live on
`User`"*. Verified flags us hi read par saath aa jaate hain.

### 6.6 ✅ Flags sirf `User` par — aapka faisla sahi hai

Aapne poochha tha ki kya ise role collection me bhi rakhna better hoga. **Nahi.** Chaar
wajah:

1. **Query free hai.** `notify` waise bhi `User` padhta hai (§6.5). Role collection par
   rakhne se ek aur read, ya ek aur projection, har notification par.
2. **ADMIN ke paas role collection hai hi nahi.** Flag `User` par to rakhna hi padega —
   doosra ghar banane ka matlab hai do code path, aur ek din wo alag baat kahenge.
3. **Chaar copies ka matlab hai chaar sach.** Aaj ke teen keys ka drift (§1.4) exactly
   yahi hai. Ek aur cheez mirror karne ka matlab hai ek aur cheez jiska drift ho sakta
   hai — aur ye wo cheez hai jispe delivery ka faisla tika hai.
4. **Uniqueness aur identity ke saare faisle `User` par hote hain.** Flag usi ke saath
   rehna chahiye jiske baare me wo bol raha hai.

Value mirror hoti hai (kya), flag nahi (verified hai ya nahi). **Ek cheez ki do copy,
uske baare me ek hi sach.**

### 6.7 ⚠️ Ek dependency — guard `notify` ke fallback chain par tika hai

`resolveRecipient` aaj pata aise chunta hai
([`notify.js:66-74`](../helpers/notifications/notify.js#L66-L74)):

```js
email: customer?.email || brand?.email || user?.email
```

Yani mail **role collection ke** pate par ja sakta hai, jabki flag **`User`** ka padha
jaayega. Drift hui to guard jhoot bol dega — verified `User` ka, aur mail kisi aur pate
par.

Phase 2 ke baad dono barabar hain, to problem nahi. Par chain ka bacha rehna matlab
guard ki sahi-galat ek aisi cheez par tiki hai jise koi bhi future change tod sakta hai.
**Raay: mirror aane ke baad chain hata do, seedha `user.email` padho** — tab guard aur
recipient ek hi document se aate hain aur unka alag hona namumkin ho jaata hai. `phone`
ke liye bhi wahi. **Tay ho chuka — Phase 7 me chain hategi** (§12 ka row **H**).

### 6.8 Toggle on karne par kya hoga

Aapne kaha: unverified par toggle on karne ki koshish me error aaye. **Dono cheezein
honi chahiye**, ek dusre ki jagah nahi:

**(1) API refuse karega** — `PUT /notifications/preferences` par `{ email: true }` jab
`isEmailVerified: false`:

```jsonc
{
  "success": false,
  "message": "Email par updates paane ke liye pehle apna email verify kijiye.",
  "details": { "code": "IDENTITY_NOT_VERIFIED", "channel": "email" }
}
```

`422`. Aur `whatsapp: true` par bhi wahi, `channel: "whatsapp"` ke saath.

**(2) Read API pehle hi bata dega** — `describeChannelPreferences` ab
`blockedBy: "UNVERIFIED"` lautaayega, to app toggle ko **greyed out** dikha sakta hai
aur neeche "verify karein" ka link laga sakta hai. Sirf error par chhodne ka matlab hai
ki customer tap karega tabhi pata chalega — jo ek roka hua switch dikhane se bura hai.

`describeChannelPreferences` ka shape pehle se `{ preference, effective, blockedBy }` hai
aur WhatsApp platform-wide off hone ki wajah se `blockedBy` aaj bhi bharta hai. Ek naya
`blockedBy` value jodna hai, naya shape nahi.

⚠️ **Off karne par koi rok nahi.** Verified na hone par bhi koi apna toggle `false`
kar sakta hai — mana karna hamesha allowed hai, sirf haan kehna gated hai.

⚠️ **Admin doosre ki preference on karne jaaye to bhi wahi `422`**, message me us
user ka naam. Admin ka kaam kisi ki marzi badalna hai, uski pehchan ki zamanat dena
nahi — aur admin wale raaste ko chhoot dena matlab guard ke aas-paas ek raasta.

### 6.9 Flag girne par preference bhi girega

Aapne kaha *"jab tak vo verify karke phir se toggle on na kar de"* — to sirf guard
kaafi nahi. Guard akela hota to preference DB me `true` pada rehta aur verify karte hi
email **apne aap** chalu ho jaata, bina unke toggle chhue.

To `applyIdentityChange` (§3.1) me ek line aur:

```js
// jab kisi key ka verified flag false ho raha hai, us channel ka preference bhi
if (changedKeys.includes("email")    && !verified) next.email    = false;
if (changedKeys.includes("whatsappNumber") && !verified) next.whatsapp = false;
```

Ek hi niyam teeno write types par, aur wo §2.2 ki table me pehle se baitha hai:

| Write | `isEmailVerified` | `notificationPreferences.email` |
|---|---|---|
| `/auth/email/verify` | `true` | **chhua nahi jaata** — toggle insaan ka faisla hai |
| `PUT /users/update` se email badla | `false` | **`false`** |
| Vendor/admin ne likha | `false` | **`false`** |
| Admin ne whatsappNumber badla (§2.5) | `isWhatsappVerified: false` | `whatsapp: false` |

⚠️ Verify par preference **`true` nahi** kiya jaata. Verify karna *"mai is pate ka
maalik hoon"* hai, *"mujhe yahan mail bhejo"* nahi. Wo doosra faisla toggle ka hai —
aur aapne bhi yahi kaha: *"verify karke **phir** setting se toggle on karega"*.

### 6.10 🔴 Ek khatra — admin ke money alerts chup ho sakte hain

`SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED`, `SHADOW_INDEX` — ye admin ke paas jaate hain
aur `ALWAYS_DELIVER_TYPES` me isliye hain ki inki chuppi ka nuksaan paise ka hota hai.
`CLAUDE.md` ka poora ek section isi baare me hai: *"A settlement fails by **not
happening**"*.

Ab guard ALWAYS_DELIVER se bhi upar hai (§6.4). To agar kisi admin ka
`isEmailVerified: false` **aur** `isWhatsappVerified: false` hai, to uske paas sirf
in-app aur push bachte hain — aur money alert ke liye wo kaafi nahi.

Kitna asli hai ye khatra: `verifyEmailOTP` har kaamyaab email-OTP login par flag `true`
kar deta hai, to jis admin ne kabhi email se login kiya hai wo pehle se theek hai.

⚠️ **Aur WhatsApp isse nahi bachata.**
`ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled` **`false`** hai
([`constants/notification.js:334`](../constants/notification.js#L334)) — admin audience ke
liye WhatsApp platform-level par band hai, aur platform switch step 1 par hai jise kuch
override nahi karta. To `isWhatsappVerified: true` ho jaane ke baad bhi admin ka **ekmatra
asli outbound channel email hai**.

📊 **Asli ginti (§8.1): dono admins ka `isEmailVerified: false` hai.** Yaani aaj, is DB
par, Phase 7 lagte hi dono ke money alerts in-app + push tak simat jaayenge. Ye anumaan
nahi hai.

**Raay — teeno karo, teeno saste hain:**

1. `scripts/backfillIdentityFlags.js` ki report me ek section: *"ye admins hain jinke
   paas koi verified channel nahi — inke money alerts sirf in-app jaayenge."*
2. Boot par ek check (`assertMoneyIndexes` ke paas, jahan aise check pehle se hain), jo
   aisa koi admin mile to ek CRITICAL admin notice bhej de.
3. Doc me likha ho ki launch se pehle har admin apna email ek baar verify kare.

**Tay ho chuka — teeno honge** (§12 ka row **I**).

---

## 7. Endpoints

### 7.1 Naye — 5

| Method | Path | Gate | Doc + Collection |
|---|---|---|---|
| POST | `/auth/mobile/send-verification` | `verifyJwtToken` | teeno |
| POST | `/auth/mobile/verify` | `verifyJwtToken` | teeno |
| POST | `/auth/whatsapp/send-verification` | `verifyJwtToken` | teeno |
| POST | `/auth/whatsapp/verify` | `verifyJwtToken` | teeno |
| PATCH | `/users/admin/:userId/contact` | `isAdmin` | admin doc + admin collection |

Router count **215 → 220**.

⚠️ Email verification aaj `postman/lib/accountFolders.js` se **teeno** collections me
jaata hai; pehle chaar wahi raasta lenge. Paanchwa `isAdmin` par hai to sirf admin me —
"three-docs-three-collections" ke table ke hisaab se.

### 7.2 Badle hue

| Endpoint | Kya badlega |
|---|---|
| `POST /auth/verify-otp-whatsapp` | `isWhatsappVerified` set, `isMobileVerified` nahi. 🆕 `loginType = WHATSAPP` bhi (§8.1.1) |
| `POST /auth/loginOrSignUp-with-whatsapp` | `isFirst` ab `!isWhatsappVerified` |
| `POST /auth/login-with-email` | `403 IDENTITY_NOT_VERIFIED` jab flag `false` ho |
| `POST /auth/login-with-mobile` | wahi `403`, aur `429` bhi — `sessionId` waise ka waisa |
| `PUT /users/update` | `email` ab role collection me bhi |
| `PUT /brands/update` · `PUT /subBrands/update` | `email`/`mobile` ab `User` par bhi; `409` naya |
| `GET /customers/admin/get-all` | 🆕 naya filter + projection `isWhatsappVerified` — §7.3 |
| `GET /customers/admin/:customerId` · `GET /brands/admin/get-all` | 🆕 projection me `isWhatsappVerified` |
| `PUT /notifications/preferences` · admin wala | `{ email: true }` par `422` jab verified na ho |
| `GET /notifications/preferences` · admin wala | `blockedBy` me naya value `"UNVERIFIED"` |

### 7.3 ⚠️ Admin panel ka "verified" filter chup-chaap bekaar ho jaayega

[`getAllAdminCustomers.js:184-198`](../services/customers/getAllAdminCustomers.js#L184-L198)
me `isMobileVerified` aur `isEmailVerified` par filter hai, aur
[`:146-147`](../services/customers/getAllAdminCustomers.js#L146-L147) me dono project
hote hain. `getAdminCustomerDetail.js:102-103` aur `getAllAdminBrands.js:175` bhi.

Aaj admin panel me *"mobile verified"* ka matlab practically *"verified hai ya nahi"* hai,
kyunki har WhatsApp user par wo flag `true` hai. Flag theek hone ke baad **wahi filter 0
customer laayega** — kyunki kisi customer ke paas `mobile` hai hi nahi.

✅ **Measured:** filter `404 "No any customer found"` deta hai, khaali list nahi —
`pagination()` har khaali result par aisa hi karta hai. To ye chup-chaap **nahi** hai, jo
maine pehle likha tha wo galat tha. Par admin ke liye jawab phir bhi galat hai: use lagega
ki koi customer verified hai hi nahi, jabki 15 hain.

**To in chaaron jagah `isWhatsappVerified` jodna Phase 1 ka hissa hai**, alag kaam nahi:
`validator/customers.js` me `booleanFlag("isWhatsappVerified")`, listing me filter +
projection, detail me projection, brand listing me projection. Saath me admin doc aur
admin collection ka filter example.

---

## 8. Migration / backfill

`CLAUDE.md`: production **fresh DB** se shuru hoga, to ye scripts dev aur
`Trydood2_postman` ke liye hain — par unke bina Postman capture aur dev testing jhooti
value dekhenge. Sab **dry-run default, `--apply` se likhenge**.

### 8.1 📊 `Trydood2` (dev) me aaj kya hai — asli ginti

2026-09-11 ko padha gaya, read-only:

```
total (isDeleted:false)   62
isMobileVerified: true    55
isEmailVerified:  true     0      ← kisi ka bhi nahi
isWhatsappVerified: true   0      ← field abhi nayi hai

isMobileVerified:true ka breakdown
  VENDOR      · WHATSAPP · mobile nahi · whatsapp haan  → 23
  SUB_VENDOR  · WHATSAPP · mobile nahi · whatsapp haan  → 15
  CUSTOMER    · WHATSAPP · mobile nahi · whatsapp haan  → 15
  ADMIN       · MOBILE   · mobile haan · whatsapp haan  →  2   ← ye alag hain

whatsappNumber ka format
  10-digit → 62   (sab pehle se sahi)
```

### 8.1.1 ⚠️ `loginType: MOBILE` ka matlab wo nahi hai jo lagta hai

Pehli nazar me lagta hai ki wo 2 admin *"mobile se login karte hain, WhatsApp se nahi"*.
Ye galat padhna hai, aur do cheezein iski wajah hain:

**1. ADMIN WhatsApp se login **kar sakta hai**, aur karta hai.**
[`validator/auth.js:154-160`](../validator/auth.js#L154-L160) aur
[`:178-184`](../validator/auth.js#L178-L184) me `role` ka enum
`Joi.valid(...Object.values(ROLES))` hai — ADMIN shaamil.
[`loginOrSignUpWithWhatsapp.js:29`](../services/auth/loginOrSignUpWithWhatsapp.js#L29)
sirf **banane** par rok lagata hai, login par nahi, aur uska apna comment kehta hai:
*"Both may still **log in** here — they simply cannot be created here."*

**2. WhatsApp login `loginType` ko chhoota hi nahi.**
`verifyMobileOTP` `MOBILE` likhta hai, `verifyEmailOTP` `EMAIL` likhta hai,
`registerUser` `PASSWORD` — par
[`verifyOtpWithWhatsapp.js`](../services/auth/verifyOtpWithWhatsapp.js) me `loginType`
hai hi nahi. To WhatsApp se sau baar login karne par bhi wo purani value par atka rehta hai.

Matlab `loginType: MOBILE` sirf itna kehta hai ki *"kabhi mobile OTP use hua tha"* — ye
**nahi** kehta ki WhatsApp use nahi hua. DB se ye jaana ja hi nahi sakta, kyunki dono
raaste ek hi flag likhte the. Yahi to wo gadbad hai jo ye plan theek kar raha hai.

🆕 **Phase 1 me `verifyOtpWithWhatsapp` bhi `loginType = WHATSAPP` likhega.** Ek line,
aur surakshit: `loginType` sirf admin listing me filter/projection ki tarah padha jaata
hai ([`getAllAdminCustomers.js:209`](../services/customers/getAllAdminCustomers.js#L209)),
uspe koi behaviour branch nahi karta. Iske bina admin panel har WhatsApp user ka
"login type" galat dikhata rahega.

### 8.1.2 Isse kya tay hota hai

1. **Phase 0 ka script is DB par kuch nahi badlega** — saare 62 number pehle se 10-digit.
   Validator ka normalise phir bhi chahiye, kyunki wo **aage** aane wale input ke liye hai;
   script sirf saabit karti hai ki aaj drift nahi hai.
2. **Backfill ka rule §8.2 me hai** — 55 ko `isWhatsappVerified: true`, par
   `isMobileVerified` sirf un 53 se hatega jinke paas `mobile` hai hi nahi.
3. **§6.10 ka khatra asli hai, aur WhatsApp usse nahi bachata.**
   `ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled` **`false`** hai
   ([`constants/notification.js:334`](../constants/notification.js#L334)) — admin audience
   ke liye WhatsApp platform-level par band hai, aur platform switch kabhi override nahi
   hota (§6.4 step 1). To backfill ke baad admins ka `isWhatsappVerified: true` ho jaane
   par bhi unka **ekmatra asli outbound channel email hai** — aur dono ka email unverified
   hai. Phase 7 ke baad unke `SETTLEMENT_LEDGER_DRIFT` / `REFUND_FAILED` alerts sirf
   in-app + push rah jaayenge.

⚠️ Login se koi bahar nahi hota: dono admins ka `isMobileVerified: true` bana rahega
(`login-with-mobile` chalega), WhatsApp login chalega, aur password to hai hi.

### 8.2 Scripts

**`scripts/normalisePhoneNumbers.js`** — Phase 0
1. Chaaron collections ke teeno phone fields → 10-digit
2. Normalise ke baad takraane wale `{number, role}` **report**, chhuo mat

**`scripts/backfillIdentityFlags.js`** — Phase 1

Bilkul wahi jo aapne kaha — *"jinka purani wiring me `isMobileVerified: true` hai unka
`isWhatsappVerified: true` kar do"* — **saare 55 par**. Kyunki §8.1.1 ke baad saaf hai ki
ADMIN bhi WhatsApp se login karta hai, to unpe bhi ye flag sach hai.

Do alag step, aur dusra step pehle se zyada tang hai:

```js
// step 1 — 55 rows. Sabne WhatsApp se login kiya hai.
{ isMobileVerified: true, whatsappNumber: { $type: "string" }, isDeleted: false }
  → $set: { isWhatsappVerified: true }

// step 2 — sirf wo 53 jinke paas mobile hai hi nahi
{ isWhatsappVerified: true, isMobileVerified: true,
  mobile: { $in: [null, ""] }, isDeleted: false }
  → $set: { isMobileVerified: false }
```

⚠️ **Step 2 alag kyun hai.** `isMobileVerified` un 53 par ek khaali field ke baare me
dawa kar raha hai — unke paas `mobile` hai hi nahi. Wahi galti hai jo §1.2 me theek ho
rahi hai, bas doosri shakl me. Par wo **2 admins jinke paas `mobile` hai aur
`loginType: MOBILE` hai**, unhone sach me mobile OTP diya tha — unka `isMobileVerified`
rehne dena hi sahi hai. Unpe dono flag `true` honge, aur dono sach honge.

⚠️ **`isEmailVerified` ko backfill haath nahi lagayega.** Aaj 0 hai aur 0 hi rahega —
bina OTP ke koi verified nahi hota, aur migration us niyam ka apwaad nahi banegi.

**Report me ek section aur** (§6.10): *"ye admins hain jinke paas koi verified channel
nahi — inke money alerts sirf in-app jaayenge."* Aaj wo dono admins hain.

**`scripts/syncRoleProfileIdentity.js`** — Phase 2
1. Har non-admin User ka role profile, teen keys compare
2. `--apply` par `User` ki value mirror par
3. Profile na mile to alag list — wo `cleanupOrphans.js` ka kaam hai

---

## 9. App ke liye breaking changes

*(Q4 = seedha sahi karo, koi dual-flag transition nahi)*

| # | Kya | Asar |
|---|---|---|
| 1 | `isMobileVerified` WhatsApp users ke liye `true` → `false` | App use nahi karta — confirm ho chuka |
| 2 | `isFirst` ab `!isWhatsappVerified` | Backfill ke baad value **wahi**. Backfill ke bina har purana WhatsApp user ek baar `isFirst: true` dekhega |
| 3 | `isWhatsappVerified` ab sach bolega | Aaj hamesha `false`; ab `true` |
| 4 | 5 naye endpoints | Additive |
| 5 | `POST /auth/login-with-mobile` ab `429` de sakta hai | Wahi handling jo WhatsApp/email par pehle se hai (`retryAfterSeconds` `details` me) |
| 6 | `PUT /brands/update` ab `409` de sakta hai | Email/mobile kisi aur ke paas ho to |
| 7 | WhatsApp change ke baad sab devices logout | App `401` par sign-out pehle se karta hai |
| 8 | `login-with-email` / `login-with-mobile` ab `403 IDENTITY_NOT_VERIFIED` de sakte hain | ⚠️ Sirf un accounts par jinhone us key se **kabhi login kiya hi nahi** — kyunki dono verify paths pehle se hi har kaamyaab login par flag `true` kar dete hain. App ko is `403` par "pehle verify karein" screen dikhani hogi, `details.code` se branch karke |
| 9 | Email notifications lagbhag sabke liye band ho jaayenge | 🔴 **Sabse bada asar.** Aaj kisi ka email verified nahi hai, to §6 ka guard laagu hote hi har email ruk jaayega — jab tak log verify na karein. In-app, push aur WhatsApp par koi farq nahi. Ye jaan-boojh kar hai, par launch se pehle iska matlab samajh lena zaroori hai |
| 10 | `notificationPreferences.email` ka default ab `false` | Purane users (jinka field hi nahi hai) bhi ab `false` padhenge. Asar zero, kyunki guard unhe waise bhi rokta — §6.3 |
| 11 | Preferences read me naya `blockedBy: "UNVERIFIED"` | App toggle ko greyed out dikha sakta hai. Shape nahi badla, sirf ek naya value |
| 12 | `PUT /notifications/preferences` `{ email: true }` par `422` de sakta hai | Jab email verified na ho — `details.code: IDENTITY_NOT_VERIFIED` |
| 13 | Admin panel ka `isMobileVerified` filter 0 result dega | 🔴 **Chup-chaap.** Koi error nahi, bas khaali list. Admin panel ko `isWhatsappVerified` par shift hona hoga — §7.3 |

**Nahi toota:** JWT me `email`/`mobile`/`whatsappNumber` purane pade rehne se kuch nahi
bigadta — [`middlewares/authenticate.js:76-82`](../middlewares/authenticate.js#L76-L82)
token se sirf `id` aur `iat` leta hai aur user ko DB se dobara padhta hai. Identity
badalne par purana token apne aap sahi value par aa jaata hai.

**Nahi badla:** `verify-otp-mobile` ka `sessionId`, app ka bheja hua phone format,
`PUT /users/update` ka email field, WhatsApp login (uska flag hamesha verify se hi aata hai).

---

## 10. Docs / Postman / tests checklist

- [ ] `docs/endpoints_category.md` — 5 nayi rows + **chaaron total** (header, `## Summary — N`, `**TOTAL**` row, doc-build-status) 215 → 220, aur module row ka arithmetic
- [ ] `docs/customer_mobile_api_doc.md` · `vendor_panel_api_doc.md` · `super_admin_panel_api_doc.md`
- [ ] `postman/lib/accountFolders.js` (chaar) + admin generator (ek)
- [ ] Sirf **badle hue** generator chalao, phir `git diff --stat postman/` — deletions > insertions ho to **ruk jao**
- [ ] Re-seed → server → `capture-examples` → `verifyApiCoverage.js`
- [ ] `scripts/seedPostmanFixtures.js` ka clear step naye rows cover kare

### 10.1 🔴 Postman capture Phase 3 par toot jaayega — seed theek karna hi padega

`seedPostmanFixtures.js` me **koi verified flag set hi nahi hota** (grep: zero matches).
To seeded har user `isEmailVerified: false`, `isMobileVerified: false` ke saath banta hai.

Vendor collection me **4 `login-with-email` aur 4 `login-with-mobile`** requests hain.
Phase 3 ka gate (§4.7) lagte hi wo aathon **`403`** denge, aur capture run us folder par
gir jaayega.

Aur Phase 7 ke baad seeded users ka email verified na hone se koi notification example
capture hi nahi hoga.

**To seed me ye chahiye:**

| Seeded user | Kya set ho |
|---|---|
| Sab (WhatsApp signup wale) | `isWhatsappVerified: true` |
| Vendor jiska email/mobile login collection me hai | `isEmailVerified: true`, `isMobileVerified: true` |
| Admin | `isEmailVerified: true` — warna `login-with-email` `403`, aur §6.10 ka alert bhi seed me hi dikhega |
| Notification example wale users | `isEmailVerified: true` + `notificationPreferences.email: true` |

⚠️ Ye seed ka "shortcut" nahi hai. Seed **wahi haalat** banata hai jo ek asli user OTP
verify karke pahunchta — aur wahi haalat collection ko chahiye. Seed me flag set karna
production code me test-only branch daalne jaisa **nahi** hai; wo fixture data hai.

**Tests** — `__tests__/money/` hi ek tested folder hai, shart *"cannot be verified by
clicking"*. Ye kaam us shart par khara utarta hai:

- [ ] `identitySync.test.js` — dono taraf se write; teeno keys barabar; `ADMIN` no-op; plain write par flag `false`, verify par `true`
- [ ] `identityPermissions.test.js` — vendor apne outlet ka likh sakta hai, **doosre vendor ke outlet ka nahi**; sub-vendor/customer sirf apna; `whatsappNumber` ka plain write har jagah `422`; admin endpoint chalta hai
- [ ] `identityIndex.test.js` — do concurrent verify ek hi email par → ek jeeta, doosre ko `409`, do rows nahi bane
- [ ] `contactVerification.test.js` — code purane pate par nahi jaata; doosre purpose ka code nahi chalta; consume hua code dobara nahi; WhatsApp step-up ka pehla step skip nahi hota
- [ ] `identityLoginGate.test.js` — unverified email/mobile se OTP login `403`; wahi key verify hone ke baad chalti hai; **poora takeover scenario end-to-end** (vendor outlet manager ka email likhe → login refuse ho); admin password login gate se prabhavit nahi hota
- [ ] `notificationVerificationGuard.test.js` — unverified email par kuch nahi jaata **chahe preference `true` ho**; **`ALWAYS_DELIVER` notice bhi nahi jaata** (§6.4 ka order); verify karne ke baad + toggle on karne ke baad jaata hai; verify akela kaafi nahi; WhatsApp par wahi; push aur in-app **har haal me** chalte hain; email badalne par preference `false` ho jaata hai
- [ ] `notificationPreferences.test.js` me badlaav — *"an absent preference means on"* wala block ab per-channel hai: `push`/`whatsapp` ke liye `on`, `email` ke liye `off` (§6.3). Ye test aaj ulta assert karta hai, to iska badalna hi proof hai ki default table sach me padhi ja rahi hai
- [ ] `otpThrottle.test.js` me mobile channel

⚠️ Har layer alag-alag hata kar test ko fail hote dekhna hai, khaaskar index wala — code
ka guard hatane par test aksar paas hi reh jaata hai.

---

## 11. Phasing

| Phase | Kya |
|---|---|
| **0** | Phone normalise + `normalisePhoneNumbers.js` — sync se pehle, warna sync khud drift banayega |
| **1** | Flags ki wiring (`isWhatsappVerified`, `isFirst`) + admin panel ke chaar filter/projection (§7.3) + `backfillIdentityFlags.js` |
| **2** | `applyIdentityChange` + permission matrix + saari 11 call sites + `syncRoleProfileIdentity.js` — **`sendBankOtp` wala hole yahan band hota hai** |
| **3** | Login gate (§4.7) — do file, do `if`. Phase 2 ke saath hi jaana chahiye: Phase 2 non-owner ko likhne ki chhoot deta hai, aur gate hi wo chhoot ko login se alag rakhta hai. ⚠️ **Isi phase me `seedPostmanFixtures.js` bhi** — warna capture run 8 requests par `403` deta hai (§10.1) |
| **4** | Mobile throttle + `mobile` verify/change flow |
| **5** | `whatsappNumber` verify/change + step-up + session kill |
| **6** | Admin contact endpoint (§2.5) |
| **7** | **Notification guard (§6)** — default table theek karo, `isChannelAllowed` me teesra switch, `notify` ka projection, toggle-on `422`, `blockedBy: UNVERIFIED`, preference reset. Sabse aakhir kyunki guard verified flags (Phase 1) aur mirror (Phase 2) dono par tika hai, aur uska asar sabse chaudha hai |
| **8** | Docs + Postman + capture + coverage verify |

Har phase apna alag commit.

⚠️ **Phase 7 me aapka `constants/notification.js` wala uncommitted change bhi jaayega** —
akela wo aadha kaam karta hai (§6.3), guard ke saath poora. Dono ek hi commit me.

---

## 12. Decisions — tay ho chuke

| | Sawaal | Jawab |
|---|---|---|
| **D1** | Role collection strict mirror? | **Do-tarfa sync.** Kahin se bhi likho, dono jagah jaayega; flag `false`; OTP se hi `true`. → §2.2 |
| **D1a** | Kaun kiski identity likh sakta hai? | Admin sabki · vendor apni + apne sub-vendor ki · baaki sirf apni. → §2.3 |
| **D1b** | `whatsappNumber` plain write? | **Nahi** — sirf OTP. Ek audited admin exception. → §2.4, §2.5 |
| **D2** | `whatsappNumber` change par step-up? | **Haan** + change ke baad sab devices logout. → §4.5 |
| **D5** | Mobile OTP transport? | **Jo aaj hai wahi** — 2factor AUTOGEN + `sessionId`. → §4.4 |
| **D7** | Phone format? | **10 digit**, `91`/`+91` strip. Server normalise karega. → §4.6 |
| **D8** | `PUT /users/update` se email hataayein? | **Nahi** — plain write raasta khula, flag `false`. → §5.2 |
| **Q2** | Mobile throttle? | **Haan** — `sessionId` shape nahi badlega. → §4.4 |
| **Q3** | Lost SIM? | **Admin endpoint abhi banao.** → §2.5 |
| **Q4** | App `isMobileVerified` padhta hai? | **Nahi** — seedha sahi kar do, koi transition release nahi. → §9 |
| **D4** | Role profile na mile to? | **Warn, fail nahi** |
| **A** | Admin `whatsappNumber` ki value badal sake, flag `false` par gire? | **Haan** — value badalne ka ek recorded raasta, flag phir bhi sirf OTP se. → §2.5 |
| **B** | Unverified `email`/`mobile` se OTP login? | **Nahi** — dono login paths ab apna flag padhenge (`403 IDENTITY_NOT_VERIFIED`). → §4.7 |
| **C** | Notification email/WhatsApp par verification guard? | **Haan** — preference on **aur** key verified, dono chahiye. → §6.1 |
| **D** | Verified flags role collection me bhi? | **Nahi, sirf `User` par** — aapka faisla sahi hai, wajah §6.6 me |
| **E** | Flag girne par preference bhi gire? | **Haan** — warna verify karte hi email apne aap chalu ho jaata, bina toggle chhue. → §6.9 |
| **F** | `NOTIFICATION_PREFERENCE_DEFAULTS` ki values sach me padhi jaayein? | **Haan** — `?? DEFAULTS[channel]`, na ki `!== false`. `email` ka default `false`, `push`/`whatsapp` ka `true`, teeno ek jagah se. → §6.3 |
| **G** | Guard `ALWAYS_DELIVER_TYPES` se upar? | **Haan** — wo list *marzi* override karti hai, *pehchan* nahi. → §6.4 |
| **H** | `notify` ka email/phone fallback chain? | **Phase 7 me hategi** — seedha `user.email` / `user.whatsappNumber`, taaki guard aur recipient ek hi document se aayein. → §6.7 |
| **I** | Admin ke money alerts chup na ho jaayein? | **Teeno** — backfill report, boot par CRITICAL notice, launch checklist. → §6.10 |
| **J** | Backfill ka exact rule? | **55 par `isWhatsappVerified: true`** (ADMIN bhi WhatsApp se login karta hai — §8.1.1), par `isMobileVerified` sirf un **53** se hatega jinke paas `mobile` hai hi nahi. → §8.2 |
| **K** | `verifyOtpWithWhatsapp` `loginType` likhe? | **Haan, `WHATSAPP`** — aaj WhatsApp login use chhoota hi nahi, to admin panel har WhatsApp user ka login type galat dikhata hai. Ek line, surakshit. → §8.1.1 |
| **L** | Admin panel ke verified filters? | **`isWhatsappVerified` jodna Phase 1 ka hissa hai** — warna filter chup-chaap 0 result dega. → §7.3 |

---

## 13. Ye plan kya-kya theek kar raha hai

Shuru ye "teen keys sync karo" tha. Raaste me jo mila, wo bhi isi me band ho raha hai:

| | Kya | Kahan |
|---|---|---|
| 🔴 | Refund/bank-attach ka OTP purane number par jaata tha, kyunki `Customer.whatsappNumber` kabhi update hi nahi hota tha | §1.4 → Phase 2 |
| 🔴 | Ek insaan doosre ki login identity likh kar us account me ghus sakta tha | §4.7 → Phase 3 |
| 🔴 | `isMobileVerified` un accounts par `true` tha jinka `mobile` khaali hai | §1.2 → Phase 1 |
| 🔴 | `isWhatsappVerified` kabhi kisi ne likha hi nahi | §1.3 → Phase 1 |
| 🟠 | `login-with-mobile` par koi OTP throttle nahi — kisi ke bhi number par unlimited SMS | §1.5 → Phase 4 |
| 🟠 | Ek hi number teen format me teen account bana sakta tha | §1.6 → Phase 0 |
| 🟠 | Invoice, approval mail aur har notification purane email par ja sakte the | §1.4 → Phase 2 |
| 🟠 | `mobile` aur `whatsappNumber` badalne ka koi verified raasta hi nahi tha | §4 → Phase 4, 5 |
| 🟠 | SIM kho jaane par account hamesha ke liye band | §2.5 → Phase 6 |
| 🟠 | Email un pato par jaata tha jo kabhi verify hue hi nahi — aur email badalne par notifications apne aap band nahi hote the | §6 → Phase 7 |
| 🟠 | `NOTIFICATION_PREFERENCE_DEFAULTS` ki values koi padhta hi nahi tha — default badalna aadha hi lagta tha | §6.3 → Phase 7 |
| 🟠 | WhatsApp login `loginType` likhta hi nahi tha — admin panel har WhatsApp user ka login type galat dikhata tha | §8.1.1 → Phase 1 |
| 🟠 | Admin panel ka "verified" filter flag theek hote hi chup-chaap 0 result deta | §7.3 → Phase 1 |
| 🟠 | Postman seed me koi verified flag nahi tha — login gate lagte hi 8 requests `403` deti | §10.1 → Phase 3 |

**Ek baat jo jaan-boojh kar accept ki gayi hai:** D1a ke hisaab se vendor apne
SUB_VENDOR ki identity likh sakta hai. §4.7 ka gate use us account me *login* karne se
rokta hai, par vendor phir bhi apne outlet manager ka email/mobile badal sakta hai (flag
`false` ho jaayega). Ye jaan-boojh kar hai — outlet account vendor hi banata hai aur wo
uska staff account hai.

---

## 14. Ab kya

Plan poora hai aur **saare decisions tay hain** (§12 — 14 rows, koi khula sawaal nahi).

Agla kadam **Phase 0** hai — phone normalise, kyunki uske bina baaki har cheez drift par
bani hogi.

Har phase ke baad: kya badla, test kya bole — report karke rukna hai. Commit tabhi jab
aap kahein.

---

## Appendix — chhue jaane wale files

**Naye**
`helpers/users/roleProfiles.js` · `helpers/users/applyIdentityChange.js` ·
`helpers/users/canWriteIdentity.js` · `helpers/twoFactor/sendThrottledMobileOtp.js` ·
`services/auth/mobileVerification.js` · `services/auth/whatsappVerification.js` ·
`services/users/adminUpdateContact.js` ·
`controllers/auth/contactVerification.js` · `controllers/users/adminUpdateContact.js` ·
`scripts/normalisePhoneNumbers.js` · `scripts/backfillIdentityFlags.js` ·
`scripts/syncRoleProfileIdentity.js` ·
`__tests__/money/identitySync.test.js` · `identityPermissions.test.js` ·
`identityIndex.test.js` · `contactVerification.test.js` · `identityLoginGate.test.js`

**Badle jaane wale**
`services/customers/getAllAdminCustomers.js` · `services/customers/getAdminCustomerDetail.js` ·
`services/brands/getAllAdminBrands.js` · `validator/customers.js` *(§7.3)* ·
`scripts/seedPostmanFixtures.js` *(§10.1)* ·
`services/auth/verifyOtpWithWhatsapp.js` · `loginOrSignUpWithWhatsapp.js` ·
`verifyEmailOTP.js` · `verifyMobileOTP.js` · `loginWithMobileOTP.js` ·
`loginWithEmailOTP.js` · `emailVerification.js` ·
`services/users/updateUserById.js` · `services/brands/updateBrand.js` ·
`services/subBrands/updateSubBrand.js` · `constants/otp.js` · `validator/common.js` ·
`validator/auth.js` · `validator/users.js` · `validator/brands.js` ·
`validator/subBrands.js` · `routes/auth.js` · `routes/users.js` ·
`services/auth/index.js` · `controllers/auth/index.js` · `controllers/users/index.js` ·
`postman/lib/accountFolders.js` · `postman/generate-admin-collection.js` · 4 docs

**Phase 7 (notification guard) me**
`constants/notification.js` *(aapka uncommitted change isi ke saath)* ·
`helpers/notifications/channelPreferences.js` · `helpers/notifications/notify.js` ·
`services/notifications/notificationPreferences.js` · `validator/notifications.js` ·
`docs/notification_preferences.md` ·
`helpers/notifications/assertReachableAdmins.js` *(naya — §6.10 ka boot check)* ·
`index.js` *(us check ko boot par lagana, `assertMoneyIndexes` ke paas)* ·
`__tests__/money/notificationPreferences.test.js` *(assertions badlengi)* ·
`__tests__/money/notificationVerificationGuard.test.js` *(naya)*
