const crypto = require("crypto");
const { ROLES } = require("../../constants");

exports.generateRazorpaySignature = (orderId, paymentId, serviceType) => {
  const secret =
    serviceType === ROLES.CUSTOMER
      ? process.env.RAZORPAY_CUSTOMER_SECRET
      : process.env.RAZORPAY_VENDOR_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};
