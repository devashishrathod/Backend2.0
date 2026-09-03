const { throwError } = require("./CustomError");

exports.pagination = async (
  model,
  pipeline,
  page = 1,
  limit = 10,
  entityName,
  /**
   * Return an empty page instead of throwing 404.
   *
   * Defaults to the historical behaviour so nothing that already calls this
   * changes. Pass `true` for a listing where **empty is a normal state** rather
   * than a missing resource — a customer's own payment history is empty until
   * they buy something, and answering 404 there makes a first-run app show an
   * error screen for a perfectly correct answer.
   *
   * The rule of thumb: 404 when the caller named something that does not exist;
   * an empty page when they asked a question whose honest answer is "none".
   */
  options,
) => {
  const { allowEmpty = false } = options || {};
  page = parseInt(page, 10);
  limit = parseInt(limit, 10);
  const skip = (page - 1) * limit;
  const facetPipeline = [
    ...pipeline,
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    },
    {
      $project: {
        data: 1,
        totalCount: { $arrayElemAt: ["$totalCount.count", 0] },
      },
    },
  ];
  const result = await model.aggregate(facetPipeline);
  const { data, totalCount = 0 } = result[0] || {};
  if ((!data || data.length === 0) && !allowEmpty) {
    const modelName =
      entityName ||
      (model.modelName ? model.modelName.toLowerCase() : "record");
    throwError(404, `No any ${modelName} found`);
  }
  return {
    total: totalCount,
    totalPages: Math.ceil(totalCount / limit),
    page,
    limit,
    data: data || [],
  };
};
