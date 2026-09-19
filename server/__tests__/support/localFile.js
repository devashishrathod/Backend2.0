const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * A real file on disk, shaped like `express-fileupload` hands one over.
 *
 * ### 🔴 Why the fake path stopped working
 *
 * Until G2 the multipart road never opened the file — it read `file.mimetype`,
 * which is a header the client writes — so a test could pass
 * `{ name: "x.png", mimetype: "image/png", tempFilePath: "/does/not/matter" }`
 * and exercise the whole surface. That was exactly the hole: the tests agreed
 * with the code that the bytes did not matter.
 *
 * Now both roads read the first kilobyte, so a test file has to **be** what it
 * says it is. That is the point, not an inconvenience: a suite built on fake
 * paths could never have caught an MP4 renamed `.png`.
 *
 * ### ⚠️ Every caller must clean up
 *
 * `cleanup()` removes the whole directory. Call it in `afterAll`, not
 * `afterEach` — several tests reuse one file and removing it under them fails
 * in a way that looks like a storage bug.
 */

/**
 * The smallest byte sequence that each signature check recognises.
 *
 * ⚠️ These are heads, not valid files. Nothing here decodes an image — the
 * point is the first bytes, and padding them to a kilobyte is what a real file
 * would have anyway.
 */
const BYTES = Object.freeze({
  png: Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    // IHDR: length, "IHDR", then 45 × 75 so a dimension assertion has something
    // real to read rather than a zero that could also mean "not parsed".
    Buffer.from("0000000d49484452", "hex"),
    Buffer.from("0000002d0000004b", "hex"),
    Buffer.alloc(64),
  ]),
  jpeg: Buffer.from(
    "ffd8ffe000104a46494600010100000100010000ffdb004300" +
      "01".repeat(64) +
      "ffc0001108002d004b03",
    "hex",
  ),
  gif: Buffer.concat([
    Buffer.from("GIF89a"),
    // Logical screen descriptor, little-endian: 45 × 75.
    Buffer.from([0x2d, 0x00, 0x4b, 0x00]),
    Buffer.alloc(64),
  ]),
  webp: Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8L"),
    Buffer.alloc(4),
    Buffer.from([0x2f]),
    Buffer.alloc(64),
  ]),
  mp4: Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypisom"),
    Buffer.alloc(64),
  ]),
  /**
   * 🔴 The same container as `mp4` above, and that is the entire point.
   *
   * An iPhone shooting in "High Efficiency" writes this. Both carry `ftyp` at
   * offset 4, so only the brand at offset 8 tells a photo from a video — and a
   * check that stopped at `ftyp` stored the photo under `videos/` as
   * `video/mp4` on every surface that accepts video.
   */
  heic: Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypheic"),
    Buffer.alloc(64),
  ]),
  avif: Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypavif"),
    Buffer.alloc(64),
  ]),
  webm: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]),
  pdf: Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  /** 🔴 Refused by name, not merely unrecognised — it can carry a `<script>`. */
  svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`),
  html: Buffer.from("<!DOCTYPE html><html></html>"),
  /** Recognised by nothing, which is its own answer. */
  unknown: Buffer.from("not a file this platform accepts, by any signature"),
});

/** What each fixture honestly is, for a test that wants to assert on it. */
const MIME = Object.freeze({
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  /**
   * ⚠️ The **honest** type of these fixtures, so a test that sends one without
   * overriding `mimetype` is sending a truthful HEIC — which is the case that
   * matters. A test about lying still passes `mimetype` explicitly.
   */
  heic: "image/heic",
  avif: "image/avif",
});

const root = path.join(os.tmpdir(), "trydood-test-uploads");

/**
 * Write one and describe it the way the middleware would.
 *
 * @param {keyof BYTES} type   which signature to write
 * @param {object} [options]
 * @param {string} [options.name]      the filename the "client" sent
 * @param {string} [options.mimetype]  🔴 a **lie** to send, for the tests whose
 *        whole point is that a header is not evidence. Defaults to the truth.
 * @param {number} [options.sizeBytes] pad the file to this size, for limit tests
 * @returns {{ name, mimetype, size, tempFilePath }}
 */
exports.localFile = (type, options = {}) => {
  const body = BYTES[type];
  if (!body) throw new Error(`No fixture for "${type}".`);

  fs.mkdirSync(root, { recursive: true });

  const { name, mimetype, sizeBytes } = options;
  const fileName =
    name || `fixture_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempFilePath = path.join(root, `${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`);

  /**
   * ⚠️ Padding goes **after** the head, never before it. A signature is read
   * from offset zero, so a file padded at the front is a file with no signature
   * — which is a different test from the one the caller asked for.
   */
  const padded =
    sizeBytes && sizeBytes > body.length
      ? Buffer.concat([body, Buffer.alloc(sizeBytes - body.length)])
      : body;

  fs.writeFileSync(tempFilePath, padded);

  return {
    name: fileName,
    // The truth unless the caller deliberately asked to lie.
    mimetype: mimetype ?? MIME[type] ?? "application/octet-stream",
    size: padded.length,
    tempFilePath,
  };
};

/** Remove every fixture this run wrote. */
exports.cleanup = () => {
  fs.rmSync(root, { recursive: true, force: true });
};

exports.BYTES = BYTES;
exports.MIME = MIME;
