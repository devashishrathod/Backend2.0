module.exports = {
  OTP_LENGTH: 6,
  OTP_TTL_SECONDS: 300, // 5 minutes
  OTP_MAX_VERIFY_ATTEMPTS: 5,
  HMAC_SECRET: process.env.OTP_HMAC_SECRET,
  TENDIGIT: {
    urlBase: process.env.TENDIGIT_BASEURL,
    licenseNumber: process.env.TENDIGIT_LICENSE,
    apiKey: process.env.TENDIGIT_APIKEY,
    templateName: process.env.TENDIGIT_TEMPLATE_ID,
  },
};
