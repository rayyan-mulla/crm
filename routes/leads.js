// routes/leads.js
const express = require('express');
const router = express.Router();
const leadCtrl = require('../controllers/leadController');
const { isLoggedIn, isAdmin } = require('../middlewares/auth');

// list leads (server-side filtering/pagination/sort)
router.get('/', isLoggedIn, leadCtrl.listLeads);

// manual create
router.get('/create', isLoggedIn, leadCtrl.getCreate);
router.post('/create', isLoggedIn, leadCtrl.postCreate);

// import from google (admin only)
router.get('/import/google', isAdmin, leadCtrl.importFromGoogle);

router.post("/import/excel", isAdmin, leadCtrl.uploadFromExcel);

router.get("/sample-excel", isAdmin, leadCtrl.sampleExcel);

// lead detail
router.get('/:id', isLoggedIn, leadCtrl.getLead);

// assign (admin)
router.post('/:id/assign', isAdmin, leadCtrl.assignLead);

// update status (assigned user or admin)
router.post('/:id/status', isLoggedIn, leadCtrl.updateStatus);

// add note
router.post('/:id/note', isLoggedIn, leadCtrl.addNote);

module.exports = router;
