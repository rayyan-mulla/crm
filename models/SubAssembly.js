const mongoose = require('mongoose');

const ComponentSchema = new mongoose.Schema({
  componentType: { type: String, enum: ['sparePart', 'subAssembly'], required: true },
  item: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'components.componentModel' },
  componentModel: { type: String, enum: ['SparePart', 'SubAssembly'], required: true },
  quantity: { type: Number, required: true, min: 1 }
}, { _id: true });

const SubAssemblySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  code: { type: String, trim: true },
  hsnCode: { type: String, trim: true, default: '94036000' },
  components: { type: [ComponentSchema], default: [] },
  bomCost: { type: Number, default: 0 },
  basePrice: { type: Number, required: true, min: 0, default: 0 },
  gstApplicable: { type: Boolean, default: true },
  finalPrice: { type: Number, required: true, min: 0, default: 0 },
  stock: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SubAssembly', SubAssemblySchema);