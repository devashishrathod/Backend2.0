const Joi = require("joi");

const {
  validateCreateSection,
  validateUpdateSection,
  validateReorderSections,
  validateReorderMedias,
  validateUpdateMedia,
} = require("../../validator/showcase");

/**
 * S-2 (S-13) — a position is not something one request can name.
 *
 * ### 🔴 Why the field had to go rather than be validated harder
 *
 * `sortOrder` was accepted one section at a time and written straight through, so
 * two sections could hold `1` and one could hold `99`. Which of the two came
 * first was then whatever Mongo returned first, and nothing renumbered
 * afterwards — the list simply stayed wrong, with no error anywhere.
 *
 * No per-field rule fixes that: `min(1)` and `integer` were both already there.
 * Uniqueness and density are properties of the **whole list**, which is why they
 * can only be enforced where the whole list arrives — the reorder endpoints.
 * `validateUpdateMedia` has refused the field from the start; this is the rest of
 * the domain catching up to it.
 *
 * ### The field is dropped, not refused
 *
 * `validateSchema` runs Joi with `stripUnknown: true`, so a client still sending
 * `sortOrder` gets it removed rather than a `422`. That is deliberate: refusing
 * would break every panel build in the field for a value the server was about to
 * ignore anyway.
 */

const createBody = (overrides = {}) => ({
  title: "Ambience",
  ...overrides,
});

/**
 * What `validateSchema` does to a body, without standing up Express.
 *
 * ⚠️ `Joi.compile`, because the two shapes in this file are not the same kind of
 * thing: `validateCreateSection` is a `Joi.object`, while the reorder validators
 * hand over a **plain object** that `validateSchema` wraps into one. Calling
 * `.validate` directly works on the first and is not a function on the second.
 */
const strip = (schema, body) =>
  Joi.compile(schema).validate(body, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

/** The same wrap, for reading a schema's declared keys. */
const keysOf = (schema) => Joi.compile(schema).describe().keys;

describe("create section", () => {
  test("a sortOrder in the payload is dropped, not refused", () => {
    const { error, value } = strip(
      validateCreateSection,
      createBody({ sortOrder: 1 }),
    );

    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("sortOrder");
    expect(value.title).toBe("Ambience");
  });

  test("an absurd position is dropped just as quietly", () => {
    const { error, value } = strip(
      validateCreateSection,
      createBody({ sortOrder: 99 }),
    );

    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("sortOrder");
  });

  test("the schema no longer describes the field at all", () => {
    expect(keysOf(validateCreateSection)).not.toHaveProperty(
      "sortOrder",
    );
  });

  test("everything else the endpoint takes still arrives", () => {
    const { error, value } = strip(
      validateCreateSection,
      createBody({
        description: "Our dining room",
        isVisible: false,
        sortOrder: 4,
      }),
    );

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      title: "Ambience",
      description: "Our dining room",
      isVisible: false,
    });
    expect(value).not.toHaveProperty("sortOrder");
  });
});

describe("update section", () => {
  test("a sortOrder in the payload is dropped", () => {
    const { error, value } = strip(validateUpdateSection.body, {
      title: "Renamed",
      sortOrder: 2,
    });

    expect(error).toBeUndefined();
    expect(value).toEqual({ title: "Renamed" });
  });

  test("the schema no longer describes the field at all", () => {
    expect(keysOf(validateUpdateSection.body)).not.toHaveProperty(
      "sortOrder",
    );
  });
});

describe("the endpoints that do own positions still take them", () => {
  /**
   * The point is not that `sortOrder` is gone from the domain — it is that it
   * only arrives where the whole list arrives with it, so uniqueness and
   * density can actually be checked.
   */
  test("section reorder requires a position on every entry", () => {
    const { error, value } = strip(validateReorderSections.body, {
      sections: [
        { id: "68f1a2b3c4d5e6f7a8b9c5a1", sortOrder: 1 },
        { id: "68f1a2b3c4d5e6f7a8b9c5a2", sortOrder: 2 },
      ],
    });

    expect(error).toBeUndefined();
    expect(value.sections).toHaveLength(2);
    expect(value.sections[1].sortOrder).toBe(2);
  });

  test("media reorder requires a position on every entry", () => {
    const { error, value } = strip(validateReorderMedias.body, {
      medias: [
        { id: "68f1a2b3c4d5e6f7a8b9c5b1", sortOrder: 1 },
        { id: "68f1a2b3c4d5e6f7a8b9c5b2", sortOrder: 2 },
      ],
    });

    expect(error).toBeUndefined();
    expect(value.medias).toHaveLength(2);
  });

  test("a reorder entry with no position is refused", () => {
    const { error } = strip(validateReorderSections.body, {
      sections: [{ id: "68f1a2b3c4d5e6f7a8b9c5a1" }],
    });

    expect(error).toBeDefined();
  });

  /** The endpoint that has always been right — kept as the reference. */
  test("media update still refuses the field", () => {
    expect(keysOf(validateUpdateMedia.body)).not.toHaveProperty(
      "sortOrder",
    );
  });
});
