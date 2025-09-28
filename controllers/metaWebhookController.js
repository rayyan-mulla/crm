const Lead = require('../models/Lead');
const axios = require('axios');

// GET /webhooks/meta (for Meta verification)
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Meta webhook verified successfully');
    return res.status(200).send(challenge);
  } else {
    console.warn('Meta webhook verification failed', { mode, token });
    return res.sendStatus(403);
  }
};

// POST /webhooks/meta (for new leads)
exports.handleWebhook = async (req, res) => {
  console.log("Incoming Meta webhook:", JSON.stringify(req.body, null, 2));
  try {
    if (req.body.object === 'page') {
      for (const entry of req.body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            const leadgenId = change.value.leadgen_id;

            // Fetch lead details
            const { data: leadData } = await axios.get(
              `https://graph.facebook.com/v23.0/${leadgenId}`,
              { params: { access_token: process.env.META_PAGE_ACCESS_TOKEN } }
            );

            // Map lead fields (adjust to match your form structure)
            const customerName = leadData.field_data.find(f => f.name === 'full_name')?.values?.[0] || 'Unknown';
            const contactNumber = leadData.field_data.find(f => f.name === 'phone_number')?.values?.[0] || '';
            const email = leadData.field_data.find(f => f.name === 'email')?.values?.[0] || '';

            await Lead.create({
              date: new Date(),
              customer_name: customerName,
              contact_number: contactNumber,
              email_id: email,
              requirement: 'Meta Lead',
              status: 'New',
              source: 'meta',
              sourceMeta: leadData,
              externalId: leadgenId
            });

            console.log('Saved Meta lead:', leadgenId, customerName);
          }
        }
      }
    }

    res.sendStatus(200); // Acknowledge to Meta quickly
  } catch (err) {
    console.error('Webhook error:', err.response?.data || err.message);
    res.sendStatus(200); // Still send 200 so Meta doesn’t retry endlessly
  }
};
