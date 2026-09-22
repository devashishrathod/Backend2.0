const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const Customer = require("../../models/Customer");
const VoucherVersion = require("../../models/VoucherVersion");
const {
  getClaimTransactions,
  getClaims,
} = require("../../services/voucherClaims");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;

let CUSTOMER_A;
let CUSTOMER_B;
let BRAND_A;
let BRAND_B;
let OUTLET_1;
let OUTLET_2;
let VERSION;

/**
 * Real customers and a real voucher version, not `oid()` placeholders.
 *
 * The listings join both collections now, and a `$lookup` against an id that
 * matches nothing returns an empty array that `preserveNullAndEmptyArrays`
 * turns into an absent field — indistinguishable from a projection that never
 * named it. Seeding the documents is what makes "the vendor sees a name" a
 * different assertion from "the vendor sees nothing".
 */
let codeSeq = 90_000_000;

const seedCustomer = async ({ fullName, uniqueId }) =>
  Customer.create({
    userId: oid(),
    uniqueId,
    fullName,
    email: `${uniqueId.toLowerCase()}@example.com`,
    mobile: "9700000001",
    whatsappNumber: "9700000002",
  });

const seedVersion = async (brandId) => {
  const code = `VCH-${String(codeSeq++).padStart(8, "0")}-V1`;
  return VoucherVersion.create({
    voucherId: oid(),
    brandId,
    createdBy: oid(),
    categoryId: oid(),
    subCategoryId: oid(),
    name: "Test Voucher",
    versionNumber: 3,
    versionCode: code,
    startAt: new Date(Date.now() - DAY_MS),
    endAt: new Date(Date.now() + 90 * DAY_MS),
    images: [{ media: { url: "https://cdn.test/one.webp", kind: "IMAGE" }, sortOrder: 1 }],
    offers: [
      {
        title: "20% off",
        minBillAmount: 100,
        discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
        discountValue: 20,
        sortOrder: 1,
      },
    ],
  });
};

const PRICING = {
  billAmount: 1000,
  offerDiscount: 200,
  netBill: 800,
  convenienceFee: 10,
  promoDiscount: 0,
  vendorPromoCost: 0,
  platformPromoCost: 35,
  totalPayable: 810,
  amountInPaise: 81000,
  youSaved: 200,
  vendorPayable: 800,
  offerTitle: "20% off",
};

const seed = async ({ customerId, brandId, subBrandId, status = VOUCHER_CLAIM_STATUS.REDEEMED }) => {
  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId,
    brandId,
    subBrandId,
    amount: PRICING.totalPayable,
    verified: true,
    // The two fields a vendor must never see.
    gatewayFee: 17.94,
    netReceived: 792.06,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    email: "customer@example.com",
    contact: "9700000001",
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: {
      voucherVersionId: VERSION._id,
      versionNumber: VERSION.versionNumber,
      billAmount: PRICING.billAmount,
      offerDiscount: PRICING.offerDiscount,
      netBill: PRICING.netBill,
      convenienceFee: PRICING.convenienceFee,
      vendorPayable: PRICING.vendorPayable,
      platformPromoCost: PRICING.platformPromoCost,
      vendorPromoCost: 0,
    },
  });

  const claim = await VoucherClaim.create({
    customerId,
    voucherId: oid(),
    voucherVersionId: VERSION._id,
    versionNumber: VERSION.versionNumber,
    brandId,
    subBrandId,
    billAmount: PRICING.billAmount,
    pricing: PRICING,
    transactionId: transaction._id,
    status,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voucherSnapshot: { name: "Test Voucher" },
    brandSnapshot: { name: "test brand" },
    outletSnapshot: { storeId: "T-01" },
  });

  return { transaction, claim };
};

const customer = (id) => ({ role: ROLES.CUSTOMER, customerId: id });
const vendor = (brandId) => ({ role: ROLES.VENDOR, brandId });
const subVendor = (brandId, subBrandId) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ role: ROLES.ADMIN });

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim, Customer, VoucherVersion]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherClaim, Customer, VoucherVersion);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherClaim, Customer, VoucherVersion);
  BRAND_A = oid();
  BRAND_B = oid();
  OUTLET_1 = oid();
  OUTLET_2 = oid();

  const [a, b, version] = await Promise.all([
    seedCustomer({ fullName: "Asha Menon", uniqueId: "TDC000001" }),
    seedCustomer({ fullName: "Bhavesh Rao", uniqueId: "TDC000002" }),
    seedVersion(BRAND_A),
  ]);
  CUSTOMER_A = a._id;
  CUSTOMER_B = b._id;
  VERSION = version;

  // Customer A bought at brand A outlet 1, and at brand B.
  await seed({ customerId: CUSTOMER_A, brandId: BRAND_A, subBrandId: OUTLET_1 });
  await seed({ customerId: CUSTOMER_A, brandId: BRAND_B, subBrandId: oid() });
  // Customer B bought at brand A, outlet 2.
  await seed({ customerId: CUSTOMER_B, brandId: BRAND_A, subBrandId: OUTLET_2 });
});

describe("one endpoint, three shapes", () => {
  it("shows a customer only their own", async () => {
    const { data } = await getClaimTransactions(customer(CUSTOMER_A));
    expect(data).toHaveLength(2);
    expect(data.every((r) => String(r.customerId) === String(CUSTOMER_A))).toBe(true);
  });

  it("shows a vendor only what was taken at their brand", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    expect(data).toHaveLength(2);
    expect(data.every((r) => String(r.brandId) === String(BRAND_A))).toBe(true);
  });

  it("shows a sub-vendor only their own counter", async () => {
    const { data } = await getClaimTransactions(subVendor(BRAND_A, OUTLET_1));
    // Brand A took two payments; one was at this outlet.
    expect(data).toHaveLength(1);
    expect(String(data[0].subBrandId)).toBe(String(OUTLET_1));
  });

  it("shows an admin everything", async () => {
    const { data } = await getClaimTransactions(admin());
    expect(data).toHaveLength(3);
  });

  it("never returns a subscription payment", async () => {
    await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: BRAND_A,
      amount: 4999,
      verified: true,
    });

    // Scoped by purpose, so a mistyped filter cannot surface the other flow.
    const { data } = await getClaimTransactions(admin());
    expect(data).toHaveLength(3);
  });
});

describe("what each audience is allowed to read", () => {
  /**
   * A projection rather than a delete-after-fetch: a field that is never loaded
   * cannot be leaked by a later refactor that forgets to strip it, and it cannot
   * turn up in a log line either.
   */
  it("hides our margin from the vendor", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    const row = data[0];

    // What Razorpay charged us is a commercial disclosure.
    expect(row.gatewayFee).toBeUndefined();
    expect(row.netReceived).toBeUndefined();
    expect(row.voucher?.platformPromoCost).toBeUndefined();
  });

  it("hides the customer's details from the vendor", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    const row = data[0];

    expect(row.email).toBeUndefined();
    expect(row.contact).toBeUndefined();
    expect(row.customerId).toBeUndefined();
  });

  it("shows the vendor what they will be paid", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    expect(data[0].voucher.vendorPayable).toBe(800);
  });

  it("hides our margin from the customer as well", async () => {
    const { data } = await getClaimTransactions(customer(CUSTOMER_A));
    const row = data[0];

    // Their own money — but what Razorpay charged us is not part of what they
    // bought.
    expect(row.gatewayFee).toBeUndefined();
    expect(row.voucher?.platformPromoCost).toBeUndefined();
    // They do see the fee they were charged.
    expect(row.voucher.convenienceFee).toBe(10);
  });

  it("shows an admin the whole row", async () => {
    const { data } = await getClaimTransactions(admin());
    const row = data[0];

    expect(row.gatewayFee).toBe(17.94);
    expect(row.netReceived).toBe(792.06);
    expect(row.voucher.platformPromoCost).toBe(35);
    expect(row.email).toBe("customer@example.com");
  });
});

/**
 * ---------------- who paid, and which version they bought ----------------
 *
 * The brand side used to get neither. A vendor reconciling their counter had a
 * row with an amount, a timestamp and no way at all to say whose it was — the
 * customer projection omitted even `customerId`. `versionCode` was on nobody's,
 * because it is on neither document the listings read.
 */
describe("the customer block", () => {
  /**
   * 🔴 The line is at the phone number, not at contact in general.
   *
   * ⚠️ This assertion **moved once**. The brand side originally got name and
   * `uniqueId` and no contact at all; `email` was released to them afterwards,
   * deliberately, on the argument that a brand has business with the person who
   * just bought from them. `mobile` and `whatsappNumber` did not move and are
   * the part this test now exists to hold.
   *
   * ⚠️ Mutation note: widen `customerIdentityProjection` to return the admin
   * shape for every role and the first three assertions still pass — the vendor
   * does get a name and an email. Only the two `toBeUndefined`s fail, which is
   * why they are asserted individually rather than by counting keys.
   */
  it("gives the vendor a name, a unique id and an email — never a number", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    const row = data[0];

    expect(row.customer.fullName).toMatch(/^(Asha Menon|Bhavesh Rao)$/);
    expect(row.customer.uniqueId).toMatch(/^TDC00000[12]$/);
    expect(row.customer.email).toMatch(/^tdc00000[12]@example\.com$/);

    // A mailbox the buyer opens when they choose; a number that rings is not
    // the same disclosure, and it stays admin-only.
    expect(row.customer.mobile).toBeUndefined();
    expect(row.customer.whatsappNumber).toBeUndefined();
  });

  /** The raw ObjectId stays out — `uniqueId` is the handle, not this. */
  it("still keeps customerId out of the vendor's row", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    expect(data[0].customerId).toBeUndefined();
    expect(data[0].customer._id).toBeUndefined();
  });

  it("scopes a sub-vendor's block the same way as a vendor's", async () => {
    const { data } = await getClaimTransactions(subVendor(BRAND_A, OUTLET_1));
    expect(data[0].customer.uniqueId).toBe("TDC000001");
    expect(data[0].customer.email).toBe("tdc000001@example.com");
    expect(data[0].customer.mobile).toBeUndefined();
  });

  /**
   * 🔴 The admin's contact details come from the **customer record**.
   *
   * `claimProjection` has named `email` and `contact` on the transaction since
   * it was written, and nothing writes either one on a voucher-claim row —
   * only `createSubscribeOrder` fills them, on the other flow. The fixture sets
   * `transaction.email` by hand precisely so this assertion can tell the two
   * sources apart: if the block were reading the transaction it would say
   * `customer@example.com`.
   */
  it("gives an admin the contact details, from the customer and not the payment", async () => {
    const { data } = await getClaimTransactions(admin());
    const row = data.find((r) => r.customer.uniqueId === "TDC000001");

    expect(row.customer.fullName).toBe("Asha Menon");
    // One shape for every audience — the admin reads the ObjectId off the row.
    expect(row.customer._id).toBeUndefined();
    expect(row.customer.email).toBe("tdc000001@example.com");
    expect(row.customer.mobile).toBe("9700000001");
    expect(row.customer.whatsappNumber).toBe("9700000002");
  });

  /**
   * They are the person. Joining `customers` on every row of somebody's own
   * order history is a round trip that tells them their own name, so the lookup
   * is never added to their pipeline.
   */
  it("joins nothing at all for the customer reading their own history", async () => {
    const { data } = await getClaimTransactions(customer(CUSTOMER_A));
    expect(data[0].customer).toBeUndefined();
    // Their own id is still theirs to see.
    expect(String(data[0].customerId)).toBe(String(CUSTOMER_A));
  });

  it("carries the same block on the claim listing", async () => {
    const { data } = await getClaims(vendor(BRAND_A));

    expect(data[0].customer.fullName).toMatch(/^(Asha Menon|Bhavesh Rao)$/);
    expect(data[0].customer.email).toMatch(/^tdc00000[12]@example\.com$/);
    expect(data[0].customer.mobile).toBeUndefined();
    // ⚠️ The claim projection drops `customerId` for a vendor, so the join has
    // to run above the `$project` — below it there would be no key to join on
    // and this block would be silently empty.
    expect(data[0].customerId).toBeUndefined();
  });
});

describe("the voucher version block", () => {
  /**
   * ⚠️ `versionCode` is on neither document these listings read. The
   * transaction carries `voucher.voucherVersionId` and the claim carries
   * `voucherVersionId`; the code itself lives only on `VoucherVersion`.
   */
  it.each([
    ["vendor", () => vendor(BRAND_A)],
    ["admin", () => admin()],
    ["customer", () => customer(CUSTOMER_A)],
  ])("gives the %s the version code on a payment row", async (_label, who) => {
    const { data } = await getClaimTransactions(who());

    expect(data[0].voucherVersion.versionCode).toMatch(/^VCH-\d{8}-V1$/);
    expect(data[0].voucherVersion.versionNumber).toBe(3);
  });

  it.each([
    ["vendor", () => vendor(BRAND_A)],
    ["admin", () => admin()],
    ["customer", () => customer(CUSTOMER_A)],
  ])("gives the %s the version code on a claim row", async (_label, who) => {
    const { data } = await getClaims(who());

    expect(data[0].voucherVersion.versionCode).toMatch(/^VCH-\d{8}-V1$/);
    expect(data[0].voucherVersion.versionNumber).toBe(3);
  });

  /**
   * The brand-side and customer projections narrow `voucher` to four fields and
   * `versionNumber` is not one of them — so this block is the only place either
   * audience can see which version a sale was made from.
   */
  it("is the only place a vendor learns the version at all", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A));
    expect(data[0].voucher.versionNumber).toBeUndefined();
    expect(data[0].voucherVersion.versionNumber).toBe(3);
  });

  /**
   * A version can be archived, paused or deleted after it was sold, and the
   * payment row still has to say which one it was — so neither join filters
   * `isDeleted`.
   */
  it("still names a version that has since been deleted", async () => {
    await VoucherVersion.updateOne(
      { _id: VERSION._id },
      { $set: { isDeleted: true, isActive: false } },
    );

    const { data } = await getClaimTransactions(vendor(BRAND_A));
    expect(data[0].voucherVersion.versionCode).toMatch(/^VCH-\d{8}-V1$/);
  });
});

describe("the scope cannot be widened from the query string", () => {
  /**
   * A filter on a key the scope does not constrain simply **adds** to it. A
   * customer scoped by `customerId` may still filter by brand — they just get
   * their own rows at that brand, never everyone's.
   */
  it("narrows within the scope rather than escaping it", async () => {
    const { data } = await getClaimTransactions(customer(CUSTOMER_A), {
      brandId: String(BRAND_A),
    });
    // Narrowed to their own row at brand A — not to everything at brand A.
    expect(data).toHaveLength(1);
    expect(String(data[0].customerId)).toBe(String(CUSTOMER_A));
  });

  it("cannot be pointed at another customer", async () => {
    // `customerId` is not a filter this builder reads at all, so it is dropped
    // before the scope is applied rather than fought with.
    const { data } = await getClaimTransactions(customer(CUSTOMER_A), {
      customerId: String(CUSTOMER_B),
    });
    // Asserted non-empty first: `every` on an empty array is vacuously true, so
    // without this the test would pass even if the filter returned nothing.
    expect(data).toHaveLength(2);
    expect(data.every((r) => String(r.customerId) === String(CUSTOMER_A))).toBe(true);
  });

  /**
   * Asking for a brand that is not yours returns **nothing**, not your own rows.
   *
   * Overlaying the scope was safe but silent: the vendor got their own list back,
   * which looks exactly like a filter that worked. Somebody builds a report on
   * that and only finds out when the numbers are questioned.
   */
  it("returns nothing rather than quietly substituting your own brand", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A), {
      brandId: String(BRAND_B),
    });
    expect(data).toHaveLength(0);
  });

  it("still honours a filter that agrees with the scope", async () => {
    const { data } = await getClaimTransactions(vendor(BRAND_A), {
      brandId: String(BRAND_A),
    });
    expect(data).toHaveLength(2);
  });

  it("refuses a caller with no scope rather than returning everything", async () => {
    await expect(getClaimTransactions({ role: ROLES.VENDOR })).rejects.toThrow(
      /no brand is linked/i,
    );
    await expect(getClaimTransactions({})).rejects.toThrow(/not authorized/i);
  });
});

describe("claim listings read the frozen snapshots", () => {
  it("names the voucher and outlet as they were", async () => {
    const { data } = await getClaims(customer(CUSTOMER_A));
    expect(data).toHaveLength(2);
    // Not a join — a claim from September still reads correctly in March, after
    // the voucher is republished and the outlet renamed.
    expect(data[0].voucherSnapshot.name).toBe("Test Voucher");
    expect(data[0].outletSnapshot.storeId).toBe("T-01");
    expect(data[0].claimCode).toMatch(/^TD-/);
  });

  it("filters by claim code", async () => {
    const all = await getClaims(admin());
    const target = all.data[0];

    const { data } = await getClaims(admin(), { claimCode: target.claimCode });
    expect(data).toHaveLength(1);
    expect(data[0].claimCode).toBe(target.claimCode);
  });

  it("filters by status", async () => {
    await seed({
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      status: VOUCHER_CLAIM_STATUS.REFUNDED,
    });

    const { data } = await getClaims(customer(CUSTOMER_A), {
      status: VOUCHER_CLAIM_STATUS.REFUNDED,
    });
    expect(data).toHaveLength(1);
    expect(data[0].status).toBe(VOUCHER_CLAIM_STATUS.REFUNDED);
  });

  it("hides our share of a promo from the brand here too", async () => {
    const { data } = await getClaims(vendor(BRAND_A));
    expect(data[0].pricing.platformPromoCost).toBeUndefined();
    expect(data[0].pricing.vendorPayable).toBe(800);
  });

  it("scopes a sub-vendor to their counter", async () => {
    const { data } = await getClaims(subVendor(BRAND_A, OUTLET_2));
    expect(data).toHaveLength(1);
    expect(String(data[0].subBrandId)).toBe(String(OUTLET_2));
  });
});

describe("pagination counts what the caller may actually see", () => {
  /**
   * The scope is a filter, not a post-filter. Filtering after the query makes
   * the total wrong, so a page of ten comes back with three rows and the client
   * cannot tell whether that is the end of the list.
   */
  it("totals only the caller's own rows", async () => {
    const result = await getClaimTransactions(customer(CUSTOMER_A), { limit: 1 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(2);
  });

  it("totals everything for an admin", async () => {
    const result = await getClaimTransactions(admin(), { limit: 1 });
    expect(result.total).toBe(3);
  });
});
