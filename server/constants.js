module.exports = {
  ROLES: Object.freeze({
    ADMIN: "admin",
    USER: "user",
    VENDOR: "vendor",
    SUB_VENDOR: "subVendor",
  }),

  LOGIN_TYPES: Object.freeze({
    EMAIL: "email",
    MOBILE: "mobile",
    WHATSAPP: "whatsapp",
  }),

  PLATFORMS: Object.freeze({
    WEB: "web", // Vendor app
    ANDROID: "android", // Customer app
    IOS: "ios",
  }),

  BANK_ACCOUNT_TYPES: Object.freeze({
    JOINT: "joint",
    SAVINGS: "savings",
    CURRENT: "current",
    SALARY: "salary",
    FIXED_DEPOSIT: "fixed_deposit",
    NRE: "nre", // Non-Resident External
    NRO: "nro", // Non-Resident Ordinary
    OTHER: "other",
  }),

  PAYMENT_STATUS: Object.freeze({
    CREATED: "created",
    AUTHORIZED: "authorized",
    CAPTURED: "captured",
    FAILED: "failed",
  }),

  PAYMENT_METHODS: Object.freeze({
    CARD: "card",
    NETBANKING: "netbanking",
    UPI: "upi",
    WALLET: "wallet",
    PAYLATER: "paylater",
    EMI: "emi",
    COD: "cod",
    BANK_TRANSFER: "bank_transfer",
    CARDLESS_EMI: "cardless_emi",
  }),

  WALLET_PROVIDERS: Object.freeze([
    "paytm",
    "phonepe",
    "amazonpay",
    "mobikwik",
    "freecharge",
    "jiomoney",
    "olamoney",
    "airtelmoney",
  ]),

  SUBSCRIPTION_PLAN_TYPE: Object.freeze({
    MONTHLY: "monthly",
    QUARTERLY: "quarterly",
    HALF_YEARLY: "half_yearly",
    ANNUAL: "annual",
    DAILY: "daily",
  }),

  SUBSCRIPTION_PLANS: Object.freeze({
    FREE_COOLING_PLAN: "Cooling Period",
  }),

  OFFERS_SCOPE: Object.freeze({
    ALL_USERS: "ALL_USERS",
    SELECTED_USERS: "SELECTED_USERS",
  }),

  VOUCHER_TYPES: Object.freeze({
    PERCENTAGE: "percentage",
    FLAT: "flat",
    CASHBACK: "cashback",
  }),

  VOUCHER_STATUS: Object.freeze({
    DRAFT: "draft",
    COMPLETED: "completed",
    ACTIVE: "active",
    EXPIRED: "expired",
    USED_UP: "used_up",
    UPCOMING: "upcoming",
    DELETED: "deleted",
  }),

  SUGGESTION_STATUS: Object.freeze({
    DRAFT: "draft",
    ACTIVE: "active",
    DELETED: "deleted",
  }),

  REFUND_STATUS: Object.freeze({
    SUBMITTED: "SUBMITTED",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    COMPLETED: "COMPLETED",
  }),

  DAILY_PAYMENT_TYPES: Object.freeze({
    VENDOR: "VENDOR",
    REFUND_CUSTOMER: "REFUND_CUSTOMER",
  }),

  DAILY_PAYMENT_METHODS: Object.freeze({
    CASH: "CASH",
    BANK_TRANSFER: "BANK_TRANSFER",
    UPI: "UPI",
    WALLET: "WALLET",
    CASH_DEPOSIT: "CASH_DEPOSIT",
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
    USER: "https://cdn-icons-png.flaticon.com/512/6596/6596121.png",
    CATEGORY:
      "https://t4.ftcdn.net/jpg/15/54/43/11/360_F_1554431124_YJnAIC7lp6um4hEb4Lop0NEWMUEyA96h.jpg",
    SUBCATEGORY:
      "https://media.istockphoto.com/id/615254324/vector/music-genres-signs-and-symbols.jpg?s=612x612&w=0&k=20&c=nsrIJ3p3MuArr7UkfK-knvBTr3SwIRXlqthKU-5TLCQ=",
  }),
};
