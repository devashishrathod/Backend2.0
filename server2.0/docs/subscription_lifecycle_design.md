# Subscription Lifecycle, Checkout & Plan Entitlements — Design

How a vendor's subscription is priced, paid for, activated, expired, and how a
plan's limits are enforced on outlets, franchises, vouchers and showcase
sections.

Last updated: 2026-08-24

---

## 1. Source of truth

| Question | Answer | Where |
|---|---|---|
| Is this brand subscribed **right now**? | `Subscribed.status === ACTIVE && endDate > now` | `helpers/subscribeds/getActiveSubscription.js` |
| `Brand.isSubscribed` | **Cache only.** Never read it for a decision. | written *only* by `syncBrandSubscriptionState.js` |
| What is this brand allowed to do? | `Subscription.entitlements`, resolved | `helpers/subscriptions/resolveEntitlements.js` |
| `Subscription.features[]` | **Display only.** Never enforced. | — |
| `Brand.*Limit` / `is*Unlimited` (4 pools) | Cache of the plan's entitlements | written *only* by `applyPlanEntitlements.js` |
| `Brand.*Used` (4 pools) | Cache of the owning collection's row count | atomic in `entitlementSlots.js`, rebuilt by `recountBrandUsage.js` |
| Was a vendor notified? | `Notification` rows | `helpers/notifications/notify.js` |
| How much does this cost? | `calculatePricing()` | `helpers/subscribeds/calculatePricing.js` |
| GST %, policy flags, seller identity | `Setting.vendor.subscription` | `helpers/settings/getSubscriptionConfig.js` |

The legacy booleans on `Subscribed` (`isActive`, `isExpired`, `isUpgraded`) are
still written so older readers keep working, but they are **derived from
`status`** — never the reverse.

---

## 2. Configuration

Everything tunable lives on the singleton `Setting` doc under
`vendor.subscription`, read through `getSubscriptionConfig()`.
`constants/subscription.js → SUBSCRIPTION_DEFAULTS` is a **fallback only**, used
when the DB has no value.

```
PUT /trydood/v1/settings/update        (admin)
{
  "vendor": {
    "subscription": {
      "gstPercentage": 18,
      "isGstInclusive": false,
      "companyName": "Trydood",
      "companyGstin": "23XXXXXXXXXXXZX",
      "companyStateCode": "23",
      "companyState": "Madhya Pradesh",
      "companyAddress": "…",
      "hsnSacCode": "998315",
      "allowVendorDowngrade": false,
      "allowAdminDowngrade": true,
      "allowAdminFreeGrant": true,
      "gracePeriodDays": 0,
      "expiryJobIntervalMinutes": 60
    }
  }
}
```

The block is **merged**, not replaced — changing only `gstPercentage` leaves
everything else alone.

**Live seller identity** (applied 2026-08-23, traced to the verified GST record
`33AAKCT3750H1ZB`):

| Key | Value |
|---|---|
| `companyName` | TRYDOOD RETAIL PRIVATE LIMITED |
| `companyGstin` | 33AAKCT3750H1ZB |
| `companyStateCode` | 33 |
| `companyState` | Tamil Nadu |
| `companyAddress` | 2nd Floor, Phase-3, Suite No. 250, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002 |

`companyStateCode` is the field that decides CGST+SGST vs IGST — it is compared
against the first two digits of each brand's GSTIN at checkout. Leave it blank
and every supply is treated as inter-state and billed as IGST.

Set it with `node scripts/setSubscriptionConfig.js --apply` (dry-run by default),
or through `PUT /settings/update`.

---

## 3. Pricing

One pure function, `calculatePricing()`, used by **preview, order creation,
verification and the invoice**. That is what guarantees the amount shown at
checkout is the amount charged and the amount printed.

```
listPrice        = subscription.price
discountAmount   = PERCENT ? listPrice × discountPercent/100 : discountAmount
                   (capped at listPrice)
promoDiscount    = from validatePromoCode(), applied to the discounted subtotal
taxableValue     = listPrice − discountAmount − promoDiscount     ("Bill Value")
gstAmount        = taxableValue × gstPercentage/100
  intra-state:     cgst = sgst = gstAmount/2        (remainder → sgst)
  inter-state:     igst = gstAmount
totalPayable     = taxableValue + gstAmount                       ("You'll Pay")
amountInPaise    = round(totalPayable × 100)       ← sent to Razorpay
```

`isGstInclusive: true` reverses it: `taxableValue = total ÷ (1 + rate)`.

Every figure is rounded to 2 decimals at each step, so the stored breakdown
always sums exactly to `amountInPaise`.

**Place of supply** — brand GSTIN's first 2 digits vs `companyStateCode`. No
GSTIN → compare state names. Cannot prove a match → IGST.

The whole block is frozen onto **both** `Transaction.pricing` and
`Subscribed.pricing`, so an old invoice regenerates identically even after the
plan price or GST rate changes.

### Verified against the live checkout page

| Row | Value |
|---|---|
| Original Price | ₹ 4,999.00 |
| Bill Value | ₹ 4,999.00 |
| IGST @ 18.00% | ₹ 899.82 |
| **You'll Pay** | **₹ 5,898.82** |
| — | You saved ₹ 0.00 on This Plan |

`amountInPaise = 589882`.

---

## 4. Checkout endpoints

| Method | Path | Role |
|---|---|---|
| POST | `/transactions/subscribe/preview` | VENDOR, ADMIN |
| POST | `/transactions/subscribe/create-order` | VENDOR, ADMIN |
| POST | `/transactions/subscribe/verify-transaction` | VENDOR, ADMIN |
| POST | `/transactions/invoice/regenerate` | VENDOR, ADMIN |
| POST | `/transactions/webhook/razorpay` | **PUBLIC** (HMAC-signed) |
| GET | `/transactions/webhook/events` and `/events/:id` | ADMIN |
| POST | `/transactions/webhook/replay/:eventId` | ADMIN |
| GET | `/transactions/disputes` | ADMIN |

A vendor may only act on their own brand; an admin must name a `brandId` and may
name any. Enforced by `helpers/brands/resolveActorBrand.js`.

### `POST /transactions/subscribe/preview`

Read-only — no Razorpay call, no Transaction row. Safe on every render.

```jsonc
{
  "brand":  { "_id": "…", "brandName": "Devashish Tester", "isApproved": true },
  "plan":   { "name": "Pro Plus", "description": "For national brands at scale",
              "typeLabel": "Yearly", "price": 4999, "durationLabel": "1 year",
              "discountPercent": 0, "features": [], "entitlements": {} },
  "action": "NEW",                       // NEW | RENEW | UPGRADE | DOWNGRADE
  "currentPlan": null,                   // or { name, endDate, daysRemaining }
  "validity": { "startDate": "…", "endDate": "…", "durationLabel": "1 year" },
  "billingDetails": {
    "brandName": "Devashish Tester",
    "address": "First Floor, Unit 101, …, Haryana, 122002",
    "gstin": "06AAECG4365R1Z1",
    "pan": "AAECG4365R",
    "addressSource": "GST"               // GST | LOCATION | PAN
  },
  "pricing": { /* full block, see §3 */ },
  "orderSummary": {
    "rows": [
      { "key": "ORIGINAL_PRICE", "label": "Original Price", "amount": 4999,   "display": "₹ 4,999.00" },
      { "key": "BILL_VALUE",     "label": "Bill Value",     "amount": 4999,   "display": "₹ 4,999.00" },
      { "key": "TAX",            "label": "IGST @ 18.00%",  "amount": 899.82, "display": "₹ 899.82"   }
    ],
    "payable":   { "label": "You'll Pay", "amount": 5898.82, "display": "₹ 5,898.82" },
    "savedText": "You saved ₹ 0.00 on This Plan"
  },
  // One entry per metered pool: subBrands, franchises, vouchers, showcase.
  "limits": {
    "subBrands": { "used": 0, "newLimit": null, "isUnlimited": true, "overflowBy": 0, "label": "outlets" },
    "vouchers":  { "used": 8, "newLimit": 100,  "isUnlimited": false, "overflowBy": 0, "label": "vouchers" }
  },
  // `applied` is null until a usable code is sent; `message` carries the exact
  // rejection reason when one fails, so the Apply button can render it inline.
  "promo":  { "supported": true, "applied": { "code": "LAUNCH20", "discount": 799.8 }, "message": "Promo code LAUNCH20 applied" },
  "canProceed": true,
  "blockedReason": null,
  "notices": []
}
```

The page renders `orderSummary.rows` top to bottom and does **no arithmetic and
no label building**. A `DISCOUNT` row appears only when the discount is > 0. The
tax row label switches between `IGST @ x%` and `CGST @ x%` + `SGST @ x%`
automatically.

### `POST /transactions/subscribe/create-order`

Runs the same builder, refuses if `canProceed` is false, then opens the Razorpay
order for `pricing.amountInPaise`.

> There is **no `amount` field** in the request. It used to be accepted and
> applied as `amount || price`, which let anyone buy a ₹4,999 plan for ₹1.

Reuses a still-open order for the same brand + plan within
`pendingOrderReuseMinutes` instead of leaving abandoned orders behind.

### `POST /transactions/subscribe/verify-transaction`

Checks, in order:

1. transaction exists, gateway is RAZORPAY, `razorpayOrderId` matches
2. caller owns it (or is an admin)
3. **already verified → returns the existing subscription** (idempotent)
4. HMAC signature
5. `payment.order_id === transaction.razorpayOrderId`
6. `payment.amount === pricing.amountInPaise` — a short payment cannot activate
7. `payment.captured`

Then activates, and generates the invoice **after** activation inside its own
try/catch so a Cloudinary failure can never take money without granting a plan.

`currentScreen` advances to `OUTLET_PAGE` **only** if the vendor is still on
`SUBSCRIBE_PLAN` — renewing from the dashboard no longer throws them back into
onboarding.

---

## 5. Lifecycle

```
                 ┌──────────► EXPIRED    (endDate passed — job or self-heal)
   PENDING       │
      │          ├──────────► UPGRADED   (replaced by a pricier plan)
      ▼          │
   ACTIVE ───────┼──────────► DOWNGRADED (replaced by a cheaper plan)
                 │
                 └──────────► CANCELLED  (admin revoked)
```

`helpers/subscribeds/activateSubscription.js` is the only place a plan goes
live. It creates the new ACTIVE doc **before** retiring the old one, so a crash
mid-way leaves a valid plan rather than none.

### Expiry — three layers

1. **The job** (`services/subscribeds/expireSubscriptions.js`) sweeps every
   `ACTIVE` doc past its end date, then resyncs each affected brand.
2. **Self-heal on read** — `getActiveSubscription` expires a stale ACTIVE row on
   the spot. A stopped job delays cleanup; it does not break correctness.
3. **Admin repair** — `PUT /subscribeds/admin/resync` rebuilds everything.

The runner is `jobs/index.js`: `setInterval`, no cron dependency, one catch-up
run on boot, overlap-guarded, disabled with `ENABLE_JOBS=false`.

---

## 6. Admin flows

Admins can act **with** payment or **without** it.

| Path | Method | What |
|---|---|---|
| `/transactions/subscribe/*` | POST | with payment, on a vendor's behalf |
| `/subscribeds/admin/grant` | POST | **without payment** — NEW / RENEW / UPGRADE / DOWNGRADE |
| `/subscribeds/admin/cancel` | PUT | revoke immediately |
| `/subscribeds/admin/get-all` | GET | listing; filter by status, source, `expiringInDays` |
| `/subscribeds/admin/resync` | PUT | repair cached state + limits |
| `/subscribeds/admin/forfeited` | GET | vendors who lost days on an upgrade |
| `/subscribeds/admin/forfeited/compensate` | PUT | stamp a forfeit as settled |
| `/promoCodes/*` | CRUD | promo code management (admin only) |
| `/notifications/get-all` · `/mark-read` | GET · PUT | the vendor's bell |
| `/subscribeds/get` | GET | current plan + usage (vendor: own brand only) |
| `/subscribeds/history` | GET | audit trail |

`POST /subscribeds/admin/grant` is the single manual endpoint — the response's
`action` reports whether it was a new plan, a renewal, an upgrade or a
downgrade. There is no separate change-plan route.

```jsonc
{
  "brandId": "…", "subscriptionId": "…",
  "paymentMode": "FREE",            // FREE | CASH | BANK_TRANSFER | CHEQUE | UPI_OFFLINE
  "collectedAmount": 0,             // ignored for FREE
  "referenceNumber": "NEFT-8817",
  "durationInDays": 365,            // optional override
  "startDate": "2026-09-01",        // optional
  "keepCurrentEndDate": false,      // fix the tier, keep the paid-for validity
  "note": "Complimentary plan — launch partner"   // required
}
```

A Transaction row is always written with `gateway: MANUAL` and an invoice is
generated, so admin grants appear in the same reporting as card payments. The
full GST breakdown is recorded even on a FREE grant, with a zero collection
against it.

> **Why manual rows carry a synthetic `razorpayOrderId`.** The live database has
> `razorpayOrderId_1` as a **non-sparse unique** index. Manual grants have no
> Razorpay order, and two rows with `null` would collide on that index — the
> second admin grant would fail with a duplicate-key error. Rather than
> switching the index to sparse (which raises `IndexOptionsConflict` on every
> boot until the old one is dropped), manual rows are written with
> `MANUAL-<invoiceId>`, which is already unique.
>
> Optional cleanup, if you would rather have real nulls:
> ```js
> db.transactions.dropIndex("razorpayOrderId_1")
> db.transactions.createIndex({ razorpayOrderId: 1 }, { unique: true, sparse: true })
> ```
> Then change `models/Transaction.js` to `{ type: String, unique: true, sparse: true }`
> and drop the synthetic value in `adminGrantSubscription.js`. Not required.

Every transition writes an immutable `SubscribedHistory` row. History writes are
failure-tolerant by design — losing an audit row must never roll back an
activation.

---

## 7. Plan entitlements

### Why `features[]` is not enforced

`features[]` is free text a human types. The live data already proves it cannot
carry rules:

| Plan | Problem |
|---|---|
| Pro Lite | `{ title: "Deal Pack", value: "Yes", available: false }` — contradicts itself |
| Basic | `Sub Brand: "01"` but `Franchise: "5"` |
| Pro Plus | `Franchise: "Yes"` — no count at all |
| all | values are `"Unlimited"`, `"15"`, `"01"`, `"Yes"`, `"No"`, `"12 / Month"` … |

Renaming a title would silently switch enforcement off. So:

- **`features[]` → display only.** Rename, reorder, delete freely. No rule moves.
- **`entitlements` → structured, typed, enforced.**

```js
entitlements: {
  subBrands:       { limit: 0, isUnlimited: true },   // isUnlimited wins
  franchises:      { limit: 50, isUnlimited: false },
  vouchers:        { isEnabled: true },
  dealPack:        { isEnabled: true },
  prioritySupport: { isEnabled: true },
  showcase:        { isEnabled: true },
}
```

Fixed key set + `stripUnknown` means an admin cannot invent a key that enforces
nothing.

### Resolution order

1. `subscription.entitlements` — **always wins**
2. **derived** from `features[]` — a compatibility bridge for pre-existing plans,
   and the only code in the repo that parses display strings for enforcement
3. `DEFAULT_ENTITLEMENTS` — deliberately stingy (`subBrands: 1, franchises: 0`)

Anything the bridge cannot determine is **not guessed generously**: it falls back
to the default and emits a warning. `entitlementsSource` (`DB` / `DERIVED` /
`DEFAULT`) is returned in admin responses so it is visible which plans still
need configuring.

**Live plan entitlements** (applied 2026-08-23 via
`scripts/setPlanEntitlements.js`, all four now resolve as `DB`):

| Plan | Price | Outlets | Franchises | Vouchers | Showcase | Deal Pack | Priority |
|---|---|---|---|---|---|---|---|
| Basic | ₹1,999 | 5 | 1 | 10 | 5 | ✗ | ✗ |
| Advanced | ₹2,999 | 15 | 10 | 15 | 15 | ✓ | ✗ |
| Pro Lite | ₹3,999 | 25 | 25 | 25 | 25 | ✓ | ✓ |
| Pro Plus | ₹4,999 | UNLIMITED | UNLIMITED | 50 | UNLIMITED | ✓ | ✓ |

Vouchers and showcase sections are **metered pools**, not on/off flags, and are
enforced by real gates. Voucher counts (10 / 15 / 25 / 50) were set explicitly by
the product owner; the `Voucher: "No"` display rows that Basic and Advanced
carried were corrected to the real allowance, since they would otherwise
contradict what is enforced.

Three judgement calls made while setting these, worth re-confirming:

- **Basic's `features[]` had its two values swapped** versus the confirmed
  intent — it read `Sub Brand: "01"` and `Franchise: "5"` for a plan that grants
  5 outlets and 1 franchise. The display rows were corrected to match.
- **Pro Lite's `Deal Pack` row was self-contradictory** (`value: "Yes"` with
  `available: false`). Pro Lite sits above Advanced, which does grant Deal Pack,
  so it was read as enabled and the stale flag corrected.
- Franchise counts on Pro Lite (25) and Advanced (10) were chosen to mirror each
  plan's outlet tier; the plan data carried no number to derive them from.

Before this, all four resolved as `DERIVED` and `Franchise: "Yes"` produced a
limit of **0** — franchise creation was blocked on Pro Plus, Pro Lite and
Advanced. That is the failure mode the bridge is designed to make loud rather
than paper over.

To change a plan later:

```
PUT /trydood/v1/subscriptions/update/:id
{ "entitlements": { "subBrands": { "isUnlimited": true },
                    "franchises": { "limit": 50 },
                    "vouchers": { "isEnabled": true } } }
```

Then refresh the brands already on that plan — `PUT /subscribeds/admin/resync`.

### Four separate pools

Every metered feature is an **independent** quota; none draws from another.

| Brand fields | Meters | Gate |
|---|---|---|
| `subBrandsLimit` / `subBrandsUsed` / `isSubBrandsUnlimited` | `SubBrand` outletType OUTLET | `signUpSubBrandWithWhatsapp`, `updateSubBrand` |
| `franchisesLimit` / `franchisesUsed` / `isFranchisesUnlimited` | `SubBrand` outletType FRANCHISE | same |
| `vouchersLimit` / `vouchersUsed` / `isVouchersUnlimited` | `Voucher` in a live status | `createVoucher` |
| `showcaseLimit` / `showcaseUsed` / `isShowcaseUnlimited` | `ShowcaseSection` | `createSection` |

**A voucher releases its slot when it runs its course** — EXPIRED, ARCHIVED and
REJECTED free it, so a vendor does not have to delete history to create something
new. DRAFT, UNDER_REVIEW, APPROVED, PUBLISHED and PAUSED hold one
(`VOUCHER_SLOT_CONSUMING_STATUSES`).

That makes vouchers the one pool whose usage changes with **no API call behind
it** — the expiry job frees slots in the background — which is why
`expireVouchers` and `reviewVoucher` both recount, and why `expireVouchers` now
also expires the master `Voucher` document and not just its version.

**Banners and promotional tickers are deliberately not gated**: neither model has
a `brandId`, so they are platform-wide admin content, not a per-vendor feature.

### Enforcement is race-free

`reserveSlot` does **not** read-then-write — two concurrent creates would both
see `used < limit` and both pass. The limit test lives inside the update filter,
so Mongo evaluates it and increments in one atomic operation. One generic
implementation (`helpers/brands/entitlementSlots.js`) serves all four pools:

```js
Brand.findOneAndUpdate(
  { _id, isDeleted: false,
    $or: [ { isFranchisesUnlimited: true },
           { $expr: { $lt: ["$franchisesUsed", "$franchisesLimit"] } } ] },
  { $inc: { franchisesUsed: 1 } },
  { new: true },
)
```

No match → nothing incremented → a 403 explaining *why* (plan excludes the
feature, or `used of limit` exhausted).

`releaseSlot` gives the slot back if anything downstream fails, so a transient
OTP outage — or a rolled-back voucher transaction — does not permanently cost a
vendor a slot. `recountBrandUsage` rebuilds every counter from the owning
collections and is the reconciler for any drift.

### Switching outlet type

`PUT /subBrands/update/:subBrandId` with a different `outletType` moves the row
between pools — it is not a cosmetic edit:

1. requires a live subscription
2. atomically `+1` the target pool (same conditional filter) and `-1` the source
3. writes `SubBrand.outletType`
4. step 3 fails → step 2 reverts

Refused with a specific reason when the target pool is full or absent from the
plan.

### Limits follow the plan automatically

`helpers/brands/applyPlanEntitlements.js` is the only writer of the limit
fields. It runs on **activation, renewal, upgrade, downgrade, admin grant,
expiry and cancellation**, and recounts usage first, so a plan change also
repairs drift.

On expiry or cancellation limits go to **0**: nothing new can be created, and
**no existing outlet, franchise, voucher or showcase entry is ever touched**.

### Downgrade overflow policy

| Actor | Behaviour |
|---|---|
| **Vendor** | **Blocked.** 403 naming the counts — "you have 12 outlets but Basic allows 1". |
| **Admin** | **Allowed, grandfathered.** Existing entries stay live, `used` may legitimately exceed `limit`, nothing new until usage drops back under. The response returns `overflow` so the panel can warn. |

Vendor self-downgrade is additionally gated by `allowVendorDowngrade`
(default `false`).

---

## 8. Bugs fixed along the way

Silent data loss — Mongoose `strict` was dropping these writes entirely:

| Written | Schema field | Effect |
|---|---|---|
| `transaction` | `transactionId` | Subscribed → Transaction link never existed |
| `userId` | *absent* | could not query a vendor's subscriptions |
| `offer_id` | `offerId` | Razorpay offer id lost |

Fields read that did not exist: `subscription.discount`, `durationInYears` —
both permanently `undefined`. Now real schema fields.

Security:

- **price tampering** — client-supplied `amount` removed
- **no authorization** — routes ran `verifyJwtToken` only; a computed `isAdmin`
  was never used. Now role-gated + per-brand ownership
- **no idempotency** — a replayed verify minted a second Subscribed doc
- payment/order binding and amount equality now checked

Reliability:

- the whole verify body sat in a try/catch rethrowing `throwError(500, …)`, so
  404 / 400 / 403 all surfaced as 500. Removed.
- invoice failure after capture left money taken and no subscription. Now
  non-blocking.
- `Transaction.notes` was typed `Array` but Razorpay returns an object on
  payments → CastError. Now `Mixed`.
- invoice PDFs were written to `helpers/tmp/` and never deleted. Now OS temp +
  always unlinked.
- `currentScreen` was force-reset on every subscribe.
- `findByIdAndUpdate` without `{ new: true }` returned the pre-update doc, so the
  API reported `isActive: false` on a freshly activated plan.

SubBrands:

- **no subscription gate and no limit check at all** on outlet signup in
  server2.0 — the legacy controller had three checks, 2.0 had none
- `subBrandsUsed` had no writer anywhere; `subBrandsLimit` was never set. Both
  were permanently `undefined`, so even the legacy `limit <= used` test passed
- `updateSubBrand(userId, …)` accepted `userId` and never used it — any user
  could edit any outlet
- `isActive: Joi…default(true)` silently reactivated deactivated outlets on any
  update that omitted the field

---

## 9. Deployment steps — **DONE 2026-08-23**

All three ran in order (entitlements → seller identity → backfill). Kept here
because they must be repeated on any other environment.

```bash
node scripts/setPlanEntitlements.js --apply        # 3 — plan limits first
node scripts/setSubscriptionConfig.js --apply      # 2 — seller identity
node scripts/backfillSubscriptionState.js --apply  # 1 — status + resync
```

Order matters: the backfill calls `syncBrandSubscriptionState`, which reads the
plan's `entitlements`. Setting those first means the backfill applies the right
limits in one pass instead of needing a second resync per brand.

Result on this database:

| | |
|---|---|
| Subscribed docs given a `status` | 17 (7 ACTIVE, 10 UPGRADED) |
| `userId` backfilled | 14 |
| Brands resynced | 7 (4 real, 3 orphaned — see §11) |
| Plans now `entitlementsSource: DB` | 4 / 4 |
| Counter drift corrected | 1 brand (outlets `undefined → 4`, franchises `undefined → 2`) |

### 9.1 Backfill `status` on existing Subscribed docs — **REQUIRED**

`status` is new. Documents written before it existed have no value, and
`getActiveSubscription` matches on `status: ACTIVE` — so a brand with a genuinely
live subscription would read as unsubscribed and every gated action would 403.

State of the database when this was written:

```
subscribeds total      : 17
  with status field    : 0
  would resolve ACTIVE : 7
  with transactionId   : 0     ← confirms the silent-drop bug: the link was never stored
  with userId          : 0     ← same
brands isSubscribed=true : 4   ← but 7 brands actually have a live subscription
subbrands (not deleted)  : 10  ← none counted anywhere
```

```bash
node scripts/backfillSubscriptionState.js            # dry run, writes nothing
node scripts/backfillSubscriptionState.js --apply    # write
```

Idempotent, so it is safe to re-run. It derives `status` from the legacy flags
(`isUpgraded` → UPGRADED, `isExpired` or past `endDate` → EXPIRED, else ACTIVE),
fills `userId` from the brand, then resyncs every affected brand's cached state,
limits and usage counters, and clears any stale `isSubscribed: true` on brands
with no subscription document at all.

### 9.2 Configure the seller identity — **REQUIRED for correct GST**

Until `companyStateCode` is set, every supply is billed as inter-state IGST.
See §2.

### 9.3 Set `entitlements` on the four live plans — **REQUIRED for franchises**

All four resolve as `DERIVED`, and `Franchise: "Yes"` carries no count, so
franchises resolve to 0 and are blocked on Pro Plus, Pro Lite and Advanced.
See §7 and `subscription_future_updates.md` §5.

### 9.4 Optional

- `ENABLE_JOBS=false` in the env to disable the background sweeps.
- The `razorpayOrderId` index cleanup described in §6.

---

## 10. File map

**New**

```
constants/subscription.js
models/{pricingSchema,SubscribedHistory}.js
helpers/settings/getSubscriptionConfig.js
helpers/subscriptions/{resolveEntitlements,index}.js
helpers/subscribeds/{calculatePricing,formatDuration,buildOrderSummary,
                     buildBillingDetails,buildCheckoutPreview,
                     resolveSubscriptionAction,getActiveSubscription,
                     syncBrandSubscriptionState,recordSubscribedHistory,
                     assertActiveSubscription,activateSubscription}.js
helpers/brands/{applyPlanEntitlements,resolveActorBrand}.js
helpers/subBrands/{recountBrandUsage,reserveOutletSlot,releaseOutletSlot,
                   switchOutletType}.js
services/transactions/previewSubscribeOrder.js
services/subscribeds/{adminGrantSubscription,adminCancelSubscription,
                      getBrandSubscription,getAllSubscribeds,
                      getSubscribedHistory,resyncBrandSubscription,
                      expireSubscriptions,index}.js
controllers/transactions/subscribePreview.js
controllers/subscribeds/*
validator/subscribeds.js
routes/subscribeds.js
scripts/backfillSubscriptionState.js
docs/{subscription_lifecycle_design,subscription_future_updates}.md
```

**Modified**

```
index.js                                  jobs/index.js
models/{Setting,Subscription,Subscribed,Transaction,Brand}.js
helpers/{settings,brands,subBrands,subscribeds}/index.js
helpers/transactions/generateAndUploadInvoice.js
services/transactions/{createSubscribeOrder,verifySubscribeTransaction,index}.js
services/subBrands/{signUpSubBrandWithWhatsapp,updateSubBrand}.js
services/settings/updateSetting.js        services/vouchers/index.js
controllers/transactions/*                controllers/subBrands/update.js
validator/{transactions,subscriptions,settings,subBrands}.js
routes/{transactions,subBrands}.js
services/subscriptions/getAllSubscriptions.js
helpers/settings/getSetting.js
```

**Scripts**

```
scripts/setPlanEntitlements.js        # plan limits (dry-run default)
scripts/setSubscriptionConfig.js      # seller identity (dry-run default)
scripts/backfillSubscriptionState.js  # status + resync (dry-run default)
```

---

## 11. Pre-existing data issues found

None of these were created by this work; the new code degrades gracefully around
all of them. Listed because they will surface in admin listings and on invoices.

| # | Issue | Effect | Fix |
|---|---|---|---|
| 1 | Brand `TM-99U5-NRVD-T43E` ("trydood retails pvt ltd") carries the **same GSTIN as the platform** — it is a test vendor built from the company's own registration | When the platform bills that brand, seller GSTIN == buyer GSTIN and the tax splits CGST+SGST. A self-invoice. | Remove or rename that brand before production |
| 2 | Brand `TM-EVVL-RFCH-NJWR` (Advanced ₹2,999, live to 2027-08-14) has **`GSTId`, `PANId` and `locationId` all pointing at hard-deleted documents** | `buildBillingDetails` returns nulls, so its invoice has no address, no GSTIN and no PAN, and it is billed IGST | Re-run its KYC, or retire the brand |
| 3 | Brand `TM-8EB5-FB94-AVLC` has **two verified GST records** — `27…` (Maharashtra) and `29…` (Karnataka), neither deleted. `brand.GSTId` points at the Karnataka one | Invoices use Karnataka. The Maharashtra record is stale and misleading | Decide which is current, soft-delete the other |
| 4 | `vimal ind` has 1 outlet + 1 franchise but **no subscription** | Limits are 0. The two existing entries keep working (grandfathered); nothing new can be added | Grant a plan if it is a real customer |
| 5 | **3 Subscribed docs** (all ACTIVE) and **2 SubBrand rows** point at brands that no longer exist | Harmless — writes against them are no-ops — but they appear in `GET /subscribeds/admin/get-all` | Soft-delete the orphans |
| 6 | 3 Subscribed docs still have **no `userId`** | These are the orphans from #5 — there is no brand to copy it from | Resolved by #5 |

The provider's GST `location` field often repeats a district or road name
("Anna Salai, Anna Salai, Chennai, Chennai"). `buildBillingDetails` strips parts
that duplicate `location` wholesale, but does not rewrite repetition *inside* the
provider's own string — reproducing the registered address verbatim on a tax
invoice is the safer behaviour.

---

## 12. Notification layer

Added because there was none — only two hard-coded OTP mail helpers.

```
models/Notification.js                      brand-scoped, read/unread, dedupeKey
models/DeviceToken.js                       one push destination per app install
helpers/notifications/notify.js             persist first, then email + push
helpers/notifications/notifyAudience.js     the fan-out counterpart of notify()
helpers/notifications/resolveAudience.js    declarative target -> recipients
helpers/notifications/subscriptionNotices.js  one function per event
helpers/nodeMailer/sendMail.js              generic, pooled, never throws
helpers/push/fcmClient.js                   FCM HTTP v1, no firebase-admin
helpers/push/dispatchPush.js                users -> devices, token hygiene
GET /notifications/get-all   ·   PUT /notifications/mark-read
POST /notifications/broadcast               admin, any audience
POST /deviceTokens/register  ·  PUT /deviceTokens/unregister
GET /deviceTokens/get-mine   ·  POST /deviceTokens/test
```

**Persist-first.** The row is always written, then email and push are attempted
and the outcome recorded on that row (`emailSentAt` / `emailError`, and `PUSH`
added to `channels` only when a device actually took it). The in-app bell is the
source of truth, so an SMTP or FCM outage costs a delivery and not the record.
With neither configured both sends are skipped cleanly.

**Fire-and-forget delivery.** Neither email nor push is awaited. `notify()` runs
inside payment verification and the webhook receiver; Gmail takes ~5s per message
and a provider round trip has no business on either path — on a webhook it can
exceed Razorpay's own timeout and trigger a pointless retry. The row is committed
before either is attempted, so the caller already has everything it needs. Only a
short-lived script that would exit first passes `awaitEmail: true`.

**Never throws.** Every caller is a business operation — activation, an admin
grant, the expiry sweep — that must not roll back because a notification failed.

**`dedupeKey`** is a unique sparse index, so a logical event can only ever
produce one row. That is what lets the reminder job run every few hours.

| Event | Type | Fired from |
|---|---|---|
| plan went live | `SUBSCRIPTION_ACTIVATED` / `_RENEWED` / `_UPGRADED` / `_DOWNGRADED` | `activateSubscription` |
| admin granted a plan | `SUBSCRIPTION_GRANTED` | `activateSubscription` |
| 7 / 3 / 1 days left | `SUBSCRIPTION_EXPIRING` | `sendExpiryReminders` job |
| plan lapsed | `SUBSCRIPTION_EXPIRED` | `expireSubscriptions` job |
| admin revoked | `SUBSCRIPTION_CANCELLED` | `adminCancelSubscription` |

---

## 13. Background jobs

`jobs/index.js` — `setInterval`, no cron dependency, one catch-up run on boot,
overlap-guarded, all disabled with `ENABLE_JOBS=false`.

| Job | Interval | Does |
|---|---|---|
| `expireSubscriptions` | `expiryJobIntervalMinutes` (60) | retire lapsed plans, resync brands, notify |
| `expireVouchers` | 60 min | expire versions **and masters**, recount voucher pools |
| `sendExpiryReminders` | `reminderJobIntervalMinutes` (180) | renewal reminders at each offset |
| `releaseStalePromoReservations` | 15 min | reclaim promo holds from abandoned checkouts |

Correctness never depends on any of them running: `getActiveSubscription` expires
a lapsed plan on read, and `recountBrandUsage` repairs counters on the next plan
change or admin resync. A stopped runner delays cleanup rather than letting a
vendor keep paid features.

---

## 14. Razorpay webhook

Verification used to be **client-driven only**: a vendor who closed the tab
between paying and the browser calling back had their money captured and no plan
activated. This closes that.

```
POST /trydood/v1/transactions/webhook/razorpay      (public)
```

### Setup — required

1. Razorpay dashboard → **Settings → Webhooks → Add New Webhook**
2. URL: `https://<host>/trydood/v1/transactions/webhook/razorpay`
3. Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`
4. Copy the webhook secret into the environment:

```
RAZORPAY_WEBHOOK_SECRET=<the secret from the dashboard>
```

> ⚠️ **Without that variable every delivery is rejected.** There is no
> unverified fallback — the endpoint is public, so the signature is the only
> thing authenticating it.

### One settlement path

`helpers/subscribeds/settleSubscriptionPayment.js` is shared by the webhook and
the client verify endpoint. Both arrive with a payment payload whose authenticity
is already established — by the per-payment HMAC in one case, the webhook body
signature in the other — so the money checks, activation, promo commit, invoice
and screen advance exist once rather than twice.

```
client callback  ─┐
                  ├─► settleSubscriptionPayment ─► activate + promo + invoice
webhook          ─┘
```

### Race safety

The browser callback and the webhook routinely land within milliseconds. Rather
than reading `verified` and then writing it — which both callers would pass — the
transaction is **claimed** with a conditional update:

```js
Transaction.findOneAndUpdate(
  { _id, verified: false },          // ← only one caller can match
  { $set: { ...payment, verified: true } },
  { new: true },
)
```

Exactly one wins and activates; the loser is told the plan is already live.
Verified live: two deliveries of the same payment produced **one** Subscribed
document.

### Signature over the raw body

Razorpay signs the untouched bytes, so `JSON.stringify(req.body)` will not match
— key order and whitespace differ. `index.js` keeps the buffer:

```js
app.use(express.json({
  verify: (req, _res, buf) => { if (buf?.length) req.rawBody = buf; },
}));
```

Compared with `crypto.timingSafeEqual`, so the hash cannot be probed byte by
byte.

### Always 200 once the signature is valid

Razorpay retries on any non-2xx, so an event that cannot be acted on is recorded
and acknowledged rather than redelivered forever. **Only a bad signature returns
4xx.** `data.status` says what actually happened:

| Status | Means |
|---|---|
| `PROCESSED` | acted on — activated, failure recorded, or refund recorded |
| `IGNORED` | valid but not ours: unknown order, unhandled event type |
| `DUPLICATE` | Razorpay redelivered an event id already seen |
| `FAILED` | verified but processing threw; stored for replay |

### Stored deliveries

Every verified delivery is written to `WebhookEvent` **before** it is acted on —
`eventId` unique for idempotency, raw `payload` kept so a failed event is
replayable and a disputed payment can be reconstructed from what the gateway
actually sent.

### Event handling

| Event | Effect |
|---|---|
| `payment.captured` · `order.paid` | settle → activate the plan |
| `payment.failed` | record the gateway error, release any promo hold. **Never touches an already-settled transaction** — a later failed attempt cannot undo a live plan |
| `refund.processed` | record `amountRefunded` / `refundStatus` / `isRefunded`. **The subscription is left active** — revoking access is a business decision, so it goes through `PUT /subscribeds/admin/cancel` rather than happening silently |
| anything else | stored and acknowledged, no state change |

Enabling extra events in the dashboard is therefore safe.

### Verified behaviour

| Case | Result |
|---|---|
| bad signature | 400, rejected |
| missing signature header | 400, rejected |
| secret not configured | 400, rejected |
| valid, unknown order | 200 `IGNORED` |
| duplicate event id | 200 `DUPLICATE`, no second activation |
| unhandled event | 200 `IGNORED` |
| correct amount | 200 `PROCESSED`, plan live, invoice issued, vendor notified |
| **short payment** | 200 `FAILED`, transaction stays unverified, **0** Subscribed docs |
| second delivery after settlement | 200 `PROCESSED`, "already settled — no second activation" |

---

## 15. Webhook recovery and disputes

### Why a replay endpoint exists

Razorpay retries a delivery until it gets a 2xx, so the receiver answers 200 even
when processing throws - otherwise the same event is redelivered forever. The
consequence: a genuine failure (a DB blip, a timeout, a bug) leaves the money
captured, the plan not live, and **Razorpay will never send it again**.

Before this the only ways out were asking the vendor to reload the checkout page
or granting the plan by hand.

```
GET  /transactions/webhook/events            # FAILED by default
GET  /transactions/webhook/events/:eventId   # includes the raw payload
POST /transactions/webhook/replay/:eventId
```

`needsAttention: true` is the actionable flag - a FAILED delivery whose
transaction is still unverified, i.e. money in and nothing granted. Those sort to
the top, and `needsAttentionTotal` counts them across the collection for a badge.

**A failed delivery also raises a CRITICAL admin notification**, because nobody
would otherwise know to come and replay it.

### How replay stays safe

`processWebhookEvent` is shared by the receiver and the replay, so a replay is
not a second implementation:

```
receiver -> verify HMAC -> store -> processWebhookEvent
replay   -> admin auth  -> load  -> processWebhookEvent
```

The signature is not re-checked and does not need to be: it was verified when the
delivery was stored, the payload has been immutable since, and the caller is an
authenticated admin.

Idempotency lives one level further down, in `settleSubscriptionPayment`'s
conditional claim on `verified: false` - so replaying an event that has since been
settled reports that instead of activating a second subscription.

Only `FAILED` and `IGNORED` replay by default; re-running a `PROCESSED` one needs
`force: true`. Unlike the receiver, a replay **reports** its failure rather than
swallowing it - the admin is standing right there.

### Verified behaviour

| Case | Result |
|---|---|
| short payment arrives | 200 `FAILED`, txn unverified, **0** Subscribed docs, admin alerted |
| replay while the cause remains | **422** with the real reason |
| replay after the cause is fixed | `FAILED -> PROCESSED`, `recovered: true`, error cleared, **1** Subscribed doc |
| replay again with `force` | "already settled - no second activation", still **1** doc |

### Disputes

A chargeback carries a `respond_by` deadline; miss it and Razorpay closes the
case in the customer's favour automatically. These events used to be acknowledged
and forgotten - the only signal was money leaving the account.

Six events are now handled (`created`, `under_review`, `action_required`, `won`,
`lost`, `closed`), mirrored onto the transaction:

```
isDisputed, disputeStatus, disputeId, disputeAmount, disputeReason,
disputePhase, disputedAt, disputeRespondBy, disputeResolvedAt
```

An open dispute raises a **CRITICAL admin notification** carrying the deadline,
and appears in `GET /transactions/disputes` sorted by `disputeRespondBy`
ascending - the order they must be worked in. `isUrgent` is 2 days or fewer,
`isOverdue` means the deadline has passed. A resolved dispute (`won` / `lost` /
`closed`) clears `isDisputed` and drops out of the worklist.

### Notification email is not on the request path

Gmail takes about 5 seconds per message. `notify()` used to await it, which meant
5s added to a payment-verification response and - via `notifyAdmins` fanning out
to two admins - around 10s on the webhook, past Razorpay's own timeout and enough
to trigger a pointless retry.

The row is still written first and synchronously; only the send is now
fire-and-forget, with the delivery outcome written back onto the row when it
lands. Measured: `notify()` returns in ~1s instead of ~5s, and the webhook
responds in **~700-900ms**.

The transporter also has explicit `connectionTimeout` / `greetingTimeout` /
`socketTimeout`, plus a hard `Promise.race` ceiling - without those nodemailer
waits indefinitely on a blocked SMTP port.

Short-lived callers (a one-shot script that would exit before the send lands)
pass `awaitEmail: true`.

---

## 16. Invoice snapshots

### The problem

The generator read from two places: the frozen `pricing` block, and **live
lookups** for the plan name, the seller identity and the buyer's address.
Anything looked up live can change or disappear, so re-issuing an invoice could
produce a different document than the original. The plan end date printed as `-`
on every re-issue for exactly that reason - the validity dates were never stored
anywhere the generator could reach.

### The fix

Everything an invoice prints is frozen onto the transaction when it is issued:

```
Transaction.invoiceSnapshot = {
  version, issuedAt, invoiceId, transactionRef,
  planName, planType, durationLabel, planStart, planEnd, hsnSacCode,
  seller: { name, legalName, gstin, address, stateCode, state },
  billTo: { name, legalName, gstin, pan, address, stateCode, state, email, contact },
  pricing,                       // duplicated on purpose - see below
  paymentStatus, paymentMethod, isManual, placeOfSupply,
}
```

`generateAndUploadInvoice` now takes **only** the snapshot and performs no
lookups at all. Built in one place, `helpers/transactions/buildInvoiceSnapshot.js`,
so the paid flow and the admin grant cannot produce differently-shaped invoices.

`pricing` is duplicated here even though it already lives on the transaction: an
invoice document-of-record should be self-contained - one read, one source,
nothing to reconcile.

`version` is stamped so a future change to the invoice layout can apply to new
invoices without altering how an old one renders.

### Rendering is separate from uploading

`renderInvoicePdf(snapshot, { compress })` returns a temp file path;
`generateAndUploadInvoice` renders then uploads. Splitting them means the
rendering can be exercised and diffed without touching a storage provider, and
`compress: false` leaves the content stream readable for inspection.

### Legacy transactions

A transaction issued before snapshots existed gets one **backfilled on its first
re-issue** and stored, so it becomes reproducible from then on. Validity dates
are recovered from the `Subscribed` record it activated - the only place they were
ever kept.

The response flags this as `snapshotBackfilled: true`. That first re-issue may
differ from the original (the seller identity or brand address may have moved on
since); every re-issue after it is identical.

### Verified

| Check | Result |
|---|---|
| Renderer references `models/`, `getSubscriptionConfig`, `buildBillingDetails`, or any plan/brand lookup | **none** (static check) |
| `planEnd` present in the snapshot | yes - previously printed as `-` |
| Snapshot round-trip through Mongo | **0** field differences |
| Seller name, GSTIN, address changed; plan renamed and repriced; then re-issued | every snapshot field **unchanged**, `snapshotBackfilled: false` |
| Rendered byte size before vs after those changes | identical |
| Three renders of the same snapshot | identical byte size |
| **Rendered PDF, byte-for-byte** | **identical** - same hash before and after changing seller name, seller GSTIN, seller address, GST rate 18 -> 28, plan name and plan price |
| Control: a *fresh* snapshot under the new settings | different hash, different byte size, total 127,998.72 vs frozen 3,538.82 |

The byte comparison normalises away exactly two things, neither of which is
document content: pdfkit's creation timestamp and the random document `/ID`. Note
that pdfkit stores the date as its **own indirect object** (`/CreationDate 12 0 R`
pointing at `12 0 obj (D:...)`), not inline - so a naive `\/CreationDate \(...\)`
strip misses it and every comparison appears to fail. The control case is what
makes the result meaningful: a genuinely different invoice does produce a
different hash and a different byte size.

---

## 17. Push notifications — a generic service

Built deliberately wider than subscriptions. Customers get an app, and roles get
added; a push layer that assumes "vendor" would have to be rewritten for each.
Nothing in here knows what a subscription is.

```
constants/notification.js     DEVICE_PLATFORMS · AUDIENCE_TARGETS · AUDIENCE_LIMITS
models/DeviceToken.js         userId + role + token, no brand, no vendor assumption
configs/fcm.js                service-account credentials from env
helpers/push/fcmClient.js     JWT -> OAuth -> send, cached token, dead-token codes
helpers/push/dispatchPush.js  userIds -> devices -> send -> token hygiene
helpers/notifications/resolveAudience.js  declarative target -> recipients
helpers/notifications/notifyAudience.js   fan-out: one row per recipient
services/deviceTokens/        register · unregister · getMine · test
services/notifications/broadcastNotification.js
```

### Why not `firebase-admin`

It pulls in tens of megabytes of dependencies for what amounts to one OAuth
exchange and one HTTP POST, and `axios` + `jsonwebtoken` were already here. The
service account's private key signs a short-lived RS256 JWT, that is traded for
an access token, and the token is cached until shortly before it expires so a
burst of pushes does not mint one each.

Setup — from a Firebase service-account JSON (Project settings → Service
accounts → Generate new private key):

```
FCM_PROJECT_ID=<project_id>
FCM_CLIENT_EMAIL=<client_email>
FCM_PRIVATE_KEY="<private_key>"     # multi-line PEM; keep the literal \n escapes
```

The key's `\n` escapes are turned back into real newlines in `configs/fcm.js` —
a key left with literal backslash-n fails signing with an unhelpful error.

**Unconfigured is a supported state.** `isFcmConfigured()` gates every send, and
an unconfigured server returns the same result shape with `skipped: true`. No
caller needs a special case, and no notification is lost — the in-app row is
still written, and `PUSH` is *not* added to `channels`, so the log never claims
a delivery that did not happen.

### Targeting is declarative

A caller describes *who*, never how to find them. Targets **union** together.

| Target | Reaches |
|---|---|
| `userIds` | named users — the "selected users" case |
| `roles` | every active user holding one of those roles |
| `brandIds` | the owning user of each brand |
| `customerIds` | the user behind each customer profile |
| `subBrandIds` | the sub-vendor user of each outlet |
| `all` | everybody active — must be spelled out explicitly |

`filters.hasEmail` narrows further. A role added to `ROLES` becomes addressable
with no change to `resolveAudience` at all.

Every candidate is re-read as a user before it is notified, whether it came from
a role sweep or was named explicitly — a stale, soft-deleted or deactivated id
must not produce a row nobody can ever read. Those are dropped silently rather
than erroring: the caller compares `recipients` against what it sent.

**The 5,000-recipient cap errors, it does not truncate.** A caller that believes
it reached everyone and did not is worse than a failure. Anything wider belongs
in a job.

### One row per recipient

Read state is per person: a broadcast one vendor has read and another has not
cannot be a single document. Each row is labelled with the audience matching that
recipient's *own* role, so a mixed send lands in the right feed for each of them
without the caller splitting it up. `SUB_VENDOR` reads the vendor feed — an
outlet manager with a feed of their own would never see anything.

Inserts are unordered, so one duplicate `dedupeKey` does not abandon the rest of
the batch — which is the entire point of retrying a partly-delivered broadcast.

### Idempotency

Every broadcast carries a `broadcastId`, and rows are keyed
`BROADCAST:<id>:<userId>`. Pass a previous id back and only the recipients who
were missed get a row **and a push** — the push list is narrowed to whoever
actually got a row, because someone skipped as a duplicate has already been
notified once. That makes "did this go out twice?" answerable, and makes a retry
after a partial failure safe rather than a second copy for everyone.

### The token table keeps itself honest

`token` is unique rather than `(userId, token)`. A provider token identifies an
app install, and an install changes hands — a shared phone, a reinstall, a logout
and login as someone else. Registering an existing token therefore **reassigns**
it; without that the previous owner keeps receiving the new owner's
notifications.

| Signal | Response |
|---|---|
| `UNREGISTERED` / `INVALID_ARGUMENT` / `NOT_FOUND` / HTTP 404 | deactivated immediately — permanently gone |
| any other failure (500, quota) | `failureCount` incremented, token kept |
| 5 consecutive soft failures | deactivated |
| a successful send | counter cleared, `lastPushAt` stamped |
| same `deviceId`, new token | the stale row is retired |
| logout | deactivated, not deleted, so delivery history stays explicable |

Rows are only ever deactivated. `getMyDevices` **never returns the raw token** —
it is a bearer credential, so a masked `tokenTail` goes out instead.

`POST /deviceTokens/test` exists because "push isn't working" has half a dozen
causes and guessing between them from outside is miserable: credentials missing
(422), credentials rejected (422), no device registered (404), token stale (200
with `delivered: false`), working (200 with `delivered: true`). It only ever
targets the caller's own devices, and writes no notification row.

### Verified

65 assertions across register / reassign / reinstall / audience resolution /
dry run / mixed-audience broadcast / retry idempotency / dead-token retirement /
soft-failure threshold / counter reset / unconfigured degradation / cross-user
unregister attempt / sign-out-everywhere, plus 10 on `notify()`'s push wiring.
All pass, no leftovers.
