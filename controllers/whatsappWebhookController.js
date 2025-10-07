const Chat = require('../models/Chat');
const User = require('../models/User');
const Lead = require('../models/Lead');
const WhatsappNumber = require('../models/WhatsappNumber');
const formatPhoneE164 = require('../utils/formatPhoneE164')
const axios = require('axios');
const {
  getUserToken,
  refreshUserToken,
} = require('../utils/metaTokenManager');

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

  await Chat.create({
    lead: lead._id,
    direction: 'outbound',
    from: lead.whatsappNumberId,
    to,
    type: 'text',
    content: text,
    timestamp: new Date()
  });

  console.log(`✅ Sent WhatsApp message via ${lead.whatsappNumberId} to ${to}`);
}

async function sendWhatsappImage(leadId, to, imageUrl, caption) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead || !lead.whatsappNumberId) throw new Error("Lead not linked to a WhatsApp number");

  const formattedTo = formatPhoneE164(to);
  const url = `https://graph.facebook.com/v23.0/${lead.whatsappNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedTo,
    type: "image",
    image: { link: imageUrl, caption }
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

  await Chat.create({
    lead: lead._id,
    direction: 'outbound',
    from: lead.whatsappNumberId,
    to,
    type: 'image',
    content: imageUrl,
    caption,
    timestamp: new Date()
  });

  console.log(`✅ Sent WhatsApp image via ${lead.whatsappNumberId} to ${to}`);
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

  await Chat.create({
    lead: lead._id,
    direction: 'outbound',
    from: lead.whatsappNumberId,
    to,
    type: 'template',
    content: templateName,
    timestamp: new Date()
  });

  console.log(`✅ Sent WhatsApp template '${templateName}' via ${lead.whatsappNumberId} to ${to}`);
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

          for (const msg of value.messages || []) {
            const from = msg.from;
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

            await Chat.create({
              lead: leadId,
              direction: 'inbound',
              from,
              to: displayNumber,
              wabaNumberId,
              type,
              content,
              mediaId,
              caption,
              raw: msg,
              timestamp: new Date(parseInt(msg.timestamp) * 1000)
            });
            
            console.log("➡️ Updating lead:", leadId);

            // update lead lastInboundAt for session tracking
            const messageDate = new Date(parseInt(msg.timestamp) * 1000);
            console.log("Message Date:", messageDate);
            const update = { lastInboundAt: messageDate, hasReplied: true };
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
    const { to, body, templateName } = req.body;

    const lead = await Lead.findById(id).lean();
    if (!lead) {
      return res.status(404).send('Lead not found');
    }

    const now = Date.now();
    const sessionActive = lead.lastInboundAt &&
      (now - new Date(lead.lastInboundAt).getTime()) < 24 * 60 * 60 * 1000;

    if (sessionActive && body) {
      await sendWhatsappMessage(id, to, body);
      console.log(`✅ Sent text to ${to} (active session)`);
    } else {
      if (!templateName) {
        return res.status(400).send("Template required when session is expired.");
      }

      // unpack template name + language
      const [name, lang] = templateName.split("||");

      console.log(`⚠️ No active session. Sending template '${name}' (${lang}) to ${to}.`);
      await sendWhatsappTemplate(id, to, name, lang);
    }

    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('sendText error', err.response?.data || err.message);
    res.status(500).send('Failed to send WhatsApp message');
  }
};
