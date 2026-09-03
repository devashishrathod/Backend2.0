const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const User = require("../../models/User");
const DeviceToken = require("../../models/DeviceToken");
const { recordBrandStatusHistory } = require("../../helpers/brands");
const {
  notifyBrandDeactivated,
  notifyBrandActivated,
  notifyBrandCustomerVisibilityChanged,
} = require("../../helpers/notifications");
const { throwError } = require("../../utils");
const {
  BRAND_STATUS_ACTION,
  BRAND_STATUS_ACTOR,
  BRAND_STATUS_LIMITS,
} = require("../../constants/brandStatus");

/**
 * A filter that matches the flag's *current* value, treating an absent field as
 * on — which is what the schema default says it means.
 *
 * `{ isActive: true }` would not match a legacy row that simply has no
 * `isActive` field, and in Mongo an absent field does not equal `false` either,
 * so both directions need spelling out rather than compared literally.
 */
const stateGuard = (wasOn) => (wasOn ? { $ne: false } : false);

/**
 * The admin switches for a brand. Two of them, deliberately independent.
 *
 * ### 1. `isActive` — the vendor's account (required)
 *
 * Moves `User.isActive` on the owning vendor, and nothing else. That single flag
 * is enough to shut the door completely: the shared auth gate
 * (`helpers/auth/assertAccountAccess.js`) runs on every authenticated request, so
 * all 64 vendor route gates across 11 domains refuse the account from its very
 * next call — no per-router wiring, and no way to add a vendor endpoint that
 * forgets the check.
 *
 * It does **not** touch `Brand.isActive`. That is the point: a suspended
 * vendor's brand page, showcase and published vouchers keep serving the
 * customers who already have them. The vendor simply cannot create, edit or
 * publish anything new. Flipping both would 404 the brand profile while its
 * voucher cards stayed in the customer listing — that listing never filters on
 * the brand — which is a visibly broken app, not a suspension.
 *
 * Deactivating also ends the vendor's session bookkeeping and retires their push
 * devices. Reactivating stamps `User.sessionInvalidatedAt`, which kills every
 * token minted before this moment: a suspension can never be ridden out on an
 * old token, and the vendor comes back through a fresh login.
 *
 * ### 2. `hideFromCustomers` — customer visibility (optional)
 *
 * Moves `Brand.isActive`, which de-lists the brand profile, the directory entry
 * and the showcase. Omit it and customer visibility is left exactly as it was.
 * Independent of the account switch in both directions, so "locked out but still
 * listed" and "still working but de-listed" are both expressible.
 *
 * ### Audit
 *
 * One `BrandStatusHistory` row per switch that actually moved — a call that
 * flips both writes two rows. That keeps "when was this brand hidden?"
 * answerable separately from "when was the vendor locked out?".
 *
 * Curation is never touched. A de-listed brand stays pinned to "Top Brands" in
 * the DB; it is already invisible to customers, and clearing the pin here would
 * silently lose the admin's curation on every temporary suspension.
 *
 * @param {{ userId: string }} actor    the acting admin, from `req`
 * @param {{ brandId, isActive, reason, hideFromCustomers }} payload
 */
exports.toggleBrandStatus = async (actor = {}, payload = {}) => {
  const adminUserId = actor.userId;
  const { brandId } = payload;
  const nextIsActive = payload.isActive;
  const wantsVisibilityChange = payload.hideFromCustomers !== undefined;
  const nextIsVisible = wantsVisibilityChange
    ? !payload.hideFromCustomers
    : null;

  if (!adminUserId) throwError(401, "Admin authentication is required.");
  if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID.");
  }
  if (typeof nextIsActive !== "boolean") {
    throwError(422, "isActive is required and must be a boolean.");
  }
  if (wantsVisibilityChange && typeof payload.hideFromCustomers !== "boolean") {
    throwError(422, "hideFromCustomers must be a boolean.");
  }

  const reason = payload.reason ? String(payload.reason).trim() : "";
  if (reason && nextIsActive) {
    throwError(422, "A reason is only accepted when deactivating an account.");
  }
  if (reason.length > BRAND_STATUS_LIMITS.MAX_REASON_LENGTH) {
    throwError(
      422,
      `Reason cannot exceed ${BRAND_STATUS_LIMITS.MAX_REASON_LENGTH} characters.`,
    );
  }

  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({ _id: brandId, isDeleted: false })
        .select("_id userId brandName uniqueId merchantId isActive")
        .session(session);
      if (!brand) throwError(404, "Brand not found.");

      // The owning vendor. A brand with no user row is broken rather than
      // suspendable — there would be no account to switch off, which is the
      // whole operation.
      const user = await User.findOne({
        _id: brand.userId,
        isDeleted: false,
      })
        .select("_id role isActive")
        .session(session);
      if (!user) {
        throwError(
          404,
          "The vendor account linked to this brand was not found.",
        );
      }

      const now = new Date();
      const userWasActive = user.isActive !== false;
      const brandWasVisible = brand.isActive !== false;

      const accountChanges = userWasActive !== nextIsActive;
      const visibilityChanges =
        wantsVisibilityChange && brandWasVisible !== nextIsVisible;

      // Refused only when *nothing* would move. Sending `isActive` unchanged
      // alongside a real `hideFromCustomers` change is a valid call — the panel
      // posts the whole form, and the account switch simply happens to already
      // be where it should be.
      if (!accountChanges && !visibilityChanges) {
        throwError(
          409,
          wantsVisibilityChange
            ? "This brand is already in the requested state."
            : `This account is already ${nextIsActive ? "active" : "deactivated"}.`,
        );
      }

      const actions = [];
      const brandSet = {};

      if (accountChanges) {
        actions.push(
          nextIsActive
            ? BRAND_STATUS_ACTION.ACCOUNT_ACTIVATED
            : BRAND_STATUS_ACTION.ACCOUNT_DEACTIVATED,
        );

        // Reactivating clears the fields that described the suspension now
        // ending, so the admin list never shows a deactivation reason next to a
        // live account. The full trail survives in BrandStatusHistory.
        Object.assign(
          brandSet,
          nextIsActive
            ? {
                accountActivatedAt: now,
                accountActivatedByAdminId: adminUserId,
                accountDeactivatedAt: null,
                accountDeactivatedByAdminId: null,
                accountDeactivationReason: null,
              }
            : {
                accountDeactivatedAt: now,
                accountDeactivatedByAdminId: adminUserId,
                accountDeactivationReason: reason || null,
              },
        );

        const userUpdate = await User.updateOne(
          {
            _id: user._id,
            isDeleted: false,
            // Optimistic guard: refuse the write if another admin moved this
            // account between our read and our update.
            isActive: stateGuard(userWasActive),
          },
          {
            $set: nextIsActive
              ? {
                  isActive: true,
                  // Kills every token minted before now. Stamped here rather
                  // than on deactivation so that, while the account is off, the
                  // few deactivation-aware endpoints (logout, device
                  // unregister, reading the notice) still work — and so no
                  // token can survive the suspension either way.
                  sessionInvalidatedAt: now,
                }
              : // The token stays cryptographically valid until it expires —
                // the auth gate is what refuses it — but leaving the vendor
                // marked as logged in would misreport them everywhere.
                { isActive: false, isLoggedIn: false, isOnline: false },
          },
          { session },
        );
        if (userUpdate.matchedCount !== 1) {
          throwError(
            409,
            "This account's status was changed by someone else. Please refresh and try again.",
          );
        }
      }

      if (visibilityChanges) {
        actions.push(
          nextIsVisible
            ? BRAND_STATUS_ACTION.CUSTOMER_VISIBILITY_SHOWN
            : BRAND_STATUS_ACTION.CUSTOMER_VISIBILITY_HIDDEN,
        );
        Object.assign(brandSet, {
          isActive: nextIsVisible,
          customerVisibilityUpdatedAt: now,
          customerVisibilityUpdatedByAdminId: adminUserId,
        });
      }

      const brandUpdate = await Brand.updateOne(
        {
          _id: brand._id,
          isDeleted: false,
          // Guarded only when this call is the one moving it.
          ...(visibilityChanges
            ? { isActive: stateGuard(brandWasVisible) }
            : {}),
        },
        { $set: brandSet },
        { session },
      );
      if (brandUpdate.matchedCount !== 1) {
        throwError(
          409,
          "This brand was changed by someone else. Please refresh and try again.",
        );
      }

      // One row per switch that moved.
      const historyIds = [];
      for (const action of actions) {
        const isAccountAction =
          action === BRAND_STATUS_ACTION.ACCOUNT_ACTIVATED ||
          action === BRAND_STATUS_ACTION.ACCOUNT_DEACTIVATED;

        const history = await recordBrandStatusHistory(
          {
            brandId: brand._id,
            userId: user._id,
            action,
            performedByType: BRAND_STATUS_ACTOR.ADMIN,
            performedBy: adminUserId,
            // The note belongs to the account suspension it was written for.
            reason: isAccountAction ? reason || null : null,
            brandUniqueId: brand.uniqueId,
            merchantId: brand.merchantId,
            previousState: {
              userIsActive: userWasActive,
              brandIsActive: brandWasVisible,
            },
            newState: {
              userIsActive: accountChanges ? nextIsActive : userWasActive,
              brandIsActive: visibilityChanges
                ? nextIsVisible
                : brandWasVisible,
            },
            metadata: {
              brandName: brand.brandName || null,
              vendorRole: user.role,
              // Both switches moved on this one call.
              partOfCombinedChange: actions.length > 1,
              sessionsInvalidated: isAccountAction && nextIsActive,
            },
          },
          session,
        );
        historyIds.push(history._id);
      }

      result = {
        brandId: brand._id,
        brandName: brand.brandName || null,
        brandUniqueId: brand.uniqueId,
        merchantId: brand.merchantId,
        vendorUserId: user._id,
        // The account switch, after this call.
        isActive: accountChanges ? nextIsActive : userWasActive,
        // Customer visibility, after this call.
        isVisibleToCustomers: visibilityChanges
          ? nextIsVisible
          : brandWasVisible,
        actions,
        reason: reason || null,
        previousState: {
          userIsActive: userWasActive,
          brandIsActive: brandWasVisible,
        },
        accountActivatedAt: accountChanges && nextIsActive ? now : null,
        accountDeactivatedAt: accountChanges && !nextIsActive ? now : null,
        sessionsInvalidatedAt: accountChanges && nextIsActive ? now : null,
        performedBy: adminUserId,
        performedAt: now,
        historyIds,
        // Internal, for the post-commit steps below.
        accountChanged: accountChanges,
        visibilityChanged: visibilityChanges,
      };
    });
  } finally {
    await session.endSession();
  }

  // ---------------------------------------------------------------------------
  // After the commit. Neither of these may undo a moderation decision an admin
  // has already made, so both are outside the transaction and neither throws.
  // ---------------------------------------------------------------------------

  let devicesRetired = 0;
  if (result.accountChanged && !result.isActive) {
    try {
      const retired = await DeviceToken.updateMany(
        { userId: result.vendorUserId, isActive: true },
        {
          $set: {
            isActive: false,
            deactivatedAt: result.performedAt,
            deactivatedReason: "Account deactivated by admin",
          },
        },
      );
      devicesRetired = retired.modifiedCount || 0;
    } catch (error) {
      // A locked-out account keeping a live push token is untidy, not unsafe —
      // every request it could act on is already refused by the auth gate.
      console.error(
        `[brandStatus] could not retire devices for user ${result.vendorUserId}:`,
        error?.message,
      );
    }
  }

  const brandForNotice = {
    _id: result.brandId,
    brandName: result.brandName,
    uniqueId: result.brandUniqueId,
    merchantId: result.merchantId,
  };

  // One notice per call, at most. The account switch is the bigger news, so when
  // both moved it carries the visibility change in its copy and its meta rather
  // than sending the vendor two messages about one admin action.
  // `notify` never throws and reports its own outcome.
  let notice = null;
  if (result.accountChanged) {
    notice = result.isActive
      ? await notifyBrandActivated({ brand: brandForNotice })
      : await notifyBrandDeactivated({
          brand: brandForNotice,
          reason: result.reason,
          hiddenFromCustomers: !result.isVisibleToCustomers,
        });
  } else if (result.visibilityChanged) {
    notice = await notifyBrandCustomerVisibilityChanged({
      brand: brandForNotice,
      isVisible: result.isVisibleToCustomers,
    });
  }

  const { accountChanged, visibilityChanged, ...response } = result;

  return {
    ...response,
    devicesRetired,
    isVendorNotified: Boolean(notice?.created),
  };
};
