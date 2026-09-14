const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");

/**
 * A brand's **live** plan name, for every surface that shows one.
 *
 * ### ⚠️ Why this does not read `Brand.subscribedId`
 *
 * The customer voucher listing used to resolve the plan by joining
 * `brand.subscribedId → subscribeds → subscriptions` and projecting only
 * `{ subscriptionId: 1 }` — no `status`, no `endDate`. That pointer is a
 * denormalised cache, and `syncBrandSubscriptionState` says outright what it
 * does on expiry:
 *
 * > `subscribedId` keeps pointing at the most recent plan even once it lapses,
 * > so the existing brand/voucher lookups still have something to join
 * > against; only `isSubscribed` flips to false.
 *
 * So a brand whose Pro plan died six months ago still rendered a **"Pro"**
 * badge on the customer's home feed, indefinitely. Nothing reported it: the
 * join succeeded, the name was real, and the only field that knew better
 * (`isSubscribed`) was never projected. A customer cannot tell the difference
 * between a paying brand and one that stopped, and neither could we.
 *
 * This resolves the plan the way `getActiveSubscription` defines it —
 * `status === ACTIVE` **and** `endDate > now`, together — keyed on `brandId`
 * rather than the cached pointer. That makes it self-correcting: a brand whose
 * pointer was never synced still reports its real plan, and a lapsed one
 * reports `null` whether or not the expiry job has run.
 *
 * ⚠️ It does **not** self-heal. `getActiveSubscription` flips a stuck
 * `ACTIVE`-with-a-past-`endDate` row to `EXPIRED` on the spot; these are
 * read-only customer endpoints and must not write, exactly as `heal: false`
 * exists for. The *answer* is identical either way — `endDate > now` excludes
 * the stuck row regardless — so only the repair is skipped, never the truth.
 *
 * Indexed by `{ brandId: 1, status: 1, endDate: -1, isDeleted: 1 }`, which the
 * `Subscribed` schema already declares for precisely this query shape.
 */

/**
 * Aggregation stages that set `as` to the brand's live plan name, or `null`.
 *
 * Emits its own `$lookup` rather than going through `buildAggregateLookup`:
 * that helper joins on a single equality and takes no extra match, and the
 * whole point here is the `status` + `endDate` pair. `$sort` + `$limit 1`
 * inside the sub-pipeline picks the furthest-dated plan when a brand holds two
 * live ones (an upgrade mid-term leaves both ACTIVE until the sweep runs),
 * matching `getActiveSubscription`'s `.sort({ endDate: -1 })`.
 *
 * @param {object} options
 * @param {string} options.localField  path to the brand id on the current doc
 *                                     — `"_id"` on a Brand, `"brandId"` on a
 *                                     Transaction, `"voucher.brandId"` in the
 *                                     voucher pipeline.
 * @param {string} [options.as]        where to write the name. A dotted path
 *                                     works, so `"brand.subscriptionPlan"`
 *                                     lands it beside `brand.merchantId`.
 * @returns {object[]} stages to spread into a pipeline
 */
exports.buildBrandPlanLookup = ({ localField, as = "subscriptionPlan" }) => {
  const segments = as.split(".");
  if (segments.length > 2) {
    // Guarded rather than silently mis-set: the `$mergeObjects` below rebuilds
    // exactly one parent, so `a.b.c` would write a field nothing reads.
    throw new Error(
      `buildBrandPlanLookup: "as" supports at most one level of nesting, got "${as}"`,
    );
  }

  const planName = {
    // `$ifNull` because an empty join array yields `undefined`, and an absent
    // key reads to a client as "the server forgot" rather than "this brand has
    // no plan". Every other nullable field in these responses is explicit.
    $ifNull: [{ $arrayElemAt: ["$__brandPlanDetail.name", 0] }, null],
  };

  /**
   * Writing the name into place.
   *
   * A plain `$addFields: { "brand.subscriptionPlan": … }` looks right and is
   * wrong at the edges: on a document where the brand join matched nothing,
   * `brand` is **absent** (every caller unwinds with
   * `preserveNullAndEmptyArrays`), and setting a dotted path under it
   * *fabricates* `brand: { subscriptionPlan: null }`. A client testing
   * `if (payment.brand)` would then get a truthy object with no name and no id
   * — worse than the honest absence it replaced.
   *
   * So a nested target is merged onto the parent only when the parent is
   * actually an object, and left exactly as it was otherwise.
   */
  const write =
    segments.length === 1
      ? { $addFields: { [as]: planName } }
      : {
          $set: {
            [segments[0]]: {
              $cond: [
                { $eq: [{ $type: `$${segments[0]}` }, "object"] },
                {
                  $mergeObjects: [
                    `$${segments[0]}`,
                    { [segments[1]]: planName },
                  ],
                },
                `$${segments[0]}`,
              ],
            },
          },
        };

  return [
    {
      $lookup: {
        from: "subscribeds",
        let: { brandId: `$${localField}` },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$brandId", "$$brandId"] },
              status: SUBSCRIBED_STATUS.ACTIVE,
              // Built per request, the same way the voucher pipeline's own
              // start/end window is.
              endDate: { $gt: new Date() },
              isDeleted: false,
            },
          },
          { $sort: { endDate: -1 } },
          { $limit: 1 },
          { $project: { subscriptionId: 1 } },
        ],
        as: "__brandPlan",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        let: {
          subscriptionId: { $arrayElemAt: ["$__brandPlan.subscriptionId", 0] },
        },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$subscriptionId"] } } },
          // Only the label. Price, entitlements and limits are the vendor's
          // billing detail and have no business on a customer screen.
          { $project: { name: 1 } },
        ],
        as: "__brandPlanDetail",
      },
    },
    write,
    // The scratch arrays never reach a response. Cleaned up here rather than
    // relied on being dropped by a later `$project`, because several callers
    // ($group, or no final projection at all) have no such stage.
    { $project: { __brandPlan: 0, __brandPlanDetail: 0 } },
  ];
};

/**
 * The same answer for call sites that hold documents rather than a pipeline.
 *
 * The claim and payment detail endpoints read their brand with
 * `Brand.findById(...).select(...)` after an access check, so there is no
 * aggregation to hang a `$lookup` on. Batched by design — the listing variants
 * resolve a page of brands in two queries rather than two per row.
 *
 * @param {Array<string|object>} brandIds
 * @returns {Promise<Map<string, string|null>>} brand id (as a string) → plan
 *          name, with an explicit `null` for every id that has no live plan.
 *          Every id asked for is present in the map, so a caller never has to
 *          tell "no plan" apart from "not looked up".
 */
exports.resolveBrandPlanNames = async (brandIds = []) => {
  const ids = [...new Set(brandIds.filter(Boolean).map(String))];
  const names = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return names;

  const live = await Subscribed.find({
    brandId: { $in: ids },
    status: SUBSCRIBED_STATUS.ACTIVE,
    endDate: { $gt: new Date() },
    isDeleted: false,
  })
    .select("brandId subscriptionId")
    .sort({ endDate: -1 })
    .lean();

  // Sorted furthest-dated first, so the first row seen for a brand is the one
  // the aggregation variant's `$limit: 1` would have picked. Two live plans
  // must not resolve differently depending on which helper the caller used.
  const planIdOf = new Map();
  for (const row of live) {
    const key = String(row.brandId);
    if (!planIdOf.has(key)) planIdOf.set(key, row.subscriptionId);
  }

  const planIds = [
    ...new Set([...planIdOf.values()].filter(Boolean).map(String)),
  ];
  if (!planIds.length) return names;

  const plans = await Subscription.find({ _id: { $in: planIds } })
    .select("name")
    .lean();
  const nameOf = new Map(
    plans.map((plan) => [String(plan._id), plan.name || null]),
  );

  for (const [brandKey, planId] of planIdOf) {
    names.set(brandKey, nameOf.get(String(planId)) ?? null);
  }

  return names;
};

/**
 * One brand's live plan name, or `null`. Thin wrapper over the batch form so a
 * single-record endpoint does not spell out the Map dance.
 */
exports.resolveBrandPlanName = async (brandId) => {
  if (!brandId) return null;
  const names = await exports.resolveBrandPlanNames([brandId]);
  return names.get(String(brandId)) ?? null;
};
