const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSetting } = require("../../services/settings");

exports.update = asyncWrapper(async (req, res) => {
  const { setting, warnings } = await updateSetting(
    req.userId,
    req.validatedData,
  );

  /**
   * ⚠️ `data` stays the settings document, exactly as it always has — the
   * panel reads it that way and a provider switch is no reason to move it.
   *
   * A preflight warning goes into the **message** instead, because that is the
   * one string an admin panel always shows. Silently logging "S3 is on but
   * CloudFront is not" would leave the person who just flipped the switch with
   * no way to learn it.
   */
  const message = warnings.length
    ? `Settings updated. ${warnings.join(" ")}`
    : "Settings updated successfully.";

  return sendSuccess(res, 200, message, setting);
});
