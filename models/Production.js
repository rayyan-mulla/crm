const mongoose = require('mongoose');

const ProductionItemSchema = new mongoose.Schema({
  itemType: {
    type: String,
    enum: ['SubAssembly', 'Chair'],
    required: true
  },
  subAssembly: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubAssembly'
  },
  chair: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chair'
  },
  chairColor: {
    type: mongoose.Schema.Types.ObjectId
  },
  quantityTarget: {
    type: Number,
    required: true,
    min: 1
  },
  quantityProduced: {
    type: Number,
    required: true,
    min: 0
  },
  // Captures structural component costs/snapshots at generation moment
  componentsUsed: [{
    componentType: { type: String, enum: ['sparePart', 'SubAssembly'], required: true },
    componentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: String,
    quantityConsumed: { type: Number, required: true }
  }]
}, { _id: false });

const ProductionSchema = new mongoose.Schema({
  productionNo: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['Regular', 'Sample', 'Rework'],
    default: 'Regular'
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['DRAFT', 'COMPLETED', 'CANCELLED'],
    default: 'COMPLETED'
  },
  items: [ProductionItemSchema],
  notes: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Production', ProductionSchema);