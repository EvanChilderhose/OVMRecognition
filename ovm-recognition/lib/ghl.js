// Thin client for the GoHighLevel (GHL) API v2.
// Uses a Private Integration Token (Settings -> Private Integrations in GHL) —
// simpler than full OAuth for a single-location business like OVM.
//
// Required scopes on the token: contacts.readonly, contacts.write,
// conversations.readonly, conversations.write,
// conversations/message.readonly, conversations/message.write
//
// NOTE: GHL updates its API periodically. If any call here starts failing,
// re-check https://marketplace.gohighlevel.com/docs/ for the current
// request/response shape before assuming the code is broken.

const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    Version: API_VERSION,
    'Content-Type': 'application/json'
  }
});

// Finds an existing GHL contact by phone, or creates one if none exists.
// Returns the GHL contactId, which is what /conversations/messages needs.
async function findOrCreateContact(phone, name) {
  const search = await client.get('/contacts/', {
    params: { locationId: process.env.GHL_LOCATION_ID, query: phone }
  });
  const existing = search.data.contacts && search.data.contacts[0];
  if (existing) return existing.id;

  const created = await client.post('/contacts/', {
    locationId: process.env.GHL_LOCATION_ID,
    phone,
    name
  });
  return created.data.contact.id;
}

// Sends an SMS to a contact. Pass either a known contactId, or a
// {phone, name} pair to look up/create the contact first.
async function sendSMS({ contactId, phone, name, message }) {
  let toContactId = contactId;
  if (!toContactId) {
    toContactId = await findOrCreateContact(phone, name);
  }
  const res = await client.post('/conversations/messages', {
    type: 'SMS',
    contactId: toContactId,
    message
  });
  return res.data;
}

module.exports = { findOrCreateContact, sendSMS };
