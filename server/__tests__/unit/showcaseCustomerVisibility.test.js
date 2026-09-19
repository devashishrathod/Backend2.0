jest.mock("../../helpers/settings", () => ({
  getShowcaseConfig: jest.fn(),
}));

const { getShowcaseConfig } = require("../../helpers/settings");
const {
  isVisibleMedia,
  countVisibleMedia,
  describeCustomerVisibility,
  attachCustomerVisibility,
} = require("../../helpers/showcases/customerVisibility");
const { SHOWCASE_VISIBILITY_REASON } = require("../../constants/showcase");

/**
 * S-5 (S-8) — telling the vendor why their section is not on a customer's screen.
 *
 * ### 🔴 Why this field has to exist
 *
 * S-4 made a section vanish from every customer surface when it holds fewer than
 * `minItemsPerSection` visible media. Nothing about the vendor's own list
 * changes when that happens: no write, no log, no difference they can see. Two
 * of the three reasons are switches they flipped themselves; the third depends
 * on a number that lives in an admin setting and cannot be worked out from the
 * panel at all.
 *
 * ### Derived, never stored
 *
 * There is no `isLive` column and there must not be one. An admin raising
 * `minItemsPerSection` changes the answer for every section on the platform
 * without touching a single document — a stored flag would be wrong the instant
 * that happened, everywhere, silently.
 */

const { HIDDEN, INACTIVE, NOT_ENOUGH_MEDIA } = SHOWCASE_VISIBILITY_REASON;

const section = (overrides = {}) => ({
  isActive: true,
  isVisible: true,
  visibleMediaCount: 3,
  ...overrides,
});

const describe3 = (overrides) =>
  describeCustomerVisibility(section(overrides), { minItems: 3 });

beforeEach(() => {
  jest.clearAllMocks();
  getShowcaseConfig.mockResolvedValue({ minItems: 3, minSections: 1 });
});

describe("counting what a customer can see", () => {
  test("a media is visible when it is active and not deleted", () => {
    expect(isVisibleMedia({ isActive: true, isDeleted: false })).toBe(true);
    expect(isVisibleMedia({ isActive: false, isDeleted: false })).toBe(false);
    expect(isVisibleMedia({ isActive: true, isDeleted: true })).toBe(false);
    expect(isVisibleMedia(undefined)).toBe(false);
  });

  test("the count skips hidden and deleted rows", () => {
    expect(
      countVisibleMedia([
        { isActive: true, isDeleted: false },
        { isActive: false, isDeleted: false },
        { isActive: true, isDeleted: true },
        { isActive: true, isDeleted: false },
      ]),
    ).toBe(2);
  });

  test("an empty or missing array is zero", () => {
    expect(countVisibleMedia([])).toBe(0);
    expect(countVisibleMedia()).toBe(0);
  });
});

describe("describeCustomerVisibility", () => {
  test("a section meeting every condition is live, with no reasons", () => {
    expect(describe3()).toEqual({
      isLive: true,
      reasons: [],
      visibleMediaCount: 3,
      minItemsRequired: 3,
    });
  });

  test("the vendor's public switch is a reason", () => {
    expect(describe3({ isVisible: false })).toMatchObject({
      isLive: false,
      reasons: [HIDDEN],
    });
  });

  test("the vendor's own on/off is a separate reason", () => {
    expect(describe3({ isActive: false })).toMatchObject({
      isLive: false,
      reasons: [INACTIVE],
    });
  });

  /**
   * 🔴 The reason the vendor could not have worked out for themselves — the one
   * this whole field exists for.
   */
  test("too little media is a reason, with both numbers", () => {
    expect(describe3({ visibleMediaCount: 2 })).toEqual({
      isLive: false,
      reasons: [NOT_ENOUGH_MEDIA],
      visibleMediaCount: 2,
      minItemsRequired: 3,
    });
  });

  test("an empty section reports zero, not nothing", () => {
    expect(describe3({ visibleMediaCount: 0 })).toMatchObject({
      reasons: [NOT_ENOUGH_MEDIA],
      visibleMediaCount: 0,
    });
  });

  /**
   * ⚠️ **Every** failing reason, not the first.
   *
   * Telling a vendor about one of two problems sends them to fix it and find
   * nothing changed. A panel is free to render one line; it cannot invent the
   * reason it was not told.
   */
  test("all the failing reasons come back together", () => {
    expect(
      describe3({ isVisible: false, isActive: false, visibleMediaCount: 1 })
        .reasons,
    ).toEqual([HIDDEN, INACTIVE, NOT_ENOUGH_MEDIA]);
  });

  test("the order is stable — switches first, then the media floor", () => {
    expect(describe3({ isActive: false, visibleMediaCount: 1 }).reasons).toEqual(
      [INACTIVE, NOT_ENOUGH_MEDIA],
    );
  });

  test("the floor follows the configured number", () => {
    const at5 = describeCustomerVisibility(section({ visibleMediaCount: 4 }), {
      minItems: 5,
    });

    expect(at5).toMatchObject({
      isLive: false,
      reasons: [NOT_ENOUGH_MEDIA],
      minItemsRequired: 5,
    });
  });

  test("the count can be given as an array instead", () => {
    const result = describeCustomerVisibility(
      {
        isActive: true,
        isVisible: true,
        medias: [
          { isActive: true, isDeleted: false },
          { isActive: false, isDeleted: false },
        ],
      },
      { minItems: 3 },
    );

    expect(result).toMatchObject({
      isLive: false,
      visibleMediaCount: 1,
      reasons: [NOT_ENOUGH_MEDIA],
    });
  });

  /**
   * A precomputed zero must not be mistaken for "no count given" and send the
   * helper back to an array that is not there.
   */
  test("a precomputed zero is honoured, not treated as missing", () => {
    const result = describeCustomerVisibility(
      { isActive: true, isVisible: true, visibleMediaCount: 0, medias: [{}] },
      { minItems: 3 },
    );

    expect(result.visibleMediaCount).toBe(0);
  });
});

describe("attachCustomerVisibility", () => {
  test("every row is stamped", async () => {
    const rows = [
      section(),
      section({ isVisible: false }),
      section({ visibleMediaCount: 1 }),
    ];

    await attachCustomerVisibility(rows);

    expect(rows[0].customerVisibility.isLive).toBe(true);
    expect(rows[1].customerVisibility.reasons).toEqual([HIDDEN]);
    expect(rows[2].customerVisibility.reasons).toEqual([NOT_ENOUGH_MEDIA]);
  });

  /**
   * ⚠️ One settings read for the whole page. Cheap each, but the kind of thing
   * that quietly becomes a per-row query the first time somebody changes how the
   * cache works.
   */
  test("the config is read once, however many rows", async () => {
    await attachCustomerVisibility([section(), section(), section()]);

    expect(getShowcaseConfig).toHaveBeenCalledTimes(1);
  });

  test("an empty page still reads the config only once, and does not throw", async () => {
    await expect(attachCustomerVisibility([])).resolves.toEqual([]);
    await expect(attachCustomerVisibility()).resolves.toEqual([]);
  });

  test("the same array comes back, for chaining", async () => {
    const rows = [section()];

    expect(await attachCustomerVisibility(rows)).toBe(rows);
  });
});
