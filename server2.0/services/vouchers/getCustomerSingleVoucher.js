const mongoose = require("mongoose");
const Customer = require("../../models/Customer");
const Location = require("../../models/Location");
const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
//const { getVoucherConfig } = require("./getVoucherConfig");
const {
  buildCustomerVoucherDetailPipeline,
} = require("../../helpers/vouchers");
const { VOUCHER_OFFER_LIMITS } = require("../../constants/voucher");

exports.getCustomerSingleVoucher = async (userId, payload) => {
  /**
   * -----------------------------------------
   * Validate Voucher ID
   * -----------------------------------------
   */

  if (!mongoose.Types.ObjectId.isValid(payload.voucherId)) {
    throwError(400, "Invalid voucher ID.");
  }

  /**
   * -----------------------------------------
   * Customer
   * -----------------------------------------
   */

  const customer = await Customer.findOne({
    userId,
    isActive: true,
    isDeleted: false,
  }).select("_id locationId");

  if (!customer) {
    throwError(404, "Customer not found.");
  }

  /**
   * -----------------------------------------
   * Customer Coordinates
   * -----------------------------------------
   */

  let latitude = payload.latitude;
  let longitude = payload.longitude;

  if (latitude === undefined || longitude === undefined) {
    if (!customer.locationId) {
      throwError(400, "Customer location not found.");
    }

    const location = await Location.findOne({
      _id: customer.locationId,
      isActive: true,
      isDeleted: false,
    }).select("geo");

    if (
      !location ||
      !location.geo ||
      !Array.isArray(location.geo.coordinates)
    ) {
      throwError(400, "Customer location coordinates not found.");
    }

    [longitude, latitude] = location.geo.coordinates;
  }

  latitude = Number(latitude);
  longitude = Number(longitude);

  /**
   * -----------------------------------------
   * Config
   * -----------------------------------------
   */

  //   const config = await getVoucherConfig();

  //   if (!config) {
  //     throwError(500, "Voucher configuration not found.");
  //   }

  //   const maxDistance = Number(config.maxDistanceKm) * 1000;

  const maxDistance = VOUCHER_OFFER_LIMITS.MAX_DISTANCE || 25;

  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throwError(500, "Invalid voucher maximum distance configuration.");
  }

  /**
   * -----------------------------------------
   * Aggregation
   * -----------------------------------------
   */

  const pipeline = buildCustomerVoucherDetailPipeline({
    voucherId: new mongoose.Types.ObjectId(payload.voucherId),
    latitude,
    longitude,
    maxDistance,
    outletId: payload.outletId
      ? new mongoose.Types.ObjectId(payload.outletId)
      : null,
  });

  const result = await Voucher.aggregate(pipeline);

  if (!result.length) {
    throwError(404, "Voucher not found or currently unavailable.");
  }

  return result[0];
};
