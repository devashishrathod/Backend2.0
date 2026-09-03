const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, default: 1000, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Counter", counterSchema);
