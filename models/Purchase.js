const mongoose = require('mongoose');


/* =========================================================
   PURCHASE ITEM
   Represents exactly what was ordered in the PO.
   This must NOT be changed during validation.
========================================================= */

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
    min: 0
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

  gstPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
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



/* =========================================================
   RECEIVED PURCHASE ITEM
   Represents what was actually received.
========================================================= */

const ReceivedPurchaseItemSchema = new mongoose.Schema({

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

  orderedQuantity: {
    type: Number,
    required: true,
    min: 0
  },

  receivedQuantity: {
    type: Number,
    required: true,
    min: 0
  },

  difference: {
    type: Number,
    required: true
  },

  unitCost: {
    type: Number,
    required: true,
    min: 0
  },

  totalCost: {
    type: Number,
    required: true,
    min: 0
  },

  matchStatus: {
    type: String,
    enum: [
      'MATCHED',
      'QUANTITY_MISMATCH',
      'MATERIAL_MISMATCH',
      'MATERIAL_AND_QUANTITY_MISMATCH'
    ],
    required: true
  }

}, { _id: false });



/* =========================================================
   PURCHASE
========================================================= */

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

  deliverySchedule: {
    type: String,
    default: '5 to 6 Days',
    trim: true
  },

  deliveryAt: {
    type: String,
    enum: ["WAREHOUSE", "OFFICE"],
  },


  /* =======================================================
     PO LIFECYCLE

     DRAFT
       ↓
     ORDERED
       ↓
     RECEIVED

     CANCELLED can happen before receiving.
  ======================================================= */

  status: {
    type: String,
    enum: [
      'DRAFT',
      'ORDERED',
      'RECEIVED',
      'CANCELLED',
      'CLOSED',
      'SHORT_CLOSED'
    ],
    default: 'DRAFT'
  },


  /* =======================================================
     ORIGINAL PO ITEMS

     These represent what was ordered.
  ======================================================= */

  items: {
    type: [PurchaseItemSchema],
    default: []
  },


  /* =======================================================
     ACTUAL RECEIVED ITEMS

     Filled only when PO is validated.
  ======================================================= */

  receivedItems: {
    type: [ReceivedPurchaseItemSchema],
    default: []
  },


  /* Original PO amount */
  totalAmount: {
    type: Number,
    default: 0
  },


  /* Actual received amount */
  receivedAmount: {
    type: Number,
    default: 0
  },


  /* =======================================================
     VALIDATION
  ======================================================= */

  validationStatus: {
    type: String,
    enum: [
      'NOT_VALIDATED',
      'VALIDATED'
    ],
    default: 'NOT_VALIDATED'
  },

  validationNotes: {
    type: String,
    trim: true
  },

  receivedAt: Date,

  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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