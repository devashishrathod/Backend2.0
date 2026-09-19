/**
 * ⚠️ `mock`-prefixed, because jest hoists `jest.mock` above every other
 * statement and refuses a factory that closes over anything else.
 */
const mockDeleteAsset = jest.fn();
jest.mock("../../services/storage", () => ({
  deleteAsset: (...args) => mockDeleteAsset(...args),
}));
const deleteAsset = mockDeleteAsset;

const { discardOnFailure } = require("../../helpers/media/discardOnFailure");

/**
 * 🔴 G6 — keep the file only if the row that was going to point at it exists.
 *
 * A create path uploads first, because the object key carries the new id. If the
 * write then fails, the object stays in the bucket with nothing referring to it
 * — and **forever is literal**: a confirmed upload has already moved out of
 * `staging/`, so the lifecycle rule that sweeps abandoned uploads never sees it,
 * and there is no other sweep.
 *
 * Four surfaces did this: `createCategory`, `createSubCategory`, `registerUser`
 * and `addBrandFeature`. `createBanner` and `createTicker` always cleaned up.
 */

const uploaded = {
  url: "https://cdn.example.com/x.png",
  storage: { provider: "AWS_S3", bucket: "b", key: "images/x/y.png" },
  metadata: { mimeType: "image/png" },
};

beforeEach(() => {
  deleteAsset.mockReset().mockResolvedValue(true);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("🔴 a failed write takes its file with it", () => {
  test("the object is discarded when the row cannot be created", async () => {
    const boom = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

    await expect(
      discardOnFailure(uploaded, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(deleteAsset).toHaveBeenCalledWith(uploaded);
  });

  test("⚠️ and the original error still reaches the caller, unchanged", async () => {
    // Cleaning up is not a reason to change what the caller is told.
    const boom = Object.assign(new Error("already exists"), { statusCode: 400 });

    await expect(discardOnFailure(uploaded, async () => { throw boom; })).rejects
      .toMatchObject({ statusCode: 400, message: "already exists" });
  });

  test("a successful write keeps the file, and returns what it made", async () => {
    const row = { _id: "1" };

    await expect(discardOnFailure(uploaded, async () => row)).resolves.toBe(row);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ A surface can legitimately create a row with no picture — every one of
   * these four takes the image as optional.
   */
  test.each([
    ["nothing uploaded", null],
    ["an empty slot", {}],
    ["a media with no locator", { url: null, storage: {} }],
  ])("%s means there is nothing to discard", async (_label, value) => {
    await expect(
      discardOnFailure(value, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect(deleteAsset).not.toHaveBeenCalled();
  });

  test("a private object is discarded by its key, having no url", async () => {
    const document = { url: null, storage: { key: "documents/inv/1.pdf" } };

    await expect(
      discardOnFailure(document, async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow();

    expect(deleteAsset).toHaveBeenCalledWith(document);
  });

  /**
   * 🔴 A failed cleanup must not overwrite the failure the caller is waiting
   * for. The request's outcome is already decided; a second error would replace
   * "that name is taken" with something about storage, which is the one message
   * nobody can act on.
   */
  test("🔴 a cleanup that itself fails does not hide the real error", async () => {
    deleteAsset.mockRejectedValue(new Error("S3 is having a day"));
    const real = Object.assign(new Error("Category already exist"), {
      statusCode: 400,
    });

    await expect(discardOnFailure(uploaded, async () => { throw real; })).rejects
      .toBe(real);

    // It is a log line, exactly as a failed delete after a successful save is.
    expect(console.error).toHaveBeenCalled();
  });
});
