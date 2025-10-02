// seedAdmin.js
require('dotenv').config();
const User = require('./models/User');

async function seedAdmin() {
  try {
    const existing = await User.findOne({ username: 'admin' });
    if (existing) {
      console.log('ℹ️ Admin user already exists');
      return;
    }

    const admin = new User({
      fullName: 'Super Admin',
      username: 'admin',
      email: 'admin@example.com',
      password: 'admin123',
      role: 'admin'
    });

    await admin.save();
    console.log('✅ Admin created');
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
  }
}

// If run directly: connect + run + exit
if (require.main === module) {
  const mongoose = require('mongoose');

  (async () => {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      await seedAdmin();
    } finally {
      mongoose.disconnect();
    }
    process.exit(0);
  })();
}

module.exports = seedAdmin;
