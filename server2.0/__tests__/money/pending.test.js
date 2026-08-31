/**
 * The money tests that cannot be written yet, kept visible instead of forgotten.
 *
 * The plan lists fifteen; Phase 0 covers the ones whose code exists today. The
 * rest depend on services that arrive with later phases, and each is recorded
 * here as a `todo` so jest prints it on every run. A checklist in a document
 * gets skimmed; a line in the test output does not.
 *
 * Each name says what it must prove and which phase brings the code, so whoever
 * builds that phase can turn the todo into a test without re-deriving the case.
 */
describe("Phase S1 — refunds", () => {
  // Test 10 — settlement §6.4. Razorpay sends the cumulative refunded amount on
  // the payment entity; two partial refunds must not be summed twice, so the
  // writer takes a `$max` rather than a `$inc`.
  it.todo("two partial refunds leave amountRefunded cumulative, not doubled");
  // Test 11 — settlement §5.3. A hold that is never released takes a vendor's
  // money out of every future settlement, silently, because the eligibility
  // predicate simply stops matching.
  it.todo("rejecting a refund releases the settlement hold");
});

describe("Phase S2 — settlements and disputes", () => {
  // Test 12 — settlement §3.5. A cancelled settlement must hand its rows back,
  // or that day's takings are stranded with nothing pointing at them.
  it.todo("cancelling a settlement returns its rows to the next cycle");
  // Test 13 — settlement §3.6. A dispute raised after a settlement was built
  // must block the approval, not be discovered after the payout has left.
  it.todo("a dispute raised after build blocks approval (needsRevalidation)");
  // Test 14 — settlement §3.6. Eligibility keys on `settlementHold`, never on
  // `isDisputed`, and a webhook must never clear a hold on its own.
  it.todo("dispute.lost makes a row settlement-ineligible");
});
