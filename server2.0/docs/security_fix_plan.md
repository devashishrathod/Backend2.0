# Security Fix — Changelog

**Round:** 2026-08-26
**Open findings** → [security_findings.md](./security_findings.md)

Ye record hai ki kya-kya badla aur **kyun**, taaki baad me koi code padhe to design ka reason mile. Har item verify ho chuka hai — do suites scratch DB pe (real Atlas replica set, real transactions): **34/34** aur **27/27** pass. `Trydood2` ko chhua nahi gaya.

---

## Decisions jo code ki shape decide karti hain

| Decision | Kyun |
|---|---|
| Existing ADMIN WhatsApp se **login** kar sakta hai, par naya ADMIN **ban nahi sakta** | Validator me `ADMIN` allowed rehta hai (login ke liye); service me `SELF_SIGNUP_ROLES` guard naya account rokta hai |
| Password sign-in **sirf ADMIN** ke liye | Customer/vendor WhatsApp OTP se aate hain — unpe password ek extra credential hota jise churaya ja sake, aur kuch nahi |
| `isFirst` ka matlab = "OTP verify nahi hua", "User doc naya hai" nahi | Warna OTP na aane pe retry karte hi `false` ho jaata tha |
| Showcase CRUD admin ke liye bhi | `validateBrandVendor` token se brand resolve karta tha, to admin kabhi use kar hi nahi sakta tha |
| Password hash strip **per-service** | `sanitizeUser()` — schema-level `select: false` se saare password reads audit karne padte |
| Pehla admin **CLI se** | `/auth/register` ab gated hai, to `scripts/seedAdmin.js` bootstrap path hai |

---

## Kya badla

### Shared foundation
- `isVendorOrAdmin` aur `isSubVendor` ab `middlewares/validateRoles.js` se export hote hain. Pehle `isVendorOrAdmin` **5 route files me alag-alag define** hota tha — ek jagah badalne pe baaki drift kar sakte the.

### Auth
- **Naya ADMIN / SUB_VENDOR WhatsApp se nahi ban sakta** — `SELF_SIGNUP_ROLES = [CUSTOMER, VENDOR]`. Pehle `{ whatsappNumber, role: "ADMIN" }` se koi bhi admin ban sakta tha.
- **`/auth/register` ab `isAdmin` ke peeche**, aur `role` **required** hai (pehle default `ADMIN` tha).
- **Password flow ADMIN-only** — `set-password` pe `isAdmin`; `login` / `forgot-password` / `reset-password` ke validator me `role` sirf `ADMIN`. Service me bhi guard, taaki message actionable ho.
- **`isFirst` fix** + naya `isProfileComplete` field.
- **Signup ab atomic hai** — `User` + `Brand`/`Customer` ek `withTransaction` me. Pehle `Brand.create` fail hone pe User bina `brandId` ke reh jaata tha, aur agli login `isFirst: false` deti thi — matlab wo vendor **permanently** onboard nahi ho paata.
- **Purane toote accounts self-heal hote hain** — `repairRoleProfile` pehle orphan `Brand`/`Customer` dhoondhta hai (agar link fail hua tha), warna naya banata hai. Idempotent.
- **Duplicate-key ab clean `409`** — `uniqueId`/`referralCode`/`merchantId` read-then-write se generate hote hain, to concurrent signup pe clash ho sakta hai.
- **Password hash response se strip** — `helpers/users/sanitizeUser.js`.
- **`scripts/seedAdmin.js`** — dry-run default, `--apply` chahiye.

### Access control — 143/143 routes gated

| Gate | Routes |
|---|---:|
| `isAdmin` | 49 |
| `isVendorOrAdmin` | 39 |
| `verifyJwtToken` *(sab roles ke reads)* | 25 |
| `isVendor` *(onboarding + KYC)* | 11 |
| `isCustomer` | 9 |
| Public *(9 auth entry points + Razorpay webhook)* | 10 |

Pehle 35 endpoints bilkul ungated the — customer ke token se app ke banners create/delete ho sakte the, kisi bhi brand ka showcase edit ho sakta tha, `locations/getAll` se platform ke saare addresses mil jaate the.

### Ownership (role gate ke upar)
- **`resolveSectionForActor`** — showcase ke 9 services ab ownership verify karte hain. Pehle wo `userId` lete the aur **use hi nahi karte the**, to koi bhi vendor kisi ka bhi gallery edit/delete kar sakta tha.
- **`showcase/section/get-all` ab brand-scoped** — vendor apne brand tak pinned, admin global (bina `brandId` ke sab, `brandId` ke saath narrow). `{brandId:1, isActive:1}` index already tha, to ye pehle se **tez** bhi hai.
- **`locations/get/:id`** — per-role ownership. Vendor apne brand + apne outlets tak.
- **Verification history** — service me har role explicitly named. Pehle `else` branch me admin *aur* customer dono aa jaate the.

### IDOR
- **`?userId` param hata diya** `/users/get` aur `/users/update` se. Token sirf fallback tha — query usse override kar deta tha.
- **`locations/upsert` ab token-only** — naya `validateUpsertLocation` (bina `userId`, bina brand flags). Pehle role check *target* user pe hota tha, caller pe nahi.

### Correctness
- **Legal create ab kaam karta hai** — `type` field validator aur service dono me missing tha, to `POST /terms-and-conditions/create` aur `/privacy-and-policies/create` **har baar** `422 "Path \`type\` is required."` dete the.
- **Legal update ke do bugs** — `isActive` **toggle** karta tha (`isActive: true` bhejne pe already-active document band ho jaata tha), aur title change pe crash (`result.findOne is not a function` — document pe model ka method call ho raha tha).
- **`description` cap 300 → 50000** aur ab lowercase nahi hota — legal text ka case aur markup preserve rehta hai.
- **`FIXED` discount ab calculate hota hai** — `FLAT` ka alias. Pehle `discountAmount: 0` deta tha aur eligible list se filter ho jaata tha, customer ko misleading *"No eligible offer found for this bill amount"* milta tha.
- **Zipcode validator** — `country` optional documented hai par uska default lagne se **pehle** validator chalta tha, to `country` omit karne pe har zipcode reject ho jaata tha.
- **`PERCENTAGE` magic string** enum se replace (CLAUDE.md rule).

---

## Frontend ko batane wale changes

| Change | Kya karna hai |
|---|---|
| `/auth/register` me `role` ab **required** | Explicitly bhejein, pehle default `ADMIN` tha |
| `loginOrSignUp-with-whatsapp` me naya `isProfileComplete` field | Routing me use kar sakte hain — additive hai, kuch tootega nahi |
| `isFirst` ka matlab badla | Ab "OTP verify nahi hua" — retry pe bhi `true` rahega |
| Password endpoints customer/vendor pe `422` denge | Message: *"Password sign-in is only available for admin accounts…"* |
| `?userId` param ab kaam nahi karega | Token se hi user resolve hota hai |
| `locations/upsert` body ka `userId` ignore | Bhejna band karein |
| `showcase/section/get-all` ab `brandId` accept karta hai | Vendor ke liye optional, admin ke liye narrowing filter |
| Legal create me `type` ab **required** | `"VENDOR"` / `"CUSTOMER"` jaisa audience marker |
