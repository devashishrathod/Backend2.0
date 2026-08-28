/**
 * Refuses a collection whose request names are not unique.
 *
 * Example capture ties a live response back to an item by request name, because
 * that is the only key both representations share. If two requests ever share a
 * name, examples would attach to whichever one was walked first — silently, and
 * looking entirely correct. Failing here turns that into a build error.
 */
module.exports = (items) => {
  const seen = new Map();
  const dupes = [];

  const walk = (nodes, trail) => {
    for (const node of nodes) {
      const here = trail ? `${trail} / ${node.name}` : node.name;
      if (node.item) {
        walk(node.item, here);
        continue;
      }
      if (seen.has(node.name)) dupes.push([seen.get(node.name), here]);
      else seen.set(node.name, here);
    }
  };

  walk(items, "");

  if (dupes.length) {
    console.error(
      `\n✗ ${dupes.length} duplicate request name(s) — examples would attach to the wrong request:\n`,
    );
    dupes.forEach(([a, b]) => console.error(`   "${a}"\n   "${b}"\n`));
    process.exit(2);
  }
};
