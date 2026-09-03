const Counter = require("../../models/Counter");
const { throwError } = require("../../utils");
const { istFinancialYear } = require("../common");
const { INVOICE_SERIES } = require("../../constants/transaction");

/**
 * Allot the next invoice number in a series.
 *
 *     TD/VCH/26-27/000001
 *      │   │    │      └── zero-padded sequence, monotonic within the series
 *      │   │    └───────── Indian financial year, computed in IST
 *      │   └────────────── series: VCH voucher · SUB subscription · STL settlement
 *      └────────────────── issuer
 *
 * Replaces `generateUniqueInvoiceId`, which built `INV-#` plus a random
 * five-digit number and then looped a `findOne` until it found one that was
 * free. Three things were wrong with that: the space held only 90,000 values,
 * every allotment cost a query (and more as the space filled), and two
 * concurrent orders could draw the same number between the check and the write
 * — a duplicate-key error on a live payment.
 *
 * `$inc` inside a `findOneAndUpdate` is a single atomic operation, so there is
 * no read to race with. It is also what GST expects of a document-of-record
 * sequence: monotonic within a series, per financial year.
 *
 * Each series gets its own counter document, so a voucher receipt cannot
 * consume a number from the subscription series.
 *
 *     Counter._id = "INVOICE:VCH:26-27"
 *
 * The financial year is IST-derived deliberately — see helpers/common/istDate.js.
 *
 * @param {object} args
 * @param {string} args.series  INVOICE_SERIES value ("VCH" | "SUB" | "STL")
 * @param {Date}   [args.at]    instant to derive the FY from; defaults to now
 * @returns {Promise<string>}
 */
exports.generateInvoiceNumber = async ({ series, at } = {}) => {
  const known = Object.values(INVOICE_SERIES);
  if (!series || !known.includes(series)) {
    throwError(
      500,
      `Invoice series must be one of: ${known.join(", ")} — got "${series}".`,
    );
  }

  const financialYear = istFinancialYear(at);
  const counterKey = `INVOICE:${series}:${financialYear}`;

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
        // schema's `sequence` default never applies here either way, and a
        // fresh series starts at 1.
        { upsert: true, returnDocument: "after" },
      );

      if (!counter) throwError(500, "Could not allot an invoice number.");

      return `TD/${series}/${financialYear}/${String(counter.sequence).padStart(6, "0")}`;
    } catch (error) {
      if (error?.code === 11000 && attempt === 0) continue;
      throw error;
    }
  }

  // Unreachable: the retry above either returns or rethrows.
  return throwError(500, "Could not allot an invoice number.");
};
