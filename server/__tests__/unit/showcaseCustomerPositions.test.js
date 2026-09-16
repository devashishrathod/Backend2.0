const mongoose = require("mongoose");

const {
  customerSectionMatch,
  customerMediaFields,
  applyDisplayPositions,
} = require("../../helpers/showcases/projections");

/**
 * S-4 — what a customer is shown, and what number it is shown at.
 *
 * ### 🔴 Two different numbers wear the name `sortOrder`
 *
 * The **stored** one is dense over everything not deleted, hidden rows included,
 * so a vendor switching a media back on finds it where they left it (S-12). The
 * **customer's** one is dense over what that customer can see. Serving the
 * stored one is what put `1, 3` on a customer's screen: the vendor hid the
 * second photo and the section kept positions 1 and 3.
 *
 * These are the two pieces that decide it — the filter that says whether a
 * section reaches a customer at all, and the renumber that runs after paging.
 * Both are exercised against a real pipeline in
 * `__tests__/money/showcaseCustomerReads.test.js`; this file pins their shape.
 */

const BRAND = new mongoose.Types.ObjectId();

describe("customerSectionMatch", () => {
  test("the three visibility conditions are always there", () => {
    expect(customerSectionMatch(BRAND)).toEqual({
      brandId: BRAND,
      isDeleted: false,
      isActive: true,
      isVisible: true,
    });
  });

  /**
   * Vendor and admin reads reuse the other three conditions and must NOT
   * inherit this one — they have to keep seeing the section they are being told
   * is too small, or the panel cannot show them what to fix.
   */
  test("no floor is applied unless one is asked for", () => {
    expect(customerSectionMatch(BRAND)).not.toHaveProperty("$expr");
    expect(customerSectionMatch(BRAND, {})).not.toHaveProperty("$expr");
    expect(
      customerSectionMatch(BRAND, { minItems: undefined }),
    ).not.toHaveProperty("$expr");
  });

  test("a floor becomes a count of visible media", () => {
    const match = customerSectionMatch(BRAND, { minItems: 3 });

    expect(match.brandId).toBe(BRAND);
    expect(match.$expr.$gte[1]).toBe(3);

    // ⚠️ Counted over *visible* media, not stored rows — a section of six hidden
    // photos must not qualify and then render empty.
    const filter = match.$expr.$gte[0].$size.$filter;
    expect(filter.cond).toEqual({
      $and: [
        { $eq: ["$$m.isActive", true] },
        { $eq: ["$$m.isDeleted", false] },
      ],
    });
  });

  test("a missing medias array counts as zero, not as an error", () => {
    const { $filter } = customerSectionMatch(BRAND, { minItems: 3 }).$expr
      .$gte[0].$size;

    expect($filter.input).toEqual({ $ifNull: ["$medias", []] });
  });

  /**
   * An empty section is never a customer's problem, so the condition stays on
   * even at a floor of 1 rather than the stage disappearing at one particular
   * setting value.
   */
  test("a floor of 1 still excludes empty sections", () => {
    expect(customerSectionMatch(BRAND, { minItems: 1 }).$expr.$gte[1]).toBe(1);
    expect(customerSectionMatch(BRAND, { minItems: 0 }).$expr.$gte[1]).toBe(1);
  });
});

describe("customerMediaFields", () => {
  test("sortOrder is projected by default", () => {
    expect(customerMediaFields({ withVideoMeta: false })).toHaveProperty(
      "sortOrder",
      "$$m.sortOrder",
    );
  });

  /**
   * The clips feed lifts a video out of its section, so a per-section position
   * would contradict the order the customer is actually scrolling.
   */
  test("the clips feed can drop it", () => {
    const fields = customerMediaFields({
      withVideoMeta: false,
      withSortOrder: false,
    });

    expect(fields).not.toHaveProperty("sortOrder");
    // Everything else is untouched.
    expect(fields).toHaveProperty("url", "$$m.media.url");
    expect(fields).toHaveProperty("title", "$$m.title");
  });

  test("dropping it works inside the video branch too", () => {
    const { $cond } = customerMediaFields({ withSortOrder: false });
    const [, videoShape, photoShape] = $cond;

    expect(videoShape).not.toHaveProperty("sortOrder");
    expect(photoShape).not.toHaveProperty("sortOrder");
    expect(videoShape).toHaveProperty("duration");
  });
});

describe("applyDisplayPositions", () => {
  const sections = (...counts) =>
    counts.map((count, index) => ({
      title: `Section ${index + 1}`,
      sortOrder: 99,
      medias: Array.from({ length: count }, (_, i) => ({
        title: `Media ${i + 1}`,
        sortOrder: 99,
      })),
    }));

  const positions = (list) => list.map((item) => item.sortOrder);

  test("sections are numbered from 1", () => {
    const list = applyDisplayPositions(sections(1, 1, 1));

    expect(positions(list)).toEqual([1, 2, 3]);
  });

  test("media are numbered from 1 inside each section", () => {
    const [first, second] = applyDisplayPositions(sections(3, 2));

    expect(positions(first.medias)).toEqual([1, 2, 3]);
    expect(positions(second.medias)).toEqual([1, 2]);
  });

  /**
   * 🔴 The gap this removes. The stored order counts hidden media, so a section
   * whose second photo is switched off keeps 1 and 3 — and the customer's list
   * either shows a hole or renders in an order that depends on how the app reads
   * the field.
   */
  test("a hidden media leaves no gap behind", () => {
    const section = {
      sortOrder: 2,
      // What survives the pipeline's filter: stored 1 and 3, the 2 hidden.
      medias: [{ sortOrder: 1 }, { sortOrder: 3 }],
    };

    applyDisplayPositions([section]);

    expect(positions(section.medias)).toEqual([1, 2]);
  });

  /**
   * ⚠️ Positions continue across pages. A section is the eleventh of the
   * brand's gallery whether or not this request began there; restarting at 1
   * would give two sections the same position in one list.
   */
  test("a later page continues the numbering", () => {
    const list = applyDisplayPositions(sections(1, 1), { startAt: 11 });

    expect(positions(list)).toEqual([11, 12]);
  });

  test("media numbering restarts per section regardless of the page", () => {
    const [first] = applyDisplayPositions(sections(2), { startAt: 11 });

    expect(positions(first.medias)).toEqual([1, 2]);
  });

  test("the array key can be something other than medias", () => {
    const list = [{ sortOrder: 9, clips: [{ sortOrder: 9 }, { sortOrder: 9 }] }];

    applyDisplayPositions(list, { mediaKey: "clips" });

    expect(positions(list[0].clips)).toEqual([1, 2]);
  });

  test("a section with no media array is left alone", () => {
    const list = [{ sortOrder: 9 }, { sortOrder: 9, medias: null }];

    expect(() => applyDisplayPositions(list)).not.toThrow();
    expect(positions(list)).toEqual([1, 2]);
  });

  test("an empty list is safe", () => {
    expect(applyDisplayPositions([])).toEqual([]);
    expect(applyDisplayPositions()).toEqual([]);
  });

  test("the same array is returned, for chaining", () => {
    const list = sections(1);

    expect(applyDisplayPositions(list)).toBe(list);
  });
});
