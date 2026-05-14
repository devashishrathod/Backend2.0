const SearchHistory = require("../../model/SearchHistory");
const { throwError } = require("../../utils");

exports.getRecentSearchQueries = async (tokenUserId, userId, page, limit) => {
  try {
    page = page ? parseInt(page) : 1;
    limit = limit ? parseInt(limit) : 10;
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    const skip = (page - 1) * limit;
    const userIdToUse = userId || tokenUserId;
    const query = { userId: userIdToUse, isDeleted: false };
    const result = await SearchHistory.find(query)
      .select("query createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    if (!result || result.length === 0) {
      throwError(404, "No search queries found");
    }
    const total = await SearchHistory.countDocuments(query);
    const totalPages = Math.ceil(total / limit);
    return { total, totalPages, page, limit, result };
  } catch (error) {
    console.error("Error fetching recent search queries:", error);
    throwError(400, error.message);
  }
};
