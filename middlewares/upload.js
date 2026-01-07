const multer = require('multer');
const fs = require('fs');
const path = require('path');

// ✅ Absolute path from the root of your project
// This ensures it works reliably across different GCP Cloud Run instances
const uploadDir = path.join(process.cwd(), 'uploads/whatsapp');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep filenames short and URL-friendly for Meta
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e4);
    cb(null, 'wa-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20MB is Meta's limit for most media
  }
});

module.exports = upload;