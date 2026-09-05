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
const fs = require("fs");
const path = require("path");
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

/**
 * The seeded customer's number, and it has to be a fixed one.
 *
 * The money folders read a claim, a payment, a refund and a bank account that
 * belong to a specific customer, so the collection has to sign in **as** that
 * customer. `customer-local.postman_environment.json` defaults
 * `customer_whatsapp` to this value; change it in both places or neither.
 */
const CUSTOMER_WHATSAPP = "9700000021";
/** The second customer, whose money the first one must not be able to open. */
const OTHER_CUSTOMER_WHATSAPP = "9700000022";

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

  /**
   * ── drop shadow indexes before writing any money rows ────────────────────
   *
   * ⚠️ This scratch database carried `invoiceId_1` and `razorpayOrderId_1` —
   * **blanket** unique indexes on nullable paths, the exact pair `CLAUDE.md`
   * documents. Mongo indexes a missing field as `null`, so a blanket unique on
   * a nullable path rejects the **second** row that has no value yet: seeding
   * two unsettled transactions died on `dup key: { invoiceId: null }`, naming a
   * field the fixture never set.
   *
   * `reapShadowIndexes` normally runs at boot and hourly — but a capture run
   * starts the server with `ENABLE_JOBS=false` (so sweeps do not fire mid-run),
   * which is precisely why nothing had reaped them here.
   *
   * Safe by the helper's own two conditions: it only drops a blanket unique
   * that is **already superseded** by a partial unique on the same key, and if
   * that replacement is missing it drops nothing at all.
   */
  const { reapShadowIndexes } = require("../helpers/transactions");
  const reaped = await reapShadowIndexes();
  const dropped = Array.isArray(reaped) ? reaped.length : reaped?.dropped?.length || 0;
  if (dropped) log(`  🧹 reaped ${dropped} shadow index(es) before seeding`);

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

    /**
     * The money rows go first, and they are keyed on the **customer**, not the
     * user — a `VoucherClaim` carries `customerId`, so deleting the `User` rows
     * without resolving their `Customer` first leaves orphaned claims that the
     * next run's listing picks up. Those rows outlive the seed they belong to
     * and there is nothing in the output to say so.
     */
    const Customer = require("../models/Customer");
    const CustomerBankAccount = require("../models/CustomerBankAccount");
    const VoucherClaim = require("../models/VoucherClaim");
    const VoucherClaimHistory = require("../models/VoucherClaimHistory");
    const Transaction = require("../models/Transaction");
    const RefundRequest = require("../models/RefundRequest");

    const customers = await Customer.find({
      uniqueId: new RegExp(MARK),
    }).select("_id");
    const customerIds = customers.map((c) => c._id);
    const claims = await VoucherClaim.find({
      customerId: { $in: customerIds },
    }).select("_id");
    const claimIds = claims.map((c) => c._id);

    const Notification = require("../models/Notification");

    await Promise.all([
      RefundRequest.deleteMany({ customerId: { $in: customerIds } }),
      VoucherClaimHistory.deleteMany({ claimId: { $in: claimIds } }),
      VoucherClaim.deleteMany({ _id: { $in: claimIds } }),
      Transaction.deleteMany({ customerId: { $in: customerIds } }),
      CustomerBankAccount.deleteMany({ customerId: { $in: customerIds } }),
      // Keyed on the customer, like the rows themselves — see the note where
      // they are written. Leaving these behind would grow the feed by three on
      // every re-seed and quietly break the `unreadCount` assertions.
      Notification.deleteMany({ customerId: { $in: customerIds } }),
      Customer.deleteMany({ _id: { $in: customerIds } }),
    ]);

    /**
     * ⚠️ By **brand** as well as by customer.
     *
     * `Transaction.deleteMany({ customerId })` above misses every row that has
     * no customer — a vendor's subscription payment is exactly that shape, so
     * the seeded one survived the clear and the next run died on
     * `razorpayOrderId_unique_partial`. The failure reads as a duplicate id
     * bug; the cause is a clear that did not clear.
     *
     * Settlements were never cleared at all, so they accumulated one pair per
     * run and `Settlement.findOne().sort({createdAt: -1})` started picking a
     * settlement whose transactions had already been deleted.
     */
    const Settlement = require("../models/Settlement");
    await Promise.all([
      Transaction.deleteMany({ brandId: { $in: brandIds } }),
      RefundRequest.deleteMany({ brandId: { $in: brandIds } }),
      Settlement.deleteMany({ brandId: { $in: brandIds } }),

      /**
       * ⚠️ And by the id's own marker, because `brandId` stops being a handle.
       *
       * A row seeded in run N points at a brand that run N+1 deleted. By run
       * N+2 that brandId matches nothing, so every filter above walks past it
       * — and the row is still holding `order_pmfxsub1` on a unique index. The
       * seed then fails with a duplicate-key error that looks like a bug in
       * the id it is generating rather than in the clear that left the old one
       * behind. The marker is on the value itself, so it survives the orphaning.
       */
      Transaction.deleteMany({ razorpayOrderId: new RegExp(MARK, "i") }),
      Transaction.deleteMany({ invoiceId: new RegExp(MARK, "i") }),
    ]);

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
  /**
   * The published vouchers, kept so the money fixtures below can build a claim
   * against a real one. `makeVoucher` returns the master; the claim also needs
   * the published version id, so each entry carries both.
   */
  const vouchers = [];
  /** The seeded customer and their money history — see the step at the bottom. */
  let money = null;

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
    vouchers.push(await makeVoucher({
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
    }));

    // No banner on this one, so the `bannerType: null` contract is exercised too.
    vouchers.push(await makeVoucher({
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
    }));

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

    /**
     * ⚠️ `maxOpenRequests` raised from its default of **1**.
     *
     * The seeded customer needs an open refund parked in
     * `AWAITING_BANK_DETAILS` — it is the only status
     * `PATCH /refunds/:id/bank-account` accepts. With the limit at 1, that one
     * row consumed the whole allowance, so `POST /refunds` could **never**
     * succeed: it answered *"You already have a refund in progress"*, which
     * then left `refund_request_id` empty, which made the withdraw request hit
     * `/refunds//withdraw` and come back as the router's catch-all
     * `404 "Invalid API"` — a fixture problem wearing three different disguises.
     *
     * Raising it is fixture configuration, not a workaround: the allowance is
     * admin-configurable by design, and this scratch database needs two open
     * refunds to demonstrate both halves of the flow.
     */
    if (!setting.customer.refund) setting.customer.refund = {};
    setting.customer.refund.maxOpenRequests = 3;

    /**
     * The public app config, so `GET /app-config` has something real to answer.
     *
     * Left at defaults it returns empty strings for every support field, and the
     * captured example would document the endpoint as useless. ⚠️ `forceUpdate`
     * stays **false** and `minVersion` stays low on purpose: a fixture that
     * locks every client out is a fixture that makes the rest of the collection
     * look broken.
     */
    if (!setting.app) setting.app = {};
    setting.app.support = {
      email: "help@trydood.com",
      phone: "1800-000-000",
      whatsapp: "9700000001",
    };
    setting.app.minVersion = { android: "1.0.0", ios: "1.0.0" };
    setting.app.latestVersion = { android: "1.4.0", ios: "1.4.0" };
    setting.app.forceUpdate = false;
    setting.app.storeUrl = {
      android: "https://play.google.com/store/apps/details?id=com.trydood",
      ios: "https://apps.apple.com/app/trydood/id0000000000",
    };
    // All on — the collection exercises promo, refunds, claims and search.
    setting.app.features = {
      promoCodes: true,
      refunds: true,
      voucherClaims: true,
      search: true,
    };

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

  /**
   * ── the customer, and a money history for them ───────────────────────────
   *
   * ### Why the customer is seeded at all
   *
   * Everything above is browsable by a guest, so the collection could always
   * sign up a throwaway number and read it. The money folders cannot: a claim
   * list needs a claim, a refund needs a payment, and a bank account needs a
   * penny drop we are not going to pay for on every run.
   *
   * So the customer is seeded with a **known** WhatsApp number and a history
   * attached to it, and `customer_whatsapp` defaults to that number. This is the
   * same arrangement the vendor collection already uses for its seeded vendor,
   * and for the same reason.
   *
   * ⚠️ It does **not** break the signup tests in folder `00`. `verifyOtp` is
   * commented out on the WhatsApp path, so any 6-digit code signs this customer
   * in, and the `isFirst` assertion compares request 2 against request 1 rather
   * than against `true` — it is a "did not change" regression, not a "is a new
   * user" one. Point `customer_whatsapp` at a fresh number instead and folders
   * `00`–`10` still pass; only the money folders go empty.
   *
   * ### What cannot be seeded, and is not
   *
   * `POST /bank-accounts/otp` and `POST /bank-accounts` are left to run for
   * real — the first sends a message we pay for, the second is a live CGPey
   * penny drop against a real bank. Seeding an already-verified row is what lets
   * the **list**, the **delete** and the refund's **bank-account choice** be
   * captured truthfully without either.
   */
  step("customer + money history (claims, payment, refund, bank account)", async () => {
    const Customer = require("../models/Customer");
    const CustomerBankAccount = require("../models/CustomerBankAccount");
    const VoucherClaim = require("../models/VoucherClaim");
    const Transaction = require("../models/Transaction");
    const RefundRequest = require("../models/RefundRequest");

    const { buildClaimPreview } = require("../helpers/vouchers/buildClaimPreview");
    const {
      generateClaimCode,
      buildVoucherInvoiceSnapshot,
    } = require("../helpers/voucherClaims");
    const {
      TRANSACTION_PURPOSE,
      ACCOUNT_FOR_PURPOSE,
      SETTLEMENT_STAGE,
    } = require("../constants/transaction");
    const { PAYMENT_STATUS } = require("../constants");
    const { PAYMENT_GATEWAYS } = require("../constants/subscription");
    const { VOUCHER_CLAIM_STATUS } = require("../constants/voucherClaim");
    const { REFUND_REQUEST_STATUS } = require("../constants/refund");

    const ctx = brands[0];
    const voucher = vouchers[0];
    const version = await VoucherVersion.findOne({
      voucherId: voucher._id,
      status: VOUCHER_STATUSES.PUBLISHED,
    }).lean();

    /**
     * Brand B, so the vendor collection has a row it must be **refused**.
     *
     * ⚠️ A fabricated id proves nothing here. `GET /voucher-claims/:id` answers
     * 404 for an id that does not exist whether the ownership check works or
     * not — so a 403 test built on a made-up id passes with the check deleted.
     * It has to be a real claim belonging to a real other brand.
     */
    const brandA = { ctx, voucher, version };
    const otherCtx = brands[1];
    const otherVoucher = vouchers[1];
    const otherVersion = await VoucherVersion.findOne({
      voucherId: otherVoucher._id,
      status: VOUCHER_STATUSES.PUBLISHED,
    }).lean();
    const brandB = {
      ctx: otherCtx,
      voucher: otherVoucher,
      version: otherVersion,
    };

    /** One customer, with the User row the auth path expects to find. */
    const makeCustomer = async ({ key, whatsapp, name }) => {
      const user = await User.create({
        name,
        role: ROLES.CUSTOMER,
        whatsappNumber: whatsapp,
        uniqueId: `USR-${MARK}-${key}`,
        referralCode: `${MARK}C${key}`,
      });
      const customer = await Customer.create({
        userId: user._id,
        uniqueId: `#TC${MARK}${key}`,
        fullName: name,
        whatsappNumber: whatsapp,
      });
      return { user, customer };
    };

    /**
     * A paid claim and the payment behind it.
     *
     * ⚠️ `pricing` comes from `buildClaimPreview` — the **same** builder the live
     * `create-order` path runs — rather than being typed out here. Hand-written
     * money numbers are how a fixture starts disagreeing with the API it is
     * meant to demonstrate, and every captured example built on it inherits the
     * lie.
     */
    /** Makes every seeded Razorpay order id distinct — see `suffix` below. */
    let claimSeq = 0;

    /**
     * @param {number} offerIndex which of the voucher's offers to claim against.
     *
     * ⚠️ Not cosmetic. `claim_usageSlot_oncePerUser` is unique on
     * `{voucherId, customerId, offerId}`, so one customer cannot hold two claims
     * on the **same** voucher *and* offer — that is the once-per-user rule, and
     * seeding a second claim with `offerIndex: 0` fails with E11000. The spare
     * claim uses offer 1, which needs a bill over its own `minBillAmount`.
     */
    const makePaidClaim = async ({
      owner,
      billAmount,
      settled,
      offerIndex = 0,
      /**
       * Which brand's voucher this claim is against — `brandA` unless told
       * otherwise. Destructured below so the body keeps reading `ctx`,
       * `voucher` and `version`; the parameter default is evaluated in the
       * parameter scope, so it still sees the outer ones.
       */
      on = brandA,
    }) => {
      const { ctx, voucher, version } = on;
      const preview = await buildClaimPreview({
        voucherId: voucher._id,
        outletId: ctx.outlet._id,
        billAmount,
        offerId: version.offers?.[offerIndex]?._id || null,
        actor: { customerId: owner.customer },
      });

      const pricing = preview.pricing;
      const offer = version.offers?.[offerIndex] || null;
      /**
       * ⚠️ Unique per **claim**, not per owner.
       *
       * This was `owner.user.uniqueId.slice(-4)`, so both of the primary
       * customer's claims produced `order_PMFXcust` and the second one died on
       * `razorpayOrderId_1` — a blanket unique index. The counter is what makes
       * a second claim for the same customer possible at all.
       */
      claimSeq += 1;
      const suffix = `${owner.user.uniqueId.slice(-4).toLowerCase()}${claimSeq}`;

      const claim = await VoucherClaim.create({
        customerId: owner.customer._id,
        userId: owner.user._id,
        voucherId: voucher._id,
        voucherVersionId: version._id,
        versionNumber: version.versionNumber,
        offerId: offer?._id || null,
        brandId: ctx.brand._id,
        subBrandId: ctx.outlet._id,

        // Frozen at claim time, exactly as createVoucherClaimOrder freezes them.
        offerSnapshot: offer ? JSON.parse(JSON.stringify(offer)) : undefined,
        voucherSnapshot: {
          name: voucher.name,
          categoryId: voucher.categoryId,
          subCategoryId: voucher.subCategoryId,
        },
        brandSnapshot: { name: ctx.brand.brandName },
        outletSnapshot: {
          uniqueId: ctx.outlet.uniqueId,
          storeId: ctx.outlet.storeId,
          state: ctx.location?.state || null,
        },

        billAmount,
        offerApplied: preview.offerApplied,
        pricing,

        status: VOUCHER_CLAIM_STATUS.PAID,
        // Set the moment the claim exists, never at payment — see CLAUDE.md.
        holdsUsageSlot: true,
        claimCode: await generateClaimCode(),
      });

      const transaction = await Transaction.create({
        purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
        gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.VOUCHER_CLAIM],
        customerId: owner.customer._id,
        userId: owner.user._id,
        brandId: ctx.brand._id,
        subBrandId: ctx.outlet._id,
        voucherId: voucher._id,
        createdBy: owner.user._id,
        gateway: PAYMENT_GATEWAYS.RAZORPAY,
        amount: pricing.totalPayable,
        currency: pricing.currency,
        dueAmount: 0,
        paidAmount: pricing.totalPayable,
        status: PAYMENT_STATUS.CAPTURED,
        verified: true,
        verifiedAt: new Date(),
        razorpayOrderId: `order_${MARK}${suffix}`,
        razorpayPaymentId: `pay_${MARK}${suffix}`,

        // The denormalised copy a settlement totals without joining every claim.
        voucher: {
          claimId: claim._id,
          voucherId: voucher._id,
          voucherVersionId: version._id,
          versionNumber: version.versionNumber,
          offerId: offer?._id || null,
          billAmount: pricing.billAmount,
          offerDiscount: pricing.offerDiscount,
          convenienceFee: pricing.convenienceFee,
          netBill: pricing.netBill,
          vendorPayable: pricing.vendorPayable,
          platformPromoCost: pricing.platformPromoCost,
          vendorPromoCost: pricing.vendorPromoCost,
          commissionPercent: pricing.commissionPercent,
          commissionAmount: pricing.commissionAmount,
          commissionTax: pricing.commissionTax,
          commissionDeduction: pricing.commissionDeduction,
        },

        /**
         * The invoice link's whole credential. Seeded so
         * `GET /transactions/invoice/:token` has something real to answer —
         * without it that endpoint can only ever demonstrate its 404.
         */
        ...(settled
          ? {
              invoiceToken: `${MARK.toLowerCase()}invoicetoken${suffix}0000000000000000`,
              /**
               * ⚠️ Numbered by `claimSeq`, like `razorpayOrderId` above.
               *
               * This was `000${settled ? 1 : 2}` — and the branch is inside
               * `if (settled)`, so it was `0001` for **every** settled claim.
               * One was fine; the vendor fixtures need three, and the second
               * died on `invoiceId_unique_partial`.
               */
              invoiceId: `TD/${new Date().getFullYear()}/${MARK}/${String(claimSeq).padStart(4, "0")}`,
              invoiceUrl:
                "https://res.cloudinary.com/demo/image/upload/sample.pdf",
              settlementStage: SETTLEMENT_STAGE.COMPLETE,
            }
          : {}),
      });

      await VoucherClaim.updateOne(
        { _id: claim._id },
        { $set: { transactionId: transaction._id } },
      );

      /**
       * ⚠️ `invoiceSnapshot`, not just `invoiceToken`.
       *
       * `getInvoiceByToken` refuses with **409 "This invoice is not ready yet"**
       * when the snapshot is absent, and it is right to: a settled transaction
       * always has one, so its absence means the settle never reached the
       * invoice stage. Generating a document from live data that may have moved
       * since would paper over exactly the bug the resume job exists to fix.
       *
       * Built by `buildVoucherInvoiceSnapshot` — the same helper the real settle
       * calls — so the seeded invoice carries the numbers the API would have
       * frozen, not numbers typed out here.
       */
      if (settled) {
        const snapshot = buildVoucherInvoiceSnapshot({
          transaction,
          claim,
          seller: { name: ctx.brand.brandName },
          billTo: { name: owner.customer.fullName },
        });
        await Transaction.updateOne(
          { _id: transaction._id },
          { $set: { invoiceSnapshot: snapshot } },
        );
        transaction.invoiceSnapshot = snapshot;
      }

      return { claim, transaction, pricing };
    };

    const primary = await makeCustomer({
      key: "CUST",
      whatsapp: CUSTOMER_WHATSAPP,
      name: "postman seed customer",
    });

    /**
     * ⚠️ A **second** customer with their own claim, and not for symmetry.
     *
     * Two requests in the collection assert that one customer cannot open
     * another's payment or refund another's claim. Without these rows the
     * `{{other_customer_*}}` variables stayed empty, the literal `{{…}}` went
     * into the body, and both `objectId()` validators answered **422 "Invalid
     * claimId."** — so the tests failed on the wrong thing, and would have gone
     * green again the moment somebody "fixed" them by accepting a 422. What they
     * exist to check is whether one customer can see another's money.
     */
    const other = await makeCustomer({
      key: "OTHR",
      whatsapp: OTHER_CUSTOMER_WHATSAPP,
      name: "postman seed other customer",
    });

    const paid = await makePaidClaim({
      owner: primary,
      billAmount: 1000,
      settled: true,
    });

    /**
     * A **second** paid claim for the same customer, with no refund on it.
     *
     * `POST /refunds` needs a claim that is not already refunded, and claim A
     * carries the parked `AWAITING_BANK_DETAILS` refund. With only one claim the
     * refund request had nothing eligible to aim at, so its captured example was
     * a refusal and `refund_request_id` was never set — which then broke the
     * withdraw request too.
     */
    const paidSpare = await makePaidClaim({
      owner: primary,
      // Offer 1 is "flat 150 off above 800", so the bill has to clear 800.
      billAmount: 900,
      settled: false,
      offerIndex: 1,
    });

    const otherPaid = await makePaidClaim({
      owner: other,
      billAmount: 600,
      settled: false,
    });

    /**
     * The same customer, on **brand B**. This is the row every cross-brand 403
     * in the vendor collection points at — see the note on `brandB` above.
     *
     * Settled, so it is also eligible for brand B's settlement below and the
     * "somebody else's payout" test has a real settlement to be refused from.
     */
    const otherBrandPaid = await makePaidClaim({
      owner: other,
      billAmount: 700,
      settled: true,
      on: brandB,
    });

    /**
     * A verified account, standing in for a penny drop nobody paid for.
     *
     * `isVerified: true` is what every payout path checks, so this row is a
     * usable destination — which is the point: it makes the list, the delete and
     * the refund's bank-account choice all capturable for real.
     */
    const makeAccount = async ({ accountNumber, last4, bank, branch }) =>
      CustomerBankAccount.create({
        customerId: primary.customer._id,
        accountHolderName: "postman seed customer",
        accountNumber,
        maskedAccountNumber: accountNumber.replace(/\d(?=\d{4})/g, "*"),
        accountLast4Digits: last4,
        ifscCode: "HDFC0001234",
        bankName: bank,
        branchName: branch,
        isVerified: true,
        verifiedAt: new Date(),
        isNameMatch: true,
        matchingScore: 100,
      });

    const account = await makeAccount({
      accountNumber: "912010004512345",
      last4: "2345",
      bank: "HDFC Bank",
      branch: "Indore Vijay Nagar",
    });

    /**
     * A **spare** account, and the delete request targets this one.
     *
     * ⚠️ `PATCH /refunds/:id/bank-account` (folder 12) attaches `account` above
     * to the parked refund, and `DELETE /bank-accounts/:id` then refuses with
     * `409 "A refund is waiting to be paid into this account"` — correct
     * behaviour, but it meant the delete could never demonstrate its success.
     * Folder 12 runs before folder 13, so ordering cannot fix it; a second
     * account can.
     */
    const spareAccount = await makeAccount({
      accountNumber: "912010009988776",
      last4: "8776",
      bank: "HDFC Bank",
      branch: "Indore Palasia",
    });

    /**
     * A refund parked in `AWAITING_BANK_DETAILS`, which is the **only** status
     * `PATCH /refunds/:requestId/bank-account` accepts.
     *
     * Reaching it through the API needs an admin to have tried `SOURCE`, watched
     * it fail against a closed instrument, and then asked for bank details — a
     * three-actor sequence the customer collection cannot drive. Seeding the
     * state is what makes the customer's half of that flow demonstrable.
     */
    /**
     * ⚠️ `claimId` must be **this** customer's claim.
     *
     * It briefly pointed at the other customer's claim while carrying the
     * primary customer's `customerId`. The bank-details endpoint only checks
     * `customerId` + status, so every test still passed — and the row was
     * nonsense: a refund on a purchase its owner never made. A fixture that
     * lies in a way no assertion reads is worse than one that fails.
     */
    const awaitingBank = await RefundRequest.create({
      claimId: paid.claim._id,
      transactionId: paid.transaction._id,
      customerId: primary.customer._id,
      brandId: ctx.brand._id,
      requestedAmount: 200,
      approvedAmount: 200,
      status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
      reason: "OTHER",
      reasonNote: "Seeded so the bank-details step has something to answer.",
      method: "MANUAL_BANK",
      isOpen: true,
    });

    /**
     * ── the vendor's side of the same money ──────────────────────────────────
     *
     * Folders 18-20 of the vendor collection (Voucher Claims, Refunds,
     * Settlements) have never carried a captured example, and this is why:
     * every id they need is one a vendor **cannot produce**. A vendor does not
     * create claims, does not open refunds, and does not build settlements — a
     * customer and a nightly job do. So none of it can be captured from an
     * earlier request in the run the way `voucher_id` or `section_id` are.
     *
     * ⚠️ Three separate refunds, not one.
     *
     * The folder's approve, reject and "raise the amount → 422" requests all
     * pointed at a single `{{refund_request_id}}`, in that order. Approve
     * decides it, so reject then ran against an already-decided refund and the
     * 422 arrived for "already decided" rather than for the raised amount —
     * a test that fails, or passes, for a reason unrelated to what it claims to
     * check. Each gets its own row.
     */
    const vendorCustA = await makeCustomer({
      key: "24",
      whatsapp: "9700000024",
      name: "postman vendor-side customer a",
    });
    const vendorCustB = await makeCustomer({
      key: "25",
      whatsapp: "9700000025",
      name: "postman vendor-side customer b",
    });

    /**
     * ⚠️ Each claim needs a distinct `{voucher, customer, offer}`.
     *
     * `claim_usageSlot_oncePerUser` is unique on exactly that triple (where
     * `holdsUsageSlot: true`), which is the once-per-user rule. Brand A's
     * voucher carries two offers and brand B's carries one, so extra customers
     * — not extra claims per customer — are what buys the rows below.
     */
    const settleA = await makePaidClaim({
      owner: vendorCustA,
      billAmount: 900,
      settled: true,
    });
    const approveTarget = await makePaidClaim({
      owner: vendorCustA,
      billAmount: 900,
      settled: false,
      offerIndex: 1,
    });
    const rejectTarget = await makePaidClaim({
      owner: vendorCustB,
      billAmount: 900,
      settled: false,
    });
    const raiseTarget = await makePaidClaim({
      owner: vendorCustB,
      billAmount: 900,
      settled: false,
      offerIndex: 1,
    });
    /** Brand B's own settled sale, so its settlement has something in it. */
    const settleB = await makePaidClaim({
      owner: vendorCustA,
      billAmount: 800,
      settled: true,
      on: brandB,
    });

    /**
     * A refund the vendor still has to decide.
     *
     * ⚠️ `settlementHold: true` on the payment, because that is what opening a
     * refund really does — the money stops being eligible for any settlement
     * the moment somebody asks for it back. Leaving it false would let these
     * payments into the settlement below, so the fixture would demonstrate
     * exactly the "paid the vendor, now claw it back" case the hold exists to
     * make impossible.
     */
    const makeOpenRefund = async ({ source, brandId, requestedAmount, note }) => {
      await Transaction.updateOne(
        { _id: source.transaction._id },
        { $set: { settlementHold: true } },
      );
      return RefundRequest.create({
        claimId: source.claim._id,
        transactionId: source.transaction._id,
        customerId: source.claim.customerId,
        brandId,
        requestedAmount,
        status: REFUND_REQUEST_STATUS.REQUESTED,
        reason: "OTHER",
        reasonNote: note,
        isOpen: true,
      });
    };

    const approveRefund = await makeOpenRefund({
      source: approveTarget,
      brandId: ctx.brand._id,
      requestedAmount: 400,
      note: "Seeded for the vendor approve example.",
    });
    const rejectRefund = await makeOpenRefund({
      source: rejectTarget,
      brandId: ctx.brand._id,
      requestedAmount: 400,
      note: "Seeded for the vendor reject example.",
    });
    const raiseRefund = await makeOpenRefund({
      source: raiseTarget,
      brandId: ctx.brand._id,
      requestedAmount: 400,
      note: "Seeded so approving a *raised* amount can show its 422.",
    });
    const otherBrandRefund = await makeOpenRefund({
      source: otherBrandPaid,
      brandId: otherCtx.brand._id,
      requestedAmount: 300,
      note: "Belongs to brand B — the vendor collection's 403.",
    });

    /**
     * ── settlements, built by the real job ───────────────────────────────────
     *
     * ⚠️ Not written by hand. `Settlement` carries gross, commission, tax,
     * reserve, refund clawbacks and `reserveBasis` — hand-typing those is how a
     * fixture starts disagreeing with the arithmetic it is meant to
     * demonstrate, and every captured example inherits the lie. The seeder
     * already takes this line with `buildClaimPreview` for claim pricing.
     *
     * Eligibility is a date test, so the two settled payments are backdated
     * past the configured `delayDays` and `payoutBufferHours` first —
     * `fundsReceivedAt` is *observed from Razorpay* in production, never
     * inferred, which is exactly why nothing in the seed path sets it.
     */
    const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await Transaction.updateMany(
      {
        _id: { $in: [settleA.transaction._id, settleB.transaction._id] },
      },
      { $set: { verifiedAt: FIVE_DAYS_AGO, fundsReceivedAt: FIVE_DAYS_AGO } },
    );

    const { buildSettlements } = require("../services/settlements");
    await buildSettlements();

    const Settlement = require("../models/Settlement");
    const settlementA = await Settlement.findOne({ brandId: ctx.brand._id })
      .sort({ createdAt: -1 })
      .lean();
    const settlementB = await Settlement.findOne({
      brandId: otherCtx.brand._id,
    })
      .sort({ createdAt: -1 })
      .lean();

    /**
     * A subscription payment, so `GET /voucher-claims/payments/:id` can show
     * its **404** against a transaction that genuinely exists.
     *
     * ⚠️ One collection holds both purposes and `buildTransactionFilter` is
     * what keeps them apart. Pointing that test at a fabricated id would prove
     * only that a missing row 404s — not that a *subscription* row is refused
     * by the claim surface, which is the thing worth knowing.
     */
    const subscriptionTxn = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION],
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      brandId: ctx.brand._id,
      userId: ctx.user._id,
      amount: 4999,
      status: PAYMENT_STATUS.CAPTURED,
      verified: true,
      razorpayOrderId: `order_${MARK.toLowerCase()}sub1`,
      razorpayPaymentId: `pay_${MARK.toLowerCase()}sub1`,
    });

    /**
     * ── the customer's notification feed ─────────────────────────────────────
     *
     * Written directly rather than through `notify()`, for the same reason the
     * claims are: `notify()` also **delivers** — it would send real email for
     * every seeded row, on every re-seed.
     *
     * ⚠️ Keyed on `customerId`, not `userId`. That is how `refundNotices` and
     * `voucherClaimNotices` write them, and it is what the customer feed scopes
     * on; seeding them against `userId` would produce rows the feed cannot see
     * and a fixture that silently proves nothing.
     *
     * A mix on purpose: two unread and one already read, so the `unreadCount`
     * badge has something to be right about, and a row carrying `meta.claimId`
     * so the deep-link whitelist is actually exercised.
     */
    const Notification = require("../models/Notification");
    const {
      NOTIFICATION_AUDIENCE,
      NOTIFICATION_TYPES,
      NOTIFICATION_SEVERITY,
    } = require("../constants/notification");

    const notifications = await Notification.insertMany([
      {
        customerId: primary.customer._id,
        audience: NOTIFICATION_AUDIENCE.CUSTOMER,
        type: NOTIFICATION_TYPES.VOUCHER_PAYMENT_SUCCESS,
        severity: NOTIFICATION_SEVERITY.INFO,
        title: "Payment received",
        body: `Your voucher is ready. Show ${paid.claim.claimCode} at the counter.`,
        meta: {
          claimId: paid.claim._id,
          claimCode: paid.claim.claimCode,
          transactionId: paid.transaction._id,
          brandId: ctx.brand._id,
          // ⚠️ Deliberately here and deliberately never returned to a customer —
          // the projection is a whitelist, so this row proves it holds.
          internalNote: "seeded — must never reach the customer projection",
        },
        isRead: false,
      },
      {
        customerId: primary.customer._id,
        audience: NOTIFICATION_AUDIENCE.CUSTOMER,
        type: NOTIFICATION_TYPES.REFUND_REQUESTED,
        severity: NOTIFICATION_SEVERITY.INFO,
        title: "We have your refund request",
        body: "We have asked the outlet about it. We will let you know as soon as there is an answer.",
        meta: { refundRequestId: awaitingBank._id, claimId: paid.claim._id },
        isRead: false,
      },
      {
        customerId: primary.customer._id,
        audience: NOTIFICATION_AUDIENCE.CUSTOMER,
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        severity: NOTIFICATION_SEVERITY.INFO,
        title: "Welcome to Trydood",
        body: "Browse offers near you and save on every bill.",
        isRead: true,
        readAt: new Date(),
      },
      /**
       * ⚠️ The **other** customer's row, and the scope test needs it to be real.
       *
       * `mark-read` proves ownership by matching nothing rather than by refusing
       * — so the test has to send a **valid id that belongs to somebody else**.
       * A made-up ObjectId would also return `matched: 0`, and would keep doing
       * so if the scope were removed entirely: the test would pass while
       * checking nothing at all.
       */
      {
        customerId: other.customer._id,
        audience: NOTIFICATION_AUDIENCE.CUSTOMER,
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        severity: NOTIFICATION_SEVERITY.INFO,
        title: "Welcome to Trydood",
        body: "This row belongs to the other seeded customer, on purpose.",
        isRead: false,
      },
    ]);

    money = {
      primary,
      other,
      paid,
      paidSpare,
      otherPaid,
      account,
      spareAccount,
      awaitingBank,
      notifications,
      // The offer the claim flow prices against — see the note where it is written.
      offerId: version.offers?.[0]?._id || null,

      // ── what the vendor collection's money folders read ──
      vendor: {
        settleA,
        settleB,
        otherBrandPaid,
        approveRefund,
        rejectRefund,
        raiseRefund,
        otherBrandRefund,
        settlementA,
        settlementB,
        subscriptionTxn,
      },
    };

    return [
      `customer ${CUSTOMER_WHATSAPP}`,
      `1 paid+settled claim`,
      `1 verified bank account`,
      `1 refund AWAITING_BANK_DETAILS`,
      `+ other customer ${OTHER_CUSTOMER_WHATSAPP} with their own claim`,
    ].join(" · ");
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

  /**
   * ── write the seeded ids into the Postman environment ────────────────────
   *
   * Five of the collection's variables cannot be captured by the collection
   * itself: `bank_account_id` needs a paid penny drop, `invoice_token` is
   * deliberately never returned by any endpoint, `awaiting_bank_refund_id`
   * needs an admin to have watched a `SOURCE` refund fail, and the two
   * `other_customer_*` ids belong to a different customer on purpose.
   *
   * ⚠️ They used to be printed and left for someone to paste. Nobody did, so
   * the two cross-customer 403 tests sent the literal `{{other_customer_claim_id}}`,
   * `objectId()` rejected it, and both answered **422 instead of 403** — failing
   * for the wrong reason, and one lazy "fix" away from being permanently green
   * while checking nothing. Writing them here removes the manual step that was
   * never going to happen.
   *
   * ⚠️ Order matters: **generate, then seed, then capture.** Re-running
   * `postman/generate-customer-collection.js` rewrites the environment with
   * empty values, so it has to run before this, not after.
   */
  /**
   * Write a set of ids into one environment file.
   *
   * ⚠️ A missing key **throws** rather than being skipped. A variable the
   * collection references but the environment does not declare is not an empty
   * string — Postman sends `{{claim_id}}` literally, so the request lands on
   * the router's catch-all and answers `404 Invalid API`, a refusal that reads
   * as a routing bug and has nothing to do with claims. `validate-collection.js`
   * refuses it too, so failing loudly here is the cheaper of the two.
   */
  const writeEnvIds = (file, seeded) => {
    const envPath = path.join(__dirname, "..", "postman", "environments", file);

    if (!fs.existsSync(envPath)) {
      log(`\n  ⚠️  ${file} not found — skipped writing ids.`);
      return;
    }

    const raw = fs.readFileSync(envPath, "utf8");
    const env = JSON.parse(raw);
    const missing = [];

    for (const [key, value] of Object.entries(seeded)) {
      const row = env.values.find((v) => v.key === key);
      if (row) row.value = value;
      else missing.push(key);
    }

    if (missing.length) {
      throw new Error(
        `${file} is missing ${missing.join(", ")} — re-run the matching ` +
          "postman/generate-*-collection.js first.",
      );
    }

    // These files are CRLF; matching the generator's own output keeps the diff
    // to the values that actually changed.
    const CRLF = raw.includes("\r\n");
    const out = JSON.stringify(env, null, 2) + "\n";
    fs.writeFileSync(envPath, CRLF ? out.replace(/\n/g, "\r\n") : out);
    log(`  ✅ wrote ${Object.keys(seeded).length} ids into ${file}`);
  };

  if (APPLY && money) {
    log("");
    {
      const seeded = {
        customer_whatsapp: CUSTOMER_WHATSAPP,
        /**
         * ⚠️ The claim order needs this and the collection cannot capture it.
         *
         * `offerId` is optional in the validator but **not nullable**, so an
         * empty `{{offer_id}}` is not "no offer" — it is
         * `422 "Body.offerId is not allowed to be empty"`, and the whole claim
         * flow stops at its first request. The offers live on the published
         * `VoucherVersion`, which no customer endpoint returns by id.
         */
        offer_id: String(money.offerId || ""),
        /** The claim `POST /refunds` aims at — no refund on it yet. */
        refundable_claim_id: String(money.paidSpare.claim._id),
        bank_account_id: String(money.account._id),
        /** The one nothing points at, so `DELETE` can show its 200. */
        spare_bank_account_id: String(money.spareAccount._id),
        /**
         * A real notification belonging to the **other** customer. The scope
         * test needs a valid id it is not allowed to touch — a fabricated one
         * would return `matched: 0` even with no scoping at all.
         */
        other_customer_notification_id: String(
          money.notifications[money.notifications.length - 1]._id,
        ),
        invoice_token: String(money.paid.transaction.invoiceToken),
        awaiting_bank_refund_id: String(money.awaitingBank._id),
        other_customer_claim_id: String(money.otherPaid.claim._id),
        other_customer_transaction_id: String(money.otherPaid.transaction._id),
      };
      writeEnvIds("customer-local.postman_environment.json", seeded);
    }

    /**
     * ── the vendor side ──
     *
     * None of these can be captured from an earlier request in the run: a
     * vendor cannot create a claim, cannot open a refund, and cannot build a
     * settlement. Which is exactly why folders 18-20 have never had an example.
     */
    {
      const v = money.vendor;
      const seeded = {
        brand_id: String(brands[0].brand._id),
        sub_brand_id: String(brands[0].outlet._id),

        /** A settled sale on this vendor's own brand. */
        claim_id: String(v.settleA.claim._id),
        claim_code: String(v.settleA.claim.claimCode || ""),
        claim_transaction_id: String(v.settleA.transaction._id),

        /** Real rows on brand B — see the note where they are seeded. */
        other_brand_claim_id: String(v.otherBrandPaid.claim._id),
        other_brand_refund_id: String(v.otherBrandRefund._id),
        other_brand_settlement_id: String(v.settlementB?._id || ""),

        /**
         * ⚠️ Three refunds, one per decision the folder demonstrates. Sharing
         * one made reject and the 422 run against a refund approve had already
         * decided.
         */
        refund_request_id: String(v.approveRefund._id),
        rejectable_refund_id: String(v.rejectRefund._id),
        raise_refund_id: String(v.raiseRefund._id),

        settlement_id: String(v.settlementA?._id || ""),
        subscription_transaction_id: String(v.subscriptionTxn._id),
      };
      writeEnvIds("vendor-local.postman_environment.json", seeded);
    }
  }

  if (APPLY) {
    log(`
Seeded.

Customer collection ke liye — seeded customer ka number use karein, warna money
folders (11 Claims / 12 Refunds / 13 Bank Accounts) khaali chalenge:

  customer_whatsapp         ${CUSTOMER_WHATSAPP}   (claim + payment + refund + bank account)
  other_customer_whatsapp   ${OTHER_CUSTOMER_WHATSAPP}   (403 cross-customer tests)

Ye teen ids environment me pehle se bhar di jaati hain (collection inhe khud
capture nahi kar sakti — inke liye admin ya live penny drop chahiye):

  bank_account_id               ${money ? money.account._id : "—"}
  invoice_token                 ${money ? money.paid.transaction.invoiceToken : "—"}
  awaiting_bank_refund_id       ${money ? money.awaitingBank._id : "—"}
  other_customer_claim_id       ${money ? money.otherPaid.claim._id : "—"}
  other_customer_transaction_id ${money ? money.otherPaid.transaction._id : "—"}

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
