/**
 * Two listings that returned the whole platform.
 *
 * ### 🔴 What these did before
 *
 * `GET /subBrands/get-all` and `GET /vouchers/versions/get-all` both have a role
 * gate (`isVendorOrAdmin`), and both read `brandId` **from the query**. The gate
 * says the caller is *a* vendor; nothing said **which** brand. Every filter was
 * optional, so one request with no `brandId` walked the entire collection a page
 * at a time — and naming somebody else's `brandId` returned their rows just as
 * readily.
 *
 * For outlets that is every outlet's address, manager email, mobile and store
 * id. For voucher versions it is every brand's unpublished drafts, their pricing
 * and their rejection notes.
 *
 * This is the same bug that `GET /locations/getAll` had, so the fix is the same
 * shape: `scopeToActor`, applied **after** the caller's filters, where nothing
 * above it can widen the result.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const VoucherVersion = require("../../models/VoucherVersion");
const { ROLES } = require("../../constants");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const { getAllSubBrands } = require("../../services/subBrands");
const { getAllVoucherVersions } = require("../../services/vouchers");

const oid = () => new mongoose.Types.ObjectId();

let MINE;
let THEIRS;
let MY_OWNER;
let THEIR_OWNER;

const seedBrand = async (ownerUserId, name) =>
  Brand.create({
    brandName: name,
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId: ownerUserId,
    merchantId: await generateBrandMerchantId(),
  });

/**
 * ⚠️ Identified by `description`, because a `SubBrand` has **no name field at
 * all** — the schema's paths are ids, contacts, geo and flags. A fixture that
 * set `subBrandName` was writing a path Mongoose then dropped, so every
 * assertion on it read `undefined`.
 */
const seedOutlet = async (brandId, label) =>
  SubBrand.create({
    brandId,
    userId: oid(),
    description: label,
    uniqueId: `TDO${Date.now()}${Math.floor(Math.random() * 100000)}`,
    storeId: await generateSubBrandStoreId(),
  });

let versionSeq = 0;
/**
 * The schema refuses a version with no category, no image or no offer, so these
 * are the minimum a real row carries. Nothing here depends on their contents.
 */
const seedVersion = (brandId, name) => {
  versionSeq += 1;
  return VoucherVersion.create({
    voucherId: oid(),
    brandId,
    versionNumber: versionSeq,
    versionCode: `VCH-${String(versionSeq).padStart(8, "0")}-V1`,
    name,
    createdBy: oid(),
    categoryId: oid(),
    subCategoryId: oid(),
    // ⚠️ The file sits inside `media` since M-5 — the same `mediaSchema`
    // every other surface uses. `kind` is derived at upload and required
    // by the schema, so a fixture without it will not save.
    images: [
      { media: { url: "https://example.test/v.webp", kind: "IMAGE" }, sortOrder: 1 },
    ],
    offers: [
      {
        title: "flat 10%",
        minBillAmount: 100,
        discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
        discountValue: 10,
        sortOrder: 1,
      },
    ],
    status: VOUCHER_STATUSES.DRAFT,
    startAt: new Date(),
    endAt: new Date(Date.now() + 86400000),
  });
};

/**
 * ⚠️ A vendor's token always carries `brandId` — the controller reads it off
 * `req`. Without it `resolveActorBrand` answers 404 "No brand is linked to your
 * account", which is right but is not the case under test here.
 */
const vendor = (userId, brandId) => ({ userId, role: ROLES.VENDOR, brandId });
const subVendor = (userId, brandId, subBrandId) => ({
  userId,
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ userId: oid(), role: ROLES.ADMIN });

/** `pagination` throws a 404 on an empty page, so "nothing" is an exception. */
const rowsOf = async (promise) => {
  try {
    const result = await promise;
    return result?.data ?? result?.result ?? [];
  } catch (error) {
    if (error.statusCode === 404) return [];
    throw error;
  }
};

beforeAll(connectTestDb);
afterAll(disconnectTestDb);

beforeEach(async () => {
  await clearCollections(Brand, SubBrand, VoucherVersion);
  MY_OWNER = oid();
  THEIR_OWNER = oid();
  MINE = await seedBrand(MY_OWNER, "my brand");
  THEIRS = await seedBrand(THEIR_OWNER, "their brand");
});

describe("GET /subBrands/get-all", () => {
  beforeEach(async () => {
    await seedOutlet(MINE._id, "my outlet");
    await seedOutlet(THEIRS._id, "their outlet");
  });

  test("🔴 no brandId no longer means the whole platform", async () => {
    const rows = await rowsOf(getAllSubBrands(vendor(MY_OWNER, MINE._id), {}));

    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("my outlet");
  });

  test("🔴 naming another brand is refused, not quietly honoured", async () => {
    // Refused rather than silently narrowed to their own: being handed your own
    // rows reads as the filter having been ignored.
    await expect(
      getAllSubBrands(vendor(MY_OWNER, MINE._id), { brandId: THEIRS._id.toString() }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("naming their own brand is fine", async () => {
    const rows = await rowsOf(
      getAllSubBrands(vendor(MY_OWNER, MINE._id), { brandId: MINE._id.toString() }),
    );
    expect(rows).toHaveLength(1);
  });

  test("an outlet manager sees only their own outlet", async () => {
    const mine = await seedOutlet(MINE._id, "counter A");
    await seedOutlet(MINE._id, "counter B");

    const rows = await rowsOf(
      getAllSubBrands(subVendor(oid(), MINE._id, mine._id), {}),
    );

    // ⚠️ Scoped on the outlet, not the brand: the token carries a brandId so
    // brand-wide reads work elsewhere, and scoping on it here would hand them
    // every sibling counter's contact details.
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("counter A");
  });

  test("an admin still sees everything", async () => {
    const rows = await rowsOf(getAllSubBrands(admin(), {}));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test("a caller with no role at all is refused", async () => {
    await expect(getAllSubBrands({}, {})).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  /**
   * 🔴 Regex metacharacters must be text, not operators.
   *
   * ⚠️ Asserted on the **result**, not on how long it took. A timing assertion
   * looked like it covered this and did not: the expression is evaluated by
   * Mongo, and against a handful of fixture rows even a pathological pattern
   * returns instantly. The mutation run said so — the timing test survived
   * having `escapeRegex` removed.
   */
  test("🔴 `.` is a full stop, not 'any character'", async () => {
    await seedOutlet(MINE._id, "counter A");

    // Unescaped, `r.` matches "counter A"; escaped, it looks for a literal dot.
    const rows = await rowsOf(
      getAllSubBrands(vendor(MY_OWNER, MINE._id), { search: "counter." }),
    );
    expect(rows).toHaveLength(0);
  });

  test("🔴 `.*` does not turn the filter off", async () => {
    await seedOutlet(MINE._id, "counter A");

    const rows = await rowsOf(
      getAllSubBrands(vendor(MY_OWNER, MINE._id), { search: ".*" }),
    );
    expect(rows).toHaveLength(0);
  });

  test("an unbalanced bracket is a search, not a 500", async () => {
    // `new RegExp("[")` throws SyntaxError before Mongo is reached, so a stray
    // bracket in a search box used to be a server error.
    await expect(
      rowsOf(getAllSubBrands(vendor(MY_OWNER, MINE._id), { search: "[" })),
    ).resolves.toEqual([]);
  });
});

describe("GET /vouchers/versions/get-all", () => {
  beforeEach(async () => {
    await seedVersion(MINE._id, "my voucher");
    await seedVersion(THEIRS._id, "their voucher");
  });

  test("🔴 no brandId no longer means every brand's drafts", async () => {
    const rows = await rowsOf(getAllVoucherVersions(vendor(MY_OWNER, MINE._id), {}));

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("my voucher");
  });

  test("🔴 naming another brand is refused", async () => {
    await expect(
      getAllVoucherVersions(vendor(MY_OWNER, MINE._id), {
        brandId: THEIRS._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("a sub-vendor sees the brand's vouchers, not a narrower slice", async () => {
    // A voucher belongs to the brand and is redeemed at every outlet, so an
    // outlet-level cut would hide the very vouchers that counter accepts.
    const outlet = await seedOutlet(MINE._id, "counter A");
    await seedVersion(MINE._id, "second voucher");

    const rows = await rowsOf(
      getAllVoucherVersions(subVendor(oid(), MINE._id, outlet._id), {}),
    );

    expect(rows).toHaveLength(2);
  });

  test("an admin still sees everything", async () => {
    const rows = await rowsOf(getAllVoucherVersions(admin(), {}));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  test("a caller with no role at all is refused", async () => {
    await expect(getAllVoucherVersions({}, {})).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  test("🔴 `.*` does not turn the filter off", async () => {
    const rows = await rowsOf(
      getAllVoucherVersions(vendor(MY_OWNER, MINE._id), { search: ".*" }),
    );
    expect(rows).toHaveLength(0);
  });

  test("an unbalanced bracket is a search, not a 500", async () => {
    await expect(
      rowsOf(getAllVoucherVersions(vendor(MY_OWNER, MINE._id), { search: "[" })),
    ).resolves.toEqual([]);
  });

  /**
   * 🔴 The brand comes off the outlet row, never off the token.
   *
   * `authenticate` copies a brand onto a sub-vendor's token. If that copy were
   * trusted, a stale or edited claim would choose which brand's drafts they
   * read — so the fixture deliberately hands them a token pointing at the wrong
   * brand and expects their own brand's rows anyway.
   */
  test("🔴 a stale brandId in the token does not choose the brand", async () => {
    const outlet = await seedOutlet(MINE._id, "counter A");

    const rows = await rowsOf(
      getAllVoucherVersions(
        subVendor(oid(), THEIRS._id, outlet._id),
        {},
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("my voucher");
  });

  test("🔴 an outlet manager cannot name another brand either", async () => {
    const outlet = await seedOutlet(MINE._id, "counter A");

    await expect(
      getAllVoucherVersions(subVendor(oid(), MINE._id, outlet._id), {
        brandId: THEIRS._id.toString(),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
