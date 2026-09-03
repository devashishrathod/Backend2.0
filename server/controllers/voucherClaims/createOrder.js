const { asyncWrapper, sendSuccess } = require("../../utils");
const { createVoucherClaimOrder } = require("../../services/voucherClaims");

exports.createOrder = asyncWrapper(async (req, res) => {
  const result = await createVoucherClaimOrder(
    // The whole request: the service needs `req.customerId`, which is a
    // populated document and is normalised inside rather than picked apart here.
    req,
    req.validatedData,
    // Read from the header rather than the body on purpose. It is a property of
    // the HTTP request — a retry of the same request, not a different field the
    // caller chose to send — and putting it in the body invites a client to
    // regenerate it on retry, which defeats the whole mechanism.
    req.get("Idempotency-Key") || undefined,
  );

  return sendSuccess(
    res,
    result.reused ? 200 : 201,
    result.reused
      ? "Existing claim order returned."
      : "Claim order created successfully.",
    result,
  );
});
