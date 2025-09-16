// seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User'); // adjust path if needed

async function run() {
  try {
    await mongoose.connect('mongodb://localhost:27017/crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const existing = await User.findOne({ username: 'admin' });
    if (existing) {
      console.log('⚠️ Admin user already exists');
      process.exit();
    }

    const admin = new User({
      fullName: 'Super Admin',
      username: 'admin',
      email: 'admin@example.com',
      password: 'admin123', // will be hashed by User model
      role: 'admin'
    });

    await admin.save();
    console.log('✅ Admin created: username=admin, password=admin123');
    process.exit();
  } catch (err) {
    console.error('❌ Error seeding admin:', err);
    process.exit(1);
  }
}

run();
