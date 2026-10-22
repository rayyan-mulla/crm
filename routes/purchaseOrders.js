const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

router.get('/', purchaseOrderController.index);

router.get('/new', purchaseOrderController.newForm);

router.post('/', purchaseOrderController.create);

router.get('/:id/pdf', purchaseOrderController.downloadPdf);

router.get('/:id', purchaseOrderController.view);

router.get('/:id/edit', purchaseOrderController.editForm);
router.post('/:id', purchaseOrderController.update);

router.post('/:id/delete', purchaseOrderController.delete);

router.get('/:id/validate', purchaseOrderController.validateForm);
router.post('/:id/validate', purchaseOrderController.validate);
router.post('/:id/short-close', purchaseOrderController.shortClose);

module.exports = router;