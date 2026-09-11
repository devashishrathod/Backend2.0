const { ZIP_CODE_REGEX_MAP, COUNTRY_NAME_TO_ISO } = require("../constants");
const MERCHANT_ID_CHARSET = process.env.MERCHANT_ID_SECRET;
const STORE_ID_CHARSET = process.env.STORE_ID_SECRET;

const MERCHANT_ID_REGEX = new RegExp(
  `^TM-[${MERCHANT_ID_CHARSET}]{4}-[${MERCHANT_ID_CHARSET}]{4}-[${MERCHANT_ID_CHARSET}]{4}$`,
);

const STORE_ID_REGEX = new RegExp(
  `^TS-[${STORE_ID_CHARSET}]{4}-[${STORE_ID_CHARSET}]{4}-[${STORE_ID_CHARSET}]{4}$`,
);

const VOUCHER_CODE_REGEX = /^VCH-\d{8}$/;

const VOUCHER_VERSION_CODE_REGEX = /^VCH-\d{8}-V\d+$/;

/** The only shape a phone number is stored in: ten digits, first one 6-9. */
const CANONICAL_PHONE_REGEX = /^[6-9]\d{9}$/;

/**
 * ---------------- one phone number, one string ----------------
 *
 * ### ⚠️ Why this exists
 *
 * `isValidPhoneNumber` used to be `/^(?:\+91|91)?[6-9]\d{9}$/` — which accepts
 * `9876543210`, `919876543210` **and** `+919876543210`. Three strings, one phone,
 * all valid.
 *
 * That is not a cosmetic problem. `user_whatsappNumber_role_unique` is a Mongo
 * index on a **string**, so the same person could hold three CUSTOMER accounts on
 * one number and the index would refuse none of them — the exact failure that
 * index was added to stop. Every `findOne({ whatsappNumber })` would then land on
 * whichever row the planner felt like.
 *
 * It also breaks comparison. The verification flows decide "is this a change?"
 * with `target !== current`, and `+919876543210 !== 9876543210` is `true` — so
 * confirming the number you already have would read as changing it, send a code,
 * and write a second spelling of the same number.
 *
 * ### The rule
 *
 * Strip an India country code (`+91`, `91`, `0091`) and any spacing or dashes a
 * keypad or a paste might carry, and keep the ten digits. Anything that is not a
 * recognisable Indian mobile is returned **unchanged**, so a bad value fails
 * validation with what the caller actually sent rather than a mangled version of
 * it.
 *
 * ⚠️ Deliberately **not** E.164 (`+91…`). Every Joi schema in this repo already
 * demands bare ten digits (`/^[6-9]\d{9}$/`), every seeded and live row is stored
 * that way, and 2factor and the WhatsApp sender are both given the bare number.
 * Ten digits is what this system already means by "a phone number"; this only
 * makes the loose edges agree with it.
 */
const normalisePhone = (value) => {
  if (value === null || value === undefined) return value;

  const raw = String(value);
  // Spaces, dashes, brackets and dots — keypad and copy-paste noise. A leading
  // `+` is kept for now so the country-code strip below can see it.
  const compact = raw.trim().replace(/[\s\-().]/g, "");

  const digits = compact.replace(/^\+/, "");

  // 0091…, 91…, or already bare. Checked longest-first so `0091` is not read as
  // `00` + something.
  for (const prefix of ["0091", "91", "0"]) {
    if (digits.length > 10 && digits.startsWith(prefix)) {
      const rest = digits.slice(prefix.length);
      if (CANONICAL_PHONE_REGEX.test(rest)) return rest;
    }
  }

  if (CANONICAL_PHONE_REGEX.test(digits)) return digits;

  // Not an Indian mobile. Hand back exactly what came in — see the note above.
  return raw;
};

module.exports = {
  CANONICAL_PHONE_REGEX,
  normalisePhone,

  escapeRegex: (value = "") => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  isValidEmail: (email) =>
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email),

  /**
   * Normalise first, then check the canonical shape.
   *
   * Still accepts `+91…` and `91…` from a caller, so nothing that used to pass
   * starts failing — but what it accepts is now exactly what
   * `normalisePhone` can turn into ten digits, so "valid" and "storable" cannot
   * drift apart. The old regex allowed three spellings and blessed all three;
   * this allows the same three and canonicalises them.
   */
  isValidPhoneNumber: (phone) =>
    CANONICAL_PHONE_REGEX.test(normalisePhone(phone)),

  isValidPassword: (password) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
      password,
    ), // Minimum 8 chars, at least one uppercase, one lowercase, one number and one special char

  isValidateMerchantId: (merchantId) => MERCHANT_ID_REGEX.test(merchantId),

  isValidateStoreId: (storeId) => STORE_ID_REGEX.test(storeId),

  isValidateVoucherCode: (voucherCode) => VOUCHER_CODE_REGEX.test(voucherCode),

  isValidateVoucherVersionCode: (versionCode) =>
    VOUCHER_VERSION_CODE_REGEX.test(versionCode),

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
