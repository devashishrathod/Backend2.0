const { throwError } = require("../../utils");
const {
  buildCategoryStats,
  buildSubCategoryStats,
} = require("./buildTaxonomyStats");

/**
 * Refuse to soft-delete a category or sub-category that something still belongs
 * to.
 *
 * Before this, the delete always succeeded and left the children behind holding
 * a `categoryId` that resolves to nothing. Nothing errored — the brand listing
 * simply showed a blank category cell, and the admin who deleted it had no way
 * to know how much they had just orphaned.
 *
 * The check counts what **exists** (`isDeleted: false`), not what is active: an
 * inactive brand is still a brand pointing here, and it comes back the day
 * somebody switches it on.
 */

const phrase = (count, singular, plural) =>
  `${count} ${count === 1 ? singular : plural}`;

/**
 * Turn the non-zero counts into one sentence an admin can act on. The message
 * names every blocker and its size, because "cannot delete, in use" sends them
 * hunting through three listings to find out by how much.
 */
const refuse = (what, blockers) => {
  const live = blockers.filter(({ count }) => count > 0);
  if (!live.length) return;

  const parts = live.map(({ count, singular, plural }) =>
    phrase(count, singular, plural),
  );
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const isOne = live.length === 1 && live[0].count === 1;

  throwError(
    400,
    `Cannot delete this ${what} — ${listed} still ${isOne ? "uses" : "use"} it. Move or delete ${isOne ? "it" : "them"} first.`,
  );
};

/**
 * Promo codes are deliberately **not** a blocker.
 *
 * `PromoCode.categoryIds` is a scoping filter, not ownership — the promo code
 * exists on its own and merely narrows itself to some categories. Blocking a
 * category delete on one expired promo code from last season would strand the
 * admin with no obvious way forward, and the failure mode is mild: the deleted
 * id stops matching any voucher, so the code narrows to the categories that are
 * left.
 */
exports.assertCategoryDeletable = async (categoryId) => {
  const stats = (await buildCategoryStats([categoryId]))[String(categoryId)];
  if (!stats) return;

  refuse("category", [
    {
      count: stats.subCategories.total,
      singular: "sub-category",
      plural: "sub-categories",
    },
    { count: stats.brands.total, singular: "brand", plural: "brands" },
    { count: stats.vouchers.total, singular: "voucher", plural: "vouchers" },
  ]);
};

exports.assertSubCategoryDeletable = async (subCategoryId) => {
  const stats = (await buildSubCategoryStats([subCategoryId]))[
    String(subCategoryId)
  ];
  if (!stats) return;

  refuse("sub-category", [
    { count: stats.brands.total, singular: "brand", plural: "brands" },
    { count: stats.vouchers.total, singular: "voucher", plural: "vouchers" },
  ]);
};
