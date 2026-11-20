'use strict';
/**
 * Air Waybill (AWB) helpers. An AWB is 11 digits: a 3-digit airline prefix
 * plus an 8-digit serial whose last digit is a check digit
 * (first 7 serial digits mod 7). Tracking data itself lives with the airline;
 * we only validate the number and point the customer at the airline's own
 * cargo site, so status always comes from the carrier.
 *
 * Verify these links periodically; airlines change their cargo sites.
 */
const AIRLINES = {
  '001': { name: 'American Airlines Cargo', url: 'https://www.aacargo.com' },
  '006': { name: 'Delta Cargo', url: 'https://www.deltacargo.com' },
  '014': { name: 'Air Canada Cargo', url: 'https://www.aircanada.com/cargo' },
  '016': { name: 'United Cargo', url: 'https://www.unitedcargo.com' },
  '020': { name: 'Lufthansa Cargo', url: 'https://www.lufthansa-cargo.com' },
  '027': { name: 'Alaska Air Cargo', url: 'https://www.alaskacargo.com' },
  '057': { name: 'Air France Cargo', url: 'https://www.afklcargo.com' },
  '074': { name: 'KLM Cargo', url: 'https://www.afklcargo.com' },
  '125': { name: 'British Airways (IAG Cargo)', url: 'https://www.iagcargo.com' },
  '157': { name: 'Qatar Airways Cargo', url: 'https://www.qrcargo.com' },
  '160': { name: 'Cathay Cargo', url: 'https://www.cathaycargo.com' },
  '176': { name: 'Emirates SkyCargo', url: 'https://www.skycargo.com' },
  '235': { name: 'Turkish Cargo', url: 'https://www.turkishcargo.com' },
  '526': { name: 'Southwest Cargo', url: 'https://www.swacargo.com' },
  '607': { name: 'Etihad Cargo', url: 'https://www.etihadcargo.com' },
  '618': { name: 'Singapore Airlines Cargo', url: 'https://www.siacargo.com' },
  '724': { name: 'Swiss WorldCargo', url: 'https://www.swissworldcargo.com' },
};

function normalize(input) {
  return String(input || '').replace(/[\s-]/g, '');
}

/** Returns { valid, awb, formatted, prefix, airline, error } */
function parse(input) {
  const awb = normalize(input);
  if (!/^\d{11}$/.test(awb)) {
    return { valid: false, awb, error: 'An air waybill number has 11 digits, for example 006-12345675.' };
  }
  const prefix = awb.slice(0, 3);
  const serial = awb.slice(3);
  const check = Number(serial.slice(0, 7)) % 7;
  if (check !== Number(serial[7])) {
    return { valid: false, awb, error: 'That number fails the air waybill check digit. Please re-check it with your booking email.' };
  }
  return {
    valid: true,
    awb,
    formatted: `${prefix}-${serial}`,
    prefix,
    airline: AIRLINES[prefix] || null,
  };
}

module.exports = { parse, normalize, AIRLINES };
