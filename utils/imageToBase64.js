const fs = require('fs');
const path = require('path');

module.exports = function imageToBase64(relativePath) {
  const absolutePath = path.join(process.cwd(), 'public', relativePath);
  const mime =
    relativePath.endsWith('.png') ? 'image/png' :
    relativePath.endsWith('.jpg') || relativePath.endsWith('.jpeg') ? 'image/jpeg' :
    'image/png';

  const data = fs.readFileSync(absolutePath);
  return `data:${mime};base64,${data.toString('base64')}`;
};