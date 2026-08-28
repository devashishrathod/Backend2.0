const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
  SCREENS,
  SYSTEM_VERIFICATION_STATUS,
} = require("../constants");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ADMIN_ACTION,
  BRAND_VERIFICATION_ACTOR,
  BRAND_VERIFICATION_SORT_BY,
  BRAND_VERIFICATION_SORT_ORDER,
  BRAND_VERIFICATION_LIMITS,
} = require("../constants/brandVerification");
const {
  BRAND_STATUS_LIMITS,
  BRAND_LIST_SORT_BY,
  BRAND_LIST_SORT_ORDER,
} = require("../constants/brandStatus");

exports.validateAddBasicDetails = Joi.object({
  currentScreen: Joi.string()
    .uppercase()
    .valid(
      SCREENS.REGISTRATION_STATUS,
      SCREENS.REGISTRATION_ENTITY_TYPE,
      SCREENS.PAN_VERIFICATION,
    )
    .required()
    .messages({
      "any.required": "Current Screen is required",
      "any.only":
        "Current screen must be either REGISTRATION_STATUS, REGISTRATION_ENTITY_TYPE or PAN_VERIFICATION",
      "string.empty": "Current Screen cannot be empty",
    }),
  brandName: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_STATUS,
    then: Joi.string().trim().min(2).max(120).optional().messages({
      "string.empty": "Brand Name cannot be empty",
      "string.min": "Brand Name must contain at least {#limit} characters",
      "string.max": "Brand Name cannot exceed {#limit} characters",
    }),
    otherwise: Joi.forbidden(),
  }),
  legalBusinessName: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_STATUS,
    then: Joi.string().trim().min(3).max(120).required().messages({
      "any.required": "Legal Business Name is required",
      "string.empty": "Legal Business Name cannot be empty",
      "string.min":
        "Legal Business Name must contain at least {#limit} characters",
      "string.max": "Legal Business Name cannot exceed {#limit} characters",
    }),
    otherwise: Joi.forbidden(),
  }),
  businessRegistrationStatus: Joi.when("currentScreen", {
    is: SCREENS.REGISTRATION_ENTITY_TYPE,
    then: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_REGISTRATION_STATUS))
      .required()
      .messages({
        "any.required": "Business Registration Status is required",
        "string.empty": "Business Registration Status cannot be empty",
        "any.only": `Business Registration Status must be one of ${Object.values(BUSINESS_REGISTRATION_STATUS).join(", ")}`,
      }),
    otherwise: Joi.forbidden(),
  }),
  businessEntityType: Joi.when("currentScreen", {
    is: SCREENS.PAN_VERIFICATION,
    then: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_ENTITY_TYPE))
      .required()
      .messages({
        "any.required": "Business Entity Type is required",
        "string.empty": "Business Entity Type cannot be empty",
        "any.only": `Business Entity Type must be one of ${Object.values(BUSINESS_ENTITY_TYPE).join(", ")}`,
      }),
    otherwise: Joi.forbidden(),
  }),
});

exports.validateUpdateBasicDetails = Joi.object({
  currentScreen: Joi.string()
    .uppercase()
    .valid(...Object.values(SCREENS))
    .optional()
    .messages({
      "any.only": `Current screen must be one of ${Object.values(SCREENS).join(", ")}`,
      "string.empty": "Current Screen cannot be empty",
    }),
  brandName: Joi.string().trim().min(2).max(120).optional().messages({
    "string.empty": "Brand Name cannot be empty",
    "string.min": "Brand Name must contain at least {#limit} characters",
    "string.max": "Brand Name cannot exceed {#limit} characters",
  }),
  legalBusinessName: Joi.string().trim().min(3).max(120).optional().messages({
    "string.empty": "Legal Business Name cannot be empty",
    "string.min":
      "Legal Business Name must contain at least {#limit} characters",
    "string.max": "Legal Business Name cannot exceed {#limit} characters",
  }),
  businessRegistrationStatus: Joi.string()
    .trim()
    .valid(...Object.values(BUSINESS_REGISTRATION_STATUS))
    .optional()
    .messages({
      "string.empty": "Business Registration Status cannot be empty",
      "any.only": `Business Registration Status must be one of ${Object.values(BUSINESS_REGISTRATION_STATUS).join(", ")}`,
    }),
  businessEntityType: Joi.string()
    .trim()
    .valid(...Object.values(BUSINESS_ENTITY_TYPE))
    .optional()
    .messages({
      "string.empty": "Business Entity Type cannot be empty",
      "any.only": `Business Entity Type must be one of ${Object.values(BUSINESS_ENTITY_TYPE).join(", ")}`,
    }),
});

exports.validateGetBrand = {
  query: Joi.object({
    brandId: objectId().messages({
      "any.invalid": "Invalid brandId",
    }),
  }),
};

// The customer profile screen addresses a brand by path, never by an implicit
// "my brand" — a customer has no brand of their own to fall back to.
exports.validateGetCustomerBrand = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid brandId",
    }),
  },
};

exports.validateGetAllCustomerBrands = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
    search: Joi.string().trim().max(100).optional(),
    categoryId: objectId().optional().messages({
      "any.invalid": "Invalid category ID",
    }),
    subCategoryId: objectId().optional().messages({
      "any.invalid": "Invalid subCategory ID",
    }),
    // true  -> the "Top Brands" tab.
    // false -> everything, top brands leading.
    topOnly: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
    sortBy: Joi.string()
      .uppercase()
      .valid("TOP_FIRST", "NEWEST", "FOLLOWERS", "NAME", "DISTANCE")
      .default("TOP_FIRST"),
    sortOrder: Joi.string().valid("asc", "desc").optional(),
    // Optional. Supplied together they enable DISTANCE sorting and add a
    // `distance` field to each row; omitted, the listing is a plain directory.
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
  })
    .and("latitude", "longitude")
    .messages({
      "object.and": "latitude and longitude must be provided together",
    }),
};

// ---------------------------------------------------------------
// ADMIN — top brands (the customer app's "Top Brands" tab)
// ---------------------------------------------------------------
exports.validateReviewTopBrand = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: Joi.object({
    isTopBrand: Joi.boolean().required().messages({
      "any.required": "isTopBrand is required",
      "boolean.base": "isTopBrand must be a boolean",
    }),
    topOrder: Joi.number().integer().min(0).optional().messages({
      "number.min": "topOrder cannot be negative",
    }),
  }),
};

exports.validateGetTopBrands = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
  }),
};

// ---------------------------------------------------------------
// ADMIN — brand directory + the account on/off switch
// ---------------------------------------------------------------
const booleanFlag = (label) =>
  Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional()
    .messages({
      "alternatives.match": `${label} must be true or false`,
    });

exports.validateGetAllAdminBrands = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      "number.min": "Page must be at least 1",
    }),
    limit: Joi.number().integer().min(1).max(100).default(10).messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),
    // Brand name, legal name, brand id, merchant id, email, mobile, WhatsApp.
    search: Joi.string().trim().max(120).optional().messages({
      "string.max": "Search cannot exceed 120 characters",
    }),

    // Two separate switches, so two separate filters. Omit both to see
    // everything — an admin has to be able to *find* a deactivated account in
    // order to switch it back on.
    //
    //   accountActive → the vendor's `User.isActive` (can they sign in)
    //   isActive      → the brand's customer visibility (`Brand.isActive`)
    accountActive: booleanFlag("accountActive"),
    isActive: booleanFlag("isActive"),

    status: Joi.string()
      .uppercase()
      .valid(...Object.values(SYSTEM_VERIFICATION_STATUS))
      .optional()
      .messages({
        "any.only": `Status must be one of ${Object.values(SYSTEM_VERIFICATION_STATUS).join(", ")}`,
      }),
    isApproved: booleanFlag("isApproved"),
    isReviewed: booleanFlag("isReviewed"),
    isRejected: booleanFlag("isRejected"),
    isRevoked: booleanFlag("isRevoked"),
    isSubscribed: booleanFlag("isSubscribed"),
    isTopBrand: booleanFlag("isTopBrand"),

    categoryId: objectId().optional().messages({
      "any.invalid": "Invalid category ID",
    }),
    subCategoryId: objectId().optional().messages({
      "any.invalid": "Invalid subCategory ID",
    }),
    businessEntityType: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_ENTITY_TYPE))
      .optional()
      .messages({
        "any.only": `Business Entity Type must be one of ${Object.values(BUSINESS_ENTITY_TYPE).join(", ")}`,
      }),
    businessRegistrationStatus: Joi.string()
      .trim()
      .valid(...Object.values(BUSINESS_REGISTRATION_STATUS))
      .optional()
      .messages({
        "any.only": `Business Registration Status must be one of ${Object.values(BUSINESS_REGISTRATION_STATUS).join(", ")}`,
      }),
    // Where an unfinished onboarding stopped — the "who is stuck" worklist.
    currentScreen: Joi.string()
      .uppercase()
      .valid(...Object.values(SCREENS))
      .optional()
      .messages({
        "any.only": `Current screen must be one of ${Object.values(SCREENS).join(", ")}`,
      }),

    // Both inclusive, applied to `joinedDate`.
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).optional().messages({
      "date.min": "To date cannot be earlier than from date",
    }),

    sortBy: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_LIST_SORT_BY))
      .default(BRAND_LIST_SORT_BY.NEWEST)
      .messages({
        "any.only": `Sort by must be one of ${Object.values(BRAND_LIST_SORT_BY).join(", ")}`,
      }),
    // Ignored for NEWEST / OLDEST, which are directions in themselves.
    sortOrder: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_LIST_SORT_ORDER))
      .optional()
      .messages({
        "any.only": `Sort order must be one of ${Object.values(BRAND_LIST_SORT_ORDER).join(", ")}`,
      }),
  }),
};

/**
 * Two independent switches.
 *
 * `isActive` is the vendor's **account** (`User.isActive`) and is required — a
 * switch in a panel always knows which way it is going, and stating it makes the
 * call idempotent: two admins tapping at once cannot land the account in the
 * state neither of them chose. It is also what lets `reason` be constrained
 * below, since the direction has to be known before "only when deactivating"
 * means anything.
 *
 * `hideFromCustomers` is **customer visibility** (`Brand.isActive`) and is
 * optional — omit it and visibility is left exactly as it was. Deactivating an
 * account does not hide the brand: existing pages and vouchers keep serving
 * customers unless this is sent too.
 */
exports.validateToggleBrandStatus = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: Joi.object({
    isActive: Joi.boolean().required().messages({
      "any.required": "isActive is required",
      "boolean.base": "isActive must be a boolean",
    }),
    // Not defaulted. A default here would mean any call that simply did not
    // mention visibility silently re-listed (or de-listed) the brand — the same
    // bug `validator/subBrands.js` documents for outlet `isActive`.
    hideFromCustomers: Joi.boolean().optional().messages({
      "boolean.base": "hideFromCustomers must be a boolean",
    }),
    // Internal note, kept out of the vendor-facing notification. Optional when
    // switching the account off; forbidden when switching it on, where there is
    // nothing to give a reason for.
    reason: Joi.string()
      .trim()
      .max(BRAND_STATUS_LIMITS.MAX_REASON_LENGTH)
      .when("isActive", {
        is: false,
        then: Joi.optional(),
        otherwise: Joi.forbidden().messages({
          "any.unknown":
            "A reason is only accepted when deactivating an account",
        }),
      })
      .messages({
        "string.empty": "Reason cannot be empty",
        "string.max": `Reason cannot exceed ${BRAND_STATUS_LIMITS.MAX_REASON_LENGTH} characters`,
      }),
  }),
};

exports.validateUpdateBrand = {
  query: {
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: {
    brandName: Joi.string().trim().min(2).max(150).optional().messages({
      "string.empty": "Brand name can't be empty",
      "string.min": "Brand name must be at least 2 characters",
      "string.max": "Brand name cannot exceed 150 characters",
    }),
    email: Joi.string().trim().lowercase().email().optional().messages({
      "string.empty": "Email can't be empty",
      "string.email": "Please enter a valid email address",
    }),
    joinedDate: Joi.date().optional().messages({
      "date.base": "Please enter a valid joined date",
    }),
    description: Joi.string().trim().optional().messages({
      "string.empty": "Description can't be empty",
    }),
    // `isActive` used to be accepted here. It was a second, weaker way to
    // switch a brand off — no audit row, no notification, and it never touched
    // the vendor's own account, so the two could silently disagree. Both
    // switches now live on `PUT /brands/admin/:brandId/status`, which records
    // and notifies. A generic update is the wrong place to hide a moderation
    // action.
    //
    // `forbidden()` rather than just dropping it: `stripUnknown` would let a
    // panel keep sending `isActive`, get a 200, and believe the brand had been
    // switched off. A 422 naming the right endpoint is the louder, safer answer.
    isActive: Joi.forbidden().messages({
      "any.unknown":
        "isActive is not settable here. Use PUT /brands/admin/:brandId/status — `isActive` for the vendor's account, `hideFromCustomers` for customer visibility.",
    }),
    isOnboarding: Joi.boolean().optional().default(false),
    subCategoryId: Joi.when("isOnboarding", {
      is: true,
      then: objectId().required().messages({
        "any.required": "Sub-category ID is required during onboarding",
        "any.invalid": "Invalid Sub-category ID format",
      }),
      otherwise: objectId().optional().messages({
        "any.invalid": "Invalid Sub-category ID format",
      }),
    }),
  },
};

// ---------------------------------------------------------------
// ADMIN — BRAND VERIFICATION
// ---------------------------------------------------------------
exports.validateReviewBrandVerification = {
  params: {
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required",
      "any.invalid": "Invalid Brand ID format",
    }),
  },
  body: Joi.object({
    action: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_ADMIN_ACTION))
      .required()
      .messages({
        "any.required": "Review action is required",
        "string.empty": "Review action cannot be empty",
        "any.only": `Review action must be one of ${Object.values(BRAND_VERIFICATION_ADMIN_ACTION).join(", ")}`,
      }),
    rejectionReason: Joi.string()
      .trim()
      .max(BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH)
      .when("action", {
        is: BRAND_VERIFICATION_ADMIN_ACTION.REJECTED,
        then: Joi.required().messages({
          "any.required": "Rejection reason is required when rejecting a brand",
          "string.empty": "Rejection reason is required when rejecting a brand",
        }),
        otherwise: Joi.forbidden().messages({
          "any.unknown":
            "Rejection reason is only allowed when rejecting a brand",
        }),
      })
      .messages({
        "string.max": `Rejection reason cannot exceed ${BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH} characters`,
      }),
    revokeReason: Joi.string()
      .trim()
      .max(BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH)
      .when("action", {
        is: BRAND_VERIFICATION_ADMIN_ACTION.REVOKED,
        then: Joi.required().messages({
          "any.required": "Revoke reason is required when revoking an approval",
          "string.empty": "Revoke reason is required when revoking an approval",
        }),
        otherwise: Joi.forbidden().messages({
          "any.unknown":
            "Revoke reason is only allowed when revoking an approval",
        }),
      })
      .messages({
        "string.max": `Revoke reason cannot exceed ${BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH} characters`,
      }),
    // REVIEWED only. Omit it to flip the current value, or send an explicit
    // boolean to force it (idempotent panels).
    isReviewed: Joi.boolean()
      .when("action", {
        is: BRAND_VERIFICATION_ADMIN_ACTION.REVIEWED,
        then: Joi.optional(),
        otherwise: Joi.forbidden().messages({
          "any.unknown": "isReviewed is only allowed with the REVIEWED action",
        }),
      })
      .messages({
        "boolean.base": "isReviewed must be a boolean",
      }),
    note: Joi.string()
      .trim()
      .max(BRAND_VERIFICATION_LIMITS.MAX_NOTE_LENGTH)
      .optional()
      .messages({
        "string.empty": "Note cannot be empty",
        "string.max": `Note cannot exceed ${BRAND_VERIFICATION_LIMITS.MAX_NOTE_LENGTH} characters`,
      }),
  }),
};

exports.validateGetAllBrandVerifications = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional().messages({
      "number.min": "Page must be at least 1",
    }),
    limit: Joi.number().integer().min(1).max(100).optional().messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),
    search: Joi.string().trim().optional(),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
    reviewedByAdminId: objectId().optional().messages({
      "any.invalid": "Invalid Reviewed By ID format",
    }),
    status: Joi.string()
      .uppercase()
      .valid(...Object.values(SYSTEM_VERIFICATION_STATUS))
      .optional()
      .messages({
        "any.only": `Status must be one of ${Object.values(SYSTEM_VERIFICATION_STATUS).join(", ")}`,
      }),
    attemptNumber: Joi.number().integer().min(1).optional(),
    isReviewed: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    isRejected: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    isRevoked: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    isAdminApproved: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    isSuperseded: Joi.alternatives()
      .try(Joi.string(), Joi.boolean())
      .optional(),
    minScore: Joi.number().optional(),
    maxScore: Joi.number().optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).optional().messages({
      "date.min": "To date cannot be earlier than from date",
    }),
    sortBy: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_SORT_BY))
      .optional()
      .messages({
        "any.only": `Sort by must be one of ${Object.values(BRAND_VERIFICATION_SORT_BY).join(", ")}`,
      }),
    sortOrder: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_SORT_ORDER))
      .optional()
      .messages({
        "any.only": `Sort order must be one of ${Object.values(BRAND_VERIFICATION_SORT_ORDER).join(", ")}`,
      }),
  }),
};

exports.validateGetBrandVerificationHistory = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional().messages({
      "number.min": "Page must be at least 1",
    }),
    limit: Joi.number().integer().min(1).max(100).optional().messages({
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),
    // Ignored for vendors — the service always scopes them to their own brand.
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
    systemVerifyId: objectId().optional().messages({
      "any.invalid": "Invalid System Verify ID format",
    }),
    performedBy: objectId().optional().messages({
      "any.invalid": "Invalid Performed By ID format",
    }),
    action: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_ACTION))
      .optional()
      .messages({
        "any.only": `Action must be one of ${Object.values(BRAND_VERIFICATION_ACTION).join(", ")}`,
      }),
    performedByType: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_ACTOR))
      .optional()
      .messages({
        "any.only": `Performed by type must be one of ${Object.values(BRAND_VERIFICATION_ACTOR).join(", ")}`,
      }),
    attemptNumber: Joi.number().integer().min(1).optional(),
    search: Joi.string().trim().optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).optional().messages({
      "date.min": "To date cannot be earlier than from date",
    }),
    sortOrder: Joi.string()
      .uppercase()
      .valid(...Object.values(BRAND_VERIFICATION_SORT_ORDER))
      .optional()
      .messages({
        "any.only": `Sort order must be one of ${Object.values(BRAND_VERIFICATION_SORT_ORDER).join(", ")}`,
      }),
  }),
};
