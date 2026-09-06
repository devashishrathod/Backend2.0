/**
 * Every date and time a notification shows a person.
 *
 * ### ⚠️ The bug this replaces
 *
 * Five notice files each had their own `asDate` / `onDate`, and they disagreed:
 * subscription mails printed `29/8/2027`, claim mails `1 Sept 2026`, and
 * settlement, refund and dispute mails `2 Sept 2026, 4:00 pm`. The same vendor
 * got two formats in two messages on the same day.
 *
 * ### ⚠️ And the worse half — none of them set a timezone
 *
 * `toLocaleString("en-IN", …)` with no `timeZone` formats in the **server's**
 * zone. Render and EC2 run UTC, so a refund deadline stored at 21:30 IST printed
 * as *"4:00 pm"* — five and a half hours early, on the one line a vendor reads to
 * decide when to respond. Nothing looked wrong: the format was right, the locale
 * was right, and on a developer machine already set to IST it was even correct.
 *
 * So the zone is **hard-coded**, not read from the environment. A deployment
 * moved to a different region must not silently change what a deadline says, and
 * this platform's dates are Indian dates.
 *
 * ### Why the month is not left to `Intl`
 *
 * CLDR renders short September as `Sep` in `en-US` and `Sept` in `en-GB` /
 * `en-IN`, and which one you get depends on the ICU build inside Node. A format
 * that shifts under a Node upgrade is not a format. The numeric parts come from
 * `Intl` — which is what correctly converts the instant into IST — and the month
 * name comes from the table below.
 *
 * ### Two modes, deliberately
 *
 * | Use | Example |
 * |---|---|
 * | `formatDateTime` — a moment that matters to the minute | `2 Sep 2026 09:30 PM` |
 * | `formatDate` — a day, where a time would be noise | `29 Aug 2027` |
 *
 * Money and deadlines take the first: a payment, a refund, a dispute response
 * window, a payout leg leaving. A plan's validity or a settlement period takes
 * the second — `Valid till 29 Aug 2027 11:59 PM` is a longer way of saying the
 * same day, and reads like a system printing a timestamp because it can.
 */

const TIME_ZONE = "Asia/Kolkata";

/** What every one of these renders when the value is missing. */
const ABSENT = "-";

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

/**
 * One formatter instance, reused. Constructing an `Intl.DateTimeFormat` is the
 * expensive part, and these run inside payment verification and the webhook
 * receiver.
 *
 * `hour12: false` so the hour comes back as 0–23 and the AM/PM is decided here —
 * ICU's own `dayPeriod` is `am`/`pm` in some builds and `AM`/`PM` in others.
 */
const IST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * The instant, broken into IST components.
 *
 * @returns {{day:number, month:number, year:number, hour:number, minute:string}|null}
 */
const istParts = (value) => {
  if (value === null || value === undefined || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);
  // An unparseable string reaches here as `Invalid Date`, and formatting one
  // throws a RangeError — which would take down the notice, not just the date.
  if (Number.isNaN(date.getTime())) return null;

  const parts = {};
  for (const part of IST_PARTS.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return {
    day: Number(parts.day),
    month: Number(parts.month),
    year: Number(parts.year),
    // ⚠️ `hour12: false` yields "24" for midnight in some ICU versions rather
    // than "00", which would print "24:00 AM".
    hour: Number(parts.hour) % 24,
    minute: parts.minute,
  };
};

/** `29 Aug 2027` — a day, in IST. */
const formatDate = (value) => {
  const parts = istParts(value);
  if (!parts) return ABSENT;

  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
};

/** `09:30 PM` — a clock time, in IST. */
const formatTime = (value) => {
  const parts = istParts(value);
  if (!parts) return ABSENT;

  const hour12 = parts.hour % 12 || 12;
  const meridiem = parts.hour < 12 ? "AM" : "PM";

  return `${String(hour12).padStart(2, "0")}:${parts.minute} ${meridiem}`;
};

/** `2 Sep 2026 09:30 PM` — the default for anything money or a deadline. */
const formatDateTime = (value) => {
  const parts = istParts(value);
  if (!parts) return ABSENT;

  return `${formatDate(value)} ${formatTime(value)}`;
};

/**
 * `1 Aug 2026 – 31 Aug 2026` — a settlement period.
 *
 * Days, not timestamps: a period runs to the end of its last day, and
 * `31 Aug 2026 11:59 PM` invites the question of what happened in that last
 * minute.
 */
const formatDateRange = (start, end) =>
  `${formatDate(start)} – ${formatDate(end)}`;

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  formatDateRange,
  TIME_ZONE,
  ABSENT,
};
