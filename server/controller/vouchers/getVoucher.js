const { sendSuccess, sendError } = require("../../utils");
const { getVoucherById } = require("../../service/voucherServices");

exports.getVoucher = async (req, res) => {
  try {
    const { voucherId } = req.params;
    const limit = parseInt(req.query?.limit) || 50;
    const page = parseInt(req.query?.page) || 1;
    const skip = (page - 1) * limit;

    const { totalSubBrands, voucher } = await getVoucherById(
      voucherId,
      limit,
      skip
    );
    if (!voucher) {
      return sendError(res, 404, "Voucher not found");
    }
    voucher.subBrands = {
      total: totalSubBrands,
      limit,
      page,
      data: voucher.subBrands,
    };
    return sendSuccess(res, 200, "Voucher fetched successfully", voucher);
  } catch (error) {
    console.error("Get Voucher Error:", error);
    return sendError(res, 500, "Something went wrong");
  }
};
