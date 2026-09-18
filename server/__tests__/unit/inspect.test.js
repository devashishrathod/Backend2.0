const { identify, readDimensions } = require("../../services/storage/inspect");

/**
 * The only check in the upload path a caller cannot write.
 *
 * 🔴 Every other one reads `file.mimetype`, and `express-fileupload` takes that
 * straight from the multipart part's `Content-Type` header — a string the
 * client chose. So one edited header walks past every allow-list in the app.
 * Cloudinary catches it today by refusing a non-image under
 * `resource_type: "image"`; that is the provider's accident, and S3 has no such
 * opinion — it stores what it is given.
 */

/** Real headers, byte for byte — not hand-waved buffers. */
const FILES = {
  png: Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000070000000b0806000000",
    "hex",
  ),
  // "GIF89a" (6 bytes), then the logical screen descriptor: 10 × 20,
  // little-endian, immediately after — no padding between.
  gif: Buffer.from("474946383961" + "0a00" + "1400" + "80000000", "hex"),
  // SOI, JFIF APP0, a DQT, then SOF0 carrying 45 × 75.
  jpeg: Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300" +
      "01".repeat(64) +
      "ffc0001108002d004b03",
    "hex",
  ),
  webpLossless: Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8L"),
    Buffer.alloc(4),
    Buffer.from([0x2f]),
    Buffer.alloc(8),
  ]),
  mp4: Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(16)]),
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]),
  pdf: Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"),
};

describe("what a file actually is", () => {
  test.each([
    ["png", "IMAGE", "image/png"],
    ["jpeg", "IMAGE", "image/jpeg"],
    ["webpLossless", "IMAGE", "image/webp"],
    ["mp4", "VIDEO", "video/mp4"],
    ["webm", "VIDEO", "video/webm"],
    ["pdf", "DOCUMENT", "application/pdf"],
  ])("%s is read as %s", (file, kind, mime) => {
    expect(identify(FILES[file])).toMatchObject({ kind, mime });
  });

  test("🔴 a GIF is its own kind, not an image", () => {
    // So it lands under `gifs/` and never meets the resize Lambda, which would
    // flatten the animation. Every other check in the app calls it an image.
    expect(identify(FILES.gif)).toMatchObject({
      kind: "GIF",
      mime: "image/gif",
    });
  });

  test("🔴 the client's claimed type is irrelevant — only the bytes are read", () => {
    // This is the whole point. An MP4 announced as image/png is still an MP4.
    expect(identify(FILES.mp4).kind).toBe("VIDEO");
    expect(identify(FILES.png).kind).toBe("IMAGE");
  });

  test("WebP and WAV both start with RIFF, and are not confused", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WAVEfmt "),
      Buffer.alloc(16),
    ]);
    expect(identify(wav)).toBeNull();
    expect(identify(FILES.webpLossless).mime).toBe("image/webp");
  });
});

describe("what is refused by name", () => {
  test("🔴 SVG — it is XML that can carry a script", () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const result = identify(svg);

    expect(result.refused).toBe(true);
    // Named, not merely "unrecognised": the caller's assumption is that an SVG
    // is an image, and that is the thing worth correcting.
    expect(result.name).toBe("SVG");
    expect(result.reason).toMatch(/scripts/);
  });

  test("an SVG hiding behind an XML declaration is still refused", () => {
    expect(identify(Buffer.from('<?xml version="1.0"?><svg/>'))).toMatchObject({
      refused: true,
      name: "SVG",
    });
  });

  test("leading whitespace does not get one past", () => {
    expect(identify(Buffer.from("\n\n   <svg />"))).toMatchObject({
      refused: true,
    });
  });

  test("HTML is refused too", () => {
    expect(identify(Buffer.from("<!DOCTYPE html><html></html>"))).toMatchObject({
      refused: true,
      name: "HTML",
    });
  });
});

describe("things that are simply not accepted", () => {
  test.each([
    ["a ZIP", Buffer.from("504b0304140000000800", "hex")],
    ["an ELF binary", Buffer.from("7f454c4602010100", "hex")],
    ["plain text", Buffer.from("hello there, this is not a picture")],
    ["empty", Buffer.alloc(0)],
    ["two bytes", Buffer.from([0x01, 0x02])],
  ])("%s is null, not a guess", (_label, buf) => {
    expect(identify(buf)).toBeNull();
  });

  test("a non-buffer is null rather than a crash", () => {
    expect(identify(null)).toBeNull();
    expect(identify("89504e47")).toBeNull();
  });
});

describe("dimensions, from the same bytes", () => {
  test.each([
    ["png", 7, 11],
    ["gif", 10, 20],
    ["jpeg", 75, 45],
  ])("%s reports %i × %i", (file, width, height) => {
    const { name } = identify(FILES[file]);
    expect(readDimensions(FILES[file], name)).toEqual({ width, height });
  });

  test("WebP lossless packs both into one little-endian word", () => {
    const { name } = identify(FILES.webpLossless);
    expect(readDimensions(FILES.webpLossless, name)).toEqual({
      width: 1,
      height: 1,
    });
  });

  test("⚠️ a JPEG whose SOF sits past the buffer is null, not a wrong number", () => {
    // A camera with a large EXIF block pushes the frame header past the first
    // kilobyte. Reading whatever lands at that offset would produce a plausible
    // size that is simply false — a layout that breaks quietly.
    const bigExif = Buffer.concat([
      Buffer.from("ffd8ffe1", "hex"),
      Buffer.from([0xff, 0xfe]), // a segment longer than what follows
      Buffer.alloc(40),
    ]);
    expect(readDimensions(bigExif, "JPEG")).toBeNull();
  });

  test("a truncated header is null rather than a throw", () => {
    expect(readDimensions(Buffer.from("89504e470d0a1a0a", "hex"), "PNG")).toBeNull();
    expect(readDimensions(Buffer.alloc(3), "GIF")).toBeNull();
  });

  test("a video has no dimensions here — that is the Lambda's job", () => {
    expect(readDimensions(FILES.mp4, "MP4/MOV")).toBeNull();
  });
});
