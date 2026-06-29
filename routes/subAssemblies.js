const express = require('express');
const router = express.Router();
const controller = require('../controllers/subAssemblyController');
const { isAdmin } = require('../middlewares/auth');

router.use(isAdmin);

// List
router.get('/', controller.index);

// New
router.get('/new', controller.newForm);
router.post('/', controller.create);

// Edit
router.get('/:id/edit', controller.editForm);
router.post('/:id', controller.update);

// Delete
router.post('/:id/delete', controller.destroy);

module.exports = router;