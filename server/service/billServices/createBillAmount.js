// const razorpay = require("../../configs/rajorPay");
const { getRazorpayInstance } = require("../../configs/rajorPay");
const Bill = require("../../model/Bill");
const Voucher = require("../../model/Voucher");
const PromoCode = require("../../model/PromoCode");
const LessAmount = require("../../model/LessAmount");
const SubBrand = require("../../model/SubBrand");
const { getUserById, updateUserById } = require("../../service/userServices");
const {
  createTransaction,
  generateUniqueInvoiceId,
} = require("../../service/transactionServices");
const {
  updateTransactionByOrderAndUserId,
} = require("../../service/transactionServices");

function calculateConvenienceFee(amount) {
  return Math.ceil(amount / 500) * 5;
}

exports.createBillAmount = async (userId, payload) => {
  let err = null;
  const checkUser = await getUserById(userId);
  if (!checkUser) {
    err = new Error("User not found!");
    err.statusCode = 404;
    throw err;
  }
  const { email, whatsappNumber } = checkUser;
  const { billAmount, voucherId, subBrandId, offer, currency } = payload;
  const voucher = await Voucher.findOne({
    _id: voucherId,
    isDeleted: false,
    isActive: true,
  });
  if (!voucher) {
    err = new Error("Invalid or inactive voucher");
    err.statusCode = 409;
    throw err;
  }
  if (billAmount < (voucher.minOrderAmount || 0)) {
    err = new Error(
      `Bill amount must be at least ${voucher.minOrderAmount} for this voucher`
    );
    err.statusCode = 409;
    throw err;
  }
  const subBrand = await SubBrand.findOne({
    _id: subBrandId,
    isDeleted: false,
    isActive: true,
  });
  if (!subBrand) {
    err = new Error("Invalid or inactive subBrand/outlet");
    err.statusCode = 409;
    throw err;
  }
  const voucherDiscountValue = (billAmount * voucher?.discount) / 100;
  let appliedOffers = [];
  let offerDiscount = 0;
  if (offer?.offerType && offer?.offerId) {
    let offerDoc = null;
    if (offer.offerType === "PromoCode") {
      offerDoc = await PromoCode.findById(offer.offerId);
    } else if (offer.offerType === "LessAmount") {
      offerDoc = await LessAmount.findById(offer.offerId);
    }
    if (!offerDoc) {
      err = new Error("Invalid offer selected");
      err.statusCode = 409;
      throw err;
    }
    offerDiscount = offerDoc.maxDiscountValue || 0;
    appliedOffers.push({
      offerType: offer.offerType,
      offerId: offer.offerId,
      discountValue: offerDiscount,
    });
  }
  const convenienceFee = calculateConvenienceFee(billAmount);
  const totalDiscountValue = voucherDiscountValue + offerDiscount;
  const finalPayable = Math.max(
    0,
    billAmount - totalDiscountValue + convenienceFee
  );
  const receipt = `rcpt_${userId.toString().slice(-6)}_${Date.now()
    .toString()
    .slice(-6)}`;

  const options = {
    amount: finalPayable * 100,
    currency: currency ? currency : "INR",
    receipt: receipt,
  };
  const razorpay = getRazorpayInstance("CUSTOMER");
  const razorpayOrder = await razorpay.orders.create(options);
  if (!razorpayOrder) {
    err = new Error("Razorpay services unavailable! Please try again later");
    err.statusCode = 503;
    throw err;
  }
  const transactionData = {
    user: userId,
    createdBy: userId,
    brand: subBrand?.brand,
    subBrand: subBrandId,
    voucher: voucherId,
    email: email ? email : undefined,
    contact: whatsappNumber,
    entity: razorpayOrder?.entity,
    amount: razorpayOrder?.amount ? razorpayOrder?.amount / 100 : finalPayable,
    currency: razorpayOrder?.currency ? razorpayOrder?.currency : "INR",
    status: razorpayOrder?.status,
    razorpayOrderId: razorpayOrder?.id,
    receipt: razorpayOrder?.receipt,
    dueAmount: (razorpayOrder?.amount_due ?? 0) / 100,
    paidAmount: (razorpayOrder?.amount_paid ?? 0) / 100,
    attempts: razorpayOrder?.attempts,
    notes: razorpayOrder?.notes,
    offer_id: razorpayOrder?.offer_id,
    invoiceId: await generateUniqueInvoiceId(),
    createdAtRaw: razorpayOrder?.created_at,
  };
  const transaction = await createTransaction(transactionData);
  if (!transaction) {
    err = new Error("Failed to create transaction order");
    err.statusCode = 500;
    throw err;
  }
  await updateUserById(userId, { transaction: transaction?._id });
  const newBill = await Bill.create({
    userId,
    voucherId,
    brandId: subBrand?.brand,
    subBrandId,
    transactionId: transaction?._id,
    voucherDiscountValue,
    billAmount,
    appliedOffers,
    convenienceFee,
    totalDiscountValue,
    finalPayable,
  });
  const billTransaction = await updateTransactionByOrderAndUserId(
    { _id: transaction?._id },
    { bill: newBill?._id }
  );
  return { newBill, billTransaction };
};
