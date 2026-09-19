const { assertImageFile } = require("./assertImageFile");
const {
  toMediaResponse,
  toMediaListResponse,
} = require("./toMediaResponse");
const { toMediaDocument, toDeletable } = require("./toMediaDocument");
const { discardOnFailure } = require("./discardOnFailure");

module.exports = {
  assertImageFile,
  toMediaResponse,
  toMediaListResponse,
  toMediaDocument,
  toDeletable,
  discardOnFailure,
};
