/**
 * One-off: bring every stored file onto the one `mediaSchema` shape (M-5).
 *
 * ### 🔴 Stage and dev only. Production will never run this.
 *
 * Production starts on a fresh database, so there is nothing there to convert —
 * this exists for the databases people have been clicking through for months.
 * `DB-1` in `docs/s3_media_migration_plan.md` decided there would be **no**
 * migration script, on the reasoning that the data is disposable. That reasoning
 * still holds for production; what it missed is that the dev database is the one
 * everybody develops against, and a dev database serving `url: undefined` looks
 * exactly like a broken feature.
 *
 * ### What was actually wrong
 *
 * The code moved the file into `media` and left the rows where they were:
 *
 *     stored   { type, url, thumbnail, storage, metadata: {…} }
 *     expected { media: { url, kind, storage, mimeType, sizeBytes, …, poster } }
 *
 * In an aggregation a path that does not exist resolves to **missing**, and
 * `$map` drops a key whose value is missing rather than emitting `null` — so the
 * customer showcase answered media rows with no `url` and no `thumbnail` at all,
 * `photoCount` and `videoCount` both `0` beside a `mediaCount` of 4, and every
 * legacy video reported itself as a `PHOTO`. The reels feed matched nothing at
 * all, platform-wide, because clip eligibility tests `media.kind === VIDEO`.
 *
 * Writes broke from the other side: `media` is `required`, so every
 * `section.save()` — six of the eight showcase write paths — failed validation
 * with *"A media file is required."* about a photo that had been sitting there
 * for weeks.
 *
 * ### The five places, and how they were found
 *
 * The paths were not guessed. Every `mediaSchema` path in every model was walked
 * and counted against the database. Fifteen are **sidecar** fields —
 * `logoMedia`, `imageMedia`, `documentMedia` — added beside a legacy `String`
 * and never populated, which is the designed migration path and not a fault
 * (`toMediaResponse` answers a bare string with the same string). Five carry
 * real legacy rows:
 *
 *     ShowcaseSection.medias[]      flat row      → media{}
 *     VoucherVersion.images[]       flat row      → media{}
 *     Voucher.banner.current        no `kind`     → + kind
 *     Voucher.banner.{image,video,gif}            → current, APPROVED
 *     PromotionalTicker.icon        no `kind`     → + kind
 *     Banner.{type,image,video,gif}               → media{}, labels removed
 *
 * ### ⚠️ How `Banner` was nearly missed, and what the scan had to become
 *
 * The first scan asked *"is there a same-named `url` one level above the media
 * path?"*. That finds `medias[].url` under `medias[].media` and is **blind** to
 * `Banner.image` under `Banner.media`, because the legacy field was **renamed**
 * rather than nested — so the one path breaking three surfaces at once scored
 * zero and looked clean.
 *
 * What finds it is the opposite question: compare **stored keys** against the
 * keys the schema declares, and report what the schema does not know about. A
 * rename shows up immediately, and so does every other leftover. If another
 * media path is ever suspected, run that check rather than this list.
 *
 * ⚠️ The `banner.current` rows are the output of
 * `scripts/backfillVoucherBanners.js`, which writes with `updateOne` and so
 * never ran validation — that is how nine documents came to hold a `mediaSchema`
 * value with no `kind`, which the schema calls `required`. Their `APPROVED`
 * status is deliberate and already argued in that script's header: those banners
 * were live to customers, and putting them into review would have taken every
 * brand's banner off screen at once. The one remaining old-shape banner follows
 * the same precedent rather than inventing a second rule.
 *
 * ### 🔴 A legacy video's stored poster is a 404, and a real one is derivable
 *
 * `mediaSchema` makes `poster` mandatory on a VIDEO. The stored `thumbnail` on
 * those rows cannot serve: it was built by `getOptimizedImageUrl(publicId)`,
 * which produces an **`/image/upload/`** path for an asset that lives under
 * `/video/upload/`. Measured on this data — three sampled videos, all three:
 *
 *     stored thumbnail                       → 404 application/octet-stream
 *     .../video/upload/so_0/<publicId>.jpg   → 200 image/jpeg
 *
 * So the poster is derived from Cloudinary's own video-frame delivery rather
 * than copied. A row whose poster cannot be derived — no `publicId`, or a
 * provider that has no such URL — is **left alone and reported**, never written
 * with a link that does not resolve. A missing album is recoverable; a poster
 * that 404s is a broken image on a customer's screen that nothing will report.
 *
 * ### How it writes, and why not through Mongoose
 *
 * Reads go through the **raw driver**. `Model.find()` hydrates against the
 * schema, and the legacy fields are not in it — `type`, `url`, `thumbnail`,
 * `metadata` would be stripped on the way in, so the conversion would be handed
 * a document with nothing left to convert.
 *
 * Every converted document is then **validated through the model** before
 * anything is written. That is the acceptance test for the whole exercise: if it
 * validates, `save()` works, and the six broken write paths are fixed by
 * definition rather than by hope.
 *
 * Safe to re-run: conversion is decided **per row**, not per document, so a
 * section holding both shapes — which is what `addSectionMedia` produces, since
 * it writes with `updateOne` and pushes a new-shape row into a legacy array —
 * converts the legacy rows and leaves the rest untouched.
 *
 * Usage
 * -----
 *   node scripts/migrateLegacyMediaShape.js            # dry run, writes nothing
 *   node scripts/migrateLegacyMediaShape.js --apply    # actually write
 */

require("dotenv").config();
const mongoose = require("mongoose");

const ShowcaseSection = require("../models/ShowcaseSection");
const VoucherVersion = require("../models/VoucherVersion");
const Voucher = require("../models/Voucher");
const PromotionalTicker = require("../models/PromotionalTicker");
const Banner = require("../models/Banner");

const {
  MEDIA_KIND,
  STORAGE_PROVIDER,
  kindFromMime,
} = require("../constants/storage");
const { VOUCHER_BANNER_STATUS } = require("../constants/voucherBanner");

const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Deciding what a legacy file is
// ---------------------------------------------------------------------------

/**
 * `MEDIA_KIND` for a row that predates the field.
 *
 * ⚠️ Ordered by how much the source actually knows. `metadata.mimeType` is the
 * verified type recorded at upload, so it wins. The legacy `type` is next: it
 * only says PHOTO or VIDEO, and a GIF was stored as a PHOTO — which is the right
 * answer for the wire and the wrong one for `kind`, so the URL gets the last
 * word on `.gif`.
 */
const resolveKind = ({ mimeType, legacyType, url, kindHint }) => {
  const fromMime = mimeType ? kindFromMime(mimeType) : null;
  if (fromMime) return fromMime;

  /**
   * A caller that already knows, because the old document said so in a field of
   * its own — `Banner.type` is `IMAGE` / `VIDEO` / `GIF`, which is the answer.
   *
   * ⚠️ Above the URL heuristics on purpose. A Cloudinary URL often carries no
   * extension at all, and the GIF banners here happen to end in `.gif` — so
   * leaning on the path would work today and quietly mis-file the first GIF
   * uploaded without one, sending it through the resize step that flattens it.
   */
  if (kindHint && Object.values(MEDIA_KIND).includes(kindHint)) return kindHint;

  const path = String(url || "").toLowerCase();
  if (/\.gif(\?|$)/.test(path)) return MEDIA_KIND.GIF;
  if (legacyType === "VIDEO") return MEDIA_KIND.VIDEO;
  // Cloudinary puts the delivery type in the path, and it is derived from the
  // asset rather than declared — so it outranks a guess from the extension.
  if (path.includes("/video/upload/")) return MEDIA_KIND.VIDEO;
  if (legacyType === "PHOTO") return MEDIA_KIND.IMAGE;
  if (path.includes("/image/upload/")) return MEDIA_KIND.IMAGE;
  return null;
};

/** The Cloudinary cloud this asset is served from, read off its own URL. */
const cloudNameOf = (url) =>
  String(url || "").match(/res\.cloudinary\.com\/([^/]+)\//)?.[1] || null;

/**
 * A working poster for a legacy Cloudinary video.
 *
 * `so_0` is "start offset zero" — the first frame, delivered as a still. This is
 * the only derivation in the script, and it exists because the alternative is
 * dropping thirty-three videos out of every gallery they belong to.
 *
 * Returns `null` when it cannot be built, and the caller then refuses the row
 * rather than writing a URL nobody has checked.
 */
const derivePoster = (media) => {
  if (media?.storage?.provider !== STORAGE_PROVIDER.CLOUDINARY) return null;
  const publicId = media?.storage?.publicId;
  const cloud = cloudNameOf(media?.url);
  if (!publicId || !cloud) return null;
  return {
    url: `https://res.cloudinary.com/${cloud}/video/upload/so_0/${publicId}.jpg`,
    width: null,
    height: null,
  };
};

/**
 * `undefined`, never `{}`.
 *
 * `mediaSchema` says why in as many words: an empty storage sub-document reads
 * as `provider: undefined`, which the storage facade refuses with "Unknown
 * storage provider". Absent means "written before this existed"; `{}` means
 * "written by something broken".
 */
const cleanStorage = (storage) => {
  if (!storage?.provider) return undefined;
  const out = { provider: storage.provider };
  if (storage.publicId) out.publicId = storage.publicId;
  if (storage.bucket) out.bucket = storage.bucket;
  if (storage.key) out.key = storage.key;
  return out;
};

/**
 * Build a `mediaSchema` value out of whatever a legacy row carried.
 *
 * @returns {{ media: object } | { reason: string }}
 */
const buildMedia = ({ url, storage, metadata, legacyType, kindHint }) => {
  const storageRef = cleanStorage(storage);
  if (!url && !storageRef?.key && !storageRef?.publicId) {
    return { reason: "no url and no storage key — nothing to locate" };
  }

  const kind = resolveKind({
    mimeType: metadata?.mimeType,
    legacyType,
    url,
    kindHint,
  });
  if (!kind) return { reason: "cannot tell what kind of file this is" };

  const media = {
    url: url ?? null,
    kind,
    sizeBytes: metadata?.size ?? 0,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    duration: metadata?.duration ?? 0,
  };
  if (storageRef) media.storage = storageRef;
  if (metadata?.mimeType) media.mimeType = metadata.mimeType;
  if (metadata?.originalName) media.originalName = metadata.originalName;

  if (kind === MEDIA_KIND.VIDEO) {
    const poster = derivePoster(media);
    if (!poster) {
      return {
        reason:
          "a video needs a poster and one cannot be derived (not Cloudinary, or no publicId)",
      };
    }
    media.poster = poster;
  }

  return { media };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const tally = () => ({
  scanned: 0,
  converted: 0,
  already: 0,
  removed: 0,
  refused: [],
});

const refuse = (stats, where, reason) => stats.refused.push({ where, reason });

const report = (label, stats) => {
  console.log(`\n${label}`);
  console.log(`   scanned        ${stats.scanned}`);
  console.log(`   already new    ${stats.already}`);
  console.log(`   ${APPLY ? "converted     " : "would convert "} ${stats.converted}`);
  if (stats.removed) {
    console.log(`   ${APPLY ? "removed       " : "would remove  "} ${stats.removed}`);
  }
  if (stats.refused.length) {
    console.log(`   ⛔ refused      ${stats.refused.length}`);
    for (const r of stats.refused.slice(0, 10)) {
      console.log(`        ${r.where} — ${r.reason}`);
    }
    if (stats.refused.length > 10) {
      console.log(`        …and ${stats.refused.length - 10} more`);
    }
  }
};

/**
 * Validate a converted document through its model before it is written.
 *
 * ⚠️ The whole point of the exercise. A conversion that validates is one that
 * `save()` will accept, which is exactly what the six broken showcase write
 * paths need — so this turns "the shape looks right" into "the shape is the one
 * the schema demands".
 */
const validates = async (Model, doc, stats, where) => {
  try {
    // ⚠️ The async form. `validateSync()` is deprecated in Mongoose 9 and says
    // so once per call, which buries this script's own report in warnings.
    await new Model(doc).validate();
    return true;
  } catch (error) {
    refuse(
      stats,
      where,
      Object.values(error.errors || {})[0]?.message || error.message,
    );
    return false;
  }
};

// ---------------------------------------------------------------------------
// 1. Showcase sections
// ---------------------------------------------------------------------------

/**
 * ⚠️ The stored cover of a video-first section is the same 404 the poster rule
 * exists for — `syncSectionCoverImage` computed it from the very field that
 * cannot serve. It is repointed at the derived poster, and only when it is
 * demonstrably that broken URL: a cover that works is never touched.
 */
const repointCover = (section, converted) => {
  const cover = section.coverImage;
  if (!cover || !/\/image\/upload\/.*\/Videos\//i.test(cover)) return null;

  const first = converted
    .filter((row) => !row.isDeleted && row.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
  if (!first) return null;

  return first.media.kind === MEDIA_KIND.VIDEO
    ? (first.media.poster?.url ?? null)
    : (first.media.url ?? null);
};

const migrateShowcaseSections = async (db) => {
  const stats = tally();
  let covers = 0;
  const cursor = db.collection("showcasesections").find({});

  for await (const section of cursor) {
    const rows = section.medias || [];
    if (!rows.length) continue;

    let touched = false;
    const converted = [];

    for (const row of rows) {
      stats.scanned += 1;

      // Per row, not per document: `addSectionMedia` writes with `updateOne`,
      // so a legacy section that anyone has added to holds both shapes.
      if (row.media) {
        stats.already += 1;
        converted.push(row);
        continue;
      }

      const built = buildMedia({
        url: row.url,
        storage: row.storage,
        metadata: row.metadata,
        legacyType: row.type,
      });

      if (built.reason) {
        refuse(stats, `section ${section._id} / media ${row._id}`, built.reason);
        converted.push(row); // leave it exactly as it was
        continue;
      }

      touched = true;
      stats.converted += 1;
      converted.push({
        _id: row._id,
        media: built.media,
        title: row.title,
        altText: row.altText,
        sortOrder: row.sortOrder ?? 0,
        /**
         * VIDEO only. The schema's `pre("validate")` hook forces this false on
         * anything else, and `validateSync` does not run middleware — so the
         * rule is applied here rather than trusted to fire later.
         */
        isShowInVideoClips:
          built.media.kind === MEDIA_KIND.VIDEO
            ? (row.isShowInVideoClips ?? true)
            : false,
        isActive: row.isActive ?? true,
        isDeleted: row.isDeleted ?? false,
        deletedAt: row.deletedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    if (!touched) continue;

    const next = { ...section, medias: converted };
    const cover = repointCover(section, converted);
    if (cover) next.coverImage = cover;

    if (!(await validates(ShowcaseSection, next, stats, `section ${section._id}`))) {
      continue;
    }

    if (APPLY) {
      const $set = { medias: converted };
      if (cover) $set.coverImage = cover;
      await db
        .collection("showcasesections")
        .updateOne({ _id: section._id }, { $set });
    }
    if (cover) covers += 1;
  }

  report("📸 ShowcaseSection.medias[]", stats);
  if (covers) {
    console.log(
      `   🖼  ${covers} section cover(s) repointed off a 404 video thumbnail`,
    );
  }
  return stats;
};

// ---------------------------------------------------------------------------
// 2. Voucher version images
// ---------------------------------------------------------------------------

const migrateVoucherVersions = async (db) => {
  const stats = tally();
  const cursor = db.collection("voucherversions").find({});

  for await (const version of cursor) {
    const rows = version.images || [];
    if (!rows.length) continue;

    let touched = false;
    const converted = [];

    for (const row of rows) {
      stats.scanned += 1;

      if (row.media) {
        stats.already += 1;
        converted.push(row);
        continue;
      }

      // A voucher image carries no `metadata` — the surface only ever accepts a
      // still (`VOUCHER_IMAGE` is `[IMAGE, GIF]`), so the URL decides.
      const built = buildMedia({
        url: row.url,
        storage: row.storage,
        metadata: null,
        legacyType: "PHOTO",
      });

      if (built.reason) {
        refuse(stats, `version ${version._id} / image ${row._id}`, built.reason);
        converted.push(row);
        continue;
      }

      touched = true;
      stats.converted += 1;
      converted.push({
        _id: row._id,
        media: built.media,
        sortOrder: row.sortOrder ?? 0,
      });
    }

    if (!touched) continue;

    const next = { ...version, images: converted };
    if (!(await validates(VoucherVersion, next, stats, `version ${version._id}`))) {
      continue;
    }

    if (APPLY) {
      await db
        .collection("voucherversions")
        .updateOne({ _id: version._id }, { $set: { images: converted } });
    }
  }

  report("🎟  VoucherVersion.images[]", stats);
  return stats;
};

// ---------------------------------------------------------------------------
// 3. Voucher banners
// ---------------------------------------------------------------------------

/** The one populated slot of an old three-slot banner, if there is one. */
const legacyBannerSlot = (banner) => {
  for (const [slot, legacyType] of [
    ["image", "PHOTO"],
    ["video", "VIDEO"],
    ["gif", "PHOTO"],
  ]) {
    if (banner?.[slot]?.url) return { value: banner[slot], legacyType };
  }
  return null;
};

/** Does this banner hold a file — in either shape — at all? */
const bannerHasFile = (banner) =>
  Boolean(banner?.current?.url || banner?.pending?.url || legacyBannerSlot(banner));

/**
 * One slot, brought onto `mediaSchema` if it is not already there.
 *
 * @returns {{ media: object|undefined } | { reason: string }}
 */
const bannerSlotMedia = (value, legacyType) => {
  if (!value?.url) return { media: undefined };
  if (value.kind) return { media: value }; // already a media value
  return buildMedia({
    url: value.url,
    storage: value.storage,
    metadata: null,
    legacyType,
  });
};

/**
 * The banner, rebuilt from **only** the six fields the schema declares.
 *
 * 🔴 Not a spread of what was stored. The old shape carried `type`, `image`,
 * `video` and `gif` beside these, and the raw driver writes back exactly what it
 * is given — so spreading would carry four dead keys into the new shape for
 * ever, in the very document that was being cleaned up.
 */
const rebuildBanner = (banner, { current, pending, status }) => {
  const next = {};
  if (current) next.current = current;
  if (pending) next.pending = pending;
  next.status = status ?? banner?.status ?? null;
  next.rejectionReason = banner?.rejectionReason ?? null;
  next.reviewedBy = banner?.reviewedBy ?? null;
  next.reviewedAt = banner?.reviewedAt ?? null;
  return next;
};

/**
 * What one voucher's banner should become.
 *
 * @returns {{ action: "skip" }
 *         | {{ action: "remove" }}
 *         | {{ action: "set", banner: object }}
 *         | {{ action: "refuse", reason: string }}}
 */
const planBanner = (banner) => {
  /**
   * 🔴 Nothing here, in either shape — so this is one of the empty shells the
   * old schema's defaults materialised: `{ gif: { storage: { provider } },
   * image: {…}, video: {…} }`, or a lone `{ type: null }`. `mediaSchema` reads
   * `{}` as a broken write rather than an absent one, and the honest value for
   * a voucher that never had a banner is no banner at all.
   *
   * ⚠️ The test is "has a file", not "has keys". Asking whether the object was
   * non-empty would have removed a banner sitting in review — `pending` set,
   * `current` absent, which is a perfectly ordinary state — and taken a vendor's
   * upload with it. There are none today; the guard is what keeps that true on
   * a database this script has not seen.
   */
  if (!bannerHasFile(banner)) {
    return Object.keys(banner || {}).length
      ? { action: "remove" }
      : { action: "skip" };
  }

  const slot = legacyBannerSlot(banner);

  // Old three-slot shape → `current`, approved.
  if (!banner.current?.url && slot) {
    const built = bannerSlotMedia(slot.value, slot.legacyType);
    if (built.reason) return { action: "refuse", reason: built.reason };
    /**
     * ⚠️ APPROVED, following `scripts/backfillVoucherBanners.js` rather than
     * deciding again. Those banners were live to customers before the review
     * flow existed; sending them to review would take a live banner off screen
     * to answer a question nobody asked.
     */
    return {
      action: "set",
      banner: rebuildBanner(banner, {
        current: built.media,
        status: VOUCHER_BANNER_STATUS.APPROVED,
      }),
    };
  }

  // Already the new shape, but written past validation by a script that used
  // `updateOne` — so `kind` (and a video's poster) never landed.
  const current = bannerSlotMedia(banner.current, null);
  if (current.reason) return { action: "refuse", reason: current.reason };
  const pending = bannerSlotMedia(banner.pending, null);
  if (pending.reason) return { action: "refuse", reason: pending.reason };

  const alreadyClean =
    banner.current?.kind !== undefined || banner.current === undefined;
  const pendingClean =
    banner.pending?.kind !== undefined || banner.pending === undefined;
  const noDeadKeys = !slot && banner.type === undefined;
  if (alreadyClean && pendingClean && noDeadKeys) return { action: "skip" };

  return {
    action: "set",
    banner: rebuildBanner(banner, {
      current: current.media,
      pending: pending.media,
    }),
  };
};

const migrateVoucherBanners = async (db) => {
  const stats = tally();
  const cursor = db
    .collection("vouchers")
    .find({ banner: { $exists: true, $ne: null } });

  for await (const voucher of cursor) {
    stats.scanned += 1;
    const where = `voucher ${voucher._id}`;
    const plan = planBanner(voucher.banner || {});

    if (plan.action === "refuse") {
      refuse(stats, where, plan.reason);
      continue;
    }
    if (plan.action === "skip") {
      stats.already += 1;
      continue;
    }
    if (plan.action === "remove") {
      stats.removed += 1;
      if (APPLY) {
        await db
          .collection("vouchers")
          .updateOne({ _id: voucher._id }, { $unset: { banner: "" } });
      }
      continue;
    }

    const candidate = { ...voucher, banner: plan.banner };
    if (!(await validates(Voucher, candidate, stats, where))) continue;

    stats.converted += 1;
    if (APPLY) {
      await db
        .collection("vouchers")
        .updateOne({ _id: voucher._id }, { $set: { banner: plan.banner } });
    }
  }

  report("🖼  Voucher.banner", stats);
  return stats;
};

// ---------------------------------------------------------------------------
// 4. Promotional ticker icons
// ---------------------------------------------------------------------------

const migrateTickerIcons = async (db) => {
  const stats = tally();
  const cursor = db
    .collection("promotionaltickers")
    .find({ "icon.url": { $exists: true } });

  for await (const ticker of cursor) {
    stats.scanned += 1;
    if (ticker.icon?.kind) {
      stats.already += 1;
      continue;
    }

    const built = buildMedia({
      url: ticker.icon.url,
      storage: ticker.icon.storage,
      metadata: null,
      legacyType: "PHOTO",
    });
    if (built.reason) {
      refuse(stats, `ticker ${ticker._id}`, built.reason);
      continue;
    }

    const next = { ...ticker, icon: built.media };
    if (!(await validates(PromotionalTicker, next, stats, `ticker ${ticker._id}`))) {
      continue;
    }

    stats.converted += 1;
    if (APPLY) {
      await db
        .collection("promotionaltickers")
        .updateOne({ _id: ticker._id }, { $set: { icon: built.media } });
    }
  }

  report("📣 PromotionalTicker.icon", stats);
  return stats;
};

// ---------------------------------------------------------------------------
// 5. Home banners
// ---------------------------------------------------------------------------

/**
 * 🔴 The same three-slot shape the voucher banner had, and the same fix — but
 * this one was breaking **three** surfaces at once, not one.
 *
 *     stored   { type: "IMAGE", image: { url, storage } }
 *     expected { media: { url, kind, storage, … } }
 *
 * `Banner.media` is `required`, and nothing had ever written it here, so:
 *
 *   - `GET /banners/customer/active` answered `type`, `url` **and** `thumbnail`
 *     as `null` on every banner — a home carousel of blank tiles;
 *   - the admin list answered `media: null`, so the panel could not show them
 *     either;
 *   - `updateBanner` calls `banner.save()`, so editing any existing banner was
 *     a **422** naming a field the operator has no way to supply.
 *
 * Only `deleteBanner` kept working, and only because it passes
 * `validateBeforeSave: false`.
 *
 * ⚠️ The legacy fields are **removed**, not left beside the new one. `type` was
 * a second source of truth for what the file is — the exact thing `media.kind`
 * exists to end — and three near-identical slots of which one is ever filled is
 * what the model's own header calls out as the shape this replaced.
 */
const legacyBannerFile = (banner) => {
  for (const [slot, kind] of [
    ["image", MEDIA_KIND.IMAGE],
    ["video", MEDIA_KIND.VIDEO],
    ["gif", MEDIA_KIND.GIF],
  ]) {
    if (banner?.[slot]?.url) return { value: banner[slot], kind };
  }
  return null;
};

const migrateBanners = async (db) => {
  const stats = tally();
  const cursor = db.collection("banners").find({});

  for await (const banner of cursor) {
    stats.scanned += 1;
    const where = `banner ${banner._id} (${banner.title})`;

    if (banner.media?.kind) {
      // Already converted, but an older run may have left the labels behind.
      if (banner.type || banner.image || banner.video || banner.gif) {
        stats.converted += 1;
        if (APPLY) {
          await db
            .collection("banners")
            .updateOne(
              { _id: banner._id },
              { $unset: { type: "", image: "", video: "", gif: "" } },
            );
        }
      } else {
        stats.already += 1;
      }
      continue;
    }

    const slot = legacyBannerFile(banner);
    if (!slot) {
      refuse(stats, where, "no media in any slot — nothing to convert");
      continue;
    }

    const built = buildMedia({
      url: slot.value.url,
      storage: slot.value.storage,
      metadata: null,
      /**
       * ⚠️ The **slot holding the bytes**, not the legacy `type` beside it.
       * The two could disagree — `type: "VIDEO"` with the file sitting in
       * `image`, which nothing prevented and nothing detected — and that
       * possibility is exactly why `type` is being removed. A label is a
       * claim; the field the file is actually in is a fact.
       */
      kindHint: slot.kind,
    });
    if (built.reason) {
      refuse(stats, where, built.reason);
      continue;
    }

    const candidate = { ...banner, media: built.media };
    delete candidate.type;
    delete candidate.image;
    delete candidate.video;
    delete candidate.gif;

    if (!(await validates(Banner, candidate, stats, where))) continue;

    stats.converted += 1;
    if (APPLY) {
      await db.collection("banners").updateOne(
        { _id: banner._id },
        {
          $set: { media: built.media },
          $unset: { type: "", image: "", video: "", gif: "" },
        },
      );
    }
  }

  report("🏠 Banner.media", stats);
  return stats;
};

// ---------------------------------------------------------------------------

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 20000,
  });
  const db = mongoose.connection.db;

  /**
   * ⚠️ Named on the way in, and refused on the money suite's database.
   *
   * `Trydood2_test` is cleared between test files and seeds itself; converting
   * rows underneath a run in progress is how a suite produces a scatter of
   * failures on assertions that are individually correct.
   */
  if (db.databaseName.endsWith("_test")) {
    console.error(
      `\n⛔ Refusing to run against "${db.databaseName}" — that is the money suite's database.\n`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(
    APPLY
      ? `\n🚚 Legacy media shape migration — APPLYING to "${db.databaseName}"`
      : `\n🔍 Legacy media shape migration — dry run on "${db.databaseName}" (writes nothing)`,
  );

  const all = [
    await migrateShowcaseSections(db),
    await migrateVoucherVersions(db),
    await migrateVoucherBanners(db),
    await migrateTickerIcons(db),
    await migrateBanners(db),
  ];

  const converted = all.reduce((sum, s) => sum + s.converted, 0);
  const removed = all.reduce((sum, s) => sum + s.removed, 0);
  const refused = all.reduce((sum, s) => sum + s.refused.length, 0);
  const changed = converted + removed;

  console.log("\n" + "─".repeat(62));
  if (!APPLY) {
    console.log(
      changed
        ? `🔍 Dry run: ${converted} converted + ${removed} removed = ${changed} change(s). Re-run with --apply to write.`
        : "✅ Nothing to convert — every stored file is already on the media shape.",
    );
  } else {
    console.log(
      `✅ Applied: ${converted} converted, ${removed} removed — ${changed} change(s).`,
    );
  }
  if (refused) {
    console.log(`⛔ ${refused} document(s) were left exactly as they were.`);
    /**
     * ⚠️ Whole documents, not rows. A section is written as one array, and a row
     * that cannot be converted keeps the document unsaveable whichever way it is
     * written — so its siblings are left alone too rather than producing a
     * half-converted document that still fails `save()` and now reads as fixed.
     */
    console.log(
      "   A document with one unconvertible row is skipped whole — nothing partial is ever written.",
    );
  }
  console.log("");

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("\n❌ Migration failed:", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
