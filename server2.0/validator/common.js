const { ZIP_CODE_REGEX_MAP, COUNTRY_NAME_TO_ISO } = require("../constants");
const CHARSET = process.env.MERCHANT_ID_SECRET;

const MERCHANT_ID_REGEX = new RegExp(
  `^TM-[${CHARSET}]{4}-[${CHARSET}]{4}-[${CHARSET}]{4}$`,
);

module.exports = {
  escapeRegex: (value = "") => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  isValidEmail: (email) =>
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email),

  isValidPhoneNumber: (phone) => /^(?:\+91|91)?[6-9]\d{9}$/.test(phone), // E.164 format

  isValidPassword: (password) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
      password,
    ), // Minimum 8 chars, at least one uppercase, one lowercase, one number and one special char

  isValidateMerchantId: (merchantId) => MERCHANT_ID_REGEX.test(merchantId),

  isValidUsername: (username) => /^[a-zA-Z0-9._]{3,20}$/.test(username), // 3-20 chars, letters, numbers, . and _

  isValidDate: (date) => !isNaN(Date.parse(date)), // Validates if the date string can be parsed into a valid date

  isValidPAN: (pan) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan), // Indian PAN format

  isValidGSTIN: (gstin) =>
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin), // Indian GSTIN format

  isValidIFSC: (ifsc) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc), // Indian IFSC format

  isValidAadhar: (aadhar) => /^\d{4}\s?\d{4}\s?\d{4}$/.test(aadhar), // Indian Aadhar format

  isValidAccountNumber: (account) => /^\d{9,18}$/.test(account), // 9-18 digits

  isValidURL: (url) =>
    /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/.test(url),

  isValidZipCode: (country, zipcode) => {
    if (!country || !zipcode) return false;
    const countryCode = country.toUpperCase();
    const isoCode = ZIP_CODE_REGEX_MAP[countryCode]
      ? countryCode
      : COUNTRY_NAME_TO_ISO[countryCode.replace(/\s/g, "").toLowerCase()];
    if (!isoCode) return true; // skip validation for unsupported countries
    const regex = ZIP_CODE_REGEX_MAP[isoCode];
    return regex ? regex.test(zipcode) : true;
  },
};
