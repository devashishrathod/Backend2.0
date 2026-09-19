/**
 * Keep the file only if the row that was going to point at it exists.
 *
 * ### 🔴 What this is for
 *
 * A create path uploads first — the object key carries the new id, so the file
 * has to land before the document is written — and then writes the row. If that
 * write fails, the object stays in the bucket with nothing referring to it,
 * forever.
 *
 * ⚠️ **Forever is literal.** A confirmed upload has already moved out of
 * `staging/` into the type tree, so the lifecycle rule that sweeps abandoned
 * uploads will never see it, and there is no other sweep. Four surfaces did
 * this: `createCategory`, `createSubCategory`, `registerUser` and
 * `addBrandFeature`. `createBanner` and `createTicker` always cleaned up, which
 * is where the shape below comes from.
 *
 * ### ⚠️ The window is narrow, and that is exactly why it was missed
 *
 * All four check for duplicates **before** uploading, so the ordinary "name
 * already taken" path never leaks. What is left is the race: two admins
 * creating the same category at once, where the second one's `create` trips the
 * unique index. Rare, invisible, and it accumulates.
 *
 * ### ⚠️ The original error is re-thrown, always
 *
 * Cleaning up is not a reason to change what the caller is told. A failed
 * cleanup is a log line for the same reason a failed delete after a successful
 * save is: the request's outcome is already decided, and a second failure must
 * not overwrite the first one's message.
 *
 * @param {object|null} uploaded  what `acceptUpload` returned, or nothing
 * @param {() => Promise<any>} write  the row this file is for
 */
exports.discardOnFailure = async (uploaded, write) => {
  try {
    return await write();
  } catch (error) {
    if (uploaded?.url || uploaded?.storage?.key || uploaded?.storage?.publicId) {
      try {
        // Required here rather than at the top: `services/storage` reaches back
        // into `helpers/media` through `toMediaDocument`, and a top-level import
        // would close that loop.
        const storage = require("../../services/storage");
        await storage.deleteAsset(uploaded);
      } catch (cleanupError) {
        console.error(
          `Failed to discard an upload after the write failed ` +
            `(${uploaded?.storage?.key || uploaded?.url}):`,
          cleanupError?.message || cleanupError,
        );
      }
    }
    throw error;
  }
};
