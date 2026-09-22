const { asyncWrapper, sendSuccess } = require("../../utils");
const { globalSearch } = require("../../services/search");

exports.globalSearch = asyncWrapper(async (req, res) => {
  // `optionalAuth` leaves `req.userId` undefined for a guest, which is a valid
  // caller here — the service treats identity as context, not a requirement.
  //
  // `req.customerId` goes down as well, and the two are not interchangeable:
  // `userId` resolves the saved address, while the brand section's `isFollowed`
  // / `isAvoided` key on `Customer._id`. Passing the document rather than
  // re-querying it costs nothing — ⚠️ despite its name it is a populated
  // document, so the service normalises it with `resolveCustomerId`.
  const result = await globalSearch(req.userId, req.query, req.customerId);
  return sendSuccess(res, 200, "Search results fetched", result);
});
