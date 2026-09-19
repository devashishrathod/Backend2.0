const {
  uploadFile,
  deleteFile,
  destroyPublicId,
  getOptimizedImageUrl,
} = require("../../../helpers/cloudinary");
const {
  MEDIA_KIND,
  STORAGE_PROVIDER,
  UPLOAD_PURPOSE,
  CLOUDINARY_LEGACY_FOLDER,
} = require("../../../constants/storage");
const { cloudinaryFolder } = require("../keys");

/**
 * The Cloudinary provider.
 *
 * Everything Cloudinary-shaped lives behind this file: folders instead of keys,
 * `public_id` instead of a path, and `resource_type` — which is its own
 * vocabulary and does not match ours (an audio file is a "video", a PDF is
 * "raw").
 */

/** Our kind → Cloudinary's `resource_type`. */
const RESOURCE_TYPE = Object.freeze({
  [MEDIA_KIND.IMAGE]: "image",
  [MEDIA_KIND.GIF]: "image",
  [MEDIA_KIND.VIDEO]: "video",
  [MEDIA_KIND.AUDIO]: "video",
  [MEDIA_KIND.DOCUMENT]: "raw",
});

const resourceTypeFor = (kind) => RESOURCE_TYPE[kind] || "image";

/**
 * Where the file goes.
 *
 * `LEGACY` means a caller that has not been told its purpose yet — step A of
 * the migration. Those keep the historic folder names exactly, so step A moves
 * nothing that already exists.
 */
const folderFor = ({ purpose, entityId, kind }) => {
  if (purpose === UPLOAD_PURPOSE.LEGACY) {
    return CLOUDINARY_LEGACY_FOLDER[kind] || CLOUDINARY_LEGACY_FOLDER.IMAGE;
  }
  return cloudinaryFolder({ purpose, entityId, kind });
};

exports.upload = async ({
  filePath,
  purpose,
  entityId,
  kind,
  originalFile,
  publicId,
}) => {
  const options = {
    resource_type: resourceTypeFor(kind),
    folder: folderFor({ purpose, entityId, kind }),
  };
  // Documents are named, not uuid'd — a person looking for one invoice should
  // be able to find it.
  if (publicId) options.public_id = publicId;

  const result = await uploadFile(filePath, options);

  const isVideo = kind === MEDIA_KIND.VIDEO || kind === MEDIA_KIND.AUDIO;
  const delivery = isVideo
    ? result.secure_url
    : getOptimizedImageUrl(result.public_id);

  return {
    url: delivery,
    /**
     * 🔴 `thumbnail` used to be here, and it was wrong on a video.
     *
     * It returned `getOptimizedImageUrl(result.public_id)` for everything. On a
     * photo that is simply the delivery URL again — the same string twice. On a
     * **video** it builds an `/image/upload/` path for an asset that lives under
     * `/video/upload/`, so every poster this produced was a **404**. A real one
     * needs `resource_type: "video"` and `format: "jpg"`.
     *
     * Nothing derives a poster now, on either provider (M-7). A video's poster
     * is uploaded alongside it and stored in `mediaSchema.poster`, so there is
     * no field here for a caller to trust.
     */
    storage: {
      provider: STORAGE_PROVIDER.CLOUDINARY,
      publicId: result.public_id,
      bucket: null,
      key: null,
    },
    metadata: {
      originalName: originalFile?.name ?? null,
      mimeType: originalFile?.mimetype ?? null,
      format: result.format,
      size: result.bytes,
      width: result.width ?? null,
      height: result.height ?? null,
      duration: result.duration || 0,
    },
  };
};

/**
 * Delete, by id where there is one and by URL where there is not.
 *
 * 🔴 This is the L-2 fix. `deleteFile` decides what to delete by checking
 * whether the URL starts with `CLOUD_BASE_URL`, and returns `false` with a
 * `console.log` when it does not. Every row written since `storage` was added
 * carries a `public_id`, so the URL never needs to be parsed for those — and
 * for the ones that genuinely have nothing, saying so is the caller's decision
 * to make, not a line in a log.
 */
exports.remove = async ({ storage, url, kind }) => {
  const resourceType = resourceTypeFor(kind);

  if (storage?.publicId) {
    return destroyPublicId(storage.publicId, resourceType);
  }
  if (url) return deleteFile(url, resourceType);

  return false;
};

exports.url = ({ storage, url }) => {
  if (storage?.publicId) return getOptimizedImageUrl(storage.publicId);
  return url ?? null;
};
