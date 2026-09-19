/**
 * Fill `Setting.customer.search.popularQueries` — the chips the search box
 * shows before anybody has typed.
 *
 * ### Why this needs a script at all
 *
 * These chips are **admin-curated**, deliberately: nothing on this platform
 * logs what customers search for, so there is no traffic to derive them from
 * (`getPopularSearches` says so, and `constants/customer.js` defaults the list
 * to `[]`). An empty list is a legitimate state — but it means
 * `GET /search/popular` answers `{ isEnabled: true, queries: [] }` and the app
 * opens an empty box for every guest, which is the state this fixes.
 *
 * Production starts on a fresh, empty database, so the same gap will exist on
 * day one. That is what makes this a script rather than a one-off write.
 *
 * ### A chip that finds nothing is worse than no chip
 *
 * So none of these are invented. Candidates are read out of the database —
 * category and sub-category names, verified brand names — plus a small set of
 * evergreen deal phrases, and then **every one is run through the real
 * `globalSearch`**. Anything that returns no rows is dropped before it is ever
 * written. Tapping a chip is a promise that there is something behind it.
 *
 * ⚠️ Coordinates matter. The VOUCHER section starts with `$geoNear`, so a
 * query is scored with a real outlet's coordinates taken from the database —
 * otherwise every voucher-only term looks empty and gets discarded for the
 * wrong reason.
 *
 *   node scripts/seedPopularSearches.js              # what it would write
 *   node scripts/seedPopularSearches.js --apply      # write it
 *   node scripts/seedPopularSearches.js --db Trydood2_postman --apply
 *
 * Dry run by default, like every other script in here.
 */
require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const Setting = require("../models/Setting");
const SubBrand = require("../models/SubBrand");
const Category = require("../models/Category");
const SubCategory = require("../models/SubCategory");
const { globalSearch } = require("../services/search");
const { SEARCH_LIMITS } = require("../constants/search");

const APPLY = process.argv.includes("--apply");

const dbFlag = process.argv.indexOf("--db");
const DB_NAME = dbFlag > -1 ? process.argv[dbFlag + 1] : null;

/**
 * Phrases that describe the *offer* rather than the catalogue.
 *
 * A customer opening the box is usually browsing, not looking for one shop —
 * "weekend" and "50% off" are the shape of that intent, and they match voucher
 * names and offer titles rather than a brand. They are candidates only: like
 * everything else here they are dropped unless the search actually returns
 * something.
 */
const DEAL_PHRASES = [
  "weekend",
  "50% off",
  "30% off",
  "flat off",
  "dining",
  "sale",
];

/** Title-case for display; the search itself is case-insensitive. */
const tidy = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A chip is a tappable word, not a shelf label.
 *
 * The schema allows 100 characters, which is the right cap for the *field* and
 * far too generous for a chip: "Alternative Beverage & Desserts" wraps onto two
 * lines in a horizontal strip and is not a phrase anybody types. 24 is a
 * display limit, deliberately much tighter than the storage one.
 */
const MAX_CHIP_LENGTH = 24;

/**
 * How many of the final ten each kind may contribute.
 *
 * Without this the list is whatever sorts highest, and on a small catalogue
 * that is six sub-categories in alphabetical order — which reads as a dump of
 * the taxonomy rather than a curated row. Chips are worth having because they
 * show the *range* of what is here: something to browse, something on offer,
 * something by name.
 */
const SOURCE_CAPS = Object.freeze({
  "deal phrase": 4,
  "sub-category": 4,
  category: 2,
});

/**
 * ⚠️ Brand names are deliberately **not** a source.
 *
 * A chip is an intent, not a shop — the shapes the docs give as examples are
 * `["pizza", "salon", "weekend offers"]`, and not one of them names a
 * merchant. Putting a brand in the row that every customer sees before they
 * type is a paid-placement decision wearing the clothes of a search
 * convenience, and it is not this script's to make.
 *
 * It also happens to be what a first run got wrong in a way worth recording:
 * with brands in the pool the dev database contributed "Tcs" and "Yrp" — real
 * rows, correctly matched, completely meaningless to a customer.
 */

const connect = async () => {
  let uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not set");
  if (DB_NAME) {
    // Swap only the path segment, leaving credentials and options alone.
    uri = uri.replace(/\/([^/?]*)(\?|$)/, `/${DB_NAME}$2`);
  }
  await mongoose.connect(uri, { maxPoolSize: 5 });
};

/** A real outlet's coordinates, so the VOUCHER section can actually run. */
const anyOutletCoordinates = async () => {
  const outlet = await SubBrand.findOne({
    isActive: true,
    isDeleted: false,
    "geo.coordinates.0": { $exists: true },
  })
    .select("geo")
    .lean();
  if (!outlet) return null;
  const [longitude, latitude] = outlet.geo.coordinates;
  return { latitude, longitude };
};

/**
 * Everything worth offering, newest intent first.
 *
 * Sub-categories lead because they are what a customer actually types — "Spa",
 * "Car Wash" — where a category is often a shelf label nobody says out loud.
 */
const buildCandidates = async () => {
  const [subCategories, categories] = await Promise.all([
    SubCategory.find({ isActive: true, isDeleted: false })
      .select("name")
      .lean(),
    Category.find({ isActive: true, isDeleted: false }).select("name").lean(),
  ]);

  const seen = new Set();
  const out = [];
  const skipped = [];
  const push = (raw, source) => {
    const value = tidy(raw);
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (value.length > MAX_CHIP_LENGTH) {
      skipped.push({ value, reason: `too long for a chip (${value.length})` });
      return;
    }
    out.push({ value, source });
  };

  subCategories.forEach((row) => push(row.name, "sub-category"));
  DEAL_PHRASES.forEach((row) => push(row, "deal phrase"));
  categories.forEach((row) => push(row.name, "category"));

  return { candidates: out, tooLong: skipped };
};

/**
 * "Dining" and "Food & Dining" are one chip's worth of information in two
 * slots. Whichever scored better keeps the slot; the other gives way to
 * something that shows the customer a different part of the catalogue.
 */
const overlaps = (a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
};

/**
 * Ten chips that show the range of the catalogue, not the top of an alphabet.
 *
 * Ranking by hits alone collapses on a small catalogue, where almost everything
 * returns exactly one row and the tiebreak decides the whole list — which is
 * how a first attempt produced "Accessories, Alternative Beverage & Desserts,
 * Asipl, Bags & Wallets, Banquet Halls". Correct by the letter, useless as a
 * row of chips.
 *
 * So: sort inside each kind, then take them in turn up to that kind's cap, and
 * only then let whatever is left fill the remaining slots.
 */
const selectChips = (scored, limit) => {
  const byLength = (a, b) =>
    b.hits - a.hits || a.value.length - b.value.length || a.value.localeCompare(b.value);

  const buckets = new Map();
  for (const row of scored) {
    if (!buckets.has(row.source)) buckets.set(row.source, []);
    buckets.get(row.source).push(row);
  }
  for (const rows of buckets.values()) rows.sort(byLength);

  const chosen = [];
  const add = (row) => {
    if (!row) return false;
    if (chosen.some((c) => overlaps(c.value, row.value))) return false;
    chosen.push(row);
    return true;
  };

  const order = Object.keys(SOURCE_CAPS);
  // Round-robin, so the first few chips are already a mix rather than four of
  // one kind followed by four of another. Indexes advance per bucket rather
  // than per pass, so a candidate rejected as a near-duplicate does not cost
  // its bucket a slot.
  const cursor = new Map(order.map((s) => [s, 0]));
  for (let pass = 0; chosen.length < limit; pass += 1) {
    let progressed = false;
    for (const source of order) {
      if (pass >= (SOURCE_CAPS[source] ?? 0)) continue;
      const rows = buckets.get(source) || [];
      let i = cursor.get(source);
      while (i < rows.length && !add(rows[i])) i += 1;
      if (i < rows.length) {
        cursor.set(source, i + 1);
        progressed = true;
      } else {
        cursor.set(source, i);
      }
      if (chosen.length === limit) break;
    }
    if (!progressed) break;
  }

  // Caps are a shape, not a quota — an empty slot is worse than an extra
  // sub-category, so anything still unused fills the rest.
  if (chosen.length < limit) {
    const taken = new Set(chosen.map((r) => r.value));
    for (const row of [...scored].sort(byLength)) {
      if (chosen.length === limit) break;
      if (taken.has(row.value)) continue;
      add(row);
    }
  }

  return chosen.sort(byLength);
};

/** Total rows the real search returns for one term. */
const scoreQuery = async (term, coordinates) => {
  const result = await globalSearch(null, {
    q: term,
    ...(coordinates || {}),
  });
  const sections = result.sections || [];
  const hits = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0);
  const kinds = sections
    .filter((s) => (s.items?.length || 0) > 0)
    .map((s) => s.type);
  return { hits, kinds };
};

const main = async () => {
  await connect();
  console.log(`\n  database: ${mongoose.connection.name}`);
  console.log(`  mode:     ${APPLY ? "APPLY" : "dry run"}\n`);

  const coordinates = await anyOutletCoordinates();
  if (!coordinates) {
    console.log(
      "  ⚠️  No outlet has coordinates — VOUCHER results cannot be scored,\n" +
        "      so voucher-only phrases will look empty and be skipped.\n",
    );
  }

  const { candidates, tooLong } = await buildCandidates();
  console.log(`  ${candidates.length} candidates from the database`);
  if (tooLong.length) {
    console.log(
      `  (${tooLong.length} skipped before scoring — ${tooLong.map((t) => `"${t.value}"`).join(", ")})`,
    );
  }
  console.log("");

  const kept = [];
  const dropped = [];
  for (const candidate of candidates) {
    // Sequential on purpose: each one runs a $geoNear aggregation, and firing
    // ~40 of those at a shared dev cluster at once is how a script becomes the
    // reason somebody else's request times out.
    let score;
    try {
      score = await scoreQuery(candidate.value, coordinates);
    } catch (error) {
      dropped.push({ ...candidate, reason: `error: ${error.message}` });
      continue;
    }
    if (score.hits > 0) kept.push({ ...candidate, ...score });
    else dropped.push({ ...candidate, reason: "no results" });
  }

  const chosen = selectChips(kept, SEARCH_LIMITS.MAX_POPULAR_QUERIES);

  console.log(`  ✅ ${kept.length} return results, keeping top ${chosen.length}:\n`);
  chosen.forEach((row, i) => {
    console.log(
      `   ${String(i + 1).padStart(2)}. ${row.value.padEnd(24)} ${String(row.hits).padStart(3)} hits   ${row.kinds.join(", ")}   (${row.source})`,
    );
  });

  if (dropped.length) {
    console.log(`\n  ✗ ${dropped.length} skipped (nothing behind them):`);
    console.log(
      "     " + dropped.map((d) => d.value).join(" · "),
    );
  }

  if (!chosen.length) {
    console.log("\n  Nothing to write — no candidate returned any result.");
    await mongoose.disconnect();
    return;
  }

  const queries = chosen.map((row) => row.value);

  if (!APPLY) {
    console.log("\n  Would write customer.search.popularQueries:");
    console.log("   " + JSON.stringify(queries));
    console.log("\n  Re-run with --apply to do it for real.\n");
    await mongoose.disconnect();
    return;
  }

  /**
   * `updateOne` on the single settings document, upserting if this is a fresh
   * database. Only the one path is touched — a `$set` of the whole `search`
   * block would silently reset `minQueryLength`, `sectionLimit` and
   * `historyLimit` to whatever this script happened to think they were.
   */
  const result = await Setting.updateOne(
    {},
    { $set: { "customer.search.popularQueries": queries } },
    { upsert: true },
  );

  console.log(
    `\n  ✅ written (matched ${result.matchedCount}, modified ${result.modifiedCount}${result.upsertedId ? ", created the settings document" : ""})`,
  );

  // Read it back through the same helper the endpoint uses, so this reports
  // what a customer will actually receive rather than what we just sent.
  const { getPopularSearches } = require("../services/search");
  const live = await getPopularSearches();
  console.log(`  GET /search/popular now returns ${live.queries.length} chips:`);
  console.log("   " + JSON.stringify(live.queries) + "\n");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("\n  failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
