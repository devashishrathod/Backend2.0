const { asyncWrapper, sendSuccess } = require("../../utils");
const { getActiveBannersForCustomer } = require("../../services/banners");

exports.getActiveForCustomer = asyncWrapper(async (req, res) => {
  const result = await getActiveBannersForCustomer();
  // Empty stays `null` rather than `[]`, which is what this endpoint has always
  // answered when nothing is scheduled — an app already null-checking `data`
  // keeps working, and a list endpoint here would otherwise be the one place a
  // 404 is wrong (no banners is a normal home screen, not a missing resource).
  return sendSuccess(
    res,
    200,
    result.length
      ? "Active banners fetched successfully."
      : "No active banner found.",
    result.length ? result : null,
  );
});
