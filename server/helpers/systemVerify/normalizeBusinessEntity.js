exports.normalizeBusinessEntity = (entity = "") => {
  return entity.toUpperCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
};
