const Lead = require('../models/Lead');
const ProformaInvoice = require('../models/ProformaInvoice');
const mongoose = require('mongoose');
const imageToBase64 = require('../utils/imageToBase64');
const pdfGenerator = require('../utils/pdfGenerator');

async function generatePiNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();

  const prefix = `PI-${month}-${year}-`;

  // Find last PI for this month/year (ACTIVE + DELETED)
  const lastPi = await ProformaInvoice.findOne({
    piNumber: { $regex: `^${prefix}` }
  })
    .sort({ piNumber: -1 }) // works because of zero-padding
    .select('piNumber')
    .lean();

  let nextSeq = 1;

  if (lastPi?.piNumber) {
    const lastSeq = parseInt(lastPi.piNumber.split('-').pop(), 10);
    nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

exports.createForm = async (req, res) => {
  const leadId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    return res.status(400).send('Invalid lead');
  }

  const lead = await Lead.findById(leadId)
    .populate('normalizedRequirements.chair')
    .lean();

  if (!lead) return res.status(404).send('Lead not found');

  res.render('pi/create', {
    lead,
    user: req.session.user,
    activePage: 'proformaInvoice',
    showBack: true
  });
};

exports.create = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('normalizedRequirements.chair')
      .lean();

    if (!lead) return res.status(404).send('Lead not found');
    if (!lead.normalizedRequirements?.length) {
      return res.status(400).send('No requirements found');
    }

    const piNumber = await generatePiNumber();

    const COMPANY_STATE = 'Maharashtra';
    const gstEnabled = !!req.body.gstEnabled;
    const sameAsBilling = !!req.body.sameAsBilling;

    const billingState = (req.body.billing?.state || '').trim();

    const gstType = gstEnabled
      ? (billingState === COMPANY_STATE ? 'CGST_SGST' : 'IGST')
      : 'NONE';

    const shippingAddress = sameAsBilling
      ? req.body.billing
      : req.body.shipping;

    const items = lead.normalizedRequirements.map(r => {
      const color = r.chair.colors.find(
        c => c._id.toString() === r.colorId.toString()
      );

      return {
        chairModel: r.chair.modelName,
        colorId: r.colorId,            
        colorName: color?.name || '-',
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        shippingUnit: r.shippingUnit
      };
    });

    const taxableAmount = items.reduce(
      (sum, i) => sum + ((i.unitPrice + i.shippingUnit) * i.quantity),
      0
    );

    const gstBreakup = { igst: 0, cgst: 0, sgst: 0 };

    if (gstEnabled) {
      if (gstType === 'IGST') {
        gstBreakup.igst = taxableAmount * 0.18;
      } else {
        gstBreakup.cgst = taxableAmount * 0.09;
        gstBreakup.sgst = taxableAmount * 0.09;
      }
    }

    const gstAmount =
      gstBreakup.igst + gstBreakup.cgst + gstBreakup.sgst;

    const pi = await ProformaInvoice.create({
      lead: lead._id,
      piNumber,
      billingAddress: req.body.billing,
      shippingAddress,
      gstEnabled,
      gstType,
      gstBreakup,
      items,
      taxableAmount,
      gstAmount,
      grandTotal: taxableAmount + gstAmount,
      paymentMode: req.body.paymentMode,
      estimatedDelivery: req.body.estimatedDelivery,
      notes: req.body.notes,
      createdBy: new mongoose.mongo.ObjectId(req.session.user.id)
    });

    res.redirect(`/leads/${lead._id}/pi`);
  } catch (err) {
    console.error('PI CREATE ERROR:', err);
    res.status(500).send(err.message);
  }
};

exports.history = async (req, res) => {
  try {
    const leadId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).send('Invalid lead ID');
    }

    const lead = await Lead.findById(leadId).lean();
    if (!lead) return res.status(404).send('Lead not found');

    const piHistory = await ProformaInvoice.find({ lead: leadId })
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 })
      .lean();

    const user = req.session.user;

    const canCreateOrEditPI =
      user?.role === 'admin' ||
      (lead.assignedTo && String(lead.assignedTo) === String(user?.id));

    res.render('pi/history', {
      lead,
      piHistory,
      user,
      canCreateOrEditPI,
      activePage: 'proformaInvoice',
      showBack: true
    });
  } catch (err) {
    console.error('PI HISTORY ERROR:', err);
    res.status(500).send('Failed to load PI history');
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const { piId } = req.params;

    const pi = await ProformaInvoice.findById(piId)
      .populate('lead')
      .populate('createdBy', 'fullName')
      .lean();

    if (!pi) return res.status(404).send('PI not found');

    const logoBase64 = imageToBase64('images/logo.png');
    const signBase64 = imageToBase64('images/sign.png');

    await pdfGenerator.generatePdf({
      res,
      template: 'pdf',
      templateData: {
        pi,
        logoBase64,
        signBase64,
        documentType: 'PROFORMA_INVOICE'
      },
      filename: `${pi.piNumber}.pdf`,
      headerTitle: 'PROFORMA INVOICE'
    });

  } catch (err) {
    console.error('PI PDF ERROR:', err);
    res.status(500).send(err.message);
  }
};

exports.editForm = async (req, res) => {
  const { leadId, piId } = req.params;

  const pi = await ProformaInvoice.findById(piId).lean();
  if (!pi) return res.status(404).send('PI not found');

  const lead = await Lead.findById(leadId).lean();
  if (!lead) return res.status(404).send('Lead not found');

  const user = req.session.user;

  // 🔐 Permission check
  const isAdmin = user.role === 'admin';
  const isAssignedUser =
    lead.assignedTo &&
    user?.id &&
    lead.assignedTo.toString() === user.id.toString();

  if (!isAdmin && !isAssignedUser) {
    return res.status(403).send('Not authorized to edit this PI');
  }

  res.render('pi/edit', {
    pi,
    lead,
    user,
    activePage: 'proformaInvoice',
    showBack: true
  });
};

exports.update = async (req, res) => {
  try {
    const { leadId, piId } = req.params;

    const pi = await ProformaInvoice.findById(piId);
    if (!pi) return res.status(404).send('PI not found');

    // ⛔ Prevent editing deleted PI
    if (pi.status === 'DELETED') {
      return res.status(400).send('Deleted PI cannot be edited');
    }

    const lead = await Lead.findById(leadId).lean();
    if (!lead) return res.status(404).send('Lead not found');

    const user = req.session.user;

    const isAdmin = user.role === 'admin';
    const isAssignedUser =
      lead.assignedTo &&
      lead.assignedTo.toString() === user._id.toString();

    if (!isAdmin && !isAssignedUser) {
      return res.status(403).send('Not authorized');
    }

    /* ===============================
       ADDRESS UPDATES
    =============================== */
    pi.billingAddress = req.body.billing;

    const sameAsBilling = !!req.body.sameAsBilling;
    pi.shippingAddress = sameAsBilling
      ? req.body.billing
      : req.body.shipping;

    /* ===============================
       GST LOGIC (RECALCULATED)
    =============================== */
    const COMPANY_STATE = 'Maharashtra';
    const gstEnabled = !!req.body.gstEnabled;
    pi.gstEnabled = gstEnabled;

    const billingState = (req.body.billing?.state || '').trim();

    pi.gstType = gstEnabled
      ? billingState === COMPANY_STATE
        ? 'CGST_SGST'
        : 'IGST'
      : 'NONE';

    /* ===============================
       RE-CALCULATE TOTALS
    =============================== */
    const taxableAmount = pi.items.reduce(
      (sum, i) => sum + ((i.unitPrice + i.shippingUnit) * i.quantity),
      0
    );

    const gstBreakup = { igst: 0, cgst: 0, sgst: 0 };

    if (gstEnabled) {
      if (pi.gstType === 'IGST') {
        gstBreakup.igst = taxableAmount * 0.18;
      } else if (pi.gstType === 'CGST_SGST') {
        gstBreakup.cgst = taxableAmount * 0.09;
        gstBreakup.sgst = taxableAmount * 0.09;
      }
    }

    const gstAmount =
      gstBreakup.igst + gstBreakup.cgst + gstBreakup.sgst;

    pi.taxableAmount = taxableAmount;
    pi.gstBreakup = gstBreakup;
    pi.gstAmount = gstAmount;
    pi.grandTotal = taxableAmount + gstAmount;

    /* ===============================
       META FIELDS
    =============================== */
    pi.paymentMode = req.body.paymentMode;
    pi.estimatedDelivery = req.body.estimatedDelivery;
    pi.notes = req.body.notes;

    await pi.save();

    res.redirect(`/leads/${leadId}/pi`);
  } catch (err) {
    console.error('PI UPDATE ERROR:', err);
    res.status(500).send(err.message);
  }
};

exports.delete = async (req, res) => {
  const { leadId, piId } = req.params;
  const { deleteReason } = req.body;
  const user = req.session.user;

  if (user.role !== 'admin') {
    return res.status(403).send('Only admin can delete PI');
  }

  if (!deleteReason?.trim()) {
    return res.status(400).send('Delete reason is required');
  }

  await ProformaInvoice.findByIdAndUpdate(piId, {
    status: 'DELETED',
    deletedAt: new Date(),
    deleteReason: deleteReason.trim()
  });

  res.redirect(`/leads/${leadId}/pi`);
};