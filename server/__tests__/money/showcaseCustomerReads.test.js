/**
 * S-4 — the customer's side of the media floor, and the positions they are given.
 *
 * ### 🔴 Why a real database
 *
 * The floor is a `$expr` over an array inside a `$match`, evaluated by Mongo:
 * `$size` of a `$filter` of `$medias`, compared against a number that arrives
 * from the `Setting` document through the settings cache. Every part of that is
 * the database's behaviour, not ours. A mock would assert that we built an
 * object with a `$expr` key in it — which is the half that was never in doubt.
 *
 * The clips feed adds a second thing only Mongo can answer: `$sort` is not
 * stable, so whether two clips of one section come back in a fixed order depends
 * on a tiebreaker actually being in the sort key.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
  writeSetting,
} = require("./setup/testDb");

const ShowcaseSection = require("../../models/ShowcaseSection");
const Setting = require("../../models/Setting");
const Brand = require("../../models/Brand");

const {
  getBrandsAllShowcase,
} = require("../../services/showcases/getBrandsAllShowcase");
const {
  getAllVideoClips,
} = require("../../services/showcases/getAllVideoClips");
const {
  getCustomerBrand,
} = require("../../services/brands/getCustomerBrand");

/**
 * `assertPublicBrand` is a brand-status question with its own tests. Stubbing it
 * keeps every fixture here about sections rather than about what makes a brand
 * publishable.
 */
jest.mock("../../helpers/brands/assertPublicBrand", () => ({
  assertPublicBrand: jest.fn(),
}));
const { assertPublicBrand } = require("../../helpers/brands/assertPublicBrand");

const BRAND_ID = new mongoose.Types.ObjectId();

const photo = (index) => ({
  media: {
    url: `https://cdn.example.com/photo-${index}.jpg`,
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  },
  title: `Photo ${index}`,
  sortOrder: index,
  isActive: true,
  isDeleted: false,
});

const video = (index, overrides = {}) => ({
  media: {
    url: `https://cdn.example.com/clip-${index}.mp4`,
    kind: "VIDEO",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    duration: 12,
    poster: { url: `https://cdn.example.com/clip-${index}.jpg` },
  },
  title: `Clip ${index}`,
  sortOrder: index,
  isActive: true,
  isDeleted: false,
  isShowInVideoClips: true,
  ...overrides,
});

let slug = 0;
const makeSection = (medias, overrides = {}) => {
  slug += 1;
  return ShowcaseSection.create({
    brandId: BRAND_ID,
    title: overrides.title || `Section ${slug}`,
    slug: overrides.slug || `section-${slug}`,
    sortOrder: overrides.sortOrder ?? slug,
    medias,
    ...overrides,
  });
};

/**
 * A brand a customer is allowed to see — all three verification flags, because
 * `customerVisibleBrandFilter` requires the combination and a missing one makes
 * the profile 404 rather than fail an assertion about sections.
 *
 * ⚠️ `collection.insertOne`, not `Brand.create`. The model requires a dozen
 * onboarding fields that have nothing to do with showcase sections, and this
 * test is not about what makes a brand publishable — that has its own file.
 */
const makeVisibleBrand = () =>
  Brand.collection.insertOne({
    _id: BRAND_ID,
    brandName: "Test Brand",
    isDeleted: false,
    isActive: true,
    isApproved: true,
  });

const gallery = (query = {}) =>
  getBrandsAllShowcase({ brandId: String(BRAND_ID), ...query });

/** The brand-profile screen's copy of the showcase — a bounded preview. */
const profileShowcase = async () => {
  const brand = await getCustomerBrand({ brandId: String(BRAND_ID) });
  return brand.showcase;
};

const clips = (query = {}) =>
  getAllVideoClips({ brandId: String(BRAND_ID), ...query });

const titlesOf = (sections) => sections.map((s) => s.title);
const positionsOf = (rows) => rows.map((r) => r.sortOrder);

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  slug = 0;
  assertPublicBrand.mockResolvedValue(BRAND_ID);
});

describe("a section too small never reaches a customer", () => {
  test("three media is enough, two is not", async () => {
    await makeSection([photo(1), photo(2), photo(3)], { title: "Full" });
    await makeSection([photo(1), photo(2)], { title: "Thin" });

    const { sections, total } = await gallery();

    expect(titlesOf(sections)).toEqual(["Full"]);
    expect(total).toBe(1);
  });

  test("an empty section is not served", async () => {
    await makeSection([], { title: "Empty" });

    expect((await gallery()).sections).toEqual([]);
  });

  /**
   * 🔴 The floor counts what a customer can **see**, not stored rows. Counting
   * rows would let a section of six hidden photos qualify and then render empty
   * — a section that is on the screen and has nothing in it.
   */
  test("hidden media do not help a section qualify", async () => {
    await makeSection(
      [
        photo(1),
        { ...photo(2), isActive: false },
        { ...photo(3), isActive: false },
        { ...photo(4), isActive: false },
      ],
      { title: "Mostly hidden" },
    );

    expect((await gallery()).sections).toEqual([]);
  });

  test("deleted media do not help either", async () => {
    await makeSection(
      [photo(1), photo(2), { ...photo(3), isDeleted: true, isActive: false }],
      { title: "Two live" },
    );

    expect((await gallery()).sections).toEqual([]);
  });

  test("the floor follows the configured number", async () => {
    await makeSection([photo(1), photo(2), photo(3)], { title: "Three" });
    await makeSection([photo(1), photo(2), photo(3), photo(4), photo(5)], {
      title: "Five",
    });

    await writeSetting({ $set: { "vendor.showcase.minItemsPerSection": 5 } });

    expect(titlesOf((await gallery()).sections)).toEqual(["Five"]);
  });

  test("the vendor's own switches still come first", async () => {
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "Hidden",
      isVisible: false,
    });
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "Off",
      isActive: false,
    });
    await makeSection([photo(1), photo(2), photo(3)], { title: "Live" });

    expect(titlesOf((await gallery()).sections)).toEqual(["Live"]);
  });
});

describe("the positions a customer is given", () => {
  /**
   * 🔴 The `1, 3` this removes. The stored order is dense over everything not
   * deleted — hidden rows included — so a section whose second photo is switched
   * off keeps positions 1 and 3, and the customer's list shows a hole.
   */
  test("a hidden media leaves no gap in the numbering", async () => {
    await makeSection([
      photo(1),
      { ...photo(2), isActive: false },
      photo(3),
      photo(4),
    ]);

    const [section] = (await gallery()).sections;

    expect(positionsOf(section.medias)).toEqual([1, 2, 3]);
    expect(section.medias.map((m) => m.title)).toEqual([
      "Photo 1",
      "Photo 3",
      "Photo 4",
    ]);
  });

  test("a filtered-out section leaves no gap between sections", async () => {
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "First",
      sortOrder: 1,
    });
    // Stored position 2, but too small to be served.
    await makeSection([photo(1)], { title: "Thin", sortOrder: 2 });
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "Third",
      sortOrder: 3,
    });

    const { sections } = await gallery();

    expect(titlesOf(sections)).toEqual(["First", "Third"]);
    // Stored 1 and 3; the customer is given 1 and 2.
    expect(positionsOf(sections)).toEqual([1, 2]);
  });

  test("the vendor's arrangement still decides the order", async () => {
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "Last",
      sortOrder: 3,
    });
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "First",
      sortOrder: 1,
    });

    expect(titlesOf((await gallery()).sections)).toEqual(["First", "Last"]);
  });

  /**
   * ⚠️ Positions continue across pages. A section is the third of this brand's
   * gallery whether or not the request began there — restarting at 1 would give
   * two sections the same position in one list.
   */
  test("page 2 continues the numbering", async () => {
    for (let i = 0; i < 4; i += 1) {
      await makeSection([photo(1), photo(2), photo(3)], {
        title: `S${i + 1}`,
        sortOrder: i + 1,
      });
    }

    const first = await gallery({ page: 1, limit: 2 });
    const second = await gallery({ page: 2, limit: 2 });

    expect(positionsOf(first.sections)).toEqual([1, 2]);
    expect(positionsOf(second.sections)).toEqual([3, 4]);
    expect(titlesOf(second.sections)).toEqual(["S3", "S4"]);
  });

  test("media numbering restarts per section on a later page", async () => {
    for (let i = 0; i < 3; i += 1) {
      await makeSection([photo(1), photo(2), photo(3)], {
        title: `S${i + 1}`,
        sortOrder: i + 1,
      });
    }

    const { sections } = await gallery({ page: 2, limit: 1 });

    expect(positionsOf(sections)).toEqual([2]);
    expect(positionsOf(sections[0].medias)).toEqual([1, 2, 3]);
  });
});

/**
 * 🔴 This block exists because a mutant survived without it.
 *
 * The first version of this file covered the gallery and the clips feed and left
 * the brand profile alone — so removing the floor from `getCustomerBrand` broke
 * nothing, and the suite said the phase was done. The profile is the screen most
 * customers actually land on.
 *
 * It is a separate service with its own pipeline, and the three only share the
 * helper: testing two of them tests the helper twice and the third not at all.
 */
describe("the brand profile carries the same rules", () => {
  beforeEach(async () => {
    await makeVisibleBrand();
  });

  test("a section below the floor is not on the profile either", async () => {
    await makeSection([photo(1), photo(2), photo(3)], { title: "Full" });
    await makeSection([photo(1), photo(2)], { title: "Thin" });

    const showcase = await profileShowcase();

    expect(titlesOf(showcase.sections)).toEqual(["Full"]);
    expect(showcase.totalSections).toBe(1);
  });

  test("hidden media do not help a section qualify here either", async () => {
    await makeSection([
      photo(1),
      { ...photo(2), isActive: false },
      { ...photo(3), isActive: false },
    ]);

    expect((await profileShowcase()).sections).toEqual([]);
  });

  test("positions are the customer's, not the stored ones", async () => {
    await makeSection([photo(1), photo(2), photo(3)], {
      title: "First",
      sortOrder: 1,
    });
    await makeSection([photo(1)], { title: "Thin", sortOrder: 2 });
    await makeSection(
      [photo(1), { ...photo(2), isActive: false }, photo(3), photo(4)],
      { title: "Third", sortOrder: 3 },
    );

    const { sections } = await profileShowcase();

    // The thin section is gone, so the third is handed position 2.
    expect(titlesOf(sections)).toEqual(["First", "Third"]);
    expect(positionsOf(sections)).toEqual([1, 2]);
    // And its media are 1, 2, 3 — the hidden one leaves no gap.
    expect(positionsOf(sections[1].medias)).toEqual([1, 2, 3]);
  });

  /**
   * The profile's media are a `$slice` preview, so the positions number the
   * strip the customer is looking at. `hasMoreMedia` is what says there is more.
   */
  test("the preview is numbered from 1, and says there is more", async () => {
    await makeSection(Array.from({ length: 9 }, (_, i) => photo(i + 1)));

    const { sections, mediaPreviewLimit } = await profileShowcase();

    expect(sections[0].medias).toHaveLength(mediaPreviewLimit);
    expect(positionsOf(sections[0].medias)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sections[0].hasMoreMedia).toBe(true);
    // The count is of everything visible, not of the slice.
    expect(sections[0].mediaCount).toBe(9);
  });
});

describe("the clips feed", () => {
  test("a section below the floor cannot leak its videos", async () => {
    await makeSection([video(1), video(2)], { title: "Thin" });

    const { data, total } = await clips();

    expect(data).toEqual([]);
    expect(total).toBe(0);
  });

  test("a section at the floor serves its videos", async () => {
    await makeSection([video(1), video(2), photo(3)], { title: "Full" });

    const { data, total } = await clips();

    expect(total).toBe(2);
    expect(data.map((row) => row.video.title)).toEqual(["Clip 1", "Clip 2"]);
  });

  /**
   * 🔴 The position is a place **within a section**, and this feed has taken the
   * video out of its section. The third clip of the feed can be the first of its
   * album, so the number would contradict the order being scrolled.
   */
  test("a clip carries no sortOrder", async () => {
    await makeSection([video(1), video(2), photo(3)]);

    const { data } = await clips();

    expect(data[0].video).not.toHaveProperty("sortOrder");
    // The rest of the whitelist is untouched.
    expect(data[0].video).toMatchObject({
      type: "VIDEO",
      title: "Clip 1",
      duration: 12,
    });
    expect(data[0].video.thumbnail).toContain("clip-1.jpg");
  });

  /**
   * The order inside a section is the vendor's order, and ten identical
   * requests have to agree on it.
   *
   * ⚠️ What this does **not** prove: that the `clips.sortOrder` tiebreaker in
   * the `$sort` is what produces it. Removing that tiebreaker leaves this test
   * green — `$sortArray` has already ordered the array and `$unwind` preserves
   * it — and the mutation run records that mutant as alive. `$sort` is
   * documented as not stable, so the tiebreaker stays as a guard against a
   * freedom the engine has and does not currently exercise; no test here can
   * provoke it.
   */
  test("the order within a section is fixed, not incidental", async () => {
    await makeSection([video(3), video(1), video(2), photo(4)]);

    const runs = await Promise.all(
      Array.from({ length: 10 }, () => clips().then((r) => r.data.map((x) => x.video.title))),
    );

    runs.forEach((titles) => {
      expect(titles).toEqual(["Clip 1", "Clip 2", "Clip 3"]);
    });
  });

  /**
   * 🆕 An empty feed is an empty list. This used to be a `404`, which the app
   * had to catch and translate — and which would now fire for a brand whose only
   * fault is that its sections are below the floor.
   */
  test("no eligible clips is an empty list, not a 404", async () => {
    await makeSection([photo(1), photo(2), photo(3)]);

    const result = await clips();

    expect(result).toMatchObject({ total: 0, data: [], totalPages: 1 });
  });

  test("a brand with no sections at all is also an empty list", async () => {
    const result = await clips();

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  test("the section double opt-in still applies", async () => {
    await makeSection([video(1), video(2), photo(3)], {
      title: "Opted out",
      isShowVideosInClips: false,
    });

    expect((await clips()).data).toEqual([]);
  });

  test("a video opted out individually is skipped", async () => {
    await makeSection([
      video(1),
      video(2, { isShowInVideoClips: false }),
      photo(3),
    ]);

    const { data } = await clips();

    expect(data.map((row) => row.video.title)).toEqual(["Clip 1"]);
  });
});
