// controllers/vendorPaymentController.js

const VendorPayment = require('../models/VendorPayment');
const Vendor = require('../models/Vendor');
const Purchase = require('../models/Purchase');
const mongoose = require('mongoose');


// 🔹 INDEX (LEDGER)
exports.index = async (req, res) => {

  const purchases = await Purchase.find({ status: 'PURCHASED' })
    .populate('vendor')
    .lean();

  const payments = await VendorPayment.find()
    .populate('vendor')
    .lean();

  let ledger = [];

  purchases.forEach(p => {
    ledger.push({
      date: p.purchaseDate,
      type: 'Purchase',
      ref: p.purchaseNumber,
      vendor: p.vendor?.name,
      debit: p.totalAmount,
      credit: 0,
      id: p._id,
      source: 'purchase'
    });
  });

  payments.forEach(p => {
    ledger.push({
      date: p.paymentDate,
      type: 'Payment',
      ref: p.reference || 'PAY',
      vendor: p.vendor?.name,
      debit: 0,
      credit: p.amount,
      id: p._id,
      source: 'payment'
    });
  });

  ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  ledger = ledger.map(l => {
    balance += l.debit - l.credit;
    return { ...l, balance };
  });

  res.render('vendorPayments/index', {
    ledger,
    user: req.session.user,
    activePage: 'vendorPayments'
    });
};


// 🔹 NEW FORM
exports.newForm = async (req, res) => {
  const vendors = await Vendor.find({ isActive: true }).lean();

  res.render('vendorPayments/form', {
    vendors,
    payment: null,
    mode: 'create',
    user: req.session.user,
    activePage: 'vendorPayments'
  });
};


// 🔹 CREATE
exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { vendor, amount, paymentDate, paymentMethod, reference, notes } = req.body;

    const amt = Number(amount);

    const payment = await VendorPayment.create([{
      vendor,
      amount: amt,
      paymentDate,
      paymentMethod,
      reference,
      notes,
      createdBy: req.session.user.id
    }], { session });

    await Vendor.findByIdAndUpdate(
      vendor,
      { $inc: { balance: -amt } },
      { session }
    );

    await session.commitTransaction();

    res.redirect('/purchasing/vendor-payments');

  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    res.redirect('/purchasing/vendor-payments/new');
  }
};


// 🔹 VIEW
exports.view = async (req, res) => {

  const payment = await VendorPayment.findById(req.params.id)
    .populate('vendor')
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name')
    .lean();

  res.render('vendorPayments/view', {
    payment,
    user: req.session.user,
    activePage: 'vendorPayments'
  });
};


// 🔹 EDIT FORM
exports.editForm = async (req, res) => {

  const payment = await VendorPayment.findById(req.params.id).lean();
  const vendors = await Vendor.find({ isActive: true }).lean();

  res.render('vendorPayments/form', {
    vendors,
    payment,
    mode: 'edit',
    user: req.session.user,
    activePage: 'vendorPayments'
  });
};


// 🔹 UPDATE
exports.update = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await VendorPayment.findById(req.params.id).session(session);

    // reverse old
    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: payment.amount } },
      { session }
    );

    const newAmount = Number(req.body.amount);

    payment.amount = newAmount;
    payment.paymentDate = req.body.paymentDate;
    payment.paymentMethod = req.body.paymentMethod;
    payment.reference = req.body.reference;
    payment.notes = req.body.notes;
    payment.updatedBy = req.session.user.id;

    await payment.save({ session });

    // apply new
    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: -newAmount } },
      { session }
    );

    await session.commitTransaction();

    res.redirect('/purchasing/vendor-payments');

  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    res.redirect(`/purchasing/vendor-payments/${req.params.id}/edit`);
  }
};


// 🔹 DELETE
exports.delete = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await VendorPayment.findById(req.params.id).session(session);

    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: payment.amount } },
      { session }
    );

    await VendorPayment.findByIdAndDelete(req.params.id, { session });

    await session.commitTransaction();

    res.redirect('/purchasing/vendor-payments');

  } catch (err) {
    await session.abortTransaction();
    console.error(err);
    res.redirect('/purchasing/vendor-payments');
  }
};