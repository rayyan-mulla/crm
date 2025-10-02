// seedWhatsappNumbers.js
require('dotenv').config();
const WhatsappNumber = require('./models/WhatsappNumber');
const axios = require('axios');

const WABA_ID = process.env.META_WABA_ID;
const ACCESS_TOKEN = process.env.META_USER_ACCESS_TOKEN;

async function seedWhatsappNumbers() {
  try {
    if (!WABA_ID || !ACCESS_TOKEN) {
      console.error("❌ META_WABA_ID and META_USER_ACCESS_TOKEN must be set in .env");
      return;
    }

    console.log("🌐 Fetching WhatsApp numbers from Meta...");
    const url = `https://graph.facebook.com/v23.0/${WABA_ID}/phone_numbers`;
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
    });

    if (!data.data || !data.data.length) {
      console.log("⚠️ No phone numbers found in this WABA.");
      return;
    }

    for (const num of data.data) {
      const existing = await WhatsappNumber.findOne({ phone_number_id: num.id });
      if (existing) {
        console.log(`ℹ️ Already exists: ${num.display_phone_number}`);
        continue;
      }

      await WhatsappNumber.create({
        phone_number_id: num.id,
        display_number: num.display_phone_number,
        label: num.verified_name || 'Unlabeled',
        business_account_id: WABA_ID,
        isActive: true
      });

      console.log(`✅ Inserted: ${num.display_phone_number} (${num.id})`);
    }

    console.log("🎉 WhatsApp number seeding complete!");
  } catch (err) {
    console.error("❌ Error seeding WhatsApp numbers:", err.response?.data || err.message);
  }
}

// If run directly (node seedWhatsappNumbers.js)
if (require.main === module) {
  const mongoose = require('mongoose');

  (async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      await seedWhatsappNumbers();
    } finally {
      mongoose.disconnect();
    }
    process.exit(0);
  })();
}

module.exports = seedWhatsappNumbers;
