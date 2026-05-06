const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve('./logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = {
  DEBUG: '\x1b[36m', // Cyan
  INFO:  '\x1b[32m', // Green
  WARN:  '\x1b[33m', // Yellow
  ERROR: '\x1b[31m', // Red
  RESET: '\x1b[0m',
  GRAY:  '\x1b[90m',
  WHITE: '\x1b[37m'
};

function getTimestamp() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function getLogFile() {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${date}.log`);
}

function writeToFile(message) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(getLogFile(), `[${ts}] ${message}\n`, 'utf8');
  } catch (e) {}
}

function log(level, module, message, data = null) {
  const time = getTimestamp();
  const moduleStr = `[${module.padEnd(12)}]`;
  const levelStr = level.padEnd(5);
  
  let dataStr = '';
  if (data) {
    if (typeof data === 'object') {
      try { dataStr = ` \x1b[90m➜\x1b[0m ${JSON.stringify(data)}`; }
      catch { dataStr = ` \x1b[90m➜\x1b[0m [Object]`; }
    } else {
      dataStr = ` \x1b[90m➜\x1b[0m ${data}`;
    }
  }

  const logLine = `${COLORS.GRAY}${time}${COLORS.RESET} ${COLORS[level]}${levelStr}${COLORS.RESET} ${COLORS.WHITE}${moduleStr}${COLORS.RESET} ${message}${dataStr}`;
  
  console.log(logLine);
  // Plain version for file
  writeToFile(`[${level}] [${module}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}`);
}

const logger = {
  debug: (module, message, data) => log('DEBUG', module, message, data),
  info:  (module, message, data) => log('INFO',  module, message, data),
  warn:  (module, message, data) => log('WARN',  module, message, data),
  error: (module, message, data) => log('ERROR', module, message, data),
};

module.exports = logger;
