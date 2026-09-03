# Brand Rejection → Remediation → Resubmit

**Status:** IMPLEMENTED
**Date:** 2026-08-23

After an admin rejection the vendor fixes what the rejection message named, on **one page**,
without re-walking the 5-step funnel and without paying for verifications that were already
fine.

---

## 1. The flow

```
FIRST PASS  (forward-only funnel, currentScreen advances at each save)
  BUSINESS_NAME / REGISTRATION_STATUS / REGISTRATION_ENTITY_TYPE
      → PAN_VERIFICATION   (verify-pan  → add-pan-details)
      → GST_VERIFICATION   (verify-gst  → add-gst-details)
      → BANK_VERIFICATION  (verify-bank → add-bank-details)
      → SYSTEM_VERIFICATION (system-verify)
      → PARTNERSHIP_DEED → SUBSCRIBE_PLAN → OUTLET_PAGE → UNDER_REVIEW

ADMIN REJECTS
  Brand.status = REJECTED · rejectionReason set · currentScreen untouched

REMEDIATION  — vendor never leaves the UNDER_REVIEW screen
  "Update Details" button opens ONE page with collapsible sections:
    1. Basic Details      → names + entity type editable, registration status read-only
    2. Business Details   → PAN sub-section (re-verify + save)
                            GST sub-section (re-verify + save)
    3. Bank Details       → re-verify + save
  Existing values are pre-filled from GET /brands/get.
  Every save leaves currentScreen on UNDER_REVIEW.

RESUBMIT
  Bottom button → GET /brands/onboarding/system-verify
    → attempt N+1, previous attempt marked isSuperseded
    → recomputed locally, NO third-party charge
    → Brand.status = UNDER_REVIEW again

  …loops until APPROVED. Rejection round N+1 works exactly like round 1.

APPROVED
  congratulations on the UNDER_REVIEW screen
  → PUT /brands/onboarding/acknowledge-approval → currentScreen = DASHBOARD
```

**Why the whole pre-approval block reopens together rather than per-section:** system
verify is the only gate that computes a status, and it scores _all_ the data at once. A
name fix changes the PAN/GST/bank match scores too. Giving the vendor the whole block on
one page is both simpler to build and more honest about what actually gets re-scored.
Steps after system-verify (partnership, subscription, outlet, showcase) never gate
approval — they are freely editable already and untouched by any of this.

---

## 2. Three blockers that had to be fixed first

These were live in the code and made any fix-and-resubmit flow impossible.

### B1 — the duplicate guard collided with the vendor's own record

```js
// before — matches the vendor's OWN document
const existing = await PAN.findOne({ pan, isDeleted: false });
if (existing) throwError(400, "PAN details already in use.");
```

A vendor re-saving their own PAN got _"PAN details already in use."_ — blocked by
themselves. Present in all three save services **and** all three CGPey verify services.

```js
// after — another brand's document still blocks, your own does not
const takenByAnotherBrand = await PAN.findOne({
  pan,
  isDeleted: false,
  brandId: { $ne: brandId },
}).select("_id");
```

### B2 — saves were create-only, and the unique index made that fatal

`models/PAN.js` and `models/GST.js` carry `.index({ brandId, <number> }, { unique: true })`.
Re-saving the same number via `create()` is a duplicate-key **422**. Every save also
repointed `brand.PANId` and orphaned the previous document.

Now: **same number → update in place**; **different number → create the new one, soft-delete
the old (kept for audit), repoint the brand**.

### B3 — the lock was cosmetic

`currentScreen` arrived **in the request payload**, and no endpoint checked step order.
Nothing stopped a vendor (or a buggy client) from re-hitting `verify-pan` and burning a
paid CGPey call on a section that was never the problem.

Now there is one real gate — see §3.

---

## 3. The edit window — `helpers/brands/onboardingEditWindow.js`

`resolveOnboardingEditWindow(brand)` returns one of three modes:

| Brand state                                    | Mode          | Onboarding writes | `currentScreen`                    |
| ---------------------------------------------- | ------------- | ----------------- | ---------------------------------- |
| No system verify yet (`!brand.systemVerifyId`) | `FIRST_PASS`  | allowed           | advances, exactly as before        |
| Live attempt `REJECTED` / `REVOKED`            | `REMEDIATION` | allowed           | **never touched**                  |
| Live attempt awaiting an admin decision        | `LOCKED`      | `409`             | —                                  |
| `brand.isApproved`                             | `LOCKED`      | `409`             | —                                  |
| Live attempt missing or already superseded     | `FIRST_PASS`  | allowed           | advances (fail-open, never wedged) |

`assertOnboardingEditable(window)` throws the `409`. It runs at the top of **seven**
services: `createPan`, `createGst`, `createBank`, `addOrUpdateBasicDetails`, and the three
`verify*AndFetchDetails`.

Locked messages:

- awaiting admin → _"Your details are locked while your application is under review. If anything needs correcting, you'll be able to edit it once we get back to you."_
- approved → _"Your brand is already approved, so onboarding details can no longer be changed here."_

> **Zero regression by construction:** a brand mid-first-onboarding has no
> `systemVerifyId`, so it lands on row 1 and every endpoint behaves exactly as it did.

---

## 4. Third-party spend

Two independent savings, both verified by test:

**Resubmitting is free.** `verifyVendor` never calls CGPey — it reads the stored PAN/GST/Bank
records and recomputes matching locally. Attempts 2, 3, … N cost nothing.

**Re-verifying an unchanged document is free.** In each `verify*AndFetchDetails`:

```
call the provider ONLY IF
     the submitted number differs from the stored one
  OR the stored record's verificationStatus !== SUCCESS
otherwise → return the stored verificationResponse, no provider hit
```

The stored `verificationResponse` **is** the raw provider body (that is what the client
posts back on save), so the cached path is shape-identical to a live call — the prefill
form cannot tell the difference.

So the most common rejection — _"legal name doesn't match your PAN"_ — costs **₹0**: a text
edit plus a free re-score.

---

## 5. Section-by-section behaviour in remediation

| Section       | Editable                                               | Read-only                                    | Endpoint                                         |
| ------------- | ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------ |
| Basic Details | `brandName`, `legalBusinessName`, `businessEntityType` | `businessRegistrationStatus` → `400` if sent | `PUT /brands/onboarding/update-basic-details`    |
| PAN           | whole record                                           | —                                            | `verify-pan` (conditional) → `add-pan-details`   |
| GST           | whole record                                           | —                                            | `verify-gst` (conditional) → `add-gst-details`   |
| Bank          | whole record                                           | —                                            | `verify-bank` (conditional) → `add-bank-details` |

`businessRegistrationStatus` is read-only because `UNREGISTERED` is refused outright, so
`REGISTERED` is the only value that ever gets this far — there is nothing to change.

`businessEntityType` **is** editable: `flags.businessEntityMatched` is worth +10 and a
GST-constitution mismatch is a legitimate rejection, so the vendor must be able to fix it.

A basic-details call with no updatable field returns `400 "Please provide at least one
detail to update."`, and `currentScreen` in the payload is ignored during remediation.

---

## 6. Audit trail

New history action **`REMEDIATION_UPDATED`** (`performedByType: VENDOR`), written on every
remediation save:

```json
{
  "action": "REMEDIATION_UPDATED",
  "performedByType": "VENDOR",
  "attemptNumber": 2,
  "previousStatus": "REJECTED",
  "newStatus": "REJECTED",
  "metadata": {
    "section": "PAN",
    "changeType": "REPLACED"
  }
}
```

`section` ∈ `BASIC_DETAILS · PAN · GST · BANK` · `changeType` ∈ `UPDATED · REPLACED`.
For basic details, `metadata.details.fields` lists which fields moved.

**Document numbers are never written to history** — only whether the number changed. So the
trail answers _"vendor ne kya fix kiya, kab"_ without duplicating PII.

`BRAND_ONBOARDING_SECTION` exists **only** for these labels. It is not an access-control
unit — remediation opens the whole block.

---

## 7. Frontend contract

No new endpoint. `GET /brands/get` already joins `pan`, `gst`, `bank` and `systemVerify`:

| Show                      | Read from                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| "Update Details" button   | `brand.status === "REJECTED"` (or `"REVOKED"`)                            |
| The rejection message     | `brand.rejectionReason` / `brand.revokeReason`                            |
| Pre-filled section values | `pan`, `gst`, `bank`, `brand.legalBusinessName`, …                        |
| Attempt number            | `brand.verificationAttemptCount`                                          |
| Resubmit button           | always enabled during remediation — the vendor decides when they are done |

A `409` from any onboarding write means the window shut underneath the client (the admin
acted meanwhile) — refetch `GET /brands/get` and re-render.

---

## 8. Files changed

**New (3)**

| File                                        | Purpose                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `constants/brandOnboarding.js`              | `BRAND_ONBOARDING_SECTION`, `BRAND_ONBOARDING_EDIT_MODE`, `BRAND_ONBOARDING_CHANGE_TYPE` |
| `helpers/brands/onboardingEditWindow.js`    | `resolveOnboardingEditWindow`, `assertOnboardingEditable`, `isRemediation`               |
| `helpers/brands/recordRemediationUpdate.js` | writes the `REMEDIATION_UPDATED` row                                                     |

**Modified (11)**

| File                                                                    | Change                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `constants/brandVerification.js`                                        | + `REMEDIATION_UPDATED` action                                       |
| `helpers/brands/index.js`                                               | barrel                                                               |
| `services/pan/createPan.js`                                             | B1 · B2 · window gate · remediation-aware screen · history           |
| `services/gst/createGst.js`                                             | same                                                                 |
| `services/bank/createBank.js`                                           | same · + server-derived `isverified` · + null-safe provider response |
| `services/brands/addOrUpdateBasicDetails.js`                            | window gate · registration status read-only in remediation · history |
| `services/cgpeyAPIs/verifyPanAndFetchDetails.js`                        | B1 · window gate · charge skip                                       |
| `services/cgpeyAPIs/verifyGstAndFetchDetails.js`                        | same                                                                 |
| `services/cgpeyAPIs/verifyBankAndFetchDetails.js`                       | same                                                                 |
| `controllers/cgpeyAPIs/verifyPan.js` · `verifyGst.js` · `verifyBank.js` | pass `req.brandId` to the service                                    |

**No new routes, no new models, no migration.** Existing route paths, validators and
response shapes are unchanged.

### Two bugs fixed on the way

1. **`...payload` was spread last** in all three save services, so a raw client copy
   overrode the server's normalised values — and in `createBank` it overrode the
   server-derived `isverified` / `verifiedAt`, letting a client claim its own bank account
   was verified. Normalised and derived values are now applied last.
2. **`verificationResponse.result.is_valid`** was read without a null guard in
   `createBank` — a provider response without `result` threw a `TypeError` (500).

---

## 9. Verified behaviour

`33 scenarios / 72 assertions`, no DB writes (stubbed models + stubbed axios client):

- edit window resolution for all 6 brand states
- first pass unchanged for all four services (screen still advances, values still normalised)
- `409` on all 7 write paths while locked, and for an approved brand
- remediation: in-place update on unchanged number, retire-and-replace on changed number,
  `currentScreen` never advanced, history row written with no PII
- another brand's PAN / GST / account still blocked; your own no longer blocks you
- CGPey called only when the number changed or the previous verify was not `SUCCESS`
- client-supplied `isverified: true` overridden when the provider disagrees
- missing `verificationResponse.result` no longer crashes

---

## 10. Still open

| Item                                                              | Note                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications on rejection                                        | Tracked in `brand_verification_future_updates.md`                                                                                     |
| Structured rejection reasons (section codes instead of free text) | Deliberately skipped — the vendor gets the whole block, so the message alone is enough. Revisit only if support volume says otherwise |
| Attempt cap / escalation after N rejections                       | Needs an SLA decision                                                                                                                 |
| WhatsApp / brand email duplicate flags                            | No self-service fix — these mean another brand already holds the number. Needs a support path                                         |
