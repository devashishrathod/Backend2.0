const mongoose = require("mongoose");

const {
  mapCustomerVoucherDetail,
  mapCustomerVoucherListItem,
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
} = require("../../helpers/vouchers/customerListing");

/**
 * What a **public** voucher read is allowed to say.
 *
 * 🔴 `GET /vouchers/customer/get/:voucherId` is `optionalAuth` — a stranger can
 * call it. It used to answer with `version.images` exactly as stored, and a
 * stored image carries `storage`: Cloudinary's `publicId`, or the S3 `bucket`
 * and `key`. That is the map of where every file lives and what it is called.
 *
 * The list row next door had whitelisted from the day it was written. Only the
 * detail screen had not — which is the shape of every leak in this codebase so
 * far: two endpoints reading one document, one of them remembering the rule.
 */

/** A stored image, with everything the model really holds. */
const storedImage = (sortOrder) => ({
  _id: `img${sortOrder}`,
  url: `https://cdn.example.com/${sortOrder}.webp`,
  sortOrder,
  storage: {
    provider: "AWS_S3",
    publicId: null,
    bucket: "trydood-nonprod-public",
    key: `dev/images/vouchers/v1/${sortOrder}.webp`,
  },
});

const storedOffer = (over = {}) => ({
  _id: "offer1",
  title: "20% off",
  minBillAmount: 500,
  discountType: "PERCENTAGE",
  discountValue: 20,
  maxDiscountAmount: 200,
  usageType: "MULTIPLE",
  discountApplicableOn: "SUBTOTAL",
  sortOrder: 1,
  isActive: true,
  isDeleted: false,
  ...over,
});

const detail = (over = {}) =>
  mapCustomerVoucherDetail({
    voucherId: "v1",
    name: "Lunch deal",
    version: {
      _id: "ver1",
      versionNumber: 3,
      description: "d",
      images: [storedImage(1), storedImage(2)],
      offers: [storedOffer()],
      startAt: new Date("2026-01-01"),
      endAt: new Date("2026-12-31"),
      ...over,
    },
    outlets: [],
  });

/** Every leaf value in an object tree, however deep. */
const leaves = (value) => {
  if (value === null || typeof value !== "object") return [String(value)];
  return Object.values(value).flatMap(leaves);
};

describe("🔴 storage internals never reach a customer", () => {
  test("the detail screen does not ship bucket, key or publicId", () => {
    const body = detail();
    const all = leaves(body).join(" ");

    expect(all).not.toMatch(/trydood-nonprod-public/);
    expect(all).not.toMatch(/dev\/images\/vouchers/);
    expect(JSON.stringify(body)).not.toMatch(/"storage"/);
  });

  test("an image keeps exactly the three fields the app renders", () => {
    expect(detail().version.images).toEqual([
      { _id: "img1", url: "https://cdn.example.com/1.webp", sortOrder: 1 },
      { _id: "img2", url: "https://cdn.example.com/2.webp", sortOrder: 2 },
    ]);
  });

  test("the list row and the detail agree on an image's shape", () => {
    // They read one document through two screens. The bug was that only one of
    // them whitelisted, so this is the assertion that keeps them together.
    const row = mapCustomerVoucherListItem({
      voucherId: "v1",
      name: "Lunch deal",
      version: {
        _id: "ver1",
        versionNumber: 3,
        images: [storedImage(1)],
        offers: [storedOffer()],
      },
    });

    expect(Object.keys(row.version.images[0]).sort()).toEqual(
      Object.keys(detail().version.images[0]).sort(),
    );
  });

  test("⚠️ the pipeline drops storage before it ever leaves Mongo", () => {
    // Defence in depth, and the reason the mappers above have little to do:
    // both pipelines rewrite `version.images` right after the unwind.
    const stageOf = (pipeline) =>
      pipeline.find((stage) => stage.$addFields?.["version.images"]);

    const geo = { latitude: 22.7, longitude: 75.8, maxDistance: 5000 };

    for (const pipeline of [
      buildCustomerVoucherPipeline({ ...geo, query: {} }),
      buildCustomerVoucherDetailPipeline({
        ...geo,
        voucherId: new mongoose.Types.ObjectId(),
        outletId: null,
      }),
    ]) {
      const projected = stageOf(pipeline)?.$addFields["version.images"].$map.in;
      expect(Object.keys(projected).sort()).toEqual(["_id", "sortOrder", "url"]);
    }
  });
});

describe("offers the customer can actually claim", () => {
  test("`_id` survives — it is what a claim is placed against", () => {
    // `createVoucherClaimOrder` takes an `offerId`. Dropping it while tidying
    // the payload would leave the app unable to claim anything.
    expect(detail().version.offers[0]._id).toBe("offer1");
  });

  test("🔴 a deleted offer is gone, not merely marked", () => {
    const body = detail({
      offers: [storedOffer({ _id: "gone", isDeleted: true }), storedOffer()],
    });
    expect(body.version.offers.map((o) => o._id)).toEqual(["offer1"]);
  });

  test("🔴 a switched-off offer is gone too", () => {
    // `buildClaimPreview` requires `isActive !== false`, so showing one means
    // the customer reads a price and is refused at payment.
    const body = detail({
      offers: [storedOffer({ _id: "off", isActive: false }), storedOffer()],
    });
    expect(body.version.offers.map((o) => o._id)).toEqual(["offer1"]);
  });

  test("the vendor's own switches are not in the payload", () => {
    expect(Object.keys(detail().version.offers[0]).sort()).toEqual([
      "_id",
      "discountApplicableOn",
      "discountType",
      "discountValue",
      "maxDiscountAmount",
      "minBillAmount",
      "title",
      "usageType",
    ]);
  });

  test("offers come back in the vendor's order", () => {
    const body = detail({
      offers: [
        storedOffer({ _id: "b", sortOrder: 2 }),
        storedOffer({ _id: "a", sortOrder: 1 }),
      ],
    });
    expect(body.version.offers.map((o) => o._id)).toEqual(["a", "b"]);
  });

  test("no claimable offer is an empty list, not a crash", () => {
    expect(detail({ offers: [storedOffer({ isDeleted: true })] }).version.offers)
      .toEqual([]);
    expect(detail({ offers: undefined }).version.offers).toEqual([]);
  });
});

describe("nothing else moved", () => {
  test("the rest of the detail payload is unchanged", () => {
    const body = detail();
    expect(body.voucherId).toBe("v1");
    expect(body.name).toBe("Lunch deal");
    expect(body.version.id).toBe("ver1");
    expect(body.version.versionNumber).toBe(3);
    expect(body.version.description).toBe("d");
    expect(body.outletCount).toBe(0);
  });

  test("a voucher with no version is still null, not a throw", () => {
    expect(mapCustomerVoucherDetail({ voucherId: "v1" }).version).toBeNull();
    expect(mapCustomerVoucherDetail(null)).toBeNull();
  });
});
