const mongoose = require("mongoose");
const { isValidateStoreId } = require("../validator/common");

const voucherSubBrandSchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Voucher",
      required: true,
    },
    voucherVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VoucherVersion",
      required: true,
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    subBrandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubBrand",
      required: true,
    },
    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    subBrandName: {
      type: String,
    },
    storeId: {
      type: String,
      required: true,
      validate: {
        validator: isValidateStoreId,
        message: (props) => `${props.value} is not a valid Store Id`,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

voucherSubBrandSchema.index({
  geo: "2dsphere",
});

voucherSubBrandSchema.index(
  {
    voucherVersionId: 1,
    subBrandId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  },
);

voucherSubBrandSchema.index({
  subBrandId: 1,
  isActive: 1,
  isDeleted: 1,
  voucherVersionId: 1,
});

voucherSubBrandSchema.index({
  brandId: 1,
  voucherVersionId: 1,
  isActive: 1,
  isDeleted: 1,
});

voucherSubBrandSchema.index(
  {
    subBrandId: 1,
    voucherVersionId: 1,
  },
  {
    unique: true,
  },
);

voucherSubBrandSchema.index({
  subBrandId: 1,
  isActive: 1,
  isDeleted: 1,
});

voucherSubBrandSchema.index({
  voucherVersionId: 1,
  isActive: 1,
  isDeleted: 1,
});

module.exports = mongoose.model("VoucherSubBrand", voucherSubBrandSchema);
