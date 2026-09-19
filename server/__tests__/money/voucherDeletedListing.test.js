/**
 * V-6b — the listing that could not see a deleted voucher.
 *
 * ### 🔴 Why a real database
 *
 * `getAllVoucherVersions` is an aggregation pipeline whose first stage is the
 * `$match` this phase changes. Whether a deleted row is in the result is a
 * property of that pipeline against real documents; a mock would return the
 * rows it was handed and prove nothing about the filter.
 *
 * The scoping half matters just as much: a vendor's request is narrowed by
 * `scopeToActor` reading `Brand.userId`, so "can a vendor ask for deleted rows"
 * is only answerable with the brand row present.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");
const VoucherClaim = require("../../models/VoucherClaim");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  getAllVoucherVersions,
} = require("../../services/vouchers/getAllVoucherVersions");
const { deleteVoucher } = require("../../services/vouchers/deleteVoucher");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 60_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const vendorActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});
const adminActor = () => ({ userId: oid(), role: ROLES.ADMIN });

/** One brand, one voucher, one version — the smallest thing a listing can show. */
const seedVoucher = async ({ brand, userId, name = "listing fixture" } = {}) => {
  const owner = userId || oid();
  const ownedBrand =
    brand ||
    (await Brand.create({
      brandName: "listing fixture brand",
      uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
      userId: owner,
      merchantId: await generateBrandMerchantId(),
      vouchersUsed: 1,
      vouchersLimit: 10,
    }));
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: owner,
    brandId: ownedBrand._id,
    name,
    normalizedName: name.toLowerCase(),
    voucherCode,
    status: VOUCHER_STATUSES.DRAFT,
  });

  const version = await VoucherVersion.create({
    voucherId: voucher._id,
    brandId: ownedBrand._id,
    createdBy: owner,
    categoryId: oid(),
    subCategoryId: oid(),
    name,
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status: VOUCHER_STATUSES.DRAFT,
    startAt: daysFromNow(1),
    endAt: daysFromNow(90),
    images: [
      {
        media: { url: "https://example.test/v.webp", kind: "IMAGE" },
        sortOrder: 1,
      },
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
  });

  await Voucher.updateOne(
    { _id: voucher._id },
    { $set: { currentVersionId: version._id, currentVersion: 1 } },
  );

  return { voucher, version, brand: ownedBrand, userId: owner };
};

/** `pagination()` returns `{ total, totalPages, page, limit, data }`. */
const rowsIn = (result) => result.data;
const codesIn = (result) => rowsIn(result).map((row) => row.versionCode);

const failure = async (promise) => {
  try {
    await promise;
    throw new Error("expected this to throw, and it did not");
  } catch (error) {
    return { statusCode: error.statusCode, message: error.message };
  }
};

beforeAll(async () => {
  await connectTestDb();
  await Voucher.createIndexes();
  await VoucherVersion.createIndexes();
});

afterAll(async () => {
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherClaim,
    VoucherApprovalHistory,
    Brand,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Voucher,
    VoucherVersion,
    VoucherClaim,
    VoucherApprovalHistory,
    Brand,
  );
});

describe("a deleted voucher and the default listing", () => {
  it("is gone from an admin's listing by default", async () => {
    const live = await seedVoucher({ name: "still here" });
    const doomed = await seedVoucher({ name: "about to go" });
    await deleteVoucher(adminActor(), doomed.voucher._id);

    const result = await getAllVoucherVersions(adminActor(), {});

    /**
     * ⚠️ Off by default on purpose. Deleted rows appearing in an ordinary
     * listing would quietly change what every existing caller sees — an
     * approval queue is not where retired vouchers should turn up.
     */
    expect(codesIn(result)).toContain(live.version.versionCode);
    expect(codesIn(result)).not.toContain(doomed.version.versionCode);
  });

  /**
   * ⚠️ A second, living voucher on the same brand — not decoration.
   * `pagination()` answers **404 "No any voucherversion found"** for an empty
   * page rather than an empty list, so a test that deletes the only row would
   * be asserting that behaviour instead of this one.
   */
  it("is gone from the vendor's own listing too", async () => {
    const { brand, userId, version, voucher } = await seedVoucher();
    const survivor = await seedVoucher({ brand, userId, name: "survivor" });
    await deleteVoucher(vendorActor(userId, brand._id), voucher._id);

    const codes = codesIn(
      await getAllVoucherVersions(vendorActor(userId, brand._id), {}),
    );

    expect(codes).toContain(survivor.version.versionCode);
    expect(codes).not.toContain(version.versionCode);
  });
});

describe("🔴 includeDeleted — the admin's way back to it", () => {
  it("brings the deleted version back into the list", async () => {
    const { voucher, version } = await seedVoucher();
    await deleteVoucher(adminActor(), voucher._id);

    const result = await getAllVoucherVersions(adminActor(), {
      includeDeleted: "true",
    });

    expect(codesIn(result)).toContain(version.versionCode);
  });

  it("keeps the live ones alongside it, rather than swapping the list", async () => {
    const live = await seedVoucher({ name: "still here" });
    const doomed = await seedVoucher({ name: "about to go" });
    await deleteVoucher(adminActor(), doomed.voucher._id);

    const codes = codesIn(
      await getAllVoucherVersions(adminActor(), { includeDeleted: "true" }),
    );

    // `includeDeleted`, not `onlyDeleted` — it widens the list, it does not
    // replace it.
    expect(codes).toContain(live.version.versionCode);
    expect(codes).toContain(doomed.version.versionCode);
  });

  it("carries who deleted it, when, and why", async () => {
    const admin = adminActor();
    const { voucher, version } = await seedVoucher();
    await deleteVoucher(admin, voucher._id, { reason: "Duplicate listing" });

    const result = await getAllVoucherVersions(adminActor(), {
      includeDeleted: "true",
    });
    const row = rowsIn(result).find(
      (r) => r.versionCode === version.versionCode,
    );

    /**
     * The whole point of the flag. Without these three the listing could show
     * that a voucher is gone but not answer the question anybody actually asks
     * about it, which is who removed it and what they said.
     */
    expect(row.status).toBe(VOUCHER_STATUSES.DELETED);
    expect(row.isDeleted).toBe(true);
    expect(row.deletedAt).toBeTruthy();
    expect(String(row.deletedBy)).toBe(String(admin.userId));
    expect(row.deleteReason).toBe("Duplicate listing");
  });

  it("accepts a real boolean as well as the string a query string carries", async () => {
    const { voucher, version } = await seedVoucher();
    await deleteVoucher(adminActor(), voucher._id);

    const result = await getAllVoucherVersions(adminActor(), {
      includeDeleted: true,
    });

    expect(codesIn(result)).toContain(version.versionCode);
  });

  it("ignores any other value rather than guessing", async () => {
    const live = await seedVoucher({ name: "still here" });
    const { voucher, version } = await seedVoucher();
    await deleteVoucher(adminActor(), voucher._id);

    const codes = codesIn(
      await getAllVoucherVersions(adminActor(), { includeDeleted: "yes" }),
    );

    // Only "true" means true. Treating every non-empty string as true would
    // make `includeDeleted=false` turn them on.
    expect(codes).toContain(live.version.versionCode);
    expect(codes).not.toContain(version.versionCode);
  });

  it("treats the string false as false", async () => {
    const live = await seedVoucher({ name: "still here" });
    const { voucher, version } = await seedVoucher();
    await deleteVoucher(adminActor(), voucher._id);

    const codes = codesIn(
      await getAllVoucherVersions(adminActor(), { includeDeleted: "false" }),
    );

    expect(codes).toContain(live.version.versionCode);
    expect(codes).not.toContain(version.versionCode);
  });
});

describe("🔴 who may ask for it", () => {
  /**
   * ⚠️ Refused, not ignored. Silently dropping the flag would answer "there are
   * no deleted ones" to somebody who asked a question we did not let them ask —
   * the worse of the two wrong answers, because it looks like an answer.
   */
  it("refuses a vendor with a 403 that says why", async () => {
    const { brand, userId } = await seedVoucher();

    const { statusCode, message } = await failure(
      getAllVoucherVersions(vendorActor(userId, brand._id), {
        includeDeleted: "true",
      }),
    );

    expect(statusCode).toBe(403);
    expect(message).toMatch(/admin/i);
  });

  it("refuses a sub-vendor too", async () => {
    const { brand } = await seedVoucher();

    const { statusCode } = await failure(
      getAllVoucherVersions(
        { userId: oid(), role: ROLES.SUB_VENDOR, subBrandId: oid() },
        { includeDeleted: "true" },
      ),
    );

    expect(statusCode).toBe(403);
  });

  /**
   * ⚠️ The refusal lands **before** the brand scoping, so a vendor cannot learn
   * anything from the difference between "no such brand" and "not allowed".
   */
  it("refuses a vendor before it resolves their brand", async () => {
    const stranger = oid();

    const { statusCode } = await failure(
      getAllVoucherVersions(vendorActor(stranger, oid()), {
        includeDeleted: "true",
      }),
    );

    expect(statusCode).toBe(403);
  });

  it("still gives a vendor their ordinary listing", async () => {
    const { brand, userId, version } = await seedVoucher();

    const result = await getAllVoucherVersions(
      vendorActor(userId, brand._id),
      {},
    );

    // The refusal is about the flag, not about the endpoint.
    expect(codesIn(result)).toContain(version.versionCode);
  });
});

describe("the flag does not widen anything else", () => {
  /**
   * 🔴 `scopeToActor` narrows a vendor's listing to their own brand.
   * `includeDeleted` is an admin flag, so this is really asking: does the new
   * branch leave the scoping alone? A `match` rebuilt without the brand filter
   * would hand one brand another's drafts.
   */
  it("keeps a vendor inside their own brand", async () => {
    const mine = await seedVoucher({ name: "mine" });
    const theirs = await seedVoucher({ name: "theirs" });

    const codes = codesIn(
      await getAllVoucherVersions(
        vendorActor(mine.userId, mine.brand._id),
        {},
      ),
    );

    expect(codes).toContain(mine.version.versionCode);
    expect(codes).not.toContain(theirs.version.versionCode);
  });

  it("still honours other filters while including deleted rows", async () => {
    const { voucher, version } = await seedVoucher({ name: "findable" });
    const other = await seedVoucher({ name: "other" });
    await deleteVoucher(adminActor(), voucher._id);

    const codes = codesIn(
      await getAllVoucherVersions(adminActor(), {
        includeDeleted: "true",
        versionCode: version.versionCode,
      }),
    );

    expect(codes).toEqual([version.versionCode]);
    expect(codes).not.toContain(other.version.versionCode);
  });
});
