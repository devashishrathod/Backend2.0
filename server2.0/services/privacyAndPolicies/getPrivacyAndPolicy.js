const PrivacyAndPolicy = require("../../models/Privacy&Policy");
const { throwError, validateObjectId } = require("../../utils");

exports.getPrivacyAndPolicy = async (id) => {
  validateObjectId(id, "PrivacyAndPolicy Id");
  const result = await PrivacyAndPolicy.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Privacy and policy not found");
  }
  return result;
};
