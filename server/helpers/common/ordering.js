const { throwError } = require("../../utils");

/**
 * Reordering a list the vendor sent back, whatever the list is of.
 *
 * ### ⚠️ These live here rather than beside one surface
 *
 * They started in `helpers/showcases/validateMedia.js`, because showcase
 * sections were the only thing that could be reordered. None of them knows what
 * a section is — they take a list, a key, and a number — and voucher images
 * needed exactly the same three (V-7). A voucher service reaching into
 * `helpers/showcases` would be a dependency that means nothing, and a second
 * copy would be two places for one rule to drift.
 */

/**
 * Renumber a payload densely, 1..n, in the order it asks for.
 *
 * ⚠️ The caller's numbers decide the **order**, not the result. Somebody who
 * sends 10, 20, 30 gets 1, 2, 3 — the gaps were never meaningful, and keeping
 * them means the next insert has to guess what the vendor meant by them.
 */
exports.normalizeSortOrder = (items = []) => {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({
      ...item,
      sortOrder: index + 1,
    }));
};

/**
 * ⚠️ `id` is what the validators accept and what the docs publish. The default
 * used to be `sectionId`, a key no payload ever carries, so any caller that
 * forgot to pass the key dereferenced `undefined` and answered 500.
 */
exports.validateUniqueIds = (items = [], key = "id") => {
  const ids = new Set();
  for (const item of items) {
    const value = item[key].toString();
    if (ids.has(value)) {
      throwError(400, `Duplicate ${key} found.`);
    }
    ids.add(value);
  }
};

exports.validateUniqueSortOrders = (items = [], key = "sortOrder") => {
  const values = new Set();
  for (const item of items) {
    if (values.has(item[key])) {
      throwError(400, "Duplicate sort order found.");
    }
    values.add(item[key]);
  }
};
