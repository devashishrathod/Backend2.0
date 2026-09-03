const Joi = require("joi");
const { ROLES, LOGIN_TYPES } = require("../constants");

/**
 * Shown whenever a non-admin role is offered to a password endpoint.
 *
 * Password sign-in is deliberately admin-only — customers and vendors
 * authenticate with a WhatsApp OTP, so a password on those accounts would be a
 * credential to steal and nothing more. Naming the alternative here keeps the
 * refusal actionable instead of a bare "Invalid role".
 */
const PASSWORD_ROLE_MESSAGE =
  "Password sign-in is only available for admin accounts. Customers and vendors sign in with a WhatsApp OTP.";

exports.validateRegisterUser = Joi.object({
  name: Joi.string().trim().min(3).max(120).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must contain at least {#limit} characters",
    "string.max": "Name cannot exceed {#limit} characters",
    "any.required": "Name is required",
  }),
  email: Joi.string().trim().lowercase().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please enter a valid email address",
    "any.required": "Email is required",
  }),
  // No default. This endpoint sits behind `isAdmin`, but a silent ADMIN default
  // is still the wrong shape for a create call — the caller should have to say
  // what they are creating.
  role: Joi.string()
    .trim()
    .uppercase()
    .valid(...Object.values(ROLES))
    .required()
    .messages({
      "any.required": "Role is required",
      "any.only": `Role must be one of: ${Object.values(ROLES).join(", ")}`,
    }),
  dob: Joi.date().max("now").required().messages({
    "date.base": "Date of birth must be a valid date",
    "date.max": "Date of birth cannot be in future",
    "any.required": "Date of birth is required",
  }),
  whatsappNumber: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "WhatsApp number is required",
      "string.pattern.base": "Please enter a valid 10 digit WhatsApp number",
      "any.required": "WhatsApp number is required",
    }),
  mobile: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "Mobile number is required",
      "string.pattern.base": "Please enter a valid 10 digit Mobile number",
      "any.required": "Mobile number is required",
    }),
  username: Joi.string()
    .trim()
    .pattern(/^[a-z0-9_]{3,50}$/)
    .required()
    .messages({
      "string.empty": "Username is required",
      "string.pattern.base":
        "Username can only contain lowercase letters, numbers, and underscores",
      "string.min": "Username must contain at least {#limit} characters",
      "string.max": "Username cannot exceed {#limit} characters",
      "any.required": "Username is required",
    }),
  password: Joi.string().min(8).max(30).required().messages({
    "string.empty": "Password is required",
    "string.min": "Password must contain at least {#limit} characters",
    "string.max": "Password cannot exceed {#limit} characters",
    "any.required": "Password is required",
  }),
  isActive: Joi.boolean().optional(),
});

exports.validateLogin = Joi.object({
  type: Joi.string()
    .valid(LOGIN_TYPES.EMAIL, LOGIN_TYPES.MOBILE, LOGIN_TYPES.USERNAME)
    .required()
    .messages({
      "string.base": "Login type must be a string",
      "any.only": "Invalid login type",
      "string.pattern.base": "Invalid login type",
    }),
  email: Joi.when("type", {
    is: LOGIN_TYPES.EMAIL,
    then: Joi.string().trim().lowercase().email().required().messages({
      "string.empty": "Email is required",
      "string.email": "Please enter a valid email address",
      "any.required": "Email is required",
    }),
    otherwise: Joi.forbidden(),
  }),
  mobile: Joi.when("type", {
    is: LOGIN_TYPES.MOBILE,
    then: Joi.string()
      .trim()
      .pattern(/^[6-9]\d{9}$/)
      .required()
      .messages({
        "string.empty": "Mobile number is required",
        "string.pattern.base": "Please enter a valid 10 digit Mobile number",
        "any.required": "Mobile number is required",
      }),
    otherwise: Joi.forbidden(),
  }),
  username: Joi.when("type", {
    is: LOGIN_TYPES.USERNAME,
    then: Joi.string()
      .trim()
      .pattern(/^[a-z0-9_]{3,50}$/)
      .required()
      .messages({
        "string.empty": "Username is required",
        "string.pattern.base":
          "Username can only contain lowercase letters, numbers, and underscores",
        "any.required": "Username is required",
      }),
    otherwise: Joi.forbidden(),
  }),
  // Password sign-in is admin-only: every other role authenticates by OTP, so
  // handing them a password would only add a credential worth stealing.
  role: Joi.when("type", {
    is: Joi.valid(LOGIN_TYPES.EMAIL, LOGIN_TYPES.MOBILE),
    then: Joi.string()
      .uppercase()
      .valid(ROLES.ADMIN)
      .default(ROLES.ADMIN)
      .messages({
        "any.only": PASSWORD_ROLE_MESSAGE,
      }),
    otherwise: Joi.forbidden(),
  }),
  password: Joi.string().min(8).max(30).required(),
});

exports.validateWhatsappLoginOrSignUp = Joi.object({
  whatsappNumber: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "WhatsApp number is required",
      "string.pattern.base": "Please enter a valid 10 digit WhatsApp number",
      "any.required": "WhatsApp number is required",
    }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.CUSTOMER)
    .messages({
      "any.only": "Invalid role",
    }),
});

exports.validateWhatsappVerifyOtp = Joi.object({
  whatsappNumber: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "WhatsApp number is required",
      "string.pattern.base": "Please enter a valid 10 digit WhatsApp number",
      "any.required": "WhatsApp number is required",
    }),
  otp: Joi.string().length(6).required().messages({
    "string.empty": "OTP is required",
    "string.length": "OTP must be 6 digits",
    "any.required": "OTP is required",
  }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.CUSTOMER)
    .messages({
      "any.only": "Invalid role",
    }),
  currentScreen: Joi.string().optional().messages({
    "string.empty": "Current Screen is required",
  }),
});

exports.validateSendEmailLogin = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please enter a valid email address",
    "any.required": "Email is required",
  }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.ADMIN)
    .messages({
      "any.only": "Invalid role",
    }),
});

exports.validateVerifyEmailOtp = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please enter a valid email address",
    "any.required": "Email is required",
  }),
  otp: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.empty": "OTP is required",
      "string.pattern.base": "OTP must be a 6 digit number",
      "any.required": "OTP is required",
    }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.ADMIN)
    .messages({
      "any.only": "Invalid role",
    }),
  currentScreen: Joi.string().optional().messages({
    "string.empty": "Current Screen is required",
  }),
});

exports.validateSendMobileLogin = Joi.object({
  mobile: Joi.string()
    .pattern(/^\d{10}$/)
    .required()
    .messages({
      "string.pattern.base": "Mobile number must be 10 digits",
      "any.required": "Mobile number is required",
    }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.ADMIN)
    .messages({
      "any.only": "Invalid role",
    }),
});

exports.validateVerifyMobileOtp = Joi.object({
  mobile: Joi.string()
    .pattern(/^\d{10}$/)
    .required()
    .messages({
      "string.pattern.base": "Mobile number must be 10 digits",
      "any.required": "Mobile number is required",
    }),
  sessionId: Joi.string().required().messages({
    "any.required": "Session ID is required",
  }),
  otp: Joi.string()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "string.empty": "OTP is required",
      "string.pattern.base": "OTP must be a 6 digit number",
      "any.required": "OTP is required",
    }),
  role: Joi.string()
    .uppercase()
    .valid(...Object.values(ROLES))
    .default(ROLES.ADMIN)
    .messages({
      "any.only": "Invalid role",
    }),
  currentScreen: Joi.string().optional().messages({
    "string.empty": "Current Screen is required",
  }),
});

// ---------------------------------------------------------------------------
// Password set / reset
// ---------------------------------------------------------------------------

// One rule, used by both set and reset, so the strength requirement cannot
// diverge between the two paths.
const strongPassword = Joi.string()
  .min(8)
  .max(72) // bcrypt silently truncates past 72 bytes
  .pattern(/[a-z]/, "lowercase")
  .pattern(/[A-Z]/, "uppercase")
  .pattern(/\d/, "number")
  .required()
  .messages({
    "string.min": "Password must be at least {#limit} characters",
    "string.max": "Password cannot exceed {#limit} characters",
    "string.pattern.name":
      "Password must include an uppercase letter, a lowercase letter and a number",
    "any.required": "newPassword is required",
  });

exports.validateSetPassword = {
  body: Joi.object({
    // Only required when the account already has a password — enforced in the
    // service, which is the only place that knows whether it does.
    currentPassword: Joi.string().optional(),
    newPassword: strongPassword,
  }),
};

exports.validateForgotPassword = {
  body: Joi.object({
    type: Joi.string()
      .valid(LOGIN_TYPES.WHATSAPP, LOGIN_TYPES.EMAIL, LOGIN_TYPES.MOBILE)
      .required()
      .messages({
        "any.only": "type must be one of: WHATSAPP, EMAIL, MOBILE",
        "any.required": "type is required",
      }),
    target: Joi.string().trim().required().messages({
      "any.required": "target (the number or email) is required",
    }),
    role: Joi.string()
      .uppercase()
      .valid(ROLES.ADMIN)
      .default(ROLES.ADMIN)
      .messages({
        "any.only": PASSWORD_ROLE_MESSAGE,
      }),
  }),
};

exports.validateResetPassword = {
  body: Joi.object({
    type: Joi.string()
      .valid(LOGIN_TYPES.WHATSAPP, LOGIN_TYPES.EMAIL, LOGIN_TYPES.MOBILE)
      .required(),
    target: Joi.string().trim().required(),
    otp: Joi.string().trim().required().messages({
      "any.required": "otp is required",
    }),
    role: Joi.string()
      .uppercase()
      .valid(ROLES.ADMIN)
      .default(ROLES.ADMIN)
      .messages({
        "any.only": PASSWORD_ROLE_MESSAGE,
      }),
    newPassword: strongPassword,
  }),
};
