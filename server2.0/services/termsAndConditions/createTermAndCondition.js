const TermAndCondition = require("../../models/Terms&Condition");
const { throwError } = require("../../utils");

exports.createTermAndCondition = async (payload, image) => {
  let { title, description, isActive } = payload;
  title = title?.toLowerCase();
  description = description?.toLowerCase();
  const existingTermAndCondition = await TermAndCondition.findOne({
    title,
    isDeleted: false,
  });
  if (existingTermAndCondition) {
    throwError(400, "Term and condition already exist with this title");
  }
  return await TermAndCondition.create({
    title,
    description,
    isActive,
  });
};
