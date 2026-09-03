require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const dns = require("dns");

const connect = async () => {
  try { await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 }); }
  catch (e) {
    if (!/querySrv|ECONNREFUSED|ENOTFOUND/i.test(e?.message || "")) throw e;
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 });
  }
};

(async () => {
  await connect();
  const db = mongoose.connection.db;
  console.log(`📦 ${mongoose.connection.name} @ ${mongoose.connection.host}\n`);

  const idx = await db.collection("transactions").listIndexes().toArray();
  console.log("transactions indexes:");
  for (const i of idx) {
    const flags = [
      i.unique ? "UNIQUE" : "",
      i.partialFilterExpression ? "partial" : (i.unique ? "⚠️ BLANKET" : ""),
    ].filter(Boolean).join(" ");
    console.log(`   ${i.name.padEnd(38)} ${JSON.stringify(i.key)}  ${flags}`);
  }

  // Who else is connected to this cluster right now?
  console.log("\nconnected clients (currentOp):");
  try {
    const ops = await db.admin().command({ currentOp: 1, $all: true });
    const apps = new Map();
    for (const op of ops.inprog || []) {
      const key = `${op.appName || "?"} | ${op.client || op.client_s || "?"}`;
      apps.set(key, (apps.get(key) || 0) + 1);
    }
    if (apps.size) for (const [k, v] of apps) console.log(`   ${v}×  ${k}`);
    else console.log("   (none reported)");
  } catch (e) {
    console.log(`   ⛔ blocked on this tier: ${e.codeName || e.message}`);
  }

  console.log("\nserver build info:");
  try {
    const info = await db.admin().command({ buildInfo: 1 });
    console.log(`   MongoDB ${info.version}`);
  } catch (e) { console.log(`   ⛔ ${e.codeName || e.message}`); }

  await mongoose.disconnect();
})().catch(async (e) => { console.error("❌", e.message); await mongoose.disconnect().catch(()=>{}); });
