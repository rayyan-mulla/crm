const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/whatsapp');
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

module.exports = upload; 