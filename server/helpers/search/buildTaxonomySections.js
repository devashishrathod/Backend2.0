const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const { pagination } = require("../../utils");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_TARGET_SCREENS,
} = require("../../constants/search");
const {
  buildCategoryStats,
  buildSubCategoryStats,
} = require("../taxonomy");
const { matchRankExpression } = require("./matchRank");
const { searchRegex } = require("./searchTerm");

/**
 * Categories and sub-categories matching the term.
 *
 * Both are tiny collections — a handful of rows each — so this is the cheapest
 * section by a wide margin and always runs, with or without coordinates.
 *
 * Neither is a detail page. Tapping one opens the voucher listing filtered to
 * it, which is why `target` points at `/vouchers/customer/get-all` rather than
 * at anything under `/categories`.
 */

const countsSubtitle = (stats, isCategory) => {
  if (!stats) return null;
  const parts = [];
  if (isCategory && stats.subCategories?.total) {
    const n = stats.subCategories.total;
    parts.push(`${n} sub-categor${n === 1 ? "y" : "ies"}`);
  }
  if (stats.brands?.total) {
    parts.push(`${stats.brands.total} brand${stats.brands.total === 1 ? "" : "s"}`);
  }
  if (stats.vouchers?.total) {
    parts.push(
      `${stats.vouchers.total} offer${stats.vouchers.total === 1 ? "" : "s"}`,
    );
  }
  return parts.join(" · ") || null;
};

const runTaxonomy = async ({ Model, entityName, term, normalized, page, limit }) => {
  const pipeline = [
    { $match: { isActive: true, isDeleted: false, name: searchRegex(term) } },
    {
      $project: {
        name: 1,
        description: 1,
        image: 1,
        categoryId: 1,
        matchRank: matchRankExpression("$name", normalized),
      },
    },
    { $sort: { matchRank: 1, name: 1, _id: 1 } },
  ];

  return pagination(Model, pipeline, page, limit, entityName, {
    allowEmpty: true,
  });
};

exports.buildCategorySection = async ({ term, normalized, page = 1, limit }) => {
  const result = await runTaxonomy({
    Model: Category,
    entityName: "category",
    term,
    normalized,
    page,
    limit,
  });

  // The same counts the category listing serves, so a search row and the
  // category page never disagree about how much is inside.
  const stats = await buildCategoryStats(result.data.map((row) => row._id));

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map((row) => {
      const rowStats = stats[String(row._id)];
      return {
        type: SEARCH_RESULT_TYPES.CATEGORY,
        id: row._id,
        title: row.name || null,
        subtitle: countsSubtitle(rowStats, true),
        image: row.image || null,
        meta: {
          description: row.description || null,
          subCategoryCount: rowStats?.subCategories?.total ?? 0,
          brandCount: rowStats?.brands?.total ?? 0,
          voucherCount: rowStats?.vouchers?.total ?? 0,
        },
        target: {
          screen: SEARCH_TARGET_SCREENS.CATEGORY_LISTING,
          endpoint: "/vouchers/customer/get-all",
          params: { categoryId: row._id },
        },
      };
    }),
    seeAll: {
      endpoint: "/categories/getAll",
      params: { search: term, isActive: true },
    },
  };
};

exports.buildSubCategorySection = async ({
  term,
  normalized,
  page = 1,
  limit,
}) => {
  const result = await runTaxonomy({
    Model: SubCategory,
    entityName: "subcategory",
    term,
    normalized,
    page,
    limit,
  });

  const stats = await buildSubCategoryStats(result.data.map((row) => row._id));

  return {
    total: result.total,
    totalPages: result.totalPages,
    items: result.data.map((row) => {
      const rowStats = stats[String(row._id)];
      return {
        type: SEARCH_RESULT_TYPES.SUB_CATEGORY,
        id: row._id,
        title: row.name || null,
        subtitle: countsSubtitle(rowStats, false),
        image: row.image || null,
        meta: {
          description: row.description || null,
          categoryId: row.categoryId || null,
          brandCount: rowStats?.brands?.total ?? 0,
          voucherCount: rowStats?.vouchers?.total ?? 0,
        },
        target: {
          screen: SEARCH_TARGET_SCREENS.SUB_CATEGORY_LISTING,
          endpoint: "/vouchers/customer/get-all",
          params: { subCategoryId: row._id },
        },
      };
    }),
    seeAll: {
      endpoint: "/subCategories/getAll",
      params: { search: term, isActive: true },
    },
  };
};
