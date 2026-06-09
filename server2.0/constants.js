module.exports = {
  ROLES: Object.freeze({
    ADMIN: "ADMIN",
    VENDOR: "VENDOR",
    CUSTOMER: "CUSTOMER",
  }),

  LOGIN_TYPES: Object.freeze({
    EMAIL: "EMAIL",
    MOBILE: "MOBILE",
    USERNAME: "USERNAME",
    WHATSAPP: "WHATSAPP",
    GOOGLE: "GOOGLE",
    PASSWORD: "PASSWORD",
    FACEBOOK: "FACEBOOK",
    OTHER: "OTHER",
  }),

  SCREENS: Object.freeze({
    BUSINESS_NAME: "BUSINESS_NAME",
    REGISTRATION_STATUS: "REGISTRATION_STATUS",
    REGISTRATION_ENTITY_TYPE: "REGISTRATION_ENTITY_TYPE",
    PAN_VERIFICATION: "PAN_VERIFICATION",
    GST_VERIFICATION: "GST_VERIFICATION",
    BANK_VERIFICATION: "BANK_VERIFICATION",
    SYSTEM_VERIFICATION: "SYSTEM_VERIFICATION",
    PARTNERSHIP_DEED: "PARTNERSHIP_DEED",
    SUBSCRIBE_PLAN: "SUBSCRIBE_PLAN",
    UNDER_REVIEW: "UNDER_REVIEW",
    DASHBOARD: "DASHBOARD",
  }),

  BUSINESS_REGISTRATION_STATUS: Object.freeze({
    REGISTERED: "REGISTERED",
    UNREGISTERED: "UNREGISTERED",
  }),

  BUSINESS_ENTITY_TYPE: Object.freeze({
    PROPRIETORSHIP: "PROPRIETORSHIP",
    PARTNERSHIP: "PARTNERSHIP",
    LLP: "LLP",
    PRIVATE_LIMITED: "PRIVATE_LIMITED",
    PUBLIC_LIMITED: "PUBLIC_LIMITED",
    ONE_PERSON_COMPANY: "ONE_PERSON_COMPANY",
    TRUST: "TRUST",
    NGO: "NGO",
    SOCIETY: "SOCIETY",
  }),

  PLATFORMS: Object.freeze({
    WEB: "WEB",
    ANDROID: "ANDROID",
    IOS: "IOS",
  }),

  SUBSCRIPTION_TYPES: Object.freeze({
    WEEKLY: "WEEKLY",
    MONTHLY: "MONTHLY",
    QUATERLY: "QUATERLY",
    HALF_YEARLY: "HALF_YEARLY",
    YEARLY: "YEARLY",
  }),

  DURATION_MAP: Object.freeze({
    WEEKLY: 7,
    MONTHLY: 30,
    QUATERLY: 90,
    HALF_YEARLY: 180,
    YEARLY: 365,
  }),

  SUBSCRIPTION_PLANS: Object.freeze({
    FREE: "FREE",
    BASIC: "BASIC",
    PREMIUM: "PREMIUM",
    Family: "FAMILY",
  }),

  ZIP_CODE_REGEX_MAP: Object.freeze({
    IN: /^[1-9][0-9]{5}$/, // India (6 digits)
    US: /^\d{5}(-\d{4})?$/, // USA (ZIP or ZIP+4)
    CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, // Canada (A1A 1A1)
    UK: /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, // United Kingdom (SW1A 1AA)
    AU: /^\d{4}$/, // Australia (4 digits)
    DE: /^\d{5}$/, // Germany
    FR: /^\d{5}$/, // France
    IT: /^\d{5}$/, // Italy
    ES: /^\d{5}$/, // Spain
    BR: /^\d{5}-?\d{3}$/, // Brazil (12345-678 or 12345678)
    RU: /^\d{6}$/, // Russia
  }),

  COUNTRY_NAME_TO_ISO: Object.freeze({
    india: "IN",
    unitedstates: "US",
    usa: "US",
    canada: "CA",
    uk: "UK",
    unitedkingdom: "UK",
    australia: "AU",
    germany: "DE",
    france: "FR",
    italy: "IT",
    spain: "ES",
    brazil: "BR",
    russia: "RU",
  }),

  DEFAULT_IMAGES: Object.freeze({
    CATEGORY:
      "https://res.cloudinary.com/drvdnqydw/image/upload/f_auto,q_auto/v1/Images/hrhc8iwbjl2qnnqu9kaq?_a=BAMAK+Jw0",
    SUBCATEGORY:
      "https://res.cloudinary.com/drvdnqydw/image/upload/f_auto,q_auto/v1/Images/zsbowllown6ddeb4jnw0?_a=BAMAK+Jw0",
    PRODUCT:
      "https://res.cloudinary.com/drvdnqydw/image/upload/f_auto,q_auto/v1/Images/zsbowllown6ddeb4jnw0?_a=BAMAK+Jw0",
    BANNER:
      "https://res.cloudinary.com/drvdnqydw/image/upload/f_auto,q_auto/v1/Images/zsbowllown6ddeb4jnw0?_a=BAMAK+Jw0",
  }),
};
