const TICKER_REDIRECT_TYPE = {
  NONE: "NONE",
  CATEGORY: "CATEGORY",
  DEAL: "DEAL",
  BRAND: "BRAND",
  OFFER: "OFFER",
  EXTERNAL_URL: "EXTERNAL_URL",
};

const TICKER_SORT_BY = {
  CREATED_AT: "createdAt",
  DISPLAY_ORDER: "displayOrder",
  TITLE: "title",
};

const TICKER_ICON_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

module.exports = {
  TICKER_REDIRECT_TYPE,
  TICKER_SORT_BY,
  TICKER_ICON_ALLOWED_MIME_TYPES,
};
