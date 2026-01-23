const express = require('express');
const router = express.Router();

const taxInvoiceController = require('../controllers/taxInvoiceController');
const { isLoggedIn, isAdmin } = require('../middlewares/auth');

router.get('/:id/pdf', isLoggedIn, taxInvoiceController.downloadPdf);

router.post('/:id/delete', isAdmin, taxInvoiceController.deleteInvoice);

module.exports = router;
