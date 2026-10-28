// "Save our number" contact cards. Phones won't let a text add itself to the
// contacts, so employees get a link to a card instead: tapping it opens the
// phone's own Add Contact screen, filled in with the name, number and logo.
//
// There's one card per number (both set in Render):
// - TEXTING_NUMBER: the GoHighLevel number for rewards texts -> OVM REWARDS 🥩 (/contact.vcf)
// - UPDATES_NUMBER: the GoHighLevel number for team updates -> OVM Updates 📣 (/updates.vcf)

const fs = require('fs');
const path = require('path');
const { normalizePhone } = require('./phone');
const { appUrl } = require('./profile');

const CONTACT_NAME = 'OVM REWARDS 🥩';
const UPDATES_CONTACT_NAME = 'OVM Updates 📣';

function textingNumber() {
  return normalizePhone(process.env.TEXTING_NUMBER);
}
function updatesNumber() {
  return normalizePhone(process.env.UPDATES_NUMBER);
}

// Link to the card, or null if TEXTING_NUMBER isn't set
function contactCardUrl() {
  const base = appUrl();
  return textingNumber() && base ? `${base}/contact.vcf` : null;
}
// Link to the OVM Updates card, or null if UPDATES_NUMBER isn't set
function updatesCardUrl() {
  const base = appUrl();
  return updatesNumber() && base ? `${base}/updates.vcf` : null;
}

// vCard lines longer than 75 characters must be folded (continued on the next line after a space)
const fold = line => line.length <= 75 ? line : line.match(/.{1,74}/g).join('\r\n ');

let photo = null;
function buildCard(name, number, note) {
  if (!number) return null;
  if (photo === null) {
    // A square JPEG, 512px: the format iPhones use for their own contact photos.
    // (They can show a PNG while adding the contact but drop it once saved.)
    try { photo = fs.readFileSync(path.join(__dirname, '..', 'public', 'contact-photo.jpg')).toString('base64'); }
    catch (err) { photo = ''; }
  }
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `N:${name};;;;`,
    'ORG:Ottawa Valley Meats',
    `TEL;TYPE=CELL,VOICE:${number}`,
    `NOTE:${note}`,
    photo ? `PHOTO;ENCODING=b;TYPE=JPEG:${photo}` : null,
    'END:VCARD'
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

function vcard() {
  return buildCard(CONTACT_NAME, textingNumber(), 'Ottawa Valley Meats employee rewards. Text POINTS to check your balance.');
}
function updatesVcard() {
  return buildCard(UPDATES_CONTACT_NAME, updatesNumber(), 'Team updates from Ottawa Valley Meats. Reply anytime.');
}

module.exports = { CONTACT_NAME, UPDATES_CONTACT_NAME, textingNumber, updatesNumber, contactCardUrl, updatesCardUrl, vcard, updatesVcard };
