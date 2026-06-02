const TermAndCondition = require("../../models/Terms&Condition");
const { throwError, validateObjectId } = require("../../utils");

exports.updateTermAndCondition = async (id, payload) => {
  validateObjectId(id, "TermAndCondition Id");
  const result = await TermAndCondition.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Term and condition not found");
  }
  let { title, description, isActive } = payload;
  if (typeof isActive !== "undefined") result.isActive = !result.isActive;
  if (title) {
    title = title.toLowerCase();
    const existing = await result.findOne({
      _id: { $ne: id },
      title,
      isDeleted: false,
    });
    if (existing) {
      throwError(400, "Another privacy and policy exists with this title");
    }
    result.title = title;
  }
  if (description) result.description = description?.toLowerCase();
  result.updatedAt = new Date();
  await result.save();
  return result;
};
