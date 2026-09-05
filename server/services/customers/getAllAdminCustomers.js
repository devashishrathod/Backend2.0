const Customer = require("../../models/Customer");
const { buildAggregateLookup } = require("../../database");
const { pagination } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const { collectCustomerStats } = require("../../helpers/customers");
const {
  CUSTOMER_LIST_SORT_BY,
  CUSTOMER_LIST_SORT_ORDER,
} = require("../../constants/customerList");

const toBoolean = (value) => value === true || value === "true";

/**
 * Filter for a flag that defaults to **false** (`isSignUpCompleted`, …).
 *
 * Rows created before the flag existed have the field absent, and in Mongo an
 * absent field does not equal `false` — so asking for "false" has to mean "not
 * true", otherwise older customers vanish from the list entirely.
 */
const falseDefaultFilter = (wanted) => (wanted ? true : { $ne: true });

/**
 * Filter for a flag that defaults to **true** (`isActive`).
 *
 * The mirror image of the above: absent means on, so "true" has to mean "not
 * false" rather than a literal match.
 */
const trueDefaultFilter = (wanted) => (wanted ? { $ne: false } : false);

/**
 * The admin panel's customer directory — one row per customer, every column an
 * admin screen needs to triage without opening the customer.
 *
 * Its own service rather than a role branch on anything customer-facing, for the
 * same reason `getAllAdminBrands` is separate: this pipeline joins the account
 * behind the profile and reports refund refusals, chargebacks and wallet
 * balances, and a projection that strips those is one edit away from serving
 * them to the customer they are about.
 *
 * Deliberately lighter than `GET /customers/admin/:customerId`. No addresses, no
 * bank rows, no claim history — only *whether* and *how many*, because those are
 * the columns you sort a worklist by. The list tells an admin who needs
 * attention; the detail endpoint tells them why.
 *
 * Soft-deleted customers never appear here. Deactivated ones always do — they
 * are the rows an admin needs in order to switch them back on. A **deleted**
 * customer is still openable by id on the detail endpoint, which is where
 * "where did this account go?" gets answered.
 */
exports.getAllAdminCustomers = async (query = {}) => {
  let {
    page,
    limit,
    search,
    accountActive,
    isActive,
    isSignUpCompleted,
    isOnBoardingCompleted,
    isMobileVerified,
    isEmailVerified,
    isLoggedIn,
    loginType,
    city,
    state,
    fromDate,
    toDate,
    sortBy,
    sortOrder,
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  // ── Match ─────────────────────────────────────────────────────────────────
  const match = { isDeleted: false };

  // The customer profile row's own switch. The account switch is
  // `accountActive`, filtered after the user join below — the two are
  // independent and nothing keeps them in step.
  if (isActive !== undefined) {
    match.isActive = trueDefaultFilter(toBoolean(isActive));
  }
  if (isSignUpCompleted !== undefined) {
    match.isSignUpCompleted = falseDefaultFilter(toBoolean(isSignUpCompleted));
  }

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const till = new Date(toDate);
      till.setHours(23, 59, 59, 999);
      match.createdAt.$lte = till;
    }
  }

  // Everything an admin might be handed to find a customer by. All five live on
  // `Customer` itself, so this narrows *before* any join runs — `fullName` is
  // kept in step with `User.name` by `updateUserById`, which is what makes
  // searching the profile row rather than the account row correct.
  if (search?.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), "i");
    match.$or = [
      { fullName: pattern },
      { uniqueId: pattern },
      { email: pattern },
      { mobile: pattern },
      { whatsappNumber: pattern },
    ];
  }

  const pipeline = [{ $match: match }];

  // ── The account behind the profile ────────────────────────────────────────
  // The only join in the paged pipeline, and it earns its place: five of the
  // filters and three of the sorts read it. A 1:1 lookup on `_id`.
  //
  // An allow-list, so `password`, `otp` and the session fields cannot arrive
  // here by accident when someone adds a field to `User`.
  pipeline.push(
    ...buildAggregateLookup({
      from: "users",
      localField: "userId",
      as: "account",
      project: {
        name: 1,
        email: 1,
        mobile: 1,
        whatsappNumber: 1,
        username: 1,
        uniqueId: 1,
        role: 1,
        loginType: 1,
        image: 1,
        walletBalance: 1,
        tCoinsBalance: 1,
        referralCode: 1,
        appliedReferralCode: 1,
        referralCount: 1,
        followingCount: 1,
        followerCount: 1,
        reviewCount: 1,
        isActive: 1,
        isLoggedIn: 1,
        isOnline: 1,
        isEmailVerified: 1,
        isMobileVerified: 1,
        isSignUpCompleted: 1,
        isOnBoardingCompleted: 1,
        createdAt: 1,
        /**
         * The customer's own channel toggles, so the directory can show the
         * state without a call per row.
         *
         * ⚠️ Raw, and usually **absent** — the field only appears once somebody
         * changes a setting, and absent means every channel is on. Do not read
         * these booleans directly; `GET /notifications/admin/preferences` gives
         * the resolved answer and says whether a platform switch is overriding
         * them.
         */
        notificationPreferences: 1,
        updatedAt: 1,
      },
    }),
  );

  // These live on the account, so they have to wait for the join above.
  if (accountActive !== undefined) {
    pipeline.push({
      $match: {
        "account.isActive": trueDefaultFilter(toBoolean(accountActive)),
      },
    });
  }
  if (isOnBoardingCompleted !== undefined) {
    pipeline.push({
      $match: {
        "account.isOnBoardingCompleted": falseDefaultFilter(
          toBoolean(isOnBoardingCompleted),
        ),
      },
    });
  }
  if (isMobileVerified !== undefined) {
    pipeline.push({
      $match: {
        "account.isMobileVerified": falseDefaultFilter(
          toBoolean(isMobileVerified),
        ),
      },
    });
  }
  if (isEmailVerified !== undefined) {
    pipeline.push({
      $match: {
        "account.isEmailVerified": falseDefaultFilter(
          toBoolean(isEmailVerified),
        ),
      },
    });
  }
  if (isLoggedIn !== undefined) {
    pipeline.push({
      $match: {
        "account.isLoggedIn": falseDefaultFilter(toBoolean(isLoggedIn)),
      },
    });
  }
  if (loginType) {
    pipeline.push({ $match: { "account.loginType": loginType } });
  }

  // ── Where they are ────────────────────────────────────────────────────────
  // A second join, added **only when asked for**. City and state live on
  // `Location`, so there is no way to filter on them without one — but an admin
  // who is not filtering by city should not pay for it on every other request.
  //
  // `$limit: 1` because this is an existence test, not a fetch: the address that
  // is *shown* comes from the per-page statistics below.
  if (city || state) {
    const locationMatch = {
      $expr: { $eq: ["$customerId", "$$customerId"] },
      isActive: true,
      isDeleted: false,
    };
    if (city) locationMatch.city = new RegExp(escapeRegex(city.trim()), "i");
    if (state) locationMatch.state = new RegExp(escapeRegex(state.trim()), "i");

    pipeline.push(
      {
        $lookup: {
          from: "locations",
          let: { customerId: "$_id" },
          pipeline: [
            { $match: locationMatch },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "locationMatch",
        },
      },
      { $match: { "locationMatch.0": { $exists: true } } },
    );
    // `locationMatch` is never unset: the `$project` below is an allow-list, so
    // it simply does not survive to the response.
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  pipeline.push({
    $addFields: {
      // Can this person sign in at all. Read off the account, because that is
      // where the switch lives — `Customer.isActive` below is a different thing.
      isAccountActive: { $ne: ["$account.isActive", false] },
      // Is the customer profile row itself live.
      isProfileActive: { $ne: ["$isActive", false] },
    },
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
  // NEWEST / OLDEST are directions in themselves and ignore `sortOrder`; the
  // rest take it, falling back to the only ordering that makes sense for that
  // column (names A→Z, balances and counts biggest first).
  const direction = (fallback) => {
    if (sortOrder === CUSTOMER_LIST_SORT_ORDER.ASC) return 1;
    if (sortOrder === CUSTOMER_LIST_SORT_ORDER.DESC) return -1;
    return fallback;
  };

  let sortStage;
  switch (sortBy) {
    case CUSTOMER_LIST_SORT_BY.OLDEST:
      sortStage = { createdAt: 1 };
      break;
    case CUSTOMER_LIST_SORT_BY.NAME:
      sortStage = { fullName: direction(1) };
      break;
    case CUSTOMER_LIST_SORT_BY.WALLET:
      sortStage = { "account.walletBalance": direction(-1) };
      break;
    case CUSTOMER_LIST_SORT_BY.T_COINS:
      sortStage = { "account.tCoinsBalance": direction(-1) };
      break;
    case CUSTOMER_LIST_SORT_BY.REFERRALS:
      sortStage = { "account.referralCount": direction(-1) };
      break;
    case CUSTOMER_LIST_SORT_BY.RECENTLY_UPDATED:
      sortStage = { updatedAt: direction(-1) };
      break;
    case CUSTOMER_LIST_SORT_BY.NEWEST:
    default:
      sortStage = { createdAt: -1 };
  }
  // Without a unique tiebreak, ties page unpredictably — the same customer can
  // appear on two pages while another never appears at all.
  sortStage._id = -1;

  pipeline.push({ $sort: sortStage });

  // ── Shape ─────────────────────────────────────────────────────────────────
  // An allow-list, not `{ __v: 0 }`. Every field an admin screen reads is named
  // here, so a field added to `Customer` later cannot start being served by
  // accident.
  pipeline.push({
    $project: {
      // identity
      fullName: 1,
      uniqueId: 1,
      email: 1,
      mobile: 1,
      whatsappNumber: 1,
      image: 1,
      dob: 1,
      createdAt: 1,
      updatedAt: 1,

      // the account behind it
      userId: 1,
      account: 1,

      // ── the two switches this list also reports ──
      // The account: can they sign in and act.
      isAccountActive: 1,
      // The profile row: `Customer.isActive`. Named apart from `isActive` on
      // purpose, so a reader of the response cannot mistake one for the other.
      isProfileActive: 1,
      isSignUpCompleted: 1,
    },
  });

  const result = await pagination(Customer, pipeline, page, limit, "customer");

  // ── Enrich ────────────────────────────────────────────────────────────────
  // Nine batched aggregations for the ids **on this page**, never for the whole
  // filtered set — see the note in `helpers/customers/customerStats.js` for why
  // that cannot be a `$lookup` inside the pipeline above.
  //
  // `pagination` throws a 404 when nothing matched, so `data` is never empty
  // here. The guard is not for that — it is so this stays correct if the list is
  // ever switched to `allowEmpty`.
  const rows = result.data || [];
  if (rows.length === 0) return result;

  const { statsFor } = await collectCustomerStats({
    customerIds: rows.map((row) => row._id),
    userIds: rows.map((row) => row.userId).filter(Boolean),
  });

  result.data = rows.map((row) => ({
    ...row,
    ...statsFor(row._id, row.userId),
  }));

  return result;
};
