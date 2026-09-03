const fs = require("fs");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");
const { PAYMENT_STATUS } = require("../../constants");
const {
  INVOICE_KIND,
  INVOICE_TITLE,
} = require("../../constants/transaction");
const { GST_TAX_TYPES } = require("../../constants/subscription");
const { uploadPDF } = require("../../services/uploads");

const money = (amount) =>
  `Rs. ${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const asDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "-";

/**
 * Build the tax rows. Intra-state supply prints CGST + SGST at half the rate
 * each; inter-state prints a single IGST line — the same split the checkout
 * preview showed the vendor.
 */
const taxRows = (pricing = {}) => {
  const rate = Number(pricing.gstPercentage) || 0;
  if (pricing.taxType === GST_TAX_TYPES.CGST_SGST) {
    return [
      [`CGST @ ${(rate / 2).toFixed(2)}%`, money(pricing.cgst)],
      [`SGST @ ${(rate / 2).toFixed(2)}%`, money(pricing.sgst)],
    ];
  }
  return [[`IGST @ ${rate.toFixed(2)}%`, money(pricing.igst)]];
};

/**
 * Render the PDF to a temp file and return its path.
 *
 * Separate from the upload so the rendering can be exercised — and compared
 * between two runs — without touching a storage provider.
 *
 * @param {object}  snapshot            models/invoiceSnapshotSchema.js shape
 * @param {object} [options]
 * @param {boolean}[options.compress]   false to leave the content stream
 *        readable, for inspecting or diffing a rendered invoice
 */
const renderInvoicePdf = async (snapshot = {}, { compress = true } = {}) => {
  const {
    invoiceId,
    transactionRef,
    issuedAt,
    planName,
    planType,
    durationLabel,
    planStart,
    planEnd,
    hsnSacCode,
    seller = {},
    billTo = {},
    pricing = {},
    paymentStatus,
    paymentMethod,
    isManual = false,
    placeOfSupply,
    // ---------- voucher claim only ----------
    kind = INVOICE_KIND.SUBSCRIPTION,
    isTaxInvoice = true,
    voucherPricing = {},
    lineItems = [],
    voucherBlock = {},
    brandBlock = {},
  } = snapshot;

  const isClaim = kind === INVOICE_KIND.VOUCHER_CLAIM;

  const fileName = `invoice_${Date.now()}_${Math.floor(Math.random() * 10000)}.pdf`;
  // OS temp dir, not a folder inside the source tree.
  const tmpDir = path.join(os.tmpdir(), "trydood-invoices");
  const filePath = path.join(tmpDir, fileName);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  await new Promise((resolve, reject) => {
    // `compress: false` leaves the content stream readable, which is the only
    // practical way to inspect or diff what an invoice actually says.
    const doc = new PDFDocument({ margin: 50, size: "A4", compress });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    /**
     * ---------------- header ----------------
     *
     * ⚠️ A document carrying no tax must not call itself a tax invoice. Customer
     * GST is off by default, so a claim prints **PAYMENT RECEIPT** — and the
     * decision was frozen into the snapshot when it was issued, not taken here,
     * so switching GST on later cannot retitle a document already sent out.
     */
    doc
      .fontSize(18)
      .text(isTaxInvoice ? INVOICE_TITLE.TAX_INVOICE : INVOICE_TITLE.RECEIPT, {
        align: "center",
      });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor("#666")
      .text(
        isClaim
          ? `Payment collected by Trydood on behalf of ${brandBlock.name || "the brand"}`
          : isManual
            ? "Subscription granted directly by Trydood administration"
            : "Subscription payment receipt",
        { align: "center" },
      );
    doc.fillColor("#000").moveDown(1);

    // ---------------- seller ----------------
    doc.fontSize(11).text(seller.name || seller.legalName || "Trydood");
    doc.fontSize(9);
    if (seller.address) doc.text(seller.address);
    if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`);
    doc.moveDown(0.8);

    // ---------------- invoice meta ----------------
    doc.fontSize(9);
    doc.text(`Invoice No: ${invoiceId || "-"}`);
    doc.text(`Invoice Date: ${asDate(issuedAt)}`);
    doc.text(`Transaction Ref: ${transactionRef || "-"}`);
    doc.text(
      `Payment Status: ${paymentStatus === PAYMENT_STATUS.CAPTURED ? "Paid" : paymentStatus || "-"}`,
    );
    doc.text(`Payment Method: ${paymentMethod || "-"}`);
    doc.moveDown(0.8);

    // ---------------- buyer ----------------
    doc.fontSize(10).text("Bill To");
    doc.fontSize(9);
    doc.text(billTo.name || billTo.legalName || "-");
    if (billTo.address) doc.text(billTo.address, { width: 320 });
    if (billTo.gstin) doc.text(`GSTIN: ${billTo.gstin}`);
    if (billTo.pan) doc.text(`PAN: ${billTo.pan}`);
    if (placeOfSupply) doc.text(`Place of Supply: ${placeOfSupply}`);
    doc.moveDown(0.8);

    // ---------------- description ----------------
    doc.fontSize(10).text("Description");
    doc.fontSize(9);

    if (isClaim) {
      // A claim has no plan, no duration and no validity range. Printed through
      // the subscription block it would show an empty name and `Validity: - to -`.
      if (voucherBlock.voucherName) doc.text(voucherBlock.voucherName);
      if (voucherBlock.offerTitle) doc.text(`Offer: ${voucherBlock.offerTitle}`);
      if (voucherBlock.claimCode) doc.text(`Claim Code: ${voucherBlock.claimCode}`);
      if (voucherBlock.outletStoreId) {
        doc.text(`Outlet: ${voucherBlock.outletStoreId}`);
      }
      if (voucherBlock.redeemedAt) {
        doc.text(`Redeemed: ${asDate(voucherBlock.redeemedAt)}`);
      }
      // Only on a document that actually carries tax, and only for our own fee.
      if (isTaxInvoice && hsnSacCode) doc.text(`SAC: ${hsnSacCode}`);
    } else {
      doc.text(
        `${planName || "Subscription"} plan${planType ? ` (${planType})` : ""}${durationLabel ? ` — ${durationLabel}` : ""}`,
      );
      if (hsnSacCode) doc.text(`HSN/SAC: ${hsnSacCode}`);
      doc.text(`Validity: ${asDate(planStart)} to ${asDate(planEnd)}`);
    }
    doc.moveDown(0.8);

    // ---------------- amounts ----------------
    //
    // A claim's rows come pre-worded from the snapshot, because the wording is
    // part of what was issued: "Bill collected on behalf of <Brand>" is a
    // statement about who sold the meal, and an invoice re-issued after that
    // wording changed must still read the way it did.
    const rows = isClaim
      ? [
          ...lineItems.map((item) => [
            item.label,
            item.isDeduction
              ? `- ${money(item.amount)}`
              : money(item.amount),
          ]),
          ...(isTaxInvoice ? taxRows(voucherPricing) : []),
        ]
      : [
      ["Original Price", money(pricing.listPrice)],
      ...(pricing.discountAmount > 0
        ? [
            [
              `Discount${pricing.discountPercent ? ` (${pricing.discountPercent}%)` : ""}`,
              `- ${money(pricing.discountAmount)}`,
            ],
          ]
        : []),
      ...(pricing.promoDiscount > 0
        ? [
            [
              `Promo${pricing.promoCode ? ` (${pricing.promoCode})` : ""}`,
              `- ${money(pricing.promoDiscount)}`,
            ],
          ]
        : []),
      ["Taxable Value", money(pricing.taxableValue)],
      ...taxRows(pricing),
    ];

    const labelX = 320;
    const valueX = 450;
    rows.forEach(([label, value]) => {
      const y = doc.y;
      doc.text(label, labelX, y, { width: 120 });
      doc.text(value, valueX, y, { width: 95, align: "right" });
      doc.moveDown(0.2);
    });

    doc.moveDown(0.4);
    const totalY = doc.y;
    doc.fontSize(11);
    doc.text(isClaim ? "You Paid" : "Total Payable", labelX, totalY, {
      width: 120,
    });
    doc.text(
      money(isClaim ? voucherPricing.totalPayable : pricing.totalPayable),
      valueX,
      totalY,
      { width: 95, align: "right" },
    );

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor("#666")
      .text(
        isClaim
          ? /**
             * A claim's footer has to say three things a subscription's does not:
             * that Trydood collected rather than sold, that any tax here is on
             * our fee alone, and — while GST is off — that there is no tax at
             * all. The subscription line said "GST is charged in addition to the
             * plan price", which on a claim is wrong twice over: there is no
             * plan, and no GST was charged.
             */
            isTaxInvoice
            ? "Tax shown applies to the Trydood convenience fee only. The bill amount was collected on behalf of the brand."
            : "No tax has been charged. The bill amount was collected on behalf of the brand."
          : pricing.isGstInclusive
            ? "Plan price is inclusive of GST."
            : "GST is charged in addition to the plan price.",
        50,
        doc.y,
      );
    doc.text("This is a computer-generated invoice.");

    doc.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    doc.on("error", reject);
  });

  return { filePath, fileName };
};

/**
 * Render a GST tax invoice and upload it.
 *
 * Reads **only** the frozen `invoiceSnapshot` — no live lookups, no config read,
 * no plan fetch. That is what makes an invoice reproducible: re-issuing one
 * produces the same document even after the plan is renamed, the seller's GSTIN
 * changes, or the brand moves address.
 */
exports.generateAndUploadInvoice = async (snapshot = {}) => {
  const { filePath, fileName } = await renderInvoicePdf(snapshot);
  try {
    return await uploadPDF(filePath, fileName);
  } finally {
    // Always clean up, whether the upload succeeded or threw.
    fs.promises.unlink(filePath).catch(() => {});
  }
};

exports.renderInvoicePdf = renderInvoicePdf;
