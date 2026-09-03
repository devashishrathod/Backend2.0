const TermAndCondition = require("../../models/Terms&Condition");
const { throwError, validateObjectId } = require("../../utils");

exports.getTermAndCondition = async (id) => {
  validateObjectId(id, "TermAndCondition Id");
  const result = await TermAndCondition.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Term and condition not found");
  }
  return result;
};
