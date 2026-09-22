const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Follow = require("../../models/Follow");
const BrandAvoidance = require("../../models/BrandAvoidance");
const {
  buildBrandRelationshipMap,
  brandRelationshipFor,
  getBrandRelationship,
} = require("../../helpers/brands");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER_A;
let CUSTOMER_B;
let BRAND_A;
let BRAND_B;
let BRAND_C;

/**
 * `req` as the auth middleware leaves it. ⚠️ `req.customerId` is a populated
 * Customer **document**, not an id — the shape every caller actually passes, and
 * the one a naive `String(req.customerId)` silently gets wrong.
 */
const customerReq = (id) => ({ role: ROLES.CUSTOMER, customerId: { _id: id } });
const vendorReq = (brandId) => ({ role: ROLES.VENDOR, brandId });
const adminReq = () => ({ role: ROLES.ADMIN });
const guestReq = () => ({});

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Follow, BrandAvoidance]) await m.createIndexes();
});

afterAll(async () => {
  await clearCollections(Follow, BrandAvoidance);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Follow, BrandAvoidance);
  CUSTOMER_A = oid();
  CUSTOMER_B = oid();
  BRAND_A = oid();
  BRAND_B = oid();
  BRAND_C = oid();
});

describe("whose relationship it reports", () => {
  it("reports the customer's own follow and avoid", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });
    await BrandAvoidance.create({ customerId: CUSTOMER_A, brandId: BRAND_B });

    const followed = await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_A);
    const avoided = await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_B);
    const neither = await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_C);

    expect(followed).toEqual({ isFollowed: true, isAvoided: false });
    expect(avoided).toEqual({ isFollowed: false, isAvoided: true });
    expect(neither).toEqual({ isFollowed: false, isAvoided: false });
  });

  it("reports both when the same brand is followed and avoided", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });
    await BrandAvoidance.create({ customerId: CUSTOMER_A, brandId: BRAND_A });

    expect(await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_A)).toEqual({
      isFollowed: true,
      isAvoided: true,
    });
  });

  /**
   * 🔴 The privacy boundary this helper exists to make un-missable.
   *
   * `GET /voucher-claims/payments/:transactionId` is one endpoint with three
   * audiences, so "does the customer follow this brand" had to be asked about
   * somebody. Answering it about the **buyer** would tell a vendor that this
   * customer has them avoided — the same class of disclosure
   * `assertTransactionAccess` refuses with `canSeeCustomerPhone: false`.
   *
   * ⚠️ That used to name `canSeeCustomerContact`, which is `true` for the brand
   * side now that they are given the buyer's email. What a buyer *thinks* of a
   * brand was never a contact detail, so the reasoning stands unchanged — only
   * the flag still carrying the refusal is a different one.
   *
   * Resolving off the actor rather than off `transaction.customerId` is what
   * makes that impossible rather than remembered.
   */
  it("never reports another customer's relationship to a vendor", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });
    await BrandAvoidance.create({ customerId: CUSTOMER_A, brandId: BRAND_A });

    // The vendor who owns the very brand that customer A avoids.
    expect(await getBrandRelationship(vendorReq(BRAND_A), BRAND_A)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
    expect(await getBrandRelationship(adminReq(), BRAND_A)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });

  it("never leaks one customer's relationship to another", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });

    expect(await getBrandRelationship(customerReq(CUSTOMER_B), BRAND_A)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });

  it("gives a guest both keys as false, never absent", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });

    const result = await getBrandRelationship(guestReq(), BRAND_A);

    expect(result).toEqual({ isFollowed: false, isAvoided: false });
    // Present, not merely falsy — the app has no way to tell "not followed"
    // from "unknown", so the keys must always be there.
    expect(Object.keys(result).sort()).toEqual(["isAvoided", "isFollowed"]);
  });
});

describe("soft deletes", () => {
  /**
   * ⚠️ Both collections soft-delete: an unfollow flips `isDeleted` rather than
   * removing the row. A query that forgets `isDeleted: false` reports every
   * brand the customer has **ever** followed as followed — and nothing errors.
   */
  it("does not report an unfollowed brand as followed", async () => {
    await Follow.create({
      followerId: CUSTOMER_A,
      followeeId: BRAND_A,
      isDeleted: true,
    });
    await BrandAvoidance.create({
      customerId: CUSTOMER_A,
      brandId: BRAND_B,
      isDeleted: true,
    });

    expect(await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_A)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
    expect(await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_B)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });

  it("reports a re-followed brand again", async () => {
    await Follow.create({
      followerId: CUSTOMER_A,
      followeeId: BRAND_A,
      isDeleted: true,
    });
    await Follow.updateOne(
      { followerId: CUSTOMER_A, followeeId: BRAND_A },
      { isDeleted: false },
    );

    expect(await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_A)).toEqual({
      isFollowed: true,
      isAvoided: false,
    });
  });
});

describe("the listing map", () => {
  it("answers for a page of brands in two queries", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });
    await BrandAvoidance.create({ customerId: CUSTOMER_A, brandId: BRAND_B });

    const map = await buildBrandRelationshipMap(customerReq(CUSTOMER_A), [
      BRAND_A,
      BRAND_B,
      BRAND_C,
    ]);

    expect(brandRelationshipFor(map, BRAND_A)).toEqual({
      isFollowed: true,
      isAvoided: false,
    });
    expect(brandRelationshipFor(map, BRAND_B)).toEqual({
      isFollowed: false,
      isAvoided: true,
    });
    // Absent from the map is a real answer, not a gap.
    expect(brandRelationshipFor(map, BRAND_C)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });

  it("survives a page containing duplicates, nulls and a malformed id", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });

    // This decorates a response that is already built, so a bad id must not
    // throw — it must simply not match.
    const map = await buildBrandRelationshipMap(customerReq(CUSTOMER_A), [
      BRAND_A,
      BRAND_A,
      null,
      undefined,
      "not-an-object-id",
    ]);

    expect(brandRelationshipFor(map, BRAND_A)).toEqual({
      isFollowed: true,
      isAvoided: false,
    });
    expect(brandRelationshipFor(map, "not-an-object-id")).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });

  it("skips both queries for a guest and for an empty page", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });

    expect(
      (await buildBrandRelationshipMap(guestReq(), [BRAND_A])).size,
    ).toBe(0);
    expect(
      (await buildBrandRelationshipMap(customerReq(CUSTOMER_A), [])).size,
    ).toBe(0);
  });

  /**
   * The map is shared across every row of a page, so a caller that mutated what
   * it handed back would change the answer for every other brand — and for the
   * frozen default, which would poison the whole process.
   */
  it("hands back a fresh object each time", async () => {
    const map = await buildBrandRelationshipMap(customerReq(CUSTOMER_A), [
      BRAND_A,
    ]);

    const first = brandRelationshipFor(map, BRAND_A);
    first.isFollowed = true;

    expect(brandRelationshipFor(map, BRAND_A)).toEqual({
      isFollowed: false,
      isAvoided: false,
    });
  });
});

describe("the id it keys on", () => {
  /**
   * ⚠️ `Follow.followerId` and `BrandAvoidance.customerId` are `Customer._id`,
   * **not** `User._id`. Keying on the user would match nothing and read as "this
   * customer follows nobody" rather than as an error.
   */
  it("accepts a document, a bare id and a hex string alike", async () => {
    await Follow.create({ followerId: CUSTOMER_A, followeeId: BRAND_A });

    const expected = { isFollowed: true, isAvoided: false };

    expect(await getBrandRelationship(customerReq(CUSTOMER_A), BRAND_A)).toEqual(
      expected,
    );
    expect(await getBrandRelationship(CUSTOMER_A, BRAND_A)).toEqual(expected);
    expect(await getBrandRelationship(String(CUSTOMER_A), BRAND_A)).toEqual(
      expected,
    );
    expect(await getBrandRelationship({ _id: CUSTOMER_A }, BRAND_A)).toEqual(
      expected,
    );
  });
});
