const Joi = require("joi");

const voucherSettingSchema = Joi.object({
  maxOffers: Joi.number().integer().min(1).max(100).optional(),
  maxImages: Joi.number().integer().min(1).optional(),
  maxDistanceKm: Joi.number().integer().min(1).optional(),
});

const showcaseSettingSchema = Joi.object({
  maxSections: Joi.number().integer().min(1).optional(),
  maxItemsPerSection: Joi.number().integer().min(1).optional(),
  maxImagesPerSection: Joi.number().integer().min(1).optional(),
  maxVideosPerSection: Joi.number().integer().min(1).optional(),
  maxImageSizeMB: Joi.number().integer().min(1).optional(),
  maxVideoSizeMB: Joi.number().integer().min(1).optional(),
  allowedImages: Joi.array().items(Joi.string().trim()).min(1).optional(),
  allowedVideos: Joi.array().items(Joi.string().trim()).min(1).optional(),
  isActive: Joi.boolean().optional(),
});

exports.validateUpdateSetting = {
  body: Joi.object({
    vendor: Joi.object({
      voucher: voucherSettingSchema.optional(),
      showcase: showcaseSettingSchema.optional(),
    }).optional(),
    isActive: Joi.boolean().optional(),
  })
    .min(1)
    .messages({
      "object.min": "Please provide at least one field to update.",
    }),
};
