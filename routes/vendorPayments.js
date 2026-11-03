// routes/vendorPayments.js

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/vendorPaymentController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

router.get('/', ctrl.index);
router.get('/new', ctrl.newForm);
router.post('/', ctrl.create);

router.get('/bills-by-vendor/:vendorId', ctrl.getBillsByVendor);

router.get('/:id', ctrl.view);
router.get('/:id/edit', ctrl.editForm);
router.post('/:id/update', ctrl.update);
router.post('/:id/delete', ctrl.delete);

module.exports = router;