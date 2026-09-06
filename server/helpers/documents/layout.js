/**
 * The one place a document decides where anything goes on the page.
 *
 * ### The bug this exists to make impossible
 *
 * Both PDF generators wrote a two-column row like this:
 *
 * ```js
 * const y = doc.y;
 * doc.text(label, labelX, y, { width: 120 });   // wraps to 2 lines -> doc.y = 70.8
 * doc.text(value, valueX, y, { width: 95 });    // starts at y again -> doc.y = 60.4
 * doc.moveDown(0.2);                            // next row at 62.5, inside the first
 * ```
 *
 * PDFKit advances `doc.y` past whatever it just drew. Drawing the value *second*,
 * from the same `y`, therefore moves `doc.y` **backwards** whenever the label
 * wrapped and the value did not — and every following row is printed on top of
 * the one before it. Measured on a real invoice: three rows that needed 90pt of
 * page advanced 37.5pt, and the customer got a receipt with the amounts written
 * over each other.
 *
 * It only showed up when a label wrapped, which is why it survived: it depended
 * on the length of a brand name.
 *
 * `row()` below measures both cells *before* drawing and advances by the taller
 * of the two, so `doc.y` can never move backwards. The label column is also 330pt
 * rather than 120pt, so the wrap that triggered it is now rare as well as safe.
 *
 * ### Everything here is deliberately geometric
 *
 * No document content, no money rules, no branching on what kind of document it
 * is. A caller asks for a row, a heading or a table; this decides pixels and page
 * breaks. That is what lets one renderer serve receipts, invoices, statements,
 * refunds and chargeback advices without each re-inventing a layout.
 */

const FONT = Object.freeze({
  regular: "Helvetica",
  bold: "Helvetica-Bold",
});

const SIZE = Object.freeze({
  title: 18,
  heading: 12,
  subheading: 11,
  body: 9,
  small: 8,
});

const COLOR = Object.freeze({
  text: "#000000",
  muted: "#666666",
  rule: "#dddddd",
});

/** A4 at PDFKit's 72dpi, with the 50pt margin the documents already used. */
const PAGE = Object.freeze({
  size: "A4",
  margin: 50,
  width: 595.28,
  height: 841.89,
});

const LEFT = PAGE.margin;
const RIGHT = PAGE.width - PAGE.margin;
const BOTTOM = PAGE.height - PAGE.margin;
const CONTENT_WIDTH = RIGHT - LEFT;

/**
 * The label/value split for an amounts row.
 *
 * 330pt at 9pt Helvetica is roughly 66 characters — enough for
 * "Bill collected on behalf of <a long brand name>" to sit on one line, which the
 * old 120pt column could not do for even a short one.
 */
const LABEL_WIDTH = 330;
const VALUE_GAP = 10;
const VALUE_X = LEFT + LABEL_WIDTH + VALUE_GAP;
const VALUE_WIDTH = RIGHT - VALUE_X;

/**
 * Start a page if `height` will not fit on this one.
 *
 * Called *before* drawing rather than after, so a row is never cut in half by a
 * page break — the reader sees the whole line or none of it.
 *
 * @returns {boolean} whether a page was started
 */
const ensureSpace = (doc, height) => {
  if (doc.y + height <= BOTTOM) return false;
  doc.addPage();
  return true;
};

/** Apply a font, size and colour in one call, so measuring and drawing agree. */
const applyStyle = (doc, { bold = false, size = SIZE.body, muted = false } = {}) =>
  doc
    .font(bold ? FONT.bold : FONT.regular)
    .fontSize(size)
    .fillColor(muted ? COLOR.muted : COLOR.text);

/**
 * A label on the left and a value right-aligned against the margin.
 *
 * The core primitive. See the header of this file for what it is protecting
 * against — in short, it measures first and advances by the taller cell, so
 * `doc.y` only ever moves forward.
 *
 * @param {object} doc     PDFKit document
 * @param {string} label
 * @param {string} value
 * @param {object} [options]
 * @param {boolean}[options.bold]
 * @param {boolean}[options.muted]
 * @param {number} [options.size]
 * @param {number} [options.indent] pixels to inset the label by, for a sub-line
 * @param {number} [options.gap]    trailing space, in lines
 */
const row = (doc, label, value, options = {}) => {
  const { bold = false, muted = false, size = SIZE.body, indent = 0, gap = 0.25 } =
    options;

  const labelText = String(label ?? "");
  const valueText = String(value ?? "");
  const labelX = LEFT + indent;
  const labelWidth = LABEL_WIDTH - indent;

  // Style before measuring: `heightOfString` answers for the *current* font, so
  // measuring in one font and drawing in another is how a row silently overlaps
  // again.
  applyStyle(doc, { bold, size, muted });

  const height = Math.max(
    doc.heightOfString(labelText, { width: labelWidth }),
    doc.heightOfString(valueText, { width: VALUE_WIDTH }),
  );

  ensureSpace(doc, height);
  // Re-applied because a page break can reset the graphics state.
  applyStyle(doc, { bold, size, muted });

  const y = doc.y;
  doc.text(labelText, labelX, y, { width: labelWidth });
  doc.text(valueText, VALUE_X, y, { width: VALUE_WIDTH, align: "right" });

  // ⚠️ The fix. Never `doc.y` as PDFKit left it — that is the value cell's
  // bottom, which is above the label's whenever the label wrapped.
  doc.y = y + height;
  doc.x = LEFT;
  doc.moveDown(gap);
};

/**
 * `Label: value` on one line, full width.
 *
 * For the meta block — invoice number, dates, payment reference. Wraps safely for
 * the same reason `row` does.
 */
const field = (doc, label, value, options = {}) => {
  const { size = SIZE.body, muted = false, gap = 0 } = options;
  const text = `${label}: ${value ?? "-"}`;

  applyStyle(doc, { size, muted });
  const height = doc.heightOfString(text, { width: CONTENT_WIDTH });

  ensureSpace(doc, height);
  applyStyle(doc, { size, muted });

  const y = doc.y;
  doc.text(text, LEFT, y, { width: CONTENT_WIDTH });
  doc.y = y + height;
  doc.x = LEFT;
  if (gap) doc.moveDown(gap);
};

/** A free-standing line of text, full width. */
const paragraph = (doc, text, options = {}) => {
  const { size = SIZE.body, muted = false, bold = false, gap = 0 } = options;
  const body = String(text ?? "");

  applyStyle(doc, { size, muted, bold });
  const height = doc.heightOfString(body, { width: CONTENT_WIDTH });

  ensureSpace(doc, height);
  applyStyle(doc, { size, muted, bold });

  const y = doc.y;
  doc.text(body, LEFT, y, { width: CONTENT_WIDTH });
  doc.y = y + height;
  doc.x = LEFT;
  if (gap) doc.moveDown(gap);
};

/** The document's name, centred, with an explanatory line under it. */
const title = (doc, text, subtitle) => {
  applyStyle(doc, { bold: true, size: SIZE.title });
  doc.text(String(text ?? ""), LEFT, doc.y, {
    width: CONTENT_WIDTH,
    align: "center",
  });
  doc.x = LEFT;

  if (subtitle) {
    doc.moveDown(0.3);
    applyStyle(doc, { size: SIZE.body, muted: true });
    doc.text(String(subtitle), LEFT, doc.y, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.x = LEFT;
  }
  doc.moveDown(1);
};

/** A section heading — "Bill To", "Summary", "Transfers". */
const heading = (doc, text, options = {}) => {
  const { size = SIZE.heading, gap = 0.35 } = options;
  applyStyle(doc, { bold: true, size });

  const height = doc.heightOfString(String(text), { width: CONTENT_WIDTH });
  ensureSpace(doc, height);
  applyStyle(doc, { bold: true, size });

  const y = doc.y;
  doc.text(String(text), LEFT, y, { width: CONTENT_WIDTH });
  doc.y = y + height;
  doc.x = LEFT;
  doc.moveDown(gap);
};

/** A hairline across the content width. */
const divider = (doc, options = {}) => {
  const { gap = 0.5 } = options;
  ensureSpace(doc, 2);
  doc
    .moveTo(LEFT, doc.y)
    .lineTo(RIGHT, doc.y)
    .strokeColor(COLOR.rule)
    .lineWidth(1)
    .stroke();
  doc.x = LEFT;
  doc.moveDown(gap);
};

/**
 * A multi-column table that survives a page break.
 *
 * Cells are measured the same way `row` measures its two, so a long claim code or
 * a wrapped description pushes the whole row down rather than sliding under the
 * next one. When the rows outrun the page the header is drawn again on the new
 * one — a bare continuation of numbers with no column labels is unreadable.
 *
 * @param {object}   doc
 * @param {object}   spec
 * @param {Array<{label: string, width: number, align?: string}>} spec.columns
 * @param {Array<Array<string>>} spec.rows
 * @param {string}   [spec.emptyText] printed instead of an empty body
 */
const table = (doc, { columns = [], rows = [], emptyText, size = SIZE.small } = {}) => {
  // Left edge of each column, accumulated once.
  const offsets = [];
  let cursor = LEFT;
  for (const column of columns) {
    offsets.push(cursor);
    cursor += column.width;
  }

  const drawHeader = () => {
    applyStyle(doc, { bold: true, size, muted: true });
    const height = Math.max(
      ...columns.map((column) =>
        doc.heightOfString(String(column.label ?? ""), { width: column.width }),
      ),
    );
    ensureSpace(doc, height + 8);
    applyStyle(doc, { bold: true, size, muted: true });

    const y = doc.y;
    columns.forEach((column, index) => {
      doc.text(String(column.label ?? ""), offsets[index], y, {
        width: column.width,
        align: column.align || "left",
      });
    });
    doc.y = y + height;
    doc.x = LEFT;
    doc.moveDown(0.4);
    divider(doc, { gap: 0.3 });
  };

  drawHeader();

  if (!rows.length) {
    paragraph(doc, emptyText || "Nothing to show here.", { muted: true });
    return;
  }

  for (const cells of rows) {
    applyStyle(doc, { size });
    const height = Math.max(
      ...columns.map((column, index) =>
        doc.heightOfString(String(cells[index] ?? ""), { width: column.width }),
      ),
    );

    // A page break mid-table takes the header with it.
    if (ensureSpace(doc, height)) drawHeader();
    applyStyle(doc, { size });

    const y = doc.y;
    columns.forEach((column, index) => {
      doc.text(String(cells[index] ?? ""), offsets[index], y, {
        width: column.width,
        align: column.align || "left",
      });
    });
    doc.y = y + height;
    doc.x = LEFT;
    doc.moveDown(0.35);
  }
};

module.exports = {
  FONT,
  SIZE,
  COLOR,
  PAGE,
  LEFT,
  RIGHT,
  BOTTOM,
  CONTENT_WIDTH,
  LABEL_WIDTH,
  VALUE_X,
  VALUE_WIDTH,
  ensureSpace,
  applyStyle,
  row,
  field,
  paragraph,
  title,
  heading,
  divider,
  table,
};
