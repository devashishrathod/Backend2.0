const PromotionalTicker = require("../../models/PromotionalTicker");
const { deleteTickerIcon } = require("../../helpers/promotionalTickers");
const { throwError } = require("../../utils");

exports.deleteTicker = async (userId, id) => {
  const ticker = await PromotionalTicker.findOne({ _id: id, isDeleted: false });
  if (!ticker) throwError(404, "Promotional ticker not found.");

  const icon = ticker.icon?.toObject ? ticker.icon.toObject() : ticker.icon;

  ticker.isDeleted = true;
  ticker.isActive = false;
  ticker.updatedBy = userId;
  /**
   * ⚠️ Deleting does not touch the icon, so it must not be blocked by
   * full-document validation. A row written before `icon` became a `mediaSchema`
   * has a `url` and a `storage` but no `kind`, which is now required — and
   * without this an admin could not delete exactly the stale rows they are
   * trying to clear out. Same reasoning as `deleteBanner`.
   */
  await ticker.save({ validateBeforeSave: false });

  // Same reasoning as `deleteBanner`: the row is soft-deleted but unreachable
  // for ever — no restore endpoint, and every read filters `isDeleted: false`.
  // Leaving the icon behind just pays for a file nothing can ever show.
  await deleteTickerIcon(icon);
};
