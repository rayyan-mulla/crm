const Purchase = require('../models/Purchase');
const Vendor = require('../models/Vendor');
const SparePart = require('../models/SparePart');
const Chair = require('../models/Chair');
const SparePartCategory = require('../models/SparePartCategory');
const mongoose = require('mongoose');

async function generatePurchaseNumber() {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();

  const prefix = `PUR-${month}-${year}-`;

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

async function applyPurchase(purchase, session) {
  if (purchase.status !== 'PURCHASED') return;

  for (const item of purchase.items) {
    if (item.itemType === 'sparePart' && item.sparePart) {
      await SparePart.findByIdAndUpdate(
        item.sparePart,
        { $inc: { stock: item.quantity } },
        { session }
      );
    }

    if (item.itemType === 'chair' && item.chair) {
      await Chair.updateOne(
        { _id: item.chair, "colors._id": item.chairColor },
        { $inc: { "colors.$.stock": item.quantity } },
        { session }
      );
    }
  }

  await Vendor.findByIdAndUpdate(
    purchase.vendor,
    { $inc: { balance: purchase.totalAmount } },
    { session }
  );
}

async function reversePurchase(purchase, session) {
  if (purchase.status !== 'PURCHASED') return;

  for (const item of purchase.items) {
    if (item.itemType === 'sparePart' && item.sparePart) {
      await SparePart.findByIdAndUpdate(
        item.sparePart,
        { $inc: { stock: -item.quantity } },
        { session }
      );
    }

    if (item.itemType === 'chair' && item.chair) {
      await Chair.updateOne(
        { _id: item.chair, "colors._id": item.chairColor },
        { $inc: { "colors.$.stock": -item.quantity } },
        { session }
      );
    }
  }

  await Vendor.findByIdAndUpdate(
    purchase.vendor,
    { $inc: { balance: -purchase.totalAmount } },
    { session }
  );
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
      invoiceNumber,
      purchaseDate,
      status,
      notes,
      items
    } = req.body;

    let formattedItems = [];
    let totalAmount = 0;

    for (const item of items || []) {
      if (!item || !item.item) continue;

      const [type, id] = item.item.split('_');

      const quantity = Number(item.quantity) || 0;
      const basePrice = Number(item.basePrice) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const gstApplicable = item.gstApplicable ? true : false;

      const finalRate = gstApplicable ? unitCost * 1.18 : unitCost;
      const totalCost = quantity * finalRate;

      totalAmount += totalCost;

      let itemData = {
        itemType: type === 'spare' ? 'sparePart' : 'chair',
        quantity,
        basePrice,
        unitCost,
        gstApplicable,
        finalRate,
        totalCost
      };

      if (type === 'spare') itemData.sparePart = id;
      if (type === 'chair') {
        itemData.chair = id;
        if (item.color) itemData.chairColor = item.color;
      }

      formattedItems.push(itemData);
    }

    const purchaseNumber = await generatePurchaseNumber();

    const purchase = await Purchase.create([{
      purchaseNumber,
      vendor,
      invoiceNumber,
      purchaseDate,
      status,
      notes,
      items: formattedItems,
      totalAmount,
      createdBy: req.session.user.id
    }], { session });

    await applyPurchase(purchase[0], session);

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

// VIEW PURCHASE
exports.view = async (req, res) => {

  try {

    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate({
        path: 'items.sparePart',
        populate: { path: 'category' }
      })
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
      invoiceNumber,
      purchaseDate,
      status,
      notes,
      items
    } = req.body;

    let formattedItems = [];
    let totalAmount = 0;

    for (const item of items || []) {
      if (!item?.item) continue;

      const [type, id] = item.item.split('_');

      const quantity = Number(item.quantity) || 0;
      const basePrice = Number(item.basePrice) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const gstApplicable = item.gstApplicable ? true : false;

      const finalRate = gstApplicable ? unitCost * 1.18 : unitCost;
      const totalCost = quantity * finalRate;

      totalAmount += totalCost;

      let itemData = {
        itemType: type === 'spare' ? 'sparePart' : 'chair',
        quantity,
        basePrice,
        unitCost,
        gstApplicable,
        finalRate,
        totalCost
      };

      if (type === 'spare') itemData.sparePart = id;
      if (type === 'chair') {
        itemData.chair = id;
        if (item.color) itemData.chairColor = item.color;
      }

      formattedItems.push(itemData);
    }

    const oldPurchase = await Purchase.findById(req.params.id).session(session);

    await reversePurchase(oldPurchase, session);

    const updatedPurchase = await Purchase.findByIdAndUpdate(
      req.params.id,
      {
        vendor,
        invoiceNumber,
        purchaseDate,
        status,
        notes,
        items: formattedItems,
        totalAmount,
        updatedBy: req.session.user.id
      },
      { new: true, session }
    );

    await applyPurchase(updatedPurchase, session);

    await session.commitTransaction();
    session.endSession();

    res.redirect('/purchasing/purchases');

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error(err);
    res.redirect(`/purchasing/purchases/${req.params.id}/edit`);
  }
};

exports.delete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const purchase = await Purchase.findById(req.params.id).session(session);

    await reversePurchase(purchase, session);

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