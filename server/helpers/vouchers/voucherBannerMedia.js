const storage = require("../../services/storage");
const {
  UPLOAD_PURPOSE,
  MEDIA_KIND,
  kindFromMime,
} = require("../../constants/storage");
const {
  VOUCHER_BANNER_FILE_FIELD,
  VOUCHER_BANNER_POSTER_FIELD,
} = require("../../constants/voucherBanner");
const { toMediaDocument } = require("../media");
const { getStorageConfig } = require("../settings");
const { throwError } = require("../../utils");

/**
 * Upload a voucher's banner, and a video's poster with it.
 *
 * ### 🔴 There is no `type` parameter any more (V-4)
 *
 * It used to take the declared `VOUCHER_BANNER_TYPE` and check the file against
 * a per-type mime list — so the caller told the platform what the file was, and
 * the platform checked whether it agreed. Two answers to one question, and the
 * stored one could win. `kindFromMime` reads the bytes' own answer, which is
 * what `media.kind` has recorded since M-5 and what routes a GIF to `gifs/`,
 * clear of the resize step that would flatten it.
 *
 * ### 🔴 A video banner arrives with its poster or it does not arrive
 *
 * `mediaSchema` makes the poster mandatory on a VIDEO, so a missing one fails at
 * `save()` — after the video bytes are already uploaded and paid for. Refusing
 * here costs nothing and names the form field the caller has to add.
 *
 * Posters are never derived, on either provider: Cloudinary's
 * `getOptimizedImageUrl(publicId)` builds an `/image/upload/` path for an asset
 * that lives under `/video/upload/` (a 404), and S3 produces none at all.
 *
 * ### ⚠️ It takes **descriptions**, not files (U-4)
 *
 * `item` is what `describeIncoming` answered: `{ name, mimetype, size }` plus
 * exactly one of `file` or `uploadId`. Both roads produce the same shape, so
 * every rule below reads the same fields it always did.
 *
 * @param actor       whose upload it is — the facade looks an intent up by id
 *                    **and** owner, so a signed permission is not transferable
 * @param file        the banner's description — `{ name, mimetype, size }` plus
 *                    one of `file` or `uploadId`
 * @param voucherId   goes into the object key — see `helpers/banners/media.js`
 * @param posterFile  the same shape, required when the banner is a video
 * @returns {Promise<object>} a `mediaSchema` value
 */
exports.uploadVoucherBannerMedia = async (actor, file, voucherId, posterFile) => {
  if (!file) {
    throwError(
      422,
      `Please attach the banner file as "${VOUCHER_BANNER_FILE_FIELD}".`,
    );
  }

  const kind = kindFromMime(file.mimetype);
  const config = await getStorageConfig();

  /**
   * ⚠️ A banner may be a still, a GIF or a video — and nothing else. The lists
   * and the ceilings are the **global** ones, not a voucher-specific copy: there
   * is nothing about a banner that needs a different limit from every other file
   * of the same kind, and two numbers answering one question is only safe when
   * it is written down which wins.
   */
  const allowedKinds = [MEDIA_KIND.IMAGE, MEDIA_KIND.GIF, MEDIA_KIND.VIDEO];
  if (!allowedKinds.includes(kind)) {
    throwError(
      422,
      `A voucher banner has to be an image, a GIF or a video — "${file.mimetype || "no content type"}" is none of those.`,
    );
  }

  assertAllowed(file, kind, config);
  assertWithinSize(file, kind, config);

  const isVideo = kind === MEDIA_KIND.VIDEO;
  if (isVideo && !posterFile) {
    throwError(
      422,
      `A video banner needs a poster image. Attach one as "${VOUCHER_BANNER_POSTER_FIELD}".`,
    );
  }

  if (posterFile) {
    const posterKind = kindFromMime(posterFile.mimetype);
    if (posterKind !== MEDIA_KIND.IMAGE) {
      throwError(
        422,
        `The poster has to be a still image — "${posterFile.mimetype || "unknown"}" is not one.`,
      );
    }
    assertAllowed(posterFile, posterKind, config, "poster");
    assertWithinSize(posterFile, posterKind, config, "poster");
  }

  const uploaded = await storage.acceptUpload(actor, {
    file: file.file,
    uploadId: file.uploadId,
    purpose: UPLOAD_PURPOSE.VOUCHER_BANNER,
    entityId: voucherId,
  });

  let poster;
  if (isVideo) {
    /**
     * 🔴 `VOUCHER_BANNER_POSTER`, not `VOUCHER_BANNER` — a fix, not a
     * translation.
     *
     * Same bucket, same `vouchers/<id>` prefix, so nothing moves. What differs
     * is the allowance: a poster is capped at 10 MB and refuses VIDEO outright,
     * which is right for a still. This path sent it as `VOUCHER_BANNER` and
     * bought it the banner's 50 MB.
     *
     * On the presigned road the purpose is also the **only** thing telling the
     * two apart — share it and the ids become interchangeable, which means the
     * tighter of the two rules is the one a caller can skip.
     */
    const uploadedPoster = await storage.acceptUpload(actor, {
      file: posterFile.file,
      uploadId: posterFile.uploadId,
      purpose: UPLOAD_PURPOSE.VOUCHER_BANNER_POSTER,
      entityId: voucherId,
    });

    // ⚠️ The video is already in the bucket if this fails. No row points at it
    // until both halves exist, so nothing would ever reference it.
    if (!uploadedPoster?.url) {
      await exports.deleteVoucherBannerMedia(toMediaDocument(uploaded, { kind }));
      throwError(502, "The poster could not be uploaded. Please try again.");
    }

    poster = {
      url: uploadedPoster.url,
      storage: uploadedPoster.storage,
      width: uploadedPoster.metadata?.width ?? null,
      height: uploadedPoster.metadata?.height ?? null,
    };
  }

  return toMediaDocument(uploaded, { kind, poster });
};

/** The mime has to be one this platform accepts for that kind. */
const assertAllowed = (file, kind, config, label = "banner") => {
  const allowed = config.allowedTypes?.[kind] || [];
  if (allowed.includes(file.mimetype)) return;

  throwError(
    422,
    `${file.name || `The ${label}`} is not a supported format — expected one of: ${allowed.join(", ")}.`,
  );
};

/**
 * 🔴 The banner had **no size check at all** — the same gap voucher images
 * carried (P12), on the one file that is most likely to be a video.
 *
 * Mime was checked and then a 300 MB `.mp4` went straight through: uploaded,
 * paid for, and served at the top of the voucher card. Silent when the config
 * carries no ceiling, so a missing setting cannot refuse every upload.
 */
const assertWithinSize = (file, kind, config, label = "banner") => {
  const limit = config.maxBytes?.[kind];
  const size = Number(file?.size);
  if (!Number.isFinite(limit) || !Number.isFinite(size) || size <= limit) return;

  const capMB = config.maxSizeMB?.[kind] ?? Math.round(limit / (1024 * 1024));
  throwError(
    422,
    `${file.name || `The ${label}`} exceeds the maximum size of ${capMB} MB.`,
  );
};

/**
 * Delete a voucher banner's file, and its poster if it had one.
 *
 * ⚠️ Deletes through the stored `storage`, not the URL.
 *
 * The row has carried a `storage` object since the field was added, and going
 * via the URL meant `deleteFile` had to recognise the host before it would act
 * — so an S3 URL was skipped with a `console.log` and the file stayed.
 */
exports.deleteVoucherBannerMedia = async (media) => {
  try {
    if (!media?.url && !media?.storage) return;

    const targets = [media, media.poster].filter(
      (target) => target?.url || target?.storage,
    );
    if (targets.length) await storage.deleteAssets(targets);
  } catch (error) {
    console.error("Failed to delete voucher banner media:", error.message);
  }
};
