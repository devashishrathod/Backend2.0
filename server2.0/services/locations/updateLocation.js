const Location = require("../../models/Location");
const { throwError } = require("../../utils");

exports.updateLocation = async (userId, payload) => {
  let {
    id,
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
  console.log(payload, "snsqs");
  const location = await Location.findById(id);
  if (!location || location.isDeleted) throwError(404, "Location not found");

  let locationData = {};
  if (addressLine1) locationData.addressLine1 = addressLine1;
  if (addressLine2) locationData.addressLine2 = addressLine2;
  if (landmark) locationData.landmark = landmark;
  if (city) locationData.city = city?.toLowerCase();
  if (district) locationData.district = district?.toLowerCase();
  if (zipcode) locationData.zipcode = zipcode;
  if (state) locationData.state = state?.toLowerCase();
  if (country) locationData.country = country?.toLowerCase();
  if (formattedAddress)
    locationData.formattedAddress =
      formattedAddress ||
      `${addressLine1?.toLowerCase()}, ${addressLine2?.toLowerCase()}, ${landmark?.toLowerCase()}, ${city?.toLowerCase()}, ${district?.toLowerCase()}, ${state?.toLowerCase()}, ${zipcode}, ${country?.toLowerCase()}`.trim();
  if (coordinates) locationData.coordinates = coordinates;
  if (addressType) locationData.addressType = addressType;
  if (isBrandAddress !== undefined) {
    locationData.isBrandAddress = isBrandAddress;
  }
  if (isSubBrandAddress !== undefined) {
    locationData.isSubBrandAddress = isSubBrandAddress;
  }
  if (isDefault !== undefined) {
    locationData.isDefault = isDefault;
  }
  return await Location.findByIdAndUpdate(id, locationData, {
    returnDocument: "after",
  });
};
