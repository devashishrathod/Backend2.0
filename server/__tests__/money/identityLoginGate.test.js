const mockSendOtp = jest.fn(async () => ({ success: true }));
const mockSendOtpToMobile = jest.fn(async () => ({ Details: "session-1" }));

jest.mock("../../services/otps", () => ({
  sendOtp: (...args) => mockSendOtp(...args),
  verifyOtp: jest.fn(),
}));
/**
 * ⚠️ `sendThrottledMobileOtp`, not `sendOtpToMobile`.
 *
 * `loginWithMobileOTP` calls the throttled wrapper now — the raw 2factor call had
 * no rate limit, on a public route. A mock that still exports only the old name
 * fails with `sendThrottledMobileOtp is not a function`, which reads as a
 * production bug and is not one: it is this file having gone stale.
 */
jest.mock("../../helpers/twoFactor", () => ({
  sendThrottledMobileOtp: (...args) => mockSendOtpToMobile(...args),
  sendOtpToMobile: (...args) => mockSendOtpToMobile(...args),
  verifyOtpToMobile: jest.fn(),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const User = require("../../models/User");
const Customer = require("../../models/Customer");
const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");

const { loginWithEmailOTP } = require("../../services/auth/loginWithEmailOTP");
const { loginWithMobileOTP } = require("../../services/auth/loginWithMobileOTP");
const { applyIdentityChange } = require("../../helpers/users");
const { ROLES } = require("../../constants");
const { generateBrandMerchantId } = require("../../helpers/brands");
const { generateSubBrandStoreId } = require("../../helpers/subBrands");

/**
 * ---------------- an unverified key is not a way in ----------------
 *
 * `login-with-email` and `login-with-mobile` find an account **by** a contact key
 * and send a one-time code **to** that key. So whoever can write the key can read
 * the code — and writing is deliberately not restricted to the account holder: an
 * admin may set anybody's, a vendor may set their own outlet managers'.
 *
 * The takeover that opens up is concrete, and the last test here walks it
 * end-to-end: a vendor points their outlet manager's email at an address they
 * control, then signs in as that manager. The only thing standing in the way is
 * that the write lands unverified and an unverified key cannot be signed in with.
 */

const COLLECTIONS = [User, Customer, Brand, SubBrand];

let seq = 0;
/**
 * ⚠️ Unique per **run**, not per file.
 *
 * `users` carries a partial unique index on `{ whatsappNumber, role }` and on
 * `{ mobile, role }`. A fixed prefix like `98` + a per-file counter collides with
 * any other suite that does the same — and several do — so the insert fails with
 * a duplicate key on a field the test is not about.
 *
 * That failure is invisible when a file runs alone and appears only in a full
 * run, which reads as flakiness and sends you looking in the wrong place. Five
 * digits of the clock make the prefix unique to this process.
 */
const RUN = String(Date.now()).slice(-5);
const nextPhone = () => {
  seq += 1;
  return `9${RUN}${String(seq).padStart(4, "0")}`;
};

const makeUser = async (overrides = {}) => {
  seq += 1;
  return User.create({
    uniqueId: `USR-${Date.now()}-${seq}`,
    referralCode: `REF-${Date.now()}-${seq}`,
    role: ROLES.VENDOR,
    whatsappNumber: nextPhone(),
    ...overrides,
  });
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  mockSendOtp.mockClear();
  mockSendOtpToMobile.mockClear();
});

describe("login by email", () => {
  it("refuses an address that has never been verified", async () => {
    await makeUser({ email: "unverified@example.com", isEmailVerified: false });

    await expect(
      loginWithEmailOTP({ email: "unverified@example.com", role: ROLES.VENDOR }),
    ).rejects.toMatchObject({
      statusCode: 403,
      // ⚠️ `data`, not `details`. `throwError`'s third argument lands on
      // `err.data`; `errorHandler` is what renames it to `details` in the HTTP
      // envelope. Asserting the response field name here passes trivially —
      // `toMatchObject` ignores a key the object does not have.
      data: { code: "IDENTITY_NOT_VERIFIED" },
    });

    // ⚠️ And no code was sent. Refusing after the send would still cost a real
    // email to an address we have no reason to trust.
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("allows one that has", async () => {
    await makeUser({ email: "verified@example.com", isEmailVerified: true });

    await loginWithEmailOTP({ email: "verified@example.com", role: ROLES.VENDOR });
    expect(mockSendOtp).toHaveBeenCalledTimes(1);
  });

  it("still 404s for an address nobody holds, before the gate", async () => {
    // The gate must not turn "no such account" into "not verified" — that would
    // tell a stranger which addresses are registered.
    await expect(
      loginWithEmailOTP({ email: "nobody@example.com", role: ROLES.VENDOR }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("login by mobile", () => {
  it("refuses a number that has never been verified", async () => {
    const mobile = nextPhone();
    await makeUser({ mobile, isMobileVerified: false, role: ROLES.ADMIN });

    await expect(
      loginWithMobileOTP({ mobile, role: ROLES.ADMIN }),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: "IDENTITY_NOT_VERIFIED" },
    });
    expect(mockSendOtpToMobile).not.toHaveBeenCalled();
  });

  it("allows one that has", async () => {
    const mobile = nextPhone();
    await makeUser({ mobile, isMobileVerified: true, role: ROLES.ADMIN });

    await loginWithMobileOTP({ mobile, role: ROLES.ADMIN });
    expect(mockSendOtpToMobile).toHaveBeenCalledTimes(1);
  });
});

describe("the takeover this closes", () => {
  it("a vendor cannot sign in as their own outlet manager by rewriting the email", async () => {
    seq += 1;
    const vendor = await makeUser({ role: ROLES.VENDOR });
    const brand = await Brand.create({
      userId: vendor._id,
      uniqueId: `BRD-${Date.now()}-${seq}`,
      merchantId: await generateBrandMerchantId(),
    });
    const manager = await makeUser({ role: ROLES.SUB_VENDOR });
    await SubBrand.create({
      userId: manager._id,
      brandId: brand._id,
      uniqueId: `SUB-${Date.now()}-${seq}`,
      storeId: await generateSubBrandStoreId(),
    });

    // Step 1 — the vendor points the manager's account at an address they own.
    // This is **allowed**: it is their staff account, and `canWriteIdentity`
    // lets a vendor write their own outlet managers'.
    await applyIdentityChange(
      manager,
      { email: "vendor-controls-this@example.com" },
      { verified: false },
    );

    const after = await User.findById(manager._id).lean();
    expect(after.email).toBe("vendor-controls-this@example.com");
    // Step 2 — but it landed unverified, which is the whole defence.
    expect(after.isEmailVerified).toBe(false);

    // Step 3 — so the login they were reaching for is refused, and no code is
    // sent to the inbox they control.
    await expect(
      loginWithEmailOTP({
        email: "vendor-controls-this@example.com",
        role: ROLES.SUB_VENDOR,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      data: { code: "IDENTITY_NOT_VERIFIED" },
    });
    expect(mockSendOtp).not.toHaveBeenCalled();
  });
});
