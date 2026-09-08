const Purchase = require('../models/Purchase');
const Vendor = require('../models/Vendor');
const SparePart = require('../models/SparePart');
const Chair = require('../models/Chair');
const SparePartCategory = require('../models/SparePartCategory');
const mongoose = require('mongoose');
const imageToBase64 = require('../utils/imageToBase64');
const pdfGenerator = require('../utils/pdfGenerator');

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
      const itemType = item.itemType === 'chair' ? 'chair' : 'sparePart';
      const itemId = item.itemType === 'chair' ? (item.chair || item.itemId) : (item.sparePart || item.itemId);

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
      }

      formattedItems.push(itemData);
    }

    const purchaseNumber = await generatePoNumber();

    const purchase = await Purchase.create([{
      purchaseNumber,
      vendor,
      purchaseDate,
      deliverySchedule,
      deliveryAt,
      status: status || 'ORDERED',
      notes,
      items: formattedItems,
      receivedItems: [],
      totalAmount,
      receivedAmount: 0,
      validationStatus: 'NOT_VALIDATED',
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
      .populate('createdBy', 'fullName')
      .populate('updatedBy', 'fullName')
      .lean();

    if (!purchase) {
      return res.redirect('/purchasing/purchases');
    }

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

    let formattedItems = [];
    let totalAmount = 0;

    for (const item of items || []) {
      // Handle actual form field structure sent by HTML form
      const itemType = item.itemType === 'chair' ? 'chair' : 'sparePart';
      const itemId = item.itemType === 'chair' ? (item.chair || item.itemId) : (item.sparePart || item.itemId);

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
      }

      formattedItems.push(itemData);
    }

    const updatedPurchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      {
        vendor,
        purchaseDate,
        deliverySchedule,
        deliveryAt,
        status,
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

    if(purchase.status === 'RECEIVED') {
      return res.redirect(`/purchasing/purchases/${purchase._id}`);
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

    if (purchase.status !== 'ORDERED') {
      throw new Error(`Purchase cannot be validated because its status is ${purchase.status}`);
    }

    if (purchase.validationStatus === 'VALIDATED') {
      throw new Error('Purchase order has already been validated');
    }

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

    // AJAX Call -> Return payload
    if (isAjax) {
      return res.json({
        success: true,
        purchase,
        spareParts,
        chairs
      });
    }

    // Standard Browser Load -> Render View
    res.render('purchases/validate', {
      purchase,
      spareParts,
      chairs,
      user: req.session.user,
      activePage: 'purchases',
      showBack: true,
      error: null
    });

  } catch (err) {
    console.error('purchase.validateForm error:', err);

    // 1. Return JSON response for AJAX requests
    if (isAjax) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Error loading validation form.'
      });
    }

    // 2. Redirect back to Purchase Listing with query error for standard browser requests
    res.redirect('/purchasing/purchases?error=' + encodeURIComponent(err.message || 'Server error loading validation form.'));
  }
};

exports.validate = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const isAjax = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept?.includes('json');

  try {
    /* =====================================================
       LOAD PURCHASE & VALIDATE ELIGIBILITY
    ===================================================== */
    const purchase = await Purchase.findById(req.params.id).session(session);

    if (!purchase) {
      throw new Error("Purchase not found");
    }

    if (purchase.status !== "ORDERED") {
      throw new Error(
        `Purchase cannot be validated because its status is ${purchase.status}`
      );
    }

    if (purchase.validationStatus === "VALIDATED") {
      throw new Error("Purchase has already been validated");
    }

    /* =====================================================
       PARSE RECEIVED ITEMS SAFELY
    ===================================================== */
    let rawItems = req.body.items;

    // Handle case where items might be sent as JSON string
    if (typeof rawItems === 'string') {
      try {
        rawItems = JSON.parse(rawItems);
      } catch (e) {
        rawItems = {};
      }
    }

    /* =====================================================
       READ RECEIVED ITEMS
    ===================================================== */
    const receivedItems = Array.isArray(rawItems)
      ? rawItems
      : Object.values(rawItems || {});

    if (!receivedItems || receivedItems.length === 0) {
      throw new Error("No received items were provided");
    }

    const validatedItems = [];
    let receivedAmount = 0;

    /* =====================================================
       VALIDATE EACH PO LINE
    ===================================================== */
    for (const receivedItem of receivedItems) {
      const poItemIndex = Number(receivedItem.poItemIndex);

      if (
        !Number.isInteger(poItemIndex) ||
        poItemIndex < 0 ||
        poItemIndex >= purchase.items.length
      ) {
        throw new Error("Invalid purchase item selected");
      }

      const orderedItem = purchase.items[poItemIndex];

      const receivedQuantity = Number(receivedItem.receivedQuantity);

      if (!Number.isFinite(receivedQuantity) || receivedQuantity < 0) {
        throw new Error("Invalid received quantity specified");
      }

      if (!receivedItem.itemType) {
        throw new Error("Received item type is required");
      }

      if (!receivedItem.itemId) {
        throw new Error("Received material selection is required");
      }

      /* =================================================
         DETERMINE MATERIAL MATCH
      ================================================= */
      let materialMatches = false;

      if (receivedItem.itemType === "sparePart") {
        const sparePart = await SparePart.findById(receivedItem.itemId).session(session);

        if (!sparePart) {
          throw new Error("Received spare part not found in catalog");
        }

        materialMatches =
          orderedItem.itemType === "sparePart" &&
          orderedItem.sparePart &&
          orderedItem.sparePart.toString() === receivedItem.itemId.toString();
      } else if (receivedItem.itemType === "chair") {
        if (!receivedItem.colorId) {
          throw new Error("Chair color selection is required");
        }

        const chair = await Chair.findOne({
          _id: receivedItem.itemId,
          "colors._id": receivedItem.colorId,
        }).session(session);

        if (!chair) {
          throw new Error("Received chair/color combination not found in catalog");
        }

        materialMatches =
          orderedItem.itemType === "chair" &&
          orderedItem.chair &&
          orderedItem.chair.toString() === receivedItem.itemId.toString() &&
          orderedItem.chairColor &&
          orderedItem.chairColor.toString() === receivedItem.colorId.toString();
      } else {
        throw new Error("Invalid received item type");
      }

      /* =================================================
         MATCH STATUS & COSTS
      ================================================= */
      const quantityMatches = orderedItem.quantity === receivedQuantity;
      const quantityDifference = receivedQuantity - orderedItem.quantity;

      let matchStatus;
      if (materialMatches && quantityMatches) {
        matchStatus = "MATCHED";
      } else if (materialMatches && !quantityMatches) {
        matchStatus = "QUANTITY_MISMATCH";
      } else if (!materialMatches && quantityMatches) {
        matchStatus = "MATERIAL_MISMATCH";
      } else {
        matchStatus = "MATERIAL_AND_QUANTITY_MISMATCH";
      }

      const unitCost = Number(orderedItem.unitCost) || 0;
      const finalRate = Number(orderedItem.finalRate) || unitCost;
      const totalCost = receivedQuantity * finalRate;

      receivedAmount += totalCost;

      const validatedItem = {
        itemType: receivedItem.itemType,
        orderedQuantity: orderedItem.quantity,
        receivedQuantity,
        difference: quantityDifference,
        unitCost,
        totalCost,
        matchStatus,
      };

      if (receivedItem.itemType === "sparePart") {
        validatedItem.sparePart = receivedItem.itemId;
      }

      if (receivedItem.itemType === "chair") {
        validatedItem.chair = receivedItem.itemId;
        validatedItem.chairColor = receivedItem.colorId;
      }

      validatedItems.push(validatedItem);
    }

    /* =====================================================
       UPDATE STOCK
    ===================================================== */
    for (const item of validatedItems) {
      if (item.receivedQuantity <= 0) continue;

      if (item.itemType === "sparePart" && item.sparePart) {
        const result = await SparePart.updateOne(
          { _id: item.sparePart, isActive: true },
          { $inc: { stock: item.receivedQuantity } },
          { session }
        );

        if (result.matchedCount !== 1) {
          throw new Error("Unable to update stock for the selected spare part");
        }
      }

      if (item.itemType === "chair" && item.chair && item.chairColor) {
        const result = await Chair.updateOne(
          {
            _id: item.chair,
            isActive: true,
            "colors._id": item.chairColor,
          },
          { $inc: { "colors.$.stock": item.receivedQuantity } },
          { session }
        );

        if (result.matchedCount !== 1) {
          throw new Error("Unable to update stock for the selected chair color");
        }
      }
    }

    /* =====================================================
       UPDATE VENDOR BALANCE
    ===================================================== */
    if (receivedAmount > 0) {
      await Vendor.findByIdAndUpdate(
        purchase.vendor,
        { $inc: { balance: receivedAmount } },
        { session }
      );
    }

    /* =====================================================
       SAVE VALIDATION RESULT & COMMIT
    ===================================================== */
    purchase.receivedItems = validatedItems;
    purchase.receivedAmount = receivedAmount;
    purchase.validationStatus = "VALIDATED";
    purchase.validationNotes = req.body.validationNotes || "";
    purchase.status = "RECEIVED";
    purchase.receivedAt = new Date();
    purchase.receivedBy = req.session.user.id;

    await purchase.save({ session });

    await session.commitTransaction();
    session.endSession();

    if (isAjax) {
      return res.json({
        success: true,
        redirectUrl: `/purchasing/purchases/${purchase._id}`
      });
    }

    res.redirect(`/purchasing/purchases/${purchase._id}`);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error("purchase.validate error:", err);

    if (isAjax) {
      return res.status(400).json({
        success: false,
        message: err.message || "An unexpected error occurred during validation."
      });
    }

    res.status(400).send(err.message);
  }
};