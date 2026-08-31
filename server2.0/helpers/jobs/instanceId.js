const os = require("os");
const crypto = require("crypto");

/**
 * A stable identifier for this process, computed once at import.
 *
 * `hostname:pid:token`. The random token is what makes it safe: a host can hand
 * out the same pid again after a restart, and without it a dead instance's lock
 * could be renewed — or released — by its own replacement, which is exactly the
 * case the lock exists to prevent.
 */
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto
  .randomBytes(4)
  .toString("hex")}`;

module.exports = { INSTANCE_ID };
