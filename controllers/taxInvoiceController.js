const Lead = require('../models/Lead');
const ProformaInvoice = require('../models/ProformaInvoice');
const TaxInvoice = require('../models/TaxInvoice');
const Chair = require('../models/Chair');
const SparePart = require('../models/SparePart');
const SubAssembly = require('../models/SubAssembly');
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
    .sort({ invoiceNumber: -1 })
    .select('invoiceNumber')
    .lean();

  let nextSeq = 1;

  if (lastInvoice?.invoiceNumber) {
    const lastSeq = parseInt(lastInvoice.invoiceNumber.split('-').pop(), 10);
    nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * Deducts or restores stock for items in a Tax Invoice.
 * @param {Array} items - Array of invoice item objects
 * @param {'deduct' | 'restore'} mode - Action mode
 */
async function updateStockForItems(items, mode = 'deduct') {
  const multiplier = mode === 'deduct' ? -1 : 1;

  for (const item of items) {
    const qty = (Number(item.quantity) || 0) * multiplier;
    if (!qty || !item.item) continue;

    const itemType = item.itemType || 'Chair';
    const itemId = item.item;

    if (itemType === 'Chair') {
      if (item.colorId) {
        // Update color-specific stock inside Chair document
        await Chair.updateOne(
          { _id: itemId, 'colors._id': item.colorId },
          { $inc: { 'colors.$.stock': qty } }
        );
      }
    } else if (itemType === 'SparePart' || itemType === 'Spare Part') {
      await SparePart.findByIdAndUpdate(itemId, {
        $inc: { stock: qty }
      });
    } else if (itemType === 'SubAssembly') {
      await SubAssembly.findByIdAndUpdate(itemId, {
        $inc: { stock: qty }
      });
    }
  }
}

exports.generateFromPI = async (req, res) => {
  try {
    const { piId } = req.params;

    const pi = await ProformaInvoice.findById(piId);
    if (!pi) {
      return res.status(404).send('Proforma Invoice not found');
    }

    const invoiceCount = await TaxInvoice.countDocuments({ piId: pi._id });
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

    // Deduct stock for all items added from PI
    await updateStockForItems(taxInvoice.items, 'deduct');

    return res.redirect(`/leads/${pi.lead}/pi/${pi._id}/invoices`);
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
    .populate('updatedBy', 'fullName')
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

    if (user?.role !== 'admin') {
      return res.status(403).send('Not authorized. Only administrators can edit Tax Invoices.');
    }

    const invoice = await TaxInvoice.findById(invoiceId).lean();
    if (!invoice) return res.status(404).send('Tax Invoice not found');

    // ===========================================
    // Backward compatibility for legacy Invoice items
    // ===========================================
    if (invoice.items?.length) {
      await Promise.all(
        invoice.items.map(async (item) => {
          // ------------------------------
          // New schema - item is ObjectId
          // ------------------------------
          if (item.item) {
            if (typeof item.item !== "object") {
              switch (item.itemType) {
                case "Chair":
                  item.item = await Chair.findById(item.item).lean();
                  break;

                case "SparePart":
                case "Spare Part":
                  item.item = await SparePart.findById(item.item).lean();
                  break;

                case "SubAssembly":
                case "Sub-Assembly":
                  item.item = await SubAssembly.findById(item.item).lean();
                  break;
              }
            }

            return;
          }

          // ------------------------------
          // Legacy Chair
          // ------------------------------
          if (item.chairModel) {
            item.itemType = "Chair";

            item.item = await Chair.findOne({
              modelName: item.chairModel,
            }).lean();

            return;
          }

          // ------------------------------
          // Legacy Spare Part
          // ------------------------------
          if (item.partName) {
            item.itemType = "SparePart";

            item.item = await SparePart.findOne({
              $or: [{ partName: item.partName }, { name: item.partName }],
            }).lean();

            return;
          }

          // ------------------------------
          // Legacy Sub Assembly
          // ------------------------------
          if (item.subAssemblyName) {
            item.itemType = "SubAssembly";

            item.item = await SubAssembly.findOne({
              name: item.subAssemblyName,
            }).lean();
          }
        })
      );
    }

    if (invoice.status === 'DELETED') {
      return res.status(400).send('Deleted Tax Invoices cannot be modified.');
    }

    const lead = await Lead.findById(leadId).lean();
    if (!lead) return res.status(404).send('Lead not found');

    const chairs = await Chair.find().lean();
    const spareParts = await SparePart.find().lean();
    const subAssemblies = await SubAssembly.find().lean();

    res.render('invoice/edit', {
      invoice,
      lead,
      chairs,
      spareParts,
      subAssemblies,
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

    if (user?.role !== 'admin') {
      return res.status(403).send('Not authorized.');
    }

    const invoice = await TaxInvoice.findById(invoiceId);
    if (!invoice) return res.status(404).send('Tax Invoice not found');
    if (invoice.status === 'DELETED') {
      return res.status(400).send('Deleted Tax Invoices cannot be edited.');
    }

    // Step A: Restore original stock balance before saving updates
    if (invoice.items && invoice.items.length > 0) {
      await updateStockForItems(invoice.items, 'restore');
    }

    // 1. Address Updates
    invoice.billingAddress = req.body.billing;
    const sameAsBilling = !!req.body.sameAsBilling;
    invoice.shippingAddress = sameAsBilling ? req.body.billing : req.body.shipping;

    // 2. Items Deep Snapshot Copy
    const itemsFromForm = Array.isArray(req.body.items)
      ? req.body.items
      : Object.values(req.body.items || {});

    invoice.items = [];

    for (const i of itemsFromForm) {
      const itemType = i.itemType || 'Chair';
      const selectedId = i.chair || i.subAssembly || i.chairId || i.item;

      if (!selectedId) continue;

      let itemDoc = null;
      let chairModel = 'Item';
      let hsnCode = '94036000';
      let colorId = null;
      let colorName = '-';

      if (itemType === 'Chair') {
        itemDoc = await Chair.findById(selectedId).lean();
        if (!itemDoc) continue;

        chairModel = itemDoc.modelName || 'Chair';
        hsnCode = itemDoc.hsnCode || '94036000';

        if (i.colorId && itemDoc.colors) {
          const color = itemDoc.colors.find(
            c => String(c._id) === String(i.colorId)
          );
          if (color) {
            colorId = color._id;
            colorName = color.name;
          }
        }
      } else if (itemType === 'SparePart' || itemType === 'Spare Part') {
        itemDoc = await SparePart.findById(selectedId).lean();
        if (!itemDoc) continue;

        chairModel = itemDoc.partName || itemDoc.name || 'Spare Part';
        hsnCode = itemDoc.hsnCode || '94036000';
      } else if (itemType === 'SubAssembly') {
        itemDoc = await SubAssembly.findById(selectedId).lean();
        if (!itemDoc) continue;

        chairModel = itemDoc.name || itemDoc.partName || 'Sub-Assembly';
        hsnCode = itemDoc.hsnCode || '94036000';
      }

      const item = {
        itemType,
        item: itemDoc._id,
        chairModel,
        hsnCode,
        colorId,
        colorName,
        quantity: Number(i.quantity) || 1,
        unitPrice: Number(i.unitPrice) || 0,
        shippingUnit: Number(i.shippingUnit || 0)
      };

      if (i.itemId) {
        item._id = i.itemId;
      }

      invoice.items.push(item);
    }

    // Step B: Deduct stock for updated line items
    await updateStockForItems(invoice.items, 'deduct');

    // 3. Financial Recalculation Engine
    const COMPANY_STATE = 'Maharashtra';
    const gstEnabled = !!req.body.gstEnabled;
    invoice.gstEnabled = gstEnabled;

    const billingState = (req.body.billing?.state || '').trim();
    invoice.gstType = gstEnabled
      ? billingState === COMPANY_STATE
        ? 'CGST_SGST'
        : 'IGST'
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

    invoice.updatedBy = new mongoose.mongo.ObjectId(req.session.user.id)

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

    // Restore inventory when invoice is deleted
    if (invoice.items && invoice.items.length > 0) {
      await updateStockForItems(invoice.items, 'restore');
    }

    invoice.status = 'DELETED';
    invoice.deletedAt = new Date();
    invoice.deleteReason = deleteReason.trim();

    await invoice.save();

    return res.redirect(`/leads/${invoice.lead}/pi/${invoice.piId}/invoices`);
  } catch (err) {
    console.error('DELETE TAX INVOICE ERROR:', err);
    res.status(500).send('Failed to delete invoice');
  }
};