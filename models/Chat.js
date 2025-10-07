// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  from: String,
  to: String,
  type: String, // text, image, document, audio, video, sticker, template, interactive
  content: String, // text body or link
  caption: String,
  filename: String,
  mediaId: String, // WhatsApp media id
  mimeType: String,
  waMessageId: String, // WhatsApp message id (for statuses)
  deliveryStatus: String, // delivered, read, failed
  statusAt: Date,
  statusRaw: Object,
  interactive: Object,
  contacts: Object,
  location: Object,
  raw: Object,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', chatSchema);
