const { createSection } = require("./createSection");
const { getSection } = require("./getSection");
const { getAllSections } = require("./getAllSections");
const { updateSection } = require("./updateSection");
const { getBrandsAllShowcase } = require("./getBrandsAllShowcase");
const { getAllVideoClips } = require("./getAllVideoClips");
const { deleteFullSection } = require("./deleteFullSection");
const { reorderAllSections } = require("./reorderAllSection");
// media
const { addSectionMedia } = require("./addSectionMedia");
const { updateSectionMedia } = require("./updateSectionMedia");
const { replaceSectionMedia } = require("./replaceSectionMedia");
const { deleteSectionMedia } = require("./deleteSectionMedia");
const { reorderSectionMedia } = require("./reorderSectionMedia");

module.exports = {
  createSection,
  getSection,
  getAllSections,
  updateSection,
  getAllVideoClips,
  getBrandsAllShowcase,
  deleteFullSection,
  reorderAllSections,
  addSectionMedia,
  updateSectionMedia,
  replaceSectionMedia,
  deleteSectionMedia,
  reorderSectionMedia,
};
