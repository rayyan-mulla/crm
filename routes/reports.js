const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { isLoggedIn } = require('../middlewares/auth');

router.get('/', isLoggedIn, reportsController.getReports);
router.get('/pdf', isLoggedIn, reportsController.exportReportsPDF);

module.exports = router;