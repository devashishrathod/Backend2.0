require("dotenv").config();
const APIKEY = process.env.TWO_FACTOR_API_KEY;
const TwoFactor = new (require("2factor"))(APIKEY);
var axios = require("axios");

exports.sendOTP = async (mobile) => {
  TwoFactor.sendOTP(mobile, { otp: "1234", template: "riceDealOTP" }).then(
    (sessionId) => {
      console.log("sessionId: ", sessionId);
      return sessionId;
    },
    (error) => {
      console.log("error: ", error);
    }
  );
};

exports.verifyOTP = async (sessionId, otp) => {
  TwoFactor.verifyOTP(sessionId, otp).then(
    (response) => {
      console.log("response: ", response);
    },
    (error) => {
      console.log("error: ", error);
    }
  );
};

exports.urlSendTestOtp = async (mobile) => {
  try {
    var config = {
      method: "get",
      maxBodyLength: Infinity,
      url: `https://2factor.in/API/V1/${APIKEY}/SMS/${mobile}/AUTOGEN/OTP1`,
      headers: {},
    };

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.log("error: ", error);
    throw error;
  }
};

exports.urlVerifyOtp = async (sessionId, otp) => {
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
    console.log("Error: ", error.message);
    throw "Invalid OTP";
  }
};
