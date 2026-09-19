const mongoose = require("mongoose");
const VoucherVersion = require("../../models/VoucherVersion");
const Voucher = require("../../models/Voucher");
const { throwError } = require("../../utils");
const { VOUCHER_STATUSES } = require("../../constants/voucher");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  normalizeSortOrder,
  validateUniqueIds,
  validateUniqueSortOrders,
} = require("../../helpers/common");

/**
 * Re-number one version's images from a full ordered list (V-7, P8).
 *
 * ### 🔴 Images could not be reordered at all
 *
 * `sortOrder` was set once, on upload, and there was no way to change it. A
 * vendor who uploaded their best photo third had two options: delete everything
 * and start again, or live with it.
 *
 * ### ⚠️ The first image is the banner fallback, so this is visible work
 *
 * With no approved banner the customer's tile shows `images[0]` by `sortOrder`
 * (V-4a), and the claim snapshot freezes the same one (V-6c). Moving an image
 * to first therefore changes what customers see at the top of the voucher —
 * this is not a tidy-up of a list nobody looks at.
 *
 * ### 🔴 Only an editable version, and that is the existing rule
 *
 * A published version is `isImmutable: true`, and every other edit path honours
 * that: `updateVoucher` forks a new version rather than touching it. Reorder
 * does **not** fork, because a drag-and-drop that silently creates a version
 * awaiting approval is not what the vendor asked for. It refuses instead, and
 * says what to do.
 *
 * ### The complete list is required
 *
 * Positions are renumbered 1..n, so a partial list would collide with whatever
 * was left out of it. Same rule, same reason, as the showcase reorder.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {string} versionId
 * @param {{ images: Array<{ id: string, sortOrder: number }> }} payload
 */
exports.reorderVoucherImages = async (actor, versionId, payload = {}) => {
  if (!actor?.userId) throwError(401, "User authentication is required.");
  if (!versionId || !mongoose.Types.ObjectId.isValid(versionId)) {
    throwError(400, "Invalid voucher version ID.");
  }

  let images = payload.images;
  if (!Array.isArray(images) || images.length === 0) {
    throwError(400, "Image list is required.");
  }

  validateUniqueIds(images, "id");
  validateUniqueSortOrders(images, "sortOrder");
  images = normalizeSortOrder(images);

  const version = await VoucherVersion.findOne({
    _id: versionId,
    isDeleted: false,
  });
  if (!version) throwError(404, "Voucher version not found.");

  const voucher = await Voucher.findOne({
    _id: version.voucherId,
    isDeleted: false,
  })
    .select("_id brandId voucherCode")
    .lean();
  if (!voucher) throwError(404, "Voucher not found.");

  /**
   * ⚠️ Same rule as publish and pause: an admin may act for any brand, a vendor
   * only their own, and ownership is read off `Brand.userId` rather than the
   * token's cached `brandId`. Reordering decides which image customers see
   * first, so it is not a smaller act than the others.
   */
  await resolveActorBrand(actor, voucher.brandId);

  const editable =
    version.status === VOUCHER_STATUSES.DRAFT ||
    version.status === VOUCHER_STATUSES.REJECTED;

  if (!editable || version.isImmutable) {
    throwError(
      409,
      `A ${version.status.toLowerCase()} version cannot be reordered — its images are part of what was approved. Create a new version to change the order.`,
    );
  }

  const byId = new Map(
    version.images.map((entry) => [String(entry._id), entry]),
  );

  if (byId.size !== images.length) {
    throwError(
      400,
      `Please send the complete image order — ${byId.size} images expected, ${images.length} received.`,
    );
  }

  let moved = false;
  for (const item of images) {
    const entry = byId.get(String(item.id));
    if (!entry) throwError(400, `Invalid image id : ${item.id}`);
    if (entry.sortOrder !== item.sortOrder) {
      entry.sortOrder = item.sortOrder;
      moved = true;
    }
  }

  /**
   * ⚠️ Nothing to save is a success, not a no-op worth hiding. A vendor who
   * dropped an image back where it started gets the same answer as one who
   * never dragged it, and neither costs a write.
   */
  if (!moved) {
    return {
      versionId: version._id,
      voucherCode: voucher.voucherCode,
      updated: 0,
      message: "Images already in this order.",
      images: describe(version.images),
    };
  }

  version.updatedBy = actor.userId;
  await version.save();

  return {
    versionId: version._id,
    voucherCode: voucher.voucherCode,
    updated: images.length,
    images: describe(version.images),
  };
};

/**
 * What the caller gets back — the new order, sorted, with the URL so a panel can
 * repaint without a second read.
 *
 * ⚠️ `media.url` only. The rest of `media` carries the storage locator, and a
 * reorder response is no place to start handing that out.
 */
const describe = (entries) =>
  [...entries]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => ({
      id: entry._id,
      sortOrder: entry.sortOrder,
      url: entry.media?.url ?? null,
    }));
