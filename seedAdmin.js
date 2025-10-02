require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function seedAdmin() {
  try {
    // Only connect if running directly
    if (require.main === module) {
      await mongoose.connect(process.env.MONGO_URI);
    }

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
  } finally {
    if (require.main === module) mongoose.disconnect();
  }
}

if (require.main === module) {
  seedAdmin().then(() => process.exit(0));
}

module.exports = seedAdmin;
