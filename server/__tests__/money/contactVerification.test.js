const mockSendOtp = jest.fn(async () => ({ success: true }));
const mockVerifyOtp = jest.fn(async () => ({ ok: true }));
const mockSendThrottledMobileOtp = jest.fn(async () => ({ Details: "session-1" }));
const mockVerifyOtpToMobile = jest.fn(async () => ({ Status: "Success" }));

jest.mock("../../services/otps", () => ({
  sendOtp: (...args) => mockSendOtp(...args),
  verifyOtp: (...args) => mockVerifyOtp(...args),
}));
jest.mock("../../helpers/twoFactor", () => ({
  sendThrottledMobileOtp: (...args) => mockSendThrottledMobileOtp(...args),
  verifyOtpToMobile: (...args) => mockVerifyOtpToMobile(...args),
  sendOtpToMobile: jest.fn(),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const User = require("../../models/User");
const Customer = require("../../models/Customer");

const {
  sendMobileVerification,
  verifyMobile,
  sendWhatsappVerification,
  verifyWhatsapp,
} = require("../../services/auth");
const { ROLES } = require("../../constants");
const {
  WHATSAPP_VERIFY_OTP_PURPOSE,
  WHATSAPP_CHANGE_CURRENT_OTP_PURPOSE,
} = require("../../constants/otp");

/**
 * ---------------- confirming a phone number ----------------
 *
 * The two rules that cannot be checked by clicking:
 *
 *  1. **the code goes to the value being claimed**, never the one on file — and
 *     for a WhatsApp *change*, the old number first;
 *  2. **nothing moves until the code is presented.** A send must leave the
 *     account exactly as it was.
 *
 * The step-up is the reason this file exists. `whatsappNumber` is the login
 * identity for every non-admin role, so a change confirmed only on the *new*
 * number lets anyone holding a stolen session move the account onto their own
 * phone, permanently. That is one `if` in the service, and nothing else would
 * notice if it were removed.
 */

const COLLECTIONS = [User, Customer];

let seq = 0;
// Unique per run — see the note in identitySync.test.js.
const RUN = String(Date.now()).slice(-5);
const nextPhone = () => {
  seq += 1;
  return `9${RUN}${String(seq).padStart(4, "0")}`;
};

const makeCustomer = async (overrides = {}) => {
  const phone = nextPhone();
  const user = await User.create({
    uniqueId: `USR-${Date.now()}-${seq}`,
    referralCode: `REF-${Date.now()}-${seq}`,
    whatsappNumber: phone,
    role: ROLES.CUSTOMER,
    ...overrides,
  });
  const customer = await Customer.create({
    userId: user._id,
    uniqueId: `CUS-${Date.now()}-${seq}`,
    whatsappNumber: user.whatsappNumber,
  });
  user.customerId = customer._id;
  await user.save();
  return { user, customer, phone: user.whatsappNumber };
};

const actorFor = (user) => ({ userId: user._id, role: user.role });

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  mockSendOtp.mockClear();
  mockVerifyOtp.mockClear();
  mockSendThrottledMobileOtp.mockClear();
  mockVerifyOtpToMobile.mockClear();
});

describe("mobile", () => {
  it("sends to the number being claimed, not the one on file", async () => {
    const target = nextPhone();
    const { user } = await makeCustomer({ mobile: nextPhone() });

    const result = await sendMobileVerification(actorFor(user), { mobile: target });

    expect(mockSendThrottledMobileOtp).toHaveBeenCalledWith(target, expect.any(String));
    expect(result.isChange).toBe(true);
    // Masked — this is reachable with a stolen session, and the full number
    // would be new information to whoever holds it.
    expect(result.sentTo).toContain("*");
    expect(result.sessionId).toBe("session-1");
  });

  it("changes nothing until the code is presented", async () => {
    const before = nextPhone();
    const { user } = await makeCustomer({ mobile: before });

    await sendMobileVerification(actorFor(user), { mobile: nextPhone() });

    const account = await User.findById(user._id).lean();
    expect(account.mobile).toBe(before);
    expect(account.isMobileVerified).toBeFalsy();
  });

  it("writes the number, the flag and the mirror on verify", async () => {
    const target = nextPhone();
    const { user, customer } = await makeCustomer();

    const result = await verifyMobile(actorFor(user), {
      mobile: target,
      otp: "123456",
      sessionId: "session-1",
    });

    expect(result.step).toBe("DONE");
    const account = await User.findById(user._id).lean();
    const profile = await Customer.findById(customer._id).lean();
    expect(account.mobile).toBe(target);
    expect(account.isMobileVerified).toBe(true);
    expect(profile.mobile).toBe(target);
  });

  it("refuses without a sessionId — 2factor holds the code", async () => {
    const { user } = await makeCustomer();

    await expect(
      verifyMobile(actorFor(user), { mobile: nextPhone(), otp: "123456" }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("normalises, so confirming the number you have is not read as a change", async () => {
    const phone = nextPhone();
    const { user } = await makeCustomer({ mobile: phone, isMobileVerified: false });

    const result = await sendMobileVerification(actorFor(user), {
      mobile: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    });

    expect(result.isChange).toBe(false);
  });
});

describe("whatsappNumber — the step-up", () => {
  it("sends the first code to the CURRENT number when replacing a verified one", async () => {
    const { user, phone } = await makeCustomer({ isWhatsappVerified: true });
    const target = nextPhone();

    const result = await sendWhatsappVerification(actorFor(user), {
      whatsappNumber: target,
    });

    expect(result.step).toBe("CONFIRM_CURRENT");
    /**
     * ⚠️ The whole point. The code goes to the number they **already have** —
     * proving they still hold it — before the new number is sent anything.
     * Without this, a stolen session moves the account onto the thief's phone.
     */
    const [sentType, sentTo, purpose] = mockSendOtp.mock.calls[0];
    expect(sentTo).toBe(phone);
    expect(sentTo).not.toBe(target);
    expect(purpose).toBe(WHATSAPP_CHANGE_CURRENT_OTP_PURPOSE);
  });

  it("does NOT step up when the number on file was never verified", async () => {
    const { user } = await makeCustomer({ isWhatsappVerified: false });
    const target = nextPhone();

    const result = await sendWhatsappVerification(actorFor(user), {
      whatsappNumber: target,
    });

    // Nothing to step up from — demanding a code on an unconfirmed number would
    // ask the user to prove something the account never claimed.
    expect(result.step).toBe("CONFIRM_NEW");
    expect(mockSendOtp.mock.calls[0][1]).toBe(target);
  });

  it("the old number's code only unlocks the send — it does not write", async () => {
    const { user, phone } = await makeCustomer({ isWhatsappVerified: true });
    const target = nextPhone();

    const result = await verifyWhatsapp(actorFor(user), {
      whatsappNumber: target,
      otp: "111111",
    });

    expect(result.step).toBe("CONFIRM_NEW");
    expect(result.wasChange).toBe(false);

    // Still the old number, and still verified — nothing moved.
    const account = await User.findById(user._id).lean();
    expect(account.whatsappNumber).toBe(phone);
    expect(account.isWhatsappVerified).toBe(true);

    // And the second code went to the new number, with the other purpose.
    const last = mockSendOtp.mock.calls.at(-1);
    expect(last[1]).toBe(target);
    expect(last[2]).toBe(WHATSAPP_VERIFY_OTP_PURPOSE);
  });

  it("writes on the second code, and ends every other session", async () => {
    const { user, customer } = await makeCustomer({ isWhatsappVerified: false });
    const target = nextPhone();

    const result = await verifyWhatsapp(actorFor(user), {
      whatsappNumber: target,
      otp: "222222",
    });

    expect(result.step).toBe("DONE");
    expect(result.wasChange).toBe(true);
    expect(result.sessionsEnded).toBe(true);

    const account = await User.findById(user._id).lean();
    const profile = await Customer.findById(customer._id).lean();
    expect(account.whatsappNumber).toBe(target);
    expect(account.isWhatsappVerified).toBe(true);
    expect(profile.whatsappNumber).toBe(target);
    /**
     * ⚠️ Every token issued before now is dead. If the change came from a stolen
     * session, the thief's token dies with it — and the real owner, who still
     * holds the old number, can come back.
     */
    expect(account.sessionInvalidatedAt).toBeTruthy();
  });

  it("refuses to re-verify a number that is already confirmed", async () => {
    const { user } = await makeCustomer({ isWhatsappVerified: true });

    await expect(
      sendWhatsappVerification(actorFor(user), {}),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("refuses a number already on another account of the same role", async () => {
    const other = await makeCustomer();
    const { user } = await makeCustomer({ isWhatsappVerified: false });

    await expect(
      sendWhatsappVerification(actorFor(user), { whatsappNumber: other.phone }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockSendOtp).not.toHaveBeenCalled();
  });
});
