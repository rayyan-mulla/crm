// models/WhatsappNumber.js
const mongoose = require('mongoose');

const whatsappNumberSchema = new mongoose.Schema({
  phone_number_id: {
    type: String,
    required: true,
    unique: true // each business number has a unique ID
  },
  display_number: {
    type: String,
    required: true // e.g. "+1 555-123-4567"
  },
  label: {
    type: String,
    default: '' // e.g. "Sales India", "Support US"
  },
  business_account_id: {
    type: String,
    default: '' // optional: Meta Business Account id
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WhatsappNumber', whatsappNumberSchema);
