/**
 * S-2 (S-9) — the optimistic lock on a showcase section.
 *
 * ### 🔴 Why this file exists, and why it needs a real database
 *
 * Every renumber in this domain is a read-modify-write over the whole `medias`
 * array: load the section, change rows, `save()`. Mongoose writes that back as a
 * `$set` of the **entire array**, so two of them at once means the second
 * overwrites the first wholesale — a delete and a reorder landing together leave
 * duplicate positions, or put a media that was just removed back in the list.
 * Nothing raises. The section is simply wrong afterwards.
 *
 * A mock cannot show any of this. The lost update happens inside Mongo, in what
 * the driver sends and what the server does with it; the lock is a **version
 * predicate on the update filter**, which only exists once a real write goes out.
 * Mocking `save()` here would assert that we called it twice, which is the half
 * that was never in doubt.
 *
 * The first test below deliberately reproduces the corruption, because the whole
 * phase rests on the claim that it is real.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const ShowcaseSection = require("../../models/ShowcaseSection");
const Brand = require("../../models/Brand");
const {
  resolveSectionForActor,
} = require("../../helpers/showcases/resolveSectionForActor");
const { errorHandler } = require("../../middlewares/errorHandler");
const { ROLES } = require("../../constants");

const ADMIN = { userId: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

const photo = (index) => ({
  media: {
    url: `https://cdn.example.com/photo-${index}.jpg`,
    kind: "IMAGE",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
  },
  title: `Photo ${index}`,
  sortOrder: index,
});

const makeSection = async (mediaCount = 3) =>
  ShowcaseSection.create({
    brandId: new mongoose.Types.ObjectId(),
    title: "Ambience",
    slug: "ambience",
    medias: Array.from({ length: mediaCount }, (_, i) => photo(i + 1)),
  });

/** `save()`'s outcome, without the try/catch noise at every call site. */
const saveOutcome = async (doc) => {
  try {
    await doc.save();
    return { ok: true };
  } catch (error) {
    return { ok: false, name: error.name, error };
  }
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(ShowcaseSection, Brand);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(ShowcaseSection, Brand);
});

/**
 * What one vendor's delete-and-renumber does to the document: mark the row gone,
 * then close the gap so the live media are dense 1..n again. This is the shape
 * `deleteSectionMedia` takes in the next commit, and the shape
 * `reorderSectionMedia` already has.
 */
const deleteAndRenumber = (section, title) => {
  const target = section.medias.find((media) => media.title === title);
  target.isDeleted = true;
  target.isActive = false;

  section.medias
    .filter((media) => !media.isDeleted)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((media, index) => {
      media.sortOrder = index + 1;
    });
};

const liveOrder = async (id) => {
  const stored = await ShowcaseSection.findById(id).lean();
  return stored.medias
    .filter((media) => !media.isDeleted)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((media) => `${media.title}@${media.sortOrder}`);
};

describe("the corruption the lock exists to stop", () => {
  /**
   * 🔴 The mechanism, measured rather than assumed — and it is **not** the one
   * the phase notes predicted.
   *
   * The prediction was that the second `save()` replaces the whole `medias`
   * array and eats the first writer's change. It does not: Mongoose sends a
   * `$set` per touched positional path (`medias.3.sortOrder`), and Mongo merges
   * those field by field, so two deletes of *different* photos both survive.
   *
   * The damage is in the renumber that rides along. Each writer recomputes
   * positions over the media **it** can see, and Mongoose only sends the paths
   * that moved *relative to that writer's own load* — so the second writer stays
   * silent about the positions the first writer already shifted, and the section
   * is left holding half of each renumber.
   *
   * Four photos; vendor 1 deletes the first, vendor 2 deletes the second. The
   * truth afterwards is "Photo 3 and Photo 4, at 1 and 2". What is stored is
   * **2 and 3** — nothing at position 1, a highest position larger than the
   * number of media. That is the "1, 3" the panel has been showing.
   *
   * Nothing raises. Both vendors were told their delete worked, and it did; only
   * the order is a thing neither of them asked for.
   *
   * Loaded here through a projection that omits `__v`, which is both how this
   * used to run and — the sharper point — how it would still run if the version
   * key were on but the services kept projecting without it.
   */
  test("without a version, two renumbers leave an order nobody asked for", async () => {
    const created = await makeSection(4);

    const filter = { _id: created._id, isDeleted: false };
    const projection = { medias: 1 };
    const [first, second] = await Promise.all([
      ShowcaseSection.findOne(filter, projection),
      ShowcaseSection.findOne(filter, projection),
    ]);

    // Neither document knows its version — that is the whole point.
    expect(first.__v).toBeUndefined();

    deleteAndRenumber(first, "Photo 1"); // expects 3,4 to end up at 2,3
    deleteAndRenumber(second, "Photo 2"); // expects 3,4 to end up at 2,3

    expect(await saveOutcome(first)).toMatchObject({ ok: true });
    expect(await saveOutcome(second)).toMatchObject({ ok: true });

    // Both deletes landed. Nothing sits at position 1.
    expect(await liveOrder(created._id)).toEqual(["Photo 3@2", "Photo 4@3"]);
  });
});

describe("with the version key, the second writer is refused", () => {
  test("a stale save raises a VersionError instead of winning", async () => {
    const created = await makeSection(3);

    const [first, second] = await Promise.all([
      ShowcaseSection.findById(created._id),
      ShowcaseSection.findById(created._id),
    ]);

    expect(first.__v).toBe(0);

    first.medias[0].isDeleted = true;
    second.medias[1].isDeleted = true;

    expect(await saveOutcome(first)).toMatchObject({ ok: true });
    expect(await saveOutcome(second)).toMatchObject({
      ok: false,
      name: "VersionError",
    });

    // The refusal is not a half-write: only the first vendor's delete landed,
    // and the second vendor is the one who has to reload.
    const stored = await ShowcaseSection.findById(created._id).lean();
    expect(stored.medias.filter((media) => media.isDeleted)).toHaveLength(1);
    expect(stored.medias[0].isDeleted).toBe(true);
    expect(stored.__v).toBe(1);
  });

  test("the refused writer succeeds after reloading", async () => {
    const created = await makeSection(3);

    const stale = await ShowcaseSection.findById(created._id);
    const other = await ShowcaseSection.findById(created._id);
    other.medias[0].isDeleted = true;
    await other.save();

    stale.medias[1].isDeleted = true;
    expect(await saveOutcome(stale)).toMatchObject({ name: "VersionError" });

    // What the 409 tells the vendor to do, done.
    const reloaded = await ShowcaseSection.findById(created._id);
    reloaded.medias[1].isDeleted = true;
    expect(await saveOutcome(reloaded)).toMatchObject({ ok: true });

    const stored = await ShowcaseSection.findById(created._id).lean();
    expect(stored.medias.filter((media) => media.isDeleted)).toHaveLength(2);
  });

  /**
   * An untouched document still bumps its version on save, so a reader that
   * merely held the section open is refused too. That is the correct trade: it
   * cannot know whether what it read is still what it is about to write over.
   */
  test("sequential edits by one holder are unaffected", async () => {
    const created = await makeSection(2);

    const section = await ShowcaseSection.findById(created._id);
    section.medias[0].title = "Renamed";
    expect(await saveOutcome(section)).toMatchObject({ ok: true });

    section.medias[1].title = "Renamed too";
    expect(await saveOutcome(section)).toMatchObject({ ok: true });
  });
});

describe("resolveSectionForActor returns a document that locks", () => {
  /**
   * 🔴 The trap this phase could have shipped.
   *
   * An inclusion projection returns **only** the named fields, so a section
   * loaded through one of the nine services — every one of which projects — would
   * have had no version to check, and Mongoose would have saved it with no
   * version predicate. The lock would not have failed loudly; it would have
   * quietly not been a lock, on exactly the read-modify-write paths it is for.
   *
   * The first test in this file is what that looks like. This is the **same
   * four photos and the same two deletes**, through the resolver the services
   * actually call — and this time the second vendor is refused and the order
   * that survives is one vendor's, whole and dense.
   */
  test("a projected load still carries __v and still conflicts", async () => {
    const created = await makeSection(4);

    const projection = { medias: 1, coverImage: 1, coverImageMode: 1 };
    const [first, second] = await Promise.all([
      resolveSectionForActor(ADMIN, created._id, { projection }),
      resolveSectionForActor(ADMIN, created._id, { projection }),
    ]);

    expect(first.__v).toBe(0);

    deleteAndRenumber(first, "Photo 1");
    deleteAndRenumber(second, "Photo 2");

    expect(await saveOutcome(first)).toMatchObject({ ok: true });
    expect(await saveOutcome(second)).toMatchObject({ name: "VersionError" });

    // Vendor 1's delete, renumbered dense from 1 — not the 2-and-3 gap the
    // unlocked run leaves behind.
    expect(await liveOrder(created._id)).toEqual([
      "Photo 2@1",
      "Photo 3@2",
      "Photo 4@3",
    ]);
  });

  test("ownership still rides on brandId, projection or not", async () => {
    const created = await makeSection(1);

    const section = await resolveSectionForActor(ADMIN, created._id, {
      projection: { medias: 1 },
    });

    expect(String(section.brandId)).toBe(String(created.brandId));
    expect(section.medias).toHaveLength(1);
    // Not asked for, not returned — the projection is still a projection.
    expect(section.title).toBeUndefined();
  });
});

describe("what the vendor is told", () => {
  /**
   * The error is only useful if it survives the trip to the client. Before this
   * phase `VersionError` fell through to the 500 fallback, which reads as a
   * broken server and invites the vendor to try something other than reloading.
   */
  test("a real VersionError from Mongo becomes a 409", async () => {
    const created = await makeSection(2);

    const stale = await ShowcaseSection.findById(created._id);
    const other = await ShowcaseSection.findById(created._id);
    other.medias[0].title = "Moved";
    await other.save();

    stale.medias[1].title = "Also moved";
    const { error } = await saveOutcome(stale);

    const res = {
      headersSent: false,
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    errorHandler(error, {}, res, () => {});

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Reload and try again/);
  });
});
