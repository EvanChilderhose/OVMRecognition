// "Save our number" contact card. Phones won't let a text add itself to the
// contacts, so employees get a link to this card instead: tapping it opens the
// phone's own Add Contact screen, filled in with the name, number and logo.
//
// TEXTING_NUMBER (set in Render) is the GoHighLevel number employees get texts from.

const fs = require('fs');
const path = require('path');
const { normalizePhone } = require('./phone');
const { appUrl } = require('./profile');

const CONTACT_NAME = 'OVM REWARDS 🥩';

function textingNumber() {
  return normalizePhone(process.env.TEXTING_NUMBER);
}

// Link to the card, or null if TEXTING_NUMBER isn't set
function contactCardUrl() {
  const base = appUrl();
  return textingNumber() && base ? `${base}/contact.vcf` : null;
}

// vCard lines longer than 75 characters must be folded (continued on the next line after a space)
const fold = line => line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n ');

let photo = null;
function vcard() {
  const number = textingNumber();
  if (!number) return null;
  if (photo === null) {
    try { photo = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon-180.png')).toString('base64'); }
    catch (err) { photo = ''; }
  }
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${CONTACT_NAME}`,
    `N:${CONTACT_NAME};;;;`,
    'ORG:Ottawa Valley Meats',
    `TEL;TYPE=CELL,VOICE:${number}`,
    'NOTE:Ottawa Valley Meats employee rewards. Text POINTS to check your balance.',
    photo ? `PHOTO;ENCODING=b;TYPE=PNG:${photo}` : null,
    'END:VCARD'
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { CONTACT_NAME, textingNumber, contactCardUrl, vcard };
