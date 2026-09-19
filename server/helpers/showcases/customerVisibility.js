const {
  SHOWCASE_VISIBILITY_REASON,
} = require("../../constants/showcase");
const { getShowcaseConfig } = require("../settings");

/**
 * Why a section is — or is not — on a customer's screen (S-5, S-8).
 *
 * ### 🔴 Why this exists at all
 *
 * S-4 made a section disappear from every customer surface when it holds fewer
 * than `minItemsPerSection` visible media. That is the right rule and it is also
 * an invisible one: nothing about the vendor's own list changes, no write
 * happens, nothing is logged. A vendor whose album stopped appearing had no way
 * to find out why — and the most common cause is the most innocent one, a
 * section they created a minute ago and have added two photos to.
 *
 * Two of the three reasons are switches the vendor themselves flipped, so a
 * panel could in principle work them out. The third cannot be worked out at all
 * without knowing a number that lives in an admin setting. Answering all three
 * together is what makes the field usable: the panel renders one line and does
 * not have to reimplement the rule — which is how the rule drifts.
 *
 * ### ⚠️ Derived on every read, never stored
 *
 * There is no `isLive` column and there must not be one. It would be a second
 * source of truth for something already decided by four fields and a setting,
 * and it would go stale the moment an admin changed `minItemsPerSection` — which
 * changes the answer for every section on the platform without touching a single
 * document. The customer read (`customerSectionMatch`) computes the same thing
 * the same way, so the two cannot disagree.
 *
 * ### What is deliberately not a reason
 *
 * `isDeleted`. Both managed reads filter deleted sections out before this runs,
 * so a `DELETED` reason could never be returned — a value that cannot occur is
 * worse than no value, because clients write branches for it.
 */

/**
 * Visible to a customer: not deleted, and not switched off by the vendor.
 *
 * ⚠️ This is the JS twin of `visibleMediaCondition` in `projections.js`, which
 * says the same thing as an aggregation expression. Two forms are unavoidable —
 * one runs in Mongo, one in Node — but they must stay in step: the write guards,
 * this field, and the customer pipeline all have to agree on which media count,
 * or the platform refuses a delete for a section it then reports as live.
 */
exports.isVisibleMedia = (media) =>
  Boolean(media?.isActive) && !media?.isDeleted;

exports.countVisibleMedia = (medias = []) =>
  medias.filter(exports.isVisibleMedia).length;

/**
 * @param {object} section  `{ isActive, isVisible }` plus either `medias` or a
 *                          precomputed `visibleMediaCount`
 * @param {object} config   `{ minItems }` — pass it in when describing many
 *                          sections, so the settings cache is read once
 * @returns {{ isLive: boolean, reasons: string[], visibleMediaCount: number,
 *             minItemsRequired: number }}
 */
exports.describeCustomerVisibility = (section = {}, { minItems }) => {
  const visibleMediaCount = Number.isFinite(section.visibleMediaCount)
    ? section.visibleMediaCount
    : exports.countVisibleMedia(section.medias);

  const reasons = [];

  /**
   * Order matters: it is the order a panel will render them in, and the two
   * switches come first because they are the ones the vendor can undo with a
   * single toggle. The media floor is last because fixing it means uploading.
   */
  if (section.isVisible === false) {
    reasons.push(SHOWCASE_VISIBILITY_REASON.HIDDEN);
  }
  if (section.isActive === false) {
    reasons.push(SHOWCASE_VISIBILITY_REASON.INACTIVE);
  }
  if (visibleMediaCount < minItems) {
    reasons.push(SHOWCASE_VISIBILITY_REASON.NOT_ENOUGH_MEDIA);
  }

  return {
    isLive: reasons.length === 0,
    /**
     * ⚠️ **Every** failing reason, not the first one.
     *
     * A section can be hidden *and* short of media, and telling the vendor about
     * one of those sends them to fix it and find nothing changed. The panel can
     * show one line if it wants to; it cannot invent the reasons it was not told.
     */
    reasons,
    // The two numbers a message needs, so the panel never has to fetch settings
    // to say "2 of 3".
    visibleMediaCount,
    minItemsRequired: minItems,
  };
};

/**
 * Stamp `customerVisibility` onto a list of sections, in place.
 *
 * ⚠️ One settings read for the whole list. `describeCustomerVisibility` takes the
 * config rather than loading it so that listing fifty sections does not become
 * fifty cache lookups — cheap each, but the kind of thing that quietly becomes a
 * per-row query the first time someone changes the cache.
 */
exports.attachCustomerVisibility = async (sections = []) => {
  const { minItems } = await getShowcaseConfig();

  sections.forEach((section) => {
    section.customerVisibility = exports.describeCustomerVisibility(section, {
      minItems,
    });
  });

  return sections;
};
