/**
 * Local hop-sodium module is autolinked from modules/. This plugin exists so
 * app.json can list the native libsodium backend; it does not change Info.plist.
 */
module.exports = function withHopSodium(config) {
  return config;
};
