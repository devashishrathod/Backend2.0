const mockSendMail = jest.fn(async () => ({ sent: true }));
const mockDispatchPush = jest.fn(async () => ({ sent: 1, failed: 0, devices: 1 }));
const mockSendWhatsApp = jest.fn(async () => ({ sent: true, template: "t" }));

jest.mock("../../helpers/nodeMailer", () => ({
  sendMail: (...args) => mockSendMail(...args),
}));
jest.mock("../../helpers/push", () => ({
  dispatchPush: (...args) => mockDispatchPush(...args),
  isFcmConfigured: () => true,
  probeFcmAuth: async () => ({ ok: true }),
}));
jest.mock("../../helpers/whatsapp", () => ({
  sendWhatsApp: (...args) => mockSendWhatsApp(...args),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const User = require("../../models/User");
const Customer = require("../../models/Customer");
const Notification = require("../../models/Notification");
const Setting = require("../../models/Setting");
const DeviceToken = require("../../models/DeviceToken");

const { notify } = require("../../helpers/notifications/notify");
const {
  updateMyNotificationPreferences,
} = require("../../services/notifications");
const { applyIdentityChange } = require("../../helpers/users");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  DEVICE_PLATFORMS,
  ALWAYS_DELIVER_TYPES,
} = require("../../constants/notification");

/**
 * ---------------- an unverified key carries nothing ----------------
 *
 * Delivery needs three things to agree: the platform switch, the person's toggle,
 * and — new — whether an OTP has ever confirmed the address the message is going
 * to. The third exists because the address can be written by somebody who is not
 * the account holder: an admin may set anybody's, a vendor may set their own
 * outlet managers'.
 *
 * The case worth the whole file is the one in the middle of `ALWAYS_DELIVER`.
 * That list outranks a person's wish to be left alone, for notices where silence
 * costs them money. It must **not** outrank an unconfirmed address, because the
 * failure there is not silence — it is a real customer's refund detail arriving
 * in a stranger's inbox.
 */

const COLLECTIONS = [User, Customer, Notification, Setting, DeviceToken];

let seq = 0;
const RUN = String(Date.now()).slice(-5);
const nextPhone = () => {
  seq += 1;
  return `9${RUN}${String(seq).padStart(4, "0")}`;
};

const user = async (overrides = {}) => {
  seq += 1;
  const phone = nextPhone();
  return User.create({
    uniqueId: `USR-${Date.now()}-${seq}`,
    referralCode: `REF-${Date.now()}-${seq}`,
    name: "test person",
    email: `person${Date.now()}${seq}@example.com`,
    whatsappNumber: phone,
    role: ROLES.VENDOR,
    isActive: true,
    // Everything the person could ask for is on; only the flags vary.
    notificationPreferences: { email: true, push: true, whatsapp: true },
    ...overrides,
  });
};

const device = (u) => {
  seq += 1;
  return DeviceToken.create({
    userId: u._id,
    role: u.role,
    token: `token-${Date.now()}-${seq}`,
    platform: DEVICE_PLATFORMS.ANDROID,
    isActive: true,
  });
};

const platformAllOn = () =>
  Setting.findOneAndUpdate(
    {},
    {
      $set: {
        "vendor.subscription.isEmailNotificationEnabled": true,
        "vendor.subscription.isPushNotificationEnabled": true,
        "vendor.subscription.isWhatsAppNotificationEnabled": true,
      },
    },
    { upsert: true, new: true },
  );

const send = (u, extra = {}) =>
  notify({
    userId: u._id,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.SETTLEMENT_PAID,
    title: "Payout sent",
    body: "Your money is on its way.",
    whatsapp: { params: ["Prime Plus"] },
    awaitDelivery: true,
    ...extra,
  });

const sent = () => ({
  email: mockSendMail.mock.calls.length,
  push: mockDispatchPush.mock.calls.length,
  whatsapp: mockSendWhatsApp.mock.calls.length,
});

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  mockSendMail.mockClear();
  mockDispatchPush.mockClear();
  mockSendWhatsApp.mockClear();
  await platformAllOn();
});

describe("delivery needs the key confirmed, not just the toggle on", () => {
  it("does not email an address nobody has verified", async () => {
    const u = await user({ isEmailVerified: false, isWhatsappVerified: true });
    await device(u);

    await send(u);

    // The toggle says yes and the platform says yes. The address is the problem.
    expect(sent().email).toBe(0);
  });

  it("emails once it is verified", async () => {
    const u = await user({ isEmailVerified: true, isWhatsappVerified: true });
    await device(u);

    await send(u);
    expect(sent().email).toBe(1);
  });

  it("applies the same rule to WhatsApp", async () => {
    const u = await user({ isEmailVerified: true, isWhatsappVerified: false });
    await device(u);

    await send(u);
    expect(sent().whatsapp).toBe(0);
  });

  it("never blocks push or the in-app row", async () => {
    const u = await user({ isEmailVerified: false, isWhatsappVerified: false });
    await device(u);

    await send(u);

    /**
     * ⚠️ Nobody becomes unreachable. A device token proves itself by existing —
     * there is no address to be wrong about — and the in-app row is the record,
     * written before any of this is consulted.
     */
    expect(sent().push).toBe(1);
    expect(await Notification.countDocuments({ userId: u._id })).toBe(1);
  });

  it("treats a missing flag as unverified, not as verified", async () => {
    // Every account that predates the flag has no value. Reading that as
    // confirmed would be the guard passing for exactly the rows it exists for.
    const u = await user();
    await User.collection.updateOne(
      { _id: u._id },
      { $unset: { isEmailVerified: "", isWhatsappVerified: "" } },
    );
    await device(u);

    await send(u);
    expect(sent()).toMatchObject({ email: 0, whatsapp: 0, push: 1 });
  });
});

describe("the guard outranks ALWAYS_DELIVER", () => {
  const alwaysType = ALWAYS_DELIVER_TYPES[0];

  it("holds an always-deliver notice back from an unverified address", async () => {
    const u = await user({ isEmailVerified: false, isWhatsappVerified: false });
    await device(u);

    await send(u, { type: alwaysType });

    /**
     * ⚠️ The decision this file exists for.
     *
     * `ALWAYS_DELIVER_TYPES` overrides a person's *wish* not to be disturbed.
     * Unverified is not a wish — it is not knowing whose address it is. Sending
     * a refund notice there puts a real customer's money detail in a stranger's
     * inbox, which is worse than not sending it.
     */
    expect(sent()).toMatchObject({ email: 0, whatsapp: 0 });
    // And they are still reached: the row, and the device.
    expect(sent().push).toBe(1);
  });

  it("still overrides a plain preference when the address IS verified", async () => {
    // The list has not been weakened — only ordered behind the one thing it was
    // never meant to outrank.
    const u = await user({
      isEmailVerified: true,
      isWhatsappVerified: true,
      notificationPreferences: { email: false, push: true, whatsapp: false },
    });
    await device(u);

    await send(u, { type: alwaysType });
    expect(sent()).toMatchObject({ email: 1, whatsapp: 1 });
  });
});

describe("changing a key switches its channel off", () => {
  it("an unverified change stops email until it is verified AND switched on", async () => {
    const u = await user({ isEmailVerified: true, isWhatsappVerified: true });
    await device(u);

    // It works today.
    await send(u);
    expect(sent().email).toBe(1);

    // They change the address and do not confirm it.
    const fresh = await User.findById(u._id);
    await applyIdentityChange(fresh, { email: "moved@example.com" }, { verified: false });

    mockSendMail.mockClear();
    mockDispatchPush.mockClear();
    mockSendWhatsApp.mockClear();

    await send(u);
    expect(sent().email).toBe(0);

    /**
     * ⚠️ And verifying alone is not enough — the toggle was switched off with the
     * flag, so it has to be switched back on deliberately.
     *
     * Without that, confirming the new address would silently resume email that
     * the person never re-asked for, because a `true` from before the change was
     * still sitting in the document.
     */
    const verified = await User.findById(u._id);
    await applyIdentityChange(
      verified,
      { email: "moved@example.com" },
      { verified: true },
    );
    // (no-op on the value; what matters is the flag)
    await User.updateOne({ _id: u._id }, { $set: { isEmailVerified: true } });

    mockSendMail.mockClear();
    await send(u);
    expect(sent().email).toBe(0);

    await updateMyNotificationPreferences({ userId: u._id }, { email: true });

    mockSendMail.mockClear();
    await send(u);
    expect(sent().email).toBe(1);
  });
});

describe("switching a channel on", () => {
  it("is refused while its key is unverified", async () => {
    const u = await user({ isEmailVerified: false });

    await expect(
      updateMyNotificationPreferences({ userId: u._id }, { email: true }),
    ).rejects.toMatchObject({
      statusCode: 422,
      data: { code: "IDENTITY_NOT_VERIFIED", channel: "email" },
    });
  });

  it("is allowed once it is verified", async () => {
    const u = await user({
      isEmailVerified: true,
      notificationPreferences: { email: false, push: true, whatsapp: true },
    });

    const result = await updateMyNotificationPreferences(
      { userId: u._id },
      { email: true },
    );
    expect(result.channels.email.preference).toBe(true);
  });

  it("never gates switching a channel OFF", async () => {
    // Declining messages is always allowed; only the promise that they will
    // arrive has to be backed by something.
    const u = await user({ isEmailVerified: false, isWhatsappVerified: false });

    const result = await updateMyNotificationPreferences(
      { userId: u._id },
      { whatsapp: false },
    );
    expect(result.channels.whatsapp.preference).toBe(false);
  });
});
