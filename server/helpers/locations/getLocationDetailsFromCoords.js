const axios = require("axios");
const LOCATION_API = process.env.LOCATION_API;
const LOCATION_HEADER = process.env.LOCATION_HEADER;
const { getDistrictOrCityPostcode } = require("./getDistrictOrCityPostcode");

exports.getLocationDetailsFromCoords = async (lat, lon) => {
  try {
    const url = `${LOCATION_API}?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": `${LOCATION_HEADER}`,
      },
    });
    if (!data || !data.address) return null;
    const addr = data?.address;
    const city =
      addr?.city?.toLowerCase() ||
      addr?.city_district?.toLowerCase() ||
      addr?.town?.toLowerCase() ||
      addr?.village?.toLowerCase() ||
      null;
    const district = addr?.state_district?.toLowerCase() || null;
    const country = addr?.country?.toLowerCase() || null;
    const locationData = {
      lat: data?.lat,
      lon: data?.lon,
      formattedAddress: data?.display_name?.toLowerCase() || null,
      name: data?.name?.toLowerCase() || null,
      address: `${addr.road?.toLowerCase() || ""} ${
        addr?.village?.toLowerCase() || ""
      } ${addr.suburb?.toLowerCase() || ""}`.trim(),
      area: addr?.county?.toLowerCase() || null,
      city,
      district,
      zipcode:
        addr.postcode?.toLowerCase() ||
        (await getDistrictOrCityPostcode(country, district, city)) ||
        null,
      state: addr?.state?.toLowerCase() || null,
      country,
    };
    return locationData;
  } catch (err) {
    console.error("Reverse geocode error →", err.message);
    return null;
  }
};
