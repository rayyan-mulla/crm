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

const TaxInvoiceSchema = new mongoose.Schema({

  piId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProformaInvoice',
    required: true,
    index: true
  },

  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },

  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  invoiceSequence: {
    type: Number,
    required: true
  },

  invoiceDate: {
    type: Date,
    default: Date.now
  },

  billingAddress: AddressSchema,
  shippingAddress: AddressSchema,

  gstEnabled: Boolean,
  gstType: {
    type: String,
    enum: ['IGST', 'CGST_SGST', 'NONE']
  },

  gstBreakup: {
    igst: Number,
    cgst: Number,
    sgst: Number
  },

  items: [{
    chairModel: String,
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

  status: {
    type: String,
    enum: ['ACTIVE', 'DELETED'],
    default: 'ACTIVE',
    index: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  deletedAt: {
    type: Date
  },

  deleteReason: {
    type: String,
    trim: true
  }

});

module.exports = mongoose.model('TaxInvoice', TaxInvoiceSchema);
