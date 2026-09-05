const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

/**
 * The delivery layer is stubbed at the **provider** boundary, not at `notify`.
 *
 * ⚠️ Mocking `notify` would test nothing here: `notify` is the thing under test.
 * The question this file asks is *"given these toggles, does an email / push /
 * WhatsApp actually leave?"*, so the three senders are the seam and every line
 * above them runs for real, including the row being written.
 */
const mockSendMail = jest.fn(async () => ({ sent: true }));
const mockDispatchPush = jest.fn(async () => ({ sent: 1, failed: 0, devices: 1 }));
const mockSendWhatsApp = jest.fn(async () => ({ sent: true, template: "t" }));

jest.mock("../../helpers/nodeMailer", () => ({
  sendMail: (...args) => mockSendMail(...args),
}));
jest.mock("../../helpers/push", () => ({
  dispatchPush: (...args) => mockDispatchPush(...args),
  // `sendTestPush` checks both before it dispatches — they are the other two
  // diagnoses it exists to separate.
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
const Brand = require("../../models/Brand");
const Notification = require("../../models/Notification");
const Setting = require("../../models/Setting");
const DeviceToken = require("../../models/DeviceToken");

const { notify } = require("../../helpers/notifications/notify");
const {
  notifyAudience,
} = require("../../helpers/notifications/notifyAudience");
const {
  resolveChannelPreferences,
  isChannelAllowed,
  describeChannelPreferences,
} = require("../../helpers/notifications/channelPreferences");
const {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} = require("../../services/notifications");
const {
  resolveAudienceChannels,
} = require("../../helpers/notifications/audienceChannels");
const { updateSetting } = require("../../services/settings");
const { getAdminConfig } = require("../../helpers/settings");
const { sendTestPush } = require("../../services/deviceTokens");
const { generateBrandMerchantId } = require("../../helpers/brands");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  DEVICE_PLATFORMS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  ALWAYS_DELIVER_TYPES,
} = require("../../constants/notification");

const COLLECTIONS = [User, Customer, Brand, Notification, Setting, DeviceToken];

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

/**
 * A user with **no** `notificationPreferences` field, which is what every
 * account already in the database looks like.
 */
const user = async (overrides = {}) => {
  seq += 1;
  /**
   * ⚠️ A distinct number per user, not a constant.
   *
   * `users` carries a unique index on `{ whatsappNumber, role }` (and on
   * `mobile`), so two vendors sharing one number is a duplicate-key error rather
   * than a test-data detail. It stayed hidden while every test made a single
   * user; the broadcast cases below make two.
   */
  // "98" + 8 digits = the 10 an Indian mobile has to be.
  const phone = `98${String(10000000 + seq).slice(-8)}`;

  return User.create({
    uniqueId: `USR-${Date.now()}-${seq}`,
    referralCode: `REF-${Date.now()}-${seq}`,
    name: "test person",
    email: `person${Date.now()}${seq}@example.com`,
    mobile: phone,
    whatsappNumber: phone,
    role: ROLES.VENDOR,
    isActive: true,
    ...overrides,
  });
};

/** One registered device, so `dispatchPush` has somewhere to go. */
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

const customerFor = (u) => {
  seq += 1;
  return Customer.create({
    userId: u._id,
    uniqueId: `TC-${Date.now()}-${seq}`,
    fullName: "test customer",
    mobile: "9800000002",
  });
};

/**
 * ⚠️ `generateBrandMerchantId`, not a made-up string. `Brand.merchantId` is
 * validated against a charset that comes from `MERCHANT_ID_SECRET`, so anything
 * hand-written fails validation on one machine and passes on another.
 */
const brandFor = async (u) => {
  seq += 1;
  return Brand.create({
    userId: u._id,
    uniqueId: `TD-BRD-${Date.now()}-${seq}`,
    merchantId: await generateBrandMerchantId(),
    brandName: "Chai Point",
  });
};

/** Everything on at the platform level, so only the person's toggles vary. */
const platformAllOn = () =>
  Setting.findOneAndUpdate(
    {},
    {
      $set: {
        "vendor.subscription.isEmailNotificationEnabled": true,
        "vendor.subscription.isPushNotificationEnabled": true,
        "vendor.subscription.isWhatsAppNotificationEnabled": true,
        "customer.notification.isEmailNotificationEnabled": true,
        "customer.notification.isPushNotificationEnabled": true,
        "customer.notification.isWhatsAppNotificationEnabled": true,
        "admin.notification.isEmailNotificationEnabled": true,
        "admin.notification.isPushNotificationEnabled": true,
        "admin.notification.isWhatsAppNotificationEnabled": true,
      },
    },
    { upsert: true, new: true },
  );

/** One notification, with all three channels asked for. */
const send = (u, extra = {}) =>
  notify({
    userId: u._id,
    audience: NOTIFICATION_AUDIENCE.VENDOR,
    type: NOTIFICATION_TYPES.SETTLEMENT_PAID,
    title: "Payout sent",
    body: "Your money is on its way.",
    whatsapp: { params: ["Prime Plus"] },
    // The senders are mocked, so waiting costs nothing and removes the race.
    awaitDelivery: true,
    ...extra,
  });

const sent = () => ({
  email: mockSendMail.mock.calls.length,
  push: mockDispatchPush.mock.calls.length,
  whatsapp: mockSendWhatsApp.mock.calls.length,
});

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
  mockSendMail.mockClear();
  mockDispatchPush.mockClear();
  mockSendWhatsApp.mockClear();
  await platformAllOn();
});

// ---------------------------------------------------------------------------
// The normaliser — where the migration risk lives
// ---------------------------------------------------------------------------

describe("an absent preference means on", () => {
  /**
   * 🔴 The one that would have broken every existing account.
   *
   * `default: true` only applies to documents created after the field existed.
   * Every user already in the database has no `notificationPreferences` at all,
   * so `=== true` or `Boolean(...)` would read every one of them as *off* — and
   * the failure is silent, because the in-app feed keeps working perfectly and
   * nobody reports a notification they never knew was coming.
   */
  it("treats a missing field, a missing channel and null as on", () => {
    expect(resolveChannelPreferences(null)).toEqual({
      email: true,
      push: true,
      whatsapp: true,
    });
    expect(resolveChannelPreferences({})).toEqual({
      email: true,
      push: true,
      whatsapp: true,
    });
    expect(
      resolveChannelPreferences({ notificationPreferences: { whatsapp: false } }),
    ).toEqual({ email: true, push: true, whatsapp: false });
    expect(resolveChannelPreferences({ email: null })).toEqual({
      email: true,
      push: true,
      whatsapp: true,
    });
  });

  it("only `false` is off", () => {
    expect(resolveChannelPreferences({ email: false }).email).toBe(false);
    expect(resolveChannelPreferences({ email: undefined }).email).toBe(true);
  });

  /**
   * The rule stated once, in one file, and asserted to stay there. A second
   * opinion formed elsewhere is exactly how this becomes wrong for one channel
   * on one path.
   */
  it("nothing else in the codebase decides what an absent preference means", () => {
    const roots = [
      path.join(__dirname, "../../helpers"),
      path.join(__dirname, "../../services"),
      path.join(__dirname, "../../controllers"),
    ];

    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".js") ? [full] : [];
      });

    const offenders = roots
      .flatMap(walk)
      .filter((file) => !file.endsWith("channelPreferences.js"))
      .filter((file) => {
        const code = fs
          .readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        // Reading the sub-document is fine; deciding truth from it is not.
        return /notificationPreferences(\?)?\.(email|push|whatsapp)/.test(code);
      })
      .map((file) => path.relative(path.join(__dirname, "../.."), file));

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Platform AND person
// ---------------------------------------------------------------------------

describe("both switches have to agree", () => {
  it("blames the platform when the platform is off", () => {
    const verdict = isChannelAllowed({
      channel: "email",
      preferences: { email: true },
      platformEnabled: false,
    });

    expect(verdict).toMatchObject({ allowed: false, blockedBy: "PLATFORM" });
  });

  it("blames the preference when the person is off", () => {
    const verdict = isChannelAllowed({
      channel: "email",
      preferences: { email: false },
      platformEnabled: true,
    });

    expect(verdict).toMatchObject({ allowed: false, blockedBy: "PREFERENCE" });
  });

  /**
   * ⚠️ A platform switch is an operational kill switch — SMTP down, or no
   * Meta-approved template. Letting an always-deliver type through it would
   * mean attempting a send the provider rejects out of sight.
   */
  it.each(ALWAYS_DELIVER_TYPES)(
    "%s overrides the person but never the platform",
    (type) => {
      expect(
        isChannelAllowed({
          channel: "email",
          preferences: { email: false },
          platformEnabled: true,
          type,
        }),
      ).toMatchObject({ allowed: true, forced: true, preference: false });

      expect(
        isChannelAllowed({
          channel: "email",
          preferences: { email: false },
          platformEnabled: false,
          type,
        }),
      ).toMatchObject({ allowed: false, blockedBy: "PLATFORM" });
    },
  );

  it("reports preference and effect separately", () => {
    const described = describeChannelPreferences({
      preferences: { whatsapp: true },
      // The normalised shape `resolveAudienceChannels` returns — not a raw
      // settings block. One vocabulary, one translation, in one file.
      platformChannels: { email: true, push: true, whatsapp: false },
    });

    // The person said yes; the platform is what is holding it shut.
    expect(described.whatsapp).toEqual({
      preference: true,
      effective: false,
      blockedBy: "PLATFORM",
    });
    expect(described.email).toEqual({
      preference: true,
      effective: true,
      blockedBy: null,
    });
  });
});

// ---------------------------------------------------------------------------
// notify(), end to end
// ---------------------------------------------------------------------------

describe("notify honours the recipient's own toggles", () => {
  it("sends on all three for a user who has never touched a setting", async () => {
    const u = await user();
    await device(u);

    await send(u);

    expect(sent()).toEqual({ email: 1, push: 1, whatsapp: 1 });
  });

  /** Each channel on its own — off on one must not touch the other two. */
  it.each([
    ["email", { email: 1, push: 1, whatsapp: 1 }],
    ["push", { email: 1, push: 1, whatsapp: 1 }],
    ["whatsapp", { email: 1, push: 1, whatsapp: 1 }],
  ])("switching %s off leaves the other two alone", async (channel, all) => {
    const u = await user({ notificationPreferences: { [channel]: false } });
    await device(u);

    await send(u);

    expect(sent()).toEqual({ ...all, [channel]: 0 });
  });

  /**
   * ⚠️ The row is the record. A preference governs delivery and must never be
   * able to erase the history of what a person was told.
   */
  it("still writes the in-app row when every channel is off", async () => {
    const u = await user({
      notificationPreferences: { email: false, push: false, whatsapp: false },
    });

    await send(u);

    expect(sent()).toEqual({ email: 0, push: 0, whatsapp: 0 });

    const rows = await Notification.find({ userId: u._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].channels).toEqual([NOTIFICATION_CHANNELS.IN_APP]);
  });

  it("a platform switch beats a person who wants it", async () => {
    const u = await user({ notificationPreferences: { email: true } });
    await Setting.findOneAndUpdate(
      {},
      { $set: { "vendor.subscription.isEmailNotificationEnabled": false } },
      { upsert: true },
    );

    await send(u);

    expect(sent().email).toBe(0);
  });

  /** The list is short and every entry is there for a reason — see the constant. */
  it("delivers an always-deliver notice to someone who muted email", async () => {
    const u = await user({ notificationPreferences: { email: false } });

    await send(u, { type: NOTIFICATION_TYPES.BRAND_DEACTIVATED });

    expect(sent().email).toBe(1);
  });

  it("does not deliver an ordinary notice to someone who muted email", async () => {
    const u = await user({ notificationPreferences: { email: false } });

    await send(u, { type: NOTIFICATION_TYPES.SETTLEMENT_PAID });

    expect(sent().email).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The platform block an admin can actually reach
// ---------------------------------------------------------------------------

describe("the admin audience's own settings block", () => {
  /**
   * 🔴 It was unreachable. The model had `Setting.admin.notification` and
   * `getAdminConfig()` read it — but the settings validator had no `admin` key,
   * and `stripUnknown` is on, so the block was removed from the body before it
   * ever reached the service. A 200, no error, and a toggle that never moved.
   *
   * The same shape `CLAUDE.md` records for `requiresAdminApproval` and
   * `riskChargebackCount`, in mirror: there, a field was configurable and no
   * code read it; here, code read it and nothing could configure it.
   */
  it("can be switched off through PUT /settings", async () => {
    await updateSetting((await user({ role: ROLES.ADMIN }))._id, {
      admin: { notification: { isEmailNotificationEnabled: false } },
    });

    const config = await getAdminConfig();
    expect(config.isEmailNotificationEnabled).toBe(false);
    // ⚠️ Merged, not replaced — a PATCH of one flag must not reset its siblings.
    expect(config.isPushNotificationEnabled).toBe(true);
  });

  /** Switching admin email off must not touch the other two audiences. */
  it("does not silence vendors or customers", async () => {
    await updateSetting((await user({ role: ROLES.ADMIN }))._id, {
      admin: { notification: { isEmailNotificationEnabled: false } },
    });

    const [vendor, customer] = await Promise.all([
      resolveAudienceChannels(NOTIFICATION_AUDIENCE.VENDOR),
      resolveAudienceChannels(NOTIFICATION_AUDIENCE.CUSTOMER),
    ]);

    expect(vendor.channels.email).toBe(true);
    expect(customer.channels.email).toBe(true);
    expect(
      (await resolveAudienceChannels(NOTIFICATION_AUDIENCE.ADMIN)).channels.email,
    ).toBe(false);
  });

  /** And an admin alert then stops emailing, which is the point of the switch. */
  it("stops an admin notice emailing once it is off", async () => {
    await updateSetting((await user({ role: ROLES.ADMIN }))._id, {
      admin: { notification: { isEmailNotificationEnabled: false } },
    });

    const admin = await user({ role: ROLES.ADMIN });
    await send(admin, { audience: NOTIFICATION_AUDIENCE.ADMIN });

    expect(sent().email).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The diagnostic endpoint
// ---------------------------------------------------------------------------

describe("a test push reports the caller's own toggle", () => {
  /**
   * ⚠️ `POST /deviceTokens/test` exists to answer *"why am I not getting
   * notifications?"*, and one of the answers is *"because you switched them
   * off"* — the only one the person can fix themselves in ten seconds. Sending
   * anyway would let them watch a test arrive, conclude push works, and never
   * find out every real notification is suppressed for them.
   */
  it("refuses, and names the endpoint that turns it back on", async () => {
    const u = await user({ notificationPreferences: { push: false } });
    await device(u);

    await expect(
      sendTestPush({ userId: u._id }),
    ).rejects.toMatchObject({ statusCode: 422 });

    expect(mockDispatchPush).not.toHaveBeenCalled();
  });

  it("does not stand in the way when push is on", async () => {
    const u = await user();
    await device(u);

    await sendTestPush({ userId: u._id });

    expect(mockDispatchPush).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The broadcast path, which never touches notify()
// ---------------------------------------------------------------------------

describe("a broadcast respects the same toggles", () => {
  /**
   * ⚠️ `notifyAudience` writes rows with `insertMany` and pushes once in bulk,
   * so the check that governs every single-recipient send does not reach it.
   * Without its own filter this would be the one message that ignored a person's
   * choice — and it is the message that reaches everybody at once.
   */
  it("pushes to the people who want it and nobody else", async () => {
    const wants = await user();
    const doesNot = await user({ notificationPreferences: { push: false } });
    await device(wants);
    await device(doesNot);

    await notifyAudience({
      target: { userIds: [String(wants._id), String(doesNot._id)] },
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      title: "Scheduled maintenance",
      body: "We will be down for ten minutes tonight.",
    });

    expect(mockDispatchPush).toHaveBeenCalledTimes(1);
    expect(mockDispatchPush.mock.calls[0][0]).toEqual([String(wants._id)]);
  });

  /** The row is the record, for everybody, whatever they switched off. */
  it("still writes a row for the person who muted push", async () => {
    const wants = await user();
    const doesNot = await user({ notificationPreferences: { push: false } });
    await device(wants);
    await device(doesNot);

    await notifyAudience({
      target: { userIds: [String(wants._id), String(doesNot._id)] },
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      title: "Scheduled maintenance",
      body: "We will be down for ten minutes tonight.",
    });

    const [kept, muted] = await Promise.all([
      Notification.findOne({ userId: wants._id }).lean(),
      Notification.findOne({ userId: doesNot._id }).lean(),
    ]);

    expect(kept).toBeTruthy();
    expect(muted).toBeTruthy();

    /**
     * ⚠️ `channels` is read as the delivery record — an admin opens it to answer
     * "was this person told?". It used to be stamped on every inserted row, which
     * was harmless while everybody was pushed and is a false claim now.
     */
    expect(kept.channels).toContain(NOTIFICATION_CHANNELS.PUSH);
    expect(muted.channels).not.toContain(NOTIFICATION_CHANNELS.PUSH);
    expect(muted.channels).toEqual([NOTIFICATION_CHANNELS.IN_APP]);
  });

  it("skips the provider entirely when nobody wants push", async () => {
    const a = await user({ notificationPreferences: { push: false } });
    const b = await user({ notificationPreferences: { push: false } });
    await device(a);
    await device(b);

    const result = await notifyAudience({
      target: { userIds: [String(a._id), String(b._id)] },
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      title: "Scheduled maintenance",
      body: "We will be down for ten minutes tonight.",
    });

    expect(mockDispatchPush).not.toHaveBeenCalled();
    expect(result.created).toBe(2);
    expect(result.push).toMatchObject({ sent: 0, skipped: true });
  });
});

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

describe("reading and writing the toggles", () => {
  it("reports every channel on for an untouched account", async () => {
    const u = await user();

    const result = await getMyNotificationPreferences({ userId: u._id });

    expect(result.channels.email).toMatchObject({ preference: true, effective: true });
    expect(result.channels.push.preference).toBe(true);
    expect(result.channels.whatsapp.preference).toBe(true);
    expect(result.updatedAt).toBeNull();
  });

  /**
   * ⚠️ Partial. A panel toggle changes one switch, and a screen that loaded five
   * minutes ago must not be able to revert a change made since on another device.
   */
  it("changes only the channels named", async () => {
    const u = await user({
      notificationPreferences: { email: false, push: true, whatsapp: true },
    });

    const result = await updateMyNotificationPreferences(
      { userId: u._id },
      { whatsapp: false },
    );

    expect(result.channels.email.preference).toBe(false);
    expect(result.channels.push.preference).toBe(true);
    expect(result.channels.whatsapp.preference).toBe(false);
  });

  it("records who changed it when an admin does", async () => {
    const target = await user();
    const admin = await user({ role: ROLES.ADMIN, name: "ops admin" });

    const result = await updateUserNotificationPreferences(
      { userId: admin._id },
      { userId: target._id, push: false },
    );

    expect(result.channels.push.preference).toBe(false);
    expect(String(result.updatedBy._id)).toBe(String(admin._id));
    expect(result.updatedBy.name).toBe("ops admin");
  });

  /**
   * ⚠️ This renders on somebody **else's** profile card. "Which admin touched
   * this" needs a name; it does not need a colleague's inbox or phone number.
   */
  it("names the admin without handing out their contact details", async () => {
    const target = await user();
    const admin = await user({ role: ROLES.ADMIN, name: "ops admin" });

    const result = await updateUserNotificationPreferences(
      { userId: admin._id },
      { userId: target._id, email: false },
    );

    expect(Object.keys(result.updatedBy).sort()).toEqual(["_id", "name", "role"]);
    expect(JSON.stringify(result.updatedBy)).not.toContain("@");
  });

  /**
   * Absent `updatedBy` with a present `updatedAt` means the person did it
   * themselves — so a self-service change has to clear an earlier admin stamp
   * rather than leave a name that no longer explains the state.
   */
  it("clears the admin stamp when the person changes it back", async () => {
    const target = await user();
    const admin = await user({ role: ROLES.ADMIN });

    await updateUserNotificationPreferences(
      { userId: admin._id },
      { userId: target._id, push: false },
    );
    const result = await updateMyNotificationPreferences(
      { userId: target._id },
      { push: true },
    );

    expect(result.channels.push.preference).toBe(true);
    expect(result.updatedBy).toBeNull();
    expect(result.updatedAt).toBeTruthy();
  });

  /** An admin screen holds whichever id it holds. */
  it("finds the user behind a customerId", async () => {
    const u = await user({ role: ROLES.CUSTOMER });
    const customer = await customerFor(u);

    const result = await getUserNotificationPreferences({
      customerId: customer._id,
    });

    expect(String(result.userId)).toBe(String(u._id));
    expect(result.audience).toBe(NOTIFICATION_AUDIENCE.CUSTOMER);
  });

  it("finds the owner behind a brandId", async () => {
    const u = await user({ role: ROLES.VENDOR });
    const brand = await brandFor(u);

    const result = await getUserNotificationPreferences({ brandId: brand._id });

    expect(String(result.userId)).toBe(String(u._id));
    expect(result.audience).toBe(NOTIFICATION_AUDIENCE.VENDOR);
  });

  it("refuses an address it cannot resolve", async () => {
    await expect(
      getUserNotificationPreferences({ userId: oid() }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(getUserNotificationPreferences({})).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  /**
   * An admin reads the same numbers the person does. Two presenters would let
   * the panel and the app disagree about one account.
   */
  it("shows an admin exactly what the person sees", async () => {
    const u = await user({ notificationPreferences: { whatsapp: false } });

    const mine = await getMyNotificationPreferences({ userId: u._id });
    const theirs = await getUserNotificationPreferences({ userId: u._id });

    expect(theirs.channels).toEqual(mine.channels);
  });
});
