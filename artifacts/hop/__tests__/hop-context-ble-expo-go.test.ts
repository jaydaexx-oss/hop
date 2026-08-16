/**
 * Tests for useBluetoothDiscovery.native.ts — Expo Go / missing-native-binding
 * scenario.
 *
 * In Expo Go the react-native-ble-plx JS package IS installed (Metro can
 * resolve the import), but the native BleClientManager binding is absent.
 * That means:
 *   - require('react-native-ble-plx')  → resolves  (_bleAvailable = true)
 *   - new BleManager()                 → throws    (_managerInitFailed = true)
 *
 * jest.context.config.js maps react-native-ble-plx to a mock whose BleManager
 * constructor throws — simulating the Expo Go runtime precisely.
 *
 * The native hook is imported via a relative path so we bypass the
 * @/hooks/useBluetoothDiscovery web-stub moduleNameMapper redirect and test
 * the real native hook.
 */

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

jest.mock('@/protocol/ble/permissions', () => ({
  requestBlePermissions: jest.fn().mockResolvedValue('granted'),
}));

jest.mock('@/protocol/ble/BluetoothTransport', () => ({
  bluetoothTransport: {
    setVerifiedPeers: jest.fn(),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { render, act, screen } from '@testing-library/react-native';
// Direct relative import — bypasses the @/hooks/…  web-stub redirect so we
// test the real native hook implementation.
import { useBluetoothDiscovery } from '../hooks/useBluetoothDiscovery.native';

// ── Shared fixture ────────────────────────────────────────────────────────────

/**
 * Minimal component that renders the hook's state so we can assert against
 * rendered text rather than fighting renderHook's result ref.
 */
const BleFixture: React.FC = () => {
  const { status, verifiedBlePeers } = useBluetoothDiscovery();
  return React.createElement(View, null,
    React.createElement(Text, { testID: 'ble-status' }, status),
    React.createElement(Text, { testID: 'ble-peers' }, String(verifiedBlePeers.size)),
  );
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useBluetoothDiscovery.native — Expo Go guard (BleManager construction fails)', () => {
  /**
   * The moduleNameMapper redirects react-native-ble-plx to
   * __mocks__/react-native-ble-plx.ts whose BleManager constructor throws,
   * simulating Expo Go.  The hook's getManager() try/catch must catch the
   * throw and fall back to the unsupported stub state.
   */
  it('returns status "unsupported" when BleManager construction throws', async () => {
    await act(async () => {
      render(React.createElement(BleFixture));
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(screen.getByTestId('ble-status').props.children).toBe('unsupported');
  });

  it('returns an empty verifiedBlePeers set when native binding is absent', async () => {
    await act(async () => {
      render(React.createElement(BleFixture));
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(screen.getByTestId('ble-peers').props.children).toBe('0');
  });

  it('never calls bluetoothTransport.setVerifiedPeers when native binding is absent', async () => {
    const { bluetoothTransport } = jest.requireMock('@/protocol/ble/BluetoothTransport') as {
      bluetoothTransport: { setVerifiedPeers: jest.Mock };
    };
    bluetoothTransport.setVerifiedPeers.mockClear();

    await act(async () => {
      render(React.createElement(BleFixture));
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(bluetoothTransport.setVerifiedPeers).not.toHaveBeenCalled();
  });

  it('never calls requestBlePermissions when native binding is absent', async () => {
    const { requestBlePermissions } = jest.requireMock('@/protocol/ble/permissions') as {
      requestBlePermissions: jest.Mock;
    };
    requestBlePermissions.mockClear();

    await act(async () => {
      render(React.createElement(BleFixture));
      await new Promise<void>(resolve => setImmediate(resolve));
    });

    expect(requestBlePermissions).not.toHaveBeenCalled();
  });
});
