const { execFile, exec } = require('child_process');
const { promisify } = require('util');

module.exports = {
  execFile: promisify(execFile),
  exec: promisify(exec),
};
