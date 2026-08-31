const axios = require("axios");
const { getRazorpayAccount } = require("../../configs/razorpay");

/**
 * Fetch a payment from Razorpay.
 *
 * The signature proves a payload is genuine; this is what proves it is
 * *captured*, for *this* order, at *this* amount. Never settle on the callback
 * body alone.
 *
 * Takes a **RAZORPAY_ACCOUNTS value**, not a role, and callers pass
 * `transaction.gatewayAccount`. A payment only exists inside the account that
 * created its order — asking the wrong account returns a 400 from Razorpay,
 * which reads as an outage rather than the routing mistake it is.
 *
 * @param {string} razorpayPaymentId
 * @param {string} account  RAZORPAY_ACCOUNTS value
 */
exports.getPaymentDetails = async (razorpayPaymentId, account) => {
  try {
    const { keyId, keySecret } = getRazorpayAccount(account);

    const authString = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
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
      `Error fetching payment details for ${razorpayPaymentId} on the ${account} account:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};
