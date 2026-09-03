const mongoose = require("mongoose");
const { brandField, customerField } = require("./validObjectId");

const brandAvoidanceSchema = new mongoose.Schema(
  {
    customerId: { ...customerField, required: true },
    brandId: { ...brandField, required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

brandAvoidanceSchema.index(
  { customerId: 1, brandId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  },
);
brandAvoidanceSchema.index({ customerId: 1 });
brandAvoidanceSchema.index({ brandId: 1 });

module.exports = mongoose.model("BrandAvoidance", brandAvoidanceSchema);
