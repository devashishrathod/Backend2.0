const EmployeeReferral = require("../../model/EmployeeReferral");
const { sendError, sendSuccess } = require("../../utils");
const { getUserById, updateUserById } = require("../../service/userServices");
const {
  getBrandById,
  updateBrandById,
  getBrandWithAllDetails,
} = require("../../service/brandServices");
const {
  getTransactionById,
  updateTransactionByOrderAndUserId,
} = require("../../service/transactionServices");
const {
  getActiveSubscriptionPlanById,
} = require("../../service/subscriptionServices");
const {
  getSubscribedById,
  createSubscribed,
  updateSubscribedById,
  updateSubscribedAmountById,
} = require("../../service/subscribedServices");
const {
  generateRazorpaySignature,
  getPaymentDetails,
  generateAndUploadInvoice,
} = require("../../helpers/transactions");
const {
  calculateEndDate,
  calculateDuration,
} = require("../../helpers/subscribeds");

exports.verifyTransaction = async (req, res) => {
  try {
    const createdUserId = req.payload?._id;
    const checkUser = await getUserById(createdUserId);
    if (!checkUser) return sendError(res, 404, "User not found!");

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      transactionId,
    } = req.body;
    if (
      !razorpayOrderId ||
      !razorpayPaymentId ||
      !razorpaySignature ||
      !transactionId
    ) {
      return sendError(res, 422, "Missing required fields");
    }
    const checkTxn = await getTransactionById(transactionId);
    if (!checkTxn) return sendError(res, 404, "User transaction not found!");

    const { user, createdBy, brand, subscription } = checkTxn;
    if (createdUserId.toString() !== createdBy.toString()) {
      return sendError(
        res,
        404,
        "You are not authorized to verify this payment request",
      );
    }
    const checkVendor = await getUserById(user);
    if (!checkVendor) return sendError(res, 404, "Vendor not found!");

    const checkBrand = await getBrandById(brand);
    if (!checkBrand) return sendError(res, 404, "Brand not found!");

    const checkSubscription = await getActiveSubscriptionPlanById(subscription);
    if (!checkSubscription)
      return sendError(res, 404, "Subscription plan not found!");

    let newSubscribed;
    let SubscribedBrand;
    const startDate = new Date();
    const durationInDays = checkSubscription?.durationInDays;
    const durationInYears = checkSubscription?.durationInYears;
    let endDate = calculateEndDate(startDate, durationInYears, durationInDays);
    const subscribedData = {
      user,
      brand,
      subscribedBy: createdBy,
      transaction: checkTxn?._id,
      subscription,
      durationInDays,
      durationInYears,
      startDate,
      endDate,
      expiryDate: endDate,
      discount: checkSubscription?.discount,
      numberOfSubBrands: checkSubscription?.numberOfSubBrands,
      price: checkSubscription?.price,
      isCoolingPlan: false,
    };
    if (checkBrand.isSubscribed) {
      const subscribedDetails = await getSubscribedById(checkBrand?.subscribed);
      if (!subscribedDetails) {
        return sendError(
          res,
          404,
          "Brand/Vendor's subscribed details not found!",
        );
      }
      if (subscribedDetails.isExpired) {
        newSubscribed = await createSubscribed(subscribedData);
      } else {
        const previousSubscriptionId = subscribedDetails?.subscription;
        const checkPreviousSubscription = await getActiveSubscriptionPlanById(
          previousSubscriptionId,
        );
        const currentPlanPrice = checkSubscription?.price;
        const previousPlanPrice = checkPreviousSubscription?.price;
        if (currentPlanPrice < previousPlanPrice) {
          return sendError(
            res,
            403,
            "Downgrading is not permitted. Your current plan provides greater value than the selected option. Please choose a higher-tier plan.",
          );
        }
        if (subscribedDetails.numberOfUpgrade >= 3) {
          return sendError(
            res,
            400,
            "Upgrade limit reached (Max 3 upgrades). Please start with fresh subscription plan",
          );
        }
        const now = new Date();
        const upgradedData = {
          ...subscribedData,
          previousPlans: [
            ...(subscribedDetails?.previousPlans || []),
            subscribedDetails._id,
          ],
        };
        newSubscribed = await createSubscribed(upgradedData);
        const oldPlanUpdatedData = {
          upgradedTo: newSubscribed._id,
          isUpgraded: true,
          upgradeDate: now,
          upgradedBy: createdUserId,
          isActive: false,
          isExpired: true,
          expiryDate: now,
          numberOfUpgrade: (subscribedDetails?.numberOfUpgrade || 0) + 1,
        };
        await updateSubscribedById(subscribedDetails?._id, oldPlanUpdatedData);
      }
    } else {
      newSubscribed = await createSubscribed(subscribedData);
    }
    const generatedSignature = generateRazorpaySignature(
      razorpayOrderId,
      razorpayPaymentId,
      "VENDOR",
    );
    const isValidSignature = generatedSignature === razorpaySignature;
    if (!isValidSignature) {
      return sendError(res, 400, "Invalid signature. Payment may be tampered.");
    }
    const paymentDetails = await getPaymentDetails(razorpayPaymentId, "VENDOR");
    if (!paymentDetails) {
      return sendError(
        res,
        503,
        "Razorpay services unavailable! Please try again later",
      );
    }
    const updatedTxnData = {
      entity: paymentDetails?.entity,
      description: paymentDetails?.description,
      status: paymentDetails?.status,
      razorpayPaymentId,
      razorpaySignature,
      verified: paymentDetails?.captured,
      paidAmount: paymentDetails?.amount / 100,
      dueAmount: checkSubscription?.price - paymentDetails?.amount / 100,
      amountRefunded: (paymentDetails?.amount_refunded ?? 0) / 100,
      refundStatus: paymentDetails?.refund_status,
      isInternational: paymentDetails?.international,
      paymentMethod: paymentDetails?.method,
      walletProvider: paymentDetails?.wallet,
      fee: paymentDetails?.fee / 100,
      tax: paymentDetails?.tax / 100,
      cardId: paymentDetails?.card_id,
      bank: paymentDetails?.bank,
      vpa: paymentDetails?.vpa,
      notes: paymentDetails?.notes,
      errorCode: paymentDetails?.error_code,
      errorDescription: paymentDetails?.error_description,
      errorSource: paymentDetails?.error_source,
      errorStep: paymentDetails?.error_step,
      errorReason: paymentDetails?.error_reason,
      acquirerData: paymentDetails?.acquirer_data,
      updatedAtRaw: paymentDetails?.created_at,
    };
    const updateTxn = await updateTransactionByOrderAndUserId(
      { _id: transactionId, user: user, razorpayOrderId },
      updatedTxnData,
    );
    if (!updateTxn) return sendError(res, 404, "Transaction update failed");
    if (updateTxn?.verified) {
      const amountData = {
        paidAmount: paymentDetails?.amount / 100,
        dueAmount: checkSubscription?.price - paymentDetails?.amount / 100,
        isActive: true,
      };
      const invoiceData = {
        invoiceId: updateTxn.invoiceId,
        transaction: updateTxn._id.toString(),
        planName: checkSubscription?.name,
        price: updateTxn.paidAmount,
        date: new Date(startDate).toLocaleDateString("en-IN"),
        planEnd: new Date(endDate).toLocaleDateString("en-IN"),
        status: updateTxn.status,
        paymentMethod: updateTxn.paymentMethod,
      };
      const invoiceUrl = await generateAndUploadInvoice(invoiceData);
      console.log("Invoice URL:", invoiceUrl);
      const finalTxn = await updateTransactionByOrderAndUserId(
        { _id: transactionId, user: user, razorpayOrderId },
        { invoiceUrl },
      );
      await updateSubscribedAmountById(newSubscribed?._id, amountData);
      const updateBrandAndUserData = {
        subBrandsLimit: checkSubscription?.numberOfSubBrands,
        subscribed: newSubscribed?._id,
        isSubscribed: true,
        currentScreen: "HOME_SCREEN",
        isOnBoardingCompleted: true,
      };
      await updateUserById(user, updateBrandAndUserData);
      await updateBrandById(brand, updateBrandAndUserData);
      const referral = await EmployeeReferral.findOne({
        brand: brand,
        user: user,
      });
      if (referral && checkSubscription?.name) {
        let incField = null;
        switch (checkSubscription.name) {
          case "Starter":
            incField = "subscriptionCount.noOfStarterPlan";
            break;
          case "Professional":
            incField = "subscriptionCount.noOfProfessionalPlan";
            break;
          case "Enterprise":
            incField = "subscriptionCount.noOfEntrepreneurPlan";
            break;
          default:
            incField = null;
        }
        if (incField) {
          await EmployeeReferral.findOneAndUpdate(
            { brand: brand, user: user },
            {
              $inc: { [incField]: 1 },
              $set: { isSubscribed: true },
            },
            { new: true },
          );
        }
      }
      SubscribedBrand = await getBrandWithAllDetails(brand);
    } else {
      return sendError(
        res,
        updateTxn?.errorCode || 400,
        updateTxn?.errorReason || "User transaction updation failed",
      );
    }
    return sendSuccess(
      res,
      200,
      "Payment successful! Congratulations — your subscription has been successfully activated",
      { brand: SubscribedBrand },
    );
  } catch (error) {
    console.error("Payment verification error:", error);
    return sendError(res, 500, error.message);
  }
};
