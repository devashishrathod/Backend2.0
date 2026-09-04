/**
 * Seeds the data the Postman collections need in order to actually exercise the
 * API rather than return 404s.
 *
 *   node scripts/seedPostmanFixtures.js --db Trydood2_postman --apply
 *
 * Dry run by default; `--apply` is required to write anything. It refuses to run
 * against the production database name outright — there is no flag that lets it.
 *
 * What it builds, all in Indore (`[75.8937, 22.7533]`) so the geo-scoped voucher
 * feed returns something:
 *
 *   admin user                  createdBy for banners, tickers, curation stamps
 *   category + sub-category     master data + voucher classification
 *   2 vendors, 2 brands         one plain, one pinned as a Top Brand
 *   1 outlet per brand          the voucher pipeline starts from SubBrand, so a
 *                               brand with no outlet has no vouchers at all
 *   brand features              10, to exercise the profile cap
 *   showcase section            visible, with a video marked for the clips feed
 *   2 vouchers                  one with an IMAGE banner, one pinned as suggested
 *   banner + 2 tickers          home screen
 *   terms + privacy             legal reads
 *
 * Re-runnable: it clears its own documents first (matched by the seed marker in
 * their unique ids) rather than duplicating them.
 */
require("dotenv").config();
const dns = require("dns");
const mongoose = require("mongoose");

const {
  ROLES,
  SYSTEM_VERIFICATION_STATUS,
  SUBSCRIPTION_TYPES,
} = require("../constants");
const { VOUCHER_STATUSES, VOUCHER_DISCOUNT_TYPES } = require("../constants/voucher");
const { VOUCHER_BANNER_TYPE } = require("../constants/voucherBanner");
const { BANNER_TYPE } = require("../constants/banner");
const {
  PROMO_AUDIENCE,
  PROMO_DISCOUNT_TYPES,
  PROMO_APPLIES_TO,
  PROMO_COST_BEARING_MODE,
} = require("../constants/promoCode");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_SOURCE,
} = require("../constants/subscription");

// Atlas SRV lookup fails on some networks' default resolver. Setting this
// before the first connect matters: a failed first attempt leaves mongoose
// buffering and every later query times out instead of retrying.
dns.setServers(["8.8.8.8", "1.1.1.1"]);

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const APPLY = args.includes("--apply");
const DB = flag("db") || "Trydood2_postman";

const PROD_DB = "Trydood2";
if (DB === PROD_DB) {
  console.error(
    `Refusing to seed fixtures into "${PROD_DB}". Pass --db with a scratch name.`,
  );
  process.exit(2);
}

/** Stamped into every unique id so a re-run can find and clear its own rows. */
const MARK = "PMFX";

const INDORE = [75.8937, 22.7533]; // [longitude, latitude]
const NEARBY = [75.9051, 22.7712]; // ~2.5 km away

const log = (...a) => console.log(...a);

const run = async () => {
  const url = process.env.MONGO_URL.replace(
    /\/([A-Za-z0-9_-]+)(\?|$)/,
    `/${DB}$2`,
  );
  if (!url.includes(DB)) {
    throw new Error("Refusing to run: database name was not applied to MONGO_URL");
  }

  await mongoose.connect(url, { serverSelectionTimeoutMS: 30000 });
  if (mongoose.connection.name !== DB) {
    throw new Error(`Refusing to run against ${mongoose.connection.name}`);
  }
  log(`\nConnected: ${mongoose.connection.name}`);

  if (!APPLY) {
    log("\n── DRY RUN ── nothing will be written. Re-run with --apply.\n");
  }

  const User = require("../models/User");
  const Brand = require("../models/Brand");
  const SubBrand = require("../models/SubBrand");
  const Location = require("../models/Location");
  const WorkHours = require("../models/WorkHours");
  const Category = require("../models/Category");
  const SubCategory = require("../models/SubCategory");
  const SystemVerify = require("../models/SystemVerify");
  const BrandFeatures = require("../models/BrandFeatures");
  const ShowcaseSection = require("../models/ShowcaseSection");
  const Voucher = require("../models/Voucher");
  const VoucherVersion = require("../models/VoucherVersion");
  const VoucherSubBrand = require("../models/VoucherSubBrand");
  const Banner = require("../models/Banner");
  const PromotionalTicker = require("../models/PromotionalTicker");
  const TermAndCondition = require("../models/Terms&Condition");
  const PrivacyAndPolicy = require("../models/Privacy&Policy");
  const PromoCode = require("../models/PromoCode");
  const PromoCodeUsage = require("../models/PromoCodeUsage");
  const Setting = require("../models/Setting");
  const Subscription = require("../models/Subscription");
  const Subscribed = require("../models/Subscribed");

  const { generateSubBrandStoreId } = require("../helpers/subBrands");
  const { generateBrandMerchantId } = require("../helpers/brands");
  const {
    syncBrandSubscriptionState,
  } = require("../helpers/subscribeds/syncBrandSubscriptionState");

  // The pipelines depend on a 2dsphere index on SubBrand.geo and a text index
  // on Voucher; a fresh scratch database has neither until this runs.
  await Promise.all([
    SubBrand.syncIndexes(),
    Voucher.syncIndexes(),
    VoucherVersion.syncIndexes(),
    VoucherSubBrand.syncIndexes(),
    Brand.syncIndexes(),
  ]);

  const plan = [];
  const step = (what, fn) => plan.push({ what, fn });

  // ── clear previous seed ──────────────────────────────────────────────────
  step("clear previous seed", async () => {
    const brands = await Brand.find({ uniqueId: new RegExp(MARK) }).select("_id");
    const brandIds = brands.map((b) => b._id);
    const users = await User.find({ uniqueId: new RegExp(MARK) }).select("_id");
    const userIds = users.map((u) => u._id);

    await Promise.all([
      Voucher.deleteMany({ brandId: { $in: brandIds } }),
      VoucherVersion.deleteMany({ brandId: { $in: brandIds } }),
      VoucherSubBrand.deleteMany({ brandId: { $in: brandIds } }),
      SubBrand.deleteMany({ brandId: { $in: brandIds } }),
      ShowcaseSection.deleteMany({ brandId: { $in: brandIds } }),
      BrandFeatures.deleteMany({ brandId: { $in: brandIds } }),
      Location.deleteMany({ userId: { $in: userIds } }),
      WorkHours.deleteMany({ brandId: { $in: brandIds } }),
      SystemVerify.deleteMany({ userId: { $in: userIds } }),
      Subscribed.deleteMany({ brandId: { $in: brandIds } }),
      Subscription.deleteMany({ name: /postman seed/ }),
      Brand.deleteMany({ _id: { $in: brandIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
      Category.deleteMany({ name: /postman seed/ }),
      SubCategory.deleteMany({ name: /postman seed/ }),
      Banner.deleteMany({ title: /postman seed/ }),
      PromotionalTicker.deleteMany({ title: /postman seed/ }),
      TermAndCondition.deleteMany({ title: /postman seed/ }),
      PrivacyAndPolicy.deleteMany({ title: /postman seed/ }),
    ]);

    // Usage rows first — a promo code deleted with its usage left behind
    // would let `perCustomerUsageLimit` refuse the seeded code on the very
    // next run, with a message about a code that no longer exists.
    const promos = await PromoCode.find({ code: new RegExp(MARK) }).select("_id");
    await PromoCodeUsage.deleteMany({
      promoCodeId: { $in: promos.map((c) => c._id) },
    });
    await Promise.all([
      PromoCode.deleteMany({ code: new RegExp(MARK) }),
    ]);
    return `${brandIds.length} brand(s), ${userIds.length} user(s)`;
  });

  let admin, category, subCategory;
  const brands = [];

  step("admin user", async () => {
    admin = await User.create({
      name: "postman seed admin",
      role: ROLES.ADMIN,
      email: `seed.admin.${MARK.toLowerCase()}@trydood.test`,
      whatsappNumber: "9700000001",
      uniqueId: `USR-${MARK}-ADMIN`,
      referralCode: `${MARK}ADM`,
    });
    return admin.uniqueId;
  });

  step("category + sub-category", async () => {
    category = await Category.create({
      name: "postman seed food and beverages",
      description: "seeded for the postman collections",
    });
    subCategory = await SubCategory.create({
      name: "postman seed cafe",
      description: "seeded for the postman collections",
      categoryId: category._id,
    });
    return `${category.name} › ${subCategory.name}`;
  });

  const makeBrand = async ({ key, name, whatsapp, coords, verified, top, followers }) => {
    const user = await User.create({
      name: `${name} owner`,
      role: ROLES.VENDOR,
      whatsappNumber: whatsapp,
      uniqueId: `USR-${MARK}-${key}`,
      referralCode: `${MARK}${key}`,
    });

    const verify = await SystemVerify.create({
      brandId: new mongoose.Types.ObjectId(),
      userId: user._id,
      status: verified
        ? SYSTEM_VERIFICATION_STATUS.APPROVED
        : SYSTEM_VERIFICATION_STATUS.PENDING,
    });

    const brand = await Brand.create({
      userId: user._id,
      brandName: name,
      description: `${name} — seeded for the postman collections`,
      logo: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      coverImage: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      uniqueId: `BRD-${MARK}-${key}`,
      merchantId: await generateBrandMerchantId(),
      categoryId: category._id,
      subCategoryId: subCategory._id,
      systemVerifyId: verify._id,
      followersCount: followers,
      isActive: true,
      /**
       * Approval, tied to the same flag that drives `SystemVerify`.
       *
       * `Brand.isApproved` defaults to **false** and nothing here used to set
       * it. Every seeded brand was therefore unapproved, and the claim preview
       * gates on approval — so a captured example would have enshrined
       * `canClaim: false` as the happy path and made the whole collection
       * describe a blocked flow.
       *
       * Brand B stays unapproved on purpose: it is the fixture the "blocked"
       * example is captured against.
       */
      isApproved: Boolean(verified),
      ...(top ? { isTopBrand: true, topOrder: 1, topAddedAt: new Date(), topAddedBy: admin._id } : {}),
    });

    await SystemVerify.updateOne({ _id: verify._id }, { brandId: brand._id });
    await User.updateOne({ _id: user._id }, { brandId: brand._id });

    // The seven days are top-level fields with `start` / `end` / `isOpen` —
    // there is no `workingHours` wrapper and no slot array.
    const day = (start, end) => ({ start, end, isOpen: true });
    const workHours = await WorkHours.create({
      brandId: brand._id,
      monday: day("09:00", "22:00"),
      tuesday: day("09:00", "22:00"),
      wednesday: day("09:00", "22:00"),
      thursday: day("09:00", "22:00"),
      friday: day("09:00", "23:00"),
      saturday: day("09:00", "23:00"),
      sunday: { isOpen: false },
    });

    const location = await Location.create({
      userId: user._id,
      brandId: brand._id,
      addressLine1: `${name} street`,
      addressLine2: "scheme 54",
      landmark: "opposite c21 mall",
      city: "indore",
      district: "indore",
      state: "madhya pradesh",
      country: "india",
      zipcode: "452010",
      formattedAddress: `${name} street, scheme 54, indore, madhya pradesh, 452010, india`,
      geo: { type: "Point", coordinates: coords },
      isBrandAddress: true,
    });

    await Brand.updateOne(
      { _id: brand._id },
      { locationId: location._id, workHoursId: workHours._id },
    );

    const outlet = await SubBrand.create({
      userId: user._id,
      brandId: brand._id,
      locationId: location._id,
      workHoursId: workHours._id,
      uniqueId: `SB-${MARK}-${key}`,
      storeId: await generateSubBrandStoreId(),
      description: `${name} main outlet`,
      logo: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      coverImage: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      geo: { type: "Point", coordinates: coords },
    });

    await Brand.updateOne({ _id: brand._id }, { firstSubBrandId: outlet._id });

    return { user, brand, outlet, location, workHours };
  };

  step("brands, outlets, locations, work hours", async () => {
    brands.push(
      await makeBrand({
        key: "A",
        name: "postman cafe mocha",
        whatsapp: "9700000011",
        coords: INDORE,
        verified: true,
        top: true,
        followers: 1243,
      }),
    );
    brands.push(
      await makeBrand({
        key: "B",
        name: "postman brew room",
        whatsapp: "9700000012",
        coords: NEARBY,
        verified: false,
        top: false,
        followers: 88,
      }),
    );
    return brands.map((b) => b.brand.brandName).join(", ");
  });

  step("brand features (10, to hit the profile cap)", async () => {
    const titles = [
      "free wifi",
      "pet friendly",
      "outdoor seating",
      "live music on weekends",
      "vegan options",
      "wheelchair accessible",
      "parking available",
      "card payments",
      "home delivery",
      "air conditioned",
    ];
    await BrandFeatures.insertMany(
      titles.map((title) => ({
        brandId: brands[0].brand._id,
        title,
        description: `${title} — seeded`,
        icon: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
        isActive: true,
      })),
    );
    return `${titles.length} on ${brands[0].brand.brandName}`;
  });

  step("showcase section with a clips-eligible video", async () => {
    const media = (i, type) => ({
      type,
      url:
        type === "VIDEO"
          ? "https://res.cloudinary.com/demo/video/upload/dog.mp4"
          : `https://res.cloudinary.com/demo/image/upload/sample.jpg#${i}`,
      thumbnail: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      title: `${type.toLowerCase()} ${i}`,
      altText: `seeded ${type.toLowerCase()} ${i}`,
      sortOrder: i,
      isShowInVideoClips: type === "VIDEO",
      metadata: { width: 1080, height: 1920, duration: type === "VIDEO" ? 24 : 0 },
      isActive: true,
      isDeleted: false,
    });

    // Eight media so the brand-profile preview cap (6) is actually exceeded and
    // `hasMoreMedia` comes back true.
    const medias = [
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => media(i, "PHOTO")),
      media(8, "VIDEO"),
    ];

    await ShowcaseSection.create({
      brandId: brands[0].brand._id,
      title: "interiors",
      slug: "interiors",
      description: "seeded gallery",
      coverImage: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      sortOrder: 1,
      medias,
      isVisible: true,
      isShowVideosInClips: true,
      isActive: true,
    });

    // A hidden album, so the difference between the two showcase endpoints is
    // observable: the brand profile filters `isVisible`, the gallery does not.
    await ShowcaseSection.create({
      brandId: brands[0].brand._id,
      title: "staff only",
      slug: "staff-only",
      sortOrder: 2,
      medias: [media(1, "PHOTO")],
      isVisible: false,
      isActive: true,
    });

    return "1 visible (8 media) + 1 hidden";
  });

  const makeVoucher = async ({ ctx, name, code, banner, suggested, offers }) => {
    const voucher = await Voucher.create({
      createdBy: ctx.user._id,
      brandId: ctx.brand._id,
      name,
      normalizedName: name.toLowerCase(),
      voucherCode: code,
      status: VOUCHER_STATUSES.PUBLISHED,
      ...(banner ? { banner } : {}),
      ...(suggested
        ? {
            isSuggested: true,
            suggestionOrder: 1,
            suggestedAt: new Date(),
            suggestedBy: admin._id,
          }
        : {}),
    });

    const version = await VoucherVersion.create({
      voucherId: voucher._id,
      brandId: ctx.brand._id,
      versionNumber: 1,
      name,
      description: "valid on dine-in and takeaway. seeded fixture.",
      categoryId: category._id,
      subCategoryId: subCategory._id,
      images: [
        { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", sortOrder: 1 },
      ],
      offers,
      startAt: new Date(Date.now() - 86400000),
      endAt: new Date(Date.now() + 86400000 * 60),
      status: VOUCHER_STATUSES.PUBLISHED,
      versionCode: `${code}-V1`,
      createdBy: ctx.user._id,
      publishedAt: new Date(),
    });

    await Voucher.updateOne(
      { _id: voucher._id },
      { publishedVersionId: version._id, currentVersionId: version._id, publishedVersion: 1 },
    );

    await VoucherSubBrand.create({
      createdBy: ctx.user._id,
      voucherId: voucher._id,
      voucherVersionId: version._id,
      brandId: ctx.brand._id,
      subBrandId: ctx.outlet._id,
      subBrandName: ctx.brand.brandName,
      storeId: ctx.outlet.storeId,
      locationId: ctx.location._id,
      geo: ctx.outlet.geo,
    });

    return voucher;
  };

  step("vouchers (published, mapped to outlets)", async () => {
    await makeVoucher({
      ctx: brands[0],
      name: "flat 30% off on total bill",
      code: "VCH-90000001",
      banner: {
        type: VOUCHER_BANNER_TYPE.IMAGE,
        image: { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg" },
      },
      suggested: true,
      offers: [
        {
          title: "30% off above 500",
          minBillAmount: 500,
          discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
          discountValue: 30,
          maxDiscountAmount: 300,
          sortOrder: 1,
        },
        {
          title: "flat 150 off above 800",
          minBillAmount: 800,
          discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
          discountValue: 150,
          sortOrder: 2,
        },
      ],
    });

    // No banner on this one, so the `bannerType: null` contract is exercised too.
    await makeVoucher({
      ctx: brands[1],
      name: "buy 1 get 1 on coffee",
      code: "VCH-90000002",
      suggested: false,
      offers: [
        {
          title: "flat 100 off above 400",
          minBillAmount: 400,
          discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
          discountValue: 100,
          sortOrder: 1,
        },
      ],
    });

    return "2 (1 suggested + banner, 1 plain)";
  });

  step("home screen — banner + tickers", async () => {
    await Banner.create({
      title: "postman seed banner",
      description: "seeded for the postman collections",
      type: BANNER_TYPE.IMAGE,
      image: { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg" },
      redirect: { type: "NONE" },
      startDate: null,
      endDate: null,
      createdBy: admin._id,
      isActive: true,
    });

    await PromotionalTicker.insertMany([
      {
        title: "postman seed ticker one",
        icon: { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg" },
        displayOrder: 1,
        createdBy: admin._id,
        isActive: true,
      },
      {
        title: "postman seed ticker two",
        icon: { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg" },
        displayOrder: 2,
        createdBy: admin._id,
        isActive: true,
      },
    ]);

    return "1 banner + 2 tickers";
  });

  step("customer promo code (+ the setting that makes it usable)", async () => {
    /**
     * ⚠️ Customer promo codes are **off by default** —
     * `CUSTOMER_PROMO_DEFAULTS.isEnabled` is `false`, so `Setting.customer`
     * has to say otherwise or the code is refused before it is even looked
     * up. And on `create-order` that refusal is a hard 422, not the soft
     * report the preview gives: by then the customer has seen a discounted
     * price and pressed Pay.
     *
     * Seeding the code without this switch produces a collection request
     * that fails with "Promo codes are not available yet" and looks like a
     * broken fixture rather than a setting.
     *
     * Safe to write here: this script refuses the production database name
     * outright, so it can only ever reach a scratch one.
     */
    const setting = (await Setting.findOne()) || new Setting({});
    if (!setting.customer) setting.customer = {};
    if (!setting.customer.promoCode) setting.customer.promoCode = {};
    setting.customer.promoCode.isEnabled = true;
    await setting.save();

    await PromoCode.create({
      code: `${MARK}10`,
      description: "seeded customer promo for the postman collections",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.PERCENT,
      discountPercent: 10,
      maxDiscountAmount: 200,
      appliesTo: PROMO_APPLIES_TO.NET_BILL,
      // PLATFORM, so no `brandIds` is required and no vendor settlement is
      // touched by a fixture. VENDOR and SHARED would need a brand list.
      costBearing: { mode: PROMO_COST_BEARING_MODE.PLATFORM, vendorPercent: 0 },
      validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
      validTill: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      // ⚠️ Not the default 1. The collection is meant to be re-runnable, and
      // a per-customer limit of one makes the second pass fail with "You have
      // already used this promo code" — which reads as a broken request.
      perCustomerUsageLimit: 999,
      minBillAmount: 0,
      firstOrderOnly: false,
      createdBy: admin._id,
      isActive: true,
    });

    return `1 promo code (${MARK}10) + customer.promoCode.isEnabled = true`;
  });

  // ── vendor-panel fixtures ────────────────────────────────────────────────
  step("subscription plan + an active subscription on brand A", async () => {
    const plan = await Subscription.create({
      name: "postman seed pro",
      description: "seeded plan for the vendor collection",
      price: 4999,
      strikePrice: 7999,
      discountPercent: 0,
      type: SUBSCRIPTION_TYPES.YEARLY,
      durationInYears: 1,
      durationInDays: 365,
      benefits: ["unlimited vouchers", "priority support"],
      features: [
        { title: "Outlets", value: "10", available: true },
        { title: "Vouchers", value: "Unlimited", available: true },
      ],
      // These are what the gates actually read — `features[]` above is display
      // only. Generous on purpose so no vendor-panel request in the collection
      // trips a plan limit.
      entitlements: {
        subBrands: { limit: 10, isUnlimited: false },
        franchises: { limit: 5, isUnlimited: false },
        vouchers: { limit: 0, isUnlimited: true },
        showcase: { limit: 20, isUnlimited: false },
        dealPack: { isEnabled: true },
        prioritySupport: { isEnabled: true },
      },
      isActive: true,
    });

    /**
     * A live plan for **every** brand, not only the first.
     *
     * A voucher claim is refused when the vendor's own subscription has lapsed
     * — that is the point of `claim.allowWhenVendorPlanExpired`. With only
     * brand A subscribed, every claim against brand B came back blocked for a
     * reason that had nothing to do with what the example was demonstrating.
     */
    for (const { user, brand } of brands) {
      await Subscribed.create({
        userId: user._id,
        brandId: brand._id,
        subscribedBy: user._id,
        subscriptionId: plan._id,
        durationInDays: 365,
        durationInYears: 1,
        startDate: new Date(Date.now() - 86400000),
        endDate: new Date(Date.now() + 86400000 * 364),
        price: plan.price,
        paidAmount: plan.price,
        dueAmount: 0,
        status: SUBSCRIBED_STATUS.ACTIVE,
        source: SUBSCRIPTION_SOURCE.ADMIN_MANUAL,
        grantedByAdminId: admin._id,
      });

      // The single writer of `Brand.isSubscribed` / `subscribedId`, and it also
      // pushes the plan's entitlements onto the brand. Setting those by hand
      // would leave limits and subscription state disagreeing.
      await syncBrandSubscriptionState(brand._id);
    }

    const b = await Brand.findById(brands[0].brand._id).select(
      "isSubscribed vouchersLimit isVouchersUnlimited subBrandsLimit showcaseLimit",
    );
    return `${plan.name} — isSubscribed=${b.isSubscribed}, outlets=${b.subBrandsLimit}, showcase=${b.showcaseLimit}`;
  });

  step("draft + approved voucher versions (submit / publish ke liye)", async () => {
    const ctx = brands[0];

    // A DRAFT the collection can submit for review.
    const draft = await Voucher.create({
      createdBy: ctx.user._id,
      brandId: ctx.brand._id,
      name: "postman draft voucher",
      normalizedName: "postman draft voucher",
      voucherCode: "VCH-90000003",
      status: VOUCHER_STATUSES.DRAFT,
    });
    const draftVersion = await VoucherVersion.create({
      voucherId: draft._id,
      brandId: ctx.brand._id,
      versionNumber: 1,
      name: draft.name,
      description: "seeded draft",
      categoryId: category._id,
      subCategoryId: subCategory._id,
      images: [
        { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", sortOrder: 1 },
      ],
      offers: [
        {
          title: "flat 50 off above 300",
          minBillAmount: 300,
          discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
          discountValue: 50,
          sortOrder: 1,
        },
      ],
      startAt: new Date(Date.now() + 86400000),
      endAt: new Date(Date.now() + 86400000 * 45),
      status: VOUCHER_STATUSES.DRAFT,
      versionCode: "VCH-90000003-V1",
      createdBy: ctx.user._id,
    });
    await Voucher.updateOne(
      { _id: draft._id },
      { currentVersionId: draftVersion._id },
    );
    await VoucherSubBrand.create({
      createdBy: ctx.user._id,
      voucherId: draft._id,
      voucherVersionId: draftVersion._id,
      brandId: ctx.brand._id,
      subBrandId: ctx.outlet._id,
      subBrandName: ctx.brand.brandName,
      storeId: ctx.outlet.storeId,
      locationId: ctx.location._id,
      geo: ctx.outlet.geo,
    });

    // An APPROVED version the collection can publish. Approval itself is an
    // admin action, so seeding it is the only way the vendor publish endpoint
    // is reachable in a vendor-only run.
    const approved = await Voucher.create({
      createdBy: ctx.user._id,
      brandId: ctx.brand._id,
      name: "postman approved voucher",
      normalizedName: "postman approved voucher",
      voucherCode: "VCH-90000004",
      status: VOUCHER_STATUSES.APPROVED,
    });
    const approvedVersion = await VoucherVersion.create({
      voucherId: approved._id,
      brandId: ctx.brand._id,
      versionNumber: 1,
      name: approved.name,
      description: "seeded approved",
      categoryId: category._id,
      subCategoryId: subCategory._id,
      images: [
        { url: "https://res.cloudinary.com/demo/image/upload/sample.jpg", sortOrder: 1 },
      ],
      offers: [
        {
          title: "flat 75 off above 400",
          minBillAmount: 400,
          discountType: VOUCHER_DISCOUNT_TYPES.FLAT,
          discountValue: 75,
          sortOrder: 1,
        },
      ],
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() + 86400000 * 45),
      status: VOUCHER_STATUSES.APPROVED,
      versionCode: "VCH-90000004-V1",
      createdBy: ctx.user._id,
      approvedBy: admin._id,
      approvedAt: new Date(),
    });
    await Voucher.updateOne(
      { _id: approved._id },
      { currentVersionId: approvedVersion._id },
    );
    await VoucherSubBrand.create({
      createdBy: ctx.user._id,
      voucherId: approved._id,
      voucherVersionId: approvedVersion._id,
      brandId: ctx.brand._id,
      subBrandId: ctx.outlet._id,
      subBrandName: ctx.brand.brandName,
      storeId: ctx.outlet.storeId,
      locationId: ctx.location._id,
      geo: ctx.outlet.geo,
    });

    return `draft=${draft.voucherCode}, approved version=${approvedVersion.versionCode}`;
  });

  step("legal documents", async () => {
    await TermAndCondition.create({
      title: "postman seed terms of use",
      description: "Seeded Terms. Case and markup are preserved here on purpose.",
      type: "CUSTOMER",
      isActive: true,
    });
    await PrivacyAndPolicy.create({
      title: "postman seed privacy policy",
      description: "Seeded Privacy Policy.",
      type: "CUSTOMER",
      isActive: true,
    });
    return "1 terms + 1 privacy";
  });

  // ── execute ──────────────────────────────────────────────────────────────
  for (const { what, fn } of plan) {
    if (!APPLY) {
      log(`  would: ${what}`);
      continue;
    }
    const detail = await fn();
    log(`  ✅ ${what}${detail ? ` — ${detail}` : ""}`);
  }

  if (APPLY) {
    log(`
Seeded.

Customer collection ke liye:
  customer_whatsapp   koi bhi naya 10-digit number (collection khud signup kar legi)

Vendor collection ke liye — seeded vendor ka number use karein, warna naya vendor
banega jiska brand na approved hoga na subscribed:

  vendor_whatsapp     ${brands[0].user.whatsappNumber}   (${brands[0].brand.brandName})
  brand_id            ${brands[0].brand._id}

Server isi database pe chalayein:

  MONGO_URL=<...>/${DB} npm run dev
`);
  }
};

run()
  .catch((e) => {
    console.error("\nFAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  });
