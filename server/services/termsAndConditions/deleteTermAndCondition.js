const TermAndCondition = require("../../models/Terms&Condition");
const { throwError, validateObjectId } = require("../../utils");

exports.deleteTermAndCondition = async (id) => {
  validateObjectId(id, "TermAndCondition Id");
  const result = await TermAndCondition.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Term and condition not found");
  }
  result.isDeleted = true;
  result.isActive = false;
  result.updatedAt = new Date();
  await result.save();
  return;
};
