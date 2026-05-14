const mongoose = require("mongoose");
const Transaction = require("../../model/Transaction");
const DailyPayment = require("../../model/DailyPayment");
const Refund = require("../../model/Refund");
const {
  DAILY_PAYMENT_METHODS,
  DAILY_PAYMENT_TYPES,
  REFUND_STATUS,
} = require("../../constants");
const { throwError } = require("../../utils");

const getTimeAMPM_IST = (input = new Date()) => {
  const date = new Date(
    new Date(input).toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
    })
  );
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
};

exports.createDailyPayment = async (userId, data) => {
  const {
    transactionIds,
    brandId,
    paymentDate,
    paymentTime,
    paymentMethod,
    bankTransactionId,
    paymentTo,
  } = data;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const transactions = await Transaction.find({
      _id: { $in: transactionIds },
      isPaidToVendor: false,
      brand: brandId,
    }).session(session);
    if (!transactions.length) {
      throwError(400, "No unpaid transactions found");
    }
    if (paymentTo === DAILY_PAYMENT_TYPES.VENDOR) {
      const totalAmount = transactions.reduce(
        (sum, t) => sum + t.paidAmount,
        0
      );
      const [dailyPayment] = await DailyPayment.create(
        [
          {
            brand: brandId,
            amount: totalAmount,
            transactions: transactionIds,
            paymentDate: paymentDate || new Date(),
            paymentTime:
              paymentTime || getTimeAMPM_IST(paymentDate || new Date()),
            paymentMethod: paymentMethod || DAILY_PAYMENT_METHODS.CASH_DEPOSIT,
            bankTransactionId: bankTransactionId,
            paymentTo: paymentTo || DAILY_PAYMENT_TYPES.VENDOR,
          },
        ],
        { session }
      );
      await Transaction.updateMany(
        { _id: { $in: transactionIds } },
        {
          $set: {
            isPaidToVendor: true,
            paidToVendorAt: new Date(),
            dailyPayment: dailyPayment._id,
          },
        },
        { session }
      );
      await session.commitTransaction();
      session.endSession();
      return dailyPayment;
    } else if (paymentTo === DAILY_PAYMENT_TYPES.REFUND_CUSTOMER) {
      if (transactions[0]?.isRefunded) {
        throwError(409, "this amount is already refunded");
      }
      const refunRequest = await Refund.findById(transactions[0]?.refund);
      if (
        !refunRequest ||
        refunRequest?.isDeleted ||
        !refunRequest?.isApproved
      ) {
        throwError(409, "Refund request is not exist or not approved");
      }
      if (refunRequest?.isPaid) {
        throwError(409, "this amount is already refunded");
      }
      const refundAmount = refunRequest?.refundAmount;
      const paidData = {
        brand: brandId,
        user: refunRequest?.user,
        amount: refundAmount,
        transactions: transactionIds,
        paymentDate: paymentDate || new Date(),
        paymentTime: paymentTime || getTimeAMPM_IST(paymentDate || new Date()),
        paymentMethod: paymentMethod || DAILY_PAYMENT_METHODS.CASH_DEPOSIT,
        bankTransactionId: bankTransactionId,
        paymentTo: paymentTo || DAILY_PAYMENT_TYPES.REFUND_CUSTOMER,
      };
      const [dailyPayment] = await DailyPayment.create([paidData], { session });
      await Transaction.updateMany(
        { _id: { $in: transactionIds } },
        {
          $set: {
            isRefunded: true,
            amountRefunded: paidData?.amount,
            refundStatus: "COMPLETED",
            paidRefundAt: new Date(),
            dailyPayment: dailyPayment._id,
          },
        },
        { session }
      );
      await Refund.findByIdAndUpdate(
        transactions[0]?.refund,
        {
          $set: {
            actionBy: userId,
            actionAt: new Date(),
            status: REFUND_STATUS.COMPLETED,
            isPaid: true,
          },
        },
        { session }
      );
      await session.commitTransaction();
      session.endSession();
      return dailyPayment;
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
