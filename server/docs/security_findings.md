# Security & Correctness Findings — server2.0

**Last verified:** 2026-09-13 against current code (223 endpoints — 220 versioned + 3 utility)
**Scope:** Ye dedicated security audit nahi hai — API documentation scan ka by-product hai.

> Jo findings fix ho chuke hain wo is doc se hata diye gaye hain. Kya-kya fix hua uska record → [security_fix_plan.md](./security_fix_plan.md)

**Open:** 2 findings — dono aapke decision pe deferred hain

---

## Status board

| # | Finding | Severity | Status |
|---|---|---|---|
| 7 | WhatsApp OTP verify hota hi nahi — auth bypass | 🔴 High | ⏸ **DEFERRED** — aapka decision, patch ready |
| 5 | `DELETE /users/delete` no-op stub | 🟡 Low | ⏸ **DEFERRED** — plan ready, full flow ke baad |

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

## 5. ⏸ DEFERRED — `DELETE /users/delete` no-op stub

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

**Decision:** Aapne kaha ki ye tab karenge jab **poora flow ready** ho jayega. Cascade design likha hua hai — kya delete hoga, kya anonymise hoga, kya legal/financial reasons se retain hoga, aur 7 open questions — sab [account_deletion_plan.md](./account_deletion_plan.md) me hai. Wahan se uthakar implement kar sakte hain.

---

## 🔭 Pending suggestions — password flow enhancements

Password sign-in ab admin-only hai. Uske upar ye add kiya ja sakta hai (koi bhi implement nahi hua):

### E1. Rate limiting — **global lag chuka hai; per-identifier bucket nahi hai**

> ⚠️ Ye finding pehle "abhi bilkul nahi hai" kehti thi. **Wo ab sach nahi.**
> [index.js:119-124](../index.js#L119) me ek global limiter hai — 15 minute ka
> window, `RATE_LIMIT_MAX` se limit, aur Razorpay webhooks jaan-boojh kar exempt
> (429 kha kar wo retry ke baad chup-chaap drop ho jaate, aur akela lakshan hota
> "paisa ruk gaya").

Jo **abhi bhi** bacha hai: limiter **IP par** hai, identifier par nahi.

- Ek hi IP se hazaar OTP request ab cap ho jaati hain ✅
- Par **rotating IP / distributed** se ek hi number par flood abhi bhi possible hai — provider ka paisa jaata hai aur victim ko spam hota hai
- Aur ulta bhi: ek office ya mobile carrier NAT ke peeche baithe **saare asli users ek hi budget** share karte hain

OTP khud verify **attempts** cap karta hai; kitne OTP *maange* ja sakte hain — wo ab IP par capped hai, phone number par nahi.

Suggestion: `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` aur OTP send endpoints par ek **doosra** limiter, jiska key `whatsappNumber` / `email` ho — global IP wale ke upar, uski jagah nahi.

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
| **`Subscribed.isActive` / `isExpired` redundancy** | `status` authoritative hai, par ye flags saath-saath maintain hote hain ([models/Subscribed.js:24](../models/Subscribed.js#L24) khud "legacy booleans … still written" kehta hai). Abhi bug nahi hai, par do jagah truth rakhne se drift ka risk hai. Naya code `status` pe check kare |

> ✅ **Ek suggestion yahan se hata di gayi:** "`brand.isApproved` / `brand.status`
> kabhi likhe nahi jaate". Wo ab sach nahi —
> [reviewBrandVerification.js:220-222](../services/systemVerify/reviewBrandVerification.js#L220)
> ka `brandSet` dono likhta hai (APPROVED / REJECTED / REVOKED), aur
> [verifyVendor.js:355](../services/systemVerify/verifyVendor.js#L355) `UNDER_REVIEW`
> set karta hai. Voucher listing ka `isApproved` padhna ab galat nahi hai.

---

## ✅ Positives — jo already sahi hai

Record ke liye, taaki naye code me ye patterns follow hote rahein:

**Auth & access**
- `resolveActorBrand` cached token trust nahi karta — brand ka apna `userId` verify karta hai, to stale token se cross-brand access nahi hota
- `resolveSectionForActor` bhi wahi pattern showcase pe follow karta hai
- `resolveLocationTarget` wahi pattern addresses pe — aur usme **kind** bhi resolve hota hai, to ek customer doosre customer ka ghar ka pata edit nahi kar sakta. Teenon helper milakar **28 services** me chal rahe hain
- Enumeration-safe forgot-password — account ho ya na ho, same response
- OTP purpose scoping — `"auth"` aur `"password-reset"` alag, to login OTP password reset ke liye replay nahi ho sakta
- Password login fail-closed hai — jinhone password set nahi kiya, unpe login path fail hota hai
- JWT error handling proper — expired / malformed / notBefore alag messages
- `deviceTokens` self-scoped — `unregister` ka filter hamesha `userId` carry karta hai, `test` push sirf caller ke apne devices pe
- Customer brand endpoints **alag** banaye gaye, `/brands/get` ko role-filter karke nahi. Wo pipeline 14 lookups karti hai jisme PAN/GST/bank/billing hai — usme se 6 joins strip karne wala projection ek edit door hai leak se. Naye endpoints sensitive join **build hi nahi karte**, to strip karne layak kuch bacha hi nahi

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
