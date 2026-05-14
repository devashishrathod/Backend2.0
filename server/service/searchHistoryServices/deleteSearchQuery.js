const SearchHistory = require("../../model/SearchHistory");
const { throwError } = require("../../utils");

exports.deleteSearchQuery = async (userId, queryId) => {
  try {
    const query = await SearchHistory.findOne({
      _id: queryId,
      userId: userId,
      isDeleted: false,
    });
    if (!query) throwError(404, "Search query not found");
    query.isDeleted = true;
    await query.save();
  } catch (error) {
    console.error("Error deleting search query:", error);
    throwError(400, error.message);
  }
};
