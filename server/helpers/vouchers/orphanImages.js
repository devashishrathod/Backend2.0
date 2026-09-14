const VoucherVersion = require("../../models/VoucherVersion");

/**
 * Which of these files is nobody using any more?
 *
 * ### 🔴 The bug this exists to stop
 *
 * A published version is immutable history, so editing one **forks** a new
 * draft — and the fork copies every kept image across as it is, `storage` and
 * all. Two version documents then point at **one file**:
 *
 *     v1 PUBLISHED   images[0].storage.key = dev/images/vouchers/v1/abc.webp
 *     v2 DRAFT       images[0].storage.key = dev/images/vouchers/v1/abc.webp   ← same object
 *
 * The fork itself knew this — it never deletes, and says so. But the **next**
 * edit to that draft is an ordinary update, and the ordinary update deletes
 * whatever the vendor removed. So removing that image from the draft destroyed
 * the file the **live, published** voucher was still serving: a customer-facing
 * image went dead, from a request that reported success, with nothing anywhere
 * to say why.
 *
 * ### Why the check is scoped to the voucher
 *
 * Every upload gets its own uuid, so two vouchers never share an object by
 * accident. The **only** way a key comes to be in two places is the fork above,
 * and a fork stays inside one voucher — which is also what lets this be one
 * indexed query on `voucherId` rather than a scan of every version ever made.
 *
 * ### Identity, not equality
 *
 * Rows are compared on what actually names the file — the S3 `key`, or
 * Cloudinary's `publicId` — and fall back to the URL for rows written before
 * `storage` existed. Comparing whole subdocuments would miss, because the fork
 * rewrites `sortOrder` on the way through.
 */

/** What names this file, whoever is storing it. */
const identityOf = (image) =>
  image?.storage?.key || image?.storage?.publicId || image?.url || null;

/**
 * @param {Array}  images     the images a vendor removed
 * @param {string} voucherId  the voucher they belong to
 * @returns {Promise<Array>}  only the ones no surviving version still points at
 */
exports.pickOrphanImages = async (images = [], voucherId) => {
  const candidates = (images || []).filter((image) => identityOf(image));
  if (!candidates.length) return [];

  /**
   * ⚠️ Every non-deleted version is read, the one just updated included. That
   * version no longer holds the removed image — it was written before this runs
   * — so including it costs nothing, and leaving it in means a half-applied
   * update can only ever make this **keep** a file. Erring toward a stray file
   * is right: an orphan costs storage, a wrong delete costs a live voucher.
   */
  const survivors = await VoucherVersion.find(
    { voucherId, isDeleted: false },
    { "images.url": 1, "images.storage": 1 },
  ).lean();

  const stillReferenced = new Set();
  for (const version of survivors) {
    for (const image of version.images || []) {
      const identity = identityOf(image);
      if (identity) stillReferenced.add(identity);
    }
  }

  return candidates.filter((image) => !stillReferenced.has(identityOf(image)));
};
