const { withXcodeProject } = require("@expo/config-plugins");

/**
 * Expo Dev Launcher writes the local Metro address into the Debug app bundle.
 * Xcode's user-script sandbox blocks that write on this project, so keep it
 * disabled whenever Expo regenerates the iOS project.
 */
module.exports = function withUserScriptSandboxing(config) {
  return withXcodeProject(config, (nextConfig) => {
    nextConfig.modResults.updateBuildProperty(
      "ENABLE_USER_SCRIPT_SANDBOXING",
      "NO",
      undefined,
      nextConfig.modRequest.projectName,
    );
    return nextConfig;
  });
};
