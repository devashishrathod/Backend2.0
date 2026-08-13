const Location = require("../../models/Location");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { throwError } = require("../../utils");
const { syncSubBrandLocAndGeo } = require("../../helpers/subBrands");

exports.createLocation = async (tokenUserId, payload) => {
  let {
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
    isBrandAddress = false,
    isSubBrandAddress = false,
    isDefault = false,
  } = payload;

  // =========================================================
  // LOCATION TYPE
  // =========================================================

  // Brand + SubBrand both cannot be true
  if (isBrandAddress && isSubBrandAddress) {
    throwError(
      400,
      "Location cannot be both Brand address and SubBrand address",
    );
  }

  // =========================================================
  // USER LOCATION
  // =========================================================

  // Only normal user/customer location gets userId.
  // Brand/SubBrand location must NOT contain userId.
  if (!isBrandAddress && !isSubBrandAddress) {
    userId = userId || tokenUserId;
  } else {
    userId = undefined;
  }

  // =========================================================
  // VALIDATE BRAND ADDRESS
  // =========================================================

  if (isBrandAddress && !brandId) {
    throwError(400, "brandId is required for Brand address");
  }

  // =========================================================
  // VALIDATE SUB BRAND ADDRESS
  // =========================================================

  if (isSubBrandAddress && !subBrandId) {
    throwError(400, "subBrandId is required for SubBrand address");
  }

  // =========================================================
  // NORMAL USER ADDRESS
  // =========================================================

  if (!isBrandAddress && !isSubBrandAddress) {
    // If customerId is required for user location,
    // validate it here.
  }

  // =========================================================
  // LOCATION DATA
  // =========================================================

  const locationData = {
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
      [
        addressLine1,
        addressLine2,
        landmark,
        city,
        district,
        state,
        zipcode,
        country,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(", "),

    geo: {
      type: "Point",
      coordinates,
    },

    addressType,

    isBrandAddress,
    isSubBrandAddress,
    isDefault,
  };

  // =========================================================
  // CREATE LOCATION
  // =========================================================

  const location = await Location.create(locationData);

  // =========================================================
  // BRAND LOCATION
  // =========================================================

  if (location.isBrandAddress) {
    const brand = await Brand.findOne({
      _id: location.brandId,
      isDeleted: false,
    });

    if (!brand) {
      throwError(404, "Brand not found");
    }

    brand.locationId = location._id;
    await brand.save();
  }

  // =========================================================
  // SUB BRAND LOCATION
  // =========================================================
  else if (location.isSubBrandAddress) {
    const subBrand = await SubBrand.findOne({
      _id: location.subBrandId,
      isDeleted: false,
    });

    if (!subBrand) {
      throwError(404, "SubBrand not found");
    }
    await syncSubBrandLocAndGeo(subBrand._id, location.geo, location._id);
  }
  // =========================================================
  // USER LOCATION
  // =========================================================
  // For normal user location:
  // userId = body.userId || tokenUserId
  //
  // Nothing else needs to be synced here currently.
  return location;
};
