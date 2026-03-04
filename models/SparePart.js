const mongoose = require('mongoose');

const SparePartSchema = new mongoose.Schema({
  partName: { type: String, required: true, trim: true },

  category: { type: mongoose.Schema.Types.ObjectId, ref: 'SparePartCategory' },
  unit: { type: String, default: 'pcs' },

  baseCost: { type: Number, required: true, min: 0 },
  gstApplicable: { type: Boolean, default: false },
  finalCost: { type: Number, required: true, min: 0 },

  isActive: { type: Boolean, default: true }

}, { timestamps: true });

module.exports = mongoose.model('SparePart', SparePartSchema);