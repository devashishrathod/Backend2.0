const path = require("path");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const { MEDIA_KIND, kindFromMime } = require("../../constants/storage");
const { throwError } = require("../../utils");

exports.normalizeFiles = (files) => {
  if (!files) return [];
  return Array.isArray(files) ? files : [files];
};

exports.validateFilesExist = (files) => {
  if (!files.length) {
    throwError(400, "Please upload at least one image or video.");
  }
};

exports.countImages = (files = []) => {
  return files.filter((file) => file.mimetype.startsWith("image")).length;
};

exports.countVideos = (files = []) => {
  return files.filter((file) => file.mimetype.startsWith("video")).length;
};

/**
 * The file's name, without its extension — the default title and alt text.
 *
 * ⚠️ Capped, because it becomes a **stored field with its own limit**. The
 * update endpoint refuses a title over 100 characters and alt text over 150, and
 * this path writes them directly: a 300-character filename produced a media the
 * vendor could look at and not edit, because every save of it was refused for a
 * value they never typed.
 *
 * `path.parse` also drops any directory part, so a name like
 * `../../etc/passwd.png` becomes `passwd`.
 */
const TITLE_MAX = 100;

exports.getFileNameWithoutExtension = (fileName) => {
  if (!fileName) return "";
  return path.parse(fileName).name.trim().slice(0, TITLE_MAX);
};

exports.validateMediaFiles = (
  files,
  config,
  existingImages = 0,
  existingVideos = 0,
) => {
  exports.validateFilesExist(files);
  if (!config) {
    throwError(500, "Showcase configuration not found.");
  }
  const newImages = exports.countImages(files);
  const newVideos = exports.countVideos(files);
  const totalImages = existingImages + newImages;
  const totalVideos = existingVideos + newVideos;
  const totalItems = totalImages + totalVideos;
  if (totalItems > config.maxItems) {
    throwError(
      400,
      `Maximum ${config.maxItems} media items are allowed in one section.`,
    );
  }
  if (totalImages > config.maxImages) {
    throwError(400, `Maximum ${config.maxImages} images are allowed.`);
  }
  if (totalVideos > config.maxVideos) {
    throwError(400, `Maximum ${config.maxVideos} videos are allowed.`);
  }
  for (const file of files) {
    const mime = file.mimetype;
    if (mime.startsWith("image")) {
      if (!config.allowedImages.includes(mime)) {
        throwError(400, `${file.name} image format is not supported.`);
      }
      /**
       * ⚠️ A GIF is metered against its own ceiling (S-1).
       *
       * It is an `image/*` type, so it lands in this branch — but an animated
       * GIF stores every frame whole and routinely outweighs a photograph of
       * the same picture several times over. Holding it to `maxImageSizeMB`
       * would refuse ordinary GIFs while `allowedImages` claims to accept them:
       * a format the platform says is supported and in practice is not.
       *
       * The word in the message follows the limit, so a vendor is told which
       * number they are up against rather than a number that is not the one
       * being applied.
       */
      const isGif = kindFromMime(mime) === MEDIA_KIND.GIF;
      const cap = isGif ? config.maxGifSizeMB : config.maxImageSizeMB;
      const label = isGif ? "GIF" : "image";

      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > cap) {
        throwError(
          400,
          `${file.name} exceeds maximum ${label} size of ${cap} MB.`,
        );
      }
    } else if (mime.startsWith("video")) {
      if (!config.allowedVideos.includes(mime)) {
        throwError(400, `${file.name} video format is not supported.`);
      }
      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > config.maxVideoSizeMB) {
        throwError(
          400,
          `${file.name} exceeds maximum video size of ${config.maxVideoSizeMB} MB.`,
        );
      }
    } else {
      throwError(400, `${file.name} is not a supported media file.`);
    }
  }
};

/**
 * A replacement video poster.
 *
 * Went unvalidated entirely: any file the vendor attached as `thumbnail` was
 * pushed to Cloudinary and stored, so a 40 MB TIFF — or a video — could end up
 * as a section's poster frame.
 */
exports.validateThumbnailFile = (file, config) => {
  if (!file) throwError(400, "Thumbnail file is required.");
  if (!config) throwError(500, "Showcase configuration not found.");

  const mime = file.mimetype || "";
  if (!mime.startsWith("image") || !config.allowedImages.includes(mime)) {
    throwError(400, "Thumbnail must be an image in a supported format.");
  }

  const sizeMB = file.size / 1024 / 1024;
  if (sizeMB > config.maxImageSizeMB) {
    throwError(
      400,
      `Thumbnail exceeds maximum image size of ${config.maxImageSizeMB} MB.`,
    );
  }
};

/**
 * Turn freshly uploaded assets into media subdocuments.
 *
 * `isShowInVideoClips` is a VIDEO-only switch, so a photo is always stored with
 * it off. It used to be stamped onto every row, which left photos carrying a
 * `true` that nothing could ever act on — and a toggle in the vendor panel that
 * did nothing.
 */
exports.prepareMediaDocuments = (
  medias = [],
  startSort = 1,
  isShowInVideoClips = true,
) => {
  return medias.map((media, index) => ({
    // ⚠️ The whole `mediaSchema` value goes in as one field. It used to be
    // unpacked into `type` / `url` / `thumbnail` / `storage` / `metadata`, which
    // is how a gallery item ended up carrying the platform's only per-surface
    // copy of file metadata.
    media,
    title: exports.getFileNameWithoutExtension(media.originalName),
    altText: exports.getFileNameWithoutExtension(media.originalName),
    sortOrder: startSort + index,
    isShowInVideoClips:
      media.kind === MEDIA_KIND.VIDEO ? isShowInVideoClips : false,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
  }));
};

exports.getExistingMediaCounts = (medias = []) => {
  return medias.reduce(
    (result, item) => {
      if (item.isDeleted) {
        return result;
      }
      // Counted by what the file **is**, not by a stored label beside it. A GIF
      // counts against the image ceiling, which is what a vendor expects.
      if (item.media?.kind === MEDIA_KIND.VIDEO) {
        result.videos++;
      } else if (item.media?.kind) {
        result.images++;
      }
      return result;
    },
    {
      images: 0,
      videos: 0,
    },
  );
};

/**
 * Where the next media goes.
 *
 * 🔴 Counted, not measured from the highest number in the array.
 *
 * `max(sortOrder) + 1` counted **deleted** rows, because their `sortOrder` stays
 * where it was (S-5 — zeroing it would collide with the schema default). So a
 * section that had eight photos and now has two handed the next upload position
 * 9, and the panel showed `1, 2, 9`. Delete enough and the numbers drift for
 * ever, which is the state a lot of live sections are already in.
 *
 * The stored order is dense 1..n over **non-deleted** media (S-12 — hidden ones
 * included, so switching one back on keeps its place), and this is the other half
 * of that: the next position is simply one past the count.
 *
 * ⚠️ Correct only while the invariant holds. `resequenceMedias` is what keeps it
 * holding, and it runs on every delete — see the note there about `$push`.
 */
exports.getNextMediaSortOrder = (medias = []) =>
  medias.filter((media) => !media.isDeleted).length + 1;

/**
 * Renumber a section's media dense 1..n, in place.
 *
 * Deleted rows keep the number they had and are not counted (S-5, S-12): they
 * are an audit trail, and a deleted row at `sortOrder: 0` would sit in front of
 * everything the moment somebody sorted the raw array.
 *
 * Order is taken from the positions already stored, so this only ever closes
 * gaps — it never reshuffles what the vendor arranged. Ties keep their array
 * order, which makes the result of two media sharing a position deterministic
 * rather than dependent on the sort implementation.
 *
 * @param {Array} medias a Mongoose DocumentArray, mutated in place
 * @returns {boolean} whether anything actually moved
 */
exports.resequenceMedias = (medias = []) => {
  const live = medias
    .map((media, index) => ({ media, index }))
    .filter(({ media }) => !media.isDeleted)
    .sort(
      (a, b) =>
        (a.media.sortOrder || 0) - (b.media.sortOrder || 0) || a.index - b.index,
    );

  let moved = false;
  live.forEach(({ media }, position) => {
    if (media.sortOrder !== position + 1) {
      media.sortOrder = position + 1;
      moved = true;
    }
  });
  return moved;
};


/**
 * The displayable image for one gallery item.
 *
 * 🔴 A video answers its **poster**, and nothing else — never the `.mp4`.
 *
 * This used to be `thumbnail || url`, and the fallback was the bug: on S3 no
 * poster was ever produced, so the moment a video sorted to the top of a section
 * its `coverImage` became a video file, and every card rendering it showed a
 * broken image. The old comment in the S3 provider claimed a missing thumbnail
 * made the cover "fall through to the next visible media" — it did not.
 *
 * A poster is mandatory on a VIDEO now, so the `||` has nothing left to do; if
 * one is somehow missing, `null` is the honest answer and the caller can fall
 * back deliberately rather than by accident.
 */
exports.getMediaCoverImage = (item) => {
  const media = item?.media;
  if (!media) return null;
  if (media.kind === MEDIA_KIND.VIDEO) return media.poster?.url ?? null;
  return media.url ?? null;
};

/** The first visible media of a section, in display order. */
exports.pickCoverMedia = (medias = []) => {
  let cover = null;
  for (const media of medias) {
    if (media.isDeleted || !media.isActive) continue;
    if (!cover || media.sortOrder < cover.sortOrder) cover = media;
  }
  return cover;
};

/**
 * Recompute a section's cover from its media, in place.
 *
 * Honours `coverImageMode`: MANUAL means the vendor pinned a cover, so add /
 * delete / reorder must leave it alone. The field existed on the model but
 * nothing read it, so a manual cover was silently overwritten by the next
 * reorder.
 *
 * 🔴 **A pin can outlive the thing it points at.** The vendor pins media #5 and
 * then deletes it — or hides it — and without the check below the section keeps
 * pointing at a file that is gone, because the MANUAL branch simply returned.
 * The result is a dead tile on the brand's public profile, from an ordinary
 * delete that reported success.
 *
 * So a pin is verified, not trusted: still there, not deleted, still visible.
 * If any of that fails the section drops back to AUTO and recomputes. Losing
 * the pin is a smaller loss than showing a broken picture — and the media it
 * named is not there to show anyway.
 *
 * ⚠️ When the pin *is* still good the URL is refreshed rather than left alone,
 * so replacing the pinned media's file moves the cover with it. That is what
 * pinning an **id** buys over pinning a URL.
 *
 * ⚠️ Callers that load the section with a projection must include
 * `coverMediaId`, or every pin here looks dangling and quietly resets to AUTO.
 */
exports.syncSectionCoverImage = (section) => {
  if (section.coverImageMode === SHOWCASE_COVER_IMAGE_MODE.MANUAL) {
    const pinned = section.coverMediaId
      ? section.medias?.id?.(section.coverMediaId)
      : null;

    if (pinned && !pinned.isDeleted && pinned.isActive) {
      section.coverImage = exports.getMediaCoverImage(pinned);
      return;
    }

    section.coverImageMode = SHOWCASE_COVER_IMAGE_MODE.AUTO;
    section.coverMediaId = undefined;
  }

  section.coverImage = exports.getMediaCoverImage(
    exports.pickCoverMedia(section.medias),
  );
};
