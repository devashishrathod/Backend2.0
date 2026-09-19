const PromotionalTicker = require("../../models/PromotionalTicker");
const { BANNER_REDIRECT_TYPE } = require("../../constants/banner");

/**
 * The strip renders an icon, a line of text and a tap target. Nothing else.
 *
 * 🔴 This endpoint used to return the whole document — `find(...)` with no
 * projection and no mapper — on a route with **no authentication at all**
 * (`router.get("/customer/active", getActiveForCustomer)`). So every caller,
 * signed in or not, was handed `icon.storage`: the Cloudinary `publicId`, or
 * the S3 `bucket` and `key`. That is the name and location of the file, given
 * away for free.
 *
 * It also shipped `isDeleted`, `createdBy`, `updatedBy` and both timestamps —
 * the admin's own bookkeeping, on a public screen.
 *
 * The banner endpoint next door has done this correctly since it was written
 * (`getActiveBannersForCustomer`), which is the shape this follows: a strict
 * whitelist, so a field added to the model tomorrow cannot leak by default.
 *
 * ⚠️ `startDate` / `endDate` are deliberately absent. The query below has
 * already decided what is live; sending the schedule as well only invites a
 * client to decide it a second time, differently.
 */
const toCustomerShape = (ticker) => ({
  _id: ticker._id,
  title: ticker.title,
  /**
   * Flat, like the banner's `url`. The stored shape is `{ url, storage }` and
   * only the URL is any of the customer's business — so the nesting existed
   * purely to carry the half that may not be sent.
   */
  icon: ticker.icon?.url ?? null,
  redirect: {
    type: ticker.redirect?.type || BANNER_REDIRECT_TYPE.NONE,
    targetId: ticker.redirect?.targetId ?? null,
    url: ticker.redirect?.url ?? null,
  },
  displayOrder: ticker.displayOrder ?? 0,
});

exports.getActiveTickersForCustomer = async () => {
  const now = new Date();

  const tickers = await PromotionalTicker.find({
    isActive: true,
    isDeleted: false,
    $or: [
      { startDate: { $lte: now }, endDate: { $gte: now } },
      { startDate: null, endDate: null },
    ],
  })
    .sort({ displayOrder: 1 })
    // Only the fields the shape above reads. The whitelist is the guard; this
    // is why it has nothing to strip.
    .select("title icon.url redirect displayOrder")
    .lean();

  return tickers.map(toCustomerShape);
};
