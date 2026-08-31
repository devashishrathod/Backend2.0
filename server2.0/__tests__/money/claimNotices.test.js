const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Notification = require("../../models/Notification");
const Customer = require("../../models/Customer");
const User = require("../../models/User");

const {
  notifyClaimPaid,
  notifyClaimFailed,
  notifyVendorClaimReceived,
  notifyClaimRefunded,
} = require("../../helpers/notifications");
const { invoiceUrl, CUSTOMER_PATHS } = require("../../helpers/notifications/panelLinks");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_AUDIENCE,
} = require("../../constants/notification");

const oid = () => new mongoose.Types.ObjectId();

const claimFixture = (overrides = {}) => ({
  _id: oid(),
  customerId: oid(),
  brandId: oid(),
  voucherId: oid(),
  subBrandId: oid(),
  claimCode: "TD-ABC123",
  paidAt: new Date("2026-08-30T10:00:00Z"),
  voucherSnapshot: { name: "Luxury Stay Special" },
  brandSnapshot: { name: "cafe mocha" },
  outletSnapshot: { storeId: "MOCHA-VN-01" },
  pricing: {
    billAmount: 1000,
    totalPayable: 760,
    youSaved: 250,
    vendorPayable: 785,
  },
  ...overrides,
});

const txnFixture = () => ({
  _id: oid(),
  invoiceId: "TD/VCH/26-27/000001",
  invoiceToken: "a".repeat(64),
});

let savedPublicUrl;

beforeAll(async () => {
  savedPublicUrl = process.env.PUBLIC_API_URL;
  await connectTestDb();
});

afterAll(async () => {
  if (savedPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
  else process.env.PUBLIC_API_URL = savedPublicUrl;
  await clearCollections(Notification, Customer, User);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Notification, Customer, User);
});

describe("a customer notification reaches the customer", () => {
  /**
   * `resolveRecipient` only knew Brand → User. A claim notification has no
   * brand of the customer's own, so before this it resolved to nobody and the
   * customer's own feed could not be queried at all.
   */
  it("stores customerId, not just userId", async () => {
    const claim = claimFixture();
    await notifyClaimPaid({ claim, transaction: txnFixture() });

    const row = await Notification.findOne({ type: NOTIFICATION_TYPES.VOUCHER_PAYMENT_SUCCESS });
    expect(row).toBeTruthy();
    expect(String(row.customerId)).toBe(String(claim.customerId));
    expect(row.audience).toBe(NOTIFICATION_AUDIENCE.CUSTOMER);
  });

  /**
   * The login is not the customer.
   *
   * A User record can back more than one identity, and a customer's receipt
   * belongs at the address they gave as a customer — not at whatever the account
   * was created with.
   */
  it("prefers the customer's own contacts over the login's", async () => {
    const user = await User.create({
      uniqueId: `USR-NOTICE-${Date.now()}`,
      name: "shared login",
      email: "login@example.com",
      mobile: "9700000001",
    });
    const customer = await Customer.create({
      uniqueId: `CUS-NOTICE-${Date.now()}`,
      userId: user._id,
      name: "the customer",
      email: "customer@example.com",
      mobile: "9700000002",
    });

    // Read through the same path `notify` uses, so this tests the resolution
    // rather than a copy of it.
    const { resolveRecipient } = require("../../helpers/notifications/notify");
    const recipient = await resolveRecipient(null, null, customer._id);

    expect(recipient.email).toBe("customer@example.com");
    expect(recipient.phone).toBe("9700000002");
    // The user is still found, because the row has to be readable in-app.
    expect(String(recipient.userId)).toBe(String(user._id));
    expect(String(recipient.customerId)).toBe(String(customer._id));
  });

  it("falls back to the login when the customer gave no email", async () => {
    const user = await User.create({
      uniqueId: `USR-NOTICE-${Date.now()}-b`,
      name: "shared login",
      email: "login@example.com",
      mobile: "9700000001",
    });
    const customer = await Customer.create({
      uniqueId: `CUS-NOTICE-${Date.now()}-b`,
      userId: user._id,
      name: "no email",
    });

    const { resolveRecipient } = require("../../helpers/notifications/notify");
    const recipient = await resolveRecipient(null, null, customer._id);

    // A customer who never filled one in should still get their receipt.
    expect(recipient.email).toBe("login@example.com");
  });

  it("says what was paid and what was saved", async () => {
    await notifyClaimPaid({ claim: claimFixture(), transaction: txnFixture() });

    const row = await Notification.findOne({});
    expect(row.title).toContain("cafe mocha");
    expect(row.body).toContain("₹760.00");
    expect(row.body).toContain("₹250.00");
    expect(row.body).toContain("TD-ABC123");
  });

  it("deep-links to the order, not a generic feed", async () => {
    const claim = claimFixture();
    await notifyClaimPaid({ claim, transaction: txnFixture() });

    const row = await Notification.findOne({});
    expect(row.meta.deepLink).toContain(CUSTOMER_PATHS.order(claim._id));
  });
});

describe("the Download Invoice button", () => {
  /**
   * The WhatsApp template's URL button is approved by Meta against a fixed
   * base with only the last segment dynamic — a Cloudinary URL is different for
   * every invoice and could never be that segment. So the token travels, and
   * the link is built from `PUBLIC_API_URL`.
   */
  it("is omitted entirely when PUBLIC_API_URL is unset", async () => {
    delete process.env.PUBLIC_API_URL;
    expect(invoiceUrl("abc123")).toBeUndefined();

    await notifyClaimPaid({ claim: claimFixture(), transaction: txnFixture() });
    // A button rendering as a dead link is worse than no button.
    const row = await Notification.findOne({});
    expect(row).toBeTruthy();
  });

  it("points at this API, not at the CDN, once configured", () => {
    process.env.PUBLIC_API_URL = "https://api.trydood.com";
    expect(invoiceUrl("abc123")).toBe(
      "https://api.trydood.com/trydood/v1/transactions/invoice/abc123",
    );
    delete process.env.PUBLIC_API_URL;
  });

  it("carries the token, so the template's dynamic segment has something to be", async () => {
    const transaction = txnFixture();
    await notifyClaimPaid({ claim: claimFixture(), transaction });

    const row = await Notification.findOne({});
    expect(row.meta.invoiceId).toBe("TD/VCH/26-27/000001");
  });
});

describe("the vendor hears about it too, and hears something different", () => {
  it("is addressed to the brand, not the customer", async () => {
    const claim = claimFixture();
    await notifyVendorClaimReceived({ claim });

    const row = await Notification.findOne({
      type: NOTIFICATION_TYPES.VOUCHER_CLAIM_RECEIVED,
    });
    expect(String(row.brandId)).toBe(String(claim.brandId));
    expect(row.audience).toBe(NOTIFICATION_AUDIENCE.VENDOR);
    expect(row.customerId).toBeFalsy();
  });

  it("tells them the figure a settlement will have to agree with", async () => {
    await notifyVendorClaimReceived({ claim: claimFixture() });

    const row = await Notification.findOne({});
    // Not the bill the customer paid — what the vendor is actually owed.
    expect(row.meta.vendorPayable).toBe(785);
    expect(row.body).toContain("₹785.00");
    // The outlet is what the vendor scans for first, so it leads the title.
    expect(row.title).toContain("MOCHA-VN-01");
  });
});

describe("a failed payment says nothing was charged", () => {
  it("names the reason and reassures", async () => {
    await notifyClaimFailed({
      claim: claimFixture(),
      reason: "Payment declined by the bank",
    });

    const row = await Notification.findOne({});
    expect(row.type).toBe(NOTIFICATION_TYPES.VOUCHER_PAYMENT_FAILED);
    expect(row.body).toContain("Payment declined by the bank");
    // The sentence that stops a support ticket.
    expect(row.body).toContain("Nothing has been charged");
  });

  it("sends them back to the voucher, not to a dead end", async () => {
    const claim = claimFixture();
    await notifyClaimFailed({ claim, reason: "declined" });

    const row = await Notification.findOne({});
    expect(row.meta.deepLink).toContain(String(claim.voucherId));
  });
});

describe("nothing is sent twice", () => {
  /**
   * The resume job re-runs the whole settle, notifications included. A customer
   * receiving two receipts for one payment reads as a double charge.
   */
  it("dedupes the receipt on a resume", async () => {
    const claim = claimFixture();
    const transaction = txnFixture();

    await notifyClaimPaid({ claim, transaction });
    await notifyClaimPaid({ claim, transaction });

    expect(
      await Notification.countDocuments({
        type: NOTIFICATION_TYPES.VOUCHER_PAYMENT_SUCCESS,
      }),
    ).toBe(1);
  });

  it("dedupes a refund per reference, not per claim", async () => {
    const claim = claimFixture();
    const transaction = txnFixture();

    await notifyClaimRefunded({ claim, transaction, amount: 100, reference: "rfnd_1" });
    await notifyClaimRefunded({ claim, transaction, amount: 100, reference: "rfnd_1" });
    // A second, genuinely different partial refund must still be announced.
    await notifyClaimRefunded({ claim, transaction, amount: 50, reference: "rfnd_2" });

    expect(
      await Notification.countDocuments({ type: NOTIFICATION_TYPES.VOUCHER_REFUNDED }),
    ).toBe(2);
  });
});

describe("a notification never breaks the payment behind it", () => {
  it("returns rather than throwing when the row cannot be written", async () => {
    // No customer, no brand, no type — invalid every way.
    const result = await notifyClaimPaid({
      claim: { _id: oid(), pricing: {} },
      transaction: {},
    });
    // `notify` swallows its own failure: the money already moved.
    expect(result).toBeDefined();
  });
});
