const {
  getNextMediaSortOrder,
  resequenceMedias,
} = require("../../helpers/showcases/validateMedia");

/**
 * S-2 (S-12) — the stored `sortOrder` is dense 1..n over **non-deleted** media.
 *
 * Two numbers wear this name and only one of them lives in the database. This is
 * the stored one: it is dense over everything the vendor can still see in their
 * own panel, hidden media included, so switching a media back on returns it to
 * the place they left it. The customer's position is computed per read over the
 * *visible* media and is never written — that half is S-4.
 *
 * ### Why the deleted rows keep their old number (S-5)
 *
 * They are an audit record. Zeroing them would collide with the schema default,
 * and a deleted row at `sortOrder: 0` sorts in front of everything the moment
 * anything reads the raw array — which the clips aggregation does.
 */

const media = (sortOrder, overrides = {}) => ({
  sortOrder,
  isDeleted: false,
  isActive: true,
  ...overrides,
});

const orders = (medias) => medias.map((item) => item.sortOrder);

describe("getNextMediaSortOrder", () => {
  test("an empty section starts at 1", () => {
    expect(getNextMediaSortOrder([])).toBe(1);
    expect(getNextMediaSortOrder()).toBe(1);
  });

  test("three live media put the next one at 4", () => {
    expect(getNextMediaSortOrder([media(1), media(2), media(3)])).toBe(4);
  });

  /**
   * 🔴 The drift this replaces.
   *
   * `max(sortOrder) + 1` counted deleted rows, whose numbers stay where they
   * were. A section that had eight photos and now holds two answered 9, the
   * panel showed `1, 2, 9`, and the next upload read 9 and answered 10 — so it
   * never came back on its own.
   */
  test("deleted media do not push the next position up", () => {
    const medias = [
      media(1),
      media(2, { isDeleted: true, isActive: false }),
      media(3, { isDeleted: true, isActive: false }),
      media(8, { isDeleted: true, isActive: false }),
    ];

    expect(getNextMediaSortOrder(medias)).toBe(2);
  });

  /** Hidden is not deleted — it still holds a place. */
  test("hidden media still count", () => {
    const medias = [media(1), media(2, { isActive: false }), media(3)];

    expect(getNextMediaSortOrder(medias)).toBe(4);
  });
});

describe("resequenceMedias", () => {
  test("a section already dense is left alone", () => {
    const medias = [media(1), media(2), media(3)];

    expect(resequenceMedias(medias)).toBe(false);
    expect(orders(medias)).toEqual([1, 2, 3]);
  });

  test("the gap a delete leaves is closed", () => {
    const medias = [
      media(1),
      media(2, { isDeleted: true, isActive: false }),
      media(3),
    ];

    expect(resequenceMedias(medias)).toBe(true);
    // The live pair is 1, 2. The deleted row keeps the 2 it already had — it is
    // not counted and not moved, so the raw array does carry that number twice.
    expect(orders([medias[0], medias[2]])).toEqual([1, 2]);
    expect(medias[1].sortOrder).toBe(2);
    expect(orders(medias)).toEqual([1, 2, 2]);
  });

  test("hidden media are renumbered with the rest", () => {
    const medias = [media(1), media(5, { isActive: false }), media(9)];

    expect(resequenceMedias(medias)).toBe(true);
    expect(orders(medias)).toEqual([1, 2, 3]);
  });

  /**
   * The vendor's arrangement is the input, not the array order. Closing a gap
   * must never reshuffle what they dragged into place.
   */
  test("the existing order is preserved, only the gaps close", () => {
    const medias = [
      media(30, { id: "c" }),
      media(10, { id: "a" }),
      media(20, { id: "b" }),
    ];

    resequenceMedias(medias);

    expect(medias.map((item) => [item.id, item.sortOrder])).toEqual([
      ["c", 3],
      ["a", 1],
      ["b", 2],
    ]);
  });

  /**
   * Two media sharing a position is a state the old reorder could produce — hide
   * one, reorder the rest, switch it back on. Resolving it by array order makes
   * the outcome the same every time instead of depending on the sort.
   */
  test("a duplicate position is broken deterministically", () => {
    const medias = [
      media(2, { id: "first" }),
      media(2, { id: "second" }),
      media(1, { id: "zeroth" }),
    ];

    resequenceMedias(medias);

    expect(medias.map((item) => [item.id, item.sortOrder])).toEqual([
      ["first", 2],
      ["second", 3],
      ["zeroth", 1],
    ]);
  });

  test("a section of only deleted media changes nothing", () => {
    const medias = [
      media(1, { isDeleted: true }),
      media(2, { isDeleted: true }),
    ];

    expect(resequenceMedias(medias)).toBe(false);
    expect(orders(medias)).toEqual([1, 2]);
  });

  test("an empty section is safe", () => {
    expect(resequenceMedias([])).toBe(false);
    expect(resequenceMedias()).toBe(false);
  });

  /**
   * The pair that has to agree: after a delete closes the gap, the next upload
   * lands exactly one past the last photo. These two used to disagree, which is
   * how `1, 2, 9` happened.
   */
  test("resequence and the next position agree after a delete", () => {
    const medias = [media(1), media(2), media(3)];

    medias[1].isDeleted = true;
    medias[1].isActive = false;
    resequenceMedias(medias);

    expect(orders([medias[0], medias[2]])).toEqual([1, 2]);
    expect(getNextMediaSortOrder(medias)).toBe(3);
  });
});
