const axios = require("axios");
const LOCATION_PINCODE_API = process.env.LOCATION_PINCODE_API;

exports.getDistrictOrCityPostcode = async (country, district, city) => {
  try {
    if (
      country &&
      ["india", "bharat", "in"].includes(country.toLowerCase()) &&
      (district || city)
    ) {
      const query = (district || city).trim();
      const url = `${LOCATION_PINCODE_API}/${encodeURIComponent(query)}`;
      const { data } = await axios.get(url);
      if (Array.isArray(data) && data[0]?.PostOffice) {
        let po = data[0]?.PostOffice[0];
        if (po?.Pincode) return po.Pincode;
      }
    }
    return null;
  } catch (e) {
    console.log("Indian PIN API failed:", e.message);
  }
};
