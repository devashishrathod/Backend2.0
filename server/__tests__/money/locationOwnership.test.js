/**
 * Locations — who may write one, and what it links to.
 *
 * ### 🔴 Why this file exists
 *
 * One `Location` model serves three different things: a customer's home
 * address, a brand's registered address, and an outlet's. Three of the five
 * write paths asked only for an id:
 *
 *  - `updateLocation(userId, payload)` took a `userId` and never read it
 *  - `deleteLocation(payload)` did not take one at all
 *  - `getAllLocations(query)` had no actor, and every filter was optional — so
 *    one request with none returned **every address on the platform**, home
 *    addresses and their coordinates included, a page at a time
 *
 * The customer case is the one that bites hardest: the voucher feed is built
 * from that address, so rewriting or removing it silently changes, or breaks,
 * what somebody else is shown.
 *
 * ⚠️ Real database. Ownership is read back off the `Brand` and `SubBrand`
 * documents rather than trusted from the token, the writes run inside
 * transactions that also move `Brand.locationId` / `SubBrand.locationId` /
 * `Customer.locationId`, and the outlet's own `geo` — the field the customer's
 * nearest search actually reads — is kept in step with the address. Mocking any
 * of that would assert the shape of a call instead of what Mongo did with it.
 */

/**
 * ⚠️ Delegates to the real helper by default — every other test here depends on
 * the outlet's position actually moving. It exists so one test can make the
 * sync **fail**, which is the only way to tell an awaited call from an
 * unawaited one: without `await` the rejection escapes as an unhandled promise
 * and the request still answers 200.
 *
 * A mock rather than a spy because the service destructures the function at
 * require time, so replacing it on the barrel afterwards would never be seen.
 */
jest.mock("../../helpers/subBrands", () => {
  const actual = jest.requireActual("../../helpers/subBrands");
  return {
    ...actual,
    syncSubBrandLocAndGeo: jest.fn((...args) =>
      actual.syncSubBrandLocAndGeo(...args),
    ),
  };
});

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Location = require("../../models/Location");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const User = require("../../models/User");
const Customer = require("../../models/Customer");
const { ROLES } = require("../../constants");
const { LOCATION_KINDS } = require("../../constants/location");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const { syncSubBrandLocAndGeo } = require("../../helpers/subBrands");
const {
  validateVoucherSubBrands,
} = require("../../helpers/vouchers/validate");
const {
  createLocation,
  updateLocation,
  deleteLocation,
  getAllLocations,
} = require("../../services/locations");
const {
  getAllCustomerBrands,
} = require("../../services/brands/getAllCustomerBrands");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const unique = () => `${Date.now()}${++seq}`;

const INDORE = [75.857, 22.7196];
const BHOPAL = [77.4126, 23.2599];

const seedUser = (role) => {
  const phone = `97${String(10000000 + (seq += 1)).slice(-8)}`;
  return User.create({
    uniqueId: `USR-${unique()}`,
    referralCode: `REF-${unique()}`,
    name: "fixture person",
    email: `person${unique()}@example.test`,
    mobile: phone,
    whatsappNumber: phone,
    role,
    isActive: true,
  });
};

const seedBrand = async (ownerUserId) =>
  Brand.create({
    brandName: "fixture brand",
    uniqueId: `TDB${unique()}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

const seedOutlet = async (brandId, outletUserId) =>
  SubBrand.create({
    userId: outletUserId,
    brandId,
    uniqueId: `TDS${unique()}`,
    storeId: await generateSubBrandStoreId(),
  });

const seedCustomer = async () => {
  const user = await seedUser(ROLES.CUSTOMER);
  const customer = await Customer.create({
    userId: user._id,
    uniqueId: `TDC${unique()}`,
  });
  await User.updateOne({ _id: user._id }, { $set: { customerId: customer._id } });
  user.customerId = customer._id;
  return { user, customer };
};

const address = (overrides = {}) => ({
  addressLine1: "12 fixture street",
  city: "Indore",
  state: "Madhya Pradesh",
  zipcode: "452010",
  country: "india",
  coordinates: INDORE,
  ...overrides,
});

const vendorActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});
const adminActor = (userId = oid()) => ({ userId, role: ROLES.ADMIN });
const customerActor = (userId) => ({ userId, role: ROLES.CUSTOMER });

let OWNER;
let BRAND;
let OUTLET_USER;
let OUTLET;
let OTHER_OWNER;
let OTHER_BRAND;
let OTHER_OUTLET;
let CUSTOMER_USER;
let CUSTOMER_ROW;

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Location, Brand, SubBrand, User, Customer);

  OWNER = await seedUser(ROLES.VENDOR);
  BRAND = await seedBrand(OWNER._id);
  OUTLET_USER = await seedUser(ROLES.SUB_VENDOR);
  OUTLET = await seedOutlet(BRAND._id, OUTLET_USER._id);

  OTHER_OWNER = await seedUser(ROLES.VENDOR);
  OTHER_BRAND = await seedBrand(OTHER_OWNER._id);
  OTHER_OUTLET = await seedOutlet(OTHER_BRAND._id, (await seedUser(ROLES.SUB_VENDOR))._id);

  const seeded = await seedCustomer();
  CUSTOMER_USER = seeded.user;
  CUSTOMER_ROW = seeded.customer;
});

describe("who may create a location", () => {
  it("refuses a vendor naming someone else's brand", async () => {
    await expect(
      createLocation(
        vendorActor(OTHER_OWNER._id, OTHER_BRAND._id),
        address({ isBrandAddress: true, brandId: BRAND._id.toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(await Location.countDocuments({ brandId: BRAND._id })).toBe(0);
  });

  it("refuses a vendor naming someone else's outlet", async () => {
    await expect(
      createLocation(
        vendorActor(OTHER_OWNER._id, OTHER_BRAND._id),
        address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(await Location.countDocuments({ subBrandId: OUTLET._id })).toBe(0);
  });

  /**
   * Everything identifying is read off the outlet, not taken from the request —
   * including the brand, which is what makes "every address under this brand" a
   * single indexed query and what scopes a vendor's own list.
   */
  it("fills ownership from the outlet, and records who typed it", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    expect(created.kind).toBe(LOCATION_KINDS.SUB_BRAND);
    expect(String(created.userId)).toBe(String(OUTLET_USER._id));
    expect(String(created.brandId)).toBe(String(BRAND._id));
    expect(String(created.subBrandId)).toBe(String(OUTLET._id));
    // Whose address it is, versus who wrote it down.
    expect(String(created.createdBy)).toBe(String(OWNER._id));
    // The legacy flags are a projection of `kind`, never set by hand.
    expect(created.isSubBrandAddress).toBe(true);
    expect(created.isBrandAddress).toBe(false);
  });

  it("points the outlet at the address and copies its position", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    const outlet = await SubBrand.findById(OUTLET._id);
    expect(String(outlet.locationId)).toBe(String(created._id));
    // `SubBrand.geo` — not `Location.geo` — is what the customer's nearest
    // search reads.
    expect(outlet.geo.coordinates).toEqual(INDORE);
  });

  it("lets a vendor create their brand's own address", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isBrandAddress: true, brandId: BRAND._id.toString() }),
    );

    expect(created.kind).toBe(LOCATION_KINDS.BRAND);
    expect(String(created.userId)).toBe(String(OWNER._id));
    expect(String((await Brand.findById(BRAND._id)).locationId)).toBe(
      String(created._id),
    );
  });

  it("lets an admin create on any brand, and is recorded as the actor", async () => {
    const admin = adminActor();
    const created = await createLocation(
      admin,
      address({ isBrandAddress: true, brandId: BRAND._id.toString() }),
    );

    // The address still belongs to the brand's owner…
    expect(String(created.userId)).toBe(String(OWNER._id));
    // …and the admin is recorded separately.
    expect(String(created.createdBy)).toBe(String(admin.userId));
  });

  it("lets an admin create a customer's address", async () => {
    const admin = adminActor();
    const created = await createLocation(
      admin,
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    expect(created.kind).toBe(LOCATION_KINDS.CUSTOMER);
    expect(String(created.userId)).toBe(String(CUSTOMER_USER._id));
    expect(String(created.customerId)).toBe(String(CUSTOMER_ROW._id));
    expect(String(created.createdBy)).toBe(String(admin.userId));
    expect(String((await Customer.findById(CUSTOMER_ROW._id)).locationId)).toBe(
      String(created._id),
    );
  });

  it("refuses an admin who does not say whose customer address it is", async () => {
    await expect(createLocation(adminActor(), address())).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  /**
   * ⚠️ `Location.create()` used to run **before** the brand was looked up, so a
   * wrong id answered 404 with the row already written — a document nothing
   * referenced and nothing would clean up.
   */
  /**
   * ⚠️ A duplicate is a rule, not a crash. The raw `E11000` would reach the
   * error handler as a 500 and tell a vendor the server broke, when what they
   * need to know is that the old address has to go first — `kind` is immutable,
   * so replacing is the only way to change what an address belongs to.
   */
  it("refuses a second live address for the same owner with a 409", async () => {
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await expect(
      createLocation(
        vendorActor(OWNER._id, BRAND._id),
        address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(
      await Location.countDocuments({ subBrandId: OUTLET._id, isDeleted: false }),
    ).toBe(1);
  });

  /** …and deleting the old one makes room, which is the supported way round. */
  it("accepts a new address once the old one is deleted", async () => {
    const first = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );
    await deleteLocation(vendorActor(OWNER._id, BRAND._id), {
      id: first._id.toString(),
    });

    const second = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({
        isSubBrandAddress: true,
        subBrandId: OUTLET._id.toString(),
        addressLine1: "new premises",
      }),
    );

    expect(second.addressLine1).toBe("new premises");
    expect(String((await SubBrand.findById(OUTLET._id)).locationId)).toBe(
      String(second._id),
    );
  });

  it("writes nothing at all when the named brand does not exist", async () => {
    await expect(
      createLocation(
        adminActor(),
        address({ isBrandAddress: true, brandId: oid().toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await Location.countDocuments({})).toBe(0);
  });
});

describe("who may update a location", () => {
  it("refuses a vendor editing another brand's outlet address", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await expect(
      updateLocation(vendorActor(OTHER_OWNER._id, OTHER_BRAND._id), {
        id: created._id.toString(),
        addressLine1: "defaced",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect((await Location.findById(created._id)).addressLine1).toBe(
      "12 fixture street",
    );
  });

  /**
   * ⚠️ The hole that hides behind the create-time check. Resolving a customer
   * always lands on the caller's own account — on create that is the only one
   * they may write — so an existing row has to be compared against the resolved
   * owner too, or any customer could edit any other customer's address by id.
   */
  it("refuses a customer editing another customer's address", async () => {
    const created = await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );
    const intruder = await seedCustomer();

    await expect(
      updateLocation(customerActor(intruder.user._id), {
        id: created._id.toString(),
        addressLine1: "defaced",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a vendor editing a customer's address", async () => {
    const created = await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    await expect(
      updateLocation(vendorActor(OWNER._id, BRAND._id), {
        id: created._id.toString(),
        addressLine1: "defaced",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("records the actor in updatedBy and leaves createdBy alone", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isBrandAddress: true, brandId: BRAND._id.toString() }),
    );
    const admin = adminActor();

    const updated = await updateLocation(admin, {
      id: created._id.toString(),
      addressLine1: "corrected by admin",
    });

    expect(String(updated.createdBy)).toBe(String(OWNER._id));
    expect(String(updated.updatedBy)).toBe(String(admin.userId));
    // Still the brand owner's address, not the admin's.
    expect(String(updated.userId)).toBe(String(OWNER._id));
  });

  /**
   * ⚠️ Called without `await` before, so a failure went nowhere: the address
   * updated, the outlet's position did not, and the panel showed a new address
   * while every customer was still sent to the old one.
   */
  it("moves the outlet's own position with the address", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await updateLocation(vendorActor(OWNER._id, BRAND._id), {
      id: created._id.toString(),
      coordinates: BHOPAL,
    });

    expect((await SubBrand.findById(OUTLET._id)).geo.coordinates).toEqual(BHOPAL);
  });

  /**
   * ⚠️ The assertion above passes with or without the `await` — the
   * fire-and-forget call usually lands before the read, so it proves the happy
   * path and nothing about the bug. The bug is what happens when the sync
   * **fails**: unawaited, the rejection escapes as an unhandled promise and the
   * request still answers 200, leaving the panel showing a new address while
   * every customer is sent to the old one.
   *
   * Confirmed by mutation — removing the `await` survived until this was added.
   */
  it("fails the request when the outlet's position cannot be synced", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );
    syncSubBrandLocAndGeo.mockRejectedValueOnce(new Error("sync unavailable"));

    await expect(
      updateLocation(vendorActor(OWNER._id, BRAND._id), {
        id: created._id.toString(),
        coordinates: BHOPAL,
      }),
    ).rejects.toThrow("sync unavailable");

    // And the address did not move either — both writes are one transaction.
    expect((await Location.findById(created._id)).geo.coordinates).toEqual(INDORE);
  });

  it("refuses a change of type, and changes nothing", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await expect(
      updateLocation(vendorActor(OWNER._id, BRAND._id), {
        id: created._id.toString(),
        isBrandAddress: true,
        addressLine1: "renamed",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const after = await Location.findById(created._id);
    expect(after.kind).toBe(LOCATION_KINDS.SUB_BRAND);
    expect(after.addressLine1).toBe("12 fixture street");
  });

  /**
   * A panel doing a partial update echoes back one flag and omits the other.
   * Deriving a kind from the pair would read that as "both false" — CUSTOMER —
   * and refuse every such edit for a change nobody asked for.
   */
  it("allows an update that echoes back the flag it already had", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    const updated = await updateLocation(vendorActor(OWNER._id, BRAND._id), {
      id: created._id.toString(),
      isBrandAddress: false,
      addressLine1: "renamed",
    });

    expect(updated.addressLine1).toBe("renamed");
  });
});

describe("who may delete a location", () => {
  it("refuses a vendor deleting a customer's address, and keeps the link", async () => {
    const created = await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    await expect(
      deleteLocation(vendorActor(OWNER._id, BRAND._id), {
        id: created._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect((await Location.findById(created._id)).isDeleted).toBe(false);
    expect(String((await Customer.findById(CUSTOMER_ROW._id)).locationId)).toBe(
      String(created._id),
    );
  });

  /**
   * ⚠️ `geo` is removed rather than zeroed. `[0, 0]` is a point in the Gulf of
   * Guinea, and the 2dsphere index treats it as a real one — the outlet stayed
   * indexed and was scanned by every nearest search from then on.
   */
  it("clears the outlet's pointer and takes it out of the geo index", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await deleteLocation(vendorActor(OWNER._id, BRAND._id), {
      id: created._id.toString(),
    });

    const raw = await SubBrand.collection.findOne({ _id: OUTLET._id });
    expect(raw.locationId).toBeNull();
    expect(raw.geo).toBeUndefined();

    const removed = await Location.findById(created._id);
    expect(removed.isDeleted).toBe(true);
    expect(removed.isActive).toBe(false);
    expect(String(removed.updatedBy)).toBe(String(OWNER._id));
  });
});

/**
 * ⚠️ An outlet with no address must be **absent** from the geo index, not
 * sitting at `[0, 0]`.
 *
 * `geo.coordinates` used to default to `[0, 0]` — a point in the Gulf of
 * Guinea, which the 2dsphere index treats as a real one — and
 * `signUpSubBrandWithWhatsapp` never sets `geo`. So every outlet was born there
 * and stayed until somebody added an address. Nothing failed: the outlet simply
 * never matched a nearest search, and neither did any voucher attached to it.
 * The vendor saw a voucher created, approved and published that no customer was
 * ever shown, with nothing anywhere to say why.
 */
describe("an outlet with no address", () => {
  it("carries no geo field at all", async () => {
    const raw = await SubBrand.collection.findOne({ _id: OUTLET._id });
    expect(raw.geo).toBeUndefined();
  });

  it("gains one as soon as an address is created for it", async () => {
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    const raw = await SubBrand.collection.findOne({ _id: OUTLET._id });
    expect(raw.geo).toEqual({ type: "Point", coordinates: INDORE });
  });

  /**
   * The consequence, said out loud. One gate for both `createVoucher` and
   * `updateVoucher`, so a vendor is told which outlet to fix rather than
   * publishing a voucher nobody will ever see.
   */
  it("cannot have a voucher attached to it", async () => {
    await expect(
      validateVoucherSubBrands([OUTLET._id.toString()], BRAND._id),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("no address yet"),
    });
  });

  it("can once it has one", async () => {
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    const outlets = await validateVoucherSubBrands(
      [OUTLET._id.toString()],
      BRAND._id,
    );
    expect(outlets).toHaveLength(1);
    expect(outlets[0].geo.coordinates).toEqual(INDORE);
  });
});

/**
 * ⚠️ A guest browses with no token at all — `GET /brands/customer/get-all` is
 * PUBLIC and the voucher feed is `optionalAuth` — so nothing here may depend on
 * there being an account, and an outlet with no address must not break the
 * screens a guest sees.
 *
 * Verified against a real 2dsphere index rather than reasoned about: an insert
 * with **no** `geo` succeeds and `$geoNear` skips it, while a half-built
 * `{ type: "Point" }` is refused outright by the index. That is the difference
 * between the field being absent and being partly there, and it is why `geo` is
 * a sub-schema whose default is `undefined`.
 */
/**
 * An outlet manager keeps their **own** outlet's address, and nothing else.
 *
 * ⚠️ Checked against the token's `subBrandId`, not through `resolveActorBrand`.
 * A sub-vendor has no brand of their own — `authenticate` copies the brand off
 * their outlet so brand-wide reads work elsewhere — so asking "does this brand
 * belong to you" would compare a borrowed id against `Brand.userId` and refuse
 * every time. Scoping the listing on `brandId` would make the opposite mistake
 * and show them every sibling outlet.
 */
describe("an outlet manager", () => {
  const outletActor = (userId, brandId, subBrandId) => ({
    userId,
    role: ROLES.SUB_VENDOR,
    brandId,
    subBrandId,
  });

  it("can create their own outlet's address", async () => {
    const created = await createLocation(
      outletActor(OUTLET_USER._id, BRAND._id, OUTLET._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    expect(String(created.subBrandId)).toBe(String(OUTLET._id));
    // Still the outlet's address; the manager is recorded as the one who typed it.
    expect(String(created.userId)).toBe(String(OUTLET_USER._id));
    expect(String(created.createdBy)).toBe(String(OUTLET_USER._id));
  });

  it("cannot create for a sibling outlet of the same brand", async () => {
    const sibling = await seedOutlet(BRAND._id, (await seedUser(ROLES.SUB_VENDOR))._id);

    await expect(
      createLocation(
        outletActor(OUTLET_USER._id, BRAND._id, OUTLET._id),
        address({ isSubBrandAddress: true, subBrandId: sibling._id.toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("cannot create the brand's own registered address", async () => {
    await expect(
      createLocation(
        outletActor(OUTLET_USER._id, BRAND._id, OUTLET._id),
        address({ isBrandAddress: true, brandId: BRAND._id.toString() }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("sees only their own outlet in the listing", async () => {
    const sibling = await seedOutlet(BRAND._id, (await seedUser(ROLES.SUB_VENDOR))._id);
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: sibling._id.toString() }),
    );

    const result = await getAllLocations(
      outletActor(OUTLET_USER._id, BRAND._id, OUTLET._id),
      {},
    );
    const rows = result.data ?? result.result ?? result.docs ?? [];

    expect(rows).toHaveLength(1);
    expect(String(rows[0].subBrandId)).toBe(String(OUTLET._id));
  });
});

/**
 * A customer may remove their own address — and it is a bigger button than it
 * looks: their voucher feed is built from it, so once it is gone the feed
 * answers "Location is required" until they save a new one.
 */
describe("a customer removing their own address", () => {
  it("can delete it, and the link goes with it", async () => {
    const created = await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    await deleteLocation(customerActor(CUSTOMER_USER._id), {
      id: created._id.toString(),
    });

    expect((await Location.findById(created._id)).isDeleted).toBe(true);
    expect((await Customer.findById(CUSTOMER_ROW._id)).locationId).toBeNull();
  });

  it("cannot delete another customer's", async () => {
    const created = await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );
    const intruder = await seedCustomer();

    await expect(
      deleteLocation(customerActor(intruder.user._id), {
        id: created._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect((await Location.findById(created._id)).isDeleted).toBe(false);
  });

  it("cannot delete an outlet's address", async () => {
    const created = await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    await expect(
      deleteLocation(customerActor(CUSTOMER_USER._id), {
        id: created._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("what a guest sees", () => {
  const guestQuery = (extra = {}) => ({ page: 1, limit: 20, ...extra });

  const publish = async (brand) => {
    await Brand.updateOne(
      { _id: brand._id },
      { $set: { isApproved: true, isActive: true, isDeleted: false } },
    );
  };

  it("lists brands with no coordinates at all, and does not error", async () => {
    await publish(BRAND);

    const result = await getAllCustomerBrands(guestQuery());
    const rows = result.data ?? result.result ?? [];
    expect(rows.some((b) => String(b._id) === String(BRAND._id))).toBe(true);
  });

  /**
   * The outlet here has never been given an address, so it carries no `geo`.
   * The directory asks each outlet for a distance and takes the nearest; a
   * missing one contributes `null` and is filtered out rather than counted as
   * zero, which would put an outlet with no address at the top of the list.
   */
  it("lists brands with coordinates even when an outlet has no address", async () => {
    await publish(BRAND);

    const result = await getAllCustomerBrands(
      guestQuery({ latitude: 22.7196, longitude: 75.857 }),
    );
    const rows = result.data ?? result.result ?? [];
    const row = rows.find((b) => String(b._id) === String(BRAND._id));

    expect(row).toBeDefined();
    // No address anywhere under this brand yet, so no distance — not zero.
    expect(row.distanceInMeters ?? null).toBeNull();
  });

  it("reports a real distance once the outlet has an address", async () => {
    await publish(BRAND);
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );

    const result = await getAllCustomerBrands(
      guestQuery({ latitude: 22.7196, longitude: 75.857 }),
    );
    const rows = result.data ?? result.result ?? [];
    const row = rows.find((b) => String(b._id) === String(BRAND._id));

    expect(typeof row.distanceInMeters).toBe("number");
    expect(row.distanceInMeters).toBeLessThan(2000);
  });
});

describe("what the listing shows", () => {
  /**
   * ⚠️ There was no scope at all. One request with no filters returned every
   * address on the platform — customers' home addresses and coordinates
   * included, a page at a time until there were none left.
   */
  it("never shows a vendor another brand's rows, or any customer's", async () => {
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );
    await createLocation(
      vendorActor(OTHER_OWNER._id, OTHER_BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OTHER_OUTLET._id.toString() }),
    );
    await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    const result = await getAllLocations(vendorActor(OWNER._id, BRAND._id), {});
    const rows = result.data ?? result.result ?? result.docs ?? [];

    expect(rows.length).toBe(1);
    expect(String(rows[0].brandId)).toBe(String(BRAND._id));
  });

  it("refuses a vendor who asks for another brand outright", async () => {
    await expect(
      getAllLocations(vendorActor(OWNER._id, BRAND._id), {
        brandId: OTHER_BRAND._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  /**
   * ⚠️ The search box used to hand the caller the regex engine — thirteen places
   * built a `RegExp` straight from the query string. Three separate failures came
   * out of that, and only the first is obvious.
   */
  describe("search treats the query as text, not as a pattern", () => {
    const rowsOf = (result) => result.data ?? result.result ?? result.docs ?? [];

    beforeEach(async () => {
      await createLocation(
        vendorActor(OWNER._id, BRAND._id),
        address({
          isSubBrandAddress: true,
          subBrandId: OUTLET._id.toString(),
          addressLine1: "12 fixture street",
        }),
      );
    });

    /**
     * ⚠️ `pagination` answers an empty page with a 404 rather than an empty
     * list, so "found nothing" is what a 404 means here — and for these three it
     * is the **right** answer. Unescaped, the first would have been a 500 before
     * Mongo was reached and the second would have matched every row.
     */
    const searchFinding = (term) =>
      getAllLocations(vendorActor(OWNER._id, BRAND._id), { search: term });

    /** `new RegExp("[")` throws — a stray bracket in a search box was a 500. */
    it("does not fall over on a character that is regex syntax", async () => {
      await expect(searchFinding("[")).rejects.toMatchObject({ statusCode: 404 });
    });

    /** `.*` as a pattern matches everything; as text it matches nothing here. */
    it("does not let a wildcard turn the filter off", async () => {
      await expect(searchFinding(".*")).rejects.toMatchObject({ statusCode: 404 });
    });

    /**
     * Catastrophic backtracking. Measured unescaped against a 29-character
     * subject in Node's engine: 36.7 seconds for one string — and Mongo is asked
     * to run the same expression against every document it scans.
     */
    it("answers promptly on an expression built to backtrack", async () => {
      const started = Date.now();
      await expect(searchFinding("(a+)+$")).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("still finds a row by part of its address", async () => {
      const result = await getAllLocations(vendorActor(OWNER._id, BRAND._id), {
        search: "fixture",
      });
      expect(rowsOf(result)).toHaveLength(1);
    });
  });

  it("shows an admin everything", async () => {
    await createLocation(
      vendorActor(OWNER._id, BRAND._id),
      address({ isSubBrandAddress: true, subBrandId: OUTLET._id.toString() }),
    );
    await createLocation(
      adminActor(),
      address({ userId: CUSTOMER_USER._id.toString() }),
    );

    const result = await getAllLocations(adminActor(), {});
    const rows = result.data ?? result.result ?? result.docs ?? [];
    expect(rows.length).toBe(2);
  });
});
