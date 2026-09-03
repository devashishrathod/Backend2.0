/**
 * Who sees a chargeback, and how much of it.
 *
 * ### ⚠️ Why this file exists
 *
 * Until the `/disputes` list was scoped, a chargeback was invisible to the one
 * person whose money it takes. From the outlet's side it looked like a sale that
 * settled, then a deduction on a later statement with no sale attached to it —
 * so the first they heard of it was a support call asking why the payout was
 * short, weeks after the deadline to contest it had passed.
 *
 * Making it visible is only half of it. The queue around a dispute — the bank's
 * deadline, how many warnings have gone out, whether we can claw it back — is
 * **ours**, and showing an outlet a countdown they cannot act on produces
 * anxiety and a support call, not evidence. So the two shapes are asserted here
 * field by field: what a vendor gets, and what a vendor must never get.
 */
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const Customer = require("../../models/Customer");

const { recordDispute } = require("../../helpers/disputes");
const {
  getDisputes,
  getDispute,
  addVendorDisputeEvidence,
  getDisputeEvidencePack,
} = require("../../services/transactions");

const { DISPUTE_STATUS } = require("../../constants/webhook");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const secondsFromNow = (h) => Math.floor((Date.now() + h * HOUR) / 1000);

const COLLECTIONS = [
  Transaction,
  Dispute,
  VoucherClaim,
  VoucherClaimHistory,
  Customer,
];

let OURS;
let THEIRS;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = (brandId = OURS) => ({ role: ROLES.VENDOR, brandId, userId: oid() });

/** `invoiceId_unique_partial` is real — every seeded payment needs its own. */
let invoiceSeq = 0;
const nextInvoiceId = () =>
  `TD/VCH/26-27/${String(++invoiceSeq).padStart(6, "0")}`;

/** An ₹810 payment. Vendor share is 800 − 50 promo − 0 commission = 750. */
const payment = async ({ brandId, settled = true, customerId } = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    brandId,
    customerId: customerId || oid(),
    subBrandId: oid(),
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
    razorpaySignature: "a".repeat(64),
    invoiceId: nextInvoiceId(),
    ...(settled ? { settlementId: oid() } : {}),
    voucher: {
      claimId: oid(),
      billAmount: 1000,
      netBill: 800,
      vendorPromoCost: 50,
      commissionAmount: 0,
      commissionDeduction: 0,
    },
  });

const entity = (id, overrides = {}) => ({
  id,
  amount: 81000,
  reason_code: "fraud",
  phase: "chargeback",
  respond_by: secondsFromNow(48),
  ...overrides,
});

const open = async (txn, id, overrides = {}) => {
  await recordDispute({
    transaction: txn,
    dispute: entity(id, overrides),
    status: overrides.status || DISPUTE_STATUS.OPEN,
  });
  return Dispute.findOne({ disputeId: id }).lean();
};

beforeAll(async () => {
  await connectTestDb();
  for (const model of COLLECTIONS) await model.createIndexes();
});

afterAll(async () => {
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  OURS = oid();
  THEIRS = oid();
});

describe("who can see a dispute at all", () => {
  it("shows a vendor their own brand's disputes", async () => {
    const mine = await payment({ brandId: OURS });
    await open(mine, "disp_mine");

    const page = await getDisputes(vendor(), {});

    expect(page.total).toBe(1);
    expect(page.data[0].disputeId).toBe("disp_mine");
  });

  /**
   * ⚠️ Scoped in the **filter**, not by hiding fields afterwards.
   *
   * A projection that merely looks scoped is how somebody later writes a second
   * read against the same collection and ships a report that was never scoped
   * at all.
   */
  it("does not show a vendor another brand's disputes", async () => {
    const theirs = await payment({ brandId: THEIRS });
    await open(theirs, "disp_theirs");

    const page = await getDisputes(vendor(), {});

    expect(page.total).toBe(0);
    expect(page.data).toEqual([]);
  });

  /** A brandId in the query string must not widen a vendor's own scope. */
  it("ignores a brandId a vendor passes for somebody else", async () => {
    const theirs = await payment({ brandId: THEIRS });
    await open(theirs, "disp_theirs");

    const page = await getDisputes(vendor(), { brandId: String(THEIRS) });

    expect(page.total).toBe(0);
  });

  it("honours a brandId filter from an admin", async () => {
    await open(await payment({ brandId: OURS }), "disp_ours");
    await open(await payment({ brandId: THEIRS }), "disp_theirs");

    const page = await getDisputes(admin(), { brandId: String(THEIRS) });

    expect(page.data.map((d) => d.disputeId)).toEqual(["disp_theirs"]);
  });

  /**
   * ⚠️ A customer gets nothing — deliberately.
   *
   * They raised this at their bank, not here. A Trydood screen about it can only
   * confuse or inflame, and there is no action for them to take on our side.
   */
  it("refuses a customer outright", async () => {
    await expect(getDisputes({ role: ROLES.CUSTOMER, customerId: oid() }, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a vendor with no brand on the account", async () => {
    await expect(
      getDisputes({ role: ROLES.VENDOR, userId: oid() }, {}),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  /**
   * ⚠️ No disputes is the normal state, not a missing record.
   *
   * `pagination` answers 404 on an empty page unless told otherwise, which would
   * make a clean record render as an error screen — and teach people that the
   * Disputes tab is broken, so they stop opening it.
   */
  it("returns an empty page rather than a 404 when there are none", async () => {
    const forVendor = await getDisputes(vendor(), {});
    const forAdmin = await getDisputes(admin(), {});

    expect(forVendor).toMatchObject({ total: 0, data: [] });
    expect(forAdmin).toMatchObject({ total: 0, data: [] });
  });
});

describe("what a vendor is shown", () => {
  let row;
  let txn;

  beforeEach(async () => {
    txn = await payment({ brandId: OURS });
    await open(txn, "disp_shape");
    await Dispute.updateOne({ disputeId: "disp_shape" }, { $set: { alertsSent: 2 } });
    const page = await getDisputes(vendor(), {});
    row = page.data[0];
  });

  it("gives them the sale, the amount and where it stands", () => {
    expect(row).toMatchObject({
      disputeId: "disp_shape",
      invoiceId: txn.invoiceId,
      claimAmount: 810,
      disputeAmount: 810,
      disputeStatus: DISPUTE_STATUS.OPEN,
    });
    expect(row.disputedAt).toBeInstanceOf(Date);
  });

  /**
   * ⚠️ The deadline is ours to meet, and the evidence is filed by us.
   *
   * There is nothing an outlet does differently on the last day than on the
   * first, so a countdown is a warning they cannot act on. `alertsSent`,
   * `recoverySettlementId` and `vendorWasPaid` are our own bookkeeping about
   * whether we can claw it back — not their side of the question.
   */
  it.each([
    "disputeRespondBy",
    "respondBy",
    "daysToRespond",
    "isOverdue",
    "isUrgent",
    "alertsSent",
    "recoverySettlementId",
    "recoveredAt",
    "vendorWasPaid",
    "vendorNotifiedAt",
    "disputeReason",
    "disputePhase",
  ])("never carries %s", (field) => {
    expect(row).not.toHaveProperty(field);
  });

  it("carries none of the customer's details", () => {
    expect(row).not.toHaveProperty("customerId");
    expect(row).not.toHaveProperty("payment");
    expect(JSON.stringify(row)).not.toContain("@");
  });
});

describe("what an admin is shown", () => {
  it("carries the deadline, the alert count and whether the vendor was paid", async () => {
    const txn = await payment({ brandId: OURS, settled: true });
    await open(txn, "disp_admin");

    const page = await getDisputes(admin(), {});
    const row = page.data[0];

    expect(row).toMatchObject({
      disputeId: "disp_admin",
      disputeReason: "fraud",
      disputePhase: "chargeback",
      alertsSent: 0,
      vendorWasPaid: true,
      isOverdue: false,
    });
    expect(row.disputeRespondBy).toBeInstanceOf(Date);
    expect(row.daysToRespond).toBe(2);
  });

  /**
   * With no `settlementId` the money never left us, so there is nothing to
   * recover from the vendor and the platform simply absorbs it. That is the
   * first thing an admin needs before deciding who bears a loss.
   */
  it("says the vendor was never paid when the payment has no settlement", async () => {
    await open(await payment({ brandId: OURS, settled: false }), "disp_unpaid");

    const page = await getDisputes(admin(), {});

    expect(page.data[0].vendorWasPaid).toBe(false);
  });

  it("flags a deadline that has already passed", async () => {
    await open(await payment({ brandId: OURS }), "disp_late", {
      respond_by: secondsFromNow(-10),
    });

    const page = await getDisputes(admin(), {});

    expect(page.data[0]).toMatchObject({ isOverdue: true, isUrgent: false });
  });
});

/**
 * ⚠️ Sorted **before** the projection, on the real field.
 *
 * The sort used to sit after `$project` and key on `disputeRespondBy` — a name
 * that only exists in the admin shape. So a vendor's list came back in whatever
 * order the collection happened to give it, silently and with nothing to see.
 */
describe("ordering", () => {
  beforeEach(async () => {
    const txn = await payment({ brandId: OURS });
    await open(txn, "disp_far", { respond_by: secondsFromNow(500) });
    await open(txn, "disp_soon", { respond_by: secondsFromNow(6) });
    await open(txn, "disp_mid", { respond_by: secondsFromNow(100) });
  });

  it("puts the soonest deadline first for an admin", async () => {
    const page = await getDisputes(admin(), {});
    expect(page.data.map((d) => d.disputeId)).toEqual([
      "disp_soon",
      "disp_mid",
      "disp_far",
    ]);
  });

  it("orders a vendor's list by the same field it cannot see", async () => {
    const page = await getDisputes(vendor(), {});
    expect(page.data.map((d) => d.disputeId)).toEqual([
      "disp_soon",
      "disp_mid",
      "disp_far",
    ]);
  });

  it("defaults to the disputes still worth answering", async () => {
    await Dispute.updateOne(
      { disputeId: "disp_mid" },
      { $set: { status: DISPUTE_STATUS.WON } },
    );

    const openOnes = await getDisputes(admin(), {});
    const resolved = await getDisputes(admin(), { resolved: "true" });

    expect(openOnes.data.map((d) => d.disputeId)).toEqual([
      "disp_soon",
      "disp_far",
    ]);
    expect(resolved.data.map((d) => d.disputeId)).toEqual(["disp_mid"]);
  });
});

/**
 * ⚠️ The detail read shares the list's projections rather than declaring its own.
 *
 * A detail endpoint that spelled its projection out again is the ordinary way a
 * field the list carefully hides ends up on a screen it was kept off — months
 * later, with nothing failing and nobody looking. These assert the two stay the
 * same shape.
 */
describe("one dispute on its own", () => {
  beforeEach(async () => {
    const txn = await payment({ brandId: OURS });
    await open(txn, "disp_one");
  });

  it("gives a vendor their own dispute", async () => {
    const row = await getDispute(vendor(), "disp_one");

    expect(row).toMatchObject({
      disputeId: "disp_one",
      disputeStatus: DISPUTE_STATUS.OPEN,
      disputeAmount: 810,
    });
  });

  /** The same queue fields the list keeps back — from the same projection. */
  it.each([
    "disputeRespondBy",
    "daysToRespond",
    "isOverdue",
    "alertsSent",
    "vendorWasPaid",
    "recoverySettlementId",
  ])("still keeps %s off the vendor's detail", async (field) => {
    const row = await getDispute(vendor(), "disp_one");
    expect(row).not.toHaveProperty(field);
  });

  it("gives an admin the deadline and the recovery state", async () => {
    const row = await getDispute(admin(), "disp_one");

    expect(row).toMatchObject({
      disputeId: "disp_one",
      disputeReason: "fraud",
      vendorWasPaid: true,
      alertsSent: 0,
    });
    expect(row.disputeRespondBy).toBeInstanceOf(Date);
  });

  /**
   * ⚠️ Razorpay's `disp_…` is what an admin reads off the dashboard and what
   * every alert carries; our `_id` is what a panel holds after a list call.
   * Refusing either would reject the id somebody actually has in front of them.
   */
  it("is addressable by our own id as well as the gateway's", async () => {
    const stored = await Dispute.findOne({ disputeId: "disp_one" }).lean();

    const row = await getDispute(admin(), String(stored._id));

    expect(row.disputeId).toBe("disp_one");
  });

  /** Another brand's dispute answers exactly as one that does not exist. */
  it("answers another brand's dispute the same as a missing one", async () => {
    const theirs = await payment({ brandId: THEIRS });
    await open(theirs, "disp_theirs");

    await expect(
      getDispute(vendor(), "disp_theirs"),
    ).rejects.toMatchObject({ statusCode: 404, message: "Dispute not found." });

    await expect(
      getDispute(vendor(), "disp_nothing"),
    ).rejects.toMatchObject({ statusCode: 404, message: "Dispute not found." });
  });

  it("refuses a customer, the same as the list does", async () => {
    await expect(
      getDispute({ role: ROLES.CUSTOMER, customerId: oid() }, "disp_one"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("the outlet adding what only they have", () => {
  let txn;

  beforeEach(async () => {
    txn = await payment({ brandId: OURS });
    await open(txn, "disp_note");
  });

  it("accepts a note and tells them it landed", async () => {
    const result = await addVendorDisputeEvidence(vendor(), "disp_note", {
      note: "KOT 4471, table 9, served 8:42pm. Camera footage kept.",
    });

    expect(result.vendorEvidenceNote).toContain("KOT 4471");
    expect(result.vendorEvidenceAt).toBeInstanceOf(Date);
    expect(result.message).toMatch(/thank you/i);

    const stored = await Dispute.findOne({ disputeId: "disp_note" }).lean();
    expect(stored.vendorEvidenceNote).toContain("KOT 4471");
  });

  /** So they can see it landed, without being handed our queue. */
  it("shows the note back to them in their own list", async () => {
    await addVendorDisputeEvidence(vendor(), "disp_note", {
      note: "Bill 88213, paid by card at the counter.",
    });

    const page = await getDisputes(vendor(), {});

    expect(page.data[0].vendorEvidenceNote).toContain("Bill 88213");
    expect(page.data[0].vendorEvidenceAt).toBeInstanceOf(Date);
  });

  /**
   * ⚠️ 404, not 403.
   *
   * Telling somebody a dispute exists but belongs to another brand confirms the
   * id is real — a slow way of mapping other people's chargebacks.
   */
  it("answers another brand's dispute the same as one that does not exist", async () => {
    const theirs = await payment({ brandId: THEIRS });
    await open(theirs, "disp_theirs");

    await expect(
      addVendorDisputeEvidence(vendor(), "disp_theirs", {
        note: "we served this one",
      }),
    ).rejects.toMatchObject({ statusCode: 404, message: "Dispute not found." });

    await expect(
      addVendorDisputeEvidence(vendor(), "disp_nope", {
        note: "we served this one",
      }),
    ).rejects.toMatchObject({ statusCode: 404, message: "Dispute not found." });
  });

  /**
   * Once the bank has decided, a note changes nothing — and accepting it would
   * imply otherwise. The refusal says which way it went, so nobody is left
   * guessing why their message bounced.
   */
  it("refuses once the dispute is decided, and says which way", async () => {
    await Dispute.updateOne(
      { disputeId: "disp_note" },
      { $set: { status: DISPUTE_STATUS.WON } },
    );

    await expect(
      addVendorDisputeEvidence(vendor(), "disp_note", { note: "some detail" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/in your favour/i),
    });
  });

  it("refuses an empty note rather than wiping a real one", async () => {
    await expect(
      addVendorDisputeEvidence(vendor(), "disp_note", { note: "  " }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("is not open to an admin or a customer", async () => {
    await expect(
      addVendorDisputeEvidence(admin(), "disp_note", { note: "on their behalf" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      addVendorDisputeEvidence(
        { role: ROLES.CUSTOMER, customerId: oid() },
        "disp_note",
        { note: "I was there" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets a sub-vendor of the same brand add one", async () => {
    const result = await addVendorDisputeEvidence(
      { role: ROLES.SUB_VENDOR, brandId: OURS, userId: oid() },
      "disp_note",
      { note: "Counter staff remember the table." },
    );

    expect(result.disputeId).toBe("disp_note");
  });
});

describe("the evidence pack", () => {
  let txn;
  let customerId;

  beforeEach(async () => {
    customerId = oid();
    await Customer.create({
      _id: customerId,
      userId: oid(),
      email: "reallylongname@example.com",
      mobile: "9876543210",
      uniqueId: `TDC${String(customerId).slice(-8)}`,
    });
    txn = await payment({ brandId: OURS, customerId });
    await open(txn, "disp_pack");
  });

  it("is admin only", async () => {
    await expect(
      getDisputeEvidencePack(vendor(), "disp_pack"),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("masks the customer's contact — it is uploaded to a third party", async () => {
    const pack = await getDisputeEvidencePack(admin(), "disp_pack");

    expect(pack.customer.mobile).toBe("******3210");
    expect(pack.customer.mobile).not.toContain("98765");
    expect(pack.customer.email).toBe("re************@example.com");
    expect(JSON.stringify(pack)).not.toContain("9876543210");
    expect(JSON.stringify(pack)).not.toContain("reallylongname@");
  });

  /**
   * ⚠️ The argument, written out.
   *
   * A dispute is filed **once**, against the bank's deadline, and the difference
   * between winning and losing is usually whether anybody had time to write the
   * case down properly.
   */
  it("writes the argument out ready to paste", async () => {
    const pack = await getDisputeEvidencePack(admin(), "disp_pack");

    expect(pack.narrative).toContain(txn.razorpayPaymentId);
    expect(pack.narrative).toMatch(/valid Razorpay signature/i);
    expect(pack.payment.signatureVerified).toBe(true);
  });

  it("carries the outlet's note when they sent one", async () => {
    await addVendorDisputeEvidence(vendor(), "disp_pack", {
      note: "KOT 4471, table 9.",
    });

    const pack = await getDisputeEvidencePack(admin(), "disp_pack");

    expect(pack.vendorNotes.note).toContain("KOT 4471");
    expect(pack.narrative).toContain("From the outlet: KOT 4471");
  });

  it("stands on its own when the outlet never replied", async () => {
    const pack = await getDisputeEvidencePack(admin(), "disp_pack");

    expect(pack.vendorNotes).toBeNull();
    expect(pack.narrative.length).toBeGreaterThan(80);
  });

  it("is addressable by our own id as well as the gateway's", async () => {
    const row = await Dispute.findOne({ disputeId: "disp_pack" }).lean();

    const pack = await getDisputeEvidencePack(admin(), String(row._id));

    expect(pack.dispute.disputeId).toBe("disp_pack");
  });

  /**
   * A dispute whose payment we cannot find is a data problem, not an evidence
   * problem — and saying so beats handing an admin an empty pack minutes before
   * a deadline.
   */
  it("says so when the payment behind it is missing", async () => {
    await Dispute.updateOne(
      { disputeId: "disp_pack" },
      { $set: { transactionId: oid() } },
    );

    await expect(
      getDisputeEvidencePack(admin(), "disp_pack"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("404s on an id nobody holds", async () => {
    await expect(
      getDisputeEvidencePack(admin(), "disp_nothing"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * ⚠️ Two mounts, one implementation.
 *
 * `/disputes` is the canonical home; `/transactions/disputes*` stays because the
 * Postman collections and anything already integrated point at it — a 404 is a
 * worse answer than a duplicate line in a route table.
 *
 * That is only safe while the two are literally the same handlers. The moment
 * somebody "fixes" one of them — tightens a gate, swaps a validator, points at a
 * new controller — the other keeps serving the old behaviour, and the one that
 * gets audited is rarely the one an integration is actually calling. This is the
 * test that refuses to let that happen quietly.
 */
describe("the dispute routes", () => {
  const disputesRouter = require("../../routes/disputes");
  const transactionsRouter = require("../../routes/transactions");

  const routesOf = (router) =>
    router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        method: Object.keys(layer.route.methods)[0].toUpperCase(),
        handlers: layer.route.stack.map((h) => h.handle),
      }));

  /** `/transactions/disputes/x` and `/disputes/x` are the same route. */
  const canonicalPath = (path) =>
    path.replace(/^\/disputes\/?/, "/").replace(/\/$/, "") || "/";

  const legacy = () =>
    routesOf(transactionsRouter).filter((r) => r.path.startsWith("/disputes"));

  it("mounts the worklist, the detail, the evidence note and the pack", () => {
    const paths = routesOf(disputesRouter).map((r) => `${r.method} ${r.path}`);

    expect(paths).toEqual(
      expect.arrayContaining([
        "GET /",
        "GET /:disputeId",
        "POST /:disputeId/evidence",
        "GET /:disputeId/evidence-pack",
      ]),
    );
  });

  it("serves the legacy paths from exactly the same handlers", () => {
    const canonical = routesOf(disputesRouter);
    const old = legacy();

    // The three that were there before the domain existed.
    expect(old).toHaveLength(3);

    for (const route of old) {
      const match = canonical.find(
        (r) =>
          r.method === route.method &&
          canonicalPath(r.path) === canonicalPath(route.path),
      );

      expect(match).toBeDefined();
      expect(match.handlers).toHaveLength(route.handlers.length);

      /**
       * ⚠️ The **gate** and the **controller**, by identity.
       *
       * Not the whole stack: `validateSchema(schema)` builds a fresh closure on
       * every call, so the two mounts genuinely hold different function objects
       * for that layer and always will. Comparing the array with `toEqual` is
       * worse than useless — it compares functions structurally and passes for
       * *any* two anonymous ones ("serializes to the same string"), so it would
       * go green for two different gates.
       *
       * What has to be identical is what actually decides things: who is let in,
       * and what runs. Both are real exported functions, so `toBe` means what it
       * says.
       */
      expect(match.handlers[0]).toBe(route.handlers[0]);
      expect(match.handlers[match.handlers.length - 1]).toBe(
        route.handlers[route.handlers.length - 1],
      );
    }
  });

  /**
   * ⚠️ The detail read is the proof that new work goes to the new home. If it
   * ever appears on the legacy mount, the compatibility surface has started
   * growing into a second surface to maintain.
   */
  it("keeps new dispute routes off the legacy mount", () => {
    const oldPaths = legacy().map((r) => `${r.method} ${canonicalPath(r.path)}`);

    expect(oldPaths).not.toContain("GET /:disputeId");
  });

  /**
   * ⚠️ Neither router has a blanket `router.use(verifyJwtToken)` — the public
   * invoice link on the transactions router is why, and consistency between the
   * two files is why this one has none either. So every dispute route has to
   * carry its own gate, and a missing one is a public chargeback worklist.
   */
  it("puts a gate on every route, on both mounts", () => {
    const { verifyJwtToken, isAdmin, isVendorOrSubVendor } = require("../../middlewares");
    const gates = [verifyJwtToken, isAdmin, isVendorOrSubVendor];

    for (const route of [...routesOf(disputesRouter), ...legacy()]) {
      expect(
        route.handlers.some((h) => gates.includes(h)),
      ).toBe(true);
    }
  });
});
