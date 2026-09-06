const { asIstParts } = require("../common");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");

/**
 * How a document prints a date, a time and an amount.
 *
 * ### Why none of this uses `toLocaleString`
 *
 * Both renderers used to call `toLocaleDateString("en-IN")` and
 * `toLocaleString("en-IN", { minimumFractionDigits: 2 })`, and both were wrong
 * for the same two reasons.
 *
 * **1. No timezone.** `toLocaleDateString` formats in the *process* timezone. A
 * server on UTC prints a claim paid at 01 Sep 00:30 IST as `31/8/2026` — the
 * wrong day, on a document of record, silently. Every date boundary that money
 * depends on already goes through `helpers/common/istDate.js` for exactly this
 * reason; the printed date was the one place that did not.
 *
 * **2. ICU is not stable across Node versions.** `en-IN` grouping (`2,00,000`
 * rather than `200,000`) and month spellings come from the ICU data bundled with
 * the runtime. A Node upgrade, or a `small-icu` build, changes what an *already
 * issued* invoice prints when it is re-rendered — which breaks the one promise
 * the whole snapshot design exists to make: that a document reproduces exactly.
 *
 * So the arithmetic is fixed-offset (IST is UTC+05:30 year round, no DST) and the
 * words are literals in this file. The output cannot drift.
 */

const MONTHS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

const PLACEHOLDER = "-";
const pad2 = (value) => String(value).padStart(2, "0");

/**
 * `31 Aug 2026`.
 *
 * @param {Date|string|number} value
 * @param {string} [fallback="-"] printed when there is no date
 */
const istDate = (value, fallback = PLACEHOLDER) => {
  if (!value) return fallback;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return fallback;
  const { year, month, day } = asIstParts(at);
  return `${day} ${MONTHS[month]} ${year}`;
};

/**
 * `31 Aug 2026, 11:41 PM IST`.
 *
 * The suffix is not decoration. A vendor comparing a payout against a bank
 * statement, or an accountant reconciling a claim against a settlement period,
 * has to know which clock the document is quoting — and every document in this
 * system quotes IST.
 */
const istDateTime = (value, fallback = PLACEHOLDER) => {
  if (!value) return fallback;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return fallback;
  const { year, month, day, hour, minute } = asIstParts(at);
  const meridiem = hour < 12 ? "AM" : "PM";
  // 0 -> 12 AM, 12 -> 12 PM, 13 -> 1 PM.
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${day} ${MONTHS[month]} ${year}, ${twelve}:${pad2(minute)} ${meridiem} IST`;
};

/** `31/08/2026` — for a table cell where the long form will not fit. */
const istDateShort = (value, fallback = PLACEHOLDER) => {
  if (!value) return fallback;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return fallback;
  const { year, month, day } = asIstParts(at);
  return `${pad2(day)}/${pad2(month + 1)}/${year}`;
};

/**
 * Indian digit grouping, written out rather than delegated to ICU.
 *
 * The last three digits group together and everything above them groups in twos:
 * `1234567.5` -> `12,34,567.50`. Rounded to paise first, so a floating-point
 * remainder cannot print `1,079.9999999999999`.
 */
const groupIndian = (amount) => {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  const negative = rounded < 0;
  const [whole, fraction] = Math.abs(rounded).toFixed(2).split(".");

  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;

  return `${negative ? "-" : ""}${grouped}.${fraction}`;
};

/**
 * `Rs. 12,34,567.50`.
 *
 * ⚠️ `Rs.` and not `₹`. PDFKit's built-in Helvetica is WinAnsi-encoded and has no
 * rupee glyph, so `₹` renders as a blank box on the one line a reader looks at
 * hardest. Printing it correctly would mean embedding a Unicode font in every
 * document; `Rs.` is unambiguous and costs nothing.
 */
const money = (amount) => `${CUSTOMER_CURRENCY_DEFAULTS.pdfCurrencyPrefix}${groupIndian(amount)}`;

/** A deduction, printed the way a reader expects to see one subtracted. */
const negativeMoney = (amount) => `- ${money(amount)}`;

module.exports = {
  MONTHS,
  istDate,
  istDateTime,
  istDateShort,
  money,
  negativeMoney,
  groupIndian,
};
