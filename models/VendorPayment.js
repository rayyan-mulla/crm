// models/VendorPayment.js

const mongoose = require('mongoose');

const VendorPaymentSchema = new mongoose.Schema({

  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },

  paymentNumber: {
    type: String,
    unique: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  paymentDate: {
    type: Date,
    required: true
  },

  paymentMethod: {
    type: String,
    enum: ['cash', 'bank', 'upi', 'cheque'],
    default: 'cash'
  },

  reference: String,
  notes: String,

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }

}, { timestamps: true });

module.exports = mongoose.model('VendorPayment', VendorPaymentSchema);