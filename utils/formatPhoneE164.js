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

  // Remove spaces, hyphens, parentheses
  let cleaned = phone.replace(/[^\d+]/g, "");

  // Already in E.164 format
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // Remove leading zero if present
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // Prepend country code
  return `${defaultCountryCode}${cleaned}`;
}

module.exports = formatPhoneE164;
