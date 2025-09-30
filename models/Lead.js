// models/Lead.js
const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  productName: { type: String },
  quantity: { type: Number, default: 1 },
  note: { type: String }
}, { _id: false });

const NoteSchema = new mongoose.Schema({
  text: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const StatusHistorySchema = new mongoose.Schema({
  status: { type: String },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const CommunicationSchema = new mongoose.Schema({
  type: { type: String, enum: ['call','whatsapp','email','other'] },
  payload: { type: mongoose.Schema.Types.Mixed }, // store metadata (duration, message, etc)
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const LeadSchema = new mongoose.Schema({
  date: { type: Date, required: true }, // from sheet/manual form
  customer_name: { type: String, required: true },
  contact_number: { type: String, required: true },
  email_id: { type: String },
  city: { type: String },
  requirement: { type: String, required: true },
  // lead status: New, In Progress, Closed, etc.
  status: { type: String, default: 'New' },
  // source of the lead
  source: {
    type: String,
    enum: ['google_sheet', 'meta', 'indiamart', 'manual', 'excel_upload'],
    required: true
  },
  sourceMeta: { type: mongoose.Schema.Types.Mixed, default: {} }, // store raw row or extra data
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes: { type: [NoteSchema], default: [] },
  statusHistory: { type: [StatusHistorySchema], default: [] },
  communications: { type: [CommunicationSchema], default: [] },
  externalId: { type: String, index: true }, // optional id from external source
  whatsappNumberId: { type: String },
  hasReplied: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// update updatedAt
LeadSchema.pre('save', function(next){
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Lead', LeadSchema);
