const Lead = require('../models/Lead');
const axios = require('axios');
const crypto = require('crypto');

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = (process.env.META_APP_SECRET || '').trim();

// Store both user + page token in memory
let USER_ACCESS_TOKEN = (process.env.META_USER_ACCESS_TOKEN || '').trim(); // Long-lived user token from Secret Manager
let PAGE_ACCESS_TOKEN = null;

// Helper: generate appsecret_proof for secure API calls
function getAppSecretProof(token) {
  if (!APP_SECRET) {
    throw new Error("Meta App Secret (META_APP_SECRET) is missing or not set in env");
  }
  return crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
}

// Helper: Refresh the long-lived user token
async function refreshUserToken() {
  try {
    const resp = await axios.get(`https://graph.facebook.com/v23.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: USER_ACCESS_TOKEN
      }
    });

    if (resp.data?.access_token) {
      USER_ACCESS_TOKEN = resp.data.access_token;
      console.log("✅ Refreshed long-lived user token (valid ~60 days)");
      return USER_ACCESS_TOKEN;
    }
  } catch (err) {
    console.error("❌ Failed to refresh user token:", err.response?.data || err.message);
  }
  return null;
}

// Helper: Get page access token from user token
async function refreshPageToken() {
  try {
    if (!USER_ACCESS_TOKEN) {
      console.warn("⚠️ No USER_ACCESS_TOKEN available, attempting refresh...");
      await refreshUserToken();
    }

    const resp = await axios.get(`https://graph.facebook.com/v23.0/me/accounts`, {
      params: { access_token: USER_ACCESS_TOKEN }
    });

    if (resp.data?.data?.length > 0) {
      // If multiple pages, pick the first one (or filter by id if you know it)
      PAGE_ACCESS_TOKEN = resp.data.data[0].access_token;
      console.log(`✅ Got Page Access Token for page: ${resp.data.data[0].name}`);
      return PAGE_ACCESS_TOKEN;
    } else {
      console.error("❌ No pages found for this user token.");
    }
  } catch (err) {
    console.error("❌ Failed to fetch page token:", err.response?.data || err.message);
  }
  return null;
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

            // Ensure page token is valid
            if (!PAGE_ACCESS_TOKEN) {
              await refreshPageToken();
            }

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

    // If token invalid (code 190), refresh user token → page token
    if (err.response?.data?.error?.code === 190) {
      console.warn("⚠️ Token invalid, refreshing...");
      await refreshUserToken();
      await refreshPageToken();
    }

    res.sendStatus(200); // Always respond 200 so Meta doesn’t retry
  }
};
