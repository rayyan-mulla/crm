const mongoose = require('mongoose');

const SparePartSchema = new mongoose.Schema({
  partName: { type: String, required: true, trim: true },
  
  hsnCode: { type: String, trim: true, default: '94036000' },

  category: { type: mongoose.Schema.Types.ObjectId, ref: 'SparePartCategory' },
  unit: { type: String, default: 'pcs' },

  baseCost: { type: Number, required: true, min: 0 },
  gstApplicable: { type: Boolean, default: false },
  gstPercentage: { type: Number, default: 18, min: 0, max: 100 },
  finalCost: { type: Number, required: true, min: 0 },

  isActive: { type: Boolean, default: true },

  stock: { type: Number, default: 0 }

}, { timestamps: true });

module.exports = mongoose.model('SparePart', SparePartSchema);