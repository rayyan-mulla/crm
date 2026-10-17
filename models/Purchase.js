const mongoose = require('mongoose');

const PurchaseItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['sparePart', 'chair', 'service'],
    required: true
  },

  serviceName: {
    type: String
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
    default: 0,
    min: 0
  },

  unitCost: {
    type: Number,
    default: 0,
    min: 0
  },

  gstApplicable: {
    type: Boolean,
    default: false
  },

  gstPercentage: {
    type: Number,
    default: 0,
    min: 0
  },

  finalRate: {
    type: Number,
    default: 0,
    min: 0
  },

  totalCost: {
    type: Number,
    default: 0,
    min: 0
  }
}, { _id: false });


/**
 * Current cumulative receiving state.
 *
 * Example:
 *
 * Ordered = 100
 * First delivery = 60
 * Second delivery = 40
 *
 * receivedQuantity = 100
 */
const ReceivedPurchaseItemSchema = new mongoose.Schema({
  poItemIndex: {
    type: Number,
    min: 0
  },

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


/**
 * One entry for every physical delivery.
 *
 * Example:
 *
 * Delivery 1:
 *   01-Oct
 *   60 chairs
 *
 * Delivery 2:
 *   04-Oct
 *   40 chairs
 *
 * Both records remain permanently available.
 */
const ReceiptHistoryItemSchema = new mongoose.Schema({
  poItemIndex: {
    type: Number,
    min: 0
  },

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

  previouslyReceived: {
    type: Number,
    required: true,
    min: 0
  },

  receivedQuantity: {
    type: Number,
    required: true,
    min: 0
  },

  totalReceived: {
    type: Number,
    required: true,
    min: 0
  },

  remainingQuantity: {
    type: Number,
    required: true,
    min: 0
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
  }
}, { _id: false });


/**
 * One complete receiving transaction.
 */
const ReceiptHistorySchema = new mongoose.Schema({
  receivedAt: {
    type: Date,
    default: Date.now,
    required: true
  },

  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  items: {
    type: [ReceiptHistoryItemSchema],
    default: []
  },

  receivedAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  billNumber: {
    type: String,
    trim: true
  },

  notes: {
    type: String,
    trim: true
  }
}, { _id: true });


const PurchaseSchema = new mongoose.Schema({
  purchaseNumber: {
    type: String,
    unique: true,
    required: true
  },

  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },

  invoiceNumber: {
    type: String,
    trim: true
  },

  purchaseDate: {
    type: Date
  },

  /**
   * This is a textual delivery schedule such as:
   *
   * "5 to 6 Days"
   *
   * Therefore this should NOT be Date.
   */
  deliverySchedule: {
    type: String,
    trim: true
  },

  deliveryAt: {
    type: String,
    enum: ['WAREHOUSE', 'OFFICE']
  },

  status: {
    type: String,
    enum: [
      'DRAFT',
      'ORDERED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED',
      'CLOSED',
      'SHORT_CLOSED'
    ],
    default: 'DRAFT'
  },

  items: {
    type: [PurchaseItemSchema],
    default: []
  },

  /**
   * Current cumulative receiving state.
   */
  receivedItems: {
    type: [ReceivedPurchaseItemSchema],
    default: []
  },

  /**
   * Every physical delivery is stored here.
   */
  receiptHistory: {
    type: [ReceiptHistorySchema],
    default: []
  },

  totalAmount: {
    type: Number,
    default: 0
  },

  /**
   * Cumulative amount actually received.
   */
  receivedAmount: {
    type: Number,
    default: 0
  },

  validationStatus: {
    type: String,
    enum: [
      'NOT_VALIDATED',
      'PARTIALLY_VALIDATED',
      'FULLY_VALIDATED'
    ],
    default: 'NOT_VALIDATED'
  },

  validationNotes: {
    type: String,
    trim: true
  },

  receivedAt: {
    type: Date
  },

  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  billNumber: {
    type: String,
    trim: true
  },

  shortClosedAt: {
    type: Date
  },

  shortClosedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  shortCloseReason: {
    type: String,
    trim: true
  },

  notes: {
    type: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  cancelledAt: {
    type: Date
  }
}, { timestamps: true });

/**
 * Pre-validation hook to automatically backfill poItemIndex on legacy receivedItems
 * and receiptHistory records so saving legacy purchases never fails validation.
 */
PurchaseSchema.pre('validate', function(next) {
  if (Array.isArray(this.receivedItems) && Array.isArray(this.items)) {
    for (let rIdx = 0; rIdx < this.receivedItems.length; rIdx++) {
      const item = this.receivedItems[rIdx];
      if (
        item.poItemIndex === undefined ||
        item.poItemIndex === null ||
        Number.isNaN(Number(item.poItemIndex))
      ) {
        let matchIndex = this.items.findIndex(poItem => {
          if (poItem.itemType !== item.itemType) return false;
          if (item.itemType === 'sparePart') {
            const poSpare = (poItem.sparePart?._id || poItem.sparePart)?.toString();
            const recSpare = (item.sparePart?._id || item.sparePart)?.toString();
            return poSpare && recSpare && poSpare === recSpare;
          }
          if (item.itemType === 'chair') {
            const poChair = (poItem.chair?._id || poItem.chair)?.toString();
            const recChair = (item.chair?._id || item.chair)?.toString();
            const poColor = (poItem.chairColor?._id || poItem.chairColor)?.toString();
            const recColor = (item.chairColor?._id || item.chairColor)?.toString();
            return poChair && recChair && poChair === recChair && (!poColor || poColor === recColor);
          }
          return false;
        });

        if (matchIndex === -1 && rIdx < this.items.length) {
          matchIndex = rIdx;
        }

        if (matchIndex !== -1) {
          item.poItemIndex = matchIndex;
        }
      }
    }
  }

  if (Array.isArray(this.receiptHistory)) {
    for (const receipt of this.receiptHistory) {
      if (Array.isArray(receipt.items) && Array.isArray(this.items)) {
        for (let rIdx = 0; rIdx < receipt.items.length; rIdx++) {
          const item = receipt.items[rIdx];
          if (
            item.poItemIndex === undefined ||
            item.poItemIndex === null ||
            Number.isNaN(Number(item.poItemIndex))
          ) {
            let matchIndex = this.items.findIndex(poItem => {
              if (poItem.itemType !== item.itemType) return false;
              if (item.itemType === 'sparePart') {
                const poSpare = (poItem.sparePart?._id || poItem.sparePart)?.toString();
                const recSpare = (item.sparePart?._id || item.sparePart)?.toString();
                return poSpare && recSpare && poSpare === recSpare;
              }
              if (item.itemType === 'chair') {
                const poChair = (poItem.chair?._id || poItem.chair)?.toString();
                const recChair = (item.chair?._id || item.chair)?.toString();
                const poColor = (poItem.chairColor?._id || poItem.chairColor)?.toString();
                const recColor = (item.chairColor?._id || item.chairColor)?.toString();
                return poChair && recChair && poChair === recChair && (!poColor || poColor === recColor);
              }
              return false;
            });

            if (matchIndex === -1 && rIdx < this.items.length) {
              matchIndex = rIdx;
            }

            if (matchIndex !== -1) {
              item.poItemIndex = matchIndex;
            }
          }
        }
      }
    }
  }

  next();
});

module.exports = mongoose.model('Purchase', PurchaseSchema);