const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  isVendorOrSubVendor,
  verifyJwtToken,
} = require("../middlewares");
const {
  validateGetDisputes,
  validateDisputeDetail,
  validateAddDisputeEvidence,
  validateDisputeEvidencePack,
} = require("../validator/transactions");
const {
  disputeList,
  disputeDetail,
  disputeAddEvidence,
  disputeEvidencePack,
} = require("../controllers/transactions");

/**
 * ---------------- chargebacks ----------------
 *
 * ### Why this is its own domain
 *
 * A dispute began as ten denormalised fields on `Transaction` and lived under
 * `/transactions/disputes` because that is where the data was. It is its own
 * collection now — a payment can carry several, each with its own deadline and
 * its own money — and a record with its own model, its own jobs, its own
 * notifications and its own worklist is a domain.
 *
 * ⚠️ **The old paths still work.** `routes/transactions.js` declares the same
 * three routes against the **same controllers**, so there is exactly one
 * implementation and nothing to drift; `__tests__/money/disputeVisibility.test.js`
 * asserts the two mounts stay identical. They are kept because the Postman
 * collections and anything already integrated point at them, and a 404 is a
 * worse answer than a duplicate line in a route table.
 *
 * ### Every route carries its own gate
 *
 * ⚠️ There is **no** blanket `router.use(verifyJwtToken)` here, deliberately —
 * `routes/transactions.js` has none either, because its public invoice link
 * would not survive one, and a reader moving between the two files must not have
 * to remember which of them has a blanket gate. Each line says what it needs.
 */

/**
 * The worklist, soonest response deadline first.
 *
 * ⚠️ Token-gated, **not** `isAdmin`. A vendor sees their own brand's disputes —
 * scoped inside the service, in the filter — because until they could, a
 * chargeback showed up as money that silently stopped arriving and, later, a
 * deduction with no sale attached to it. Their shape carries none of our queue:
 * no deadline, no alert count, no recovery state. See `docs/dispute_flow.md` §4.
 *
 * ⚠️ A `CUSTOMER` token is refused inside `scopeFor` with a 403. A chargeback is
 * between us and their bank; they raised it there, and a Trydood screen about it
 * can only confuse or inflame.
 */
router.get(
  "/",
  verifyJwtToken,
  validateSchema(validateGetDisputes),
  disputeList,
);

/**
 * The outlet adds what only they have — a bill or KOT number, a camera
 * timestamp, what the staff remember.
 *
 * ⚠️ Declared **above** `/:disputeId`, with the rest of the deeper paths. They
 * differ in segment count so Express would not confuse them today, but the
 * ordering is what decides it the day a one-segment write appears.
 *
 * ⚠️ A bonus, never a dependency: `buildEvidencePack` stands on our own records,
 * and filing never waits on the vendor because a dispute gets **one** response
 * and the deadline belongs to the bank.
 */
router.post(
  "/:disputeId/evidence",
  isVendorOrSubVendor,
  validateSchema(validateAddDisputeEvidence),
  disputeAddEvidence,
);

/**
 * Everything we can prove, with the argument already written out — for the admin
 * filing it in the Razorpay dashboard.
 *
 * ⚠️ Admin only: it carries the customer's masked contact, the whole claim
 * timeline and the case we intend to make.
 */
router.get(
  "/:disputeId/evidence-pack",
  isAdmin,
  validateSchema(validateDisputeEvidencePack),
  disputeEvidencePack,
);

/**
 * One dispute, in the same two shapes the list uses.
 *
 * ⚠️ The projections are shared with the list rather than written out again — a
 * detail read with its own projection is the ordinary way a field the list
 * carefully hides ends up on a screen it was kept off.
 *
 * Addressable by Razorpay's `disp_…` **or** our `_id`: the first is what an admin
 * reads off the dashboard and what every alert carries, the second is what a
 * panel holds after a list call.
 */
router.get(
  "/:disputeId",
  verifyJwtToken,
  validateSchema(validateDisputeDetail),
  disputeDetail,
);

/**
 * ⚠️ Releasing the hold is **not** here, and that is not an oversight.
 *
 * `settlementHold` sits on the **transaction**, not the dispute — a payment can
 * be held by a refund, a dashboard refund or a failed payout with no dispute
 * anywhere near it. The one endpoint that clears it is
 * `PATCH /transactions/admin/:transactionId/release-hold`, which requires a
 * written reason and refuses while a refund is still open. Mirroring it here
 * would mean two ways to move the same money and two chances for one of them to
 * skip that check.
 */

module.exports = router;
