require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const flash = require('connect-flash');

const seedAdmin = require('./seedAdmin');
const seedWhatsappNumbers = require('./seedWhatsappNumbers');

const app = express();

// Environment variables
const PORT = process.env.PORT || 8080;

// --- MongoDB connection ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'olivecrmsecret',
  resave: false,
  saveUninitialized: false
}));
app.use(flash());

// --- View Engine ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// --- Routes ---
const indexRouter = require('./routes/index');
const leadsRouter = require('./routes/leads');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const metaWebhookRouter = require('./routes/metaWebhook');
const whatsappWebhookRoutes = require('./routes/whatsappWebhook');

app.use('/', indexRouter);
app.use('/leads', leadsRouter);
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/webhooks/meta', metaWebhookRouter);
app.use('/webhooks/whatsapp', whatsappWebhookRoutes);

// --- Seeds at startup ---
(async () => {
  try {
    await seedAdmin();
    console.log("🌱 seedAdmin finished");
  } catch (err) {
    console.warn("⚠️ seedAdmin failed:", err.message);
  }

  try {
    await seedWhatsappNumbers();
    console.log("🌱 seedWhatsappNumbers finished");
  } catch (err) {
    console.warn("⚠️ seedWhatsappNumbers failed:", err.message);
  }

  // Schedule WhatsApp numbers refresh every 6 hours
  setInterval(async () => {
    try {
      console.log("⏳ Refreshing WhatsApp numbers...");
      await seedWhatsappNumbers();
      console.log("✅ WhatsApp numbers refreshed");
    } catch (err) {
      console.warn("⚠️ Failed to refresh WhatsApp numbers:", err.message);
    }
  }, 6 * 60 * 60 * 1000); // every 6 hours
})();

// --- 404 handler ---
app.use((req, res, next) => {
  res.status(404).send('404 - Page Not Found');
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).send('Internal Server Error');
});

// --- Start server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
