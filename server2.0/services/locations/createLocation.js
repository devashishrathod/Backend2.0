const Location = require("../../models/Location");
const { validateObjectId, throwError } = require("../../utils");
const { isValidZipCode } = require("../../validator/common");
const { getLocationDetailsFromCoords } = require("../../helpers/locations");

exports.createLocation = async (payload) => {
  let {
    userId,
    name,
    shopOrBuildingNumber,
    address,
    area,
    state,
    city,
    district,
    country,
    zipcode,
    coordinates,
  } = payload;
  let locationData = payload;
  if (userId) validateObjectId(userId, "User Id");
  country = country?.toLowerCase() || "india";
  if (!coordinates) {
    if (!address || !city || !district || !zipcode || !state) {
      throwError(
        422,
        "Please pass coordinates(Lat & Long) Or provide address, city, district, zipcode and state "
      );
    }
    if (zipcode && !isValidZipCode(country, zipcode)) {
      throwError(
        422,
        `${zipcode} is not a valid ZIP/postal code for ${country}`
      );
    }
    locationData = {
      userId,
      name: name?.toLowerCase(),
      shopOrBuildingNumber: shopOrBuildingNumber?.toLowerCase(),
      address: address?.toLowerCase(),
      area: area?.toLowerCase(),
      city: city?.toLowerCase(),
      district: district?.toLowerCase(),
      zipcode,
      state: state?.toLowerCase(),
      country: country?.toLowerCase(),
      formattedAddress:
        `${address?.toLowerCase()}, ${city?.toLowerCase()}, ${district?.toLowerCase()}, ${state?.toLowerCase()}, ${zipcode}, ${country?.toLowerCase()}`.trim(),
      coordinates: [0, 0],
    };
  } else {
    const [lat, lon] = coordinates;
    const autoData = await getLocationDetailsFromCoords(lat, lon);
    if (!autoData) throwError(422, "please provide correct coordinates");
    locationData.coordinates = [autoData?.lat, autoData?.lon];
    locationData.formattedAddress = autoData?.formattedAddress;
    locationData.name = autoData?.name;
    locationData.address = autoData?.address;
    locationData.area = autoData?.area;
    locationData.city = autoData?.city;
    locationData.district = autoData?.district;
    locationData.zipcode = autoData?.zipcode;
    locationData.state = autoData?.state;
    locationData.country = autoData?.country;
  }
  return await Location.create(locationData);
};
