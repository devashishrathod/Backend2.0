const { getShowcaseConfig } = require("../helpers/settings");
const { throwError } = require("../utils");

/**
 * The showcase kill switch — `Setting.vendor.showcase.isActive`.
 *
 * ### Why it exists as a middleware rather than a check in each service
 *
 * Nine services write to a showcase, and a gate repeated nine times is a gate
 * somebody forgets on the tenth — which produces no error at all, just an
 * ungated endpoint. Here it sits in the route file beside `isVendorOrAdmin`,
 * where the next person adding a write route sees nine neighbours carrying it,
 * and `__tests__/money/settingsSurface.test.js` fails if a write route in
 * `routes/showcase.js` does not.
 *
 * ### ⚠️ Writes only, deliberately
 *
 * `GET /showcase/section/get/:sectionId` and `/section/get-all` are **not**
 * gated. A vendor has to be able to see the gallery they are being stopped from
 * editing — and the way back is an admin switching this on, not the vendor
 * losing sight of their own content in the meantime.
 *
 * The two customer-facing reads at the bottom of that file are not gated
 * either. What a brand has already published stays published: emptying a
 * gallery that customers are already browsing is a bigger change than freezing
 * edits, and it is not what this switch is for. Its sibling
 * `vendor.subscription.isActive` reads the same way — it blocks the purchase,
 * not the reading of plans.
 *
 * ### Why 422 and not 403
 *
 * 403 is "not your brand", which is what `isVendorOrAdmin` and the ownership
 * resolvers already say. This is "the feature is off right now", which is about
 * the request rather than the caller — the same code and the same shape of
 * sentence the claim and subscription switches use, so the panel can show it
 * straight through.
 */
/**
 * ⚠️ Declared as a named `const` and exported below, not assigned straight onto
 * `exports`. An arrow function assigned to a member expression gets **no name**,
 * so it shows up as `anonymous` in a stack trace and in any check that reads the
 * Express route stack — which is exactly what the route guard test does.
 */
const requireShowcaseEnabled = async (req, res, next) => {
  try {
    const { isActive } = await getShowcaseConfig();

    if (!isActive) {
      throwError(
        422,
        "Showcase editing is temporarily switched off. Your existing sections and media are untouched — please try again later.",
      );
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

exports.requireShowcaseEnabled = requireShowcaseEnabled;
