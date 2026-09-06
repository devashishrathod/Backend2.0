const { asyncWrapper, sendSuccess } = require("../../utils");
const { globalSearch } = require("../../services/search");

exports.globalSearch = asyncWrapper(async (req, res) => {
  // `optionalAuth` leaves `req.userId` undefined for a guest, which is a valid
  // caller here — the service treats identity as context, not a requirement.
  const result = await globalSearch(req.userId, req.query);
  return sendSuccess(res, 200, "Search results fetched", result);
});
