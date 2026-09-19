/**
 * S-5 — `customerVisibility` on the managed reads, and the one property that
 * matters most about it: that it agrees with what the customer actually gets.
 *
 * ### 🔴 Why a real database
 *
 * The field is derived in JS, but the thing it claims to describe is a Mongo
 * `$match` — `customerSectionMatch`'s `$expr` over the media array. Two
 * implementations of one rule is exactly the shape that drifts, and a unit test
 * of the JS side cannot notice when the two stop agreeing. So the load-bearing
 * tests here run **both** paths over the same sections and compare them.
 *
 * `getAllSections` also computes its count inside the pipeline, which only Mongo
 * can evaluate.
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
const { ROLES } = require("../../constants");
const { SHOWCASE_VISIBILITY_REASON } = require("../../constants/showcase");

const { getSection } = require("../../services/showcases/getSection");
const { getAllSections } = require("../../services/showcases/getAllSections");
const {
  getBrandsAllShowcase,
} = require("../../services/showcases/getBrandsAllShowcase");

jest.mock("../../helpers/brands/assertPublicBrand", () => ({
  assertPublicBrand: jest.fn(),
}));
const { assertPublicBrand } = require("../../helpers/brands/assertPublicBrand");

const { HIDDEN, INACTIVE, NOT_ENOUGH_MEDIA } = SHOWCASE_VISIBILITY_REASON;

const BRAND_ID = new mongoose.Types.ObjectId();
const ADMIN = {
  userId: String(new mongoose.Types.ObjectId()),
  role: ROLES.ADMIN,
};

const photo = (index, overrides = {}) => ({
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
  ...overrides,
});

let seq = 0;
const makeSection = (medias, overrides = {}) => {
  seq += 1;
  return ShowcaseSection.create({
    brandId: BRAND_ID,
    title: overrides.title || `Section ${seq}`,
    slug: overrides.slug || `section-${seq}`,
    sortOrder: overrides.sortOrder ?? seq,
    medias,
    ...overrides,
  });
};

const visible = (count) => Array.from({ length: count }, (_, i) => photo(i + 1));

const reportFor = async (sectionId) =>
  (await getSection(ADMIN, { sectionId })).customerVisibility;

const listReports = async () => {
  const { data } = await getAllSections(ADMIN, {
    page: 1,
    limit: 50,
    brandId: String(BRAND_ID),
    sortBy: "sortOrder",
    order: "asc",
  });
  return new Map(data.map((row) => [row.title, row.customerVisibility]));
};

/** Titles the customer's gallery actually serves. */
const customerTitles = async () => {
  const { sections } = await getBrandsAllShowcase({
    brandId: String(BRAND_ID),
  });
  return sections.map((s) => s.title);
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(ShowcaseSection, Setting, Brand);
  seq = 0;
  assertPublicBrand.mockResolvedValue(BRAND_ID);
});

describe("one section — GET /section/get/:sectionId", () => {
  test("a live section says so, with no reasons", async () => {
    const section = await makeSection(visible(3));

    expect(await reportFor(section._id)).toEqual({
      isLive: true,
      reasons: [],
      visibleMediaCount: 3,
      minItemsRequired: 3,
    });
  });

  test("a section short of media says exactly how short", async () => {
    const section = await makeSection(visible(2));

    expect(await reportFor(section._id)).toEqual({
      isLive: false,
      reasons: [NOT_ENOUGH_MEDIA],
      visibleMediaCount: 2,
      minItemsRequired: 3,
    });
  });

  test("hidden media are not counted toward the floor", async () => {
    const section = await makeSection([
      photo(1),
      photo(2, { isActive: false }),
      photo(3),
      photo(4, { isDeleted: true, isActive: false }),
    ]);

    expect(await reportFor(section._id)).toMatchObject({
      isLive: false,
      visibleMediaCount: 2,
      reasons: [NOT_ENOUGH_MEDIA],
    });
  });

  test("both switches and the floor come back together", async () => {
    const section = await makeSection(visible(1), {
      isVisible: false,
      isActive: false,
    });

    expect((await reportFor(section._id)).reasons).toEqual([
      HIDDEN,
      INACTIVE,
      NOT_ENOUGH_MEDIA,
    ]);
  });

  /**
   * 🔴 Visibility is a property of the section, not of the page the vendor is
   * looking at. Deriving it from the filtered list would report a section as
   * invisible because somebody searched for a word none of its media matched.
   */
  test("a search or filter in the query does not change the verdict", async () => {
    const section = await makeSection(visible(3));

    const searched = await getSection(ADMIN, {
      sectionId: section._id,
      search: "nothing matches this",
    });
    const filtered = await getSection(ADMIN, {
      sectionId: section._id,
      isActive: false,
    });

    expect(searched.media.total).toBe(0);
    expect(searched.customerVisibility).toMatchObject({
      isLive: true,
      visibleMediaCount: 3,
    });
    expect(filtered.customerVisibility).toMatchObject({ isLive: true });
  });

  test("paging past the end does not change it either", async () => {
    const section = await makeSection(visible(3));

    const page9 = await getSection(ADMIN, { sectionId: section._id, page: 9 });

    expect(page9.media.data).toEqual([]);
    expect(page9.customerVisibility.isLive).toBe(true);
  });

  test("the floor follows the configured number", async () => {
    const section = await makeSection(visible(3));
    await writeSetting({ $set: { "vendor.showcase.minItemsPerSection": 5 } });

    expect(await reportFor(section._id)).toMatchObject({
      isLive: false,
      reasons: [NOT_ENOUGH_MEDIA],
      minItemsRequired: 5,
      visibleMediaCount: 3,
    });
  });
});

describe("the listing — GET /section/get-all", () => {
  test("every row carries its own verdict", async () => {
    await makeSection(visible(3), { title: "Live", slug: "live" });
    await makeSection(visible(2), { title: "Thin", slug: "thin" });
    await makeSection(visible(3), {
      title: "Hidden",
      slug: "hidden",
      isVisible: false,
    });

    const reports = await listReports();

    expect(reports.get("Live")).toMatchObject({ isLive: true, reasons: [] });
    expect(reports.get("Thin")).toMatchObject({
      isLive: false,
      reasons: [NOT_ENOUGH_MEDIA],
      visibleMediaCount: 2,
    });
    expect(reports.get("Hidden")).toMatchObject({ reasons: [HIDDEN] });
  });

  /**
   * 🔴 The count the pipeline computes must be the **visible** one.
   *
   * `managedMedias` — the array the counts beside it use — includes switched-off
   * media. Counting that one here would report a section as live while the
   * customer pipeline refuses to serve it, which is the precise failure this
   * field exists to prevent.
   */
  test("switched-off media do not inflate the listing's count", async () => {
    await makeSection(
      [photo(1), photo(2, { isActive: false }), photo(3, { isActive: false })],
      { title: "Mostly off", slug: "mostly-off" },
    );

    const report = (await listReports()).get("Mostly off");

    expect(report).toMatchObject({
      isLive: false,
      visibleMediaCount: 1,
      reasons: [NOT_ENOUGH_MEDIA],
    });
    // The managed counts beside it still describe everything the vendor owns.
    const { data } = await getAllSections(ADMIN, {
      page: 1,
      limit: 50,
      brandId: String(BRAND_ID),
      sortBy: "sortOrder",
      order: "asc",
    });
    expect(data[0].mediaCount).toBe(3);
    expect(data[0].inactiveMediaCount).toBe(2);
  });

  test("a hidden section is still listed — with the reason attached", async () => {
    await makeSection(visible(3), {
      title: "Off",
      slug: "off",
      isActive: false,
    });

    const reports = await listReports();

    expect(reports.has("Off")).toBe(true);
    expect(reports.get("Off")).toMatchObject({
      isLive: false,
      reasons: [INACTIVE],
    });
  });
});

/**
 * 🔴 The property the whole field rests on.
 *
 * `customerVisibility` is computed in JS; the customer read is a Mongo `$expr`.
 * Two implementations of one rule drift, and when they do the panel tells a
 * vendor their section is live while customers cannot see it — a worse state
 * than not reporting at all, because it sends them looking somewhere else.
 */
describe("the verdict matches what customers actually get", () => {
  const cases = [
    { title: "Three live", medias: visible(3), expected: true },
    { title: "Two live", medias: visible(2), expected: false },
    { title: "Empty", medias: [], expected: false },
    {
      title: "Three with one off",
      medias: [photo(1), photo(2), photo(3, { isActive: false })],
      expected: false,
    },
    {
      title: "Four with one deleted",
      medias: [
        photo(1),
        photo(2),
        photo(3),
        photo(4, { isDeleted: true, isActive: false }),
      ],
      expected: true,
    },
  ];

  test("every shape agrees, section by section", async () => {
    for (const { title, medias } of cases) {
      await makeSection(medias, {
        title,
        slug: title.toLowerCase().replace(/\s+/g, "-"),
      });
    }

    const reports = await listReports();
    const served = new Set(await customerTitles());

    for (const { title, expected } of cases) {
      expect(reports.get(title).isLive).toBe(expected);
      expect(served.has(title)).toBe(expected);
    }
  });

  test("they still agree after the admin raises the floor", async () => {
    await makeSection(visible(3), { title: "Three", slug: "three" });
    await makeSection(visible(5), { title: "Five", slug: "five" });

    await writeSetting({ $set: { "vendor.showcase.minItemsPerSection": 5 } });

    const reports = await listReports();
    const served = new Set(await customerTitles());

    expect(reports.get("Three").isLive).toBe(false);
    expect(served.has("Three")).toBe(false);
    expect(reports.get("Five").isLive).toBe(true);
    expect(served.has("Five")).toBe(true);
  });

  test("a hidden section is refused by both", async () => {
    await makeSection(visible(3), {
      title: "Hidden",
      slug: "hidden",
      isVisible: false,
    });

    expect((await listReports()).get("Hidden").isLive).toBe(false);
    expect(await customerTitles()).toEqual([]);
  });
});
