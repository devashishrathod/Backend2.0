const fs = require("fs");
const os = require("os");
const path = require("path");
const PDFDocument = require("pdfkit");

const { uploadPDF } = require("../../services/uploads");
const {
  row,
  field,
  paragraph,
  title,
  heading,
  divider,
  table,
  SIZE,
  LEFT,
  PAGE,
} = require("./layout");
const { istDateTime, money, negativeMoney } = require("./format");

/**
 * The one renderer.
 *
 * It branches on **nothing**. There is no `if (kind === VOUCHER_CLAIM)` anywhere
 * below, because there used to be and that is what broke: a claim run through the
 * subscription branch printed an empty plan name and `Validity: - to -`, and every
 * new document type meant another branch nobody would exercise.
 *
 * A snapshot carries its own printed blocks — meta, timeline, details, line items,
 * tax lines, total, table, notes — already worded. This walks them in order and
 * draws whatever is there. A payout statement and a refund receipt reach the same
 * code; they differ only in which blocks they filled in.
 *
 * Every block is optional. A document with no table has no table section, rather
 * than an empty heading over nothing.
 */

/** A money row, respecting `isDeduction` so no sign is inferred from wording. */
const amountRow = (doc, item, options = {}) =>
  row(
    doc,
    item.label,
    item.isDeduction ? negativeMoney(item.amount) : money(item.amount),
    options,
  );

/** `Label: value` lines — the number, the reference, the payment method. */
const metaBlock = (doc, meta = []) => {
  if (!meta.length) return;
  for (const entry of meta) field(doc, entry.label, entry.value);
  doc.moveDown(0.8);
};

/** Name, address and tax identity for either party. Skips whatever is absent. */
const partyBlock = (doc, party = {}, { showTax = true } = {}) => {
  const name = party.name || party.legalName;
  if (name) paragraph(doc, name, { size: SIZE.subheading });
  // Under the trading name, and only when it says something different.
  if (party.legalName && party.legalName !== party.name) {
    paragraph(doc, party.legalName, { muted: true });
  }
  if (party.address) paragraph(doc, party.address);
  if (showTax && party.gstin) field(doc, "GSTIN", party.gstin);
  if (showTax && party.pan) field(doc, "PAN", party.pan);
  if (party.contact) field(doc, "Contact", party.contact);
  if (party.email) field(doc, "Email", party.email);
};

/**
 * The body of a document: what happened, when, and what it cost.
 *
 * Factored out because a payout statement carries a whole second document inside
 * it — the commission tax invoice — and that one needs the same treatment, not a
 * flattened summary of it.
 */
const bodyBlocks = (doc, block = {}) => {
  const {
    timeline = [],
    details = [],
    lineItems = [],
    taxLines = [],
    total,
    notes = [],
  } = block;

  if (details.length) {
    heading(doc, "Description");
    for (const entry of details) {
      // A detail with no label is a standalone line — a voucher name, an offer
      // title — rather than a `Label: value` pair.
      if (entry.label) field(doc, entry.label, entry.value);
      else paragraph(doc, entry.value);
    }
    doc.moveDown(0.8);
  }

  /**
   * ⚠️ Rendered in IST at draw time from stored `Date`s, never from pre-formatted
   * strings. A document has to say when things actually happened — and say the
   * same thing in two years, on a server in another timezone, after a Node
   * upgrade. Freezing the words would have frozen a timezone bug into every
   * document ever issued.
   */
  if (timeline.length) {
    heading(doc, "Timeline");
    for (const entry of timeline) {
      row(doc, entry.label, istDateTime(entry.at), { muted: true });
    }
    doc.moveDown(0.8);
  }

  for (const item of lineItems) amountRow(doc, item);
  for (const item of taxLines) amountRow(doc, item, { muted: true });

  if (total) {
    doc.moveDown(0.2);
    divider(doc, { gap: 0.3 });
    row(doc, total.label || "Total", money(total.amount), {
      bold: true,
      size: SIZE.subheading,
    });
    doc.moveDown(0.6);
  }

  for (const note of notes) {
    paragraph(doc, note, { size: SIZE.small, muted: true, gap: 0.2 });
  }
};

/**
 * A payout statement carries the commission tax invoice inside it.
 *
 * It gets a rule, its own title, its own number and its own parties — because it
 * *is* a separate document under GST, even though it shares the paper. A vendor
 * should not have to reconcile two files for one payout.
 */
const supplementBlock = (doc, supplement) => {
  if (!supplement?.title) return;

  doc.moveDown(0.5);
  divider(doc, { gap: 0.6 });

  heading(doc, supplement.title);
  if (supplement.subtitle) {
    paragraph(doc, supplement.subtitle, { muted: true });
    doc.moveDown(0.4);
  }

  if (supplement.documentNumber) {
    field(doc, "Invoice No", supplement.documentNumber);
  }
  if (supplement.seller?.gstin) {
    field(doc, "Supplier GSTIN", supplement.seller.gstin);
  }
  if (supplement.billTo?.gstin) {
    field(doc, "Recipient GSTIN", supplement.billTo.gstin);
  }
  if (supplement.placeOfSupply) {
    field(doc, "Place of Supply", supplement.placeOfSupply);
  }
  if (supplement.hsnSacCode) field(doc, "SAC", supplement.hsnSacCode);
  doc.moveDown(0.6);

  metaBlock(doc, supplement.meta || []);
  bodyBlocks(doc, supplement);
};

/**
 * Render the PDF to a temp file and return its path.
 *
 * Separate from the upload so the rendering can be exercised — and two runs
 * compared — without touching a storage provider.
 *
 * @param {object}  snapshot          models/documentSnapshotSchema.js shape
 * @param {object} [options]
 * @param {boolean}[options.compress] false leaves the content stream readable,
 *        which is the only practical way to inspect or diff a rendered document
 */
const renderDocumentPdf = async (snapshot = {}, { compress = true } = {}) => {
  const {
    title: documentTitle,
    subtitle,
    meta = [],
    seller = {},
    billTo = {},
    placeOfSupply,
    hsnSacCode,
    isTaxInvoice = true,
    table: tableBlock,
    supplement,
  } = snapshot;

  const fileName = `document_${Date.now()}_${Math.floor(Math.random() * 10000)}.pdf`;
  // OS temp dir, not a folder inside the source tree.
  const tmpDir = path.join(os.tmpdir(), "trydood-documents");
  const filePath = path.join(tmpDir, fileName);
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: PAGE.margin,
      size: PAGE.size,
      compress,
    });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    title(doc, documentTitle, subtitle);

    // Who issued it.
    partyBlock(doc, seller);
    doc.moveDown(0.8);

    // Its number, its dates, its references.
    metaBlock(doc, meta);

    // Who it is for.
    heading(doc, "Bill To");
    partyBlock(doc, billTo, { showTax: isTaxInvoice || Boolean(billTo.gstin) });
    if (placeOfSupply) field(doc, "Place of Supply", placeOfSupply);
    // Only on a document that actually carries tax — an SAC printed on an
    // untaxed receipt claims a tax treatment that was not applied.
    if (isTaxInvoice && hsnSacCode) field(doc, "HSN/SAC", hsnSacCode);
    doc.moveDown(0.8);

    bodyBlocks(doc, snapshot);

    if (tableBlock?.columns?.length) {
      doc.moveDown(0.4);
      if (tableBlock.title) heading(doc, tableBlock.title);
      table(doc, {
        columns: tableBlock.columns,
        rows: tableBlock.rows || [],
        emptyText: tableBlock.emptyText,
      });
      doc.moveDown(0.6);
    }

    supplementBlock(doc, supplement);

    doc.moveDown(0.8);
    paragraph(doc, "This is a computer-generated document.", {
      size: SIZE.small,
      muted: true,
    });
    doc.x = LEFT;

    doc.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
    doc.on("error", reject);
  });

  return { filePath, fileName };
};

/**
 * Render a document and upload it.
 *
 * Reads **only** the frozen snapshot — no live lookups, no config read, no plan
 * fetch. That is what makes a document reproducible: re-issuing one produces the
 * same paper even after the plan is renamed, the seller's GSTIN changes, or the
 * brand moves address.
 */
const generateAndUploadDocument = async (snapshot = {}) => {
  const { filePath, fileName } = await renderDocumentPdf(snapshot);
  try {
    return await uploadPDF(filePath, fileName);
  } finally {
    // Always clean up, whether the upload succeeded or threw — otherwise a failing
    // provider slowly fills the disk with PDFs nobody asked for.
    fs.promises.unlink(filePath).catch(() => {});
  }
};

module.exports = { renderDocumentPdf, generateAndUploadDocument };
