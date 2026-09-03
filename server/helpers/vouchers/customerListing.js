const mongoose = require("mongoose");
const { VOUCHER_SORT_BY } = require("../../constants/voucher");
const { buildAggregateLookup } = require("../../database");
const { pickVoucherBanner } = require("./pickVoucherBanner");

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
          },
        },
      ],

      as: "version",
    },
  });

  pipeline.push({
    $unwind: "$version",
  });

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
        joinedDate: 1,
        subscribedId: 1,
      },
    }),
  );

  // Brand -> Subscribed (the brand's purchased subscription instance)
  pipeline.push(
    ...buildAggregateLookup({
      from: "subscribeds",
      localField: "brand.subscribedId",
      as: "brand.subscription",
      project: { subscriptionId: 1 },
    }),
  );

  // Subscribed -> Subscription (the actual plan, e.g. Basic/Advance/Pro)
  pipeline.push(
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "brand.subscription.subscriptionId",
      as: "brand.subscription.plan",
      project: { name: 1, type: 1 },
    }),
  );

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

  if (query.categoryId) {
    pipeline.push({
      $match: {
        "voucher.categoryId": new mongoose.Types.ObjectId(query.categoryId),
      },
    });
  }

  if (query.subCategoryId) {
    pipeline.push({
      $match: {
        "voucher.subCategoryId": new mongoose.Types.ObjectId(
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
    pipeline.push({
      $match: {
        "voucher.name": {
          $regex: query.search,
          $options: "i",
        },
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
   * 9. Final response
   * ------------------------------------------------
   */

  pipeline.push({
    $project: {
      _id: 0,

      voucherId: "$voucher._id",

      name: "$voucher.name",

      categoryId: "$voucher.categoryId",

      subCategoryId: "$voucher.subCategoryId",

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

        outletIds: "$outletMappings.subBrandId",
      },
    },

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
const pickBestOffer = (offers = []) => {
  const pool = offers.filter((offer) => offer.isActive !== false);
  const source = pool.length ? pool : offers;
  if (!source.length) return null;
  const best = [...source].sort(
    (a, b) => (b.discountValue || 0) - (a.discountValue || 0),
  )[0];
  return {
    _id: best._id,
    title: best.title,
    minBillAmount: best.minBillAmount,
    discountType: best.discountType,
    discountValue: best.discountValue,
    maxDiscountAmount: best.maxDiscountAmount ?? null,
    usageType: best.usageType,
    discountApplicableOn: best.discountApplicableOn,
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
    ...pickVoucherBanner(item.banner),
    brand: item.brand
      ? {
          id: item.brand._id,
          brandName: item.brand.brandName || null,
          description: item.brand.description || null,
          legalBusinessName: item.brand.legalBusinessName || null,
          merchantId: item.brand.merchantId || null,
          uniqueId: item.brand.uniqueId || null,
          isActive: item.brand.isActive ?? null,
          isVerified: item.brand.isApproved ?? false,
          joinedDate: item.brand.joinedDate || null,
          subscriptionPlan: item.brand.subscription?.plan?.name || null,
        }
      : null,
    version: {
      id: version._id,
      versionNumber: version.versionNumber,
      description: version.description || null,
      images: (version.images || []).map((image) => ({
        _id: image._id,
        url: image.url,
        sortOrder: image.sortOrder,
      })),
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
    ...pickVoucherBanner(data.banner),
    version: data.version
      ? {
          id: data.version._id,
          versionNumber: data.version.versionNumber,
          images: data.version.images || [],
          description: data.version.description || null,
          offers: data.version.offers || [],
          startAt: data.version.startAt,
          endAt: data.version.endAt,
        }
      : null,
    selectedOutlet: exports.mapCustomerVoucherOutlet(data.selectedOutlet),
    outlets: (data.outlets || []).map(exports.mapCustomerVoucherOutlet),
    outletCount: data.outletCount || 0,
  };
};
