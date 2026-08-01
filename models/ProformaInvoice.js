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

const ProformaInvoiceItemSchema = new mongoose.Schema({
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
  // Saved snapshot field for item name/model
  chairModel: String, // Keeping field name for backwards compatibility, or acts as modelName / itemName
  hsnCode: String,
  
  // Color fields remain applicable when itemType is 'Chair'
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

  items: [ProformaInvoiceItemSchema],

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

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
}, { timestamps: true });

module.exports = mongoose.model('ProformaInvoice', ProformaInvoiceSchema);