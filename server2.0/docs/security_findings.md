# Security & Correctness Findings — server2.0

**Last verified:** 2026-08-26 against current code (143 endpoints, 25 route files)
**Scope:** Ye dedicated security audit nahi hai — API documentation scan ka by-product hai.

> Jo findings fix ho chuke hain wo is doc se hata diye gaye hain. Kya-kya fix hua uska record → [security_fix_plan.md](./security_fix_plan.md)

**Open:** 3 findings — 1 deferred by decision, 2 design pending

---

## Status board

| # | Finding | Severity | Status |
|---|---|---|---|
| 7 | WhatsApp OTP verify hota hi nahi — auth bypass | 🔴 High | ⏸ **DEFERRED** — aapka decision, patch ready |
| 3 | `/brands/get` PAN/GST/Bank customer ko expose karta hai | 🟠 Medium | 🔵 **IN PROGRESS** — alag customer API ban rahi hai |
| 5 | `DELETE /users/delete` no-op stub | 🟡 Low | 🔵 **IN PROGRESS** — cascade plan ban raha hai |

---

## 7. ⏸ DEFERRED — WhatsApp OTP verify hota hi nahi (auth bypass)

**Files:** [services/auth/verifyOtpWithWhatsapp.js](../services/auth/verifyOtpWithWhatsapp.js) · [services/auth/loginOrSignUpWithWhatsapp.js](../services/auth/loginOrSignUpWithWhatsapp.js)

Dono OTP lines abhi bhi commented hain:

```js
// loginOrSignUpWithWhatsapp.js
//  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
```
```js
// verifyOtpWithWhatsapp.js
//  await verifyOtp(whatsappNumber, otp);
```

Kisi ka WhatsApp number pata hona hi kaafi hai — do calls me uska JWT:

```bash
POST /auth/loginOrSignUp-with-whatsapp   { "whatsappNumber": "9876543210", "role": "CUSTOMER" }
POST /auth/verify-otp-whatsapp           { "whatsappNumber": "9876543210", "otp": "000000", "role": "CUSTOMER" }
→ 200 { "data": { "token": "eyJ..." } }
```

**Ab pehle se kam exploitable hai** — naya ADMIN ab WhatsApp se ban hi nahi sakta, aur `/auth/register` `isAdmin` ke peeche hai. To ye ab **existing accounts** ka takeover hai, admin-escalation nahi. Phir bhi High hai.

**Note:** Email/Mobile OTP flows me verification **intact** hai. `services/otps/verifyOtp.js` ka logic bhi sahi hai (hash compare, max attempts, expiry) — bas WhatsApp path se call nahi hota.

**Ready-to-apply patch** — dono jagah:
```js
if (process.env.SKIP_OTP !== "true") {
  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);   // loginOrSignUp
}
if (process.env.SKIP_OTP !== "true") {
  await verifyOtp(whatsappNumber, otp);                  // verifyOtp
}
```

⚠️ Uncomment karte hi TENDIGIT provider live ho jayega — `helpers/otps/tendigit.js` fail hone pe `503 "Please try in some time! OTP service unavailable"` throw karta hai. Credentials theek na hue to **saare WhatsApp logins band**. `SKIP_OTP=true` sirf dev `.env` me rakhna, production deploy checklist me isko explicitly check karna.

---

## 3. 🔵 IN PROGRESS — `/brands/get` PAN/GST/Bank details expose karta hai

**File:** [services/brands/getBrand.js](../services/brands/getBrand.js)

Aggregation 14 lookups karta hai:

`users` · **`pans`** · **`gsts`** · **`banks`** · `locations` · `systemverifies` · `subscribeds` · `categories` · `subcategories` · `workhours` · `subbrands` (+ nested `users`, `locations`, `workhours`)

Customer app ko brand profile page ke liye yahi endpoint chahiye, aur usme brand ka **PAN number, GST number, bank account + IFSC** chala jaata hai. Subscription/billing data bhi.

`users` lookup me `password`, `otp`, `refreshToken` properly excluded hain — bas PAN/GST/Bank pe wo protection nahi.

**Decision:** alag customer endpoint banega (`GET /brands/customer/...`) jisme sirf public fields honge, plus brand features aur showcase. Design abhi discuss ho raha hai — merge karne se performance/scalability pe kya asar padega wo evaluate ho raha hai.

---

## 5. 🔵 IN PROGRESS — `DELETE /users/delete` no-op stub

**File:** [routes/users.js](../routes/users.js)

```js
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```

Kuch delete nahi hota — na soft, na hard. Controller/service exist hi nahi karta.

**Impact:**
- **App store compliance risk** — Play Store / App Store account deletion mandatory karte hain
- Customer "Delete Account" dabayega, success dikhega, account zinda rahega
- Response format bhi different hai — `sendSuccess` envelope nahi, raw `res.json` (koi `success` field nahi)

**Decision:** Customer + Vendor dono ke liye proper cascade design ban raha hai — kya delete hoga, kya anonymise hoga, kya legal/financial reasons se retain hoga.

---

## 🔭 Pending suggestions — password flow enhancements

Password sign-in ab admin-only hai. Uske upar ye add kiya ja sakta hai (koi bhi implement nahi hua):

### E1. Rate limiting — **sabse zaruri, abhi bilkul nahi hai**
`/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, aur saare OTP verify endpoints pe.

OTP khud verify **attempts** cap karta hai, par **kitne OTP maange ja sakte hain uspe koi limit nahi** — ek number pe hazaar OTP request bheje ja sakte hain. Provider ka paisa jaata hai aur victim ko spam hota hai.

Suggestion: `express-rate-limit`, IP + identifier dono pe alag-alag buckets.

### E2. Failed-login lockout
5 galat password → 15 min lockout. `User` pe `failedLoginAttempts` + `lockedUntil` fields.

### E3. Password change pe saare sessions invalidate
JWT stateless hai — password badalne pe purane tokens chalte rehte hain. `User.tokenVersion` field + JWT me claim, aur `verifyJwtToken` me compare.

### E4. Password reset pe notification
"Aapka password badla gaya, aapne nahi kiya to contact karein" — email/push. Notification layer already maujood hai (`NOTIFICATION_TYPES` me naya type add karna hoga).

---

## 🔭 Pending suggestions — baaki

| Kya | Kyun |
|---|---|
| **CORS lock down** | `index.js` me `cors()` bilkul open hai — koi origin allowlist nahi |
| **JWT expiry policy** | `JWT_EXPIRY` env se aata hai, par koi refresh-token flow nahi. Lamba expiry = lamba exposure window |
| **File upload MIME validation** | Showcase/banner uploads extension aur declared MIME pe bharosa karte hain; actual file signature check nahi hota |
| **`Subscribed.isActive` / `isExpired` redundancy** | `status` authoritative hai, par ye flags saath-saath maintain hote hain. Abhi bug nahi hai (dono ek saath likhe jaate hain), par do jagah truth rakhne se drift ka risk hai. Naya code `status` pe check kare |
| **`brand.isApproved` / `brand.status` kabhi likhe nahi jaate** | Dono fields model me hain par koi code inko set nahi karta — hamesha `false` / `PENDING`. Approval ka actual status `SystemVerify` doc me hai. Customer listing ka `isVerified` isliye hamesha `false` aata hai |

---

## ✅ Positives — jo already sahi hai

Record ke liye, taaki naye code me ye patterns follow hote rahein:

**Auth & access**
- `resolveActorBrand` cached token trust nahi karta — brand ka apna `userId` verify karta hai, to stale token se cross-brand access nahi hota
- `resolveSectionForActor` bhi wahi pattern showcase pe follow karta hai
- Enumeration-safe forgot-password — account ho ya na ho, same response
- OTP purpose scoping — `"auth"` aur `"password-reset"` alag, to login OTP password reset ke liye replay nahi ho sakta
- Password login fail-closed hai — jinhone password set nahi kiya, unpe login path fail hota hai
- JWT error handling proper — expired / malformed / notBefore alag messages
- `deviceTokens` self-scoped — `unregister` ka filter hamesha `userId` carry karta hai, `test` push sirf caller ke apne devices pe

**Payments**
- Razorpay webhook HMAC `crypto.timingSafeEqual` se compare hota hai; secret / signature / raw body teeno missing pe explicit fail
- Raw body sirf webhook route ke liye capture hota hai, baaki app unaffected
- Webhook replay idempotent — settlement transaction conditionally claim hota hai
- Invoice amounts kabhi recompute nahi hote — transaction pe frozen pricing se banta hai
- Checkout se `amount` field hata di gayi thi (pehle `amount || price` tha — koi bhi plan ₹1 me)

**Data integrity**
- Transactions correctly use hote hain (`session.withTransaction`)
- File upload rollback — voucher/banner create fail pe media cleanup
- Entitlement slots atomic conditional increment se reserve hote hain, aur fail pe release
- Subscription expiry live-checked hai (`status === ACTIVE && endDate > now`) + self-healing read + background job — teeno layers
- Joi `stripUnknown: true` — mass-assignment se bachav
- Soft delete pattern consistent, har query me `isDeleted: false`
- `escapeRegex` search me — regex injection se bachav
- Error handler centralized

**Operational**
- Job runner defensive — throw log hoke swallow hota hai (interval kill na ho), overlapping runs skip, boot pe catch-up run, `timer.unref()`, `ENABLE_JOBS=false` kill switch
- Broadcast ka `all: true` explicit likhna padta hai, plus `dryRun` se audience size pehle check ho sakta hai
- `DEFAULT_ENTITLEMENTS` stingy hai — plan samajh na aaye to kuch mat do, paid feature leak mat karo
