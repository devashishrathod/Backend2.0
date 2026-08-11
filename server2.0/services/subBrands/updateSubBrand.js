const SubBrand = require("../../models/SubBrand");
const { throwError } = require("../../utils");

exports.updateSubBrand = async (userId, payload) => {
  const { subBrandId, joinedDate, outletType, email, description, isActive } =
    payload;
  const subBrand = await SubBrand.findById(subBrandId);
  if (!subBrand) throwError(404, "Outlet/Sub-Brand not found!");

  if (joinedDate) subBrand.joinedDate = new Date(joinedDate);
  if (outletType) subBrand.outletType = outletType;
  if (email) subBrand.email = email;
  if (description) subBrand.description = description;
  if (isActive !== undefined) subBrand.isActive = isActive;

  await subBrand.save();
  return subBrand;
};
