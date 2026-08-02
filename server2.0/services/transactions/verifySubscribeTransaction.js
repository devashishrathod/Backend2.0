const User = require("../../models/User");
const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const Subscribed = require("../../models/Subscribed");
// const EmployeeReferral = require("../../model/EmployeeReferral");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const {
  generateRazorpaySignature,
  getPaymentDetails,
  generateAndUploadInvoice,
} = require("../../helpers/transactions");
const {
  calculateEndDate,
  calculateDuration,
} = require("../../helpers/subscribeds");

exports.verifySubscribeTransaction = async (tokenUserId, payload) => {
  try {
    const checkUser = await User.findById(tokenUserId);
    if (!checkUser || checkUser.isDeleted) throwError(404, "User not found!");
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      transactionId,
    } = payload;
    if (
      !razorpayOrderId ||
      !razorpayPaymentId ||
      !razorpaySignature ||
      !transactionId
    ) {
      throwError(422, "Missing required fields");
    }

    const generatedSignature = generateRazorpaySignature(
      razorpayOrderId,
      razorpayPaymentId,
      ROLES.VENDOR,
    );
    const isValidSignature = generatedSignature === razorpaySignature;
    if (!isValidSignature) {
      throwError(400, "Invalid signature. Payment may be tampered.");
    }
    const paymentDetails = await getPaymentDetails(
      razorpayPaymentId,
      ROLES.VENDOR,
    );
    if (!paymentDetails) {
      throwError(503, "Razorpay services unavailable! Please try again later");
    }

    const checkTxn = await Transaction.findById(transactionId);
    if (!checkTxn || checkTxn.isDeleted) {
      throwError(404, "User transaction not found!");
    }
    const { userId, createdBy, brandId, subscriptionId } = checkTxn;
    if (tokenUserId.toString() !== createdBy.toString()) {
      throwError(404, "You are not authorized to verify this payment request");
    }

    const checkVendor = await User.findById(userId);
    if (!checkVendor || checkVendor.isDeleted) {
      throwError(404, "Vendor not found!");
    }

    const checkBrand = await Brand.findById(brandId);
    if (!checkBrand || checkBrand.isDeleted) {
      throwError(404, "Brand not found!");
    }

    const checkSubscription = await Subscription.findById(subscriptionId);
    if (!checkSubscription || checkSubscription.isDeleted) {
      throwError(404, "Subscription plan not found!");
    } else if (!checkSubscription.isActive) {
      throwError(404, "Subscription plan is inactive!");
    }

    let newSubscribed;
    let SubscribedBrand;
    const startDate = new Date();
    const durationInDays = checkSubscription?.durationInDays;
    const durationInYears = checkSubscription?.durationInYears;
    let endDate = calculateEndDate(startDate, durationInYears, durationInDays);
    const subscribedData = {
      userId,
      brandId,
      subscribedBy: createdBy,
      transaction: checkTxn?._id,
      subscriptionId,
      durationInDays,
      durationInYears,
      startDate,
      endDate,
      discount: checkSubscription?.discount,
      price: checkSubscription?.price,
    };
    if (checkBrand.isSubscribed) {
      const subscribedDetails = await Subscribed.findById(
        checkBrand?.subscribedId,
      );
      if (!subscribedDetails) {
        throwError(404, "Brand/Vendor's subscribed details not found!");
      }
      if (subscribedDetails.isExpired) {
        newSubscribed = await Subscribed.create(subscribedData);
      } else {
        const previousSubscriptionId = subscribedDetails?.subscriptionId;
        const checkPreviousSubscription = await Subscription.findById(
          previousSubscriptionId,
        );
        const currentPlanPrice = checkSubscription?.price;
        const previousPlanPrice = checkPreviousSubscription?.price;
        if (currentPlanPrice < previousPlanPrice) {
          throwError(
            403,
            "Downgrading is not permitted. Your current plan provides greater value than the selected option. Please choose a higher-tier plan.",
          );
        }
        const now = new Date();
        newSubscribed = await Subscribed.create(subscribedData);
        const oldPlanUpdatedData = {
          upgradedTo: newSubscribed._id,
          isUpgraded: true,
          upgradeDate: now,
          upgradedBy: tokenUserId,
          isActive: false,
          isExpired: true,
          endDate: now,
          numberOfUpgrade: (subscribedDetails?.numberOfUpgrade || 0) + 1,
        };
        await Subscribed.findByIdAndUpdate(
          subscribedDetails?._id,
          oldPlanUpdatedData,
        );
      }
    } else {
      newSubscribed = await Subscribed.create(subscribedData);
    }
    // const generatedSignature = generateRazorpaySignature(
    //   razorpayOrderId,
    //   razorpayPaymentId,
    //   ROLES.VENDOR,
    // );
    // const isValidSignature = generatedSignature === razorpaySignature;
    // if (!isValidSignature) {
    //   throwError(400, "Invalid signature. Payment may be tampered.");
    // }
    // const paymentDetails = await getPaymentDetails(
    //   razorpayPaymentId,
    //   ROLES.VENDOR,
    // );
    // if (!paymentDetails) {
    //   throwError(503, "Razorpay services unavailable! Please try again later");
    // }
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
    const updateTxn = await Transaction.findByIdAndUpdate(
      transactionId,
      updatedTxnData,
      {
        returnDocument: "after",
      },
    );
    if (!updateTxn) throwError(404, "Transaction update failed");
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
      const finalTxn = await Transaction.findByIdAndUpdate(
        transactionId,
        { invoiceUrl },
        { returnDocument: "after" },
      );
      newSubscribed = await Subscribed.findByIdAndUpdate(
        newSubscribed?._id,
        amountData,
      );
      await Brand.findByIdAndUpdate(brandId, {
        subscribedId: newSubscribed?._id,
        isSubscribed: true,
      });
      // const referral = await EmployeeReferral.findOne({
      //   brand: brand,
      //   user: user,
      // });
      // if (referral && checkSubscription?.name) {
      //   let incField = null;
      //   switch (checkSubscription.name) {
      //     case "Starter":
      //       incField = "subscriptionCount.noOfStarterPlan";
      //       break;
      //     case "Professional":
      //       incField = "subscriptionCount.noOfProfessionalPlan";
      //       break;
      //     case "Enterprise":
      //       incField = "subscriptionCount.noOfEntrepreneurPlan";
      //       break;
      //     default:
      //       incField = null;
      //   }
      //   if (incField) {
      //     await EmployeeReferral.findOneAndUpdate(
      //       { brand: brand, user: user },
      //       {
      //         $inc: { [incField]: 1 },
      //         $set: { isSubscribed: true },
      //       },
      //       { new: true },
      //     );
      //   }
      // }
    } else {
      throwError(
        updateTxn?.errorCode || 400,
        updateTxn?.errorReason || "User transaction updation failed",
      );
    }
    return newSubscribed;
  } catch (error) {
    console.error("Payment verification error:", error);
    throwError(500, error.message);
  }
};
