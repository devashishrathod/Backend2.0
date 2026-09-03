const PrivacyAndPolicy = require("../../models/Privacy&Policy");
const { throwError, validateObjectId } = require("../../utils");

exports.updatePrivacyAndPolicy = async (id, payload) => {
  validateObjectId(id, "PrivacyAndPolicy Id");

  const result = await PrivacyAndPolicy.findById(id);
  if (!result || result.isDeleted) {
    throwError(404, "Privacy and policy not found");
  }

  let { title, type, description, isActive } = payload;

  // Was a toggle (`!result.isActive`), so `isActive: true` on an already-active
  // document turned it off.
  if (typeof isActive !== "undefined") result.isActive = isActive;

  if (title) {
    title = title.toLowerCase();
    // Was `result.findOne(...)` — called on a document rather than the model,
    // so any title change threw "result.findOne is not a function".
    const existing = await PrivacyAndPolicy.findOne({
      _id: { $ne: id },
      title,
      isDeleted: false,
    });
    if (existing) {
      throwError(400, "Another privacy and policy exists with this title");
    }
    result.title = title;
  }

  if (typeof type !== "undefined") result.type = type;
  // Stored as written — see the note in createPrivacyAndPolicy.
  if (typeof description !== "undefined") result.description = description;

  await result.save();
  return result;
};
