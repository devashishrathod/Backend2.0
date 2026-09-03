const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const OtpThrottle = require("../../models/OtpThrottle");
const Setting = require("../../models/Setting");
const { claimOtpSend } = require("../../helpers/otps");
const { generateNumericOtp } = require("../../utils");
const { OTP_DEFAULTS } = require("../../constants/otp");

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

const TARGET = "919999900001";
const PURPOSE = "auth";

const agoMinutes = (m) => new Date(Date.now() - m * MINUTE_MS);

/** Put a history on the row without waiting real minutes for it. */
const seedSends = async (offsetsInMinutes, target = TARGET, purpose = PURPOSE) =>
  OtpThrottle.findOneAndUpdate(
    { target, purpose },
    { $set: { sends: offsetsInMinutes.map(agoMinutes), updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  ).lean();

beforeAll(async () => {
  await connectTestDb();
  await OtpThrottle.createIndexes();
});

afterAll(async () => {
  await clearCollections(OtpThrottle, Setting);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(OtpThrottle, Setting);
});

/**
 * ⚠️ This used `Math.random()`.
 *
 * V8's generator is predictable — its state can be recovered from a run of
 * outputs, and an attacker can collect those simply by asking for codes to their
 * own number. Here a code unlocks logging in as somebody else and attaching the
 * bank account a refund is then paid into.
 */
describe("the code itself", () => {
  it("is six digits, every time", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateNumericOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("does not lean on any digit", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      for (const ch of generateNumericOtp()) counts[Number(ch)] += 1;
    }
    const expected = (20000 * 6) / 10;
    for (const count of counts) {
      // Generous: this is catching a broken generator, not testing randomness.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.1);
    }
  });
});

describe("sending a code to the same place twice", () => {
  it("allows the first one", async () => {
    const claim = await claimOtpSend(TARGET, PURPOSE);

    expect(claim.allowed).toBe(true);
    expect(claim.at).toBeInstanceOf(Date);
  });

  it("refuses the next one inside the cooldown, and says how long", async () => {
    await claimOtpSend(TARGET, PURPOSE);
    const second = await claimOtpSend(TARGET, PURPOSE);

    expect(second.allowed).toBe(false);
    expect(second.reason).toBe("COOLDOWN");
    /**
     * A number, not just a refusal. A caller told only "try again later" tries
     * again immediately — another refusal, and another confused person.
     */
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(
      OTP_DEFAULTS.resendCooldownSeconds,
    );
  });

  it("allows it again once the cooldown has passed", async () => {
    await seedSends([5]);

    const claim = await claimOtpSend(TARGET, PURPOSE);
    expect(claim.allowed).toBe(true);
  });
});

describe("the hourly cap", () => {
  it("refuses once the limit is used up", async () => {
    // Five sends, spread out enough that the cooldown is not what stops it.
    await seedSends([50, 40, 30, 20, 10]);

    const claim = await claimOtpSend(TARGET, PURPOSE);

    expect(claim.allowed).toBe(false);
    expect(claim.reason).toBe("HOURLY_CAP");
    // Until the oldest of the five rolls out of the window.
    expect(claim.retryAfterSeconds).toBeGreaterThan(5 * 60);
  });

  /**
   * ⚠️ A rolling window, not a fixed one.
   *
   * A fixed window lets twice the limit through at the boundary — five at 10:59
   * and five more at 11:01. Keeping the send times and pruning on every write
   * means "five in the last hour" always means the last hour.
   */
  it("lets an old send fall out of the window", async () => {
    await seedSends([70, 40, 30, 20, 10]);

    const claim = await claimOtpSend(TARGET, PURPOSE);
    expect(claim.allowed).toBe(true);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    // The 70-minute-old one is gone, the four survivors plus this one remain.
    expect(row.sends).toHaveLength(5);
  });
});

/**
 * ⚠️ Being unable to log in because you added a bank account is not a limit
 * anybody would understand — they are different acts by the same person.
 */
describe("purposes do not eat each other's allowance", () => {
  it("keeps a separate count per purpose", async () => {
    await seedSends([50, 40, 30, 20, 10], TARGET, "auth");

    expect((await claimOtpSend(TARGET, "auth")).allowed).toBe(false);
    expect((await claimOtpSend(TARGET, "customer-bank-attach")).allowed).toBe(
      true,
    );
  });
});

/**
 * ⚠️ The property the whole design rests on.
 *
 * The obvious version — count, decide, then record — has a window two requests
 * both pass. Two taps on "resend" would send two messages, and on a second
 * instance the limit would simply be doubled. The condition lives inside the
 * write, so Mongo decides rather than timing.
 */
describe("two requests at the same moment", () => {
  it("lets exactly one through", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimOtpSend(TARGET, PURPOSE)),
    );

    const allowed = claims.filter((c) => c.allowed);
    expect(allowed).toHaveLength(1);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    expect(row.sends).toHaveLength(1);
  });
});

describe("admin config wins over the built-in default", () => {
  it("uses the stored numbers when they are set", async () => {
    await Setting.findOneAndUpdate(
      {},
      { $set: { "security.otp": { resendCooldownSeconds: 0, maxPerHour: 2 } } },
      { upsert: true },
    );

    // No cooldown, so two land back to back...
    expect((await claimOtpSend(TARGET, PURPOSE)).allowed).toBe(true);
    expect((await claimOtpSend(TARGET, PURPOSE)).allowed).toBe(true);

    // ...and the third is stopped by the cap, not the wait.
    const third = await claimOtpSend(TARGET, PURPOSE);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe("HOURLY_CAP");
  });

  /**
   * ⚠️ `??`, never `||`. A deliberate `0` means "no cooldown", and `||` would
   * quietly restore 60 while the settings screen kept insisting it was zero.
   */
  it("treats a configured zero as zero, not as unset", async () => {
    await Setting.findOneAndUpdate(
      {},
      { $set: { "security.otp.resendCooldownSeconds": 0 } },
      { upsert: true },
    );

    expect((await claimOtpSend(TARGET, PURPOSE)).allowed).toBe(true);
    expect((await claimOtpSend(TARGET, PURPOSE)).allowed).toBe(true);
  });
});
