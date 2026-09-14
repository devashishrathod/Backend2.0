/**
 * How a document link actually resolves — the half that had no test.
 *
 * ### 🔴 What this replaces
 *
 * A rendered invoice went to a **public** Cloudinary folder under a `public_id`
 * built from `document_<Date.now()>_<Math.random()*10000>`, and that URL was
 * cached on the record and handed back for ever. Three things at once:
 *
 *   - the URL was public — whoever had it had the document, and `documentToken`
 *     never came into it
 *   - it was permanent — `regenerateInvoice`'s own comment said "the raw storage
 *     URL above cannot be revoked", and it returned that URL to the caller
 *   - it was guessable — `Math.random()` is not a secret, and `CLAUDE.md` says
 *     so in as many words
 *
 * Those documents carry a customer's name, address, GSTIN and what they paid.
 *
 * Now the record remembers a **key**, and the link is minted per request from
 * the private bucket with a short expiry. A forwarded WhatsApp message stops
 * being a permanent key to somebody's tax details.
 *
 * ⚠️ Presigning is **offline** — HMAC over the request, no call to AWS — so the
 * real provider runs here with example credentials. Only the render-and-upload
 * step is a seam, because that one really would write a file.
 */

const UPLOADED_KEY = "dev/documents/26-27/VCH/TD-VCH-26-27-000001.pdf";

jest.mock("../../helpers/documents", () => {
  const actual = jest.requireActual("../../helpers/documents");
  return {
    ...actual,
    generateAndUploadDocument: jest.fn(async () => ({
      url: null,
      storage: {
        provider: "AWS_S3",
        publicId: null,
        bucket: "trydood-nonprod-private",
        key: UPLOADED_KEY,
      },
    })),
  };
});

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { getDocumentByToken } = require("../../services/documents");
const { generateAndUploadDocument } = require("../../helpers/documents");
const { buildDocumentKey } = require("../../services/storage/keys");

const oid = () => new mongoose.Types.ObjectId();
const token = () => require("crypto").randomBytes(32).toString("hex");

/**
 * ⚠️ Example credentials from the AWS docs. Signing is local, so these produce a
 * real, well-formed URL without a real account — and they cannot reach anything.
 */
beforeAll(async () => {
  process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
  process.env.AWS_SECRET_ACCESS_KEY =
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  await connectTestDb();
});
afterAll(disconnectTestDb);

let seq = 0;
const snapshot = (documentNumber) => ({
  kind: "VOUCHER_CLAIM",
  title: "Receipt",
  documentNumber,
});

const seedTransaction = (overrides = {}) => {
  seq += 1;
  return Transaction.create({
    brandId: oid(),
    userId: oid(),
    amount: 100,
    gateway: "MANUAL",
    // Both required by the schema, and `buildTransactionFilter` reads `purpose`
    // — a row without them is not one this resolver would ever see.
    gatewayAccount: "CUSTOMER",
    purpose: "VOUCHER_CLAIM",
    verified: true,
    documentToken: token(),
    invoiceId: `TD/VCH/26-27/${String(seq).padStart(6, "0")}`,
    invoiceSnapshot: snapshot(`TD/VCH/26-27/${String(seq).padStart(6, "0")}`),
    ...overrides,
  });
};

beforeEach(async () => {
  await clearCollections(Transaction, RefundRequest);
  jest.clearAllMocks();
});

describe("the key a document lands on", () => {
  test("comes from the document number, not a random name", () => {
    // The number is already unique, already allotted from an atomic counter and
    // already printed on the paper — so an object can be matched to a document
    // by eye, and re-issuing the same number cannot scatter files.
    expect(buildDocumentKey("TD/VCH/26-27/000001")).toBe(
      "dev/documents/26-27/VCH/TD-VCH-26-27-000001.pdf",
    );
  });

  test("year and series are their own segments", () => {
    // So a lifecycle rule or a person browsing can reach one series or one
    // financial year without scanning the whole prefix.
    const key = buildDocumentKey("TD/SUB/25-26/012345");
    expect(key).toContain("/25-26/SUB/");
  });

  test("🔴 anything that is not a document number is refused", () => {
    // A key is where a customer's tax details end up. Guessing one from a
    // malformed string is not a recovery, it is a misfile.
    for (const bad of ["garbage", "", null, "TD/VCH/26-27", "../../etc/passwd"]) {
      expect(() => buildDocumentKey(bad)).toThrow(/Not a document number/);
    }
  });
});

describe("a document that already has a file", () => {
  const withStorage = () =>
    seedTransaction({
      documentStorage: {
        provider: "AWS_S3",
        bucket: "trydood-nonprod-private",
        key: UPLOADED_KEY,
      },
    });

  test("🔴 the link is minted fresh, never the same string twice", async () => {
    const txn = await withStorage();

    const first = await getDocumentByToken(txn.documentToken);
    const second = await getDocumentByToken(txn.documentToken);

    // Different signatures — a stored URL would be identical, and a stored URL
    // is exactly what outlived the permission behind it.
    expect(first.url).not.toBe(second.url);
    expect(generateAndUploadDocument).not.toHaveBeenCalled();
  });

  test("🔴 the link expires — it is not a permanent key", async () => {
    const txn = await withStorage();

    const { url } = await getDocumentByToken(txn.documentToken);
    const params = new URL(url).searchParams;

    expect(params.get("X-Amz-Expires")).toBe("300");
    expect(params.get("X-Amz-Signature")).toBeTruthy();
  });

  test("it points at the private bucket and the document's own key", async () => {
    const txn = await withStorage();

    const { url } = await getDocumentByToken(txn.documentToken);

    expect(url).toContain("trydood-nonprod-private");
    expect(decodeURIComponent(new URL(url).pathname)).toContain(UPLOADED_KEY);
  });

  test("the document number and kind still come back", async () => {
    const txn = await withStorage();

    const result = await getDocumentByToken(txn.documentToken);

    expect(result.documentNumber).toBe(txn.invoiceSnapshot.documentNumber);
    expect(result.kind).toBe("VOUCHER_CLAIM");
  });
});

describe("rows written before any of this", () => {
  test("⚠️ a cached Cloudinary URL still works", async () => {
    // Nothing is migrated. The file is where it is, and that link is the only
    // way back to it — so the old path has to keep answering.
    const legacy = "https://res.cloudinary.com/x/image/upload/v1/Documents/a.pdf";
    const txn = await seedTransaction({ invoiceUrl: legacy });

    const { url } = await getDocumentByToken(txn.documentToken);

    expect(url).toBe(legacy);
    expect(generateAndUploadDocument).not.toHaveBeenCalled();
  });

  test("storage wins over a stale cached URL", async () => {
    // A row that has both is one that was re-issued: the key is current, the
    // URL is whatever it used to be.
    const txn = await seedTransaction({
      invoiceUrl: "https://res.cloudinary.com/x/image/upload/v1/Documents/old.pdf",
      documentStorage: {
        provider: "AWS_S3",
        bucket: "trydood-nonprod-private",
        key: UPLOADED_KEY,
      },
    });

    const { url } = await getDocumentByToken(txn.documentToken);

    expect(url).not.toContain("cloudinary");
    expect(url).toContain("X-Amz-Signature");
  });
});

describe("the first time anybody asks", () => {
  test("renders, uploads, and remembers the key", async () => {
    const txn = await seedTransaction();

    const { url } = await getDocumentByToken(txn.documentToken);

    expect(generateAndUploadDocument).toHaveBeenCalledTimes(1);
    const saved = await Transaction.findById(txn._id);
    expect(saved.documentStorage.key).toBe(UPLOADED_KEY);
    expect(url).toContain("X-Amz-Signature");
  });

  test("🔴 no URL is stored for a private object", async () => {
    // There is no lasting URL to store. Writing one would put the old problem
    // straight back: a link that outlives the permission behind it.
    const txn = await seedTransaction();

    await getDocumentByToken(txn.documentToken);

    const saved = await Transaction.findById(txn._id);
    expect(saved.invoiceUrl).toBeFalsy();
  });

  test("a second request does not render again", async () => {
    const txn = await seedTransaction();

    await getDocumentByToken(txn.documentToken);
    await getDocumentByToken(txn.documentToken);

    expect(generateAndUploadDocument).toHaveBeenCalledTimes(1);
  });

  test("an upload that produces nothing is a 503, not a broken link", async () => {
    generateAndUploadDocument.mockResolvedValueOnce(null);
    const txn = await seedTransaction();

    await expect(getDocumentByToken(txn.documentToken)).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});

describe("tokens that should not resolve", () => {
  test("an unknown token is a 404", async () => {
    await expect(getDocumentByToken(token())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("no token at all is the same 404", async () => {
    // Deliberately identical. Telling the holder of a bad token that it almost
    // worked is how a guessing attempt learns it is close.
    await expect(getDocumentByToken("")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test("a record with no document number is a 409, not a guess", async () => {
    const txn = await seedTransaction({ invoiceSnapshot: { kind: "VOUCHER_CLAIM" } });

    await expect(getDocumentByToken(txn.documentToken)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
