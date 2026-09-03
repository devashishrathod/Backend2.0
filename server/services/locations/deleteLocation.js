const Location = require("../../models/Location");
const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const { throwError } = require("../../utils");

exports.deleteLocation = async (payload) => {
  const { id } = payload;
  const result = await Location.findById(id);
  if (!result || result.isDeleted) throwError(404, "Location not found");
  if (result.subBrandId) {
    const subBrand = await SubBrand.findById(result.subBrandId);
    if (subBrand) {
      subBrand.locationId = null;
      ((subBrand.geo = { type: "Point", coordinates: [0, 0] }),
        await subBrand.save());
    }
  } else if (result.brandId) {
    const brand = await Brand.findById(result.brandId);
    if (brand) {
      brand.locationId = null;
      await brand.save();
    }
  } else if (result.customerId) {
    const customer = await Customer.findById(result.customerId);
    if (customer) {
      customer.locationId = null;
      await customer.save();
    }
  }
  result.isDeleted = true;
  result.isActive = false;
  result.updatedAt = new Date();
  await result.save();
  return;
};
