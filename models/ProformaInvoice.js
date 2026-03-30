const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  name: String,
  email: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String,
  phone: String,
  gstin: String
}, { _id: false });

const ProformaInvoiceSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },

  piNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  billingAddress: AddressSchema,
  shippingAddress: AddressSchema,

  gstEnabled: Boolean,

  gstType: {
    type: String,
    enum: ['IGST', 'CGST_SGST', 'NONE'],
    required: true
  },

  gstBreakup: {
    igst: Number,
    cgst: Number,
    sgst: Number
  },

  items: [{
    chairModel: String,
    hsnCode: String,
    colorId: mongoose.Schema.Types.ObjectId,
    colorName: String,
    quantity: Number,
    unitPrice: Number,
    shippingUnit: Number
  }],

  taxableAmount: Number,
  gstAmount: Number,
  grandTotal: Number,

  paymentMode: String,
  estimatedDelivery: String,
  installationType: {
    type: String,
    enum: ['FREE', 'DIY'],
    default: 'FREE'
  },
  notes: String,

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  status: {
    type: String,
    enum: ['ACTIVE', 'DELETED'],
    default: 'ACTIVE',
    index: true
  },

  deletedAt: {
    type: Date
  },

  deleteReason: {
    type: String,
    trim: true
  }
});

module.exports = mongoose.model('ProformaInvoice', ProformaInvoiceSchema);
