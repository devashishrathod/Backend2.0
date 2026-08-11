const Location = require("../../models/Location");
const { throwError } = require("../../utils");

exports.getLocation = async (payload) => {
  const { id } = payload;
  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  return result;
};
