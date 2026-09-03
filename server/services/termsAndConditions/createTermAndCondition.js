const TermAndCondition = require("../../models/Terms&Condition");
const { throwError } = require("../../utils");

exports.createTermAndCondition = async (payload) => {
  let { title, type, description, isActive } = payload;

  // Lowercased only so the duplicate check below is case-insensitive.
  title = title?.toLowerCase();

  // `description` is deliberately left as typed. It used to be lowercased with
  // the title, which flattened headings, proper nouns and any markup in the
  // legal copy.

  const existingTermAndCondition = await TermAndCondition.findOne({
    title,
    isDeleted: false,
  });
  if (existingTermAndCondition) {
    throwError(400, "Term and condition already exist with this title");
  }

  // `type` was never passed through, and the model requires it — so this call
  // failed with "Path `type` is required." every single time.
  return await TermAndCondition.create({
    title,
    type,
    description,
    isActive,
  });
};
