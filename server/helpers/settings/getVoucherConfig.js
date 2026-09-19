const { getSetting } = require("./getSetting");
const { getStorageConfig } = require("./getStorageConfig");
const { VOUCHER_OFFER_LIMITS } = require("../../constants/voucher");
const { MEDIA_KIND } = require("../../constants/storage");

/**
 * DB config (`Setting.vendor.voucher`) always wins; these constants only kick in
 * as a last-resort fallback if the singleton Setting doc somehow lacks a value.
 *
 * ⚠️ "Somehow" is doing real work in that sentence, and it is worth being honest
 * about: `getSetting()` upserts the document and hands back a **hydrated**
 * `toObject()`, so schema defaults are applied even to a row written before a
 * field existed. Every `??` below is therefore unreachable in practice — a
 * mutation run confirmed it by changing one of these defaults and killing
 * nothing.
 *
 * They stay because the alternative is a file where some lines are guarded and
 * some are not, and the next person has to work out which. The guarantee they
 * lean on lives in another module and could be changed there.
 */
exports.getVoucherConfig = async () => {
  const setting = await getSetting();
  const voucher = setting?.vendor?.voucher || {};

  /**
   * 🔴 The size ceiling comes from the **global** storage limits, because the
   * voucher block has never had one of its own — and nothing was checking size
   * at all (P12).
   *
   * `validateVoucherImages` refused a file for its mime type and for how many
   * there were, and then let a 200 MB JPEG through. The upload ran, the bytes
   * were paid for, and the customer listing served a card that takes a minute to
   * render on a phone.
   *
   * ⚠️ No `vendor.voucher.maxImageSizeMB` is being added for it. A second number
   * answering the same question is only safe when it is written down which one
   * wins, and there is nothing about a voucher image that needs a different
   * ceiling from every other image on the platform. If one is ever needed,
   * `effectiveLimitMB` is the helper that narrows a global with a surface
   * override — the showcase block already works that way.
   */
  const storage = await getStorageConfig();

  return {
    maxOffers: voucher.maxOffers ?? VOUCHER_OFFER_LIMITS.MAX_OFFERS ?? 10,
    maxImages: voucher.maxImages ?? VOUCHER_OFFER_LIMITS.MAX_IMAGES ?? 5,
    /**
     * The floor a voucher must clear before it can be published (V-1).
     *
     * ⚠️ Read on the way **in** — create, image edit, submit-for-review — and
     * never on the way out. A published voucher may already have been claimed,
     * so raising this must not retire it; that is the opposite of how the
     * showcase floor behaves, and the difference is deliberate. V-2 is what
     * reads it.
     */
    minImages: voucher.minImages ?? 3,
    maxDistanceKm: voucher.maxDistanceKm ?? 25,
    /** Per kind, from `Setting.storage.limits` — bytes to compare against. */
    maxBytes: storage.maxBytes,
    /** The same ceilings in MB, for the sentence a refusal has to say. */
    maxSizeMB: storage.maxSizeMB,
    /**
     * What a voucher image may be. A GIF is its own kind platform-wide, and a
     * voucher card is a still — so this is the image list, not image + gif.
     */
    allowedImageTypes: storage.allowedTypes[MEDIA_KIND.IMAGE],
  };
};
