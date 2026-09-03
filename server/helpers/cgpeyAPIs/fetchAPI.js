const cgpeyClient = require("../../configs/cgpey");
const { throwError } = require("../../utils");
const { PRIMARY_VERIFICATION_PROVIDERS } = require("../../constants");

exports.fetchAPI = async (endpoint, payload) => {
  try {
    const { data } = await cgpeyClient.post(endpoint, payload, {
      headers: {
        "x-merchant-id": process.env.CGPEY_MERCHANT_ID,
        "x-api-key": process.env.CGPEY_API_KEY,
        "x-secret-key": process.env.CGPEY_SECRET_KEY,
      },
    });
    return data;
  } catch (error) {
    const response = error.response?.data;
    const message =
      typeof response?.message === "string"
        ? response.message
        : (response?.message?.message ?? null);

    throwError(
      error.response?.status || 500,
      message || "CGPEY verification failed",
      {
        provider: PRIMARY_VERIFICATION_PROVIDERS.CGPEY,
        requestId: response?.requestId,
        clientIP: response?.error?.clientIP,
        raw: response,
      },
    );
  }
};
