require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const flash = require('connect-flash');
const http = require('http');           // 👈 required
const { init } = require('./socket');

const seedAdmin = require('./seedAdmin');
const seedWhatsappNumbers = require('./seedWhatsappNumbers');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app); // 👈 wrap express with http server
const io = init(server);

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
app.use('/temp-media', express.static(path.join(__dirname, 'uploads/whatsapp')));
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
const chairsRouter = require('./routes/chairs');
const sparePartsRouter = require('./routes/spareParts');
const sparePartCategoryRoutes = require('./routes/sparePartCategories');
const taxInvoiceRoutes = require('./routes/taxInvoice');
const reportsRouter = require('./routes/reports')

app.use('/', indexRouter);
app.use('/leads', leadsRouter);
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/webhooks/meta', metaWebhookRouter);
app.use('/webhooks/whatsapp', whatsappWebhookRoutes);
app.use('/raw-materials/chairs', chairsRouter);
app.use('/raw-materials/spare-parts', sparePartsRouter);
app.use('/raw-materials/spare-part-categories', sparePartCategoryRoutes);
app.use('/tax-invoice', taxInvoiceRoutes);
app.use('/reports', reportsRouter);

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

io.on('connection', (socket) => {
  console.log('🔌 User connected');

  socket.on('joinLeadRoom', (leadId) => {
    console.log(`📌 User joined lead room: ${leadId}`);
    socket.join(leadId);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected');
  });
});


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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
