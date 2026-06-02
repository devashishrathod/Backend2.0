const Location = require("../../models/Location");
const { throwError, validateObjectId } = require("../../utils");

exports.getLocation = async (id) => {
  validateObjectId(id, "Location Id");
  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  return result;
};
