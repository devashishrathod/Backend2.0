const fs = require("fs");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");
const { uploadPDF } = require("../../services/uploads");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");

const SYMBOL = CUSTOMER_CURRENCY_DEFAULTS.currencySymbol;

const money = (amount) =>
  `${SYMBOL}${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const onDay = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium" })
    : "-";

const onDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";

/**
 * The vendor's payout statement.
 *
 * ### ⚠️ What is deliberately not on it
 *
 * `platformPromoCost`, `gatewayFee` and `netReceived` sit on the same
 * sub-document as the vendor's own figures, and none of them are theirs — they
 * are our margin and our cost. `buildSettlementReadPipeline` makes that decision
 * once for the API; this makes the same one for the paper, rather than reaching
 * into the transaction and printing whatever is there.
 *
 * ### Why the deductions are itemised
 *
 * A vendor whose ₹1,000 of sales pays out ₹882 will ask why, and the answer has
 * to be **on the document** — not in an email, not from support. Every line that
 * reduces the payout is named, and the ones that are zero are still printed, so
 * the arithmetic can be followed rather than trusted.
 */
const renderStatementPdf = async (statement = {}, { compress = true } = {}) => {
  const {
    settlementNumber,
    periodStart,
    periodEnd,
    cycleType,
    brand = {},
    bank = {},
    totals = {},
    lines = [],
    legs = [],
    generatedAt = new Date(),
  } = statement;

  const fileName = `statement_${Date.now()}_${Math.floor(Math.random() * 10000)}.pdf`;
  const tmpDir = path.join(os.tmpdir(), "trydood-statements");
  const filePath = path.join(tmpDir, fileName);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", compress });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const LEFT = 50;
    const RIGHT = 545;
    const line = () =>
      doc
        .moveTo(LEFT, doc.y)
        .lineTo(RIGHT, doc.y)
        .strokeColor("#dddddd")
        .stroke()
        .moveDown(0.5);

    /** A label on the left, a figure right-aligned, on one row. */
    const row = (label, value, { bold = false, muted = false } = {}) => {
      const y = doc.y;
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 11 : 10)
        .fillColor(muted ? "#666666" : "#000000")
        .text(label, LEFT, y, { width: 320 });
      doc.text(value, LEFT + 320, y, { width: RIGHT - LEFT - 320, align: "right" });
      doc.moveDown(0.35);
    };

    // ---------------- header ----------------
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#000").text("PAYOUT STATEMENT", {
      align: "center",
    });
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#666")
      .text("Issued by Trydood", { align: "center" });
    doc.moveDown(1);

    doc.fillColor("#000");
    row("Statement", settlementNumber || "-", { bold: true });
    row("Brand", brand.name || brand.legalName || "-");
    row("Period", `${onDay(periodStart)} — ${onDay(periodEnd)}`);
    row("Cycle", cycleType || "-", { muted: true });
    row("Generated", onDate(generatedAt), { muted: true });
    doc.moveDown(0.4);
    line();

    // ---------------- where it went ----------------
    doc.font("Helvetica-Bold").fontSize(12).text("Paid to");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    /**
     * ⚠️ The masked number only. A statement is forwarded, screenshotted and
     * pasted into support chats — printing a full account number puts it in
     * every one of those places for ever.
     */
    row("Account holder", bank.accountHolderName || "-");
    row("Account", bank.maskedAccountNumber || `••••${bank.accountLast4Digits || "----"}`);
    row("IFSC", bank.ifscCode || "-");
    row("Bank", bank.bankName || "-");
    doc.moveDown(0.4);
    line();

    // ---------------- the money ----------------
    doc.font("Helvetica-Bold").fontSize(12).text("Summary");
    doc.moveDown(0.3);

    row("Sales collected", money(totals.grossCollected));
    row("Less: your share of promotions", `− ${money(totals.vendorPromoCost)}`);

    /**
     * Commission and its tax on their own lines, and printed even at zero.
     *
     * The rate is 0 today. Printing the line anyway means the day it is switched
     * on the statement does not change shape — a vendor comparing two months
     * sees a number move, not a row appear from nowhere.
     */
    row("Less: Trydood commission", `− ${money(totals.commissionAmount)}`);
    if (Number(totals.commissionTax) > 0) {
      row("Less: GST on commission", `− ${money(totals.commissionTax)}`, {
        muted: true,
      });
    }

    row("Less: refunds from earlier periods", `− ${money(totals.refundAdjustment)}`);
    row("Less: chargebacks recovered", `− ${money(totals.chargebackAdjustment)}`);

    if (Number(totals.reserveHeld) > 0) {
      row("Less: reserve held", `− ${money(totals.reserveHeld)}`);
    }
    if (Number(totals.reserveReleased) > 0) {
      row("Add: reserve released", `+ ${money(totals.reserveReleased)}`);
    }

    doc.moveDown(0.2);
    line();
    row("Net paid to you", money(totals.netPayable), { bold: true });
    doc.moveDown(0.6);

    // ---------------- the transfers ----------------
    if (legs.length) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text("Transfers");
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(9);

      for (const leg of legs) {
        /**
         * The UTR is the point of this section. Three days after a vendor says
         * the money never arrived, it is the only thing that can be looked up on
         * a bank statement — so it goes on the paper they already have.
         */
        row(
          `${onDay(leg.paidAt)} · ${leg.mode || "NEFT"} · UTR ${leg.utr || "-"}`,
          money(leg.amount),
        );
      }
      doc.moveDown(0.5);
      line();
    }

    // ---------------- the claims ----------------
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(
      `Claims in this period (${totals.transactionCount ?? lines.length})`,
    );
    doc.moveDown(0.4);

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#666");
    const head = doc.y;
    doc.text("Date", LEFT, head, { width: 70 });
    doc.text("Claim", LEFT + 70, head, { width: 120 });
    doc.text("Bill", LEFT + 190, head, { width: 70, align: "right" });
    doc.text("Net bill", LEFT + 260, head, { width: 80, align: "right" });
    doc.text("Deductions", LEFT + 340, head, { width: 80, align: "right" });
    doc.text("Your share", LEFT + 420, head, { width: 75, align: "right" });
    doc.moveDown(0.5);
    line();

    doc.font("Helvetica").fontSize(8).fillColor("#000");

    for (const item of lines) {
      // A new page before the row runs off the bottom, not after.
      if (doc.y > 740) {
        doc.addPage();
        doc.font("Helvetica").fontSize(8).fillColor("#000");
      }

      const y = doc.y;
      const deductions =
        (Number(item.vendorPromoCost) || 0) +
        (Number(item.commissionDeduction) || 0);

      doc.text(onDay(item.date), LEFT, y, { width: 70 });
      doc.text(String(item.claimCode || item.invoiceId || "-"), LEFT + 70, y, {
        width: 120,
      });
      doc.text(money(item.billAmount), LEFT + 190, y, { width: 70, align: "right" });
      doc.text(money(item.netBill), LEFT + 260, y, { width: 80, align: "right" });
      doc.text(deductions ? `− ${money(deductions)}` : money(0), LEFT + 340, y, {
        width: 80,
        align: "right",
      });
      doc.text(money(item.vendorPayable), LEFT + 420, y, {
        width: 75,
        align: "right",
      });
      doc.moveDown(0.4);
    }

    if (!lines.length) {
      doc.fillColor("#666").text("No claims settled in this period.", LEFT);
    }

    doc.moveDown(1.2);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666")
      .text(
        "Refunds and chargebacks from earlier periods are deducted here rather than " +
          "netted against the claim they came from, so each period's claims stay readable.",
        LEFT,
        doc.y,
        { width: RIGHT - LEFT },
      );

    doc.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  return { filePath, fileName };
};

/**
 * Render, upload, and clean up whatever happens.
 *
 * Mirrors `generateAndUploadInvoice`: the temp file is removed in a `finally`, so
 * a failed upload does not leave the box slowly filling with PDFs nobody asked
 * for.
 */
exports.generateAndUploadStatement = async (statement = {}) => {
  const { filePath, fileName } = await renderStatementPdf(statement);
  try {
    return await uploadPDF(filePath, fileName);
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
  }
};

exports.renderStatementPdf = renderStatementPdf;
