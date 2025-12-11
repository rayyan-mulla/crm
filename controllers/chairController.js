const Chair = require('../models/Chair');

// List
exports.index = async (req, res) => {
  try {
    const chairs = await Chair.find().sort({ createdAt: -1 }).lean();
    res.render('chairs/index', {
      chairs,
      user: req.session.user,
      activePage: 'chairs'
    });
  } catch (err) {
    console.error('chairs.index error', err);
    res.status(500).send('Server error');
  }
};

// New form
exports.newForm = (req, res) => {
  res.render('chairs/form', {
    mode: 'create',
    chair: { modelName: '', colors: [] },
    user: req.session.user,
    activePage: 'chairs',
    showBack: true
  });
};

// Create
exports.create = async (req, res) => {
  try {
    const { modelName } = req.body;

    // Parse colors sent as arrays: colorName[], colorPrice[]
    const colors = [];
    const colorName = Array.isArray(req.body.colorName) ? req.body.colorName : (req.body.colorName ? [req.body.colorName] : []);
    const colorPrice = Array.isArray(req.body.colorPrice) ? req.body.colorPrice : (req.body.colorPrice ? [req.body.colorPrice] : []);

    for (let i = 0; i < colorName.length; i++) {
      const name = (colorName[i] || '').trim();
      const price = Number(colorPrice[i]);
      if (!name) continue;
      colors.push({ name, basePrice: isNaN(price) ? 0 : price });
    }

    await Chair.create({ modelName, colors });
    res.redirect('/chairs');
  } catch (err) {
    console.error('chairs.create error', err);
    res.redirect('/chairs/new');
  }
};

// Edit form
exports.editForm = async (req, res) => {
  try {
    const chair = await Chair.findById(req.params.id).lean();
    if (!chair) return res.redirect('/chairs');
    res.render('chairs/form', {
      mode: 'edit',
      chair,
      user: req.session.user,
      activePage: 'chairs'
    });
  } catch (err) {
    console.error('chairs.editForm error', err);
    res.status(500).send('Server error');
  }
};

// Update (whole chair + colors)
exports.update = async (req, res) => {
  try {
    const { modelName, isActive } = req.body;

    // Rebuild colors from form (edit view sends arrays + each row has rowId if existing)
    const names = Array.isArray(req.body.colorName) ? req.body.colorName : (req.body.colorName ? [req.body.colorName] : []);
    const prices = Array.isArray(req.body.colorPrice) ? req.body.colorPrice : (req.body.colorPrice ? [req.body.colorPrice] : []);
    const ids    = Array.isArray(req.body.colorId) ? req.body.colorId : (req.body.colorId ? [req.body.colorId] : []);
    const actives= Array.isArray(req.body.colorActive) ? req.body.colorActive : (req.body.colorActive ? [req.body.colorActive] : []);

    const colors = [];
    for (let i = 0; i < names.length; i++) {
      const name = (names[i] || '').trim();
      if (!name) continue;
      const basePrice = Number(prices[i]);
      const _id = ids[i] || undefined;
      const isActiveRow = Array.isArray(actives) ? !!actives[i] : !!actives; // checkbox behavior
      colors.push({ _id, name, basePrice: isNaN(basePrice) ? 0 : basePrice, isActive: isActiveRow });
    }

    await Chair.findByIdAndUpdate(req.params.id, {
      modelName,
      isActive: !!isActive,
      colors
    }, { runValidators: true });

    res.redirect('/chairs');
  } catch (err) {
    console.error('chairs.update error', err);
    res.redirect(`/chairs/${req.params.id}/edit`);
  }
};

// Delete chair
exports.destroy = async (req, res) => {
  try {
    await Chair.findByIdAndDelete(req.params.id);
  } catch (err) {
    console.error('chairs.destroy error', err);
  }
  res.redirect('/chairs');
};

// Delete single color (AJAX or regular POST)
exports.deleteColor = async (req, res) => {
  try {
    const { id, colorId } = req.params;
    await Chair.findByIdAndUpdate(id, { $pull: { colors: { _id: colorId } } });
    res.redirect(`/chairs/${id}/edit`);
  } catch (err) {
    console.error('chairs.deleteColor error', err);
    res.redirect(`/chairs/${req.params.id}/edit`);
  }
};
