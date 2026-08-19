/**
 * RNWorklets 0.10.x (Expo SDK 57) compiles C++ with
 * `#include <worklets/Compat/StableApi.h>` but the podspec HEADER_SEARCH_PATHS
 * omit `Common/cpp`. Clang then fails on EAS with
 * `worklets/Compat/StableApi.h file not found` (sometimes transcribed as StableAbi.h).
 *
 * Paths are CocoaPods variables + repo-relative pod roots — not absolute machine paths.
 */
const { createRunOncePlugin, withDangerousMod, withPodfile } =
  require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'hop_worklets_compat_headers';
const WORKLETS_CPP_SEARCH = '"$(PODS_TARGET_SRCROOT)/Common/cpp"';
const REANIMATED_WORKLETS_CPP_SEARCH =
  '"$(PODS_TARGET_SRCROOT)/../react-native-worklets/Common/cpp"';

function insertSearchPath(podspec, extra) {
  if (podspec.includes(extra)) {
    return podspec;
  }
  const replaced = podspec.replace(
    /("HEADER_SEARCH_PATHS"\s*=>\s*\[)/,
    `$1\n      ${extra},`
  );
  if (replaced === podspec) {
    throw new Error(
      `[${MARKER}] Could not insert HEADER_SEARCH_PATHS into podspec`
    );
  }
  return replaced;
}

function withPatchedPodspecs(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const root = modConfig.modRequest.projectRoot;
      const workletsSpec = path.join(
        root,
        'node_modules/react-native-worklets/RNWorklets.podspec'
      );
      const reanimatedSpec = path.join(
        root,
        'node_modules/react-native-reanimated/RNReanimated.podspec'
      );

      if (fs.existsSync(workletsSpec)) {
        fs.writeFileSync(
          workletsSpec,
          insertSearchPath(fs.readFileSync(workletsSpec, 'utf8'), WORKLETS_CPP_SEARCH)
        );
      }
      if (fs.existsSync(reanimatedSpec)) {
        fs.writeFileSync(
          reanimatedSpec,
          insertSearchPath(
            fs.readFileSync(reanimatedSpec, 'utf8'),
            REANIMATED_WORKLETS_CPP_SEARCH
          )
        );
      }
      return modConfig;
    },
  ]);
}

const POST_INSTALL_RUBY = `
    # ${MARKER}: make worklets/Compat/StableApi.h visible to RNWorklets, RNReanimated, ExpoModulesWorkletsAdapter
    installer.pods_project.targets.each do |target|
      next unless %w[RNWorklets RNReanimated ExpoModulesWorkletsAdapter].include?(target.name)
      worklets_dir = installer.sandbox.pod_dir('RNWorklets')
      next if worklets_dir.nil?
      rel = Pathname.new(worklets_dir).relative_path_from(Pathname.new(installer.sandbox.root)).to_s
      extra = '"$(PODS_ROOT)/' + rel + '/Common/cpp"'
      target.build_configurations.each do |bc|
        header_paths = bc.build_settings['HEADER_SEARCH_PATHS']
        if header_paths.is_a?(Array)
          bc.build_settings['HEADER_SEARCH_PATHS'] = header_paths + [extra] unless header_paths.join(' ').include?(rel + '/Common/cpp')
        elsif header_paths.is_a?(String)
          bc.build_settings['HEADER_SEARCH_PATHS'] = header_paths + ' ' + extra unless header_paths.include?(rel + '/Common/cpp')
        else
          bc.build_settings['HEADER_SEARCH_PATHS'] = '$(inherited) ' + extra
        end
      end
    end
`;

function withPodfileSearchPaths(config) {
  return withPodfile(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes(MARKER)) {
      if (!contents.includes('post_install do |installer|')) {
        throw new Error(`[${MARKER}] Podfile has no post_install hook to patch`);
      }
      contents = contents.replace(
        'post_install do |installer|',
        `post_install do |installer|${POST_INSTALL_RUBY}`
      );
      modConfig.modResults.contents = contents;
    }
    return modConfig;
  });
}

function withWorkletsCompatHeaders(config) {
  return withPodfileSearchPaths(withPatchedPodspecs(config));
}

module.exports = createRunOncePlugin(
  withWorkletsCompatHeaders,
  'withWorkletsCompatHeaders',
  '1.0.0'
);
