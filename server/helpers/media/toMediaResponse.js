const { MEDIA_KIND } = require("../../constants/storage");

/**
 * What a stored file is allowed to look like on the wire.
 *
 * ### 🔴 Why this is a function and not a projection
 *
 * Two public endpoints were found handing out storage internals — the voucher
 * detail (`images[].storage.bucket`, `.key`) and the ticker feed
 * (`icon.storage.publicId`). Both were written by someone who knew the rule;
 * both missed it, because the rule lived in whichever `$project` or `.map()`
 * happened to be nearest.
 *
 * A field that is never named cannot leak. Everything below is a **whitelist**,
 * so a column added to `mediaSchema` tomorrow does not reach a client by
 * default — it reaches one when somebody writes it down here.
 *
 * ### ⚠️ The default is a plain string, and that is deliberate
 *
 * `brand.logo` is a `String` today and every client reads it as one. Storing it
 * as a `mediaSchema` must not change that, or the media migration turns into a
 * rewrite of the panel and the app. So the default shape is the URL and nothing
 * else — the DB gets richer, the wire does not move.
 *
 * When a screen genuinely needs more (a video's poster, an image's aspect
 * ratio), it asks for it. One flag, and no second migration.
 */

/**
 * ### The third shape: what a panel sees
 *
 * An operator managing banners has questions a customer never asks — how big is
 * this file, what did the vendor actually name it, and **which provider is
 * holding it** while a migration is half done. So the admin shape carries those.
 *
 * 🔴 What it still refuses is `bucket`, `key` and `publicId`. Those are not
 * "more detail", they are the address of the object — the thing that turns a
 * leaked response into a readable file. `provider` answers "where does this
 * live" without answering "how do I fetch it behind your back", and that is the
 * line: **useful, not risky.**
 */

/**
 * @param {object|string|null} media  a `mediaSchema` value, or a legacy URL
 * @param {object}  [options]
 * @param {boolean} [options.withMeta]  return the descriptive shape, not a URL
 * @param {boolean} [options.forAdmin]  the panel shape (implies `withMeta`)
 * @returns {string|object|null}
 */
exports.toMediaResponse = (media, { withMeta = false, forAdmin = false } = {}) => {
  if (!media) return null;

  const detailed = withMeta || forAdmin;

  /**
   * A row written before the migration is still a bare URL string. It answers
   * the same question, so it gets the same answer rather than a special case
   * every caller has to remember.
   */
  if (typeof media === "string") {
    return detailed ? { url: media, kind: null } : media;
  }

  const url = media.url ?? null;
  if (!detailed) return url;

  const shape = {
    url,
    kind: media.kind ?? null,
    width: media.width ?? null,
    height: media.height ?? null,
  };

  if (forAdmin) {
    shape.mimeType = media.mimeType ?? null;
    shape.sizeBytes = media.sizeBytes ?? 0;
    shape.originalName = media.originalName ?? null;
    /**
     * ⚠️ The provider only — never the locator beside it. During the migration
     * an operator has to be able to see which files have moved and which have
     * not, and that question is exactly this one field.
     */
    shape.provider = media.storage?.provider ?? null;
  }

  /**
   * Only where they mean something. A photo has no duration, and reporting `0`
   * invites a client to render "0:00" under a still image.
   */
  if (media.kind === MEDIA_KIND.VIDEO || media.kind === MEDIA_KIND.AUDIO) {
    shape.duration = media.duration ?? 0;
  }

  /**
   * ⚠️ The poster is flattened to its URL. It is an image the client renders,
   * not a file it manages — and passing the object through would carry
   * `poster.storage` out with it, which is the exact leak this file exists to
   * make impossible.
   */
  if (media.kind === MEDIA_KIND.VIDEO) {
    shape.poster = media.poster?.url ?? null;
  }

  return shape;
};

/** The same rule over a list, in the order it was stored. */
exports.toMediaListResponse = (list = [], options) =>
  (list || []).map((media) => exports.toMediaResponse(media, options));
