const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");

exports.assertNoActiveOverlap = async ({
  isActive,
  startDate,
  endDate,
  excludeId,
} = {}) => {
  if (isActive === false) return;

  const baseMatch = { isActive: true, isDeleted: false };
  if (excludeId) baseMatch._id = { $ne: excludeId };

  if (!startDate && !endDate) {
    const existing = await Banner.findOne({
      ...baseMatch,
      startDate: null,
      endDate: null,
    });
    if (existing) {
      throwError(409, "An active banner without a date range already exists.");
    }
    return;
  }

  const newStart = startDate ? new Date(startDate) : new Date("1970-01-01");
  const newEnd = endDate ? new Date(endDate) : new Date("2999-12-31");

  const existing = await Banner.findOne({
    ...baseMatch,
    startDate: { $ne: null, $lte: newEnd },
    endDate: { $ne: null, $gte: newStart },
  });
  if (existing) {
    throwError(409, "Already active banner in this date range.");
  }
};
