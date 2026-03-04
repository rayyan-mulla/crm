const SparePart = require('../models/SparePart');
const SparePartCategory = require('../models/SparePartCategory');

// List
exports.index = async (req, res) => {
  try {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || '').trim();

    const filter = {};

    if (search) {
      filter.partName = new RegExp(search, 'i');
    }

    const total = await SparePart.countDocuments(filter);

    const spareParts = await SparePart.find(filter)
      .populate('category')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('spareParts/index', {
      spareParts,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'spareParts'
    });

  } catch (err) {
    console.error('spareParts.index error', err);
    res.status(500).send('Server error');
  }
};

// New Form
exports.newForm = async (req, res) => {

  const categories = await SparePartCategory
    .find({ isActive: true })
    .sort({ name: 1 })
    .lean();

  res.render('spareParts/form', {
    mode: 'create',
    sparePart: {},
    categories,
    user: req.session.user,
    activePage: 'spareParts',
    showBack: true
  });

};

// Create
exports.create = async (req, res) => {
  try {
    const {
      partName,
      category,
      unit,
      baseCost,
      gstApplicable,
      isActive
    } = req.body;

    const base = Number(baseCost);
    const gst = !!gstApplicable;
    const finalCost = gst ? base * 1.18 : base;

    await SparePart.create({
      partName,
      category,
      unit,
      baseCost: isNaN(base) ? 0 : base,
      gstApplicable: gst,
      finalCost: Math.round(finalCost * 100) / 100,
      isActive: !!isActive
    });

    res.redirect('/raw-materials/spare-parts');
  } catch (err) {
    console.error('spareParts.create error', err);
    res.redirect('/raw-materials/spare-parts/new');
  }
};

// Edit Form
exports.editForm = async (req, res) => {
  try {
    const sparePart = await SparePart.findById(req.params.id).lean();
    if (!sparePart) return res.redirect('/raw-materials/spare-parts');

    const categories = await SparePartCategory
      .find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.render('spareParts/form', {
      mode: 'edit',
      sparePart,
      categories,
      user: req.session.user,
      activePage: 'spareParts',
      showBack: true
    });
  } catch (err) {
    console.error('spareParts.editForm error', err);
    res.status(500).send('Server error');
  }
};

// Update
exports.update = async (req, res) => {
  try {
    const {
      partName,
      category,
      unit,
      baseCost,
      gstApplicable,
      isActive
    } = req.body;

    const base = Number(baseCost);
    const gst = !!gstApplicable;
    const finalCost = gst ? base * 1.18 : base;

    await SparePart.findByIdAndUpdate(
      req.params.id,
      {
        partName,
        category,
        unit,
        baseCost: isNaN(base) ? 0 : base,
        gstApplicable: gst,
        finalCost: Math.round(finalCost * 100) / 100,
        isActive: !!isActive
      },
      { runValidators: true }
    );

    res.redirect('/raw-materials/spare-parts');
  } catch (err) {
    console.error('spareParts.update error', err);
    res.redirect(`/raw-materials/spare-parts/${req.params.id}/edit`);
  }
};

// Delete
exports.destroy = async (req, res) => {
  try {
    await SparePart.findByIdAndDelete(req.params.id);
  } catch (err) {
    console.error('spareParts.destroy error', err);
  }

  res.redirect('/raw-materials/spare-parts');
};