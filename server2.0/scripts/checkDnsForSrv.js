/**
 * Can this machine resolve a `mongodb+srv://` connection string?
 *
 * ### Why a dedicated check
 *
 * When this breaks, nothing else looks wrong. Browsers load, `npm install`
 * works, `ping` answers — because all of those use the OS resolver. Only Mongo
 * fails, instantly, with `querySrv ECONNREFUSED`, and the obvious conclusion
 * ("the cluster is down", "the password changed", "Atlas is blocking my IP") is
 * wrong every time. It cost hours once already.
 *
 * Node has two DNS paths and they can disagree:
 *
 *   dns.lookup   -> the OS resolver. Everything normal uses this.
 *   dns.resolve* -> c-ares, with its own server list. ONLY `+srv` needs this.
 *
 * This prints both, so the difference is visible in one line rather than
 * inferred from a stack trace.
 *
 *     node scripts/checkDnsForSrv.js
 */
require("dotenv").config({ quiet: true });

const dns = require("dns");
const dnsp = dns.promises;

const ok = (s) => `✅ ${s}`;
const bad = (s) => `❌ ${s}`;

(async () => {
  const uri = process.env.MONGO_URL || "";
  const isSrv = uri.startsWith("mongodb+srv://");

  let host = "";
  try {
    host = new URL(uri).hostname;
  } catch {
    /* falls through to the guard below */
  }

  console.log("MONGO_URL scheme :", uri.split("://")[0] || "(not set)");
  console.log("cluster host     :", host || "(unparsed)");
  console.log("c-ares servers   :", dns.getServers().join(", ") || "(none)");
  console.log("");

  if (!host) {
    console.log(bad("MONGO_URL is not set or not a URL — nothing to check."));
    process.exit(1);
  }

  // ---- path 1: the OS resolver, which everything else on the box uses ----
  try {
    const { address } = await dnsp.lookup("mongodb.com");
    console.log(ok(`dns.lookup   (OS)     — mongodb.com is ${address}`));
  } catch (error) {
    console.log(bad(`dns.lookup   (OS)     — ${error.code || error.message}`));
    console.log("   The machine has no working DNS at all. Nothing else here matters.");
    process.exit(1);
  }

  // ---- path 2: c-ares, which is the only thing +srv can use ----
  let caresWorks = true;
  try {
    await dnsp.resolve4("mongodb.com");
    console.log(ok("dns.resolve4 (c-ares) — resolves"));
  } catch (error) {
    caresWorks = false;
    console.log(bad(`dns.resolve4 (c-ares) — ${error.code || error.message}`));
  }

  if (!isSrv) {
    console.log("");
    console.log(
      ok("MONGO_URL is a direct connection string, so it never needs c-ares."),
    );
    return;
  }

  // ---- the two lookups a +srv connection actually performs ----
  try {
    const records = await dnsp.resolveSrv(`_mongodb._tcp.${host}`);
    console.log(ok(`SRV record            — ${records.length} host(s)`));
  } catch (error) {
    console.log(bad(`SRV record            — ${error.code || error.message}`));
  }

  try {
    await dnsp.resolveTxt(host);
    console.log(ok("TXT record            — resolves"));
  } catch (error) {
    console.log(bad(`TXT record            — ${error.code || error.message}`));
  }

  console.log("");

  if (caresWorks) {
    console.log(ok("mongodb+srv:// will connect without any DNS fallback."));
    return;
  }

  /**
   * The shape of the failure names the cause.
   *
   * A loopback-only server list is a **Node bug**, not a misconfigured machine:
   * c-ares 1.34.6 shipped a Windows regression where it fails to read the OS's
   * DNS servers and falls back to `127.0.0.1`, with nothing listening there.
   * nodejs/node#62347, fixed in Node **24.19.0**.
   *
   * ⚠️ Do not go looking at adapters for this. That is where this was first
   * diagnosed and it was wrong — the registry showed no stale static entry, the
   * Wi-Fi adapter was correctly on 1.1.1.1 and 8.8.8.8 the whole time, and an
   * elevated shell made no difference either. Affected releases include v20.20.2
   * and v22.22.2, so downgrading does not help. Only going forward does.
   */
  console.log(bad("c-ares cannot resolve, so mongodb+srv:// will fail."));
  console.log("");

  const servers = dns.getServers();
  const loopbackOnly =
    servers.length > 0 &&
    servers.every((server) => server === "127.0.0.1" || server === "::1");

  if (loopbackOnly) {
    console.log(`   c-ares reports ${servers.join(", ")}, where nothing listens.`);
    console.log("   This is nodejs/node#62347 — a c-ares 1.34.6 regression on Windows,");
    console.log("   not a problem with this machine's DNS settings.");
    console.log("");
    console.log(`   You are on Node ${process.versions.node} (c-ares ${process.versions.ares}).`);
    console.log("   Fix:");
    console.log("     nvm install 24.20.0  &&  nvm use 24.20.0");
  } else {
    console.log("   Its server list is:", servers.join(", "));
    console.log("   Check whether those addresses are reachable from this network.");
  }
})().catch((error) => {
  console.error("Check failed:", error?.message);
  process.exit(1);
});
