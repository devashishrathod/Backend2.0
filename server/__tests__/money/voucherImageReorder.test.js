/**
 * V-7 — reordering a voucher's images, and the one image that matters most.
 *
 * ### 🔴 Why a real database
 *
 * The order lives in a sub-document array, and what this changes is which entry
 * `sortOrder: 1` points at. Mongoose only writes the paths it sees change, so
 * "did the new order actually persist" is a question about a saved document,
 * not about the object in memory.
 *
 * The refusal is the other half: a published version is `isImmutable`, and the
 * only honest way to test that it stays that way is to try.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const {
  reorderVoucherImages,
} = require("../../services/vouchers/reorderVoucherImages");
const {
  buildVoucherSnapshot,
} = require("../../helpers/vouchers/buildVoucherSnapshot");
const {
  VOUCHER_STATUSES,
  VOUCHER_DISCOUNT_TYPES,
} = require("../../constants/voucher");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (d) => new Date(Date.now() + d * DAY_MS);

let codeSeq = 80_000_000;
const nextVoucherCode = () => `VCH-${String(codeSeq++).padStart(8, "0")}`;

const ownerActor = (userId, brandId) => ({
  userId,
  role: ROLES.VENDOR,
  brandId,
});

/** A voucher with three images, numbered 1, 2, 3. */
const seedVoucher = async ({ status = VOUCHER_STATUSES.DRAFT } = {}) => {
  const userId = oid();
  const brand = await Brand.create({
    brandName: "reorder fixture brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
  });
  const voucherCode = nextVoucherCode();

  const voucher = await Voucher.create({
    createdBy: userId,
    brandId: brand._id,
    name: "reorder fixture",
    normalizedName: "reorder fixture",
    voucherCode,
    status: VOUCHER_STATUSES.DRAFT,
  });

  const version = await VoucherVersion.create({
    voucherId: voucher._id,
    brandId: brand._id,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "reorder fixture",
    versionNumber: 1,
    versionCode: `${voucherCode}-V1`,
    status,
    isImmutable: status === VOUCHER_STATUSES.PUBLISHED,
    startAt: daysFromNow(1),
    endAt: daysFromNow(90),
    images: [
      { media: { url: "https://cdn.test/one.webp", kind: "IMAGE" }, sortOrder: 1 },
      { media: { url: "https://cdn.test/two.webp", kind: "IMAGE" }, sortOrder: 2 },
      { media: { url: "https://cdn.test/three.webp", kind: "IMAGE" }, sortOrder: 3 },
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

  return { voucher, version, brand, userId };
};

/** The stored order, by url, sorted. */
const orderOf = async (versionId) => {
  const v = await VoucherVersion.findById(versionId).lean();
  return [...v.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => i.media.url.split("/").pop());
};

const idsOf = (version) =>
  [...version.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => String(i._id));

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
  await clearCollections(Voucher, VoucherVersion, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Voucher, VoucherVersion, Brand);
});

describe("putting the images in a new order", () => {
  it("saves the order the vendor asked for", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    await reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
      images: [
        { id: three, sortOrder: 1 },
        { id: one, sortOrder: 2 },
        { id: two, sortOrder: 3 },
      ],
    });

    expect(await orderOf(version._id)).toEqual([
      "three.webp",
      "one.webp",
      "two.webp",
    ]);
  });

  /**
   * ⚠️ The numbers decide the order, not the result. Gaps were never meaningful,
   * and keeping them means the next insert has to guess what they meant.
   */
  it("renumbers densely, whatever numbers arrive", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    await reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
      images: [
        { id: two, sortOrder: 10 },
        { id: three, sortOrder: 20 },
        { id: one, sortOrder: 30 },
      ],
    });

    const stored = await VoucherVersion.findById(version._id).lean();
    expect(stored.images.map((i) => i.sortOrder).sort()).toEqual([1, 2, 3]);
    expect(await orderOf(version._id)).toEqual([
      "two.webp",
      "three.webp",
      "one.webp",
    ]);
  });

  /**
   * 🔴 The numbers decide, not the order they arrive in.
   *
   * ⚠️ Every other test here sends a list whose array order already matches
   * its `sortOrder`, so the sort inside `normalizeSortOrder` is a no-op in all
   * of them — a mutation that deleted that sort left them all passing. Here the
   * two deliberately disagree: without the sort, renumbering would follow the
   * array and the image that asked for position 3 would land at 1.
   */
  it("honours sortOrder even when the array arrives in another order", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    await reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
      images: [
        { id: one, sortOrder: 3 },
        { id: two, sortOrder: 1 },
        { id: three, sortOrder: 2 },
      ],
    });

    expect(await orderOf(version._id)).toEqual([
      "two.webp",
      "three.webp",
      "one.webp",
    ]);
  });

  it("reports what the order now is", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    const result = await reorderVoucherImages(
      ownerActor(userId, brand._id),
      version._id,
      {
        images: [
          { id: three, sortOrder: 1 },
          { id: two, sortOrder: 2 },
          { id: one, sortOrder: 3 },
        ],
      },
    );

    expect(result.updated).toBe(3);
    expect(result.images.map((i) => i.url.split("/").pop())).toEqual([
      "three.webp",
      "two.webp",
      "one.webp",
    ]);
  });

  /**
   * ⚠️ `media.url` only. The rest of `media` carries the storage locator, and a
   * reorder response is no place to start handing that out.
   */
  it("never returns the storage locator", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    const result = await reorderVoucherImages(
      ownerActor(userId, brand._id),
      version._id,
      {
        images: [
          { id: two, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: three, sortOrder: 3 },
        ],
      },
    );

    for (const row of result.images) {
      expect(Object.keys(row).sort()).toEqual(["id", "sortOrder", "url"]);
    }
  });

  it("costs nothing when the order did not change", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    const result = await reorderVoucherImages(
      ownerActor(userId, brand._id),
      version._id,
      {
        images: [
          { id: one, sortOrder: 1 },
          { id: two, sortOrder: 2 },
          { id: three, sortOrder: 3 },
        ],
      },
    );

    // Dropping an image back where it started answers the same as never having
    // dragged it.
    expect(result.updated).toBe(0);
    expect(result.message).toMatch(/already in this order/i);
  });
});

describe("🔴 the first image is the banner fallback", () => {
  /**
   * With no approved banner the customer's tile shows `images[0]` by
   * `sortOrder` (V-4a), and the claim snapshot freezes the same one (V-6c). So
   * this endpoint changes what customers see at the top of the voucher — it is
   * not a tidy-up of a list nobody looks at.
   */
  it("moves what a customer sees first", async () => {
    const { voucher, version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    const before = buildVoucherSnapshot(voucher, version);
    expect(before.bannerUrl).toBe("https://cdn.test/one.webp");

    await reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
      images: [
        { id: three, sortOrder: 1 },
        { id: one, sortOrder: 2 },
        { id: two, sortOrder: 3 },
      ],
    });

    const fresh = await VoucherVersion.findById(version._id);
    const after = buildVoucherSnapshot(voucher, fresh);
    expect(after.bannerUrl).toBe("https://cdn.test/three.webp");
  });
});

describe("what it refuses", () => {
  /**
   * 🔴 A published version is `isImmutable`, and every other edit path honours
   * that. Reorder does not fork a new version either — a drag-and-drop that
   * silently creates something awaiting approval is not what was asked for.
   */
  it("refuses a published version and says what to do instead", async () => {
    const { version, brand, userId } = await seedVoucher({
      status: VOUCHER_STATUSES.PUBLISHED,
    });
    const [one, two, three] = idsOf(version);

    const { statusCode, message } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: three, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: two, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(409);
    expect(message).toMatch(/new version/i);
    // And nothing moved.
    expect(await orderOf(version._id)).toEqual([
      "one.webp",
      "two.webp",
      "three.webp",
    ]);
  });

  it("refuses an approved version too", async () => {
    const { version, brand, userId } = await seedVoucher({
      status: VOUCHER_STATUSES.APPROVED,
    });
    const [one, two, three] = idsOf(version);

    const { statusCode } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: two, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: three, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(409);
  });

  /**
   * ⚠️ `isImmutable` is honoured on its own, not as a proxy for the status.
   *
   * Today only `publishVoucher` sets it, and a published version is already
   * refused by the status check — so this combination cannot arise from any
   * current flow, and a mutation that dropped the `isImmutable` half of the
   * guard survived. It is pinned anyway: the field means "never edit this
   * again", and a guard that only reaches it through the status is one flow
   * away from being wrong.
   */
  it("refuses an immutable version whatever its status says", async () => {
    const { version, brand, userId } = await seedVoucher();
    await VoucherVersion.updateOne(
      { _id: version._id },
      { $set: { isImmutable: true } },
    );
    const [one, two, three] = idsOf(version);

    const { statusCode } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: three, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: two, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(409);
    expect(await orderOf(version._id)).toEqual([
      "one.webp",
      "two.webp",
      "three.webp",
    ]);
  });

  it("allows a rejected version, because it is the vendor's to fix", async () => {
    const { version, brand, userId } = await seedVoucher({
      status: VOUCHER_STATUSES.REJECTED,
    });
    const [one, two, three] = idsOf(version);

    await reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
      images: [
        { id: three, sortOrder: 1 },
        { id: two, sortOrder: 2 },
        { id: one, sortOrder: 3 },
      ],
    });

    expect((await orderOf(version._id))[0]).toBe("three.webp");
  });

  /**
   * ⚠️ Positions are renumbered 1..n, so a partial list would collide with
   * whatever was left out of it. The message carries both counts, because
   * "incomplete" on its own does not tell the vendor how many they are missing.
   */
  it("refuses a partial list, with both counts", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two] = idsOf(version);

    const { statusCode, message } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: two, sortOrder: 1 },
          { id: one, sortOrder: 2 },
        ],
      }),
    );

    expect(statusCode).toBe(400);
    expect(message).toContain("3 images expected");
    expect(message).toContain("2 received");
  });

  it("refuses an id that belongs to nothing", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two] = idsOf(version);

    const { statusCode, message } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: String(oid()), sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: two, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/Invalid image id/i);
  });

  it("refuses a duplicate id", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one] = idsOf(version);

    const { statusCode, message } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: one, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: one, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/Duplicate/i);
  });

  it("refuses two images claiming the same position", async () => {
    const { version, brand, userId } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    const { statusCode, message } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [
          { id: one, sortOrder: 1 },
          { id: two, sortOrder: 1 },
          { id: three, sortOrder: 2 },
        ],
      }),
    );

    expect(statusCode).toBe(400);
    expect(message).toMatch(/sort order/i);
  });

  it("refuses an empty list", async () => {
    const { version, brand, userId } = await seedVoucher();

    const { statusCode } = await failure(
      reorderVoucherImages(ownerActor(userId, brand._id), version._id, {
        images: [],
      }),
    );

    expect(statusCode).toBe(400);
  });
});

describe("whose voucher it is", () => {
  it("refuses a vendor from another brand, and leaves the order alone", async () => {
    const { version } = await seedVoucher();
    const [one, two, three] = idsOf(version);
    const stranger = oid();
    const otherBrand = await Brand.create({
      brandName: "stranger brand",
      uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
      userId: stranger,
      merchantId: await generateBrandMerchantId(),
    });

    const { statusCode } = await failure(
      reorderVoucherImages(ownerActor(stranger, otherBrand._id), version._id, {
        images: [
          { id: three, sortOrder: 1 },
          { id: one, sortOrder: 2 },
          { id: two, sortOrder: 3 },
        ],
      }),
    );

    expect(statusCode).toBe(403);
    expect(await orderOf(version._id)).toEqual([
      "one.webp",
      "two.webp",
      "three.webp",
    ]);
  });

  it("lets an admin reorder for any brand", async () => {
    const { version } = await seedVoucher();
    const [one, two, three] = idsOf(version);

    await reorderVoucherImages(
      { userId: oid(), role: ROLES.ADMIN },
      version._id,
      {
        images: [
          { id: two, sortOrder: 1 },
          { id: three, sortOrder: 2 },
          { id: one, sortOrder: 3 },
        ],
      },
    );

    expect((await orderOf(version._id))[0]).toBe("two.webp");
  });

  it("refuses an unauthenticated caller", async () => {
    const { version } = await seedVoucher();
    const [one] = idsOf(version);

    const { statusCode } = await failure(
      reorderVoucherImages({}, version._id, {
        images: [{ id: one, sortOrder: 1 }],
      }),
    );

    expect(statusCode).toBe(401);
  });
});
