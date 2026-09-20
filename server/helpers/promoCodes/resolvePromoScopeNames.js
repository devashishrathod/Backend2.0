const Brand = require("../../models/Brand");
const Category = require("../../models/Category");
const Voucher = require("../../models/Voucher");
const Subscription = require("../../models/Subscription");

/** Unique, stringified ids across every code on the page. */
const collect = (promos, field) => {
  const ids = new Set();
  for (const promo of promos) {
    for (const id of promo?.[field] || []) ids.add(String(id));
  }
  return [...ids];
};

/**
 * Load a name per id, or skip the query entirely when nothing on the page is
 * scoped that way. A `Map` keyed by string, because an ObjectId is never `===`
 * another ObjectId.
 */
const loadNames = async (Model, ids, field) => {
  if (!ids.length) return new Map();
  const rows = await Model.find({ _id: { $in: ids } })
    .select(`_id ${field}`)
    .lean();
  return new Map(rows.map((row) => [String(row._id), row[field]]));
};

/**
 * The names behind a page of promo codes' scope lists.
 *
 * A derived term has to say "Valid at Cafe Mocha" rather than "Valid at
 * 68f1…c2a9", and doing that per code would be four lookups a row. This
 * resolves the whole page in **four queries total**, each skipped when no code
 * on the page uses that scope.
 *
 * ⚠️ Deleted rows are not excluded. A brand that has since been removed still
 * has to appear in the terms of a code scoped to it, or the card would read as
 * though there were no restriction at all — which is the one thing a scope term
 * must never do. Anything that genuinely cannot be resolved falls through as
 * `undefined`, and `buildPromoTerms` turns that into the generic wording.
 *
 * @param {object[]} promos
 * @returns {Promise<{brands: Map, categories: Map, vouchers: Map, plans: Map}>}
 */
exports.resolvePromoScopeNames = async (promos = []) => {
  const [brands, categories, vouchers, plans] = await Promise.all([
    loadNames(Brand, collect(promos, "brandIds"), "brandName"),
    loadNames(Category, collect(promos, "categoryIds"), "name"),
    loadNames(Voucher, collect(promos, "voucherIds"), "name"),
    loadNames(Subscription, collect(promos, "subscriptionIds"), "name"),
  ]);

  return { brands, categories, vouchers, plans };
};

/**
 * One code's slice of the resolved names, in the shape `buildPromoTerms` reads.
 */
exports.pickScopeNames = (promo, resolved) => ({
  brands: (promo.brandIds || []).map((id) => resolved.brands.get(String(id))),
  categories: (promo.categoryIds || []).map((id) =>
    resolved.categories.get(String(id)),
  ),
  vouchers: (promo.voucherIds || []).map((id) =>
    resolved.vouchers.get(String(id)),
  ),
  plans: (promo.subscriptionIds || []).map((id) =>
    resolved.plans.get(String(id)),
  ),
});
