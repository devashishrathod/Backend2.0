/**
 * India-time day boundaries, as UTC instants.
 *
 * ### Why this exists rather than `new Date()` arithmetic
 *
 * A settlement cycle is *"everything that happened on the 3rd"*, and that has to
 * mean the same thing however many times it is asked. Two things make naive date
 * maths unsafe here:
 *
 * 1. **`jobs/index.js` runs every job once at boot**, before the interval starts,
 *    and the runner is per-process. A restart, or a second instance, means
 *    `buildSettlements` runs again — and the `idempotencyKey`
 *    `STL:<brandId>:<periodEnd>` only protects anything if `periodEnd` is
 *    **exactly** the same value both times. Derived from `new Date()` it is not:
 *    02:00:01 and 02:00:02 produce different keys and therefore two settlements
 *    for one day.
 * 2. **The server is not necessarily in IST.** A UTC box computing "yesterday"
 *    puts the boundary at 05:30 IST, so five and a half hours of one Indian day
 *    land in the wrong cycle — every day, quietly, and only visible when a vendor
 *    adds up their own takings and gets a different number.
 *
 * So the day is pinned to IST and truncated to a fixed instant. Ten calls in the
 * same second, or the same minute, or from two machines, produce one value.
 *
 * No dependency: `Intl` gives the IST calendar date, and the offset is fixed
 * (+05:30, no daylight saving), so the arithmetic is exact.
 */

/** IST is UTC+05:30 all year. India has no daylight saving. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The calendar date in India for a given instant, as `{ year, month, day }`.
 *
 * Computed by shifting the instant, not by formatting — a formatter would hand
 * back a string that then has to be parsed back, and the parse is where a
 * timezone sneaks in again.
 */
const istParts = (at = new Date()) => {
  const shifted = new Date(new Date(at).getTime() + IST_OFFSET_MINUTES * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};

/**
 * Midnight at the **start** of that IST day, as a UTC instant.
 *
 * 2026-09-01 in India starts at 2026-08-31T18:30:00Z.
 */
exports.istDayStart = (at = new Date()) => {
  const { year, month, day } = istParts(at);
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MINUTES * MINUTE_MS);
};

/**
 * The **last** instant of that IST day, as a UTC instant.
 *
 * `23:59:59.999` rather than the next day's midnight, so a range built with
 * `$lte` cannot pick up the first millisecond of the following day — the same
 * inclusive-end rule every listing here follows.
 */
exports.istDayEnd = (at = new Date()) =>
  new Date(exports.istDayStart(at).getTime() + DAY_MS - 1);

/**
 * `n` days before the IST day containing `at`.
 *
 * Day arithmetic on the **IST** day, not on the instant: subtracting 24 hours
 * from an instant near a boundary can land on the wrong Indian date.
 */
exports.istDaysAgo = (n, at = new Date()) => {
  const { year, month, day } = istParts(at);
  return new Date(
    Date.UTC(year, month, day - Number(n || 0)) - IST_OFFSET_MINUTES * MINUTE_MS,
  );
};

/**
 * The canonical `periodEnd` for a settlement run — `T − delayDays`, end of day.
 *
 * **This is the value the idempotency key is built from.** One day has exactly
 * one of these, whatever time the job happens to run, and however many times.
 *
 * @param {number} delayDays  `settlement.delayDays` (T+3 by default)
 * @param {Date}   [at]       the moment the job is running; defaults to now
 */
exports.settlementPeriodEnd = (delayDays, at = new Date()) =>
  exports.istDayEnd(exports.istDaysAgo(delayDays, at));

/** The start of that same day, so a cycle is one whole IST day. */
exports.settlementPeriodStart = (delayDays, at = new Date()) =>
  exports.istDayStart(exports.istDaysAgo(delayDays, at));

/** `YYYY-MM-DD` in India — for statement titles and settlement numbers. */
exports.istDateKey = (at = new Date()) => {
  const { year, month, day } = istParts(at);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

exports.IST_OFFSET_MINUTES = IST_OFFSET_MINUTES;
