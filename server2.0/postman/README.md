# Postman — Brand Verification & Admin Approval

Postman v2.1 collection for the brand KYC + admin approval flow, generated from the
`server2.0` codebase.

| File | What it is |
|---|---|
| `trydood-brand-verification.postman_collection.json` | The collection — 15 requests, 139 saved response examples |
| `environments/local.postman_environment.json` | `http://localhost:8080/trydood/v1` |
| `environments/staging.postman_environment.json` | `https://backend2-0-4v4i.onrender.com/trydood/v1` |
| `environments/production.postman_environment.json` | Production base URL — **confirm before use** |
| `generate.js` | Regenerates all of the above from the code |

Companion docs: [`../docs/brand_verification_api_doc.md`](../docs/brand_verification_api_doc.md) ·
[`../docs/brand_verification_future_updates.md`](../docs/brand_verification_future_updates.md)

---

## Import

1. Postman → **Import** → drop in `trydood-brand-verification.postman_collection.json`.
2. **Import** the environment you need from `environments/`.
3. Select that environment in the top-right dropdown (nothing works until you do —
   the collection pre-request script logs a warning if `base_url` is unset).

## Fill in the secrets

Environment variables typed `secret` ship **empty on purpose** — no credentials in git.
Set these yourself in Postman:

| Variable | Set it to |
|---|---|
| `admin_password` | Your admin account password |
| `vendor_password` | The test vendor's password |
| `admin_email` | Defaults to `admin@trydood.com` — change if yours differs |
| `vendor_mobile` / `vendor_whatsapp` | Your test vendor's 10-digit number |
| `otp` | Only for the WhatsApp login flow |

## Token capture — no copy-pasting

The `00 — Auth` folder writes tokens into the environment for you:

| Run this | It sets |
|---|---|
| **Login as Admin** | `admin_token`, `admin_user_id` |
| **Login as Vendor (mobile + password)** | `vendor_token`, `brand_id` |
| **Vendor WhatsApp — Send OTP** → **Verify OTP** | `vendor_token`, `brand_id` |

Login response puts the JWT at `data.token`
(`services/auth/loginWithEmailAndPassword.js`), which is what the scripts read.

Two more requests keep the rest wired up:

- **List Brand Verifications (queue)** captures `brand_id` and `system_verify_id` from
  the first row, so the review requests are immediately runnable.
- **Run System Verify (KYC)** captures `system_verify_id` and `brand_id` from its own
  response.

Every `brands/*` request authenticates with the right variable already —
vendor routes use `{{vendor_token}}`, admin routes use `{{admin_token}}`.

## Suggested run order

```
00 — Auth
  └─ Login as Admin                          → admin_token
  └─ Login as Vendor                         → vendor_token, brand_id

Brands / Onboarding (Vendor)
  └─ Run System Verify (KYC)                 → SystemVerify created,
                                                Brand parked at UNDER_REVIEW

Brands / Admin — Verification
  └─ List Brand Verifications (queue)        → brand_id, system_verify_id
  └─ Review — Toggle Reviewed        (optional, "I have seen this")
  └─ Review — Approve (Case A or B)  OR  Review — Reject (Case C)

Brands / Onboarding (Vendor)
  └─ Acknowledge Approval                    → currentScreen = DASHBOARD

Brands / Admin — Verification
  └─ Review — Revoke Approval        (only on an approved brand)

Brands / Verification History
  └─ Admin view  /  Vendor view
```

## Folder map

| Folder | Requests |
|---|---|
| `00 — Auth (token capture)` | Login as Admin · Login as Vendor · WhatsApp Send OTP · WhatsApp Verify OTP |
| `Brands / Onboarding (Vendor)` | Run System Verify (KYC) · Acknowledge Approval |
| `Brands / Admin — Verification` | List Brand Verifications (queue) · Approve Case A · Approve Case B · Reject Case C · Toggle Reviewed Case D · Force Reviewed Case D2 · Revoke Case E |
| `Brands / Verification History` | Admin view · Vendor view (own brand only) |

The five review requests all hit the **same route**
(`PUT /brands/admin/verifications/:brandId/review`) — they are split one-per-case so
each carries its own body, description and error examples.

## Things worth knowing before you run it

- **List endpoints return `404` when empty**, not an empty array. The shared
  `pagination` utility throws. Treat it as an empty state.
- **The system never auto-approves.** Whatever it scores, `Brand.status` becomes
  `UNDER_REVIEW` and `Brand.isApproved` stays `false` until an admin acts.
- **`rejectionReason` and `revokeReason` are mutually exclusive** and each is only
  valid on its own action — sending the wrong one is a `422`.
- **Re-running System Verify** only works when the live attempt is `REJECTED` or
  `REVOKED`. An attempt waiting on the admin is locked (`409`).
- **One admin rejection per attempt.** Rejecting an already admin-rejected attempt is
  a `409` — the vendor has to resubmit first.
- **Approved brands cannot be rejected** — use *Revoke Approval* instead (`409`).
- **`409` is normal under concurrency.** Every write is transactional with optimistic
  locking, so if two admins act at once the loser gets a `409`. Refresh and retry.

## Regenerating

```bash
node postman/generate.js
```

Run this from `server2.0/`. It rewrites the collection and all three environment
files. **Do not hand-edit the JSON** — enum lists, reason limits and role names are
read straight out of `constants.js` and `constants/brandVerification.js`, so editing
the JSON by hand is how it starts lying about the API.

Adding a case? Add it to `generate.js` and re-run.
