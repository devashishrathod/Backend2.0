# Account Deletion — Design Plan

**Date:** 2026-08-26
**Finding:** [security_findings.md](./security_findings.md) #5 — `DELETE /users/delete` abhi no-op stub hai
**Scope:** Customer **aur** Vendor dono
**Status:** 🟡 Plan — **Q1–Q7 confirm karne ke baad implement karenge**

---

## Pehle ye samajh lijiye — ye "data delete" ka problem nahi hai

Codebase scan karne pe jo sabse badi baat nikli: account deletion yahan **paise aur obligations** ka problem hai, data ka nahi.

Chaar cheezein aisi hain jo **mita hi nahi sakte**, chahe user kuch bhi kahe:

| Kya | Kyun nahi mita sakte |
|---|---|
| **GST invoices** | `models/documentSnapshotSchema.js` banaya hi isliye gaya hai ki ek issue ho chuka invoice saalon baad bhi *bilkul waisa hi* reproduce ho. Usme brand ka GSTIN, PAN aur address **freeze** hain |
| **Open chargebacks** | `Transaction.isDisputed` — deadline **Razorpay ki taraf se** hoti hai, hamari nahi. Miss kiya to paisa automatically chala jaata hai |
| **`VoucherUsage`** | Iska unique `{voucherId, customerId}` index hi `ONCE_PER_USER` guarantee deta hai. Is model me **`isDeleted` field hai hi nahi** — delete karna matlab hard delete, aur customer dobara redeem kar lega |
| **`WebhookEvent`** | `eventId` hi Razorpay retry ka idempotency guard hai. Delete kiya to duplicate settlement ho sakta hai |

**Iska matlab:** app store ko "aapka saara data delete ho jayega" bolna **jhooth hoga**. Sahi wording: *"Aapka account aur personal data hata diya jayega. Invoices aur transaction records legal requirement ke tehat retain kiye jaate hain."*

---

## Aur — abhi 4 flows deleted account ke against chalte rehte hain

Ye deletion feature banane se pehle theek karne honge, warna "deleted" user ko notifications aati rahengi:

| Flow | File | Problem |
|---|---|---|
| **Notifications** | `helpers/notifications/notify.js` — `resolveRecipient` | Koi `isDeleted` check nahi. Deleted user ko email/WhatsApp/push jaata rahega |
| **Push dispatch** | `helpers/push/` — `dispatchPush` | User ko join hi nahi karta, sirf `DeviceToken.userId + isActive` dekhta hai |
| **Subscription expiry job** | `services/subscribeds/expireSubscriptions.js` | Sirf `Subscribed.isDeleted` filter karta hai, brand deleted hai ya nahi ye dekhta hi nahi — deleted vendor ko renewal reminders aate rahenge |
| **Customer voucher feed** | `helpers/vouchers/customerListing.js` | Brand ka `isDeleted` **kahin filter nahi hota**. Deleted vendor ke vouchers customer ki home screen pe dikhte rahenge |

> ⚠️ Ye chautha wala sabse serious hai — customer ek deleted vendor ke outlet pe voucher lekar pahunch sakta hai.

---

## Ek achhi baat — session kill automatic hai

`services/users/getUserById.js` `isDeleted: false` filter karta hai, aur wahi `verifyJwtToken` ka **single gate** hai. To `User.isDeleted = true` karte hi **har outstanding JWT turant 401 dene lagta hai**.

Matlab token blocklist ya `tokenVersion` ki zarurat **nahi** hai.

---

## Customer deletion — flow

Customer ka case seedha hai. 3 tiers:

### 🗑️ Tier 1 — DELETE (soft, `isDeleted: true`)

| Model | Kyun | Dhyan dene wali baat |
|---|---|---|
| `User` | Account khud | Ye **sabse aakhir me** — isi se session marta hai |
| `Customer` | 1:1 profile | |
| `Location` | Ghar ka address | **Sirf `customerId`/`userId` scoped** — is collection me brand/outlet addresses bhi hain |
| `Follow` | Followed brands | Field ka naam **`followeeId`** hai, `brandId` nahi — grep se miss ho jaata hai |
| `BrandAvoidance` | Avoid list | |
| `Notification` | Uske liye bheji gayi notifications | |
| `DeviceToken` | Push devices | Is model me `isDeleted` **nahi** hai — `isActive: false` + `deactivatedReason: "Account deleted"` use karna hoga |

**Counters jo decrement karne honge:** har removed `Follow` pe `Brand.followersCount`, har `BrandAvoidance` pe `Brand.avoidanceCount` — dono `$inc`-only hain, koi reconciler nahi hai. `{ $gt: 0 }` guard lagana hoga (jaise `toggleFollow.js` me hai).

### 🎭 Tier 2 — ANONYMISE (User document pe hi)

Ye **PII leak rokne ka asli mechanism** hai. Kyun: har aggregation ka `users` `$lookup` sirf `password`/`otp`/`refreshToken` project-away karta hai, aur `isDeleted` **kabhi filter nahi karta**. To deleted user ka naam/email/mobile admin panels me dikhta rahega.

| Field | Kya karein |
|---|---|
| `name`, `email`, `mobile`, `whatsappNumber`, `image`, `dob` | Blank / null |
| `username`, `referralCode`, `uniqueId` | **Tombstone value** (jaise `deleted_<objectId>`) — kyunki teeno pe unique index hai |

⚠️ **Empty string mat use karna** — do deleted accounts pe duplicate-key error aa jayega. Har row ka apna unique tombstone chahiye.

### 📌 Tier 3 — KEEP (bilkul haath nahi lagana)

`Transaction` · `VoucherUsage` · `PromoCodeUsage` · `Subscribed` · `SubscribedHistory` · `SystemVerify` · `BrandVerificationHistory` · `VoucherApprovalHistory` · `WebhookEvent`

---

## Vendor deletion — bahut zyada complex

Vendor ke saath ek **poora business** juda hota hai. Yahan 4 tiers hain, aur **pre-checks** bhi.

### 🚧 Pre-checks — inme se koi bhi true ho to deletion **block**

| Check | Kyun |
|---|---|
| Koi `Transaction` open + unverified hai | Paisa capture ho chuka hai par plan activate nahi hua. Delete kiya to wo payment permanently dead-end ho jayega (`settleSubscriptionPayment.js` "Brand not found!" throw karega, aur Razorpay 200 ke baad retry nahi karta) |
| Koi `Transaction` pe `isDisputed: true` aur unresolved | Chargeback deadline **external** hai. Miss karne pe paisa forfeit |
| *(Q2 pe depend)* Active paid `Subscribed` hai | Refund ka koi path codebase me hai hi nahi |

### 🗑️ Tier 1 — DELETE, aur **is order me**

Order isliye matter karta hai kyunki **customer ka feed `SubBrand` aur `VoucherSubBrand` pe filter karta hai, `Brand` pe nahi**:

```
1. SubBrand          ← customer feed ka geo-gate yahin hai
2. VoucherSubBrand   ← voucher↔outlet mapping
3. VoucherVersion
4. Voucher
5. ShowcaseSection   (+ Cloudinary media cleanup)
6. BrandFeatures
7. WorkHours
8. Location          (brandId / subBrandId scoped ONLY)
9. Notification
10. Brand
11. SUB_VENDOR Users (har outlet ka apna User account hota hai)
12. Vendor ka User   ← sabse aakhir, isi se session marta hai
```

> ⚠️ Sirf `Brand` soft-delete karne se **kaam nahi chalega** — customer listing brand ko filter hi nahi karti. Sweep `SubBrand` aur `VoucherSubBrand` tak jaana **zaruri** hai.

### 🎭 Tier 2 — ANONYMISE (audit chain bachaye rakhte hue)

`Bank` · `PAN` · `GST` · `User` — `brandId` intact rakhna, sirf identity fields scrub karna.

⚠️ `PAN.pan` aur `GST.gstNumber` pe **unique non-partial** compound index hai. Blank karne pe duplicate-key error. Per-row unique tombstone chahiye.

### 📌 Tier 3 — KEEP

Customer wale jaisa hi, plus `WebhookEvent`.

### 🔢 Tier 4 — CLEANUP

| Kya | Kyun |
|---|---|
| `recountBrandUsage(brandId)` | `subBrandsUsed` / `vouchersUsed` / `showcaseUsed` / `franchisesUsed` stale reh jayenge |
| `Follow` + `BrandAvoidance` (is brand ke) | Customers ki lists se brand hatana |
| `Banner.redirect.targetId` / `PromotionalTicker.redirect.targetId` | Ye **untyped** hain — koi FK cascade inhe pakad hi nahi sakta. Deleted brand ka deep link toota rahega |
| Doosre brands ke `SystemVerify.duplicateDetails.*BrandIds` | Deleted brand ki id un arrays me padi rahegi |

---

## ⚠️ Do jagah jahan cascade **chup-chaap miss** ho jayega

Research me ye specifically nikla — normal `brandId` grep se dono chhoot jaate hain:

| Model | Field | Problem |
|---|---|---|
| `Follow` | **`followeeId`** | `brandId` naam ka field hai hi nahi |
| `VoucherUsage` | sirf **`subBrandId`** | Na `brandId` hai, na `isDeleted` |

---

## Implementation ka shape (house pattern follow karte hue)

Repo me iska sabse kareeb precedent **`adminCancelSubscription.js`** hai — "rishta khatam karo, record mat mitao". Wahi structure:

```
routes/users.js
  router.delete("/delete", verifyJwtToken, validateSchema(validateDeleteAccount), deleteAccount)

controllers/users/deleteAccount.js
  asyncWrapper → actor { userId, role, customerId, brandId } + req.validatedData

services/users/deleteAccount.js
  ├── pre-checks (vendor ke liye)
  ├── role ke hisaab se cascadeCustomerDeletion / cascadeVendorDeletion
  ├── audit row (swallowing helper, recordSubscribedHistory jaisa)
  └── notification (sabse aakhir, state commit hone ke baad)

helpers/users/
  ├── cascadeCustomerDeletion.js
  ├── cascadeVendorDeletion.js
  └── anonymiseUser.js
```

**Transaction me wrap karna hoga** — abhi sirf `toggleFollow.js` `withTransaction` use karta hai delete-type flows me. Multi-collection cascade beech me fail ho gaya to account aadha-deleted reh jayega, aur usko detect karne ka koi raasta nahi hoga.

---

# ❓ Queries — inko confirm karna hai

## Q1. Grace period chahiye ya turant delete?

- **Option A — Turant, permanent.** Delete matlab delete. Simple, koi naya field nahi
- **Option B — 30-din grace period.** `deletedAt` timestamp, us dauran login karne pe account wapas. Ek purge job `jobs/index.js` me add hoga
  > ⚠️ Abhi codebase me `deletedAt` field kahin nahi hai. Nearest naming: `DeviceToken.deactivatedAt`, `Subscribed.cancelledAt`

**Answer:**

---

## Q2. Vendor ka active paid subscription — kya karein?

Codebase me **refund ka koi path hai hi nahi**.

- **Option A — Deletion block karo** jab tak subscription active hai. Vendor ko pehle cancel karna hoga (ya admin se karana hoga)
- **Option B — Chup-chaap cancel karo, paisa forfeit.** `adminCancelSubscription` wali tarah, aur `forfeitedDays`/`forfeitedValue` likh do taaki wo already-maujood goodwill worklist (`/subscribeds/admin/forfeited`) pe aa jaye
- **Option C — Admin approval maango** — vendor request kare, admin approve kare

**Answer:**

---

## Q3. Same number se dobara register kar payega?

Ye directly Tier 2 (anonymise) se juda hai.

- **Option A — Haan.** `email`/`mobile`/`whatsappNumber`/`username` release kar do (tombstone value me badal do). Person naya account bana sakta hai
  > ⚠️ Purana account **wapas nahi** mil sakta — nayi shuruaat hogi
- **Option B — Nahi.** Contact fields as-is chhod do. Wo number/email hamesha ke liye block

**Answer:**

---

## Q4. Vendor delete kare to uske outlets (SUB_VENDOR accounts) ka kya?

Har outlet ka apna `User` account hota hai (`SUB_VENDOR` role).

- **Option A — Sab soft-delete.** Outlets vendor ke bina exist nahi kar sakte
  > ⚠️ Wo log khud ko restore nahi kar payenge — `SUB_VENDOR` self-signup se excluded hai
- **Option B — Deactivate karo, delete nahi.** `isActive: false`, taaki admin baad me transfer kar sake

**Answer:**

---

## Q5. Customer delete kare — uski `VoucherUsage` history?

`VoucherUsage` me **`isDeleted` field hai hi nahi**, aur uska unique `{voucherId, customerId}` index hi `ONCE_PER_USER` enforce karta hai.

- **Option A — KEEP (recommended).** Redemption history retain. Fraud protection bani rahegi
  > ⚠️ Matlab customer ka `customerId` un rows me rahega
- **Option B — Hard delete.** Poori tarah mit jayega
  > ⚠️ Wahi customer dobara register karke same voucher **firse redeem** kar lega

**Answer:**

---

## Q6. Delete kaun kar sakta hai — sirf khud, ya admin bhi?

- **Option A — Sirf khud** (`DELETE /users/delete`, token se)
- **Option B — Khud + admin** (admin ke liye alag endpoint, `?userId` ke saath)
  > ⚠️ Abhi `?userId` param security fix me hataya gaya hai — admin ke liye alag route banega

**Answer:**

---

## Q7. Wo 4 "chalte rehne wale" flows — abhi theek karein ya baad me?

Section 2 me listed — notify, push, expiry job, customer voucher feed.

- **Option A — Isi change me theek karo (recommended).** Warna deleted users ko notifications aati rahengi aur unke vouchers customer ko dikhte rahenge. Chhote fixes hain — mostly ek-ek `isDeleted` guard
- **Option B — Alag round me.** Deletion feature pehle ship karo

**Answer:**

---

**Answers ke baad:** implement karunga, phir scratch DB pe verification suite chalaunga — jaise pichhle rounds me kiya tha.
