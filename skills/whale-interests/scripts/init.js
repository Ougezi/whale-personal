'use strict';
const path = require('node:path');
const H = require('../../../src/core/hobby.js');
const dir = path.join(__dirname, '..', '..', '..', 'dist', 'whale-personal', 'data');
const file = path.join(dir, 'interests.json');
const fs = require('node:fs');
if (!fs.existsSync(file)) {
  H.save(dir, H.empty());
  console.log('created', file);
} else {
  const d = H.load(dir);
  console.log('exists', file, 'interests', d.interests.length);
}
