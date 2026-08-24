const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const Voucher = require("../../models/Voucher");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { OUTLET_TYPES } = require("../../constants");
const { BUCKET_BRAND_FIELDS } = require("../../constants/subscription");
const {
  VOUCHER_SLOT_CONSUMING_STATUSES,
} = require("../../constants/voucher");

/**
 * How each metered bucket derives its true usage. The owning collection is the
 * source of truth; the `*Used` counters on Brand are only a cache that the hot
 * path increments atomically.
 */
const COUNTERS = Object.freeze({
  subBrands: (brandId) =>
    SubBrand.countDocuments({
      brandId,
      outletType: OUTLET_TYPES.OUTLET,
      isDeleted: false,
    }),
  franchises: (brandId) =>
    SubBrand.countDocuments({
      brandId,
      outletType: OUTLET_TYPES.FRANCHISE,
      isDeleted: false,
    }),
  // Expired / archived / rejected vouchers release their slot, so a vendor does
  // not have to delete history to create something new.
  vouchers: (brandId) =>
    Voucher.countDocuments({
      brandId,
      isDeleted: false,
      status: { $in: VOUCHER_SLOT_CONSUMING_STATUSES },
    }),
  showcase: (brandId) =>
    ShowcaseSection.countDocuments({ brandId, isDeleted: false }),
});

/**
 * Rebuild a brand's usage counters from the rows that actually exist.
 *
 * This is the reconciler for the cached `*Used` fields. It matters most for
 * vouchers, whose usage changes without any API call — the expiry job can free
 * slots in the background — so a counter left alone would drift.
 *
 * Run on every plan change, by the voucher expiry job, on any voucher status
 * transition, and from the admin resync endpoint.
 *
 * @param {string|object} brandId
 * @param {string[]} [buckets]  limit the recount to specific buckets
 * @returns {Promise<object>} counts keyed by the Brand field name, plus `drifted`
 */
exports.recountBrandUsage = async (brandId, buckets) => {
  const targets = (buckets?.length ? buckets : Object.keys(COUNTERS)).filter(
    (bucket) => COUNTERS[bucket],
  );

  const counts = await Promise.all(
    targets.map((bucket) => COUNTERS[bucket](brandId)),
  );

  const $set = {};
  const selected = [];
  targets.forEach((bucket, index) => {
    const field = BUCKET_BRAND_FIELDS[bucket].used;
    $set[field] = counts[index];
    selected.push(field);
  });

  // `returnDocument: "before"` gives the pre-update values so drift can be
  // reported; `new: false` means the same thing but is deprecated in Mongoose 9.
  const before = await Brand.findByIdAndUpdate(
    brandId,
    { $set },
    { returnDocument: "before" },
  )
    .select(selected.join(" "))
    .lean();

  const changes = [];
  if (before) {
    targets.forEach((bucket, index) => {
      const field = BUCKET_BRAND_FIELDS[bucket].used;
      const was = before[field] ?? 0;
      if (was !== counts[index]) {
        changes.push(`${field} ${before[field]} -> ${counts[index]}`);
      }
    });
  }

  if (changes.length) {
    console.warn(
      `[recountBrandUsage] brand ${brandId} counters drifted — ${changes.join(", ")}`,
    );
  }

  const result = { drifted: changes.length > 0, changes };
  targets.forEach((bucket, index) => {
    result[BUCKET_BRAND_FIELDS[bucket].used] = counts[index];
  });
  return result;
};

exports.USAGE_COUNTERS = COUNTERS;
