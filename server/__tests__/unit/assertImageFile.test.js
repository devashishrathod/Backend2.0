const { assertImageFile } = require("../../helpers/media");
const { IMAGE_MIME_TYPES } = require("../../constants/storage");

/**
 * The check six upload paths never had, and the one the voucher gallery had
 * wrong.
 */
describe("assertImageFile", () => {
  test.each(IMAGE_MIME_TYPES)("accepts %s", (mimetype) => {
    expect(() => assertImageFile({ mimetype }, "Logo")).not.toThrow();
  });

  test("🔴 refuses SVG", () => {
    // `startsWith("image/")` let this through, and an SVG is an XML document
    // that can carry a <script>. Cross-origin hosting is what makes it harmless
    // today; that stops being true on our own CDN.
    expect(() => assertImageFile({ mimetype: "image/svg+xml" })).toThrow(
      /must be an image/,
    );
  });

  test("refuses a PDF, and says so instead of failing at the provider", () => {
    try {
      assertImageFile({ mimetype: "application/pdf" }, "Logo");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.statusCode).toBe(422);
      // The whole point: the old answer was a 500 that never mentioned the file.
      expect(error.message).toMatch(/^Logo must be an image/);
      expect(error.message).toContain("application/pdf");
    }
  });

  test("refuses a video, and a file with no content type at all", () => {
    expect(() => assertImageFile({ mimetype: "video/mp4" })).toThrow(/image/);
    expect(() => assertImageFile({ mimetype: "" })).toThrow(
      /no content type/,
    );
  });

  test("case does not matter", () => {
    expect(() => assertImageFile({ mimetype: "IMAGE/PNG" })).not.toThrow();
  });

  test("no file is not an error — the field is optional on most surfaces", () => {
    // Whether a file is *required* is the caller's rule, not this one's.
    expect(() => assertImageFile(undefined)).not.toThrow();
    expect(() => assertImageFile(null)).not.toThrow();
  });

  test("reads `mimeType` too, which is what some callers carry", () => {
    expect(() => assertImageFile({ mimeType: "image/png" })).not.toThrow();
    expect(() => assertImageFile({ mimeType: "image/svg+xml" })).toThrow();
  });
});
