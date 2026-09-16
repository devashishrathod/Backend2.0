const Joi = require("joi");
const objectId = require("./validJoiObjectId");

const {
  SHOWCASE_SECTION_TYPE,
  SHOWCASE_MEDIA_TYPE,
  SHOWCASE_COVER_IMAGE_MODE,
} = require("../constants/showcase");

/**
 * ⚠️ No `sortOrder` here, and none on update either (S-13).
 *
 * Positions belong to the reorder endpoints, which renumber a whole list at once
 * and can therefore keep it dense and unique. A position accepted one section at
 * a time cannot: two creates naming `1` both get it, and the order that comes
 * back depends on which document Mongo returns first. The media update endpoint
 * has refused it from the start for exactly this reason; this is the rest of the
 * domain catching up.
 *
 * `stripUnknown` is on for every request, so a client still sending the field
 * has it dropped rather than being refused — nothing to migrate.
 */
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
  description: Joi.string().trim().allow("").max(500).optional().messages({
    "string.max": "Description cannot exceed 500 characters.",
  }),
  sectionType: Joi.string()
    .valid(...Object.values(SHOWCASE_SECTION_TYPE))
    .default(SHOWCASE_SECTION_TYPE.CUSTOM)
    .messages({
      "any.only": "Section type must be either CUSTOM or SYSTEM.",
    }),
  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be true or false.",
  }),
  // Customer-facing switch: false creates the section hidden from the brand
  // profile and the gallery, visible only in the vendor's own list.
  isVisible: Joi.boolean().optional().messages({
    "boolean.base": "isVisible must be true or false.",
  }),
  isShowVideosInClips: Joi.boolean().optional().messages({
    "boolean.base": "isShowVideosInClips must be true or false.",
  }),
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
      .optional()
      .messages({
        "any.only": "Media type must be either PHOTO or VIDEO.",
      }),
    // The managed view returns every media that is not deleted, switched-off
    // ones included, so the vendor can switch them back on. This narrows to one
    // side when the panel wants a tab for it.
    isActive: Joi.boolean().optional().messages({
      "boolean.base": "isActive must be true or false.",
    }),
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
    title: Joi.string().trim().min(2).max(60).optional().messages({
      "string.empty": "Section title cannot be empty.",
      "string.min": "Section title must contain at least 2 characters.",
      "string.max": "Section title cannot exceed 60 characters.",
    }),
    // `""` clears the description — the service now honours it.
    description: Joi.string().trim().allow("").max(500).optional().messages({
      "string.max": "Description cannot exceed 500 characters.",
    }),
    // ⚠️ No `sortOrder` — see the note on `validateCreateSection`.
    sectionType: Joi.string()
      .valid(...Object.values(SHOWCASE_SECTION_TYPE))
      .optional()
      .messages({
        "any.only": "Section type must be either CUSTOM or SYSTEM.",
      }),
    isActive: Joi.boolean().optional().messages({
      "boolean.base": "isActive must be true or false.",
    }),
    isVisible: Joi.boolean().optional().messages({
      "boolean.base": "isVisible must be true or false.",
    }),
    isShowVideosInClips: Joi.boolean().optional().messages({
      "boolean.base": "isShowVideosInClips must be true or false.",
    }),
    /**
     * Pin a cover: the media whose picture the section should show.
     *
     * Without it the cover follows the first visible media and moves on every
     * add, delete and reorder. `coverImageMode: "AUTO"` gives that behaviour
     * back.
     */
    coverMediaId: objectId().optional(),
    /**
     * ⚠️ **`AUTO` only** — `MANUAL` is not something a caller can ask for.
     *
     * `MANUAL` is what pinning *produces*, not an instruction. Accepting it on
     * its own would mean a mode with nothing pinned: the cover would freeze
     * wherever it happened to be and stop following anything, and the service
     * has no media to point it at — so it would do nothing at all and still
     * answer 200. Pin with `coverMediaId`; unpin with `AUTO`.
     */
    coverImageMode: Joi.string()
      .valid(SHOWCASE_COVER_IMAGE_MODE.AUTO)
      .optional()
      .messages({
        "any.only":
          "coverImageMode can only be AUTO, which unpins the cover. To pin one, send coverMediaId.",
      }),
  })
    .min(1)
    .oxor("coverMediaId", "coverImageMode")
    .messages({
      "object.min": "Please provide at least one field to update.",
      "object.oxor":
        "Send coverMediaId to pin a cover, or coverImageMode: AUTO to unpin — not both.",
    }),
};

// Customer — the full gallery. Pagination is optional: without it the service
// returns the brand's sections up to a bounded default, which covers every
// plan's section cap.
exports.validateGetBrandShowcase = {
  params: { brandId: objectId().required() },
  query: {
    page: Joi.number().integer().min(1).default(1).messages({
      "number.min": "Page must be at least 1.",
    }),
    limit: Joi.number().integer().min(1).max(50).optional().messages({
      "number.min": "Limit must be at least 1.",
      "number.max": "Limit cannot exceed 50.",
    }),
  },
};

exports.validateGetVideoClips = {
  params: { brandId: objectId().required() },
  query: {
    page: Joi.number().integer().min(1).default(1).messages({
      "number.min": "Page must be at least 1.",
    }),
    limit: Joi.number().integer().min(1).max(50).default(10).messages({
      "number.min": "Limit must be at least 1.",
      "number.max": "Limit cannot exceed 50.",
    }),
  },
};

exports.validateDeleteSection = {
  params: {
    sectionId: objectId().required(),
  },
};

// The complete order, every time — the service renumbers 1..n, so a partial
// list would collide with the sections left out of it.
exports.validateReorderSections = {
  params: { brandId: objectId().required() },
  body: {
    sections: Joi.array()
      .min(1)
      .required()
      .items(
        Joi.object({
          id: objectId().required(),
          sortOrder: Joi.number().integer().min(1).required().messages({
            "number.min": "Sort order must be at least 1.",
            "any.required": "Sort order is required for every section.",
          }),
        }),
      )
      .messages({
        "array.min": "Please send at least one section.",
        "any.required": "Section order list is required.",
      }),
  },
};

// Media
exports.validateAddMedia = {
  params: {
    sectionId: objectId().required(),
  },
  body: Joi.object({
    // Applies to the videos in the batch. Photos are always stored with the
    // flag off — see `prepareMediaDocuments`.
    isShowInVideoClips: Joi.boolean().default(true).messages({
      "boolean.base": "isShowInVideoClips must be true or false.",
    }),
  }),
};

exports.validateUpdateMedia = {
  params: {
    sectionId: objectId().required(),
    mediaId: objectId().required(),
  },
  // `sortOrder` is deliberately absent. Positions are owned by the reorder
  // endpoint, which renumbers the whole section and needs them unique; setting
  // one here let two media share a position and made the order arbitrary.
  body: Joi.object({
    title: Joi.string().trim().allow("").max(100).optional().messages({
      "string.max": "Media title cannot exceed 100 characters.",
    }),
    altText: Joi.string().trim().allow("").max(150).optional().messages({
      "string.max": "Alt text cannot exceed 150 characters.",
    }),
    // Rejected by the service on a photo — it is a video-only switch.
    isShowInVideoClips: Joi.boolean().optional().messages({
      "boolean.base": "isShowInVideoClips must be true or false.",
    }),
    isActive: Joi.boolean().optional().messages({
      "boolean.base": "isActive must be true or false.",
    }),
    // No `.min(1)` here: a thumbnail-only update arrives as a file with an
    // empty body, and that is a legitimate request.
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

// Same rule as the section reorder: the complete list of live media.
exports.validateReorderMedias = {
  params: { sectionId: objectId().required() },
  body: {
    medias: Joi.array()
      .items(
        Joi.object({
          id: objectId().required(),
          sortOrder: Joi.number().integer().min(1).required().messages({
            "number.min": "Sort order must be at least 1.",
            "any.required": "Sort order is required for every media.",
          }),
        }),
      )
      .min(1)
      .required()
      .messages({
        "array.min": "Please send at least one media.",
        "any.required": "Media order list is required.",
      }),
  },
};
