const mongoose = require("mongoose");
const Follow = require("../../models/Follow");
const BrandAvoidance = require("../../models/BrandAvoidance");
/**
 * ⚠️ The leaf module, never `require("../customers")`.
 *
 * `helpers/brands/index.js` is pulled in by the customer-facing services, and a
 * barrel round-trip through `helpers/customers/index.js` is exactly the loop
 * documented at the top of `helpers/customers/customerStats.js` — the binding
 * resolves to `undefined` for the life of the process and fails much later as a
 * bare "not a function". The leaf requires only mongoose, so it has no loop.
 */
const { resolveCustomerId } = require("../customers/resolveCustomerId");

/**
 * What a caller with no customer identity gets: both answers, both false.
 *
 * Returned as two present keys rather than omitted, because a guest browsing a
 * brand profile still renders a follow button — it just renders it unpressed. A
 * missing key would make the app choose between "not followed" and "unknown",
 * and it has no way to tell those apart.
 */
const NO_RELATIONSHIP = Object.freeze({ isFollowed: false, isAvoided: false });

/**
 * Does this customer follow, or avoid, each of these brands?
 *
 * ### Why one map rather than a field on each query
 *
 * Both answers are per **viewer**, so they cannot be projected inside the brand
 * pipelines the way `followersCount` and `isVerified` are — those are facts
 * about the brand and are the same for everybody. A `$lookup` per row would work
 * but runs once per brand on every listing; two `$in` reads over the ids a page
 * actually returned is two indexed queries however long the page is.
 *
 * ### The two collections name the same pair differently
 *
 * `Follow` keys on `followerId` / `followeeId`, `BrandAvoidance` on
 * `customerId` / `brandId`, and **both are soft-deleted** — an unfollow flips
 * `isDeleted` rather than removing the row, so a query without `isDeleted:
 * false` reports every brand the customer has *ever* followed as followed.
 * Their partial unique indexes are filtered on exactly that, so stating it is
 * also what lets each query use its index.
 *
 * @param {object|string} actor `req`, `req.customerId`, a document, or an id.
 *                              A guest resolves to `null`, which is not an error.
 * @param {Array} brandIds      the brand ids on the page being answered
 * @returns {Promise<Map<string, {isFollowed: boolean, isAvoided: boolean}>>}
 *          keyed by brand id as a string; absent means neither.
 */
exports.buildBrandRelationshipMap = async (actor, brandIds = []) => {
  const map = new Map();

  // A guest, a vendor or an admin has no Customer row. Nothing to ask, and an
  // empty map answers `false` for every brand through `brandRelationshipFor`.
  const customerId = resolveCustomerId(actor);
  if (!customerId) return map;

  const ids = [];
  const seen = new Set();
  for (const brandId of brandIds || []) {
    if (!brandId) continue;
    const key = String(brandId);
    // A malformed id is dropped rather than thrown on: this decorates a
    // response that has already been built, and it may not fail it.
    if (seen.has(key) || !mongoose.Types.ObjectId.isValid(key)) continue;
    seen.add(key);
    ids.push(new mongoose.Types.ObjectId(key));
  }
  if (ids.length === 0) return map;

  const [follows, avoidances] = await Promise.all([
    Follow.find({
      followerId: customerId,
      followeeId: { $in: ids },
      isDeleted: false,
    })
      .select("followeeId")
      .lean(),
    BrandAvoidance.find({
      customerId,
      brandId: { $in: ids },
      isDeleted: false,
    })
      .select("brandId")
      .lean(),
  ]);

  for (const row of follows) {
    const key = String(row.followeeId);
    map.set(key, { ...(map.get(key) || NO_RELATIONSHIP), isFollowed: true });
  }
  for (const row of avoidances) {
    const key = String(row.brandId);
    map.set(key, { ...(map.get(key) || NO_RELATIONSHIP), isAvoided: true });
  }

  return map;
};

/**
 * One brand's answer out of the map, always as two booleans.
 *
 * Spread rather than returned by reference so a caller that mutates the result
 * cannot reach back into the map — or into the frozen default.
 */
exports.brandRelationshipFor = (map, brandId) => {
  const hit = brandId && map ? map.get(String(brandId)) : null;
  return hit ? { ...hit } : { ...NO_RELATIONSHIP };
};

/**
 * The single-brand case — a profile screen, or one payment's brand block.
 *
 * Goes through the same map so the detail page and the row it was opened from
 * can never disagree about whether the customer follows that brand.
 */
exports.getBrandRelationship = async (actor, brandId) => {
  const map = await exports.buildBrandRelationshipMap(actor, [brandId]);
  return exports.brandRelationshipFor(map, brandId);
};

exports.NO_RELATIONSHIP = NO_RELATIONSHIP;
