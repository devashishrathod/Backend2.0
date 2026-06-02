const PrivacyAndPolicy = require("../../models/Privacy&Policy");
const { throwError } = require("../../utils");

exports.createPrivacyAndPolicy = async (payload, image) => {
  let { title, description, isActive } = payload;
  title = title?.toLowerCase();
  description = description?.toLowerCase();
  const existingPrivacyAndPolicy = await PrivacyAndPolicy.findOne({
    title,
    isDeleted: false,
  });
  if (existingPrivacyAndPolicy) {
    throwError(400, "Privacy and policy already exist with this title");
  }
  return await PrivacyAndPolicy.create({
    title,
    description,
    isActive,
  });
};
