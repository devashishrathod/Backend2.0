const { asyncWrapper, sendSuccess } = require("../../utils");
const { getDashboardAnalytics } = require("../../service/applicationServices");

exports.getDashboardReport = asyncWrapper(async (req, res) => {
  const result = await getDashboardAnalytics(req.query);
  return sendSuccess(
    res,
    200,
    "Dashboard analytics fetched successfully",
    result
  );
});
