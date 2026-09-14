const {
  sameNameAs,
  normalizedNameKey,
} = require("../../helpers/common/caseInsensitiveName");
const { normalizeVoucherName } = require("../../helpers/vouchers");

/**
 * 🔴 Two halves of one rule, which came apart.
 *
 * These surfaces used to lowercase the name **on write**, which made the
 * duplicate check case-insensitive for free — `findOne({ name })` could not miss
 * "Pizza" when "pizza" was stored. It also meant the app rendered "cafe mocha"
 * for a brand that had typed "Cafe Mocha".
 *
 * Storing the name as typed fixed the display and silently removed the matching:
 * an exact `findOne` stopped seeing "pizza" when the row said "Pizza", and both
 * could be created. The unique index behind the voucher could not help either —
 * it compares bytes, not meaning.
 */

/** What a Mongo `$regex` condition would actually match. */
const matches = (condition, value) => condition.$regex.test(value);

describe("the name is compared the way a person reads it", () => {
  test("🔴 case does not make a second row", () => {
    const condition = sameNameAs("Pizza");

    expect(matches(condition, "pizza")).toBe(true);
    expect(matches(condition, "PIZZA")).toBe(true);
    expect(matches(condition, "PiZzA")).toBe(true);
  });

  test("⚠️ but it is anchored — a longer name is a different name", () => {
    // Unanchored, "Pizza" would collide with "Pizza Hut" and the vendor could
    // never create the second one.
    const condition = sameNameAs("Pizza");

    expect(matches(condition, "Pizza Hut")).toBe(false);
    expect(matches(condition, "Best Pizza")).toBe(false);
  });

  test("🔴 a name is user input, so its regex characters are escaped", () => {
    // `.` must be a full stop, not "any character".
    expect(matches(sameNameAs("St. Mary's"), "StXMary's")).toBe(false);
    expect(matches(sameNameAs("St. Mary's"), "st. mary's")).toBe(true);
  });

  test("⚠️ and `.*` cannot turn the check off", () => {
    // Otherwise one crafted name would collide with every existing one — or,
    // read the other way, would report a duplicate that is not there.
    expect(matches(sameNameAs(".*"), "Anything At All")).toBe(false);
    expect(matches(sameNameAs(".*"), ".*")).toBe(true);
  });

  test("surrounding whitespace is not a different name", () => {
    expect(matches(sameNameAs("  Pizza  "), "Pizza")).toBe(true);
  });

  test("no name is null, so a caller can skip the query", () => {
    expect(sameNameAs("")).toBeNull();
    expect(sameNameAs("   ")).toBeNull();
    expect(sameNameAs(null)).toBeNull();
  });
});

describe("the key a unique index can enforce", () => {
  test("🔴 lowercase — this is what stops two vouchers called Pizza", () => {
    // A regex cannot back a unique index. `{ brandId, normalizedName }` can,
    // but only if both rows reduce to the same string.
    expect(normalizedNameKey("Pizza")).toBe("pizza");
    expect(normalizedNameKey("PIZZA")).toBe(normalizedNameKey("pizza"));
  });

  test("⚠️ inner whitespace is collapsed too", () => {
    // "Pizza  Hut" and "Pizza Hut" are one name to a reader, and the index has
    // to agree or both get created.
    expect(normalizedNameKey("  Pizza   Hut ")).toBe("pizza hut");
    expect(normalizedNameKey("Pizza Hut")).toBe(normalizedNameKey("Pizza  Hut"));
  });

  test("nothing is an empty string, not a crash", () => {
    expect(normalizedNameKey(null)).toBe("");
    expect(normalizedNameKey(undefined)).toBe("");
  });
});

describe("🔴 create and update reduce a name the same way", () => {
  test("the voucher helper is that one key", () => {
    // These had drifted: create collapsed inner whitespace and update only
    // trimmed. So "Pizza  Hut" made one row on create and a second on update —
    // past a unique index that saw two different strings.
    expect(normalizeVoucherName("  Pizza   Hut ")).toBe("pizza hut");
    expect(normalizeVoucherName("PIZZA HUT")).toBe(
      normalizeVoucherName("pizza hut"),
    );
  });

  test("⚠️ and it is not what the customer sees", () => {
    // The voucher's own `name` keeps what the vendor typed. This is a
    // comparison key: never displayed, never returned.
    expect(normalizeVoucherName("Cafe Mocha")).not.toBe("Cafe Mocha");
  });
});
