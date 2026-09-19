const fs = require("fs");

const { MEDIA_KIND } = require("../../constants/storage");

/**
 * What a file actually is, read from its first bytes.
 *
 * ### 🔴 Why this has to exist
 *
 * Every "is this an image?" check in the app reads `file.mimetype`, and that
 * value is **written by the client**. `express-fileupload` takes it from the
 * multipart part's `Content-Type` header (`lib/processMultipart.js`); nothing
 * ever opens the file. So a caller who edits one header walks past
 * `BANNER_ALLOWED_MIME_TYPES`, `SHOWCASE_MEDIA_CONFIG.allowedImages`,
 * `TICKER_ICON_ALLOWED_MIME_TYPES` and `assertImageFile` alike:
 *
 *     Content-Disposition: form-data; name="image"; filename="x.png"
 *     Content-Type: image/png          ← a claim, nothing more
 *
 * Today Cloudinary happens to catch it — `resource_type: "image"` refuses a
 * non-image. That is the provider's accident, not our rule, and **S3 has no
 * such opinion**: it stores what it is given and serves it back with whatever
 * content type it was told.
 *
 * The bytes cannot be edited by a header. This is the only check in the upload
 * path that the caller does not get to write.
 *
 * ### What it is not
 *
 * Not a virus scanner and not a parser. It answers one question — "which of the
 * handful of types we accept does this look like, if any" — and says `null` for
 * everything else, including things that are perfectly valid files we simply do
 * not take.
 */

/**
 * How much of a file has to be read to answer either question below.
 *
 * ⚠️ Exported, and **both roads read exactly this much**. It used to be a
 * private `1024` in `confirm.js` while the multipart road read nothing at all;
 * a second copy of this number is how the two roads start disagreeing about
 * what a file is, which is the one thing this module exists to prevent.
 */
const HEAD_BYTES = 1024;

/** `true` when `bytes` begins with `sig`, skipping `null` as a wildcard. */
const startsWith = (bytes, sig, offset = 0) => {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => b === null || bytes[offset + i] === b);
};

const ascii = (bytes, offset, length) =>
  bytes.subarray(offset, offset + length).toString("latin1");

/**
 * The signatures, most specific first.
 *
 * ⚠️ Order matters where one prefix contains another. WebP and WAV both begin
 * `RIFF`, and they are told apart by the four bytes at offset 8 — so a plain
 * "starts with RIFF" rule would have to come last, and does not exist here at
 * all.
 */
const SIGNATURES = [
  {
    name: "JPEG",
    mime: "image/jpeg",
    kind: MEDIA_KIND.IMAGE,
    test: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    name: "PNG",
    mime: "image/png",
    kind: MEDIA_KIND.IMAGE,
    test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    name: "WebP",
    mime: "image/webp",
    kind: MEDIA_KIND.IMAGE,
    // "RIFF" …4 size bytes… "WEBP"
    test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP",
  },
  {
    /**
     * 🔴 Its own kind, not an image — so it lands under `gifs/` and never meets
     * the resize Lambda, which would flatten the animation.
     */
    name: "GIF",
    mime: "image/gif",
    kind: MEDIA_KIND.GIF,
    // "GIF87a" or "GIF89a"
    test: (b) => ascii(b, 0, 4) === "GIF8",
  },
  {
    name: "MP4/MOV",
    mime: "video/mp4",
    kind: MEDIA_KIND.VIDEO,
    // ISO base media: 4 size bytes, then "ftyp".
    test: (b) => ascii(b, 4, 4) === "ftyp",
  },
  {
    name: "WebM/MKV",
    mime: "video/webm",
    kind: MEDIA_KIND.VIDEO,
    test: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    name: "PDF",
    mime: "application/pdf",
    kind: MEDIA_KIND.DOCUMENT,
    test: (b) => ascii(b, 0, 5) === "%PDF-",
  },
];

/**
 * The four-character brand of an ISO base media file, or `null`.
 *
 * 🔴 This is what tells a photo from a video, and nothing else can.
 *
 * MP4, MOV, HEIC, HEIF and AVIF are **the same container**. All of them carry
 * `ftyp` at offset 4, so a check that stops there calls an iPhone photo a video
 * — and on a surface that accepts video it is then stored as one: `videos/`
 * prefix, `video/mp4` mime, `kind: VIDEO`, and a player that cannot open it.
 * Nothing errors. The brand at offset 8 is the only byte-level difference.
 */
const isoBrand = (bytes) =>
  ascii(bytes, 4, 4) === "ftyp" ? ascii(bytes, 8, 4).toLowerCase() : null;

/**
 * ISO brands that mean **still image**, not video.
 *
 * ⚠️ The image family is allow-listed rather than the video one, because the
 * two fail in opposite directions. A video brand nobody listed here is treated
 * as video — which is right. An image brand nobody listed is treated as video —
 * which is the bug above, and is why this list is the one that has to be kept
 * current. `mif1`/`msf1` are the generic HEIF brands some cameras write instead
 * of `heic`.
 */
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * Things to refuse by name, so the reason can be specific.
 *
 * 🔴 SVG is the one that matters. It is an XML document that can carry a
 * `<script>`, it passes `mimetype.startsWith("image/")`, and it is harmless
 * today only because these files are served from a different origin than the
 * panel. On our own CDN — especially a subdomain of a panel — it is stored XSS.
 * Falling through to "unrecognised" would say the same thing less usefully.
 *
 * ⚠️ `mimes` is the same refusal reached by **name** instead of by bytes, for
 * the presign road — see `refusalForMime` below. One list, so the two roads
 * cannot drift into refusing different things or saying it differently.
 */
const REFUSED = [
  {
    name: "SVG",
    mimes: ["image/svg+xml", "image/svg"],
    reason: "SVG files are not accepted — they can carry scripts.",
    test: (b) => {
      const head = ascii(b, 0, 512).trimStart().toLowerCase();
      return head.startsWith("<svg") || head.startsWith("<?xml");
    },
  },
  {
    name: "HTML",
    mimes: ["text/html", "application/xhtml+xml"],
    reason: "HTML files are not accepted.",
    test: (b) => {
      const head = ascii(b, 0, 512).trimStart().toLowerCase();
      return head.startsWith("<!doctype html") || head.startsWith("<html");
    },
  },
  {
    /**
     * 🔴 Refused **by name**, not left to fall through as a video.
     *
     * An iPhone shooting in "High Efficiency" writes these, so this is the one
     * refusal an ordinary customer will actually meet. The reason therefore has
     * to say what to do next, not just what went wrong — the setting that fixes
     * it for good is three taps away and almost nobody knows it exists.
     */
    name: "HEIC",
    mimes: ["image/heic", "image/heif", "image/heic-sequence"],
    reason:
      "HEIC photos are not supported yet — please send a JPEG or PNG. On an " +
      "iPhone you can change this once for every photo: Settings → Camera → " +
      "Formats → Most Compatible.",
    test: (b) => HEIF_BRANDS.has(isoBrand(b)),
  },
  {
    name: "AVIF",
    mimes: ["image/avif", "image/avif-sequence"],
    reason:
      "AVIF images are not supported yet — please send a JPEG, PNG or WebP.",
    test: (b) => AVIF_BRANDS.has(isoBrand(b)),
  },
];

/**
 * Identify a file from its head.
 *
 * @param {Buffer} head  the first bytes — 1 KB is plenty, and is what the
 *                       confirm step fetches with a ranged GET rather than
 *                       downloading the whole object
 * @returns {{ kind, mime, name } | { refused: true, name, reason } | null}
 */
exports.identify = (head) => {
  if (!Buffer.isBuffer(head) || head.length < 4) return null;

  // Refusals first: an SVG would otherwise just be "unrecognised", and the
  // caller deserves to know which of their assumptions is wrong.
  for (const entry of REFUSED) {
    if (entry.test(head)) {
      return { refused: true, name: entry.name, reason: entry.reason };
    }
  }

  for (const entry of SIGNATURES) {
    if (entry.test(head)) {
      return { kind: entry.kind, mime: entry.mime, name: entry.name };
    }
  }

  return null;
};

/**
 * An image's width and height, from the same bytes.
 *
 * Every format below carries its dimensions in the first few dozen bytes, so
 * the 1 KB already fetched for the signature check answers this too — **no
 * second read, no image library, and no Lambda** for the case that is 95% of
 * uploads. A video's duration genuinely needs the container walked, and that is
 * what the metadata Lambda is for; an image never did.
 *
 * Returns `null` rather than guessing. A missing dimension is a field the panel
 * does not show; a wrong one is a layout that breaks quietly.
 */
const readDimensions = (head, name) => {
  try {
    if (name === "PNG") {
      // IHDR is always the first chunk: 8-byte signature, 4 length, 4 "IHDR".
      if (ascii(head, 12, 4) !== "IHDR") return null;
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    if (name === "GIF") {
      // Logical screen descriptor, little-endian, straight after "GIF8?a".
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    }

    if (name === "WebP") {
      const fourcc = ascii(head, 12, 4);
      // "VP8X" — the extended form, 24-bit sizes minus one.
      if (fourcc === "VP8X") {
        const w = head.readUIntLE(24, 3) + 1;
        const h = head.readUIntLE(27, 3) + 1;
        return { width: w, height: h };
      }
      // "VP8L" — lossless, 14 bits each packed into a 32-bit little-endian word.
      if (fourcc === "VP8L") {
        const bits = head.readUInt32LE(21);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
        };
      }
      // "VP8 " — lossy, after a 3-byte start code and the 0x9d012a signature.
      if (fourcc === "VP8 ") {
        return {
          width: head.readUInt16LE(26) & 0x3fff,
          height: head.readUInt16LE(28) & 0x3fff,
        };
      }
      return null;
    }

    if (name === "JPEG") {
      /**
       * JPEG keeps its size in a start-of-frame marker, and where that sits
       * depends on how much EXIF the camera wrote — so the segments have to be
       * walked rather than indexed.
       *
       * ⚠️ Bounded by the buffer, not by a marker: a JPEG with a large EXIF
       * block puts its SOF past the first kilobyte, and then this returns
       * `null` instead of reading whatever happens to be at that offset.
       */
      let offset = 2;
      while (offset + 9 < head.length) {
        if (head[offset] !== 0xff) return null;
        const marker = head[offset + 1];
        const length = head.readUInt16BE(offset + 2);

        // SOF0-SOF15, skipping DHT (C4), JPG (C8) and DAC (CC) which share the
        // range but are not frame headers.
        const isSOF =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;

        if (isSOF) {
          return {
            height: head.readUInt16BE(offset + 5),
            width: head.readUInt16BE(offset + 7),
          };
        }
        offset += 2 + length;
      }
      return null;
    }
  } catch {
    // A truncated or malformed header. The file may still be fine — the caller
    // decides that — but its dimensions are not knowable from this much.
    return null;
  }

  return null;
};

/**
 * The same refusal, reached by the **declared** type instead of the bytes.
 *
 * ### 🔴 Why the presign road needs this
 *
 * `confirm` reads the object's head and refuses an SVG or a HEIC there — which
 * is correct, and far too late. By then the client has been handed a signature,
 * has uploaded the whole file, and S3 has been paid to store it. On a phone
 * that is a 4 MB photo pushed over mobile data to be told no.
 *
 * `createUploadIntent` already knows the declared `contentType`. It is only a
 * claim — which is exactly why the bytes are still checked at confirm — but a
 * caller who *correctly* says `image/heic` should be told no **before** the
 * upload, not after. This is the same reasoning as G12: a refusal a surface was
 * always going to make belongs before the bandwidth, not after it.
 *
 * ⚠️ A liar is not caught here, and is not meant to be. A HEIC announced as
 * `image/jpeg` walks past this and is refused at confirm, by its bytes.
 *
 * @param {string} mime  the client's declared content type
 * @returns {{ refused: true, name, reason } | null} — the identical shape
 *          `identify` returns, so callers handle one thing, not two.
 */
exports.refusalForMime = (mime) => {
  const value = String(mime || "")
    .toLowerCase()
    .trim();
  if (!value) return null;

  const entry = REFUSED.find((item) => item.mimes.includes(value));
  return entry
    ? { refused: true, name: entry.name, reason: entry.reason }
    : null;
};

exports.readDimensions = readDimensions;
exports.SIGNATURES = SIGNATURES;
exports.REFUSED = REFUSED;
exports.HEAD_BYTES = HEAD_BYTES;

/**
 * The same two answers, for a file that is already on this disk.
 *
 * 🔴 This is what the multipart road was missing entirely. `confirm` reads an
 * uploaded object's head with a ranged GET and settles what it is; the file
 * road handed `file.mimetype` — the client's own header — straight to the
 * provider and stored it as fact.
 *
 * ⚠️ A local read, so it costs nothing worth measuring: the file is already
 * written to `tempFileDir` by the time any surface sees it, and this opens it
 * once for 1 KB. There is no reason the cheaper road was the one that checked
 * less.
 *
 * @param {string} filePath  an `express-fileupload` `tempFilePath`
 * @returns {{ identified, dimensions }} — `identified` is exactly what
 *          `identify` returns, including `null` and the `refused` shape, so the
 *          caller answers in its own words rather than this file guessing them.
 */
exports.inspectLocalFile = (filePath) => {
  /**
   * ⚠️ **Our** bug, and it has to say so.
   *
   * `express-fileupload` only writes a `tempFilePath` when `useTempFiles` is on
   * — which it is, in `index.js`, and has to stay for the same reason the 100 MB
   * limit exists. Turn it off and every file arrives as a `data` buffer instead,
   * `filePath` is `undefined`, and `openSync` answers
   * `ENOENT: no such file or directory, open 'undefined'` — a sentence that
   * sends whoever reads it looking for a missing upload rather than a changed
   * middleware option.
   */
  if (!filePath) {
    const error = new Error(
      "Cannot inspect an upload with no tempFilePath — express-fileupload must " +
        "run with useTempFiles enabled.",
    );
    error.statusCode = 500;
    throw error;
  }

  let head;
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEAD_BYTES, 0);
    head = buffer.subarray(0, read);
  } finally {
    // The handle closes whether or not the read worked — a refused upload must
    // not also leak a descriptor.
    fs.closeSync(handle);
  }

  const identified = exports.identify(head);
  return {
    identified,
    dimensions: identified?.name
      ? readDimensions(head, identified.name)
      : null,
  };
};
