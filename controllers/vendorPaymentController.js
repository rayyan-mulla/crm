// controllers/vendorPaymentController.js

const VendorPayment = require('../models/VendorPayment');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder');
const mongoose = require('mongoose');

const roundTo = (value, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

/**
 * Generate sequential payment number: VP-MM-YYYY-001
 */
async function generatePaymentNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const prefix = `VP-${month}-${year}-`;

  const lastPayment = await VendorPayment.findOne({
    paymentNumber: { $regex: `^${prefix}` }
  })
    .sort({ paymentNumber: -1 })
    .select('paymentNumber')
    .lean();

  let nextSeq = 1;
  if (lastPayment?.paymentNumber) {
    const lastSeq = parseInt(lastPayment.paymentNumber.split('-').pop(), 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * Retrieve all bills generated from purchase order deliveries/validations.
 * Each validation receipt represents one distinct Bill from the vendor.
 */
async function getVendorBills(vendorId = null) {
  const poFilter = { status: { $nin: ['DRAFT', 'CANCELLED'] } };
  if (vendorId) {
    poFilter.vendor = vendorId;
  }

  const purchaseOrders = await PurchaseOrder.find(poFilter)
    .populate('vendor')
    .sort({ purchaseDate: 1, createdAt: 1 })
    .lean();

  const paymentFilter = vendorId ? { vendor: vendorId } : {};
  const payments = await VendorPayment.find(paymentFilter).sort({ paymentDate: 1, createdAt: 1 }).lean();

  const vendors = await Vendor.find(vendorId ? { _id: vendorId } : {}).lean();
  const vendorMap = new Map();
  vendors.forEach(v => vendorMap.set(v._id.toString(), v));

  const bills = [];

  for (const po of purchaseOrders) {
    const serviceTotal = (po.items || [])
      .filter(i => i.itemType === 'service')
      .reduce((sum, i) => roundTo(sum + (i.totalCost || 0)), 0);

    // 1. Material bills from physical deliveries (receiptHistory)
    if (Array.isArray(po.receiptHistory) && po.receiptHistory.length > 0) {
      po.receiptHistory.forEach((receipt, rIdx) => {
        const billNo = receipt.billNumber || `${po.purchaseNumber}-R${rIdx + 1}`;
        const billAmount = roundTo(Number(receipt.receivedAmount || 0));

        bills.push({
          billKey: `${po._id}_receipt_${rIdx}`,
          purchaseOrderId: po._id,
          poNumber: po.purchaseNumber,
          receiptIndex: rIdx,
          billNumber: billNo,
          billDate: receipt.receivedAt || po.purchaseDate,
          vendor: po.vendor,
          vendorId: (po.vendor?._id || po.vendor).toString(),
          vendorName: po.vendor?.name || '-',
          billAmount,
          paidAmount: 0,
          pendingAmount: billAmount,
          type: 'Material Bill',
          itemCount: (receipt.items || []).length
        });
      });
    } else {
      // Legacy PO without receiptHistory: only if physical material was received
      const materialAmount = roundTo(Number(po.receivedAmount || 0) - serviceTotal);
      if (materialAmount > 0) {
        const billNo = po.billNumber || po.purchaseNumber;
        bills.push({
          billKey: `${po._id}_legacy`,
          purchaseOrderId: po._id,
          poNumber: po.purchaseNumber,
          receiptIndex: 0,
          billNumber: billNo,
          billDate: po.receivedAt || po.purchaseDate,
          vendor: po.vendor,
          vendorId: (po.vendor?._id || po.vendor).toString(),
          vendorName: po.vendor?.name || '-',
          billAmount: materialAmount,
          paidAmount: 0,
          pendingAmount: materialAmount,
          type: 'Material Bill',
          itemCount: (po.items || []).filter(i => i.itemType !== 'service').length
        });
      }
    }

    // 2. Service bills (Seat Making)
    if (serviceTotal > 0) {
      const billNo = po.billNumber ? `${po.billNumber} (Service)` : `${po.purchaseNumber} (Service)`;
      bills.push({
        billKey: `${po._id}_service`,
        purchaseOrderId: po._id,
        poNumber: po.purchaseNumber,
        receiptIndex: -1,
        billNumber: billNo,
        billDate: po.purchaseDate,
        vendor: po.vendor,
        vendorId: (po.vendor?._id || po.vendor).toString(),
        vendorName: po.vendor?.name || '-',
        billAmount: serviceTotal,
        paidAmount: 0,
        pendingAmount: serviceTotal,
        type: 'Service Bill',
        itemCount: (po.items || []).filter(i => i.itemType === 'service').length
      });
    }
  }

  // Group bills by vendor to allocate payments
  const billsByVendor = new Map();
  for (const b of bills) {
    if (!billsByVendor.has(b.vendorId)) {
      billsByVendor.set(b.vendorId, []);
    }
    billsByVendor.get(b.vendorId).push(b);
  }

  for (const [vId, vBills] of billsByVendor.entries()) {
    const vPayments = payments.filter(p => (p.vendor?._id || p.vendor).toString() === vId);

    // 1. Allocate bill-specific payments
    for (const pay of vPayments) {
      if (pay.purchaseOrder) {
        const matchedBill = vBills.find(b =>
          b.purchaseOrderId.toString() === pay.purchaseOrder.toString() &&
          (b.receiptIndex === pay.receiptIndex || (pay.billNumber && b.billNumber === pay.billNumber))
        );
        if (matchedBill) {
          const alloc = Math.min(matchedBill.pendingAmount, Number(pay.amount || 0));
          matchedBill.paidAmount = roundTo(matchedBill.paidAmount + alloc);
          matchedBill.pendingAmount = Math.max(0, roundTo(matchedBill.billAmount - matchedBill.paidAmount));
          pay._allocated = true;
        }
      }
    }

    // 2. Allocate general / on-account payments in FIFO order across remaining pending bills
    for (const pay of vPayments) {
      if (!pay._allocated) {
        let unalloc = Number(pay.amount || 0);
        for (const b of vBills) {
          if (unalloc <= 0) break;
          if (b.pendingAmount <= 0) continue;
          const alloc = Math.min(b.pendingAmount, unalloc);
          b.paidAmount = roundTo(b.paidAmount + alloc);
          b.pendingAmount = Math.max(0, roundTo(b.billAmount - b.paidAmount));
          unalloc = roundTo(unalloc - alloc);
        }
      }
    }

    // 3. Update status label based on actual payments
    vBills.forEach(b => {
      b.status = b.pendingAmount <= 0 ? 'PAID' : (b.paidAmount > 0 ? 'PARTIAL' : 'UNPAID');
    });
  }

  // Sort bills newest first for display
  bills.sort((a, b) => new Date(b.billDate) - new Date(a.billDate));

  return bills;
}

// 🔹 INDEX (BILLS, PAYMENTS & LEDGER)
exports.index = async (req, res) => {
  try {
    const selectedVendor = req.query.vendor || '';
    const activeTab = req.query.tab || 'bills';
    const search = (req.query.search || '').trim().toLowerCase();

    const vendors = await Vendor.find({ isActive: true }).sort({ name: 1 }).lean();

    // Fetch all validation bills
    let bills = await getVendorBills(selectedVendor || null);

    // Fetch payments
    const paymentQuery = selectedVendor ? { vendor: selectedVendor } : {};
    let payments = await VendorPayment.find(paymentQuery)
      .populate('vendor')
      .populate('purchaseOrder')
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    // Calculate real vendor balance directly from pending bills for 100% consistency
    const totalBilled = roundTo(bills.reduce((s, b) => s + Number(b.billAmount || 0), 0), 2);
    const totalPaid = roundTo(bills.reduce((s, b) => s + Number(b.paidAmount || 0), 0), 2);
    const totalOutstanding = roundTo(bills.reduce((s, b) => s + Number(b.pendingAmount || 0), 0), 2);
    const vendorBalance = totalOutstanding;

    let currentVendor = null;
    if (selectedVendor) {
      currentVendor = vendors.find(v => v._id.toString() === selectedVendor.toString()) || null;
    }

    // Total payments made
    const totalPaymentsAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    // Filter bills by search query if provided
    if (search) {
      bills = bills.filter(b =>
        (b.billNumber && b.billNumber.toLowerCase().includes(search)) ||
        (b.poNumber && b.poNumber.toLowerCase().includes(search)) ||
        (b.vendorName && b.vendorName.toLowerCase().includes(search))
      );
    }

    // Filter payments by search query if provided
    let filteredPayments = payments;
    if (search) {
      filteredPayments = payments.filter(p =>
        (p.paymentNumber && p.paymentNumber.toLowerCase().includes(search)) ||
        (p.billNumber && p.billNumber.toLowerCase().includes(search)) ||
        (p.reference && p.reference.toLowerCase().includes(search)) ||
        (p.purchaseOrder?.purchaseNumber && p.purchaseOrder.purchaseNumber.toLowerCase().includes(search)) ||
        (p.vendor?.name && p.vendor.name.toLowerCase().includes(search))
      );
    }

    // Build ledger entries (Bills as Debits, Payments as Credits)
    let ledger = [];

    bills.forEach(b => {
      ledger.push({
        date: b.billDate,
        type: b.type,
        ref: b.billNumber,
        poNumber: b.poNumber,
        vendor: b.vendorName,
        vendorId: b.vendorId,
        debit: b.billAmount,
        credit: 0,
        id: b.purchaseOrderId,
        source: 'bill'
      });
    });

    payments.forEach(p => {
      ledger.push({
        date: p.paymentDate,
        type: 'Payment',
        ref: p.billNumber ? `${p.billNumber} (${p.reference || p.paymentNumber || 'PAY'})` : (p.reference || p.paymentNumber || 'PAY'),
        poNumber: p.purchaseOrder?.purchaseNumber || '-',
        vendor: p.vendor?.name || '-',
        vendorId: p.vendor?._id,
        debit: 0,
        credit: p.amount,
        id: p._id,
        source: 'payment',
        paymentMethod: p.paymentMethod
      });
    });

    ledger.sort((a, b) => new Date(a.date) - new Date(b.date));

    let balance = 0;
    ledger = ledger.map(l => {
      balance = roundTo(balance + (l.debit - l.credit));
      return { ...l, balance };
    });

    // Filter ledger by search query if provided
    if (search) {
      ledger = ledger.filter(l =>
        (l.ref && l.ref.toLowerCase().includes(search)) ||
        (l.poNumber && l.poNumber.toLowerCase().includes(search)) ||
        (l.vendor && l.vendor.toLowerCase().includes(search))
      );
    }

    res.render('vendorPayments/index', {
      ledger,
      bills,
      payments: filteredPayments,
      vendors,
      selectedVendor,
      currentVendor,
      vendorBalance,
      totalPaymentsAmount,
      paymentsCount: payments.length,
      activeTab,
      query: req.query,
      user: req.session.user,
      activePage: 'vendorPayments'
    });
  } catch (err) {
    console.error('vendorPayment.index error:', err);
    res.status(500).send('Server Error');
  }
};

// 🔹 API: GET BILLS BY VENDOR (FOR DYNAMIC DROPDOWN)
exports.getBillsByVendor = async (req, res) => {
  try {
    const bills = await getVendorBills(req.params.vendorId);
    res.json({ success: true, bills });
  } catch (err) {
    console.error('getBillsByVendor error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch vendor bills.' });
  }
};

// 🔹 NEW FORM
exports.newForm = async (req, res) => {
  try {
    const vendors = await Vendor.find({ isActive: true }).sort({ name: 1 }).lean();
    const selectedVendor = req.query.vendor || '';
    const selectedPo = req.query.po || '';
    const selectedReceipt = req.query.receipt !== undefined && req.query.receipt !== '' ? Number(req.query.receipt) : null;
    const selectedBill = req.query.bill || '';

    let bills = [];
    if (selectedVendor) {
      bills = await getVendorBills(selectedVendor);
    }

    res.render('vendorPayments/form', {
      vendors,
      bills,
      selectedVendor,
      selectedPo,
      selectedReceipt,
      selectedBill,
      payment: null,
      mode: 'create',
      user: req.session.user,
      activePage: 'vendorPayments',
      showBack: true
    });
  } catch (err) {
    console.error('vendorPayment.newForm error:', err);
    res.status(500).send('Server Error');
  }
};

// 🔹 CREATE PAYMENT
exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      vendor,
      purchaseOrder,
      receiptIndex,
      billNumber,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      notes
    } = req.body;

    const amt = Number(amount);
    const paymentNumber = await generatePaymentNumber();

    const paymentData = {
      vendor,
      paymentNumber,
      amount: amt,
      paymentDate,
      paymentMethod,
      reference,
      notes
    };

    const userId = req.session?.user?.id || req.session?.user?._id || null;
    if (userId) {
      paymentData.createdBy = userId;
    }

    if (purchaseOrder) {
      paymentData.purchaseOrder = purchaseOrder;
    }
    if (receiptIndex !== undefined && receiptIndex !== '' && !Number.isNaN(Number(receiptIndex))) {
      paymentData.receiptIndex = Number(receiptIndex);
    }
    if (billNumber) {
      paymentData.billNumber = billNumber.trim();
    }

    await VendorPayment.create([paymentData], { session });

    await Vendor.findByIdAndUpdate(
      vendor,
      { $inc: { balance: -amt } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/vendor-payments');
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('vendorPayment.create error:', err);
    res.redirect('/purchasing/vendor-payments/new');
  }
};

// 🔹 VIEW
exports.view = async (req, res) => {
  try {
    const payment = await VendorPayment.findById(req.params.id)
      .populate('vendor')
      .populate('purchaseOrder')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();

    if (!payment) {
      return res.redirect('/purchasing/vendor-payments');
    }

    res.render('vendorPayments/view', {
      payment,
      user: req.session.user,
      activePage: 'vendorPayments'
    });
  } catch (err) {
    console.error('vendorPayment.view error:', err);
    res.redirect('/purchasing/vendor-payments');
  }
};

// 🔹 EDIT FORM
exports.editForm = async (req, res) => {
  try {
    const payment = await VendorPayment.findById(req.params.id).lean();
    if (!payment) {
      return res.redirect('/purchasing/vendor-payments');
    }

    const vendors = await Vendor.find({ isActive: true }).sort({ name: 1 }).lean();
    const vendorId = payment.vendor?._id || payment.vendor;
    const bills = vendorId ? await getVendorBills(vendorId) : [];

    res.render('vendorPayments/form', {
      vendors,
      bills,
      selectedVendor: String(vendorId || ''),
      selectedPo: String(payment.purchaseOrder || ''),
      selectedReceipt: payment.receiptIndex !== undefined ? payment.receiptIndex : null,
      selectedBill: payment.billNumber || '',
      payment,
      mode: 'edit',
      user: req.session.user,
      activePage: 'vendorPayments'
    });
  } catch (err) {
    console.error('vendorPayment.editForm error:', err);
    res.redirect('/purchasing/vendor-payments');
  }
};

// 🔹 UPDATE
exports.update = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await VendorPayment.findById(req.params.id).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect('/purchasing/vendor-payments');
    }

    // reverse old amount on vendor balance
    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: payment.amount } },
      { session }
    );

    const newAmount = Number(req.body.amount);

    payment.vendor = req.body.vendor || payment.vendor;
    payment.amount = newAmount;
    payment.paymentDate = req.body.paymentDate;
    payment.paymentMethod = req.body.paymentMethod;
    payment.reference = req.body.reference;
    payment.notes = req.body.notes;
    payment.purchaseOrder = req.body.purchaseOrder || undefined;
    payment.receiptIndex = req.body.receiptIndex !== undefined && req.body.receiptIndex !== ''
      ? Number(req.body.receiptIndex)
      : undefined;
    payment.billNumber = req.body.billNumber ? req.body.billNumber.trim() : undefined;
    const updateUserId = req.session?.user?.id || req.session?.user?._id || null;
    if (updateUserId) {
      payment.updatedBy = updateUserId;
    }

    await payment.save({ session });

    // apply new amount on vendor balance
    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: -newAmount } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/vendor-payments');
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('vendorPayment.update error:', err);
    res.redirect(`/purchasing/vendor-payments/${req.params.id}/edit`);
  }
};

// 🔹 DELETE
exports.delete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await VendorPayment.findById(req.params.id).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect('/purchasing/vendor-payments');
    }

    await Vendor.findByIdAndUpdate(
      payment.vendor,
      { $inc: { balance: payment.amount } },
      { session }
    );

    await VendorPayment.findByIdAndDelete(req.params.id, { session });

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/vendor-payments');
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('vendorPayment.delete error:', err);
    res.redirect('/purchasing/vendor-payments');
  }
};