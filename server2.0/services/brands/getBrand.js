const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { throwError } = require("../../utils");

exports.getBrand = async (brandId) => {
  const pipeline = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(brandId),
        isDeleted: false,
      },
    },

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

    ...buildAggregateLookup({
      from: "pans",
      localField: "PANId",
      as: "pan",
    }),

    ...buildAggregateLookup({
      from: "gsts",
      localField: "GSTId",
      as: "gst",
    }),

    ...buildAggregateLookup({
      from: "banks",
      localField: "BankId",
      as: "bank",
    }),

    ...buildAggregateLookup({
      from: "locations",
      localField: "locationId",
      as: "location",
    }),

    ...buildAggregateLookup({
      from: "systemverifies",
      localField: "systemVerifyId",
      as: "systemVerify",
    }),

    {
      $project: {
        __v: 0,
      },
    },
  ];
  const [brand] = await Brand.aggregate(pipeline);
  if (!brand) throwError(404, "Brand not found");
  return brand;
};
