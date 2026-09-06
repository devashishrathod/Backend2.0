const SubBrand = require("../../models/SubBrand");
const { throwError, pagination } = require("../../utils");
const {
  buildCustomerVoucherPipeline,
  mapCustomerVoucherListItem,
} = require("../../helpers/vouchers");
const { getVoucherConfig } = require("../../helpers/settings");
const { resolveCustomerCoordinates } = require("../../helpers/customers");

/**
 * Half the Earth's circumference in metres — larger than any real distance
 * between two points, so `$geoNear` stops filtering by range at all. Used only
 * for the suggestions fallback below.
 */
const EARTH_MAX_DISTANCE_METERS = 20_037_508;

exports.getCustomerVouchers = async (userId, query) => {
  /**
   * Explicit coordinates, else the signed-in customer's saved address.
   *
   * `required: true` — this listing *is* a nearest-first feed, so with no point
   * there is nothing honest to return. The global search shares this resolver
   * with `required: false`, because it still has brands and categories to
   * answer with. Same lookup, same messages, one definition.
   */
  const { latitude, longitude } = await resolveCustomerCoordinates({
    userId,
    latitude: query.latitude,
    longitude: query.longitude,
    required: true,
  });

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
