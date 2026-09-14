const { assertImageFile } = require("./assertImageFile");
const {
  toMediaResponse,
  toMediaListResponse,
} = require("./toMediaResponse");
const { toMediaDocument, toDeletable } = require("./toMediaDocument");

module.exports = {
  assertImageFile,
  toMediaResponse,
  toMediaListResponse,
  toMediaDocument,
  toDeletable,
};
