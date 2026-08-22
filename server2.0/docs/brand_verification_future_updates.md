# Brand Verification — Future Updates

Running list of everything **deliberately deferred** on the brand verification /
approval flow. Nothing here is implemented yet — add to this file instead of
leaving TODOs scattered in the code.

Last updated: 2026-08-23

---

## Current state (what already works)

| Piece | Where |
|---|---|
| System KYC scoring + attempt tracking | `services/systemVerify/verifyVendor.js` |
| Admin approve / reject / revoke / reviewed-toggle | `services/systemVerify/reviewBrandVerification.js` |
| Vendor dismisses the congratulations screen | `services/systemVerify/acknowledgeBrandApproval.js` |
| Admin work-queue listing | `services/systemVerify/getAllBrandVerifications.js` |
| Audit trail (admin + vendor views) | `services/systemVerify/getBrandVerificationHistory.js` |
| Immutable history rows | `models/BrandVerificationHistory.js` |

---

## 1. Notifications on every decision — **PENDING**

Nothing is sent to the vendor today; the panel only finds out by polling
`GET /brands/get`. Wire these up when the notification layer is ready:

| Event | Channel | Content |
|---|---|---|
| `APPROVED` | push + email | congratulations, link into the dashboard |
| `REJECTED` | push + email + WhatsApp | `rejectionReason`, what to fix, resubmit link |
| `REVOKED` | push + email + WhatsApp | `revokeReason`, that the brand is now hidden from customers |
| `RESUBMITTED` | internal only | ping the admin queue that a brand is waiting again |

Notes for whoever picks this up:

- Hook into `reviewBrandVerification` **after** the transaction commits, never
  inside it — a failed email must not roll back an approval.
- The history row is the natural trigger source; consider a worker that tails
  `brandverificationhistories` rather than firing inline, so retries are free.
- `nodeMailer` helpers already exist under `helpers/nodeMailer/`. Push has no
  helper yet.

## 2. Vendor screen handling for failure states — **PENDING**

By decision, `reviewBrandVerification` does **not** touch `user.currentScreen`
on `REJECTED` or `REVOKED`. The vendor stays wherever they were, and the panel
has to branch on `brand.status` + `brand.rejectionReason` / `brand.revokeReason`.

Open question: should a rejection push `currentScreen` back to
`SYSTEM_VERIFICATION` so the app deep-links straight to the fix-and-resubmit
flow? Deferred until the vendor panel's screens are final.

## 3. Rejection reason presets / reason codes — **PENDING**

Right now `rejectionReason` and `revokeReason` are free text (max 1000 chars).
An enum of reason codes (`GST_INACTIVE`, `PAN_NAME_MISMATCH`,
`DUPLICATE_MERCHANT`, `DOCUMENT_UNREADABLE`, …) plus optional free text would
make the vendor-facing copy translatable and the admin analytics groupable.

## 4. Auto-expiry of stale attempts — **PENDING**

A brand can sit at `UNDER_REVIEW` forever if no admin touches it. Consider a
job (like `services/vouchers/expireVouchers.js`) that flags attempts older than
N days for escalation. Requires an SLA decision first.

## 5. Admin analytics on the queue — **PENDING**

`getAllBrandVerifications` already returns `rejectionCount`, `revocationCount`
and `submissionCount` per brand. Not yet exposed: median time-to-decision,
per-admin throughput, approval rate by score band. All derivable from
`brandverificationhistories` — no new writes needed.

## 6. Vendor-facing response for system-verify — **PENDING (intentionally)**

`GET /brands/onboarding/system-verify` still returns the **full** SystemVerify
record (score, flags, remarks) exactly as before, because the score and remarks
are what let an admin skim instead of re-reading every document, and more data
is attached to the brand after this step anyway.

A lean, score-free vendor payload is already written and **commented out** at
the bottom of `services/systemVerify/verifyVendor.js`. Switch to it whenever the
vendor panel no longer reads those fields — the service logic already parks the
brand at `UNDER_REVIEW` regardless of what the system scored, so nothing else
has to change.

## 7. Sub-brand / outlet verification — **NOT STARTED**

This flow covers the parent brand's KYC only. Outlet-level checks (per-location
FSSAI, shop licence) are not modelled.

## 8. Legacy `server/` mirror — **WON'T DO**

The legacy backend is frozen. No verification fields are mirrored into
`server/model/Brand.js`; all verification work lives in `server2.0/` only.

---

## Migration / rollout notes

- **No backfill required.** Every new boolean (`isSuperseded`, `isRevoked`,
  `isApprovalAcknowledged`, …) is absent on existing documents, and Mongo does
  not treat an absent field as `false`. All queries therefore filter with
  `{ $ne: true }` instead of `false`, so brands created before this change stay
  visible and actionable. Keep that convention if you add more flags.
- `SYSTEM_VERIFICATION_STATUS.REVOKED` is new. Any consumer switching on brand
  status needs a branch for it.
- `verificationAttemptCount` starts at 0 on old brands, so their first
  post-deploy system run is recorded as attempt 1 — correct by accident, and
  fine.
