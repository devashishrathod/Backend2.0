/**
 * 🔴 The request the panel actually sent, end to end.
 *
 * ### Why this file exists
 *
 * A vendor pressed Save and got `500 "Failed to upload voucher images."` from
 * production. Everything underneath was individually tested and individually
 * fine: presign had its suite, confirm had its suite, the facade had its suite,
 * the voucher rules had theirs. What nobody had walked was the **sequence the
 * panel walks** — presign, POST to S3, `POST /uploads/confirm`, then
 * `POST /vouchers/create` carrying the ids.
 *
 * So this file does exactly that, with the real bucket and the real service, in
 * the order and shape the browser's network tab showed:
 *
 *     presign → S3 → confirm     × 4 voucher images
 *     presign → S3 → confirm     × 1 banner
 *     createVoucher({ imageUploadIds: [4], bannerUploadId })
 *
 * ⚠️ The upload helpers are deliberately **not** mocked here, which is the whole
 * difference between this and `voucherImageFloorPaths`. That file mocks them
 * because it is about the rules around an upload; this one is about the upload.
 *
 * ⚠️ Needs working S3 credentials. `uploadAttachClaim.test.js` covers the same
 * guard against Mongo alone, so the logic still has coverage on a machine whose
 * keys are missing — but the sequence in this file is the one that broke, and
 * only a real walk proves it.
 */

const mongoose = require("mongoose");

const {
  connectTestDb,
  enablePresign,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

/**
 * The gates in front of create — plan, slot, outlet — each have their own
 * tests, and standing them up here would put a subscription fixture in front of
 * every assertion about an upload.
 *
 * ⚠️ Mocked at the modules they live in, never with `jest.spyOn` on a barrel:
 * `helpers/brands/index.js` destructures at load, so a spy on the export is
 * never seen.
 */
jest.mock("../../helpers/brands/resolveActorBrand", () => ({
  resolveActorBrand: jest.fn(),
}));
jest.mock("../../helpers/subscribeds/assertActiveSubscription", () => ({
  assertActiveSubscription: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../helpers/brands/entitlementSlots", () => ({
  ...jest.requireActual("../../helpers/brands/entitlementSlots"),
  reserveSlot: jest.fn().mockResolvedValue(undefined),
  releaseSlot: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../helpers/vouchers/validate", () => ({
  ...jest.requireActual("../../helpers/vouchers/validate"),
  validateVoucherSubBrands: jest.fn().mockResolvedValue([]),
}));

const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const Brand = require("../../models/Brand");
const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const Setting = require("../../models/Setting");
const Upload = require("../../models/Upload");

const { createVoucher } = require("../../services/vouchers/createVoucher");
const {
  createUploadIntent,
  confirmUpload,
  deleteAssets,
} = require("../../services/storage");
const {
  resolveActorBrand,
} = require("../../helpers/brands/resolveActorBrand");
const {
  generateBrandMerchantId,
} = require("../../helpers/brands/generateBrandMerchantId");
const { ROLES } = require("../../constants");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { localFile, cleanup: cleanupFixtures } = require("../support/localFile");

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** POST the bytes the way the browser does: signed fields first, file last. */
const uploadTo = async ({ url, fields }, body) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", new Blob([body], { type: "image/png" }), "probe");
  return fetch(url, { method: "POST", body: form });
};

/** Steps 1 and 2 — permission, then the bytes. No confirm. */
const presignAndSend = async (who, purpose) => {
  const intent = await createUploadIntent(who, {
    purpose,
    contentType: "image/png",
    sizeBytes: PNG.length,
    fileName: "shopfront.png",
  });
  const sent = await uploadTo(intent, PNG);
  expect(sent.ok).toBe(true);
  return intent.uploadId;
};

/**
 * Steps 1, 2 **and 3** — the full sequence the panel runs, confirm included.
 *
 * ⚠️ No `entityId`, because the panel has none: the voucher it belongs to does
 * not exist until the request this id is going into.
 */
const panelUpload = async (who, purpose = UPLOAD_PURPOSE.VOUCHER_IMAGE) => {
  const uploadId = await presignAndSend(who, purpose);
  await confirmUpload(who, uploadId, {});
  return uploadId;
};

const offer = {
  title: "10% off",
  minBillAmount: 200,
  discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
  discountValue: 10,
  sortOrder: 1,
};

const daysFromNow = (days) => new Date(Date.now() + days * 864e5);

/**
 * A brand a voucher can actually be created under.
 *
 * 🔴 The category comes from the **brand**, not from the request —
 * `createVoucher` reads `const { categoryId, subCategoryId } = brand`. A fixture
 * without them validates fine on the way in (both validators return `null` for a
 * missing id) and then fails at `VoucherVersion.create` on a required path,
 * which reads as a broken create rather than a thin fixture. It cost a run.
 *
 * ⚠️ Real `Category` and `SubCategory` documents, because
 * `validateVoucherCategory` looks them up and wants `isActive: true` — and the
 * sub-category has to belong to that category.
 */
const seedBrand = async () => {
  const userId = oid();
  const category = await Category.create({ name: `panel category ${++seq}` });
  const subCategory = await SubCategory.create({
    name: `panel sub-category ${seq}`,
    categoryId: category._id,
  });
  const brand = await Brand.create({
    brandName: `panel fixture ${seq}`,
    uniqueId: `TDB${Date.now()}${seq}${Math.floor(Math.random() * 10000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
    categoryId: category._id,
    subCategoryId: subCategory._id,
  });
  resolveActorBrand.mockResolvedValue(brand);
  return {
    brand,
    userId,
    actor: { userId, role: ROLES.VENDOR, brandId: brand._id },
  };
};

/** The body the panel posts, minus whatever a test wants to vary. */
const createWith = async ({ brand, actor }, body, files) =>
  createVoucher(
    actor,
    {
      brandId: String(brand._id),
      name: `panel voucher ${++seq}`,
      description: "created from the vendor panel",
      // ⚠️ No `categoryId` here on purpose — `createVoucher` takes it off the
      // brand, and the panel does not send one either.
      startAt: daysFromNow(2).toISOString(),
      endAt: daysFromNow(60).toISOString(),
      offers: [offer],
      subBrandIds: [String(oid())],
      tags: ["food", "dining"],
      isSaveAsDraft: false,
      ...body,
    },
    files,
  );

/** The thrown error, or `null` when it went through. */
const attempt = async (run) => {
  try {
    return { result: await run(), error: null };
  } catch (error) {
    return { result: null, error };
  }
};

/**
 * ⚠️ These tests write to the **real** bucket, so they have to take it back out.
 * Collected before each clear rather than as the tests go, so a test that fails
 * halfway still has its objects picked up.
 */
const littered = [];
const rememberObjects = async () => {
  const rows = await Upload.find({ "storage.key": { $exists: true } })
    .select("storage")
    .lean();
  rows.forEach((row) => littered.push(row.storage));
};

const clearAll = () =>
  clearCollections(
    Voucher,
    VoucherVersion,
    VoucherSubBrand,
    Brand,
    Category,
    SubCategory,
    Upload,
  );

beforeAll(async () => {
  await connectTestDb();
  // ⚠️ The presigned road is off by default (G5) — this suite is about it.
  await enablePresign();
  await Upload.createIndexes();
  await Voucher.createIndexes();
}, 120000);

afterAll(async () => {
  cleanupFixtures();
  await rememberObjects();
  await deleteAssets(littered.map((ref) => ({ storage: ref, url: null })));
  await clearAll();
  await clearCollections(Setting);
  await disconnectTestDb();
}, 120000);

beforeEach(async () => {
  await rememberObjects();
  await clearAll();
  jest.clearAllMocks();
});

describe("🔴 the request that returned 500 in production", () => {
  /**
   * Four images and a banner, every one of them confirmed by the client first —
   * the exact shape of the failing request, down to the count.
   *
   * Before the fix this threw `500 "Failed to upload voucher images."`, because
   * the surface confirmed a second time and walked into the replay guard.
   */
  it("creates the voucher when the panel confirmed every upload first", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];
    const bannerUploadId = await panelUpload(
      fixture.actor,
      UPLOAD_PURPOSE.VOUCHER_BANNER,
    );

    const { result, error } = await attempt(() =>
      createWith(fixture, { imageUploadIds, bannerUploadId }),
    );

    expect(error).toBeNull();
    expect(result).toBeTruthy();

    const version = await VoucherVersion.findOne({
      voucherId: result.voucherId,
    }).lean();
    expect(version.images).toHaveLength(4);

    // Every image carries real stored media, not a placeholder.
    for (const row of version.images) {
      expect(row.media.mimeType).toBe("image/png");
      expect(row.media.storage.key).toBeTruthy();
      expect(row.media.sizeBytes).toBe(PNG.length);
    }

    const voucher = await Voucher.findById(version.voucherId).lean();
    expect(voucher.banner?.pending?.storage?.key).toBeTruthy();
  }, 180000);

  /**
   * ⚠️ Positions are assigned by the caller, in the order the ids arrived. A
   * gallery that reordered itself on save would be a different bug wearing the
   * same clothes.
   */
  it("keeps the images in the order the panel sent them", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];

    const { result, error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    // ⚠️ Asserted before the lookup, or a failed create shows up as
    // "cannot read voucherId of null" and hides the reason it actually failed.
    expect(error).toBeNull();

    const version = await VoucherVersion.findOne({
      voucherId: result.voucherId,
    }).lean();
    const positions = version.images.map((row) => row.sortOrder);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(positions).size).toBe(positions.length);
  }, 180000);

  /**
   * ⚠️ Each upload is spent exactly once, and the rows say so. This is the
   * property the whole fix turns on — if a save could attach one id twice, two
   * vouchers would share a file and the second would hold one it never paid for.
   */
  it("marks every upload attached, once", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];

    await createWith(fixture, { imageUploadIds });

    const rows = await Upload.find({ _id: { $in: imageUploadIds } }).lean();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.consumedAt).toBeTruthy();
      expect(row.attachedAt).toBeTruthy();
    }
  }, 180000);
});

describe("🔴 a panel half way through the migration", () => {
  /**
   * A client that confirms some uploads and not others is not a broken client —
   * it is a client mid-rollout, or one whose confirm call failed and was not
   * retried. Both roads have to land in the same voucher.
   */
  it("takes confirmed and unconfirmed ids in one request", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await presignAndSend(fixture.actor, UPLOAD_PURPOSE.VOUCHER_IMAGE),
      await panelUpload(fixture.actor),
    ];

    const { result, error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    expect(error).toBeNull();
    const version = await VoucherVersion.findOne({
      voucherId: result.voucherId,
    }).lean();
    expect(version.images).toHaveLength(3);
    for (const row of version.images) {
      expect(row.media.mimeType).toBe("image/png");
    }
  }, 180000);

  /**
   * ⚠️ Mixed roads in one request — multipart files beside presigned ids. During
   * a migration a panel may well have both, and the facade's promise is that a
   * surface cannot tell them apart afterwards.
   */
  it("takes multipart files beside confirmed ids", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];

    const { result, error } = await attempt(() =>
      createWith(
        fixture,
        { imageUploadIds },
        { images: [localFile("png", { name: "from-disk.png" })] },
      ),
    );

    expect(error).toBeNull();
    const version = await VoucherVersion.findOne({
      voucherId: result.voucherId,
    }).lean();
    expect(version.images).toHaveLength(3);
  }, 180000);
});

describe("🔴 what the vendor is told when it goes wrong", () => {
  /**
   * 🔴 The second half of the production defect.
   *
   * Every failure used to come back as `500 "Failed to upload voucher images."`
   * — a wrong id, the wrong surface, an oversize file and an already-used upload
   * were one indistinguishable sentence, and the useful one reached only the
   * server log. A vendor could not tell their mistake from our outage.
   */
  it("reports a reused upload as 409 with its own words, not a 500", async () => {
    const fixture = await seedBrand();
    const spent = await panelUpload(fixture.actor);

    // First voucher takes it legitimately.
    await createWith(fixture, {
      imageUploadIds: [
        spent,
        await panelUpload(fixture.actor),
        await panelUpload(fixture.actor),
      ],
    });

    // A second save sends the same id again — a double-tap, or a stale form.
    const fresh = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];
    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds: [...fresh, spent] }),
    );

    expect(error.statusCode).toBe(409);
    expect(error.message).toMatch(/already been used/i);
    expect(error.message).not.toMatch(/Failed to upload voucher images/i);
  }, 240000);

  /**
   * ⚠️ The same id twice **inside one request** — a double-added file in the
   * picker, or a form that appended instead of replacing. The first one attaches
   * and the second is refused, so a voucher can never end up with two image rows
   * pointing at one object.
   */
  it("refuses the same id sent twice in one request", async () => {
    const fixture = await seedBrand();
    const twice = await panelUpload(fixture.actor);
    const imageUploadIds = [
      twice,
      await panelUpload(fixture.actor),
      twice,
      await panelUpload(fixture.actor),
    ];

    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    expect(error.statusCode).toBe(409);
    expect(await Voucher.countDocuments({ brandId: fixture.brand._id })).toBe(0);
  }, 240000);

  /** And nothing is written when that happens. */
  it("writes no voucher when an image is refused mid-way", async () => {
    const fixture = await seedBrand();
    const spent = await panelUpload(fixture.actor);
    await createWith(fixture, {
      imageUploadIds: [
        spent,
        await panelUpload(fixture.actor),
        await panelUpload(fixture.actor),
      ],
    });
    const before = await Voucher.countDocuments({ brandId: fixture.brand._id });

    const retry = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      spent,
    ];
    await attempt(() => createWith(fixture, { imageUploadIds: retry }));

    expect(await Voucher.countDocuments({ brandId: fixture.brand._id })).toBe(
      before,
    );
  }, 240000);

  /**
   * ⚠️ A banner id sent among the images. The purposes are what keep the two
   * apart — a banner is allowed 50 MB and may be a video, an image is not — so
   * this refusal is a real boundary, and it has to name both sides.
   */
  it("names both purposes when a banner id is sent as an image", async () => {
    const fixture = await seedBrand();
    const bannerId = await panelUpload(
      fixture.actor,
      UPLOAD_PURPOSE.VOUCHER_BANNER,
    );

    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      bannerId,
    ];
    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    expect(error.statusCode).toBe(422);
    expect(error.message).toContain("VOUCHER_BANNER");
    expect(error.message).toContain("VOUCHER_IMAGE");
  }, 240000);

  it("refuses a stranger's confirmed id as if it did not exist", async () => {
    const fixture = await seedBrand();
    const stranger = { userId: oid(), role: ROLES.VENDOR };
    const theirs = await panelUpload(stranger);

    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
      theirs,
    ];
    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    // 404, not 403 — saying "that is not yours" about a real id confirms it.
    expect(error.statusCode).toBe(404);
  }, 240000);
});

describe("🔴 a refusal before the floor must not spend anything", () => {
  /**
   * The image floor is checked from the **descriptions**, before a single
   * upload is accepted. A vendor one image short should be told while their
   * picker is still open — and their uploads must survive the refusal, or
   * fixing a one-file mistake costs them every file again.
   */
  it("refuses below the floor and leaves every upload spendable", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [
      await panelUpload(fixture.actor),
      await panelUpload(fixture.actor),
    ];

    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    expect(error.statusCode).toBe(422);
    expect(error.message).toMatch(/at least 3 images/i);

    const rows = await Upload.find({ _id: { $in: imageUploadIds } }).lean();
    for (const row of rows) {
      // Confirmed, yes — but not spent. The vendor adds one more and saves.
      expect(row.consumedAt).toBeTruthy();
      expect(row.attachedAt ?? null).toBeNull();
    }

    // And that is not a claim about a field — the save really does go through.
    const completed = [...imageUploadIds, await panelUpload(fixture.actor)];
    const { error: second } = await attempt(() =>
      createWith(fixture, { imageUploadIds: completed }),
    );
    expect(second).toBeNull();
  }, 240000);

  /**
   * ⚠️ The same kindness on the other side of the count. Over the ceiling is
   * refused from the descriptions too, so nothing is spent there either.
   */
  it("refuses above the ceiling without spending anything", async () => {
    const fixture = await seedBrand();
    const imageUploadIds = [];
    for (let i = 0; i < 6; i += 1) {
      imageUploadIds.push(await panelUpload(fixture.actor));
    }

    const { error } = await attempt(() =>
      createWith(fixture, { imageUploadIds }),
    );

    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/Maximum 5 voucher images/i);

    const rows = await Upload.find({ _id: { $in: imageUploadIds } }).lean();
    for (const row of rows) {
      expect(row.attachedAt ?? null).toBeNull();
    }
  }, 240000);
});
