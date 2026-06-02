const { TENDIGIT } = require("../../configs/tendigitOtp");
const { throwError } = require("../../utils");

exports.sendTemplate = async (phone, params = "", urlParam = "") => {
  const url = new URL(TENDIGIT.urlBase);
  url.searchParams.set("LicenseNumber", TENDIGIT.licenseNumber);
  url.searchParams.set("APIKey", TENDIGIT.apiKey);
  url.searchParams.set("Contact", phone);
  url.searchParams.set("Template", TENDIGIT.templateName);
  if (params) url.searchParams.set("Param", params);
  if (urlParam) url.searchParams.set("URLParam", urlParam);

  const resp = await fetch(url.toString());
  const json = await resp.json();

  if (json?.ApiResponse !== "Success") {
    throwError(503, "Please try in some time! OTP service unavailable");
  }
  return json;
};
