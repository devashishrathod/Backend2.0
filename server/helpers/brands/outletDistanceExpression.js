const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Straight-line distance from the caller to one outlet, as an aggregation
 * expression.
 *
 * `$geoNear` is not available where this is used: it has to be the first stage
 * of a pipeline, and both callers start from `Brand` so that brands — not
 * outlets — stay the rows. So the distance is computed inline instead, using
 * the equirectangular approximation. Over the tens of kilometres a city
 * directory spans its error is a fraction of a percent, far below what "sorted
 * by nearest" needs. Exact distances still come from `$geoNear` in the voucher
 * pipeline.
 *
 * `cos(latitude)` is a constant for a given caller, so it is folded in here in
 * JS rather than recomputed per document.
 *
 * Lives here rather than in either caller because the brand directory
 * (`getAllCustomerBrands`) and the global search's brand section both need the
 * identical number. Two copies of a distance formula drift, and the symptom —
 * the same brand showing 2.3 km on one screen and 2.4 km on another — is the
 * kind nobody files a bug for.
 *
 * Expects the document in scope to carry `geo.coordinates` as [lng, lat];
 * returns `null` for an outlet that has none, so a missing address is dropped
 * rather than counted as distance zero.
 */
exports.outletDistanceExpression = (latitude, longitude) => ({
  $let: {
    vars: {
      lat: { $arrayElemAt: ["$geo.coordinates", 1] },
      lng: { $arrayElemAt: ["$geo.coordinates", 0] },
    },
    in: {
      $cond: [
        {
          $and: [
            { $eq: [{ $type: "$$lat" }, "double"] },
            { $eq: [{ $type: "$$lng" }, "double"] },
          ],
        },
        {
          $multiply: [
            EARTH_RADIUS_METERS,
            {
              $sqrt: {
                $add: [
                  {
                    $pow: [
                      { $degreesToRadians: { $subtract: ["$$lat", latitude] } },
                      2,
                    ],
                  },
                  {
                    $pow: [
                      {
                        $multiply: [
                          {
                            $degreesToRadians: {
                              $subtract: ["$$lng", longitude],
                            },
                          },
                          Math.cos(toRadians(latitude)),
                        ],
                      },
                      2,
                    ],
                  },
                ],
              },
            },
          ],
        },
        null,
      ],
    },
  },
});

exports.EARTH_RADIUS_METERS = EARTH_RADIUS_METERS;
