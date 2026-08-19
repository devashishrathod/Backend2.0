const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_STATUSES,
} = require("../constants/voucher");

const offerSchema = Joi.object({
  title: Joi.string().required(),
  minBillAmount: Joi.number().positive().required().messages({
    "any.required": "Minimum bill amount is required.",
    "number.positive": "Minimum bill amount must be greater than zero.",
  }),
  discountType: Joi.string()
    .valid(...Object.values(VOUCHER_DISCOUNT_TYPES))
    .required(),
  usageType: Joi.string()
    .valid(...Object.values(VOUCHER_USAGE_TYPE))
    .required(),
  discountApplicableOn: Joi.string()
    .valid(...Object.values(DISCOUNT_APPLICABLE_ON))
    .optional()
    .default(DISCOUNT_APPLICABLE_ON.SUBTOTAL),
  discountValue: Joi.number().positive().required(),
  maxDiscountAmount: Joi.number().positive().optional(),
  sortOrder: Joi.number().integer().min(1).required().messages({
    "any.required": "Sort order is required.",
    "number.min": "Sort order must be at least 1.",
  }),
  isActive: Joi.boolean().optional(),
});

const offersSchema = Joi.any()
  .custom((value, helpers) => {
    let offers = Array.isArray(value) ? value : [value];
    if (!offers.length) return helpers.error("any.required");
    const parsedOffers = [];
    for (let i = 0; i < offers.length; i++) {
      let offer = offers[i];
      if (typeof offer === "string") {
        try {
          offer = JSON.parse(offer);
        } catch (error) {
          return helpers.message({
            custom: `Invalid offer JSON at index ${i}.`,
          });
        }
      }
      if (!offer || typeof offer !== "object" || Array.isArray(offer)) {
        return helpers.message({
          custom: `Offer at index ${i} must be an object.`,
        });
      }
      const { error, value: validatedOffer } = offerSchema.validate(offer, {
        abortEarly: false,
        convert: true,
      });
      if (error) {
        const messages = error.details
          .map((detail) => detail.message)
          .join(", ");
        return helpers.message({
          custom: `Offer ${i + 1}: ${messages}`,
        });
      }
      parsedOffers.push(validatedOffer);
    }
    if (parsedOffers.length < 1) return helpers.error("any.required");
    return parsedOffers;
  })
  .required()
  .messages({
    "any.required": "At least one offer is required.",
  });

exports.validateCreateVoucher = {
  body: Joi.object({
    brandId: objectId().required().messages({
      "any.required": "Brand ID is required.",
      "any.invalid": "Invalid Brand ID.",
    }),
    name: Joi.string().trim().min(2).max(150).required(),
    description: Joi.string().trim().max(2000).optional(),
    tags: Joi.array()
      .items(Joi.string().messages({ "any.invalid": "Invalid tag" }))
      .min(1)
      .optional(),
    startAt: Joi.date().iso().required(),
    endAt: Joi.date().iso().required(),
    offers: offersSchema,
    subBrandIds: Joi.array()
      .items(
        objectId().messages({
          "any.invalid": "Invalid sub-brand ID.",
        }),
      )
      .min(1)
      .required(),
    isSaveAsDraft: Joi.boolean().optional().default(true),
  }),
};

exports.validateUpdateVoucher = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID.",
    }),
  },
  body: Joi.object({
    name: Joi.string().trim().min(2).max(150).optional(),
    description: Joi.string().trim().max(2000).allow("").optional(),
    // categoryId: objectId().optional().messages({
    //   "any.invalid": "Invalid category ID.",
    // }),
    // subCategoryId: objectId().allow(null).optional(),
    startAt: Joi.date().iso().optional(),
    endAt: Joi.date().iso().optional(),
    tags: Joi.array()
      .items(Joi.string().messages({ "any.invalid": "Invalid tag" }))
      .min(1)
      .optional(),
    offers: Joi.array().min(1).items(offerSchema).optional(),
    subBrandIds: Joi.array().items(objectId()).min(1).optional(),
    saveAsDraft: Joi.boolean().optional(),
  }),
};

exports.validateSubmitVoucherForReview = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID.",
    }),
  },
};

exports.validateReviewVoucher = {
  params: {
    versionId: objectId().required().messages({
      "any.required": "Voucher version ID is required.",
      "any.invalid": "Invalid voucher version ID.",
    }),
  },
  body: Joi.object({
    action: Joi.string()
      .valid(VOUCHER_APPROVAL_ACTION.APPROVED, VOUCHER_APPROVAL_ACTION.REJECTED)
      .required()
      .messages({
        "string.base": "Review action must be a string.",
        "any.only": "Action must be either APPROVED or REJECTED.",
        "any.required": "Review action is required.",
        "string.empty": "Review action cannot be empty.",
      }),
    rejectionReason: Joi.string()
      .trim()
      .max(1000)
      .when("action", {
        is: VOUCHER_APPROVAL_ACTION.REJECTED,
        then: Joi.required().messages({
          "any.required":
            "Rejection reason is required when rejecting a voucher.",
          "string.empty":
            "Rejection reason is required when rejecting a voucher.",
        }),
        otherwise: Joi.forbidden().messages({
          "any.unknown":
            "Rejection reason is not allowed when approving a voucher.",
        }),
      })
      .messages({
        "string.base": "Rejection reason must be a string.",
        "string.max": "Rejection reason cannot exceed 1000 characters.",
        "string.empty": "Rejection reason cannot be empty.",
      }),
  }),
};

exports.validatePublishVoucher = {
  params: {
    versionId: objectId().required().messages({
      "any.required": "Voucher version ID is required.",
      "any.invalid": "Invalid voucher version ID.",
    }),
  },
};

exports.validateGetAllVoucherVersions = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    search: Joi.string().trim().optional(),
    voucherId: objectId().optional().messages({
      "any.invalid": "Invalid Voucher ID format",
    }),
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid Brand ID format",
    }),
    categoryId: objectId().optional().messages({
      "any.invalid": "Invalid Category ID format",
    }),
    subCategoryId: objectId().optional().messages({
      "any.invalid": "Invalid Sub Category ID format",
    }),
    createdBy: objectId().optional().messages({
      "any.invalid": "Invalid Created By ID format",
    }),
    submittedBy: objectId().optional().messages({
      "any.invalid": "Invalid Submitted By ID format",
    }),
    reviewedBy: objectId().optional().messages({
      "any.invalid": "Invalid Reviewed By ID format",
    }),
    approvedBy: objectId().optional().messages({
      "any.invalid": "Invalid Approved By ID format",
    }),
    rejectedBy: objectId().optional().messages({
      "any.invalid": "Invalid Rejected By ID format",
    }),
    versionNumber: Joi.number().integer().min(1).optional(),
    name: Joi.string().trim().optional(),
    versionCode: Joi.string().trim().optional(),
    status: Joi.string()
      .valid(...Object.values(VOUCHER_STATUSES))
      .optional(),
    isImmutable: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    isActive: Joi.alternatives().try(Joi.string(), Joi.boolean()).optional(),
    fromDate: Joi.date().iso().optional(),
    toDate: Joi.date().iso().optional(),
    sortBy: Joi.string()
      .valid(
        "name",
        "versionNumber",
        "status",
        "startAt",
        "endAt",
        "publishedAt",
        "createdAt",
        "updatedAt",
      )
      .optional(),
    sortOrder: Joi.string().valid("asc", "desc").optional().default("desc"),
  }),
};

exports.validateCustomerGetAllVouchers = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
    search: Joi.string().trim().max(100).optional(),
    categoryId: objectId().optional().messages({
      "any.invalid": "Invalid category ID.",
    }),
    subCategoryId: objectId().optional().messages({
      "any.invalid": "Invalid subCategory ID.",
    }),
    sortBy: Joi.string()
      .valid("distance", "createdAt", "startAt", "endAt")
      .default("distance"),
    sortOrder: Joi.string().valid("asc", "desc").default("asc"),
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
  }),
};

exports.validateCustomerGetVoucher = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID format.",
    }),
  },
  query: Joi.object({
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
    outletId: objectId().optional().messages({
      "any.invalid": "Invalid outlet ID format.",
    }),
  }),
};
