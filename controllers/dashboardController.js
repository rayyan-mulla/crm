// controllers/dashboardController.js
const Lead = require('../models/Lead');
const User = require('../models/User');
const Chair = require('../models/Chair');
const mongoose = require('mongoose');

exports.getDashboard = async (req, res) => {
  try {
    const user = req.session.user;

    const summary = {
      totalLeads: 0,
      newLeads: 0,
      inProgressLeads: 0,
      closedLeads: 0
    };

    const charts = {
      status: { labels: ['New', 'In Progress', 'Closed'], data: [0, 0, 0] },
      source: { labels: [], data: [] },
      chairsByUser: { labels: [], data: [] },
      revenueByUser: { labels: [], data: [] },
      chairsByModel: { labels: [], data: [] },
      monthlyTrend: { labels: [], chairs: [], revenue: [] }
    };

    let usersData = [];
    let activity = [];

    if (user.role === 'admin') {
      // --- Admin: all leads ---
      const allLeads = await Lead.find()
        .populate('assignedTo', 'fullName')
        .populate('normalizedRequirements.chair', 'modelName colors')
        .lean();

      // Summary
      summary.totalLeads = allLeads.length;
      summary.newLeads = allLeads.filter(l => l.status === 'New').length;
      summary.inProgressLeads = allLeads.filter(l => l.status === 'In Progress').length;
      summary.closedLeads = allLeads.filter(l => l.status === 'Closed').length;

      // Leads by source
      const sourceCount = {};
      for (const l of allLeads) {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      }
      charts.source.labels = Object.keys(sourceCount);
      charts.source.data = Object.values(sourceCount);

      // User performance table
      const allUsers = await User.find({ role: { $in: ['user', 'admin'] } }).lean();

      usersData = allUsers.map(u => {
        const userLeads = allLeads.filter(l => {
          const assignedToMatch = l.assignedTo?._id?.toString() === u._id.toString();
          const importedByMatch = l.sourceMeta?.importedBy?.toString() === u._id.toString();
          const uploadedByMatch = l.sourceMeta?.uploadedBy?.toString() === u._id.toString();
          const createdByMatch = l.sourceMeta?.createdBy?.toString() === u._id.toString();
          return assignedToMatch || importedByMatch || uploadedByMatch || createdByMatch;
        });

        const newLeads = userLeads.filter(l => l.status === 'New').length;
        const inProgressLeads = userLeads.filter(l => l.status === 'In Progress').length;
        const closedLeads = userLeads.filter(l => l.status === 'Closed').length;

        return {
          fullName: u.fullName,
          role: u.role,
          totalLeads: userLeads.length,
          newLeads,
          inProgressLeads,
          closedLeads,
          conversionRate: userLeads.length ? Math.round((closedLeads / userLeads.length) * 100) : 0
        };
      });

      // --- Chair & revenue analytics (ONLY Closed leads) ---
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

      // Monthly trend (Closed only)
      const monthlyStats = {};
      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const d = new Date(l.updatedAt);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
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
      // --- User: only own leads ---
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
      summary.totalLeads = myLeads.length;
      summary.newLeads = myLeads.filter(l => l.status === 'New').length;
      summary.inProgressLeads = myLeads.filter(l => l.status === 'In Progress').length;
      summary.closedLeads = myLeads.filter(l => l.status === 'Closed').length;

      // Leads by source
      const sourceCount = {};
      for (const l of myLeads) {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      }
      charts.source.labels = Object.keys(sourceCount);
      charts.source.data = Object.values(sourceCount);

      // Self performance row
      const newLeads = summary.newLeads;
      const inProgressLeads = summary.inProgressLeads;
      const closedLeads = summary.closedLeads;

      usersData = [{
        fullName: user.fullName,
        role: user.role,
        totalLeads: summary.totalLeads,
        newLeads,
        inProgressLeads,
        closedLeads,
        conversionRate: summary.totalLeads ? Math.round((closedLeads / summary.totalLeads) * 100) : 0
      }];

      // Chair & revenue analytics (ONLY Closed leads for this user)
      const closedWithReqs = myLeads.filter(
        l => l.status === 'Closed' && Array.isArray(l.normalizedRequirements) && l.normalizedRequirements.length
      );

      const chairsByUser = {};
      const revenueByUser = {};
      const chairsByModel = {};

      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const userName = user.fullName; // self
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

       const monthlyStats = {};
      for (const l of closedWithReqs) {
        for (const req of l.normalizedRequirements) {
          const d = new Date(l.updatedAt);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
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

    // Status chart data
    charts.status.data = [summary.newLeads, summary.inProgressLeads, summary.closedLeads];

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
