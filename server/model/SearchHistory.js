const mongoose = require("mongoose");
const { userField } = require("./validMogooseObjectId");

const searchHistorySchema = new mongoose.Schema(
  {
    userId: userField,
    query: { type: String, required: true, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("SearchHistory", searchHistorySchema);
