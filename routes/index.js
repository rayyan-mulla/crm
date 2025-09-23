const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../controllers/dashboardController'); // check this path

const { isLoggedIn } = require('../middlewares/auth');

router.get('/', isLoggedIn, dashboardCtrl.getDashboard); // getDashboard must exist
module.exports = router;
