const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// load service account credentials
const credentialsPath = path.join(__dirname, '../google-credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

async function getSheetRows(spreadsheetId, range) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range, // e.g. "Sheet1!A1:E100"
  });

  return res.data.values || [];
}

module.exports = { getSheetRows };
