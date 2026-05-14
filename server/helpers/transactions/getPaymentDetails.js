const axios = require("axios");

exports.getPaymentDetails = async (razorpayPaymentId, serviceType) => {
  try {
    const key_id =
      serviceType === "CUSTOMER"
        ? process.env.RAZORPAY_CUSTOMER_KEY_ID
        : process.env.RAZORPAY_VENDOR_KEY_ID;
    const key_secret =
      serviceType === "CUSTOMER"
        ? process.env.RAZORPAY_CUSTOMER_SECRET
        : process.env.RAZORPAY_VENDOR_SECRET;

    const authString = Buffer.from(`${key_id}:${key_secret}`).toString(
      "base64",
    );
    const response = await axios.get(
      `${process.env.RAZORPAY_BASEURL}${razorpayPaymentId}`,
      {
        headers: {
          Authorization: `Basic ${authString}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching payment details:",
      error.response?.data || error.message,
    );
    throw error;
  }
};
