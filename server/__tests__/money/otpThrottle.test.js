const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

/**
 * The provider and the code store, stubbed — so the **real** `sendOtp` can be
 * driven into its failure branch without a WhatsApp message or a network.
 *
 * ⚠️ `requireActual` on the otps barrel, because `claimOtpSend` must stay real:
 * it is the thing under test, and the release path only means anything against
 * a claim it actually made.
 *
 * Named `mock*` because jest refuses a factory that closes over anything else.
 */
let mockSendTemplate;
jest.mock("../../helpers/otps", () => ({
  ...jest.requireActual("../../helpers/otps"),
  sendTemplate: (...args) => mockSendTemplate(...args),
}));

jest.mock("../../database/otpRepository", () => ({
  ...jest.requireActual("../../database/otpRepository"),
  saveOtp: async () => {},
}));

const OtpThrottle = require("../../models/OtpThrottle");
const Setting = require("../../models/Setting");
const { claimOtpSend } = require("../../helpers/otps");
const { sendOtp } = require("../../services/otps");
const { generateNumericOtp } = require("../../utils");
const { OTP_DEFAULTS } = require("../../constants/otp");
const { LOGIN_TYPES } = require("../../constants");

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

const TARGET = "919999900001";
const PURPOSE = "auth";

const agoMinutes = (m) => new Date(Date.now() - m * MINUTE_MS);

/**
 * Put a history on the row without waiting real minutes for it.
 *
 * ⚠️ Each entry needs a `nonce` — an entry without one is a pre-O-1 leftover,
 * and both the pipeline and the reader drop those on purpose. Seeding bare
 * dates here would make every one of these tests start from an empty window
 * while looking like it had seeded five sends.
 */
const seedSends = async (offsetsInMinutes, target = TARGET, purpose = PURPOSE) =>
  OtpThrottle.findOneAndUpdate(
    { target, purpose },
    {
      $set: {
        sends: offsetsInMinutes.map((m, i) => ({
          at: agoMinutes(m),
          nonce: `seed-${target}-${purpose}-${i}`,
        })),
        updatedAt: new Date(),
      },
    },
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
  mockSendTemplate = jest.fn(async () => ({ ok: true }));
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
  /**
   * 🔴 This was **red for weeks** — phase O-1. Eight concurrent claims all came
   * back `allowed`, because the verdict was `sends.includes(now.getTime())` and
   * eight callers in one millisecond share that value: the single entry the
   * winning write appended answered "yes, mine" for every one of them.
   *
   * ⚠️ **Mutation to re-prove it:** in `claimOtpSend`, swap the nonce check back
   * for `sends.includes(now.getTime())` and this returns 8. The write itself
   * needs no change for the bug to come back, which is exactly why it survived
   * review — the atomic update always looked right.
   */
  it("lets exactly one through", async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimOtpSend(TARGET, PURPOSE)),
    );

    const allowed = claims.filter((c) => c.allowed);
    expect(allowed).toHaveLength(1);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    expect(row.sends).toHaveLength(1);

    // The winner's nonce is the one on the row — not merely "some entry
    // exists", which is what the old check effectively asserted.
    expect(row.sends[0].nonce).toBe(allowed[0].nonce);
  });

  it("gives every caller its own nonce", async () => {
    // Two calls far enough apart that both are allowed, so the nonces being
    // distinct is what is under test rather than the throttle.
    const first = await claimOtpSend(TARGET, PURPOSE);
    await seedSends([5]);
    const second = await claimOtpSend(TARGET, PURPOSE);

    expect(first.allowed).toBe(true);
    expect(first.nonce).toEqual(expect.any(String));
    expect(second.nonce).not.toBe(first.nonce);
  });
});

/**
 * 🔴 The release path had the same flaw in reverse (O-1).
 *
 * A failed send gives its slot back so a provider outage does not lock someone
 * out for an hour. That pull was `{ $pull: { sends: claim.at } }` — by value —
 * so a failure could hand back the entry **somebody else** claimed in the same
 * millisecond. The flood would then have made itself room by failing.
 */
describe("giving a slot back", () => {
  const release = (target, purpose, claim) =>
    OtpThrottle.updateOne(
      { target, purpose },
      { $pull: { sends: { nonce: claim.nonce } } },
    );

  it("removes only the caller's own entry", async () => {
    await seedSends([30], TARGET, PURPOSE);
    const mine = await claimOtpSend(TARGET, PURPOSE);
    expect(mine.allowed).toBe(true);

    await release(TARGET, PURPOSE, mine);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    // The seeded one survives; only the claim that failed to send is gone.
    expect(row.sends).toHaveLength(1);
    expect(row.sends[0].nonce).toBe(`seed-${TARGET}-${PURPOSE}-0`);
  });

  /**
   * ⚠️ The two tests around this one exercise the `$pull` shape. This one
   * exercises **`sendOtp` itself**, because that is where the bug lived — the
   * shape being right somewhere else would not have saved it.
   *
   * Mutation to re-prove: put `{ $pull: { sends: claim.at } }` back in
   * `services/otps/sendOtp.js` and this goes red, because the failed send then
   * pulls the entry seeded a moment earlier in the same millisecond window
   * rather than its own.
   */
  it("the real send path releases its own slot and nobody else's", async () => {
    const OTHER = "919999900077";
    mockSendTemplate = jest.fn(async () => {
      throw new Error("whatsapp template pulled");
    });

    /**
     * An earlier entry on the same target, five minutes back — outside the
     * 60-second cooldown so `sendOtp`'s own claim is allowed, inside the hour
     * so it is still in the window and can be wrongly pulled.
     */
    await seedSends([5], OTHER, PURPOSE);

    // `sendOtp` claims, the provider fails, and it gives its own slot back.
    await expect(sendOtp(LOGIN_TYPES.WHATSAPP, OTHER, PURPOSE)).rejects.toThrow(
      "whatsapp template pulled",
    );

    const row = await OtpThrottle.findOne({ target: OTHER }).lean();
    // The earlier entry survives; only the failed send's own is gone.
    expect(row.sends).toHaveLength(1);
    expect(row.sends[0].nonce).toBe(`seed-${OTHER}-${PURPOSE}-0`);
  });

  it("cannot take back an entry it did not claim", async () => {
    const winner = await claimOtpSend(TARGET, PURPOSE);
    const loser = await claimOtpSend(TARGET, PURPOSE);

    expect(winner.allowed).toBe(true);
    // Refused by the cooldown, so it holds no slot and has no nonce to pull.
    expect(loser.allowed).toBe(false);
    expect(loser.nonce).toBeUndefined();

    await release(TARGET, PURPOSE, loser);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    expect(row.sends).toHaveLength(1);
    expect(row.sends[0].nonce).toBe(winner.nonce);
  });
});

/**
 * Entries written before O-1 are bare `Date`s. They are dropped rather than
 * read, and the reason is worth pinning: a mixed array would be counted by
 * `$size` but ignored by the `$max` over mapped `at`s, so the hourly cap and
 * the cooldown would disagree about the very same row.
 */
describe("rows left over from the old shape", () => {
  it("drops them instead of half-counting them", async () => {
    await OtpThrottle.collection.insertOne({
      target: TARGET,
      purpose: PURPOSE,
      sends: [agoMinutes(1), agoMinutes(2)],
      updatedAt: new Date(),
    });

    // A bare-date row one minute old would otherwise refuse this on cooldown.
    const claim = await claimOtpSend(TARGET, PURPOSE);
    expect(claim.allowed).toBe(true);

    const row = await OtpThrottle.findOne({ target: TARGET }).lean();
    expect(row.sends).toHaveLength(1);
    expect(row.sends[0].nonce).toBe(claim.nonce);
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
