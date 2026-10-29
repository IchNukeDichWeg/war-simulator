/// <reference lib="webworker" />
// Web Worker entry: the UI posts ToWorker messages, receives FromWorker.
import type { ToWorker } from './protocol';
import { Controller } from './controller';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const controller = new Controller((msg, transfer) => scope.postMessage(msg, transfer ?? []));
scope.onmessage = (e: MessageEvent<ToWorker>) => controller.handle(e.data);
