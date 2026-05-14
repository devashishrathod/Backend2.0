const {
  BANK_ACCOUNT_TYPES,
  ZIP_CODE_REGEX_MAP,
  COUNTRY_NAME_TO_ISO,
} = require("../constants");

module.exports = {
  isValidEmail: (email) =>
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email),

  isValidPhoneNumber: (phone) => /^(?:\+91|91)?[6-9]\d{9}$/.test(phone), // E.164 format

  isValidURL: (url) =>
    /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/.test(url),

  isValidAccountType: (type) =>
    Object.values(BANK_ACCOUNT_TYPES).includes(type),

  isValidPAN: (pan) => /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan),

  isValidGSTIN: (gstin) =>
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin),

  isValidAadhaar: (aadhaar) =>
    /^\d{4}\s\d{4}\s\d{4}$/.test(aadhaar) || /^\d{12}$/.test(aadhaar),

  isValidIFSC: (ifsc) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc),

  isValidAccountNumber: (accountNumber) => /^\d{9,18}$/.test(accountNumber),

  isValidMICR: (micr) => /^\d{9}$/.test(micr),

  isValidUpiId: (upi) => /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upi),

  isValidIMPS: (imps) => /^[0-9]{12}$/.test(imps),

  isValidCreditCard: (cardNumber) =>
    /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})$/.test(
      cardNumber
    ),

  isValidDebitCard: (cardNumber) =>
    /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})$/.test(
      cardNumber
    ),

  isValidCVV: (cvv) => /^[0-9]{3,4}$/.test(cvv),

  isValidExpiryDate: (expiryDate) => {
    const regex = /^(0[1-9]|1[0-2])\/([0-9]{2}|[0-9]{4})$/;
    if (!regex.test(expiryDate)) return false;
    const [month, year] = expiryDate.split("/").map(Number);
    const currentYear = new Date().getFullYear() % 100; // last two digits of the year
    const currentMonth = new Date().getMonth() + 1; // months are 0-indexed
    if (year < currentYear || (year === currentYear && month < currentMonth))
      return false;
    return true;
  },

  isValidZipCode: (country, zipCode) => {
    if (!country || !zipCode) return false;
    const countryCode = country.toUpperCase();
    const isoCode = ZIP_CODE_REGEX_MAP[countryCode]
      ? countryCode
      : COUNTRY_NAME_TO_ISO[countryCode.replace(/\s/g, "").toLowerCase()];
    if (!isoCode) return true; // skip validation for unsupported countries
    const regex = ZIP_CODE_REGEX_MAP[isoCode];
    return regex ? regex.test(zipCode) : true;
  },
};
