const mongoose = require("mongoose");

exports.buildCustomerVoucherPipeline = ({
  latitude,
  longitude,
  maxDistance,
  query,
}) => {
  const pipeline = [];

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
          },
        },

        {
          $project: {
            _id: 1,
            name: 1,
            categoryId: 1,
            subCategoryId: 1,
            createdAt: 1,
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
   * 5. Optional category filter
   * ------------------------------------------------
   */

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

  if (query.search) {
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

      version: 1,

      nearestOutlet: 1,

      outletCount: 1,
    },
  });

  /**
   * ------------------------------------------------
   * 10. Final home page sorting
   * ------------------------------------------------
   */

  const sortStage = {};

  if (query.sortBy === "createdAt") {
    sortStage["voucher.createdAt"] = query.sortOrder === "desc" ? -1 : 1;
  } else {
    /**
     * Default = nearest voucher first
     */
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

        categoryId: 1,

        subCategoryId: 1,

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

exports.mapCustomerVoucherDetail = (data) => {
  if (!data) return null;
  return {
    voucherId: data.voucherId,
    name: data.name,
    categoryId: data.categoryId,
    subCategoryId: data.subCategoryId,
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
