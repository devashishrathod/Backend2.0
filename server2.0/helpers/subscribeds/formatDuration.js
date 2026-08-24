const { SUBSCRIPTION_TYPES } = require("../../constants");

const TYPE_LABELS = Object.freeze({
  [SUBSCRIPTION_TYPES.WEEKLY]: "Weekly",
  [SUBSCRIPTION_TYPES.MONTHLY]: "Monthly",
  [SUBSCRIPTION_TYPES.QUATERLY]: "Quarterly",
  [SUBSCRIPTION_TYPES.HALF_YEARLY]: "Half Yearly",
  [SUBSCRIPTION_TYPES.YEARLY]: "Yearly",
});

const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"}`;

// "YEARLY" -> "Yearly", for the "₹ 4,999.00 / Yearly" line on the plan card.
exports.formatSubscriptionType = (type) =>
  TYPE_LABELS[type] ||
  String(type || "")
    .toLowerCase()
    .replace(/(^|[\s_])([a-z])/g, (_, sep, char) => `${sep ? " " : ""}${char.toUpperCase()}`);

/**
 * Human-readable plan validity for the "Plan Duration" row — 365 -> "1 year",
 * 30 -> "1 month", 90 -> "3 months".
 *
 * Derived from the day count rather than the type so a plan with a custom
 * durationInDays still reads correctly.
 */
exports.formatDuration = (durationInDays, durationInYears) => {
  const years = Number(durationInYears) || 0;
  const days = Number(durationInDays) || 0;

  if (years > 0 && !days) return plural(years, "year");
  if (!days) return null;

  if (days % 365 === 0) return plural(days / 365, "year");
  // Approximate months on 30-day boundaries, which is how DURATION_MAP counts.
  if (days % 30 === 0) return plural(days / 30, "month");
  if (days % 7 === 0) return plural(days / 7, "week");
  return plural(days, "day");
};

/**
 * Whole days left before `endDate`, floored at 0. Used for the "current plan"
 * block on the checkout preview.
 */
exports.daysRemaining = (endDate) => {
  if (!endDate) return 0;
  const diffMs = new Date(endDate).getTime() - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};
