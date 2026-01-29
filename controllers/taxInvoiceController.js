const Lead = require('../models/Lead');
const ProformaInvoice = require('../models/ProformaInvoice');
const TaxInvoice = require('../models/TaxInvoice');
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