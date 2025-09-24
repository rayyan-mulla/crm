require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function run() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment');
    }

    await mongoose.connect(mongoUri);

    const existing = await User.findOne({ username: 'admin' });
    if (existing) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    const admin = new User({
      fullName: 'Super Admin',
      username: 'admin',
      email: 'admin@example.com',
      password: 'admin123',
      role: 'admin'
    });

    await admin.save();
    console.log('Admin created');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding admin:', err);
    process.exit(1);
  }
}

run();
