const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");
const Brand = require("../../models/Brand");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const { throwError } = require("../../utils");
const {
  normalizeVoucherName,
  getUniqueTags,
  validateVoucherCategory,
  validateVoucherSubCategory,
  validateVoucherSubBrands,
  validateVoucherValidityPeriod,
  normalizeVoucherImages,
  validateVoucherImages,
  assertVoucherImageFloor,
  uploadVoucherImages,
  rollbackVoucherImages,
  generateVoucherCode,
  generateVoucherVersionCode,
  uploadVoucherBannerMedia,
  deleteVoucherBannerMedia,
  syncAttachedSubBrandsCount,
} = require("../../helpers/vouchers");
const {
  validateVoucherOffers,
  normalizeVoucherOffers,
} = require("../../helpers/voucherOffers");
const { VOUCHER_STATUSES } = require("../../constants/voucher");
const {
  VOUCHER_BANNER_STATUS,
  VOUCHER_BANNER_FILE_FIELD,
  VOUCHER_BANNER_POSTER_FIELD,
} = require("../../constants/voucherBanner");
const { getVoucherConfig } = require("../../helpers/settings");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const {
  reserveSlot,
  releaseSlot,
  resolveActorBrand,
} = require("../../helpers/brands");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");

exports.createVoucher = async (actor, payload, files = {}) => {
  const images = files?.images;
  const userId = actor.userId;

  // Ownership first. `brandId` came straight from the request body and was only
  // checked for existence, so any authenticated caller could create a voucher
  // against any brand — and, now that vouchers are metered, drain that brand's
  // plan quota. An admin may name any brand; a vendor only their own.
  const actorBrand = await resolveActorBrand(actor, payload.brandId);
  payload.brandId = actorBrand._id;

  // Gated before the transaction opens, so a vendor without a live plan gets
  // "subscribe to continue" rather than a validation error about the voucher.
  // `assertActiveSubscription` resolves the plan from `status` + `endDate` and
  // self-heals a lapsed row, so an expired plan is caught even if the expiry
  // job has not run.
  await assertActiveSubscription(payload.brandId);

  // Atomic claim on the plan's voucher pool: the limit test lives inside the
  // update filter, so two concurrent creates cannot both take the last slot.
  await reserveSlot(payload.brandId, ENTITLEMENT_BUCKETS.VOUCHERS);

  const session = await mongoose.startSession();
  let uploadedImages = [];
  let uploadedBanner = null;
  try {
    let {
      brandId,
      name,
      description,
      tags,
      startAt,
      endAt,
      offers,
      subBrandIds,
      isActive,
    } = payload;

    /**
     * ---------------- everything that does not write: outside ----------------
     *
     * 🔴 P3 — the uploads used to run **inside** the transaction.
     *
     * A voucher carries up to five images and a banner that may be a video, and
     * every one of those bytes went to S3 with a Mongo transaction open. A
     * transaction holds its locks for its whole life and the server aborts it at
     * `transactionLifetimeLimitSeconds` — 60 by default. So a vendor on a slow
     * connection did not get a slow request: they got a create that ran for a
     * minute, uploaded everything, and then failed at commit with an error about
     * a transaction, having paid for the storage.
     *
     * Nothing below the line needs a transaction. These are reads and pure
     * validation, and the uploads touch no document at all — the transaction
     * exists for the four inserts that follow them, which take milliseconds.
     */
    const brand = await Brand.findById(brandId);
    if (!brand || brand.isDeleted) throwError(400, "Brand not found");

    // Jaisa vendor ne likha, bas saaf kiya — aur poora lowercase ho to theek kiya.
    name = toDisplayName(name);
    const normalizedName = normalizeVoucherName(name);
    if (!normalizedName) throwError(400, "Voucher name is required.");

    const { categoryId, subCategoryId } = brand;
    /**
     * ⚠️ No session, and it does not need one.
     *
     * This read is a **courtesy**: it turns the common case into a clear 409
     * instead of a duplicate-key error. What actually enforces uniqueness is the
     * partial unique index on `(brandId, normalizedName)` where `isDeleted:
     * false` — and the `11000` branch in the catch below turns that into the
     * same 409. Two creates racing the same name were always settled by the
     * index; running this inside a transaction never changed that.
     */
    const existingVoucher = await Voucher.findOne({
      brandId,
      normalizedName,
      isDeleted: false,
    }).select("_id");

    if (existingVoucher) {
      throwError(409, "Voucher with this name already exists for this brand.");
    }

    await validateVoucherCategory(categoryId);
    await validateVoucherSubCategory(subCategoryId, categoryId);

    const subBrands = await validateVoucherSubBrands(subBrandIds, brandId);

    // The whole config, not two numbers off it — `validateVoucherImages` needs
    // the size ceilings too, which is what P12 was missing.
    const voucherConfig = await getVoucherConfig();
    const { maxOffers } = voucherConfig;
    validateVoucherOffers(offers, maxOffers);
    offers = normalizeVoucherOffers(offers);

    const validity = validateVoucherValidityPeriod(startAt, endAt);

    const voucherFiles = normalizeVoucherImages(images);
    /**
     * The floor, before a single byte is uploaded — a vendor who is three images
     * short should be told so while they still have the picker open, not after
     * waiting out five uploads.
     *
     * `voucherConfig` is passed so this request reads the settings cache once.
     */
    await assertVoucherImageFloor(voucherFiles.length, voucherConfig);
    validateVoucherImages(voucherFiles, voucherConfig);

    // The images' object keys carry the voucher id, and they go up before the
    // row is inserted — so the id is minted here. Mongo generates ids
    // client-side anyway; this is the value `create` would have produced.
    const voucherId = new mongoose.Types.ObjectId();
    uploadedImages = await uploadVoucherImages(voucherFiles, voucherId);

    /**
     * The banner goes up here too, for the same reason — and it is the one that
     * matters most, because a banner may be a **video**. It used to upload after
     * `Voucher.create`, purely because it wanted the id; the id is minted above,
     * so nothing required that.
     */
    const bannerFile = files?.[VOUCHER_BANNER_FILE_FIELD];
    if (bannerFile) {
      uploadedBanner = await uploadVoucherBannerMedia(
        bannerFile,
        voucherId,
        files?.[VOUCHER_BANNER_POSTER_FIELD],
      );
    }

    tags = getUniqueTags(tags || []);

    // ---------------- the writes, and only the writes: inside ----------------
    session.startTransaction();

    const { voucherCode } = await generateVoucherCode(session);

    const [voucher] = await Voucher.create(
      [
        {
          _id: voucherId,
          createdBy: userId,
          brandId,
          name,
          normalizedName,
          description,
          voucherCode,
          categoryId,
          subCategoryId,
          tags,
          startAt,
          endAt,
          isActive:
            typeof isActive === "string" ? isActive === "true" : isActive,
        },
      ],
      { session },
    );

    const versionNumber = 1;
    const versionCode = generateVoucherVersionCode(voucherCode, versionNumber);

    const [version] = await VoucherVersion.create(
      [
        {
          createdBy: userId,
          voucherId: voucher._id,
          brandId,
          versionNumber: 1,
          versionCode,
          name,
          description,
          tags,
          categoryId,
          subCategoryId,
          // ⚠️ Positions are assigned here, not by the uploader. `sortOrder` is
          // where a picture sits in the gallery; the uploader only knows what
          // the file is.
          images: (uploadedImages || []).map((media, index) => ({
            media,
            sortOrder: index + 1,
          })),
          offers,
          startAt,
          endAt,
          status: VOUCHER_STATUSES.DRAFT,
          isImmutable: false,
          isActive: true,
        },
      ],
      { session },
    );

    // Already uploaded above; this only attaches what came back.
    /**
     * ⚠️ Into `pending`, never `current` — a banner reaches customers only
     * after an admin approves it (V-4). A voucher created with one is published
     * on the `images[0]` fallback until then, which is exactly what keeps a
     * review queue from holding up a live offer.
     */
    if (uploadedBanner) {
      voucher.banner = {
        pending: uploadedBanner,
        status: VOUCHER_BANNER_STATUS.PENDING,
      };
    }

    voucher.currentVersionId = version._id;
    voucher.currentVersion = versionNumber;
    await voucher.save({ session });

    const mappingDocuments = subBrands.map((subBrand) => ({
      createdBy: userId,
      brandId,
      voucherId: voucher._id,
      voucherVersionId: version._id,
      subBrandId: subBrand._id,
      geo: subBrand.geo,
      storeId: subBrand.storeId,
      locationId: subBrand.locationId,
      isActive: true,
      isDeleted: false,
    }));
    await VoucherSubBrand.insertMany(mappingDocuments, { session });
    await syncAttachedSubBrandsCount(version._id, session);

    await session.commitTransaction();
    return {
      voucherId: voucher._id,
      voucherCode: voucher.voucherCode,
      versionId: version._id,
      versionCode: version.versionCode,
      versionNumber,
      status: version.status,
    };
  } catch (error) {
    /**
     * ⚠️ Guarded, because most failures now happen **before** the transaction
     * starts — a duplicate name, a bad category, an image over the size cap, a
     * failed upload. `abortTransaction()` on a session that never began one
     * throws, and that error would replace the real one: the vendor would be
     * told about a transaction instead of their voucher.
     */
    if (session.inTransaction()) await session.abortTransaction();
    // Hand the reserved slot back before rethrowing, otherwise a failed create
    // silently costs the vendor one voucher from their plan.
    await releaseSlot(payload.brandId, ENTITLEMENT_BUCKETS.VOUCHERS);
    if (uploadedImages.length) await rollbackVoucherImages(uploadedImages);
    if (uploadedBanner) {
      await deleteVoucherBannerMedia(uploadedBanner);
    }
    if (error?.code === 11000) {
      throwError(
        409,
        "Voucher with the same name already exists for this brand.",
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
