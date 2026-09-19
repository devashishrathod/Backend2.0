const mongoose = require("mongoose");
const { VOUCHER_SORT_BY } = require("../../constants/voucher");
const { buildAggregateLookup } = require("../../database");
const { pickVoucherBanner } = require("./pickVoucherBanner");
const { escapeRegex } = require("../../validator/common");
// Required by file rather than through the barrel: `helpers/subscribeds` pulls
// `helpers/transactions`, and going through the barrel drags that whole graph
// in for two `$lookup` stages. Same reason `buildInvoiceSnapshot` reaches for
// `../subscribeds/formatDuration` directly.
const { buildBrandPlanLookup } = require("../subscribeds/brandPlanLookup");

exports.buildCustomerVoucherPipeline = ({
  latitude,
  longitude,
  maxDistance,
  query,
}) => {
  const pipeline = [];
  const sortBy = query.sortBy || VOUCHER_SORT_BY.DISTANCE;
  // RELEVANCE only makes sense with an actual search term to score against;
  // without one, it falls back to NEWEST (handled in the final $sort below).
  const useRelevance = sortBy === VOUCHER_SORT_BY.RELEVANCE && !!query.search;

  /**
   * ------------------------------------------------
   * 1. NEAREST SUBBRANDS FIRST
   * ------------------------------------------------
   */

  pipeline.push({
    $geoNear: {
      near: {
        type: "Point",
        coordinates: [Number(longitude), Number(latitude)],
      },

      key: "geo",

      distanceField: "distanceInMeters",

      maxDistance,

      spherical: true,

      query: {
        isActive: true,
        isDeleted: false,
      },
    },
  });

  /**
   * ------------------------------------------------
   * 2. VoucherSubBrand mapping
   * ------------------------------------------------
   */

  pipeline.push({
    $lookup: {
      from: "vouchersubbrands",

      let: {
        subBrandId: "$_id",
      },

      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ["$subBrandId", "$$subBrandId"],
            },

            isActive: true,
            isDeleted: false,
          },
        },

        {
          $project: {
            _id: 1,
            voucherVersionId: 1,
            subBrandId: 1,
          },
        },
      ],

      as: "voucherMappings",
    },
  });

  pipeline.push({
    $unwind: "$voucherMappings",
  });

  /**
   * ------------------------------------------------
   * 3. Published Version
   * ------------------------------------------------
   */

  pipeline.push({
    $lookup: {
      from: "voucherversions",

      let: {
        versionId: "$voucherMappings.voucherVersionId",
      },

      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ["$_id", "$$versionId"],
            },

            status: "PUBLISHED",

            isActive: true,

            isDeleted: false,

            startAt: {
              $lte: new Date(),
            },

            endAt: {
              $gt: new Date(),
            },
          },
        },

        {
          $project: {
            _id: 1,
            voucherId: 1,
            versionNumber: 1,
            images: 1,
            offers: 1,
            description: 1,
            startAt: 1,
            endAt: 1,
            // ⚠️ The taxonomy lives HERE, on the version — `Voucher` has no
            // `categoryId` field at all. See the note on the category filter
            // below for what reading it off the master silently did.
            categoryId: 1,
            subCategoryId: 1,
          },
        },
      ],

      as: "version",
    },
  });

  pipeline.push({
    $unwind: "$version",
  });

  // Storage internals go no further than this line. See the constant.
  pipeline.push(NARROW_VERSION_IMAGES);

  /**
   * ------------------------------------------------
   * 4. Voucher Master
   * ------------------------------------------------
   */

  pipeline.push({
    $lookup: {
      from: "vouchers",

      let: {
        voucherId: "$version.voucherId",
      },

      pipeline: [
        {
          $match: {
            $expr: {
              $eq: ["$_id", "$$voucherId"],
            },

            isActive: true,

            isDeleted: false,

            // $text must be the first stage of this sub-pipeline, so it's
            // folded into this same $match rather than a separate stage.
            ...(useRelevance ? { $text: { $search: query.search } } : {}),
          },
        },

        {
          $project: {
            _id: 1,
            name: 1,
            categoryId: 1,
            subCategoryId: 1,
            createdAt: 1,
            brandId: 1,
            // The master-level promo banner. Lives on the Voucher, not the
            // version, so it is unaffected by the approval flow.
            banner: 1,
            // Admin curation — drives the "Suggestions" tab and the pinned
            // rows at the top of the main list.
            isSuggested: 1,
            suggestionOrder: 1,
            ...(useRelevance ? { relevanceScore: { $meta: "textScore" } } : {}),
          },
        },
      ],

      as: "voucher",
    },
  });

  pipeline.push({
    $unwind: "$voucher",
  });

  /**
   * ------------------------------------------------
   * 4b. Brand (general details + subscription plan)
   * ------------------------------------------------
   */

  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "voucher.brandId",
      as: "brand",
      project: {
        brandName: 1,
        description: 1,
        legalBusinessName: 1,
        merchantId: 1,
        uniqueId: 1,
        isActive: 1,
        isApproved: 1,
        // Read by the verification match below, not returned to the client.
        isRejected: 1,
        isRevoked: 1,
        joinedDate: 1,
      },
    }),
  );

  /**
   * ⚠️ Only a verified brand's vouchers reach a customer.
   *
   * The join above already pulled `isApproved` — but only to render the
   * verified badge, never to decide whether the row should be here at all. So
   * an unverified brand's vouchers sat in the feed with the badge simply
   * switched off, which reads to a customer as "not verified yet" rather than
   * "should not be on your screen".
   *
   * `isRejected` and `isRevoked` are **absent** on brands written before those
   * flags existed, and in an aggregation expression absent is not false — hence
   * `$ifNull` on each. `CLAUDE.md` records this trap costing two shipped bugs.
   */
  pipeline.push({
    $match: {
      $expr: {
        $and: [
          { $eq: [{ $ifNull: ["$brand.isActive", false] }, true] },
          { $eq: [{ $ifNull: ["$brand.isApproved", false] }, true] },
          { $ne: [{ $ifNull: ["$brand.isRejected", false] }, true] },
          { $ne: [{ $ifNull: ["$brand.isRevoked", false] }, true] },
        ],
      },
    },
  });

  /**
   * ------------------------------------------------
   * 5. Optional category filter
   * ------------------------------------------------
   */

  // The "Suggestions" tab. Without it the same endpoint returns everything with
  // the suggestions pinned on top, which is what "view more" needs.
  if (query.suggestedOnly) {
    pipeline.push({ $match: { "voucher.isSuggested": true } });
  }

  /**
   * ⚠️ `version`, not `voucher`.
   *
   * A voucher's category is set per **version** — `VoucherVersion.categoryId`
   * is `required: true`, and the master `Voucher` schema has no such field at
   * all. These two filters used to match `voucher.categoryId`, a path that is
   * missing on every document in the collection, so **every** category-filtered
   * request matched nothing and the endpoint answered 404 "No any voucher
   * found".
   *
   * Nothing reported it as a fault: to the client an empty category is
   * indistinguishable from a category with no live offers, and the 404 is the
   * same one a genuinely empty listing returns. The projected `categoryId` and
   * `subCategoryId` on every row were `undefined` for the same reason.
   */
  if (query.categoryId) {
    pipeline.push({
      $match: {
        "version.categoryId": new mongoose.Types.ObjectId(query.categoryId),
      },
    });
  }

  if (query.subCategoryId) {
    pipeline.push({
      $match: {
        "version.subCategoryId": new mongoose.Types.ObjectId(
          query.subCategoryId,
        ),
      },
    });
  }

  /**
   * ------------------------------------------------
   * 6. Search
   * ------------------------------------------------
   */

  if (query.search && !useRelevance) {
    /**
     * ⚠️ Escaped. This term comes straight from a search box, and `(` alone is
     * an invalid pattern — Mongo throws and the customer gets a 500 for typing
     * a bracket. `.` and `*` are worse: they parse fine and match everything.
     * Before this it was interpolated raw.
     */
    const term = escapeRegex(String(query.search).trim());

    /**
     * Offer titles count too.
     *
     * "buy 1 get 1" is almost never in a voucher's name — it is the offer, and
     * lives on `version.offers[].title`. Matching only the name meant the
     * phrase customers actually type found nothing. `offers` is an array, so
     * the dotted path matches if any one offer does.
     */
    pipeline.push({
      $match: {
        $or: [
          { "voucher.name": { $regex: term, $options: "i" } },
          { "version.offers.title": { $regex: term, $options: "i" } },
        ],
      },
    });
  }

  /**
   * ------------------------------------------------
   * 7. Keep nearest outlet first
   * ------------------------------------------------
   */

  pipeline.push({
    $sort: {
      distanceInMeters: 1,
      "voucher.createdAt": -1,
    },
  });

  /**
   * ------------------------------------------------
   * 8. UNIQUE VOUCHER
   *
   * Same voucher can have 20 outlets.
   * Customer home page gets only one.
   * ------------------------------------------------
   */

  pipeline.push({
    $group: {
      _id: "$voucher._id",

      voucher: {
        $first: "$voucher",
      },

      version: {
        $first: "$version",
      },

      brand: {
        $first: "$brand",
      },

      nearestOutlet: {
        $first: {
          subBrandId: "$_id",

          distanceInMeters: "$distanceInMeters",

          geo: "$geo",

          locationId: "$locationId",

          workHoursId: "$workHoursId",

          uniqueId: "$uniqueId",

          storeId: "$storeId",

          logo: "$logo",

          coverImage: "$coverImage",
        },
      },

      outletCount: {
        $sum: 1,
      },
    },
  });

  /**
   * ------------------------------------------------
   * 8b. Populate nearestOutlet.location
   * ------------------------------------------------
   */

  pipeline.push(
    ...buildAggregateLookup({
      from: "locations",
      localField: "nearestOutlet.locationId",
      as: "nearestOutlet.location",
      project: {
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
      },
    }),
  );

  /**
   * ------------------------------------------------
   * 8c. isAppliedOnAllOutlets
   *
   * Compares total active outlets of the brand against how many of the
   * brand's outlets this specific voucher version is actually linked to
   * (brand-wide, not just the ones near this customer).
   * ------------------------------------------------
   */

  pipeline.push({
    $lookup: {
      from: "subbrands",
      let: { brandId: "$voucher.brandId" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$brandId", "$$brandId"] },
            isActive: true,
            isDeleted: false,
          },
        },
        { $count: "count" },
      ],
      as: "brandOutletCountResult",
    },
  });

  pipeline.push({
    $lookup: {
      from: "vouchersubbrands",
      let: { versionId: "$version._id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$voucherVersionId", "$$versionId"] },
            isActive: true,
            isDeleted: false,
          },
        },
        { $count: "count" },
      ],
      as: "voucherOutletCountResult",
    },
  });

  pipeline.push({
    $addFields: {
      totalBrandOutlets: {
        $ifNull: [{ $arrayElemAt: ["$brandOutletCountResult.count", 0] }, 0],
      },
      totalVoucherOutlets: {
        $ifNull: [{ $arrayElemAt: ["$voucherOutletCountResult.count", 0] }, 0],
      },
    },
  });

  pipeline.push({
    $addFields: {
      isAppliedOnAllOutlets: {
        $and: [
          { $gt: ["$totalBrandOutlets", 0] },
          { $eq: ["$totalBrandOutlets", "$totalVoucherOutlets"] },
        ],
      },
    },
  });

  /**
   * ------------------------------------------------
   * 8d. Brand's live subscription plan
   * ------------------------------------------------
   *
   * ⚠️ Deliberately **after** the `$group`. The previous version joined
   * `brand.subscribedId → subscribeds → subscriptions` up beside the brand
   * lookup, which is one outlet-row at a time — a voucher live at 20 outlets
   * paid for the same two joins 20 times, then threw 19 of the answers away.
   * Here there is exactly one row per voucher. `voucher.brandId` survives the
   * group via `$first`, so nothing else had to move.
   *
   * ⚠️ And it no longer reads `subscribedId` at all. That pointer is never
   * cleared when a plan lapses (`syncBrandSubscriptionState` says so in as many
   * words), and the old join projected only `{ subscriptionId: 1 }` — no
   * `status`, no `endDate`. So a brand whose plan expired months ago kept
   * rendering its old plan name on the customer's home feed, indefinitely, with
   * nothing in the response to contradict it. `buildBrandPlanLookup` resolves
   * the live plan and answers `null` otherwise.
   */

  pipeline.push(
    ...buildBrandPlanLookup({
      localField: "voucher.brandId",
      as: "brand.subscriptionPlan",
    }),
  );

  /**
   * ------------------------------------------------
   * 9. Final response
   * ------------------------------------------------
   */

  pipeline.push({
    $project: {
      _id: 0,

      voucherId: "$voucher._id",

      name: "$voucher.name",

      categoryId: "$version.categoryId",

      subCategoryId: "$version.subCategoryId",

      createdAt: "$voucher.createdAt",

      banner: "$voucher.banner",

      isSuggested: { $ifNull: ["$voucher.isSuggested", false] },

      suggestionOrder: { $ifNull: ["$voucher.suggestionOrder", 0] },

      version: 1,

      brand: 1,

      nearestOutlet: 1,

      outletCount: 1,

      offerCount: { $size: { $ifNull: ["$version.offers", []] } },

      isAppliedOnAllOutlets: 1,

      ...(useRelevance ? { relevanceScore: "$voucher.relevanceScore" } : {}),
    },
  });

  /**
   * ------------------------------------------------
   * 10. Final home page sorting (VOUCHER_SORT_BY)
   * ------------------------------------------------
   * DISTANCE       -> nearest outlet first (default direction: asc)
   * NEWEST         -> voucher.createdAt (default direction: desc)
   * EXPIRING_SOON  -> version.endAt (default direction: asc)
   * RELEVANCE      -> textScore, best match first; falls back to NEWEST
   *                   when no search term was actually provided.
   * sortOrder, when explicitly passed, overrides the default direction.
   */

  const sortStage = {};

  // Admin-suggested vouchers ride on top of whatever ordering follows.
  //
  // Sorting rather than a separate query is what makes "view more" work: the
  // suggestions lead page 1 and then simply do not reappear, because it is one
  // sorted result set rather than two lists stitched together. No dedupe pass
  // is needed. `suggestedOnly` narrows to just the tab.
  if (!query.suggestedOnly) {
    sortStage.isSuggested = -1;
    sortStage.suggestionOrder = 1;
  } else {
    sortStage.suggestionOrder = 1;
  }

  if (useRelevance) {
    sortStage.relevanceScore = -1;
  } else if (
    sortBy === VOUCHER_SORT_BY.NEWEST ||
    (sortBy === VOUCHER_SORT_BY.RELEVANCE && !query.search)
  ) {
    sortStage.createdAt = query.sortOrder === "asc" ? 1 : -1;
  } else if (sortBy === VOUCHER_SORT_BY.EXPIRING_SOON) {
    sortStage["version.endAt"] = query.sortOrder === "desc" ? -1 : 1;
  } else {
    // DISTANCE (default)
    sortStage["nearestOutlet.distanceInMeters"] =
      query.sortOrder === "desc" ? -1 : 1;
  }

  pipeline.push({
    $sort: sortStage,
  });

  return pipeline;
};

exports.buildCustomerVoucherDetailPipeline = ({
  voucherId,
  latitude,
  longitude,
  maxDistance,
  outletId,
}) => {
  return [
    /**
     * -----------------------------------------
     * 1. Voucher
     * -----------------------------------------
     */

    {
      $match: {
        _id: voucherId,

        isActive: true,

        isDeleted: false,
      },
    },

    /**
     * -----------------------------------------
     * 2. Current Published Version
     * -----------------------------------------
     */

    {
      $lookup: {
        from: "voucherversions",

        let: {
          voucherId: "$_id",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$voucherId", "$$voucherId"],
              },

              status: "PUBLISHED",

              isActive: true,

              isDeleted: false,

              startAt: {
                $lte: new Date(),
              },

              endAt: {
                $gt: new Date(),
              },
            },
          },

          {
            $sort: {
              versionNumber: -1,
            },
          },

          {
            $limit: 1,
          },
        ],

        as: "version",
      },
    },

    {
      $unwind: "$version",
    },

    // Storage internals go no further than this line. See the constant.
    NARROW_VERSION_IMAGES,

    /**
     * -----------------------------------------
     * 3. Voucher → Outlet Mapping
     * -----------------------------------------
     */

    {
      $lookup: {
        from: "vouchersubbrands",

        let: {
          versionId: "$version._id",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $eq: ["$voucherVersionId", "$$versionId"],
              },

              isActive: true,

              isDeleted: false,
            },
          },
        ],

        as: "outletMappings",
      },
    },

    /**
     * -----------------------------------------
     * 4. Outlet IDs
     * -----------------------------------------
     */

    {
      $project: {
        _id: 1,

        name: 1,

        categoryId: 1,

        subCategoryId: 1,

        version: 1,

        /**
         * ⚠️ This projection is a **whitelist**, and it is the last stage that
         * can still see the voucher master's own fields. Anything not named
         * here is gone for good — which is exactly how the banner went missing.
         *
         * `banner` was absent, so it was dropped here while the final
         * `$project` below still asked for it and the mapper still called
         * `pickVoucherBanner` on it. Nothing errored: the field was simply
         * `undefined`, so **every** voucher detail answered
         * `bannerType: null, bannerUrl: null` — a customer saw the banner on
         * the feed and watched it vanish the moment they opened the voucher,
         * which reads as "this one has no banner" rather than as a fault.
         */
        banner: 1,

        // Carried through for the brand block below. Without it the joins in
        // 4b have nothing to key on.
        brandId: 1,

        outletIds: "$outletMappings.subBrandId",
      },
    },

    /**
     * -----------------------------------------
     * 4b. Brand (same block the listing returns)
     * -----------------------------------------
     *
     * The detail screen renders the same brand card as the list row, so it
     * returns the same shape — `merchantId` and `subscriptionPlan` included.
     * Before this the endpoint returned no brand at all, and a client opening
     * a voucher from the feed had to keep the list row's brand around or
     * re-fetch it.
     *
     * Placed here on purpose: at this point the pipeline is exactly **one**
     * row. Below, `$unwind: "$outlets"` fans it out to one row per outlet, and
     * a join added after that would repeat itself for every outlet and be
     * collapsed straight back by the `$group`.
     */
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: {
        brandName: 1,
        description: 1,
        legalBusinessName: 1,
        merchantId: 1,
        uniqueId: 1,
        isActive: 1,
        isApproved: 1,
        // Read by the verification match below, never returned —
        // `mapCustomerBrandBlock` is a whitelist and names neither.
        isRejected: 1,
        isRevoked: 1,
        joinedDate: 1,
      },
    }),

    /**
     * ⚠️ Only a verified brand's voucher opens. The **same** four conditions
     * the listing applies.
     *
     * The listing grew this gate after unverified brands' vouchers were found
     * sitting in the customer feed. The detail endpoint was missed, and it had
     * no brand join at all to hang a gate on — so a voucher the feed correctly
     * hid stayed openable by direct link for anyone who had one: a shared
     * WhatsApp message, an old notification, a stale screen.
     *
     * Nothing cascades to close that gap on its own: `reviewBrandVerification`
     * (reject/revoke) and `toggleBrandStatus` (deactivate) do not touch the
     * brand's vouchers, so those stay `PUBLISHED` and in-window indefinitely.
     *
     * The money path was already safe — `buildClaimPreview` blocks the claim
     * with *"This brand is not accepting claims right now."* — so what this
     * closes is the page, not a payment: a customer could open a brand the
     * platform had deliberately hidden and only discover it at the button.
     *
     * `isRejected` / `isRevoked` are **absent** on brands written before those
     * flags existed, and in an aggregation expression absent is not false —
     * hence `$ifNull` on each, exactly as the listing does it.
     */
    {
      $match: {
        $expr: {
          $and: [
            { $eq: [{ $ifNull: ["$brand.isActive", false] }, true] },
            { $eq: [{ $ifNull: ["$brand.isApproved", false] }, true] },
            { $ne: [{ $ifNull: ["$brand.isRejected", false] }, true] },
            { $ne: [{ $ifNull: ["$brand.isRevoked", false] }, true] },
          ],
        },
      },
    },

    ...buildBrandPlanLookup({
      localField: "brandId",
      as: "brand.subscriptionPlan",
    }),

    /**
     * -----------------------------------------
     * 5. Lookup SubBrands
     * -----------------------------------------
     */

    {
      $lookup: {
        from: "subbrands",

        let: {
          outletIds: "$outletIds",
        },

        pipeline: [
          {
            $match: {
              $expr: {
                $in: ["$_id", "$$outletIds"],
              },

              isActive: true,

              isDeleted: false,
            },
          },
          {
            $project: {
              _id: 1,
              whatsappNumber: 1,
              mobile: 1,

              uniqueId: 1,

              storeId: 1,

              logo: 1,

              coverImage: 1,

              description: 1,

              locationId: 1,

              workHoursId: 1,

              geo: 1,
            },
          },
        ],

        as: "outlets",
      },
    },

    /**
     * -----------------------------------------
     * 6. Calculate Distance
     * -----------------------------------------
     */

    {
      $unwind: "$outlets",
    },

    {
      $addFields: {
        "outlets.distanceInMeters": {
          $multiply: [
            6371000,

            {
              $acos: {
                $add: [
                  {
                    $multiply: [
                      {
                        $sin: {
                          $degreesToRadians: latitude,
                        },
                      },

                      {
                        $sin: {
                          $degreesToRadians: {
                            $arrayElemAt: ["$outlets.geo.coordinates", 1],
                          },
                        },
                      },
                    ],
                  },

                  {
                    $multiply: [
                      {
                        $cos: {
                          $degreesToRadians: latitude,
                        },
                      },

                      {
                        $cos: {
                          $degreesToRadians: {
                            $arrayElemAt: ["$outlets.geo.coordinates", 1],
                          },
                        },
                      },

                      {
                        $cos: {
                          $degreesToRadians: {
                            $subtract: [
                              {
                                $arrayElemAt: ["$outlets.geo.coordinates", 0],
                              },

                              longitude,
                            ],
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },

    {
      $lookup: {
        from: "workhours",

        localField: "outlets.workHoursId",
        foreignField: "_id",

        pipeline: [
          {
            $match: {
              isActive: true,
              isDeleted: false,
            },
          },
          {
            $project: {
              _id: 1,
              monday: 1,
              tuesday: 1,
              wednesday: 1,
              thursday: 1,
              friday: 1,
              saturday: 1,
              sunday: 1,
            },
          },
        ],

        as: "outletWorkHours",
      },
    },
    {
      $set: {
        "outlets.workHours": {
          $arrayElemAt: ["$outletWorkHours", 0],
        },
      },
    },
    /**
     * -----------------------------------------
     * 7. Location
     * -----------------------------------------
     */

    {
      $lookup: {
        from: "locations",

        localField: "outlets.locationId",

        foreignField: "_id",

        pipeline: [
          {
            $match: {
              isActive: true,

              isDeleted: false,
            },
          },

          {
            $project: {
              _id: 1,

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
            },
          },
        ],

        as: "outletLocation",
      },
    },

    {
      $unwind: {
        path: "$outletLocation",

        preserveNullAndEmptyArrays: false,
      },
    },

    /**
     * -----------------------------------------
     * 8. Attach location
     * -----------------------------------------
     */

    {
      $set: {
        "outlets.location": "$outletLocation",
      },
    },

    /**
     * -----------------------------------------
     * 9. Sort nearest first
     * -----------------------------------------
     */

    {
      $sort: {
        "outlets.distanceInMeters": 1,
      },
    },

    /**
     * -----------------------------------------
     * 10. Group back
     * -----------------------------------------
     */

    {
      $group: {
        _id: "$_id",

        name: {
          $first: "$name",
        },

        categoryId: {
          $first: "$categoryId",
        },

        subCategoryId: {
          $first: "$subCategoryId",
        },

        version: {
          $first: "$version",
        },

        /**
         * ⚠️ The second half of the banner fix, and the easier half to miss.
         *
         * `$group` is a whitelist too: naming `banner` in the projection above
         * only gets it this far. Without this line it is dropped here instead,
         * the final `$project` still finds nothing, and the symptom is
         * identical — so fixing only one of the two looks like fixing neither.
         */
        banner: {
          $first: "$banner",
        },

        // Identical on every row the unwind produced — it was joined before
        // the fan-out.
        brand: {
          $first: "$brand",
        },

        outlets: {
          $push: "$outlets",
        },
      },
    },

    /**
     * -----------------------------------------
     * 11. Selected outlet
     * -----------------------------------------
     */

    {
      $set: {
        selectedOutlet: {
          $cond: [
            {
              $ne: [outletId, null],
            },

            {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$outlets",

                    as: "outlet",

                    cond: {
                      $eq: ["$$outlet._id", outletId],
                    },
                  },
                },

                0,
              ],
            },

            {
              $arrayElemAt: ["$outlets", 0],
            },
          ],
        },
      },
    },

    /**
     * -----------------------------------------
     * 12. Response
     * -----------------------------------------
     */

    {
      $project: {
        _id: 0,

        voucherId: "$_id",

        name: 1,

        banner: 1,

        // categoryId: 1,

        // subCategoryId: 1,

        version: 1,

        brand: 1,

        selectedOutlet: 1,

        outlets: 1,

        outletCount: {
          $size: "$outlets",
        },
      },
    },
  ];
};

exports.formatDistance = (meters) => {
  if (
    meters === undefined ||
    meters === null ||
    !Number.isFinite(Number(meters))
  ) {
    return null;
  }
  const distance = Number(meters);
  if (distance < 1000) {
    return {
      meters: Math.round(distance),
      kilometers: Number((distance / 1000).toFixed(2)),
      display: `${Math.round(distance)} m`,
    };
  }
  return {
    meters: Math.round(distance),
    kilometers: Number((distance / 1000).toFixed(2)),
    display: `${(distance / 1000).toFixed(1)} km`,
  };
};

exports.mapCustomerVoucherOutlet = (outlet) => {
  if (!outlet) return null;
  return {
    id: outlet._id,
    mobile: outlet.mobile || null,
    whatsappNumber: outlet.whatsappNumber || null,
    uniqueId: outlet.uniqueId || null,
    storeId: outlet.storeId || null,
    logo: outlet.logo || null,
    coverImage: outlet.coverImage || null,
    description: outlet.description || null,
    distance: exports.formatDistance(outlet.distanceInMeters),
    location: outlet.location
      ? {
          id: outlet.location._id,
          addressLine1: outlet.location.addressLine1,
          addressLine2: outlet.location.addressLine2,
          landmark: outlet.location.landmark,
          city: outlet.location.city,
          district: outlet.location.district,
          state: outlet.location.state,
          country: outlet.location.country,
          zipcode: outlet.location.zipcode,
          formattedAddress: outlet.location.formattedAddress,
          geo: outlet.location.geo,
        }
      : null,
    workHours: outlet.workHours || null,
  };
};

// "Best" offer = the active offer with the highest discountValue. A list
// view has no bill-amount context to compute a true per-customer discount,
// so this is a display heuristic, not a personalized calculation.
/**
 * The customer's view of one voucher image.
 *
 * 🔴 A whitelist, and it has to be. The stored image carries `storage` —
 * Cloudinary's `publicId`, or the S3 `bucket` and `key` — and
 * `GET /vouchers/customer/get/:voucherId` is a **public** route. Handing those
 * out tells a stranger exactly where every file lives and under what name.
 *
 * The list row was written this way from the start; the detail screen sent
 * `version.images` straight through. Both read this function now, so the two
 * cannot drift again — which is the only reason one of them was wrong.
 */
/**
 * ⚠️ Same three keys as before — `url` just reads one level deeper now.
 *
 * The file moved into `media` in M-5; the customer's view of it did not move at
 * all. A voucher image is always a still (video is refused at upload), so there
 * is no poster to report here.
 */
const toCustomerImage = (image) => ({
  _id: image._id,
  url: image.media?.url ?? image.url ?? null,
  sortOrder: image.sortOrder,
});

/**
 * The customer's view of one offer.
 *
 * `_id` stays: it is what the claim is placed against
 * (`createVoucherClaimOrder` takes an `offerId`), so dropping it would break
 * claiming. Everything else is the offer as the app renders it.
 *
 * ⚠️ `isActive` / `isDeleted` deliberately do **not** ship. They are the
 * vendor's own switches, and the customer has no use for a flag they cannot
 * act on — see `toCustomerOffers` for why the rows behind them never arrive
 * either.
 */
const toCustomerOffer = (offer) => ({
  _id: offer._id,
  title: offer.title,
  minBillAmount: offer.minBillAmount,
  discountType: offer.discountType,
  discountValue: offer.discountValue,
  maxDiscountAmount: offer.maxDiscountAmount ?? null,
  usageType: offer.usageType,
  discountApplicableOn: offer.discountApplicableOn,
});

/**
 * Every offer a customer may actually claim, in the order the vendor set.
 *
 * 🔴 Deleted and switched-off offers are dropped. The detail screen used to
 * send the whole array — so a vendor who removed an offer still had it on the
 * customer's screen, and tapping it failed at `buildClaimPreview`, which
 * requires `offer.isActive !== false`. An offer that cannot be claimed is worse
 * than no offer: the customer reads it as a price and finds out at payment.
 */
const toCustomerOffers = (offers = []) =>
  offers
    .filter((offer) => !offer.isDeleted && offer.isActive !== false)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(toCustomerOffer);

/**
 * Drop `storage` from a version's images, at the source.
 *
 * The JS mappers below are what actually decide the response, so this is not
 * the guard — it is the reason the guard never has to work hard. Without it,
 * every customer request pulls each image's Cloudinary `publicId` (or S3
 * `bucket` and `key`) out of Mongo and across the wire, for fields that are
 * deleted a moment later.
 *
 * ⚠️ Only images are narrowed. An offer holds nothing but numbers and strings —
 * there is no secret in it — and the `isActive` / `isDeleted` flags have to
 * survive this stage because `toCustomerOffers` filters on them afterwards.
 *
 * Placed straight after `$unwind: "$version"` in both pipelines, so a later
 * `version: 1` carries the already-narrowed array.
 */
const NARROW_VERSION_IMAGES = {
  $addFields: {
    "version.images": {
      $map: {
        input: { $ifNull: ["$version.images", []] },
        as: "i",
        in: {
          _id: "$$i._id",
          // ⚠️ `media.url` only. Naming `media` whole would carry `storage`
          // across the wire again, which is the exact thing this stage exists
          // to stop.
          url: "$$i.media.url",
          sortOrder: "$$i.sortOrder",
        },
      },
    },
  },
};

const pickBestOffer = (offers = []) => {
  const pool = offers.filter(
    (offer) => !offer.isDeleted && offer.isActive !== false,
  );
  const source = pool.length ? pool : offers.filter((offer) => !offer.isDeleted);
  if (!source.length) return null;
  const best = [...source].sort(
    (a, b) => (b.discountValue || 0) - (a.discountValue || 0),
  )[0];
  return toCustomerOffer(best);
};

/**
 * The brand card a customer sees on a voucher, list row and detail alike.
 *
 * Extracted rather than written twice. The detail endpoint grew this block to
 * match the listing, and two copies of "what does a brand look like to a
 * customer" is exactly how one of them ends up a field behind — which is
 * invisible until somebody compares the two screens.
 *
 * `subscriptionPlan` is the **live** plan or `null`; see
 * `helpers/subscribeds/brandPlanLookup.js` for why it is not read off
 * `Brand.subscribedId`.
 */
exports.mapCustomerBrandBlock = (brand) => {
  if (!brand) return null;
  return {
    id: brand._id,
    brandName: brand.brandName || null,
    description: brand.description || null,
    legalBusinessName: brand.legalBusinessName || null,
    merchantId: brand.merchantId || null,
    uniqueId: brand.uniqueId || null,
    isActive: brand.isActive ?? null,
    isVerified: brand.isApproved ?? false,
    joinedDate: brand.joinedDate || null,
    subscriptionPlan: brand.subscriptionPlan || null,
  };
};

exports.mapCustomerVoucherListItem = (item) => {
  if (!item) return null;

  const version = item.version || {};
  const { distanceInMeters, locationId, location, ...outletRest } =
    item.nearestOutlet || {};

  return {
    voucherId: item.voucherId,
    name: item.name,
    categoryId: item.categoryId,
    subCategoryId: item.subCategoryId,
    createdAt: item.createdAt,
    // The version's images come along so the banner slot can fall back to the
    // first one when there is no approved banner (V-4a).
    ...pickVoucherBanner(item.banner, version.images),
    brand: exports.mapCustomerBrandBlock(item.brand),
    version: {
      id: version._id,
      versionNumber: version.versionNumber,
      description: version.description || null,
      images: (version.images || []).map(toCustomerImage),
      bestOffer: pickBestOffer(version.offers),
      startAt: version.startAt,
      endAt: version.endAt,
    },
    nearestOutlet: item.nearestOutlet
      ? {
          ...outletRest,
          location: location
            ? {
                id: location._id,
                addressLine1: location.addressLine1,
                addressLine2: location.addressLine2,
                landmark: location.landmark,
                city: location.city,
                district: location.district,
                state: location.state,
                country: location.country,
                zipcode: location.zipcode,
                formattedAddress: location.formattedAddress,
                geo: location.geo,
              }
            : null,
          distance: exports.formatDistance(distanceInMeters),
        }
      : null,
    outletCount: item.outletCount,
    offerCount: item.offerCount || 0,
    isAppliedOnAllOutlets: item.isAppliedOnAllOutlets ?? false,
    // Admin-pinned. Lets the client badge the row and keep the pinned block
    // visually distinct from the rest of the list.
    isSuggested: item.isSuggested ?? false,
    isContainsAd: false,
    isFavorite: false,
    ...(item.relevanceScore !== undefined
      ? { relevanceScore: item.relevanceScore }
      : {}),
  };
};

exports.mapCustomerVoucherDetail = (data) => {
  if (!data) return null;
  return {
    voucherId: data.voucherId,
    name: data.name,
    categoryId: data.categoryId,
    subCategoryId: data.subCategoryId,
    // Same fallback as the list row — see `pickVoucherBanner`.
    ...pickVoucherBanner(data.banner, data.version?.images),
    // Same shape as a list row's, so one brand card renders on both screens.
    brand: exports.mapCustomerBrandBlock(data.brand),
    version: data.version
      ? {
          id: data.version._id,
          versionNumber: data.version.versionNumber,
          /**
           * 🔴 Both of these were `data.version.images` and
           * `data.version.offers` — the stored arrays, sent as they are.
           *
           * The pipeline projects the whole version subdocument, so `images`
           * arrived carrying `storage`: a Cloudinary `publicId`, or an S3
           * `bucket` and `key`. This route is public. The list row next door
           * had always whitelisted; only the detail screen did not, and nothing
           * made the two agree until they shared these functions.
           */
          images: (data.version.images || []).map(toCustomerImage),
          description: data.version.description || null,
          offers: toCustomerOffers(data.version.offers),
          startAt: data.version.startAt,
          endAt: data.version.endAt,
        }
      : null,
    selectedOutlet: exports.mapCustomerVoucherOutlet(data.selectedOutlet),
    outlets: (data.outlets || []).map(exports.mapCustomerVoucherOutlet),
    outletCount: data.outletCount || 0,
  };
};
