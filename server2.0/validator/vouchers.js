const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const {
  VOUCHER_DISCOUNT_TYPES,
  VOUCHER_USAGE_TYPE,
  DISCOUNT_APPLICABLE_ON,
  VOUCHER_APPROVAL_ACTION,
  VOUCHER_STATUSES,
  VOUCHER_SORT_BY,
} = require("../constants/voucher");
const { VOUCHER_BANNER_TYPE } = require("../constants/voucherBanner");

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
    // Optional — the voucher's own independent promo banner, unrelated to
    // the version/approval flow. If provided, a matching file must be sent
    // under bannerImage/bannerVideo/bannerGif.
    bannerType: Joi.string()
      .valid(...Object.values(VOUCHER_BANNER_TYPE))
      .optional(),
  }),
};

exports.validateSetVoucherBanner = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID.",
    }),
  },
  body: Joi.object({
    bannerType: Joi.string()
      .valid(...Object.values(VOUCHER_BANNER_TYPE))
      .required()
      .messages({
        "any.required": "Banner type is required.",
        "any.only": `Banner type must be one of: ${Object.values(VOUCHER_BANNER_TYPE).join(", ")}.`,
      }),
  }),
};

exports.validateDeleteVoucherBanner = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID.",
    }),
  },
};

const jsonTolerantArray = (itemSchema, { label = "Item" } = {}) =>
  Joi.any().custom((value, helpers) => {
    if (value === undefined || value === null || value === "") return [];
    let items = value;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch (error) {
        items = [items];
      }
    }
    if (!Array.isArray(items)) items = [items];

    const parsedItems = [];
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            item = JSON.parse(trimmed);
          } catch (error) {
            item = trimmed;
          }
        }
      }
      const { error, value: validItem } = itemSchema.validate(item, {
        convert: true,
      });
      if (error) {
        const messages = error.details
          .map((detail) => detail.message)
          .join(", ");
        return helpers.message({ custom: `${label} ${i + 1}: ${messages}` });
      }
      parsedItems.push(validItem);
    }
    return parsedItems;
  });

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
    startAt: Joi.date().iso().optional(),
    endAt: Joi.date().iso().optional(),

    newTags: jsonTolerantArray(Joi.string().trim().min(1), {
      label: "Tag",
    }).optional(),
    removedTags: jsonTolerantArray(Joi.string().trim().min(1), {
      label: "Tag",
    }).optional(),

    newOffers: jsonTolerantArray(offerSchema, { label: "Offer" }).optional(),
    removedOfferIds: jsonTolerantArray(objectId(), {
      label: "Offer ID",
    }).optional(),

    removeImageIds: jsonTolerantArray(objectId(), {
      label: "Image ID",
    }).optional(),

    newSubBrandIds: jsonTolerantArray(objectId(), {
      label: "Sub-brand ID",
    }).optional(),
    removeSubBrandIds: jsonTolerantArray(objectId(), {
      label: "Sub-brand ID",
    }).optional(),
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
        // Legacy raw-field sort (admin table columns) — unchanged.
        "name",
        "versionNumber",
        "status",
        "startAt",
        "endAt",
        "publishedAt",
        "createdAt",
        "updatedAt",
        // Curated presets (VOUCHER_SORT_BY) — DISTANCE excluded, this listing
        // has no customer geo context.
        VOUCHER_SORT_BY.NEWEST,
        VOUCHER_SORT_BY.EXPIRING_SOON,
        VOUCHER_SORT_BY.RELEVANCE,
      )
      .optional(),
    // No default: each sortBy preset applies its own natural direction
    // (NEWEST -> desc, EXPIRING_SOON -> asc) when this is omitted; legacy
    // raw-field sorts still default to desc, same as before.
    sortOrder: Joi.string().valid("asc", "desc").optional(),
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
      .valid(...Object.values(VOUCHER_SORT_BY))
      .default(VOUCHER_SORT_BY.DISTANCE),
    // No default: DISTANCE/RELEVANCE default to asc/best-match, NEWEST
    // defaults to desc, EXPIRING_SOON defaults to asc — see
    // buildCustomerVoucherPipeline for the per-preset direction.
    sortOrder: Joi.string().valid("asc", "desc").optional(),
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
    // true  -> the "Suggestions" tab: only what an admin pinned.
    // false -> everything, with the pinned ones leading. That single sorted set
    //          is what makes "view more" paginate without repeating them.
    suggestedOnly: Joi.alternatives()
      .try(Joi.boolean(), Joi.string().valid("true", "false"))
      .optional(),
  }),
};

// ---------------------------------------------------------------
// ADMIN — voucher suggestions (the customer app's "Suggestions" tab)
// ---------------------------------------------------------------
exports.validateReviewVoucherSuggestion = {
  params: {
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID.",
    }),
  },
  body: Joi.object({
    // One call both ways — false removes it from the list.
    isSuggested: Joi.boolean().required().messages({
      "any.required": "isSuggested is required",
      "boolean.base": "isSuggested must be a boolean",
    }),
    // Lower sorts first. Only meaningful when pinning.
    suggestionOrder: Joi.number().integer().min(0).optional().messages({
      "number.min": "suggestionOrder cannot be negative",
    }),
  }),
};

exports.validateGetSuggestedVouchers = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
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

exports.validateCustomerVoucherPreview = {
  body: Joi.object({
    voucherId: objectId().required().messages({
      "any.required": "Voucher ID is required.",
      "any.invalid": "Invalid voucher ID format.",
    }),
    outletId: objectId().required().messages({
      "any.required": "Outlet ID is required.",
      "any.invalid": "Invalid outlet ID format.",
    }),
    billAmount: Joi.number().positive().precision(2).required().messages({
      "number.base": "Bill amount must be a number.",
      "number.positive": "Bill amount must be greater than zero.",
      "any.required": "Bill amount is required.",
    }),
  }),
};
