/**
 * ⚠️ `jest.mock`, not `jest.spyOn` — see the note at the top of
 * `showcaseFloorConfig.test.js`. These helpers destructure `getSetting` at
 * module load, so replacing the export afterwards changes nothing they can see
 * and the call goes to a database that is not there.
 */
const mockSetting = { value: {} };
jest.mock("../../helpers/settings/getSetting", () => ({
  getSetting: jest.fn(async () => mockSetting.value),
  getSettingDocument: jest.fn(),
  invalidateSettingCache: jest.fn(),
}));

const { getUploadLimit } = require("../../helpers/settings/getUploadLimit");
const {
  UPLOAD_PURPOSE,
  UPLOAD_PURPOSES,
  MEDIA_KIND,
} = require("../../constants/storage");

const MB = 1024 * 1024;

/**
 * U-3 — "how big may this file be, here", answered once.
 *
 * ### 🔴 Why this exists
 *
 * Three sources answered that question and nothing said which won: a static
 * ceiling in `UPLOAD_PURPOSES`, the platform limit the admin owns
 * (`Setting.storage.limits`, ST-3), and a surface narrowing it
 * (`Setting.vendor.showcase.*`, ST-4).
 *
 * The multipart road read the surface one. The presigned road read **only the
 * constant** — `presign` built its S3 policy from it and `confirm` never looked
 * at size at all. So an admin lowering the platform video limit changed the
 * panel and left direct-to-S3 exactly where it was: one platform, two limits,
 * and the smaller one was the one that could be turned off.
 */

const stored = (value) => {
  mockSetting.value = value;
};

afterEach(() => {
  mockSetting.value = {};
});

describe("🔴 the smallest of the three wins", () => {
  it("takes the platform limit when the surface says nothing", async () => {
    stored({ storage: { limits: { maxVideoSizeMB: 20 } } });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.VIDEO,
    );

    expect(limit.maxBytes).toBe(20 * MB);
    expect(limit.maxSizeMB).toBe(20);
  });

  it("takes the surface limit when it asks for less", async () => {
    stored({
      storage: { limits: { maxVideoSizeMB: 40 } },
      vendor: { showcase: { maxVideoSizeMB: 12 } },
    });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.VIDEO,
    );

    expect(limit.maxSizeMB).toBe(12);
  });

  /**
   * 🔴 A surface may narrow the platform ceiling. It may not raise it.
   * `assertStorageLimitRule` refuses such a save, but a document seeded
   * directly or restored from an older shape never went through it.
   */
  it("refuses to let a surface raise the platform ceiling", async () => {
    stored({
      storage: { limits: { maxVideoSizeMB: 20 } },
      vendor: { showcase: { maxVideoSizeMB: 80 } },
    });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.VIDEO,
    );

    expect(limit.maxSizeMB).toBe(20);
  });

  /**
   * 🔴 And neither of them may raise the code's ceiling.
   *
   * ⚠️ This is the one that survives a `Setting` that is missing, corrupt or
   * written by something that skipped every rule. A limit whose floor is
   * "whatever the database says" is not a limit — it is a default.
   */
  it("never goes above the static ceiling, whatever the settings say", async () => {
    stored({
      storage: { limits: { maxVideoSizeMB: 4096 } },
      vendor: { showcase: { maxVideoSizeMB: 4096 } },
    });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.VIDEO,
    );

    expect(limit.maxBytes).toBe(
      UPLOAD_PURPOSES[UPLOAD_PURPOSE.SHOWCASE_MEDIA].maxBytes,
    );
  });
});

describe("⚠️ a GIF is metered against its own ceiling", () => {
  /**
   * A GIF is an `image/*` type but stores every frame whole, so holding it to
   * the photo limit refuses ordinary GIFs while the allow-list claims to accept
   * them. The two numbers have to stay separate all the way down.
   */
  it("does not read the image limit for a GIF", async () => {
    stored({
      storage: { limits: { maxImageSizeMB: 2, maxGifSizeMB: 9 } },
    });

    const image = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.IMAGE,
    );
    const gif = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.GIF,
    );

    expect(image.maxSizeMB).toBe(2);
    expect(gif.maxSizeMB).toBe(9);
  });
});

describe("a surface with no override of its own", () => {
  /**
   * ⚠️ Overrides are named one by one in `SURFACE_LIMITS`, never looked up by
   * convention — a convention would silently start honouring a number the day
   * somebody added it to the schema, with no test and nobody deciding.
   */
  it("falls through to the platform limit", async () => {
    stored({
      storage: { limits: { maxImageSizeMB: 3 } },
      // A showcase override exists and must not reach a different surface.
      vendor: { showcase: { maxImageSizeMB: 1 } },
    });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.CATEGORY_IMAGE,
      MEDIA_KIND.IMAGE,
    );

    expect(limit.maxSizeMB).toBe(3);
  });

  /**
   * ⚠️ Pins the `if (key)` guard rather than a real upload — a poster is never a
   * video. It matters because the alternative shape, reading the surface block
   * by kind name with a fallback, would quietly apply the showcase's **video**
   * limit to a purpose that has nothing to do with videos.
   */
  it("falls through for a kind the surface does not narrow", async () => {
    stored({
      /**
       * ⚠️ The image limit is deliberately the **smallest** number here.
       *
       * An earlier version of this test used a larger one and proved nothing:
       * the obvious wrong implementation — falling back to the image key when
       * the kind is not named — landed on a number big enough that
       * `min(platform video, that)` still came out at the expected answer.
       * Mutation caught it. With 2 MB, falling back is visible.
       */
      storage: { limits: { maxVideoSizeMB: 6, maxImageSizeMB: 2 } },
      // `SHOWCASE_THUMBNAIL` names IMAGE and GIF. It does not name VIDEO.
      vendor: { showcase: { maxVideoSizeMB: 5 } },
    });

    const limit = await getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_THUMBNAIL,
      MEDIA_KIND.VIDEO,
    );

    // 5 would mean the showcase's video limit had been read for a poster.
    // 2 would mean an unnamed kind fell back to the image key.
    expect(limit.maxSizeMB).toBe(6);
  });
});

/**
 * 🔴 `getUploadLimit` does not trust the surface helper to have narrowed.
 *
 * ⚠️ `getShowcaseConfig` narrows its own ceilings, so through the real helper
 * this branch is unreachable — mutation proved it, by surviving a mutant that
 * let the surface win outright. That is not a reason to drop the guard; it is a
 * reason to test it properly. The contract is *"a surface may narrow the
 * platform ceiling, never raise it"*, and it has to hold for the **next**
 * surface helper too, written by somebody who did not read this file.
 *
 * The only way to hand it a helper that misbehaves is to be that helper.
 */
describe("🔴 a surface helper that forgot to narrow is still narrowed here", () => {
  it("does not let it raise the platform ceiling", async () => {
    jest.resetModules();
    jest.doMock("../../helpers/settings/getShowcaseConfig", () => ({
      // Deliberately un-narrowed: 80 MB against a 20 MB platform ceiling.
      getShowcaseConfig: async () => ({ maxVideoSizeMB: 80 }),
    }));

    const fresh = require("../../helpers/settings/getUploadLimit");
    mockSetting.value = { storage: { limits: { maxVideoSizeMB: 20 } } };

    const limit = await fresh.getUploadLimit(
      UPLOAD_PURPOSE.SHOWCASE_MEDIA,
      MEDIA_KIND.VIDEO,
    );

    expect(limit.maxSizeMB).toBe(20);

    jest.dontMock("../../helpers/settings/getShowcaseConfig");
    jest.resetModules();
  });
});

describe("when the surface does not exist", () => {
  it("answers 500, because that is our bug and not the caller's", async () => {
    await expect(
      getUploadLimit("NOT_A_PURPOSE", MEDIA_KIND.IMAGE),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});
