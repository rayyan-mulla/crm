const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  line1: String,
  line2: String,

  city: String,
  state: String,
  pincode: String,
}, { _id: false });


const VendorSchema = new mongoose.Schema({

  name: {
    type: String,
    required: true,
    trim: true
  },

  contactPerson: {
    type: String,
    trim: true
  },

  phone: String,

  email: String,

  gstin: String,

  address: AddressSchema,

  isActive: {
    type: Boolean,
    default: true
  },

  balance: { type: Number, default: 0 }

}, { timestamps: true });

module.exports = mongoose.model('Vendor', VendorSchema);