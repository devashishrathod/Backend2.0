const User = require("../../models/User");
const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { getRazorpayInstance } = require("../../configs/razorpay");
const { generateUniqueInvoiceId } = require("../../helpers/transactions");

exports.createSubscribeOrder = async (tokenUserId, payload) => {
  const checkUser = await User.findById(tokenUserId);
  if (!checkUser || checkUser.isDeleted) throwError(404, "User not found!");

  const isAdmin = checkUser?.role === ROLES.ADMIN;
  let { amount, brandId, subscriptionId, currency, email, whatsappNumber } =
    payload;

  const checkBrand = await Brand.findById(brandId);
  if (!checkBrand || checkBrand.isDeleted) throwError(404, "Brand not found!");

  const checkSubscription = await Subscription.findById(subscriptionId);
  if (!checkSubscription || checkSubscription.isDeleted) {
    throwError(404, "Subscription plan not found!");
  } else if (!checkSubscription.isActive) {
    throwError(404, "Subscription plan is inactive!");
  }

  amount = amount || checkSubscription?.price;
  const receipt = `rcpt_${tokenUserId.toString().slice(-6)}_${Date.now()
    .toString()
    .slice(-6)}`;

  const options = {
    amount: amount * 100,
    currency: currency ? currency : "INR",
    receipt: receipt,
  };
  const razorpay = getRazorpayInstance(ROLES.VENDOR);
  const razorpayOrder = await razorpay.orders.create(options);
  if (!razorpayOrder) {
    throwError(503, "Razorpay services unavailable! Please try again later");
  }
  const transactionData = {
    brandId,
    subscriptionId,
    email,
    userId: checkBrand?.userId,
    createdBy: tokenUserId,
    contact: checkBrand?.whatsappNumber
      ? checkBrand?.whatsappNumber
      : whatsappNumber,
    entity: razorpayOrder?.entity,
    amount: razorpayOrder?.amount ? razorpayOrder?.amount / 100 : amount,
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
  return await Transaction.create(transactionData);
};
