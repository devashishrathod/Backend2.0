const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const BrandFeatures = require("../../models/BrandFeatures");
const ShowcaseSection = require("../../models/ShowcaseSection");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * How many media items ride along inside each showcase section.
 *
 * The brand profile screen shows a cover and a strip of thumbnails per album;
 * the full album is its own screen, served by
 * `GET /showcase/get-brand-showcase/:brandId`. Capping here keeps this response
 * bounded however many sections a plan allows — `Brand.isShowcaseUnlimited`
 * exists, so without a cap an unlimited-plan brand could return megabytes.
 */
const MEDIA_PREVIEW_PER_SECTION = 6;

/** A brand may hold at most 10 active features (enforced in addBrandFeature). */
const MAX_FEATURES = 10;

/**
 * WorkHours stores the seven days as top-level fields — `upsertWorkHours`
 * spreads them with `new WorkHours({ ...workingHours, brandId })`, so there is
 * no `workingHours` wrapper to read.
 */
const WORK_HOURS_FIELDS = {
  monday: 1,
  tuesday: 1,
  wednesday: 1,
  thursday: 1,
  friday: 1,
  saturday: 1,
  sunday: 1,
};

const LOCATION_FIELDS = {
  addressLine1: 1,
  addressLine2: 1,
  landmark: 1,
  city: 1,
  district: 1,
  state: 1,
  country: 1,
  zipcode: 1,
  formattedAddress: 1,
  geo: 1,
};

/**
 * Public brand fields plus the small joins the profile screen needs.
 * Every lookup carries an explicit projection so nothing extra rides along.
 */
const brandPipeline = (_id) => [
  { $match: { _id, isDeleted: false, isActive: true } },
  {
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      uniqueId: 1,
      followersCount: 1,
      joinedDate: 1,
      categoryId: 1,
      subCategoryId: 1,
      locationId: 1,
      workHoursId: 1,
      systemVerifyId: 1,
    },
  },
  ...buildAggregateLookup({
    from: "categories",
    localField: "categoryId",
    as: "category",
    project: { name: 1, image: 1 },
  }),
  ...buildAggregateLookup({
    from: "subcategories",
    localField: "subCategoryId",
    as: "subCategory",
    project: { name: 1, image: 1 },
  }),
  ...buildAggregateLookup({
    from: "locations",
    localField: "locationId",
    as: "location",
    project: LOCATION_FIELDS,
  }),
  ...buildAggregateLookup({
    from: "workhours",
    localField: "workHoursId",
    as: "workHours",
    project: WORK_HOURS_FIELDS,
  }),
  // Only the verdict — never the scores, flags, or the duplicate-brand id lists
  // that SystemVerify also carries.
  ...buildAggregateLookup({
    from: "systemverifies",
    localField: "systemVerifyId",
    as: "verification",
    project: { status: 1 },
  }),
  {
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      uniqueId: 1,
      followersCount: 1,
      joinedDate: 1,
      category: 1,
      subCategory: 1,
      location: 1,
      workHours: 1,
      // `Brand.isApproved` is never written anywhere in the codebase, so it is
      // permanently false. The real verdict lives on the SystemVerify document.
      isVerified: {
        $eq: ["$verification.status", SYSTEM_VERIFICATION_STATUS.APPROVED],
      },
    },
  },
];

const fetchBrand = async (_id) => {
  const [doc] = await Brand.aggregate(brandPipeline(_id));
  return doc || null;
};

/** Active highlight points, newest first. */
const fetchFeatures = (_id) =>
  BrandFeatures.find({ brandId: _id, isActive: true, isDeleted: false })
    .select("title description icon")
    .sort({ createdAt: -1 })
    .limit(MAX_FEATURES)
    .lean();

/**
 * Every album the vendor has chosen to show, each with a bounded media preview.
 *
 * `isVisible` is filtered here. `getBrandsAllShowcase` omits it — only
 * `getAllVideoClips` checks it — so a section the vendor had hidden was still
 * being served on the brand profile.
 */
const fetchShowcase = async (_id) => {
  const sections = await ShowcaseSection.aggregate([
    {
      $match: {
        brandId: _id,
        isActive: true,
        isVisible: true,
        isDeleted: false,
      },
    },
    { $sort: { sortOrder: 1 } },
    {
      $addFields: {
        visibleMedias: {
          $sortArray: {
            input: {
              $filter: {
                input: "$medias",
                as: "m",
                cond: {
                  $and: [
                    { $eq: ["$$m.isActive", true] },
                    { $eq: ["$$m.isDeleted", false] },
                  ],
                },
              },
            },
            sortBy: { sortOrder: 1 },
          },
        },
      },
    },
    {
      $project: {
        title: 1,
        description: 1,
        coverImage: 1,
        sectionType: 1,
        sortOrder: 1,
        mediaCount: { $size: "$visibleMedias" },
        photoCount: {
          $size: {
            $filter: {
              input: "$visibleMedias",
              as: "m",
              cond: { $eq: ["$$m.type", "PHOTO"] },
            },
          },
        },
        videoCount: {
          $size: {
            $filter: {
              input: "$visibleMedias",
              as: "m",
              cond: { $eq: ["$$m.type", "VIDEO"] },
            },
          },
        },
        // `storage` and `metadata` are deliberately absent — Cloudinary
        // internals and original filenames are not the customer's business.
        medias: {
          $map: {
            input: { $slice: ["$visibleMedias", MEDIA_PREVIEW_PER_SECTION] },
            as: "m",
            in: {
              _id: "$$m._id",
              type: "$$m.type",
              url: "$$m.url",
              thumbnail: "$$m.thumbnail",
              title: "$$m.title",
              altText: "$$m.altText",
              sortOrder: "$$m.sortOrder",
            },
          },
        },
      },
    },
    {
      $addFields: {
        hasMoreMedia: { $gt: ["$mediaCount", MEDIA_PREVIEW_PER_SECTION] },
      },
    },
  ]);

  return {
    totalSections: sections.length,
    mediaPreviewLimit: MEDIA_PREVIEW_PER_SECTION,
    sections,
  };
};

/** Where the customer can actually walk in. */
const fetchOutlets = (_id) =>
  SubBrand.aggregate([
    { $match: { brandId: _id, isActive: true, isDeleted: false } },
    {
      $project: {
        storeId: 1,
        uniqueId: 1,
        description: 1,
        outletType: 1,
        locationId: 1,
        workHoursId: 1,
      },
    },
    ...buildAggregateLookup({
      from: "locations",
      localField: "locationId",
      as: "location",
      project: LOCATION_FIELDS,
    }),
    ...buildAggregateLookup({
      from: "workhours",
      localField: "workHoursId",
      as: "workHours",
      project: WORK_HOURS_FIELDS,
    }),
    {
      $project: {
        storeId: 1,
        uniqueId: 1,
        description: 1,
        outletType: 1,
        location: 1,
        workHours: 1,
      },
    },
  ]);

/**
 * The customer-facing view of a brand.
 *
 * Deliberately NOT `getBrand`. That one runs 14 lookups and returns the brand's
 * PAN, GSTIN, bank account, KYC scores and subscription billing — everything a
 * vendor needs and nothing a customer should ever receive. Rather than filter
 * that response by role, this builds only what the customer profile screen
 * renders, so there is no sensitive field left to accidentally leak.
 *
 * Four independent indexed reads run in parallel.
 */
exports.getCustomerBrand = async (payload) => {
  const { brandId } = payload;

  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID");
  }
  const _id = new mongoose.Types.ObjectId(brandId);

  const [brand, features, showcase, outlets] = await Promise.all([
    fetchBrand(_id),
    fetchFeatures(_id),
    fetchShowcase(_id),
    fetchOutlets(_id),
  ]);

  if (!brand) throwError(404, "Brand not found");

  return { ...brand, features, showcase, outlets };
};

exports.MEDIA_PREVIEW_PER_SECTION = MEDIA_PREVIEW_PER_SECTION;
