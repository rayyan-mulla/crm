const axios = require("axios");
const crypto = require("crypto");

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = (process.env.META_APP_SECRET || "").trim();

let USER_ACCESS_TOKEN = (process.env.META_USER_ACCESS_TOKEN || "").trim();
let PAGE_ACCESS_TOKEN = null;

// 🔐 Generate proof for secure API calls (Meta recommends this)
function getAppSecretProof(token) {
  if (!APP_SECRET) {
    throw new Error("Meta App Secret (META_APP_SECRET) is missing or not set in env");
  }
  return crypto.createHmac("sha256", APP_SECRET).update(token).digest("hex");
}

// 🔄 Refresh long-lived user token
async function refreshUserToken() {
  try {
    const resp = await axios.get("https://graph.facebook.com/v23.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: USER_ACCESS_TOKEN,
      },
    });

    if (resp.data?.access_token) {
      USER_ACCESS_TOKEN = resp.data.access_token;
      console.log("✅ Refreshed long-lived USER_ACCESS_TOKEN");
    }
    return USER_ACCESS_TOKEN;
  } catch (err) {
    console.error("❌ Failed to refresh user token:", err.response?.data || err.message);
    return null;
  }
}

// 🔄 Refresh page token from user token
async function refreshPageToken() {
  try {
    if (!USER_ACCESS_TOKEN) {
      await refreshUserToken();
    }

    const resp = await axios.get("https://graph.facebook.com/v23.0/me/accounts", {
      params: { access_token: USER_ACCESS_TOKEN },
    });

    if (resp.data?.data?.length > 0) {
      PAGE_ACCESS_TOKEN = resp.data.data[0].access_token;
      console.log(`✅ Got Page Access Token for: ${resp.data.data[0].name}`);
    } else {
      console.error("⚠️ No pages linked to this user token");
    }
    return PAGE_ACCESS_TOKEN;
  } catch (err) {
    console.error("❌ Failed to fetch page token:", err.response?.data || err.message);
    return null;
  }
}

function getUserToken() {
  return USER_ACCESS_TOKEN;
}
function getPageToken() {
  return PAGE_ACCESS_TOKEN;
}

module.exports = {
  getAppSecretProof,
  getUserToken,
  getPageToken,
  refreshUserToken,
  refreshPageToken,
};
