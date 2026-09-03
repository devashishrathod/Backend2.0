const axios = require("axios");
const { throwError } = require("../../utils");
const APIKEY = process.env.TWO_FACTOR_API_KEY;

exports.verifyOtpToMobile = async (sessionId, otp) => {
  try {
    const config = {
      method: "get",
      maxBodyLength: Infinity,
      url: `https://2factor.in/API/V1/${APIKEY}/SMS/VERIFY/${sessionId}/${otp}`,
      headers: {},
    };
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error("error on verify Otp with mobile number", error);
    if (
      error.response?.data?.Status === "Error" &&
      error.response?.data?.Details === "OTP Mismatch"
    ) {
      throwError(401, error.response?.data?.Details || "Invalid OTP");
    }
    throwError(500, "Something went wrong");
  }
};
