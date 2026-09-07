const {
  MONTHS,
  istDate,
  istDateTime,
  istDateShort,
  money,
  negativeMoney,
  groupIndian,
} = require("./format");
const { generateDocumentNumber } = require("./generateDocumentNumber");
const { alertDocumentFailed } = require("./alertDocumentFailed");
const { resolveDocumentTitle } = require("./resolveTitle");
const {
  renderDocumentPdf,
  generateAndUploadDocument,
} = require("./renderDocument");
const {
  resolvePartyName,
  resolveCustomerName,
  resolveVendorName,
} = require("./resolveParty");
const {
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
} = require("./layout");

module.exports = {
  // ---------- formatting ----------
  MONTHS,
  istDate,
  istDateTime,
  istDateShort,
  money,
  negativeMoney,
  groupIndian,

  // ---------- numbering, titling, rendering ----------
  generateDocumentNumber,
  /**
   * The shared failure path for every issuer that must not throw. A document
   * that could not be issued has to reach a human — none of these has a
   * re-issue endpoint, so nothing else will surface it.
   */
  alertDocumentFailed,
  resolveDocumentTitle,
  renderDocumentPdf,
  generateAndUploadDocument,

  // ---------- who the document names ----------
  resolvePartyName,
  resolveCustomerName,
  resolveVendorName,

  // ---------- layout ----------
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
