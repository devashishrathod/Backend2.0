const {
  istDayStart,
  istDayEnd,
  istDaysAgo,
  istDateKey,
  settlementPeriodStart,
  settlementPeriodEnd,
  IST_OFFSET_MINUTES,
} = require("./istDate");

module.exports = {
  istDayStart,
  istDayEnd,
  istDaysAgo,
  istDateKey,
  /**
   * ⚠️ The canonical cycle boundary. A settlement's idempotency key is built
   * from `periodEnd`, and it only protects anything if that value is identical
   * on every run — which it is not when derived from `new Date()`.
   */
  settlementPeriodStart,
  settlementPeriodEnd,
  IST_OFFSET_MINUTES,
};
