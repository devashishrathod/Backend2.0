# Notification preferences — who gets what, on which channel

Three switches per person — **email**, **push**, **WhatsApp** — independent of
each other, on by default, for every role. A customer, a vendor, an outlet
manager and an admin all work the same way, because they are all one `User`.

---

## The two switches, and why they are not the same thing

| | Whose | What it means | Where |
|---|---|---|---|
| `Setting.<audience>.…is*NotificationEnabled` | the platform's | an **operational kill switch** — SMTP is down, no Meta template exists | `PUT /settings`, admin only |
| `User.notificationPreferences.<channel>` | the person's | *"do not email me"* | `PUT /notifications/preferences` |

**A send needs both.**

```
delivered  ⟺  platform toggle ON  AND  person's toggle ON
```

They are combined in exactly one place — `helpers/notifications/channelPreferences.js`
— so no path can form a second opinion.

⚠️ **An admin switching one customer's WhatsApp on does not switch WhatsApp on
for every customer.** The per-user endpoint writes the person's preference and
nothing else. If the platform switch is what is holding a channel shut, the
response says so rather than reporting a toggle that does nothing:

```jsonc
"whatsapp": { "preference": true, "effective": false, "blockedBy": "PLATFORM" }
```

That is the **normal** case today, not an edge one: WhatsApp is off
platform-wide for all three audiences until the Meta-approved templates exist.

---

## 🔴 Absent means ON — the one thing to get right

`notificationPreferences` carries `default: true` on every channel. **A schema
default applies only to documents created after the field existed.** Every user
already in the database has no `notificationPreferences` at all, and will not
grow one until they change a setting.

So the read is:

```js
prefs?.email !== false     // ✅ absent, null and true all mean on
prefs?.email === true      // ❌ silences every existing user
Boolean(prefs?.email)      // ❌ the same, wearing a different hat
```

`CLAUDE.md` records this exact shape going the other way — a `Setting` document
written before `requiresAdminApproval` existed, where truthiness would have
auto-approved every payout on the platform. Here the failure is quieter and
therefore worse: notifications simply stop, the in-app feed keeps working
perfectly, and **nobody reports a message they never knew was coming**.

Which is why:

- only `resolveChannelPreferences()` in `helpers/notifications/channelPreferences.js`
  is allowed to decide it;
- a test walks `helpers/`, `services/` and `controllers/` and fails if any other
  file reads `notificationPreferences.email` / `.push` / `.whatsapp` directly;
- **there is no backfill migration**, deliberately. Writing `true` into a
  thousand documents to match a value that is already the default would only
  hide a wrong `!== false` if one ever appeared. The field fills in when somebody
  first changes a setting.

---

## What a preference cannot silence

The in-app row is **always** written. The toggles govern outbound delivery only.
`Notification` is the record — the feed reads it, every delivery outcome is
written back onto it, and an admin opens it to answer *"what were they told?"*.
A preference that could stop the row would be a preference to have no history.

And six notification types outrank a personal preference — `ALWAYS_DELIVER_TYPES`
in `constants/notification.js`. The rule, so the list can be argued with rather
than guessed at — a type qualifies if **one** of these is true:

1. the notice itself is what cuts the reader off from the in-app feed, so there
   is no other way for them to learn it; or
2. money is held, owed or forfeit until somebody acts.

| Type | Which rule |
|---|---|
| `BRAND_DEACTIVATED` | 1 — the vendor cannot sign in, and push is off in that notice because the same operation retires their device tokens |
| `REFUND_BANK_DETAILS_REQUESTED` | 2 — the refund stays with us until the customer supplies an account |
| `REFUND_FAILED` | 2 — a customer was told their money was coming and it did not arrive |
| `SETTLEMENT_LEDGER_DRIFT` | 2 — the books and the bank disagree about money that has moved |
| `SHADOW_INDEX_REAPED` | 2 — while it is present, roughly every second voucher claim fails |
| `DISPUTE_DEADLINE` | 2 — missing it forfeits the money automatically |

⚠️ **Severity is not the test.** `CRITICAL` is the obvious rule and the wrong
one: `REFUND_BANK_DETAILS_REQUESTED` is deliberately `INFO` — *"alarming someone
about their own money is how a real message gets mistaken for a fake one"* — and
it is the notice that most has to arrive.

⚠️ **This overrides the person, never the platform.** A platform switch is set
when SMTP is down or no template exists; bypassing it would attempt a send the
provider rejects out of sight.

---

## The API

### A person's own — any role

```http
GET /trydood/v1/notifications/preferences
PUT /trydood/v1/notifications/preferences
```

`verifyJwtToken`, no role gate: "my preferences" is the same operation for a
customer, a vendor, an outlet manager and an admin, and the id comes off the
token. **This endpoint has no way to address anybody else.**

```jsonc
// PUT body — partial, at least one channel
{ "whatsapp": false }
```

⚠️ Partial on purpose. A panel toggle changes one switch; a full-object write
would let a screen loaded five minutes ago silently revert a change made since
on another device.

```jsonc
// response
{
  "success": true,
  "data": {
    "userId": "…",
    "role": "VENDOR",
    "audience": "VENDOR",
    "channels": {
      "email":    { "preference": true,  "effective": true,  "blockedBy": null },
      "push":     { "preference": true,  "effective": true,  "blockedBy": null },
      "whatsapp": { "preference": false, "effective": false, "blockedBy": "PREFERENCE" }
    },
    "updatedBy": null,
    "updatedAt": "2026-09-05T09:12:00.000Z"
  }
}
```

### An admin, for anybody

```http
GET /trydood/v1/notifications/admin/preferences?customerId=…
PUT /trydood/v1/notifications/admin/preferences
```

Addressed by **exactly one** of `userId`, `customerId` or `brandId` — whichever
id the screen holds. `xor`, not `or`: two ids that disagree would otherwise
resolve silently to whichever the service happened to check first.

```jsonc
// PUT body
{ "customerId": "…", "push": false }
```

⚠️ `brandId` resolves the brand's **owner**. An outlet manager is a separate
`User` with their own toggles, and switching the owner's off must not silence the
person working the counter.

`updatedBy` records which admin made the change. Absent `updatedBy` with a
present `updatedAt` means the person changed it themselves — a self-service write
clears an earlier admin stamp rather than leaving a name that no longer explains
the state.

### Reading it off a profile

The raw sub-document rides along on the responses a panel already fetches, so a
profile card renders its switches without an extra call:

| Endpoint | Where |
|---|---|
| `GET /customers/admin/get-all` | `account.notificationPreferences` |
| `GET /customers/admin/:customerId` | `account.notificationPreferences` |
| `GET /brands/admin/get-all` | `vendor.notificationPreferences` |
| `GET /brands/…` (single) | `user.notificationPreferences` |
| `GET /users/get` (own profile) | `notificationPreferences` |

⚠️ **Raw, and usually absent.** Do not read those booleans directly — absent
means on, and the platform switch is not in there. The resolved answer is on
`GET /notifications/admin/preferences`, which is also what says whether a
platform switch is overriding the person.

---

## Where the check runs

Two places, and only two:

| Path | Covers |
|---|---|
| `notify()` | every single-recipient send — and `notifyAdmins` calls it once per admin, so admin fan-out is covered too |
| `notifyAudience()` | broadcasts. It writes rows with `insertMany` and pushes in bulk, bypassing `notify()` entirely |

⚠️ OTP email (`sendLoginOtpMail`, `sendOtpVerificationSuccessMail`) does **not**
go through `notify()` and is deliberately not covered. Nobody should be able to
silence the code they are waiting for.

⚠️ On the broadcast path, a recipient who has push off still gets their in-app
row, and `channels` no longer claims `PUSH` for them. It used to mark every
inserted row, which was harmless while everybody was pushed and is a false
delivery claim now.

---

## Related fixes shipped alongside this

Two bugs in the same recipient logic, found while wiring this up. Both are why
`notify({ audience: ADMIN })` no longer appears anywhere.

### 🔴 Seven admin alerts delivered nothing

`notify()` builds its destination from `brandId` / `customerId` / `userId`. An
admin notice passed none of them, so `recipient.email` was `null`, the email
block returned early, and `dispatchPush([null])` found no devices. The row landed
in the admin feed and **no email or push was ever sent** — including
`SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and `SHADOW_INDEX_REAPED`, all
CRITICAL. An admin not watching the panel never learned.

All of them now go through `notifyAdmins`, which fans out one row **per active
admin** with a real `userId` — so email and push have somewhere to go, and each
admin's own preferences are consulted for their own copy.

### 🔴 `VENDOR_DEBT_AGED` was emailed to the vendor it was about

```js
notify({ brandId, audience: ADMIN, … })   // reads as "an admin notice about this brand"
```

It is not what that did. `brandId` made `resolveRecipient` resolve the **brand's
own email**, so the row went to the admin feed while the message went to the
outlet — carrying an internal figure and the sentence *"Collect it, or write it
off."* A vendor reading that could reasonably conclude the debt was forgiven.

### 🔴 A failed settings read used to switch email off

`notify()` read the platform settings inside a `try` and, on failure, fell back
to `{}` — under a comment promising *"defaults are the right fallback for a
delivery decision"*. **`{}` is not the defaults.** It is every flag `undefined`,
and the three gates each read `undefined` differently, because each had been
written with a different operator:

```js
Boolean(config.isEmailNotificationEnabled)      // undefined → false → no email
config.isPushNotificationEnabled !== false      // undefined → true  → push sends
config.isWhatsAppNotificationEnabled === true   // undefined → false → no WhatsApp
```

| Channel | Default | What a failed read produced |
|---|---|---|
| email | `true` | ❌ **off** — the opposite of its default |
| push | `true` | ✅ on |
| whatsapp | `false` | ❌ off |

The guard existed to keep notifications flowing through a settings failure, and
it switched off the one channel it was written to protect.

⚠️ **And not necessarily briefly.** `getSetting()` is a `findOneAndUpdate` with
`upsert: true` — a **write** — so a `Setting` document that fails to cast or
validate throws on *every* call, indefinitely: all email and all WhatsApp
silently off, push still working, in-app rows still appearing. Half-working is
harder to notice than broken, and the symptom (*"emails stopped"*) points at SMTP
rather than at a settings document.

**The fix** is `helpers/notifications/audienceChannels.js`:
`resolveAudienceChannels(audience)` never throws and always returns three real
booleans, falling back to that audience's declared defaults. With no `undefined`
able to reach a gate, all three gates became the same expression.

⚠️ The per-channel intent did not disappear — it moved to where it can be read at
a glance, the **defaults**: email and push `true` (cost nothing, and a lost
notification is the failure to avoid), WhatsApp `false` (charged per message, and
every type needs its own Meta-approved template). Three operators were an attempt
to encode that at the point of use; one table says it once.

The audience branch is a **table** for the same reason: *"customer? … otherwise
vendor"* is how admin came to be governed by the vendor block. A missing entry in
a table is visible; a missing branch is not.

### `Setting.admin.notification` now exists

`getNotificationConfig(audience)` was *"customer? … otherwise vendor"*, and admin
fell into *otherwise* — so switching off vendor renewal reminders also switched
off every admin money alert, silently. Three audiences, three blocks, none able
to silence another.

---

## The shape everything shares

One object, three real booleans, everywhere:

```js
{ email: true, push: true, whatsapp: false }
```

| Producer | Gives |
|---|---|
| `audienceChannels.resolveAudienceChannels(audience)` | the **platform's** three, always complete, never throwing |
| `channelPreferences.resolveChannelPreferences(user)` | the **person's** three, absent = on |
| `channelPreferences.isChannelAllowed({…})` | the verdict for one channel, and what blocked it |
| `channelPreferences.describeChannelPreferences({…})` | what an API hands back — `preference` + `effective` + `blockedBy` |

Adding a **channel** is one entry in `NOTIFICATION_PREFERENCE_CHANNELS`, one in
`PLATFORM_CHANNEL_KEYS`, and a default per audience — a test fails if any
audience is missing one. Adding an **audience** is one entry in
`AUDIENCE_CHANNELS`, and a test fails if `NOTIFICATION_AUDIENCE` has one the
table does not.

## Related

- `helpers/notifications/audienceChannels.js` — the platform's switches, per audience, always complete
- `helpers/notifications/channelPreferences.js` — the only place "absent means on" is decided
- `constants/notification.js` — `ALWAYS_DELIVER_TYPES`, and the rule behind it
- `services/notifications/notificationPreferences.js` — the four endpoints, one resolver
- `__tests__/money/notificationPreferences.test.js` — the migration case first
- `docs/whatsapp_templates.md` — the full inventory of all 50 notification types
