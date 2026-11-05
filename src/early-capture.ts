// Entry for dist/early-capture.js (registered by background.ts syncEarlyCapture). See early-capture-core.ts.
import { installEarlyCapture } from './early-capture-core';

installEarlyCapture(window as unknown as Parameters<typeof installEarlyCapture>[0]);
