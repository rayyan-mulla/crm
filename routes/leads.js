// routes/leads.js
const express = require('express');
const router = express.Router();
const leadCtrl = require('../controllers/leadController');
const whatsappCtrl = require('../controllers/whatsappWebhookController');
const { isLoggedIn, isAdmin } = require('../middlewares/auth');
const Lead = require('../models/Lead')

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

router.post('/:id/delete', isAdmin, leadCtrl.deleteLead);

// assign (admin)
router.post('/:id/assign', isAdmin, leadCtrl.assignLead);

router.post('/bulk-assign', isAdmin, leadCtrl.bulkAssignLeads);

// update status (assigned user or admin)
router.post('/:id/status', isLoggedIn, leadCtrl.updateStatus);

// add note
router.post('/:id/note', isLoggedIn, leadCtrl.addNote);

router.post('/:id/whatsapp-number', isLoggedIn, async (req, res) => {
  const { id } = req.params;
  const { whatsappNumberId } = req.body;
  await Lead.findByIdAndUpdate(id, { whatsappNumberId });
  res.redirect(`/leads/${id}`);
});

router.post('/:id/whatsapp/send-text', isLoggedIn, whatsappCtrl.sendText);

// Add new
router.get("/:id/requirement/add", isLoggedIn, leadCtrl.requirementForm);
router.post("/:id/requirement/add", isLoggedIn, leadCtrl.saveRequirement);

// Edit existing
router.get("/:id/requirement/:reqId/edit", isLoggedIn, leadCtrl.requirementForm);
router.post("/:id/requirement/:reqId/edit", isLoggedIn, leadCtrl.saveRequirement);

// Add this new route
router.post('/:id/alternate-number', isLoggedIn, leadCtrl.saveAlternateNumber);

module.exports = router;
