const mongoose = require('mongoose');

const PurchaseItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['sparePart', 'chair'],
    required: true
  },

  sparePart: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SparePart'
  },

  chair: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chair'
  },

  chairColor: {
    type: mongoose.Schema.Types.ObjectId
  },

  quantity: {
    type: Number,
    required: true,
    min: 1
  },

  basePrice: {
    type: Number,
    required: true
  },

  unitCost: {
    type: Number,
    required: true
  },

  gstApplicable: {
    type: Boolean,
    default: false
  },

  finalRate: {
    type: Number,
    required: true
  },

  totalCost: {
    type: Number,
    required: true
  }

}, { _id: false });

const PurchaseSchema = new mongoose.Schema({
  purchaseNumber: {
    type: String,
    required: true,
    unique: true
  },

  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },

  invoiceNumber: String,

  purchaseDate: {
    type: Date,
    default: Date.now
  },

  status: {
    type: String,
    enum: ['DRAFT', 'PURCHASED', 'CANCELLED'],
    default: 'PURCHASED'
  },

  items: [PurchaseItemSchema],

  totalAmount: {
    type: Number,
    default: 0
  },

  notes: String,

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  cancelledAt: Date

}, { timestamps: true });

module.exports = mongoose.model('Purchase', PurchaseSchema);