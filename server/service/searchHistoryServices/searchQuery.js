const Deals = require("../../model/TodayOffer");
const Offers = require("../../model/DealOfCategory");
const Vouchers = require("../../model/Voucher");
const Brands = require("../../model/Brand");
const SubBrands = require("../../model/SubBrand");
const Location = require("../../model/Location");
const PromoCode = require("../../model/PromoCode");
const SuggestionAds = require("../../model/SuggestionAds");
const Categories = require("../../model/Category");
const SubCategories = require("../../model/SubCategory");
const SearchHistory = require("../../model/SearchHistory");

exports.searchQuery = async (tokenUserId, userId, q, page = 1, limit = 10) => {
  try {
    page = page ? parseInt(page) : 1;
    limit = limit ? parseInt(limit) : 10;
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;

    const regex = new RegExp(q, "i");
    const skip = (page - 1) * limit;

    const [
      todaysDeals,
      offers,
      vouchers,
      brands,
      subBrands,
      locations,
      promoCodes,
      suggestionAds,
      categories,
      subCategories,
    ] = await Promise.all([
      Deals.find({ title: regex }).limit(limit).skip(skip),
      Offers.find({ title: regex }).limit(limit).skip(skip),
      Vouchers.find({ title: regex }).limit(limit).skip(skip),
      Brands.find({ $or: [{ name: regex }, { companyName: regex }] })
        .limit(limit)
        .skip(skip),
      SubBrands.find({ $or: [{ name: regex }, { companyName: regex }] })
        .limit(limit)
        .skip(skip),
      Location.find({
        $or: [
          { city: regex },
          { state: regex },
          { shopOrBuildingNumber: regex },
          { street: regex },
          { zipCode: regex },
          { country: regex },
        ],
      })
        .limit(limit)
        .skip(skip),
      PromoCode.find({ $or: [{ title: regex }, { promoCode: regex }] })
        .limit(limit)
        .skip(skip),
      SuggestionAds.find({ title: regex }).limit(limit).skip(skip),
      Categories.find({ name: regex }).limit(limit).skip(skip),
      SubCategories.find({ name: regex }).limit(limit).skip(skip),
    ]);

    const userIdToUse = userId || tokenUserId;
    await SearchHistory.create({ userId: userIdToUse, query: q });

    const recentSearches = await SearchHistory.find({ userId: userIdToUse })
      .sort({ createdAt: -1 })
      .limit(10);

    const results = {
      todaysDeals,
      offers,
      vouchers,
      brands,
      subBrands,
      locations,
      promoCodes,
      suggestionAds,
      categories,
      subCategories,
    };
    return {
      query: q,
      results,
      recentSearches: recentSearches.map((r) => r.query),
    };
  } catch (err) {
    console.error("Error in global search:", err);
    throwError(400, err);
  }
};
