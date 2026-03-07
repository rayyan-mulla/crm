const Vendor = require('../models/Vendor');


// LIST
exports.index = async (req, res) => {
  try {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || '').trim();

    const filter = {};

    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    const total = await Vendor.countDocuments(filter);

    const vendors = await Vendor.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render('vendors/index', {
      vendors,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: 'vendors'
    });

  } catch (err) {
    console.error('vendors.index error', err);
    res.status(500).send('Server error');
  }
};


// NEW FORM
exports.newForm = (req, res) => {

  res.render('vendors/form', {
    mode: 'create',
    vendor: {},
    user: req.session.user,
    activePage: 'vendors'
  });

};


// CREATE
exports.create = async (req, res) => {
  try {

    const { name, phone, email, gstin, address, isActive } = req.body;

    await Vendor.create({
      name,
      phone,
      email,
      gstin,
      address,
      isActive: !!isActive
    });

    res.redirect('/purchasing/vendors');

  } catch (err) {
    console.error('vendors.create error', err);
    res.redirect('/purchasing/vendors/new');
  }
};


// EDIT FORM
exports.editForm = async (req, res) => {
  try {

    const vendor = await Vendor.findById(req.params.id).lean();

    if (!vendor) return res.redirect('/purchasing/vendors');

    res.render('vendors/form', {
      mode: 'edit',
      vendor,
      user: req.session.user,
      activePage: 'vendors'
    });

  } catch (err) {
    console.error(err);
    res.redirect('/purchasing/vendors');
  }
};


// UPDATE
exports.update = async (req, res) => {
  try {

    const { name, phone, email, gstin, address, isActive } = req.body;

    await Vendor.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone,
        email,
        gstin,
        address,
        isActive: !!isActive
      },
      { runValidators: true }
    );

    res.redirect('/purchasing/vendors');

  } catch (err) {
    console.error(err);
    res.redirect(`/purchasing/vendors/${req.params.id}/edit`);
  }
};


// DELETE
exports.destroy = async (req, res) => {
  try {

    await Vendor.findByIdAndDelete(req.params.id);

  } catch (err) {
    console.error(err);
  }

  res.redirect('/purchasing/vendors');
};