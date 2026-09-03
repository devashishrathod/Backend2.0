const PrivacyAndPolicy = require("../../models/Privacy&Policy");
const { throwError, validateObjectId } = require("../../utils");

exports.deletePrivacyAndPolicy = async (id) => {
  validateObjectId(id, "PrivacyAndPolicy Id");
  const result = await PrivacyAndPolicy.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Privacy and policy not found");
  }
  result.isDeleted = true;
  result.isActive = false;
  result.updatedAt = new Date();
  await result.save();
  return;
};
