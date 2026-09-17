const { MEDIA_KIND } = require("../../constants/storage");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");

/**
 * What a customer should see in this voucher's banner slot.
 *
 * ### 🔴 The slot is never empty (V-4a)
 *
 * A banner can be pending review, or rejected, or simply never uploaded. In all
 * three the voucher stays published and the slot falls back to the voucher's
 * **first image** — the one at `sortOrder: 1`, which every published voucher has
 * because the image floor guarantees at least three.
 *
 * That fallback is what makes "every voucher has a banner" true without holding
 * a live offer hostage to a review queue. The alternative — hiding the voucher,
 * or rendering a blank tile until an admin gets to it — punishes the customer
 * for a decision that has not been made yet.
 *
 * ### ⚠️ `pending` is never served
 *
 * Only `banner.current` reaches a customer, and `current` is only ever written
 * on approval. A vendor replacing their banner keeps serving the old one until
 * the new one is approved (V-5), so a replacement cannot take a live offer's
 * banner down.
 *
 * ### What the client gets, and why the extra two fields
 *
 * `bannerType` / `bannerUrl` / `bannerThumbnail` keep their existing meaning, so
 * nothing that renders a banner today has to change. `bannerStatus` and
 * `bannerIsFallback` are additive: the first lets the **vendor** panel show
 * "pending review" against their own voucher, the second lets any client tell a
 * real banner from a stand-in without comparing URLs against the image list.
 *
 * `storage` is never exposed — only the URL is any of the customer's business.
 *
 * @param {object|null} banner  the raw `voucher.banner` sub-document
 * @param {Array}  [images]     the version's images, for the fallback
 * @returns {{ bannerType, bannerUrl, bannerThumbnail, bannerStatus, bannerIsFallback }}
 */

/**
 * What the wire calls this file.
 *
 * ⚠️ Derived from `media.kind`, never stored. The old shape kept a `type` beside
 * the file and the two could disagree; this reads the bytes' own answer.
 *
 * Anything that is not a video or a GIF is an image — including a kind added to
 * `MEDIA_KIND` later, which is the safe way round for a client that only knows
 * how to paint three things.
 */
const typeOf = (media) => {
  if (media?.kind === MEDIA_KIND.VIDEO) return "VIDEO";
  if (media?.kind === MEDIA_KIND.GIF) return "GIF";
  return "IMAGE";
};

/**
 * The frame to paint before a video plays.
 *
 * A video banner's poster is **mandatory** at upload (M-5), and storing it
 * without sending it makes the requirement pointless — the app still shows a
 * blank rectangle until the `.mp4` has buffered enough for a frame.
 *
 * ⚠️ On a still or a GIF this is the banner's own URL rather than `null`, so a
 * client can paint `bannerThumbnail` once instead of branching on `bannerType`
 * to work out which field holds an image. Same contract as the home banner and
 * showcase media.
 */
const thumbnailOf = (media) =>
  media?.kind === MEDIA_KIND.VIDEO ? (media.poster?.url ?? null) : (media?.url ?? null);

const EMPTY = {
  bannerType: null,
  bannerUrl: null,
  bannerThumbnail: null,
  bannerStatus: null,
  bannerIsFallback: false,
};

/** The voucher's first image, in display order. */
const firstImage = (images = []) => {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = [...images].sort(
    (a, b) => (a?.sortOrder ?? 0) - (b?.sortOrder ?? 0),
  );
  return sorted.find((image) => image?.media?.url)?.media ?? null;
};

exports.pickVoucherBanner = (banner, images = []) => {
  const status = banner?.status ?? null;
  const current = banner?.current;

  if (current?.url) {
    return {
      bannerType: typeOf(current),
      bannerUrl: current.url,
      bannerThumbnail: thumbnailOf(current),
      /**
       * A live banner is approved by definition — `current` is only written on
       * approval. Reporting `banner.status` here would be reporting the state of
       * the **pending** one, which is a different banner entirely.
       */
      bannerStatus: VOUCHER_BANNER_STATUS.APPROVED,
      bannerIsFallback: false,
    };
  }

  const fallback = firstImage(images);
  if (!fallback) {
    // No approved banner and no image to stand in. Only reachable on a draft —
    // a published voucher always has at least `minImages` of them.
    return { ...EMPTY, bannerStatus: status };
  }

  return {
    bannerType: typeOf(fallback),
    bannerUrl: fallback.url,
    bannerThumbnail: thumbnailOf(fallback),
    /**
     * ⚠️ The **pending** banner's status, not the fallback's — a fallback has no
     * status of its own. `PENDING` here means "their real banner is in review";
     * `REJECTED` means it was refused; `null` means they never uploaded one.
     */
    bannerStatus: status,
    bannerIsFallback: true,
  };
};
