const express = require('express');
const router = express.Router();
const whatsappWebhookController = require('../controllers/whatsappWebhookController');

router.get('/', whatsappWebhookController.verifyWebhook);
router.post('/', express.json({ type: '*/*' }), whatsappWebhookController.handleWebhook);

module.exports = router;
