const Customer = require("../../models/Customer");
const Location = require("../../models/Location");
const SubBrand = require("../../models/SubBrand");
const { throwError, pagination } = require("../../utils");
const {
  buildCustomerVoucherPipeline,
  mapCustomerVoucherListItem,
} = require("../../helpers/vouchers");
const { getVoucherConfig } = require("../../helpers/settings");

/**
 * Half the Earth's circumference in metres — larger than any real distance
 * between two points, so `$geoNear` stops filtering by range at all. Used only
 * for the suggestions fallback below.
 */
const EARTH_MAX_DISTANCE_METERS = 20_037_508;

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

  const config = await getVoucherConfig();

  const maxDistance = Number(config.maxDistanceKm) * 1000;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throwError(500, "Invalid voucher maximum distance configuration.");
  }

  /**
   * -----------------------------------------
   * Aggregation
   * -----------------------------------------
   */

  const page = query.page || 1;
  const limit = query.limit || 10;

  const run = async (distance) =>
    pagination(
      SubBrand,
      buildCustomerVoucherPipeline({
        latitude,
        longitude,
        maxDistance: distance,
        query,
      }),
      page,
      limit,
      "voucher",
    );

  let result;
  let isOutOfRange = false;

  try {
    result = await run(maxDistance);
  } catch (error) {
    /**
     * The Suggestions tab falls back to ignoring distance when nothing the
     * admin pinned happens to be nearby.
     *
     * Without this, a customer in a city the curated brands have not reached
     * opens the tab to an empty state — which reads as a broken feature rather
     * than a geographic one. `isOutOfRange` on the response lets the client say
     * so honestly instead of implying these are around the corner.
     *
     * `pagination` throws a 404 on an empty result rather than returning an
     * empty page, so an empty first pass arrives here as an error.
     */
    const isEmptyResult = error?.statusCode === 404;
    if (!query.suggestedOnly || !isEmptyResult) throw error;

    result = await run(EARTH_MAX_DISTANCE_METERS);
    isOutOfRange = true;
  }

  return {
    ...result,
    isOutOfRange,
    data: result.data.map(mapCustomerVoucherListItem),
  };
};
