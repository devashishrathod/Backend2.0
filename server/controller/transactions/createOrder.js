// const razorpay = require("../../configs/rajorPay");
const { getRazorpayInstance } = require("../../configs/rajorPay");
const { sendSuccess, sendError, asyncWrapper } = require("../../utils");
const {
  createTransaction,
  generateUniqueInvoiceId,
} = require("../../service/transactionServices");
const { getUserById, updateUserById } = require("../../service/userServices");
const {
  getBrandById,
  updateBrandById,
} = require("../../service/brandServices");
const {
  getActiveSubscriptionPlanById,
} = require("../../service/subscriptionServices");
const { ROLES } = require("../../constants");

exports.createOrder = asyncWrapper(async (req, res) => {
  const createdUserId = req.payload?._id;
  const checkUser = await getUserById(createdUserId);
  if (!checkUser) return sendError(res, 404, "User not found!");
  const isAdmin = checkUser?.role === ROLES.ADMIN;
  let { amount, brandId, subscriptionId, currency, email, whatsappNumber } =
    req.body;

  const checkBrand = await getBrandById(brandId);
  if (!checkBrand) return sendError(res, 404, "Brand not found!");

  const checkSubscription = await getActiveSubscriptionPlanById(subscriptionId);
  if (!checkSubscription)
    return sendError(res, 404, "Subscription plan not found!");
  amount = amount || checkSubscription?.price;
  const receipt = `rcpt_${createdUserId.toString().slice(-6)}_${Date.now()
    .toString()
    .slice(-6)}`;

  const options = {
    amount: amount * 100,
    currency: currency ? currency : "INR",
    receipt: receipt,
  };
  const razorpay = getRazorpayInstance("VENDOR");
  const razorpayOrder = await razorpay.orders.create(options);
  if (!razorpayOrder) {
    return sendError(
      res,
      503,
      "Razorpay services unavailable! Please try again later",
    );
  }
  const transactionData = {
    brand: brandId,
    user: checkBrand?.user,
    createdBy: createdUserId,
    subscription: subscriptionId,
    email: checkBrand?.companyEmail ? checkBrand?.companyEmail : email,
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
  const transaction = await createTransaction(transactionData);
  if (!transaction) {
    return sendError(res, 500, "Failed to create transaction order");
  }
  await updateUserById(checkBrand.user, { transaction: transaction?._id });
  await updateBrandById(brandId, { transaction: transaction?._id });
  return sendSuccess(
    res,
    201,
    "Transaction order created successfully",
    transaction,
  );
});
