// utils/formatPhoneE164.js
/**
 * Convert a phone number into E.164 format (required by WhatsApp Cloud API).
 * 
 * @param {string} phone - Raw phone number (may include +, 0, spaces, etc.)
 * @param {string} defaultCountryCode - Country code (e.g. "91" for India)
 * @returns {string} - Formatted number in E.164 (+CCXXXXXXXXXX)
 */
function formatPhoneE164(phone, defaultCountryCode = "91") {
  if (!phone) return null;

  const raw = phone.toString().trim();

  if (raw.startsWith("+")) {
    return raw;
  }

  let cleaned = raw.replace(/\D/g, ''); // remove non-digits

  if (cleaned.startsWith('0091') && cleaned.length === 14) {
    return '+91' + cleaned.slice(4);
  }

  if (cleaned.startsWith('00') && cleaned.length === 12) {
    return '+91' + cleaned.slice(2);
  }

  if (cleaned.startsWith('91') && cleaned.length === 12) {
    // e.g. 919876543210 → +919876543210
    return '+' + cleaned;
  }

  if (cleaned.length === 10) {
    // e.g. 9876543210 → +919876543210 (default country)
    return '+' + defaultCountryCode + cleaned;
  }

  if (cleaned.startsWith("0") && cleaned.length === 11) {
    // e.g. 08779951264 → +918779951264
    return '+' + defaultCountryCode + cleaned.slice(1);
  }

  // fallback: add '+' if missing
  return null
}

module.exports = formatPhoneE164;
