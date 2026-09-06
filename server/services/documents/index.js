const {
  getDocumentByToken,
  DOCUMENT_SOURCES,
} = require("./getDocumentByToken");

module.exports = {
  /**
   * One resolver for every Trydood document — claim receipt, subscription
   * invoice, grant advice, payout statement, refund receipt, chargeback advice.
   * A token carries no hint of its kind, so the resolver finds it rather than
   * the caller having to know.
   */
  getDocumentByToken,
  DOCUMENT_SOURCES,
};
