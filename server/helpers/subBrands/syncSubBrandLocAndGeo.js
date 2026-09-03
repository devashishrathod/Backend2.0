const SubBrand = require("../../models/SubBrand");
const { throwError } = require("../../utils");

exports.syncSubBrandLocAndGeo = async (subBrandId, geo, locationId) => {
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
    // { session },
  );
  if (result.matchedCount === 0) {
    throwError(404, "SubBrand not found.");
  }
  return result;
};
