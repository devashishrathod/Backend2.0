const { getSetting } = require("./getSetting");
const { getStorageConfig, effectiveLimitMB } = require("./getStorageConfig");
const { MEDIA_KIND } = require("../../constants/storage");
const { SHOWCASE_MEDIA_CONFIG } = require("../../constants/showcase");

// DB config (Setting.vendor.showcase) always wins; SHOWCASE_MEDIA_CONFIG only
// kicks in as a last-resort fallback if the singleton Setting doc somehow
// lacks a value. Field names are re-shaped to match what
// helpers/showcases/validateMedia.js already expects (maxItems/maxImages/...)
// so no caller needs to change how it reads the config object.
/**
 * ### 🔴 The size ceilings are narrowed by the platform's, and were not
 *
 * `assertStorageLimitRule` refuses a **save** that puts a surface above the
 * platform ceiling, and its own comment calls that "belt and braces" with the
 * read path taking the smaller one. The read path did not: these three numbers
 * came straight out of `vendor.showcase` with no `min` anywhere, and
 * `effectiveLimitMB` — written for exactly this — had no caller at all.
 *
 * One brace held. A `Setting` written before that rule existed, or seeded
 * directly, or restored from a backup of an older shape, carries a surface
 * limit the platform ceiling does not cover — and the surface number wins.
 */
exports.getShowcaseConfig = async () => {
  const setting = await getSetting();
  const showcase = setting?.vendor?.showcase || {};
  const platform = (await getStorageConfig()).maxSizeMB;

  /** The surface may ask for less than the platform allows. Never for more. */
  const sizeCap = (surfaceMB, fallbackMB, kind) =>
    effectiveLimitMB(platform[kind], surfaceMB ?? fallbackMB);

  return {
    /**
     * ⚠️ Returned, because for a long time it was not — and this function is the
     * only read path there is. The field was on the model and settable from the
     * admin panel, so switching the showcase off saved cleanly, came back in
     * `GET /settings/get`, and changed nothing at all: vendors carried on
     * creating sections and uploading media as though it were still on.
     *
     * `??` and not `||`: `false` is the whole point of the field.
     *
     * A kill switch for the **vendor's writes** — see
     * `middlewares/requireShowcaseEnabled.js`. Deliberately not a gate on
     * reading: a vendor has to be able to see the gallery they are being stopped
     * from editing, and the customer-facing endpoints keep serving what was
     * already published rather than making a brand's profile look broken.
     */
    isActive: showcase.isActive ?? true,
    /**
     * ⚠️ No `maxSections`. It was returned here and consulted by nothing — the
     * plan's `showcase` entitlement meters section count, via `reserveSlot` in
     * `createSection.js`. Returning it invited a second caller to enforce it and
     * gave the admin panel a limit that did nothing.
     */
    maxItems: showcase.maxItemsPerSection ?? SHOWCASE_MEDIA_CONFIG.maxItems,
    maxImages: showcase.maxImagesPerSection ?? SHOWCASE_MEDIA_CONFIG.maxImages,
    maxVideos: showcase.maxVideosPerSection ?? SHOWCASE_MEDIA_CONFIG.maxVideos,
    /**
     * The floors (S-1). Everything above is a ceiling; these two are the only
     * numbers here that say what a section must **keep**.
     *
     * ⚠️ `minItems` is what decides whether a section reaches a customer at all,
     * so raising it hides sections the moment it is saved — see the note on the
     * schema field. Nothing reads it yet; the write guards that will are S-3 and
     * the customer filter is S-4.
     */
    minItems: showcase.minItemsPerSection ?? SHOWCASE_MEDIA_CONFIG.minItems,
    minSections:
      showcase.minSectionsPerBrand ?? SHOWCASE_MEDIA_CONFIG.minSections,
    maxImageSizeMB: sizeCap(
      showcase.maxImageSizeMB,
      SHOWCASE_MEDIA_CONFIG.maxImageSizeMB,
      MEDIA_KIND.IMAGE,
    ),
    /**
     * ⚠️ Its own ceiling, not `maxImageSizeMB`. A GIF is an `image/*` type but
     * it stores every frame whole, so metering it against the photo limit
     * refuses ordinary GIFs while the allow-list claims to accept them.
     */
    maxGifSizeMB: sizeCap(
      showcase.maxGifSizeMB,
      SHOWCASE_MEDIA_CONFIG.maxGifSizeMB,
      MEDIA_KIND.GIF,
    ),
    maxVideoSizeMB: sizeCap(
      showcase.maxVideoSizeMB,
      SHOWCASE_MEDIA_CONFIG.maxVideoSizeMB,
      MEDIA_KIND.VIDEO,
    ),
    allowedImages: showcase.allowedImages?.length
      ? showcase.allowedImages
      : SHOWCASE_MEDIA_CONFIG.allowedImages,
    allowedVideos: showcase.allowedVideos?.length
      ? showcase.allowedVideos
      : SHOWCASE_MEDIA_CONFIG.allowedVideos,
  };
};
