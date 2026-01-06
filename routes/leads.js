// routes/leads.js
const express = require('express');
const router = express.Router();
const leadCtrl = require('../controllers/leadController');
const whatsappCtrl = require('../controllers/whatsappWebhookController');
const piController = require('../controllers/piController');
const { isLoggedIn, isAdmin } = require('../middlewares/auth');
const Lead = require('../models/Lead')
const upload = require('../middlewares/upload');

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

router.post('/bulk-delete', isAdmin, leadCtrl.bulkDeleteLeads);

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

router.post('/:id/whatsapp/send-text', isLoggedIn, upload.array('mediaFile', 10), whatsappCtrl.sendText);

// Add new
router.get("/:id/requirement/add", isLoggedIn, leadCtrl.requirementForm);
router.post("/:id/requirement/add", isLoggedIn, leadCtrl.saveRequirement);

// Edit existing
router.get("/:id/requirement/:reqId/edit", isLoggedIn, leadCtrl.requirementForm);
router.post("/:id/requirement/:reqId/edit", isLoggedIn, leadCtrl.saveRequirement);

// Delete
router.post("/:id/requirement/:reqId/delete", isLoggedIn, leadCtrl.deleteRequirement);

// Add this new route
router.post('/:id/alternate-number', isLoggedIn, leadCtrl.saveAlternateNumber);

router.post('/:id/quantity', isLoggedIn, leadCtrl.saveQuantity);

router.post('/:id/customer-type', isLoggedIn, leadCtrl.saveCustomerType);

router.get('/export/pdf', isLoggedIn, leadCtrl.exportLeadsPdf);

router.get('/export/excel', isLoggedIn, leadCtrl.exportLeadsExcel);

router.get('/:id/pi', isLoggedIn, piController.history);

router.get('/:id/pi/create', isLoggedIn, piController.createForm);

router.post('/:id/pi/create', isLoggedIn, piController.create);

router.get('/:id/pi/:piId/pdf', isLoggedIn, piController.downloadPdf);

router.get('/:leadId/pi/:piId/edit', isAdmin, piController.editForm);

router.post('/:leadId/pi/:piId/edit', isAdmin, piController.update);

router.post('/:leadId/pi/:piId/delete', isAdmin, piController.delete);

module.exports = router;
