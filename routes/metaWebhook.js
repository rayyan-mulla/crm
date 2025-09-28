const express = require('express');
const router = express.Router();
const metaWebhookController = require('../controllers/metaWebhookController');

// GET for verification
router.get('/', metaWebhookController.verifyWebhook);

// POST for leadgen payloads
router.post('/', express.json({ type: '*/*' }), metaWebhookController.handleWebhook);

module.exports = router;
