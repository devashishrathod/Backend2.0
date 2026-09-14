const SubBrand = require("../../models/SubBrand");
const { throwError } = require("../../utils");

/**
 * Copy an address's position onto the outlet that uses it.
 *
 * ⚠️ `SubBrand.geo` — not `Location.geo` — is what the customer's nearest
 * search actually reads: the voucher pipeline's `$geoNear` runs on `SubBrand`,
 * and the brand directory computes its distances from the same field. So this
 * copy **is** the customer-facing position. If it does not happen, the panel
 * shows the new address while every customer is still sent to the old one.
 *
 * @param {mongoose.ClientSession} [session] — pass it when the caller is
 *   writing the `Location` in a transaction, so the outlet's position and the
 *   address it came from cannot end up describing different places.
 */
exports.syncSubBrandLocAndGeo = async (
  subBrandId,
  geo,
  locationId,
  session,
) => {
  if (!subBrandId) throwError(400, "SubBrand ID is required.");
  if (
    !geo ||
    geo.type !== "Point" ||
    !Array.isArray(geo.coordinates) ||
    geo.coordinates.length !== 2
  ) {
    throwError(400, "Invalid GeoJSON Point.");
  }
  const [lng, lat] = geo.coordinates;
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throwError(400, "Invalid longitude/latitude.");
  }
  let updateData = { geo };
  if (locationId) updateData.locationId = locationId;
  const result = await SubBrand.updateOne(
    { _id: subBrandId, isDeleted: false },
    { $set: updateData },
    session ? { session } : {},
  );
  if (result.matchedCount === 0) {
    throwError(404, "SubBrand not found.");
  }
  return result;
};
