const TermAndCondition = require("../../models/Terms&Condition");
const { throwError, validateObjectId } = require("../../utils");

exports.updateTermAndCondition = async (id, payload) => {
  validateObjectId(id, "TermAndCondition Id");

  const result = await TermAndCondition.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Term and condition not found");
  }

  let { title, type, description, isActive } = payload;

  // Was `result.isActive = !result.isActive`, which *toggled* — so sending
  // `isActive: true` on an already-active document deactivated it.
  if (typeof isActive !== "undefined") result.isActive = isActive;

  if (title) {
    title = title.toLowerCase();
    // Was `result.findOne(...)` — a query method called on a *document*, which
    // does not exist, so every title change threw
    // "result.findOne is not a function".
    const existing = await TermAndCondition.findOne({
      _id: { $ne: id },
      title,
      isDeleted: false,
    });
    if (existing) {
      throwError(400, "Another term and condition exists with this title");
    }
    result.title = title;
  }

  if (typeof type !== "undefined") result.type = type;
  // Stored as written — see the note in createTermAndCondition.
  if (typeof description !== "undefined") result.description = description;

  await result.save();
  return result;
};
