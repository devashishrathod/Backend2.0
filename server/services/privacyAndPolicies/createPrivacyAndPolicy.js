const PrivacyAndPolicy = require("../../models/Privacy&Policy");
const { throwError } = require("../../utils");

exports.createPrivacyAndPolicy = async (payload) => {
  let { title, type, description, isActive } = payload;
  // `description` is left as typed — it used to be lowercased along with the
  // title, which flattened the legal copy and any markup in it.
  const existingPrivacyAndPolicy = await PrivacyAndPolicy.findOne({
    title,
    isDeleted: false,
  });
  if (existingPrivacyAndPolicy) {
    throwError(400, "Privacy and policy already exist with this title");
  }
  // `type` is required by the model and was never passed, so this call failed
  // with "Path `type` is required." every time.
  return await PrivacyAndPolicy.create({
    title,
    type,
    description,
    isActive,
  });
};
