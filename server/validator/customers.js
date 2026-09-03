const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { LOGIN_TYPES } = require("../constants");
const {
  CUSTOMER_LIST_SORT_BY,
  CUSTOMER_LIST_SORT_ORDER,
  CUSTOMER_LIST_LIMITS,
  CUSTOMER_DETAIL_LIMITS,
} = require("../constants/customerList");

/**
 * A tri-state flag: omitted means "do not filter", not "false".
 *
 * Query strings carry no booleans, so `?isActive=false` arrives as the string
 * `"false"` — which is truthy. Accepting both shapes here is what stops the
 * service from having to guess, and `convert: true` in `validateSchema` turns
 * the string into a real boolean before it ever reaches the pipeline.
 */
const booleanFlag = (label) =>
  Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional()
    .messages({
      "alternatives.match": `${label} must be true or false`,
    });

// ---------------------------------------------------------------
// ADMIN — the customer directory
// ---------------------------------------------------------------
exports.validateGetAllAdminCustomers = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1).messages({
      "number.min": "Page must be at least 1",
    }),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(CUSTOMER_LIST_LIMITS.MAX_PAGE_SIZE)
      .default(CUSTOMER_LIST_LIMITS.DEFAULT_PAGE_SIZE)
      .messages({
        "number.min": "Limit must be at least 1",
        "number.max": `Limit cannot exceed ${CUSTOMER_LIST_LIMITS.MAX_PAGE_SIZE}`,
      }),

    /**
     * Name, customer id, email, mobile, WhatsApp.
     *
     * All five live on `Customer` itself, so the search narrows **before** the
     * user join runs. `fullName` is kept in step with `User.name` by
     * `updateUserById`, which is what makes searching the customer row rather
     * than the account row correct as well as cheap.
     */
    search: Joi.string()
      .trim()
      .max(CUSTOMER_LIST_LIMITS.MAX_SEARCH_LENGTH)
      .optional()
      .messages({
        "string.max": `Search cannot exceed ${CUSTOMER_LIST_LIMITS.MAX_SEARCH_LENGTH} characters`,
      }),

    /**
     * Two independent switches, so two independent filters. Omit both to see
     * everything — an admin has to be able to *find* a deactivated account in
     * order to switch it back on.
     *
     *   accountActive → `User.isActive`     (can this person sign in at all)
     *   isActive      → `Customer.isActive` (is the customer profile row live)
     *
     * These are not kept in step by anything, which is exactly why both are
     * filterable and both are returned.
     */
    accountActive: booleanFlag("accountActive"),
    isActive: booleanFlag("isActive"),

    // Profile / onboarding progress.
    isSignUpCompleted: booleanFlag("isSignUpCompleted"),
    isOnBoardingCompleted: booleanFlag("isOnBoardingCompleted"),
    isMobileVerified: booleanFlag("isMobileVerified"),
    isEmailVerified: booleanFlag("isEmailVerified"),
    isLoggedIn: booleanFlag("isLoggedIn"),

    // How the account was created. WHATSAPP for anyone who came in through the
    // public login route.
    loginType: Joi.string()
      .uppercase()
      .valid(...Object.values(LOGIN_TYPES))
      .optional()
      .messages({
        "any.only": `Login type must be one of ${Object.values(LOGIN_TYPES).join(", ")}`,
      }),

    /**
     * Where they are.
     *
     * ⚠️ Lives on `Location`, not on the customer, so passing either of these
     * adds a join to the page query. Charged only when asked for — see the note
     * in `getAllAdminCustomers`.
     */
    city: Joi.string()
      .trim()
      .max(CUSTOMER_LIST_LIMITS.MAX_CITY_LENGTH)
      .optional()
      .messages({
        "string.max": `City cannot exceed ${CUSTOMER_LIST_LIMITS.MAX_CITY_LENGTH} characters`,
      }),
    state: Joi.string()
      .trim()
      .max(CUSTOMER_LIST_LIMITS.MAX_CITY_LENGTH)
      .optional()
      .messages({
        "string.max": `State cannot exceed ${CUSTOMER_LIST_LIMITS.MAX_CITY_LENGTH} characters`,
      }),

    // Both inclusive, applied to when the customer joined (`createdAt`).
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().min(Joi.ref("fromDate")).optional().messages({
      "date.min": "To date cannot be earlier than from date",
    }),

    sortBy: Joi.string()
      .uppercase()
      .valid(...Object.values(CUSTOMER_LIST_SORT_BY))
      .default(CUSTOMER_LIST_SORT_BY.NEWEST)
      .messages({
        "any.only": `Sort by must be one of ${Object.values(CUSTOMER_LIST_SORT_BY).join(", ")}`,
      }),
    // Ignored for NEWEST / OLDEST, which are directions in themselves.
    sortOrder: Joi.string()
      .uppercase()
      .valid(...Object.values(CUSTOMER_LIST_SORT_ORDER))
      .optional()
      .messages({
        "any.only": `Sort order must be one of ${Object.values(CUSTOMER_LIST_SORT_ORDER).join(", ")}`,
      }),
  }),
};

// ---------------------------------------------------------------
// ADMIN — one customer, in full
// ---------------------------------------------------------------
exports.validateGetAdminCustomer = {
  params: Joi.object({
    /**
     * A Mongo id, or the `#TC64840` number the customer reads out.
     *
     * The bare `TC64840` form is accepted alongside `#TC64840` because the `#`
     * has to be percent-encoded to survive a URL — an admin pasting an id out of
     * a support ticket will not do that, and an unencoded `#` makes the browser
     * treat the rest as a fragment, so the server sees a truncated path and
     * answers 404 on a route that looks perfectly correct.
     */
    customerId: Joi.alternatives()
      .try(objectId(), Joi.string().trim().pattern(/^#?TC\d+$/i))
      .required()
      .messages({
        "any.required": "Customer id is required",
        "alternatives.match":
          "Customer id must be a valid id or a customer number like #TC64840",
      }),
  }),
  query: Joi.object({
    /**
     * How many rows each embedded list carries. Every one of them also reports
     * its own `total`, so a capped list never reads as the whole story.
     */
    recentLimit: Joi.number()
      .integer()
      .min(1)
      .max(CUSTOMER_DETAIL_LIMITS.MAX_RECENT)
      .default(CUSTOMER_DETAIL_LIMITS.DEFAULT_RECENT)
      .messages({
        "number.min": "recentLimit must be at least 1",
        "number.max": `recentLimit cannot exceed ${CUSTOMER_DETAIL_LIMITS.MAX_RECENT}`,
      }),
  }),
};
