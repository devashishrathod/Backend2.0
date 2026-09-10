# Trydood WhatsApp templates — complete specification

**42 templates.** Every one with its full body, every variable listed one by one,
and its buttons written exactly as the provider's create-template form asks.

> This document is the **contract with Meta**. A template is approved with a fixed
> number of positional variables and a fixed set of buttons; once approved, none
> of that can change without a fresh submission. So the variable list here is not
> a suggestion — it is what the code must send, in that order.
>
> Sister documents: [`whatsapp_templates.md`](./whatsapp_templates.md) ·
> [`notification_preferences.md`](./notification_preferences.md) ·
> [`customer_app_links.md`](./customer_app_links.md)

---

# Part 0 — Decisions taken

Findings from reading the code that shaped what a template can contain. **All are
now settled** — this section records what was decided and why, so the reasoning
survives.

| # | Finding | Decision |
|---|---|---|
| 1 | Outlet has no name and no address in the snapshot | ✅ **Add `outletType`, `city`, `address`** — purely additive |
| 2 | Transport sends only one dynamic URL variable | ✅ **Two buttons confirmed** — transport will be extended |
| 3 | Brand & subscription notices pass no date | ✅ **Pass date *and* time** everywhere |
| 4 | 10 variables maximum, silently truncated | ✅ Every template ≤ 10 — and **two are now exactly at it** |
| 5 | No comma may appear inside any variable | ✅ Amounts and addresses written without separators |
| 6 | 200 characters per variable, silently cut | ✅ Free-text variables capped by the caller |
| 7 | `DISPUTE_RESOLVED_VENDOR` needs two types | ✅ **Split** into won / lost |
| 8 | `PAYMENT_DISPUTED` names no human | ✅ Pass claim code + brand + phase |
| 9 | `LIMIT_REACHED` needs real new code | ✅ Specified in Part 5.10 |
| 10 | Greeting used a "vendor name" that is not a person | ✅ **`brandName` on every channel — email and WhatsApp both** |
| 11 | Status was a variable on status-specific templates | ✅ **Status is static text** |
| 12 | `Brand.uniqueId` was shown as "Brand ID" | ✅ **`Brand.merchantId` everywhere instead** — §0.12 |
| 13 | Buttons opened lists, not the record the message was about | ✅ **Every button opens its own record** — §0.13 |
| 14 | No way to reach a human from a message | ✅ **Contact Support button → `https://trydood.com/contact`** |
| 15 | `PUBLIC_API_URL` was a temporary hosting address | ✅ **`https://api.trydood.com`** — the 9 document buttons are built against it |
| 16 | A downgrade was documented as having no invoice | 🔴 **Wrong — it is a purchase.** §0.14 |

## 0.12 ✅ Merchant ID, not `uniqueId`

Every `🆔 Brand ID:` row becomes `🆔 Merchant ID:`, reading `Brand.merchantId`
(`TM-A3F9-K2M7-QX41`), and the customer and admin templates carry it inside the
brand field: `Cafe Mocha (TM-A3F9-K2M7-QX41)`.

✅ **Safe to show a customer.** `helpers/vouchers/customerListing.js:1204` already
projects `merchantId` into the customer voucher listing, so this is not a new
exposure — and nothing anywhere authorises on it. It is a reference id.

⚠️ `generateBrandMerchantId` draws its characters from `MERCHANT_ID_SECRET`, so
the **format** is `TM-XXXX-XXXX-XXXX` but the alphabet is not a fixed constant.
Never hand-write one in a fixture — `__tests__` already call the generator for
exactly this reason.

⚠️ Three docs still show the **old** format (`TDM000078`) in sample payloads —
`customer_mobile_api_doc.md`, `vendor_panel_api_doc.md`,
`super_admin_panel_api_doc.md`. Stale, and out of scope here, but they will
mislead anyone matching a sample against production.

## 0.13 ✅ A button opens the record, never a list

**Decided: the button on a notification opens exactly what the notification is
about.** A claim message opens that claim, a refund message opens that refund, a
settlement message opens that settlement.

Two deliberate exceptions:

| Exception | Why |
|---|---|
| `subscription/plans` on #6, #7, #8 | The vendor is **choosing** — a list is the destination |
| `onboarding/status`, `onboarding/review`, `dashboard` | Single pages; there is no record to open |

🔴 **Two path builders do not exist.** `PANEL_PATHS` has `settlement(id)` and
`dispute(id)` but **no `transaction(id)` and no `refund(id)`** — `refund(id)` lives
only in `ADMIN_PATHS`. #18, #24, #25 and #26 need them. See Part 5.13.

⚠️ `PANEL_PATHS.SUBSCRIPTION` is `"subscription"` and `SUBSCRIPTION_PLANS` is
`"subscription/plans"`. The View Subscription button already points at the **first**
one — the vendor's own subscription page, not the plan list. Worth confirming
against the panel's real routing; it is listed in the routes document.

## 0.14 🔴 A downgrade **is** a purchase — the earlier note was wrong

This document previously said *"a downgrade takes no payment, so there is no
invoice"* and gave #4 a single button. That is not what the code does.

`notifySubscriptionActivated` handles NEW, RENEW, UPGRADE and DOWNGRADE through
one function, and builds the download link **unconditionally**:

```js
// helpers/notifications/subscriptionNotices.js:119
const download = invoiceUrl(transaction?.documentToken);
```

`resolveSubscriptionAction` returns DOWNGRADE for a plan the vendor is *buying* at
a lower price — the checkout, the payment and the transaction all happen. So the
document exists, and **#4 gets the same two buttons as an upgrade**.

## 0.10 ✅ `brandName` everywhere — and why that is also *more correct*

**Decided: no template anywhere uses a vendor/person name. Every greeting and
every business reference is `resolveBrandIdentity(brand).brandName`.**

You said we do not have a vendor name. Reading the resolver confirms it, and shows
the old design was worse than just "unavailable":

```js
// helpers/brands/resolveBrandIdentity.js
name      = GST.legalName || brand.brandName || brand.legalBusinessName
            || ownerName || "there"
brandName = brand.brandName || legalName || brand.legalBusinessName || name
```

`name` is **not a person's name at all** — it prefers the **GST legal name**. So
the greeting a vendor actually received would read:

> Hello **ZOMATO PRIVATE LIMITED**,

`brandName` prefers the **trading name** — *"Zomato"* — which is what a vendor
recognises as theirs.

🔴 **And `name` has one path that reaches a real person:** when a brand has no
`brandName`, no `legalBusinessName` and no GST record, it falls through to
`User.name` — the owner's personal name. Dropping `name` removes that path
entirely, so a person's name can never leak into a business message.

⚠️ **Consequence for the body:** the old templates greeted the vendor and *then*
had a `📋 Brand Name:` row — two different values. Now they would be the same
string twice. So every one of those rows is **replaced with `🆔 Brand ID:`**
(`Brand.uniqueId`), which is what support asks for anyway.

## 0.11 ✅ Status is static text, not a variable

**Decided: on a status-specific template the status line is written into the body.**

`brand_approved` can only ever say *Approved*. `customer_payment_success` can only
ever say *Successful*. Making those a variable spends one of ten slots to send a
constant — and creates a way for the message to be **wrong**, because a caller
could pass the wrong label and nothing would catch it.

```
🔎 Status: Approved          ← static text in the body, no variable
```

⚠️ **One deliberate exception:** `customer_refund_requested` **keeps** its status
variable. Refund status genuinely has several customer-facing values and the code
already resolves `REFUND_CUSTOMER_LABEL[request.status]`. See #32.

## 0.1 ✅ The outlet block — Store ID, type, and a real address

You asked for the outlet's **actual address** (not just city), the **Store ID** in
place of the "Outlet" label, and the **store type**. All three are possible. Here
is exactly what exists.

### What the outlet snapshot stores today

```js
// services/voucherClaims/createVoucherClaimOrder.js:294
outletSnapshot: {
  uniqueId: outlet.uniqueId,
  storeId:  outlet.storeId,
  state:    outlet.locationId?.state || null,
}
```

### ✅ It can be widened with **no model change at all**

```js
// models/VoucherClaim.js:35
const claimSnapshotSchema = new mongoose.Schema({}, { _id: false, strict: false });
```

`strict: false` — the snapshot accepts any field. So this is a change to **one
writer**, not to a schema, and every existing reader is untouched because they all
pick named keys (`storeId`, `uniqueId`, `state`) and **nobody spreads the object**:

| Reader | Reads |
|---|---|
| Voucher claim notice (email) | `storeId` |
| Refund notice (email) | `storeId` |
| Invoice / refund / chargeback documents | `storeId` |
| Dispute evidence pack | `storeId` |
| Admin customer detail | `uniqueId`, `state` |

### The new writer

```js
outletSnapshot: {
  uniqueId:   outlet.uniqueId,
  storeId:    outlet.storeId,
  outletType: outlet.outletType || "OUTLET",          // new
  state:      outlet.locationId?.state || null,
  city:       outlet.locationId?.city  || null,       // new
  address:    composeOutletAddress(outlet.locationId), // new
}
```

### Where the address comes from

`SubBrand` has **no address field**. The address lives on the linked `Location`:

| Field | Required? | Note |
|---|---|---|
| `formattedAddress` | ✗ | one ready-to-print string — **preferred** |
| `addressLine1` | ✅ | the only guaranteed one |
| `addressLine2`, `landmark` | ✗ | |
| `city`, `district`, `state`, `country` | ✗ | |
| `zipcode` | ✗ | |

```js
// helpers/notifications/composeOutletAddress.js  (new)
const composeOutletAddress = (location) => {
  if (!location) return null;
  const parts = location.formattedAddress
    ? [location.formattedAddress]
    : [location.addressLine1, location.addressLine2, location.landmark,
       location.city, location.state, location.zipcode];
  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 180) : null;
};
```

⚠️ **Joined with spaces, never commas.** `formattedAddress` from a maps provider
is comma-separated — *"Shop 4, Vijay Nagar, Indore, MP 452010"* — and §0.5 turns
every one of those commas into a space anyway. Joining with spaces up front means
the string you write is the string that arrives, rather than one the transport
quietly rewrote.

⚠️ **Capped at 180, not 200.** The transport cuts at 200 with no ellipsis. An
address that stops mid-word is worse than a short one.

### The query has to widen too

```js
// helpers/vouchers/buildClaimPreview.js:118
  .select("_id uniqueId storeId outletType brandId geo locationId")
  .populate({
    path: "locationId",
    select: "state city formattedAddress addressLine1 addressLine2 landmark zipcode",
  });
```

✅ **Still one query.** The populate already exists — only its `select` grows, so
this costs no extra round trip.

### Store type

`SubBrand.outletType`, enum `FRANCHISE | OUTLET`, default `OUTLET`.

⚠️ **The field is `outletType`, not `storeType`** — binding the name you used
would render empty.

Rendered through a label map: `FRANCHISE → Franchise`, `OUTLET → Outlet`.

### How it renders

```
📍 Store ID: TS-A3F9-K2M7-QX41 · Franchise
🏠 Address: Shop 4 Vijay Nagar Indore MP 452010
```

⚠️ **Store ID and type share one variable.** #18 is at exactly 10 variables; a
separate `Type:` row would be an eleventh, and the eleventh is discarded silently
(§0.4). Both values are still visible, which is what you asked for.

### 🔴 Claims created before this ships

A snapshot is point-in-time and is **never back-filled** — correctly, because it
records what was true then. Older claims have no `address`, `city` or
`outletType`, so the render falls back:

```
address || city || state || "Address not available"
outletType label || "Outlet"
```

⚠️ A template variable must **never** arrive empty — Meta rejects the message and
the rejection happens downstream where nobody sees it. Hence the final literal.

### Why the outlet still cannot be *named*

`SubBrand` has **no** `name`, `outletName`, `displayName`, `storeName` or
`branchName` field. The only identifiers are `storeId` and `uniqueId`. That is
exactly why you asked for the address — with it, the Store ID no longer has to
carry the whole burden of saying *which* outlet.

📌 A real `SubBrand.name` field remains the correct long-term fix. Bigger change
(schema + create/update + backfill), deliberately **not** in scope here.

## 0.2 ✅ Two dynamic buttons — confirmed, and what it needs

Today the entire URL-button surface is one line:

```js
// helpers/whatsapp/sendWhatsApp.js
if (urlParam) url.searchParams.set("URLParam", sanitise(urlParam));
//                                 ^^^^^^^^^^ one key, and `set` overwrites
```

⚠️ **The one thing to confirm with TenDigit before submitting** is the parameter
name for the second button's variable — `URLParam1`/`URLParam2`, an array, or
something else. That is their server's behaviour, not ours.

⚠️ **Do not "work around" it with an array.** `sanitise` does `String(value)`, so
`["a","b"]` becomes `"a,b"` and the comma rule then makes it `"a b"` — one button
silently receives `a b` and nothing errors.

Once the syntax is known, Part 5.11 is a small change: the signature takes a list
instead of a scalar, and line 117 writes one parameter per button.

## 0.3 ✅ Dates — pass them, **with the time**

None of the nine brand notices, and none of the subscription ones, accepts or
computes a date; neither file even imports `formatDateTime`. **Every date variable
in the original templates would render blank today.**

**Decided: every date variable in this document is `formatDateTime` — date *and*
time — not `formatDate`.** The two exceptions are a subscription's start/expiry
and a settlement period, where a time of day is meaningless.

```
📅 Paid On: 07 Sep 2026 08:35 PM
```

⚠️ **IST, always.** `formatDateTime.js` hard-codes `Asia/Kolkata`. Before it
existed, deadlines rendered in the server's timezone — UTC in production — so a
21:30 IST deadline printed as *4:00 pm*. A template must be fed the **formatted
string**, never a `Date`.

The data exists at every call site and is discarded:

| Call site | The timestamp it already holds |
|---|---|
| `verifyVendor.js` | `systemVerify.createdAt` — there is a commented-out `submittedAt:` line |
| `reviewBrandVerification.js` | `result.reviewedAt`, `adminApprovedAt`, `rejectedAt`, `revokedAt` |
| `toggleBrandStatus.js` | `result.performedAt`, `accountActivatedAt`, `accountDeactivatedAt` |

## 0.4 ⚠️ Ten variables, and the eleventh vanishes

```js
params.slice(0, WHATSAPP.maxParams)   // maxParams: 10
```

No error, no log, no `skipped` flag — the message returns `sent: true` with
variables 11+ never having left the process.

🔴 **This ceiling is now actively binding.** After adding outlet details and
timestamps, **#18 and #30 sit at exactly 10**. Anything added to either one has to
displace something already there. Both are annotated with what was dropped and why.

## 0.5 ⚠️ No variable may contain a comma

All variables ride to the provider as **one comma-joined string**, so `sanitise`
deletes digit-commas and turns every other comma into a space:

| Passed | Arrives as |
|---|---|
| `₹1,299.00` | `₹1299.00` |
| `Shop 4, Vijay Nagar, Indore` | `Shop 4 Vijay Nagar Indore` |

Data loss with **no signal**. Every amount here is written without a thousands
separator, and every address is space-joined at source (§0.1). Line breaks collapse
to a single space too — a variable can never carry a list.

## 0.6 ⚠️ 200 characters per variable, cut mid-word

`.slice(0, 200)`, silently, with no ellipsis — and it applies to the button URL
variable too, where a cut token becomes an invalid link while the send still
reports success. Every free-text variable below carries the length the caller must
cap it at.

## 0.7 ✅ `DISPUTE_RESOLVED_VENDOR` splits into two types

One notification type resolves to one env var — `WHATSAPP_TEMPLATE_<TYPE>` — so
**one type can have exactly one template**. Won and lost need different bodies and
different buttons: a lost dispute issues a **chargeback advice document**, a won
one issues nothing, and a template's buttons are fixed at approval.

**Decided:** `DISPUTE_RESOLVED_WON` and `DISPUTE_RESOLVED_LOST`.

## 0.8 ✅ `PAYMENT_DISPUTED` gets the missing joins

As written the alert has **only ObjectIds** — no brand, no outlet, no customer, no
claim code. The claim lookup happens ~80 lines later in the same file. Two fields
already in scope and discarded are exactly what tells a first chargeback from an
escalation: `dispute.phase` and `summary.disputeCount`.

## 0.9 ✅ `LIMIT_REACHED` — specified in Part 5.10

The largest single piece of work here. Six things do not exist; see Part 5.10.

---

# Part 1 — Constraints that shape every template

| Constraint | Value | Consequence |
|---|---|---|
| Category | **Utility** | Transactional. Cheaper than Marketing, and reaches users who opted out of marketing — a payment receipt must not be blocked by a marketing preference |
| Language | `en` | One locale today |
| Max body variables | **10** | Silently truncated beyond |
| Max chars per variable | **200** | Silently truncated |
| Commas in variables | **forbidden** | Converted to spaces |
| Line breaks in variables | **forbidden** | Collapsed to one space |
| Recipients | **India only** | `normalisePhone` accepts 10-digit Indian numbers only |

⚠️ **Positional and order-critical.** The transport has no idea which variable is
which — reordering a template without reordering the code's array is a silent,
invisible break that nothing can detect.

⚠️ **`sent: true` proves nothing.** The provider answers `Success` on acceptance
even for a template name Meta has **not** approved; the rejection happens
downstream, out of sight. Every template must be verified against a real handset.

## 1.1 The four repeating blocks

Written once here, referenced by every template that uses them.

**Brand identity — vendor templates**
```
Hello {{1}},            {{1}} = resolveBrandIdentity(brand).brandName
🆔 Brand ID: {{2}}      {{2}} = Brand.uniqueId
```

**Outlet — vendor templates**
```
📍 Store ID: {{n}}      storeId + " · " + OUTLET_TYPE_LABEL[outletType]
🏠 Address: {{n+1}}     composeOutletAddress(...)  (§0.1)
```

**Outlet — customer templates**
```
🏪 Outlet: {{n}}        brandSnapshot.name
📍 Store ID: {{n+1}}    outletSnapshot.storeId
🏠 Address: {{n+2}}     composeOutletAddress(...)
```
⚠️ The customer gets **no store type** — `Franchise` vs `Outlet` is our internal
taxonomy and means nothing to them. The vendor gets it because they operate both.

**Timestamp**
```
📅 <Event> On: {{n}}    formatDateTime(...)  → "07 Sep 2026 08:35 PM" (IST)
```

---

# Part 2 — The button contract

## 2.1 Two shapes

Every template gets a **platform redirect**. Templates whose event produces a
document also get a **document download** — exactly like the emails.

```
┌─────────────────────────────────┐
│  📄 Download Receipt            │   ← only when a document exists
├─────────────────────────────────┤
│  🔗 View Transactions           │   ← always
└─────────────────────────────────┘
```

## 2.2 ⚠️ Button variables are numbered separately from body variables

The detail that trips people up on the create-template form. A template with 5
body variables and 2 buttons has:

```
Body    : {{1}} {{2}} {{3}} {{4}} {{5}}
Button 1: Website url = {{1}}      ← its OWN {{1}}, not {{6}}
Button 2: Website url = {{1}}      ← also its own {{1}}
```

Your screenshot shows exactly this — both buttons' *Website url* field reads
`{{1}}`, each with its own *Add Sample Text* box.

## 2.3 The document button — one route serves all six documents

```
Base URL : https://<PUBLIC_API_URL>/trydood/v1/documents/
Variable : {{1}}  =  documentToken   (64-char hex)
```

| Document kind | Series | Token lives on | Receives it |
|---|---|---|---|
| `VOUCHER_CLAIM` | `VCH` | `transaction.documentToken` | Customer |
| `SUBSCRIPTION` | `SUB` | `transaction.documentToken` | Vendor |
| `SUBSCRIPTION_GRANT` | `GRT` | `transaction.documentToken` | Vendor |
| `PAYOUT_STATEMENT` | `STL` | `settlement.documentToken` | Vendor |
| `REFUND` | `REF` | `refundRequest.documentToken` | Customer |
| `CHARGEBACK` | `DBN` | `dispute.documentToken` | Vendor |

⚠️ The token is unguessable on purpose — the sequential document number is a
document-of-record and must never appear in a URL.

⚠️ **Never pass a full URL.** Meta approves the base and only the trailing segment
is dynamic; a full URL produces a doubled host at the handset, with no error.

## 2.4 The platform button — per audience

| Audience | Base | Notes |
|---|---|---|
| Vendor | `https://vendor.trydood.com/` | Live |
| Admin | `https://admin.trydood.com/` | Live |
| Customer | `https://app.trydood.com/` | ⚠️ **Does not resolve yet** — see [`customer_app_links.md`](./customer_app_links.md) |

## 2.5 Button text — 25 characters maximum

Every label below is within it; the count is shown.

---

# Part 3 — The complete list

**42 templates.**

| Group | Count |
|---|---:|
| Vendor · subscription | 8 |
| Vendor · brand verification | 5 |
| Vendor · brand status | 4 |
| Vendor · voucher claim | 1 |
| Vendor · plan limit | 1 |
| Vendor · settlement | 4 |
| Vendor · refund | 3 |
| Vendor · dispute | 3 |
| Customer | 9 |
| Admin | 4 |
| **Total** | **42** |

## 3.1 Full index

| # | Template name | Audience | Vars | Buttons |
|---:|---|---|---:|---|
| 1 | `vendor_subscription_activated` | Vendor | 5 | Download Invoice + View Subscription |
| 2 | `vendor_subscription_renewed` | Vendor | 5 | Download Invoice + View Subscription |
| 3 | `vendor_subscription_upgraded` | Vendor | 6 | Download Invoice + View Subscription |
| 4 | `vendor_subscription_downgraded` | Vendor | 5 | Download Invoice + View Subscription |
| 5 | `vendor_subscription_granted` | Vendor | 5 | Download Advice + View Subscription |
| 6 | `vendor_subscription_expiring` | Vendor | 4 | Renew Now |
| 7 | `vendor_subscription_expired` | Vendor | 3 | Renew Now |
| 8 | `vendor_subscription_cancelled` | Vendor | 4 | Subscribe Again |
| 9 | `brand_under_review` | Vendor | 3 | Track Application |
| 10 | `brand_resubmitted` | Vendor | 4 | Track Application |
| 11 | `brand_approved` | Vendor | 3 | Go to Dashboard |
| 12 | `brand_rejected` | Vendor | 4 | Update and Resubmit + Contact Support |
| 13 | `brand_approval_revoked` | Vendor | 4 | Review Details + Contact Support |
| 14 | `brand_deactivated` | Vendor | 5 | Contact Support |
| 15 | `brand_activated` | Vendor | 3 | Sign In |
| 16 | `brand_hidden_from_customers` | Vendor | 4 | Contact Support |
| 17 | `brand_visible_to_customers` | Vendor | 3 | Open Dashboard |
| 18 | `vendor_voucher_claim_received` | Vendor | **10** | View Transaction |
| 19 | `vendor_plan_limit_reached` | Vendor | 7 | Upgrade Plan |
| 20 | `vendor_settlement_paid` | Vendor | 7 | Download Statement + View Settlement |
| 21 | `vendor_settlement_failed` | Vendor | 6 | View Settlement + Contact Support |
| 22 | `vendor_settlement_on_hold` | Vendor | 5 | View Settlement |
| 23 | `vendor_settlement_carried_forward` | Vendor | 6 | View Statement |
| 24 | `vendor_refund_requested` | Vendor | 9 | Review Refund |
| 25 | `vendor_refund_reminder` | Vendor | 7 | Review Refund |
| 26 | `vendor_refund_completed` 🆕 | Vendor | 9 | View Refund |
| 27 | `vendor_dispute_raised` | Vendor | 8 | Open Dispute |
| 28 | `vendor_dispute_resolved_won` 🆕 | Vendor | 5 | Open Dispute |
| 29 | `vendor_dispute_resolved_lost` 🆕 | Vendor | 6 | Download Advice + Open Dispute |
| 30 | `customer_payment_success` | Customer | **10** | Download Receipt + View Order |
| 31 | `customer_payment_failed` | Customer | 7 | Try Again |
| 32 | `customer_refund_requested` | Customer | 8 | Track Refund |
| 33 | `customer_refund_approved` | Customer | 9 | Track Refund |
| 34 | `customer_refund_rejected` | Customer | 8 | View Refund + Contact Support |
| 35 | `customer_refund_completed` 🆕 | Customer | 9 | Download Receipt + View Refund |
| 36 | `customer_refund_bank_details` | Customer | 7 | Add Bank Account + Contact Support |
| 37 | `customer_voucher_refunded` | Customer | 8 | Download Receipt + View Refund |
| 38 | `customer_claim_expired` | Customer | 6 | View Order + Contact Support |
| 39 | `admin_refund_failed` | Admin | 9 | Open Refund |
| 40 | `admin_settlement_ledger_drift` | Admin | 6 | Open Settlement |
| 41 | `admin_payment_disputed` | Admin | 8 | Open Dispute |
| 42 | `admin_dispute_deadline` | Admin | 6 | Open Dispute |

🆕 **Four templates are new and were on no earlier list** — #26, #28, #29, #35.

---

# Part 4 — Every template in full

> ### 🔴 The bodies below are no longer the source of truth
>
> Every template's message text, variable list and buttons now live in
> **`scripts/generateWhatsappTemplateDoc.js`**, which builds the two documents the
> teams actually work from:
>
> | Document | Reader |
> |---|---|
> | `docs/Trydood_WhatsApp_Templates.docx` / `.html` | Whoever creates the templates in the provider's panel |
> | `docs/Trydood_WhatsApp_Button_Paths.docx` / `.html` / `.md` | The web and app teams wiring the destinations |
>
> That generator refuses to build when a body and its variable list disagree, when
> a template exceeds ten variables, when a button label passes 25 characters, when
> a Dynamic button has no `{{1}}`, or when a Contact Support button points anywhere
> but `https://trydood.com/contact`.
>
> **Change a body there, not here.** This section keeps the *reasoning* — why a
> line is worded the way it is, which field it reads, what breaks without it —
> which is the part a generator cannot hold.
>
> ```bash
> node scripts/generateWhatsappTemplateDoc.js --docx
> node scripts/checkTemplateDocsInSync.js
> ```

## Sign-offs

```
VENDOR / ADMIN — every template
  For any assistance, contact us at helpdesk@trydood.com.
  Trydood – Grow Your Business Faster 🚀

CUSTOMER — good news
  For any assistance, contact us at helpdesk@trydood.com.
  Trydood – Save More, Every Time 💚

CUSTOMER — a refund, or something that failed
  For any assistance, contact us at helpdesk@trydood.com.
  Thank you for choosing Trydood 💚
```

⚠️ **The rule produces exactly one "Save More" template today** — #30, the payment
receipt. Every other customer template is a refund or a failure. That is the rule
working, not a mistake — the balance shifts the moment a positive customer template
is added.

### 📌 Marked for the future, not in scope now

| Idea | Why it is parked |
|---|---|
| `Trydood – Great Deals, Near You 💚` sign-off | A discovery pitch. Belongs on marketing-shaped messages, of which there are none yet |
| Per-outlet claim digest | See Part 6 — decided against for now, with the trigger for revisiting |
| A real `SubBrand.name` field | The correct fix for §0.1; larger change |
| WhatsApp for the remaining 11 admin alerts | Panel + email is right for queue work |
| `customer_claim_expired` going live | Inert until redemption splits from payment (Phase 2) |
| A hard turnaround number (*"within N working days"*) | Decided against — #9 uses *"a few working days"*, which never needs resubmitting to Meta |

---

## 4.1 Vendor · Subscription (8)

> The eight bodies are **exactly as you wrote them**, with `{{1}}` now the brand
> name rather than a vendor name.

⚠️ **All eight currently send only 2 variables** (plan, valid till). These bodies
need 3–6. See Part 5.1.

### 1. `vendor_subscription_activated`

```
🎉 Subscription Activated Successfully!
Hello {{1}},
Your Trydood subscription has been successfully activated. ✅
📋 Plan: {{2}}
📅 Start Date: {{3}}
📅 Expiry Date: {{4}}
💰 Amount Paid: ₹{{5}}
Thank you for choosing Trydood! We're happy to have you with us. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Always? |
|---|---|---|---|---|
| `{{1}}` | **Brand name** | `resolveBrandIdentity(brand).brandName` | `Cafe Mocha` | ✅ falls back to `there` |
| `{{2}}` | Plan name | `subscription.name` | `Prime Plus` | ✅ |
| `{{3}}` | Start date | `formatDate(subscribed.startDate)` | `29 Aug 2026` | ⚠️ not passed today |
| `{{4}}` | Expiry date | `formatDate(subscribed.endDate)` | `29 Aug 2027` | ✅ |
| `{{5}}` | Amount paid | `subscribed.paidAmount` | `1999.00` | ⚠️ not passed today |

⚠️ `{{3}}` / `{{4}}` are **date only** — a subscription window has no meaningful
time of day. This is one of the two deliberate exceptions to §0.3.

⚠️ `{{5}}` — the body already prints `₹`, so the variable must **not** include it,
or it renders `₹₹1999.00`. Applies to every amount variable in this document.

**Buttons**

| | Type of action | Button text | URL type | Website url | Sample |
|---|---|---|---|---|---|
| 1 | Visit website | `Download Invoice` (16/25) | Dynamic | `{{1}}` | `a3f9c1e8b2…` |
| 2 | Visit website | `View Subscription` (17/25) | Static | `https://vendor.trydood.com/subscription` | — |

- Button 1 base `https://<PUBLIC_API_URL>/trydood/v1/documents/` · var = `transaction.documentToken`

### 2. `vendor_subscription_renewed`

```
🎉 Subscription Renewed Successfully!
Hello {{1}},
Your Trydood subscription has been successfully renewed. ✅
📋 Plan: {{2}}
📅 Renewal Date: {{3}}
📅 New Expiry Date: {{4}}
💰 Amount Paid: ₹{{5}}
Thank you for continuing with Trydood! 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Plan | `subscription.name` | `Prime Plus` |
| `{{3}}` | Renewal date | call-site `now`, `formatDate` | `29 Aug 2026` |
| `{{4}}` | New expiry | `formatDate(subscribed.endDate)` | `29 Aug 2027` |
| `{{5}}` | Amount paid | `subscribed.paidAmount` | `1999.00` |

**Buttons** — identical to #1.

### 3. `vendor_subscription_upgraded`

```
🎉 Subscription Upgraded Successfully!
Hello {{1}},
Great news! Your Trydood subscription has been successfully upgraded. ✅
📋 Previous Plan: {{2}}
🚀 New Plan: {{3}}
📅 Upgrade Date: {{4}}
📅 Expiry Date: {{5}}
💰 Amount Paid: ₹{{6}}
You can now enjoy the benefits and features included in your new plan. 💚
Thank you for choosing Trydood!
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Previous plan | 🔴 **not passed** — see below | `Pro Lite` |
| `{{3}}` | New plan | `subscription.name` | `Prime Plus` |
| `{{4}}` | Upgrade date | call-site `now` | `29 Aug 2026` |
| `{{5}}` | Expiry date | `subscribed.endDate` | `29 Aug 2027` |
| `{{6}}` | Amount paid | `subscribed.paidAmount` | `1999.00` |

🔴 `{{2}}` — `resolveSubscriptionAction` **knows** the previous plan (it compares
prices to decide UPGRADE), but `notifySubscriptionActivated` receives only the new
one. Needs a `previousPlanName` argument.

**Buttons** — identical to #1.

### 4. `vendor_subscription_downgraded`

```
🔄 Subscription Downgraded Successfully
Hello {{1}},
Your Trydood subscription has been successfully downgraded. ✅
📋 Previous Plan: {{2}}
📉 New Plan: {{3}}
📅 Effective Date: {{4}}
📅 Expiry Date: {{5}}
Your subscription will now continue with the features and benefits available in your new plan.
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Previous plan | 🔴 same new argument as #3 | `Prime Plus` |
| `{{3}}` | New plan | `subscription.name` | `Pro Lite` |
| `{{4}}` | Effective date | call-site `now` | `29 Aug 2026` |
| `{{5}}` | Expiry date | `subscribed.endDate` | `29 Aug 2027` |

**Buttons** — one only. A downgrade takes no payment, so there is no invoice.

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `View Subscription` | Static | `https://vendor.trydood.com/subscription` |

### 5. `vendor_subscription_granted`

```
🎉 Subscription Granted Successfully!
Hello {{1}},
Your Trydood subscription has been granted successfully. ✅
📋 Plan: {{2}}
📅 Start Date: {{3}}
📅 Expiry Date: {{4}}
🎁 Access Type: {{5}}
You can now enjoy the features and benefits included in your subscription. 💚
Thank you for choosing Trydood!
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Plan | `subscription.name` | `Prime Plus` |
| `{{3}}` | Start date | `subscribed.startDate` | `29 Aug 2026` |
| `{{4}}` | Expiry date | `subscribed.endDate` | `29 Aug 2027` |
| `{{5}}` | Access type | `SUBSCRIPTION_SOURCE` **label** | `Complimentary` |

⚠️ `{{5}}` — the raw values are `ADMIN_MANUAL` / `ADMIN_PAYMENT`. Those are enum
names, not words for a vendor. Needs a label map (Part 5.3):
`ADMIN_MANUAL → Complimentary`, `ADMIN_PAYMENT → Paid offline`.

**Buttons** — the document here is a **GRANT ADVICE** (`GRT`), not an invoice.

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Download Advice` (15/25) | Dynamic | `{{1}}` |
| 2 | Visit website | `View Subscription` | Static | `https://vendor.trydood.com/subscription` |

### 6. `vendor_subscription_expiring`

```
⏰ Subscription Expiring Soon!
Hello {{1}},
Your Trydood subscription is expiring soon. ⚠️
📋 Plan: {{2}}
📅 Expiry Date: {{3}}
⏳ Days Remaining: {{4}}
To continue enjoying your subscription benefits without interruption, please renew your plan before the expiry date.
💚 Thank you for being with Trydood!
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Plan | `subscription.name` | `Prime Plus` |
| `{{3}}` | Expiry date | `subscribed.endDate` | `29 Aug 2027` |
| `{{4}}` | Days remaining | `daysRemaining` | `7` |

⚠️ **The order differs from the code today** — it sends `[plan, days, expiry]`,
this template needs `[brandName, plan, expiry, days]`. Positional, and silent if
wrong.

**Buttons** — `Renew Now` (9/25), Static, `https://vendor.trydood.com/subscription/plans`

### 7. `vendor_subscription_expired`

```
⚠️ Subscription Expired
Hello {{1}},
Your Trydood subscription has expired.
📋 Plan: {{2}}
📅 Expiry Date: {{3}}
🔒 Status: Expired
Your subscription benefits are no longer active. Renew your subscription to continue enjoying Trydood features and benefits. 🚀
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Plan | `subscription.name` | `Prime Plus` |
| `{{3}}` | Expiry date | `subscribed.endDate` | `29 Aug 2027` |

⚠️ `🔒 Status: Expired` is **static text** — §0.11.

**Buttons** — `Renew Now`, Static, as #6.

### 8. `vendor_subscription_cancelled`

```
❌ Subscription Cancelled
Hello {{1}},
Your Trydood subscription has been successfully cancelled.
📋 Plan: {{2}}
📅 Cancellation Date: {{3}}
📅 Access Until: {{4}}
🔒 Status: Cancelled
Your subscription benefits will remain available until the access end date mentioned above.
We're sorry to see you go. 💚 You can subscribe again anytime to continue enjoying Trydood benefits.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Plan | `subscription.name` | `Prime Plus` |
| `{{3}}` | Cancellation date | call-site `now` | `07 Sep 2026` |
| `{{4}}` | Access until | `subscribed.endDate` | `29 Aug 2027` |

⚠️ Your mapping note listed `{{3}}` as "Subscription Plan" twice — corrected to
Cancellation Date, which is what the body says.

**Buttons** — `Subscribe Again` (15/25), Static,
`https://vendor.trydood.com/subscription/plans`

---

## 4.2 Vendor · Brand verification (5)

> **Rewritten as you asked.** Changes across all five: the vendor-name greeting is
> now the brand name; the redundant `📋 Brand Name:` row is replaced with
> `🆔 Brand ID:` (`Brand.uniqueId`); every date carries **the time**; and the
> status line is explicit static text.
>
> ⚠️ **Every date variable here is empty today** — §0.3.

### 9. `brand_under_review`

```
🔍 Your Brand Is Under Review
Hello {{1}},
We have received your brand details and our team has started verifying them. ✅
🆔 Brand ID: {{2}}
📅 Submitted On: {{3}}
🔎 Status: Under Review
📄 What happens next: our team checks your GST, PAN and bank details.
⏳ Most reviews are completed within a few working days.
You do not need to do anything right now — we will message you the moment the review is complete. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` |
| `{{3}}` | Submitted on | `formatDateTime(systemVerify.createdAt)` | `07 Sep 2026 04:12 PM` |

⚠️ *"You do not need to do anything right now"* is load-bearing. Without it a
vendor resubmits, which increments `verificationAttemptCount` and puts them back
in the queue behind themselves.

> ### ✅ The turnaround line — decided: *a few working days*, no number
>
> The vendor's first question is **how long**, and a message that does not answer
> it produces the support ticket anyway. But a number could not be used:
>
> - **No SLA exists anywhere in the code** — it would be hardcoded prose.
> - **An approved Meta template cannot be edited.** Changing `1–2 days` to `3–4`
>   means submitting a **new** template and waiting for approval, with the old one
>   still sending in the meantime.
> - **It becomes a written promise.** The vendor has it on WhatsApp; on day three
>   they send it back to support.
>
> *"Most reviews are completed within a few working days"* answers the question,
> commits to no number, and **never has to change**.
>
> ⚠️ It is **static text, not a variable** — so it costs nothing against the ten
> (§0.11) and cannot be sent wrong.

**Buttons** — `Track Application` (17/25), Static,
`https://vendor.trydood.com/onboarding/status`

### 10. `brand_resubmitted`

```
🔄 Updated Details Received
Hello {{1}},
Thank you — we have received your updated brand details and they are back with our verification team. ✅
🆔 Brand ID: {{2}}
📅 Resubmitted On: {{3}}
🔁 Attempt: {{4}}
🔎 Status: Under Review
⏳ Most reviews are completed within a few working days.
Your earlier submission has been replaced by this one. There is nothing further to send.
We will message you as soon as the review is complete. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` |
| `{{3}}` | Resubmitted on | `formatDateTime(...)` | `07 Sep 2026 06:40 PM` |
| `{{4}}` | Attempt number | `Brand.verificationAttemptCount` | `2` |

⚠️ `{{4}}` is a real field on `Brand` and is the reason this template earns its
fourth variable — it is the only thing that distinguishes this message from #9 on
a vendor's screen.

⚠️ **The turnaround line is repeated here on purpose.** #9 and #10 are the same
waiting state, and a vendor who resubmits would otherwise lose the one piece of
information that stops them chasing. Static text in both, identical wording — if
you want it only on #9, this is the line to delete.

> **Your question (whatsapp_templates.md line 88):** *"resubmit to brand khud
> karta hai — ye bhi vendor ko jaata hai kya? Admin ko jaana chahiye."*
>
> **Both already happen, as two different types.** `BRAND_RESUBMITTED` is the
> vendor's *acknowledgement*; `BRAND_AWAITING_RE_REVIEW` is the admin's *queue
> alert*. Your instinct is right and it is already built — and you marked the admin
> one *"no need"* for WhatsApp, so only the vendor acknowledgement gets a template.

**Buttons** — `Track Application`, Static, as #9.

### 11. `brand_approved`

```
🎉 Your Brand Is Approved!
Hello {{1}},
Great news — your brand has been verified and approved on Trydood. ✅
🆔 Brand ID: {{2}}
📅 Approved On: {{3}}
🔎 Status: Approved
You can now sign in and start selling:
🏪 Add your outlets
🎟️ Create your vouchers
💳 Choose a subscription plan to go live
Welcome to Trydood. We're glad to have you. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` |
| `{{3}}` | Approved on | `formatDateTime(result.adminApprovedAt)` | `08 Sep 2026 11:20 AM` |

⚠️ The three next-step lines are **static**, not variables. They are the same for
every brand, and a vendor who is approved but does not know a subscription is
required simply never goes live.

**Buttons** — `Go to Dashboard` (15/25), Static, `https://vendor.trydood.com/dashboard`

### 12. `brand_rejected`

```
📋 Brand Verification Update
Hello {{1}},
We were not able to verify your brand with the details provided.
🆔 Brand ID: {{2}}
📅 Reviewed On: {{3}}
🔎 Status: Not Approved
📝 Reason: {{4}}
This is not final. Please correct the details above and resubmit — your application stays open and nothing has been deleted.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` | — |
| `{{3}}` | Reviewed on | `formatDateTime(result.rejectedAt)` | `08 Sep 2026 11:20 AM` | — |
| `{{4}}` | Reason | `Brand.rejectionReason` | `The GST certificate is registered to a different legal name than the PAN.` | **180** |

⚠️ `{{4}}` is free text an admin types. `Brand.rejectionReason` has a
`maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH` — **which is larger than
200**, so the transport will cut it. Cap at 180 at the call site: the transport
cuts at 200 mid-word with no ellipsis, and a rejection reason that stops
mid-sentence is worse than a short one. Commas become spaces (§0.5).

⚠️ *"This is not final"* is deliberate. A rejection with no stated way forward
produces a support ticket instead of a resubmission.

**Buttons** — `Update and Resubmit` (19/25), Static,
`https://vendor.trydood.com/onboarding/review`

### 13. `brand_approval_revoked`

```
⚠️ Brand Approval Withdrawn
Hello {{1}},
Your brand's approval on Trydood has been withdrawn.
🆔 Brand ID: {{2}}
📅 Withdrawn On: {{3}}
🔎 Status: Approval Withdrawn
📝 Reason: {{4}}
Your vouchers are no longer available to customers while this is in place.
Nothing has been deleted. Please review the details above and resubmit, or contact us if you believe this is a mistake.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` | — |
| `{{3}}` | Withdrawn on | `formatDateTime(result.revokedAt)` | `08 Sep 2026 11:20 AM` | — |
| `{{4}}` | Reason | `Brand.revokeReason` | `The GST registration has been cancelled at the portal.` | **180** |

⚠️ **The consequence line matters more than the reason.** A revoked approval stops
vouchers reaching customers — a vendor who is not told that reads a drop in
business as a platform bug and opens a ticket about the wrong thing.

**Buttons** — `Review Details` (14/25), Static,
`https://vendor.trydood.com/onboarding/review`

---

## 4.3 Vendor · Brand status (4)

> **Rewritten as you asked** — same four changes as §4.2: brand name in the
> greeting, `Brand ID` in place of the duplicated brand-name row, date **with
> time**, and an explicit static status line. Plus, in each case, a line saying
> **what actually stops or starts working** — which is the part a vendor needs and
> the original bodies did not have.

### 14. `brand_deactivated`

```
🔒 Account Deactivated
Hello {{1}},
Your Trydood vendor account has been deactivated.
🆔 Brand ID: {{2}}
📅 Deactivated On: {{3}}
🔎 Status: Deactivated
📝 Reason: {{4}}
👁️ Customer Visibility: {{5}}
What this means: you cannot sign in to the vendor panel while this is in place.
Your outlets, vouchers and settlement records are all safe and nothing has been deleted.
Please contact us and we will help you resolve it.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` | — |
| `{{3}}` | Deactivated on | `formatDateTime(result.accountDeactivatedAt)` | `08 Sep 2026 03:05 PM` | — |
| `{{4}}` | Reason | `Brand.accountDeactivationReason` | see below | **180** |
| `{{5}}` | **Customer visibility** | `hiddenFromCustomers` flag — see below | `Hidden from customers` | — |

⚠️ **The "what this means" line is the point.** Deactivation flips
`User.isActive` — the vendor loses panel access. Their brand may still be visible
to customers, because that is a *separate* switch (`Brand.isActive`, #16). A vendor
told only *"deactivated"* cannot tell which of the two happened.

> ### ✅ `{{5}}` — why a variable rather than a sentence
>
> An admin can flip **both** switches in one call, and the notice already knows:
>
> ```js
> // services/brands/toggleBrandStatus.js:364
> notifyBrandDeactivated({
>   brand: brandForNotice,
>   reason: result.reason,
>   hiddenFromCustomers: !result.isVisibleToCustomers,   // ← already passed
> })
> ```
>
> A template body is fixed, so *"and your brand is also hidden"* cannot be
> conditional prose — it has to be a variable:
>
> | `hiddenFromCustomers` | `{{5}}` renders |
> |---|---|
> | `true` | `Hidden from customers` |
> | `false` | `Still visible to customers` |
>
> ⚠️ Without this the vendor cannot tell the two apart, and *"still visible"* is
> the more surprising of the two — their vouchers keep selling while they cannot
> sign in. That is deliberate platform behaviour, and a vendor who does not know it
> reports it as a bug.

> ### ✅ `{{4}}` — decided: send the admin's reason, with a default
>
> The field **already exists**. `PUT /brands/admin/:brandId/status` accepts an
> optional `reason` (max 1000 chars, refused when *activating*), stores it on
> `Brand.accountDeactivationReason`, clears it on reactivation, and keeps the full
> trail in `BrandStatusHistory`.
>
> | Admin's input | `{{4}}` renders |
> |---|---|
> | A reason was written | that reason, capped at 180 |
> | Left blank | `Please contact support for details.` |
>
> ### 🔴 This field is written staff-to-staff today
>
> Until now this reason was never shown to a vendor, so admins write for other
> admins:
>
> ```
> suspected fake GST, flagged by ops team, verify before reactivating
> ```
>
> That will now go to the vendor verbatim. **The admin panel needs a line under
> that input** — agreed, and it is front-end work, not backend:
>
> > ⚠️ *This reason is sent to the vendor by email and WhatsApp.*
>
> Without it, the first vendor to read an internal note is how we find out.

**Buttons** — `Contact Support` (15/25), Static, `https://vendor.trydood.com/support`

### 15. `brand_activated`

```
✅ Account Reactivated
Hello {{1}},
Good news — your Trydood vendor account is active again.
🆔 Brand ID: {{2}}
📅 Reactivated On: {{3}}
🔎 Status: Active
Everything is exactly as you left it — your outlets, vouchers and settlement records are all intact.
🔐 Please note: you will need to sign in again, as your earlier sessions were closed.
Welcome back. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` |
| `{{3}}` | Reactivated on | `formatDateTime(result.accountActivatedAt)` | `09 Sep 2026 10:15 AM` |

⚠️ **The sign-in-again line must stay.** Every session is ended on reactivation. A
vendor who taps the button and lands on a login screen with no warning reads it as
still broken.

**Buttons** — `Sign In` (7/25), Static, `https://vendor.trydood.com/dashboard`

### 16. `brand_hidden_from_customers`

```
👁️ Brand Hidden From Customers
Hello {{1}},
Your brand is temporarily not being shown to customers on Trydood.
🆔 Brand ID: {{2}}
📅 Hidden On: {{3}}
🔎 Status: Hidden From Customers
📝 Reason: {{4}}
What this means: your brand page, directory listing and showcase are not visible to customers right now.
Your vendor panel still works normally and nothing has been deleted.
Please contact us and we will help you resolve it.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` | — |
| `{{3}}` | Hidden on | `formatDateTime(result.performedAt)` | `08 Sep 2026 03:05 PM` | — |
| `{{4}}` | Reason | ✅ `Brand.accountDeactivationReason`, else default | `Please contact support for details.` | **180** |

> ### ✅ `{{4}}` — decided: the deactivation reason when there is one
>
> **Rule:** if the account is currently deactivated, show
> `Brand.accountDeactivationReason`. Otherwise show the default.
>
> | Account state when hidden | `{{4}}` renders |
> |---|---|
> | Deactivated | that brand's `accountDeactivationReason`, capped at 180 |
> | Active | `Please contact support for details.` |
>
> ### 🔴 The case you would expect never reaches this template
>
> Hiding **together with** a deactivation does **not** send this notice. One call
> sends at most one notice, and the account switch wins:
>
> ```js
> // services/brands/toggleBrandStatus.js:361
> if (result.accountChanged) {
>   notice = result.isActive
>     ? await notifyBrandActivated(...)
>     : await notifyBrandDeactivated({ ..., hiddenFromCustomers: !result.isVisibleToCustomers });
> } else if (result.visibilityChanged) {
>   notice = await notifyBrandCustomerVisibilityChanged(...);
> }
> ```
>
> That combined case is #14, which already carries the reason and now also carries
> `{{5}}` saying the brand was hidden. **So #16 only ever fires in two situations**,
> and the rule above covers both:
>
> | Situation | Account | Where the reason comes from |
> |---|---|---|
> | Already-deactivated brand, hidden afterwards | ❌ off | `accountDeactivationReason` — still on the document from that deactivation ✅ |
> | Active brand, hidden on its own | ✅ on | nothing exists → default |
>
> ✅ **Reactivation clears the field** (`toggleBrandStatus.js:171` sets
> `accountDeactivationReason: null`), so a live account can never show a stale
> reason from a suspension that ended.
>
> ### ⚠️ Two traps in implementing it
>
> 1. **A `reason` sent on a visibility-only call is silently discarded.** Validation
>    accepts it — line 93 only refuses a reason when *activating* — but line 153's
>    `if (accountChanges)` never runs, so it is written to neither the brand nor the
>    history row (`reason: isAccountAction ? reason || null : null`). Always read the
>    stored field, never the call's argument.
> 2. **The notice is not given either value today.** `brandForNotice` is
>    `{_id, brandName, uniqueId, merchantId}` and the brand `select` on line 109
>    does not include `accountDeactivationReason`. Both need adding — Part 5.2.

⚠️ The *"your vendor panel still works"* line is the counterpart to #14's. These
two switches are independent and vendors conflate them constantly.

**Buttons** — `Contact Support`, Static, as #14.

### 17. `brand_visible_to_customers`

```
🎉 Brand Visible to Customers Again!
Hello {{1}},
Good news — your brand is being shown to customers on Trydood again. ✅
🆔 Brand ID: {{2}}
📅 Restored On: {{3}}
🔎 Status: Visible to Customers
Your brand page, directory listing and showcase are all live again, exactly as they were.
Nothing was deleted while it was hidden. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Brand ID | `Brand.uniqueId` | `BR482910` |
| `{{3}}` | Restored on | `formatDateTime(result.performedAt)` | `09 Sep 2026 10:15 AM` |

⚠️ Deliberately **no reason variable** — being restored needs no explanation.

⚠️ *"Nothing was deleted while it was hidden"* is kept because it is the question a
vendor actually has.

**Buttons** — `Open Dashboard` (14/25), Static, `https://vendor.trydood.com/dashboard`

---

## 4.4 Vendor · Voucher claim (1)

### 18. `vendor_voucher_claim_received` — 🔴 **exactly 10 variables**

```
💰 New Voucher Claim at Your Outlet
Hello {{1}},
A customer has just paid at your outlet through Trydood. ✅
🎟️ Voucher: {{2}}
🎁 Offer Applied: {{3}}
🏷️ Promo Code: {{4}}
📍 Store ID: {{5}}
🏠 Address: {{6}}
🧾 Claim Code: {{7}}
📅 Paid On: {{8}}
💰 Bill Amount: ₹{{9}}
💚 You Will Receive: ₹{{10}}
🔎 Status: Payment Successful
This amount will be included in your next settlement.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Always? |
|---|---|---|---|---|
| `{{1}}` | Brand name | `resolveBrandIdentity(brand).brandName` | `Cafe Mocha` | ✅ |
| `{{2}}` | Voucher name | `claim.voucherSnapshot.name` | `Luxury Stay Special` | ⚠️ fallback `A voucher` |
| `{{3}}` | Offer applied | composed — see below | `20% off up to ₹200` | ⚠️ `No offer` |
| `{{4}}` | Promo code | `claim.promoCode` | `MONSOON20` | ⚠️ `—` when none |
| `{{5}}` | **Store ID + type** | `storeId · OUTLET_TYPE_LABEL[outletType]` | `TS-A3F9-K2M7-QX41 · Franchise` | ✅ |
| `{{6}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` | ⚠️ new claims only |
| `{{7}}` | Claim code | `claim.claimCode` | `TD-CLM-9001` | ✅ |
| `{{8}}` | **Paid on** | `formatDateTime(claim.paidAt)` | `07 Sep 2026 08:35 PM` | ✅ |
| `{{9}}` | Bill amount | `claim.pricing.billAmount` | `1000.00` | ✅ |
| `{{10}}` | Vendor payable | `claim.pricing.vendorPayable` | `700.00` | ✅ |

> ### 🔴 This template is at the ceiling
>
> 10 of 10. **Anything added here displaces something already present** — and the
> eleventh variable is discarded with no error (§0.4).
>
> Two things were merged rather than dropped, to fit everything you asked for:
>
> - **Store ID and type share `{{5}}`.** A separate `🏬 Type:` row would be the
>   eleventh. Both values still render.
> - **`Outlet:` was removed as a label**, per your instruction — the brand name is
>   already the greeting, so repeating it in an outlet row was spending a row on a
>   value the reader has just seen.
>
> `🔎 Status:` is static text (§0.11) — it costs nothing and cannot be wrong.

> ### How `{{3}}` is composed, and the trap inside it
>
> There is no single "discount percentage" field. It lives in two places:
>
> ```js
> claim.pricing.offerDiscountValue + claim.pricing.offerDiscountType
> claim.offerSnapshot.discountValue + claim.offerSnapshot.discountType
> ```
>
> 🔴 **Read `pricing`, never `offerSnapshot`.** `offerSnapshot` is written whenever
> an offer was *resolved* — **even one that computed a zero discount**. A template
> built from it will advertise *"20% off"* on a claim where nothing came off the
> bill. `claim.offerApplied` / `pricing.offerDiscount > 0` is the truth.
>
> ```
> PERCENTAGE with a cap  →  "20% off up to ₹200"
> PERCENTAGE, no cap     →  "20% off"
> FLAT / FIXED           →  "₹150 off"
> nothing applied        →  "No offer"
> ```
>
> ⚠️ `FIXED` and `FLAT` are the same thing — `FIXED` is an alias kept for stored
> data. Handle both.

⚠️ 🔴 **Never spread `claim.pricing` into a template.** `platformPromoCost` and
`commissionAmount` sit in the same block — those are our margin.

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `View Transactions` (17/25) | Static | `https://vendor.trydood.com/transactions` |

⚠️ The **list**, not a single transaction — per your requirement, so the URL is
static and needs no variable.

📌 **Volume note:** a brand taking 50 claims a day gets 50 paid WhatsApp messages.
Decided to ship per-claim for now — see Part 6.

---

## 4.5 Vendor · Plan limit (1)

### 19. `vendor_plan_limit_reached` 🆕

```
🚦 Plan Limit Reached
Hello {{1}},
You have reached the {{2}} limit on your {{3}} plan.
📊 Used: {{4}} of {{5}}
🚀 On {{6}} you get: {{7}}
Upgrade your plan to keep adding without interruption.
Everything you have already created stays exactly as it is. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Which limit | `BUCKET_LABELS[bucket]` | `vouchers` |
| `{{3}}` | Current plan | `subscription.name` | `Pro Lite` |
| `{{4}}` | Used | `summarizeUsage().used` | `10` |
| `{{5}}` | Current limit | `resolveEntitlements(current)` | `10` |
| `{{6}}` | Suggested plan | `findUpgradeOptions()[0].name` | `Prime Plus` |
| `{{7}}` | New limit | `resolveEntitlements(next)` | `50 vouchers` |

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Upgrade Plan` (12/25) | Dynamic | `{{1}}` |

- Base `https://vendor.trydood.com/subscription/plans/` · var = the `planId` of `{{6}}`
- 🔴 **That route does not exist yet** — `PANEL_PATHS` has no per-plan builder.

> ### 🔴 Read Part 5.10 before approving this one
>
> ⚠️ The one that will embarrass us: **a pricier plan can grant fewer of the thing
> the vendor ran out of.** The four pools are independent and nothing enforces
> monotonicity. The suggestion must be filtered on the **bucket**, not on price —
> otherwise `{{6}}` offers an upgrade that does not fix `{{2}}`.
>
> ⚠️ `{{4}}` reads a **cached counter** known to drift (`recountBrandUsage` exists
> to fix it, and logs when it does). *"10 of 10 used"* being wrong is wrong in the
> one direction a vendor notices.

---

## 4.6 Vendor · Settlement (4)

### 20. `vendor_settlement_paid`

```
💸 Payout Sent to Your Bank
Hello {{1}},
Your Trydood payout has been sent to your bank account. ✅
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Amount: ₹{{4}}
🏦 Account: {{5}}
🔖 Bank Reference (UTR): {{6}}
📅 Sent On: {{7}}
🔎 Status: Paid
Funds usually reflect within 24 hours depending on your bank.
Thank you for growing with Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | **Brand name** | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Settlement number | `settlement.settlementNumber` | `TD/STL/26-27/000123` |
| `{{3}}` | Period | `formatDateRange(periodStart, periodEnd)` | `1 Aug 2026 – 31 Aug 2026` |
| `{{4}}` | Net payable | `settlement.netPayable` | `4523.75` |
| `{{5}}` | Account | `bankSnapshot.accountLast4Digits` | `ending 7890` |
| `{{6}}` | UTR | ⚠️ **PayoutLeg, not Settlement** | `HDFCN52026090412345` |
| `{{7}}` | **Sent on** | `formatDateTime(leg.paidAt)` | `05 Sep 2026 02:40 PM` |

⚠️ **The UTR is the entire point of this message.** Without it, *"we paid you"* and
*"we did not pay you"* look identical on a bank statement.

⚠️ `{{6}}` is **not on Settlement** — an admin types it into
`PATCH /settlements/admin/:id/confirm-payout`, and it is persisted on `PayoutLeg`.
Money can move in several legs, which is exactly why one field on the settlement
would lose one. The notice already receives it as a parameter.

⚠️ `{{3}}` is a **date range with no time** — the second deliberate exception to
§0.3 — and uses an en-dash, never a comma (§0.5). `{{7}}` is the moment money left,
which does carry a time.

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Download Statement` (18/25) | Dynamic | `{{1}}` |
| 2 | Visit website | `View Settlements` (16/25) | Static | `https://vendor.trydood.com/settlements` |

- Button 1 var = `settlement.documentToken` (`PAYOUT_STATEMENT`, `STL`)
- ⚠️ The token is minted **only when the settlement becomes PAID** — which is
  exactly when this fires, so it is always present here.

### 21. `vendor_settlement_failed`

```
⚠️ Payout Could Not Be Completed
Hello {{1}},
Your Trydood payout was returned by the bank.
🧾 Settlement No: {{2}}
💰 Amount: ₹{{3}}
🏦 Account: {{4}}
📝 Reason: {{5}}
📅 Attempted On: {{6}}
🔎 Status: Payout Failed
We are on it. Please check that the account above is still open and the details are correct.
Your money is safe and will be paid once this is resolved. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Settlement number | `settlement.settlementNumber` | `TD/STL/26-27/000123` |
| `{{3}}` | Amount | `settlement.netPayable` | `4523.75` |
| `{{4}}` | Account | `bankSnapshot.accountLast4Digits` | `ending 7890` |
| `{{5}}` | Reason | 🔴 **raw enum today** | `Beneficiary account closed` |
| `{{6}}` | **Attempted on** | `formatDateTime(leg.failedAt)` | `05 Sep 2026 02:40 PM` |

🔴 `{{5}}` renders `BANK_REJECTED` — a raw enum. **There is no label table for
`SETTLEMENT_FAILURE_REASON` anywhere.** One is needed before this ships (Part 5.3);
a vendor reading `BANK_REJECTED` learns nothing they can act on.

⚠️ Never `failureNote` — that is written staff-to-staff.

**Buttons** — `View Settlement` (14/25), Static, `https://vendor.trydood.com/settlements`

### 22. `vendor_settlement_on_hold`

```
⏸️ Payout On Hold
Hello {{1}},
Your Trydood payout is being reviewed before it goes out.
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Amount: ₹{{4}}
📅 On Hold Since: {{5}}
🔎 Status: On Hold
Nothing is lost. It will either be released or carried into your next payout.
Our team will complete the review shortly. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Settlement number | `settlement.settlementNumber` | `TD/STL/26-27/000123` |
| `{{3}}` | Period | `formatDateRange(...)` | `1 Aug 2026 – 31 Aug 2026` |
| `{{4}}` | Amount | `settlement.netPayable` | `4523.75` |
| `{{5}}` | **On hold since** | `formatDateTime(settlement.heldAt)` | `05 Sep 2026 09:00 AM` |

⚠️ **No detail variable, deliberately.** What is being checked is usually a
disputed payment or an unresolved refund; naming it turns a two-day delay into an
argument about a chargeback nobody has ruled on yet. Support explains when asked —
that is a conversation with a person in it, not a WhatsApp template.

**Buttons** — `View Settlement`, Static.

### 23. `vendor_settlement_carried_forward`

```
📋 No Payout This Cycle
Hello {{1}},
There is no payout for this settlement period.
🧾 Settlement No: {{2}}
📅 Period: {{3}}
💰 Sales This Period: ₹{{4}}
↩️ Refunds Deducted: ₹{{5}}
⚖️ Chargebacks Deducted: ₹{{6}}
🔎 Status: Carried Forward
Your deductions came to more than this period's sales, so there is nothing to pay out.
The remaining balance carries into your next settlement and comes off future sales.
There is nothing to pay us and nothing you need to do. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Settlement number | `settlement.settlementNumber` | `TD/STL/26-27/000123` |
| `{{3}}` | Period | `formatDateRange(...)` | `1 Aug 2026 – 31 Aug 2026` |
| `{{4}}` | Sales | `settlement.grossCollected` | `3200.00` |
| `{{5}}` | Refund adjustment | passed in | `2450.00` |
| `{{6}}` | Chargeback adjustment | passed in | `1200.00` |

⚠️ **No timestamp here, deliberately** — no money moved. The period is the fact
that matters, and it is already `{{3}}`.

⚠️ **Only the shortfall case gets a message.** *"Below the ₹500 minimum, it rolls
over"* is routine and stays silent — sending it would train vendors to ignore the
one that matters.

⚠️ 🔴 **The closing lines cannot vary in a template.** The email branches between
*"the remaining ₹450 carries forward"* and *"it came to exactly this period's
sales, nothing carries forward"* — a template body is fixed. This wording covers
the **shortfall** case only, so **the caller must not send this template when
`netPayable === 0`**, or it says something untrue.

⚠️ *"There is nothing to pay us"* is load-bearing. The reading people jump to is
that they now owe money.

**Buttons** — `View Statement` (14/25), Static, `https://vendor.trydood.com/settlements`

---

## 4.7 Vendor · Refund (3)

> ### The money in a refund, and why three numbers are not a contradiction
>
> | Field | Meaning | Example |
> |---|---|---|
> | `requestedAmount` | What the customer asked for | ₹810 |
> | `approvedAmount` | What was approved | ₹810 |
> | `split.totalRefund` | **What the customer gets back** | ₹810 |
> | `split.vendorClawback` | **What comes off the vendor's payout** | ₹700 |
> | `split.commissionDeductionReversal` | Commission credited back to the vendor | ₹110 |
> | `split.gatewayFeeAbsorbed` | Razorpay's cut — **our loss**, not the vendor's | ₹18 |
>
> **₹810 = ₹700 + ₹110.** The vendor is docked only their share; the commission we
> took on that sale is returned to them. Showing all three is what stops the
> *"why ₹700 and not ₹810?"* ticket.
>
> ### 🔴 And why the request template cannot show any of it
>
> `split` is **absent until the refund is approved and executed**. At request time
> `approvedAmount` and `split` do not exist. Estimating is worse than omitting: if
> an admin partially approves ₹400 of ₹810, a vendor told "₹700 will be deducted"
> is then docked ₹350 — the calculation drifting is exactly the failure to avoid.
>
> So #24 shows the requested amount only, and the real figures arrive in **#26**.

> ### 🔴 All three need the claim, and two do not have it
>
> ```js
> notifyVendorRefundRequested({ request, claim })   // ✅ claim passed
> notifyVendorRefundReminder({ request })           // 🔴 no claim
> // vendor_refund_completed                        // 🔴 does not exist at all
> ```
>
> `RefundRequest` carries `claimCode` but **no voucher name and no outlet** — only
> `claimId`. Every enrichment you asked for on these three comes from the claim, so
> the claim has to travel with them. See Part 5.5.

### 24. `vendor_refund_requested`

```
↩️ Refund Requested
Hello {{1}},
A customer has requested a refund on a claim at your outlet.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Amount Requested: ₹{{6}}
📝 Customer's Reason: {{7}}
📅 Requested On: {{8}}
⏳ Please Respond By: {{9}}
🔎 Status: Awaiting Your Response
If nobody responds by then, the decision passes to the Trydood team.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | **Voucher name** | `claim.voucherSnapshot.name` | `Luxury Stay Special` | — |
| `{{3}}` | Claim code | `request.claimCode` | `TD-CLM-9001` | — |
| `{{4}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` | — |
| `{{5}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` | — |
| `{{6}}` | Amount requested | `request.requestedAmount` | `810.00` | — |
| `{{7}}` | Customer reason | `request.reasonNote \|\| request.reason` | `Outlet was closed when I reached.` | **150** |
| `{{8}}` | **Requested on** | `formatDateTime(request.createdAt)` | `08 Sep 2026 07:15 PM` | — |
| `{{9}}` | Respond by | `formatDateTime(request.vendorRespondBy)` | `09 Sep 2026 09:30 PM` | — |

⚠️ **`{{8}}` and `{{9}}` together are the point.** A deadline with no start is just
pressure; showing both lets the vendor see how long they actually have.

⚠️ `{{9}}` — **IST, with the time.** Until recently every deadline rendered in the
server's timezone (UTC in production), so a 21:30 IST deadline printed as
*"4:00 pm"*. A template must be fed the formatted string, never a `Date`.

⚠️ **Voucher + Store ID + Address are what make this actionable.** The old body
said *"a claim at TS-A3F9-K2M7-QX41"* — an outlet operator with four locations had
to look the code up before they could even ask their staff about it.

**Buttons** — `Review Refund` (13/25), Static, `https://vendor.trydood.com/dashboard`

### 25. `vendor_refund_reminder`

```
⏳ Refund Still Waiting on You
Hello {{1}},
A refund request at your outlet is still waiting for your decision.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
💰 Amount: ₹{{5}}
⏳ Respond By: {{6}}
⌛ Time Left: {{7}}
🔎 Status: Awaiting Your Response
If nobody responds by then, the decision passes to the Trydood team.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | **Voucher name** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{3}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{4}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` |
| `{{5}}` | Amount | `request.requestedAmount` | `810.00` |
| `{{6}}` | Respond by | `formatDateTime(request.vendorRespondBy)` | `09 Sep 2026 09:30 PM` |
| `{{7}}` | **Time left** | computed: `vendorRespondBy − now` | `4 hours` |

⚠️ **No address here, deliberately.** A reminder is the second message about the
same claim — the Store ID is enough to recognise it, and `{{7}}` earns the slot
instead. *"Respond by 9:30 PM"* and *"4 hours left"* are read very differently.

🔴 **The reminder job passes no claim.** `refundJobs.js:419` calls
`notifyVendorRefundReminder({ request: claimed })`. `{{2}}` and `{{4}}` need the
claim — see Part 5.5 for the batched lookup, so this does not become one query per
request inside a loop.

**Buttons** — `Review Refund`, Static.

### 26. `vendor_refund_completed` 🆕 — **new, and it closes a real gap**

```
↩️ Refund Completed
Hello {{1}},
A refund on one of your sales has been completed.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Refunded to Customer: ₹{{6}}
📉 Deducted From Your Payout: ₹{{7}}
♻️ Commission Returned to You: ₹{{8}}
📅 Completed On: {{9}}
🔎 Status: Refund Completed
Only your share of the sale is deducted — the commission we charged on it is returned to you.
This will appear on your next settlement statement.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | **Voucher name** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{3}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{4}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` |
| `{{5}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` |
| `{{6}}` | Refunded to customer | `split.totalRefund` | `810.00` |
| `{{7}}` | Deducted from payout | `split.vendorClawback` | `700.00` |
| `{{8}}` | Commission returned | `split.commissionDeductionReversal` | `110.00` |
| `{{9}}` | **Completed on** | `formatDateTime(request.completedAt)` | `10 Sep 2026 01:05 PM` |

> ### 🔴 Why this did not exist
>
> **The vendor is never told what a refund actually costs them.** Both existing
> refund notices print `requestedAmount` only, so a vendor approves ₹810 and is
> later docked ₹700 **with no message having ever named that figure**. The whole
> `split` subdocument — eleven money fields — is unrendered anywhere.
>
> They find out from *"Less: refunds deducted"* on a statement, which is a number
> with no story attached.

⚠️ ✅ **The three numbers must add up on screen** — `{{6}} = {{7}} + {{8}}` — and
the sentence under them says why. That is the whole point of this template; a
partial approval must use the **approved** figures, never the requested one.

⚠️ **No document button.** The refund receipt belongs to the **customer** (#35);
issuing it to the vendor would put a customer's receipt in a vendor's hands.

**Buttons** — `View Settlements` (16/25), Static, `https://vendor.trydood.com/settlements`

⚠️ Deliberately the **settlements** screen, not the refund — this message is about
money leaving their payout, and the statement is where that will appear.

---

## 4.8 Vendor · Dispute (3)

### 27. `vendor_dispute_raised`

```
⚖️ Chargeback Raised on Your Sale
Hello {{1}},
A customer's bank has pulled back a payment on one of your sales.
🎟️ Voucher: {{2}}
🧾 Claim Code: {{3}}
📍 Store ID: {{4}}
🏠 Address: {{5}}
💰 Amount: ₹{{6}}
📝 Reason: {{7}}
⏳ We Must Respond By: {{8}}
🔎 Status: Under Dispute
This payment is held out of your payouts until it is settled — it is not lost.
We are contesting it with the payment and redemption records we hold.
If you have anything from that visit — a bill or KOT number, a camera timestamp, what the staff remember — adding it helps.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` | — |
| `{{2}}` | **Voucher name** | `claim.voucherSnapshot.name` | `Luxury Stay Special` | — |
| `{{3}}` | Claim code | passed in | `TD-CLM-9001` | — |
| `{{4}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` | — |
| `{{5}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` | — |
| `{{6}}` | Amount | `dispute.amount` | `810.00` | — |
| `{{7}}` | Reason | 🔴 `dispute.reason` — **never rendered today** | `Product not received` | **120** |
| `{{8}}` | Respond by | 🔴 `dispute.respondBy` — **never rendered today** | `13 Sep 2026 11:59 PM` | — |

🔴 **Both `{{7}}` and `{{8}}` are new.** Today an outlet is told money was pulled
back **without being told what the customer claimed**, and is invited to supply
evidence **without being told by when it would still matter**. Both fields exist on
the dispute and reach `meta` only.

⚠️ **Voucher + address matter more here than anywhere.** The message asks the
outlet to remember a specific visit. *"Did anyone come in for the Luxury Stay
Special at Vijay Nagar on the 7th?"* is a question staff can answer;
*"TS-A3F9-K2M7-QX41"* is not.

⚠️ *"Invites, not demands."* Filing never waits on the outlet — a dispute gets one
response and the deadline is the bank's. Telling them their reply is required would
be untrue, and would make a silent outlet feel responsible for a loss it did not
cause.

**Buttons** — `Open Dispute` (12/25), Static, `https://vendor.trydood.com/disputes`

### 28. `vendor_dispute_resolved_won` 🆕 split type — §0.7

```
✅ Chargeback Decided in Your Favour
Hello {{1}},
Good news! The bank has ruled in our favour on a disputed sale.
🧾 Claim Code: {{2}}
📍 Store ID: {{3}}
💰 Amount: ₹{{4}}
📅 Resolved On: {{5}}
🔎 Status: Decided in Your Favour
The money stays yours. The payment is being released back into your payouts — you will see it in an upcoming settlement.
Thank you for your patience. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Claim code | passed in | `TD-CLM-9001` |
| `{{3}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` |
| `{{4}}` | Amount | `dispute.amount` | `810.00` |
| `{{5}}` | **Resolved on** | `formatDateTime(dispute.resolvedAt)` | `07 Sep 2026 03:22 PM` |

⚠️ **The hold does not lift by itself** — an admin has to release it. Saying *"we
won"* and then not paying for another week is worse than saying nothing, so the
copy says *"an upcoming settlement"* rather than promising a date.

**Buttons** — `View Settlements` (16/25), Static, `https://vendor.trydood.com/settlements`

### 29. `vendor_dispute_resolved_lost` 🆕 split type — §0.7

```
⚖️ Chargeback Upheld
Hello {{1}},
The bank has ruled for the customer on a disputed sale.
🧾 Claim Code: {{2}}
📍 Store ID: {{3}}
💰 Amount: ₹{{4}}
📄 Advice No: {{5}}
📅 Resolved On: {{6}}
🔎 Status: Upheld for the Customer
Your share of that sale will be deducted from an upcoming payout, shown on your statement as "chargebacks recovered".
Only your share is deducted — our fee and our part of any promotion are not.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Brand name | `identity.brandName` | `Cafe Mocha` |
| `{{2}}` | Claim code | passed in | `TD-CLM-9001` |
| `{{3}}` | **Store ID + type** | `claim.outletSnapshot` | `TS-A3F9-K2M7-QX41 · Franchise` |
| `{{4}}` | Amount | `dispute.amount` | `810.00` |
| `{{5}}` | Advice number | `dispute.documentNumber` | `TD/DBN/26-27/000004` |
| `{{6}}` | **Resolved on** | `formatDateTime(dispute.resolvedAt)` | `07 Sep 2026 03:22 PM` |

⚠️ **This is the message that stops a deduction appearing from nowhere.** Without
it, *"Less: chargebacks recovered"* on a statement is a number with no story.

⚠️ *"Only your share is deducted"* matters — the full disputed amount includes our
fee and our half of any promo, and a vendor assuming the whole ₹810 comes off will
dispute the statement.

⚠️ 🔴 **A third case must not use this template.** A dispute lost on a sale that was
**never settled** deducts nothing, and this body would be untrue. The notice already
knows via `recoverable` — the caller must branch and stay silent, or send a variant.

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Download Advice` (15/25) | Dynamic | `{{1}}` |
| 2 | Visit website | `Open Dispute` (12/25) | Static | `https://vendor.trydood.com/disputes` |

- Button 1 var = `dispute.documentToken` (`CHARGEBACK`, `DBN`)

---

## 4.9 Customer (9)

> **Every customer template now carries the outlet** — brand, Store ID and address —
> so the customer can confirm it was the right place, exactly as you asked. The
> customer never sees the store **type**; that is our taxonomy (§1.1).
>
> ⚠️ Every customer button lands on `app.trydood.com`, which **does not resolve
> yet** — see [`customer_app_links.md`](./customer_app_links.md).

### 30. `customer_payment_success` — the receipt · sign-off **A** · 🔴 **exactly 10 variables**

```
✅ Payment Successful
Hello {{1}},
Your payment went through. 🎉
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🏠 Address: {{4}}
🎟️ Voucher: {{5}}
🧾 Claim Code: {{6}}
📅 Paid On: {{7}}
💰 Bill Amount: ₹{{8}}
💚 You Saved: ₹{{9}}
💳 Amount Paid: ₹{{10}}
🔎 Status: Payment Successful
Show your claim code at the counter if asked.
Your receipt is available below — keep it for your records.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Save More, Every Time 💚
```

| Var | Meaning | Source | Example | Always? |
|---|---|---|---|---|
| `{{1}}` | Customer name | `resolveCustomerName` cascade | `Priya` | ⚠️ see below |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` | ⚠️ fallback `the brand` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` | ✅ |
| `{{4}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` | ⚠️ new claims only |
| `{{5}}` | Voucher | `claim.voucherSnapshot.name` | `Luxury Stay Special` | ⚠️ fallback |
| `{{6}}` | Claim code | `claim.claimCode` | `TD-CLM-9001` | ✅ |
| `{{7}}` | **Paid on** | `formatDateTime(claim.paidAt)` | `07 Sep 2026 08:35 PM` | ✅ |
| `{{8}}` | Bill amount | `claim.pricing.billAmount` | `1000.00` | ✅ |
| `{{9}}` | You saved | `claim.pricing.youSaved` | `190.00` | ✅ |
| `{{10}}` | Amount paid | `claim.pricing.totalPayable` | `810.00` | ✅ |

✅ `{{8}} − {{9}} = {{10}}` — the arithmetic is visible and must hold.

> ### 🔴 This template is at the ceiling — and `Offer Applied` was dropped to fit
>
> Adding Store ID and Address made 11. Rather than merge rows, **`🎁 Offer
> Applied:` was removed**, because:
>
> - `💚 You Saved: ₹190` already states the outcome — the offer name states the
>   *mechanism*, which the customer chose at checkout minutes earlier.
> - The **receipt document** (button 1) carries the full offer breakdown.
>
> The **vendor** keeps its offer and promo rows (#18) because a vendor is
> reconciling *why* their payout differs from the bill — a question the customer
> does not have.
>
> `🔎 Status:` is static text (§0.11).

⚠️ `{{1}}` — **there is no guaranteed customer name.** `Customer.fullName` is
optional and `customerSnapshot` is absent if the lookup missed. Use the same cascade
the invoice uses: `name → whatsappNumber → a bare word`.

⚠️ **Payment method dropped.** It exists (`transaction.paymentMethod`) but at 10
variables there is no room, and the customer's own bank SMS already says how they
paid.

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Download Receipt` (16/25) | Dynamic | `{{1}}` |
| 2 | Visit website | `View Orders` (11/25) | Static | `https://app.trydood.com/orders` |

- Button 1 var = `transaction.documentToken` (`VOUCHER_CLAIM`, `VCH`)
- ⚠️ Exactly your screenshot's shape: one dynamic, one static list.

### 31. `customer_payment_failed` — sign-off **C**

```
⚠️ Payment Could Not Be Completed
Hello {{1}},
Your payment did not go through.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🏠 Address: {{4}}
🎟️ Voucher: {{5}}
💰 Amount: ₹{{6}}
📅 Attempted On: {{7}}
🔎 Status: Payment Failed
🔒 Nothing has been charged to your account.
If money was deducted, your bank will return it automatically within 5–7 working days.
You can try again from the app.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Address** | `composeOutletAddress(...)` | `Shop 4 Vijay Nagar Indore MP 452010` |
| `{{5}}` | Voucher | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{6}}` | Amount | `claim.pricing.totalPayable` | `810.00` |
| `{{7}}` | **Attempted on** | `formatDateTime(transaction.updatedAt)` | `07 Sep 2026 08:35 PM` |

⚠️ **The gateway reason was dropped.** It is not stored anywhere on the transaction,
so it would have to be threaded from the webhook payload — and *"The bank declined
the UPI mandate"* tells the customer nothing they can act on that *"try again"* does
not. The slot went to the outlet block instead, which is what you asked for.

⚠️ *"Nothing has been charged"* is the whole message. Everything else is context.

⚠️ The auto-refund line is deliberate: an authorised-but-uncaptured payment is
auto-refunded by Razorpay after about five days, which a customer otherwise
experiences as money silently taken.

**Buttons** — `Try Again` (9/25), Dynamic, base `https://app.trydood.com/vouchers/`,
var = `claim.voucherId`

### 32. `customer_refund_requested` — sign-off **C**

```
↩️ We Have Your Refund Request
Hello {{1}},
We have received your refund request and asked the outlet about it.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount: ₹{{6}}
📅 Requested On: {{7}}
🔎 Status: {{8}}
We will let you know as soon as there is an answer.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Amount | `request.requestedAmount` | `810.00` |
| `{{7}}` | **Requested on** | `formatDateTime(request.createdAt)` | `08 Sep 2026 07:15 PM` |
| `{{8}}` | Status label | `REFUND_CUSTOMER_LABEL[request.status]` | `Refund requested` |

⚠️ **`{{8}}` stays a variable** — the one exception to §0.11. Refund status has
several customer-facing values and the code already resolves the label.

⚠️ 🔴 **It must be the label, never the raw status.** `VENDOR_TIMEOUT` becomes
*"Under review by Trydood"*. Telling a customer the outlet ignored them starts a
fight the platform then has to referee, and it is not something they can act on.

⚠️ **No address here** — the Store ID plus brand identifies the visit, and the
customer already knows where they were. The slot went to the status label, which is
the thing this message exists to convey.

🔴 `notifyCustomerRefundRequested({ request })` receives **no claim** — `{{2}}`,
`{{3}}` and `{{4}}` need it. Part 5.5.

**Buttons** — `Track Refund` (12/25), Static, `https://app.trydood.com/refunds`

### 33. `customer_refund_approved` — sign-off **C**

```
✅ Your Refund Is Approved
Hello {{1}},
Good news — your refund has been approved.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Requested: ₹{{6}}
💚 Amount Approved: ₹{{7}}
🏦 Refund Method: {{8}}
📅 Approved On: {{9}}
🔎 Status: Approved
It should reach your account in 5–7 working days.
We will message you again once it has been sent.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Requested | `request.requestedAmount` | `810.00` |
| `{{7}}` | Approved | `request.approvedAmount` | `400.00` |
| `{{8}}` | Method | ⚠️ `request.method`, **not** `refundMethod` | `Back to your original payment method` |
| `{{9}}` | **Approved on** | `formatDateTime(request.approvedAt)` | `09 Sep 2026 11:40 AM` |

⚠️ **9 variables** — one under the cap.

⚠️ **Both amounts, always.** A customer who asked for ₹810 and quietly receives ₹400
opens a second request and a support ticket. Showing them together is why this
template is one of the larger ones.

⚠️ `{{8}}` — the schema path is `request.method` (`SOURCE` | `MANUAL_BANK`). **A grep
for `refundMethod` returns nothing** — binding that name renders empty. Needs a label
map (Part 5.3): `SOURCE → Back to your original payment method`,
`MANUAL_BANK → To your bank account`.

⚠️ *"We will message you again once it has been sent"* is a promise **#35 keeps**.
Do not ship this template without that one.

**Buttons** — `Track Refund`, Static.

### 34. `customer_refund_rejected` — sign-off **C**

```
📋 About Your Refund Request
Hello {{1}},
Your refund request was not approved.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Requested: ₹{{6}}
📅 Decided On: {{7}}
🔎 Status: Not Approved
If you think that is wrong, write to us and we will look at it ourselves.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Amount | `request.requestedAmount` | `810.00` |
| `{{7}}` | **Decided on** | `formatDateTime(request.decidedAt)` | `09 Sep 2026 11:40 AM` |

⚠️ 🔴 **The vendor's note must never appear here.** *"Customer collected the order in
full"* is written staff-to-staff; rendered to the customer it is about, it is an
accusation. There is deliberately **no reason variable**.

⚠️ A decline has to leave a way through. *"Declined"* with no next step produces the
support ticket anyway, only angrier.

**Buttons** — `Contact Support` (15/25), Static, `https://app.trydood.com/support`

### 35. `customer_refund_completed` 🆕 — sign-off **C**

```
💚 Your Refund Has Been Sent
Hello {{1}},
Your refund has been processed and sent to your account. ✅
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Refunded: ₹{{6}}
📄 Refund No: {{7}}
🔖 Bank Reference: {{8}}
📅 Sent On: {{9}}
🔎 Status: Refund Completed
It should reflect in your account within 5–7 working days depending on your bank.
Quote the bank reference above if you need to check with them.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `request.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Amount refunded | `request.approvedAmount` | `810.00` |
| `{{7}}` | Refund document no | `request.documentNumber` | `TD/REF/26-27/000012` |
| `{{8}}` | Bank reference | `request.utr` | `HDFCR52026090498765` |
| `{{9}}` | **Sent on** | `formatDateTime(request.completedAt)` | `10 Sep 2026 01:05 PM` |

⚠️ **9 variables** — one under the cap.

> ### 🔴 Why this did not exist and must
>
> **No refund-completed notification exists at all.** The customer is told
> *"approved, 5–7 working days"* and then **never hears that the money actually
> left**. And that moment — `applyRefundCompletion` — is exactly when the credit
> note's `documentNumber`, `documentToken` and snapshot are written. **So the
> document is issued and never delivered.**
>
> ⚠️ `{{8}}` `request.utr` is described in the model as *"the one field support
> needs"* — the bank ARN a customer quotes to their own bank. **It appears in no
> notification today**, so a customer whose money has not appeared has nothing to
> quote.

**Buttons**

| | Type of action | Button text | URL type | Website url |
|---|---|---|---|---|
| 1 | Visit website | `Download Receipt` (16/25) | Dynamic | `{{1}}` |
| 2 | Visit website | `View Transactions` (17/25) | Static | `https://app.trydood.com/transactions` |

- Button 1 var = `request.documentToken` (`REFUND`, `REF`)

### 36. `customer_refund_bank_details` — sign-off **C** · ⚠️ read this one twice

```
🏦 We Need Your Bank Account to Send Your Refund
Hello {{1}},
Your refund could not be sent back the way you paid.
🏪 Outlet: {{2}}
🎟️ Voucher: {{3}}
🧾 Claim Code: {{4}}
💰 Amount: ₹{{5}}
📝 Reason: {{6}}
📅 Requested On: {{7}}
🔎 Status: Waiting for Your Bank Details
💚 The money is still yours.
Please open the Trydood app and add your bank account, and we will transfer it.
🔒 We will never ask you for your bank details over a call, a message or a link.
Add them only inside the Trydood app.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` | — |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` | — |
| `{{3}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` | — |
| `{{4}}` | Claim code | `request.claimCode` | `TD-CLM-9001` | — |
| `{{5}}` | Amount | `request.approvedAmount` | `810.00` | — |
| `{{6}}` | Reason | `request.adminNote` | `the original card is no longer reachable` | **120** |
| `{{7}}` | **Requested on** | `formatDateTime(...)` | `10 Sep 2026 09:00 AM` | — |

> ### 🔴 The most dangerous template on the platform
>
> This is the **only** customer message that asks them to act, and it asks for
> **exactly what a scam message asks for**. Someone whose refund has already failed
> once, now being asked for an account number over WhatsApp, has every reason to be
> suspicious — and should be.
>
> Five things are load-bearing and must survive any rewrite:
>
> 1. It **names their claim, voucher and outlet** — a scammer knows none of them.
> 2. It says plainly **the money is still theirs**.
> 3. It gives the **reason** the original method failed.
> 4. It says **we never ask over a call, message or link** — and then sends them
>    into the app, not to a form.
> 5. **No Store ID here, deliberately** — a raw code like `TS-A3F9-K2M7-QX41` reads
>    like machine-generated spam. The brand name and voucher do the recognition
>    work, and they read like something only Trydood could know.
>
> 🔴 **The button must open the app, never a web form.** And whatever
> `app.trydood.com` serves when the app is not installed **must never collect bank
> details** — if it does, this message becomes indistinguishable from the phishing
> it is written to not resemble. See [`customer_app_links.md`](./customer_app_links.md).
>
> ⚠️ Reminders go **days apart, not hours**. Someone told their refund failed and
> then pinged repeatedly for their account number reads it as a scam, and the money
> they are owed becomes the thing they least want to engage with.

**Buttons** — `Add Bank Account` (16/25), Static, `https://app.trydood.com/refunds`

### 37. `customer_voucher_refunded` — sign-off **C**

Fires when a refund is issued outside the request flow — an admin dashboard refund,
or a cancelled claim.

```
↩️ Refund Issued
Hello {{1}},
A refund has been issued for your claim.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
💰 Amount Refunded: ₹{{6}}
📄 Refund No: {{7}}
📅 Issued On: {{8}}
🔎 Status: Refund Issued
It usually reaches your account in 5–7 working days.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `claim.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Amount | passed in as `amount` | `810.00` |
| `{{7}}` | Refund document no | `refundRequest.documentNumber` | `TD/REF/26-27/000012` |
| `{{8}}` | **Issued on** | `formatDateTime(...)` | `10 Sep 2026 01:05 PM` |

⚠️ `{{6}}` is **passed in**, not read from the claim — `claim.refundAmount` is not
what the notice uses.

**Buttons** — `Download Receipt` (Dynamic, `refundRequest.documentToken`) +
`View Transactions` (Static).

### 38. `customer_claim_expired` — sign-off **C** · ⏳ Phase 2

```
⌛ Your Claim Has Expired
Hello {{1}},
Your claim was not redeemed within its window.
🏪 Outlet: {{2}}
📍 Store ID: {{3}}
🎟️ Voucher: {{4}}
🧾 Claim Code: {{5}}
📅 Expired On: {{6}}
🔎 Status: Expired
If you believe this is a mistake, please contact our support team and we will look into it.
For any assistance, contact us at helpdesk@trydood.com.
Thank you for choosing Trydood 💚
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Customer name | cascade | `Priya` |
| `{{2}}` | Outlet (brand) | `claim.brandSnapshot.name` | `Cafe Mocha` |
| `{{3}}` | **Store ID** | `claim.outletSnapshot.storeId` | `TS-A3F9-K2M7-QX41` |
| `{{4}}` | **Voucher** | `claim.voucherSnapshot.name` | `Luxury Stay Special` |
| `{{5}}` | Claim code | `claim.claimCode` | `TD-CLM-9001` |
| `{{6}}` | Expired on | `formatDateTime(claim.expiresAt)` | `09 Sep 2026 08:35 PM` |

> 🔴 **Do not submit this yet.** `claim.expiresAt` is **never written by any
> production code** — it is a Phase 2 field, and the notice's date helper falls back
> to `Date.now()`. So `{{6}}` would render **the moment the message was sent**,
> presented as the expiry. The whole notice is inert until redemption splits from
> payment.

**Buttons** — `View Order` (10/25), Dynamic, base `https://app.trydood.com/orders/`,
var = `claim._id`

---

## 4.10 Admin (4)

> Only the four you marked *required*. `BRAND_AWAITING_REVIEW`,
> `BRAND_AWAITING_RE_REVIEW` and `REFUND_ESCALATED` are excluded per your note; the
> remaining admin alerts stay on panel + email.
>
> 🔴 **All four are blocked at the platform level.**
> `ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled = false`, so no admin
> alert can reach WhatsApp until it is switched on via
> `PUT /settings` → `admin.notification`.

### 39. `admin_refund_failed`

```
🔴 Refund Failed
A customer refund could not be completed and needs attention.
👤 Customer: {{1}}
🏪 Brand: {{2}}
🧾 Claim Code: {{3}}
🎟️ Voucher: {{4}}
💰 Amount: ₹{{5}}
🏦 Method: {{6}}
📝 Reason: {{7}}
🔁 Attempt: {{8}}
📅 Failed On: {{9}}
The customer has been told their money is coming. Only a retry or a bank transfer will fix this.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example | Cap |
|---|---|---|---|---|
| `{{1}}` | Customer | 🔴 **not on RefundRequest** — needs a join | `Priya` | — |
| `{{2}}` | **Brand name** | 🔴 needs the claim | `Cafe Mocha` | — |
| `{{3}}` | Claim code | `request.claimCode` | `TD-CLM-9001` | — |
| `{{4}}` | Voucher | 🔴 needs the claim | `Luxury Stay Special` | — |
| `{{5}}` | Amount | `request.approvedAmount` | `810.00` | — |
| `{{6}}` | Method | `request.method` label | `Back to source` | — |
| `{{7}}` | Reason | passed in from `executeRefund` | `instrument does not accept refunds` | **120** |
| `{{8}}` | Attempt | `request.attemptCount` | `3` | — |
| `{{9}}` | **Failed on** | `formatDateTime(...)` | `10 Sep 2026 01:05 PM` | — |

⚠️ **9 variables** — one under the cap.

🔴 You asked for *"reason, customer, voucher, transaction"*. **`RefundRequest`
carries no customer identity and no voucher** — only `customerId` and `claimId`. Both
need a join, or `VoucherClaim.customerSnapshot`. See Part 5.9.

**Buttons** — `Open Refund` (11/25), Dynamic, base
`https://admin.trydood.com/refunds/`, var = `request._id`

### 40. `admin_settlement_ledger_drift`

```
🔴 Ledger Drift on a Payout
The payout legs and the ledger disagree about money that has physically moved.
🧾 Settlement: {{1}}
🏪 Brand: {{2}}
💸 Legs Paid: ₹{{3}}
📒 Ledger Booked: ₹{{4}}
⚠️ Gap: ₹{{5}}
📅 Detected On: {{6}}
One of the two is wrong about a transfer that has already happened.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Settlement number | `settlement.settlementNumber` | `TD/STL/26-27/000123` |
| `{{2}}` | **Brand name** | 🔴 **not on Settlement** — only `brandId` | `Cafe Mocha` |
| `{{3}}` | Legs total | job aggregation | `4523.75` |
| `{{4}}` | Ledger total | job aggregation | `4000.00` |
| `{{5}}` | Gap | computed in the notice | `523.75` |
| `{{6}}` | **Detected on** | `formatDateTime(runStartedAt)` | `10 Sep 2026 02:00 AM` |

⚠️ `{{3}}`, `{{4}}` and `{{5}}` are **not fields** — two aggregations in the job plus
arithmetic in the notice.

⚠️ `{{6}}` must be the **job's** timestamp, not `Date.now()` at render — a drift
found at 02:00 and alerted at 02:07 should read 02:00.

**Buttons** — `Open Settlement` (15/25), Dynamic, base
`https://admin.trydood.com/settlements/`, var = `settlement._id`

### 41. `admin_payment_disputed`

```
🔴 Chargeback Raised
A customer's bank has pulled back a payment. There is a response deadline.
🏪 Brand: {{1}}
🧾 Claim Code: {{2}}
💰 Amount: ₹{{3}}
📝 Reason: {{4}}
⚖️ Phase: {{5}}
📅 Raised On: {{6}}
⏳ Respond By: {{7}}
🔢 Disputes on This Payment: {{8}}
Missing the deadline forfeits the money. Nothing will chase this but us.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | **Brand name** | 🔴 **not in scope at the alert** | `Cafe Mocha` |
| `{{2}}` | Claim code | 🔴 **looked up ~80 lines later** | `TD-CLM-9001` |
| `{{3}}` | Amount | `dispute.amount` | `810.00` |
| `{{4}}` | Reason | `dispute.reason_code` | `product_not_received` |
| `{{5}}` | Phase | 🔴 `dispute.phase` — **in scope, discarded** | `Chargeback` |
| `{{6}}` | **Raised on** | `formatDateTime(dispute.created_at * 1000)` | `10 Sep 2026 04:30 PM` |
| `{{7}}` | Respond by | `formatDateTime(dispute.respond_by * 1000)` | `13 Sep 2026 11:59 PM` |
| `{{8}}` | Dispute count | 🔴 `summary.disputeCount` — **in scope, discarded** | `1` |

🔴 See §0.8 — five of these eight need the call site to change.

⚠️ `{{5}}` distinguishes a first chargeback from a `pre_arbitration` escalation.
Today they read identically, and they need very different responses.

⚠️ `{{6}}` and `{{7}}` are Razorpay **epoch seconds** — `* 1000` before formatting,
or the date renders in 1970.

**Buttons** — `Open Dispute` (12/25), Dynamic, base
`https://admin.trydood.com/disputes/`, var = `transaction._id`

### 42. `admin_dispute_deadline`

```
🔴 Dispute Deadline Approaching
A dispute response is due and the money is forfeited if it passes.
🧾 Claim Code: {{1}}
💳 Payment: {{2}}
💰 Amount: ₹{{3}}
🔎 Status: {{4}}
⏳ Respond By: {{5}}
⌛ Time Left: {{6}}
An unanswered dispute is lost by default. The bank does not ask twice.
Trydood – Grow Your Business Faster 🚀
```

| Var | Meaning | Source | Example |
|---|---|---|---|
| `{{1}}` | Claim code | 🔴 **BUG — see below** | `TD-CLM-9001` |
| `{{2}}` | Razorpay payment | `transaction.razorpayPaymentId` | `pay_QxTest0000001` |
| `{{3}}` | Amount | `transaction.disputeAmount` | `810.00` |
| `{{4}}` | Status | `transaction.disputeStatus` label | `Under review` |
| `{{5}}` | Respond by | `formatDateTime(disputeRespondBy)` | `13 Sep 2026 11:59 PM` |
| `{{6}}` | Time left | computed `hoursLeft` | `19 hours` |

⚠️ `{{4}}` **is** a variable here — unlike §0.11's rule, this template fires at
several dispute statuses, so the status genuinely varies.

> ### 🔴 `{{1}}` is a live bug
>
> `notifyDisputeDeadline` reads `transaction?.voucher?.claimCode`.
> **`voucherTransactionSchema` has `claimId` but no `claimCode`**, and the job selects
> only `razorpayPaymentId voucher amount invoiceId`. So the claim code **can never
> resolve** — every dispute-deadline alert falls through to the payment id, and the
> mail's "Claim" line prints `-`.
>
> The raised and resolved notices get it right by taking it as an argument; this one
> does not.

⚠️ `{{4}}` renders a **raw enum** (`ACTION_REQUIRED`). There is no dispute status
label map anywhere — refunds have `REFUND_CUSTOMER_LABEL`, disputes have nothing.

**Buttons** — `Open Dispute`, Dynamic, base `https://admin.trydood.com/disputes/`,
var = `transaction._id`

---

# Part 5 — Code changes required

**None of this is done.** This document is the design; implementation waits for your
approval.

| # | Change | Size | Blocks |
|---|---|---|---|
| 5.0 | **`brandName` replaces `name` in every notice** | S | all 29 vendor templates |
| 5.1 | Subscription notices: pass brand name, dates, amount, previous plan | S | 8 templates |
| 5.2 | Brand notices: `Brand.merchantId`, date **with time**, and the two status flags | S | 9 templates |
| 5.3 | Five label maps | S | 6 templates |
| 5.4 | **Outlet block** — `outletType`, `city`, `address` + widened query | S | 12 templates |
| 5.5 | **Pass the claim to the four refund notices that lack it** | M | #25, #26, #32, #33, #34 |
| 5.6 | Split `DISPUTE_RESOLVED_VENDOR` into two types | S | #28, #29 |
| 5.7 | `customer_refund_completed` — a notice that does not exist | M | #35 |
| 5.8 | `vendor_refund_completed` — also does not exist | M | #26 |
| 5.9 | Admin alerts: join customer/brand/claim before alerting | M | #39, #40, #41 |
| 5.10 | `LIMIT_REACHED` end to end | **L** | #19 |
| 5.11 | Two dynamic URL buttons in the transport | S* | 9 templates |
| 5.12 | Fix `notifyDisputeDeadline`'s claim code | XS | #42 |
| 5.13 | **Three new path builders** in `panelLinks.js` | S | #18, #19, #24, #25, #26 |
| 5.14 | **A fixed list of customer-facing refund rejection reasons** | M | #34 |
| 5.15 | `merchantId` replaces `uniqueId` in every notice | S | 12 templates |

## 5.13 The three path builders that do not exist

`PANEL_PATHS` has `settlement(id)` and `dispute(id)`. It has no builder for a
transaction, no builder for a refund — `refund(id)` exists only in `ADMIN_PATHS` —
and no per-plan checkout.

```js
// helpers/notifications/panelLinks.js — PANEL_PATHS
TRANSACTIONS: "transactions",
transaction: (transactionId) => `transactions/${transactionId}`,   // #18
REFUNDS: "refunds",
refund: (requestId) => `refunds/${requestId}`,                     // #24, #25, #26
planCheckout: (planId) => `subscription/plans/${planId}`,          // #19
```

⚠️ **A missing key here does not throw.** It produces `undefined`, and
`whatsappUrlParam` turns that into a button whose URL ends in the word
`undefined`. The message still sends and still reports success — the same warning
the file already carries three times about `ADMIN_PATHS`.

🔴 **The vendor panel has to actually have these routes.** All three are listed in
`docs/Trydood_WhatsApp_Button_Paths.md` under *Needs building*, which is the file
the web team corrects and sends back.

## 5.14 Refund rejection reasons the customer can be shown

#34 now carries a reason. It must **never** be the note a vendor or admin typed —
that is written between staff, and shown to the customer it is about it reads as
an accusation.

```js
// constants/refund.js
const REFUND_REJECTION_REASONS = Object.freeze({
  SERVICE_PROVIDED:  "The service was provided as described",
  WINDOW_CLOSED:     "The request was made after the refund window closed",
  ORDER_COLLECTED:   "The outlet confirmed the order was collected",
  ALREADY_REFUNDED:  "The claim was already refunded earlier",
  NOT_VERIFIED:      "We could not verify the issue with the outlet",
});
```

| Piece | Where |
|---|---|
| The enum above | `constants/refund.js` |
| `RefundRequest.rejectionReason` | a new enum-validated field |
| The reject endpoint | accepts and validates the key |
| Admin panel | a **dropdown**, not a free-text box |
| `notifyCustomerRefundRejected` | renders the label, never `adminNote` |

⚠️ **The existing free-text note stays** — `adminNote` is still where staff write
to each other, and the internal trail must not be lost. This adds a second,
customer-facing field beside it rather than repurposing the first.

⚠️ **Requests rejected before this ships have no key.** Fall back to
`We could not verify the issue with the outlet`, which is true of any decision we
cannot explain, rather than leaving the variable empty — an empty variable is
rejected by Meta downstream where nobody sees it.

## 5.15 `merchantId` replaces `uniqueId`

`brandVerificationNotices.js` and `brandStatusNotices.js` already put
`["Merchant ID", identity.merchantId]` in their **email** line tables, and
`resolveBrandIdentity` already returns it. What changes is the WhatsApp parameter
list and the customer/admin brand field:

```js
`${identity.brandName} (${identity.merchantId})`   // customer and admin templates
```

⚠️ `toggleBrandStatus.js:109` already selects `merchantId` and carries it into
`brandForNotice`. The verification notices need it added the same way.

\* small **once TenDigit's parameter name is known** — §0.2.

## 5.0 `brandName` everywhere

Two files hold every vendor greeting:
`helpers/notifications/brandVerificationNotices.js` and `brandStatusNotices.js`,
plus the subscription, settlement, refund and dispute notices.

```diff
- const identity = await resolveBrandIdentity(brand);
- …greet(identity.name)
+ const identity = await resolveBrandIdentity(brand);
+ …greet(identity.brandName)
```

### ✅ Decided: email and WhatsApp both, one identity

The notice helpers are **shared** — in-app, email, push and WhatsApp all read the
same `identity`. So this change lands on every channel at once, which is the point:

```
Hello ZOMATO PRIVATE LIMITED,   →   Hello Zomato,
```

⚠️ **Do not "fix" this by branching per channel.** A `channel === "WHATSAPP"`
condition in `resolveBrandIdentity` would make the same vendor two different people
depending on where they read — and the next person to add a channel would have to
know to add a branch. One resolver, one name, everywhere.

⚠️ **This is the one change in this document that is not purely additive** — it
alters vendor emails you have already reviewed. It is a correction, not a
regression (§0.10), but it will look different in the next review mail. The outlet
work (§0.1) *is* purely additive and changes no existing email.

📌 To see it before it ships:
`node scripts/sendTestNotificationMails.js --to=you@example.com --apply`

## 5.2 What the brand notices have to be given

Nine templates need three things the notices never receive today.

**1. `Brand.uniqueId`** — every brand template's `🆔 Brand ID:` row. It is already
selected in `toggleBrandStatus.js:109` and already reaches `brandForNotice`; the
verification notices need it added.

**2. A timestamp, formatted** — §0.3. The value exists at every call site
(`result.performedAt`, `accountDeactivatedAt`, `adminApprovedAt`, `rejectedAt`,
`revokedAt`, `systemVerify.createdAt`) and is discarded.

**3. The two status flags for #14 and #16:**

```diff
  const brand = await Brand.findOne({ _id: brandId, isDeleted: false })
-   .select("_id userId brandName uniqueId merchantId isActive")
+   .select("_id userId brandName uniqueId merchantId isActive accountDeactivationReason")
    .session(session);
```

```diff
  } else if (result.visibilityChanged) {
    notice = await notifyBrandCustomerVisibilityChanged({
      brand: brandForNotice,
      isVisible: result.isVisibleToCustomers,
+     // #16 {{4}}: the reason only exists when the account is already suspended.
+     // Read the stored field, never this call's `reason` argument — a reason
+     // sent on a visibility-only call is accepted by validation and then
+     // written nowhere.
+     isAccountActive: result.isActive,
+     reason: result.isActive ? null : brand.accountDeactivationReason || null,
    });
  }
```

⚠️ `brand` is read inside the transaction and `brandForNotice` is built after it.
The reason has to be carried out of that scope along with the rest of `result`,
rather than re-read — a second read after the commit could see another admin's
change and attribute it to this one.

⚠️ `notifyBrandDeactivated` already receives `hiddenFromCustomers`
(`toggleBrandStatus.js:367`). #14's `{{5}}` only needs it **rendered**, not passed.

## 5.3 The five label maps

Each turns a raw enum into words a person can read. All five are currently missing,
and all five would otherwise print the enum:

| Enum | Renders today | Needs |
|---|---|---|
| `SETTLEMENT_FAILURE_REASON` | `BANK_REJECTED` | `Beneficiary account closed`, … |
| `transaction.disputeStatus` | `ACTION_REQUIRED` | `Under review`, … |
| `REFUND_METHODS` | `SOURCE` | `Back to your original payment method` |
| `SUBSCRIPTION_SOURCE` | `ADMIN_MANUAL` | `Complimentary` |
| **`OUTLET_TYPES`** | `FRANCHISE` | `Franchise` / `Outlet` |

⚠️ `REFUND_CUSTOMER_LABEL` already exists and is the pattern to copy.

## 5.4 The outlet block

Four edits, all additive:

1. `helpers/notifications/composeOutletAddress.js` — new, §0.1
2. `helpers/vouchers/buildClaimPreview.js:118` — widen `.select` and the populate
   `select`. **Still one query.**
3. `services/voucherClaims/createVoucherClaimOrder.js:294` — three new snapshot keys
4. `OUTLET_TYPE_LABEL` in the label maps (5.3)

⚠️ **No model change** — `claimSnapshotSchema` is `strict: false` (§0.1).

⚠️ **No reader changes** — every consumer picks named keys and none spreads the
object. Snapshots, emails and documents keep rendering exactly what they render
today.

## 5.5 The claim has to travel with the refund notices

```js
notifyVendorRefundRequested({ request, claim })   // ✅ already
notifyVendorRefundReminder({ request })           // 🔴 add claim
notifyCustomerRefundRequested({ request })        // 🔴 add claim
notifyCustomerRefundApproved({ request })         // 🔴 add claim
notifyCustomerRefundRejected({ request })         // 🔴 add claim
```

🔴 **The reminder is a loop.** `refundJobs.js:409` iterates due requests and calls
the notice per request — a naive `VoucherClaim.findById` inside it is one query per
reminder.

```js
// Load once, before the loop.
const claims = await VoucherClaim.find({ _id: { $in: due.map(r => r.claimId) } })
  .select("_id claimCode voucherSnapshot outletSnapshot brandSnapshot")
  .lean();
const claimById = new Map(claims.map(c => [String(c._id), c]));
```

⚠️ `.select` only the four snapshots — a claim document carries `pricing`, which
holds our margin (§4.4).

## 5.10 `LIMIT_REACHED`, in detail

Six pieces, none of which exists:

1. **`helpers/subscriptions/findUpgradeOptions.js`** — query
   `{ isActive: true, isDeleted: false, price: { $gt: current.price } }` sorted
   `{ price: 1 }`. The index `{ isActive: 1, isDeleted: 1, price: 1 }` already covers
   it.
2. **Filter on the bucket, not the price.** Keep only candidates where
   `entitlements[bucket].isUnlimited === true` **or** `entitlements[bucket].limit >
   current`. Without this, `{{6}}` offers an upgrade that does not fix `{{2}}`.
3. **Run every candidate through `resolveEntitlements()`** and check its `source`. A
   `DERIVED` or `DEFAULT` plan's limit is a guess parsed from free text — printing
   *"upgrade to 50 vouchers"* from one is a promise the gate will not keep.
4. **`PANEL_PATHS.planCheckout = (planId) => \`subscription/plans/${planId}\`** — plus
   agreement from the vendor panel that the route exists. ⚠️ A missing key here does
   not throw; it produces a link ending in the word `undefined`.
5. **Fire from `reserveSlot`'s throw path**, and it must be
   `sendQuietly(() => notify(...), "limit-reached")` — the **thunk** form. Passing an
   already-invoked promise still sends, still records the call in a mocked test, and
   turns a delivery failure into an unhandled rejection, which takes the job runner
   down on Node 24.
6. **A date-windowed dedupe key** — `LIMIT_REACHED:${brandId}:${bucket}:${YYYY-MM-DD}`.
   Every existing subscription key is a one-shot transition; a vendor can hit the same
   limit twenty times a minute.

⚠️ Only four metered pools exist: `subBrands`, `franchises`, `vouchers`, `showcase`.
There is **no** image, media, storage or staff limit — if you meant one of those, it
needs a new bucket in five places first.

---

# Part 6 — Volume, and the digest that was decided against

**Decision: per-claim messages for now.** The digest below is designed and parked.

## The problem it would solve

A brand taking 50 claims a day gets 50 paid WhatsApp messages. Beyond the cost, the
real risk is that a vendor mutes Trydood notifications — and the mute takes the
refund deadline and the chargeback alert with it.

## The three shapes

**A — per claim (chosen)** — `50 claims → 50 messages`. Immediate, and right while
volume is low.

**B — per-outlet hourly digest**
```
🧾 5 New Claims at Your Outlet
Hello Cafe Mocha,
5 customers paid at TS-A3F9-K2M7-QX41 in the last hour.
🏠 Address: Shop 4 Vijay Nagar Indore MP 452010
💰 Total Bills: ₹4850
💚 You Will Receive: ₹3395
🕐 Between: 07 Sep 2026 02:00 PM – 03:00 PM
```
`50 claims → ~10 messages`. ⚠️ The vendor no longer learns immediately that a payment
arrived.

**C — hybrid, threshold then digest** — first **5 claims** of the day individually,
then hourly digests. `50 claims → ~13 messages`. Small outlets keep real-time; busy
ones stop being spammed.

## What B or C would need

| Piece | Why |
|---|---|
| A job in `jobs/index.js` | ⚠️ Never a bare `setInterval` — on a multi-instance deploy it runs once per instance |
| A batching query | "unnotified claims in the last hour, per outlet" |
| `VoucherClaim.claimNotifiedAt` | Otherwise the same claim appears in every digest |
| A new type `VOUCHER_CLAIMS_DIGEST` | Its own Meta template |
| `DIGEST:${subBrandId}:${YYYY-MM-DD-HH}` dedupe | One digest per outlet per hour |

## 📌 The trigger for revisiting

**When any single brand crosses ~20 claims a day**, switch to **C**. Deciding then
means setting the threshold against real numbers rather than a guess — and it is
cheap to change *before* the digest template is approved, expensive after.

---

# Part 7 — Submission order

**Wave 1 — submit now (26 templates, one button each):**
#4, #6, #7, #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #21, #22, #23, #24, #25,
#26, #27, #28, #31, #32, #33, #34, #36

**Wave 2 — after TenDigit confirms the second URL parameter (9 templates):**
#1, #2, #3, #5, #20, #29, #30, #35, #37

**Wave 3 — after their code lands (7 templates):**
- #18 — needs the outlet block (5.4)
- #19 — needs Part 5.10
- #38 — Phase 2, inert until redemption splits
- #39, #40, #41, #42 — need the joins **and** the admin WhatsApp toggle switched on

⚠️ **Wave 1 templates #24–#28, #31–#34 and #36 still need code before they can
*send* correctly** — the outlet block and the claim pass-through. They can be
**submitted** to Meta now because the variable contract is settled; approval takes
days and the code lands in parallel.

## Per-template checklist

- [ ] Category **Utility**, language `en`
- [ ] Body variables ≤ 10, in the exact order above
- [ ] No variable contains a comma or a line break
- [ ] Free-text variables capped at the length noted
- [ ] Amounts passed **without** `₹` — the body already prints it
- [ ] Timestamps pre-formatted by `formatDateTime` (IST, date **and** time), never a `Date`
- [ ] Status lines are **static text**, except #32 and #42
- [ ] Greeting is `brandName` — **never** `identity.name`
- [ ] Button URL variables numbered `{{1}}` **independently** of the body
- [ ] Dynamic button variable is a **path segment**, never a full URL
- [ ] Sample text filled for every dynamic button
- [ ] `WHATSAPP_TEMPLATE_<TYPE>` env var set, and the server restarted
- [ ] **Sent to a real handset and read** — `sent: true` proves nothing

---

# Part 8 — Still open

**Every content and variable decision is made.** What remains is not ours to
decide — one answer from the provider, three pieces of front-end.

| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | TenDigit's parameter name for a **second** button variable | You / TenDigit support | **16 templates** — see below |
| 2 | Admin panel line under the deactivation reason input: *"This reason is sent to the vendor by email and WhatsApp."* | Front-end | nothing — ship #14 without it, but the first vendor to read an internal note is how we find out |
| 3 | Three vendor panel routes — `transactions/:id`, `refunds/:id`, `subscription/plans/:planId` | Front-end | #18, #19, #24, #25, #26 |
| 4 | Confirm `vendor.trydood.com/subscription` is the vendor's **own** subscription page, not the plan list | Front-end | #1–#5 |
| 5 | `trydood.com/contact` page exists and is public | Website | #12, #13, #14, #16, #21, #34, #36, #38 |
| 6 | Admin panel dropdown for the refund rejection reason (5.14) | Front-end | #34 |
| 7 | `app.trydood.com` — Stage 1 (30 min, no app work) so customer buttons land somewhere | You — see [`customer_app_links.md`](./customer_app_links.md) | all 9 customer templates |

## 🔴 Item 1 got much more expensive

Two-button templates were 9. After adding the downgrade invoice (§0.14) and the
Contact Support buttons, they are **16** — 38% of everything here:

```
#1 #2 #3 #4 #5 #12 #13 #20 #21 #29 #30 #34 #35 #36 #37 #38
```

Every one of them is a template the team cannot create until TenDigit answers one
question about their API. It was worth asking before; it is the single highest-value
thing on this list now.

## The decision log

Everything settled while writing this document, in one place.

| Decision | Outcome |
|---|---|
| Buttons per template | **Two** where a document exists, one otherwise |
| Meta category | **Utility** — reaches vendors who opted out of marketing |
| Vendor/brand naming | **`brandName` on every channel** — email and WhatsApp identical, no per-channel branching |
| Customer sign-off | **A** normally, **C** for refund/failure |
| Outlet identity | Store ID **+ type** (vendor) / Store ID (customer), **plus a real address** |
| Store type field | **`outletType`** (`FRANCHISE \| OUTLET`) — not `storeType` |
| Snapshot change | **Additive only**, no model change (`strict: false`), no reader touched |
| Dates | **`formatDateTime` — date *and* time, IST** — except subscription windows and settlement periods |
| Status lines | **Static text**, except #32 and #42 where it genuinely varies |
| Verification turnaround | *"a few working days"* — **no number**, so it never needs resubmitting |
| Deactivation reason | Admin's reason, else `Please contact support for details.` |
| #16's reason | `accountDeactivationReason` when the account is off, else the default |
| Claim digest | **Per-claim for now**; revisit at ~20 claims/day for one brand |
| Scope | Vendor money-side + the 4 annotated admin templates |

## Before implementation starts

- [ ] You have read this document and approved it
- [ ] Q1 answered, or Wave 1 submitted without waiting for it
- [ ] Agreed that §5.0 changes **vendor email greetings** as well as WhatsApp

Then Part 5's thirteen changes, smallest first.
