const { getAppConfig: buildAppConfig } = require("../../helpers/settings");

/**
 * What the app is allowed to know before anybody signs in.
 *
 * A thin pass-through today, and deliberately still a service: the route layer
 * must not reach into `helpers/`, and the day this needs a cache or a per-region
 * answer there is already a place for it.
 */
exports.getAppConfig = async (query = {}) => buildAppConfig(query);
