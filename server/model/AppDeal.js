const mongoose = require("mongoose");

const appDealSchema = new mongoose.Schema(
  {
    image: { type: String },
    name: { type: String },
    title: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("AppDeal", appDealSchema);
