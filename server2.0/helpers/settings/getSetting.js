const Setting = require("../../models/Setting");

exports.getSetting = async () => {
  return Setting.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};
