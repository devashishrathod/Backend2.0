const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const PromoCode = require("../../models/PromoCode");
const SubCategory = require("../../models/SubCategory");
const VoucherVersion = require("../../models/VoucherVersion");

/**
 * Live counts of everything that points at a category or a sub-category.
 *
 * These are **derived on read, never stored**. A `brandCount` field on the
 * Category document would have to be decremented from every place a brand can
 * leave a category — the brand delete, the brand's own category change, the
 * voucher version publish, the promo update, a restore — and the one path
 * somebody forgets does not error, it just serves a number that is quietly
 * wrong for ever. Counting the rows that exist cannot drift: a soft delete
 * flips `isDeleted` and the next read is already lower.
 *
 * Every count therefore filters `isDeleted: false`, which is what "jo actual
 * me exist karta hai" means here. `active` is the subset that also has
 * `isActive: true`, so the admin panel can show "41 / 48 active" without a
 * second call.
 */

const emptyCount = () => ({ total: 0, active: 0 });

// `$isActive` alone would count a missing field as inactive; every one of these
// schemas defaults it to true, so compare explicitly and let a stray absent
// field fall to the inactive side rather than inventing a value for it.
const ACTIVE_SUM = { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } };

const toObjectIds = (ids) =>
  (Array.isArray(ids) ? ids : [ids])
    .filter(Boolean)
    .map((id) =>
      id instanceof mongoose.Types.ObjectId
        ? id
        : new mongoose.Types.ObjectId(String(id)),
    );

/** Rows keyed by the id they were grouped on, for O(1) lookup per result row. */
const indexRows = (rows) => {
  const map = new Map();
  rows.forEach(({ _id, total, active }) =>
    map.set(String(_id), { total, active }),
  );
  return map;
};

/** Referencing collections that hold a single ObjectId — Brand, SubCategory. */
const countByField = (Model, field, ids) =>
  Model.aggregate([
    { $match: { [field]: { $in: ids }, isDeleted: false } },
    { $group: { _id: `$${field}`, total: { $sum: 1 }, active: ACTIVE_SUM } },
  ]);

/**
 * Referencing collections that hold an array — PromoCode.categoryIds.
 *
 * The second `$match` is not redundant: `$unwind` also emits the ids of the
 * *other* categories a matching promo code is scoped to, and grouping on those
 * would report counts for categories nobody asked about.
 */
const countByArrayField = (Model, field, ids) =>
  Model.aggregate([
    { $match: { [field]: { $in: ids }, isDeleted: false } },
    { $unwind: `$${field}` },
    { $match: { [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, total: { $sum: 1 }, active: ACTIVE_SUM } },
  ]);

/**
 * Vouchers, counted through the version that is current *today*.
 *
 * The category lives on `VoucherVersion`, not on the master `Voucher`, and a
 * voucher keeps every version it has ever had. Counting versions would count
 * one voucher many times, and counting *any* version that ever carried the
 * category would keep a voucher in its old category for ever after the vendor
 * moved it — the two categories would then add up to more vouchers than exist.
 *
 * Matching `currentVersionId` gives exactly one row per voucher, so no distinct
 * pass is needed, and the answer changes the moment a new version is made
 * current. `active` comes off the master voucher, which is the switch the admin
 * panel actually toggles.
 */
const countVouchers = (field, ids) =>
  VoucherVersion.aggregate([
    { $match: { [field]: { $in: ids }, isDeleted: false } },
    {
      $lookup: {
        from: "vouchers",
        let: { voucherId: "$voucherId", versionId: "$_id" },
        pipeline: [
          {
            $match: {
              isDeleted: false,
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$voucherId"] },
                  { $eq: ["$currentVersionId", "$$versionId"] },
                ],
              },
            },
          },
          { $project: { isActive: 1 } },
        ],
        as: "voucher",
      },
    },
    { $unwind: "$voucher" },
    {
      $group: {
        _id: `$${field}`,
        total: { $sum: 1 },
        active: {
          $sum: { $cond: [{ $eq: ["$voucher.isActive", true] }, 1, 0] },
        },
      },
    },
  ]);

/**
 * @param {Array<string|ObjectId>} categoryIds
 * @returns {Promise<Object>} stats keyed by category id string
 */
exports.buildCategoryStats = async (categoryIds) => {
  const ids = toObjectIds(categoryIds);
  if (!ids.length) return {};

  const [subCategories, brands, vouchers, promoCodes] = await Promise.all([
    countByField(SubCategory, "categoryId", ids),
    countByField(Brand, "categoryId", ids),
    countVouchers("categoryId", ids),
    countByArrayField(PromoCode, "categoryIds", ids),
  ]);

  const maps = {
    subCategories: indexRows(subCategories),
    brands: indexRows(brands),
    vouchers: indexRows(vouchers),
    promoCodes: indexRows(promoCodes),
  };

  const stats = {};
  ids.forEach((id) => {
    const key = String(id);
    stats[key] = {
      subCategories: maps.subCategories.get(key) || emptyCount(),
      brands: maps.brands.get(key) || emptyCount(),
      vouchers: maps.vouchers.get(key) || emptyCount(),
      promoCodes: maps.promoCodes.get(key) || emptyCount(),
    };
  });
  return stats;
};

/**
 * Sub-categories carry no `promoCodes` key at all. `PromoCode` scopes by
 * `categoryIds` only — there is no sub-category field on it — and a permanent
 * `0` would read as "none right now" rather than "this link does not exist".
 *
 * @param {Array<string|ObjectId>} subCategoryIds
 * @returns {Promise<Object>} stats keyed by sub-category id string
 */
exports.buildSubCategoryStats = async (subCategoryIds) => {
  const ids = toObjectIds(subCategoryIds);
  if (!ids.length) return {};

  const [brands, vouchers] = await Promise.all([
    countByField(Brand, "subCategoryId", ids),
    countVouchers("subCategoryId", ids),
  ]);

  const brandMap = indexRows(brands);
  const voucherMap = indexRows(vouchers);

  const stats = {};
  ids.forEach((id) => {
    const key = String(id);
    stats[key] = {
      brands: brandMap.get(key) || emptyCount(),
      vouchers: voucherMap.get(key) || emptyCount(),
    };
  });
  return stats;
};

/**
 * Hang the counts off each row under a single `stats` key.
 *
 * Nothing already in the response is touched or renamed — the mobile app keeps
 * reading exactly the fields it reads today, and everything new is one object
 * deeper.
 *
 * @param {Object[]} rows plain objects carrying `_id`
 * @param {Function} build `buildCategoryStats` or `buildSubCategoryStats`
 */
exports.attachStats = async (rows, build) => {
  if (!rows?.length) return rows || [];
  const stats = await build(rows.map((row) => row._id));
  return rows.map((row) => ({ ...row, stats: stats[String(row._id)] }));
};
