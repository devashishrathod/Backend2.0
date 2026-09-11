/**
 * ---------------- every phone number, one spelling ----------------
 *
 * `isValidPhoneNumber` used to accept `9876543210`, `919876543210` and
 * `+919876543210` — three strings for one phone, all valid. The partial unique
 * indexes on `{whatsappNumber, role}`, `{mobile, role}` are indexes on a
 * **string**, so the same person could hold three accounts on one number and
 * nothing would refuse any of them. See `validator/common.js`.
 *
 * The code side is fixed (a Mongoose setter in `models/contactFields.js` and a
 * Joi normaliser in `validator/validJoiPhone.js`), so nothing new can drift. This
 * brings existing rows to the same spelling.
 *
 * ### ⚠️ Collisions are reported, never merged
 *
 * If two live rows normalise to the same `{number, role}`, writing both would
 * violate the unique index — and picking a winner is a decision about which
 * person's account survives. That is not a script's call. Those pairs are listed
 * and left exactly as they are; the rest still get normalised.
 *
 *   node scripts/normalisePhoneNumbers.js            # what would change
 *   node scripts/normalisePhoneNumbers.js --apply    # change it
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { normalisePhone } = require("../validator/common");

const APPLY = process.argv.includes("--apply");

/**
 * Which collections hold a phone, and which paths.
 *
 * `role` is carried because the unique indexes are on `{field, role}` — a
 * collision only matters within one role. Only `User` has a role; the mirrors
 * inherit theirs from the owning user, and they carry no unique index at all, so
 * they can never collide.
 */
const TARGETS = Object.freeze([
  { collection: "users", fields: ["mobile", "whatsappNumber"], roleScoped: true },
  { collection: "customers", fields: ["mobile", "whatsappNumber"], roleScoped: false },
  { collection: "brands", fields: ["mobile", "whatsappNumber"], roleScoped: false },
  { collection: "subbrands", fields: ["mobile", "whatsappNumber"], roleScoped: false },
]);

const main = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;

  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(APPLY ? "Mode: APPLY — rows will be written\n" : "Mode: DRY RUN — nothing will be written\n");

  let totalChanged = 0;
  let totalBlocked = 0;

  for (const target of TARGETS) {
    const col = db.collection(target.collection);
    const changes = [];

    for (const field of target.fields) {
      const rows = await col
        .find({ [field]: { $type: "string", $ne: "" } })
        .project({ [field]: 1, role: 1, isDeleted: 1 })
        .toArray();

      for (const row of rows) {
        const before = row[field];
        const after = normalisePhone(before);
        if (after === before) continue;
        changes.push({ _id: row._id, field, before, after, role: row.role, isDeleted: row.isDeleted });
      }
    }

    if (!changes.length) {
      console.log(`${target.collection}: nothing to change`);
      continue;
    }

    /**
     * Would normalising create a duplicate the unique index will refuse?
     *
     * Checked against the rows that will **still be live** afterwards, and only
     * where an index exists — `isDeleted: true` releases a number on purpose, so
     * a soft-deleted row sharing the value is not a collision.
     */
    const blocked = new Set();
    if (target.roleScoped) {
      for (const change of changes) {
        if (change.isDeleted === true) continue;
        const clash = await col.findOne(
          {
            _id: { $ne: change._id },
            [change.field]: change.after,
            role: change.role,
            isDeleted: false,
          },
          { projection: { _id: 1 } },
        );
        if (clash) {
          blocked.add(String(change._id) + change.field);
          console.log(
            `  ⚠️  ${target.collection} ${change._id} ${change.field}: ` +
              `"${change.before}" → "${change.after}" COLLIDES with ${clash._id} ` +
              `(role ${change.role}) — left unchanged, needs a human`,
          );
        }
      }
    }

    const writable = changes.filter((c) => !blocked.has(String(c._id) + c.field));

    console.log(
      `${target.collection}: ${writable.length} to normalise` +
        (blocked.size ? `, ${blocked.size} blocked by a collision` : ""),
    );
    for (const c of writable.slice(0, 10)) {
      console.log(`    ${c._id} ${c.field}: "${c.before}" → "${c.after}"`);
    }
    if (writable.length > 10) console.log(`    … and ${writable.length - 10} more`);

    if (APPLY && writable.length) {
      /**
       * ⚠️ The raw driver, not the model — deliberately.
       *
       * Going through Mongoose would run the setter and re-validate every other
       * path on the document, so one row with an unrelated legacy problem
       * (a missing `uniqueId`, an enum value since removed) would fail a
       * migration that has nothing to do with it.
       */
      const ops = writable.map((c) => ({
        updateOne: { filter: { _id: c._id }, update: { $set: { [c.field]: c.after } } },
      }));
      const result = await col.bulkWrite(ops, { ordered: false });
      console.log(`    written: ${result.modifiedCount}`);
    }

    totalChanged += writable.length;
    totalBlocked += blocked.size;
  }

  console.log(
    `\n${APPLY ? "Normalised" : "Would normalise"}: ${totalChanged}` +
      (totalBlocked ? ` · Blocked by collisions: ${totalBlocked}` : " · No collisions"),
  );
  if (!APPLY && totalChanged) console.log("Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("\nFailed:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
