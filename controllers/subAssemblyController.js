const SubAssembly = require('../models/SubAssembly');
const SparePart = require('../models/SparePart');

async function calculateBOMCost(componentsArray) {
  let totalBOM = 0;
  for (const comp of componentsArray) {
    const part = await SparePart.findById(comp.item).lean();
    if (part) {
      totalBOM += (part.baseCost || 0) * comp.quantity;
    }
  }
  return Math.round(totalBOM * 100) / 100;
}

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

    const total = await SubAssembly.countDocuments(filter);

    const subAssemblies = await SubAssembly.find(filter)
      .populate('components.item', 'partName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('subAssemblies/index', {
      subAssemblies,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'subAssemblies'
    });
  } catch (err) {
    console.error('subAssemblies.index error', err);
    res.status(500).send('Server error');
  }
};

// New form
exports.newForm = async (req, res) => {
  try {
    const spareParts = await SparePart.find({ isActive: true }).lean();

    res.render('subAssemblies/form', {
      mode: 'create',
      subAssembly: { components: [] },
      spareParts,
      user: req.session.user,
      activePage: 'subAssemblies',
      showBack: true
    });
  } catch (err) {
    console.error('subAssemblies.newForm error', err);
    res.status(500).send('Server error');
  }
};

// Create
exports.create = async (req, res) => {
  try {
    const { name, code, hsnCode, basePrice, gstApplicable, isActive } = req.body;

    const componentIds = Array.isArray(req.body.component) ? req.body.component : (req.body.component ? [req.body.component] : []);
    const quantities = Array.isArray(req.body.quantity) ? req.body.quantity : (req.body.quantity ? [req.body.quantity] : []);

    const components = [];
    for (let i = 0; i < componentIds.length; i++) {
      if (!componentIds[i]) continue;

      components.push({
        componentType: 'sparePart',
        item: componentIds[i],
        componentModel: 'SparePart',
        quantity: Number(quantities[i]) || 1
      });
    }

    const bomCost = await calculateBOMCost(components);

    const base = Number(basePrice) || 0;
    const gst = !!gstApplicable;
    const finalPrice = gst ? base * 1.18 : base;

    await SubAssembly.create({
      name,
      code,
      hsnCode,
      components,
      bomCost,
      basePrice: base,
      gstApplicable: gst,
      finalPrice: Math.round(finalPrice * 100) / 100,
      isActive: !!isActive
    });

    res.redirect('/production/sub-assemblies');
  } catch (err) {
    console.error('subAssemblies.create error', err);
    res.redirect('/production/sub-assemblies/new');
  }
};

// Edit form
exports.editForm = async (req, res) => {
  try {
    const subAssembly = await SubAssembly.findById(req.params.id)
      .populate('components.item')
      .lean();

    if (!subAssembly) return res.redirect('/production/sub-assemblies');

    const spareParts = await SparePart.find({ isActive: true }).lean();

    res.render('subAssemblies/form', {
      mode: 'edit',
      subAssembly,
      spareParts,
      user: req.session.user,
      activePage: 'subAssemblies',
      showBack: true
    });
  } catch (err) {
    console.error('subAssemblies.editForm error', err);
    res.status(500).send('Server error');
  }
};

// Update
exports.update = async (req, res) => {
  try {
    const { name, code, hsnCode, basePrice, gstApplicable, isActive } = req.body;

    const componentIds = Array.isArray(req.body.component) ? req.body.component : (req.body.component ? [req.body.component] : []);
    const quantities = Array.isArray(req.body.quantity) ? req.body.quantity : (req.body.quantity ? [req.body.quantity] : []);

    const components = [];
    for (let i = 0; i < componentIds.length; i++) {
      if (!componentIds[i]) continue;

      components.push({
        componentType: 'sparePart',
        item: componentIds[i],
        componentModel: 'SparePart',
        quantity: Number(quantities[i]) || 1
      });
    }

    const bomCost = await calculateBOMCost(components);

    const base = Number(basePrice) || 0;
    const gst = !!gstApplicable;
    const finalPrice = gst ? base * 1.18 : base;

    await SubAssembly.findByIdAndUpdate(req.params.id, {
      name,
      code,
      hsnCode,
      components,
      bomCost,
      basePrice: base,
      gstApplicable: gst,
      finalPrice: Math.round(finalPrice * 100) / 100,
      isActive: !!isActive
    }, { runValidators: true });

    res.redirect('/production/sub-assemblies');
  } catch (err) {
    console.error('subAssemblies.update error', err);
    res.redirect(`/production/sub-assemblies/${req.params.id}/edit`);
  }
};

// Delete subassembly
exports.destroy = async (req, res) => {
  try {
    await SubAssembly.findByIdAndDelete(req.params.id);
  } catch (err) {
    console.error('subAssemblies.destroy error', err);
  }
  res.redirect('/production/sub-assemblies');
};