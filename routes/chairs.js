const express = require('express');
const router = express.Router();
const chairController = require('../controllers/chairController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

// List
router.get('/', chairController.index);

// New
router.get('/new', chairController.newForm);
router.post('/', chairController.create);

// Edit
router.get('/:id/edit', chairController.editForm);
router.post('/:id', chairController.update);

// Delete chair
router.post('/:id/delete', chairController.destroy);

// Delete a single color
router.post('/:id/colors/:colorId/delete', chairController.deleteColor);

module.exports = router;
