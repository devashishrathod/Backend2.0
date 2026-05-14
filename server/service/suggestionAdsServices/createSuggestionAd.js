const SuggestionAd = require("../../model/SuggestionAds");
const Voucher = require("../../model/Voucher");
const { throwError } = require("../../utils");
const { OFFERS_SCOPE } = require("../../constants");
const { uploadImage } = require("../uploadServices");
const { generateUniqueSuggestionId } = require("./generateUniqueSuggestionId");

exports.createSuggestionAd = async (voucherId, image, payload) => {
  let {
    scope,
    status,
    users,
    states,
    cities,
    title,
    description,
    discountTitle,
  } = payload;

  const linkedVoucher = await Voucher.findById(voucherId);
  if (!linkedVoucher) throwError(404, "Voucher not found");
  if (!linkedVoucher.isActive || linkedVoucher.isDeleted)
    throwError(400, "Linked voucher is not active");

  if (!states || !cities) {
    throwError(400, "States or cities are required");
  }
  states = JSON.parse(states);
  cities = JSON.parse(cities);

  users = users ? JSON.parse(users) : [];
  const finalUsers = scope === OFFERS_SCOPE.ALL_USERS ? [] : users;
  const publishedDate = linkedVoucher?.validFrom;
  const isActive = publishedDate <= new Date();
  const endDate = linkedVoucher.validTill;
  const originalPrice = linkedVoucher.minOrderAmount || 0;
  let discountPrice = originalPrice;
  if (linkedVoucher.discount && originalPrice > 0) {
    discountPrice =
      originalPrice - (originalPrice * linkedVoucher.discount) / 100;
  }
  const imageUrl = await uploadImage(image.tempFilePath);
  const suggestionData = {
    voucher: voucherId,
    users: finalUsers,
    states: states,
    cities: cities,
    scope,
    status,
    title,
    description,
    discountTitle: discountTitle || `Upto ${linkedVoucher.discount}% OFF`,
    originalPrice,
    discountPrice,
    publishedDate,
    endDate,
    valueOfAmount: linkedVoucher.discount,
    uniqueId: await generateUniqueSuggestionId(),
    image: imageUrl,
    isActive,
  };
  return await SuggestionAd.create(suggestionData);
};
