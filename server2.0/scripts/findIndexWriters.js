#!/usr/bin/env node
/**
 * Who else is writing to this database?
 *
 * ### The problem this is for
 *
 * `invoiceId_1` — a blanket unique index that rejects the second transaction
 * with no invoice yet — came back on the cluster twice after being dropped.
 * Nothing in this build creates it: commit `59fd080` declared
 * `invoiceId: { unique: true }`, and `3494bb8` replaced it with the named
 * partial index the schema carries today.
 *
 * So an **older build of this same service** is still running somewhere against
 * this cluster, and Mongoose's `autoIndex` rebuilds that path on every restart.
 * `MONGO_AUTO_INDEX=false` cannot stop it: those builds connected with no
 * options at all, long before that switch existed.
 *
 * `reapShadowIndexes` removes what it creates, every hour and at every boot. That
 * keeps production correct. It does not make the writer go away, and while it is
 * alive there is a window each hour in which claims can be rejected. This script
 * is for closing that for good.
 *
 * ### What it can and cannot see
 *
 * ⚠️ `$currentOp` — which would name every connected client and its `appName` —
 * is **not permitted on Atlas shared tiers**. It is tried anyway, because on a
 * dedicated tier it answers the question outright.
 *
 * What is always available is the connection count. Stop everything you know
 * about and read it again: whatever is left is somebody else.
 *
 * ```bash
 * node scripts/findIndexWriters.js
 * ```
 */
require("dotenv").config();
const mongoose = require("mongoose");

const line = (s = "") => console.log(s);

const main = async () => {
  const uri = process.env.MONGO_URL;
  if (!uri) {
    console.error("MONGO_URL is not set.");
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  line(`\n📦 ${db.databaseName}\n`);

  // ---------------------------------------------------------------- shadows
  const collections = await db.listCollections().toArray();
  const shadows = [];
  let guarded = 0;

  for (const { name } of collections) {
    let indexes;
    try {
      indexes = await db.collection(name).indexes();
    } catch {
      continue;
    }
    const partials = indexes.filter((i) => i.unique && i.partialFilterExpression);
    if (!partials.length) continue;
    guarded += partials.length;

    for (const i of indexes) {
      if (!i.unique || i.partialFilterExpression || i.sparse || i.name === "_id_") {
        continue;
      }
      const twin = partials.find(
        (p) => p.name !== i.name && JSON.stringify(p.key) === JSON.stringify(i.key),
      );
      if (twin) shadows.push({ collection: name, index: i.name, replacedBy: twin.name });
    }
  }

  line(`   indexes guarded : ${guarded} partial-unique across ${collections.length} collections`);
  if (shadows.length) {
    line(`   🔴 SHADOW INDEXES PRESENT — ${shadows.length}`);
    for (const s of shadows) {
      line(`        ${s.collection}.${s.index}  (should be ${s.replacedBy} only)`);
    }
    line(`      → they are here NOW, so the other writer restarted recently.`);
    line(`        Check the deploy and restart history of every service pointed`);
    line(`        at this cluster for a restart in the last hour.`);
  } else {
    line(`   ✅ no shadow indexes right now`);
    line(`      (that is not proof the writer is gone — it recreates them on ITS`);
    line(`       restart, and the hourly sweep removes them again)`);
  }

  // ------------------------------------------------------------ connections
  line();
  try {
    const status = await db.admin().command({ serverStatus: 1 });
    const c = status.connections || {};
    line(`   connections     : ${c.current} open · ${c.available} free · ${c.totalCreated} created since boot`);
    line(`      → stop this machine's dev server, the test suite and any panel,`);
    line(`        then run this again. Anything still open is not yours.`);
  } catch (error) {
    line(`   connections     : not permitted (${error.codeName || error.message})`);
  }

  // -------------------------------------------------------------- currentOp
  line();
  try {
    const ops = await db
      .aggregate([
        { $currentOp: { allUsers: true, idleConnections: true } },
        { $group: { _id: { app: "$appName", host: "$client" }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ])
      .toArray();
    line(`   connected clients:`);
    for (const o of ops) {
      line(`        ${o.n.toString().padStart(3)} × ${o._id.app || "(no appName)"}  ${o._id.host || ""}`);
    }
    line(`      → any appName or host you do not recognise is the writer.`);
  } catch (error) {
    line(`   connected clients: $currentOp not permitted on this tier (${error.codeName || "AtlasError"})`);
  }

  // ------------------------------------------------------------- the real fix
  line();
  line("   ─────────────────────────────────────────────────────────────────");
  line("   ⚠️  THE FIX THAT ENDS IT, and it is not in this codebase");
  line("   ─────────────────────────────────────────────────────────────────");
  line("   Whatever the writer is, it reaches this cluster through Atlas");
  line("   Network Access. Narrow that list to the addresses this deployment");
  line("   actually uses and the writer is locked out — permanently, whether or");
  line("   not anybody ever identifies it.");
  line();
  line("     1. Atlas → Network Access → IP Access List.");
  line("        Remove 0.0.0.0/0 if it is there. Remove every Render range once");
  line("        production is on EC2.");
  line("     2. Take an Elastic IP for the EC2 instance so it does not change on");
  line("        restart, and allow only that.");
  line("        GET /my-ip reports the outbound address to add.");
  line("     3. Atlas → Database Access: give the old deployment's user readOnly,");
  line("        or delete it. An account that cannot write cannot create an index.");
  line("     4. Suspend or delete the old Render service itself.");
  line();
  line("   Until that is done, `reapShadowIndexes` keeps production correct — it");
  line("   runs at boot and hourly, and alerts an admin each time it finds one.");
  line();

  await mongoose.disconnect();
  process.exit(shadows.length ? 1 : 0);
};

main().catch((error) => {
  console.error("failed:", error.message);
  process.exit(1);
});
