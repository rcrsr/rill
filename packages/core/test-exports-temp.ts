import { hoistExtension, type HoistedExtension } from './src/index.js';

// Type check: hoistExtension should be a function
const fn: typeof hoistExtension = hoistExtension;

// Type check: HoistedExtension should be a valid type
const testObj: HoistedExtension = {
  functions: {},
  dispose: undefined,
};

console.log('Export validation passed');
