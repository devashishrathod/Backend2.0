/**
 * ---------------- stand in for the gateway, on a non-production database ----------------
 *
 * `fundsReceivedAt` is the one field that says *"this money is actually in our
 * bank"*, and `buildEligibilityFilter` refuses to settle a payment without it.
 * In production exactly one thing writes it — the `settlement.processed` webhook
 * — and that is the whole point: the platform never *guesses* that money has
 * arrived, because paying a vendor out of money the gateway still holds is how a
 * business ends up funding its own float without deciding to.
 *
 * Which leaves testing with a problem. A gateway account that is not settling —
 * a test account, a schedule that never runs, an account under review — produces
 * captured payments that can never become eligible, so the settlement and payout
 * flow cannot be exercised end to end at all.
 *
 * This script is the operator's stand-in for that webhook. It is deliberately
 * **a script and not a branch in the application**: a `NODE_ENV` check inside
 * `buildEligibilityFilter` would be one deploy away from paying real vendors out
 * of money nobody had received, and it would be invisible in review. A separate
 * file that a person runs, against a database they have to name out loud, cannot
 * fire by accident.
 *
 *   node scripts/markFundsReceived.js                          # what would change
 *   node scripts/markFundsReceived.js --apply --db Trydood2    # change it
 *   node scripts/markFundsReceived.js --apply --db Trydood2 --backdate-hours 12
 *   node scripts/markFundsReceived.js --apply --db Trydood2 --payment pay_XXXX
 *   node scripts/markFundsReceived.js --apply --db Trydood2 --age-days 4
 *
 * ### Two different gates, two different flags
 *
 * A payment has to clear **both** of these before a build will take it, and they
 * fail identically from the outside — nothing happens:
 *
 *  - `verifiedAt <= periodEnd` — the T+`delayDays` ceiling. A sale captured today
 *    is simply not inside a T+3 cycle's period, and marking funds cannot change
 *    that. `--age-days` moves the capture back so it is.
 *  - `fundsReceivedAt <= now − payoutBufferHours` — the wait after the money
 *    lands. `--backdate-hours` skips it.
 *
 * `--age-days N` is the one to reach for when testing a fresh claim against the
 * real `delayDays: 3`: it ages the whole sale rather than lowering the setting,
 * so the pipeline is exercised under **production's own configuration** instead
 * of a relaxed one that proves less.
 *
 * ### ⚠️ `--apply` will not run without `--db <name>`
 *
 * And the name has to match the database actually connected. The guard is on the
 * **database**, never on `NODE_ENV`: a `.env` copied from staging sets
 * `NODE_ENV=development` while `MONGO_URL` points at production, and that is the
 * exact mistake this has to survive. Naming the database makes the operator state
 * which one they believe they are on, and a mismatch refuses rather than writes.
 *
 * ### What it writes, and how it stays honest
 *
 * `razorpaySettlementId` is stamped `MANUAL:<iso>` rather than left empty, so a
 * simulated settlement can always be told apart from one the gateway really
 * made — in the database, in a report, and by `reconcileGatewaySettlements`,
 * which skips a batch id it has already seen and will never collide with these.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const Transaction = require("../models/Transaction");
const VoucherClaim = require("../models/VoucherClaim");
const { PAYMENT_STATUS } = require("../constants");
const { TRANSACTION_PURPOSE } = require("../constants/transaction");
const { buildTransactionFilter } = require("../helpers/transactions");
const { getCustomerConfig } = require("../helpers/settings");
const {
  settlementPeriodEnd,
} = require("../helpers/dates");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const argOf = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] || null;
};

const APPLY = process.argv.includes("--apply");
const CLAIMED_DB = argOf("--db");
const ONE_PAYMENT = argOf("--payment");
const BACKDATE_HOURS = Number(argOf("--backdate-hours") || 0) || 0;
/**
 * Pretend the sale itself happened `N` days ago.
 *
 * ⚠️ This rewrites `verifiedAt` on the payment and `paidAt` on the claim, which
 * is a heavier thing than stamping a field that was empty — so it is opt-in and
 * named for what it does rather than for the gate it happens to clear.
 *
 * The alternative is worse: lowering `settlement.delayDays` to 0 so today's sale
 * falls inside today's period. That is refused by `assertSettlementTimingRule`
 * unless the refund windows are flattened too — and a pipeline proved under
 * `delayDays: 0` with no refund window is a pipeline proved under a
 * configuration production will never run.
 */
const AGE_DAYS = Number(argOf("--age-days") || 0) || 0;

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;
const short = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—");

const main = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const dbName = mongoose.connection.name;

  console.log(`\nDatabase: ${dbName}`);
  console.log(
    APPLY
      ? "Mode: APPLY — rows will be written"
      : "Mode: DRY RUN — nothing will be written (pass --apply --db <name> to write)",
  );

  /**
   * ⚠️ The guard, and it is on the database name rather than on `NODE_ENV`.
   *
   * A `.env` copied between environments changes `MONGO_URL` and leaves
   * `NODE_ENV` saying whatever it said before, so the environment variable is
   * precisely the thing that lies in the case worth guarding against. Making the
   * operator name the database means an accidental production connection refuses
   * instead of writing.
   */
  if (APPLY && CLAIMED_DB !== dbName) {
    console.error(
      `\n❌ Refusing to write.\n` +
        `   Connected to : ${dbName}\n` +
        `   --db said    : ${CLAIMED_DB || "(not given)"}\n\n` +
        `   Re-run with --db ${dbName} if that is genuinely the database you mean.\n` +
        `   This is the only thing standing between a mistyped MONGO_URL and\n` +
        `   marking production money as received when it is not.\n`,
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  // ---------------- what is waiting ----------------
  const filter = {
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    verified: true,
    status: PAYMENT_STATUS.CAPTURED,
    /**
     * Never a row the gateway has already settled. Re-stamping one would replace
     * an observed timestamp with an invented one and quietly move that payment
     * into a different settlement period.
     */
    fundsReceivedAt: null,
    ...(ONE_PAYMENT ? { razorpayPaymentId: ONE_PAYMENT } : {}),
  };

  const waiting = await Transaction.find(filter)
    .select("razorpayPaymentId amount paidAmount verifiedAt brandId")
    .sort({ verifiedAt: 1 })
    .lean();

  if (!waiting.length) {
    console.log(
      ONE_PAYMENT
        ? `\nNothing to do: ${ONE_PAYMENT} is not a captured claim payment awaiting funds.`
        : "\nNothing to do: every captured claim payment already has fundsReceivedAt.",
    );
    await mongoose.disconnect();
    return;
  }

  const total = waiting.reduce(
    (sum, t) => sum + (t.paidAmount ?? t.amount ?? 0),
    0,
  );

  console.log(
    `\n${waiting.length} captured claim payment(s) awaiting funds · ${money(total)}\n`,
  );

  /**
   * When the sale is treated as having happened.
   *
   * Unchanged unless `--age-days` is given — a settlement period is chosen from
   * `verifiedAt`, so moving it is the difference between testing a fresh claim
   * today and waiting three days for the cycle to reach it.
   */
  const capturedAtFor = (txn) => {
    const original = new Date(txn.verifiedAt || txn.createdAt);
    return AGE_DAYS
      ? new Date(original.getTime() - AGE_DAYS * DAY_MS)
      : original;
  };

  /**
   * When the gateway is treated as having settled it.
   *
   * The capture moment by default, because that is what a real settlement would
   * carry it back to — inventing "now" would file an old sale in today's cycle.
   */
  const stampFor = (txn) =>
    new Date(capturedAtFor(txn).getTime() - BACKDATE_HOURS * HOUR_MS);

  for (const txn of waiting) {
    const aged = AGE_DAYS
      ? `  captured ${short(txn.verifiedAt)} → ${short(capturedAtFor(txn))}`
      : `  captured ${short(txn.verifiedAt)}`;
    console.log(
      `  ${txn.razorpayPaymentId || txn._id}  ${money(txn.paidAmount ?? txn.amount)}` +
        `${aged}  →  fundsReceivedAt ${short(stampFor(txn))}`,
    );
  }

  if (AGE_DAYS) {
    console.log(
      `\n  ⚠️ --age-days ${AGE_DAYS}: the sale itself is moved back, so it lands inside a` +
        `\n     T+delayDays period. This rewrites verifiedAt on the payment and paidAt on` +
        `\n     the claim. The ledger keeps its original dates — it is not read by the` +
        `\n     settlement build, only by reconcileSettlementLedger, which compares payouts.`,
    );
  }

  if (BACKDATE_HOURS) {
    console.log(
      `\n  (--backdate-hours ${BACKDATE_HOURS}: stamps are moved back so ` +
        `settlement.payoutBufferHours is already satisfied)`,
    );
  }

  // ---------------- write ----------------
  if (APPLY) {
    const settlementId = `MANUAL:${new Date().toISOString()}`;
    let updated = 0;
    let aged = 0;

    for (const txn of waiting) {
      const capturedAt = capturedAtFor(txn);

      const result = await Transaction.updateOne(
        // `fundsReceivedAt: null` again, so a real webhook landing between the
        // read above and this write wins rather than being overwritten.
        { _id: txn._id, fundsReceivedAt: null },
        {
          $set: {
            fundsReceivedAt: stampFor(txn),
            razorpaySettlementId: settlementId,
            ...(AGE_DAYS ? { verifiedAt: capturedAt } : {}),
          },
        },
      );
      updated += result.modifiedCount ?? 0;

      /**
       * The claim moves with its payment, or the two disagree about when the
       * customer paid — and `requestRefund` measures the refund window from
       * `claim.paidAt`, so leaving it behind would quietly open a window that
       * had already closed.
       */
      if (AGE_DAYS && result.modifiedCount) {
        const claimResult = await VoucherClaim.updateOne(
          { transactionId: txn._id },
          { $set: { paidAt: capturedAt } },
        );
        aged += claimResult.modifiedCount ?? 0;
      }
    }

    console.log(`\n✅ ${updated} payment(s) marked as received.`);
    if (AGE_DAYS) console.log(`   ${aged} claim(s) aged by ${AGE_DAYS} day(s).`);
    console.log(`   razorpaySettlementId: ${settlementId}`);
  }

  // ---------------- what the next build will actually take ----------------
  /**
   * Printed whether or not anything was written, because "I marked them and no
   * settlement appeared" is the next question either way — and the answer is
   * almost always one of these two windows rather than anything being broken.
   */
  await explainEligibility({ waiting, stampFor, capturedAtFor, applied: APPLY });

  await mongoose.disconnect();
};

/**
 * Say which of these will be picked up by the next `buildSettlements`, and when.
 *
 * Two separate gates decide it, and they fail for different reasons:
 *
 *  - `verifiedAt <= periodEnd` — the T+`delayDays` ceiling. A sale from today is
 *    not in a T+3 cycle's period, and no amount of marking funds changes that.
 *  - `fundsReceivedAt <= now − payoutBufferHours` — the extra wait after the
 *    money lands.
 *
 * Without this, both read identically from the outside: nothing happens.
 */
const explainEligibility = async ({ waiting, stampFor, capturedAtFor, applied }) => {
  const config = await getCustomerConfig();
  const settings = config.settlement || {};

  const delayDays = Number.isFinite(Number(settings.delayDays))
    ? Number(settings.delayDays)
    : 3;
  const bufferHours = Number(settings.payoutBufferHours) || 0;

  const now = new Date();
  const periodEnd = settlementPeriodEnd(delayDays, now);
  const fundsBefore = new Date(now.getTime() - bufferHours * HOUR_MS);

  console.log(
    `\nNext buildSettlements window` +
      `\n  delayDays ${delayDays} → periodEnd ${short(periodEnd)}` +
      `\n  payoutBufferHours ${bufferHours} → fundsReceivedAt must be ≤ ${short(fundsBefore)}\n`,
  );

  const ready = [];
  const waitingOnPeriod = [];
  const waitingOnBuffer = [];

  for (const txn of waiting) {
    const stamp = stampFor(txn);
    // The capture date **as it will be after the write**, not as it is now —
    // otherwise `--age-days` reports every row as still out of period.
    const inPeriod = capturedAtFor(txn) <= periodEnd;
    const pastBuffer = stamp <= fundsBefore;

    if (!inPeriod) waitingOnPeriod.push(txn);
    else if (!pastBuffer) waitingOnBuffer.push({ txn, stamp });
    else ready.push(txn);
  }

  if (ready.length) {
    console.log(
      `  ✅ ${ready.length} ready now` +
        (applied ? " — run buildSettlements and a settlement will appear" : ""),
    );
  }

  if (waitingOnBuffer.length) {
    const soonest = waitingOnBuffer
      .map(({ stamp }) => stamp.getTime() + bufferHours * HOUR_MS)
      .sort((a, b) => a - b)[0];
    console.log(
      `  ⏳ ${waitingOnBuffer.length} waiting on payoutBufferHours — eligible from ${short(new Date(soonest))}` +
        `\n       (re-run with --backdate-hours ${bufferHours + 1} to skip this wait)`,
    );
  }

  if (waitingOnPeriod.length) {
    console.log(
      `  📅 ${waitingOnPeriod.length} captured after periodEnd — a T+${delayDays} cycle will not` +
        `\n       reach them yet. They become eligible as the period moves forward;` +
        `\n       marking funds cannot change this and is not meant to.` +
        `\n       To test one today without touching delayDays, re-run with` +
        `\n       --age-days ${delayDays + 1} to move the sale itself back.`,
    );
  }

  if (!applied) {
    console.log(`\n  (dry run — nothing was written)`);
  }
  console.log("");
};

main().catch(async (error) => {
  console.error("\n❌ markFundsReceived failed:", error?.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
