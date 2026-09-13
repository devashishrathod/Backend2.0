const {
  syncSectionCoverImage,
  getMediaCoverImage,
  pickCoverMedia,
} = require("../../helpers/showcases/validateMedia");
const { SHOWCASE_COVER_IMAGE_MODE } = require("../../constants/showcase");

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

/** A media array with Mongoose's `.id()` lookup, which the helper relies on. */
const mediaList = (items) => {
  const list = items.map((m) => ({
    isDeleted: false,
    isActive: true,
    thumbnail: null,
    ...m,
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

  test("prefers the thumbnail, so a video does not become an .mp4 link", () => {
    // Reading `url` first meant a video sorting to the top turned `coverImage`
    // into an .mp4 and every card rendering it showed a broken image.
    const section = {
      coverImageMode: AUTO,
      medias: mediaList([
        { _id: "a", sortOrder: 1, url: "clip.mp4", thumbnail: "poster.jpg" },
      ]),
    };

    syncSectionCoverImage(section);
    expect(section.coverImage).toBe("poster.jpg");
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
    section.medias.find((m) => m._id === "b").url = "replacement.jpg";

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
  test("getMediaCoverImage: thumbnail, then url, then nothing", () => {
    expect(getMediaCoverImage({ thumbnail: "t.jpg", url: "u.mp4" })).toBe("t.jpg");
    expect(getMediaCoverImage({ url: "u.jpg" })).toBe("u.jpg");
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
