const mongoose = require("mongoose");
const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const SubBrand = require("../../models/SubBrand");
const { throwError } = require("../../utils");
const { calculateVoucherOffer } = require("../../helpers/voucherOffers");
const { getCustomerConfig } = require("../../helpers/settings");

exports.previewCustomerVoucher = async (userId, payload) => {
  const { voucherId, outletId, billAmount } = payload;

  /**
   * ---------------------------------------
   * 1. Validate IDs
   * ---------------------------------------
   */

  if (!mongoose.Types.ObjectId.isValid(voucherId)) {
    throwError(400, "Invalid voucher ID.");
  }

  if (!mongoose.Types.ObjectId.isValid(outletId)) {
    throwError(400, "Invalid outlet ID.");
  }

  /**
   * ---------------------------------------
   * 2. Voucher
   * ---------------------------------------
   */

  const voucher = await Voucher.findOne({
    _id: voucherId,

    isActive: true,

    isDeleted: false,
  }).select("_id name categoryId subCategoryId");

  if (!voucher) {
    throwError(404, "Voucher not found.");
  }

  /**
   * ---------------------------------------
   * 3. Current published version
   * ---------------------------------------
   */

  const now = new Date();

  const version = await VoucherVersion.findOne({
    voucherId: voucher._id,

    status: "PUBLISHED",

    isActive: true,

    isDeleted: false,

    startAt: {
      $lte: now,
    },

    endAt: {
      $gt: now,
    },
  }).sort({
    versionNumber: -1,
  });

  if (!version) {
    throwError(400, "Voucher is not currently available.");
  }

  /**
   * ---------------------------------------
   * 4. Outlet must be linked
   * ---------------------------------------
   */

  const mapping = await VoucherSubBrand.findOne({
    voucherVersionId: version._id,

    subBrandId: outletId,

    isActive: true,

    isDeleted: false,
  });

  if (!mapping) {
    throwError(400, "Selected outlet is not linked with this voucher.");
  }

  /**
   * ---------------------------------------
   * 5. Outlet must be active
   * ---------------------------------------
   */

  const outlet = await SubBrand.findOne({
    _id: outletId,

    isActive: true,

    isDeleted: false,
  }).select("_id uniqueId storeId geo");

  if (!outlet) {
    throwError(400, "Selected outlet is currently unavailable.");
  }

  /**
   * ---------------------------------------
   * 6. Calculate offer
   * ---------------------------------------
   */

  const { convenienceFee } = await getCustomerConfig();

  const calculation = calculateVoucherOffer({
    offers: version.offers || [],

    billAmount,

    convenienceFeeConfig: convenienceFee,
  });

  /**
   * ---------------------------------------
   * 7. Response
   * ---------------------------------------
   */

  return {
    voucher: {
      id: voucher._id,

      name: voucher.name,

      categoryId: voucher.categoryId,

      subCategoryId: voucher.subCategoryId,
    },

    version: {
      id: version._id,

      versionNumber: version.versionNumber,
    },

    outlet: {
      id: outlet._id,

      uniqueId: outlet.uniqueId,

      storeId: outlet.storeId,
    },

    billAmount: calculation.billAmount,

    // false when the bill is below every offer's minimum, or the voucher has no
    // offers at all. Not an error — the customer just pays the bill.
    offerApplied: calculation.offerApplied,

    selectedOffer: calculation.selectedOffer,

    eligibleOffers: calculation.eligibleOffers,

    // The rows a checkout screen renders, already totalled.
    pricing: calculation.pricing,
  };
};
