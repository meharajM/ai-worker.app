
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// Create a handler that will proxy messages to the MLCEngine running in this worker
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
    handler.onmessage(msg);
};
