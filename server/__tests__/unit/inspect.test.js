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

  /**
   * 🔴 The whole family shares MP4's container, so "starts with ftyp" calls a
   * photo a video. On the four surfaces that accept video that is not a
   * refusal — it is a photo stored under `videos/` as `video/mp4`, which no
   * player opens and nothing logs.
   */
  describe("🔴 HEIC and AVIF — same container as MP4, told apart by the brand", () => {
    const iso = (brand) =>
      Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from("ftyp"),
        Buffer.from(brand),
        Buffer.alloc(32),
      ]);

    test.each([
      ["heic", "HEIC"],
      ["heix", "HEIC"],
      ["hevc", "HEIC"],
      // Some cameras write the generic HEIF brand instead of `heic`.
      ["mif1", "HEIC"],
      ["msf1", "HEIC"],
      ["avif", "AVIF"],
      ["avis", "AVIF"],
    ])("%s is refused by name, not stored as a video", (brand, name) => {
      expect(identify(iso(brand))).toMatchObject({ refused: true, name });
    });

    test.each([["isom"], ["mp42"], ["qt  "], ["3gp4"], ["avc1"]])(
      "%s is still a video — the video brands are not the list being guarded",
      (brand) => {
        expect(identify(iso(brand))).toMatchObject({
          name: "MP4/MOV",
          kind: "VIDEO",
        });
      },
    );

    test("🔴 the reason tells an iPhone owner what to actually do", () => {
      const { reason } = identify(iso("heic"));
      // A refusal a normal customer will meet has to end somewhere other than
      // "no" — the setting that fixes it for good is three taps away.
      expect(reason).toMatch(/JPEG or PNG/);
      expect(reason).toMatch(/Most Compatible/);
    });

    test("the brand is read case-insensitively", () => {
      expect(identify(iso("HEIC"))).toMatchObject({ refused: true });
    });

    test("⚠️ a file too short to hold a brand is not guessed at", () => {
      // "ftyp" present, brand truncated — treated as an ordinary ISO file
      // rather than refused on four bytes that were never read.
      const stub = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp")]);
      expect(identify(stub)).toMatchObject({ name: "MP4/MOV" });
    });
  });

  test("HTML is refused too", () => {
    expect(identify(Buffer.from("<!DOCTYPE html><html></html>"))).toMatchObject({
      refused: true,
      name: "HTML",
    });
  });
});

/**
 * 🔴 The same refusal reached by name, so the presign road can say it **before**
 * the bytes are spent rather than after.
 */
describe("refusalForMime — the presign road's half", () => {
  const { refusalForMime } = require("../../services/storage/inspect");

  test.each([
    ["image/heic", "HEIC"],
    ["image/heif", "HEIC"],
    ["image/avif", "AVIF"],
    ["image/svg+xml", "SVG"],
    ["text/html", "HTML"],
  ])("%s is refused before a signature is minted", (mime, name) => {
    expect(refusalForMime(mime)).toMatchObject({ refused: true, name });
  });

  test.each([["image/jpeg"], ["image/png"], ["image/gif"], ["video/mp4"], ["application/pdf"]])(
    "%s is not refused here",
    (mime) => {
      expect(refusalForMime(mime)).toBeNull();
    },
  );

  test("case and whitespace do not get one past", () => {
    expect(refusalForMime("  IMAGE/HEIC ")).toMatchObject({ name: "HEIC" });
  });

  test.each([[""], [null], [undefined]])("%p is null, not a refusal", (mime) => {
    // No declared type is the surface's problem to answer, not this one's —
    // refusing here would turn a missing field into a wrong explanation.
    expect(refusalForMime(mime)).toBeNull();
  });

  /**
   * 🔴 The two roads must refuse the **same set**, or a file is refused on one
   * and stored on the other — which is the exact class of bug Block G closed.
   */
  test("every by-name refusal has a by-bytes refusal behind it", () => {
    const { REFUSED } = require("../../services/storage/inspect");
    for (const entry of REFUSED) {
      expect(Array.isArray(entry.mimes)).toBe(true);
      expect(entry.mimes.length).toBeGreaterThan(0);
      expect(typeof entry.test).toBe("function");
      // And the words are one string, not two that can drift apart.
      expect(refusalForMime(entry.mimes[0]).reason).toBe(entry.reason);
    }
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

/**
 * 🔴 G2 — the same two answers, read off a file that is already on this disk.
 *
 * `confirm` fetches an uploaded object's head with a ranged GET. The multipart
 * road has the file sitting in `tempFileDir` already, so it costs a local open
 * — and until this existed, that road read nothing at all and trusted the
 * `Content-Type` header the client wrote.
 */
describe("🔴 inspectLocalFile — the multipart road's half", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { inspectLocalFile, HEAD_BYTES } = require("../../services/storage/inspect");

  const written = [];
  const write = (bytes) => {
    const file = path.join(os.tmpdir(), `inspect-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(file, bytes);
    written.push(file);
    return file;
  };

  afterAll(() => written.forEach((f) => fs.rmSync(f, { force: true })));

  test("it reads the same verdict the ranged GET would", () => {
    const { identified } = inspectLocalFile(write(FILES.png));
    expect(identified).toMatchObject({ kind: "IMAGE", mime: "image/png" });
  });

  test("and the dimensions come off the same bytes", () => {
    // 7 × 11 — this file's own PNG fixture, read straight out of its IHDR.
    const { dimensions } = inspectLocalFile(write(FILES.png));
    expect(dimensions).toEqual({ width: 7, height: 11 });
  });

  test("🔴 a refusal keeps its own reason, for the caller to repeat", () => {
    const { identified } = inspectLocalFile(write(FILES.svg ?? Buffer.from("<svg />")));
    expect(identified).toMatchObject({ refused: true, name: "SVG" });
  });

  test("something no signature matches is `null`, not a guess", () => {
    const { identified } = inspectLocalFile(write(Buffer.from("plain text, at length")));
    expect(identified).toBeNull();
  });

  /**
   * ⚠️ A file smaller than the window is normal, not an error — the read just
   * returns fewer bytes and the signature still matches from offset zero.
   */
  test("a file shorter than the read window still identifies", () => {
    expect(HEAD_BYTES).toBeGreaterThan(FILES.gif.length);
    const { identified } = inspectLocalFile(write(FILES.gif));
    expect(identified).toMatchObject({ kind: "GIF" });
  });

  /**
   * 🔴 Our bug, and it has to say so. `useTempFiles` off means every file
   * arrives as a buffer instead, and `openSync(undefined)` answers
   * "ENOENT ... open 'undefined'" — which sends the reader looking for a missing
   * upload rather than a changed middleware option.
   */
  test("🔴 a missing tempFilePath is named as a server-side mistake", () => {
    expect(() => inspectLocalFile(undefined)).toThrow(/useTempFiles/);
    expect(() => inspectLocalFile(undefined)).toThrow(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
