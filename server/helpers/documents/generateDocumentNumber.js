const Counter = require("../../models/Counter");
const { throwError } = require("../../utils");
const { istFinancialYear } = require("../common");
const {
  DOCUMENT_SERIES_PATTERN,
  DOCUMENT_SERIES_MIN,
  DOCUMENT_SERIES_MAX,
} = require("../../constants/document");

const DUPLICATE_KEY = 11000;

/**
 * Allot the next number in a document series.
 *
 *     TD/VCH/26-27/000001
 *      │   │    │      └── zero-padded sequence, monotonic within the series
 *      │   │    └───────── Indian financial year, computed in IST
 *      │   └────────────── series: VCH claim · SUB subscription · GRT grant
 *      │                           STL payout · CMN commission · REF refund
 *      │                           DBN chargeback
 *      └────────────────── issuer
 *
 * `$inc` inside a `findOneAndUpdate` is a single atomic operation, so there is no
 * read to race with — which is what a document-of-record sequence needs: monotonic
 * within a series, per financial year, with no duplicates under concurrency.
 *
 * Each series gets its own counter document, so a voucher receipt cannot consume a
 * number from the subscription series.
 *
 *     Counter._id = "INVOICE:VCH:26-27"
 *
 * The financial year is IST-derived deliberately — see `helpers/common/istDate.js`.
 * A UTC server would put a payment taken on 1 April at 04:00 IST into the closed
 * financial year and stamp a document of record with a number from a series that
 * should no longer be issuing any.
 *
 * ### ⚠️ Why the series is validated by shape, not by membership
 *
 * This replaces a check against `Object.values(INVOICE_SERIES)` — a hardcoded list
 * of three. `Setting.customer.invoice.seriesPrefix` exists so an admin can choose
 * the claim prefix, and its Joi rule accepted any letters; `settleVoucherClaimPayment`
 * passed that value straight in. So changing the prefix to anything but `VCH`
 * produced a **500 on every voucher claim** — thrown at the invoice stage, which
 * runs *after* the payment is captured, the claim is redeemed and the ledger is
 * posted.
 *
 * The customer's side of that: money gone, voucher actually redeemed, and an app
 * showing "payment failed". `resumeIncompleteSettlements` then retried the same
 * transaction and threw at the same line every time, so it never cleared — every
 * claim stayed stuck until somebody thought to change a settings field back.
 *
 * A numbering sequence has no business caring *which* letters it is. It cares that
 * the token is short, uppercase and stable, so the counter key is well-formed and
 * the number reads properly. `RESERVED_DOCUMENT_SERIES` in the settings validator
 * is what stops a human choosing a *confusing* prefix; this function's job is to
 * never crash on one.
 *
 * @param {object} args
 * @param {string} args.series  a DOCUMENT_SERIES value, or an admin-chosen prefix
 * @param {Date}   [args.at]    instant to derive the financial year from
 * @returns {Promise<string>}
 */
exports.generateDocumentNumber = async ({ series, at } = {}) => {
  const prefix = String(series ?? "").trim().toUpperCase();

  if (!DOCUMENT_SERIES_PATTERN.test(prefix)) {
    throwError(
      500,
      `Document series must be ${DOCUMENT_SERIES_MIN}-${DOCUMENT_SERIES_MAX} uppercase letters — got "${series}".`,
    );
  }

  const financialYear = istFinancialYear(at);
  const counterKey = `INVOICE:${prefix}:${financialYear}`;

  // Two callers can race to *create* the counter document on the very first
  // allotment of a series. One wins the upsert and the other gets a duplicate
  // key; by then the document exists, so a single retry always succeeds.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: counterKey },
        { $inc: { sequence: 1 } },
        // `returnDocument: "after"` rather than `new: true` — the latter is
        // deprecated in Mongoose 9 and logs on every call.
        //
        // `setDefaultsOnInsert` is deliberately omitted rather than disabled:
        // Mongoose skips defaults for paths already in the update, so the
        // schema's `sequence` default never applies here either way, and a fresh
        // series starts at 1.
        { upsert: true, returnDocument: "after" },
      );

      if (!counter) throwError(500, "Could not allot a document number.");

      return `TD/${prefix}/${financialYear}/${String(counter.sequence).padStart(6, "0")}`;
    } catch (error) {
      if (error?.code === DUPLICATE_KEY && attempt === 0) continue;
      throw error;
    }
  }

  // Unreachable: the retry above either returns or rethrows.
  return throwError(500, "Could not allot a document number.");
};
