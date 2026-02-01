const { TextEncoder, TextDecoder } = require('util');
Object.assign(global, { TextEncoder, TextDecoder });
Object.assign(global, require('jest-chrome'));
