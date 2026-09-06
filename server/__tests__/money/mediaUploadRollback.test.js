/**
 * Banner and ticker creation — the upload half, which nothing tested.
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
  assertNoActiveOverlap: jest.fn(),
}));

jest.mock("../../helpers/promotionalTickers", () => ({
  uploadTickerIcon: jest.fn(),
  deleteTickerIcon: jest.fn(),
}));

jest.mock("../../models/Banner", () => ({ create: jest.fn() }));
jest.mock("../../models/PromotionalTicker", () => ({ create: jest.fn() }));

const Banner = require("../../models/Banner");
const PromotionalTicker = require("../../models/PromotionalTicker");
const {
  uploadBannerMedia,
  deleteBannerMedia,
  assertNoActiveOverlap,
} = require("../../helpers/banners");
const {
  uploadTickerIcon,
  deleteTickerIcon,
} = require("../../helpers/promotionalTickers");

const { createBanner } = require("../../services/banners/createBanner");
const { createTicker } = require("../../services/promotionalTickers/createTicker");

const USER = new mongoose.Types.ObjectId();
const UPLOADED = { url: "https://res.cloudinary.com/x/image/upload/a.png", publicId: "a" };

const file = () => ({ name: "a.png", tempFilePath: "/tmp/a.png", size: 67 });

beforeEach(() => {
  jest.clearAllMocks();
  assertNoActiveOverlap.mockResolvedValue(undefined);
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

    expect(uploadBannerMedia).toHaveBeenCalledWith(type, expect.any(Object));
    expect(Banner.create).toHaveBeenCalledWith(
      expect.objectContaining({ [field]: UPLOADED, type }),
    );
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
   * The overlap guard runs **before** the upload, deliberately: an overlapping
   * schedule is a refusal, and paying Cloudinary for a file that is about to be
   * refused is money spent on nothing.
   */
  test("an overlapping active banner is refused before anything uploads", async () => {
    assertNoActiveOverlap.mockRejectedValue(
      Object.assign(new Error("Another banner is already active"), { statusCode: 409 }),
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

    expect(uploadTickerIcon).toHaveBeenCalledWith(undefined);
    expect(PromotionalTicker.create).not.toHaveBeenCalled();
  });
});
