const Lead = require('../models/Lead');
const axios = require('axios');
const {
  getAppSecretProof,
  getUserToken,
  getPageToken,
  refreshUserToken,
  refreshPageToken,
} = require('../utils/metaTokenManager');

// GET /webhooks/meta (verification)
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Meta webhook verified');
    return res.status(200).send(challenge);
  } else {
    console.warn('⚠️ Meta webhook verification failed');
    return res.sendStatus(403);
  }
};

// POST /webhooks/meta (leadgen)
exports.handleWebhook = async (req, res) => {
  console.log("📩 Meta webhook:", JSON.stringify(req.body, null, 2));

  try {
    if (req.body.object === 'page') {
      for (const entry of req.body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            const leadgenId = change.value.leadgen_id;

            // ensure page token is valid
            if (!getPageToken()) {
              await refreshPageToken();
            }

            const token = getPageToken();
            const appsecretProof = getAppSecretProof(token);

            const { data: leadData } = await axios.get(
              `https://graph.facebook.com/v23.0/${leadgenId}`,
              { params: { access_token: token, appsecret_proof: appsecretProof } }
            );

            const customerName =
              leadData.field_data.find(f => f.name === 'full_name')?.values?.[0] || 'Unknown';
            const contactNumber =
              leadData.field_data.find(f => f.name === 'phone_number')?.values?.[0] || '';
            const email =
              leadData.field_data.find(f => f.name === 'email')?.values?.[0] || '';
            const requirement =
              leadData.field_data.find(f => f.name === 'order_details_and_requirements')?.values?.[0] || '';
            const city =
              leadData.field_data.find(f => f.name === 'city')?.values?.[0] || '';

            await Lead.create({
              date: new Date(),
              customer_name: customerName,
              contact_number: contactNumber,
              email_id: email,
              city,
              requirement,
              status: 'New',
              source: 'meta',
              sourceMeta: leadData,
              externalId: leadgenId,
            });

            console.log(`💾 Saved Meta lead ${leadgenId} (${customerName})`);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Meta webhook error:', err.response?.data || err.message);

    if (err.response?.data?.error?.code === 190) {
      console.warn("⚠️ Token invalid, refreshing...");
      await refreshUserToken();
      await refreshPageToken();
    }

    res.sendStatus(200);
  }
};
