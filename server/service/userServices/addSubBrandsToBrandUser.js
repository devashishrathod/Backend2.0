const User = require("../../model/User");
const { findByIdAndUpdate } = require("../../db/dbServices");

exports.addSubBrandsToBrandUser = async (userId, subBrandIds) => {
  const ids = Array.isArray(subBrandIds) ? subBrandIds : [subBrandIds];
  return await findByIdAndUpdate(User, userId, {
    $addToSet: { subBrands: { $each: ids } },
    $inc: { subBrandsUsed: ids.length },
  });
};
