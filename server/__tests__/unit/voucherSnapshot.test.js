/**
 * What a claim freezes about the voucher it was bought from (V-6c).
 *
 * The point of these is the **resolution**, not the copying. A snapshot that
 * recorded `banner.current` would name a banner the customer may never have
 * seen — a pending one, a rejected one, or none at all while the tile was
 * showing the first image instead.
 */

const {
  buildVoucherSnapshot,
} = require("../../helpers/vouchers/buildVoucherSnapshot");
const { VOUCHER_BANNER_STATUS } = require("../../constants/voucherBanner");

const image = (url, sortOrder, kind = "IMAGE") => ({
  media: { url, kind },
  sortOrder,
});

const voucher = (banner) => ({
  name: "Pizza Friday",
  categoryId: "cat-1",
  subCategoryId: "sub-1",
  banner,
});

const THREE = [
  image("https://cdn.test/b.webp", 2),
  image("https://cdn.test/a.webp", 1),
  image("https://cdn.test/c.webp", 3),
];

describe("what always travels with a claim", () => {
  it("keeps the three fields that were already frozen", () => {
    const snap = buildVoucherSnapshot(voucher(null), { images: THREE });

    expect(snap.name).toBe("Pizza Friday");
    expect(snap.categoryId).toBe("cat-1");
    expect(snap.subCategoryId).toBe("sub-1");
  });

  /**
   * ⚠️ `sortOrder`, not array position. The array's order is whatever Mongo
   * stored; `sortOrder` is what the vendor chose, and it is what the customer's
   * tile was built from.
   */
  it("takes the first image by sortOrder, not by array position", () => {
    const snap = buildVoucherSnapshot(voucher(null), { images: THREE });

    expect(snap.imageUrl).toBe("https://cdn.test/a.webp");
  });

  it("does not reorder the caller's array", () => {
    const images = [...THREE];
    buildVoucherSnapshot(voucher(null), { images });

    // The document is about to be saved by the caller — sorting in place here
    // would quietly renumber their images.
    expect(images.map((i) => i.sortOrder)).toEqual([2, 1, 3]);
  });

  it("skips an image row that carries no file", () => {
    const snap = buildVoucherSnapshot(voucher(null), {
      images: [{ media: {}, sortOrder: 1 }, image("https://cdn.test/real.webp", 2)],
    });

    expect(snap.imageUrl).toBe("https://cdn.test/real.webp");
  });
});

describe("🔴 the banner is what the customer actually saw", () => {
  it("freezes an approved banner", () => {
    const snap = buildVoucherSnapshot(
      voucher({
        current: { url: "https://cdn.test/banner.webp", kind: "IMAGE" },
        status: null,
      }),
      { images: THREE },
    );

    expect(snap.bannerUrl).toBe("https://cdn.test/banner.webp");
    expect(snap.bannerType).toBe("IMAGE");
    // Kept beside it, not instead of it — the history can still show the
    // product rather than the artwork.
    expect(snap.imageUrl).toBe("https://cdn.test/a.webp");
  });

  /**
   * 🔴 The case that decides whether this helper is worth having. A pending
   * banner is not served to anybody (V-5), so the tile showed `images[0]` — and
   * that is what the claim has to remember.
   */
  it("freezes the fallback, not the pending banner nobody was shown", () => {
    const snap = buildVoucherSnapshot(
      voucher({
        pending: { url: "https://cdn.test/unseen.webp", kind: "IMAGE" },
        status: VOUCHER_BANNER_STATUS.PENDING,
      }),
      { images: THREE },
    );

    expect(snap.bannerUrl).toBe("https://cdn.test/a.webp");
    expect(snap.bannerUrl).not.toBe("https://cdn.test/unseen.webp");
  });

  it("freezes the fallback when the banner was rejected", () => {
    const snap = buildVoucherSnapshot(
      voucher({
        pending: { url: "https://cdn.test/refused.webp", kind: "IMAGE" },
        status: VOUCHER_BANNER_STATUS.REJECTED,
        rejectionReason: "Text unreadable",
      }),
      { images: THREE },
    );

    expect(snap.bannerUrl).toBe("https://cdn.test/a.webp");
  });

  it("freezes the fallback when there was never a banner", () => {
    const snap = buildVoucherSnapshot(voucher(null), { images: THREE });

    // Same URL in both, and that is the truth of that claim.
    expect(snap.bannerUrl).toBe("https://cdn.test/a.webp");
    expect(snap.imageUrl).toBe("https://cdn.test/a.webp");
  });

  /**
   * ⚠️ A video banner cannot be painted without its poster. These two fields
   * are not decoration: without them a client has to guess, or fetch the video
   * to find out what it is.
   */
  it("carries the poster and the type for a video banner", () => {
    const snap = buildVoucherSnapshot(
      voucher({
        current: {
          url: "https://cdn.test/clip.mp4",
          kind: "VIDEO",
          poster: { url: "https://cdn.test/poster.webp" },
        },
        status: null,
      }),
      { images: THREE },
    );

    expect(snap.bannerType).toBe("VIDEO");
    expect(snap.bannerUrl).toBe("https://cdn.test/clip.mp4");
    expect(snap.bannerThumbnail).toBe("https://cdn.test/poster.webp");
  });
});

describe("a voucher with nothing to show", () => {
  it("answers null rather than throwing", () => {
    const snap = buildVoucherSnapshot(voucher(null), { images: [] });

    // A client gets "no image"; nothing here decides that a claim cannot be made.
    expect(snap.bannerUrl).toBeNull();
    expect(snap.imageUrl).toBeNull();
    expect(snap.bannerType).toBeNull();
  });

  it("survives a version with no images array at all", () => {
    expect(() => buildVoucherSnapshot(voucher(null), {})).not.toThrow();
    expect(buildVoucherSnapshot(voucher(null), {}).imageUrl).toBeNull();
  });

  it("survives being handed nothing", () => {
    expect(() => buildVoucherSnapshot(undefined, undefined)).not.toThrow();
  });

  /**
   * ⚠️ Every field is present even when empty. A key that appears only
   * sometimes means every reader has to check for both shapes.
   */
  it("always returns the same keys", () => {
    const keys = Object.keys(buildVoucherSnapshot(voucher(null), { images: [] }));

    expect(keys.sort()).toEqual(
      [
        "bannerThumbnail",
        "bannerType",
        "bannerUrl",
        "categoryId",
        "imageUrl",
        "name",
        "subCategoryId",
      ].sort(),
    );
  });
});
