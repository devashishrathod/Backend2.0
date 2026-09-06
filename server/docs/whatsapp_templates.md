# Notification & WhatsApp template inventory

> Ye section code se generated hai — `constants/notification.js`,
> `helpers/notifications/*Notices.js`, `configs/whatsapp.js`. Neeche ke template
> bodies wahi hain jo pehle se likhe the; sirf ye inventory upar add hui hai.

## Pehle: WhatsApp actually kab jata hai

⚠️ **Ab ek chautha gate hai — recipient ki apni preference.**
`User.notificationPreferences.whatsapp` off ho to us bande ko WhatsApp nahi jayega,
chahe baaki teeno gates khule hon. Chhe types ise override karte hain (wo jinme
chup rehna padhne wale ka hi nuksaan hai) — poora rule
[`notification_preferences.md`](./notification_preferences.md) me.

Aur platform toggle ab **teen alag** hain — `vendor.subscription`,
`customer.notification`, `admin.notification`. Pehle admin vendor ke block me
girta tha, to vendor ka WhatsApp band karne se admin ka bhi band ho jaata tha.

Teen gates, `helpers/notifications/notify.js` me — **teeno chahiye**, warna
WhatsApp chup-chaap skip ho jata hai (in-app row aur email phir bhi jate hain):

1. **Admin toggle** — `isWhatsAppNotificationEnabled === true`. Vendor/admin ke
   liye `Setting.vendor.subscription`, customer ke liye
   `Setting.customer.notification` se padha jata hai.
2. **Approved template** — env var `WHATSAPP_TEMPLATE_<NOTIFICATION_TYPE>` me
   Meta-approved template ka naam. `configs/whatsapp.js` isko call-time pe padhta
   hai, boot pe freeze nahi karta — matlab env me daal ke restart, koi code change
   nahi.
3. **Params from the caller** — notice helper ko `whatsapp: { params: [...],
   urlParam }` pass karna padta hai. **Ye teesra gate sabse zyada miss hota hai:**
   template Meta se approve ho jaye aur env me set bhi ho, phir bhi kuch nahi
   jayega jab tak helper params na bheje.

Params **positional aur comma-joined** hain (`maxParams: 10`,
`maxParamLength: 200`). `sendWhatsApp` comma/newline strip karta hai aur khali
value ko `-` bana deta hai — drop nahi karta, kyunki ek drop hone se uske baad ka
har variable shift ho jata hai.

`urlParam` = template ke dynamic URL button ka **last path segment only** (Meta
base URL ko approve karta hai), poora URL nahi.

## Ginti, aaj ki date me

| | Count |
|---|---|
| Notification types declared (`constants/notification.js`) | **50** |
| Types jo actually kahin se send hote hain | 48 |
| Declared hain par koi bhejta nahi | 2 — `LIMIT_REACHED`, `BRAND_SUBSCRIPTION_LAPSED` |
| Distinct send sites (notice functions + inline `notifyAdmins`) | 48 |
| Types jinme WhatsApp params **code me wired** hain | **17** |
| Types jinme WhatsApp bilkul nahi hai | **33** |
| Is doc me draft kiye gaye templates | 19 (18 body ke saath, 1 placeholder) |
| Doc me draft **aur** code me wired | 17 |
| Doc me draft par code me wired **nahi** | 2 — dono `customer_paid_vendor_voucher_claim_…` |
| Code me wired par doc me body **nahi** | 1 — `brand_visible_to_customers` (placeholder) |

Role-wise split: **vendor 26 types**, **customer 7**, **admin 15**, **shared 2**
(`REFUND_REQUESTED` vendor+customer dono ko, `ANNOUNCEMENT` kisi bhi audience ko).

---

## VENDOR ko jane wale notifications (26 + 2 shared)

WA = WhatsApp. ✅ = params code me wired hain. ❌ = sirf in-app + email + push.

### Subscription (8) — `helpers/notifications/subscriptionNotices.js`

| # | Type | Kab jata hai | Sev | WA | Template (doc) |
|---|---|---|---|---|---|
| 1 | `SUBSCRIPTION_ACTIVATED` | Naya plan paid + activate hua | INFO | ✅ 2 vars | `vendor_subscription_activated` |
| 2 | `SUBSCRIPTION_RENEWED` | Wahi plan renew hua | INFO | ✅ 2 | `vendor_subscription_renewed` |
| 3 | `SUBSCRIPTION_UPGRADED` | Bade plan pe gaye | INFO | ✅ 2 | `vendor_subscription_upgraded` |
| 4 | `SUBSCRIPTION_DOWNGRADED` | Chote plan pe gaye | INFO | ✅ 2 | `vendor_subscription_downgraded` |
| 5 | `SUBSCRIPTION_GRANTED` | Admin ne free/manual plan diya | INFO | ✅ 2 | `vendor_subscription_granted` |
| 6 | `SUBSCRIPTION_EXPIRING` | Expiry reminder job, per offset | WARN / CRIT (≤1 din) | ✅ 3 | `vendor_subscription_expiring` |
| 7 | `SUBSCRIPTION_EXPIRED` | Expiry sweep ne plan band kiya | CRIT | ✅ 2 | `vendor_subscription_expired` |
| 8 | `SUBSCRIPTION_CANCELLED` | Admin ne end date se pehle revoke kiya | CRIT | ✅ 1 | `vendor_subscription_cancelled` |

⚠️ 1–5 ek hi function se aate hain (`notifySubscriptionActivated`) aur **same 2
params** bhejte hain — plan, valid till. Isliye chaho to ek hi template body paanch
jagah chal sakti hai.

### Brand verification / onboarding (5) — `brandVerificationNotices.js`

| # | Type | Kab | Sev | WA | Template |
|---|---|---|---|---|---|
| 9 | `BRAND_UNDER_REVIEW` | Documents pehli baar submit hue | INFO | ✅ 2 | `brand_under_review` |
| 10 | `BRAND_RESUBMITTED` | Reject ke baad dobara submit | INFO | ✅ 2 | `brand_resubmitted` |   => resubmit to brand khud krta hai ye bhi brand vendor ko jata hai kya agr jata ho to , admin ko jana chiye brand ko nhi 
| 11 | `BRAND_APPROVED` | Admin ne approve kiya | INFO | ✅ 2 | `brand_approved` |
| 12 | `BRAND_REJECTED` | Admin ne reject kiya (reason ke saath) | WARN | ✅ 3 | `brand_rejected` |
| 13 | `BRAND_APPROVAL_REVOKED` | Approval wapas le liya gaya | CRIT | ✅ 3 | `brand_approval_revoked` |

Verification history 9 events record karti hai, message sirf in 5 ka jata hai —
"reviewed / unreviewed toggle", "approval acknowledged", "onboarding step saved",
"remediation edit" jaan-boojh ke silent hain.

### Brand status / visibility (4) — `brandStatusNotices.js`

| # | Type | Kab | Sev | WA | Template |
|---|---|---|---|---|---|
| 14 | `BRAND_DEACTIVATED` | Admin ne account off kiya (login band) | CRIT | ✅ 2 | `brand_deactivated` |
| 15 | `BRAND_ACTIVATED` | Account wapas on | INFO | ✅ 2 | `brand_activated` |
| 16 | `BRAND_HIDDEN_FROM_CUSTOMERS` | Customer app se de-list | WARN | ✅ 2 | `brand_hidden_from_customers` |
| 17 | `BRAND_VISIBLE_TO_CUSTOMERS` | Wapas visible | INFO | ✅ 2 | ⚠️ placeholder only |

⚠️ `BRAND_DEACTIVATED` pe **push jaan-boojh ke off hai** — usi operation me device
tokens retire ho jate hain. Locked-out vendor tak sirf email aur WhatsApp pahunchte
hain, isliye WhatsApp isi notice pe sabse zyada matter karta hai.

### Voucher claim (1) — `voucherClaimNotices.js`

| # | Type | Kab | Sev | WA |
|---|---|---|---|---|
| 18 | `VOUCHER_CLAIM_RECEIVED` | Customer ne outlet pe claim + pay kiya | INFO | ❌ |

Doc me iske do template drafted hain
(`customer_paid_vendor_voucher_claim_transaction_payment_success` / `_failed`), par
code me **na params hain na failed-case ka vendor notice** — payment fail hone par
vendor ko aaj kuch nahi jata.

⚠️ Code me note hai: 50 claims/day wala brand 50 notification payega. Us volume pe
per-outlet hourly digest banana padega.

### Settlement / payout (4) — `settlementNotices.js`

| # | Type | Kab | Sev | WA |
|---|---|---|---|---|
| 19 | `SETTLEMENT_PAID` | Payout bank ko chala gaya (UTR ke saath) | INFO | ❌ |
| 20 | `SETTLEMENT_FAILED` | Transfer bank ne wapas kiya | WARN | ❌ |
| 21 | `SETTLEMENT_ON_HOLD` | Payout review pe rok diya gaya | WARN | ❌ |
| 22 | `SETTLEMENT_CARRIED_FORWARD` | Deductions > sales, is cycle me kuch nahi mila | WARN | ❌ |

`DRAFT` / `PENDING_APPROVAL` / `APPROVED` pe kuch nahi jata — vendor ke liye wahan
karne ko kuch nahi hai. `CARRIED_FORWARD` ke do matlab hain aur sirf ek bheja jata
hai: "₹500 minimum se neeche" silent, "deductions sales se zyada" bheja jata hai.

### Refund, vendor side (2) — `refundNotices.js`

| # | Type | Kab | Sev | WA |
|---|---|---|---|---|
| 23 | `REFUND_REQUESTED` (vendor) | Customer ne refund manga, clock start | WARN | ❌ |
| 24 | `REFUND_REMINDER` | Vendor window band hone wali hai | WARN | ❌ |

### Dispute / chargeback, vendor side (2) — `disputeNotices.js`

| # | Type | Kab | Sev | WA |
|---|---|---|---|---|
| 25 | `DISPUTE_RAISED_VENDOR` | Customer ke bank ne unki sale pull back ki | WARN | ❌ |
| 26 | `DISPUTE_RESOLVED_VENDOR` | Won (hold release) ya lost (deduct hoga) | INFO / WARN | ❌ |

### Declared par koi bhejta nahi

`LIMIT_REACHED` — plan limit (outlets/vouchers) khatam hone par bhejne ke liye
banaya gaya tha, aaj koi call site nahi hai. => bna do iske liye or isme jo plan hoga usse updated vala plan lene ke liye details or redirect to plan page checkout par chle jayega ... esa logic rhega url button se but plan ki detials or usme limits show kre .. current + upgrade par increses limi ye sab proper 

---

## CUSTOMER ko jane wale notifications (7 + 2 shared)

**Poore customer side pe WhatsApp params ek bhi nahi hain.** Aaj customer ko sirf
in-app + email + push jata hai.

### Voucher claim (4) — `voucherClaimNotices.js`

| # | Type | Kab | Sev | WA | Deep link |
|---|---|---|---|---|---|
| 27 | `VOUCHER_PAYMENT_SUCCESS` | Payment success — **ye hi receipt hai, Download Invoice button isme hai** | INFO | ❌ | `orders/<claimId>` |
| 28 | `VOUCHER_PAYMENT_FAILED` | Gateway ne mana kiya ya customer chala gaya | WARN | ❌ | `vouchers/<voucherId>` |
| 29 | `VOUCHER_REFUNDED` | Paisa wapas gaya | INFO | ❌ | `transactions/<txnId>` |
| 30 | `VOUCHER_CLAIM_EXPIRED` | Paid claim window ke andar scan nahi hua (Phase 2, abhi inert) | WARN | ❌ | `orders/<claimId>` |

### Refund, customer side (4 messages / 3 types) — `refundNotices.js`

| # | Type | Kab | Sev | WA |
|---|---|---|---|---|
| 31 | `REFUND_REQUESTED` (customer) | "Aapki request mil gayi" | INFO | ❌ |
| 32 | `REFUND_APPROVED` | Approve hua (partial ho to saaf bola jata hai) | INFO | ❌ |
| 33 | `REFUND_REJECTED` | Approve nahi hua | INFO | ❌ |
| 34 | `REFUND_BANK_DETAILS_REQUESTED` | Original method pe wapas nahi ja saka, bank account chahiye | INFO | ❌ |
| 34b | wahi type, reminder | Kuch **din** baad nudge (`stage` ke saath) | INFO | ❌ |

⚠️ `REFUND_BANK_DETAILS_REQUESTED` ek hi customer notice hai jo customer se **kaam
karwata** hai, aur wahi cheez maangta hai jo scam message maangta hai. Isliye copy
me: claim ka naam, "paisa aapka hi hai", reason, aur **app ke andar** bhejta hai —
kisi link pe form nahi. "Hum kabhi call/message pe details nahi maangte" line
jaan-boojh ke hai. Reminder **ghanton me nahi, dino me** bheja jata hai.

`PROCESSING` aur `ADMIN_APPROVED` pe koi message nahi — real transitions hain par
customer wahan kuch nahi kar sakta. => email or push jayege isme whatsapp ki need nhi 

---

## ADMIN ko jane wale notifications (15)

Sab `notifyAdmins()` ya `notify({ audience: ADMIN })` se — **per active admin ek
row** (feed per-user padha jata hai, ek shared row pehla kholne wale ke liye read
ho jata). **Admin side pe bhi WhatsApp ek bhi nahi hai.**

| # | Type | Kab | Sev | Kahan se |
|---|---|---|---|---|
| 35 | `BRAND_AWAITING_REVIEW` | Brand ne documents submit kiye, decision chahiye | WARN | `brandVerificationNotices.js` | no need 
| 36 | `BRAND_AWAITING_RE_REVIEW` | Reject ke baad resubmit hua | WARN | ,, | no need
| 37 | `REFUND_ESCALATED` | Vendor window me jawab nahi diya | WARN | `refundNotices.js` | no need
| 38 | `REFUND_FAILED` | Paisa customer tak wapas nahi pahuncha | **CRIT** | ,, | required with details reason , customer , voucher , transaction ke sath or reirect to the refund history jha pura sab dikhe 
| 39 | `REFUND_BANK_DETAILS_STALE` | Customer ne hafton se account details nahi diye — vendor ka settlement hold tab tak frozen hai | WARN | ,, |
| 40 | `SETTLEMENT_STUCK` | `MANUAL_BANK` NEFT start hua, UTR kabhi confirm nahi hua | WARN | `settlementNotices.js` |
| 41 | `SETTLEMENT_LATE` | Paisa promise kiye window se zyada der se ruka hai | WARN | ,, |
| 42 | `SETTLEMENT_LEDGER_DRIFT` | Payout legs aur ledger ka total match nahi kar raha | **CRIT** | ,, | => reqiuire with essential detials 
| 43 | `VENDOR_DEBT_AGED` | Brand ka debt jise koi cycle collect nahi kar sakti (roz ek, per brand) | WARN | ,, |
| 44 | `SHADOW_INDEX_REAPED` | Blanket unique index mila aur hataya gaya — matlab koi **dusra process** is DB pe likh raha hai | **CRIT** | `indexNotices.js` |
| 45 | `PAYMENT_DISPUTED` | Chargeback khula (deadline miss = paisa gaya) | **CRIT** | `handleRazorpayWebhook.js` | => required with details 
| 46 | `DISPUTE_DEADLINE` | Response deadline paas ya nikal gayi (72h / 24h / overdue) | WARN → CRIT | `disputeNotices.js` | required with details 
| 47 | `PROMO_LIMIT_EXCEEDED` | Subscription promo code apni cap se aage nikal gaya | WARN | `settleSubscriptionPayment.js` | 
| 48 | `WEBHOOK_FAILED` | **7 alag alerts, ek hi type pe** — neeche | WARN / CRIT | 5 files |
| — | `BRAND_SUBSCRIPTION_LAPSED` | Paying brand ka plan lapse hua, follow-up worth | — | ⚠️ koi call site nahi |

### ⚠️ `WEBHOOK_FAILED` overloaded hai — 7 different alerts

| Kya hua | Sev | File |
|---|---|---|
| Captured payment ka koi settler nahi mila | CRIT | `handleRazorpayWebhook.js:355` |
| Webhook galat endpoint pe deliver hua | WARN | `handleRazorpayWebhook.js:1114` |
| Verified webhook process nahi ho saka | CRIT | `handleRazorpayWebhook.js:1183` |
| Ek order pe double capture — customer do baar charge hua | CRIT | `detectDoubleCapture.js:56` |
| Once-per-user slot conflict — offer do baar redeem | WARN | `settleVoucherClaimPayment.js:263` |
| Voucher promo code cap se aage | WARN | `settleVoucherClaimPayment.js:422` |
| Settlement resume fail / reconciliation ne recover kiya / authorized-never-captured | CRIT/WARN | `claimJobs.js:260, 317, 373` |

Filter/report ke liye ye 7 alag types hone chahiye — abhi ek hi bucket me hain, aur
`PROMO_LIMIT_EXCEEDED` type exist karta hai par voucher side `WEBHOOK_FAILED` use
kar raha hai.

### `ANNOUNCEMENT` — kisi bhi audience ko

`POST` broadcast → `services/notifications/broadcastNotification.js` →
`notifyAudience`. Targeting declarative hai: `userIds`, `roles`, `brandIds`,
`customerIds`, `subBrandIds`, `all`. `dryRun` audience ka size batata hai bheje
bina. Email **off by default** (fan-out hazaron ka ho sakta hai), WhatsApp bilkul
nahi. Max 5000 recipients per dispatch.

---

## ⚠️ Doc ke templates aur code ke params match nahi karte

Meta template ko **fixed variable count** pe approve karta hai. Neeche wale sab
templates is doc me zyada variables ke saath likhe hain jitne code actually bhejta
hai — inhe aise hi submit kar diya to message ya reject hoga ya galat slot me values
aayengi. **Meta pe submit karne se pehle ye decide karna hai: doc ke hisaab se code
badlega, ya code ke hisaab se template.**

| Template | Doc vars | Code params | Farak |
|---|---|---|---|
| `vendor_subscription_activated` | 5 — name, plan, start, expiry, amount | 2 — plan, expiry | name / start / amount code me nahi |
| `vendor_subscription_renewed` | 5 | 2 | ,, |
| `vendor_subscription_upgraded` | 6 — name, old plan, new plan, date, expiry, amount | 2 — plan, expiry | old plan bhi nahi jata |
| `vendor_subscription_downgraded` | 5 | 2 | ,, |
| `vendor_subscription_granted` | 5 — + access type | 2 | access type nahi jata |
| `vendor_subscription_expiring` | 4 — name, plan, expiry, days | 3 — plan, **days, expiry** | count aur **order dono** alag |
| `vendor_subscription_expired` | 3 | 2 | name nahi |
| `vendor_subscription_cancelled` | 4 | **1** — sirf plan | date / access-until nahi |
| `brand_under_review` | 3 — name, brand, date | 2 | date nahi |
| `brand_resubmitted` | 3 | 2 | ,, |
| `brand_approved` | 3 | 2 | ,, |
| `brand_rejected` | 4 — name, brand, date, reason | 3 — name, brand, reason | date nahi |
| `brand_approval_revoked` | 4 | 3 | ,, |
| `brand_deactivated` | 4 — + reason | 2 — name, brand | **reason jaan-boojh ke nahi bheja jata** — neeche dekho |
| `brand_activated` | 3 | 2 | date nahi |
| `brand_hidden_from_customers` | 4 — + reason | 2 | reason jaan-boojh ke nahi |
| `brand_visible_to_customers` | — | 2 | body draft nahi hui |
| `customer_paid_..._payment_success` | 7 | **0 — WhatsApp wired nahi** | poora notice hi WhatsApp pe nahi jata |
| `customer_paid_..._payment_failed` | 7 | **koi notice hi nahi** | vendor ko failed payment ka message aaj nahi jata |

### Do jagah "reason" ka farak deliberate hai

- **Verification rejection reason** vendor ke liye likha jata hai, aur `{{4}}` /
  `{{3}}` me jata bhi hai — `brand_rejected`, `brand_approval_revoked`.
- **Brand deactivate / hide ka admin note** staff-to-staff hota hai ("suspected
  fake GST, flagged by ops") aur vendor ko verbatim nahi padha jata — wo `meta` me
  rehta hai. Isliye `brand_deactivated` aur `brand_hidden_from_customers` me reason
  variable nahi hai.

Doc me dono jagah reason likha hai. Agar deactivation reason vendor ko dikhana hai
to wo ek product decision hai, template ki galti nahi.

## Email ka mail contract (template likhne se pehle padh lo)

Notice helper `mail: { … }` deta hai, `notify()` usko **jaisa hai waisa** aage
bhejta hai, aur `renderMailHtml` render karta hai. Koi field list nahi hai —
naya field add karne pe `notify` ya `sendMail` chhune ki zaroorat nahi.

| Field | Kya karta hai |
|---|---|
| `title` | Heading. Na do to notification ka `title` chalta hai |
| `body` | Paragraph. Na do to notification ka `body` |
| `lines` | `[["Label", "Value"], …]` — detail table |
| `ctaLabel` + `ctaUrl` | **Ek button** — canonical form, aur common case |
| `actions: [{label, url}]` | **Do ya zyada** button, isi order me. Pehla filled, baaki outlined |
| `footnote` | Chhoti grey line, table ke neeche |
| `subject` | Mail subject. Na do to `title` |

⚠️ `ctaUrl` `undefined` ho to button **render nahi hota** (jaan-boojh ke — hostless
link se better hai no link). `vendorUrl` / `adminUrl` / `invoiceUrl` `undefined`
lautate hain jab `VENDOR_PANEL_URL` / `ADMIN_PANEL_URL` / `PUBLIC_API_URL` set na
ho. Ab boot pe ek line batati hai kaunsa unset hai, aur `sendMail` ek warn deta hai
— pehle ye poori tarah silent tha.

⚠️ Purana naam `buttonText` / `buttonUrl` ab bhi kaam karta hai par **warn karta
hai** — jaan-boojh ke, taaki galat naam se dobara koi button na gire. Naya code
`ctaLabel` / `ctaUrl` use karega. Ek test (`mailRender.test.js`) check karta hai ki
koi notice file purana naam wapas na le aaye.

## ⚠️ Code-level gaps

**1. `VOUCHER_PAYMENT_SUCCESS` ka WhatsApp kabhi ja hi nahi sakta.**
`voucherClaimNotices.js:89` `notify()` ko top level pe `whatsappUrlParam:
transaction.invoiceToken` deta hai. `notify()` sirf `whatsapp.urlParam` padhta hai
aur bhejne ke liye `whatsapp.params` chahiye — dono nahi hain, to invoice token chup
chaap drop ho jata hai aur message skip. Comment kehta hai ki URL button ke liye
token bheja ja raha hai, par shape galat hai.

**2. ✅ FIXED — 19 emails ka CTA button render hi nahi hota tha.**

`notify()` `mail` ke fields **ek-ek naam se** forward karta tha, aur 5 files
`buttonText` / `buttonUrl` bhejti thi — jo us list me nahi tha, to raste me hi gir
jata tha. Mail jata tha, poora normal dikhta tha, row pe `EMAIL` channel bhi lagta
tha, bas button nahi hota tha. Na error, na log.

Kya badla:

- `notify()` ab `mail` ko **spread** karta hai, list nahi banata — to aage koi bhi
  naya field bina change kaam karega. `to` spread ke **baad** set hota hai, taaki
  koi notice apni mail redirect na kar sake.
- `sendMail` ki signature sirf `to` / `subject` / `title` naam leti hai; baaki sab
  `...content` se renderer ko jata hai.
- `normaliseActions()` ek hi jagah button ko normalise karta hai — `ctaLabel/ctaUrl`,
  `actions[]`, aur purana `buttonText/buttonUrl` (warn ke saath) teeno chalte hain.
- 5 files ke 19 call sites `ctaLabel` / `ctaUrl` pe rename ho gaye.
- Boot pe `mail CTA` line + `sendMail` ka warn — silence khatam.
- `__tests__/money/mailRender.test.js` — 49 tests, rendered HTML pe assert karte hain
  (yahi gap tha: purane tests `notify` ko mock karke ruk jate the).

---

## Vendor subscription templates

Template Name: vendor_subscription_activated
🎉 Subscription Activated Successfully!
Hello {{1}},
Your Trydood subscription has been successfully activated. ✅
📋 Plan: {{2}}
📅 Start Date: {{3}}
📅 Expiry Date: {{4}}
💰 Amount Paid: ₹{{5}}
Thank you for choosing Trydood! We’re happy to have you with us. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀


Template Name: vendor_subscription_renewed
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
Variable mapping example:
{{1}} — Vendor Name — ABC Salon
{{2}} — Subscription Plan — Prime Plus
{{3}} — Renewal Date — 29 Aug 2026
{{4}} — New Expiry Date — 29 Aug 2027
{{5}} — Amount Paid — ₹1,999


Template Name: vendor_subscription_upgraded
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

Variable mapping example
{{1}} = ABC Salon
{{2}} = Pro Lite
{{3}} = Pro Plus
{{4}} = 29 Aug 2026
{{5}} = 29 Aug 2027
{{6}} = 1,999

Template Name: vendor_subscription_downgraded
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
Variable mapping example:
{{1}} — Customer name
{{2}} — Previous Subscription Plan
{{3}} — New Subscription  Plan
{{4}} — Effective date
{{5}} — Expiry Date

Template Name: vendor_subscription_granted
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

Variable mapping example:
{{1}} — Customer/Vendor Name
{{2}} — Subscription Plan
{{3}} — Start Date
{{4}} — Expiry date
{{5}} — Access Type / Grant Reason

Template Name: vendor_subscription_expiring
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


Variable mapping example:
{{1}} — Customer/Vendor Name
{{2}} — Subscription Plan
{{3}} — Expiry Date
{{4}} — Days Remaining

Template Name: vendor_subscription_expired
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

Variable mapping example:
{{1}} — Customer/Vendor Name
{{2}} — Subscription Plan
{{3}} — Expiry Date

Template Name: vendor_subscription_cancelled
❌ Subscription Cancelled
Hello {{1}},
Your Trydood subscription has been successfully cancelled.
📋 Plan: {{2}}
📅 Cancellation Date: {{3}}
📅 Access Until: {{4}}
🔒 Status: Cancelled
Your subscription benefits will remain available until the access end date mentioned above.
We’re sorry to see you go. 💚 You can subscribe again anytime to continue enjoying Trydood benefits.
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Customer/Vendor Name
{{2}} — Subscription Plan
{{3}} — Subscription Plan
{{4}} — Access Until / Subscription End Date

## Brand verification templates

Template Name: brand_under_review
🔍 Brand Under Review
Hello {{1}},
Your brand {{2}} has been successfully submitted and is currently under review by the Trydood team. ⏳
📋 Brand Name: {{2}}
📅 Submitted Date: {{3}}
🔎 Status: Under Review
Our team will review the submitted details and notify you once the review is completed.
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Submitted Date

Template Name: brand_resubmitted
🔄 Brand Resubmitted Successfully
Hello {{1}},
Your brand {{2}} has been successfully resubmitted to Trydood for review. ✅
📋 Brand Name: {{2}}
📅 Resubmitted Date: {{3}}
🔎 Status: Under Review
Our team will review the updated details and notify you once the review is completed.
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Resubmitted Date

Template Name: brand_approved
🎉 Brand Approved Successfully!
Hello {{1}},
Great news! Your brand {{2}} has been successfully approved by the Trydood team. ✅
📋 Brand Name: {{2}}
📅 Approved Date: {{3}}
🔎 Status: Approved
Your brand is now ready to use on the Trydood platform. 🚀
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Approved Date

Template Name: brand_rejected
❌ Brand Submission Rejected
Hello {{1}},
Your brand {{2}} could not be approved by the Trydood team.
📋 Brand Name: {{2}}
📅 Review Date: {{3}}
🔎 Status: Rejected
📝 Reason: {{4}}
Please review the rejection reason, update the required details, and resubmit your brand for approval.
If you need assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Review Date
{{4}} — Rejection Reason

Template Name: brand_approval_revoked
⚠️ Brand Approval Revoked
Hello {{1}},
The approval for your brand {{2}} has been revoked by the Trydood team.
📋 Brand Name: {{2}}
📅 Revoked Date: {{3}}
🔎 Status: Approval Revoked
📝 Reason: {{4}}
Your brand is currently not approved for use on the Trydood platform.
Please review the reason provided, update the required details, and resubmit your brand for approval or contact our support team if you need clarification or further assistance.
For support, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Revoked Date
{{4}} — Revocation Reason

## Customer payment on voucher claim
Template Name: customer_paid_vendor_voucher_claim_transaction_payment_success
💰 Payment Received
Hello {{1}},
A customer has successfully completed a payment at your {{2}} outlet through Trydood. ✅
🧾 Transaction ID: {{3}}
💰 Amount Paid: ₹{{4}}
📅 Transaction Date: {{5}}
💳 Payment Method: {{6}}
👤 Customer: {{7}}
The transaction has been recorded successfully in your Trydood account.
Thank you for using Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor Name
{{2}} — Outlet / Brand Name
{{3}} — transactionId
{{4}} — Amount Paid
{{5}} — Transaction Date & Time
{{6}} — Payment Method
{{7}} — Customer Name

Template Name: customer_paid_vendor_voucher_claim_transaction_payment_failed
⚠️ Payment Failed
Hello {{1}},
A customer attempted to make a payment at your {{2}} outlet through Trydood, but the transaction was unsuccessful.
🧾 Transaction ID: {{3}}
💰 Amount: ₹{{4}}
📅 Date & Time: {{5}}
💳 Payment Method: {{6}}
🔎 Status: Payment Failed
📝 Reason: {{7}}
No successful payment has been recorded for this transaction.
Please check your Trydood vendor dashboard for more details.
For assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor Name
{{2}} — Outlet / Brand Name
{{3}} — Transaction ID
{{4}} — Transaction Amount
{{5}} — Transaction Date & Time
{{6}} — Payment Method
{{7}} — Payment Failure Reason



ye vale jo customer voucher claim vale hai isme proper voucher ka naam or percentage or jo offer apply hua ho, usse related data + promo agr ho to or time or outlet name na ho to brand ka name or ek or outlet ka location aana chiye, to template phle update krna mujhse confiermation lena uske bad banana mtlp phle kese dikhega or kesa aa ye ga ... 
or redirect link hogi vendor panel ki jisme click par vo us transaction list me chle jaye ........ 

or ese hi customer side bhi 2 template bnege agr paid or claim successfully hua to customer ko bhi notify hoga sab proper details ke sath or customer end me ek downlaod recipet / invoice ka ek button aayega jisme vo click krke invoice download kr skta hai or ek or jisme vo uski ki hui transaction list me aap par redirect ho jaye 

to phle ye template bhi bna kr btana kese dikhege or chlege fir implement krege ............. 

## Brand activation/deactivation templates 
Template Name: brand_deactivated
⚠️ Brand Deactivated
Hello {{1}},
Your brand {{2}} has been deactivated on the Trydood platform.
📋 Brand Name: {{2}}
📅 Deactivated Date: {{3}}
🔎 Status: Deactivated
📝 Reason: {{4}}
Your brand is currently inactive and will not be available for use on the Trydood platform.
If you believe this was done incorrectly or need assistance, please contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀

Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Deactivated Date
{{4}} — Deactivation Reason

Template Name: brand_activated
🎉 Brand Activated Successfully!
Hello {{1}},
Great news! Your brand {{2}} has been successfully activated on the Trydood platform. ✅
📋 Brand Name: {{2}}
📅 Activated Date: {{3}}
🔎 Status: Active
Your brand is now active and available for use on the Trydood platform. 🚀
Thank you for choosing Trydood. 💚
For any assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀
Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Activated Date

Template Name: brand_hidden_from_customers
⚠️ Brand Hidden from Customers
Hello {{1}},
Your brand {{2}} has been temporarily hidden from customers on the Trydood platform.
📋 Brand Name: {{2}}
📅 Hidden Date: {{3}}
🔎 Status: Hidden from Customers
📝 Reason: {{4}}
Your brand is currently not visible to customers on Trydood.
Please review the reason provided and take the necessary action. If you need assistance, contact us at helpdesk@trydood.com.
Trydood – Grow Your Business Faster 🚀


Variable mapping example:
{{1}} — Vendor/Customer Name
{{2}} — Brand Name
{{3}} — Hidden Date
{{4}} — Reason for Hiding

Template Name: brand_visible_to_customers
ye vala templete same opposite jo hidden hua hai to visible hoga uske according data or ye aayega aap phle isme update krke btana final kesa hoga kesa dikhega template fir hoga implement 

---

## Jo templates abhi likhe hi nahi gaye (33 types)

Ye sab notifications aaj **in-app + email + push** pe jate hain aur WhatsApp pe
kabhi nahi. Har ek ke liye ek Meta template chahiye hoga, plus us notice helper me
`whatsapp: { params, urlParam }`. Priority ke hisaab se group kiya hai — poori list
ek saath Meta pe daalne ka koi matlab nahi.

### Customer side — sabse pehle (7)

Customer ke paas app hai par notification ki aadat WhatsApp ki hai, aur inme se do
paise se seedha juda hai:

| Type | Kya batata hai | Kyun WhatsApp pe chahiye |
|---|---|---|
| `VOUCHER_PAYMENT_SUCCESS` | Receipt + Download Invoice | Ye **hi** receipt hai. Invoice token URL button ka dynamic segment banega |
| `VOUCHER_PAYMENT_FAILED` | Payment nahi hua, charge nahi lagi | "Charge nahi lagi" turant pahunchna chahiye, warna support call |
| `VOUCHER_REFUNDED` | Paisa wapas gaya | ,, |
| `REFUND_REQUESTED` (customer) | Request mil gayi | Acknowledgement |
| `REFUND_APPROVED` | Approve hua, 5–7 din | Partial ho to amount saaf bolna hai |
| `REFUND_REJECTED` | Approve nahi hua | Support ka rasta dena hai |
| `REFUND_BANK_DETAILS_REQUESTED` | Bank account chahiye | ⚠️ **Sabse careful copy.** Ye scam message jaisa lagta hai. URL button app pe jaye, kabhi kisi form pe nahi. "Hum call/message pe details nahi maangte" line rakhni hai |

`VOUCHER_CLAIM_EXPIRED` bhi customer side hai par Phase 2 tak inert hai — redemption
split hone ke baad.

### Vendor side — paise wale (8 vendor-only + `REFUND_REQUESTED`, jo customer ke saath share hota hai)

| Type | Kya batata hai |
|---|---|
| `VOUCHER_CLAIM_RECEIVED` | Outlet pe naya claim aaya + vendor payable |
| `SETTLEMENT_PAID` | Payout gaya + **UTR** (iske bina "paid" aur "not paid" ek jaise lagte hain) |
| `SETTLEMENT_FAILED` | Bank ne wapas kiya — account check karo |
| `SETTLEMENT_ON_HOLD` | Review pe ruka hai, detail nahi |
| `SETTLEMENT_CARRIED_FORWARD` | Is cycle kuch nahi mila, aur kyun |
| `REFUND_REQUESTED` (vendor) | Refund aaya, deadline hai |
| `REFUND_REMINDER` | Window band hone wali hai |
| `DISPUTE_RAISED_VENDOR` | Unki sale pe chargeback |
| `DISPUTE_RESOLVED_VENDOR` | Won ya lost, aur aage kya hoga |

⚠️ `VOUCHER_CLAIM_RECEIVED` pe volume ka dhyan — 50 claims/day = 50 WhatsApp
messages, jinke paise lagte hain. Isko digest banane ka faisla template banane se
pehle hona chahiye.

### Admin side (14 + `ANNOUNCEMENT`) — WhatsApp shayad zaroori nahi

Admin alerts queue work hain aur panel + email pe already jate hain. WhatsApp sirf
un teen ke liye sochna banta hai jinme **deadline** hai aur miss karne pe paisa
jata hai:

- `DISPUTE_DEADLINE` — miss = automatic loss, bank dobara nahi puchta
- `PAYMENT_DISPUTED` — dispute khula
- `SHADOW_INDEX_REAPED` — jab tak index wahan hai, roughly har dusra claim fail

Baaki 12 (`SETTLEMENT_STUCK`, `SETTLEMENT_LATE`, `SETTLEMENT_LEDGER_DRIFT`,
`VENDOR_DEBT_AGED`, `REFUND_ESCALATED`, `REFUND_FAILED`,
`REFUND_BANK_DETAILS_STALE`, `BRAND_AWAITING_REVIEW`, `BRAND_AWAITING_RE_REVIEW`,
`PROMO_LIMIT_EXCEEDED`, `WEBHOOK_FAILED`, `ANNOUNCEMENT`) ke liye WhatsApp add karna
paisa aur template-approval overhead hai, faayda kam.

### Jinke liye pehle code chahiye (2)

- `LIMIT_REACHED` — plan limit khatam. Type declared hai, koi call site nahi.
- `BRAND_SUBSCRIPTION_LAPSED` — paying brand ka plan lapse (admin ko revenue
  follow-up). Type declared hai, koi call site nahi.

