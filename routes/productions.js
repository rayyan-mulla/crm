const express = require('express');
const router = express.Router();
const productionController = require('../controllers/productionController');
const { isAdmin } = require('../middlewares/auth'); // assuming your auth setup name

router.get('/', isAdmin, productionController.index);
router.get('/new', isAdmin, productionController.renderForm);
router.post('/', isAdmin, productionController.saveProduction);

router.get('/:id', productionController.view);

router.get('/:id/edit', productionController.editForm);
router.post('/:id', productionController.update);

router.post('/:id/delete', productionController.delete);

module.exports = router;