/**
 * IST date boundaries.
 *
 * Every date boundary that money depends on — an invoice's financial year, a
 * settlement period, a day-wise earnings report — has to be computed in **IST**,
 * not in whatever timezone the process happens to run in.
 *
 * The failure this prevents is quiet and permanent: a server on UTC would put
 * every payment taken between 00:00 and 05:30 IST into the *previous* day, and
 * a payment on 1 April before 05:30 into the *previous financial year* — with a
 * document-of-record invoice number stamped on it. Nothing errors; the numbers
 * are just wrong, and an invoice series cannot be renumbered after the fact.
 *
 * IST is UTC+05:30 year round, with no daylight saving, so a fixed offset is
 * correct rather than an approximation.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

/** Shift into IST so the UTC getters read out IST parts. */
const asIstParts = (date) => {
  const shifted = new Date(new Date(date ?? Date.now()).getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    // 0-indexed, like the Date API.
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};

/** The instant an IST calendar day begins, as a real (UTC-backed) Date. */
const istDayStart = (date) => {
  const { year, month, day } = asIstParts(date);
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
};

/** The last representable instant of an IST calendar day. */
const istDayEnd = (date) => {
  const { year, month, day } = asIstParts(date);
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
};

/** `2026-08-30` in IST — the key a day-wise report groups on. */
const istDateKey = (date) => {
  const { year, month, day } = asIstParts(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/**
 * The Indian financial year an instant falls in, as `26-27`.
 *
 * FY runs 1 April to 31 March. A payment taken on 31 March belongs to the
 * closing year and one taken on 1 April to the new one — which is exactly why
 * this must be an IST comparison: a UTC server would put 1 April 04:00 IST into
 * the wrong financial year and mint an invoice number in a closed series.
 */
const istFinancialYear = (date) => {
  const { year, month } = asIstParts(date);
  // month 3 === April.
  const startYear = month >= 3 ? year : year - 1;
  const two = (y) => String(y % 100).padStart(2, "0");
  return `${two(startYear)}-${two(startYear + 1)}`;
};

module.exports = {
  IST_OFFSET_MINUTES,
  istDayStart,
  istDayEnd,
  istDateKey,
  istFinancialYear,
};
