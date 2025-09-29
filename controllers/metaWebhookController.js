const Lead = require('../models/Lead');
const axios = require('axios');
const crypto = require('crypto');

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
let PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN; // fallback if refresh fails

// Helper: generate appsecret_proof for secure API calls
function getAppSecretProof(token) {
  return crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
}

// Helper: refresh the page token using long-lived token flow
async function refreshPageToken() {
  try {
    // Exchange Page token → Long-lived User token
    const resp = await axios.get(`https://graph.facebook.com/v23.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: PAGE_ACCESS_TOKEN
      }
    });

    if (resp.data && resp.data.access_token) {
      PAGE_ACCESS_TOKEN = resp.data.access_token;
      console.log("✅ Refreshed Page Token");
    }
  } catch (err) {
    console.error("❌ Failed to refresh Page token:", err.response?.data || err.message);
  }
}

// GET /webhooks/meta (for Meta verification)
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Meta webhook verified successfully');
    return res.status(200).send(challenge);
  } else {
    console.warn('⚠️ Meta webhook verification failed', { mode, token });
    return res.sendStatus(403);
  }
};

// POST /webhooks/meta (for new leads)
exports.handleWebhook = async (req, res) => {
  console.log("📩 Incoming Meta webhook:", JSON.stringify(req.body, null, 2));

  try {
    if (req.body.object === 'page') {
      for (const entry of req.body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            const leadgenId = change.value.leadgen_id;

            // Ensure token is valid (try refresh if needed)
            if (!PAGE_ACCESS_TOKEN) await refreshPageToken();

            const appsecretProof = getAppSecretProof(PAGE_ACCESS_TOKEN);

            // Fetch lead details securely
            const { data: leadData } = await axios.get(
              `https://graph.facebook.com/v23.0/${leadgenId}`,
              {
                params: {
                  access_token: PAGE_ACCESS_TOKEN,
                  appsecret_proof: appsecretProof
                }
              }
            );

            // Extract fields
            const customerName =
              leadData.field_data.find(f => f.name === 'full_name')?.values?.[0] || 'Unknown';
            const contactNumber =
              leadData.field_data.find(f => f.name === 'phone_number')?.values?.[0] || '';
            const email =
              leadData.field_data.find(f => f.name === 'email')?.values?.[0] || '';

            // Save to DB
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

            console.log(`💾 Saved Meta lead: ${leadgenId} (${customerName})`);
          }
        }
      }
    }

    res.sendStatus(200); // acknowledge
  } catch (err) {
    console.error('❌ Webhook error:', err.response?.data || err.message);

    // If token invalid, refresh and try again once
    if (err.response?.data?.error?.code === 190) {
      console.warn("⚠️ Token invalid, refreshing...");
      await refreshPageToken();
    }

    res.sendStatus(200); // Always respond 200 so Meta doesn’t retry
  }
};
