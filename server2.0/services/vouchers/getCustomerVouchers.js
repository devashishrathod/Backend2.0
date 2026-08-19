const Customer = require("../../models/Customer");
const Location = require("../../models/Location");
const SubBrand = require("../../models/SubBrand");
const { throwError, pagination } = require("../../utils");
const { buildCustomerVoucherPipeline } = require("../../helpers/vouchers");
const { VOUCHER_OFFER_LIMITS } = require("../../constants/voucher");
// const { getVoucherConfig } = require("./getVoucherConfig");

exports.getCustomerVouchers = async (userId, query) => {
  const customer = await Customer.findOne({
    userId,
    isActive: true,
    isDeleted: false,
  }).select("_id locationId");

  if (!customer) throwError(404, "Customer not found.");

  let latitude = query.latitude;
  let longitude = query.longitude;

  /**
   * If coordinates aren't supplied,
   * fallback to customer's saved location.
   */

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
   * Configuration
   * -----------------------------------------
   */

  // const config = await getVoucherConfig();

  // if (!config) {
  //   throwError(500, "Voucher configuration not found.");
  // }

  //  const maxDistance = Number(config.maxDistanceKm) * 1000;

  const maxDistance = Number(VOUCHER_OFFER_LIMITS.MAX_DISTANCE || 25) * 1000;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throwError(500, "Invalid voucher maximum distance configuration.");
  }

  /**
   * -----------------------------------------
   * Aggregation
   * -----------------------------------------
   */

  const pipeline = buildCustomerVoucherPipeline({
    latitude,
    longitude,
    maxDistance,
    query,
  });

  return pagination(
    SubBrand,
    pipeline,
    query.page || 1,
    query.limit || 10,
    "voucher",
  );
};
