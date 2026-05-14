const Razorpay = require("razorpay");
const { throwError } = require("../utils");

// const instance = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_SECRET,
// });

// module.exports = instance;

const razorpayInstances = {
  VENDOR: new Razorpay({
    key_id: process.env.RAZORPAY_VENDOR_KEY_ID,
    key_secret: process.env.RAZORPAY_VENDOR_SECRET,
  }),
  CUSTOMER: new Razorpay({
    key_id: process.env.RAZORPAY_CUSTOMER_KEY_ID,
    key_secret: process.env.RAZORPAY_CUSTOMER_SECRET,
  }),
};

exports.getRazorpayInstance = (serviceType) => {
  const instance = razorpayInstances[serviceType];
  if (!instance) {
    throwError(400, `Invalid Razorpay service type: ${serviceType}`);
  }
  return instance;
};
