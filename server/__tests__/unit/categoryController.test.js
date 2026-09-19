/**
 * U-2 — what the category controllers hand the service.
 *
 * ### 🔴 Why this is worth its own file
 *
 * The services are covered against a real bucket in `money/categoryUpload`,
 * and every one of those tests builds its own actor. So the one thing they
 * cannot check is the thing an HTTP client depends on: that the **controller**
 * puts `req.userId` into it.
 *
 * Get that wrong and nothing fails anywhere. The service tests stay green, the
 * multipart road stays green — because it never looks at the actor — and the
 * presigned road answers `404 That upload was not found` to every real client,
 * for every upload they ever make, because the facade looks the intent up by id
 * **and** owner.
 *
 * No database and no network: the service is a spy, and what it was called with
 * is the whole question.
 */

jest.mock("../../services/categories", () => ({
  createCategory: jest.fn(async () => ({ _id: "cat-1" })),
  updateCategoryById: jest.fn(async () => ({ _id: "cat-1" })),
}));

const {
  createCategory,
  updateCategoryById,
} = require("../../services/categories");
const {
  createCategory: createController,
} = require("../../controllers/categories/createCategory");
const {
  updateCategory: updateController,
} = require("../../controllers/categories/updateCategory");

const ADMIN_ID = "6710000000000000000000aa";

const res = () => {
  const sent = {};
  return {
    sent,
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
  };
};

/** Run a controller the way `asyncWrapper` does, and surface what it threw. */
const call = async (controller, req) => {
  const response = res();
  let thrown = null;
  await controller(req, response, (error) => {
    thrown = error;
  });
  return { ...response.sent, thrown };
};

const image = () => ({
  name: "pic.png",
  tempFilePath: "/does/not/matter/pic.png",
  mimetype: "image/png",
});

beforeEach(() => jest.clearAllMocks());

describe("🔴 the actor reaches the service", () => {
  it("create sends who is asking, not just the body", async () => {
    await call(createController, {
      userId: ADMIN_ID,
      role: "ADMIN",
      body: { name: "Coffee shops", uploadId: "6710000000000000000000bb" },
    });

    const [actor, payload, file] = createCategory.mock.calls[0];
    expect(actor).toEqual({ userId: ADMIN_ID, role: "ADMIN" });
    expect(payload.uploadId).toBe("6710000000000000000000bb");
    expect(file).toBeUndefined();
  });

  it("update sends who is asking, the id and the body", async () => {
    await call(updateController, {
      userId: ADMIN_ID,
      role: "ADMIN",
      params: { id: "cat-1" },
      body: { uploadId: "6710000000000000000000bb" },
    });

    const [actor, id, payload] = updateCategoryById.mock.calls[0];
    expect(actor).toEqual({ userId: ADMIN_ID, role: "ADMIN" });
    expect(id).toBe("cat-1");
    expect(payload.uploadId).toBe("6710000000000000000000bb");
  });
});

describe("the multipart road still reaches the service", () => {
  it("create passes the attached file", async () => {
    await call(createController, {
      userId: ADMIN_ID,
      role: "ADMIN",
      body: { name: "Coffee shops" },
      files: { image: image() },
    });

    const [, , file] = createCategory.mock.calls[0];
    expect(file.mimetype).toBe("image/png");
  });

  it("update passes the attached file", async () => {
    await call(updateController, {
      userId: ADMIN_ID,
      role: "ADMIN",
      params: { id: "cat-1" },
      body: {},
      files: { image: image() },
    });

    const [, , , file] = updateCategoryById.mock.calls[0];
    expect(file.mimetype).toBe("image/png");
  });
});

/**
 * ⚠️ The validator runs **before** the service, so a malformed uploadId never
 * becomes a database lookup — and never becomes a 404 that reads as if the
 * upload had expired.
 */
describe("a malformed uploadId stops at the controller", () => {
  it.each([
    ["create", () => createController, () => createCategory, {
      body: { name: "Coffee shops", uploadId: "nope" },
    }],
    ["update", () => updateController, () => updateCategoryById, {
      params: { id: "cat-1" },
      body: { uploadId: "nope" },
    }],
  ])("on %s", async (_label, controller, service, req) => {
    const { thrown } = await call(controller(), {
      userId: ADMIN_ID,
      role: "ADMIN",
      ...req,
    });

    expect(thrown.statusCode).toBe(422);
    expect(thrown.message).toContain("Invalid uploadId.");
    expect(service()).not.toHaveBeenCalled();
  });
});
