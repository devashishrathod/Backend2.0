const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const BrandFeatures = require("../../models/BrandFeatures");
const ShowcaseSection = require("../../models/ShowcaseSection");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { SYSTEM_VERIFICATION_STATUS } = require("../../constants");
const { throwError } = require("../../utils");
const { customerVisibleBrandFilter } = require("../../helpers/brands");
// The live plan, resolved the same way on every customer surface — never off
// the stale `Brand.subscribedId` pointer. See the helper for what that cost.
const { buildBrandPlanLookup } = require("../../helpers/subscribeds");
const {
  customerSectionMatch,
  sortedVisibleMedias,
  mediaCounts,
  customerMediaMap,
  applyDisplayPositions,
} = require("../../helpers/showcases");
const { getShowcaseConfig } = require("../../helpers/settings");

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
  /**
   * ⚠️ Verified only, so a deep link to an unverified brand answers 404 rather
   * than opening a page the directory deliberately hides. A brand visible by
   * URL but not by search is the same leak the showcase endpoints had.
   */
  { $match: customerVisibleBrandFilter({ _id }) },
  {
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      whatsappNumber: 1,
      mobile: 1,
      uniqueId: 1,
      merchantId: 1,
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
  /**
   * The live plan's name, and nothing else off the plan.
   *
   * Note what this deliberately does not become: `getBrand` returns the whole
   * `subscribed` document — price paid, dates, entitlements — and the header
   * comment on this file exists precisely because that response is not one a
   * customer may have. A plan **name** is a badge; the billing behind it is not.
   */
  ...buildBrandPlanLookup({ localField: "_id", as: "subscriptionPlan" }),
  {
    $project: {
      brandName: 1,
      description: 1,
      logo: 1,
      coverImage: 1,
      whatsappNumber: 1,
      mobile: 1,
      merchantId: 1,
      uniqueId: 1,
      followersCount: 1,
      joinedDate: 1,
      category: 1,
      subCategory: 1,
      location: 1,
      workHours: 1,
      subscriptionPlan: 1,
      /**
       * ⚠️ That comment said `isApproved` is "never written anywhere ... so it
       * is permanently false". Both halves were wrong:
       * `reviewBrandVerification` writes it on APPROVED, REJECTED and REVOKED.
       * Believing it left this endpoint serving any brand that merely was not
       * deleted — the `$match` above now requires verification.
       *
       * The badge still reads `SystemVerify`, which is where the verdict's
       * history lives.
       */
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
 * The match and the media shape come from `helpers/showcases/projections.js`,
 * shared with the full-gallery and clips endpoints. They used to be hand-rolled
 * in each of the three, which is exactly how `isVisible` ended up enforced here
 * and silently missing from `getBrandsAllShowcase` — a section the vendor had
 * hidden stayed off the brand profile but was still served by the gallery.
 *
 * `storage` and `metadata` are absent by construction: the shared projection is
 * a whitelist, so Cloudinary internals and original filenames cannot leak even
 * as new fields are added to the model.
 */
const fetchShowcase = async (_id) => {
  // S-4: a section below the media floor does not reach a customer at all.
  const { minItems } = await getShowcaseConfig();

  const sections = await ShowcaseSection.aggregate([
    { $match: customerSectionMatch(_id, { minItems }) },
    { $sort: { sortOrder: 1 } },
    { $addFields: { visibleMedias: sortedVisibleMedias() } },
    {
      $project: {
        title: 1,
        description: 1,
        coverImage: 1,
        sectionType: 1,
        sortOrder: 1,
        ...mediaCounts("$visibleMedias"),
        medias: customerMediaMap(
          { $slice: ["$visibleMedias", MEDIA_PREVIEW_PER_SECTION] },
          // A profile card renders a thumbnail strip; it has no player and no
          // timestamps to show, so this preview stays as lean as it was.
          { withCreatedAt: false, withVideoMeta: false },
        ),
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
    /**
     * The customer's own positions — 1, 2, 3 over what this response actually
     * carries. No paging here, so they start at 1.
     *
     * ⚠️ The media are a `$slice` preview, so their positions number the strip
     * the customer is looking at. The full album is its own screen and numbers
     * itself the same way; `hasMoreMedia` is what says there is more.
     */
    sections: applyDisplayPositions(sections),
  };
};

/** Where the customer can actually walk in. */
const fetchOutlets = (_id) =>
  SubBrand.aggregate([
    { $match: { brandId: _id, isActive: true, isDeleted: false } },
    {
      $project: {
        whatsappNumber: 1,
        mobile: 1,
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
        whatsappNumber: 1,
        mobile: 1,
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
