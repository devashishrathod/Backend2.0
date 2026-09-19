const PromotionalTicker = require("../../models/PromotionalTicker");
const { toDisplayName } = require("../../helpers/common");
const { throwError } = require("../../utils");
const {
  uploadTickerIcon,
  deleteTickerIcon,
  toAdminTickerShape,
} = require("../../helpers/promotionalTickers");
const { describeIncoming } = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/** ⚠️ `actor` where it used to be a bare `userId` — see `createBanner`. */
exports.updateTicker = async (actor, id, payload, files) => {
  const userId = actor.userId;
  const ticker = await PromotionalTicker.findOne({ _id: id, isDeleted: false });
  if (!ticker) throwError(404, "Promotional ticker not found.");

  let newIcon = null;
  const incoming = await describeIncoming(actor, {
    file: files?.icon,
    uploadId: payload.iconUploadId,
    purpose: UPLOAD_PURPOSE.TICKER_ICON,
  });
  if (incoming) newIcon = await uploadTickerIcon(actor, incoming, ticker._id);

  const previousIcon = ticker.icon?.toObject
    ? ticker.icon.toObject()
    : ticker.icon;

  if (payload.title !== undefined) ticker.title = toDisplayName(payload.title);
  if (payload.redirect !== undefined) ticker.redirect = payload.redirect;
  if (payload.displayOrder !== undefined)
    ticker.displayOrder = payload.displayOrder;
  if (Object.prototype.hasOwnProperty.call(payload, "startDate")) {
    ticker.startDate = payload.startDate || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "endDate")) {
    ticker.endDate = payload.endDate || null;
  }
  if (typeof payload.isActive === "boolean") ticker.isActive = payload.isActive;
  if (newIcon) ticker.icon = newIcon;
  ticker.updatedBy = userId;

  try {
    await ticker.save();
  } catch (error) {
    if (newIcon) await deleteTickerIcon(newIcon);
    throw error;
  }

  if (newIcon) await deleteTickerIcon(previousIcon);

  return toAdminTickerShape(ticker);
};
