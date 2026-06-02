const Location = require("../../models/Location");
const { throwError, validateObjectId } = require("../../utils");

exports.deleteLocation = async (id) => {
  validateObjectId(id, "Location Id");
  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  result.isDeleted = true;
  result.isActive = false;
  result.updatedAt = new Date();
  await result.save();
  return;
};
