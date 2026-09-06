const Customer = require("../../models/Customer");
const Location = require("../../models/Location");
const { throwError } = require("../../utils");

/**
 * Where the caller is, for the geo-driven customer screens.
 *
 * Explicit coordinates always win. If they are absent and the caller is a
 * signed-in customer, their saved address stands in. A guest with neither has
 * no location, and what happens then is the caller's decision — which is the
 * whole reason this takes `required`:
 *
 * - `required: true`  (the voucher feed) — throws 400. That listing *is* a
 *   nearest-first feed; without a point there is nothing to show.
 * - `required: false` (global search) — returns `null`. The search still has
 *   brands, categories and areas to answer with, and refusing the whole request
 *   would stop a guest who declined location permission from looking up a brand
 *   by name, which never needed a location at all.
 *
 * ⚠️ Identity is context here, not a requirement. A signed-in vendor or admin
 * previewing the app has no Customer row, and a guest has no `userId`; neither
 * is an error. This used to `throwError(404, "Customer not found.")` on a
 * missing record, which turned "you didn't tell me where you are" into "who are
 * you?" — and once the route went public it fired for every caller.
 *
 * @returns {Promise<{latitude: number, longitude: number}|null>}
 */
exports.resolveCustomerCoordinates = async ({
  userId,
  latitude,
  longitude,
  required = true,
}) => {
  if (latitude !== undefined && longitude !== undefined) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }

  const customer = userId
    ? await Customer.findOne({
        userId,
        isActive: true,
        isDeleted: false,
      }).select("_id locationId")
    : null;

  if (!customer?.locationId) {
    if (!required) return null;
    throwError(
      400,
      "Location is required. Send latitude and longitude, or save an address first.",
    );
  }

  const location = await Location.findOne({
    _id: customer.locationId,
    isActive: true,
    isDeleted: false,
  }).select("geo");

  if (!location?.geo || !Array.isArray(location.geo.coordinates)) {
    if (!required) return null;
    throwError(400, "Customer location coordinates not found.");
  }

  const [lng, lat] = location.geo.coordinates;
  return { latitude: Number(lat), longitude: Number(lng) };
};
