import { describe, expect, it, vi } from 'vitest';
import { canActivateUpdate, registerPwa } from './PwaCoordinator';

describe('canActivateUpdate', () => {
  it('impede troca de versão durante partida landscape', () => {
    expect(canActivateUpdate({ appState: 'playing', portrait: false })).toBe(false);
    expect(canActivateUpdate({ appState: 'paused', portrait: false })).toBe(false);
  });

  it('permite troca em título, fim ou área portrait', () => {
    expect(canActivateUpdate({ appState: 'title', portrait: false })).toBe(true);
    expect(canActivateUpdate({ appState: 'ended', portrait: false })).toBe(true);
    expect(canActivateUpdate({ appState: 'playing', portrait: true })).toBe(true);
  });
});

describe('registerPwa', () => {
  it('adia o reload se a revanche começar antes do controllerchange', async () => {
    let appState: 'playing' | 'ended' = 'ended';
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() };
    const registration = Object.assign(new EventTarget(), { waiting, installing: null });
    const serviceWorkers = Object.assign(new EventTarget(), {
      controller: {},
      ready: Promise.resolve(registration),
      register: vi.fn(() => Promise.resolve(registration)),
    }) as unknown as ServiceWorkerContainer;

    const coordinator = registerPwa(
      { state: () => ({ appState, portrait: false }), reload },
      serviceWorkers,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    appState = 'playing';
    serviceWorkers.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();

    appState = 'ended';
    coordinator.activateUpdateIfSafe();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
