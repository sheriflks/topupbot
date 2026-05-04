const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve('./logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = {
  DEBUG: '\x1b[36m',
  INFO:  '\x1b[32m',
  WARN:  '\x1b[33m',
  ERROR: '\x1b[31m',
  RESET: '\x1b[0m'
};

function getTimestamp() {
  return new Date().toISOString();
}

function getLogFile() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${date}.log`);
}

function writeToFile(message) {
  try {
    fs.appendFileSync(getLogFile(), message + '\n', 'utf8');
  } catch (e) {
    // silent fail on log write
  }
}

function log(level, module, message, data = null) {
  const ts = getTimestamp();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  const logLine = `[${ts}] [${level}] [${module}] ${message}${dataStr}`;
  const coloredLine = `${COLORS[level]}${logLine}${COLORS.RESET}`;

  console.log(coloredLine);
  writeToFile(logLine);
}

const logger = {
  debug: (module, message, data) => log('DEBUG', module, message, data),
  info:  (module, message, data) => log('INFO',  module, message, data),
  warn:  (module, message, data) => log('WARN',  module, message, data),
  error: (module, message, data) => log('ERROR', module, message, data),
};

module.exports = logger;
