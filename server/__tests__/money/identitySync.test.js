const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const User = require("../../models/User");
const Customer = require("../../models/Customer");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");

const {
  applyIdentityChange,
  syncRoleProfileIdentity,
  assertCanWriteIdentity,
} = require("../../helpers/users");
const { ROLES } = require("../../constants");
// The real generators: `merchantId` and `storeId` are validated against a
// charset that comes from the environment, so a hand-written placeholder fails
// on some runs and passes on others depending on the digits it happens to use.
const { generateBrandMerchantId } = require("../../helpers/brands");
const { generateSubBrandStoreId } = require("../../helpers/subBrands");

/**
 * ---------------- the identity mirror ----------------
 *
 * `email`, `mobile` and `whatsappNumber` exist twice: on the account, and on that
 * account's role profile. Three things have to hold, and none of them can be
 * checked by clicking:
 *
 *  1. the two copies agree after **any** write, from either direction;
 *  2. a verified flag turns `true` **only** through a write that carried an OTP;
 *  3. `whatsappNumber` cannot be moved by a write that did not.
 *
 * The cost of getting these wrong is not a wrong-looking screen. A stale
 * `Customer.whatsappNumber` is where `sendBankOtp` delivers the code that gates
 * attaching a bank account, so drift there sends a refund's one-time code to
 * whoever holds the customer's old number.
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

const makeCustomer = async (overrides = {}) => {
  const phone = nextPhone();
  const user = await User.create({
    uniqueId: `USR-${Date.now()}-${seq}`,
    referralCode: `REF-${Date.now()}-${seq}`,
    name: "test customer",
    whatsappNumber: phone,
    role: ROLES.CUSTOMER,
    ...overrides,
  });
  const customer = await Customer.create({
    userId: user._id,
    uniqueId: `CUS-${Date.now()}-${seq}`,
    whatsappNumber: phone,
  });
  user.customerId = customer._id;
  await user.save();
  return { user, customer, phone };
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);
// Variadic, not an array — see setup/testDb.js.
beforeEach(() => clearCollections(...COLLECTIONS));

describe("a plain write lands unverified, on both copies", () => {
  it("writes the account and the mirror in one call", async () => {
    const { user, customer } = await makeCustomer();

    const result = await applyIdentityChange(
      user,
      { email: "  NEW@Example.COM " },
      { verified: false },
    );

    expect(result.changed).toEqual(["email"]);
    expect(result.profileSynced).toBe(true);

    const account = await User.findById(user._id).lean();
    const profile = await Customer.findById(customer._id).lean();

    // Normalised on the way in, and the same string in both places.
    expect(account.email).toBe("new@example.com");
    expect(profile.email).toBe("new@example.com");
    expect(account.isEmailVerified).toBe(false);
  });

  it("switches that channel's notifications off", async () => {
    const { user } = await makeCustomer({
      email: "old@example.com",
      isEmailVerified: true,
      notificationPreferences: { email: true, push: true, whatsapp: true },
    });

    await applyIdentityChange(user, { email: "new@example.com" }, { verified: false });

    const account = await User.findById(user._id).lean();
    expect(account.isEmailVerified).toBe(false);
    /**
     * ⚠️ The preference, not just the flag.
     *
     * The delivery guard already refuses an unverified channel, so leaving this
     * `true` would send nothing wrong — it would do something subtler: the moment
     * they verified, email would resume without them asking, because a `true`
     * from before the change was still sitting there.
     */
    expect(account.notificationPreferences.email).toBe(false);
    // The other channels are none of this key's business.
    expect(account.notificationPreferences.push).toBe(true);
    expect(account.notificationPreferences.whatsapp).toBe(true);
  });

  it("leaves the preference alone when the write carried an OTP", async () => {
    const { user } = await makeCustomer({
      notificationPreferences: { email: false, push: true, whatsapp: true },
    });

    await applyIdentityChange(user, { email: "a@b.com" }, { verified: true });

    const account = await User.findById(user._id).lean();
    expect(account.isEmailVerified).toBe(true);
    // Verifying proves ownership. It is not a request to be emailed, so it must
    // not switch the toggle back on for somebody who turned it off.
    expect(account.notificationPreferences.email).toBe(false);
  });
});

describe("only an OTP turns a flag on", () => {
  // ⚠️ Computed, not literal — see the note on `nextPhone`. `it.each` evaluates
  // its table when the file loads, so these are taken once, up here.
  const PHONE_A = nextPhone();
  const PHONE_B = nextPhone();
  it.each([
    ["email", "someone@example.com", "isEmailVerified"],
    ["mobile", PHONE_A, "isMobileVerified"],
  ])("%s: verified:false leaves the flag false", async (key, value, flag) => {
    const { user } = await makeCustomer();

    await applyIdentityChange(user, { [key]: value }, { verified: false });
    expect((await User.findById(user._id).lean())[flag]).toBe(false);
  });

  it.each([
    ["email", "someone@example.com", "isEmailVerified"],
    ["mobile", PHONE_B, "isMobileVerified"],
  ])("%s: verified:true sets it", async (key, value, flag) => {
    const { user } = await makeCustomer();

    await applyIdentityChange(user, { [key]: value }, { verified: true });
    expect((await User.findById(user._id).lean())[flag]).toBe(true);
  });
});

describe("whatsappNumber cannot be moved without verifying it", () => {
  it("refuses a plain write", async () => {
    const { user, phone } = await makeCustomer();

    await expect(
      applyIdentityChange(user, { whatsappNumber: nextPhone() }, { verified: false }),
    ).rejects.toMatchObject({ statusCode: 422 });

    // And nothing moved.
    expect((await User.findById(user._id).lean()).whatsappNumber).toBe(phone);
  });

  it("allows it when the caller says the OTP was checked", async () => {
    const { user, customer } = await makeCustomer();
    const moved = nextPhone();

    await applyIdentityChange(
      user,
      // Deliberately in a spelling the setter has to normalise.
      { whatsappNumber: `+91 ${moved.slice(0, 5)}-${moved.slice(5)}` },
      { verified: true, allowWhatsapp: true },
    );

    const account = await User.findById(user._id).lean();
    const profile = await Customer.findById(customer._id).lean();
    expect(account.whatsappNumber).toBe(moved);
    expect(profile.whatsappNumber).toBe(moved);
    expect(account.isWhatsappVerified).toBe(true);
  });

  it("does not refuse when the number sent is the one already on file", async () => {
    const { user, phone } = await makeCustomer();

    // A caller echoing back the current value is not asking for a change, so it
    // must not trip the guard — otherwise every profile save that includes the
    // number would 422.
    const result = await applyIdentityChange(
      user,
      { whatsappNumber: `+91${phone}` },
      { verified: false },
    );
    expect(result.changed).toEqual([]);
  });
});

describe("the mirror repairs drift it did not cause", () => {
  it("heals a profile that went stale before any of this existed", async () => {
    const { user, customer } = await makeCustomer({ email: "current@example.com" });

    // Exactly the shape the old code left behind: the account moved on, the
    // profile kept whatever signup wrote.
    await Customer.collection.updateOne(
      { _id: customer._id },
      { $set: { email: "stale@example.com", whatsappNumber: nextPhone() } },
    );

    const synced = await syncRoleProfileIdentity(await User.findById(user._id));
    expect(synced).toBe(true);

    const profile = await Customer.findById(customer._id).lean();
    expect(profile.email).toBe("current@example.com");
    expect(profile.whatsappNumber).toBe(user.whatsappNumber);
  });

  it("repairs every key, not only the one being changed", async () => {
    const { user, customer } = await makeCustomer({ email: "current@example.com" });

    await Customer.collection.updateOne(
      { _id: customer._id },
      { $set: { whatsappNumber: nextPhone() } },
    );

    // Change the email — the phone is untouched by this call, and must still be
    // corrected, or a key nothing ever writes again stays wrong for ever.
    await applyIdentityChange(user, { email: "newer@example.com" }, { verified: true });

    const profile = await Customer.findById(customer._id).lean();
    expect(profile.email).toBe("newer@example.com");
    expect(profile.whatsappNumber).toBe(user.whatsappNumber);
  });

  it("is a no-op for an ADMIN, who has no profile", async () => {
    const phone = nextPhone();
    const admin = await User.create({
      uniqueId: `USR-A-${Date.now()}`,
      referralCode: `REF-A-${Date.now()}`,
      role: ROLES.ADMIN,
      whatsappNumber: phone,
    });

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await syncRoleProfileIdentity(admin)).toBe(false);
    // Silently, though — an admin having no profile is normal, not a fault, and
    // logging it would put a line in production for every admin sign-in.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    const result = await applyIdentityChange(
      admin,
      { email: "admin@example.com" },
      { verified: true },
    );
    expect(result.changed).toEqual(["email"]);
    expect(result.profileSynced).toBe(false);
    expect((await User.findById(admin._id).lean()).email).toBe("admin@example.com");
  });
});

describe("who may write whose identity", () => {
  const makeVendorWithOutlet = async () => {
    seq += 1;
    const vendor = await User.create({
      uniqueId: `USR-V-${Date.now()}-${seq}`,
      referralCode: `REF-V-${Date.now()}-${seq}`,
      role: ROLES.VENDOR,
      whatsappNumber: nextPhone(),
    });
    const brand = await Brand.create({
      userId: vendor._id,
      uniqueId: `BRD-${Date.now()}-${seq}`,
      merchantId: await generateBrandMerchantId(),
    });
    const manager = await User.create({
      uniqueId: `USR-S-${Date.now()}-${seq}`,
      referralCode: `REF-S-${Date.now()}-${seq}`,
      role: ROLES.SUB_VENDOR,
      whatsappNumber: nextPhone(),
    });
    await SubBrand.create({
      userId: manager._id,
      brandId: brand._id,
      uniqueId: `SUB-${Date.now()}-${seq}`,
      storeId: await generateSubBrandStoreId(),
    });
    return { vendor, brand, manager };
  };

  it("anybody may write their own", async () => {
    const { user } = await makeCustomer();
    await expect(
      assertCanWriteIdentity({ userId: user._id, role: ROLES.CUSTOMER }, user),
    ).resolves.toBeUndefined();
  });

  it("an admin may write anybody's", async () => {
    const { user } = await makeCustomer();
    await expect(
      assertCanWriteIdentity({ userId: new mongoose.Types.ObjectId(), role: ROLES.ADMIN }, user),
    ).resolves.toBeUndefined();
  });

  it("a vendor may write their own outlet manager's", async () => {
    const { vendor, manager } = await makeVendorWithOutlet();
    await expect(
      assertCanWriteIdentity({ userId: vendor._id, role: ROLES.VENDOR }, manager),
    ).resolves.toBeUndefined();
  });

  it("a vendor may NOT write another vendor's outlet manager's", async () => {
    const { manager } = await makeVendorWithOutlet();
    const { vendor: otherVendor } = await makeVendorWithOutlet();

    await expect(
      assertCanWriteIdentity({ userId: otherVendor._id, role: ROLES.VENDOR }, manager),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a customer may NOT write another customer's", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();

    await expect(
      assertCanWriteIdentity({ userId: a.user._id, role: ROLES.CUSTOMER }, b.user),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
