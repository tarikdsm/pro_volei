import type { AppState } from '../ui/appState';

export interface PwaActivationState {
  readonly appState: AppState;
  readonly portrait: boolean;
}

export interface PwaCoordinatorOptions {
  readonly state: () => PwaActivationState;
  readonly onUpdateReady?: () => void;
  readonly onOfflineReady?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly reload?: () => void;
}

export interface PwaCoordinator {
  activateUpdateIfSafe(): void;
}

export function canActivateUpdate(state: PwaActivationState): boolean {
  return state.portrait || state.appState === 'title' || state.appState === 'ended';
}

export function registerPwa(
  options: PwaCoordinatorOptions,
  serviceWorkers: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): PwaCoordinator {
  let registration: ServiceWorkerRegistration | null = null;
  let requestedActivation = false;
  let reloadPending = false;
  const reload = options.reload ?? (() => location.reload());

  const activateUpdateIfSafe = (): void => {
    if (reloadPending) {
      if (!canActivateUpdate(options.state())) return;
      reloadPending = false;
      reload();
      return;
    }
    const waiting = registration?.waiting;
    if (!waiting || !canActivateUpdate(options.state())) return;
    requestedActivation = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  if (!serviceWorkers) return { activateUpdateIfSafe };

  serviceWorkers.addEventListener('controllerchange', () => {
    if (!requestedActivation) return;
    reloadPending = true;
    activateUpdateIfSafe();
  });

  void serviceWorkers
    .register('./sw.js', { scope: './' })
    .then((nextRegistration) => {
      registration = nextRegistration;
      if (registration.waiting) {
        options.onUpdateReady?.();
        activateUpdateIfSafe();
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration?.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state !== 'installed' || !serviceWorkers.controller) return;
          options.onUpdateReady?.();
          activateUpdateIfSafe();
        });
      });
      return serviceWorkers.ready;
    })
    .then(() => options.onOfflineReady?.())
    .catch((error: unknown) => options.onError?.(error));

  return { activateUpdateIfSafe };
}
