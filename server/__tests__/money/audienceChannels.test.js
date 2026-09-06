/**
 * The platform's channel switches, and what happens when the settings cannot be
 * read at all.
 *
 * ### 🔴 The bug this file exists for
 *
 * `notify()` read the settings inside a `try` and fell back to `{}` on failure,
 * under a comment promising *"defaults are the right fallback"*. `{}` is not the
 * defaults — it is every flag `undefined` — and the three delivery gates each
 * read `undefined` differently:
 *
 * ```js
 * Boolean(config.isEmailNotificationEnabled)      // → false → no email
 * config.isPushNotificationEnabled !== false      // → true  → push sends
 * config.isWhatsAppNotificationEnabled === true   // → false → no WhatsApp
 * ```
 *
 * So a failed settings read silently switched **email off**, which is the exact
 * opposite of its default and of the guard's stated purpose. Push kept working,
 * so the platform looked healthy; the in-app feed kept working, so nobody
 * complained; and the symptom ("emails stopped") pointed at SMTP rather than at
 * a `Setting` document.
 *
 * ⚠️ And it need not be transient. `getSetting()` is a `findOneAndUpdate` with
 * `upsert: true` — a **write** — so a `Setting` document that fails to cast
 * throws on every call, for ever.
 *
 * No database: the settings layer is the seam, so a failure can be produced on
 * demand, which is the one thing a live database will not do to order.
 */

const mockGetSubscriptionConfig = jest.fn();
const mockGetCustomerConfig = jest.fn();
const mockGetAdminConfig = jest.fn();

jest.mock("../../helpers/settings", () => ({
  getSubscriptionConfig: (...args) => mockGetSubscriptionConfig(...args),
  getCustomerConfig: (...args) => mockGetCustomerConfig(...args),
  getAdminConfig: (...args) => mockGetAdminConfig(...args),
}));

const {
  resolveAudienceChannels,
  toChannels,
  AUDIENCE_CHANNELS,
  resetChannelWarningsForTests,
} = require("../../helpers/notifications/audienceChannels");
const {
  NOTIFICATION_AUDIENCE,
  PLATFORM_CHANNEL_KEYS,
} = require("../../constants/notification");

/** What every audience falls back to when the database says nothing. */
const DEFAULTS = { email: true, push: true, whatsapp: false };

const allOn = {
  isEmailNotificationEnabled: true,
  isPushNotificationEnabled: true,
  isWhatsAppNotificationEnabled: true,
};

beforeEach(() => {
  mockGetSubscriptionConfig.mockReset().mockResolvedValue(allOn);
  mockGetCustomerConfig.mockReset().mockResolvedValue({ notification: allOn });
  mockGetAdminConfig.mockReset().mockResolvedValue(allOn);
  /**
   * ⚠️ `warnOnce` is module state. Without this the first test to provoke a
   * failure silences every later one, and each test's assertion about warnings
   * would depend on the order the file runs in.
   */
  resetChannelWarningsForTests();
});

describe("the shape is always complete", () => {
  it("returns three real booleans, whatever the database holds", async () => {
    const { channels } = await resolveAudienceChannels(
      NOTIFICATION_AUDIENCE.VENDOR,
    );

    expect(Object.keys(channels).sort()).toEqual(["email", "push", "whatsapp"]);
    for (const value of Object.values(channels)) {
      expect(typeof value).toBe("boolean");
    }
  });

  /** `??`, not `||` — an explicit `false` is a decision and must survive. */
  it("keeps an explicit false from the database", async () => {
    mockGetSubscriptionConfig.mockResolvedValue({
      ...allOn,
      isEmailNotificationEnabled: false,
    });

    const { channels } = await resolveAudienceChannels(
      NOTIFICATION_AUDIENCE.VENDOR,
    );

    expect(channels).toEqual({ email: false, push: true, whatsapp: true });
  });

  it("fills a channel the settings block never mentioned", async () => {
    // A stored document written before WhatsApp existed as a setting.
    mockGetSubscriptionConfig.mockResolvedValue({
      isEmailNotificationEnabled: true,
      isPushNotificationEnabled: false,
    });

    const { channels } = await resolveAudienceChannels(
      NOTIFICATION_AUDIENCE.VENDOR,
    );

    expect(channels).toEqual({ email: true, push: false, whatsapp: false });
  });
});

describe("a settings read that fails falls back to the defaults", () => {
  /**
   * 🔴 The regression this whole file guards. `{}` used to mean "no email",
   * which is the opposite of email's own default.
   */
  it.each([
    [NOTIFICATION_AUDIENCE.VENDOR, mockGetSubscriptionConfig],
    [NOTIFICATION_AUDIENCE.CUSTOMER, mockGetCustomerConfig],
    [NOTIFICATION_AUDIENCE.ADMIN, mockGetAdminConfig],
  ])("%s keeps sending email and push, and still not WhatsApp", async (audience, mockRead) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockRead.mockRejectedValue(new Error("Setting validation failed"));

    const result = await resolveAudienceChannels(audience);

    expect(result.channels).toEqual(DEFAULTS);
    expect(result.degraded).toBe(true);
    expect(result.reason).toMatch(/Setting validation failed/);

    warn.mockRestore();
  });

  it("never throws — delivery decisions do not get to fail", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetSubscriptionConfig.mockRejectedValue(new Error("connection lost"));

    await expect(
      resolveAudienceChannels(NOTIFICATION_AUDIENCE.VENDOR),
    ).resolves.toBeDefined();

    warn.mockRestore();
  });

  it("says so, and names the block to look at", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetAdminConfig.mockRejectedValue(new Error("boom"));

    await resolveAudienceChannels(NOTIFICATION_AUDIENCE.ADMIN);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("admin.notification"),
    );

    warn.mockRestore();
  });

  /**
   * ⚠️ Once per cause, not once per notification. The old code logged inside
   * `notify`, so a persistent settings failure printed thousands of identical
   * lines an hour and buried everything else.
   */
  it("warns once, however many notifications hit the same failure", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGetCustomerConfig.mockRejectedValue(new Error("boom"));

    for (let i = 0; i < 50; i += 1) {
      await resolveAudienceChannels(NOTIFICATION_AUDIENCE.CUSTOMER);
    }

    const forThisBlock = warn.mock.calls.filter(([line]) =>
      String(line).includes("customer.notification"),
    );
    expect(forThisBlock.length).toBeLessThanOrEqual(1);

    warn.mockRestore();
  });

  it("does not report degraded when the read succeeded", async () => {
    const result = await resolveAudienceChannels(NOTIFICATION_AUDIENCE.VENDOR);

    expect(result.degraded).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

describe("each audience reads its own block", () => {
  /**
   * ⚠️ Admin used to fall into the vendor branch of a `customer? … otherwise`
   * chain, so switching off vendor renewal reminders switched off every admin
   * money alert. A table cannot have that shape.
   */
  it("never reads one audience's settings for another", async () => {
    await resolveAudienceChannels(NOTIFICATION_AUDIENCE.ADMIN);

    expect(mockGetAdminConfig).toHaveBeenCalled();
    expect(mockGetSubscriptionConfig).not.toHaveBeenCalled();
    expect(mockGetCustomerConfig).not.toHaveBeenCalled();
  });

  it("declares every audience the platform has", () => {
    expect(Object.keys(AUDIENCE_CHANNELS).sort()).toEqual(
      Object.values(NOTIFICATION_AUDIENCE).sort(),
    );
  });

  /** Every declared audience has a default for every channel. */
  it.each(Object.entries(AUDIENCE_CHANNELS))(
    "%s declares a default for all three channels",
    (_audience, entry) => {
      for (const settingKey of Object.values(PLATFORM_CHANNEL_KEYS)) {
        expect(typeof entry.defaults[settingKey]).toBe("boolean");
      }
    },
  );

  it("falls back to the vendor block for an audience nobody declared, and warns", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { channels } = await resolveAudienceChannels("PARTNER");

    expect(mockGetSubscriptionConfig).toHaveBeenCalled();
    expect(channels).toEqual({ email: true, push: true, whatsapp: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PARTNER"));

    warn.mockRestore();
  });
});

describe("a channel with no default at all", () => {
  /**
   * A programming error — a channel added to `PLATFORM_CHANNEL_KEYS` without a
   * default. It fails **closed**, because an unknown switch is not a reason to
   * spend money on a WhatsApp message, and it says so, because a silent `false`
   * is the class of bug this file exists to remove.
   */
  it("is off, and named", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const channels = toChannels(null, {
      block: "test.block",
      defaults: { isEmailNotificationEnabled: true },
    });

    expect(channels.email).toBe(true);
    expect(channels.push).toBe(false);
    expect(channels.whatsapp).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("push"));

    warn.mockRestore();
  });
});
