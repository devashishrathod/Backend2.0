# CLAUDE.md

AI instructions for **Trydood 2.0** — a Node.js + Express + MongoDB backend for a voucher / e-commerce / membership platform.

> **Detailed coding rules** → see [coding-standards.md](./coding-standards.md)

---

## Stack

Node.js · CommonJS · Express 5 · Mongoose 9 (MongoDB) · Joi 18 · JWT · bcrypt · Cloudinary · Razorpay · Nodemailer · PDFKit · Morgan · ngrok

> No TypeScript. No ESM. `require()` / `module.exports` everywhere.

> ### ⚠️ Node 24.19.0 or newer, on Windows especially
>
> c-ares 1.34.6 shipped a Windows regression that makes `dns.getServers()` report
> `127.0.0.1`, where nothing listens. Node has two DNS paths — `dns.lookup` (the
> OS resolver) and `dns.resolve*` (c-ares) — and **only `mongodb+srv://` uses the
> second one**. So the machine looks perfectly healthy, browsers and `npm
> install` and `ping` all work, and Mongo alone fails in about 2ms with
> `querySrv ECONNREFUSED`.
>
> That points at everything except the cause: the cluster looks down, the
> password looks wrong, Atlas looks like it is blocking the IP. It cost hours,
> twice, and the workaround that came out of it — a `dns.setServers()` retry
> inside `database/mongoDb.js` — then hid the cause on every boot.
>
> [nodejs/node#62347](https://github.com/nodejs/node/issues/62347) is the bug;
> the fix was cherry-picked into Node **24.19.0**. Affected releases include
> v20.20.2, v22.22.2 and v24.14.1, so **downgrading does not help** — only going
> forward does.
>
> ```bash
> node -p "process.versions.ares"   # 1.34.6 is the bad one
> nvm install 24.20.0 && nvm use 24.20.0
> node scripts/checkDnsForSrv.js    # prints both DNS paths side by side
> ```
>
> `mongoDb.js` no longer retries. It detects this exact state — an SRV
> `ECONNREFUSED` while c-ares reports only loopback — and names the version
> instead, because one upgrade fixes the machine permanently and a retry fixed
> one connection at a time.

> ### The server refuses to start without a database
>
> `mongoDb()` used to be fired and forgotten from `index.js`, and it swallowed
> every failure — so an unreachable cluster or a wrong `MONGO_URL` still produced
> a listening port and a `✅ Server running` line.
>
> Nothing after that said anything was wrong. Mongoose buffers each query for
> `bufferTimeoutMS` and then rejects it, so a customer waited ten seconds for a
> spinner and got a 500, on every request — the app was not down, it was slow and
> then broken. Meanwhile the port answered, so every uptime check and health
> probe reported the service as fine and **no alert ever fired**.
>
> Boot now retries three times, then `process.exit(1)`. A total outage becomes a
> failed deploy, which is loud. It also means `assertMoneyIndexes` and
> `startJobs` can assume a live connection, which they always did anyway.

---

## Commands

```bash
npm run dev     # nodemon index  — local development with reload
npm start       # node index     — production
npm test        # jest --runInBand — money paths only, see below
```

> No lint script is configured. Do not invent `npm run lint` — it will fail.

### `npm test` covers the money paths and nothing else

`__tests__/money/` is the only tested folder, and the rest of the repo keeps the
no-test convention. It exists for the handful of behaviours that cannot be
verified by clicking — atomic claims, partial unique indexes, idempotency keys,
webhook replay. Rare, expensive when wrong, and exactly the class manual QA never
catches.

These run against a **separate database on the real cluster** (`Trydood2_test`),
derived from `MONGO_URL` by `__tests__/money/setup/testDb.js`. There is no
in-memory Mongo: a `mongod` reserves half the machine's RAM for its cache by
default, and this machine does not have it to spare. Everything is behind that
one helper, so switching later is a change to one file.

**The guard is load-bearing.** These tests delete documents. `testDb.js` refuses
to connect, and `clearCollections` refuses to run, unless the live connection's
database name ends in `_test`. Never bypass it, and never point a test at
`mongoose.connect(process.env.MONGO_URL)` directly.

> ### ⚠️ One run at a time — the suite takes a lock
>
> `maxWorkers: 1` stops two workers colliding **inside** one run. It does nothing
> about two runs. Every file shares one database, so a second `jest` started while
> the first is going has its own `beforeEach` clearing collections the first is
> mid-way through.
>
> That does **not** fail cleanly. It is a scatter of unrelated tests failing on
> assertions that are individually correct, which then pass when re-run alone —
> so it reads as flakiness and sends you looking in the wrong place. It cost two
> separate debugging detours before the cause was obvious.
>
> `globalSetup` now takes a lock and a second run is refused by name. If a run is
> killed the lock self-heals after 45 minutes, or:
>
> ⚠️ That TTL used to be 15 minutes, against a comment claiming the suite took
> about four. A full run is **17.7 minutes** today, so the lock was quietly
> lapsing mid-run — protecting nothing at the one moment it was needed. If the
> suite grows past ~30 minutes, raise `TTL_MS` again rather than letting it lapse.
>
> ```bash
> node scripts/testRunLock.js           # who holds it
> node scripts/testRunLock.js --clear   # take it back
> ```
>
> Setup and teardown are loaded in **separate module registries**, so they share
> only `__tests__/money/setup/runLock.js` — hanging the id off `globalSetup`'s
> export read back as `undefined`, and the release then filtered on
> `{_id: undefined}`, matched nothing, and reported success.

> ### ⚠️ Every test file gets its own mongoose — so every file must disconnect
>
> Separate module registries are not only a `globalSetup` quirk. Jest gives every
> test **file** its own registry, and its own `global`, so `require("mongoose")`
> in the next file returns a *different* mongoose with a *different* connection.
>
> `disconnectTestDb` was once a no-op on the theory that one connection could
> serve the whole run. It cannot: nothing is shared, so skipping the disconnect
> leaked a connection per suite — thirty-odd of them, each with its own pool and
> topology monitor — until the cluster started refusing. Measured on the full
> suite: **15 suites / 294 tests failed as a no-op, 2 / 4 when it disconnects for
> real.**
>
> That failure does not read as a connection problem. It reads as unrelated
> suites failing on correct assertions and passing when re-run alone — the same
> shape as the two-concurrent-runs bug above, which is exactly why the wrong fix
> looked like the right one. The tell is the message: `Refusing to clear
> collections on "undefined"` means the connection is gone, not the test wrong.
>
> `TEST_DB_KEEP_CONNECTION=1` holds it open when debugging something that needs
> the socket to survive teardown.

> ⚠️ `NODE_ENV=production` is set in some shells here, which makes npm set
> `omit=dev` and skip devDependencies entirely — `npm install` reports success
> and jest never lands. Install dev tooling with
> `NODE_ENV=development npm install --include=dev`.

One-off maintenance lives in `scripts/`, not in a migrations framework. Every one
of them is **dry-run by default** and writes only with `--apply`:

```bash
node scripts/migrateCustomerClaimFoundation.js          # what would change
node scripts/migrateCustomerClaimFoundation.js --apply  # change it
```

> ⚠️ Postman collections are generated, but `trydood-customer` and `trydood-vendor`
> also carry **captured** examples from live runs, which the generators do not know
> about. Re-running a generator rewrites the whole file and deletes them — measured at
> 15,499 lines across the two, with the command still reporting success. Run only the
> generator whose source you changed, and check `git diff --stat postman/` afterwards.
> See `postman/README.md`.

> ⚠️ Never fix a schema drift with `syncIndexes()`. It drops **every** index not
> in the current schema, including any added by hand or by another branch, and it
> names none of them on the way out. Drop by name, and only after verifying the
> replacement index exists — see `scripts/migrateCustomerClaimFoundation.js`.

Server boots from `index.js`, mounts everything under `/trydood/v1`, and connects to Mongo via `database/mongoDb.js`.

---

## Directory Map

| Path | Holds |
|---|---|
| `index.js` | App bootstrap, global middleware, error handler, listener |
| `constants.js` · `constants/` | Frozen enums (`ROLES`, `SCREENS`, …) |
| `routes/` | Express routers — **auto-mounted**, one file per domain |
| `middlewares/` | `verifyJwtToken`, `validateRoles`, `validateSchema`, `errorHandler` |
| `controllers/<domain>/` | Thin request handlers, one file per operation + barrel |
| `services/<domain>/` | Business logic, aggregation pipelines |
| `helpers/<domain>/` | Small reusable domain utilities |
| `models/` | Mongoose schemas (PascalCase, singular) |
| `validator/` | Joi schemas |
| `database/` | Mongo connection, `dbServices`, `buildAggregateLookup` |
| `utils/` | `asyncWrapper`, `CustomError`, `response`, `pagination` |
| `configs/` | Third-party SDK clients (Cloudinary, Razorpay, CGPey, OTP) |
| `docs/` | API documentation |

---

## Request Flow

```
routes/ → middlewares/ → controllers/ → services/ → models/
```

Strictly one direction. A controller never imports a model; a service never sees `req`/`res`.

---

## Core Rules (Quick Reference)

| Rule | Correct | Wrong |
|---|---|---|
| Controller wrapper | `asyncWrapper(async (req, res) => …)` | bare `async` + `try/catch` |
| Success response | `sendSuccess(res, 200, "…", data)` | `res.json(...)` |
| Failure | `throwError(404, "Brand not found")` | `res.status(404).json(...)` |
| Imports | `require("../../services/brands")` | `require(".../brands/getBrand")` |
| Enums | `ROLES.VENDOR` | `"VENDOR"` |
| ObjectId in Joi | `objectId().required()` | `Joi.string()` |
| Joins | `buildAggregateLookup({...})` | hand-written `$lookup` + `$unwind` |
| Lists | `pagination(Model, pipeline, …)` | manual `$skip` / `$limit` |
| Delete | `isDeleted: true` | `deleteOne()` |
| Queries | filter `isDeleted: false` | unfiltered `find()` |
| Transaction queries | `buildTransactionFilter({ purpose, … })` | raw `Transaction.find({ … })` |
| Ledger writes | `recordLedgerEntry({ entryType, … })` | `LedgerEntry.create(…)` |
| Claim pricing | `calculateVoucherPricing(…)` | arithmetic at the call site |
| Redirects | `sendRedirect(res, url)` | `res.redirect(…)` |
| `req.customerId` | `resolveCustomerId(req)` | `String(req.customerId)` — it is a **document** |

---

## Adding an Endpoint

1. **Model** — `models/<Name>.js`, reuse ObjectId descriptors from `models/validObjectId.js`, include `isDeleted`
2. **Constants** — add enums to `constants/`, `Object.freeze`d
3. **Validator** — `validator/<domain>.js`, export `validate<Action>` with custom `.messages()` on every rule
4. **Service** — `services/<domain>/<verb>.js`, plain `async`, `throwError` on failure, update the barrel
5. **Controller** — `controllers/<domain>/<verb>.js`, `asyncWrapper` + `sendSuccess`, update the barrel
6. **Route** — add to `routes/<domain>.js`; the file auto-mounts at `/trydood/v1/<domain>`

Order in a route: auth middleware → `validateSchema(...)` → controller.

```js
router.put("/update", isVendor, validateSchema(validateUpdateBrand), update);
```

---

## Response Envelope

```jsonc
{ "success": true,  "message": "Brand details fetched successfully", "data": {} }
{ "success": false, "message": "Brand not found", "details": {} }
```

Produced only by `utils/response.js`. Never hand-roll it.

---

## Error Handling

Throw, don't catch. `errorHandler` already converts Mongoose `ValidationError` (422), duplicate keys (422), and `CustomError` into the envelope.

```js
const { throwError } = require("../../utils");
throwError(422, "Invalid PAN number");
```

Only use `try/catch` when branching on the error type (see `verifyJwtToken`), and re-`throwError` from each branch.

| Code | Use |
|---|---|
| 400 | Malformed input not caught by Joi |
| 401 | Missing / expired token |
| 403 | Invalid token, or role not permitted |
| 404 | Resource not found |
| 422 | Validation failure, duplicate key |
| 500 | Unexpected |

---

## Auth Context

After `verifyJwtToken` or a role middleware, read these off `req` — never re-decode the JWT:

```js
req.userId · req.role · req.user · req.customerId (CUSTOMER) · req.brandId (VENDOR)
```

Gates: `verifyJwtToken` (any) · `isAdmin` · `isVendor` · `isCustomer` · `validateRoles(A, B)`

---

## Security Musts

- Project away `password`, `otp`, `refreshToken` in every `users` lookup
- Secrets only from `process.env`; never log or return them
- Soft delete only — domain data is never physically removed
- Let Joi own all input validation; `stripUnknown` is already enabled

---

## Code Review Graph

This repo is indexed by `code-review-graph`. Its MCP server is configured in `.mcp.json` and scoped to `server2.0/` via `CRG_REPO_ROOT`.

Use the graph tools to trace callers, impact, and dependencies before editing shared code — `utils/`, `middlewares/`, `constants/`, and `models/` are imported very widely, so a small change there has a large blast radius.

```bash
code-review-graph update     # incremental re-index after changes
code-review-graph status     # node/edge counts
code-review-graph impact     # blast radius of a change
```

Generated skills live in `.claude/skills/` (`explore-codebase`, `review-changes`, `debug-issue`, `refactor-safely`).

---

## Money paths

Two flows share the `transactions` collection, told apart by `purpose`:
**subscriptions** (vendor, VENDOR Razorpay account) and **voucher claims**
(customer, CUSTOMER account). They share a shape and almost no logic.

### The settle is staged, and every step is idempotent

The conditional claim (`findOneAndUpdate({ verified: false })`) is what makes the
browser callback and the webhook safe — they race on **every** payment. But that
claim is terminal, and several writes follow it: a process that dies in between
leaves a transaction `verified: true` with the work half done and no way back in.

So `settlementStage` records how far it got — `CLAIMED → RECORDED → INVOICED →
COMPLETE` — and `resumeIncompleteSettlements` re-runs the whole thing with
`resume: true`. Because every step is idempotent, **resume does not need to know
where it stopped**.

If you add a step to a settle, it must be safe to run twice, and it must sit
before the `COMPLETE` stage marker.

### Locks are taken when a record is created, not when it is paid

`VoucherClaim.holdsUsageSlot` is set the moment the claim exists. Waiting for
payment leaves exactly the window a race needs: two checkouts open, neither
holding anything, both allowed through.

### A refund holds the money before anyone decides about it

`Transaction.settlementHold` goes on the moment a refund is requested. That one
line removes the whole "we already paid the vendor, now claw it back" problem —
the golden rule (`settlementDelayHours >= windowHours + vendorApprovalHours +
adminBufferHours`) then guarantees a refund can never chase money already paid.

The mirror is just as dangerous: **a hold nobody releases keeps a vendor's money
out of every future settlement, for ever, and silently** — the eligibility
predicate simply stops matching, with no error and no log. So
`releaseSettlementHold()` is called from every terminal state where no money
moves, and never from `FAILED`.

A **full** refund keeps the hold: that money was never the vendor's. A
**partial** one releases it, because the rest of the sale still is theirs — see
below.

Everything else that sets a hold (a chargeback, a dashboard refund, a completed
partial) is released only by `PATCH /transactions/admin/:transactionId/release-hold`,
which requires a written reason and refuses while a refund is still open or a
chargeback is unresolved. Before that endpoint existed there was **no** way out
of those states at all.

### A partial refund is netted in the arithmetic, never by exclusion

⚠️ Eligibility excludes `isRefunded: true` — a **fully** refunded payment. It
used to exclude `amountRefunded: { $lte: 0 }`, which caught partial refunds too,
and that field only ever goes up: a payment with ₹300 of ₹810 back was removed
from every future cycle, for ever. `claimRefundAdjustments` then deducted its
clawback from a *later* cycle anyway, so the vendor lost the sale **and** paid
the clawback — about ₹1,100 wrong on an ₹800 sale, silently.

The netting belongs in the totals. The payment is claimed at full value and its
refund is claimed beside it, so `computeTotals` subtracts exactly the clawback.
Two rules make that safe:

- `claimRefundAdjustments` claims a refund only when its payment carries a
  `settlementId` — i.e. it was, or is being, paid out. A refund on a payment
  nobody will ever pay must not be clawed back from other sales.
- The two claims run **in order**, transactions first. They used to be a
  `Promise.all`, and the refund claim reads the id the transaction claim writes.

Full flow: [`docs/refund_flow.md`](./docs/refund_flow.md).

### A settlement fails by *not happening*

Every other money path here fails loudly. A settlement has three failure modes
that all look like nothing at all: the nightly build never ran, a `MANUAL_BANK`
NEFT was started and never confirmed, or a payout booked no ledger row. None of
them raise, so each has a sweep whose whole job is to look for the absence —
`buildSettlements`, `sweepStalePayouts`, `reconcileSettlementLedger` and
`sweepAbandonedDrafts`, all registered in `jobs/index.js`.

`sweepStalePayouts` **alerts and never acts**, deliberately: an unconfirmed NEFT
may genuinely have left, and auto-failing it would release the rows and pay the
vendor twice.

### A chargeback is recovered from the next cycle

⚠️ `CHARGEBACK` / `CHARGEBACK_REVERSAL` sat in the ledger's rules table with
nothing writing either, and `chargebackAdjustment` was hardcoded `0` — so a
payment that was settled, paid out, and then pulled back by the bank left no
trace and the platform silently ate it.

A **lost** dispute books `CHARGEBACK` against `VENDOR_PAYABLE` for the vendor's
share only — never the whole disputed amount, which includes our fee and our
half of the promo — and is recovered from the brand's next settlement.
`Transaction.chargebackSettlementId` is the claim lock, the same discipline the
refunds use: without it, one lost dispute is deducted every cycle for ever and
each month's arithmetic looks self-consistent.

`ledger_type_dispute_unique` keys on the dispute rather than the transaction,
because Razorpay redelivers dispute webhooks **and sends them out of order** — a
late `lost` can follow a `won`.

### The ledger has to add up, not just have the right rows

Every ledger test checked row shape; none summed the accounts, and three defects
lived in exactly that gap. After a capture and a full refund, `VENDOR_PAYABLE`,
`PLATFORM_REVENUE` and `TAX_PAYABLE` must all return to **zero** —
`__tests__/money/ledgerBalance.test.js` asserts balances rather than rows, and
`moneyInvariants.test.js` asserts the vendor identity across every ending a
payment can have:

```
what the vendor has been paid  +  what they are still owed
    ===  their share of the sale  −  their share of anything refunded
```

⚠️ `PLATFORM_COST` deliberately does **not** return to zero: Razorpay keeps its
MDR whether or not the sale is refunded.

Full flow: [`docs/settlement_flow.md`](./docs/settlement_flow.md).

### An idempotency key is inserted before the external call, never after

Two concurrent taps both pass a read-then-write check. Inserting the key is what
makes the second one lose — the unique index decides, not the timing. And the
gateway is called **last**, because it is the only step with no undo.

---

## Production

Render today, EC2 next. One instance now, more later — so nothing may keep state
in the process that a second copy would contradict.

### Environment

| Variable | Default | What it decides |
|---|---|---|
| `MONGO_MAX_POOL_SIZE` | `20` | Sockets **per process**. See the arithmetic below. |
| `MONGO_MIN_POOL_SIZE` | `2` | Warm sockets, so the first request after a quiet spell does not pay a TLS handshake. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `10000` | How long a request waits for a reachable node before failing. |
| `MONGO_AUTO_INDEX` | on | `false` only after `ensureIndexes` has run. See below. |
| `TRUST_PROXY` | `1` | Proxy hops in front. `1` for Render and for an ALB; `0` for a bare EC2 box. |
| `RATE_LIMIT_MAX` | `3000` | Requests per IP per 15 minutes. |
| `LOG_FORMAT` | `combined` in prod | Any morgan format. |
| `ENABLE_JOBS` | on | `false` stops every sweep on that instance. |

### The connection pool is the first thing that breaks

    total connections  =  pool size  ×  workers per instance  ×  instances

Mongoose opens **100** per process by default and a Flex cluster allows 500 for
the whole account. One process today is fine; 4 pm2 workers on 3 instances is
1200, and past the ceiling Atlas refuses new connections — every request fails
at once, and it looks like the database went down. At 20 the same growth lands
at 240.

⚠️ The **tests** had this tuned (`maxPoolSize: 5`, with a comment explaining the
ceiling) while production connected with no options at all. If you tune one,
look at the other.

### `MONGO_AUTO_INDEX=false` needs a deploy step

Mongoose checks every schema's indexes when each model is first used: measured
at 6.3s for five models with every index **already present**, so ~65s of
background round trips across 53 models, competing with the traffic that arrives
right after a deploy. It also swallows `IndexOptionsConflict`, so a mismatched
index simply never appears.

Turning it off is right. Turning it off without creating the indexes another way
is not — the money paths depend on partial unique indexes for **correctness**:
`holdsUsageSlot`, `isOncePerTransaction`, the idempotency keys and
`ledger_type_dispute_unique` are what stop two rows that must never coexist from
both inserting, and nothing errors when one is missing.

```bash
node scripts/ensureIndexes.js           # what is missing
node scripts/ensureIndexes.js --apply   # create it, then set MONGO_AUTO_INDEX=false
```

It reports extra indexes and never drops them — see the `syncIndexes` warning
above.

### A process manager is not optional

Boot retries Mongo three times and then `process.exit(1)`. Render restarts a
crashed process by itself; a bare `node index` under `nohup` does not, so a
two-minute Atlas blip at deploy time would leave the server down for good. Use
systemd with `Restart=on-failure` (or pm2). Each boot attempt takes up to ~90s,
so systemd's default `StartLimitBurst` will not trip, but set it deliberately.

### Rate limiting counts per process, and an IP is not a person

⚠️ Indian mobile networks put thousands of real customers behind one CGNAT
address. The limit is 3000 per 15 minutes precisely because a tight one does not
stop an attacker with a phone — it locks out a whole block of paying users, who
see a 429 and no explanation. Per-account limits on OTP, login and refund
requests are the real protection and do not exist yet.

⚠️ The counter lives in the process. A second instance keeps its own tally and
the effective limit doubles. When this moves behind a load balancer, move the
store to Redis rather than halving the number.

⚠️ Both Razorpay webhook paths are exempt in `index.js`. A 429 to a webhook is
retried for a while and then dropped, and the only symptom is money that stops
moving — no error anywhere. If you add a third webhook, add it to
`WEBHOOK_PATHS`.

### Moving off Render

- Atlas **Network Access** allows Render's addresses, not EC2's. Take an
  **Elastic IP** so it does not change on restart. Since boot now refuses to
  start without a database, a forgotten entry fails the deploy instead of
  serving broken requests.
- `getIP` (`GET /my-ip`) reports the outbound address to put on that list.
- `tempFileDir: "/tmp/"` in `index.js` is fine on Linux; make sure the unit has
  a writable `/tmp` and something clears it.

## Never

- `try/catch` in a controller
- `res.json()` / `res.status()` outside `utils/response.js`
- Model import inside a controller
- `req` / `res` inside a service
- Business logic in a route file
- Hard delete of domain data
- Magic strings where a `constants` entry exists
- Manual pagination or hand-written `$lookup` + `$unwind`
- Committing `.env` or any credential
- Querying `Transaction` without `buildTransactionFilter` — one collection holds both
  vendor subscriptions and customer voucher claims, and a forgotten `purpose` silently
  mixes them. Pass `purpose: null` when you genuinely want both.
- Hardcoding a Razorpay account (`ROLES.VENDOR` / `ROLES.CUSTOMER`) at a call site —
  read `transaction.gatewayAccount` instead. See `constants/transaction.js`.
- Writing a `LedgerEntry` directly. Go through `helpers/ledger/recordLedgerEntry.js`
  — it derives the account and direction from the entry type, so two call sites
  cannot disagree about which way a refund moves, and it makes the capture-time
  entries idempotent. **A ledger row is never updated and never deleted**: a
  correction is a new row with `reversalOf` set.
- Putting `$in` in a `partialFilterExpression`. Mongo accepts only equality,
  `$exists`, comparisons and `$type`. "In one of these statuses" has to become a
  denormalised boolean — `VoucherClaim.holdsUsageSlot`,
  `LedgerEntry.isOncePerTransaction` — and the index keys on that.
- Scheduling background work with a bare `setInterval` outside `jobs/index.js`. The
  runner is an in-process timer, so on a multi-instance deploy anything it schedules
  runs once per instance. Add the job to the registry in `jobs/index.js` and it gets
  the cross-process `JobLock` and the health record for free.
