// ⚠️ Straight from the module, not through `./index` — the barrel requires this
// file, so going back through it would be a cycle.
const { pickVoucherBanner } = require("./pickVoucherBanner");

/**
 * What a claim freezes about the voucher it was bought from (V-6c, V-12).
 *
 * ### 🔴 The picture was never in here
 *
 * The snapshot was `{ name, categoryId, subCategoryId }` — three fields, none of
 * them anything a person recognises. A customer opening "what did I buy in
 * September" got a row of text where the voucher's own tile should be, and that
 * was true long before delete existed. V-6 only made it louder: now the voucher
 * can be gone entirely, and the claim is the only thing left that remembers it.
 *
 * ### Why freeze it at all
 *
 * The same reason `brandSnapshot` and `outletSnapshot` are frozen: everything
 * the claim copies is editable afterwards. The vendor can replace the banner,
 * reorder the images, publish a new version, or delete the voucher — and a
 * receipt from September still has to read the way it read in September.
 *
 * ⚠️ **The files survive the voucher.** `deleteVoucher` is a soft delete and
 * removes nothing from storage, so these URLs keep resolving after the voucher
 * is gone. That is what makes freezing a URL honest here rather than a promise
 * we cannot keep.
 *
 * ### What is stored, and why each one
 *
 * `bannerUrl` is resolved through `pickVoucherBanner`, so it is **exactly what
 * the customer was looking at** when they tapped buy — including the `images[0]`
 * fallback when the voucher had no approved banner (V-4a). Reading the raw
 * `banner.current` instead would record a banner that customer never saw.
 *
 * `bannerThumbnail` and `bannerType` ride along because a VIDEO banner cannot be
 * painted without a poster. They are not decoration: without them a client has
 * to either guess or fetch the video to find out what it is.
 *
 * `imageUrl` is the voucher's own first image, kept **beside** the banner rather
 * than instead of it. When the banner was a real one the two differ, and the
 * history can show the product rather than the artwork; when it was the
 * fallback they are the same, which is the truth of that claim.
 *
 * ⚠️ Old claims have none of these fields. Every read is `?? null` — a client
 * gets "no image" rather than a blank tile, and nothing throws.
 *
 * @param {object} voucher  needs `name`, `categoryId`, `subCategoryId`, `banner`
 * @param {object} version  needs `images`
 * @returns {object} the `voucherSnapshot` value
 */
exports.buildVoucherSnapshot = (voucher, version) => {
  const images = Array.isArray(version?.images) ? version.images : [];

  /**
   * ⚠️ Sorted, not `images[0]`. The array's order is whatever Mongo stored it
   * in; `sortOrder` is what the vendor actually chose, and it is what the
   * customer's tile is built from.
   *
   * ⚠️ `.filter()` is also what keeps the caller's array safe — it returns a
   * new one, so the `.sort()` never reaches the document that is about to be
   * saved. This used to open with `[...images]` and a comment crediting the
   * spread for that; a mutation proved the spread changed nothing, because
   * `filter` had already made the copy.
   */
  const first = images
    .filter((entry) => entry?.media?.url)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];

  const banner = pickVoucherBanner(voucher?.banner, images);

  return {
    name: voucher?.name,
    categoryId: voucher?.categoryId,
    subCategoryId: voucher?.subCategoryId,
    bannerUrl: banner.bannerUrl ?? null,
    bannerThumbnail: banner.bannerThumbnail ?? null,
    bannerType: banner.bannerType ?? null,
    imageUrl: first?.media?.url ?? null,
  };
};
