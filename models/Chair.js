const mongoose = require('mongoose');

const ColorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  basePrice: { type: Number, required: true, min: 0 },
  gstApplicable: { type: Boolean, default: false },
  finalPrice: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true },
  stock: { type: Number, default: 0 }
}, { _id: true, timestamps: true });

const ComponentSchema = new mongoose.Schema({
  componentType: { type: String, enum: ['sparePart', 'subAssembly'], required: true },
  item: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'components.componentModel' },
  componentModel: { type: String, enum: ['SparePart', 'SubAssembly'], required: true },
  quantity: { type: Number, required: true, min: 1 }
}, { _id: true });

const ChairSchema = new mongoose.Schema({
  modelName: { type: String, required: true, trim: true, unique: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', required: true },
  hsnCode: { type: String, trim: true, default: '94036000' },
  colors: { type: [ColorSchema], default: [] },
  components: { type: [ComponentSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Chair', ChairSchema);
