const Production = require('../models/Production');
const SubAssembly = require('../models/SubAssembly');
const Chair = require('../models/Chair');
const SparePart = require('../models/SparePart');
const User = require('../models/User');
const mongoose = require('mongoose');

// Helper to generate production sequential numbers
async function generateProductionNumber(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const prefix = `PRD-${mm}-${yyyy}-`;

  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

  const count = await Production.countDocuments({
    date: { $gte: startOfMonth, $lte: endOfMonth }
  });

  return `${prefix}${String(count + 1).padStart(3, '0')}`;
}

exports.index = async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = (req.query.search || "").trim();

    const filter = {};

    if (search) {

      // Find matching supervisors/users
      const users = await User.find({
        fullName: { $regex: search, $options: "i" }
      }).select("_id");

      filter.$or = [
        { productionNo: { $regex: search, $options: "i" } },
        { status: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { supervisor: { $in: users.map(u => u._id) } }
      ];
    }

    const total = await Production.countDocuments(filter);

    const productions = await Production.find(filter)
      .populate("createdBy", "fullName")
      .populate("updatedBy", "fullName")
      .populate("supervisor", "fullName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.render("productions/index", {
      productions,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      user: req.session.user,
      activePage: "productions"
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
};

// Render Form Layout
exports.renderForm = async (req, res) => {
  try {
    const { id } = req.params;
    const mode = id ? 'edit' : 'new';
    
    let production = null;
    if (mode === 'edit') {
      production = await Production.findById(id).lean();
    }

    const subAssemblies = await SubAssembly.find({ isActive: true }).lean();
    const chairs = await Chair.find().lean();
    const supervisors = await User.find({}, 'fullName').lean();

    res.render('productions/form', {
      user: req.session.user,
      activePage: 'productions',
      mode,
      production,
      subAssemblies,
      chairs,
      supervisors,
      showBack: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading workspace view layouts.");
  }
};

// CREATE OR UPDATE PRODUCTION RUN
exports.saveProduction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { date, type, supervisor, status, notes, items } = req.body;
    const isEdit = !!id;

    let productionNo;
    if (isEdit) {
      const existing = await Production.findById(id).session(session);
      if (!existing) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).send("Production run log not found.");
      }
      productionNo = existing.productionNo;

      // Reverse stock movements from previous save state before rewriting changes
      await reverseProductionStock(existing, session);
    } else {
      productionNo = await generateProductionNumber(date);
    }

    let processedItems = [];

    for (const item of items || []) {
      if (!item) continue;
      
      // Ensure we have at least one valid identifier depending on the item type
      if (item.itemType === 'SubAssembly' && !item.subAssembly) continue;
      if (item.itemType === 'Chair' && !item.chair) continue;

      const targetQty = Number(item.quantityTarget) || 0;
      let componentsSnapshot = [];

      // Case A: Processing a Sub-Assembly production run
      if (item.itemType === 'SubAssembly' && item.subAssembly) {
        const sub = await SubAssembly.findById(item.subAssembly).session(session).lean();
        
        if (sub && sub.components && sub.components.length > 0) {
          const componentIds = sub.components.map(c => c.item);
          const spareParts = await SparePart.find({ _id: { $in: componentIds } }).session(session).lean();
          
          for (const comp of sub.components) {
            const matchedPart = spareParts.find(p => p._id.toString() === comp.item.toString());
            componentsSnapshot.push({
              componentType: 'sparePart',
              componentId: comp.item,
              name: matchedPart ? matchedPart.partName : 'Unknown Spare Part',
              quantityConsumed: Number(comp.quantity || 0) * targetQty
            });
          }
        }
      } 
      // Case B: Processing a Finished Chair production run
      else if (item.itemType === 'Chair' && item.chair) {
        const chairDoc = await Chair.findById(item.chair).session(session).lean();
        
        // 🔥 FIX: If your Chair model tracks dynamic components/bom arrays, resolve them here:
        if (chairDoc && chairDoc.components && chairDoc.components.length > 0) {
          const componentIds = chairDoc.components.map(c => c.item);
          const spareParts = await SparePart.find({ _id: { $in: componentIds } }).session(session).lean();
          
          for (const comp of chairDoc.components) {
            const matchedPart = spareParts.find(p => p._id.toString() === comp.item.toString());
            componentsSnapshot.push({
              componentType: 'sparePart',
              componentId: comp.item,
              name: matchedPart ? matchedPart.partName : 'Unknown Spare Part',
              quantityConsumed: Number(comp.quantity || 0) * targetQty
            });
          }
        }
      }

      processedItems.push({
        itemType: item.itemType,
        subAssembly: item.itemType === 'SubAssembly' ? item.subAssembly : null,
        chair: item.itemType === 'Chair' ? item.chair : null,
        chairColor: item.itemType === 'Chair' ? item.chairColor : null,
        quantityTarget: targetQty,
        quantityProduced: status === 'COMPLETED' ? targetQty : 0,
        componentsUsed: componentsSnapshot
      });
    }

    if (processedItems.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).send("Validation Error: Run requires at least one valid output item.");
    }

    let productionRecord;
    if (isEdit) {
      productionRecord = await Production.findByIdAndUpdate(
        id,
        { date, status, notes, items: processedItems, updatedBy: req.session.user.id },
        { new: true, session }
      );
    } else {
      const creatorId = req.session.user.id || req.session.user._id;
      const newProd = await Production.create([{
        productionNo,
        date,
        type,
        supervisor,
        status,
        notes,
        items: processedItems,
        createdBy: creatorId
      }], { session });
      productionRecord = newProd[0];
    }

    // Apply Stock adjustments if status is COMPLETED
    if (status === 'COMPLETED') {
      await applyProductionStock(productionRecord, session);
    }

    await session.commitTransaction();
    session.endSession();
    res.redirect('/production/productions');

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("Production engine failure detailed tracking context:", err);
    res.status(500).send(`Production processing transaction error: ${err.message}`);
  }
};

// STOCK MANAGEMENT HELPERS
async function applyProductionStock(production, session) {
  for (const pItem of production.items) {
    // 1. Deduct raw ingredients/components
    for (const comp of pItem.componentsUsed) {
      if (comp.componentId) {
        await SparePart.findByIdAndUpdate(
          comp.componentId, 
          { $inc: { stock: -Math.abs(comp.quantityConsumed) } }, 
          { session }
        );
      }
    }
    // 2. Add output item increments
    if (pItem.itemType === 'SubAssembly' && pItem.subAssembly) {
      await SubAssembly.findByIdAndUpdate(pItem.subAssembly, { $inc: { stock: pItem.quantityTarget } }, { session });
    } else if (pItem.itemType === 'Chair' && pItem.chair && pItem.chairColor) {
      await Chair.updateOne(
        { _id: pItem.chair, "colors._id": pItem.chairColor },
        { $inc: { "colors.$.stock": pItem.quantityTarget } },
        { session }
      );
    }
  }
}

async function reverseProductionStock(production, session) {
  if (production.status !== 'COMPLETED') return;
  
  for (const pItem of production.items) {
    // 1. Return components back to raw inventory
    for (const comp of pItem.componentsUsed) {
      if (comp.componentId) {
        await SparePart.findByIdAndUpdate(
          comp.componentId, 
          { $inc: { stock: Math.abs(comp.quantityConsumed) } }, 
          { session }
        );
      }
    }
    // 2. Remove produced output stock
    if (pItem.itemType === 'SubAssembly' && pItem.subAssembly) {
      await SubAssembly.findByIdAndUpdate(pItem.subAssembly, { $inc: { stock: -pItem.quantityTarget } }, { session });
    } else if (pItem.itemType === 'Chair' && pItem.chair && pItem.chairColor) {
      await Chair.updateOne(
        { _id: pItem.chair, "colors._id": pItem.chairColor },
        { $inc: { "colors.$.stock": -pItem.quantityTarget } },
        { session }
      );
    }
  }
}

exports.view = async (req, res) => {
    try {

        const production = await Production.findById(req.params.id)
            .populate('createdBy', 'fullName')
            .populate('updatedBy', 'fullName')
            .populate('supervisor', 'fullName')
            .populate('items.subAssembly', 'name')
            .populate('items.chair', 'modelName colors')
            .lean();

        if (!production) {
            return res.redirect('/production/productions');
        }

        res.render('productions/view', {
            production,
            user: req.session.user,
            activePage: 'productions',
            showBack: true
        });

    } catch (err) {
        console.error(err);
        res.redirect('/production/productions');
    }
};

exports.editForm = async (req, res) => {
  try {
    const production = await Production.findById(req.params.id).lean();

    if (!production) {
      return res.redirect('/production/productions');
    }

    const subAssemblies = await SubAssembly.find({ isActive: true }).lean();

    const chairs = await Chair.find({ isActive: true }).lean();

    const supervisors = await User.find({}, 'fullName').lean();

    res.render('productions/form', {
      production,
      subAssemblies,
      chairs,
      supervisors,
      mode: 'edit',
      user: req.session.user,
      activePage: 'productions',
      showBack: true
    });

  } catch (err) {
    console.error(err);
    res.redirect('/production/productions');
  }
};

exports.update = async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();

  try {

    const {
      date,
      type,
      supervisor,
      status,
      notes,
      items
    } = req.body;

    const existing = await Production.findById(req.params.id).session(session);

    if (!existing) {
      await session.abortTransaction();
      session.endSession();
      return res.redirect('/production/productions');
    }

    await reverseProductionStock(existing, session);

    const processedItems = [];

    for (const item of items || []) {

      if (!item) continue;

      if (item.itemType === 'SubAssembly' && !item.subAssembly) continue;
      if (item.itemType === 'Chair' && !item.chair) continue;

      const targetQty = Number(item.quantityTarget) || 0;

      let componentsSnapshot = [];

      if (item.itemType === 'SubAssembly') {

        const sub = await SubAssembly.findById(item.subAssembly)
          .session(session)
          .lean();

        if (sub?.components?.length) {

          const ids = sub.components.map(c => c.item);

          const spareParts = await SparePart.find({
            _id: { $in: ids }
          }).lean();

          for (const comp of sub.components) {

            const part = spareParts.find(
              p => p._id.toString() === comp.item.toString()
            );

            componentsSnapshot.push({
              componentType: 'sparePart',
              componentId: comp.item,
              name: part?.partName || 'Unknown Spare Part',
              quantityConsumed: Number(comp.quantity) * targetQty
            });

          }

        }

      } else {

        const chair = await Chair.findById(item.chair)
          .session(session)
          .lean();

        if (chair?.components?.length) {

          const ids = chair.components.map(c => c.item);

          const spareParts = await SparePart.find({
            _id: { $in: ids }
          }).lean();

          for (const comp of chair.components) {

            const part = spareParts.find(
              p => p._id.toString() === comp.item.toString()
            );

            componentsSnapshot.push({
              componentType: 'sparePart',
              componentId: comp.item,
              name: part?.partName || 'Unknown Spare Part',
              quantityConsumed: Number(comp.quantity) * targetQty
            });

          }

        }

      }

      processedItems.push({
        itemType: item.itemType,
        subAssembly: item.itemType === 'SubAssembly' ? item.subAssembly : null,
        chair: item.itemType === 'Chair' ? item.chair : null,
        chairColor: item.itemType === 'Chair' ? item.chairColor : null,
        quantityTarget: targetQty,
        quantityProduced: status === 'COMPLETED' ? targetQty : 0,
        componentsUsed: componentsSnapshot
      });

    }

    const updatedProduction = await Production.findByIdAndUpdate(
      req.params.id,
      {
        date,
        type,
        supervisor,
        status,
        notes,
        items: processedItems,
        updatedBy: req.session.user.id
      },
      {
        new: true,
        session
      }
    );

    if (status === 'COMPLETED') {
      await applyProductionStock(updatedProduction, session);
    }

    await session.commitTransaction();
    session.endSession();

    res.redirect('/production/productions');

  } catch (err) {

    await session.abortTransaction();
    session.endSession();

    console.error(err);
    res.redirect(`/production/productions/${req.params.id}/edit`);

  }

};

exports.delete = async (req, res) => {

  const session = await mongoose.startSession();

  session.startTransaction();

  try {

    const production = await Production.findById(req.params.id)
      .session(session);

    if (!production) {

      await session.abortTransaction();
      session.endSession();

      return res.redirect('/production/productions');

    }

    await reverseProductionStock(production, session);

    await Production.findByIdAndDelete(req.params.id, {
      session
    });

    await session.commitTransaction();

    session.endSession();

    res.redirect('/production/productions');

  } catch (err) {

    await session.abortTransaction();
    session.endSession();

    console.error(err);

    res.redirect('/production/productions');

  }

};