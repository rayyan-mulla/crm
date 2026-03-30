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
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('index', {
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
      user: req.session.user,
      activePage: 'purchases'
    });

  } catch (err) {

    console.error('purchase.newForm error', err);
    res.status(500).send('Server Error');

  }

};

// CREATE PURCHASE
exports.create = async (req, res) => {
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
      if (typeof item.item !== 'string') continue;

      const parts = item.item.split('_');
      if (parts.length !== 2) continue;

      const [type, id] = parts;

      console.log("ITEM:", item);

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

      if (type === 'spare') {
        itemData.sparePart = id;
      }

      if (type === 'chair') {
        itemData.chair = id;

        if (item.color) {
          itemData.chairColorId = item.color;
        }
      }

      formattedItems.push(itemData);
    }

    const purchaseNumber = await generatePurchaseNumber();

    await Purchase.create({
      purchaseNumber,
      vendor,
      invoiceNumber,
      purchaseDate,
      status,
      notes,
      items: formattedItems,
      totalAmount,
      createdBy: req.session.user.id
    });

    res.redirect('/purchasing/purchases');

  } catch (err) {
    console.error(err);
    res.redirect('/purchasing/purchases/new');
  }
};

// VIEW PURCHASE
exports.view = async (req, res) => {

  try {

    const purchase = await Purchase.findById(req.params.id)
      .populate('vendor')
      .populate('items.sparePart')
      .populate('items.chair')
      .lean();

    if (!purchase) {
      return res.redirect('/purchasing/purchases');
    }

    res.render('purchases/view', {
      purchase,
      user: req.session.user,
      activePage: 'purchases'
    });

  } catch (err) {

    console.error(err);
    res.redirect('/purchasing/purchases');

  }

};