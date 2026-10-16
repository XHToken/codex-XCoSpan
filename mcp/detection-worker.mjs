import { parentPort, workerData } from 'node:worker_threads';
import { scanRules } from './detection-core.mjs';
try { parentPort.postMessage({ findings: scanRules(workerData.text, workerData.config, workerData.customPatterns) }); }
catch { parentPort.postMessage({ error: 'rule_detection_failed' }); }
