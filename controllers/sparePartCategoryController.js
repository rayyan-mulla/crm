const SparePartCategory = require('../models/SparePartCategory');

// List
exports.index = async (req, res) => {
  try {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || '').trim();

    const filter = {};

    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    const total = await SparePartCategory.countDocuments(filter);

    const categories = await SparePartCategory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('sparePartCategories/index', {
      categories,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'sparePartCategories'
    });

  } catch (err) {
    console.error('category.index error', err);
    res.status(500).send('Server error');
  }
};

// New Form
exports.newForm = (req, res) => {

  res.render('sparePartCategories/form', {
    mode: 'create',
    category: {},
    user: req.session.user,
    activePage: 'sparePartCategories',
    showBack: true
  });

};

// Create
exports.create = async (req, res) => {

  try {

    const { name, isActive } = req.body;

    await SparePartCategory.create({
      name,
      isActive: !!isActive
    });

    res.redirect('/raw-materials/spare-part-categories');

  } catch (err) {

    console.error('category.create error', err);
    res.redirect('/raw-materials/spare-part-categories/new');

  }

};

// Edit Form
exports.editForm = async (req, res) => {

  try {

    const category = await SparePartCategory
      .findById(req.params.id)
      .lean();

    if (!category) {
      return res.redirect('/raw-materials/spare-part-categories');
    }

    res.render('sparePartCategories/form', {
      mode: 'edit',
      category,
      user: req.session.user,
      activePage: 'sparePartCategories',
      showBack: true
    });

  } catch (err) {

    console.error('category.editForm error', err);
    res.status(500).send('Server Error');

  }

};

// Update
exports.update = async (req, res) => {

  try {

    const { name, isActive } = req.body;

    await SparePartCategory.findByIdAndUpdate(
      req.params.id,
      {
        name,
        isActive: !!isActive
      },
      { runValidators: true }
    );

    res.redirect('/raw-materials/spare-part-categories');

  } catch (err) {

    console.error('category.update error', err);
    res.redirect(`/raw-materials/spare-part-categories/${req.params.id}/edit`);

  }

};

// Delete
exports.destroy = async (req, res) => {

  try {

    await SparePartCategory.findByIdAndDelete(req.params.id);

  } catch (err) {

    console.error('category.delete error', err);

  }

  res.redirect('/raw-materials/spare-part-categories');

};