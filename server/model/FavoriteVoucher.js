const mongoose = require("mongoose");
const { userField, voucherField } = require("./validMogooseObjectId");

const favoriteVoucherSchema = new mongoose.Schema(
  {
    user: userField,
    voucher: voucherField,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

favoriteVoucherSchema.index(
  { user: 1, voucher: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model("FavoriteVoucher", favoriteVoucherSchema);
