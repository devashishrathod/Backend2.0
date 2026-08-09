const { create } = require("./create");
const { getAll } = require("./getAll");
const { get } = require("./get");
const { update } = require("./update");
const { getBrandShowcase } = require("./getBrandShowcase");
const { deleteSection } = require("./deleteSection");
const { getVideoClips } = require("./getVideoClips");
const { reorderSections } = require("./reorderSections");
//media
const { addMedia } = require("./addMedia");
const { updateMedia } = require("./updateMedia");
const { replaceMedia } = require("./replaceMedia");
const { deleteMedia } = require("./deleteMedia");
const { reorderMedia } = require("./reorderMedia");
module.exports = {
  create,
  getAll,
  get,
  update,
  getBrandShowcase,
  deleteSection,
  getVideoClips,
  reorderSections,
  addMedia,
  updateMedia,
  replaceMedia,
  deleteMedia,
  reorderMedia,
};
