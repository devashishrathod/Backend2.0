/**
 * Home-screen banners — the ten-slot rule, and who gets the slots.
 *
 * ### 🔴 Why this file exists
 *
 * A banner used to be one at a time: any overlap was refused, and the customer
 * endpoint answered with a single document. Ten of them changes two things that
 * both fail **silently** when they are wrong.
 *
 * **The guard.** "Ten at once" is a peak, not a count of overlaps. Five banners
 * running through January and five through February all overlap a Jan–Feb
 * window, yet only five are ever on screen together — a `countDocuments` here
 * would refuse a perfectly legal banner and leave the admin re-reading their own
 * dates for the mistake. The opposite error is worse and quieter: miss the peak
 * and an eleventh banner is accepted, then simply never rendered.
 *
 * **The fill.** Scheduled banners take the slots and evergreen ones fill what is
 * left. Get the order or the arithmetic wrong and the home screen is short, or
 * carries a banner nobody scheduled — and nothing raises, because a home screen
 * with the wrong number of banners still renders.
 *
 * ⚠️ Real database. The selection rests on query semantics that a mock cannot
 * reproduce: `startDate: null` matching a field that is **absent** as well as
 * one that is explicitly null, and `$lte`/`$gte` on dates. Mocking `Banner`
 * here would assert the shape of the filter object rather than what Mongo does
 * with it, which is the half that has actually been wrong before.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Banner = require("../../models/Banner");
const { assertActiveBannerCapacity } = require("../../helpers/banners");
const {
  getActiveBannersForCustomer,
} = require("../../services/banners/getActiveBannersForCustomer");
const { BANNER_ACTIVE_LIMIT } = require("../../constants/banner");

const ADMIN = new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;

const day = (offset) => new Date(Date.now() + offset * DAY_MS);

/**
 * `Banner.create` refuses a document with no media (a `pre("validate")` hook),
 * so every fixture carries an image whether or not the test looks at it.
 */
const makeBanner = (overrides = {}) =>
  Banner.create({
    title: "Fixture banner",
    type: "IMAGE",
    image: { url: "https://res.cloudinary.com/x/image/upload/a.jpg" },
    createdBy: ADMIN,
    ...overrides,
  });

const scheduled = (startOffset, endOffset, overrides = {}) =>
  makeBanner({
    startDate: day(startOffset),
    endDate: day(endOffset),
    ...overrides,
  });

const evergreen = (overrides = {}) =>
  makeBanner({ startDate: null, endDate: null, ...overrides });

/** The 409 a full pool raises, or `null` when the write was allowed. */
const refusal = async (input) => {
  try {
    await assertActiveBannerCapacity(input);
    return null;
  } catch (error) {
    return error;
  }
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(Banner);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Banner);
});

describe("assertActiveBannerCapacity — the evergreen pool", () => {
  test(`the ${BANNER_ACTIVE_LIMIT}th evergreen banner is allowed`, async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT - 1; i += 1) await evergreen();

    expect(await refusal({ isActive: true })).toBeNull();
  });

  test(`the ${BANNER_ACTIVE_LIMIT + 1}th is refused with a 409`, async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) await evergreen();

    expect(await refusal({ isActive: true })).toMatchObject({
      statusCode: 409,
      message: expect.stringContaining(String(BANNER_ACTIVE_LIMIT)),
    });
  });

  /**
   * The two pools are counted separately — an evergreen banner cannot push a
   * scheduled one off the screen, so a full schedule must not block one.
   */
  test("a full schedule does not consume evergreen slots", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) await scheduled(-1, 30);

    expect(await refusal({ isActive: true })).toBeNull();
  });

  test("deactivated, deleted and scheduled banners do not count", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) {
      await evergreen({ isActive: false });
      await evergreen({ isDeleted: true });
    }

    expect(await refusal({ isActive: true })).toBeNull();
  });
});

describe("assertActiveBannerCapacity — the schedule is a peak, not a count", () => {
  /**
   * ⚠️ The case a `countDocuments` gets wrong. Twenty banners overlap the new
   * window and none of them may be refused, because only ten share any instant
   * with it — and the new banner is the eleventh only in the arithmetic, never
   * on a screen.
   */
  test("banners in separate months do not add up", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT - 1; i += 1) {
      await scheduled(1, 10);
      await scheduled(20, 30);
    }

    expect(
      await refusal({
        isActive: true,
        startDate: day(1),
        endDate: day(30),
      }),
    ).toBeNull();
  });

  test(`${BANNER_ACTIVE_LIMIT} banners sharing a day refuse the next one`, async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) await scheduled(1, 10);

    const error = await refusal({
      isActive: true,
      startDate: day(5),
      endDate: day(6),
    });

    expect(error).toMatchObject({ statusCode: 409 });
    // The refusal has to name the moment it peaked, or the admin is left
    // guessing which of their dates to move.
    expect(error.message).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test(`${BANNER_ACTIVE_LIMIT - 1} sharing a day still leave one slot`, async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT - 1; i += 1) await scheduled(1, 10);

    expect(
      await refusal({ isActive: true, startDate: day(5), endDate: day(6) }),
    ).toBeNull();
  });

  /**
   * Both bounds are inclusive in the customer query, so a banner ending at T
   * and one starting at T are both live at T. Sweeping the ends before the
   * starts would count them as consecutive and let an eleventh banner through
   * for exactly one instant.
   */
  test("a banner ending when another starts is concurrent, not consecutive", async () => {
    const boundary = day(5);
    for (let i = 0; i < BANNER_ACTIVE_LIMIT / 2; i += 1) {
      await makeBanner({ startDate: day(1), endDate: boundary });
      await makeBanner({ startDate: boundary, endDate: day(10) });
    }

    expect(
      await refusal({ isActive: true, startDate: boundary, endDate: day(6) }),
    ).toMatchObject({ statusCode: 409 });
  });

  test("a banner outside the window is ignored", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) await scheduled(1, 10);

    expect(
      await refusal({ isActive: true, startDate: day(11), endDate: day(20) }),
    ).toBeNull();
  });

  /**
   * An update re-checks capacity, and the banner being updated is already in
   * the pool. Without `excludeId` the tenth banner could never be edited — it
   * would count itself as the eleventh.
   */
  test("excludeId keeps a banner from counting against itself", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT - 1; i += 1) await scheduled(1, 10);
    const self = await scheduled(1, 10);

    expect(
      await refusal({
        isActive: true,
        startDate: day(2),
        endDate: day(9),
        excludeId: self._id,
      }),
    ).toBeNull();
  });

  test("deactivating is never refused, however full the pool is", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT; i += 1) await scheduled(1, 10);

    expect(
      await refusal({ isActive: false, startDate: day(1), endDate: day(10) }),
    ).toBeNull();
  });
});

describe("getActiveBannersForCustomer — scheduled first, evergreen filling", () => {
  test("evergreen banners fill the slots a short schedule leaves", async () => {
    await scheduled(-2, 5, { title: "live A" });
    await scheduled(-1, 5, { title: "live B" });
    await scheduled(-3, 5, { title: "live C" });
    for (let i = 0; i < BANNER_ACTIVE_LIMIT + 2; i += 1) await evergreen();

    const banners = await getActiveBannersForCustomer();

    expect(banners).toHaveLength(BANNER_ACTIVE_LIMIT);
    const ids = banners.map((banner) => String(banner._id));
    const live = await Banner.find({ startDate: { $ne: null } }).lean();
    // The three scheduled ones lead, newest schedule first.
    expect(ids.slice(0, 3)).toEqual([
      String(live.find((b) => b.title === "live B")._id),
      String(live.find((b) => b.title === "live A")._id),
      String(live.find((b) => b.title === "live C")._id),
    ]);
  });

  test("a full schedule hides the evergreen pool entirely", async () => {
    for (let i = 0; i < BANNER_ACTIVE_LIMIT + 3; i += 1) await scheduled(-1, 5);
    for (let i = 0; i < 4; i += 1) await evergreen({ title: "evergreen" });

    const banners = await getActiveBannersForCustomer();

    expect(banners).toHaveLength(BANNER_ACTIVE_LIMIT);
    const titles = await Banner.find({
      _id: { $in: banners.map((banner) => banner._id) },
    })
      .select("title")
      .lean();
    expect(titles.every((row) => row.title !== "evergreen")).toBe(true);
  });

  test("evergreen alone is returned when nothing is scheduled for today", async () => {
    await scheduled(-30, -10); // finished
    await scheduled(10, 30); // not started yet
    await evergreen({ title: "the fallback" });

    const banners = await getActiveBannersForCustomer();

    expect(banners).toHaveLength(1);
    const stored = await Banner.findById(banners[0]._id).lean();
    expect(stored.title).toBe("the fallback");
  });

  test("inactive and deleted banners are never returned", async () => {
    await scheduled(-1, 5, { isActive: false });
    await scheduled(-1, 5, { isDeleted: true });
    await evergreen({ isActive: false });
    await evergreen({ isDeleted: true });

    expect(await getActiveBannersForCustomer()).toEqual([]);
  });

  /**
   * ⚠️ The one bug a half-open banner produced: it belongs to neither query, so
   * it was saved, returned `201`, and rendered to nobody. The write paths refuse
   * one now; a document stored before that rule still must not appear.
   */
  test("a half-open legacy banner is in neither pool", async () => {
    await Banner.collection.insertOne({
      title: "half open",
      type: "IMAGE",
      image: { url: "https://res.cloudinary.com/x/image/upload/a.jpg" },
      createdBy: ADMIN,
      startDate: day(-1),
      endDate: null,
      isActive: true,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(await getActiveBannersForCustomer()).toEqual([]);
  });
});

describe("getActiveBannersForCustomer — the payload the app renders", () => {
  test("exactly four keys, and the media url is flattened", async () => {
    await evergreen({
      title: "Secret internal title",
      type: "VIDEO",
      video: {
        url: "https://res.cloudinary.com/x/video/upload/a.mp4",
        storage: { provider: "CLOUDINARY", publicId: "banners/a" },
      },
      image: undefined,
    });

    const [banner] = await getActiveBannersForCustomer();

    expect(Object.keys(banner).sort()).toEqual([
      "_id",
      "redirect",
      "type",
      "url",
    ]);
    expect(banner.type).toBe("VIDEO");
    expect(banner.url).toBe("https://res.cloudinary.com/x/video/upload/a.mp4");
    // ⚠️ `storage` holds the Cloudinary public id of every asset — an admin
    // detail that has no business on a public endpoint.
    expect(JSON.stringify(banner)).not.toMatch(/publicId|Secret internal/);
  });

  test("a banner with no redirect answers NONE, never null", async () => {
    await evergreen();

    const [banner] = await getActiveBannersForCustomer();

    expect(banner.redirect).toEqual({ type: "NONE", targetId: null, url: null });
  });

  test("a redirect is passed through whole", async () => {
    const target = new mongoose.Types.ObjectId();
    await evergreen({ redirect: { type: "BRAND", targetId: target } });

    const [banner] = await getActiveBannersForCustomer();

    expect(banner.redirect.type).toBe("BRAND");
    expect(String(banner.redirect.targetId)).toBe(String(target));
    expect(banner.redirect.url).toBeNull();
  });

  /**
   * ⚠️ Mongoose does not run setters when hydrating from the database, so the
   * model's uppercase normalization does nothing on the way **out**. A document
   * written before BANNER_TYPE became uppercase reads back as `image`, and the
   * media field would then be looked up under a key that does not exist —
   * `url: null`, and a blank slot on the home screen.
   */
  test("a legacy lowercase type still resolves its media", async () => {
    await Banner.collection.insertOne({
      title: "legacy",
      type: "image",
      image: { url: "https://res.cloudinary.com/x/image/upload/legacy.jpg" },
      createdBy: ADMIN,
      startDate: null,
      endDate: null,
      isActive: true,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [banner] = await getActiveBannersForCustomer();

    expect(banner.type).toBe("IMAGE");
    expect(banner.url).toBe(
      "https://res.cloudinary.com/x/image/upload/legacy.jpg",
    );
  });
});
