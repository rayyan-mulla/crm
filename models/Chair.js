const mongoose = require('mongoose');

const ColorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  basePrice: { type: Number, required: true, min: 0 },
  gstApplicable: { type: Boolean, default: false },
  finalPrice: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true }
}, { _id: true, timestamps: true });

const ChairSchema = new mongoose.Schema({
  modelName: { type: String, required: true, trim: true, unique: true },
  colors: { type: [ColorSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Chair', ChairSchema);
