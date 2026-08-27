const Joi = require("joi");
const objectId = require("./validJoiObjectId");

const {
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_MEDIA_TYPE,
} = require("../constants/showcase");

exports.validateCreateSection = Joi.object({
  // Required when an admin is creating on a brand's behalf; a vendor may omit
  // it and gets their own brand. `resolveActorBrand` enforces both halves.
  brandId: objectId().optional().messages({
    "any.invalid": "Invalid brandId",
  }),
  title: Joi.string().trim().min(2).max(60).required().messages({
    "string.empty": "Section title is required.",
    "string.min": "Section title must contain at least 2 characters.",
    "string.max": "Section title cannot exceed 60 characters.",
    "any.required": "Section title is required.",
  }),
  description: Joi.string().trim().allow("").max(500).optional(),
  sortOrder: Joi.number().integer().min(1).optional(),
  sectionType: Joi.string()
    .valid(...Object.values(SHOWCASE_SECTION_TYPE))
    .default(SHOWCASE_SECTION_TYPE.CUSTOM),
  isActive: Joi.boolean().optional(),
  isVisible: Joi.boolean().optional(),
  isShowVideosInClips: Joi.boolean().optional(),
});

exports.validateGetSection = {
  params: {
    sectionId: objectId().required(),
  },
  query: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().max(100).optional(),
    type: Joi.string()
      .valid(...Object.values(SHOWCASE_MEDIA_TYPE))
      .optional(),
  },
};

exports.validateGetAllSections = {
  query: Joi.object({
    // Optional for both roles, but it means different things: a vendor may only
    // name their own brand (the service rejects any other), while an admin uses
    // it to narrow a listing that is otherwise platform-wide.
    brandId: objectId().optional().messages({
      "any.invalid": "Invalid brandId",
    }),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    search: Joi.string().trim().allow("").optional(),
    isActive: Joi.boolean().optional(),
    isVisible: Joi.boolean().optional(),
    sortBy: Joi.string()
      .valid("title", "sortOrder", "createdAt", "updatedAt")
      .default("sortOrder"),
    order: Joi.string().valid("asc", "desc").default("asc"),
  }),
};

exports.validateUpdateSection = {
  params: {
    sectionId: objectId().required(),
  },
  body: Joi.object({
    title: Joi.string().trim().min(2).max(60).optional(),
    description: Joi.string().trim().max(500).optional(),
    sortOrder: Joi.number().integer().min(0).optional(),
    sectionType: Joi.string()
      .valid(...Object.values(SHOWCASE_SECTION_TYPE))
      .optional(),
    isActive: Joi.boolean().optional(),
    isVisible: Joi.boolean().optional(),
    isShowVideosInClips: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};

exports.validateGetBrandShowcase = {
  params: { brandId: objectId().required() },
};

exports.validateGetVideoClips = {
  params: { brandId: objectId().required() },
  query: {
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
  },
};

exports.validateDeleteSection = {
  params: {
    sectionId: objectId().required(),
  },
};

exports.validateReorderSections = {
  params: { brandId: objectId().required() },
  body: {
    sections: Joi.array()
      .min(1)
      .required()
      .items(
        Joi.object({
          id: objectId().required(),
          sortOrder: Joi.number().integer().min(1).required(),
        }),
      ),
  },
};

// Media
exports.validateAddMedia = {
  params: {
    sectionId: objectId().required(),
  },
  body: Joi.object({
    isShowInVideoClips: Joi.boolean().default(true),
  }),
};

exports.validateUpdateMedia = {
  params: {
    sectionId: objectId().required(),
    mediaId: objectId().required(),
  },
  body: Joi.object({
    title: Joi.string().trim().max(100).optional(),
    altText: Joi.string().trim().max(150).optional(),
    isShowInVideoClips: Joi.boolean().optional(),
    sortOrder: Joi.number().integer().min(1).optional(),
    isActive: Joi.boolean().optional(),
  }),
};

exports.validateReplaceMedia = {
  params: {
    sectionId: objectId().required(),
    mediaId: objectId().required(),
  },
};

exports.validateDeleteMedia = {
  params: {
    sectionId: objectId().required(),
    mediaId: objectId().required(),
  },
};

exports.validateReorderMedias = {
  params: { sectionId: objectId().required() },
  body: {
    medias: Joi.array()
      .items(
        Joi.object({
          id: objectId().required(),
          sortOrder: Joi.number().integer().min(0).required(),
        }),
      )
      .min(1)
      .required(),
  },
};
