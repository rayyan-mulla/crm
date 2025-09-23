const { google } = require('googleapis');

// Load credentials from environment variable
if (!process.env.GOOGLE_CREDENTIALS) {
  throw new Error('Missing GOOGLE_CREDENTIALS environment variable');
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

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
