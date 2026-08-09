const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");

const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["PHOTO", "VIDEO"], required: true },
    url: { type: String, required: true },
    thumbnail: { type: String },
    storage: {
      provider: {
        type: String,
        enum: ["CLOUDINARY", "S3"],
        default: "CLOUDINARY",
      },
      publicId: { type: String },
      bucket: { type: String },
      key: { type: String },
    },
    metadata: {
      originalName: { type: String },
      mimeType: { type: String },
      format: { type: String },
      size: { type: Number, default: 0 },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      duration: { type: Number, default: 0 },
    },
    title: { type: String },
    altText: { type: String },
    sortOrder: { type: Number, default: 0 },
    isShowInVideoClips: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const showcaseSectionSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    description: { type: String },
    coverImage: { type: String },
    coverImageMode: {
      type: String,
      enum: ["AUTO", "MANUAL"],
      default: "AUTO",
    },
    sectionType: {
      type: String,
      enum: ["CUSTOM", "SYSTEM"],
      default: "CUSTOM",
    },
    sortOrder: { type: Number, default: 0 },
    medias: { type: [mediaSchema], default: [] },
    photosCount: { type: Number },
    videosCount: { type: Number },
    mediasCount: { type: Number },
    isVisible: { type: Boolean, default: true },
    isShowVideosInClips: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

showcaseSectionSchema.index({ brandId: 1, slug: 1 });
showcaseSectionSchema.index({ brandId: 1, sortOrder: 1 });
showcaseSectionSchema.index({ brandId: 1, isActive: 1 });

module.exports = mongoose.model("ShowcaseSection", showcaseSectionSchema);
