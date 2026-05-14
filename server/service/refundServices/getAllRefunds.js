const mongoose = require("mongoose");
const Refund = require("../../model/Refund");
const { pagination } = require("../../utils");

exports.getAllRefundRequests = async (query) => {
  let {
    page = 1,
    limit = 10,
    date,
    startDate,
    endDate,
    status,
    isApproved,
    brand,
    subBrand,
    voucher,
    user,
  } = query;
  page = page ? parseInt(page) : 1;
  limit = limit ? parseInt(limit) : 10;
  if (page < 1) page = 1;
  if (limit < 1) limit = 10;
  const match = { isDeleted: false };
  if (status) {
    const statusArray = status.split(",").map((s) => s.trim());
    match.status =
      statusArray.length > 1 ? { $in: statusArray } : statusArray[0];
  }
  if (typeof isApproved !== "undefined") {
    if (isApproved === "true" || isApproved === true) match.isApproved = true;
    else if (isApproved === "false" || isApproved === false)
      match.isApproved = false;
  }
  if (brand) match.brand = new mongoose.Types.ObjectId(brand);
  if (user) match.user = new mongoose.Types.ObjectId(user);
  if (subBrand) match.subBrand = new mongoose.Types.ObjectId(subBrand);
  if (voucher) match.voucher = new mongoose.Types.ObjectId(voucher);
  if (date) {
    const exactDate = new Date(date);
    const next = new Date(exactDate);
    next.setDate(next.getDate() + 1);
    match.createdAt = { $gte: exactDate, $lt: next };
  } else if (startDate && endDate) {
    match.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }
  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "brands",
        localField: "brand",
        foreignField: "_id",
        as: "brand",
      },
    },
    { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "locations",
        localField: "brand.location",
        foreignField: "_id",
        as: "location",
      },
    },
    { $unwind: { path: "$location", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "vouchers",
        localField: "voucher",
        foreignField: "_id",
        as: "voucher",
      },
    },
    { $unwind: { path: "$voucher", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "bankaccounts",
        localField: "bankAccount",
        foreignField: "_id",
        as: "bankAccount",
      },
    },
    { $unwind: { path: "$bankAccount", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "transactions",
        localField: "transaction",
        foreignField: "_id",
        as: "transaction",
      },
    },
    { $unwind: { path: "$transaction", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "bills",
        localField: "transaction.bill",
        foreignField: "_id",
        as: "bill",
      },
    },
    { $unwind: { path: "$bill", preserveNullAndEmptyArrays: true } },
    {
      $unwind: {
        path: "$bill.appliedOffers",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: "promocodes",
        let: {
          offerId: "$bill.appliedOffers.offerId",
          offerType: "$bill.appliedOffers.offerType",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$offerId"] },
                  { $eq: ["$$offerType", "PromoCode"] },
                ],
              },
            },
          },
          {
            $project: {
              promoCode: 1,
              maxDiscountValue: 1,
            },
          },
        ],
        as: "promoOffer",
      },
    },
    {
      $lookup: {
        from: "lessamounts",
        let: {
          offerId: "$bill.appliedOffers.offerId",
          offerType: "$bill.appliedOffers.offerType",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$_id", "$$offerId"] },
                  { $eq: ["$$offerType", "LessAmount"] },
                ],
              },
            },
          },
          { $project: { maxDiscountValue: 1 } },
        ],
        as: "lessAmountOffer",
      },
    },
    {
      $addFields: {
        promoCode: { $arrayElemAt: ["$promoOffer.promoCode", 0] },
        promoCodeDiscountValue: {
          $arrayElemAt: ["$promoOffer.maxDiscountValue", 0],
        },
        lessAmountDiscountValue: {
          $arrayElemAt: ["$lessAmountOffer.maxDiscountValue", 0],
        },
      },
    },
    {
      $group: {
        _id: "$_id",
        refundAmount: { $first: "$refundAmount" },
        reason: { $first: "$reason" },
        status: { $first: "$status" },
        isApproved: { $first: "$isApproved" },
        createdAt: { $first: "$createdAt" },
        user: { $first: "$user" },
        brand: { $first: "$brand" },
        location: { $first: "$location" },
        voucher: { $first: "$voucher" },
        transaction: { $first: "$transaction" },
        bill: { $first: "$bill" },
        bankAccount: { $first: "$bankAccount" },
        billPromoCode: { $first: "$promoCode" },
        billPromoCodeDiscountValue: { $first: "$promoCodeDiscountValue" },
        billLessAmountDiscountValue: { $first: "$lessAmountDiscountValue" },
      },
    },
    {
      $project: {
        _id: 1,
        refundAmount: 1,
        reason: 1,
        status: 1,
        isApproved: 1,
        createdAt: 1,
        userId: "$user._id",
        userName: "$user.name",
        userImage: "$user.image",
        brandId: "$brand._id",
        brandName: "$brand.name",
        brandLogo: "$brand.logo",
        brandShopOrBuildingNo: "$location.shopOrBuildingNo",
        brandAddress: "$location.address",
        brandStreet: "$location.street",
        brandCity: "$location.city",
        brandState: "$location.state",
        brandArea: "$location.area",
        voucherId: "$voucher._id",
        voucherUniqueId: "$voucher.uniqueId",
        voucherTitle: "$voucher.title",
        voucherDiscount: "$voucher.discount",
        transactionId: "$transaction._id",
        transactionCreatedAt: "$transaction.createdAt",
        paidAmount: "$transaction.paidAmount",
        orderId: "$transaction.razorpayOrderId",
        paymentMethod: "$transaction.paymentMethod",
        billAmount: "$bill.billAmount",
        billDiscount: "$bill.voucherDiscountValue",
        billConvenienceFee: "$bill.convenienceFee",
        bankName: "$bankAccount.bankName",
        bankBranchName: "$bankAccount.branchName",
        bankAccountNumber: "$bankAccount.accountNumber",
        bankIfscCode: "$bankAccount.ifscCode",
        billPromoCode: 1,
        billPromoCodeDiscountValue: 1,
        billLessAmountDiscountValue: 1,
      },
    },
  ];
  return await pagination(Refund, pipeline, page, limit);
};
