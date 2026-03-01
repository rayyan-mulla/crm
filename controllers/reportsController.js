const Lead = require('../models/Lead');
const User = require('../models/User');
const Chair = require('../models/Chair');
const mongoose = require('mongoose');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const PDFDocument = require('pdfkit');
const path = require('path');

async function buildReportData(query){

  const {
    fromDate,
    toDate,
    assignedTo,
    source,
    customerType,
    model,
    search
  } = query;

  const filter = { status:'Deal Done' };

  if(source) filter.source = source;
  if(customerType) filter.customerType = customerType;

  if(assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)){
    filter.assignedTo = assignedTo;
  }

  if(search){
    filter.customer_name = { $regex: search, $options:'i' };
  }

  if(fromDate || toDate){
    filter.updatedAt = {};

    if(fromDate) filter.updatedAt.$gte = new Date(fromDate);

    if(toDate){
      const d = new Date(toDate);
      d.setHours(23,59,59,999);
      filter.updatedAt.$lte = d;
    }
  }

  const analyticsLeads = await Lead.find(filter)
    .populate('assignedTo','fullName')
    .populate('normalizedRequirements.chair')
    .lean();

  let filteredLeads = analyticsLeads;

  if(model){
    filteredLeads = analyticsLeads
      .map(lead=>{
        const newReqs = (lead.normalizedRequirements||[])
          .filter(r=>r.chair?.modelName===model);

        return {...lead, normalizedRequirements:newReqs};
      })
      .filter(l=>l.normalizedRequirements.length>0);
  }

  let totalRevenue = 0;
  let totalCost = 0;
  let totalChairs = 0;

  const chairsByModel = {};
  const revenueByUser = {};
  const revenueBySource = {};
  const monthly = {};

  const tableRows = [];

  for(const lead of filteredLeads){

    const userName = lead.assignedTo?.fullName || 'Unassigned';
    const src = lead.source || 'Unknown';

    for(const req of (lead.normalizedRequirements||[])){

      const chair = req.chair;
      if(!chair) continue;

      const color = chair.colors.find(
        c=>c._id.toString()===req.colorId.toString()
      );
      if(!color) continue;

      const qty = Number(req.quantity)||0;
      const sellUnit = Number(req.unitPrice)||0;
      const costUnit = Number(color.basePrice)||0;

      const revenue = sellUnit*qty;
      const cost = costUnit*qty;
      const profit = revenue-cost;

      totalRevenue += revenue;
      totalCost += cost;
      totalChairs += qty;

      revenueByUser[userName]=(revenueByUser[userName]||0)+revenue;
      revenueBySource[src]=(revenueBySource[src]||0)+revenue;

      const modelName = chair.modelName || 'Unknown';
      chairsByModel[modelName]=(chairsByModel[modelName]||0)+qty;

      const d=new Date(lead.updatedAt);
      const monthKey=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

      if(!monthly[monthKey])
        monthly[monthKey]={chairs:0,revenue:0,profit:0};

      monthly[monthKey].chairs+=qty;
      monthly[monthKey].revenue+=revenue;
      monthly[monthKey].profit+=profit;

      tableRows.push({
        date:lead.updatedAt,
        customer:lead.customer_name,
        user:userName,
        chair:modelName,
        color:color.name,
        qty,
        sellUnit,
        costUnit,
        profit,
        source:lead.source
      });
    }
  }

  const totalCount = filteredLeads.length;

  const avgDealValue = totalCount ? totalRevenue/totalCount : 0;
  const avgSellPrice = totalChairs ? totalRevenue/totalChairs : 0;

  const topModel =
    Object.entries(chairsByModel)
      .sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

  const topUser =
    Object.entries(revenueByUser)
      .sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

  return {
    summary:{
      totalRevenue,
      totalCost,
      totalProfit:totalRevenue-totalCost,
      totalChairs,
      totalDeals:totalCount,
      avgDealValue,
      avgSellPrice,
      topModel,
      topUser
    },
    charts:{
      chairsByModel,
      revenueByUser,
      monthly,
      revenueBySource
    },
    rows:tableRows
  };
}

exports.getReports = async (req,res)=>{
  try{

    const pageNum = parseInt(req.query.page)||1;
    const limitNum = parseInt(req.query.limit)||10;
    const skip = (pageNum-1)*limitNum;

    const reportData = await buildReportData(req.query);

    const users = await User.find({
      role:{ $in:['admin','user'] }
    }).lean();

    const allModels = await Chair.distinct('modelName');

    res.render('reports/index',{
      user:req.session.user,
      users,
      allModels,
      query:req.query,
      page:pageNum,
      limit:limitNum,
      totalPages:Math.ceil(reportData.rows.length/limitNum),

      summary:reportData.summary,
      charts:reportData.charts,
      rows:reportData.rows.slice(skip, skip+limitNum),

      activePage:'reports'
    });

  } catch(err){
    console.error("REPORT ERROR",err);
    res.status(500).send("Report error");
  }
};

exports.exportReportsPDF = async (req, res) => {
  try {

    const showAnalytics = req.query.showAnalytics === "true";
    const path = require("path");
    const PDFDocument = require("pdfkit");
    const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

    const valueLabelPlugin = {
      id: "valueLabelPlugin",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;

        chart.data.datasets.forEach((dataset, i) => {
          const meta = chart.getDatasetMeta(i);

          meta.data.forEach((el, index) => {
            const val = dataset.data[index];
            if (!val || isNaN(val)) return;

            const pos = el.tooltipPosition();

            ctx.save();
            ctx.font = "9px Arial";
            ctx.textAlign = "center";

            if (chart.config.type === "doughnut") {
              ctx.fillStyle = "#fff";
              ctx.fillText(val, pos.x, pos.y);
            } else {
              ctx.fillStyle = dataset.borderColor || "#000";
              ctx.fillText(val, pos.x, pos.y - 8);
            }

            ctx.restore();
          });
        });
      }
    };

    const data = await buildReportData(req.query);

    let assignedUserName = null;

    if (req.query.assignedTo && mongoose.Types.ObjectId.isValid(req.query.assignedTo)) {
      const assignedUser = await User.findById(req.query.assignedTo).lean();
      assignedUserName = assignedUser?.fullName || null;
    }

    const width = 600;
    const height = 300;

    const canvas = new ChartJSNodeCanvas({
      width,
      height,
      chartCallback: (ChartJS) => {
        ChartJS.register(valueLabelPlugin);
      }
    });

    const COLORS = [
      "#0d6efd","#ffc107","#0dcaf0",
      "#6f42c1","#198754","#dc3545","#6c757d"
    ];

    const safeData = (obj)=>{
      if(!obj) return {labels:[],values:[]};
      const labels=Object.keys(obj||{});
      const values=Object.values(obj||{});
      if(!labels.length) return {labels:['No Data'],values:[1]};
      return {labels,values};
    };

    const cleanNumber=(val)=>{
      return Number(String(val).replace(/[^\d.-]/g,'')) || 0;
    };

    const userSafe = safeData(data.charts.revenueByUser);
    const chairSafe = safeData(data.charts.chairsByModel);
    const sourceSafe = safeData(data.charts.revenueBySource);

    const monthlyValuesRevenue = Object.values(data.charts.monthly||{}).map(m=>cleanNumber(m?.revenue));
    const monthlyValuesProfit  = Object.values(data.charts.monthly||{}).map(m=>cleanNumber(m?.profit));

    const monthlyImage = await canvas.renderToBuffer({
      type:'line',
      data:{
        labels:Object.keys(data.charts.monthly||{}),
        datasets:[
          {label:'Revenue',data:monthlyValuesRevenue,borderColor:"#0d6efd",backgroundColor:"#0d6efd"},
          {label:'Profit',data:monthlyValuesProfit,borderColor:"#198754",backgroundColor:"#198754"}
        ]
      },
      options:{ plugins:{ legend:{display:true} } }
    });

    const userImage = await canvas.renderToBuffer({
      type:'doughnut',
      data:{
        labels:userSafe.labels,
        datasets:[{data:userSafe.values.map(cleanNumber),backgroundColor:COLORS}]
      },
      options:{ plugins:{ legend:{display:true} } }
    });

    const chairImage = await canvas.renderToBuffer({
      type:'doughnut',
      data:{
        labels:chairSafe.labels,
        datasets:[{data:chairSafe.values.map(cleanNumber),backgroundColor:COLORS}]
      },
      options:{ plugins:{ legend:{display:true} } }
    });

    const sourceImage = await canvas.renderToBuffer({
      type:'bar',
      data:{
        labels:sourceSafe.labels,
        datasets:[{label:'Revenue',data:sourceSafe.values.map(cleanNumber),backgroundColor:"#0d6efd",borderColor:"#0d6efd"}]
      },
      options:{ plugins:{ legend:{display:true} } }
    });

    const doc = new PDFDocument({size:'A4',margin:40});

    const fontRegular = path.join(__dirname,'../public/fonts/Roboto-Regular.ttf');
    const fontBold = path.join(__dirname,'../public/fonts/Roboto-Bold.ttf');

    doc.registerFont('Roboto',fontRegular);
    doc.registerFont('Roboto-Bold',fontBold);

    const logoPath = path.join(__dirname, '../public/images/logo.png');

    doc.font('Roboto');

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=reports.pdf');

    doc.pipe(res);

    doc.image(logoPath, 30, 30, { width: 60 });
    doc.font('Roboto-Bold').fontSize(18).text('Sales Reports Dashboard',{align:'center'});
    doc.moveDown();
    doc.font('Roboto');

    doc.font('Roboto-Bold').fontSize(10).text('Filters Applied:',{underline:true});
    doc.font('Roboto');
    doc.moveDown();

    const filters=[];
    if(req.query.search) filters.push(`Customer: ${req.query.search}`);
    if(req.query.fromDate) filters.push(`From: ${req.query.fromDate}`);
    if(req.query.toDate) filters.push(`To: ${req.query.toDate}`);
    if(assignedUserName) filters.push(`Assigned To: ${assignedUserName}`);
    if(req.query.source) filters.push(`Source: ${req.query.source}`);
    if(req.query.model) filters.push(`Model: ${req.query.model}`);

    doc.text(filters.length?filters.join(' | '):'None');
    doc.moveDown();

    doc.font('Roboto-Bold').fontSize(12).text('Summary',{underline:true});
    doc.font('Roboto');
    doc.moveDown();

    const leftX=40;
    const rightX=300;
    let y=doc.y;

    const grid=[
      ['Total Revenue',`₹${cleanNumber(data.summary.totalRevenue)}`],
      ['Total Profit',`₹${cleanNumber(data.summary.totalProfit)}`],
      ['Total Chairs',cleanNumber(data.summary.totalChairs)],
      ['Deals',cleanNumber(data.summary.totalDeals)],
      ['Avg Deal Value',`₹${Math.round(cleanNumber(data.summary.avgDealValue))}`],
      ['Avg Sell Price',`₹${Math.round(cleanNumber(data.summary.avgSellPrice))}`],
      ['Top Model',data.summary.topModel||'-'],
      ['Top Performer',data.summary.topUser||'-']
    ];

    grid.forEach((row,i)=>{
      const x=i%2===0?leftX:rightX;
      doc.fontSize(10).text(`${row[0]}: ${row[1]}`,x,y);
      if(i%2===1) y+=15;
    });

    doc.y=y+20;

    if (showAnalytics) {
      doc.font('Roboto-Bold').fontSize(12).text('Charts', 40, doc.y, {underline:true});
      doc.font('Roboto');
      doc.moveDown();

      let chartY = doc.y;

      doc.font('Roboto-Bold').fontSize(10).text('Revenue vs Profit', 40, chartY);
      doc.font('Roboto');
      doc.image(monthlyImage, 40, chartY + 15, { width: 240 });

      doc.font('Roboto-Bold').fontSize(10).text('Revenue by User', 300, chartY);
      doc.font('Roboto');
      doc.image(userImage, 300, chartY + 15, { width: 200 });

      chartY += 190;

      doc.font('Roboto-Bold').fontSize(10).text('Chairs Sold', 40, chartY);
      doc.font('Roboto');
      doc.image(chairImage, 40, chartY + 15, { width: 200 });

      doc.font('Roboto-Bold').fontSize(10).text('Revenue by Source', 300, chartY);
      doc.font('Roboto');
      doc.image(sourceImage, 300, chartY + 15, { width: 240 });

      doc.addPage();
    }

    const displaySource = (source) => {
      const map = {
        google_sheet: "Google Sheets",
        meta: "Meta",
        indiamart: "IndiaMART",
        manual: "Manual Entry",
        excel_upload: "Excel Upload",
      };
      return map[source] || source || "-";
    };

    const formatDate = (value) => {
      if (!value) return '-';
      const d = new Date(value);
      if (isNaN(d)) return '-';

      const day = ('0' + d.getDate()).slice(-2);
      const month = ('0' + (d.getMonth() + 1)).slice(-2);
      const year = d.getFullYear();

      return `${day}/${month}/${year}`;
    };

    doc.font('Roboto-Bold').fontSize(12).text('Sales Table', 40, doc.y, {underline:true});
    doc.moveDown();

    const startX=40;
    const PAD=3;
    let rowY=doc.y;

    doc.font('Roboto-Bold').fontSize(9);
    doc.lineWidth(0.5);

    const cols=[0,55,140,210,300,330,370,410,450,520];

    doc.rect(startX,rowY-2,520,18).stroke();
    cols.forEach(c=>{doc.moveTo(startX+c,rowY-2).lineTo(startX+c,rowY+16).stroke();});

    doc.text('Date',startX+PAD,rowY);
    doc.text('Customer',startX+55+PAD,rowY);
    doc.text('User',startX+140+PAD,rowY);
    doc.text('Chair',startX+210+PAD,rowY,{width:80});
    doc.text('Qty',startX+300+PAD,rowY);
    doc.text('Sell',startX+330+PAD,rowY);
    doc.text('Cost',startX+370+PAD,rowY);
    doc.text('Profit',startX+410+PAD,rowY);
    doc.text('Source',startX+450+PAD,rowY,{width:110});

    rowY+=18;
    doc.font('Roboto').fontSize(8);

    data.rows.forEach(r => {

      const rowData = [
        formatDate(r.date),
        r.customer,
        r.user,
        r.chair,
        String(cleanNumber(r.qty)),
        `₹${cleanNumber(r.sellUnit)}`,
        `₹${cleanNumber(r.costUnit)}`,
        `₹${cleanNumber(r.profit)}`,
        displaySource(r.source)
      ];

      const colWidths = [
        55, 85, 70, 90, 30, 40, 40, 40, 110
      ];

      // Calculate dynamic height
      let maxHeight = 0;

      rowData.forEach((text, i) => {
        const h = doc.heightOfString(String(text), {
          width: colWidths[i] - PAD * 2,
          align: "left"
        });
        if (h > maxHeight) maxHeight = h;
      });

      const rowHeight = Math.max(16, maxHeight + 6);

      // Page break check
      if (rowY + rowHeight > 780) {
        doc.addPage();
        rowY = 40;
      }

      // Draw row border
      doc.rect(startX, rowY - 2, 520, rowHeight).stroke();

      // Draw vertical lines
      let cumulativeX = 0;
      cols.forEach(c => {
        doc.moveTo(startX + c, rowY - 2)
          .lineTo(startX + c, rowY - 2 + rowHeight)
          .stroke();
      });

      // Draw text
      let xCursor = startX;

      rowData.forEach((text, i) => {
        doc.text(String(text), xCursor + PAD, rowY, {
          width: colWidths[i] - PAD * 2,
          align: "left"
        });
        xCursor += colWidths[i];
      });

      rowY += rowHeight;
    });

    doc.end();

  } catch(err){
  console.error("PDF EXPORT ERROR",err);
  res.status(500).send("PDF export error");
  }
};