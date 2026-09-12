const { withAndroidManifest } = require("@expo/config-plugins");

/** Allow the trusted-LAN HTTP gateway used by the local demo build. */
module.exports = function withDemoCleartext(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Could not find the Android application manifest entry.");
    }
    application.$ ??= {};
    application.$["android:usesCleartextTraffic"] = "true";
    return modConfig;
  });
};
