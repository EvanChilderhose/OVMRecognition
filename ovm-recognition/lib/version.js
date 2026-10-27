// Makes browsers load fresh scripts and styles after every update.
// Each deploy gets its own version (Render's commit id), which is added to the
// pages' script/stylesheet links (app.js?v=1a2b3c4d), so a new deploy can never
// run with an old, cached copy of the code.
const VERSION = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 8);

function versioned(html) {
  return html.replace(/((?:src|href)="\/?[\w-]+\.(?:js|css))"/g, (m, link) => `${link}?v=${VERSION}"`);
}

module.exports = { VERSION, versioned };
