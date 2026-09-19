/**
 * What the API says when something goes wrong underneath it.
 *
 * Three of these branches exist because the raw error was being handed straight
 * to a vendor: a `VersionError` read as a crashed server, an `E11000` named an
 * index nobody has heard of, and a `WriteConflict` said *"yielding is disabled"*
 * to somebody who had merely double-clicked. Each one turned a working guarantee
 * into what looked like a bug.
 */

const { errorHandler } = require("../../middlewares/errorHandler");
const { CustomError } = require("../../utils");

/** The two express objects the handler actually touches. */
const run = (err) => {
  const res = {
    headersSent: false,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  errorHandler(err, {}, res, next);
  return { res, next };
};

const mongoError = (overrides) =>
  Object.assign(new Error("some mongo failure"), {
    name: "MongoServerError",
    ...overrides,
  });

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("🔴 a write conflict is a 409, not a 500", () => {
  /**
   * Mongo raises this when two transactions write the same document at the same
   * instant, and labels it `TransientTransactionError` — its own way of saying
   * the request was not wrong, just unlucky.
   *
   * ⚠️ Found by a mutation on voucher delete (V-6): two deletes fired together,
   * and the losing one came back as
   * `"Write conflict during plan execution and yielding is disabled"` with a
   * 500. Every transactional service in this codebase can reach it.
   */
  it("maps code 112 to 409", () => {
    const { res } = run(
      mongoError({
        code: 112,
        codeName: "WriteConflict",
        errorLabels: ["TransientTransactionError"],
      }),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("says nothing was saved, and to try again", () => {
    const { res } = run(mongoError({ code: 112, codeName: "WriteConflict" }));

    // The two things the caller needs: their data is not half-written, and the
    // action is worth repeating.
    expect(res.body.message).toMatch(/Nothing was saved/i);
    expect(res.body.message).toMatch(/try again/i);
  });

  it("never leaks the storage-engine wording", () => {
    const { res } = run(
      mongoError({
        code: 112,
        codeName: "WriteConflict",
        message:
          "Caused by :: Write conflict during plan execution and yielding is disabled.",
      }),
    );

    expect(res.body.message).not.toMatch(/yielding|plan execution|WriteConflict/i);
  });

  /**
   * The label rather than the bare code, because Mongo uses it for the whole
   * retriable family — a conflict that arrives with a different code is the same
   * situation for the caller.
   */
  it("catches a transient transaction error that carries no 112", () => {
    const { res } = run(
      mongoError({ errorLabels: ["TransientTransactionError"] }),
    );

    expect(res.statusCode).toBe(409);
  });

  it("leaves an ordinary mongo error alone", () => {
    const { res } = run(mongoError({ code: 2, codeName: "BadValue" }));

    // Only the retriable family is rewritten; everything else keeps its own
    // handling, or this branch would swallow real failures.
    expect(res.statusCode).toBe(500);
  });
});

describe("the branches that were already there", () => {
  it("turns a VersionError into a 409 that says to reload", () => {
    const { res } = run(Object.assign(new Error("No matching document"), {
      name: "VersionError",
    }));

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/Reload/i);
  });

  it("turns a duplicate key into a 422 naming the field", () => {
    const { res } = run(
      mongoError({ code: 11000, keyValue: { email: "a@b.com" } }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body.message).toContain("a@b.com");
    expect(res.body.message).toContain("email");
  });

  it("passes a CustomError through with its own status and payload", () => {
    const { res } = run(new CustomError(409, "Too many claims", { live: 2 }));

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Too many claims");
    /**
     * ⚠️ `details`, not `data`. An error response and a success response use
     * different keys on purpose — a client that reads `data` on every reply
     * would otherwise get a refusal's payload where it expects a result.
     *
     * The V-6 delete docs and its Postman example both said `data` and were
     * wrong; this test is what caught it.
     */
    expect(res.body.details).toEqual({ live: 2 });
    expect(res.body.data).toBeUndefined();
  });

  it("leaves the key out entirely when there is no payload", () => {
    const { res } = run(new CustomError(404, "Voucher not found."));

    // Not `details: null` — a key that is always present but usually empty is a
    // key every client has to check.
    expect("details" in res.body).toBe(false);
  });

  it("takes the first message off a mongoose ValidationError", () => {
    const { res } = run(
      Object.assign(new Error("validation failed"), {
        name: "ValidationError",
        errors: { name: { message: "Name is required." } },
      }),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body.message).toBe("Name is required.");
  });

  /**
   * ⚠️ Once a response has started there is nothing useful left to say — writing
   * a second one throws `ERR_HTTP_HEADERS_SENT` and buries the original error.
   */
  it("hands a half-sent response to express instead of writing again", () => {
    const res = { headersSent: true };
    const next = jest.fn();
    const err = new Error("late failure");

    errorHandler(err, {}, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
