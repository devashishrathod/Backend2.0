exports.buildAggregateLookup = ({
  from,
  localField,
  foreignField = "_id",
  as,
  unwind = true,
  preserveNullAndEmptyArrays = true,
  project = null,
}) => {
  const pipeline = [
    {
      $match: {
        $expr: {
          $eq: [`$${foreignField}`, "$$id"],
        },
      },
    },
  ];

  if (project) {
    pipeline.push({
      $project: project,
    });
  }

  return [
    {
      $lookup: {
        from,
        let: {
          id: `$${localField}`,
        },
        pipeline,
        as,
      },
    },

    ...(unwind
      ? [
          {
            $unwind: {
              path: `$${as}`,
              preserveNullAndEmptyArrays,
            },
          },
        ]
      : []),
  ];
};
