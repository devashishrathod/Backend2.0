/**
 * Turn a `mongodb+srv://` connection string into the equivalent `mongodb://` one.
 *
 * ### Why you would want to
 *
 * `mongodb+srv://` is a convenience: the driver asks DNS for an **SRV** record to
 * discover the cluster's hosts, and a **TXT** record for its default options.
 * Both go through Node's `dns.resolve*` family, which uses c-ares and its own
 * server list — **not** the OS resolver that everything else on the machine uses.
 *
 * When those two disagree, nothing else on the box looks broken. Browsers work,
 * `ping` works, `npm install` works — and only Mongo fails, instantly, with
 * `querySrv ECONNREFUSED`. On this machine `dns.getServers()` reports
 * `127.0.0.1` with nothing listening there, while the adapters are correctly
 * pointed at 1.1.1.1 and 8.8.8.8.
 *
 * A direct `mongodb://` string carries the hosts inline, so the driver resolves
 * them with `dns.lookup` — the OS path, the one that works. No SRV, no TXT, no
 * fallback needed.
 *
 *     node scripts/convertMongoUrlToDirect.js           # show what it would write
 *     node scripts/convertMongoUrlToDirect.js --apply   # rewrite .env
 *
 * ⚠️ The password is never printed. Every line this prints has the credentials
 * replaced with `***`, and `--apply` writes straight to `.env`.
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;

const APPLY = process.argv.includes("--apply");
const ENV_PATH = path.join(__dirname, "..", ".env");

/** Never let a credential reach a log, a terminal, or a paste buffer. */
const redact = (uri) => uri.replace(/\/\/[^@]*@/, "//***:***@");

(async () => {
  const source = process.env.MONGO_URL;
  if (!source) {
    console.error("MONGO_URL is not set — nothing to convert.");
    process.exit(1);
  }

  if (!source.startsWith("mongodb+srv://")) {
    console.log("MONGO_URL is already a direct connection string. Nothing to do.");
    console.log("  ", redact(source));
    process.exit(0);
  }

  const parsed = new URL(source);
  const srvHost = `_mongodb._tcp.${parsed.hostname}`;

  /**
   * Resolved through a resolver we choose, precisely because the default one is
   * the thing that is broken. This runs once, by hand — the app will never do a
   * DNS resolve again after this.
   */
  dns.setServers(["1.1.1.1", "8.8.8.8"]);

  console.log(`Resolving ${srvHost} via 1.1.1.1 …`);

  const [records, txt] = await Promise.all([
    dns.resolveSrv(srvHost),
    dns.resolveTxt(parsed.hostname).catch(() => []),
  ]);

  if (!records.length) {
    console.error("The SRV record came back empty. Is the cluster name right?");
    process.exit(1);
  }

  const hosts = records
    .map((r) => `${r.name}:${r.port}`)
    .sort()
    .join(",");

  /**
   * The TXT record carries the options `+srv` would have applied for you —
   * `authSource` and `replicaSet`. Dropping them is how a converted string
   * authenticates against the wrong database and fails with "bad auth".
   */
  const fromTxt = txt.flat().join("&");
  const options = new URLSearchParams(fromTxt);

  // `+srv` implies TLS. A direct string has to say so.
  options.set("ssl", "true");
  for (const [key, value] of parsed.searchParams) options.set(key, value);
  if (!options.has("retryWrites")) options.set("retryWrites", "true");
  if (!options.has("w")) options.set("w", "majority");

  const database = parsed.pathname.replace(/^\//, "");
  const credentials = parsed.username
    ? `${parsed.username}:${parsed.password}@`
    : "";

  const direct = `mongodb://${credentials}${hosts}/${database}?${options.toString()}`;

  console.log("");
  console.log("hosts    :", hosts);
  console.log("database :", database || "(none)");
  console.log("options  :", options.toString());
  console.log("");
  console.log("new MONGO_URL:", redact(direct));
  console.log("");

  if (!APPLY) {
    console.log("🔍 Dry run. Re-run with --apply to rewrite .env.");
    return;
  }

  if (!fs.existsSync(ENV_PATH)) {
    console.error(`No .env at ${ENV_PATH} — set MONGO_URL by hand.`);
    process.exit(1);
  }

  const env = fs.readFileSync(ENV_PATH, "utf8");
  const line = /^MONGO_URL\s*=.*$/m;

  if (!line.test(env)) {
    console.error("Could not find a MONGO_URL line in .env — set it by hand.");
    process.exit(1);
  }

  /**
   * The old value is kept, commented, on the line above. A direct string pins
   * the cluster's current hosts: if Atlas ever moves or resizes them, `+srv`
   * would have followed automatically and this will not — so the way back has to
   * be sitting right there.
   */
  const replaced = env.replace(
    line,
    `# Was: ${source}\n# ⚠️ Switched to a direct string because this machine's c-ares resolver\n# (dns.getServers()) points at 127.0.0.1 with nothing listening, so the SRV\n# lookup mongodb+srv:// needs fails instantly with ECONNREFUSED. A direct\n# string resolves via dns.lookup (the OS path), which works.\n# ⚠️ It pins today's hosts — if Atlas moves them, restore the line above.\nMONGO_URL=${direct}`,
  );

  fs.writeFileSync(ENV_PATH, replaced, "utf8");
  console.log("✅ .env updated. The old value is kept above it, commented.");
})().catch((error) => {
  console.error("Conversion failed:", error?.message);
  process.exit(1);
});
