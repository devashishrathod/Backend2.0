const Location = require("../../models/Location");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

exports.createLocation = async (tokenUserId, payload) => {
  let {
    // name,
    // shopOrBuildingNumber,
    userId,
    customerId,
    brandId,
    subBrandId,
    addressLine1,
    addressLine2,
    landmark,
    district,
    city,
    zipcode,
    state,
    country,
    formattedAddress,
    coordinates,
    addressType,
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
  } = payload;
  // const user = await User.findById(userId);
  // if (!user || user.isDeleted) throwError(404, "User not found");
  // const userRole = user.role;
  // const isAdmin = userRole === ROLES.ADMIN;
  // const isVendor = userRole === ROLES.VENDOR;
  // const isSubVendor = userRole === ROLES.SUB_VENDOR;
  // const isCustomer = userRole === ROLES.CUSTOMER;
  // if (isCustomer) {
  //   locationData.customerId = user.customerId;
  // } else if (isVendor && !brandId && !subBrandId) {
  //   locationData.brandId = user.brandId;
  // } else if (isSubVendor || (isVendor && subBrandId)) {
  //   locationData.brandId = user.brandId;
  //   locationData.subBrandId = subBrandId;
  // }
  userId = userId || tokenUserId;
  let locationData = {
    userId,
    customerId,
    brandId,
    subBrandId,
    addressLine1,
    addressLine2,
    landmark,
    city: city?.toLowerCase(),
    district: district?.toLowerCase(),
    zipcode,
    state: state?.toLowerCase(),
    country: country?.toLowerCase(),
    formattedAddress:
      formattedAddress ||
      `${addressLine1?.toLowerCase()}, ${addressLine2?.toLowerCase()}, ${landmark?.toLowerCase()}, ${city?.toLowerCase()}, ${district?.toLowerCase()}, ${state?.toLowerCase()}, ${zipcode}, ${country?.toLowerCase()}`.trim(),
    coordinates,
    addressType,
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
  };
  const location = await Location.create(locationData);
  if (location.isBrandAddress) {
    const brand = await Brand.findById(location.brandId);
    if (brand) {
      brand.locationId = location._id;
      await brand.save();
    }
  } else if (location.isSubBrandAddress) {
    const subBrand = await SubBrand.findById(location.subBrandId);
    if (subBrand) {
      subBrand.locationId = location._id;
      await subBrand.save();
    }
  }
  // } else if (location.isDefault) {
  //   const customer = await Customer.findById(location.customerId);
  //   if (customer) {
  //     customer.defaultLocationId = location._id;
  //     await customer.save();
  //   }
  // }
  return location;
};
