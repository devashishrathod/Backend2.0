const { istDateKey } = require("../dates");

/** Razorpay caps a list page at 100 whatever you ask for. */
const PAGE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which payments a gateway settlement actually carried.
 *
 * ### ⚠️ Why this is not `payments.all({ settlement_id })`
 *
 * Because that call **silently ignores the filter**. Measured against a live
 * account: `payments.all({ settlement_id: "setl_RYPy…" })` and `payments.all()`
 * both return the same 42 payments — the whole account, not the batch. No error,
 * no warning, just a list that looks exactly like the answer to the question
 * that was asked.
 *
 * `handleGatewaySettlement` used it, so a single `settlement.processed` would
 * have stamped `fundsReceivedAt` on **every** captured claim payment, including
 * ones the gateway was still holding. `buildEligibilityFilter` would then have
 * let all of them into a payout run, and vendors would have been paid out of
 * money that had not arrived — precisely the failure `fundsReceivedAt` exists to
 * prevent, arriving through the field meant to prevent it.
 *
 * It had not fired yet only by luck: the one delivery ever received landed on
 * the subscription account, and `recordFundsReceived` filters to
 * `VOUCHER_CLAIM`, so all 43 payments it wrongly returned were the wrong purpose
 * and none matched.
 *
 * ### The settlement recon report is the real answer
 *
 * `settlements.reports({ year, month, day })` returns one row per item in that
 * day's settlements, each carrying `entity_id` (the payment), `settlement_id`
 * and `settled`. Filtering it by settlement id gives the batch and nothing else.
 *
 * ### The report is keyed on the IST settlement day
 *
 * Verified against a live batch: `settled_at` 1788767017 sits in the report for
 * `2026-09-07`, which is its **IST** date. A UTC date would be right for most of
 * the day and silently wrong for anything settled after 18:30 UTC, so the day is
 * taken from `istDateKey` — the same function the settlement period uses.
 *
 * The neighbouring days are tried only if the expected one yields nothing, which
 * costs an extra call exactly when the first answer was empty and never
 * otherwise.
 *
 * @param {object} args
 * @param {object} args.instance      a Razorpay SDK client for the right account
 * @param {string} args.settlementId  `setl_…`
 * @param {Date}   args.settledAt     when the gateway settled it
 * @returns {Promise<string[]>} the payment ids in that settlement
 */
exports.fetchSettledPaymentIds = async ({ instance, settlementId, settledAt }) => {
  if (!instance || !settlementId) return [];

  const at = settledAt ? new Date(settledAt) : new Date();

  /**
   * The expected day first, then its neighbours.
   *
   * A settlement created within minutes of the IST midnight boundary can be
   * reported under either date, and an empty first answer is indistinguishable
   * from a batch that genuinely carried nothing — so the fallback runs only when
   * there is nothing to lose by running it.
   */
  const candidates = [at, new Date(at.getTime() - DAY_MS), new Date(at.getTime() + DAY_MS)];

  let anyDayUnavailable = false;

  for (const day of candidates) {
    const { rows, ok } = await fetchReport({ instance, day });
    if (!ok) anyDayUnavailable = true;

    const ids = rows
      .filter(
        (row) =>
          row?.type === "payment" &&
          row?.settled &&
          String(row?.settlement_id || "") === String(settlementId) &&
          row?.entity_id,
      )
      .map((row) => row.entity_id);

    if (ids.length) {
      // De-duplicated: a payment can appear more than once in a report when it
      // carries an adjustment alongside it.
      return [...new Set(ids)];
    }
  }

  /**
   * ⚠️ "Nothing found" and "could not look" must not return the same thing.
   *
   * A settlement can legitimately carry no payments of ours, and that is an
   * empty answer the caller should record and move on from. A gateway that would
   * not answer is a **failure**, and the caller's job is to mark the delivery
   * `FAILED` so it stays on the webhook worklist and can be replayed. Collapsing
   * the two would turn an outage into a settlement silently recorded as carrying
   * nothing — and nothing would ever come back for it, which is the precise
   * shape of bug this whole file exists to undo.
   */
  if (anyDayUnavailable) {
    throw new Error(
      `Settlement recon report unavailable for ${settlementId} around ${istDateKey(at)}`,
    );
  }

  return [];
};

/**
 * One IST day of settlement recon rows, paged to the end.
 *
 * ⚠️ Reports `ok` rather than throwing, because the neighbouring days are a
 * best-effort fallback and one of them erroring is not a reason to abandon the
 * day that matters. The caller decides: it only escalates when it found nothing
 * **and** a day would not answer.
 *
 * @returns {Promise<{ rows: object[], ok: boolean }>}
 */
const fetchReport = async ({ instance, day }) => {
  const [year, month, date] = istDateKey(day).split("-").map(Number);

  const rows = [];
  let skip = 0;

  try {
    for (;;) {
      const page = await instance.settlements.reports({
        year,
        month,
        day: date,
        count: PAGE,
        skip,
      });
      const items = page?.items || [];
      rows.push(...items);
      if (items.length < PAGE) break;
      skip += items.length;
    }
  } catch (error) {
    console.warn(
      `[fetchSettledPaymentIds] report for ${year}-${month}-${date} unavailable: ` +
        `${error?.error?.description || error?.message || "unknown error"}`,
    );
    return { rows, ok: false };
  }

  return { rows, ok: true };
};
