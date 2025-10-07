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
    if (status) filter.status = status;
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
      requirement
    } = req.body;

    const lead = new Lead({
      date: date ? new Date(date) : new Date(),
      customer_name,
      contact_number,
      email_id,
      city,
      requirement,
      source: 'manual',
      status: 'New',
      sourceMeta: {
        createdBy: new mongoose.mongo.ObjectId(req.session.user.id),
        createdAt: new Date(),
        method: 'manual_form'
      },
      statusHistory: [
        {
          status: 'New',
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

    // ✅ fetch chats directly by lead._id
    const chats = await Chat.find({ lead: lead._id })
      .sort({ timestamp: 1 })
      .lean();

    // make sure normalizedRequirements is always an array
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

// Import from Google Sheet and save into DB
exports.importFromGoogle = async (req, res) => {
  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const rows = await getSheetRows(sheetId, 'Sheet1!A2:Z');

    const leads = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const externalId = `row_${i + 2}`; // keep track of row index as externalId

      const leadData = {
        date: r[0] ? new Date(r[0]) : new Date(),
        customer_name: r[1] || '',
        contact_number: r[2] || '',
        email_id: r[3] || '',
        city: r[4] || '',
        requirement: r[5] || '',
        status: 'New',
        source: 'google_sheet',
        sourceMeta: {
            sheetId: sheetId,
            row: r,
            rowNumber: i + 2,
            importedBy: new mongoose.mongo.ObjectId(req.session.user.id),
            importedAt: new Date()
        },
        externalId
      };

      // prevent duplicate imports (upsert by externalId)
      const lead = await Lead.findOneAndUpdate(
        { externalId, source: 'google_sheet' },
        { $set: leadData },
        { upsert: true, new: true }
      );

      leads.push(lead);
    }

    res.redirect('/leads');
  } catch (err) {
    console.error('importFromGoogle error', err);
    res.status(500).send('Error importing leads from Google Sheets');
  }
};

// Upload from Excel file and save into DB
exports.uploadFromExcel = [
  upload.single("excelFile"),
  async (req, res) => {
    try {
      const filePath = req.file.path;
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      const leads = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const externalId = `row_${i + 2}`; // Excel row index

        const leadData = {
          date: r["Date"] ? new Date(r["Date"]) : new Date(),
          customer_name: r["Customer Name"] || "",
          contact_number: r["Contact Number"] || "",
          email_id: r["Email ID"] || "",
          city: r["City"] || "",
          requirement: r["Requirement"] || "",
          status: "New",
          source: "excel_upload",
          sourceMeta: {
            fileName: req.file.originalname,
            row: r,
            rowNumber: i + 2,
            uploadedBy: new mongoose.mongo.ObjectId(req.session.user.id),
            uploadedAt: new Date()
          },
          externalId
        };

        // upsert by externalId & source
        const lead = await Lead.findOneAndUpdate(
          { externalId, source: "excel_upload" },
          { $set: leadData },
          { upsert: true, new: true }
        );

        leads.push(lead);
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
      ["Date", "Customer Name", "Contact Number", "Email", "City", "Requirement"]
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

exports.addRequirementForm = async (req, res) => {
  const lead = await Lead.findById(req.params.id).lean();
  const chairs = await Chair.find({ isActive: true }).lean();
  res.render('leads/addRequirement', { lead, chairs, user: req.session.user, activePage: 'addRequirement' });
};

exports.addRequirement = async (req, res) => {
  const { chairId, colorId, quantity, unitPrice, note } = req.body;

  const qty = parseInt(quantity) || 1;
  const unit = parseFloat(unitPrice) || 0;

  await Lead.findByIdAndUpdate(req.params.id, {
    $push: {
      normalizedRequirements: {
        chair: chairId,
        colorId,
        quantity: qty,
        unitPrice: unit,
        totalPrice: qty * unit,
        note
      }
    }
  });

  res.redirect(`/leads/${req.params.id}`);
};

exports.editRequirementForm = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('normalizedRequirements.chair')
      .lean();

    if (!lead) return res.redirect('/leads');

    const requirement = lead.normalizedRequirements.find(r => r._id.toString() === req.params.reqId);
    if (!requirement) {
      return res.redirect(`/leads/${req.params.id}`);
    }

    const chairs = await Chair.find({ isActive: true }).lean();

    res.render('leads/editRequirement', {
      lead,
      requirement,
      chairs,
      user: req.session.user,
      activePage: 'leadsDetail'
    });
  } catch (err) {
    console.error('editRequirementForm error', err);
    res.status(500).send('Server error');
  }
};

exports.updateRequirement = async (req, res) => {
  const { chairId, colorId, quantity, unitPrice, note } = req.body;

  const qty = parseInt(quantity) || 1;
  const unit = parseFloat(unitPrice) || 0;

  await Lead.updateOne(
    { _id: req.params.id, "normalizedRequirements._id": req.params.reqId },
    {
      $set: {
        "normalizedRequirements.$.chair": chairId,
        "normalizedRequirements.$.colorId": colorId,
        "normalizedRequirements.$.quantity": qty,
        "normalizedRequirements.$.unitPrice": unit,
        "normalizedRequirements.$.totalPrice": qty * unit,
        "normalizedRequirements.$.note": note
      }
    }
  );

  res.redirect(`/leads/${req.params.id}`);
};