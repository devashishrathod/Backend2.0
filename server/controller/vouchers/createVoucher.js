const { addVoucher } = require("../../service/voucherServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.createVoucher = asyncWrapper(async (req, res) => {
  const brandId = req.params?.brandId;
  const createdBy = req.payload?._id;
  const brandUserId = req.brand?.user?._id;
  // let {
  //   subBrandIds,
  //   title,
  //   description,
  //   type,
  //   status,
  //   value,
  //   discount,
  //   maxDiscountAmount,
  //   minOrderAmount,
  //   usageLimit,
  //   validFrom,
  //   validTill,
  //   publishedDate,
  //   time,
  // } = req.body;
  const voucher = await addVoucher(req.body, createdBy, brandId, brandUserId);
  return sendSuccess(res, 201, "Voucher created successfully", voucher);
});
