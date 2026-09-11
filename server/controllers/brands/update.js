const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBrand } = require("../../services/brands");

exports.update = asyncWrapper(async (req, res) => {
  const brandId = req.query.brandId || req.brandId;
  const result = await updateBrand(
    brandId,
    req.validatedData,
    req.files?.logo,
    /**
     * `email` and `mobile` on a brand are mirrors of the owning vendor's account
     * keys, so setting them writes that vendor's login identity. The actor comes
     * from the token — never from the body, which would be accepting a claim
     * about who is asking.
     */
    { userId: req.userId, role: req.role },
  );
  return sendSuccess(res, 200, "Brand details updated successfully", result);
});
