import { setSodiumBackend } from '@hop/protocol';

import {
  createNativeHopSodium,
  isNativeHopSodiumAvailable,
  getHopSodiumNativeModule,
} from '../../modules/hop-sodium';

const os = process.env.EXPO_OS;
if (os === 'ios' || os === 'android') {
  if (!isNativeHopSodiumAvailable()) {
    throw new Error(
      'HOP native libsodium module is missing. Rebuild the iOS/Android dev client with EAS (npx eas build --profile development --platform ios). Fast Refresh cannot load native C.',
    );
  }
  const native = getHopSodiumNativeModule();
  if (!native) {
    throw new Error('HOP native libsodium module is missing.');
  }
  setSodiumBackend(createNativeHopSodium(native));
}
