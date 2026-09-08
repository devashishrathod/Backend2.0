# Trydood WhatsApp Buttons — Routes

**58 buttons across 42 templates** · 08 Sep 2026

> Edit the **Front-end route** column and send this file back. Both documents are
> rebuilt from it — the paths live in one place, `server/scripts/generateWhatsappTemplateDoc.js`.

## The rule behind every destination

A button opens **the exact record the message is about**, never a list. A payment
notification opens that payment; a refund notification opens that refund. The only
exceptions are the plan list — where the vendor is choosing, so a list is the
point — and the onboarding and dashboard screens, which are single pages.

⚠️ **A URL is frozen when Meta approves the template.** If a route changes later,
the template has to be built again under a new name and the old one keeps sending
in the meantime. A `NEW` or `CONFIRM` below is a blocker, not a to-do.

## Needs building — 5

| # | Template | Button | Route needed | Backend constant |
|---|---|---|---|---|
| 18 | `vendor_voucher_claim_received` | View Transaction | transactions/:transactionId — this claim's full detail, not the list | `PANEL_PATHS.transaction(id)` |
| 19 | `vendor_plan_limit_reached` | Upgrade Plan | subscription/plans/:planId — opens that plan ready to buy | `PANEL_PATHS.planCheckout(planId)` |
| 24 | `vendor_refund_requested` | Review Refund | refunds/:refundRequestId — this request, opened ready to decide | `PANEL_PATHS.refund(id)` |
| 25 | `vendor_refund_reminder` | Review Refund | refunds/:refundRequestId | `PANEL_PATHS.refund(id)` |
| 26 | `vendor_refund_completed` | View Refund | refunds/:refundRequestId | `PANEL_PATHS.refund(id)` |

## Needs confirming — 13

| # | Template | Button | What to confirm |
|---|---|---|---|
| 1 | `vendor_subscription_activated` | View Subscription | The vendor's own subscription page — NOT the plan list |
| 2 | `vendor_subscription_renewed` | View Subscription | The vendor's own subscription page — NOT the plan list |
| 3 | `vendor_subscription_upgraded` | View Subscription | The vendor's own subscription page — NOT the plan list |
| 4 | `vendor_subscription_downgraded` | View Subscription | The vendor's own subscription page — NOT the plan list |
| 5 | `vendor_subscription_granted` | View Subscription | The vendor's own subscription page — NOT the plan list |
| 12 | `brand_rejected` | Contact Support | trydood.com/contact |
| 13 | `brand_approval_revoked` | Contact Support | trydood.com/contact |
| 14 | `brand_deactivated` | Contact Support | trydood.com/contact |
| 16 | `brand_hidden_from_customers` | Contact Support | trydood.com/contact |
| 21 | `vendor_settlement_failed` | Contact Support | trydood.com/contact |
| 34 | `customer_refund_rejected` | Contact Support | trydood.com/contact |
| 36 | `customer_refund_bank_details` | Contact Support | trydood.com/contact |
| 38 | `customer_claim_expired` | Contact Support | trydood.com/contact |

## Sign-in behaviour

| Surface | Not signed in |
|---|---|
| Vendor panel `https://vendor.trydood.com` | Panel auth guard shows login, then continues to the page. Nothing appended to the URL — the route *is* the destination. |
| Admin panel `https://admin.trydood.com` | Same. |
| Customer app `https://app.trydood.com` | Installed + signed in: that screen. Signed out: login, then that screen. **Not installed:** opens in a browser, and the page at that host sends the visitor to the store. That cannot be expressed in the link. |
| Documents `https://api.trydood.com` | No sign-in — the token in the URL is the authorisation. |
| Website `https://trydood.com` | Public. |

## Backend (public) — 10 buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `vendor_subscription_activated` | Download Invoice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 2 | `vendor_subscription_renewed` | Download Invoice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 3 | `vendor_subscription_upgraded` | Download Invoice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 4 | `vendor_subscription_downgraded` | Download Invoice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 5 | `vendor_subscription_granted` | Download Advice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 20 | `vendor_settlement_paid` | Download Statement | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 29 | `vendor_dispute_resolved_lost` | Download Advice | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 30 | `customer_payment_success` | Download Receipt | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 35 | `customer_refund_completed` | Download Receipt | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |
| 37 | `customer_voucher_refunded` | Download Receipt | Dynamic | `https://api.trydood.com/trydood/v1/documents/{{1}}` | documentToken (64-char hex) | GET /trydood/v1/documents/:token — already live | `documentUrl(token)` | Exists |

## Vendor panel — 27 buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `vendor_subscription_activated` | View Subscription | Static | `https://vendor.trydood.com/subscription` | — | The vendor's own subscription page — NOT the plan list | `PANEL_PATHS.SUBSCRIPTION` | Confirm route |
| 2 | `vendor_subscription_renewed` | View Subscription | Static | `https://vendor.trydood.com/subscription` | — | The vendor's own subscription page — NOT the plan list | `PANEL_PATHS.SUBSCRIPTION` | Confirm route |
| 3 | `vendor_subscription_upgraded` | View Subscription | Static | `https://vendor.trydood.com/subscription` | — | The vendor's own subscription page — NOT the plan list | `PANEL_PATHS.SUBSCRIPTION` | Confirm route |
| 4 | `vendor_subscription_downgraded` | View Subscription | Static | `https://vendor.trydood.com/subscription` | — | The vendor's own subscription page — NOT the plan list | `PANEL_PATHS.SUBSCRIPTION` | Confirm route |
| 5 | `vendor_subscription_granted` | View Subscription | Static | `https://vendor.trydood.com/subscription` | — | The vendor's own subscription page — NOT the plan list | `PANEL_PATHS.SUBSCRIPTION` | Confirm route |
| 6 | `vendor_subscription_expiring` | Renew Now | Static | `https://vendor.trydood.com/subscription/plans` | — | The plan list — correct here, the vendor is choosing | `PANEL_PATHS.SUBSCRIPTION_PLANS` | Exists |
| 7 | `vendor_subscription_expired` | Renew Now | Static | `https://vendor.trydood.com/subscription/plans` | — | The plan list | `PANEL_PATHS.SUBSCRIPTION_PLANS` | Exists |
| 8 | `vendor_subscription_cancelled` | Subscribe Again | Static | `https://vendor.trydood.com/subscription/plans` | — | The plan list | `PANEL_PATHS.SUBSCRIPTION_PLANS` | Exists |
| 9 | `brand_under_review` | Track Application | Static | `https://vendor.trydood.com/onboarding/status` | — | onboarding/status | `PANEL_PATHS.ONBOARDING_STATUS` | Exists |
| 10 | `brand_resubmitted` | Track Application | Static | `https://vendor.trydood.com/onboarding/status` | — | onboarding/status | `PANEL_PATHS.ONBOARDING_STATUS` | Exists |
| 11 | `brand_approved` | Go to Dashboard | Static | `https://vendor.trydood.com/dashboard` | — | dashboard | `PANEL_PATHS.DASHBOARD` | Exists |
| 12 | `brand_rejected` | Update and Resubmit | Static | `https://vendor.trydood.com/onboarding/review` | — | onboarding/review | `PANEL_PATHS.ONBOARDING_FIX` | Exists |
| 13 | `brand_approval_revoked` | Review Details | Static | `https://vendor.trydood.com/onboarding/review` | — | onboarding/review | `PANEL_PATHS.ONBOARDING_FIX` | Exists |
| 15 | `brand_activated` | Sign In | Static | `https://vendor.trydood.com/dashboard` | — | dashboard — the panel's own auth guard sends them to login first | `PANEL_PATHS.DASHBOARD` | Exists |
| 17 | `brand_visible_to_customers` | Open Dashboard | Static | `https://vendor.trydood.com/dashboard` | — | dashboard | `PANEL_PATHS.DASHBOARD` | Exists |
| 18 | `vendor_voucher_claim_received` | View Transaction | Dynamic | `https://vendor.trydood.com/transactions/{{1}}` | transactionId | transactions/:transactionId — this claim's full detail, not the list | `PANEL_PATHS.transaction(id)` | NEW — constant does not exist |
| 19 | `vendor_plan_limit_reached` | Upgrade Plan | Dynamic | `https://vendor.trydood.com/subscription/plans/{{1}}` | subscriptionId of the suggested plan | subscription/plans/:planId — opens that plan ready to buy | `PANEL_PATHS.planCheckout(planId)` | NEW — constant and route both missing |
| 20 | `vendor_settlement_paid` | View Settlement | Dynamic | `https://vendor.trydood.com/settlements/{{1}}` | settlementId | settlements/:settlementId | `PANEL_PATHS.settlement(id)` | Exists |
| 21 | `vendor_settlement_failed` | View Settlement | Dynamic | `https://vendor.trydood.com/settlements/{{1}}` | settlementId | settlements/:settlementId | `PANEL_PATHS.settlement(id)` | Exists |
| 22 | `vendor_settlement_on_hold` | View Settlement | Dynamic | `https://vendor.trydood.com/settlements/{{1}}` | settlementId | settlements/:settlementId | `PANEL_PATHS.settlement(id)` | Exists |
| 23 | `vendor_settlement_carried_forward` | View Statement | Dynamic | `https://vendor.trydood.com/settlements/{{1}}` | settlementId | settlements/:settlementId | `PANEL_PATHS.settlement(id)` | Exists |
| 24 | `vendor_refund_requested` | Review Refund | Dynamic | `https://vendor.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId — this request, opened ready to decide | `PANEL_PATHS.refund(id)` | NEW — constant does not exist |
| 25 | `vendor_refund_reminder` | Review Refund | Dynamic | `https://vendor.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `PANEL_PATHS.refund(id)` | NEW — constant does not exist |
| 26 | `vendor_refund_completed` | View Refund | Dynamic | `https://vendor.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `PANEL_PATHS.refund(id)` | NEW — constant does not exist |
| 27 | `vendor_dispute_raised` | Open Dispute | Dynamic | `https://vendor.trydood.com/disputes/{{1}}` | disputeId | disputes/:disputeId — where the vendor adds their evidence | `PANEL_PATHS.dispute(id)` | Exists |
| 28 | `vendor_dispute_resolved_won` | Open Dispute | Dynamic | `https://vendor.trydood.com/disputes/{{1}}` | disputeId | disputes/:disputeId | `PANEL_PATHS.dispute(id)` | Exists |
| 29 | `vendor_dispute_resolved_lost` | Open Dispute | Dynamic | `https://vendor.trydood.com/disputes/{{1}}` | disputeId | disputes/:disputeId | `PANEL_PATHS.dispute(id)` | Exists |

## Website — 8 buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
| 12 | `brand_rejected` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 13 | `brand_approval_revoked` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 14 | `brand_deactivated` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 16 | `brand_hidden_from_customers` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 21 | `vendor_settlement_failed` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 34 | `customer_refund_rejected` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 36 | `customer_refund_bank_details` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |
| 38 | `customer_claim_expired` | Contact Support | Static | `https://trydood.com/contact` | — | trydood.com/contact | `— (external, fixed URL)` | Confirm page exists |

## Customer app — 9 buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
| 30 | `customer_payment_success` | View Order | Dynamic | `https://app.trydood.com/orders/{{1}}` | claimId | orders/:claimId — this order, not the list | `CUSTOMER_PATHS.order(claimId)` | Exists |
| 31 | `customer_payment_failed` | Try Again | Dynamic | `https://app.trydood.com/vouchers/{{1}}` | voucherId | vouchers/:voucherId — reopens the same voucher ready to pay | `CUSTOMER_PATHS.voucher(voucherId)` | Exists |
| 32 | `customer_refund_requested` | Track Refund | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `CUSTOMER_PATHS.refund(requestId)` | Exists |
| 33 | `customer_refund_approved` | Track Refund | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `CUSTOMER_PATHS.refund(requestId)` | Exists |
| 34 | `customer_refund_rejected` | View Refund | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `CUSTOMER_PATHS.refund(requestId)` | Exists |
| 35 | `customer_refund_completed` | View Refund | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `CUSTOMER_PATHS.refund(requestId)` | Exists |
| 36 | `customer_refund_bank_details` | Add Bank Account | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId → the add-bank-account screen. App installed and signed in: straight there. Signed out: login, then there. Not installed: the store. | `CUSTOMER_PATHS.refund(requestId)` | Exists — app link behaviour to confirm |
| 37 | `customer_voucher_refunded` | View Refund | Dynamic | `https://app.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `CUSTOMER_PATHS.refund(requestId)` | Exists |
| 38 | `customer_claim_expired` | View Order | Dynamic | `https://app.trydood.com/orders/{{1}}` | claimId | orders/:claimId | `CUSTOMER_PATHS.order(claimId)` | Exists |

## Admin panel — 4 buttons

| # | Template | Button | Type | Full URL | Dynamic part | Front-end route | Backend constant | Status |
|---|---|---|---|---|---|---|---|---|
| 39 | `admin_refund_failed` | Open Refund | Dynamic | `https://admin.trydood.com/refunds/{{1}}` | refundRequestId | refunds/:refundRequestId | `ADMIN_PATHS.refund(requestId)` | Exists |
| 40 | `admin_settlement_ledger_drift` | Open Settlement | Dynamic | `https://admin.trydood.com/settlements/{{1}}` | settlementId | settlements/:settlementId | `ADMIN_PATHS.settlement(settlementId)` | Exists |
| 41 | `admin_payment_disputed` | Open Dispute | Dynamic | `https://admin.trydood.com/disputes/{{1}}` | transactionId — the admin worklist is keyed on the payment | disputes/:transactionId | `ADMIN_PATHS.dispute(transactionId)` | Exists |
| 42 | `admin_dispute_deadline` | Open Dispute | Dynamic | `https://admin.trydood.com/disputes/{{1}}` | transactionId | disputes/:transactionId | `ADMIN_PATHS.dispute(transactionId)` | Exists |

## Backend constants

All in `server/helpers/notifications/panelLinks.js`. A route rename is one edit
there and every channel follows — WhatsApp button, email button, in-app row, push.

| Constant | Status | Produces |
|---|---|---|
| `documentUrl(token)` | Exists | `https://api.trydood.com/trydood/v1/documents/{{1}}` |
| `PANEL_PATHS.SUBSCRIPTION` | Confirm route | `https://vendor.trydood.com/subscription` |
| `PANEL_PATHS.SUBSCRIPTION_PLANS` | Exists | `https://vendor.trydood.com/subscription/plans` |
| `PANEL_PATHS.ONBOARDING_STATUS` | Exists | `https://vendor.trydood.com/onboarding/status` |
| `PANEL_PATHS.DASHBOARD` | Exists | `https://vendor.trydood.com/dashboard` |
| `PANEL_PATHS.ONBOARDING_FIX` | Exists | `https://vendor.trydood.com/onboarding/review` |
| `— (external, fixed URL)` | Confirm page exists | `https://trydood.com/contact` |
| `PANEL_PATHS.transaction(id)` | NEW — constant does not exist | `https://vendor.trydood.com/transactions/{{1}}` |
| `PANEL_PATHS.planCheckout(planId)` | NEW — constant and route both missing | `https://vendor.trydood.com/subscription/plans/{{1}}` |
| `PANEL_PATHS.settlement(id)` | Exists | `https://vendor.trydood.com/settlements/{{1}}` |
| `PANEL_PATHS.refund(id)` | NEW — constant does not exist | `https://vendor.trydood.com/refunds/{{1}}` |
| `PANEL_PATHS.dispute(id)` | Exists | `https://vendor.trydood.com/disputes/{{1}}` |
| `CUSTOMER_PATHS.order(claimId)` | Exists | `https://app.trydood.com/orders/{{1}}` |
| `CUSTOMER_PATHS.voucher(voucherId)` | Exists | `https://app.trydood.com/vouchers/{{1}}` |
| `CUSTOMER_PATHS.refund(requestId)` | Exists | `https://app.trydood.com/refunds/{{1}}` |
| `ADMIN_PATHS.refund(requestId)` | Exists | `https://admin.trydood.com/refunds/{{1}}` |
| `ADMIN_PATHS.settlement(settlementId)` | Exists | `https://admin.trydood.com/settlements/{{1}}` |
| `ADMIN_PATHS.dispute(transactionId)` | Exists | `https://admin.trydood.com/disputes/{{1}}` |
