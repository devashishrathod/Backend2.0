/**
 * Banner and ticker media — the whole life of the file, which nothing tested.
 *
 * Creation (upload + rollback) and deletion (cleanup). Both ends were invisible
 * to the test suite, and both were wrong in the same direction: the file
 * outlived the row.
 *
 * ### 🔴 Why this file exists
 *
 * `POST /banners/create` and `POST /promotionalTickers/create` both take a
 * **file**, and a committed Postman collection cannot attach one — there is no
 * binary fixture in this repo, so both requests captured a `422` and that `422`
 * was the entire evidence either endpoint worked. It proves the validator is
 * alive and says nothing about the upload.
 *
 * Capturing a real success would mean a real Cloudinary upload on every capture
 * run, littering the account with 1×1 PNGs that nothing ever deletes. So the
 * coverage belongs here instead, where the uploader is a seam that can be made
 * to fail on demand — which is the one thing a live Cloudinary will not do to
 * order.
 *
 * ### What is actually at risk
 *
 * Both services follow the same shape:
 *
 * ```js
 * const media = await uploadBannerMedia(type, file);   // external, slow, costs money
 * try   { return await Banner.create({ …, [field]: media }); }
 * catch { await deleteBannerMedia(type, media); throw; } // ← this line
 * ```
 *
 * The upload happens **before** the row exists, so a failed insert leaves an
 * asset in Cloudinary that nothing references and nothing will ever find. That
 * rollback is the only thing standing between a validation error and a bill that
 * grows quietly for ever, and it is exactly the kind of line a refactor drops
 * without any test noticing.
 *
 * ⚠️ No database. Both the uploader and the model are seams; mocking them is
 * what lets the failure be produced deliberately.
 */

const mongoose = require("mongoose");

// ── seams ──────────────────────────────────────────────────────────────────
jest.mock("../../helpers/banners", () => ({
  uploadBannerMedia: jest.fn(),
  deleteBannerMedia: jest.fn(),
  assertActiveBannerCapacity: jest.fn(),
}));

jest.mock("../../helpers/promotionalTickers", () => ({
  uploadTickerIcon: jest.fn(),
  deleteTickerIcon: jest.fn(),
}));

jest.mock("../../models/Banner", () => ({
  create: jest.fn(),
  findOne: jest.fn(),
}));
jest.mock("../../models/PromotionalTicker", () => ({
  create: jest.fn(),
  findOne: jest.fn(),
}));

const Banner = require("../../models/Banner");
const PromotionalTicker = require("../../models/PromotionalTicker");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertActiveBannerCapacity,
} = require("../../helpers/banners");
const {
  uploadTickerIcon,
  deleteTickerIcon,
} = require("../../helpers/promotionalTickers");

const { createBanner } = require("../../services/banners/createBanner");
const { deleteBanner } = require("../../services/banners/deleteBanner");
const { createTicker } = require("../../services/promotionalTickers/createTicker");
const { deleteTicker } = require("../../services/promotionalTickers/deleteTicker");

const USER = new mongoose.Types.ObjectId();
const UPLOADED = { url: "https://res.cloudinary.com/x/image/upload/a.png", publicId: "a" };

// `mimetype` is not checked here — both uploaders are mocked, and the real mime
// allow-list lives inside them. It is set anyway so the fixture describes a file
// that could actually exist; the version without it is what made
// `brandFeatureOwnership` fail the moment a real check appeared upstream.
const file = () => ({
  name: "a.png",
  tempFilePath: "/tmp/a.png",
  size: 67,
  mimetype: "image/png",
});

beforeEach(() => {
  jest.clearAllMocks();
  assertActiveBannerCapacity.mockResolvedValue(undefined);
  uploadBannerMedia.mockResolvedValue(UPLOADED);
  uploadTickerIcon.mockResolvedValue(UPLOADED);
  deleteBannerMedia.mockResolvedValue(undefined);
  deleteTickerIcon.mockResolvedValue(undefined);
});

describe("createBanner — the file is required, and named by the type", () => {
  /**
   * ⚠️ The field name is derived from `type`, so a VIDEO banner carrying an
   * `image` file is refused. Getting this wrong would accept the upload and
   * store it under a key the reader never looks at — the banner would exist and
   * render blank.
   */
  test.each([
    ["IMAGE", "image"],
    ["VIDEO", "video"],
    ["GIF", "gif"],
  ])("%s looks for the `%s` file", async (type, field) => {
    await createBanner(USER, { title: "t", type }, { [field]: file() });

    const [calledType, calledFile, calledId] = uploadBannerMedia.mock.calls[0];
    expect(calledType).toBe(type);
    expect(calledFile).toEqual(expect.any(Object));

    expect(Banner.create).toHaveBeenCalledWith(
      expect.objectContaining({ [field]: UPLOADED, type }),
    );

    /**
     * ⚠️ The id the object key is built from has to be the id the row gets.
     *
     * The upload happens *before* the insert, so `createBanner` mints the id
     * itself and passes it both ways. If those two ever drifted apart the file
     * would sit under `banners/<some id>/` that no row points at — invisible to
     * any cleanup sweep, and impossible to trace back.
     */
    const created = Banner.create.mock.calls[0][0];
    expect(String(calledId)).toBe(String(created._id));
  });

  test("a VIDEO banner will not accept an image file", async () => {
    await expect(
      createBanner(USER, { title: "t", type: "VIDEO" }, { image: file() }),
    ).rejects.toMatchObject({ statusCode: 422 });

    // The upload must not have been attempted — paying for a file that is
    // about to be rejected is the wrong order.
    expect(uploadBannerMedia).not.toHaveBeenCalled();
  });

  test("no file at all is a 422 that names the field", async () => {
    await expect(
      createBanner(USER, { title: "t", type: "IMAGE" }, {}),
    ).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("image"),
    });
    expect(uploadBannerMedia).not.toHaveBeenCalled();
  });

  /**
   * The capacity guard runs **before** the upload, deliberately: a full home
   * screen is a refusal, and paying Cloudinary for a file that is about to be
   * refused is money spent on nothing.
   */
  test("a banner over the active limit is refused before anything uploads", async () => {
    assertActiveBannerCapacity.mockRejectedValue(
      Object.assign(new Error("Only 10 banners can be active at once"), { statusCode: 409 }),
    );

    await expect(
      createBanner(USER, { title: "t", type: "IMAGE" }, { image: file() }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(uploadBannerMedia).not.toHaveBeenCalled();
  });
});

describe("createBanner — a failed insert must not strand the upload", () => {
  test("the uploaded media is deleted when Banner.create throws", async () => {
    Banner.create.mockRejectedValue(new Error("E11000 duplicate key"));

    await expect(
      createBanner(USER, { title: "t", type: "IMAGE" }, { image: file() }),
    ).rejects.toThrow(/E11000/);

    // ⚠️ The whole point. Without this line the asset lives in Cloudinary for
    // ever, referenced by nothing and findable by nobody.
    expect(deleteBannerMedia).toHaveBeenCalledWith("IMAGE", UPLOADED);
  });

  test("the original error still surfaces — the rollback does not swallow it", async () => {
    Banner.create.mockRejectedValue(
      Object.assign(new Error("Title is required"), { statusCode: 422 }),
    );

    await expect(
      createBanner(USER, { title: "", type: "IMAGE" }, { image: file() }),
    ).rejects.toMatchObject({ statusCode: 422, message: "Title is required" });
  });

  test("nothing is deleted when the insert succeeds", async () => {
    Banner.create.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    await createBanner(USER, { title: "t", type: "IMAGE" }, { image: file() });

    expect(deleteBannerMedia).not.toHaveBeenCalled();
  });
});

describe("createTicker — same shape, same rollback", () => {
  test("the icon is uploaded and stored", async () => {
    PromotionalTicker.create.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    await createTicker(USER, { title: "t", displayOrder: 1 }, { icon: file() });

    expect(uploadTickerIcon).toHaveBeenCalled();
    expect(PromotionalTicker.create).toHaveBeenCalledWith(
      expect.objectContaining({ icon: UPLOADED }),
    );
  });

  test("the uploaded icon is deleted when the insert throws", async () => {
    PromotionalTicker.create.mockRejectedValue(new Error("validation failed"));

    await expect(
      createTicker(USER, { title: "t" }, { icon: file() }),
    ).rejects.toThrow(/validation failed/);

    expect(deleteTickerIcon).toHaveBeenCalledWith(UPLOADED);
  });

  /**
   * ⚠️ Unlike the banner, this service does **not** check for a missing file
   * itself — it hands `files?.icon` straight to the uploader, so the refusal
   * comes from `uploadTickerIcon`. That is a real difference in behaviour
   * between two endpoints that look identical, and it is asserted here so that
   * if either side changes, the change is deliberate.
   */
  test("a missing icon is refused by the uploader, not by the service", async () => {
    uploadTickerIcon.mockRejectedValue(
      Object.assign(new Error("Please upload an icon image."), { statusCode: 422 }),
    );

    await expect(createTicker(USER, { title: "t" }, {})).rejects.toMatchObject({
      statusCode: 422,
    });

    // The missing file is still the first argument; the second is the id the
    // object key would have been built from, minted before the upload.
    expect(uploadTickerIcon).toHaveBeenCalledWith(undefined, expect.anything());
    expect(PromotionalTicker.create).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a banner or a ticker used to keep the file.
 *
 * 🔴 Both helpers existed and both were only ever called from the create/update
 * rollback paths — `deleteBanner.js` and `deleteTicker.js` never mentioned
 * them. The row was soft-deleted and the asset simply stayed.
 *
 * That is not a small leak: the delete is soft, but nothing can bring the row
 * back — there is no restore endpoint and every read filters `isDeleted: false`.
 * So the file was paid for every month, referenced by a row nobody could reach.
 * Banners and tickers are the highest-churn content in the system (campaigns
 * change weekly), which is exactly why these two were the wrong ones to miss.
 */
describe("deleting a banner or ticker takes its file with it", () => {
  const savedBanner = (type, field) => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      type,
      [field]: UPLOADED,
      save: jest.fn().mockResolvedValue(undefined),
    };
    Banner.findOne.mockResolvedValue(doc);
    return doc;
  };

  test.each([
    ["IMAGE", "image"],
    ["VIDEO", "video"],
    ["GIF", "gif"],
  ])("%s banner — the %s file is deleted after the row is saved", async (type, field) => {
    const doc = savedBanner(type, field);

    await deleteBanner(USER, String(doc._id));

    expect(doc.isDeleted).toBe(true);
    expect(doc.isActive).toBe(false);
    expect(doc.save).toHaveBeenCalled();
    // The type goes along, so a GIF is not destroyed as a plain image —
    // Cloudinary answers "not found" on the wrong resource_type and keeps it.
    expect(deleteBannerMedia).toHaveBeenCalledWith(type, UPLOADED);
  });

  test("🔴 the row is saved BEFORE the file is destroyed", async () => {
    // If the order ever flips, a failed save leaves a live banner pointing at
    // an asset that is already gone — a blank slot on the home screen.
    const order = [];
    const doc = savedBanner("IMAGE", "image");
    doc.save.mockImplementation(async () => order.push("save"));
    deleteBannerMedia.mockImplementation(async () => order.push("delete"));

    await deleteBanner(USER, String(doc._id));

    expect(order).toEqual(["save", "delete"]);
  });

  test("a missing banner is a 404, and nothing is deleted", async () => {
    Banner.findOne.mockResolvedValue(null);

    await expect(deleteBanner(USER, String(new mongoose.Types.ObjectId())))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(deleteBannerMedia).not.toHaveBeenCalled();
  });

  test("ticker — the icon is deleted after the row is saved", async () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      icon: UPLOADED,
      save: jest.fn().mockResolvedValue(undefined),
    };
    PromotionalTicker.findOne.mockResolvedValue(doc);

    await deleteTicker(USER, String(doc._id));

    expect(doc.isDeleted).toBe(true);
    expect(doc.isActive).toBe(false);
    expect(deleteTickerIcon).toHaveBeenCalledWith(UPLOADED);
  });

  test("a missing ticker is a 404, and nothing is deleted", async () => {
    PromotionalTicker.findOne.mockResolvedValue(null);

    await expect(deleteTicker(USER, String(new mongoose.Types.ObjectId())))
      .rejects.toMatchObject({ statusCode: 404 });

    expect(deleteTickerIcon).not.toHaveBeenCalled();
  });
});
