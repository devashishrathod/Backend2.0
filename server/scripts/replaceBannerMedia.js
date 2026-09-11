/**
 * Re-cut every home banner's artwork at the current banner size, and replace
 * the file on Cloudinary — without touching anything else about the row.
 *
 * ### Why this is not just a re-run of the seeder
 *
 * `seedHomeBanners.js` hard deletes and rebuilds, which mints new `_id`s. That
 * is right when the data itself is wrong. It is the wrong tool when only the
 * **file** is wrong — the titles, descriptions, schedules and category
 * redirects here are all still correct, and throwing away the documents to
 * change a picture would invalidate any id anybody has already written down.
 *
 * So this walks the existing rows and swaps `image`/`gif` in place. A GIF is
 * re-cut as a GIF and a still as a still: the `type` field is what the app
 * switches its renderer on, so changing the file's kind under a row would put
 * an animated image behind a still renderer.
 *
 * ### The old file is destroyed, not orphaned
 *
 * Each row's previous Cloudinary asset is deleted once its replacement is
 * recorded, and in that order. An asset removed before the row points somewhere
 * else leaves a live banner with a dead URL if the upload then fails; an asset
 * left behind is storage nobody can find, because the only reference to it was
 * the row that was just overwritten.
 *
 * ⚠️ The source photographs come from `seedHomeBanners.js` rather than a copy,
 * matched by the slug already in the row's public id. A duplicated list would
 * drift the first time an image is swapped, and the symptom is a banner whose
 * picture no longer matches its headline.
 *
 *   node scripts/replaceBannerMedia.js            # what would change
 *   node scripts/replaceBannerMedia.js --apply    # change it
 */
require("dotenv").config({ quiet: true });
const dns = require("dns");
const mongoose = require("mongoose");

const cloudinary = require("../configs/cloudinary");
const { BANNER_TYPE } = require("../constants/banner");
const {
  SCHEDULED,
  EVERGREEN,
  BANNER_WIDTH,
  BANNER_HEIGHT,
  uploadStill,
  uploadAnimated,
} = require("./seedHomeBanners");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const APPLY = process.argv.includes("--apply");

/** slug → spec, the same slugs `seedHomeBanners` writes into the public ids. */
const BY_SLUG = new Map([
  ...SCHEDULED.map((spec, i) => [
    `scheduled_${String(i + 1).padStart(2, "0")}`,
    spec,
  ]),
  ...EVERGREEN.map((spec, i) => [
    `evergreen_${String(i + 1).padStart(2, "0")}`,
    spec,
  ]),
]);

const mediaField = (type) =>
  String(type || "").toUpperCase() === BANNER_TYPE.GIF ? "gif" : "image";

/**
 * The row's slug, taken from its Cloudinary public id (`Banners/evergreen_04`).
 *
 * Falling back to the title is deliberate: a row whose asset was replaced by
 * hand at some point may not carry a recognisable public id any more, and the
 * titles are unique. If neither matches, the row is reported and skipped rather
 * than guessed at — the wrong photograph under a headline is worse than a
 * banner left alone.
 */
const slugFor = (row) => {
  const media = row.image || row.gif || {};
  const publicId = media.storage?.publicId || "";
  const fromId = publicId.split("/").pop();
  if (BY_SLUG.has(fromId)) return fromId;

  for (const [slug, spec] of BY_SLUG) {
    if (spec.title === row.title) return slug;
  }
  return null;
};

const line = (char = "─") => console.log(char.repeat(74));

(async () => {
  await mongoose.connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 15000,
  });
  const Banner = require("../models/Banner");

  console.log(`\n  database:   ${mongoose.connection.name}`);
  console.log(`  cloudinary: ${cloudinary.config().cloud_name}`);
  console.log(`  new size:   ${BANNER_WIDTH} x ${BANNER_HEIGHT}`);
  if (!APPLY) {
    console.log("\n── DRY RUN ── nothing is uploaded, deleted or written.");
    console.log("   Re-run with --apply to do it for real.");
  }

  const rows = await Banner.find({}).sort({ createdAt: 1 });
  console.log(`\n  ${rows.length} banners\n`);

  const unmatched = [];
  let replaced = 0;
  let assetsRemoved = 0;

  for (const row of rows) {
    const slug = slugFor(row);
    const field = mediaField(row.type);
    const oldPublicId = row[field]?.storage?.publicId || null;

    if (!slug) {
      unmatched.push(row);
      console.log(`   ⚠️  ${String(row.type).padEnd(5)} ${row.title}`);
      console.log("       no matching source photograph — left untouched");
      continue;
    }

    const spec = BY_SLUG.get(slug);
    console.log(`   ${String(row.type).padEnd(5)} ${slug.padEnd(13)} ${row.title}`);

    if (!APPLY) {
      console.log(`       old: ${oldPublicId || "(none)"} → would re-cut and replace`);
      continue;
    }

    const media =
      String(row.type).toUpperCase() === BANNER_TYPE.GIF
        ? await uploadAnimated(spec, slug)
        : await uploadStill(spec, slug);

    // Point the row at the new file **before** destroying the old one. The
    // reverse order leaves a live banner with a dead URL if the upload fails.
    row[field] = { url: media.url, storage: media.storage };
    await row.save();
    replaced += 1;

    // ⚠️ Only when the id actually changed. `uploadStill` writes to the same
    // public id with `overwrite: true`, so on a same-slug re-cut the "old" asset
    // *is* the new one — destroying it here would delete the banner that was
    // just uploaded and leave the row pointing at nothing.
    if (oldPublicId && oldPublicId !== media.storage.publicId) {
      const result = await cloudinary.uploader.destroy(oldPublicId, {
        resource_type: "image",
      });
      console.log(`       destroyed old asset ${oldPublicId} → ${result.result}`);
      if (result.result === "ok") assetsRemoved += 1;
    }

    console.log(
      `       ${media.dimensions} · ${media.frames} frame(s) · ${Math.round(media.bytes / 1024)} KB`,
    );
    console.log(`       ${media.url}`);
  }

  line("═");
  if (!APPLY) {
    console.log(
      `  would replace ${rows.length - unmatched.length} of ${rows.length} banner files at ${BANNER_WIDTH}x${BANNER_HEIGHT}`,
    );
    await mongoose.disconnect();
    return;
  }

  console.log(
    `  replaced ${replaced} files · ${assetsRemoved} superseded assets destroyed · ${unmatched.length} skipped`,
  );

  // Nothing above proves the stored bytes are the right shape — an upload that
  // silently flattened a GIF or kept an old rendition still returns a URL.
  //
  // ⚠️ `pages` has to be asked for. Without `{ pages: true }` the field is
  // simply absent, and treating absent as 1 reported all four GIFs as flattened
  // when every one of them had its three frames. A check that cries wolf is
  // worse than no check: the next real flattening gets waved past.
  const after = await Banner.find({}).lean();
  const sizes = new Set();
  for (const row of after) {
    const publicId = (row.image || row.gif)?.storage?.publicId;
    if (!publicId) continue;
    const asset = await cloudinary.api.resource(publicId, { pages: true });
    sizes.add(`${asset.width}x${asset.height}`);

    if (String(row.type).toUpperCase() !== BANNER_TYPE.GIF) continue;
    if (typeof asset.pages !== "number") {
      console.log(`  ?   ${row.title}: Cloudinary did not report a frame count`);
    } else if (asset.pages < 2) {
      console.log(`  ⚠️  ${row.title} is a GIF with ${asset.pages} frame — it was flattened`);
    }
  }
  console.log(`  distinct stored sizes: ${[...sizes].join(", ")}`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("\n❌", error.message || error);
  if (error.error) console.error("   detail:", JSON.stringify(error.error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
