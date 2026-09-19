const ShowcaseSection = require("../../models/ShowcaseSection");
const { errorHandler } = require("../../middlewares/errorHandler");
const { CustomError } = require("../../utils");

/**
 * S-2 (S-9) — two people editing one section at the same time.
 *
 * ### Why this section and not the rest of the models
 *
 * Every renumber in this domain is a read-modify-write over the whole `medias`
 * array: load the section, recompute `sortOrder` on each row, save. Two of those
 * at once and the second overwrites the first's array wholesale — a delete and a
 * reorder landing together leave duplicate positions, or a media that was just
 * removed back in the list.
 *
 * The version key makes the second save **fail** rather than silently win. What
 * this file pins is the two halves of that being real: the key is on, and the
 * failure it produces reaches the caller as something they can act on.
 */

describe("the version key is on", () => {
  /**
   * The schema, not a document instance. Mongoose stamps `__v` at **insert**, so
   * an unsaved document has nothing there whether the key is on or off — the
   * difference that can be read without a database is the path itself, which
   * `versionKey: false` removes. What the key actually *does* is proved against
   * a real database in `__tests__/money/showcaseVersionLock.test.js`.
   */
  test("a section has a version path", () => {
    expect(ShowcaseSection.schema.options.versionKey).toBe("__v");
    expect(ShowcaseSection.schema.path("__v")).toBeTruthy();
  });

  /**
   * 🔴 The trap this phase could have shipped.
   *
   * An inclusion projection returns **only** the named fields. A document loaded
   * without `__v` has no version to check, and Mongoose then saves it with no
   * version predicate — so the lock would not fail loudly, it would quietly not
   * be a lock, on exactly the read-modify-write paths it exists for.
   *
   * `resolveSectionForActor` adds it to every projection for the same reason it
   * already adds `brandId`: a caller that forgot to ask still has to get it.
   */
  test("resolveSectionForActor asks for __v whatever the caller projected", async () => {
    const findOne = jest
      .spyOn(ShowcaseSection, "findOne")
      .mockReturnValue({ lean: () => ({}), then: (r) => r({ brandId: "b1" }) });

    const {
      resolveSectionForActor,
    } = require("../../helpers/showcases/resolveSectionForActor");

    await resolveSectionForActor(
      { role: "ADMIN" },
      "s1",
      { projection: { medias: 1 } },
    );

    const [, projection] = findOne.mock.calls[0];
    expect(projection).toMatchObject({ medias: 1, brandId: 1, __v: 1 });

    findOne.mockRestore();
  });

  test("a caller with no projection still gets the whole document", async () => {
    const findOne = jest
      .spyOn(ShowcaseSection, "findOne")
      .mockReturnValue({ lean: () => ({}), then: (r) => r({ brandId: "b1" }) });

    const {
      resolveSectionForActor,
    } = require("../../helpers/showcases/resolveSectionForActor");

    await resolveSectionForActor({ role: "ADMIN" }, "s1");

    // `undefined`, not `{ __v: 1 }` — an inclusion projection here would turn a
    // full read into a two-field one.
    expect(findOne.mock.calls[0][1]).toBeUndefined();

    findOne.mockRestore();
  });
});

describe("a version conflict reaches the caller as 409", () => {
  const respond = (error) => {
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
    return res;
  };

  /**
   * 🔴 This fell through to the 500 below it.
   *
   * A vendor reordering media while a colleague deleted one was told
   * "Something went wrong" — which reads as a broken server and invites the
   * wrong response, namely trying something else. Nothing is broken: the write
   * was refused **because** the document moved, and reloading fixes it.
   */
  test("a VersionError is a conflict, not a server error", () => {
    const error = new Error("No matching document found for id");
    error.name = "VersionError";

    const res = respond(error);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Reload and try again/);
  });

  test("the message says the one thing that resolves it", () => {
    const error = new Error("version mismatch");
    error.name = "VersionError";

    expect(respond(error).body.message).toBe(
      "Somebody else changed this while you were editing it. Reload and try again.",
    );
  });

  test("other errors are untouched", () => {
    expect(respond(new CustomError(404, "Not found.")).statusCode).toBe(404);

    const validation = new Error("bad");
    validation.name = "ValidationError";
    validation.errors = { title: { message: "Title is required." } };
    expect(respond(validation).statusCode).toBe(422);

    const duplicate = new Error("dup");
    duplicate.code = 11000;
    duplicate.keyValue = { email: "a@b.c" };
    expect(respond(duplicate).statusCode).toBe(422);

    expect(respond(new Error("boom")).statusCode).toBe(500);
  });
});
