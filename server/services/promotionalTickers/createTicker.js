const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");

const PromotionalTicker = require("../../models/PromotionalTicker");
const {
  uploadTickerIcon,
  deleteTickerIcon,
  toAdminTickerShape,
} = require("../../helpers/promotionalTickers");
const { describeIncoming } = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/** ⚠️ `actor` where it used to be a bare `userId` — see `createBanner`. */
exports.createTicker = async (actor, payload, files) => {
  const userId = actor.userId;
  const {
    title,
    redirect,
    displayOrder,
    startDate,
    endDate,
    isActive = true,
  } = payload;

  // Minted before the upload, because the object key carries it.
  const _id = new mongoose.Types.ObjectId();
  const icon = await uploadTickerIcon(
    actor,
    await describeIncoming(actor, {
      file: files?.icon,
      uploadId: payload.iconUploadId,
      purpose: UPLOAD_PURPOSE.TICKER_ICON,
    }),
    _id,
  );

  try {
    // ⚠️ Through the same whitelist the reads use. `create` hands back the
    // mongoose document, and returning that directly is how `icon.storage` got
    // out of the customer feed in the first place.
    const ticker = await PromotionalTicker.create({
      _id,
      title: toDisplayName(title),
      icon,
      redirect,
      displayOrder,
      startDate: startDate || null,
      endDate: endDate || null,
      isActive,
      createdBy: userId,
    });
    return toAdminTickerShape(ticker);
  } catch (error) {
    await deleteTickerIcon(icon);
    throw error;
  }
};
