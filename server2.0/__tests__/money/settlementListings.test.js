const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const {
  getSettlements,
  getSettlementDetail,
  getSettlementTransactions,
} = require("../../services/settlements");
const {
  buildSettlementListFilter,
  settlementProjection,
  presentSettlement,
  scopeFor,
} = require("../../helpers/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let OTHER_BRAND;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = () => ({ role: ROLES.VENDOR, brandId: BRAND, userId: oid() });
const subVendor = () => ({
  role: ROLES.SUB_VENDOR,
  brandId: BRAND,
  subBrandId: oid(),
  userId: oid(),
});
const customer = () => ({ role: ROLES.CUSTOMER, customerId: oid() });

const BANK = {
  accountHolderName: "Cafe Mocha",
  maskedAccountNumber: "XXXXXX7890",
  accountLast4Digits: "7890",
  ifscCode: "HDFC0001234",
  bankName: "HDFC Bank",
  bankId: oid(),
  verifiedAt: new Date(),
};

let seq = 0;
const settlement = (overrides = {}) => {
  seq += 1;
  return Settlement.create({
    brandId: BRAND,
    periodStart: ago(6 * DAY),
    periodEnd: ago(DAY),
    idempotencyKey: `STL:${BRAND}:${seq}:${Math.random()}`,
    settlementNumber: `STL-2026-${String(seq).padStart(5, "0")}`,
    status: SETTLEMENT_STATUS.PENDING_APPROVAL,
    bankSnapshot: BANK,
    grossCollected: 1000,
    commissionAmount: 150,
    commissionTax: 27,
    netPayable: 823,
    transactionCount: 1,
    ...overrides,
  });
};

const payment = (overrides = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(5 * DAY),
    fundsReceivedAt: ago(2 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    gatewayFee: 19.13,
    netReceived: 790.87,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: {
      claimId: oid(),
      billAmount: 1000,
      netBill: 800,
      vendorPayable: 800,
      vendorPromoCost: 50,
      platformPromoCost: 30,
    },
    ...overrides,
  });

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, Settlement, SettlementHistory, PayoutLeg]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, Settlement, SettlementHistory, PayoutLeg);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, Settlement, SettlementHistory, PayoutLeg);
  BRAND = oid();
  OTHER_BRAND = oid();
});

describe("who may read a settlement at all", () => {
  it("gives an admin every brand", async () => {
    await settlement();
    await settlement({ brandId: OTHER_BRAND });

    const result = await getSettlements(admin(), {});

    expect(result.data).toHaveLength(2);
  });

  it("gives a vendor only their own brand", async () => {
    await settlement();
    await settlement({ brandId: OTHER_BRAND });

    const result = await getSettlements(vendor(), {});

    expect(result.data).toHaveLength(1);
    expect(String(result.data[0].brandId)).toBe(String(BRAND));
  });

  /**
   * A sub-vendor works one counter, but a settlement is the whole brand's cycle.
   * Narrowing them by outlet would show a figure that adds up to nothing they
   * can see — so they read the brand's settlement, same as the owner.
   */
  it("shows a sub-vendor the whole brand, not their outlet", async () => {
    await settlement();

    const result = await getSettlements(subVendor(), {});

    expect(result.data).toHaveLength(1);
  });

  it("refuses a customer outright", async () => {
    await expect(getSettlements(customer(), {})).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("refuses a vendor with no brand linked", () => {
    expect(() => scopeFor({ role: ROLES.VENDOR })).toThrow();
  });
});

describe("the scope and the filters are intersected, never overlaid", () => {
  /**
   * The bug this pins: a vendor asking for another brand used to get their own
   * rows back, which reads as "that brand's settlements" and is how somebody
   * builds a reconciliation on a filter that never applied.
   */
  it("returns nothing when a vendor asks for another brand", async () => {
    await settlement();
    await settlement({ brandId: OTHER_BRAND });

    const result = await getSettlements(vendor(), {
      brandId: String(OTHER_BRAND),
    });

    expect(result.data).toHaveLength(0);
  });

  it("still honours a vendor filtering to their own brand", async () => {
    await settlement();

    const result = await getSettlements(vendor(), { brandId: String(BRAND) });

    expect(result.data).toHaveLength(1);
  });

  it("lets an admin filter to any brand", async () => {
    await settlement();
    await settlement({ brandId: OTHER_BRAND });

    const result = await getSettlements(admin(), {
      brandId: String(OTHER_BRAND),
    });

    expect(result.data).toHaveLength(1);
    expect(String(result.data[0].brandId)).toBe(String(OTHER_BRAND));
  });

  it("keeps the scope key even with no brand filter asked for", () => {
    const filter = buildSettlementListFilter(vendor(), { status: "PAID" });

    expect(String(filter.brandId)).toBe(String(BRAND));
    expect(filter.status).toBe("PAID");
    expect(filter.isDeleted).toBe(false);
  });
});

describe("an empty list is an answer, not a fault", () => {
  /**
   * A brand in its first week has no settlements. `pagination` 404s on an empty
   * result by default, which would render as "something went wrong" on a screen
   * whose correct content is "nothing yet".
   */
  it("returns an empty page rather than a 404", async () => {
    const result = await getSettlements(vendor(), {});

    expect(result.data).toEqual([]);
  });
});

describe("what each audience is shown", () => {
  it("never gives a vendor the full bank account", async () => {
    await settlement();

    const row = (await getSettlements(vendor(), {})).data[0];

    expect(row.bankSnapshot.accountLast4Digits).toBe("7890");
    expect(row.bankSnapshot.bankName).toBe("HDFC Bank");
    expect(row.bankSnapshot.maskedAccountNumber).toBeUndefined();
    expect(row.bankSnapshot.ifscCode).toBeUndefined();
    expect(row.bankSnapshot.accountHolderName).toBeUndefined();
  });

  it("gives an admin the whole snapshot", async () => {
    await settlement();

    const result = await getSettlements(admin(), {});

    expect(result.data[0].bankSnapshot.ifscCode).toBe("HDFC0001234");
  });

  /**
   * `needsRevalidation` names payments under dispute before anyone has decided.
   * A vendor told "three of yours are being revalidated" will ask which, and the
   * answer is usually a chargeback we have not resolved.
   */
  it("hides the internal review state from a vendor", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.ON_HOLD,
      needsRevalidation: true,
      taintedTransactionIds: [oid()],
      failureNote: "bank says the IFSC is retired",
    });

    const row = (await getSettlements(vendor(), {})).data[0];

    expect(row.needsRevalidation).toBeUndefined();
    expect(row.taintedTransactionIds).toBeUndefined();
    expect(row.failureNote).toBeUndefined();
    expect(row.idempotencyKey).toBeUndefined();
    // What they do get is an honest status.
    expect(row.status).toBe(SETTLEMENT_STATUS.ON_HOLD);
    expect(row.statusLabel).toBe("On hold — being checked");
  });

  it("shows an admin the raw status, not the vendor wording", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    const row = (await getSettlements(admin(), {})).data[0];

    expect(row.statusLabel).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
  });

  /**
   * From the vendor's side there is nothing "pending" about it — the money is on
   * its way and nobody has asked them for anything.
   */
  it("does not tell a vendor their payout is pending approval", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    const row = (await getSettlements(vendor(), {})).data[0];

    expect(row.statusLabel).toBe("Being prepared");
  });

  it("has a plain-language label for every settlement status", () => {
    for (const status of Object.values(SETTLEMENT_STATUS)) {
      const label = presentSettlement({ status }, ROLES.VENDOR).statusLabel;
      expect(typeof label).toBe("string");
      // Falling through to the raw enum means somebody added a state and
      // forgot the wording — the vendor then reads "CARRIED_FORWARD".
      expect(label).not.toBe(status);
    }
  });

  it("names no path and its parent in one projection", () => {
    for (const role of [ROLES.ADMIN, ROLES.VENDOR, ROLES.SUB_VENDOR]) {
      const keys = Object.keys(settlementProjection(role));
      for (const key of keys) {
        const parent = key.split(".")[0];
        if (parent === key) continue;
        expect(keys).not.toContain(parent);
      }
    }
  });
});

describe("what a panel is allowed to offer", () => {
  it("states the actions rather than making the panel infer them", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    const row = (await getSettlements(admin(), {})).data[0];

    expect(row.canApprove).toBe(true);
    expect(row.canPay).toBe(false);
    expect(row.canRetry).toBe(false);
  });

  it("withholds approve while the settlement is flagged", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.PENDING_APPROVAL,
      needsRevalidation: true,
    });

    const row = (await getSettlements(admin(), {})).data[0];

    expect(row.canApprove).toBe(false);
  });

  it("offers a vendor nothing at all", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    const row = (await getSettlements(vendor(), {})).data[0];

    expect(row.canApprove).toBe(false);
    expect(row.canPay).toBe(false);
    expect(row.canRetry).toBe(false);
  });
});

describe("the worklists", () => {
  it("?open=true keeps only what is still moving", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
    await settlement({ status: SETTLEMENT_STATUS.PAID });

    const result = await getSettlements(admin(), { open: "true" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
  });

  it("?needsAttention=true picks up flagged, failed and held", async () => {
    await settlement({ status: SETTLEMENT_STATUS.PAID });
    await settlement({ status: SETTLEMENT_STATUS.FAILED });
    await settlement({ status: SETTLEMENT_STATUS.ON_HOLD });
    await settlement({
      status: SETTLEMENT_STATUS.PENDING_APPROVAL,
      needsRevalidation: true,
    });

    const result = await getSettlements(admin(), { needsAttention: "true" });

    expect(result.data).toHaveLength(3);
    expect(result.data.map((r) => r.status)).not.toContain(
      SETTLEMENT_STATUS.PAID,
    );
  });

  /**
   * A worklist answers "what has been waiting longest", so it sorts the other
   * way from the vendor's list, which answers "did last week's money arrive".
   */
  it("sorts the worklist oldest first and the list newest first", async () => {
    const old = await settlement({
      status: SETTLEMENT_STATUS.ON_HOLD,
      createdAt: ago(10 * DAY),
      periodEnd: ago(10 * DAY),
    });
    const recent = await settlement({
      status: SETTLEMENT_STATUS.ON_HOLD,
      createdAt: ago(DAY),
      periodEnd: ago(DAY),
    });

    const worklist = await getSettlements(admin(), { needsAttention: "true" });
    expect(String(worklist.data[0]._id)).toBe(String(old._id));

    const listing = await getSettlements(admin(), {});
    expect(String(listing.data[0]._id)).toBe(String(recent._id));
  });

  it("a date range is inclusive of the whole end day", async () => {
    const endOfDay = new Date();
    endOfDay.setHours(18, 30, 0, 0);
    await settlement({ periodEnd: endOfDay });

    const day = `${endOfDay.getFullYear()}-${String(endOfDay.getMonth() + 1).padStart(2, "0")}-${String(endOfDay.getDate()).padStart(2, "0")}`;
    const result = await getSettlements(admin(), { from: day, to: day });

    expect(result.data).toHaveLength(1);
  });
});

describe("one settlement, in full", () => {
  it("returns the legs that paid it, in order", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    for (const legNumber of [1, 2]) {
      await PayoutLeg.create({
        payoutType: PAYOUT_TYPE.SETTLEMENT,
        settlementId: s._id,
        brandId: BRAND,
        legNumber,
        amount: 411.5,
        status: PAYOUT_LEG_STATUS.PAID,
        utr: `UTR${legNumber}`,
        paidAt: new Date(),
      });
    }

    const result = await getSettlementDetail(admin(), s._id);

    expect(result.legs).toHaveLength(2);
    expect(result.legs.map((l) => l.legNumber)).toEqual([1, 2]);
    // The UTR is the one field a vendor quotes back when money has not landed.
    expect(result.legs[0].utr).toBe("UTR1");
  });

  it("returns the timeline forwards", async () => {
    const s = await settlement();
    await SettlementHistory.create({
      settlementId: s._id,
      brandId: BRAND,
      fromStatus: SETTLEMENT_STATUS.DRAFT,
      toStatus: SETTLEMENT_STATUS.PENDING_APPROVAL,
      performedByRole: ROLES.ADMIN,
      reason: "built",
      createdAt: ago(2 * DAY),
    });
    await SettlementHistory.create({
      settlementId: s._id,
      brandId: BRAND,
      fromStatus: SETTLEMENT_STATUS.PENDING_APPROVAL,
      toStatus: SETTLEMENT_STATUS.APPROVED,
      performedByRole: ROLES.ADMIN,
      reason: "signed off",
      createdAt: ago(DAY),
    });

    const result = await getSettlementDetail(admin(), s._id);

    expect(result.timeline.map((t) => t.toStatus)).toEqual([
      SETTLEMENT_STATUS.PENDING_APPROVAL,
      SETTLEMENT_STATUS.APPROVED,
    ]);
  });

  /**
   * `reason` on a history row is written by staff for staff — "3 claimed
   * payments are no longer eligible" names a dispute nobody has decided.
   */
  it("keeps the staff note out of the vendor's timeline", async () => {
    const s = await settlement();
    await SettlementHistory.create({
      settlementId: s._id,
      brandId: BRAND,
      fromStatus: SETTLEMENT_STATUS.PENDING_APPROVAL,
      toStatus: SETTLEMENT_STATUS.ON_HOLD,
      performedByRole: ROLES.ADMIN,
      performedBy: oid(),
      reason: "3 claimed payments are no longer eligible",
    });

    const asVendor = await getSettlementDetail(vendor(), s._id);
    const asAdmin = await getSettlementDetail(admin(), s._id);

    expect(asVendor.timeline[0].reason).toBeUndefined();
    expect(asVendor.timeline[0].performedBy).toBeUndefined();
    expect(asVendor.timeline[0].toStatus).toBe(SETTLEMENT_STATUS.ON_HOLD);
    expect(asAdmin.timeline[0].reason).toBe(
      "3 claimed payments are no longer eligible",
    );
  });

  /**
   * The row is read whole, checked, and only then narrowed — a whitelist, so a
   * field added to the model tomorrow is hidden until somebody names it.
   */
  it("narrows the detail through the same whitelist as the listing", async () => {
    const s = await settlement({ needsRevalidation: true });

    const result = await getSettlementDetail(vendor(), s._id);

    expect(result.settlement.idempotencyKey).toBeUndefined();
    expect(result.settlement.needsRevalidation).toBeUndefined();
    expect(result.settlement.bankSnapshot.ifscCode).toBeUndefined();
    expect(result.settlement.bankSnapshot.accountLast4Digits).toBe("7890");
  });

  it("hides a field the model grows until the projection names it", async () => {
    const s = await settlement();
    await Settlement.collection.updateOne(
      { _id: s._id },
      { $set: { internalMemo: "do not pay, legal hold" } },
    );

    const result = await getSettlementDetail(vendor(), s._id);

    expect(result.settlement.internalMemo).toBeUndefined();
  });

  it("refuses another brand's settlement", async () => {
    const s = await settlement({ brandId: OTHER_BRAND });

    await expect(getSettlementDetail(vendor(), s._id)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("404s on a settlement that is not there", async () => {
    await expect(getSettlementDetail(admin(), oid())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("404s on a soft-deleted settlement rather than serving it", async () => {
    const s = await settlement({ isDeleted: true });

    await expect(getSettlementDetail(admin(), s._id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("the statement lines", () => {
  it("returns the payments this settlement claimed", async () => {
    const s = await settlement();
    await payment({ settlementId: s._id });
    await payment({ settlementId: s._id });
    // Somebody else's row, claimed by nothing.
    await payment();

    const result = await getSettlementTransactions(admin(), s._id, {});

    expect(result.data).toHaveLength(2);
  });

  /**
   * Our margin sits on the same sub-document as the figure the vendor genuinely
   * needs. `vendorPayable` is theirs; `platformPromoCost`, the MDR we swallow and
   * what actually landed in our account are not.
   */
  it("keeps our margin off the vendor's statement", async () => {
    const s = await settlement();
    await payment({ settlementId: s._id });

    const row = (await getSettlementTransactions(vendor(), s._id, {})).data[0];

    expect(row.voucher.vendorPayable).toBe(800);
    expect(row.voucher.vendorPromoCost).toBe(50);
    expect(row.voucher.platformPromoCost).toBeUndefined();
    expect(row.gatewayFee).toBeUndefined();
    expect(row.netReceived).toBeUndefined();
  });

  it("gives an admin the whole line", async () => {
    const s = await settlement();
    await payment({ settlementId: s._id });

    const row = (await getSettlementTransactions(admin(), s._id, {})).data[0];

    expect(row.voucher.platformPromoCost).toBe(30);
    expect(row.gatewayFee).toBe(19.13);
  });

  it("refuses another brand's statement", async () => {
    const s = await settlement({ brandId: OTHER_BRAND });

    await expect(
      getSettlementTransactions(vendor(), s._id, {}),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns an empty page for a settlement that claimed nothing", async () => {
    const s = await settlement();

    const result = await getSettlementTransactions(admin(), s._id, {});

    expect(result.data).toEqual([]);
  });
});

/**
 * The wiring itself.
 *
 * Nothing else in this suite would notice an admin route that lost its
 * `isAdmin`, or a validator that quietly stopped being applied — the services
 * would keep passing, because every one of these checks lives in the route file
 * and none of it is reachable from a service test.
 *
 * Compared by **identity**, not by name: every layer in an Express stack is
 * anonymous, so `handle.name` is `""` for the guard and for the controller
 * alike.
 */
describe("the routes", () => {
  const router = require("../../routes/settlements");
  const { isAdmin, verifyJwtToken } = require("../../middlewares");

  const routes = () =>
    router.stack.map((layer) => ({
      path: layer.route.path,
      method: Object.keys(layer.route.methods)[0].toUpperCase(),
      handlers: layer.route.stack.map((h) => h.handle),
    }));

  const find = (method, path) =>
    routes().find((r) => r.method === method && r.path === path);

  it("mounts every settlement endpoint", () => {
    const expected = [
      ["GET", "/"],
      ["GET", "/:settlementId"],
      ["GET", "/:settlementId/transactions"],
      ["PATCH", "/admin/:settlementId/approve"],
      ["PATCH", "/admin/:settlementId/rebuild"],
      ["PATCH", "/admin/:settlementId/hold"],
      ["PATCH", "/admin/:settlementId/cancel"],
      // The exit for a payout that will never work. `FAILED -> ABANDONED` is
      // the only way a failed settlement releases its rows, and nothing called
      // it until this endpoint existed.
      ["PATCH", "/admin/:settlementId/abandon"],
      ["PATCH", "/admin/:settlementId/pay"],
      ["PATCH", "/admin/:settlementId/confirm"],
      ["PATCH", "/admin/:settlementId/fail"],
      ["PATCH", "/admin/:settlementId/retry"],
      ["PATCH", "/admin/:settlementId/reverse"],
    ];

    for (const [method, path] of expected) {
      expect(find(method, path)).toBeDefined();
    }
    expect(routes()).toHaveLength(expected.length);
  });

  /**
   * ⚠️ Every write. There is no vendor-facing write on a settlement at all — it
   * is our record of what we owe them, not a document they fill in — so an
   * `isAdmin` missing here is money moving on somebody else's say-so.
   */
  it("puts isAdmin on every write", () => {
    const writes = routes().filter((r) => r.method !== "GET");

    expect(writes).toHaveLength(10);
    for (const route of writes) {
      expect(route.handlers).toContain(isAdmin);
    }
  });

  /**
   * A role gate on the reads would mean two endpoints and two chances for one of
   * them to leak `bankSnapshot` or the commission we take. The scope and the
   * projection are derived from the token inside instead — and a CUSTOMER is
   * refused there, by `scopeFor`.
   */
  it("gates the reads on the token, not on a role", () => {
    const reads = routes().filter((r) => r.method === "GET");

    expect(reads).toHaveLength(3);
    for (const route of reads) {
      expect(route.handlers).toContain(verifyJwtToken);
      expect(route.handlers).not.toContain(isAdmin);
    }
  });

  it("validates every route", () => {
    for (const route of routes()) {
      // auth guard + validateSchema + controller.
      expect(route.handlers).toHaveLength(3);
    }
  });

  /**
   * `/admin/:settlementId/...` is three segments and `/:settlementId` is one, so
   * they cannot collide today. They would the moment somebody adds
   * `/:settlementId/approve`, and declaration order is what would decide it —
   * cheaper to pin the order than to rediscover why.
   */
  it("declares the literal admin routes above the parameterised reads", () => {
    const paths = routes().map((r) => r.path);
    const lastAdmin = paths.map((p) => p.startsWith("/admin/")).lastIndexOf(true);
    const firstRead = paths.indexOf("/");

    expect(lastAdmin).toBeLessThan(firstRead);
  });
});
