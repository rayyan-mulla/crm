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

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Helper to build filter + sort from query (used by list + exports)
function buildLeadFilterAndSort(query) {
  const search    = (query.search || '').trim();
  const status    = query.status || '';
  const sortField = query.sortField || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;

  const assignedToRaw = (query.assignedTo || '').trim();
  const fromDateStr   = (query.fromDate || '').trim();
  const toDateStr     = (query.toDate || '').trim();

  const filter = {};

  // Search across multiple fields
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

  // Status filter (with "Other" special case)
  if (status) {
    if (status === 'Other') {
      filter.status = { $nin: ["New", "In Progress", "Assigned", "Deal Drop", "Closed"] };
    } else {
      filter.status = status;
    }
  }

  // Assigned person filter
  if (assignedToRaw) {
    if (mongoose.Types.ObjectId.isValid(assignedToRaw)) {
      filter.assignedTo = assignedToRaw;
    } else {
      console.warn('Invalid assignedTo id in query:', JSON.stringify(assignedToRaw));
    }
  }

  // SAFE Date range filter (Lead has a `date` field of type Date)
  const dateFilter = {};

  if (fromDateStr) {
    const fromDate = new Date(fromDateStr);
    if (!isNaN(fromDate.getTime())) {
      dateFilter.$gte = fromDate;
    } else {
      console.warn('Invalid fromDate query value:', fromDateStr);
    }
  }

  if (toDateStr) {
    const toDate = new Date(toDateStr);
    if (!isNaN(toDate.getTime())) {
      // include full "to" day
      toDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = toDate;
    } else {
      console.warn('Invalid toDate query value:', toDateStr);
    }
  }

  // Only attach `filter.date` if we actually got at least one valid bound
  if (Object.keys(dateFilter).length > 0) {
    filter.date = dateFilter;
  }

  const sort = { [sortField]: sortOrder };

  return { filter, sort };
}

exports.listLeads = async (req, res) => {
  try {
    // safer parsing for page + limit
    let page = parseInt(req.query.page || '1', 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit || '10', 10);
    if (isNaN(limit)) limit = 10;
    if (limit < 5) limit = 5;

    // ➜ use shared helper
    const { filter, sort } = buildLeadFilterAndSort(req.query);

    // If you want to restrict normal users to only their own leads,
    // you can re-enable this block; it works with all filters above.
    /*
    if (req.session && req.session.user && req.session.user.role === 'user') {
      const sessionId = req.session.user.id || req.session.user._id || req.session.user.uid;
      if (!sessionId) {
        console.warn('listLeads: user session id missing', req.session.user);
        filter.assignedTo = null;
      } else {
        let objId = null;
        try {
          objId = mongoose.Types.ObjectId(sessionId);
        } catch (e) {
          objId = null;
        }
        filter.assignedTo = objId ? { $in: [objId, sessionId] } : sessionId;
      }
    }
    */

    const total = await Lead.countDocuments(filter);

    let leads = await Lead.find(filter)
      .populate('assignedTo', 'fullName username role')
      .sort(sort) // <--- use sort from helper
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const sessionUser = req.session.user;
    const sessionId = sessionUser ? (sessionUser.id || sessionUser._id || sessionUser.uid) : null;
    const isAdmin = sessionUser && sessionUser.role === 'admin';

    // Add canEdit flag to each lead
    leads = leads.map(l => {
      const assignedId = l.assignedTo ? l.assignedTo._id.toString() : null;
      const canEdit =
        !!isAdmin ||
        (!!sessionId && !!assignedId && assignedId === String(sessionId));

      return {
        ...l,
        canEdit
      };
    });

    // Only admins need users for assignment dropdown/filter
    let users = [];
    users = await User.find(
      { role: { $in: ['user', 'admin'] } },
      'fullName role'
    ).lean();

    res.render('leads/list', {
      leads,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      query: req.query,   // includes search, status, assignedTo, fromDate, toDate, sort, limit
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

  // 1. Get current time and force it to an IST string
  const nowISTString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const nowIST = new Date(nowISTString);

  // 2. Your stored time (which is already IST)
  const lastInbound = new Date(lastInboundAt);

  // 3. Now the subtraction is accurate (IST - IST)
  const diff = nowIST.getTime() - lastInbound.getTime();
  const twentyFourHours = 24 * 60 * 60 * 1000;

  console.log(`DEBUG: Comparing IST Now (${nowIST}) with IST LastMsg (${lastInbound})`);
  console.log(`DEBUG: Hours passed: ${(diff / (1000 * 60 * 60)).toFixed(2)}`);

  return diff < twentyFourHours;
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

    // 1. Take whatever number we have (+91986... or 986...)
    // 2. Remove everything except digits
    // 3. Take only the last 10 digits
    const searchDigits = selectedTo ? selectedTo.toString().replace(/\D/g, '').slice(-10) : null;

    // ✅ filter chats by lead + from + to if provided
    const chatFilter = { lead: lead._id };

    if (searchDigits) {
      // ✅ This matches "9867549772" OR "+919867549772" OR "09867549772"
      // The "$" means "ends with these 10 digits"
      const phoneRegex = new RegExp(searchDigits + "$");

      chatFilter.$or = [
        { to: { $regex: phoneRegex } },
        { from: { $regex: phoneRegex } }
      ];
    }

    const chats = await Chat.find(chatFilter)
      .sort({ timestamp: 1 }) 
      .lean();

    // ensure requirements is always array
    lead.normalizedRequirements = lead.normalizedRequirements || [];

    // calculate session state
    const within24h = isWithin24Hours(lead.lastInboundAt);
    const canFreeChat = lead.hasReplied && within24h;

    let remainingSeconds = 0;
    if (canFreeChat && lead.lastInboundAt) {
      const nowISTString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const nowIST = new Date(nowISTString);
      const lastInbound = new Date(lead.lastInboundAt);

      const diffMs = nowIST.getTime() - lastInbound.getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      
      // Math.max(0, ...) ensures we never send a negative countdown to the user
      remainingSeconds = Math.max(0, Math.floor((twentyFourHoursMs - diffMs) / 1000));
    }

    // ✅ Add canEdit flag
    const sessionUser = req.session.user;
    const sessionId = sessionUser ? (sessionUser.id || sessionUser._id || sessionUser.uid) : null;
    const assignedId = lead.assignedTo ? lead.assignedTo._id.toString() : null;

    lead.canEdit = sessionUser.role === 'admin' ||
                   (assignedId && assignedId === sessionId.toString());

    console.log("DEBUG session check:", {
      hasReplied: lead.hasReplied,
      lastInboundAt: lead.lastInboundAt,
      remainingSeconds: remainingSeconds,
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
      lastInboundAt: lead.lastInboundAt,
      remainingSeconds: remainingSeconds,
      selectedFrom,
      selectedTo,
      user: req.session.user,
      activePage: 'leadsDetail',
      showBack: true
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

// Bulk-delete multiple leads (AJAX version)
exports.bulkDeleteLeads = async (req, res) => {
  try {
    // Only admins can bulk delete
    if (!req.session?.user || req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let { leadIds } = req.body;

    // Normalize leadIds to an array
    if (!Array.isArray(leadIds)) {
      leadIds = leadIds ? [leadIds] : [];
    }

    if (leadIds.length === 0) {
      return res.json({
        success: true,
        deleted: 0,
        skipped: 0,
        deletedIds: [],
        skippedIds: []
      });
    }

    // Fetch leads first to know which ones actually exist
    const leads = await Lead.find({ _id: { $in: leadIds } }, '_id').lean();

    if (!leads.length) {
      return res.json({
        success: true,
        deleted: 0,
        skipped: leadIds.length,
        deletedIds: [],
        skippedIds: leadIds.map(id => id.toString())
      });
    }

    const idsToDelete = leads.map(l => l._id.toString());
    const idsSet = new Set(idsToDelete);
    const skippedIds = leadIds
      .map(id => id.toString())
      .filter(id => !idsSet.has(id)); // requested but not found

    // Actually delete
    const result = await Lead.deleteMany({ _id: { $in: idsToDelete } });
    const deletedCount = result.deletedCount || 0;

    return res.json({
      success: true,
      deleted: deletedCount,
      skipped: skippedIds.length,
      deletedIds: idsToDelete,
      skippedIds
    });
  } catch (err) {
    console.error("bulkDeleteLeads error", err);
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
      activePage: 'leadsDetail',
      showBack: true
    });
  } catch (err) {
    console.error("requirementForm error", err);
    res.status(500).send("Server error");
  }
};

// Handle create or update in one place
exports.saveRequirement = async (req, res) => {
  try {
    if (req.params.reqId) {
      // ✅ update case (single)
      const { chairId, colorId, quantity, unitPrice, shippingUnit, note } = req.body;
      const qty = parseInt(quantity) || 1;
      const unit = parseFloat(unitPrice) || 0;
      const ship = parseFloat(shippingUnit) || 0;

      const gstApplicable = req.body.gstApplicable === 'true';

      const unitWithGst = gstApplicable ? unit * 1.18 : unit;
      const total = Math.round((unitWithGst + ship) * qty);

      await Lead.updateOne(
        { _id: req.params.id, "normalizedRequirements._id": req.params.reqId },
        {
          $set: {
            "normalizedRequirements.$.chair": chairId,
            "normalizedRequirements.$.colorId": colorId,
            "normalizedRequirements.$.quantity": qty,
            "normalizedRequirements.$.unitPrice": unit,
            "normalizedRequirements.$.shippingUnit": ship,
            "normalizedRequirements.$.gstApplicable": gstApplicable,
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

        const gstApplicable = r.gstApplicable === 'true';

        const unitWithGst = gstApplicable ? unit * 1.18 : unit;
        const total = Math.round((unitWithGst + ship) * qty);

        return {
          chair: r.chairId,
          colorId: r.colorId,
          quantity: qty,
          unitPrice: unit,
          shippingUnit: ship,
          gstApplicable,
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

exports.deleteRequirement = async (req, res) => {
  try {
    const { id, reqId } = req.params;

    await Lead.updateOne(
      { _id: id },
      {
        $pull: {
          normalizedRequirements: { _id: reqId }
        }
      }
    );

    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error("deleteRequirement error", err);
    res.status(500).send("Server error");
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

exports.saveQuantity = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    await Lead.findByIdAndUpdate(id, { quantity: parseInt(quantity) });
    res.redirect(`/leads/${id}`);
  } catch(err) {
    console.error('saveQuantity error', err);
    res.redirect(`/leads/${req.params.id}`);
  }
};

exports.saveCustomerType = async (req, res) => {
  try {
    const { id } = req.params;
    const { customerType } = req.body;
    await Lead.findByIdAndUpdate(id, { customerType });
    res.redirect(`/leads/${id}`);
  } catch (err) {
    console.error('saveCustomerType error', err);
    res.redirect(`/leads/${req.params.id}`);
  }
};

exports.exportLeadsExcel = async (req, res) => {
  try {
    const { filter, sort } = buildLeadFilterAndSort(req.query);

    const leads = await Lead.find(filter)
      .populate('assignedTo', 'fullName username role')
      .sort(sort)
      .lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leads');

    sheet.columns = [
      { header: '#',        key: 'index',       width: 6 },
      { header: 'Date',     key: 'date',        width: 12 },
      { header: 'Name',     key: 'customer',    width: 25 },
      { header: 'Contact',  key: 'contact',     width: 18 },
      { header: 'City',     key: 'city',        width: 18 },
      { header: 'Requirement', key: 'req',      width: 30 },
      { header: 'Status',   key: 'status',      width: 15 },
      { header: 'Assigned', key: 'assignedTo',  width: 25 },
    ];

    leads.forEach((lead, idx) => {
      sheet.addRow({
        index: idx + 1,
        date: lead.date ? lead.date.toISOString().slice(0,10) : '',
        customer: lead.customer_name || '',
        contact: lead.contact_number || '',
        city: lead.city || '',
        req: lead.requirement || '',
        status: lead.status || '',
        assignedTo: lead.assignedTo
          ? (lead.assignedTo.fullName || lead.assignedTo.username || '')
          : ''
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="leads.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportLeadsExcel error', err);
    res.status(500).send('Failed to export Excel');
  }
};

function formatDateDDMMYYYY(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '-';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

exports.exportLeadsPdf = async (req, res) => {
  try {
    const { filter, sort } = buildLeadFilterAndSort(req.query);

    const leads = await Lead.find(filter)
      .populate('assignedTo', 'fullName username role')
      .sort(sort)
      .lean();

    const doc = new PDFDocument({ margin: 30, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.pdf"');

    doc.pipe(res);

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text('Leads Report', { align: 'center' });
    doc.moveDown(1);

    // Table settings
    const margin = 30;
    const tableTop = 80;
    const headerRowHeight = 22;

    // Use a consistent font for table text
    doc.fontSize(10).font('Helvetica');

    // Fixed column widths that exactly fit (sum = 535)
    const columns = [
      { header: '#',           width: 25,  getValue: (lead, idx) => String(idx + 1) },
      { header: 'Date',        width: 60,  getValue: (lead) => formatDateDDMMYYYY(lead.date) },
      { header: 'Name',        width: 90,  getValue: (lead) => lead.customer_name || '' },
      { header: 'Contact',     width: 90,  getValue: (lead) => lead.contact_number || '' },
      { header: 'City',        width: 55,  getValue: (lead) => lead.city || '' },
      { header: 'Requirement', width: 100, getValue: (lead) => lead.requirement || '' },
      { header: 'Status',      width: 50,  getValue: (lead) => lead.status || '' },
      {
        header: 'Assigned',
        width: 65,
        getValue: (lead) => {
          if (!lead.assignedTo) return '';
          return lead.assignedTo.fullName || lead.assignedTo.username || '';
        }
      },
    ];

    // Compute dynamic row height for a given lead
    function getRowHeight(lead, index) {
      let maxHeight = 0;

      columns.forEach(col => {
        const text = String(col.getValue(lead, index) || '');
        const h = doc.heightOfString(text, {
          width: col.width - 6, // padding left/right
          align: 'left'
        });
        if (h > maxHeight) maxHeight = h;
      });

      return maxHeight + 8; // padding top/bottom
    }

    // Draw header row (fixed height)
    function drawHeader(y) {
      doc.fontSize(10).font('Helvetica-Bold');
      let x = margin;

      columns.forEach(col => {
        doc.rect(x, y, col.width, headerRowHeight).fillAndStroke('#f0f0f0', '#000000');
        doc
          .fillColor('#000000')
          .text(col.header, x + 3, y + 6, {
            width: col.width - 6,
            align: 'left'
          });
        x += col.width;
      });

      doc.fillColor('#000000').font('Helvetica');
    }

    // Draw one row with given rowHeight
    function drawRow(y, lead, index, rowHeight) {
      let x = margin;

      columns.forEach(col => {
        const text = String(col.getValue(lead, index) || '');

        // Cell border
        doc.rect(x, y, col.width, rowHeight).stroke();

        // Cell text
        doc.text(text, x + 3, y + 4, {
          width: col.width - 6,
          align: 'left'
        });

        x += col.width;
      });
    }

    // Start table
    let y = tableTop;
    drawHeader(y);
    y += headerRowHeight;

    // Body rows
    leads.forEach((lead, idx) => {
      const rowHeight = getRowHeight(lead, idx);

      // Page break if this row doesn't fit
      if (y + rowHeight > doc.page.height - margin) {
        doc.addPage();
        y = tableTop;
        drawHeader(y);
        y += headerRowHeight;
      }

      drawRow(y, lead, idx, rowHeight);
      y += rowHeight;
    });

    doc.end();
  } catch (err) {
    console.error('exportLeadsPdf error', err);
    res.status(500).send('Failed to export PDF');
  }
};
