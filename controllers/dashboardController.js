// controllers/dashboardController.js
const Lead = require('../models/Lead');
const User = require('../models/User');
const Chair = require('../models/Chair');
const mongoose = require('mongoose');

const FIXED_STATUSES = ['New', 'In Progress', 'Assigned', 'Deal Drop', 'Closed'];

exports.getDashboard = async (req, res) => {
  try {
    const user = req.session.user;

    const summary = {
      totalLeads: 0,
      newLeads: 0,
      inProgressLeads: 0,
      assignedLeads: 0,
      dealDropLeads: 0,
      closedLeads: 0,
      otherLeads: 0
    };

    const charts = {
      status: { labels: [], data: [], colors: [] },
      source: { labels: [], data: [] },
      chairsByUser: { labels: [], data: [] },
      revenueByUser: { labels: [], data: [] },
      chairsByModel: { labels: [], data: [] },
      monthlyTrend: { labels: [], chairs: [], revenue: [] }
    };

    let usersData = [];
    let activity = [];

    // ================== COMMON FUNCTION: count statuses ==================
    const countStatuses = (leads) => {
      const counts = {};
      for (const lead of leads) {
        const s = lead.status || 'Other';
        if (FIXED_STATUSES.includes(s)) {
          counts[s] = (counts[s] || 0) + 1;
        } else {
          counts['Other'] = (counts['Other'] || 0) + 1;
        }
      }
      return counts;
    };

    // ================== ADMIN ==================
    if (user.role === 'admin') {
      const allLeads = await Lead.find()
        .populate('assignedTo', 'fullName')
        .populate('normalizedRequirements.chair', 'modelName colors')
        .lean();

      // Summary
      const statusCount = countStatuses(allLeads);
      summary.totalLeads = allLeads.length;
      summary.newLeads = statusCount['New'] || 0;
      summary.inProgressLeads = statusCount['In Progress'] || 0;
      summary.assignedLeads = statusCount['Assigned'] || 0;
      summary.dealDropLeads = statusCount['Deal Drop'] || 0;
      summary.closedLeads = statusCount['Closed'] || 0;
      summary.otherLeads = statusCount['Other'] || 0;

      // Leads by source
      const sourceCount = {};
      for (const l of allLeads) {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      }
      charts.source.labels = Object.keys(sourceCount);
      charts.source.data = Object.values(sourceCount);

      // User performance
      const allUsers = await User.find({ role: { $in: ['user', 'admin'] } }).lean();

      usersData = allUsers.map(u => {
        const userLeads = allLeads.filter(l => {
          const assignedToMatch = l.assignedTo?._id?.toString() === u._id.toString();
          const importedByMatch = l.sourceMeta?.importedBy?.toString() === u._id.toString();
          const uploadedByMatch = l.sourceMeta?.uploadedBy?.toString() === u._id.toString();
          const createdByMatch = l.sourceMeta?.createdBy?.toString() === u._id.toString();
          return assignedToMatch || importedByMatch || uploadedByMatch || createdByMatch;
        });

        const userStatus = countStatuses(userLeads);

        return {
          fullName: u.fullName,
          role: u.role,
          totalLeads: userLeads.length,
          newLeads: userStatus['New'] || 0,
          inProgressLeads: userStatus['In Progress'] || 0,
          assignedLeads: userStatus['Assigned'] || 0,
          dealDropLeads: userStatus['Deal Drop'] || 0,
          closedLeads: userStatus['Closed'] || 0,
          otherLeads: userStatus['Other'] || 0,
          conversionRate: userLeads.length ? Math.round(((userStatus['Closed'] || 0) / userLeads.length) * 100) : 0
        };
      });

      // Chair & revenue analytics (closed only)
      const closedWithReqs = allLeads.filter(
        l => l.status === 'Closed' && Array.isArray(l.normalizedRequirements) && l.normalizedRequirements.length
      );

      const chairsByUser = {};
      const revenueByUser = {};
      const chairsByModel = {};

      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const userName = l.assignedTo?.fullName || 'Unassigned';
          const modelName = req.chair?.modelName || 'Unknown Model';
          const qty = Number(req.quantity) || 0;
          const unit = Number(req.unitPrice) || 0;
          const totalAmount = unit * qty;

          chairsByUser[userName] = (chairsByUser[userName] || 0) + qty;
          revenueByUser[userName] = (revenueByUser[userName] || 0) + totalAmount;
          chairsByModel[modelName] = (chairsByModel[modelName] || 0) + qty;
        }
      }

      charts.chairsByUser = { labels: Object.keys(chairsByUser), data: Object.values(chairsByUser) };
      charts.revenueByUser = { labels: Object.keys(revenueByUser), data: Object.values(revenueByUser) };
      charts.chairsByModel = { labels: Object.keys(chairsByModel), data: Object.values(chairsByModel) };

      // Monthly trend
      const monthlyStats = {};
      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const d = new Date(l.updatedAt);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!monthlyStats[key]) monthlyStats[key] = { chairs: 0, revenue: 0 };
          const qty = Number(req.quantity) || 0;
          const unit = Number(req.unitPrice) || 0;
          monthlyStats[key].chairs += qty;
          monthlyStats[key].revenue += unit * qty;
        }
      }
      const sortedKeys = Object.keys(monthlyStats).sort();
      charts.monthlyTrend = {
        labels: sortedKeys,
        chairs: sortedKeys.map(k => monthlyStats[k].chairs),
        revenue: sortedKeys.map(k => monthlyStats[k].revenue)
      };

      // Recent activity
      activity = allLeads
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
        .map(l => ({
          message: `${l.customer_name} - ${l.status} (${l.assignedTo ? 'Assigned to ' + l.assignedTo.fullName : 'Unassigned'})`,
          time: new Date(l.updatedAt).toLocaleString()
        }));

    } else {
      // ================== USER ==================
      const userObjectId = new mongoose.Types.ObjectId(user.id);
      const myLeads = await Lead.find({
        $or: [
          { assignedTo: userObjectId },
          { 'sourceMeta.createdBy': userObjectId }
        ]
      })
        .populate('assignedTo', 'fullName')
        .populate('normalizedRequirements.chair', 'modelName colors')
        .lean();

      // Summary
      const statusCount = countStatuses(myLeads);
      summary.totalLeads = myLeads.length;
      summary.newLeads = statusCount['New'] || 0;
      summary.inProgressLeads = statusCount['In Progress'] || 0;
      summary.assignedLeads = statusCount['Assigned'] || 0;
      summary.dealDropLeads = statusCount['Deal Drop'] || 0;
      summary.closedLeads = statusCount['Closed'] || 0;
      summary.otherLeads = statusCount['Other'] || 0;

      // Leads by source
      const sourceCount = {};
      for (const l of myLeads) {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      }
      charts.source.labels = Object.keys(sourceCount);
      charts.source.data = Object.values(sourceCount);

      // Self performance
      usersData = [{
        fullName: user.fullName,
        role: user.role,
        totalLeads: summary.totalLeads,
        newLeads: summary.newLeads,
        inProgressLeads: summary.inProgressLeads,
        assignedLeads: summary.assignedLeads,
        dealDropLeads: summary.dealDropLeads,
        closedLeads: summary.closedLeads,
        otherLeads: summary.otherLeads,
        conversionRate: summary.totalLeads ? Math.round((summary.closedLeads / summary.totalLeads) * 100) : 0
      }];

      // Chair & revenue analytics
      const closedWithReqs = myLeads.filter(
        l => l.status === 'Closed' && Array.isArray(l.normalizedRequirements) && l.normalizedRequirements.length
      );

      const chairsByUser = {};
      const revenueByUser = {};
      const chairsByModel = {};

      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const userName = user.fullName;
          const modelName = req.chair?.modelName || 'Unknown Model';
          const qty = Number(req.quantity) || 0;
          const unit = Number(req.unitPrice) || 0;
          const totalAmount = unit * qty;

          chairsByUser[userName] = (chairsByUser[userName] || 0) + qty;
          revenueByUser[userName] = (revenueByUser[userName] || 0) + totalAmount;
          chairsByModel[modelName] = (chairsByModel[modelName] || 0) + qty;
        }
      }

      charts.chairsByUser = { labels: Object.keys(chairsByUser), data: Object.values(chairsByUser) };
      charts.revenueByUser = { labels: Object.keys(revenueByUser), data: Object.values(revenueByUser) };
      charts.chairsByModel = { labels: Object.keys(chairsByModel), data: Object.values(chairsByModel) };

      // Monthly trend
      const monthlyStats = {};
      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const d = new Date(l.updatedAt);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (!monthlyStats[key]) monthlyStats[key] = { chairs: 0, revenue: 0 };
          const qty = Number(req.quantity) || 0;
          const unit = Number(req.unitPrice) || 0;
          monthlyStats[key].chairs += qty;
          monthlyStats[key].revenue += unit * qty;
        }
      }
      const sortedKeys = Object.keys(monthlyStats).sort();
      charts.monthlyTrend = {
        labels: sortedKeys,
        chairs: sortedKeys.map(k => monthlyStats[k].chairs),
        revenue: sortedKeys.map(k => monthlyStats[k].revenue)
      };

      // Recent activity
      activity = myLeads
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
        .map(l => ({
          message: `${l.customer_name} - ${l.status} (${l.assignedTo ? 'Assigned to ' + l.assignedTo.fullName : 'Unassigned'})`,
          time: new Date(l.updatedAt).toLocaleString()
        }));
    }

    // ================== STATUS CHART ==================
    charts.status = {
      labels: [...FIXED_STATUSES, 'Other'],
      data: [
        summary.newLeads,
        summary.inProgressLeads,
        summary.assignedLeads,
        summary.dealDropLeads,
        summary.closedLeads,
        summary.otherLeads
      ],
      colors: [
        '#0d6efd', // New - Bootstrap Primary
        '#ffc107', // In Progress - Bootstrap Warning
        '#0dcaf0', // Assigned - Bootstrap Info
        '#dc3545', // Deal Drop - Bootstrap Danger
        '#198754', // Closed - Bootstrap Success
        '#6c757d'  // Other - Bootstrap Secondary
      ]
    };

    // Render view
    res.render('index', {
      user,
      summary,
      charts,
      users: usersData,
      activity,
      activePage: 'dashboard'
    });
  } catch (err) {
    console.error('Dashboard error', err);
    res.status(500).send('Server error');
  }
};
