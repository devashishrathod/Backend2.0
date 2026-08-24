const Setting = require("../../models/Setting");

exports.getSetting = async () => {
  return Setting.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    // `returnDocument: "after"` rather than `new: true` — the latter is
    // deprecated in Mongoose 9 and logged a warning on every settings read,
    // which is now every checkout.
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  );
};
