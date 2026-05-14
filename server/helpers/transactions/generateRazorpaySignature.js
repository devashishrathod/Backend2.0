const crypto = require("crypto");

exports.generateRazorpaySignature = (orderId, paymentId, serviceType) => {
  const secret =
    serviceType === "CUSTOMER"
      ? process.env.RAZORPAY_CUSTOMER_SECRET
      : process.env.RAZORPAY_VENDOR_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};
