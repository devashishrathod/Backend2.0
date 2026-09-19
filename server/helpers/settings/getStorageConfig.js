const { getSetting } = require("./getSetting");
const { MEDIA_KIND, STORAGE_PROVIDER } = require("../../constants/storage");

/**
 * The platform's storage rules, keyed the way the rest of the storage code
 * thinks.
 *
 * `Setting.storage` is written the way an **admin** reads it —
 * `maxImageSizeMB`, `maxGifSizeMB` — because that is what a panel renders. Every
 * caller downstream asks a different question: *this file is a `GIF`; how many
 * bytes may it be?* Translating once here means no caller has to map a kind onto
 * a field name, and no caller has to remember that MB is not bytes.
 *
 * ### ⚠️ GIF is its own kind, not a big image
 *
 * It has its own ceiling and its own mime list. A surface that wants photos but
 * not animation can then say so without re-deciding here what a GIF is — and a
 * GIF still lands under `gifs/`, clear of the resize Lambda that would flatten
 * it.
 */

const MB = 1024 * 1024;

/**
 * The ceiling a **surface** may narrow but never widen.
 *
 * Two numbers answering one question is only safe when it is written down which
 * of them wins, and this is where it is written: the smaller one, always.
 * `updateSetting` also refuses a surface limit above the global, so in practice
 * this is a second line rather than the only one — but it is the line that holds
 * for a document written before that validation existed.
 *
 * @param {number} globalMB   `Setting.storage.limits.*`
 * @param {number} [surfaceMB] e.g. `Setting.vendor.showcase.maxImageSizeMB`
 */
exports.effectiveLimitMB = (globalMB, surfaceMB) => {
  if (!Number.isFinite(surfaceMB)) return globalMB;
  if (!Number.isFinite(globalMB)) return surfaceMB;
  return Math.min(globalMB, surfaceMB);
};

exports.getStorageConfig = async () => {
  const setting = await getSetting();
  const storage = setting?.storage || {};
  const limits = storage.limits || {};
  const allowed = storage.allowed || {};
  const upload = storage.upload || {};
  const delivery = storage.delivery || {};

  /**
   * `??` and not `||` throughout — as a habit, not because anything here
   * currently depends on it.
   *
   * With these defaults the two happen to agree: `presignEnabled` defaults to
   * `false`, so a stored `false` reads the same either way, and every number
   * below has `min: 1` on the schema, so a stored `0` cannot exist for `||` to
   * mistake for absent. The habit is what keeps that true after somebody flips a
   * default to `true` — at which point `||` would read a deliberate `false` as
   * unset and hand back `true`, which for a kill switch is the one value it must
   * never invent.
   */
  const maxBytes = {
    [MEDIA_KIND.IMAGE]: (limits.maxImageSizeMB ?? 10) * MB,
    [MEDIA_KIND.GIF]: (limits.maxGifSizeMB ?? 15) * MB,
    [MEDIA_KIND.VIDEO]: (limits.maxVideoSizeMB ?? 50) * MB,
    [MEDIA_KIND.DOCUMENT]: (limits.maxDocumentSizeMB ?? 20) * MB,
    [MEDIA_KIND.AUDIO]: (limits.maxAudioSizeMB ?? 20) * MB,
  };

  const maxSizeMB = {
    [MEDIA_KIND.IMAGE]: limits.maxImageSizeMB ?? 10,
    [MEDIA_KIND.GIF]: limits.maxGifSizeMB ?? 15,
    [MEDIA_KIND.VIDEO]: limits.maxVideoSizeMB ?? 50,
    [MEDIA_KIND.DOCUMENT]: limits.maxDocumentSizeMB ?? 20,
    [MEDIA_KIND.AUDIO]: limits.maxAudioSizeMB ?? 20,
  };

  const allowedTypes = {
    [MEDIA_KIND.IMAGE]: allowed.imageTypes?.length
      ? allowed.imageTypes
      : ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    [MEDIA_KIND.GIF]: allowed.gifTypes?.length ? allowed.gifTypes : ["image/gif"],
    [MEDIA_KIND.VIDEO]: allowed.videoTypes?.length
      ? allowed.videoTypes
      : ["video/mp4", "video/webm", "video/quicktime"],
    [MEDIA_KIND.DOCUMENT]: allowed.documentTypes?.length
      ? allowed.documentTypes
      : ["application/pdf"],
    [MEDIA_KIND.AUDIO]: allowed.audioTypes?.length
      ? allowed.audioTypes
      : ["audio/mpeg", "audio/mp4"],
  };

  return {
    provider: storage.provider ?? STORAGE_PROVIDER.CLOUDINARY,
    /** By `MEDIA_KIND`, in bytes — what a size check actually compares against. */
    maxBytes,
    /** The same ceilings in MB, for the sentence a refusal has to say. */
    maxSizeMB,
    /** By `MEDIA_KIND` — the mime types that kind may really be. */
    allowedTypes,
    presignEnabled: upload.presignEnabled ?? false,
    presignTtlSeconds: (upload.presignTtlMinutes ?? 15) * 60,
    intentTtlMs: (upload.intentTtlMinutes ?? 60) * 60 * 1000,
    signedUrlTtlSeconds: (delivery.signedUrlTtlMinutes ?? 5) * 60,
  };
};
