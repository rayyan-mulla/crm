const Lead = require('../models/Lead');
const ProformaInvoice = require('../models/ProformaInvoice');
const TaxInvoice = require('../models/TaxInvoice');
const Chair = require('../models/Chair');
const imageToBase64 = require('../utils/imageToBase64');
const pdfGenerator = require('../utils/pdfGenerator');
const mongoose = require('mongoose');

async function generateInvoiceNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();

  const prefix = `INV-${month}-${year}-`;

  const lastInvoice = await TaxInvoice.findOne({
    invoiceNumber: { $regex: `^${prefix}` }
  })
    .sort({ invoiceNumber: -1 }) // works due to zero padding
    .select('invoiceNumber')
    .lean();

  let nextSeq = 1;

  if (lastInvoice?.invoiceNumber) {
    const lastSeq = parseInt(
      lastInvoice.invoiceNumber.split('-').pop(),
      10
    );
    nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

exports.generateFromPI = async (req, res) => {
  try {
    const { piId } = req.params;

    const pi = await ProformaInvoice.findById(piId);
    if (!pi) {
      return res.status(404).send('Proforma Invoice not found');
    }

    // Count existing tax invoices for this PI
    const invoiceCount = await TaxInvoice.countDocuments({
      piId: pi._id
    });

    // Your own numbering logic
    const invoiceNumber = await generateInvoiceNumber();

    const taxInvoice = await TaxInvoice.create({
      piId: pi._id,
      lead: pi.lead,
      invoiceNumber,
      invoiceSequence: invoiceCount + 1,

      billingAddress: pi.billingAddress,
      shippingAddress: pi.shippingAddress,

      gstEnabled: pi.gstEnabled,
      gstType: pi.gstType,
      gstBreakup: pi.gstBreakup,

      items: pi.items,
      taxableAmount: pi.taxableAmount,
      gstAmount: pi.gstAmount,
      grandTotal: pi.grandTotal,

      poNumber: pi.poNumber,
      paymentMode: pi.paymentMode,
      estimatedDelivery: pi.estimatedDelivery,
      installationType: pi.installationType,
      notes: pi.notes,

      createdBy: new mongoose.mongo.ObjectId(req.session.user.id)
    });

    // Open PDF directly
    return res.redirect(
      `/leads/${pi.lead}/pi/${pi._id}/invoices`
    );

  } catch (err) {
    console.error('Generate Tax Invoice Error:', err);
    return res.status(500).send('Failed to generate Tax Invoice');
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const invoice = await TaxInvoice.findById(req.params.id)
      .populate('lead')
      .populate('createdBy', 'fullName')
      .lean();

    if (!invoice) return res.status(404).send('Tax Invoice not found');

    const logoBase64 = imageToBase64('images/logo.png');
    const signBase64 = imageToBase64('images/sign.png');

    await pdfGenerator.generatePdf({
      res,
      template: 'pdf',
      templateData: {
        pi: invoice,
        logoBase64,
        signBase64,
        documentType: 'TAX_INVOICE'
      },
      filename: `${invoice.invoiceNumber}.pdf`,
      headerTitle: 'TAX INVOICE'
    });

  } catch (err) {
    console.error('TAX INVOICE PDF ERROR:', err);
    res.status(500).send(err.message);
  }
};

exports.invoiceHistory = async (req, res) => {
  const { leadId, piId } = req.params;

  const lead = await Lead.findById(leadId).lean();
  const pi = await ProformaInvoice.findById(piId).lean();

  if (!lead || !pi) {
    return res.status(404).send('Not found');
  }

  const invoices = await TaxInvoice.find({ piId })
    .populate('createdBy', 'fullName')
    .sort({ createdAt: -1 })
    .lean();

  const user = req.session.user;

  const canCreateInvoice =
    user.role === 'admin' ||
    (lead.assignedTo && String(lead.assignedTo) === String(user.id));

  res.render('invoice/history', {
    lead,
    pi,
    invoices,
    user,
    canCreateInvoice,
    activePage: 'proformaInvoice',
    showBack: true
  });
};

exports.editForm = async (req, res) => {
  try {
    const { leadId, invoiceId } = req.params;
    const user = req.session.user;

    // 🛡️ Admin check: Only admin can view the edit form for a Tax Invoice
    if (user?.role !== 'admin') {
      return res.status(403).send('Not authorized. Only administrators can edit Tax Invoices.');
    }

    const invoice = await TaxInvoice.findById(invoiceId).lean();
    if (!invoice) return res.status(404).send('Tax Invoice not found');

    if (invoice.status === 'DELETED') {
      return res.status(400).send('Deleted Tax Invoices cannot be modified.');
    }

    const lead = await Lead.findById(leadId).lean();
    if (!lead) return res.status(404).send('Lead not found');

    const chairs = await Chair.find().lean();

    // We pass the invoice document context to the view under variable name 'pi' 
    // so it perfectly matches your duplicated layout mechanics without changes.
    res.render('invoice/edit', {
      invoice: invoice, 
      lead,
      chairs,
      user,
      activePage: 'proformaInvoice',
      showBack: true
    });
  } catch (err) {
    console.error('TAX INVOICE EDIT FORM LOAD ERROR:', err);
    res.status(500).send('Internal Server Error');
  }
};

exports.update = async (req, res) => {
  try {
    const { leadId, piId, invoiceId } = req.params;
    const user = req.session.user;

    // 🛡️ Guard execution layer to admin only
    if (user?.role !== 'admin') {
      return res.status(403).send('Not authorized.');
    }

    const invoice = await TaxInvoice.findById(invoiceId);
    if (!invoice) return res.status(404).send('Tax Invoice not found');
    if (invoice.status === 'DELETED') {
      return res.status(400).send('Deleted Tax Invoices cannot be edited.');
    }

    // 1. Address Updates
    invoice.billingAddress = req.body.billing;
    const sameAsBilling = !!req.body.sameAsBilling;
    invoice.shippingAddress = sameAsBilling ? req.body.billing : req.body.shipping;

    // 2. Items Deep Snapshot Copy
    const itemsFromForm = Array.isArray(req.body.items)
      ? req.body.items
      : Object.values(req.body.items || {});

    const existingItemsById = new Map(
      invoice.items.map(item => [
        String(item._id),
        { shippingUnit: item.shippingUnit || 0 }
      ])
    );

    invoice.items = [];

    for (const i of itemsFromForm) {
      if (!i.chairId || !i.colorId) continue;

      const chair = await Chair.findById(i.chairId).lean();
      if (!chair) continue;

      const color = chair.colors.find(c => String(c._id) === String(i.colorId));
      if (!color) continue;

      const preserved = i.itemId ? existingItemsById.get(String(i.itemId)) : null;

      const item = {
        chairId: chair._id,
        chairModel: chair.modelName,
        hsnCode: chair.hsnCode || '94036000',
        colorId: color._id,
        colorName: color.name,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        shippingUnit: Number(i.shippingUnit || 0)
      };

      if (i.itemId) item._id = i.itemId;
      invoice.items.push(item);
    }

    // 3. Financial Recalculation Engine
    const COMPANY_STATE = 'Maharashtra';
    const gstEnabled = !!req.body.gstEnabled;
    invoice.gstEnabled = gstEnabled;

    const billingState = (req.body.billing?.state || '').trim();
    invoice.gstType = gstEnabled
      ? (billingState === COMPANY_STATE ? 'CGST_SGST' : 'IGST')
      : 'NONE';

    const taxableAmount = invoice.items.reduce(
      (sum, i) => sum + (i.unitPrice * i.quantity),
      0
    );

    const gstBreakup = { igst: 0, cgst: 0, sgst: 0 };

    if (gstEnabled) {
      if (invoice.gstType === 'IGST') {
        gstBreakup.igst = taxableAmount * 0.18;
      } else if (invoice.gstType === 'CGST_SGST') {
        gstBreakup.cgst = taxableAmount * 0.09;
        gstBreakup.sgst = taxableAmount * 0.09;
      }
    }

    const gstAmount = gstBreakup.igst + gstBreakup.cgst + gstBreakup.sgst;

    invoice.taxableAmount = taxableAmount;
    invoice.gstBreakup = gstBreakup;
    invoice.gstAmount = gstAmount;
    invoice.grandTotal = taxableAmount + gstAmount;

    // 4. Logistics & Overheads Data Capture
    invoice.shippingCost = Number(req.body.shippingCost || 0);
    invoice.poNumber = req.body.poNumber;
    invoice.paymentMode = req.body.paymentMode;
    invoice.estimatedDelivery = req.body.estimatedDelivery;
    invoice.installationType = req.body.installationType || 'FREE';
    invoice.notes = req.body.notes;

    await invoice.save();

    res.redirect(`/leads/${leadId}/pi/${piId}/invoices`);
  } catch (err) {
    console.error('TAX INVOICE UPDATE CONTROLLER ERROR:', err);
    res.status(500).send(err.message);
  }
};

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteReason } = req.body;
    const user = req.user;

    if (!deleteReason || !deleteReason.trim()) {
      return res.status(400).send('Delete reason is required');
    }

    const invoice = await TaxInvoice.findById(id);
    if (!invoice) {
      return res.status(404).send('Tax Invoice not found');
    }

    if (invoice.status === 'DELETED') {
      return res.status(400).send('Invoice already deleted');
    }

    invoice.status = 'DELETED';
    invoice.deletedAt = new Date();
    invoice.deleteReason = deleteReason.trim();

    await invoice.save();

    // Redirect back to invoice history of the PI
    return res.redirect(
      `/leads/${invoice.lead}/pi/${invoice.piId}/invoices`
    );

  } catch (err) {
    console.error('DELETE TAX INVOICE ERROR:', err);
    res.status(500).send('Failed to delete invoice');
  }
};