const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');


router.get('/', vendorController.index);

router.get('/new', vendorController.newForm);

router.post('/', vendorController.create);

router.get('/:id/edit', vendorController.editForm);

router.post('/:id', vendorController.update);

router.post('/:id/delete', vendorController.destroy);


module.exports = router;