const { pickOrphanImages } = require("../../helpers/vouchers/orphanImages");
const VoucherVersion = require("../../models/VoucherVersion");

/**
 * 🔴 The delete that reached across versions.
 *
 * Editing a published voucher forks a new draft, and the fork copies every kept
 * image across **with its `storage`** — so two version documents name one
 * object. The fork knows not to delete. The next ordinary edit to that draft
 * did not, and destroyed the file the live voucher was still serving.
 *
 * These tests are about identity: the same file, reached through two rows.
 */

/**
 * ⚠️ Deliberately **no `url`** on the provider fixtures.
 *
 * With one, every row could still be matched by URL alone, and a test that
 * passed with the `key` comparison deleted would prove nothing about it — which
 * is exactly what the first version of this file did. Stripping the URL leaves
 * each identity path as the only way through.
 */
const s3 = (key) => ({
  storage: {
    provider: "AWS_S3",
    publicId: null,
    bucket: "trydood-nonprod-public",
    key,
  },
});

const cloudinary = (publicId) => ({
  storage: { provider: "CLOUDINARY", publicId, bucket: null, key: null },
});

/** Rows before `storage` existed carry nothing but a URL. */
const legacy = (url) => ({ url });

/** What the surviving versions hold, for one test. */
const survivorsAre = (...versions) => {
  jest.spyOn(VoucherVersion, "find").mockReturnValue({
    lean: () => Promise.resolve(versions.map((images) => ({ images }))),
  });
};

afterEach(() => jest.restoreAllMocks());

describe("a file another version still points at is never deleted", () => {
  test("🔴 the fork case — draft and published share one object", () => {
    const shared = s3("dev/images/vouchers/v1/abc.webp");
    survivorsAre([shared]); // v1 PUBLISHED still has it

    return expect(pickOrphanImages([shared], "v1")).resolves.toEqual([]);
  });

  test("the same file reached through a different subdocument is still seen", async () => {
    // The fork rewrites `sortOrder` and mints nothing new, so comparing whole
    // documents would miss. Only the key names the file.
    const published = { ...s3("dev/images/vouchers/v1/abc.webp"), sortOrder: 3 };
    const removed = { ...s3("dev/images/vouchers/v1/abc.webp"), sortOrder: 1 };
    survivorsAre([published]);

    expect(await pickOrphanImages([removed], "v1")).toEqual([]);
  });

  test("Cloudinary rows are matched on publicId", async () => {
    const shared = cloudinary("vouchers/mocha1");
    survivorsAre([shared]);

    expect(await pickOrphanImages([shared], "v1")).toEqual([]);
  });

  test("a legacy row with no storage is matched on its URL", async () => {
    const shared = legacy("https://res.cloudinary.com/demo/old.jpg");
    survivorsAre([shared]);

    expect(await pickOrphanImages([shared], "v1")).toEqual([]);
  });

  test("⚠️ and an unreferenced legacy row still comes back", async () => {
    // Both directions, or the URL fallback can be deleted outright and the
    // test above still passes: with no identity the row is filtered out of the
    // candidates, and "nothing to delete" looks the same as "do not delete".
    const orphan = legacy("https://res.cloudinary.com/demo/gone.jpg");
    survivorsAre([legacy("https://res.cloudinary.com/demo/other.jpg")]);

    expect(await pickOrphanImages([orphan], "v1")).toEqual([orphan]);
  });
});

describe("a file nobody points at is returned for deletion", () => {
  test("the ordinary case — a draft's own image", async () => {
    const own = s3("dev/images/vouchers/v1/only-mine.webp");
    survivorsAre([s3("dev/images/vouchers/v1/other.webp")]);

    expect(await pickOrphanImages([own], "v1")).toEqual([own]);
  });

  test("⚠️ a mixed removal splits — shared kept, orphan deleted", async () => {
    // The case that matters most: one request removing both kinds at once. A
    // whole-list decision would either strand a file or kill a live one.
    const shared = s3("dev/images/vouchers/v1/shared.webp");
    const orphan = s3("dev/images/vouchers/v1/orphan.webp");
    survivorsAre([shared]);

    expect(await pickOrphanImages([shared, orphan], "v1")).toEqual([orphan]);
  });

  test("no surviving version at all — everything is an orphan", async () => {
    const a = s3("dev/a.webp");
    const b = cloudinary("vouchers/b");
    survivorsAre();

    expect(await pickOrphanImages([a, b], "v1")).toEqual([a, b]);
  });
});

describe("it does not fall over", () => {
  test("nothing to check means no query at all", async () => {
    const find = jest.spyOn(VoucherVersion, "find");
    expect(await pickOrphanImages([], "v1")).toEqual([]);
    expect(await pickOrphanImages(undefined, "v1")).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  test("an image that names no file is skipped, not guessed at", async () => {
    // There is nothing to delete and nothing to compare, so it must not be
    // handed to the deleter as though it were a real object.
    const find = jest.spyOn(VoucherVersion, "find");
    expect(await pickOrphanImages([{ sortOrder: 1 }], "v1")).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  test("a surviving version with no images does not break the scan", async () => {
    const own = s3("dev/a.webp");
    survivorsAre(undefined, []);

    expect(await pickOrphanImages([own], "v1")).toEqual([own]);
  });

  test("the query is scoped to the voucher and skips deleted versions", async () => {
    const find = jest.spyOn(VoucherVersion, "find").mockReturnValue({
      lean: () => Promise.resolve([]),
    });
    await pickOrphanImages([s3("dev/a.webp")], "voucher-1");

    expect(find.mock.calls[0][0]).toEqual({
      voucherId: "voucher-1",
      isDeleted: false,
    });
  });
});
