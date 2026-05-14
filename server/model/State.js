const mongoose = require("mongoose");

const stateSchema = new mongoose.Schema(
  {
    name: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("State", stateSchema);
