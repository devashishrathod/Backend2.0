const Voucher = require("../../model/Voucher");
const SubBrand = require("../../model/SubBrand");

exports.getVoucherById = async (id, limit = 50, skip = 0) => {
  const voucher = await Voucher.findOne({ _id: id, isDeleted: false })
    .populate("brand")
    .populate("user")
    .populate("createdBy")
    .populate({
      path: "subBrands",
      options: { limit, skip },
      populate: [{ path: "location" }, { path: "workHours" }],
    })
    .lean();
  const totalSubBrands = await SubBrand.countDocuments({
    _id: { $in: voucher.subBrands },
  });
  return { totalSubBrands, voucher };
};
