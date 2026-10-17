const Purchase = require('../models/Purchase');
const Vendor = require('../models/Vendor');
const SparePart = require('../models/SparePart');
const Chair = require('../models/Chair');
const SparePartCategory = require('../models/SparePartCategory');
const mongoose = require('mongoose');
const imageToBase64 = require('../utils/imageToBase64');
const pdfGenerator = require('../utils/pdfGenerator');

const roundTo = (value, decimals = 6) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

/**
 * Automatically backfill poItemIndex on legacy receivedItems records
 * that were created before poItemIndex was introduced.
 */
function resolveLegacyReceivedItems(purchase) {
  if (!purchase || !Array.isArray(purchase.receivedItems) || !Array.isArray(purchase.items)) {
    return;
  }

  for (let rIdx = 0; rIdx < purchase.receivedItems.length; rIdx++) {
    const item = purchase.receivedItems[rIdx];
    if (
      item.poItemIndex === undefined ||
      item.poItemIndex === null ||
      Number.isNaN(Number(item.poItemIndex))
    ) {
      let matchIndex = purchase.items.findIndex(poItem => {
        if (poItem.itemType !== item.itemType) return false;
        if (item.itemType === 'sparePart') {
          const poSpare = (poItem.sparePart?._id || poItem.sparePart)?.toString();
          const recSpare = (item.sparePart?._id || item.sparePart)?.toString();
          return poSpare && recSpare && poSpare === recSpare;
        }
        if (item.itemType === 'chair') {
          const poChair = (poItem.chair?._id || poItem.chair)?.toString();
          const recChair = (item.chair?._id || item.chair)?.toString();
          const poColor = (poItem.chairColor?._id || poItem.chairColor)?.toString();
          const recColor = (item.chairColor?._id || item.chairColor)?.toString();
          return poChair && recChair && poChair === recChair && (!poColor || poColor === recColor);
        }
        return false;
      });

      if (matchIndex === -1 && rIdx < purchase.items.length) {
        matchIndex = rIdx;
      }

      if (matchIndex !== -1) {
        item.poItemIndex = matchIndex;
      }
    }
  }
}

async function generatePoNumber() {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();

  const prefix = `PO-${month}-${year}-`;

  const lastPurchase = await Purchase.findOne({
    purchaseNumber: { $regex: `^${prefix}` }
  })
    .sort({ purchaseNumber: -1 }) // works due to zero padding
    .select('purchaseNumber')
    .lean();

  let nextSeq = 1;

  if (lastPurchase?.purchaseNumber) {
    const lastSeq = parseInt(
      lastPurchase.purchaseNumber.split('-').pop(),
      10
    );

    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

// LIST (with pagination like other modules)
exports.index = async (req, res) => {

  try {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || '').trim();

    const filter = {};

    const total = await Purchase.countDocuments(filter);

    const purchases = await Purchase.find(filter)
      .populate('vendor')
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('purchases/index', {
      purchases,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'purchases'
    });

  } catch (err) {

    console.error('purchase.index error', err);
    res.status(500).send('Server Error');

  }

};

// NEW FORM
exports.newForm = async (req, res) => {

  try {

    const vendors = await Vendor.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    const spareParts = await SparePart.find({ isActive: true })
      .sort({ partName: 1 })
      .lean();

    const chairs = await Chair.find({ isActive: true })
      .sort({ modelName: 1 })
      .lean();

    const categories = await SparePartCategory
    .find({ isActive: true })
    .lean();

    res.render('purchases/form', {
      vendors,
      spareParts,
      chairs,
      categories,
      purchase: null,
      mode: 'create',
      user: req.session.user,
      activePage: 'purchases',
      showBack: true
    });

  } catch (err) {

    console.error('purchase.newForm error', err);
    res.status(500).send('Server Error');

  }

};

// CREATE PURCHASE
exports.create = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      vendor,
      purchaseDate,
      deliverySchedule,
      deliveryAt,
      status,
      notes,
      items
    } = req.body;

    let formattedItems = [];
    let totalAmount = 0;

    for (const item of items || []) {
      // 1. Determine item identifier and type from separate form fields
      const itemType = item.itemType === 'chair' ? 'chair' : (item.itemType === 'service' ? 'service' : 'sparePart');
      const itemId = item.itemType === 'chair'
        ? (item.chair || item.itemId)
        : (item.itemType === 'service' ? (item.serviceName || 'Seat Making') : (item.sparePart || item.itemId));

      // Skip invalid/empty entries
      if (!itemId) continue;

      const quantity = Number(item.quantity) || 0;
      const basePrice = Number(item.basePrice) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const gstApplicable = item.gstApplicable === 'true' || item.gstApplicable === true;

      let gstPercentage = 0;

      if (gstApplicable) {
        if (itemType === 'sparePart') {
          const sparePart = await SparePart.findById(itemId).lean();

          if (!sparePart) {
            throw new Error('Spare part not found');
          }

          gstPercentage =
            sparePart.gstPercentage !== undefined &&
            sparePart.gstPercentage !== null
              ? Number(sparePart.gstPercentage)
              : 18;
        } else if (itemType === 'chair') {
          gstPercentage = 18;
        } else if (itemType === 'service') {
          gstPercentage =
            item.gstPercentage !== undefined &&
            item.gstPercentage !== null &&
            item.gstPercentage !== ''
              ? Math.max(0, Number(item.gstPercentage))
              : 18;
        }
      }

      const finalRate = gstApplicable
        ? unitCost + (unitCost * gstPercentage / 100)
        : unitCost;

      const totalCost = quantity * finalRate;

      totalAmount += totalCost;

      let itemData = {
        itemType,
        quantity,
        basePrice,
        unitCost,
        gstApplicable,
        gstPercentage,
        finalRate,
        totalCost
      };

      if (itemType === 'sparePart') {
        itemData.sparePart = itemId;
      } else if (itemType === 'chair') {
        itemData.chair = itemId;
        if (item.chairColor || item.colorId) {
          itemData.chairColor = item.chairColor || item.colorId;
        }
      } else if (itemType === 'service') {
        itemData.serviceName = item.serviceName || 'Seat Making';
      }

      formattedItems.push(itemData);
    }

    const serviceTotal = formattedItems
      .filter(i => i.itemType === 'service')
      .reduce((sum, i) => roundTo(sum + i.totalCost), 0);

    const hasPhysicalItems = formattedItems.some(i => i.itemType !== 'service');
    const poStatus = !hasPhysicalItems && formattedItems.length > 0
      ? 'RECEIVED'
      : (status || 'ORDERED');

    const poValidationStatus = !hasPhysicalItems && formattedItems.length > 0
      ? 'FULLY_VALIDATED'
      : 'NOT_VALIDATED';

    if (serviceTotal > 0 && poStatus !== 'DRAFT' && poStatus !== 'CANCELLED') {
      const vendorDoc = await Vendor.findById(vendor).session(session);
      if (vendorDoc) {
        vendorDoc.balance = roundTo(Number(vendorDoc.balance || 0) + serviceTotal);
        await vendorDoc.save({ session });
      }
    }

    const purchaseNumber = await generatePoNumber();

    const purchase = await Purchase.create([{
      purchaseNumber,
      vendor,
      purchaseDate,
      deliverySchedule,
      deliveryAt,
      status: poStatus,
      notes,
      items: formattedItems,
      receivedItems: [],
      totalAmount,
      receivedAmount: serviceTotal,
      validationStatus: poValidationStatus,
      createdBy: req.session.user.id
    }], { session });

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/purchases');

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error(err);
    res.redirect('/purchasing/purchases/new');
  }
};

exports.downloadPdf = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate({
        path: 'items.sparePart',
        populate: {
          path: 'category'
        }
      })
      .populate('items.chair')
      .populate('createdBy', 'fullName')
      .lean();

    if (!purchase) {
      return res.status(404).send('Purchase not found');
    }

    const logoBase64 = imageToBase64('images/logo.png');
    const signBase64 = imageToBase64('images/sign.png');
    const qrBase64 = imageToBase64('images/qr.jpeg')

    await pdfGenerator.generatePdf({
      res,
      template: 'pdf',
      templateData: {
        purchase,
        logoBase64,
        signBase64,
        qrBase64,
        documentType: 'PURCHASE_ORDER'
      },
      filename: `${purchase.purchaseNumber}.pdf`,
      headerTitle: 'PURCHASE ORDER'
    });

  } catch (err) {
    console.error('PURCHASE PDF ERROR:', err);
    res.status(500).send(err.message);
  }
};

// VIEW PURCHASE
exports.view = async (req, res) => {

  try {

    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate({
        path: 'items.sparePart',
        populate: { path: 'category' }
      })
      .populate({
        path: 'receivedItems.sparePart',
        populate: { path: 'category' }
      })
      .populate('receivedItems.chair')
      .populate('items.chair')
      .populate({
        path: 'receiptHistory.items.sparePart',
        populate: { path: 'category' }
      })
      .populate('receiptHistory.items.chair')
      .populate('receiptHistory.receivedBy', 'fullName')
      .populate('shortClosedBy', 'fullName')
      .populate('createdBy', 'fullName')
      .populate('updatedBy', 'fullName')
      .lean();

    if (!purchase) {
      return res.redirect('/purchasing/purchases');
    }

    resolveLegacyReceivedItems(purchase);

    res.render('purchases/view', {
      purchase,
      user: req.session.user,
      activePage: 'purchases',
      showBack: true
    });

  } catch (err) {

    console.error(err);
    res.redirect('/purchasing/purchases');

  }

};

exports.editForm = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).lean();

    if (!purchase) {
      return res.redirect('/purchasing/purchases');
    }

    const vendors = await Vendor.find({ isActive: true }).lean();
    const spareParts = await SparePart.find({ isActive: true }).lean();
    const chairs = await Chair.find({ isActive: true }).populate('colors').lean();
    const categories = await SparePartCategory.find({ isActive: true }).lean();

    res.render('purchases/form', {
      purchase,
      vendors,
      spareParts,
      chairs,
      categories,
      mode: 'edit',
      user: req.session.user,
      activePage: 'purchases',
      showBack: true
    });

  } catch (err) {
    console.error(err);
    res.redirect('/purchasing/purchases');
  }
};

exports.update = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      vendor,
      purchaseDate,
      deliverySchedule,
      deliveryAt,
      status,
      notes,
      items
    } = req.body;

    const existingPurchase = await Purchase.findById(req.params.id).session(session);

    if (!existingPurchase) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect('/purchasing/purchases');
    }

    // Prevent updates only if explicitly already validated
    if (existingPurchase.validationStatus === 'VALIDATED') {
      await Purchase.findByIdAndUpdate(
        req.params.id,
        {
          status: req.body.status,
          notes: req.body.notes,
          updatedBy: req.session.user.id
        },
        { session, runValidators: true }
      );

      await session.commitTransaction();
      session.endSession();
      return res.redirect('/purchasing/purchases');
    }

    const oldServiceTotal = (existingPurchase.items || [])
      .filter(i => i.itemType === 'service')
      .reduce((sum, i) => roundTo(sum + (i.totalCost || 0)), 0);
    const oldVendorId = (existingPurchase.vendor?._id || existingPurchase.vendor).toString();
    const oldStatus = existingPurchase.status;

    let formattedItems = [];
    let totalAmount = 0;

    for (const item of items || []) {
      // Handle actual form field structure sent by HTML form
      const itemType = item.itemType === 'chair' ? 'chair' : (item.itemType === 'service' ? 'service' : 'sparePart');
      const itemId = item.itemType === 'chair'
        ? (item.chair || item.itemId)
        : (item.itemType === 'service' ? (item.serviceName || 'Seat Making') : (item.sparePart || item.itemId));

      if (!itemId) continue;

      const quantity = Number(item.quantity) || 0;
      const basePrice = Number(item.basePrice) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const gstApplicable = item.gstApplicable === 'true' || item.gstApplicable === true;

      let gstPercentage = 0;

      if (gstApplicable) {
        if (itemType === 'sparePart') {
          const sparePart = await SparePart.findById(itemId).lean();

          if (!sparePart) {
            throw new Error('Spare part not found');
          }

          gstPercentage =
            sparePart.gstPercentage !== undefined &&
            sparePart.gstPercentage !== null
              ? Number(sparePart.gstPercentage)
              : 18;
        } else if (itemType === 'chair') {
          gstPercentage = 18;
        } else if (itemType === 'service') {
          gstPercentage =
            item.gstPercentage !== undefined &&
            item.gstPercentage !== null &&
            item.gstPercentage !== ''
              ? Math.max(0, Number(item.gstPercentage))
              : 18;
        }
      }

      const finalRate = gstApplicable
        ? unitCost + (unitCost * gstPercentage / 100)
        : unitCost;

      const totalCost = quantity * finalRate;

      totalAmount += totalCost;

      let itemData = {
        itemType,
        quantity,
        basePrice,
        unitCost,
        gstApplicable,
        gstPercentage,
        finalRate,
        totalCost
      };

      if (itemType === 'sparePart') {
        itemData.sparePart = itemId;
      } else if (itemType === 'chair') {
        itemData.chair = itemId;
        if (item.chairColor || item.colorId || item.color) {
          itemData.chairColor = item.chairColor || item.colorId || item.color;
        }
      } else if (itemType === 'service') {
        itemData.serviceName = item.serviceName || 'Seat Making';
      }

      formattedItems.push(itemData);
    }

    const newServiceTotal = formattedItems
      .filter(i => i.itemType === 'service')
      .reduce((sum, i) => roundTo(sum + i.totalCost), 0);
    const newVendorId = (vendor?._id || vendor).toString();
    const newStatus = status || existingPurchase.status;

    const oldActive = oldStatus !== 'DRAFT' && oldStatus !== 'CANCELLED';
    const newActive = newStatus !== 'DRAFT' && newStatus !== 'CANCELLED';

    if (oldVendorId === newVendorId) {
      const delta = (newActive ? newServiceTotal : 0) - (oldActive ? oldServiceTotal : 0);
      if (delta !== 0) {
        await Vendor.findByIdAndUpdate(
          newVendorId,
          { $inc: { balance: delta } },
          { session }
        );
      }
    } else {
      if (oldActive && oldServiceTotal > 0) {
        await Vendor.findByIdAndUpdate(
          oldVendorId,
          { $inc: { balance: -oldServiceTotal } },
          { session }
        );
      }
      if (newActive && newServiceTotal > 0) {
        await Vendor.findByIdAndUpdate(
          newVendorId,
          { $inc: { balance: newServiceTotal } },
          { session }
        );
      }
    }

    const serviceDifference = (newActive ? newServiceTotal : 0) - (oldActive ? oldServiceTotal : 0);
    const updatedReceivedAmount = Math.max(0, roundTo(Number(existingPurchase.receivedAmount || 0) + serviceDifference));

    const hasPhysicalItems = formattedItems.some(i => i.itemType !== 'service');
    let finalStatus = newStatus;
    let finalValidationStatus = existingPurchase.validationStatus;

    if (!hasPhysicalItems && formattedItems.length > 0) {
      finalStatus = 'RECEIVED';
      finalValidationStatus = 'FULLY_VALIDATED';
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      {
        vendor,
        purchaseDate,
        deliverySchedule,
        deliveryAt,
        status: finalStatus,
        validationStatus: finalValidationStatus,
        receivedAmount: updatedReceivedAmount,
        notes,
        items: formattedItems,
        totalAmount,
        updatedBy: req.session.user.id
      },
      { new: true, session, runValidators: true }
    );

    await session.commitTransaction();
    session.endSession();

    res.redirect(`/purchasing/purchases`);

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error('Update Purchase Error:', err);
    res.redirect(`/purchasing/purchases/${req.params.id}/edit`);
  }
};

exports.delete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const purchase = await Purchase.findById(req.params.id).session(session);

    if (!purchase) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect('/purchasing/purchases');
    }

    const hasReceivedPhysical = (purchase.receivedItems || []).some(
      item => Number(item.receivedQuantity || 0) > 0
    );

    if (purchase.status === 'RECEIVED' && hasReceivedPhysical) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect(`/purchasing/purchases/${purchase._id}`);
    }

    const serviceTotal = (purchase.items || [])
      .filter(i => i.itemType === 'service')
      .reduce((sum, i) => roundTo(sum + (i.totalCost || 0)), 0);

    if (serviceTotal > 0 && purchase.status !== 'DRAFT' && purchase.status !== 'CANCELLED') {
      await Vendor.findByIdAndUpdate(
        purchase.vendor,
        { $inc: { balance: -serviceTotal } },
        { session }
      );
    }

    await Purchase.findByIdAndDelete(req.params.id, { session });

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/purchases');

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error(err);
    res.redirect('/purchasing/purchases');
  }
};

exports.validateForm = async (req, res) => {
  const isAjax = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept?.includes('json');

  try {
    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate('items.sparePart')
      .populate('items.chair')
      .lean();

    /* =====================================================
       VALIDATION CHECKS
    ===================================================== */
    if (!purchase) {
      throw new Error('Purchase not found');
    }

    if (
      purchase.status !== 'ORDERED' &&
      purchase.status !== 'PARTIALLY_RECEIVED'
    ) {
      throw new Error(`Purchase cannot be validated because its status is ${purchase.status}`);
    }

    const hasPhysicalItems = (purchase.items || []).some(item => item.itemType !== 'service');
    if (!hasPhysicalItems) {
      throw new Error('This purchase order contains only services and does not require validation.');
    }

    /* =====================================================
       BUILD VALIDATION ITEMS DATA
    ===================================================== */
    resolveLegacyReceivedItems(purchase);

    const receivedMap = new Map();
    for (const receivedItem of purchase.receivedItems || []) {
      const poItemIndex = Number(receivedItem.poItemIndex);
      if (!Number.isNaN(poItemIndex)) {
        receivedMap.set(poItemIndex, Number(receivedItem.receivedQuantity || 0));
      }
    }

    const validationItems = [];
    (purchase.items || []).forEach((item, index) => {
      if (item.itemType === 'service') return;

      const orderedQuantity = Number(item.quantity || 0);
      const previouslyReceived = Number(receivedMap.get(index) || 0);
      const remainingQuantity = roundTo(
        Math.max(0, orderedQuantity - previouslyReceived)
      );

      let itemId = item.itemType === 'sparePart' 
        ? (item.sparePart?._id || item.sparePart || '') 
        : (item.chair?._id || item.chair || '');

      const colorId = item.chairColor?._id || item.chairColor || '';
      let colorName = '';

      if (item.itemType === 'chair') {
        if (item.chairColor && typeof item.chairColor === 'object' && item.chairColor.name) {
          colorName = item.chairColor.name;
        } else if (item.chair && Array.isArray(item.chair.colors)) {
          const matchedColor = item.chair.colors.find(c => String(c._id) === String(colorId));
          if (matchedColor) colorName = matchedColor.name || '';
        }
      }

      let itemName = '-';
      if (item.itemType === 'chair') {
        itemName = item.chair?.modelName || item.chair?.name || '-';
      } else if (item.itemType === 'sparePart') {
        itemName = item.sparePart?.partName || item.sparePart?.name || '-';
      }

      validationItems.push({
        poItemIndex: index,
        itemType: item.itemType,
        itemId: String(itemId || ''),
        colorId: String(colorId || ''),
        itemName,
        colorName,
        orderedQuantity,
        previouslyReceived,
        remainingQuantity,
        chair: item.chair,
        chairColor: item.chairColor,
        sparePart: item.sparePart,
        unitCost: Number(item.unitCost || 0),
        finalRate: Number(item.finalRate || 0)
      });
    });

    /* =====================================================
       FETCH CATALOG DATA & RENDER
    ===================================================== */
    const spareParts = await SparePart.find({ isActive: true })
      .populate('category')
      .sort({ partName: 1 })
      .lean();

    const chairs = await Chair.find({ isActive: true })
      .sort({ modelName: 1 })
      .lean();

    // Safely resolve active user session
    const currentUser = req.session?.user || req.user;

    // AJAX Call -> Return JSON payload
    if (isAjax) {
      return res.json({
        success: true,
        purchase,
        validationItems,
        spareParts,
        chairs
      });
    }

    // Standard Browser Load -> Render View
    res.render('purchases/validate', {
      purchase,
      validationItems,
      spareParts,
      chairs,
      user: currentUser,
      activePage: 'purchases',
      showBack: true,
      error: null
    });

  } catch (err) {
    console.error('purchase.validateForm error:', err);

    if (isAjax) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Error loading validation form.'
      });
    }

    res.redirect('/purchasing/purchases?error=' + encodeURIComponent(err.message || 'Server error loading validation form.'));
  }
};


/**
 * POST
 * /purchasing/purchases/:id/validate
 *
 * Receives one physical delivery.
 *
 * IMPORTANT:
 * receivedQuantity in the request means:
 *
 * "How much arrived in THIS delivery?"
 *
 * It does NOT mean cumulative quantity.
 */
exports.validate = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate('items.sparePart')
      .populate('items.chair');

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found.'
      });
    }

    /**
     * Receiving is allowed only while ORDERED or PARTIALLY_RECEIVED.
     */
    if (
      purchase.status !== 'ORDERED' &&
      purchase.status !== 'PARTIALLY_RECEIVED'
    ) {
      return res.status(400).json({
        success: false,
        message: `Purchase cannot be received because its status is ${purchase.status}.`
      });
    }

    let submittedItems = req.body.items || [];

    if (!Array.isArray(submittedItems)) {
      submittedItems = Object.values(submittedItems);
    }

    if (!submittedItems.length) {
      return res.status(400).json({
        success: false,
        message: 'No receiving items were submitted.'
      });
    }

    /**
     * Prevent duplicate PO item indexes.
     */
    const indexes = submittedItems.map(item =>
      Number(item.poItemIndex)
    );

    if (new Set(indexes).size !== indexes.length) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate purchase items were submitted.'
      });
    }

    /**
     * Build current cumulative receiving map.
     */
    resolveLegacyReceivedItems(purchase);

    const receivedMap = new Map();

    for (const receivedItem of purchase.receivedItems || []) {
      receivedMap.set(
        Number(receivedItem.poItemIndex),
        Number(receivedItem.receivedQuantity || 0)
      );
    }

    const receiptItems = [];

    let currentDeliveryAmount = 0;

    /**
     * Validate every submitted item.
     */
    for (const submitted of submittedItems) {
      const poItemIndex = Number(submitted.poItemIndex);

      if (
        !Number.isInteger(poItemIndex) ||
        poItemIndex < 0 ||
        poItemIndex >= purchase.items.length
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid purchase item.'
        });
      }

      const purchaseItem = purchase.items[poItemIndex];

      if (purchaseItem.itemType === 'service') {
        return res.status(400).json({
          success: false,
          message: 'Services cannot be received via material validation.'
        });
      }

      const orderedQuantity = Number(purchaseItem.quantity || 0);
      const previouslyReceived = Number(
        receivedMap.get(poItemIndex) || 0
      );

      /**
       * This is the quantity received TODAY.
       */
      const receivedNow = roundTo(
        Number(submitted.receivedQuantity || 0)
      );

      if (
        !Number.isFinite(receivedNow) ||
        receivedNow < 0
      ) {
        return res.status(400).json({
          success: false,
          message: `Invalid receiving quantity for item ${poItemIndex + 1}.`
        });
      }

      const remainingBefore = roundTo(
        Math.max(0, orderedQuantity - previouslyReceived)
      );

      /**
       * Do not allow over-receiving.
       */
      if (receivedNow > remainingBefore) {
        return res.status(400).json({
          success: false,
          message:
            `Item ${poItemIndex + 1}: ` +
            `only ${remainingBefore} remaining, ` +
            `but ${receivedNow} was entered.`
        });
      }

      /**
       * Ignore rows where nothing was received.
       */
      if (receivedNow === 0) {
        continue;
      }

      const totalReceived = roundTo(
        previouslyReceived + receivedNow
      );

      const remainingAfter = roundTo(
        Math.max(0, orderedQuantity - totalReceived)
      );

      const unitCost = roundTo(
        Number(purchaseItem.unitCost || 0)
      );

      const currentItemCost = roundTo(
        receivedNow * unitCost
      );

      currentDeliveryAmount = roundTo(
        currentDeliveryAmount + currentItemCost
      );

      /**
       * Determine item identity.
       */
      const itemId =
        purchaseItem.itemType === 'sparePart'
          ? purchaseItem.sparePart?._id || purchaseItem.sparePart
          : purchaseItem.chair?._id || purchaseItem.chair;

      const colorId =
        purchaseItem.chairColor?._id ||
        purchaseItem.chairColor ||
        null;

      /**
       * Match status for this delivery.
       *
       * At this point material comes from
       * the PO itself, so material is matched.
       */
      let matchStatus = 'MATCHED';

      if (receivedNow !== remainingBefore) {
        matchStatus = 'QUANTITY_MISMATCH';
      }

      receiptItems.push({
        poItemIndex,
        itemType: purchaseItem.itemType,
        sparePart:
          purchaseItem.itemType === 'sparePart'
            ? itemId
            : undefined,
        chair:
          purchaseItem.itemType === 'chair'
            ? itemId
            : undefined,
        chairColor: colorId || undefined,
        orderedQuantity,
        previouslyReceived,
        receivedQuantity: receivedNow,
        totalReceived,
        remainingQuantity: remainingAfter,
        unitCost,
        totalCost: currentItemCost
      });

      /**
       * Update cumulative received quantity.
       */
      receivedMap.set(
        poItemIndex,
        totalReceived
      );
    }

    if (!receiptItems.length) {
      return res.status(400).json({
        success: false,
        message: 'Please enter at least one quantity greater than zero.'
      });
    }

    /**
     * ---------------------------------------------------------
     * UPDATE STOCK
     * ---------------------------------------------------------
     *
     * IMPORTANT:
     * Only add the CURRENT DELIVERY quantity.
     *
     * Do NOT add cumulative received quantity.
     */
    for (const receiptItem of receiptItems) {
      const quantity = Number(receiptItem.receivedQuantity);

      if (receiptItem.itemType === 'sparePart') {
        const sparePart = await SparePart.findById(
          receiptItem.sparePart
        );

        if (!sparePart) {
          return res.status(400).json({
            success: false,
            message: `Spare part not found for item ${receiptItem.poItemIndex + 1}.`
          });
        }

        sparePart.stock =
          Number(sparePart.stock || 0) + quantity;

        await sparePart.save();
      }

      if (receiptItem.itemType === 'chair') {
        const chair = await Chair.findById(
          receiptItem.chair
        );

        if (!chair) {
          return res.status(400).json({
            success: false,
            message: `Chair not found for item ${receiptItem.poItemIndex + 1}.`
          });
        }

        /**
         * IMPORTANT:
         * Keep your existing chair/color stock
         * update logic here if your Chair model
         * stores stock differently.
         *
         * This assumes chair.stock exists.
         */
        chair.stock =
          Number(chair.stock || 0) + quantity;

        await chair.save();
      }
    }

    /**
     * ---------------------------------------------------------
     * UPDATE VENDOR BALANCE
     * ---------------------------------------------------------
     *
     * Only current delivery amount is added.
     *
     * If your existing Vendor model uses another
     * balance field, keep that existing field here.
     */
    if (currentDeliveryAmount > 0) {
      const vendor = await Vendor.findById(
        purchase.vendor._id || purchase.vendor
      );

      if (vendor) {
        vendor.balance = roundTo(
          Number(vendor.balance || 0) + currentDeliveryAmount
        );

        await vendor.save();
      }
    }

    /**
     * ---------------------------------------------------------
     * UPDATE CUMULATIVE RECEIVED ITEMS
     * ---------------------------------------------------------
     */
    for (const receiptItem of receiptItems) {
      const existingIndex =
        purchase.receivedItems.findIndex(
          item =>
            Number(item.poItemIndex) ===
            Number(receiptItem.poItemIndex)
        );

      const purchaseItem =
        purchase.items[receiptItem.poItemIndex];

      const cumulativeReceived =
        Number(receiptItem.totalReceived);

      const orderedQuantity =
        Number(receiptItem.orderedQuantity);

      const difference =
        orderedQuantity - cumulativeReceived;

      let matchStatus = 'MATCHED';

      if (cumulativeReceived < orderedQuantity) {
        matchStatus = 'QUANTITY_MISMATCH';
      }

      const cumulativeTotalCost = roundTo(
        cumulativeReceived * Number(purchaseItem.unitCost || 0)
      );

      const cumulativeItem = {
        poItemIndex: receiptItem.poItemIndex,
        itemType: receiptItem.itemType,
        sparePart: receiptItem.sparePart,
        chair: receiptItem.chair,
        chairColor: receiptItem.chairColor,
        orderedQuantity,
        receivedQuantity: cumulativeReceived,
        difference,
        unitCost: Number(purchaseItem.unitCost || 0),
        totalCost: cumulativeTotalCost,
        matchStatus
      };

      if (existingIndex === -1) {
        purchase.receivedItems.push(cumulativeItem);
      } else {
        purchase.receivedItems[existingIndex] = cumulativeItem;
      }
    }

    /**
     * ---------------------------------------------------------
     * CREATE RECEIPT HISTORY ENTRY
     * ---------------------------------------------------------
     */
    const billNumber = (req.body.billNumber || '').trim();

    purchase.receiptHistory.push({
      receivedAt: new Date(),
      receivedBy: req.session.user.id,
      items: receiptItems,
      receivedAmount: currentDeliveryAmount,
      billNumber,
      notes: req.body.validationNotes || ''
    });

    if (billNumber) {
      purchase.billNumber = billNumber;
    }

    /**
     * Cumulative received amount.
     */
    purchase.receivedAmount = roundTo(
      Number(purchase.receivedAmount || 0) + currentDeliveryAmount
    );

    purchase.validationNotes = req.body.validationNotes || '';
    purchase.receivedAt = new Date();
    purchase.receivedBy = req.session.user.id;

    /**
     * ---------------------------------------------------------
     * DETERMINE WHETHER EVERYTHING IS RECEIVED
     * ---------------------------------------------------------
     */
    let fullyReceived = true;

    for (let index = 0; index < purchase.items.length; index++) {
      if (purchase.items[index].itemType === 'service') continue;

      const orderedQuantity = Number(
        purchase.items[index].quantity || 0
      );

      const receivedQuantity = Number(
        receivedMap.get(index) || 0
      );

      if (receivedQuantity < orderedQuantity) {
        fullyReceived = false;
        break;
      }
    }

    if (fullyReceived) {
      purchase.status = 'RECEIVED';
      purchase.validationStatus = 'FULLY_VALIDATED';
      purchase.receivedAt = new Date();
      purchase.receivedBy = req.session.user.id;
    } else {
      /**
       * Still waiting for another delivery.
       */
      purchase.status = 'PARTIALLY_RECEIVED';
      purchase.validationStatus = 'PARTIALLY_VALIDATED';
    }

    purchase.updatedBy = req.session.user.id;

    await purchase.save();

    /**
     * ---------------------------------------------------------
     * REDIRECTION
     * ---------------------------------------------------------
     *
     * Fully received:
     *     → Purchase View
     *
     * Partial:
     *     → Receiving page again
     */
    const redirectUrl = fullyReceived
      ? `/purchasing/purchases/${purchase._id}`
      : `/purchasing/purchases/${purchase._id}/validate`;

    return res.status(200).json({
      success: true,
      fullyReceived,
      message: fullyReceived
        ? 'Purchase fully received.'
        : 'Partial receipt recorded successfully.',
      redirectUrl
    });
  } catch (error) {
    console.error('Error validating purchase:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to receive purchase.'
    });
  }
};


/**
 * POST
 * /purchasing/purchases/:id/short-close
 */
exports.shortClose = async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found.'
      });
    }

    if (
      purchase.status !== 'ORDERED' &&
      purchase.status !== 'PARTIALLY_RECEIVED'
    ) {
      return res.status(400).json({
        success: false,
        message: `Purchase cannot be short closed because its status is ${purchase.status}.`
      });
    }

    const reason = String(req.body.reason || '').trim();

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a reason for short closing the purchase.'
      });
    }

    /**
     * Make sure there really is something remaining.
     */
    resolveLegacyReceivedItems(purchase);

    let remainingQuantity = 0;

    for (let index = 0; index < purchase.items.length; index++) {
      if (purchase.items[index].itemType === 'service') continue;

      const ordered = Number(
        purchase.items[index].quantity || 0
      );

      const receivedItem = purchase.receivedItems.find(
        item => Number(item.poItemIndex) === index
      );

      const received = Number(
        receivedItem?.receivedQuantity || 0
      );

      remainingQuantity += Math.max(0, ordered - received);
    }

    if (remainingQuantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'This purchase is already fully received.'
      });
    }

    purchase.status = 'SHORT_CLOSED';
    purchase.shortClosedAt = new Date();
    purchase.shortClosedBy = req.session.user.id;
    purchase.shortCloseReason = reason;
    purchase.updatedBy = req.session.user.id;

    await purchase.save();

    return res.status(200).json({
      success: true,
      message: 'Purchase short closed successfully.',
      redirectUrl: `/purchasing/purchases/${purchase._id}`
    });
  } catch (error) {
    console.error('Error short closing purchase:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to short close purchase.'
    });
  }
};