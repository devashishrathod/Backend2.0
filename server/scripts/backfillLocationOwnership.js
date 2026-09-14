/**
 * ------------- the owner a Location never recorded, and its duplicates -------------
 *
 * Three writes into `Location` asked only for an id, so nothing on the row said
 * whose address it was. The code is fixed; this brings the existing rows up to
 * what it now guarantees, and the guarantee cannot be turned into a constraint
 * until it has run.
 *
 * ### What is missing, and why
 *
 * **`kind`** — new. The two booleans it replaces could disagree with each other
 * and with the ids beside them, and did: rows carry a `brandId` while
 * `isBrandAddress` is `false`, and no row anywhere has it `true`. So `kind` is
 * derived from the **ids**, which are the thing that was always right, and the
 * booleans are then rewritten from `kind` rather than read.
 *
 * **`userId`** — `createLocation` set it to `undefined` on purpose for anything
 * that was not a customer's own address. It is read off the parent here: the
 * brand's owner, or the outlet's user.
 *
 * **`brandId` on an outlet's address** — never written. Without it, "every
 * address under this brand" needs a `$in` over every outlet id, and that same
 * query is what scopes a vendor's listing to their own rows.
 *
 * ### The duplicates
 *
 * A parent points at one address through `locationId`, but nothing ever stopped
 * a second being created — `Location.create()` and the pointer update were two
 * separate writes, so a failure between them left an address nothing referenced
 * and the next attempt made another. The result is live rows that no parent
 * points at, and a panel showing one address while the listing shows three.
 *
 * The one the parent actually points at is kept. Anything else for the same
 * parent is soft-deleted — not removed, because a wrong guess here should be
 * recoverable.
 *
 * ⚠️ Run this **before** the unique indexes. They are partial on
 * `{ kind, isDeleted: false }`, so with duplicates present the build fails with
 * `E11000` and names one pair rather than the problem.
 *
 *   node scripts/backfillLocationOwnership.js            # what would change
 *   node scripts/backfillLocationOwnership.js --apply    # change it
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { LOCATION_KINDS } = require("../constants/location");

const APPLY = process.argv.includes("--apply");

const id = (value) => (value ? String(value) : null);

/** An outlet's address carries its brand too, so `subBrandId` decides first. */
const kindOf = (row) => {
  if (row.subBrandId) return LOCATION_KINDS.SUB_BRAND;
  if (row.brandId) return LOCATION_KINDS.BRAND;
  if (row.customerId || row.userId) return LOCATION_KINDS.CUSTOMER;
  return null;
};

const flagsFor = (kind) => ({
  isBrandAddress: kind === LOCATION_KINDS.BRAND,
  isSubBrandAddress: kind === LOCATION_KINDS.SUB_BRAND,
});

const main = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  console.log(`\ndatabase: ${mongoose.connection.name}`);
  console.log(APPLY ? "mode: APPLY — writing\n" : "mode: dry run — nothing is written\n");

  const locations = await db.collection("locations").find({}).toArray();
  if (!locations.length) {
    console.log("No locations. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Parents, read once. A missing one is reported rather than guessed at.
  const outlets = new Map(
    (await db.collection("subbrands").find({}).toArray()).map((s) => [id(s._id), s]),
  );
  const brands = new Map(
    (await db.collection("brands").find({}).toArray()).map((b) => [id(b._id), b]),
  );
  const customers = new Map(
    (await db.collection("customers").find({}).toArray()).map((c) => [id(c._id), c]),
  );
  const usersByCustomer = new Map(
    (await db.collection("users").find({ customerId: { $ne: null } }).toArray()).map(
      (u) => [id(u.customerId), u],
    ),
  );

  const updates = [];
  const orphans = [];
  const unowned = [];

  for (const row of locations) {
    const kind = kindOf(row);
    if (!kind) {
      unowned.push(row);
      continue;
    }

    const set = {};
    if (row.kind !== kind) set.kind = kind;

    const flags = flagsFor(kind);
    if (row.isBrandAddress !== flags.isBrandAddress) {
      set.isBrandAddress = flags.isBrandAddress;
    }
    if (row.isSubBrandAddress !== flags.isSubBrandAddress) {
      set.isSubBrandAddress = flags.isSubBrandAddress;
    }

    if (kind === LOCATION_KINDS.SUB_BRAND) {
      const outlet = outlets.get(id(row.subBrandId));
      if (!outlet) {
        orphans.push({ row, missing: "SubBrand" });
        continue;
      }
      if (id(row.userId) !== id(outlet.userId)) set.userId = outlet.userId;
      if (id(row.brandId) !== id(outlet.brandId)) set.brandId = outlet.brandId;
    } else if (kind === LOCATION_KINDS.BRAND) {
      const brand = brands.get(id(row.brandId));
      if (!brand) {
        orphans.push({ row, missing: "Brand" });
        continue;
      }
      if (id(row.userId) !== id(brand.userId)) set.userId = brand.userId;
    } else {
      // A customer address may know either id; the other is filled from it.
      let customerId = id(row.customerId);
      let userId = id(row.userId);
      if (!customerId && userId) {
        const byUser = [...customers.values()].find((c) => id(c.userId) === userId);
        customerId = byUser ? id(byUser._id) : null;
      }
      if (!userId && customerId) {
        const user = usersByCustomer.get(customerId);
        userId = user ? id(user._id) : null;
      }
      if (!customerId || !userId) {
        orphans.push({ row, missing: "Customer" });
        continue;
      }
      if (id(row.customerId) !== customerId) set.customerId = new mongoose.Types.ObjectId(customerId);
      if (id(row.userId) !== userId) set.userId = new mongoose.Types.ObjectId(userId);
    }

    if (Object.keys(set).length) updates.push({ _id: row._id, kind, set });
  }

  // ---- duplicates ---------------------------------------------------------
  // Grouped on what the new unique indexes will group on, and only among rows
  // that are still live — a soft-deleted row is not a conflict.
  const groups = new Map();
  for (const row of locations) {
    if (row.isDeleted) continue;
    const kind = kindOf(row);
    if (!kind) continue;
    const key =
      kind === LOCATION_KINDS.SUB_BRAND
        ? `SUB_BRAND:${id(row.subBrandId)}`
        : kind === LOCATION_KINDS.BRAND
          ? `BRAND:${id(row.brandId)}`
          : `CUSTOMER:${id(row.userId) || id(row.customerId)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const toSoftDelete = [];
  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;

    const [type, parentId] = key.split(":");
    const parent =
      type === "SUB_BRAND"
        ? outlets.get(parentId)
        : type === "BRAND"
          ? brands.get(parentId)
          : null;

    /**
     * The one the parent points at wins. That is the address the panel and the
     * customer app are already showing, so keeping any other would change what
     * is on screen — a migration should not do that. With no pointer to follow,
     * the newest is kept.
     */
    const pointed = parent?.locationId
      ? rows.find((r) => id(r._id) === id(parent.locationId))
      : null;
    const keep =
      pointed ||
      [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    for (const row of rows) {
      if (id(row._id) !== id(keep._id)) {
        toSoftDelete.push({ row, key, keptId: id(keep._id), reason: pointed ? "parent points elsewhere" : "newer row kept" });
      }
    }
  }

  // ---- report -------------------------------------------------------------
  const byField = { kind: 0, userId: 0, brandId: 0, customerId: 0, flags: 0 };
  for (const u of updates) {
    if (u.set.kind) byField.kind += 1;
    if (u.set.userId) byField.userId += 1;
    if (u.set.brandId) byField.brandId += 1;
    if (u.set.customerId) byField.customerId += 1;
    if (u.set.isBrandAddress !== undefined || u.set.isSubBrandAddress !== undefined) {
      byField.flags += 1;
    }
  }

  console.log(`locations: ${locations.length}\n`);
  console.log(`rows to update: ${updates.length}`);
  console.log(`  kind set          ${byField.kind}`);
  console.log(`  userId filled     ${byField.userId}`);
  console.log(`  brandId filled    ${byField.brandId}`);
  console.log(`  customerId filled ${byField.customerId}`);
  console.log(`  flags corrected   ${byField.flags}`);

  console.log(`\nduplicates to soft-delete: ${toSoftDelete.length}`);
  for (const d of toSoftDelete) {
    console.log(`  ${d.key}  drop ${id(d.row._id)}  (keeping ${d.keptId} — ${d.reason})`);
  }

  if (orphans.length) {
    console.log(`\n⚠️  ${orphans.length} row(s) whose parent no longer exists — left alone:`);
    for (const o of orphans) console.log(`  ${id(o.row._id)}  missing ${o.missing}`);
    console.log("  These cannot be given an owner. Delete them by hand, or leave them.");
  }
  if (unowned.length) {
    console.log(`\n⚠️  ${unowned.length} row(s) with no owning id at all — left alone:`);
    for (const u of unowned) console.log(`  ${id(u._id)}`);
  }

  if (!APPLY) {
    if (updates.length || toSoftDelete.length) {
      console.log("\nRe-run with --apply to write.");
    } else {
      console.log("\nNothing to change.");
    }
    await mongoose.disconnect();
    return;
  }

  // ---- apply --------------------------------------------------------------
  const ops = [
    ...updates.map((u) => ({
      updateOne: { filter: { _id: u._id }, update: { $set: u.set } },
    })),
    ...toSoftDelete.map((d) => ({
      updateOne: {
        filter: { _id: d.row._id },
        update: { $set: { isDeleted: true, isActive: false } },
      },
    })),
  ];

  if (!ops.length) {
    console.log("\nNothing to change.");
    await mongoose.disconnect();
    return;
  }

  const result = await db.collection("locations").bulkWrite(ops, { ordered: false });
  console.log(`\nwritten: ${result.modifiedCount} row(s) modified.`);

  const stillMissing = await db.collection("locations").countDocuments({
    $or: [{ kind: { $exists: false } }, { userId: null }, { userId: { $exists: false } }],
  });
  console.log(
    stillMissing
      ? `⚠️  ${stillMissing} row(s) still have no kind or no userId — the unique indexes and the required fields will refuse these.`
      : "every row now has a kind and an owner.",
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("\nFailed:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
