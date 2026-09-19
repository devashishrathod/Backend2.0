/**
 * Line each media up with the poster that belongs to it.
 *
 * ### 🔴 The bug this replaces
 *
 * Both lists were flattened by `describeAllIncoming` — files first, then ids —
 * and paired by position across the **combined** result. That is only correct
 * when the media list and the poster list happen to have the same number of
 * files, so a request that mixed roads unevenly handed a video somebody else's
 * poster:
 *
 *     media   = [fileA, fileB, idC]
 *     posters = [posterFile, posterId1]
 *
 *     wanted : fileA → posterFile,  idC → posterId1
 *     got    : fileA → posterFile,  fileB → posterId1,  idC → nothing
 *
 * Nothing refused it. Both were stills, both were within the size limit, and the
 * only sign was the wrong picture on a video — which reads as the vendor having
 * attached the wrong file. `fileB` being a photo made it invisible entirely:
 * photos are their own thumbnail, so the stray poster was simply ignored.
 *
 * ### ⚠️ Each road pairs inside itself
 *
 * `thumbnails[2]` is the poster for the third **file**, and
 * `thumbnailUploadIds[0]` for the first **uploadId**. That is what the surface's
 * comment always said; this makes it true. It is also the only rule a client can
 * follow, because the two arrays arrive in different places — one is multipart
 * fields, the other is JSON — and nothing relates them but position.
 *
 * ### ⚠️ Gaps stay gaps
 *
 * A media with no poster at its index gets `undefined`, which is exactly what
 * `uploadSingleMedia` expects: it refuses a video with no poster, and ignores a
 * poster on a photo. Nothing is invented to fill a hole here, because a hole is
 * information.
 *
 * @param {{ files: any[], ids: any[] }} media    described media, per road
 * @param {{ files: any[], ids: any[] }} posters  described posters, per road
 * @returns {{ items: any[], posters: any[] }} two arrays of the same length,
 *          in the order `acceptUploads` uses — files first, then ids
 */
exports.pairPosters = (media, posters) => {
  const mediaFiles = media?.files || [];
  const mediaIds = media?.ids || [];
  const posterFiles = posters?.files || [];
  const posterIds = posters?.ids || [];

  return {
    items: [...mediaFiles, ...mediaIds],
    posters: [
      ...mediaFiles.map((_, index) => posterFiles[index]),
      ...mediaIds.map((_, index) => posterIds[index]),
    ],
  };
};
