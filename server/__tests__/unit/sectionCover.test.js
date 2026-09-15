const {
  syncSectionCoverImage,
  getMediaCoverImage,
  pickCoverMedia,
} = require("../../helpers/showcases/validateMedia");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");
const { MEDIA_KIND } = require("../../constants/storage");

const { AUTO, MANUAL } = SHOWCASE_COVER_IMAGE_MODE;

/**
 * A section's cover: the one that follows the media, and the one a vendor pins.
 *
 * 🔴 The pin is the dangerous half. `coverImageMode: MANUAL` made
 * `syncSectionCoverImage` return early, so a pinned media that was later
 * deleted left the section pointing at a file that no longer existed — a dead
 * tile on the brand's public profile, produced by an ordinary delete that
 * reported success.
 */

/**
 * A media array with Mongoose's `.id()` lookup, which the helper relies on.
 *
 * ⚠️ Each entry is a **gallery item**, and the file sits inside it as `media` —
 * the shape M-4 introduced. `photo()` and `video()` below build that file, so a
 * test says what it means rather than restating the schema each time.
 */
const photo = (url) => ({ url, kind: MEDIA_KIND.IMAGE });

const video = (url, posterUrl) => ({
  url,
  kind: MEDIA_KIND.VIDEO,
  poster: posterUrl ? { url: posterUrl } : undefined,
});

const mediaList = (items) => {
  const list = items.map(({ url, media, ...rest }) => ({
    isDeleted: false,
    isActive: true,
    media: media ?? (url ? photo(url) : undefined),
    ...rest,
  }));
  list.id = (id) => list.find((m) => String(m._id) === String(id)) || null;
  return list;
};

describe("AUTO — the cover follows the media", () => {
  test("takes the first visible media, by sort order", () => {
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        { _id: "b", sortOrder: 2, url: "second.jpg" },
        { _id: "a", sortOrder: 1, url: "first.jpg" },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBe("first.jpg");
  });

  test("a video answers its poster, so the cover is never an .mp4 link", () => {
    // Reading `url` first meant a video sorting to the top turned `coverImage`
    // into an .mp4 and every card rendering it showed a broken image.
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        { _id: "a", sortOrder: 1, media: video("clip.mp4", "poster.jpg") },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBe("poster.jpg");
  });

  /**
   * 🔴 The `||` that made the bug.
   *
   * This used to be `thumbnail || url`, so a video with no poster fell through
   * to its own `.mp4` — and on S3 **no poster was ever produced**, which meant
   * every video-first section had a video file as its cover image. `null` is
   * the honest answer; the poster is mandatory at upload, so a row reaching
   * this state was written some other way and should look broken, not fine.
   */
  test("a video with no poster answers null, never the .mp4", () => {
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        { _id: "a", sortOrder: 1, media: video("clip.mp4") },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBeNull();
  });

  test("a GIF is its own cover, like any other picture", () => {
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        {
          _id: "a",
          sortOrder: 1,
          media: { url: "loop.gif", kind: MEDIA_KIND.GIF },
        },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBe("loop.gif");
  });

  test("skips deleted and hidden media", () => {
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        { _id: "a", sortOrder: 1, url: "gone.jpg", isDeleted: true },
        { _id: "b", sortOrder: 2, url: "hidden.jpg", isActive: false },
        { _id: "c", sortOrder: 3, url: "visible.jpg" },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBe("visible.jpg");
  });

  test("an empty section has no cover, rather than a stale one", () => {
    const section = { coverImageMode: AUTO, coverImage: "old.jpg", medias: mediaList([]) };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBeNull();
  });
});

describe("MANUAL — a pin the vendor set", () => {
  const pinned = (overrides = {}) => ({
    coverImageMode: MANUAL,
    coverMediaId: "b",
    coverImage: "pinned.jpg",
    medias: mediaList([
      { _id: "a", sortOrder: 1, url: "first.jpg" },
      { _id: "b", sortOrder: 2, url: "pinned.jpg" },
      ...(overrides.extra || []),
    ]),
    ...overrides.section,
  });

  test("a reorder does not move it", () => {
    const section = pinned();

    syncSectionCoverImage(section);

    expect(section.coverImage).toBe("pinned.jpg");
    expect(section.coverImageMode).toBe(MANUAL);
  });

  test("🔴 replacing the pinned media's file moves the cover with it", () => {
    // This is what pinning an **id** buys over pinning a URL: the vendor said
    // "show this media", and after a replace it is still that media.
    const section = pinned();
    section.medias.find((m) => m._id === "b").media = photo("replacement.jpg");

    syncSectionCoverImage(section);

    expect(section.coverImage).toBe("replacement.jpg");
    expect(section.coverImageMode).toBe(MANUAL);
  });

  test("🔴 deleting the pinned media falls back to AUTO", () => {
    // Without this the section keeps pointing at a file that is gone.
    const section = pinned();
    section.medias.find((m) => m._id === "b").isDeleted = true;

    syncSectionCoverImage(section);

    expect(section.coverImageMode).toBe(AUTO);
    expect(section.coverMediaId).toBeUndefined();
    expect(section.coverImage).toBe("first.jpg");
  });

  test("🔴 hiding the pinned media falls back too", () => {
    // A hidden media is deliberately not in the gallery; showing it as the
    // cover would contradict the vendor's own choice.
    const section = pinned();
    section.medias.find((m) => m._id === "b").isActive = false;

    syncSectionCoverImage(section);

    expect(section.coverImageMode).toBe(AUTO);
    expect(section.coverImage).toBe("first.jpg");
  });

  test("a pin naming a media that is not there falls back", () => {
    const section = pinned({ section: { coverMediaId: "does-not-exist" } });

    syncSectionCoverImage(section);

    expect(section.coverImageMode).toBe(AUTO);
    expect(section.coverImage).toBe("first.jpg");
  });

  test("MANUAL with no id at all falls back — it can point at nothing", () => {
    // Every section written before `coverMediaId` existed looks like this.
    const section = pinned({ section: { coverMediaId: undefined } });

    syncSectionCoverImage(section);

    expect(section.coverImageMode).toBe(AUTO);
    expect(section.coverImage).toBe("first.jpg");
  });

  test("falling back on an empty section leaves no cover", () => {
    const section = {
      coverImageMode: MANUAL,
      coverMediaId: "b",
      coverImage: "pinned.jpg",
      medias: mediaList([]),
    };

    syncSectionCoverImage(section);

    expect(section.coverImageMode).toBe(AUTO);
    expect(section.coverImage).toBeNull();
  });
});

describe("the pieces underneath", () => {
  test("getMediaCoverImage: a video's poster, a picture's own url, else null", () => {
    expect(getMediaCoverImage({ media: video("u.mp4", "t.jpg") })).toBe("t.jpg");
    expect(getMediaCoverImage({ media: photo("u.jpg") })).toBe("u.jpg");
    // 🔴 No `|| url` fallback — that is what put `.mp4` links on brand profiles.
    expect(getMediaCoverImage({ media: video("u.mp4") })).toBeNull();
    expect(getMediaCoverImage({})).toBeNull();
    expect(getMediaCoverImage(null)).toBeNull();
  });

  test("pickCoverMedia: lowest sortOrder among the visible", () => {
    expect(
      pickCoverMedia(
        mediaList([
          { _id: "a", sortOrder: 5 },
          { _id: "b", sortOrder: 2 },
        ]),
      )._id,
    ).toBe("b");
    expect(pickCoverMedia([])).toBeNull();
  });
});
