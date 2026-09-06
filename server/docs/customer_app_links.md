# Customer email buttons — how a link reaches an app screen

> **Decision: Path 1 (Universal / App Links).** Path 2 is documented in full at the
> bottom, with the reasoning for not choosing it, because that reasoning is the
> thing that gets forgotten and re-litigated.

---

## The problem this solves

A vendor and an admin read their notification in a **browser**, so the email
button is an ordinary URL:

```
https://vendor.trydood.com/settlements/6a9af9d7db0841570b80f791
https://admin.trydood.com/refunds/6a9af9d7db0841570b80f792
```

A customer's destination is a **mobile app screen**. There is no customer web
panel, and `helpers/notifications/panelLinks.js` says so — `CUSTOMER_PATHS` holds
bare routes (`orders/<id>`, `refunds`) with no host, because the app resolves its
own routes.

An email cannot open an app screen with a bare route. It needs an absolute
`https://` URL that the operating system recognises as belonging to this app.
That is what `CUSTOMER_APP_URL` provides, and what this document is about.

⚠️ **Ten customer emails depend on it.** With `CUSTOMER_APP_URL` unset or
misconfigured, every one of them arrives with no button:

| Notification | Route | Button |
|---|---|---|
| `VOUCHER_PAYMENT_SUCCESS` | `orders/<claimId>` | View your order *(second button — the first is the invoice)* |
| `VOUCHER_PAYMENT_FAILED` | `vouchers/<voucherId>` | Try again |
| `VOUCHER_REFUNDED` | `transactions/<transactionId>` | View refund |
| `VOUCHER_CLAIM_EXPIRED` | `orders/<claimId>` | View your order |
| `REFUND_REQUESTED` (customer) | `transactions/<transactionId>` | Track your refund |
| `REFUND_APPROVED` | `transactions/<transactionId>` | Track your refund |
| `REFUND_REJECTED` | `support` | Contact support |
| `REFUND_BANK_DETAILS_REQUESTED` | `refunds` | Add your bank account |
| `REFUND_BANK_DETAILS_REQUESTED` (reminder) | `refunds` | Add your bank account |

`VOUCHER_PAYMENT_SUCCESS` keeps its **Download Invoice** button either way —
that one is built from `PUBLIC_API_URL`, because an invoice is a PDF this API
serves rather than an app screen.

**That is the complete route list the app has to handle.** Seven distinct
patterns:

```
orders                          (list)
orders/<claimId>
transactions/<transactionId>
vouchers/<voucherId>
refunds                         (list)
refunds/<requestId>
support
```

---

## ⚠️ The mistake this document exists to prevent

`CUSTOMER_APP_URL` was first set to the Play Store listing:

```
CUSTOMER_APP_URL=https://play.google.com/store/apps/details?id=com.trydood
```

`customerUrl()` appends a route to it, which produces:

```
https://play.google.com/store/apps/details?id=com.trydood/orders/6a95d10f...
                                                         └── after the query string
```

That reaches **neither** the app screen nor the store listing. It is a link that
looks configured and goes nowhere.

The reasoning behind the mistake is sound, which is why it is worth naming: the
requirement *"if the app is not installed, send them to the store"* reads like an
instruction about this variable. **It is not.** Two different things:

| What | Who does it |
|---|---|
| Open the app at a specific screen | The universal-link **host** — `CUSTOMER_APP_URL` |
| Send to Play Store / App Store when the app is missing | A **page served at that host**, deciding from the user agent |

There is no way to express *"…and if it is not installed, go to the store"*
inside a URL. It is a decision made by something that runs, so it needs a page.

`customerUrl()` now refuses a base containing `?` or `#`, warns once naming the
variable, and omits the button rather than rendering a broken one — the same
contract `vendorUrl` and `adminUrl` follow.

---

## Where this stands today

| | State |
|---|---|
| Backend | ✅ Done. Nothing further to change for Path 1 |
| `vendor.trydood.com` | ✅ Resolving (Vercel) |
| `admin.trydood.com` | ✅ Resolving (Vercel) |
| `app.trydood.com` | ❌ **No DNS record.** No wildcard on `trydood.com` either, so it resolves to nothing rather than to a surprise page |
| App-side (Android / iOS) | ❌ Not started |

---

## Staged rollout — what actually works at each stage

Each stage stands on its own. Nothing here has to be done in one go, and **the
emails are complete and reviewable from Stage 0.**

### Stage 0 — env only (5 minutes)

```
CUSTOMER_APP_URL=https://app.trydood.com
```

| | |
|---|---|
| Emails send | ✅ 65/65 |
| Button renders | ✅ label, styling, fallback URL, layout — all of it |
| Tapping the button | ⚠️ **DNS error** — *"site can't be reached"*. Not a 404; the host does not exist |

**Good enough to review every template.** The one thing it cannot verify is that
a tap opens the app.

⚠️ The `customerUrl` guard does **not** fire here — it only rejects a base with a
query string. A bare host that does not resolve is indistinguishable from one
that does, from inside the process. Nothing warns, and nothing should: the
backend cannot know what DNS says.

### Stage 1 — DNS + a page (30 minutes, no app work)

Point `app.trydood.com` at a static host and serve the fallback page below.

| | |
|---|---|
| Tapping the button | ✅ Opens a real page in the browser, which sends the reader to the Play Store or the App Store |
| Opens the app | ❌ Not yet |

This is already a shippable state. A customer who taps gets somewhere sensible.

### Stage 2 — the two well-known files (30 minutes, no app work)

Add `assetlinks.json` and `apple-app-site-association` to that same host.

| | |
|---|---|
| Opens the app | ❌ Still not — the app has to claim the domain from its side |

Harmless to do early, and doing it before Stage 3 means the app claims the domain
the moment it is installed rather than waiting for the next file deploy.

### Stage 3 — app-side (the real work, ~1 day)

Intent filters, the iOS entitlement, and in-app routing for the seven patterns.

| | |
|---|---|
| App installed | ✅ Tap opens the app, directly, at that screen. No browser, no dialog |
| App not installed | ✅ Falls through to the Stage 1 page → store |

---

# Path 1 — Universal Links (Android App Links + iOS Universal Links)

## How it works

The email carries `https://app.trydood.com/orders/123`.

The operating system decides what that URL means, **before** a browser is
involved, by checking whether the app on the device is allowed to claim that
domain. It answers that by fetching a file from the domain itself. If the answer
is yes, the app opens. If the app is not installed, the URL is an ordinary web
address and the browser loads it.

That is the whole mechanism: **the domain vouches for the app, and the app
vouches for the domain.** Both halves are required.

## 1 · Backend

Nothing to do. Already done:

```
CUSTOMER_APP_URL=https://app.trydood.com
```

`customerUrl(path)` in `helpers/notifications/panelLinks.js` joins the route onto
it. Unset or containing `?` / `#`, it returns `undefined` and the button is
omitted, with a warning naming the variable and a line at boot from
`logChannelStatus`.

## 2 · Hosting

Both panels are already on Vercel, so this is the same setup:

1. Add `app.trydood.com` as a domain on a Vercel project (or a new one — a static
   project is enough)
2. Add the DNS record Vercel asks for
3. Deploy the three files below

Cloudflare Pages, Netlify, or S3 + CloudFront are all equally fine. The
requirements are only: **HTTPS with a valid certificate**, publicly reachable
with no authentication and no geo restriction.

### `/.well-known/assetlinks.json` — Android

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.trydood",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:… (release)",
        "11:22:33:… (debug, optional)"
      ]
    }
  }
]
```

> ### 🔴 Take the fingerprint from the Play Console, not from your keystore
>
> This is the single most common reason App Links silently fail to verify.
>
> With **Play App Signing** — on by default for every app published in the last
> several years — Google re-signs the upload with *its own* key. The certificate
> on the device is therefore **not** the one in your local keystore, and a
> fingerprint taken from `keytool` will not match.
>
> Play Console → your app → **Setup → App integrity → App signing** → copy the
> **SHA-256 certificate fingerprint** under *App signing key certificate*.
>
> A wrong fingerprint produces **no error anywhere**. Verification just fails,
> and every link keeps opening in the browser exactly as it did before — which
> reads as "universal links don't work" rather than "one string is wrong".
>
> Add the *upload* key fingerprint as a second entry if you also want links to
> work in builds installed straight from Android Studio.

### `/.well-known/apple-app-site-association` — iOS

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.com.trydood"],
        "components": [
          { "/": "/orders", "comment": "orders list" },
          { "/": "/orders/*", "comment": "one order" },
          { "/": "/transactions/*", "comment": "one transaction / refund status" },
          { "/": "/vouchers/*", "comment": "one voucher — retry a failed payment" },
          { "/": "/refunds", "comment": "refunds, incl. adding a bank account" },
          { "/": "/refunds/*", "comment": "one refund request" },
          { "/": "/support", "comment": "support" }
        ]
      }
    ]
  }
}
```

`TEAMID` is the Apple Developer Team ID; `com.trydood` is the bundle identifier.

⚠️ **Four requirements, each of which silently breaks it:**

- **No file extension.** The path is exactly `/.well-known/apple-app-site-association`
- **`Content-Type: application/json`**
- **No redirects.** Not even `http → https`, and not a trailing-slash redirect
- **Publicly reachable.** Since iOS 14 Apple fetches it through their own CDN
  (`app-site-association.cdn-apple.com`), so anything behind authentication, a
  firewall, or geo-blocking fails

Apple's CDN caches, so a change can take hours to reach devices. Plan for that
rather than debugging it.

### `/index.html` (and a catch-all) — the fallback page

This is the piece that answers *"…and if the app is not installed?"*. It runs
only when the app has not claimed the URL, which means the app is absent.

```html
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open in Trydood</title>
<style>
  body{font-family:system-ui,-apple-system,Arial,sans-serif;background:#f9f9f9;
       margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .card{max-width:420px;text-align:center;background:#fff;border:1px solid #e0e0e0;
        border-radius:12px;padding:32px}
  h1{color:#0f766e;font-size:20px;margin:0 0 12px}
  p{color:#444;line-height:1.6;font-size:15px}
  a.btn{display:inline-block;background:#0f766e;color:#fff;padding:12px 26px;
        border-radius:6px;text-decoration:none;margin-top:18px}
</style>
<div class="card">
  <h1>Open this in the Trydood app</h1>
  <p id="msg">Taking you to the app store…</p>
  <a class="btn" id="store" href="https://trydood.com">Get the app</a>
</div>
<script>
  var PLAY = "https://play.google.com/store/apps/details?id=com.trydood";
  var APPSTORE = "https://apps.apple.com/app/idXXXXXXXXX";
  var ua = navigator.userAgent || "";
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
              (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPad desktop mode
  var store = isAndroid ? PLAY : isIOS ? APPSTORE : null;

  if (store) {
    document.getElementById("store").href = store;
    // A short delay, not an instant redirect: an immediate jump makes the back
    // button useless and looks like the link was broken.
    setTimeout(function () { location.replace(store); }, 800);
  } else {
    // ⚠️ Desktop. A store page is useless on a laptop — see "What neither path
    // solves" below. Say something true instead of redirecting.
    document.getElementById("msg").textContent =
      "This link opens in the Trydood app on your phone. Open this email on your " +
      "mobile, or search for Trydood in the Play Store or App Store.";
    document.getElementById("store").style.display = "none";
  }
</script>
```

Serve it for **every** path, so `/orders/123` and `/refunds` both reach it rather
than 404ing. On Vercel:

```json
{ "rewrites": [{ "source": "/((?!\\.well-known).*)", "destination": "/index.html" }] }
```

⚠️ The negative lookahead matters. A blanket rewrite would serve `index.html` for
`/.well-known/assetlinks.json` too, and verification would fail against a page of
HTML — with, again, no error anywhere.

> ### 🔴 This page must never collect bank details
>
> `REFUND_BANK_DETAILS_REQUESTED` links here, and its copy promises *"We will
> never ask you for your details over a call or a message."* That promise is what
> lets a customer tell this email apart from the phishing message it necessarily
> resembles — someone whose refund just failed, now being asked for an account
> number.
>
> If this page ever renders a form that takes bank details, the promise becomes
> false and the email becomes indistinguishable from the fake. Bank details are
> entered **in the app, behind a login**, and nowhere else.
>
> See the note on `notifyRefundBankDetailsRequested` in
> `helpers/notifications/refundNotices.js`.

## 3 · App side

### Android

```xml
<activity android:name=".MainActivity" android:exported="true">
  <intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="app.trydood.com" />
  </intent-filter>
</activity>
```

`android:autoVerify="true"` is what makes Android fetch `assetlinks.json` and
claim the domain. Without it the link still reaches the app, but through a "which
app?" chooser dialog — which defeats most of the point.

### iOS

1. **Signing & Capabilities → + Capability → Associated Domains**
2. Add `applinks:app.trydood.com`
3. Handle the incoming URL:

```swift
func application(_ application: UIApplication,
                 continue userActivity: NSUserActivity,
                 restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
          let url = userActivity.webpageURL else { return false }
    return Router.open(path: url.path)   // "/orders/123"
}
```

### Routing (both platforms)

Map the seven patterns to screens. **Every one must survive not being logged in**
— which is the behaviour that was asked for: if there is no session, show the
login screen, and after a successful login continue to the requested screen.

⚠️ This is why no `?next=` parameter is appended to the URL. The route **is** the
destination; the app's own auth guard decides whether to show it or the login
screen first. Nothing in the backend needs to know, and adding a parameter would
mean every link went through a login page even for an already-signed-in user.

⚠️ **An unknown or malformed path must land somewhere, not crash.** These URLs
are years-lived — an email from today can be tapped after a release that renamed
a route. Default to the orders list rather than to an error.

## 4 · Verifying it

**Android:**

```bash
# What the device thinks of the domain
adb shell pm get-app-links com.trydood

# Force re-verification (Android 12+)
adb shell pm verify-app-links --re-verify com.trydood

# Does the link actually open the app?
adb shell am start -a android.intent.action.VIEW \
  -d "https://app.trydood.com/orders/123"
```

`pm get-app-links` printing `verified` for `app.trydood.com` is the thing to look
for. `legacy_failure` or `none` means the fingerprint is wrong — see the Play
Console note above.

Google's own checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.trydood.com&relation=delegate_permission/common.handle_all_urls
```

**iOS:**

```
https://app-site-association.cdn-apple.com/a/v1/app.trydood.com
```

That is Apple's CDN copy — what devices actually read. If it does not match the
file you deployed, it has not propagated yet.

Then tap a link from **Notes or Messages**, not from Safari's address bar:
typing a universal link into Safari deliberately does *not* open the app.

**Both, end to end:** run the review mailer and tap the buttons on a real handset.

```bash
node scripts/sendTestNotificationMails.js --to=you@example.com --only=CUSTOMER --apply
```

## Gotchas, collected

| Gotcha | Symptom |
|---|---|
| Fingerprint from the local keystore, not Play Console | Verification fails, links open in the browser. **No error** |
| `autoVerify` missing | A "which app?" chooser appears every time |
| AASA served with a redirect, or as `.json` | iOS silently ignores it |
| AASA not yet through Apple's CDN | Works on one device, not another |
| Blanket SPA rewrite catching `/.well-known/*` | Verification reads HTML and fails |
| Debug build | Different signing cert — links do not work unless its fingerprint is listed too |
| Gmail app on iOS | Opens links in its in-app browser, which sometimes bypasses universal links. Improved, not perfect |
| **Click tracking added later** | A rewritten `track.provider.com/...` URL breaks universal links **entirely**. Raw SMTP today, so fine — but this is the thing that quietly kills it a year from now |
| Typing the URL into Safari | Deliberately does not open the app. Not a bug |

---

# Path 2 — a backend redirect endpoint (not chosen)

Documented so the decision does not get made twice.

## How it would work

The email carries
`https://backend2-0-4v4i.onrender.com/trydood/v1/open/orders/123`, and a new
endpoint reads the `User-Agent`:

**Android** — a `302` to Android's Intent URL scheme:

```
intent://orders/123#Intent;
  scheme=trydood;
  package=com.trydood;
  S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.trydood;
end
```

This is genuinely neat: app installed → the app opens; not installed → Chrome
follows `browser_fallback_url` to the Play Store. **One redirect covers both
cases**, and it needs no file on any domain.

**iOS** — there is no clean equivalent. Redirecting to `trydood://orders/123`
when the app is absent produces a Safari error dialog. The standard workaround is
an HTML page that attempts the custom scheme and, after a timer, gives up and
goes to the App Store.

**Desktop** — a landing page.

## Why it was not chosen

**1 · iOS shows a confirmation dialog every time, even when the app is
installed.** A custom URL scheme always asks *"Open in Trydood?"*. That is not an
edge case — it is the **main path**, on every payment and refund notification.
Universal links do not ask.

**2 · The app-side work is the same size, and would be thrown away.** Both paths
need in-app routing for the same seven patterns. Path 2 needs it wired to a
custom scheme; migrating to universal links later means doing the registration
work again. Path 1's *extra* cost over Path 2 is two static files and one
entitlement.

**3 · The same link works everywhere else.** A universal link opens the app from
WhatsApp, iMessage, SMS, Notes, or a forwarded message. Path 2's URL only works
where this backend put it.

**4 · It adds a runtime dependency to a link.** Every tap goes through the API. A
static host being down is far less likely than an application server being down,
and these URLs are long-lived.

Minor, but real: `intent://`'s fallback is reliable only in Chrome and
Chromium-based Android browsers; a custom scheme can be registered by any other
app on Android, where a verified domain cannot; and email security scanners
pre-fetch links, so the endpoint would be hit by bots — harmless until someone
uses those hits as an "opened" signal.

## When Path 2 would be right

If obtaining an `app.trydood.com` subdomain were genuinely blocked. It is not —
both panels are already on Vercel, so the same mechanism serves this.

---

# Side by side

| | Path 1 · Universal Links | Path 2 · Backend redirect |
|---|---|---|
| Email URL | `https://app.trydood.com/orders/123` | `https://api…/trydood/v1/open/orders/123` |
| App installed, Android | Opens app. No hop, no dialog | Opens app, via one server hop |
| App installed, iOS | Opens app, native | ⚠️ **"Open in Trydood?" every time** |
| Not installed, Android | Fallback page → Play Store | Chrome → Play Store (slightly better) |
| Not installed, iOS | Fallback page → App Store | ⚠️ JS timer workaround |
| Needs a new domain | Yes | No |
| Runtime dependency | A static host | The API |
| Link integrity | Domain-verified | Scheme is claimable by other apps |
| Works from WhatsApp / SMS / Notes | Yes | No |
| Total effort | ~1 day (mostly app-side) | ~1 day (mostly app-side) |

---

# What neither path solves

## Desktop email — and this is the bigger case

Someone opens a refund email on a laptop and taps the button. Both paths land
them on a store page, which is useless on a desktop. The fallback page above says
something true instead of redirecting, but *"open this on your phone"* is a
consolation, not an answer.

⚠️ **Worth weighing against the store fallback, which gets far more attention
than it deserves here.** A customer cannot have made a voucher claim without the
app — every recipient of these emails *had* it. "App not installed" means they
deleted it; "reading on a desktop" means nothing at all is wrong. The second is
much more common.

The real fix is a small customer web view at the same host — `app.trydood.com/orders/123`
rendering the order status for a signed-in customer on any device. That is what
the universal-link host is *supposed* to be, and it makes the fallback page
unnecessary. Separate scope; worth planning for.

## Deferred deep linking

*"Tap the refund email → install the app → land on the refunds screen"* does not
work in either path. The destination is lost across the install.

Solving it needs either the Play Install Referrer API (Android only, first
install only) or a third-party service — Branch or AppsFlyer OneLink.

⚠️ **Firebase Dynamic Links, the obvious free answer, was shut down in August
2025.** Do not plan around it.

Given the point above — recipients already have the app — this is low priority.

---

# Checklist

**Stage 0 — now**
- [ ] `CUSTOMER_APP_URL=https://app.trydood.com` in `.env` and in the deployment's environment
- [ ] Boot log shows `✅ [notify] mail CTA  vendor, admin and invoice link bases configured`
- [ ] `node scripts/sendTestNotificationMails.js --to=… --only=CUSTOMER` reports **0 with no email button**

**Stage 1 — DNS and page**
- [ ] `app.trydood.com` resolving
- [ ] Fallback page served for every path
- [ ] `/.well-known/*` **excluded** from the SPA rewrite
- [ ] Real Play Store and App Store URLs in the page (the App Store id is a placeholder above)
- [ ] Page collects nothing — no form of any kind

**Stage 2 — well-known files**
- [ ] `assetlinks.json`, fingerprint copied from **Play Console → App integrity**
- [ ] `apple-app-site-association`, no extension, `application/json`, no redirect
- [ ] Google's digital-asset-links checker passes
- [ ] Apple's CDN copy matches the deployed file

**Stage 3 — app**
- [ ] Android intent filter with `autoVerify="true"`
- [ ] iOS Associated Domains `applinks:app.trydood.com`
- [ ] All seven routes handled
- [ ] Every route survives being signed out → login → continue to that screen
- [ ] An unknown path lands on the orders list, never an error
- [ ] `adb shell pm get-app-links com.trydood` reports `verified`
- [ ] Tapping a real notification email on a real handset opens the app

---

---

# 🔮 Future — email delivery is on a free Gmail account

> **Nothing to do today.** It works, and it will keep working at current volume.
> This section exists so that when it breaks, the cause is already written down —
> because the way it breaks is silent, and it will not look like an email problem.

## Where it stands

`helpers/nodeMailer/sendMail.js` builds one pooled `nodemailer` transport:

```js
nodemailer.createTransport({ service: "gmail", auth: { user, pass } })
```

`NODEMAILER_EMAIL` is a **personal `@gmail.com` address** with an app password.
Every notification email on the platform — vendor, customer and admin — goes
through it.

## Why it is fine now and will not be

### 1 · The daily cap

| Account type | Limit |
|---|---|
| Free `@gmail.com` via SMTP | **~500 recipients / day** |
| Google Workspace | 2,000 messages / day, 10,000 recipients / day |

⚠️ **500 is closer than it sounds.** Count what one ordinary day emits:

| Event | Emails |
|---|---|
| One voucher claim paid | 2 — customer receipt + vendor "claim received" |
| One refund, start to finish | 3–4 — vendor request, customer ack, decision, reminders |
| One settlement cycle | 1 per brand |
| Subscription activation / renewal / expiry reminders | 1 each |

**250 voucher claims in a day is 500 emails.** That is not a scale milestone, it
is a normal Saturday for a few dozen outlets. Past it, **every** email fails —
including the refund and dispute ones that carry deadlines.

⚠️ The review mailer burns this fast too: `sendTestNotificationMails.js` sends
65 messages, so five reviewers is 325 recipients in one run. Use
`--only=CUSTOMER` rather than the full set when checking one area.

### 2 · The failure is silent, and does not read as an email problem

`notify()` writes the notification row first and attempts email after, recording
the outcome on the row. So when the cap is hit:

- the in-app bell keeps working perfectly
- `Notification.emailError` fills up with *"Daily user sending quota exceeded"*
- **nothing alerts.** No job watches that field, and no admin notice fires

The first sign is a vendor asking why they were never told about a chargeback,
weeks later — the same shape as every other failure this platform records in
`CLAUDE.md`: something that fails by *not happening*.

⚠️ And the error message itself misleads. *"Daily user sending quota exceeded"*
arrives alongside SMTP auth failures and reads like a wrong password, so the
first hour goes into rotating an app password that was never the problem.

### 3 · Deliverability — the quieter half, and it is already happening

This one does not wait for the cap.

The mail is sent from `…@gmail.com` while the product is `trydood.com`. That
means:

- **SPF / DKIM / DMARC for `trydood.com` do not cover it.** No amount of DNS
  configuration on your own domain helps, because the mail does not claim to be
  from your domain
- **The `From` cannot be changed.** Gmail rewrites it to the authenticated
  account, so sending as `notifications@trydood.com` is not possible from a
  personal Gmail — only from a Workspace account with that alias verified
- A payment receipt arriving from a personal Gmail address is **exactly** what a
  phishing receipt looks like. Spam filters agree, and so do customers
- ⚠️ `REFUND_BANK_DETAILS_REQUESTED` is the worst case. That email asks a
  customer to add a bank account, and its copy promises *"we will never ask you
  for your details over a call or a message."* Sent from an unauthenticated
  personal Gmail, that promise is doing the opposite of reassuring

**None of this bounces.** Mail lands in spam, `sendMail` reports `sent: true`,
and the notification row says `EMAIL` in `channels`. There is no signal at all.

### 4 · One account, one point of failure

The app password is on one personal account. Someone changing that password,
losing 2FA, or the account being flagged stops **every** notification email on
the platform at once.

## What to move to

Only the transport changes. `renderMailHtml`, `normaliseActions`, every notice
helper, and `notify()` all stay exactly as they are — which is the payoff for
`sendMail` naming only `to` / `subject` / `title` and passing the rest through.

| Option | Cost | Notes |
|---|---|---|
| **Amazon SES** | ~$0.10 per 1,000 | Cheapest by a wide margin. ⚠️ Starts in a **sandbox** that only sends to verified addresses — production access is a support request, so raise it *before* you need it |
| **Resend** | Free to 3,000/mo | Simplest setup, good DX, has a nodemailer transport |
| **Brevo** | Free to 300/day | 300/day is not much more headroom than Gmail |
| **Google Workspace** | Per seat | 2,000/day and a real `@trydood.com` From. **A step, not a destination** — the same wall, four times further out |

For this platform, **SES** is the answer: the volume is transactional, the price
is negligible, and the infrastructure is already on AWS in plan (`CLAUDE.md`
records the Render → EC2 move).

## What the migration actually is

**One file.** `helpers/nodeMailer/sendMail.js`, the `getTransporter()` function:

```js
// from
nodemailer.createTransport({ service: "gmail", auth: { … } })

// to
nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // email-smtp.ap-south-1.amazonaws.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,                         // STARTTLS on 587
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  pool: true,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
})
```

⚠️ Keep the three timeouts. They are there because nodemailer waits **for ever**
on a blocked SMTP port, which would hang whatever request is behind it — and that
is provider-independent.

Then `from: process.env.MAIL_FROM` (`"Trydood <notifications@trydood.com>"`)
instead of `process.env.NODEMAILER_EMAIL`, and DNS records on `trydood.com`:

- **SPF** — include the provider
- **DKIM** — the CNAMEs the provider issues
- **DMARC** — start at `p=none` with `rua=` reporting, and only tighten to
  `quarantine` once the reports are clean. ⚠️ Going straight to `p=reject`
  with a misconfigured DKIM silently rejects your own mail

⚠️ **Two other paths send mail and would be left behind:**
`helpers/nodeMailer/sendLoginOtpMail.js` and
`sendOtpVerificationSuccessMail.js` each build their **own** transporter per send
rather than going through `sendMail`. Migrating only `sendMail.js` leaves login
OTP email on Gmail — which is the one email a user is actively waiting for.
Fold both onto the shared transport as part of this.

## The signal that says "now"

Add this before it is needed, not after. Two things worth having:

1. **A sweep that alerts when `Notification.emailError` climbs.** The gap this
   whole section is about is that nothing watches that field. It belongs in
   `jobs/index.js` with the other sweeps whose job is to notice an absence, and
   it is the difference between finding out today and finding out from a vendor
   in three weeks.
2. **A `mail` line in `logChannelStatus`** naming the provider at boot, so
   "which account is production sending from?" is answerable without reading env.

## Checklist, for when it happens

- [ ] Provider account, domain verified
- [ ] SES: production access granted (**out of sandbox**)
- [ ] SPF, DKIM, DMARC (`p=none` first) on `trydood.com`
- [ ] `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` in env and in `.env.example`
- [ ] `getTransporter()` switched, timeouts kept
- [ ] `sendLoginOtpMail` and `sendOtpVerificationSuccessMail` folded onto the shared transport
- [ ] `node scripts/sendTestNotificationMails.js --to=… --only=CUSTOMER --apply` — headers checked for DKIM `pass`
- [ ] `Notification.emailError` sweep registered in `jobs/index.js`
- [ ] Old Gmail app password revoked

---

## Related

- `helpers/notifications/panelLinks.js` — `customerUrl`, `CUSTOMER_PATHS`, and the guard
- `helpers/notifications/refundNotices.js` — the bank-details notice and why its button must be the app
- `helpers/nodeMailer/sendMail.js` — how a button and its fallback URL are rendered
- `scripts/sendTestNotificationMails.js` — send every template to a review address
- `docs/whatsapp_templates.md` — the full notification inventory, all 50 types
