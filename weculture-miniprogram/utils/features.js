// Keep this release on manual city selection until WeChat grants location access.
// Enabling this feature also requires restoring the matching app.json privacy declarations.
// This build-time switch cannot be enabled by account, storage or external configuration.
const FEATURES = Object.freeze({ automaticCityLocation: false });

module.exports = { FEATURES };
