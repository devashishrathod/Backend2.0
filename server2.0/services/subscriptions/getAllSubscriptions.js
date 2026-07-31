const Subscription = require("../../models/Subscription");
const { pagination } = require("../../utils");

exports.getAllSubscriptions = async (query) => {
  let {
    page,
    limit,
    search,
    type,
    isActive,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;
  const match = { isDeleted: false };
  if (type) match.type = type;
  if (typeof isActive !== "undefined") {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (search) {
    match.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
    ];
  }

  const pipeline = [{ $match: match }];
  pipeline.push({
    $project: {
      name: 1,
      description: 1,
      price: 1,
      type: 1,
      durationInDays: 1,
      benefits: 1,
      limitations: 1,
      features: 1,
      isActive: 1,
      createdAt: 1,
    },
  });

  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;
  pipeline.push({ $sort: sortStage });

  return await pagination(Subscription, pipeline, page, limit);
};
