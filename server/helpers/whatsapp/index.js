const { sendWhatsApp } = require("./sendWhatsApp");

/**
 * ⚠️ `sendWhatsApp` only. `normalisePhone` and `sanitiseParam` are the pieces it
 * is built from — a caller reaching for either is a caller about to format a
 * number or trim a template parameter itself, which is how two callers end up
 * disagreeing about what the provider accepts.
 */
module.exports = { sendWhatsApp };
