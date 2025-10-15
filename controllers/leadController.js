// controllers/leadController.js
const Lead = require('../models/Lead');
const User = require('../models/User');
const Chair = require('../models/Chair');
const WhatsappNumber = require('../models/WhatsappNumber');
const Chat = require('../models/Chat');
const { getSheetRows } = require('../utils/googleSheets'); // optional, used by import
const mongoose = require('mongoose');
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const formatPhoneE164 = require('../utils/formatPhoneE164')

const upload = multer({ dest: "uploads/" });

exports.listLeads = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.max(5, parseInt(req.query.limit || '20'));
    const search = (req.query.search || '').trim();
    const status = req.query.status || '';
    const source = req.query.source || '';
    const sortField = req.query.sortField || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    // Build filter
    const filter = {};
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { customer_name: re },
        { email_id: re },
        { contact_number: re },
        { city: re },
        { requirement: re }
      ];
    }

    if (status) {
      if (status === 'Other') {
        // Show all statuses not in the main set
        filter.status = { $nin: ["New", "In Progress", "Assigned", "Deal Drop", "Closed"] };
      } else {
        filter.status = status;
      }
    }

    if (source) filter.source = source;

    // Restrict user view (robustly handle string/ObjectId stored values)
    if (req.session && req.session.user && req.session.user.role === 'user') {
      // session can store id as `id` or `_id`
      const sessionId = req.session.user.id || req.session.user._id || req.session.user.uid;
      if (!sessionId) {
        console.warn('listLeads: user session id missing', req.session.user);
        // no id — make filter impossible
        filter.assignedTo = null;
      } else {
        let objId = null;
        try {
          objId = mongoose.Types.ObjectId(sessionId);
        } catch (e) {
          objId = null;
        }
        // match either ObjectId or string form (covers both DB shapes)
        filter.assignedTo = objId ? { $in: [objId, sessionId] } : sessionId;
      }
    }

    // Count + query
    const total = await Lead.countDocuments(filter);
    const leads = await Lead.find(filter)
      .populate('assignedTo', 'fullName username role')
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Only admins need users for assignment
    let users = [];
    if (req.session && req.session.user && req.session.user.role === 'admin') {
      users = await User.find({ role: { $in: ['user', 'admin'] } }, 'fullName role').lean();
    }

    res.render('leads/list', {
      leads,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,
      users,
      user: req.session.user,
      activePage: 'leads'
    });
  } catch (err) {
    console.error('listLeads error', err);
    res.status(500).send('Server error');
  }
};

exports.getCreate = (req, res) => {
  res.render('leads/create', { error: null });
};

exports.postCreate = async (req, res) => {
  try {
    const {
      date,
      customer_name,
      contact_number,
      email_id,
      city,
      requirement,
      leadSource
    } = req.body;

    const isAdmin = req.session.user.role === 'admin';

    const lead = new Lead({
      date: date ? new Date(date) : new Date(),
      customer_name,
      contact_number,
      email_id,
      city,
      requirement,
      source: 'manual',
      leadSource: leadSource || null,
      status: isAdmin ? 'New' : 'Assigned',
      assignedTo: isAdmin ? null : new mongoose.mongo.ObjectId(req.session.user.id),
      sourceMeta: {
        createdBy: new mongoose.mongo.ObjectId(req.session.user.id),
        createdAt: new Date(),
        method: 'manual_form'
      },
      statusHistory: [
        {
          status: isAdmin ? 'New' : 'Assigned',
          changedBy: new mongoose.mongo.ObjectId(req.session.user.id),
          changedAt: new Date()
        }
      ]
    });

    await lead.save();
    res.redirect('/leads');
  } catch (err) {
    console.error('postCreate lead error', err);
    res.render('leads/create', {
      error: 'Could not create lead',
      user: req.session.user
    });
  }
};

async function fetchTemplates(businessAccountId, accessToken) {
  const url = `https://graph.facebook.com/v17.0/${businessAccountId}/message_templates`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return data.data.map(t => ({
    name: t.name,
    language: t.language
  }));
}

function isWithin24Hours(lastInboundAt) {
  if (!lastInboundAt) return false;
  const now = Date.now();
  const diff = now - new Date(lastInboundAt).getTime();
  return diff < 24 * 60 * 60 * 1000; // 24 hours in ms
}

exports.getLead = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.redirect('/leads');

    const lead = await Lead.findById(id)
      .populate('assignedTo', 'fullName username role')
      .populate('notes.user', 'fullName username')
      .populate('statusHistory.changedBy', 'fullName username')
      .populate('normalizedRequirements.chair')
      .lean();

    if (!lead) return res.redirect('/leads');

    // resolve sourceMeta user
    if (lead.sourceMeta) {
      const userId =
        lead.sourceMeta.importedBy ||
        lead.sourceMeta.uploadedBy ||
        lead.sourceMeta.createdBy ||
        null;
      if (userId) {
        const u = await User.findById(userId, 'fullName username').lean();
        lead.sourceMeta.byUser = u ? u.fullName : null;
      } else {
        lead.sourceMeta.byUser = null;
      }
    }

    let users = [];
    if (req.session.user && req.session.user.role === 'admin') {
      users = await User.find(
        { role: { $in: ['user', 'admin'] } },
        'fullName username role'
      ).lean();
    }

    // fetch WhatsApp numbers
    const whatsappNumbers = await WhatsappNumber.find({ isActive: true }).lean();

    // fetch WhatsApp templates
    const whatsappTemplates = await fetchTemplates(
      process.env.META_WABA_ID,
      process.env.META_USER_ACCESS_TOKEN
    );

    // ✅ new: figure out selected "from" and "to"
    const selectedFrom = req.query.from || lead.whatsappNumberId || null;
    const selectedTo = req.query.to || lead.contact_number || lead.alternate_number || null;

    // ✅ filter chats by lead + from + to if provided
    const chatFilter = { lead: lead._id };
    if (selectedFrom) chatFilter.from = selectedFrom;   // your WABA number id
    if (selectedTo) chatFilter.to = selectedTo;         // customer number

    const chats = await Chat.find(chatFilter)
      .sort({ timestamp: 1 })
      .lean();

    // ensure requirements is always array
    lead.normalizedRequirements = lead.normalizedRequirements || [];

    // calculate session state
    const within24h = isWithin24Hours(lead.lastInboundAt);
    const canFreeChat = lead.hasReplied && within24h;

    console.log("DEBUG session check:", {
      hasReplied: lead.hasReplied,
      lastInboundAt: lead.lastInboundAt,
      within24h,
      canFreeChat
    });

    res.render('leads/detail', {
      lead,
      assignableUsers: users,
      whatsappNumbers,
      chats,
      whatsappTemplates,
      within24h,
      canFreeChat,
      selectedFrom,
      selectedTo,
      user: req.session.user,
      activePage: 'leadsDetail'
    });
  } catch (err) {
    console.error('getLead error', err);
    res.status(500).send('Server error');
  }
};

exports.assignLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body; // user id (string)
    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).send('Not found');

    const oldAssign = lead.assignedTo ? lead.assignedTo.toString() : null;
    lead.assignedTo = userId; // mongoose will cast
    lead.status = 'Assigned';

    lead.statusHistory.push({
      status: 'Assigned',
      changedBy: req.session.user.id || req.session.user._id,
      createdAt: new Date()
    });

    await lead.save();
    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('assignLead', err);
    res.status(500).send('Server error');
  }
};

// Bulk-assign multiple leads to a single user (AJAX version)
exports.bulkAssignLeads = async (req, res) => {
  try {
    if (!req.session?.user || req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let { userId, leadIds } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    if (!Array.isArray(leadIds)) {
      leadIds = leadIds ? [leadIds] : [];
    }
    if (leadIds.length === 0) {
      return res.json({ success: true, assigned: 0, skipped: 0, assignedIds: [], skippedIds: [] });
    }

    const changedBy = req.session.user.id || req.session.user._id;
    const now = new Date();

    // Fetch user name for UI
    const assignedUser = await User.findById(userId).lean();

    // Find leads
    const leads = await Lead.find({ _id: { $in: leadIds } }).lean();

    const assignable = [];
    const skipped = [];

    for (const lead of leads) {
      if (!lead.assignedTo && lead.status !== 'Closed' && lead.status !== 'Deal Drop') {
        assignable.push(lead._id);
      } else {
        skipped.push(lead._id);
      }
    }

    let assignedCount = 0;
    if (assignable.length > 0) {
      const result = await Lead.updateMany(
        { _id: { $in: assignable } },
        {
          $set: { assignedTo: userId, status: 'Assigned' },
          $push: {
            statusHistory: {
              status: 'Assigned',
              changedBy,
              changedAt: now,
              notes: 'Bulk assignment'
            }
          }
        }
      );
      assignedCount = result.modifiedCount || 0;
    }

    return res.json({
      success: true,
      assigned: assignedCount,
      skipped: skipped.length,
      assignedIds: assignable.map(id => id.toString()),
      skippedIds: skipped.map(id => id.toString()),
      user: assignedUser ? (assignedUser.fullName || assignedUser.username) : "User"
    });
  } catch (err) {
    console.error("bulkAssignLeads error", err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    let { status, customStatus } = req.body;

    if (status === "__other__" && customStatus) {
      status = customStatus.trim();
    }

    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).send('Not found');

    lead.status = status;
    lead.statusHistory.push({ status, changedBy: req.session.user.id });
    await lead.save();
    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('updateStatus', err);
    res.status(500).send('Server error');
  }
};

exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const lead = await Lead.findById(id);
    if (!lead) return res.status(404).send('Not found');

    lead.notes.push({ text: note, user: req.session.user.id });
    await lead.save();
    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('addNote', err);
    res.status(500).send('Server error');
  }
};

function normalizeEmail(e) {
  if (!e) return null;
  const s = String(e).trim().toLowerCase();
  return s || null;
}

// Import from Google Sheet and save into DB
exports.importFromGoogle = async (req, res) => {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const rows = await getSheetRows(sheetId, 'Sheet1!A2:Z');

    const importedBy = req.session?.user?.id
      ? new mongoose.mongo.ObjectId(req.session.user.id)
      : undefined;

    const importedAt = new Date();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      // Pull fields from sheet
      const rawDate = r[0];
      const name = r[1] || '';
      const rawPhone = r[2] || '';
      const rawEmail = r[3] || '';
      const city = r[4] || '';
      const requirement = r[5] || '';
      const leadSource = r[6] || '';

      // Build a stable natural key
      let phone = null;
      try { phone = rawPhone ? formatPhoneE164(rawPhone) : null; } catch (_) { phone = null; }
      const email = normalizeEmail(rawEmail);

      // Build base payload from the sheet
      const sheetData = {
        date: rawDate ? new Date(rawDate) : new Date(),
        customer_name: name,
        contact_number: phone || rawPhone || '',
        email_id: email || '',
        city,
        requirement,
        leadSource: leadSource || null,
        source: 'google_sheet',
        sourceMeta: {
          sheetId,
          row: r,
          rowNumber: i + 2,       // keep for traceability only
          importedBy,
          importedAt
        }
      };

      // Try to find an existing lead by stable natural key (phone or email)
      let matchQuery = { source: 'google_sheet' };
      const or = [];
      if (phone) or.push({ contact_number: phone });
      if (email) or.push({ email_id: email });
      if (or.length > 0) {
        matchQuery.$or = or;
      } else {
        // No stable key (no phone/email) → never overwrite; always create new
        await Lead.create({
          ...sheetData,
          status: 'New',
          externalId: undefined // don't use row-based keys anymore
        });
        continue;
      }

      let lead = await Lead.findOne(matchQuery);

      if (lead) {
        // ✅ Update only sheet-driven fields; preserve status/notes/etc.
        lead.customer_name = sheetData.customer_name;
        if (phone) lead.contact_number = phone;       // maintain normalized phone
        lead.email_id = sheetData.email_id;
        lead.city = sheetData.city;
        lead.requirement = sheetData.requirement;
        lead.leadSource = sheetData.leadSource; 
        lead.sourceMeta = sheetData.sourceMeta;       // refresh import metadata
        // DO NOT touch lead.status or other CRM-managed fields
        await lead.save();
      } else {
        // ✅ New person (different phone/email): insert a new lead
        await Lead.create({
          ...sheetData,
          status: 'New',
          // optional: a more stable externalId, not row-based
          externalId: phone ? `gs_phone:${phone}` : (email ? `gs_email:${email}` : undefined)
        });
      }
    }

    res.redirect('/leads');
  } catch (err) {
    console.error('importFromGoogle error', err);
    res.status(500).send('Error importing leads from Google Sheets');
  }
};

exports.uploadFromExcel = [
  upload.single("excelFile"),
  async (req, res) => {
    try {
      const filePath = req.file.path;
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        // Normalize identifiers
        let phone = r["Contact Number"] ? r["Contact Number"].toString().trim() : null;
        let email = r["Email ID"] ? r["Email ID"].toString().trim().toLowerCase() : null;

        // Import fields (safe to overwrite)
        const importFields = {
          date: r["Date"] ? new Date(r["Date"]) : new Date(),
          customer_name: r["Customer Name"] || "",
          contact_number: phone || "",
          email_id: email || "",
          city: r["City"] || "",
          requirement: r["Requirement"] || "",
          leadSource: r["Lead Source"] || null,
          source: "excel_upload",
          sourceMeta: {
            fileName: req.file.originalname,
            row: r,
            rowNumber: i + 2,
            uploadedBy: new mongoose.mongo.ObjectId(req.session.user.id),
            uploadedAt: new Date()
          }
        };

        // ✅ Try to find existing lead by phone or email
        let matchQuery = { source: "excel_upload" };
        const or = [];
        if (phone) or.push({ contact_number: phone });
        if (email) or.push({ email_id: email });
        if (or.length > 0) matchQuery.$or = or;

        let lead = await Lead.findOne(matchQuery);

        if (lead) {
          // ✅ Update only import fields, keep CRM-managed fields
          lead.customer_name = importFields.customer_name;
          if (phone) lead.contact_number = phone;
          if (email) lead.email_id = email;
          lead.city = importFields.city;
          lead.requirement = importFields.requirement;
          lead.leadSource = importFields.leadSource;
          lead.sourceMeta = importFields.sourceMeta;
          await lead.save();
        } else {
          // ✅ Create new lead if no match found
          const externalId = phone 
            ? `excel_phone:${phone}` 
            : email 
              ? `excel_email:${email}` 
              : `excel_${req.file.originalname}_row_${i + 2}`;

          lead = new Lead({
            ...importFields,
            status: "New",
            externalId
          });
          await lead.save();
        }
      }

      // cleanup uploaded file
      fs.unlinkSync(filePath);

      res.redirect("/leads");
    } catch (err) {
      console.error("uploadFromExcel error", err);
      res.status(500).send("Error importing leads from Excel");
    }
  }
];

// Provide sample Excel template
exports.sampleExcel = (req, res) => {
  try {
    const headers = [
      ["Date", "Customer Name", "Contact Number", "Email", "City", "Requirement", "Lead Source"]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    // Write to buffer (no temp file)
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Disposition", "attachment; filename=sample-leads-template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("Error generating sample Excel:", err);
    res.status(500).send("Could not generate sample Excel");
  }
};

// Render form for both add & edit
exports.requirementForm = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('normalizedRequirements.chair')
      .lean();

    if (!lead) return res.redirect('/leads');

    const chairs = await Chair.find({ isActive: true }).lean();

    let requirement = null;
    let mode = "add";

    if (req.params.reqId) {
      // Editing case
      requirement = lead.normalizedRequirements.find(
        r => r._id.toString() === req.params.reqId
      );
      if (!requirement) return res.redirect(`/leads/${req.params.id}`);
      mode = "edit";
    }

    res.render('leads/requirementForm', {
      lead,
      requirement,
      chairs,
      mode,
      user: req.session.user,
      activePage: 'leadsDetail'
    });
  } catch (err) {
    console.error("requirementForm error", err);
    res.status(500).send("Server error");
  }
};

// Handle create or update in one place
// Handle create or update in one place
exports.saveRequirement = async (req, res) => {
  try {
    if (req.params.reqId) {
      // ✅ update case (single)
      const { chairId, colorId, quantity, unitPrice, shippingUnit, note } = req.body;
      const qty = parseInt(quantity) || 1;
      const unit = parseFloat(unitPrice) || 0;
      const ship = parseFloat(shippingUnit) || 0;
      const total = unit * qty;

      await Lead.updateOne(
        { _id: req.params.id, "normalizedRequirements._id": req.params.reqId },
        {
          $set: {
            "normalizedRequirements.$.chair": chairId,
            "normalizedRequirements.$.colorId": colorId,
            "normalizedRequirements.$.quantity": qty,
            "normalizedRequirements.$.unitPrice": unit,
            "normalizedRequirements.$.shippingUnit": ship,
            "normalizedRequirements.$.totalPrice": total,
            "normalizedRequirements.$.note": note
          }
        }
      );
    } else {
      // ✅ add case (multiple requirements from array)
      const requirements = req.body.requirements || [];

      const reqs = Object.values(requirements).map(r => {
        const qty = parseInt(r.quantity) || 1;
        const unit = parseFloat(r.unitPrice) || 0;
        const ship = parseFloat(r.shippingUnit) || 0;
        const total = unit * qty;

        return {
          chair: r.chairId,
          colorId: r.colorId,
          quantity: qty,
          unitPrice: unit,
          shippingUnit: ship,
          totalPrice: total,
          note: r.note || ""
        };
      });

      if (reqs.length) {
        await Lead.findByIdAndUpdate(req.params.id, {
          $push: { normalizedRequirements: { $each: reqs } }
        });
      }
    }

    res.redirect(`/leads/${req.params.id}`);
  } catch (err) {
    console.error("saveRequirement error", err);
    res.status(500).send("Server error");
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const { id } = req.params;

    await Lead.findByIdAndDelete(id);

    res.redirect('/leads');
  } catch (error) {
    console.error('Error deleting lead:', error);
    res.redirect('/leads');
  }
};

// NEW: Save/Update alternate number for a lead
exports.saveAlternateNumber = async (req, res) => {
  try {
    const { id } = req.params;
    let { alternate_number } = req.body;

    // optional: normalize/validate
    const formatPhoneE164 = require('../utils/formatPhoneE164');
    const formatted = alternate_number ? formatPhoneE164(alternate_number) : null;

    await Lead.findByIdAndUpdate(id, {
      $set: { alternate_number: formatted }
    });

    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('saveAlternateNumber error', err);
    res.redirect(`/leads/${req.params.id}`);
  }
};