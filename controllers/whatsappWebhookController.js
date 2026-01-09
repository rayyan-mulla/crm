const Chat = require('../models/Chat');
const User = require('../models/User');
const Lead = require('../models/Lead');
const WhatsappNumber = require('../models/WhatsappNumber');
const formatPhoneE164 = require('../utils/formatPhoneE164');
const { getIO } = require('../socket');
const axios = require('axios');
const {
  getUserToken,
  refreshUserToken,
} = require('../utils/metaTokenManager');

const fs = require('fs');
const path = require('path');

async function sendWhatsappMessage(leadId, to, text) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead || !lead.whatsappNumberId) throw new Error("Lead not linked to a WhatsApp number");

  const formattedTo = formatPhoneE164(to);
  const url = `https://graph.facebook.com/v23.0/${lead.whatsappNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: "text",
    text: { body: text }
  };

  let token = getUserToken();
  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn("⚠️ WhatsApp token expired, refreshing...");
      token = await refreshUserToken();
      await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      });
    } else {
      throw err;
    }
  }

  const istDate = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});

  const chat = await Chat.create({
    lead: lead._id,
    direction: 'outbound',
    from: lead.whatsappNumberId,
    to,
    type: 'text',
    content: text,
    timestamp: new Date(istDate)
  });

  // 👇 emit to that lead’s room
  try {
    const io = getIO();
    io.to(leadId.toString()).emit('newMessage', chat);
  } catch (e) {
    console.warn("⚠️ Socket emit failed:", e.message);
  }

  console.log(`✅ Sent WhatsApp message via ${lead.whatsappNumberId} to ${to}`);
}

async function sendWhatsappImage(leadId, to, mediaUrl, caption = "") {
  const lead = await Lead.findById(leadId).lean();
  if (!lead || !lead.whatsappNumberId) throw new Error("Lead not linked");

  const url = `https://graph.facebook.com/v23.0/${lead.whatsappNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: formatPhoneE164(to),
    type: "image",
    image: { 
      link: mediaUrl, 
      caption: String(caption || "") 
    }
  };

  let token = getUserToken();
  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    console.log(`✅ Success: WhatsApp image sent to ${to}. Message ID: ${res.data.messages[0].id}`);
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn("⚠️ Token expired, refreshing and retrying...");
      token = await refreshUserToken();
      await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    } else {
      console.error("❌ WhatsApp Image Send Failed:", JSON.stringify(err.response?.data || err.message, null, 2));
      throw err;
    }
  }

  const istDate = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});

  return await Chat.create({
    lead: lead._id, direction: "outbound", from: lead.whatsappNumberId,
    to, type: "image", content: mediaUrl, caption, timestamp: new Date(istDate)
  });
}

async function sendWhatsappTemplate(leadId, to, templateName, languageCode = 'en_US', components = []) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead || !lead.whatsappNumberId) throw new Error("Lead not linked to a WhatsApp number");

  const formattedTo = formatPhoneE164(to);
  const url = `https://graph.facebook.com/v23.0/${lead.whatsappNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components }
  };

  let token = getUserToken();
  try {
    await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn("⚠️ WhatsApp token expired, refreshing...");
      token = await refreshUserToken();
      await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      });
    } else {
      throw err;
    }
  }

  const istDate = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});

  const chat = await Chat.create({
    lead: lead._id,
    direction: 'outbound',
    from: lead.whatsappNumberId,
    to: formattedTo,
    type: 'template',
    content: templateName,
    raw: { language: languageCode, components },
    timestamp: new Date(istDate)
  });

  // 👇 emit to that lead’s room
  try {
    const io = getIO();
    io.to(leadId.toString()).emit('newMessage', chat);
  } catch (e) {
    console.warn("⚠️ Socket emit failed:", e.message);
  }

  console.log(`✅ Sent WhatsApp template '${templateName}' via ${lead.whatsappNumberId} to ${to}`);
}

async function sendWhatsappDocument(leadId, to, mediaUrl, filename, caption = "") {
  const lead = await Lead.findById(leadId).lean();
  const url = `https://graph.facebook.com/v23.0/${lead.whatsappNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formatPhoneE164(to),
    type: "document",
    document: { 
      link: mediaUrl, 
      filename, 
      caption: String(caption || "")
    }
  };

  let token = getUserToken();
  try {
    const res = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`✅ Success: WhatsApp document sent to ${to}. Message ID: ${res.data.messages[0].id}`);
  } catch (err) {
    if (err.response?.status === 401) {
      token = await refreshUserToken();
      await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
    } else {
      console.error("❌ WhatsApp Document Send Failed:", JSON.stringify(err.response?.data || err.message, null, 2));
      throw err;
    }
  }

  const istDate = new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"});

  return await Chat.create({
    lead: lead._id, direction: "outbound", from: lead.whatsappNumberId,
    to, type: "document", content: mediaUrl, filename, caption, timestamp: new Date(istDate)
  });
}

async function findOrCreateLeadByPhone(phone, wabaNumberId) {
  // Always normalize input to E.164 for storage
  const formattedPhone = formatPhoneE164(phone);

  // Generate possible variants for matching
  const variants = new Set([formattedPhone]);

  if (formattedPhone.startsWith('+91')) {
    const withoutPlus = formattedPhone.slice(1);    // 91XXXXXXXXXX
    const withoutZero = '0' + formattedPhone.slice(-10); // 0XXXXXXXXXX
    const doubleZero = '00' + formattedPhone.slice(1);   // 0091XXXXXXXXXX
    const local10 = formattedPhone.slice(-10);      // XXXXXXXXXX

    variants.add(withoutPlus);
    variants.add(local10);
    variants.add(withoutZero);
    variants.add(doubleZero);
  }

  // Try to find an existing lead by any variant
  let lead = await Lead.findOne({ contact_number: { $in: Array.from(variants) } }).exec();

  if (!lead) {
    // Create new lead if none exists
    lead = await Lead.create({
      date: new Date(),
      customer_name: 'WhatsApp User',
      contact_number: formattedPhone,  // ✅ always save in E.164
      email_id: '',
      requirement: 'WhatsApp Lead',
      status: 'New',
      source: 'manual',
      whatsappNumberId: wabaNumberId
    });
    console.log(`🆕 Created new lead for WhatsApp number ${formattedPhone}`);
  } else {
    // If found but stored in a non-E.164 format → update it
    if (lead.contact_number !== formattedPhone) {
      lead.contact_number = formattedPhone;
    }
    // If lead exists but not linked to this WABA number, update it
    if (!lead.whatsappNumberId) {
      lead.whatsappNumberId = wabaNumberId;
    }
    await lead.save();
  }

  return lead._id;
}

// GET /webhooks/whatsapp (verification)
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified successfully');
    return res.status(200).send(challenge);
  } else {
    console.warn('⚠️ WhatsApp webhook verification failed');
    return res.sendStatus(403);
  }
};

// POST /webhooks/whatsapp
exports.handleWebhook = async (req, res) => {
  console.log("📩 Incoming WhatsApp webhook:", JSON.stringify(req.body, null, 2));

  try {
    if (req.body.object === 'whatsapp_business_account') {
      for (const entry of req.body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const wabaNumberId = value.metadata?.phone_number_id;
          const displayNumber = value.metadata?.display_phone_number;

          const to = formatPhoneE164(displayNumber)

          for (const msg of value.messages || []) {
            const rawFrom = msg.from;
            const from = formatPhoneE164(rawFrom);
            const type = msg.type;
            let content = '';
            let mediaId = null;
            let caption = null;

            if (type === 'text') {
              content = msg.text.body;
            } else if (type === 'image') {
              mediaId = msg.image.id;
              caption = msg.image.caption || null;
              content = '[Image]';
            } else if (type === 'document') {
              mediaId = msg.document.id;
              caption = msg.document.caption || null;
              content = '[Document]';
            } else if (type === 'audio') {
              mediaId = msg.audio.id;
              content = '[Audio]';
            } else {
              content = `[${type}]`;
            }

            const leadId = await findOrCreateLeadByPhone(from, wabaNumberId);

            // 1. Convert Meta's UTC timestamp to an IST Date object
            const unixTimestamp = parseInt(msg.timestamp) * 1000;
            const messageDateUTC = new Date(unixTimestamp);

            // Convert to IST string and back to date object to "force" the offset
            const istString = messageDateUTC.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
            const istDate = new Date(istString);

            const chat = await Chat.create({
              lead: leadId,
              direction: 'inbound',
              from: from,
              to: to,
              wabaNumberId,
              type,
              content,
              mediaId,
              caption,
              raw: msg,
              timestamp: istDate
            });
            
            console.log("➡️ Updating lead:", leadId);

            // update lead lastInboundAt for session tracking
            console.log("Message Date:", istDate);
            const update = { lastInboundAt: istDate, hasReplied: true };
            const result = await Lead.findByIdAndUpdate(leadId, update, { new: true });

            if (!result) {
              console.warn("⚠️ Lead not found for ID:", leadId);
            } else {
              console.log("✅ Lead updated:", {
                id: result._id,
                hasReplied: result.hasReplied,
                lastInboundAt: result.lastInboundAt
              });
            }

            // 👇 emit to that lead’s room
            try {
              const io = getIO();
              io.to(leadId.toString()).emit('newMessage', chat);
            } catch (e) {
              console.warn("⚠️ Socket emit failed:", e.message);
            }

            console.log(`💾 Saved inbound WhatsApp msg via ${displayNumber} from ${from}`);
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ WhatsApp webhook error:", err.response?.data || err.message);
    res.sendStatus(200); // always ack
  }
};

exports.sendText = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      to,
      body,
      templateName,
      mediaType, // text | image | document
    } = req.body;

    const files = req.files || [];

    // If it's an image/doc, the 'body' from the form is actually the 'caption'
    const caption = (mediaType === 'image' || mediaType === 'document') ? body : "";

    const lead = await Lead.findById(id).lean();
    if (!lead) {
      return res.status(404).send('Lead not found');
    }

    const nowISTString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const nowIST = new Date(nowISTString);

    const sessionActive =
      lead.lastInboundAt &&
      (nowIST.getTime() - new Date(lead.lastInboundAt).getTime()) < 24 * 60 * 60 * 1000;

    // ============================
    // 🟢 ACTIVE SESSION
    // ============================
    if (sessionActive) {

      // ---------- TEXT ----------
      if (mediaType === 'text' && body) {
        await sendWhatsappMessage(id, to, body);
      }

      else if ((mediaType === 'image' || mediaType === 'document') && files.length) {
        const BASE_URL = 'https://crm.olivechairs.in';
        for (const file of files) {
          const mediaUrl = `${BASE_URL}/temp-media/${file.filename}`;
          console.log(`📤 Attempting to send ${mediaType} from URL: ${mediaUrl}`);

          const safeCaption = typeof caption === 'string' ? caption : ""; 

          if (mediaType === 'image') {
            const chat = await sendWhatsappImage(id, to, mediaUrl, safeCaption);
            getIO().to(id.toString()).emit('newMessage', chat);
          } else {
            const chat = await sendWhatsappDocument(id, to, mediaUrl, file.originalname, safeCaption);
            getIO().to(id.toString()).emit('newMessage', chat);
          }

          // Cleanup Log
          setTimeout(() => {
            if (fs.existsSync(file.path)) {
              fs.unlink(file.path, (err) => {
                if (err) console.error(`❌ Cleanup failed for ${file.filename}:`, err);
                else console.log(`🗑️ Ephemeral storage cleared: ${file.filename}`);
              });
            }
          }, 180000); 
        }
      }

      else {
        return res.status(400).send('Invalid message payload');
      }

      console.log(`✅ Sent ${mediaType} to ${to} (active session)`);
    }

    // ============================
    // 🔴 SESSION EXPIRED → TEMPLATE
    // ============================
    else {
      if (!templateName) {
        return res
          .status(400)
          .send('Template required when session is expired.');
      }

      const [name, lang] = templateName.split('||');

      console.log(
        `⚠️ No active session. Sending template '${name}' (${lang}) to ${to}`
      );

      await sendWhatsappTemplate(id, to, name, lang);
    }

    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('sendText error', err.response?.data || err.message);
    res.status(500).send('Failed to send WhatsApp message');
  }
};
