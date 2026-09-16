const ShowcaseSection = require("../../models/ShowcaseSection");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { getShowcaseConfig } = require("../settings");

/**
 * The write guards that keep a brand's showcase presentable (S-3).
 *
 * ### Why they live in one file
 *
 * The same two floors — `minItemsPerSection` and `minSectionsPerBrand` — apply
 * across nine services. Written at each call site they would drift: this domain
 * has already shipped a rule enforced in eight places and missing from the
 * ninth (`isShowInVideoClips`), which is why that one is now on the schema.
 *
 * ### 🔴 Admins are exempt, and that is the point
 *
 * These floors exist so a vendor does not make their own gallery disappear by
 * accident. An admin removing media is **moderating** — usually removing
 * something that should not be public — and a floor that blocks that would mean
 * the platform cannot take down content because taking it down would leave the
 * section too small. The floor protects the vendor from themselves; it must not
 * protect the content from the platform.
 *
 * ### The config read
 *
 * `getShowcaseConfig()` sits on the settings cache, so these are ordinary
 * function calls rather than a query per guard. Each guard loads it itself so a
 * call site is one line and cannot forget to pass it.
 */

const isAdmin = (actor) => actor?.role === ROLES.ADMIN;

/** Visible to a customer: not deleted, and not switched off by the vendor. */
const isVisibleMedia = (media) => Boolean(media?.isActive) && !media?.isDeleted;

exports.countVisibleMedia = (medias = []) => medias.filter(isVisibleMedia).length;

/**
 * Refuse a change that would drop a section below the media floor.
 *
 * Covers both ways a media stops being visible — deleted, or switched off —
 * because to a customer they are the same event and a rule that caught only one
 * of them would be a rule a vendor could walk around.
 *
 * ### ⚠️ A section already below the floor is not protected
 *
 * The plan's rule was "refuse when the visible count would fall below
 * `minItems`". Taken literally that traps a vendor: `minItems` is 3, their
 * section holds 2, and neither of those two can be removed — while the section
 * is **already** invisible to customers, so refusing protects nothing at all.
 *
 * 🔴 Worse, the escape the message offers is closed too. "Delete the whole
 * section instead" runs into `assertBrandKeepsASection`, and `minSectionsPerBrand`
 * cannot be set below 1. A brand whose only section holds two photos would have
 * had no legal move anywhere in the domain.
 *
 * So the guard fires only on the crossing: a section standing **at or above** the
 * floor that this write would push below it. That is the moment something real is
 * lost — a live section vanishing from the customer's view with no warning — and
 * it is the only moment the vendor can act on.
 *
 * @param {object} section        the loaded section document
 * @param {string} mediaId        the media being deleted or switched off
 * @param {object} actor          `{ role }` — admins are exempt
 * @param {number} statusCode     400 from a delete, 422 from an update
 */
exports.assertSectionKeepsItsFloor = async (
  section,
  { mediaId, actor, statusCode = 400 },
) => {
  if (isAdmin(actor)) return;

  const target = section.medias.id(mediaId);
  // Already gone or already hidden — this write changes no customer's view.
  if (!isVisibleMedia(target)) return;

  const { minItems } = await getShowcaseConfig();
  const before = exports.countVisibleMedia(section.medias);

  if (before < minItems) return;
  if (before - 1 >= minItems) return;

  throwError(
    statusCode,
    `A section needs at least ${minItems} visible media to stay on your profile. Add another one first, or delete the whole section.`,
  );
};

/**
 * Refuse deleting a brand's last section.
 *
 * ⚠️ `minSectionsPerBrand` has `min: 1` on the schema, so this cannot be turned
 * off — a brand always keeps one section. That is deliberate: a brand profile
 * with no gallery at all reads as an incomplete listing rather than a choice.
 *
 * Counted with a query rather than from anything already loaded, because the
 * caller only ever holds the one section it is about to delete.
 */
exports.assertBrandKeepsASection = async (brandId, { actor }) => {
  if (isAdmin(actor)) return;

  const { minSections } = await getShowcaseConfig();
  const remaining =
    (await ShowcaseSection.countDocuments({ brandId, isDeleted: false })) - 1;

  if (remaining >= minSections) return;

  throwError(
    400,
    minSections === 1
      ? "A brand needs at least one showcase section. Create another one before deleting this."
      : `A brand needs at least ${minSections} showcase sections. Create another one before deleting this.`,
  );
};

/**
 * Refuse hiding a brand's last section that customers can still see.
 *
 * 🔴 Checked on the **flags**, never on media counts.
 *
 * A count-based version is impossible, not merely awkward: a brand's first
 * section is created empty and media arrive afterwards, so "every brand must
 * always have one section with N visible media" is false the moment a brand
 * signs up. Any guard written that way would refuse the vendor's very first
 * action and have no way back.
 *
 * So this answers a narrower question that is always answerable — after this
 * write, is there still a section the vendor has switched on? — and leaves
 * whether it has enough media in it to `minItems` and the customer read (S-4).
 *
 * @param {object} section    the section being switched off
 * @param {object} payload    the update payload, read for the two flags
 */
exports.assertBrandKeepsAVisibleSection = async (section, { payload, actor }) => {
  if (isAdmin(actor)) return;

  const hidingIt =
    payload.isVisible === false || payload.isActive === false;
  if (!hidingIt) return;

  // Already off — turning off the other flag as well changes nothing.
  if (!section.isVisible || !section.isActive) return;

  const othersOn = await ShowcaseSection.countDocuments({
    _id: { $ne: section._id },
    brandId: section.brandId,
    isDeleted: false,
    isVisible: true,
    isActive: true,
  });

  if (othersOn > 0) return;

  throwError(
    422,
    "This is the last section customers can see on your profile. Show another one before hiding this.",
  );
};
