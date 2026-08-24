# Subscription — Future Updates

What is still **deliberately deferred** on the subscription / checkout /
entitlements flow, plus the decisions behind the parts that were closed out.

See [subscription_lifecycle_design.md](./subscription_lifecycle_design.md) for
how the shipped system works.

Last updated: 2026-08-24

---

## Closed out

| # | Item | Outcome |
|---|---|---|
| 1 | Promo codes | **Built** — full feature, see §1 |
| 2 | Proration on upgrade | **Decided against**, forfeits recorded instead — see §2 |
| 3 | Renewal reminders | **Built** — notification layer + job, see §3 |
| 4 | Entitlement gates | **Built** for every gateable feature — see §4 |
| 5 | Plan entitlements on live plans | **Applied** — see §5 |
| 6 | Invoice regeneration | **Built** — `POST /transactions/invoice/regenerate` |
| 7 | Razorpay webhook | **Built** - design doc §14 |
| 8 | Webhook replay + events listing | **Built** - design doc §15 |
| 9 | Dispute / chargeback handling | **Built** - design doc §15 |
| 10 | Shared-password auth hole | **Fixed** - see §7 |
| 11 | Invoice snapshot / reproducibility | **Built** - design doc §16 |
| 12 | Promo quote window + ledger reconciliation | **Built** - see §1 |
| 13 | Push notifications | **Built** — a generic, role-agnostic service, design doc §17 |
| 14 | Admin broadcast to any audience | **Built** — `POST /notifications/broadcast`, design doc §17 |
| 15 | Promo campaign reporting | **Built** — `GET /promoCodes/reports`, see §1 |
| 16 | WhatsApp notification channel | **Built** — awaiting Meta template approval only, see §6 |

---

## 1. Promo codes — DONE

`PromoCode` + `PromoCodeUsage`, admin CRUD under `/promoCodes`, and wiring
through preview → order → verify.

**Stacking.** A promo discount stacks on top of the plan's own discount and
applies to the already-discounted subtotal, never to `listPrice`. GST is charged
on `listPrice − planDiscount − promoDiscount`, so the tax base stays correct:

```
Original Price               ₹ 3,999.00
Promo code (LAUNCH20)       - ₹   799.80
Bill Value                   ₹ 3,199.20      <- GST base
IGST @ 18.00%                ₹   575.86
You'll Pay                   ₹ 3,775.06
```

**Three-step claim**, so an abandoned checkout cannot burn a single-use code:

```
create-order  -> RESERVED   (atomic $expr increment on usedCount)
verify        -> CONSUMED
failure       -> RELEASED   (also swept after 30 min by a job)
```

The counter move is an atomic conditional update, the same pattern the plan
pools use, so a limited code cannot be oversold under concurrent checkouts. The
per-brand cap counts the **ledger** (RESERVED + CONSUMED), not `usedCount`, so a
vendor cannot hold two open orders against a one-per-brand code.

**Soft in preview, strict at order.** An unusable code shows its specific reason
in `promo.message` on the preview so the Apply button can render inline, but
returns **422** from `create-order` — silently charging full price on a code the
vendor believes they applied is not acceptable. Every rejection has its own
message (expired, wrong plan, already used, order too small, …) rather than a
generic "invalid code".

### Late payments: quote window and ledger reconciliation - DONE 2026-08-24

There was a real desync here, not just a policy question.

The discount is frozen onto the transaction at order time, and the reservation is
swept after 30 minutes if the vendor has not paid. Those two were independent, so
a vendor paying at minute 45 got the discount **with nothing recorded against the
code** - understating redemptions and letting `totalUsageLimit` be quietly
exceeded.

`Transaction.promoQuotedUntil` is now set to the same window as the reservation,
so the two cannot drift. An order whose quote has lapsed is also never handed
back by the order-reuse path.

**Why the check is not a 422 at verify.** The original plan was to reject a
lapsed quote during verification. But verification runs *after* the payment is
captured - at the discounted amount - so refusing there would mean money taken
and no plan activated, which is the exact failure the webhook work exists to
prevent. Instead:

- the quoted price is **honoured** (the vendor was quoted it, and already paid it)
- `commitPromoCode` **re-claims** the swept reservation: the RELEASED row is
  flipped back to CONSUMED and `usedCount` re-incremented, so the ledger matches
  the discount actually given
- if that pushes a limited code past its cap, `PROMO_LIMIT_EXCEEDED` is raised to
  the admins. An accurate over-count beats a hidden one, and nothing can be
  undone at that point anyway
- the settle result carries `promo: { quoteLapsed, reconciled, exceededLimit }`
  so the outcome is visible rather than silent

Verified end to end:

| Scenario | Result |
|---|---|
| Vendor pays inside the window | `reconciled: false`, usedCount 1, one CONSUMED row |
| Reservation swept, then vendor pays | `quoteLapsed: true, reconciled: true`, usedCount back to 1, one CONSUMED row |
| Same, on a single-use code nobody else took | reconciled, usedCount 1 = limit, **not** over |
| Same, but another vendor redeemed the last use during the lapse | discount honoured, usedCount 2 / limit 1, `exceededLimit: true`, admin alerted |

The `PromoCodeUsage` unique index on `transactionId` means one claim per
transaction, so reconciliation flips the existing row rather than inserting a
second one - which also preserves when it was reserved and released.

### Still open here

- **`bestOf(planDiscount, promoDiscount)`** instead of stacking, if margins
  cannot absorb both. Would be a one-line change in `calculatePricing`.
- **Campaign reporting** - redemptions by code, by plan, by period. The ledger
  has everything needed; nothing aggregates it yet.
- **A lapsed order is still payable.** `promoQuotedUntil` stops it being reused
  and makes the outcome visible, but the Razorpay order itself stays open, so a
  vendor can still pay late. Cancelling the Razorpay order when the sweep runs
  would close that off properly.

---

### Campaign reporting

`GET /promoCodes/reports` — admin only. Every filter optional: `code` or
`promoCodeId` for one campaign, `from`/`to` for a window, `groupBy=day|month`
for the time series. With none of them it reports on every code over all time.

Two things it deliberately does not do:

**It does not trust `usedCount`.** That counter exists to make the cap check
cheap; the ledger is what happened. Only `CONSUMED` rows are redemptions — a
`RESERVED` row is a checkout still in flight and a `RELEASED` one was abandoned,
and counting either would overstate every campaign. `campaign.usedCount` is
returned alongside so drift between the two is visible rather than hidden.

**It does not recompute prices.** Revenue is read from the transaction's frozen
`pricing.totalPayable`, so raising a plan's price next month cannot retroactively
rewrite what a campaign brought in.

| Field | Means |
|---|---|
| `claims` | every time the code was taken to checkout |
| `redemptions` | claims that were paid for |
| `openReservations` / `abandoned` | in flight / never paid |
| `conversionRate` | redemptions ÷ claims, as a percentage |
| `discountGiven` | what the campaign cost |
| `revenueBeforePromo` | revenue + discount, so the cost is explicit |

Sections: `byCode`, `byPlan`, `byAction`, `overTime`, `topBrands` — all computed
in one `$facet` from the same matched set, so they cannot disagree with the
summary. Each is capped (100 codes, 25 brands, 400 periods); a report is a
report, and a thousand-row table is a data export.

Two joins that needed care:

- The purchase type lives on **`SubscribedHistory`**, not on `Subscribed` —
  which has no `action` field at all. Matched on `transactionId`, so it is the
  history row for the very purchase the promo was applied to.
- That join **excludes `ORDER_CREATED`** and takes a single element rather than
  unwinding. Every paid transaction carries two history rows — one at order
  creation and one at activation — and unwinding both would duplicate the ledger
  row and count its revenue twice.

Verified: 41 assertions against a fixture with known arithmetic — 3 consumed, 1
reserved, 1 abandoned — covering the summary, every breakdown, both groupings,
inclusive date windows, the empty window, the reversed window, an unknown code,
and `usedCount` drift. Breakdowns reconcile with the summary to the paisa.

---

## 2. Proration on upgrade — DECIDED AGAINST, forfeits recorded

Upgrading ends the current plan on the spot and the new term starts from that
date. The remaining days are **forfeited**, the policy states so upfront, and the
checkout preview repeats it as a notice before payment.

No proration, no credit, no refund. What *is* new is that every forfeit is now
measured and recorded, so those vendors can be found later and compensated at the
business's discretion:

| Field | On | Meaning |
|---|---|---|
| `forfeitedDays` | superseded `Subscribed` | whole days given up |
| `forfeitedValue` | superseded `Subscribed` | pro-rata rupee value, from that plan's **taxable** value so a decision is not tangled up with GST |
| `forfeitCompensatedAt` / `forfeitCompensationNote` | superseded `Subscribed` | set once settled |

Also copied onto the `SubscribedHistory` snapshot, so the report can be built
from the audit trail alone.

```
GET /subscribeds/admin/forfeited              # worklist, uncompensated by default
PUT /subscribeds/admin/forfeited/compensate   # stamp one as settled
```

`markForfeitCompensated` is a bookkeeping stamp only — it moves no money and
changes no plan. If the compensation is a free extension, grant it through the
normal `POST /subscribeds/admin/grant` flow and record that in the note.

**If proration is ever wanted**, add a `prorationCredit` field to
`pricingSchema` next to `promoDiscount` rather than folding it into
`discountAmount` — the invoice has to show it as its own line. The open question
that killed it the first time is still open: what happens when the credit exceeds
the new plan's price on a downgrade (refund, wallet, or clamp to zero).

---

## 3. Renewal reminders — DONE

There was no notification layer at all — only two hard-coded OTP mail helpers.
There is now a persisted one.

```
models/Notification.js                  brand-scoped, read/unread, dedupeKey
helpers/notifications/notify.js          persist first, then email
helpers/nodeMailer/sendMail.js           generic, pooled, never throws
services/subscribeds/sendExpiryReminders.js
GET /notifications/get-all   ·   PUT /notifications/mark-read
```

**Persist-first**: the row is always written, then email is attempted and the
outcome recorded on that row (`emailSentAt` / `emailError`). The in-app bell is
the source of truth and an SMTP outage costs a delivery, not the record. With no
SMTP configured the send is skipped cleanly rather than failing.

**Doubly idempotent**, because the job runs every few hours:
`Subscribed.remindersSent` records which offsets have fired (`$addToSet`), and
each notification carries a unique `dedupeKey` per (plan, offset). Offsets come
from `Setting.vendor.subscription.expiryReminderDays` (default `[7, 3, 1]`), and a
brand is matched to the **smallest** offset it has crossed — so a plan expiring in
2 days fires the "3 day" reminder once rather than nothing at all.

Events wired: expiring, expired, activated / renewed / upgraded / downgraded,
admin-granted, cancelled.

### Still open here

- **Push and WhatsApp.** `NOTIFICATION_CHANNELS` reserves both; no provider is
  wired. `notify()` is the single place to add them.
- **Admin-audience notifications.** The `audience: ADMIN` feed exists and is
  readable, but nothing writes to it yet. Natural first use: alert the admin when
  a paying brand lapses, or when a promo code is exhausted.
- **Digest instead of per-event mail.** At current volume one mail per event is
  fine; a daily digest would need batching in `notify()`.

---

## 4. Entitlement gates — DONE for every gateable feature

All four metered pools are enforced by the same atomic reserve / release /
recount machinery:

| Key | Metered from | Gate |
|---|---|---|
| `subBrands` | `SubBrand` outletType OUTLET | `signUpSubBrandWithWhatsapp.js`, `updateSubBrand.js` |
| `franchises` | `SubBrand` outletType FRANCHISE | same |
| `vouchers` | `Voucher` in a live status | `createVoucher.js` |
| `showcase` | `ShowcaseSection` | `createSection.js` |
| `dealPack` | — | flag only; **no domain exists to gate** |
| `prioritySupport` | — | informational; no gate is meaningful |

**Voucher slots are released when a voucher runs its course** — EXPIRED,
ARCHIVED or REJECTED free the slot, so a vendor does not have to delete history
to create something new. That also means voucher usage changes with no API call
behind it, which is why `expireVouchers` and `reviewVoucher` both recount.

**Banners and promotional tickers are deliberately not gated.** Neither model has
a `brandId` — they are platform-wide admin content, not per-vendor, so a vendor
plan limit would be meaningless.

### Still open here

- **`dealPack`** has no domain. When one is built, the flag is already on every
  plan and `assertActiveSubscription(brandId, { feature: "dealPack" })` is the
  one-line gate.
- **A metered voucher-offer or media cap** (as opposed to a voucher-count cap).
  Per-voucher limits already live in `Setting.vendor.voucher`; making them
  plan-tiered would mean resolving `min(planLimit, settingLimit)`.
- **Showcase media** is capped globally by `Setting.vendor.showcase`, not per
  plan. Only the section *count* is plan-metered.

---

## 5. Plan entitlements on the live plans — APPLIED

All four plans resolve as `DB`; nothing is guessed. Values are recorded in
[subscription_lifecycle_design.md](./subscription_lifecycle_design.md) §7 and set
by `node scripts/setPlanEntitlements.js --apply`.

**Voucher allowances** are 10 / 15 / 25 / 50 across Basic → Pro Plus, set
explicitly by the product owner. Because every tier now grants vouchers, the
`Voucher: "No"` display rows Basic and Advanced carried were corrected to the
real number — leaving them would have had the plan card contradict what is
enforced.

⚠️ The gate is new even though the allowance is generous, so a vendor already
over their tier's count will start getting a 403 on **new** vouchers (existing
ones keep working). Check before deploying:

```js
// brands already at or over their voucher allowance
db.brands.find({
  $expr: { $gte: ["$vouchersUsed", "$vouchersLimit"] },
  isVouchersUnlimited: false,
  vouchersUsed: { $gt: 0 },
})
```

**`prioritySupport` is false on Basic and Advanced.** Nothing enforces it, so it
is informational only today.

Judgement calls in that run, worth a second look from the product owner:

- **Pro Lite `Deal Pack`** was `value: "Yes"` with `available: false` —
  contradictory. Read as **enabled**, since Pro Lite (₹3,999) sits above
  Advanced (₹2,999) which grants it.
- **Franchise counts** on Pro Lite (25) and Advanced (10), and **voucher and
  showcase counts** on every tier, were chosen to mirror each plan's outlet
  allowance. The plan data carried no numbers to derive them from.
- **Basic's `features[]` had its two values swapped** versus the confirmed intent
  (`Sub Brand: "01"`, `Franchise: "5"` for a plan granting 5 outlets and 1
  franchise). The display rows were corrected to match what is enforced.

---

## 6. WhatsApp notifications — BUILT, awaiting template approval

The channel is complete and wired. Nothing is left to write — what remains is
getting templates approved by Meta, which is not a code task.

```
configs/whatsapp.js                one approved template per notification type
helpers/whatsapp/sendWhatsApp.js   never throws, skips cleanly, reports why
helpers/notifications/notify.js    third fire-and-forget channel beside email + push
helpers/notifications/subscriptionNotices.js   supplies the template variables
```

Credentials are **shared with OTP** (`TENDIGIT_BASEURL` / `_LICENSE` / `_APIKEY`)
because it is the same provider account. What is not shared is the template: OTP
has one fixed template, while WhatsApp Business needs a separate Meta-approved
template per message type.

### Turning it on

Two gates, both required — either one missing is a clean skip, never an error:

1. `Setting.vendor.subscription.isWhatsAppNotificationEnabled = true`
   (defaults to **false**; set it via `PUT /settings/update`). Off by default on
   purpose: WhatsApp Business charges per message, so it is an explicit opt-in
   rather than something that starts billing the moment a template lands.
2. `WHATSAPP_TEMPLATE_<NOTIFICATION_TYPE>` in the environment, one per type.

That second gate is what makes this shippable before every approval is in:
**templates can be switched on one at a time**, by adding an env var. A type
with no template set still gets its in-app row and its email.

### The template contract

A Meta-approved template has a **fixed** number of positional variables, so the
count and order below are what each template must be written against:

| Env var | Vars | Order |
|---|---|---|
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_ACTIVATED` | 2 | plan, valid till |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_RENEWED` | 2 | plan, valid till |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_UPGRADED` | 2 | plan, valid till |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_DOWNGRADED` | 2 | plan, valid till |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_GRANTED` | 2 | plan, valid till |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_EXPIRING` | 3 | plan, days left, end date |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_EXPIRED` | 2 | plan, end date |
| `WHATSAPP_TEMPLATE_SUBSCRIPTION_CANCELLED` | 1 | plan |

Example body for `SUBSCRIPTION_EXPIRING`:

> Your {{1}} plan ends in {{2}} day(s), on {{3}}. Renew to keep adding outlets,
> vouchers and showcase content.

The brand name is deliberately **not** a variable — these read as addressed to
the vendor ("Your Advanced plan…"), which needs one fewer approved variable and
one fewer thing that can be missing.

### Three things that would have broken real messages

All three were found and fixed while building this, and each would have produced
a message that looked fine in code and wrong on the handset:

- **A comma inside a variable.** Params go to the provider as one
  comma-separated list, so `"Pro, Plus"` or `"₹ 1,299.00"` would split into two
  and shift every variable after it. A thousands separator is now dropped
  (`₹ 1299.00`); any other comma becomes a space.
- **An empty variable.** Dropping it would re-index the rest — the plan name
  landing where the date belongs. Empties become `-` instead.
- **No request timeout.** `fetch` has none by default, so an unreachable
  provider would have held the request open indefinitely. Now aborted at 10s —
  the same failure mode the SMTP client had before its timeouts were added.

### One thing to know about `sent: true`

It means the provider **accepted** the message, not that it reached the handset.
TENDIGIT answers `Success` on acceptance — and it answers that even for a
template name Meta has not approved, with the rejection happening downstream out
of sight. So each template still has to be proved by sending one to a real
number before it is trusted.

### Phone number resolution

`whatsappNumber` on the brand, then on the user, then `mobile` on either. A
business often runs WhatsApp on a different number from the one used to sign in,
and messaging the wrong one reaches nobody. Stored numbers are inconsistent —
`+91…`, `91…`, `0…`, spaced, hyphenated — so all of those normalise to the bare
10 digits the provider expects. Anything else is a clean skip with a stated
reason, because sending the wrong shape fails silently at the provider, which is
the worst kind of failure to debug.

### Verified

24 assertions: live FCM credential probe, a real send whose token Google rejects
(proving JWT → OAuth → send → classify → retire end to end), dead-token
classification, all three WhatsApp gates skipping with the right reason, 9 phone
formats, 5 param-sanitising cases, both channel toggles, `channels[]` never
claiming an undelivered send, and a notification surviving a settings-read
outage.

---

## 7. Decided, not deferred

Two things that look like gaps, are asked about often, and are actually
deliberate. Written down so they are not re-litigated or 'fixed' into a
regression.

### A refund does not revoke the subscription

`refund.processed` records the money and **leaves the plan running**:

```
amountRefunded, refundStatus: COMPLETED, isRefunded, paidRefundAt   <- written
Subscribed.status, Brand.isSubscribed                               <- untouched
```

The webhook says so in its own response — *"Subscription left active — cancel it
explicitly if intended"* — so nobody has to read the source to find out.

Why not revoke automatically: a refund is not one situation. It is a goodwill
gesture, a partial adjustment, a duplicate charge being returned, or a genuine
cancellation, and only the last of those should cost the vendor their plan.
Silently pulling access on a partial refund would be a support incident every
time. The explicit path is `PUT /subscribeds/admin/cancel`, which notifies the
vendor and writes a history row with a reason.

A **chargeback** is treated differently and already is: dispute events set
`isDisputed` and notify admins, because there the money is being taken back
whether we agree or not and someone has to look before the deadline.

If auto-revoke on a *full* refund is ever wanted, the hook is that same branch —
`fullyRefunded` is already computed there.

### A slot is held by existence, not by activation

The rule for every metered bucket — outlets, franchises, vouchers, showcase
sections:

| Event | Slot |
|---|---|
| created | reserved atomically, before the row is written |
| creation fails after reserving | released, so a failed attempt costs nothing |
| `isActive: false` (deactivated) | **still held** |
| soft-deleted (`isDeleted: true`) | released |
| voucher expires or is withdrawn | released by `expireVouchers` |
| plan changed | recounted from the rows, not adjusted |

Deactivation holding its slot is the deliberate half. A deactivated outlet still
exists and can be switched back on in one call; if deactivating freed a slot, a
vendor on a 5-outlet plan could hold twenty outlets and rotate which five are
live. `recountBrandUsage` agrees — it counts `isDeleted: false` and ignores
`isActive` — so the live counters and the reconciler cannot drift apart on this.

**Verified:** the only delete endpoint that exists for a metered bucket is
`DELETE /showcase/section/delete/:sectionId`, and it does release
(`deleteFullSection.js` calls `releaseSlot`). There is no subBrand delete and no
voucher delete endpoint at all, so there is no slot leak to fix today.

When either is added, it needs exactly two things:

- `releaseSlot(brandId, bucket)` after the soft delete — and for an outlet,
  the right bucket, since `OUTLET` and `FRANCHISE` are metered separately
  (`switchSlot` already handles moving between them).
- Nothing else. The reconciler already filters `isDeleted`, so a missed release
  self-heals on the next plan change or admin resync rather than becoming
  permanent.

---

## 8. Smaller items

- **`generateUniqueInvoiceId` collision risk.** 5-digit random over a 90k space
  with a `while (true)` retry. Replace with `models/Counter.js` for a monotonic
  sequence — GST filings prefer gap-free invoice numbers anyway.
- **`DEFAULT_PASSWORD` fallback.** `signUpSubBrandWithWhatsapp` still falls back
  to a literal `"Trydood@123"` when the env var is unset (pre-existing). Should
  be a generated secret or a hard failure.
- **Admin job trigger.** `jobs/index.js` exports `runJobNow(name)` but nothing
  calls it. A small `POST /admin/jobs/run/:name` would let support force a sweep.
- **GST state-code map.** With no brand GSTIN, place of supply falls back to a
  case-insensitive state *name* comparison. A proper `stateCode → name` map would
  make that exact.
- **Multi-currency.** `currency` is threaded through `pricingSchema` and the
  config but only `INR` is permitted, and the GST maths assumes Indian tax.

---

## 9. Shared-password auth hole - FIXED 2026-08-24

Not a subscription item, but it surfaced while auditing this work and was the
single most serious thing found, so it is recorded here.

`loginOrSignUpWithWhatsapp` and `signUpSubBrandWithWhatsapp` created every
VENDOR, CUSTOMER and SUB_VENDOR with the same `DEFAULT_PASSWORD`, and there was
**no change-password, set-password or forgot-password flow anywhere** - so that
one string was a permanent password for every OTP-created account.

On the live database, 36 of 38 accounts held it, and **9 CUSTOMER accounts had an
email set**, which made them reachable:

```
POST /auth/login { type: EMAIL, email: <theirs>,
                   password: <DEFAULT_PASSWORD>, role: CUSTOMER }
-> 200 + token = full account takeover
```

The 12 vendors were safe only because their `User` documents had no email or
mobile - one onboarding write away from being reachable too.

**What changed**

| | |
|---|---|
| `User.password` | now optional; OTP accounts genuinely have none |
| `matchPassword` | returns false instead of throwing when there is no password |
| both signup paths | no longer seed a password |
| email / mobile / username login | refuse an account that never set one |
| `POST /auth/set-password` | first-time set, or change with `currentPassword` |
| `POST /auth/forgot-password` | OTP; **identical response whether or not the account exists**, so it cannot enumerate registered contacts |
| `POST /auth/reset-password` | OTP under a distinct `password-reset` purpose, so a login code cannot be replayed |
| password rule | min 8, max 72 (bcrypt truncates beyond), upper + lower + digit |

`scripts/clearSeededPasswords.js --apply` cleared the 36 existing ones. It only
clears a password `bcrypt.compare` proves is *exactly* the seeded value, so it
cannot lock a legitimate holder out - the 2 real admin passwords were untouched
and still work.

### Still open here

- **Rate limiting.** No middleware limits attempts on `/auth/login`,
  `/auth/forgot-password` or OTP verification. The OTP itself caps verify
  attempts, but nothing caps how many codes can be requested.
- **`passwordSetAt` is not surfaced.** A client cannot currently tell whether to
  show "Set a password" or "Change password" without attempting one.

---

## 10. Cloudinary invoice delivery - RESOLVED 2026-08-24

Invoices uploaded fine but every stored URL returned **401 with zero bytes** -
so no vendor could open the invoice they had been given. Not a `resource_type`
problem (`raw` was blocked too) and not fixable from code: signed delivery and
`private_download_url` both failed as well.

Cause: **Cloudinary Settings -> Security -> "PDF and ZIP files delivery"** was
disabled. Enabling it fixed delivery immediately:

```
GET <invoice url> : 200, application/pdf, 2133 bytes
                    (matches the locally rendered file exactly)
```

### Deferred: invoice access control (moving to S3)

Invoice URLs are currently **public**. Anyone holding the link can read a
vendor's invoice - name, GSTIN, address, amount. Cloudinary URLs are unguessable
but not access-controlled, and they sit in plain text on the transaction.

Deferred deliberately: storage is moving to **AWS S3**, where the natural answer
comes with the platform - keep the bucket private and hand out short-lived
presigned URLs instead of permanent public ones.

When that migration happens:

- `services/uploads/index.js` is the only place that talks to the storage
  provider, so swapping Cloudinary for S3 is contained there.
- `Transaction.invoiceUrl` should then store the **object key**, not a URL, and
  the presigned URL be minted per request - otherwise a stored URL expires and
  the field becomes useless.
- `POST /transactions/invoice/regenerate` already re-renders from the frozen
  snapshot, so it needs no change beyond that.
- The alternative, if presigned URLs are not wanted, is to stream the object
  through an endpoint of our own
  (`GET /transactions/invoice/:transactionId/download`) after an ownership check.
