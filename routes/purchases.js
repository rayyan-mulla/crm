const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

router.get('/', purchaseController.index);

router.get('/new', purchaseController.newForm);

router.post('/', purchaseController.create);

router.get('/:id/pdf', purchaseController.downloadPdf);

router.get('/:id', purchaseController.view);

router.get('/:id/edit', purchaseController.editForm);
router.post('/:id', purchaseController.update);

router.post('/:id/delete', purchaseController.delete);

router.get('/:id/validate', purchaseController.validateForm);
router.post('/:id/validate', purchaseController.validate);

module.exports = router;