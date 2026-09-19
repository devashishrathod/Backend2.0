const mongoose = require("mongoose");
const { mediaSchema } = require("./mediaSchema");
const { MEDIA_KIND } = require("../constants/storage");

const promotionalTickerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    /**
     * The little image beside the strip's text.
     *
     * 🔴 This used to be an inline `{ url, storage }` pair with the provider
     * enum written out by hand — `default: "CLOUDINARY"` as a bare string, one
     * of **five** such copies that made `STORAGE_PROVIDER` look like a single
     * source without being one. Renaming `S3` to `AWS_S3` would have left this
     * document validating against a value nothing else used.
     *
     * ⚠️ Still images only. A ticker icon sits inline in a scrolling strip;
     * there is no player there and nothing that would paint a poster frame, so
     * a video or an animated GIF has nowhere to render. Enforced here as well as
     * in `uploadTickerIcon`, because the seeders write this field directly.
     */
    icon: {
      type: mediaSchema,
      required: [true, "A ticker needs an icon."],
      validate: {
        validator: (value) => !value?.kind || value.kind === MEDIA_KIND.IMAGE,
        message: ({ value }) =>
          `A ticker icon has to be a still image, not a ${value?.kind}.`,
      },
    },
    redirect: {
      type: {
        type: String,
        enum: ["NONE", "CATEGORY", "DEAL", "BRAND", "OFFER", "EXTERNAL_URL"],
        default: "NONE",
      },
      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      url: {
        type: String,
        trim: true,
        default: null,
      },
    },
    displayOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

promotionalTickerSchema.index({
  isDeleted: 1,
  isActive: 1,
  displayOrder: 1,
});

module.exports = mongoose.model("PromotionalTicker", promotionalTickerSchema);
