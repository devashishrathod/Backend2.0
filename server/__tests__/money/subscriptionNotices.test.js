const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Notification = require("../../models/Notification");
const User = require("../../models/User");

const { notifySubscriptionActivated } = require("../../helpers/notifications");
const {
  invoiceUrl,
  PANEL_PATHS,
  vendorUrl,
} = require("../../helpers/notifications/panelLinks");
const { NOTIFICATION_TYPES } = require("../../constants/notification");
const { SUBSCRIPTION_ACTION } = require("../../constants/subscription");

/**
 * The vendor's copy of their own invoice.
 *
 * ⚠️ Vendors had no route to it at all. A customer has had a Download Invoice
 * button on their receipt email and a WhatsApp link since the claim flow was
 * written; a vendor who *paid* for a plan got neither, and the only path to their
 * invoice was a raw storage URL that was never sent anywhere.
 *
 * The second thing pinned here is **ordering**. This notice used to be sent from
 * inside `activateSubscription`, which runs before the invoice number is allotted
 * — so even once the button existed it would have gone out with a blank number
 * and no link. Both callers now send it after their document stage.
 */

const oid = () => new mongoose.Types.ObjectId();

const brandFixture = () => ({ _id: oid(), brandName: "Cafe Mocha" });

const subscriptionFixture = () => ({ _id: oid(), name: "Pro Plus" });

const subscribedFixture = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  endDate: new Date("2027-08-29T18:29:00Z"),
  paidAmount: 4999,
  ...overrides,
});

const txnFixture = (overrides = {}) => ({
  _id: oid(),
  invoiceId: "TD/SUB/26-27/000009",
  documentToken: "b".repeat(64),
  ...overrides,
});

let savedPublicUrl;

beforeAll(async () => {
  savedPublicUrl = process.env.PUBLIC_API_URL;
  process.env.PUBLIC_API_URL = "https://api.example.com";
  await connectTestDb();
});

afterAll(async () => {
  if (savedPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
  else process.env.PUBLIC_API_URL = savedPublicUrl;
  await clearCollections(Notification, User);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Notification, User);
});

describe("the activation notice carries the vendor's invoice", () => {
  it("puts a Download Invoice button on the email", async () => {
    const transaction = txnFixture();
    await notifySubscriptionActivated({
      brand: brandFixture(),
      subscription: subscriptionFixture(),
      subscribed: subscribedFixture(),
      action: SUBSCRIPTION_ACTION.NEW,
      transaction,
      awaitDelivery: true,
    });

    const row = await Notification.findOne({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED,
    });
    expect(row).toBeTruthy();
    // The number reaches the row, so support can quote it without a lookup.
    expect(row.meta.invoiceId).toBe("TD/SUB/26-27/000009");
    expect(String(row.meta.transactionId)).toBe(String(transaction._id));
  });

  /**
   * The token is what the link is addressed by. The sequential invoice number is
   * a document-of-record and must never appear in a URL.
   */
  it("addresses the download by token, never by invoice number", async () => {
    const transaction = txnFixture();
    const link = invoiceUrl(transaction.documentToken);

    expect(link).toContain(transaction.documentToken);
    expect(link).not.toContain("TD/SUB");
  });

  /**
   * The button is dropped rather than rendered dead when the public base is not
   * configured — the same rule the customer receipt follows.
   */
  it("omits the link rather than rendering a broken one", async () => {
    const saved = process.env.PUBLIC_API_URL;
    delete process.env.PUBLIC_API_URL;
    try {
      expect(invoiceUrl("c".repeat(64))).toBeUndefined();
    } finally {
      process.env.PUBLIC_API_URL = saved;
    }
  });

  /**
   * A grant is not a purchase, and its document is not an invoice. The email says
   * "Reference No" and "Download Advice" so a vendor is not handed a tax invoice
   * for something nobody charged them for.
   */
  it("calls a grant a reference, not an invoice", async () => {
    await notifySubscriptionActivated({
      brand: brandFixture(),
      subscription: subscriptionFixture(),
      subscribed: subscribedFixture({ paidAmount: 0 }),
      action: SUBSCRIPTION_ACTION.NEW,
      isAdminGrant: true,
      transaction: txnFixture({ invoiceId: "TD/GRT/26-27/000001" }),
      awaitDelivery: true,
    });

    const row = await Notification.findOne({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_GRANTED,
    });
    expect(row).toBeTruthy();
    expect(row.meta.invoiceId).toBe("TD/GRT/26-27/000001");
  });

  /**
   * ⚠️ It must still send when there is no document.
   *
   * The invoice stage can fail — an admin alert is raised and the settlement
   * completes anyway, because the plan is live and the money is captured. The
   * vendor still has to be told their plan started.
   */
  it("still notifies when the invoice stage produced nothing", async () => {
    await notifySubscriptionActivated({
      brand: brandFixture(),
      subscription: subscriptionFixture(),
      subscribed: subscribedFixture(),
      action: SUBSCRIPTION_ACTION.NEW,
      // No transaction at all — the settle never reached the document stage.
      awaitDelivery: true,
    });

    const row = await Notification.findOne({
      type: NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED,
    });
    expect(row).toBeTruthy();
    expect(row.meta.invoiceId).toBeUndefined();
  });

  /**
   * The WhatsApp template's URL button is approved against a fixed base with only
   * the last segment dynamic, so the token is passed rather than a full URL. With
   * no token it falls back to the panel route, so the button still works while a
   * vendor-invoice template is waiting on Meta approval.
   */
  it("falls back to the panel route when there is no token", async () => {
    const { whatsappUrlParam } = require("../../helpers/notifications/panelLinks");
    expect(whatsappUrlParam(PANEL_PATHS.SUBSCRIPTION)).toBeTruthy();
    expect(vendorUrl(PANEL_PATHS.SUBSCRIPTION)).toBeTruthy();
  });
});
