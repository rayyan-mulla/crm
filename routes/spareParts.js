const express = require('express');
const router = express.Router();
const controller = require('../controllers/sparePartsController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

router.get('/', controller.index);
router.get('/new', controller.newForm);
router.post('/', controller.create);

router.get('/:id/edit', controller.editForm);
router.post('/:id', controller.update);
router.post('/:id/delete', controller.destroy);

module.exports = router;