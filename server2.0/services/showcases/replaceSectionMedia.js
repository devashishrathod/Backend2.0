const ShowcaseSection = require("../../models/ShowcaseSection");
const { throwError } = require("../../utils");
const { getShowcaseConfig } = require("../../helpers/settings");
const {
  resolveSectionForActor,
} = require("../../helpers/showcases");
//const { validateVendorBrand } = require("../../helpers/showcase/common");
const {
  normalizeFiles,
  validateMediaFiles,
  uploadSingleMedia,
  rollbackUploads,
  deleteMedia,
} = require("../../helpers/showcases");

exports.replaceSectionMedia = async (actor, payload, file) => {
  await resolveSectionForActor(actor, payload.sectionId, {
    projection: { brandId: 1 },
  });

  // const brand = await validateVendorBrand(userId);
  const section = await ShowcaseSection.findOne(
    {
      _id: payload.sectionId,
      "medias._id": payload.mediaId,
      isDeleted: false,
    },
    {
      coverImage: 1,
      medias: { $elemMatch: { _id: payload.mediaId } },
    },
  );

  if (!section || !section.medias.length) throwError(404, "Media not found.");

  const oldMedia = section.medias[0];
  if (!oldMedia.isActive || oldMedia.isDeleted) {
    throwError(404, "Media not found.");
  }

  const uploadedFiles = normalizeFiles(file);

  if (uploadedFiles.length !== 1) {
    throwError(400, "Please upload exactly one media file.");
  }

  const config = await getShowcaseConfig();
  validateMediaFiles(uploadedFiles, config);
  let uploaded = null;
  try {
    uploaded = await uploadSingleMedia(uploadedFiles[0]);
    const update = {
      "medias.$.type": uploaded.type,
      "medias.$.url": uploaded.url,
      "medias.$.thumbnail": uploaded.thumbnail,
      "medias.$.storage": uploaded.storage,
      "medias.$.metadata": uploaded.metadata,
      "medias.$.updatedAt": new Date(),
    };
    if (section.coverImage === oldMedia.thumbnail) {
      update.coverImage = uploaded.thumbnail;
    }
    if (oldMedia.type !== uploaded.type) {
      await rollbackUploads([uploaded]);
      throwError(
        400,
        `Only ${oldMedia.type.toLowerCase()} replacement is allowed.`,
      );
    }
    const result = await ShowcaseSection.updateOne(
      {
        _id: payload.sectionId,
        "medias._id": payload.mediaId,
        isDeleted: false,
      },
      { $set: update },
    );
    if (!result.modifiedCount) {
      await rollbackUploads([uploaded]);
      throwError(500, "Failed to replace media.");
    }
    try {
      await deleteMedia(oldMedia);
    } catch (err) {
      console.error("Old media delete failed:", err.message);
    }
    return {
      ...oldMedia.toObject(),
      type: uploaded.type,
      url: uploaded.url,
      thumbnail: uploaded.thumbnail,
      storage: uploaded.storage,
      metadata: uploaded.metadata,
      updatedAt: new Date(),
    };
  } catch (err) {
    if (uploaded) {
      await rollbackUploads([uploaded]);
    }
    console.error("Replace section media error:", err.message);
    throwError(500, err.message || "Failed to replace media");
  }
};
