# Queries — API Documentation Categorization

**Date:** 2026-08-21
**Context:** `endpoints_category.md` banane ke baad jo cheezein clear nahi hui, wo yahan hain.
**Kaise answer karein:** Har question ke neeche `**Answer:**` line hai — wahin likh dijiye (ek shabd bhi kaafi hai, jaise "Option A" ya "haan/nahi"). Jo skip karna ho, `-` likh dijiye — main apna best judgement use kar lunga aur doc me assumption note kar dunga.

**Total:** 22 questions — **Q1–Q20 answered ✅** · **Q21–Q22 pending** (Round 2, doc ke end me — customer doc ko block nahi karte)
**Blocking (inke bina customer doc adhoora rahega):** Q1, Q3, Q5, Q9, Q10, Q18 — sab answered ✅

---

## 🔴 BLOCKING — Customer doc ka scope inse decide hoga

### Q1. Customer app kaun-kaun se login method use karta hai?

Backend me 4 login flows hain:

| Flow | Endpoints | Kya hai |
|---|---|---|
| A. WhatsApp OTP | `/auth/loginOrSignUp-with-whatsapp` + `/auth/verify-otp-whatsapp` | Auto signup bhi karta hai (`isFirst` flag) — customer app ka primary flow lagta hai |
| B. Email OTP | `/auth/login-with-email` + `/auth/verify-otp-email` | |
| C. Mobile OTP | `/auth/login-with-mobile` + `/auth/verify-otp-mobile` | |
| D. Password | `/auth/login` (`type`: EMAIL/MOBILE/USERNAME) | Panel login lagta hai |
| E. Register | `/auth/register` | ⚠️ `role` ka **default `ADMIN`** hai, aur username+password+mobile+whatsapp sab mandatory hai |

**Sawal:** Customer mobile doc me kaun-kaun se rakhun?
- Option A — sirf WhatsApp OTP (A)
- Option B — WhatsApp + Email + Mobile OTP (A+B+C) *(mera default assumption)*
- Option C — sab (A+B+C+D+E)

**Answer:**
> option A
---

### Q2. `/auth/register` aur `/auth/login` (password) kiske liye hain?

`register` ka default role `ADMIN` hai — matlab ye internal admin-creation endpoint lagta hai. Aur `login` (password wala) probably Super Admin panel + Vendor panel ka web login hai.

**Sawal:** Ye dono kis doc me jayenge? (Super Admin only / Super Admin + Vendor / dono docs me global)

**Answer:**
> Super Admin

---

### Q3. Customer app locations ke liye kaun-kaun se endpoint use karta hai?

`POST /locations/upsert` **confirmed customer-only** hai (service me `role !== CUSTOMER` → 403 check hai), aur ek customer ka ek hi location rehta hai.

Lekin baaki 5 (`create`, `getAll`, `get/:id`, `update/:id`, `delete/:id`) sab roles ke liye khule hain — inme brand aur sub-brand addresses bhi aate hain.

**Sawal:** Customer doc me kya rakhun?
- Option A — sirf `POST /locations/upsert` *(mera default assumption)*
- Option B — `upsert` + `GET /locations/get/:id`
- Option C — `upsert` + `get/:id` + `getAll` + `update/:id` + `delete/:id` (sab 5)

**Answer:**
> POST /locations/upsert and get/:id

---

### Q5. Brand Features (`/brandFeatures`) — kaun manage karta hai aur kaun dekhta hai?

`POST /brandFeatures/add` me `brandId` **body me** aata hai (token se resolve nahi hota) — isse decide nahi ho pa raha ki Vendor apne liye add karta hai ya Admin kisi bhi brand ke liye.

**Sawal (do parts):**

**5a.** `add` / `update` / `delete` kaun karta hai — Vendor, Admin, ya dono?

**Answer:**
> dono

**5b.** `GET /brandFeatures/get-all?brandId=` aur `GET /brandFeatures/get/:featureId` — customer ke brand profile page pe ye features dikhte hain? (Agar haan to customer doc me aayenge)

**Answer:**
> haa
---

### Q9. Subscription plans customer ke liye bhi hain?

Abhi `/subscriptions` clearly **vendor plans** lag rahe hain (vendor onboarding me plan subscribe karta hai, `Subscribed` model brand se linked hai).

Lekin `SUBSCRIPTION_PLANS` enum me `FREE` / `BASIC` / `PREMIUM` / `FAMILY` hai — `FAMILY` naam se lagta hai customer-side plans bhi plan me hain.

**Sawal:** `GET /subscriptions/getAll` aur `GET /subscriptions/get/:id` customer doc me daalun?
- Option A — nahi, ye sirf vendor + admin ke liye hai *(mera default assumption)*
- Option B — haan, customer ke bhi plans hain (to filter kaise hota hai — koi `type`/`for` field?)

**Answer:**
> option A
---

### Q10. Doc me "role" kaise likhun — intended ya actually enforced?

**Ye important hai.** 108 endpoints me se sirf ~20 pe role middleware (`isAdmin` / `isVendor`) laga hai. Baaki ~88 pe sirf `verifyJwtToken` hai.

Practical matlab: **customer ka JWT token le kar `POST /banners/create` (admin banner create) call kiya ja sakta hai** — backend rokega nahi. Same `POST /vouchers/review/:versionId` (admin approval) ka bhi haal hai.

**Sawal (do parts):**

**10a.** Doc ke "Auth / Access" column me kya likhun?
- Option A — **Intended role** likhun (jaise "Customer only") — frontend ke liye clean hai, lekin actual behaviour se match nahi karta
- Option B — Dono likhun: "Intended: Customer · Enforced: any authenticated role" *(mera recommendation — honest rehta hai aur frontend confuse bhi nahi hota)*
- Option C — Sirf actually enforced likhun

**Answer:**
> Option B 

**10b.** Ye missing role enforcement ek security gap hai. Isko main ek alag "Security Findings" section me list kar dun (documentation ke saath), ya abhi doc pe hi focus rakhun?

**Answer:**
> Ha, krdo, me bad me review kr lunga us doc ko. 
---

### Q18. `GET /brands/get` customer ke liye PAN/GST/Bank expose kar raha hai

Ye ek hi endpoint hai jo `?brandId` accept karta hai, aur response me ye sab lookups aate hain:

`user` · `pans` · `gsts` · `banks` · `locations` · `systemverifies` · `subscribeds` · `categories` · `subcategories` · `workhours` · `subbrands` (+ unke users/locations/workhours)

Customer app ko brand profile page ke liye ye endpoint chahiye hoga, lekin **PAN number, GST number, bank account details customer ko nahi jaane chahiye**.

**Sawal:** Kya karun?
- Option A — Customer doc me isko document karun, aur note likhun ki "customer ko ye fields ignore karne hain" (ganda solution hai)
- Option B — Customer doc me isko as-is document karun, aur alag se flag karun ki backend me role-based response filtering chahiye *(mera recommendation)*
- Option C — Customer doc me is endpoint ko hi na daalun — batao ki customer brand-detail ke liye naya dedicated endpoint banega (jaise `GET /brands/customer/get/:brandId`)

**Answer:**
> Option B
---

## 🟡 NON-BLOCKING — Doc ki accuracy ke liye

### Q4. `DELETE /users/delete` stub hai — kya karna hai?

`routes/users.js:12` pe ye inline handler hai:
```js
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});
```
Matlab: kuch delete nahi hota, sirf success message aata hai. Controller/service exist hi nahi karta.

**Sawal:**
- Option A — Doc me daalun with "⚠️ Not implemented yet — no-op" warning *(mera default)*
- Option B — Doc se skip karun, jab implement ho jaye tab add karenge
- Option C — Pehle implement karo, phir document karo

**Answer:**
> Option A
---

### Q6. `POST /vouchers/publish/:versionId` — Vendor publish karta hai ya Admin?

Service (`publishVoucher.js`) sirf `userId` leta hai, koi role check nahi. Rule ye hai ki version ka status `APPROVED` hona chahiye.

Do interpretations:
- **Vendor** — Admin approve karta hai, phir vendor decide karta hai kab live karna hai
- **Admin** — Admin hi approve + publish dono karta hai (ek hi step, do endpoints)

**Answer:**
> Dono kr skte he
---

### Q7. Voucher banner (`POST` / `DELETE /vouchers/:voucherId/banner`) — Vendor ya Admin?

Code comment kehta hai: *"Adds or replaces the voucher's independent promo banner. Never touches status/approval/versions."* Matlab approval flow bypass karke banner kabhi bhi lag sakta hai.

**Sawal:** Ye Vendor karta hai (apne voucher ka banner) ya Admin (featured/promoted vouchers ke liye)? Ya dono?

**Answer:**
> Dono
---

### Q8. `GET /vouchers/versions/get-all` — ek hi endpoint dono panels me?

Isme `brandId`, `status`, `createdBy`, `reviewedBy`, `approvedBy`, `rejectedBy` jaise saare filters hain — matlab Vendor apni list dekhega (brandId filter se) aur Admin sabki (approval queue ke liye `status=PENDING_REVIEW`).

**Sawal:** Vendor doc aur Admin doc **dono** me document karun (panel-specific example params ke saath), ya ek jagah?

**Answer:**
> Dono me krna he
---

### Q11. `showcase/section/:brandId/reorder` — leading slash missing, route dead hai

`routes/showcase.js:63`:
```js
router.put("section/:brandId/reorder", ...)   // ❌ "/" missing
```
Express leading slash ke bina match nahi karega — ye endpoint call hi nahi ho sakta.

**Sawal:**
- Option A — Pehle fix karun (`/section/:brandId/reorder`), phir document karun *(recommend — one-line fix hai)*
- Option B — Doc me "currently broken" note ke saath daalun
- Option C — Doc se skip karun

**Answer:**
> mene fix kr diaa, ye dono ke lie hoga, admin + vendor for both
---

### Q12. `showcase/section/get-all` — brand scoping commented out hai

`services/showcases/getAllSections.js`:
```js
// const brand = await validateVendorBrand(userId);
const match = {
  // brandId: brand._id,      ← ❌ commented out
  isActive: ..., isVisible: ..., isDeleted: false
};
```
Matlab vendor ye call kare to **sabhi brands ke sections** aa jaate hain, sirf apne nahi.

**Sawal:**
- Option A — Current (buggy) behaviour document karun, alag se flag kar dun *(mera default)*
- Option B — Pehle fix karun (brandId scoping wapas laun), phir intended behaviour document karun

**Answer:**
> Super admin ke lie he, vendor bhi krega, brandId jaa skti he. 
---

### Q13. Base URLs kya hain?

Reference doc me `http://localhost:5000` tha. Trydood local pe `http://localhost:8080/trydood/v1` hai.

**Sawal:** Doc me kaun-kaun se environments list karun?
- Local: `http://localhost:8080/trydood/v1`
- Staging/Dev: `?`
- Production: `?`

**Answer:**
> Local: http://localhost:8080/trydood/v1
> Staging: https://backend2-0-4v4i.onrender.com/trydood/v1/
---

### Q14. Upcoming APIs ke liye placeholder rakhun?

Ye files exist karti hain lekin koi route inko expose nahi karta (git me untracked hain — abhi bane hain):
- `models/VoucherUsage.js` — voucher redemption tracking
- `services/vouchers/expireVouchers.js` — auto-expiry (cron job? `jobs/index.js` empty hai)

Customer app ke liye redemption flow (voucher redeem/scan/QR) abhi missing hai — sirf `preview` hai.

**Sawal:**
- Option A — Doc me sirf jo live hai wahi rakhun *(mera default)*
- Option B — Ek "🚧 Coming Soon" section rakhun jisme redemption APIs ka placeholder ho

Aur: **customer app ka redemption flow kya hoga?** (QR scan / OTP / vendor-side code entry) — pata hoga to bata dijiye, doc structure usi hisaab se plan kar lunga.

**Answer:**
> Option A
---

### Q15. Doc ki language — English ya Hinglish?

Reference doc (`API_DOCUMENTATION.md`) pura English me hai.

**Sawal:**
- Option A — Pura English (reference ke exactly jaisa) *(mera default — frontend team ke liye best)*
- Option B — English structure + Hinglish notes/warnings

**Answer:**
> Hinglish
---

### Q16. Customer doc me vendor/admin endpoints ka mention karun?

**Sawal:** Customer doc me sirf customer-relevant endpoints rahenge, ya end me ek chhoti list ho ki "ye endpoints exist karte hain par customer app ke liye nahi hain" (taaki frontend accidentally use na kare)?

- Option A — Sirf customer endpoints, saaf-suthra *(mera default)*
- Option B — End me "Not for customer app" wali reference list bhi

**Answer:**
> Option B
---

### Q17. Categories/SubCategories — customer home screen inhi se banta hai?

`GET /categories/getAll` aur `GET /subCategories/getAll` — abhi ye sab roles ke liye khule hain aur inme pagination/filter params hain.

**Sawal:** Customer home screen ka category grid inhi se aata hai? Aur koi customer-specific behaviour chahiye (jaise sirf `isActive`, ya voucher-count ke saath)?

**Answer:**
> Abi ke lie nhi, bad me sochege.
---

### Q19. `/transactions/subscribe/*` — sirf vendor ke liye?

`createSubscribeOrder.js` me `isAdmin` check hai (admin ke liye kuch bypass hota hai), baaki ye Razorpay subscription order banata hai.

**Sawal:** Ye sirf Vendor panel ke liye hai, ya Admin bhi kisi brand ke liye subscription create kar sakta hai? Aur customer-side payments future me isi module me aayenge?

**Answer:**
> Dono - Admin bhi kisi brand ke liye subscription create kar sakta ha!
---

### Q20. Utility endpoints aur public config

**20a.** `GET /` (health), `GET /my-ip`, `GET /client-ip` — ye `/trydood/v1` ke bahar hain. Docs me include karun?

**Answer:**

**20b.** `GET /settings/get` abhi `isAdmin`-only hai. Customer app ko koi public config chahiye hoti hai — min app version, force-update flag, support number/email, feature flags. Aisa koi endpoint abhi nahi hai.

**Sawal:** Ye future me banega? Doc me placeholder rakhun?

**Answer:**
> Ignore for now
---

## ✅ Jo cheezein main confirm kar chuka hoon (verification ke liye — galat ho to bata dijiye)

| # | Finding | Kahan se confirm hua |
|---|---|---|
| 1 | `POST /locations/upsert` sirf CUSTOMER ke liye hai | `upsertLocation.js` — `if (user.role !== ROLES.CUSTOMER) throwError(403)` |
| 2 | `/follows/*` aur `/brandAvoidances/*` sirf CUSTOMER ke liye | dono services me `resolveCustomerByUserId(userId)` |
| 3 | `/banners/*` aur `/promotionalTickers/*` CRUD = ADMIN (app-level, brand se linked nahi) | models me `brandId` nahi, sirf `createdBy` |
| 4 | `/banners/customer/active` + `/promotionalTickers/customer/active` = CUSTOMER | dedicated services, sirf active+dated records |
| 5 | Showcase section/media CRUD = VENDOR | `createSection.js` → `validateBrandVendor(userId)` |
| 6 | `/showcase/get-brand-showcase/:brandId` + `/:brandId/video-clips` = CUSTOMER | inactive/deleted filter out, `storage`/`metadata` strip |
| 7 | `/vouchers/customer/*` (3 endpoints) = CUSTOMER | dedicated customer services |
| 8 | `POST /vouchers/review/:versionId` = ADMIN | service ka param hi `adminUserId` hai + "Admin authentication is required" error |
| 9 | `/brands/onboarding/*` (7) + `/verification/*` (3) = VENDOR | `isVendor` middleware |
| 10 | `/settings/*` = ADMIN | `isAdmin` middleware |
| 11 | Categories, SubCategories, Terms, Privacy: **write = ADMIN, read = GLOBAL** | `isAdmin` write pe, `verifyJwtToken` read pe |
| 12 | `/subBrands/*` (outlets) + `/workHours/upsert` = VENDOR | brand-scoped, `SUB_VENDOR` role create karta hai |
| 13 | Auth pura GLOBAL hai — `role` body param se panel decide hota hai | `loginOrSignUpWithWhatsapp.js` — `role \|\| ROLES.CUSTOMER` |
| 14 | Total 108 endpoints (`/trydood/v1` ke andar) + 3 utility | 21 route files scan kiye |

---

# 🆕 ROUND 2 — Aapke answers apply karne ke baad 2 naye questions

Ye dono **customer doc ko affect nahi karte** — customer doc aap abhi approve kar sakte ho. Ye vendor/admin doc (phase 2/3) ke liye chahiye honge.

---

### Q21. Email OTP aur Mobile OTP login flows kiske liye hain?

Q1 me aapne kaha customer app **sirf WhatsApp OTP** use karega, aur Q2 me `/auth/register` + `/auth/login` (password) = **Super Admin**.

Lekin ye 4 endpoints kis panel ke liye hain, ye clear nahi hua:

| Endpoints | Kya karte hain |
|---|---|
| `POST /auth/login-with-email` + `POST /auth/verify-otp-email` | Email pe OTP bhejta hai → verify → JWT |
| `POST /auth/login-with-mobile` + `POST /auth/verify-otp-mobile` | Mobile pe OTP bhejta hai → verify → JWT |

Dono me `role` body param hai (jaise WhatsApp flow me hai), matlab technically kisi bhi role ke liye kaam karte hain.

**Sawal:** Ye kis doc me jayenge?
- Option A — Vendor panel (vendor email/mobile se login karega) *(mera current assumption — `endpoints_category.md` me yahi laga hai)*
- Option B — Super Admin panel
- Option C — Vendor + Super Admin dono
- Option D — Abhi koi use nahi karta, kisi doc me na daalo

**Answer:**
> Option C, ye endpoints Baad me use krege. 
---

### Q22. `showcase/section/get-all` — `brandId` filter abhi **support hi nahi hai**

Q12 pe aapne kaha: *"Super admin ke lie he, vendor bhi krega, brandId jaa skti he."*

⚠️ Problem: abhi `brandId` query param bhejne se **kuch nahi hoga**, do wajah se:

1. **Service isko read nahi karta** — [services/showcases/getAllSections.js:8](../services/showcases/getAllSections.js#L8) me destructure sirf ye hai:
   ```js
   const { page, limit, search, sortBy, order, isActive, isVisible } = query;
   ```
2. **Validator isko strip kar deta hai** — [validator/showcase.js:40-52](../validator/showcase.js#L40) ke `validateGetAllSections.query` me `brandId` define nahi hai, aur `validateSchema` middleware `stripUnknown: true` ke saath chalta hai → `?brandId=xyz` request se hat jaata hai

Matlab abhi ye endpoint **sabhi brands ke sections** deta hai, aur filter karne ka koi tareeka nahi hai.

**Sawal:** Expected behaviour kya hona chahiye? (main isi hisaab se document karunga)
- Option A — **Admin:** `brandId` optional (na do to sab brands); **Vendor:** apna brand force ho, `brandId` ignore *(mera recommendation — sabse safe)*
- Option B — Dono ke liye `brandId` mandatory karo
- Option C — Abhi jaisa hai waisa hi document karo (koi filter nahi), baad me fix karenge

Aur: **abhi fix karun ya sirf document karun?** (fix ~30 min ka hai — validator me 1 line + service me brandId handling)

**Answer:**
> Option C
---

**Round 1 answers ka status:** ✅ Sab apply ho gaye — `endpoints_category.md` update hai, aur `security_findings.md` bana diya (Q10b) jisme 6 findings hain.

**Next:** `endpoints_category.md` ke end me **"FINAL: Customer Mobile App Doc — 30 Endpoints"** section hai. Wo list approve kar dijiye, phir `customer_mobile_api_doc.md` banaunga — reference doc ke exact same structure me (endpoint, method, headers, request params + enums, success response, error responses, edge cases, notes).
