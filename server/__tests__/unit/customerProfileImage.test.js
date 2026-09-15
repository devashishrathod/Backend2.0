const Customer = require("../../models/Customer");
const User = require("../../models/User");
const { mediaSchema } = require("../../models/mediaSchema");
const { MEDIA_KIND } = require("../../constants/storage");

/**
 * Where a customer's photo lives, and why it is only one place.
 *
 * 🔴 Both rows used to hold it. The upload wrote `User.image`, and the sync block
 * below it copied the value onto `Customer.image`. Two writers for one field is
 * exactly how the email address came to disagree between the two — a mistake
 * that file already carries a warning about — and there was no reason for the
 * picture to repeat it.
 *
 * A vendor has no `Customer` row, so for every other role `User` stays the home.
 */

describe("the Customer row can hold a real media object", () => {
  test("`imageMedia` is there, and it is the shared shape", () => {
    const path = Customer.schema.path("imageMedia");

    expect(path).toBeTruthy();
    expect(Object.keys(path.schema.paths).sort()).toEqual(
      Object.keys(mediaSchema.paths).sort(),
    );
  });

  test("⚠️ absent by default, never an empty object", () => {
    // `{}` reads as `provider: undefined`, which the storage facade refuses
    // outright. Absent means "no photo"; `{}` means "written by something
    // broken".
    const customer = new Customer({ userId: "6aa8024659d2e7987c03a1c5" });
    expect(customer.imageMedia).toBeUndefined();
  });

  test("the URL field stays a plain string beside it", () => {
    // 55 read sites project `image` and expect a string. The rich object is a
    // sibling, exactly as it is on Brand, Category and the rest.
    expect(Customer.schema.path("image").instance).toBe("String");
  });

  test("a full media object validates on it", () => {
    const customer = new Customer({
      userId: "6aa8024659d2e7987c03a1c5",
      image: "https://cdn.example.com/a.webp",
      imageMedia: {
        url: "https://cdn.example.com/a.webp",
        kind: MEDIA_KIND.IMAGE,
        mimeType: "image/webp",
        storage: { provider: "AWS_S3", bucket: "b", key: "k" },
      },
    });

    expect(customer.validateSync()?.errors?.imageMedia).toBeUndefined();
  });
});

describe("🔴 one field, one writer", () => {
  /**
   * `updateUserById` with its collaborators mocked, so this asserts what the
   * service **does** rather than what its source looks like.
   */
  const runUpdate = async ({ role, userImage, customerImage } = {}) => {
    const deleted = [];
    const user = {
      _id: "u1",
      role,
      isDeleted: false,
      image: userImage,
      imageMedia: userImage ? { url: userImage, storage: { key: "user-old" } } : undefined,
      dob: null,
      name: "Old Name",
      save: jest.fn(async () => {}),
      toObject: () => ({ _id: "u1", role }),
    };
    const customer = {
      _id: "c1",
      userId: "u1",
      isDeleted: false,
      image: customerImage,
      imageMedia: customerImage
        ? { url: customerImage, storage: { key: "customer-old" } }
        : undefined,
      save: jest.fn(async () => {}),
    };

    let updateUserById;
    jest.isolateModules(() => {
      jest.doMock("../../models/User", () => ({
        findById: async () => user,
        findOne: async () => null,
      }));
      jest.doMock("../../models/Customer", () => ({
        findOne: async () => customer,
        findById: async () => customer,
      }));
      jest.doMock("../../services/storage", () => ({
        uploadFromPath: async () => ({
          url: "https://cdn.example.com/new.webp",
          storage: { provider: "AWS_S3", bucket: "b", key: "k" },
          metadata: { mimeType: "image/webp", size: 10 },
        }),
        deleteAsset: jest.fn(async (asset) => {
          deleted.push(asset);
          return true;
        }),
      }));
      jest.doMock("../../helpers/users", () => ({
        applyIdentityChange: async () => {},
      }));
      ({ updateUserById } = require("../../services/users/updateUserById"));
    });

    await updateUserById("u1", {}, {
      tempFilePath: "/tmp/x.webp",
      mimetype: "image/webp",
      name: "x.webp",
    });

    return { user, customer, deleted };
  };

  afterEach(() => jest.resetModules());

  test("a customer's photo lands on the Customer row", async () => {
    const { customer } = await runUpdate({ role: "CUSTOMER" });

    expect(customer.image).toBe("https://cdn.example.com/new.webp");
    expect(customer.imageMedia).toMatchObject({ kind: "IMAGE" });
  });

  test("🔴 and `User.image` stays empty for them", async () => {
    // The whole point. Two rows holding one picture is how the email address
    // came to disagree between them.
    const { user } = await runUpdate({ role: "CUSTOMER" });

    expect(user.image).toBeUndefined();
    expect(user.imageMedia).toBeUndefined();
  });

  test("⚠️ the photo it deletes is the one on the row it is replacing", async () => {
    // Both rows can hold an old picture. Reading `previous` off the wrong one
    // deletes a file that is still in use and leaves the real old one paid for
    // and unreferenced — and nothing would say so.
    const { deleted } = await runUpdate({
      role: "CUSTOMER",
      userImage: "https://cdn.example.com/user-old.webp",
      customerImage: "https://cdn.example.com/customer-old.webp",
    });

    expect(deleted).toHaveLength(1);
    expect(deleted[0].storage.key).toBe("customer-old");
  });

  test("and for a vendor it is the User row's own", async () => {
    const { deleted } = await runUpdate({
      role: "VENDOR",
      userImage: "https://cdn.example.com/user-old.webp",
    });

    expect(deleted[0].storage.key).toBe("user-old");
  });

  test("every other role still writes to the User row", async () => {
    // A vendor has no Customer row to put one on.
    const { user, customer } = await runUpdate({ role: "VENDOR" });

    expect(user.image).toBe("https://cdn.example.com/new.webp");
    expect(user.imageMedia).toMatchObject({ kind: "IMAGE" });
    expect(customer.image).toBeUndefined();
  });
});

describe("🔴 referral cards get their photo from the Customer row", () => {
  const { withCustomerImages } = require("../../services/customers/getAdminCustomerDetail");

  const customersAre = (rows) =>
    jest.spyOn(Customer, "find").mockReturnValue({
      lean: async () => rows,
    });

  afterEach(() => jest.restoreAllMocks());

  test("a customer card gets the Customer image, not the empty User one", async () => {
    // `User.select("... image ...")` returns nothing for exactly the people
    // this fraud screen is about.
    customersAre([{ userId: "u1", image: "https://cdn.example.com/c1.webp" }]);
    const cards = [{ _id: "u1", name: "A", image: undefined }];

    await withCustomerImages(cards);

    expect(cards[0].image).toBe("https://cdn.example.com/c1.webp");
  });

  test("⚠️ every card in the list, not just the first", async () => {
    customersAre([
      { userId: "u1", image: "https://cdn.example.com/1.webp" },
      { userId: "u2", image: "https://cdn.example.com/2.webp" },
    ]);
    const cards = [
      { _id: "u1", image: undefined },
      { _id: "u2", image: undefined },
    ];

    await withCustomerImages(cards);

    expect(cards.map((c) => c.image)).toEqual([
      "https://cdn.example.com/1.webp",
      "https://cdn.example.com/2.webp",
    ]);
  });

  test("a vendor in the list keeps whatever User gave it", async () => {
    customersAre([]);
    const cards = [{ _id: "v1", image: "https://cdn.example.com/vendor.webp" }];

    await withCustomerImages(cards);

    expect(cards[0].image).toBe("https://cdn.example.com/vendor.webp");
  });

  test("one query for the whole page, and nulls do not break it", async () => {
    const find = customersAre([]);
    await withCustomerImages([null, { _id: "u1" }, undefined]);

    expect(find).toHaveBeenCalledTimes(1);
  });

  test("an empty list asks Mongo nothing", async () => {
    const find = jest.spyOn(Customer, "find");
    await withCustomerImages([]);
    await withCustomerImages([null]);

    expect(find).not.toHaveBeenCalled();
  });
});

describe("⚠️ and the graph actually calls it", () => {
  /**
   * The helper above is tested on its own; this is the wiring. A mutation that
   * simply deleted the call, or applied it to only the first card, survived
   * every test until this one existed.
   */
  const User = require("../../models/User");
  const {
    referralGraph,
  } = require("../../services/customers/getAdminCustomerDetail");

  const graphOf = async () => {
    jest.spyOn(User, "findOne").mockReturnValue({
      select: () => ({ lean: async () => ({ _id: "ref1", name: "Referrer" }) }),
    });
    jest.spyOn(User, "find").mockReturnValue({
      select: () => ({
        sort: () => ({ limit: () => ({ lean: async () => [{ _id: "u2" }] }) }),
      }),
    });
    jest.spyOn(User, "countDocuments").mockResolvedValue(1);
    jest.spyOn(Customer, "find").mockReturnValue({
      lean: async () => [
        { userId: "ref1", image: "https://cdn.example.com/referrer.webp" },
        { userId: "u2", image: "https://cdn.example.com/referred.webp" },
      ],
    });

    return referralGraph(
      { referralCode: "ABC", appliedReferralCode: "XYZ", referralCount: 1 },
      10,
    );
  };

  afterEach(() => jest.restoreAllMocks());

  test("the referrer's card carries a photo", async () => {
    const graph = await graphOf();
    expect(graph.referredBy.image).toBe("https://cdn.example.com/referrer.webp");
  });

  test("🔴 and so does every referred card, not just the referrer", async () => {
    const graph = await graphOf();
    expect(graph.referred[0].image).toBe("https://cdn.example.com/referred.webp");
  });
});
