/**
 * Keeps the WhatsApp template specification and the generated team documents
 * telling the same story.
 *
 *   node scripts/checkTemplateDocsInSync.js
 *
 * There are three documents and one set of facts. The specification
 * (docs/whatsapp_template_specification.md) is written by hand and holds the
 * reasoning; the two team documents are generated from
 * scripts/generateWhatsappTemplateDoc.js and hold the content. Nothing stopped
 * the hand-written index from drifting away from the generator — and a template
 * is frozen the moment Meta approves it, so a wrong count is a rebuilt template
 * rather than an edit.
 *
 * Compares, per template: the name, the number of body variables and the number
 * of buttons. Exits 1 on any disagreement.
 */

const fs = require("node:fs");
const path = require("node:path");

const { TEMPLATES } = require("./generateWhatsappTemplateDoc");

const specPath = path.join(__dirname, "..", "docs", "whatsapp_template_specification.md");
const spec = fs.readFileSync(specPath, "utf8");

/**
 * The specification's Part 3.1 index — rows like:
 *   | 26 | `vendor_refund_completed` 🆕 | Vendor | 9 | View Settlements |
 * The count column is sometimes bolded (`**10**`) to flag a template at the cap,
 * so the digits are matched inside optional asterisks rather than assumed bare.
 */
const indexed = new Map();
for (const line of spec.split(/\r?\n/)) {
  const m = line.match(
    /^\|\s*(\d+)\s*\|\s*`([a-z_]+)`[^|]*\|\s*(\w+)\s*\|\s*\*{0,2}(\d+)\*{0,2}\s*\|\s*([^|]+?)\s*\|/,
  );
  if (!m) continue;
  const id = Number(m[1]);
  if (id < 1 || id > 200 || indexed.has(id)) continue;
  indexed.set(id, {
    name: m[2],
    role: m[3],
    vars: Number(m[4]),
    buttons: m[5],
  });
}

const problems = [];

if (indexed.size !== TEMPLATES.length) {
  problems.push(
    `the spec's index lists ${indexed.size} templates, the generator has ${TEMPLATES.length}`,
  );
}

for (const t of TEMPLATES) {
  const row = indexed.get(t.id);
  if (!row) {
    problems.push(`#${t.id} ${t.name}: missing from the spec's Part 3.1 index`);
    continue;
  }
  if (row.name !== t.name) {
    problems.push(`#${t.id}: spec calls it \`${row.name}\`, generator calls it \`${t.name}\``);
  }
  if (row.role !== t.role) {
    problems.push(`#${t.id} ${t.name}: spec says ${row.role}, generator says ${t.role}`);
  }
  if (row.vars !== t.vars.length) {
    problems.push(
      `#${t.id} ${t.name}: spec says ${row.vars} variables, generator has ${t.vars.length}`,
    );
  }
  // The spec writes buttons as prose ("Download Advice + Open Dispute"), so only
  // the count is comparable — which is the number that actually matters, because
  // a two-button template cannot be sent until the provider setting is confirmed.
  const specButtons = row.buttons.split("+").length;
  if (specButtons !== t.buttons.length) {
    problems.push(
      `#${t.id} ${t.name}: spec shows ${specButtons} button(s) ("${row.buttons}"), generator has ${t.buttons.length}`,
    );
  }
}

for (const id of indexed.keys()) {
  if (!TEMPLATES.some((t) => t.id === id)) {
    problems.push(`#${id} ${indexed.get(id).name}: in the spec's index but not in the generator`);
  }
}

if (problems.length) {
  console.error(`${problems.length} disagreement(s) between the spec and the generator:\n`);
  problems.forEach((p) => console.error("  " + p));
  console.error("");
  console.error("The generator is the source of truth for content. Fix the spec's Part 3.1 index,");
  console.error("or the generator's data if the spec is the one that is right.");
  process.exit(1);
}

console.log(`In sync: ${TEMPLATES.length} templates match across the spec and the generator.`);
