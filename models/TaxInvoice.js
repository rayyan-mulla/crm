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

const TaxInvoiceItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['Chair', 'SparePart', 'SubAssembly'],
    required: true,
    default: 'Chair'
  },
  // Dynamic reference based on itemType
  item: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'items.itemType'
  },
  // Snapshot field for item model/part name
  chairModel: String,
  hsnCode: String,

  // Color fields applicable when itemType is 'Chair'
  colorId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  colorName: {
    type: String,
    default: '-'
  },

  quantity: { type: Number, required: true, default: 1 },
  unitPrice: { type: Number, required: true },
  shippingUnit: { type: Number, default: 0 }
}, { _id: true });

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

  items: [TaxInvoiceItemSchema],

  taxableAmount: Number,
  gstAmount: Number,
  grandTotal: Number,

  poNumber: {
    type: String,
    trim: true
  },
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

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  deletedAt: {
    type: Date
  },

  deleteReason: {
    type: String,
    trim: true
  }
}, { timestamps: true });

module.exports = mongoose.model('TaxInvoice', TaxInvoiceSchema);