const ProductCategory = require('../models/ProductCategory');

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

    const total = await ProductCategory.countDocuments(filter);

    const categories = await ProductCategory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('productCategories/index', {
      categories,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'productCategories'
    });
  } catch (err) {
    console.error('productCategories.index error', err);
    res.status(500).send('Server error');
  }
};

// New form
exports.newForm = (req, res) => {
  res.render('productCategories/form', {
    mode: 'create',
    category: {},
    user: req.session.user,
    activePage: 'productCategories',
    showBack: true
  });
};

// Create
exports.create = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    await ProductCategory.create({
      name,
      isActive: !!isActive
    });

    res.redirect('/production/product-categories');
  } catch (err) {
    console.error('productCategories.create error', err);
    res.redirect('/production/product-categories/new');
  }
};

// Edit form
exports.editForm = async (req, res) => {
  try {
    const category = await ProductCategory.findById(req.params.id).lean();

    if (!category) return res.redirect('/production/product-categories');

    res.render('productCategories/form', {
      mode: 'edit',
      category,
      user: req.session.user,
      activePage: 'productCategories',
      showBack: true
    });
  } catch (err) {
    console.error('productCategories.editForm error', err);
    res.status(500).send('Server error');
  }
};

// Update
exports.update = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    await ProductCategory.findByIdAndUpdate(req.params.id, {
      name,
      isActive: !!isActive
    }, { runValidators: true });

    res.redirect('/production/product-categories');
  } catch (err) {
    console.error('productCategories.update error', err);
    res.redirect(`/production/product-categories/${req.params.id}/edit`);
  }
};

// Delete category
exports.destroy = async (req, res) => {
  try {
    await ProductCategory.findByIdAndDelete(req.params.id);
  } catch (err) {
    console.error('productCategories.destroy error', err);
  }
  res.redirect('/production/product-categories');
};