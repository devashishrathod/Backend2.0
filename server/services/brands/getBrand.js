const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { buildAggregateLookup } = require("../../database");
const { throwError } = require("../../utils");

exports.getBrand = async (brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID");
  }

  const pipeline = [
    // =========================================================
    // BRAND
    // =========================================================
    {
      $match: {
        _id: new mongoose.Types.ObjectId(brandId),
        isDeleted: false,
      },
    },

    // =========================================================
    // BRAND USER
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "userId",
      as: "user",
      project: {
        password: 0,
        otp: 0,
        refreshToken: 0,
      },
    }),

    // =========================================================
    // BRAND PAN
    // =========================================================
    ...buildAggregateLookup({
      from: "pans",
      localField: "PANId",
      as: "pan",
    }),

    // =========================================================
    // BRAND GST
    // =========================================================
    ...buildAggregateLookup({
      from: "gsts",
      localField: "GSTId",
      as: "gst",
    }),

    // =========================================================
    // BRAND BANK
    // =========================================================
    ...buildAggregateLookup({
      from: "banks",
      localField: "BankId",
      as: "bank",
    }),

    // =========================================================
    // BRAND LOCATION
    // =========================================================
    ...buildAggregateLookup({
      from: "locations",
      localField: "locationId",
      as: "location",
    }),

    // =========================================================
    // BRAND SYSTEM VERIFICATION
    // =========================================================
    ...buildAggregateLookup({
      from: "systemverifies",
      localField: "systemVerifyId",
      as: "systemVerify",
    }),

    // =========================================================
    // BRAND SUBSCRIPTION
    // =========================================================
    ...buildAggregateLookup({
      from: "subscribeds",
      localField: "subscribedId",
      as: "subscribed",
    }),

    // =========================================================
    // BRAND CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
    }),

    // =========================================================
    // BRAND SUB CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
    }),

    // =========================================================
    // BRAND WORK HOURS
    // =========================================================
    ...buildAggregateLookup({
      from: "workhours",
      localField: "workHoursId",
      as: "workHours",
    }),

    // =========================================================
    // FIRST SUB BRAND
    // =========================================================
    {
      $lookup: {
        from: "subbrands",
        let: {
          firstSubBrandId: "$firstSubBrandId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $eq: ["$_id", "$$firstSubBrandId"],
                  },
                  {
                    $eq: ["$isDeleted", false],
                  },
                ],
              },
            },
          },

          // -----------------------------------------------------
          // SUB BRAND USER
          // -----------------------------------------------------
          ...buildAggregateLookup({
            from: "users",
            localField: "userId",
            as: "user",
            project: {
              password: 0,
              otp: 0,
              refreshToken: 0,
            },
          }),

          // -----------------------------------------------------
          // SUB BRAND LOCATION
          // -----------------------------------------------------
          ...buildAggregateLookup({
            from: "locations",
            localField: "locationId",
            as: "location",
          }),

          // -----------------------------------------------------
          // SUB BRAND WORK HOURS
          // -----------------------------------------------------
          ...buildAggregateLookup({
            from: "workhours",
            localField: "workHoursId",
            as: "workHours",
          }),
          { $project: { __v: 0 } },
        ],
        as: "firstSubBrand",
      },
    },
    {
      $unwind: {
        path: "$firstSubBrand",
        preserveNullAndEmptyArrays: true,
      },
    },
    { $project: { __v: 0 } },
  ];
  const [brand] = await Brand.aggregate(pipeline);
  if (!brand) throwError(404, "Brand not found");
  return brand;
};
