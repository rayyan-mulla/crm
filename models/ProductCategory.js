const mongoose = require('mongoose');

const ProductCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('ProductCategory', ProductCategorySchema);