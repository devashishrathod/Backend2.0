const { pairPosters } = require("../../helpers/showcases/pairPosters");

/**
 * 🔴 G11 — which poster belongs to which video.
 *
 * A showcase batch can arrive down two roads at once: some media as multipart
 * files, some as `uploadId`s already sitting in S3. Posters arrive the same way,
 * in two separate places — multipart `thumbnails`, and a JSON
 * `thumbnailUploadIds` — and nothing relates a poster to its video except
 * **position within its own road**.
 *
 * The old code flattened both sides (files first, then ids) and paired across
 * the combined lists, which is correct only when both happen to hold the same
 * number of files. Everything below is the case where they do not.
 */

/** Short stand-ins; only identity matters here. */
const media = (id) => ({ tag: `media:${id}` });
const poster = (id) => ({ tag: `poster:${id}` });

describe("🔴 each road pairs inside itself", () => {
  test("the mixed batch that used to go wrong", () => {
    const { items, posters } = pairPosters(
      { files: [media("A"), media("B")], ids: [media("C")] },
      // One poster came as a file, one as an id — and the id's video is `C`.
      { files: [poster("A")], ids: [poster("C")] },
    );

    expect(items).toEqual([media("A"), media("B"), media("C")]);
    // Before: B got poster C, and C got nothing.
    expect(posters).toEqual([poster("A"), undefined, poster("C")]);
  });

  test("files only — unchanged, and still index-aligned", () => {
    const { items, posters } = pairPosters(
      { files: [media(1), media(2), media(3)], ids: [] },
      { files: [undefined, poster(2)], ids: [] },
    );

    expect(items).toHaveLength(3);
    expect(posters).toEqual([undefined, poster(2), undefined]);
  });

  test("ids only — the poster ids line up with the media ids", () => {
    const { posters } = pairPosters(
      { files: [], ids: [media(1), media(2)] },
      { files: [], ids: [poster(1), poster(2)] },
    );

    expect(posters).toEqual([poster(1), poster(2)]);
  });

  test("⚠️ posters and media are always the same length", () => {
    const { items, posters } = pairPosters(
      { files: [media(1), media(2)], ids: [media(3)] },
      { files: [], ids: [] },
    );

    expect(posters).toHaveLength(items.length);
    expect(posters.every((value) => value === undefined)).toBe(true);
  });

  /**
   * ⚠️ A gap stays a gap rather than shifting the ones after it.
   *
   * `uploadSingleMedia` refuses a video with no poster and ignores a poster on a
   * photo, so `undefined` at an index is information. Compacting the list would
   * turn "this video has no poster" into "this video has the next one's".
   */
  test("a hole in the middle does not slide the rest up", () => {
    const { posters } = pairPosters(
      { files: [media(1), media(2), media(3)], ids: [] },
      { files: [poster(1), undefined, poster(3)], ids: [] },
    );

    expect(posters).toEqual([poster(1), undefined, poster(3)]);
  });

  test("a poster with no media at its index is dropped, not misapplied", () => {
    const { items, posters } = pairPosters(
      { files: [media(1)], ids: [] },
      { files: [poster(1), poster(2)], ids: [] },
    );

    expect(items).toHaveLength(1);
    expect(posters).toEqual([poster(1)]);
  });
});

describe("it survives the shapes a caller can actually send", () => {
  test.each([
    ["nothing at all", undefined, undefined],
    ["empty roads", { files: [], ids: [] }, { files: [], ids: [] }],
    ["media with no posters key", { files: [media(1)], ids: [] }, undefined],
  ])("%s", (_label, incoming, thumbs) => {
    const { items, posters } = pairPosters(incoming, thumbs);
    expect(posters).toHaveLength(items.length);
  });

  test("the media order is files first, then ids — what acceptUploads uses", () => {
    const { items } = pairPosters(
      { files: [media("f1"), media("f2")], ids: [media("i1")] },
      { files: [], ids: [] },
    );

    expect(items.map((item) => item.tag)).toEqual([
      "media:f1",
      "media:f2",
      "media:i1",
    ]);
  });
});
