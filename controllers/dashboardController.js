// controllers/dashboardController.js
const Lead = require('../models/Lead');
const User = require('../models/User');
const mongoose = require('mongoose');

exports.getDashboard = async (req, res) => {
  try {
    const user = req.session.user;

    let summary = {
      totalLeads: 0,
      newLeads: 0,
      inProgressLeads: 0,
      closedLeads: 0
    };

    let charts = {
      status: { labels: ['New', 'In Progress', 'Closed'], data: [0, 0, 0] },
      source: { labels: [], data: [] }
    };

    let usersData = [];
    let activity = [];

    if (user.role === 'admin') {
      // Admin sees all leads
      const allLeads = await Lead.find()
        .populate('assignedTo', 'fullName')
        .lean();

      // Summary counts
      summary.totalLeads = allLeads.length;
      summary.newLeads = allLeads.filter(l => l.status === 'New').length;
      summary.inProgressLeads = allLeads.filter(l => l.status === 'In Progress').length;
      summary.closedLeads = allLeads.filter(l => l.status === 'Closed').length;

      // Leads by source
      const sourceCount = {};
      allLeads.forEach(l => {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      });
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

      // Recent activity (latest 10 leads)
      activity = allLeads
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
        .map(l => ({
          message: `${l.customer_name} - ${l.status} (${l.assignedTo ? 'Assigned to ' + l.assignedTo.fullName : 'Unassigned'})`,
          time: new Date(l.updatedAt).toLocaleString()
        }));

    } else {
      // User sees only their leads
      const userObjectId = new mongoose.Types.ObjectId(user.id);
      const myLeads = await Lead.find({
        $or: [
          { assignedTo: userObjectId },
          { 'sourceMeta.createdBy': userObjectId }
        ]
      })
        .populate('assignedTo', 'fullName')
        .lean();

      // Summary
      summary.totalLeads = myLeads.length;
      summary.newLeads = myLeads.filter(l => l.status === 'New').length;
      summary.inProgressLeads = myLeads.filter(l => l.status === 'In Progress').length;
      summary.closedLeads = myLeads.filter(l => l.status === 'Closed').length;

      // Leads by source
      const sourceCount = {};
      myLeads.forEach(l => {
        const s = l.source || 'Other';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      });
      charts.source.labels = Object.keys(sourceCount);
      charts.source.data = Object.values(sourceCount);

      // Recent activity
      activity = myLeads
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10)
        .map(l => ({
          message: `${l.customer_name} - ${l.status} (${l.assignedTo ? 'Assigned to ' + l.assignedTo.fullName : 'Unassigned'})`,
          time: new Date(l.updatedAt).toLocaleString()
        }));

      // User performance (for self only)
      const newLeads = myLeads.filter(l => l.status === 'New').length;
      const inProgressLeads = myLeads.filter(l => l.status === 'In Progress').length;
      const closedLeads = myLeads.filter(l => l.status === 'Closed').length;

      usersData = [{
        fullName: user.fullName,
        role: user.role,
        totalLeads: myLeads.length,
        newLeads,
        inProgressLeads,
        closedLeads,
        conversionRate: myLeads.length ? Math.round((closedLeads / myLeads.length) * 100) : 0
      }];
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
